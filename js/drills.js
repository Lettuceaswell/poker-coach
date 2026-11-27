// Drills: preflop spots drawn from your leaks, answered with a tap, graded against the
// solver with the range grid. Spots you miss come back a few drills later.
import { treeFor, strategyAt, className } from './coach.js';
import { POSITIONS, STACK } from './preflop-tree.js';
import { EQ_VS_RANDOM } from './strength.js';

const R = '23456789TJQKA';
const SG = ['♠', '♥', '♦', '♣'];

export function walk(n, sc) {
  const tree = treeFor(n);
  let node = tree.nodes[0], raises = 0;
  for (let guard = 0; guard < 30 && !node.term; guard++) {
    const p = node.p;
    let want = 'f';
    if (sc.type === 'first' && p === sc.hero) return node;
    if (sc.type === 'open') {
      if (p === sc.opener && raises === 0) want = 'r';
      else if (p === sc.hero && raises === 1) return node;
    }
    if (sc.type === '3bet') {
      if (p === sc.hero && raises === 0) want = 'r';
      else if (p === sc.three && raises === 1) want = 'r';
      else if (p === sc.hero && raises === 2) return node;
    }
    const a = node.acts.find(x => x.t === want) || node.acts.find(x => x.t === 'c');
    if (!a) return null;
    if (a.t === 'r') raises++;
    node = tree.nodes[a.next];
  }
  return null;
}

export function scenarios(n) {
  const P = POSITIONS[n];
  const out = [];
  P.forEach((name, i) => {
    if (name !== 'BB') out.push({ type: 'first', hero: i, label: `${name} · folded to you`, key: `${name} first in` });
    for (let o = 0; o < i; o++) if (P[o] !== 'SB' || name === 'BB') out.push({ type: 'open', hero: i, opener: o, label: `${name} · ${P[o]} opens`, key: `${name} vs open` });
    if (name !== 'BB') for (let t = i + 1; t < P.length; t++) out.push({ type: '3bet', hero: i, three: t, label: `${name} · you opened, ${P[t]} 3-bets`, key: `${name} vs 3-bet` });
  });
  return out;
}

function pickScenario(n, H) {
  const all = scenarios(n);
  const due = H.dueDrill();
  if (due && due.n === n) { const s = all.find(x => x.label === due.label); if (s) return { sc: s, cls: due.cls }; }
  const leaks = H.topLeaks(6).map(l => l.key.split('|')[0]);
  const fromLeaks = all.filter(s => leaks.includes(s.key));
  const pool = fromLeaks.length && Math.random() < 0.65 ? fromLeaks : all;
  return { sc: pool[Math.floor(Math.random() * pool.length)], cls: null };
}

// favor hands near the edge of the range: those teach the most
function pickClass(strat, node) {
  const w = [];
  for (let c = 0; c < 169; c++) {
    const p = strategyAt(strat, node, c);
    if (!p) { w.push(0); continue; }
    const play = node.acts.reduce((s, a, i) => s + (a.t !== 'f' ? p[i] : 0), 0);
    const edge = 1 - Math.abs(2 * play - 1);
    const combos = c % 14 === 0 ? 6 : Math.floor(c / 13) > c % 13 ? 4 : 12;
    w.push(combos * (0.15 + edge + (play > 0.05 && play < 0.95 ? 0.5 : 0)));
  }
  let r = Math.random() * w.reduce((s, x) => s + x, 0);
  for (let c = 0; c < 169; c++) { r -= w[c]; if (r <= 0) return c; }
  return 168;
}

function cardsFor(cls) {
  const x = Math.floor(cls / 13), y = cls % 13;
  const s1 = Math.floor(Math.random() * 4);
  if (x === y) { let s2 = (s1 + 1 + Math.floor(Math.random() * 3)) % 4; return [[x, s1], [x, s2]]; }
  if (x > y) return [[x, s1], [y, s1]];
  let s2 = (s1 + 1 + Math.floor(Math.random() * 3)) % 4;
  return [[y, s1], [x, s2]];
}

export async function openDrills(ctx) {
  const { strategies, loadStrategy, openPanel, closePanel, H, gridHTML, nodeMixes } = ctx;
  const n = ctx.seats;
  if (!strategies[n] || strategies[n] === 'loading') {
    openPanel('Drills', '<p class="dim">Loading the solution…</p>');
    await loadStrategy(n);
    for (let i = 0; i < 50 && strategies[n] === 'loading'; i++) await new Promise(r => setTimeout(r, 100));
  }
  const S = strategies[n];
  if (!S || !S.strat) { openPanel('Drills', '<p class="dim">No solution available offline yet; open a table once with signal.</p>'); return; }

  const next = () => {
    let sc, cls, node;
    for (let tries = 0; tries < 20; tries++) {
      const pick = pickScenario(n, H);
      node = walk(n, pick.sc);
      if (!node) continue;
      sc = pick.sc; cls = pick.cls ?? pickClass(S.strat, node);
      break;
    }
    if (!node) return;
    const cards = cardsFor(cls);
    const rw = sc.type === 'first' ? 'Raise' : sc.type === 'open' ? '3-bet' : '4-bet';
    const labels = node.acts.map(a => a.t === 'f' ? 'Fold' : a.t === 'c' ? 'Call' : a.to >= STACK ? 'All-in' : `${rw} ${a.to}`);
    const d = H.history.drills;
    const stats = d.n ? `${d.n} drills · ${Math.round(100 * d.good / d.n)}% good` : 'Tap your play. Hands near the edge of the range come up most.';
    const html = `<div class="drill">
      <p class="drill-spot">${sc.label}</p>
      <div class="drill-cards">${cards.map(([r, s]) => `<div class="card s-${s}"><span class="rk">${r === 8 ? '10' : R[r]}</span><span class="st">${SG[s]}</span></div>`).join('')}</div>
      <div class="drill-acts">${node.acts.map((a, i) => `<button class="btn" data-i="${i}">${labels[i]}</button>`).join('')}</div>
      <div class="drill-out"></div>
      <p class="small dim drill-stats">${stats}</p></div>`;
    openPanel('Drills', html);
    const body = document.getElementById('panelBody');
    body.querySelector('.drill-acts').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]'); if (!b || body.querySelector('.drill-acts').dataset.done) return;
      body.querySelector('.drill-acts').dataset.done = '1';
      const p = strategyAt(S.strat, node, cls);
      const i = +b.dataset.i;
      const t = node.acts[i].t;
      const byT = {}; node.acts.forEach((a, k) => { byT[a.t] = (byT[a.t] || 0) + p[k]; });
      const f = byT[t];
      const topT = Object.keys(byT).reduce((x, y) => (byT[y] > byT[x] ? y : x));
      const [word, gc] = f >= 0.5 || t === topT ? ['Best', 'g'] : f >= 0.15 ? ['Good', 'g'] : f >= 0.03 ? ['Rare', 'y'] : ['Mistake', 'r'];
      H.recordDrill(gc === 'g', { n, label: sc.label, cls });
      body.querySelectorAll('.drill-acts button').forEach((x, k) => { x.disabled = true; if (k === i) x.classList.add('chosen'); });
      const mix = node.acts.map((a, k) => `${labels[k]} ${Math.round(p[k] * 100)}%`).filter((_, k) => p[k] >= 0.01).join(' · ');
      body.querySelector('.drill-out').innerHTML = `<p><span class="grade ${gc}">${word}</span> ${className(cls)}: ${mix}</p>
        ${gridHTML({ mixes: nodeMixes(S.strat, node), mark: cls })}
        <button class="btn primary wide drill-next">Next drill</button>`;
      body.querySelector('.drill-next').addEventListener('click', next);
    });
  };
  next();
}
