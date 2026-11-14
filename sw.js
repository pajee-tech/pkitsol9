/* PK IT Solutions service worker
   - Pages: network first, so visitors always get the latest content; the last copy
     (or /offline.html) is shown only when the network is down.
   - CSS, JS, images: stale-while-revalidate for instant repeat visits.
   - Never touches form posts, analytics or other sites.
   VERSION is replaced at build time so every deploy starts with a fresh cache. */
var VERSION = "__BUILD_VERSION__";
var CACHE = "pkit-" + VERSION;
var CORE = ["/", "/offline.html", "/css/style.css", "/js/config.js", "/js/main.js", "/assets/img/logo.png", "/assets/img/favicon.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("pkit-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match("/offline.html"); });
    }));
    return;
  }

  if (/\.(css|js|png|jpe?g|webp|avif|svg|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var network = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || network;
      });
    }));
  }
});
