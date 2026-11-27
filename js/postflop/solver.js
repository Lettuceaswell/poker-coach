// Heads-up postflop solver: range-vs-range Discounted CFR (alpha 1.5, beta 0,
// gamma 2), vectorised over hole-card combos. Plain ES module, no
// dependencies; runs in a Web Worker or in Node.
//
// Conventions
//  * Cards are ints 0..51 (rank = c >> 2, suit = c & 3), as in js/cards.js.
//  * Combos use a fixed 1326 ordering: comboIndex(a, b) with a < b runs
//    lexicographically (0,1), (0,2) .. (0,51), (1,2) .. (50,51).
//  * Player 0 = OOP, player 1 = IP.
//  * `pot` is the pot before this street's bets; `stack` is the effective
//    stack at the start of this street (before `start.bets`). All amounts are
//    in BB. An action's `amount` is that player's total put in on this street.
//  * Payoffs are zero-sum: each player owns half of the starting pot, so a
//    terminal is worth +X to the winner and -X to the loser.
//  * Exploitability is (BR_oop + BR_ip) / 2, as a percentage of the pot at
//    the solve root (pot + start bets).
//
// Card removal
//  * Each player keeps a pruned combo list: positive weight and no board card.
//    Regrets and strategy sums are stored only for the acting player's list.
//  * Chance nodes zero the opponent's reach for combos holding the dealt card
//    and zero our own values for them.
//  * Fold terminals use per-card reach sums with the same-combo add-back.
//  * Showdowns are O(n) per terminal over strength-sorted lists precomputed
//    per final board, with per-card prefix sums for card removal (the
//    approach of b-inary/postflop-solver); only strictly weaker / stronger
//    hands count, so ties pay 0 and no add-back is needed.
//  * Exact all-in runouts and depth-limited leaves use a per-turn-board
//    matrix M[oop][ip] = sum over river cards of sign(strength difference),
//    zero for pairs that share a card, scaled by 1 / (rivers per hand pair).
//    Flop all-ins sum the turn matrices over every turn card.
//
// Streets
//  * River: full solve. Turn: turn betting, every river card a chance node,
//    full river betting. Flop (default depthLimited: true): flop and turn
//    betting with turn chance nodes; a street close on the turn is a leaf
//    worth its showdown equity averaged over all river cards (no river
//    betting). depthLimited: false builds turn and river betting too; only
//    coarse abstractions fit in memory (see tools/postflop-test.js).
//  * Depth-limited leaves cost an n x n matrix product each (~8k leaves per
//    pass), so by default CFR passes estimate them instead: each pass walks
//    `leafSamples` (default 1) river-card orbits per turn board, in a fixed
//    rotation, with O(n) showdowns and an unbiased card-removal scale. Flop
//    all-ins likewise sample `allinSamples` (default 4) turn+river orbits.
//    exploitability(), evs() and bestResponseValues() always use the exact
//    leaves (the matrices are built on first use). leafSamples: 0 makes CFR
//    exact too (about 5x slower per iteration at 40% ranges).
//  * sampleChance: K (optional, off by default) samples K representative
//    cards per iteration at the first chance level instead of all of them.
//
// Suit isomorphism
//  * If a suit permutation maps the board onto itself and leaves both input
//    ranges unchanged, chance cards in one orbit share a single subtree, and
//    the other cards' values are the representative's values with combos
//    permuted (the approach b-inary uses). It is exact for symmetric inputs.

import { scoreHands } from './eval7.js';

// ---------------------------------------------------------------- combos ---

export const NUM_COMBOS = 1326;
const CC1 = new Uint8Array(NUM_COMBOS);
const CC2 = new Uint8Array(NUM_COMBOS);
const CIDX = new Int16Array(52 * 52).fill(-1);
{
  let k = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      CC1[k] = a; CC2[k] = b; CIDX[a * 52 + b] = k; CIDX[b * 52 + a] = k; k++;
    }
  }
}

/** Index 0..1325 of the unordered pair (c1, c2); -1 if c1 === c2. */
export function comboIndex(c1, c2) { return CIDX[c1 * 52 + c2]; }
/** [low card, high card] of combo i. */
export function comboCards(i) { return [CC1[i], CC2[i]]; }

// ---------------------------------------------------------------- config ---

export const DEFAULT_SIZES = Object.freeze({
  bet: [0.33, 0.75], // pot fractions when not facing a bet
  raise: [3], // multiples of the facing bet (raise to 3x)
  allin: true, // offer all-in at every decision that can bet or raise
  maxBets: 3, // bets + raises allowed per street
  allinThreshold: 0.67, // a size putting in more than this share of the
  // remaining stack becomes all-in
});

const ACT = 0, FOLD = 1, SHOW = 2, CHANCE = 3, EQ = 4;
const ALPHA = 1.5, BETA = 0, GAMMA = 2; // DCFR parameters
const EPS = 1e-9;
const CHUNK_FLOATS = 4 << 20; // 16 MB Float32 chunks (iOS dislikes huge buffers)

// All 24 suit permutations; index 0 is the identity.
const PERMS = [];
(function gen(cur, used) {
  if (cur.length === 4) { PERMS.push(cur.slice()); return; }
  for (let s = 0; s < 4; s++) {
    if (!used[s]) { used[s] = true; cur.push(s); gen(cur, used); cur.pop(); used[s] = false; }
  }
})([], [false, false, false, false]);
const permCard = (perm, c) => (c & ~3) | perm[c & 3];
const permCombo = (perm, i) => CIDX[permCard(perm, CC1[i]) * 52 + permCard(perm, CC2[i])];
const PERM_INV = PERMS.map(p => {
  const inv = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) inv[p[s]] = s;
  return PERMS.findIndex(q => q.every((v, i) => v === inv[i]));
});
const PERM_MUL = PERMS.map(a => PERMS.map(b => { // index of a∘b (apply b, then a)
  const c = [0, 1, 2, 3].map(s => a[b[s]]);
  return PERMS.findIndex(q => q.every((v, i) => v === c[i]));
}));

class Node {
  constructor(t) {
    this.t = t;
    this.player = -1; // ACT: player to act
    this.actions = null; // ACT: [{ type, amount }]
    this.kids = null; // ACT / CHANCE children
    this.reg = null; // ACT: Float32Array nAct * n[player], action-major
    this.sum = null; // ACT: cumulative strategy, same layout
    this.amt = 0; // terminals: amount won/lost
    this.folder = -1; // FOLD
    this.sd = null; // SHOW: strength-sorted lists for the final board
    this.mat = null; // EQ: runout matrix { M, scale }
    this.reps = null; // CHANCE: representative cards
    this.orbits = null; // CHANCE: per rep, list of perm indices (identity first)
    this.cardRep = null; // CHANCE: card -> [rep slot, perm index]
    this.weight = 0; // CHANCE: 1 / (deck - 4)
    this.mult = 1; // count-only builds: copies this node stands for
    this.lastT = -1; // ACT: last iteration whose regret update touched it
    this.flopRunout = false; // EQ: all-in on the flop (turn + river to come)
    this.sampled = false; // CHANCE: first chance level, eligible for sampling
    this.board = null;
    this.pot = 0; this.stack = 0; this.puts = null; this.nBets = 0;
  }
}

// ---------------------------------------------------------------- solver ---

/**
 * Create a solver. See the header comment for units and conventions.
 * input = { board, pot, stack, ranges: [Float32Array(1326) oop, ip],
 *   start?: { bets: [oopPut, ipPut], toAct, nBets? }, sizes?, depthLimited?,
 *   isomorphism? (default true), maxMemoryBytes? (default 500 MB, counting
 *   exploitMemoryBytes),
 *   leafSamples? (default 1), allinSamples? (default 4), sampleChance? }
 * start.nBets (bets + raises already made this street, toward the cap)
 * defaults to 0 with no bets, 1 with one bet, 2 when both have put chips in.
 */
export function createSolver(input) {
  const ctx = setup(input, false);
  allocate(ctx);
  return makeApi(ctx);
}

/** Size a solve without allocating it: { memoryBytes, actNodes, ... }. */
export function estimateSolve(input) {
  const ctx = setup(input, true);
  return { ...ctx.stats, depthLimited: ctx.depthLimited, combos: [ctx.n[0], ctx.n[1]] };
}

function setup(input, countOnly) {
  const board = Array.from(input.board);
  if (board.length < 3 || board.length > 5) throw new Error('board must have 3-5 cards');
  if (new Set(board).size !== board.length) throw new Error('duplicate board card');
  const sizes = { ...DEFAULT_SIZES, ...(input.sizes || {}) };
  const pot = +input.pot, stack = +input.stack;
  if (!(pot > 0) || !(stack >= 0)) throw new Error('bad pot/stack');
  const depthLimited = board.length === 3 ? input.depthLimited !== false : false;

  const boardMask = new Uint8Array(52);
  for (const c of board) boardMask[c] = 1;

  // Pruned per-player combo lists.
  const lists = [0, 1].map(p => {
    const w = input.ranges[p];
    const ids = [];
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (w[i] > 0 && !boardMask[CC1[i]] && !boardMask[CC2[i]]) ids.push(i);
    }
    if (!ids.length) throw new Error(`player ${p} range is empty on this board`);
    const n = ids.length;
    const L = {
      n, ids: Int32Array.from(ids), c1: new Uint8Array(n), c2: new Uint8Array(n),
      w: new Float64Array(n), local: new Int32Array(NUM_COMBOS).fill(-1),
      cardCombos: Array.from({ length: 52 }, () => []),
    };
    for (let h = 0; h < n; h++) {
      const i = ids[h];
      L.c1[h] = CC1[i]; L.c2[h] = CC2[i]; L.w[h] = w[i]; L.local[i] = h;
      L.cardCombos[CC1[i]].push(h); L.cardCombos[CC2[i]].push(h);
    }
    L.cardCombos = L.cardCombos.map(a => Int32Array.from(a));
    L.cardOff = new Int32Array(53);
    for (let c = 0; c < 52; c++) L.cardOff[c + 1] = L.cardOff[c] + L.cardCombos[c].length;
    L.cardFlat = new Int32Array(L.cardOff[52]);
    for (let c = 0; c < 52; c++) L.cardFlat.set(L.cardCombos[c], L.cardOff[c]);
    return L;
  });
  for (let p = 0; p < 2; p++) {
    const L = lists[p], O = lists[1 - p];
    L.same = new Int32Array(L.n);
    for (let h = 0; h < L.n; h++) L.same[h] = O.local[L.ids[h]];
  }

  // Suit permutations that fix the board and both ranges.
  const rootPerms = [0];
  if (input.isomorphism !== false) {
    for (let g = 1; g < 24; g++) {
      const perm = PERMS[g];
      if (!board.every(c => boardMask[permCard(perm, c)])) continue;
      let ok = true;
      for (let p = 0; p < 2 && ok; p++) {
        const w = input.ranges[p], L = lists[p];
        for (let h = 0; h < L.n && ok; h++) {
          const j = permCombo(perm, L.ids[h]);
          if (L.local[j] < 0 || Math.abs(w[j] - L.w[h]) > 1e-6) ok = false;
        }
      }
      if (ok) rootPerms.push(g);
    }
  }
  // Local-index maps per permutation: F[g][p][h] = local index of g(h).
  const permMaps = new Array(24).fill(null);
  for (const g of rootPerms) {
    permMaps[g] = lists.map(L => {
      const F = new Int32Array(L.n);
      for (let h = 0; h < L.n; h++) F[h] = L.local[permCombo(PERMS[g], L.ids[h])];
      return F;
    });
  }

  // Start state.
  const st = input.start || {};
  const bets = st.bets ? [+st.bets[0] || 0, +st.bets[1] || 0] : [0, 0];
  let toAct = st.toAct ?? (bets[0] > bets[1] ? 1 : 0);
  if (bets[0] !== bets[1] && bets[toAct] > bets[1 - toAct]) toAct = 1 - toAct;
  const nBets = st.nBets ?? (Math.max(...bets) === 0 ? 0 : Math.min(...bets) > 0 ? 2 : 1);
  const checks = (bets[0] === 0 && bets[1] === 0 && toAct === 1) ? 1 : 0;
  if (Math.max(...bets) > stack + EPS) throw new Error('start bets exceed stack');

  const ctx = {
    leafK: depthLimited ? Math.max(0, Math.floor(input.leafSamples ?? 1)) : 0,
    allinK: Math.max(1, Math.floor(input.allinSamples ?? 4)),
    planCache: new Map(),
    input, board, boardMask, sizes, pot, stack, depthLimited, lists,
    n: [lists[0].n, lists[1].n], rootPerms, permMaps, countOnly,
    rootStreet: board.length, rootPot: pot + bets[0] + bets[1],
    sdCache: new Map(), matCache: new Map(), permCache: new Map(),
    stats: null, root: null, maxDepth: 0, maxA: 2,
  };
  ctx.root = buildStreet(ctx, board, pot, stack, bets, toAct, nBets, checks, 0);
  // Chance sampling setup (first chance level; see evalChance).
  ctx.logAlpha = [];
  ctx.sampleK = 0; ctx.sampleOn = false;
  if (board.length < 5) {
    const R = chanceStructure(ctx, board).reps.length;
    const K = Math.floor(input.sampleChance ?? 0);
    if (K > 0 && K < R) {
      ctx.sampleK = K;
      ctx.sampleMask = new Uint8Array(R);
      ctx.sampleScale = R / K;
      // Fixed pseudo-random rotation so every card is visited once per cycle.
      const order = Array.from({ length: R }, (_, i) => i);
      let seed = 12345;
      for (let i = R - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const j = seed % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      ctx.sampleOrder = order;
    }
  }
  ctx.stats = countStats(ctx);
  // The cap counts the matrices exploitability() adds on depth-limited flops.
  const limit = input.maxMemoryBytes ?? 500e6;
  const need = ctx.stats.memoryBytes + ctx.stats.exploitExtraBytes;
  if (!countOnly && need > limit) {
    throw new Error(`solve needs ~${(need / 1e6).toFixed(0)} MB, over the ${(limit / 1e6).toFixed(0)} MB limit`);
  }
  return ctx;
}

// ------------------------------------------------------------ tree build ---

function genActions(ctx, P, stack, puts, me, nBets) {
  const S = ctx.sizes;
  const my = puts[me], opp = puts[1 - me];
  const remaining = stack - my;
  const acts = [];
  const add = (type, amount) => {
    if (acts.some(a => Math.abs(a.amount - amount) < 1e-6 && a.type !== 'fold')) return;
    acts.push({ type, amount });
  };
  const sized = to => (to >= stack - EPS || to - my > S.allinThreshold * remaining) ? stack : to;
  if (opp > my + EPS) {
    acts.push({ type: 'fold', amount: my });
    acts.push({ type: 'call', amount: opp });
    if (opp < stack - EPS && nBets < S.maxBets) {
      const raises = [];
      // Raise to m x the facing bet, never below a legal min-raise.
      for (const m of S.raise) raises.push(sized(Math.max(m * opp, 2 * opp - my)));
      if (S.allin) raises.push(stack);
      for (const to of raises.sort((a, b) => a - b)) add(to >= stack - EPS ? 'allin' : 'raise', to);
    }
  } else {
    acts.push({ type: 'check', amount: my });
    if (remaining > EPS && nBets < S.maxBets) {
      const potNow = P + puts[0] + puts[1];
      const list = [];
      for (const f of S.bet) list.push(sized(my + Math.max(f * potNow, 1)));
      if (S.allin) list.push(stack);
      for (const to of list.sort((a, b) => a - b)) add(to >= stack - EPS ? 'allin' : 'bet', to);
    }
  }
  return acts;
}

function buildStreet(ctx, board, P, stack, puts, toAct, nBets, checks, depth) {
  const node = new Node(ACT);
  node.player = toAct; node.board = board; node.pot = P; node.stack = stack;
  node.puts = puts.slice(); node.nBets = nBets;
  node.actions = genActions(ctx, P, stack, puts, toAct, nBets);
  ctx.maxA = Math.max(ctx.maxA, node.actions.length);
  ctx.maxDepth = Math.max(ctx.maxDepth, depth + 1);
  const me = toAct, op = 1 - me;
  node.kids = node.actions.map(a => {
    switch (a.type) {
      case 'fold': {
        const f = new Node(FOLD); f.folder = me; f.amt = P / 2 + puts[me]; return f;
      }
      case 'check':
        return checks >= 1
          ? closeStreet(ctx, board, P, stack, puts[me], depth + 1)
          : buildStreet(ctx, board, P, stack, puts, op, nBets, 1, depth + 1);
      case 'call':
        return closeStreet(ctx, board, P, stack, puts[op], depth + 1);
      default: {
        const np = puts.slice(); np[me] = a.amount;
        return buildStreet(ctx, board, P, stack, np, op, nBets + 1, 0, depth + 1);
      }
    }
  });
  return node;
}

function closeStreet(ctx, board, P, stack, matched, depth) {
  const P2 = P + 2 * matched, s2 = stack - matched;
  ctx.maxDepth = Math.max(ctx.maxDepth, depth + 1);
  if (board.length === 5) {
    const t = new Node(SHOW); t.amt = P2 / 2; t.board = board;
    if (!ctx.countOnly) t.sd = getShowdown(ctx, board);
    return t;
  }
  if (s2 <= EPS || (ctx.depthLimited && board.length === 4)) {
    const t = new Node(EQ); t.amt = P2 / 2; t.board = board;
    t.flopRunout = board.length === 3; // evaluated through the turn matrices
    // Turn matrices are built lazily on first use (see evalMatrix). With
    // sampled leaves, CFR passes walk a rotating set of runouts instead.
    if (ctx.leafK > 0) t.plan = runoutPlan(ctx, board);
    return t;
  }
  return buildChance(ctx, board, P2, s2, depth);
}

// Chance cards after `board`, grouped into suit-isomorphism orbits:
// reps[slot] is the smallest card of each orbit, orbits[slot] lists perm
// indices g with g(rep) covering the orbit once (identity first), and
// cardRep[card] = [slot, g].
function chanceStructure(ctx, board) {
  const key = board.join(',');
  const hit = ctx.permCache.get(key);
  if (hit) return hit;
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;
  const perms = ctx.rootPerms.filter(g => board.every(c => onBoard[permCard(PERMS[g], c)]));
  const reps = [], orbits = [], cardRep = new Array(52).fill(null);
  for (let c = 0; c < 52; c++) {
    if (onBoard[c] || cardRep[c]) continue;
    const slot = reps.length;
    reps.push(c);
    const orbit = [];
    for (const g of perms) {
      const d = permCard(PERMS[g], c);
      if (!cardRep[d]) { cardRep[d] = [slot, g]; orbit.push(g); }
    }
    orbits.push(Int32Array.from(orbit));
  }
  const cs = { reps, orbits, cardRep };
  ctx.permCache.set(key, cs);
  return cs;
}

function buildChance(ctx, board, P, stack, depth) {
  const node = new Node(CHANCE);
  node.board = board; node.pot = P; node.stack = stack;
  node.weight = 1 / (52 - board.length - 4);
  node.sampled = board.length === ctx.rootStreet;
  const cs = chanceStructure(ctx, board);
  node.reps = cs.reps; node.orbits = cs.orbits; node.cardRep = cs.cardRep;
  node.kids = [];
  const nKids = ctx.countOnly ? 1 : node.reps.length;
  for (let k = 0; k < nKids; k++) {
    node.kids.push(buildStreet(ctx, [...board, node.reps[k]], P, stack, [0, 0], 0, 0, 0, depth + 1));
  }
  if (ctx.countOnly) node.mult = node.reps.length;
  return node;
}

// Strength-sorted lists of each player's combos that survive `board`.
function getShowdown(ctx, board) {
  const key = [...board].sort((a, b) => a - b).join(',');
  let sd = ctx.sdCache.get(key);
  if (sd) return sd;
  const on = new Uint8Array(52);
  for (const c of board) on[c] = 1;
  sd = ctx.lists.map(L => {
    const str = new Int32Array(L.n);
    scoreHands(board, L.c1, L.c2, L.n, str);
    const idx = [];
    for (let h = 0; h < L.n; h++) if (!on[L.c1[h]] && !on[L.c2[h]]) idx.push(h);
    idx.sort((a, b) => str[a] - str[b]);
    const m = idx.length;
    const o = { len: m, idx: Int32Array.from(idx), str: new Int32Array(m), c1: new Uint8Array(m), c2: new Uint8Array(m) };
    for (let i = 0; i < m; i++) {
      const h = idx[i]; o.str[i] = str[h]; o.c1[i] = L.c1[h]; o.c2[i] = L.c2[h];
    }
    return o;
  });
  sd.query = [buildQuery(sd[0], sd[1]), buildQuery(sd[1], sd[0])];
  ctx.sdCache.set(key, sd);
  return sd;
}

// Runout matrix for a turn board (one river card to come): all-in on the
// turn, or a depth-limited leaf. Flop all-ins sum these over turn cards.
function getMatrix(ctx, board) {
  const key = board.join(',');
  let mat = ctx.matCache.get(key);
  if (mat) return mat;
  const [L0, L1] = ctx.lists;
  const n0 = L0.n, n1 = L1.n;
  const deck = 52 - board.length;
  const on = new Uint8Array(52);
  for (const c of board) on[c] = 1;
  {
    const M = new Int8Array(n0 * n1);
    const s0 = new Int32Array(n0), s1i = new Int32Array(n1), s1 = new Float64Array(n1);
    const b5 = [...board, 0];
    for (let c = 0; c < 52; c++) {
      if (on[c]) continue;
      b5[4] = c;
      scoreHands(b5, L0.c1, L0.c2, n0, s0);
      scoreHands(b5, L1.c1, L1.c2, n1, s1i);
      for (let j = 0; j < n1; j++) {
        const a = L1.c1[j], b = L1.c2[j];
        s1[j] = (a === c || b === c || on[a] || on[b]) ? NaN : s1i[j];
      }
      for (let h = 0; h < n0; h++) {
        const a = L0.c1[h], b = L0.c2[h];
        if (a === c || b === c || on[a] || on[b]) continue;
        const v = s0[h], row = h * n1;
        for (let j = 0; j < n1; j++) M[row + j] += (v > s1[j]) - (v < s1[j]);
      }
    }
    zeroConflicts(M, L0, L1);
    // Transposed copy so both players' passes can skip zero-reach rows.
    const MT = new Int8Array(n0 * n1);
    for (let h = 0; h < n0; h++) {
      const row = h * n1;
      for (let j = 0; j < n1; j++) MT[j * n0 + h] = M[row + j];
    }
    mat = { M, MT, scale: 1 / (deck - 4) };
  }
  ctx.matCache.set(key, mat);
  return mat;
}

function zeroConflicts(M, L0, L1) {
  const n1 = L1.n;
  for (let h = 0; h < L0.n; h++) {
    for (const c of [L0.c1[h], L0.c2[h]]) {
      for (const j of L1.cardCombos[c]) M[h * n1 + j] = 0;
    }
  }
}

// ------------------------------------------------------- sizing / alloc ---

function countStats(ctx) {
  let actNodes = 0, actions = 0, floats = 0, terminals = 0, chanceNodes = 0;
  const walk = (node, mult) => {
    if (node.t === ACT) {
      actNodes += mult; actions += mult * node.actions.length;
      floats += mult * node.actions.length * ctx.n[node.player];
      for (const k of node.kids) walk(k, mult);
    } else if (node.t === CHANCE) {
      chanceNodes += mult;
      for (const k of node.kids) walk(k, mult * node.mult);
    } else terminals += mult;
  };
  walk(ctx.root, 1);
  const n0 = ctx.n[0], n1 = ctx.n[1];
  // Showdown tables (~42 bytes per combo per board: sorted lists plus the
  // query tables) and runout matrices (M and its transpose, int8).
  const SD_PER_COMBO = 42, matOne = n0 * n1 * 2;
  let sdCount = countBoards(ctx, SHOW).length;
  const eqTurnBoards = countBoards(ctx, EQ).filter(len => len === 4).length;
  const hasFlopAllin = countBoards(ctx, EQ).some(len => len === 3);
  let turnReps = 0;
  if (ctx.rootStreet === 3) turnReps = chanceStructure(ctx, ctx.board).reps.length;
  // Flop all-ins and depth-limited leaves read every turn card's matrix.
  const matCount = hasFlopAllin || ctx.depthLimited ? Math.max(eqTurnBoards, turnReps) : eqTurnBoards;
  let matBytes = matCount * matOne, exploitExtraBytes = 0;
  if (ctx.leafK > 0) {
    // Sampled leaves walk showdown tables of every (turn, river) board under
    // a representative turn card; the matrices appear only once
    // exploitability() needs exact leaf values.
    const on = new Uint8Array(52);
    for (const c of ctx.board) on[c] = 1;
    const boards = new Set();
    for (const t of chanceStructure(ctx, ctx.board).reps) {
      for (let c = 0; c < 52; c++) if (!on[c] && c !== t) boards.add(Math.min(t, c) * 52 + Math.max(t, c));
    }
    sdCount += boards.size;
    exploitExtraBytes = matBytes; matBytes = 0;
  }
  const sdBytes = sdCount * (n0 + n1) * SD_PER_COMBO;
  const poolBytes = (ctx.maxDepth + 2) * Math.max(n0, n1) * 8 * (2 * ctx.maxA + 4);
  const memoryBytes = floats * 8 + matBytes + sdBytes + poolBytes + actNodes * 200;
  return { actNodes, actions, chanceNodes, terminals, storedFloats: floats, memoryBytes, matBytes, sdBytes, exploitExtraBytes };
}

// Number of distinct boards at SHOW or EQ terminals, as a list of board
// lengths. Count-only builds keep one child per chance node, so there the
// count is the largest chance multiplicity seen at that board length.
function countBoards(ctx, type) {
  const byLen = new Map();
  const walk = (node, mult) => {
    if (node.t === type) {
      const len = node.board.length;
      if (!byLen.has(len)) byLen.set(len, ctx.countOnly ? 0 : new Set());
      if (ctx.countOnly) byLen.set(len, Math.max(byLen.get(len), mult));
      else byLen.get(len).add(node.board.join(','));
    } else if (node.kids) {
      const m = node.t === CHANCE ? mult * node.mult : mult;
      for (const k of node.kids) walk(k, m);
    }
  };
  walk(ctx.root, 1);
  const out = [];
  for (const [len, v] of byLen) {
    const count = ctx.countOnly ? v : v.size;
    for (let i = 0; i < count; i++) out.push(len);
  }
  return out;
}

function allocate(ctx) {
  let chunk = null, used = 0;
  const take = len => {
    if (!chunk || used + len > chunk.length) {
      chunk = new Float32Array(Math.max(CHUNK_FLOATS, len)); used = 0;
    }
    const v = chunk.subarray(used, used + len); used += len; return v;
  };
  const walk = node => {
    if (node.t === ACT) {
      const len = node.actions.length * ctx.n[node.player];
      node.reg = take(len); node.sum = take(len);
    }
    if (node.kids) for (const k of node.kids) walk(k);
  };
  walk(ctx.root);
  // Per-depth scratch buffers (stride maxN), so traversal never allocates.
  const maxN = Math.max(ctx.n[0], ctx.n[1]);
  ctx.maxN = maxN;
  const D = ctx.maxDepth + 2;
  ctx.poolS = []; ctx.poolV = []; ctx.poolR = []; ctx.poolT = []; ctx.poolI = []; ctx.poolF = [];
  for (let d = 0; d < D; d++) {
    ctx.poolS.push(new Float64Array(ctx.maxA * maxN));
    const V = new Float64Array(ctx.maxA * maxN);
    ctx.poolV.push(Array.from({ length: ctx.maxA }, (_, a) => V.subarray(a * maxN, (a + 1) * maxN)));
    ctx.poolR.push(new Float64Array(maxN));
    ctx.poolT.push(new Float64Array(maxN));
    ctx.poolI.push(new Float64Array(maxN));
    ctx.poolF.push(new Float64Array(maxN));
  }
  ctx.tmpR = new Float64Array(maxN);
  ctx.tmpY = new Float64Array(maxN);
  ctx.CS = new Float64Array(54);
  ctx.TP = new Float64Array(maxN + 1);
  ctx.PC = new Float64Array(2 * maxN + 53);
  ctx.rootOut = new Float64Array(maxN);
}

// ------------------------------------------------------------- traversal ---

// Traversal modes.
const CFR = 0, BEST = 1, AVG = 2;

/**
 * Counterfactual values for player p's combos at `node`.
 * reach: opponent reach per opponent combo (never modified).
 * out: p's values are ADDED into out[0..n[p]-1] (callers zero it), which
 *      lets opponent nodes pass their own out straight down to children.
 */
function traverse(ctx, node, p, reach, out, depth, mode) {
  switch (node.t) {
    case FOLD: return evalFold(ctx, node, p, reach, out);
    case SHOW: return evalShowdown(ctx, node, p, reach, out);
    case EQ: return evalMatrix(ctx, node, p, reach, out, mode);
    case CHANCE: return evalChance(ctx, node, p, reach, out, depth, mode);
    default: return evalAct(ctx, node, p, reach, out, depth, mode);
  }
}

// Normalised cumulative strategy into S; uniform where nothing accumulated.
function averageStrategy(sum, A, n, S, stride, TOT) {
  TOT.fill(0, 0, n);
  for (let a = 0; a < A; a++) {
    const base = a * n;
    for (let h = 0; h < n; h++) TOT[h] += sum[base + h];
  }
  for (let h = 0; h < n; h++) { const t = TOT[h]; TOT[h] = t > 0 ? 1 / t : -1; }
  const u = 1 / A;
  for (let a = 0; a < A; a++) {
    const base = a * n, sb = a * stride;
    for (let h = 0; h < n; h++) {
      const inv = TOT[h];
      S[sb + h] = inv > 0 ? sum[base + h] * inv : u;
    }
  }
}

// Regret-matching normalisers: prob(a, h) = (r + |r|) * INV[h] + FLAG[h],
// i.e. max(r, 0) / sum of positive regrets, or uniform if none is positive.
// The strategy itself is never materialised; consuming loops recompute it.
function regretTotals(reg, A, n, INV, FLAG) {
  INV.fill(0, 0, n);
  for (let a = 0; a < A; a++) {
    const base = a * n;
    for (let h = 0; h < n; h++) { const r = reg[base + h]; INV[h] += r + Math.abs(r); }
  }
  const u = 1 / A;
  for (let h = 0; h < n; h++) {
    const t = INV[h];
    if (t > 0) { INV[h] = 1 / t; FLAG[h] = 0; } else { INV[h] = 0; FLAG[h] = u; }
  }
}

function evalAct(ctx, node, p, reach, out, depth, mode) {
  if (mode === CFR) return evalActCfr(ctx, node, p, reach, out, depth);
  const A = node.actions.length, stride = ctx.maxN;
  const S = ctx.poolS[depth], TOT = ctx.poolI[depth];
  const kids = node.kids;
  if (node.player === p) {
    const n = ctx.n[p];
    const Vs = ctx.poolV[depth];
    if (mode === AVG) averageStrategy(node.sum, A, n, S, stride, TOT);
    for (let a = 0; a < A; a++) {
      Vs[a].fill(0, 0, n);
      traverse(ctx, kids[a], p, reach, Vs[a], depth + 1, mode);
    }
    if (mode === BEST) {
      for (let h = 0; h < n; h++) {
        let m = Vs[0][h];
        for (let a = 1; a < A; a++) if (Vs[a][h] > m) m = Vs[a][h];
        out[h] += m;
      }
      return;
    }
    for (let a = 0; a < A; a++) {
      const V = Vs[a], sb = a * stride;
      for (let h = 0; h < n; h++) out[h] += S[sb + h] * V[h];
    }
    return;
  }
  // Opponent node, playing its average strategy.
  const o = 1 - p, nO = ctx.n[o];
  averageStrategy(node.sum, A, nO, S, stride, TOT);
  const R = ctx.poolR[depth];
  for (let a = 0; a < A; a++) {
    const sb = a * stride;
    let any = 0;
    for (let j = 0; j < nO; j++) { const r = reach[j] * S[sb + j]; R[j] = r; any += r; }
    if (any <= 0) continue;
    traverse(ctx, kids[a], p, R, out, depth + 1, mode);
  }
}

// CFR update traversal at a decision node. The current strategy is never
// materialised: it is recomputed from regrets inside each consuming loop.
function evalActCfr(ctx, node, p, reach, out, depth) {
  const A = node.actions.length, kids = node.kids, reg = node.reg;
  const INV = ctx.poolI[depth], FLAG = ctx.poolF[depth];
  if (node.player === p) {
    const n = ctx.n[p];
    const Vs = ctx.poolV[depth];
    regretTotals(reg, A, n, INV, FLAG);
    for (let a = 0; a < A; a++) {
      Vs[a].fill(0, 0, n);
      traverse(ctx, kids[a], p, reach, Vs[a], depth + 1, CFR);
    }
    const val = ctx.poolT[depth]; // this node's value, also added to out
    val.fill(0, 0, n);
    for (let a = 0; a < A; a++) {
      const V = Vs[a], base = a * n;
      for (let h = 0; h < n; h++) {
        const r = reg[base + h];
        val[h] += ((r + Math.abs(r)) * INV[h] + FLAG[h]) * V[h];
      }
    }
    for (let h = 0; h < n; h++) out[h] += val[h];
    // DCFR discount, branch-free: r * (r > 0 ? alpha_t : beta_t), then add
    // this iteration's instantaneous regret.
    // A node skipped by chance sampling catches up on the discounts it
    // missed: positive regrets by prod(alpha_k), negative by 0.5^gap.
    let k1 = ctx.k1, k2 = ctx.k2;
    const t = ctx.iter;
    if (node.lastT !== t - 1 && node.lastT >= 0) {
      const dPos = Math.exp(ctx.logAlpha[t] - ctx.logAlpha[node.lastT]);
      const dNeg = Math.pow(0.5, t - node.lastT);
      k1 = (dPos + dNeg) / 2; k2 = (dPos - dNeg) / 2;
    }
    node.lastT = t;
    for (let a = 0; a < A; a++) {
      const V = Vs[a], base = a * n;
      for (let h = 0; h < n; h++) {
        const r = reg[base + h];
        reg[base + h] = k1 * r + k2 * Math.abs(r) + V[h] - val[h];
      }
    }
    return;
  }
  // Opponent node: propagate its reach, and accumulate its average strategy
  // weighted by reach and by (t+1)^gamma. That equals DCFR's discount of the
  // running sum by (t/(t+1))^gamma each iteration, after normalising, and
  // stays correct for nodes that chance sampling skips.
  const o = 1 - p, nO = ctx.n[o];
  const sum = node.sum, wT = ctx.stratWeight;
  regretTotals(reg, A, nO, INV, FLAG);
  const R = ctx.poolR[depth];
  for (let a = 0; a < A; a++) {
    const base = a * nO;
    let any = 0;
    for (let j = 0; j < nO; j++) {
      const r = reg[base + j];
      const cr = reach[j] * ((r + Math.abs(r)) * INV[j] + FLAG[j]);
      R[j] = cr; any += cr;
      sum[base + j] += wT * cr;
    }
    if (any <= 0) continue;
    traverse(ctx, kids[a], p, R, out, depth + 1, CFR);
  }
}

function evalChance(ctx, node, p, reach, out, depth, mode) {
  const o = 1 - p, nO = ctx.n[o], nP = ctx.n[p];
  const R = ctx.poolR[depth], T = ctx.poolT[depth];
  const Lp = ctx.lists[p], Lo = ctx.lists[o];
  // Chance sampling (optional): on the first chance level only, CFR passes
  // visit a rotating subset of representative cards, scaled up to stay
  // unbiased. Best-response and evaluation passes always enumerate.
  const sampled = mode === CFR && node.sampled && ctx.sampleOn;
  const mask = ctx.sampleMask;
  const w = node.weight * (sampled ? ctx.sampleScale : 1);
  for (let k = 0; k < node.reps.length; k++) {
    if (sampled && !mask[k]) continue;
    const card = node.reps[k];
    for (let j = 0; j < nO; j++) R[j] = reach[j];
    const oc = Lo.cardCombos[card];
    for (let i = 0; i < oc.length; i++) R[oc[i]] = 0;
    T.fill(0, 0, nP);
    traverse(ctx, node.kids[k], p, R, T, depth + 1, mode);
    const pc = Lp.cardCombos[card];
    for (let i = 0; i < pc.length; i++) T[pc[i]] = 0;
    const orbit = node.orbits[k];
    for (let q = 0; q < orbit.length; q++) {
      const g = orbit[q];
      if (g === 0) {
        for (let h = 0; h < nP; h++) out[h] += w * T[h];
      } else {
        // value of card g(rep) for combo h = rep value for combo g^-1(h)
        const G = ctx.permMaps[PERM_INV[g]][p];
        for (let h = 0; h < nP; h++) out[h] += w * T[G[h]];
      }
    }
  }
}

// Fold terminal: value = +-amt * (compatible opponent reach). Per-card reach
// sums come from the per-card combo lists (register accumulation, no
// read-modify-write chains), plus the same-combo add-back.
function evalFold(ctx, node, p, reach, out) {
  const o = 1 - p, Lo = ctx.lists[o], Lp = ctx.lists[p];
  const nO = Lo.n, nP = Lp.n, CS = ctx.CS;
  let tot = 0;
  for (let j = 0; j < nO; j++) tot += reach[j];
  const flat = Lo.cardFlat, off = Lo.cardOff;
  for (let c = 0; c < 52; c++) {
    let t = 0;
    for (let k = off[c], k1 = off[c + 1]; k < k1; k++) t += reach[flat[k]];
    CS[c] = t;
  }
  const v = node.folder === p ? -node.amt : node.amt;
  const pc1 = Lp.c1, pc2 = Lp.c2, same = Lp.same;
  for (let h = 0; h < nP; h++) {
    const s = same[h];
    out[h] += v * (tot - CS[pc1[h]] - CS[pc2[h]] + (s >= 0 ? reach[s] : 0));
  }
}

// Showdown for player p, O(n) with card removal. Instead of walking both
// sorted lists with running per-card sums (whose read-modify-write chains
// stall the CPU when neighbouring hands share a card), we build prefix sums:
//  TP[k]   = reach of the k weakest opponent hands,
//  PC[...] = per card c, the same prefix over opponent hands holding c.
// Every hand's query positions were precomputed per board (buildQuery), so
// wins  = TP[lt] - PC[ltX] - PC[ltY]               (strictly weaker)
// losses = (TP[mo] - TP[le]) - (CT[x] - PC[leX]) - (CT[y] - PC[leY])
// Only the hand itself can hold both x and y and it ties, so no add-back.
function evalShowdown(ctx, node, p, reach, out) {
  showdownWalk(ctx, node.sd, p, reach, out, node.amt);
}

function showdownWalk(ctx, sd, p, reach, out, amt) {
  const nP = ctx.n[p];
  const q = sd.query[p];
  const TP = ctx.TP, PC = ctx.PC, CT = ctx.CS;
  const oIdx = q.oIdx, mo = q.mo;
  let s = 0;
  TP[0] = 0;
  for (let j = 0; j < mo; j++) { s += reach[oIdx[j]]; TP[j + 1] = s; }
  const flat = q.flat, fOff = q.fOff, pcOff = q.pcOff;
  for (let c = 0; c < 52; c++) {
    const k1 = fOff[c + 1];
    let base = pcOff[c], t = 0;
    PC[base++] = 0;
    for (let k = fOff[c]; k < k1; k++) { t += reach[flat[k]]; PC[base++] = t; }
    CT[c] = t;
  }
  const pIdx = q.pIdx, x = q.x, y = q.y, lt = q.lt, le = q.le;
  const ltX = q.ltX, leX = q.leX, ltY = q.ltY, leY = q.leY, all = TP[mo];
  for (let i = 0, m = q.m; i < m; i++) {
    const win = TP[lt[i]] - PC[ltX[i]] - PC[ltY[i]];
    const lose = all - TP[le[i]] - CT[x[i]] + PC[leX[i]] - CT[y[i]] + PC[leY[i]];
    out[pIdx[i]] += amt * (win - lose);
  }
}

// Query tables for player P's showdown against O on one board.
function buildQuery(P, O) {
  const mo = O.len, m = P.len;
  const lower = (arr, lo, hi, v) => { while (lo < hi) { const md = (lo + hi) >> 1; if (arr[md] < v) lo = md + 1; else hi = md; } return lo; };
  const upper = (arr, lo, hi, v) => { while (lo < hi) { const md = (lo + hi) >> 1; if (arr[md] <= v) lo = md + 1; else hi = md; } return lo; };
  // Opponent hands per card, in strength order.
  const perCard = Array.from({ length: 52 }, () => []);
  for (let j = 0; j < mo; j++) { perCard[O.c1[j]].push(j); perCard[O.c2[j]].push(j); }
  const fOff = new Int32Array(53), pcOff = new Int32Array(53);
  for (let c = 0; c < 52; c++) { fOff[c + 1] = fOff[c] + perCard[c].length; pcOff[c + 1] = pcOff[c] + perCard[c].length + 1; }
  const flat = new Int32Array(fOff[52]);
  const cardStr = perCard.map(l => Int32Array.from(l, j => O.str[j]));
  for (let c = 0; c < 52; c++) perCard[c].forEach((j, k) => { flat[fOff[c] + k] = O.idx[j]; });
  const q = {
    m, mo, oIdx: O.idx, flat, fOff, pcOff, pIdx: P.idx, x: P.c1, y: P.c2,
    lt: new Int32Array(m), le: new Int32Array(m),
    ltX: new Int32Array(m), leX: new Int32Array(m), ltY: new Int32Array(m), leY: new Int32Array(m),
  };
  for (let i = 0; i < m; i++) {
    const v = P.str[i], a = P.c1[i], b = P.c2[i];
    q.lt[i] = lower(O.str, 0, mo, v); q.le[i] = upper(O.str, 0, mo, v);
    const sa = cardStr[a], sb = cardStr[b];
    q.ltX[i] = pcOff[a] + lower(sa, 0, sa.length, v); q.leX[i] = pcOff[a] + upper(sa, 0, sa.length, v);
    q.ltY[i] = pcOff[b] + lower(sb, 0, sb.length, v); q.leY[i] = pcOff[b] + upper(sb, 0, sb.length, v);
  }
  return q;
}

// y = v * M r for p = 0 (rows = OOP), or y = -v * M^T r for p = 1, as a
// sum of matrix rows scaled by the nonzero entries of r (opponent reach is
// often sparse once regret matching zeroes out actions).
function matvec(mat, n0, n1, p, r, y, v) {
  const A = p === 0 ? mat.MT : mat.M; // rows indexed by the opponent
  const nO = p === 0 ? n1 : n0, nP = p === 0 ? n0 : n1;
  const sv = p === 0 ? v : -v; // accumulates into y
  for (let j = 0; j < nO; j++) {
    const rj = r[j];
    if (rj === 0) continue;
    const rv = rj * sv, row = j * nP;
    for (let h = 0; h < nP; h++) y[h] += rv * A[row + h];
  }
}

// All-in runout or depth-limited leaf. Turn boards use their river matrix.
// Flop all-ins average the turn matrices over every turn card (each ordered
// turn/river pair once, scale 1/(k(k-1)) with k = cards left per hand pair),
// reusing orbit representatives: for t = g(rep), (M_t r)(h) equals
// (M_rep r')(g^-1 h) with r'(k) = r(g k).
function evalMatrix(ctx, node, p, reach, out, mode) {
  if (mode === CFR && ctx.leafK > 0) return evalSampledRunout(ctx, node, p, reach, out);
  const n0 = ctx.n[0], n1 = ctx.n[1], nP = ctx.n[p], o = 1 - p, nO = ctx.n[o];
  if (!node.flopRunout) {
    const mat = node.mat || (node.mat = getMatrix(ctx, node.board));
    matvec(mat, n0, n1, p, reach, out, node.amt * mat.scale);
    return;
  }
  const cs = chanceStructure(ctx, node.board);
  const sampled = mode === CFR && ctx.sampleOn;
  const k = 52 - node.board.length - 4;
  const v = node.amt / (k * (k - 1)) * (sampled ? ctx.sampleScale : 1);
  const RP = ctx.tmpR, Y = ctx.tmpY;
  for (let slot = 0; slot < cs.reps.length; slot++) {
    if (sampled && !ctx.sampleMask[slot]) continue;
    const M = getMatrix(ctx, [...node.board, cs.reps[slot]]);
    const orbit = cs.orbits[slot];
    for (let q = 0; q < orbit.length; q++) {
      const g = orbit[q];
      if (g === 0) {
        matvec(M, n0, n1, p, reach, out, v);
      } else {
        const F = ctx.permMaps[g][o], G = ctx.permMaps[PERM_INV[g]][p];
        for (let j = 0; j < nO; j++) RP[j] = reach[F[j]];
        Y.fill(0, 0, nP);
        matvec(M, n0, n1, p, RP, Y, v);
        for (let h = 0; h < nP; h++) out[h] += Y[G[h]];
      }
    }
  }
}

// Runouts after `board` for sampled leaves: single river cards for a turn
// board, unordered (turn, river) pairs (encoded a * 52 + b) for a flop board.
// They are grouped into orbits of the suit permutations that fix the board,
// and a sample is always a whole orbit, so every subtree stays exactly
// symmetric and the isomorphism shortcut at chance nodes remains valid.
// Groups are shuffled once; CFR passes walk them in rotation.
function runoutPlan(ctx, board) {
  const key = board.join(',');
  let plan = ctx.planCache.get(key);
  if (plan) return plan;
  const on = new Uint8Array(52);
  for (const c of board) on[c] = 1;
  const perms = ctx.rootPerms.filter(g => board.every(c => on[permCard(PERMS[g], c)]));
  const groups = [];
  const seen = new Set();
  const two = board.length === 3;
  for (let a = 0; a < 52; a++) {
    if (on[a]) continue;
    for (let b = two ? a + 1 : 52; b < (two ? 52 : 53); b++) {
      if (two && on[b]) continue;
      const code = two ? a * 52 + b : a;
      if (seen.has(code)) continue;
      const orbit = [];
      for (const g of perms) {
        let x = permCard(PERMS[g], a), y = two ? permCard(PERMS[g], b) : 0;
        if (two && x > y) [x, y] = [y, x];
        const c = two ? x * 52 + y : x;
        if (!seen.has(c)) { seen.add(c); orbit.push(c); }
      }
      groups.push(Int32Array.from(orbit));
    }
  }
  let seed = 0x9e3779b9 ^ groups.length ^ (board[0] * 7919);
  for (let i = groups.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }
  plan = { groups, two };
  ctx.planCache.set(key, plan);
  return plan;
}

// Sampled runout value for a CFR pass: K whole orbits from the rotation,
// each runout scored with an O(n) showdown walk. Unbiased under card
// removal: exact value = (1 / V) * sum over all runouts, where V = runouts
// valid for a given hand pair ((n-4) cards, or C(n-4, 2) pairs, n = cards
// left after the board); a sample of K of the R groups is scaled by R / K.
function evalSampledRunout(ctx, node, p, reach, out) {
  const { groups, two } = node.plan, R = groups.length, t = ctx.iter;
  const K = Math.min(two ? ctx.allinK : ctx.leafK, R);
  const n = 52 - node.board.length;
  const V = two ? ((n - 4) * (n - 5)) / 2 : n - 4;
  const v = node.amt * R / (K * V);
  for (let i = 0; i < K; i++) {
    const grp = groups[(t * K + i) % R];
    for (let q = 0; q < grp.length; q++) {
      const item = grp[q];
      const b = two ? [...node.board, (item / 52) | 0, item % 52] : [...node.board, item];
      showdownWalk(ctx, getShowdown(ctx, b), p, reach, out, v);
    }
  }
}

function chooseSamples(ctx, t) {
  const K = ctx.sampleK;
  if (!K) { ctx.sampleOn = false; return; }
  const order = ctx.sampleOrder, R = order.length, mask = ctx.sampleMask;
  mask.fill(0);
  for (let i = 0; i < K; i++) mask[order[(t * K + i) % R]] = 1;
  ctx.sampleOn = true;
}

// ------------------------------------------------------------------- API ---

function makeApi(ctx) {
  let iterations = 0;
  const lists = ctx.lists;
  // Normaliser: total weight of compatible (oop, ip) combo pairs.
  let pairWeight = 0;
  {
    const L0 = lists[0], L1 = lists[1], CS = new Float64Array(52);
    let tot = 0;
    for (let j = 0; j < L1.n; j++) { tot += L1.w[j]; CS[L1.c1[j]] += L1.w[j]; CS[L1.c2[j]] += L1.w[j]; }
    for (let h = 0; h < L0.n; h++) {
      const s = L0.same[h];
      pairWeight += L0.w[h] * (tot - CS[L0.c1[h]] - CS[L0.c2[h]] + (s >= 0 ? L1.w[s] : 0));
    }
  }

  function value(p, mode) {
    const out = ctx.rootOut;
    out.fill(0);
    traverse(ctx, ctx.root, p, lists[1 - p].w, out, 0, mode);
    let v = 0;
    const w = lists[p].w;
    for (let h = 0; h < lists[p].n; h++) v += w[h] * out[h];
    return v / pairWeight;
  }

  function step(iters = 1) {
    for (let k = 0; k < iters; k++) {
      const t = iterations;
      const ta = Math.pow(t, ALPHA);
      const alphaT = ta / (ta + 1), betaT = Math.pow(t, BETA) / (Math.pow(t, BETA) + 1);
      ctx.iter = t;
      ctx.k1 = (alphaT + betaT) / 2; ctx.k2 = (alphaT - betaT) / 2;
      ctx.logAlpha[t] = t === 0 ? 0 : ctx.logAlpha[t - 1] + Math.log(alphaT);
      ctx.stratWeight = Math.pow(t + 1, GAMMA);
      chooseSamples(ctx, t);
      for (let p = 0; p < 2; p++) {
        ctx.rootOut.fill(0);
        traverse(ctx, ctx.root, p, lists[1 - p].w, ctx.rootOut, 0, CFR);
      }
      iterations++;
    }
    return iterations;
  }

  /** Nash distance in % of the root pot: mean of both best-response gains. */
  function exploitability() {
    const br0 = value(0, BEST), br1 = value(1, BEST);
    return ((br0 + br1) / 2) / ctx.rootPot * 100;
  }

  /** Expected values (BB) of both players under the average strategies. */
  function evs() {
    return [value(0, AVG), value(1, AVG)];
  }
  function bestResponseValues() {
    return [value(0, BEST), value(1, BEST)];
  }

  // Walk a path. Elements are action indices at decision nodes and dealt
  // cards (0..51) at chance nodes. Returns the node, the suit perm mapping
  // real cards into the solved (representative) subtree, and dealt cards.
  function walk(path) {
    let node = ctx.root, g = 0;
    const dealt = [];
    const trail = [];
    for (const e of path || []) {
      if (node.t === ACT) {
        if (!(e >= 0 && e < node.kids.length)) throw new Error(`bad action index ${e}`);
        trail.push({ node, a: e, g });
        node = node.kids[e];
      } else if (node.t === CHANCE) {
        const c = permCard(PERMS[g], e);
        const cr = node.cardRep[c];
        if (!cr) throw new Error(`card ${e} cannot be dealt here`);
        const [slot, gp] = cr; // gp(rep) = c
        trail.push({ node, card: e, slot, gp, g });
        dealt.push(e);
        g = PERM_MUL[PERM_INV[gp]][g];
        node = node.kids[slot];
      } else throw new Error('path runs past a terminal');
    }
    return { node, g, dealt, trail };
  }

  function actionsAt(path) {
    const { node } = walk(path);
    return node.t === ACT ? node.actions.map(a => ({ ...a })) : [];
  }

  function nodeInfo(path) {
    const { node, dealt } = walk(path);
    const type = ['action', 'fold', 'showdown', 'chance', 'runout'][node.t];
    const info = { type, board: [...ctx.board, ...dealt] };
    if (node.t === ACT) Object.assign(info, { player: node.player, pot: node.pot, stack: node.stack, bets: node.puts.slice() });
    if (node.t === CHANCE) info.cards = Array.from({ length: 52 }, (_, c) => c).filter(c => !info.board.includes(c));
    return info;
  }

  function blockedBy(dealt, combo) {
    return ctx.boardMask[CC1[combo]] || ctx.boardMask[CC2[combo]] ||
      dealt.includes(CC1[combo]) || dealt.includes(CC2[combo]);
  }

  /** Average-strategy probabilities for a combo at a decision node, or null
   *  if the combo is not in that player's range (zero weight or blocked). */
  function strategyAt(path, combo) {
    const { node, g, dealt } = walk(path);
    if (node.t !== ACT) return null;
    if (blockedBy(dealt, combo)) return null;
    const L = lists[node.player];
    const h = L.local[permCombo(PERMS[g], combo)];
    if (h < 0) return null;
    const A = node.actions.length, n = L.n;
    let tot = 0;
    for (let a = 0; a < A; a++) tot += node.sum[a * n + h];
    const probs = new Array(A);
    for (let a = 0; a < A; a++) probs[a] = tot > 0 ? node.sum[a * n + h] / tot : 1 / A;
    return probs;
  }

  /** Reach-weighted range (Float32Array 1326) of `player` at `path`. */
  function rangeAt(path, player) {
    const { trail, g: gEnd } = walk(path);
    const L = lists[player];
    let r = Float64Array.from(L.w);
    for (const step of trail) {
      const { node } = step;
      if (node.t === ACT) {
        if (node.player !== player) continue;
        const A = node.actions.length, n = L.n, a = step.a;
        for (let h = 0; h < n; h++) {
          let tot = 0;
          for (let b = 0; b < A; b++) tot += node.sum[b * n + h];
          r[h] *= tot > 0 ? node.sum[a * n + h] / tot : 1 / A;
        }
      } else {
        // Re-express the range in the representative subtree's frame:
        // new(k) = old(gp(k)), then drop combos holding the rep card.
        const F = ctx.permMaps[step.gp][player];
        const nr = new Float64Array(L.n);
        for (let k = 0; k < L.n; k++) nr[k] = step.gp === 0 ? r[k] : r[F[k]];
        for (const k of L.cardCombos[node.reps[step.slot]]) nr[k] = 0;
        r = nr;
      }
    }
    const out = new Float32Array(NUM_COMBOS);
    for (let i = 0; i < NUM_COMBOS; i++) {
      const h = L.local[permCombo(PERMS[gEnd], i)];
      if (h >= 0) out[i] = r[h];
    }
    return out;
  }

  return {
    step, exploitability, evs, bestResponseValues, actionsAt, strategyAt, rangeAt, nodeInfo,
    get iterations() { return iterations; },
    memoryBytes: ctx.stats.memoryBytes,
    // Extra memory the first exploitability() call allocates on a
    // depth-limited flop with sampled leaves (exact leaf matrices).
    exploitMemoryBytes: ctx.stats.exploitExtraBytes,
    stats: ctx.stats,
    depthLimited: ctx.depthLimited,
    rootPot: ctx.rootPot,
    isomorphism: ctx.rootPerms.length,
    combos: [lists[0].n, lists[1].n],
    _ctx: ctx, // for tests
  };
}

// --------------------------------------------------------- test helpers ---

/** Internal pieces exposed for tools/postflop-test.js. */
export const __test = {
  // Values (player p, opponent reach `reach` in list order) of a synthetic
  // terminal on the solver's root board: 'fold' (folder loses amt), 'show'
  // (river board), 'eq' (exact runout of the remaining cards), or 'sampled'
  // (the sampled-leaf estimator averaged over one full rotation).
  terminalValues(solver, kind, p, reach, amt = 1, folder = 0) {
    const ctx = solver._ctx;
    const node = new Node(kind === 'fold' ? FOLD : kind === 'show' ? SHOW : EQ);
    node.amt = amt; node.folder = folder; node.board = ctx.board;
    node.flopRunout = ctx.board.length === 3;
    if (kind === 'show') node.sd = getShowdown(ctx, ctx.board);
    const out = new Float64Array(ctx.n[p]);
    if (kind !== 'sampled') {
      traverse(ctx, node, p, reach, out, 0, kind === 'eq' ? AVG : CFR);
      return out;
    }
    const saved = [ctx.leafK, ctx.allinK, ctx.iter];
    ctx.leafK = 1; ctx.allinK = 1;
    node.plan = runoutPlan(ctx, ctx.board);
    const R = node.plan.groups.length;
    for (let t = 0; t < R; t++) { ctx.iter = t; evalSampledRunout(ctx, node, p, reach, out); }
    [ctx.leafK, ctx.allinK, ctx.iter] = saved;
    for (let h = 0; h < out.length; h++) out[h] /= R;
    return out;
  },
};
