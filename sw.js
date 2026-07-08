// ══════════════════════════════════════════════════════════════════
// Service Worker - Parte Diario Maquinaria Tecsul
// Permite que la app abra y funcione sin conexión.
// ══════════════════════════════════════════════════════════════════

// IMPORTANTE: subí la versión cada vez que cambies el HTML para forzar
// la actualización del caché en los dispositivos.
const CACHE_VERSION = 'parte-diario-v4-3';
const CACHE_NAME = CACHE_VERSION;

// Archivos que forman el "casco" de la app (se guardan para uso offline)
const APP_SHELL = [
  './',
  './index.html',
  './parte_diario_pwa_v4.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Instalación: guardar el casco de la app en caché
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falla si algún archivo no existe; usamos add individual tolerante
      return Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// Activación: borrar cachés viejos de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estrategia de fetch:
//  - Peticiones a Google (Apps Script, Drive): SIEMPRE a la red (no cachear datos).
//  - Archivos de la app: "network first" con fallback a caché (para que
//    tomen la última versión con conexión, y funcionen sin ella).
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // No interceptar peticiones a Google (datos dinámicos, JSONP, imágenes Drive)
  if (url.includes('script.google.com') ||
      url.includes('googleusercontent.com') ||
      url.includes('drive.google.com') ||
      url.includes('google.com/macros')) {
    return; // dejar que vaya directo a la red
  }

  // Solo manejar GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Guardar copia fresca en caché
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Sin red: servir desde caché
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Si piden una página y no está, devolver el HTML principal
          if (event.request.mode === 'navigate') {
            return caches.match('./parte_diario_pwa_v4.html');
          }
          return new Response('', { status: 404 });
        });
      })
  );
});
