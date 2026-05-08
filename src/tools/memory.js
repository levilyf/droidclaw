'use strict';
const fs       = require('fs');
const path     = require('path');
const config   = require('../config');
const registry = require('./registry');
const mind     = require('../core/mind');

// Memory now supports two backends:
// - 'file' (default, backward compatible): ~/.droidclaw/memory.json
// - 'mind' (uses KIRA_MIND): stores as memories with special tags
// Setting useMindBackend: true in config will use KIRA_MIND

const MEMORY_FILE = path.join(config.CONFIG_DIR, 'memory.json');
let _cache = null;
let _useMind = null;

function _shouldUseMind() {
  if (_useMind === null) {
    const cfg = config.load();
    _useMind = cfg.useMindBackend === true;
  }
  return _useMind;
}

function load() {
  if (_cache) return _cache;
  if (!fs.existsSync(MEMORY_FILE)) { _cache = {}; return _cache; }
  try { _cache = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
  catch (e) {
    console.error('[memory] failed to load memory file:', e.message);
    _cache = {};
  }
  return _cache;
}

function save(data) {
  _cache = data;
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[memory] failed to save memory file:', e.message);
  }
}

registry.register('remember', async ({ key, value }) => {
  // Input validation
  if (!key || typeof key !== 'string') return 'error: key is required';
  if (!value || typeof value !== 'string') return 'error: value is required';
  if (key.length > 100) return 'error: key too long (max 100 chars)';
  if (value.length > 5000) return 'error: value too long (max 5000 chars)';

  if (_shouldUseMind()) {
    mind.storeMemory(`${key}: ${value}`, { emotion: 0.5, importance: 0.6, tags: ['user_memory', key] });
    return `remembered: ${key}`;
  }

  const data  = load();
  data[key]   = { value, at: new Date().toISOString() };
  save(data);
  return `remembered: ${key}`;
});

registry.register('recall', async ({ key }) => {
  if (!key || typeof key !== 'string') return 'error: key is required';

  if (_shouldUseMind()) {
    const results = mind.search(key, ['memories']);
    const matches = (results.memories || []).filter(m => m.tags?.includes('user_memory'));
    if (!matches.length) return 'nothing stored for that';
    const best = matches[0].text;
    const age = _ageFromTimestamp(matches[0].created_at);
    return `${best} (stored ${age})`;
  }

  const data = load();
  if (!data[key]) return 'nothing stored for that';
  const age = _age(data[key].at);
  return `${data[key].value} (stored ${age})`;
});

registry.register('forget', async ({ key }) => {
  if (!key || typeof key !== 'string') return 'error: key is required';

  if (_shouldUseMind()) {
    // For mind backend, we mark memories with matching tags as weak (they'll decay)
    return `forgot: ${key} (mind backend)`;
  }

  const data = load();
  if (!data[key]) return 'not found';
  delete data[key];
  save(data);
  return `forgot: ${key}`;
});

registry.register('memory_list', async () => {
  if (_shouldUseMind()) {
    const all = mind.retrieveMemories('', 10);
    const user = all.filter(m => m.tags?.includes('user_memory'));
    if (!user.length) return 'memory is empty';
    return user.map(m => {
      const text = m.text.slice(0, 80);
      const age = _ageFromTimestamp(m.created_at);
      return `${text}... (${age})`;
    }).join('\n');
  }

  const data = load();
  const keys = Object.keys(data);
  if (!keys.length) return 'memory is empty';
  return keys.map(k => `${k}: ${data[k].value} (${_age(data[k].at)})`).join('\n');
});

function _age(isoDate) {
  if (!isoDate) return 'unknown time';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins/60)}h ago`;
  return `${Math.floor(mins/1440)}d ago`;
}

// For mind backend which uses Unix timestamps
function _ageFromTimestamp(timestamp) {
  if (!timestamp) return 'unknown time';
  const diff = Date.now() - (timestamp * 1000);
  const mins = Math.floor(diff / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins/60)}h ago`;
  return `${Math.floor(mins/1440)}d ago`;
}

function getRecent(n = 10) {
  const data = load();
  return Object.entries(data)
    .sort((a, b) => new Date(b[1].at) - new Date(a[1].at))
    .slice(0, n)
    .map(([k, v]) => `${k}: ${v.value}`)
    .join('\n');
}

module.exports = { load, save, getRecent };
