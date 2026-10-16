// Offline app shell. Same-origin GET only; nothing is fetched from anywhere else.
// Network first (fresh files whenever online), cache only as the offline fallback.
const CACHE = 'jarvis-companion-web-0.1.7';
const SHELL = ['./', 'index.html', 'app.js', 'task.js', 'wav.js', 'capture-worklet.js', 'manifest.webmanifest',
               'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(fetch(event.request, {cache: 'no-cache'}).then(reply => {
    if (reply.ok && SHELL.some(u => url.pathname.endsWith(u === './' ? '/' : '/' + u))) {
      const copy = reply.clone();
      caches.open(CACHE).then(c => c.put(event.request, copy));
    }
    return reply;
  }).catch(() => caches.match(event.request, {ignoreSearch: true})));
});
