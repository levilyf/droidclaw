'use strict';
const registry = require('./registry');
const https    = require('https');
const config   = require('../config');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'parse failed', raw: data.slice(0, 200) }); }
      });
    }).on('error', reject);
  });
}

registry.register('search', async function(args) {
  const query = args.query || args.q;
  if (!query) return 'error: query required';

  const cfg   = config.load();
  const key   = cfg.googleSearchKey;
  const cx    = cfg.googleSearchCx;

  if (!key || !cx) return 'error: googleSearchKey and googleSearchCx missing from config.json';

  const limit = Math.min(args.limit || 5, 10);
  const url   = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=${limit}`;

  const data = await httpsGet(url);

  if (data.error) return 'search error: ' + (data.error.message || JSON.stringify(data.error));
  if (!data.items || !data.items.length) return 'no results for: ' + query;

  return data.items.map((item, i) => {
    return `${i + 1}. ${item.title}\n   ${item.link}\n   ${item.snippet || ''}`;
  }).join('\n\n');
}, 'search the web using google. args: query (required), limit (optional, max 10)');

module.exports = {};
