// Run-3 evidence for VAL-COACH-001: play to an orbit review, then do 3 consecutive calibration reps through "Next spot",
// dumping the question line, inputs, hint, explain before/after and the judgment containers still open.
//   node tools/calib-reps.js [--json out.json]
import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
import { startServer, launch, newPage, sleep } from './score/v2/lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--json'); const jsonOut = i > 0 ? process.argv[i + 1] : '';
const ORB = +(process.argv[process.argv.indexOf('--orbit') + 1] || 1) || 1;
const srv = await startServer(path.join(here, '..')), br = await launch();
const p = await newPage(br, srv.origin, { seed: 20261127 + 9, settings: { seats: 6, speed: 'fast', orbitReview: true, calibration: true }, timeout: 6000 });
await p.click('#modeCash'); const end = Date.now() + 150000; let got = false;
while (Date.now() < end && !got) {
  if (await p.evaluate(() => document.getElementById('panel')?.classList.contains('on'))) { const t = await p.$eval('#panelTitle', e => e.textContent).catch(() => ''); if (new RegExp('^Orbit ' + ORB).test(t) && await p.$('.calq')) { got = true; break; } await p.click('#panelClose').catch(() => {}); }
  const a = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
  if (a.includes('next')) await p.click('#actions [data-a="next"]').catch(() => {}); else if (a.length) await p.click(`#actions [data-a="${a.includes('check') ? 'check' : a.includes('call') ? 'call' : 'fold'}"]`).catch(() => {});
  await sleep(80);
}
if (!got) { console.log('no orbit review in 90 s'); process.exit(2); }
const snap = () => p.evaluate(() => { const c = document.querySelector('.calq[data-judgment]'); const all = [...document.querySelectorAll('.calq')];
  return { open_judgments: document.querySelectorAll('[data-judgment]').length, calq_total: all.length, spot: document.querySelector('.spot')?.innerText.replace(/\n/g, ' | '), next: document.querySelector('.next-spot')?.innerText,
    q: c && c.querySelector('p').innerText, inputs: c && c.querySelector('[data-coach=inputs]').innerText, method: c && c.querySelector('[data-coach=method]')?.innerText, hint_hidden: c && c.querySelector('[data-coach=hint]').hidden, hint: c && c.querySelector('[data-coach=hint]').innerText, explain: c && c.querySelector('[data-coach=explain]').innerText }; });
const reps = [];
for (let step = 0; step < 6; step++) {
  const before = await snap(); if (!before.q) break;
  await p.click('.calq[data-judgment] [data-coach="hint-toggle"]'); const hintShown = await p.evaluate(() => !document.querySelector('.calq[data-judgment] [data-coach=hint]').hidden);
  const cal0 = await p.evaluate(() => JSON.parse(localStorage.getItem('poker-coach-history-v1')).calib.n);
  const el = await p.$('.calq[data-judgment] .reveal'); await el.click(); await sleep(150);
  const after = await p.evaluate(() => { const c = [...document.querySelectorAll('.calq.answered')].pop(); return { explain: c.querySelector('[data-coach=explain]').innerText, res: c.querySelector('.calres').innerText, judgment_attr: c.hasAttribute('data-judgment'), open_judgments: document.querySelectorAll('[data-judgment]').length, continue_btn: document.querySelector('.next-q, .next-spot')?.innerText }; });
  const cal1 = await p.evaluate(() => JSON.parse(localStorage.getItem('poker-coach-history-v1')).calib.n);
  reps.push({ rep: reps.length + 1, before, hintShown, after, calib_n: [cal0, cal1] });
  const nx = await p.$('.next-q') || await p.$('.next-spot'); if (!nx) break; await nx.click(); await sleep(150);
}
console.log(JSON.stringify(reps, null, 1)); if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(reps, null, 1));
await br.close(); srv.close();
