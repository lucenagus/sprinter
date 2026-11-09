// Offline support. Network first, so a new version shows up as soon as the
// phone is online; the cache answers when it isn't.
const CACHE = 'sprinter-v58';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './store.js', './emoji.js', './emoji-data.js', './icons.js', './logo.svg',
  './vendor/preact-htm.js', './manifest.webmanifest',
  './fonts/InstrumentSans.ttf', './fonts/SometypeMono.ttf',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
