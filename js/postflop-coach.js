// Live heads-up postflop solving for the coach. One solve per street, run in a Web
// Worker; ranges at the flop come from the preflop solution, later streets inherit the
// previous street's solved ranges along the line that was actually played.
import { comboIndex, comboCards } from './postflop/solver.js';
import { preflopRanges, toCombos, narrow, strengthTable, COMBOS } from './ranges.js';
import { THREEWAY_LIVE_ITERS, THREEWAY_LIVE_MS } from './postflop/solver3.js';
import { handClass } from './coach.js';

let worker = null;
let onUpdate = () => {};
const pendingRanges = new Map();
let rid = 0;
let current = null;   // { id, key, heroSide }
const started = new Map(); // key (hand:street) -> id

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./postflop/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.rid !== undefined) { pendingRanges.get(m.rid)?.(m.ranges !== undefined ? m.ranges : m); pendingRanges.delete(m.rid); return; }
    if (current && m.id === current.id) onUpdate(m, current);
  };
  return worker;
}

export function setUpdateHandler(fn) { onUpdate = fn; }

// ranges.js combo order -> solver combo order
let comboMap = null;
const getMap = () => (comboMap ||= COMBOS.map(([a, b]) => comboIndex(a, b)));
const toSolverOrder = (() => {
  let map = null;
  return (w) => {
    if (!map) map = getMap();
    const out = new Float32Array(1326);
    for (let j = 0; j < 1326; j++) out[map[j]] = w[j];
    return out;
  };
})();

function streetActs(game, street) {
  return game.history.filter(h => h.street === street).map(h => ({
    type: h.type === 'raise' ? 'bet' : h.type,
    amount: h.amount / game.bb,
  }));
}

const PREV = { turn: 'flop', river: 'turn' };
const MAX_MS = { flop: 20000, turn: 30000, river: 8000 };

// Start (or re-point) the live solve for the hero's current decision.
// Returns false when the spot isn't heads-up postflop.
export async function request(game, heroSeat, strat) {
  if (typeof Worker === 'undefined') return false;
  const live = game.players.map((p, i) => i).filter(i => !game.players[i].folded && !game.players[i].out);
  if (live.length !== 2 || game.street === 'preflop') return false;
  const oopSeat = game.next(game.button, (p) => !p.folded && !p.out);
  const ipSeat = live.find(i => i !== oopSeat);
  const heroSide = heroSeat === oopSeat ? 0 : 1;
  const hero = game.players[heroSeat];
  const heroCombo = comboIndex(hero.cards[0], hero.cards[1]);
  const key = `${game.handNo}:${game.street}`;
  const acts = streetActs(game, game.street);
  ensureWorker();

  if (started.has(key)) {
    current = { id: started.get(key), key, heroSide };
    worker.postMessage({ cmd: 'watch', id: current.id, hands: [heroCombo], acts });
    return true;
  }

  const id = `${key}:${Date.now()}`;
  started.set(key, id);
  current = { id, key, heroSide, starting: true };

  // ranges at the start of this street
  let ranges = null;
  const prev = PREV[game.street];
  if (prev && started.has(`${game.handNo}:${prev}`)) {
    const r = ++rid;
    ranges = await new Promise(res => {
      pendingRanges.set(r, res);
      worker.postMessage({ cmd: 'ranges', id: started.get(`${game.handNo}:${prev}`), rid: r, acts: streetActs(game, prev) });
      setTimeout(() => { if (pendingRanges.has(r)) { pendingRanges.delete(r); res(null); } }, 3000);
    });
  }
  let source = 'solver';
  if (!ranges) {
    const { ranges: pre, quality } = preflopRanges(game, strat);
    source = quality === 'solver' ? (prev ? 'narrowed' : 'solver') : 'rough';
    ranges = [oopSeat, ipSeat].map(seat => {
      let w = toCombos(pre.get(seat), game.board);
      if (prev) w = narrow(game, seat, w); // no previous solve: heuristic narrowing
      return toSolverOrder(w);
    });
  } else {
    ranges = ranges.map(w => Float32Array.from(w));
  }
  // drop near-zero weights: they barely change the answer but slow the solve a lot
  for (const w of ranges) for (let i = 0; i < 1326; i++) if (w[i] < 0.02) w[i] = 0;
  // the hero's own hand must be in their range for the solver to report it
  const hr = ranges[heroSide];
  if (!(hr[heroCombo] > 0.02)) hr[heroCombo] = 0.02;
  // card removal of the new board card(s)
  const dead = new Set(game.board);
  for (const w of ranges) for (let i = 0; i < 1326; i++) { const [a, b] = comboCards(i); if (dead.has(a) || dead.has(b)) w[i] = 0; }

  const bb = game.bb;
  const pot = game.pot / bb; // excludes this street's bets
  const stack = Math.min(...[oopSeat, ipSeat].map(i => game.players[i].stack + game.players[i].bet)) / bb;
  // flop/turn: one bet size (66%) + 3x raise + all-in solves ~4x faster on a phone;
  // river keeps the full menu (33%/75%/all-in) since it solves in well under a second
  const sizes = game.street === 'river' ? undefined : { bet: [0.66], raise: [3], allin: true, maxBets: 3, allinThreshold: 0.67 };
  const input = {
    board: game.board.slice(), pot, stack, ranges, sizes,
    maxMs: MAX_MS[game.street], targetExploit: 0.3,
  };
  if (current.id !== id) return true; // superseded while waiting
  current.source = source;
  worker.postMessage({ cmd: 'solve', id, input, hands: [heroCombo], acts });
  return true;
}

export function stopAll() {
  if (worker && current) worker.postMessage({ cmd: 'stop', id: current.id });
  current = null;
}

export function forgetHand(handNo) {
  for (const k of [...started.keys()]) if (!k.startsWith(handNo + ':')) started.delete(k);
}

// Full detail for the hero's current node: every combo's strategy, both ranges, and the
// value of each action for the hero's hand. Resolves null if no solve is running.
export function detail(game, heroSeat) {
  if (!worker || !current) return Promise.resolve(null);
  const key = `${game.handNo}:${game.street}`;
  if (!started.has(key)) return Promise.resolve(null);
  const hero = game.players[heroSeat];
  const r = ++rid;
  return new Promise(res => {
    pendingRanges.set(r, (m) => {
      if (!m || m.error) return res(null);
      if (m.player !== current.heroSide) return res(null);
      res({ actions: m.actions, probs: m.probs, range: m.range, oppRange: m.oppRange, values: m.values, toSolver: getMap() });
    });
    worker.postMessage({ cmd: 'detail', id: started.get(key), rid: r, acts: streetActs(game, game.street), hero: comboIndex(hero.cards[0], hero.cards[1]) });
    setTimeout(() => { if (pendingRanges.has(r)) { pendingRanges.delete(r); res(null); } }, 4000);
  });
}

// ---------------------------------------------------------------------------------------------
// Live three-way river (VAL-3WAY-004): exactly three players reach the river -> the three-player
// CFR+ solve (js/postflop/solver3.js, worker3.js) coaches the hero instead of the equity estimate.
// Ranges: preflop solution -> narrowed along the flop/turn/river actions -> pruned of tiny weights
// -> thinned to at most CAP3 combos per player (keeps phone solves near 6 s). Time budget in ms.
export const CAP3 = 150;
export const budget3 = { iters: THREEWAY_LIVE_ITERS, ms: THREEWAY_LIVE_MS }; // tests may shrink it to force a timeout
const cache3 = new Map();   // key (hand:river:actionsSoFar) -> { state, ... }
let worker3 = null;
let onUpdate3 = () => {};
export function setUpdateHandler3(fn) { onUpdate3 = fn; }
export const lastThree = { dump: null, rec: null }; // ranges handed to the solver for the latest 3-way river spot

function ensureWorker3() {
  if (worker3) return worker3;
  worker3 = new Worker(new URL('./postflop/worker3.js', import.meta.url), { type: 'module' });
  worker3.onmessage = (e) => {
    const m = e.data;
    const rec = [...cache3.values()].find(r => r.id === m.id);
    if (!rec || rec.state !== 'pending') return;
    finish3(rec, m);
  };
  worker3.onerror = () => { for (const r of cache3.values()) if (r.state === 'pending') finish3(r, { status: 'error', error: 'worker failed' }); };
  return worker3;
}
function finish3(rec, m) {
  clearTimeout(rec.timer);
  rec.state = m.status === 'done' ? 'done' : m.status === 'timeout' ? 'timeout' : 'error';
  rec.iters = m.iters; rec.ms = m.ms; rec.mix = m.mix || null; rec.error = m.error || null;
  lastThree.rec = rec;
  onUpdate3(rec);
}

// Solver seats in acting order (first live seat after the button, then clockwise).
function seatsOrder(game) {
  const s0 = game.next(game.button, (p) => !p.folded && !p.out);
  const s1 = game.next(s0, (p) => !p.folded && !p.out);
  return [s0, s1, game.next(s1, (p) => !p.folded && !p.out)];
}
// True when the hero's decision is a three-way river the solver models (three in, nobody folded or all-in yet).
export function isThreeWayRiver(game) {
  if (game.street !== 'river' || game.board.length !== 5) return false;
  const live = game.players.filter(p => !p.folded && !p.out);
  if (live.length !== 3 || live.some(p => p.allIn)) return false;
  return !game.history.some(h => h.street === 'river' && h.type === 'fold');
}

/** The three ranges (1326 combos each, solver order) for the current three-way river spot, plus a dump of how
 *  they narrowed: combos after the preflop solution, after narrowing/pruning, and what the solver gets. */
export function threewayRanges(game, heroSeat, strat) {
  const order = seatsOrder(game);
  const hero = game.players[heroSeat];
  const heroCombo = comboIndex(hero.cards[0], hero.cards[1]);
  const map = getMap();
  const heroJ = map.indexOf(heroCombo);
  const { ranges: pre, quality } = preflopRanges(game, strat);
  const pct = strengthTable(game.board);
  const ranges = [], dump = [];
  for (const seat of order) {
    const w0 = toCombos(pre.get(seat), game.board); // board cards removed only: his own cards stay in his range
    const preflopCombos = w0.reduce((n, x) => n + (x > 0 ? 1 : 0), 0);
    const w = narrow(game, seat, Float32Array.from(w0));
    let mx = 0; for (let j = 0; j < 1326; j++) if (w[j] > mx) mx = w[j];
    for (let j = 0; j < 1326; j++) if (w[j] < 0.1 * mx) w[j] = 0; // tiny weights barely matter and cost solve time
    if (seat === heroSeat && !(w[heroJ] > 0)) w[heroJ] = 0.1 * mx;
    const narrowed = w.reduce((n, x) => n + (x > 0 ? 1 : 0), 0);
    const mass = w.reduce((a, x) => a + x, 0);
    const keep = [];
    for (let j = 0; j < 1326; j++) if (w[j] > 0) keep.push(j);
    if (keep.length > CAP3) { // thin evenly along hand strength (unbiased: every strength band keeps its share)
      keep.sort((a, b) => pct[a] - pct[b]);
      const cap = seat === heroSeat ? CAP3 - 1 : CAP3; // the hero's own hand always stays in his range
      const k = keep.length / cap, kept = new Set();
      for (let i = 0; i < cap; i++) kept.add(keep[Math.floor(i * k)]);
      if (seat === heroSeat) kept.add(heroJ);
      for (const j of keep) if (!kept.has(j)) w[j] = 0;
    }
    const solver = w.reduce((n, x) => n + (x > 0 ? 1 : 0), 0);
    ranges.push(toSolverOrder(w));
    dump.push({ seat, pos: game.positions()[seat], hero: seat === heroSeat, preflopCombos, narrowedCombos: narrowed, solverCombos: solver, preflopMass: +w0.reduce((a, x) => a + x, 0).toFixed(1), narrowedMass: +mass.toFixed(1) });
  }
  return { order, ranges, heroCombo, dump, quality };
}

/** Look up / start the three-way river solve for the hero's current decision. Returns the cache record
 *  { state: 'pending' | 'done' | 'timeout' | 'error', mix?, iters, ms, dump } or null when this spot is not
 *  a modelled three-way river (the caller keeps the labeled estimate). */
export function request3(game, heroSeat, strat) {
  if (typeof Worker === 'undefined' || !isThreeWayRiver(game)) return null;
  const riverActs = game.history.filter(h => h.street === 'river');
  const key = `${game.handNo}:river:${riverActs.length}`;
  if (cache3.has(key)) return cache3.get(key);
  for (const k of [...cache3.keys()]) if (!k.startsWith(game.handNo + ':')) cache3.delete(k);
  const { order, ranges, heroCombo, dump, quality } = threewayRanges(game, heroSeat, strat);
  const bb = game.bb;
  const acts = riverActs.map(h => ({ p: order.indexOf(h.seat), type: h.type === 'raise' ? 'bet' : h.type, amount: h.amount / bb }));
  const spec = {
    board: game.board.slice(), pot: game.pot / bb, // excludes this street's bets
    stack: Math.min(...order.map(i => game.players[i].stack + game.players[i].bet)) / bb, ranges,
  };
  const rec = { id: `${key}:${Date.now()}`, key, state: 'pending', dump, quality, hero: order.indexOf(heroSeat), acts, budget: { ...budget3 }, iters: 0, ms: 0, mix: null };
  cache3.set(key, rec);
  lastThree.dump = { hand: game.handNo, board: game.board.slice(), pot: spec.pot, stack: spec.stack, budgetMs: budget3.ms, iters: budget3.iters, acts, players: dump }; lastThree.rec = rec;
  ensureWorker3();
  rec.timer = setTimeout(() => { if (rec.state === 'pending') finish3(rec, { status: 'timeout', iters: 0, ms: budget3.ms }); }, budget3.ms + 4000);
  worker3.postMessage({ id: rec.id, spec, acts, hero: rec.hero, heroCombo, iters: budget3.iters, maxMs: budget3.ms });
  return rec;
}
