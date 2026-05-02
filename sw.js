/* Service Worker: shell offline + tentativa de cache das libs CDN na primeira instalação */
const CACHE_NAME = 'slump-pwa-v2-industrial';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg'
];
const LIB_CDN = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        cache.addAll(APP_SHELL).catch(() => {}),
        ...LIB_CDN.map((url) => cache.add(url).catch(() => {}))
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy).catch(() => {}));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
