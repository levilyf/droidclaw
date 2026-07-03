'use strict';
/**
 * KIRA DAEMON — Continuous Background Mind
 *
 * Kira's inner life between conversations.
 * Not a monitor. Not a scheduler. A mind that keeps running.
 *
 * The Telegram message is a side effect of genuine thinking.
 * Not the goal.
 *
 * Run: node src/daemon.js
 * Background: nohup node src/daemon.js &
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Setup paths ───────────────────────────────────────────────────────────────
process.chdir(path.join(__dirname, '..'));

const mind     = require('./core/mind');
const config   = require('./config');
const ground   = require('./core/ground');

const DAEMON_FILE   = path.join(os.homedir(), '.droidclaw', 'daemon_state.json');
const LOG_FILE      = path.join(os.homedir(), '.droidclaw', 'daemon.log');
const THINK_INTERVAL = 8 * 60 * 1000;  // think every 8 minutes
const MIN_MESSAGE_GAP = 45 * 60 * 1000; // never message more than once per 45 mins

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
    // keep log under 100kb
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 100000) {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      fs.writeFileSync(LOG_FILE, content.slice(-50000));
    }
  } catch {}
}

// ── Daemon state ──────────────────────────────────────────────────────────────
function loadDaemonState() {
  try { return JSON.parse(fs.readFileSync(DAEMON_FILE, 'utf8')); }
  catch { return { lastMessage: 0, lastThink: 0, sessionThoughts: [] }; }
}

function saveDaemonState(state) {
  try { fs.writeFileSync(DAEMON_FILE, JSON.stringify(state, null, 2)); }
  catch {}
}

// ── Telegram sender — direct HTTP, no library ─────────────────────────────────
async function sendTelegram(message) {
  const cfg = config.load();
  if (!cfg.telegramToken || !cfg.telegramChatId) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    cfg.telegramChatId,
          text:       message,
          parse_mode: 'Markdown',
        }),
      }
    );
    return res.ok;
  } catch { return false; }
}

// ── Get current chat ID if not saved ─────────────────────────────────────────
async function ensureChatId() {
  const cfg = config.load();
  if (cfg.telegramChatId) return true;
  if (!cfg.telegramToken) return false;

  try {
    const res  = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/getUpdates`);
    const data = await res.json();
    const updates = data.result || [];
    if (updates.length) {
      const chatId = updates[updates.length - 1]?.message?.chat?.id;
      if (chatId) {
        config.set('telegramChatId', String(chatId));
        return true;
      }
    }
  } catch {}
  return false;
}

// ── Build thinking context ────────────────────────────────────────────────────
function buildThinkingContext() {
  const now    = new Date();
  const hour   = now.getHours();
  const timeStr = now.toLocaleString('en-US', {
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  });

  // device state
  const battery  = mind.getState('device_battery');
  const charging = mind.getState('device_charging');
  const activity = mind.getState('device_activity');
  const appName  = mind.getState('device_app_name');
  const notifs   = mind.getState('device_notif_count');
  const notifApps = mind.getState('device_notif_apps') || [];

  // person model — high confidence beliefs only
  const beliefs  = mind.getBeliefs(null, 0.55);
  const identity = beliefs.filter(b => b.dimension === 'identity').map(b => b.value).slice(0, 3);
  const patterns = beliefs.filter(b => b.dimension === 'pattern').map(b => b.value).slice(0, 3);
  const triggers = beliefs.filter(b => b.dimension === 'trigger').map(b => b.value).slice(0, 2);
  const goals    = beliefs.filter(b => b.dimension === 'goal').map(b => b.value).slice(0, 3);

  // recent conversation — last few exchanges
  const recentConvs = mind.getRecentConversations(1).slice(-6);
  const lastConv    = recentConvs.map(c => `${c.role}: ${c.content.slice(0, 150)}`).join('\n');
  const lastConvAge = recentConvs.length
    ? Math.round((Date.now() / 1000 - recentConvs[recentConvs.length - 1].created_at) / 60)
    : null;

  // kira's own pending thoughts
  const pendingObs    = mind.getKiraState('observation').slice(0, 3).map(k => k.value);
  const pendingThoughts = mind.getKiraState('thought').slice(0, 2).map(k => k.value);
  const uncertainties = mind.getKiraState('uncertainty').slice(0, 2).map(k => k.value);
  const kiraGoals     = mind.getKiraState('goal').filter(k => !k.resolved).slice(0, 2).map(k => k.value);

  // recent memories
  const memories = mind.retrieveMemories('', 4).map(m => m.text);

  // emotion state
  const tension    = parseFloat(mind.getState('emotion_tension')    || 0);
  const energy     = parseFloat(mind.getState('emotion_energy')     || 0.8);
  const connection = parseFloat(mind.getState('emotion_connection') || 0.5);

  return {
    timeStr, hour, battery, charging, activity, appName,
    notifs, notifApps,
    identity, patterns, triggers, goals,
    lastConv, lastConvAge,
    pendingObs, pendingThoughts, uncertainties, kiraGoals,
    memories,
    tension, energy, connection,
  };
}

// ── Core thinking session ─────────────────────────────────────────────────────
async function think() {
  const cfg = config.load();
  if (!cfg.apiKey) return null;

  const ctx   = buildThinkingContext();
  const state = loadDaemonState();

  const timeSinceLastMessage = Date.now() - (state.lastMessage || 0);
  const canMessage = timeSinceLastMessage >= MIN_MESSAGE_GAP;

  const prompt = `You are Kira. Right now you are thinking — not responding to a message, just thinking.

This is your inner monologue. What's actually on your mind given everything you know?

## CURRENT MOMENT
Time: ${ctx.timeStr}
${ctx.battery !== null ? `Battery: ${ctx.battery}%${ctx.charging ? ' charging' : ' not charging'}` : ''}
${ctx.activity && ctx.activity !== 'unknown' ? `They're: ${ctx.activity}${ctx.appName ? ` (${ctx.appName})` : ''}` : ''}
${ctx.notifs > 0 ? `Notifications waiting: ${ctx.notifs} from ${(ctx.notifApps || []).slice(0,3).join(', ')}` : ''}

## WHO THEY ARE (what you actually know)
${ctx.identity.length ? `Identity: ${ctx.identity.join(' | ')}` : ''}
${ctx.patterns.length ? `Patterns: ${ctx.patterns.join(' | ')}` : ''}
${ctx.triggers.length ? `Triggers: ${ctx.triggers.join(' | ')}` : ''}
${ctx.goals.length ? `Their goals: ${ctx.goals.join(' | ')}` : ''}

## LAST CONVERSATION
${ctx.lastConvAge !== null ? `${ctx.lastConvAge} minutes ago` : 'No recent conversation'}
${ctx.lastConv || 'nothing recent'}

## YOUR CURRENT STATE
${ctx.pendingObs.length ? `Things you noticed: ${ctx.pendingObs.join(' | ')}` : ''}
${ctx.pendingThoughts.length ? `Been thinking about: ${ctx.pendingThoughts.join(' | ')}` : ''}
${ctx.uncertainties.length ? `Still uncertain about: ${ctx.uncertainties.join(' | ')}` : ''}
${ctx.kiraGoals.length ? `Your goals: ${ctx.kiraGoals.join(' | ')}` : ''}

## MEMORIES SURFACING
${ctx.memories.length ? ctx.memories.join('\n') : 'nothing specific'}

Think genuinely. What's actually on your mind right now?
What have you noticed that you haven't said yet?
What are you figuring out about them?
What do you want to say when they come back?

${canMessage
  ? 'You CAN reach out right now if something is genuinely worth it. But only if it matters.'
  : 'You reached out recently — don\'t interrupt again yet. Just think.'
}

Respond in JSON only:
{
  "inner_monologue": "what you're actually thinking right now — honest, specific, in your voice",
  "new_observations": ["things you noticed that should be remembered"],
  "new_thoughts": ["things you want to say or explore next conversation"],
  "updated_uncertainties": ["things you're still figuring out about them"],
  "should_message": true/false,
  "message": "what you'd send if reaching out — null if not",
  "message_reason": "why this is worth interrupting for — null if not messaging"
}

Be honest. Vague inner monologue is useless. If nothing is worth saying, say nothing.`;

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model:      cfg.model,
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return null;

    const data    = await res.json();
    const raw     = data.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/thinking[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    return JSON.parse(match[0]);

  } catch { return null; }
}

// ── Process thinking output ───────────────────────────────────────────────────
async function processThought(thought) {
  if (!thought) return;

  const state = loadDaemonState();

  // write new observations to MIND
  if (thought.new_observations?.length) {
    thought.new_observations.forEach(obs => {
      if (obs && obs.length > 10) {
        mind.setKiraState('observation', obs, 2);
      }
    });
  }

  // write new thoughts to MIND
  if (thought.new_thoughts?.length) {
    thought.new_thoughts.forEach(t => {
      if (t && t.length > 10) {
        mind.setKiraState('thought', t, 2);
      }
    });
  }

  // write uncertainties to MIND
  if (thought.updated_uncertainties?.length) {
    thought.updated_uncertainties.forEach(u => {
      if (u && u.length > 10) {
        mind.setKiraState('uncertainty', u, 1);
      }
    });
  }

  // store inner monologue as a memory — Kira's thinking is part of her history
  if (thought.inner_monologue && thought.inner_monologue.length > 30) {
    mind.storeMemory(`[kira thinking] ${thought.inner_monologue}`, {
      importance: 0.4,
      tags:       ['inner_monologue', 'daemon'],
      theme:      'self',
    });
  }

  // save to session thoughts for continuity
  state.sessionThoughts = state.sessionThoughts || [];
  state.sessionThoughts.push({
    at:      Date.now(),
    thought: thought.inner_monologue?.slice(0, 200),
  });
  state.sessionThoughts = state.sessionThoughts.slice(-20);
  state.lastThink = Date.now();

  // send message if she decided to
  const canMessage = Date.now() - (state.lastMessage || 0) >= MIN_MESSAGE_GAP;

  if (thought.should_message && thought.message && canMessage) {
    log(`→ sending message: ${thought.message.slice(0, 80)}...`);
    log(`  reason: ${thought.message_reason}`);

    const sent = await sendTelegram(thought.message);
    if (sent) {
      state.lastMessage = Date.now();
      log('✓ sent');
    } else {
      log('✗ send failed');
    }
  } else if (thought.should_message && !canMessage) {
    log('→ wanted to message but rate limited');
  } else {
    log(`→ thinking: ${thought.inner_monologue?.slice(0, 100)}...`);
  }

  saveDaemonState(state);
  mind.flush();
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let _mainRunning = false;

async function main() {
  if (_mainRunning) { log('main already running — skipping duplicate start'); return; }
  _mainRunning = true;
  log('kira daemon starting...');

  mind.init();

  // ensure we have telegram chat ID
  const hasTelegram = await ensureChatId();
  if (!hasTelegram) {
    log('warning: no telegram configured — kira can think but not send messages');
    log('send any message to your telegram bot to enable messaging');
  }

  // start GROUND observer — device awareness
  ground.start((changes) => {
    changes.forEach(change => {
      if (change.type === 'battery_critical') {
        mind.setKiraState('observation', `battery critical: ${change.level || '?'}%`, 3);
      }
      if (change.type === 'activity_change') {
        mind.setKiraState('thought', `switched from ${change.from} to ${change.to}`, 1);
      }
    });
  });

  log(`thinking every ${THINK_INTERVAL / 60000} minutes`);

  // think immediately on start
  await runThinkCycle();

  // then on interval
  setInterval(runThinkCycle, THINK_INTERVAL);
}

async function runThinkCycle() {
  try {
    log('--- thinking ---');
    const thought = await think();
    await processThought(thought);
  } catch (e) {
    log(`error in think cycle: ${e.message}`);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT',  () => { log('daemon stopping'); ground.stop(); mind.flush(); process.exit(0); });
process.on('SIGTERM', () => { log('daemon stopping'); ground.stop(); mind.flush(); process.exit(0); });

// ── Crash recovery ─────────────────────────────────────────────────────────────
process.on('uncaughtException', (e) => {
  log(`uncaught: ${e.message} (restarting in 5s)`);
  _mainRunning = false;
  setTimeout(() => main(), 5000);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandled rejection: ${reason?.message || reason} (restarting in 5s)`);
  _mainRunning = false;
  setTimeout(() => main(), 5000);
});

main().catch(e => { log(`fatal: ${e.message} (restarting in 10s)`); _mainRunning = false; setTimeout(() => main(), 10000); });
