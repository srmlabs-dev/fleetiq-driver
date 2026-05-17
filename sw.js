/**
 * FleetIQ Driver — Service Worker v1.0.0
 * SRM Labs
 *
 * Strategy:
 *   - App shell (index.html, core.js, sync.js, pti.js, loads.js) → Cache First
 *   - Google Sheets sync (fetch to external URL) → Network Only (skip cache)
 *   - Everything else → Network First, fallback to cache
 */

const CACHE_NAME = 'fleetiq-driver-v1';

// App shell — these files are cached on install
const APP_SHELL = [
  '/fleetiq-driver/',
  '/fleetiq-driver/index.html',
  '/fleetiq-driver/core.js',
  '/fleetiq-driver/sync.js',
  '/fleetiq-driver/pti.js',
  '/fleetiq-driver/loads.js',
  '/fleetiq-driver/manifest.json',
];

// ── INSTALL ────────────────────────────────────────────────────────────────
// Cache app shell immediately on install

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => {
        console.log('[FleetIQ SW] App shell cached');
        return self.skipWaiting(); // activate immediately
      })
      .catch(err => console.warn('[FleetIQ SW] Cache install error:', err))
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────────────────
// Delete old caches on activate

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[FleetIQ SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log('[FleetIQ SW] v1.0.0 activated');
        return self.clients.claim(); // take control immediately
      })
  );
});

// ── FETCH ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Google Sheets / external sync requests → Network Only
  //    Never cache these — always need fresh data
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleapis.com') ||
    event.request.method === 'POST'
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. App shell files → Cache First, then network
  //    If cached → serve instantly (works offline)
  //    If not cached → fetch and cache for next time
  if (APP_SHELL.some(path => url.pathname === path || url.pathname.endsWith(path.replace('/fleetiq-driver', '')))) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) return cached;
          return fetch(event.request)
            .then(response => {
              if (!response || response.status !== 200) return response;
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
              return response;
            });
        })
    );
    return;
  }

  // 3. Everything else → Network First, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
