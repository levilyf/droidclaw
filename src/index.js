'use strict';
// error boundary — must be first
require('./error_boundary').install();

const chalk     = require('chalk');
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
  if (count > 0) console.log(`[kira] ${count} skills loaded`);
} catch (e) {
  console.error('[kira] skills failed to load:', e.message);
}

// World model loop — observeTool called directly from loop.js
require('./world_model_loop');

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
      tui.addMessage('system', 'saving...');
      await soul.updateDocs(engine);
      await soul.selfImprove(engine);
      await nexus.sleep(engine);
      heartbeat.stop(true);
      break;

    default:
      tui.addMessage('error', `unknown command: ${parts[0]}`);
  }
}

async function main() {
  if (!config.get('setupDone')) {
    const setup = require('./setup');
    await setup.run();
  }

  // initialize KIRA_MIND database — the single source of truth
  mind.init();

  // migrate from old JSON files if they exist
  try { mind.migrateFromJSON(); } catch {}

  workspace.init();
  engine.init(soul);
  heartbeat.start();

  await tui.init(async (input) => {
    if (input.startsWith('/')) {
      await cmd(input, input.trim().split(/\s+/));
      return;
    }

    // if already thinking — abort current stream and queue new message
    if (tui.thinking) {
      loop.abort();
      tui.setThinking(false);
      process.stdout.write('\n' + chalk.hex('#7a4060')('  ↩ interrupted\n'));
    }

    // token buffer for filtering tool tags and think blocks mid-stream
    let _tokenBuf   = '';
    let _inToolTag  = false;
    let _inThinkTag = false;

    tui.setThinking(true);
    try {
      await loop.run(
        input,
        // onThink
        () => {},
        // onToken — filter tool tags and <think> blocks, write clean text live
        (token) => {
          _tokenBuf += token;

          // ── Filter <think>...</think> blocks (reasoning models) ───────────
          if (!_inThinkTag && _tokenBuf.includes('<think>')) {
            _inThinkTag = true;
            // print everything before <think>
            const tagStart = _tokenBuf.indexOf('<think>');
            const before   = _tokenBuf.slice(0, tagStart);
            _tokenBuf      = _tokenBuf.slice(tagStart);
            if (before.trim()) {
              if (!tui._streamStarted) {
                tui._streamStarted = true;
                if (tui._dots) { clearInterval(tui._dots); tui._dots = null; }
                tui.thinking = false;
                process.stdout.write('\x1b[2K\r');
                tui._kiraPrompt();
              }
              process.stdout.write(chalk.hex('#fce8f0')(before));
            }
            return;
          }

          if (_inThinkTag) {
            if (_tokenBuf.includes('</think>')) {
              // discard everything inside think block, keep after
              const after = _tokenBuf.slice(_tokenBuf.indexOf('</think>') + 8);
              _tokenBuf   = after;
              _inThinkTag = false;
              if (after.trim()) {
                if (!tui._streamStarted) {
                  tui._streamStarted = true;
                  if (tui._dots) { clearInterval(tui._dots); tui._dots = null; }
                  tui.thinking = false;
                  process.stdout.write('\x1b[2K\r');
                  tui._kiraPrompt();
                }
                process.stdout.write(chalk.hex('#fce8f0')(after));
                _tokenBuf = '';
              }
            }
            return;
          }

          // ── Filter <tool:...> blocks ──────────────────────────────────────
          // detect entering a tool tag
          if (!_inToolTag && _tokenBuf.includes('<tool:')) {
            _inToolTag = true;
            const tagStart = _tokenBuf.indexOf('<tool:');
            const before   = _tokenBuf.slice(0, tagStart);
            _tokenBuf      = _tokenBuf.slice(tagStart);
            if (before) {
              if (!tui._streamStarted) {
                tui._streamStarted = true;
                if (tui._dots) { clearInterval(tui._dots); tui._dots = null; }
                tui.thinking = false;
                process.stdout.write('\x1b[2K\r');
                tui._kiraPrompt();
              }
              process.stdout.write(chalk.hex('#fce8f0')(before));
            }
            return;
          }

          // inside tool tag — wait for closing tag
          if (_inToolTag) {
            if (_tokenBuf.includes('</tool>')) {
              const after = _tokenBuf.slice(_tokenBuf.indexOf('</tool>') + 7);
              _tokenBuf   = after;
              _inToolTag  = false;
              if (after.trim()) {
                process.stdout.write(chalk.hex('#fce8f0')(after));
              }
            }
            return;
          }

          // normal text — print immediately
          if (!tui._streamStarted) {
            tui._streamStarted = true;
            if (tui._dots) { clearInterval(tui._dots); tui._dots = null; }
            tui.thinking = false;
            process.stdout.write('\x1b[2K\r');
            tui._kiraPrompt();
          }
          process.stdout.write(chalk.hex('#fce8f0')(_tokenBuf));
          _tokenBuf = '';
        },
        // onTool — newline before tool output so it doesn't clash
        (name, args, result) => {
          if (result !== null && result !== undefined && result !== '') {
            if (tui._streamStarted) process.stdout.write('\n');
            tui.addMessage('tool', `${String(result).slice(0, 100)}`);
          }
        },
        // onReply
        (reply, aborted) => {
          _tokenBuf          = '';
          _inToolTag         = false;
          _inThinkTag        = false;
          tui._streamStarted = false;
          tui.thinking       = false;
          if (!aborted) {
            process.stdout.write('\n');
            tui._showPrompt();
          }
        }
      );
    } catch (e) {
      tui._streamStarted = false;
      tui.setThinking(false);
      tui.addMessage('error', e.message);
    }
  });

  // Start scheduler after TUI is ready
  try {
    const scheduler = require('./core/scheduler');
    scheduler.start({ telegram, loop, tui });
  } catch {}

  // Start proactive mode — passes tui and loop so it can speak up
  try {
    const proactive = require('./core/proactive');
    proactive.start({ tui, loop });
  } catch {}

  // Start telegram after TUI is ready
  const cfg = config.load();
  if (cfg.telegramToken) {
    telegram.start(msg => tui.addMessage('system', `tg: ${msg}`));
  }
}

main();

// ── Graceful shutdown — runs on Ctrl+C, swipe away, kill signal ──────────────
// This ensures sleep consolidation runs even when user doesn't type /exit
let _shuttingDown = false;

async function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;

  process.stdout.write('\n' + chalk.hex('#7a4060')('  saving...\n'));

  try {
    loop.abort();

    // M2.7 self-evolution sleep cycle
    await soul.updateDocs(engine);
    await soul.selfImprove(engine);
    await nexus.sleep(engine);

    heartbeat.stop(true);
  } catch {}

  process.stdout.write(chalk.hex('#7a4060')('  done.\n'));
  process.exit(0);
}

process.once('SIGINT',  () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGHUP',  () => gracefulShutdown('SIGHUP'));

