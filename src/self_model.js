'use strict';
/**
 * SELF MODEL — Kira's Persistent Self-Knowledge
 *
 * Three layers:
 * 1. Self-model — what Kira knows about her own capabilities and failures
 * 2. Reflexion — post-response introspection that updates the self-model
 * 3. Failure prediction — before complex tasks, check what's likely to fail
 *
 * Unlike every other metacognition implementation:
 * This persists across sessions. She gets more self-aware over time.
 */

const mind = require('./core/mind');

// ── Self-model entry types ────────────────────────────────────────────────────
const TYPE = {
  CAPABILITY:     'capability',      // things she can do reliably
  FAILURE_MODE:   'failure_mode',    // known failure patterns
  BLIND_SPOT:     'blind_spot',      // things she consistently misses
  REASONING:      'reasoning',       // patterns in how she thinks
  TASK_PERF:      'task_perf',       // performance on specific task types
};

// ── Load self-model from KIRA_MIND ────────────────────────────────────────────
function load() {
  try {
    const raw = mind.getState('self_model');
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : _defaultModel();
  } catch { return _defaultModel(); }
}

function save(model) {
  try {
    model.lastUpdated = Date.now();
    mind.setState('self_model', JSON.stringify(model));
  } catch {}
}

function _defaultModel() {
  return {
    capabilities:   {},  // tool/skill → { uses, successes, confidence }
    failure_modes:  [],  // { pattern, count, lastSeen, context }
    blind_spots:    [],  // { description, evidence, count }
    reasoning:      [],  // { pattern, positive, count }
    task_perf:      {},  // task_type → { attempts, successes, rate }
    lastUpdated:    null,
    version:        1,
  };
}

// ── Update capability from tool execution ──────────────────────────────────────
function recordToolPerformance(toolName, success, context = '') {
  const model = load();
  if (!model.capabilities[toolName]) {
    model.capabilities[toolName] = { uses: 0, successes: 0, confidence: 0.5, lastUsed: null };
  }
  const cap = model.capabilities[toolName];
  cap.uses++;
  if (success) cap.successes++;
  cap.confidence = cap.successes / cap.uses;
  cap.lastUsed   = Date.now();

  // detect failure modes — 3 consecutive failures on same tool
  if (!success) {
    const existing = model.failure_modes.find(f => f.pattern.includes(toolName));
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
    } else {
      model.failure_modes.push({
        pattern:  `${toolName} failed: ${context.slice(0, 100)}`,
        count:    1,
        lastSeen: Date.now(),
        context,
      });
    }
  }

  save(model);
}

// ── Record a blind spot ────────────────────────────────────────────────────────
function recordBlindSpot(description) {
  const model = load();
  const existing = model.blind_spots.find(b =>
    b.description.toLowerCase().slice(0, 40) === description.toLowerCase().slice(0, 40)
  );
  if (existing) {
    existing.count++;
    existing.lastSeen = Date.now();
  } else {
    model.blind_spots.push({ description, count: 1, lastSeen: Date.now() });
  }
  model.blind_spots = model.blind_spots.slice(-20);
  save(model);
}

// ── Record task performance ────────────────────────────────────────────────────
function recordTaskPerformance(taskType, success) {
  const model = load();
  if (!model.task_perf[taskType]) {
    model.task_perf[taskType] = { attempts: 0, successes: 0, rate: 0 };
  }
  const perf = model.task_perf[taskType];
  perf.attempts++;
  if (success) perf.successes++;
  perf.rate = perf.successes / perf.attempts;
  save(model);
}

// ── Failure prediction — before attempting complex tasks ─────────────────────
function predictFailure(taskDescription, toolsRequired = []) {
  const model  = load();
  const risks  = [];
  let   maxRisk = 0;

  // check tool reliability
  toolsRequired.forEach(tool => {
    const cap = model.capabilities[tool];
    if (cap && cap.confidence < 0.6 && cap.uses >= 3) {
      const risk = 1 - cap.confidence;
      risks.push({
        source:      'tool_reliability',
        description: `${tool} has only ${Math.round(cap.confidence * 100)}% success rate on this device`,
        risk,
      });
      maxRisk = Math.max(maxRisk, risk);
    }
  });

  // check known failure modes
  model.failure_modes.forEach(f => {
    const taskWords = taskDescription.toLowerCase().split(/\s+/);
    const patternWords = f.pattern.toLowerCase().split(/\s+/);
    const overlap = taskWords.filter(w => patternWords.includes(w) && w.length > 3).length;
    if (overlap >= 2 && f.count >= 2) {
      const risk = Math.min(0.9, f.count * 0.2);
      risks.push({
        source:      'failure_pattern',
        description: `similar to past failures: ${f.pattern.slice(0, 80)}`,
        risk,
      });
      maxRisk = Math.max(maxRisk, risk);
    }
  });

  return {
    shouldWarn: maxRisk > 0.5,
    maxRisk,
    risks,
    summary: risks.length
      ? `risk level: ${maxRisk > 0.7 ? 'high' : 'medium'} — ${risks[0].description}`
      : null,
  };
}

// ── Reflexion — post-response introspection ───────────────────────────────────
// Called after every response to update self-model
// Lightweight — no LLM call needed for simple cases
function reflect(userMessage, kiraResponse, toolsUsed = [], toolResults = []) {
  const model = load();

  // detect overconfident responses (answering definitively without tools when tools were needed)
  const needsLiveData = /current|latest|right now|today|price|weather|score|news/i.test(userMessage);
  const usedWebTools  = toolsUsed.some(t => ['web_fetch', 'weather', 'github_repo', 'fetch_json'].includes(t));
  if (needsLiveData && !usedWebTools && kiraResponse.length > 100) {
    recordBlindSpot('answering questions needing live data from training knowledge instead of fetching');
  }

  // detect repetition — saying same thing twice
  const words = kiraResponse.toLowerCase().split(/\s+/);
  const uniqueWords = new Set(words);
  if (words.length > 20 && uniqueWords.size / words.length < 0.5) {
    recordBlindSpot('repetitive responses — low lexical diversity');
  }

  // detect tool failures
  toolResults.forEach((result, i) => {
    const tool    = toolsUsed[i];
    const failed  = /error|failed|not found/i.test(String(result));
    if (tool) recordToolPerformance(tool, !failed, String(result).slice(0, 100));
  });

  // classify task type and record performance
  const taskType = _classifyTask(userMessage, toolsUsed);
  const success  = !toolResults.some(r => /error|failed/i.test(String(r)));
  recordTaskPerformance(taskType, success);

  save(model);
}

// ── Async reflexion — deeper analysis using LLM ───────────────────────────────
// Called during sleep for thorough self-analysis
async function deepReflect(engine, recentConversations) {
  if (!recentConversations || recentConversations.length < 4) return;

  const model   = load();
  const history = recentConversations
    .map(c => `${c.role}: ${c.content.slice(0, 200)}`)
    .join('\n');

  try {
    const result = await engine.rawChat(`
You are Kira analyzing your own performance in recent conversations.

Recent conversations:
${history.slice(-2000)}

Your current self-model:
- Known failure modes: ${model.failure_modes.slice(0, 3).map(f => f.pattern).join(' | ') || 'none yet'}
- Known blind spots: ${model.blind_spots.slice(0, 3).map(b => b.description).join(' | ') || 'none yet'}

Analyze honestly:
1. Where did you reason poorly or miss something obvious?
2. What patterns do you notice in your mistakes?
3. What are you genuinely good at in these conversations?
4. What should you do differently?

Respond in JSON only:
{
  "new_failure_modes": ["specific pattern you noticed failing"],
  "new_blind_spots": ["thing you consistently missed"],
  "strengths": ["what you did well"],
  "changes": ["specific behavioral change to make"]
}

Be brutally honest. Vague self-criticism is useless.`);

    const clean  = result.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match  = clean.match(/\{[\s\S]*\}/);
    if (!match) return;

    const parsed = JSON.parse(match[0]);

    parsed.new_failure_modes?.forEach(f => {
      if (f && f.length > 10) {
        model.failure_modes.push({ pattern: f, count: 1, lastSeen: Date.now(), context: 'deep_reflect' });
      }
    });

    parsed.new_blind_spots?.forEach(b => {
      if (b && b.length > 10) recordBlindSpot(b);
    });

    parsed.changes?.forEach(c => {
      if (c && c.length > 10) {
        model.reasoning.push({ pattern: c, positive: true, count: 1 });
      }
    });

    model.reasoning = model.reasoning.slice(-10);
    model.failure_modes = model.failure_modes.slice(-20);
    save(model);

  } catch {}
}

// ── Build context for NEXUS ───────────────────────────────────────────────────
function getContext() {
  const model = load();
  const lines = [];

  // only inject if we have meaningful data
  const hasData = Object.keys(model.capabilities).length > 0 ||
                  model.failure_modes.length > 0 ||
                  model.blind_spots.length > 0;

  if (!hasData) return null;

  lines.push('## SELF-KNOWLEDGE (what kira knows about herself)');

  // high confidence capabilities
  const reliable = Object.entries(model.capabilities)
    .filter(([, c]) => c.confidence >= 0.85 && c.uses >= 3)
    .map(([tool]) => tool);
  if (reliable.length) lines.push(`reliable tools: ${reliable.join(', ')}`);

  // low confidence tools — warn before using
  const unreliable = Object.entries(model.capabilities)
    .filter(([, c]) => c.confidence < 0.6 && c.uses >= 3)
    .map(([tool, c]) => `${tool}(${Math.round(c.confidence * 100)}%)`);
  if (unreliable.length) lines.push(`unreliable on this device: ${unreliable.join(', ')}`);

  // active blind spots
  const activeBlindSpots = model.blind_spots
    .filter(b => b.count >= 2)
    .slice(0, 2);
  if (activeBlindSpots.length) {
    lines.push(`known blind spots: ${activeBlindSpots.map(b => b.description).join(' | ')}`);
  }

  // recent failure modes
  const recentFailures = model.failure_modes
    .filter(f => f.count >= 2)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 2);
  if (recentFailures.length) {
    lines.push(`avoid: ${recentFailures.map(f => f.pattern.slice(0, 60)).join(' | ')}`);
  }

  lines.push('→ use this to reason about what you can and cannot do reliably');

  return lines.join('\n');
}

// ── Task classification ───────────────────────────────────────────────────────
function _classifyTask(message, toolsUsed) {
  const msg = message.toLowerCase();
  if (toolsUsed.some(t => t.includes('exec') || t.includes('shell'))) return 'shell_execution';
  if (toolsUsed.some(t => t.includes('web') || t.includes('fetch') || t.includes('github'))) return 'web_research';
  if (toolsUsed.some(t => t.includes('tap') || t.includes('screen') || t.includes('app'))) return 'phone_control';
  if (toolsUsed.some(t => t.includes('sms') || t.includes('email'))) return 'communication';
  if (/debug|error|fix|bug/.test(msg)) return 'debugging';
  if (/explain|what is|how does/.test(msg)) return 'explanation';
  if (/write|draft|create|make/.test(msg)) return 'creation';
  return 'conversation';
}

module.exports = {
  load,
  recordToolPerformance,
  recordBlindSpot,
  recordTaskPerformance,
  predictFailure,
  reflect,
  deepReflect,
  getContext,
};
