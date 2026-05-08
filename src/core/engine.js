'use strict';
const iris   = require('./iris');
const mind   = require('./mind');
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
    const system = this.soul ? this.soul.buildSystemPrompt(userMessage) : 'You are Kira — an AI agent living on Android/Termux. Speak lowercase, be direct, use your tools.';
    this.history.push({ role: 'user', content: userMessage });
    if (this.history.length > 20) this.history = this.history.slice(-20);
    const emotionState = _readEmotion();
    const lpm          = _readLPM();
    const routing      = iris.route(userMessage, emotionState, lpm);
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

  // ── Streaming chat ──────────────────────────────────────────────────────────
  // onToken(text) called for each chunk as it arrives
  // onDone(fullText) called when stream ends
  // returns AbortController so caller can cancel mid-stream
  // now includes retry logic for transient errors
  chatStream(userMessage, onToken, onDone, retries = 3) {
    const cfg = config.load();
    if (!cfg.apiKey) { onDone(''); return null; }

    const system     = this.soul ? this.soul.buildSystemPrompt(userMessage) : 'You are Kira.';
    this.history.push({ role: 'user', content: userMessage });
    if (this.history.length > 20) this.history = this.history.slice(-20);

    const emotionState = _readEmotion();
    const lpm          = _readLPM();
    const routing      = iris.route(userMessage, emotionState, lpm);
    const irisSystem   = system + '\n\n' + routing.styleInjection;

    const controller = new AbortController();
    let attempt = 0;

    const doStream = () => {
      attempt++;
      this._streamRequest(irisSystem, this.history, cfg, routing.profile.maxTokens, controller.signal, onToken)
        .then(fullText => {
          this.history.push({ role: 'assistant', content: fullText });
          onDone && onDone(fullText);
        })
        .catch(err => {
          if (err.name === 'AbortError') {
            // clean up history — remove the user message we pushed
            this.history = this.history.slice(0, -1);
            onDone && onDone(null); // null = interrupted
          } else if (attempt < retries && _isRetryableError(err)) {
            // retry on rate limits or transient errors
            console.log(`[engine] stream attempt ${attempt} failed, retrying in ${attempt * 2}s...`);
            setTimeout(doStream, attempt * 2000);
          } else {
            console.error('[engine] stream error:', err.message);
            onDone && onDone('');
          }
        });
    };

    // run async, return controller immediately so TUI can abort
    doStream();

    return controller;
  }

  async _streamRequest(system, messages, cfg, maxTokens, signal, onToken) {
    if (this._isAnthropic(cfg)) {
      return await this._streamAnthropic(system, messages, cfg, maxTokens, signal, onToken);
    }
    return await this._streamOpenAI(system, messages, cfg, maxTokens, signal, onToken);
  }

  async _streamOpenAI(system, messages, cfg, maxTokens, signal, onToken) {
    const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const res  = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body:    JSON.stringify({ model: cfg.model, messages: msgs, max_tokens: maxTokens || 2048, stream: true }),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   full    = '';
    let   buf     = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // flush remaining buffer — this fixes incomplete last sentences
        if (buf.trim()) {
          const trimmed = buf.trim();
          if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
            try {
              const json  = JSON.parse(trimmed.slice(6));
              const token = json.choices?.[0]?.delta?.content || '';
              if (token) { full += token; onToken && onToken(token); }
            } catch {}
          }
        }
        break;
      }

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json  = JSON.parse(trimmed.slice(6));
          const token = json.choices?.[0]?.delta?.content || '';
          if (token) { full += token; onToken && onToken(token); }
        } catch {}
      }
    }

    return full;
  }

  async _streamAnthropic(system, messages, cfg, maxTokens, signal, onToken) {
    const body = { model: cfg.model || 'claude-sonnet-4-6', max_tokens: maxTokens || 2048, messages, stream: true };
    if (system) body.system = system;

    const res = await fetch(`${cfg.baseUrl}/messages`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   full    = '';
    let   buf     = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json  = JSON.parse(trimmed.slice(6));
          if (json.type === 'content_block_delta') {
            const token = json.delta?.text || '';
            if (token) { full += token; onToken && onToken(token); }
          }
        } catch {}
      }
    }

    return full;
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

  _isRetryableError(err) {
    // Retry on rate limits (429) or temporary network issues
    const msg = err.message || '';
    return msg.includes('429') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('network');
  }
}

function _readEmotion() {
  try {
    return {
      tension:    parseFloat(mind.getState('emotion_tension')    || 0),
      connection: parseFloat(mind.getState('emotion_connection') || 0.5),
      energy:     parseFloat(mind.getState('emotion_energy')     || 0.8),
      focus:      parseFloat(mind.getState('emotion_focus')      || 0.5),
    };
  } catch { return { tension: 0, connection: 0.5, energy: 0.8, focus: 0.5 }; }
}

function _readLPM() {
  const lpm = { identity: [], patterns: [], triggers: [], needs: [], foresight: [] };
  try {
    mind.getBeliefs(null, 0.5).forEach(b => {
      if (lpm[b.dimension]) lpm[b.dimension].push(b.value);
    });
  } catch {}
  return lpm;
}

module.exports = new Engine();
