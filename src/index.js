'use strict';
const config    = require('./config');
const workspace = require('./workspace');
const soul      = require('./core/soul');
const engine    = require('./core/engine');
const heartbeat = require('./core/heartbeat');
const loop      = require('./core/loop');
const tui       = require('./tui');
const telegram  = require('./integrations/telegram');
const { showHelp } = require('./tui/menu');

// Load tools
require('./tools/exec');
require('./tools/memory');
require('./tools/toolmaker');
require('./tools/scheduler_tools');
require('./tools/agents');
require('./tools/state_tools');
require('./tools/realworld');
require('./tools/semantic_memory');
require('./tools/social');
require('./tools/self_modify');
require('./tools/google');

async function cmd(input, parts) {
  const sub = parts[1];

  switch (parts[0]) {
    case '/help':
    case '/config':
      await showHelp(tui);
      break;

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

  workspace.init();
  engine.init(soul);
  heartbeat.start();

  // Load custom tools from previous sessions
  try {
    const toolmaker = require('./tools/toolmaker');
    toolmaker.loadAll();
  } catch {}

  await tui.init(async (input) => {
    if (input.startsWith('/')) {
      await cmd(input, input.trim().split(/\s+/));
      return;
    }

    tui.setThinking(true);
    try {
      await loop.run(
        input,
        () => {},
        (name, args, result) => {
          if (result !== null && result !== undefined && result !== '') {
            tui.addMessage('tool', `${String(result).slice(0, 100)}`);
          }
        },
        (reply) => {
          tui.setThinking(false);
          if (reply) tui.addMessage('agent', reply);
        }
      );
    } catch (e) {
      tui.setThinking(false);
      tui.addMessage('error', e.message);
    }
  });

  // Start scheduler AFTER TUI is ready
  try {
    const scheduler = require('./core/scheduler');
    scheduler.start({ telegram, loop, tui });
  } catch {}

  // Start proactive mode if enabled
  try {
    const proactive = require('./core/proactive');
    proactive.start();
  } catch {}

  // Start telegram AFTER TUI is ready
  const cfg = config.load();
  if (cfg.telegramToken) {
    telegram.start(msg => tui.addMessage('system', `tg: ${msg}`));
  }
}

main();
require('./tools/search');
