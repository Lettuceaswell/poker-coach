// Gate and apply a calibrated-preflop result.
//
//   node tools/calib/apply.js [--dir data/calib] [--players 6] [--round R] [--hu-tol MBB] [--apply]
//
// Default is a dry run: it prints the checks and exits 0 (accept) or 1 (refuse); no file is touched.
// With --apply and all checks passing it backs up the current solution into <dir>/backup/, replaces
// data/preflop-N.bin (and .vis if the candidate has one) THROUGH its symlink, then runs tools/pack.js.
//
// Checks (candidate = <dir>/preflop-N-rR.bin, R = last round in <dir>/gauges.jsonl unless --round):
//   1. SB limp share goes down vs the current data/preflop-N.bin.
//   2. BTN RFI is closer to the reference (42%).
//   3. BB defense vs BTN open is closer to the reference band 45-60% (inside the band counts as distance 0).
//   4. HU exploitability (mbb/hand, gauges.jsonl huExploitMbb, same table-free vs table solve the run logged)
//      is not worse than the round-0 baseline: cand <= base + --hu-tol (default 0). Lower is better.
//   5. Sanity: gauges.jsonl round 0 matches the current bin (else the baseline is stale), candidate bin loads.
// Baseline gauges are recomputed here from data/preflop-N.bin with the same code the run used (tools/calib/lib.js).
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadBin, gauges } from './lib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const DO_APPLY = argv.includes('--apply');
const N = +opt('players', 6);
const DIR = path.resolve(root, opt('dir', 'data/calib'));
const HU_TOL = +opt('hu-tol', 0);
const REF = { btn: 42, bbLo: 45, bbHi: 60 };
const pct = x => +(100 * x).toFixed(2);
const bandDist = (x, lo, hi) => (x < lo ? lo - x : x > hi ? x - hi : 0);

const reasons = [], notes = [];
const fail = m => reasons.push(m);
const refuse = () => {
  console.log('\nREFUSED (no files changed):');
  for (const r of reasons) console.log('  - ' + r);
  process.exit(1);
};

const gfile = path.join(DIR, 'gauges.jsonl');
if (!fs.existsSync(gfile)) { fail(`${gfile} missing`); refuse(); }
const rows = fs.readFileSync(gfile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.players === N);
const base = rows.find(r => r.round === 0);
const rounds = rows.filter(r => r.round > 0);
const want = opt('round', null);
const cand = want != null ? rounds.find(r => r.round === +want) : rounds[rounds.length - 1];
if (!base) fail(`no round-0 baseline row for ${N} players in ${gfile}`);
if (!cand) fail(`no candidate round${want != null ? ' ' + want : ''} for ${N} players in ${gfile}`);
if (reasons.length) refuse();

const curFile = path.join(root, `data/preflop-${N}.bin`);
const candBin = path.join(DIR, `preflop-${N}-r${cand.round}.bin`);
if (!fs.existsSync(candBin)) { fail(`${candBin} missing`); refuse(); }

let cur, cnd;
try { cur = gauges(loadBin(N, curFile)); cnd = gauges(loadBin(N, candBin)); } catch (e) { fail(String(e.message)); refuse(); }
const B = { sbLimp: pct(cur.sbLimp), btn: cur.rfi.BTN != null ? pct(cur.rfi.BTN) : null, bb: cur.bbDefVsBtn != null ? pct(cur.bbDefVsBtn) : null };
const C = { sbLimp: pct(cnd.sbLimp), btn: cnd.rfi.BTN != null ? pct(cnd.rfi.BTN) : null, bb: cnd.bbDefVsBtn != null ? pct(cnd.bbDefVsBtn) : null };

// 5. baseline sanity: the run's round-0 row must describe the bin that is live now
const stale = [['sbLimp', base.sbLimp, B.sbLimp], ['BTN rfi', base.rfi?.BTN, B.btn], ['bbDefVsBtn', base.bbDefVsBtn, B.bb]]
  .filter(([, a, b]) => a != null && b != null && Math.abs(a - b) > 0.05);
if (stale.length) fail(`stale baseline: gauges.jsonl round 0 differs from current data/preflop-${N}.bin (${stale.map(([k, a, b]) => `${k} ${a} vs ${b}`).join('; ')})`);

const line = (name, b, c, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} base ${String(b).padStart(8)}  cand ${String(c).padStart(8)}  ${why}`); if (!ok) fail(`${name}: ${why}`); };
console.log(`apply.js ${DO_APPLY ? '--apply' : '(dry run)'}  players ${N}  dir ${path.relative(root, DIR)}  candidate round ${cand.round} (${path.relative(root, candBin)})`);

line('SB limp share (%)', B.sbLimp, C.sbLimp, C.sbLimp < B.sbLimp, `must decrease (${(C.sbLimp - B.sbLimp).toFixed(2)})`);
if (B.btn != null) {
  const db = Math.abs(B.btn - REF.btn), dc = Math.abs(C.btn - REF.btn);
  line('BTN RFI (%) vs ~42', B.btn, C.btn, dc < db, `distance ${db.toFixed(2)} -> ${dc.toFixed(2)}, must shrink`);
} else notes.push('no BTN seat at this table size; BTN RFI check skipped');
if (B.bb != null) {
  const db = bandDist(B.bb, REF.bbLo, REF.bbHi), dc = bandDist(C.bb, REF.bbLo, REF.bbHi);
  line('BB def vs BTN (%) 45-60', B.bb, C.bb, dc === 0 || dc < db, `distance to band ${db.toFixed(2)} -> ${dc.toFixed(2)}, must shrink or be inside`);
} else notes.push('no BTN seat at this table size; BB defense check skipped');
if (base.huExploitMbb == null || cand.huExploitMbb == null) fail('huExploitMbb missing from gauges.jsonl');
else line('HU exploitability (mbb)', base.huExploitMbb, cand.huExploitMbb, cand.huExploitMbb <= base.huExploitMbb + HU_TOL, `must not be worse than baseline (tol ${HU_TOL}); lower is better`);
if (stale.length) console.log('FAIL  baseline sanity           ' + reasons[0]);
for (const n of notes) console.log('note: ' + n);

if (reasons.length) refuse();
console.log('\nACCEPT: all checks pass.');
if (!DO_APPLY) { console.log('Dry run: nothing changed. Re-run with --apply to swap and pack.'); process.exit(0); }

// ---- apply: back up, write through the symlink, pack ----
const bdir = path.join(DIR, 'backup'); fs.mkdirSync(bdir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const ext of ['bin', 'vis']) {
  const live = path.join(root, `data/preflop-${N}.${ext}`), src = path.join(DIR, `preflop-${N}-r${cand.round}.${ext}`);
  if (!fs.existsSync(src)) { console.log(`no candidate .${ext}; leaving ${path.relative(root, live)}`); continue; }
  const real = fs.realpathSync(live);
  fs.copyFileSync(real, path.join(bdir, `preflop-${N}.${ext}.${stamp}`));
  fs.copyFileSync(src, real);
  console.log(`replaced ${path.relative(root, live)} -> ${real}`);
}
const r = spawnSync('node', ['tools/pack.js'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { console.log('pack.js failed; restore from ' + bdir); process.exit(2); }
console.log('Applied and packed. Next: bump CACHE in sw.js, run the LOG.md tests, rescore with v2.');
