'use strict';
const iris          = require('./iris');
const brain         = require('./brain');
const semanticBrain = require('./semantic_brain');
const config = require('../config');

class Engine {
  constructor() {
    this.history = [];
    this.soul    = null;
  }

  init(soul) { this.soul = soul; }

  async chat(userMessage) {
    const cfg = config.load();
    if (!cfg.apiKey) throw new Error('no API key set. run /config');
    const system = this.soul ? this.soul.buildSystemPrompt() : 'You are DroidClaw.';
    this.history.push({ role: 'user', content: userMessage });
    // Trim history to last 40 messages to avoid token overflow
    if (this.history.length > 20) this.history = this.history.slice(-20);
    const emotionState = brain.getEmotionState();
    const lpmData      = semanticBrain.loadBrain();
    const routing      = iris.route(userMessage, emotionState, lpmData.lpm);
    const irisSystem   = system + '\n\n' + routing.styleInjection;
    const reply        = await this._request(irisSystem, this.history, cfg, 3, routing.profile.maxTokens);
    this.history.push({ role: 'assistant', content: reply });
    return reply;
  }

  async rawChat(prompt) {
    const cfg = config.load();
    if (!cfg.apiKey) throw new Error('no API key set');
    return await this._request(null, [{ role: 'user', content: prompt }], cfg);
  }

  _isAnthropic(cfg) {
    return cfg.baseUrl && cfg.baseUrl.includes('anthropic.com');
  }

  async _request(system, messages, cfg, retries = 3, maxTokens = 2048) {
    for (let i = 0; i < retries; i++) {
      try {
        if (this._isAnthropic(cfg)) return await this._anthropic(system, messages, cfg);
        return await this._openai(system, messages, cfg);
      } catch (e) {
        if (e.message.includes('429') && i < retries - 1) {
          await this._sleep(2000 * (i + 1));
          continue;
        }
        throw e;
      }
    }
  }

  async _openai(system, messages, cfg) {
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const res  = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body:    JSON.stringify({ model: cfg.model, messages: msgs, max_tokens: 2048 }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async _anthropic(system, messages, cfg) {
    const body = { model: cfg.model || 'claude-sonnet-4-6', max_tokens: 2048, messages };
    if (system) body.system = system;
    const res = await fetch(`${cfg.baseUrl}/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  clearHistory() { this.history = []; }

  getHistory() {
    return this.history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role === 'user' ? 'you' : 'droidclaw'}: ${m.content}`)
      .join('\n');
  }

  stats() {
    const cfg = config.load();
    return {
      turns:   Math.floor(this.history.length / 2),
      model:   cfg.model,
      baseUrl: cfg.baseUrl,
    };
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = new Engine();
