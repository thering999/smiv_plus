// SMI-V Plus — service worker เก็บแคชไว้ดูออฟไลน์ได้ (bump CACHE_VERSION ทุกครั้งที่แก้ไฟล์หลัก)
const CACHE_VERSION = 'smiv-plus-v20260911d';
const APP_SHELL = ['./', './index.html', './style.css', './app.js?v=20260911d', './ui.js?v=20260911d', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  // data.json: network-first (อยากได้ข้อมูลใหม่สุดก่อน) — offline ค่อย fallback ไป cache
  if (url.pathname.endsWith('data.json')) {
    event.respondWith(
      fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // ไฟล์อื่นในเว็บนี้เอง: cache-first (เร็ว, ใช้ออฟไลน์ได้) — อัปเดตแคชเบื้องหลังเงียบๆ
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(res => {
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
