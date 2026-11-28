// Multiway range-vs-range equity for the Analysis Board tab (playtest note 7).
// Each live player's range (preflop solution, narrowed along the hand, board cards removed) is sampled
// against the others with exact card removal; the share is each range's equity (ties split).
// River: nothing left to deal, so it is the range-vs-range result on this exact board. Flop/turn: the
// remaining board cards are dealt at random, so it is a sampled estimate and the screen says so.
import { preflopRanges, toCombos, narrow, COMBOS } from './ranges.js';
import { evalHand } from './cards.js';

export function multiwayShares(game, strat, sims = 3000, rng = Math.random) {
  const seats = game.players.map((p, i) => i).filter(i => !game.players[i].folded && !game.players[i].out);
  if (seats.length < 3 || game.board.length < 3) return null;
  const { ranges } = preflopRanges(game, strat);
  const ws = seats.map(i => narrow(game, i, toCombos(ranges.get(i), game.board)));
  const cum = ws.map(w => { const c = new Float64Array(1326); let t = 0; for (let j = 0; j < 1326; j++) { t += w[j]; c[j] = t; } return c; });
  if (cum.some(c => c[1325] <= 0)) return null;
  const draw = (c) => { const r = rng() * c[1325]; let lo = 0, hi = 1325; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] >= r) hi = m; else lo = m + 1; } return lo; };
  const share = new Float64Array(seats.length);
  let done = 0;
  for (let s = 0; s < sims * 4 && done < sims; s++) {
    const used = new Set(game.board), hands = [];
    let clash = false;
    for (let v = 0; v < seats.length && !clash; v++) {
      const [a, b] = COMBOS[draw(cum[v])];
      if (used.has(a) || used.has(b)) clash = true; else { used.add(a); used.add(b); hands.push([a, b]); }
    }
    if (clash) continue;
    const full = game.board.slice();
    while (full.length < 5) { const c = Math.floor(rng() * 52); if (!used.has(c)) { used.add(c); full.push(c); } }
    const sc = hands.map(h => evalHand([...h, ...full]));
    const best = Math.max(...sc), winners = sc.filter(x => x === best).length;
    sc.forEach((x, v) => { if (x === best) share[v] += 1 / winners; });
    done++;
  }
  if (!done) return null;
  const out = seats.map((seat, v) => ({ seat, pos: game.positions()[seat], hero: !!game.players[seat].isHero, share: share[v] / done }));
  const k = out.length, fair = 1 / k;
  const sorted = out.slice().sort((a, b) => b.share - a.share);
  // a clear favorite leads its fair share by 6+ points and the runner-up by 3+
  const favorite = sorted[0].share >= fair + 0.06 && sorted[0].share - sorted[1].share >= 0.03 ? sorted[0] : null;
  return { players: out, favorite, sims: done, exactBoard: game.board.length === 5 };
}
