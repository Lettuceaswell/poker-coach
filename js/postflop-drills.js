// Postflop drills from pre-solved heads-up spots (data/postflop-drills.json, built offline by
// tools/build-postflop-drills.js). Mixed into the preflop drill stream: after any "Next drill" tap
// there is a chance the next item is a postflop spot (interleaving, Rohrer & Taylor 2007).
// Ask first, reveal on tap (retrieval practice, Roediger & Karpicke 2006); the reveal prices every
// option in BB against the best one (specific feedback, Hattie & Timperley 2007). A missed spot
// returns in 2-3 items, then ~10, then ~22 (expanding gaps, Cepeda et al. 2006).
// Only the solver's best option is ever green.
const R = '23456789TJQKA', SG = { s: '♠', h: '♥', d: '♦', c: '♣' }, SI = { s: 0, h: 1, d: 2, c: 3 };
const LINE_NAMES = { 'BTN-BB-SRP': 'BTN opens, BB calls', 'CO-BB-SRP': 'CO opens, BB calls', 'SB-BB-SRP': 'SB opens, BB calls', 'BTN-BB-3BP': 'BTN opens, BB 3-bets, BTN calls' };
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GAPS = [[2, 3], [9, 11], [20, 24]];
import { fadeLevel, scaffoldHTML, wireHint, postflopParts, postflopExplain, optName } from './drill-coach.js';
import { rewardFor, rewardHTML } from './reward.js';
import { leakPlan, leakLabel, leakForPost, postflopProb, skillEstimate, targetDifficulty, diffWeight, pickWeighted, difficultyLine, progressLine, levelBefore } from './skill.js';
const QK = 'pf-drill-q', MAX_GAP = 4; // at least one postflop item in every 5 so retrieval of postflop stays practiced
let sinceLast = 0, SPOTS = null, installed = false, ctxRef = null, openPre = null, lastStreet = '';

const loadQ = () => { try { return JSON.parse(localStorage.getItem(QK)) || { n: 0, q: [] }; } catch { return { n: 0, q: [] }; } };
const saveQ = (s) => { try { localStorage.setItem(QK, JSON.stringify(s)); } catch {} };
async function spots() {
  if (SPOTS) return SPOTS;
  try { SPOTS = (await (await fetch(new URL('../data/postflop-drills.json', import.meta.url))).json()).spots; } catch { SPOTS = []; }
  return SPOTS;
}
const card = (c) => `<div class="card s-${SI[c[1]]}"><span class="rk">${c[0] === 'T' ? '10' : c[0]}</span><span class="st">${SG[c[1]]}</span></div>`;
const bb = (x) => `${x >= 0 ? '' : '-'}${Math.abs(x).toFixed(1)} BB`;

// reviews run on the GLOBAL drill counter (history.drills.n), so a miss returns 2-3 items later in the
// whole stream and a long preflop run cannot pile up a postflop backlog
const G = () => ctxRef.H.history.drills.n;
const isDue = (st) => st.q.some(x => x.due <= G());
function pick(all, st) {
  const H = ctxRef.H;
  const i = st.q.findIndex(x => x.due <= G());
  if (i >= 0) { const it = st.q.splice(i, 1)[0]; const s = all.find(x => x.id === it.id); if (s) return { s, box: it.box, review: true, leak: leakForPost(leakPlan(H), s) }; }
  // interleave: prefer a street different from the previous item; aim at the leak's street and difficulty
  let pool = all.filter(x => x.street !== lastStreet);
  if (!pool.length) pool = all;
  const plan = leakPlan(H);
  const target = targetDifficulty(skillEstimate(H, null).skill);
  const s = pickWeighted(pool, (x) => diffWeight(1 - Math.max(...x.mix), target) * (leakForPost(plan, x) ? 3 : 1));
  return { s, box: 0, review: false, leak: leakForPost(plan, s) };
}

async function show() {
  const all = await spots();
  if (!all.length) return openPre(ctxRef);
  const { openPanel, panelView, H } = ctxRef;
  const st = loadQ();
  const { s, box, review, leak } = pick(all, st); saveQ(st); sinceLast = 0;
  lastStreet = s.street;
  const best = s.mix.indexOf(Math.max(...s.mix)), evBest = Math.max(...s.ev);
  const where = s.hero === 'OOP' ? 'You act first' : s.facing ? `IP, facing a ${s.facing} BB bet` : 'IP, checked to you';
  const nm = { flop: 'Flop', turn: 'Turn', river: 'River' }[s.street];
  const lvl = fadeLevel(H);
  openPanel('Drills', `<div class="drill" data-judgment="drill-postflop">
    <p class="drill-spot">${nm} · ${where} · pot ${s.pot} BB · stack ${s.stack} BB</p>
    ${leak ? `<p class="drill-leak small">${leakLabel(leak)}</p>` : ''}
    <p class="drill-why small dim">${difficultyLine(H, 'postflop ' + s.street)}</p>
    ${scaffoldHTML(postflopParts(s), lvl)}
    <div class="drill-board">${s.board.map(card).join('')}</div>
    <div class="drill-cards">${s.hand.map(card).join('')}</div>
    <div class="drill-acts">${s.opts.map((o, i) => `<button class="btn" data-i="${i}">${o}</button>`).join('')}</div>
    <div class="drill-out"></div>
    <p class="small dim drill-stats">${s.line ? `${LINE_NAMES[s.line] || s.line}, ${s.street} spot. ` : ''}Pick your play; the solver grades it in BB.</p></div>`);
  const body = panelView(), acts = body.querySelector('.drill-acts');
  wireHint(body);
  acts.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b || acts.dataset.done) return;
    acts.dataset.done = '1';
    const i = +b.dataset.i, f = s.mix[i], cost = evBest - s.ev[i];
    const [word, gc] = i === best || f >= 0.5 ? ['Best', 'g'] : f >= 0.15 ? ['Good', 'y'] : ['Mistake', 'r'];
    const ok = gc !== 'r';
    if (!ok) st.q.push({ id: s.id, box: 0, due: G() + 3 + Math.floor(Math.random() * 2) });
    else if (review && box + 1 < GAPS.length) { const g = GAPS[box + 1]; st.q.push({ id: s.id, box: box + 1, due: G() + 1 + g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1)) }); }
    const cur = loadQ(); cur.q = st.q; saveQ(cur);
    const typeKey = 'postflop ' + s.street, prior = H.typeAccuracy(typeKey), lvl0 = levelBefore(H, typeKey);
    H.recordDrill(ok, { n: 0, label: 'postflop', type: typeKey });
    H.history.drills.queue = (H.history.drills.queue || []).filter(x => x.label !== 'postflop'); H.save(); // postflop reviews live in the postflop queue
    const rwd = rewardFor({ correct: i === best, topFreq: s.mix[best], prior, now: H.typeAccuracy(typeKey), review, label: typeKey }); // counts in drill stats; the dummy preflop-queue entry is ignored there
    acts.querySelectorAll('button').forEach((x, k) => { x.disabled = true; if (k === i) x.classList.add('chosen'); if (k === best) x.classList.add('coach-pick'); });
    const sizes = s.opts.map((o, k) => (/[\d.]/.test(o) && !/all-in/i.test(o) && s.mix[k] >= 0.01) ? `${optName(o).toLowerCase()} ${o.match(/[\d.]+/)[0]} BB` : null).filter(Boolean);
    const mixLine = s.opts.map((o, k) => `${optName(o)} ${Math.round(s.mix[k] * 100)}%`).filter((_, k) => s.mix[k] >= 0.01).join('  ') + (sizes.length ? ` (${sizes.join(', ')})` : '');
    body.querySelector('.drill-out').innerHTML = `<p><span class="grade ${gc}">${word}</span> ${nm} mix: ${mixLine}</p>
      <p>${cost < 0.05 ? 'Matches the best play.' : `Costs ${bb(cost)} against the best play.`}</p>
      <p class="cb-explain" data-coach="explain">${postflopExplain({ s, best, k: i, cost, bb })}</p>
      ${rwd ? rewardHTML(rwd) : ''}
      ${ok ? progressLine(H, typeKey, 'Postflop ' + s.street, lvl0) : ''}
      <table class="pf-ev">${s.opts.map((o, k) => `<tr class="${k === best ? 'g' : ''}"><td>${o}</td><td>${Math.round(s.mix[k] * 100)}%</td><td>${bb(s.ev[k])}</td><td>${k === best ? 'best' : bb(s.ev[k] - evBest)}</td></tr>`).join('')}</table>
      <p class="small dim">Solver mix and expected value in BB, measured from folding now. ${esc(s.prov || 'Ranges are approximate single raised pot ranges (Chen-score cutoffs).')}</p>`;
    const nb = document.createElement('div'); nb.className = 'drill-next-bar';
    nb.innerHTML = '<button class="btn primary wide drill-next" data-pf="1">Next drill</button>';
    body.appendChild(nb);
    nb.querySelector('.drill-next').addEventListener('click', (ev) => { ev.stopPropagation(); advance(); });
  });
}

// postflop chance follows the postflop share of leak cost (0.45 with no leaks yet), with a floor of one in 5
function wantPost() {
  if (isDue(loadQ())) return true;
  if (sinceLast >= MAX_GAP || Math.random() < postflopProb(leakPlan(ctxRef.H))) return true;
  sinceLast++; return false;
}
function advance() {
  if (wantPost()) show(); else openPre(ctxRef);
}

// Called from the drill menu entry each time drills open; the click hook is installed once.
export function installPostflopDrills(ctx, openDrills) {
  ctxRef = ctx; openPre = openDrills;
  if (installed) return; installed = true;
  spots(); // warm the cache
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.drill-next');
    if (!b || b.dataset.pf) return;
    if (!SPOTS || !SPOTS.length) return;
    if (wantPost()) { e.stopImmediatePropagation(); e.preventDefault(); show(); }
  }, true);
}
