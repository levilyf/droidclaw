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
  useMindBackend:  false,  // if true, memory tool uses KIRA_MIND instead of separate file
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

  // Input validation and sanitization
  const valid = { ...DEFAULTS };

  // Validate and truncate string fields
  if (data.name && typeof data.name === 'string') {
    valid.name = data.name.slice(0, 50);
  }
  if (data.apiKey && typeof data.apiKey === 'string') {
    valid.apiKey = data.apiKey.slice(0, 200);
  }
  if (data.baseUrl && typeof data.baseUrl === 'string') {
    valid.baseUrl = data.baseUrl.slice(0, 200);
  }
  if (data.model && typeof data.model === 'string') {
    valid.model = data.model.slice(0, 100);
  }
  if (data.telegramToken && typeof data.telegramToken === 'string') {
    valid.telegramToken = data.telegramToken.slice(0, 100);
  }

  // Boolean fields
  valid.setupDone = data.setupDone === true;
  valid.hasTermuxApi = data.hasTermuxApi === true;
  valid.useMindBackend = data.useMindBackend === true;

  // Telegram allowed array
  if (Array.isArray(data.telegramAllowed)) {
    valid.telegramAllowed = data.telegramAllowed.slice(0, 20).filter(a => typeof a === 'string');
  }

  _cache = valid;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(valid, null, 2));
  } catch (e) {
    console.error('[config] failed to save:', e.message);
  }
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
