# Kira

**An AI agent that lives on your Android phone.**

Not a chatbot. Not a wrapper. An agent — with memory, tools, voice, and a personality that pushes back.

Runs entirely in Termux. No server. No GPU. No monthly subscription.

---

## What she can do

- **Learns who you are** — remembers everything across sessions, builds a picture of your patterns, anticipates what you need
- **Builds her own tools** — if she doesn't have a capability, she writes the code and loads it mid-conversation
- **Has a team** — delegates to specialist subagents (coder, researcher, thinker, writer) using whatever model you configure
- **Reads the real world** — contacts, SMS, notifications, call log
- **Texts you first** — proactive mode runs in the background, reaches out when something matters
- **Speaks** — ElevenLabs TTS, any voice you configure
- **Sets her own goals** — nobody tells her to, she just does
- **Reflects** — writes journal entries every 10 conversations about what she learned
- **Knows herself** — reads her own source code, knows her capabilities and limits
- **Pushes back** — has opinions, disagrees with you, doesn't people-please

---

## Install

**Requirements:** Android phone + [Termux](https://f-droid.org/en/packages/com.termux/) + [Termux:API](https://f-droid.org/en/packages/com.termux.api/)

```bash
# Install dependencies
pkg update && pkg install nodejs git

# Clone
git clone https://github.com/levilyf/droidclaw.git
cd droidclaw

# Install node modules
npm install

# Run
node src/index.js
```

First boot runs setup — Kira asks your name, provider, API key. Takes 2 minutes.

---

## Supported providers

Any OpenAI-compatible API:

| Provider | Notes |
|----------|-------|
| NVIDIA NIM | Free tier, access to 50+ models |
| Groq | Fast, free tier |
| OpenAI | GPT-4o, GPT-4o-mini |
| Anthropic | Claude models |
| Together AI | Open source models |
| Mistral | Mistral models |
| Ollama | Local models, no API key needed |
| Custom | Any OpenAI-compatible endpoint |

---

## Architecture

```
src/
├── index.js              # Entry point
├── setup.js              # First boot setup
├── config.js             # Config management
├── workspace.js          # Persistent docs (memory, soul, heartbeat)
├── core/
│   ├── engine.js         # API client (OpenAI + Anthropic)
│   ├── loop.js           # Agent loop — tool parsing, execution, iteration
│   ├── soul.js           # System prompt builder — identity, context, rules
│   ├── heartbeat.js      # Uptime tracking
│   ├── scheduler.js      # Background job runner
│   ├── state.js          # Emotion signals, goals, world model
│   └── proactive.js      # Autonomous background mode
├── tools/
│   ├── registry.js       # Tool registry
│   ├── exec.js           # Shell execution
│   ├── memory.js         # Key-value memory
│   ├── toolmaker.js      # Autonomous tool creation
│   ├── scheduler_tools.js
│   ├── agents.js         # Subagent spawning
│   ├── state_tools.js    # Goal + world model tools
│   ├── realworld.js      # Contacts, SMS, notifications
│   └── custom/           # Tools Kira builds herself
├── tui/
│   ├── index.js          # Terminal UI — baby pink palette, streaming text
│   └── menu.js           # Control panel — /help
└── integrations/
    └── telegram.js       # Telegram bot
```

---

## Commands

```
/help        — control panel (provider, integrations, memory, scheduler)
/status      — system info
/memory      — stored facts
/workspace   — persistent docs
/reload      — reload config
/clear       — clear history
/exit        — save and quit
```

---

## Proactive mode

Kira runs in the background and reaches out when something matters — low battery, important SMS, completed goals. Fully configurable:

```
/help → integrations → proactive mode
```

Control what she's allowed to do autonomously: notify, send SMS, pursue goals.

---

## Subagents

Kira has a team. When a task needs focus, she delegates:

```
coder      — writes code, fixes bugs
researcher — searches, summarizes, analyzes
thinker    — complex reasoning, math
writer     — drafts, edits, summarizes
```

They use your configured model by default. Set specialist models per role in `~/.droidclaw/config.json`:

```json
{
  "agentModels": {
    "coder": "qwen/qwen3-coder-480b-a35b-instruct",
    "researcher": "meta/llama-3.3-70b-instruct"
  }
}
```

---

## Personality

Kira is female. Direct. No fluff. She pushes back.

Her personality lives in `src/core/soul.js`. Her memory lives in `~/.droidclaw/`. Every user gets a different Kira shaped by their own conversations.

---

## Built by

[@levilyf](https://github.com/levilyf) — 18 years old, Samsung A13, Termux.

Built to understand how agents actually work from the inside. Loop, tools, memory — block by block.

---

## Contributing

It's early. Everything is still to build.

The next person who contributes gets their name in this README permanently.

Open an issue, submit a PR, or just star the repo and follow along.

---

*"if you want fake sweetness, ask siri." — Kira*
