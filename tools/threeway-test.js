// Three-player river solver checks: node tools/threeway-test.js [--table] [--quick]
//  1. chip conservation at every terminal (payoffs sum to 0), ties included;
//  2. the vectorised CFR terminals equal a brute-force triple loop;
//  3. after a solve, nut combos never fold (< 1%) at any node they reach;
//  4. degenerate spot (seat 2 always folds, one dead combo) reproduces the
//     heads-up river solver (EVs, root mixes) within 1% pot;
//  5. determinism (same inputs, same output, bit for bit);
//  6. lock-two best-response gain table (VAL-3WAY-002): --table.
import { chen } from '../js/cards.js';
import { createSolver, comboCards, comboIndex, NUM_COMBOS } from '../js/postflop/solver.js';
import { createSolver3 } from '../js/postflop/solver3.js';

const QUICK = process.argv.includes('--quick');
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); if (!ok) failures++; };
const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
const ms = () => performance.now();

// Combos ranked by a simple strength proxy; [lo, hi) fractions of all 1326.
function band(lo, hi, exclude = []) {
  const sc = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = comboCards(i);
    sc.push([chen([a, b]) + ((a >> 2) + (b >> 2)) / 100, i]);
  }
  sc.sort((x, y) => y[0] - x[0]);
  const w = new Float32Array(NUM_COMBOS), bad = new Set(exclude);
  for (let k = Math.round(lo * NUM_COMBOS); k < Math.round(hi * NUM_COMBOS); k++) {
    const [a, b] = comboCards(sc[k][1]);
    if (!bad.has(a) && !bad.has(b)) w[sc[k][1]] = 1;
  }
  return w;
}
let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const rand = (n, lo = 0.2) => { const w = new Float32Array(NUM_COMBOS); for (let i = 0; i < NUM_COMBOS; i++) if (rng() < n) w[i] = lo + (1 - lo) * rng(); return w; };

// ---- 1 + 2: conservation and vectorised-vs-brute terminals (small ranges)
{
  const s = createSolver3({ board: C('Qh8d5c4s2h'), pot: 10, stack: 40, ranges: [rand(0.04), rand(0.04), rand(0.04)], sizes: { allin: true } });
  const T = s.terminals();
  let worst = 0;
  for (const t of T) {
    for (let k = 0; k < 400; k++) {
      const sc = [0, 1, 2].map(() => Math.floor(rng() * 4)); // few values: many ties
      const u = s.payoffs(t, sc);
      worst = Math.max(worst, Math.abs(u[0] + u[1] + u[2]));
    }
  }
  check(worst < 1e-9, `chips conserved at all ${T.length} terminals (max |sum payoffs| = ${worst.toExponential(1)}, ties included)`);
  const { L, score7, triples } = s.__test;
  const Tr = triples();
  let maxErr = 0, nBad = 0;
  for (const t of T) {
    const reach = [0, 1, 2].map(p => Float64Array.from({ length: L[p].n }, () => rng()));
    for (let p = 0; p < 3; p++) {
      const got = s.__test.termValues(p, t, reach);
      const want = new Float64Array(L[p].n);
      const q = (p + 1) % 3, r = (p + 2) % 3;
      for (let u = 0; u < Tr.length; u += 3) {
        const ij = [Tr[u], Tr[u + 1], Tr[u + 2]];
        const sc = [score7[0][ij[0]], score7[1][ij[1]], score7[2][ij[2]]];
        want[ij[p]] += reach[q][ij[q]] * reach[r][ij[r]] * s.payoffs(t, sc)[p];
      }
      for (let h = 0; h < want.length; h++) { const e = Math.abs(got[h] - want[h]); if (e > maxErr) maxErr = e; if (e > 1e-7 * (1 + Math.abs(want[h]))) nBad++; }
    }
  }
  check(nBad === 0, `vectorised terminals equal the brute-force triple loop on ${T.length} terminals x 3 players (max abs err ${maxErr.toExponential(1)})`);
}

// ---- 3: nuts never fold; also timing for one realistic desktop spot
const SPOTS = [
  { name: 'A Qh8d5c4s2h  wide/mid/tight', board: 'Qh8d5c4s2h', pot: 10, stack: 40, r: [[0, 0.1], [0.05, 0.15], [0.02, 0.1]],
    add: [['7s6s', '7s6h'], ['7h6d', '7d6c'], ['7c6s']] }, // 76 = the nut straight here,
  { name: 'B Ks9d4c3h2s  mid/mid/mid', board: 'Ks9d4c3h2s', pot: 12, stack: 36, r: [[0.02, 0.12], [0.04, 0.14], [0.06, 0.16]] },
  { name: 'C Jh9h6d2c8h  wide/wide/tight', board: 'Jh9h6d2c8h', pot: 8, stack: 30, r: [[0, 0.11], [0.03, 0.13], [0.01, 0.07]] },
];
const mk = (spot, extra = {}) => createSolver3({
  board: C(spot.board), pot: spot.pot, stack: spot.stack,
  ranges: spot.r.map(([a, b], p) => {
    const w = band(a, b);
    for (const h of (spot.add && spot.add[p]) || []) w[comboIndex(...C(h))] = 1;
    return w;
  }), ...extra,
});
const nBudget = QUICK ? 60 : 200;
{
  const spot = SPOTS[0];
  const t0 = ms();
  const s = mk(spot);
  s.step(nBudget);
  const wall = ms() - t0;
  let worst = 0, where = '', checked = 0;
  const { L } = s.__test;
  // Walk the tree carrying every player's reach; only nodes both opponents
  // reach with >= 1% of their starting mass count (unreached lines have no
  // incentive, so their strategy is arbitrary), and only combos the player
  // reaches there with >= 1% of their weight.
  const gmax = Math.max(...[0, 1, 2].map(p => Math.max(...L[p].score)));
  const mass0 = [0, 1, 2].map(p => L[p].w.reduce((x, y) => x + y, 0));
  const walkAll = (node, path, reach) => {
    if (node.t !== 0) return;
    const p = node.player, st = s.strategy(path, p);
    const fi = node.actions.findIndex(a => a.type === 'fold');
    const mass = reach.map(r => r.reduce((x, y) => x + y, 0));
    const live = [0, 1, 2].every(q => q === p || mass[q] >= 0.01 * mass0[q]);
    if (fi >= 0 && live) {
      for (let h = 0; h < st.n; h++) {
        if (L[p].score[h] < gmax || reach[p][h] < 0.01 * L[p].w[h]) continue; // only the nuts (best 7-card hand any range holds)
        checked++;
        const f = st.probs[fi * st.n + h];
        if (f > worst) { worst = f; where = `seat ${p} combo ${h} path [${path}]`; }
      }
    }
    node.kids.forEach((k, i) => {
      const r2 = reach.slice();
      r2[p] = Float64Array.from(reach[p], (v, h) => v * st.probs[i * st.n + h]);
      walkAll(k, path.concat(i), r2);
    });
  };
  walkAll(s.root, [], [0, 1, 2].map(p => Float64Array.from(L[p].w)));

  check(checked > 0 && worst < 0.01, `nuts never fold: nut combos at ${checked} (combo, facing-bet node) pairs fold at most ${(worst * 100).toFixed(3)}% ${where} (${nBudget} iterations)`);
  console.log(`  info ${spot.name}: ${s.nodeCount} nodes, ranges ${[0, 1, 2].map(p => s.combos(p).length).join('/')} combos, ${s.iterations} iterations in ${(wall / 1000).toFixed(1)} s (${(wall / s.iterations).toFixed(0)} ms/iteration)`);
}

// ---- 4: degenerate heads-up
{
  const board = C('Qh8d5c4s2h'), dead = [C('Ac')[0], C('Ad')[0]];
  const w0 = band(0, 0.08, dead), w1 = band(0.03, 0.12, dead);
  const wDead = new Float32Array(NUM_COMBOS); wDead[comboIndex(...dead)] = 1;
  const sizes = { bet: [0.5, 1], raise: [2.5], allin: false, maxBets: 2, allinThreshold: 0.67 };
  const pot = 10, stack = 40, iters = QUICK ? 120 : 400;
  const s3 = createSolver3({ board, pot, stack, ranges: [w0, w1, wDead], folds: [false, false, true], sizes });
  s3.step(iters);
  const hu = createSolver({ board, pot, stack, ranges: [w0, w1], sizes });
  hu.step(iters);
  const gain = s3.bestResponseGain();
  const ev3 = gain.avg, evh = hu.evs();
  // 3-way payoff = HU payoff + pot/6 for the two live players
  const d0 = Math.abs(ev3[0] - pot / 6 - evh[0]) / pot * 100, d1 = Math.abs(ev3[1] - pot / 6 - evh[1]) / pot * 100;
  const mix3 = s3.rootMix(0), mixH = hu.actionsAt([]);
  console.log(`  info degenerate: HU exploitability ${hu.exploitability().toFixed(3)}% pot, 3-way BR gain ${gain.gain.slice(0, 2).map(x => x.toFixed(3)).join('/')}% pot; EV 3-way ${ev3.slice(0, 2).map(x => (x - pot / 6).toFixed(3))} vs HU ${evh.map(x => x.toFixed(3))}`);
  check(d0 < 1 && d1 < 1, `degenerate (seat 2 always folds) EVs match the heads-up solver within 1% pot (diff ${d0.toFixed(3)} / ${d1.toFixed(3)}% pot)`);
  const mixHu = hu.strategyTable([]);
  let hf = new Float64Array(mixH.length), tw = 0;
  for (let h = 0; h < NUM_COMBOS; h++) {
    if (!(w0[h] > 0) || Number.isNaN(mixHu.probs[h * mixH.length])) continue;
    tw += w0[h]; for (let a = 0; a < mixH.length; a++) hf[a] += w0[h] * mixHu.probs[h * mixH.length + a];
  }
  const dm = Math.max(...mix3.map((m, a) => Math.abs(m.freq - hf[a] / tw)));
  console.log(`  info degenerate root mix seat 0: 3-way ${mix3.map(m => `${m.type} ${(m.freq * 100).toFixed(1)}%`).join(' ')} | HU ${mixH.map((a, i) => `${a.type} ${(hf[i] / tw * 100).toFixed(1)}%`).join(' ')}`);
  check(dm < 0.05, `degenerate root mix within 5 points of the heads-up solver (max diff ${(dm * 100).toFixed(1)} points)`);
  globalThis.__degenerate = { s3, hu, w0, w1, pot };
}

// ---- 5: determinism
{
  const a = mk(SPOTS[1]), b = mk(SPOTS[1]);
  a.step(20); b.step(20);
  const same = [0, 1, 2].every(p => JSON.stringify(a.rootMix(p)) === JSON.stringify(b.rootMix(p))) &&
    JSON.stringify(Array.from(a.strategy([], 0).probs)) === JSON.stringify(Array.from(b.strategy([], 0).probs));
  check(same, 'determinism: same inputs give identical strategies (20 iterations, two solvers)');
}

// ---- 6: lock-two best-response gain table
if (process.argv.includes('--table') || process.argv.includes('--hu-br')) {
  // degenerate cross-check: independent best response vs HU exploitability
  const { s3, hu, pot } = globalThis.__degenerate;
  const g = s3.bestResponseGain();
  const expl = hu.exploitability();
  // HU exploitability = mean of the two best-response gains (% pot)
  const br3 = (g.gain[0] + g.gain[1]) / 2;
  check(Math.abs(br3 - expl) < 0.1, `best response matches heads-up exploitability on the degenerate spot: 3-way routine ${br3.toFixed(3)}% vs solver.js ${expl.toFixed(3)}% pot (diff ${Math.abs(br3 - expl).toFixed(3)})`);
}
if (process.argv.includes('--table')) {
  const budgets = QUICK ? [10, 40, 160] : [25, 100, 400];
  console.log('\nlock-two best-response gain, % of pot (BR of one player vs the other two fixed at their average)');
  console.log('spot                              budget  iters  wall s   ms/it   gain s0   gain s1   gain s2');
  const all = [];
  for (const spot of SPOTS) {
    const s = mk(spot);
    let solveMs = 0, done = 0;
    const rows = [];
    for (const b of budgets) {
      const t0 = ms();
      s.step(b - done); done = b;
      solveMs += ms() - t0;
      const wall = solveMs;
      const g = s.bestResponseGain().gain;
      rows.push({ b, g });
      console.log(`${spot.name.padEnd(34)}${String(b).padStart(5)}x ${String(s.iterations).padStart(6)} ${(wall / 1000).toFixed(1).padStart(7)} ${(wall / s.iterations).toFixed(0).padStart(7)} ${g.map(x => x.toFixed(3).padStart(9)).join(' ')}`);
    }
    all.push({ spot, rows });
  }
  for (const { spot, rows } of all) {
    const last = rows[rows.length - 1].g, first = rows[0].g;
    const ok = last.every(x => x <= 1);
    const rising = last.map((x, p) => x > first[p] + 0.05);
    console.log(`  ${ok ? 'PASS' : 'NON-CONVERGENCE'} ${spot.name}: largest budget gains ${last.map(x => x.toFixed(2)).join('/')}% pot${rising.some(Boolean) ? ' (RISING with budget for seat ' + rising.map((r, i) => r ? i : '').join('') + ')' : ''}`);
  }
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
