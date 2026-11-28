// Deliberate practice and desirable difficulty for the drill stream (run 3).
// - leakPlan: where the priced leaks are, so drills come from them (deliberate practice, Ericsson,
//   Krampe & Tesch-Romer 1993: practice the specific weakness with feedback).
// - skillEstimate: a Bayesian-style blend of the long-run history (the prior) and the most recent
//   answers, mapped continuously to a target difficulty. Aim: about 85% right so every item is hard but
//   doable (Wilson et al. 2019, "the 85% rule"; desirable difficulties, Bjork 1994).
// - mastery: a true per-spot progress count recomputed from stored answers; shown only after a correct
//   answer (progress principle, Amabile & Kramer 2011; transfer to real play is speculative).
// Everything is computed from localStorage history; nothing here is random except sampling.

const pct = (x) => Math.round(100 * x);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// ---------- leaks ----------
// leaks: history.leaks. Cost in BB when priced (ev), else a rough frequency cost.
const leakCost = (l) => l.ev || l.cost || 0;
export function leakPlan(H) {
  const all = Object.values(H.history.leaks || {}).filter(l => leakCost(l) > 0).sort((a, b) => leakCost(b) - leakCost(a)).slice(0, 6);
  if (!all.length) return { top: [], postShare: 0, any: false };
  const isPost = (l) => !/^(UTG|HJ|CO|BTN|SB|BB|MP|LJ)\b/.test(l.key);
  const tot = sum(all.map(leakCost));
  const post = sum(all.filter(isPost).map(leakCost));
  return { top: all.map((l, i) => ({ ...l, rank: i + 1, post: isPost(l), bb: l.ev || 0 })), postShare: tot ? post / tot : 0, any: true };
}
const fmtBB = (l) => l.bb > 0 ? `-${l.bb.toFixed(1)} BB` : `${l.n} misses`;
export function leakLabel(l) {
  const name = l.key.replace('|', ', ');
  return `${l.rank === 1 ? 'Your top leak' : 'One of your top leaks'}: ${name}, ${fmtBB(l)}`;
}
// chance that the next item is postflop: scaled by the postflop share of leak cost; unchanged with no leaks
export function postflopProb(plan, base = 0.45) {
  return plan.any ? 0.1 + 0.45 * plan.postShare : base;
}
// leak a preflop scenario key ("SB first in") targets, if it is one of the top leaks
export function leakForPre(plan, key) { return plan.top.find(l => !l.post && l.key.split('|')[0] === key) || null; }
// leak a postflop spot targets: same street and same facing-a-bet / first-to-act
export function leakForPost(plan, s) {
  return plan.top.find(l => l.post && l.key.startsWith(s.street + ' ') && /facing a bet/.test(l.key) === !!s.facing) || null;
}

// ---------- skill estimate ----------
// prior = lifetime accuracy (weight capped at 6 answers so it informs but cannot freeze the estimate);
// evidence = last 10 answers; per-spot-type recent answers pull the estimate (weight 6 prior).
export function skillEstimate(H, type) {
  const d = H.history.drills, rec = (d.recent || []).slice(-10);
  const life = d.n ? d.good / d.n : null;
  let acc, w;
  if (life == null && !rec.length) return { skill: null, n: 0, recent: rec };
  const W = Math.min(d.n - rec.length > 0 ? d.n - rec.length : 0, 6);
  if (rec.length) { const r = sum(rec); acc = ((W * (life ?? 0.5)) + r) / (W + rec.length); w = W + rec.length; }
  else { acc = life; w = W; }
  const t = ((d.types || {})[type] || []).slice(-8);
  if (type && t.length) acc = (6 * acc + sum(t)) / (6 + t.length);
  // shrink toward an even-odds prior until there are enough graded drills (one or two answers say almost
  // nothing; 8 pseudo-answers at 50 percent, so 10 answers move halfway and 60 answers barely)
  const k = PRIOR_N / (PRIOR_N + d.n);
  acc = 0.5 * k + acc * (1 - k);
  // two misses in the last 3: the estimate drops at once (ease off after a bad run)
  if (isEasing(H)) acc = Math.min(acc, 0.55);
  if (isFresh(H)) acc = Math.min(acc, 0.55); // fresh profile: low band
  return { skill: acc, n: w, recent: rec };
}
const PRIOR_N = 8;
// two or more misses in the last 3 answers
// (or 3 or more misses in the last 10: the ease-off lasts until a bad run has rolled out of the window)
export function isEasing(H) {
  const all = H.history.drills.recent || [], r = all.slice(-3);
  return (r.length >= 2 && r.filter(x => !x).length >= 2) || all.slice(-10).filter(x => !x).length >= 3;
}
// fewer than ~10 graded drills: held to the low band whatever the first answers were
export const isFresh = (H) => (H.history.drills.n || 0) < 10;
// target difficulty (1 - solver top frequency): 0 = clear hands, ~0.45 = hands where the solver mixes
export function targetDifficulty(skill) {
  if (skill == null) return 0.05; // no history: clear spots
  // above 0.8 the target rides past the easiest mixed hands (edge-of-range hands weigh most)
  const t = Math.max(0, Math.min(1, (skill - 0.55) / 0.35));
  return 0.5 * t + (skill > 0.8 ? 0.1 * Math.min(1, (skill - 0.8) / 0.12) : 0);
}
// weight of an item with difficulty dif for this target (kernel; every item keeps a small chance)
export const diffWeight = (dif, target) => 0.004 + Math.exp(-((dif - target) ** 2) / (2 * 0.13 * 0.13));
export function pickWeighted(items, wf) {
  const w = items.map(wf); let r = Math.random() * sum(w);
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// plain-words line about the difficulty being served
export function difficultyLine(H, type) {
  const e = skillEstimate(H, type), d = H.history.drills;
  if (e.skill == null || isFresh(H)) return `New here (${d.n || 0} answered so far): starting with clear spots; closer calls come once you have about 10 answers on record.`;
  const s = pct(e.skill), m = e.recent.length;
  const misses = e.recent.slice(-3).filter(x => !x).length;
  const basis = m ? `${s} percent (your ${d.n} drills blended with your last ${m})` : `${s} percent (from your ${d.n} drills)`;
  if (isEasing(H)) return `${misses >= 2 ? 'Two misses in your last 3' : 'Several misses in your last 10'}: easing off to clearer spots until they come back. You're at ${basis}.`;
  if (e.skill >= 0.85) return `You're at ${basis}: serving closer spots where the solver mixes, aiming for about 85 percent right.`;
  if (e.skill >= 0.65) return `You're at ${basis}: serving a mix of clear and close spots.`;
  return `You're at ${basis}: serving clearer spots until about 85 percent of them are right.`;
}

// ---------- mastery (progress after a correct answer) ----------
const STEPS = [[4, 0.5], [6, 0.7], [10, 0.8], [15, 0.9]]; // [answers needed, accuracy needed] for steps 1..4
export function masteryOf(arr) {
  const n = arr.length, acc = n ? sum(arr) / n : 0;
  let L = 0; STEPS.forEach(([a, c], i) => { if (n >= a && acc >= c) L = i + 1; });
  return { L, n, hits: sum(arr), acc };
}
// type: 'preflop SB first in'; call after H.recordDrill so the answer is included.
export function progressLine(H, type, label, prevL) {
  const arr = (H.history.drills.types || {})[type] || [];
  const m = masteryOf(arr), d = H.history.drills;
  const next = m.L < 4 ? ` Next step: ${STEPS[m.L][0]} answers at ${pct(STEPS[m.L][1])} percent.` : '';
  const up = prevL != null && m.L > prevL ? ` Up from ${prevL}.` : '';
  return `<p class="progress-line">${label}: mastery level ${m.L} of 4, ${m.hits} of your last ${m.n} right.${up}${next} All spots: ${d.good} right of ${d.n}.</p>`;
}
export const levelBefore = (H, type) => masteryOf((H.history.drills.types || {})[type] || []).L;

// While easing off, a due review that was a close spot waits (at most 6 items past its due mark, so a miss
// still returns within ~9 items) and clearer items go first; review difficulty counts toward the mean.
export function holdReview(H, x, dif) {
  if (!isEasing(H) || dif == null || dif <= 0.2) return false;
  return (H.history.drills.n - x.due) < 6;
}
