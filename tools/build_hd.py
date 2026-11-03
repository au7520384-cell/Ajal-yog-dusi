#!/usr/bin/env python3
"""HD pack: sharper copies of the small pictures (avatars, frames, cues, badges, icons, ball textures ...), made once with a neural upscaler and kept in web/hd/<hash>.webp.
The pictures of the game are drawn for a 1340x720 screen; a phone with a 2400x1080 screen shows them 2-3 times bigger than they are, so small ones look soft.
The HD copy of img/<hash>.<ext> is hd/<hash>.webp (same name, same picture, 2-4 times more pixels). The page downloads them as a second pack (see index.html, "HD"),
the service worker (sw.js) then answers a request for img/<hash>.<ext> with the HD copy. Big pictures (halls, backgrounds, tables) are not touched: they are already 2-3K.

    pip install onnx onnxruntime pillow numpy         (once; the model is downloaded by tools/hd/esrgan.py)
    python3 tools/build_hd.py --dry                  what would be made (counts, pixels)
    python3 tools/build_hd.py                        make the missing ones (resumable: existing files are skipped)
    python3 tools/build_hd.py --only '^(ga|pv)\\d+$'  only the pictures whose page key matches
    SAME_ORIGIN=1 INLINE_UNDER=6000 NO_ZIP=1 python3 tools/build_web.py web     then rebuild the light build (it lists web/hd in assets.json)"""
import os, re, sys, io, json, base64, hashlib, time, argparse
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, "tools", "hd"))
from PIL import Image

OUT = os.path.join(root, "web", "hd")
MAX_PX = 1_100_000          # most output pixels of one picture
Q = 82                      # WebP quality of the HD copies

def page_images(src):
    """(hash, raw bytes, page key) of every picture inside index.html, found the way tools/build_web.py finds them."""
    pat = re.compile(r'(?:"([^"\n]{1,40})"\s*:\s*|([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?"?(?:data:image/(?:webp|png|jpeg|jpg|gif);base64,)?((?:UklGR|iVBOR|/9j/|R0lGOD)[A-Za-z0-9+/=]{300,})')
    seen = {}
    for m in pat.finditer(src):
        try: raw = base64.b64decode(m.group(3))
        except Exception: continue
        h = hashlib.sha1(raw).hexdigest()[:14]
        if h not in seen: seen[h] = (raw, m.group(1) or m.group(2) or "?")
    return seen

def plan(key, w, h):
    """How many times bigger the HD copy is (None: no HD copy)."""
    m = max(w, h)
    if m > 1300 or w * h > 800_000 or min(w, h) < 8: return None   # halls, backgrounds, tables: already 2-3K px
    if max(w / h, h / w) > 30: return None                          # hairlines
    if h > 1500 or (h > 3 * w and h > 600): return None             # tall sprite sheets: the page cuts them by pixel rows
    if re.match(r"^(ga|pv)\d+$", key): k = 4.0                      # the owner's drawn avatars: 100 px -> 400 px
    elif m <= 110: k = 3.0                                          # icons, badges, medals
    else: k = 2.0
    while w * k * h * k > MAX_PX and k > 1.25: k -= 0.25
    return k if k >= 1.5 else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true"); ap.add_argument("--only"); ap.add_argument("--limit", type=int); ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    src = open(os.path.join(root, "index.html"), encoding="utf-8").read()
    imgs = page_images(src); todo = []
    for h, (raw, key) in imgs.items():
        try: im = Image.open(io.BytesIO(raw)); im.load()
        except Exception: continue
        if getattr(im, "is_animated", False) and im.n_frames > 1: continue
        k = plan(key, *im.size)
        if k is None or (a.only and not re.search(a.only, key)): continue
        todo.append((h, key, im, k))
    os.makedirs(OUT, exist_ok=True)
    have = {f[:-5] for f in os.listdir(OUT) if f.endswith(".webp")}
    need = [t for t in todo if a.force or t[0] not in have]
    print(f"{len(imgs)} pictures in the page, {len(todo)} get an HD copy, {len(todo) - len(need)} already made, {len(need)} to make")
    px_in = sum(t[2].width * t[2].height for t in need); px_out = sum(t[2].width * t[2].height * t[3] ** 2 for t in need)
    print(f"to make: {px_in / 1e6:.1f} Mpx in -> {px_out / 1e6:.1f} Mpx out")
    if a.dry: return
    from esrgan import Upscaler, upscale_rgba
    up = Upscaler(); t0 = time.time(); done = 0; bytes_out = 0
    for h, key, im, k in need[: a.limit]:
        W, H = im.size; tw, th = round(W * k), round(H * k)
        try:
            alpha = im.mode in ("RGBA", "LA", "P") and (im.mode != "P" or "transparency" in im.info) and im.convert("RGBA").getchannel("A").getextrema()[0] < 255
            big = upscale_rgba(up, im) if alpha else up.run(im.convert("RGB"))
            if big.size != (tw, th): big = big.resize((tw, th), Image.LANCZOS)
            buf = io.BytesIO(); big.save(buf, "WEBP", quality=Q, method=5, alpha_quality=95)
            tmp = os.path.join(OUT, h + ".tmp"); open(tmp, "wb").write(buf.getvalue()); os.replace(tmp, os.path.join(OUT, h + ".webp")); bytes_out += len(buf.getvalue()); done += 1   # (a stopped run never leaves half a file)
        except Exception as e:
            print("FAILED", h, key, im.size, e)
        if done % 25 == 0:
            el = time.time() - t0; print(f"  {done}/{min(len(need), a.limit or len(need))}  {el:.0f}s  {bytes_out / 1e6:.1f} MB written", flush=True)
    print(f"done: {done} pictures, {bytes_out / 1e6:.1f} MB, {time.time() - t0:.0f}s")

if __name__ == "__main__":
    main()
