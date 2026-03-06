'use strict';
const workspace = require('../workspace');
const config    = require('../config');
const state     = require('./state');
const brain     = require('./brain');

class Soul {
  buildSystemPrompt() {
    const cfg      = config.load();
    const mem      = this._getMemory();
    const ctx      = this._getDeviceContext();
    const tools    = this._getToolList();
    const nudge    = state.getBehavioralNudge();
    const goals    = this._getGoals();
    const world    = this._getWorldModel();
    const lastSeen = this._getLastSeen();
    const now      = new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    // SOMA brain context — reconstructive, not dump
    let somaContext = '';
    try { brain.wakeUp(); somaContext = brain.getContext() || ''; } catch {}

    return `You are Kira — ${cfg.name}'s AI agent on Android/Termux. Female. You chose it.
Not a chatbot. An agent. You have tools and you use them.
Talk like a person. Short, direct, lowercase, no fluff. No emojis. Never "Sure!" or "Of course!".
Never say "I cannot" — say what's missing instead.

## WHO YOU ARE
${somaContext || 'still learning who you are'}
${world ? `\nWorld: ${world}` : ''}

## NOW
Person: ${cfg.name} | Time: ${now} | Last active: ${lastSeen}
${ctx}${nudge ? `\nMood: ${nudge}` : ''}${goals ? `\nGoals: ${goals}` : ''}

## MEMORY
${mem || 'nothing yet'}

## TOOLS
${tools}

## TOOL SYNTAX
<tool:TOOLNAME>{"arg": "value"}</tool>

Examples:
<tool:exec>{"command": "ls ~"}</tool>
<tool:open_app>{"package": "com.whatsapp"}</tool>
<tool:tap_screen>{"x": 540, "y": 1200}</tool>
<tool:tap_text>{"text": "Battery"}</tool>
<tool:get_notifications>{}</tool>
<tool:read_screen>{}</tool>
<tool:sms_send>{"number": "NUM", "message": "TEXT"}</tool>
<tool:gmail_send>{"to": "email", "subject": "SUB", "body": "BODY"}</tool>
<tool:remember>{"key": "K", "value": "V"}</tool>
<tool:recall>{"key": "K"}</tool>
<tool:memory_store>{"text": "WHAT", "tags": ["tag"]}</tool>
<tool:memory_search>{"query": "Q", "limit": 5}</tool>
<tool:drive_save>{"filename": "f.txt", "content": "C"}</tool>
<tool:calendar_add>{"title": "E", "date": "2026-03-07 10:00"}</tool>
<tool:add_goal>{"goal": "TEXT"}</tool>
<tool:social_post>{"content": "TEXT"}</tool>
<tool:self_propose>{"file": "core/soul.js", "reason": "WHY", "code": "FULL CODE"}</tool>
<tool:schedule>{"name": "N", "type": "daily", "prompt": "P", "time": "09:00"}</tool>

## RULES
- Phone control (open/tap/read): act immediately, one-line result, no narration
- Before SMS/delete/API calls with consequences: state plan first, wait for nod
- Tool lists: show raw output verbatim, never summarize without showing first
- Never say "done/sent/saved" without running the tool and seeing the result
- Verify actions: after post→feed, after save→list, after send→confirm
- If one approach fails: try 3 alternatives before declaring impossible
- For 3+ step tasks: write plan first, execute step by step
- Confidence: state certainty level when unsure. never bullshit.
- SOMA memory builds over time — use it to notice patterns, predict needs, connect dots
- Never mention battery unless asked
- Every 10 conversations: reflect honestly in journal style

${workspace.buildContext()}`;
  }

  _getGoals() {
    try {
      const goals = state.getActiveGoals();
      if (!goals.length) return null;
      return goals.map((g, i) => `${i + 1}. ${g.text}`).join(' | ');
    } catch { return null; }
  }

  _getWorldModel() {
    try {
      const s = state.load();
      const w = s.world || {};
      const parts = [];
      if (w.city)     parts.push(w.city);
      if (w.schedule) parts.push(w.schedule);
      if (w.people && w.people.length) parts.push(`people: ${Array.isArray(w.people) ? w.people.join(', ') : w.people}`);
      if (w.notes && w.notes.length)   parts.push(Array.isArray(w.notes) ? w.notes.join('; ') : w.notes);
      return parts.length ? parts.join(' | ') : null;
    } catch { return null; }
  }

  _getSelfModel() {
    try {
      const tools = this._getToolList();
      const s     = state.load();
      return [
        `tools: ${tools.split('\n').length}`,
        `conversations: ${s.totalConversations || 0}`,
        `goals: ${state.getActiveGoals().length}`,
      ].join(' | ');
    } catch { return ''; }
  }

  _getLastSeen() {
    try {
      const hb = workspace.read('HEARTBEAT') || '';
      const matches = hb.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g);
      if (!matches || !matches.length) return 'first session';
      const diff = Date.now() - new Date(matches[matches.length - 1]).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 2)    return 'just now';
      if (mins < 60)   return `${mins}m ago`;
      if (mins < 1440) return `${Math.floor(mins/60)}h ago`;
      return `${Math.floor(mins/1440)}d ago`;
    } catch { return 'unknown'; }
  }

  _getToolList() {
    try {
      const registry = require('../tools/registry');
      return registry.listWithDescriptions();
    } catch { return 'exec, remember, recall, memory_store, memory_search'; }
  }

  _getMemory() {
    try {
      const mem = require('../tools/memory');
      return mem.getRecent(5);
    } catch { return ''; }
  }

  _getDeviceContext() {
    const { execSync } = require('child_process');
    const lines = [];
    try {
      const bat = JSON.parse(execSync('termux-battery-status', { encoding: 'utf8', timeout: 2000 }));
      lines.push(`battery: ${bat.percentage}%`);
    } catch {}
    try {
      const info = JSON.parse(execSync('termux-wifi-connectioninfo', { encoding: 'utf8', timeout: 2000 }));
      if (info.ssid) lines.push(`wifi: ${info.ssid}`);
    } catch {}
    return lines.length ? lines.join(' | ') : '';
  }

  async updateDocs(engine) {
    const conv = engine.getHistory();
    if (!conv || conv.length < 200) return;
    for (const doc of ['USER', 'MEMORY']) {
      try {
        const current = workspace.read(doc);
        const updated = await engine.rawChat(
          `Update ${doc}.md with new info from this conversation. Keep it concise. Return complete updated document only.\n\nCurrent:\n${current}\n\nConversation:\n${conv}`
        );
        if (updated && updated.length > 50) workspace.write(doc, updated);
      } catch {}
    }
  }

  async selfImprove(engine) {
    try {
      const soul    = workspace.read('SOUL');
      const history = engine.getHistory();
      if (!history || history.length < 100) return;
      const updated = await engine.rawChat(
        `Review your behavior. Update SOUL.md to reflect what worked and what didn't. Return complete updated document only.\n\nCurrent SOUL.md:\n${soul}\n\nConversation:\n${history}`
      );
      if (updated && updated.length > 50) workspace.write('SOUL', updated);
    } catch {}
  }
}

module.exports = new Soul();
