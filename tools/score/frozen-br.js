// FROZEN best-response evaluator. Independent of the candidate solver's internals: it walks the
// candidate's tree through the public API (nodeInfo/actionsAt/strategyTable), takes the opponent's
// AVERAGE strategy from strategyTable and computes an exact best response with its own showdown
// code (frozen-eval7.js). Convention (same as js/postflop/solver.js at the base commit): zero-sum,
// each player owns half the street-start pot, exploitability = (BR0+BR1)/2 in % of the root pot.
import { evalCards } from './frozen-eval7.js';

const CC1 = [], CC2 = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) { CC1.push(a); CC2.push(b); }
const N = 1326;

export function bestResponse(api, fx) {
  const board0 = fx.board;
  const bmask = new Uint8Array(52); for (const c of board0) bmask[c] = 1;
  const w = [0, 1].map(p => {
    const a = new Float64Array(N);
    for (const [i, x] of fx.ranges[p]) if (!bmask[CC1[i]] && !bmask[CC2[i]]) a[i] = x;
    return a;
  });
  const ids = w.map(a => { const o = []; for (let i = 0; i < N; i++) if (a[i] > 0) o.push(i); return o; });
  const matCache = new Map();
  function matrix(board) { // oop-row Float64Array n0*n1: sum over runouts of sign(oop - ip) / runouts per pair
    const key = board.join(',');
    let M = matCache.get(key); if (M) return M;
    const n0 = ids[0].length, n1 = ids[1].length;
    M = new Float64Array(n0 * n1);
    const used = new Uint8Array(52); for (const c of board) used[c] = 1;
    const deck = []; for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
    const need = 5 - board.length;
    const runouts = [];
    if (need === 0) runouts.push([]);
    else if (need === 1) for (const c of deck) runouts.push([c]);
    else for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) runouts.push([deck[i], deck[j]]);
    const per = need === 0 ? 1 : need === 1 ? 52 - board.length - 4 : (52 - board.length - 4) * (52 - board.length - 5) / 2;
    const s0 = new Int32Array(n0), s1 = new Int32Array(n1);
    for (const r of runouts) {
      const full = board.concat(r);
      for (let i = 0; i < n0; i++) { const a = CC1[ids[0][i]], b = CC2[ids[0][i]]; s0[i] = r.includes(a) || r.includes(b) ? -1 : evalCards([a, b, ...full], 7); }
      for (let j = 0; j < n1; j++) { const a = CC1[ids[1][j]], b = CC2[ids[1][j]]; s1[j] = r.includes(a) || r.includes(b) ? -1 : evalCards([a, b, ...full], 7); }
      for (let i = 0; i < n0; i++) {
        if (s0[i] < 0) continue;
        const a = CC1[ids[0][i]], b = CC2[ids[0][i]];
        for (let j = 0; j < n1; j++) {
          if (s1[j] < 0) continue;
          const c = CC1[ids[1][j]], d = CC2[ids[1][j]];
          if (a === c || a === d || b === c || b === d) continue;
          M[i * n1 + j] += s0[i] > s1[j] ? 1 : s0[i] < s1[j] ? -1 : 0;
        }
      }
    }
    for (let k = 0; k < M.length; k++) M[k] /= per;
    if (matCache.size > 80) matCache.clear();
    matCache.set(key, M);
    return M;
  }
  function compat(p, reach) { // for each combo index: opponent reach compatible with it
    const CS = new Float64Array(52); let tot = 0;
    for (const j of ids[1 - p]) { const r = reach[j]; tot += r; CS[CC1[j]] += r; CS[CC2[j]] += r; }
    const out = new Float64Array(N);
    for (const h of ids[p]) out[h] = tot - CS[CC1[h]] - CS[CC2[h]] + reach[h];
    return out;
  }
  function showdown(p, reach, board, amt) {
    const M = matrix(board), n1 = ids[1].length, out = new Float64Array(N);
    if (p === 0) {
      for (let i = 0; i < ids[0].length; i++) { let s = 0; for (let j = 0; j < n1; j++) s += M[i * n1 + j] * reach[ids[1][j]]; out[ids[0][i]] = amt * s; }
    } else {
      for (let j = 0; j < n1; j++) { let s = 0; for (let i = 0; i < ids[0].length; i++) s += M[i * n1 + j] * reach[ids[0][i]]; out[ids[1][j]] = -amt * s; }
    }
    return out;
  }
  function br(path, p, reach, info) {
    info = info || api.nodeInfo(path);
    const out = new Float64Array(N);
    if (info.type === 'chance') {
      const wgt = 1 / (52 - info.board.length - 4);
      for (const c of info.cards) {
        const r2 = Float64Array.from(reach);
        for (const j of ids[1 - p]) if (CC1[j] === c || CC2[j] === c) r2[j] = 0;
        const ch = br(path.concat(c), p, r2);
        for (const h of ids[p]) if (CC1[h] !== c && CC2[h] !== c) out[h] += wgt * ch[h];
      }
      return out;
    }
    if (info.type !== 'action') throw new Error('unexpected node ' + info.type);
    const A = api.actionsAt(path), me = info.player;
    const tab = me === p ? null : api.strategyTable(path);
    const kids = A.map((act, a) => {
      let r = reach;
      if (tab) {
        r = new Float64Array(N);
        for (const j of ids[1 - p]) { const q = tab.probs[j * tab.k + a]; r[j] = q > 0 ? reach[j] * q : 0; }
      }
      const cpath = path.concat(a), ci = api.nodeInfo(cpath);
      if (ci.type === 'fold') {
        const amt = info.pot / 2 + info.bets[me], cp = compat(p, r), o = new Float64Array(N);
        for (const h of ids[p]) o[h] = (me === p ? -amt : amt) * cp[h];
        return o;
      }
      if (ci.type === 'showdown' || ci.type === 'runout') return showdown(p, r, ci.board, info.pot / 2 + act.amount);
      return br(cpath, p, r, ci);
    });
    if (me === p) {
      for (const h of ids[p]) { let m = -Infinity; for (const k of kids) if (k[h] > m) m = k[h]; out[h] = m; }
    } else for (const k of kids) for (const h of ids[p]) out[h] += k[h];
    return out;
  }
  const root = api.nodeInfo([]);
  const rootPot = root.pot + root.bets[0] + root.bets[1];
  const cp0 = compat(0, w[1]);
  let pairW = 0; for (const h of ids[0]) pairW += w[0][h] * cp0[h];
  const v = [0, 1].map(p => {
    const c = br([], p, w[1 - p], root);
    let s = 0; for (const h of ids[p]) s += w[p][h] * c[h];
    return s / pairW;
  });
  return { exploit: (v[0] + v[1]) / 2 / rootPot * 100, br: v };
}
