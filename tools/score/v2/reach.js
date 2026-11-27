// Gauge v2 part B: feature reach (15 = 9 items x 15/9). UI-driven; see SCORE-coaching-reach.md.
import fs from 'fs'; import { fileURLToPath } from 'url';
import { env, visBtns, clickNth, nums, GATE, crawl, replay, featureText, mixOf } from './cr-helpers.js';
const MAX = 15, PER = 15 / 9;
const ITEMS = ['library', 'review', 'custom-solve', 'report', 'nodelock', 'multiway', 'export', 'stacks', 'trainer'];
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const pcts = (s) => [...s.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map(m => +m[1]);
// Interact with a feature root: click each visible control in turn; return texts after each. Non-navigating: skip close/back/export/lock.
async function probe(E, path, name, seed, { pick = /./, skip = /close|back|menu|export|download|lock/i, max = 8 } = {}) {
  const out = []; const p0 = await replay(E, path, seed); const base = await featureText(p0, name);
  const ctl = await p0.evaluate((n) => [...document.querySelector(`[data-feature="${n}"]`).querySelectorAll('button, [role=button], select, input')].filter(e => e.getBoundingClientRect().width > 0).map((e, i) => ({ i, t: (e.innerText || e.value || '').trim().slice(0, 30), tag: e.tagName })), name).catch(() => []);
  await p0._ctx.close();
  for (const c of ctl.filter(c => !skip.test(c.t) && pick.test(c.t)).slice(0, max)) {
    const p = await replay(E, path, seed);
    const h = await p.evaluateHandle(([n, i]) => [...document.querySelector(`[data-feature="${n}"]`).querySelectorAll('button, [role=button], select, input')].filter(e => e.getBoundingClientRect().width > 0)[i], [name, c.i]);
    const el = h.asElement(); if (el) { if (c.tag === 'SELECT') { const opts = await p.evaluate(e => [...e.options].map(o => o.value), el); if (opts[1] !== undefined) await el.selectOption(opts[1]).catch(() => {}); } else await el.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(500); }
    out.push({ ctl: c.t || c.tag, text: await featureText(p, name) }); await p._ctx.close();
  }
  return { base, results: out };
}
const changed = (a, b) => a != null && b != null && norm(a) !== norm(b);
const sumOk = (txt) => { const m = txt.split('\n').map(pcts).filter(x => x.length >= 2); return m.some(r => Math.abs(r.reduce((a, b) => a + b, 0) - 100) <= 2) || (pcts(txt).length >= 2 && pcts(txt).reduce((a, b) => a + b, 0) <= 400); };

export async function run({ root = '.', seed, browser } = {}) {
  const E = await env(root, browser); const subs = {}; const paths = {};
  try {
    const found = await crawl(E); Object.assign(paths, found);
    const give = (k, pts, note, ev) => { subs[k] = { points: +(pts * PER).toFixed(3), max: PER, note, ...ev }; };
    const need = (k) => paths[k] || null;
    for (const k of ITEMS) if (!paths[k]) give(k, 0, 'absent: no [data-feature="' + k + '"] screen reachable from the menu crawl (depth 2)', {});
    const todo = ITEMS.filter(k => paths[k] && k !== 'trainer');
    for (const k of todo) {
      const pth = paths[k]; const pr = await probe(E, pth, k, {});
      // determinism: same input twice -> same output
      const again = await probe(E, pth, k, {}, { max: 1 }); const first = await probe(E, pth, k, {}, { max: 1 });
      const det = again.results.length && first.results.length ? norm(again.results[0].text) === norm(first.results[0].text) : false;
      const diffs = pr.results.filter(r => changed(pr.base, r.text));
      const base = pr.base || ''; const ev = { path: pth, controls_tried: pr.results.length, changed_by: diffs.map(d => d.ctl), deterministic: det };
      let ok = false, note = '';
      if (k === 'library') { ok = diffs.length >= 1 && pcts(base).length >= 2 && sumOk(base); note = 'needs a selectable control changing the shown strategy; percentages summing ~100'; }
      else if (k === 'review') { ok = /solver|best|top|line/i.test(base) && /\d+(\.\d+)?\s*bb/i.test(base); const costs = [...base.matchAll(/(?:cost|lost|loss)[^\d\n-]*(-?\d+(?:\.\d+)?)\s*bb/gi)].map(m => +m[1]); ev.costs = costs; ok = ok && costs.some(c => c > 0) && costs.some(c => c === 0); note = 'needs a solver line and BB costs, 0 for a matching decision and >0 for an off-line one (history must hold such hands; base app played-hand seeding is UI-driven only)'; }
      else if (k === 'custom-solve') { const inp = await (async () => { const p = await replay(E, pth, {}); const n = await p.evaluate(() => document.querySelectorAll('[data-feature="custom-solve"] input, [data-feature="custom-solve"] textarea').length); const t0 = await featureText(p, k); const el = await p.$('[data-feature="custom-solve"] input[type=number], [data-feature="custom-solve"] input[type=text], [data-feature="custom-solve"] input:not([type])'); let t1 = null; if (el) { await el.fill('33').catch(() => {}); const go = (await visBtns(p, '[data-feature="custom-solve"]')).find(x => /solve|run|go|compute/i.test(x.t)); if (go) await clickNth(p, '[data-feature="custom-solve"]', go.i); await p.waitForTimeout(2500); t1 = await featureText(p, k); const el2 = await p.$('[data-feature="custom-solve"] input[type=number], [data-feature="custom-solve"] input[type=text], [data-feature="custom-solve"] input:not([type])'); if (el2) await el2.fill('150').catch(() => {}); if (go) await clickNth(p, '[data-feature="custom-solve"]', go.i); await p.waitForTimeout(2500); var t2 = await featureText(p, k); } await p._ctx.close(); return { n, t0, t1, t2 }; })(); ev.inputs = inp.n; ok = inp.n >= 2 && pcts(inp.t1 || '').length >= 2 && changed(inp.t1, inp.t2); note = 'size typed 33 then 150 must change the returned strategy; >=2 inputs (sizes + ranges)'; }
      else if (k === 'report') { const rows = [...base.matchAll(/^(.*?)(-?\d+(?:\.\d+)?)\s*bb.*$/gim)].filter(m => !/total/i.test(m[0])); const tot = base.match(/total[^\d\-]*(-?\d+(?:\.\d+)?)\s*bb/i); ev.rows = rows.length; ev.total = tot && tot[1]; ok = rows.length >= 2 && !!tot && Math.abs(rows.reduce((a, m) => a + Math.abs(+m[2]), 0) - Math.abs(+tot[1])) <= 0.1; note = 'rows "label X.X BB" must sum to the "Total ... X.X BB" line (+-0.1); seeded-set change check needs a hand-history seed (not claimed)'; }
      else if (k === 'nodelock') { const lockc = pr.results.length; const p = await replay(E, pth, {}); const t0 = await featureText(p, k); const lk = (await visBtns(p, '[data-feature="nodelock"]')).find(x => /lock/i.test(x.t)); let t1 = null; if (lk) { await clickNth(p, '[data-feature="nodelock"]', lk.i); await p.waitForTimeout(2000); t1 = await featureText(p, k); } await p._ctx.close(); ok = lk && changed(t0, t1) && pcts(t1).length >= 2; note = 'tapping a lock control must change the shown opponent response'; }
      else if (k === 'multiway') { ok = /estimate|approx|multiway|3-way|three/i.test(base) && pcts(base).length >= 1 && diffs.length >= 1; note = 'labeled estimate/solve for 3+ players and differs across a second spot'; }
      else if (k === 'export') { const p = await replay(E, pth, {}); const shown = await featureText(p, k); const btn = (await visBtns(p, '[data-feature="export"]')).find(x => /export|download|save/i.test(x.t)); let parsed = false, contains = false; if (btn) { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), clickNth(p, '[data-feature="export"]', btn.i)]); if (dl) { const f = await dl.path(); const raw = fs.readFileSync(f, 'utf8'); try { JSON.parse(raw); parsed = true; } catch { parsed = raw.split('\n').filter(l => l.includes(',')).length >= 2; } const sn = nums(shown || '').filter(n => n.length >= 2); contains = sn.length ? sn.filter(n => raw.includes(n)).length >= Math.min(2, sn.length) : false; ev.bytes = raw.length; } } await p._ctx.close(); ev.parsed = parsed; ev.contains_shown = contains; ok = parsed && contains; note = 'tap export -> download parses (JSON/CSV) and contains >=2 numbers shown on screen'; }
      else if (k === 'stacks') { ok = diffs.length >= 1 && pr.results.length >= 2; note = 'selecting a different depth must change the strategy text'; }
      else if (k === 'library') ok = false;
      if (ok && !det) { ok = false; note += ' [FAILED determinism: same input twice differed]'; }
      give(k, ok ? 1 : 0, ok ? '' : 'not demonstrated: ' + note, ev);
      subs[k].sample = norm(base).slice(0, 160);
    }
    // trainer: >=40 consecutive items, no gate; menu features open without gate
    if (paths.trainer) {
      const p = await replay(E, paths.trainer, {}); let n = 0, gate = null;
      for (let i = 0; i < 48; i++) {
        const t = await p.evaluate(() => document.body.innerText); if (GATE.test(t)) { gate = t.match(GATE)[0]; break; }
        const j = await p.evaluate(() => { const c = [...document.querySelectorAll('[data-judgment]')].find(e => e.checkVisibility()); return c ? [...c.querySelectorAll('button')].filter(b => !b.closest('[data-coach]') && b.checkVisibility()).map(b => b.innerText) : null; });
        if (j && j.length) { const h = await p.evaluateHandle(() => [...[...document.querySelectorAll('[data-judgment]')].find(e => e.checkVisibility()).querySelectorAll('button')].filter(b => !b.closest('[data-coach]') && b.checkVisibility())[0]); await h.asElement().click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(150); n++; }
        const b = await visBtns(p); const k = b.find(x => /continue|next|ok|got it/i.test(x.t)); if (k) await clickNth(p, 'body', k.i); else if (!j) break;
      }
      await p._ctx.close();
      let menuGate = null; for (const f of Object.keys(paths)) { const q = await replay(E, paths[f], {}); const t = await q.evaluate(() => document.body.innerText); if (GATE.test(t)) menuGate = f; await q._ctx.close(); }
      give('trainer', n >= 40 && !gate && !menuGate ? 1 : 0, n >= 40 ? '' : `only ${n} consecutive drill items answered`, { items: n, gate, menu_gate: menuGate });
    }
    const points = Object.values(subs).reduce((a, s) => a + s.points, 0);
    return { points: +Math.min(points, MAX).toFixed(2), max: MAX, subs, features_found: Object.keys(paths) };
  } finally { await E.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root'); const root = i > 0 ? process.argv[i + 1] : '.';
  run({ root }).then(r => console.log(JSON.stringify(r, null, 1))).catch(e => { console.error(e); process.exit(1); });
}
