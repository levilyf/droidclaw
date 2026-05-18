'use strict';
/**
 * Web Fetch Tool
 * Lets Kira fetch any public URL and read its content.
 * Uses curl — already available in Termux.
 */

const { spawnSync } = require('child_process');
const registry = require('./registry');

const ENV = {
  ...process.env,
  PATH: '/data/data/com.termux/files/usr/bin:' + (process.env.PATH || ''),
};

// ── Strip HTML to readable text ───────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

// ── Main fetch ────────────────────────────────────────────────────────────────
function fetch(url, options = {}) {
  const maxBytes = options.maxBytes || 50000; // 50kb default
  const timeout  = options.timeout  || 15;    // 15 second timeout

  const args = [
    '-s',                    // silent
    '-L',                    // follow redirects
    '-m', String(timeout),   // timeout
    '--max-filesize', String(maxBytes),
    '-A', 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0 Safari/537.36',
    '--compressed',
    url,
  ];

  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    timeout:  (timeout + 2) * 1000,
    env:      ENV,
    maxBuffer: maxBytes * 2,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: `curl exited with ${result.status}` };

  const raw = result.stdout || '';
  if (!raw) return { ok: false, error: 'empty response' };

  // detect content type
  const isJson = raw.trim().startsWith('{') || raw.trim().startsWith('[');
  const isHtml = /<html/i.test(raw.slice(0, 500));

  let content;
  if (isJson) {
    content = raw.slice(0, maxBytes);
  } else if (isHtml) {
    content = stripHtml(raw).slice(0, maxBytes);
  } else {
    content = raw.slice(0, maxBytes);
  }

  return { ok: true, content, length: content.length };
}

// ── Register tools ────────────────────────────────────────────────────────────
registry.register('web_fetch', async ({ url, max_length }) => {
  if (!url) return 'error: url required';

  // basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const maxBytes = max_length ? parseInt(max_length) * 4 : 30000;
  const result   = fetch(url, { maxBytes });

  if (!result.ok) return `error fetching ${url}: ${result.error}`;

  return result.content;
}, 'fetch any public URL and read its content — web pages, APIs, anything');

registry.register('web_search_fetch', async ({ query, num_results }) => {
  if (!query) return 'error: query required';

  const n   = Math.min(parseInt(num_results) || 3, 5);
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const result = fetch(url, { maxBytes: 40000 });
  if (!result.ok) return `search failed: ${result.error}`;

  // extract result snippets from DDG HTML
  const content = result.content;
  const lines   = content.split('\n').filter(l => l.trim().length > 30);

  // find result titles and snippets
  const results = [];
  let current   = '';
  for (const line of lines) {
    const clean = line.trim();
    if (clean.length > 20 && clean.length < 300) {
      if (current && results.length < n) {
        results.push(current.trim());
        current = '';
      }
      current += clean + ' ';
    }
  }
  if (current && results.length < n) results.push(current.trim());

  if (!results.length) return `no results found for: ${query}`;
  return results.slice(0, n).join('\n\n---\n\n');
}, 'search the web and get result snippets — use for current information');

registry.register('fetch_json', async ({ url, path }) => {
  if (!url) return 'error: url required';

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const result = fetch(url, { maxBytes: 100000 });
  if (!result.ok) return `error: ${result.error}`;

  try {
    const data = JSON.parse(result.content);

    // if path specified, extract that field
    if (path) {
      const parts = path.split('.');
      let val = data;
      for (const p of parts) {
        val = val?.[p];
      }
      return JSON.stringify(val, null, 2).slice(0, 3000);
    }

    return JSON.stringify(data, null, 2).slice(0, 3000);
  } catch {
    return result.content.slice(0, 2000);
  }
}, 'fetch a JSON API endpoint — optionally extract a specific field with path like "data.results"');

registry.register('github_repo', async ({ repo }) => {
  if (!repo) return 'error: repo required (format: owner/repo)';

  const result = fetch(`https://api.github.com/repos/${repo}`, {
    maxBytes: 20000,
    timeout:  10,
  });
  if (!result.ok) return `error: ${result.error}`;

  try {
    const data = JSON.parse(result.content);
    return [
      `${data.full_name}`,
      `⭐ ${data.stargazers_count} stars · 🍴 ${data.forks_count} forks`,
      `${data.description || 'no description'}`,
      `language: ${data.language || 'unknown'}`,
      `open issues: ${data.open_issues_count}`,
      `last push: ${data.pushed_at?.slice(0, 10)}`,
    ].join('\n');
  } catch {
    return result.content.slice(0, 1000);
  }
}, 'get GitHub repo info — stars, forks, issues, last push');

registry.register('github_issues', async ({ repo, state }) => {
  if (!repo) return 'error: repo required';
  const s = state || 'open';

  const result = fetch(`https://api.github.com/repos/${repo}/issues?state=${s}&per_page=10`, {
    maxBytes: 30000,
    timeout:  10,
  });
  if (!result.ok) return `error: ${result.error}`;

  try {
    const issues = JSON.parse(result.content);
    if (!issues.length) return `no ${s} issues`;
    return issues.slice(0, 5).map(i =>
      `#${i.number} ${i.title}\n  by ${i.user?.login} · ${i.created_at?.slice(0, 10)}`
    ).join('\n\n');
  } catch {
    return result.content.slice(0, 1000);
  }
}, 'get GitHub issues for a repo — state: open or closed');

registry.register('weather', async ({ city }) => {
  const location = city || 'Surat';
  const result   = fetch(`https://wttr.in/${encodeURIComponent(location)}?format=3`, {
    maxBytes: 500,
    timeout:  8,
  });
  if (!result.ok) return `weather unavailable: ${result.error}`;
  return result.content.trim();
}, 'get current weather for any city');

module.exports = { fetch };
