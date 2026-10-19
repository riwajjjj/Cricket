/* Crease — service worker: keeps a copy of the app so it opens and works with no connection.
   Strategy: answer from the cache straight away, then refresh that file from the network in the
   background, so edits reach users on their next visit. Change VERSION when files are added or removed,
   and whenever JS modules change in ways that depend on each other (new exports or imports). */
const VERSION = 'crease-v18';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './css/fonts.css',
  './fonts/figtree-latin-400-normal.woff2',
  './fonts/figtree-latin-500-normal.woff2',
  './fonts/figtree-latin-600-normal.woff2',
  './fonts/figtree-latin-700-normal.woff2',
  './fonts/jetbrains-mono-latin-400-normal.woff2',
  './fonts/jetbrains-mono-latin-500-normal.woff2',
  './fonts/saira-condensed-latin-500-normal.woff2',
  './fonts/saira-condensed-latin-600-normal.woff2',
  './fonts/saira-condensed-latin-700-normal.woff2',
  './fonts/saira-condensed-latin-800-normal.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/backup.js',
  './js/charts.js',
  './js/export.js',
  './js/groups.js',
  './js/main.js',
  './js/maths.js',
  './js/pwa.js',
  './js/records.js',
  './js/router.js',
  './js/state.js',
  './js/stats.js',
  './js/testsim.js',
  './js/ui.js',
  './js/utils.js',
  './vendor/chart.umd.js',
  './js/tabs/batting.js',
  './js/tabs/bowling.js',
  './js/tabs/compare.js',
  './js/tabs/dls.js',
  './js/tabs/impact.js',
  './js/tabs/live.js',
  './js/tabs/nrr.js',
  './js/tabs/players.js',
  './js/tabs/saved.js',
  './js/tabs/tournament.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own HTTP cache, so a new version never stores stale copies of old files.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
      caches.keys()
          .then(keys => Promise.all(keys.filter(k => k.startsWith('crease-') && k !== VERSION).map(k => caches.delete(k))))
          .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req, { cache: 'no-cache' }) // always check with the server, not the HTTP cache
        .then(res => { if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()); return res; })
        .catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    return req.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error();
  })());
});