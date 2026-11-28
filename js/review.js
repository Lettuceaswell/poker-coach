// Hand-history review against the solver (data-feature="review").
// Each decision: the solver line (mix) and the BB cost of the action taken (0 when it is the top action).
import { strategyAt } from './coach.js';
import { scenarios, walk } from './drills.js';
import { classes } from './library.js';

const NAME = { f: 'Fold', c: 'Call', r: 'Raise' };
export const mixLine = (mix) => mix.filter(m => m.freq >= 0.005).map(m => `${NAME[m.t] || m.t} ${Math.round(m.freq * 100)}%`).join('  ');

// cost in BB of the action taken. EV from the solution when stored, else frequency gap (approx).
export function decisionCost(rec) {
  const by = {}; rec.mix.forEach(m => { by[m.t] = (by[m.t] || 0) + m.freq; });
  const top = Object.keys(by).reduce((a, b) => (by[b] > by[a] ? b : a));
  if (rec.chosen === top) return { cost: 0, top, approx: false };
  if (rec.values && rec.values.length) {
    const best = Math.max(...rec.values);
    const mine = rec.mix.map((m, i) => ({ m, v: rec.values[i] })).filter(x => x.m.t === rec.chosen).map(x => x.v);
    return { cost: Math.round(Math.max(0, best - (mine.length ? Math.max(...mine) : Math.min(...rec.values))) * 10) / 10, top, approx: false };
  }
  return { cost: Math.round(Math.max(0, by[top] - (by[rec.chosen] || 0)) * 10) / 10, top, approx: true };
}

export function storedDecisions(H) {
  const out = [];
  for (const h of [...H.history.hands, ...(H.history.live && !H.history.hands.some(x => x.no === H.history.live.no) ? [H.history.live] : [])]) for (const d of h.decisions || []) if (d.mix && d.mix.length) out.push({ hand: h, d });
  return out;
}

// Worked examples from the shipped solution when there are no stored hands yet.
export function demoDecisions(S, n) {
  if (!S || !S.strat) return [];
  const firsts = scenarios(n).filter(x => x.type === 'first');
  const out = [];
  [['AA', firsts[0]], ['72o', firsts[Math.min(3, firsts.length - 1)]]].forEach(([name, sc]) => {
    const node = walk(n, sc); if (!node) return;
    const p = strategyAt(S.strat, node, classes()[name]);
    const mix = node.acts.map((a, i) => ({ t: a.t, freq: p[i] }));
    const top = mix.reduce((a, b) => (b.freq > a.freq ? b : a));
    const worst = mix.reduce((a, b) => (b.freq < a.freq ? b : a));
    out.push({ hand: { no: 'sample', pos: sc.label.split(' ')[0] }, d: { street: 'preflop', mix, chosen: name === 'AA' ? top.t : worst.t, label: name } });
  });
  return out;
}

export async function openReview(ctx) {
  const { strategies, loadStrategy, openPanel, H } = ctx;
  let items = storedDecisions(H).slice(-30).reverse(), sample = false;
  if (!items.length) {
    const n = ctx.seats || 6;
    if (!strategies[n] || strategies[n] === 'loading') { await loadStrategy(n); for (let i = 0; i < 80 && strategies[n] === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    items = demoDecisions(strategies[n], n); sample = true;
  }
  const rows = items.map(({ hand, d }) => {
    const c = decisionCost(d);
    const you = NAME[d.chosen] || d.chosen;
    return `<div class="f-card"><div><b>${sample ? 'Sample' : 'Hand ' + hand.no}</b> ${hand.pos || ''} ${d.street} ${d.label || ''}</div>
      <div>You chose ${you}. Solver line: ${mixLine(d.mix)}</div>
      <div class="f-cost">${c.cost === 0 ? 'Cost 0 BB, matches the top action' : `Cost ${c.cost.toFixed(1)} BB vs the top action ${NAME[c.top]}${c.approx ? ' (approx, from frequencies)' : ''}`}</div></div>`;
  }).join('');
  openPanel('Hand review', `<div class="feat" data-feature="review">
    <p class="f-lead">${sample ? 'No stored hands yet, so these are two sample decisions from the solution. Play hands and they appear here.' : 'Your last decisions against the solver, newest first.'}</p>${rows}</div>`);
}
