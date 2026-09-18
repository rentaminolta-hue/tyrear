/**
 * sw.js — Service Worker (Offline Support)
 * Caches the app shell (HTML/CSS/JS) so the dashboard loads without a
 * connection. Model files (.onnx) are intentionally NOT precached here
 * since they can be large and are supplied by the user at runtime; they
 * are cached opportunistically on first successful fetch instead.
 */
const CACHE_NAME = 'tirecycle-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './js/app.js',
  './js/core/config.js',
  './js/core/state.js',
  './js/core/reporting.js',
  './js/knowledge/engine.js',
  './js/vision/detector.js',
  './js/tracking/tracker.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Network-first for cross-origin (CDN) scripts so updates aren't stuck stale;
  // fall back to cache when offline.
  if (new URL(request.url).origin !== self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for the local app shell + opportunistic model caching.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return res;
      }).catch(() => cached);
    })
  );
});
