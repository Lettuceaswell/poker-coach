// Web Worker wrapper around the postflop solver.
//
// Load as a module worker:
//   new Worker(new URL('./js/postflop/worker.js', import.meta.url), { type: 'module' })
//
// Messages in:
//   { cmd: 'solve', id, input, hands: [comboIdx...], path }   start a solve
//       (any solve already running is stopped first)
//   { cmd: 'watch', id, hands, path }   change what the updates report
//   { cmd: 'stop', id }                 stop; a final done:true update follows
// Messages out (about every 200 ms, and once more with done: true):
//   { id, iter, exploit, exploitIter, done, reason, elapsedMs, depthLimited,
//     memoryBytes, path, actions, strategies: { comboIdx: { actions, probs } } }
//   { id, error }   if the input is rejected (bad board, over memory, ...)
//
// `exploit` is the last exact exploitability (% of the root pot) and
// `exploitIter` the iteration it was measured at; it is null until the first
// measurement. On river and turn solves a measurement costs about one
// iteration and runs on a cadence that keeps it near 20% of the time. On a
// depth-limited flop one measurement blocks for seconds (no updates, no stop
// meanwhile; the first call also builds the exact leaf matrices), so it is
// off unless input.measureExploit === true (then every >= 5 s), and those
// solves run to maxMs with exploit: null.
// Stops at exploit <= input.targetExploit (default 0.3) or input.maxMs
// (default 15000). `probs` is null for a combo that is not in the acting
// player's range at that node (zero weight, or blocked by the board).
//
// The glue is thin so Node can drive the same code: createWorkerHandler(post)
// returns the onmessage function; tools/postflop-test.js uses it directly.

import { createSolver } from './solver.js';

const REPORT_MS = 200;
const SLICE_MS = 40;

// Yield to the event loop between slices so 'stop' messages get through.
const yieldNow = typeof setImmediate === 'function'
  ? fn => setImmediate(fn)
  : typeof MessageChannel === 'function'
    ? (() => {
      const ch = new MessageChannel();
      const queue = [];
      ch.port1.onmessage = () => { const fn = queue.shift(); if (fn) fn(); };
      return fn => { queue.push(fn); ch.port2.postMessage(0); };
    })()
    : fn => setTimeout(fn, 0);

// Map real actions this street ({ type, amount } with amount = total put in this
// street, BB) to the solver's nearest actions. Bets/raises snap to the closest size
// by log ratio; 'approx' flags anything more than 35% off.
export function mapActs(solver, acts) {
  const path = [];
  let approx = false;
  for (const a of acts || []) {
    const opts = solver.actionsAt(path);
    if (!opts.length) break;
    let k = -1;
    if (a.type === 'fold') k = opts.findIndex(o => o.type === 'fold');
    else if (a.type === 'check' || a.type === 'call') k = opts.findIndex(o => o.type === 'check' || o.type === 'call');
    else {
      let best = Infinity;
      opts.forEach((o, i) => {
        if (!['bet', 'raise', 'allin'].includes(o.type)) return;
        const d = a.allIn && o.type === 'allin' ? -1 : Math.abs(Math.log(a.amount / o.amount));
        if (d < best) { best = d; k = i; }
      });
      if (k >= 0 && best > Math.log(1.35)) approx = true;
      if (k < 0) { k = opts.findIndex(o => o.type === 'call' || o.type === 'check'); approx = true; }
    }
    if (k < 0) { approx = true; break; }
    path.push(k);
  }
  return { path, approx };
}

export function createWorkerHandler(post) {
  const jobs = new Map();
  const finished = new Map(); // id -> job, kept for lookups after the solve stops

  function snapshot(job, done, reason) {
    const { solver } = job;
    const msg = {
      id: job.id, iter: solver.iterations, exploit: job.exploit, exploitIter: job.exploitIter,
      done, elapsedMs: Math.round(performance.now() - job.t0), depthLimited: solver.depthLimited,
      memoryBytes: solver.memoryBytes, path: job.path, actions: [], strategies: {},
    };
    if (reason) msg.reason = reason;
    msg.approx = !!job.approx;
    try {
      const actions = solver.actionsAt(job.path);
      msg.actions = actions;
      const info = solver.nodeInfo(job.path);
      msg.player = info && info.type !== 'chance' ? info.player : null;
      for (const h of job.hands) msg.strategies[h] = { actions, probs: solver.strategyAt(job.path, h) };
    } catch (e) {
      msg.pathError = String(e.message || e);
    }
    return msg;
  }

  function measure(job) {
    const a = performance.now();
    job.exploit = job.solver.exploitability();
    job.exploitIter = job.solver.iterations;
    job.exploitCost = performance.now() - a;
    job.lastExploitAt = performance.now();
  }

  function finish(job, reason) {
    if (job.finished) return;
    job.finished = true;
    jobs.delete(job.id);
    finished.set(job.id, job);
    while (finished.size > 3) finished.delete(finished.keys().next().value);
    post(snapshot(job, true, reason));
  }

  function run(job) {
    if (job.stopped) return finish(job, 'stopped');
    const { solver, input } = job;
    const sliceEnd = performance.now() + SLICE_MS;
    do {
      const a = performance.now();
      solver.step(1);
      const dt = performance.now() - a;
      job.iterMs = job.iterMs ? 0.8 * job.iterMs + 0.2 * dt : dt;
    } while (performance.now() < sliceEnd);
    const now = performance.now();
    const elapsed = now - job.t0;
    // Exploitability cadence: guess the cost before the first measurement
    // (depth-limited flops also build their exact leaf matrices then).
    const cost = job.exploitCost ?? job.iterMs * (solver.depthLimited ? 15 : 1.2);
    const minGap = solver.depthLimited ? 5000 : 0;
    if (job.measureOn && now - job.lastExploitAt >= Math.max(minGap, 4 * cost) && elapsed + cost < job.maxMs) measure(job);
    if (job.exploit != null && job.exploit <= job.target) return finish(job, 'target');
    if (elapsed >= job.maxMs) {
      // A final measurement if it is cheap relative to the budget.
      if (job.measureOn && cost < 0.25 * job.maxMs && job.exploitIter !== solver.iterations) measure(job);
      return finish(job, 'time');
    }
    if (now - job.lastPost >= REPORT_MS) { job.lastPost = now; post(snapshot(job, false)); }
    yieldNow(() => run(job));
  }

  return function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.cmd === 'solve') {
      for (const j of jobs.values()) j.stopped = true;
      let solver;
      try {
        solver = createSolver(msg.input);
      } catch (e) {
        post({ id: msg.id, error: String(e.message || e) });
        return;
      }
      const input = msg.input || {};
      const t0 = performance.now();
      const mapped = msg.acts ? mapActs(solver, msg.acts) : { path: msg.path || [], approx: false };
      const job = {
        id: msg.id, solver, input, t0, lastPost: t0, lastExploitAt: t0,
        hands: msg.hands || [], path: mapped.path, approx: mapped.approx,
        target: input.targetExploit ?? 0.3, maxMs: input.maxMs ?? 15000,
        exploit: null, exploitIter: null, exploitCost: null, iterMs: 0,
        stopped: false, finished: false,
        measureOn: !solver.depthLimited || input.measureExploit === true,
      };
      jobs.set(msg.id, job);
      yieldNow(() => run(job));
    } else if (msg.cmd === 'watch') {
      const job = jobs.get(msg.id) || finished.get(msg.id);
      if (job) {
        if (msg.hands) job.hands = msg.hands;
        if (msg.acts) { const m = mapActs(job.solver, msg.acts); job.path = m.path; job.approx = m.approx; }
        else if (msg.path) job.path = msg.path;
        if (job.finished) post(snapshot(job, true, 'lookup'));
      }
    } else if (msg.cmd === 'ranges') {
      // ranges at the end of a street, for the next street's solve
      const job = jobs.get(msg.id) || finished.get(msg.id);
      if (!job) { post({ rid: msg.rid, ranges: null }); return; }
      try {
        const { path } = mapActs(job.solver, msg.acts);
        post({ rid: msg.rid, ranges: [job.solver.rangeAt(path, 0), job.solver.rangeAt(path, 1)] });
      } catch (e) { post({ rid: msg.rid, ranges: null, error: String(e.message || e) }); }
    } else if (msg.cmd === 'stop') {
      const job = jobs.get(msg.id);
      if (job) job.stopped = true;
    }
  };
}

// Browser worker glue (not taken in Node or on the main thread).
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  const handle = createWorkerHandler(m => self.postMessage(m));
  self.onmessage = e => handle(e.data);
}
