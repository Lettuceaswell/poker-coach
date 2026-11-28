// Deterministic regression for the live-detail flake (VAL-FLAKE-001):
// after exactly one iteration, actionValues for AhKh on the OOP check line
// must be non-null. Run: node tools/postflop-regress.js
import { chen } from '../js/cards.js';
import { createSolver, comboIndex, comboCards, NUM_COMBOS } from '../js/postflop/solver.js';

const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
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
let fails = 0;
const hero = comboIndex(...C('AhKh'));
for (const iters of [1, 2, 3]) {
  const s = createSolver({ board: C('Qh8d5c4s'), pot: 10, stack: 50, ranges: [topRange(0.3), topRange(0.3)] });
  s.step(iters);
  const acts = s.actionsAt ? s.actionsAt([]) : null;
  const ci = acts.findIndex(a => a.type === 'check');
  const v = s.actionValues([ci], hero);
  const ok = Array.isArray(v) && v.every(Number.isFinite);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${iters} iteration(s): AhKh values after OOP check = ${v && v.map(x => x.toFixed(3)).join('/')}`);
  if (!ok) fails++;
}
process.exit(fails ? 1 : 0);
