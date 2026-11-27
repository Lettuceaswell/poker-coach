import { Game } from './engine.js';
import { makeBot, decide } from './bots.js';
import { rankOf, suitOf, rankLabel, SUIT_GLYPH, describe } from './cards.js';

const SB = 5, BB = 10, START = 100 * BB;
const SPEED = { slow: [1200, 2200], normal: [600, 1300], fast: [220, 480] };
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- saved state ----------
const KEY = 'poker-coach-v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
const settings = { unit: 'bb', fourColor: false, seats: 6, speed: 'normal', felt: 'black', ...saved.settings };
const session = { hands: 0, net: 0, buyins: 1, ...saved.session };
let hintsLeft = saved.hintsLeft ?? 3;

function save() {
  localStorage.setItem(KEY, JSON.stringify({
    settings, session, hintsLeft,
    table: {
      button: game.button,
      players: game.players.map(p => ({ name: p.name, avatar: p.avatar, persona: p.persona, stack: p.stack, isHero: !!p.isHero, isBot: !!p.isBot })),
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
    game.addPlayer({ name: 'You', avatar: '🧔', stack: START, isHero: true });
    const taken = new Set();
    for (let i = 1; i < settings.seats; i++) game.addPlayer({ ...makeBot(taken), stack: START });
    game.button = Math.floor(Math.random() * game.players.length) - 1;
  }
}

function refill() {
  const taken = new Set(game.players.map(p => p.name).concat(game.players.map(p => p.avatar)));
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
  $('sessionStats').textContent = `Hands ${session.hands} · Net ${net >= 0 ? '+' : ''}${net.toFixed(1)} BB · Buy-ins ${session.buyins}`;
}

function winnersSet() {
  const r = game.result;
  if (!r) return new Map();
  const best = r.winners[0]?.score;
  const m = new Map();
  for (const w of r.winners) if (!r.showdown || w.score === best) m.set(w.seat, w);
  return m;
}

function render() {
  const ps = game.players;
  const heroI = ps.findIndex(p => p.isHero);
  const opps = ps.map((p, i) => i).filter(i => i !== heroI);
  // clockwise order starting from hero's left
  const order = opps.map(i => (i - heroI + ps.length) % ps.length).sort((a, b) => a - b).map(k => (k + heroI) % ps.length);
  const spots = SPOTS[order.length] || SPOTS[5];
  const wins = winnersSet();

  $('seats').innerHTML = order.map((i, k) => {
    const p = ps[i];
    const [x, y] = spots[k];
    const showCards = game.handOver && p.shown && !p.folded && p.cards.length;
    const w = wins.get(i);
    const cls = ['seat', p.folded && !game.handOver ? 'folded' : '', p.out ? 'out' : '', i === acting ? 'acting' : '', w ? 'winner' : ''].join(' ');
    const label = p.last && !game.handOver ? `<span class="nm last-${p.last.toLowerCase()}" style="color:${p.last === 'Fold' ? '#6a6a70' : p.last === 'Check' || p.last === 'Call' ? '#d0d0d4' : '#ffb4a8'}">${p.last}</span>` : `<span class="nm">${p.name}</span>`;
    const below = showCards
      ? `<div class="mini">${p.cards.map(c => cardHTML(c)).join('')}</div>`
      : `<span class="bet-chip">${p.bet ? num(p.bet) : ''}</span>`;
    return `<div class="${cls}" id="seat-${i}" style="left:${x}%;top:${y}%">
      ${w ? `<span class="won">+${num(w.amount)}</span>` : ''}
      <div class="ava-wrap"><div class="ava">${p.avatar}</div><span class="dealer ${game.button === i ? 'on' : ''}">D</span>
        <div class="timer" style="position:absolute;top:-4px;right:-10px;margin:0"></div></div>
      ${label}
      <span class="stk">${num(p.stack)}</span>
      ${below}
    </div>`;
  }).join('');

  // board
  const b = game.board || [];
  if (b.length < boardShown) boardShown = 0;
  $('board').innerHTML = [0, 1, 2, 3, 4].map(k => (k < b.length ? cardHTML(b[k], k >= boardShown ? 'deal' : '') : '<div class="card back"></div>')).join('');
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
  } else {
    $('status').textContent = game.street ? game.street[0].toUpperCase() + game.street.slice(1) : '';
  }

  // hero
  const h = hero();
  $('heroBet').textContent = h.bet ? num(h.bet) : '';
  $('heroAva').textContent = h.avatar;
  $('heroDealer').classList.toggle('on', game.button === heroI);
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
    el.innerHTML = h.cards.map(c => cardHTML(c, 'deal')).join('') + '<span class="hint">swipe up to fold</span>';
  }
  el.classList.toggle('mucked', h.folded && !h.out);
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
  const el = $('actions');
  const h = hero();
  el.classList.remove('waiting');
  renderQuick();
  if (game.handOver) {
    el.innerHTML = `<button class="btn ghost" data-a="next">Next hand</button>`;
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
  if (!L.canRaise) { el.innerHTML = first; return; }
  el.innerHTML = `${first}<button class="btn" data-a="raise" data-to="${selTo}">${raiseWord(L, selTo)} ${amt(selTo)}</button>
    <button class="btn sq" data-a="more" aria-label="More sizes"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
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
  if (a === 'more') return openRaise();
  if (a === 'raise') return heroAct('raise', +b.dataset.to);
  heroAct(a);
});

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
$('menuBtn').addEventListener('click', () => { applySettings(); $('settingsSheet').classList.add('on'); $('sheetBg').classList.add('on'); });
$('unitBtn').addEventListener('click', () => { settings.unit = settings.unit === 'bb' ? 'chips' : 'bb'; applySettings(); render(); save(); });
document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = seg.dataset.key; let v = b.dataset.v;
  if (k === 'fourColor') v = v === 'true';
  if (k === 'seats') v = +v;
  settings[k] = v;
  applySettings(); render(); save();
}));
let resetRequested = false;
$('newTable').addEventListener('click', () => {
  resetRequested = true;
  closeSheets();
  heroResolve?.({ type: 'fold' });
  nextResolve?.();
});

// ---------- swipe to fold ----------
(() => {
  const el = $('heroCards');
  let y0 = null, dy = 0, id = null;
  const canSwipe = () => { const h = hero(); return !game.handOver && h.cards.length && !h.folded; };
  el.addEventListener('pointerdown', (e) => {
    if (!canSwipe()) return;
    y0 = e.clientY; dy = 0; id = e.pointerId;
    el.setPointerCapture(id);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (y0 === null || e.pointerId !== id) return;
    dy = Math.min(0, e.clientY - y0);
    el.querySelectorAll('.card').forEach((c, k) => { c.style.transform = `translateY(${dy}px) rotate(${dy / (k ? 30 : -40)}deg)`; c.style.opacity = String(1 + dy / 260); });
  });
  const end = () => {
    if (y0 === null) return;
    el.classList.remove('dragging');
    el.querySelectorAll('.card').forEach(c => { c.style.transform = ''; c.style.opacity = ''; });
    const swiped = dy < -70, tapped = Math.abs(dy) < 6;
    y0 = null;
    if (swiped) {
      if (heroTurn) {
        hintsLeft = Math.max(0, hintsLeft - 1);
        el.classList.add('flyaway');
        setTimeout(() => heroAct('fold'), 180);
      } else {
        pre = 'checkfold'; render();
      }
    } else if (tapped && pre === 'checkfold') {
      pre = null; render();
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
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

async function loop() {
  for (;;) {
    if (resetRequested) {
      resetRequested = false;
      session.hands = 0; session.net = 0; session.buyins = 1;
      seatTable(null);
      pre = null;
    }
    refill();
    const h0 = hero();
    const startStack = h0.stack;
    save();
    game.startHand();
    pre = null;
    let street = game.street;
    acting = -1;
    render();
    await sleep(350);
    while (!game.handOver && !resetRequested) {
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
        if (auto) {
          await sleep(200);
          game.act(auto);
        } else {
          pickDefault(L);
          heroTurn = true;
          render();
          const d = await new Promise(r => { heroResolve = r; });
          heroTurn = false;
          if (resetRequested) break;
          game.act(d.type, d.to);
        }
      } else {
        await think(i);
        if (resetRequested) break;
        const d = decide(game, i);
        game.act(d.type, d.to);
      }
      acting = -1;
      render();
      if (game.street !== street && !game.handOver) {
        street = game.street;
        await sleep(settings.speed === 'fast' ? 250 : 550);
      }
    }
    if (resetRequested) continue;
    acting = -1;
    session.hands++;
    session.net += hero().stack - startStack;
    render();
    save();
    const wait = game.result?.showdown ? 3200 : 1700;
    await Promise.race([sleep(settings.speed === 'fast' ? wait * 0.6 : wait), new Promise(r => { nextResolve = r; })]);
    nextResolve = null;
  }
}

// ---------- boot ----------
seatTable(saved.table);
applySettings();
loop();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// test hook
window.__poker = { game: () => game, settings };
