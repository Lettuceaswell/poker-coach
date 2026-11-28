// Per-street node-lock checks (VAL-LOCK-001): node tools/lock-test.js
// Locks are real fixed nodes in js/postflop/solver.js (input.locks), not a re-solved subgame.
import { lockReport, parseRange, cardsOf } from '../js/lab-core.js';
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); if (!ok) fail++; };
const b = cardsOf('Kd7c2h9s');
const mk = () => ({ board: b, pot: 20, stack: 60, ranges: [parseRange('AA-77,AKs-ATs,KQs,98s,JTs,A5s-A2s', b), parseRange('KK-99,AQs+,AJo+,QJs,T9s,76s', b)], sizes: { bet: [0.66], raise: [3], allin: false, maxBets: 2, allinThreshold: 0.67 } });
const L = (s, f) => ({ player: 0, street: s, bet: f });
const run = (l) => lockReport(mk(), l, 150);
const R = { none: run([]), turn: run([L('turn', 0.7)]), river: run([L('river', 0.7)]), both: run([L('turn', 0.7), L('river', 0.7)]) };
const bet = (m) => (m.find(([n]) => n === 'Bet') || [0, 0])[1];
check(bet(R.turn.turn.oop) === 70 && bet(R.both.turn.oop) === 70, `turn lock held: OOP bets ${bet(R.turn.turn.oop)} / ${bet(R.both.turn.oop)} percent (asked 70)`);
check(bet(R.river.river.oop) === 70 && bet(R.both.river.oop) === 70, `river lock held: OOP bets ${bet(R.river.river.oop)} / ${bet(R.both.river.oop)} percent (asked 70)`);
check(bet(R.none.turn.oop) !== 70 && bet(R.none.river.oop) !== 70, `free solve differs from the lock (turn ${bet(R.none.turn.oop)}, river ${bet(R.none.river.oop)} percent)`);
check(bet(R.turn.river.oop) !== 70 && bet(R.river.turn.oop) !== 70, `locking one street leaves the other solved (river ${bet(R.turn.river.oop)} with turn lock, turn ${bet(R.river.turn.oop)} with river lock)`);
const j = (r) => JSON.stringify(r);
check(j(R.turn.turn.ipVsBet) !== j(R.none.turn.ipVsBet), `opponent response changes under a turn lock (IP vs bet ${j(R.none.turn.ipVsBet)} -> ${j(R.turn.turn.ipVsBet)})`);
check(j(R.river.river.ipVsBet) !== j(R.none.river.ipVsBet), `opponent response changes under a river lock (IP vs bet ${j(R.none.river.ipVsBet)} -> ${j(R.river.river.ipVsBet)})`);
check(new Set(Object.values(R).map(j)).size === 4, '4 distinct dumps: none, turn only, river only, both');
check(j(run([L('turn', 0.7)])) === j(R.turn), 'deterministic: same inputs, identical dump');
check(j(run([])) === j(R.none), 'clearing the locks restores the free solve exactly');
const ip = lockReport(mk(), [{ player: 1, street: 'turn', bet: 0.4 }], 150);
check(bet(ip.turn.ipAfterCheck) === 40, `IP can be fixed too (bets ${bet(ip.turn.ipAfterCheck)} percent after a check, asked 40)`);
console.log(fail ? `\n${fail} check(s) FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
