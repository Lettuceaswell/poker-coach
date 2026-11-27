// How often do hero preflop decisions against the normies land on the solved tree?
import { Game } from '../js/engine.js';
import { makeBot, decide } from '../js/bots.js';
import { mapSpot } from '../js/coach.js';
const N = +(process.argv[2] || 6), HANDS = +(process.argv[3] || 4000);
const g = new Game({ sb: 5, bb: 10 });
const taken = new Set();
g.addPlayer({ name: 'hero', isHero: true, persona: 'regular', stack: 1000 });
for (let i = 1; i < N; i++) g.addPlayer({ ...makeBot(taken), stack: 1000 });
const tally = { exact: 0, approx: 0, off: 0 }, whys = {};
for (let h = 0; h < HANDS; h++) {
  for (const p of g.players) p.stack = 1000; // "reset to 100 BB each hand" (the app default)
  g.startHand();
  while (!g.handOver) {
    if (g.toAct === 0 && g.street === 'preflop') {
      const m = mapSpot(g);
      tally[m.quality]++;
      if (m.quality !== 'exact') whys[m.why.replace(/\d+(\.\d)?/g, '#')] = (whys[m.why.replace(/\d+(\.\d)?/g, '#')] || 0) + 1;
    }
    const d = decide(g, g.toAct); g.act(d.type, d.to);
  }
}
const tot = tally.exact + tally.approx + tally.off;
console.log(`${N}-max, ${tot} hero preflop decisions: exact ${(100*tally.exact/tot).toFixed(1)}%  approx ${(100*tally.approx/tot).toFixed(1)}%  off ${(100*tally.off/tot).toFixed(1)}%`);
console.log(Object.entries(whys).sort((a,b)=>b[1]-a[1]).slice(0,8));
