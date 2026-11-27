// Network-first so pushes show up right away; cache keeps it playable offline.
const CACHE = 'poker-coach-v18';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/engine.js', 'js/bots.js', 'js/cards.js', 'js/coach.js', 'js/preflop-tree.js', 'js/ranges.js', 'js/postflop-coach.js',
  'js/postflop/solver.js', 'js/postflop/eval7.js', 'js/postflop/worker.js',
  'js/explain.js', 'js/history.js', 'js/grid.js', 'js/drills.js', 'js/progress.js', 'js/postflop-drills.js', 'data/postflop-drills.json', 'js/strength.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
