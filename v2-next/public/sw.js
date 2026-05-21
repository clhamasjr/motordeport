/**
 * Service Worker — LhamasCred FlowForce V2
 *
 * Estrategia simples e segura:
 *  - PASSA TUDO direto pra rede (network-first) por padrao
 *  - Pra assets estaticos (/_next/static, /icons, fonts): cache-first
 *  - /api/* SEMPRE rede (nunca cacheia chamadas de API)
 *
 * Versionamento: muda VERSION quando alterar logica do SW.
 */
const VERSION = 'v1';
const CACHE_STATIC = `lhamas-static-${VERSION}`;
const CACHE_PAGES = `lhamas-pages-${VERSION}`;

const STATIC_PRECACHE = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(STATIC_PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // /api/* — sempre rede, nunca cacheia
  if (url.pathname.startsWith('/api/')) return;

  // Assets estaticos do Next.js + icons + fontes → cache-first
  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/manifest.webmanifest';

  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
          }
          return res;
        });
      }).catch(() => fetch(request))
    );
    return;
  }

  // Paginas (HTML) — network-first com fallback pra cache
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_PAGES).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }
});
