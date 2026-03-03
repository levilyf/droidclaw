'use strict';
const chalk    = require('chalk');
const heartbeat = require('../core/heartbeat');
const engine   = require('../core/engine');
const config   = require('../config');

const C = {
  primary: '#f4a7b9',
  dim:     '#a0607a',
  muted:   '#3d1a2a',
  accent:  '#f9d0dc',
  mid:     '#7a4060',
  hint:    '#4a2038',
  error:   '#e05555',
};

const KIRA_ART = [
  ``,
  `  ██╗  ██╗██╗██████╗  █████╗ `,
  `  ██║ ██╔╝██║██╔══██╗██╔══██╗`,
  `  █████╔╝ ██║██████╔╝███████║`,
  `  ██╔═██╗ ██║██╔══██╗██╔══██║`,
  `  ██║  ██╗██║██║  ██║██║  ██║`,
  `  ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝`,
  ``,
  `         android. terminal. alive.`,
  ``,
];

class TUI {
  constructor() {
    this.onInput       = null;
    this.thinking      = false;
    this._dots         = null;
    this._inputBuf     = '';
    this._rawMode      = false;
    this._menuMode     = false;
  }

  async init(onInput) {
    this.onInput = onInput;
    console.clear();

    for (const line of KIRA_ART) {
      if (line.includes('█')) {
        const idx = KIRA_ART.indexOf(line);
        process.stdout.write((idx % 2 === 0 ? chalk.hex(C.primary) : chalk.hex(C.dim))(line) + '\n');
      } else {
        process.stdout.write(chalk.hex(C.hint)(line) + '\n');
      }
      await this._sleep(35);
    }

    this._statusLine();
    const cfg = config.load();
    process.stdout.write('\n' + chalk.hex(C.dim)(`  hey ${cfg.name.toLowerCase()}.\n\n`));

    this._startRawInput();
  }

  _startRawInput() {
    if (this._rawMode) return;
    this._rawMode = true;
    this._inputBuf = '';

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    this._showPrompt();

    process.stdin.on('data', this._onKey.bind(this));
  }

  _showPrompt() {
    if (this.thinking || this._menuMode) return;
    const cfg = config.load();
    const name = (cfg.name || 'you').charAt(0).toUpperCase() + (cfg.name || 'you').slice(1).toLowerCase();
    process.stdout.write(
      chalk.hex(C.dim)('  ⟩ ') + chalk.hex(C.mid)(name) + chalk.hex(C.dim)(' › ')
    );
  }

  _kiraPrompt() {
    process.stdout.write(
      chalk.hex(C.dim)('\n  ⟩ ') + chalk.hex(C.primary)('Kira') + chalk.hex(C.dim)(' › ')
    );
  }

  _onKey(key) {
    if (this._menuMode) return;

    const code = key.charCodeAt(0);

    // Ctrl+C
    if (key === '\u0003') process.exit(0);

    // Enter
    if (key === '\r' || key === '\n') {
      const input = this._inputBuf.trim();
      this._inputBuf = '';
      process.stdout.write('\n');
      if (input && this.onInput) {
        this.onInput(input);
      } else {
        this._showPrompt();
      }
      return;
    }

    // Backspace
    if (key === '\u007f' || key === '\u0008') {
      if (this._inputBuf.length > 0) {
        this._inputBuf = this._inputBuf.slice(0, -1);
        process.stdout.write('\u0008 \u0008');
      }
      return;
    }

    // Ignore escape sequences
    if (code === 27) return;

    // Printable chars
    if (code >= 32) {
      this._inputBuf += key;
      process.stdout.write(chalk.hex(C.mid)(key));
    }
  }

  enterMenuMode() {
    this._menuMode = true;
    // Clear current input line
    process.stdout.write('\x1b[2K\r');
  }

  exitMenuMode() {
    this._menuMode = false;
    this._inputBuf = '';
    if (!this.thinking) this._showPrompt();
  }

  _statusLine() {
    const hb    = heartbeat.info();
    const stats = engine.stats();
    const cfg   = config.load();
    const tg    = cfg.telegramToken ? 'tg:on' : 'tg:off';
    // Shorten model name — show only part after last /
    const model = stats.model ? stats.model.split('/').pop() : 'no model';
    console.log(chalk.hex(C.hint)(
      `  ◈ ${hb.status}  ·  ${hb.uptime}  ·  ${stats.turns} turns  ·  ${model}  ·  ${tg}`
    ));
  }

  addMessage(type, text) {
    // Clear current line
    process.stdout.write('\x1b[2K\r');

    const lines = String(text).split('\n');

    if (type === 'agent') {
      this._kiraPrompt();
      this._streamText(lines.join('\n  '), C.accent, () => {
        process.stdout.write('\n');
        this.thinking = false;
        this._showPrompt();
      });
    } else if (type === 'tool') {
      const clean = String(text).split('\n')[0].slice(0, 100);
      process.stdout.write(chalk.hex(C.mid)(`  ${clean}\n`));
      if (!this.thinking) this._showPrompt();
    } else if (type === 'system') {
      process.stdout.write('\x1b[2K\r\n' + chalk.hex(C.dim)('  ' + lines.join('\n  ') + '\n'));
      if (!this.thinking) this._showPrompt();
    } else if (type === 'error') {
      process.stdout.write('\n' + chalk.hex(C.error)(`  ! ${lines.join('\n  ')}\n`));
      this.thinking = false;
      this._showPrompt();
    }
  }

  _streamText(text, color, done) {
    let i = 0;
    const chars = text.split('');
    const interval = setInterval(() => {
      if (i >= chars.length) { clearInterval(interval); done && done(); return; }
      process.stdout.write(chalk.hex(color)(chars[i]));
      i++;
    }, 8);
  }

  setThinking(on) {
    this.thinking = on;
    if (on) {
      const frames = ['⟳', '⟲'];
      let i = 0;
      process.stdout.write('\x1b[2K\r  ');
      this._dots = setInterval(() => {
        process.stdout.write(`\x1b[2K\r  ${chalk.hex(C.dim)(frames[i % 2])}`);
        i++;
      }, 250);
    } else {
      if (this._dots) { clearInterval(this._dots); this._dots = null; }
      process.stdout.write('\x1b[2K\r');
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = new TUI();
