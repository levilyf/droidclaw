'use strict';
const registry  = require('./registry');
const scheduler = require('../core/scheduler');

registry.register('schedule', async ({ name, type, prompt, every, at, time }) => {
  if (!prompt) return 'error: prompt is required';

  const job = scheduler.addJob({ name, type, prompt, every, at, time });

  if (type === 'interval') {
    return `scheduled "${job.name}" — runs every ${job.every} minutes. first run in ${job.every} mins.`;
  }
  if (type === 'daily') {
    return `scheduled "${job.name}" — runs daily at ${job.time}.`;
  }
  if (type === 'once') {
    return `scheduled "${job.name}" — runs once at ${job.at}.`;
  }
  return `scheduled "${job.name}".`;
}, 'schedule a recurring or one-time task');

registry.register('unschedule', async ({ name }) => {
  if (!name) return 'error: name is required';
  const removed = scheduler.removeJob(name);
  return removed ? `removed job "${name}".` : `job "${name}" not found.`;
}, 'remove a scheduled task');

registry.register('list_schedule', async () => {
  const jobs = scheduler.listJobs();
  if (!jobs.length) return 'no scheduled jobs.';
  return jobs.map(j =>
    `${j.name} (${j.type}) — next: ${j.next} — ran ${j.runs}x — ${j.enabled ? 'on' : 'off'}`
  ).join('\n');
}, 'list all scheduled tasks');

module.exports = {};
