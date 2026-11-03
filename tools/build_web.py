#!/usr/bin/env python3
"""Light static build of the game for free static hosting (Cloudflare Pages / GitHub Pages / Netlify):
index.html with every embedded picture moved to img/<hash>.<ext> (the page drops from ~35 MB to a few MB, pictures load only when the game shows them),
the game server stays on Render (CONFIG.server) and only answers API / WebSocket calls.
Usage: python3 tools/build_web.py [out_dir]   (default: ./web_site)   Optional: SQUEEZE=1 (smaller pictures, as in build_crazy.py)
The game server of this repo serves the build in ./web itself (server/server.js, same origin, pictures cached for a year, a stale build is ignored):
   SAME_ORIGIN=1 INLINE_UNDER=6000 NO_ZIP=1 python3 tools/build_web.py web      <- run it after every change of index.html, then commit web/
SAME_ORIGIN=1 keeps the API on the same host (the default build points it at CONFIG.server, for Cloudflare Pages); INLINE_UNDER=N leaves pictures smaller than N bytes inside index.html
(fewer files); NO_ZIP=1 skips the zip. The file .src holds the hash of the index.html the build was made from (the server compares it)."""
import os, re, sys, hashlib, base64, shutil, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "web_site"))
src = open(os.path.join(root, "index.html"), encoding="utf-8").read()
def sub(old, new):
    global src
    assert src.count(old) == 1, ("patch target not found exactly once", old[:80], src.count(old))
    src = src.replace(old, new)
# the page lives on another host than the API: the API / WebSocket base is always CONFIG.server
if not os.environ.get("SAME_ORIGIN"): sub('const sameOrigin = location.protocol.startsWith("http") && !ON_PORTAL;', 'const sameOrigin = false;   // static build: the game server is CONFIG.server')
SRC_HASH = hashlib.sha1(open(os.path.join(root, "index.html"), "rb").read()).hexdigest()
INLINE_UNDER = int(os.environ.get("INLINE_UNDER", "0"))
IMGS = {}
EXT = {"webp": "webp", "png": "png", "jpeg": "jpg", "jpg": "jpg", "gif": "gif"}
def _file(m):
    mt, raw = m.group(1), base64.b64decode(m.group(2))
    if len(raw) < INLINE_UNDER: return m.group(0)
    name = "img/" + hashlib.sha1(raw).hexdigest()[:14] + "." + EXT[mt]
    IMGS[name] = raw
    return name
src = re.sub(r"data:image/(webp|png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)", _file, src)
# the table-rail / cue-art tables hold bare base64 WebP strings ("UklGR..."): files as well (the page turns a path or base64 into a source with W64())
def _bare(m):
    raw = base64.b64decode(m.group(1))
    if len(raw) < INLINE_UNDER: return m.group(0)
    name = "img/" + hashlib.sha1(raw).hexdigest()[:14] + ".webp"
    IMGS[name] = raw
    return '"' + name + '"'
src = re.sub(r'"(UklGR[A-Za-z0-9+/=]{300,})"', _bare, src)
# sounds and the little video: files too (decoded / played only when needed; fetch() and <video> take a path as well as a data: address)
AUD = {}
def _media(m):
    raw = base64.b64decode(m.group(2)); name = "a/" + hashlib.sha1(raw).hexdigest()[:14] + "." + ("wav" if m.group(1) == "audio/wav" else "mp4")
    AUD[name] = raw
    return name
src = re.sub(r"data:(audio/wav|video/mp4);base64,([A-Za-z0-9+/=]+)", _media, src)
if os.path.isdir(out): shutil.rmtree(out)
os.makedirs(os.path.join(out, "img")); os.makedirs(os.path.join(out, "a"))
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(src)
open(os.path.join(out, ".src"), "w").write(SRC_HASH)
for n, raw in list(IMGS.items()) + list(AUD.items()): open(os.path.join(out, n), "wb").write(raw)
for f in ["sw.js", "manifest.webmanifest", "icon.svg", "favicon-48.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"]:
    shutil.copy(os.path.join(root, f), os.path.join(out, f))
# Cloudflare Pages / Netlify header rules: the hashed pictures never change
open(os.path.join(out, "_headers"), "w").write("/img/*\n  Cache-Control: public, max-age=31536000, immutable\n/a/*\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n")
# the list of every picture / sound with its size: the page downloads them with a progress bar on the first visit (and only the new ones after an update)
import json
files = sorted((n, len(raw)) for n, raw in list(IMGS.items()) + list(AUD.items()))
open(os.path.join(out, "assets.json"), "w").write(json.dumps({"v": hashlib.sha1("".join(n for n, _ in files).encode()).hexdigest()[:12], "files": files}, separators=(",", ":")))
size = os.path.getsize(os.path.join(out, "index.html"))
assert size < 25 * 1024 * 1024, "index.html is over the 25 MiB per-file limit of Cloudflare Pages"
z = out.rstrip("/") + ".zip"
if not os.environ.get("NO_ZIP"):
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for dp, dn, fn in os.walk(out):
            for f in fn:
                p = os.path.join(dp, f); zf.write(p, os.path.relpath(p, out))
print(len(IMGS), "pictures,", sum(map(len, IMGS.values())), "bytes,", len(AUD), "sounds / videos,", sum(map(len, AUD.values())), "bytes; index.html", size, "bytes ->", out, *(["and", z, os.path.getsize(z)] if os.path.exists(z) and not os.environ.get("NO_ZIP") else []))
