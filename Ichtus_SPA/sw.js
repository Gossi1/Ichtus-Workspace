/* ============================================
   Ichtus SPA — Service Worker
   Cache-first strategie voor static assets
   Network-first voor API calls
   ============================================ */

const CACHE_NAME = 'ichtus-spa-v7';

// Static assets to pre-cache on install.
const PRECACHE_URLS = [
  '/Ichtus_SPA/',
  '/Ichtus_SPA/index.html',
  '/Ichtus_SPA/css/style.css?v=10',
  '/Ichtus_SPA/css/checklist-modern.css',
  '/shared-assets/css/branding.css?v=2.1.0',
  '/Ichtus_SPA/js/router.js',
  '/Ichtus_SPA/js/state.js',
  '/Ichtus_SPA/js/i18n.js',
  '/Ichtus_SPA/js/ws-client.js',
  '/Ichtus_SPA/js/app.js',
  '/Ichtus_SPA/js/modules/update-popup.js',
  '/Ichtus_SPA/js/modules/dashboard.js',
  '/Ichtus_SPA/js/modules/agenda.js',
  '/Ichtus_SPA/js/modules/checklist.js',
  '/Ichtus_SPA/js/modules/setlist.js',
  '/Ichtus_SPA/js/modules/patchbay.js',
  '/Ichtus_SPA/js/modules/analytics.js',
  '/Ichtus_SPA/js/modules/ndi.js',
  '/Ichtus_SPA/js/modules/settings.js',
  '/Ichtus_SPA/js/modules/stagebuilder.js',
  '/Ichtus_SPA/js/modules/songidassigner.js',
  '/Ichtus_SPA/css/songidassigner.css',
  '/shared-assets/js/sidebar.js',
  '/shared-assets/js/sidebar-injector.js',
  '/Ichtus_SPA/manifest.json',
  '/Ichtus_SPA/icons/icon.svg',
  '/Ichtus_SPA/icons/icon-192.png',
  '/Ichtus_SPA/icons/icon-512.png',
  '/Ichtus_SPA/version.json',
  '/Ichtus_SPA/offline.html'
];

// API patterns that should always go network-first
const API_PATTERNS = [
  '/api/'
];

// ——— INSTALL ———
self.addEventListener('install', event => {
  console.log('[SW] Install — precaching static assets');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Precache failed for some URLs (expected if offline during install):', err);
      });
    })
  );
  // Force activation of the new SW immediately so stale caches are replaced.
  self.skipWaiting();
});

// ——— MESSAGE: listen for 'skip-waiting' from the page ———
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') {
    console.log('[SW] Skip-waiting requested — activating new version');
    self.skipWaiting();
  }
});

// ——— ACTIVATE ———
self.addEventListener('activate', event => {
  console.log('[SW] Activate — cleaning old caches');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ——— FETCH ———
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always skip chrome-extension and non-GET requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  // API calls → network only, no cache fallback (server offline = error)
  if (API_PATTERNS.some(pattern => event.request.url.includes(pattern))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Navigation requests → network first, offline page if server unreachable
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static assets → stale-while-revalidate
  // Serveert gecached eerst, update op achtergrond — geen handmatige version bumps nodig
  event.respondWith(staleWhileRevalidate(event.request));
});

// ——— STRATEGIES ———

async function staleWhileRevalidate(request) {
  // Probeer cache first (direct antwoord, supersnel)
  const cachedResponse = await caches.match(request);
  
  // Haal nieuwe versie op van netwerk (op achtergrond, blokkeert niet)
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse && networkResponse.status === 200) {
      const cache = caches.open(CACHE_NAME);
      cache.then(c => c.put(request, networkResponse.clone()));
    }
    return networkResponse;
  }).catch(() => cachedResponse);
  
  // Return cached versie direct, of wacht op netwerk als cache leeg is
  return cachedResponse || fetchPromise;
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // API calls: no cache fallback — let the caller handle the error
    if (API_PATTERNS.some(pattern => request.url.includes(pattern))) {
      throw error;
    }
    // Navigation: show offline page instead of cached SPA
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('/Ichtus_SPA/offline.html');
      if (offlinePage) return offlinePage;
    }
    throw error;
  }
}
