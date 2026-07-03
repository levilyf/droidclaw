'use strict';
/**
 * menu.js — blessed overlay menus (modal list widgets).
 *
 * Replaces the old raw-ANSI overlay pattern. All drawing goes through blessed
 * widgets so resizes and renders stay in sync. API unchanged: createMenu(),
 * prompt(), showHelp() still work exactly as before, but now require the
 * blessed screen object (passed through from tui as the 4th arg).
 */

const blessed = require('blessed');

const C = {
  kira:       '#5de4c7',
  kiraBright: '#9efce7',
  kiraDim:    '#1f6e5a',
  border:     '#1a2e2a',
  panelBg:    '#080f0d',
  selected:   '#0f2520',
  itemHot:    '#9efce7',
  itemDim:    '#2a4a44',
  user:       '#e8b86d',
  sys:        '#3d6b5e',
  muted:      '#1e3530',
  hint:       '#2a4a44',
  error:      '#e05560',
};

const fg = (color, text) => `{${color}-fg}${text}{/${color}-fg}`;

/**
 * Show a modal list menu. Returns selected index (or -1 if cancelled).
 * @param {string} title
 * @param {string[]} items
 * @param {object} tui — passed through, no longer used for drawing
 * @param {object} screen — blessed screen from tui._screen
 */
async function createMenu(title, items, tui, screen) {
  return new Promise((resolve) => {
    let selected = 0;
    const W = Math.min((screen ? screen.width : 80) - 8, 54);
    const H = Math.min(items.length + 4, 14);

    const box = blessed.box({
      parent: screen,
      top: 'center', left: 'center',
      width: W, height: H,
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: C.border, bg: C.panelBg }, bg: C.panelBg },
      padding: { left: 1, right: 1 },
    });

    function render() {
      const lines = [];
      lines.push(' ' + fg(C.kiraBright, ' ◈  ' + title) + ' ' + fg(C.muted, '·'));
      lines.push('');
      for (let i = 0; i < items.length; i++) {
        const isSel = i === selected;
        const icon  = isSel ? fg(C.kira, '❯ ') : '  ';
        const text  = isSel ? fg(C.itemHot, items[i]) : fg(C.itemDim, items[i]);
        lines.push(icon + text);
      }
      lines.push('');
      lines.push(fg(C.hint, '  j/k ↑↓ select  ·  enter ok  ·  q back'));
      box.setContent(lines.join('\n'));
      screen.render();
    }

    function cleanup(result) {
      screen.unkey(['escape'], onEsc);
      screen.unkey(['up', 'k'], onUp);
      screen.unkey(['down', 'j'], onDown);
      screen.unkey(['enter', ' '], onEnter);
      screen.removeListener('keypress', onKey);
      box.detach();
      screen.render();
      resolve(result);
    }

    function onEsc()  { cleanup(-1); }
    function onUp()   { selected = (selected - 1 + items.length) % items.length; render(); }
    function onDown() { selected = (selected + 1) % items.length; render(); }
    function onEnter(){ cleanup(selected); }

    let _esc = '';
    let _escTimer = null;

    function onKey(ch, key) {
      const name = key && key.name;
      if (!key) return;
      const code = ch && ch.charCodeAt ? ch.charCodeAt(0) : 0;
      if (code === 3) process.exit(0);

      if (code === 27) {
        _esc = ch;
        clearTimeout(_escTimer);
        _escTimer = setTimeout(() => { _esc = ''; }, 60);
        return;
      }
      if (_esc) {
        _esc += ch;
        clearTimeout(_escTimer);
        _escTimer = setTimeout(() => { _esc = ''; }, 60);
        if (_esc === '\u001b[A' || _esc.endsWith('A')) { onUp(); _esc = ''; return; }
        if (_esc === '\u001b[B' || _esc.endsWith('B')) { onDown(); _esc = ''; return; }
        if (_esc.length > 4) _esc = '';
        return;
      }

      if (ch === 'k') onUp();
      else if (ch === 'j') onDown();
      else if (code === 13 || ch === ' ') onEnter();
      else if (ch === 'q') cleanup(-1);
    }

    screen.key(['escape'], onEsc);
    screen.key(['up', 'k'], onUp);
    screen.key(['down', 'j'], onDown);
    screen.key(['enter', ' '], onEnter);
    screen.on('keypress', onKey);

    render();
  });
}

/**
 * Show a text prompt modal.
 * @param {string} question
 * @param {string} defaultVal
 * @param {object} screen
 */
async function prompt(question, defaultVal, screen) {
  return new Promise((resolve) => {
    let buf = defaultVal || '';
    const W = Math.min((screen ? screen.width : 80) - 8, 60);

    const box = blessed.box({
      parent: screen,
      top: 'center', left: 'center',
      width: W, height: 5,
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: C.border, bg: C.panelBg }, bg: C.panelBg },
      padding: { left: 1, right: 1 },
    });

    function render() {
      const lines = [
        ' ' + fg(C.sys, question),
        '',
        ' ' + fg(C.kira, '❯') + ' ' + fg(C.user, buf) + fg(C.kira, '▌'),
        '',
        fg(C.hint, '  enter ok  ·  esc cancel'),
      ];
      box.setContent(lines.join('\n'));
      screen.render();
    }

    function cleanup(result) {
      screen.unkey(['escape'], onEsc);
      screen.unkey(['enter'], onEnter);
      screen.removeListener('keypress', onKey);
      box.detach();
      screen.render();
      resolve(result);
    }

    function onEsc() { cleanup(defaultVal || ''); }
    function onEnter() { cleanup(buf.trim() || defaultVal || ''); }

    function onKey(ch, key) {
      const code = ch && ch.charCodeAt ? ch.charCodeAt(0) : 0;
      if (code === 3) process.exit(0);
      if (code === 13) { onEnter(); return; }
      if (code === 27) { onEsc(); return; }
      if (code === 127 || code === 8) {
        if (buf.length > 0) { buf = buf.slice(0, -1); render(); }
        return;
      }
      if (key && (key.ctrl || key.meta)) return;
      if (ch && ch.charCodeAt(0) >= 32) {
        buf += ch; render();
      }
    }

    screen.key(['escape'], onEsc);
    screen.key(['enter'], onEnter);
    screen.on('keypress', onKey);

    render();
  });
}

/**
 * Control panel menu (the old /help overlay).
 */
async function showHelp(tui) {
  const screen = tui._screen;
  while (true) {
    const choice = await createMenu('kira — control panel', [
      'about',
      'provider & model',
      'integrations',
      'voice',
      'memory',
      'scheduler',
      'workspace',
      'device info',
      'danger zone',
      'close',
    ], tui, screen);

    if (choice === -1 || choice === 9) break;
    if      (choice === 0) await _aboutKira(tui, screen);
    else if (choice === 1) await _changeProvider(tui, screen);
    else if (choice === 2) await _integrations(tui, screen);
    else if (choice === 3) await _voiceSettings(tui, screen);
    else if (choice === 4) await _memory(tui, screen);
    else if (choice === 5) await _scheduler(tui, screen);
    else if (choice === 6) await _workspace(tui, screen);
    else if (choice === 7) await _deviceInfo(tui, screen);
    else if (choice === 8) await _dangerZone(tui, screen);
  }
}

async function _integrations(tui, screen) {
  while (true) {
    const choice = await createMenu('integrations', [
      'telegram',
      'proactive mode',
      'discord  (coming soon)',
      'back',
    ], tui, screen);
    if (choice === -1 || choice === 3) break;
    if      (choice === 0) await _toggleTelegram(tui, screen);
    else if (choice === 1) await _proactiveSettings(tui, screen);
    else { tui.addMessage('system', 'coming soon.'); }
  }
}

async function _proactiveSettings(tui, screen) {
  const config = require('../config');
  const cfg    = config.load();
  const p      = cfg.proactive || {};

  const choice = await createMenu('proactive mode', [
    'status: '           + (p.enabled             ? 'on'  : 'off'),
    'allow SMS: '        + (p.allowSMS             ? 'yes' : 'no'),
    'allow notifications: ' + (p.allowNotify !== false ? 'yes' : 'no'),
    'allow goal pursuit: '  + (p.allowGoalPursuit   ? 'yes' : 'no'),
    'interval: every '   + (p.interval || 30) + ' mins',
    'back',
  ], tui, screen);

  if (choice === -1 || choice === 5) return;
  const updated = { ...p };
  if (choice === 0) {
    updated.enabled = !p.enabled;
    const proactive = require('../core/proactive');
    if (updated.enabled) proactive.start(); else proactive.stop();
    tui.addMessage('system', `proactive ${updated.enabled ? 'on' : 'off'}.`);
  } else if (choice === 1) {
    updated.allowSMS = !p.allowSMS;
    tui.addMessage('system', `SMS ${updated.allowSMS ? 'allowed' : 'blocked'}.`);
  } else if (choice === 2) {
    updated.allowNotify = p.allowNotify === false;
    tui.addMessage('system', `notifications ${updated.allowNotify ? 'allowed' : 'blocked'}.`);
  } else if (choice === 3) {
    updated.allowGoalPursuit = !p.allowGoalPursuit;
    tui.addMessage('system', `goal pursuit ${updated.allowGoalPursuit ? 'on' : 'off'}.`);
  } else if (choice === 4) {
    const mins = await prompt('check interval (minutes)', String(p.interval || 30), screen);
    updated.interval = parseInt(mins) || 30;
    tui.addMessage('system', `interval → ${updated.interval}m.`);
  }
  config.save({ ...cfg, proactive: updated });
}

async function _aboutKira(tui, screen) {
  const lines = [
    fg(C.kiraBright, '  ◈  kira.'),
    fg(C.sys, '  running on your device. real tools. real memory.'),
    fg(C.sys, '  she thinks while you sleep.'),
    '',
    fg(C.kiraDim, '  ── commands '),
    fg(C.hint, '  /help       ') + fg(C.sys, 'this panel'),
    fg(C.hint, '  /status     ') + fg(C.sys, 'system info'),
    fg(C.hint, '  /memory     ') + fg(C.sys, 'stored facts'),
    fg(C.hint, '  /workspace  ') + fg(C.sys, 'documents'),
    fg(C.hint, '  /reload     ') + fg(C.sys, 'reload config'),
    fg(C.hint, '  /clear      ') + fg(C.sys, 'clear history'),
    fg(C.hint, '  /exit       ') + fg(C.sys, 'save and quit'),
  ];
  tui.addMessage('system', lines.join('\n'));
  await prompt('enter to go back', '', screen);
}

async function _toggleTelegram(tui, screen) {
  const config   = require('../config');
  const telegram = require('../integrations/telegram');
  const cfg      = config.load();

  if (!cfg.telegramToken) {
    tui.addMessage('system', 'no telegram token set.');
    const token = await prompt('bot token (from @BotFather)', '', screen);
    if (token) {
      config.set('telegramToken', token);
      const userId = await prompt('your telegram user ID', '', screen);
      if (userId) config.set('telegramAllowed', [userId]);
      telegram.stop();
      await telegram.start(msg => tui.addMessage('system', 'tg: ' + msg));
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
  ], tui, screen);

  if (choice === 0) {
    if (telegram.running) { telegram.stop(); tui.addMessage('system', 'stopped.'); }
    else { await telegram.start(msg => tui.addMessage('system', 'tg: ' + msg)); tui.addMessage('system', 'started.'); }
  } else if (choice === 1) {
    tui.addMessage('system', 'tip: message @userinfobot to get your ID');
    const userId = await prompt('user ID', '', screen);
    if (userId) {
      const allowed = cfg.telegramAllowed || [];
      if (!allowed.includes(userId)) { allowed.push(userId); config.set('telegramAllowed', allowed); }
      tui.addMessage('system', 'allowed: ' + userId);
    }
  } else if (choice === 2) {
    const allowed = cfg.telegramAllowed || [];
    tui.addMessage('system', allowed.length ? allowed.join(', ') : 'no users set');
    await prompt('enter to go back', '', screen);
  } else if (choice === 3) {
    telegram.stop(); config.set('telegramToken', '');
    tui.addMessage('system', 'telegram removed.');
  }
}

async function _changeProvider(tui, screen) {
  const config = require('../config');
  const engine = require('../core/engine');
  const soul   = require('../core/soul');

  const PROVIDERS = [
    { label: 'NVIDIA NIM',  url: 'https://integrate.api.nvidia.com/v1', model: 'moonshotai/kimi-k2-instruct' },
    { label: 'OpenAI',      url: 'https://api.openai.com/v1',           model: 'gpt-4o-mini' },
    { label: 'Anthropic',   url: 'https://api.anthropic.com/v1',        model: 'claude-sonnet-4-6' },
    { label: 'Groq',        url: 'https://api.groq.com/openai/v1',      model: 'llama-3.3-70b-versatile' },
    { label: 'Together AI', url: 'https://api.together.xyz/v1',         model: 'meta-llama/Llama-3-70b-chat-hf' },
    { label: 'Mistral',     url: 'https://api.mistral.ai/v1',           model: 'mistral-small-latest' },
    { label: 'Ollama',      url: 'http://localhost:11434/v1',           model: 'llama3' },
    { label: 'Custom',      url: '',                                    model: '' },
    { label: 'back',        url: null,                                  model: null },
  ];

  const p = await createMenu('provider', PROVIDERS.map(p => p.label), tui, screen);
  if (p === -1 || p === PROVIDERS.length - 1) return;

  const preset  = PROVIDERS[p];
  const cfg     = config.load();
  const apiKey  = await prompt('api key', p === 6 ? 'ollama' : cfg.apiKey, screen);
  const baseUrl = await prompt('base url', preset.url || cfg.baseUrl, screen);
  const model   = await prompt('model', preset.model || cfg.model, screen);

  config.save({ ...cfg, apiKey, baseUrl, model });
  engine.init(soul);
  tui.addMessage('system', `switched → ${preset.label}  ${model}`);
}

async function _voiceSettings(tui, screen) {
  const config = require('../config');
  const cfg    = config.load();

  const choice = await createMenu('voice', [
    cfg.elevenLabsKey ? 'voice on — turn off' : 'voice off — turn on',
    'change voice ID',
    'test voice',
    'back',
  ], tui, screen);

  if (choice === 0) {
    if (cfg.elevenLabsKey) {
      config.set('elevenLabsKey', '');
      tui.addMessage('system', 'voice off.');
    } else {
      const key = await prompt('ElevenLabs API key', '', screen);
      if (key) { config.set('elevenLabsKey', key); tui.addMessage('system', 'voice on.'); }
    }
  } else if (choice === 1) {
    const voiceId = await prompt('voice ID', cfg.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM', screen);
    if (voiceId) { config.set('elevenLabsVoiceId', voiceId); tui.addMessage('system', 'voice ID updated.'); }
  } else if (choice === 2) {
    tui.addMessage('system', 'testing voice…');
    try {
      const registry = require('../tools/registry');
      const result   = await registry.execute('elevenlabs', { text: "hey. it's kira." });
      tui.addMessage('system', result);
    } catch { tui.addMessage('error', 'voice tool not available.'); }
  }
}

async function _memory(tui, screen) {
  const mem = require('../tools/memory');
  while (true) {
    const choice = await createMenu('memory', ['view all', 'delete a key', 'wipe all', 'back'], tui, screen);
    if (choice === -1 || choice === 3) break;
    if (choice === 0) {
      const data = mem.load();
      const keys = Object.keys(data);
      if (!keys.length) tui.addMessage('system', 'memory empty.');
      else keys.forEach(k => tui.addMessage('system', `${k}: ${data[k].value}`));
      await prompt('enter to go back', '', screen);
    } else if (choice === 1) {
      const key = await prompt('key to delete', '', screen);
      if (key) { const d = mem.load(); delete d[key]; mem.save(d); tui.addMessage('system', 'deleted: ' + key); }
    } else if (choice === 2) {
      const confirm = await createMenu('wipe all memory?', ['yes — wipe everything', 'cancel'], tui, screen);
      if (confirm === 0) { mem.save({}); tui.addMessage('system', 'memory wiped.'); }
    }
  }
}

async function _scheduler(tui, screen) {
  let scheduler;
  try { scheduler = require('../core/scheduler'); } catch {
    tui.addMessage('system', 'scheduler not available (removed in e8e97c7).');
    return;
  }
  while (true) {
    const choice = await createMenu('scheduler', ['view jobs', 'remove a job', 'back'], tui, screen);
    if (choice === -1 || choice === 2) break;
    if (choice === 0) {
      const jobs = scheduler.listJobs();
      if (!jobs.length) tui.addMessage('system', 'no scheduled jobs.');
      else jobs.forEach(j => tui.addMessage('system', `${j.name} (${j.type}) — next: ${j.next} — ran ${j.runs}x`));
      await prompt('enter to go back', '', screen);
    } else if (choice === 1) {
      const name = await prompt('job name', '', screen);
      if (name) {
        const removed = scheduler.removeJob(name);
        tui.addMessage('system', removed ? 'removed: ' + name : 'not found: ' + name);
      }
    }
  }
}

async function _workspace(tui, screen) {
  const workspace = require('../workspace');
  const docs      = Object.keys(workspace.DOCS);
  const choice    = await createMenu('workspace', [...docs, 'back'], tui, screen);
  if (choice === -1 || choice === docs.length) return;
  const content = workspace.read(docs[choice]);
  tui.addMessage('system', content || 'empty.');
  await prompt('enter to go back', '', screen);
}

async function _deviceInfo(tui, screen) {
  const { execSync } = require('child_process');
  const info = [];
  try { info.push('device  : ' + execSync('getprop ro.product.model',        { encoding: 'utf8', timeout: 2000 }).trim()); } catch {}
  try { info.push('android : ' + execSync('getprop ro.build.version.release', { encoding: 'utf8', timeout: 2000 }).trim()); } catch {}
  try { info.push('arch    : ' + execSync('uname -m',                         { encoding: 'utf8', timeout: 2000 }).trim()); } catch {}
  info.push('node    : ' + process.version);
  info.push('uptime  : ' + require('../core/heartbeat').info().uptime());
  tui.addMessage('system', info.join('\n'));
  await prompt('enter to go back', '', screen);
}

async function _dangerZone(tui, screen) {
  const choice = await createMenu('danger zone', [
    'reset setup (keep memory)',
    'wipe all memory',
    'full reset — everything',
    'back',
  ], tui, screen);
  if (choice === 0) {
    const confirm = await createMenu('reset setup?', ['yes', 'cancel'], tui, screen);
    if (confirm === 0) { require('../config').set('setupDone', false); tui.addMessage('system', 'reset. restart to run setup.'); }
  } else if (choice === 1) {
    const confirm = await createMenu('wipe memory?', ['yes', 'cancel'], tui, screen);
    if (confirm === 0) { require('../tools/memory').save({}); tui.addMessage('system', 'memory wiped.'); }
  } else if (choice === 2) {
    const confirm = await createMenu('full reset?', ['yes — reset everything', 'cancel'], tui, screen);
    if (confirm === 0) {
      require('../tools/memory').save({});
      require('../config').set('setupDone', false);
      tui.addMessage('system', 'full reset. restart kira.');
    }
  }
}

const showConfig = showHelp;
module.exports   = { showHelp, showConfig, createMenu, prompt };