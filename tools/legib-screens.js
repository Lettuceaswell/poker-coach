// Run-3 harness for VAL-LEGIB-003: every screen added or changed tonight is legible.
// The text/contrast/tap/clip definitions are the frozen ones: SCAN_TEXT is read verbatim out of tools/score/v2/legibility.js
// (not exported there), with the frozen legibility-exempt.json. Added here: a green check (green text/fill/border on a visible element
// that is not the coach's pick, a grade chip or a +BB result). Long panels are scrolled in viewport steps so every row is scanned.
//   node tools/legib-screens.js [--root .] [--json out.json] [--shots dir] [--only name,name]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { startServer, launch, sleep, seedScript, settingsScript } from './score/v2/lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'score/v2/legibility.js'), 'utf8');
const a = src.indexOf('const SCAN_TEXT = (cfg) => {'), b = src.indexOf('\n};\n', a);
if (a < 0 || b < 0) throw new Error('cannot find SCAN_TEXT in frozen legibility.js');
const SCAN_TEXT = src.slice(a + 'const SCAN_TEXT = '.length, b + 2);
const EXEMPT = JSON.parse(fs.readFileSync(path.join(here, 'score/v2/fixtures/legibility-exempt.json'), 'utf8'));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', path.join(here, '..'))), shotsDir = arg('--shots', path.join(here, '../shots/w-polish')), jsonOut = arg('--json', '');
const only = arg('--only', '').split(',').filter(Boolean);
fs.mkdirSync(shotsDir, { recursive: true });
const VPS = [{ width: 390, height: 844, dsf: 1 }, { width: 360, height: 740, dsf: 1 }, { width: 430, height: 932, dsf: 3 }];

// green outside the allowed set (runs in page): visible element whose text colour, fill or border is clearly green
const GREEN = () => {
  const out = [];
  const par = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const isG = (c) => c && c[3] > 0.25 && c[1] > c[0] + 25 && c[1] > c[2] + 25 && c[1] > 90;
  const allowed = (e) => !!e.closest('.rec, [class*="grade"], [class*="chip"]:not(.bet-chip), [class*="good"], [class*="bb-"], [class*="gain"], [class*="plus"], #panel .dot') || /^\s*\+\s?\d/.test(e.textContent.trim());
  const sel = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const hasText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const bad = (hasText && isG(par(cs.color))) || isG(par(cs.backgroundColor)) || (+cs.borderTopWidth > 0 && isG(par(cs.borderTopColor)));
    if (bad && !allowed(e)) out.push({ sel: sel(e), text: (e.textContent || '').trim().slice(0, 30) });
  }
  return out;
};

const results = []; // {screen, vp, font, contrast, tap, clip, green, nodes, taps}
const browser = await launch(), srv = await startServer(root);
const mk = async (vp, settings = {}, seed = 20261128) => {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf || 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(seedScript(seed)); await ctx.addInitScript(settingsScript({ seats: 3, speed: 'fast', ...settings }));
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(srv.origin + '/'); await p.waitForSelector('#modeCash'); return p;
};
async function scan(p, vp, screen, { scroll = '' } = {}) {
  const tag = `${vp.width}x${vp.height}`; const merged = { font: [], contrast: [], tap: [], clip: [], green: [], nodes: 0, taps: 0 };
  const once = async () => { const r = await p.evaluate('(' + SCAN_TEXT + ')(' + JSON.stringify({ exemptFont: EXEMPT.font }) + ')'); const g = await p.evaluate(GREEN); for (const k of ['font', 'contrast', 'tap', 'clip']) merged[k].push(...r[k]); merged.green.push(...g); merged.nodes += r.nodes; merged.taps += r.taps; };
  await sleep(250); await once();
  if (scroll) { // step down the scroll container one viewport at a time
    for (let i = 0; i < 12; i++) { const moved = await p.evaluate(([s, h]) => { const el = document.querySelector(s); if (!el) return false; const before = el.scrollTop; el.scrollTop += h * 0.8; return el.scrollTop > before; }, [scroll, vp.height]); if (!moved) break; await sleep(150); await once(); }
    await p.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollTop = 0; }, scroll);
  }
  const uniq = (arr) => [...new Map(arr.map(v => [v.sel + '|' + v.text, v])).values()];
  const row = { screen, vp: tag, nodes: merged.nodes, taps: merged.taps }; for (const k of ['font', 'contrast', 'tap', 'clip', 'green']) row[k] = uniq(merged[k]);
  row.violations = ['font', 'contrast', 'tap', 'clip', 'green'].reduce((s, k) => s + row[k].length, 0);
  results.push(row); await p.screenshot({ path: path.join(shotsDir, `${screen.replace(/[^a-z0-9]+/gi, '_')}-${tag}.png`) }).catch(() => {});
  console.log(`${row.violations ? 'VIOL' : 'ok  '} ${screen} @${tag}: ${row.violations} (font ${row.font.length} contrast ${row.contrast.length} tap ${row.tap.length} clip ${row.clip.length} green ${row.green.length}) nodes ${row.nodes}`);
  for (const k of ['font', 'contrast', 'tap', 'clip', 'green']) for (const v of row[k].slice(0, 4)) console.log(`      ${k}: ${v.sel} "${v.text}" ${v.value ?? ''}`);
}
const back = async (p) => { await p.evaluate(() => { document.getElementById('panelClose')?.click(); }).catch(() => {}); await sleep(200); };
const on = (n) => !only.length || only.includes(n);
const click = async (p, s) => { await p.evaluate((s) => document.querySelector(s)?.click(), s); };

async function screens(vp) {
  // menu: quiz entry, drill due count, trend
  if (on('menu')) { const p = await mk(vp); await scan(p, vp, 'menu (quiz entry, drill due count)'); await p.context().close(); }
  // quiz session
  if (on('quiz')) {
    const p = await mk(vp); await click(p, '#modeQuiz'); await sleep(500); await scan(p, vp, 'quiz session', { scroll: '#panelBody' });
    const o = await p.$('#panelBody button:not(#panelClose), .quiz button'); if (o) { await o.click().catch(() => {}); await sleep(400); await scan(p, vp, 'quiz answered', { scroll: '#panelBody' }); }
    await p.context().close();
  }
  // drills: question, progress/difficulty/leak lines, answer
  if (on('drills')) {
    const p = await mk(vp); await click(p, '#modeDrills'); await sleep(700); await scan(p, vp, 'drill question (progress, difficulty, leak lines)', { scroll: '#panelBody' });
    const reveal = await p.$('#panelBody .reveal:not([disabled]), #panelBody [data-a]'); if (reveal) { await reveal.click().catch(() => {}); await sleep(500); await scan(p, vp, 'drill answered', { scroll: '#panelBody' }); }
    await p.context().close();
  }
  // Lab: three-way result + per-street lock
  if (on('lab')) {
    const p = await mk(vp); await click(p, '#menuLab'); await sleep(500); await scan(p, vp, 'lab top', { scroll: '#panelBody' });
    await click(p, '#labTwSolve'); await p.waitForFunction(() => /\d+%/.test(document.getElementById('labTwOut')?.innerText || ''), null, { timeout: 90000 }).catch(() => {}); await sleep(300);
    await p.evaluate(() => document.getElementById('labTwOut')?.scrollIntoView({ block: 'center' })); await scan(p, vp, 'lab three-way result');
    await click(p, '#labLock_turn'); await p.waitForFunction(() => /\d+%/.test(document.getElementById('labLockOut')?.innerText || ''), null, { timeout: 90000 }).catch(() => {}); await sleep(300);
    await p.evaluate(() => document.getElementById('labLockOut')?.scrollIntoView({ block: 'center' })); await scan(p, vp, 'lab per-street lock result');
    await p.evaluate(() => document.getElementById('labLockOut')?.scrollIntoView({ block: 'start' })); await scan(p, vp, 'lab per-street lock rows');
    await p.context().close();
  }
  // other panels changed tonight
  if (on('panels')) for (const [id, nm] of [['#menuAnalysis', 'analysis'], ['#menuProgress', 'progress'], ['#menuLeaks', 'leaks'], ['#menuHands', 'hands'], ['#menuSettings', 'settings'], ['#menuReview', 'review'], ['#menuLibrary', 'library']]) {
    const p = await mk(vp); await click(p, id); await sleep(600); await scan(p, vp, nm, { scroll: '#panelBody' });
    if (nm === 'analysis') for (let t = 1; t < 5; t++) { const tabs = await p.$$('#panelBody [role=tab], #panelBody .tab, #panelBody .an-tab'); if (!tabs[t]) break; await tabs[t].click().catch(() => {}); await sleep(300); await scan(p, vp, `analysis tab ${t}`, { scroll: '#panelBody' }); }
    await p.context().close();
  }
  // calibration "Next spot" (orbit review panel)
  if (on('orbit')) {
    let got = false; for (const sd of [20261137, 20261201, 20261303, 20261405]) { if (got) break;
    const p = await mk(vp, { orbitReview: true, seats: 6 }, sd); const end = Date.now() + 70000;
    while (Date.now() < end && !got) {
      if (await p.evaluate(() => document.getElementById('panel')?.classList.contains('on'))) {
        const title = await p.$eval('#panelTitle', e => e.textContent).catch(() => '');
        if (/orbit/i.test(title)) { await sleep(500); await scan(p, vp, 'orbit review (calibration)', { scroll: '#panelBody' }); const ns = await p.$('#panelBody .next-spot'); if (ns) { await ns.scrollIntoView?.(); await ns.click().catch(() => {}); await sleep(400); await scan(p, vp, 'calibration next spot', { scroll: '#panelBody' }); } got = !!ns; break; }
        await click(p, '#panelClose'); await sleep(150); continue;
      }
      if (await p.$('#modeCash:visible')) await click(p, '#modeCash');
      const acts = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
      if (acts.length) await click(p, `#actions [data-a="${acts.includes('next') ? 'next' : acts.includes('check') ? 'check' : acts.includes('call') ? 'call' : 'fold'}"]`); await sleep(70);
    }
    await p.context().close(); }
    if (!got) console.log('note: no orbit review with a Next spot button at ' + vp.width);
  }
  // live 3-way river coach panel (hero calls everything until three players reach the river)
  if (on('live3')) {
    const p = await mk(vp, { coach: 'always', orbitReview: false, calibration: false }, 31); await click(p, '#modeCash'); await p.evaluate(() => { window.__poker.three.budget.ms = 10000; window.__poker.three.budget.iters = 80; });
    const t0 = Date.now(); let got = false;
    while (Date.now() - t0 < 6 * 60000 && !got) {
      const s = await p.evaluate(() => { const q = (x) => document.querySelector(x); const g = window.__poker.game(); const live = g.players.filter(x => !x.folded && !x.out); return { mode: q('#panel.on') ? 'panel' : q('#actions [data-a="next"]') ? 'next' : (q('#actions [data-a="call"]') || q('#actions [data-a="check"]')) ? 'act' : 'wait', t3: g.street === 'river' && g.board.length === 5 && live.length === 3 && !live.some(x => x.allIn) }; });
      if (s.mode === 'next') { await click(p, '#actions [data-a="next"]'); await sleep(60); continue; }
      if (s.mode === 'panel') { await click(p, '#panelClose'); await sleep(60); continue; }
      if (s.mode !== 'act') { await sleep(80); continue; }
      if (s.t3) { const w = Date.now(); while (Date.now() - w < 30000 && !(await p.evaluate(() => !!window.__poker.coach()?.three))) await sleep(150); await sleep(300); await scan(p, vp, 'live 3-way river coach panel'); got = true; break; }
      await p.evaluate(() => { const q = (x) => document.querySelector(x); window.__poker.act(q('#actions [data-a="check"]') ? 'check' : 'call'); }); await sleep(60);
    }
    if (!got) console.log('note: no 3-way river reached at ' + vp.width);
    await p.context().close();
  }
}
for (const vp of VPS) await screens(vp);
await browser.close(); srv.close();
const total = results.reduce((s, r) => s + r.violations, 0);
console.log(`TOTAL screens ${results.length} violations ${total}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ total, results }, null, 1));
process.exit(total ? 1 : 0);
