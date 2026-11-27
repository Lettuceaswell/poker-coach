// No-limit hold'em table: blinds, betting rounds, all-ins, side pots, showdown.
import { newDeck, shuffle, evalHand, handName } from './cards.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class Game {
  constructor({ sb = 5, bb = 10, rng = Math.random } = {}) {
    this.sb = sb; this.bb = bb; this.rng = rng;
    this.players = [];
    this.button = -1;
    this.handNo = 0;
    this.handOver = true;
    this.result = null;
  }

  addPlayer(p) {
    this.players.push({ cards: [], bet: 0, totalIn: 0, folded: true, allIn: false, last: '', ...p });
  }

  next(i, pred = () => true) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (pred(this.players[j], j)) return j;
    }
    return -1;
  }

  get pot() { return this.players.reduce((s, p) => s + p.totalIn - p.bet, 0); }
  get totalPot() { return this.players.reduce((s, p) => s + p.totalIn, 0); }
  inHand(p) { return !p.folded && !p.out; }
  canAct(p) { return !p.folded && !p.out && !p.allIn; }

  // deck (optional): cards dealt from the END of the array, for tests
  startHand(deck) {
    const ps = this.players;
    for (const p of ps) {
      p.out = p.stack <= 0;
      p.cards = []; p.bet = 0; p.totalIn = 0; p.folded = p.out; p.allIn = false; p.last = '';
      p.shown = false; p.facedAt = null;
    }
    const seated = ps.filter(p => !p.out);
    if (seated.length < 2) throw new Error('need two players');
    this.handNo++;
    this.handOver = false;
    this.result = null;
    this.board = [];
    this.deck = deck ? deck.slice() : shuffle(newDeck(), this.rng);
    this.street = 'preflop';
    const live = (p) => !p.out;
    this.button = this.next(this.button, live);
    let sbI, bbI;
    if (seated.length === 2) { sbI = this.button; bbI = this.next(sbI, live); }
    else { sbI = this.next(this.button, live); bbI = this.next(sbI, live); }
    this.sbI = sbI; this.bbI = bbI;
    this.post(ps[sbI], this.sb);
    this.post(ps[bbI], this.bb);
    // deal two each, one at a time, starting left of the button
    for (let r = 0; r < 2; r++) {
      let i = this.button;
      for (let k = 0; k < seated.length; k++) {
        i = this.next(i, live);
        ps[i].cards.push(this.deck.pop());
      }
    }
    this.currentBet = this.bb;
    this.lastRaise = this.bb;
    this.raiseCount = 0;
    this.needs = new Set(ps.map((p, i) => i).filter(i => this.canAct(ps[i])));
    this.toAct = this.next(bbI, (p, i) => this.needs.has(i));
    this.history = [];
    if (this.toAct < 0 || this.needs.size === 0) this.endRound();
    else this.maybeSkip();
  }

  post(p, amt) {
    const x = Math.min(amt, p.stack);
    p.stack -= x; p.bet += x; p.totalIn += x;
    if (p.stack === 0) p.allIn = true;
  }

  legal() {
    const p = this.players[this.toAct];
    const toCall = Math.min(this.currentBet - p.bet, p.stack);
    const others = this.players.filter((q, i) => i !== this.toAct && this.canAct(q));
    // A player who already acted this street may only re-raise if the bet has grown by at
    // least a full raise since then (TDA: an incomplete all-in raise doesn't reopen betting).
    const reopened = p.facedAt === null || this.currentBet - p.facedAt >= this.lastRaise;
    const canRaise = p.stack > toCall && others.length > 0 && reopened;
    const maxTo = p.bet + p.stack;
    const minTo = Math.min(this.currentBet + this.lastRaise, maxTo);
    return { toCall, canCheck: toCall === 0, canRaise, minTo, maxTo, currentBet: this.currentBet };
  }

  act(type, to = 0) {
    if (this.handOver) return;
    const i = this.toAct;
    const p = this.players[i];
    const L = this.legal();
    if (type === 'check' && !L.canCheck) type = 'call';
    if (type === 'call' && L.toCall === 0) type = 'check';
    if (type === 'raise' && !L.canRaise) type = L.canCheck ? 'check' : 'call';
    if (type === 'fold' && L.canCheck && p.isBot) type = 'check';

    if (type === 'fold') {
      p.folded = true; p.last = 'Fold';
    } else if (type === 'check') {
      p.last = 'Check';
    } else if (type === 'call') {
      this.post(p, L.toCall);
      p.last = p.allIn ? 'All-in' : 'Call';
    } else if (type === 'raise') {
      to = Math.max(L.minTo, Math.min(L.maxTo, Math.round(to)));
      const raiseSize = to - this.currentBet;
      const opened = this.currentBet === 0;
      this.post(p, to - p.bet);
      if (raiseSize >= this.lastRaise) this.lastRaise = raiseSize;
      this.currentBet = Math.max(this.currentBet, to);
      this.raiseCount++;
      p.last = p.allIn ? 'All-in' : opened ? 'Bet' : 'Raise';
      this.needs = new Set(this.players.map((q, j) => j).filter(j => j !== i && this.canAct(this.players[j])));
    }
    p.facedAt = this.currentBet;
    this.history.push({ street: this.street, seat: i, type, amount: p.bet });
    this.needs.delete(i);
    this.advance(i);
  }

  advance(from) {
    const live = this.players.filter(p => this.inHand(p));
    if (live.length === 1) return this.finishUncontested(live[0]);
    // anyone still owing action?
    const pending = [...this.needs].filter(j => this.canAct(this.players[j]));
    if (pending.length) {
      this.toAct = this.next(from, (p, j) => this.needs.has(j) && this.canAct(p));
      return this.maybeSkip();
    }
    this.endRound();
  }

  // A player who is the only one able to act and already matches the bet has nothing to do.
  maybeSkip() {
    const p = this.players[this.toAct];
    const able = this.players.filter(q => this.canAct(q));
    if (able.length === 1 && p.bet >= this.currentBet) {
      this.needs.clear();
      this.endRound();
    }
  }

  endRound() {
    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.lastRaise = this.bb;
    if (this.street === 'river') return this.showdown();
    const able = this.players.filter(p => this.canAct(p));
    const live = this.players.filter(p => this.inHand(p));
    if (able.length <= 1) {
      // run it out
      for (const p of live) p.shown = true;
      while (this.board.length < 5) this.dealStreet();
      return this.showdown();
    }
    this.dealStreet();
    for (const p of this.players) { p.facedAt = null; if (p.last !== 'All-in' && p.last !== 'Fold') p.last = ''; }
    this.needs = new Set(this.players.map((p, i) => i).filter(i => this.canAct(this.players[i])));
    this.toAct = this.next(this.button, (p, i) => this.needs.has(i));
  }

  dealStreet() {
    this.deck.pop(); // burn
    if (this.board.length === 0) this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else this.board.push(this.deck.pop());
    this.street = STREETS[Math.min(3, STREETS.indexOf(this.street) + 1)];
  }

  finishUncontested(winner) {
    const amt = this.totalPot;
    for (const p of this.players) p.bet = 0;
    winner.stack += amt;
    this.handOver = true;
    this.result = { winners: [{ seat: this.players.indexOf(winner), amount: amt, hand: '' }], showdown: false };
  }

  showdown() {
    const ps = this.players;
    const live = ps.filter(p => this.inHand(p));
    for (const p of live) { p.shown = true; p.score = evalHand([...p.cards, ...this.board]); }
    const levels = [...new Set(ps.filter(p => p.totalIn > 0).map(p => p.totalIn))].sort((a, b) => a - b);
    const won = new Map();
    let prev = 0;
    for (const lv of levels) {
      let amt = 0;
      for (const p of ps) amt += Math.max(0, Math.min(p.totalIn, lv) - prev);
      const elig = live.filter(p => p.totalIn >= lv);
      prev = lv;
      if (!amt || !elig.length) continue;
      const best = Math.max(...elig.map(p => p.score));
      const ws = elig.filter(p => p.score === best);
      const share = Math.floor(amt / ws.length);
      let odd = amt - share * ws.length;
      // odd chips go to the first winner left of the button
      const order = ws.slice().sort((a, b) => this.seatDist(a) - this.seatDist(b));
      for (const w of order) {
        const give = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        won.set(w, (won.get(w) || 0) + give);
      }
    }
    const winners = [];
    for (const [p, amount] of won) {
      p.stack += amount;
      // a lone eligible player getting back an uncalled excess isn't a "win"
      winners.push({ seat: ps.indexOf(p), amount, hand: handName(p.score), score: p.score });
    }
    winners.sort((a, b) => b.score - a.score || b.amount - a.amount);
    this.handOver = true;
    this.result = { winners, showdown: true };
  }

  // Position name for each seat this hand ('' for anyone sitting out).
  positions() {
    const NAMES = { 2: ['BTN', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'CO'],
      5: ['BTN', 'SB', 'BB', 'HJ', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] };
    const out = this.players.map(() => '');
    const live = (q) => !q.out;
    const n = this.players.filter(live).length;
    if (n < 2 || this.button < 0) return out;
    let i = this.button;
    for (let k = 0; k < n; k++) {
      out[i] = NAMES[n][k];
      i = this.next(i, live);
    }
    return out;
  }

  seatDist(p) {
    const n = this.players.length;
    return (this.players.indexOf(p) - this.button + n - 1) % n;
  }
}
