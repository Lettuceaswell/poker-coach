// Ranges for the postflop coach.
// preflopRanges(): each live player's 169-class weights from the preflop solution,
// following the actions they actually took. estimate(): quick equity-based advice.
import { treeFor, handClass } from './coach.js';
import { POSITIONS } from './preflop-tree.js';
import { evalHand, chen } from './cards.js';

// class index for a concrete two-card combo (same as coach.handClass)
const clsOf = (a, b) => handClass([a, b]);

// all 1326 combos as [c1, c2, class]
export const COMBOS = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push([a, b, clsOf(a, b)]);

// fallback when the preflop line isn't on the tree: rough Chen-score cutoffs
function chenRange(minChen) {
  const w = new Float32Array(169);
  for (const [a, b, c] of COMBOS) w[c] = chen([a, b]) >= minChen ? 1 : 0;
  return w;
}

// Returns Map seat -> Float32Array(169) weights, and quality ('solver' | 'rough').
export function preflopRanges(game, strat) {
  const n = game.players.filter(p => !p.out).length;
  const tree = treeFor(n);
  const labels = game.positions();
  const out = new Map();
  for (let i = 0; i < game.players.length; i++) if (!game.players[i].out) out.set(i, new Float32Array(169).fill(1));
  let node = tree?.nodes[0];
  let rough = !strat || !tree;
  for (const h of game.history) {
    if (h.street !== 'preflop') break;
    if (rough || !node || node.term) { rough = true; break; }
    const p = POSITIONS[n].indexOf(labels[h.seat]);
    if (node.p !== p) { rough = true; break; }
    const want = h.type === 'fold' ? 'f' : h.type === 'raise' ? 'r' : 'c';
    let ai = node.acts.findIndex(x => x.t === want);
    if (ai < 0) {
      // limp / extra caller: their range is unknown to the tree; mark rough and skip as a fold for walking
      const w = out.get(h.seat);
      const fallback = chenRange(want === 'r' ? 9 : 6);
      for (let c = 0; c < 169; c++) w[c] *= fallback[c];
      ai = node.acts.findIndex(x => x.t === (want === 'r' ? 'c' : 'f'));
      if (ai < 0) { rough = true; break; }
      node = tree.nodes[node.acts[ai].next];
      continue;
    }
    const w = out.get(h.seat);
    const off = strat.offsets[node.id], k = node.acts.length;
    for (let c = 0; c < 169; c++) {
      let sum = 0; for (let x = 0; x < k; x++) sum += strat.data[off + c * k + x];
      w[c] *= sum ? strat.data[off + c * k + ai] / sum : 1 / k;
    }
    node = tree.nodes[node.acts[ai].next];
  }
  if (rough) {
    // rebuild everything from simple cutoffs by what each player did preflop
    for (const [seat] of out) {
      const acts = game.history.filter(h => h.street === 'preflop' && h.seat === seat);
      const raised = acts.some(a => a.type === 'raise');
      const called = acts.some(a => a.type === 'call');
      out.set(seat, raised ? chenRange(8) : called ? chenRange(5) : chenRange(-5));
    }
  }
  return { ranges: out, quality: rough ? 'rough' : 'solver' };
}

// Expand 169-class weights to 1326 combo weights, removing dead cards.
export function toCombos(w169, dead) {
  const d = new Set(dead);
  const w = new Float32Array(1326);
  COMBOS.forEach(([a, b, c], i) => { w[i] = d.has(a) || d.has(b) ? 0 : w169[c]; });
  return w;
}

// Draw a combo index from weights (with dead cards excluded by caller via weights).
function draw(w, total, rng) {
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return w.length - 1;
}

// Percentile of a hand's strength on a board vs all other combos (0..1), cached per board.
const strengthCache = new Map();
export function strengthTable(board) {
  const key = board.join(',');
  if (strengthCache.has(key)) return strengthCache.get(key);
  const dead = new Set(board);
  const scores = [];
  COMBOS.forEach(([a, b], i) => { if (!dead.has(a) && !dead.has(b)) scores.push([evalHand([a, b, ...board]), i]); });
  scores.sort((x, y) => x[0] - y[0]);
  const pct = new Float32Array(1326);
  scores.forEach(([, i], k) => { pct[i] = k / (scores.length - 1); });
  if (strengthCache.size > 20) strengthCache.clear();
  strengthCache.set(key, pct);
  return pct;
}

// Narrow a villain's combo weights by what they did on each postflop street so far.
// Bettors/raisers keep mostly strong hands and some bluffs, callers drop the bottom.
export function narrow(game, seat, w) {
  for (const st of ['flop', 'turn', 'river']) {
    const acts = game.history.filter(h => h.street === st && h.seat === seat);
    if (!acts.length) continue;
    const n = st === 'flop' ? 3 : st === 'turn' ? 4 : 5;
    if (game.board.length < n) break;
    const pct = strengthTable(game.board.slice(0, n));
    const aggressive = acts.some(a => a.type === 'raise');
    const called = acts.some(a => a.type === 'call');
    for (let i = 0; i < 1326; i++) {
      if (!w[i]) continue;
      const p = pct[i];
      if (aggressive) w[i] *= p > 0.6 ? 1 : p < 0.15 ? 0.35 : 0.12; // value + some air as bluffs
      else if (called) w[i] *= p > 0.35 ? 1 : p > 0.2 ? 0.4 : 0.08;
    }
  }
  return w;
}

// Monte Carlo equity of hero vs every live villain's narrowed range.
export function equityVsRanges(hero, board, villains, sims = 600, rng = Math.random) {
  const totals = villains.map(w => w.reduce((s, x) => s + x, 0));
  if (totals.some(t => t <= 0)) return null;
  let won = 0, done = 0;
  for (let s = 0; s < sims * 3 && done < sims; s++) {
    const used = new Set([...hero, ...board]);
    const hands = [];
    let clash = false;
    for (let v = 0; v < villains.length; v++) {
      const [a, b] = COMBOS[draw(villains[v], totals[v], rng)];
      if (used.has(a) || used.has(b)) { clash = true; break; }
      used.add(a); used.add(b); hands.push([a, b]);
    }
    if (clash) continue;
    const full = board.slice();
    while (full.length < 5) { const c = Math.floor(rng() * 52); if (!used.has(c)) { used.add(c); full.push(c); } }
    const mine = evalHand([...hero, ...full]);
    let best = true, ties = 1;
    for (const h of hands) {
      const v = evalHand([...h, ...full]);
      if (v > mine) { best = false; break; }
      if (v === mine) ties++;
    }
    if (best) won += 1 / ties;
    done++;
  }
  return done ? won / done : null;
}

// Quick advice from equity vs pot odds. Returns a mix like the solver's.
export function estimate(game, heroSeat, strat) {
  const hero = game.players[heroSeat];
  const { ranges, quality } = preflopRanges(game, strat);
  const dead = [...hero.cards, ...game.board];
  const villains = [];
  game.players.forEach((p, i) => {
    if (i === heroSeat || p.folded || p.out) return;
    villains.push(narrow(game, i, toCombos(ranges.get(i), dead)));
  });
  const eq = equityVsRanges(hero.cards, game.board, villains);
  if (eq === null) return null;
  const L = game.legal();
  const pot = game.totalPot;
  const k = villains.length;
  const base = 1 / (k + 1);
  const mix = [];
  if (L.toCall === 0) {
    const valueT = base + 0.3 * (1 - base);
    const bet = Math.max(L.minTo, Math.round(pot * (eq > 0.8 ? 0.66 : 0.4) / game.sb) * game.sb);
    if (eq >= valueT && L.canRaise) mix.push({ t: 'r', to: Math.min(bet, L.maxTo) / game.bb, freq: 1 });
    else mix.push({ t: 'c', freq: 1 });
  } else {
    const need = L.toCall / (pot + L.toCall);
    const raiseT = base + 0.55 * (1 - base);
    if (eq >= raiseT && L.canRaise) mix.push({ t: 'r', to: Math.min(L.maxTo, Math.max(L.minTo, game.currentBet * 3)) / game.bb, freq: 1 });
    else if (eq >= need) mix.push({ t: 'c', freq: 1 });
    else mix.push({ t: 'f', freq: 1 });
    return { mix, eq, need, villains: k, quality };
  }
  return { mix, eq, need: 0, villains: k, quality };
}
