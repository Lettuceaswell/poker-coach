// Analysis panel (playtest note 7): one place for the analysis tools, in tabs.
// Range | History | Opponents | Board | Odds | Leaks | Stats | Tools.
// Anything that shows solver output (the solver range, opponent ranges, range equity, range-vs-range)
// is hidden behind a Show button while a decision is pending and the coach is not 'always';
// pressing it before he acts marks that decision assisted (js/history.js, VAL-PT-001).
//
// Considered from GTO Wizard / PioSolver / Flopzilla style analysis views:
//  built: range grid with hand marked + rank, solver range reveal, hand history with replay, opponent
//  ranges, board texture + draws + who it favors, pot odds + equity, leaks in BB, session stats.
//  not built tonight: EV table per action (already in the Coach panel), strategy by hand-category
//  breakdown (tiers, in the Coach panel), node-lock and multiway views (Tools links to Lab/Library).
import { handClass, className } from './coach.js';
import { EQ_VS_RANDOM } from './strength.js';
import { gridHTML } from './grid.js';
import { preflopDetail, boardTags, villainView, postflopDetail, draws } from './explain.js';
import { preflopRanges, toCombos, narrow, COMBOS, equityVsRanges } from './ranges.js';
import { describe } from './cards.js';
import { multiwayShares } from './multiway.js';

const COMBOS169 = (() => { const a = new Array(169).fill(0); COMBOS.forEach(([x, y, c]) => { a[c]++; }); return a; })();
const TABS = [['range', 'Range'], ['history', 'History'], ['opps', 'Opponents'], ['board', 'Board'], ['odds', 'Odds'], ['leaks', 'Leaks'], ['stats', 'Stats'], ['tools', 'Tools']];
const state = { tab: 'range', n: 25, reveal: {}, key: '' };

// ---- pure helpers (also used by tools/pt-assist-test.js through window.__analysis) ----
// rank of a class among a set of classes (weights > 0), combo-weighted, strongest first: share of the set at least as strong
export function rankInSet(cls, weights) {
  const eq = EQ_VS_RANDOM;
  let above = 0, total = 0, mine = 0;
  for (let c = 0; c < 169; c++) {
    const w = (weights[c] || 0) * COMBOS169[c];
    if (w <= 0) continue;
    total += w;
    if (eq[c] > eq[cls]) above += w;
    else if (c === cls) mine = w;
  }
  if (!total) return null;
  return { top: (above + mine / 2) / total, in: (weights[cls] || 0) > 0, total };
}
// the hero's own preflop range from stored hands: classes he played (didn't fold) first time he acted in this seat
export function ownRange(H, pos, sit) {
  const seen = new Array(169).fill(0), played = new Array(169).fill(0);
  let hands = 0;
  for (const h of H.history.hands) {
    if (h.pos !== pos) continue;
    const d = (h.decisions || []).find(x => x.street === 'preflop' && x.cls != null);
    if (!d || (sit && d.sit !== sit)) continue;
    seen[d.cls]++; if (d.chosen !== 'f') played[d.cls]++; hands++;
  }
  const w = played.map((p, c) => (seen[c] ? p / seen[c] : 0));
  return { w, hands, seen };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const liveDecision = (g) => !g.handOver && !g.players.find(p => p.isHero).folded && g.players.some(p => p.isHero);
const gated = (x) => liveDecision(x.game()) && x.settings.coach !== 'always';

function showBtn(tab, what) {
  return `<div class="an-hide"><p class="small dim">${what} is the solver's work, so it is hidden while a decision is waiting.</p><button class="btn wide an-show" data-reveal="${tab}">Show ${what.toLowerCase()} (counts this decision as assisted)</button></div>`;
}

async function ensureStrat(x, n) {
  if (!x.strategies[n] || x.strategies[n] === 'loading') {
    await x.loadStrategy(n);
    for (let i = 0; i < 80 && x.strategies[n] === 'loading'; i++) await new Promise(r => setTimeout(r, 100));
  }
  const S = x.strategies[n];
  return S && S.strat ? S.strat : null;
}

// ---- tabs ----
async function tabRange(x) {
  const g = x.game(), hero = g.players.find(p => p.isHero);
  if (!hero.cards.length) return '<p class="dim">Your range appears once cards are dealt.</p>';
  const heroI = g.players.indexOf(hero), pos = g.positions()[heroI], cls = handClass(hero.cards);
  const pre = g.street === 'preflop';
  const sit = pre && x.heroTurn() ? x.sitOf() : null;
  const own = ownRange(x.H, pos, sit);
  const r = rankInSet(cls, own.w);
  let html = `<section><h4>Your range from ${pos}${sit ? ' ' + sit : ''}</h4>`;
  if (own.hands < 3) html += `<p class="dim small">Only ${own.hands} of your hands so far from here. Play more and your own range fills in.</p>`;
  else html += gridHTML({ weights: own.w, mark: cls });
  html += `<p class="an-big">${className(cls)}: ${r ? (r.in ? `top ${Math.max(1, Math.round(r.top * 100))} percent of your range` : `outside your usual range (it would be top ${Math.max(1, Math.round(r.top * 100))} percent of it)`) : 'not enough hands to rank yet'}</p>
    <p class="dim small">Built from ${own.hands} hands you played from ${pos}. Brighter cell = you play it more often.</p></section>`;
  const on = state.reveal.range;
  html += `<section><h4>Solver range for ${pos}</h4><label class="an-toggle"><input type="checkbox" id="anSolver" ${on ? 'checked' : ''}><span>Reveal the solver range</span></label>`;
  if (on) {
    const n = g.players.filter(p => !p.out).length;
    const strat = await ensureStrat(x, n);
    if (pre) {
      const d = strat ? preflopDetail(g, heroI, strat) : null;
      if (d) {
        const played = d.mixes.map((m, c) => (m && d.reach[c] >= 0.05 ? m.filter(y => y.t !== 'f').reduce((s, y) => s + y.freq, 0) : 0));
        const rs = rankInSet(cls, played);
        html += gridHTML({ mixes: d.mixes, mark: d.cls, reach: d.reach });
        if (rs) html += `<p class="an-big">${className(cls)}: ${rs.in ? `top ${Math.max(1, Math.round(rs.top * 100))} percent of the solver range` : 'outside the solver range here'}</p>`;
      } else html += '<p class="dim">No solution for this spot yet.</p>';
    } else if (strat) {
      const { ranges } = preflopRanges(g, strat);
      let w = toCombos(ranges.get(heroI), [...g.board]);
      w = narrow(g, heroI, w);
      const by = new Float32Array(169), cnt = new Float32Array(169);
      COMBOS.forEach(([a, b, c], i) => { cnt[c]++; by[c] += w[i]; });
      let mx = 0; for (let c = 0; c < 169; c++) { by[c] = cnt[c] ? by[c] / cnt[c] : 0; mx = Math.max(mx, by[c]); }
      for (let c = 0; c < 169; c++) by[c] /= mx || 1;
      html += gridHTML({ weights: by, mark: cls });
      html += '<p class="dim small">The solver range that reaches this street from your seat, narrowed by your actions.</p>';
    } else html += '<p class="dim">No solver data for this table size.</p>';
  } else html += '<p class="dim small">Off. Turn it on to compare your own range with the solver\'s.</p>';
  return html + '</section>';
}

function tabHistory(x) {
  const all = x.H.history.hands;
  const N = state.n === 'all' ? all.length : state.n;
  const hands = all.slice(-N);
  const seg = `<div class="seg an-seg" data-key="n">${[10, 25, 50, 'all'].map(v => `<button data-n="${v}" class="${String(state.n) === String(v) ? 'on' : ''}">${v === 'all' ? 'All' : v}</button>`).join('')}</div>`;
  if (!hands.length) return `${seg}<p class="dim">No hands yet.</p>`;
  const net = hands.reduce((s, h) => s + h.net / h.bb, 0);
  return `${seg}<p class="small dim an-count">Showing ${hands.length} of ${all.length} hands, ${net >= 0 ? '+' : ''}${net.toFixed(1)} BB. Tap a hand for its replay and review.</p>
    <div class="hrows an-hands">${x.handRows(hands.slice().reverse())}</div>`;
}

async function tabOpps(x) {
  const g = x.game();
  const opps = g.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.isHero && !p.folded && !p.out);
  if (!opps.length || !liveDecision(g)) return '<p class="dim">Opponent ranges show while a hand is in progress.</p>';
  if (gated(x) && !state.reveal.opps) return showBtn('opps', 'Opponent ranges');
  const heroI = g.players.findIndex(p => p.isHero);
  const n = g.players.filter(p => !p.out).length;
  const strat = await ensureStrat(x, n);
  return opps.map(({ p, i }) => {
    const v = villainView(g, i, heroI, strat);
    return `<section><h4>${g.positions()[i]} · ${p.name}</h4>${gridHTML({ weights: v.weights, legend: false })}<p class="small dim">Plays about ${pct(v.width)} of hands to get here${v.eq != null ? `; your hand wins ${pct(v.eq)} against it` : ''}.</p></section>`;
  }).join('');
}

async function tabBoard(x) {
  const g = x.game(), hero = g.players.find(p => p.isHero);
  if (!g.board.length) return '<p class="dim">No board yet. The board read starts on the flop.</p>';
  const tags = boardTags(g.board);
  const dr = hero.cards.length && !hero.folded ? draws(hero.cards, g.board) : [];
  let html = `<section><h4>Texture</h4><div class="tags">${tags.map(t => `<span>${t}</span>`).join('')}</div>
    <p class="small dim">${describe([...hero.cards, ...g.board])}${dr.length ? '; you have ' + dr.join(' and ') : ''}.</p></section>`;
  const heroI = g.players.indexOf(hero);
  if (gated(x) && !state.reveal.board) return html + `<section><h4>Who the board favors</h4>${showBtn('board', 'Range advantage')}</section>`;
  const n = g.players.filter(p => !p.out).length;
  const strat = await ensureStrat(x, n);
  if (!strat || hero.folded) return html;
  const d = postflopDetail(g, heroI, strat, null);
  if (d.read && d.read.equity != null) {
    html += `<section><h4>Who the board favors</h4><div class="vs"><span>You ${pct(d.read.equity)}</span><i><b style="width:${Math.round(d.read.equity * 100)}%"></b></i><span>${d.read.them} ${pct(1 - d.read.equity)}</span></div>
      <p class="small dim">Range against range. Strongest 10 percent of hands on this board: ${pct(d.read.nutsYou)} of your range, ${pct(d.read.nutsThem)} of theirs.</p></section>`;
  } else if (n > 2 && g.players.filter(q => !q.folded && !q.out).length > 2) {
    const m = multiwayShares(g, strat);
    if (m) {
      const rows = m.players.map(r => `<div class="vs"><span>${r.hero ? 'You, ' : ''}${r.pos}</span><i><b style="width:${Math.round(r.share * 100)}%"></b></i><span>${pct(r.share)}</span></div>`).join('');
      const verdict = m.favorite ? `The board favors ${m.favorite.hero ? 'your range' : m.favorite.pos + "'s range"} (${pct(m.favorite.share)} against a fair share of ${pct(1 / m.players.length)}).` : 'No single favorite: no range leads its fair share by enough to matter.';
      html += `<section><h4>Who the board favors</h4>${rows}<p class="an-big">${verdict}</p>
        <p class="small dim">Each player's range against the others, ties split. ${m.exactBoard ? 'The board is complete, so this is each range on exactly these five cards.' : 'Estimate: the cards still to come are dealt at random, so the numbers move a point or two between looks.'} It compares ranges, not your actual hand.</p></section>`;
    } else html += '<section><h4>Who the board favors</h4><p class="dim small">No range data for this pot.</p></section>';
  } else html += '<section><h4>Who the board favors</h4><p class="dim small">Shown for heads-up pots.</p></section>';
  return html;
}

async function tabOdds(x) {
  const g = x.game(), hero = g.players.find(p => p.isHero);
  if (!liveDecision(g) || !hero.cards.length) return '<p class="dim">Pot odds and equity show while you have a hand in progress.</p>';
  const pot = g.totalPot / g.bb;
  const L = x.heroTurn() ? g.legal() : null;
  let html = `<section><h4>Pot odds</h4><div class="f-line">Pot ${+pot.toFixed(1)} BB</div>`;
  if (L && L.toCall > 0) {
    const need = L.toCall / (g.totalPot + L.toCall);
    html += `<div class="f-line">To call ${+(L.toCall / g.bb).toFixed(1)} BB into ${+pot.toFixed(1)} BB</div><div class="f-line">You need ${pct(need)} equity to break even</div>`;
  } else if (L) html += '<div class="f-line">Nothing to call: checking is free</div>';
  else html += '<div class="f-line">Waiting for your turn</div>';
  html += '</section>';
  if (gated(x) && !state.reveal.odds) return html + `<section><h4>Your equity</h4>${showBtn('odds', 'Equity against their ranges')}</section>`;
  const heroI = g.players.indexOf(hero), n = g.players.filter(p => !p.out).length;
  const strat = await ensureStrat(x, n);
  const { ranges } = preflopRanges(g, strat);
  const dead = [...hero.cards, ...g.board];
  const vs = g.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== heroI && !p.folded && !p.out).map(({ i }) => narrow(g, i, toCombos(ranges.get(i), dead)));
  const eq = vs.length ? equityVsRanges(hero.cards, g.board, vs, 600) : null;
  html += `<section><h4>Your equity</h4>${eq != null ? `<div class="vs"><span>${pct(eq)}</span><i><b style="width:${Math.round(eq * 100)}%"></b></i><span>${vs.length} opponent${vs.length > 1 ? 's' : ''}</span></div><p class="small dim">Simulated against what the solver says they hold here.</p>` : '<p class="dim small">Not enough information for an equity number.</p>'}</section>`;
  return html;
}

function tabLeaks(x) {
  const leaks = x.H.topLeaks(12), a = x.H.assistedCount();
  return `${leaks.length ? `<div class="leaks">${leaks.map((l, k) => `<div class="leak"><b>${k + 1}</b><span>${l.label}</span><em>${l.ev ? `${l.ev.toFixed(1)} BB` : `${l.n}x`}</em></div>`).join('')}</div>` : '<p class="dim">No leaks yet. Decisions made with the solver pick on screen are not counted.</p>'}
    <p class="small dim">${a.own} of ${a.all} decisions count toward leaks; ${a.assisted} were assisted.</p>`;
}

function tabStats(x) {
  const s = x.session, a = x.H.assistedCount(), h = x.H.history;
  const net = s.net / x.bb;
  const rows = [
    ['Hands this table', s.hands], ['Net', `${net >= 0 ? '+' : ''}${net.toFixed(1)} BB`],
    ['Preflop accuracy (unassisted)', s.pfN ? `${Math.round(100 * s.pfGood / s.pfN)}% of ${s.pfN}` : 'no data'],
    ['Decisions counted', a.own], ['Assisted decisions (not counted)', a.assisted],
    ['Drills answered', h.drills.n], ['Calibration', h.calib.n ? `${h.calib.hits} of ${h.calib.n} caught` : 'no data'],
  ];
  return `<section>${rows.map(([k, v]) => `<div class="f-line an-stat"><span>${k}</span><b>${v}</b></div>`).join('')}</section>`;
}

function tabTools(x) {
  const btn = (id, t, sub) => `<button class="btn wide an-tool" data-tool="${id}"><span>${t}</span><small class="dim">${sub}</small></button>`;
  const coachOk = x.heroTurn() && x.cs();
  return `<div class="an-tools">
    ${btn('coach', 'Why? / Coach', coachOk ? 'Shows the solver pick; counts as assisted' : 'Available on your turn')}
    ${btn('hands', 'Hands by orbit', 'Orbit reviews')}${btn('leaks', 'Leaks', 'Ranked by BB lost')}
    ${btn('progress', 'Progress', 'Trends per session')}${btn('library', 'Library', 'Solved spots')}${btn('lab', 'Lab', 'Solve a spot yourself')}
    ${btn('review', 'Review', 'Your decisions vs the solver')}${btn('report', 'Report', 'BB lost by position')}${btn('export', 'Export', 'Take your data out')}</div>`;
}

const RENDER = { range: tabRange, history: tabHistory, opps: tabOpps, board: tabBoard, odds: tabOdds, leaks: tabLeaks, stats: tabStats, tools: tabTools };

export function openAnalysis(x) {
  const g = x.game();
  const key = `${g.handNo}:${g.street}:${x.heroTurn()}`;
  if (state.key !== key) state.reveal = {}; // a reveal covers one decision only: the next street or turn hides it again and counts again
  state.key = key;
  const shell = `<div class="an" data-feature-tab="analysis"><div class="an-tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div><div class="an-body"></div></div>`;
  x.openPanel('Analysis', shell);
  const root = x.panelView().querySelector('.an');
  const body = root.querySelector('.an-body');
  const draw = async () => {
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
    const tab = state.tab;
    const html = await RENDER[tab](x);
    if (state.tab !== tab) return;
    body.innerHTML = html;
  };
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.dataset.tab; return draw(); }
    const n = e.target.closest('[data-n]');
    if (n) { state.n = n.dataset.n === 'all' ? 'all' : +n.dataset.n; return draw(); }
    const rv = e.target.closest('[data-reveal]');
    if (rv) { state.reveal[rv.dataset.reveal] = true; x.markAssisted(); return draw(); }
    const tool = e.target.closest('[data-tool]');
    if (tool) x.tools[tool.dataset.tool]?.();
  });
  root.addEventListener('change', (e) => {
    if (e.target.id !== 'anSolver') return;
    state.reveal.range = e.target.checked;
    if (e.target.checked) x.markAssisted();
    draw();
  });
  draw();
}
export const analysisState = state;
