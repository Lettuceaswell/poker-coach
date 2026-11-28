// Lab: the solver's features on the phone, all computed live by the existing postflop solver / equity estimator.
// custom solve, node-lock, multiway estimate, stack depths. One menu entry; four feature roots inside #panel.
import { parseRange, cardsOf, mixLine, roundMix } from './lab-core.js';
import { THREEWAY_LAB_ITERS } from './postflop/solver3.js';
import { equityVsRanges } from './ranges.js';
import { COMBOS } from './ranges.js';
import { comboIndex } from './postflop/solver.js';

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DEF_LOCK_BOARD = 'Kd7c2h9s';
const DEF = { board: 'Kd7c2h9s4d', oop: 'AA-77,AKs-ATs,KQs,98s,JTs,A5s-A2s', ip: 'KK-99,AQs+,AJo+,QJs,T9s,76s', pot: 20, stack: 60, size: 66 };
let jobId = 0;

// one fresh module worker per solve: parallel-safe, no shared state.
// opts: { kind: 'lock'|'three', iters, locks, onProgress, hold } ; hold = { w, resolve } lets a newer solve replace this one.
function solveJob(input, opts = {}) {
  return new Promise((resolve) => {
    const id = ++jobId;
    let w, done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(kill); try { w && w.terminate(); } catch (e) { /* gone */ } resolve(r); };
    const kill = setTimeout(() => finish({ error: 'solve timed out' }), 20000);
    try { w = new Worker(new URL('./lab-worker.js', import.meta.url), { type: 'module' }); } catch (e) { finish({ error: 'worker unavailable' }); return; }
    if (opts.hold) { if (opts.hold.cancel) opts.hold.cancel(); opts.hold.cancel = () => finish({ error: 'replaced by a newer solve', replaced: true }); }
    w.onmessage = (e) => { if (e.data.id !== id) return; if (e.data.progress !== undefined) { if (opts.onProgress) opts.onProgress(e.data.progress, e.data.of); return; } finish(e.data); };
    w.onerror = () => finish({ error: 'solver error' });
    w.postMessage({ id, input, iters: opts.iters || 600, kind: opts.kind, locks: opts.locks });
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
const TW_PRE = [
  { name: 'Medium ranges (fast)', r: ['AA-TT,AKs-AQs,KQs,AKo', 'JJ-77,AJs-ATs,KJs,QJs,T9s,AQo', 'TT-55,A5s-A2s,98s,87s,76s,KTs,KQo'] },
  { name: 'Wider ranges (slower)', r: ['AA-88,AKs-ATs,KQs,KJs,QJs,JTs,AKo-AQo,A5s-A3s', 'KK-77,AQs-ATs,KQs,KTs,QJs,JTs,T9s,98s,AQo,AJo,KQo', 'QQ-33,AJs-A4s,K9s+,QTs+,J9s+,T9s,98s,87s,76s,KJo+'] },
];
const cardStr = (c) => '23456789TJQKA'[c >> 2] + 'shdc'[c & 3];
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
  <p class="f-lead">Lab: the same solver as live coaching, on spots you choose. River spots solve in about a second; the three-player solve takes a few.</p>
  <section data-feature="custom-solve" class="lab-sec"><h4>Custom solve</h4>
    <label class="f-row"><span>Bet size, percent of pot</span><input class="f-in" id="labSize" type="number" inputmode="numeric" value="${DEF.size}"></label>
    <label class="f-row"><span>Board</span><input class="f-in" id="labBoard" type="text" value="${DEF.board}"></label>
    <label class="f-row"><span>OOP range</span><input class="f-in" id="labOop" type="text" value="${DEF.oop}"></label>
    <label class="f-row"><span>IP range</span><input class="f-in" id="labIp" type="text" value="${DEF.ip}"></label>
    <label class="f-row"><span>Pot (BB)</span><input class="f-in" id="labPot" type="number" inputmode="numeric" value="${DEF.pot}"></label>
    <label class="f-row"><span>Stack (BB)</span><input class="f-in" id="labStack" type="number" inputmode="numeric" value="${DEF.stack}"></label>
    <button class="btn f-btn" id="labSolve">Solve</button><div class="f-rows" id="labOut"></div></section>
  <section data-feature="nodelock" class="lab-sec"><h4>Node lock, per street</h4>
    <p class="f-note">Pick a player and a street, say how often that player bets there, and tap Lock. That decision is held fixed, everything else is re-solved, and you see how the other player responds. Turn and river are separate: fixing one leaves the other solved. Clear lock puts a street back to the free solve. Uses the ranges, pot and stack above on a turn board.</p>
    <label class="f-row"><span>Turn board (4 cards)</span><input class="f-in" id="labLkBoard" type="text" value="${DEF_LOCK_BOARD}"></label>
    ${['turn', 'river'].map(st => `<div class="f-row lab-btns lk-row"><span class="lk-st">${st === 'turn' ? 'Turn' : 'River'}</span>
      <select class="f-sel lk-pl" id="labLkP_${st}" aria-label="${st} player"><option value="0">OOP</option><option value="1">IP</option></select>
      <label class="lk-bet"><span>bets</span><input class="f-in" id="labLkB_${st}" type="number" inputmode="numeric" min="0" max="100" value="70"><span>percent</span></label>
      <button class="btn f-btn" id="labLock_${st}">Lock ${st}</button><button class="btn f-btn" id="labClear_${st}">Clear lock ${st}</button></div>`).join('')}
    <div class="f-rows" id="labLockOut"></div></section>
  <section data-feature="multiway" class="lab-sec"><h4>Multiway (3-way)</h4>
    <label class="f-row"><span>Spot</span><select class="f-sel" id="labMw">${mwOpts}</select></label><div class="f-rows" id="labMwOut"></div></section>
  <section data-feature="threeway" class="lab-sec"><h4>3-way river (no guarantee)</h4>
    <p class="f-note">Three players on the river: seat 1 acts first, then seat 2, then seat 3. Solved live in a worker with a fixed ${THREEWAY_LAB_ITERS} iterations (the phone budget), so the same inputs always give the same answer.</p>
    <label class="f-row"><span>Ranges</span><select class="f-sel" id="labTwPre">${TW_PRE.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f-row"><span>Board (5 cards)</span><input class="f-in" id="labTwBoard" type="text" value="${DEF.board}"></label>
    ${[0, 1, 2].map(k => `<label class="f-row"><span>Seat ${k + 1} range</span><input class="f-in" id="labTwR${k}" type="text" value="${TW_PRE[0].r[k]}"></label>`).join('')}
    <label class="f-row"><span>Pot (BB)</span><input class="f-in" id="labTwPot" type="number" inputmode="numeric" value="20"></label>
    <label class="f-row"><span>Bet size, percent of pot</span><input class="f-in" id="labTwSize" type="number" inputmode="numeric" value="66"></label>
    <button class="btn f-btn" id="labTwSolve">Solve 3-way</button><div class="f-rows" id="labTwOut" aria-live="polite"></div></section>
  <section data-feature="stacks" class="lab-sec"><h4>Stack depth</h4>
    <p class="f-note">Postflop stacks: effective stack at the river start, same board, ranges and pot.</p>
    <div class="f-row lab-btns"><button class="btn f-btn labStk" data-bb="100">100 BB</button><button class="btn f-btn labStk" data-bb="40">40 BB</button><button class="btn f-btn labStk" data-bb="25">25 BB</button></div><div class="f-rows" id="labStkOut"></div></section>
  </div>`;
  ctx.openPanel('Lab', html);
  const $ = (id) => document.getElementById(id);
  const cur = () => ({ board: $('labBoard').value, oop: $('labOop').value, ip: $('labIp').value, pot: $('labPot').value, stack: $('labStack').value, size: +$('labSize').value || DEF.size });
  const tok = { c: 0, l: 0, s: 0, t: 0 };
  const guard = async (out, pending, key, fn) => { const my = ++tok[key]; out.innerHTML = lines([pending]); try { const r = await fn(); if (my === tok[key] && r) out.innerHTML = lines(r); } catch (e) { if (my === tok[key]) out.innerHTML = lines([String(e.message || e)]); } };

  const runCustom = () => guard($('labOut'), `Solving size ${$('labSize').value} percent of pot...`, 'c', async () => {
    const p = cur(); const r = await solveJob(spot(p));
    return [`Board ${p.board}, bet ${p.size} percent of pot, pot ${p.pot} BB, stack ${p.stack} BB`, outLine(r.player === 1 ? 'IP' : 'OOP', r), `${r.combos || 0} combos in the acting range, 600 solver iterations`];
  });
  // ---- per-street lock: real fixed nodes in the solver (js/postflop/solver.js input.locks)
  const LK_ITERS = 150, STREETS = ['turn', 'river'];
  const locks = { turn: null, river: null };
  const baseCache = new Map();
  const lockInput = (p) => {
    const b = cardsOf($('labLkBoard').value);
    if (b.length !== 4 || new Set(b).size !== 4) throw new Error('The lock spot needs a turn board of 4 different cards like Kd7c2h9s');
    const inp = spot({ ...p, board: $('labLkBoard').value });
    inp.sizes = { ...inp.sizes, allin: false };
    return inp;
  };
  const lkLines = (r, tag) => {
    if (r.error) return [`${tag}: ${r.error}`];
    const o = [`${tag}`];
    const add = (l, m) => { if (m) o.push(mixLine(l, m)); };
    add('Turn, OOP acts first', r.turn.oop); add('Turn, IP facing a bet', r.turn.ipVsBet); add('Turn, IP after a check', r.turn.ipAfterCheck);
    if (r.river.oop) {
      const c = cardStr(r.river.card), pre = `River ${c} after check, check`;
      add(`${pre}: OOP acts first`, r.river.oop); add('River, IP facing a bet', r.river.ipVsBet); add('River, IP after a check', r.river.ipAfterCheck);
    }
    return o;
  };
  const lockText = () => STREETS.map(st => `${st === 'turn' ? 'Turn' : 'River'}: ${locks[st] ? `${locks[st].player ? 'IP' : 'OOP'} fixed to bet ${locks[st].bet} percent` : 'free solve'}`).join('; ');
  const runLock = () => guard($('labLockOut'), `${lockText()}: solving...`, 'l', async () => {
    const p = cur(); const inp = lockInput(p);
    const key = JSON.stringify([$('labLkBoard').value, p.oop, p.ip, p.pot, p.stack, p.size]);
    const list = STREETS.filter(st => locks[st]).map(st => ({ player: locks[st].player, street: st, bet: locks[st].bet / 100 }));
    const baseP = baseCache.has(key) ? Promise.resolve(baseCache.get(key)) : solveJob(inp, { kind: 'lock', iters: LK_ITERS, locks: [] }).then(r => { if (!r.error) baseCache.set(key, r); return r; });
    const lockP = list.length ? solveJob(inp, { kind: 'lock', iters: LK_ITERS, locks: list }) : null;
    const [base, lk] = await Promise.all([baseP, lockP]);
    const out = [`Turn board ${$('labLkBoard').value}, bet ${p.size} percent of pot, ${LK_ITERS} solver iterations. ${lockText()}.`];
    if (lk) out.push(...lkLines(lk, 'With your fixed decisions (everything else re-solved)'), ...lkLines(base, 'Free solve, for comparison'));
    else out.push(...lkLines(base, 'Free solve (no lock)'));
    return out;
  });
  STREETS.forEach(st => {
    $('labLock_' + st).addEventListener('click', () => { const b = Math.max(0, Math.min(100, Math.round(+$('labLkB_' + st).value))); locks[st] = { player: +$('labLkP_' + st).value, bet: Number.isFinite(b) ? b : 70 }; runLock(); });
    $('labClear_' + st).addEventListener('click', () => { locks[st] = null; runLock(); });
  });

  // ---- 3-way river: solver3 in a worker, progress line, a new solve replaces a running one
  const twHold = {};
  const runThree = () => guard($('labTwOut'), 'Checking the spot...', 't', async () => {
    const b = cardsOf($('labTwBoard').value), pot = +$('labTwPot').value, size = +$('labTwSize').value;
    if (b.length !== 5 || new Set(b).size !== 5 || String($('labTwBoard').value).replace(/\s+/g, '').length !== 10) throw new Error('The 3-way river board needs 5 different cards like Kd7c2h9s4d');
    if (!(pot > 0) || !(size >= 5 && size <= 300)) throw new Error('Pot must be above 0 and the bet size between 5 and 300 percent of the pot');
    const r = [0, 1, 2].map(k => parseRange($('labTwR' + k).value, b));
    for (let k = 0; k < 3; k++) if (!r[k].some(x => x > 0)) throw new Error(`Seat ${k + 1} has no hands: the range is empty or every hand is removed by board cards`);
    const my = tok.t;
    const input = { board: b, pot, stack: Math.max(+$('labStack').value || 0, pot * 2), ranges: r, sizes: { bet: [size / 100], raise: [2.5], allin: false, maxBets: 2, allinThreshold: 0.67 } };
    const res = await solveJob(input, { kind: 'three', iters: THREEWAY_LAB_ITERS, hold: twHold, onProgress: (d, n) => { if (my === tok.t) $('labTwOut').innerHTML = lines([`Solving 3-way river: ${d} of ${n} iterations`]); } });
    if (res.replaced) return null;
    if (res.error) throw new Error(res.error);
    const names = ['Seat 1 acts first', 'Seat 2 after a check', 'Seat 3 after two checks'];
    return [`3-way river, board ${$('labTwBoard').value}, pot ${pot} BB, bet ${size} percent of pot, ${res.combos.join(' / ')} combos per seat`,
      ...res.seats.map((m, k) => m ? mixLine(names[k], m) : `${names[k]}: no decision on this line`),
      `Best-response gain at ${res.iters} iterations, in percent of the pot: seat 1 ${res.gain[0].toFixed(2)}, seat 2 ${res.gain[1].toFixed(2)}, seat 3 ${res.gain[2].toFixed(2)}`,
      'No guarantee: three-player CFR has no equilibrium guarantee, so these strategies are a best effort and the gain shows how far from stable they are (0 would be stable).',
      `Phone budget: ${res.iters} iterations. The fast ranges take about 2 s on a phone, the wider preset up to about 10 s. The gain above is the one at that budget.`];
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
  $('labTwSolve').addEventListener('click', runThree);
  $('labTwPre').addEventListener('change', () => { TW_PRE[+$('labTwPre').value].r.forEach((t, k) => { $('labTwR' + k).value = t; }); });
  $('labMw').addEventListener('change', runMw);
  document.querySelectorAll('.labStk').forEach(b => b.addEventListener('click', () => { stk = +b.dataset.bb; runStk(); }));
  $('labTwOut').innerHTML = lines(['Tap Solve 3-way to solve the three-player river spot.']);
  runCustom(); runMw(); runStk(); runLock();
}
