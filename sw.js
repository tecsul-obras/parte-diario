// ══════════════════════════════════════════════════════════════════
// Service Worker — Parte Diario Maquinaria Tecsul (v5)
//
// Permite que la app abra y funcione sin señal en obra.
//
// IMPORTANTE: subí CACHE_VERSION cada vez que cambies el HTML o el JS,
// si no los celulares siguen usando la copia vieja.
// ══════════════════════════════════════════════════════════════════
const CACHE_VERSION = 'parte-diario-v5-7';

const APP_SHELL = [
  './',
  './index.html',
  './parte_diario_v5.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // La librería de Supabase se guarda también: si no, sin señal la app
  // ni siquiera arranca.
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => Promise.allSettled(APP_SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Nada de lo que va a Supabase se guarda en caché: son datos vivos, y
  // además el token de sesión no debe quedar en el disco del teléfono.
  if (url.includes('.supabase.co')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    // Primero la red, con un límite de 8 segundos: en obra la señal a
    // veces "está" pero no responde, y sin este corte la app queda
    // colgada en blanco en vez de abrir con la copia guardada.
    Promise.race([
      fetch(e.request).then(r => {
        const copia = r.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, copia)).catch(() => {});
        return r;
      }),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lento')), 8000))
    ]).catch(() =>
      caches.match(e.request).then(guardado => {
        if (guardado) return guardado;
        if (e.request.mode === 'navigate') return caches.match('./parte_diario_v5.html');
        return new Response('', { status: 504 });
      })
    )
  );
});
