// Preflop solver: external-sampling MCCFR with linear (epoch) discounting.
// Terminal values: equity x a position/hand-shape realization factor, normalized so the pot is conserved.
//
//   node tools/solve.js <players> <minutes> [seed]
//
// Writes data/preflop-<n>.bin (uint8 average strategy) and data/preflop-<n>.log.
import fs from 'fs';
import { buildTree, POSITIONS, postflopRank, STACK } from '../js/preflop-tree.js';
import { evalHand } from '../js/cards.js';
import { handClass, className } from '../js/coach.js';

const N = +(process.argv[2] || 2);
const MINUTES = +(process.argv[3] || 1);
let seed = +(process.argv[4] || 1) >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
fs.mkdirSync('data', { recursive: true });
const LOG = `data/preflop-${N}.log`;
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(LOG, s + '\n'); };

// ---------- class helpers ----------
const COMBOS = new Float64Array(169);
for (let c = 0; c < 169; c++) { const x = Math.floor(c / 13), y = c % 13; COMBOS[c] = x === y ? 6 : x > y ? 4 : 12; }

// hand-shape playability used in realization
const PLAY = new Float64Array(169);
for (let c = 0; c < 169; c++) {
  const x = Math.floor(c / 13), y = c % 13;
  const hi = Math.max(x, y), lo = Math.min(x, y);
  let v = 1;
  if (x === y) v = 1.0 + (hi >= 8 ? 0.02 : 0);
  else {
    const suited = x > y, gap = hi - lo - 1;
    if (suited) v += 0.07;
    v += [0.05, 0.03, 0.0, -0.03][Math.min(gap, 3)] - (gap >= 4 ? 0.03 : 0);
    if (!suited && lo < 7 && hi < 12) v -= 0.06; // offsuit junk without an ace/king
    if (hi >= 10 && lo >= 8) v += 0.03; // broadway
  }
  PLAY[c] = v;
}

// ---------- 169x169 equity matrix ----------
const EQ_FILE = 'data/eq169.bin';
let EQ;
function buildEquity(samples = 3000) {
  EQ = new Float32Array(169 * 169);
  const pick = (c, used) => {
    const x = Math.floor(c / 13), y = c % 13;
    for (let tries = 0; tries < 100; tries++) {
      let a, b;
      if (x === y) { const s1 = Math.floor(rnd() * 4); let s2 = Math.floor(rnd() * 3); if (s2 >= s1) s2++; a = x * 4 + s1; b = x * 4 + s2; }
      else if (x > y) { const s = Math.floor(rnd() * 4); a = x * 4 + s; b = y * 4 + s; }
      else { const s1 = Math.floor(rnd() * 4); let s2 = Math.floor(rnd() * 3); if (s2 >= s1) s2++; a = y * 4 + s1; b = x * 4 + s2; }
      if (!used.has(a) && !used.has(b)) return [a, b];
    }
    return null;
  };
  const t0 = Date.now();
  for (let i = 0; i < 169; i++) {
    for (let j = i; j < 169; j++) {
      let w = 0, cnt = 0;
      for (let s = 0; s < samples; s++) {
        const used = new Set();
        const h1 = pick(i, used); if (!h1) continue; h1.forEach(c => used.add(c));
        const h2 = pick(j, used); if (!h2) continue; h2.forEach(c => used.add(c));
        const board = [];
        while (board.length < 5) { const c = Math.floor(rnd() * 52); if (!used.has(c)) { used.add(c); board.push(c); } }
        const a = evalHand([...h1, ...board]), b = evalHand([...h2, ...board]);
        w += a > b ? 1 : a === b ? 0.5 : 0; cnt++;
      }
      const e = cnt ? w / cnt : 0.5;
      EQ[i * 169 + j] = e; EQ[j * 169 + i] = 1 - e;
    }
  }
  fs.writeFileSync(EQ_FILE, Buffer.from(EQ.buffer));
  log(`equity matrix built in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (fs.existsSync(EQ_FILE)) EQ = new Float32Array(new Uint8Array(fs.readFileSync(EQ_FILE)).buffer);
else buildEquity();

// ---------- tree as flat arrays ----------
const tree = buildTree(N);
const nodes = tree.nodes;
let size = 0;
const OFF = new Int32Array(nodes.length).fill(-1);
for (const nd of nodes) if (!nd.term) { OFF[nd.id] = size; size += 169 * nd.acts.length; }
const regret = new Float64Array(size);
const stratSum = new Float64Array(size);
const VIS = new Uint32Array(nodes.length * 169); // traverser visits per node and hand class
log(`${N} players (${POSITIONS[N].join(' ')}), ${nodes.length} nodes, ${size} entries, ${MINUTES} min, seed ${process.argv[4] || 1}`);

// realization weights for live players at a showdown terminal
function realization(live, cls) {
  const order = live.slice().sort((a, b) => postflopRank(N, a) - postflopRank(N, b));
  const k = live.length;
  const R = {};
  order.forEach((p, idx) => {
    const base = k === 2 ? (idx === 1 ? 1.06 : 0.9) : 0.86 + 0.2 * idx / (k - 1);
    R[p] = base * PLAY[cls[p]];
  });
  return R;
}

// utility of every player at a terminal for the sampled deal
const util = new Float64Array(8);
function terminal(nd, hands, cls) {
  const put = nd.put;
  const pot = put.reduce((s, x) => s + x, 0);
  for (let i = 0; i < N; i++) util[i] = -put[i];
  if (nd.term === 'fold') { util[nd.live[0]] += pot; return; }
  const live = nd.live;
  const R = realization(live, cls);
  // less postflop play left = realization closer to plain equity (all-in: exactly equity)
  const spr = (STACK - Math.max(...put)) / pot;
  const w = Math.min(1, spr / 3);
  for (const p of live) R[p] = 1 + (R[p] - 1) * w;
  let eq;
  if (live.length === 2) {
    const [a, b] = live;
    const e = EQ[cls[a] * 169 + cls[b]];
    eq = { [a]: e, [b]: 1 - e };
  } else {
    // sample a few boards with the real cards
    eq = {}; for (const p of live) eq[p] = 0;
    const BOARDS = 6;
    const base = new Set(hands.flat());
    for (let b = 0; b < BOARDS; b++) {
      const used = new Set(base);
      const board = [];
      while (board.length < 5) { const c = Math.floor(rnd() * 52); if (!used.has(c)) { used.add(c); board.push(c); } }
      let best = -1, winners = [];
      for (const p of live) {
        const s = evalHand([...hands[p], ...board]);
        if (s > best) { best = s; winners = [p]; } else if (s === best) winners.push(p);
      }
      for (const p of winners) eq[p] += 1 / winners.length / BOARDS;
    }
  }
  let tot = 0;
  for (const p of live) tot += eq[p] * R[p];
  if (tot === 0) { for (const p of live) util[p] += pot / live.length; return; }
  for (const p of live) util[p] += pot * eq[p] * R[p] / tot;
}

const strat = new Float64Array(8);
function currentStrategy(off, k) {
  let s = 0;
  for (let a = 0; a < k; a++) { const r = regret[off + a]; strat[a] = r > 0 ? r : 0; s += strat[a]; }
  if (s > 0) for (let a = 0; a < k; a++) strat[a] /= s; else for (let a = 0; a < k; a++) strat[a] = 1 / k;
}

// external sampling traversal; returns traverser's utility
function traverse(id, tr, hands, cls) {
  const nd = nodes[id];
  if (nd.term) { terminal(nd, hands, cls); return util[tr]; }
  const k = nd.acts.length;
  const off = OFF[id] + cls[nd.p] * k;
  currentStrategy(off, k);
  if (nd.p === tr) {
    VIS[id * 169 + cls[nd.p]]++;
    const sigma = Array.from(strat.subarray(0, k));
    const v = new Float64Array(k);
    let ev = 0;
    for (let a = 0; a < k; a++) { v[a] = traverse(nd.acts[a].next, tr, hands, cls); ev += sigma[a] * v[a]; }
    for (let a = 0; a < k; a++) regret[off + a] += v[a] - ev;
    return ev;
  }
  // opponent: accumulate average strategy, sample one action
  for (let a = 0; a < k; a++) stratSum[off + a] += strat[a];
  let r = rnd(), a = 0;
  for (; a < k - 1; a++) { r -= strat[a]; if (r <= 0) break; }
  return traverse(nd.acts[a].next, tr, hands, cls);
}

function deal() {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const hands = [];
  for (let p = 0; p < N; p++) {
    const h = [];
    for (let k = 0; k < 2; k++) { const j = Math.floor(rnd() * deck.length); h.push(deck[j]); deck[j] = deck[deck.length - 1]; deck.pop(); }
    hands.push(h);
  }
  return hands;
}

// ---------- reading the average strategy ----------
function avg(id, c) {
  const nd = nodes[id], k = nd.acts.length, off = OFF[id] + c * k;
  let s = 0; for (let a = 0; a < k; a++) s += stratSum[off + a];
  return Array.from({ length: k }, (_, a) => (s > 0 ? stratSum[off + a] / s : 1 / k));
}

// open-raise (first in) frequency for each position, combo weighted
function rfiReport() {
  const out = [];
  let id = 0;
  for (let p = 0; p < N - 1; p++) {
    const nd = nodes[id];
    const ri = nd.acts.findIndex(a => a.t === 'r');
    let w = 0, tot = 0;
    for (let c = 0; c < 169; c++) { w += COMBOS[c] * avg(id, c)[ri]; tot += COMBOS[c]; }
    const ci = nd.acts.findIndex(a => a.t === 'c');
    let lw = 0; if (ci >= 0) for (let c = 0; c < 169; c++) lw += COMBOS[c] * avg(id, c)[ci];
    out.push(`${POSITIONS[N][p]} ${(100 * w / tot).toFixed(1)}%${ci >= 0 ? `(+${(100 * lw / tot).toFixed(0)}% limp)` : ''}`);
    const f = nd.acts.find(a => a.t === 'f');
    if (!f) break;
    id = f.next;
  }
  return out.join('  ');
}

// BB defense vs a BTN (or SB in heads-up) open, and AA folding anywhere
function checks() {
  const lines = [];
  // walk: everyone folds to BTN (or SB heads-up), it opens, folds to BB
  let id = 0;
  const opener = N === 2 ? 0 : POSITIONS[N].indexOf('BTN');
  for (let p = 0; p < opener; p++) id = nodes[id].acts.find(a => a.t === 'f').next;
  id = nodes[id].acts.find(a => a.t === 'r').next;
  while (!nodes[id].term && POSITIONS[N][nodes[id].p] !== 'BB') id = nodes[id].acts.find(a => a.t === 'f').next;
  if (!nodes[id].term) {
    let w = 0, tot = 0; const fi = nodes[id].acts.findIndex(a => a.t === 'f');
    for (let c = 0; c < 169; c++) { w += COMBOS[c] * (1 - avg(id, c)[fi]); tot += COMBOS[c]; }
    lines.push(`BB defends vs ${POSITIONS[N][opener]} ${(100 * w / tot).toFixed(1)}%`);
  }
  // AA folding, only where AA's own line actually gets there (own reach > 2%)
  const AA = 12 * 13 + 12;
  let aaFold = 0, where = '';
  const walk = (id, reach, path) => {
    const nd = nodes[id];
    if (nd.term) return;
    const s = avg(id, AA);
    const fi = nd.acts.findIndex(a => a.t === 'f');
    const r = reach[nd.p];
    if (fi >= 0 && r > 0.02 && VIS[id * 169 + AA] >= 200 && s[fi] > aaFold) { aaFold = s[fi]; where = path + ` [${POSITIONS[N][nd.p]} reach ${(r * 100).toFixed(0)}%]`; }
    nd.acts.forEach((a, ai) => {
      const r2 = reach.slice(); r2[nd.p] *= s[ai];
      if (r2[nd.p] > 0.02) walk(a.next, r2, path + ' ' + POSITIONS[N][nd.p] + ':' + a.t);
    });
  };
  walk(0, new Array(N).fill(1), '');
  lines.push(`max AA fold ${(100 * aaFold).toFixed(2)}%${aaFold > 0.01 ? ' at' + where : ''}`);
  return lines.join('  ');
}

// heads-up only: exact best-response exploitability (class level, no card removal)
function exploitability() {
  if (N !== 2) return null;
  const uTerm = (nd, me, c, op, j) => {
    const pot = nd.put[0] + nd.put[1];
    if (nd.term === 'fold') return (nd.live[0] === me ? pot : 0) - nd.put[me];
    const live = [0, 1];
    const cls = me === 0 ? [c, j] : [j, c];
    const R = realization(live, cls);
    const w = Math.min(1, (STACK - Math.max(...nd.put)) / pot / 3);
    for (const p of live) R[p] = 1 + (R[p] - 1) * w;
    const e = EQ[c * 169 + j];
    const em = e * R[me], eo = (1 - e) * R[op];
    return pot * em / (em + eo) - nd.put[me];
  };
  // value vector for `me` given opponent reach weights (169)
  function br(id, me, reach) {
    const nd = nodes[id];
    const op = 1 - me;
    if (nd.term) {
      const v = new Float64Array(169);
      for (let c = 0; c < 169; c++) {
        let s = 0;
        for (let j = 0; j < 169; j++) if (reach[j] > 0) s += reach[j] * uTerm(nd, me, c, op, j);
        v[c] = s;
      }
      return v;
    }
    if (nd.p === me) {
      let best = null;
      for (const a of nd.acts) {
        const v = br(a.next, me, reach);
        if (!best) best = v; else for (let c = 0; c < 169; c++) best[c] = Math.max(best[c], v[c]);
      }
      return best;
    }
    const tot = new Float64Array(169);
    nd.acts.forEach((a, ai) => {
      const r2 = new Float64Array(169);
      for (let j = 0; j < 169; j++) r2[j] = reach[j] * avg(id, j)[ai];
      const v = br(a.next, me, r2);
      for (let c = 0; c < 169; c++) tot[c] += v[c];
    });
    return tot;
  }
  const prior = Float64Array.from(COMBOS);
  const Z = 1326 * 1326;
  let sum = 0;
  for (const me of [0, 1]) {
    const v = br(0, me, prior);
    let s = 0; for (let c = 0; c < 169; c++) s += COMBOS[c] * v[c];
    sum += s / Z;
  }
  return sum / 2; // BB per hand each player could gain on average
}

function writeOut() {
  const bytes = new Uint8Array(size);
  for (const nd of nodes) {
    if (nd.term) continue;
    const k = nd.acts.length;
    for (let c = 0; c < 169; c++) {
      const s = avg(nd.id, c);
      // round so each row sums to ~255
      for (let a = 0; a < k; a++) bytes[OFF[nd.id] + c * k + a] = Math.round(s[a] * 255);
    }
  }
  fs.writeFileSync(`data/preflop-${N}.bin`, bytes);
  // per node: log2 of total traverser visits (the coach marks thin spots as estimates)
  const vis = new Uint8Array(nodes.length);
  for (const nd of nodes) {
    if (nd.term) continue;
    let t = 0; for (let c = 0; c < 169; c++) t += VIS[nd.id * 169 + c];
    vis[nd.id] = Math.min(255, Math.round(Math.log2(t + 1) * 4));
  }
  fs.writeFileSync(`data/preflop-${N}.vis`, vis);
}

// ---------- run ----------
const EPOCH = 20000;            // iterations per discount epoch
const DISCOUNT_UNTIL = 2000;    // epochs of linear discounting (then plain averaging)
const REPORT_MS = Math.max(15000, MINUTES * 60000 / 40);
const t0 = Date.now();
let it = 0, epoch = 0, nextReport = t0 + REPORT_MS;
for (;;) {
  const hands = deal();
  const cls = hands.map(handClass);
  for (let tr = 0; tr < N; tr++) traverse(0, tr, hands, cls);
  it++;
  if (it % EPOCH === 0) {
    epoch++;
    if (epoch <= DISCOUNT_UNTIL) {
      const d = epoch / (epoch + 1);
      for (let i = 0; i < size; i++) { regret[i] *= d; stratSum[i] *= d; }
    }
    const now = Date.now();
    const done = now - t0 >= MINUTES * 60000;
    if (now >= nextReport || done) {
      nextReport = now + REPORT_MS;
      const ex = exploitability();
      log(`${((now - t0) / 60000).toFixed(1)}m it ${it} | RFI ${rfiReport()} | ${checks()}${ex !== null ? ` | exploitability ${(ex * 1000).toFixed(1)} mbb/hand` : ''}`);
      writeOut();
    }
    if (done) break;
  }
}
log('done');
