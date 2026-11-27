// Drives every coaching screen in a phone-sized Chromium and saves screenshots to shots/.
import { createRequire } from 'module'; import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const srv = spawn('python3', ['-m', 'http.server', '8774', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' });
const p = await (await b.newContext({ viewport: { width: 393, height: 852 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://127.0.0.1:8774/'); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.evaluate(() => { window.__poker.settings.speed = 'fast'; });
await p.click('#modeCash');
const shot = (n) => p.screenshot({ path: `shots/c-${n}.png` });
const got = {};
for (let k = 0; k < 500 && Object.keys(got).length < 6; k++) {
  if (await p.evaluate(() => document.getElementById('panel').classList.contains('on'))) {
    const title = await p.$eval('#panelTitle', e => e.textContent);
    if (title.startsWith('Orbit') && !got.orbit) {
      await p.waitForTimeout(400); await shot('orbit'); got.orbit = 1;
      const rv = await p.$('.calq .reveal');
      if (rv) { await rv.click(); await p.waitForTimeout(300); await shot('orbit-revealed'); }
      const row = await p.$('.hrow'); if (row) { await row.click(); await p.waitForTimeout(400); await shot('orbit-replay'); }
    }
    await p.click('#panelClose'); await p.waitForTimeout(350);
    continue;
  }
  const a = await p.evaluate(() => document.querySelector('#actions button[data-a]')?.dataset.a || null);
  if (!a) { await p.waitForTimeout(120); continue; }
  if (a === 'replay' || a === 'next') {
    if (!got.replay && await p.evaluate(() => window.__poker.game().result?.showdown)) {
      await p.click('#actions [data-a="replay"]'); await p.waitForTimeout(400);
      await p.click('.step-head').catch(() => {}); await p.waitForTimeout(300);
      await shot('replay'); got.replay = 1; await p.click('#panelClose'); await p.waitForTimeout(350);
    }
    await p.click('#actions [data-a="next"]'); continue;
  }
  const st = await p.evaluate(() => window.__poker.game().street);
  if (st === 'preflop' && !got.pre && await p.$('.why-btn')) {
    await p.click('.why-btn'); await p.waitForTimeout(500); await shot('coach-pre'); got.pre = 1;
    await p.click('#panelClose'); await p.waitForTimeout(350);
  } else if (st !== 'preflop' && !got.post && await p.$('.why-btn')) {
    await p.waitForTimeout(2500);
    await p.click('.why-btn'); await p.waitForTimeout(1500); await shot('coach-post'); got.post = 1;
    await p.click('#panelClose'); await p.waitForTimeout(350);
  } else if (!got.peek) {
    const seat = await p.$('.seat:not(.folded)');
    if (seat) { await seat.click(); await p.waitForTimeout(500); await shot('peek'); got.peek = 1; await p.click('#panelClose'); await p.waitForTimeout(350); }
  }
  // call/check down to reach showdowns
  const btn = await p.$(`#actions [data-a="${a}"]`); if (btn) await btn.click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(80);
}
// menu: drills, leaks, hands
await p.click('#backBtn'); await p.waitForTimeout(400); await shot('menu');
await p.click('#modeDrills'); await p.waitForTimeout(1200); await shot('drill');
await p.click('.drill-acts button'); await p.waitForTimeout(400); await shot('drill-answer');
await p.click('#panelClose'); await p.waitForTimeout(350);
await p.click('#menuLeaks'); await p.waitForTimeout(400); await shot('leaks'); await p.click('#panelClose'); await p.waitForTimeout(350);
await p.click('#menuHands'); await p.waitForTimeout(400); await shot('hands');
console.log('screens:', Object.keys(got).join(', '));
console.log('errors:', errs.length ? errs : 'none');
await b.close(); srv.kill();
