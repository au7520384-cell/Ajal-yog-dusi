// Offline copy + the light build's pictures. The pictures and sounds (img/ and a/: their names are hashes, so a file never changes) are kept for good after the first download;
// the page itself comes from the network first (a changed page is picked up at once) and from the copy when there is no network. A huge response (the 40 MB single-file page) is never copied.
const CACHE = "billiard8-v6";   // a new name drops the old copies (v5 held the whole 40 MB page)
const HDC = "billiard8-hd";      // the HD pack (sharper copies of the small pictures), filled by the page (index.html, "first visit"): a request for img/<hash>.<ext> is answered with the HD copy kept under the same address
const FILES = ["./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== HDC).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/hd/") || r.headers.has("range")) return;   // /hd/: only the page's downloader reads these, it keeps them in the HD cache itself
  if (/^\/(img|a)\//.test(url.pathname)) {   // pictures and sounds: the HD copy when there is one, then the copy, the network once
    const base = () => caches.match(r, {cacheName: CACHE}).then(hit => hit || fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; }));
    e.respondWith(/^\/img\//.test(url.pathname) ? caches.match(r, {cacheName: HDC}).then(hd => hd || base()).catch(base) : base());
    return;
  }
  // the page and the small files: network first, the copy when offline
  e.respondWith(fetch(r).then(res => { if (res.ok && !(+res.headers.get("content-length") > 12e6)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
    .catch(() => caches.match(r).then(hit => hit || caches.match("./index.html"))));
});
