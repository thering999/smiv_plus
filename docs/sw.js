// SMI-V Plus — service worker เก็บแคชไว้ดูออฟไลน์ได้ (bump CACHE_VERSION ทุกครั้งที่แก้ไฟล์หลัก)
// ⚠️ ต้องขยับ CACHE_VERSION ให้ตรงกับเลข v= ใน docs/index.html ด้วย ไม่งั้นผู้ใช้จะได้ไฟล์เก่าค้าง
const CACHE_VERSION = 'smiv-plus-v20261008r';
const APP_SHELL = ['./', './index.html', './style.css?v=20261008r', './app.js?v=20261008r', './ui.js?v=20261008r', './manifest.json'];

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

  // หน้าเว็บ (navigation) + data.json: network-first — ได้ index.html ใหม่ทันทีหลัง deploy
  // (cache-first ทำให้ผู้ใช้ค้าง index เก่าที่ชี้ ui.js?v= เก่าไปอีกรอบ) — offline ค่อย fallback ไป cache
  if (event.request.mode === 'navigate' || url.pathname.endsWith('data.json')) {
    event.respondWith(
      // cache: 'no-cache' = ถามเซิร์ฟเวอร์ทุกครั้ง (ETag) ไม่ใช้ HTTP cache 10 นาทีของ GitHub Pages
      fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
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
