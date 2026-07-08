const CACHE = 'ai-browser-v6';
const STATIC = ['/', '/index.html', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (STATIC.includes(url.pathname) || /^\/src\//.test(url.pathname)) {
    e.respondWith(cacheFirst(e.request));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const net = await fetch(req);
  if (net.ok) {
    const cache = await caches.open(CACHE);
    cache.put(req, net.clone());
  }
  return net;
}
