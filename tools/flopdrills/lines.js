// Preflop lines and ranges for drill building. Ranges come from the solved preflop strategy
// (data/preflop-6.bin through the app's own decodeStrategy/treeFor/strategyAt): the weight of a
// hand class for a seat is the product of that seat's solved action frequencies along the line.
import fs from 'node:fs';
import { treeFor, decodeStrategy, strategyAt } from '../../js/coach.js';
import { POSITIONS } from '../../js/preflop-tree.js';
import { COMBOS } from '../../js/ranges.js';

const NAMES = POSITIONS[6];
// Each line: actions in preflop order as POS:f|c|r. The last two entries decide who is OOP/IP.
export const LINES = {
  'BTN-BB-SRP': { desc: 'BTN opens, BB calls', acts: ['UTG:f', 'HJ:f', 'CO:f', 'BTN:r', 'SB:f', 'BB:c'], oop: 'BB', ip: 'BTN' },
  'CO-BB-SRP': { desc: 'CO opens, BB calls', acts: ['UTG:f', 'HJ:f', 'CO:r', 'BTN:f', 'SB:f', 'BB:c'], oop: 'BB', ip: 'CO' },
  'SB-BB-SRP': { desc: 'SB opens, BB calls', acts: ['UTG:f', 'HJ:f', 'CO:f', 'BTN:f', 'SB:r', 'BB:c'], oop: 'SB', ip: 'BB', ipIsBB: true },
  'BTN-BB-3BP': { desc: 'BTN opens, BB 3-bets, BTN calls', acts: ['UTG:f', 'HJ:f', 'CO:f', 'BTN:r', 'SB:f', 'BB:r', 'BTN:c'], oop: 'BB', ip: 'BTN' },
};

let STRAT = null;
export function loadPreflop(file = new URL('../../data/preflop-6.bin', import.meta.url)) {
  if (!STRAT) STRAT = decodeStrategy(6, new Uint8Array(fs.readFileSync(file)));
  return STRAT;
}

// Walk the tree along the line. Returns { w: {POS: Float32Array(169)}, pot, stack, oop, ip, sizes }.
export function lineRanges(name) {
  const L = LINES[name]; if (!L) throw new Error('unknown line ' + name);
  const strat = loadPreflop(), tree = treeFor(6);
  const w = {}; for (const p of NAMES) w[p] = new Float32Array(169).fill(1);
  const bets = NAMES.map((_, i) => (NAMES[i] === 'SB' ? 0.5 : NAMES[i] === 'BB' ? 1 : 0));
  const folded = NAMES.map(() => false);
  let node = tree.nodes[0];
  for (const a of L.acts) {
    const [pos, t] = a.split(':');
    if (node.term || NAMES[node.p] !== pos) throw new Error(`line ${name}: expected ${NAMES[node.p]} to act, got ${a}`);
    const ai = node.acts.findIndex(x => x.t === t);
    if (ai < 0) throw new Error(`line ${name}: no action ${a}`);
    for (let c = 0; c < 169; c++) w[pos][c] *= strategyAt(strat, node, c)[ai];
    const act = node.acts[ai], p = node.p;
    if (t === 'f') folded[p] = true; else if (t === 'c') bets[p] = Math.max(...bets); else bets[p] = act.to;
    node = tree.nodes[act.next];
  }
  if (!node.term) throw new Error(`line ${name}: not terminal (${NAMES[node.p]} to act)`);
  const pot = bets.reduce((s, b) => s + b, 0);
  const stack = +(100 - Math.max(...bets)).toFixed(1);
  return { w169: w, pot, stack, oop: L.oop, ip: L.ip, desc: L.desc };
}

// 169 weights -> 1326 combo weights (OOP, IP) with dead cards removed; tiny weights are dropped.
export function comboRanges(lr, dead) {
  const d = new Set(dead), out = [new Float32Array(1326), new Float32Array(1326)];
  [lr.oop, lr.ip].forEach((pos, k) => COMBOS.forEach(([a, b, c], i) => {
    const x = lr.w169[pos][c];
    out[k][i] = d.has(a) || d.has(b) || x < 0.03 ? 0 : x;
  }));
  return out;
}
export const rangeSize = (r) => r.reduce((s, x) => s + x, 0);
