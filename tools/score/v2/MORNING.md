# MORNING: overnight units (poker-calib, poker-flopdrills)

Workspace: `/home/lettuceaswell/Projects/poker-zenith2`, branch `zenith-run2`. Launched 2026-11-27 16:50 CST.
Do not touch `poker-zenith2.service`. Never edit `data/preflop-*.bin` by hand; `apply.js` is the only writer.

## What is running

| Unit | Command (inside `bash -c`, cwd = workspace, `Nice=19`, `AllowedCPUs=8-15`) | Workers |
|---|---|---|
| `poker-calib` | `taskset -c 8-15 node tools/calib/run.js --players 6 --rounds 4 --flops 40 --minutes 120 --workers 8 --out data/calib/n6 > data/calib/n6.stdout`, then players 5, 4, 3: `--rounds 3 --flops 24 --minutes 45 --workers 8 --out data/calib/nN` | 8 |
| `poker-flopdrills` | `taskset -c 8-15 node tools/flopdrills/build.js --lines BTN-BB-SRP,CO-BB-SRP,SB-BB-SRP,BTN-BB-3BP --flops 80 --workers 6 --secs 120 --tag night --out data/flopdrills/night > data/flopdrills/night.log` | 6 |

8 + 6 = 14 workers (limit 14). The user manager did not enforce `AllowedCPUs` (processes showed affinity 0-15), so the real
pinning is the `taskset -c 8-15` inside each command; verify with `taskset -cp <pid>`.

Outputs: `data/calib/n6/` (run.log, gauges.jsonl, realization-rN.json, preflop-6-rN.bin/.vis/.log); the same for n5, n4, n3.
Flop drills: `data/flopdrills/night/flops-night.json` (rewritten after every solved flop).
The tiny-run files in `data/calib/` (top level) are only a test; ignore them.

ETA (6-max, per round): postflop 560 solves x 15 s / 8 workers ~ 18 min, MCCFR 120 min, heads-up gauge solve 1 min, so ~2.3 h per round.
Rounds stop early at drift < 0.004 (round >= 2). Expect round 1 ~19:10, round 2 ~21:25, round 3 ~23:45, round 4 ~02:00 (if no fixed point).
Players 5/4/3 follow (3 rounds x ~1 h each); they are a bonus and may still be running at ship time.
Flop drills: 320 solves x ~125 s / 6 workers ~ 2 h (longer under contention); finishes by ~19:30.

## 1. Check the units

```bash
date
systemctl --user status poker-calib poker-flopdrills --no-pager | head -30
systemctl --user is-active poker-calib poker-flopdrills        # active = still running; inactive = finished (see exit below)
systemctl --user show poker-calib -p ExecMainStatus -p Result  # after it ends: Result=success, ExecMainStatus=0
journalctl --user -u poker-calib -u poker-flopdrills -n 40 --no-pager
tail -n 15 data/calib/n6/run.log            # progress lines: "postflop k/560", "round r:", "gauge {...}", "fixed point", "done"
tail -n 5 data/calib/n6.stdout
cat data/calib/n6/gauges.jsonl | cut -c1-260   # one JSON line per round: rfi, sbLimp, bbDefVsBtn, drift, huExploitMbb
tail -n 10 data/flopdrills/night.log
node -e "console.log(JSON.parse(require('fs').readFileSync('data/flopdrills/night/flops-night.json')).spots.length,'flop spots so far')"
ls data/calib/n5 data/calib/n4 data/calib/n3 2>/dev/null | head   # which table sizes ran
for u in poker-calib poker-flopdrills; do for p in $(cat /sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/$u.service/cgroup.procs); do taskset -cp $p; done; done
```

Healthy gauges: `sbLimp` falling from 55.9, `BTN` RFI near 42, `bbDefVsBtn` inside 45-60, `drift` shrinking round over round.
A `task error` line in run.log is a failed postflop solve (a few are tolerable; `no postflop result` aborts the run).

## 2. Resume or restart

The ship task may have paused both units (SIGSTOP). Resume:

```bash
systemctl --user kill -s SIGCONT poker-calib poker-flopdrills
# widen to the cores freed after the final score (only if the unit is not already pinned by taskset to 8-15, which it is, so this is cosmetic):
systemctl --user set-property --runtime poker-calib AllowedCPUs=2-15
```

Because the processes carry `taskset -c 8-15`, widening needs `for p in $(cat .../cgroup.procs); do taskset -acp 2-15 $p; done` (all threads).
If a unit died (`is-active` = failed): `journalctl --user -u poker-calib -n 80`; calib has no resume, so rerun
`node tools/calib/run.js --players 6 --rounds 3 --flops 40 --minutes 120 --workers 8 --out data/calib/n6b --start data/calib/n6/preflop-6-rK.bin`
(K = last finished round; `--start` is the new starting solution, round-0 baseline then reflects that file, so use `--start` only for continuation and
gate against the original with `apply.js` after copying its round-0 row; simplest is to apply the last good round of n6 and skip the rerun).
Flop drills keep everything solved so far in `flops-night.json`; just `--merge` it.

## 3. Apply the results

```bash
# a. gate (dry run, default): exit 0 = accept, exit 1 = refuse with reasons; no file is touched either way
node tools/calib/apply.js --dir data/calib/n6 --players 6; echo exit=$?
node tools/calib/apply.js --dir data/calib/n6 --players 6 --round 2     # pick a specific round if the last is worse
# b. swap + pack (only if a. accepted). Backs up to data/calib/n6/backup/, writes THROUGH the data/preflop-6.bin symlink, runs tools/pack.js
node tools/calib/apply.js --dir data/calib/n6 --players 6 --apply
#    repeat for 5/4/3 only if their dir exists and the dry run accepts (their reference band is the 6-max table, treat as weaker evidence):
for N in 5 4 3; do [ -f data/calib/n$N/gauges.jsonl ] && node tools/calib/apply.js --dir data/calib/n$N --players $N; done
# c. flop drills (re-ids data/postflop-drills.json spots; src:'flopdrills' are replaced on each merge)
node tools/flopdrills/build.js --merge --out data/flopdrills/night
# d. pack + cache
node tools/pack.js
sed -i "s/poker-coach-v\([0-9]*\)/poker-coach-v$(( $(grep -o "poker-coach-v[0-9]*" sw.js | head -1 | grep -o '[0-9]*$') + 1 ))/" sw.js && grep -n "const CACHE" sw.js
```

Note: the flop drills were built from the OLD preflop-6 ranges. If preflop-6 is swapped, rebuild them against the new bin for consistency
(`node tools/flopdrills/build.js ...` again, ~2 h) or accept the mismatch and say so in LOG.md.

### apply.js refusal thresholds (all must hold, else exit 1, nothing written)

1. SB limp share strictly lower than the current bin (baseline 55.86%).
2. BTN RFI closer to 42% (baseline 46.27%): `|cand - 42| < |base - 42|`.
3. BB defense vs BTN open closer to the 45-60% band (baseline 62.35%): distance to band shrinks, or the candidate is inside the band.
4. HU exploitability not worse than the round-0 baseline: `huExploitMbb(cand) <= huExploitMbb(base) + --hu-tol` (default 0; values are negative from the rake offset, compare only between rows; the 1-minute solve is noisy by a few mbb, so `--hu-tol 5` is a defensible override only if you say so in LOG.md).
5. gauges.jsonl round 0 must describe the live bin (stale baseline refuses).

Dry run on the tiny-run output (2026-11-27): `node tools/calib/apply.js --players 6` (round 2) REFUSED: BB defense 62.35 -> 65.87 (farther from the band) and HU -98.1 -> -92.5 (worse); `data/preflop-6.bin` md5 unchanged.
Round 1 with `--hu-tol 10` accepted (SB limp 55.86 -> 55.69, BTN 46.27 -> 41.11, BB 62.35 -> 53.25).

## 4. Rescore with v2 and acceptance

```bash
git add data/preflop-*.bin* data/postflop-drills.json sw.js 2>/dev/null; git status --short | head   # review, commit only your paths
flock /tmp/poker-zenith2-score.lock node tools/score/v2/app-score-v2.js --json /tmp/morning-score.json
```
Also run every test in `LOG.md`. Compare against the frozen baseline in `tools/score/v2/runs/` and the per-category MDEs in `tools/score/v2/SCORE.md`.

Accept the swap only if ALL hold:
- `apply.js` accepted (thresholds above);
- no veto from the v2 scorer, every LOG.md test passes;
- the v2 total does not drop by more than its MDE, and no category drops by more than that category's MDE;
- spot-check in the app: SB spots now show a raise/fold-heavy mix, BTN open and BB defend frequencies match the gauge, no AA fold.
Otherwise restore from `data/calib/n6/backup/` (`cp` the dated files back over `$(readlink -f data/preflop-6.bin)` and `.vis`, then `node tools/pack.js`).

## 5. Pause/resume during the final ship scorer run

The ship task pauses both units before scoring and resumes after, and records it:
```bash
systemctl --user kill -s SIGSTOP poker-calib poker-flopdrills   # then score
systemctl --user kill -s SIGCONT poker-calib poker-flopdrills
```
