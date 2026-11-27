// Solver-side checks for the gauge: preflop accuracy (decoded from data/), postflop accuracy at a
// fixed time budget, solver speed to a fixed exploitability, and the LOG.md test runner.
// Exploitability is ALWAYS computed by frozen-br.js on the candidate's average strategy.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { bestResponse } from './frozen-br.js';
import { preflopSpots } from './frozen-preflop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const K = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/score-constants.json'), 'utf8'));
export const SPOTS = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/solver-spots.json'), 'utf8'));
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const r3 = x => Math.round(x * 1000) / 1000;
const now = () => performance.now();

// ---- helpers --------------------------------------------------------------------------------
async function loadSolver(root) {
  const m = await import(pathToFileURL(path.join(root, 'js/postflop/solver.js')).href);
  return m.createSolver;
}
const rangesOf = f => [0, 1].map(p => { const w = new Float32Array(1326); for (const [i, x] of f.ranges[p]) w[i] = x; return w; });
const inputOf = f => ({ board: f.board, pot: f.pot, stack: f.stack, ranges: rangesOf(f), ...(f.sizes ? { sizes: f.sizes } : {}) });
const spotByName = name => [...SPOTS.river, ...SPOTS.turn, ...SPOTS.flop].find(s => s.name === name);

// ---- preflop (15 pts, 7 spots) ----------------------------------------------------------------
export function preflopCheck(root) {
  const c = K.preflop;
  const { spots } = preflopSpots(path.join(root, c.file));
  let total = 0, max = 0;
  const subs = Object.entries(c.spots).map(([k, b]) => {
    const v = spots[k];
    const dist = v < b.lo ? b.lo - v : v > b.hi ? v - b.hi : 0;
    const pts = b.pts * clamp(1 - dist / c.falloff_pp);
    total += pts; max += b.pts;
    return { name: `preflop ${k}`, points: r3(pts), max: b.pts, observed: { pct: r3(v), band: [b.lo, b.hi], ref: b.ref, logmd: c.logmd_current[k] } };
  });
  return { points: r3(total), max, subs };
}

// ---- postflop accuracy at a fixed time budget (15 pts; 3 river + 2 turn) ----------------------
export async function postflopAccuracy(root) {
  const createSolver = await loadSolver(root);
  const A = K.postflop_accuracy, subs = [];
  let total = 0, max = 0;
  for (const f of [...SPOTS.river, ...SPOTS.turn]) {
    const budget = A.budget_ms[f.street];
    let sub;
    try {
      const t0 = now();
      const s = createSolver(inputOf(f));
      let it = 0;
      while (now() - t0 < budget) { s.step(1); it++; }
      const elapsed = now() - t0;
      const e = bestResponse(s, f).exploit;
      const pts = A.pts_per_spot * clamp(1 - Math.log10(e / A.curve.full_at_pct) / Math.log10(A.curve.zero_at_pct / A.curve.full_at_pct));
      sub = { name: `postflop ${f.name}`, points: r3(pts), max: A.pts_per_spot, observed: { exploit_pct_pot: r3(e), budget_ms: budget, elapsed_ms: Math.round(elapsed), iterations: it, fixture: 'fixtures/solver-spots.json' } };
    } catch (err) { sub = { name: `postflop ${f.name}`, points: 0, max: A.pts_per_spot, observed: { error: String(err.stack || err).slice(0, 400) } }; }
    total += sub.points; max += sub.max; subs.push(sub);
  }
  return { points: r3(total), max, subs };
}

// ---- speed: wall time to a fixed exploitability, median of 3 ----------------------------------
async function timeToTarget(createSolver, f, c, repeats) {
  const times = [];
  // run 1: search; BR checks are done with the clock paused
  let s0 = now(), solveMs = 0;
  let s = createSolver(inputOf(f));
  solveMs += now() - s0;
  let its = 0, next = c.chunk * 2, found = null, lastE = null;
  while (solveMs < c.timeout_ms) {
    const t = now(); s.step(c.chunk); solveMs += now() - t; its += c.chunk;
    if (its >= next) {
      lastE = bestResponse(s, f).exploit;
      if (lastE <= c.target_pct) { found = its; break; }
      next = Math.max(its + c.chunk, Math.round(its * 1.2 / c.chunk) * c.chunk);
    }
  }
  if (found === null) return { timeout: true, times: [], last_exploit: lastE, iterations: its };
  times.push(solveMs);
  let verify = null;
  for (let r = 1; r < repeats; r++) {
    const t = now();
    const s2 = createSolver(inputOf(f));
    s2.step(found);
    times.push(now() - t);
    if (r === repeats - 1) verify = bestResponse(s2, f).exploit; // frozen BR on the last repeat
  }
  const sorted = times.slice().sort((a, b) => a - b);
  return { timeout: false, times: times.map(Math.round), median_ms: sorted[Math.floor(sorted.length / 2)], iterations: found, exploit_at_stop: r3(lastE), verify_exploit: verify === null ? null : r3(verify), verified: verify === null || verify <= c.target_pct * 1.05 };
}
export async function speedCheck(root, only) {
  const createSolver = await loadSolver(root);
  const S = K.speed, subs = [];
  let total = 0, max = 0;
  for (const [k, c] of Object.entries(S.spots)) {
    if (only && only !== k) continue;
    let sub;
    try {
      const f = spotByName(c.fixture);
      const r = await timeToTarget(createSolver, f, c, S.repeats);
      let pts = 0;
      if (!r.timeout && r.verified && c.baseline_ms > 0) pts = S.pts_per_spot * clamp(0.5 + Math.log2(c.baseline_ms / r.median_ms) / 4);
      sub = { name: `speed ${k}`, points: r3(pts), max: S.pts_per_spot, observed: { ...r, target_pct: c.target_pct, baseline_ms: c.baseline_ms, fixture: c.fixture } };
    } catch (err) { sub = { name: `speed ${k}`, points: 0, max: S.pts_per_spot, observed: { error: String(err.stack || err).slice(0, 400) } }; }
    total += sub.points; max += sub.max; subs.push(sub);
  }
  return { points: r3(total), max, subs };
}

// ---- LOG.md test tools, spawned in parallel ----------------------------------------------------
// pass criteria: exit code 0; sim additionally must print no HANG/CHIPS output; mapcheck must print a share.
export const TESTS = [
  { name: 'rules-test', args: ['tools/rules-test.js'] },
  { name: 'sim', args: ['tools/sim.js', '300'], extra: o => !/HANG|CHIPS|DRIFT|LOST/.test(o) },
  { name: 'coach-test', args: ['tools/coach-test.js'] },
  { name: 'postflop-test --quick', args: ['tools/postflop-test.js', '--quick'], extra: o => !/^\s+FAIL/m.test(o) },
  { name: 'mapcheck 6 small', args: ['tools/mapcheck.js', '6', '300'], extra: o => /exact [\d.]+%/.test(o) },
  { name: 'shoot', args: ['tools/shoot.js'] },
  { name: 'coach-shots', args: ['tools/coach-shots.js'] },
  { name: 'orbit-nav', args: ['tools/orbit-nav.js'] },
];
export function runTests(root, skipBrowser) {
  const list = TESTS.filter(t => !(skipBrowser && /shoot|coach-shots|orbit-nav/.test(t.name)));
  return Promise.all(list.map(t => new Promise(resolve => {
    const t0 = now();
    let out = '';
    const ch = spawn(process.execPath, t.args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = setTimeout(() => ch.kill('SIGKILL'), 150000);
    ch.stdout.on('data', d => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    ch.stderr.on('data', d => { out += d; });
    ch.on('close', (code, sig) => {
      clearTimeout(kill);
      const ok = code === 0 && (!t.extra || t.extra(out));
      resolve({ name: t.name, cmd: 'node ' + t.args.join(' '), exit: code, signal: sig, ok, ms: Math.round(now() - t0), tail: ok ? undefined : out.slice(-600) });
    });
  })));
}
export function testsScore(results) {
  const pts = K.rules.tests_pts;
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).map(r => r.name);
  return { points: r3(pts * passed / Math.max(1, results.length)), max: pts, passed, total: results.length, failed, results };
}
