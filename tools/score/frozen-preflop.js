// FROZEN: preflop decoder copied from base commit (js/coach.js decodeStrategy/handClass + tree).
// Percentages are combo-weighted over all 1326 combos.
import fs from 'node:fs';
import { buildTree, POSITIONS } from './frozen-preflop-tree.js';

const trees = {};
const treeFor = n => (trees[n] ||= buildTree(n));
const rank = c => c >> 2, suit = c => c & 3;
function handClass(a, b) {
  const x = rank(a), y = rank(b), hi = Math.max(x, y), lo = Math.min(x, y);
  if (hi === lo) return hi * 13 + hi;
  return suit(a) === suit(b) ? hi * 13 + lo : lo * 13 + hi;
}
const classCombos = new Float64Array(169);
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) classCombos[handClass(a, b)]++;

export function loadPreflop(file, n = 6) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const tree = treeFor(n);
  const offsets = new Int32Array(tree.nodes.length).fill(-1);
  let off = 0;
  for (const node of tree.nodes) { if (node.term) continue; offsets[node.id] = off; off += 169 * node.acts.length; }
  if (off !== bytes.length) throw new Error(`strategy size ${bytes.length} != ${off}`);
  return { tree, offsets, data: bytes };
}
const probs = (S, node, cls) => {
  const o = S.offsets[node.id], k = node.acts.length, row = [];
  let s = 0;
  for (let i = 0; i < k; i++) { const v = S.data[o + cls * k + i]; row.push(v); s += v; }
  return row.map(v => (s ? v / s : 1 / k));
};
// share (0..100) of combos taking any action in `want` ('f','c','r') at the node
function share(S, node, want) {
  let tot = 0, hit = 0;
  for (let c = 0; c < 169; c++) {
    const p = probs(S, node, c);
    let q = 0;
    node.acts.forEach((a, i) => { if (want.includes(a.t)) q += p[i]; });
    hit += q * classCombos[c]; tot += classCombos[c];
  }
  return 100 * hit / tot;
}
// follow actions (by letter) from the root; returns the node
function follow(S, letters) {
  let node = S.tree.nodes[0];
  for (const l of letters) {
    const a = node.acts.find(x => x.t === l);
    if (!a) throw new Error(`no action ${l} at node ${node.id}`);
    node = S.tree.nodes[a.next];
  }
  return node;
}
export function preflopSpots(file) {
  const S = loadPreflop(file, 6);
  const nm = POSITIONS[6]; // UTG HJ CO BTN SB BB
  const out = {};
  out.UTG = share(S, follow(S, []), ['r']);
  out.HJ = share(S, follow(S, ['f']), ['r']);
  out.CO = share(S, follow(S, ['f', 'f']), ['r']);
  out.BTN = share(S, follow(S, ['f', 'f', 'f']), ['r']);
  const sb = follow(S, ['f', 'f', 'f', 'f']);
  out.SB_raise = share(S, sb, ['r']);
  out.SB_limp = share(S, sb, ['c']);
  const bb = follow(S, ['f', 'f', 'f', 'r', 'f']);
  out.BB_defend = share(S, bb, ['c', 'r']);
  return { spots: out, seats: nm };
}
