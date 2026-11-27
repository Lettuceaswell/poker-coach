// Turns solver data and ranges into coaching: the "why" facts, range grids, where your
// hand sits in your range, board reads, blockers. Everything is computed, nothing invented.
import { mapSpot, treeFor, strategyAt, handClass, className, reachAt } from './coach.js';
import { POSITIONS, STACK } from './preflop-tree.js';
import { preflopRanges, toCombos, narrow, equityVsRanges, strengthTable, COMBOS } from './ranges.js';
import { EQ_VS_RANDOM } from './strength.js';
import { rankOf, suitOf, evalHand, category } from './cards.js';

const RN = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
const COMBOS169 = Array.from({ length: 169 }, (_, c) => { const x = Math.floor(c / 13), y = c % 13; return x === y ? 6 : x > y ? 4 : 12; });
const pct = (x) => `${Math.round(x * 100)}%`;
const bb = (game, chips) => { const v = chips / game.bb; return Number.isInteger(v) ? `${v}` : v.toFixed(1); };

// ---------- preflop ----------
// Mix per class at a tree node: [{t, freq}]
export function nodeMixes(strat, node) {
  return Array.from({ length: 169 }, (_, c) => {
    const p = strategyAt(strat, node, c);
    return p ? node.acts.map((a, i) => ({ t: a.t, to: a.to, freq: p[i] })) : null;
  });
}

// Share of all hands that continue (don't fold) at this node, combo-weighted
function playShare(mixes) {
  let w = 0, t = 0;
  mixes.forEach((m, c) => { if (!m) return; const f = m.filter(x => x.t !== 'f').reduce((s, x) => s + x.freq, 0); w += COMBOS169[c] * f; t += COMBOS169[c]; });
  return t ? w / t : 0;
}

function situation(game, heroSeat) {
  const labels = game.positions();
  const before = [];
  for (const h of game.history) { if (h.street !== 'preflop') break; before.push(h); }
  const raises = before.filter(h => h.type === 'raise');
  const limps = before.filter(h => h.type === 'call' && h.amount <= game.bb && !raises.length);
  if (!raises.length) return limps.length ? `${limps.length} limper${limps.length > 1 ? 's' : ''} in, the pot is unopened` : 'Folded to you';
  const last = raises[raises.length - 1];
  const who = labels[last.seat];
  const word = raises.length === 1 ? 'open' : raises.length === 2 ? '3-bet' : raises.length === 3 ? '4-bet' : 'raise';
  const mine = raises.some(r => r.seat === heroSeat);
  return `Facing ${mine && raises.length >= 2 ? 'a ' : who + "'s "}${word}${mine && raises.length >= 2 ? ` from ${who}` : ''} to ${bb(game, last.amount)} BB`;
}

// Blockers: how much of a villain's premium hands your cards remove
function blockerFact(cards) {
  const ranks = cards.map(rankOf);
  const out = [];
  if (ranks.includes(12) && ranks[0] !== ranks[1]) out.push('your ace halves their AA combos and cuts AK by a quarter');
  else if (ranks.includes(11) && ranks[0] !== ranks[1]) out.push('your king halves their KK combos and cuts AK by a quarter');
  return out.length ? `Blockers: ${out[0]}.` : '';
}

// Everything the coach panel needs for a preflop decision.
export function preflopDetail(game, heroSeat, strat) {
  const m = mapSpot(game);
  if (!m.node || !strat) return null;
  const hero = game.players[heroSeat];
  const cls = handClass(hero.cards);
  const mixes = nodeMixes(strat, m.node);
  const reach = reachAt(strat, n0(game), m.path, m.node.p);
  const mine = mixes[cls] || [];
  const facts = [];
  const n = game.players.filter(p => !p.out).length;
  const pos = game.positions()[heroSeat];
  facts.push(`${pos} · ${situation(game, heroSeat)}.`);
  const share = playShare(mixes.map((m, c) => (reach[c] >= 0.05 ? m : null)));
  facts.push(`From ${pos} here the solver plays ${pct(share)} of hands.`);

  // where this hand sits among the hands that play
  const played = [...Array(169).keys()].filter(c => reach[c] >= 0.05 && mixes[c] && mixes[c].filter(x => x.t !== 'f').reduce((s, x) => s + x.freq, 0) >= 0.5)
    .sort((a, b) => EQ_VS_RANDOM[b] - EQ_VS_RANDOM[a]);
  const name = className(cls);
  const k = played.indexOf(cls);
  if (k >= 0) {
    const top = (k + 1) / played.length;
    facts.push(top <= 0.34 ? `${name} is near the top of that range (top ${pct(top)} by strength).`
      : top >= 0.8 ? `${name} is near the bottom of that range: one of the weakest hands that still plays.`
      : `${name} sits in the middle of that range.`);
  } else if (played.length) {
    const weakest = played[played.length - 1];
    facts.push(`${name} is outside the playing range; the weakest hand that plays here is ${className(weakest)}.`);
  }
  // mixed strategy
  const byT = {}; mine.forEach(x => { byT[x.t] = (byT[x.t] || 0) + x.freq; });
  const topF = Math.max(0, ...Object.values(byT));
  if (topF < 0.85 && topF > 0) facts.push('Mixed spot: the options are close in value, so the solver splits them and the die picks.');

  // facing a raise: price vs equity against their range
  const L = game.legal();
  let eqOut = null, needOut = null;
  if (L.toCall > 0) {
    const need = L.toCall / (game.totalPot + L.toCall);
    needOut = need;
    const raisers = game.history.filter(h => h.street === 'preflop' && h.type === 'raise');
    const agg = raisers.length ? raisers[raisers.length - 1].seat : null;
    if (agg !== null && agg !== heroSeat) {
      const { ranges } = preflopRanges(game, strat);
      const vr = toCombos(ranges.get(agg), hero.cards);
      const eq = equityVsRanges(hero.cards, [], [vr], 500);
      eqOut = eq;
      if (eq !== null) facts.push(`Price: you need ${pct(need)} to call; ${name} has ${pct(eq)} against ${game.positions()[agg]}'s range (before position effects).`);
    } else facts.push(`Price: you need ${pct(need)} to call.`);
  }
  if (m.quality === 'approx' && /limper/.test(m.why || '')) facts.push('The solved tree has no limps, so this grid is the open range with the limper treated as dead money; raise a bit bigger (+1 BB per limper).');
  const bl = blockerFact(hero.cards);
  if (bl) facts.push(bl);
  if (reach[cls] < 0.05) facts.push(`The solver would almost never have ${className(cls)} here after your earlier action, so this spot has little data; treat the mix as rough.`);
  return { node: m.node, n, mixes, cls, facts, quality: m.quality, why: m.why, pos, eq: eqOut, need: needOut, reach, path: m.path };
}

const n0 = (game) => game.players.filter(p => !p.out).length;

// Rebuild a stored preflop decision's grid (for replays)
export function storedPreflopGrid(strategies, rec) {
  const S = strategies[rec.n];
  if (!S || !S.strat || rec.nodeId == null) return null;
  const node = treeFor(rec.n).nodes[rec.nodeId];
  return { mixes: nodeMixes(S.strat, node), reach: rec.path ? reachAt(S.strat, rec.n, rec.path, node.p) : null };
}

// ---------- postflop ----------
export function boardTags(board) {
  const tags = [];
  const ranks = board.map(rankOf), suits = board.map(suitOf);
  const sc = [0, 0, 0, 0]; suits.forEach(s => sc[s]++);
  const maxS = Math.max(...sc);
  tags.push(maxS >= 3 ? (board.length === 3 ? 'monotone' : 'flush possible') : maxS === 2 ? 'two-tone' : 'rainbow');
  if (new Set(ranks).size < ranks.length) tags.push('paired');
  const u = [...new Set(ranks)].sort((a, b) => a - b);
  let conn = 0;
  for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) if (u[j] - u[i] <= 4) conn++;
  if (u.includes(12)) for (const r of u) if (r <= 3) conn++;
  tags.push(conn >= 3 ? 'connected' : conn >= 1 ? 'some straight draws' : 'disconnected');
  const hi = Math.max(...ranks);
  tags.push(hi === 12 ? 'ace-high' : hi >= 9 ? 'broadway-high' : 'low');
  const wet = (maxS >= 2 ? 1 : 0) + (conn >= 2 ? 1 : 0);
  tags.unshift(wet >= 2 ? 'wet' : wet === 0 ? 'dry' : 'semi-wet');
  return tags;
}

function draws(hole, board) {
  const out = [];
  if (board.length >= 5) return out;
  const all = [...hole, ...board];
  const sc = [0, 0, 0, 0]; all.forEach(c => sc[suitOf(c)]++);
  const fs = sc.findIndex(x => x === 4);
  if (fs >= 0 && hole.some(c => suitOf(c) === fs)) out.push('a flush draw (9 outs)');
  const ranks = new Set(all.map(rankOf)); if (ranks.has(12)) ranks.add(-1);
  const made = category(evalHand(all.length >= 5 ? all : [...all])) >= 4;
  if (!made) {
    for (let lo = -1; lo <= 8; lo++) {
      const win = [0, 1, 2, 3].map(k => ranks.has(lo + k));
      if (win.every(Boolean) && lo >= 0 && lo + 4 <= 12) { out.push('an open-ended straight draw (8 outs)'); break; }
    }
  }
  return out;
}

// weighted share of a combo range at or above a strength percentile
function share(w, pctTable, min) {
  let a = 0, t = 0;
  for (let i = 0; i < 1326; i++) if (w[i]) { t += w[i]; if (pctTable[i] >= min) a += w[i]; }
  return t ? a / t : 0;
}

// Range-vs-range equity by sampling one combo from each side
function rangeEquity(wA, wB, board, sims = 400) {
  const tA = wA.reduce((s, x) => s + x, 0), tB = wB.reduce((s, x) => s + x, 0);
  if (!tA || !tB) return null;
  const draw = (w, t) => { let r = Math.random() * t; for (let i = 0; i < 1326; i++) { r -= w[i]; if (r <= 0) return i; } return 1325; };
  let won = 0, n = 0;
  for (let s = 0; s < sims * 3 && n < sims; s++) {
    const [a1, a2] = COMBOS[draw(wA, tA)], [b1, b2] = COMBOS[draw(wB, tB)];
    const used = new Set([...board, a1, a2]);
    if (used.has(b1) || used.has(b2)) continue;
    used.add(b1); used.add(b2);
    const full = board.slice();
    while (full.length < 5) { const c = Math.floor(Math.random() * 52); if (!used.has(c)) { used.add(c); full.push(c); } }
    const x = evalHand([a1, a2, ...full]), y = evalHand([b1, b2, ...full]);
    won += x > y ? 1 : x === y ? 0.5 : 0; n++;
  }
  return n ? won / n : null;
}

// Postflop coaching detail. `solved` (optional) = worker detail for heads-up spots:
// { range (hero side, solver order), probs, actions, values, toRangesOrder }
export function postflopDetail(game, heroSeat, strat, solved = null) {
  const hero = game.players[heroSeat];
  const { ranges } = preflopRanges(game, strat);
  const board = game.board;
  const dead = board;
  const own = narrow(game, heroSeat, toCombos(ranges.get(heroSeat), dead));
  const villains = [];
  game.players.forEach((p, i) => { if (i !== heroSeat && !p.folded && !p.out) villains.push({ seat: i, w: narrow(game, i, toCombos(ranges.get(i), [...dead, ...hero.cards])) }); });
  const table = strengthTable(board);
  const heroIdx = COMBOS.findIndex(([a, b]) => (a === hero.cards[0] && b === hero.cards[1]) || (a === hero.cards[1] && b === hero.cards[0]));
  // percentile of the hero's hand inside their own range
  let below = 0, tot = 0;
  for (let i = 0; i < 1326; i++) if (own[i]) { tot += own[i]; if (table[i] < table[heroIdx]) below += own[i]; }
  const rankInRange = tot ? below / tot : null;

  const facts = [];
  const tags = boardTags(board);
  facts.push(`Board: ${tags.join(', ')}.`);
  if (rankInRange !== null) facts.push(`Your hand beats ${pct(rankInRange)} of your own range here: ${rankInRange >= 0.8 ? 'a value hand' : rankInRange >= 0.5 ? 'medium strength' : rankInRange >= 0.25 ? 'a bluff-catcher or draw' : 'the bottom of your range'}.`);
  const dr = draws(hero.cards, board);
  if (dr.length) facts.push(`You have ${dr.join(' and ')}.`);
  const L = game.legal();
  const eq = equityVsRanges(hero.cards, board, villains.map(v => v.w), 600);
  if (eq !== null) {
    if (L.toCall > 0) {
      const need = L.toCall / (game.totalPot + L.toCall);
      facts.push(`Price: you need ${pct(need)} to call; you have ${pct(eq)} against ${villains.length > 1 ? 'their ranges' : 'their range'}.`);
    } else facts.push(`Your equity against ${villains.length > 1 ? 'their ranges' : 'their range'}: ${pct(eq)}.`);
  }

  // board read: range advantage + strong-hand share, heads-up only (cleaner)
  let read = null;
  if (villains.length === 1) {
    const v = villains[0];
    const ownNoHero = toCombos(ranges.get(heroSeat), dead);
    const narrowed = narrow(game, heroSeat, ownNoHero);
    const re = rangeEquity(narrowed, v.w, board);
    read = {
      equity: re,
      nutsYou: share(narrowed, table, 0.9),
      nutsThem: share(v.w, table, 0.9),
      them: game.positions()[v.seat],
    };
    if (re !== null) facts.push(`Range vs range: your range has ${pct(re)} equity; ${read.nutsYou > read.nutsThem * 1.3 ? 'you hold more of the strongest hands' : read.nutsThem > read.nutsYou * 1.3 ? 'they hold more of the strongest hands' : 'strong hands are split about evenly'}.`);
  }

  // tiers: what the solver does with each fifth of your range (heads-up solved spots)
  let tiers = null;
  if (solved && solved.probs && solved.toSolver) {
    const k = solved.actions.length;
    const items = [];
    for (let j = 0; j < 1326; j++) {
      const si = solved.toSolver[j];
      const w = solved.range[si];
      if (!w || Number.isNaN(solved.probs[si * k])) continue;
      items.push({ s: table[j], w, p: Array.from(solved.probs.subarray(si * k, si * k + k)) });
    }
    items.sort((a, b) => b.s - a.s);
    const total = items.reduce((s, x) => s + x.w, 0);
    tiers = [];
    let acc = 0, bucket = 0, sums = Array(k).fill(0), wsum = 0;
    for (const it of items) {
      const b = Math.min(4, Math.floor((acc / total) * 5));
      if (b !== bucket) { tiers.push({ mix: sums.map(x => x / (wsum || 1)) }); sums = Array(k).fill(0); wsum = 0; bucket = b; }
      it.p.forEach((x, i) => { sums[i] += x * it.w; }); wsum += it.w; acc += it.w;
    }
    tiers.push({ mix: sums.map(x => x / (wsum || 1)) });
    while (tiers.length < 5) tiers.push({ mix: Array(k).fill(0) });
  }
  return { facts, tags, rankInRange, read, tiers, eq, villains };
}

// A villain's range as 169-class weights (for the peek grid), plus how much of it you beat
export function villainView(game, seat, heroSeat, strat) {
  const { ranges } = preflopRanges(game, strat);
  const hero = game.players[heroSeat];
  let w = toCombos(ranges.get(seat), [...game.board, ...hero.cards]);
  if (game.board.length) w = narrow(game, seat, w);
  const by = new Float32Array(169), cnt = new Float32Array(169);
  COMBOS.forEach(([a, b, c], i) => { cnt[c]++; by[c] += w[i]; });
  for (let c = 0; c < 169; c++) by[c] = cnt[c] ? by[c] / cnt[c] : 0;
  const mx = Math.max(...by) || 1;
  for (let c = 0; c < 169; c++) by[c] /= mx;
  const eq = equityVsRanges(hero.cards, game.board, [w], 600);
  const width = COMBOS.reduce((s, [a, b, c], i) => s + (w[i] > 0 ? w[i] : 0), 0) / 1326;
  return { weights: by, eq, width };
}
