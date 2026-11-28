# TODO: toward a top-quality NLHE solver

Ranked by leverage. The goal: answers you can trust like GTO Wizard's, computed on Levi's own machines at no cost, and fast on his phone.

## Next step (highest leverage)

**1. Replace the preflop shortcut with real postflop values ("calibrated preflop").**

*Status 2026-11-27: pipeline built and validated; running overnight as `poker-calib` (6-max 4 rounds, then 5/4/3) and `poker-flopdrills`. Morning: follow `tools/score/v2/MORNING.md` (check, `apply.js` gate, re-score with gauge v2). Nothing is applied to `data/preflop-*.bin` until the gate passes.*

*Why first:* every preflop answer, every flop range, and every grade built on them inherits the realization guess, a flat 1.14 / 0.83 adjusted by hand shape. It is the known cause of the SB's 56% limping, the BTN at 46% (vs ~42%) and the BB defending 62%. Pio does it properly by attaching real postflop trees to preflop.

*Plan* (runs overnight on BigOma as `systemd-run` jobs, Node, multicore):
1. Take the most common preflop endings: single-raised pots by opener vs caller (each seat vs BB, BTN vs SB/BB, blind vs blind, limped SB), plus 3-bet pots in and out of position.
2. For each, take the two players' ranges from the current preflop solution and solve heads-up postflop over a weighted flop subset. Use ~30–50 strategically distinct flops (isomorphism-weighted; the standard subset approach) with full turn and river trees on the PC, where memory isn't a problem.
3. Read each hand class's EV share and turn it into a realization table: class × spot × in/out of position.
4. Re-run the preflop MCCFR with that table instead of the flat factors. Repeat 2–3 rounds until the ranges stop moving (fixed-point).
5. Gauges, frozen before climbing:
   - RFI and BB defense against the reference table in LOG.md;
   - SB limp share;
   - heads-up exploitability (it must not get worse);
   - the drift between rounds.

*Cost:* about a day of building, then 1–3 overnight runs. No phone changes: the app just loads new `preflop-*.bin`.

## Status 2026-11-28 (Zenith run 3, ship 1 = CACHE v20)
- Playtest notes (PLAYTEST.md): 1 built (run C identity check not fully proven), 2 built, 3 built, 4 built, 5 built, 6 built, 7 built (Analysis, 8 tabs), 8 built, 9 built, 10 built. Open: confirm 2/3/5 on the real iPhone (430x932, safe-area insets).
- Calibrated preflop: r3n6 round 2 MCCFR running, apply gate not yet run. Flop re-solve finished (306 spots, not merged).
- Three-player river solver built (js/postflop/solver3.js), not yet in the app.

## Next steps after Zenith run 2
- Morning: check the units, apply if the gate passes, re-score (MORNING.md).
- Quiz prompt type (coaching quiz 0/2.25); calibration coaching is 1.35/2.25; reward 2/3.
- Learning gauge: deliberate practice and desirable difficulty sub-scores are 0.
- Library lacks postflop spots by board; node-lock is all-or-nothing; multiway is a labelled estimate; preflop is one stack depth (stacks are postflop only).

## Then

0. **Gauge follow-ups.** Dopamine and desirable-difficulty sub-scores are 0; deliberate practice regressed (leak-spot share in drills); cross-day spaced repetition not built; BB cost in preflop drills is a frequency estimate, not EV.

2. **Measure on a real iPhone.** (Needs Levi: play heads-up flop/turn spots and send the meter readings, or open a hidden `?bench` page I'd add.) This decides whether 4 is urgent.
3. **Limp-aware tree with locked normie ranges.** Add limp branches. Lock the limpers' ranges to the bots' actual limp strategies (node locking) so iso-raise ranges are solved, not approximated. Right now about 47% of 6-max spots are "≈ limper". Gauge: the `mapcheck` exact share rises from ~47–51% toward 90%+.
4. **Phone speed.**
   - Port the solver's hot loops to WebAssembly with SIMD, or compile b-inary/postflop-solver to WASM. Its license is AGPL; our repo is public, so that's compatible if we license to match.
   - Target: depth-limited flop within 1% of the pot in under 5 s, turn in under 2 s.
   - Then bring back the full flop/turn size menu (33/75/all-in).
5. **Pseudo-harmonic action translation and re-solving.** Map off-tree bot bets the standard way (Ganzfried–Sandholm), and re-solve from the actual bet size when it's far off-tree instead of snapping to the nearest size.
6. **Solver-based range narrowing for multiway pots.** Replace the heuristic `narrow()` (bet keeps strong plus some air) with ranges from solved or blueprint strategies.
7. **Three-way postflop.** Move multiway spots from "estimate" to a 3-player CFR solve, flagged with a "no guarantee" label (as GTO Wizard benchmarks it: lock one player, best-respond).
8. **More preflop sizes.** Multiple open and 3-bet sizes, plus 4-bet all-ins, once 1 is in place.
9. **Postflop drills.** *Partly done 2026-11-27: 108 river/turn spots shipped with approximate ranges; flop spots and solve-derived ranges remain.* A library of pre-solved spots (common flops for each preflop line) built on the PC, served like `preflop-*.bin`.
10. **Benchmarks and CI.** A fixed spot set with known published answers. Run it on every solver change and keep the history in `bench/`.
11. **A GTO bot table mode.** Opponents play the solver's strategy, so Levi can test himself against balanced play as well as normies.

## Small, open
- Bundle `data/eq169.bin` or document rebuilding it (`tools/solve.js` rebuilds it if missing, ~45 s).
- The hero's first-hand preflop decision isn't logged while the strategy file is still loading.
- `tools/coach-shots.js` can still flake on timing; harden its waits.
