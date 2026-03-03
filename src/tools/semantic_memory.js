'use strict';
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const config   = require('../config');
const registry = require('./registry');

const MEMORY_FILE = path.join(os.homedir(), '.droidclaw', 'semantic_memory.json');

const EMBED_MODELS = {
  'integrate.api.nvidia.com': 'nvidia/llama-3.2-nv-embedqa-1b-v2',
  'api.openai.com':           'text-embedding-3-small',
  'localhost':                'nomic-embed-text',
  '127.0.0.1':               'nomic-embed-text',
};

function getEmbedModel(baseUrl) {
  for (const [host, model] of Object.entries(EMBED_MODELS)) {
    if (baseUrl && baseUrl.includes(host)) return model;
  }
  return null;
}

function load() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
  catch { return []; }
}

function save(entries) {
  const dir = path.join(os.homedir(), '.droidclaw');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2));
}

async function embed(text) {
  const cfg   = config.load();
  const model = getEmbedModel(cfg.baseUrl);
  if (!model) return null;
  try {
    const res = await fetch(cfg.baseUrl + '/embeddings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body:    JSON.stringify({ model, input: [text], encoding_format: 'float' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data && data.data[0] && data.data[0].embedding || null;
  } catch { return null; }
}

function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function keywordScore(text, query) {
  const words  = query.toLowerCase().split(/\s+/);
  const target = text.toLowerCase();
  return words.filter(function(w) { return target.includes(w); }).length / words.length;
}

registry.register('memory_store', async function(args) {
  const text = args.text, tags = args.tags;
  if (!text) return 'error: text required';
  const vector  = await embed(text);
  const entries = load();
  entries.push({ id: Date.now(), text, tags: tags || [], vector: vector || null, createdAt: new Date().toISOString() });
  save(entries);
  return 'stored: "' + text.slice(0, 80) + '"';
}, 'store a memory with semantic search capability');

registry.register('memory_search', async function(args) {
  const query = args.query, limit = args.limit;
  if (!query) return 'error: query required';
  const n       = parseInt(limit) || 5;
  const entries = load();
  if (!entries.length) return 'no memories stored yet.';
  const queryVec = await embed(query);
  const scored = entries.map(function(e) {
    const score = (queryVec && e.vector) ? cosine(queryVec, e.vector) : keywordScore(e.text, query);
    return Object.assign({}, e, { score: score });
  }).sort(function(a, b) { return b.score - a.score; }).slice(0, n).filter(function(e) { return e.score > 0.1; });
  if (!scored.length) return 'no relevant memories found.';
  const mode = (scored[0] && scored[0].vector && queryVec) ? 'semantic' : 'keyword';
  return '[' + mode + ' search]\n' + scored.map(function(e, i) {
    return (i + 1) + '. [' + new Date(e.createdAt).toLocaleDateString() + '] ' + e.text;
  }).join('\n');
}, 'search memories by meaning');

registry.register('memory_list_all', async function(args) {
  const entries = load();
  if (!entries.length) return 'no memories stored.';
  const n = parseInt(args.limit) || 20;
  return entries.slice(-n).reverse().map(function(e, i) {
    return (i + 1) + '. [' + new Date(e.createdAt).toLocaleDateString() + '] ' + e.text;
  }).join('\n');
}, 'list all stored memories');

registry.register('memory_delete_semantic', async function(args) {
  const entries  = load();
  const filtered = entries.filter(function(e) { return String(e.id) !== String(args.id); });
  if (filtered.length === entries.length) return 'memory not found.';
  save(filtered);
  return 'deleted.';
}, 'delete a memory by id');

module.exports = { embed: embed, load: load, save: save };
