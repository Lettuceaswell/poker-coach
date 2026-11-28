// VAL-PT-006/008/009 checks (run 3 playtest notes 6, 8, 9).
//   node tools/pt-hud-test.js [--root .] [--n 12] [--shots shots/w-pt-hud] [--only 6|8|9] [--json out.json]
// 6: for N hero decisions per coach mode, wait until the live solve landed while it is his turn (cs.solved),
//    then diff outerHTML (coach off runs no solve in this app: reported, not faked) of #actions + size chips + table HUD before/after. after/off: 0 diffs; always: the snap shows.
// 8: with "Turn-order highlight" off, sample every 250 ms over a hand: no ripple/glow animations, no to-act box-shadow; dealer button shown; persists after reload; on => >= 1 ripple animation.
// 9: end-of-hand freeze payout labels: single winner, split pot, side pot (constructed through the app's game object via ?).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { startServer, launch, newPage, sleep } from './score/v2/lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('--root', path.join(here, '..'))), shots = arg('--shots', path.join(here, '../shots/w-pt-hud')), N = +arg('--n', 12), only = arg('--only', ''), jsonOut = arg('--json', '');
fs.mkdirSync(shots, { recursive: true });
const srv = await startServer(root), browser = await launch();
const res = { t6: {}, t8: {}, t9: [] }; let fails = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const SNAP = () => ({ actions: document.getElementById('actions').outerHTML, quick: document.getElementById('quick').outerHTML,
  hud: document.querySelector('.pot-row').outerHTML + document.getElementById('heroBox').outerHTML + document.getElementById('heroPos').outerHTML + document.getElementById('heroBet').outerHTML,
  status: document.getElementById('status').outerHTML });
const phone = { width: 430, height: 932 };

async function decisions(mode) {
  const p = await newPage(browser, srv.origin, { seed: 777, viewport: phone, settings: { speed: 'fast', coach: mode, orbitReview: false, calibration: false, seats: 3 }, timeout: 6000,
    });
  await p.click('#modeCash');
  const rows = []; const t0 = Date.now();
  while (rows.length < N && Date.now() - t0 < 240000) {
    const st = await p.evaluate(() => ({ turn: !!document.querySelector('#actions [data-a="call"],#actions [data-a="check"]'), over: !!document.querySelector('#actions [data-a="next"]'), board: document.querySelectorAll('#board .card:not(.back)').length, l: 0 }));
    if (st.over) { await p.click('#actions [data-a="next"]').catch(() => {}); await sleep(200); continue; }
    if (!st.turn) { await sleep(120); continue; }
    if (st.board === 0) { await p.click('#actions [data-a="call"],#actions [data-a="check"]').catch(() => {}); await sleep(200); continue; }
    const s0 = await p.evaluate(SNAP); const l0 = st.l;
    let landed = false; const w0 = Date.now();
    while (Date.now() - w0 < 9000) { const l = await p.evaluate(() => !!window.__poker.coach()?.solved); if (l) { landed = true; break; } await sleep(100); }
    const s1 = await p.evaluate(SNAP);
    const lab = await p.evaluate(() => ({ last: document.querySelectorAll('#quick button.last[title="your last size here"]').length, txt: document.getElementById('status').textContent }));
    const diff = ['actions', 'quick', 'hud', 'status'].filter(k => s0[k] !== s1[k]);
    const solvingText = /solving|Solved|passes/i.test(s1.status + s1.hud);
    rows.push({ landed, diff, label: lab, solvingText, to0: (s0.actions.match(/data-to="(\d+)"/) || [])[1], to1: (s1.actions.match(/data-to="(\d+)"/) || [])[1] });
    if (rows.length === 1) await p.screenshot({ path: path.join(shots, `hud-${mode}.png`) });
    await p.click('#actions [data-a="check"],#actions [data-a="call"]').catch(() => {}); await sleep(200);
  }
  await p.context().close(); return rows;
}
if (!only || only === '6') {
  console.log('Note 6: no timing tell');
  for (const mode of ['after', 'off', 'always']) {
    const rows = await decisions(mode); const landed = rows.filter(r => r.landed);
    const diffs = landed.filter(r => r.diff.length);
    res.t6[mode] = { decisions: rows.length, landed: landed.length, diffs: diffs.length, rows };
    console.log(` coach ${mode}: decisions ${rows.length}, solve landed during decision in ${landed.length}, with a table change ${diffs.length}`);
    if (mode !== 'always') {
      if (mode === 'after') check(rows.length >= N && landed.length >= N / 2, `after: ${rows.length} decisions, ${landed.length} with the live solve landing during the decision (need ${N} decisions, >= ${N / 2} landed)`);
      else check(rows.length >= N && landed.length === 0, `off: ${rows.length} decisions; the app runs no solve at all with the coach off (readSpot returns null), landed ${landed.length}, so nothing can tick`);
      check(diffs.length === 0, `${mode}: 0 diffs of #actions + size chips + HUD before/after landing (got ${diffs.length}: ${JSON.stringify(diffs.slice(0, 3).map(r => r.diff))})`);
      check(rows.every(r => r.label.last >= 1) && rows.every(r => !r.solvingText), `${mode}: default chip labelled "your last size here" and no solving text`);
    } else {
      check(landed.length > 0 && landed.some(r => r.diff.length), `always: the snap/solve shows on landing (${diffs.length}/${landed.length} decisions changed)`);
    }
  }
}
if (!only || only === '8') {
  console.log('Note 8: Turn-order highlight toggle');
  const BAD = new Set(['ripple', 'rippleBtn', 'turnGlow', 'btnPulse', 'land']);
  const sample = () => { const BAD = new Set(['ripple', 'rippleBtn', 'turnGlow', 'btnPulse', 'land']); const out = { anim: [], shadow: 0, btn: 0 }; for (const a of document.getAnimations()) { const n = a.animationName || a.id; if (BAD.has(n) || n === 'sweep') out.anim.push(n); }
    const hasShadow = (e) => { const b = getComputedStyle(e).boxShadow; return b && b !== 'none'; };
    document.querySelectorAll('#seats .seat:not(.winner) .pos, #heroPos').forEach(e => { if (!e.classList.contains('btn-pos') && hasShadow(e)) out.shadow++; });
    const hb = document.getElementById('heroBox'); if (hb.classList.contains('turn') && hasShadow(hb)) out.shadow++;
    out.btn = [...document.querySelectorAll('.btn-pos')].filter(e => e.getBoundingClientRect().width > 0).length; return out; };
  for (const [on, label] of [[false, 'off'], [true, 'on']]) {
    const p = await newPage(browser, srv.origin, { seed: 31, viewport: phone, settings: { speed: 'fast', coach: 'off', orbitReview: false, calibration: false, ripple: on }, timeout: 6000 });
    await p.click('#modeCash'); let anims = 0, shadows = 0, btnMin = 9, n = 0; const t0 = Date.now(); let turnSeen = 0;
    while (Date.now() - t0 < (on ? 4000 : 22000)) { const s = await p.evaluate(sample); anims += s.anim.length; shadows += s.shadow; btnMin = Math.min(btnMin, s.btn); n++;
      if (await p.evaluate(() => document.getElementById('heroBox').classList.contains('turn'))) { turnSeen++; await p.click('#actions [data-a="call"],#actions [data-a="check"]').catch(() => {}); }
      if (await p.evaluate(() => !!document.querySelector('#actions [data-a="next"]'))) await p.click('#actions [data-a="next"]').catch(() => {});
      await sleep(250); }
    res.t8[label] = { samples: n, rippleAnimSamples: anims, shadowSamples: shadows, heroTurns: turnSeen };
    if (!on) {
      check(anims === 0 && shadows === 0, `off: ${n} samples every 250 ms over ${turnSeen} hero turns: ripple/glow animations ${anims}, to-act glow ${shadows}`);
      check(btnMin >= 1, 'off: dealer button visible in every sample');
      await p.reload(); await p.waitForSelector('#modeCash');
      const kept = await p.evaluate(() => document.body.classList.contains('no-ripple') || JSON.parse(localStorage.getItem('poker-coach-v1')).settings.ripple === false);
      check(kept, 'off persists across reload (localStorage settings.ripple === false)');
      await p.click('#modeCash'); await p.waitForSelector('#heroBox'); check(await p.evaluate(() => document.body.classList.contains('no-ripple')), 'off still applied after reload (body.no-ripple)');
      await p.click('#gearBtn'); await sleep(300); await p.screenshot({ path: path.join(shots, 'settings-ripple-off.png') });
    } else check(anims >= 1, `on: ${anims} ripple/glow animation samples seen (>= 1)`);
    await p.context().close();
  }
}

if (!only || only === '9') {
  console.log('Note 9: payout labels on the end-of-hand freeze');
  // construct the finished hand through the app's own game object, then let the app render it
  const SCEN = [
    { name: 'single', cards: { 0: 'AhAd', 1: 'KcKd', 2: 'QcQd' }, board: '2s7h9dJc3s', ins: [20, 20, 20] },
    { name: 'split', cards: { 0: 'AhKd', 1: 'AsKc', 2: '7c7d' }, board: 'Ad Kh 4c 4d 2s'.replace(/ /g, ''), ins: [20, 20, 12] },
    { name: 'side', cards: { 0: 'AhAd', 1: 'KcKd', 2: 'QcQd' }, board: '2s7h9dJc3s', ins: [10, 30, 30] },
  ];
  for (const sc of SCEN) {
    const p = await newPage(browser, srv.origin, { seed: 5, viewport: phone, settings: { speed: 'normal', coach: 'off', orbitReview: false, calibration: false, seats: 3 }, timeout: 8000 });
    await p.click('#modeCash'); await p.waitForSelector('#actions [data-a="call"],#actions [data-a="check"]');
    const out = await p.evaluate((sc) => {
      const P = window.__poker, g = P.game(); const BB = +document.getElementById('blinds').textContent.split('/')[1];
      const C = (t) => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]);
      const hand = (s) => s.match(/../g).map(C);
      const heroI = g.players.findIndex(q => q.isHero);
      const order = [heroI, (heroI + 1) % 3, (heroI + 2) % 3];
      // seat order: sc.cards[0] -> hero, [1] -> next, [2] -> next-next; ins[] same order, in BB units
      g.players.forEach((q, i) => { q.folded = false; q.out = false; q.allIn = true; q.bet = 0; q.last = ''; });
      order.forEach((si, k) => { const q = g.players[si]; q.cards = hand(sc.cards[k]); q.totalIn = sc.ins[k] * BB; q.bet = 0; q.shown = false; });
      g.board = hand(sc.board); g.street = 'river';
      g.showdown();
      P.render();
      const pot = g.totalPot;
      const labels = [...document.querySelectorAll('#seats .seat .bet-chip.won, #heroBet.won')].map(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const seat = e.closest('.seat'); return { seat: seat ? seat.id : 'hero', text: e.textContent.trim(), bg: cs.backgroundColor, color: cs.color, rect: [r.left, r.top, r.right, r.bottom], vis: r.width > 0 }; });
      const obstacles = [...document.querySelectorAll('#seats .seat .mini .card, #board .card, #heroCards .card, #seats .seat .nm, #seats .seat .stk, #seats .seat .pos, #seats .seat .bet-chip:not(.won), #heroPos, #pot, #heroStack')].filter(e => e.getBoundingClientRect().width > 0 && !e.closest('.won')).map(e => { const r = e.getBoundingClientRect(); return { k: e.className + ':' + (e.textContent || '').trim().slice(0, 8), r: [r.left, r.top, r.right, r.bottom] }; });
      const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
      const overlaps = []; for (const l of labels) for (const o of obstacles) if (hit(l.rect, o.r) && !(o.k.startsWith('bet-chip'))) overlaps.push([l.seat, o.k]);
      const gold = getComputedStyle(document.documentElement).getPropertyValue('--win').trim();
      return { pot: pot / BB, winners: g.result.winners.map(w => ({ seat: w.seat, bb: w.amount / BB })), labels, overlaps, gold };
    }, sc);
    const sum = out.labels.reduce((a, l) => a + parseFloat(l.text.replace(/[^\d.]/g, '')), 0);
    const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
    const isGold = (c) => { const [r, g, b] = rgb(c); return r > 200 && g > 160 && b < 120; };
    await p.screenshot({ path: path.join(shots, `payout-${sc.name}.png`) });
    res.t9.push({ scenario: sc.name, ...out, sum });
    console.log(` ${sc.name}: pot ${out.pot} BB, labels ${out.labels.map(l => l.seat + ' ' + l.text).join(', ')}, winners ${JSON.stringify(out.winners)}`);
    check(out.labels.length === out.winners.length && out.labels.length >= (sc.name === 'single' ? 1 : 2) - (sc.name === 'single' ? 0 : 0), `${sc.name}: one label per winner (${out.labels.length} labels, ${out.winners.length} winners)`);
    check(Math.abs(sum - out.pot) <= 0.05, `${sc.name}: labels sum ${sum.toFixed(2)} BB vs pot ${out.pot} BB`);
    check(out.labels.every(l => isGold(l.bg) && l.vis), `${sc.name}: labels use the winner gold (--win ${out.gold}); backgrounds ${out.labels.map(l => l.bg).join(' | ')}; not green`);
    check(out.labels.every(l => /^\+[\d.]+ BB$/.test(l.text)), `${sc.name}: text format "+X BB" (${out.labels.map(l => l.text).join(', ')})`);
    check(out.overlaps.length === 0, `${sc.name}: no overlap with cards/labels/chips (${JSON.stringify(out.overlaps)})`);
    await p.waitForTimeout(1500); const still = await p.evaluate(() => document.querySelectorAll('#seats .seat .bet-chip.won, #heroBet.won').length); check(still === out.labels.length, `${sc.name}: labels stay until the tap (${still} after 1.5 s)`);
    await p.context().close();
  }
}
await browser.close(); srv.close();
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
