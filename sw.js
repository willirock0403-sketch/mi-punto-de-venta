// Service worker: solo cachea el "cascarón" de la app (HTML/manifest/íconos)
// para que abra rápido e instale como app. Nunca cachea datos de Supabase:
// todo lo que es venta/producto/precio siempre va a la red.
const CACHE = 'ventafacil-shell-v2';
// La librería de Supabase entra al cascarón: antes venía de un CDN, y como
// el service worker no toca lo que no es de este dominio, sin internet la
// app dependía de que el navegador la tuviera en su propio caché. Ahora es
// un archivo más del sitio y se guarda con los demás.
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './vendor/supabase-js-2.117.2.js',
               './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // deja pasar Supabase, CDNs, etc.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('./index.html')))
  );
});
