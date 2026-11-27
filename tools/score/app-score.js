#!/usr/bin/env node
// Whole-experience gauge for poker-coach. Usage: node tools/score/app-score.js [--root <dir>] [--json <file>] [--skip-browser]
// Accuracy 30 (preflop 15 + postflop 15) / Speed 15 / Learning 40 / Rules 15 (tests 9 + browser rule checks 6).
// Any veto caps the total at 40. Node built-ins + playwright-core only (via browser-checks.js).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Deterministic Math.random for everything the scorer itself runs (seeded mulberry32).
export const SEED = 20261127;
let _s = SEED;
Math.random = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const ROOT = path.resolve(opt('--root') || path.join(HERE, '..', '..'));
const JSON_OUT = opt('--json');
const SKIP_BROWSER = args.includes('--skip-browser');
const T0 = performance.now();
const sc = await import('./solver-checks.js');

const errBox = (name, max, err) => ({ points: 0, max, subs: [{ name, points: 0, max, observed: { error: String(err?.stack || err).slice(0, 500) } }] });
const guard = async (name, max, fn) => { try { return await fn(); } catch (e) { return errBox(name, max, e); } };

// frozen hash check (scorer + fixtures), relative to the scorer's own repo root
let frozen_ok = null, frozen_note = 'FROZEN.sha256 not present';
const FZ = path.join(HERE, 'FROZEN.sha256');
if (fs.existsSync(FZ)) {
  try { execFileSync('sha256sum', ['-c', '--quiet', 'tools/score/FROZEN.sha256'], { cwd: path.join(HERE, '..', '..'), stdio: 'pipe' }); frozen_ok = true; frozen_note = 'sha256sum -c passed'; }
  catch (e) { frozen_ok = false; frozen_note = 'sha256sum -c FAILED: ' + String(e.stdout || e.message).slice(0, 300); console.error('WARNING: frozen_ok=false', frozen_note); }
}

// ---- lane B (browser checks): learning 40 + browser rule checks ----
async function browserPart() {
  if (SKIP_BROWSER) return { learning: { total: 0, max: 40, subs: [{ name: 'learning (skipped)', points: 0, max: 40, observed: { skipped: '--skip-browser' } }] }, rules: { points: 0, max: 6, subs: [] }, vetoes: [], skipped: true };
  const file = path.join(HERE, 'browser-checks.js');
  if (!fs.existsSync(file)) return { learning: { total: 0, max: 40, subs: [{ name: 'learning (stub)', points: 0, max: 40, observed: { error: 'tools/score/browser-checks.js missing' } }] }, rules: { points: 0, max: 6, subs: [] }, vetoes: [], stub: true };
  const m = await import(pathToFileURL(file).href);
  return await m.runBrowserChecks({ root: ROOT, seed: SEED });
}

// ---- phase 1 (parallel): LOG.md tests + browser checks + preflop ----
const [testRes, browser, preflop] = await Promise.all([
  guard('tests', 9, () => sc.runTests(ROOT, SKIP_BROWSER)),
  (async () => { try { return await browserPart(); } catch (e) { return { learning: { total: 0, max: 40, subs: [{ name: 'learning (crashed)', points: 0, max: 40, observed: { error: String(e?.stack || e).slice(0, 500) } }] }, rules: { points: 0, max: 6, subs: [] }, vetoes: [], crashed: true }; } })(),
  guard('preflop', 15, async () => sc.preflopCheck(ROOT)),
]);
const phase1_s = (performance.now() - T0) / 1000;
// ---- phase 2 (alone, nothing else running): timed postflop budgets then speed ----
const post = await guard('postflop', 15, () => sc.postflopAccuracy(ROOT));
const speed = await guard('speed', 15, () => sc.speedCheck(ROOT));

const tests = Array.isArray(testRes) ? sc.testsScore(testRes) : { points: 0, max: 9, passed: 0, total: 0, failed: ['tests crashed'], results: [], error: testRes.subs?.[0]?.observed?.error };
const vetoes = [];
if (tests.failed.length) vetoes.push('test-failure');
for (const v of browser.vetoes || []) if (!vetoes.includes(v)) vetoes.push(v);
const bRules = browser.rules || { points: 0, max: 6, subs: [] };
const browserRulePts = bRules.max ? 6 * bRules.points / bRules.max : 0;
const cat = {
  accuracy: { points: r(preflop.points + post.points), max: 30, preflop, postflop: post },
  speed: { points: r(speed.points), max: 15, subs: speed.subs },
  learning: { points: r(browser.learning?.total ?? 0), max: 40, subs: browser.learning?.subs || [] },
  rules: { points: r(tests.points + browserRulePts), max: 15, tests, browser_rules: { points: r(browserRulePts), max: 6, subs: bRules.subs || [] } },
};
function r(x) { return Math.round(x * 100) / 100; }
const raw = r(cat.accuracy.points + cat.speed.points + cat.learning.points + cat.rules.points);
const total = vetoes.length ? Math.min(raw, 40) : raw;
const out = { total, raw_total: raw, capped: vetoes.length > 0 && raw > 40, vetoes, categories: cat, frozen_ok, frozen_note, root: ROOT, skip_browser: SKIP_BROWSER, seed: SEED, wall_s: r((performance.now() - T0) / 1000), phase1_s: r(phase1_s), browser_status: browser.stub ? 'stub' : browser.crashed ? 'crashed' : browser.skipped ? 'skipped' : 'ok', node: process.version };

// ---- print ----
const row = (n, p, m, extra = '') => console.log(`  ${n.padEnd(34)} ${String(r(p)).padStart(6)} / ${String(m).padEnd4 ? '' : ''}${String(m).padStart(4)}  ${extra}`);
console.log(`\nPOKER-COACH SCORE  ${total} / 100   (root ${ROOT})${vetoes.length ? `   VETO: ${vetoes.join(', ')} (cap 40, raw ${raw})` : ''}`);
for (const k of ['accuracy', 'speed', 'learning', 'rules']) {
  const c = cat[k]; console.log(`\n${k.toUpperCase()}  ${c.points} / ${c.max}`);
  const subs = k === 'accuracy' ? [...preflop.subs, ...post.subs] : k === 'rules' ? [{ name: `tests (${tests.passed}/${tests.total} pass${tests.failed.length ? '; FAIL ' + tests.failed.join(',') : ''})`, points: tests.points, max: 9 }, { name: 'browser rule checks', points: browserRulePts, max: 6 }, ...(bRules.subs || [])] : c.subs;
  for (const s of subs) console.log(`  ${s.name.padEnd(44)} ${String(r(s.points)).padStart(6)} / ${String(s.max).padStart(4)}  ${s.observed ? JSON.stringify(s.observed).slice(0, 110) : ''}`);
}
for (const t of tests.results || []) console.log(`  test ${t.name.padEnd(26)} exit ${t.exit} ${t.ok ? 'ok  ' : 'FAIL'} ${t.ms} ms`);
console.log(`\nfrozen_ok=${frozen_ok} (${frozen_note})  browser=${out.browser_status}  wall ${out.wall_s}s (phase1 ${out.phase1_s}s)`);
if (JSON_OUT) { fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); }
process.exit(0);
