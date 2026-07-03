'use strict';
/**
 * status.js — blessed side panel for live system state.
 *
 * Attached as a real widget on the blessed screen (no raw ANSI), so it
 * co-operates with resizes and never desyncs blessed's render loop.
 * Toggled with Ctrl+S; auto-updated by tui/index.js on each render tick.
 */

const blessed = require('blessed');

const C = {
  kira:       '#5de4c7',
  kiraBright: '#9efce7',
  kiraDim:    '#1f6e5a',
  border:     '#1a2e2a',
  rule:       '#162320',
  muted:      '#1e3530',
  sys:        '#3d6b5e',
  user:       '#e8b86d',
  label:      '#2a4a44',
  value:      '#5de4c7',
  valueDim:   '#3d6b5e',
  ok:         '#5de4c7',
  off:        '#1e3530',
  panelBg:    '#080f0d',
};

const fg = (color, text) => `{${color}-fg}${text}{/${color}-fg}`;

class StatusPanel {
  constructor() {
    this.enabled = false;
    this._box    = null;
    this._screen = null;
  }

  attach(screen) {
    if (this._screen) return;
    this._screen = screen;
    this._box = blessed.box({
      parent: screen,
      top: 1, right: 0, width: self => Math.max(24, Math.min(34, Math.floor(self.width * 0.3))),
      bottom: 3,
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: C.border, bg: C.panelBg }, bg: C.panelBg },
      padding: { left: 1, right: 1 },
      hidden: true,
    });
    this._screen.on('resize', () => this.update());
  }

  show() {
    if (!this._box) return;
    this.enabled = true;
    this._box.show();
    this.update();
  }

  hide() {
    if (!this._box) return;
    this.enabled = false;
    this._box.hide();
  }

  toggle() { this.enabled ? this.hide() : this.show(); }

  update() {
    if (!this._box || !this.enabled) return;
    const d   = this._data();
    const boxW = this._box.width - 4;
    const rule = fg(C.rule, '─'.repeat(Math.max(0, boxW)));

    const row = (label, value) => {
      const v = String(value);
      const pad = Math.max(1, 9 - label.length);
      return ' ' + fg(C.label, label) + ' '.repeat(pad) + v;
    };

    const lines = [
      ' ' + fg(C.kiraBright, 'status') + ' ' + fg(C.muted, '·'),
      rule,
      row('daemon',   d.daemon),
      row('mood',     d.mood),
      row('turns',    d.turns),
      row('uptime',   d.uptime),
      row('model',    d.model),
      row('telegram', d.telegram),
      rule,
      ' ' + fg(C.user, d.name),
      ' ' + fg(C.muted, new Date().toLocaleTimeString()),
    ];
    this._box.setContent(lines.join('\n'));
    if (this._screen) this._screen.render();
  }

  _data() {
    const cfg   = require('../config').load();
    const stats = require('../core/engine').stats();
    const hb    = require('../core/heartbeat').info();

    let daemon = fg(C.off, 'offline');
    try {
      const fs  = require('fs');
      const os  = require('os');
      const pid = parseInt(fs.readFileSync(`${os.homedir()}/.droidclaw/daemon.pid`, 'utf8').trim());
      if (pid && !isNaN(pid)) { process.kill(pid, 0); daemon = fg(C.ok, 'active'); }
    } catch {}

    let mood = fg(C.muted, '—');
    try { mood = fg(C.value, require('../core/mind').getMood() || '—'); } catch {}

    const model    = cfg.model ? cfg.model.split('/').pop().slice(0, 14) : '?';
    const telegram = cfg.telegramToken ? fg(C.ok, 'on') : fg(C.off, 'off');
    const uptime   = hb && hb.uptime ? hb.uptime() : '0m';

    return {
      daemon, mood,
      turns:  String((stats && stats.turns) || 0),
      uptime, model, telegram,
      name:   cfg.name || 'you',
    };
  }
}

module.exports = new StatusPanel();