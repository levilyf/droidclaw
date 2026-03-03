'use strict';
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const JOBS_FILE = path.join(os.homedir(), '.droidclaw', 'scheduler.json');

let _jobs      = [];
let _interval  = null;
let _telegram  = null;
let _loop      = null;
let _tui       = null;

// ─── Persistence ────────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      _jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    }
  } catch { _jobs = []; }
}

function saveJobs() {
  const dir = path.join(os.homedir(), '.droidclaw');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(_jobs, null, 2));
}

// ─── Job helpers ────────────────────────────────────────────────────────────

function nextRun(job) {
  const now = new Date();

  if (job.type === 'once') {
    return new Date(job.at);
  }

  if (job.type === 'interval') {
    const last = job.lastRun ? new Date(job.lastRun) : new Date(job.createdAt);
    return new Date(last.getTime() + job.every * 60 * 1000);
  }

  if (job.type === 'daily') {
    const [h, m] = job.time.split(':').map(Number);
    const next   = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  return null;
}

function isDue(job) {
  const next = nextRun(job);
  if (!next) return false;
  return new Date() >= next;
}

// ─── Notify ─────────────────────────────────────────────────────────────────

async function notify(message) {
  // Try telegram first
  if (_telegram && _telegram.running) {
    const cfg = require('./config').load();
    const allowed = cfg.telegramAllowed || [];
    if (allowed.length) {
      try {
        await _telegram._req('sendMessage', {
          chat_id: allowed[0],
          text: message.slice(0, 4096),
        });
        return;
      } catch {}
    }
  }
  // Fallback to TUI
  if (_tui) {
    _tui.addMessage('system', `⏰ ${message}`);
  }
}

// ─── Run a job ───────────────────────────────────────────────────────────────

async function runJob(job) {
  try {
    if (!_loop) return;

    let reply = '';
    await _loop.run(
      job.prompt,
      () => {},
      () => {},
      r => { reply = r; }
    );

    if (reply && reply.trim() !== '[silent]') await notify(reply);

    job.lastRun = new Date().toISOString();
    job.runCount = (job.runCount || 0) + 1;

    // Remove one-time jobs after running
    if (job.type === 'once') {
      _jobs = _jobs.filter(j => j.id !== job.id);
    }

    saveJobs();
  } catch (e) {
    await notify(`scheduler error on "${job.name}": ${e.message}`);
  }
}

// ─── Main tick ───────────────────────────────────────────────────────────────

async function tick() {
  for (const job of [..._jobs]) {
    if (job.enabled !== false && isDue(job)) {
      await runJob(job);
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

function start(deps) {
  _telegram = deps.telegram;
  _loop     = deps.loop;
  _tui      = deps.tui;

  loadJobs();

  // Tick every minute
  _interval = setInterval(() => tick(), 60 * 1000);
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

function addJob(job) {
  const id = `job_${Date.now()}`;
  const newJob = {
    id,
    name:      job.name || id,
    type:      job.type || 'interval',   // once | interval | daily
    prompt:    job.prompt,
    enabled:   true,
    createdAt: new Date().toISOString(),
    lastRun:   null,
    runCount:  0,
    // interval jobs
    every:     job.every || 60,          // minutes
    // once jobs
    at:        job.at || null,           // ISO date string
    // daily jobs
    time:      job.time || '09:00',      // HH:MM
  };
  _jobs.push(newJob);
  saveJobs();
  return newJob;
}

function removeJob(id) {
  const before = _jobs.length;
  _jobs = _jobs.filter(j => j.id !== id && j.name !== id);
  saveJobs();
  return _jobs.length < before;
}

function listJobs() {
  return _jobs.map(j => {
    const next = nextRun(j);
    return {
      id:      j.id,
      name:    j.name,
      type:    j.type,
      enabled: j.enabled,
      next:    next ? next.toLocaleTimeString() : 'unknown',
      runs:    j.runCount || 0,
    };
  });
}

function getJobs() { return _jobs; }

module.exports = { start, stop, addJob, removeJob, listJobs, getJobs, loadJobs, saveJobs };
