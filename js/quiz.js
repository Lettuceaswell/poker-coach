// Quiz: short retrieval questions about poker concepts, built from the numbers in his own stored hands
// (labeled sample spots when none are stored). Every answer is computed by code. Testing yourself beats
// re-reading (Roediger & Karpicke 2006); items are interleaved with drills (Rohrer & Taylor 2007), come
// back in the session when missed and across days (js/schedule.js; Cepeda et al. 2006, 2008); the worked
// example and method fade as the hit rate rises (Renkl & Atkinson 2003; Kalyuga et al. 2003).
// Text rules: say "percent" (never a percent sign: the solver-mix format is reserved), no "blocked" words.
import { fadeLevel, scaffoldHTML, wireHint } from './drill-coach.js';
import * as SCH from './schedule.js';

const f1 = (x) => String(Math.round(x * 10) / 10);
const pc = (x) => Math.round(100 * x);
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const KINDS = ['equity', 'mdf', 'blocker', 'fold', 'spr'];
export const MONEY_KINDS = ['equity', 'mdf', 'fold'];
const CYCLE = ['equity', 'mdf', 'blocker', 'fold', 'equity', 'spr', 'mdf', 'fold']; // 6 of 8 use stored-hand numbers
// drawn on first use, not at module load: a load-time Math.random shifts the app's seeded stream for everything after it
let cyc = null;

// ---------- answers (each one number computed from the spot) ----------
export const answers = {
  equity: (P, B) => B / (P + 2 * B),    // call / final pot after the call
  mdf: (P, B) => P / (P + B),
  fold: (P, B) => B / (P + B),
  spr: (S, P) => S / P,
};

// ---------- blocker combos ----------
const RK = '23456789TJQKA', SUITS = ['s', 'h', 'd', 'c'], SY = { s: '♠', h: '♥', d: '♦', c: '♣' };
const cardName = (c) => (c[0] === 'T' ? '10' : c[0]) + SY[c[1]];
const DECK = []; for (const r of RK) for (const s of SUITS) DECK.push(r + s);
const rank = (c) => RK.indexOf(c[0]);
// villain's calling range on a 3-heart board: flush combos holding a heart J or higher, and sets
export function callingCombos(board, dead) {
  const live = DECK.filter(c => !dead.includes(c));
  const bRanks = board.map(c => c[0]);
  let flush = 0, sets = 0;
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a[1] === 'h' && b[1] === 'h' && (rank(a) >= 9 || rank(b) >= 9)) flush++;
    else if (a[0] === b[0] && bRanks.includes(a[0])) sets++;
  }
  return { flush, sets, total: flush + sets };
}
function blockerSpec() {
  for (let g = 0; g < 50; g++) {
    const hearts = shuffle(RK.slice(0, 9).split('')).slice(0, 3).map(r => r + 'h');
    const offs = shuffle(RK.split('')).filter(r => !hearts.some(h => h[0] === r)).slice(0, 2).map((r, i) => r + (i ? 'c' : 'd'));
    const board = shuffle(hearts.concat(offs));
    const bR = board.map(c => c[0]);
    const hi = shuffle(['J', 'Q', 'K', 'A'].filter(r => !bR.includes(r)));
    if (!hi.length) continue;
    const free = RK.split('').filter(r => !bR.includes(r) && r !== hi[0]);
    const x = pick(free), y = pick(RK.split('').filter(r => !bR.includes(r) && r !== x && r !== hi[0]));
    const A = [hi[0] + 'h', x + 'd'];
    const lo = shuffle(free.filter(r => r !== x));
    const Bh = [lo[0] + 'd', lo[1] + 's'];
    if (A.concat(Bh).some(c => board.includes(c))) continue;
    return { board, hands: Math.random() < 0.5 ? [A, Bh] : [Bh, A] };
  }
  return { board: ['2h', '5h', '9h', 'Kd', '3c'], hands: [['Ah', '7d'], ['8d', '6s']] };
}
function blockerTruth(sp) {
  const base = callingCombos(sp.board, sp.board);
  const left = sp.hands.map(h => callingCombos(sp.board, sp.board.concat(h)));
  const best = left[0].total <= left[1].total ? 0 : 1;
  return { base, left, best };
}

// ---------- building an item ----------
// stored hands: facing decisions carry the pot (BB, their bet included) and the price to call as `need`
function fromHands(H, avoid) {
  const out = [];
  for (const h of [...(H.history.hands || [])].reverse().slice(0, 60)) for (const d of h.decisions || []) {
    if (!d.facing || d.need == null || !(d.pot > 0) || d.need <= 0 || d.need >= 1) continue;
    const B = Math.round((d.need * d.pot / (1 - d.need)) * 10) / 10, P = Math.round((d.pot - B) * 10) / 10;
    if (!(B > 0) || !(P > 0)) continue;
    out.push({ P, B, id: `hand #${h.no}`, street: d.street, hand: h.no });
  }
  const fresh = out.filter(x => !avoid.includes(x.id + x.P + x.B));
  return pick(fresh.length ? fresh : out.length ? out : [null]);
}
const SAMPLE = [[10, 4], [6, 3], [12, 6], [8, 8], [20, 10], [15, 5], [9, 6], [4, 2], [14, 7], [25, 10]];
const recentSigs = [];
export function newSpec(H, kind) {
  let spec;
  for (let t = 0; t < 12; t++) { spec = newSpec1(H, kind); if (!recentSigs.includes(spec.sig)) break; }
  recentSigs.push(spec.sig); if (recentSigs.length > 14) recentSigs.shift();
  return spec;
}
function newSpec1(H, kind) {
  const src = kind === 'blocker' || kind === 'spr' ? null : fromHands(H, []);
  let spec;
  if (kind === 'blocker') { const b = blockerSpec(); spec = { kind, src: 'sample', board: b.board, hands: b.hands }; }
  else if (kind === 'spr') { const P = pick([4, 5, 6, 8, 10, 12, 15]), S = pick([20, 30, 40, 60, 80, 90, 100]); spec = { kind, src: 'sample', S, P }; }
  else if (src) spec = { kind, src: src.id, hand: src.hand, street: src.street, P: src.P, B: src.B };
  else { const [P, B] = pick(SAMPLE); spec = { kind, src: 'sample', P, B }; }
  spec.sig = sigOf(spec);
  return spec;
}
export const sigOf = (s) => s.kind === 'blocker' ? `blocker:${s.board.join('')}:${s.hands.map(h => h.join('')).join('/')}` : s.kind === 'spr' ? `spr:${s.S}:${s.P}` : `${s.kind}:${s.P}:${s.B}`;

function pctChoices(c, wrongs) {
  const set = [c]; for (const w of wrongs) if (w >= 1 && w <= 99 && !set.includes(w)) set.push(w);
  for (const d of [5, -5, 9, -9, 14, 3, -3, 20]) { if (set.length >= 4) break; const w = c + d; if (w >= 1 && w <= 99 && !set.includes(w)) set.push(w); }
  return shuffle(set.slice(0, 4)).map(v => ({ v, label: `${v} percent`, ok: v === c }));
}
const strStreet = (s) => ({ preflop: 'preflop', flop: 'flop', turn: 'turn', river: 'river' }[s.street] || '');
const where = (s) => s.src === 'sample' ? 'Sample spot' : `Your ${strStreet(s) ? strStreet(s) + ' ' : ''}${s.src}`;

// returns { q, parts, choices, truth, explain, bb, tag }
export function build(spec) {
  const { kind, P, B } = spec;
  const w = where(spec);
  if (kind === 'equity') {
    const need = answers.equity(P, B), c = pc(need);
    const lose = Math.max(0, need - 0.07), evw = lose * (P + 2 * B) - B;
    return {
      q: `${w}: villain bets ${f1(B)} BB into a ${f1(P)} BB pot. How much equity do you need to call?`,
      parts: {
        definition: 'Required equity is the share of the time your hand must win at showdown for a call to break even, set by the price the bet offers you.',
        inputs: `Pot before the bet ${f1(P)} BB. Their bet ${f1(B)} BB.`,
        steps: ['1. Add up the final pot if you call: the pot, their bet, and your call of the same size.', '2. Divide what you must pay by that final pot.', '3. Turn the fraction into a percent.'],
        example: 'Worked example with other numbers: a bet of 2 into 6 makes a final pot of 6 + 2 + 2 = 10, and 2 / 10 = 20 percent.',
        brief: 'Call / (pot + bet + call).',
        hint: 'Count what the pot holds after you call, including your own chips, then compare your price with it.',
      },
      choices: pctChoices(c, [pc(B / (P + B)), pc(B / P), pc(P / (P + 2 * B))]), truth: c,
      explain: `The answer is ${c} percent: you call ${f1(B)} BB to win a final pot of ${f1(P)} + ${f1(B)} + ${f1(B)} = ${f1(P + 2 * B)} BB, and ${f1(B)} / ${f1(P + 2 * B)} = ${c} percent. Holding only ${pc(lose)} percent equity here loses about ${f1(-evw)} BB per call.`,
      bb: `Cost of calling with ${pc(lose)} percent equity here: ${f1(-evw)} BB per call, ${pc(lose)} percent of ${f1(P + 2 * B)} minus ${f1(B)}.`,
    };
  }
  if (kind === 'mdf') {
    const m = answers.mdf(P, B), c = pc(m), bluff = (1 - m + 0.1) * P - (m - 0.1) * B;
    return {
      q: `${w}: villain bets ${f1(B)} BB into a ${f1(P)} BB pot. What share of your range must continue (minimum defense frequency) so that bluffing cannot profit automatically?`,
      parts: {
        definition: 'Minimum defense frequency (MDF) is the share of your hands that must call or raise so a bet of this size cannot show a profit with any bluff.',
        inputs: `Pot before the bet ${f1(P)} BB. Their bet ${f1(B)} BB.`,
        steps: ['1. Take the pot before the bet.', '2. Divide it by the pot plus their bet.', '3. That share of your range has to stay in.'],
        example: 'Worked example with other numbers: a bet of 3 into 6 gives 6 / (6 + 3) = 6 / 9 = 67 percent to defend.',
        brief: 'Pot / (pot + bet).',
        hint: 'The bigger the bet, the more hands you may fold. Compare the pot with the pot plus the bet.',
      },
      choices: pctChoices(c, [pc(B / (P + B)), pc(P / (P + 2 * B)), pc(B / (P + 2 * B))]), truth: c,
      explain: `The answer is ${c} percent: ${f1(P)} / (${f1(P)} + ${f1(B)}) = ${f1(P)} / ${f1(P + B)} = ${c} percent. If you fold 10 points more, a ${f1(B)} BB bluff gains about ${f1(bluff)} BB each time (fold share ${pc(1 - m + 0.1)} percent of ${f1(P)} won, the rest ${f1(B)} lost).`,
      bb: `Cost of folding 10 points too often: a ${f1(B)} BB bluff earns about ${f1(bluff)} BB per try.`,
    };
  }
  if (kind === 'fold') {
    const need = answers.fold(P, B), c = pc(need), evAt = (need + 0.1) * P - (1 - need - 0.1) * B;
    return {
      q: `${w}: you bluff ${f1(B)} BB into a ${f1(P)} BB pot. How often must villain fold for the bluff to break even?`,
      parts: {
        definition: 'The break-even fold frequency is how often a pure bluff must work to cover what it risks when it does not.',
        inputs: `Pot before your bet ${f1(P)} BB. Your bet ${f1(B)} BB.`,
        steps: ['1. Your bet is the risk; the pot is what you win when they fold.', '2. Divide the risk by risk plus reward.', '3. The result is the fold share you need.'],
        example: 'Worked example with other numbers: a bet of 5 into 10 risks 5 to win 10, so 5 / (5 + 10) = 5 / 15 = 33 percent.',
        brief: 'Bet / (pot + bet).',
        hint: 'Which is your risk and which is your reward when the bluff fails or works? Put the risk over their sum.',
      },
      choices: pctChoices(c, [pc(B / (P + 2 * B)), pc(P / (P + B)), pc(B / P)]), truth: c,
      explain: `The answer is ${c} percent: ${f1(B)} / (${f1(P)} + ${f1(B)}) = ${f1(B)} / ${f1(P + B)} = ${c} percent. If they fold ${pc(need + 0.1)} percent you gain about ${f1(evAt)} BB per bluff.`,
      bb: `Gain if villain folds 10 points more than needed: about ${f1(evAt)} BB per bluff.`,
    };
  }
  if (kind === 'spr') {
    const { S, P: PP } = spec, v = Math.round(answers.spr(S, PP) * 10) / 10;
    const wrong = [Math.round(PP / S * 100) / 100, Math.round((S + PP) / PP * 10) / 10, Math.round(S / (2 * PP) * 10) / 10, Math.round(S / PP * 10) / 5];
    const set = [v]; for (const x of wrong) if (x > 0 && !set.includes(x)) set.push(x);
    for (const d of [1, 2, 0.5]) { if (set.length >= 4) break; if (!set.includes(v + d)) set.push(v + d); }
    return {
      q: `Sample spot: ${S} BB behind and a ${PP} BB pot. What is the stack-to-pot ratio (SPR)?`,
      parts: {
        definition: 'Stack-to-pot ratio compares the chips left behind with the pot, and tells you how committed a hand is: low means one bet gets you all in.',
        inputs: `Chips behind ${S} BB. Pot ${PP} BB.`,
        steps: ['1. Take the effective stack still behind.', '2. Divide it by the pot.', '3. Low ratios (under 3) commit one pair; high ratios (over 10) need strong hands to get all in.'],
        example: 'Worked example with other numbers: 40 BB behind and a 10 BB pot gives 40 / 10 = 4.',
        brief: 'Stack / pot.',
        hint: 'It is a plain ratio of two numbers on the screen; decide which one goes on top.',
      },
      choices: shuffle(set.slice(0, 4)).map(x => ({ v: x, label: String(x), ok: x === v })), truth: v,
      explain: `The answer is ${v}: ${S} / ${PP} = ${v}. ${v < 3 ? 'That is low, so one pair is often happy to commit.' : v > 10 ? 'That is high, so only strong hands want to get all in.' : 'That is in the middle: top pair plays one or two streets, not three.'}`,
      bb: null,
    };
  }
  // blocker
  const t = blockerTruth(spec), [h1, h2] = spec.hands;
  const fmt = (h) => h.map(cardName).join(' ');
  return {
    q: `Sample spot: board ${spec.board.map(cardName).join(' ')}. Villain would call a river bet with strong flushes (a heart J or higher) and sets: ${t.base.total} combos. You will bluff with Hand 1 (${fmt(h1)}) or Hand 2 (${fmt(h2)}). Which is the better bluff?`,
    parts: {
      definition: 'A good bluff holds cards that remove hands villain would call with, so fewer calling hands remain; cards that do not touch their range remove none.',
      inputs: `Calling range ${t.base.total} combos (${t.base.flush} flush, ${t.base.sets} sets).`,
      steps: ['1. Start from the number of combos in their calling range.', '2. For each hand, remove the combos that use a card you hold.', '3. The hand that leaves fewer calling combos is the better bluff.'],
      example: 'Worked example with other numbers: a range of 40 combos where your hand removes 9 leaves 40 - 9 = 31.',
      brief: 'Range combos minus the ones your cards remove.',
      hint: 'Look for a card of the flush suit or a card matching a board rank in each hand; does that card appear in their calling hands?',
    },
    choices: [{ v: 0, label: 'Hand 1', ok: t.best === 0 }, { v: 1, label: 'Hand 2', ok: t.best === 1 }], truth: t.left[t.best].total,
    explain: `The answer is Hand ${t.best + 1}: it leaves ${t.left[t.best].total} calling combos (${t.base.total} minus ${t.base.total - t.left[t.best].total} removed), while Hand ${2 - t.best} leaves ${t.left[1 - t.best].total} (${t.base.total} minus ${t.base.total - t.left[1 - t.best].total}). Fewer calling hands means the bluff gets through more often.`,
    bb: null,
  };
}

// ---------- scheduling ----------
const q = []; // within-session returns: { spec, due }
let served = 0; // items shown in this page load (a quiz-only session counts its own)
export function inSessionDue(streamN) { return q.some(x => x.due <= streamN); }
export const crossDayDue = () => SCH.hasDue('quiz');
export function nextSpec(H, streamN, opts = {}) {
  const i = q.findIndex(x => x.due <= streamN);
  if (i >= 0) { const x = q.splice(i, 1)[0]; return { spec: x.spec, review: true, box: x.box }; }
  const d = SCH.takeDue('quiz');
  if (d && d.spec) return { spec: d.spec, review: true, box: 0, cross: true };
  if (cyc == null) cyc = rnd(CYCLE.length);
  let kind = CYCLE[cyc++ % CYCLE.length];
  if (opts.moneyOnly && !MONEY_KINDS.includes(kind)) kind = pick(MONEY_KINDS);
  return { spec: newSpec(H, kind), review: false, box: 0 };
}

// ---------- rendering ----------
// ctx: { openPanel, panelView, H }; opts: { title, streamN(), onNext(), moneyOnly }
export function showQuiz(ctx, opts) {
  const { H } = ctx;
  const sN = opts.streamN ? opts.streamN() : served;
  const { spec, review, box, cross } = nextSpec(H, sN, opts);
  served++;
  const it = build(spec), lvl = fadeLevel(H);
  const letters = it.choices;
  const due = SCH.dueLine();
  const leakRow = '';
  ctx.openPanel(opts.title || 'Quiz', `<div class="quiz" data-judgment="quiz" data-kind="${spec.kind}" data-source="${esc(spec.src)}" data-review="${review ? 1 : 0}" data-truth="${it.truth}">
    <p class="quiz-spot">${esc(it.q)}</p>
    ${leakRow}
    <p class="small dim">${review ? 'A question you missed earlier is back.' : 'Short recall question.'} ${esc(spec.src === 'sample' ? 'This one uses a labeled sample spot.' : 'Numbers come from your stored hand; its result stays hidden.')}</p>
    ${scaffoldHTML(it.parts, lvl)}
    <div class="quiz-acts">${letters.map((c, i) => `<button class="btn" type="button" data-i="${i}">${esc(c.label)}</button>`).join('')}</div>
    <div class="quiz-out"></div>
    <p class="small dim quiz-due">${esc(due)}</p></div>`);
  const body = ctx.panelView(), acts = body.querySelector('.quiz-acts');
  wireHint(body);
  acts.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b || acts.dataset.done) return;
    acts.dataset.done = '1';
    const c = letters[+b.dataset.i], ok = !!c.ok;
    acts.querySelectorAll('button').forEach((x, k) => { x.disabled = true; if (k === +b.dataset.i) x.classList.add('chosen'); if (letters[k].ok) x.classList.add('coach-pick'); });
    // within-session return: a miss comes back in 2-3 items, a correct review in 9-11 (Leitner)
    if (!ok) q.push({ spec, box: 0, due: sN + 1 + 2 + rnd(2) });
    else if (review && box < 1) q.push({ spec, box: 1, due: sN + 1 + 9 + rnd(3) });
    SCH.record('quiz', spec.sig, ok, spec);
    body.querySelector('.quiz-out').innerHTML = `<p><span class="grade ${ok ? 'qok' : 'qno'}">${ok ? 'Correct' : 'Not quite'}</span> You chose ${esc(c.label)}.</p>
      <p class="cb-explain" data-coach="explain">${esc(it.explain)}</p>
      ${it.bb ? `<p class="dim small">${esc(it.bb)}</p>` : ''}
      <p class="dim small">${esc(SCH.dueLine())}</p>`;
    const nb = document.createElement('div'); nb.className = 'drill-next-bar quiz-next-bar';
    nb.innerHTML = '<button class="btn primary wide drill-next" data-pf="1" type="button">Next question</button>';
    body.appendChild(nb);
    nb.querySelector('.drill-next').addEventListener('click', (ev) => { ev.stopPropagation(); opts.onNext(); });
  });
}

// quiz-only session (menu entry)
export function openQuiz(ctx) {
  const again = () => showQuiz(ctx, { title: 'Quiz', onNext: again });
  again();
}
