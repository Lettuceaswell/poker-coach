// Coaching scaffold for drill prompts: definition of the decision, the inputs, a method with
// worked arithmetic, a hint on demand (before the answer), and an explanation after the reveal.
// Scaffolding fades with the player's drill accuracy: worked examples help novices and get in the
// way of experts (Renkl & Atkinson 2003 fading; Kalyuga et al. 2003 expertise reversal effect).
// Hints are requested before committing and never state the answer (retrieval first, Roediger &
// Karpicke 2006). Text avoids "word NN%" except for real solver mixes (frozen format).

const f1 = (x) => String(Math.round(x * 10) / 10);
const pc = (x) => Math.round(100 * x);

// full -> worked method + example; mid -> one method line + example; min -> one-line method only
export function fadeLevel(H) {
  const d = H.history.drills, acc = H.drillAccuracy();
  if (acc == null) return 'full';
  if (d.n >= 20 && acc >= 0.85) return 'min';
  if (d.n >= 10 && acc >= 0.7) return 'mid';
  return 'full';
}

// parts: { definition, inputs, steps[], example, brief, hint }
export function scaffoldHTML(parts, lvl) {
  const steps = lvl === 'full' ? parts.steps : [parts.brief];
  const ex = lvl === 'min' ? '' : `<p class="cb-ex" data-coach="example">${parts.example}</p>`;
  return `<div class="coach-box" data-level="${lvl}">
    <p class="cb-def" data-coach="definition">${parts.definition}</p>
    <p class="cb-in" data-coach="inputs">${parts.inputs}</p>
    <div class="cb-m" data-coach="method">${steps.map(s => `<p>${s}</p>`).join('')}</div>
    ${ex}
    <button class="btn ghost hint-tog" type="button" data-coach="hint-toggle" aria-expanded="false">Hint</button>
    <p class="cb-hint" data-coach="hint" hidden>${parts.hint}</p></div>`;
}

export function wireHint(root) {
  const t = root.querySelector('[data-coach="hint-toggle"]'), h = root.querySelector('[data-coach="hint"]');
  if (!t || !h) return;
  t.addEventListener('click', () => { h.hidden = !h.hidden; t.setAttribute('aria-expanded', String(!h.hidden)); });
}

// ---------- preflop ----------
// pr: { pot, toCall, raiseTo, pos, type, opener, three, hand, cur }
export function preflopParts(pr) {
  const { pot, toCall, raiseTo, pos, type } = pr;
  const spotWords = type === 'first' ? `everyone folded to you in ${pos}` : type === 'open' ? `${pr.openerName} opened and action is on you in ${pos}` : `you opened from ${pos} and ${pr.threeName} 3-bet`;
  let price, ex, brief;
  if (type === 'first') {
    const need = raiseTo / (raiseTo + pot);
    price = `Price: raising to ${f1(raiseTo)} BB risks ${f1(raiseTo)} to win the ${f1(pot)} BB in the blinds: ${f1(raiseTo)} / ${f1(raiseTo + pot)} = ${pc(need)} percent. If the raise wins that often it is profitable before counting your equity when called.`;
    ex = `Worked here: ${f1(raiseTo)} / (${f1(raiseTo)} + ${f1(pot)}) = ${f1(raiseTo)} / ${f1(raiseTo + pot)} = ${pc(need)} percent.`;
    brief = `Is the hand in the ${pos} range? Price: ${f1(raiseTo)} / ${f1(raiseTo + pot)} = ${pc(need)} percent.`;
  } else {
    const need = toCall / (toCall + pot);
    price = `Price: calling ${f1(toCall)} BB to win the ${f1(pot)} BB already in: ${f1(toCall)} / ${f1(toCall + pot)} = ${pc(need)} percent equity needed. Raising instead needs fold equity or a hand that beats their range.`;
    ex = `Worked here: ${f1(toCall)} / (${f1(toCall)} + ${f1(pot)}) = ${f1(toCall)} / ${f1(toCall + pot)} = ${pc(need)} percent.`;
    brief = `Is the hand in your range for this seat? Price: ${f1(toCall)} / ${f1(toCall + pot)} = ${pc(need)} percent.`;
  }
  return {
    definition: `Decide whether to fold, call or raise this hand when ${spotWords}; the solver plays each hand a fixed share of the time.`,
    inputs: `Seat ${pos}. Pot ${f1(pot)} BB. To call ${f1(toCall)} BB. Stacks 100 BB.`,
    steps: [`1. Range: is this hand in the range for this seat? Strong hands always play, weak hands always fold.`, `2. Edge hands sit near the cutoff and mix, so two answers can both be right.`, `3. ${price}`],
    example: ex, brief,
    hint: `Is this hand clearly inside the range for ${pos}, clearly outside, or at the edge? Pairs, suited hands and connected cards play more; offsuit gappers fold first.`,
  };
}

// explain after reveal (labels: action names without sizes, p: probabilities, k: chosen index, top: best index)
export function preflopExplain({ names, p, top, k, cls, pr, cost, pos }) {
  const mix = names.map((n, i) => ({ n, f: Math.round(p[i] * 100) })).filter(x => x.f >= 1).map(x => `${x.n} ${x.f}%`).join('  ');
  const tf = Math.round(p[top] * 100);
  const edge = p[top] < 0.75;
  const price = pr.type === 'first' ? `a raise to ${f1(pr.raiseTo)} BB into ${f1(pr.pot)} BB` : `${f1(pr.toCall)} BB to win ${f1(pr.pot)} BB`;
  const why = edge
    ? `${cls} is an edge hand from ${pos}: the solver splits it because ${names[top]} and the other plays are close in value at ${price}, so mixing costs about 0 BB.`
    : `${cls} is a clear ${names[top]} from ${pos} against ${price}: the other plays lose value.`;
  const deep = `Stacks are 100 BB.`;
  const own = k === top ? 'You matched the solver top action.' : `You chose ${names[k]}; the solver top action is ${names[top]} at ${tf} percent.`;
  return `Solver mix: ${mix}. ${why} ${deep} ${own} ${cost}`;
}

// ---------- postflop ----------
const nameOf = (o) => o.replace(/\s+(to\s+)?[\d.]+$/, '');
export const optName = nameOf;

function blockers(s) {
  const suits = {}; s.board.forEach(c => { suits[c[1]] = (suits[c[1]] || 0) + 1; });
  const fs = Object.keys(suits).find(x => suits[x] >= 3);
  const ranks = s.board.map(c => c[0]);
  const hr = s.hand.filter(c => ranks.includes(c[0])).length;
  if (fs && s.hand.some(c => c[1] === fs)) return `You hold a card of the flush suit, which removes some of their flush combos.`;
  if (hr) return `You hold a card matching the board, so they have fewer ways to hold that rank.`;
  return `Your cards do not touch the board; blockers matter little here.`;
}

export function postflopParts(s) {
  const pot = s.pot, F = s.facing;
  let price, ex, brief;
  if (F) {
    const need = F / (pot + 2 * F);
    price = `Price: call ${f1(F)} BB into the ${f1(pot)} BB pot plus their ${f1(F)} bet: ${f1(F)} / ${f1(pot + 2 * F)} = ${pc(need)} percent equity needed.`;
    ex = `Worked here: ${f1(F)} / (${f1(pot)} + ${f1(F)} + ${f1(F)}) = ${f1(F)} / ${f1(pot + 2 * F)} = ${pc(need)} percent.`;
    brief = `Price: ${f1(F)} / ${f1(pot + 2 * F)} = ${pc(need)} percent equity needed.`;
  } else {
    const b = s.opts.map(o => parseFloat((o.match(/[\d.]+/) || [0])[0])).find(x => x > 0 && x < s.stack) || pot / 2;
    const need = b / (b + pot);
    price = `Price: a bet of ${f1(b)} BB into ${f1(pot)} BB risks ${f1(b)} to win ${f1(pot)}: ${f1(b)} / ${f1(b + pot)} = ${pc(need)} percent of the time it must work if called hands always win.`;
    ex = `Worked here: ${f1(b)} / (${f1(b)} + ${f1(pot)}) = ${f1(b)} / ${f1(b + pot)} = ${pc(need)} percent.`;
    brief = `Price: ${f1(b)} / ${f1(b + pot)} = ${pc(need)} percent.`;
  }
  const nm = { flop: 'flop', turn: 'turn', river: 'river' }[s.street];
  const act = s.hero === 'OOP' ? 'You act first' : F ? 'You face a bet' : 'It is checked to you';
  return {
    definition: `Pick the play with the highest expected value on this ${nm}; the solver shows how often each play is used and what each costs in BB.`,
    inputs: `${s.street} board, pot ${f1(pot)} BB${F ? `, bet to call ${f1(F)} BB` : ''}, stack ${f1(s.stack)} BB. ${act}.`,
    steps: [`1. ${price}`, `2. Range advantage: which side has more strong hands on this board? That side bets more and bigger.`, `3. Blockers and hand: ${blockers(s)}`],
    example: ex, brief,
    hint: `Compare the equity you need with what this hand has against their range. Then ask who has more strong hands on this board.`,
  };
}

export function postflopExplain({ s, best, k, cost, bb }) {
  const mix = s.opts.map((o, i) => ({ n: nameOf(o), f: Math.round(s.mix[i] * 100) })).filter(x => x.f >= 1).map(x => `${x.n} ${x.f}%`).join('  ');
  const F = s.facing;
  const price = F ? `Price: ${f1(F)} BB to call, pot ${f1(s.pot)} BB, stack ${f1(s.stack)} BB` : `Pot ${f1(s.pot)} BB, stack ${f1(s.stack)} BB`;
  const top = nameOf(s.opts[best]);
  const own = k === best ? 'You matched the solver top action.' : `You chose ${nameOf(s.opts[k])}; the solver top action is ${top}, ${cost < 0.05 ? 'which costs about the same' : `a difference of ${bb(cost)}`}.`;
  return `Solver mix: ${mix}. ${price}. The solver prefers ${top} here because it has the highest expected value against this range. ${own}`;
}
