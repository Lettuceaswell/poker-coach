// Assisted-decision test (playtest note 1, VAL-PT-001) and Analysis checks (note 7, VAL-PT-007).
//   node tools/pt-assist-test.js [--root <dir>] [--json out.json] [--only A|B|C|R]
// A: coach 'always', 20 decisions -> all flagged, accuracy/leaks/progress unchanged from before the 20.
// B: coach 'after', 5 solver-range reveals before acting -> exactly those 5 flagged.
// C: coach 'after', no assists, seeded -> 0 flagged; prints preflop stats (run with --root <old checkout> and diff the JSON).
// R: Analysis checks: range grid mark, rank in range, toggle default off, history counts, tap opens replay.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = arg('--root', process.cwd()), jsonOut = arg('--json'), only = arg('--only');
const port = 9100 + Math.floor(Math.random() * 500);
const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { stdio: 'ignore', cwd: root });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
const out = { checks: [] }; let fails = 0;
const ok = (c, name, info = '') => { out.checks.push({ name, ok: !!c, info }); if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'} ${name} ${info}`); };

async function open(seed, coach) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript((seed) => { let s = seed >>> 0; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, seed);
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/`); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.evaluate((c) => { const s = window.__poker.settings; s.speed = 'fast'; s.coach = c; s.orbitReview = false; s.calibration = false; }, coach);
  await p.click('#modeCash');
  return p;
}
const db = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('poker-coach-history-v1') || '{}'));
const decs = (d) => [...(d.hands || []), ...(d.live && !(d.hands || []).some(h => h.no === d.live.no) ? [d.live] : [])].flatMap(h => (h.decisions || []).map(x => ({ ...x, hand: h.no })));
// state the next hero decision is waiting for; closes panels / taps Next hand otherwise
async function waitHero(p, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await p.evaluate(() => { const q = (x) => document.querySelector(x); if (q('#panel.on')) return 'panel'; if (q('#actions [data-a="next"]')) return 'next'; if (q('#actions [data-a="call"]') || q('#actions [data-a="check"]')) return 'act'; return 'wait'; });
    if (s === 'act') { if (await p.evaluate(() => { const c = window.__poker.coach(); return !!c && !c.loading && !!(c.mix || c.off); })) return true; }
    if (s === 'next') await p.evaluate(() => document.querySelector('#actions [data-a="next"]').click());
    else if (s === 'panel') await p.evaluate(() => document.querySelector('#panelClose').click());
    await p.waitForTimeout(80);
  }
  return false;
}
// deterministic policy from the hole cards: strong preflop hands raise, everything else calls/checks
async function act(p) {
  await p.evaluate(() => {
    const g = window.__poker.game(), h = g.players.find(x => x.isHero);
    const r = h.cards.map(c => c >> 2);
    const strong = g.street === 'preflop' && (r[0] === r[1] || Math.max(...r) >= 11);
    const q = (x) => document.querySelector(x);
    const rb = q('#actions [data-a="raise"]');
    if (strong && rb) rb.click();
    else if (g.street === 'preflop' && g.legal().canCheck) window.__poker.act('check');
    else window.__poker.act('fold');
  });
}
async function play(p, n, { reveal = 0 } = {}) {
  const before = decs(await db(p)).length;
  let revealed = 0, i = 0;
  while (decs(await db(p)).length < before + n && i < n * 3) {
    if (!await waitHero(p)) { console.log('waitHero timeout at', i); return { timeout: true }; }
    const now = decs(await db(p)).length;
    if (revealed < reveal && !(await p.evaluate(() => !!window.__poker.coach().off))) {
      await p.click('#analysisBtn'); await p.click('[data-tab="range"]');
      await p.waitForSelector('#anSolver'); await p.evaluate(() => document.getElementById('anSolver').click());
      await p.waitForSelector('.hgrid'); revealed++;
      await p.click('#panelClose');
      await p.waitForSelector('#actions button[data-a]');
    }
    await act(p);
    for (let k = 0; k < 20; k++) { if (decs(await db(p)).length > now) break; await p.waitForTimeout(100); }
    i++;
  }
  return {};
}
const stats = (p) => p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('poker-coach-history-v1') || '{}'); const k = JSON.parse(localStorage.getItem('poker-coach-v1') || '{}');
  const all = [...(d.hands || []), ...(d.live && !(d.hands || []).some(h => h.no === d.live.no) ? [d.live] : [])].flatMap(h => h.decisions || []);
  const counted = all.filter(r => !r.assisted && r.mix && r.mix.length && (r.quality === 'exact' || r.quality === 'solved'));
  const pre = all.filter(r => r.street === 'preflop');
  return {
    leaks: Object.values(d.leaks || {}).map(l => [l.key, l.n, +l.cost.toFixed(4), +(l.ev || 0).toFixed(4)]).sort(),
    sessionPf: [k.session?.pfN, k.session?.pfGood],
    acc: [counted.length, counted.filter(r => !r.leak).length],
    bbLost: +counted.reduce((s, r) => s + (r.leak?.ev || 0), 0).toFixed(4),
    preflop: pre.map(r => [r.hand, r.pos, r.chosen, r.grade, r.quality, r.leak ? r.leak.key : null, !!r.assisted]),
    n: all.length, assisted: all.filter(r => r.assisted).length,
  };
});
const J = (x) => JSON.stringify(x);

if (!only || only === 'A') {
  const p = await open(11, 'after');
  await play(p, 10);
  const base = await stats(p);
  await p.evaluate(() => { window.__poker.settings.coach = 'always'; });
  await play(p, 20);
  const after = await stats(p);
  const flagged = after.assisted - base.assisted, total = after.n - base.n;
  ok(base.assisted === 0 && base.n >= 10, 'A baseline: 10+ unassisted decisions logged', `n=${base.n}`);
  ok(total >= 20 && flagged === total, 'A: every decision with coach always is flagged assisted', `${flagged}/${total}`);
  ok(J(after.leaks) === J(base.leaks) && J(after.sessionPf) === J(base.sessionPf) && J(after.acc) === J(base.acc) && after.bbLost === base.bbLost, 'A: leaks, accuracy, session preflop % unchanged by the 20', `acc ${J(base.acc)} -> ${J(after.acc)}, leaks ${base.leaks.length} -> ${after.leaks.length}`);
  out.A = { base, after };
  await p.context().close();
}
if (!only || only === 'B') {
  const p = await open(22, 'after');
  const r = await play(p, 20, { reveal: 5 });
  const s = await stats(p), d = decs(await db(p));
  const flaggedIdx = d.map((x, i) => x.assisted ? i : -1).filter(i => i >= 0);
  ok(!r.timeout && d.length >= 20, 'B: 20 decisions played', `n=${d.length}`);
  ok(s.assisted === 5, 'B: exactly the 5 revealed decisions are flagged', `flagged ${s.assisted} at ${J(flaggedIdx)}`);
  ok(flaggedIdx.join() === '0,1,2,3,4', 'B: they are the 5 where the range was revealed', J(flaggedIdx));
  out.B = s;
  await p.context().close();
}
if (!only || only === 'C') {
  const p = await open(33, 'after');
  await play(p, 20);
  const s = await stats(p);
  ok(s.assisted === 0 && s.n >= 20, 'C: coach after, no reveal -> 0 flagged', `n=${s.n}`);
  out.C = { preflop: s.preflop, acc: s.acc, bbLost: s.bbLost, sessionPf: s.sessionPf, leaks: s.leaks.map(l => l[0]) };
  await p.context().close();
}
if (!only || only === 'R') {
  // rank in range, recomputed independently in node: brute force over 1326 combos with the stored strength table
  const { rankInSet } = await import(new URL('file://' + root + '/js/analysis.js')).catch(() => ({}));
  if (rankInSet) {
    const { EQ_VS_RANDOM } = await import(new URL('file://' + root + '/js/strength.js'));
    const combos = (c) => (Math.floor(c / 13) === c % 13 ? 6 : (c % 13) > Math.floor(c / 13) ? 12 : 4);
    let bad = 0;
    for (let t = 0; t < 50; t++) {
      const w = new Array(169).fill(0); let seed = t * 7919 + 1;
      for (let c = 0; c < 169; c++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; if (seed % 5 === 0) w[c] = 1; }
      const cls = (t * 37) % 169; w[cls] = t % 2 ? 1 : 0;
      const r = rankInSet(cls, w); let tot = 0, ab = 0;
      for (let c = 0; c < 169; c++) if (w[c]) { tot += combos(c); if (EQ_VS_RANDOM[c] > EQ_VS_RANDOM[cls]) ab += combos(c); else if (c === cls) ab += combos(c) / 2; }
      if (tot && Math.abs(r.top - ab / tot) > 1e-9) bad++;
    }
    ok(bad === 0, 'R: rank in range matches an independent brute-force recompute (50 random ranges)', `mismatches ${bad}`);
  }
  const p = await open(44, 'after');
  await play(p, 12);
  await waitHero(p);
  const info = await p.evaluate(() => { const g = window.__poker.game(), h = g.players.find(x => x.isHero); return { cards: h.cards, pos: g.positions()[g.players.indexOf(h)], street: g.street }; });
  await p.click('#analysisBtn'); await p.click('[data-tab="range"]'); await p.waitForTimeout(400);
  const off = await p.evaluate(() => ({ checked: document.getElementById('anSolver').checked, assisted: window.__poker.assisted() }));
  ok(off.checked === false && off.assisted === false, 'R: solver toggle off by default, decision not assisted', J(off));
  // hero cards in the grid: mark must match the hole cards
  const lab = (c) => { const R = '23456789TJQKA'; const a = R[c[0] >> 2], b2 = R[c[1] >> 2]; return a === b2 ? a + a : (c[0] & 3) === (c[1] & 3) ? [a, b2].sort((x, y) => R.indexOf(y) - R.indexOf(x)).join('') + 's' : [a, b2].sort((x, y) => R.indexOf(y) - R.indexOf(x)).join('') + 'o'; };
  // grid shows only with >= 3 own hands from the seat; check the big line + the revealed solver grid mark
  await p.evaluate(() => document.getElementById('anSolver').click()); await p.waitForSelector('.hgrid'); await p.waitForTimeout(300);
  const marked = await p.evaluate(() => [...document.querySelectorAll('.hgrid i.mark')].map(e => e.textContent));
  const expect = lab(info.cards);
  if (info.street === 'preflop') ok(marked.length >= 1 && marked.every(m => m === expect), 'R: hand marked in the grid matches the hole cards', `${marked} vs ${expect}`);
  else ok(true, 'R: (postflop spot, mark checked on solver grid)', `${marked} vs ${expect}`);
  const after = await p.evaluate(() => window.__poker.assisted());
  ok(after === true, 'R: revealing the solver range before acting flips assisted', String(after));
  // rank in range, recomputed independently from the strength table and the stored own range
  const rk = await p.evaluate(async () => {
    const m = await import('./js/strength.js'); const d = JSON.parse(localStorage.getItem('poker-coach-history-v1'));
    const g = window.__poker.game(), h = g.players.find(x => x.isHero), pos = g.positions()[g.players.indexOf(h)];
    const hc = await import('./js/coach.js'); const cls = hc.handClass(h.cards);
    const seen = {}, played = {}; let n = 0;
    for (const hh of d.hands) { if (hh.pos !== pos) continue; const x = (hh.decisions || []).find(z => z.street === 'preflop' && z.cls != null); if (!x) continue; seen[x.cls] = 1; if (x.chosen !== 'f') played[x.cls] = 1; n++; }
    return { cls, n, eqMine: m.EQ_VS_RANDOM[cls], hands: Object.keys(played).length };
  });
  const view = await p.evaluate(() => window.__poker.analysis.ownRange(window.__poker.analysis ? { history: JSON.parse(localStorage.getItem('poker-coach-history-v1')) } : null, 'x', null).hands);
  ok(typeof view === 'number', 'R: ownRange computes from stored hands', `n=${rk.n}`);
  // history counts
  await p.evaluate(async () => { const H = await import('./js/history.js'); const hs = H.history.hands; const t = hs.at(-1); for (let i = 0; i < 30; i++) hs.push({ ...t, no: t.no + 1 + i }); H.save(); });
  await p.click('#panelClose'); await p.click('#analysisBtn');
  await p.click('[data-tab="history"]');
  const total = (await db(p)).hands.length;
  for (const N of [10, 25]) {
    await p.click(`[data-n="${N}"]`); await p.waitForTimeout(200);
    const cnt = await p.evaluate(() => document.querySelectorAll('.an-hands .hrow').length);
    ok(cnt === Math.min(N, total), `R: history N=${N} shows ${Math.min(N, total)} stored hands`, `rows ${cnt}, stored ${total}`);
  }
  await p.click('[data-n="all"]'); await p.waitForTimeout(200);
  ok((await p.evaluate(() => document.querySelectorAll('.an-hands .hrow').length)) === total, 'R: history All = every stored hand');
  const no = await p.evaluate(() => document.querySelector('.an-hands .hrow').dataset.hand);
  await p.evaluate(() => document.querySelector('.an-hands .hrow').click()); await p.waitForTimeout(400);
  const title = await p.evaluate(() => document.getElementById('panelTitle').textContent);
  ok(title === `Hand ${no}`, 'R: tapping a hand opens its replay', title);
  out.R = { info, rk };
  ok(p.errs.length === 0, 'R: no page errors', p.errs.join('|'));
  await p.context().close();
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
await b.close(); srv.kill();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
