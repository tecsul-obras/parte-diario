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

  event.respondWith(responderConTimeout(event.request));
});

// Tiempo máximo que esperamos a la red antes de servir el caché.
// Con señal mala, el fetch del HTML (145 KB) puede colgarse 30 s o más: para el
// operador la app "no abre" aunque el archivo esté cacheado. Con 3 s cortamos.
const NET_TIMEOUT_MS = 3000;

async function responderConTimeout(request) {
  const cachePromise = caches.match(request);

  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout de red')), NET_TIMEOUT_MS))
    ]);

    // Sólo cacheamos respuestas buenas. Antes se guardaba cualquier cosa,
    // así que una página de error de GitHub Pages podía quedar cacheada
    // y servirse después sin conexión como si fuera la app.
    if (response && response.ok && response.status === 200 &&
        (response.type === 'basic' || response.type === 'cors')) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
    }
    return response;

  } catch (err) {
    // Red lenta, caída, o respuesta que tardó demasiado: vamos al caché.
    const cached = await cachePromise;
    if (cached) return cached;

    // Si piden una página y no está, devolver el HTML principal
    if (request.mode === 'navigate') {
      const shell = await caches.match('./parte_diario_pwa_v4.html');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Sin conexión y sin caché' });
  }
}
