'use strict';
/**
 * KiraService v2 — full phone control via Accessibility Service
 * Endpoints: 22 tools covering screen, audio, sensors, system, apps
 */
const { execSync } = require('child_process');
const registry = require('./registry');

const BASE = 'http://localhost:7070';

function call(method, endpoint, body = null) {
  try {
    const args = body
      ? `-s -X ${method} ${BASE}${endpoint} -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`
      : `-s -m 8 ${BASE}${endpoint}`;
    const result = execSync(`curl ${args}`, { encoding: 'utf8', timeout: 9000 });
    return JSON.parse(result);
  } catch { return null; }
}

function fmt(result, fallback) {
  if (!result) return fallback || 'failed — KiraService may not be running';
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

// ── SCREEN ────────────────────────────────────────────────────────────────────

registry.register('read_screen', () => {
  const r = call('GET', '/screenshot');
  if (!r || !r.length) return 'screen is empty or unreadable';
  return r.map(n => `[${n.class}] "${n.text || ''}" bounds:${n.bounds} clickable:${n.clickable}`).join('\n');
}, 'read all text and elements currently visible on screen in any app');

registry.register('find_and_tap', ({ text }) => {
  const r = call('POST', '/find_and_tap', { text });
  return fmt(r, `could not find "${text}" on screen`);
}, 'find any element by text on current screen and tap it');

registry.register('tap_screen', ({ x, y }) => {
  const r = call('POST', '/tap', { x: parseInt(x), y: parseInt(y) });
  return fmt(r, 'tap failed');
}, 'tap screen at specific x,y coordinates');

registry.register('long_press', ({ x, y }) => {
  const r = call('POST', '/long_press', { x: parseInt(x), y: parseInt(y) });
  return fmt(r, 'long press failed');
}, 'long press at x,y coordinates');

registry.register('swipe_screen', ({ x1, y1, x2, y2 }) => {
  const r = call('POST', '/swipe', { x1: parseInt(x1), y1: parseInt(y1), x2: parseInt(x2), y2: parseInt(y2) });
  return fmt(r, 'swipe failed');
}, 'swipe from one point to another on screen');

registry.register('scroll_screen', ({ direction }) => {
  const r = call('POST', '/scroll', { direction: direction || 'down' });
  return fmt(r, 'scroll failed');
}, 'scroll screen up or down');

registry.register('get_focused', () => {
  const r = call('GET', '/get_focused');
  return fmt(r, 'no focused element');
}, 'get the currently focused UI element text and bounds');

// ── NAVIGATION ────────────────────────────────────────────────────────────────

registry.register('press_back', () => {
  const r = call('GET', '/back');
  return fmt(r, 'back failed');
}, 'press the back button');

registry.register('press_home', () => {
  const r = call('GET', '/home');
  return fmt(r, 'home failed');
}, 'press the home button');

registry.register('open_app', ({ package: pkg }) => {
  const r = call('POST', '/open', { package: pkg });
  return fmt(r, `could not open ${pkg}`);
}, 'open any Android app by package name e.g. com.whatsapp com.instagram.android com.android.chrome');

registry.register('installed_apps', () => {
  const r = call('GET', '/installed_apps');
  if (!r || !r.length) return 'could not get app list';
  return r.map(a => `${a.name}: ${a.package}`).join('\n');
}, 'list all installed apps with their package names');

registry.register('recent_apps', () => {
  const r = call('GET', '/recent_apps');
  return fmt(r, 'could not get recent apps');
}, 'list recently used apps');

// ── INPUT ─────────────────────────────────────────────────────────────────────

registry.register('type_text', ({ text }) => {
  const r = call('POST', '/type', { text });
  return fmt(r, 'type failed');
}, 'type text into the currently focused input field');

registry.register('clipboard_get', () => {
  const r = call('GET', '/clipboard_get');
  return r ? r.text || 'clipboard empty' : 'clipboard read failed';
}, 'read current clipboard content');

registry.register('clipboard_set', ({ text }) => {
  const r = call('POST', '/clipboard_set', { text });
  return fmt(r, 'clipboard set failed');
}, 'set clipboard content');

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

registry.register('get_notifications', () => {
  const r = call('GET', '/notifications');
  if (!r || !r.length) return 'no notifications';
  return r.map(n => `[${n.package}] ${n.title}: ${n.text} (${new Date(n.timestamp).toLocaleTimeString()})`).join('\n');
}, 'get all phone notifications from all apps including whatsapp instagram etc');

// ── SYSTEM CONTROLS ───────────────────────────────────────────────────────────

registry.register('set_volume', ({ action }) => {
  const r = call('POST', '/volume', { action });
  return fmt(r, 'volume change failed');
}, 'control volume — action: up, down, or mute');

registry.register('set_brightness', ({ level }) => {
  const r = call('POST', '/brightness', { level: parseInt(level) });
  return fmt(r, 'brightness change failed');
}, 'set screen brightness level 0-100');

registry.register('torch', ({ on }) => {
  const r = call('POST', '/torch', { on: on === true || on === 'true' });
  return fmt(r, 'torch failed');
}, 'turn flashlight on or off — on: true/false');

registry.register('wake_screen', () => {
  const r = call('GET', '/wake_screen');
  return fmt(r, 'wake failed');
}, 'wake up and unlock the phone screen');

registry.register('lock_screen', () => {
  const r = call('GET', '/lock');
  return fmt(r, 'lock failed');
}, 'lock the phone screen');

// ── SENSORS & AUDIO ───────────────────────────────────────────────────────────

registry.register('read_sensors', () => {
  const r = call('GET', '/sensors');
  if (!r) return 'sensors unavailable';
  return `accelerometer: ${JSON.stringify(r.accelerometer)}\ngyroscope: ${JSON.stringify(r.gyroscope)}\nproximity: ${r.proximity}\nlight: ${r.light} lux`;
}, 'read phone sensors — accelerometer, gyroscope, proximity, light');

registry.register('record_audio', ({ seconds }) => {
  const r = call('POST', '/record_audio', { seconds: parseInt(seconds) || 5 });
  return r ? `recorded ${seconds}s audio — base64 length: ${(r.audio || '').length}` : 'recording failed';
}, 'record audio from microphone for N seconds and return base64');

registry.register('wifi_scan', () => {
  const r = call('GET', '/wifi_scan');
  if (!r || !r.length) return 'no wifi networks found';
  return r.map(w => `${w.ssid} (${w.signal}dBm)`).join('\n');
}, 'scan available wifi networks');

registry.register('battery_info', () => {
  const r = call('GET', '/battery');
  if (!r) return 'battery info unavailable';
  return `${r.percentage}% — ${r.status} — temp: ${r.temperature}°C`;
}, 'get detailed battery information');

// smart tap — reads screen, finds text, taps its center coordinates
registry.register('tap_text', async ({ text }) => {
  try {
    const { execSync } = require('child_process');
     const raw = execSync('curl -s http://localhost:7070/screenshot', { encoding: 'utf8', timeout: 9000 });
    const data = JSON.parse(raw);
    const nodes = data.nodes || data;
    const target = nodes.find(n => n.text && n.text.toLowerCase().includes(text.toLowerCase()));
    if (!target) return `"${text}" not found on screen`;
    // parse bounds "x1,y1,x2,y2"
    const parts = target.bounds.split(',').map(Number);
    const x = Math.round((parts[0] + parts[2]) / 2);
    const y = Math.round((parts[1] + parts[3]) / 2);
    const tap = execSync(`curl -s -X POST http://localhost:7070/tap -H "Content-Type: application/json" -d '{"x":${x},"y":${y}}'`, { encoding: 'utf8' });
    return `tapped "${text}" at (${x},${y})`;
  } catch(e) { return 'tap_text failed: ' + e.message; }
}, 'find text on screen and tap it — smarter than find_and_tap');
