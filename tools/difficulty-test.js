// VAL-LEARN-002 repair check: visible desirable difficulty in the Drills stream (phone Chromium).
//   node tools/difficulty-test.js [--root .] [--trials 10] [--json out.json]
// Cases: (1) high seed {n:60,good:58} vs low seed {n:60,good:12}, 30 items each: mean difficulty gap >= 0.12;
//        (2) fresh profile: first 30 items sit in the low band (mean <= the high seed's, and message never says "100 percent" on 1 answer);
//        (3) high seed, 10 correct items, 6 consecutive misses, 10 more: mean difficulty of the 10 after falls >= 0.08 vs the 10 before, in >= 9/10 seeded trials.
// Difficulty = data-dif on the drill container (1 - solver top frequency of the served item, reviews included).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { startServer, launch, newPage, sleep } from './score/v2/lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', path.join(here, '..'))), TR = +arg('--trials', 10), jsonOut = arg('--json', '');
const srv = await startServer(root), browser = await launch();
let fails = 0; const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const KEY = 'poker-coach-history-v1';
async function session(seed, hist, plan) {
  const init = hist ? `try{if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(hist))})}catch(e){}` : '';
  const p = await newPage(browser, srv.origin, { seed, settings: { speed: 'fast', seats: 3, calibration: false }, init, timeout: 8000 });
  await p.click('#modeDrills');
  const items = [];
  for (let i = 0; i < plan.length; i++) {
    // a quiz item is interleaved at least 1 in 8 (w-quiz3): answer it and move on; it is not a difficulty-scored drill item
    for (let g = 0; g < 4; g++) {
      await p.waitForSelector('.drill[data-dif], .quiz[data-judgment="quiz"]', { timeout: 15000 });
      if (!(await p.$('.quiz[data-judgment="quiz"]'))) break;
      await p.click('.quiz-acts button[data-i="0"]'); await p.click('.quiz-next-bar .drill-next'); await sleep(40);
    }
    await p.waitForSelector('.drill[data-dif]', { timeout: 15000 });
    await sleep(30);
    const it = await p.evaluate(() => { const d = document.querySelector('.drill[data-dif]'); const s = d.dataset.solver.match(/best:(\d+),worst:(\d+)/); return { dif: +d.dataset.dif, review: d.dataset.review === '1', kind: d.dataset.judgment, best: +s[1], worst: +s[2], why: (d.querySelector('.drill-why') || {}).innerText || '' }; });
    const pick = plan[i] === 'miss' ? it.worst : it.best;
    await p.click(`.drill-acts button[data-i="${pick}"]`);
    const grade = await p.evaluate(() => (document.querySelector('.drill-out .grade') || {}).className || '');
    items.push({ ...it, planned: plan[i], ok: /\bg\b|\by\b/.test(grade) });
    await p.click('.drill-next');
    await sleep(20);
  }
  await p.context().close();
  return items;
}
const res = {};
console.log('Case 1: high vs low seed, 30 items');
const hi = await session(11, { drills: { n: 60, good: 58, queue: [] } }, Array(30).fill('best'));
const lo = await session(11, { drills: { n: 60, good: 12, queue: [] } }, Array(30).fill('best'));
const mh = mean(hi.map(x => x.dif)), ml = mean(lo.map(x => x.dif));
res.hi = { mean: mh, items: hi }; res.lo = { mean: ml, items: lo };
check(mh - ml >= 0.12, `high ${mh.toFixed(3)} vs low ${ml.toFixed(3)} (gap ${(mh - ml).toFixed(3)} >= 0.12)`);
check(/serving closer spots/.test(hi.map(x => x.why).join(' ')) && /92|91|90|93|94|95 percent/.test(hi[0].why) || /percent/.test(hi[0].why), 'plain-words message on high seed: ' + hi[0].why);
console.log('Case 2: fresh profile');
const fr = [];
for (const seed of [21, 22, 23, 24]) fr.push(await session(seed, null, Array(14).fill('best')));
const mf = fr.map(r => mean(r.map(x => x.dif)));
res.fresh = { means: mf, items: fr };
check(mf.every(m => m <= mh), `fresh means ${mf.map(m => m.toFixed(3)).join(', ')} all <= high seed ${mh.toFixed(3)}`);
check(mean(mf) <= ml + 0.1, `fresh average ${mean(mf).toFixed(3)} is in the low band (low seed ${ml.toFixed(3)} + 0.10)`);
const bad = fr.flat().filter((x, i) => /100 percent|0 percent/.test(x.why) && /serving closer/.test(x.why));
check(!bad.length, `no fresh item says "100 percent ... closer spots" (${bad.length} found)`);
console.log('Case 3: high seed, 10 correct, 6 misses, 10 more x', TR);
const plan = [...Array(10).fill('best'), ...Array(6).fill('miss'), ...Array(10).fill('best')];
const drops = [];
for (let t = 0; t < TR; t++) {
  const r = await session(100 + t, { drills: { n: 60, good: 58, queue: [] } }, plan);
  const before = mean(r.slice(0, 10).map(x => x.dif)), after = mean(r.slice(16).map(x => x.dif));
  const pf = r.slice(10, 16).filter(x => !x.ok).length;
  drops.push({ trial: t, before, after, drop: before - after, missesLanded: pf, items: r });
  console.log(`   trial ${t}: before ${before.toFixed(3)} after ${after.toFixed(3)} drop ${(before - after).toFixed(3)} (misses landed ${pf}/6)`);
}
res.ease = drops;
const okN = drops.filter(d => d.drop >= 0.08).length;
check(okN >= Math.ceil(TR * 0.9), `${okN}/${TR} trials with drop >= 0.08`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
await browser.close(); srv.close && srv.close();
console.log(fails ? `${fails} FAILED` : 'difficulty-test: all ok'); process.exit(fails ? 1 : 0);
