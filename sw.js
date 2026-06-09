// Cue service worker.
// Goal: make the app installable as a PWA and let it open from the home
// screen even on the first cold launch after install. Intentionally NOT
// trying to be an offline cache — the camera needs HTTPS + a live MediaPipe
// CDN + the Anthropic API, none of which work offline. Network is still
// the source of truth for everything; we just pre-warm the shell.

const VERSION    = 'cue-shell-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // Use .add on each URL individually so one missing file doesn't fail
      // the whole install.
      Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for everything. If the network is up, we always serve fresh
// (Vercel sends no-cache headers anyway). Only fall back to the cached shell
// when the network is unreachable AND the cache happens to have a copy.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs — leave API, MediaPipe CDN, Anthropic etc.
  // to the network alone.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});
