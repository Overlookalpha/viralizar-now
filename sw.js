// Cache apenas da tela offline e de recursos publicos. Autenticacao, pedidos,
// saldo, pagamentos e respostas do Firebase nunca entram no Cache Storage.
const BASE = new URL('./', self.location.href);
const PREFIX = 'viralizar-' + BASE.pathname + '-';
const CACHE = PREFIX + 'v1';
const FILES = ['offline.html', 'style.css', 'pwa.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
const PUBLIC_URLS = new Set(FILES.map((path) => new URL(path, BASE).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...PUBLIC_URLS])));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(new URL('offline.html', BASE).href)) || Response.error()));
    return;
  }
  if (!PUBLIC_URLS.has(url.href)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request)) || Response.error();
    }
  })());
});
