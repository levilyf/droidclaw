'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const tools    = {};
const LOG_FILE = path.join(os.homedir(), '.droidclaw', 'tool_log.json');

function register(name, fn, description) {
  tools[name] = { fn, description: description || '' };
}

async function execute(name, args) {
  if (!tools[name]) throw new Error(`unknown tool: ${name}`);
  const start  = Date.now();
  const result = await tools[name].fn(args);
  _log({ tool: name, args, result: String(result).slice(0, 500), ms: Date.now() - start, at: new Date().toISOString() });
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
  try {
    const dir = path.join(os.homedir(), '.droidclaw');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let log = [];
    if (fs.existsSync(LOG_FILE)) { try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {} }
    log.push(entry);
    if (log.length > 200) log = log.slice(-200);
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  } catch {}
}

module.exports = { register, execute, list, listWithDescriptions };
