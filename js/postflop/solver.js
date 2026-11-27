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
//    Showdowns walk both players' strength-sorted lists (O(n), the method of
//    b-inary/postflop-solver); only strictly weaker / stronger hands count,
//    so ties pay 0 and no add-back is needed.
//  * All-in runouts and depth-limited leaves use a precomputed matrix
//    M[oop][ip] = sum over runouts of sign(strength difference), zero for
//    pairs that share a card, scaled by 1 / (runouts per hand pair).
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
    this.board = null;
    this.pot = 0; this.stack = 0; this.puts = null; this.nBets = 0;
  }
}

// ---------------------------------------------------------------- solver ---

/**
 * Create a solver. See the header comment for units and conventions.
 * input = { board, pot, stack, ranges: [Float32Array(1326) oop, ip],
 *   start?: { bets: [oopPut, ipPut], toAct, nBets? }, sizes?, depthLimited?,
 *   isomorphism? (default true), maxMemoryBytes? (default 700 MB) }
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
    input, board, boardMask, sizes, pot, stack, depthLimited, lists,
    n: [lists[0].n, lists[1].n], rootPerms, permMaps, countOnly,
    rootStreet: board.length, rootPot: pot + bets[0] + bets[1],
    sdCache: new Map(), matCache: new Map(), permCache: new Map(),
    stats: null, root: null, maxDepth: 0, maxA: 2,
  };
  ctx.root = buildStreet(ctx, board, pot, stack, bets, toAct, nBets, checks, 0);
  ctx.stats = countStats(ctx);
  const limit = input.maxMemoryBytes ?? 700e6;
  if (!countOnly && ctx.stats.memoryBytes > limit) {
    throw new Error(`solve needs ~${(ctx.stats.memoryBytes / 1e6).toFixed(0)} MB, over the ${(limit / 1e6).toFixed(0)} MB limit`);
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
    if (!ctx.countOnly) t.mat = getMatrix(ctx, board);
    return t;
  }
  return buildChance(ctx, board, P2, s2, depth);
}

function buildChance(ctx, board, P, stack, depth) {
  const node = new Node(CHANCE);
  node.board = board; node.pot = P; node.stack = stack;
  node.weight = 1 / (52 - board.length - 4);
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;
  const perms = ctx.rootPerms.filter(g => board.every(c => onBoard[permCard(PERMS[g], c)]));
  node.reps = []; node.orbits = []; node.cardRep = new Array(52).fill(null);
  for (let c = 0; c < 52; c++) {
    if (onBoard[c] || node.cardRep[c]) continue;
    const slot = node.reps.length;
    node.reps.push(c);
    const orbit = [];
    for (const g of perms) {
      const d = permCard(PERMS[g], c);
      if (!node.cardRep[d]) { node.cardRep[d] = [slot, g]; orbit.push(g); }
    }
    node.orbits.push(Int32Array.from(orbit));
  }
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
  const key = board.join(',');
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
  ctx.sdCache.set(key, sd);
  return sd;
}

// Runout matrix for an all-in or depth-limited leaf on `board`.
function getMatrix(ctx, board) {
  const key = board.join(',');
  let mat = ctx.matCache.get(key);
  if (mat) return mat;
  const [L0, L1] = ctx.lists;
  const n0 = L0.n, n1 = L1.n;
  const deck = 52 - board.length;
  const on = new Uint8Array(52);
  for (const c of board) on[c] = 1;
  if (board.length === 4) {
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
    mat = { M, scale: 1 / (deck - 4) };
  } else {
    // Flop all-in: sum the turn matrices over every turn card, halved since
    // each unordered (turn, river) runout appears twice.
    const acc = new Int32Array(n0 * n1);
    const perms = ctx.rootPerms;
    for (let t = 0; t < 52; t++) {
      if (on[t]) continue;
      // Find a cached/representative turn card t' and perm g with g(t') = t.
      let src = null, g = 0;
      for (const gg of perms) {
        const tp = permCard(PERMS[PERM_INV[gg]], t);
        if (board.every(c => on[permCard(PERMS[gg], c)]) && ctx.matCache.has([...board, tp].join(','))) {
          src = ctx.matCache.get([...board, tp].join(',')); g = gg; break;
        }
      }
      if (!src) { src = getMatrix(ctx, [...board, t]); g = 0; }
      const M = src.M;
      if (g === 0) {
        for (let i = 0; i < acc.length; i++) acc[i] += M[i];
      } else {
        // M_t[h0][h1] = M_t'[g^-1 h0][g^-1 h1]
        const gi = PERM_INV[g];
        const G0 = ctx.permMaps[gi][0], G1 = ctx.permMaps[gi][1];
        for (let h = 0; h < n0; h++) {
          const row = h * n1, srow = G0[h] * n1;
          for (let j = 0; j < n1; j++) acc[row + j] += M[srow + G1[j]];
        }
      }
    }
    const M = new Int16Array(n0 * n1);
    for (let i = 0; i < acc.length; i++) M[i] = acc[i] / 2;
    const k = deck - 4;
    mat = { M, scale: 2 / (k * (k - 1)) };
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
  // Showdown lists and runout matrices, from the tree shape.
  const sdBoards = countBoards(ctx, SHOW), matBoards = countBoards(ctx, EQ);
  let matBytes = 0;
  for (const len of matBoards) matBytes += n0 * n1 * (len === 4 ? 1 : 2);
  const sdBytes = sdBoards.length * (n0 + n1) * 10;
  const poolBytes = (ctx.maxDepth + 2) * Math.max(n0, n1) * 8 * (2 * ctx.maxA + 2);
  const memoryBytes = floats * 8 + matBytes + sdBytes + poolBytes + actNodes * 200;
  return { actNodes, actions, chanceNodes, terminals, storedFloats: floats, memoryBytes, matBytes, sdBytes };
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
  ctx.poolS = []; ctx.poolV = []; ctx.poolR = []; ctx.poolT = [];
  for (let d = 0; d < D; d++) {
    ctx.poolS.push(new Float64Array(ctx.maxA * maxN));
    const V = new Float64Array(ctx.maxA * maxN);
    ctx.poolV.push(Array.from({ length: ctx.maxA }, (_, a) => V.subarray(a * maxN, (a + 1) * maxN)));
    ctx.poolR.push(new Float64Array(maxN));
    ctx.poolT.push(new Float64Array(maxN));
  }
  ctx.CS = new Float64Array(52);
  ctx.rootOut = new Float64Array(maxN);
}

// ------------------------------------------------------------- traversal ---

// Traversal modes.
const CFR = 0, BEST = 1, AVG = 2;

/**
 * Counterfactual values for player p's combos at `node`.
 * reach: opponent reach per opponent combo (never modified).
 * out: written with p's values (indices 0..n[p]-1).
 */
function traverse(ctx, node, p, reach, out, depth, mode) {
  switch (node.t) {
    case FOLD: return evalFold(ctx, node, p, reach, out);
    case SHOW: return evalShowdown(ctx, node, p, reach, out);
    case EQ: return evalMatrix(ctx, node, p, reach, out);
    case CHANCE: return evalChance(ctx, node, p, reach, out, depth, mode);
    default: return evalAct(ctx, node, p, reach, out, depth, mode);
  }
}

function regretMatch(reg, A, n, S, stride) {
  for (let h = 0; h < n; h++) {
    let tot = 0;
    for (let a = 0; a < A; a++) { const r = reg[a * n + h]; if (r > 0) tot += r; }
    if (tot > 0) {
      const inv = 1 / tot;
      for (let a = 0; a < A; a++) { const r = reg[a * n + h]; S[a * stride + h] = r > 0 ? r * inv : 0; }
    } else {
      const u = 1 / A;
      for (let a = 0; a < A; a++) S[a * stride + h] = u;
    }
  }
}

function averageStrategy(sum, A, n, S, stride) {
  for (let h = 0; h < n; h++) {
    let tot = 0;
    for (let a = 0; a < A; a++) tot += sum[a * n + h];
    if (tot > 0) {
      const inv = 1 / tot;
      for (let a = 0; a < A; a++) S[a * stride + h] = sum[a * n + h] * inv;
    } else {
      const u = 1 / A;
      for (let a = 0; a < A; a++) S[a * stride + h] = u;
    }
  }
}

function evalAct(ctx, node, p, reach, out, depth, mode) {
  const A = node.actions.length, stride = ctx.maxN;
  const S = ctx.poolS[depth];
  const kids = node.kids;
  if (node.player === p) {
    const n = ctx.n[p];
    const Vs = ctx.poolV[depth];
    if (mode === AVG) averageStrategy(node.sum, A, n, S, stride);
    else if (mode === CFR) regretMatch(node.reg, A, n, S, stride);
    for (let a = 0; a < A; a++) traverse(ctx, kids[a], p, reach, Vs[a], depth + 1, mode);
    if (mode === BEST) {
      for (let h = 0; h < n; h++) {
        let m = Vs[0][h];
        for (let a = 1; a < A; a++) if (Vs[a][h] > m) m = Vs[a][h];
        out[h] = m;
      }
      return;
    }
    for (let h = 0; h < n; h++) {
      let v = 0;
      for (let a = 0; a < A; a++) v += S[a * stride + h] * Vs[a][h];
      out[h] = v;
    }
    if (mode === CFR) {
      const reg = node.reg, aT = ctx.alphaT, bT = ctx.betaT;
      for (let a = 0; a < A; a++) {
        const V = Vs[a], base = a * n;
        for (let h = 0; h < n; h++) {
          const r = reg[base + h];
          reg[base + h] = r * (r > 0 ? aT : bT) + V[h] - out[h];
        }
      }
    }
    return;
  }
  // Opponent node.
  const o = 1 - p, nO = ctx.n[o], nP = ctx.n[p];
  if (mode === CFR) {
    regretMatch(node.reg, A, nO, S, stride);
    const sum = node.sum, gT = ctx.gammaT;
    for (let a = 0; a < A; a++) {
      const base = a * nO, sb = a * stride;
      for (let j = 0; j < nO; j++) sum[base + j] = sum[base + j] * gT + reach[j] * S[sb + j];
    }
  } else averageStrategy(node.sum, A, nO, S, stride);
  const R = ctx.poolR[depth], T = ctx.poolT[depth];
  out.fill(0, 0, nP);
  for (let a = 0; a < A; a++) {
    const sb = a * stride;
    let any = 0;
    for (let j = 0; j < nO; j++) { const r = reach[j] * S[sb + j]; R[j] = r; any += r; }
    if (any <= 0) continue;
    traverse(ctx, kids[a], p, R, T, depth + 1, mode);
    for (let h = 0; h < nP; h++) out[h] += T[h];
  }
}

function evalChance(ctx, node, p, reach, out, depth, mode) {
  const o = 1 - p, nO = ctx.n[o], nP = ctx.n[p];
  const R = ctx.poolR[depth], T = ctx.poolT[depth];
  const Lp = ctx.lists[p], Lo = ctx.lists[o];
  out.fill(0, 0, nP);
  for (let k = 0; k < node.reps.length; k++) {
    const card = node.reps[k];
    for (let j = 0; j < nO; j++) R[j] = reach[j];
    const oc = Lo.cardCombos[card];
    for (let i = 0; i < oc.length; i++) R[oc[i]] = 0;
    traverse(ctx, node.kids[k], p, R, T, depth + 1, mode);
    const pc = Lp.cardCombos[card];
    for (let i = 0; i < pc.length; i++) T[pc[i]] = 0;
    const orbit = node.orbits[k];
    for (let q = 0; q < orbit.length; q++) {
      const g = orbit[q];
      if (g === 0) {
        for (let h = 0; h < nP; h++) out[h] += T[h];
      } else {
        // value of card g(rep) for combo h = rep value for combo g^-1(h)
        const G = ctx.permMaps[PERM_INV[g]][p];
        for (let h = 0; h < nP; h++) out[h] += T[G[h]];
      }
    }
  }
  const w = node.weight;
  for (let h = 0; h < nP; h++) out[h] *= w;
}

function evalFold(ctx, node, p, reach, out) {
  const o = 1 - p, Lo = ctx.lists[o], Lp = ctx.lists[p];
  const nO = Lo.n, nP = Lp.n, CS = ctx.CS;
  CS.fill(0);
  let tot = 0;
  const oc1 = Lo.c1, oc2 = Lo.c2;
  for (let j = 0; j < nO; j++) {
    const r = reach[j];
    if (r !== 0) { tot += r; CS[oc1[j]] += r; CS[oc2[j]] += r; }
  }
  const v = node.folder === p ? -node.amt : node.amt;
  const pc1 = Lp.c1, pc2 = Lp.c2, same = Lp.same;
  for (let h = 0; h < nP; h++) {
    const s = same[h];
    out[h] = v * (tot - CS[pc1[h]] - CS[pc2[h]] + (s >= 0 ? reach[s] : 0));
  }
}

function evalShowdown(ctx, node, p, reach, out) {
  const o = 1 - p, nP = ctx.n[p];
  const P = node.sd[p], O = node.sd[o];
  const CS = ctx.CS, amt = node.amt;
  out.fill(0, 0, nP);
  const pIdx = P.idx, pStr = P.str, pc1 = P.c1, pc2 = P.c2, m = P.len;
  const oIdx = O.idx, oStr = O.str, oc1 = O.c1, oc2 = O.c2, mo = O.len;
  // Wins: opponent hands strictly weaker.
  CS.fill(0);
  let sum = 0, j = 0;
  for (let i = 0; i < m; i++) {
    const s = pStr[i];
    while (j < mo && oStr[j] < s) {
      const r = reach[oIdx[j]];
      sum += r; CS[oc1[j]] += r; CS[oc2[j]] += r; j++;
    }
    out[pIdx[i]] = amt * (sum - CS[pc1[i]] - CS[pc2[i]]);
  }
  // Losses: opponent hands strictly stronger.
  CS.fill(0);
  sum = 0; j = mo - 1;
  for (let i = m - 1; i >= 0; i--) {
    const s = pStr[i];
    while (j >= 0 && oStr[j] > s) {
      const r = reach[oIdx[j]];
      sum += r; CS[oc1[j]] += r; CS[oc2[j]] += r; j--;
    }
    out[pIdx[i]] -= amt * (sum - CS[pc1[i]] - CS[pc2[i]]);
  }
}

function evalMatrix(ctx, node, p, reach, out) {
  const { M, scale } = node.mat;
  const n0 = ctx.n[0], n1 = ctx.n[1];
  const v = node.amt * scale;
  if (p === 0) {
    for (let h = 0; h < n0; h++) {
      const row = h * n1;
      let s = 0;
      for (let j = 0; j < n1; j++) s += M[row + j] * reach[j];
      out[h] = v * s;
    }
  } else {
    out.fill(0, 0, n1);
    for (let h = 0; h < n0; h++) {
      const r = reach[h];
      if (r === 0) continue;
      const rv = r * v, row = h * n1;
      for (let j = 0; j < n1; j++) out[j] -= rv * M[row + j];
    }
  }
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
    traverse(ctx, ctx.root, p, lists[1 - p].w, out, 0, mode);
    let v = 0;
    const w = lists[p].w;
    for (let h = 0; h < lists[p].n; h++) v += w[h] * out[h];
    return v / pairWeight;
  }

  function step(iters = 1) {
    for (let k = 0; k < iters; k++) {
      const t = iterations;
      const ta = Math.pow(t, 1.5);
      ctx.alphaT = ta / (ta + 1);
      ctx.betaT = 0.5;
      ctx.gammaT = Math.pow(t / (t + 1), 2);
      for (let p = 0; p < 2; p++) {
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
  terminalValues(solver, kind, p, reach, amt = 1, folder = 0) {
    const ctx = solver._ctx;
    const node = new Node(kind === 'fold' ? FOLD : kind === 'show' ? SHOW : EQ);
    node.amt = amt; node.folder = folder;
    if (kind === 'show') node.sd = getShowdown(ctx, ctx.board);
    if (kind === 'eq') node.mat = getMatrix(ctx, ctx.board);
    const out = new Float64Array(ctx.n[p]);
    traverse(ctx, node, p, reach, out, 0, CFR);
    return out;
  },
};
