// Postflop solver checks: node tools/postflop-test.js [--quick] [--full-flop]
// (--quick shortens the timing report; --full-flop adds a measured full flop
// solve with a coarse abstraction, ~400 MB and ~1 minute).
//
//  0. eval7 matches evalHand; O(n) terminals match an O(n^2) brute force
//     (fold, showdown, turn runout matrix, flop runout, sampled estimator).
//  a. Toy river: polarized bettor vs bluff-catcher hits the textbook
//     bluff share s/(1+2s) and call frequency 1/(1+s).
//  b. Random wide river: exploitability falls (monotone-ish) below 0.5% pot.
//  c. Zero-sum EVs, best responses >= EVs, no NaN anywhere.
//  d. Card removal: combos holding a board / dealt card have zero weight and
//     no strategy everywhere.
//  i. Suit isomorphism matches the brute-force solve (turn), and keeps the
//     depth-limited flop exactly symmetric.
//  w. Worker handler: updates, stop, done.
//  e. Timing / memory report: river, turn, depth-limited flop, ~40% ranges.
//     Targets are reported as MET / MISS; they do not fail the run.

import { evalHand, chen } from '../js/cards.js';
import { evalCards } from '../js/postflop/eval7.js';
import {
  createSolver, estimateSolve, comboIndex, comboCards, NUM_COMBOS, __test,
} from '../js/postflop/solver.js';
import { createWorkerHandler } from '../js/postflop/worker.js';

const QUICK = process.argv.includes('--quick');
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) failures++;
};
const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
let seed = 987654321;
const rng = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

// Suit-symmetric "top x%" range by Chen score (whole score classes).
function topRange(frac) {
  const sc = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const [a, b] = comboCards(i);
    sc.push([chen([a, b]) + ((a >> 2) + (b >> 2)) / 100, i]);
  }
  sc.sort((x, y) => y[0] - x[0]);
  const cut = sc[Math.min(Math.round(frac * NUM_COMBOS), NUM_COMBOS - 1)][0];
  const w = new Float32Array(NUM_COMBOS);
  for (const [s, i] of sc) if (s >= cut) w[i] = 1;
  return w;
}
function randomRange(density) {
  const w = new Float32Array(NUM_COMBOS);
  for (let i = 0; i < NUM_COMBOS; i++) if (rng() < density) w[i] = 0.2 + 0.8 * rng();
  return w;
}
const rangeOf = (combos, weight = 1) => {
  const w = new Float32Array(NUM_COMBOS);
  for (const [a, b] of combos) w[comboIndex(a, b)] = weight;
  return w;
};
const pairsOf = (cardsA, cardsB) => {
  const out = [];
  for (const a of cardsA) for (const b of cardsB) if (a !== b && !out.some(([x, y]) => (x === b && y === a))) out.push([a, b]);
  return out;
};
const rankCards = r => [0, 1, 2, 3].map(s => r * 4 + s);
const sum = (w, combos) => combos.reduce((t, [a, b]) => t + w[comboIndex(a, b)], 0);
const fmtMs = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);
const mb = b => `${(b / 1e6).toFixed(1)} MB`;

// ------------------------------------------------------------------ 0 ---
console.log('\n0. Evaluator and terminal cross-checks');
{
  let bad = 0;
  for (let k = 0; k < 100000; k++) {
    const d = [];
    while (d.length < 7) { const c = (rng() * 52) | 0; if (!d.includes(c)) d.push(c); }
    const n = 5 + (k % 3);
    if (evalHand(d.slice(0, n)) !== evalCards(d, n)) bad++;
  }
  check(bad === 0, `eval7 == evalHand on 100k random 5-7 card hands (${bad} mismatches)`);

  // Brute force: value of combo (local h of player p) vs opponent reach.
  const brute = (s, kind, p, reach, amt, folder) => {
    const ctx = s._ctx, L = ctx.lists[p], O = ctx.lists[1 - p], board = ctx.board;
    const deck = [];
    for (let c = 0; c < 52; c++) if (!board.includes(c)) deck.push(c);
    const runouts = [];
    const need = 5 - board.length;
    if (need === 0) runouts.push([]);
    if (need === 1) for (const c of deck) runouts.push([c]);
    if (need === 2) for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) runouts.push([deck[i], deck[j]]);
    const out = new Float64Array(L.n);
    for (let h = 0; h < L.n; h++) {
      const hc = [L.c1[h], L.c2[h]];
      let v = 0;
      for (let j = 0; j < O.n; j++) {
        const oc = [O.c1[j], O.c2[j]];
        if (hc.includes(oc[0]) || hc.includes(oc[1])) continue;
        if (kind === 'fold') { v += reach[j] * (folder === p ? -amt : amt); continue; }
        let tot = 0, cnt = 0;
        for (const r of runouts) {
          if (r.some(c => hc.includes(c) || oc.includes(c))) continue;
          const sh = evalHand([...hc, ...board, ...r]), so = evalHand([...oc, ...board, ...r]);
          tot += Math.sign(sh - so); cnt++;
        }
        v += reach[j] * amt * tot / cnt;
      }
      out[h] = v;
    }
    return out;
  };
  const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
  const randReach = n => Float64Array.from({ length: n }, () => (rng() < 0.2 ? 0 : rng()));
  const cases = [
    ['river', C('Ks9h6d3c2s'), 0.12, ['fold', 'show']],
    ['turn', C('Ks9h6d3c'), 0.06, ['eq', 'sampled']],
    ['flop', C('Ks9h6d'), 0.02, ['eq', 'sampled']],
  ];
  for (const [name, board, dens, kinds] of cases) {
    const s = createSolver({ board, pot: 10, stack: 50, ranges: [randomRange(dens), randomRange(dens)] });
    for (let p = 0; p < 2; p++) {
      const reach = randReach(s.combos[1 - p]);
      const amt = 3.5;
      const cache = {};
      for (const kind of kinds) {
        const got = __test.terminalValues(s, kind, p, reach, amt, 1);
        const bk = kind === 'sampled' ? 'eq' : kind;
        const want = cache[bk] || (cache[bk] = brute(s, bk, p, reach, amt, 1));
        const d = maxDiff(got, want);
        check(d < 1e-6 * (1 + Math.max(...want.map(Math.abs))), `${name} ${kind} p${p}: O(n) vs brute force max diff ${d.toExponential(2)} (${s.combos[p]}x${s.combos[1 - p]} combos)`);
      }
    }
  }
}

// ------------------------------------------------------------------ a ---
console.log('\na. Toy river: polarized bettor vs bluff-catcher');
{
  // Board Ks 9h 6d 3c 2s. OOP: KK (set, the nuts vs IP) + JT (air).
  // IP: QQ (beats air, loses to KK). Stack = s * pot, so the only bet is
  // all-in; raises off. No card overlaps between the classes.
  const board = C('Ks9h6d3c2s');
  const KK = pairsOf(rankCards(11), rankCards(11)).filter(([a, b]) => !board.includes(a) && !board.includes(b));
  const JT = pairsOf(rankCards(9), rankCards(8));
  const QQ = pairsOf(rankCards(10), rankCards(10));
  for (const s of [1, 0.5]) {
    const oop = rangeOf(KK, 1);
    for (const [a, b] of JT) oop[comboIndex(a, b)] = 0.25;
    const solver = createSolver({
      board, pot: 10, stack: 10 * s, ranges: [oop, rangeOf(QQ, 1)],
      sizes: { bet: [], raise: [], allin: true },
    });
    for (let i = 0; i < 4000 && (i % 100 || solver.exploitability() > 0.02); i++) solver.step(1);
    const root = solver.actionsAt([]);
    const bet = root.findIndex(a => a.type === 'allin');
    const call = solver.actionsAt([bet]).findIndex(a => a.type === 'call');
    const r0 = solver.rangeAt([bet], 0);
    const bluff = sum(r0, JT) / (sum(r0, JT) + sum(r0, KK));
    const r1 = solver.rangeAt([bet], 1), r1c = solver.rangeAt([bet, call], 1);
    const callFreq = sum(r1c, QQ) / sum(r1, QQ);
    const wantBluff = s / (1 + 2 * s), wantCall = 1 / (1 + s);
    console.log(`     s=${s}: iters ${solver.iterations}, exploit ${solver.exploitability().toFixed(4)}% pot`);
    check(Math.abs(bluff - wantBluff) < 0.02, `s=${s}: bluff share of betting range ${bluff.toFixed(4)} (theory ${wantBluff.toFixed(4)})`);
    check(Math.abs(callFreq - wantCall) < 0.02, `s=${s}: bluff-catcher call frequency ${callFreq.toFixed(4)} (theory ${wantCall.toFixed(4)})`);
    check(sum(r0, KK) / KK.length > 0.99, `s=${s}: value hands always bet (${(sum(r0, KK) / KK.length).toFixed(4)})`);
  }
}

// ------------------------------------------------------------- b, c, d ---
console.log('\nb/c/d. Random wide river');
{
  const board = C('Qh8d5c4s2h');
  const solver = createSolver({ board, pot: 12, stack: 60, ranges: [randomRange(0.6), randomRange(0.6)] });
  console.log(`     combos ${solver.combos.join(' vs ')}, ${solver.stats.actNodes} decision nodes, ${mb(solver.memoryBytes)}`);
  const trace = [];
  let monotone = true;
  for (let i = 0; i < 2000; i++) {
    solver.step(1);
    if (solver.iterations % 25 === 0) {
      const e = solver.exploitability();
      if (trace.length && e > trace[trace.length - 1][1] * 1.15 + 0.01) monotone = false;
      trace.push([solver.iterations, e]);
      if (e < 0.25) break;
    }
  }
  console.log('     ' + trace.filter((_, i) => i % 2 === 0 || i === trace.length - 1).map(([i, e]) => `${i}:${e.toFixed(3)}%`).join('  '));
  const last = trace[trace.length - 1][1];
  check(monotone, 'b: exploitability falls monotonically (within 15% noise)');
  check(last < 0.5, `b: exploitability ${last.toFixed(3)}% < 0.5% pot after ${solver.iterations} iterations`);

  const [ev0, ev1] = solver.evs();
  const [br0, br1] = solver.bestResponseValues();
  check(Math.abs(ev0 + ev1) < 1e-6, `c: zero-sum EVs ${ev0.toFixed(6)} + ${ev1.toFixed(6)} = ${(ev0 + ev1).toExponential(1)}`);
  check(br0 >= ev0 - 1e-9 && br1 >= ev1 - 1e-9, `c: best responses >= EVs (${br0.toFixed(4)} >= ${ev0.toFixed(4)}, ${br1.toFixed(4)} >= ${ev1.toFixed(4)})`);
  let nan = 0;
  (function walk(node) {
    if (node.reg) for (let i = 0; i < node.reg.length; i++) if (!Number.isFinite(node.reg[i]) || !Number.isFinite(node.sum[i])) nan++;
    if (node.kids) node.kids.forEach(walk);
  })(solver._ctx.root);
  check(nan === 0 && [ev0, ev1, br0, br1].every(Number.isFinite), `c: no NaN/Infinity in regrets, strategy sums or values (${nan})`);

  // d: every reachable decision path, every board-blocked combo.
  const blocked = [];
  for (let i = 0; i < NUM_COMBOS; i++) { const [a, b] = comboCards(i); if (board.includes(a) || board.includes(b)) blocked.push(i); }
  let leaks = 0, paths = 0, probOk = true;
  (function walk(path) {
    const acts = solver.actionsAt(path);
    if (!acts.length) return;
    paths++;
    for (let p = 0; p < 2; p++) { const r = solver.rangeAt(path, p); for (const i of blocked) if (r[i] !== 0) leaks++; }
    for (const i of blocked) if (solver.strategyAt(path, i) !== null) leaks++;
    for (let k = 0; k < 20; k++) {
      const pr = solver.strategyAt(path, (rng() * NUM_COMBOS) | 0);
      if (pr && Math.abs(pr.reduce((a, b) => a + b, 0) - 1) > 1e-6) probOk = false;
    }
    acts.forEach((_, a) => walk([...path, a]));
  })([]);
  check(leaks === 0, `d: board-blocked combos have zero weight and no strategy on all ${paths} decision nodes (${leaks} leaks)`);
  check(probOk, 'c: strategies are probability vectors');
}
{
  // d on a turn solve: through a dealt river card.
  const board = C('Ah9c6d2s');
  const s = createSolver({ board, pot: 10, stack: 40, ranges: [topRange(0.15), topRange(0.15)] });
  s.step(5);
  const river = C('Kh')[0];
  const cc = s.actionsAt([]).findIndex(a => a.type === 'check');
  const path = [cc, cc, river];
  let leaks = 0;
  for (let p = 0; p < 2; p++) {
    const r = s.rangeAt(path, p);
    for (let i = 0; i < NUM_COMBOS; i++) {
      const [a, b] = comboCards(i);
      if ([...board, river].includes(a) || [...board, river].includes(b)) { if (r[i] !== 0) leaks++; if (s.strategyAt(path, i) !== null) leaks++; }
    }
  }
  check(leaks === 0 && s.nodeInfo(path).board.length === 5, `d: turn solve, after river ${'Kh'}: combos holding it have zero weight (${leaks} leaks)`);
}

// ------------------------------------------------------------------ s ---
console.log('\ns. Mid-street starts');
{
  const board = C('Qh8d5c4s2h'), ranges = [topRange(0.3), topRange(0.3)];
  const a = createSolver({ board, pot: 10, stack: 50, ranges, start: { bets: [4, 0], toAct: 1 } });
  const acts = a.actionsAt([]).map(x => `${x.type}:${x.amount}`).join(' ');
  check(acts === 'fold:0 call:4 raise:12 allin:50', `s: OOP bet 4 into 10, IP to act: ${acts}`);
  check(a.rootPot === 14 && a.nodeInfo([]).player === 1, `s: root pot ${a.rootPot} (pot + start bets), IP acts`);
  a.step(200);
  check(a.exploitability() < 1, `s: solves (${a.exploitability().toFixed(3)}% of root pot)`);
  const b = createSolver({ board, pot: 10, stack: 50, ranges, start: { bets: [0, 0], toAct: 1 } });
  const ck = b.actionsAt([]).findIndex(x => x.type === 'check');
  check(b.nodeInfo([]).player === 1 && b.nodeInfo([ck]).type === 'showdown', 's: OOP checked, IP to act: IP check closes the street');
  const c = createSolver({ board, pot: 10, stack: 100, ranges, start: { bets: [4, 12], toAct: 0 } });
  const cacts = c.actionsAt([]).map(x => x.type).join(' ');
  check(cacts === 'fold call raise allin', `s: OOP bet 4, IP raised to 12, OOP to act: ${cacts} (stack 100: re-raise to 36 allowed)`);
  const c2 = createSolver({ board, pot: 10, stack: 50, ranges, start: { bets: [4, 12], toAct: 0 } });
  check(c2.actionsAt([]).map(x => x.type).join(' ') === 'fold call allin', 's: stack 50: the 3x re-raise (32 of 46 behind > 67%) becomes all-in');
  const r3 = c.actionsAt([]).findIndex(x => x.type === 'raise');
  check(c.actionsAt([r3]).map(x => x.type).join(' ') === 'fold call', 's: after the third bet only fold/call remain');
}

// ------------------------------------------------------------------ i ---
console.log('\ni. Suit isomorphism');
{
  // Two-tone turn (spades, hearts): diamonds and clubs are interchangeable.
  const base = { board: C('AsJh7s4h'), pot: 10, stack: 30, ranges: [topRange(0.25), topRange(0.22)] };
  const A = createSolver(base), B = createSolver({ ...base, isomorphism: false });
  A.step(3); B.step(3);
  let d = 0, dr = 0;
  const cc = A.actionsAt([]).findIndex(a => a.type === 'check');
  const paths = [[], [cc], [cc, cc, C('2d')[0]], [cc, cc, C('2c')[0]], [cc, cc, C('Kc')[0]], [1, 1, C('9c')[0]]];
  for (const path of paths) {
    for (let p = 0; p < 2; p++) {
      const ra = A.rangeAt(path, p), rb = B.rangeAt(path, p);
      for (let i = 0; i < NUM_COMBOS; i++) dr = Math.max(dr, Math.abs(ra[i] - rb[i]));
    }
    if (!A.actionsAt(path).length) continue;
    for (let i = 0; i < NUM_COMBOS; i++) {
      const sa = A.strategyAt(path, i), sb = B.strategyAt(path, i);
      if (!sa !== !sb) d = 1;
      if (sa) sa.forEach((x, k) => { d = Math.max(d, Math.abs(x - sb[k])); });
    }
  }
  const ea = A.exploitability(), eb = B.exploitability();
  console.log(`     turn: ${A.isomorphism} board-fixing perms, memory ${mb(A.memoryBytes)} vs ${mb(B.memoryBytes)}`);
  check(A.isomorphism === 2, 'i: two-tone turn detects the diamond/club swap');
  check(d < 1e-4 && dr < 1e-4, `i: strategies/ranges equal to brute force after 3 iterations, incl. non-representative river cards (max ${Math.max(d, dr).toExponential(1)})`);
  check(Math.abs(ea - eb) < 1e-3 * Math.max(1, eb), `i: exploitability equal (${ea.toFixed(4)} vs ${eb.toFixed(4)})`);

  // Larger symmetry groups (3-cycles: non-involutive perms) and the exact
  // flop paths (permuted turn matrices in flop all-ins and leaves).
  for (const [name, board, extra, more] of [
    ['four-flush turn', C('AsKs7s4s'), {}, [[0, 0, C('2h')[0]], [0, 0, C('2d')[0]], [0, 0, C('Qc')[0]], [1, 1, C('9d')[0]]]],
    ['monotone flop, exact leaves', C('AsJs7s'), { leafSamples: 0 }, [[0, 0, C('2h')[0]], [0, 0, C('2c')[0]], [1, 1, C('9c')[0]], [0, 0, C('3s')[0]]]],
    ['two-tone flop, exact leaves', C('AsJh7s'), { leafSamples: 0 }, [[0, 0, C('2d')[0]], [0, 0, C('2c')[0]], [1, 1, C('Tc')[0]]]],
  ]) {
    const b2 = { board, pot: 10, stack: 30, ranges: [topRange(0.12), topRange(0.1)], ...extra };
    const X = createSolver(b2), Y = createSolver({ ...b2, isomorphism: false });
    X.step(2); Y.step(2);
    let dd = 0;
    for (const path of [[], [0], ...more]) {
      for (let p = 0; p < 2; p++) { const ra = X.rangeAt(path, p), rb = Y.rangeAt(path, p); for (let i = 0; i < NUM_COMBOS; i++) dd = Math.max(dd, Math.abs(ra[i] - rb[i])); }
      if (!X.actionsAt(path).length) continue;
      for (let i = 0; i < NUM_COMBOS; i++) {
        const sa = X.strategyAt(path, i), sb = Y.strategyAt(path, i);
        if (!sa !== !sb) dd = 1;
        if (sa) sa.forEach((x, k) => { dd = Math.max(dd, Math.abs(x - sb[k])); });
      }
    }
    const ex = X.exploitability(), ey = Y.exploitability();
    check(dd < 1e-4 && Math.abs(ex - ey) < 1e-3 * Math.max(1, ey), `i: ${name}: ${X.isomorphism} perms, equal to brute force (max diff ${dd.toExponential(1)}, exploit ${ex.toFixed(4)} vs ${ey.toFixed(4)})`);
  }

  // Depth-limited flop with sampled leaves stays exactly symmetric.
  const F = createSolver({ board: C('AsJh7s'), pot: 10, stack: 40, ranges: [topRange(0.1), topRange(0.09)] });
  F.step(30);
  const swap = c => ((c & 3) === 2 ? c + 1 : (c & 3) === 3 ? c - 1 : c);
  let asym = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    const a = F.strategyAt([], i);
    if (!a) continue;
    const [x, y] = comboCards(i);
    const b = F.strategyAt([], comboIndex(swap(x), swap(y)));
    a.forEach((v, k) => { asym = Math.max(asym, Math.abs(v - b[k])); });
  }
  check(F.isomorphism === 2 && asym < 1e-5, `i: depth-limited flop, sampled leaves + isomorphism: root strategy symmetric (max ${asym.toExponential(1)})`);
}

// ------------------------------------------------------------------ w ---
console.log('\nw. Worker handler (Node)');
await new Promise(resolve => {
  const msgs = [];
  const board = C('Qh8d5c4s2h');
  const hands = [comboIndex(...C('AhKh')), comboIndex(...C('Qs8s')), comboIndex(...C('7h6h')), comboIndex(...C('Qd8h'))];
  const handle = createWorkerHandler(m => {
    msgs.push(m);
    if (!m.done) return;
    const upd = msgs.filter(x => !x.done);
    check(!m.error && m.done && m.reason === 'target', `w: river solve finished by target (${m.iter} iterations, ${m.elapsedMs} ms, exploit ${m.exploit?.toFixed(3)}%)`);
    const st = m.strategies[hands[0]];
    check(st && st.probs && Math.abs(st.probs.reduce((a, b) => a + b, 0) - 1) < 1e-6 && st.actions.length === st.probs.length, 'w: strategies carry actions + probabilities');
    check(m.strategies[hands[3]].probs === null, 'w: board-blocked hand reports probs: null');
    check(upd.every(x => x.id === 'r1'), `w: ${upd.length} interim updates`);
    // Stop test on a turn solve.
    const msgs2 = [];
    const h2 = createWorkerHandler(m2 => {
      msgs2.push(m2);
      if (m2.done) {
        check(m2.reason === 'stopped', `w: stop honoured (${m2.iter} iterations, ${m2.elapsedMs} ms)`);
        resolve();
      }
    });
    h2({ cmd: 'solve', id: 't1', input: { board: C('Qh8d5c4s'), pot: 10, stack: 50, ranges: [topRange(0.3), topRange(0.3)], maxMs: 20000 }, hands, path: [] });
    setTimeout(() => h2({ cmd: 'stop', id: 't1' }), 600);
  });
  handle({ cmd: 'solve', id: 'r1', input: { board, pot: 12, stack: 60, ranges: [topRange(0.4), topRange(0.4)], targetExploit: 0.3 }, hands, path: [] });
});

// ------------------------------------------------------------------ e ---
console.log('\ne. Timing and memory, ~40% ranges both sides (OOP top 40%, IP top 38%), pot 10, stack 90');
function solveUntil(input, target, maxMs, every) {
  const t0 = performance.now();
  const s = createSolver(input);
  const buildMs = performance.now() - t0;
  let solveMs = 0, e = Infinity, hit = null;
  while (solveMs < maxMs) {
    const a = performance.now();
    s.step(every);
    solveMs += performance.now() - a;
    e = s.exploitability();
    if (e <= target) { hit = solveMs; break; }
  }
  return { s, buildMs, solveMs, e, hit };
}
{
  const ranges = [topRange(0.4), topRange(0.38)];
  for (const [name, board] of [['river', C('Ks9h6d3c2s')], ['river', C('As7s4h3s2d')]]) {
    const r = solveUntil({ board, pot: 10, stack: 90, ranges }, 0.5, 5000, 10);
    console.log(`     ${name} ${fmtBoard(board)}: ${r.s.combos.join('x')} combos, build ${fmtMs(r.buildMs)}, 0.5% pot after ${r.s.iterations} it in ${fmtMs(r.solveMs)} (exploit ${r.e.toFixed(3)}%), memory ${mb(r.s.memoryBytes)}  [target <1 s: ${r.hit !== null && r.buildMs + r.hit < 1000 ? 'MET' : 'MISS'}]`);
  }
  const turnBoards = QUICK ? [C('Ks9h6d3c')] : [C('Ks9h6d3c'), C('AsJh7s4h')];
  for (const board of turnBoards) {
    const r = solveUntil({ board, pot: 10, stack: 90, ranges }, 1.0, QUICK ? 8000 : 60000, 10);
    const perIt = r.solveMs / r.s.iterations;
    console.log(`     turn ${fmtBoard(board)}: ${r.s.combos.join('x')} combos, iso perms ${r.s.isomorphism}, ${r.s.stats.actNodes} decision nodes, build ${fmtMs(r.buildMs)}, ${perIt.toFixed(0)} ms/iteration, ` +
      (r.hit !== null ? `1% pot after ${r.s.iterations} it in ${fmtMs(r.hit)}` : `exploit ${r.e.toFixed(2)}% after ${fmtMs(r.solveMs)}`) +
      `, memory ${mb(r.s.memoryBytes)}  [target ~10 s: ${r.hit !== null && r.hit < 10000 ? 'MET' : 'MISS'}]`);
  }
  // Depth-limited flop: exact exploitability at fixed solve times.
  const flopBoards = QUICK ? [C('Ks9h6d')] : [C('Ks9h6d'), C('AsJh7s')];
  for (const board of flopBoards) {
    const t0 = performance.now();
    const s = createSolver({ board, pot: 10, stack: 90, ranges });
    let solveMs = performance.now() - t0;
    const parts = [];
    for (const mark of QUICK ? [2000] : [2000, 5000, 10000]) {
      while (solveMs < mark) { const a = performance.now(); s.step(1); solveMs += performance.now() - a; }
      const a = performance.now();
      const e = s.exploitability();
      parts.push(`${fmtMs(mark)}: ${s.iterations} it, exploit ${e.toFixed(1)}% (${root(s)})`);
      if (parts.length === 1) parts[0] += ` [exploitability() took ${fmtMs(performance.now() - a)}]`;
    }
    console.log(`     flop DL ${fmtBoard(board)}: ${s.combos.join('x')} combos, iso perms ${s.isomorphism}, memory ${mb(s.memoryBytes)} (+${mb(s.exploitMemoryBytes)} once exploitability() runs)`);
    for (const p of parts) console.log(`        ${p}`);
  }
  // Full flop (turn + river betting) sizing, coarse abstraction.
  for (const [label, sizes] of [
    ['default sizes', {}],
    ['coarse: 1 bet (66%), all-in raise only, 2 bets/street', { bet: [0.66], raise: [], allin: true, maxBets: 2 }],
    ['1 bet (66%), no raises', { bet: [0.66], raise: [], allin: false, maxBets: 1 }],
    ['coarsest: all-in only', { bet: [], raise: [], allin: true, maxBets: 1 }],
  ]) {
    const est = estimateSolve({ board: C('Ks9h6d'), pot: 10, stack: 90, ranges, sizes, depthLimited: false });
    console.log(`     full flop solve, ${label}: ${est.actNodes.toLocaleString()} decision nodes, ~${mb(est.memoryBytes)}${est.memoryBytes > 400e6 ? ' (over 400 MB)' : ''}`);
  }
  if (process.argv.includes('--full-flop')) {
    // Measured: full flop (turn + river betting), one bet size, no raises,
    // on a two-tone flop where isomorphism halves the work.
    const ab0 = process.memoryUsage().arrayBuffers;
    const t0 = performance.now();
    const s = createSolver({ board: C('AsJh7s'), pot: 10, stack: 90, ranges, depthLimited: false, sizes: { bet: [0.66], raise: [], allin: false, maxBets: 1 } });
    const build = performance.now() - t0;
    let solveMs = 0;
    for (const n of [10, 40]) {
      while (s.iterations < n) { const a = performance.now(); s.step(1); solveMs += performance.now() - a; }
      console.log(`     full flop AsJh7s, 1 bet no raises: build ${fmtMs(build)}, ${n} it in ${fmtMs(solveMs)}, exploit ${s.exploitability().toFixed(2)}%, estimate ${mb(s.memoryBytes)}, ArrayBuffers ${mb(process.memoryUsage().arrayBuffers - ab0)}`);
    }
  }
}

function fmtBoard(b) { return b.map(c => '23456789TJQKA'[c >> 2] + 'shdc'[c & 3]).join(''); }
function root(s) {
  const acts = s.actionsAt([]);
  const r = s.rangeAt([], 0);
  const agg = new Array(acts.length).fill(0);
  let tot = 0;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (!r[i]) continue;
    s.strategyAt([], i).forEach((x, a) => { agg[a] += x * r[i]; });
    tot += r[i];
  }
  return acts.map((a, i) => `${a.type}${a.type === 'check' ? '' : ' ' + a.amount.toFixed(1)} ${(agg[i] / tot * 100).toFixed(0)}%`).join(', ');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
