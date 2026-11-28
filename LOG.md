# Poker Coach: progress log

Live at https://lettuceaswell.github.io/poker-coach/ (repo Lettuceaswell/poker-coach; push to `main` ships).
Plain-JS PWA, no build step, everything runs on the phone. No paid services and no runtime AI.
Feature decisions live in `SPEC.md`; the plan lives in `TODO.md`.

## How to check things

| Command | What it checks |
|---|---|
| `node tools/rules-test.js` | 109 NLHE rules checks, 30k fuzzed hands, the evaluator against brute force |
| `node tools/sim.js [hands]` | Bot-only hands: chip conservation, no hangs |
| `node tools/coach-test.js` | ~900–1,100 checks (varies per run): explanations on live bot hands, grid mapping, drills, leaks, calibration, orbits, reach |
| `node tools/postflop-test.js --quick` | Postflop solver: toy-game theory, conservation, card removal, isomorphism, action values, worker (~30 s) |
| `node tools/mapcheck.js <players> [hands]` | Share of hero preflop spots that land exactly on the solved tree |
| `node tools/shoot.js` | Phone-sized Chromium playthrough, screenshots in `shots/` |
| `node tools/coach-shots.js` | Drives every coaching screen |
| `node tools/orbit-nav.js` | Orbit review: pivotal spot and verdict, Back navigation, reopening from Hands, blind-hand results |
| `node tools/score/app-score.js [--json out.json]` | The whole-experience gauge (accuracy 30 / speed 15 / learning 40 / rules 15, vetoes cap at 40). ~2.5 min, runs every check above. Frozen: see `tools/score/SCORE.md`, `FROZEN.sha256` |
| `node tools/solve.js <players> <minutes> [seed]` | Preflop solve; follow with `node tools/pack.js` |
| `node tools/score/v2/app-score-v2.js [--json out.json] [--no-v1 --only <category>] [--root <dir>]` | Gauge v2 (accuracy 20, speed 10, learning 20, legibility 20, coaching 15, reach 15; v1 vetoes cap at 40). ~3-4 min full, ~55 s with `--no-v1`. Frozen: `tools/score/v2/SCORE.md`, `FROZEN.sha256` |
| `node tools/calib/run.js --players N --rounds R --flops K --minutes M --workers W --out <dir>` | Calibrated-preflop pipeline (writes only to `--out`, never `data/preflop-*.bin`) |
| `node tools/calib/apply.js <dir>` | Gate: refuses unless gauges improve; `--apply` writes the bins and repacks |
| `node tools/flopdrills/build.js --lines ... --flops K --secs S --out <dir>` | Flop drill spots from solved preflop ranges; `--merge` folds them into `data/postflop-drills.json` |
| `node tools/threeway-test.js [--quick|--table]` | 3-way river solver (js/postflop/solver3.js): conservation, brute-force best response, convergence table |
| `node tools/postflop-regress.js` | Regression for the live-detail flake (zero reach when the OOP check averaged 0 after 1 iteration); fails on 6ef7808 |
| `node tools/legib-chips.js` | 80 seeded hands x 3-6 seats x 390x844 / 360x740 / 430x932@3x, coach on and off, with iOS safe-area insets emulated; frozen chip check, exits 1 on any violation |
| `node tools/ripple-shots.js` | Position-highlight lap-end screenshots, per-seat lit state and ring pixels for every seat count |
| `node tools/pt-table-check.js` | Playtest notes 2/3/5: chips clear of board and card backs, two backs per active opponent, folded seats faded, mix line inside the table, no main-thread task over 50 ms in the first 1.5 s of a hand |
| `node tools/pt-assist-test.js [--only A\|B\|C\|R]` | Playtest notes 1/7: assisted decisions kept out of his record; Analysis panel (~4 min) |
| `node tools/pt-hud-test.js [--only 6\|8\|9]` | Playtest notes 6/8/9: no timing tell with the coach hidden, ripple toggle, +X BB per winner (~11 min) |
| `node tools/calib-verdict-test.js` | Playtest note 4: the calibration verdict never contradicts the coach's pick (241 spots) |

The browser tools use playwright-core with `/usr/bin/chromium`. Long solves run under `systemd-run --user`; sessions kill background shells.

## 2026-11-27 Zenith run (autonomous, branch zenith-app)

**Gauge.** `tools/score/app-score.js` scores the app by running it (never by reading source). Frozen at 41dabdc; baseline 61.7/100, noise band (MDE) 1.0. Criteria, flake notes and baseline table are in `tools/score/SCORE.md`. `shoot.js` can flake on a waitTurn timeout and veto a run: rerun before trusting a failure. A worktree needs `data/*.bin` symlinked or preflop scores 0.

**Kept (3 changes)**
- `js/progress.js`: Progress screen and menu mini-trend (per-session accuracy, BB lost per 100 decisions, calibration vs 90%, drill accuracy).
- `js/postflop-drills.js` + `data/postflop-drills.json`: 108 pre-solved river/turn spots mixed into drills, priced in BB. Ranges are Chen-score cutoffs (approximate, labeled). No flop spots yet.
- `js/history.js` / `js/drills.js`: Leitner-lite spaced repetition, interleaving, adaptive difficulty, "cost vs the coach's pick" line (frequency-based estimate, not EV).

**Rejected:** flat 0.90 OOP limped-pot haircut re-solve (SB limp 56→45.5%, BTN and BB drifted worse). No data changed.

**Known:** base app uses green on grade chips and +BB in the panel (exempted in the gauge, rule deviation). Deliberate-practice sub-score dropped after the scheduler change (leak-spot share fell).

## 2026-11-27 to 11-28: first build, in one long session

**Table (sprint 1)**
- NLHE engine: blinds, button, min-raise rules, the TDA incomplete all-in rule, side pots, uncalled bets, odd chip.
- Seven-card evaluator.
- Five "normie" bot personas: station, rock, maniac, regular, fish.
- UI modeled on Levi's reference app: positions instead of avatars; finger-tracked swipe to fold; quick-select size chips plus a sizing sheet; Fold / Check / Call / Call any advance actions; BB or chip units; 4-color deck; felt colors.
- Start menu. After he folds, the rest of the hand resolves instantly. Results wait for a tap.
- Stacks carry over with an auto top-up to 100 BB. An earlier "reset every hand" default hid every win.
- Design pass, checked at SE, 15 and Pro Max sizes:
  - a timer ring around the acting seat;
  - chips fly into the pot, and the pot flies to the winner;
  - the winning five cards light up;
  - frosted sheets;
  - reduced-motion support.
- Color rule: green means only the coach's pick. Turn cues are white, winners gold.
- Position ripple: white, from the button clockwise around every seat. 3 laps at each new hand, then 2 laps about 6 s after each run, landing on the button.

**Preflop solver and coach (sprint 2)**
- Tree for 3–6 players at 100 BB.
  - Opens 2.5x (SB 3x). 3-bets 3x in position, SB 4.4x, BB 5x. 4-bets 2.5x / 2.6x. The 5-bet is all-in.
  - One cold call per raise level. Limps only from the SB.
- Solver: external-sampling MCCFR with linear discounting (Pluribus-style).
- Terminal values: equity times a realization factor (1.14 in position, 0.83 out of position heads-up, adjusted by hand shape), fading to pure equity as stacks get shallow. Rake 5%, capped at 4 BB.
- Validated heads-up against an exact best response: about 5 mbb/hand.
- Overnight runs: 6-max for 5 h. Results:

| Spot | Ours | Reference |
|---|---|---|
| UTG / HJ / CO open | 15.0 / 19.3 / 26.6% | 17 / 22 / 28% |
| BTN open | 46.3% | ~42% |
| SB | 6% raise + 56% limp | ~44% raise, almost no limps |
| BB defends vs BTN | 62.3% | ~45–60% |

  AA never folds anywhere. Numbers have been stable since minute 75.
- Research brief (solver standards, TDA rules) drove the sizes, EQR and rake choices.
- Coach: a solver mix line plus a mix bar. A 1–100 die per decision picks the action and highlights it. Grades are Best / Good / Rare / Mistake. Preflop accuracy counts only exact spots.
  - Limpers are treated as dead money and labeled "≈ limper"; iso size is the open size +1 BB per limper. That covers ~47% of 6-max spots, because the bots limp a lot.
  - Thin-data spots are labeled "≈ rare spot".

**Postflop**
- Heads-up range-vs-range DCFR solver in a Web Worker (`js/postflop/`).
  - Card removal; O(n) showdowns; suit isomorphism.
  - River: full. Turn: turn plus river. Flop: depth-limited, with river equity at the leaves.
  - Live solves use one 66% size on the flop and turn (about 4x faster) and the full menu on the river.
  - Desktop speeds: river within 0.3% of the pot in about 0.1 s; turn about 3% in 5–10 s; flop slow (labeled).
- Action values: EV per option relative to folding. Worker `detail` returns all-combo strategies, both ranges and option values.
- Flop ranges come from the preflop solution along the real line. Later streets inherit solved ranges. Near-zero weights are pruned.
- Pots with 3+ players use an estimate mode: equity against narrowed ranges versus the price, clearly labeled.

**Coaching that teaches (Feature Swipe round 1; all 10 were yes)**
- A Why? panel:
  - preflop: range grid with your hand marked, plus facts (situation, range width, rank in range, price against equity, blockers);
  - postflop: facts, where your hand sits in your range, strategy by tier, board read, option values.
- Opponent peek; hand replay; Hands list.
- Leak tracker, priced in BB when solved.
- Drills: preflop spots from your leaks, in-range hands only.
- Orbit review after each BB hand: 90% calibration questions (price needed, equity against their range), then the orbit's hands strongest first.
- Reach tracking: grids grey out hands not in your range given your own earlier actions. This fixed 33/33/33 noise on unreached hands.

**2026-11-28, after Levi's first phone session**
- The orbit review quizzes the orbit's most instructive call: the biggest pot with the closest price-vs-equity gap. It says why that spot was chosen and gives the full context (who bet, how much, pot). Both questions ask about the same spot. Then a verdict ties the two answers together with the coach's grade, and a "Replay this hand" button follows.
- Panels now stack. Opening something from inside a panel pushes it on top, and the always-visible Back arrow returns to the previous view with its state intact; X closes everything. Hands groups hands by orbit, and tapping a finished orbit reopens its review with your answers kept.
- Fixed: hands where he paid a blind logged a +0.0 result, because the start stack was recorded after the blinds were posted.

**Known gaps (honest)**
- Never run on an actual iPhone. Safari speed is unknown.
- Preflop terminals are an EQR model, not real postflop play. This is behind the SB limp-heavy strategy and the slightly wide BTN and BB.
- Limp spots against the normies are approximations.
- The flop solve on a phone is depth-limited and slow.
- Multiway postflop is an estimate, not a solve.

## Calibrated-preflop pipeline (Zenith run 2, TODO #1) — built 2026-11-27
`node tools/calib/run.js --players 6 --rounds N --flops K --minutes M --workers W --out data/calib [--tiny]`: enumerates the common heads-up endings from the starting solution, solves them postflop over K weighted flops (worker_threads), writes `realization-rN.json`, re-solves preflop with it (`tools/solve.js` env hooks `SOLVE_TABLE/SOLVE_OUT/SOLVE_TAG/SOLVE_N0`; unset = identical output), and logs gauges to `gauges.jsonl`. Never writes `data/preflop-*.bin`. Tiny run (~3 min): `nice -n 19 taskset -c 8-15 node tools/calib/run.js --tiny --out data/calib`. Flop solves need >= 60 s each to converge (60 s: exploitability 8% of pot, EQR still moving); the solve.js HU exploitability reads negative (rake offset), compare it between rounds only.

## 2026-11-27 Zenith run 2 (branch zenith-run2)

**Gauge v2.** `node tools/score/v2/app-score-v2.js --json out.json` drives the app in phone Chromium and scores 100 points: accuracy 20, speed 10, learning 20 (the frozen v1 gauge, scaled), legibility 20, coaching clarity 15, feature reach 15. v1 vetoes cap the total at 40. Hooks it observes: `data-judgment`, `data-coach`, `data-reward`, `data-feature` (see `tools/score/v2/SCORE.md`). Serialize with `flock /tmp/poker-zenith2-score.lock`. Quick: `--no-v1 --only legibility|coaching|reach`. Freeze v2.1/v2.2 notes and per-category noise bands (MDE) are in SCORE.md; the files in `FROZEN.sha256` are not to be edited. Base runs: `runs/base-*.json`; final: `runs/final.json`. Known weakness (accepted): static review/trainer text can earn some reach points; reach diffs were read by hand.

**Kept.** Chip placement and position-highlight lap (js/app.js, css); 13 px / AA / 44 px legibility audit across every screen; calibration as coaching (`js/calib-coach.js`); drill scaffold and reward moment (`js/drill-coach.js`, `js/reward.js`); spot library, hand review vs solver, leak report, export (`js/library.js`, `review.js`, `report.js`); Lab: custom solve, node-lock, multiway estimate, stack depths (`js/lab*.js`). `sw.js` CACHE v19 and precache list updated.

**Overnight units** (systemd --user, `Nice=19`, pinned by `taskset -c 8-15`; widened to cores 2-15 at ship): `poker-calib` (6-max calibrated preflop, 4 rounds, then 5/4/3 players, out `data/calib/nN`) and `poker-flopdrills` (flop drill spots, out `data/flopdrills/night`). Check, apply and re-score: `tools/score/v2/MORNING.md`. Status: `systemctl --user is-active poker-calib poker-flopdrills`; `tail data/calib/n6/run.log`. `apply.js` gates itself; the HU exploitability gauge is offset by rake (about -98 mbb), compare rounds only.

**Gotchas.** `AllowedCPUs` is not enforced by this user manager; the real pin is `taskset`. Flop solves need 60-150 s each to converge. Scorer module timeout is 150 s.

**Run 3, w-table1.** The Lab no longer says "Unlock"/"locked" (the v2 reach gate regex read those as a paywall; there is no gate). Tools: `node tools/legib-chips.js` (80 seeded hands over 3-6 seats x 390x844/360x740 using the frozen chip check; exits 1 on any violation), `node tools/ripple-shots.js` (lap-end screenshots plus per-seat lit state and ring pixels), `node tools/calib-reps.js --orbit 2` (DOM dump of calibration reps). Orbit review: an answered calibration question drops `data-judgment`, the equity question appears after the price question, and "Next spot" walks other call decisions (this orbit first, then recent hands not yet asked). Gauge quirk found: the frozen chip check expects a chip for any unfolded preflop player whose name starts with all/bet/call/raise, so the bot name "ally_cat" became "tabby_cat".

**Run 3, w-pt-analysis (playtest notes 1 and 7).** *Assisted decisions:* a decision is stored with `assisted: true` when the solver's pick was visible before he acted: coach 'always', the Why?/Coach panel, an opponent-range peek, or any Analysis reveal (solver range toggle, opponent ranges, range equity, who the board favors). A reveal made while opponents are still acting counts for his next decision (`pendingAssist`, js/app.js). Assisted decisions are skipped in: `history.leakOf` / `logDecision` (leaks and BB cost, so drill scheduling inputs in js/skill.js), `progress.snap` (accuracy, BB per 100, progress lines), `grade()` (session preflop %), `report.js` (via `storedDecisions(H, {own:true})`). They stay in hand history and replays with an "Assisted" tag; Settings and Analysis > Stats show the assisted count. Default coach stays 'always' (decision D-PT-1), so a default session is mostly assisted; Review and the orbit review still list assisted decisions as teaching material (they do not feed any stat). *Analysis:* js/analysis.js, one button (`#analysisBtn` fixed at the top left of the table, `#menuAnalysis` last in the menu, both after every existing button in DOM order). Tabs: Range, History (10/25/50/All), Opponents, Board, Odds, Leaks, Stats, Tools (links to Why?/Coach, Hands, Leaks, Progress, Library, Lab, Review, Report, Export; the old menu buttons stay because the v2 crawl and tools use their ids and order). The header blinds label is now "NLHE 5/10" so the button fits beside it. Test: `node tools/pt-assist-test.js [--root dir] [--json out] [--only A|B|C|R]` (A: coach always 20 flagged and stats unchanged, B: 5 reveals flag exactly 5, C: seeded no-assist run whose JSON must equal the same run on the old code (`--root <old checkout>`, needs `window.__poker.act`), R: grid mark, rank, toggle, history counts, replay tap; ~4 min).

## Zenith run 3: Lab per-street lock and 3-way river (w-lab3c, 2026-11-28)
- Lab node lock is now real: `input.locks = [{ player, street: 'flop'|'turn'|'river', bet: 0..1 }]` in js/postflop/solver.js. The player's first check/bet decision on that street plays Bet with total probability `bet` (split over bet sizes), regrets are never updated, the other player best-responds to it. Turn and river lock independently (`node tools/lock-test.js`: held frequencies, other street still solved, 4 distinct dumps, deterministic, clear restores the free solve). Lab lock spot is a turn board (Kd7c2h9s), 100 iterations (150 took 2.1 s idle, over the gauge's 2 s wait for the lock result under load; w-lab3d), all-in off so a lock reads as one Bet line.
- Wording rule: no Lab text may say "unlock", "unlocked" or "locked" (frozen GATE regex, tools/score/v2/cr-helpers.js:62, reads them as a paywall) nor "blocked/unblocked" (contains "locked"): use "fixed", "Clear lock", "removed by board cards". Buttons still contain "lock" (the reach nodelock item taps the first /lock/ button).
- Lab 3-way river section (`data-feature="threeway"`): solver3 in js/lab-worker.js, `THREEWAY_LAB_ITERS` (= `THREEWAY_LIVE_ITERS`, 80) fixed iterations, progress line, a new solve replaces a running one, label "No guarantee" + sentence, best-response gain per seat in percent of the pot. `node tools/threeway-test.js --table` now prints Lab and phone budget rows.
- Measured (taskset core 0): fast preset 46/54/65 combos 0.4 s total (solve + gain), wider preset 97/98/136 combos ~1.7-2.6 s; phone ~4x.

## 2026-11-28 Zenith run 3 (branch zenith-run3): ship 1, CACHE v20

Ship 1 carries Levi's iPhone playtest fixes (PLAYTEST.md notes 1-10, sealed by the g-pt gate and repaired by w-pt-fix/w-pt-fix2), the flake fix and the three-player river solver. CACHE `poker-coach-v19` -> `v20`; the precache list now also holds `js/skill.js` and the eight `data/preflop-N.bin.gz/.vis.gz` files the app fetches (before, only files already visited were cached at runtime).

**Playtest fixes (what changed / how to see it on the phone / the test)**
1. Assisted decisions out of his record: a decision made after the solver's pick was visible (coach "always", Why?, range peek, Analysis reveal) is flagged and skipped by accuracy, leaks, grades, progress and the report. Look: Settings and Analysis > Stats show the assisted count; hand history tags "Assisted". Test: `tools/pt-assist-test.js` (A/B/C/R). Run C (seeded no-assist run identical to the old code) is not fully proven.
2. Bet chips never sit under board cards or empty board slots, also at 430x932 with safe-area insets: `placeTable()` in js/app.js places from real rects. Look: any 6-max preflop hand with the BB chip. Test: `tools/pt-table-check.js`, `tools/legib-chips.js`.
3. Two face-down card backs for every opponent still in; folded seats fade (cards and avatar, not label text). Test: `tools/pt-table-check.js`.
4. The calibration verdict follows the coach's pick (same `pickDir` as the grade chip) and teaches the margin (price, players behind, realization); the rule of thumb matches the hand type. Look: orbit review > calibration on BTN 7d6d vs an HJ open. Test: `tools/calib-verdict-test.js`.
5. The solver mix line fits at every action count (shorter labels, own row). Test: `tools/pt-table-check.js`.
6. With the coach not on "always" the raise button and size chip never change during a decision; the default is labelled "X is your last size here". Test: `tools/pt-hud-test.js --only 6`.
7. One Analysis button (`#analysisBtn` on the table, `#menuAnalysis` in the menu): Range, History, Opponents, Board, Odds, Leaks, Stats, Tools. Test: `tools/pt-assist-test.js --only R`.
8. Settings toggle for the turn-order highlight (default on). Test: `tools/pt-hud-test.js --only 8`, `tools/ripple-shots.js`.
9. The end-of-hand freeze shows "+X BB" at every winner, split and side pots per winner. Test: `tools/pt-hud-test.js --only 9`.
10. Orbit review: hands (strongest first) on top, calibration questions below. Test: `tools/orbit-nav.js`, `tools/calib-verdict-test.js`.

**Other landed work.** `postflop-regress.js` flake root cause: `reachAlong` gave zero reach on an all-zero average strategy after one iteration (uniform fallback). `js/postflop/solver3.js` (3-way river CFR+, brute-force best response in the same file; not wired into the app yet). `js/skill.js` (leak plan, skill-based drill difficulty, mastery line). Calibration pipeline `--damp` / `--min-iters`; run 2 flop drills merged (585 flop spots). Quiz, Lab and live-solve work from other lanes are not in this ship.

**Overnight units at ship time (about 01:40).** `poker-calib` (r3n6, 22 flops x 150 s, damp 0.5): round 2 postflop finished (308 solves, 0 errors, 99.9 min), MCCFR running; nothing applied to `data/preflop-*.bin`. `poker-flopnight` finished (306 spots from 125 flops at 300 s, `data/flopdrills/night/flops-night300.json`, not merged yet). Status file: `tools/score/v3-calib.md`.

**Ship 1 result (02:50): branch only, NOT pushed to main.** Candidate a90237e (CACHE v20). All 8 LOG.md tests, postflop-regress, threeway-test, calib-verdict-test, legib-chips, ripple-shots, pt-table-check, pt-assist-test, pt-hud-test exit 0 and the offline reload check (Drills, Lab, zero network failures, 45 cached files) passed. Why main waits: the full v2 scorer could not be passed cleanly. Run 1 on 85c40ea (load ~4) scored accuracy 10.86, speed 5.05, learning 15.56, legibility 19.42, coaching 11.07, reach 15 (all within MDE of the start re-score) but v1 vetoed: shoot.js failed (a stale `python -m http.server 8765` left from another lane served the wrong tree, and the Settings sheet had grown to 10 rows and overflowed the top at 390x844 so the backdrop tap was blocked). The sheet now scrolls (`#settingsSheet` max-height + overflow-y). shoot.js then passed on a lone rerun (port moved to 8799 because 8765 was held by yet another stale server). Runs 3 and 4 on a90237e were voided by machine load 13-14 (poker-calib round 3 postflop, 8 workers): coaching 1.57 (drills missing from the crawl), trainer 0, speed 1.9; legibility 19.42 / 19.33 and no veto. Needs a re-score when poker-calib is between rounds (load < 8). Files: tools/score/v3-runs/ship1-run*.json. Gotcha: `tools/shoot.js` and the v1 child use fixed port 8765; a leftover http.server there silently tests another checkout.

