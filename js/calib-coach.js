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

function mix(d) {
  const m = (d.mix || []).slice().sort((a, b) => b.freq - a.freq)[0];
  return m ? `${m.label} ${Math.round(m.freq * 100)}%` : '';
}

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
    const flop = n.street === 'flop', pre = n.street === 'preflop';
    def = 'The share of the time your hand wins by the river against the range they would bet or raise with here, counting ties as half.';
    inputs = `Your hand and the board are in the spot above. Pot before your call: ${n.pot} BB.`;
    steps = pre ? 'Preflop rule of thumb: a pair vs two overcards is about 55 / 45; vs a tight range expect to be an underdog by 10 to 15 points.'
      : 'Outs x 2 per card to come, x 4 on the flop if all-in.';
    example = pre ? 'Pair vs two overcards: about 55%; vs a tight range 45 / 55 is common.' : '9 outs on the flop: 9 x 4 = 36%; on the turn: 9 x 2 = 18%.';
    hint = pre ? 'Step 1: name their range (tight raise, strong hands). Step 2: place your hand against it (pair, overcards, suited). Step 3: start near 50% and shift down for dominated hands.'
      : `Step 1: count outs that improve you. Step 2: multiply by ${flop ? '4 (flop, all-in)' : '2 (one card to come)'}. Step 3: shade up if you also pair already, down if your outs are shared.`;
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
  return `${lead}How it was computed: a solver-grade enumeration of your hand against their range, ties as half, gave ${a.truth}%. Compared with the ${f1(d.need * 100)}% price (${n.call} / ${n.total}), that is ${a.truth >= Math.round(d.need * 100) ? 'enough' : 'not enough'} to call. You set ${a.lo}% to ${a.hi}%.`;
}
