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

Rules from this round:
- Explanations come from solver data, not a live AI: no API keys, and everything works offline.
- Green stays reserved for the coach's pick.
