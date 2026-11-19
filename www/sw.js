// Minimal "installable app shell" service worker -- just enough to make the site installable and
// to keep working (on the files that actually live here) when the network drops mid-use. It does
// NOT try to cache Firebase/Gemini calls or the CDN scripts (jsPDF, Firebase SDK) -- those are
// cross-origin, change independently of this app, and the browser's own HTTP cache already handles
// them reasonably. This only owns the handful of files this app actually ships.
//
// CACHE_VERSION must be bumped whenever one of the SHELL_FILES below changes content, same idea as
// APP_VERSION in index.html -- otherwise a returning visitor can get stuck on a stale cached copy
// instead of the update they'd expect (the whole point of bumping APP_VERSION and showing What's New).
const CACHE_VERSION = "v1";
const CACHE_NAME = `micollects-shell-${CACHE_VERSION}`;
const SHELL_FILES = ["/", "/index.html", "/manifest.json", "/favicon.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Network-first for this app's own files, so a new deploy is picked up the moment there's a
// connection, with the cached copy only as an offline fallback -- a cache-first strategy here would
// mean a returning user could get stuck on an old version indefinitely, invisibly.
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("/index.html")))
  );
});
