const CACHE_NAME = 'trw-field-shell-v1.6.6-client-excel';
// Match the versioned URLs in index.html so the first completed install works offline.
const SHELL = [
  './',
  './index.html',
  './styles.css?v=1.6.6',
  './app.js?v=1.6.6',
  './client-report.js?v=1.6.6',
  './config.js?v=1.6.6',
  './manifest.webmanifest?v=1.6.6',
  './vendor/leaflet.css?v=1.6.6',
  './vendor/leaflet.js?v=1.6.6',
  './icons/icon-192.png?v=1.6.6',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-96.png',
  './icons/trw-logo.png',
  './icons/trw-icon.svg?v=1.6.6'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('trw-field-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response && response.status === 200) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((response) => response || caches.match('./index.html'))));
});
