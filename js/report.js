// Aggregated report on stored hands (data-feature="report"): BB lost by position and street.
import { shown } from './library.js';
import { decisionCost, storedDecisions, demoDecisions } from './review.js';

export async function openReport(ctx) {
  const { strategies, loadStrategy, openPanel, H } = ctx;
  let items = storedDecisions(H, { own: true }), sample = false;
  const allAssisted = !items.length && storedDecisions(H).length > 0; // decisions with the solver pick on screen do not count
  if (!items.length) {
    const n = ctx.seats || 6;
    if (!strategies[n] || strategies[n] === 'loading') { await loadStrategy(n); for (let i = 0; i < 80 && strategies[n] === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    items = demoDecisions(strategies[n], n); sample = true;
  }
  const by = {};
  for (const { hand, d } of items) {
    const k = `${hand.pos || '?'} ${d.street}`;
    by[k] = (by[k] || 0) + decisionCost(d).cost;
  }
  const rows = Object.entries(by).map(([label, c]) => ({ label, bb: Math.round(c * 10) / 10 })).sort((a, b) => b.bb - a.bb);
  const total = Math.round(rows.reduce((s, r) => s + r.bb, 0) * 10) / 10;
  const per100 = items.length ? Math.round(1000 * total / items.length) / 10 : 0;
  shown.kind = 'report'; shown.title = 'leak report by position and street'; shown.rows = rows; shown.total = total;
  openPanel('Report', `<div class="feat" data-feature="report">
    <p class="f-lead">${allAssisted ? 'All your stored decisions so far were assisted (the solver pick was on screen), so none count. Sample report:' : sample ? 'Sample report (no stored hands yet).' : 'Your stored hands against the solver.'} ${items.length} decisions, ${per100} big blinds lost per 100 decisions.</p>
    ${rows.map(r => `<div class="f-line">${r.label} ${r.bb.toFixed(1)} BB</div>`).join('')}
    <div class="f-line f-total">Total ${total.toFixed(1)} BB</div>
    <button class="btn wide f-btn" data-go="export">Export this report</button></div>`);
  ctx.panelView().querySelector('[data-go="export"]').addEventListener('click', () => import('./library.js').then(m => m.openExport(ctx)));
}
