'use strict';
/**
 * IRIS — Intuitive Routing via Identity Synthesis
 * 
 * Routes every message to the optimal response strategy
 * based on WHO is asking, not just WHAT they're asking.
 * 
 * Requires SOMA to be meaningful. Gets smarter over time.
 * 
 * Nobody else has this because nobody else has SOMA.
 */

const fs = require('fs');
const os = require('os');

const IRIS_FILE = os.homedir() + '/.droidclaw/iris_patterns.json';

// ─── Response Profiles ────────────────────────────────────────────────────────
// Each profile defines how Kira should respond
const PROFILES = {

  REFLEX: {
    name:        'reflex',
    maxTokens:   256,
    temp:        0.3,
    style:       'instant. one line. no explanation.',
    depth:       'surface',
    description: 'instant pattern-matched response, no deep thinking'
  },

  FAST: {
    name:        'fast',
    maxTokens:   512,
    temp:        0.5,
    style:       'direct. 2-3 lines max. action-oriented.',
    depth:       'shallow',
    description: 'quick helpful response for simple queries'
  },

  BALANCED: {
    name:        'balanced',
    maxTokens:   1024,
    temp:        0.7,
    style:       'clear and complete. as long as needed, no longer.',
    depth:       'medium',
    description: 'standard thoughtful response'
  },

  DEEP: {
    name:        'deep',
    maxTokens:   2048,
    temp:        0.8,
    style:       'thorough. explore the full space. think out loud if needed.',
    depth:       'full',
    description: 'complex reasoning, emotional topics, multi-step tasks'
  },

  GENTLE: {
    name:        'gentle',
    maxTokens:   768,
    temp:        0.9,
    style:       'warm. present. no rushing. space between words.',
    depth:       'emotional',
    description: 'high tension detected — soften, slow down, be present'
  },

  SHARP: {
    name:        'sharp',
    maxTokens:   384,
    temp:        0.4,
    style:       'precise. technical. no filler. correct above all.',
    depth:       'technical',
    description: 'debugging, code, facts — accuracy over warmth'
  }

};

// ─── Query Classifiers ────────────────────────────────────────────────────────

function classifyQuery(message) {
  const text = message.toLowerCase().trim();
  const len  = text.length;

  // reflex patterns — instant, no thinking needed
  const reflexPatterns = [
    /^(hey|hi|hello|yo|sup|ok|okay|sure|yes|no|thanks|thx|k|lol|haha|nice)$/,
    /^(open|launch|start) \w+$/,
    /^(tap|click|press|scroll) .{0,30}$/,
    /^(what time|what's the time|time now)/,
    /^(notifications|notifs|check notifs)$/,
  ];
  if (reflexPatterns.some(p => p.test(text)) || len < 15) return 'REFLEX';

  // technical patterns — sharp mode
  const techPatterns = [
    /\b(error|bug|fix|debug|code|script|install|npm|node|bash|command|terminal)\b/,
    /\b(api|endpoint|json|http|curl|git|push|pull|commit)\b/,
    /\b(how to|how do i|how does)\b.*\b(work|install|run|build|fix)\b/,
  ];
  if (techPatterns.some(p => p.test(text))) return 'SHARP';

  // emotional patterns — gentle mode check (combined with tension)
  const emotionalPatterns = [
    /\b(feel|feeling|felt|scared|worried|sad|lonely|angry|hurt|pain|tired|exhausted)\b/,
    /\b(why does|why do i|why am i|what's wrong with|what's happening)\b/,
    /\b(help me|i need|i'm struggling|can't take|don't know what)\b/,
  ];
  if (emotionalPatterns.some(p => p.test(text))) return 'GENTLE_CANDIDATE';

  // deep patterns — complex reasoning needed
  const deepPatterns = [
    /\b(explain|analyze|compare|evaluate|design|architect|strategy|plan)\b/,
    /\b(what do you think|what should i|how should i|what would you)\b/,
    /\b(pros and cons|trade.?off|decision|choose between)\b/,
  ];
  if (deepPatterns.some(p => p.test(text)) || len > 150) return 'DEEP';

  // fast patterns — simple but need a real answer
  if (len < 60) return 'FAST';

  return 'BALANCED';
}

// ─── Core Routing Logic ───────────────────────────────────────────────────────

function route(message, emotionState, lpm) {
  const baseProfile = classifyQuery(message);
  const emotion     = emotionState || { tension: 0, energy: 0.8, connection: 0.5, focus: 0.5 };

  let finalProfile  = baseProfile;

  // SOMA-guided overrides — person-state matching

  // high tension → gentler regardless of query type
  if (emotion.tension > 0.6 && baseProfile !== 'SHARP' && baseProfile !== 'REFLEX') {
    finalProfile = 'GENTLE';
  }

  // GENTLE_CANDIDATE + any tension = GENTLE
  if (baseProfile === 'GENTLE_CANDIDATE') {
    finalProfile = emotion.tension > 0.2 ? 'GENTLE' : 'BALANCED';
  }

  // exhausted + night → shorter responses
  if (emotion.energy < 0.3 && finalProfile === 'DEEP') {
    finalProfile = 'BALANCED';
  }

  // deep focus mode → allow full depth
  if (emotion.focus > 0.7 && finalProfile === 'BALANCED') {
    finalProfile = 'DEEP';
  }

  // high connection → more warmth even in technical responses
  const warmthBoost = emotion.connection > 0.7;

  // LPM-based overrides — learned personal patterns
  if (lpm) {
    // if user's pattern shows they prefer brevity
    const prefersShort = lpm.patterns && lpm.patterns.some(p =>
      p.toLowerCase().includes('brief') ||
      p.toLowerCase().includes('short') ||
      p.toLowerCase().includes('direct')
    );
    if (prefersShort && finalProfile === 'DEEP') finalProfile = 'BALANCED';

    // if user's pattern shows they need depth
    const prefersDepth = lpm.patterns && lpm.patterns.some(p =>
      p.toLowerCase().includes('detail') ||
      p.toLowerCase().includes('thorough') ||
      p.toLowerCase().includes('explain')
    );
    if (prefersDepth && finalProfile === 'FAST') finalProfile = 'BALANCED';

    // check foresight — if we predicted they'd need something now
    if (lpm.foresight && lpm.foresight.length) {
      const msgLower = message.toLowerCase();
      const foresightMatch = lpm.foresight.some(f =>
        f.toLowerCase().split(' ').filter(w => w.length > 4)
          .some(w => msgLower.includes(w))
      );
      if (foresightMatch && finalProfile !== 'GENTLE') {
        // foresight matched — we predicted this. use balanced minimum.
        if (['REFLEX', 'FAST'].includes(finalProfile)) finalProfile = 'BALANCED';
      }
    }
  }

  const profile = PROFILES[finalProfile] || PROFILES.BALANCED;

  // learn this routing decision
  recordDecision(message, finalProfile, emotionState);

  return {
    profile,
    warmthBoost,
    reasoning: buildReasoning(finalProfile, emotion, lpm),
    styleInjection: buildStyleInjection(profile, warmthBoost)
  };
}

// ─── Style Injection ──────────────────────────────────────────────────────────
// Injects routing decision into soul prompt

function buildStyleInjection(profile, warmthBoost) {
  const lines = [`## IRIS ROUTING: ${profile.name.toUpperCase()}`];
  lines.push(`Response style: ${profile.style}`);
  if (warmthBoost) lines.push('Connection is high — let warmth through naturally.');
  lines.push(`Max depth: ${profile.depth}`);
  return lines.join('\n');
}

function buildReasoning(profile, emotion, lpm) {
  const parts = [];
  if (emotion.tension > 0.6) parts.push('tension high');
  if (emotion.energy < 0.3)  parts.push('low energy');
  if (emotion.focus > 0.7)   parts.push('deep focus');
  if (lpm && lpm.patterns && lpm.patterns.length) parts.push('LPM active');
  return `${profile} (${parts.join(', ') || 'baseline'})`;
}

// ─── Learning ─────────────────────────────────────────────────────────────────

function recordDecision(message, profile, emotionState) {
  try {
    const data = loadPatterns();
    data.decisions = data.decisions || [];
    data.decisions.push({
      timestamp:   Date.now(),
      msgLength:   message.length,
      profile,
      tension:     emotionState?.tension || 0,
      energy:      emotionState?.energy  || 0.8,
      focus:       emotionState?.focus   || 0.5,
    });
    // keep last 200 decisions for pattern analysis
    data.decisions = data.decisions.slice(-200);
    data.totalRouted = (data.totalRouted || 0) + 1;
    savePatterns(data);
  } catch {}
}

function getStats() {
  const data = loadPatterns();
  const decisions = data.decisions || [];
  if (!decisions.length) return 'no routing data yet';

  const counts = {};
  decisions.forEach(d => { counts[d.profile] = (counts[d.profile] || 0) + 1; });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${p}: ${c} (${Math.round(c/decisions.length*100)}%)`)
    .join(' | ');
}

function loadPatterns() {
  try { return JSON.parse(fs.readFileSync(IRIS_FILE, 'utf8')); }
  catch { return { decisions: [], totalRouted: 0 }; }
}

function savePatterns(data) {
  try { fs.writeFileSync(IRIS_FILE, JSON.stringify(data, null, 2)); }
  catch {}
}

module.exports = { route, getStats, PROFILES };
