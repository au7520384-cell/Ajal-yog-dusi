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
    """hash -> (raw bytes, page key, owner) of every picture inside index.html, found the way tools/build_web.py finds them. owner = the constant it is declared in (IMG, CUE_ART2, D ...)."""
    import bisect
    decl = [(m.start(), m.group(1) or m.group(2)) for m in re.finditer(r'(?:^|[;\n{}]\s*)(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|Object\.assign\(\s*([A-Za-z_$][\w$]*)\s*,)', src)]
    pos = [d[0] for d in decl]
    pat = re.compile(r'(?:"([^"\n]{1,40})"\s*:\s*|([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?"?(?:data:image/(?:webp|png|jpeg|jpg|gif);base64,)?((?:UklGR|iVBOR|/9j/|R0lGOD)[A-Za-z0-9+/=]{300,})')
    seen = {}
    for m in pat.finditer(src):
        try: raw = base64.b64decode(m.group(3))
        except Exception: continue
        h = hashlib.sha1(raw).hexdigest()[:14]
        if h not in seen:
            i = bisect.bisect_right(pos, m.start()) - 1
            seen[h] = (raw, m.group(1) or m.group(2) or "?", decl[i][1] if i >= 0 else "?")
    return seen

# Pictures that must keep their own pixels: the code (or the CSS) measures them in pixels, so a bigger copy would be drawn too big / cut in the wrong place.
EXCLUDE_OWNERS = {   # constants of the page whose pictures are table art / frames / UI chrome with pixel tables next to them (pocket ring centres, rail caps, 9-slice borders ...)
    "D", "ART_SRC", "PANART_SRC", "PREM_COL_SRC", "ROYAL_COL", "LON_TILE", "CORNER_ART", "POCKET_RING", "MODAL_FRAME", "MODAL_ART", "UI_SPR", "FLOOR_SRC", "LW", "ROOM_SRC", "s", "ctl"}
EXCLUDE_FILE = os.path.join(root, "tools", "hd", "exclude.txt")   # hash  # why   (found by tools/hd_risk_audit.js: shown at its natural size somewhere)

PIXEL_PROPS = {"border-image", "border-image-source", "-webkit-mask-image", "mask-image", "mask", "-webkit-mask", "list-style-image", "list-style", "cursor", "content",
               "borderimage", "borderimagesource", "maskimage", "webkitmaskimage", "liststyleimage"}
BG_PROPS = {"background", "background-image", "backgroundimage"}

def css_risky(src, imgs):
    """hash -> why, for the pictures that CSS uses in a way that depends on their pixels: border-image / mask / cursor / list-style / content, or a background with no background-size.
    Looks at url(<data uri>) inside the page's CSS, at url(${DICT.key}) in the page's templates and at CSS variables set with setProperty("--x", `url(${DICT.key})`) and used as var(--x)."""
    short = re.sub(r"[A-Za-z0-9+/=]{200,}", "<B64>", src)                      # the pictures themselves are not needed here (and make the regexes slow)
    by_key = {(v[2], v[1]): h for h, v in imgs.items()}                          # (owner, key) -> hash
    risky = {}
    def decl_prop(txt, pos):
        pre = txt[max(0, pos - 320): pos]
        m = re.search(r"([a-zA-Z-]+)\s*:\s*[^;{}]*$", pre) or re.search(r"\.([A-Za-z]+)\s*=\s*[`'\"]?[^;]*$", pre)
        return m.group(1).lower() if m else ""
    def judge(txt, pos, h, what):
        prop = decl_prop(txt, pos)
        if prop in PIXEL_PROPS: risky.setdefault(h, f"{prop} ({what})")
        elif prop in BG_PROPS:
            win = txt[max(0, pos - 500): pos + 500]
            if not re.search(r"background-size|backgroundSize|/\s*(?:cover|contain|\d|auto|100%)", win): risky.setdefault(h, f"background without a size ({what})")
    # 1. url(${DICT.key}) / url(${DICT["key"]}) right in a template or a style string
    for m in re.finditer(r"url\(\s*['\"]?\$\{\s*([A-Za-z_]\w*)(?:\.(\w+)|\[\s*['\"]([\w-]+)['\"]\s*\])\s*\}", short):
        h = by_key.get((m.group(1), m.group(2) or m.group(3)))
        if h: judge(short, m.start(), h, f"{m.group(1)}.{m.group(2) or m.group(3)}")
    # 2. CSS variables: setProperty("--x", `url(${DICT.key})`)  ...  var(--x)
    var_hash = {}
    for m in re.finditer(r"setProperty\(\s*['\"](--[\w-]+)['\"]\s*,\s*[`'\"]url\(\s*['\"]?\$\{\s*([A-Za-z_]\w*)(?:\.(\w+)|\[\s*['\"]([\w-]+)['\"]\s*\])\s*\}", short):
        h = by_key.get((m.group(2), m.group(3) or m.group(4)))
        if h: var_hash.setdefault(m.group(1), set()).add(h)
    for v, hs in var_hash.items():
        for m in re.finditer(r"var\(\s*" + re.escape(v) + r"\s*[,)]", short):
            prop = decl_prop(short, m.start())
            for h in hs:
                if prop in PIXEL_PROPS: risky.setdefault(h, f"{prop} via {v}")
                elif prop in BG_PROPS:
                    win = short[max(0, m.start() - 500): m.end() + 500]
                    if not re.search(r"background-size|/\s*(?:cover|contain|\d|auto|100%)", win): risky.setdefault(h, f"background without a size via {v}")
    # 3. url(<data uri>) written straight into the CSS
    for m in re.finditer(r"url\(\s*['\"]?data:image/[a-z]+;base64,<B64>", short):
        pass   # (no picture of the page is written this way: they all come from the dictionaries above)
    return risky

def excluded(src, imgs):
    """hash -> reason for every picture that must not get an HD copy."""
    ex = {h: "owner " + v[2] for h, v in imgs.items() if v[2] in EXCLUDE_OWNERS}
    for h, why in css_risky(src, imgs).items(): ex.setdefault(h, "css: " + why)
    if os.path.exists(EXCLUDE_FILE):
        for ln in open(EXCLUDE_FILE):
            ln = ln.split("#")[0].strip()
            if ln: ex.setdefault(ln.split()[0], "exclude.txt: " + ln.partition(" ")[2].strip())
    return ex

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
    ap.add_argument("--dry", action="store_true"); ap.add_argument("--prune", action="store_true", help="delete the HD copies of excluded pictures"); ap.add_argument("--only"); ap.add_argument("--limit", type=int); ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    src = open(os.path.join(root, "index.html"), encoding="utf-8").read()
    imgs = page_images(src); ex = excluded(src, imgs); todo = []
    for h, (raw, key, owner) in imgs.items():
        if h in ex: continue
        try: im = Image.open(io.BytesIO(raw)); im.load()
        except Exception: continue
        if getattr(im, "is_animated", False) and im.n_frames > 1: continue
        k = plan(key, *im.size)
        if k is None or (a.only and not re.search(a.only, key)): continue
        todo.append((h, key, im, k))
    print(f"{len(ex)} pictures are excluded (pixel-measured by the code or the CSS)")
    os.makedirs(OUT, exist_ok=True)
    if a.prune:
        gone = [f for f in os.listdir(OUT) if f.endswith(".webp") and f[:-5] in ex]
        for f in gone: os.remove(os.path.join(OUT, f))
        print("pruned", len(gone), "HD copies of excluded pictures")
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
