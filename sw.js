Claude
Crease Cricket Calculator
Artifact
·Only you
Added: catches and stumpings by the keeper now show the † in the dismissal, like “c †Latham b Henry” and “st †Latham b Henry”. Before, the keeper was only marked on his own name as “(c, wk)”, so the dismissal text had nothing.

    Where it shows: the scorecard, CSV and scorecard image all use the same dismissal text, so they pick it up. A catch by anyone else stays plain, and “c & b” has no †.
Which keeper: it uses whoever is keeping at that moment, so it works with the Change keeper option.
    Old matches: dismissals already recorded stay as they were. Only new wickets get the †.
Stats: the † doesn’t affect catch or stumping credit.
    I tested a keeper catch, another fielder’s catch and a stumping, plus replay, and the regression tests I re-ran still pass.

    Copy live.js, records.js and sw.js (now crease-v62) into your Cricket folder, then commit and push.

    Live
JS
Records
JS
Sw
JS
1793874119653_image.png
it is still now showing (crease version is 63, i change it)

Ruling out a stale cached service worker as the cause
The † is only added when the app knows the fielder is the keeper, and only for wickets scored after this update. There are two likely reasons yours didn’t get one.

    Latham wasn’t set as New Zealand’s keeper. The app only knows the keeper from a “(wk)” tag in the squad (for example Tom Latham (c) (wk)), or from Change keeper in the More menu. Buttler shows “(c, wk)” because England’s squad had the tag, so check New Zealand’s squad for the same. If it’s missing, use Change keeper and pick Latham. Only wickets scored after that get the †.
The wicket was scored before this update. Dismissals that are already recorded keep their old text.
    For this wicket, Edit figures lets you change the dismissal text directly. Type c †Tom Latham b Matt Henry and it will show the †. Catch credit and stats still work, because the † is stripped when the fielder is read.

    If Latham was already tagged (wk) and the wicket was scored after the update, tell me and I’ll dig into it. I tested a tagged keeper’s catch and it showed the † correctly.

    wicket was scored before the update

Working out how old wicket markers get updated on rebuild
Then that explains it. The † is added at the moment a wicket is scored, so wickets scored before the update keep their old text. Nothing is wrong with the match.

    For this wicket, use Edit figures and change the dismissal to c †Tom Latham b Matt Henry. From now on, every catch or stumping by a keeper that’s set in the squad gets the † automatically.

    I could also make the † appear on old dismissals at display time, so you wouldn’t have to edit them. Let me know if you want that.

    sure

Shared 2 files, ran 4 commands, used artifacts
Crease Cricket Calculator
Artifact
·Only you
Old catches and stumpings by the keeper now show the † too, so your Buttler wicket should read “c †Tom Latham b Matt Henry”. I tested this, and the regression tests I re-ran still pass.

    Needs the keeper set: Latham must be marked (wk) in New Zealand’s squad, or set through Change keeper.
    Where it shows: the scorecard, CSV and scorecard image. The match data itself is not changed.
    Typed-in text: a dismissal you typed by hand in Edit figures is shown exactly as you typed it.
    Copy live.js and sw.js into your Cricket folder, then commit and push. I set sw.js to crease-v64, since you’re already on 63. Change it if you’d rather use another number.

    Live
JS
Sw
JS



Claude is AI and can make mistakes.
    Sw · JS
Copied
/* Crease — service worker: keeps a copy of the app so it opens and works with no connection.
   Strategy: answer from the cache straight away, then refresh that file from the network in the
   background, so edits reach users on their next visit. Change VERSION when files are added or removed,
   and whenever JS modules change in ways that depend on each other (new exports or imports). */
const VERSION = 'crease-v64';
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
  './js/tabs/wtc.js',
  './js/tabs/tour.js',
  './js/tabs/cwc.js',
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

Claude finished the response
