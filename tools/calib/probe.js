// Budget probe: solve a few (spot, flop) pairs at a short and a long per-flop budget and compare IP:OOP realization.
//   node tools/calib/probe.js --spots BB|SB|0,BTN|BB|1 --flops 4 --short 90000 --long 300000 --workers 7 [--damp-free]
import path from 'path';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { loadBin, enumerateEndings, sampleFlops } from './lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(here, '../..'));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const keys = opt('spots', 'BB|SB|0,BTN|BB|1').split(',');
const K = +opt('flops', 4), shortMs = +opt('short', 90000), longMs = +opt('long', 300000), W = +opt('workers', 7);
const all = enumerateEndings(loadBin(6, 'data/preflop-6.bin'));
const endings = keys.map(k => all.find(e => e.key === k));
const flops = sampleFlops(K, 0.5);
const tasks = [];
for (const ms of [longMs, shortMs]) for (const e of endings) flops.forEach((f, fi) => tasks.push({
  id: tasks.length, spot: e.key, fi, ms, board: f, pot: e.pot, stack: e.stack, oop: Array.from(e.ranges.oop), ip: Array.from(e.ranges.ip), depthLimited: true, maxMem: 1.5e9, nRun: 40,
}));
const res = []; let next = 0, run = 0;
await new Promise(done => {
  for (let i = 0; i < W; i++) {
    const w = new Worker(path.join(here, 'worker.js')); run++;
    const feed = () => { if (next >= tasks.length) { w.terminate(); if (--run === 0) done(); } else w.postMessage(tasks[next++]); };
    w.on('message', r => { if (r.error) console.error(r.error); else res.push({ ...tasks[r.id], r }); feed(); });
    feed();
  }
});
const ratio = r => { const t = role => { let s = 0, e = 0; for (let c = 0; c < 169; c++) { s += r.roles[role].share[c]; e += r.roles[role].eqs[c]; } return s / e; }; const ip = t('ip'), oop = t('oop'); return { ip, oop, ratio: ip / oop }; };
for (const e of endings) for (let fi = 0; fi < flops.length; fi++) {
  const a = res.find(x => x.spot === e.key && x.fi === fi && x.ms === shortMs), b = res.find(x => x.spot === e.key && x.fi === fi && x.ms === longMs);
  if (!a || !b) continue;
  const ra = ratio(a.r), rb = ratio(b.r);
  console.log(JSON.stringify({ spot: e.key, flop: flops[fi].join(','), shortIters: a.r.iters, longIters: b.r.iters, shortRatio: +ra.ratio.toFixed(4), longRatio: +rb.ratio.toFixed(4), relDiffPct: +(100 * (ra.ratio / rb.ratio - 1)).toFixed(1), shortIPOOP: [ra.ip, ra.oop].map(x => +x.toFixed(3)), longIPOOP: [rb.ip, rb.oop].map(x => +x.toFixed(3)) }));
}
