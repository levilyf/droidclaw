'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const STATE_FILE = path.join(os.homedir(), '.droidclaw', 'state.json');

const DEFAULTS = {
  // Emotion signals — events not labels
  consecutiveFailures:  0,
  consecutiveSuccesses: 0,
  lastToolSuccess:      null,
  toolsBuiltTotal:      0,
  toolsBuiltToday:      0,
  tasksCompletedSession: 0,
  lastToolBuiltAt:      null,

  // Goals
  goals: [],

  // World model
  world: {
    city:     null,
    timezone: null,
    schedule: null,
    people:   [],
    notes:    [],
  },

  // Session meta
  totalConversations: 0,
  lastReflectionAt:   null,
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  if (!fs.existsSync(STATE_FILE)) { _cache = { ...DEFAULTS }; return _cache; }
  try { _cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
  catch { _cache = { ...DEFAULTS }; }
  return _cache;
}

function save(data) {
  const dir = path.join(os.homedir(), '.droidclaw');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _cache = data;
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

function get(key) { return load()[key]; }

function set(key, value) {
  const s  = load();
  s[key]   = value;
  save(s);
}

function recordSuccess() {
  const s = load();
  s.consecutiveFailures  = 0;
  s.consecutiveSuccesses = (s.consecutiveSuccesses || 0) + 1;
  s.lastToolSuccess      = new Date().toISOString();
  s.tasksCompletedSession = (s.tasksCompletedSession || 0) + 1;
  save(s);
}

function recordFailure() {
  const s = load();
  s.consecutiveFailures  = (s.consecutiveFailures || 0) + 1;
  s.consecutiveSuccesses = 0;
  save(s);
}

function recordToolBuilt() {
  const s    = load();
  const today = new Date().toDateString();
  const lastDay = s.lastToolBuiltAt ? new Date(s.lastToolBuiltAt).toDateString() : null;
  s.toolsBuiltTotal = (s.toolsBuiltTotal || 0) + 1;
  s.toolsBuiltToday = lastDay === today ? (s.toolsBuiltToday || 0) + 1 : 1;
  s.lastToolBuiltAt = new Date().toISOString();
  save(s);
}

function incrementConversations() {
  const s = load();
  s.totalConversations = (s.totalConversations || 0) + 1;
  s.tasksCompletedSession = (s.tasksCompletedSession || 0) + 1;
  save(s);
  return s.totalConversations;
}

function shouldReflect() {
  const s = load();
  if (!s.lastReflectionAt) return s.totalConversations >= 10;
  const last = new Date(s.lastReflectionAt);
  const diff = Date.now() - last.getTime();
  const convsSince = s.totalConversations % 10;
  return convsSince === 0 && diff > 60000; // every 10 convos, min 1 min gap
}

function markReflected() {
  set('lastReflectionAt', new Date().toISOString());
}

// Translate event signals into behavioral nudge — one line max
function getBehavioralNudge() {
  const s = load();
  const nudges = [];

  if (s.consecutiveFailures >= 3) {
    nudges.push('you\'ve hit friction multiple times. be honest about what\'s not working.');
  }
  if (s.consecutiveSuccesses >= 5) {
    nudges.push('things are flowing. you can be a bit warmer than usual.');
  }
  if (s.toolsBuiltToday >= 2) {
    nudges.push('you\'ve been building today. you\'re in an expansive mode.');
  }
  if (s.tasksCompletedSession >= 8) {
    nudges.push('heavy session. keep answers tight, levi\'s been working hard.');
  }
  if (s.lastToolBuiltAt) {
    const mins = Math.floor((Date.now() - new Date(s.lastToolBuiltAt)) / 60000);
    if (mins < 30) nudges.push('you just expanded your capabilities. you know more than you did an hour ago.');
  }

  return nudges.length ? nudges[0] : null; // one nudge at a time
}

// Add/update/complete goals
function addGoal(text) {
  const s = load();
  s.goals = s.goals || [];
  s.goals.push({ text, createdAt: new Date().toISOString(), done: false });
  save(s);
}

function completeGoal(text) {
  const s = load();
  s.goals = (s.goals || []).map(g =>
    g.text.toLowerCase().includes(text.toLowerCase()) ? { ...g, done: true, completedAt: new Date().toISOString() } : g
  );
  save(s);
}

function getActiveGoals() {
  const s = load();
  return (s.goals || []).filter(g => !g.done);
}

function invalidate() { _cache = null; }

module.exports = {
  load, save, get, set,
  recordSuccess, recordFailure, recordToolBuilt,
  incrementConversations, shouldReflect, markReflected,
  getBehavioralNudge,
  addGoal, completeGoal, getActiveGoals,
  invalidate,
};
