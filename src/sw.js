/* SMI-V Plus service worker
 * Privacy: this app renders patient PII. Never cache HTML/PHP responses or
 * exports. Only static assets (css/js/icons) are cached, cache-first.
 * Failed navigations fall back to a local offline page.
 */
const CACHE_VERSION = 'smiv-static-v1';
const OFFLINE_URL = new URL('offline.html', self.registration.scope).pathname;

const STATIC_EXT = /\.(?:css|js|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|ico)(?:\?.*)?$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: never cache (PII pages). Network-first, offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets only: cache-first.
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Everything else (PHP endpoints, exports, API calls): always network, no cache.
});
