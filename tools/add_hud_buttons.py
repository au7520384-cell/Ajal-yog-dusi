#!/usr/bin/env python3
"""The in-game buttons from the owner's mockup (tools/art/hud_buttons_mockup.png), cut out as sprites: python3 tools/add_hud_buttons.py [mockup.png]

The mockup shows the cue key (two cues on a blue key), the cue ball (gold ring, black ring, ivory ball with a red dot), the chat key, the menu key (green) and the dark glass key (full screen), all with gold rims,
on a gold-lattice background. Each is cut out with a rounded-rectangle / ellipse mask measured from its gold rim (SPEC below), the ball's red dot is painted out (the game draws the dot where the cue hits the ball),
the dark key's rectangle is painted out for a BLANK key (the zoom + / - buttons and the microphone / speaker buttons use it). The sprites (300 px, WebP with alpha) go into index.html as
Object.assign(IMG, {hud_cue, hud_ball, hud_chat, hud_menu, hud_fs, hud_blank}) between the markers /*HUD_ART*/ ... /*HUD_ART_END*/ (a second run replaces them). Needs Pillow + numpy (/usr/bin/python3)."""
import base64, io, os, re, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "art", "hud_buttons_mockup.png")
im = Image.open(SRC).convert("RGB")
SPEC = {   # kind, left, top, right, bottom (of the gold rim's outer edge, in the mockup's pixels), corner radius
    "cue": ("rr", 168, 65, 586, 450, 88), "ball": ("ell", 728, 10, 1206, 488, 0), "chat": ("rr", 308, 630, 671, 921, 78),
    "menu": ("rr", 747, 634, 1098, 924, 78), "fs": ("rr", 1293, 647, 1643, 924, 80)}


def cut(name, inset=1.2, ss=4):
    kind, l, t, r, b, rad = SPEC[name]; pad = 6
    crop = im.crop((l - pad, t - pad, r + pad, b + pad)); w, h = crop.size
    m = Image.new("L", (w * ss, h * ss), 0); d = ImageDraw.Draw(m)
    box = [v * ss for v in (pad + inset, pad + inset, w - pad - inset, h - pad - inset)]
    if kind == "rr": d.rounded_rectangle(box, radius=(rad - inset) * ss, fill=255)
    else: d.ellipse(box, fill=255)
    out = crop.convert("RGBA"); out.putalpha(m.resize((w, h), Image.LANCZOS))
    return out


def dilate(mask, n):
    m = mask.copy()
    for _ in range(n):
        p = np.pad(m, 1); m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[2:, 2:] | p[:-2, 2:] | p[2:, :-2]
    return m


def remove_dot(spr):
    a = np.asarray(spr).astype(np.float32); rgb = a[..., :3]; h, w = rgb.shape[:2]
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    red = (R > 150) & (G < 110) & (B < 110) & (R - G > 80)
    ys, xs = np.nonzero(red); cy, cx = ys.mean(), xs.mean(); rad = np.sqrt(red.sum() / np.pi)
    yy, xx = np.mgrid[0:h, 0:w]; d = np.hypot(xx - cx, yy - cy)
    hole = d < rad + 9
    ring = (d > rad + 14) & (d < rad + 70) & (a[..., 3] > 250) & ~((R > 150) & (G < 120) & (B < 120))
    X = np.stack([np.ones(ring.sum()), xx[ring], yy[ring], xx[ring] ** 2, yy[ring] ** 2, xx[ring] * yy[ring]], 1)
    Xh = np.stack([np.ones(hole.sum()), xx[hole], yy[hole], xx[hole] ** 2, yy[hole] ** 2, xx[hole] * yy[hole]], 1)
    out = rgb.copy()
    for c in range(3):
        coef, *_ = np.linalg.lstsq(X, rgb[..., c][ring], rcond=None); out[..., c][hole] = Xh @ coef   # the ivory's shading, fitted round the dot
    soft = np.clip((rad + 12 - d) / 4, 0, 1)[..., None] * hole[..., None]
    out = rgb * (1 - soft) + out * soft
    return Image.fromarray(np.dstack([np.clip(out, 0, 255), a[..., 3]]).astype(np.uint8), "RGBA")


def remove_icon(spr, win):
    a = np.asarray(spr).astype(np.float32); rgb = a[..., :3]; h, w = rgb.shape[:2]; x0, y0, x1, y1 = win
    m = np.zeros((h, w), bool); m[y0:y1, x0:x1] = (rgb.min(axis=2) > 150)[y0:y1, x0:x1]; m = dilate(m, 7)
    out = rgb.copy()
    for y in range(h):
        xs = np.nonzero(m[y])[0]
        if not len(xs): continue
        runs, s, p = [], xs[0], xs[0]
        for x in xs[1:]:
            if x != p + 1: runs.append((s, p)); s = x
            p = x
        runs.append((s, p))
        for s, e in runs:
            l, r = max(s - 3, 0), min(e + 3, w - 1)
            for c in range(3): out[y, s:e + 1, c] = np.linspace(rgb[y, l, c], rgb[y, r, c], e - s + 1)
    for _ in range(6):
        p = np.pad(out, ((1, 1), (0, 0), (0, 0)), mode="edge"); out = np.where(m[..., None], (p[:-2] + p[2:] + 2 * out) / 4, out)
    return Image.fromarray(np.dstack([out, a[..., 3]]).astype(np.uint8), "RGBA")


def small(img, mx=300):
    img = img.copy(); img.thumbnail((mx, mx), Image.LANCZOS); return img


S = {"cue": cut("cue"), "chat": cut("chat"), "menu": cut("menu"), "fs": cut("fs"), "ball": remove_dot(cut("ball"))}
w, h = S["fs"].size; S["blank"] = remove_icon(S["fs"], (int(w * .18), int(h * .22), int(w * .82), int(h * .8)))
ent = []
for k in ("cue", "ball", "chat", "menu", "fs", "blank"):
    b = io.BytesIO(); small(S[k]).save(b, "WEBP", quality=92, method=6)
    ent.append('"hud_%s": "data:image/webp;base64,%s"' % (k, base64.b64encode(b.getvalue()).decode())); print(k, small(S[k]).size, len(b.getvalue()))
block = "/*HUD_ART*/Object.assign(IMG, {%s});/*HUD_ART_END*/" % ", ".join(ent)
p = os.path.join(ROOT, "index.html"); s = open(p, encoding="utf-8").read()
if "/*HUD_ART*/" in s: s = re.sub(r"/\*HUD_ART\*/.*?/\*HUD_ART_END\*/", lambda m: block, s, flags=re.S)
else:
    i = s.index("\nconst IMG = {"); j = s.index("\n", i + 1)   # right after the line that defines IMG
    s = s[:j + 1] + block + "\n" + s[j + 1:]
open(p, "w", encoding="utf-8").write(s); print("index.html updated")
