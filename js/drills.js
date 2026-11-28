// Drills: preflop spots drawn from your leaks, answered with a tap, graded against the
// solver with the range grid. Spots you miss come back a few drills later.
import { treeFor, strategyAt, className, reachAt } from './coach.js';
import { POSITIONS, STACK } from './preflop-tree.js';
import { EQ_VS_RANDOM } from './strength.js';
import { fadeLevel, scaffoldHTML, wireHint, preflopParts, preflopExplain } from './drill-coach.js';
import { rewardFor, rewardHTML } from './reward.js';
import { leakPlan, leakLabel, leakForPre, skillEstimate, targetDifficulty, diffWeight, pickWeighted, difficultyLine, progressLine, levelBefore } from './skill.js';

// money state at the hero's decision, replayed from the walked path
function priceAt(n, node, hero) {
  const tree = treeFor(n), names = POSITIONS[n];
  const bets = names.map(x => x === 'SB' ? 0.5 : x === 'BB' ? 1 : 0);
  for (const st of node.path) {
    const a = tree.nodes[st.id].acts[st.ai];
    if (a.t === 'r') bets[st.p] = a.to; else if (a.t === 'c') bets[st.p] = Math.max(...bets);
  }
  const cur = Math.max(...bets);
  return { pot: bets.reduce((x, y) => x + y, 0), toCall: cur - bets[hero], cur };
}

const R = '23456789TJQKA';
const SG = ['♠', '♥', '♦', '♣'];

export function walk(n, sc) {
  const tree = treeFor(n);
  let node = tree.nodes[0], raises = 0;
  const path = [];
  for (let guard = 0; guard < 30 && !node.term; guard++) {
    const p = node.p;
    let want = 'f';
    if (sc.type === 'first' && p === sc.hero) return Object.assign(Object.create(node), { path });
    if (sc.type === 'open') {
      if (p === sc.opener && raises === 0) want = 'r';
      else if (p === sc.hero && raises === 1) return Object.assign(Object.create(node), { path });
    }
    if (sc.type === '3bet') {
      if (p === sc.hero && raises === 0) want = 'r';
      else if (p === sc.three && raises === 1) want = 'r';
      else if (p === sc.hero && raises === 2) return Object.assign(Object.create(node), { path });
    }
    const a = node.acts.find(x => x.t === want) || node.acts.find(x => x.t === 'c');
    if (!a) return null;
    if (a.t === 'r') raises++;
    path.push({ id: node.id, ai: node.acts.indexOf(a), p });
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

// interleaving (Rohrer & Taylor 2007): never two of the same spot type or position in a row;
// (falls back to any spot when the leak pool has no fresh one)
const lastSc = [];
const sameKind = (a, b) => a.type === b.type || a.hero === b.hero;

function pickScenario(n, H) {
  const all = scenarios(n);
  const due = H.dueDrill();
  if (due && due.n === n) { const s = all.find(x => x.label === due.label); if (s) return { sc: s, cls: due.cls, item: due }; }
  // deliberate practice: ~90% of fresh items come from the top priced leaks, weighted by BB cost
  const plan = leakPlan(H);
  const cost = (s) => { const l = leakForPre(plan, s.key); return l ? (l.bb || l.cost || 1) : 0; };
  const fromLeaks = all.filter(s => cost(s) > 0);
  let pool = fromLeaks.length && Math.random() < 0.9 ? fromLeaks : all;
  const prev = lastSc[lastSc.length - 1];
  if (prev) {
    const fresh = pool.filter(s => !sameKind(s, prev));
    if (fresh.length) pool = fresh;
    else { const alt = all.filter(s => !sameKind(s, prev)); if (alt.length) pool = alt; }
  }
  const sc = pool === fromLeaks || pool.every(s => cost(s) > 0) ? pickWeighted(pool, cost) : pool[Math.floor(Math.random() * pool.length)];
  return { sc, cls: null, leak: leakForPre(plan, sc.key) };
}

// desirable difficulty (Bjork 1994; Wilson et al. 2019): hands are weighted toward a target difficulty
// (1 - top solver frequency) set by the skill estimate: strong -> hands where the solver mixes, weak -> clear hands
function pickClass(strat, node, reach, target) {
  const w = [];
  for (let c = 0; c < 169; c++) {
    const p = strategyAt(strat, node, c);
    // only hands you'd actually hold here (your earlier actions in the hand)
    if (!p || reach[c] < 0.15) { w.push(0); continue; }
    const dif = 1 - Math.max(...p);
    const combos = c % 14 === 0 ? 6 : Math.floor(c / 13) > c % 13 ? 4 : 12;
    w.push(combos * diffWeight(dif, target));
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
    let sc, cls, node, reach, item = null, leak = null;
    for (let tries = 0; tries < 20; tries++) {
      const pick = pickScenario(n, H);
      node = walk(n, pick.sc);
      if (!node) continue;
      sc = pick.sc; item = pick.item || null; leak = leakForPre(leakPlan(H), pick.sc.key);
      reach = reachAt(S.strat, n, node.path, sc.hero);
      cls = pick.cls != null && reach[pick.cls] >= 0.15 ? pick.cls : pickClass(S.strat, node, reach, targetDifficulty(skillEstimate(H, 'preflop ' + sc.key).skill));
      break;
    }
    if (!node) return;
    lastSc.push(sc); if (lastSc.length > 3) lastSc.shift();
    const cards = cardsFor(cls);
    const rw = sc.type === 'first' ? 'Raise' : sc.type === 'open' ? '3-bet' : '4-bet';
    const labels = node.acts.map(a => a.t === 'f' ? 'Fold' : a.t === 'c' ? 'Call' : a.to >= STACK ? 'All-in' : `${rw} ${a.to}`);
    const d = H.history.drills;
    const stats = d.n ? `${d.n} drills · ${Math.round(100 * d.good / d.n)}% good` : 'Tap your play. Hands near the edge of the range come up most.';
    const px = priceAt(n, node, sc.hero);
    const raiseA = node.acts.find(a => a.t === 'r');
    const P = POSITIONS[n];
    const pr = { pot: px.pot, toCall: px.toCall, raiseTo: raiseA ? raiseA.to : 0, pos: P[sc.hero], type: sc.type, openerName: P[sc.opener], threeName: P[sc.three] };
    const lvl = fadeLevel(H);
    const html = `<div class="drill" data-feature="trainer" data-judgment="drill-preflop">
      <p class="drill-spot">${sc.label} · pot ${Math.round(px.pot * 10) / 10} BB · ${Math.round(px.toCall * 10) / 10} to call</p>
      ${leak ? `<p class="drill-leak small">${leakLabel(leak)}</p>` : ''}
      <p class="drill-why small dim">${difficultyLine(H, 'preflop ' + sc.key)}</p>
      ${scaffoldHTML(preflopParts(pr), lvl)}
      <div class="drill-cards">${cards.map(([r, s]) => `<div class="card s-${s}"><span class="rk">${r === 8 ? '10' : R[r]}</span><span class="st">${SG[s]}</span></div>`).join('')}</div>
      <div class="drill-acts">${node.acts.map((a, i) => `<button class="btn" data-i="${i}">${labels[i]}</button>`).join('')}</div>
      <div class="drill-out"></div>
      <p class="small dim drill-stats">${stats}</p></div>`;
    openPanel('Drills', html);
    const body = ctx.panelView();
    wireHint(body);
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
      const typeKey = 'preflop ' + sc.key;
      const prior = H.typeAccuracy(typeKey), lvl0 = levelBefore(H, typeKey);
      H.recordDrill(gc === 'g', { n, label: sc.label, cls, box: item ? item.box : 0, review: !!item, type: typeKey });
      const topK = p.indexOf(Math.max(...p));
      body.querySelectorAll('.drill-acts button').forEach((x, k) => { x.disabled = true; if (k === i) x.classList.add('chosen'); });
      // BB price: indifferent (mixed) actions cost ~0; an action the solver avoids costs about its
      // avoidance share of the pot at stake. Estimated from the solver frequencies, not a separate solve.
      const best = Math.max(...Object.values(byT));
      const pot = sc.type === 'first' ? 1.5 : sc.type === 'open' ? 4 : 9;
      const cost = f >= 0.15 ? 0 : (1 - f) * pot * 0.25 * (1 - Math.min(1, f / 0.15));
      const bbLine = f >= 0.15 ? `<p class="dim small">Cost vs the coach's pick: about 0.0 BB (the solver mixes this play).</p>`
        : `<p class="dim small">Cost vs the coach's pick: about ${cost.toFixed(2)} BB per time (estimate from solver frequencies; it plays ${labels[node.acts.findIndex(a => a.t === topT)]} ${Math.round(100 * best)}%).</p>`;
      const names = labels.map(l => l.replace(/\s+[\d.]+$/, ''));
      const sizes = node.acts.map((a, k) => (a.t === 'r' && a.to < STACK && p[k] >= 0.01) ? `${names[k].toLowerCase()} to ${a.to}` : null).filter(Boolean);
      const mix = names.map((nm, k) => `${nm} ${Math.round(p[k] * 100)}%`).filter((_, k) => p[k] >= 0.01).join(' · ') + (sizes.length ? ` (${sizes.join(', ')})` : '');
      const costTxt = f >= 0.15 ? 'Cost of your play versus the solver pick: 0 BB.' : `Cost of your play versus the solver pick: about ${cost.toFixed(2)} BB per time.`;
      const expl = preflopExplain({ names, p, top: topK, k: i, cls: className(cls), pr, cost: costTxt, pos: pr.pos });
      const rwd = rewardFor({ correct: i === topK, topFreq: p[topK], prior, now: H.typeAccuracy(typeKey), review: !!item, label: sc.key });
      body.querySelector('.drill-out').innerHTML = `<p><span class="grade ${gc}">${word}</span> ${className(cls)}: ${mix}</p>
        <p class="cb-explain" data-coach="explain">${expl}</p>
        ${rewardHTML(rwd)}
        ${gc === 'g' ? progressLine(H, typeKey, sc.key, lvl0) : ''}
        ${bbLine}
        ${gridHTML({ mixes: nodeMixes(S.strat, node), mark: cls, reach })}`;
      const nb = document.createElement('div'); nb.className = 'drill-next-bar';
      nb.innerHTML = '<button class="btn primary wide drill-next">Next drill</button>';
      body.appendChild(nb);
      nb.querySelector('.drill-next').addEventListener('click', next);
    });
  };
  next();
}
