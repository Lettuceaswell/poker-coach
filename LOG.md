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
| `node tools/solve.js <players> <minutes> [seed]` | Preflop solve; follow with `node tools/pack.js` |

The browser tools use playwright-core with `/usr/bin/chromium`. Long solves run under `systemd-run --user`; sessions kill background shells.

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
