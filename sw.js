// ══════════════════════════════════════════════════════════════════
// La app de equipos se mudó a https://tecsul-obras.github.io/Cronograma-de-obras/equipos/
// Este service worker reemplaza al viejo para que los celulares que
// tenían la app instalada dejen de abrir la copia guardada: borra la
// caché vieja, se da de baja y recarga las pestañas (que redirigen).
// ══════════════════════════════════════════════════════════════════
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k.startsWith('parte-diario-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach(c => c.navigate(c.url).catch(() => {}));
  })());
});
