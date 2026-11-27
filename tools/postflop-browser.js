// Browser check of js/postflop/worker.js as a module Web Worker (headless
// Chromium via playwright-core): node tools/postflop-browser.js
// Serves the repo from a throwaway local HTTP server, plus one virtual test
// page (no file is written), runs river / turn / depth-limited flop solves
// through the worker and prints what the page saw.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { chen } from './js/cards.js';
import { comboCards, comboIndex, NUM_COMBOS } from './js/postflop/solver.js';
const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
function topRange(frac) {
  const sc = [];
  for (let i = 0; i < NUM_COMBOS; i++) { const [a, b] = comboCards(i); sc.push([chen([a, b]) + ((a >> 2) + (b >> 2)) / 100, i]); }
  sc.sort((x, y) => y[0] - x[0]);
  const cut = sc[Math.round(frac * NUM_COMBOS)][0];
  const w = new Float32Array(NUM_COMBOS);
  for (const [s, i] of sc) if (s >= cut) w[i] = 1;
  return w;
}
const worker = new Worker(new URL('./js/postflop/worker.js', import.meta.url), { type: 'module' });
function solve(id, input, hands) {
  return new Promise(res => {
    const updates = [];
    worker.onmessage = e => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.error) return res({ id, error: m.error });
      updates.push({ t: m.elapsedMs, iter: m.iter, exploit: m.exploit });
      if (m.done) res({ id, iter: m.iter, ms: m.elapsedMs, exploit: m.exploit, reason: m.reason, memoryMB: (m.memoryBytes / 1e6).toFixed(1), updates: updates.length, first: updates[0], strat: m.strategies[hands[0]] });
    };
    worker.postMessage({ cmd: 'solve', id, input, hands, path: [] });
  });
}
const ranges = [topRange(0.4), topRange(0.38)];
const hands = [comboIndex(...C('AhKh'))];
window.results = (async () => [
  await solve('river', { board: C('Ks9h6d3c2s'), pot: 10, stack: 90, ranges, targetExploit: 0.5, maxMs: 5000 }, hands),
  await solve('turn', { board: C('Ks9h6d3c'), pot: 10, stack: 90, ranges, targetExploit: 1, maxMs: 15000 }, hands),
  await solve('flop-dl', { board: C('Ks9h6d'), pot: 10, stack: 90, ranges, maxMs: 4000 }, hands),
])();
</script>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__postflop_test.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium' });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/__postflop_test.html`);
  const results = await page.evaluate(() => window.results);
  for (const r of results) console.log(JSON.stringify(r));
} finally {
  await browser.close();
  server.close();
}
