# Zenith run 3 closeout (night of 2026-11-27 to 11-28), written for Levi

Branch `zenith-run3`. Final candidate: a80d0d2 (CACHE `poker-coach-v21`). Times are Chicago.

## 1. Score: start and finish (v2 gauge, 100 points)

Start = `tools/score/v3-runs/start.json` (6ef7808). Finish = `tools/score/v3-runs/final.json` (a80d0d2, full run, no veto, load about 4, 285 s). "Noise band" = the smallest change the gauge can tell from noise (MDE, tools/score/v2/SCORE.md).

| category | start | finish | change | noise band (MDE) | verdict |
|---|---|---|---|---|---|
| accuracy /20 | 10.89 | 10.77 | -0.12 | 3.10 | flat (noise) |
| speed /10 | 5.35 | 5.07 | -0.28 | 4.56 | flat (noise) |
| learning /20 | 13.33 | 15.56 | +2.23 | 2.24 | just under the band; real in kind (see below) |
| legibility /20 | 19.75 | 19.67 | -0.08 | 0.50 | flat (noise), above the 19.25 floor |
| coaching /15 | 10.85 | 11.07 | +0.22 | 0.50 | flat (noise) |
| reach /15 | 13.34 | 15.00 | +1.66 | 0.50 | real: 9 of 9 items |
| total | 73.51 | 77.14 | +3.63 | 9.98 | up, inside the total band |

Honest reading: only reach moved by more than noise. Learning gained 2.23 on 2.24, so call it a probable gain, not a proven one. Nothing dropped by more than its band.

Learning sub-scores (final vs run-2 reference g1.json 18.89, start 13.33):
- Gained against start: desirable difficulty 0 -> 4.44 and dopamine audit 0 -> 4.44 (skill-based difficulty, mastery line, reward after answers).
- Lost against g1: deliberate practice 0 (g1 2.22) and visible measured progress 0 (g1 4.44). Cause, decision D-PT-1: your playtest note 1 says a decision made after the solver's pick was visible must not count. The frozen gauge plays with the coach on "always", so every one of its decisions is "assisted" and kept out of the record, and the gauge sees no measured progress. This is the honest rule doing what you asked, not a bug. The gauge cannot be changed to hide it.
- Coaching quiz type 0 / 2.25: the gauge's crawl never reaches a Quiz prompt (the Quiz is a menu item; Drills now only interleave quiz items that are due, see section 3). Not diagnosed further tonight.

## 2. Reach: the commercial-tier features (final v2 reach 15/15)

Each item scored 1.67 / 1.67. Menu path on the phone:
- Spot library: menu > Library
- Hand review vs the solver: menu > Review (and Hands > a hand > review)
- Custom solves with custom sizes and ranges: menu > Lab (custom solve section)
- Aggregated reports: menu > Report
- Export: menu > Export
- Stack depths: Settings / Lab stack depth (the stacks item)
- Per-street node-lock: menu > Lab > lock section (flop, turn, river each lockable)
- 3-way river: menu > Lab > 3-way river section (live 3-way river decisions at the table use the same solver, labeled estimate if it times out)
- Trainer: menu > Drills

## 3. Kept changes and what each gained

Research behind each is in SPEC.md, section "Zenith run 3, 2026-11-28" (speculative items marked there).
- Playtest fixes, notes 1-10 (section 5), CACHE v20 then v21.
- Skill-based drill difficulty, leak-weighted drills, mastery line (js/skill.js): learning desirable difficulty and dopamine +4.44 each. Retrieval/difficulty research: Bjork 1994 desirable difficulties, Wilson et al. 2019 (about 85 percent success rate).
- Quiz prompt type with a cross-day schedule (spaced repetition: Cepeda et al. 2006). Final fix tonight (98485b0): Drills interleave only DUE quiz reviews. The earlier forced "every 8th item is a new quiz" stalled the frozen v1 drill loop (it waits for `.drill-acts`) and zeroed v1 learning (head-0400.json learning 2.22). `node tools/difficulty-test.js`: all ok after the fix. Quiz practice for new items lives in the Quiz menu.
- Per-street node-lock in the solver and Lab; three-player river CFR+ solver (solver3), wired into the Lab and live 3-way decisions. Reach nodelock and multiway both 1.67.
- Flake fix: `postflop-regress.js` (zero reach on an all-zero average strategy after one iteration).
- Settings sheet scrolls when its 10 rows overflow (shoot.js blocked at 390x844).
- Gain summary: see the table in section 1; the measurable gains are reach +1.66 and learning +2.23.

## 4. Calibrated preflop (6-max), round by round, and whether applied

Nothing was applied: `data/preflop-*.bin` are untouched. Every round the safety gate (`tools/calib/apply.js`) refused.

| run, round | RFI UTG / HJ / CO / BTN % | SB limp / raise % | BB defends vs BTN % | HU exploit mbb | gate |
|---|---|---|---|---|---|
| start (flat factors) | 15.01 / 19.27 / 26.58 / 46.27 | 55.86 / 6.09 | 62.35 | -99.2 | n/a |
| run 2, round 1 (15 s flops) | 17.07 / 21.88 / 26.11 / 41.55 | 74.77 / 10.26 | 35.62 | -87.2 | refused: SB limps rose, BB defense collapsed, exploit worse |
| run 2, round 2 | not finished | | | | refused: no round-2 candidate |
| run 3, round 1 (150 s flops, damp 0.5) | 16.34 / 20.87 / 24.61 / 40.29 | 56.13 / 12.94 | 57.77 | -87.0 | refused: SB limp share did not fall; exploit worse than start |
| run 3, round 2 | 16.22 / 20.09 / 25.36 / 40.57 | 53.82 / 12.62 | 63.79 | -88.8 | refused: BB defense further from the 45-60 band (2.35 -> 3.79); exploit worse |
| run 3, round 3 | MCCFR finishes about 05:11 | | | | not gated: gate in the morning |

Why run 2 failed: 15 s flop solves gave 10-50 CFR iterations, the measured realization was noise and flipped sign between rounds. Run 3 fixed that (iteration floor, damping, 150 s per flop, probe in tools/score/v3-probe.jsonl); run 3 rounds are stable (drift 0.074 -> 0.071) and the shape is sane (BTN RFI about 40, BB defense about 60), but SB limps and the exploit number still fail the gate by its rules.

Your morning step: `node tools/calib/apply.js --dir data/calib/r3n6 --round 3` (it dry-runs and refuses if worse). Full numbers: `tools/score/v3-calib.md`.

## 5. Your 10 playtest notes (PLAYTEST.md)

All built and on the branch (CACHE v20/v21). To see them on the phone you need the branch deployed: see "Push status" at the end.

1. Assisted decisions stay out of your record. Built: decisions made after the pick was visible (coach "always", Why?, range peek, Analysis reveal) are flagged and skipped by accuracy, leaks, grades, progress and report. See: Settings and Analysis > Stats show the assisted count; hand history tags "Assisted". Not fully proven: run C of `pt-assist-test.js` (a seeded no-assist run identical to old code) because postflop is timing dependent.
2. Chips under the board cards. Built: `placeTable()` places chips from real rects, tested at 430x932 with emulated safe-area insets (the bug only appears with insets: 315 violations before, 0 after). See: any 6-max hand with the BB chip. Tests: pt-table-check, legib-chips (96 hands, 0 violations).
3. Two card backs for every opponent still in, folded seats fade. See: any table hand.
4. Grade vs explanation contradiction. Built: the calibration verdict follows the coach's pick and teaches the margin (price, players behind, realization), rule of thumb matches the hand type. See: orbit review > calibration on BTN 7d6d vs an HJ open.
5. Clipped mix line. Built: shorter labels on their own row, fits at every action count.
6. Timing tell on the bet size. Built: with the coach not "always", the raise button and size chip never change during a decision; label "X is your last size here". Test: pt-hud-test --only 6 (see below).
7. Analysis button. Built: `#analysisBtn` on the table and menu > Analysis, tabs Range, History, Opponents, Board, Odds, Leaks, Stats, Tools. Correction to an earlier note: the Coach panel has no per-action EV table. EV in BB lives in drill review panels and in hand review. The Analysis panel gives a range grid with your hand, the solver range reveal, hand history with replay, opponent ranges, board texture, pot odds and equity, leaks in BB and session stats; it does not replace a GTO Wizard or Pio EV table.
8. Turn-order highlight toggle. Built: Settings toggle, default on, dealer button stays. Tests: pt-hud-test --only 8, ripple-shots.
9. Winner pot on the freeze. Built: "+X BB" at every winner, split and side pots per winner.
10. Orbit review layout. Built: hands strongest first on top, calibration questions below.

Not done: the assisted rule lowers the gauge's learning score (D-PT-1); a no-assist seeded oracle for run C.

## 6. Flop drills

1047 drill spots total (891 flop spots: 585 from run 2 plus 306 from tonight's 300 s re-solves). The night300 job: 125 flops, 102 solved with exploitability <= 3, 23 still skipped (best 3.02), 0 unfinished. Merged (9ef7c01); coach-test and rules-test pass after the merge. Gotcha: `build.js --merge` must use the default out dir (an empty dir overwrites the library).

## 7. What the validators caught

From `.zenith/decisions/2026-11-28-r3-what-validators-caught.md` and this list:
- Quiz interleave broke the frozen drill loop (v1 learning 2.22); fixed in 98485b0 and shown here by final learning 15.56.
- The honest assisted rule lowers gauge learning subs (D-PT-1, kept on purpose).
- The chip-behind-board bug only reproduced with iOS safe-area insets; run 2's "fixed" claim was wrong.
- Playtest CSS had dropped legibility to 18.86 (dealer contrast 1.06, faded names, a 100 ms placeTable task); repaired to 19.5+.
- Note 6 label never rendered (class clash with `.last`); fixed.
- Run C oracle was wrong (predated solver changes); contract corrected.
- 10-row Settings sheet overflowed and blocked shoot.js; stale `python http.server` orphans on port 8765 served the wrong tree; calibration load voided ship-1 gauge runs.
- Analysis competitor list in LOG/closeout was inaccurate (no per-action EV table); corrected in docs.
- Night300 counts missing from LOG; added.

## 8. Unsealed items (not sealed by the validators, plain reasons)

- VAL-LEARN-002, VAL-3WAY-002, VAL-PT-004, VAL-PT-008, VAL-PT-010: re-validated PASS (v2-drills2, v2-solver2, v3-ship3) but not sealable because the runtime gate counts earlier failing validators upstream.
- VAL-QUIZ-004, VAL-LEARN-003, VAL-LEARN-005: the quiz interleave broke the frozen drill loop; fixed in 98485b0 (final.json learning 15.56 shows it).
- VAL-PT-001, VAL-PT-006: evidence voided by machine load.
- VAL-PT-007: competitor list inaccurate; fixed in docs.
- VAL-NIGHT-003: LOG counts; fixed.

## 9. Incomplete

- Calibrated preflop not applied (section 4). Round 3 ungated.
- Quiz type 0 in the gauge's coaching score; deliberate practice and visible progress 0 in learning (section 1).
- Run C of the assist test not proven.
- Speed unchanged (5.07 of 10): the phone-class live solve budget did not move.

## 10. Asks (ranked, at most five)

1. Gate round 3 in the morning: `node tools/calib/apply.js --dir data/calib/r3n6 --round 3`; tell me if it passes so I apply it.
2. Play 30 hands on the phone with the coach on "After I act" and tell me whether the quiz interleave (due reviews only) feels right.
3. Decide on D-PT-1: keep gauge learning low for honest assisted-decision accounting, or allow a clearly labeled "practice mode" that counts.
4. Check the Lab 3-way river on the phone for solve time; tell me if it feels slow.
5. Send any new playtest screenshots; the table layout is checked at 430x932 with insets but only your phone is ground truth.
