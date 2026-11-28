#!/usr/bin/env node
// Gauge v2 (100): accuracy 20 / speed 10 / learning 20 (scaled from the unmodified v1 child run) +
// legibility 20 + coaching 15 + reach 15 (browser modules). v1 vetoes cap the total at 40.
// Usage: node tools/score/v2/app-score-v2.js [--root <dir>] [--json <file>] [--only <cat>] [--no-v1]
// --no-v1 = lock-free quick mode (no v1 child: no LOG.md tools, no fixed ports, no speed timing).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const V1 = path.resolve(opt('--v1-script') || path.join(HERE, '..', 'app-score.js')); // --v1-script only for the veto-cap demonstration with a stub
const ROOT = path.resolve(opt('--root') || path.join(HERE, '..', '..', '..'));
const JSON_OUT = opt('--json'), ONLY = opt('--only'), NO_V1 = args.includes('--no-v1');
const SEED = 20261127; const T0 = performance.now();
const MAX = { accuracy: 20, speed: 10, learning: 20, legibility: 20, coaching: 15, reach: 15 };
const r2 = x => Math.round(x * 100) / 100;
const want = c => !ONLY || ONLY === c;

function runV1(tmp) {
  return new Promise((resolve) => {
    let out = ''; const ch = spawn(process.execPath, [V1, '--root', ROOT, '--json', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = setTimeout(() => ch.kill('SIGKILL'), 200000); // v1 alone takes ~60-120 s; hard timeout scores 0
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    ch.on('close', (code) => { clearTimeout(kill); resolve({ code, out }); });
  });
}
async function rerunShoot() { // lone shoot.js timeout/flake protocol: rerun once alone
  return new Promise(resolve => { const ch = spawn(process.execPath, ['tools/shoot.js'], { cwd: ROOT, stdio: 'ignore' }); const k = setTimeout(() => ch.kill('SIGKILL'), 150000); ch.on('close', c => { clearTimeout(k); resolve(c === 0); }); });
}

const cats = {}; const vetoes = []; const notes = {}; let v1 = null;
// ---- v1 (alone, first, so its speed phase is clean) ----
const needV1 = !NO_V1 && (want('accuracy') || want('speed') || want('learning') || !ONLY);
if (needV1) {
  const tmp = path.join(os.tmpdir(), `v1-${process.pid}-${Date.now()}.json`);
  const t1 = performance.now(); const res = await runV1(tmp);
  notes.v1_wall_s = r2((performance.now() - t1) / 1000);
  try { v1 = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp); } catch { notes.v1_error = 'v1 produced no JSON (exit ' + res.code + '): ' + res.out.slice(-300); }
  if (v1) {
    const failed = v1.categories?.rules?.tests?.failed || [];
    let v1vet = [...(v1.vetoes || [])];
    if (v1vet.length === 1 && v1vet[0] === 'test-failure' && failed.length === 1 && failed[0] === 'shoot') {
      const ok = await rerunShoot(); notes.shoot_rerun = ok ? 'shoot.js failed once, rerun passed alone: test-failure veto dropped' : 'shoot.js failed on rerun: veto stands';
      if (ok) v1vet = [];
    }
    for (const v of v1vet) if (!vetoes.includes(v)) vetoes.push(v);
    const c = v1.categories; const sc = (k, f, m) => ({ points: r2(c[k].points * f), max: m, v1_points: c[k].points, v1_max: c[k].max, scale: `${m}/${c[k].max}`, subs: (k === 'accuracy' ? [...(c[k].preflop?.subs || []), ...(c[k].postflop?.subs || [])] : c[k].subs || []), observed: { v1_category: k } });
    if (want('accuracy')) cats.accuracy = sc('accuracy', 20 / 30, 20);
    if (want('speed')) cats.speed = sc('speed', 10 / 15, 10);
    if (want('learning')) cats.learning = sc('learning', 20 / 40, 20);
    notes.v1_vetoes_raw = v1.vetoes; notes.v1_frozen_ok = v1.frozen_ok; notes.v1_total_unscaled = v1.total;
  }
} else if (NO_V1) notes.no_v1 = 'quick mode: accuracy/speed/learning not measured (0)';
for (const k of ['accuracy', 'speed', 'learning']) if (want(k) && !cats[k]) cats[k] = { points: 0, max: MAX[k], subs: [], observed: { skipped: NO_V1 ? '--no-v1' : 'v1 failed' } };

// ---- browser categories (own chromium; run after v1 so speed timing stayed clean) ----
const subsList = (o) => Object.entries(o || {}).flatMap(([k, v]) => k === 'types' ? Object.entries(v).map(([t, x]) => ({ name: 'types.' + t, points: x.points, max: x.max })) : v && typeof v.points === 'number' ? [{ name: k, points: v.points, max: v.max }] : []);
async function mod(name, cat) {
  if (!want(cat)) return;
  const f = path.join(HERE, name + '.js'); const t = performance.now();
  if (!fs.existsSync(f)) { cats[cat] = { points: 0, max: MAX[cat], subs: [], observed: { missing: name + '.js not present: 0' } }; return; }
  let to; try {
    const m = await import(pathToFileURL(f).href);
    const res = await Promise.race([m.run({ root: ROOT, seed: SEED }), new Promise((_, rej) => { to = setTimeout(() => rej(new Error('module timeout 150 s')), 150000); })]);
    cats[cat] = { points: r2(res.points), max: MAX[cat], subs: Array.isArray(res.subs) ? res.subs : subsList(res.subs), observed: res.notes || res.observed || {}, wall_s: r2((performance.now() - t) / 1000) };
  } catch (e) { cats[cat] = { points: 0, max: MAX[cat], subs: [], observed: { error: String(e?.stack || e).slice(0, 400) } }; } finally { clearTimeout(to); }
}
await Promise.all([mod('legibility', 'legibility'), mod('coaching', 'coaching'), mod('reach', 'reach')]);

const raw = r2(Object.values(cats).reduce((s, c) => s + c.points, 0));
const total = vetoes.length ? Math.min(raw, 40) : raw;
let head = null, dirty = null;
try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
try { dirty = execFileSync('git', ['status', '--porcelain', '--', 'js', 'css', 'index.html', 'sw.js', 'data'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0; } catch {}
const out = { total, raw_total: raw, capped: vetoes.length > 0 && raw > 40, vetoes, categories: cats, v1: v1 ? { total: v1.total, categories: { accuracy: v1.categories.accuracy.points, speed: v1.categories.speed.points, learning: v1.categories.learning.points, rules: v1.categories.rules.points }, vetoes: v1.vetoes, wall_s: v1.wall_s } : null, notes, only: ONLY || null, no_v1: NO_V1, seed: SEED, root: ROOT, git_head: head, dirty, wall_s: r2((performance.now() - T0) / 1000), node: process.version };
console.log(`\nPOKER-COACH SCORE v2  ${total} / 100   (root ${ROOT})${vetoes.length ? `   VETO: ${vetoes.join(', ')} (cap 40, raw ${raw})` : ''}`);
for (const [k, c] of Object.entries(cats)) { console.log(`\n${k.toUpperCase()}  ${c.points} / ${c.max}`); for (const s of c.subs || []) console.log(`  ${String(s.name).padEnd(40)} ${String(r2(s.points)).padStart(6)} / ${String(r2(s.max)).padStart(5)}`); }
console.log(`\nwall ${out.wall_s}s head ${head} dirty ${dirty}`);
if (JSON_OUT) { fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); }
process.exit(0);
