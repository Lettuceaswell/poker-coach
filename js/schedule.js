// Cross-day spaced repetition for drill and quiz items (persisted in localStorage, one small store).
// A miss is due again the next day; a correct answer grows the gap 1 -> 3 -> 7 -> 16 days (expanding
// intervals, Cepeda et al. 2006; the gap that helps most grows with how long you need to remember,
// Cepeda et al. 2008). Sleep between sessions helps consolidate what was just practiced (Walker &
// Stickgold 2004; transfer to poker decisions is speculative). Within-session returns live elsewhere.
export const KEY = 'pc-sched-v1';
export const STEPS = [1, 3, 7, 16];
const MAX_ITEMS = 600;
const DAY = 864e5;
export const dayOf = (t = Date.now()) => { const d = new Date(t); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY); };
const empty = () => ({ v: 1, items: {} });
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (!o || typeof o !== 'object' || !o.items || typeof o.items !== 'object' || Array.isArray(o.items)) return empty();
    for (const [k, e] of Object.entries(o.items)) if (!e || !Number.isFinite(e.due) || !Number.isFinite(e.step)) delete o.items[k];
    return o;
  } catch { return empty(); }
}
function save(o) {
  const ks = Object.keys(o.items);
  if (ks.length > MAX_ITEMS) ks.sort((a, b) => o.items[a].due - o.items[b].due).slice(MAX_ITEMS).forEach(k => delete o.items[k]);
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}
// kind: 'pre' | 'post' | 'quiz'; id unique within the kind; spec: what is needed to rebuild the item
export function record(kind, id, ok, spec) {
  const o = load(), k = kind + '|' + id, today = dayOf(), e = o.items[k];
  let step;
  if (!ok) step = 0;                          // miss: back tomorrow
  else if (!e) step = 1;                      // first answer right: 3 days
  else step = Math.min(e.step + 1, STEPS.length - 1);
  o.items[k] = { kind, id, step, due: today + STEPS[step], last: today, spec: spec || e?.spec || null, seen: (e?.seen || 0) + 1 };
  save(o); served.delete(k);
  return o.items[k];
}
const served = new Set(); // handed out this page load but not answered yet
export function dueItems(kind) {
  const o = load(), today = dayOf();
  return Object.entries(o.items).filter(([k, e]) => e.due <= today && (!kind || e.kind === kind)).sort((a, b) => a[1].due - b[1].due).map(([k, e]) => ({ key: k, ...e }));
}
export const dueCount = () => dueItems().length;
// next due item of this kind that has not been handed out yet this load; null when none
export function takeDue(kind) {
  const it = dueItems(kind).find(x => !served.has(x.key));
  if (!it) return null;
  served.add(it.key); return it;
}
export const hasDue = (kind) => dueItems(kind).some(x => !served.has(x.key));
export function nextDue() {
  const o = load(), ds = Object.values(o.items).map(e => e.due);
  return ds.length ? Math.min(...ds) : null;
}
// line for the menu / drill screen
export function dueLine() {
  const n = dueCount();
  if (n > 0) return `${n} due today`;
  const nd = nextDue();
  if (nd == null) return '0 due today';
  const wd = new Date(nd * DAY).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `Nothing due today; next review ${wd}`;
}
export function dump() { return load(); }
