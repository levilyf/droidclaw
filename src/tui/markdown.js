'use strict';
/**
 * markdown.js
 * Renders markdown to a string. Output is plain text suitable for
 * blessed's log widget (which handles its own color tags separately).
 * Also exports a blessed-tagged version for rich rendering inside chat.
 */

// ── Strip ANSI ────────────────────────────────────────────────────────────────
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

// ── Inline markdown — returns plain text (blessed handles coloring) ────────────
function renderInline(text) {
  let out = text;
  // Inline code
  out = out.replace(/`([^`]+)`/g, (_, code) => `[${code}]`);
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, t) => t.toUpperCase());
  out = out.replace(/__([^_]+)__/g,     (_, t) => t.toUpperCase());
  // Italic — keep as-is (no visual distinction in plain text, that's fine)
  out = out.replace(/\*([^*]+)\*/g, (_, t) => t);
  out = out.replace(/_([^_]+)_/g,   (_, t) => t);
  // Links — show text only
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, (_, text) => text);
  // Strikethrough
  out = out.replace(/~~([^~]+)~~/g, (_, t) => t);
  return out;
}

// ── Block rendering ───────────────────────────────────────────────────────────
function renderLines(lines, width) {
  const out = [];
  let i = 0;
  const W = Math.max(20, width || 72);

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      out.push('  ┌' + '─'.repeat(Math.max(0, W - 4)) + '┐');
      for (const cl of codeLines) {
        const padded = cl.slice(0, W - 6);
        const pad    = Math.max(0, W - 6 - padded.length);
        out.push('  │ ' + padded + ' '.repeat(pad) + ' │');
      }
      out.push('  └' + '─'.repeat(Math.max(0, W - 4)) + '┘');
      out.push('');
      continue;
    }

    // Headings
    if (line.startsWith('### ')) { out.push(renderInline(line.slice(4))); i++; continue; }
    if (line.startsWith('## '))  { out.push('── ' + renderInline(line.slice(3)) + ' ──'); out.push(''); i++; continue; }
    if (line.startsWith('# '))   {
      const h = renderInline(line.slice(2));
      out.push(''); out.push(h); out.push('─'.repeat(Math.min(h.length, W)));
      i++; continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      out.push('▌ ' + renderInline(line.slice(2)));
      i++; continue;
    }

    // Unordered list
    if (line.match(/^[-*•] /)) {
      out.push('  ◦ ' + renderInline(line.slice(2)));
      i++; continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\d+)\.\s/);
    if (olMatch) {
      out.push('  ' + olMatch[1] + '. ' + renderInline(line.slice(olMatch[0].length)));
      i++; continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      out.push('─'.repeat(Math.min(W - 2, 48)));
      i++; continue;
    }

    // Empty line
    if (!line.trim()) { out.push(''); i++; continue; }

    // Paragraph — wrap
    for (const wl of wrapLine(renderInline(line), W)) {
      out.push(wl);
    }
    i++;
  }

  return out;
}

function wrapLine(text, width) {
  const max   = Math.max(20, width - 2);
  const lines = [];
  const words = text.split(' ');
  let line = '', lineLen = 0;

  for (const word of words) {
    const wLen = word.length;
    if (lineLen > 0 && lineLen + wLen + 1 > max) {
      lines.push(line); line = word; lineLen = wLen;
    } else {
      line    = line ? line + ' ' + word : word;
      lineLen = lineLen ? lineLen + 1 + wLen : wLen;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * render(text, width) — returns plain string (no ANSI, no blessed tags)
 * suitable for passing to blessed's log widget directly.
 */
function render(text, width) {
  return renderLines(String(text).split('\n'), width).join('\n');
}

/**
 * stripMarkdown(text) — remove all markdown syntax, return plain text
 */
function stripMarkdown(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#+\s/gm, '')
    .replace(/^[-*•]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/^>\s/gm, '');
}

module.exports = { render, stripMarkdown, stripAnsi };
