'use strict';
/**
 * command_palette.js
 * Renders a fuzzy-search command picker as a blessed overlay box,
 * centered on screen, on top of the chat panel.
 */

const blessed = require('blessed');

const C = {
  kira:      '#5de4c7',
  kiraBright:'#9efce7',
  kiraDim:   '#1f6e5a',
  border:    '#1a2e2a',
  panelBg:   '#0b1e19',
  selected:  '#0f2520',
  labelHot:  '#9efce7',
  labelDim:  '#2a4a44',
  desc:      '#3d6b5e',
  user:      '#e8b86d',
  hint:      '#1e3530',
  muted:     '#1e3530',
};

const COMMANDS = [
  { label: '/help',        desc: 'commands & settings' },
  { label: '/config',      desc: 'configure kira' },
  { label: '/status',      desc: 'system status' },
  { label: '/skills',      desc: 'list skills' },
  { label: '/memory',      desc: 'view memory' },
  { label: '/memory list', desc: 'list all keys' },
  { label: '/workspace',   desc: 'workspace files' },
  { label: '/reload',      desc: 'reload config' },
  { label: '/clear',       desc: 'clear history' },
  { label: '/exit',        desc: 'save and quit' },
];

function fuzzyScore(cmd, query) {
  const label = cmd.label.toLowerCase();
  const desc  = cmd.desc.toLowerCase();
  const q     = query.toLowerCase();
  if (label === q)          return 1000;
  if (label.startsWith(q)) return 800 + q.length;
  if (label.includes(q))   return 600 + q.length;
  if (desc.includes(q))    return 300 + q.length;
  let score = 0, qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) { score += 10; qi++; }
  }
  return qi < q.length ? -1 : score - label.length;
}

const fg = (color, text) => `{${color}-fg}${text}{/${color}-fg}`;

class CommandPalette {
  constructor() {
    this.active    = false;
    this._box      = null;
    this._screen   = null;
    this.selected  = 0;
    this.filter    = '';
    this._onSelect = null;
    this._onClose  = null;
  }

  open(screen, onSelect, onClose) {
    if (this.active) return;
    this.active    = true;
    this._screen   = screen;
    this._onSelect = onSelect;
    this._onClose  = onClose;
    this.selected  = 0;
    this.filter    = '';

    const W = Math.min(screen.width - 8, 56);
    const H = 14;

    this._box = blessed.box({
      parent: screen,
      top:    'center',
      left:   'center',
      width:  W,
      height: H,
      tags:   true,
      border: { type: 'line' },
      style: {
        border: { fg: C.kiraDim, bg: C.panelBg },
        bg: C.panelBg,
      },
      shadow: false,
      padding: { left: 1, right: 1 },
    });

    this._render();

    screen.key(['escape'], this._handleEsc = () => this.close());
    screen.key(['up', 'k'],    this._handleUp   = () => { this.selected = Math.max(0, this.selected - 1); this._render(); screen.render(); });
    screen.key(['down', 'j'],  this._handleDown = () => { this.selected = Math.min(this._filtered().length - 1, this.selected + 1); this._render(); screen.render(); });
    screen.key(['enter'],      this._handleEnter = () => {
      const cmds = this._filtered();
      if (cmds[this.selected]) { const sel = cmds[this.selected].label; this.close(); if (this._onSelect) this._onSelect(sel); }
    });

    screen.on('keypress', this._handleKey = (ch, key) => {
      if (!this.active) return;
      const name = key && key.name;
      if (name === 'backspace') {
        this.filter   = this.filter.slice(0, -1);
        this.selected = 0;
        this._render(); screen.render();
        return;
      }
      if (key && (key.ctrl || key.meta)) return;
      if (name === 'up' || name === 'down' || name === 'enter' || name === 'escape') return;
      if (ch && ch.charCodeAt(0) >= 32) {
        this.filter  += ch;
        this.selected = 0;
        this._render(); screen.render();
      }
    });

    screen.render();
  }

  close() {
    if (!this.active) return;
    this.active = false;

    if (this._screen) {
      this._screen.unkey(['escape'],  this._handleEsc);
      this._screen.unkey(['up', 'k'], this._handleUp);
      this._screen.unkey(['down', 'j'], this._handleDown);
      this._screen.unkey(['enter'],   this._handleEnter);
      this._screen.removeListener('keypress', this._handleKey);
    }

    if (this._box) { this._box.detach(); this._box = null; }
    if (this._screen) { this._screen.render(); }
    if (this._onClose) this._onClose();
    this._onClose  = null;
    this._onSelect = null;
    this._screen   = null;
  }

  _filtered() {
    if (!this.filter) return COMMANDS;
    return COMMANDS
      .map(c => ({ cmd: c, score: fuzzyScore(c, this.filter) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.cmd);
  }

  _render() {
    if (!this._box) return;
    const cmds   = this._filtered();
    const maxH   = 8;
    const top    = Math.max(0, Math.min(this.selected - 3, cmds.length - maxH));
    const W      = (this._screen ? this._screen.width : 80);
    const boxW   = Math.min(W - 8, 56) - 4;
    const lines  = [];

    // Title + search
    lines.push(fg(C.kiraDim, '⌘ command') + ' ' + fg(C.muted, '─'.repeat(Math.max(0, boxW - 12))));
    lines.push('');

    const cur    = fg(C.user, this.filter) + (this.filter ? '' : fg(C.hint, 'search…')) + fg(C.kira, '▌');
    lines.push(cur);
    lines.push(fg(C.kiraDim, '─'.repeat(boxW)));

    // Results
    const visible = cmds.slice(top, top + maxH);
    for (let i = 0; i < maxH; i++) {
      if (i >= visible.length) { lines.push(''); continue; }
      const idx   = top + i;
      const cmd   = visible[i];
      const isSel = idx === this.selected;
      const icon  = isSel ? fg(C.kira, '❯ ') : '  ';
      const label = isSel ? fg(C.kiraBright, cmd.label.padEnd(16)) : fg(C.labelDim, cmd.label.padEnd(16));
      const desc  = isSel ? fg(C.desc, cmd.desc) : fg(C.hint, cmd.desc);
      lines.push(icon + label + '  ' + desc);
    }

    // Footer
    lines.push(fg(C.kiraDim, '─'.repeat(boxW)));
    lines.push(
      fg(C.user, '↑↓') + fg(C.hint, ' navigate  ') +
      fg(C.user, '↵')  + fg(C.hint, ' select  ') +
      fg(C.user, 'esc') + fg(C.hint, ' close')
    );

    this._box.setContent(lines.join('\n'));
  }
}

module.exports = new CommandPalette();
