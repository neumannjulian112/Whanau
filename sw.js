/* Whānau Service Worker – App-Shell offline verfügbar */
const CACHE = "whanau-v4";
const SHELL = ["./", "./index.html", "./app.js", "./firebase-config.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Netzwerk zuerst, Cache als Fallback (damit Updates ankommen)
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && e.request.url.startsWith(self.location.origin)) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
self.addEventListener("message", e => { if (e.data && e.data.typ === "SKIP_WAITING") self.skipWaiting(); });
