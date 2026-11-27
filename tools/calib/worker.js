// Worker thread: solve one (spot, flop) heads-up and return per-class sums for the realization table.
import { parentPort } from 'worker_threads';
import { createSolver, comboCards } from '../../js/postflop/solver.js';
import { scoreHands } from '../../js/postflop/eval7.js';
import { handClass } from '../../js/coach.js';

const CLS = new Int16Array(1326);
for (let i = 0; i < 1326; i++) CLS[i] = handClass(comboCards(i));

function rangeVec(r169) {
  const w = new Float32Array(1326);
  for (let i = 0; i < 1326; i++) w[i] = r169[CLS[i]];
  return w;
}

// raw equity (0..1) of every combo of `me` vs `opp` weights over `nRun` random runouts, pairwise
function equities(board, wMe, wOp, nRun, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const used = new Uint8Array(52); for (const c of board) used[c] = 1;
  const deck = []; for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const ids = w => { const o = []; for (let i = 0; i < 1326; i++) { const [a, b] = comboCards(i); if (w[i] > 0 && !used[a] && !used[b]) o.push(i); } return o; };
  const A = ids(wMe), B = ids(wOp);
  const aC1 = Uint8Array.from(A, i => comboCards(i)[0]), aC2 = Uint8Array.from(A, i => comboCards(i)[1]);
  const bC1 = Uint8Array.from(B, i => comboCards(i)[0]), bC2 = Uint8Array.from(B, i => comboCards(i)[1]);
  const sa = new Int32Array(A.length), sb = new Int32Array(B.length);
  const num = new Float64Array(A.length), den = new Float64Array(A.length);
  for (let r = 0; r < nRun; r++) {
    let t = deck[Math.floor(rnd() * deck.length)], v;
    do { v = deck[Math.floor(rnd() * deck.length)]; } while (v === t);
    const full = [...board, t, v];
    scoreHands(full, aC1, aC2, A.length, sa); scoreHands(full, bC1, bC2, B.length, sb);
    for (let i = 0; i < A.length; i++) {
      if (aC1[i] === t || aC1[i] === v || aC2[i] === t || aC2[i] === v) { sa[i] = -1; continue; }
    }
    for (let j = 0; j < B.length; j++) if (bC1[j] === t || bC1[j] === v || bC2[j] === t || bC2[j] === v) sb[j] = -1;
    for (let i = 0; i < A.length; i++) {
      if (sa[i] < 0) continue;
      const x1 = aC1[i], x2 = aC2[i];
      let nu = 0, de = 0;
      for (let j = 0; j < B.length; j++) {
        if (sb[j] < 0) continue;
        const y1 = bC1[j], y2 = bC2[j];
        if (y1 === x1 || y1 === x2 || y2 === x1 || y2 === x2) continue;
        const w = wOp[B[j]];
        de += w; nu += w * (sa[i] > sb[j] ? 1 : sa[i] === sb[j] ? 0.5 : 0);
      }
      num[i] += nu; den[i] += de;
    }
  }
  const eq = new Float64Array(1326).fill(NaN);
  for (let i = 0; i < A.length; i++) if (den[i] > 0) eq[A[i]] = num[i] / den[i];
  return eq;
}

parentPort.on('message', t => {
  const t0 = Date.now();
  try {
    const wOop = rangeVec(t.oop), wIp = rangeVec(t.ip);
    const solver = createSolver({ board: t.board, pot: t.pot, stack: t.stack, ranges: [wOop, wIp], maxMemoryBytes: t.maxMem || 3e9, depthLimited: t.depthLimited !== false });
    const stop = t0 + t.ms;
    let it = 0;
    while (Date.now() < stop) { solver.step(1); it++; }
    const ex = t.measureExploit ? solver.exploitability() : null;
    // per class: sum over combos of w*(pot/2+EV), w*pot*eq, w
    const res = { id: t.id, spot: t.spot, iters: it, exploit: ex, ms: 0, roles: {} };
    const ws = [wOop, wIp];
    for (const p of [0, 1]) {
      const ev = solver._comboEvs([], p);
      const eq = equities(t.board, ws[p], ws[1 - p], t.nRun || 40, 12345 + t.id);
      const share = new Float64Array(169), eqs = new Float64Array(169), wt = new Float64Array(169);
      for (let i = 0; i < 1326; i++) {
        if (Number.isNaN(ev[i]) || Number.isNaN(eq[i])) continue;
        const c = CLS[i], w = ws[p][i];
        share[c] += w * (t.pot / 2 + ev[i]); eqs[c] += w * t.pot * eq[i]; wt[c] += w;
      }
      res.roles[p === 0 ? 'oop' : 'ip'] = { share, eqs, wt };
    }
    res.ms = Date.now() - t0;
    parentPort.postMessage(res);
  } catch (e) { parentPort.postMessage({ id: t.id, spot: t.spot, error: String(e && e.stack || e) }); }
});
