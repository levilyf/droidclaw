'use strict';
/**
 * WORLD MODEL LOOP — Closed Feedback Architecture
 *
 * Every action Kira takes has a consequence.
 * This module observes those consequences and updates
 * Kira's internal world model.
 *
 * Before acting: predict what will happen
 * After acting:  compare prediction to reality
 * Delta:         the learning signal
 *
 * Over time Kira builds an accurate model of YOUR specific
 * device — not generic Android, your phone.
 */

'use strict';

const mind = require('./core/mind');

// ── Action prediction ─────────────────────────────────────────────────────────
// Before executing a tool, predict what will happen
function predict(toolName, args) {
  const known = mind.search(`${toolName} consequence`, ['memories']);
  const predictions = (known.memories || [])
    .filter(m => m.text.includes(toolName))
    .slice(0, 3)
    .map(m => m.text);

  const prediction = {
    tool:        toolName,
    args,
    expected:    predictions[0] || null, // most recent known outcome
    confidence:  predictions.length > 0 ? Math.min(0.9, predictions.length * 0.25) : 0.1,
    predictedAt: Date.now(),
  };

  // store pending prediction
  mind.setState(`wm_pending_prediction`, JSON.stringify(prediction));
  return prediction;
}

// ── Observe consequence ───────────────────────────────────────────────────────
// After a tool executes, compare result to prediction
function observe(toolName, args, result) {
  const now    = Date.now();
  const raw    = mind.getState('wm_pending_prediction');
  const pending = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;

  // calculate prediction accuracy
  let accuracy = null;
  let surprise = false;

  if (pending && pending.tool === toolName) {
    const timeDelta = now - pending.predictedAt;

    if (pending.expected) {
      // check if result matches expectation
      const expectedWords = pending.expected.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const resultWords   = String(result).toLowerCase().split(/\s+/);
      const matches       = expectedWords.filter(w => resultWords.includes(w)).length;
      accuracy = Math.min(1.0, matches / Math.max(1, expectedWords.length));
      surprise = accuracy < 0.3;
    }
  }

  // build consequence record
  const consequence = {
    tool:     toolName,
    args:     JSON.stringify(args).slice(0, 200),
    result:   String(result).slice(0, 500),
    success:  !String(result).toLowerCase().match(/\berror\b|\bfailed\b|\bnot found\b/),
    accuracy,
    surprise,
    ts:       now,
  };

  // store in KIRA_MIND as a memory
  const memText = `[world model] ${toolName}: ${consequence.success ? 'succeeded' : 'failed'} — ${String(result).slice(0, 150)}`;
  mind.storeMemory(memText, {
    importance: surprise ? 0.8 : 0.5, // surprising outcomes are more important
    emotion:    surprise ? 0.6 : 0.3,
    tags:       ['world_model', toolName, consequence.success ? 'success' : 'failure'],
    theme:      'device_behavior',
  });

  // update world model state
  _updateDeviceModel(toolName, consequence);

  // clear pending prediction
  mind.setState('wm_pending_prediction', null);

  // if surprising — flag for Kira's attention
  if (surprise) {
    mind.setKiraState('observation',
      `unexpected result from ${toolName}: expected something like "${pending?.expected?.slice(0, 80)}" but got "${String(result).slice(0, 80)}"`,
      2
    );
  }

  return consequence;
}

// ── Update device-specific model ──────────────────────────────────────────────
// Builds understanding of how THIS specific phone behaves
function _updateDeviceModel(toolName, consequence) {
  try {
    const key     = `wm_tool_${toolName}`;
    const raw     = mind.getState(key);
    const current = raw ? JSON.parse(raw) : { uses: 0, successes: 0, failures: 0, lastResult: null, patterns: [] };

    current.uses++;
    if (consequence.success) current.successes++;
    else current.failures++;
    current.lastResult   = consequence.result.slice(0, 200);
    current.successRate  = current.successes / current.uses;
    current.lastUsed     = consequence.ts;

    // detect patterns — if same tool fails 3x in a row, flag it
    current.patterns = current.patterns || [];
    current.patterns.push(consequence.success ? 1 : 0);
    current.patterns = current.patterns.slice(-10); // keep last 10

    const recentFailures = current.patterns.slice(-3).filter(p => p === 0).length;
    if (recentFailures >= 3) {
      mind.setKiraState('observation',
        `${toolName} has failed 3 times in a row — may need a different approach`,
        3
      );
    }

    mind.setState(key, JSON.stringify(current));
  } catch {}
}

// ── Get world model context for NEXUS ────────────────────────────────────────
// Injects device behavior knowledge into the prompt
function getContext() {
  const lines = [];

  // get all tool models
  const state   = mind.getAllState();
  const toolKeys = Object.keys(state).filter(k => k.startsWith('wm_tool_'));

  if (!toolKeys.length) return null;

  const toolModels = toolKeys.map(k => {
    try {
      const data = typeof state[k] === 'string' ? JSON.parse(state[k]) : state[k];
      return { tool: k.replace('wm_tool_', ''), ...data };
    } catch { return null; }
  }).filter(Boolean);

  // only show tools with enough data
  const meaningful = toolModels.filter(t => t.uses >= 2);
  if (!meaningful.length) return null;

  lines.push('## DEVICE BEHAVIOR (learned from experience)');

  // highlight tools with low success rates
  const struggling = meaningful.filter(t => t.successRate < 0.6 && t.uses >= 3);
  if (struggling.length) {
    lines.push('tools that often fail on this device:');
    struggling.forEach(t => {
      lines.push(`  - ${t.tool}: ${Math.round(t.successRate * 100)}% success rate`);
    });
  }

  // highlight reliable tools
  const reliable = meaningful.filter(t => t.successRate >= 0.9 && t.uses >= 3);
  if (reliable.length) {
    lines.push(`reliable: ${reliable.map(t => t.tool).join(', ')}`);
  }

  lines.push('→ use this to choose approaches that work on this specific device');

  return lines.join('\n');
}

// ── Wrap registry to add observation ─────────────────────────────────────────
// Patches the tool registry to automatically observe consequences
function patchRegistry(registry) {
  const originalExecute = registry.execute.bind(registry);

  registry.execute = async function(name, args) {
    // predict before executing
    predict(name, args);

    // execute
    let result;
    try {
      result = await originalExecute(name, args);
    } catch (e) {
      result = `error: ${e.message}`;
    }

    // observe consequence
    observe(name, args, result);

    return result;
  };
}

module.exports = { predict, observe, getContext, patchRegistry };
