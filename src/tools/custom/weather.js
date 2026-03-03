'use strict';
const https = require('https');
const registry = require('../registry');

registry.register('weather', async (args) => {
  return new Promise((resolve, reject) => {
    // using wttr.in - no key needed, returns plain text
    const url = 'https://wttr.in/Mumbai+India?format=%C+%t+%h+mumbai';
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const clean = data.replace(/\+/g, '').trim();
        resolve(clean || 'weather unavailable');
      });
    }).on('error', () => {
      resolve('weather error');
    });
  });
});