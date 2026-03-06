'use strict';
const engine    = require('./engine');
const registry  = require('../tools/registry');
const heartbeat = require('./heartbeat');
const state     = require('./state');
const brain     = require('./brain');

const MAX_ITER     = 5;
const TOOL_TIMEOUT = 10000;

function parseTools(text) {
  const tools = [];
  const re    = /<tool:(\w+)>([\s\S]*?)<\/tool>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try   { tools.push({ name: m[1], args: JSON.parse(m[2] || '{}') }); }
    catch { tools.push({ name: m[1], args: { raw: m[2] } }); }
  }
  return tools;
}

function cleanReply(text) {
  return text.replace(/<tool:[\s\S]*?<\/tool>/g, '').trim();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('tool timed out')), ms)),
  ]);
}

async function maybeReflect() {
  if (!state.shouldReflect()) return;
  try {
    state.markReflected();
    const history  = engine.getHistory();
    const current  = require('../workspace').read('HEARTBEAT') || '';
    const reflection = await engine.rawChat(
      `You are Kira. Reflect on your recent conversations.\n\nConversation history:\n${history}\n\nWrite a short journal entry — what worked, what failed, what you learned, what you want to do differently. Be honest. No report format, just your thoughts.`
    );
    if (reflection && reflection.length > 50) {
      const entry = `\n\n--- reflection ${new Date().toLocaleDateString()} ---\n${reflection}`;
      require('../workspace').write('HEARTBEAT', current + entry);
    }
  } catch {}
}

class AgentLoop {
  async run(userMessage, onThink, onTool, onReply) {
    let iter     = 0;
    let hadError = false;

    onThink && onThink();
    brain.pulse(userMessage, "user");
    let raw   = await engine.chat(userMessage);
    let tools = parseTools(raw);
    let reply = cleanReply(raw);

    if (tools.length === 0) {
      heartbeat.tick();
      const total = state.incrementConversations();
      state.recordSuccess();
      onReply && onReply(reply);
      // Reflection check async — don't block response
      maybeReflect();
      return reply;
    }

    while (tools.length > 0 && iter < MAX_ITER) {
      iter++;
      let toolResults = '';

      for (const tool of tools) {
        onTool && onTool(tool.name, tool.args, null);
        try {
          const result    = await withTimeout(registry.execute(tool.name, tool.args), TOOL_TIMEOUT);
          const resultStr = String(result).slice(0, 1000);
          toolResults    += `[${tool.name}]: ${resultStr}\n`;
          onTool && onTool(tool.name, tool.args, resultStr);
          // Track tool-specific state
          if (tool.name === 'build_tool') state.recordToolBuilt();
          state.recordSuccess();
        } catch (e) {
          toolResults += `[${tool.name}] error: ${e.message}\n`;
          onTool && onTool(tool.name, tool.args, `error: ${e.message}`);
          state.recordFailure();
          hadError = true;
        }
      }

      engine.history.push({
        role:    'user',
        content: `[tool results]\n${toolResults}\nrespond to the user now.`,
      });

      onThink && onThink();
      raw   = await engine.chat('');
      const idx = engine.history.findLastIndex(m => m.content.startsWith('[tool results]'));
      if (idx !== -1) engine.history.splice(idx, 1);

      tools = parseTools(raw);
      reply = cleanReply(raw);
    }

    if (iter >= MAX_ITER && !reply) {
      reply = "hit the iteration limit — something got stuck. try again.";
    }

    heartbeat.tick();
    state.incrementConversations();
    onReply && onReply(reply);
    maybeReflect();
    return reply;
  }
}

module.exports = new AgentLoop();
