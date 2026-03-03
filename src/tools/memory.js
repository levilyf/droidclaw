'use strict';
const fs       = require('fs');
const path     = require('path');
const config   = require('../config');
const registry = require('./registry');

const MEMORY_FILE = path.join(config.CONFIG_DIR, 'memory.json');
let _cache = null;

function load() {
  if (_cache) return _cache;
  if (!fs.existsSync(MEMORY_FILE)) { _cache = {}; return _cache; }
  try { _cache = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
  catch { _cache = {}; }
  return _cache;
}

function save(data) {
  _cache = data;
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

registry.register('remember', async ({ key, value }) => {
  const data  = load();
  data[key]   = { value, at: new Date().toISOString() };
  save(data);
  return `remembered: ${key}`;
});

registry.register('recall', async ({ key }) => {
  const data = load();
  if (!data[key]) return 'nothing stored for that';
  const age = _age(data[key].at);
  return `${data[key].value} (stored ${age})`;
});

registry.register('forget', async ({ key }) => {
  const data = load();
  if (!data[key]) return 'not found';
  delete data[key];
  save(data);
  return `forgot: ${key}`;
});

registry.register('memory_list', async () => {
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

function getRecent(n = 10) {
  const data = load();
  return Object.entries(data)
    .sort((a, b) => new Date(b[1].at) - new Date(a[1].at))
    .slice(0, n)
    .map(([k, v]) => `${k}: ${v.value}`)
    .join('\n');
}

module.exports = { load, save, getRecent };
