'use strict';
module.exports = async (args) => {
 const { execSync } = require('child_process');
 const url = args.url || 'https://httpbin.org/get';
 try {
   return execSync(`curl -s "${url}" | head -20`, { encoding: 'utf8' });
 } catch (e) {
   return e.message;
 }
};