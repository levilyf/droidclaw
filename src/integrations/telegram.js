'use strict';
const https  = require('https');
const loop   = require('../core/loop');
const config = require('../config');

class Telegram {
  constructor() {
    this.token    = null;
    this.offset   = 0;
    this.running  = false;
    this.allowed  = [];
    this.busy     = new Set(); // per-chat rate limiting
  }

  init() {
    const cfg    = config.load();
    this.token   = cfg.telegramToken;
    this.allowed = cfg.telegramAllowed || [];
    return !!this.token;
  }

  async start(log) {
    if (!this.init()) { log && log('token not set. use /config'); return; }
    this.running = true;
    log && log('telegram started');
    this._poll(log);
  }

  stop() { this.running = false; }

  async _poll(log) {
    while (this.running) {
      try {
        const updates = await this._req('getUpdates', { offset: this.offset, timeout: 5, limit: 10 });
        for (const u of (updates.result || [])) {
          this.offset = u.update_id + 1;
          this._handle(u, log); // don't await — handle concurrently
        }
      } catch (e) {
        log && log('poll error: ' + e.message);
        await this._sleep(5000);
      }
      await this._sleep(1000);
    }
  }

  async _handle(update, log) {
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const text   = msg.text;
    const who    = msg.from.username || msg.from.first_name || userId;

    // Auth check
    if (this.allowed.length && !this.allowed.includes(userId)) {
      await this._req('sendMessage', { chat_id: chatId, text: 'not authorized.' });
      return;
    }

    // Handle /start
    if (text === '/start') {
      await this._req('sendMessage', { chat_id: chatId, text: `droidclaw connected. what do you need, ${who.toLowerCase()}?` });
      return;
    }

    // Rate limit: skip if chat already processing
    if (this.busy.has(chatId)) {
      await this._req('sendMessage', { chat_id: chatId, text: 'still working on that...' });
      return;
    }

    this.busy.add(chatId);
    log && log(`${who}: ${text}`);

    try {
      await this._req('sendChatAction', { chat_id: chatId, action: 'typing' });
      let reply = '';
      await loop.run(text, () => {}, () => {}, r => { reply = r; });
      await this._req('sendMessage', { chat_id: chatId, text: (reply || 'done.').slice(0, 4096) });
    } catch (e) {
      await this._req('sendMessage', { chat_id: chatId, text: 'error: ' + e.message });
    } finally {
      this.busy.delete(chatId);
    }
  }

  _req(method, params) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(params);
      const req  = https.request({
        hostname: 'api.telegram.org',
        path:     `/bot${this.token}/${method}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout:  15000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad json')); } });
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('timeout')));
      req.write(body);
      req.end();
    });
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = new Telegram();
