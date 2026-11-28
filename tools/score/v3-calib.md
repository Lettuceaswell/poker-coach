# Run 3 calibrated-preflop status (owner tonight: w-night; later tasks append below)

Times America/Chicago, 2026-11-27/28.

## Run 2's rounds (data/calib/n6 in /home/lettuceaswell/Projects/poker-zenith2, 15 s flop solves, 40 flops, 14 spots, 8 workers)

| round | RFI UTG/HJ/CO/BTN % | SB limp / raise % | BB defends vs BTN % | HU exploit mbb | drift | apply.js dry run | applied |
|---|---|---|---|---|---|---|---|
| 0 (starting solution, flat factors) | 15.01 / 19.27 / 26.58 / 46.27 | 55.86 / 6.09 | 62.35 | -98.9 | n/a | n/a (baseline) | n/a |
| 1 | 17.07 / 21.88 / 26.11 / 41.55 | 74.77 / 10.26 | 35.62 | -87.2 | 0.07578 | REFUSED, exit 1 | no |
| 2 | not finished | not finished | not finished | not finished | not finished | REFUSED, exit 1 ("no candidate round 2 ... in gauges.jsonl") | no |

Round 1 dry run (`cd /home/lettuceaswell/Projects/poker-zenith2 && node tools/calib/apply.js --dir data/calib/n6 --players 6 --round 1`, exit 1):
- FAIL SB limp share: 55.86 -> 74.77 (must decrease)
- PASS BTN RFI: distance to ~42 went 4.27 -> 0.45
- FAIL BB defense vs BTN: 62.35 -> 35.62, distance to the 45-60 band 2.35 -> 9.38 (must shrink or be inside)
- FAIL HU exploitability: -98.9 -> -87.2 (must not be worse; lower is better)
Dry run wrote nothing: md5 of poker-zenith2/data/preflop-6.bin and poker-coach/data/preflop-6.bin both 9ae4a07116ed8072a5aac54931fa4149 before and after.

Round 2 at the stop (20:22 on 11-27): postflop finished (560 solves, 20.7 min, mean CFR iterations 23-944 per spot, 23 for the limped BB|SB|0 pot, 52 for BTN|BB|1), MCCFR at minute 42 of 120. The interim checkpoint (preflop-6-r2.log at 42.0 min) read RFI UTG 16.8 / HJ 19.5 / CO 25.1 / BTN 39.7, SB limp 61 (raise 4.5), BB defends 61.3, max AA fold 0.00; no gauge line was written, so round 2 has no verdict. I stopped run 2's unit `poker-calib` (this also cancelled its queued 5/4/3-player 15 s runs). Unit stop time 2026-11-27 20:22.

## Diagnosis in plain words (why round 1 was refused)
The flop solves got only 15 s each, which is 10 to 50 CFR iterations per flop in limped and single-raised pots (round 1 meanIters: BB|SB|0 = 10, BTN|BB|1 = 16, BB|SB|1 = 20, CO|BB|1 = 31, HJ|BB|1 = 33). That is far too few to settle, so the measured "how much of its equity does each seat realize" was noise, and it flipped sign between rounds (BB|SB|1 IP:OOP factor 0.74/1.11 in round 1, 1.13/0.78 in round 2). The preflop solver then trusted that noise (smoothing N0=20 gives the measurement 85-90% weight): it saw the limper realizing 1.68x what the big blind realizes, so limping looked great (SB limp 55.9 -> 74.8) and BB defense collapsed (62.4 -> 35.6, BTN|BB|1 IP:OOP 1.194/0.663 = 1.8 against 1.14/0.83 = 1.37 flat). Each round also started from a fresh table with no damping, so rounds oscillated instead of converging. No IP/OOP swap bug was found (file-cited in missions/mission-001/research/calib-diagnosis.md). Decision: round 1 refused (nothing applied, data/preflop-*.bin untouched); restart with an iteration floor, damping, a per-flop budget chosen by a probe, and SOLVE_N0=100.

## Code change (tools/calib/run.js, probe in tools/calib/probe.js)
- `--damp D` (default 1 = old behavior): each round's table is r = D*new + (1-D)*old per spot and per aggregate level, ip/oop, hand class with n>0 in both rounds.
- `--min-iters N` (default 0 = off): spots whose flops average fewer than N CFR iterations are dropped (flat factors) and logged ("dropped: meanIters ... < --min-iters").
- Every round logs `round R spot KEY meanIters N over K flops` for every spot in run.log.
- `node tools/calib/run.js --tiny --out /tmp/w-night-tiny` (defaults) still completes: exit 0, 2 rounds, 495 s wall.

## Probe (2026-11-27 20:12-20:22, cores 8-15 nice 19, 7 workers while run 2's MCCFR still ran on one core; data tools/score/v3-probe.jsonl)
4 flops each of the limped SB-vs-BB pot (BB|SB|0) and the BTN-vs-BB single-raised pot (BTN|BB|1), solved at 90 s and 300 s. IP:OOP realization ratio (aggregate realized share / equity share of IP divided by OOP's):

| spot | flop (card ids) | iters 90 s / 300 s | ratio 90 s | ratio 300 s | diff |
|---|---|---|---|---|---|
| BB\|SB\|0 | 10,24,28 | 80 / 273 | 1.105 | 1.052 | +5.0% |
| BB\|SB\|0 | 10,32,46 | 78 / 292 | 0.914 | 0.922 | -0.9% |
| BB\|SB\|0 | 12,33,38 | 61 / 214 | 0.934 | 0.984 | -5.1% |
| BB\|SB\|0 | 4,5,36 | 71 / 293 | 1.149 | 1.142 | +0.6% |
| BTN\|BB\|1 | 10,24,28 | 120 / 493 | 1.435 | 1.334 | +7.6% |
| BTN\|BB\|1 | 10,32,46 | 115 / 506 | 1.561 | 1.484 | +5.2% |
| BTN\|BB\|1 | 12,33,38 | 101 / 372 | 1.863 | 1.794 | +3.8% |
| BTN\|BB\|1 | 4,5,36 | 127 / 455 | 1.304 | 1.280 | +1.8% |

At 90 s all 8 ratios have the same side of 1 as at 300 s and are within 8% of it (max 7.6%), so the ratio does not move materially. But the limped pot reached only 61-80 iterations at 90 s, below the 100-iteration floor. Chosen budget: 150 s per flop (limped about 100-135 iterations, SRP about 200), with flops cut from 40 to 22 and --min-iters 100.
Also visible: the flat factors (IP 1.14 / OOP 0.83, ratio 1.37) are close to what converged SRP gives for some flops and above it for others (1.28-1.79), and the limped pot ratio is about 0.92-1.15, near 1, not the 1.68 of round 1.

## Restart (run 3 round set "r3n6")
Launched 2026-11-27 20:22:44 as unit `poker-calib` (Nice=19, cwd /home/lettuceaswell/Projects/poker-zenith3, taskset 8-15, SOLVE_N0=100):
`node tools/calib/run.js --players 6 --rounds 3 --flops 22 --flop-ms 150000 --minutes 75 --workers 8 --damp 0.5 --min-iters 100 --out data/calib/r3n6` (log data/calib/r3n6/run.log, gauges data/calib/r3n6/gauges.jsonl; binaries never committed).
ETA per round (estimate: 14 spots x 22 flops = 308 solves x ~153 s / 8 workers = ~98 min postflop, + 75 min MCCFR + ~4 min HU gauges; the round-0 baseline HU gauge adds ~2 min once): round 1 ~23:25, round 2 ~01:30, round 3 ~03:35. Revised from the first spots' wall time below.

## Flop re-solve unit (poker-flopnight)
Launched 2026-11-27 20:12 as unit `poker-flopnight` (Nice=19, taskset 5-7, 3 workers, `--skips-from data/flopdrills/night/night.log --secs 300 --tag night300`). Job list = the 125 `skip` lines of run 2's night.log (diff empty: data/flopdrills/night/night300.jobs.txt). ETA: 125 x ~300 s / 3 workers = about 3.5 h, so about 23:45 (revised from first 10 flops below). Output data/flopdrills/night/flops-night300.json (saved after every flop), log data/flopdrills/night300.log. Not merged yet (a later task merges what passes exploit <= 3).

## Final gates and flop merge (w-night-final3, 2026-11-28 03:46 CST)
Dry runs: `node tools/calib/apply.js --dir data/calib/r3n6 --round R` (exit codes below). Baseline (round 0, live data/preflop-6.bin): SB limp 55.86, BTN RFI 46.27, BB def vs BTN 62.35, HU -99.2 mbb.

| round | SB limp | BTN RFI | BB def vs BTN | HU mbb | drift | gate |
|---|---|---|---|---|---|---|
| 1 | 56.13 FAIL (must fall) | 40.29 PASS | 57.77 PASS | -87.0 FAIL (worse than -99.2) | 0.074 | REFUSED, exit 1 |
| 2 | 53.82 PASS | 40.57 PASS | 63.79 FAIL (distance to band 2.35 -> 3.79) | -88.8 FAIL | 0.071 | REFUSED, exit 1 |

Nothing applied: `data/preflop-6.bin` untouched (symlink to the main checkout). No thresholds edited. VAL-CALIB-004 (keep-rule run) not needed.
(Gauge note: the HU number is the same noisy 1-minute solve apply.js compares with tol 0; both rounds are about 11 mbb worse than the baseline.)

Round 3 is NOT waited for. Unit `poker-calib` keeps running (round 3 postflop until about 03:56, MCCFR ends about 05:11) and was not stopped. Levi gets round 3 in the morning: when `data/calib/r3n6/gauges.jsonl` has a round-3 row and the unit is done, run `node tools/calib/apply.js --dir data/calib/r3n6 --players 6 --round 3` (dry run, exit 0 = accept), and only then `--apply` (per tools/score/v2/MORNING.md section 3: backs up, writes through the symlink, packs), then bump CACHE, run the 8 LOG.md tests and a full v2 from a commit snapshot (keep rule in AGENTS.md). Rebuild flop drills against a new bin or note the mismatch.

Flop drills: `node tools/flopdrills/build.js --merge --out data/flopdrills/night` merged flops-night300.json (125 flops solved, 306 spots, max exploit 2.97, mean 2.25, all under the 3 cap): data/postflop-drills.json 741 -> 1047 spots (src flopdrills 585 -> 891), ids unique. After merge: coach-test 837 passed 0 failed, rules-test 109 passed 0 failed.
