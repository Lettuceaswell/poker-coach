// Run-3 harness for VAL-LEGIB-002: at every lap end of the position ripple (3 laps on a new hand, 2 laps for the later run)
// every seat circle must be lit at the same moment, and after the last lap only the button stays lit.
// A requestAnimationFrame logger reads computed style (same lit rule as the frozen v2 sampler in tools/score/v2/legibility.js)
// and a screenshot is taken the moment all seats are lit (lap end) and after the ripple; the lit state per seat is printed beside each shot.
//   node tools/ripple-shots.js [--root .] [--shots shots/w-table1/ripple] [--json out.json] [--combos 3@390,4@390,5@390,6@390,6@360]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { startServer, launch, newPage, sleep } from './score/v2/lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', path.join(here, '..'))), shots = arg('--shots', path.join(here, '../shots/w-table1/ripple')), jsonOut = arg('--json', '');
const combos = arg('--combos', '3@390,4@390,5@390,6@390,6@360').split(',').map(s => { const [n, w] = s.split('@').map(Number); return { n, vp: w === 390 ? { width: 390, height: 844 } : { width: 360, height: 740 } }; });
fs.mkdirSync(shots, { recursive: true });
const LOGGER = (n) => {
  window.__rp = { t0: performance.now(), rows: [] };
  const par = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const lit = (e) => { const cs = getComputedStyle(e); const b = par(cs.borderTopColor); let mx = 0; for (const m of (cs.boxShadow || '').match(/rgba?\([^)]*\)/g) || []) mx = Math.max(mx, par(m)[3]);
    if ((e.textContent || '').trim() === 'BTN') return mx >= 0.5 ? 1 : 0; return (b[3] * (b[0] + b[1] + b[2]) / 3 >= 100 || mx >= 0.5) ? 1 : 0; };
  window.__rpState = () => { const els = [...document.querySelectorAll('#seats .seat')].map(s => [s.querySelector('.pos')]); els.push([document.getElementById('heroPos')]);
    const out = {}; for (const [e] of els) if (e) out[(e.textContent || '').trim()] = lit(e);
    const b = els.map(x => x[0]).find(e => e && (e.textContent || '').trim() === 'BTN'); if (b) { const c = par(getComputedStyle(b).backgroundColor); out._btnBg = Math.round((c[0] + c[1] + c[2]) / 3 * c[3]); } return out; };
  const tick = () => { const st = window.__rpState(); window.__rp.rows.push({ t: Math.round(performance.now() - window.__rp.t0), lit: st }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
const srv = await startServer(root), browser = await launch(); const out = [];
const dec = await (await browser.newContext()).newPage(); await dec.goto('about:blank');
// brightness of each circle's ring pixel in the screenshot itself (decoded in a scratch page), so the claim does not rest on computed style alone
async function ringPx(p, buf) {
  const rects = await p.evaluate(() => [...document.querySelectorAll('#seats .seat .pos, #heroPos')].map(e => { const r = e.getBoundingClientRect(); return { k: e.textContent.trim(), x: r.left + 1.5, y: r.top + r.height / 2 }; }));
  return dec.evaluate(async ([b64, rects]) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const o = {}; for (const r of rects) { let m = 0; for (let dx = -1; dx <= 3; dx++) { const d = g.getImageData(Math.round(r.x + dx), Math.round(r.y), 1, 1).data; m = Math.max(m, Math.round((d[0] + d[1] + d[2]) / 3)); } o[r.k] = m; } return o; }, [buf.toString('base64'), rects]);
}
for (const { n, vp } of combos) {
  const tag = `${n}p-${vp.width}`; const r = { combo: `${n} seats @${vp.width}x${vp.height}`, laps: [], after: null, pass: false, notes: [] };
  const p = await newPage(browser, srv.origin, { seed: 20261127 + n * 1000 + vp.width + 3, viewport: vp, settings: { seats: n, speed: 'fast', coach: 'off', orbitReview: false, calibration: false }, timeout: 6000 });
  await p.evaluate(LOGGER, n); await p.click('#modeCash');
  const t0 = Date.now(); let seen = 0, wasAll = false, lastAllAt = 0, lastAny = 0, afterDone = false;
  const total = 3 + 2; // laps expected before the "after" shot
  while (Date.now() - t0 < 26000 && !afterDone) {
    const st = await p.evaluate(() => window.__rpState()); const keys = Object.keys(st).filter(k => k[0] !== '_'); const all = keys.length === n && keys.every(k => st[k] === 1); const any = keys.some(k => k !== 'BTN' && st[k] === 1);
    if (any) lastAny = Date.now();
    if (all && !wasAll) { seen++; const f = `${tag}-lap-end-${seen}.png`; await sleep(250); // mid-hold: a headless screenshot can lag the style clock by a few hundred ms
    const ts = Date.now(); const stB = await p.evaluate(() => window.__rpState()); const buf = await p.screenshot({ path: path.join(shots, f), animations: 'allow' }); const px = await ringPx(p, buf); const shotMs = Date.now() - ts; const st2 = await p.evaluate(() => window.__rpState()); r.laps.push({ lap: seen, shot: f, shotMs, litBefore: stB, lit: st2, ringPixel: px, allLit: Object.entries(st2).every(([k, v]) => k[0] === '_' || v === 1) }); lastAllAt = Date.now(); }
    wasAll = all;
    // ripple over once no non-button seat has been lit for 1.5 s after >= 1 lap and the second run (>= 4 laps) is done, or 20 s passed
    if (seen >= total && Date.now() - lastAny > 1500) { await sleep(300); const f = `${tag}-after.png`; await p.screenshot({ path: path.join(shots, f) }); const st3 = await p.evaluate(() => window.__rpState()); r.after = { shot: f, lit: st3, onlyButton: Object.entries(st3).every(([k, v]) => k === 'BTN' || k[0] === '_' || v === 0) && st3._btnBg > 200 }; afterDone = true; }
    await sleep(15);
  }
  if (!afterDone) { const st3 = await p.evaluate(() => window.__rpState()); await sleep(1600); const st4 = await p.evaluate(() => window.__rpState()); const f = `${tag}-after.png`; await p.screenshot({ path: path.join(shots, f) }); r.after = { shot: f, lit: st4, onlyButton: Object.entries(st4).every(([k, v]) => k === 'BTN' || k[0] === '_' || v === 0) && st4._btnBg > 200 }; r.notes.push(`only ${seen} lap ends seen in 26 s`); }
  // between the runs (after lap 3) only the button should be lit too: look at the logger timeline
  const rows = await p.evaluate(() => window.__rp.rows); const lapRise = []; let prev = false; for (const row of rows) { const all = Object.keys(row.lit).filter(k => k[0] !== '_').length === n && Object.entries(row.lit).every(([k, v]) => k[0] === '_' || v === 1); if (all && !prev) lapRise.push(row.t); prev = all; }
  r.lapEndTimesMs = lapRise; r.pass = r.laps.length === total && r.laps.every(l => l.allLit && Object.values(l.ringPixel).every(v => v >= 120)) && !!r.after?.onlyButton;
  if (r.laps.length !== total) r.notes.push(`expected ${total} lap ends (3 new-hand + 2 later), saw ${r.laps.length}`);
  out.push(r); await p.context().close();
  console.log(`${r.combo}: ${r.pass ? 'PASS' : 'FAIL'}  lap ends ${r.laps.length}/${total} all-lit ${r.laps.filter(l => l.allLit).length}; after only-button ${r.after?.onlyButton}  lapEnds(ms) ${lapRise.join(',')}  ${r.notes.join('; ')}`);
  for (const l of r.laps) console.log(`   ${l.shot}  lit ${JSON.stringify(l.lit)}  ringPixel ${JSON.stringify(l.ringPixel)}`); console.log(`   ${r.after?.shot}  ${JSON.stringify(r.after?.lit)}`);
}
await browser.close(); srv.close();
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
process.exit(out.every(r => r.pass) ? 0 : 1);
