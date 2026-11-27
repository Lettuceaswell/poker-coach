// Rules audit for the NLHE engine: scripted hands with stacked decks, fuzzing with
// random legal actions, and an independent cross-check of the hand evaluator.
import { Game } from '../js/engine.js';
import { evalHand, category, newDeck, shuffle } from '../js/cards.js';

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const C = s => (s.match(/../g) || []).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));

// Build a table: stacks in chips, button seat; hands[seat] = 'AsKd', board = 'xxxxxxxxxx'
function table(stacks, button, hands, board = '') {
  const g = new Game({ sb: 5, bb: 10 });
  stacks.forEach((s, i) => g.addPlayer({ name: 'p' + i, stack: s }));
  // startHand advances the button by one live seat
  g.button = (button - 1 + stacks.length) % stacks.length;
  const n = stacks.length;
  const order = [];
  let i = button;
  for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) { i = (i + 1) % n; order.push(C(hands[i] || '')[r]); }
  const b = board ? C(board) : [];
  const used = new Set([...order, ...b].filter(x => x !== undefined));
  const spare = newDeck().filter(c => !used.has(c));
  const take = () => spare.pop();
  const seq = order.map(c => (c === undefined ? take() : c));
  seq.push(take(), b[0] ?? take(), b[1] ?? take(), b[2] ?? take(), take(), b[3] ?? take(), take(), b[4] ?? take());
  const deck = [...spare, ...seq.reverse()];
  g.startHand(deck);
  return g;
}
const act = (g, seat, type, to) => { ok(g.toAct === seat, `expected seat ${seat} to act, got ${g.toAct} (${type})`); g.act(type, to); };

// 1. Heads-up: button posts SB and acts first preflop, BB acts first postflop
{
  const g = table([1000, 1000], 0, { 0: 'AsAd', 1: 'KsKd' }, '2c7h9dJs3c');
  eq([g.players[0].bet, g.players[1].bet], [5, 10], 'HU blinds: button posts SB');
  eq(g.toAct, 0, 'HU preflop: button/SB first');
  act(g, 0, 'call'); act(g, 1, 'check');
  eq(g.street, 'flop', 'HU limp + check goes to flop');
  eq(g.toAct, 1, 'HU postflop: BB first');
}

// 2. Three-handed blinds and order
{
  const g = table([1000, 1000, 1000], 0, {});
  eq([g.players[1].bet, g.players[2].bet], [5, 10], '3-handed: SB and BB left of button');
  eq(g.toAct, 0, '3-handed preflop: button first');
}

// 3. Minimum raise sizes
{
  const g = table([1000, 1000, 1000], 0, {});
  let L = g.legal();
  eq([L.toCall, L.minTo], [10, 20], 'open min-raise is to 2 BB');
  act(g, 0, 'raise', 30);
  L = g.legal();
  eq(L.minTo, 50, 'after raise to 30 the min re-raise is to 50');
  act(g, 1, 'raise', 12); // illegal size gets clamped to the minimum
  eq(g.players[1].bet, 50, 'under-min raise clamps to min raise');
  act(g, 2, 'fold'); act(g, 0, 'call');
  eq(g.street, 'flop', 'action closes when bets match');
  L = g.legal();
  eq([L.toCall, L.minTo], [0, 10], 'postflop min bet is 1 BB');
}

// 3b. TDA examples: 600 -> 1600 -> 3600 means the next min is 5600 (chips x10 scale)
{
  const g = table([100000, 100000, 100000, 100000], 0, {}, '2c7h9dJs3c');
  act(g, 3, 'call'); act(g, 0, 'call'); act(g, 1, 'call'); act(g, 2, 'check');
  act(g, 1, 'raise', 600); act(g, 2, 'raise', 1600); act(g, 3, 'raise', 3600);
  eq(g.legal().minTo, 5600, 'min raise after 600/1600/3600 is 5600');
}
{
  // open 300 (BB 100 scale x... use bb=10: open 30), short all-ins to 50/65/80; next full raise min = 80+20 = 100
  const g = table([1000, 50, 65, 80, 1000], 0, {});
  // button 0, SB 1 (50), BB 2 (65), UTG 3 (80), HJ 4
  act(g, 3, 'raise', 30 > 80 ? 80 : 30);
  act(g, 4, 'call'); act(g, 0, 'call');
  act(g, 1, 'raise', 50); act(g, 2, 'raise', 65);
  // UTG all-in for 80
  const L = g.legal();
  ok(g.toAct === 3, 'UTG to act');
}
{
  const g = table([1000, 1000, 1000, 1000, 1000, 1000], 5, {});
  // generic: open to 30 (raise of 20), all-ins that are short keep min raise increment 20
  act(g, 2, 'raise', 30);
  const before = g.lastRaise;
  eq(before, 20, 'open to 30 sets raise increment 20');
}

// 4. BB option after limps
{
  const g = table([1000, 1000, 1000], 0, {});
  act(g, 0, 'call'); act(g, 1, 'call');
  eq(g.street, 'preflop', 'round not over before BB acts');
  ok(g.legal().canRaise && g.legal().canCheck, 'BB may check or raise');
  act(g, 2, 'raise', 40);
  ok(g.toAct === 0 && g.legal().canRaise, 'limper may re-raise after BB raise');
}

// 5. Incomplete all-in raise does not reopen betting for players who already acted
{
  // seat 0 BTN, 1 SB, 2 BB; seat 2 has short stack
  const g = table([1000, 1000, 260, 1000], 0, {});
  // order: UTG(3)? with 4 players: button 0, SB 1, BB 2, UTG 3
  act(g, 3, 'raise', 200);       // UTG raises to 200 (raise of 190)
  act(g, 0, 'fold');
  act(g, 1, 'call');             // SB calls 200 (acted)
  act(g, 2, 'raise', 260);       // BB all-in 260: only +60, incomplete
  ok(g.toAct === 3 && !g.legal().canRaise, 'UTG faces incomplete raise: call/fold only');
  act(g, 3, 'call');
  ok(g.toAct === 1 && !g.legal().canRaise, 'SB faces incomplete raise: call/fold only');
  act(g, 1, 'call');
  eq(g.street, 'flop', 'goes to flop after calls');
}
{
  // a player who has NOT acted yet may raise over an incomplete all-in
  const g = table([1000, 1000, 1000, 250], 2, {});
  // button 2, SB 3 (250 stack), BB 0, first to act 1
  act(g, 1, 'raise', 200);
  act(g, 2, 'call');
  act(g, 3, 'raise', 250);       // SB all-in +50: incomplete
  ok(g.toAct === 0 && g.legal().canRaise, 'BB (not yet acted) may raise over incomplete all-in');
}
{
  // two incomplete all-ins that together make a full raise reopen betting
  const g = table([1000, 230, 270, 1000], 0, {});
  // button 0, SB 1 (230), BB 2 (270), UTG 3
  act(g, 3, 'raise', 200);        // raise of 190
  act(g, 0, 'call');
  act(g, 1, 'raise', 230);        // +30, incomplete
  act(g, 2, 'raise', 270);        // +40 more (total +70 since UTG acted), still < 190
  ok(!g.legal().canRaise, 'cumulative +70 < 190: no reopen for UTG');
  const g2 = table([1000, 300, 420, 1000], 0, {});
  act(g2, 3, 'raise', 200);
  act(g2, 0, 'call');
  act(g2, 1, 'raise', 300);       // +100, incomplete
  act(g2, 2, 'raise', 420);       // +120 more: total +220 >= 190 since UTG acted
  ok(g2.toAct === 3 && g2.legal().canRaise, 'cumulative incomplete raises >= full raise reopen');
}

// 6. Side pots, uncalled bet returned, showdown awards
{
  // seat0 100 chips (best hand), seat1 300 (2nd best), seat2 1000 (worst)
  const g = table([100, 300, 1000], 2, { 0: 'AsAh', 1: 'KsKh', 2: 'QsQh' }, '2c7d9cJd3s');
  // button 2, SB 0, BB 1; first preflop actor: button (2)
  act(g, 2, 'raise', 1000);
  act(g, 0, 'call'); act(g, 1, 'call');
  ok(g.handOver, 'all-in runout reaches showdown');
  // main pot 300 to AA; side pot 400 (seat1+seat2 200 each) to KK; seat2 gets 700 uncalled back
  eq(g.players.map(p => p.stack), [300, 400, 700], 'side pots and uncalled bet');
}
{
  // everyone folds: winner takes blinds, no showdown, nothing revealed
  const g = table([1000, 1000, 1000], 0, {});
  act(g, 0, 'fold'); act(g, 1, 'fold');
  ok(g.handOver && !g.result.showdown, 'folds end hand without showdown');
  eq(g.players.map(p => p.stack), [1000, 995, 1005], 'BB wins the blinds');
}

// 7. Split pot with odd chip to first seat left of the button
{
  // board plays: both have a straight on board
  const g = table([1000, 1005, 1000], 0, { 0: '2s3s', 1: '2h3h', 2: '4c4d' }, 'TcJdQhKsAc');
  // SB is seat 1 posting 5; make an odd pot: BTN folds, SB calls, BB checks
  act(g, 0, 'fold'); act(g, 1, 'call'); act(g, 2, 'check');
  for (const s of ['flop', 'turn', 'river']) { act(g, 1, 'check'); act(g, 2, 'check'); }
  ok(g.handOver, 'checked down');
  eq(g.players.map(p => p.stack), [1000, 1005, 1000], 'board plays: chopped evenly');
  const g2 = table([1000, 1000, 1000, 1000], 0, { 1: 'AsKd', 2: 'AhKc', 3: '2c3d' }, 'Qs9h7d4c2h');
  // button 0, SB 1, BB 2, UTG 3. UTG calls 10, SB completes, BB checks -> pot 30... make odd: SB folds
  act(g2, 3, 'call'); act(g2, 0, 'fold'); act(g2, 1, 'fold'); act(g2, 2, 'check');
  // pot 25 (UTG 10 + SB 5 + BB 10)? SB folded with 5 in: pot = 25
  act(g2, 2, 'check'); act(g2, 3, 'check');
  act(g2, 2, 'check'); act(g2, 3, 'check');
  act(g2, 2, 'check'); act(g2, 3, 'check');
  eq(g2.players.map(p => p.stack), [1000, 995, 990, 1015], 'pair of twos beats ace high');
}
{
  // odd chip: two winners split 25
  const g = table([1000, 1000, 1000, 1000], 0, { 1: '8s8d', 2: 'AsKd', 3: 'AhKc' }, 'Qs9h7d4c2h');
  act(g, 3, 'call'); act(g, 0, 'fold'); act(g, 1, 'fold'); act(g, 2, 'check');
  for (let s = 0; s < 3; s++) { act(g, 2, 'check'); act(g, 3, 'check'); }
  // pot 25: BB (seat 2, first left of button among winners) gets 13, UTG gets 12
  eq(g.players.map(p => p.stack), [1000, 995, 1003, 1002], 'odd chip to first winner left of button');
}

// 8. Short blinds all-in
{
  const g = table([1000, 3, 6], 0, {});
  eq([g.players[1].bet, g.players[2].bet, g.players[1].allIn, g.players[2].allIn], [3, 6, true, true], 'short blinds post all-in');
  eq(g.legal().toCall, 10, 'others must still call the full big blind');
}

// 9. Position labels
{
  const g = table([1000, 1000, 1000, 1000, 1000, 1000], 2, {});
  eq(g.positions(), ['SB', 'BB', 'BTN', 'SB', 'BB', 'UTG'].map((_, i) => ['HJ', 'CO', 'BTN', 'SB', 'BB', 'UTG'][i]), '6-max position labels');
}

// 10. Fuzz: random legal actions with random sizes; invariants every step
{
  let seed = 99; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let h = 0; h < 30000; h++) {
    const n = 2 + Math.floor(rng() * 5);
    const g = new Game({ sb: 5, bb: 10, rng });
    for (let i = 0; i < n; i++) g.addPlayer({ name: 'f' + i, stack: 5 + Math.floor(rng() * 3000) });
    g.button = Math.floor(rng() * n);
    const total = g.players.reduce((s, p) => s + p.stack, 0);
    g.startHand();
    let steps = 0, bad = '';
    while (!g.handOver) {
      if (++steps > 400) { bad = 'hang'; break; }
      const L = g.legal();
      const p = g.players[g.toAct];
      if (p.folded || p.allIn) { bad = 'acting player cannot act'; break; }
      if (L.toCall < 0 || L.minTo > L.maxTo || L.maxTo !== p.bet + p.stack) { bad = 'legal() inconsistent'; break; }
      const r = rng();
      if (r < 0.15) g.act('fold');
      else if (r < 0.6) g.act(L.canCheck ? 'check' : 'call');
      else g.act('raise', L.minTo + Math.floor(rng() * (L.maxTo - L.minTo + 1)));
      const sum = g.players.reduce((s, q) => s + q.stack, 0) + (g.handOver ? 0 : g.totalPot);
      if (sum !== total) { bad = 'chips'; break; }
      if (g.players.some(q => q.stack < 0)) { bad = 'negative stack'; break; }
    }
    if (!bad && g.players.reduce((s, q) => s + q.stack, 0) !== total) bad = 'chips after';
    if (bad) { ok(false, `fuzz hand ${h} (${n} players): ${bad}`); break; }
  }
  passes++;
}

// 11. Evaluator vs an independent brute-force evaluator (best 5 of 7, straightforward)
function ref5(cs) {
  const rs = cs.map(c => c >> 2).sort((a, b) => b - a), ss = cs.map(c => c & 3);
  const flush = ss.every(s => s === ss[0]);
  const uniq = [...new Set(rs)];
  let st = -1;
  if (uniq.length === 5 && rs[0] - rs[4] === 4) st = rs[0];
  if (uniq.length === 5 && rs[0] === 12 && rs[1] === 3) st = 3; // wheel
  const cnt = {}; rs.forEach(r => (cnt[r] = (cnt[r] || 0) + 1));
  const groups = Object.entries(cnt).map(([r, c]) => [c, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const ks = groups.map(g => g[1]);
  let cat;
  if (st >= 0 && flush) return [8, st];
  if (groups[0][0] === 4) cat = 7; else if (groups[0][0] === 3 && groups[1][0] === 2) cat = 6;
  else if (flush) return [5, ...rs]; else if (st >= 0) return [4, st];
  else if (groups[0][0] === 3) cat = 3; else if (groups[0][0] === 2 && groups[1][0] === 2) cat = 2;
  else if (groups[0][0] === 2) cat = 1; else return [0, ...rs];
  return [cat, ...ks];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; } return 0; };
function ref7(cs) {
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cs.filter((_, i) => i !== a && i !== b);
    const v = ref5(five);
    if (!best || cmp(v, best) > 0) best = v;
  }
  return best;
}
{
  let seed = 7; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let mism = 0;
  for (let t = 0; t < 40000 && mism < 3; t++) {
    const d = shuffle(newDeck(), rng);
    const a = d.slice(0, 7), b = d.slice(7, 14);
    const e = Math.sign(evalHand(a) - evalHand(b)), r = Math.sign(cmp(ref7(a), ref7(b)));
    if (e !== r || category(evalHand(a)) !== ref7(a)[0]) { mism++; ok(false, `evaluator mismatch ${a} vs ${b}`); }
  }
  ok(mism === 0, 'evaluator agrees with brute force on 40k random pairs');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
