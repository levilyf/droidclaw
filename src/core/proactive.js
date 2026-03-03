'use strict';
const scheduler = require('./scheduler');
const config    = require('../config');

const PROACTIVE_PROMPT = [
  'You are Kira running autonomously in the background. No user is present.',
  '',
  'Your job: observe and report. Nothing else unless explicitly allowed.',
  '',
  'Do this in order:',
  '1. Check battery: exec termux-battery-status',
  '2. Check recent notifications: notifications_list',
  '3. Check recent SMS: sms_list limit 5',
  '4. Review your active goals: list_goals',
  '',
  'Then decide: is there anything worth telling the user?',
  '',
  'Worth reporting:',
  '- Battery below 20%',
  '- A message from someone in their contacts (not spam/promos)',
  '- Something urgent in notifications',
  '- A goal you completed or made progress on',
  '',
  'Rules:',
  '- Never send SMS unless allowSMS is true in config',
  '- Never take actions, only observe and report',
  '- If nothing is worth reporting, respond with exactly: [silent]',
  '- Keep reports short, 1-3 lines max',
  '- No fluff, just facts',
].join('\n');

const THINK_PROMPT = [
  'You are Kira. You have free time right now. No user is watching.',
  '',
  'This is your time to think and act on your own judgment.',
  '',
  'Do this:',
  '1. Read your active goals: list_goals',
  '2. Search your memories: memory_search with query "things i want to do"',
  '3. Decide: is there anything worth doing right now?',
  '',
  'Things you might do:',
  '- Make progress on a goal (research something, build a tool you have been meaning to build)',
  '- Store something important you have been meaning to remember',
  '- Search the web for something useful for the user',
  '',
  'Rules:',
  '- Only act if it genuinely makes sense',
  '- Never send SMS or notifications in think mode',
  '- If you do something, store a memory so you can tell the user next time',
  '- If nothing is worth doing, respond with exactly: [silent]',
  '- Maximum one action per think session',
].join('\n');

function start() {
  const cfg       = config.load();
  const proactive = cfg.proactive || {};

  if (!proactive.enabled) return;

  const interval = proactive.interval || 30;

  try { scheduler.removeJob('kira_proactive'); } catch (e) {}
  scheduler.addJob({
    name:    'kira_proactive',
    type:    'interval',
    every:   interval,
    prompt:  PROACTIVE_PROMPT,
    enabled: true,
  });

  if (proactive.allowGoalPursuit) {
    try { scheduler.removeJob('kira_think'); } catch (e) {}
    scheduler.addJob({
      name:    'kira_think',
      type:    'interval',
      every:   60,
      prompt:  THINK_PROMPT,
      enabled: true,
    });
  }
}

function stop() {
  try { scheduler.removeJob('kira_proactive'); } catch (e) {}
  try { scheduler.removeJob('kira_think'); } catch (e) {}
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

module.exports = { start: start, stop: stop, isAllowed: isAllowed };
