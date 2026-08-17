// DO NOT cache build assets (.js/.css) or navigation HTML here. This cache is
// unbounded and never evicts: Next.js emits content-hashed chunk names, so every
// deploy added a fresh set and removed none. It reached 4,826 entries / 313 MB /
// 4,320 JS files, which pushed the origin past the iOS storage budget. WebKit
// then evicts the WHOLE origin, cookies included, which signed users out.
//
// /_next/static is already served with `Cache-Control: public, max-age=31536000,
// immutable`, so the browser's own HTTP cache handles those, and unlike this one
// it evicts under pressure. Caching them here a second time buys nothing.
//
// Navigations are network-only and fall through to the offline page below.
// Authenticated page HTML must not sit on disk.
//
// Only the small, stable app shell belongs in here.
const CACHE_NAME = 'rooted-v2';

const APP_SHELL = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests and API routes
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache small, stable image assets only. See the note at the top of
        // this file before adding anything here.
        if (response.ok && url.pathname.match(/\.(png|svg|ico)$/)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Serve from cache when offline
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;

          // For navigation requests, show offline fallback
          if (event.request.mode === 'navigate') {
            return new Response(
              `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rooted — Offline</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #faf9f6; font-family: -apple-system, sans-serif; text-align: center; padding: 2rem; }
    .card { max-width: 320px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 700; color: #2d2926; margin: 0 0 0.5rem; }
    p { font-size: 0.875rem; color: #7a6f65; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🌿</div>
    <h1>You're offline</h1>
    <p>Reconnect to the internet to continue using Rooted.</p>
  </div>
</body>
</html>`,
              { headers: { 'Content-Type': 'text/html' } }
            );
          }

          return new Response('Offline', { status: 503 });
        });
      })
  );
});
