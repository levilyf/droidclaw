'use strict';
/**
 * KIRA_MIND — Unified Intelligence Database
 *
 * Pure JavaScript. No native modules. Works on Termux.
 * Same API as the SQLite version — everything else stays identical.
 *
 * Atomic JSON writes with in-memory cache + 2s batch saves.
 * One truth. All modules read and write here.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DIR = path.join(os.homedir(), '.droidclaw');

const FILES = {
  person:        path.join(DIR, 'mind_person.json'),
  memories:      path.join(DIR, 'mind_memories.json'),
  state:         path.join(DIR, 'mind_state.json'),
  tasks:         path.join(DIR, 'mind_tasks.json'),
  kira:          path.join(DIR, 'mind_kira.json'),
  conversations: path.join(DIR, 'mind_conversations.json'),
  routing:       path.join(DIR, 'mind_routing.json'),
};

const _cache = {};
let   _dirty = {};
let   _autoSaveTimer = null;

function _defaults(table) {
  switch (table) {
    case 'person':        return [];
    case 'memories':      return [];
    case 'state':         return {};
    case 'tasks':         return [];
    case 'kira':          return [];
    case 'conversations': return [];
    case 'routing':       return {
      REFLEX:   { profile: 'REFLEX',   success_rate: 1.0, uses: 0, wins: 0 },
      FAST:     { profile: 'FAST',     success_rate: 1.0, uses: 0, wins: 0 },
      BALANCED: { profile: 'BALANCED', success_rate: 1.0, uses: 0, wins: 0 },
      DEEP:     { profile: 'DEEP',     success_rate: 1.0, uses: 0, wins: 0 },
      GENTLE:   { profile: 'GENTLE',   success_rate: 1.0, uses: 0, wins: 0 },
      SHARP:    { profile: 'SHARP',    success_rate: 1.0, uses: 0, wins: 0 },
    };
    default: return {};
  }
}

function _load(table) {
  if (_cache[table]) return _cache[table];
  try { _cache[table] = JSON.parse(fs.readFileSync(FILES[table], 'utf8')); }
  catch (e) {
    console.error(`[mind] failed to load ${table}: ${e.message}, using defaults`);
    _cache[table] = _defaults(table);
  }
  return _cache[table];
}

function _save(table) {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILES[table] + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_cache[table]));
    fs.renameSync(tmp, FILES[table]);
  } catch (e) {
    console.error(`[mind] failed to save ${table}: ${e.message}`);
  }
}

function _markDirty(table) {
  _dirty[table] = true;
  if (!_autoSaveTimer) {
    _autoSaveTimer = setTimeout(() => {
      Object.keys(_dirty).forEach(_save);
      _dirty = {};
      _autoSaveTimer = null;
    }, 2000);
  }
}

function _flush() {
  if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  Object.keys(_dirty).forEach(_save);
  _dirty = {};
}

let _decayTimer = null;

function init() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  Object.keys(FILES).forEach(_load);

  // run memory decay every 30 minutes during session — not just at sleep
  if (!_decayTimer) {
    _decayTimer = setInterval(() => {
      decayMemories();
    }, 30 * 60 * 1000);
    _decayTimer.unref(); // don't keep process alive just for this
  }
}

// fake db() for soul.js lastSeen query
function db() {
  return {
    prepare: () => ({
      get: () => {
        const convs = _load('conversations')
          .filter(c => c.role === 'user')
          .sort((a, b) => b.created_at - a.created_at);
        return convs[0] || null;
      },
      all: () => [],
      run: () => {},
    }),
  };
}

// ── STATE ─────────────────────────────────────────────────────────────────────
function setState(key, value) {
  _load('state')[key] = { value, updated_at: Math.floor(Date.now() / 1000) };
  _markDirty('state');
}

function getState(key) {
  const s = _load('state')[key];
  return s ? s.value : null;
}

function getAllState() {
  const result = {};
  Object.entries(_load('state')).forEach(([k, v]) => { result[k] = v.value; });
  return result;
}

// ── PERSON ────────────────────────────────────────────────────────────────────
let _pid = Date.now();

function upsertBelief(dimension, value, options = {}) {
  const people = _load('person');
  const valKey = value.toLowerCase().slice(0, 40);
  const existing = people.find(p =>
    p.dimension === dimension && p.value.toLowerCase().slice(0, 40) === valKey && !p.contradicted
  );
  if (existing) {
    // Bayesian update: new_confidence = (prior * n + new_observation) / (n + 1)
    // where n = evidence count, prior = existing confidence, new = incoming confidence
    const n          = existing.evidence;
    const prior      = existing.confidence;
    const likelihood = options.confidence || 0.6;
    existing.confidence  = Math.min(0.95, (prior * n + likelihood) / (n + 1));
    existing.evidence++;
    existing.updated_at = Math.floor(Date.now() / 1000);
  } else {
    people.push({
      id:           _pid++,
      dimension,
      value:        value.slice(0, 200),
      confidence:   options.confidence || 0.5,
      evidence:     1,
      source:       options.source || 'conversation',
      created_at:   Math.floor(Date.now() / 1000),
      updated_at:   Math.floor(Date.now() / 1000),
      contradicted: false,
    });
  }
  _markDirty('person');
}

function contradictBelief(dimension, oldValue, newValue) {
  const people = _load('person');
  const old = people.find(p => p.dimension === dimension && p.value.toLowerCase().includes(oldValue.toLowerCase().slice(0, 30)));
  if (old) old.contradicted = true;
  _markDirty('person');
  upsertBelief(dimension, newValue, { confidence: 0.6, source: 'contradiction' });
}

function getBeliefs(dimension = null, minConfidence = 0.3) {
  const people = _load('person').filter(p => !p.contradicted && p.confidence >= minConfidence);
  if (dimension) return people.filter(p => p.dimension === dimension).sort((a, b) => b.confidence - a.confidence);
  return people.sort((a, b) => b.confidence - a.confidence);
}

// ── MEMORIES ──────────────────────────────────────────────────────────────────
function storeMemory(text, options = {}) {
  const mems = _load('memories');
  const id   = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const emo  = options.emotion || 0.3;
  mems.push({ id, text: text.slice(0, 600), emotion: emo, importance: options.importance || 0.5, strength: 0.3 + (emo * 0.4), tags: options.tags || [], theme: options.theme || null, activations: 0, created_at: Math.floor(Date.now() / 1000), last_touched: Math.floor(Date.now() / 1000) });
  if (mems.length > 500) mems.splice(0, mems.length - 500);
  _markDirty('memories');
  return id;
}

function retrieveMemories(query = '', limit = 7, emotionState = null) {
  const mems  = _load('memories');
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored = mems.map(m => {
    let score = m.strength * 0.4 + m.importance * 0.3 + m.emotion * 0.2;
    words.forEach(w => { if (m.text.toLowerCase().includes(w)) score += 0.12; });
    if (emotionState?.tension > 0.5 && m.emotion > 0.5) score += 0.15;
    return { ...m, _score: score };
  });
  const top = scored.sort((a, b) => b._score - a._score).slice(0, limit);
  const now  = Math.floor(Date.now() / 1000);
  top.forEach(t => {
    const orig = mems.find(x => x.id === t.id);
    if (!orig) return;
    orig.activations++;
    orig.last_touched = now;
    orig.strength = Math.min(2.0, orig.strength + 0.12 / (1 + Math.log1p(orig.activations * 0.5)));
  });
  _markDirty('memories');
  return top;
}

function decayMemories() {
  const mems = _load('memories');
  const now  = Math.floor(Date.now() / 1000);
  for (let i = mems.length - 1; i >= 0; i--) {
    const m = mems[i];
    const hours = (now - m.last_touched) / 3600;
    if (hours < 0.1) continue;
    const ns = Math.max(0, m.strength - 0.008 * hours * (m.emotion >= 0.65 ? 0.3 : 1.0));
    if (ns < 0.05 && m.emotion < 0.65) mems.splice(i, 1);
    else m.strength = ns;
  }
  _markDirty('memories');
}

// ── TASKS ─────────────────────────────────────────────────────────────────────
let _tid = 1;
function createTask(description, successCondition = null) {
  const tasks = _load('tasks');
  const id    = _tid++;
  tasks.push({ id, description, success_condition: successCondition, status: 'active', attempts: 0, last_result: null, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) });
  _markDirty('tasks');
  return id;
}
function updateTask(id, status, result = null) {
  const t = _load('tasks').find(x => x.id === id);
  if (!t) return;
  t.status = status; t.last_result = result; t.attempts++; t.updated_at = Math.floor(Date.now() / 1000);
  _markDirty('tasks');
}
function getActiveTask() {
  return _load('tasks').filter(t => t.status === 'active').sort((a, b) => b.created_at - a.created_at)[0] || null;
}
function getRecentTasks(limit = 5) {
  return _load('tasks').sort((a, b) => b.updated_at - a.updated_at).slice(0, limit);
}

// ── KIRA SELF ─────────────────────────────────────────────────────────────────
let _kid = 1;
function setKiraState(type, value, priority = 1) {
  const kira = _load('kira');
  kira.push({ id: _kid++, type, value, priority, resolved: false, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) });
  const ofType = kira.filter(k => k.type === type);
  if (ofType.length > 20) { const oldest = ofType[0].id; const idx = kira.findIndex(k => k.id === oldest); if (idx !== -1) kira.splice(idx, 1); }
  _markDirty('kira');
}
function getKiraState(type = null, includeResolved = false) {
  const kira = _load('kira').filter(k => includeResolved || !k.resolved);
  if (type) return kira.filter(k => k.type === type).sort((a, b) => b.priority - a.priority);
  return kira.sort((a, b) => b.priority - a.priority);
}
function resolveKira(id) {
  const k = _load('kira').find(x => x.id === id);
  if (k) { k.resolved = true; k.updated_at = Math.floor(Date.now() / 1000); }
  _markDirty('kira');
}
function setMood(mood) { setKiraState('mood', mood, 1); }
function getMood() {
  const moods = _load('kira').filter(k => k.type === 'mood').sort((a, b) => b.created_at - a.created_at);
  return moods[0]?.value || 'neutral';
}

// ── CONVERSATIONS ─────────────────────────────────────────────────────────────
let _sessionId = `session_${Date.now()}`;
function logConversation(role, content) {
  const convs = _load('conversations');
  convs.push({ id: convs.length + 1, role, content: content.slice(0, 5000), session_id: _sessionId, created_at: Math.floor(Date.now() / 1000) });
  if (convs.length > 500) convs.splice(0, convs.length - 500);
  _markDirty('conversations');
}
function getConversationHistory(sessionId = null, limit = 40) {
  const sid = sessionId || _sessionId;
  return _load('conversations').filter(c => c.session_id === sid).sort((a, b) => a.created_at - b.created_at).slice(-limit);
}
function getRecentConversations(sessions = 3) {
  const convs = _load('conversations');
  const sids  = [...new Set(convs.sort((a, b) => b.created_at - a.created_at).map(c => c.session_id))].slice(0, sessions);
  return convs.filter(c => sids.includes(c.session_id)).sort((a, b) => a.created_at - b.created_at);
}

// ── ROUTING ───────────────────────────────────────────────────────────────────
function updateRoutingWeight(profile, won) {
  const r = _load('routing')[profile];
  if (!r) return;
  r.uses++; r.wins += won ? 1 : 0;
  r.success_rate = Math.max(0.3, Math.min(1.5, r.success_rate * 0.85 + (r.wins / r.uses) * 0.15));
  _markDirty('routing');
}
function getRoutingWeights() { return _load('routing'); }

// ── SEARCH ────────────────────────────────────────────────────────────────────
function search(query, tables = ['memories', 'person']) {
  const results = {};
  const words   = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (!words.length) return results;
  if (tables.includes('memories')) results.memories = _load('memories').filter(m => words.some(w => m.text.toLowerCase().includes(w))).sort((a, b) => b.strength - a.strength).slice(0, 5);
  if (tables.includes('person'))   results.person   = _load('person').filter(p => !p.contradicted && words.some(w => p.value.toLowerCase().includes(w))).slice(0, 5);
  return results;
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function stats() {
  return {
    memories:     _load('memories').length,
    beliefs:      _load('person').filter(p => !p.contradicted).length,
    tasks_done:   _load('tasks').filter(t => t.status === 'done').length,
    tasks_failed: _load('tasks').filter(t => t.status === 'failed').length,
    conversations: _load('conversations').length,
    mood:         getMood(),
  };
}

// ── MIGRATION ─────────────────────────────────────────────────────────────────
function migrateFromJSON() {
  const somaBrain    = path.join(DIR, 'soma_brain.json');
  const somaEpisodic = path.join(DIR, 'soma_episodic.json');
  const emotionState = path.join(DIR, 'emotion_state.json');

  if (fs.existsSync(somaBrain)) {
    try {
      const brain = JSON.parse(fs.readFileSync(somaBrain, 'utf8'));
      const lpm   = brain.lpm || {};
      Object.entries(lpm).forEach(([dim, vals]) => {
        if (Array.isArray(vals)) vals.forEach(v => upsertBelief(dim, v, { confidence: 0.6, source: 'migration' }));
      });
    } catch {}
  }
  if (fs.existsSync(somaEpisodic)) {
    try {
      const cells = JSON.parse(fs.readFileSync(somaEpisodic, 'utf8'));
      cells.slice(-100).forEach(c => storeMemory(c.text || '', { emotion: c.emotion?.score || 0.3, importance: c.importance || 0.5, tags: c.tags || [] }));
    } catch {}
  }
  if (fs.existsSync(emotionState)) {
    try {
      const e = JSON.parse(fs.readFileSync(emotionState, 'utf8'));
      setState('emotion_tension', e.tension || 0);
      setState('emotion_connection', e.connection || 0.5);
      setState('emotion_focus', e.focus || 0.5);
      setState('emotion_energy', e.energy || 0.8);
    } catch {}
  }
  _flush();
}

process.on('exit',    _flush);
process.on('SIGINT',  () => { _flush(); process.exit(0); });
process.on('SIGTERM', () => { _flush(); process.exit(0); });

// ── OPERATIONAL STATE (replaces state.js) ─────────────────────────────────────
// Counters and session tracking — all stored in mind_state.json

function recordSuccess() {
  setState('consecutive_failures',  0);
  setState('consecutive_successes', (parseInt(getState('consecutive_successes') || 0)) + 1);
  setState('last_tool_success',     Date.now());
  setState('tasks_session',        (parseInt(getState('tasks_session') || 0)) + 1);
}

function recordFailure() {
  setState('consecutive_failures',  (parseInt(getState('consecutive_failures') || 0)) + 1);
  setState('consecutive_successes', 0);
}

function recordToolBuilt() {
  setState('tools_built_total', (parseInt(getState('tools_built_total') || 0)) + 1);
}

function incrementConversations() {
  const n = (parseInt(getState('total_conversations') || 0)) + 1;
  setState('total_conversations', n);
  return n;
}

function shouldReflect() {
  const total = parseInt(getState('total_conversations') || 0);
  const lastAt = getState('last_reflection_at');
  if (!lastAt) return total >= 10;
  const diff = Date.now() - lastAt;
  return (total % 10 === 0) && diff > 60000;
}

function markReflected() {
  setState('last_reflection_at', Date.now());
}

function getBehavioralNudge() {
  const failures  = parseInt(getState('consecutive_failures')  || 0);
  const successes = parseInt(getState('consecutive_successes') || 0);
  const session   = parseInt(getState('tasks_session')         || 0);

  if (failures  >= 3) return "you've hit friction multiple times. be honest about what's not working.";
  if (successes >= 5) return "things are flowing. you can be a bit warmer than usual.";
  if (session   >= 8) return "heavy session. keep answers tight.";
  return null;
}

function invalidate() {} // no-op — mind uses in-memory cache always fresh

module.exports = {
  init, db,
  setState, getState, getAllState,
  upsertBelief, contradictBelief, getBeliefs,
  storeMemory, retrieveMemories, decayMemories,
  createTask, updateTask, getActiveTask, getRecentTasks,
  setKiraState, getKiraState, resolveKira, setMood, getMood,
  logConversation, getConversationHistory, getRecentConversations,
  updateRoutingWeight, getRoutingWeights,
  search, stats, migrateFromJSON,
  // operational state (replaces state.js)
  recordSuccess, recordFailure, recordToolBuilt,
  incrementConversations, shouldReflect, markReflected,
  getBehavioralNudge, invalidate,
  flush: _flush,
  get sessionId() { return _sessionId; },
};
