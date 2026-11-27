// Live heads-up postflop solving for the coach. One solve per street, run in a Web
// Worker; ranges at the flop come from the preflop solution, later streets inherit the
// previous street's solved ranges along the line that was actually played.
import { comboIndex, comboCards } from './postflop/solver.js';
import { preflopRanges, toCombos, narrow, COMBOS } from './ranges.js';
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
