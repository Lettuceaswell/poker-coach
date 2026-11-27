// Progress screen: per-session aggregates, trend lines, earned-only personal bests.
// Reads history's db read-only; keeps its own localStorage key.
import { history as db } from './history.js';

const KEY = 'poker-coach-progress-v1';
const MIN_DEC = 8; // a "personal best" needs a real sample
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v?.sessions) ? v : { sessions: [] }; } catch { return { sessions: [] }; } };
const store = load();
const t0 = Date.now();
const base = { hands: db.hands.length, dn: db.drills.n, dg: db.drills.good, cn: db.calib.n, ch: db.calib.hits };
const cur = { t: t0 };

function snap() {
  let dec = 0, ok = 0, bb = 0;
  for (const h of db.hands) {
    if (h.t < t0) continue;
    for (const r of h.decisions || []) {
      if (!r.mix || !r.mix.length || !(r.quality === 'exact' || r.quality === 'solved')) continue;
      dec++; if (!r.leak) ok++; else bb += r.leak.ev || 0;
    }
  }
  Object.assign(cur, { dec, ok, bb, dn: db.drills.n - base.dn, dg: db.drills.good - base.dg, cn: db.calib.n - base.cn, ch: db.calib.hits - base.ch });
  if (!(cur.dec || cur.dn || cur.cn)) return;
  const i = store.sessions.findIndex(s => s.t === t0);
  if (i < 0) store.sessions.push({ ...cur }); else store.sessions[i] = { ...cur };
  store.sessions = store.sessions.slice(-30);
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* full */ }
}
snap();
setInterval(snap, 2000);
addEventListener('pagehide', snap);

const pct = (a, b) => b ? 100 * a / b : null;
const metrics = [
  { k: 'acc', name: 'Decision accuracy', f: s => pct(s.ok, s.dec), fmt: v => `${v.toFixed(0)}%`, up: true, n: s => s.dec },
  { k: 'bb', name: 'BB lost per 100 decisions', f: s => s.dec ? 100 * s.bb / s.dec : null, fmt: v => v.toFixed(1), up: false, n: s => s.dec },
  { k: 'cal', name: 'Calibration hit rate (target 90%)', f: s => pct(s.ch, s.cn), fmt: v => `${v.toFixed(0)}%`, up: true, n: s => s.cn, target: 90 },
  { k: 'drl', name: 'Drill accuracy', f: s => pct(s.dg, s.dn), fmt: v => `${v.toFixed(0)}%`, up: true, n: s => s.dn },
];

function spark(vals, target) {
  const W = 260, H = 44, pts = vals.filter(v => v != null);
  if (!pts.length) return '';
  const lo = Math.min(...pts, target ?? Infinity), hi = Math.max(...pts, target ?? -Infinity), span = (hi - lo) || 1;
  const x = i => vals.length < 2 ? W / 2 : 4 + i * (W - 8) / (vals.length - 1);
  const y = v => H - 4 - (v - lo) / span * (H - 8);
  const line = vals.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const dots = vals.map((v, i) => v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="#d4af37"/>`).join('');
  const tl = target != null ? `<line x1="0" x2="${W}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" stroke="#777" stroke-dasharray="3 3"/>` : '';
  return `<svg class="pg-spark" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${tl}<polyline points="${line}" fill="none" stroke="#d4af37" stroke-width="2"/>${dots}</svg>`;
}

// Reward only on measured improvement over the best earlier session with a real sample.
function earned(m, sessions) {
  const last = sessions.at(-1);
  if (!last || m.n(last) < MIN_DEC || m.f(last) == null) return '';
  const prev = sessions.slice(0, -1).filter(s => m.n(s) >= MIN_DEC && m.f(s) != null);
  if (!prev.length) return '';
  const v = m.f(last), bestPrev = prev.reduce((b, s) => m.up ? Math.max(b, m.f(s)) : Math.min(b, m.f(s)), m.up ? -Infinity : Infinity);
  const d = m.up ? v - bestPrev : bestPrev - v;
  if (d < 1) return '';
  return `<div class="pg-best">Personal best: ${m.fmt(v)}, ${m.up ? '+' : '-'}${d.toFixed(1)}${m.k === 'bb' ? ' BB/100' : ' pts'} on your previous best</div>`;
}

export function progressHTML() {
  snap();
  const S = store.sessions;
  if (!S.length) return '<p class="dim">No sessions yet. Play hands, drills or an orbit review and your trends appear here.</p>';
  const rows = metrics.map(m => {
    const vals = S.map(s => m.n(s) ? m.f(s) : null);
    const latest = vals.filter(v => v != null).at(-1);
    const n = S.reduce((a, s) => a + m.n(s), 0);
    return `<div class="pg-row"><div class="pg-head"><span>${m.name}</span><b>${latest == null ? 'no data' : m.fmt(latest)}</b></div>
      ${spark(vals, m.target)}<div class="small dim">${S.length} session${S.length > 1 ? 's' : ''}, ${n} samples${m.target ? ', dashed line = 90%' : ''}</div>${earned(m, S)}</div>`;
  }).join('');
  const tot = db.calib.n ? `<p class="small dim">All time calibration: ${db.calib.hits} of ${db.calib.n} intervals caught the truth (${Math.round(100 * db.calib.hits / db.calib.n)}%). A calibrated 90% interval catches it 9 times in 10.</p>` : '';
  return `<div class="pg">${rows}${tot}<p class="small dim">Accuracy counts decisions on solved spots where your action was in the solver's mix. Bests are shown only when a session beats your earlier best by a measured margin.</p></div>`;
}

// Compact menu trend: accuracy per session (decisions, else drills) with latest value.
export function progressMini() {
  snap();
  const pick = [metrics[0], metrics[3]].find(m => store.sessions.filter(s => m.n(s) > 0).length >= 1);
  if (!pick) return '';
  const S = store.sessions.filter(s => pick.n(s) > 0), vals = S.map(pick.f);
  return `<div class="pg-head"><span>${pick.name} per session</span><b>${pick.fmt(vals.at(-1))}</b></div>${spark(vals)}`;
}
