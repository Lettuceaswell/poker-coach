// Sweep: calibration verdict + explain never contradict the coach's pick (VAL-PT-004).
// usage: node tools/calib-verdict-test.js [--module <path to a calib-coach.js>]  (default js/calib-coach.js)
// A module without renderVerdict (8b48138) is judged through that commit's verdict template, copied below.
import { pathToFileURL } from 'url'; import path from 'path';
const i = process.argv.indexOf('--module');
const modPath = path.resolve(i > 0 ? process.argv[i + 1] : 'js/calib-coach.js');
const M = await import(pathToFileURL(modPath).href);
const legacy = !M.renderVerdict;
const strip = (h) => h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// deterministic generator
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pickOf = (a) => a[Math.floor(rnd() * a.length)];
const HANDS = ['76s', '98s', 'T9s', '65s', 'J9s', 'A5s', 'A2s', 'ATs', 'KQs', 'KJo', 'QJo', 'AJo', 'A9o', 'A7o', 'K9o', 'T7o', '97o', '22', '66', '99', 'TT', 'QQ', 'J8s', 'Q9s'];
const POS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const mkMix = (t) => t === 'f' ? [{ t: 'f', label: 'Fold', freq: 1 }] : t === 'c' ? [{ t: 'c', label: 'Call', freq: 0.8 }, { t: 'f', label: 'Fold', freq: 0.2 }]
  : [{ t: 'r', label: 'Raise', freq: 0.7 }, { t: 'c', label: 'Call', freq: 0.2 }, { t: 'f', label: 'Fold', freq: 0.1 }];
function mk(kind) {
  const call = pickOf([1.5, 2, 2.5, 4, 6, 9]), pot = pickOf([3, 4, 6.5, 9, 14, 22]);
  const need = call / (pot + call), needPct = Math.round(need * 100);
  const street = rnd() < 0.7 ? 'preflop' : pickOf(['flop', 'turn', 'river']);
  let gap, t;
  if (kind === 'near-fold') { gap = Math.floor(rnd() * 4); t = 'f'; }
  else if (kind === 'reverse') { gap = -1 - Math.floor(rnd() * 8); t = pickOf(['c', 'r']); }
  else { gap = Math.floor(rnd() * 31) - 15; t = pickOf(['f', 'c', 'r']); }
  const eq = Math.max(1, Math.min(99, needPct + gap));
  return { street, pos: pickOf(POS), hand: HANDS[Math.floor(rnd() * HANDS.length)], pot, need, eq: eq / 100, mix: mkMix(t), board: street === 'preflop' ? [] : [1, 2, 3], sit: pickOf(['vs open', 'vs open', 'vs limpers', 'vs 3-bet']), kind, truthEq: eq, needPct };
}
const spots = [
  // hand 93 / orbit 17 from Levi's playtest: BTN 7d6d vs HJ open 2.5, price 38.5, equity 39, solver folds 100
  { street: 'preflop', pos: 'BTN', hand: '76s', pot: 4, need: 2.5 / 6.5, eq: 0.39, mix: mkMix('f'), board: [], sit: 'vs open', kind: 'hand93', truthEq: 39, needPct: 38 },
];
for (let k = 0; k < 60; k++) spots.push(mk('near-fold'));
for (let k = 0; k < 60; k++) spots.push(mk('reverse'));
for (let k = 0; k < 120; k++) spots.push(mk('any'));

const legacyVerdict = (d, e, n) => { const gap = e - n; const side = gap >= 0 ? `calling had the edge by ${gap} points` : `folding had the edge by ${-gap} points`;
  return `<p class="verdict">You needed ${n}% and had ${e}%: on price alone ${side}${d.street === 'preflop' ? ' (position after the flop shifts this a little)' : ''}. Rule: call when your win share beats the price, ${e}% vs ${n}%. The coach graded your fold <span class="grade g">Best</span>.</p>`; };
const legacyExplain = (d, a) => `Coach pick: ${(d.mix.slice().sort((x, y) => y.freq - x.freq)[0].label)} ${Math.round(d.mix.slice().sort((x, y) => y.freq - x.freq)[0].freq * 100)}%. ${a.truth}% against ${Math.round(d.need * 1000) / 10}% is ${a.truth >= Math.round(d.need * 100) ? 'enough' : 'not enough'} to call.`;

let contradictions = 0, onePoints = 0, ruleBad = 0, nearFold = 0, nearOk = 0, reverseN = 0, reverseOk = 0;
const classCount = {}, ruleSeen = {}; const bad = [];
for (const d of spots) {
  // the coach's pick as the grade chip sees it: highest-frequency action of the mix
  // pick comes from the shared function app.js grade() calls (pickDir); the legacy module has none, so it keeps the top-frequency reduce
  const top = M.pickDir ? M.pickDir(d) : d.mix.slice().sort((a, b) => b.freq - a.freq)[0].t;
  const a = { truth: d.truthEq, lo: 20, hi: 45 };
  const verdict = strip(legacy ? legacyVerdict(d, d.truthEq, d.needPct) : M.renderVerdict(d, d.needPct, d.truthEq, '<span class="grade g">Best</span>.'));
  const explain = strip(legacy ? legacyExplain(d, a) : M.explainText({ kind: 'eq' }, d, a));
  const all = verdict + ' || ' + explain;
  let wrong = [];
  const callish = /enough to call|calling (had|has) the edge|call when your win share beats/i.test(all);
  const foldish = /folding (had|has) the edge/i.test(all.replace(/yet the coach/g, '#'));
  const rule = /Rule:\s*(\w+)/.exec(verdict);
  if (!rule) wrong.push('no Rule line'); else if (rule[1].toLowerCase() !== { f: 'fold', c: 'call', r: 'raise' }[top]) wrong.push(`rule says ${rule[1]} but pick is ${top}`);
  if (rule && !(rule[1].toLowerCase() === { f: 'fold', c: 'call', r: 'raise' }[top])) ruleBad++;
  if (top === 'f' && /enough to call|call when your win share beats|coach (continues|raises)/i.test(all)) wrong.push('fold pick but text says call');
  if (top === 'f' && !/coach folds|and the coach fold/i.test(all)) wrong.push('fold pick not stated');
  if (top !== 'f' && /coach folds|Rule:\s*fold|enough to fold/i.test(all)) wrong.push('continue pick but text says fold');
  if (/\b1 points\b/.test(all)) onePoints++;
  if (wrong.length) { contradictions++; if (bad.length < 4) bad.push({ hand: d.hand, pos: d.pos, top, eq: d.truthEq, need: d.needPct, wrong, verdict: verdict.slice(0, 220) }); }
  const cls = M.handType ? M.handType(d) : 'n/a'; classCount[cls] = (classCount[cls] || 0) + 1;
  if (d.kind === 'near-fold') {
    nearFold++;
    const margin = /roughly (\d+) points? over the price/.exec(all);
    const reason = /still to act behind|realize|rake/i.test(all);
    if (margin && reason && /percent|%/.test(all)) nearOk++;
  }
  if (d.kind === 'reverse') { reverseN++; if (/under the price|short|behind|realize|nobody|implied|fold equity/i.test(verdict) && top !== 'f') reverseOk++; }
}
// per-class rule of thumb text (preflop+postflop classes) must differ
if (M.ruleOfThumb) for (const c of M.RULE_CLASSES) ruleSeen[c] = M.ruleOfThumb({ street: c === 'flop' || c === 'turn' || c === 'river' ? c : 'preflop', hand: { pair: '66', 'suited-connector': '76s', 'suited-other': 'J8s', 'suited-ace': 'A5s', broadway: 'KQo', 'dominated-ace': 'A9o', 'offsuit-other': 'J6o', other: '??' }[c] || '66' }).steps;
const distinct = new Set(Object.values(ruleSeen)).size;
console.log(`module: ${path.relative('.', modPath)} (${legacy ? 'legacy verdict template' : 'renderVerdict'})`);
console.log(`spots ${spots.length}  contradictions ${contradictions}  "1 points" ${onePoints}  rule-direction mismatches ${ruleBad}`);
console.log(`near-price fold spots ${nearFold}, with margin number + named reason ${nearOk}; reverse spots ${reverseN}, explained ${reverseOk}`);
console.log('hand-type classes in sweep:', JSON.stringify(classCount), ' distinct rule texts:', distinct, 'of', Object.keys(ruleSeen).length);
if (bad.length) console.log('examples:', JSON.stringify(bad, null, 1));
const h93 = spots[0];
console.log('hand93 verdict:', strip(legacy ? legacyVerdict(h93, 39, 38) : M.renderVerdict(h93, 38, 39, '<span class="grade g">Best</span>.')));
const ok = contradictions === 0 && onePoints === 0 && ruleBad === 0 && spots.length >= 200 && nearFold >= 30 && nearOk === nearFold && reverseOk === reverseN && distinct === Object.keys(ruleSeen).length && !legacy;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
