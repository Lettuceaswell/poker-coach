// Shared helpers for the calibrated-preflop pipeline: read a preflop-N.bin, enumerate common
// heads-up endings with their ranges, gauges, flop subset, drift. Read-only on data/preflop-*.bin.
import fs from 'fs';
import { buildTree, POSITIONS, postflopRank, STACK } from '../../js/preflop-tree.js';

export const COMBOS = new Float64Array(169);
for (let c = 0; c < 169; c++) { const x = Math.floor(c / 13), y = c % 13; COMBOS[c] = x === y ? 6 : x > y ? 4 : 12; }

export function loadBin(n, file) {
  const tree = buildTree(n);
  const OFF = new Int32Array(tree.nodes.length).fill(-1);
  let size = 0;
  for (const nd of tree.nodes) if (!nd.term) { OFF[nd.id] = size; size += 169 * nd.acts.length; }
  const bytes = new Uint8Array(fs.readFileSync(file));
  if (bytes.length !== size) throw new Error(`${file}: ${bytes.length} bytes, tree wants ${size}`);
  const avg = (id, c) => {
    const k = tree.nodes[id].acts.length, o = OFF[id] + c * k;
    let s = 0; for (let a = 0; a < k; a++) s += bytes[o + a];
    return Array.from({ length: k }, (_, a) => (s > 0 ? bytes[o + a] / s : 1 / k));
  };
  return { n, tree, nodes: tree.nodes, OFF, bytes, avg };
}

// All heads-up showdown endings with each player's class reach (169) and frequency.
export function enumerateEndings(S) {
  const { n, nodes, avg } = S, nm = POSITIONS[n];
  const out = [];
  const walk = (id, reach, raises, path) => {
    const nd = nodes[id];
    if (nd.term) {
      if (nd.term !== 'show' || nd.live.length !== 2) return;
      const [lo, hi] = nd.live.slice().sort((a, b) => postflopRank(n, a) - postflopRank(n, b));
      const mass = p => { let m = 0; for (let c = 0; c < 169; c++) m += COMBOS[c] * reach[p][c]; return m / 1326; };
      const freq = mass(lo) * mass(hi);
      const pot = nd.put.reduce((s, x) => s + x, 0);
      out.push({
        key: `${nm[hi]}|${nm[lo]}|${raises}`, ip: nm[hi], oop: nm[lo], raises, freq, pot,
        stack: STACK - Math.max(...nd.put), equalPut: nd.put[lo] === nd.put[hi],
        ranges: { oop: Float64Array.from(reach[lo]), ip: Float64Array.from(reach[hi]) }, path,
      });
      return;
    }
    const p = nd.p;
    nd.acts.forEach((a, ai) => {
      const r2 = reach.map(x => x); r2[p] = Float64Array.from(reach[p]);
      for (let c = 0; c < 169; c++) r2[p][c] *= avg(id, c)[ai];
      let mx = 0; for (let c = 0; c < 169; c++) if (r2[p][c] > mx) mx = r2[p][c];
      if (mx < 1e-4) return;
      walk(a.next, r2, raises + (a.t === 'r' ? 1 : 0), path + nm[p][0] + a.t);
    });
  };
  walk(0, Array.from({ length: n }, () => new Float64Array(169).fill(1)), 0, '');
  // merge same key: keep the most frequent line
  const best = new Map();
  for (const e of out) if (e.equalPut && (!best.has(e.key) || e.freq > best.get(e.key).freq)) best.set(e.key, e);
  return [...best.values()].sort((a, b) => b.freq * b.pot - a.freq * a.pot);
}

// ---- gauges ----
export function gauges(S) {
  const { n, nodes, avg } = S, nm = POSITIONS[n];
  const g = { rfi: {} };
  let id = 0;
  for (let p = 0; p < n - 1; p++) {
    const nd = nodes[id];
    const ri = nd.acts.findIndex(a => a.t === 'r'), ci = nd.acts.findIndex(a => a.t === 'c');
    let w = 0, lw = 0;
    for (let c = 0; c < 169; c++) { const s = avg(id, c); w += COMBOS[c] * s[ri]; if (ci >= 0) lw += COMBOS[c] * s[ci]; }
    if (nm[p] === 'SB') { g.sbRaise = w / 1326; g.sbLimp = lw / 1326; } else g.rfi[nm[p]] = w / 1326;
    const f = nd.acts.find(a => a.t === 'f'); if (!f) break; id = f.next;
  }
  // BB defense vs BTN open (folds to BTN)
  id = 0;
  const bt = nm.indexOf('BTN');
  for (let p = 0; p < bt; p++) id = nodes[id].acts.find(a => a.t === 'f').next;
  id = nodes[id].acts.find(a => a.t === 'r').next;
  while (!nodes[id].term && nm[nodes[id].p] !== 'BB') id = nodes[id].acts.find(a => a.t === 'f').next;
  if (!nodes[id].term) {
    const fi = nodes[id].acts.findIndex(a => a.t === 'f'); let w = 0;
    for (let c = 0; c < 169; c++) w += COMBOS[c] * (1 - avg(id, c)[fi]);
    g.bbDefVsBtn = w / 1326;
  }
  return g;
}

// mean total-variation distance between two solutions, class-weighted, over every decision node
export function drift(A, B) {
  let tot = 0, cnt = 0;
  for (const nd of A.nodes) {
    if (nd.term) continue;
    for (let c = 0; c < 169; c++) {
      const a = A.avg(nd.id, c), b = B.avg(nd.id, c);
      let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
      tot += COMBOS[c] * d / 2; cnt += COMBOS[c];
    }
  }
  return tot / cnt;
}

// ---- flop subset: strategically distinct flops, isomorphism-weighted, systematic sample ----
export function canonicalFlops() {
  const seen = new Map();
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
    // canonical suit relabel: sort cards by rank desc, relabel suits by first appearance
    const cs = [a, b, c].sort((x, y) => (y >> 2) - (x >> 2) || (x & 3) - (y & 3));
    const best = [];
    for (const perm of PERMS) {
      const k = cs.map(x => ((x >> 2) << 2) | perm[x & 3]).sort((x, y) => x - y).join(',');
      best.push(k);
    }
    best.sort();
    const key = best[0];
    const e = seen.get(key);
    if (e) e.weight++; else seen.set(key, { cards: key.split(',').map(Number), weight: 1 });
  }
  return [...seen.values()];
}
const PERMS = [];
(function gen(cur, used) {
  if (cur.length === 4) { PERMS.push(cur.slice()); return; }
  for (let s = 0; s < 4; s++) if (!used[s]) { used[s] = true; cur.push(s); gen(cur, used); cur.pop(); used[s] = false; }
})([], [false, false, false, false]);

export function flopFeatures(cards) {
  const r = cards.map(c => c >> 2).sort((a, b) => b - a), s = new Set(cards.map(c => c & 3)).size;
  const paired = new Set(r).size < 3 ? 1 : 0;
  return [paired, s === 1 ? 0 : s === 2 ? 1 : 2, r[0], r[0] - r[2]];
}

// K flops by systematic sampling over the weight-ordered feature-sorted list (stratified by texture).
export function sampleFlops(K, offset = 0.5) {
  const all = canonicalFlops();
  all.sort((x, y) => { const a = flopFeatures(x.cards), b = flopFeatures(y.cards); for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i]; return x.cards[0] - y.cards[0]; });
  const total = all.reduce((s, f) => s + f.weight, 0);
  const picks = []; let cum = 0, next = offset * total / K, i = 0;
  for (const f of all) {
    cum += f.weight;
    while (i < K && cum >= next) { picks.push(f.cards); i++; next = (i + offset) * total / K; }
  }
  return picks;
}
