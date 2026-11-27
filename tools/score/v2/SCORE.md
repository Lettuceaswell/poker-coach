# Gauge v2 — frozen scoring spec (SCORE.md)

Total 100 = accuracy 20 + speed 10 + learning 20 (v1 children scaled 20/30, 10/15, 20/40; criteria in `tools/score/SCORE.md`) + legibility 20 + coaching 15 + reach 15 (browser modules in this directory). v1 vetoes cap the total at 40. Scorer: `node tools/score/v2/app-score-v2.js [--root <dir>] [--json <file>] [--only <cat>] [--no-v1]`. Seed 20261127.

## Legibility (20) — formulas
Module: `tools/score/v2/legibility.js`. Phone Chromium (mobile+touch), ephemeral-port static server, Math.random seeded per hand.
Everything is observed from DOM geometry / computed style after real taps; no app source is read. `page.evaluate` only reads DOM/style/text and seeds the app's saved settings (seat count) in localStorage.
Sampling: 32 hands = 4 hands x seat counts 3,4,5,6 x viewports 390x844 and 360x740 (8 combos run in parallel). Content-text exemptions: `fixtures/legibility-exempt.json` (sha reported in JSON; base list is empty).

| sub-score | max | formula |
|---|---|---|
| (a) bet-chip overlap | 4 | `min(1, chips/30) * (1 - min(1, violations/chips))`. Chips polled every ~100 ms at each hero turn and after each opponent action; a violation must persist >= 2 consecutive polls (filters animation frames). Violations: seat with a committed bet (SB/BB preflop, or a Call/Raise/Bet action label, from displayed text) and no chip; chip hidden, no digit, < 16 px, effective opacity < 0.9, outside viewport, not topmost at its centre (`elementFromPoint`), or intersecting any hole/board/mini card, seat position/name/stack label, hero label, or another chip. |
| (b) position highlight | 4 | Sampler in the page reads each seat's position circle computed style every 50 ms from the new-hand deal. Lit = border brightness >= 100 (rest ~47) or glow alpha >= 0.5; the button seat uses glow alpha >= 0.5 only. Six properties, each = combos passing / 8: (1) first lap lights seats one at a time in clockwise (ascending seat index mod n) order starting at the button or the seat after it; (2) a lit seat stays lit until the lap completes (until the last seat lights); (3) all seats lit at once at lap end; (4) 3 laps on a new hand (median lit-episode count of non-button seats); (5) afterwards only the button is lit (non-button seats unlit, button has bright fill); (6) the later run (~6 s after) shows 2 laps and then button-only. Score = mean of the six. Unmeasured combos count as failures. Hero waits ~13 s on hand 1 of each combo so the later run is observed. |
| (c) min font size | 3 | `(0.5*(1-min(1,V/5)) + 0.5*(1-min(1,V/max(5,0.2*N)))) * covered/10`, V = unique violating items, N = text nodes checked, covered = named screens measured of 10. Content text < 13 px (exempt list aside). |
| (d) WCAG AA contrast | 3 | same formula; ratio of text colour (with effective opacity) vs the composited ancestor backgrounds; need 4.5:1 (3:1 if >= 24 px or >= 18.66 px bold). Gradients / images are ignored (documented limit). |
| (e) tap targets | 3 | same formula with N = visible topmost controls checked; width or height < 43.5 px is a violation. |
| (f) clipping | 3 | same formula; text box extending > 1.5 px beyond an overflow-hidden/clip ancestor, an ellipsised box, or the viewport horizontally. |

Named screens (10): menu, table at hero turn, result, drill question, drill answer, orbit review, Hands, Leaks, Progress, Settings. Plus a generic crawl of every `button, [role=button], a[href]` in `#menu` (depth 1) and in the opened `#panel` (depth 2, first 6 controls) so later screens are measured. Text covered by an overlay (not topmost at its centre) is skipped.

## Coaching (15) and Reach (15)

Files: `tools/score/v2/coaching.js`, `reach.js` (helpers in `cr-helpers.js`). Each exports `async run({root, seed, browser}) -> {points, max, subs}`; standalone: `node tools/score/v2/coaching.js --root .`. Mobile Chromium 390x844, RNG seeded, ephemeral static server. Points come only from taps/typing and observed DOM text/geometry; `page.evaluate` only reads DOM or seeds localStorage before load. App source is never read.

## App interface observed (from AGENTS.md)
- `data-judgment="calibration|drill-preflop|drill-postflop|quiz"` on each prompt container. Inside: `data-coach="definition|inputs|method|example|hint|hint-toggle|explain"`; hint hidden until `hint-toggle` tapped; `explain` only after reveal.
- `data-reward` on a reward element appearing after an answer.
- `data-feature="library|review|custom-solve|report|nodelock|multiway|export|stacks|trainer"` on each feature screen root, reachable from the menu by taps (depth <= 2 from the first screen, crawl in `cr-helpers.crawl`).
- Solver mix is read from revealed text as `Action NN%` pairs (e.g. "Call 70%, Fold 30%"); BB costs as `cost/lost/loss ... N BB`.

## Coaching (15 = 9 types + 3 fade + 3 reward)
Prompt types: frozen list (calibration, drill-preflop, drill-postflop, quiz) plus any other `data-judgment` value met while crawling/playing. Reach: crawl top-level menu buttons (and one level below), press drill/start-like buttons, answer up to 30 drill items (interleaving yields several types); calibration is reached by playing cash hands (tapping fold/check/call/continue up to 160 taps) until an orbit review prompt shows. Unreached type = 0.
Per type: 9/#types points, split over 5 elements (definition, inputs, method/example, hint, explain), each 1/5:
- definition: >= 6 words and not identical to the prompt's question line.
- inputs: >= 2 numbers, each also shown elsewhere on screen (page text with the inputs element removed).
- method: method+example text has >= 2 numbers and arithmetic (`a op b`, op in x * / + - = times divided plus minus over).
- hint: toggle present, hint hidden before tap, >= 3 words after tap, shown before commit, does not contain the revealed top action word or its percent.
- explain: empty before commit, >= 6 words after reveal, contains the revealed top action name or its frequency, and >= 2 of the prompt's input numbers.
Element credit if >= 50% of sampled prompts pass. Variation (inputs, method, explain): with >= 3 prompts of >= 3 distinct questions, identical text (all prompts the same, digits included) = 0; with fewer than 3 prompts the check cannot run and credit is halved ("variation unverified").
Fade (3): fresh profile (empty storage) must show a method with arithmetic by default (else 0); expert profile = frozen seed `localStorage["poker-coach-history-v1"] = {"calib":{"n":10,"hits":9,"width":20},"drills":{"n":100,"good":95,"queue":[]}}` (>= 8 of 10 hits) must show < 70% of the novice method+example text length, and the hint toggle still works: 3 points; reduced but hint fails 1.5.
Reward (3): items answered through drills; correct = clicked label matches the revealed top action; hard = 1 - top frequency >= 0.25, computed by the scorer. Rates: correct-hard with reward >= 70%, wrong <= 10%, correct-easy <= 40%; 1 point each, each needs n >= 3 in its bucket; n and items reported (aim >= 12 items). Reward counts only if newly visible after the answer; results waiting for a tap is checked by the continue step existing (advance clicks Continue-like buttons).
Seed schema for orbit review: the base app has no schema we may rely on; the scorer plays hands through the UI instead.

## Reach (15 = 9 x 15/9)
Each item earns 15/9 only if the screen is reachable and the behavior is observed:
1 library: a control changes the shown strategy, >= 2 percentages, frequencies sum ~100 (a row sums to 100+-2, otherwise <= 400 total).
2 review: text has solver/best line and BB figures; cost > 0 and a cost of 0 both appear (matching vs off-line decision).
3 custom-solve: >= 2 inputs; typing size 33 then 150 and tapping solve/run gives different strategies with >= 2 percentages.
4 report: rows `label N BB` sum to the `Total N BB` line within 0.1 and the report must differ between two UI-played hand sets (8 taps vs 40 taps of fold/check/call/continue on the cash table, then reload, reopen the report; storage persists in the context).
5 nodelock: tapping a lock control changes the response text.
6 multiway: text labeled estimate/approx/multiway, has a percentage, and differs after a second control change.
7 export: tapping export/download triggers a download that parses (JSON, or CSV with >= 2 comma lines) and contains >= 2 numbers shown on screen.
8 stacks: >= 2 controls; selecting a different depth changes the text.
9 trainer: >= 40 consecutive drill answers with no gate text (unlock|upgrade|premium|paywall|come back|limit|locked) and no gate on any menu feature.
Determinism: the same control tapped twice yields identical text (else the item fails). Absent feature = 0 with note.

## Frozen text formats (part of the app interface; lanes build to these)
- Solver mix, anywhere a strategy is shown (library, review, custom-solve, nodelock, multiway, stacks, explain after reveal): `Action NN%` pairs, e.g. `Call 70%  Fold 30%` (name, optional `:`/`=`, integer or decimal, `%`). A row (one line) must sum to 100 +-2.
- BB cost lines (review, report rows): `<label> ... N BB` or `cost|lost|loss ... N BB` (decimals ok). Review: cost `0 BB` for a decision equal to the solver's top action, `> 0 BB` for an off-line decision; both must be present in the review of the played/seeded hands, with the words solver/best/top/line.
- Report: one row per leak as `<position|street|spot label> N.N BB`, and one line `Total N.N BB` equal to the sum of row magnitudes (+-0.1). Rows are not prefixed by the word total.
- Multiway: text contains `estimate`, `approx` or `multiway`/`3-way`.
- Export: button text matches export|download|save; the file is JSON or CSV with the shown numbers.
- Nodelock: a button whose text contains `lock`; custom-solve: >= 2 text/number inputs plus a button matching solve|run|go|compute.
- Gate words that fail the trainer item: unlock|upgrade|premium|paywall|subscribe|come back later|daily limit|limit reached|locked|pro only.
## Speed (measured on the base app, alone)
crawl is shared by root, runs in parallel contexts under a 22 s budget; reach.js ~29 s, coaching.js ~42 s alone; module timeout in app-score-v2.js is 70 s (score 0 on timeout).
## Unproven
Live proof with an injected implementation was not done for any sub-score (deadline); every check above is exercised only against the base app (all absent = ~0).

## Baseline (base app, commit 31a9280, three sequential full runs, scorer copied into a detached worktree /tmp/z2-base)

Files: `runs/base-1.json`, `base-2.json`, `base-3.json`. Wall time per full run (incl. lock wait): 232 s, 203 s, 195 s (all <= 240 s; run 1 slower from a cold page cache).
Run 1-3 all carry the v1 veto `test-failure` (a LOG.md test fails in the /tmp worktree copy; cause not diagnosed before freeze, constant across runs). The veto cap is 40 and raw totals are below/near it, so the table uses `raw_total` ("non-veto total"); vetoes are reported separately and a veto in a candidate that the base does not have is a reject.

| Category (max) | Run 1 | Run 2 | Run 3 | Spread | MDE = max(2 x spread, 0.5) |
|---|---|---|---|---|---|
| accuracy (20) | 8.71 | 8.76 | 10.26 | 1.55 | 3.10 |
| speed (10) | 1.73 | 4.01 | 4.01 | 2.28 | 4.56 |
| learning (20) | 13.33 | 13.33 | 14.45 | 1.12 | 2.24 |
| legibility (20) | 10.32 | 10.32 | 10.36 | 0.04 | 0.50 |
| coaching (15) | 0 | 0 | 0 | 0 | 0.50 |
| reach (15) | 0 | 0 | 0 | 0 | 0.50 |
| non-veto total (100) | 34.09 | 36.42 | 39.08 | 4.99 | **9.98** (max(2 x 4.99, 1.0)) |

Accuracy/speed/learning are noisy because the v1 child runs the whole LOG.md load with timing-based sub-scores (run 1 speed 1.73 vs 4.01 after a cold start). Their MDEs are therefore wide; the climb lanes mostly move legibility, coaching and reach, whose spreads are tiny (the 0.5 floor binds).

## Keep rule (climb changes)
A change is kept only if (1) its target category gain >= that category's MDE above; (2) no other category drops by more than its own MDE; (3) no new veto; (4) every LOG.md test passes (rules-test, sim.js 300, coach-test, postflop-test.js --quick, mapcheck.js 6 300, shoot, coach-shots, orbit-nav). Total gain is reported against total MDE 9.98 but the per-category rule decides.

## Flake protocol
A lone `shoot.js` timeout veto is a flake only if `shoot.js` passes alone on rerun (the scorer reruns it once automatically and notes `shoot_rerun`). A module timeout (70 s) scores that module 0 and counts as a flake: rerun the module once alone in quick mode; keep the better run only if the rerun is clean, report both. Any score that moves by more than the category spread with no code change is a flake: rerun, never cherry-pick.

## Snapshot-scoring procedure
Commit own paths; `git worktree add --detach /tmp/<task>-snap <commit>`; symlink `node_modules` and each `data/*.bin` with ABSOLUTE paths (/home/lettuceaswell/Projects/poker-coach/...); run `flock /tmp/poker-zenith2-score.lock node tools/score/v2/app-score-v2.js --root /tmp/<task>-snap --json <out>`; `git worktree remove --force /tmp/<task>-snap`. Baseline was produced the same way from 31a9280.

## Quick mode
`--no-v1` (optionally `--only legibility|coaching|reach`): no v1 child, no LOG.md tools, no fixed ports, no lock, no speed timing; accuracy/speed/learning report 0. ~45 s for the three browser modules. For iteration only; the ledger needs the full locked run.

## Known limits / integration notes
- Coaching and reach are 0 on the base app by design (no `data-judgment` / `data-feature` hooks), so quick-mode self-checks of coaching-clarity changes can only be proven on copies that add the hooks (see VAL-GAUGE-007 report).
- AGENTS.md "Gauge check-fix policy" governs mis-specified coaching/reach checks.

## VAL-GAUGE-007 self-check (quick mode `--no-v1`, copies of the base app in /tmp; diffs saved as runs/copyA.diff, runs/copyB.diff)
| copy | change | legibility | coaching | reach |
|---|---|---|---|---|
| base | none | 10.32 | 0 | 0 |
| A | `.seat .bet-chip{margin-top:-90px!important;position:relative;z-index:5}` (opponent chips over cards) | 9.48 (chip overlap 3.88 -> 3.00, -0.84 >= MDE 0.5) | 0 (no change) | 0 (no change) |
| B | calibration `resultText()` returns '' (reveal result text removed) | 10.32 (no change) | 0 (no change) | 0 (no change) |

Copy B limitation: the base app has no `data-judgment`/`data-coach` hooks, so coaching is 0 before and after; the explanation sub-score cannot be shown dropping until a lane adds the hooks. The check's logic is coaching.js "explain" (empty before commit, >= 6 words after reveal, contains top action/frequency and >= 2 input numbers). Gaming copies C/D/E not run (deadline); logic: chip check requires a visible chip for every committed bet (hidden chip = violation, legibility.js); explain requires the true value/top action.
