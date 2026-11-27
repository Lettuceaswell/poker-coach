// Offline builder: solves heads-up SRP flop/turn/river spots with js/postflop/solver.js
// and stores hero hand + options + solver mix + EV (BB) in data/postflop-drills.json.
// Ranges are approximations of BTN open (IP) vs BB call (OOP): Chen-score cutoffs from js/cards.js,
// thinned to the stronger part of the range on later streets. Usage: node tools/build-postflop-drills.js [secsPerSolve]
import fs from 'node:fs';
import { createSolver, comboCards, NUM_COMBOS } from '../js/postflop/solver.js';
import { chen } from '../js/cards.js';
import { scoreHands } from '../js/postflop/eval7.js';

const SECS = +(process.argv[2] || 3);
let seed = 20261127;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const SP = ['s', 'h', 'd', 'c'], RK = '23456789TJQKA';
const cs = c => RK[c >> 2] + SP[c & 3];

function board(n) { const d = [...Array(52).keys()]; const b = []; while (b.length < n) b.push(d.splice(Math.floor(rnd() * d.length), 1)[0]); return b; }
function ranges(bd, keep) {
  const out = [new Float32Array(NUM_COMBOS), new Float32Array(NUM_COMBOS)];
  const cut = [3.5, 6]; // BB defends wide, BTN opens ~45%
  const sc = new Uint32Array(1);
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = comboCards(i);
    if (bd.includes(a) || bd.includes(b)) continue;
    for (let p = 0; p < 2; p++) if (chen([a, b]) >= cut[p]) out[p][i] = 1;
  }
  if (keep < 1 && bd.length >= 4) { // later streets: keep the stronger part
    for (let p = 0; p < 2; p++) {
      const idx = []; for (let i = 0; i < NUM_COMBOS; i++) if (out[p][i]) {
        const [a, b] = comboCards(i); const o = new Uint32Array(1);
        scoreHands(bd, [a], [b], 1, o); idx.push([i, o[0]]);
      }
      idx.sort((x, y) => y[1] - x[1]);
      for (const [i] of idx.slice(Math.floor(idx.length * keep))) out[p][i] = 0;
    }
  }
  return out;
}
const lab = a => a.type === 'check' ? 'Check' : a.type === 'fold' ? 'Fold' : a.type === 'call' ? 'Call' : a.type === 'allin' ? 'All-in' : a.type === 'raise' ? `Raise to ${+a.amount.toFixed(1)}` : `Bet ${+a.amount.toFixed(1)}`;

const spots = [];
function solve(street, n, pot, stack, keep, sizes, mult = 1) {
  const bd = board(n), r = ranges(bd, keep);
  const s = createSolver({ board: bd, pot, stack, ranges: r, sizes });
  const t0 = Date.now(); while (Date.now() - t0 < SECS * 1000 * mult) s.step(10);
  const ex = s.exploitability();
  if (ex > 3) { console.log('skip', street, ex.toFixed(1)); return; } // unconverged: not trustworthy
  // decision nodes: OOP root, and IP after OOP's first bet (if any)
  const nodes = [[[], 0]]; const acts = s.actionsAt([]);
  const bi = acts.findIndex(a => a.type === 'bet' || a.type === 'allin'); if (bi >= 0) nodes.push([[bi], 1]);
  nodes.push([[acts.findIndex(a => a.type === 'check')], 1]);
  for (const [path, player] of nodes) {
    if (path[0] < 0) continue;
    const A = s.actionsAt(path); if (!A || A.length < 2) continue;
    const rng = s.rangeAt(path, player);
    const cand = [];
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (rng[i] < 0.5) continue;
      const mix = s.strategyAt(path, i); const ev = s.actionValues(path, i);
      if (!mix || !ev) continue;
      const spread = Math.max(...ev) - Math.min(...ev), top = Math.max(...mix);
      cand.push({ i, mix, ev, score: spread * (1.3 - top) + rnd() * 0.05 });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand.slice(0, street === 'river' ? 2 : 1)) {
      const [x, y] = comboCards(c.i);
      spots.push({
        id: spots.length, street, board: bd.map(cs), pot, stack, hero: player === 0 ? 'OOP' : 'IP',
        facing: path.length && path[0] === bi ? +acts[bi].amount.toFixed(1) : 0,
        hand: [cs(x), cs(y)], opts: A.map(lab), mix: c.mix.map(v => +v.toFixed(3)), ev: c.ev.map(v => +v.toFixed(2)), exploit: +ex.toFixed(2),
      });
    }
  }
}
const small = { bet: [0.66], raise: [3], allin: true, maxBets: 3, allinThreshold: 0.67 };
for (let k = 0; k < 14; k++) solve('river', 5, 20 + Math.floor(rnd() * 20), 40 + Math.floor(rnd() * 30), 0.6);
for (let k = 0; k < 8; k++) solve('turn', 4, 11 + Math.floor(rnd() * 8), 60, 0.8, small, 3);
for (let k = 0; k < 6; k++) solve('flop', 3, 5.5, 97, 1, small, 10);
fs.writeFileSync(new URL('../data/postflop-drills.json', import.meta.url), JSON.stringify({ v: 1, note: 'approx SRP ranges (Chen cutoffs); EV in BB relative to folding now', spots }));
console.log(spots.length, 'spots', JSON.stringify(spots[0]));
