// Run-3 harness for VAL-LEGIB-001: bet chips never overlap a card or label, every committed bet shows a chip.
// The violation definition is the frozen one: the CHIPS function is read verbatim out of tools/score/v2/legibility.js
// (it is not exported there), so there is one definition. Usage:
//   node tools/legib-chips.js [--hands 8] [--root .] [--json out.json] [--shots dir]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { startServer, launch, sleep, seedScript, settingsScript } from './score/v2/lib.js';
// run 3 (VAL-PT-002): his phone, 430x932 at deviceScaleFactor 3, joins the two frozen sizes. The frozen CHIPS check already treats board cards
// AND empty board slots as obstacles; tools/pt-table-check.js adds the opponent card backs, per-street chip counts and the mix-line checks.
const VIEWPORTS = [{ width: 430, height: 932, dsf: 3 }, { width: 390, height: 844, dsf: 1 }, { width: 360, height: 740, dsf: 1 }];
async function newPage(browser, origin, o) {
  const ctx = await browser.newContext({ viewport: { width: o.viewport.width, height: o.viewport.height }, deviceScaleFactor: o.viewport.dsf || 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(seedScript(o.seed)); await ctx.addInitScript(settingsScript(o.settings));
  const p = await ctx.newPage(); p.setDefaultTimeout(o.timeout || 8000); await p.goto(origin + '/'); await p.waitForSelector('#modeCash'); return p;
}
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'score/v2/legibility.js'), 'utf8');
const a = src.indexOf('const CHIPS = () => {'), b = src.indexOf('\n};\n', a);
if (a < 0 || b < 0) throw new Error('cannot find CHIPS in frozen legibility.js');
const CHIPS = src.slice(a + 'const CHIPS = '.length, b + 2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HANDS = +arg('--hands', 8), root = path.resolve(arg('--root', path.join(here, '..'))), shotsDir = arg('--shots', path.join(here, '../shots/w-table1')), jsonOut = arg('--json', '');
const SEATS = arg('--seats', '3,4,5,6').split(',').map(Number), seed = 20261127;
fs.mkdirSync(shotsDir, { recursive: true });
const srv = await startServer(root), browser = await launch();
const res = []; const MINSTREAK = +arg('--min-streak', 2); const panelOn = (p) => p.evaluate(() => document.getElementById('panel')?.classList.contains('on'));
async function combo(n, vp) {
  const r = { combo: `${n}p@${vp.width}x${vp.height}`, hands: 0, chips: 0, polls: 0, raw: 0, violations: [] };
  for (let h = 0; h < HANDS; h++) {
    const p = await newPage(browser, srv.origin, { seed: seed + n * 1000 + vp.width + h * 17 + 3, viewport: vp, settings: { seats: n, speed: 'fast', coach: 'always', orbitReview: false, calibration: false }, timeout: 6000 });
    try {
      await p.click('#modeCash'); const t0 = Date.now(); let shot = false; const streak = new Map(); let resultPolls = 0;
      while (Date.now() - t0 < 28000) {
        if (await panelOn(p)) { await p.click('#panelClose').catch(() => {}); await sleep(100); }
        const c = await p.evaluate('(' + CHIPS + ')()'); r.polls++; r.chips += c.chips.length;
        const acts0 = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
        const snap = c.viol.length ? await p.evaluate(() => JSON.stringify({ board: [...document.querySelectorAll('#board .card')].map(c => c.classList.contains('back') ? 'b' : 'c').join(''), seats: [...document.querySelectorAll('#seats .seat')].map(s => s.id.slice(5) + ':' + s.querySelector('.pos').textContent + ':' + s.querySelector('.nm').textContent + ':' + s.querySelector('.bet-chip').textContent + (s.classList.contains('folded') ? ':F' : '')), hero: document.getElementById('heroBet').textContent, acts: [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a) })) : '';
        const onResult = acts0.includes('next'); // hand over: blinds were swept to the winner, so 'missing chip' is not a committed bet any more
        const now = new Set(); for (const v of c.viol.filter(v => !(onResult && v.kind === 'missing chip'))) { const id = v.key + '|' + v.kind; now.add(id); streak.set(id, (streak.get(id) || 0) + 1); if (streak.get(id) === 1) r.raw++; if (streak.get(id) >= MINSTREAK) r.violations.push({ hand: h, ...v, snap }); if (n === 6 && vp.width === 360 && r.violations.length < 4) await p.screenshot({ path: path.join(shotsDir, `viol-${n}p-${vp.width}-h${h}-${v.key}.png`) }).catch(() => {}); }
        for (const id of [...streak.keys()]) if (!now.has(id)) streak.delete(id);
        if (!shot && n === 6 && vp.width === 360 && h < 4 && c.chips.length >= 3) { shot = true; await p.screenshot({ path: path.join(shotsDir, `tight-6p-360-h${h}.png`) }).catch(() => {}); }
        const acts = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
        if (acts.includes('next')) { if (++resultPolls >= 4) break; await sleep(150); continue; } // result screen is polled 4 times, stricter than the frozen run
        if (acts.some(x => ['fold', 'call', 'check'].includes(x))) { await sleep(120); const pick = acts.includes('check') ? 'check' : acts.includes('call') ? 'call' : 'fold'; await p.click(`#actions [data-a="${pick}"]`, { timeout: 2500 }).catch(() => {}); }
        await sleep(90);
      }
      r.hands++;
    } catch (e) { r.error = String(e.message).slice(0, 100); }
    await p.context().close().catch(() => {});
  }
  res.push(r);
}
const jobs = []; for (const n of SEATS) for (const vp of VIEWPORTS) jobs.push([n, vp]);
let k = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (k < jobs.length) { const [n, vp] = jobs[k++]; await combo(n, vp); } }));
await browser.close(); srv.close();
res.sort((x, y) => x.combo.localeCompare(y.combo));
let hands = 0, viol = 0; for (const r of res) { hands += r.hands; viol += r.violations.length; const u = [...new Set(r.violations.map(v => `${v.key} ${v.kind}`))]; console.log(`${r.combo}: hands ${r.hands} polls ${r.polls} chip-observations ${r.chips} violations ${r.violations.length} (raw single-poll sightings ${r.raw})${u.length ? '  ' + u.slice(0, 6).join('; ') : ''}${r.error ? '  ERR ' + r.error : ''}`); }
console.log(`TOTAL hands ${hands} violations ${viol}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ hands, violations: viol, res }, null, 1));
process.exit(viol ? 1 : 0);
