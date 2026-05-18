'use strict';
/**
 * GROUND — Continuous Grounding Layer
 *
 * Runs every 60 seconds in the background.
 * Watches everything on the device passively.
 * Never waits to be asked.
 *
 * This is what separates Kira from every other AI:
 * she observes your life even when you're not talking to her.
 *
 * After one week she knows things about you
 * that you never told her. She noticed.
 */

const fs  = require('fs');
const os  = require('os');
const { spawnSync } = require('child_process');

const GROUND_FILE   = os.homedir() + '/.droidclaw/ground_state.json';
const HISTORY_FILE  = os.homedir() + '/.droidclaw/ground_history.json';
const KIRA_BASE     = 'http://localhost:7070';
const POLL_INTERVAL = 60 * 1000; // 60 seconds
const MAX_HISTORY   = 500;       // keep last 500 snapshots (~8 hours at 60s intervals)

let _timer    = null;
let _running  = false;
let _onUpdate = null; // callback when significant change detected

// ── HTTP helper ───────────────────────────────────────────────────────────────
function _get(endpoint) {
  try {
    const result = spawnSync('curl', ['-s', '-m', '5', `${KIRA_BASE}${endpoint}`], {
      encoding: 'utf8', timeout: 6000
    });
    if (result.error || result.status !== 0) return null;
    return JSON.parse(result.stdout);
  } catch { return null; }
}

function _post(endpoint, body) {
  try {
    const result = spawnSync('curl', [
      '-s', '-m', '5', '-X', 'POST',
      `${KIRA_BASE}${endpoint}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body)
    ], { encoding: 'utf8', timeout: 6000 });
    if (result.error || result.status !== 0) return null;
    return JSON.parse(result.stdout);
  } catch { return null; }
}

// ── Termux API helper ─────────────────────────────────────────────────────────
function _termux(cmd) {
  try {
    const ENV    = { ...process.env, PATH: '/data/data/com.termux/files/usr/bin:' + (process.env.PATH || '') };
    const result = spawnSync(cmd, [], { encoding: 'utf8', timeout: 5000, shell: true, env: ENV });
    if (result.error || result.status !== 0) return null;
    return JSON.parse(result.stdout);
  } catch { return null; }
}

// ── Take a snapshot of device state ──────────────────────────────────────────
function _snapshot() {
  const now  = Date.now();
  const hour = new Date().getHours();
  const snap = {
    ts:           now,
    hour,
    minute:       new Date().getMinutes(),
    dayOfWeek:    new Date().getDay(), // 0=Sun
    // app context
    currentApp:   null,
    screenContent: [],
    // notifications
    notifications: [],
    newNotifCount: 0,
    notifApps:    [],
    // physical
    sensors:      null,
    facingUp:     null,
    isMoving:     null,
    // device
    battery:      null,
    charging:     false,
    temp:         null,
    wifi:         null,
    // derived
    activity:     'unknown', // coding | social | media | reading | idle | sleeping
    physicalState: 'unknown', // active | still | pocketed
  };

  // ── Screen & current app ──────────────────────────────────────────────────
  const screen = _get('/screenshot');
  if (screen && screen.length) {
    snap.screenContent = screen.slice(0, 10).map(n => ({
      text:    (n.text || '').slice(0, 100),
      class:   n.class,
      pkg:     n.package || null,
    }));
    // detect current app from screen nodes
    const pkgs = screen.map(n => n.package).filter(Boolean);
    if (pkgs.length) {
      const counts = {};
      pkgs.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
      snap.currentApp = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  const notifs = _get('/notifications');
  if (notifs && notifs.length) {
    snap.notifications = notifs.slice(0, 20).map(n => ({
      pkg:   n.package,
      title: (n.title || '').slice(0, 60),
      text:  (n.text  || '').slice(0, 100),
      ts:    n.timestamp,
    }));
    snap.notifApps    = [...new Set(notifs.map(n => n.package).filter(Boolean))];
    snap.newNotifCount = notifs.length;
  }

  // ── Physical sensors ──────────────────────────────────────────────────────
  const sensors = _get('/sensors');
  if (sensors) {
    snap.sensors = sensors;
    // detect if phone is face down (proximity near + accelerometer z negative)
    if (sensors.proximity !== undefined) {
      snap.facingUp = sensors.proximity > 3; // >3cm = face up
    }
    // detect movement from accelerometer
    if (sensors.accelerometer) {
      const { x, y, z } = sensors.accelerometer;
      const magnitude    = Math.sqrt((x||0)**2 + (y||0)**2 + (z||0)**2);
      snap.isMoving      = magnitude > 12; // gravity = 9.8, movement adds to this
    }
  }

  // ── Battery & device ──────────────────────────────────────────────────────
  const bat = _termux('termux-battery-status');
  if (bat) {
    snap.battery  = bat.percentage;
    snap.charging = bat.status === 'CHARGING' || bat.status === 'FULL';
    snap.temp     = bat.temperature;
  }

  const wifi = _termux('termux-wifi-connectioninfo');
  if (wifi && wifi.ssid && wifi.ssid !== '<unknown ssid>') {
    snap.wifi = wifi.ssid;
  }

  // ── Derive activity from context ──────────────────────────────────────────
  snap.activity     = _deriveActivity(snap);
  snap.physicalState = _derivePhysical(snap);

  return snap;
}

// ── Derive what the user is doing ─────────────────────────────────────────────
function _deriveActivity(snap) {
  const app = snap.currentApp || '';

  // coding / terminal
  if (app.includes('termux') || app.includes('terminal') || app.includes('code')) return 'coding';

  // social
  if (app.includes('whatsapp') || app.includes('telegram') || app.includes('instagram') ||
      app.includes('twitter') || app.includes('discord') || app.includes('messenger')) return 'social';

  // media
  if (app.includes('youtube') || app.includes('netflix') || app.includes('spotify') ||
      app.includes('music') || app.includes('video') || app.includes('vlc')) return 'media';

  // reading / browsing
  if (app.includes('chrome') || app.includes('browser') || app.includes('firefox') ||
      app.includes('read') || app.includes('kindle') || app.includes('pdf')) return 'reading';

  // gaming
  if (app.includes('game') || app.includes('play') || app.includes('pubg') ||
      app.includes('free')) return 'gaming';

  // phone calls
  if (app.includes('dialer') || app.includes('phone') || app.includes('call')) return 'calling';

  // sleeping / idle
  const hour = snap.hour;
  if ((hour >= 0 && hour <= 5) && !snap.isMoving) return 'sleeping';
  if (!snap.currentApp && !snap.isMoving) return 'idle';

  return 'unknown';
}

// ── Derive physical state ─────────────────────────────────────────────────────
function _derivePhysical(snap) {
  if (snap.facingUp === false) return 'pocketed'; // face down = in pocket
  if (snap.isMoving) return 'active';
  return 'still';
}

// ── Load / save ───────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(GROUND_FILE, 'utf8')); }
  catch { return { lastSnapshot: null, currentActivity: 'unknown', sessionStart: null }; }
}

function saveState(state) {
  try { fs.writeFileSync(GROUND_FILE, JSON.stringify(state, null, 2)); }
  catch {}
}

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return []; }
}

function saveHistory(history) {
  try {
    const trimmed = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed));
  } catch {}
}

// ── Detect significant changes ────────────────────────────────────────────────
function _detectChanges(prev, curr) {
  const changes = [];

  if (prev && curr.currentApp !== prev.currentApp) {
    changes.push({
      type: 'app_switch',
      from: prev.currentApp,
      to:   curr.currentApp,
      at:   curr.ts,
    });
  }

  if (prev && curr.activity !== prev.activity) {
    changes.push({
      type: 'activity_change',
      from: prev.activity,
      to:   curr.activity,
      at:   curr.ts,
    });
  }

  if (prev && curr.newNotifCount > (prev.newNotifCount || 0)) {
    const newApps = curr.notifApps.filter(a => !(prev.notifApps || []).includes(a));
    if (newApps.length) {
      changes.push({
        type:  'new_notifications',
        apps:  newApps,
        count: curr.newNotifCount - (prev.newNotifCount || 0),
        at:    curr.ts,
      });
    }
  }

  if (prev && curr.battery !== null && prev.battery !== null) {
    if (curr.battery <= 15 && prev.battery > 15) {
      changes.push({ type: 'battery_critical', level: curr.battery, at: curr.ts });
    }
    if (curr.charging && !prev.charging) {
      changes.push({ type: 'started_charging', at: curr.ts });
    }
    if (!curr.charging && prev.charging) {
      changes.push({ type: 'unplugged', level: curr.battery, at: curr.ts });
    }
  }

  if (prev && curr.physicalState !== prev.physicalState) {
    changes.push({
      type: 'physical_change',
      from: prev.physicalState,
      to:   curr.physicalState,
      at:   curr.ts,
    });
  }

  return changes;
}

// ── Main poll loop ────────────────────────────────────────────────────────────
async function _poll() {
  if (!_running) return;

  try {
    const state   = loadState();
    const history = loadHistory();
    const prev    = state.lastSnapshot;
    const curr    = _snapshot();

    // detect changes
    const changes = _detectChanges(prev, curr);

    // append to history
    history.push(curr);
    saveHistory(history);

    // update state
    state.lastSnapshot     = curr;
    state.currentActivity  = curr.activity;
    state.lastUpdated      = Date.now();
    if (!state.sessionStart) state.sessionStart = Date.now();
    state.recentChanges    = changes;
    saveState(state);

    // notify if significant change
    if (changes.length && _onUpdate) {
      _onUpdate(changes, curr);
    }

  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────
function start(onUpdate) {
  if (_running) return;
  _running  = true;
  _onUpdate = onUpdate || null;

  // poll immediately then on interval
  _poll();
  _timer = setInterval(_poll, POLL_INTERVAL);
}

function stop() {
  _running = false;
  if (_timer) { clearInterval(_timer); _timer = null; }
}

function getCurrentState() {
  return loadState();
}

function getHistory(hours = 2) {
  const history = loadHistory();
  const cutoff  = Date.now() - (hours * 3600000);
  return history.filter(s => s.ts > cutoff);
}

function getRecentActivity(minutes = 30) {
  const history = loadHistory();
  const cutoff  = Date.now() - (minutes * 60000);
  const recent  = history.filter(s => s.ts > cutoff);

  if (!recent.length) return null;

  // summarize what's been happening
  const activities = recent.map(s => s.activity).filter(a => a !== 'unknown');
  const apps       = recent.map(s => s.currentApp).filter(Boolean);
  const counts     = {};
  activities.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
  const dominant   = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  return {
    dominant_activity: dominant ? dominant[0] : 'unknown',
    apps_used:         [...new Set(apps)].slice(0, 5),
    snapshot_count:    recent.length,
    span_minutes:      minutes,
  };
}

module.exports = { start, stop, getCurrentState, getHistory, getRecentActivity };
