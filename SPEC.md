# Poker Coach: spec

Features below were decided in Feature Swipe rounds (round 1: 2026-11-28).

## Coaching that makes you better (Y, all 10)

1. **Range grid.** A Coach button opens the 13x13 grid for the exact spot, each hand colored by the solver's mix, with your hand outlined.
2. **"Why" card.** The facts behind the pick, built from the numbers: the price to call against your equity versus their range, position, blockers, range rank. When the strategy is mixed it says so.
3. **Opponent range peek.** Tap a seat to see their likely range given this hand's actions, and the share of it you beat.
4. **Where your hand sits postflop.** Your hand's rank within your own range on the board, and what the solver does with each strength tier.
5. **Board read.** Texture tags, plus each side's equity and share of strong hands on the flop.
6. **What each option is worth.** EV per action in BB for heads-up postflop spots, so mistakes have a price. Preflop values are an estimate at most.
7. **Hand replay.** After each hand, a strip of your decisions with grades and cost; tap a step to reopen its grid and why card. Folded hands too.
8. **Leak tracker.** Mistakes grouped across sessions (e.g. "too loose UTG opens") and ranked by cost. Shown on the menu.
9. **Leak drills.** A Drills mode on the menu that serves preflop spots drawn from your top leaks, with instant grid feedback; spots you miss come back sooner. Postflop drills come later.
10. **Orbit review with calibration training** (changed by Levi from the pot-odds slider):
    - Appears once per orbit, right after your big-blind hand ends.
    - Opens with 90% interval questions about real spots from that orbit (Hubbard calibration). Example: "Give a low and high bound you're 90% sure contain the equity you needed to call." Asks about the price you needed and your real equity against their range, then reveals the truth.
    - Tracks your hit rate (target 90%) and how wide your ranges are.
    - Then lists the orbit's hands ranked strong to weak by starting hand; tap any one to open its replay.
    - The review doubles as a pacing marker: orbit count and position.
    - It can be skipped each time, and Settings can turn it off.

Built and live 2026-11-28. Postflop drills are still to come.

Rules from this round:
- Explanations come from solver data, not a live AI: no API keys, and everything works offline.
- Green stays reserved for the coach's pick.

## Zenith run 2026-11-27

Verdicts from the autonomous run, judged by the frozen gauge `tools/score/app-score.js`.

Kept:
- Postflop drills from pre-solved heads-up river/turn spots: answer first, reveal on tap (retrieval practice, Roediger & Karpicke 2006). Flop spots pending an overnight solve.
- Every postflop option priced in BB vs the solver's best; preflop answers show "cost vs the coach's pick ≈ X BB" (specific immediate feedback, Hattie & Timperley 2007). Preflop cost is a frequency-based estimate, not an EV solve: speculative precision.
- Interleaving: drills never repeat both spot type and position back to back; postflop items mix into the preflop stream on a different street when possible (Rohrer & Taylor 2007; Kornell & Bjork 2008).
- Spaced repetition, Leitner-lite: misses return in 2-3 items, then ~10 (~22 for postflop) (Cepeda et al. 2006, 2008). Within-session only; cross-day spacing is speculative and not built.
- Adaptive difficulty from rolling accuracy (>=80% edge-of-range hands, <=50% clear hands) (Bjork 1994, desirable difficulties). Speculative: measured effect is noisy.
- Progress screen and menu trend: per-session decision accuracy, BB lost per 100 decisions, calibration hit rate vs the 90% target, drill accuracy (visible progress; calibration per Lichtenstein & Fischhoff 1977, Hubbard).
- "Personal best" only on earned improvement (>=1 pt over >=8 decisions), never for activity (reward prediction error, Schultz 1997; transfer to learning is speculative).
- Postflop drill ranges are Chen-score cutoffs, not the preflop solution: speculative until rebuilt from the solve.

Rejected:
- Flat OOP limped-pot realization haircut (SB limp 56->45%, still far from ~0%; BTN worse).

Decided by Levi 2026-11-27: grade chips and +BB in review panels stay green. Also yes to: the overnight calibrated-preflop solve (TODO #1), overnight flop drill spots, and a reward moment after drill answers if it serves learning.
