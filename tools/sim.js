// Headless check: hand evaluator cases + thousands of bot-only hands (chip conservation, no hangs).
import { evalHand, handName, category } from '../js/cards.js';
import { Game } from '../js/engine.js';
import { makeBot, decide } from '../js/bots.js';

const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
const cases = [
  ['AsKsQsJsTs2d3c', 'Royal Flush'], ['5d4d3d2dAd9c9h', 'Straight Flush, Five High'],
  ['9s9h9d9cKs2d3c', 'Four Nines'], ['KsKhKd3c3h2d4c', 'Full House, Kings over Threes'],
  ['KsKhKd3c3h3d4c', 'Full House, Kings over Threes'], ['As9s7s3s2sKdKc', 'Flush, Ace High'],
  ['Ah2d3c4s5h9cKd', 'Straight, Five High'], ['ThJdQcKsAh2c2d', 'Straight, Ace High'],
  ['7s7h7dAcKd2c3h', 'Three Sevens'], ['AsAhKdKc2s2h9d', 'Two Pair, Aces & Kings'],
  ['QsQh9d8c4s3h2d', 'Pair of Queens'], ['AsQh9d8c4s3h2d', 'Ace High'],
];
let bad = 0;
for (const [h, want] of cases) { const got = handName(evalHand(C(h))); if (got !== want) { bad++; console.log('EVAL FAIL', h, got, '!=', want); } }
if (evalHand(C('AsAhKdKc2s2h9d')) <= evalHand(C('AsAhKdKc2s2hQd')) === false) { bad++; console.log('kicker fail'); }

let seed = 12345; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const g = new Game({ sb: 5, bb: 10, rng });
const taken = new Set();
for (let i = 0; i < 6; i++) g.addPlayer({ ...makeBot(taken, rng), stack: 1000 });
const total = () => g.players.reduce((s, p) => s + p.stack, 0) + g.totalPot;
const HANDS = +(process.argv[2] || 5000);
let showdowns = 0, refills = 0, sidepot = 0;
for (let h = 0; h < HANDS; h++) {
  for (const p of g.players) if (p.stack < 10) { p.stack = 1000; refills++; }
  const before = g.players.reduce((s, p) => s + p.stack, 0);
  g.startHand();
  let steps = 0;
  while (!g.handOver) {
    if (++steps > 500) { console.log('HANG', h); process.exit(1); }
    const d = decide(g, g.toAct, rng);
    g.act(d.type, d.to);
    if (!g.handOver && total() !== before) { console.log('CHIPS DRIFT', h, total(), before); process.exit(1); }
  }
  const after = g.players.reduce((s, p) => s + p.stack, 0);
  if (after !== before) { console.log('CHIPS LOST', h, after, before); process.exit(1); }
  if (g.result.showdown) showdowns++;
  if (g.players.some(p => p.allIn) && g.result.winners.length > 1) sidepot++;
}
console.log(`eval cases ok: ${cases.length - bad}/${cases.length}; ${HANDS} hands, showdowns ${showdowns}, multi-winner all-in pots ${sidepot}, refills ${refills}`);
process.exit(bad ? 1 : 0);
