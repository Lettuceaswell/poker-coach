// Lab core: range text -> combo weights, fixed-iteration root solve (deterministic), mix formatting.
// Runs the existing postflop solver (js/postflop/solver.js); no constants stand in for results.
import { createSolver, comboIndex } from './postflop/solver.js';

const RK = '23456789TJQKA';
export function parseRange(text, dead = []) {
  const w = new Float32Array(1326); const d = new Set(dead);
  const add = (r1, r2, kind) => { // kind: 'p' pair, 's', 'o'
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) {
      if (kind === 'p' ? !(r1 === r2 && s1 < s2) : (r1 === r2)) continue;
      if (kind === 's' && s1 !== s2) continue; if (kind === 'o' && s1 === s2) continue;
      const a = r1 * 4 + s1, b = r2 * 4 + s2; if (d.has(a) || d.has(b)) continue;
      const i = comboIndex(a, b); if (i >= 0) w[i] = 1;
    }
  };
  const addClass = (hi, lo, suit) => { if (hi === lo) add(hi, lo, 'p'); else { if (suit !== 'o') add(hi, lo, 's'); if (suit !== 's') add(hi, lo, 'o'); } };
  for (const tok of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const m = tok.toUpperCase().match(/^([2-9TJQKA])([2-9TJQKA])([SO]?)(\+?)(?:-([2-9TJQKA])([2-9TJQKA])([SO]?))?$/);
    if (!m) continue;
    let a = RK.indexOf(m[1]), b = RK.indexOf(m[2]); const suit = (m[3] || m[7] || '').toLowerCase();
    if (a < b) [a, b] = [b, a];
    if (a === b) { // pairs
      let lo = a, hi = a;
      if (m[4]) hi = 12; else if (m[5]) { const e = RK.indexOf(m[5]); lo = Math.min(a, e); hi = Math.max(a, e); }
      for (let r = lo; r <= hi; r++) addClass(r, r, '');
    } else {
      if (m[4]) for (let l = b; l < a; l++) addClass(a, l, suit);
      else if (m[5]) { const e = RK.indexOf(m[6]); for (let l = Math.min(b, e); l <= Math.max(b, e); l++) addClass(a, l, suit); }
      else addClass(a, b, suit);
    }
  }
  return w;
}
export const cardsOf = (s) => (String(s).replace(/\s+/g, '').match(/[2-9TJQKA][shdc]/gi) || []).map(x => RK.indexOf(x[0].toUpperCase()) * 4 + 'shdc'.indexOf(x[1].toLowerCase()));

const NAME = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'AllIn' };
// Solve with a fixed iteration count (same inputs -> same numbers), return the acting player's range-weighted root mix.
export function rootMix(input, iters = 600) {
  const solver = createSolver(input);
  solver.step(iters);
  const actions = solver.actionsAt([]);
  const info = solver.nodeInfo([]); const pl = info.player;
  const tot = new Float64Array(actions.length); let wsum = 0;
  const w = input.ranges[pl];
  for (let h = 0; h < 1326; h++) {
    if (!(w[h] > 0)) continue;
    const p = solver.strategyAt([], h); if (!p) continue;
    for (let a = 0; a < actions.length; a++) tot[a] += w[h] * p[a];
    wsum += w[h];
  }
  const byName = new Map();
  actions.forEach((a, i) => byName.set(NAME[a.type] || a.type, (byName.get(NAME[a.type] || a.type) || 0) + tot[i] / (wsum || 1)));
  return { player: pl, mix: roundMix([...byName]), iters, combos: [...w].filter(x => x > 0).length };
}
// integer percents summing to exactly 100 (largest remainder)
export function roundMix(pairs) {
  const s = pairs.reduce((t, [, v]) => t + v, 0) || 1;
  const q = pairs.map(([n, v]) => [n, 100 * v / s]);
  const fl = q.map(([n, v]) => [n, Math.floor(v), v - Math.floor(v)]);
  let rest = 100 - fl.reduce((t, x) => t + x[1], 0);
  [...fl].sort((a, b) => b[2] - a[2]).slice(0, rest).forEach(x => { x[1]++; });
  return fl.map(([n, v]) => [n, v]);
}
export const mixLine = (label, mix) => `${label}: ${mix.map(([n, v]) => `${n} ${v}%`).join('  ')}`;
