'use strict';
const scheduler = require('./scheduler');
const config    = require('../config');

const PROACTIVE_PROMPT = `You are Kira running autonomously in the background. No user is present.

Your job: observe and report. Nothing else unless explicitly allowed.

Do this in order:
1. Check battery: exec termux-battery-status
2. Check recent notifications: notifications_list
3. Check recent SMS: sms_list limit 5
4. Review your active goals: list_goals

Then decide: is there anything worth telling the user?

Rules for what's worth reporting:
- Battery below 20%
- A message from someone in their contacts (not spam/promos)
- Something urgent in notifications
- A goal you completed or made progress on

Rules for what NOT to do:
- Never send SMS unless allowSMS is true in config
- Never take actions, only observe and report
- If nothing is worth reporting, say nothing — respond with exactly: [silent]
- Keep reports short — 1-3 lines max
- No fluff, just facts`;

function start() {
  const cfg        = config.load();
  const proactive  = cfg.proactive || {};

  if (!proactive.enabled) return;

  const interval = proactive.interval || 30;

  // Remove any existing proactive job first
  try { scheduler.removeJob('kira_proactive'); } catch {}

  scheduler.addJob({
    name:   'kira_proactive',
    type:   'interval',
    every:  interval,
    prompt: PROACTIVE_PROMPT,
    enabled: true,
  });
}

function stop() {
  try { scheduler.removeJob('kira_proactive'); } catch {}
}

function isAllowed(action) {
  const cfg       = config.load();
  const proactive = cfg.proactive || {};
  if (!proactive.enabled) return false;
  if (action === 'sms')         return !!proactive.allowSMS;
  if (action === 'notify')      return proactive.enabled !== false;
  if (action === 'goalPursuit') return !!proactive.allowGoalPursuit;
  return false;
}

module.exports = { start, stop, isAllowed };
