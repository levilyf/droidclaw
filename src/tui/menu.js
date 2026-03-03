'use strict';
const chalk = require('chalk');

const C = {
  primary: '#f4a7b9',
  dim:     '#a0607a',
  muted:   '#3d1a2a',
  accent:  '#f9d0dc',
  mid:     '#7a4060',
  hint:    '#4a2038',
  error:   '#e05555',
};

// ─── Arrow key menu ──────────────────────────────────────────────────────────

function createMenu(title, items, tui) {
  return new Promise((resolve) => {
    let selected = 0;
    if (tui) tui.enterMenuMode();

    function draw() {
      const lines = [];
      lines.push('');
      lines.push(`  ${chalk.hex(C.primary)(title)}`);
      lines.push(`  ${chalk.hex(C.hint)('─'.repeat(30))}`);
      for (let i = 0; i < items.length; i++) {
        if (i === selected) {
          lines.push(chalk.hex(C.primary)(`  ◆ ${items[i]}`));
        } else {
          lines.push(chalk.hex(C.mid)(`  ◇ ${items[i]}`));
        }
      }
      lines.push('');
      lines.push(chalk.hex(C.hint)('  j/k  ·  enter  ·  q'));
      return lines;
    }

    let lastLines = 0;

    function render(redraw) {
      const lines = draw();
      if (redraw && lastLines > 0) {
        process.stdout.write(`\x1b[${lastLines}A`);
        for (let i = 0; i < lastLines; i++) process.stdout.write('\x1b[2K\n');
        process.stdout.write(`\x1b[${lastLines}A`);
      }
      process.stdout.write(lines.join('\n') + '\n');
      lastLines = lines.length;
    }

    render(false);

    // Already in raw mode from TUI — just listen
    const onData = (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk.charCodeAt ? chunk.charCodeAt(i) : chunk[i];
        const c    = typeof chunk === 'string' ? chunk[i] : String.fromCharCode(chunk[i]);

        if (byte === 27) continue; // ESC — skip, handle sequences
        if (c === '[') continue;   // part of escape sequence

        if      (c === 'k' || c === 'A') { selected = (selected - 1 + items.length) % items.length; render(true); }
        else if (c === 'j' || c === 'B') { selected = (selected + 1) % items.length; render(true); }
        else if (byte === 13)            { cleanup(); resolve(selected); return; }
        else if (c === ' ')              { cleanup(); resolve(selected); return; }
        else if (c === 'q')              { cleanup(); resolve(-1); return; }
        else if (byte === 3)             { process.exit(0); }
      }
    };

    function cleanup() {
      process.stdin.removeListener('data', onData);
      if (tui) tui.exitMenuMode();
    }

    process.stdin.on('data', onData);
  });
}

// ─── Text prompt ─────────────────────────────────────────────────────────────

function prompt(question, defaultVal) {
  return new Promise((resolve) => {
    let buf = '';
    const q = chalk.hex(C.dim)(`  ${question}`) +
              (defaultVal ? chalk.hex(C.hint)(` [${defaultVal}]`) : '') +
              chalk.hex(C.primary)(' › ');
    process.stdout.write(q);

    const onData = (key) => {
      for (let i = 0; i < key.length; i++) {
        const c    = key[i];
        const code = key.charCodeAt(i);

        if (code === 3) process.exit(0);

        if (code === 13 || code === 10) {
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          resolve(buf.trim() || defaultVal || '');
          return;
        }

        if (code === 127 || code === 8) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\u0008 \u0008');
          }
          continue;
        }

        if (code >= 32 && code < 127) {
          buf += c;
          process.stdout.write(chalk.hex(C.mid)(c));
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

// ─── Help / control panel ────────────────────────────────────────────────────

async function showHelp(tui) {
  while (true) {
    const choice = await createMenu('kira — control panel', [
      'about kira',
      'provider & model',
      'integrations',
      'voice',
      'memory',
      'scheduler',
      'workspace',
      'device info',
      'danger zone',
      'close',
    ], tui);

    if (choice === -1 || choice === 9) break;

    if (choice === 0) await _aboutKira(tui);
    else if (choice === 1) await _changeProvider(tui);
    else if (choice === 2) await _integrations(tui);
    else if (choice === 3) await _voiceSettings(tui);
    else if (choice === 4) await _memory(tui);
    else if (choice === 5) await _scheduler(tui);
    else if (choice === 6) await _workspace(tui);
    else if (choice === 7) await _deviceInfo(tui);
    else if (choice === 8) await _dangerZone(tui);
  }
}

async function _integrations(tui) {
  while (true) {
    const choice = await createMenu('integrations', [
      'telegram',
      'proactive mode',
      'discord (coming soon)',
      'spotify (coming soon)',
      'back',
    ], tui);

    if (choice === -1 || choice === 4) break;
    if (choice === 0) await _toggleTelegram(tui);
    else if (choice === 1) await _proactiveSettings(tui);
    else tui.addMessage('system', 'coming soon.');
  }
}

async function _proactiveSettings(tui) {
  const config = require('../config');
  const cfg    = config.load();
  const p      = cfg.proactive || {};

  const choice = await createMenu('proactive mode', [
    `status: ${p.enabled ? 'on' : 'off'}`,
    `allow SMS: ${p.allowSMS ? 'yes' : 'no'}`,
    `allow notifications: ${p.allowNotify !== false ? 'yes' : 'no'}`,
    `allow goal pursuit: ${p.allowGoalPursuit ? 'yes' : 'no'}`,
    `interval: every ${p.interval || 30} mins`,
    'back',
  ], tui);

  if (choice === -1 || choice === 5) return;

  const updated = { ...p };

  if (choice === 0) {
    updated.enabled = !p.enabled;
    const proactive = require('../core/proactive');
    if (updated.enabled) proactive.start();
    else proactive.stop();
    tui.addMessage('system', `proactive mode ${updated.enabled ? 'on' : 'off'}.`);
  } else if (choice === 1) {
    updated.allowSMS = !p.allowSMS;
    tui.addMessage('system', `SMS ${updated.allowSMS ? 'allowed' : 'blocked'}.`);
  } else if (choice === 2) {
    updated.allowNotify = p.allowNotify === false ? true : false;
    tui.addMessage('system', `notifications ${updated.allowNotify ? 'allowed' : 'blocked'}.`);
  } else if (choice === 3) {
    updated.allowGoalPursuit = !p.allowGoalPursuit;
    tui.addMessage('system', `goal pursuit ${updated.allowGoalPursuit ? 'on' : 'off'}.`);
  } else if (choice === 4) {
    process.stdout.write('\n');
    const mins = await prompt('check interval (minutes)', String(p.interval || 30));
    updated.interval = parseInt(mins) || 30;
    tui.addMessage('system', `interval set to ${updated.interval} mins.`);
  }

  config.save({ ...cfg, proactive: updated });
}

async function _aboutKira(tui) {
  process.stdout.write('\n');
  console.log(chalk.hex('#f4a7b9')([
    '  i\'m kira.',
    '  i run on your phone. i use real tools.',
    '  i build new ones when i need them.',
    '  i remember things. i notice patterns.',
    '  i act while you sleep.',
    '  i\'m not an assistant. i\'m an agent.',
    '',
    '  commands:',
    '  /help        — this menu',
    '  /status      — system info',
    '  /memory      — stored facts',
    '  /workspace   — docs',
    '  /reload      — reload config',
    '  /clear       — clear history',
    '  /exit        — save and quit',
  ].join('\n')));
  process.stdout.write('\n');
  await prompt('press enter to go back', '');
}

async function _toggleTelegram(tui) {
  const config   = require('../config');
  const telegram = require('../integrations/telegram');
  const cfg      = config.load();

  if (!cfg.telegramToken) {
    process.stdout.write('\n');
    tui.addMessage('system', 'no telegram token set.');
    const token = await prompt('bot token (from @BotFather)');
    if (token) {
      config.set('telegramToken', token);
      const userId = await prompt('your telegram user ID');
      if (userId) config.set('telegramAllowed', [userId]);
      telegram.stop();
      await telegram.start(msg => tui.addMessage('system', `tg: ${msg}`));
      tui.addMessage('system', 'telegram started.');
    }
    return;
  }

  const choice = await createMenu('telegram', [
    telegram.running ? 'stop bot' : 'start bot',
    'add allowed user',
    'view allowed users',
    'remove token',
    'back',
  ], tui);

  if (choice === 0) {
    if (telegram.running) {
      telegram.stop();
      tui.addMessage('system', 'telegram stopped.');
    } else {
      await telegram.start(msg => tui.addMessage('system', `tg: ${msg}`));
      tui.addMessage('system', 'telegram started.');
    }
  } else if (choice === 1) {
    process.stdout.write('\n');
    tui.addMessage('system', 'tip: message @userinfobot on telegram to get your ID');
    const userId = await prompt('user ID');
    if (userId) {
      const allowed = cfg.telegramAllowed || [];
      if (!allowed.includes(userId)) { allowed.push(userId); config.set('telegramAllowed', allowed); }
      tui.addMessage('system', `allowed: ${userId}`);
    }
  } else if (choice === 2) {
    const allowed = cfg.telegramAllowed || [];
    tui.addMessage('system', allowed.length ? allowed.join(', ') : 'no users set');
    await prompt('press enter', '');
  } else if (choice === 3) {
    telegram.stop();
    config.set('telegramToken', '');
    tui.addMessage('system', 'telegram removed.');
  }
}

async function _changeProvider(tui) {
  const config = require('../config');
  const engine = require('../core/engine');
  const soul   = require('../core/soul');

  const PROVIDERS = [
    { label: 'OpenAI',      url: 'https://api.openai.com/v1',          model: 'gpt-4o-mini' },
    { label: 'Anthropic',   url: 'https://api.anthropic.com/v1',        model: 'claude-sonnet-4-6' },
    { label: 'Groq',        url: 'https://api.groq.com/openai/v1',      model: 'llama-3.3-70b-versatile' },
    { label: 'Together AI', url: 'https://api.together.xyz/v1',         model: 'meta-llama/Llama-3-70b-chat-hf' },
    { label: 'Mistral',     url: 'https://api.mistral.ai/v1',           model: 'mistral-small-latest' },
    { label: 'Ollama',      url: 'http://localhost:11434/v1',            model: 'llama3' },
    { label: 'NVIDIA NIM',  url: 'https://integrate.api.nvidia.com/v1', model: 'moonshotai/kimi-k2-instruct' },
    { label: 'Custom',      url: '',                                     model: '' },
    { label: 'Back',        url: null,                                   model: null },
  ];

  const p = await createMenu('provider', PROVIDERS.map(p => p.label), tui);
  if (p === -1 || p === 8) return;

  const cfg     = config.load();
  const preset  = PROVIDERS[p];
  process.stdout.write('\n');
  const apiKey  = await prompt('api key', p === 5 ? 'ollama' : cfg.apiKey);
  const baseUrl = await prompt('base url', preset.url || cfg.baseUrl);
  const model   = await prompt('model', preset.model || cfg.model);

  config.save({ ...cfg, apiKey, baseUrl, model });
  engine.init(soul);
  tui.addMessage('system', `switched to ${preset.label} — ${model}`);
}

async function _voiceSettings(tui) {
  const config = require('../config');
  const cfg    = config.load();

  const choice = await createMenu('voice', [
    cfg.elevenLabsKey ? 'voice: on — turn off' : 'voice: off — turn on',
    'change voice ID',
    'test voice',
    'back',
  ], tui);

  if (choice === 0) {
    if (cfg.elevenLabsKey) {
      config.set('elevenLabsKey', '');
      tui.addMessage('system', 'voice disabled.');
    } else {
      process.stdout.write('\n');
      const key = await prompt('ElevenLabs API key');
      if (key) { config.set('elevenLabsKey', key); tui.addMessage('system', 'voice enabled.'); }
    }
  } else if (choice === 1) {
    process.stdout.write('\n');
    const voiceId = await prompt('voice ID', cfg.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM');
    if (voiceId) { config.set('elevenLabsVoiceId', voiceId); tui.addMessage('system', 'voice ID updated.'); }
  } else if (choice === 2) {
    tui.addMessage('system', 'testing voice...');
    try {
      const registry = require('../tools/registry');
      const result   = await registry.execute('elevenlabs', { text: "hey. it's kira." });
      tui.addMessage('system', result);
    } catch { tui.addMessage('error', 'voice tool not built yet. ask kira to build it.'); }
  }
}

async function _memory(tui) {
  const mem  = require('../tools/memory');

  while (true) {
    const choice = await createMenu('memory', [
      'view all',
      'delete a key',
      'wipe all memory',
      'back',
    ], tui);

    if (choice === -1 || choice === 3) break;

    if (choice === 0) {
      const data = mem.load();
      const keys = Object.keys(data);
      process.stdout.write('\n');
      if (!keys.length) {
        tui.addMessage('system', 'memory is empty.');
      } else {
        keys.forEach(k => tui.addMessage('system', `${k}: ${data[k].value}`));
      }
      await prompt('press enter', '');
    } else if (choice === 1) {
      process.stdout.write('\n');
      const key = await prompt('key to delete');
      if (key) { mem.save({ ...mem.load(), [key]: undefined }); tui.addMessage('system', `deleted: ${key}`); }
    } else if (choice === 2) {
      const confirm = await createMenu('wipe all memory?', ['yes, wipe everything', 'cancel'], tui);
      if (confirm === 0) { mem.save({}); tui.addMessage('system', 'memory wiped.'); }
    }
  }
}

async function _scheduler(tui) {
  const scheduler = require('../core/scheduler');

  while (true) {
    const jobs   = scheduler.listJobs();
    const choice = await createMenu('scheduler', [
      'view jobs',
      'remove a job',
      'back',
    ], tui);

    if (choice === -1 || choice === 2) break;

    if (choice === 0) {
      process.stdout.write('\n');
      if (!jobs.length) {
        tui.addMessage('system', 'no scheduled jobs.');
      } else {
        jobs.forEach(j => tui.addMessage('system', `${j.name} (${j.type}) — next: ${j.next} — ran ${j.runs}x`));
      }
      await prompt('press enter', '');
    } else if (choice === 1) {
      process.stdout.write('\n');
      const name = await prompt('job name to remove');
      if (name) {
        const removed = scheduler.removeJob(name);
        tui.addMessage('system', removed ? `removed: ${name}` : `not found: ${name}`);
      }
    }
  }
}

async function _workspace(tui) {
  const workspace = require('../workspace');
  const docs      = Object.keys(workspace.DOCS);

  const choice = await createMenu('workspace', [...docs, 'back'], tui);
  if (choice === -1 || choice === docs.length) return;

  const content = workspace.read(docs[choice]);
  process.stdout.write('\n');
  tui.addMessage('system', content || 'empty.');
  await prompt('press enter', '');
}

async function _deviceInfo(tui) {
  const { execSync } = require('child_process');
  const info = [];
  try { info.push(`device  : ${execSync('getprop ro.product.model',          { encoding: 'utf8', timeout: 2000 }).trim()}`); } catch {}
  try { info.push(`android : ${execSync('getprop ro.build.version.release',   { encoding: 'utf8', timeout: 2000 }).trim()}`); } catch {}
  try { info.push(`arch    : ${execSync('uname -m',                           { encoding: 'utf8', timeout: 2000 }).trim()}`); } catch {}
  info.push(`node    : ${process.version}`);
  info.push(`uptime  : ${require('../core/heartbeat').info().uptime}`);
  process.stdout.write('\n');
  tui.addMessage('system', info.join('\n  '));
  await prompt('press enter', '');
}

async function _dangerZone(tui) {
  const choice = await createMenu('danger zone', [
    'reset setup (keep memory)',
    'wipe all memory',
    'full reset (everything)',
    'back',
  ], tui);

  if (choice === 0) {
    const confirm = await createMenu('reset setup?', ['yes', 'cancel'], tui);
    if (confirm === 0) { require('../config').set('setupDone', false); tui.addMessage('system', 'reset. restart to run setup.'); }
  } else if (choice === 1) {
    const confirm = await createMenu('wipe memory?', ['yes', 'cancel'], tui);
    if (confirm === 0) { require('../tools/memory').save({}); tui.addMessage('system', 'memory wiped.'); }
  } else if (choice === 2) {
    const confirm = await createMenu('full reset? this deletes everything.', ['yes, reset everything', 'cancel'], tui);
    if (confirm === 0) {
      require('../tools/memory').save({});
      require('../config').set('setupDone', false);
      tui.addMessage('system', 'full reset done. restart kira.');
    }
  }
}

// Legacy alias for /config command
const showConfig = showHelp;

module.exports = { showHelp, showConfig, createMenu, prompt };
