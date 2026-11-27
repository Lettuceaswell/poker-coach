// Gauge v2 part B: coaching clarity (15). Driven through the UI; see SCORE-coaching-reach.md.
import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
import { env, HK, visBtns, clickNth, nums, mixOf, crawl, replay } from './cr-helpers.js';
const MAX = 15, TYPES = ['calibration', 'drill-preflop', 'drill-postflop', 'quiz'];
const ELEMS = ['definition', 'inputs', 'method', 'hint', 'explain'];
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s) => (s.match(/[A-Za-z']+/g) || []).length;
// Frozen fade seeds (documented in SCORE-coaching-reach.md): novice = empty storage; expert = >=8 of 10 hits.
export const EXPERT = { [HK]: JSON.stringify({ calib: { n: 10, hits: 9, width: 20 }, drills: { n: 100, good: 95, queue: [] } }) };

// In-page: snapshot a judgment container
const SNAP = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility(); };
  const c = [...document.querySelectorAll('[data-judgment]')].find(vis); if (!c) return null;
  const part = (k) => [...c.querySelectorAll(`[data-coach="${k}"]`)].filter(vis).map(e => e.innerText.trim()).join(' | ');
  const clone = c.cloneNode(true); clone.querySelectorAll('[data-coach]').forEach(e => e.remove()); clone.querySelectorAll('[data-reward]').forEach(e => e.remove());
  const q = (clone.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
  const outside = (() => { const cl = document.body.cloneNode(true); cl.querySelectorAll('[data-coach="inputs"]').forEach(e => e.remove()); return cl.innerText; })();
  return { type: c.getAttribute('data-judgment'), q, text: c.innerText, outside,
    definition: part('definition'), inputs: part('inputs'), method: part('method'), example: part('example'), hint: part('hint'), explain: part('explain'),
    hasToggle: !!c.querySelector('[data-coach="hint-toggle"]'), hintExists: !!c.querySelector('[data-coach="hint"]'), reward: [...c.ownerDocument.querySelectorAll('[data-reward]')].filter(vis).length };
};
const ARITH = /\d[\d.,%$]*\s*(?:[x×*\/÷+\-−=]|times|divided by|plus|minus|over)\s*\$?\d/i;

async function answerBtns(p) {
  return p.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility(); };
    const c = [...document.querySelectorAll('[data-judgment]')].find(vis); if (!c) return [];
    return [...c.querySelectorAll('button, [role=button]')].filter(vis).filter(e => !e.closest('[data-coach]') ).map(e => (e.innerText || '').trim().slice(0, 30));
  });
}
async function clickInJ(p, idx) {
  const h = await p.evaluateHandle((idx) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility(); };
    const c = [...document.querySelectorAll('[data-judgment]')].find(vis); if (!c) return null;
    return [...c.querySelectorAll('button, [role=button]')].filter(vis).filter(e => !e.closest('[data-coach]'))[idx];
  }, idx);
  const el = h.asElement(); if (!el) return false; await el.click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(300); return true;
}
const snap = (p) => p.evaluate(SNAP);
async function toggleHint(p) {
  const h = await p.evaluateHandle(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility(); }; const c = [...document.querySelectorAll('[data-judgment]')].find(vis); return c && c.querySelector('[data-coach="hint-toggle"]'); });
  const el = h.asElement(); if (!el) return false; await el.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(200); return true;
}
// Continue past a reveal: click the last visible button inside container or any continue-ish button.
async function advance(p) {
  const b = await visBtns(p); const k = b.find(x => /^(continue|next|done|ok|got it|deal)\b/i.test(x.t));
  if (k) { await clickNth(p, 'body', k.i); return true; } return false;
}
// Play one prompt: pre-commit snapshot, hint probe, answer choice idx, post-reveal snapshot.
async function playPrompt(p, idx) {
  const pre = await snap(p); if (!pre) return null;
  let hintProbe = { hiddenBefore: pre.hintExists ? pre.hint === '' : null, toggle: pre.hasToggle, after: '' };
  if (pre.hasToggle) { await toggleHint(p); const s = await snap(p); hintProbe.after = s ? s.hint : ''; }
  const btns = await answerBtns(p); if (!btns.length) return { pre, hintProbe, post: null, btns };
  const k = idx % btns.length; const label = btns[k];
  await clickInJ(p, k);
  const post = await snap(p) || await p.evaluate(() => ({ text: document.body.innerText, explain: [...document.querySelectorAll('[data-coach="explain"]')].map(e => e.innerText).join(' | '), reward: [...document.querySelectorAll('[data-reward]')].filter(e => e.checkVisibility()).length, hint: '', outside: '' }));
  return { pre, hintProbe, post, label, btns };
}
function truth(pl) { // revealed solver mix -> top action/freq
  const t = (pl.post && (pl.post.explain || '')) + ' ' + (pl.post && pl.post.text || '');
  const mx = mixOf(t); if (!mx.length) return null; mx.sort((a, b) => b.f - a.f); return { top: mx[0].a, f: mx[0].f, hard: (1 - mx[0].f / 100) >= 0.25 };
}
function scorePrompt(pl) {
  const r = {}; const { pre, hintProbe, post } = pl; const tr = truth(pl);
  const outside = pre.outside || '';
  r.definition = words(pre.definition) >= 6 && norm(pre.definition) !== norm(pre.q);
  const inn = nums(pre.inputs); const shown = new Set(nums(outside)); const hit = inn.filter(n => shown.has(n));
  r.inputs = inn.length >= 2 && hit.length >= 2;
  const mtxt = pre.method + ' ' + pre.example; r.method = nums(mtxt).length >= 2 && ARITH.test(mtxt);
  const trueTok = tr ? [String(tr.f), String(Math.round(tr.f)), tr.top.toLowerCase()] : [];
  const ht = (hintProbe.after || '').toLowerCase();
  r.hint = !!hintProbe.toggle && hintProbe.hiddenBefore === true && words(hintProbe.after) >= 3 && !(tr && nums(ht).some(n => +n === tr.f || +n === Math.round(tr.f)));
  const ex = post ? post.explain : '';
  r.explain = !!(post && pre.explain === '' && words(ex) >= 6 && tr && trueTok.some(t => ex.toLowerCase().includes(t)) && nums(pre.inputs).filter(n => nums(ex).includes(n)).length >= 2);
  return r;
}
// Drive a drill session on a page: returns plays. Tries entry buttons until judgment prompts appear.
async function sessionFrom(p, maxItems, seenTypes) {
  const plays = []; let miss = 0;
  for (let n = 0; n < maxItems && miss < 4; n++) {
    let s = await snap(p);
    if (!s) { if (!(await advance(p))) miss++; else miss = 0; await p.waitForTimeout(200); s = await snap(p); if (!s) continue; }
    const pl = await playPrompt(p, n); if (!pl) { miss++; continue; }
    plays.push(pl); seenTypes.add(pl.pre.type);
    // results wait for a tap: reward visible already; then advance
    pl.waitedForTap = !!(await snap(p)) || true;
    await advance(p); await p.waitForTimeout(150);
  }
  return plays;
}
async function findEntry(E, seed, want) {
  // try every top-level button, then (for cash) auto-play; returns a page showing a [data-judgment] (want: type or any)
  const p0 = await E.page(seed); const top = await visBtns(p0); await p0._ctx.close();
  for (let a = 0; a < Math.min(top.length, 9); a++) {
    const p = await E.page(seed); await clickNth(p, 'body', a);
    for (let k = 0; k < 2; k++) { const s = await snap(p); if (s && (!want || s.type === want)) return p; const b = await visBtns(p); const nx = b.find(x => /drill|train|start|practice|quiz|play/i.test(x.t)); if (nx) await clickNth(p, 'body', nx.i); }
    const s = await snap(p); if (s && (!want || s.type === want)) return p;
    await p._ctx.close();
  }
  return null;
}
async function cashUntilCalib(E, seed) { // play cash hands via action buttons until an orbit review calibration prompt shows
  const p = await E.page(seed); const b0 = await visBtns(p); const cash = b0.find(x => /cash|play|table/i.test(x.t)); if (cash) await clickNth(p, 'body', cash.i);
  for (let i = 0; i < 160; i++) {
    const s = await snap(p); if (s) return p;
    const b = await visBtns(p); const a = b.find(x => /^(fold|check|call|continue|next|ok|deal|got it|close)/i.test(x.t));
    if (a) await clickNth(p, 'body', a.i); else await p.waitForTimeout(300);
  }
  await p._ctx.close(); return null;
}

export async function run({ root = '.', seed, browser } = {}) {
  const E = await env(root, browser); const subs = {}; const notes = {}; const evidence = {};
  try {
    const seen = new Set(); const byType = {}; const allPlays = [];
    // 1) drills session from the menu crawl (interleaving yields multiple types)
    const dp = await findEntry(E, {}, null);
    if (dp) { const pl = await sessionFrom(dp, 16, seen); for (const x of pl) (byType[x.pre.type] ||= []).push(x); allPlays.push(...pl); await dp._ctx.close(); }
    // 2) targeted reach for any frozen type not yet seen
    for (const t of TYPES) if (!byType[t]) {
      let p = t === 'calibration' ? await cashUntilCalib(E, {}) : await findEntry(E, {}, t);
      if (p) { const pl = await sessionFrom(p, 4, seen); for (const x of pl) (byType[x.pre.type] ||= []).push(x); allPlays.push(...pl); await p._ctx.close(); }
    }
    const types = [...new Set([...TYPES, ...Object.keys(byType)])];
    const perType = 9 / types.length; subs.types = {};
    for (const t of types) {
      const pls = (byType[t] || []).filter(x => x.pre); const ev = { n: pls.length, elements: {} };
      if (!pls.length) { ev.note = 'prompt type not reachable through the UI: 0'; for (const e of ELEMS) ev.elements[e] = 0; subs.types[t] = { points: 0, max: perType, ...ev }; continue; }
      const sc = pls.map(scorePrompt); let tot = 0;
      for (const e of ELEMS) {
        const pass = sc.filter(s => s[e]).length; let frac = pass / pls.length >= 0.5 ? 1 : 0;
        const vary = e === 'definition' || e === 'hint' ? null : e === 'inputs' ? pls.map(x => x.pre.inputs) : e === 'method' ? pls.map(x => x.pre.method + x.pre.example) : pls.map(x => x.post && x.post.explain);
        let varNote = 'n<3: variation unverified (half credit)';
        if (vary) {
          const distinctQ = new Set(pls.map(x => norm(x.pre.text.slice(0, 200)))).size;
          const distinctV = new Set(vary.map(norm)).size;
          if (pls.length >= 3 && distinctQ >= 3) { varNote = `${distinctV} distinct of ${pls.length}`; if (distinctV < 2) frac = 0; }
          else if (frac) frac = 0.5;
        }
        ev.elements[e] = { credit: frac, passes: `${pass}/${pls.length}`, vary: vary ? varNote : undefined, sample: (e === 'explain' ? pls[0].post && pls[0].post.explain : e === 'hint' ? pls[0].hintProbe.after : pls[0].pre[e === 'method' ? 'method' : e]) ?.slice(0, 160) };
        tot += frac;
      }
      subs.types[t] = { points: +(tot / ELEMS.length * perType).toFixed(3), max: perType, ...ev };
    }
    // fade
    let fade = { points: 0, max: 3, note: 'no prompt reachable' };
    const nov = await findEntry(E, {}, null);
    if (nov) {
      const s0 = await snap(nov); const type = s0 && s0.type; const L0 = s0 ? (s0.method + s0.example).length : 0; await nov._ctx.close();
      const exp = type ? await findEntry(E, EXPERT, type) : null;
      if (exp) {
        const s1 = await snap(exp); const L1 = s1 ? (s1.method + s1.example).length : 0;
        const hintOk = s1 && s1.hasToggle ? (await toggleHint(exp), !!(await snap(exp)).hint) : false; await exp._ctx.close();
        const full = L0 > 0 && ARITH.test(s0.method + s0.example); const reduced = L1 < 0.7 * L0;
        fade = { points: full && reduced && hintOk ? 3 : full && reduced ? 1.5 : 0, max: 3, novice_len: L0, expert_len: L1, type, novice_full: full, reduced, hint_still_works: hintOk, note: full ? '' : 'novice must show full scaffold or fade = 0' };
        if (!full) fade.points = 0;
      } else fade.note = 'expert profile prompt not reachable';
    }
    subs.fade = fade;
    // reward
    const cells = { hardCorrect: [], wrong: [], easyCorrect: [] };
    for (const x of allPlays) {
      if (!x.post || !x.label) continue; const tr = truth(x); if (!tr) continue;
      const correct = norm(x.label).includes(norm(tr.top)) || norm(tr.top).includes(norm(x.label));
      const got = (x.post.reward || 0) > (x.pre.reward || 0);
      (!correct ? cells.wrong : tr.hard ? cells.hardCorrect : cells.easyCorrect).push(got);
    }
    const rate = (a) => a.length ? a.filter(Boolean).length / a.length : null;
    const r = { hardCorrect: { n: cells.hardCorrect.length, rate: rate(cells.hardCorrect) }, wrong: { n: cells.wrong.length, rate: rate(cells.wrong) }, easyCorrect: { n: cells.easyCorrect.length, rate: rate(cells.easyCorrect) }, items: allPlays.length };
    const part = (c, ok) => c.n >= 3 && ok(c.rate) ? 1 : 0;
    const pts = part(r.hardCorrect, x => x >= 0.7) + part(r.wrong, x => x <= 0.1) + part(r.easyCorrect, x => x <= 0.4);
    subs.reward = { points: pts, max: 3, ...r, note: allPlays.length < 12 ? `only ${allPlays.length} items answered (<12)` : '', rule: 'each of 3 sub-rates worth 1, needs n>=3 in the bucket' };
    const points = Object.values(subs.types).reduce((a, t) => a + t.points, 0) + subs.fade.points + subs.reward.points;
    return { points: +Math.min(points, MAX).toFixed(2), max: MAX, subs, types_found: [...seen] };
  } finally { await E.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root'); const root = i > 0 ? process.argv[i + 1] : '.';
  run({ root }).then(r => { console.log(JSON.stringify(r, null, 1)); }).catch(e => { console.error(e); process.exit(1); });
}
