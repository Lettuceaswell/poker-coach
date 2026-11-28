// Lab: the solver's features on the phone, all computed live by the existing postflop solver / equity estimator.
// custom solve, node-lock, multiway estimate, stack depths. One menu entry; four feature roots inside #panel.
import { parseRange, cardsOf, mixLine } from './lab-core.js';
import { equityVsRanges } from './ranges.js';
import { COMBOS } from './ranges.js';
import { comboIndex } from './postflop/solver.js';

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DEF = { board: 'Kd7c2h9s4d', oop: 'AA-77,AKs-ATs,KQs,98s,JTs,A5s-A2s', ip: 'KK-99,AQs+,AJo+,QJs,T9s,76s', pot: 20, stack: 60, size: 66 };
let jobId = 0;

// one fresh module worker per solve: parallel-safe, no shared state
function solveJob(input) {
  return new Promise((resolve) => {
    const id = ++jobId;
    let w;
    try { w = new Worker(new URL('./lab-worker.js', import.meta.url), { type: 'module' }); } catch (e) { resolve({ error: 'worker unavailable' }); return; }
    const kill = setTimeout(() => { w.terminate(); resolve({ error: 'solve timed out' }); }, 20000);
    w.onmessage = (e) => { if (e.data.id !== id) return; clearTimeout(kill); w.terminate(); resolve(e.data); };
    w.onerror = () => { clearTimeout(kill); w.terminate(); resolve({ error: 'solver error' }); };
    w.postMessage({ id, input, iters: 600 });
  });
}
function spot({ board, oop, ip, pot, stack, size, start }) {
  const b = cardsOf(board);
  if (b.length < 3 || b.length > 5 || new Set(b).size !== b.length) throw new Error('Board needs 3-5 distinct cards like Kd7c2h9s4d');
  const r = [parseRange(oop, b), parseRange(ip, b)];
  if (!r[0].some(x => x > 0) || !r[1].some(x => x > 0)) throw new Error('Both ranges need at least one combo, like AA-TT,AKs');
  const sizes = { bet: [Math.max(0.05, size / 100)], raise: [3], allin: true, maxBets: 2, allinThreshold: 0.67 };
  return { board: b, pot: +pot, stack: +stack, ranges: r, sizes, ...(start ? { start } : {}) };
}
const outLine = (label, r) => r.error ? `${label}: ${r.error}` : mixLine(label, r.mix);
const lines = (arr) => arr.map(l => `<div class="f-line">${esc(l)}</div>`).join('');

// multiway: hero vs 2 ranges, Monte Carlo equity (existing estimate mode) -> bet/check heuristic
const MW = [
  { name: 'Spot A: K-high dry, hero AhKd', board: 'Ks7d2c', hero: 'AhKd', v1: 'JJ-77,AQs+,KQs,A5s-A2s', v2: 'TT-22,KJs+,QJs,JTs,98s' },
  { name: 'Spot B: wet board, hero 9h8h', board: 'Th7h2s', hero: '9h8h', v1: 'AA-TT,AKs,AQs,AJs,KQs', v2: 'TT-22,ATs-A8s,KQs,JTs,76s' },
  { name: 'Spot C: paired board, hero QcQd', board: 'Ad Ac 5s', hero: 'QcQd', v1: 'AKs,AQs,AJs,A5s-A2s,KK-JJ', v2: 'AKo,AQo,99-66,KQs' },
];
function rng32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function toClassOrder(w) { const o = new Float32Array(COMBOS.length); COMBOS.forEach(([a, b], j) => { o[j] = w[comboIndex(a, b)]; }); return o; }
function multiway(i) {
  const s = MW[i], board = cardsOf(s.board), hero = cardsOf(s.hero), dead = [...board, ...hero];
  const vs = [s.v1, s.v2].map(t => toClassOrder(parseRange(t, dead)));
  const eq = equityVsRanges(hero, board, vs, 800, rng32(1234 + i));
  if (eq === null) return [`${s.name}`, 'multiway estimate unavailable'];
  const base = 1 / 3, bet = Math.max(0, Math.min(100, Math.round(100 * 1.5 * (eq - base) / (1 - base))));
  return [s.name, `3-way estimate (Monte Carlo equity vs 2 ranges, not a solve): hero equity ${Math.round(eq * 100)}% of the pot, fair share 33%`,
    mixLine('Hero first to act, estimate', [['Bet', bet], ['Check', 100 - bet]])];
}

export function openLab(ctx) {
  const mwOpts = MW.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join('');
  const html = `<div class="feat lab">
  <p class="f-lead">Lab: the same solver as live coaching, on spots you choose. River spots solve in about a second.</p>
  <section data-feature="custom-solve" class="lab-sec"><h4>Custom solve</h4>
    <label class="f-row"><span>Bet size, percent of pot</span><input class="f-in" id="labSize" type="number" inputmode="numeric" value="${DEF.size}"></label>
    <label class="f-row"><span>Board</span><input class="f-in" id="labBoard" type="text" value="${DEF.board}"></label>
    <label class="f-row"><span>OOP range</span><input class="f-in" id="labOop" type="text" value="${DEF.oop}"></label>
    <label class="f-row"><span>IP range</span><input class="f-in" id="labIp" type="text" value="${DEF.ip}"></label>
    <label class="f-row"><span>Pot (BB)</span><input class="f-in" id="labPot" type="number" inputmode="numeric" value="${DEF.pot}"></label>
    <label class="f-row"><span>Stack (BB)</span><input class="f-in" id="labStack" type="number" inputmode="numeric" value="${DEF.stack}"></label>
    <button class="btn f-btn" id="labSolve">Solve</button><div class="f-rows" id="labOut"></div></section>
  <section data-feature="nodelock" class="lab-sec"><h4>Node lock</h4>
    <p class="f-note">Fix what OOP does at the root, re-solve, and see how IP must respond. Uses the board, ranges, pot and stack above.</p>
    <div class="f-row lab-btns"><button class="btn f-btn" id="labLockBet">Lock OOP: always bets</button><button class="btn f-btn" id="labLockChk">Lock OOP: always checks</button><button class="btn f-btn" id="labUnlock">Clear lock</button></div>
    <div class="f-rows" id="labLockOut"></div></section>
  <section data-feature="multiway" class="lab-sec"><h4>Multiway (3-way)</h4>
    <label class="f-row"><span>Spot</span><select class="f-sel" id="labMw">${mwOpts}</select></label><div class="f-rows" id="labMwOut"></div></section>
  <section data-feature="stacks" class="lab-sec"><h4>Stack depth</h4>
    <p class="f-note">Postflop stacks: effective stack at the river start, same board, ranges and pot.</p>
    <div class="f-row lab-btns"><button class="btn f-btn labStk" data-bb="100">100 BB</button><button class="btn f-btn labStk" data-bb="40">40 BB</button><button class="btn f-btn labStk" data-bb="25">25 BB</button></div><div class="f-rows" id="labStkOut"></div></section>
  </div>`;
  ctx.openPanel('Lab', html);
  const $ = (id) => document.getElementById(id);
  const cur = () => ({ board: $('labBoard').value, oop: $('labOop').value, ip: $('labIp').value, pot: $('labPot').value, stack: $('labStack').value, size: +$('labSize').value || DEF.size });
  const tok = { c: 0, l: 0, s: 0 };
  const guard = async (out, pending, key, fn) => { const my = ++tok[key]; out.innerHTML = lines([pending]); try { const r = await fn(); if (my === tok[key]) out.innerHTML = lines(r); } catch (e) { if (my === tok[key]) out.innerHTML = lines([String(e.message || e)]); } };

  const runCustom = () => guard($('labOut'), `Solving size ${$('labSize').value} percent of pot...`, 'c', async () => {
    const p = cur(); const r = await solveJob(spot(p));
    return [`Board ${p.board}, bet ${p.size} percent of pot, pot ${p.pot} BB, stack ${p.stack} BB`, outLine(r.player === 1 ? 'IP' : 'OOP', r), `${r.combos || 0} combos in the acting range, 600 solver iterations`];
  });
  let lock = null;
  const runLock = () => guard($('labLockOut'), `${lock === 'bet' ? 'OOP fixed to always bet' : lock === 'check' ? 'OOP fixed to always check' : 'No lock'}: solving...`, 'l', async () => {
    const p = cur(); const pot = +p.pot, sz = (p.size / 100) * pot;
    const eqP = solveJob(spot(p));
    const startFor = (k) => ({ bets: [k === 'bet' ? sz : 0, 0], toAct: 1 });
    const need = lock ? [lock] : ['bet', 'check'];
    const [eq, ...rs] = await Promise.all([eqP, ...need.map(k => solveJob(spot({ ...p, start: startFor(k) })))]);
    const out = [`Board ${p.board}`, outLine('OOP equilibrium (free choice)', eq)];
    if (lock) out.push(`OOP fixed: ${lock === 'bet' ? 'Bet' : 'Check'} 100%`, outLine(`IP response to the fixed ${lock}`, rs[0]));
    else out.push('No lock set', outLine('IP response to a bet', rs[0]), outLine('IP response to a check', rs[1]));
    return out;
  });
  const runMw = () => guard($('labMwOut'), 'Estimating...', 's', async () => multiway(+$('labMw').value));
  let stk = 100;
  const runStk = () => guard($('labStkOut'), `Effective stack ${stk} BB: solving...`, 's2', async () => {
    const p = { ...cur(), stack: stk, pot: DEF.pot, size: DEF.size, board: DEF.board, oop: DEF.oop, ip: DEF.ip };
    const r = await solveJob(spot(p));
    return [`Effective stack ${p.stack} BB, pot ${p.pot} BB (postflop stacks, river)`, outLine(r.player === 1 ? 'IP' : 'OOP', r)];
  });
  tok.s2 = 0;
  $('labSolve').addEventListener('click', runCustom);
  $('labLockBet').addEventListener('click', () => { lock = 'bet'; runLock(); });
  $('labLockChk').addEventListener('click', () => { lock = 'check'; runLock(); });
  $('labUnlock').addEventListener('click', () => { lock = null; runLock(); });
  $('labMw').addEventListener('change', runMw);
  document.querySelectorAll('.labStk').forEach(b => b.addEventListener('click', () => { stk = +b.dataset.bb; runStk(); }));
  $('labLockOut').innerHTML = lines(['Tap a lock button to fix what OOP does at the root and re-solve.']);
  runCustom(); runMw(); runStk();
}
