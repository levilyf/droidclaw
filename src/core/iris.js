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
    maxTokens:   512,
    temp:        0.3,
    style:       'instant. one line. no explanation. always respond with something.',
    depth:       'surface',
    description: 'instant pattern-matched response, no deep thinking'
  },

  FAST: {
    name:        'fast',
    maxTokens:   768,
    temp:        0.5,
    style:       'direct. 2-3 lines max. action-oriented.',
    depth:       'shallow',
    description: 'quick helpful response for simple queries'
  },

  BALANCED: {
    name:        'balanced',
    maxTokens:   2048,
    temp:        0.7,
    style:       'clear and complete. as long as needed, no longer.',
    depth:       'medium',
    description: 'standard thoughtful response'
  },

  DEEP: {
    name:        'deep',
    maxTokens:   4096,
    temp:        0.8,
    style:       'thorough. explore the full space. think out loud if needed.',
    depth:       'full',
    description: 'complex reasoning, emotional topics, multi-step tasks'
  },

  GENTLE: {
    name:        'gentle',
    maxTokens:   2048,
    temp:        0.9,
    style:       'warm. present. no rushing. space between words.',
    depth:       'emotional',
    description: 'high tension detected — soften, slow down, be present'
  },

  SHARP: {
    name:        'sharp',
    maxTokens:   1024,
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
  const data        = loadPatterns();

  let finalProfile  = baseProfile;

  // ── Learn from history — what profiles actually worked at this hour/tension ─
  const hour      = new Date().getHours();
  const msgLen    = message.length;
  const decisions = data.decisions || [];

  if (decisions.length >= 20) {
    // find similar past contexts: same hour ±2, similar tension ±0.15, similar msg length bucket
    const lenBucket = msgLen < 20 ? 'short' : msgLen < 100 ? 'medium' : 'long';
    const similar   = decisions.filter(d => {
      const hourMatch    = Math.abs((d.hour || 0) - hour) <= 2;
      const tensionMatch = Math.abs((d.tension || 0) - emotion.tension) <= 0.15;
      const lenMatch     = d.lenBucket === lenBucket;
      return hourMatch && tensionMatch && lenMatch && d.outcome;
    });

    if (similar.length >= 5) {
      // count which profiles had positive outcomes in similar contexts
      const profileScores = {};
      similar.forEach(d => {
        if (!profileScores[d.profile]) profileScores[d.profile] = { wins: 0, total: 0 };
        profileScores[d.profile].total++;
        if (d.outcome === 'positive') profileScores[d.profile].wins++;
      });

      // find profile with highest win rate (min 3 samples)
      let bestProfile = null;
      let bestRate    = 0;
      Object.entries(profileScores).forEach(([p, s]) => {
        if (s.total >= 3) {
          const rate = s.wins / s.total;
          if (rate > bestRate && rate > 0.55) { bestRate = rate; bestProfile = p; }
        }
      });

      // override base classification if history strongly suggests something better
      if (bestProfile && bestProfile !== finalProfile) {
        // only override if it's a lateral move — don't override GENTLE when tension is high
        const isTensionOverride = emotion.tension > 0.5 && bestProfile !== 'GENTLE';
        if (!isTensionOverride) finalProfile = bestProfile;
      }
    }
  }

  // ── Fixed overrides — these always apply regardless of history ──────────────
  if (emotion.tension > 0.6 && !['SHARP', 'REFLEX'].includes(finalProfile)) finalProfile = 'GENTLE';
  if (baseProfile === 'GENTLE_CANDIDATE') finalProfile = emotion.tension > 0.2 ? 'GENTLE' : 'BALANCED';
  if (emotion.energy < 0.3 && finalProfile === 'DEEP') finalProfile = 'BALANCED';
  if (emotion.focus > 0.7 && finalProfile === 'BALANCED') finalProfile = 'DEEP';

  const warmthBoost = emotion.connection > 0.7;

  // ── LPM-based overrides ────────────────────────────────────────────────────
  if (lpm) {
    const prefersShort = lpm.patterns?.some(p =>
      /brief|short|direct|concise|terse/.test(p.toLowerCase())
    );
    if (prefersShort && finalProfile === 'DEEP') finalProfile = 'BALANCED';

    const prefersDepth = lpm.patterns?.some(p =>
      /detail|thorough|explain|depth|comprehensive/.test(p.toLowerCase())
    );
    if (prefersDepth && finalProfile === 'FAST') finalProfile = 'BALANCED';
  }

  const profile = PROFILES[finalProfile] || PROFILES.BALANCED;

  recordDecision(message, finalProfile, emotionState, hour, msgLen);

  return {
    profile,
    warmthBoost,
    reasoning: buildReasoning(finalProfile, emotion, lpm),
    styleInjection: buildStyleInjection(profile, warmthBoost),
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

function recordDecision(message, profile, emotionState, hour, msgLen) {
  try {
    const data    = loadPatterns();
    const lenBucket = msgLen < 20 ? 'short' : msgLen < 100 ? 'medium' : 'long';
    data.decisions = data.decisions || [];
    data.decisions.push({
      id:        Date.now(),
      timestamp: Date.now(),
      hour:      hour || new Date().getHours(),
      lenBucket,
      msgLength: message.length,
      profile,
      tension:   emotionState?.tension  || 0,
      energy:    emotionState?.energy   || 0.8,
      focus:     emotionState?.focus    || 0.5,
      outcome:   null, // filled in by recordOutcome()
    });
    data.decisions = data.decisions.slice(-300);
    data.totalRouted = (data.totalRouted || 0) + 1;
    savePatterns(data);
  } catch (e) { console.error('[iris] failed to record decision:', e.message); }
}

// call this after a response — 'positive' if user continued naturally, 'negative' if they pushed back
function recordOutcome(outcome) {
  try {
    const data      = loadPatterns();
    const decisions = data.decisions || [];
    // find most recent decision without an outcome
    const last = [...decisions].reverse().find(d => d.outcome === null);
    if (last) {
      last.outcome = outcome; // 'positive' | 'negative' | 'neutral'
      savePatterns(data);
    }
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
  catch (e) {
    console.error('[iris] failed to load patterns:', e.message);
    return { decisions: [], totalRouted: 0 };
  }
}

function savePatterns(data) {
  try { fs.writeFileSync(IRIS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[iris] failed to save patterns:', e.message); }
}

module.exports = { route, getStats, recordOutcome, PROFILES };
