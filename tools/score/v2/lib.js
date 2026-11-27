// Shared helpers for the v2 gauge: static server (ephemeral port), seeded mobile contexts, menu crawl.
// Scoring modules import this. page.evaluate is used only to read DOM/style/text and to seed storage/settings.
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
export const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.cwd(), 'x.js'));
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = createRequire(path.join(here, '../../../x.js'))('playwright-core')); }
export { chromium };

export const SETTINGS_KEY = 'poker-coach-v1'; // app's saved-state key (seeded, not read for scoring)
export const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
export const VIEWPORTS = [{ width: 390, height: 844 }, { width: 360, height: 740 }];
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Math.random seeded (mulberry32) so hands are reproducible; `seed` varies per hand.
export const seedScript = (seed) => `(() => { let a = ${seed | 0}; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;
// seeds saved settings before the app loads (only if no saved state exists)
export const settingsScript = (settings) => `try{if(!localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}))localStorage.setItem(${JSON.stringify(SETTINGS_KEY)},JSON.stringify({settings:${JSON.stringify(settings || {})}}))}catch(e){}`;

export function startServer(root) {
  root = path.resolve(root);
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      const f = path.join(root, path.normalize(u));
      if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
    });
    s.listen(0, '127.0.0.1', () => res({ server: s, origin: `http://127.0.0.1:${s.address().port}`, close: () => s.close() }));
  });
}

export async function launch() { return chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }); }

// New mobile+touch context+page. opts: {seed, viewport, settings, init, timeout, wait (selector), noGoto}
export async function newPage(browser, origin, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || VIEWPORTS[0], deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(seedScript(opts.seed ?? 12345));
  if (opts.settings) await ctx.addInitScript(settingsScript(opts.settings));
  if (opts.init) await ctx.addInitScript(opts.init);
  const p = await ctx.newPage(); p.setDefaultTimeout(opts.timeout || 8000);
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  if (!opts.noGoto) { await p.goto(origin + '/'); await p.waitForSelector(opts.wait || '#modeCash'); }
  return p;
}

export const guard = async (notes, name, fn, ms = 60000) => {
  let to; try { return await Promise.race([fn(), new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout ' + ms + 'ms')), ms); })]); }
  catch (e) { if (notes) notes['error_' + name] = String(e.message || e).slice(0, 200); return null; } finally { clearTimeout(to); }
};

// Menu crawl: click every visible button/[role=button]/a in #menu (depth 1), call visit(page,label) on the screen
// reached, then (depth 2) click buttons inside the opened panel, calling visit again. Returns screens visited.
// `fresh()` must return a page at the menu; the crawl reloads between items so state is clean.
export async function crawlMenu(page, visit, { depth = 2, maxItems = 14, maxSub = 6, settle = 350 } = {}) {
  const sel = 'button, [role=button], a[href]';
  const labelsOf = (scope) => page.evaluate(([scope, sel]) => [...document.querySelectorAll(scope + ' ' + sel)].filter(e => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && !e.disabled; }).map((e, i) => ({ i, id: e.id || '', text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30) })), [scope, sel]);
  const top = (await labelsOf('#menu')).slice(0, maxItems); const done = [];
  const url = page.url();
  for (const it of top) {
    if (it.id === 'modeCash') continue; // table is measured separately at the hero turn
    try {
      await page.goto(url); await page.waitForSelector('#modeCash'); await sleep(200);
      const btns = await page.$$('#menu ' + sel); const vis = []; for (const b of btns) if (await b.isVisible() && await b.isEnabled()) vis.push(b);
      const b = vis[it.i]; if (!b) continue;
      await b.click({ timeout: 3000 }); await sleep(settle);
      const name = 'crawl:' + (it.id || it.text); await visit(page, name); done.push(name);
      if (depth >= 2) {
        const subs = (await labelsOf('#panel')).filter(s => s.id !== 'panelClose' && s.id !== 'panelBack').slice(0, maxSub);
        for (const s of subs) {
          try {
            const pb = (await page.$$('#panel ' + sel)); const v2 = []; for (const x of pb) if (await x.isVisible() && await x.isEnabled()) v2.push(x);
            const t = v2.filter(x => true)[s.i]; if (!t) continue;
            await t.click({ timeout: 2000 }); await sleep(settle);
            const n2 = name + '>' + (s.id || s.text); await visit(page, n2); done.push(n2);
            await page.goto(url); await page.waitForSelector('#modeCash'); await sleep(150);
            await (await page.$('#menu ' + sel + ':nth-of-type(1)'))?.isVisible?.();
            const again = (await page.$$('#menu ' + sel)); const vv = []; for (const x of again) if (await x.isVisible() && await x.isEnabled()) vv.push(x);
            if (!vv[it.i]) break; await vv[it.i].click({ timeout: 3000 }); await sleep(settle);
          } catch {}
        }
      }
    } catch {}
  }
  return done;
}
