const CACHE_NAME = 'asistencia-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Instalar y guardar archivos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Estrategia: Intentar red, si falla usar caché
self.addEventListener('fetch', (event) => {
  // No cachear peticiones de API (la asistencia ya tiene su propia lógica en App.tsx)
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// Limpiar caches antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    })
  );
});