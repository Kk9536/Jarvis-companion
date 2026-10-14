// Offline app shell. Same-origin GET only; nothing is fetched from anywhere else.
const CACHE = 'jarvis-companion-web-0.1.1';
const SHELL = ['./', 'index.html', 'app.js', 'task.js', 'wav.js', 'capture-worklet.js', 'manifest.webmanifest',
               'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.match(event.request, {ignoreSearch: true}).then(hit => hit || fetch(event.request)));
});
