// "Normie" opponents: average-ish players with a leak each.
import { chen, equity } from './cards.js';

export const PERSONAS = {
  station: { play: 4, raise: 11, threeBet: 13, aggr: 0.2, bluff: 0.03, stick: 1.6, noise: 0.08 },
  rock: { play: 8, raise: 9, threeBet: 12, aggr: 0.4, bluff: 0.02, stick: 0.8, noise: 0.04 },
  maniac: { play: 3, raise: 5, threeBet: 9, aggr: 0.75, bluff: 0.28, stick: 1.2, noise: 0.12 },
  regular: { play: 7, raise: 7, threeBet: 11, aggr: 0.55, bluff: 0.1, stick: 1.0, noise: 0.05 },
  fish: { play: 5, raise: 12, threeBet: 14, aggr: 0.3, bluff: 0.08, stick: 1.35, noise: 0.18 },
};
export const PERSONA_KEYS = Object.keys(PERSONAS);

const NAMES = ['riverrat', 'kev_22', 'jess.b', 'nitbot', 'lucky7', 'mo_money', 'ace_hi', 'big_sal',
  'chipz', 'turbo_tom', 'lindz', 'dee.dee', 'Porkchop', 'mr_fold', 'cardsharkk', 'tilted_tina',
  'gutshot_g', 'sammie', 'potlord', 'jjforlife', 'r0ckstar', 'busterb', 'tabby_cat', 'nuts_or_bust',
  'grandpa_joe', 'sunnyside', 'kingkongg', 'velvet', 'el_gato', 'hotdog_hal'];
export function makeBot(taken = new Set(), rng = Math.random) {
  const pick = (arr) => {
    const free = arr.filter(x => !taken.has(x));
    const v = free[Math.floor(rng() * free.length)] ?? arr[0];
    taken.add(v);
    return v;
  };
  return {
    name: pick(NAMES),
    persona: PERSONA_KEYS[Math.floor(rng() * PERSONA_KEYS.length)],
    isBot: true,
  };
}

const roundTo = (x, unit) => Math.max(unit, Math.round(x / unit) * unit);

export function decide(game, seat, rng = Math.random) {
  const p = game.players[seat];
  const P = PERSONAS[p.persona] || PERSONAS.regular;
  const L = game.legal();
  const bb = game.bb;
  const pot = game.totalPot;
  const raise = (to) => ({ type: 'raise', to: roundTo(Math.min(to, L.maxTo), game.sb) });
  const call = () => ({ type: L.canCheck ? 'check' : 'call' });
  const fold = () => ({ type: L.canCheck ? 'check' : 'fold' });
  const r = rng();

  if (game.street === 'preflop') {
    let s = chen(p.cards) + (rng() - 0.5) * P.noise * 20;
    const n = game.players.length;
    const fromBtn = (seat - game.button + n) % n;
    if (fromBtn === 0 || fromBtn === n - 1) s += 1; // button / cutoff play wider
    const toCallBB = L.toCall / bb;
    const unopened = game.currentBet <= bb;
    if (unopened) {
      const limpers = game.players.filter(q => !q.folded && q.bet === bb).length - 1;
      if (s >= P.raise && L.canRaise) return raise((2.5 + rng() + Math.max(0, limpers)) * bb);
      if (s >= P.play) return call();
      return fold();
    }
    if (s >= P.threeBet && L.canRaise && game.raiseCount < 4) return raise(game.currentBet * (2.8 + rng() * 0.7));
    const need = P.play + Math.log2(1 + toCallBB) * 1.6 / P.stick;
    if (s >= need) return call();
    if (L.toCall <= bb * 0.5) return call();
    return fold();
  }

  const opps = game.players.filter((q, i) => i !== seat && game.inHand(q)).length;
  const e = equity(p.cards, game.board, Math.max(1, opps), 160, rng) + (rng() - 0.5) * P.noise;
  const base = 1 / (opps + 1);
  const valueT = base + 0.25 * (1 - base);
  const raiseT = base + 0.5 * (1 - base);

  if (L.canCheck) {
    if (e > valueT && r < 0.45 + P.aggr * 0.5 && L.canRaise) return raise(pot * (0.45 + rng() * 0.4));
    if (r < P.bluff && L.canRaise) return raise(pot * 0.5);
    return call();
  }
  const potOdds = L.toCall / (pot + L.toCall);
  if (e > raiseT && rng() < P.aggr && L.canRaise && game.raiseCount < 4) {
    return raise(game.currentBet * 2.5 + pot * 0.3);
  }
  if (e * P.stick > potOdds) return call();
  if (rng() < P.bluff * 0.4 && L.canRaise && game.raiseCount < 3) return raise(game.currentBet * 2.5);
  return fold();
}
