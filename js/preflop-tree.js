// Preflop betting tree shared by the solver (node) and the coach (browser).
// Amounts in big blinds. Positions are listed in preflop acting order.

export const POSITIONS = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
};
export const STACK = 100;
export const MAX_RAISES = 4;     // open, 3-bet, 4-bet, 5-bet (jam)
export const MAX_COLD_CALLS = 1; // per raise level, keeps the tree small

// postflop order: SB, BB, then the rest in preflop order (BTN last)
export function postflopRank(n, p) {
  const names = POSITIONS[n];
  const name = names[p];
  if (n === 2) return name === 'SB' ? 1 : 0; // heads-up the SB is the button
  if (name === 'SB') return 0;
  if (name === 'BB') return 1;
  return 2 + p;
}

const r1 = x => Math.round(x * 2) / 2; // half-BB steps

export function raiseSize(n, st, p) {
  const names = POSITIONS[n];
  const level = st.raises;
  if (level >= MAX_RAISES - 1) return STACK; // 5-bet is all-in
  if (level === 0) {
    const limpers = st.limpers;
    return r1((names[p] === 'SB' ? 3 : 2.5) + limpers * 1 + (names[p] === 'BB' && limpers ? 1 : 0));
  }
  const cur = Math.max(...st.bets);
  const ip = postflopRank(n, p) > postflopRank(n, st.lastRaiser);
  const callers = st.callersThisLevel;
  if (level === 1) return Math.min(STACK, r1(cur * (ip ? 3 : 4) + callers * cur));
  return Math.min(STACK, r1(cur * (ip ? 2.25 : 2.5)));
}

// Build the whole tree. Returns { nodes } where each decision node is
// { id, p, acts: [{ t: 'f'|'c'|'r', to, next }] } and each terminal is
// { id, term: 'fold'|'show', live: [players], put: [bb per player] }.
export function buildTree(n) {
  const nodes = [];
  const names = POSITIONS[n];
  const sb = names.indexOf('SB'), bb = names.indexOf('BB');
  const start = {
    bets: names.map((_, i) => (i === sb ? 0.5 : i === bb ? 1 : 0)),
    folded: names.map(() => false),
    acted: names.map(() => false),
    raises: 0, lastRaiser: bb, limpers: 0, callersThisLevel: 0,
    p: 0,
  };
  const clone = s => ({ ...s, bets: s.bets.slice(), folded: s.folded.slice(), acted: s.acted.slice() });

  function nextToAct(s, from) {
    const cur = Math.max(...s.bets);
    for (let k = 1; k <= n; k++) {
      const j = (from + k) % n;
      if (s.folded[j]) continue;
      if (!s.acted[j] || s.bets[j] < cur) return j;
    }
    return -1;
  }

  function build(s) {
    const id = nodes.length;
    const live = names.map((_, i) => i).filter(i => !s.folded[i]);
    if (live.length === 1) { nodes.push({ id, term: 'fold', live, put: s.bets.slice() }); return id; }
    const p = s.p;
    if (p < 0) { nodes.push({ id, term: 'show', live, put: s.bets.slice() }); return id; }
    const node = { id, p, acts: [] };
    nodes.push(node);
    const cur = Math.max(...s.bets);
    const toCall = cur - s.bets[p];
    const allIn = cur >= STACK;

    // fold (never when checking is free)
    if (toCall > 0) {
      const t = clone(s); t.folded[p] = true; t.acted[p] = true;
      t.p = nextToAct(t, p);
      node.acts.push({ t: 'f', next: -1, _s: t });
    }
    // call / check / complete
    const blind = p === sb ? 0.5 : p === bb ? 1 : 0;
    const limpOk = s.raises > 0 || toCall === 0 || p === sb;
    // a cold call is calling a raise with no voluntary money in; the BB may always defend
    const coldOk = s.raises === 0 || toCall === 0 || p === bb || s.bets[p] > blind
      || s.callersThisLevel < MAX_COLD_CALLS;
    if (limpOk && coldOk) {
      const t = clone(s); t.bets[p] = cur; t.acted[p] = true;
      if (s.raises === 0 && toCall > 0) t.limpers++;
      if (s.raises > 0 && toCall > 0) t.callersThisLevel++;
      t.p = nextToAct(t, p);
      node.acts.push({ t: 'c', next: -1, _s: t });
    }
    // raise
    if (s.raises < MAX_RAISES && !allIn) {
      const to = raiseSize(n, s, p);
      if (to > cur) {
        const t = clone(s); t.bets[p] = to; t.acted = t.acted.map(() => false); t.acted[p] = true;
        t.raises++; t.lastRaiser = p; t.callersThisLevel = 0;
        t.p = nextToAct(t, p);
        node.acts.push({ t: 'r', to, next: -1, _s: t });
      }
    }
    for (const a of node.acts) { a.next = build(a._s); delete a._s; }
    return id;
  }
  build(start);
  return { n, names, nodes };
}

// Short label for an action: "Fold", "Call 2.5", "Check", "Raise 7.5", "All-in".
export function actLabel(node, a, put) {
  if (a.t === 'f') return 'Fold';
  if (a.t === 'c') return put ? `Call` : 'Check';
  return a.to >= STACK ? 'All-in' : 'Raise';
}
