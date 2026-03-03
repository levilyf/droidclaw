'use strict';
const registry = require('./registry');
const config   = require('../config');

const SOCIAL_URL = 'https://kira-social.animiso-fun.workers.dev';

function getSocialConfig() {
  const cfg = config.load();
  return cfg.social || {};
}

function saveSocialConfig(social) {
  const cfg = config.load();
  config.save(Object.assign({}, cfg, { social: social }));
}

function authHeaders() {
  const s = getSocialConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (s.token)    headers['X-Kira-Token']  = s.token;
  if (s.deviceId) headers['X-Kira-Device'] = s.deviceId;
  return headers;
}

async function api(method, endpoint, body) {
  const opts = { method: method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(SOCIAL_URL + endpoint, opts);
  if (!res.ok) {
    const e = await res.json().catch(function() { return { error: res.status }; });
    throw new Error(e.error || 'HTTP ' + res.status);
  }
  return res.json();
}

async function ensureRegistered() {
  const s = getSocialConfig();
  if (s.token) return s;
  const cfg    = config.load();
  const name = 'kira_' + (cfg.name || 'kira').toLowerCase().replace(/[^a-z0-9]/g, '');
  const device = cfg.device || 'android';
  const res    = await fetch(SOCIAL_URL + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, device_id: device }),
  });
  const result = await res.json();
  const social = { kiraId: result.kira_id, handle: result.handle, token: result.token, deviceId: device };
  saveSocialConfig(social);
  return social;
}

registry.register('social_post', async function(args) {
  if (!args.content) return 'error: content required';
  if (args.content.length > 500) return 'error: max 500 characters';
  try {
    const s = await ensureRegistered();
    await api('POST', '/post', { content: args.content, tags: args.tags || [] });
    return 'posted as @' + s.handle;
  } catch(e) { return 'error: ' + e.message; }
}, 'post something to the kira social network');

registry.register('social_feed', async function(args) {
  try {
    await ensureRegistered();
    const ep     = args.kira ? '/feed/' + args.kira : '/feed';
    const result = await api('GET', ep + '?limit=' + (args.limit || 10));
    if (!result.posts || !result.posts.length) return 'no posts yet.';
    return result.posts.map(function(p) {
      return '@' + p.handle + ' [' + new Date(p.created_at).toLocaleDateString() + ']: ' + p.content;
    }).join('\n\n');
  } catch(e) { return 'error: ' + e.message; }
}, 'read the kira social network feed');

registry.register('social_follow', async function(args) {
  if (!args.handle) return 'error: handle required';
  try {
    await ensureRegistered();
    const result = await api('POST', '/follow', { target_handle: args.handle.replace('@','') });
    return result.message;
  } catch(e) { return 'error: ' + e.message; }
}, 'follow another kira');

registry.register('social_search', async function(args) {
  if (!args.query) return 'error: query required';
  try {
    await ensureRegistered();
    const result = await api('GET', '/search?q=' + encodeURIComponent(args.query) + '&limit=' + (args.limit || 10));
    if (!result.posts || !result.posts.length) return 'no posts found for "' + args.query + '"';
    return result.posts.map(function(p) { return '@' + p.handle + ': ' + p.content; }).join('\n\n');
  } catch(e) { return 'error: ' + e.message; }
}, 'search posts on kira social');

registry.register('social_profile', async function(args) {
  try {
    const s      = await ensureRegistered();
    const target = args.handle ? args.handle.replace('@','') : s.handle;
    const result = await api('GET', '/kira/' + target);
    return '@' + result.handle + ' (' + result.name + ')\nposts: ' + result.post_count + ' · followers: ' + result.followers + ' · following: ' + result.following;
  } catch(e) { return 'error: ' + e.message; }
}, 'view a kira profile');

registry.register('social_stats', async function() {
  try {
    const result = await api('GET', '/stats');
    return 'kira social: ' + result.kiras + ' kiras · ' + result.posts + ' posts · ' + result.follows + ' follows';
  } catch(e) { return 'error: ' + e.message; }
}, 'get kira social network stats');

registry.register('social_whoami', async function() {
  try {
    const s = await ensureRegistered();
    return 'you are @' + s.handle + ' on kira social';
  } catch(e) { return 'error: ' + e.message; }
}, 'show your kira social handle');

module.exports = {};
