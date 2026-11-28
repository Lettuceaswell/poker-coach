// Calibrated preflop: measure postflop realization from solved heads-up spots, re-solve preflop with it, iterate.
//
//   node tools/calib/run.js --players 6 --rounds N --flops K --minutes M --workers W --out data/calib [--tiny]
//
//   --minutes M     MCCFR minutes for each re-solved preflop bin (per round)
//   --flops K       weighted flop subset size per spot (systematic sample of the 1755 isomorphic flops)
//   --spots S       how many of the most frequent heads-up endings to solve (default 14)
//   --flop-ms T     CFR time per (spot, flop) postflop solve (default 15000)
//   --workers W     worker_threads for the postflop solves
//   --hu-minutes H  heads-up MCCFR minutes for the exploitability gauge (default 1)
//   --tol X         stop early when round >= 2 and drift < X (default 0.004)
//   --start FILE    starting solution (default data/preflop-<players>.bin, read only)
//   --damp D        damp each round's table toward the previous round's: r = D*new + (1-D)*old per spot/agg, ip/oop,
//                   class with n>0 in both (default 1 = no damping, the old behavior)
//   --min-iters N   spots whose flops average fewer than N CFR iterations fall back to flat factors and are logged (default 0 = off)
//   --depth full    full turn+river trees (depthLimited:false); default is flop+turn betting with river by equity
// Outputs in --out: realization-rN.json, preflop-<n>-rN.bin/.vis/.log, gauges.jsonl, run-rN.log.
// Never writes data/preflop-*.bin.
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadBin, enumerateEndings, gauges, drift, sampleFlops, COMBOS } from './lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const tiny = flag('tiny');
const P = {
  players: +opt('players', 6), rounds: +opt('rounds', tiny ? 2 : 3), flops: +opt('flops', tiny ? 3 : 40),
  minutes: +opt('minutes', tiny ? 0.5 : 120), workers: +opt('workers', tiny ? 4 : 8), spots: +opt('spots', tiny ? 4 : 14),
  flopMs: +opt('flop-ms', tiny ? 4000 : 15000), huMin: +opt('hu-minutes', tiny ? 0.25 : 1), tol: +opt('tol', 0.004), damp: +opt('damp', 1), minIters: +opt('min-iters', 0),
  out: opt('out', 'data/calib'), depthFull: opt('depth', '') === 'full',
};
P.start = opt('start', `data/preflop-${P.players}.bin`);
if (path.resolve(root, P.out) === path.resolve(root, 'data')) throw new Error('--out must not be data/');
process.chdir(root);
fs.mkdirSync(P.out, { recursive: true });
const T0 = Date.now();
const say = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(0)}s] ` + a.join(' '); console.log(s); fs.appendFileSync(`${P.out}/run.log`, s + '\n'); };
say('params', JSON.stringify(P));

function sh(cmd, args, env, outFile) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.writeFileSync(outFile, (r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}); see ${outFile}`);
  return r.stdout;
}

async function solvePostflop(endings, flops, round) {
  const tasks = [];
  endings.forEach((e, si) => flops.forEach((f, fi) => tasks.push({
    id: tasks.length, spot: e.key, board: f, pot: e.pot, stack: e.stack, oop: Array.from(e.ranges.oop), ip: Array.from(e.ranges.ip),
    ms: P.flopMs, depthLimited: !P.depthFull, maxMem: 1.5e9, nRun: 40,
  })));
  const results = []; let next = 0, running = 0, errors = 0;
  await new Promise(resolve => {
    const pool = [];
    const feed = w => {
      if (next >= tasks.length) { w.terminate(); if (--running === 0) resolve(); return; }
      w.postMessage(tasks[next++]);
    };
    for (let i = 0; i < Math.min(P.workers, tasks.length); i++) {
      const w = new Worker(path.join(here, 'worker.js'));
      running++;
      w.on('message', r => {
        if (r.error) { errors++; say('task error', r.spot, r.error.split('\n')[0]); } else results.push(r);
        if ((results.length + errors) % Math.max(1, Math.floor(tasks.length / 10)) === 0) say(`postflop ${results.length + errors}/${tasks.length}`);
        feed(w);
      });
      w.on('error', e => { say('worker crash', e.message); errors++; feed(w); });
      feed(w);
    }
  });
  return { results, errors, nTasks: tasks.length };
}

function buildTable(results, endings, round, prevTable) {
  const bySpot = {};
  for (const r of results) {
    const e = (bySpot[r.spot] ||= { ip: sums(), oop: sums(), flops: 0, iters: 0 });
    e.flops++; e.iters += r.iters;
    for (const role of ['ip', 'oop']) for (let c = 0; c < 169; c++) {
      e[role].share[c] += r.roles[role].share[c]; e[role].eqs[c] += r.roles[role].eqs[c]; e[role].wt[c] += r.roles[role].wt[c];
    }
  }
  function sums() { return { share: new Float64Array(169), eqs: new Float64Array(169), wt: new Float64Array(169) }; }
  const fin = s => {
    const r = [], n = [];
    for (let c = 0; c < 169; c++) {
      if (s.eqs[c] > 0 && s.wt[c] > 0) { r.push(+Math.min(1.6, Math.max(0.5, s.share[c] / s.eqs[c])).toFixed(4)); n.push(+s.wt[c].toFixed(3)); } else { r.push(1); n.push(0); }
    }
    return { r, n };
  };
  const table = { version: 1, round, players: P.players, flops: P.flops, flopMs: P.flopMs, depth: P.depthFull ? 'full' : 'flop+turn betting, river by equity', spots: {}, agg: {} };
  const aggS = {};
  const fq = Object.fromEntries(endings.map(e => [e.key, e]));
  for (const [key, e] of Object.entries(bySpot)) {
    const mi = Math.round(e.iters / e.flops);
    say(`round ${round} spot ${key} meanIters ${mi} over ${e.flops} flops`);
    if (mi < P.minIters) { say(`round ${round} spot ${key} dropped: meanIters ${mi} < --min-iters ${P.minIters}, flat factors`); continue; }
    table.spots[key] = { ip: fin(e.ip), oop: fin(e.oop), flops: e.flops, freq: fq[key].freq, pot: fq[key].pot, meanIters: Math.round(e.iters / e.flops) };
    const lvl = key.split('|')[2];
    const a = (aggS[lvl] ||= { ip: sums(), oop: sums() });
    // aggregate across spots of the same raise level, each spot weighted by its frequency
    for (const role of ['ip', 'oop']) for (let c = 0; c < 169; c++) {
      const f = fq[key].freq;
      a[role].share[c] += f * e[role].share[c] / (e[role].eqs[c] || 1) * e[role].eqs[c];
      a[role].eqs[c] += f * e[role].eqs[c]; a[role].wt[c] += e[role].wt[c];
    }
  }
  for (const [lvl, a] of Object.entries(aggS)) table.agg[lvl] = { ip: fin(a.ip), oop: fin(a.oop) };
  if (P.damp < 1 && prevTable) {
    const mix = (nw, old) => { for (const role of ['ip', 'oop']) for (let c = 0; c < 169; c++) if (nw[role].n[c] > 0 && old[role].n[c] > 0) nw[role].r[c] = +(P.damp * nw[role].r[c] + (1 - P.damp) * old[role].r[c]).toFixed(4); };
    for (const grp of ['spots', 'agg']) for (const [k, v] of Object.entries(table[grp])) if (prevTable[grp][k]) mix(v, prevTable[grp][k]);
    table.damp = P.damp;
  }
  return table;
}

const meanR = role => { let s = 0, w = 0; for (let c = 0; c < 169; c++) { s += role.r[c] * role.n[c]; w += role.n[c]; } return w ? +(s / w).toFixed(3) : null; };

// round 0 baseline: the starting solution, plus a table-free heads-up solve for the exploitability gauge
function huExploit(tag, table) {
  const env = { SOLVE_OUT: P.out, SOLVE_TAG: tag, ...(table ? { SOLVE_TABLE: table } : {}) };
  for (const ext of ['log']) fs.rmSync(`${P.out}/preflop-2${tag}.${ext}`, { force: true });
  const out = sh('node', ['tools/solve.js', '2', String(P.huMin), '7'], env, `${P.out}/solve-2${tag}.out`);
  const m = [...out.matchAll(/exploitability (-?[\d.]+) mbb\/hand/g)].pop();
  return m ? +m[1] : null;
}
const gaugeLine = (round, S, prev, extra) => {
  const g = gauges(S);
  const r = x => +(100 * x).toFixed(2);
  return JSON.stringify({
    round, t: new Date().toISOString(), players: P.players,
    rfi: Object.fromEntries(Object.entries(g.rfi).map(([k, v]) => [k, r(v)])), sbLimp: r(g.sbLimp), sbRaise: r(g.sbRaise), bbDefVsBtn: r(g.bbDefVsBtn),
    drift: prev ? +drift(S, prev).toFixed(5) : null, ...extra,
  });
};

let prev = loadBin(P.players, P.start);
{
  const hu0 = huExploit('-hu-r0', null);
  const l = gaugeLine(0, prev, null, { huExploitMbb: hu0, note: 'baseline: starting solution, flat factors', source: P.start });
  fs.appendFileSync(`${P.out}/gauges.jsonl`, l + '\n'); say('gauge', l);
}
let first = null, spotKeys = null, prevTable = null;
for (let round = 1; round <= P.rounds; round++) {
  const tr = Date.now();
  const all = enumerateEndings(prev).filter(e => e.stack >= 0.5 * e.pot && e.pot < 80);
  // Round 1 picks the spots, balanced by raise level (SRP, limp, 3-bet, 4-bet); later rounds re-read the same
  // endings from the newest solution so the table keeps the same keys and only the ranges move.
  if (!spotKeys) {
    const groups = [1, 0, 2, 3].map(l => all.filter(e => e.raises === l));
    spotKeys = [];
    for (let i = 0; spotKeys.length < P.spots && i < 40; i++) for (const g of groups) if (g[i] && spotKeys.length < P.spots) spotKeys.push(g[i].key);
  }
  const endings = spotKeys.map(k => all.find(e => e.key === k)).filter(Boolean);
  say(`round ${round}: ${endings.length} spots`, endings.map(e => `${e.key}(${(e.freq * 100).toFixed(2)}%)`).join(' '));
  const flops = sampleFlops(P.flops);
  say(`round ${round}: ${flops.length} flops`, JSON.stringify(flops));
  const tp = Date.now();
  const { results, errors, nTasks } = await solvePostflop(endings, flops, round);
  const postflopMin = (Date.now() - tp) / 60000;
  if (!results.length) throw new Error('no postflop result');
  const table = buildTable(results, endings, round, prevTable);
  prevTable = table;
  const tfile = `${P.out}/realization-r${round}.json`;
  fs.writeFileSync(tfile, JSON.stringify(table));
  say(`wrote ${tfile}; postflop ${nTasks} solves (${errors} errors) in ${postflopMin.toFixed(2)} min at ${P.workers} workers`);
  const tag = `-r${round}`;
  for (const ext of ['log']) fs.rmSync(`${P.out}/preflop-${P.players}${tag}.${ext}`, { force: true });
  const tm = Date.now();
  sh('node', ['tools/solve.js', String(P.players), String(P.minutes), String(11 + round)], { SOLVE_OUT: P.out, SOLVE_TAG: tag, SOLVE_TABLE: tfile }, `${P.out}/solve-${P.players}${tag}.out`);
  const mccfrMin = (Date.now() - tm) / 60000;
  const S = loadBin(P.players, `${P.out}/preflop-${P.players}${tag}.bin`);
  const hu = huExploit(`-hu${tag}`, tfile);
  const l = gaugeLine(round, S, prev, {
    huExploitMbb: hu, drift0: first ? +drift(S, first).toFixed(5) : null,
    meanR: { ip1: table.spots['BTN|BB|1'] ? meanR(table.spots['BTN|BB|1'].ip) : null, oop1: table.spots['BTN|BB|1'] ? meanR(table.spots['BTN|BB|1'].oop) : null },
    spots: endings.length, flops: flops.length, flopMs: P.flopMs, workers: P.workers,
    minPostflop: +postflopMin.toFixed(2), minMccfr: +mccfrMin.toFixed(2), minRound: +((Date.now() - tr) / 60000).toFixed(2),
  });
  fs.appendFileSync(`${P.out}/gauges.jsonl`, l + '\n'); say('gauge', l);
  const d = drift(S, prev);
  if (!first) first = prev;
  prev = S;
  if (round >= 2 && d < P.tol) { say(`fixed point: drift ${d.toFixed(5)} < ${P.tol}`); break; }
}
say('done');
