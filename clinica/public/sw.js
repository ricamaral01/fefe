// Service worker: guarda apenas a "casca" do app (HTML/CSS/JS/ícones).
// Dados de pacientes NUNCA são armazenados em cache (sigilo médico).
const CACHE = 'clinica-v1';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest',
  '/js/app.js', '/js/core.js', '/js/print.js',
  '/js/views/login.js', '/js/views/agenda.js', '/js/views/atendimento.js', '/js/views/recepcao.js',
  '/js/views/pacientes.js', '/js/views/config.js', '/js/views/perfil.js',
  '/icons/sprite.svg', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/c/') || url.pathname.startsWith('/webhook/')) return; // sempre rede
  // Rede primeiro (para receber atualizações), cache como reserva offline
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('/index.html') : undefined)))
  );
});
