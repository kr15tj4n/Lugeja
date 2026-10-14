/**
 * Lugeja - Service Worker
 * Tagab PWA funktsionaalsuse, välkkiire laadimise ja võrguühenduseta (offline) toe.
 */

const CACHE_NAME = 'lugeja-shell-v15';
const DATA_CACHE_NAME = 'lugeja-data';

const PRECACHE_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/favicon.svg',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/icon-maskable-192.png',
  '/static/icons/icon-maskable-512.png',
  '/static/icons/apple-touch-icon.png'
];

// Paigaldamine: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Aktiveerimine: vanade vahemälude puhastamine
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== DATA_CACHE_NAME) {
            console.log('[ServiceWorker] Kustutan vana vahemälu:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Päringute vahendamine (Fetch)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ainult GET päringuid saab vahemälust teenindada
  if (req.method !== 'GET') {
    return;
  }

  // 1. API GET päringud (/api/sources, /api/categories, /api/articles):
  // Network First, aga võrguühenduse puudumisel tagasta eelmine vahemälu versioon
  if (url.pathname.startsWith('/api/')) {
    // Ära vahemälusta refresh staatuse ega autentimise päringuid
    if (url.pathname.includes('/refresh') || url.pathname.startsWith('/api/auth/')) {
      return;
    }

    event.respondWith(
      fetch(new Request(req, { cache: 'no-store' }))
        .then((response) => {
          // Kui vastus on edukas, salvesta koopia andmete vahemällu
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(DATA_CACHE_NAME).then((cache) => {
              cache.put(req, copy);
            });
          }
          return response;
        })
        .catch(() => {
          // Võrguviga või offline: püüa leida viimane salvestatud vastus
          return caches.match(req).then((cached) => {
            if (cached) {
              return cached;
            }
            // Kui vahemälus pole, tagasta tühi struktuur vastavalt otspunktile
            if (url.pathname.includes('/articles')) {
              return new Response(JSON.stringify({ articles: [] }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (url.pathname.includes('/sources')) {
              return new Response(JSON.stringify({ sources: [] }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (url.pathname.includes('/categories')) {
              return new Response(JSON.stringify({ categories: [] }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(JSON.stringify({ error: 'Offline' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // 2. Navigatsioonipäringud (HTML lehe laadimine):
  // Network First, offline puhul tagasta vahemälust '/'
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match('/');
      })
    );
    return;
  }

  // 3. Staatilised failid (/static/... jms):
  // Stale-While-Revalidate strateegia (kohe vahemälust, taustal uuendus)
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Võrguviga staatilise ressursi puhul
          return cached;
        });

      return cached || fetchPromise;
    })
  );
});
