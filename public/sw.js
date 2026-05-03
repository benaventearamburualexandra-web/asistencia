const CACHE_NAME = 'asistencia-docente-v3';
const OFFLINE_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Guardamos la página principal, el manifest y los iconos inmediatamente al instalar
      return cache.addAll([OFFLINE_URL, '/', '/manifest.json', '/icon-192x192.png', '/icon-512x512.png']);
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
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((response) => {
          // Guardamos en caché lo que vamos descargando (estilos, logos, etc)
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          // Si no hay internet y no está en caché, devolvemos la página principal
          return caches.match(OFFLINE_URL);
        });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});