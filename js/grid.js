// 13x13 starting-hand grid. Rows/cols run A..2; above the diagonal = suited,
// below = offsuit, diagonal = pairs. Class index: pairs r*13+r, suited hi*13+lo,
// offsuit lo*13+hi (rank 0 = deuce).
const R = '23456789TJQKA';

// offsuit cells need lo*13+hi with hi = column rank
function idx(row, col) {
  const a = 12 - row, b = 12 - col;
  if (row === col) return a * 13 + a;
  if (row < col) return a * 13 + b;   // suited: a > b
  return a * 13 + b;                  // offsuit: a < b, so lo*13+hi
}

export function label(row, col) {
  const a = 12 - row, b = 12 - col;
  if (row === col) return R[a] + R[a];
  if (row < col) return R[a] + R[b] + 's';
  return R[b] + R[a] + 'o';
}

export const ACT_COLOR = { r: '#ff7a5c', c: '#6aa8ff', f: 'transparent' };

// mixes: Array(169) of [{ t, freq }] (or null), weights: Array(169) of 0..1 (or null)
// opts.mark: class index to outline; opts.dim: classes with weight 0 drawn faint
export function gridHTML({ mixes = null, weights = null, mark = -1, title = '', legend = true } = {}) {
  let cells = '';
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const c = idx(row, col);
      let bg = '#151518', op = 1;
      if (mixes && mixes[c]) {
        // stacked left-to-right: raise, call, fold (fold = empty)
        const m = mixes[c];
        const f = (t) => m.filter(x => x.t === t).reduce((s, x) => s + x.freq, 0);
        const r = f('r') * 100, cl = f('c') * 100;
        bg = `linear-gradient(90deg, ${ACT_COLOR.r} 0 ${r}%, ${ACT_COLOR.c} ${r}% ${r + cl}%, #151518 ${r + cl}% 100%)`;
      } else if (weights) {
        const w = Math.max(0, Math.min(1, weights[c] || 0));
        bg = w > 0.01 ? `rgba(255, 196, 120, ${0.15 + 0.85 * w})` : '#151518';
      }
      cells += `<i class="${c === mark ? 'mark' : ''}" style="background:${bg};opacity:${op}">${label(row, col)}</i>`;
    }
  }
  const leg = legend && mixes
    ? `<div class="grid-legend"><span><b style="background:${ACT_COLOR.r}"></b>Raise</span><span><b style="background:${ACT_COLOR.c}"></b>Call</span><span><b style="background:#151518;border:1px solid #333"></b>Fold</span></div>`
    : legend && weights ? `<div class="grid-legend"><span><b style="background:rgba(255,196,120,1)"></b>In range</span><span><b style="background:rgba(255,196,120,.35)"></b>Sometimes</span></div>` : '';
  return `${title ? `<div class="grid-title">${title}</div>` : ''}<div class="hgrid">${cells}</div>${leg}`;
}

export { idx as gridIndex };
