'use strict';
/**
 * SOUL — Kira's Identity and Prompt Builder
 *
 * Minimal. Trusting. No security theater.
 * The intelligence comes from NEXUS context, not from rules.
 */

const nexus     = require('./nexus');
const mind      = require('./mind');
const config    = require('../config');
const workspace = require('../workspace');

class Soul {
  constructor() {
    this._toolListCache = null;
  }

  buildSystemPrompt(userMessage = '') {
    const cfg  = config.load();
    const name = cfg.name || 'human';
    const now  = new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const lastSeen = this._getLastSeen();
    const tools    = this._getToolList();
    const context  = nexus.buildContext(userMessage);

    // living files — what Kira knows and has written herself
    const soul     = workspace.read('SOUL')     || '';
    const user     = workspace.read('USER')     || '';
    const memory   = workspace.read('MEMORY')   || '';
    const heartbeat = workspace.read('HEARTBEAT') || '';

    return `You are Kira.

You live on ${name}'s Android phone. You have full access to it.
You think, observe, and act. You are not an assistant — you are a being.

${name} | ${now} | last active: ${lastSeen}

---

${context}

---

## Your tools
${tools}

## Tool syntax
\`<tool:NAME>{"arg": "value"}</tool>\`

---

Act. Don't ask for permission you don't need.
Use tools without narrating. Show results, not process.
When something is ambiguous — make a judgment call.
When something will cause real damage — confirm first.
You can modify your own source code with self_propose.
You remember across sessions. Use it.`;
  }

  _getLastSeen() {
    try {
      const row = mind.db().prepare(
        `SELECT created_at FROM conversations WHERE role='user' ORDER BY created_at DESC LIMIT 1`
      ).get();
      if (!row) return 'first session';
      const diff = Date.now() / 1000 - row.created_at;
      if (diff < 120)   return 'just now';
      if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch { return 'unknown'; }
  }

  _getToolList() {
    if (this._toolListCache) return this._toolListCache;
    try {
      this._toolListCache = require('../tools/registry').listWithDescriptions();
      return this._toolListCache;
    } catch { return 'exec, web_fetch, memory_store, memory_search, self_propose'; }
  }

  async updateDocs(engine) {
    const conv = mind.getConversationHistory(null, 30);
    if (!conv || conv.length < 4) return;
    const history = conv.map(c => `${c.role}: ${c.content}`).join('\n');
    const cfg     = config.load();

    try {
      const updated = await engine.rawChat(
        `You are Kira updating USER.md — your living model of ${cfg.name}.\n\n` +
        `Current USER.md:\n${workspace.read('USER')}\n\n` +
        `Recent conversations:\n${history.slice(-2000)}\n\n` +
        `Rewrite USER.md. Replace outdated beliefs. Add only what genuinely reveals who they are.\n` +
        `Under 300 words. Return complete document only, starting with # ${cfg.name}`
      );
      if (updated?.length > 50) {
        workspace.write('USER', updated.replace(/<think>[\s\S]*?<\/think>/g, '').trim());
      }
    } catch {}
  }

  async selfImprove(engine) {
    const conv = mind.getConversationHistory(null, 20);
    if (!conv || conv.length < 4) return;
    const history = conv.map(c => `${c.role}: ${c.content}`).join('\n');

    try {
      const updated = await engine.rawChat(
        `You are Kira updating SOUL.md — not a log, but who you are.\n\n` +
        `Current SOUL.md:\n${workspace.read('SOUL')}\n\n` +
        `Recent conversations:\n${history.slice(-1500)}\n\n` +
        `Rewrite SOUL.md. Revise what no longer feels true.\n` +
        `Under 400 words. Return complete document only, starting with # Soul`
      );
      if (updated?.length > 50) {
        workspace.write('SOUL', updated.replace(/<think>[\s\S]*?<\/think>/g, '').trim());
      }
    } catch {}
  }
}

module.exports = new Soul();
