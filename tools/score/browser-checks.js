// Browser half of the gauge: learning design (40) + rules checks that need a real page.
// FROZEN-style module: drives the app only through taps; never edits app code.
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.cwd(), 'x.js'));
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = createRequire(path.join(here, '../../x.js'))('playwright-core')); }

const SUB = 40 / 9;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const HK = 'poker-coach-history-v1';
const SEED = `(() => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;
const exemptFile = path.join(here, 'fixtures/green-exempt.json');
const EX = JSON.parse(fs.readFileSync(exemptFile, 'utf8'));
const EX_SHA = crypto.createHash('sha256').update(fs.readFileSync(exemptFile)).digest('hex');

function serve(root, port) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      const f = path.join(root, path.normalize(u));
      if (!f.startsWith(path.resolve(root))) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
    });
    s.listen(port || 0, '127.0.0.1', () => res(s));
  });
}

// ---- in-page helpers (serialised into the page) ----
const SCAN = (cfg) => {
  const hsl = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); if (a < 0.15) return null;
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn; if (!d) return null;
    const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h = (h * 60 + 360) % 360; return { h, s, l }; };
  const green = (c) => { const x = hsl(c); return x && x.h >= 90 && x.h <= 160 && x.s > 0.35 && x.l >= 0.2 && x.l <= 0.8; };
  const sel = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '');
  const isPick = (e) => cfg.pick.some(s => { try { return e.matches(s); } catch { return false; } });
  const isEx = (e) => cfg.exempt.some(x => { try { return e.matches(x.selector); } catch { return false; } });
  const viol = [], picks = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (!(r.width > 0 && r.height > 0) || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const found = [];
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (own && green(cs.color)) found.push(['color', cs.color]);
    if (green(cs.backgroundColor)) found.push(['background', cs.backgroundColor]);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none' && green(cs['border' + side + 'Color'])) { found.push(['border', cs['border' + side + 'Color']]); break; }
    if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none' && green(cs.outlineColor)) found.push(['outline', cs.outlineColor]);
    for (const m of (cs.boxShadow || '').match(/rgba?\([^)]*\)/g) || []) if (green(m)) { found.push(['shadow', m]); break; }
    for (const m of (cs.backgroundImage || '').match(/rgba?\([^)]*\)/g) || []) if (green(m)) { found.push(['gradient', m]); break; }
    if (e instanceof SVGElement) { if (cs.fill !== 'none' && green(cs.fill)) found.push(['fill', cs.fill]); if (cs.stroke !== 'none' && green(cs.stroke)) found.push(['stroke', cs.stroke]); }
    for (const f of found) { const o = { sel: sel(e), prop: f[0], color: f[1], text: (e.innerText || '').slice(0, 24) }; if (isPick(e)) picks.push(o); else if (!isEx(e)) viol.push(o); }
  }
  return { viol, picks };
};

export async function runBrowserChecks({ root, port } = {}) {
  root = path.resolve(root || process.cwd());
  const t0 = Date.now();
  const server = await serve(root, port);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const hosts = new Set(), badReqs = [];
  const out = { learning: { total: 0, max: 40, subs: [] }, rules: { points: 0, max: 12, subs: [] }, vetoes: [], notes: { origin, exemptSha256: EX_SHA, seconds: 0 } };
  const L = {}; // learning sub results by name
  const setL = (name, frac, observed) => { L[name] = { name, points: +(Math.max(0, Math.min(1, frac)) * SUB).toFixed(3), max: +SUB.toFixed(3), observed }; };
  const R = {};
  const setR = (name, frac, max, observed) => { R[name] = { name, points: +(Math.max(0, Math.min(1, frac)) * max).toFixed(3), max, observed }; };
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const newPage = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await ctx.addInitScript(SEED);
    if (init) await ctx.addInitScript(init);
    ctx.on('request', (rq) => { try { const u = new URL(rq.url()); if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return; hosts.add(u.host); if (u.origin !== origin) badReqs.push(rq.url()); } catch {} });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto(origin + '/'); await p.waitForSelector('#modeCash');
    return p;
  };
  const guard = async (name, fn) => { try { return await fn(); } catch (e) { out.notes['error_' + name] = String(e.message || e).slice(0, 200); return null; } };
  const green = { viol: [], pickSeen: false, screens: [] };
  const emoji = new Set(); let bgInfo = null;
  const scan = async (p, screen) => {
    const r = await p.evaluate(SCAN, { pick: EX.pick, exempt: EX.exempt });
    green.screens.push(screen); green.viol.push(...r.viol.map(v => ({ ...v, screen })));
    if (r.picks.length && /table|coach/.test(screen)) green.pickSeen = true;
    const txt = await p.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[title]')].map(e => e.getAttribute('aria-label') || e.title).join('\n'));
    for (const m of txt.replace(/[♠♥♦♣]/gu, '').match(/\p{Extended_Pictographic}/gu) || []) emoji.add(m + '@' + screen);
    if (!bgInfo) bgInfo = await p.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor, h = getComputedStyle(document.documentElement).backgroundColor; return { body: c, html: h }; });
  };
  const ls = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), HK);
  const panelOn = (p) => p.evaluate(() => document.getElementById('panel').classList.contains('on'));
  const idOf = (it) => it.spot + '|' + it.cards.replace(/[♠♥♦♣]/gu, '');
  const keyOfLabel = (l) => { const pos = l.split(' · ')[0]; return /folded to you/.test(l) ? pos + ' first in' : /opens/.test(l) ? pos + ' vs open' : pos + ' vs 3-bet'; };
  // ---- drill primitives ----
  const drillOpen = async (p) => { await p.click('#modeDrills'); await p.waitForSelector('.drill-acts button:not([disabled])', { timeout: 25000 }); };
  const drillItem = (p) => p.evaluate(() => ({ spot: document.querySelector('.drill-spot')?.textContent || '', cards: [...document.querySelectorAll('.drill-cards .card')].map(c => c.innerText.replace(/\s/g, '')).join(''), n: document.querySelectorAll('.drill-acts button').length, labels: [...document.querySelectorAll('.drill-acts button')].map(b => b.textContent), outBefore: (document.querySelector('.drill-out')?.innerText || '').trim(), gradeBefore: !!document.querySelector('.drill .grade'), board: !!document.querySelector('.drill .board, .drill-board, .drill .boardcards') || document.querySelectorAll('.drill-cards .card').length > 2, panelBefore: document.getElementById('panelBody').innerText }));
  const drillAnswer = async (p, i) => {
    const before = (await ls(p)).drills || { n: 0, good: 0 };
    const pre = await p.evaluate(() => document.getElementById('panelBody').innerText + '|' + [...document.querySelectorAll('#panelBody *')].map(e => e.className).join(' '));
    await p.click(`.drill-acts button[data-i="${i}"]`); await p.waitForSelector('.drill-next', { timeout: 5000 });
    const after = (await ls(p)).drills;
    const o = await p.evaluate(() => ({ text: document.getElementById('panelBody').innerText, cls: [...document.querySelectorAll('#panelBody *')].map(e => e.className).join(' '), out: document.querySelector('.drill-out')?.innerText || '', grade: document.querySelector('.drill .grade')?.textContent || '' }));
    const mixM = o.out.split('\n')[0].split(':').slice(1).join(':').match(/(\d+)%/g) || [];
    const mx = mixM.length ? Math.max(...mixM.map(x => parseInt(x))) : null;
    const rew = /streak|combo|\bxp\b|reward|level|confetti|burst|sparkle|cheer|mastered|in a row|points?\b/i;
    const newReward = (rew.test(o.text + ' ' + o.cls) && !rew.test(pre));
    return { good: after.good > before.good, grade: o.grade, text: o.text, out: o.out, diff: mx == null ? null : 1 - mx / 100, reward: newReward, queue: (after.queue || []).length };
  };
  const drillNext = async (p) => { const sp = await p.evaluate(() => document.querySelector('.drill-spot')?.textContent + document.querySelector('.drill-cards')?.innerText); await p.click('.drill-next'); await p.waitForSelector('.drill-acts button:not([disabled])'); await p.waitForTimeout(30); return sp; };
  let seedAnswerPick = 0; const pickIdx = (n) => { seedAnswerPick = (seedAnswerPick * 7 + 3) % 11; return seedAnswerPick % n; };

  // ========== TABLE page: swipe, results wait, green, calibration, leaks, session 1 ==========
  const tableRun = async () => {
    const p = await newPage();
    await p.evaluate(() => { window.__poker.settings.speed = 'fast'; window.__poker.settings.seats = 3; });
    await scan(p, 'menu');
    await p.click('#modeCash');
    const st = { swipe: null, wait: null, calib: [], hands: 0, orbitSeen: 0, hitRateShown: false, panels: new Set() };
    const end = Date.now() + 55000;
    const hero = () => p.evaluate(() => { const g = window.__poker.game(); const h = g.players.find(x => x.isHero); return { folded: h.folded, over: g.handOver, cards: JSON.stringify(h.cards) }; });
    const acts = () => p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
    while (Date.now() < end && !(st.swipe && st.wait && st.orbitSeen >= 2 && st.hands >= 8)) {
      if (await panelOn(p)) {
        const title = await p.$eval('#panelTitle', e => e.textContent);
        if (!st.panels.has(title.split(' ')[0])) { st.panels.add(title.split(' ')[0]); await guard('scan_' + title, () => scan(p, 'coach-' + title.split(' ')[0])); }
        if (title.startsWith('Orbit') && await p.$('.calq')) {
          st.orbitSeen++;
          const info = await p.$eval('.calq', () => document.getElementById('panelBody').innerText);
          if (/caught the truth/i.test(info) && /\d+%/.test(info)) st.hitRateShown = true;
          const n0 = (await ls(p)).calib?.n || 0;
          for (const b of await p.$$('.calq .reveal:not([disabled])')) { await b.click(); await p.waitForTimeout(100); }
          st.calib.push({ n0, n1: (await ls(p)).calib?.n || 0 });
          await scan(p, 'coach-Orbit-revealed');
        }
        await p.click('#panelClose'); await p.waitForTimeout(250); continue;
      }
      const a = await acts();
      if (!a.length) { await p.waitForTimeout(100); continue; }
      if (a.includes('next')) {
        st.hands++;
        if (!st.wait) {
          const h0 = await hero(); const n0 = ((await ls(p)).hands || []).length; const t1 = Date.now();
          await p.waitForTimeout(5500);
          const h1 = await hero(); const n1 = ((await ls(p)).hands || []).length; const still = (await acts()).includes('next');
          st.wait = { waitedMs: Date.now() - t1, stillResult: still && h1.over && h1.cards === h0.cards && n1 === n0 };
          await scan(p, 'table-result');
        }
        await p.click('#actions [data-a="next"]', { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(80); continue;
      }
      const heroTurn = a.some(x => ['fold', 'call', 'check', 'raise'].includes(x));
      if (heroTurn && !green.pickSeen) { await p.waitForTimeout(500); await scan(p, 'table-heroturn'); }
      if (heroTurn && !st.swipe && (await hero()).folded === false) {
        const box = await p.$eval('#heroCards', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const cdp = await p.context().newCDPSession(p);
        const tp = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x, y }] });
        await tp('touchStart', box.y); for (let k = 1; k <= 6; k++) { await tp('touchMove', box.y - 30 * k); await p.waitForTimeout(20); } await tp('touchEnd', box.y - 180);
        let folded = false; for (let k = 0; k < 25 && !folded; k++) { await p.waitForTimeout(120); folded = (await hero()).folded === true; }
        st.swipe = { folded }; await cdp.detach(); continue;
      }
      // after the swipe test: call/check preflop (loose play seeds real leaks), fold postflop to keep hands quick
      const street = await p.evaluate(() => window.__poker.game().street);
      const pick = !st.swipe ? (a.includes('check') ? 'check' : a.includes('call') ? 'call' : a[0]) : street !== 'preflop' && a.includes('fold') ? 'fold' : a.includes('raise') ? 'raise' : a.includes('check') ? 'check' : a.includes('call') ? 'call' : a[0];
      await p.click(`#actions [data-a="${pick}"]`, { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(60);
    }
    st.leaks = Object.keys((await ls(p)).leaks || {}).length; out.notes.table = { hands: st.hands, leaks: st.leaks, logged: ((await ls(p)).hands || []).length, orbits: st.orbitSeen };
    // ---- calibration points ----
    const c = st.calib; const inter = c.some(x => x.n1 > x.n0);
    setL('calibration', (inter ? 0.5 : 0) + (inter && st.hitRateShown ? 0.5 : 0), `orbit reviews seen=${st.orbitSeen}; reveals raised calib.n=${inter}; hit-rate text shown on later review=${st.hitRateShown}`);
    // ---- rules: swipe, wait ----
    if (!st.swipe) setR('swipe-to-fold', 0, 2, 'no hero turn observed');
    else { setR('swipe-to-fold', st.swipe.folded ? 1 : 0, 2, `touch swipe up on #heroCards folded=${st.swipe.folded}`); if (!st.swipe.folded) out.vetoes.push('swipe'); }
    if (!st.wait) setR('results-wait-for-tap', 0, 2, 'no hand result observed');
    else { setR('results-wait-for-tap', st.wait.stillResult ? 1 : 0, 2, `waited ${st.wait.waitedMs} ms; result + same hand still shown=${st.wait.stillResult}`); if (!st.wait.stillResult) out.vetoes.push('auto-advance'); }
    // ---- leaks screen + deliberate practice (session 1 end) ----
    await guard('leaks', async () => {
      await p.reload(); await p.waitForSelector('#menuLeaks'); await p.waitForTimeout(300);
      await p.click('#menuLeaks'); await p.waitForTimeout(400); await scan(p, 'coach-Leaks'); await p.click('#panelClose'); await p.waitForTimeout(300);
    });
    const leakKeys = Object.keys((await ls(p)).leaks || {}).map(k => k.split('|')[0]);
    const top = Object.values((await ls(p)).leaks || {}).sort((a, b) => (b.ev || b.cost) - (a.ev || a.cost)).slice(0, 6).map(l => l.key.split('|')[0]);
    await guard('deliberate', async () => {
      if (!top.length) { setL('deliberate practice', 0, 'no leaks seeded by play (inconclusive)'); return; }
      await drillOpen(p); let inLeak = 0, tot = 0; const labs = [];
      for (let i = 0; i < 20; i++) { const it = await drillItem(p); labs.push(it.spot); tot++; if (top.includes(keyOfLabel(it.spot))) inLeak++; await drillAnswer(p, pickIdx(it.n)); await drillNext(p); }
      const share = inLeak / tot; const rand = new Set(labs).size;
      setL('deliberate practice', share >= 0.5 ? 1 : share >= 0.3 ? 0.5 : 0, `top leak spots=${top.join(', ')}; ${inLeak}/${tot} drill items in leak spots (share ${share.toFixed(2)}; full>=0.5, half>=0.3)`);
    });
    // ---- session 2: reload, drill a bit, look for progress-over-time screen ----
    await guard('progress', async () => {
      await p.reload(); await p.waitForSelector('#modeDrills');
      await drillOpen(p); for (let i = 0; i < 4; i++) { const it = await drillItem(p); await drillAnswer(p, pickIdx(it.n)); await drillNext(p); }
      await p.click('#panelClose'); await p.waitForTimeout(300);
      const chartSel = 'svg polyline, svg path, canvas, .spark, .trend, .chart, [class*=trend], [class*=spark], [class*=chart]';
      const found = []; let sessions = 0;
      const look = async (name) => { const r = await p.evaluate((cs) => { const root = document.getElementById('panelBody'); const t = (document.getElementById('panel').classList.contains('on') ? root : document.getElementById('menu')); const txt = t.innerText; return { txt, chart: [...t.querySelectorAll(cs)].filter(e => !e.closest('button, .icon-btn, .mode, .grab')).length, trendTxt: /trend|over time|per session|by session|session \d|last \d+ (sessions|days)|this week|today vs|vs last/i.test(txt), pct: /\d+\s*%/.test(txt), bb: /\bBB\b/.test(txt) }; }, chartSel); if ((r.chart || r.trendTxt) && (r.pct || r.bb)) found.push(name); await scan(p, 'coach-' + name); };
      await look('menu');
      for (const [id, nm] of [['#menuLeaks', 'Leaks'], ['#menuHands', 'Hands']]) { await p.click(id); await p.waitForTimeout(400); await look(nm); await p.click('#panelClose'); await p.waitForTimeout(300); }
      await p.click('#menuSettings'); await p.waitForTimeout(300); const stx = await p.$eval('#sessionStats', e => e.innerText).catch(() => ''); if (/trend|over time|session \d/i.test(stx)) found.push('Settings');
      setL('visible measured progress over time', found.length ? 1 : 0, `2 sessions seeded (play+drills, reload, drills); screens with a trend/chart plus accuracy/BB figures: ${found.join(', ') || 'none'}`);
    });
    return p;
  };

  // ========== DRILL page: retrieval, spaced repetition, feedback, interleaving, dopamine, drill wait ==========
  const drillRun = async () => {
    const p = await newPage();
    await scan(p, 'menu-d');
    await drillOpen(p);
    const seq = [], items = []; let firstMissAt = -1, reveals = 0, askFirst = true, bbSeen = 0, gradeSeen = 0, answers = 0, postflop = false, waitRes = null;
    const rewC = [], rewW = [];
    for (let i = 0; i < 48; i++) {
      const it = await drillItem(p); items.push(it);
      if (it.outBefore || it.gradeBefore || /\b(Best|Good|Mistake)\b/.test(it.panelBefore)) askFirst = false;
      if (it.board || /flop|turn|river|board/i.test(it.spot)) postflop = true;
      if (i === 0) await scan(p, 'drill-question');
      const idx = pickIdx(it.n); const r = await drillAnswer(p, idx); answers++;
      if (i === 0) await scan(p, 'drill-answer');
      if (/-?\d+(\.\d+)?\s*(BB|bb)\b/.test(r.out) || /EV|cost|lost/i.test(r.out) && /\d/.test(r.out)) bbSeen++;
      if (r.grade) gradeSeen++;
      (r.good ? rewC : rewW).push(r.reward);
      seq.push({ id: idOf(it), good: r.good, diff: r.diff, spot: it.spot });
      if (!r.good && firstMissAt < 0) firstMissAt = i;
      if (i === 2) { const sp0 = await p.evaluate(() => document.querySelector('.drill-spot').textContent); const t1 = Date.now(); await p.waitForTimeout(5500); const same = await p.evaluate((s) => document.querySelector('.drill-spot')?.textContent === s && !!document.querySelector('.drill-next') && !!document.querySelector('.drill-out')?.innerText.trim(), sp0); waitRes = { waitedMs: Date.now() - t1, same }; }
      await drillNext(p);
      if (firstMissAt >= 0 && i - firstMissAt >= 22) break;
    }
    // retrieval
    setL('retrieval practice', (askFirst && answers ? 0.5 : 0) + (postflop && gradeSeen ? 0.5 : 0), `drill asks before reveal (no grade/mix before the tap)=${askFirst}, answers=${answers}; postflop drill spots seen=${postflop} (preflop-only = half marks)`);
    // spaced repetition
    const gaps = (pred) => seq.map((s, i) => { if (!pred(s)) return null; const j = seq.findIndex((t, k) => k > i && t.id === s.id); return j < 0 ? null : j - i; }).filter(x => x != null);
    const misses = seq.filter(s => !s.good).length, mg = gaps(s => !s.good), cg = gaps(s => s.good);
    const minM = mg.length ? Math.min(...mg) : Infinity, minC = cg.length ? Math.min(...cg) : Infinity;
    let sr = 0; if (misses && mg.length) sr = (minM <= 8 && minM < minC) ? 1 : minM <= 20 ? 0.5 : 0;
    setL('spaced repetition', sr, `drill sequence ${seq.map((s, i) => `${i}${s.good ? '+' : '-'}`).join(' ')}; misses=${misses}; missed-spot reappear gaps=[${mg}], correct-spot gaps=[${cg}] (full: a miss returns within 8 items and sooner than any correct spot)`);
    // feedback
    setL('immediate specific feedback in BB', bbSeen >= Math.ceil(answers * 0.8) ? 1 : gradeSeen ? 0.5 : 0, `answers=${answers}; with grade=${gradeSeen}; with BB/EV number=${bbSeen} (full: BB cost/EV on >=80% of answers; half: graded + solver mix, no BB)`);
    // interleaving over first 12
    const f12 = seq.slice(0, 12); const ty = (s) => { const [pos, rest] = s.split(' · '); return keyOfLabel(s).replace(pos, '').trim() + '/' + pos; };
    let sw = 0; for (let i = 1; i < f12.length; i++) if (ty(f12[i].spot) !== ty(f12[i - 1].spot)) sw++;
    const share = f12.length > 1 ? sw / (f12.length - 1) : 0;
    const streets = new Set(items.map(i => /flop|turn|river/i.test(i.spot) ? 'post' : 'pre'));
    setL('interleaving', Math.min(1, share / 0.6), `switch share over first ${f12.length} items = ${share.toFixed(2)} (type or position changed between consecutive items; full >=0.60); streets seen=${[...streets]}`);
    // dopamine
    const pc = rewC.filter(Boolean).length, pw = rewW.filter(Boolean).length;
    setL('dopamine audit', rewC.length >= 3 && pc / rewC.length >= 0.7 && (!rewW.length || pw / rewW.length <= 0.1) ? 1 : 0, `reward/progress element (streak, combo, xp, reward...) newly shown after correct answers ${pc}/${rewC.length}, after wrong ${pw}/${rewW.length}`);
    // drill result waits for tap
    if (!waitRes) out.notes.drillWait = 'not observed'; else { out.notes.drillWait = waitRes; if (!waitRes.same) out.vetoes.push('auto-advance'); setR('drill-result-wait-for-tap', waitRes.same ? 1 : 0, 0, `waited ${waitRes.waitedMs} ms: same drill + result still shown=${waitRes.same}`); }
    return p;
  };

  // ========== difficulty: two accuracy histories ==========
  const diffRun = async (good) => {
    const n = 60, g = good ? 58 : 12;
    const p = await newPage(`try{if(!localStorage.getItem('${HK}'))localStorage.setItem('${HK}',JSON.stringify({drills:{n:${n},good:${g},queue:[]}}))}catch(e){}`);
    await drillOpen(p); const ds = [];
    for (let i = 0; i < 30; i++) { const it = await drillItem(p); const r = await drillAnswer(p, pickIdx(it.n)); if (r.diff != null) ds.push(r.diff); await drillNext(p); }
    return ds;
  };

  const results = await Promise.all([guard('table', tableRun), guard('drill', drillRun), guard('diffHi', () => diffRun(true)), guard('diffLo', () => diffRun(false))]);
  const [, , hi, lo] = results.map((x, i) => i >= 2 ? x : x);
  if (Array.isArray(hi) && Array.isArray(lo) && hi.length && lo.length) {
    const m = (a) => a.reduce((s, x) => s + x, 0) / a.length; const d = m(hi) - m(lo);
    setL('desirable difficulty', d >= 0.12 ? 1 : d >= 0.07 ? 0.5 : 0, `mean item difficulty (1 - top solver freq) after 58/60 correct history=${m(hi).toFixed(3)} vs 12/60 history=${m(lo).toFixed(3)}; diff=${d.toFixed(3)} (full >=0.12, half >=0.07 over 30 items each; seeded by localStorage accuracy history)`);
  } else setL('desirable difficulty', 0, 'drill items not measurable');

  // ---- green / network / emoji / bg ----
  const gv = green.viol, uniq = [...new Set(gv.map(v => `${v.screen}:${v.sel}:${v.prop}:${v.color}`))];
  if (!green.pickSeen) setR('green-only-for-coach-pick', 0, 3, 'coach pick not observed green: inconclusive -> 0');
  else { setR('green-only-for-coach-pick', gv.length ? 0 : 1, 3, gv.length ? `${uniq.length} non-pick green elements: ${uniq.slice(0, 6).join(' | ')}` : `0 violations across screens ${[...new Set(green.screens)].join(',')}; pick observed green`); if (gv.length) out.vetoes.push('green-non-pick'); }
  const badHosts = [...hosts].filter(h => `http://${h}` !== origin);
  setR('no-network-outside-origin', badHosts.length ? 0 : 1, 2, `hosts=${[...hosts].join(',')}; external=${badHosts.join(',') || 'none'}`); if (badHosts.length) out.vetoes.push('network');
  setR('no-emoji', emoji.size ? 0 : 1, 1.5, emoji.size ? [...emoji].slice(0, 6).join(' ') : 'no emoji code points in visited screens');
  const lum = (c) => { const m = (c || '').match(/\d+(\.\d+)?/g); return m ? (+m[0] + +m[1] + +m[2]) / 765 : 1; };
  setR('black-background', bgInfo && lum(bgInfo.body) < 0.06 ? 1 : 0, 1.5, JSON.stringify(bgInfo));
  out.vetoes = [...new Set(out.vetoes)];
  const names = ['retrieval practice', 'spaced repetition', 'deliberate practice', 'immediate specific feedback in BB', 'calibration', 'interleaving', 'visible measured progress over time', 'desirable difficulty', 'dopamine audit'];
  out.learning.subs = names.map(n => L[n] || { name: n, points: 0, max: +SUB.toFixed(3), observed: 'check did not run (' + Object.entries(out.notes).filter(([k]) => k.startsWith('error_')).map(([k, v]) => k + ': ' + v).join('; ') + ')' });
  out.learning.total = +out.learning.subs.reduce((s, x) => s + x.points, 0).toFixed(2);
  out.rules.subs = Object.values(R).filter(x => x.max > 0); out.rules.points = +out.rules.subs.reduce((s, x) => s + x.points, 0).toFixed(2);
  out.notes.greenViolations = uniq; out.notes.externalRequests = badReqs; out.notes.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  await browser.close(); server.close();
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || path.resolve(here, '../..');
  runBrowserChecks({ root }).then(r => { console.log(JSON.stringify(r, null, 1)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
