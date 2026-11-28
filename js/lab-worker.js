// Module worker: runs js/lab-core.js on the existing postflop solvers (heads-up root solve, per-street lock report, 3-way river).
import { rootMix, lockReport, threeWaySolve } from './lab-core.js';
self.onmessage = (e) => {
  const { id, kind, input, iters, locks } = e.data;
  try {
    if (kind === 'lock') self.postMessage({ id, ...lockReport(input, locks || [], iters) });
    else if (kind === 'three') self.postMessage({ id, ...threeWaySolve(input, iters, (d, n) => self.postMessage({ id, progress: d, of: n })) });
    else self.postMessage({ id, ...rootMix(input, iters) });
  } catch (err) { self.postMessage({ id, error: String(err.message || err) }); }
};
