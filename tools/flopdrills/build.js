// Solve common flops per preflop line into drill spots (same schema as data/postflop-drills.json).
//   node tools/flopdrills/build.js --lines BTN-BB-SRP,CO-BB-SRP --flops 8 --workers 4 --secs 30 --out data/flopdrills
//   node tools/flopdrills/build.js --merge [--out data/flopdrills]   (merge solved spots into data/postflop-drills.json)
// Ranges are the solved preflop strategy along each line (tools/flopdrills/lines.js). Never writes data/preflop-*.bin.
// Flop solves are depth-limited (js/postflop/solver.js default); spots with exploitability > 3 are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { solveSpots } from './spots.js';
import { LINES } from './lines.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(ROOT, arg('out', 'data/flopdrills'));

function flopFor(lineIdx, k) { // deterministic distinct flops per (line, k)
  let seed = (20261127 + lineIdx * 7919 + k * 104729) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const d = [...Array(52).keys()], b = []; while (b.length < 3) b.push(d.splice(Math.floor(rnd() * d.length), 1)[0]);
  return { board: b, rnd };
}

if (!isMainThread) {
  const { jobs, secs } = workerData;
  for (const j of jobs) {
    const { board, rnd } = flopFor(j.li, j.k);
    const r = solveSpots({ lineName: j.line, board, street: 'flop', secs, rnd });
    parentPort.postMessage({ j, ...r });
  }
  parentPort.postMessage({ done: true });
} else if (process.argv.includes('--merge')) {
  const file = path.join(ROOT, 'data/postflop-drills.json');
  const main = JSON.parse(fs.readFileSync(file, 'utf8'));
  const solved = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => /^flops-.*\.json$/.test(f)).flatMap(f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')).spots) : [];
  const keep = main.spots.filter(s => !s.src);
  const spots = [...keep, ...solved.map(s => ({ ...s, src: 'flopdrills' }))].map((s, i) => ({ ...s, id: i }));
  // the first 'flop' spots from the main builder are replaced by solved ones only when this merge has any
  main.spots = spots; main.note = main.note.replace(/ \+ \d+ flop spots from data\/flopdrills/, '') + ` + ${solved.length} flop spots from data/flopdrills`;
  fs.writeFileSync(file, JSON.stringify(main));
  console.log(`merged ${solved.length} solved flop spots; ${spots.length} total spots`);
} else {
  const lines = arg('lines', 'BTN-BB-SRP,CO-BB-SRP,BTN-BB-3BP').split(',');
  const K = +arg('flops', 4), W = +arg('workers', 2), secs = +arg('secs', 30);
  for (const l of lines) if (!LINES[l]) { console.error('unknown line', l, 'known:', Object.keys(LINES).join(',')); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = []; for (let k = 0; k < K; k++) lines.forEach((line, i) => jobs.push({ line, li: Object.keys(LINES).indexOf(line), k }));
  const buckets = Array.from({ length: W }, () => []); jobs.forEach((j, i) => buckets[i % W].push(j));
  const spots = [], stats = []; let live = 0;
  const outFile = path.join(OUT, `flops-${arg('tag', 'run')}.json`);
  const save = () => fs.writeFileSync(outFile, JSON.stringify({ v: 1, kind: 'flopdrills', spots: spots.map((s, i) => ({ ...s, id: i })) }));
  const t0 = Date.now();
  for (const b of buckets) if (b.length) {
    live++;
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: b, secs }, argv: process.argv.slice(2) });
    w.on('message', m => {
      if (m.done) { if (--live === 0) { save(); console.log(`done: ${spots.length} spots, ${stats.length} flops solved, ${((Date.now() - t0) / 1000).toFixed(0)} s wall -> ${outFile}`); } return; }
      stats.push(m.secs);
      if (m.skipped) console.log(`skip ${m.j.line} #${m.j.k} exploit ${m.exploit.toFixed(2)}`);
      else { spots.push(...m.spots); console.log(`${m.j.line} #${m.j.k} ${m.spots[0]?.board.join('')} ${m.secs.toFixed(1)} s exploit ${m.exploit.toFixed(2)} -> ${m.spots.length} spots`); save(); }
    });
    w.on('error', e => { console.error(e); process.exit(1); });
  }
}
