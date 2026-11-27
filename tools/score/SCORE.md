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
