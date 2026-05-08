'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const tools    = {};
const LOG_FILE = path.join(os.homedir(), '.droidclaw', 'tool_log.json');

function register(name, fn, description) {
  if (!name || typeof name !== 'string') {
    console.error('[registry] failed to register: name is required');
    return;
  }
  if (!fn || typeof fn !== 'function') {
    console.error('[registry] failed to register', name, ': fn must be a function');
    return;
  }
  tools[name] = { fn, description: description || '' };
}

async function execute(name, args) {
  if (!tools[name]) throw new Error(`unknown tool: ${name}`);
  const start  = Date.now();
  let result;
  let error = null;

  try {
    result = await tools[name].fn(args);
  } catch (e) {
    error = e.message;
    throw e; // re-throw so caller can handle
  }

  _log({ tool: name, args, result: String(result).slice(0, 500), ms: Date.now() - start, at: new Date().toISOString(), error });
  return result;
}

function list() {
  return Object.keys(tools);
}

function listWithDescriptions() {
  return Object.entries(tools)
    .map(([name, t]) => t.description ? `${name}: ${t.description}` : name)
    .join('\n');
}

function _log(entry) {
  const dir = path.join(os.homedir(), '.droidclaw');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) { console.error('[registry] failed to create log dir:', e.message); return; }
  }
  let log = [];
  if (fs.existsSync(LOG_FILE)) {
    try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); }
    catch (e) { console.error('[registry] failed to parse log file:', e.message); }
  }
  log.push(entry);
  if (log.length > 200) log = log.slice(-200);
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2)); }
  catch (e) { console.error('[registry] failed to write log:', e.message); }
}

module.exports = { register, execute, list, listWithDescriptions };
