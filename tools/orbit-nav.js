// Orbit review flow: pivotal spot + verdict, open a hand, Back keeps the review,
// reopen it later from Hands with answers kept; blind hands log real results.
import { createRequire } from 'module'; import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const srv = spawn('python3', ['-m', 'http.server', '8776', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
const p = await (await b.newContext({ viewport: { width: 393, height: 852 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://127.0.0.1:8776/'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.evaluate(() => { window.__poker.settings.speed = 'fast'; window.__poker.settings.seats = 3; });
await p.click('#modeCash');
const isOpen = () => p.evaluate(() => document.getElementById('panel').classList.contains('on'));
const title = () => p.$eval('#panelTitle', e => e.textContent);
let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
let reviewed = false;
for (let k = 0; k < 800 && !reviewed; k++) {
  if (await isOpen()) {
    const t = await title();
    if (t.startsWith('Orbit') && await p.$('.calq')) {
      console.log('spot:', (await p.$eval('.spot', e => e.innerText)).replace(/\n/g, ' | '));
      for (let g = 0; g < 4; g++) { const btn = await p.$('.calq .reveal:not([disabled])'); if (!btn) break; await btn.click(); await p.waitForTimeout(150); } // questions appear one at a time
      const verdict = await p.$eval('.verdict-box', e => e.innerText);
      console.log('verdict:', verdict);
      check(verdict.length > 10, 'verdict shown after both reveals');
      await p.screenshot({ path: 'shots/orbit-new.png' });
      await p.click('.hrow'); await p.waitForTimeout(400);
      check((await title()).startsWith('Hand'), 'tapping a hand opens its replay');
      check(await p.$eval('#panelBack', e => !e.hidden && getComputedStyle(e).display !== 'none'), 'Back button visible in replay');
      await p.click('#panelBack'); await p.waitForTimeout(300);
      check((await title()).startsWith('Orbit'), 'Back returns to the orbit review');
      check(await p.$$eval('.calq .reveal', es => es.every(e => e.disabled)), 'answers still revealed after Back');
      await p.click('#panelClose'); await p.waitForTimeout(400);
      await p.click('#backBtn'); await p.waitForTimeout(300);
      await p.click('#menuHands'); await p.waitForTimeout(400);
      await p.screenshot({ path: 'shots/hands-orbits.png' });
      await p.click('.orbit-head:not([disabled])'); await p.waitForTimeout(400);
      check((await title()).startsWith('Orbit'), 'orbit review reopens from Hands');
      check(await p.$$eval('.calq .reveal', es => es.length > 0 && es.every(e => e.disabled)), 'reopened review keeps answers');
      await p.click('#panelBack'); await p.waitForTimeout(300);
      check((await title()) === 'Hands', 'Back from the review returns to Hands');
      reviewed = true; break;
    }
    await p.click('#panelClose'); await p.waitForTimeout(300); continue;
  }
  const a = await p.evaluate(() => { const x = document.querySelector('#actions [data-a="next"]') || document.querySelector('#actions [data-a="call"]') || document.querySelector('#actions [data-a="check"]'); return x ? x.dataset.a : null; });
  if (!a) { await p.waitForTimeout(100); continue; }
  await p.click(`#actions [data-a="${a}"]`, { timeout: 2000 }).catch(() => {}); await p.waitForTimeout(60);
}
check(reviewed, 'reached an orbit review with questions');
const nets = await p.evaluate(() => JSON.parse(localStorage.getItem('poker-coach-history-v1')).hands.filter(h => h.pos === 'SB' || h.pos === 'BB').map(h => h.net / h.bb));
console.log('blind hand nets:', nets.join(', '));
check(nets.every(x => x !== 0), 'blind hands never show +0.0');
check(errs.length === 0, 'no page errors ' + (errs.length ? JSON.stringify(errs) : ''));
await b.close(); srv.kill();
process.exit(fails ? 1 : 0);
