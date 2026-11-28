// Three-player river solver (CFR+, vectorised per traverser).
//
// River only. Seats act 0 -> 1 -> 2 (cyclic among players still in).
// Actions: check / bet (spec.sizes.bet pot fractions, default [0.5, 1]);
// facing a bet: fold / call / raise (spec.sizes.raise, multiples of the facing
// bet, default [2.5]) / all-in when spec.sizes.allin. CAP: spec.sizes.maxBets
// bets+raises per round, default 2 = one bet and ONE raise level, no re-raise.
// A bet or raise above allinThreshold of the remaining stack becomes all-in.
// Stacks: all three players have the same effective stack `spec.stack`, so
// every live player can always match any bet and there are no side pots.
// A fold that leaves two players continues heads-up; the folder's chips stay
// in the pot and the folder's hand still removes cards (exact card removal
// between all three hands at every terminal).
//
// Payoffs are in chips relative to a 1/3 share of the starting pot P0:
//   u_p = share_p - contributed_p - P0/3,   so the three payoffs sum to 0 at
// every terminal (chip conservation). A 2-way tie splits the pot in two, a
// 3-way tie in three.
//
// The CFR update code (vectorised terminals, cfrIteration) and the
// best-response code (bestResponse*, brute-force triple loops, its own 7-card
// scoring, payoffs()) share only the tree and the average-strategy tables.
//
// Three-player CFR has no equilibrium guarantee (averages approach a coarse
// correlated equilibrium at best); bestResponseGain() reports how far each
// player is from a best response when the other two stay fixed.

import { evalCards, scoreHands } from './eval7.js';

const NUM_COMBOS = 1326;
const CC1 = new Uint8Array(NUM_COMBOS), CC2 = new Uint8Array(NUM_COMBOS);
{
  let k = 0;
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) { CC1[k] = a; CC2[k] = b; k++; }
}
const EPS = 1e-9;
export const DEFAULT_SIZES3 = Object.freeze({
  bet: [0.5, 1], raise: [2.5], allin: false, maxBets: 2, allinThreshold: 0.67,
});

const ACT = 0, TERM = 1;

function nextIn(inn, p) {
  for (let k = 1; k <= 3; k++) { const q = (p + k) % 3; if (inn[q]) return q; }
  return -1;
}

export function createSolver3(spec) {
  const P0 = spec.pot, stack = spec.stack;
  const sizes = { ...DEFAULT_SIZES3, ...(spec.sizes || {}) };
  const folds = spec.folds || [false, false, false];
  const board = spec.board.slice();
  if (board.length !== 5) throw new Error('river only: board needs 5 cards');
  if (new Set(board).size !== 5) throw new Error('duplicate board cards');
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;

  // ---- per-player combo lists (board cards removed, zero weights dropped)
  const L = [0, 1, 2].map(p => {
    const idx = [];
    const w = spec.ranges[p];
    for (let i = 0; i < NUM_COMBOS; i++) {
      if (w[i] > 0 && !onBoard[CC1[i]] && !onBoard[CC2[i]]) idx.push(i);
    }
    const n = idx.length;
    const o = {
      n, idx, c1: new Uint8Array(n), c2: new Uint8Array(n), w: new Float64Array(n),
      score: new Float64Array(n), pair: new Int16Array(52 * 52).fill(-1),
    };
    idx.forEach((ci, j) => {
      o.c1[j] = CC1[ci]; o.c2[j] = CC2[ci]; o.w[j] = w[ci];
      o.pair[CC1[ci] * 52 + CC2[ci]] = j; o.pair[CC2[ci] * 52 + CC1[ci]] = j;
    });
    scoreHands(board, o.c1, o.c2, n, o.score);
    o.sorted = Array.from({ length: n }, (_, j) => j).sort((a, b) => o.score[a] - o.score[b]);
    return o;
  });
  for (let p = 0; p < 3; p++) if (L[p].n === 0) throw new Error(`seat ${p} has an empty range (after removing board cards)`);
  // compat[p][q][i * nq + j] = 1 when combos share no card
  const compat = [0, 1, 2].map(() => [null, null, null]);
  for (let p = 0; p < 3; p++) {
    for (let q = 0; q < 3; q++) {
      if (p === q) continue;
      const a = L[p], b = L[q], m = new Uint8Array(a.n * b.n);
      for (let i = 0; i < a.n; i++) {
        for (let j = 0; j < b.n; j++) {
          m[i * b.n + j] = (a.c1[i] !== b.c1[j] && a.c1[i] !== b.c2[j] && a.c2[i] !== b.c1[j] && a.c2[i] !== b.c2[j]) ? 1 : 0;
        }
      }
      compat[p][q] = m;
    }
  }

  // ---------------------------------------------------------------- tree
  const nodes = [];
  function mkTerm(inn, contrib) {
    const t = { t: TERM, in: inn.slice(), contrib: contrib.slice(), pot: P0 + contrib[0] + contrib[1] + contrib[2] };
    nodes.push(t);
    return t;
  }
  function genActions(me, contrib, maxC, nBets) {
    if (folds[me]) return [{ type: 'fold', amount: contrib[me] }];
    const acts = [];
    const my = contrib[me], remaining = stack - my;
    const potNow = P0 + contrib[0] + contrib[1] + contrib[2];
    const sized = to => (to >= stack - EPS || to - my > sizes.allinThreshold * remaining) ? stack : to;
    const add = (type, amount) => {
      if (acts.some(a => a.type !== 'fold' && Math.abs(a.amount - amount) < 1e-6)) return;
      acts.push({ type, amount });
    };
    if (maxC > my + EPS) {
      acts.push({ type: 'fold', amount: my });
      acts.push({ type: 'call', amount: maxC });
      if (maxC < stack - EPS && nBets < sizes.maxBets) {
        const list = sizes.raise.map(m => sized(Math.max(m * maxC, 2 * maxC - my)));
        if (sizes.allin) list.push(stack);
        for (const to of list.sort((a, b) => a - b)) add(to >= stack - EPS ? 'allin' : 'raise', to);
      }
    } else {
      acts.push({ type: 'check', amount: my });
      if (remaining > EPS && nBets < sizes.maxBets) {
        const list = sizes.bet.map(f => sized(my + Math.max(f * potNow, 1)));
        if (sizes.allin) list.push(stack);
        for (const to of list.sort((a, b) => a - b)) add(to >= stack - EPS ? 'allin' : 'bet', to);
      }
    }
    return acts;
  }
  function build(inn, contrib, acted, toAct, nBets) {
    const maxC = Math.max(...contrib);
    const node = { t: ACT, player: toAct, actions: genActions(toAct, contrib, maxC, nBets), kids: [], reg: null, sum: null };
    nodes.push(node);
    for (const a of node.actions) {
      const inn2 = inn.slice(), c2 = contrib.slice(), ac2 = acted.slice();
      let nb = nBets;
      if (a.type === 'fold') { inn2[toAct] = false; ac2[toAct] = false; }
      else if (a.type === 'check' || a.type === 'call') { c2[toAct] = a.amount; ac2[toAct] = true; }
      else { c2[toAct] = a.amount; nb++; ac2.fill(false); ac2[toAct] = true; }
      const cnt = inn2.filter(Boolean).length;
      const mx = Math.max(...c2);
      let kid;
      if (cnt === 1) kid = mkTerm(inn2, c2);
      else if ([0, 1, 2].every(q => !inn2[q] || (ac2[q] && c2[q] === mx))) kid = mkTerm(inn2, c2);
      else kid = build(inn2, c2, ac2, nextIn(inn2, toAct), nb);
      node.kids.push(kid);
    }
    const n = L[toAct].n, A = node.actions.length;
    node.reg = new Float64Array(A * n); node.sum = new Float64Array(A * n);
    return node;
  }
  const root = build([true, true, true], [0, 0, 0], [false, false, false], 0, 0);

  // ------------------------------------------------- CFR update machinery
  let iterations = 0;
  function strat(node) { // regret matching (regrets are floored at 0: CFR+)
    const n = L[node.player].n, A = node.actions.length, reg = node.reg;
    const S = new Float64Array(A * n);
    for (let h = 0; h < n; h++) {
      let tot = 0;
      for (let a = 0; a < A; a++) tot += reg[a * n + h];
      if (tot > 0) for (let a = 0; a < A; a++) S[a * n + h] = reg[a * n + h] / tot;
      else for (let a = 0; a < A; a++) S[a * n + h] = 1 / A;
    }
    return S;
  }

  const csTmp = [0, 1, 2].map(() => new Float64Array(52));
  function cardSums(p, r, cs) {
    cs.fill(0);
    const l = L[p];
    let tot = 0;
    for (let j = 0; j < l.n; j++) { const v = r[j]; if (v) { cs[l.c1[j]] += v; cs[l.c2[j]] += v; tot += v; } }
    return tot;
  }
  // sum over t-combos disjoint from cards x0..x3 (inclusion-exclusion):
  // Rt - sum cs[x] + sum over pairs (xi,xj) that are t-combos of rt.
  function pairSum(p, o, t, ro, rt, winU, tieU, loseU, out) {
    const lp = L[p], lo = L[o], lt = L[t];
    const cs = csTmp[t];
    const Rt = cardSums(t, rt, cs);
    const cm = compat[p][o], no = lo.n, pt = lt.pair;
    const constant = winU === tieU && tieU === loseU;
    for (let h = 0; h < lp.n; h++) {
      const h1 = lp.c1[h], h2 = lp.c2[h], sp = lp.score[h];
      let acc = 0;
      const base = Rt - cs[h1] - cs[h2];
      const jh = pt[h1 * 52 + h2];
      const hh = jh >= 0 ? rt[jh] : 0;
      for (let j = 0; j < no; j++) {
        const w = ro[j];
        if (w === 0 || cm[h * no + j] === 0) continue;
        const q1 = lo.c1[j], q2 = lo.c2[j];
        let c = base - cs[q1] - cs[q2] + hh;
        let k = pt[q1 * 52 + q2]; if (k >= 0) c += rt[k];
        k = pt[h1 * 52 + q1]; if (k >= 0) c += rt[k];
        k = pt[h1 * 52 + q2]; if (k >= 0) c += rt[k];
        k = pt[h2 * 52 + q1]; if (k >= 0) c += rt[k];
        k = pt[h2 * 52 + q2]; if (k >= 0) c += rt[k];
        if (constant) acc += winU * w * c;
        else {
          const so = lo.score[j];
          acc += (sp > so ? winU : sp === so ? tieU : loseU) * w * c;
        }
      }
      out[h] += acc;
    }
  }
  const XP = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const clA = new Float64Array(52), cleA = new Float64Array(52), csA = new Float64Array(52);
  function threeWay(p, term, reach, out) {
    const q = (p + 1) % 3, r = (p + 2) % 3;
    const lp = L[p], lq = L[q], lr = L[r], rq = reach[q], rr = reach[r];
    const c = term.contrib[p], pot = term.pot, base = -c - P0 / 3;
    const winU = pot + base, tie2 = pot / 2 + base, tie3 = pot / 3 + base, loseU = base;
    clA.fill(0); cleA.fill(0);
    const Rall = cardSums(r, rr, csA);
    let Ll = 0, Lle = 0, pL = 0, pLE = 0;
    const cm = compat[p][q], nq = lq.n, pr = lr.pair, sr = lr.score, srt = lr.sorted;
    for (const h of lp.sorted) {
      const sp = lp.score[h];
      while (pL < lr.n && sr[srt[pL]] < sp) { const j = srt[pL++]; const v = rr[j]; clA[lr.c1[j]] += v; clA[lr.c2[j]] += v; Ll += v; }
      while (pLE < lr.n && sr[srt[pLE]] <= sp) { const j = srt[pLE++]; const v = rr[j]; cleA[lr.c1[j]] += v; cleA[lr.c2[j]] += v; Lle += v; }
      const h1 = lp.c1[h], h2 = lp.c2[h];
      let acc = 0;
      for (let j = 0; j < nq; j++) {
        const w = rq[j];
        if (w === 0 || cm[h * nq + j] === 0) continue;
        const q1 = lq.c1[j], q2 = lq.c2[j], sq = lq.score[j];
        const x0 = h1, x1 = h2, x2 = q1, x3 = q2;
        let All = Rall - csA[x0] - csA[x1] - csA[x2] - csA[x3];
        let Less = Ll - clA[x0] - clA[x1] - clA[x2] - clA[x3];
        let LE = Lle - cleA[x0] - cleA[x1] - cleA[x2] - cleA[x3];
        for (let u = 0; u < 6; u++) {
          const k = pr[XP[u][0] === 0 ? (x0 * 52 + (XP[u][1] === 1 ? x1 : XP[u][1] === 2 ? x2 : x3))
            : XP[u][0] === 1 ? (x1 * 52 + (XP[u][1] === 2 ? x2 : x3)) : (x2 * 52 + x3)];
          if (k < 0) continue;
          const v = rr[k], s2 = sr[k];
          All += v;
          if (s2 < sp) { Less += v; LE += v; } else if (s2 === sp) LE += v;
        }
        const Eq = LE - Less, Gt = All - LE;
        if (sq > sp) acc += w * loseU * All;
        else if (sq < sp) acc += w * (winU * Less + tie2 * Eq + loseU * Gt);
        else acc += w * (tie2 * Less + tie3 * Eq + loseU * Gt);
      }
      out[h] += acc;
    }
  }
  function termValues(p, term, reach) {
    const out = new Float64Array(L[p].n);
    const q = (p + 1) % 3, r = (p + 2) % 3;
    const cnt = term.in.filter(Boolean).length;
    const base = -term.contrib[p] - P0 / 3;
    if (cnt === 1) {
      const u = (term.in[p] ? term.pot : 0) + base;
      pairSum(p, q, r, reach[q], reach[r], u, u, u, out);
    } else if (cnt === 2) {
      if (!term.in[p]) pairSum(p, q, r, reach[q], reach[r], base, base, base, out);
      else {
        const o = term.in[q] ? q : r, t = term.in[q] ? r : q;
        pairSum(p, o, t, reach[o], reach[t], term.pot + base, term.pot / 2 + base, base, out);
      }
    } else threeWay(p, term, reach, out);
    return out;
  }

  function traverse(node, p, reach, t) {
    if (node.t === TERM) return termValues(p, node, reach);
    const A = node.actions.length, q = node.player, n = L[q].n;
    const S = strat(node);
    if (q === p) {
      const Vs = [], val = new Float64Array(n);
      for (let a = 0; a < A; a++) {
        const r2 = reach.slice();
        const rp = new Float64Array(n);
        for (let h = 0; h < n; h++) {
          rp[h] = reach[p][h] * S[a * n + h];
          node.sum[a * n + h] += t * rp[h];
        }
        r2[p] = rp;
        const V = traverse(node.kids[a], p, r2, t);
        Vs.push(V);
        for (let h = 0; h < n; h++) val[h] += S[a * n + h] * V[h];
      }
      for (let a = 0; a < A; a++) {
        for (let h = 0; h < n; h++) {
          const v = node.reg[a * n + h] + Vs[a][h] - val[h];
          node.reg[a * n + h] = v > 0 ? v : 0;
        }
      }
      return val;
    }
    const out = new Float64Array(L[p].n);
    for (let a = 0; a < A; a++) {
      const r2 = reach.slice();
      const rq = new Float64Array(n);
      for (let h = 0; h < n; h++) rq[h] = reach[q][h] * S[a * n + h];
      r2[q] = rq;
      const V = traverse(node.kids[a], p, r2, t);
      for (let h = 0; h < out.length; h++) out[h] += V[h];
    }
    return out;
  }

  function step(k = 1) {
    for (let i = 0; i < k; i++) {
      iterations++;
      for (let p = 0; p < 3; p++) traverse(root, p, [L[0].w, L[1].w, L[2].w], iterations);
    }
    return iterations;
  }

  // ------------------------------------------------ average strategies
  function avgStrat(node) {
    const n = L[node.player].n, A = node.actions.length, sum = node.sum;
    const S = new Float64Array(A * n);
    for (let h = 0; h < n; h++) {
      let tot = 0;
      for (let a = 0; a < A; a++) tot += sum[a * n + h];
      for (let a = 0; a < A; a++) S[a * n + h] = tot > 0 ? sum[a * n + h] / tot : 1 / A;
    }
    return S;
  }
  function walk(path) {
    let node = root;
    for (const a of path) {
      if (node.t !== ACT || !(a >= 0 && a < node.kids.length)) return null;
      node = node.kids[a];
    }
    return node;
  }
  /** Average strategy of the player to act at `path` (action indices from the
   *  root). Returns { actions, combos, probs: Float64Array(A * n) action-major,
   *  n } or null if `player` does not act there. */
  function strategy(path, player) {
    const node = walk(path);
    if (!node || node.t !== ACT || node.player !== player) return null;
    const n = L[player].n, A = node.actions.length, weight = new Float64Array(n);
    for (let h = 0; h < n; h++) for (let a = 0; a < A; a++) weight[h] += node.sum[a * n + h];
    // weight[h] = accumulated own reach; 0 means the combo never got here
    return { actions: node.actions, combos: L[player].idx, n, probs: avgStrat(node), weight };
  }
  /** Range-weighted action mix of `player` at its first decision on the line
   *  where everybody before it checks: [{ type, amount, freq }]. */
  function rootMix(player) {
    let node = root;
    while (node.t === ACT && node.player !== player) {
      const ci = node.actions.findIndex(a => a.type === 'check');
      if (ci < 0) return null;
      node = node.kids[ci];
    }
    if (node.t !== ACT) return null;
    const S = avgStrat(node), n = L[player].n, A = node.actions.length;
    let tw = 0;
    const f = new Float64Array(A);
    for (let h = 0; h < n; h++) {
      const w = L[player].w[h]; tw += w;
      for (let a = 0; a < A; a++) f[a] += w * S[a * n + h];
    }
    return node.actions.map((a, i) => ({ type: a.type, amount: a.amount, freq: f[i] / tw }));
  }

  // ------------------------------------------- independent best response
  // Own 7-card scoring, brute-force triple loops, own payoff rule. Shares only
  // the tree and the stored average strategies with the CFR code above.
  const score7 = [0, 1, 2].map(p => {
    const l = L[p], s = new Float64Array(l.n);
    for (let j = 0; j < l.n; j++) s[j] = evalCards([...board, l.c1[j], l.c2[j]]);
    return s;
  });
  /** payoffs [u0,u1,u2] at a terminal for 7-card scores sc (folded seats' scores ignored). */
  function payoffs(term, sc) {
    const ins = [0, 1, 2].filter(q => term.in[q]);
    let best = -Infinity;
    for (const q of ins) if (sc[q] > best) best = sc[q];
    const winners = ins.filter(q => sc[q] === best);
    return [0, 1, 2].map(q => (winners.includes(q) ? term.pot / winners.length : 0) - term.contrib[q] - P0 / 3);
  }
  const compatTriple = (i, j, k) => {
    const a = L[0], b = L[1], c = L[2];
    const s = new Set([a.c1[i], a.c2[i], b.c1[j], b.c2[j], c.c1[k], c.c2[k]]);
    return s.size === 6;
  };
  let tripleCache = null;
  function triples() { // list of all compatible (i,j,k), as flat Int32Array
    if (tripleCache) return tripleCache;
    const out = [];
    const a = L[0], b = L[1], c = L[2];
    for (let i = 0; i < a.n; i++) {
      for (let j = 0; j < b.n; j++) {
        if (!compat[0][1][i * b.n + j]) continue;
        for (let k = 0; k < c.n; k++) {
          if (compat[0][2][i * c.n + k] && compat[1][2][j * c.n + k]) out.push(i, j, k);
        }
      }
    }
    return (tripleCache = Int32Array.from(out));
  }
  // Value of walking the tree. Players other than p play their average
  // strategy; p plays a best response (mode 'br') or its average ('avg').
  // Returns the sum over compatible deals of w0 w1 w2 * u_p, as a vector over
  // p's combos: V[h] = sum over opponent pairs.
  // masks[k][t]: bitmask of winners among the players in set `k` (bit i =
  // seat i; k = 7, 3, 5, 6 are the in-sets {012},{01},{02},{12}), per triple.
  let maskCache = null;
  function masks() {
    if (maskCache) return maskCache;
    const T = triples(), nT = T.length / 3;
    const sets = [7, 3, 5, 6], res = {};
    for (const m of sets) res[m] = new Uint8Array(nT);
    for (let u = 0; u < nT; u++) {
      const sc = [score7[0][T[3 * u]], score7[1][T[3 * u + 1]], score7[2][T[3 * u + 2]]];
      for (const m of sets) {
        let best = -Infinity, win = 0;
        for (let x = 0; x < 3; x++) if ((m >> x) & 1 && sc[x] > best) best = sc[x];
        for (let x = 0; x < 3; x++) if ((m >> x) & 1 && sc[x] === best) win |= 1 << x;
        res[m][u] = win;
      }
    }
    return (maskCache = res);
  }
  const POP = [0, 1, 1, 2, 1, 2, 2, 3];
  const inMask = term => (term.in[0] ? 1 : 0) | (term.in[1] ? 2 : 0) | (term.in[2] ? 4 : 0);
  // Fixed-opponent walk. Others play their stored average strategy (W holds
  // reach-weighted ranges). p: mode 'br' = per-combo max over actions, 'avg' =
  // p's average strategy. Returns V[h] = sum over opponent pairs of reach *
  // u_p for p's combo h.
  function brWalk(node, p, mode, W) {
    const q = (p + 1) % 3, r = (p + 2) % 3;
    if (node.t === TERM) {
      const out = new Float64Array(L[p].n);
      const T = triples(), im = inMask(node), M = POP[im] === 1 ? null : masks()[im];
      const base = -node.contrib[p] - P0 / 3, wq = W[q], wr = W[r];
      const inP = node.in[p] ? 1 : 0, bit = 1 << p;
      for (let u = 0, k = 0; u < T.length; u += 3, k++) {
        const w = wq[T[u + q]] * wr[T[u + r]];
        if (w === 0) continue;
        const win = M ? M[k] : im;
        out[T[u + p]] += w * ((inP && (win & bit) ? node.pot / POP[win] : 0) + base);
      }
      return out;
    }
    const A = node.actions.length, o = node.player, n = L[o].n;
    const S = (o !== p || mode === 'avg') ? avgStrat(node) : null;
    const Vs = [];
    for (let a = 0; a < A; a++) {
      if (o !== p) {
        const w2 = new Float64Array(n);
        for (let h = 0; h < n; h++) w2[h] = W[o][h] * S[a * n + h];
        const W2 = W.slice(); W2[o] = w2;
        Vs.push(brWalk(node.kids[a], p, mode, W2));
      } else Vs.push(brWalk(node.kids[a], p, mode, W));
    }
    const out = new Float64Array(L[p].n);
    if (o !== p) {
      for (let a = 0; a < A; a++) for (let h = 0; h < out.length; h++) out[h] += Vs[a][h];
    } else {
      for (let h = 0; h < n; h++) {
        if (mode === 'avg') { for (let a = 0; a < A; a++) out[h] += S[a * n + h] * Vs[a][h]; }
        else { let m = -Infinity; for (let a = 0; a < A; a++) if (Vs[a][h] > m) m = Vs[a][h]; out[h] = m; }
      }
    }
    return out;
  }
  // All three players' values under the average profile in one walk.
  function evWalk(node, W, acc) {
    if (node.t === TERM) {
      const T = triples(), im = inMask(node), M = POP[im] === 1 ? null : masks()[im];
      const w0 = W[0], w1 = W[1], w2 = W[2];
      const u = [0, 1, 2].map(p => -node.contrib[p] - P0 / 3);
      for (let i = 0, k = 0; i < T.length; i += 3, k++) {
        const w = w0[T[i]] * w1[T[i + 1]] * w2[T[i + 2]];
        if (w === 0) continue;
        const win = M ? M[k] : im, share = node.pot / POP[win];
        for (let p = 0; p < 3; p++) acc[p] += w * (((win >> p) & 1 ? share : 0) + u[p]);
      }
      return;
    }
    const A = node.actions.length, o = node.player, n = L[o].n, S = avgStrat(node);
    for (let a = 0; a < A; a++) {
      const w2 = new Float64Array(n);
      for (let h = 0; h < n; h++) w2[h] = W[o][h] * S[a * n + h];
      const W2 = W.slice(); W2[o] = w2;
      evWalk(node.kids[a], W2, acc);
    }
  }
  function mass() {
    const T = triples();
    let m = 0;
    for (let u = 0; u < T.length; u += 3) m += L[0].w[T[u]] * L[1].w[T[u + 1]] * L[2].w[T[u + 2]];
    return m;
  }
  /** Expected value (chips, vs a 1/3 pot share) of player p: its best
   *  response to the two others' average strategies ('br'), or p's own
   *  average strategy ('avg'). */
  function valueOf(p, mode) {
    const V = brWalk(root, p, mode, [L[0].w, L[1].w, L[2].w]);
    let s = 0;
    for (let h = 0; h < L[p].n; h++) s += V[h] * L[p].w[h];
    return s / mass();
  }
  /** { gain: [g0,g1,g2] in % of the pot, br: [...], avg: [...] } */
  function bestResponseGain() {
    const br = [0, 1, 2].map(p => valueOf(p, 'br'));
    const avg = [0, 0, 0];
    evWalk(root, [L[0].w, L[1].w, L[2].w], avg);
    const m = mass();
    for (let p = 0; p < 3; p++) avg[p] /= m;
    return { gain: br.map((b, p) => (b - avg[p]) / P0 * 100), br, avg };
  }

  const terminals = () => nodes.filter(n => n.t === TERM);
  return {
    step, strategy, rootMix, bestResponseGain, valueOf, payoffs, terminals,
    get iterations() { return iterations; },
    get nodeCount() { return nodes.length; },
    combos: p => L[p].idx, root, walk,
    __test: { termValues, L, score7, triples, mass, strat },
  };
}
