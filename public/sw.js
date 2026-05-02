const CACHE_NAME = 'asistencia-docente-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // No interferir con las llamadas a la API (asistencias)
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Si está en caché, lo devolvemos inmediatamente (Carga ultra rápida)
      if (response) return response;

      // Si no está, lo buscamos en internet y lo guardamos para la próxima vez
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) return networkResponse;
        
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      }).catch(() => {
        // Si falla la red y no hay caché (ej: primera vez sin internet), devolvemos el index.html
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => key !== CACHE_NAME && caches.delete(key)));
    })
  );
});