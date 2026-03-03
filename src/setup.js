'use strict';
const chalk    = require('chalk');
const readline = require('readline');
const config   = require('./config');

const C = {
  primary: '#f4a7b9',
  dim:     '#a0607a',
  muted:   '#3d1a2a',
  accent:  '#f9d0dc',
  mid:     '#7a4060',
  hint:    '#4a2038',
};

const KIRA_ART = [
  ``,
  `  ██╗  ██╗██╗██████╗  █████╗ `,
  `  ██║ ██╔╝██║██╔══██╗██╔══██╗`,
  `  █████╔╝ ██║██████╔╝███████║`,
  `  ██╔═██╗ ██║██╔══██╗██╔══██║`,
  `  ██║  ██╗██║██║  ██║██║  ██║`,
  `  ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝`,
  ``,
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ask(question, defaultVal, masked = false) {
  return new Promise(resolve => {
    let buf = '';
    const q = chalk.hex(C.dim)(`  ${question}`) +
              (defaultVal && !masked ? chalk.hex(C.hint)(` [${defaultVal}]`) : '') +
              chalk.hex(C.primary)(' › ');
    process.stdout.write(q);

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      for (let i = 0; i < key.length; i++) {
        const c = key[i], code = key.charCodeAt(i);
        if (code === 3) process.exit(0);
        if (code === 13 || code === 10) {
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          resolve(buf || defaultVal || '');
          return;
        }
        if (code === 127 || code === 8) {
          if (buf.length) {
            buf = buf.slice(0, -1);
            process.stdout.write('\u0008 \u0008');
          }
          continue;
        }
        if (code >= 32) {
          buf += c;
          process.stdout.write(masked ? chalk.hex(C.hint)('*') : chalk.hex(C.mid)(c));
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function printSlowly(text, color, delay = 30) {
  for (const char of text) {
    process.stdout.write(chalk.hex(color)(char));
    await sleep(delay);
  }
  process.stdout.write('\n');
}

function askMasked(question) {
  return new Promise(resolve => {
    let buf = '';
    process.stdout.write(chalk.hex(C.dim)(`  ${question}`) + chalk.hex(C.primary)(' › '));
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      for (let i = 0; i < key.length; i++) {
        const c = key[i], code = key.charCodeAt(i);
        if (code === 3) process.exit(0);
        if (code === 13 || code === 10) {
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          resolve(buf);
          return;
        }
        if (code === 127 || code === 8) {
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\u0008 \u0008'); }
          continue;
        }
        if (code >= 32) { buf += c; process.stdout.write(chalk.hex(C.hint)('*')); }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function run() {
  console.clear();

  // Fade in ASCII art
  for (const line of KIRA_ART) {
    const colored = line.includes('█')
      ? chalk.hex(C.primary)(line)
      : chalk.hex(C.hint)(line);
    process.stdout.write(colored + '\n');
    await sleep(40);
  }

  await sleep(300);

  // Kira introduces herself
  await printSlowly(`  first boot. i'm kira.`, C.accent, 25);
  await sleep(200);
  await printSlowly(`  i run on your phone. i use real tools. i learn.`, C.dim, 20);
  await sleep(200);
  await printSlowly(`  let's get you set up.\n`, C.hint, 20);
  await sleep(300);

  const { execSync } = require('child_process');

  // Detect device
  let device = 'Android';
  try { device = execSync('getprop ro.product.model', { encoding: 'utf8', timeout: 2000 }).trim(); } catch {}

  // Check termux:api
  let hasTermuxApi = false;
  try { execSync('termux-battery-status', { timeout: 4000 }); hasTermuxApi = true; } catch {}

  console.log(chalk.hex(C.hint)(`  device   : ${device}`));
  console.log(chalk.hex(C.hint)(`  termux   : ${hasTermuxApi ? 'api available ✓' : 'basic mode'}\n`));

  // Name
  await printSlowly(`  what do i call you?`, C.dim, 20);
  const name = await ask('', 'user');
  console.log();

  await printSlowly(`  got it, ${name.toLowerCase()}. now the api.\n`, C.accent, 20);

  // Provider selection
  const PROVIDERS = [
    { label: 'OpenAI',      url: 'https://api.openai.com/v1',          model: 'gpt-4o-mini' },
    { label: 'Anthropic',   url: 'https://api.anthropic.com/v1',        model: 'claude-sonnet-4-6' },
    { label: 'Groq',        url: 'https://api.groq.com/openai/v1',      model: 'llama-3.3-70b-versatile' },
    { label: 'Together AI', url: 'https://api.together.xyz/v1',         model: 'meta-llama/Llama-3-70b-chat-hf' },
    { label: 'Mistral',     url: 'https://api.mistral.ai/v1',           model: 'mistral-small-latest' },
    { label: 'Ollama',      url: 'http://localhost:11434/v1',            model: 'llama3' },
    { label: 'NVIDIA NIM',  url: 'https://integrate.api.nvidia.com/v1', model: 'moonshotai/kimi-k2-instruct' },
    { label: 'Custom',      url: '',                                     model: '' },
  ];

  console.log(chalk.hex(C.dim)('  pick a provider:\n'));
  PROVIDERS.forEach((p, i) => {
    console.log(chalk.hex(C.hint)(`  ${String(i + 1).padStart(2)}  ${p.label}`));
  });
  console.log();

  const choice  = await ask('provider', '1');
  const idx     = Math.max(0, Math.min(7, parseInt(choice, 10) - 1));
  const preset  = PROVIDERS[idx];
  console.log();

  const apiKey  = await ask('api key', '', true);
  const baseUrl = await ask('base url', preset.url);
  const model   = await ask('model', preset.model);
  console.log();

  // Telegram
  await printSlowly(`  telegram? (optional — press enter to skip)`, C.dim, 15);
  const telegramToken = await ask('bot token (enter to skip)', '', true);
  let telegramAllowed = [];
  if (telegramToken) {
    await printSlowly(`  message @userinfobot on telegram to get your ID`, C.hint, 15);
    const userId = await ask('your telegram user ID', '');
    if (userId) telegramAllowed.push(userId);
  }
  console.log();

  // ElevenLabs voice
  await printSlowly(`  voice? i can speak using ElevenLabs. (optional)`, C.dim, 15);
  const elevenLabsKey = await ask('ElevenLabs API key (enter to skip)', '', true);
  console.log();

  // Save
  config.save({
    name, apiKey, baseUrl, model,
    setupDone: true, device, hasTermuxApi,
    telegramToken, telegramAllowed,
    elevenLabsKey,
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  });

  // Init workspace
  const workspace = require('./workspace');
  workspace.init();

  await sleep(200);
  await printSlowly(`  setup done. let's go.`, C.primary, 25);
  await sleep(600);
}

module.exports = { run };
