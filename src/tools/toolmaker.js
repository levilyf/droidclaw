'use strict';
const fs       = require('fs');
const path     = require('path');
const registry = require('./registry');

// Custom tools live here
const CUSTOM_DIR = path.join(__dirname, '..', 'tools', 'custom');

// Template the model must follow when writing tools
const TOOL_TEMPLATE = `'use strict';
const registry = require('../registry');

// TOOL: {name}
// WHAT IT DOES: {description}

registry.register('{name}', async (args) => {
  // write the tool logic here
  // return a string result
});
`;

function ensureDir() {
  if (!fs.existsSync(CUSTOM_DIR)) fs.mkdirSync(CUSTOM_DIR, { recursive: true });
}

function safetyCheck(code) {
  const banned = [
    'process.exit',
    'eval(',
    'Function(',
    '__proto__',
    'fs.rmSync',
    'fs.rmdirSync',
    'fs.unlinkSync',
  ];
  for (const b of banned) {
    if (code.includes(b)) return `banned pattern: ${b}`;
  }
  return null;
}

function create(name, description, code) {
  ensureDir();

  const safeName = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const filePath = path.join(CUSTOM_DIR, `${safeName}.js`);

  // Safety check
  const danger = safetyCheck(code);
  if (danger) return { ok: false, error: `safety check failed: ${danger}` };

  // Write file
  try {
    fs.writeFileSync(filePath, code);
  } catch (e) {
    return { ok: false, error: `write failed: ${e.message}` };
  }

  // Hot-load it
  try {
    // Clear require cache so it reloads fresh
    delete require.cache[filePath];
    require(filePath);
    return { ok: true, name: safeName, path: filePath };
  } catch (e) {
    // If it fails to load, delete the file
    try { fs.unlinkSync(filePath); } catch {}
    return { ok: false, error: `load failed: ${e.message}` };
  }
}

function loadAll() {
  ensureDir();
  const files = fs.readdirSync(CUSTOM_DIR).filter(f => f.endsWith('.js'));
  const loaded = [];
  for (const file of files) {
    const full = path.join(CUSTOM_DIR, file);
    try {
      delete require.cache[full];
      require(full);
      loaded.push(file.replace('.js', ''));
    } catch (e) {
      // skip broken tools silently
    }
  }
  return loaded;
}

function listCustom() {
  ensureDir();
  return fs.readdirSync(CUSTOM_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace('.js', ''));
}

function deleteCustom(name) {
  const safeName = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const filePath = path.join(CUSTOM_DIR, `${safeName}.js`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function getTemplate() {
  return TOOL_TEMPLATE;
}

// Register the build_tool tool so the model can call it
registry.register('build_tool', async ({ name, description, code }) => {
  if (!name)        return 'error: name is required';
  if (!description) return 'error: description is required';
  if (!code)        return 'error: code is required';

  const result = create(name, description, code);
  if (!result.ok)  return `failed to create tool: ${result.error}`;
  return `tool "${result.name}" created and loaded. you can use it now with <tool:${result.name}>.`;
});

// Register delete_tool
registry.register('delete_tool', async ({ name }) => {
  if (!name) return 'error: name is required';
  const deleted = deleteCustom(name);
  return deleted ? `tool "${name}" deleted.` : `tool "${name}" not found.`;
});

module.exports = { create, loadAll, listCustom, deleteCustom, getTemplate, TOOL_TEMPLATE };
