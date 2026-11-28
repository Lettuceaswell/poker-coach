// Calibration as coaching: plain-words definition, inputs, worked method, hint on tap, explanation on reveal.
// Scaffolding fades with the hit history. Sweller (worked-example effect), Renkl (fading worked steps),
// Kalyuga (expertise reversal: guidance that helps novices slows experts), Hubbard (calibrated 90% intervals).
const f1 = (x) => +x.toFixed(1);
export function isExpert(c) { return !!c && c.n >= 5 && c.hits / c.n >= 0.8; }

function nums(d) {
  const pot = d.pot, need = d.need;
  const call = need != null ? f1(pot * need / (1 - need)) : 0;
  return { pot: f1(pot), call, total: f1(pot + call), street: d.street, boardN: (d.board || []).length };
}

export const spotNums = nums;

function mix(d) {
  const m = (d.mix || []).slice().sort((a, b) => b.freq - a.freq)[0];
  return m ? `${m.label} ${Math.round(m.freq * 100)}%` : '';
}


export const pt = (n) => `${n} point${n === 1 ? '' : 's'}`;
const BEHIND = { UTG: 5, HJ: 4, CO: 3, BTN: 2, SB: 1, BB: 0 };
const REAL = { BTN: 0.92, CO: 0.9, HJ: 0.88, UTG: 0.88, SB: 0.83, BB: 0.83 };

// The coach's pick: the top action of the solver mix, the same reduce the grade chip uses (app.js grade()).
export function pickDir(d) {
  const byT = {};
  for (const m of d.mix || []) byT[m.t] = (byT[m.t] || 0) + m.freq;
  const ks = Object.keys(byT);
  if (!ks.length) return 'c';
  return ks.reduce((a, b) => (byT[b] > byT[a] ? b : a));
}
const DIRWORD = { f: 'fold', c: 'call', r: 'raise' };

// Hand class from the label ("76s", "AJo", "88") for the preflop rule of thumb; postflop by street.
export function handType(d) {
  if (d.street && d.street !== 'preflop') return d.street === 'flop' ? 'flop' : d.street === 'turn' ? 'turn' : 'river';
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/.exec(d.hand || '');
  if (!m) return 'other';
  const R = '23456789TJQKA', a = R.indexOf(m[1]), b = R.indexOf(m[2]);
  if (a === b) return 'pair';
  const hi = Math.max(a, b), lo = Math.min(a, b), suited = m[3] === 's', gap = hi - lo;
  if (hi === 12) return suited ? 'suited-ace' : lo >= 8 ? 'broadway' : 'dominated-ace';
  if (suited) return gap <= 2 && hi <= 11 ? 'suited-connector' : lo >= 8 ? 'broadway' : 'suited-other';
  return lo >= 8 ? 'broadway' : 'offsuit-other';
}

const RULES = {
  pair: ['A pair against two overcards is about 55 / 45 for the pair. Against a range of bigger pairs and big cards it drops to about 40 to 45 percent.', 'A pair vs two overcards: about 55 percent; vs a tight range of bigger pairs and big cards: 40 to 45 percent.', 'Step 1: name their range (tight raise, strong hands). Step 2: is your pair above or below most of it? Step 3: start near 55 percent for a pair vs overcards, subtract 10 for a range with bigger pairs.'],
  'suited-connector': ['A suited connector against a range of big cards and pairs is about 35 to 40 percent. It wins by pairing up and making draws, so it is rarely far ahead.', 'Seven-six suited vs a range of big cards and pairs: about 36 to 39 percent.', 'Step 1: name their range (big cards and pairs). Step 2: you are behind in raw strength, so start near 38 percent. Step 3: move up a point or two if the cards are higher, down if they are far apart.'],
  'suited-other': ['A suited gapper or suited low-and-high hand against a raise range is about 33 to 38 percent: you have flush and straight chances but few strong pairs.', 'J-8 suited vs a tight raise range: about 34 to 37 percent.', 'Step 1: name their range. Step 2: you lean on flush and straight chances, so start near 35 percent. Step 3: lower it if the gap is wide.'],
  'suited-ace': ['A suited ace against a raise range is about 38 to 42 percent. The flush chance helps, but a smaller ace is often dominated by a better ace.', 'A-5 suited vs a tight raise range: about 38 to 40 percent.', 'Step 1: name their range (pairs, better aces). Step 2: the nut flush chance gives you equity, a weak kicker takes it away. Step 3: start near 40 percent.'],
  broadway: ['Two big cards against a raise range are about 35 to 42 percent: you are often dominated by better big cards and pairs, suited adds about 3 points.', 'K-Q vs a tight raise range: about 38 to 41 percent.', 'Step 1: name their range (pairs, AK, AQ). Step 2: you are dominated by the better big card. Step 3: start near 38 percent, plus 3 if suited.'],
  'dominated-ace': ['An offsuit ace with a small kicker is dominated by every better ace: about 28 to 35 percent against a range with pairs and better aces.', 'A-9 offsuit vs a range of pairs and better aces: about 30 to 33 percent.', 'Step 1: name their range (pairs, better aces). Step 2: every better ace beats you with the same top card. Step 3: start near 32 percent.'],
  'offsuit-other': ['Unconnected offsuit cards against a raise range are about 27 to 33 percent: no pair, no flush, and little to draw to.', 'J-6 offsuit vs a raise range: about 28 to 31 percent.', 'Step 1: name their range. Step 2: with no pair, flush or straight chance you start low, near 30 percent. Step 3: nudge up for higher cards.'],
  flop: ['Outs x 4 on the flop if all-in (x 2 per card if you will see both cards but may fold later).', '9 outs on the flop: 9 x 4 = 36 percent.', 'Step 1: count outs that improve you. Step 2: multiply by 4 (flop, all-in). Step 3: shade up if you also pair already, down if your outs are shared.'],
  turn: ['Outs x 2 with one card to come.', '9 outs on the turn: 9 x 2 = 18 percent.', 'Step 1: count outs that improve you. Step 2: multiply by 2 (one card to come). Step 3: shade up if you also pair already, down if your outs are shared.'],
  river: ['No cards to come: your hand either wins or loses. Rank it against the hands that bet this way: the share of their range you beat is your win share.', 'Second pair on the river vs a range of value bets and some bluffs: you beat the bluffs and weaker pairs, about 25 to 35 percent.', 'Step 1: list the value hands and bluffs they bet. Step 2: count what you beat. Step 3: divide by their whole range.'],
  other: ['Place your hand against their range and start near 50 percent, then shift down for dominated hands.', 'About 50 percent as a start, less when dominated.', 'Step 1: name their range. Step 2: place your hand against it. Step 3: start near 50 percent and shift down for dominated hands.'],
};
export function ruleOfThumb(d) {
  const r = RULES[handType(d)] || RULES.other;
  return { steps: r[0], example: r[1], hint: r[2], type: handType(d) };
}
export const RULE_CLASSES = Object.keys(RULES);

// Why raw equity versus price is not the whole answer, with numbers.
// Realization factors (REAL) and the 2.5 points per player behind are rough teaching numbers, not solver outputs.
export function judge(d, eqPct, needPct) {
  const dir = pickDir(d), word = DIRWORD[dir] || 'call', gap = eqPct - needPct;
  const pre = d.street === 'preflop';
  const squeeze = pre && (d.sit == null || d.sit === 'vs open' || d.sit === 'vs limpers');
  const behind = squeeze ? (BEHIND[d.pos] ?? 0) : 0;
  const R = REAL[d.pos] ?? 0.9;
  const rpct = Math.round(R * 100);
  const margin = Math.max(2, Math.round(needPct * (1 / R - 1) + 2.5 * behind));
  const type = handType(d);
  const oop = d.pos === 'SB' || d.pos === 'BB';
  const why = [];
  if (behind > 0) why.push(`${behind === 1 ? 'one player is' : behind + ' players are'} still to act behind you and can raise (squeeze)`);
  why.push(`you will realize only about ${rpct} percent of your raw equity ${oop ? 'out of position' : 'against a range this tight'}`);
  why.push('any rake makes the bar higher still');
  const reasons = why.join('; ');
  const dirTxt = pick(d);
  let verdict, explain, rule;
  if (dir === 'f') {
    if (gap >= 0) {
      verdict = `On price alone calling ${gap === 0 ? 'only breaks even' : 'looks ' + pt(gap) + ' better'}, but the coach folds: ${reasons}. You need roughly ${pt(margin)} over the price here (about ${needPct + margin} percent, you had ${eqPct}).`;
      explain = `That is ${gap === 0 ? 'exactly the price' : pt(gap) + ' over it'}, but the coach folds, because ${reasons}. You need roughly ${pt(margin)} over the price here, about ${needPct + margin} percent.`;
    } else {
      verdict = `On price alone folding has the edge by ${pt(-gap)}, and the coach folds. For a call here you would need roughly ${pt(margin)} over the price, about ${needPct + margin} percent.`;
      explain = `That is ${pt(-gap)} under the price, so the coach folds; with ${reasons}, you would need roughly ${pt(margin)} over it, about ${needPct + margin} percent.`;
    }
    rule = `fold unless your win share beats the price by roughly ${pt(margin)} (${needPct + margin} percent here; you had ${eqPct}).`;
  } else {
    const allow = Math.max(1, Math.round(needPct * 0.1));
    const cont = dir === 'r' ? 'raises' : 'continues';
    if (gap >= 0) {
      verdict = `On price alone calling has the edge by ${pt(gap)}, and the coach ${cont} (${dirTxt}). ${gap < margin ? `That is under the roughly ${pt(margin)} of cushion a thin call needs, so the pick leans on position and hand type, not on the raw number.` : 'That clears the price with room to spare.'}`;
      explain = `That is ${pt(gap)} over the price, and the coach ${cont}.`;
    } else {
      const closing = behind === 0 && pre;
      const rs = [closing ? 'nobody behind can raise, so you realize your equity' : (R >= 0.93 ? 'acting last you realize more than the raw number' : 'the pot can grow and win big when you hit'),
        type === 'pair' || type.startsWith('suited') ? 'your hand wins large pots when it connects (implied odds)' : 'the range advantage and chances to bluff later'];
      if (dir === 'r') rs.push('a raise also wins the pot with no showdown (fold equity)');
      verdict = `On price alone folding has the edge by ${pt(-gap)}, yet the coach ${cont} (${dirTxt}): ${rs.join('; ')}. The coach can give up roughly ${pt(allow)} of raw equity for those reasons${-gap > allow ? `, so ${pt(-gap - allow)} more has to come from the solver's full range, not from this number alone` : ''}.`;
      explain = `That is ${pt(-gap)} under the price, yet the coach ${cont}: ${rs.join('; ')}. It can give up roughly ${pt(allow)} of raw equity for that.`;
    }
    rule = `${word} when you act last, close the action or hold a hand that makes big pots, even a few points under the price (roughly ${pt(allow)} here); ${word} when you clear the price by a margin otherwise.`;
  }
  return { dir, word, gap, margin, verdict, explain, rule, type };
}
function pick(d) { return mix(d); }

export function coachBlocks(q, d, expert) {
  const n = nums(d);
  let def, inputs, example, hint, steps;
  if (q.kind === 'need') {
    def = 'The share of the time your call must win to break even. Call more than this often and calling makes money.';
    inputs = `Pot before your call: ${n.pot} BB. The call amount: ${n.call} BB.`;
    steps = 'Price = call / (pot + call). Add the call to the pot, divide the call by that total.';
    example = 'Call 4 into 12: 4 / (12 + 4) = 4 / 16 = 25%.';
    hint = `Step 1: add the call to the pot (${n.pot} + ${n.call} = ${n.total}). Step 2: divide the call by that total. Step 3: turn it into a percent. Then set your range around it.`;
  } else {
    const rt = ruleOfThumb(d);
    def = 'The share of the time your hand wins by the river against the range they would bet or raise with here, counting ties as half.';
    inputs = `Pot before your call: ${n.pot} BB. The call amount: ${n.call} BB. Your hand and the board are in the spot above.`;
    steps = rt.steps; example = rt.example; hint = rt.hint;
  }
  const h = (k, t, extra = '') => `<p class="small coach-${k}" data-coach="${k}"${extra}>${t}</p>`;
  const full = h('definition', `<b>What it is:</b> ${def}`) + h('inputs', `<b>Inputs:</b> ${inputs}`) +
    `<div class="small" data-coach="method"><b>Method:</b> ${steps}</div>` + h('example', `<b>Worked example:</b> ${example}`);
  const lean = h('definition', `<b>What it is:</b> ${def}`) + h('inputs', `<b>Inputs:</b> ${inputs}`);
  return (expert ? lean : full) +
    `<button class="btn small-btn" data-coach="hint-toggle" style="min-height:44px">Hint</button>` +
    `<div class="small" data-coach="hint" hidden>${hint}</div>`;
}

export function explainText(q, d, a) {
  const n = nums(d), pick = mix(d);
  const lead = pick ? `Coach pick: ${pick}. ` : '';
  if (q.kind === 'need') return `${lead}How it was computed: ${n.call} / (${n.pot} + ${n.call}) = ${n.call} / ${n.total} = ${a.truth}%. You set ${a.lo}% to ${a.hi}%.`;
  const j = judge(d, a.truth, Math.round(d.need * 100));
  return `${lead}How it was computed: a solver-grade enumeration of your hand against their range, ties as half, gave ${a.truth} percent. The pot was ${n.pot} BB and the call ${n.call} BB, so the price is ${n.call} / ${n.total} = ${f1(d.need * 100)} percent. ${j.explain} You set ${a.lo}% to ${a.hi}%.`;
}

// The verdict line under both answers. Direction comes from the coach's own pick (the same top-action rule the
// grade chip uses in app.js grade()), never from raw equity versus price. Calibration + immediate specific
// feedback (Hattie & Timperley 2007; Hubbard 2014): say what the numbers say, why the pick differs, how big the margin is.
export function renderVerdict(d, needPct, eqPct, gradeHTML) {
  const j = judge(d, eqPct, needPct);
  return `<p class="verdict">You needed ${needPct} percent and had ${eqPct} percent. ${j.verdict} Rule: ${j.rule} ${gradeHTML}</p>`;
}
