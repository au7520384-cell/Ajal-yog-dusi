#!/usr/bin/env python3
"""Puts a full-screen hall picture ("plate") behind the pool table: tools/add_room_plate.py <picture> <name> [--erase x0,y0,x1,y1 ...] [--width 1600] [--quality 80] [--preview out.png]

The picture is the scenery of the match screen (walls, floor, rug, vases ...), drawn by an artist or an AI. The game draws the table, the bars and the buttons itself, so the plate must not contain them:
--erase paints a rectangle (in the picture's own pixels) over from its surroundings (a smooth push-pull fill plus a little grain), for the table / player panels / buttons that were baked into a sample.
--for says which tables (ids of TBL: city ids, e_..., x_..., l_...) stand in this hall (ROOM_FOR in index.html); --marble makes the erased parts dark and cloudy like the floor around.
The result is stored as a bare base64 WebP in ROOM_SRC of index.html (the portal builds turn it into a file, like the table art). Run it with /usr/bin/python3 (needs Pillow + numpy)."""
import argparse, base64, io, os, re, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fill(img, known):
    """push-pull inpainting: the unknown pixels get the (smoothed) colours of the known ones around them"""
    h, w = known.shape
    if known.all():
        return img
    if min(h, w) <= 4 or not known.any():
        out = img.copy()
        out[~known] = img[known].mean(axis=0) if known.any() else 0
        return out
    ph, pw = h + (h & 1), w + (w & 1)
    I = np.zeros((ph, pw, 3), np.float32); K = np.zeros((ph, pw), np.float32)
    I[:h, :w] = img * known[..., None]; K[:h, :w] = known
    if ph > h: I[h] = I[h - 1]; K[h] = K[h - 1]
    if pw > w: I[:, w] = I[:, w - 1]; K[:, w] = K[:, w - 1]
    s = I.reshape(ph // 2, 2, pw // 2, 2, 3).sum(axis=(1, 3)); c = K.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    small = np.where(c[..., None] > 0, s / np.maximum(c, 1)[..., None], 0).astype(np.float32)
    small = fill(small, c > 0)
    up = np.repeat(np.repeat(small, 2, axis=0), 2, axis=1)[:h, :w]
    out = np.where(known[..., None], img, up)
    unk = ~known
    for _ in range(24):   # smooth the block edges, only inside the unknown part
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode="edge")
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        out = np.where(unk[..., None], avg, out)
    return out


def noise(h, w, rng, cell):
    """smooth value noise (bilinear) with the given cell size in pixels"""
    gh, gw = h // cell + 3, w // cell + 3
    g = rng.random((gh, gw)).astype(np.float32)
    ys, xs = (np.arange(h) / cell).astype(np.float32), (np.arange(w) / cell).astype(np.float32)
    y0, x0 = ys.astype(int), xs.astype(int); fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def marble(h, w, rng):
    """soft dark clouds (a stone-like floor), as a (h, w, 3) offset to add to the base colour; no hard veins: they look like contour lines"""
    n = sum(noise(h, w, rng, c) * a for c, a in ((300, 1.0), (150, 0.6), (70, 0.35), (30, 0.2))) / 2.15
    cloud = (n - n.mean()) * 46.0
    return cloud[..., None] * np.array([0.8, 0.85, 1.1], np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("picture"); ap.add_argument("name")
    ap.add_argument("--erase", action="append", default=[], help="x0,y0,x1,y1 in the picture's pixels (repeatable)")
    ap.add_argument("--width", type=int, default=1600); ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--grain", type=float, default=2.2); ap.add_argument("--preview")
    ap.add_argument("--no-embed", action="store_true"); ap.add_argument("--for", dest="tables", default=""); ap.add_argument("--marble", action="store_true", help="paint the erased parts as dark marble instead of a plain fill"); ap.add_argument("--tint", default="0.74,0.76,0.92", help="multiplies the colour of the erased parts (r,g,b), to match the floor around")
    a = ap.parse_args()
    im = Image.open(a.picture).convert("RGB"); arr = np.asarray(im, np.float32)
    h, w = arr.shape[:2]
    if a.erase:
        known = np.ones((h, w), bool)
        for r in a.erase:
            x0, y0, x1, y1 = [int(v) for v in r.split(",")]; known[max(0, y0):y1, max(0, x0):x1] = False
        out = fill(arr, known)
        rng = np.random.default_rng(7)
        unk = (~known).astype(np.float32)
        feather = np.asarray(Image.fromarray((unk * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(22)), np.float32) / 255.0   # 1 deep inside the erased part, 0 outside, soft at the border
        inner = np.asarray(Image.fromarray((unk * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(41)).filter(ImageFilter.GaussianBlur(14)), np.float32) / 255.0
        if a.marble:
            tint = np.array([float(v) for v in a.tint.split(',')], np.float32)
            out = out * (1 - inner[..., None] * (1 - tint)) + inner[..., None] * marble(h, w, rng)   # darker, bluer, a little cloudy; fading out towards the border so no edge shows
        grain = rng.normal(0, a.grain, (h, w, 1)).astype(np.float32)   # a little grain, so the fill does not look like plastic
        out = np.where(known[..., None], arr, np.clip(out + grain, 0, 255))
        im = Image.fromarray(out.astype(np.uint8))
    if im.width > a.width:
        im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
    if a.preview: im.save(a.preview)
    b = io.BytesIO(); im.save(b, "WEBP", quality=a.quality, method=6); raw = b.getvalue()
    print(f"{a.name}: {im.width}x{im.height}, webp {len(raw) / 1024:.0f} KB")
    if a.no_embed: return
    p = os.path.join(ROOT, "index.html"); s = open(p, encoding="utf-8").read()
    b64 = base64.b64encode(raw).decode()
    m = re.search(r"^const ROOM_SRC = \{(.*)\};[^\n]*$", s, re.M)
    if not m: sys.exit("ROOM_SRC not found in index.html")
    items = dict(re.findall(r'"([a-z0-9_]+)": "([A-Za-z0-9+/=]+)"', m.group(1))); items[a.name] = b64
    line = "const ROOM_SRC = {" + ", ".join(f'"{k}": "{v}"' for k, v in items.items()) + "};   // hall pictures (tools/add_room_plate.py): scenery behind the table, see roomPlate()"
    s = s[:m.start()] + line + s[m.end():]
    if a.tables:   # which tables stand in this hall
        mf = re.search(r"^const ROOM_FOR = \{(.*)\};[^\n]*$", s, re.M)
        if not mf: sys.exit("ROOM_FOR not found in index.html")
        mapping = {k: re.findall(r'"([^"]+)"', v) for k, v in re.findall(r"(\w+): \[([^\]]*)\]", mf.group(1))}
        mapping[a.name] = [t.strip() for t in a.tables.split(",") if t.strip()]
        lf = "const ROOM_FOR = {" + ", ".join(f"{k}: [" + ", ".join(f'"{t}"' for t in v) + "]" for k, v in mapping.items()) + "};   // which tables stand in a hall of a picture (the others get the drawn hall, see paintRoom)"
        s = s[:mf.start()] + lf + s[mf.end():]
    open(p, "w", encoding="utf-8").write(s)
    print("ROOM_SRC now holds:", ", ".join(items))


main()
