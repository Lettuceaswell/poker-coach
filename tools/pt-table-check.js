// Run-3 harness for VAL-PT-002/003/005 (Levi's playtest notes 2, 3, 5), phone Chromium, 3 sizes x 3-6 seats.
//  chips : frozen chip check (CHIPS read verbatim from tools/score/v2/legibility.js, which already counts board cards AND empty board slots)
//          plus opponent card backs as obstacles; every street counted; chips seen per street (preflop / flop / turn / river).
//  backs : every opponent in the hand shows exactly 2 backs; folded/out seats 0 backs and faded; backs never touch chips, labels, board, other backs.
//  mix   : forces 2..6-action solver mixes through the real coach renderer (window.__poker.forceCoach) and checks the mix line fits.
// Usage: node tools/pt-table-check.js [--hands 8] [--root .] [--json out.json] [--shots dir] [--only chips,backs,mix] [--seats 3,4,5,6]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { startServer, launch, sleep, seedScript, settingsScript } from './score/v2/lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'score/v2/legibility.js'), 'utf8');
const a = src.indexOf('const CHIPS = () => {'), b = src.indexOf('\n};\n', a);
if (a < 0 || b < 0) throw new Error('cannot find CHIPS in frozen legibility.js');
const CHIPS = src.slice(a + 'const CHIPS = '.length, b + 2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HANDS = +arg('--hands', 8), root = path.resolve(arg('--root', path.join(here, '..'))), shotsDir = arg('--shots', path.join(here, '../shots/w-pt-table')), jsonOut = arg('--json', '');
const SEATS = arg('--seats', '3,4,5,6').split(',').map(Number), ONLY = arg('--only', 'chips,backs,mix').split(','), tag = arg('--tag', '');
// sat/sab = the iOS safe-area insets the real phone applies through env(safe-area-inset-*) (Chromium has none): his 390x844 playtest screenshot
// has a 47 px status bar, which is what shrinks #seats until a side seat's chip reaches the board. --insets 0 turns the emulation off.
export const SIZES = [{ width: 430, height: 932, dsf: 3, sat: 59, sab: 34 }, { width: 390, height: 844, dsf: 1, sat: 47, sab: 34 }, { width: 360, height: 740, dsf: 1, sat: 24, sab: 16 }];
const INSETS = arg('--insets', '1') !== '0';
fs.mkdirSync(shotsDir, { recursive: true });
const srv = await startServer(root), browser = await launch();

async function page(vp, seed, settings) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf, isMobile: true, hasTouch: true });
  await ctx.addInitScript(seedScript(seed)); await ctx.addInitScript(settingsScript(settings));
  const p = await ctx.newPage(); p.setDefaultTimeout(6000); await p.goto(srv.origin + '/'); await p.waitForSelector('#modeCash');
  if (INSETS) await p.addStyleTag({ content: `#app { padding-top: max(${vp.sat}px, 10px) !important; padding-bottom: max(${vp.sab}px, 14px) !important; }` });
  return p;
}

// in-page: seats + backs + street
const TABLE = () => {
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return false; } return true; };
  const eo = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const inter = (x, y) => Math.min(x.r, y.r) - Math.max(x.l, y.l) > 1 && Math.min(x.b, y.b) - Math.max(x.t, y.t) > 1;
  const faceUp = [...document.querySelectorAll('#board .card')].filter(c => !c.classList.contains('back')).length;
  const street = faceUp === 0 ? 'preflop' : faceUp === 3 ? 'flop' : faceUp === 4 ? 'turn' : faceUp === 5 ? 'river' : 'deal';
  const out = { street, viol: [], seats: 0, active: 0, folded: 0, backsSeen: 0 };
  const chips = [...document.querySelectorAll('#seats .bet-chip, #heroBet')].filter(c => c.textContent.trim() && vis(c));
  const boardCards = [...document.querySelectorAll('#board .card')];
  const hand = document.getElementById('actions')?.querySelector('[data-a="next"]'); // hand over: the 'Next hand' button
  const seats = [...document.querySelectorAll('#seats .seat')];
  const all = seats.map(s => ({ s, id: s.id, backs: [...s.querySelectorAll('.opp-backs .card')].filter(vis), labels: [...s.querySelectorAll('.pos, .nm, .stk')].filter(vis), folded: s.classList.contains('folded'), out: s.classList.contains('out'), shown: !!s.querySelector('.mini') }));
  for (const q of all) {
    out.seats++;
    if (q.out || q.folded) {
      out.folded++;
      if (q.backs.length) out.viol.push({ key: q.id, kind: 'folded/out seat shows backs', value: q.backs.length });
      const pos = q.s.querySelector('.pos'); const o = eo(pos);
      if (o > 0.5 && !(pos.classList.contains('btn-pos') && getComputedStyle(pos).backgroundColor !== 'rgb(242, 242, 242)')) out.viol.push({ key: q.id, kind: 'folded seat not faded', value: o.toFixed(2) });
    } else {
      out.active++;
      if (!q.shown && q.backs.length !== 2) out.viol.push({ key: q.id, kind: 'active seat backs != 2', value: q.backs.length });
      if (q.shown && q.backs.length) out.viol.push({ key: q.id, kind: 'backs under revealed cards', value: q.backs.length });
    }
    out.backsSeen += q.backs.length;
    for (const k of q.backs) {
      const kr = R(k); if (kr.r - kr.l < 8) continue;
      if (eo(k) < 0.5) out.viol.push({ key: q.id, kind: 'back too faint', value: eo(k).toFixed(2) });
      if (kr.l < 0 || kr.r > innerWidth || kr.t < 0) out.viol.push({ key: q.id, kind: 'back outside viewport', value: [kr.l, kr.t, kr.r].map(Math.round).join(',') });
      for (const c of chips) if (inter(kr, R(c))) out.viol.push({ key: q.id, kind: 'back hits chip', value: c.textContent.trim() });
      for (const c of boardCards) if (inter(kr, R(c))) out.viol.push({ key: q.id, kind: 'back hits board slot', value: '' });
      for (const o of all) for (const l of o.labels) if (inter(kr, R(l))) out.viol.push({ key: q.id, kind: 'back hits label ' + (l.className || '').split(' ')[0], value: o.id });
      for (const o of all) if (o !== q) for (const k2 of o.backs) if (inter(kr, R(k2))) out.viol.push({ key: q.id, kind: 'back hits other backs', value: o.id });
    }
  }
  out.over = !!hand;
  return out;
};

// in-page: the mix line
const MIXCHK = () => {
  const res = { ok: true, why: [] };
  const bad = (w) => { res.ok = false; res.why.push(w); };
  const st = document.getElementById('status'), row = st.parentElement, line = st.querySelector('.mixline'), coach = st.querySelector('.coach');
  if (!line || !coach) { bad('no .mixline'); return res; }
  const cs = getComputedStyle(line);
  if (!line.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) bad('not visible');
  const lr = line.getBoundingClientRect(), rr = row.getBoundingClientRect(), cr = coach.getBoundingClientRect();
  if (lr.height <= 0) bad('height 0');
  if (parseFloat(cs.fontSize) < 13) bad('font ' + cs.fontSize);
  const txt = line.innerText;
  if (/…|\.\.\./.test(txt)) bad('ellipsis');
  if (cs.textOverflow === 'ellipsis') bad('text-overflow ellipsis');
  if (line.scrollWidth > line.clientWidth + 1) bad(`scrollWidth ${line.scrollWidth} > clientWidth ${line.clientWidth}`);
  for (const [nm, r] of [['line', lr], ['coach', cr]]) if (r.left < rr.left - 1 || r.right > rr.right + 1 || r.top < rr.top - 1 || r.bottom > rr.bottom + 1) bad(`${nm} box [${[r.left, r.top, r.right, r.bottom].map(Math.round)}] outside container [${[rr.left, rr.top, rr.right, rr.bottom].map(Math.round)}]`);
  if (row.scrollHeight > row.clientHeight + 1) bad(`container clips: scrollHeight ${row.scrollHeight} > ${row.clientHeight}`);
  const inter = (x, y) => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 0.5;
  for (const e of document.querySelectorAll('#quick, #quick button, #actions, #actions button, #heroBet, #seats .bet-chip, #pot')) { if (!e.textContent.trim() && !e.matches('#quick,#actions')) continue; if (e.matches('#seats .bet-chip, #heroBet') && !e.textContent.trim()) continue; if ([...line.querySelectorAll('.mx')].some(m => inter(m.getBoundingClientRect(), e.getBoundingClientRect()))) bad('overlaps ' + (e.id || e.className || e.tagName)); }
  // ranges cover 1..100 with no gaps
  const parts = [...line.querySelectorAll('.mx')].map(e => e.innerText.trim());
  let next = 1; const rows = parts.map(t => { const m = t.match(/^(.+?)\s+(\d+)(?:\s*[–-]\s*(\d+))?$/); return m ? { lo: +m[2], hi: m[3] ? +m[3] : +m[2], label: m[1] } : null; });
  if (rows.some(x => !x)) bad('unparsable part: ' + parts.join(' | ')); else { for (const x of rows) { if (x.lo !== next) bad(`gap/overlap at ${next} (got ${x.lo})`); next = x.hi + 1; } if (next !== 101) bad('ranges end at ' + (next - 1)); }
  res.n = parts.length; res.h = Math.round(lr.height); res.text = txt.replace(/\s+/g, ' ');
  return res;
};

const MIXES = {
  2: [['c', 'Call', 0.62], ['f', 'Fold', 0.38]],
  3: [['c', 'Call', 0.5], ['f', 'Fold', 0.3], ['r', 'Raise 105.0', 0.2]],
  4: [['c', 'Call', 0.62], ['f', 'Fold', 0.34], ['r', 'All-in', 0.03], ['r', 'Raise 105.0', 0.01]],
  5: [['c', 'Call', 0.4], ['f', 'Fold', 0.25], ['r', 'Raise 52.5', 0.15], ['r', 'Raise 105.0', 0.12], ['r', 'All-in', 0.08]],
  6: [['c', 'Check', 0.3], ['f', 'Fold', 0.2], ['r', 'Raise 26.5', 0.2], ['r', 'Raise 52.5', 0.12], ['r', 'Raise 105.0', 0.1], ['r', 'All-in', 0.08]],
};
const res = [];
const panelOn = (p) => p.evaluate(() => document.getElementById('panel')?.classList.contains('on'));
const keyOf = (v) => v.key + '|' + v.kind;
async function combo(n, vp) {
  const r = { combo: `${n}p@${vp.width}x${vp.height}`, hands: 0, streets: {}, chipViol: [], backViol: [], backsMax: 0, foldedSeen: 0, activeSeen: 0, polls: 0, mix: [] };
  const S = (s) => (r.streets[s] ||= { polls: 0, chips: 0, chipViol: 0, backViol: 0 });
  const wantPlay = ONLY.includes('chips') || ONLY.includes('backs');
  const seenAll = () => ['preflop', 'flop', 'turn'].every(x => r.streets[x]?.chips > 0);
  for (let h = 0; wantPlay && (h < HANDS || (!seenAll() && h < HANDS * 4)); h++) { // extra hands only until flop and turn chips were observed
    const p = await page(vp, 20261127 + n * 1000 + vp.width + h * 17 + 3, { seats: n, speed: 'fast', coach: 'always', orbitReview: false, calibration: false });
    try {
      await p.click('#modeCash'); const t0 = Date.now(); const streak = new Map(); let resultPolls = 0, shot = false;
      while (Date.now() - t0 < 28000) {
        if (await panelOn(p)) { await p.click('#panelClose').catch(() => {}); await sleep(100); }
        const c = await p.evaluate('(' + CHIPS + ')()'); const t = await p.evaluate('(' + TABLE + ')()'); r.polls++;
        const s = S(t.street); s.polls++; s.chips += c.chips.length; r.backsMax = Math.max(r.backsMax, t.backsSeen); r.foldedSeen += t.folded; r.activeSeen += t.active;
        const acts = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
        const onResult = acts.includes('next');
        const now = new Set();
        if (ONLY.includes('chips')) for (const v of c.viol.filter(v => !(onResult && v.kind === 'missing chip'))) { const id = keyOf(v); now.add(id); streak.set(id, (streak.get(id) || 0) + 1); if (streak.get(id) >= 2) { r.chipViol.push({ hand: h, street: t.street, ...v }); s.chipViol++; if (r.chipViol.length <= 2) await p.screenshot({ path: path.join(shotsDir, `viol${tag}-${r.combo}-h${h}-${v.key}.png`) }).catch(() => {}); } }
        if (ONLY.includes('backs')) for (const v of t.viol) { const id = 'B' + keyOf(v) + v.kind; now.add(id); streak.set(id, (streak.get(id) || 0) + 1); if (streak.get(id) >= 2) { r.backViol.push({ hand: h, street: t.street, ...v }); s.backViol++; } }
        for (const id of [...streak.keys()]) if (!now.has(id)) streak.delete(id);
        if (!shot && n === 6 && c.chips.length >= 1 && t.street === 'preflop' && acts.some(x => ['fold', 'call', 'check'].includes(x))) { shot = true; await p.screenshot({ path: path.join(shotsDir, `pre${tag}-${r.combo}.png`) }).catch(() => {}); }
        if (n === 6 && t.street === 'flop' && c.chips.length >= 1 && !S('flop').shot && acts.some(x => ['fold', 'call', 'check'].includes(x))) { S('flop').shot = 1; await p.screenshot({ path: path.join(shotsDir, `flop${tag}-${r.combo}.png`) }).catch(() => {}); }
        if (acts.includes('next')) { if (++resultPolls >= 4) break; await sleep(150); continue; }
        if (acts.some(x => ['fold', 'call', 'check'].includes(x))) { await sleep(120); const pick = acts.includes('check') ? 'check' : acts.includes('call') ? 'call' : 'fold'; await p.click(`#actions [data-a="${pick}"]`, { timeout: 2500 }).catch(() => {}); }
        await sleep(90);
      }
      r.hands++;
    } catch (e) { r.error = String(e.message).slice(0, 100); }
    await p.context().close().catch(() => {});
  }
  if (ONLY.includes('mix') && n === 6) { // size-only property: 2..6-action spots, forced through the real coach renderer, with the coach on
    const p = await page(vp, 777, { seats: 6, speed: 'fast', coach: 'always', orbitReview: false, calibration: false });
    try {
      await p.click('#modeCash'); const t0 = Date.now();
      for (const cnt of [2, 3, 4, 5, 6]) {
        // wait for a hero decision, then render a synthetic cs of cnt actions through the app's own coachHTML
        for (;;) {
          if (Date.now() - t0 > 90000) throw new Error('no hero turn');
          if (await panelOn(p)) await p.click('#panelClose').catch(() => {});
          const acts = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a));
          if (acts.some(x => ['call', 'check', 'raise'].includes(x))) break;
          if (acts.includes('next')) await p.click('#actions [data-a="next"]').catch(() => {});
          await sleep(150);
        }
        const mix = MIXES[cnt].map(([t, label, freq]) => ({ t, label, freq }));
        let ok = false; for (let i = 0; i < 25 && !ok; i++) { ok = await p.evaluate((mix) => !!(window.__poker.forceCoach && window.__poker.forceCoach(mix)), mix); if (!ok) await sleep(200); }
        if (!ok) { r.mix.push({ want: cnt, ok: false, why: ['coach not ready / spot has no solver line (forceCoach false)'] }); continue; }
        await sleep(60);
        let m = await p.evaluate('(' + MIXCHK + ')()');
        for (let i = 0; i < 3 && m.why.includes('no .mixline'); i++) { await p.evaluate((mix) => window.__poker.forceCoach(mix), mix); await sleep(60); m = await p.evaluate('(' + MIXCHK + ')()'); } // a real render may repaint the status between force and check
        m.want = cnt; r.mix.push(m);
        if (cnt === 4) await p.screenshot({ path: path.join(shotsDir, `mix4${tag}-${vp.width}x${vp.height}.png`) }).catch(() => {});
        if (cnt === 6) await p.screenshot({ path: path.join(shotsDir, `mix6${tag}-${vp.width}x${vp.height}.png`) }).catch(() => {});
        const pk = await p.evaluate(() => [...document.querySelectorAll('#actions button[data-a]')].map(b => b.dataset.a)); // keep playing: fold/call to reach the next decision
        const act = pk.includes('fold') ? 'fold' : pk.includes('check') ? 'check' : 'call'; await p.click(`#actions [data-a="${act}"]`, { timeout: 2500 }).catch(() => {});
        await sleep(300);
      }
    } catch (e) { r.mixError = String(e.message).slice(0, 100); }
    await p.context().close().catch(() => {});
  }
  res.push(r);
}
const jobs = []; for (const n of SEATS) for (const vp of SIZES) jobs.push([n, vp]);
let k = 0; await Promise.all(Array.from({ length: +arg('--par', 3) }, async () => { while (k < jobs.length) { const [n, vp] = jobs[k++]; await combo(n, vp); } }));
await browser.close(); srv.close();
res.sort((x, y) => x.combo.localeCompare(y.combo));
let hands = 0, cv = 0, bv = 0, mv = 0, blind = 0;
for (const r of res) {
  hands += r.hands; cv += r.chipViol.length; bv += r.backViol.length;
  const st = Object.entries(r.streets).map(([k, v]) => `${k}:${v.chips}ch/${v.chipViol}cv/${v.backViol}bv`).join(' ');
  const needStreets = ['preflop', 'flop', 'turn'].filter(s => !(r.streets[s]?.chips > 0));
  if (ONLY.includes('chips') && needStreets.length) blind++;
  const u = [...new Set([...r.chipViol, ...r.backViol].map(v => `${v.key} ${v.kind}`))];
  if (r.hands || r.polls) console.log(`${r.combo}: hands ${r.hands} | ${st} | chip-viol ${r.chipViol.length} back-viol ${r.backViol.length} maxBacks ${r.backsMax}${needStreets.length ? ' NO-CHIPS-ON ' + needStreets : ''}${u.length ? '  ' + u.slice(0, 5).join('; ') : ''}${r.error ? ' ERR ' + r.error : ''}`);
  for (const m of r.mix) { if (!m.ok) mv++; console.log(`  mix ${r.combo} ${m.want} actions: ${m.ok ? 'ok' : 'FAIL ' + m.why.join('; ')} (rows h ${m.h}) ${m.text || ''}`); }
  if (r.mixError) { mv++; console.log('  mix ERR', r.combo, r.mixError); }
  if (ONLY.includes('mix') && r.combo.startsWith('6p') && r.mix.length !== 5) { mv++; console.log('  mix incomplete', r.combo, r.mix.length); }
}
console.log(`TOTAL hands ${hands} chipViolations ${cv} backViolations ${bv} mixFailures ${mv} combosMissingChipStreets ${blind}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ hands, chipViolations: cv, backViolations: bv, mixFailures: mv, res }, null, 1));
process.exit(cv || bv || mv || blind ? 1 : 0);
