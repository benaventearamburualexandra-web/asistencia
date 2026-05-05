const CACHE_NAME = 'asistencia-docente-v8';
const OFFLINE_URL = '/index.html';
const ASSETS_TO_CACHE = [
  OFFLINE_URL,
  '/',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Estrategia tolerante: intenta guardar uno por uno
      return Promise.all(
        ASSETS_TO_CACHE.map(url => {
          return cache.add(url).catch(err => console.warn("Fallo al guardar en caché:", url));
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // No cacheamos las llamadas a la base de datos (API) porque tienen su propia lógica
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    // Intentamos buscar en caché primero
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      // Si no está en caché, intentamos red
      return fetch(event.request)
        .then((response) => {
          // Si es una respuesta válida y no es la API, la guardamos
          if (response.ok && !event.request.url.includes('/api/')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          // Si falla la red (offline) y es una navegación, devolvemos el HTML principal
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          // Para otros recursos (JS/CSS) no devolvemos el HTML para evitar errores de sintaxis
          return undefined;
        });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
        })
      );
    })
  );
  event.waitUntil(self.clients.claim());
});