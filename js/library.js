// Pre-solved spot library (data-feature="library") and export screen (data-feature="export").
// Reads the preflop solutions already shipped in data/preflop-N.bin; nothing is solved here.
import { treeFor, strategyAt, className } from './coach.js';
import { POSITIONS } from './preflop-tree.js';
import { scenarios, walk } from './drills.js';

const FEATURED = ['AA', 'AKs', 'AQo', 'KQs', 'JTs', '77', 'A5s', '98s', 'T9o', '72o'];
let CLASS_BY_NAME = null;
export const classes = () => {
  if (!CLASS_BY_NAME) { CLASS_BY_NAME = {}; for (let c = 0; c < 169; c++) CLASS_BY_NAME[className(c)] = c; }
  return CLASS_BY_NAME;
};

// Last strategy shown anywhere (library or report); the export screen downloads this.
export const shown = { kind: null, title: '', rows: [] };

const label = (a) => (a.t === 'f' ? 'Fold' : a.t === 'c' ? 'Call' : 'Raise');

// rows for one spot: [{ hand, mix: {Fold: 30, Raise: 70} }]
export function spotRows(S, n, sc, hands) {
  const node = walk(n, sc);
  if (!node) return null;
  const rows = hands.map((h) => {
    const p = strategyAt(S.strat, node, classes()[h]);
    const mix = {};
    node.acts.forEach((a, i) => { mix[label(a)] = (mix[label(a)] || 0) + (p ? p[i] : 0); });
    const out = {}; let sum = 0; const ks = Object.keys(mix);
    ks.forEach((k, i) => { out[k] = i === ks.length - 1 ? 100 - sum : Math.round(mix[k] * 100); sum += out[k]; });
    return { hand: h, mix: out };
  });
  const sizes = node.acts.filter(a => a.t === 'r').map(a => a.to);
  return { rows, sizes };
}
const mixText = (m) => Object.entries(m).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}%`).join('  ') || 'Fold 100%';

export async function openLibrary(ctx, state = {}) {
  const { strategies, loadStrategy, openPanel } = ctx;
  const st = Object.assign({ n: ctx.seats || 6, spot: 0, hand: 'AKs' }, state);
  if (st.n < 3 || st.n > 6) st.n = 6;
  const sub = (b) => `<div class="feat" data-feature="library">${b}</div>`;
  const render = async (replace) => {
    if (!strategies[st.n] || strategies[st.n] === 'loading') { await loadStrategy(st.n); for (let i = 0; i < 80 && strategies[st.n] === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    const S = strategies[st.n];
    if (!S || !S.strat) { openPanel('Spot library', sub('<p>No solution is stored for this table size.</p>'), '', { replace }); return; }
    const scs = scenarios(st.n);
    if (st.spot >= scs.length) st.spot = 0;
    const hands = [st.hand, ...FEATURED.filter(h => h !== st.hand)];
    const r = spotRows(S, st.n, scs[st.spot], hands);
    const res = r ? r.rows : [];
    shown.kind = 'library'; shown.title = `${st.n}-handed ${scs[st.spot].label}`; shown.rows = res;
    const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
    const html = sub(`
      <p class="f-lead">Solver strategy by hand for ${st.n} players: ${scs[st.spot].label}. Pre-solved offline; nothing to wait for.</p>
      <label class="f-row">Spot <select class="f-sel" data-k="spot">${scs.map((s, i) => opt(i, s.label, st.spot)).join('')}</select></label>
      <label class="f-row">Table size <select class="f-sel" data-k="n">${[3, 4, 5, 6].map(v => opt(v, v + ' players', st.n)).join('')}</select></label>
      <label class="f-row">Hand <select class="f-sel" data-k="hand">${Object.keys(classes()).map(h => opt(h, h, st.hand)).join('')}</select></label>
      <div class="f-rows">${res.map(x => `<div class="f-line"><b>${x.hand}</b> ${mixText(x.mix)}</div>`).join('')}</div>
      <p class="f-note">${r && r.sizes.length ? 'Raise sizes in this spot (big blinds): ' + r.sizes.join(', ') + '.' : ''} Each line is one hand and its mix sums to 100%.</p>
      <button class="btn wide f-btn" data-go="export">Export this strategy</button>`);
    openPanel('Spot library', html, '', { replace });
    const v = ctx.panelView();
    v.querySelectorAll('select[data-k]').forEach((s) => s.addEventListener('change', () => {
      const k = s.dataset.k; st[k] = k === 'hand' ? s.value : +s.value;
      if (k === 'n') st.spot = 0;
      render(true);
    }));
    v.querySelector('[data-go="export"]').addEventListener('click', () => openExport(ctx));
  };
  await render(false);
}

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function toCSV(sh) {
  const keys = [...new Set(sh.rows.flatMap(r => Object.keys(r.mix || {})))];
  if (sh.kind === 'report') return 'label,bb\n' + sh.rows.map(r => `${r.label},${r.bb}`).join('\n') + `\nTotal,${sh.total}\n`;
  return 'hand,' + keys.join(',') + '\n' + sh.rows.map(r => `${r.hand},` + keys.map(k => r.mix[k] || 0).join(',')).join('\n') + '\n';
}

export async function openExport(ctx) {
  const { strategies, loadStrategy, openPanel } = ctx;
  if (!shown.kind) { // nothing shown yet: export the default library spot
    const n = ctx.seats || 6;
    if (!strategies[n] || strategies[n] === 'loading') { await loadStrategy(n); for (let i = 0; i < 80 && strategies[n] === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); }
    const S = strategies[n]; const sc = scenarios(n)[0];
    if (S && S.strat) { shown.kind = 'library'; shown.title = `${n}-handed ${sc.label}`; shown.rows = spotRows(S, n, sc, FEATURED).rows; }
  }
  const sh = shown;
  const body = sh.kind === 'report'
    ? sh.rows.map(r => `<div class="f-line">${r.label} ${r.bb} BB</div>`).join('') + `<div class="f-line">Total ${sh.total} BB</div>`
    : sh.rows.map(r => `<div class="f-line"><b>${r.hand}</b> ${mixText(r.mix)}</div>`).join('');
  openPanel('Export', `<div class="feat" data-feature="export">
    <p class="f-lead">${sh.kind ? 'Download what is shown below: ' + sh.title : 'Nothing to export yet. Open the library or the report first.'}</p>
    <div class="f-rows">${body}</div>
    <button class="btn wide f-btn" data-fmt="json"${sh.kind ? '' : ' disabled'}>Export JSON</button>
    <button class="btn wide f-btn" data-fmt="csv"${sh.kind ? '' : ' disabled'}>Export CSV</button></div>`, '', { replace: true });
  const v = ctx.panelView();
  v.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
    const base = (sh.kind || 'poker') + '-' + sh.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (b.dataset.fmt === 'json') download(base + '.json', 'application/json', JSON.stringify({ kind: sh.kind, title: sh.title, rows: sh.rows, total: sh.total }, null, 1));
    else download(base + '.csv', 'text/csv', toCSV(sh));
  }));
}
