'use strict';
const { execSync } = require('child_process');

module.exports = async (args) => {
 const query = args.query || 'test';
 try {
 const cmd = 'curl -s "https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query) + '" | grep -o \'result__title.*</a>\' | head -3 | sed \'s/.*>\\(.*\)<\/a>.*/\\1/\'';
 return execSync(cmd, { encoding: 'utf8' }).trim() || 'no results';
 } catch (e) {
 return 'search broken: ' + e.message;
 }
};