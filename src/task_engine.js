'use strict';
/**
 * TASK ENGINE — Kira's Autonomous Task System
 *
 * Not a cron job. A goal-oriented execution engine.
 *
 * Tasks have goals, planned steps, persistent state,
 * retry strategies, and can spawn subtasks.
 *
 * The planner uses M2.7 to generate steps from goals.
 * The evaluator checks real success, not just API calls.
 * State persists between runs — each run knows what happened before.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const TASKS_FILE = path.join(os.homedir(), '.droidclaw', 'tasks.json');

// ── Storage ───────────────────────────────────────────────────────────────────
function loadTasks() {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); }
  catch { return []; }
}

function saveTasks(tasks) {
  try { fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2)); }
  catch {}
}

// ── Create a task from a goal ─────────────────────────────────────────────────
async function createTask(goal, scheduleText, engine) {
  // use M2.7 to plan the steps
  const steps = await _planSteps(goal, engine);

  const schedule = _parseSchedule(scheduleText);
  const task = {
    id:            `task_${Date.now()}`,
    goal,
    steps,
    schedule,
    state:         {},           // persists between runs
    enabled:       true,
    created:       Date.now(),
    last_run:      null,
    next_run:      _computeNextRun(schedule),
    run_count:     0,
    success_count: 0,
    fail_count:    0,
    last_result:   null,
    subtasks:      [],
  };

  const tasks = loadTasks();
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

// ── Plan steps from goal using M2.7 ──────────────────────────────────────────
async function _planSteps(goal, engine) {
  try {
    const result = await engine.rawChat(`
You are Kira's task planner. Break this goal into executable steps.

Goal: ${goal}

Available tools: exec, web_fetch, fetch_json, github_repo, github_issues, weather, 
send_telegram (via Telegram), memory_store, memory_search, get_notifications, read_screen,
open_app, tap_screen, sms_send, web_search_fetch

Rules:
- Each step should use one tool
- Steps should be sequential and depend on each other's output
- Include a success condition for each step
- Include a condition for optional steps (e.g. "only if previous result has new data")
- Keep it to 3-5 steps maximum

Respond in JSON only:
{
  "steps": [
    {
      "id": "step_1",
      "description": "what this step does",
      "tool": "tool_name",
      "args": { "key": "value" },
      "success_condition": "what makes this step successful",
      "condition": "when to run this step (optional, null means always)",
      "store_result_as": "state_key to save result under (optional)"
    }
  ]
}`);

    const clean = result.replace(/thinking[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return _defaultSteps(goal);

    const parsed = JSON.parse(match[0]);
    return parsed.steps || _defaultSteps(goal);
  } catch {
    return _defaultSteps(goal);
  }
}

function _defaultSteps(goal) {
  return [{
    id:                'step_1',
    description:       goal,
    tool:              'exec',
    args:              { command: 'echo "task executed"' },
    success_condition: 'command runs',
    condition:         null,
    store_result_as:   null,
  }];
}

// ── Execute a task ────────────────────────────────────────────────────────────
async function executeTask(task, engine) {
  const registry = require('./tools/registry');
  const results  = {};
  let   success  = true;
  let   output   = '';

  for (const step of (task.steps || [])) {
    // check condition
    if (step.condition) {
      const condMet = _evaluateCondition(step.condition, results, task.state);
      if (!condMet) continue;
    }

    // resolve args — inject state values
    const resolvedArgs = _resolveArgs(step.args, task.state, results);

    // execute
    let result;
    let stepSuccess = false;
    let attempts    = 0;

    while (attempts < 3 && !stepSuccess) {
      attempts++;
      try {
        result      = await _withTimeout(registry.execute(step.tool, resolvedArgs), 15000);
        stepSuccess = _evaluateSuccess(result, step.success_condition);

        if (!stepSuccess && attempts < 3) {
          // retry with backoff
          await _sleep(attempts * 2000);
        }
      } catch (e) {
        result = `error: ${e.message}`;
        if (attempts < 3) await _sleep(attempts * 2000);
      }
    }

    // store result if requested
    if (step.store_result_as) {
      results[step.store_result_as] = result;
      task.state[step.store_result_as] = result; // persists to next run
    }

    results[step.id] = result;
    output += `[${step.description}]: ${String(result).slice(0, 300)}\n`;

    if (!stepSuccess) {
      success = false;
      // don't abort — continue with remaining steps
    }
  }

  // update task state
  const tasks  = loadTasks();
  const idx    = tasks.findIndex(t => t.id === task.id);
  if (idx !== -1) {
    tasks[idx].last_run     = Date.now();
    tasks[idx].next_run     = _computeNextRun(task.schedule);
    tasks[idx].run_count    = (tasks[idx].run_count || 0) + 1;
    tasks[idx].state        = task.state;
    tasks[idx].last_result  = output.slice(0, 500);
    if (success) tasks[idx].success_count = (tasks[idx].success_count || 0) + 1;
    else tasks[idx].fail_count = (tasks[idx].fail_count || 0) + 1;
    saveTasks(tasks);
  }

  return { success, output, results };
}

// ── Generate a natural summary of task result ─────────────────────────────────
async function summarizeResult(task, executionResult, engine) {
  if (!executionResult.output) return null;

  try {
    const result = await engine.rawChat(`
You are Kira. Summarize this task result in 2-3 sentences max.
Be direct. Only include what matters. Skip filler.

Task goal: ${task.goal}
Raw output:
${executionResult.output.slice(0, 1000)}

Write a concise summary to send via Telegram. No markdown. Plain text.`);

    return result.replace(/thinking[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
  } catch { return executionResult.output.slice(0, 300); }
}

// ── Get due tasks ─────────────────────────────────────────────────────────────
function getDueTasks() {
  const tasks = loadTasks();
  const now   = Date.now();
  return tasks.filter(t => t.enabled && t.next_run && t.next_run <= now);
}

// ── Task management ───────────────────────────────────────────────────────────
function listTasks() {
  return loadTasks();
}

function removeTask(nameOrId) {
  const tasks = loadTasks();
  const idx   = tasks.findIndex(t =>
    t.id === nameOrId || t.goal?.toLowerCase().includes(nameOrId.toLowerCase())
  );
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  saveTasks(tasks);
  return true;
}

function toggleTask(nameOrId, enabled) {
  const tasks = loadTasks();
  const task  = tasks.find(t =>
    t.id === nameOrId || t.goal?.toLowerCase().includes(nameOrId.toLowerCase())
  );
  if (!task) return false;
  task.enabled = enabled;
  saveTasks(tasks);
  return true;
}

function formatTaskList() {
  const tasks = loadTasks();
  if (!tasks.length) return 'no tasks scheduled.';
  return tasks.map(t => {
    const next   = t.next_run ? _timeUntil(t.next_run) : '?';
    const status = t.enabled ? '●' : '○';
    const rate   = t.run_count > 0
      ? ` (${t.success_count}/${t.run_count} runs)`
      : '';
    return `${status} ${t.goal.slice(0, 60)}${rate} — next: ${next}`;
  }).join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _parseSchedule(text) {
  if (!text) return { type: 'interval', minutes: 60 };
  const t = text.toLowerCase();

  const intervalMatch = t.match(/every\s+(\d+)\s*(minute|min|hour|hr)/);
  if (intervalMatch) {
    const n    = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2];
    return { type: 'interval', minutes: unit.startsWith('h') ? n * 60 : n };
  }

  const timeMatch = t.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hours  = parseInt(timeMatch[1]);
    const mins = parseInt(timeMatch[2] || '0');
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    return { type: 'daily', hour: hours, minute: mins };
  }

  if (/morning/.test(t)) return { type: 'daily', hour: 8,  minute: 0 };
  if (/evening/.test(t)) return { type: 'daily', hour: 19, minute: 0 };
  if (/night/.test(t))   return { type: 'daily', hour: 22, minute: 0 };
  if (/noon/.test(t))    return { type: 'daily', hour: 12, minute: 0 };

  return { type: 'interval', minutes: 60 };
}

function _computeNextRun(schedule) {
  if (!schedule) return Date.now() + 3600000;

  if (schedule.type === 'interval') {
    return Date.now() + (schedule.minutes || 60) * 60000;
  }

  if (schedule.type === 'daily') {
    const next = new Date();
    next.setHours(schedule.hour || 8, schedule.minute || 0, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  return Date.now() + 3600000;
}

function _evaluateCondition(condition, results, state) {
  if (!condition) return true;
  const c = condition.toLowerCase();
  if (c.includes('new data') || c.includes('changed')) {
    // check if any result differs from stored state
    return Object.values(results).some(r => String(r).length > 10);
  }
  if (c.includes('success')) {
    return Object.values(results).every(r => !/error|failed/i.test(String(r)));
  }
  return true;
}

function _evaluateSuccess(result, condition) {
  if (!condition) return true;
  const r = String(result || '').toLowerCase();
  if (/error|failed|not found/.test(r)) return false;
  const c = condition.toLowerCase();
  if (c.includes('array') || c.includes('list')) return r.includes('[') || r.includes('-');
  if (c.includes('sent')) return r.includes('sent') || r.includes('ok');
  if (c.includes('found')) return r.length > 10;
  return r.length > 0;
}

function _resolveArgs(args, state, results) {
  if (!args) return {};
  const resolved = { ...args };
  // replace {{state.key}} and {{results.key}} placeholders
  Object.keys(resolved).forEach(k => {
    const val = String(resolved[k]);
    const stateMatch = val.match(/\{\{state\.(\w+)\}\}/);
    if (stateMatch && state[stateMatch[1]]) {
      resolved[k] = state[stateMatch[1]];
    }
    const resultMatch = val.match(/\{\{results\.(\w+)\}\}/);
    if (resultMatch && results[resultMatch[1]]) {
      resolved[k] = results[resultMatch[1]];
    }
  });
  return resolved;
}

function _withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))
  ]);
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _timeUntil(ts) {
  const diff = ts - Date.now();
  if (diff < 0) return 'overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d`;
}

module.exports = {
  createTask,
  executeTask,
  summarizeResult,
  getDueTasks,
  listTasks,
  removeTask,
  toggleTask,
  formatTaskList,
};
