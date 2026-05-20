/**
 * Admiral — Service Worker
 * Strategi:
 *   API-anrop (/api/*, /auth/*) → network-only (alltid färsk data)
 *   Skal (HTML, ikoner, manifest)  → cache-first, uppdateras i bakgrunden
 */
const CACHE = 'admiral-v2';
const SHELL = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/admin.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
];

// ── Install: pre-cacha skalet ────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ── Activate: rensa gamla cachar ────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: routing-strategi ──────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API & auth → alltid nätverk (fresh data, inga cachar)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/.netlify/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Statiska resurser → cache-first, stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached); // fallback till cache om offline

      return cached || networkFetch;
    })
  );
});
