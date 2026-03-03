'use strict';
const { execSync } = require('child_process');
const registry     = require('./registry');

registry.register('exec', async ({ command }) => {
  if (!command) throw new Error('no command provided');
  try {
    const result = execSync(command, {
      encoding:  'utf8',
      timeout:   10000,
      maxBuffer: 1024 * 1024,
    });
    return result.trim() || '(no output)';
  } catch (e) {
    return `error: ${e.message.split('\n')[0]}`;
  }
}, 'run any shell command on the device');
