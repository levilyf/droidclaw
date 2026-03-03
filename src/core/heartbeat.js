'use strict';
const workspace = require('../workspace');

class Heartbeat {
  constructor() {
    this.startTime = null;
    this.messages  = 0;
    this.interval  = null;
    this.status    = 'stopped';
  }

  start() {
    this.startTime = new Date();
    this.status    = 'alive';
    this.interval  = setInterval(() => { this.status = 'alive'; }, 5 * 60 * 1000);
    process.once('SIGINT',  () => this.stop(true));
    process.once('SIGTERM', () => this.stop(true));
  }

  tick() { this.messages++; }

  stop(graceful = false) {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.status = 'stopped';
    if (graceful && this.startTime) {
      const mins = Math.round((new Date() - this.startTime) / 60000);
      try {
        workspace.logSession(`- duration: ${mins}m\n- messages: ${this.messages}\n- exit: clean`);
      } catch {}
    }
    process.exit(0);
  }

  uptime() {
    if (!this.startTime) return '0s';
    const s = Math.round((new Date() - this.startTime) / 1000);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m`;
    return `${Math.floor(s/3600)}h`;
  }

  info() {
    return { status: this.status, uptime: this.uptime(), messages: this.messages };
  }
}

module.exports = new Heartbeat();
