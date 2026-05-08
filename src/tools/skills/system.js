'use strict';
const os   = require('os');
const fs   = require('fs');
const path = require('path');
const registry = require('../registry');
const mind = require('../../core/mind');

/**
 * System info skill — shows Kira's current state
 * Follows architecture: uses KIRA_MIND (mind.js) for data
 */
module.exports = {
  name: 'system',
  description: 'show Kira system status — mood, memory stats, routing info',
  execute: async () => {
    const stats = mind.stats();
    const uptime = _formatUptime(process.uptime());

    return [
      `mood: ${stats.mood}`,
      `memories: ${stats.memories}`,
      `beliefs: ${stats.beliefs}`,
      `tasks done: ${stats.tasks_done}`,
      `total sessions: ${stats.conversations}`,
      `uptime: ${uptime}`,
    ].join('\n');
  }
};

function _formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
