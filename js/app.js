import { Game } from './engine.js';
import { makeBot, decide } from './bots.js';
import { rankOf, suitOf, rankLabel, SUIT_GLYPH, describe, evalHand } from './cards.js';
import { mapSpot, handClass, className, strategyAt, decodeStrategy } from './coach.js';
import { STACK } from './preflop-tree.js';
import { estimate } from './ranges.js';
import * as pf from './postflop-coach.js';
import * as H from './history.js';
import { preflopDetail, postflopDetail, villainView, storedPreflopGrid, nodeMixes } from './explain.js';
import { gridHTML } from './grid.js';
import { openDrills } from './drills.js';

const SB = 5, BB = 10, START = 100 * BB;
const SPEED = { slow: [1200, 2200], normal: [600, 1300], fast: [220, 480] };
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- saved state ----------
const KEY = 'poker-coach-v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
const settings = { unit: 'bb', fourColor: false, seats: 6, speed: 'normal', felt: 'black', stacks: 'topup', coach: 'always', orbitReview: true, calibration: true, ...saved.settings };
// v2: stacks carry over with an auto top-up to 100 BB (the old 'reset' default hid every win)
if ((saved.version || 1) < 2) settings.stacks = 'topup';
const session = { hands: 0, net: 0, buyins: 1, pfN: 0, pfGood: 0, ...saved.session };
let hintsLeft = saved.hintsLeft ?? 3;

function save() {
  localStorage.setItem(KEY, JSON.stringify({
    version: 2, settings, session, hintsLeft,
    table: {
      button: game.button,
      players: game.players.map(p => ({ name: p.name, persona: p.persona, stack: p.stack, isHero: !!p.isHero, isBot: !!p.isBot })),
    },
  }));
}

// ---------- table ----------
let game = new Game({ sb: SB, bb: BB });

function seatTable(restore) {
  game = new Game({ sb: SB, bb: BB });
  if (restore?.players?.length) {
    for (const p of restore.players) game.addPlayer({ ...p });
    game.button = Math.min(restore.button ?? -1, game.players.length - 1);
  } else {
    game.addPlayer({ name: 'You', stack: START, isHero: true });
    const taken = new Set();
    for (let i = 1; i < settings.seats; i++) game.addPlayer({ ...makeBot(taken), stack: START });
    game.button = Math.floor(Math.random() * game.players.length) - 1;
  }
}

function refill() {
  const taken = new Set(game.players.map(p => p.name));
  if (settings.stacks === 'reset') for (const p of game.players) p.stack = START;
  // auto top-up (like online auto-rebuy): short stacks go back to 100 BB, winners keep their chips
  if (settings.stacks === 'topup') for (const p of game.players) if (p.stack < START) p.stack = START;
  game.players.forEach((p, i) => {
    if (p.isHero) {
      if (p.stack < BB) { p.stack = START; session.buyins++; }
    } else if (p.stack < BB) {
      // busted normie leaves, a fresh one sits down
      game.players[i] = { ...game.players[i], ...makeBot(taken), stack: START, cards: [], folded: true, last: '' };
    }
  });
  while (game.players.length < settings.seats) game.addPlayer({ ...makeBot(taken), stack: START });
  while (game.players.length > settings.seats) {
    const idx = game.players.findLastIndex(p => !p.isHero);
    game.players.splice(idx, 1);
    if (game.button >= idx) game.button--;
  }
  if (game.button >= game.players.length) game.button = game.players.length - 1;
}

const hero = () => game.players.find(p => p.isHero);

// ---------- formatting ----------
function num(chips) {
  if (settings.unit === 'chips') return chips.toLocaleString();
  const v = chips / BB;
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
}
const unitTag = () => (settings.unit === 'bb' ? '<small>BB</small>' : '');
const amt = (c) => `${num(c)}${unitTag()}`;

function cardHTML(c, cls = '') {
  return `<div class="card s-${suitOf(c)} ${cls}"><span class="rk">${rankLabel(rankOf(c))}</span><span class="st">${SUIT_GLYPH[suitOf(c)]}</span></div>`;
}

// opponent seat spots (left %, top %) by number of opponents, clockwise from hero's left
const SPOTS = {
  1: [[50, 14]],
  2: [[27, 16], [73, 16]],
  3: [[17, 24], [50, 6], [83, 24]],
  4: [[11, 46], [32, 6], [68, 6], [89, 46]],
  5: [[10, 46], [29, 10], [50, 0], [71, 10], [90, 46]],
};

// ---------- render ----------
let boardShown = 0;
let heroKey = '';
let acting = -1;

function applySettings() {
  document.body.classList.toggle('four', settings.fourColor);
  document.body.classList.remove('felt-green', 'felt-navy');
  if (settings.felt !== 'black') document.body.classList.add('felt-' + settings.felt);
  $('unitBtn').textContent = settings.unit === 'bb' ? 'BB' : 'Chips';
  $('blinds').textContent = `No-Limit Hold'em · ${SB}/${BB}`;
  document.querySelectorAll('.seg').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(settings[seg.dataset.key]) === b.dataset.v));
  });
  const net = session.net / BB;
  const acc = session.pfN ? ` · Preflop ${Math.round(100 * session.pfGood / session.pfN)}% (${session.pfN})` : '';
  $('sessionStats').textContent = `Hands ${session.hands} · Net ${net >= 0 ? '+' : ''}${net.toFixed(1)} BB${acc}`;
}

function winnersSet() {
  const r = game.result;
  if (!r) return new Map();
  const best = r.winners[0]?.score;
  const m = new Map();
  for (const w of r.winners) if (!r.showdown || w.score === best) m.set(w.seat, w);
  return m;
}

// ---------- position ripple ----------
// A white light starts at the button and runs clockwise around every seat (yours
// included). New hand: 3 laps; then every ~6 s after it finishes: 2 laps. Each run
// lands back on the button, which then keeps its normal pulse. Never on results.
let sweepStart = -1e9, sweepOrder = new Map(), sweepN = 0, sweepLaps = 3;
const SWEEP_STEP = 140, SWEEP_GAP = 6000;
function startSweep(laps = 3) {
  const ps = game.players;
  const seated = (p) => !p.out;
  sweepOrder = new Map();
  let i = game.button;
  for (let k = 0; k < ps.length && i >= 0; k++) {
    if (sweepOrder.has(i)) break;
    sweepOrder.set(i, k);
    i = game.next(i, seated);
  }
  sweepN = sweepOrder.size;
  sweepLaps = laps;
  sweepStart = performance.now();
  applySweep();
}
const lapMs = () => sweepN * SWEEP_STEP;
const sweepTotal = () => sweepLaps * lapMs() + 900;
function sweepActive(i) { return sweepOrder.has(i) && performance.now() - sweepStart < sweepTotal(); }
// inline timing for one circle; negative delays keep a re-render mid-ripple in sync
function sweepAttrs(i) {
  if (!sweepActive(i)) return { cls: '', style: '' };
  const t = performance.now() - sweepStart;
  const d0 = Math.round(sweepOrder.get(i) * SWEEP_STEP - t);
  const base = `--lap:${lapMs()}ms;--laps:${sweepLaps};`;
  if (i === game.button) {
    const d1 = Math.round(sweepLaps * lapMs() - t);
    return { cls: ' sweep-btn', style: `${base}--d0:${d0}ms;--d1:${d1}ms;--d2:${d1 + 750}ms` };
  }
  return { cls: ' sweep', style: `${base}animation-delay:${d0}ms` };
}
function sweepStyle(i) { const a = sweepAttrs(i); return a.cls ? `${a.cls}" style="${a.style}` : ''; }
function sweepClass(i) { return sweepAttrs(i).cls; }
function sweepDelay(i) { return sweepAttrs(i).style; }
// apply to the circles already on screen without rebuilding anything
function applySweep() {
  const heroI = game.players.findIndex(p => p.isHero);
  const els = [...document.querySelectorAll('#seats .seat')].map(el => [+el.id.slice(5), el.querySelector('.pos')]);
  els.push([heroI, $('heroPos')]);
  for (const [i, el] of els) {
    if (!el) continue;
    el.classList.remove('sweep', 'sweep-btn');
    void el.offsetWidth; // restart the animation
    const a = sweepAttrs(i);
    el.style.cssText = a.style;
    if (a.cls) el.classList.add(a.cls.trim());
  }
}
setInterval(() => {
  if (paused || !game || game.handOver) return;
  if (performance.now() - sweepStart > sweepTotal() + SWEEP_GAP) startSweep(2);
}, 250);

// ---------- the winning five cards ----------
let winCards = new Set();
function bestFive(seven) {
  let best = -1, set = null;
  for (let a = 0; a < seven.length; a++) for (let b2 = a + 1; b2 < seven.length; b2++) {
    const five = seven.filter((_, k) => k !== a && k !== b2);
    const v = evalHand(five);
    if (v > best) { best = v; set = five; }
  }
  return set || [];
}
function winningCards(wins) {
  const out = new Set();
  if (!game.handOver || !game.result?.showdown || (game.board || []).length < 5) return out;
  for (const [i] of wins) for (const c of bestFive([...game.players[i].cards, ...game.board])) out.add(c);
  return out;
}

// ---------- chips fly to the pot, pot flies to the winner ----------
function fly(fromEl, toEl, html, cls = 'fly-chip') {
  if (!fromEl || !toEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = fromEl.getBoundingClientRect(), z = toEl.getBoundingClientRect();
  if (!a.width) return;
  const f = document.createElement('div');
  f.className = cls; f.innerHTML = html;
  f.style.left = a.left + 'px'; f.style.top = a.top + 'px';
  document.body.appendChild(f);
  requestAnimationFrame(() => {
    f.style.transform = `translate(${z.left + z.width / 2 - a.left - a.width / 2}px, ${z.top + z.height / 2 - a.top - a.height / 2}px) scale(.8)`;
    f.style.opacity = '0.0';
  });
  setTimeout(() => f.remove(), 520);
}
function chipsToPot() {
  document.querySelectorAll('#seats .bet-chip, #heroBet').forEach(c => { if (c.textContent.trim()) fly(c, $('pot'), c.textContent); });
}
function potToWinners() {
  const wins = winnersSet();
  const src = $('pot').textContent.trim() ? $('pot') : $('board');
  for (const [i, w] of wins) {
    const target = game.players[i].isHero ? $('heroPos') : document.querySelector(`#seat-${i} .pos`);
    fly(src, target, num(w.amount), 'fly-chip big');
  }
}

function render() {
  const ps = game.players;
  const heroI = ps.findIndex(p => p.isHero);
  const opps = ps.map((p, i) => i).filter(i => i !== heroI);
  // clockwise order starting from hero's left
  const order = opps.map(i => (i - heroI + ps.length) % ps.length).sort((a, b) => a - b).map(k => (k + heroI) % ps.length);
  const spots = SPOTS[order.length] || SPOTS[5];
  const wins = winnersSet();
  const pos = game.positions();
  winCards = winningCards(wins);

  $('seats').innerHTML = order.map((i, k) => {
    const p = ps[i];
    const [x, y] = spots[k];
    const showCards = game.handOver && p.shown && !p.folded && p.cards.length;
    const w = wins.get(i);
    const cls = ['seat', p.folded && !game.handOver ? 'folded' : '', p.out ? 'out' : '', i === acting ? 'acting' : '', w ? 'winner' : ''].join(' ');
    const label = p.last && !game.handOver ? `<span class="nm last-${p.last.toLowerCase()}" style="color:${p.last === 'Fold' ? '#6a6a70' : p.last === 'Check' || p.last === 'Call' ? '#d0d0d4' : '#ffb4a8'}">${p.last}</span>` : `<span class="nm">${p.name}</span>`;
    const mini = showCards ? `<div class="mini">${p.cards.map(c => cardHTML(c, winCards.has(c) ? 'hilite' : '')).join('')}</div>` : '';
    const below = w ? `<span class="bet-chip won">+${num(w.amount)}</span>` : `<span class="bet-chip">${p.bet ? num(p.bet) : ''}</span>`;
    const dx = Math.round(Math.sign(50 - x) * Math.min(26, Math.abs(50 - x) * 0.7));
    return `<div class="${cls}" id="seat-${i}" style="left:${x}%;top:${y}%;--dx:${dx}px">
      <div class="ava-wrap"><div class="pos ${pos[i] === 'BTN' ? 'btn-pos' : ''}${sweepStyle(i)}">${pos[i]}</div>
        <div class="timer"></div>${mini}</div>
      ${label}
      <span class="stk">${num(p.stack)}</span>
      ${below}
    </div>`;
  }).join('');

  // board
  const b = game.board || [];
  if (b.length < boardShown) boardShown = 0;
  const sd = game.handOver && game.result?.showdown && winCards.size;
  $('board').innerHTML = [0, 1, 2, 3, 4].map(k => (k < b.length
    ? cardHTML(b[k], [k >= boardShown ? 'deal' : '', sd ? (winCards.has(b[k]) ? 'hilite' : 'lowlite') : ''].join(' '))
    : '<div class="card back"></div>')).join('');
  boardShown = b.length;

  // pot + status
  $('pot').innerHTML = game.handOver ? '' : amt(game.pot);
  const r = game.result;
  if (game.handOver && r) {
    const top = r.winners[0];
    const names = [...wins.keys()].map(i => (ps[i].isHero ? 'You' : ps[i].name));
    const total = [...wins.values()].reduce((s, w) => s + w.amount, 0);
    const verb = names.length > 1 ? 'split' : names[0] === 'You' ? 'win' : 'wins';
    $('status').innerHTML = `<b>${names.join(' & ')}</b> ${verb} ${amt(total)}${r.showdown && top?.hand ? ` · ${top.hand}` : ''}`;
  } else if (coachHTML()) {
    $('status').innerHTML = coachHTML();
  } else {
    $('status').textContent = game.street ? game.street[0].toUpperCase() + game.street.slice(1) : '';
  }

  // hero
  const h = hero();
  $('heroBet').textContent = h.bet ? num(h.bet) : '';
  $('heroPos').textContent = pos[heroI];
  $('heroPos').className = 'pos hero-pos' + (pos[heroI] === 'BTN' ? ' btn-pos' : '') + sweepClass(heroI);
  $('heroPos').style.cssText = sweepDelay(heroI);
  $('heroBox').classList.toggle('turn', heroTurn);
  $('heroStack').textContent = num(h.stack);
  $('heroHand').textContent = h.cards.length ? describe([...h.cards, ...(h.folded ? [] : b)]) : '';
  $('heroBox').classList.toggle('winner', wins.has(heroI));
  renderHeroCards(h);
  renderActions();
}

function renderHeroCards(h) {
  const key = game.handNo + ':' + h.cards.join(',');
  const el = $('heroCards');
  if (key !== heroKey) {
    heroKey = key;
    el.className = 'hero-cards';
    el.style.transform = ''; el.style.opacity = '';
    el.innerHTML = h.cards.map(c => cardHTML(c, 'deal')).join('') + '<span class="hint">swipe up to fold</span>';
  }
  el.classList.toggle('mucked', h.folded && !h.out);
  el.querySelectorAll('.card').forEach((c, k) => c.classList.toggle('hilite', !!(h.cards[k] !== undefined && winCards.has(h.cards[k]) && game.handOver)));
  el.classList.toggle('queued', pre === 'checkfold' && !h.folded);
  const hint = el.querySelector('.hint');
  if (hint) hint.classList.toggle('on', hintsLeft > 0 && heroTurn && !game.legal().canCheck);
}

// ---------- actions ----------
let heroTurn = false;
let heroResolve = null;
let nextResolve = null;
// advance action picked while waiting: null | 'checkfold' | 'check' | 'call' | 'callany'
let pre = null;
let preCall = 0;
let selTo = 0;        // raise size picked for this decision
let selLabel = '';

const clampTo = (L, to) => Math.max(L.minTo, Math.min(L.maxTo, Math.round(to / SB) * SB));

// which kind of sizing decision this is
function spot(L) {
  if (game.street === 'preflop') return game.currentBet <= BB ? 'open' : 'vsRaise';
  return L.currentBet === 0 ? 'bet' : 'vsBet';
}
const PREF_DEFAULT = { open: '2.5x', vsRaise: '3x', bet: '50%', vsBet: '3x' };

// [label, raise-to] quick sizes for the current decision, deduped after clamping
function sizes(L) {
  const pot = game.totalPot;
  const frac = (f) => game.currentBet + f * (pot + L.toCall);
  const k = spot(L);
  let list;
  if (k === 'open') {
    list = [2, 2.5, 3, 3.5, 4, 5, 6].map(m => [`${m}x`, m * BB]);
  } else if (k === 'vsRaise') {
    list = [2.2, 2.5, 3, 3.5, 4, 5].map(m => [`${m}x`, m * game.currentBet]);
  } else if (k === 'bet') {
    list = [25, 33, 50, 66, 75, 100, 125, 150, 200].map(p => [`${p}%`, frac(p / 100)]);
  } else {
    list = [2.2, 2.5, 3, 3.5, 4, 5].map(m => [`${m}x`, m * game.currentBet]);
  }
  if (k !== 'bet') list.push(['Pot', frac(1)]);
  const out = [], seen = new Set();
  for (const [l, v] of list) {
    const to = clampTo(L, v);
    if (to >= L.maxTo || seen.has(to)) continue;
    seen.add(to); out.push([l, to]);
  }
  out.push(['All-in', L.maxTo]);
  return out;
}

function pickDefault(L) {
  const list = sizes(L);
  // with the coach on, start on the chip closest to the solver's raise size
  const rs = (cs?.mix || []).filter(m => m.t === 'r');
  const r = cs?.pick?.t === 'r' ? cs.pick : rs.sort((a, b) => b.freq - a.freq)[0];
  if (settings.coach === 'always' && r && r.to && (r.freq >= 0.2 || cs.pick === r)) {
    const best = list.reduce((b, x) => (Math.abs(x[1] - r.to * BB) < Math.abs(b[1] - r.to * BB) ? x : b));
    selLabel = best[0]; selTo = best[1];
    return;
  }
  const want = settings.pref?.[spot(L)] ?? PREF_DEFAULT[spot(L)];
  const hit = list.find(([l]) => l === want) || list.find(([l]) => l === PREF_DEFAULT[spot(L)]) || list[0];
  selLabel = hit[0]; selTo = hit[1];
}

function choose(label, to) {
  selLabel = label; selTo = to;
  const L = game.legal();
  if (label && label !== 'All-in') { settings.pref = { ...settings.pref, [spot(L)]: label }; save(); }
}

function raiseWord(L, to) { return to === L.maxTo ? 'All-in' : L.currentBet === 0 ? 'Bet' : 'Raise'; }

function renderQuick() {
  const el = $('quick');
  const h = hero();
  if (!heroTurn || game.handOver) { el.innerHTML = ''; return; }
  const L = game.legal();
  if (!L.canRaise) { el.innerHTML = ''; return; }
  el.innerHTML = sizes(L).map(([l, to]) => `<button class="${to === selTo ? 'on' : ''}" data-l="${l}" data-to="${to}">${l}</button>`).join('');
  const on = el.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderActions() {
  if (!heroTurn) document.querySelectorAll('.rec').forEach(x => x.classList.remove('rec'));
  if (heroTurn && cs && graded) graded = null;
  const el = $('actions');
  const h = hero();
  el.classList.remove('waiting');
  renderQuick();
  if (game.handOver) {
    el.innerHTML = `<button class="btn sq replay-btn" data-a="replay" aria-label="Replay hand"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="btn primary next-btn" data-a="next">Next hand</button>`;
    return;
  }
  if (!heroTurn) {
    if (h.folded || h.allIn) {
      el.classList.add('waiting');
      el.innerHTML = `<button class="btn" disabled>${h.allIn ? 'All-in' : 'Wait for the next hand'}</button>`;
      return;
    }
    // advance actions while others act
    const owe = Math.min(game.currentBet - h.bet, h.stack);
    if (pre === 'check' && owe > 0) pre = null;
    if (pre === 'call' && owe !== preCall) pre = null;
    const mid = owe === 0 ? ['check', 'Check'] : ['call', `Call ${amt(owe)}`];
    const b = (k, t) => `<button class="btn pre ${pre === k ? 'on' : ''}" data-pre="${k}">${t}</button>`;
    el.innerHTML = b('checkfold', owe === 0 ? 'Check/Fold' : 'Fold') + b(mid[0], mid[1]) + b('callany', 'Call any');
    return;
  }
  const L = game.legal();
  const callAll = L.toCall >= h.stack;
  const first = L.canCheck ? `<button class="btn" data-a="check">Check</button>`
    : `<button class="btn" data-a="call">${callAll ? 'All-in' : 'Call'} ${amt(L.toCall)}</button>`;
  if (!L.canRaise) { el.innerHTML = first; highlightPick(); return; }
  queueMicrotask(highlightPick);
  el.innerHTML = `${first}<button class="btn" data-a="raise" data-to="${selTo}">${raiseWord(L, selTo)} ${amt(selTo)}</button>
    <button class="btn sq" data-a="more" aria-label="More sizes"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

function highlightPick() {
  document.querySelectorAll('.rec').forEach(x => x.classList.remove('rec'));
  if (!heroTurn || !cs?.pick || settings.coach !== 'always') return;
  const t = cs.pick.t;
  const sel = t === 'r' ? '#actions [data-a="raise"]' : t === 'c' ? '#actions [data-a="call"], #actions [data-a="check"]' : '#heroCards';
  document.querySelectorAll(sel).forEach(x => x.classList.add('rec'));
  if (t === 'r') {
    const chip = [...document.querySelectorAll('#quick button')].find(b => +b.dataset.to === selTo);
    chip?.classList.add('rec');
  }
}

function heroAct(type, to) {
  if (!heroTurn || !heroResolve) return;
  heroTurn = false;
  const r = heroResolve; heroResolve = null;
  r({ type, to });
}

$('actions').addEventListener('click', (e) => {
  const p = e.target.closest('button[data-pre]');
  if (p) {
    const k = p.dataset.pre;
    pre = pre === k ? null : k;
    if (pre === 'call') { const h = hero(); preCall = Math.min(game.currentBet - h.bet, h.stack); }
    render();
    return;
  }
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'next') { nextResolve?.(); return; }
  if (a === 'replay') { if (lastHandRec) openReplay(lastHandRec); return; }
  if (a === 'more') return openRaise();
  if (a === 'raise') return heroAct('raise', +b.dataset.to);
  heroAct(a);
});

['seats', 'board', 'status'].forEach(id => $(id).addEventListener('click', () => { if (game.handOver && nextResolve) nextResolve(); }));

$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  choose(b.dataset.l, +b.dataset.to);
  renderActions();
});

// ---------- raise sheet ----------
let raiseTo = 0;
function openRaise() {
  const L = game.legal();
  raiseTo = selTo;
  $('presets').innerHTML = sizes(L).map(([l, v]) => `<button data-l="${l}" data-to="${v}">${l}</button>`).join('');
  syncRaise();
  $('raiseSheet').classList.add('on');
  $('sheetBg').classList.add('on');
}
function syncRaise() {
  const L = game.legal();
  $('raiseVal').textContent = num(raiseTo);
  $('raiseUnit').textContent = settings.unit === 'bb' ? 'BB' : '';
  const t = L.maxTo > L.minTo ? Math.sqrt((raiseTo - L.minTo) / (L.maxTo - L.minTo)) : 1;
  $('raiseSlider').value = Math.round(t * 1000);
  // how big is this vs the pot, for reference
  const potNow = game.totalPot + L.toCall;
  const pct = Math.round(((raiseTo - game.currentBet) / Math.max(1, potNow)) * 100);
  $('raisePct').textContent = `${pct}% pot`;
  $('raiseGo').innerHTML = `${raiseWord(L, raiseTo) === 'Raise' ? 'Raise to' : raiseWord(L, raiseTo)} ${amt(raiseTo)}`;
  $('presets').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.to === raiseTo));
}
$('raiseSlider').addEventListener('input', (e) => {
  const L = game.legal();
  const t = (+e.target.value / 1000) ** 2;
  raiseTo = clampTo(L, L.minTo + t * (L.maxTo - L.minTo));
  if (+e.target.value === 1000) raiseTo = L.maxTo;
  syncRaise();
});
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  raiseTo = +b.dataset.to;
  choose(b.dataset.l, raiseTo);
  syncRaise();
});
document.querySelectorAll('.step').forEach(b => b.addEventListener('click', () => {
  const L = game.legal();
  const step = (game.street === 'preflop' ? SB : BB) * +b.dataset.d;
  raiseTo = b.dataset.d > 0 && raiseTo + step > L.maxTo ? L.maxTo : clampTo(L, raiseTo + step);
  syncRaise();
}));
$('raiseGo').addEventListener('click', () => { closeSheets(); heroAct('raise', raiseTo); });
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('on'));
  $('sheetBg').classList.remove('on');
}
$('sheetBg').addEventListener('click', closeSheets);
// swipe a sheet down to close
document.querySelectorAll('.sheet').forEach(sh => {
  let y0 = null;
  sh.addEventListener('touchstart', (e) => { if (e.target.type !== 'range') y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchend', (e) => { if (y0 !== null && e.changedTouches[0].clientY - y0 > 60) closeSheets(); y0 = null; });
});

// ---------- settings ----------
$('gearBtn').addEventListener('click', () => { applySettings(); $('settingsSheet').classList.add('on'); $('sheetBg').classList.add('on'); });
$('unitBtn').addEventListener('click', () => { settings.unit = settings.unit === 'bb' ? 'chips' : 'bb'; applySettings(); render(); save(); });
document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = seg.dataset.key; let v = b.dataset.v;
  if (k === 'fourColor' || k === 'orbitReview' || k === 'calibration') v = v === 'true';
  if (k === 'seats') v = +v;
  settings[k] = v;
  applySettings(); render(); save();
}));
let resetRequested = false;
let lastHandRec = null;
$('newTable').addEventListener('click', () => {
  resetRequested = true;
  closeSheets();
  heroResolve?.({ type: 'fold' });
  nextResolve?.();
});

// ---------- swipe to fold: the cards follow your finger ----------
(() => {
  const el = $('heroCards');
  let start = null, dx = 0, dy = 0;
  const canSwipe = () => { const h = hero(); return !game.handOver && h.cards.length && !h.folded && !paused; };
  const begin = (x, y) => {
    if (!canSwipe()) return false;
    start = { x, y }; dx = 0; dy = 0;
    el.classList.add('dragging');
    return true;
  };
  const move = (x, y) => {
    if (!start) return;
    dx = x - start.x; dy = y - start.y;
    // free movement, a little resistance downward
    const ty = dy > 0 ? dy * 0.35 : dy;
    el.style.transform = `translate(${dx}px, ${ty}px) rotate(${dx / 14}deg)`;
    el.style.opacity = String(Math.max(0.35, 1 + Math.min(0, dy) / 320));
  };
  const finish = () => {
    if (!start) return;
    start = null;
    el.classList.remove('dragging');
    const swiped = dy < -70, tapped = Math.hypot(dx, dy) < 8;
    if (swiped && heroTurn) {
      hintsLeft = Math.max(0, hintsLeft - 1);
      // keep flying the way the finger threw them
      const k = 700 / Math.max(1, Math.hypot(dx, dy));
      el.style.transition = 'transform .28s ease-in, opacity .28s ease-in';
      el.style.transform = `translate(${dx * k}px, ${dy * k}px) rotate(${dx / 6}deg)`;
      el.style.opacity = '0';
      setTimeout(() => { el.style.transition = ''; heroAct('fold'); }, 230);
      return;
    }
    el.style.transition = 'transform .3s cubic-bezier(.2,1.4,.4,1), opacity .3s';
    el.style.transform = ''; el.style.opacity = '';
    setTimeout(() => { el.style.transition = ''; }, 320);
    if (swiped) { pre = 'checkfold'; render(); }
    else if (tapped && pre === 'checkfold') { pre = null; render(); }
  };
  el.addEventListener('touchstart', (e) => { if (begin(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault(); }, { passive: false });
  el.addEventListener('touchmove', (e) => { if (start) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', finish);
  // mouse (desktop / tests)
  el.addEventListener('mousedown', (e) => {
    if (!begin(e.clientX, e.clientY)) return;
    const mm = (ev) => move(ev.clientX, ev.clientY);
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); finish(); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });
})();

// ---------- game loop ----------
async function think(i) {
  const [a, b] = SPEED[settings.speed];
  const slow = hero().folded ? 0.45 : 1;
  const ms = (a + Math.random() * (b - a)) * slow;
  acting = i;
  render();
  const t0 = performance.now();
  await new Promise(res => {
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      const t = document.querySelector(`#seat-${i} .timer`);
      if (t) t.style.setProperty('--p', p);
      if (p >= 1) res(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// menu pauses the table
let paused = true;
let resumeGate = null;
const gate = () => (paused ? new Promise(r => { resumeGate = r; }) : null);

// after you fold, the rest of the hand resolves instantly
function fastForward() {
  let guard = 0;
  while (!game.handOver && guard++ < 500) {
    const d = decide(game, game.toAct);
    game.act(d.type, d.to);
  }
}

async function loop() {
  for (;;) {
    if (resetRequested) {
      resetRequested = false;
      session.hands = 0; session.net = 0; session.buyins = 1; session.pfN = 0; session.pfGood = 0;
      seatTable(null);
      pre = null;
    }
    refill();
    const h0 = hero();
    const startStack = h0.stack;
    save();
    await gate();
    game.startHand();
    H.beginHand(game);
    pre = null;
    let street = game.street;
    acting = -1;
    startSweep();
    render();
    await sleep(350);
    while (!game.handOver && !resetRequested) {
      await gate();
      if (hero().folded) { fastForward(); break; }
      const i = game.toAct;
      const p = game.players[i];
      if (p.isHero) {
        acting = -1;
        const L = game.legal();
        const auto = pre === 'checkfold' ? (L.canCheck ? 'check' : 'fold')
          : pre === 'check' && L.canCheck ? 'check'
          : pre === 'call' && L.toCall === preCall ? 'call'
          : pre === 'callany' ? (L.canCheck ? 'check' : 'call') : null;
        if (pre !== 'checkfold' || !L.canCheck) pre = null;
        newRoll();
        cs = readSpot();
        if (auto) {
          await sleep(200);
          grade(auto);
          game.act(auto);
        } else {
          pickDefault(L);
          heroTurn = true;
          render();
          const d = await new Promise(r => { heroResolve = r; });
          heroTurn = false;
          if (resetRequested) break;
          grade(d.type);
          game.act(d.type, d.to);
        }
        cs = null;
      } else {
        await think(i);
        if (resetRequested) break;
        const d = decide(game, i);
        game.act(d.type, d.to);
      }
      acting = -1;
      if (game.handOver || game.street !== street) chipsToPot();
      if (game.handOver && !hero().folded) { await sleep(260); potToWinners(); }
      if (game.street !== street && !game.handOver) {
        street = game.street;
        render();
        await sleep(settings.speed === 'fast' ? 300 : 600);
      } else render();
    }
    if (resetRequested) continue;
    acting = -1;
    if (graded && graded.hand !== game.handNo) graded = null;
    session.hands++;
    session.net += hero().stack - startStack;
    save();
    const doneHand = H.endHand(game);
    const orbitHands = H.closeOrbitIfDue(doneHand);
    if (hero().folded) {
      await sleep(150);
      if (orbitHands && settings.orbitReview) await openOrbitReview(orbitHands);
      await gate(); continue;
    }
    render();
    // results stay up until you tap
    lastHandRec = doneHand;
    await new Promise(r => { nextResolve = r; });
    nextResolve = null;
    if (orbitHands && settings.orbitReview) await openOrbitReview(orbitHands);
    await gate();
  }
}

// ---------- coach ----------
const strategies = {};   // n -> { strat, vis } | 'loading' | 'missing'
async function loadStrategy(n) {
  if (strategies[n]) return;
  strategies[n] = 'loading';
  try {
    const get = async (f) => {
      const res = await fetch(`data/${f}.gz`);
      if (!res.ok) throw new Error(f);
      const ds = res.body.pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    };
    const [bin, vis] = await Promise.all([get(`preflop-${n}.bin`), get(`preflop-${n}.vis`)]);
    strategies[n] = { strat: decodeStrategy(n, bin), vis };
  } catch (e) { strategies[n] = 'missing'; setTimeout(() => { delete strategies[n]; }, 60000); }
  if (heroTurn) { cs = readSpot(); render(); }
}

let cs = null;     // coach reading for the current hero decision
let graded = null;   // { hand, html } shown until the next decision

const RARE_VIS = 4 * 16; // log2(visits)*4 below this = thin data (< ~65k visits)
function readSpot() {
  if (settings.coach === 'off') return null;
  if (game.street !== 'preflop') return postflopSpot();
  const n = game.players.filter(p => !p.out).length;
  const S = strategies[n];
  if (!S) { loadStrategy(n); return { loading: true }; }
  if (S === 'loading') return { loading: true };
  if (S === 'missing') return null;
  const m = mapSpot(game);
  const h = hero();
  const cls = handClass(h.cards);
  const base = { cls, hand: className(cls), pos: game.positions()[game.players.indexOf(h)] };
  if (m.quality === 'off') return { ...base, off: true, why: m.why };
  const probs = strategyAt(S.strat, m.node, cls);
  if (!probs) return { ...base, off: true, why: 'no data' };
  const cur = Math.max(...game.players.map(p => p.bet)) / BB;
  // isolating limpers: the open size plus 1 BB per limper (unopened pots only)
  const iso = (a) => (a.t === 'r' && m.limpers && a.to < STACK && game.players.every(p => p.bet <= BB) ? a.to + m.limpers : a.to);
  const mix = m.node.acts.map((a, i) => ({
    t: a.t, to: iso(a), freq: probs[i],
    label: a.t === 'f' ? 'Fold' : a.t === 'c' ? (cur > h.bet / BB ? 'Call' : 'Check') : a.to >= STACK ? 'All-in' : `Raise ${num(iso(a) * BB)}`,
  }));
  const rare = S.vis[m.node.id] < RARE_VIS;
  return withRoll({ ...base, mix, quality: m.quality, why: m.why, rare, nodeId: m.node.id, n });
}

const COLOR = { r: '#ff7a5c', c: '#6aa8ff', f: '#8a8a92' }; // green is reserved for the coach's pick

// The die: a fresh 1-100 roll per decision picks one action from the mix, so mixed
// strategies get played at the right frequencies. Ranges follow the displayed order.
let roll = 0, shownRoll = -1;
function newRoll() { roll = 1 + Math.floor(Math.random() * 100); }
function ordered(mix) { return mix.filter(m => m.freq >= 0.005).sort((a, b) => b.freq - a.freq); }
function withRoll(sp) {
  let lo = 1;
  const list = ordered(sp.mix);
  list.forEach((m, i) => {
    const hi = i === list.length - 1 ? 100 : Math.min(100, lo - 1 + Math.round(m.freq * 100));
    m.lo = lo; m.hi = hi; lo = hi + 1;
  });
  sp.pick = list.find(m => roll >= m.lo && roll <= m.hi) || list[list.length - 1];
  return sp;
}
function mixBar(mix) {
  return `<span class="mixbar">${mix.filter(m => m.freq > 0.005).map(m => `<i style="flex:${m.freq};background:${COLOR[m.t]}"></i>`).join('')}</span>`;
}
// Postflop: 3+ players = estimate mode; heads-up = estimate first, live solver refines (postflop.js)
function postflopSpot() {
  const n = game.players.filter(p => !p.out).length;
  const S = strategies[n];
  if (!S) loadStrategy(n);
  const heroI = game.players.findIndex(p => p.isHero);
  const h = hero();
  const e = estimate(game, heroI, S && S.strat ? S.strat : null);
  const pos = game.positions()[heroI];
  const desc = describe([...h.cards, ...game.board]);
  if (!e) return { off: true, pos, hand: desc, why: 'no range data' };
  const cur = Math.max(...game.players.map(p => p.bet)) / BB;
  const mix = e.mix.map(m => ({
    ...m,
    label: m.t === 'f' ? 'Fold' : m.t === 'c' ? (cur > h.bet / BB ? 'Call' : 'Check')
      : (m.to * BB >= h.bet + h.stack ? 'All-in' : `${cur > 0 ? 'Raise' : 'Bet'} ${num(m.to * BB)}`),
  }));
  const way = e.villains + 1;
  if (way === 2) pf.request(game, heroI, S && S.strat ? S.strat : null).catch(() => {});
  return withRoll({ live: way === 2 ? { pending: true } : null, eqNum: e.eq, needNum: e.need,
    pos, hand: desc, mix, quality: 'estimate', estimate: true, way,
    why: `${way > 2 ? way + '-way ' : ''}estimate · equity ${Math.round(e.eq * 100)}%${e.need ? ` vs ${Math.round(e.need * 100)}% needed` : ''}`,
  });
}

function meter(lv) {
  if (!lv || lv.pending) return '<span class="meter-text">solving…</span>';
  if (lv.error) return `<span class="meter-text">solver unavailable</span>`;
  let fill, text;
  if (lv.exploit != null) {
    // log scale: 20% of pot = empty, 0.3% = full
    fill = Math.max(0.03, Math.min(1, Math.log(20 / Math.max(0.3, lv.exploit)) / Math.log(20 / 0.3)));
    text = `${lv.done ? 'Solved' : 'Solving'} · within ${lv.exploit < 1 ? lv.exploit.toFixed(2) : lv.exploit.toFixed(1)}% of pot`;
  } else {
    fill = Math.min(1, lv.elapsed / lv.maxMs);
    text = `${lv.done ? 'Solved' : 'Solving'} · ${lv.iter} passes`;
  }
  const notes = [lv.depthLimited ? 'river estimated' : '', lv.approx ? 'bet size off-tree' : '', lv.source === 'rough' || lv.source === 'narrowed' ? 'rough ranges' : ''].filter(Boolean);
  return `<span class="meter"><i style="width:${Math.round(fill * 100)}%"></i></span><span class="meter-text">${text}${notes.length ? ' · ' + notes.join(' · ') : ''}</span>`;
}

function tag(sp) {
  if (sp.solved) return '';
  if (sp.estimate) return ` <em>≈ ${sp.why}</em>`;
  if (sp.quality === 'approx') return ` <em>≈ ${sp.why}</em>`;
  if (sp.rare) return ' <em>≈ rare spot</em>';
  return '';
}

// what goes in the status line
function coachHTML() {
  if (heroTurn && cs && settings.coach === 'always') {
    if (cs.loading) return '<span class="coach dim">Coach loading…</span>';
    if (cs.off) return `<span class="coach dim">${cs.pos} · ${cs.hand} · no solution here (${cs.why})</span>`;
    const parts = ordered(cs.mix).filter(m => m.hi >= m.lo)
      .map(m => `<b class="${cs.pick === m ? 'picked' : ''}" style="color:${COLOR[m.t]}">${m.label}</b> ${m.lo === m.hi ? m.lo : m.lo + '–' + m.hi}`).join(' · ');
    const lv = cs.live ? `<span class="meter-row">${meter(cs.live)}</span>` : '';
    const anim = roll !== shownRoll ? ' anim' : '';
    shownRoll = roll;
    return `<span class="coach"><span class="die${anim}">${roll}</span>${cs.pos} · ${cs.hand}${tag(cs)}<button class="why-btn">Why?</button><br>${parts}${mixBar(cs.mix)}${lv}</span>`;
  }
  if (graded) return graded.html;
  return '';
}

function grade(type) {
  const sp = cs;
  if (!sp || sp.loading || sp.off || !sp.mix) return;
  const t = type === 'fold' ? 'f' : type === 'raise' ? 'r' : 'c';
  const byT = {};
  for (const m of sp.mix) byT[m.t] = (byT[m.t] || 0) + m.freq;
  if (byT[t] === undefined && !(t === 'f' && byT.c !== undefined)) return;
  const f = byT[t] ?? 0;
  const topT = Object.keys(byT).reduce((a, b) => (byT[b] > byT[a] ? b : a));
  const mine = { freq: f };
  const top = topT === t ? mine : null;
  const [word, cls] = f >= 0.5 || mine === top ? ['Best', 'g'] : f >= 0.15 ? ['Good', 'g'] : f >= 0.03 ? ['Rare', 'y'] : ['Mistake', 'r'];
  if (sp.quality === 'exact' && !sp.rare) {
    session.pfN++;
    if (cls === 'g') session.pfGood++;
  }
  const solver = sp.mix.filter(m => m.freq >= 0.01).sort((a, b) => b.freq - a.freq)
    .map(m => `${m.label.replace(/ [\d.,]+$/, '')} ${Math.round(m.freq * 100)}%`).join(' · ');
  graded = {
    hand: game.handNo,
    html: `<span class="coach"><span class="grade ${cls}">${word}</span> ${sp.pos} · ${sp.hand}${tag(sp)}<br><span class="dim">${solver}</span></span>`,
  };
  logHeroDecision(sp, t, word, cls);
}

// preflop situation label from the history before the hero acts
function preflopSit() {
  const before = [];
  for (const h of game.history) { if (h.street !== 'preflop') break; before.push(h); }
  const raises = before.filter(h => h.type === 'raise').length;
  const limps = before.filter(h => h.type === 'call' && h.amount <= BB).length;
  return raises === 0 ? (limps ? 'vs limpers' : 'first in') : raises === 1 ? 'vs open' : raises === 2 ? 'vs 3-bet' : 'vs 4-bet+';
}

function logHeroDecision(sp, t, word, gcls) {
  const heroI = game.players.findIndex(p => p.isHero);
  const L = game.legal();
  const pre = game.street === 'preflop';
  const rec = {
    street: game.street, pos: sp.pos, hand: sp.hand, chosen: t, grade: word, gcls,
    mix: sp.mix.map(m => ({ t: m.t, label: m.label, freq: +m.freq.toFixed(3) })),
    pick: sp.pick ? sp.pick.label : null,
    quality: pre ? (sp.quality === 'exact' && !sp.rare ? 'exact' : sp.quality) : sp.solved ? 'solved' : 'estimate',
    facing: L.toCall > 0, board: game.board.slice(), pot: game.totalPot / BB,
    need: L.toCall > 0 ? L.toCall / (game.totalPot + L.toCall) : null,
  };
  if (pre) {
    rec.n = sp.n; rec.nodeId = sp.nodeId; rec.cls = sp.cls; rec.sit = preflopSit();
    try {
      const S = strategies[sp.n];
      const d = S && S.strat ? preflopDetail(game, heroI, S.strat) : null;
      if (d) { rec.facts = d.facts; if (d.eq != null) rec.eq = d.eq; }
    } catch (e) { /* explanations are best-effort */ }
  } else {
    rec.eq = sp.eqNum ?? null;
    rec.values = sp.values || null;
  }
  rec.leak = H.leakOf(rec);
  H.logDecision(rec);
}

// live postflop solver updates
let lastPickKey = '';
pf.setUpdateHandler((m, cur) => {
  if (!heroTurn || !cs || !cs.live || game.street === 'preflop') return;
  if (m.error) { cs.live = { error: m.error }; return refreshCoach(); }
  const st = m.strategies && Object.values(m.strategies)[0];
  cs.live = { iter: m.iter, exploit: m.exploit, done: m.done, elapsed: m.elapsedMs, maxMs: { flop: 20000, turn: 30000, river: 8000 }[game.street],
    depthLimited: m.depthLimited, approx: m.approx, source: cur.source };
  // only replace the estimate once the solver is clearly past its noisy start
  const ready = m.done || (m.exploit != null ? m.exploit < 15 : m.iter >= 40);
  if (ready && st && st.probs && m.player === cur.heroSide) {
    const L = game.legal();
    cs.mix = st.actions.map((a, i) => ({
      t: a.type === 'fold' ? 'f' : a.type === 'check' || a.type === 'call' ? 'c' : 'r',
      to: a.amount, freq: st.probs[i],
      label: a.type === 'fold' ? 'Fold' : a.type === 'check' ? 'Check' : a.type === 'call' ? 'Call'
        : a.type === 'allin' || a.amount * BB >= L.maxTo ? 'All-in' : `${a.type === 'bet' ? 'Bet' : 'Raise'} ${num(a.amount * BB)}`,
    }));
    cs.solved = true;
    withRoll(cs);
  }
  refreshCoach();
});
function refreshCoach() {
  if (!heroTurn) return;
  $('status').innerHTML = coachHTML();
  const key = cs?.pick ? cs.pick.t + ':' + (cs.pick.to || '') : '';
  if (key !== lastPickKey) {
    lastPickKey = key;
    // update in place: never rebuild buttons that might be under the user's finger
    const L = game.legal();
    pickDefault(L);
    const rb = document.querySelector('#actions [data-a="raise"]');
    if (rb) { rb.dataset.to = selTo; rb.innerHTML = `${raiseWord(L, selTo)} ${amt(selTo)}`; }
    document.querySelectorAll('#quick button').forEach(b => b.classList.toggle('on', +b.dataset.to === selTo));
  }
  highlightPick();
}

// ---------- panels: coach, opponent peek, replay, orbit review, leaks, hands ----------
let panelResolve = null;
function openPanel(title, html, aside = '') {
  $('panelTitle').textContent = title;
  $('panelAside').innerHTML = aside;
  $('panelBody').innerHTML = html;
  $('panelBody').scrollTop = 0;
  $('panel').classList.add('on');
  return new Promise(r => { panelResolve = r; });
}
function closePanel() {
  $('panel').classList.remove('on');
  const r = panelResolve; panelResolve = null; r?.();
}
$('panelClose').addEventListener('click', closePanel);

const SUITG = ['♠', '♥', '♦', '♣'];
const cardTxt = (c) => `<span class="ct s-${suitOf(c)}">${rankLabel(rankOf(c))}${SUITG[suitOf(c)]}</span>`;
const cardsTxt = (cs2) => cs2.map(cardTxt).join('');
const pctTxt = (x) => `${Math.round(x * 100)}%`;
const bbTxt = (x) => `${x >= 0 ? '+' : ''}${(+x).toFixed(1)}`;
function mixRows(mix, pickLabel) {
  return `<div class="mixrows">${mix.filter(m => m.freq >= 0.005).sort((a, b) => b.freq - a.freq).map(m =>
    `<div class="mixrow ${pickLabel && m.label === pickLabel ? 'pick' : ''}"><span>${m.label}</span><i><b style="width:${Math.round(m.freq * 100)}%;background:${COLOR[m.t]}"></b></i><em>${Math.round(m.freq * 100)}%</em></div>`).join('')}</div>`;
}
const factList = (facts) => `<ul class="facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul>`;

// The Coach panel for the current decision
async function openCoachPanel() {
  if (!cs || !heroTurn) return;
  const heroI = game.players.findIndex(p => p.isHero);
  const n = game.players.filter(p => !p.out).length;
  const S = strategies[n];
  const strat = S && S.strat ? S.strat : null;
  let html = '';
  if (game.street === 'preflop') {
    const d = strat ? preflopDetail(game, heroI, strat) : null;
    if (!d) { html = '<p class="dim">No solution for this spot yet.</p>'; }
    else {
      html += `<section><h4>Your range here</h4>${gridHTML({ mixes: d.mixes, mark: d.cls })}</section>`;
      html += `<section><h4>Why</h4>${factList(d.facts)}</section>`;
      if (cs.mix) html += `<section><h4>Solver mix for ${cs.hand}</h4>${mixRows(cs.mix, cs.pick?.label)}</section>`;
    }
  } else {
    const solved = cs.live ? await pf.detail(game, heroI).catch(() => null) : null;
    const d = postflopDetail(game, heroI, strat, solved);
    html += `<section><h4>Why</h4>${factList(d.facts)}</section>`;
    if (d.rankInRange != null) {
      html += `<section><h4>Where your hand sits</h4><div class="sitbar"><i style="left:${Math.round(d.rankInRange * 100)}%"></i></div><div class="sitlabels"><span>bottom of your range</span><span>top</span></div>`;
      if (d.tiers && solved) {
        const acts = solved.actions;
        html += `<div class="tiers">${d.tiers.map((t, k) => `<div class="tier"><span>${['Top fifth', '2nd', '3rd', '4th', 'Bottom'][k]}</span><i>${t.mix.map((f, a) => {
          const ty = acts[a].type; const col = ty === 'fold' ? '#3a3a40' : (ty === 'check' || ty === 'call') ? COLOR.c : COLOR.r;
          return `<b style="flex:${f};background:${col}" title="${ty}"></b>`; }).join('')}</i></div>`).join('')}</div><p class="dim small">What the solver does with each fifth of your range, strongest first: red bets or raises, blue checks or calls, grey folds.</p>`;
      }
      html += '</section>';
    }
    if (d.read && d.read.equity != null) {
      html += `<section><h4>Board read</h4><div class="tags">${d.tags.map(x => `<span>${x}</span>`).join('')}</div>
        <div class="vs"><span>You ${pctTxt(d.read.equity)}</span><i><b style="width:${Math.round(d.read.equity * 100)}%"></b></i><span>${d.read.them} ${pctTxt(1 - d.read.equity)}</span></div>
        <p class="dim small">Strongest 10% of hands on this board: ${pctTxt(d.read.nutsYou)} of your range vs ${pctTxt(d.read.nutsThem)} of theirs.</p></section>`;
    }
    if (solved && solved.values) {
      const best = Math.max(...solved.values);
      html += `<section><h4>What each option is worth</h4><div class="evs">${solved.actions.map((a, i) => {
        const lbl = a.type === 'fold' ? 'Fold' : a.type === 'check' ? 'Check' : a.type === 'call' ? 'Call' : a.type === 'allin' ? 'All-in' : `${a.type === 'bet' ? 'Bet' : 'Raise'} ${a.amount.toFixed(1)}`;
        return `<div class="${solved.values[i] === best ? 'best' : ''}"><span>${lbl}</span><b>${bbTxt(solved.values[i])} BB</b></div>`; }).join('')}</div><p class="dim small">Expected value of each option with your exact hand, from the live solve.</p></section>`;
    }
    if (cs.mix) html += `<section><h4>Coach mix</h4>${mixRows(cs.mix, cs.pick?.label)}</section>`;
  }
  // opponents still in: tap to peek
  const opps = game.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.isHero && !p.folded && !p.out);
  if (opps.length) html += `<section><h4>Opponents</h4><div class="peeks">${opps.map(({ p, i }) => `<button data-peek="${i}">${game.positions()[i]} · ${p.name}</button>`).join('')}</div></section>`;
  openPanel(`${cs.pos} · ${cs.hand}`, html);
}

async function openVillain(seat) {
  const heroI = game.players.findIndex(p => p.isHero);
  const n = game.players.filter(p => !p.out).length;
  const S = strategies[n];
  const v = villainView(game, seat, heroI, S && S.strat ? S.strat : null);
  const p = game.players[seat];
  const html = `<section>${gridHTML({ weights: v.weights })}</section>
    <section>${factList([
      `${game.positions()[seat]} plays about ${pctTxt(v.width)} of all starting hands to get here.`,
      v.eq != null ? `Your hand wins ${pctTxt(v.eq)} against this range${game.board.length < 5 ? ' (with cards to come)' : ''}.` : '',
      game.board.length ? 'After the flop the range is narrowed by their bets and calls: strong hands stay, weak ones fade.' : 'Preflop range from the solver, following what they actually did.',
    ].filter(Boolean))}</section>`;
  openPanel(`${game.positions()[seat]} · ${p.name}`, html);
}

$('panelBody').addEventListener('click', (e) => {
  const pk = e.target.closest('[data-peek]');
  if (pk) return openVillain(+pk.dataset.peek);
});
$('seats').addEventListener('click', (e) => {
  if (game.handOver) return;
  const seat = e.target.closest('.seat');
  if (!seat) return;
  const i = +seat.id.slice(5);
  if (!game.players[i].folded) openVillain(i);
});

// Replay of one logged hand
function openReplay(h) {
  const steps = h.decisions.map((d, k) => {
    const grid = d.street === 'preflop' ? storedPreflopGrid(strategies, d) : null;
    return `<div class="rstep" data-k="${k}">
      <div class="rstep-head"><span class="grade ${d.gcls}">${d.grade}</span><b>${d.street[0].toUpperCase() + d.street.slice(1)}</b>
        <span class="dim">${d.board && d.board.length ? cardsTxt(d.board) : ''}</span>
        <span class="you">You: ${d.chosen === 'f' ? 'Fold' : d.chosen === 'r' ? 'Bet/Raise' : (d.facing ? 'Call' : 'Check')}</span></div>
      <div class="rstep-body">${mixRows(d.mix, d.pick)}
        ${d.need != null ? `<p class="dim small">Price ${pctTxt(d.need)}${d.eq != null ? ` · your equity ${pctTxt(d.eq)}` : ''}</p>` : ''}
        ${d.facts ? factList(d.facts) : ''}
        ${grid ? gridHTML({ mixes: grid, mark: d.cls }) : ''}
        ${d.quality !== 'exact' && d.quality !== 'solved' ? `<p class="dim small">Graded against an ${d.quality === 'estimate' ? 'estimate' : 'approximate solution'}.</p>` : ''}
      </div></div>`;
  }).join('') || '<p class="dim">No decisions logged for this hand.</p>';
  const shown = (h.shown || []).map(x => `<span>${x.name} ${cardsTxt(x.cards)}</span>`).join(' · ');
  const head = `<div class="rp-head"><span class="rp-cards">${cardsTxt(h.cards)}</span><span>${h.pos}</span><span class="rp-net ${h.net >= 0 ? 'up' : 'down'}">${bbTxt(h.net / h.bb)} BB</span></div>
    ${h.board && h.board.length ? `<div class="rp-board">${cardsTxt(h.board)}</div>` : ''}${shown ? `<p class="dim small">Shown: ${shown}</p>` : ''}`;
  return openPanel(`Hand ${h.no}`, head + `<div class="rsteps">${steps}</div>`);
}
$('panelBody').addEventListener('click', (e) => {
  const st = e.target.closest('.rstep-head');
  if (st) st.parentElement.classList.toggle('open');
  const hr = e.target.closest('[data-hand]');
  if (hr) { const h = H.history.hands.find(x => x.no === +hr.dataset.hand); if (h) openReplay(h); }
});

function handRows(hands) {
  return hands.map(h => {
    const worst = h.decisions.some(d => d.gcls === 'r') ? 'r' : h.decisions.some(d => d.gcls === 'y') ? 'y' : h.decisions.length ? 'g' : '';
    return `<button class="hrow" data-hand="${h.no}"><span class="rp-cards">${cardsTxt(h.cards)}</span><span class="hpos">${h.pos}</span>
      <span class="dot ${worst}"></span><span class="rp-net ${h.net >= 0 ? 'up' : 'down'}">${bbTxt(h.net / h.bb)}</span></button>`;
  }).join('');
}

// Orbit review: calibration questions, then the orbit's hands strongest first
async function openOrbitReview(hands) {
  const net = hands.reduce((s, h) => s + h.net / h.bb, 0);
  const ranked = hands.slice().sort((a, b) => H.strengthOf(b.cards) - H.strengthOf(a.cards));
  const qs = [];
  if (settings.calibration) {
    const pool = hands.flatMap(h => h.decisions.map(d => ({ h, d })));
    const needQ = pool.filter(x => x.d.need != null);
    const eqQ = pool.filter(x => x.d.eq != null && x.d.facing);
    const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
    if (needQ.length) { const x = pickOne(needQ); qs.push({ kind: 'need', ...x, truth: x.d.need }); }
    if (eqQ.length) { const x = pickOne(eqQ); qs.push({ kind: 'eq', ...x, truth: x.d.eq }); }
  }
  const c = H.history.calib;
  const calibLine = () => c.n ? `Your 90% ranges caught the truth ${c.hits} of ${c.n} times (${Math.round(100 * c.hits / c.n)}%) · average width ${Math.round(c.width / c.n)} points. Aim for 9 in 10 with ranges as narrow as you can.` : 'Give a low and high number you are 90% sure the truth falls between. Over time, aim to be right 9 in 10 times with narrower ranges.';
  const qHTML = qs.map((q, k) => {
    const ctx = `${q.d.street[0].toUpperCase() + q.d.street.slice(1)} · ${q.h.pos} · ${cardsTxt(q.h.cards)}${q.d.board && q.d.board.length ? ' on ' + cardsTxt(q.d.board) : ''}`;
    const ask = q.kind === 'need' ? 'How often did you need to win to call?' : 'How often did your hand win against their range?';
    return `<div class="calq" data-k="${k}"><p class="small dim">${ctx}</p><p>${ask}</p>
      <div class="dual"><div class="dual-track"><i class="dual-fill"></i><i class="dual-truth"></i></div>
        <input type="range" min="0" max="100" value="20" class="lo"><input type="range" min="0" max="100" value="45" class="hi"></div>
      <div class="calrow"><span class="calval">20% – 45%</span><button class="btn small-btn reveal">Reveal</button></div><p class="calres small"></p></div>`;
  }).join('');
  const html = `${qs.length ? `<section><h4>Calibration · 90% ranges</h4><p class="small dim">${calibLine()}</p>${qHTML}</section>` : ''}
    <section><h4>This orbit, strongest hand first</h4><div class="hrows">${handRows(ranked)}</div></section>`;
  const next = game.positions ? '' : '';
  const done = openPanel(`Orbit ${hands[0].orbit}`, html, `<span class="${net >= 0 ? 'up' : 'down'}">${bbTxt(net)} BB</span>`);
  // wire the dual sliders
  $('panelBody').querySelectorAll('.calq').forEach(el => {
    const lo = el.querySelector('.lo'), hi = el.querySelector('.hi');
    const sync = () => {
      if (+lo.value > +hi.value) [lo.value, hi.value] = [hi.value, lo.value];
      el.querySelector('.calval').textContent = `${lo.value}% – ${hi.value}%`;
      const f = el.querySelector('.dual-fill'); f.style.left = lo.value + '%'; f.style.width = (hi.value - lo.value) + '%';
    };
    lo.addEventListener('input', sync); hi.addEventListener('input', sync); sync();
    el.querySelector('.reveal').addEventListener('click', (ev) => {
      const q = qs[+el.dataset.k];
      const truth = Math.round(q.truth * 100);
      const hit = H.recordCalibration(+lo.value, +hi.value, truth);
      const t = el.querySelector('.dual-truth'); t.style.left = truth + '%'; t.classList.add('on');
      el.querySelector('.calres').innerHTML = `${hit ? '<b class="up">Inside your range.</b>' : '<b class="down">Outside your range.</b>'} The answer was ${truth}%.`;
      ev.target.disabled = true; lo.disabled = true; hi.disabled = true;
    });
  });
  return done;
}

function openLeaks() {
  const leaks = H.topLeaks(12);
  const html = leaks.length ? `<div class="leaks">${leaks.map((l, k) => `<div class="leak"><b>${k + 1}</b><span>${l.label}</span><em>${l.ev ? `${l.ev.toFixed(1)} BB` : `${l.n}×`}</em></div>`).join('')}</div>
    <p class="small dim">Counted only on exact solver spots, when your action was one the solver uses less than 15% of the time. Ranked by BB lost where the solver priced it, otherwise by how often and how far off.</p>`
    : '<p class="dim">No leaks yet. Play some hands with the coach on.</p>';
  return openPanel('Leaks', html);
}
function openHands() {
  const hands = H.history.hands.slice(-60).reverse();
  return openPanel('Hands', hands.length ? `<div class="hrows">${handRows(hands)}</div>` : '<p class="dim">No hands yet.</p>');
}
$('menuLeaks').addEventListener('click', openLeaks);
$('menuHands').addEventListener('click', openHands);
$('modeDrills').addEventListener('click', () => openDrills({ strategies, loadStrategy, seats: settings.seats, openPanel, closePanel, H, gridHTML, nodeMixes, BB }));
$('status').addEventListener('click', (e) => { if (e.target.closest('.why-btn')) { e.stopPropagation(); openCoachPanel(); } });

// ---------- menu ----------
function showMenu() {
  paused = true;
  closeSheets();
  const h = game.players.find(p => p.isHero);
  const net = session.net / BB;
  $('modeSub').textContent = session.hands
    ? `${game.players.length} players · ${session.hands} hands · ${net >= 0 ? '+' : ''}${net.toFixed(1)} BB${session.pfN ? ` · preflop ${Math.round(100 * session.pfGood / session.pfN)}%` : ''}`
    : `No-Limit Hold'em · 100 BB · ${settings.seats} players`;
  const lk = H.topLeaks(1)[0];
  $('drillSub').textContent = lk ? `Top leak: ${lk.label}` : 'Preflop spots from your leaks';
  $('menu').classList.add('on');
}
function play() {
  $('menu').classList.remove('on');
  paused = false;
  render();
  resumeGate?.(); resumeGate = null;
}
$('backBtn').addEventListener('click', showMenu);
$('modeCash').addEventListener('click', play);
$('menuSettings').addEventListener('click', () => { applySettings(); $('settingsSheet').classList.add('on'); $('sheetBg').classList.add('on'); });

// ---------- boot ----------
seatTable(saved.table);
applySettings();
showMenu();
loop();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// test hook
window.__poker = { game: () => game, settings, play, coach: () => cs };
