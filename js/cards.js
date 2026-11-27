// Cards are ints 0..51: rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3.
export const RANKS = '23456789TJQKA';
export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
export const rankOf = c => c >> 2;
export const suitOf = c => c & 3;
export const rankLabel = r => (r === 8 ? '10' : RANKS[r]);

export function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Highest rank of a straight in a 13-bit rank mask, or -1. Handles the wheel.
function straightHigh(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace-low
  for (let t = 13; t >= 4; t--) {
    if (((m >> (t - 4)) & 31) === 31) return t - 1;
  }
  return -1;
}

function topBits(mask, n) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

function pack(cat, ks) {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (ks[i] ?? 0);
  return s;
}

export const CAT_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

// Score of the best 5-card hand from 5–7 cards. Higher is better.
export function evalHand(cards) {
  const rc = new Array(13).fill(0);
  const sc = [0, 0, 0, 0];
  const sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = c >> 2, s = c & 3;
    rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
  }
  // With 7 cards a flush can't coexist with quads or a full house.
  for (let s = 0; s < 4; s++) {
    if (sc[s] >= 5) {
      const sf = straightHigh(sm[s]);
      if (sf >= 0) return pack(8, [sf]);
      return pack(5, topBits(sm[s], 5));
    }
  }
  const quads = [], trips = [], pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (rc[r] === 4) quads.push(r);
    else if (rc[r] === 3) trips.push(r);
    else if (rc[r] === 2) pairs.push(r);
  }
  if (quads.length) {
    const q = quads[0];
    return pack(7, [q, topBits(mask & ~(1 << q), 1)[0]]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(6, [t, p]);
  }
  const st = straightHigh(mask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length) {
    const t = trips[0];
    return pack(3, [t, ...topBits(mask & ~(1 << t), 2)]);
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs;
    return pack(2, [a, b, topBits(mask & ~(1 << a) & ~(1 << b), 1)[0]]);
  }
  if (pairs.length) {
    const p = pairs[0];
    return pack(1, [p, ...topBits(mask & ~(1 << p), 3)]);
  }
  return pack(0, topBits(mask, 5));
}

export const category = score => Math.floor(score / 16 ** 5);
const kick = (score, i) => Math.floor(score / 16 ** (4 - i)) % 16;

const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines',
  'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
const SINGLE = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Jack', 'Queen', 'King', 'Ace'];

export function handName(score) {
  const cat = category(score);
  const k0 = kick(score, 0), k1 = kick(score, 1);
  switch (cat) {
    case 0: return `${SINGLE[k0]} High`;
    case 1: return `Pair of ${PLURAL[k0]}`;
    case 2: return `Two Pair, ${PLURAL[k0]} & ${PLURAL[k1]}`;
    case 3: return `Three ${PLURAL[k0]}`;
    case 4: return `Straight, ${SINGLE[k0]} High`;
    case 5: return `Flush, ${SINGLE[k0]} High`;
    case 6: return `Full House, ${PLURAL[k0]} over ${PLURAL[k1]}`;
    case 7: return `Four ${PLURAL[k0]}`;
    case 8: return k0 === 12 ? 'Royal Flush' : `Straight Flush, ${SINGLE[k0]} High`;
  }
  return '';
}

// Name for a hand of any size (2 hole cards preflop included).
export function describe(cards) {
  if (cards.length >= 5) return handName(evalHand(cards));
  const [a, b] = cards.map(rankOf).sort((x, y) => y - x);
  if (a === b) return `Pair of ${PLURAL[a]}`;
  return `${SINGLE[a]} High`;
}

// Monte Carlo share of the pot against nOpp random hands.
export function equity(hole, board, nOpp, sims = 200, rng = Math.random) {
  const used = new Set([...hole, ...board]);
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  const need = 5 - board.length;
  let won = 0;
  for (let i = 0; i < sims; i++) {
    // partial shuffle of what we need
    const take = need + nOpp * 2;
    for (let k = 0; k < take; k++) {
      const j = k + Math.floor(rng() * (rest.length - k));
      [rest[k], rest[j]] = [rest[j], rest[k]];
    }
    const full = board.concat(rest.slice(0, need));
    const mine = evalHand(hole.concat(full));
    let best = true, ties = 1;
    for (let o = 0; o < nOpp; o++) {
      const off = need + o * 2;
      const s = evalHand([rest[off], rest[off + 1], ...full]);
      if (s > mine) { best = false; break; }
      if (s === mine) ties++;
    }
    if (best) won += 1 / ties;
  }
  return won / sims;
}

// Chen formula preflop score (roughly -1..20).
export function chen(hole) {
  const [a, b] = hole.map(rankOf).sort((x, y) => y - x);
  const base = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10];
  let s = base[a];
  if (a === b) return Math.max(5, s * 2);
  if (suitOf(hole[0]) === suitOf(hole[1])) s += 2;
  const gap = a - b - 1;
  s -= [0, 1, 2, 4][Math.min(gap, 3)] + (gap >= 4 ? 1 : 0);
  if (gap <= 1 && a < 10) s += 1;
  return Math.ceil(s);
}
