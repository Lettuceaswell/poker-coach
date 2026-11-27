# Gauge scoring criteria

## Learning criteria (browser-checks.js, 40 pts = nine sub-scores of 40/9 = 4.444)

Run: `node tools/score/browser-checks.js [root]` (prints JSON; ~40-50 s). Phone-sized Chromium (390x844, mobile, touch), fresh context, `Math.random` seeded via `addInitScript`, local static server, 4 contexts in parallel. A check that throws scores 0 and logs `notes.error_*`. Postflop drills and a progress screen do not exist on the base commit and score 0 there.

| Sub-score | Rule (observed after real taps) | Base |
|---|---|---|
| retrieval practice | half: a drill shows no grade/solver mix before the tap and reveals after it. half: a postflop spot (board or flop/turn/river label) appears in drills and is graded. Preflop only = half marks | 2.22 |
| spaced repetition (VAL-SCORE-006) | answer ~23 drill items; every miss is logged. Full: a missed spot reappears within 8 items AND sooner than any correctly answered spot. Half: reappears within 20. Never reappears or no miss made = 0 | 4.44 |
| deliberate practice | seed leaks by playing loose/aggressive preflop (calls and raises everything); then drill 20 items. Full: >=50% of items come from the top-6 leak spots (`topLeaks` keys); half >=30%. No leaks seeded = 0 (inconclusive) | 4.44 |
| immediate specific feedback in BB | after each drill answer, text shows a BB/EV number. Full: >=80% of answers show BB; half: graded + solver mix but no BB number | 2.22 |
| calibration | half: an orbit review asks a 90% interval, Reveal raises `calib.n`. half: a later review shows the hit-rate ("caught the truth ... %") | 4.44 |
| interleaving | switch share over the first 12 drill items (spot type or position changed vs previous). Full at >=0.60, linear below | 4.44 |
| visible measured progress over time | after 2 seeded sessions (play+drills, reload, drills), a menu/Leaks/Hands/Settings screen shows a chart or trend text together with accuracy % or BB. Chart elements inside buttons/icons are ignored | 0 |
| desirable difficulty | two contexts seeded with drill history 58/60 vs 12/60 correct, 30 items each; item difficulty = 1 - top solver frequency. Full: hard-history mean exceeds easy-history by >=0.12, half >=0.07. (The history is seeded in localStorage; items are chosen by the app) | 0 |
| dopamine audit | a reward/progress element (class or text: streak, combo, xp, reward, level, confetti, burst, sparkle, "in a row", points) newly appears after >=70% of correct answers (>=3 correct) and after <=10% of wrong answers. Mere activity (stats line, Next button) does not count | 0 |

Base total (seeded run): 22.22 / 40.

## Rules, browser part (max 12)
- green-only-for-coach-pick (3): scan computed color/background/border/outline/shadow/gradient/svg fill of all visible elements on menu, table (hero turn), result, coach panels (Orbit, Hands, Leaks), drill question and answer. Green = hue 90-160, sat > 0.35, light 0.2-0.8. Allowed only for the pick selectors and exemptions in `fixtures/green-exempt.json` (sha256 reported in `notes.exemptSha256`). Coach pick must be observed green on the table, else 0 (inconclusive). Violation = veto `green-non-pick`.
- swipe-to-fold (2): CDP touch swipe up 180 px on `#heroCards` at hero's turn must fold. Fail = veto `swipe`.
- results-wait-for-tap (2): after a hand ends, wait 5.5 s: same hand, result and Next still shown, no new hand logged; the drill result likewise stays 5.5 s. Fail = veto `auto-advance`.
- no-network-outside-origin (2): every request host must equal the local origin, else veto `network`.
- no-emoji (1.5): `\p{Extended_Pictographic}` (suit glyphs excluded) over visited screens. black-background (1.5): body bg luminance < 0.06.

## Known base exemptions (justified in green-exempt.json)
The base app uses `--go` green for `#panel .up` (positive BB), `#panel .dot.g` and `#panel .grade.g` (grade chips) in review and drill screens. These deviate from "green only the coach pick" and are exempted, scoped to `#panel`, so base shows 0 violations.

## Broken-copy detection (tested in /tmp, VAL-SCORE-014/015)
- (a) `.btn[data-a=fold|call]` green: veto `green-non-pick` fires, rules 12 -> 9, learning unchanged (22.22).
- (b) `recordDrill` never queues misses (js/history.js ~109): spaced repetition 4.44 -> 0; learning 22.22 -> 17.78, nothing else moves.

## Baseline (3 sequential runs, commit 4b145be, seed 20261127)

| Category | Run 1 | Run 2 | Run 3 | Spread |
|---|---|---|---|---|
| accuracy (max 30) | 16.44 | 16.43 | 16.42 | 0.02 |
| speed (max 15) | 8.06 | 8.03 | 7.96 | 0.10 |
| learning (max 40) | 22.22 | 22.22 | 22.22 | 0.00 |
| rules (max 15) | 15.00 | 15.00 | 13.88 | 1.12 |
| **TOTAL** | 61.72 | 61.68 | 40.00 | 21.72 |
| wall s | 141.22 | 140.69 | 140.63 | |

Run 3 hit a veto `test-failure`: `node tools/shoot.js` timed out in `waitTurn` (30 s, unseeded app-side test, flaky; passed in runs 1-2 and in a standalone rerun) so the total was capped at 40. Excluding that flake, total spread is 0.04 (runs 1-2) so **MDE = max(2 x 0.04, 1.0) = 1.00**. Taken literally with the outlier, MDE = 43.44, which is meaningless; treat 1.00 as the working MDE, and re-run any candidate that shows a `test-failure` veto before judging it. Non-veto noise: speed spread 0.10, accuracy 0.02, learning 0.00. Vetoes: 0,0,1 (shoot flake). Each run ~142 s wall (< 200 s budget, no reduction needed).

## Accuracy, speed and rules (tests) criteria (solver-checks.js / app-score.js)
- Points: accuracy 30 = preflop 15 (7 spots, bands in fixtures/score-constants.json, falloff 8 pp) + postflop 15 (3 river + 2 turn, 3 pts each, fixed wall budget river 250 ms / turn 1200 ms incl. solver creation, log curve 0.003%..3% pot).
- Speed 15 = turn T1 (target 0.25% pot) + depth-limited flop F1 (target 3% pot), 7.5 each; pts = 7.5*clamp(0.5+log2(baseline/median)/4); baseline_ms 1520 / 3400 (measured alone on base commit); 4x faster = full marks; timeout = 0. Run 1 searches the iteration count to target (BR checks with the clock paused), runs 2-3 re-run that count; median of 3; last repeat re-verified with frozen BR.
- Rules 15 = tests 9 (passed/total, 8 LOG.md tools, exit code; sim also no HANG/CHIPS output, postflop-test no FAIL lines, mapcheck must print an exact share) + browser rule checks 6 (lane B rules.points/rules.max scaled to 6). Any failed test -> veto test-failure; any veto caps total at 40.
- Quick args: sim 300 hands, mapcheck 6 300, postflop-test --quick.
- Exploitability always from frozen-br.js (independent best response over the candidate's strategyTable/actionsAt/nodeInfo, frozen-eval7.js showdowns); on the base commit it matches solver.exploitability() to 4 decimals on all 6 fixture spots.
- Fixed ports used by LOG.md browser tools: 8765 (shoot), 8774 (coach-shots), 8776 (orbit-nav); lane B uses an ephemeral port.

Tests run by the rules category (8 LOG.md tools): rules-test, sim 300, coach-test, postflop-test --quick, mapcheck 6 300, shoot, coach-shots, orbit-nav.

## Baseline notes (orchestrator, 15:10)
- The 3 baseline runs were taken on 4b145be, whose tools/score files are byte-identical to the freeze commit 41dabdc (the freeze commit only adds FROZEN.sha256, SCORE.md and runs/). The validator's fresh runs on 41dabdc scored 61.59, inside the spread.
- Run 3's `test-failure` veto came from `tools/shoot.js` timing out in `waitTurn`. It is a pre-existing flaky test, not an app rule violation: it passed in runs 1–2, in a standalone rerun and in the validator's runs. TODO.md already lists browser-tool timing flakes (coach-shots); shoot.js has the same kind of timing wait.
- MDE per contract = max(2 × total spread, 1.0). Literal spread with the flaked run = 21.72 (MDE 43.4, meaningless because it measures the veto, not the noise). Non-veto spread = 0.04 → **working MDE 1.0**. Rule: a candidate showing `test-failure` is re-run once; two failures in a row count as real.
- Known weakness (validator, VAL-SCORE-005): the "visible progress over time" sub-score can be earned by static trend text. Accepted risk; the orchestrator inspects any candidate that gains that sub-score for real, data-driven trends before accepting.
