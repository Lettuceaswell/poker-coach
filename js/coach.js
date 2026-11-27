// Maps a live hand onto the solved preflop tree and reads the strategy there.
import { buildTree, POSITIONS, STACK } from './preflop-tree.js';
import { rankOf, suitOf } from './cards.js';

const trees = {};
export function treeFor(n) {
  if (!trees[n]) trees[n] = buildTree(n);
  return trees[n];
}

// 169 hand classes: pairs, suited, offsuit. Index = hi*13+lo for suited (hi>lo),
// lo*13+hi for offsuit, r*13+r for pairs.
export function handClass(cards) {
  const a = rankOf(cards[0]), b = rankOf(cards[1]);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi === lo) return hi * 13 + hi;
  return suitOf(cards[0]) === suitOf(cards[1]) ? hi * 13 + lo : lo * 13 + hi;
}
const R = '23456789TJQKA';
export function className(c) {
  const x = Math.floor(c / 13), y = c % 13;
  if (x === y) return R[x] + R[x];
  return x > y ? R[x] + R[y] + 's' : R[y] + R[x] + 'o';
}

// Walk the game's preflop history down the tree.
// Returns { node, tree, pos, quality: 'exact'|'approx'|'off', why }
export function mapSpot(game) {
  const n = game.players.filter(p => !p.out).length;
  const tree = treeFor(n);
  if (!tree) return { quality: 'off', why: 'table size' };
  const labels = game.positions();
  const posOf = (seat) => POSITIONS[n].indexOf(labels[seat]);
  let node = tree.nodes[0];
  let quality = 'exact', why = '', limpers = 0;
  const soften = (w) => { if (quality === 'exact') { quality = 'approx'; why = w; } };

  // stacks far from 100 BB change the right answer
  // effective stack for the player to act: their stack vs the biggest other stack
  const me = game.players[game.toAct];
  const others = game.players.filter(p => !p.out && p !== me).map(p => p.stack + p.totalIn);
  const eff = Math.min(me.stack + me.totalIn, Math.max(...others)) / game.bb;
  if (eff < 70 || eff > 150) soften(`${Math.round(eff)} BB deep`);

  for (const h of game.history) {
    if (h.street !== 'preflop') break;
    if (node.term) return { quality: 'off', why: 'past the tree' + (why ? ' after ' + why : '') };
    const p = posOf(h.seat);
    if (node.p !== p) return { quality: 'off', why: 'order' };
    const want = h.type === 'fold' ? 'f' : h.type === 'raise' ? 'r' : 'c';
    let a = node.acts.find(x => x.t === want);
    if (!a) {
      if (h.seat === game.toAct) return { quality: 'off', why: want === 'c' ? 'after your limp' : 'after your line' };
      if (want === 'c' && node.acts.find(x => x.t === 'f')) {
        // a limp or extra cold call the tree doesn't have: treat it as a fold (dead money)
        a = node.acts.find(x => x.t === 'f');
        if (h.amount <= game.bb) limpers++;
        soften(h.amount <= game.bb ? 'limper' : 'extra caller');
      } else if (want === 'r') {
        // raise beyond the cap: treat as a call
        a = node.acts.find(x => x.t === 'c');
        soften('raise war');
        if (!a) return { quality: 'off', why: 'raise war' };
      } else if (want === 'f') {
        a = node.acts.find(x => x.t === 'c');
        if (!a) return { quality: 'off', why: 'fold' };
      } else {
        return { quality: 'off', why: 'action' };
      }
    } else if (want === 'r') {
      const to = h.amount / game.bb;
      const ratio = to / a.to;
      if (ratio < 0.6 || ratio > 1.6) soften(`${+to.toFixed(1)} BB raise`);
    }
    node = tree.nodes[a.next];
  }
  if (node.term) return { quality: 'off', why: 'past the tree' + (why ? ' after ' + why : '') };
  return { node, tree, pos: node.p, quality, why, limpers };
}

// Strategy table: { n, offsets: Int32Array per node into data, data: Uint8Array (0..255) }
export function strategyAt(strat, node, cls) {
  const off = strat.offsets[node.id];
  if (off < 0) return null;
  const k = node.acts.length;
  const row = [];
  let sum = 0;
  for (let i = 0; i < k; i++) { const v = strat.data[off + cls * k + i]; row.push(v); sum += v; }
  return row.map(v => (sum ? v / sum : 1 / k));
}

export async function loadStrategy(n, base = 'data') {
  const res = await fetch(`${base}/preflop-${n}.bin`);
  if (!res.ok) throw new Error('no strategy');
  return decodeStrategy(n, new Uint8Array(await res.arrayBuffer()));
}

// Binary: for every decision node in tree order, 169*acts bytes.
export function decodeStrategy(n, bytes) {
  const tree = treeFor(n);
  const offsets = new Int32Array(tree.nodes.length).fill(-1);
  let off = 0;
  for (const node of tree.nodes) {
    if (node.term) continue;
    offsets[node.id] = off;
    off += 169 * node.acts.length;
  }
  if (off !== bytes.length) throw new Error(`strategy size ${bytes.length} != ${off}`);
  return { n, offsets, data: bytes };
}
