// Live three-way river coaching (VAL-3WAY-004): node tools/live3-test.js [--root dir] [--out shots/w-live3d]
// Plays seeded hands (hero calls/checks everything so pots go multiway) until the hero reaches:
//   a 3-way TURN (status must say "estimate"), then three 3-way RIVER decisions:
//   S: solve lands -> mix as `Action NN%`, "No guarantee" label, ranges dumped (narrower than preflop), pick marked green (.rec);
//   T: budget forced to 1 ms -> panel keeps the labeled estimate (never blank), says the solve ran out of time;
//   W: swipe-to-fold on the 3-way river still folds.
// Writes <out>/live3-text.txt, live3-dump.json and screenshots.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = arg('--root', process.cwd()), outDir = arg('--out', 'shots/w-live3d');
fs.mkdirSync(outDir, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 300);
const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { stdio: 'ignore', cwd: root });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
let fails = 0; const text = [];
const ok = (c, name, info = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${name} ${info}`; text.push(l); console.log(l); if (!c) fails++; };
const note = (l) => { text.push(l); console.log(l); };

const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
let seed = +arg('--seed', 31);
await ctx.addInitScript((seed) => { let s = seed >>> 0; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, seed);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://127.0.0.1:${port}/`); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.evaluate(() => { const s = window.__poker.settings; s.speed = 'fast'; s.coach = 'always'; s.orbitReview = false; s.calibration = false; });
await p.click('#modeCash');

const state = () => p.evaluate(() => {
  const q = (x) => document.querySelector(x); const g = window.__poker.game();
  const live = g.players.filter(x => !x.folded && !x.out);
  const riverFold = g.history.some(h => h.street === 'river' && h.type === 'fold');
  const t3 = g.street === 'river' && g.board.length === 5 && live.length === 3 && !live.some(x => x.allIn) && !riverFold;
  const mode = q('#panel.on') ? 'panel' : q('#actions [data-a="next"]') ? 'next' : (q('#actions [data-a="call"]') || q('#actions [data-a="check"]')) ? 'act' : 'wait';
  return { mode, street: g.street, n: live.length, t3, hand: g.handNo };
});
const status = () => p.evaluate(() => document.getElementById('status').innerText.replace(/\s+/g, ' ').trim());
async function callAlong() {
  await p.evaluate(() => { const q = (x) => document.querySelector(x); if (q('#actions [data-a="check"]')) window.__poker.act('check'); else window.__poker.act('call'); });
}
const stages = ['turn', 'S', 'T', 'W'];
const dumpOut = {}; let stage = 0, guard = 0, lastHand = -1;
const t0 = Date.now();
while (stage < stages.length && Date.now() - t0 < 25 * 60 * 1000) {
  const s = await state();
  if (s.mode === 'next') { await p.evaluate(() => document.querySelector('#actions [data-a="next"]').click()); await p.waitForTimeout(60); continue; }
  if (s.mode === 'panel') { await p.evaluate(() => document.querySelector('#panelClose').click()); await p.waitForTimeout(60); continue; }
  if (s.mode !== 'act') { await p.waitForTimeout(80); continue; }
  const cs = await p.evaluate(() => { const c = window.__poker.coach(); return !!c && !c.loading && !!(c.mix || c.off); });
  if (!cs) { await p.waitForTimeout(80); continue; }
  const want = stages[stage];
  if (want === 'turn' && s.street === 'turn' && s.n === 3) {
    await p.waitForTimeout(300);
    const st = await status();
    ok(/estimate/i.test(st) && !/3-way solve,/.test(st), '3-way TURN shows the labeled estimate', `"${st}"`);
    await p.screenshot({ path: `${outDir}/turn-3way-estimate.png` });
    stage++;
  } else if (want === 'S' && s.t3) {
    await p.evaluate(() => { window.__poker.three.budget.ms = 10000; window.__poker.three.budget.iters = 80; });
    let landed = false; const ts = Date.now();
    while (Date.now() - ts < 40000) { landed = await p.evaluate(() => !!window.__poker.coach()?.three); if (landed) break; await p.waitForTimeout(100); }
    const st = await status(); const ms = Date.now() - ts;
    ok(landed, '3-way RIVER: solve landed and replaced the estimate', `${ms} ms after the decision opened; "${st}"`);
    ok(/No guarantee/.test(st), 'panel shows the "No guarantee" label');
    const mixTxt = await p.evaluate(() => window.__poker.coach().mix.filter(m => m.freq >= 0.005).map(m => `${m.label.replace(/ [\d.,]+$/, '')} ${Math.round(m.freq * 100)}%`).join('  '));
    const sum = [...mixTxt.matchAll(/(\d+)%/g)].reduce((a, m) => a + +m[1], 0);
    ok(/\w+ \d+%/.test(mixTxt) && Math.abs(sum - 100) <= 3, 'solver mix reads Action NN% and sums to ~100', `"${mixTxt}" sum ${sum}`);
    const green = await p.evaluate(() => { const r = document.querySelector('#actions .rec, #heroCards.rec'); return !!r; });
    ok(green, 'the coach pick is highlighted (rec/green) on the 3-way river');
    const dump = await p.evaluate(() => window.__poker.three.last().dump);
    dumpOut.dump = dump;
    ok(dump && dump.players.length === 3 && dump.players.every(x => x.narrowedCombos < x.preflopCombos || x.narrowedMass < x.preflopMass), 'dumped ranges are narrower than the preflop ranges', JSON.stringify(dump?.players.map(x => [x.pos, x.preflopCombos, x.narrowedCombos, x.solverCombos])));
    ok(dump && dump.budgetMs > 0 && dump.players.every(x => x.solverCombos <= 150), 'phone budget is a number and ranges are capped', `budget ${dump?.budgetMs} ms, ${dump?.iters} iterations`);
    note(`spot: board ${await p.evaluate(() => window.__poker.three.last().dump.board.join(','))}, river actions so far ${JSON.stringify(dump.acts)}, pot ${dump.pot} BB, stack ${dump.stack} BB`);
    await p.screenshot({ path: `${outDir}/river-3way-solve.png` });
    await p.evaluate(() => { window.__poker.three.budget.ms = 1; }); // the next 3-way river decision gets a 1 ms budget
    stage++;
  } else if (want === 'T' && s.t3) {
    let st = '', timedOut = false; const ts = Date.now();
    while (Date.now() - ts < 12000) { st = await status(); timedOut = /ran out of time/.test(st); if (timedOut) break; await p.waitForTimeout(100); }
    ok(timedOut && /estimate/i.test(st) && st.length > 20, '3-way RIVER on timeout: panel shows the labeled estimate (not blank)', `"${st}"`);
    const hasPick = await p.evaluate(() => { const c = window.__poker.coach(); return !!(c && c.mix && c.mix.length && c.pick); });
    ok(hasPick, 'timeout panel still has a mix and a pick');
    await p.screenshot({ path: `${outDir}/river-3way-timeout.png` });
    await p.evaluate(() => { window.__poker.three.budget.ms = 10000; });
    stage++;
  } else if (want === 'W' && s.t3) {
    const box = await p.evaluate(() => { const r = document.getElementById('heroCards').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x, box.y - 60, { steps: 4 }); await p.mouse.move(box.x, box.y - 140, { steps: 4 }); await p.mouse.up();
    let folded = false; const ts = Date.now();
    while (Date.now() - ts < 4000) { folded = await p.evaluate(() => window.__poker.game().players.find(x => x.isHero).folded); if (folded) break; await p.waitForTimeout(100); }
    ok(folded, 'swipe-to-fold still folds on the 3-way river');
    stage++;
    continue;
  } else {
    guard++;
  }
  if (stage < stages.length || true) await callAlong();
  await p.waitForTimeout(60);
}
ok(stage === stages.length, 'reached every scripted spot', `stage ${stage}/${stages.length}`);
ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
fs.writeFileSync(`${outDir}/live3-text.txt`, text.join('\n') + '\n');
fs.writeFileSync(`${outDir}/live3-dump.json`, JSON.stringify(dumpOut, null, 1));
await b.close(); srv.kill();
console.log(fails ? `${fails} FAIL` : 'live3: all pass');
process.exit(fails ? 1 : 0);
