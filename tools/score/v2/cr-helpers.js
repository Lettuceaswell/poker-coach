// Private helpers for coaching.js / reach.js (UI-driven; page.evaluate only reads DOM or seeds storage).
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
export const HK = 'poker-coach-history-v1';
export const SEEDRNG = `(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;
export function serve(root) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      const f = path.join(root, path.normalize(u));
      if (!f.startsWith(path.resolve(root))) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}
export async function env(root, browser) {
  const server = await serve(path.resolve(root));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let own = null;
  if (!browser) {
    const require = createRequire(path.join(process.cwd(), 'x.js'));
    let chromium; try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = createRequire(path.join(here, '../../../x.js'))('playwright-core')); }
    browser = own = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  }
  const pages = [];
  // seed: object {key: jsonString} written to localStorage before app load (only if absent), rng seeded
  async function page(seed = {}, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true, serviceWorkers: 'block' });
    const p = await ctx.newPage(); p._ctx = ctx; pages.push(ctx);
    await p.addInitScript(SEEDRNG);
    const entries = Object.entries(seed);
    if (entries.length) await p.addInitScript((e) => { try { for (const [k, v] of e) if (!localStorage.getItem(k)) localStorage.setItem(k, v); } catch (x) {} }, entries);
    await p.goto(url); await p.waitForTimeout(opts.wait ?? 120);
    return p;
  }
  async function close() { for (const c of pages) await c.close().catch(() => {}); if (own) await own.close(); server.close(); }
  return { url, root: path.resolve(root), page, close };
}
// ---- DOM reads ----
export const visBtns = (p, scope = 'body') => p.evaluate((sc) => {
  const root = document.querySelector(sc) || document.body;
  const ok = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility && e.checkVisibility(); };
  return [...root.querySelectorAll('button, [role=button], select, input[type=range]')].filter(ok).map((e, i) => ({ i, t: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 40), tag: e.tagName }));
}, scope);
export async function clickNth(p, scope, i) {
  const h = await p.evaluateHandle(([sc, i]) => {
    const root = document.querySelector(sc) || document.body;
    const ok = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility && e.checkVisibility(); };
    return [...root.querySelectorAll('button, [role=button], select, input[type=range]')].filter(ok)[i];
  }, [scope, i]);
  const el = h.asElement(); if (!el) return false;
  await el.click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(250); return true;
}
export const bodyText = (p) => p.evaluate(() => document.body.innerText);
export const featureText = (p, name) => p.evaluate((n) => { const e = document.querySelector(`[data-feature="${n}"]`); return e && e.checkVisibility() ? e.innerText : null; }, name);
export const featuresVisible = (p) => p.evaluate(() => [...document.querySelectorAll('[data-feature]')].filter(e => e.checkVisibility() && e.getBoundingClientRect().height > 0).map(e => e.getAttribute('data-feature')));
export const nums = (s) => (s.match(/\d+(?:\.\d+)?/g) || []);
export const GATE = /unlock|upgrade|premium|paywall|subscribe|come back (later|tomorrow)|daily limit|limit reached|locked|pro only|go pro/i;
export const approx = (a, b, tol) => Math.abs(a - b) <= tol;
// Crawl menu once per root (cached): replay-able click paths (indices into visible buttons) reaching each [data-feature] and
// each [data-judgment] type ("j:<type>"). Pages run in parallel batches; a wall budget bounds it (unreached = absent = 0).
const CR = new Map();
export const judgmentsVisible = (p) => p.evaluate(() => [...document.querySelectorAll('[data-judgment]')].filter(e => e.checkVisibility() && e.getBoundingClientRect().height > 0).map(e => 'j:' + e.getAttribute('data-judgment')));
export function crawl(E, { budgetMs = 22000, maxTop = 9, maxSub = 6, conc = 6 } = {}) {
  if (CR.has(E.root)) return CR.get(E.root);
  const pr = (async () => {
    const found = {}; const t0 = Date.now(); const left = () => budgetMs - (Date.now() - t0);
    const rec = async (p, path) => { for (const f of [...await featuresVisible(p), ...await judgmentsVisible(p)]) if (!found[f]) found[f] = path; };
    const open = async (path) => { const p = await E.page(); for (const i of path) await clickNth(p, 'body', i); return p; };
    const p0 = await E.page(); const top = await visBtns(p0); await rec(p0, []); await p0._ctx.close();
    const jobs = []; for (let a = 0; a < Math.min(top.length, maxTop); a++) jobs.push(a);
    const one = async (a) => {
      if (left() <= 0) return; const p = await open([a]); await rec(p, [a]);
      const sub = await visBtns(p); await p._ctx.close();
      for (let b = 0; b < Math.min(sub.length, maxSub) && left() > 0; b++) { const q = await open([a, b]); await rec(q, [a, b]); await q._ctx.close(); }
    };
    let k = 0; await Promise.all(Array.from({ length: conc }, async () => { while (k < jobs.length && left() > 0) await one(jobs[k++]).catch(() => {}); }));
    found._ms = Date.now() - t0; return found;
  })();
  CR.set(E.root, pr); return pr;
}
export async function replay(E, path, seed) { const p = await E.page(seed); for (const i of path) await clickNth(p, 'body', i); return p; }
export const mixOf = (s) => { // parse "Action 63%" pairs
  const out = []; const re = /([A-Za-z][A-Za-z\-]*)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%/g; let m;
  while ((m = re.exec(s))) out.push({ a: m[1].trim(), f: +m[2] });
  return out;
};
