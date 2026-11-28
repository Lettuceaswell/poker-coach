// Analysis > Board "who it favors" in multiway pots (playtest note 7): node tools/multiway-board-test.js [--root dir] [--out shots/w-live3d]
// Coach 'after': at a 3+-way postflop decision the Board tab hides the read behind the "counts as assisted" button,
// pressing it shows one share row per player plus a plain verdict (favorite or "No single favorite"), and flags the decision assisted.
// Also checks a 3-way river and coach 'always' (shown at once). Screenshots at 430x932.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = arg('--root', process.cwd()), outDir = arg('--out', 'shots/w-live3d');
fs.mkdirSync(outDir, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 300);
const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { stdio: 'ignore', cwd: root });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
let fails = 0; const text = [];
const ok = (c, name, info = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${name} ${info}`; text.push(l); console.log(l); if (!c) fails++; };
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((seed) => { let s = seed >>> 0; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, +arg('--seed', 31));
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://127.0.0.1:${port}/`); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.evaluate(() => { const s = window.__poker.settings; s.speed = 'fast'; s.coach = 'after'; s.orbitReview = false; s.calibration = false; });
await p.click('#modeCash');
const state = () => p.evaluate(() => {
  const q = (x) => document.querySelector(x); const g = window.__poker.game();
  const live = g.players.filter(x => !x.folded && !x.out);
  const mode = q('#panel.on') ? 'panel' : q('#actions [data-a="next"]') ? 'next' : (q('#actions [data-a="call"]') || q('#actions [data-a="check"]')) ? 'act' : 'wait';
  return { mode, street: g.street, n: live.length };
});
const stages = ['flop-after', 'river-after', 'turn-always']; let stage = 0; const t0 = Date.now();
while (stage < stages.length && Date.now() - t0 < 20 * 60 * 1000) {
  const s = await state();
  if (s.mode === 'next') { await p.evaluate(() => document.querySelector('#actions [data-a="next"]').click()); await p.waitForTimeout(60); continue; }
  if (s.mode === 'panel') { await p.evaluate(() => document.querySelector('#panelClose').click()); await p.waitForTimeout(60); continue; }
  if (s.mode !== 'act') { await p.waitForTimeout(80); continue; }
  const want = stages[stage], [street, coach] = want.split('-');
  if (s.street === street && s.n >= 3) {
    await p.evaluate((c) => { window.__poker.settings.coach = c; }, coach);
    const before = await p.evaluate(() => !!window.__poker.assisted());
    await p.click('#analysisBtn'); await p.click('[data-tab="board"]');
    await p.waitForTimeout(400);
    const body = () => p.evaluate(() => document.getElementById('panelBody').lastElementChild.innerText.replace(/\s+/g, ' '));
    if (coach === 'after') {
      let t = await body();
      ok(/counts this decision as assisted/i.test(t) && !/favor(s)? (your|[A-Z]+'s) range|No single favorite/.test(t), `${want}: read hidden behind the assisted button`, t.slice(0, 200));
      await p.screenshot({ path: `${outDir}/board-${want}-hidden.png` });
      await p.click('.an-show', { timeout: 3000 }); await p.waitForTimeout(1500);
    } else await p.waitForTimeout(1500);
    const t = await body();
    const rows = await p.evaluate(() => document.querySelectorAll('#panelBody > :last-child .vs').length);
    ok(rows >= 3 && /(The board favors|No single favorite)/.test(t), `${want}: one share row per player and a plain verdict`, `rows ${rows}; "${t.slice(Math.max(0, t.search(/who the board favors/i)), Math.max(0, t.search(/who the board favors/i)) + 330)}"`);
    ok(/Estimate|exactly these five cards/.test(t), `${want}: labeled ${street === 'river' ? 'exact board' : 'estimate'}`);
    if (coach === 'after') ok(await p.evaluate(() => !!window.__poker.assisted()) && !before, `${want}: pressing Show marked the decision assisted`);
    await p.screenshot({ path: `${outDir}/board-${want}.png` });
    await p.evaluate(() => document.querySelector('#panelClose').click());
    stage++;
  }
  await p.evaluate(() => { const q = (x) => document.querySelector(x); if (q('#actions [data-a="check"]')) window.__poker.act('check'); else window.__poker.act('call'); });
  await p.waitForTimeout(60);
}
ok(stage === stages.length, 'reached every scripted spot', `${stage}/${stages.length}`);
ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
fs.writeFileSync(`${outDir}/board-text.txt`, text.join('\n') + '\n');
await b.close(); srv.kill();
console.log(fails ? `${fails} FAIL` : 'multiway-board: all pass');
process.exit(fails ? 1 : 0);
