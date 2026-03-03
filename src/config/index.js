'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_DIR  = path.join(os.homedir(), '.droidclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  name:            'User',
  apiKey:          '',
  baseUrl:         'https://api.openai.com/v1',
  model:           'gpt-4o-mini',
  setupDone:       false,
  device:          'Android',
  hasTermuxApi:    false,
  telegramToken:   '',
  telegramAllowed: [],
};

let _cache = null;

function ensure() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function load() {
  if (_cache) return _cache;
  ensure();
  if (!fs.existsSync(CONFIG_FILE)) { _cache = { ...DEFAULTS }; return _cache; }
  try { _cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { _cache = { ...DEFAULTS }; }
  return _cache;
}

function save(data) {
  ensure();
  // Validate required fields
  if (typeof data !== 'object' || !data) return;
  const valid = { ...DEFAULTS, ...data };
  _cache = valid;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(valid, null, 2));
}

function get(key) { return load()[key]; }

function set(key, value) {
  const c = load();
  c[key]  = value;
  _cache  = c;
  save(c);
}

function invalidate() { _cache = null; }

module.exports = { load, save, get, set, invalidate, CONFIG_DIR, CONFIG_FILE, DEFAULTS };
