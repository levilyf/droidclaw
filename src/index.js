'use strict';
// error boundary — must be first
require('./error_boundary').install();

const config    = require('./config');
const workspace = require('./workspace');
const soul      = require('./core/soul');
const mind      = require('./core/mind');
const nexus     = require('./core/nexus');
const engine    = require('./core/engine');
const heartbeat = require('./core/heartbeat');
const loop      = require('./core/loop');
const tui       = require('./tui');
const telegram  = require('./integrations/telegram');
const { showHelp } = require('./tui/menu');

// Load core tools
require('./tools/exec');
require('./tools/memory');
require('./tools/realworld');
require('./tools/kiraservice');
require('./tools/semantic_memory');
require('./tools/social');
require('./tools/self_modify');
require('./tools/google');
require('./tools/search');
require('./tools/web_fetch');
require('./tools/task_tools');

// Load skills system (builtin + user installed)
try {
  const skillLoader = require('./tools/skills/loader');
  const count = skillLoader.loadAll();
  if (count > 0) tui.addMessage && tui.addMessage('system', `${count} skills loaded`);
} catch (e) {
  // silently swallow — tui may not be ready yet
}

// World model loop
require('./world_model_loop');

// ── Commands ──────────────────────────────────────────────────────────────────
async function cmd(input, parts) {
  const sub = parts[1];

  switch (parts[0]) {
    case '/help':
    case '/config':
      await showHelp(tui);
      break;

    case '/skills': {
      try {
        const skillLoader = require('./tools/skills/loader');
        const { builtin, user } = skillLoader.listSkills();
        const lines = [];
        if (builtin.length) lines.push(`builtin: ${builtin.join(', ')}`);
        if (user.length)    lines.push(`yours:   ${user.map(s => s.name).join(', ')}`);
        if (!lines.length)  lines.push('no skills loaded.');
        tui.addMessage('system', lines.join('\n'));
      } catch (e) {
        tui.addMessage('error', e.message);
      }
      break;
    }

    case '/status': {
      const hb    = heartbeat.info();
      const stats = engine.stats();
      const cfg   = config.load();
      tui.addMessage('system', [
        `status  : ${hb.status}`,
        `uptime  : ${hb.uptime()}`,
        `turns   : ${stats.turns}`,
        `model   : ${stats.model}`,
        `api     : ${stats.baseUrl}`,
        `user    : ${cfg.name}`,
        `device  : ${cfg.device || 'android'}`,
        `tg      : ${cfg.telegramToken ? 'connected' : 'off'}`,
      ].join('\n'));
      break;
    }

    case '/memory': {
      const mem  = require('./tools/memory');
      const data = mem.load();
      if (!sub || sub === 'list') {
        const keys = Object.keys(data);
        tui.addMessage('system', keys.length ? keys.map(k => `${k}: ${data[k].value}`).join('\n') : 'nothing stored');
      } else if (sub === 'get' && parts[2]) {
        tui.addMessage('system', data[parts[2]] ? `${parts[2]}: ${data[parts[2]].value}` : 'not found');
      } else if (sub === 'set' && parts[2] && parts[3]) {
        const updated = { ...data, [parts[2]]: { value: parts.slice(3).join(' '), at: new Date().toISOString() } };
        mem.save(updated);
        tui.addMessage('system', `saved: ${parts[2]}`);
      }
      break;
    }

    case '/workspace': {
      if (!sub) {
        tui.addMessage('system', Object.keys(workspace.DOCS).join('\n'));
      } else {
        const content = workspace.read(sub.toUpperCase());
        tui.addMessage('system', content || 'not found');
      }
      break;
    }

    case '/reload':
      config.invalidate();
      workspace.init();
      engine.init(soul);
      tui.addMessage('system', 'reloaded.');
      break;

    case '/clear':
      engine.clearHistory();
      tui.addMessage('system', 'history cleared.');
      break;

    case '/exit':
      tui.addMessage('system', 'saving…');
      await soul.updateDocs(engine);
      await soul.selfImprove(engine);
      await nexus.sleep(engine);
      heartbeat.stop(true);
      break;

    default:
      tui.addMessage('error', `unknown command: ${parts[0]}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!config.get('setupDone')) {
    const setup = require('./setup');
    await setup.run();
  }

  mind.init();
  try { mind.migrateFromJSON(); } catch {}

  workspace.init();
  engine.init(soul);
  heartbeat.start();

  await tui.init(async (input) => {
    if (input.startsWith('/')) {
      await cmd(input, input.trim().split(/\s+/));
      return;
    }

    // Interrupt if already thinking
    if (tui.thinking) {
      loop.abort();
      tui.setThinking(false);
      tui.addMessage('system', '↩ interrupted');
    }

    // Per-turn token state
    let _tokenBuf   = '';
    let _inToolTag  = false;
    let _inThinkTag = false;

    tui.setThinking(true, 'thinking');

    try {
      await loop.run(
        input,

        // onThink
        () => { tui.setThinkingLabel('reasoning'); },

        // onToken — filter <think> and <tool:…> tags, pipe clean text to TUI
        (token) => {
          _tokenBuf += token;

          // ── <think> blocks ──────────────────────────────────────────────────
          if (!_inThinkTag && _tokenBuf.includes('<think>')) {
            _inThinkTag    = true;
            const tagStart = _tokenBuf.indexOf('<think>');
            const before   = _tokenBuf.slice(0, tagStart);
            _tokenBuf      = _tokenBuf.slice(tagStart);
            if (before.trim()) tui.appendToken(before);
            return;
          }

          if (_inThinkTag) {
            if (_tokenBuf.includes('</think>')) {
              const after = _tokenBuf.slice(_tokenBuf.indexOf('</think>') + 8);
              _tokenBuf   = after;
              _inThinkTag = false;
              if (after.trim()) { tui.appendToken(after); _tokenBuf = ''; }
            }
            return;
          }

          // ── <tool:…> blocks ─────────────────────────────────────────────────
          if (!_inToolTag && _tokenBuf.includes('<tool:')) {
            _inToolTag     = true;
            const tagStart = _tokenBuf.indexOf('<tool:');
            const before   = _tokenBuf.slice(0, tagStart);
            _tokenBuf      = _tokenBuf.slice(tagStart);
            if (before.trim()) tui.appendToken(before);
            return;
          }

          if (_inToolTag) {
            if (_tokenBuf.includes('</tool>')) {
              const after = _tokenBuf.slice(_tokenBuf.indexOf('</tool>') + 7);
              _tokenBuf   = after;
              _inToolTag  = false;
              if (after.trim()) tui.appendToken(after);
            }
            return;
          }

          // ── Normal text ─────────────────────────────────────────────────────
          tui.appendToken(_tokenBuf);
          _tokenBuf = '';
        },

        // onTool
        (name, args, result) => {
          if (name && (result === null || result === undefined || result === '')) {
            tui.addMessage('tool_start', `${name}: ${JSON.stringify(args || {}).slice(0, 60)}`);
          } else if (result !== null && result !== undefined) {
            tui.addMessage('tool', `${name}: ${String(result).slice(0, 120)}`);
          }
        },

        // onReply
        (reply, aborted) => {
          _tokenBuf   = '';
          _inToolTag  = false;
          _inThinkTag = false;
          tui.finishStream();
        }
      );
    } catch (e) {
      tui.finishStream();
      tui.setThinking(false);
      tui.addMessage('error', e.message);
    }
  });

  // Start scheduler
  try {
    const scheduler = require('./core/scheduler');
    scheduler.start({ telegram, loop, tui });
  } catch {}

  // Start proactive mode
  try {
    const proactive = require('./core/proactive');
    proactive.start({ tui, loop });
  } catch {}

  // Start Telegram
  const cfg = config.load();
  if (cfg.telegramToken) {
    telegram.start(msg => tui.addMessage('system', `tg: ${msg}`));
  }
}

main();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let _shuttingDown = false;

async function gracefulShutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;

  tui.addMessage('system', 'saving…');

  try {
    loop.abort();
    await soul.updateDocs(engine);
    await soul.selfImprove(engine);
    await nexus.sleep(engine);
    heartbeat.stop(true);
  } catch {}

  process.exit(0);
}

process.once('SIGINT',  gracefulShutdown);
process.once('SIGTERM', gracefulShutdown);
process.once('SIGHUP',  gracefulShutdown);
