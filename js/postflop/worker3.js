// Web Worker for the live three-way river solve (js/postflop/solver3.js).
// In:  { id, spec: { board, pot, stack, ranges: [Float32Array x3] }, acts: [{ p, type, amount }], hero: seat 0-2,
//        heroCombo, iters, maxMs }
// Out: { id, status: 'done' | 'timeout' | 'error', iters, ms, mix?: [{ type, amount, freq }], error? }
// acts are the river actions already taken, p = solver seat (0 = first to act). The mix is the hero's
// average strategy at the node those actions lead to, for the hero's actual hand.
import { createSolver3, THREEWAY_LIVE_ITERS, THREEWAY_LIVE_MS } from './solver3.js';

self.onmessage = (e) => {
  const { id, spec, acts, hero, heroCombo } = e.data;
  const iters = e.data.iters || THREEWAY_LIVE_ITERS, maxMs = e.data.maxMs || THREEWAY_LIVE_MS;
  const t0 = performance.now();
  try {
    const s = createSolver3(spec);
    let n = 0;
    while (n < iters && performance.now() - t0 < maxMs) { s.step(1); n++; }
    const ms = Math.round(performance.now() - t0);
    if (n < iters) return self.postMessage({ id, status: 'timeout', iters: n, ms });
    // walk the river actions taken so far to the hero's node (nearest size for bets and raises)
    const path = [];
    let node = s.root;
    for (const a of acts) {
      if (node.t !== 0 || node.player !== a.p) return self.postMessage({ id, status: 'error', error: 'line off the tree', iters: n, ms });
      let k = -1, best = Infinity;
      node.actions.forEach((x, i) => {
        const plain = x.type === 'fold' || x.type === 'check' || x.type === 'call';
        if (a.type === 'fold' || a.type === 'check' || a.type === 'call') { if (x.type === a.type) k = i; }
        else if (!plain && Math.abs(x.amount - a.amount) < best) { best = Math.abs(x.amount - a.amount); k = i; }
      });
      if (k < 0) return self.postMessage({ id, status: 'error', error: 'line off the tree', iters: n, ms });
      path.push(k); node = node.kids[k];
    }
    if (node.t !== 0 || node.player !== hero) return self.postMessage({ id, status: 'error', error: 'hero not to act', iters: n, ms });
    const st = s.strategy(path, hero);
    const j = st ? st.combos.indexOf(heroCombo) : -1;
    if (j < 0) return self.postMessage({ id, status: 'error', error: 'hero hand not in range', iters: n, ms });
    const mix = st.actions.map((a, i) => ({ type: a.type, amount: a.amount, freq: st.probs[i * st.n + j] }));
    self.postMessage({ id, status: 'done', iters: n, ms, mix });
  } catch (err) {
    self.postMessage({ id, status: 'error', error: String(err.message || err), iters: 0, ms: Math.round(performance.now() - t0) });
  }
};
