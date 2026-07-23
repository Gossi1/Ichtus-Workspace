/* ============================================
   Ichtus SPA — Service Worker
   Cache-first strategie voor static assets
   Network-first voor API calls
   ============================================ */

const CACHE_NAME = 'ichtus-spa-v2';

// Static assets to pre-cache on install.
// NOTE: Firebase SDK CDN URLs (https://www.gstatic.com/…) are intentionally
// omitted — cross-origin requests may fail if the CDN doesn't return CORS
// headers. Firebase is loaded via network-first at runtime.
const PRECACHE_URLS = [
  '/Ichtus_SPA/',
  '/Ichtus_SPA/index.html',
  '/Ichtus_SPA/css/style.css',
  '/Ichtus_SPA/css/checklist-modern.css',
  '/shared-assets/css/branding.css?v=2.1.0',
  '/Ichtus_SPA/js/router.js',
  '/Ichtus_SPA/js/state.js',
  '/Ichtus_SPA/js/i18n.js',
  '/Ichtus_SPA/js/app.js',
  '/Ichtus_SPA/js/firebase-init.js',
  '/Ichtus_SPA/js/modules/dashboard.js',
  '/Ichtus_SPA/js/modules/agenda.js',
  '/Ichtus_SPA/js/modules/checklist.js',
  '/Ichtus_SPA/js/modules/setlist.js',
  '/Ichtus_SPA/js/modules/patchbay.js',
  '/Ichtus_SPA/js/modules/analytics.js',
  '/Ichtus_SPA/js/modules/ndi.js',
  '/Ichtus_SPA/js/modules/settings.js',
  '/Ichtus_SPA/js/modules/stagebuilder.js',
  '/shared-assets/js/sidebar.js',
  '/shared-assets/js/sidebar-injector.js',
  '/Ichtus_SPA/manifest.json',
  '/Ichtus_SPA/icons/icon.svg',
  '/Ichtus_SPA/icons/icon-192.png',
  '/Ichtus_SPA/icons/icon-512.png',
  '/Ichtus_SPA/version.json'
];

// API patterns that should always go network-first
const API_PATTERNS = [
  '/api/',
  'firestore.googleapis.com',
  'firebase.googleapis.com'
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
  // Note: We do NOT call self.skipWaiting() here — the page
  // decides when to activate the new SW via the 'skip-waiting' message.
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

  // API calls → network first with cache fallback
  if (API_PATTERNS.some(pattern => event.request.url.includes(pattern))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Navigation requests → network first (so Firebase auth etc works)
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static assets → cache first, falling back to network
  event.respondWith(cacheFirst(event.request));
});

// ——— STRATEGIES ———

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    if (request.mode === 'navigate') {
      return caches.match('/Ichtus_SPA/index.html');
    }
    throw error;
  }
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
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    if (request.mode === 'navigate') {
      return caches.match('/Ichtus_SPA/index.html');
    }
    throw error;
  }
}
