'use strict';

/* Service worker: guarda el juego en el móvil para poder jugar sin conexión.
   Primero la red y, sin conexión, la copia guardada. */

const CACHE = 'noche-de-estacas-v4';
const CORE = ['./', 'index.html', 'style.css', 'juego.css', 'kit.js', 'sala.js', 'sala.css', 'mesa.js', 'script.js', 'favicon.svg', 'manifest.json', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const cacheable = url.origin === self.location.origin ||
    url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;

  // Archivos del juego: primero la red, para que nadie se quede con una versión
  // antigua (en una sala todos tienen que llevar la misma); sin conexión, la copia
  // guardada. Las fuentes: primero la copia guardada.
  const sameOrigin = url.origin === self.location.origin;
  event.respondWith(
    caches.open(CACHE).then((cache) => {
      // no-cache: pregunta al servidor si hay versión nueva (sin esperar a que caduque la caché del navegador)
      const fromNetwork = () => fetch(sameOrigin ? new Request(request.url, { cache: 'no-cache' }) : request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
        return response;
      });
      if (!sameOrigin) return cache.match(request).then((cached) => cached || fromNetwork());
      return fromNetwork().catch(() => cache.match(request, { ignoreSearch: true }));
    })
  );
});
