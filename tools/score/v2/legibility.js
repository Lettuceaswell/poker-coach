// Legibility & visual (20): chips, position highlight, font, contrast, tap targets, clipping.
// Everything is observed from Chromium DOM geometry / computed style after real taps. No app source is read.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { here, startServer, launch, newPage, guard, sleep, VIEWPORTS, crawlMenu } from './lib.js';

const EXF = path.join(here, 'fixtures/legibility-exempt.json');
const EXEMPT = JSON.parse(fs.readFileSync(EXF, 'utf8')); // fixture IO, not scoring-by-source
const EXEMPT_SHA = crypto.createHash('sha256').update(fs.readFileSync(EXF)).digest('hex');
const W = { chips: 4, highlight: 4, font: 3, contrast: 3, tap: 3, clip: 3 };
const SEATS = [3, 4, 5, 6], HANDS_PER = 4;

// ---------- in-page: text legibility scan (reads DOM/style only) ----------
const SCAN_TEXT = (cfg) => {
  const out = { font: [], contrast: [], tap: [], clip: [], nodes: 0, taps: 0 };
  const sel = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const parse = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const effOpacity = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const effBg = (e) => { const chain = []; for (let n = e; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n); let bg = [0, 0, 0]; for (const n of chain) { const c = parse(getComputedStyle(n).backgroundColor); const a = c[3]; if (a > 0) bg = [c[0] * a + bg[0] * (1 - a), c[1] * a + bg[1] * (1 - a), c[2] * a + bg[2] * (1 - a)]; } return bg; };
  const vw = innerWidth, vh = innerHeight;
  const visible = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return false; } return effOpacity(e) > 0.05; };
  const exempt = (e) => (cfg.exemptFont || []).some(s => { try { return e.closest(s); } catch { return false; } });
  const seen = new Set();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t; (t = tw.nextNode());) {
    const txt = t.textContent.trim(); if (!txt) continue;
    const e = t.parentElement; if (!e || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(e.tagName) || !visible(e)) continue;
    const rg = document.createRange(); rg.selectNodeContents(t); const r = rg.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy); if (!hit || !(e.contains(hit) || hit.contains(e))) continue; // covered by an overlay
    const key = sel(e) + '|' + txt.slice(0, 24); if (seen.has(key)) continue; seen.add(key);
    out.nodes++;
    const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); const bold = (+cs.fontWeight || 400) >= 700;
    if (fs < 13 && !exempt(e)) out.font.push({ sel: sel(e), text: txt.slice(0, 24), value: fs });
    const col = parse(cs.color); const a = col[3] * effOpacity(e); const bg = effBg(e);
    const fg = [col[0] * a + bg[0] * (1 - a), col[1] * a + bg[1] * (1 - a), col[2] * a + bg[2] * (1 - a)];
    const l1 = L(fg), l2 = L(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && bold); const req = large ? 3 : 4.5;
    if (ratio < req) out.contrast.push({ sel: sel(e), text: txt.slice(0, 24), value: +ratio.toFixed(2), req });
    // clipping: text box outside an ancestor that clips it, or outside the viewport horizontally
    let clipped = null;
    if (r.left < -1.5 || r.right > vw + 1.5) clipped = 'outside viewport x';
    for (let n = e; n && n !== document.body && !clipped; n = n.parentElement) {
      const c = getComputedStyle(n); const ox = c.overflowX, oy = c.overflowY; if (ox === 'visible' && oy === 'visible') continue;
      const nr = n.getBoundingClientRect();
      if (['hidden', 'clip'].includes(ox) && (r.left < nr.left - 1.5 || r.right > nr.right + 1.5)) clipped = 'clipped x by ' + sel(n);
      else if (['hidden', 'clip'].includes(oy) && (r.top < nr.top - 1.5 || r.bottom > nr.bottom + 1.5) && !/auto|scroll/.test(oy)) clipped = 'clipped y by ' + sel(n);
      if (!clipped && c.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) clipped = 'ellipsis ' + sel(n);
    }
    if (clipped) out.clip.push({ sel: sel(e), text: txt.slice(0, 24), value: clipped });
  }
  const seenT = new Set();
  for (const e of document.querySelectorAll('button, [role=button], a[href], input, select, textarea, summary, [data-a]')) {
    if (!visible(e)) continue; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2))); if (!hit || !(e.contains(hit) || hit.contains(e))) continue;
    const key = sel(e) + '|' + (e.innerText || e.getAttribute('aria-label') || '').slice(0, 20); if (seenT.has(key)) continue; seenT.add(key);
    out.taps++; if (r.width < 43.5 || r.height < 43.5) out.tap.push({ sel: sel(e), text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 20), value: Math.round(r.width) + 'x' + Math.round(r.height) });
  }
  return out;
};

// ---------- in-page: bet chip check (reads DOM/geometry only) ----------
const CHIPS = () => {
  const vw = innerWidth, vh = innerHeight; const res = { chips: [], viol: [] };
  const eo = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return false; } return true; };
  const board = [...document.querySelectorAll('#board .card')].filter(c => !c.classList.contains('back'));
  const preflop = board.length === 0;
  const seats = [...document.querySelectorAll('#seats .seat')].map(s => ({ key: s.id, chip: s.querySelector('.bet-chip'), pos: (s.querySelector('.pos')?.textContent || '').trim(), label: (s.querySelector('.nm')?.className || '') + ' ' + (s.querySelector('.nm')?.textContent || ''), folded: s.classList.contains('folded') }));
  seats.push({ key: 'hero', chip: document.getElementById('heroBet'), pos: (document.getElementById('heroPos')?.textContent || '').trim(), label: '', folded: false });
  const others = [...document.querySelectorAll('#heroCards .card, #board .card, #seats .mini .card, #seats .pos, #seats .nm, #seats .stk, #heroPos, #heroStack, #heroHand')].filter(vis);
  const boxes = (e) => e.getBoundingClientRect();
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const allChips = seats.filter(s => s.chip && s.chip.textContent.trim() && vis(s.chip));
  for (const s of seats) {
    const txt = s.chip ? s.chip.textContent.trim() : '';
    const expect = preflop && !s.folded && (/^(SB|BB)$/.test(s.pos) || /last-(call|raise|bet|all)/i.test(s.label) || /^(Call|Raise|Bet|All)/i.test(s.label.trim().split(' ').slice(-1)[0] || ''));
    if (!txt) { if (expect) res.viol.push({ key: s.key, kind: 'missing chip', value: s.pos }); continue; }
    const c = s.chip; const r = boxes(c); res.chips.push(s.key);
    if (!vis(c)) { res.viol.push({ key: s.key, kind: 'hidden', value: txt }); continue; }
    if (!/\d/.test(txt)) res.viol.push({ key: s.key, kind: 'no amount', value: txt });
    if (r.width < 16 || r.height < 16) res.viol.push({ key: s.key, kind: 'too small', value: Math.round(r.width) + 'x' + Math.round(r.height) });
    if (eo(c) < 0.9) res.viol.push({ key: s.key, kind: 'opacity', value: eo(c).toFixed(2) });
    if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) res.viol.push({ key: s.key, kind: 'outside viewport', value: [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') });
    const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
    if (!hit || !(c.contains(hit) || hit.contains(c))) res.viol.push({ key: s.key, kind: 'not topmost', value: hit ? hit.className || hit.tagName : 'none' });
    for (const o of others) { if (o === c || c.contains(o) || o.contains(c)) continue; if (inter(r, boxes(o))) { res.viol.push({ key: s.key, kind: 'overlaps ' + (o.className || o.id || o.tagName).toString().split(' ')[0], value: txt }); break; } }
    for (const t of allChips) if (t.chip !== c && inter(r, boxes(t.chip))) { res.viol.push({ key: s.key, kind: 'overlaps chip ' + t.key, value: txt }); break; }
  }
  return res;
};

// ---------- in-page: highlight sampler (reads computed style every 50 ms) ----------
const SAMPLER = (n) => {
  window.__hl = { t0: performance.now(), s: [], n };
  const par = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  // lit observable: non-button seats = border colour brightness (rest ~47, lit >= 100); button seat = glow alpha >= 0.5 (its resting pulse peaks lower and its border is always bright)
  const lit = (e) => { const cs = getComputedStyle(e); const b = par(cs.borderTopColor); let mx = 0; for (const m of (cs.boxShadow || '').match(/rgba?\([^)]*\)/g) || []) mx = Math.max(mx, par(m)[3]);
    if ((e.textContent || '').trim() === 'BTN') return mx >= 0.5 ? 1 : 0; return (b[3] * (b[0] + b[1] + b[2]) / 3 >= 100 || mx >= 0.5) ? 1 : 0; };
  const info = (e) => { const cs = getComputedStyle(e); const b = par(cs.backgroundColor); return (b[0] + b[1] + b[2]) / 3 > 200 && b[3] > 0.5 ? 1 : 0; };
  setInterval(() => {
    const row = { t: Math.round(performance.now() - window.__hl.t0), lit: {}, btn: -1, bright: {} };
    const els = [...document.querySelectorAll('#seats .seat')].map(s => [s.id.slice(5), s.querySelector('.pos')]);
    const present = els.map(x => +x[0]); let hero = -1; for (let i = 0; i < n; i++) if (!present.includes(i)) hero = i;
    els.push([String(hero), document.getElementById('heroPos')]);
    for (const [k, e] of els) { if (!e) continue; row.lit[k] = lit(e); row.bright[k] = info(e); if ((e.textContent || '').trim() === 'BTN') row.btn = +k; }
    window.__hl.s.push(row);
  }, 50);
};

// ---------- analysis of the sampler timeline ----------
function analyseHL(samples, n, windowStart, windowEnd) {
  const rows = samples.filter(r => r.t >= windowStart && r.t < windowEnd); if (rows.length < 5) return null;
  const btn = rows.find(r => r.btn >= 0)?.btn; if (btn == null) return null;
  const keys = Object.keys(rows[0].lit).map(Number); if (keys.length < n) return null;
  // episodes per seat (rising edges, debounce 1 sample gap)
  const ep = {}; for (const k of keys) ep[k] = [];
  for (const k of keys) { let on = false; for (const r of rows) { const v = r.lit[k] === 1; if (v && !on) ep[k].push({ s: r.t, e: r.t }); if (v && ep[k].length) ep[k][ep[k].length - 1].e = r.t; on = v; } }
  const exp1 = [...Array(n)].map((_, i) => (btn + i) % n), exp2 = [...Array(n)].map((_, i) => (btn + 1 + i) % n);
  const firsts = keys.map(k => ({ k, t: ep[k][0]?.s })).filter(x => x.t != null).sort((a, b) => a.t - b.t).map(x => x.k);
  const order = firsts.length === n && (firsts.join() === exp1.join() || firsts.join() === exp2.join());
  const lapEnd = firsts.length === n ? ep[firsts[n - 1]][0].s : null; // time the last seat lights
  const sampleAtEnd = lapEnd != null ? rows.filter(r => r.t >= lapEnd - 1 && r.t <= lapEnd + 60) : [];
  const allLit = sampleAtEnd.some(r => keys.every(k => r.lit[k] === 1));
  let stay = firsts.length === n;
  if (stay) for (const k of firsts) { const first = ep[k][0].s; if (!(ep[k][0].e >= lapEnd - 60)) { stay = false; break; } }
  const nonBtn = keys.filter(k => k !== btn); const cnt = nonBtn.map(k => ep[k].length).sort((a, b) => a - b); const laps = cnt.length ? cnt[Math.floor(cnt.length / 2)] : 0;
  const last = Math.max(0, ...keys.map(k => ep[k].length ? ep[k][ep[k].length - 1].e : 0));
  const after = rows.filter(r => r.t >= last + 1200 && r.t <= last + 1800 + 600);
  const btnOnly = after.length ? after.every(r => keys.filter(k => k !== btn).every(k => r.lit[k] === 0) && (r.bright[btn] === 1 || r.lit[btn] === 1)) : false;
  return { order, stay, allLit, laps, btnOnly, firsts, btn };
}

function analyseRuns(samples, n) {
  // split into runs at gaps > 2.5 s with no lit seat
  const litRows = samples.filter(r => Object.values(r.lit).some(v => v === 1)); if (!litRows.length) return { run1: null, run2: null };
  const runs = []; let cur = [litRows[0]];
  for (let i = 1; i < litRows.length; i++) { if (litRows[i].t - litRows[i - 1].t > 2500) { runs.push(cur); cur = []; } cur.push(litRows[i]); } runs.push(cur);
  const win = (r) => [r[0].t - 200, r[r.length - 1].t + 2600];
  const a = (i) => runs[i] ? analyseHL(samples, n, ...win(runs[i])) : null;
  return { run1: a(0), run2: runs.length > 1 ? a(1) : null, nRuns: runs.length };
}

// ---------- hand driver ----------
const heroActions = (p) => p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
const panelOn = (p) => p.evaluate(() => document.getElementById('panel')?.classList.contains('on'));

export async function run({ root, seed = 20261127, browser: extBrowser, onlyQuick = false } = {}) {
  const t0 = Date.now(); const notes = { exemptSha256: EXEMPT_SHA };
  const srv = await startServer(root); const browser = extBrowser || await launch();
  const acc = { chips: { keys: new Set(), viol: new Map(), samples: 0, hands: {} }, hl: [], text: { font: new Map(), contrast: new Map(), clip: new Map(), tap: new Map(), nodes: 0, taps: 0, screens: [] } };
  const named = new Set();
  const addText = (r, screen) => {
    acc.text.nodes += r.nodes; acc.text.taps += r.taps; acc.text.screens.push(screen);
    for (const k of ['font', 'contrast', 'clip', 'tap']) for (const v of r[k]) { const key = v.sel + '|' + v.text; if (!acc.text[k].has(key)) acc.text[k].set(key, { ...v, screen }); }
  };
  const scan = async (p, screen, nameAs) => { const r = await p.evaluate(SCAN_TEXT, { exemptFont: EXEMPT.font }); addText(r, screen); if (nameAs) named.add(nameAs); };

  // one combo = (seat count, viewport): HANDS_PER seeded hands, sequential
  const combo = async (n, vp, ci) => {
    const tag = `${n}p@${vp.width}`;
    for (let h = 0; h < HANDS_PER; h++) {
      const hs = seed + n * 1000 + vp.width + h * 17;
      const p = await newPage(browser, srv.origin, { seed: hs, viewport: vp, settings: { seats: n, speed: 'fast', coach: 'off', orbitReview: false, calibration: false }, timeout: 6000 });
      try {
        if (h === 0 && ci === 0) await scan(p, 'menu', 'menu');
        await p.evaluate(SAMPLER, n);
        await p.click('#modeCash');
        const start = Date.now(); const hlWait = h === 0 ? (3 * n * 140 + 900 + 6000 + 2 * n * 140 + 900 + 2200) : 0;
        let heroTurns = 0, scanned = false, resultScanned = false, bad = new Map(), over = false;
        const hkey = `${tag}#${h}`;
        while (Date.now() - start < hlWait + 26000) {
          if (await panelOn(p)) { await p.click('#panelClose').catch(() => {}); await sleep(100); }
          const c = await p.evaluate(CHIPS); acc.chips.samples++;
          const seenNow = new Set();
          for (const k of c.chips) acc.chips.keys.add(hkey + ':' + k);
          for (const v of c.viol) { const id = hkey + ':' + v.key + ':' + v.kind; seenNow.add(id); bad.set(id, { ...v, n: (bad.get(id)?.n || 0) + 1, last: bad.get(id)?.lastPoll === acc.chips.samples - 1 ? true : false, lastPoll: acc.chips.samples, streak: (bad.get(id)?.lastPoll === acc.chips.samples - 1 ? (bad.get(id).streak || 1) + 1 : 1), maxStreak: Math.max(bad.get(id)?.maxStreak || 0, bad.get(id)?.lastPoll === acc.chips.samples - 1 ? (bad.get(id).streak || 1) + 1 : 1) }); }
          const a = await heroActions(p);
          if (a.includes('next')) { if (h === 0 && !resultScanned) { await scan(p, `result ${tag}`, 'result'); resultScanned = true; } over = true; break; }
          const turn = a.some(x => ['fold', 'call', 'check', 'raise'].includes(x));
          if (turn) {
            if (!scanned && (h === 0 || n === 6)) { await sleep(450); await scan(p, `table-heroturn ${tag}`, 'table'); scanned = true; }
            if (Date.now() - start < hlWait) { await sleep(100); continue; }
            heroTurns++; const pick = a.includes('check') ? 'check' : a.includes('call') ? 'call' : 'fold';
            await p.click(`#actions [data-a="${pick}"]`, { timeout: 2500 }).catch(() => {});
            if (heroTurns === 3) { await sleep(900); const c2 = await p.evaluate(CHIPS); for (const v of c2.viol) bad.set(hkey + ':' + v.key + ':' + v.kind, { ...v, maxStreak: 9 }); } // v2.1: no break, the hand is played on (check-down) until the result screen is sampled
          }
          await sleep(100);
        }
        for (const [id, b] of bad) if ((b.maxStreak || 1) >= 2) acc.chips.viol.set(id, b);
        if (h === 0) { const s = await p.evaluate(() => window.__hl.s); acc.hl.push({ tag, n, ...analyseRuns(s, n), samples: s.length, period: s.length > 1 ? Math.round((s[s.length - 1].t - s[0].t) / (s.length - 1)) : null }); }
        if (!over && h === 0) notes['noResult_' + tag] = 'hand not finished in time';
      } catch (e) { notes['error_' + tag + '_' + h] = String(e.message).slice(0, 120); }
      await p.context().close().catch(() => {});
    }
  };
  const combos = []; SEATS.forEach((n, i) => VIEWPORTS.forEach((vp, j) => combos.push([n, vp, i * 2 + j])));

  // menu crawl + named screens (menu/Hands/Leaks/Progress/Settings, drills Q & A) in one page, sequential
  const crawl = async () => {
    const p = await newPage(browser, srv.origin, { seed: seed + 5, settings: { seats: 3, speed: 'fast' }, timeout: 6000 });
    const names = { menuHands: 'hands', menuLeaks: 'leaks', menuProgress: 'progress', menuSettings: 'settings' };
    const visited = await crawlMenu(p, async (pg, label) => {
      await scan(pg, label); for (const [id, nm] of Object.entries(names)) if (label === 'crawl:' + id) named.add(nm);
      if (label === 'crawl:modeDrills') named.add('drill-question');
      if (/^crawl:modeDrills>/.test(label)) named.add('drill-answer');
    });
    notes.crawled = visited; await p.context().close().catch(() => {});
  };
  // orbit review: play passively until the orbit panel opens
  const orbit = async () => {
    const p = await newPage(browser, srv.origin, { seed: seed + 9, settings: { seats: 3, speed: 'fast' }, timeout: 6000 });
    const end = Date.now() + 70000; let got = false;
    while (Date.now() < end && !got) {
      if (await panelOn(p)) { const title = await p.$eval('#panelTitle', e => e.textContent).catch(() => ''); if (/orbit/i.test(title)) { await sleep(400); await scan(p, 'orbit-review', 'orbit'); for (const b of await p.$$('#panelBody .reveal:not([disabled])')) { await b.click().catch(() => {}); await sleep(100); } await scan(p, 'orbit-revealed'); got = true; break; } await p.click('#panelClose').catch(() => {}); await sleep(150); continue; }
      if (!(await p.$('#modeCash:visible')) === false) { await p.click('#modeCash').catch(() => {}); }
      const a = await heroActions(p);
      if (a.includes('next')) await p.click('#actions [data-a="next"]', { timeout: 2000 }).catch(() => {});
      else if (a.length) await p.click(`#actions [data-a="${a.includes('check') ? 'check' : a.includes('call') ? 'call' : 'fold'}"]`, { timeout: 2000 }).catch(() => {});
      await sleep(80);
    }
    if (!got) notes.orbit = 'orbit review never opened in 70 s'; await p.context().close().catch(() => {});
  };

  const jobs = [];
  for (let i = 0; i < combos.length; i += 4) jobs.push(Promise.all(combos.slice(i, i + 4).map(([n, vp, ci]) => guard(notes, 'combo' + n + vp.width, () => combo(n, vp, ci), 120000))));
  const comboRun = (async () => { for (const j of jobs) await j; })();
  // combos start eagerly above (promises already created) -> everything below runs concurrently with them
  await Promise.all([comboRun, guard(notes, 'crawl', crawl, 100000), guard(notes, 'orbit', orbit, 90000)]);
  if (!extBrowser) await browser.close(); srv.close();

  // ---------- scoring ----------
  const subs = [];
  const mk = (name, frac, max, observed) => subs.push({ name, points: +(Math.max(0, Math.min(1, frac)) * max).toFixed(3), max, observed });
  // (a) chips
  const nChips = acc.chips.keys.size, vk = [...acc.chips.viol.values()]; const vcount = new Set([...acc.chips.viol.keys()]).size;
  const chipFrac = Math.min(1, nChips / 30) * (1 - Math.min(1, vcount / Math.max(1, nChips)));
  mk('bet-chip overlap', chipFrac, W.chips, { hands: SEATS.length * VIEWPORTS.length * HANDS_PER, handsByCombo: `${SEATS.join('/')} seats x ${VIEWPORTS.map(v => v.width + 'x' + v.height).join(',')} x ${HANDS_PER}`, chips_observed: nChips, violations: vcount, polls: acc.chips.samples, worst: vk.slice(0, 6).map(v => `${v.key} ${v.kind} (${v.value})`), formula: 'min(1,chips/30) * (1 - min(1, violations/chips))' });
  // (b) highlight: six properties over combos with data
  const props = ['order', 'stay', 'allLit', 'laps3', 'btnOnly', 'later2'];
  const tally = Object.fromEntries(props.map(k => [k, 0])); let m1 = 0, m2 = 0; const detail = [];
  for (const h of acc.hl) {
    const a = h.run1, b = h.run2; m1++;
    if (a) { tally.order += a.order ? 1 : 0; tally.stay += a.stay ? 1 : 0; tally.allLit += a.allLit ? 1 : 0; tally.laps3 += a.laps === 3 ? 1 : 0; tally.btnOnly += a.btnOnly ? 1 : 0; }
    if (b) { m2++; tally.later2 += (b.laps === 2 && b.btnOnly) ? 1 : 0; }
    detail.push(`${h.tag}: run1 ${a ? `order=${a.order} stay=${a.stay} allLit=${a.allLit} laps=${a.laps} btnOnly=${a.btnOnly}` : 'none'}; run2 ${b ? `laps=${b.laps} btnOnly=${b.btnOnly}` : 'none'}; period=${h.period}ms`);
  }
  const total = SEATS.length * VIEWPORTS.length; // denominators are the full 8 combos so unmeasured counts as failure
  const hlFrac = props.reduce((s, k) => s + tally[k] / total, 0) / props.length;
  mk('position highlight', hlFrac, W.highlight, { combos_measured: m1, later_run_measured: m2, tally, per_property_formula: 'each of 6 properties = combos passing / 8; sub-score = mean', detail: detail.slice(0, 8) });
  // (c)-(f)
  const REQ = ['menu', 'table', 'result', 'drill-question', 'drill-answer', 'orbit', 'hands', 'leaks', 'progress', 'settings'];
  const cov = REQ.filter(x => named.has(x)).length / REQ.length;
  const tm = (k, name, max, what, N) => { const v = [...acc.text[k].values()]; const V = v.length; const worst = v.sort((a, b) => (typeof a.value === 'number' && typeof b.value === 'number') ? (k === 'font' || k === 'contrast' ? a.value - b.value : 0) : 0).slice(0, 6).map(x => `${x.sel} "${x.text}" ${x.value} @${x.screen}`);
    const frac = (0.5 * (1 - Math.min(1, V / 5)) + 0.5 * (1 - Math.min(1, V / Math.max(5, 0.2 * N)))) * cov;
    mk(name, frac, max, { violations_unique: V, items_checked: N, screens_measured: acc.text.screens.length, named_screens_covered: `${REQ.filter(x => named.has(x)).length}/${REQ.length}`, missing_named: REQ.filter(x => !named.has(x)), worst, formula: '(0.5*(1-min(1,V/5)) + 0.5*(1-min(1,V/max(5,0.2*N)))) * named_screens_covered/10; ' + what }); };
  tm('font', 'min font size >= 13px', W.font, 'content text <13 px unless in legibility-exempt.json', acc.text.nodes);
  tm('contrast', 'WCAG AA contrast', W.contrast, '4.5:1 (3:1 large) vs composited ancestor backgrounds (gradients/images ignored)', acc.text.nodes);
  tm('tap', 'tap targets >= 44x44', W.tap, 'visible topmost button/control box', acc.text.taps);
  tm('clip', 'no clipped / overflowing text', W.clip, 'text box beyond an overflow-hidden ancestor or the viewport', acc.text.nodes);
  const points = +subs.reduce((s, x) => s + x.points, 0).toFixed(2);
  return { points, max: 20, subs, notes: { ...notes, seconds: +((Date.now() - t0) / 1000).toFixed(1), screens: [...new Set(acc.text.screens)].length } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const root = process.argv[2] || path.resolve(here, '../../..');
  run({ root }).then(r => { console.log(JSON.stringify(r, null, 1)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
