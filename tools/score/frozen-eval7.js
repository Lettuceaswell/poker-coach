// Allocation-free hand evaluator for the postflop solver.
//
// Produces exactly the same score as evalHand() in js/cards.js (same category
// and kicker packing), but works on module-level typed scratch arrays so the
// solver can score ~1M seven-card hands during setup without GC churn.
// tools/postflop-test.js cross-checks it against evalHand on random hands.

const RC = new Int32Array(13); // rank counts
const SC = new Int32Array(4); // suit counts
const SM = new Int32Array(4); // per-suit rank masks
const P16 = [1, 16, 256, 4096, 65536, 1048576];

// Highest rank of a straight in a 13-bit rank mask, or -1 (wheel aware).
function straightHigh(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let t = 13; t >= 4; t--) if (((m >> (t - 4)) & 31) === 31) return t - 1;
  return -1;
}

// Top k ranks of a mask packed as k base-16 digits, then shifted so that the
// result occupies `slots` digits (missing kickers count as 0, as in evalHand).
function top(mask, k, slots) {
  let v = 0, got = 0;
  for (let r = 12; r >= 0 && got < k; r--) {
    if (mask & (1 << r)) { v = v * 16 + r; got++; }
  }
  return v * P16[slots - got];
}

// Score the hand currently loaded into RC/SC/SM with rank mask `mask`.
function scoreLoaded(mask) {
  for (let s = 0; s < 4; s++) {
    if (SC[s] >= 5) {
      const sf = straightHigh(SM[s]);
      if (sf >= 0) return 8 * P16[5] + sf * P16[4];
      return 5 * P16[5] + top(SM[s], 5, 5);
    }
  }
  let q = -1, t0 = -1, t1 = -1, p0 = -1, p1 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = RC[r];
    if (c === 4) { if (q < 0) q = r; }
    else if (c === 3) { if (t0 < 0) t0 = r; else if (t1 < 0) t1 = r; }
    else if (c === 2) { if (p0 < 0) p0 = r; else if (p1 < 0) p1 = r; }
  }
  if (q >= 0) return 7 * P16[5] + q * P16[4] + top(mask & ~(1 << q), 1, 4);
  if (t0 >= 0 && (t1 >= 0 || p0 >= 0)) {
    const p = Math.max(t1, p0);
    return 6 * P16[5] + t0 * P16[4] + p * P16[3];
  }
  const st = straightHigh(mask);
  if (st >= 0) return 4 * P16[5] + st * P16[4];
  if (t0 >= 0) return 3 * P16[5] + t0 * P16[4] + top(mask & ~(1 << t0), 2, 4);
  if (p1 >= 0) {
    return 2 * P16[5] + p0 * P16[4] + p1 * P16[3] + top(mask & ~(1 << p0) & ~(1 << p1), 1, 3);
  }
  if (p0 >= 0) return 1 * P16[5] + p0 * P16[4] + top(mask & ~(1 << p0), 3, 4);
  return top(mask, 5, 5);
}

// Score 5–7 cards held in an array-like. Same result as evalHand(cards).
export function evalCards(cards, n = cards.length) {
  RC.fill(0); SC.fill(0); SM.fill(0);
  let mask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    RC[r]++; SC[s]++; SM[s] |= 1 << r; mask |= 1 << r;
  }
  return scoreLoaded(mask);
}

// Score board + (c1[i], c2[i]) for i < n into out[i]. The board is loaded
// once; each hand adds and removes its two cards. Hands that share a card
// with the board are not detected here (callers filter them).
export function scoreHands(board, c1, c2, n, out) {
  RC.fill(0); SC.fill(0); SM.fill(0);
  let bmask = 0;
  for (let i = 0; i < board.length; i++) {
    const c = board[i], r = c >> 2, s = c & 3;
    RC[r]++; SC[s]++; SM[s] |= 1 << r; bmask |= 1 << r;
  }
  const sm0 = SM[0], sm1 = SM[1], sm2 = SM[2], sm3 = SM[3];
  for (let i = 0; i < n; i++) {
    const a = c1[i], b = c2[i];
    const ra = a >> 2, sa = a & 3, rb = b >> 2, sb = b & 3;
    RC[ra]++; SC[sa]++; SM[sa] |= 1 << ra;
    RC[rb]++; SC[sb]++; SM[sb] |= 1 << rb;
    out[i] = scoreLoaded(bmask | (1 << ra) | (1 << rb));
    RC[ra]--; SC[sa]--; RC[rb]--; SC[sb]--;
    SM[0] = sm0; SM[1] = sm1; SM[2] = sm2; SM[3] = sm3;
  }
}
