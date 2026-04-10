// ============================================================
// StudyCards - Service Worker v1.1
// ============================================================

const CACHE_NAME = 'studycards-v1.1';

// App-Shell: Dateien die sofort gecached werden (relativ zum SW-Scope)
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// CDN-Ressourcen: werden beim ersten Laden gecached
const CDN_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js',
];

// ===== INSTALL: App-Shell cachen =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
});

// ===== ACTIVATE: Alte Caches löschen =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => {
      // Sofort alle Tabs übernehmen
      return self.clients.claim();
    })
  );
});

// ===== FETCH: Strategie pro Ressource =====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // GitHub API & raw.githubusercontent.com → immer Netzwerk (Karten sollen frisch sein)
  if (url.hostname === 'api.github.com' || url.hostname === 'raw.githubusercontent.com') {
    return; // Browser-Default: kein Cache
  }

  // Google Fonts → Cache-First (ändert sich nie)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // CDN (KaTeX) → Cache-First (versioniert, ändert sich nicht)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // App-Dateien → Network-First (immer neueste Version holen, Fallback auf Cache)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// ===== MESSAGE: Skip Waiting (vom App-Code getriggert) =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
