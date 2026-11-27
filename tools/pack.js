// Gzips solver output for the app: data/preflop-<n>.{bin,vis} -> .gz
import fs from 'fs'; import zlib from 'zlib';
for (const n of [3, 4, 5, 6]) for (const ext of ['bin', 'vis']) {
  const f = `data/preflop-${n}.${ext}`;
  if (!fs.existsSync(f)) { console.log('missing', f); continue; }
  const gz = zlib.gzipSync(fs.readFileSync(f), { level: 9 });
  fs.writeFileSync(f + '.gz', gz);
  console.log(f, fs.statSync(f).size, '->', gz.length);
}
