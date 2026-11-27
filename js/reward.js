// Reward moment after a drill answer (Levi's dopamine audit, 2026-11-27).
// Fires only for a CORRECT answer (the solver's top action) to a HARD item (1 - top frequency >= 0.25),
// never on wrong answers, easy items or mere activity. Its size follows the surprise: how unlikely a
// correct answer was given the player's own recent accuracy on this spot type (reward prediction
// error, Schultz, Dayan & Montague 1997: dopamine tracks outcome minus expectation, so an expected
// win teaches little and feels like little). Real improvement (rolling accuracy up, a missed spot
// turned around) is stated in plain numbers: visible progress (Amabile & Kramer 2011, progress
// principle; speculative as a retention effect for drills). Quiet by design: gold on black, no emoji,
// no sound, no counter that rewards volume.

export const HARD = 0.25;
export const isHard = (topFreq) => 1 - topFreq >= HARD;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// prior: { acc, n } for this spot type before the answer; now: { acc, n } after it.
// returns null (no reward) or { tier 1..3, lines[] }
export function rewardFor({ correct, topFreq, prior, now, review, label }) {
  if (!correct || !isHard(topFreq)) return null;
  // expectation of being right: the player's own rolling accuracy here, else the item's own difficulty
  const expect = prior && prior.n >= 5 ? prior.acc : clamp(topFreq, 0.2, 0.8);
  const delta = 1 - expect; // positive prediction error of a correct answer
  const tier = delta >= 0.5 ? 3 : delta >= 0.3 ? 2 : 1;
  const lines = [tier === 3 ? 'Hard spot, and you found it.' : tier === 2 ? 'Hard spot. Correct.' : 'Correct on a hard spot.'];
  const pct = (x) => Math.round(100 * x);
  if (prior && prior.n >= 5 && now && now.acc - prior.acc >= 0.03) lines.push(`Your ${label} accuracy moved from ${pct(prior.acc)} to ${pct(now.acc)} percent over your last ${Math.min(now.n, 20)}.`);
  if (review) lines.push('You missed this spot before. Turned around.');
  return { tier, lines };
}

export function rewardHTML(r) {
  if (!r) return '';
  return `<div class="reward" data-reward data-tier="${r.tier}">${r.lines.map(l => `<p>${l}</p>`).join('')}</div>`;
}
