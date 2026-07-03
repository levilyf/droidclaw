'use strict';
/**
 * SKILL MATCHER — Intelligent Skill Selection Engine
 *
 * Runs before every response.
 * Finds which skills are relevant to the current message
 * without an LLM call — fast, deterministic, smart.
 *
 * Falls back to M2.7 classification only for genuine ambiguity.
 */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const registry = require('../tools/registry');

const SKILLS_DIR      = path.join(__dirname, '..', 'tools', 'skills');
const USER_SKILLS_DIR = path.join(os.homedir(), '.droidclaw', 'skills');
const PERF_FILE       = path.join(os.homedir(), '.droidclaw', 'skill_performance.json');

// ── Performance tracking ──────────────────────────────────────────────────────
function loadPerf() {
  try { return JSON.parse(fs.readFileSync(PERF_FILE, 'utf8')); }
  catch { return {}; }
}

function savePerf(perf) {
  try { fs.writeFileSync(PERF_FILE, JSON.stringify(perf, null, 2)); }
  catch {}
}

function recordSkillUse(skillName, succeeded) {
  const perf = loadPerf();
  if (!perf[skillName]) perf[skillName] = { uses: 0, wins: 0, losses: 0, lastUsed: null };
  perf[skillName].uses++;
  if (succeeded) perf[skillName].wins++;
  else perf[skillName].losses++;
  perf[skillName].lastUsed = Date.now();
  savePerf(perf);
}

function getSkillPerf(skillName) {
  const perf = loadPerf();
  return perf[skillName] || { uses: 0, wins: 0, losses: 0 };
}

function getTopSkills(n = 5) {
  const perf = loadPerf();
  return Object.entries(perf)
    .map(([name, p]) => ({ name, rate: p.uses > 0 ? p.wins / p.uses : 0, uses: p.uses }))
    .filter(s => s.uses >= 2)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, n);
}

// ── Skill catalog ─────────────────────────────────────────────────────────────
function getSkillCatalog() {
  const skills = [];
  const tools  = registry.list();

  // get all registered tools that came from skill files
  const skillNames = new Set();

  // builtin skills
  try {
    fs.readdirSync(SKILLS_DIR)
      .filter(f => f.endsWith('.js') && !['loader.js', 'index.js'].includes(f))
      .forEach(f => {
        const skill = require(path.join(SKILLS_DIR, f));
        if (skill.name) skillNames.add(skill.name);
      });
  } catch {}

  // user skills
  try {
    if (fs.existsSync(USER_SKILLS_DIR)) {
      fs.readdirSync(USER_SKILLS_DIR)
        .filter(f => f.endsWith('.js'))
        .forEach(f => {
          try {
            const skill = require(path.join(USER_SKILLS_DIR, f));
            if (skill.name) skillNames.add(skill.name);
          } catch {}
        });
    }
  } catch {}

  // build catalog with descriptions
  skillNames.forEach(name => {
    const desc = tools.find ? null : null; // registry doesn't expose descriptions directly
    skills.push({ name, description: getSkillDescription(name) });
  });

  return skills;
}

function getSkillDescription(name) {
  // try to get description from the skill file
  try {
    const builtinPath = path.join(SKILLS_DIR, `${name}.js`);
    if (fs.existsSync(builtinPath)) {
      const skill = require(builtinPath);
      return skill.description || '';
    }
    const userPath = path.join(USER_SKILLS_DIR, `${name}.js`);
    if (fs.existsSync(userPath)) {
      const skill = require(userPath);
      return skill.description || '';
    }
  } catch {}
  return '';
}

// ── TF-IDF inspired scoring — fast, no LLM ────────────────────────────────────
function scoreSkill(skill, message, emotionState) {
  const msgWords  = tokenize(message);
  const skillWords = tokenize(skill.name + ' ' + skill.description);
  let score = 0;

  // keyword overlap
  const overlap = msgWords.filter(w => skillWords.includes(w));
  score += overlap.length * 0.3;

  // exact skill name in message
  if (message.toLowerCase().includes(skill.name.toLowerCase())) score += 1.0;

  // performance boost — proven skills score higher
  const perf = getSkillPerf(skill.name);
  if (perf.uses > 0) {
    const rate = perf.wins / perf.uses;
    score += rate * 0.4;
  }

  // recency boost — recently used skills are more relevant
  if (perf.lastUsed) {
    const hoursAgo = (Date.now() - perf.lastUsed) / 3600000;
    if (hoursAgo < 24) score += 0.2;
  }

  return score;
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
  'can', 'you', 'her', 'him', 'they', 'will', 'have', 'all', 'been',
  'not', 'use', 'any', 'how', 'its', 'but', 'get', 'set', 'run',
]);

// ── Main match function ───────────────────────────────────────────────────────
function match(message, emotionState = null, limit = 3) {
  const catalog = getSkillCatalog();
  if (!catalog.length) return [];

  const scored = catalog
    .map(skill => ({ ...skill, score: scoreSkill(skill, message, emotionState) }))
    .filter(s => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

// ── Build context injection for soul.js ──────────────────────────────────────
function buildSkillContext(message, emotionState = null) {
  const matched = match(message, emotionState);
  if (!matched.length) return null;

  const lines = ['## RELEVANT SKILLS'];
  matched.forEach(s => {
    const perf = getSkillPerf(s.name);
    const perfStr = perf.uses > 0
      ? ` (${perf.wins}/${perf.uses} success rate)`
      : ' (new)';
    lines.push(`- ${s.name}${perfStr}: ${s.description}`);
  });
  lines.push('→ use these tools if they fit what\'s being asked');

  return lines.join('\n');
}

// ── Auto-create skill from successful pattern ─────────────────────────────────
// Called during sleep — extracts reusable patterns from successful multi-tool sessions
async function autoCreateSkills(engine, conversationHistory) {
  if (!conversationHistory || conversationHistory.length < 6) return;

  const history = conversationHistory
    .map(c => `${c.role}: ${c.content.slice(0, 200)}`)
    .join('\n');

  try {
    const result = await engine.rawChat(`
You are analyzing a conversation to find reusable patterns worth turning into skills.

Conversation:
${history.slice(-3000)}

A skill is worth creating when:
- The same type of task appeared multiple times
- A multi-step solution was used that could be reused
- Something worked well that has general applicability

Respond in JSON only:
{
  "should_create": true/false,
  "skills": [
    {
      "name": "snake_case_name",
      "description": "one line description of what this skill does",
      "code": "full module.exports = { name, description, async execute(args) { ... } } code"
    }
  ]
}

Rules:
- Only create skills for genuinely reusable patterns
- Code must be valid Node.js that works in Termux
- name must be snake_case, max 30 chars
- Max 2 skills per session
- Return { "should_create": false, "skills": [] } if nothing worth creating
`);

    const clean  = result.replace(/thinking[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
    const match  = clean.match(/\{[\s\S]*\}/);
    if (!match) return;

    const parsed = JSON.parse(match[0]);
    if (!parsed.should_create || !parsed.skills?.length) return;

    const loader = require('../tools/skills/loader');
    parsed.skills.forEach(skill => {
      if (!skill.name || !skill.code) return;
      const result = loader.installSkill(skill.name, skill.code);
      if (result.ok) {
        // track in MIND
        try {
          const mind = require('../core/mind');
          mind.setKiraState('observation', `auto-created skill: ${skill.name} — ${skill.description}`, 2);
        } catch {}
      }
    });

  } catch {}
}

module.exports = {
  match,
  buildSkillContext,
  recordSkillUse,
  getSkillPerf,
  getTopSkills,
  autoCreateSkills,
};
