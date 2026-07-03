'use strict';
/**
 * NEXUS — The Real Coordinator
 *
 * Replaces brain.js.
 * Doesn't assemble text — makes decisions.
 *
 * Reads KIRA_MIND, selects what's actually relevant,
 * builds context intelligently, updates KIRA_MIND after responses.
 *
 * Every module talks through NEXUS. NEXUS talks to KIRA_MIND.
 * One truth. Always coherent.
 */

const mind   = require('./mind');
const config = require('../config');

// ── Context selection — intelligent, not concatenation ────────────────────────
function buildContext(userMessage = '') {
  const sections = [];
  const cfg      = config.load();

  // ── 0. Living files — soul, user model, memory, tasks ────────────────────
  try {
    const workspace = require('../workspace');
    const ctx       = workspace.buildContext();
    if (ctx && ctx.length > 50) sections.push(ctx);
  } catch {}

  // ── 1. Live state — always first ─────────────────────────────────────────
  const emotion   = _getEmotionContext();
  const device    = _getDeviceContext();
  const mood      = mind.getMood();

  if (emotion || device) {
    const parts = [];
    if (emotion) parts.push(emotion);
    if (device)  parts.push(device);
    if (mood !== 'neutral') parts.push(`kira is ${mood}`);
    sections.push(`## NOW\n${parts.join(' · ')}`);
  }

  // ── 2. Active task — if there is one ─────────────────────────────────────
  const activeTask = mind.getActiveTask();
  if (activeTask) {
    sections.push(
      `## ACTIVE TASK\n${activeTask.description}\n` +
      `success condition: ${activeTask.success_condition || 'complete successfully'}\n` +
      `attempts: ${activeTask.attempts}`
    );
  }

  // ── 3. Relevant memories — query-specific ────────────────────────────────
  const emotionState = _getRawEmotionState();
  const memories = mind.retrieveMemories(userMessage, 5, emotionState);
  if (memories.length) {
    const grouped = {};
    memories.forEach(m => {
      const theme = m.theme || 'general';
      if (!grouped[theme]) grouped[theme] = [];
      grouped[theme].push(`[${_timeAgo(m.last_touched)}] ${m.text}`);
    });
    const lines = ['## MEMORIES (relevant to this moment)'];
    Object.entries(grouped).forEach(([theme, mems]) => {
      lines.push(`${theme}:`);
      mems.forEach(m => lines.push(`  - ${m}`));
    });
    sections.push(lines.join('\n'));
  }

  // ── 4. Person model — high confidence beliefs only ───────────────────────
  const beliefs = mind.getBeliefs(null, 0.5);
  if (beliefs.length) {
    const byDimension = {};
    beliefs.forEach(b => {
      if (!byDimension[b.dimension]) byDimension[b.dimension] = [];
      byDimension[b.dimension].push(`${b.value} (${Math.round(b.confidence * 100)}%)`);
    });

    const lines = ['## WHO YOU ARE (kira\'s model of you)'];
    const order = ['identity', 'patterns', 'triggers', 'needs', 'goals'];
    order.forEach(dim => {
      if (byDimension[dim] && byDimension[dim].length) {
        lines.push(`${dim}: ${byDimension[dim].slice(0, 3).join(' | ')}`);
      }
    });
    sections.push(lines.join('\n'));
  }

  // ── 5. Kira's own state — pending observations, goals ────────────────────
  const kiraObs  = mind.getKiraState('observation').filter(k => k.priority >= 2).slice(0, 2);
  const kiraGoals = mind.getKiraState('goal').slice(0, 2);
  const kiraThoughts = mind.getKiraState('thought').slice(0, 1);

  if (kiraObs.length || kiraGoals.length || kiraThoughts.length) {
    const lines = ['## KIRA\'S OWN STATE'];
    if (kiraObs.length)     lines.push(`observations: ${kiraObs.map(k => k.value).join(' | ')}`);
    if (kiraThoughts.length) lines.push(`thinking: ${kiraThoughts[0].value}`);
    if (kiraGoals.length)   lines.push(`kira wants: ${kiraGoals.map(k => k.value).join(' | ')}`);
    lines.push('→ these are kira\'s own thoughts. use them naturally.');
    sections.push(lines.join('\n'));
  }

  // ── 6. World model — what GROUND observed ────────────────────────────────
  const worldCtx = _getWorldContext();
  if (worldCtx) sections.push(worldCtx);

  // ── 6b. Device behavior model — learned from action consequences ──────────
  try {
    const wml    = require('../world_model_loop');
    const wmlCtx = wml.getContext();
    if (wmlCtx) sections.push(wmlCtx);
  } catch {}

  // ── 6c. Self-model — Kira's knowledge of her own capabilities ────────────
  try {
    const selfModel = require('../self_model');
    const selfCtx   = selfModel.getContext();
    if (selfCtx) sections.push(selfCtx);
  } catch {}

  // ── 7. Relevant skills — matched to this message ──────────────────────────
  try {
    const skillMatcher = require('../tools/skill_matcher');
    const skillCtx     = skillMatcher.buildSkillContext(userMessage, emotionState);
    if (skillCtx) sections.push(skillCtx);
  } catch {}

  // ── 8. ORACLE-style prediction — from patterns ───────────────────────────
  const prediction = _buildPrediction(userMessage, emotionState, beliefs);
  if (prediction) sections.push(prediction);

  return sections.join('\n\n');
}

// ── Update KIRA_MIND after a message exchange ─────────────────────────────────
function pulse(message, role, emotionUpdate = null) {
  // compute new emotion state from message
  const current = {
    tension:    parseFloat(mind.getState('emotion_tension')    || 0),
    connection: parseFloat(mind.getState('emotion_connection') || 0.5),
    focus:      parseFloat(mind.getState('emotion_focus')      || 0.5),
    energy:     parseFloat(mind.getState('emotion_energy')     || 0.8),
  };

  if (message && role === 'user') {
    const text = message.toLowerCase();
    const len  = message.length;

    // tension signals
    if (/\b(wtf|broken|fix|wrong|ugh|error|bug|stupid|crash|failed)\b/.test(text)) {
      current.tension = Math.min(1.0, current.tension + 0.15);
    } else if (/\b(thanks|great|perfect|nice|good|yes|done|works)\b/.test(text)) {
      current.tension = Math.max(0, current.tension - 0.1);
    } else {
      // passive decay toward baseline
      current.tension = current.tension * 0.92;
    }

    // connection signals
    if (/\b(i feel|honestly|actually|between us|real talk|tbh)\b/.test(text)) {
      current.connection = Math.min(1.0, current.connection + 0.12);
    }

    // focus signals
    if (len > 100) current.focus = Math.min(1.0, current.focus + 0.08);
    else if (len < 20) current.focus = Math.max(0, current.focus - 0.05);

    // energy — time of day
    const hour = new Date().getHours();
    if (hour >= 23 || hour <= 5) current.energy = Math.max(0.1, current.energy - 0.05);
    else current.energy = Math.min(1.0, current.energy + 0.02);
  }

  // allow override from caller if explicit update passed
  if (emotionUpdate) {
    if (emotionUpdate.tension    !== undefined) current.tension    = emotionUpdate.tension;
    if (emotionUpdate.connection !== undefined) current.connection = emotionUpdate.connection;
    if (emotionUpdate.focus      !== undefined) current.focus      = emotionUpdate.focus;
    if (emotionUpdate.energy     !== undefined) current.energy     = emotionUpdate.energy;
  }

  mind.setState('emotion_tension',    Math.round(current.tension    * 1000) / 1000);
  mind.setState('emotion_connection', Math.round(current.connection * 1000) / 1000);
  mind.setState('emotion_focus',      Math.round(current.focus      * 1000) / 1000);
  mind.setState('emotion_energy',     Math.round(current.energy     * 1000) / 1000);

  // log conversation — only once, don't duplicate
  if (message && role !== 'system') mind.logConversation(role, message);

  // record IRIS outcome — when user speaks, detect if last response landed well
  if (role === 'user' && message) {
    try {
      const iris   = require('./iris');
      const text   = message.toLowerCase();
      // positive: user continues naturally, agrees, thanks, or asks follow-up
      // negative: user pushes back, says wrong, repeats question, expresses frustration
      const positive = /\b(thanks|ok|got it|perfect|yes|makes sense|exactly|right|good|continue|go on)\b/.test(text);
      const negative = /\b(wrong|no|that's not|you're wrong|wtf|what are you|didn't ask|not what i|again|repeat)\b/.test(text);
      if (positive)      iris.recordOutcome('positive');
      else if (negative) iris.recordOutcome('negative');
      else               iris.recordOutcome('neutral');
    } catch {}
  }

  // extract beliefs from user messages — only if meaningful length
  if (role === 'user' && message && message.length > 25) {
    _extractBeliefs(message);
    _checkMoodFromMessage(message);
  }
}

// ── Sleep — M2.7 self-evolution ───────────────────────────────────────────────
async function sleep(engine) {
  const conversations = mind.getRecentConversations(2);
  if (!conversations || conversations.length < 4) return;

  const history = conversations
    .map(c => `${c.role}: ${c.content}`)
    .join('\n');

  const cfg = config.load();

  try {
    // ── Phase 1: Extract new beliefs ────────────────────────────────────────
    const beliefsResult = await engine.rawChat(`
You are NEXUS — Kira's intelligence core analyzing conversations to build understanding.

Current beliefs about this person:
${_formatBeliefs()}

Recent conversations:
${history.slice(-3000)}

Extract NEW beliefs about this person. Only add what's genuinely new or updates existing beliefs.
For contradictions: mark with "contradicts: [old belief]"

Respond in JSON only:
{
  "new_beliefs": [
    { "dimension": "identity|pattern|trigger|need|goal", "value": "belief", "confidence": 0.0-1.0 }
  ],
  "contradictions": [
    { "dimension": "pattern", "old": "old belief text", "new": "new belief text" }
  ]
}

Be specific and causal. Bad: "user likes coding". Good: "codes late at night as their primary creative outlet".
Return { "new_beliefs": [], "contradictions": [] } if nothing genuinely new.`
    );

    const cleanBeliefs = beliefsResult.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/g, '').trim();
    // extract JSON even if model adds text around it
    const jsonMatch = cleanBeliefs.match(/\{[\s\S]*\}/);
    const parsedBeliefs = jsonMatch ? JSON.parse(jsonMatch[0]) : { new_beliefs: [], contradictions: [] };

    parsedBeliefs.new_beliefs?.forEach(b => {
      mind.upsertBelief(b.dimension, b.value, { confidence: b.confidence, source: 'sleep' });
    });
    parsedBeliefs.contradictions?.forEach(c => {
      mind.contradictBelief(c.dimension, c.old, c.new);
    });

  } catch {}

  try {
    // ── Phase 2: M2.7 self-evolution — improve Kira's own behavior ──────────
    // This is where M2.7's self-evolving capability is used properly
    // It analyzes what worked, what failed, and proposes behavioral improvements
    const selfResult = await engine.rawChat(`
You are Kira running your self-evolution cycle.

Recent conversations:
${history.slice(-2000)}

Your current behavioral rules:
${_formatKiraGoals()}

Analyze this session:
1. What moments felt off — where did you miss what they needed?
2. What worked — where did you genuinely help or connect?
3. What should you do differently next session?
4. What are you still uncertain about regarding this person?

This is not reflection for its own sake. This directly updates how you behave.

Respond in JSON only:
{
  "observations": ["things you noticed about this person this session"],
  "improvements": ["specific behavioral changes for next session"],
  "uncertainties": ["things you still don't understand about this person"],
  "mood": "curious|engaged|concerned|satisfied|neutral"
}

Be brutally honest. Vague improvements are useless.`
    );

    const cleanSelf  = selfResult.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/g, '').trim();
    const selfMatch  = cleanSelf.match(/\{[\s\S]*\}/);
    const parsedSelf = selfMatch ? JSON.parse(selfMatch[0]) : {};

    parsedSelf.observations?.forEach(o => {
      mind.setKiraState('observation', o, 2);
    });
    parsedSelf.improvements?.forEach(imp => {
      mind.setKiraState('goal', imp, 3);
    });
    parsedSelf.uncertainties?.forEach(u => {
      mind.setKiraState('uncertainty', u, 1);
    });
    if (parsedSelf.mood) mind.setMood(parsedSelf.mood);

  } catch {}

  // ── Phase 3: Decay old memories ───────────────────────────────────────────
  mind.decayMemories();

  // ── Phase 4: Clean up old kira states ────────────────────────────────────
  try {
    const kira = mind.getKiraState(null, true);
    const week = Date.now() / 1000 - 604800;
    kira.filter(k => k.priority === 1 && k.created_at < week)
        .forEach(k => mind.resolveKira(k.id));
  } catch {}

  // ── Phase 5: Auto-create skills from successful patterns ──────────────────
  try {
    const skillMatcher = require('../tools/skill_matcher');
    const convHistory  = mind.getRecentConversations(1);
    await skillMatcher.autoCreateSkills(engine, convHistory);
  } catch {}

  // ── Phase 6: Deep self-reflection — update self-model ─────────────────────
  try {
    const selfModel    = require('../self_model');
    const convHistory  = mind.getRecentConversations(2);
    await selfModel.deepReflect(engine, convHistory);
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getEmotionContext() {
  const tension    = parseFloat(mind.getState('emotion_tension')    || 0);
  const connection = parseFloat(mind.getState('emotion_connection') || 0.5);
  const energy     = parseFloat(mind.getState('emotion_energy')     || 0.8);
  const focus      = parseFloat(mind.getState('emotion_focus')      || 0.5);

  const parts = [];
  if (energy < 0.3)        parts.push('exhausted');
  else if (energy < 0.55)  parts.push('low energy');
  if (tension > 0.6)       parts.push('tension high');
  else if (tension > 0.3)  parts.push('mild tension');
  if (connection > 0.7)    parts.push('close conversation');
  if (focus > 0.7)         parts.push('deep focus');

  return parts.length ? parts.join(', ') : null;
}

function _getRawEmotionState() {
  return {
    tension:    parseFloat(mind.getState('emotion_tension')    || 0),
    connection: parseFloat(mind.getState('emotion_connection') || 0.5),
    energy:     parseFloat(mind.getState('emotion_energy')     || 0.8),
    focus:      parseFloat(mind.getState('emotion_focus')      || 0.5),
  };
}

function _getDeviceContext() {
  const battery  = mind.getState('device_battery');
  const charging = mind.getState('device_charging');
  const app      = mind.getState('device_app_name');
  const activity = mind.getState('device_activity');
  const context  = mind.getState('device_context');

  const parts = [];
  if (app)                             parts.push(`in ${app}`);
  if (activity && activity !== 'unknown') parts.push(activity);
  if (context)                         parts.push(context);
  if (battery !== null)                parts.push(`${battery}% battery${charging ? ' charging' : ''}`);

  return parts.length ? parts.join(' · ') : null;
}

function _getWorldContext() {
  const notifCount = mind.getState('device_notif_count');
  const notifApps  = mind.getState('device_notif_apps');

  if (!notifCount || notifCount < 1) return null;

  const apps = Array.isArray(notifApps) ? notifApps.slice(0, 5).join(', ') : notifApps;
  return `## DEVICE\n${notifCount} notifications from: ${apps}`;
}

function _buildPrediction(message, emotionState, beliefs) {
  const predictions = [];
  const hour        = new Date().getHours();
  const tension     = emotionState?.tension || 0;
  const energy      = emotionState?.energy  || 0.8;

  // ── Load IRIS history for real pattern-based predictions ─────────────────────
  try {
    const iris      = require('./iris');
    const data      = _loadIrisData();
    const decisions = (data.decisions || []).filter(d => d.outcome !== null);

    if (decisions.length >= 15) {
      // What does this person typically do at this hour?
      const hourDecisions = decisions.filter(d => Math.abs((d.hour || 0) - hour) <= 1);
      if (hourDecisions.length >= 5) {
        const hourProfiles = {};
        hourDecisions.forEach(d => { hourProfiles[d.profile] = (hourProfiles[d.profile] || 0) + 1; });
        const dominantHour = Object.entries(hourProfiles).sort((a, b) => b[1] - a[1])[0];
        if (dominantHour && dominantHour[1] >= 3) {
          predictions.push(`at this hour they usually need: ${dominantHour[0].toLowerCase()} mode`);
        }
      }

      // What follows high tension messages historically?
      if (tension > 0.4) {
        const afterTension = decisions.filter(d => (d.tension || 0) > 0.35 && d.outcome);
        const positiveAfter = afterTension.filter(d => d.outcome === 'positive');
        if (afterTension.length >= 5) {
          const positiveRate = positiveAfter.length / afterTension.length;
          if (positiveRate > 0.6) {
            const winProfiles = {};
            positiveAfter.forEach(d => { winProfiles[d.profile] = (winProfiles[d.profile] || 0) + 1; });
            const bestForTension = Object.entries(winProfiles).sort((a, b) => b[1] - a[1])[0];
            if (bestForTension) {
              predictions.push(`when tense, ${bestForTension[0].toLowerCase()} mode has ${Math.round(positiveRate * 100)}% success`);
            }
          }
        }
      }

      // Message length pattern — what length messages get positive outcomes?
      const msgLen    = message.length;
      const lenBucket = msgLen < 20 ? 'short' : msgLen < 100 ? 'medium' : 'long';
      const lenDecisions = decisions.filter(d => d.lenBucket === lenBucket && d.outcome);
      if (lenDecisions.length >= 5) {
        const positiveLen = lenDecisions.filter(d => d.outcome === 'positive').length;
        const rate        = positiveLen / lenDecisions.length;
        if (rate < 0.4) {
          predictions.push(`${lenBucket} messages have low satisfaction rate (${Math.round(rate * 100)}%) — adjust depth`);
        }
      }
    }
  } catch {}

  // ── Belief-based predictions ──────────────────────────────────────────────────
  const triggers = beliefs.filter(b => b.dimension === 'trigger' && b.confidence > 0.6);
  if (triggers.length && tension > 0.35) {
    predictions.push(`active trigger likely: ${triggers[0].value}`);
  }

  // ── Time + energy predictions ──────────────────────────────────────────────────
  if (energy < 0.3)                       predictions.push('exhausted — keep it very short');
  if (hour >= 23 || hour <= 4)            predictions.push('late night — may want depth or to wind down');

  if (!predictions.length) return null;
  return `## PREDICTION (from real patterns)\n${predictions.map(p => `- ${p}`).join('\n')}\n→ calibrate before responding`;
}

function _loadIrisData() {
  try {
    const fs = require('fs');
    const os = require('os');
    const p  = require('path').join(os.homedir(), '.droidclaw', 'iris_patterns.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return { decisions: [] }; }
}

function _extractBeliefs(message) {
  const text = message.toLowerCase().trim();

  // ── identity: "I am X" / "I'm a X" ─────────────────────────────────────────
  const identityMatch = message.match(/\bi'?m\s+(?:a\s+)?([a-z][^.!?,]{3,40})/i) ||
                        message.match(/\bi\s+am\s+([a-z][^.!?,]{3,40})/i);
  if (identityMatch) {
    const claim = identityMatch[1].trim().slice(0, 80);
    if (claim.split(' ').length <= 6) { // sanity check — not a sentence
      mind.upsertBelief('identity', claim, { confidence: 0.65 });
    }
  }

  // ── goal: "I want to X" / "my goal is X" ────────────────────────────────────
  const goalMatch = message.match(/\bi\s+want\s+to\s+([^.!?,]{5,60})/i) ||
                    message.match(/\bmy\s+goal\s+is\s+(?:to\s+)?([^.!?,]{5,60})/i) ||
                    message.match(/\bi'?m\s+(?:trying|working)\s+to\s+([^.!?,]{5,60})/i);
  if (goalMatch) {
    mind.upsertBelief('goal', goalMatch[1].trim().slice(0, 80), { confidence: 0.7 });
  }

  // ── pattern: "I always/never X" ─────────────────────────────────────────────
  const patternMatch = message.match(/\bi\s+(always|never|usually|tend\s+to|keep)\s+([^.!?,]{5,50})/i) ||
                       message.match(/\bevery\s+time\s+(?:i\s+)?([^.!?,]{5,50})/i);
  if (patternMatch) {
    const pattern = (patternMatch[1] + ' ' + (patternMatch[2] || '')).trim().slice(0, 80);
    mind.upsertBelief('pattern', pattern, { confidence: 0.65 });
  }

  // ── trigger: "I hate X" / "X frustrates me" ──────────────────────────────────
  const triggerMatch = message.match(/\bi\s+hate\s+([^.!?,]{3,50})/i) ||
                       message.match(/\b([^.!?,]{3,40})\s+(?:frustrates|annoys|drives)\s+me/i) ||
                       message.match(/\bcan'?t\s+stand\s+([^.!?,]{3,50})/i);
  if (triggerMatch) {
    mind.upsertBelief('trigger', triggerMatch[1].trim().slice(0, 80), { confidence: 0.75 });
  }

  // ── need: "I need X" ─────────────────────────────────────────────────────────
  const needMatch = message.match(/\bi\s+need\s+(?:to\s+)?([^.!?,]{5,50})/i);
  if (needMatch) {
    mind.upsertBelief('need', needMatch[1].trim().slice(0, 80), { confidence: 0.6 });
  }
}

function _checkMoodFromMessage(message) {
  const text = message.toLowerCase();
  if (/\bwtf\b|\bbroken\b|\bstupid\b|\bugh\b/.test(text))        mind.setMood('concerned');
  else if (/\bthanks\b|\bgreat\b|\bperfect\b|\byes\b/.test(text)) mind.setMood('satisfied');
  else if (/\bwhy\b|\bhow\b|\bwhat if\b/.test(text))              mind.setMood('curious');
}

function _formatBeliefs() {
  const beliefs = mind.getBeliefs(null, 0.4);
  if (!beliefs.length) return 'none yet';
  const grouped = {};
  beliefs.forEach(b => {
    if (!grouped[b.dimension]) grouped[b.dimension] = [];
    grouped[b.dimension].push(b.value);
  });
  return Object.entries(grouped)
    .map(([d, vs]) => `${d}: ${vs.join(' | ')}`)
    .join('\n');
}

function _formatKiraGoals() {
  const goals = mind.getKiraState('goal').slice(0, 5);
  if (!goals.length) return 'no current goals';
  return goals.map(g => `- ${g.value}`).join('\n');
}

function _timeAgo(unixTs) {
  const hours = Math.round((Date.now() / 1000 - unixTs) / 3600);
  if (hours < 1)   return 'just now';
  if (hours < 24)  return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

module.exports = { buildContext, pulse, sleep };
