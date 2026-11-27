# Poker Coach


Start here: `LOG.md` (what exists, how to test), `TODO.md` (next steps), `SPEC.md` (feature decisions).
6-max no-limit hold'em PWA: you play by hand against 2–5 average-level bots, with a solver coach.

- `node tools/sim.js [hands]`: hand-ranking checks plus bot-only hands (chip conservation, no hangs)
- `node tools/shoot.js`: plays in a phone-sized Chromium and writes screenshots to `shots/`
- `node tools/solve.js <players> <minutes> [seed]`: preflop solver (external-sampling MCCFR) -> `data/preflop-<n>.{bin,vis,log}`; `node tools/pack.js` gzips them for the app
- `node tools/mapcheck.js <players> [hands]`: share of hero preflop spots that land on the solved tree
- Ship: push to `main` (GitHub Pages). Bump `CACHE` in `sw.js` when the file list changes.
