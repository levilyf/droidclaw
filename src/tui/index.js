'use strict';
/**
 * KIRA TUI — app shell layout
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  ◈ KIRA  │  ◈ daemon  mood  42t  model         20:34  │  ← header (1 row, fixed)
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │   kira ❯ hey. (boot greeting)                          │  ← chat panel
 * │                                                         │     scrollable
 * │   you  ❯ build me a script                             │     fills space
 * │                                                         │
 * │   kira ❯ sure. here's what I'll do…                    │
 * │                                                         │
 * ├─────────────────────────────────────────────────────────┤
 * │  you ❯ █                                               │  ← input row (1 row, fixed)
 * ├─────────────────────────────────────────────────────────┤
 * │  /help ·config · /clear · /status     ↑↓ scroll  ^C  │  ← footer (1 row, fixed)
 * └─────────────────────────────────────────────────────────┘
 */

const blessed = require('blessed');
const { render: renderMd } = require('./markdown');
const statusPanel   = require('./status');
const commandPalette = require('./command_palette');

// ── Palette ───────────────────────────────────────────────────────────────────
// blessed uses {color-fg} tags. We reference named hex colors via chalk for
// non-blessed output; inside blessed boxes we use blessed tag syntax directly.
const C = {
  kira:       '#5de4c7',
  kiraBright: '#9efce7',
  kiraDim:    '#1f6e5a',
  user:       '#e8b86d',
  userDim:    '#6b4f1e',
  border:     '#1a2e2a',
  headerBg:   '#040d0b',
  footerBg:   '#040d0b',
  panelBg:    '#080f0d',
  inputBg:    '#080f0d',
  sys:        '#3d6b5e',
  muted:      '#1e3530',
  hint:       '#2a4a44',
  error:      '#e05560',
  ok:         '#5de4c7',
  keyLabel:   '#e8b86d',
  keyDesc:    '#2a4a44',
};

// ── Braille spinner ───────────────────────────────────────────────────────────
const SPIN = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

// ── blessed color tag helper ──────────────────────────────────────────────────
const fg  = (color, text) => `{${color}-fg}${text}{/${color}-fg}`;
const dim = (text)        => `{${C.muted}-fg}${text}{/${C.muted}-fg}`;

// Strip ANSI escape codes (chalk output → blessed plain text)
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

// ── TUI ───────────────────────────────────────────────────────────────────────
class TUI {
  constructor() {
    this.onInput        = null;
    this.thinking       = false;

    // blessed widgets
    this._screen   = null;
    this._header   = null;
    this._chat     = null;
    this._inputRow = null;
    this._footer   = null;

    // state
    this._inputBuf      = '';
    this._history       = [];
    this._historyIdx    = -1;
    this._savedInput    = '';
    this._menuMode      = false;
    this._streaming     = false;
    this._streamStarted = false;
    this._streamBuf     = '';
    this._pendingTools  = [];
    this._thinkLabel    = 'thinking';
    this._spinIdx       = 0;
    this._spinTimer     = null;
    this._dots          = null; // legacy alias
  }

  // ── Public init ──────────────────────────────────────────────────────────
  async init(onInput) {
    this.onInput = onInput;

    this._screen = blessed.screen({
      smartCSR:    true,
      fullUnicode: true,
      title:       'kira',
      forceUnicode: true,
    });

    this._buildLayout();
    this._bindKeys();
    statusPanel.attach(this._screen);
    this._screen.render();

    await this._boot();
    setInterval(() => {
      this._refreshHeader();
      if (statusPanel.enabled) statusPanel.update();
      this._screen.render();
    }, 30000);
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  _buildLayout() {
    const s = this._screen;

    // Header — row 0
    this._header = blessed.box({
      parent: s,
      top: 0, left: 0, right: 0, height: 1,
      tags: true,
      style: { bg: C.headerBg },
    });

    // Chat log — fills between header and input. Width shrinks when the
    // status side panel is visible (the panel is positioned `right: 0` with
    // a calculcated width, so we mirror via `right:` on the chat box).
    this._chat = blessed.log({
      parent: s,
      top: 1, left: 0, right: 0, bottom: 3,
      scrollable: true,
      alwaysScroll: true,
      wrap: true,
      tags: true,
      scrollbar: {
        ch: ' ',
        style: { bg: C.kiraDim },
        track: { style: { bg: C.panelBg } },
      },
      style: { bg: C.panelBg },
      padding: { left: 2, right: 3 },
    });
    this._applyStatusLayout();

    // Divider above input
    blessed.line({
      parent: s,
      bottom: 2, left: 0, right: 0,
      orientation: 'horizontal',
      style: { fg: C.border, bg: C.inputBg },
    });

    // Input row
    this._inputRow = blessed.box({
      parent: s,
      bottom: 1, left: 0, right: 0, height: 1,
      tags: true,
      style: { bg: C.inputBg },
      padding: { left: 1 },
    });

    // Footer
    this._footer = blessed.box({
      parent: s,
      bottom: 0, left: 0, right: 0, height: 1,
      tags: true,
      style: { bg: C.footerBg },
      padding: { left: 1 },
    });

    this._refreshHeader();
    this._refreshFooter();
    this._refreshInput();
  }

  // Expand/shrink the chat panel depending on whether the status
  // side panel is visible. The blessed box for the status panel is
  // owned by status.js; we just reserve space by setting `right` here.
  _applyStatusLayout() {
    if (!this._chat || !this._screen) return;
    const reserve = statusPanel.enabled ? Math.max(24, Math.min(34, Math.floor(this._screen.width * 0.3))) + 1 : 0;
    this._chat.right = reserve;
    if (this._header) this._header.right = reserve;
  }

  // ── Header render ────────────────────────────────────────────────────────
  _refreshHeader() {
    if (!this._header) return;

    let daemonGlyph = '◯', daemonCol = C.muted;
    try {
      const fs = require('fs'), os = require('os');
      const pid = parseInt(fs.readFileSync(`${os.homedir()}/.droidclaw/daemon.pid`, 'utf8').trim());
      if (pid && !isNaN(pid)) { process.kill(pid, 0); daemonGlyph = '◈'; daemonCol = C.kira; }
    } catch {}

    let mood = '';
    try { mood = require('../core/mind').getMood() || ''; } catch {}

    let turns = '0';
    try { turns = String(require('../core/engine').stats().turns || 0); } catch {}

    const cfg   = require('../config').load();
    const model = cfg.model ? cfg.model.split('/').pop().slice(0, 14) : '—';
    const tg    = cfg.telegramToken;
    const now   = new Date();
    const time  = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const sep = fg(C.border, ' │ ');

    const left =
      ` {bold}${fg(C.kiraBright, '◈ KIRA')}{/bold}` +
      sep +
      fg(daemonCol, daemonGlyph) +
      (mood  ? '  ' + fg(C.sys, mood)   : '') +
      '  ' + fg(C.muted, turns + 't') +
      '  ' + fg(C.sys, model) +
      (tg   ? '  ' + fg(C.kira, 'tg')  : '');

    const right = fg(C.muted, time + ' ');

    this._header.setContent(left + '{|}' + right);
  }

  // ── Footer render ────────────────────────────────────────────────────────
  _refreshFooter(mode) {
    if (!this._footer) return;
    const dot = fg(C.border, ' · ');

    if (mode === 'thinking') {
      this._footer.setContent(
        fg(C.keyLabel, ' esc') + ' ' + fg(C.keyDesc, 'interrupt')
      );
      return;
    }

    const keys = [
      ['^P',      'palette'],
      ['/help',   'panel'],
      ['^S',      'status'],
      ['/clear',  'history'],
      ['↑↓',      'scroll'],
      ['^C',      'quit'],
    ];

    this._footer.setContent(
      keys.map(([k, d]) => fg(C.keyLabel, k) + ' ' + fg(C.keyDesc, d))
          .join(dot)
    );
  }

  // ── Input row render ─────────────────────────────────────────────────────
  _refreshInput() {
    if (!this._inputRow) return;
    if (this.thinking) {
      this._inputRow.setContent(
        fg(C.kiraDim, SPIN[this._spinIdx % SPIN.length]) +
        '  ' +
        fg(C.sys, this._thinkLabel + '…')
      );
      return;
    }
    const cfg  = require('../config').load();
    const name = (cfg.name || 'you').toLowerCase();
    this._inputRow.setContent(
      fg(C.userDim, name) +
      ' ' + fg(C.kira, '❯') +
      ' ' + fg(C.user, this._inputBuf) +
      fg(C.kira, '▌')
    );
  }

  // ── Key bindings ─────────────────────────────────────────────────────────
  _bindKeys() {
    const s = this._screen;

    s.key(['C-c'], () => process.exit(0));
    s.key(['C-l'], () => { s.realloc(); s.render(); });

    // Command palette (Ctrl+P) — fuzzy picker, surfaced in the footer.
    s.key(['C-p'], () => {
      if (commandPalette.active) return;
      commandPalette.open(s, (label) => {
        // Treat palette selection like normal input so /commands dispatch.
        if (this.onInput) this.onInput(label);
      }, () => { this._refreshInput(); s.render(); });
    });

    // Status side panel toggle (Ctrl+S)
    s.key(['C-s'], () => {
      statusPanel.toggle();
      this._applyStatusLayout();
      if (statusPanel.enabled) statusPanel.update();
      s.render();
    });

    // Scroll
    s.key(['up'],       () => { this._chat.scroll(-3);  s.render(); });
    s.key(['down'],     () => { this._chat.scroll(3);   s.render(); });
    s.key(['pageup'],   () => { this._chat.scroll(-20); s.render(); });
    s.key(['pagedown'], () => { this._chat.scroll(20);  s.render(); });

    // Printable input
    s.on('keypress', (ch, key) => {
      if (this._menuMode) return;
      const name = key && key.name;

      if (name === 'return' || name === 'enter') { this._submit(); return; }

      if (name === 'backspace') {
        if (this._inputBuf.length > 0) {
          const arr = [...this._inputBuf]; arr.pop();
          this._inputBuf = arr.join('');
          this._refreshInput(); s.render();
        }
        return;
      }

      // Shift+up/down for history
      if (key && key.shift && name === 'up')   { this._historyUp();   return; }
      if (key && key.shift && name === 'down')  { this._historyDown(); return; }

      // Skip arrow / ctrl / meta
      if (name === 'up' || name === 'down' || name === 'pageup' || name === 'pagedown') return;
      if (key && (key.ctrl || key.meta)) return;

      if (ch && ch.charCodeAt(0) >= 32) {
        this._inputBuf += ch;
        this._refreshInput(); s.render();
      }
    });
  }

  _submit() {
    const input      = this._inputBuf.trim();
    this._inputBuf   = '';
    this._historyIdx = -1;
    this._savedInput = '';
    this._refreshInput();
    this._screen.render();
    if (!input) return;
    if (this._history[0] !== input) this._history.unshift(input);
    if (this._history.length > 100) this._history.pop();
    // echo into chat
    this._chatAppend('user', input);
    if (this.onInput) this.onInput(input);
  }

  _historyUp() {
    if (!this._history.length) return;
    if (this._historyIdx === -1) this._savedInput = this._inputBuf;
    this._historyIdx = Math.min(this._historyIdx + 1, this._history.length - 1);
    this._inputBuf   = this._history[this._historyIdx];
    this._refreshInput(); this._screen.render();
  }

  _historyDown() {
    if (this._historyIdx === -1) return;
    this._historyIdx--;
    this._inputBuf = this._historyIdx === -1 ? this._savedInput : this._history[this._historyIdx];
    this._refreshInput(); this._screen.render();
  }

  // ── Chat append ──────────────────────────────────────────────────────────
  _chatAppend(type, payload) {
    const W = Math.max(40, (this._screen ? this._screen.width : 80) - 10);

    if (type === 'user') {
      const cfg  = require('../config').load();
      const name = (cfg.name || 'you').toLowerCase();
      this._chat.log('');
      this._chat.log(fg(C.userDim, name) + ' ' + fg(C.kira, '❯') + ' ' + fg(C.user, payload));

    } else if (type === 'kira') {
      const W2     = W;
      const rendered = stripAnsi(renderMd(payload, W2));
      this._chat.log('');
      this._chat.log(fg(C.kiraDim, 'kira') + ' ' + fg(C.kira, '❯'));
      for (const line of rendered.split('\n')) {
        if (line.trim()) {
          this._chat.log('  ' + fg(C.kiraBright, line));
        } else {
          this._chat.log('');
        }
      }

    } else if (type === 'system') {
      const text = payload.replace(/\n/g, ' ').trim().slice(0, W);
      this._chat.log(fg(C.muted, '·') + ' ' + fg(C.sys, text));

    } else if (type === 'error') {
      const errLine = payload.split('\n')[0];
      this._chat.log('');
      this._chat.log(fg(C.error, '✕  ' + errLine));
      const hint = _errorHint(errLine);
      if (hint) this._chat.log(fg(C.muted, '   └ ' + hint));
      this._chat.log('');

    } else if (type === 'tool') {
      const { name: tName, preview, done } = payload;
      const icon = done ? fg(C.kiraDim, '✓') : fg(C.kira, '⟳');
      const col  = done ? C.muted : C.kira;
      this._chat.log(icon + ' ' + fg(col, tName.padEnd(14)) + ' ' + fg(C.sys, (preview || '').slice(0, W - 18)));
    }

    this._screen.render();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  async _boot() {
    await this._sleep(60);

    this._chat.log('');
    this._chat.log(fg(C.border, '  ╭──────────────────────────────────────╮'));
    await this._sleep(30);
    this._chat.log(fg(C.border, '  │') + '  {bold}' + fg(C.kiraBright, '◈  K I R A') + '{/bold}' + '                    ' + fg(C.border, '│'));
    await this._sleep(30);
    this._chat.log(fg(C.border, '  │') + '     ' + fg(C.kiraDim, 'persistent · observing') + '       ' + fg(C.border, '│'));
    await this._sleep(30);
    this._chat.log(fg(C.border, '  ╰──────────────────────────────────────╯'));
    this._chat.log('');
    this._screen.render();
    await this._sleep(60);

    const h = new Date().getHours();
    const greet = h < 5 ? 'still up.' : h < 12 ? 'morning.' : h < 17 ? 'hey.' : h < 21 ? 'evening.' : 'late.';
    this._chat.log(fg(C.kiraDim, 'kira') + ' ' + fg(C.kira, '❯') + ' ' + fg(C.sys, greet));
    this._chat.log('');
    this._screen.render();
  }

  // ── Public message API ───────────────────────────────────────────────────
  addMessage(type, text) {
    const str = String(text);

    if (type === 'agent') {
      this._stopSpin();
      this.thinking       = false;
      this._streaming     = false;
      this._streamStarted = false;
      this._streamBuf     = '';
      this._pendingTools  = [];
      this._chatAppend('kira', str);
      this._refreshInput();
      this._refreshFooter();
      this._screen.render();

    } else if (type === 'tool' || type === 'tool_start') {
      const done             = type === 'tool';
      const { name, preview } = this._parseToolLabel(str);
      const existing = this._pendingTools.find(t => t.name === name);
      if (!existing) {
        this._pendingTools.push({ name, preview, done });
        this._chatAppend('tool', { name, preview, done });
      } else {
        existing.done = done; existing.preview = preview;
      }
      this._screen.render();

    } else if (type === 'system') {
      this._chatAppend('system', str);

    } else if (type === 'error') {
      this._stopSpin();
      this.thinking       = false;
      this._streaming     = false;
      this._streamStarted = false;
      this._pendingTools  = [];
      this._chatAppend('error', str);
      this._refreshInput();
      this._refreshFooter();
      this._screen.render();
    }
  }

  /**
   * appendToken(token) — called from index.js onToken handler for live stream.
   * index.js must be patched to call this instead of process.stdout.write.
   */
  appendToken(token) {
    if (!this._streamStarted) {
      this._streamStarted = true;
      this._stopSpin();
      this.thinking = false;
      this._streamBuf = '';
      this._chat.log('');
      this._chat.log(fg(C.kiraDim, 'kira') + ' ' + fg(C.kira, '❯'));
      this._refreshInput();
    }
    this._streamBuf += token;
    // flush complete lines
    const parts = this._streamBuf.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i].trim()) {
        this._chat.log('  ' + fg(C.kiraBright, stripAnsi(parts[i])));
      } else {
        this._chat.log('');
      }
    }
    this._streamBuf = parts[parts.length - 1];
    this._screen.render();
  }

  finishStream() {
    if (this._streamBuf.trim()) {
      this._chat.log('  ' + fg(C.kiraBright, stripAnsi(this._streamBuf)));
    }
    this._streamBuf     = '';
    this._streamStarted = false;
    this._streaming     = false;
    this.thinking       = false;
    this._pendingTools  = [];
    this._refreshInput();
    this._refreshFooter();
    this._screen.render();
  }

  setThinkingLabel(label) {
    this._thinkLabel = label || 'thinking';
    if (this.thinking) { this._refreshInput(); this._screen.render(); }
  }

  setThinking(on, label) {
    this.thinking   = on;
    this._streaming = on;
    if (on) {
      this._streamStarted = false;
      this._streamBuf     = '';
      this._pendingTools  = [];
      this._thinkLabel    = label || 'thinking';
      this._spinIdx       = 0;
      this._spinTimer     = setInterval(() => {
        this._spinIdx++;
        this._refreshInput();
        this._screen.render();
      }, 80);
      this._refreshFooter('thinking');
    } else {
      this._stopSpin();
      this._refreshFooter();
    }
    this._refreshInput();
    this._screen.render();
  }

  _stopSpin() {
    if (this._spinTimer) { clearInterval(this._spinTimer); this._spinTimer = null; }
    this._dots = null;
  }

  // ── Menu overlay hooks (called by menu.js) ────────────────────────────────
  enterMenuMode() {
    this._menuMode = true;
    // menu.js now renders via blessed modal widgets and registers its own key
    // handlers, so we no longer need to lock stdin here.
  }

  exitMenuMode() {
    this._menuMode = false;
    this._inputBuf = '';
    this._refreshInput();
    this._refreshFooter();
    if (this._screen) this._screen.render();
  }

  // ── Legacy stubs (index.js uses these internal fields) ───────────────────
  _kiraPrompt() {} // no-op — blessed handles layout

  // ── Helpers ──────────────────────────────────────────────────────────────
  _parseToolLabel(str) {
    const first = str.split('\n')[0].trim();
    const colon = first.indexOf(':');
    if (colon > 0 && colon < 40) {
      return { name: first.slice(0, colon).trim().slice(0, 18), preview: first.slice(colon + 1).trim() };
    }
    const space = first.indexOf(' ');
    if (space > 0 && space < 20) return { name: first.slice(0, space), preview: first.slice(space + 1) };
    return { name: first.slice(0, 18), preview: '' };
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

function _errorHint(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('api key') || m.includes('unauthorized') || m.includes('401')) return 'check /config → provider & model';
  if (m.includes('econnrefused') || m.includes('network')) return 'network unreachable';
  if (m.includes('timeout'))                               return 'request timed out';
  if (m.includes('rate limit') || m.includes('429'))      return 'rate limited — wait';
  if (m.includes('context') || m.includes('token'))       return 'try /clear to reduce context';
  return '';
}

module.exports = new TUI();
