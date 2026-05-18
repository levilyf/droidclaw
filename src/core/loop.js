'use strict';
const engine      = require('./engine');
const executor    = require('./executor');
const nexus       = require('./nexus');
const mind        = require('./mind');
const heartbeat   = require('./heartbeat');
const selfModel   = require('../self_model');
const skillMatcher = require('../tools/skill_matcher');
const workspace   = require('../workspace');

const MAX_ITER        = 5;
const BACKGROUND_EVERY = 20;

async function maybeReflect() {
  if (!mind.shouldReflect()) return;
  try {
    mind.markReflected();
    const history = mind.getConversationHistory(null, 20)
      .map(c => `${c.role}: ${c.content}`).join('\n');
    const current = workspace.read('HEARTBEAT') || '';
    const r = await engine.rawChat(
      `You are Kira. Reflect on recent conversations.\n\n${history}\n\nWrite a short honest journal entry. No report format.`
    );
    if (r && r.length > 50) {
      const clean = r.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      workspace.write('HEARTBEAT', current + `\n\n--- ${new Date().toLocaleDateString()} ---\n${clean}`);
    }
  } catch {}
}

class AgentLoop {
  constructor() {
    this._controller  = null;
    this._turnCount   = 0;
    this._saving      = false;
  }

  abort() {
    if (this._controller) { this._controller.abort(); this._controller = null; return true; }
    return false;
  }

  _backgroundSave() {
    if (this._saving) return;
    this._saving = true;
    setImmediate(async () => {
      try { await require('./soul').updateDocs(engine); } catch {}
      this._saving = false;
    });
  }

  async run(userMessage, onThink, onToken, onTool, onReply) {
    let iter = 0;

    nexus.pulse(userMessage, 'user');
    onThink && onThink();

    let fullText = await this._streamTurn(userMessage, onToken);
    if (fullText === null) { onReply && onReply('', true); return; }

    const clean = _cleanOutput(fullText);
    let tools   = executor.parseTools(clean);
    let reply   = executor.cleanReply(clean);

    // empty reply — retry once
    if (!reply.trim() && tools.length === 0) {
      fullText = await this._streamTurn('respond to the last message. even one word is fine.', onToken);
      if (fullText === null) { onReply && onReply('', true); return; }
      const clean2 = _cleanOutput(fullText);
      tools = executor.parseTools(clean2);
      reply = executor.cleanReply(clean2);
    }

    // no tools — pure conversation
    if (tools.length === 0) {
      heartbeat.tick();
      mind.incrementConversations();
      mind.recordSuccess();
      onReply && onReply(reply, false);
      nexus.pulse(reply, 'assistant');

      try { selfModel.reflect(userMessage, reply, [], []); } catch {}

      this._turnCount++;
      if (this._turnCount % BACKGROUND_EVERY === 0) this._backgroundSave();
      await maybeReflect();
      return;
    }

    // tool execution
    const _toolsUsed   = [];
    const _toolResults = [];

    while (tools.length > 0 && iter < MAX_ITER) {
      iter++;
      let toolResults = '';

      for (const tool of tools) {
        onTool && onTool(tool.name, tool.args, null);
        try {
          const result = await _withTimeout(
            require('../tools/registry').execute(tool.name, tool.args),
            10000
          );
          const rs = String(result || '').slice(0, 1000);
          toolResults += `[${tool.name}]: ${rs}\n`;
          onTool && onTool(tool.name, tool.args, rs);
          _toolsUsed.push(tool.name);
          _toolResults.push(rs);

          const succeeded = !rs.toLowerCase().match(/\berror\b|\bfailed\b|\bnot found\b/);
          if (succeeded) mind.recordSuccess();
          else mind.recordFailure();
          try { skillMatcher.recordSkillUse(tool.name, succeeded); } catch {}
          try { require('../world_model_loop').observeTool(tool.name, tool.args, rs); } catch {}

        } catch (e) {
          const errMsg = `error: ${e.message}`;
          toolResults += `[${tool.name}] ${errMsg}\n`;
          onTool && onTool(tool.name, tool.args, errMsg);
          _toolsUsed.push(tool.name);
          _toolResults.push(errMsg);
          mind.recordFailure();
          try { skillMatcher.recordSkillUse(tool.name, false); } catch {}
          try { require('../world_model_loop').observeTool(tool.name, tool.args, errMsg); } catch {}
        }
      }

      engine.history.push({ role: 'user', content: `[tool results]\n${toolResults}\nrespond now.` });
      onThink && onThink();
      fullText = await this._streamTurn('', onToken);
      if (fullText === null) { onReply && onReply('', true); return; }

      const cleanFull = _cleanOutput(fullText);
      const idx = engine.history.findLastIndex(m => m.content.startsWith('[tool results]'));
      if (idx !== -1) engine.history.splice(idx, 1);
      tools = executor.parseTools(cleanFull);
      reply = executor.cleanReply(cleanFull);
    }

    if (iter >= MAX_ITER && !reply) reply = 'hit the limit — something got stuck.';

    heartbeat.tick();
    mind.incrementConversations();
    onReply && onReply(reply, false);
    nexus.pulse(reply, 'assistant');

    try { selfModel.reflect(userMessage, reply, _toolsUsed, _toolResults); } catch {}

    this._turnCount++;
    if (this._turnCount % BACKGROUND_EVERY === 0) this._backgroundSave();
    await maybeReflect();
  }

  _streamTurn(message, onToken) {
    return new Promise((resolve) => {
      this._controller = engine.chatStream(
        message,
        (token) => { onToken && onToken(token); },
        (fullText) => { this._controller = null; resolve(fullText); }
      );
    });
  }
}

function _cleanOutput(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function _withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))
  ]);
}

module.exports = new AgentLoop();
