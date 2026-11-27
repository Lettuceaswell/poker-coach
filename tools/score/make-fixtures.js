// One-off generator for fixtures/solver-spots.json (ranges = suit-symmetric top-x% by Chen score).
import fs from 'node:fs';
import { chen } from '../../js/cards.js';
const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
const combos = []; for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) combos.push([a, b]);
function top(frac) {
  const sc = combos.map(([a, b], i) => [chen([a, b]) + ((a >> 2) + (b >> 2)) / 100, i]).sort((x, y) => y[0] - x[0]);
  const cut = sc[Math.min(Math.round(frac * 1326), 1325)][0];
  return sc.filter(([s]) => s >= cut).map(([, i]) => [i, 1]);
}
const sp = (name, street, board, pot, stack, f0, f1, sizes) => ({ name, street, board: C(board), boardStr: board, pot, stack, ranges: [top(f0), top(f1)], ...(sizes ? { sizes } : {}) });
const one = { bet: [0.66], raise: [3] };
const out = {
  river: [sp('R1 K96-3-2', 'river', 'Ks9h6d3c2s', 10, 50, 0.35, 0.30), sp('R2 Q85-4-2', 'river', 'Qh8d5c4s2h', 12, 60, 0.35, 0.30), sp('R3 A77-2-J', 'river', 'Ac7d7h2sJc', 20, 80, 0.30, 0.40)],
  turn: [sp('T1 AJ7s-4', 'turn', 'AsJh7s4h', 10, 30, 0.2, 0.18, one), sp('T2 T83-9', 'turn', 'Td8h3c9s', 12, 50, 0.22, 0.20, one)],
  flop: [sp('F1 K96', 'flop', 'Ks9h6d', 10, 40, 0.1, 0.09, one)],
};
fs.writeFileSync(new URL('./fixtures/solver-spots.json', import.meta.url), JSON.stringify(out));
