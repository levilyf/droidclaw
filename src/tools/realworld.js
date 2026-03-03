'use strict';
const registry = require('./registry');
const { execSync } = require('child_process');

function run(cmd, timeout = 8000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout });
  } catch (e) {
    throw new Error(e.message.slice(0, 200));
  }
}

// ─── CONTACTS ────────────────────────────────────────────────────────────────

registry.register('contacts_list', async ({ search }) => {
  const raw = run('termux-contact-list');
  const contacts = JSON.parse(raw);
  if (search) {
    const q = search.toLowerCase();
    const filtered = contacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.number?.includes(q)
    );
    if (!filtered.length) return `no contacts matching "${search}"`;
    return filtered.map(c => `${c.name}: ${c.number}`).join('\n');
  }
  return `${contacts.length} contacts. use search param to find specific ones.`;
}, 'list or search contacts');

registry.register('contact_find', async ({ name }) => {
  if (!name) return 'error: name required';
  const raw      = run('termux-contact-list');
  const contacts = JSON.parse(raw);
  const q        = name.toLowerCase();
  const found    = contacts.filter(c => c.name?.toLowerCase().includes(q));
  if (!found.length) return `no contact found for "${name}"`;
  return found.map(c => `${c.name}: ${c.number}`).join('\n');
}, 'find a contact by name');

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

registry.register('notifications_list', async ({ limit }) => {
  const raw   = run('termux-notification-list');
  const notifs = JSON.parse(raw);
  const n     = limit ? parseInt(limit) : 10;
  const recent = notifs.slice(0, n);
  if (!recent.length) return 'no notifications.';
  return recent.map(n =>
    `[${n.app || 'unknown'}] ${n.title || ''}: ${n.content || n.text || ''}`
  ).join('\n');
}, 'list recent notifications');

registry.register('notifications_watch', async ({ app }) => {
  const raw    = run('termux-notification-list');
  const notifs = JSON.parse(raw);
  const filtered = app
    ? notifs.filter(n => n.app?.toLowerCase().includes(app.toLowerCase()))
    : notifs;
  if (!filtered.length) return app ? `no notifications from ${app}` : 'no notifications.';
  return filtered.slice(0, 5).map(n =>
    `[${n.app}] ${n.title || ''}: ${n.content || n.text || ''}`
  ).join('\n');
}, 'watch notifications from a specific app');

// ─── SMS ─────────────────────────────────────────────────────────────────────

registry.register('sms_list', async ({ limit, number }) => {
  const limitN = limit ? parseInt(limit) : 10;
  let cmd = `termux-sms-list -l ${limitN}`;
  if (number) cmd += ` -n "${number}"`;
  const raw  = run(cmd, 10000);
  const msgs = JSON.parse(raw);
  if (!msgs.length) return 'no messages.';
  return msgs.map(m =>
    `[${m.type || 'sms'}] ${m.number} (${m.received || ''}): ${m.body?.slice(0, 100) || ''}`
  ).join('\n');
}, 'list recent SMS messages');

registry.register('sms_send', async ({ number, message }) => {
  if (!number || !message) return 'error: number and message required';
  // Safety — ask before sending
  run(`termux-sms-send -n "${number}" "${message.replace(/"/g, '\\"')}"`);
  return `sms sent to ${number}: "${message}"`;
}, 'send an SMS message');

registry.register('sms_read_from', async ({ name }) => {
  if (!name) return 'error: name required';
  // Find contact number first
  const raw      = run('termux-contact-list');
  const contacts = JSON.parse(raw);
  const contact  = contacts.find(c => c.name?.toLowerCase().includes(name.toLowerCase()));
  if (!contact) return `contact "${name}" not found`;
  const msgs = JSON.parse(run(`termux-sms-list -l 10 -n "${contact.number}"`, 10000));
  if (!msgs.length) return `no messages with ${contact.name}`;
  return msgs.map(m =>
    `${m.type === 'incoming' ? contact.name : 'you'}: ${m.body?.slice(0, 150) || ''}`
  ).join('\n');
}, 'read SMS conversation with a contact by name');

// ─── CALL LOG ────────────────────────────────────────────────────────────────

registry.register('call_log', async ({ limit }) => {
  const n   = limit ? parseInt(limit) : 10;
  const raw = run(`termux-call-log -l ${n}`);
  const log = JSON.parse(raw);
  if (!log.length) return 'no call history.';
  return log.map(c =>
    `${c.type || 'call'} — ${c.name || c.number} (${c.duration || 0}s) — ${c.date || ''}`
  ).join('\n');
}, 'view recent call log');

module.exports = {};
