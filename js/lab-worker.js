// Module worker: runs js/lab-core.js rootMix on the existing postflop solver.
import { rootMix } from './lab-core.js';
self.onmessage = (e) => {
  const { id, input, iters } = e.data;
  try { self.postMessage({ id, ...rootMix(input, iters) }); } catch (err) { self.postMessage({ id, error: String(err.message || err) }); }
};
