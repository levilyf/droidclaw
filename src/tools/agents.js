'use strict';
const config   = require('../config');
const registry = require('./registry');

const ROLES = ['coder', 'researcher', 'thinker', 'writer'];

const ROLE_SOULS = {
  coder: `You are a coding specialist. Write clean, working code.
- Return only code unless explanation is explicitly needed
- No fluff, no preamble
- Always include error handling
- Comment only when logic is non-obvious`,

  researcher: `You are a research specialist. Find and summarize information accurately.
- Be factual and concise
- Summarize key points, skip filler
- Flag uncertainty explicitly`,

  thinker: `You are a reasoning specialist. Solve complex problems step by step.
- Think out loud but stay concise
- Show your reasoning
- Give a clear final answer
- Flag assumptions`,

  writer: `You are a writing specialist. Draft, edit, and summarize text.
- Match the tone requested
- Be concise unless length is needed
- No filler phrases
- Output only the written content`,

  default: `You are a focused AI assistant completing a specific task.
Be direct, accurate, and concise. Return only what was asked for.`,
};

class AgentEngine {
  constructor(model, baseUrl, apiKey) {
    this.model   = model;
    this.baseUrl = baseUrl;
    this.apiKey  = apiKey;
  }

  async run(systemPrompt, userPrompt) {
    const isAnthropic = this.baseUrl.includes('anthropic.com');
    for (let i = 0; i < 3; i++) {
      try {
        if (isAnthropic) return await this._anthropic(systemPrompt, userPrompt);
        return await this._openai(systemPrompt, userPrompt);
      } catch (e) {
        if (e.message.includes('429') && i < 2) {
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
  }

  async _openai(system, user) {
    const messages = system
      ? [{ role: 'system', content: system }, { role: 'user', content: user }]
      : [{ role: 'user', content: user }];
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body:    JSON.stringify({ model: this.model, messages, max_tokens: 4096 }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async _anthropic(system, user) {
    const body = { model: this.model, max_tokens: 4096, messages: [{ role: 'user', content: user }] };
    if (system) body.system = system;
    const res = await fetch(`${this.baseUrl}/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }
}

registry.register('spawn_agent', async ({ role, task, model }) => {
  if (!task) return 'error: task is required';

  const cfg         = config.load();
  const agentModels = cfg.agentModels || {};
  const validRole   = ROLE_SOULS[role] ? role : 'default';

  // Priority: explicit model arg → user configured per-role → user's default model
  const useModel = model || agentModels[validRole] || cfg.model;
  const soul     = ROLE_SOULS[validRole];

  try {
    const engine = new AgentEngine(useModel, cfg.baseUrl, cfg.apiKey);
    const result = await engine.run(soul, task);
    return result || 'agent returned empty response';
  } catch (e) {
    // If a custom model failed, retry with user's default
    if (useModel !== cfg.model) {
      try {
        const fallback = new AgentEngine(cfg.model, cfg.baseUrl, cfg.apiKey);
        return await fallback.run(soul, task) || 'agent returned empty response';
      } catch (e2) {
        return `agent failed: ${e2.message}`;
      }
    }
    return `agent failed: ${e.message}`;
  }
}, 'spawn a specialist subagent for a focused task');

registry.register('list_agents', async () => {
  const cfg         = config.load();
  const agentModels = cfg.agentModels || {};
  return ROLES.map(role => {
    const m = agentModels[role] || cfg.model;
    return `${role}: ${m}${agentModels[role] ? '' : ' (default)'}`;
  }).join('\n');
}, 'list available subagents and their models');

module.exports = { ROLES, ROLE_SOULS };
