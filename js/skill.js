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
  return plan.any ? 0.15 + 0.4 * plan.postShare : base;
}
// leak a preflop scenario key ("SB first in") targets, if it is one of the top leaks
export function leakForPre(plan, key) { return plan.top.find(l => !l.post && l.key.split('|')[0] === key) || null; }
// leak a postflop spot targets: same street and same facing-a-bet / first-to-act
export function leakForPost(plan, s) {
  return plan.top.find(l => l.post && l.key.startsWith(s.street + ' ') && /facing a bet/.test(l.key) === !!s.facing) || null;
}

// ---------- skill estimate ----------
// prior = lifetime accuracy (weight capped at 20 answers so it informs but cannot freeze the estimate);
// evidence = last 12 answers; per-spot-type recent answers pull the estimate (weight 6 prior).
export function skillEstimate(H, type) {
  const d = H.history.drills, rec = (d.recent || []).slice(-12);
  const life = d.n ? d.good / d.n : null;
  let acc, w;
  if (life == null && !rec.length) return { skill: null, n: 0, recent: rec };
  const W = Math.min(d.n - rec.length > 0 ? d.n - rec.length : 0, 20);
  if (rec.length) { const r = sum(rec); acc = ((W * (life ?? 0.5)) + r) / (W + rec.length); w = W + rec.length; }
  else { acc = life; w = W; }
  const t = ((d.types || {})[type] || []).slice(-8);
  if (type && t.length) acc = (6 * acc + sum(t)) / (6 + t.length);
  return { skill: acc, n: w, recent: rec };
}
// target difficulty (1 - solver top frequency): 0 = clear hands, ~0.45 = hands where the solver mixes
export function targetDifficulty(skill) {
  if (skill == null) return 0;
  return 0.45 * Math.max(0, Math.min(1, (skill - 0.55) / 0.38));
}
// weight of an item with difficulty dif for this target (kernel; every item keeps a small chance)
export const diffWeight = (dif, target) => 0.03 + Math.exp(-((dif - target) ** 2) / (2 * 0.13 * 0.13));
export function pickWeighted(items, wf) {
  const w = items.map(wf); let r = Math.random() * sum(w);
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// plain-words line about the difficulty being served
export function difficultyLine(H, type) {
  const e = skillEstimate(H, type), d = H.history.drills;
  if (e.skill == null) return 'New here: starting with clear spots; closer calls come as your answers get steadier.';
  const s = pct(e.skill), m = e.recent.length;
  const misses = e.recent.slice(-3).filter(x => !x).length;
  const basis = m ? `${s}% (your ${d.n} drills blended with your last ${m})` : `${s}% (from your ${d.n} drills)`;
  if (misses >= 2) return `Two misses in your last 3: easing off to clearer spots until they come back. You're at ${basis}.`;
  if (e.skill >= 0.85) return `You're at ${basis}: serving closer spots where the solver mixes, aiming for about 85% right.`;
  if (e.skill >= 0.65) return `You're at ${basis}: serving a mix of clear and close spots.`;
  return `You're at ${basis}: serving clearer spots until about 85% of them are right.`;
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
  const next = m.L < 4 ? ` Next step: ${STEPS[m.L][0]} answers at ${pct(STEPS[m.L][1])}%.` : '';
  const up = prevL != null && m.L > prevL ? ` Up from ${prevL}.` : '';
  return `<p class="progress-line">${label}: mastery level ${m.L} of 4, ${m.hits} of your last ${m.n} right.${up}${next} All spots: ${d.good} right of ${d.n}.</p>`;
}
export const levelBefore = (H, type) => masteryOf((H.history.drills.types || {})[type] || []).L;
