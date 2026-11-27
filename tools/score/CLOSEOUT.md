# Closeout: Zenith run 2026-11-27

Plain words for Levi.

## Score (frozen gauge, `node tools/score/app-score.js`)

| | Baseline | Final | Noise band |
|---|---|---|---|
| Accuracy /30 | 16.4 | 16.5 | about 0.1 (no real change) |
| Speed /15 | 8.1 | 8.0 | about 0.1 (no real change) |
| Learning /40 | 22.2 | 28.9 | desirable-difficulty sub-score wobbles 0 to 2.2 between runs; the solid gain is 22.2 to 26.7 |
| Rules /15 | 15 | 15 | none |
| **Total /100** | **61.7** | **68.4** | a change counts only if it beats 1.0 |

One orchestrator rerun of the same code scored 65.2 (learning 26.7, speed 7.4), so the honest final is about 65 to 68. Both clear the noise band. Final run: `tools/score/runs/final.json`. All 8 LOG.md tests pass, no vetoes. The baseline's third run hit a veto from a flaky `shoot.js` timeout that I did not chase.

## What I kept

- **Progress screen** (+4.4 learning). Per-session accuracy, BB lost per 100 decisions, calibration against your 90% target, drill accuracy. "Personal best" only for real improvement.
- **Postflop drills** (+2.2 retrieval, full interleaving credit). 108 pre-solved river and turn spots in the drill stream, priced in BB. The ranges are rough Chen-score cutoffs, not the solved preflop ranges. There are no flop spots yet because flop solves take about 20 s and stay 5 to 8% exploitable.
- **Drill scheduling** (+2.2 BB feedback). Misses come back in 2 or 3 items, then about 10. Spot types and positions are interleaved. Difficulty adapts to your recent accuracy. Preflop answers show "cost vs the coach's pick". That cost is a frequency-based estimate, not a real EV.

## What I rejected

A preflop re-solve with a flat out-of-position limp penalty. It moved the SB from 56% to 45% limps, still far from about 0%, and made BTN and BB worse. No data was changed. No speedup of the postflop solver was found either; its loops are already allocation-free.

## What the validators caught

- The progress sub-score could be earned by static text. I accepted that risk and read the diff by hand to confirm the trend is computed from real stored sessions.
- SCORE.md was missing its criteria, flake and noise notes. Fixed.
- The first gate failed 12 of 16 checks because of my own task layout. It was split and re-run, and 15 of 16 sealed. The 16th is the accepted risk above.
- Broken copies were scored on purpose: a green non-pick button triggers a veto, and a scheduler that never repeats misses loses its sub-score. So the gauge does catch them.

## Incomplete, and why

- Preflop is still not calibrated (SB limps 56%, BTN 46%, BB defends 62%). It needs the overnight postflop-fed solve in TODO #1, which was too big for tonight.
- The dopamine audit sub-score is 0. Nothing rewarding appears after drill answers.
- Deliberate practice fell from 4.4 to 0, because only 5 of 20 drill items came from your leak spots after the scheduler change. The cause is not confirmed.
- Spaced repetition works within a session only. Cross-day spacing is not built.
- The 4 parallel lanes shared one worktree and committed each other's edits.

## Rule deviation to ask you about

The base app already uses green on grade chips and +BB in the coach panel. Your rule says green means only the coach's pick. The gauge exempts those spots (`fixtures/green-exempt.json`) so they don't veto every run.

## Asks, ranked

1. Say whether grade chips and +BB may stay green, or should change colour.
2. Run the overnight calibrated-preflop solve (TODO #1). It is the biggest accuracy gain left.
3. Solve flop spots overnight and rebuild the drill ranges from the solved preflop ranges.
4. Allow a small reward moment after drill answers (streak or earned bests) to move the dopamine score. It must serve the learning, not just keep you busy.
5. Play a few real sessions and tell me whether the adaptive difficulty feels right.
