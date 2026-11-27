// Coaching features: drill spot construction, grid mapping, explanations, leak classification.
import fs from 'fs'; import zlib from 'zlib';
import { treeFor, decodeStrategy, mapSpot, className } from '../js/coach.js';
import { POSITIONS } from '../js/preflop-tree.js';
import { Game } from '../js/engine.js';
import { makeBot, decide } from '../js/bots.js';
import { gridIndex, label } from '../js/grid.js';

// localStorage stub for history.js
globalThis.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = v; } };
const H = await import('../js/history.js');
const { preflopDetail, postflopDetail, boardTags, villainView, nodeMixes } = await import('../js/explain.js');
const drills = await import('../js/drills.js');

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };

// grid covers all 169 classes exactly once and labels match
const seen = new Set();
for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) { const i = gridIndex(r, c); seen.add(i); ok(className(i) === label(r, c), `grid label ${r},${c}`); }
ok(seen.size === 169, 'grid covers 169 classes');

const strat = {};
for (const n of [3, 4, 5, 6]) strat[n] = decodeStrategy(n, zlib.gunzipSync(fs.readFileSync(`data/preflop-${n}.bin.gz`)));

// play bot hands and run explanations on every hero decision
for (const n of [3, 6]) {
  const g = new Game({ sb: 5, bb: 10 });
  const taken = new Set();
  g.addPlayer({ name: 'hero', isHero: true, persona: 'regular', stack: 1000 });
  for (let i = 1; i < n; i++) g.addPlayer({ ...makeBot(taken), stack: 1000 });
  let pre = 0, post = 0, errs = 0;
  for (let h = 0; h < 150; h++) {
    for (const p of g.players) p.stack = 1000;
    g.startHand();
    while (!g.handOver) {
      if (g.toAct === 0) {
        try {
          if (g.street === 'preflop') { const d = preflopDetail(g, 0, strat[n]); if (d) { pre++; ok(d.facts.length >= 2 && d.mixes.length === 169, 'preflop detail shape'); } }
          else { const d = postflopDetail(g, 0, strat[n]); post++; ok(d.facts.length >= 1 && d.tags.length >= 2, 'postflop detail shape'); }
          for (let s = 1; s < n; s++) if (!g.players[s].folded) { const v = villainView(g, s, 0, strat[n]); ok(v.weights.length === 169 && v.width > 0 && v.width <= 1, 'villain view'); break; }
        } catch (e) { errs++; if (errs < 3) console.log(e); }
      }
      const d = decide(g, g.toAct); g.act(d.type, d.to);
    }
  }
  ok(errs === 0, `${n}-max explanations threw ${errs} times`);
  console.log(`${n}-max: ${pre} preflop and ${post} postflop explanations`);
}

// every drill scenario lands on the hero's decision
for (const n of [3, 4, 5, 6]) {
  const all = drills.scenarios(n);
  let good = 0;
  for (const sc of all) { const node = drills.walk(n, sc); if (node && node.p === sc.hero) good++; else console.log('drill miss', n, sc.label); }
  ok(good === all.length, `${n}-max drills: ${good}/${all.length} scenarios reach the hero`);
}

// board tags sanity
const C = s => s.match(/../g).map(t => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
ok(boardTags(C('AhKhQh')).includes('monotone'), 'monotone tag');
ok(boardTags(C('7c7d2s')).includes('paired'), 'paired tag');
ok(boardTags(C('Ks7d2c')).includes('dry'), 'dry tag');

// leak classification
ok(H.leakOf({ street: 'preflop', pos: 'UTG', sit: 'first in', chosen: 'r', quality: 'exact', mix: [{ t: 'f', freq: 0.97 }, { t: 'r', freq: 0.03 }] })?.label === 'UTG first in: too loose', 'too loose');
ok(H.leakOf({ street: 'preflop', pos: 'BB', sit: 'vs open', chosen: 'f', quality: 'exact', mix: [{ t: 'f', freq: 0.05 }, { t: 'c', freq: 0.95 }] })?.label === 'BB vs open: too tight', 'too tight');
ok(H.leakOf({ street: 'preflop', pos: 'BB', chosen: 'c', quality: 'exact', mix: [{ t: 'f', freq: 0.5 }, { t: 'c', freq: 0.5 }] }) === null, 'in-strategy action is not a leak');
ok(H.leakOf({ street: 'flop', chosen: 'c', quality: 'estimate', mix: [{ t: 'f', freq: 1 }] }) === null, 'estimates never count as leaks');

// calibration
ok(H.recordCalibration(20, 40, 30) === true && H.recordCalibration(20, 40, 50) === false, 'calibration hit/miss');

// orbit closes after the BB hand
H.history.hands.push({ no: 1, orbit: H.history.orbit, pos: 'UTG', cards: [0, 1], decisions: [], net: 0, bb: 10 });
const bbHand = { no: 2, orbit: H.history.orbit, pos: 'BB', cards: [2, 3], decisions: [], net: 0, bb: 10 };
H.history.hands.push(bbHand);
const o = H.history.orbit;
const got = H.closeOrbitIfDue(bbHand);
ok(got && got.length === 2 && H.history.orbit === o + 1, 'orbit closes after BB');
ok(H.closeOrbitIfDue({ pos: 'CO' }) === null, 'no orbit close elsewhere');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
