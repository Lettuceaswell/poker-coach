// Plays the app in a phone-sized browser and saves screenshots to shots/.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2000));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://127.0.0.1:8765/');
await p.evaluate(() => { localStorage.clear(); });
await p.reload();
await p.screenshot({ path: 'shots/00-menu.png' });
await p.evaluate(() => { window.__poker.settings.speed = 'fast'; });
await p.click('#modeCash');
const waitTurn = () => p.waitForSelector('#actions button[data-a="raise"], #actions button[data-a="call"], #actions button[data-a="check"]', { timeout: 30000 });
let n = 0;
const shot = async (name) => p.screenshot({ path: `shots/${String(++n).padStart(2, '0')}-${name}.png` });
await waitTurn(); await shot('hero-turn');
await p.click('#actions button[data-a="more"]').catch(() => {});
await p.waitForTimeout(400); await shot('raise-sheet');
await p.click('#sheetBg', { position: { x: 20, y: 20 } }); await p.waitForTimeout(300);
// play several hands calling/checking to see flops and showdowns
let showdown = false;
for (let k = 0; k < 120 && !showdown; k++) {
  await p.waitForFunction(() => document.querySelector('#actions button[data-a]'), null, { timeout: 30000 });
  const a = await p.$eval('#actions button[data-a]', e => e.dataset.a);
  if (a === 'next') {
    const sd = await p.evaluate(() => window.__poker.game().result?.showdown);
    if (sd) { await shot('showdown'); showdown = true; break; }
    await p.click('#actions button[data-a="next"]');
  } else {
    const st = await p.evaluate(() => window.__poker.game().street);
    if (st === 'flop' && n < 4) await shot('flop');
    await p.click(`#actions button[data-a="${a}"]`);
  }
  await p.waitForTimeout(150);
}
await p.click('#gearBtn'); await p.waitForTimeout(400); await shot('settings');
await p.click('.seg[data-key="fourColor"] button[data-v="true"]');
await p.click('.seg[data-key="seats"] button[data-v="4"]');
await p.click('#sheetBg', { position: { x: 20, y: 20 } });
await p.click('#actions button[data-a="next"]').catch(() => {});
await waitTurn(); await p.waitForTimeout(300); await shot('4color-4players');
console.log('errors:', errs.length ? errs : 'none');
await b.close(); srv.kill();
