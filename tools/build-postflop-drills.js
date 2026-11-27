// Offline builder: solves heads-up river and turn spots with js/postflop/solver.js and stores hero hand +
// options + solver mix + EV (BB) in data/postflop-drills.json. Ranges come from the solved 6-max preflop
// strategy along each line (tools/flopdrills/lines.js: BTN/CO/SB vs BB single raised pots, BTN vs BB 3-bet pot).
// Turn/river ranges are those preflop ranges thinned to the strongest share by hand strength (labelled, not solved).
// Flop spots come from tools/flopdrills/build.js and are added with its --merge step.
// Usage: node tools/build-postflop-drills.js [secsPerSolve]
import fs from 'node:fs';
import { solveSpots, SIZES } from './flopdrills/spots.js';
import { LINES } from './flopdrills/lines.js';

const SECS = +(process.argv[2] || 3);
let seed = 20261127;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function board(n) { const d = [...Array(52).keys()]; const b = []; while (b.length < n) b.push(d.splice(Math.floor(rnd() * d.length), 1)[0]); return b; }

const spots = [];
const plan = [['river', 5, 0.6, 1, 2], ['turn', 3, 0.8, 3, 1]]; // street, boards per line, keep, secs multiplier, spots per node
for (const line of Object.keys(LINES)) for (const [street, n, keep, mult, per] of plan) {
  for (let k = 0; k < n; k++) {
    const bd = board(street === 'river' ? 5 : 4);
    const r = solveSpots({ lineName: line, board: bd, street, keep, secs: SECS * mult, rnd, perNode: per, potMult: (line.endsWith('3BP') ? { river: 2.2, turn: 1.5 } : { river: 4.5, turn: 2.2 })[street] });
    if (r.skipped) { console.log('skip', line, street, r.exploit.toFixed(1)); continue; }
    for (const s of r.spots) spots.push({ id: spots.length, ...s });
    console.log(line, street, bd.length, 'boards ok', r.spots.length, 'spots exploit', r.exploit.toFixed(2));
  }
}
fs.writeFileSync(new URL('../data/postflop-drills.json', import.meta.url), JSON.stringify({ v: 2, note: 'ranges from solved 6-max preflop strategy along each line; turn/river thinned by hand strength; EV in BB relative to folding now', spots }));
console.log(spots.length, 'spots', JSON.stringify(spots[0]));
