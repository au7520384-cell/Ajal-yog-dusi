// Offline copy + the light build's pictures. The pictures and sounds (img/ and a/: their names are hashes, so a file never changes) are kept for good after the first download;
// the page itself comes from the network first (a changed page is picked up at once) and from the copy when there is no network. A huge response (the 40 MB single-file page) is never copied.
const CACHE = "billiard8-v6";   // a new name drops the old copies (v5 held the whole 40 MB page)
const FILES = ["./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || r.headers.has("range")) return;
  if (/^\/(img|a)\//.test(url.pathname)) {   // pictures and sounds: the copy first, the network once
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })));
    return;
  }
  // the page and the small files: network first, the copy when offline
  e.respondWith(fetch(r).then(res => { if (res.ok && !(+res.headers.get("content-length") > 12e6)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
    .catch(() => caches.match(r).then(hit => hit || caches.match("./index.html"))));
});
