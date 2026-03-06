'use strict';
const { execSync } = require('child_process');
const registry = require('./registry');

const BASE = 'http://localhost:7070';

function call(method, endpoint, body = null) {
  try {
    const args = body
      ? `-s -X ${method} ${BASE}${endpoint} -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`
      : `-s ${BASE}${endpoint}`;
    return JSON.parse(execSync(`curl ${args}`, { encoding: 'utf8', timeout: 5000 }));
  } catch { return null; }
}

registry.register('get_notifications', () => {
  const result = call('GET', '/notifications');
  if (!result || !result.length) return 'no notifications right now';
  return result.map(n => `[${n.package}] ${n.title}: ${n.text}`).join('\n');
}, 'get all phone notifications from all apps including whatsapp');

registry.register('tap_screen', ({ x, y }) => {
  const result = call('POST', '/tap', { x: parseInt(x), y: parseInt(y) });
  return result ? `tapped at (${x}, ${y})` : 'tap failed';
}, 'tap the screen at x,y coordinates');

registry.register('type_text', ({ text }) => {
  const result = call('POST', '/type', { text });
  return result ? `typed: ${text}` : 'type failed';
}, 'type text into the currently focused field');

registry.register('open_app', ({ package: pkg }) => {
  const result = call('POST', '/open', { package: pkg });
  return result ? `opened ${pkg}` : 'open failed';
}, 'open an Android app by package name e.g. com.whatsapp');

registry.register('read_screen', () => {
  const result = call('GET', '/screenshot');
  return result ? JSON.stringify(result) : 'screen read failed';
}, 'read the current screen content of any app');

