// Hand log, leak tracking, orbit bookkeeping and calibration stats (localStorage).
import { className, handClass } from './coach.js';
import { EQ_VS_RANDOM } from './strength.js';

const KEY = 'poker-coach-history-v1';
const MAX_HANDS = 400;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const db = { hands: [], orbit: 1, orbitStart: 0, reviews: {}, calib: { n: 0, hits: 0, width: 0 }, leaks: {}, drills: { n: 0, good: 0, queue: [] }, ...load() };
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { db.hands = db.hands.slice(-150); } };

export const history = db;
let cur = null;

export function beginHand(game) {
  const heroI = game.players.findIndex(p => p.isHero);
  const pos = game.positions();
  cur = {
    no: (db.hands.at(-1)?.no || 0) + 1, orbit: db.orbit, t: Date.now(),
    pos: pos[heroI], cards: game.players[heroI].cards.slice(), n: game.players.filter(p => !p.out).length,
    // stack before the blinds went in, so blind hands show their real result
    start: game.players[heroI].stack + game.players[heroI].totalIn, bb: game.bb, decisions: [],
  };
}

// rec: { street, mix, pick, chosen: 't', label, grade, cls, quality, nodeId, facts, need, eq, values, sit }
export function logDecision(rec) {
  if (!cur) return;
  cur.decisions.push(rec);
  addLeak(rec.leak);
}

// leaks: only clear mistakes on exact/solved spots count
export function addLeak(leak) {
  if (!leak) return;
  const L = db.leaks[leak.key] || { key: leak.key, label: leak.label, n: 0, cost: 0, ev: 0, last: 0 };
  L.n++; L.cost += leak.cost; if (leak.ev) L.ev += leak.ev; L.last = Date.now();
  db.leaks[leak.key] = L;
  persist();
}

export function endHand(game) {
  if (!cur) return null;
  const heroI = game.players.findIndex(p => p.isHero);
  const h = game.players[heroI];
  cur.board = (game.board || []).slice();
  cur.net = h.stack - cur.start;
  cur.folded = h.folded;
  cur.showdown = !!game.result?.showdown;
  cur.shown = game.players.filter((p, i) => i !== heroI && p.shown && !p.folded).map(p => ({ name: p.name, cards: p.cards.slice() }));
  db.hands.push(cur);
  if (db.hands.length > MAX_HANDS) db.hands = db.hands.slice(-MAX_HANDS);
  const done = cur;
  cur = null;
  persist();
  return done;
}

// After the hero's BB hand the orbit closes. Returns the orbit's hands or null.
export function closeOrbitIfDue(lastHand) {
  if (!lastHand || lastHand.pos !== 'BB') return null;
  const hands = db.hands.filter(x => x.orbit === db.orbit);
  db.orbit++;
  persist();
  return hands.length ? hands : null;
}

export const strengthOf = (cards) => EQ_VS_RANDOM[handClass(cards)];
export const handName = (cards) => className(handClass(cards));

// ---------- leaks ----------
// Classify a decision against the solver mix: too tight / loose / passive / aggressive
export function leakOf(rec) {
  if (!rec.mix || !rec.mix.length || !(rec.quality === 'exact' || rec.quality === 'solved')) return null;
  const by = {}; rec.mix.forEach(m => { by[m.t] = (by[m.t] || 0) + m.freq; });
  const f = by[rec.chosen] ?? 0;
  if (f >= 0.15) return null; // in the strategy often enough
  const play = (by.c || 0) + (by.r || 0);
  let dir;
  if (rec.chosen === 'f') dir = 'too tight';
  else if ((by.f || 0) >= 0.5) dir = 'too loose';
  else if (rec.chosen === 'c') dir = 'too passive';
  else dir = 'too aggressive';
  const where = rec.street === 'preflop' ? `${rec.pos} ${rec.sit || ''}`.trim() : `${rec.street} ${rec.facing ? 'facing a bet' : 'first to act'}`;
  const cost = 1 - f;
  let ev = 0;
  if (rec.values && rec.values.length) {
    const best = Math.max(...rec.values);
    const mine = rec.mix.map((m, i) => ({ m, v: rec.values[i] })).filter(x => x.m.t === rec.chosen).map(x => x.v);
    if (mine.length) ev = Math.max(0, best - Math.max(...mine));
  }
  return { key: `${where}|${dir}`, label: `${where}: ${dir}`, cost, ev, play };
}

export function topLeaks(n = 5) {
  return Object.values(db.leaks).sort((a, b) => (b.ev || b.cost) - (a.ev || a.cost)).slice(0, n);
}

// ---------- calibration ----------
export function recordCalibration(lo, hi, truth) {
  const hit = truth >= lo && truth <= hi;
  db.calib.n++; if (hit) db.calib.hits++; db.calib.width += hi - lo;
  persist();
  return hit;
}

// ---------- drills ----------
export function recordDrill(ok, item) {
  db.drills.n++; if (ok) db.drills.good++;
  if (!ok) db.drills.queue.push({ ...item, due: db.drills.n + 3 + Math.floor(Math.random() * 3) });
  persist();
}
export function dueDrill() {
  const i = db.drills.queue.findIndex(q => q.due <= db.drills.n);
  if (i < 0) return null;
  return db.drills.queue.splice(i, 1)[0];
}

export function resetHistory() {
  Object.assign(db, { hands: [], orbit: 1, calib: { n: 0, hits: 0, width: 0 }, leaks: {}, drills: { n: 0, good: 0, queue: [] } });
  persist();
}
export function save() { persist(); }
