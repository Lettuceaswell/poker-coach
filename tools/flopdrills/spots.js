// Shared: solve one board for a preflop line and extract drill spots (same schema as data/postflop-drills.json).
import { createSolver, comboCards, NUM_COMBOS } from '../../js/postflop/solver.js';
import { scoreHands } from '../../js/postflop/eval7.js';
import { lineRanges, comboRanges, LINES } from './lines.js';

const SP = ['s', 'h', 'd', 'c'], RK = '23456789TJQKA';
export const cs = c => RK[c >> 2] + SP[c & 3];
const lab = a => a.type === 'check' ? 'Check' : a.type === 'fold' ? 'Fold' : a.type === 'call' ? 'Call' : a.type === 'allin' ? 'All-in' : a.type === 'raise' ? `Raise to ${+a.amount.toFixed(1)}` : `Bet ${+a.amount.toFixed(1)}`;
export const SIZES = { bet: [0.66], raise: [3], allin: true, maxBets: 3, allinThreshold: 0.67 };

// Later streets keep the strongest `keep` share of each range by showdown strength (thinning, not a solved narrowing).
function thin(r, bd, keep) {
  for (const w of r) {
    const idx = []; for (let i = 0; i < NUM_COMBOS; i++) if (w[i]) {
      const [a, b] = comboCards(i); const o = new Uint32Array(1); scoreHands(bd, [a], [b], 1, o); idx.push([i, o[0]]);
    }
    idx.sort((x, y) => y[1] - x[1]);
    for (const [i] of idx.slice(Math.floor(idx.length * keep))) w[i] = 0;
  }
}

export function provenance(lineName, street, keep) {
  const L = LINES[lineName];
  return `${L.desc}: ranges from the solved 6-max preflop strategy (data/preflop-6.bin), ` +
    (street === 'flop' ? 'used as is on the flop.' : `thinned to the strongest ${Math.round(keep * 100)}% by hand strength for the ${street}; pot and stacks assume earlier-street betting (not a solved narrowing).`);
}

// Returns { spots, exploit, secs } or { skipped, exploit }.
export function solveSpots({ lineName, board, street, keep = 1, secs, sizes = SIZES, rnd, maxExploit = 3, perNode, potMult = 1 }) {
  const lr = lineRanges(lineName), r = comboRanges(lr, board);
  if (potMult !== 1) { const p2 = +(lr.pot * potMult).toFixed(1); lr.stack = +(lr.stack - (p2 - lr.pot) / 2).toFixed(1); lr.pot = p2; } // earlier-street betting, split evenly
  if (keep < 1) thin(r, board, keep);
  const s = createSolver({ board, pot: lr.pot, stack: lr.stack, ranges: r, sizes });
  const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) s.step(10);
  const ex = s.exploitability(), took = (Date.now() - t0) / 1000;
  if (ex > maxExploit) return { skipped: true, exploit: ex, secs: took };
  const nodes = []; const acts = s.actionsAt([]);
  const bi = acts.findIndex(a => a.type === 'bet' || a.type === 'allin');
  nodes.push([[], 0]); if (bi >= 0) nodes.push([[bi], 1]);
  nodes.push([[acts.findIndex(a => a.type === 'check')], 1]);
  const spots = [];
  for (const [path, player] of nodes) {
    if (path[0] < 0) continue;
    const A = s.actionsAt(path); if (!A || A.length < 2) continue;
    const rng = s.rangeAt(path, player), cand = [];
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (rng[i] < 0.5) continue;
      const mix = s.strategyAt(path, i), ev = s.actionValues(path, i); if (!mix || !ev) continue;
      cand.push({ i, mix, ev, score: (Math.max(...ev) - Math.min(...ev)) * (1.3 - Math.max(...mix)) + rnd() * 0.05 });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand.slice(0, perNode || 1)) {
      const [x, y] = comboCards(c.i);
      spots.push({
        street, board: board.map(cs), pot: lr.pot, stack: lr.stack, hero: player === 0 ? 'OOP' : 'IP',
        facing: path.length && path[0] === bi ? +acts[bi].amount.toFixed(1) : 0,
        hand: [cs(x), cs(y)], opts: A.map(lab), mix: c.mix.map(v => +v.toFixed(3)), ev: c.ev.map(v => +v.toFixed(2)),
        exploit: +ex.toFixed(2), line: lineName, prov: provenance(lineName, street, keep),
      });
    }
  }
  return { spots, exploit: ex, secs: took };
}
