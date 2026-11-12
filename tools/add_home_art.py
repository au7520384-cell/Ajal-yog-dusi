#!/usr/bin/env python3
"""The home screen's art from the owner's mockup (tools/art/home_mockup.png): python3 tools/add_home_art.py [mockup.png] [--sheet out.png] [--no-esrgan] [--part top|cards|all]

The mockup shows the finished top bar (profile card with a laurel wreath and a crown, five framed icons, one dark money plate with a diamond / cash / coins and green plus keys, the full screen and
the settings keys), the five mode cards and the LIMITED EDITION tile. Every piece is cut out of the owner's own picture, never redrawn:
  - a rounded-rectangle mask measured from each gold rim (SPEC below), soft edge from the picture's brightness, so the glow of the rim stays and the dark halo goes
  - the avatar frame has a hole where the mockup's portrait was (the game puts the player's own avatar behind it)
  - what the game writes itself (the name, the level number in the star, the XP bar and its numbers, the money numbers, the card titles ...) is painted out of the pieces (push-pull fill from the surroundings)
  - a blank frame (for the "Mini" button) and blank plates are made the same way
Then every sprite goes through the same neural upscaler as the HD pack (tools/hd/esrgan.py, Real-ESRGAN x4) and back down to twice its natural size, so the rims stay crisp on a phone's screen.
The sprites (WebP with alpha) go into index.html as Object.assign(IMG, {home_*: ...}) between /*HOME_ART*/ ... /*HOME_ART_END*/ (a second run replaces them). Needs Pillow + numpy (+ onnx, onnxruntime for the upscaler)."""
import base64, io, os, re, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "hd"))
args = [a for a in sys.argv[1:]]
SHEET = args[args.index("--sheet") + 1] if "--sheet" in args else None
NO_ESR = "--no-esrgan" in args
PART = args[args.index("--part") + 1] if "--part" in args else "all"
SC = float(args[args.index("--sc") + 1]) if "--sc" in args else 1.0
pos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--sheet", "--part", "--sc"))]
SRC = pos[0] if pos else os.path.join(ROOT, "tools", "art", "home_mockup.png")
IM = Image.open(SRC).convert("RGB"); A = np.asarray(IM).astype(np.float32)
LUM = 0.30 * A[..., 0] + 0.59 * A[..., 1] + 0.11 * A[..., 2]
MX = A.max(axis=2)
BG = np.array([16, 13, 24], np.float32)   # the dark the pieces were drawn on (for taking the dark out of the soft edges)

# ---- measured on the mockup (1672 x 940 px): outer edge of each gold rim (left, top, right, bottom) and the corner radius
FRAMES = {   # the five icon frames of the top bar + the two keys
    "club": (477.8, 32.4, 575.9, 140.2, 20), "pass": (582.2, 32.4, 679.0, 140.0, 20), "shop": (685.2, 32.2, 781.0, 139.8, 20),
    "cues": (788.3, 32.4, 885.6, 139.8, 20), "rank": (892.8, 32.2, 994.0, 140.0, 20),
    "fs": (1503.0, 39.0, 1569.3, 109.2, 19), "set": (1584.0, 40.4, 1647.5, 108.0, 19)}
MONEY = (1019.4, 37.4, 1487.0, 116.5, 15)          # the dark plate with the three money groups
PROFILE = (150.0, 32.4, 460.4, 166.4, 28)          # the profile plate (its left end is hidden behind the avatar frame, so the box starts further left)
AV_HOLE = (62.0, 46.0, 175.0, 157.0, 19)           # the portrait's window inside the avatar frame
AV_CROP = (30, 7, 204, 173)                        # avatar frame: wreath + crown + the gold frame
PLUS = [(1150.5, 78.0), (1294.5, 77.5), (1458.5, 77.5)]; PLUS_R = 20.6


def smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t)


def rrmask(shape, box, rad, origin, ss=4):
    """supersampled rounded rectangle (box in mockup px, origin = crop's top-left in mockup px) -> float mask"""
    h, w = shape; l, t, r, b = box; ox, oy = origin
    m = Image.new("L", (w * ss, h * ss), 0); d = ImageDraw.Draw(m)
    d.rounded_rectangle([(l - ox) * ss, (t - oy) * ss, (r - ox) * ss - 1, (b - oy) * ss - 1], radius=max(rad, 0.5) * ss, fill=255)
    return np.asarray(m.resize((w, h), Image.BOX)).astype(np.float32) / 255.0


def crop(box):
    l, t, r, b = [int(round(v)) for v in box]
    return A[t:b, l:r].copy(), LUM[t:b, l:r].copy(), (l, t)


def decon(rgb, a):
    """take the dark background out of the semi-transparent edge pixels (so the soft edge does not turn into a dark fringe on a lighter scene)"""
    a3 = np.maximum(a, 0.06)[..., None]
    fg = (rgb - (1 - a3) * BG) / a3
    return np.clip(np.where(a[..., None] < 0.995, fg, rgb), 0, 255)


def rgba(rgb, a):
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255 + 0.5, 0, 255)]).astype(np.uint8), "RGBA")


def dilate(m, n):
    m = m.copy()
    for _ in range(n):
        p = np.pad(m, 1); m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[2:, 2:] | p[:-2, 2:] | p[2:, :-2]
    return m


def erode(m, n): return ~dilate(~m, n)


def largest_component(m, seed=None):
    """the 4-connected component of True pixels that holds `seed` (y, x) or, without a seed, the biggest one"""
    h, w = m.shape; lab = np.zeros((h, w), np.int32); n = 0; sizes = {}
    for y0 in range(h):
        for x0 in range(w):
            if m[y0, x0] and not lab[y0, x0]:
                n += 1; stack = [(y0, x0)]; lab[y0, x0] = n; c = 0
                while stack:
                    y, x = stack.pop(); c += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and not lab[yy, xx]: lab[yy, xx] = n; stack.append((yy, xx))
                sizes[n] = c
    if not sizes: return m
    k = lab[seed] if seed is not None and lab[seed] else max(sizes, key=sizes.get)
    return lab == k


def purple(rgb):
    """1 where a pixel is the scene's blue / purple light (not gold): used to keep the scene's lamps out of the soft edges"""
    return smooth(rgb[..., 2] - rgb[..., 0], 8, 40)


def goldness(rgb):
    """1 for warm gold, 0 for the scene's blue / purple / pink lights (R about B)"""
    return smooth(rgb[..., 0] - rgb[..., 2], 14, 56)


def feather(a, n=5):
    """fade the sprite's alpha to zero over n px at the crop's own border (no straight cut through a glow)"""
    h, w = a.shape; y = np.arange(h)[:, None]; x = np.arange(w)[None, :]
    d = np.minimum(np.minimum(x, w - 1 - x), np.minimum(y, h - 1 - y)).astype(np.float32)
    return a * np.clip(d / n, 0, 1)


def fill(img, known):
    """push-pull inpainting (tools/add_room_plate.py): the unknown pixels get the smoothed colours of the known ones around them"""
    h, w = known.shape
    if known.all(): return img
    if min(h, w) <= 4 or not known.any():
        out = img.copy(); out[~known] = img[known].mean(axis=0) if known.any() else 0; return out
    ph, pw = h + (h & 1), w + (w & 1)
    I = np.zeros((ph, pw, 3), np.float32); K = np.zeros((ph, pw), np.float32)
    I[:h, :w] = img * known[..., None]; K[:h, :w] = known
    if ph > h: I[h] = I[h - 1]; K[h] = K[h - 1]
    if pw > w: I[:, w] = I[:, w - 1]; K[:, w] = K[:, w - 1]
    s = I.reshape(ph // 2, 2, pw // 2, 2, 3).sum(axis=(1, 3)); c = K.reshape(ph // 2, 2, pw // 2, 2).sum(axis=(1, 3))
    small = np.where(c[..., None] > 0, s / np.maximum(c, 1)[..., None], 0).astype(np.float32)
    small = fill(small, c > 0)
    up = np.repeat(np.repeat(small, 2, axis=0), 2, axis=1)[:h, :w]
    out = np.where(known[..., None], img, up); unk = ~known
    for _ in range(24):
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode="edge"); avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        out = np.where(unk[..., None], avg, out)
    return out


def blur_edges(rgb, m, n=6):
    """a few light passes inside the filled area only, so the fill has no block edges"""
    for _ in range(n):
        p = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode="edge"); avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + 4 * rgb) / 8
        rgb = np.where(m[..., None], avg, rgb)
    return rgb


def cut_frame(box, rad, pad=5, gin=3.5, gout=2.5, lo=50, hi=105, edge_lum=True):
    """icon frame / key: opaque inside the gold rim, the rim's own glow as a soft edge outside it"""
    l, t, r, b = box; org = (int(np.floor(l)) - pad, int(np.floor(t)) - pad)
    rgb, lum, _ = crop((org[0], org[1], int(np.ceil(r)) + pad, int(np.ceil(b)) + pad))
    inner = rrmask(lum.shape, (l + gin, t + gin, r - gin, b - gin), rad - gin, org)
    outer = rrmask(lum.shape, (l - gout, t - gout, r + gout, b + gout), rad + gout, org)
    ramp = smooth(lum, lo, hi) * outer * (1 - purple(rgb))
    a = np.maximum(inner, ramp) if edge_lum else rrmask(lum.shape, box, rad, org)
    return rgb, a, org


def blank_of(box, rad, ring, cap, extra=(), gout=2.5):
    """a copy of a frame without its icon: the inside (inset `ring` px) is painted out from the rim around it (colours capped at `cap` so a glint of the rim does not flood the inside);
    `extra` = more boxes (mockup px) to paint out, e.g. the tips of a wreath that touch the rim"""
    rgb, a, org = cut_frame(box, rad, gout=gout)
    l, t, r, b = box
    inside = rrmask(a.shape, (l + ring, t + ring, r - ring, b - ring), max(rad - ring, 4), org) > 0.5
    for (el, et, er, eb) in extra: inside[int(et - org[1]):int(eb - org[1]), int(el - org[0]):int(er - org[0])] = True
    known = ~inside; src = np.minimum(rgb, cap)
    f = fill(src.astype(np.float32), known); f = blur_edges(f, inside, 10)
    out = np.where(inside[..., None], f, rgb)
    return out, a


def sprite_frame(name):
    l, t, r, b, rad = FRAMES[name]; rgb, a, org = cut_frame((l, t, r, b), rad); return rgba(decon(rgb, a), a)


def sprite_blank():
    l, t, r, b, rad = FRAMES["rank"]
    rgb, a = blank_of((l, t, r, b), rad, 7, np.array([58, 42, 24], np.float32), extra=[(l + 5, 66, l + 16, 122), (r - 16, 66, r - 5, 122)], gout=0.8)
    return rgba(decon(rgb, a), a)


def sprite_blank_key():
    l, t, r, b, rad = FRAMES["fs"]
    rgb, a = blank_of((l, t, r, b), rad, 13, np.array([40, 56, 92], np.float32))
    return rgba(decon(rgb, a), a)


def sprite_money_plate():
    l, t, r, b, rad = MONEY; pad = 5; org = (int(np.floor(l)) - pad, int(np.floor(t)) - pad)
    rgb, lum, _ = crop((org[0], org[1], int(np.ceil(r)) + pad, int(np.ceil(b)) + pad))
    a = np.maximum(rrmask(lum.shape, (l + 2.5, t + 2.5, r - 2.5, b - 2.5), rad - 2.5, org), smooth(lum, 55, 110) * rrmask(lum.shape, (l - 2, t - 2, r + 2, b + 2), rad + 2, org))
    ring = 7
    inside = rrmask(lum.shape, (l + ring, t + ring, r - ring, b - ring), 5, org) > 0.5
    f = fill(np.minimum(rgb, np.array([30, 42, 74], np.float32)), ~inside); f = blur_edges(f, inside, 14)
    out = np.where(inside[..., None], f, rgb)
    return rgba(decon(out, a), a)


def sprite_profile_plate():
    l, t, r, b, rad = PROFILE; x0 = 201; pad = 4; org = (x0, int(np.floor(t)) - pad)
    rgb, lum, _ = crop((org[0], org[1], int(np.ceil(r)) + pad, int(np.ceil(b)) + pad))
    ring = 11
    inside = rrmask(lum.shape, (l + ring, t + ring, r - ring, b - ring), 8, org) > 0.5   # (star, name, XP bar, trophy and the glow round them are all inside)
    f = fill(np.minimum(rgb, 34), ~inside); f = blur_edges(f, inside, 16)
    out = np.where(inside[..., None], f, rgb)
    a = np.maximum(rrmask(lum.shape, (l + 3.5, t + 3.5, r - 3.5, b - 3.5), rad - 3.5, org), smooth(lum, 50, 105) * goldness(rgb) * rrmask(lum.shape, (l - 2.5, t - 2.5, r + 2.5, b + 2.5), rad + 2.5, org))
    return rgba(decon(out, a), a)


def sprite_avatar_frame():
    l, t, r, b = AV_CROP; rgb, lum, org = crop((l, t, r, b)); h, w = lum.shape
    a = smooth(lum, 56, 104) * (1 - purple(rgb))
    hole = rrmask(lum.shape, AV_HOLE[:4], AV_HOLE[4], org)
    a = a * (1 - hole)
    X = np.arange(w)[None, :] + org[0]; Y = np.arange(h)[:, None] + org[1]
    cut = ((X > 187) & ~((Y > 62) & (Y < 150) & (X < 201))) | ((X > 154) & (Y < 40))   # right of the frame only the wreath's tips belong to it (the plate's rim runs there)
    a = feather(np.where(cut, 0, a), 4)
    return rgba(decon(rgb, a), a)


def sprite_star():
    box = (203, 47, 255, 102); rgb, lum, org = crop(box); h, w = lum.shape
    bright = largest_component(lum > 78, (h // 2 + 6, w // 2 - 9))
    hull = erode(dilate(bright, 7), 7); hull = dilate(erode(hull, 3), 3)
    glyph = dilate(hull & (lum < 84), 1)
    f = fill(rgb, ~glyph); f = blur_edges(f, glyph, 8); out = np.where(glyph[..., None], f, rgb)
    lum2 = 0.30 * out[..., 0] + 0.59 * out[..., 1] + 0.11 * out[..., 2]
    keep = dilate(hull, 2)
    a = smooth(lum2, 44, 92) * keep
    return rgba(decon(out, a), a)


def sprite_trophy():
    box = (397, 87, 451, 145); rgb, lum, org = crop(box)
    core = largest_component(lum > 80)
    a = smooth(lum, 52, 100) * dilate(core, 3)
    return rgba(decon(rgb, a), a)


def sprite_icon(box, lo=36, hi=82):
    rgb, lum, org = crop(box); mx = rgb.max(axis=2); a = smooth(mx, lo, hi)
    return rgba(decon(rgb, a), a)


def sprite_plus():
    cx, cy = PLUS[0]; r = PLUS_R; pad = 3
    box = (int(cx - r) - pad, int(cy - r) - pad, int(cx + r) + pad + 1, int(cy + r) + pad + 1); rgb, lum, org = crop(box)
    m = Image.new("L", (rgb.shape[1] * 4, rgb.shape[0] * 4), 0); d = ImageDraw.Draw(m)
    d.ellipse([(cx - r - org[0]) * 4, (cy - r - org[1]) * 4, (cx + r - org[0]) * 4, (cy + r - org[1]) * 4], fill=255)
    a = np.asarray(m.resize((rgb.shape[1], rgb.shape[0]), Image.BOX)).astype(np.float32) / 255.0
    return rgba(decon(rgb, a), a)



# ---- the mode cards and the LIMITED EDITION tile (rim box of each card in the mockup + corner radius, and the baked-in English words to paint out)
CARDS = {
    "play": ((77, 350, 428, 599, 46), [(198, 468, 312, 536), (312, 468, 327, 517), (208, 536, 308, 568)]),
    "cups": ((441, 360, 719, 599, 44), [(488, 531, 674, 575)]),          # (the ribbon's CUPS is handled by RIBBON_TEXT below)
    "events": ((728, 361, 978, 594, 44), [(788, 490, 918, 569)]),
    "mini": ((991, 360, 1284, 598, 44), [(1050, 490, 1230, 578)]),
    "friend": ((1297, 359, 1592, 598, 44), [(1350, 483, 1548, 569)])}
RIBBON_TEXT = (531, 479, 636, 513)       # dark letters on the CUPS ribbon: only the letters are painted out, the gold ribbon stays
CROWN = (180, 303, 326, 356)             # the crown of the Play card stands above its rim
LIM = (1300.5, 756.0, 1647.5, 907.5, 36)  # the frame of the LIMITED EDITION tile
LIM_RIBBON = (1352.0, 737.0, 1590.0, 772.0)
LIM_POLY = [(1364, 738.5), (1576, 738.5), (1590, 757), (1577, 771.5), (1363, 771.5), (1352, 757)]
LIM_TEXT = [(1370, 741, 1572, 768), (1370, 856, 1542, 893)]   # "LIMITED EDITION" on the ribbon, clock + time on the dark pill


def paint_out(rgb, org, boxes, protect=None, cap=None):
    """paint the boxes (mockup px) out of the crop from the colours round them"""
    h, w = rgb.shape[:2]; mk = np.zeros((h, w), bool)
    for (l, t, r, b) in boxes:
        mk[max(int(t - org[1]), 0):max(int(b - org[1]), 0), max(int(l - org[0]), 0):max(int(r - org[0]), 0)] = True
    f = fill(rgb if cap is None else np.minimum(rgb, cap), ~mk); f = blur_edges(f, mk, 10)
    return np.where(mk[..., None], f, rgb), mk


def sprite_card(name, pad=7):
    (l, t, r, b, rad), boxes = CARDS[name]
    top = CROWN[1] if name == "play" else t - pad
    org = (l - pad, top); rgb, lum, _ = crop((l - pad, top, r + pad, b + pad)); h, w = lum.shape
    inner = rrmask(lum.shape, (l + 3, t + 3, r - 3, b - 3), rad - 3, org)
    outer = rrmask(lum.shape, (l - 2, t - 2, r + 2, b + 2), rad + 2, org)
    a = np.maximum(inner, smooth(lum, 62, 118) * outer)
    if name == "play":   # the crown: gold on the dark hall, nothing else of the scene
        cb = np.zeros((h, w), np.float32); cl, ct, cr, cbm = CROWN
        cb[int(ct - org[1]):int(cbm - org[1]), int(cl - org[0]):int(cr - org[0])] = 1
        a = np.maximum(a, smooth(lum, 70, 120) * goldness(rgb) * cb)
    out, mk = paint_out(rgb, org, boxes)
    if name == "cups":
        rl, rt, rr_, rb = RIBBON_TEXT; sub = np.zeros((h, w), bool)
        sub[int(rt - org[1]):int(rb - org[1]), int(rl - org[0]):int(rr_ - org[0])] = lum[int(rt - org[1]):int(rb - org[1]), int(rl - org[0]):int(rr_ - org[0])] < 105
        sub = dilate(sub, 2)
        f = fill(out, ~sub); f = blur_edges(f, sub, 8); out = np.where(sub[..., None], f, out)
    return rgba(decon(out, a), a), org


def sprite_limited():
    l, t, r, b, rad = LIM; rl, rt, rr_, rb = LIM_RIBBON; pad = 6; org = (int(l) - pad, int(rt) - 3)
    rgb, lum, _ = crop((int(l) - pad, int(rt) - 3, int(r) + pad, int(b) + pad)); h, w = lum.shape
    out, mk = paint_out(rgb, org, LIM_TEXT)
    lum2 = 0.30 * out[..., 0] + 0.59 * out[..., 1] + 0.11 * out[..., 2]
    inner = rrmask(lum.shape, (l + 3, t + 3, r - 3, b - 3), rad - 3, org); outer = rrmask(lum.shape, (l - 2.5, t - 2.5, r + 2.5, b + 2.5), rad + 2.5, org)
    a = np.maximum(inner, smooth(lum2, 62, 118) * goldness(out) * outer)
    ss = 4; m = Image.new("L", (w * ss, h * ss), 0); d = ImageDraw.Draw(m)
    d.polygon([((x - org[0]) * ss, (y - org[1]) * ss) for (x, y) in LIM_POLY], fill=255)   # the gold ribbon: its own outline, not the brightness of the letters that were painted out
    a = np.maximum(a, np.asarray(m.resize((w, h), Image.BOX)).astype(np.float32) / 255.0)
    return rgba(decon(out, a), a), org


TOP = {   # key -> sprite (in the mockup's own pixels)
    "club": lambda: sprite_frame("club"), "pass": lambda: sprite_frame("pass"), "shop": lambda: sprite_frame("shop"), "cues": lambda: sprite_frame("cues"), "rank": lambda: sprite_frame("rank"),
    "blank": sprite_blank, "fs": lambda: sprite_frame("fs"), "set": lambda: sprite_frame("set"), "key": sprite_blank_key,
    "mplate": sprite_money_plate, "gem": lambda: sprite_icon((1028, 55, 1080, 102)), "cash": lambda: sprite_icon((1184, 54, 1240, 103)), "coin": lambda: sprite_icon((1326, 54, 1378, 100)), "plus": sprite_plus,
    "pframe": sprite_avatar_frame, "pplate": sprite_profile_plate, "pstar": sprite_star, "ptro": sprite_trophy}
_CS = {}


def card_sprite(n):   # (sprite, origin in the mockup's px), cut once
    if n not in _CS: _CS[n] = sprite_limited() if n == "lim" else sprite_card(n)
    return _CS[n]


TOP.update({"c_" + n: (lambda n=n: card_sprite(n)[0]) for n in list(CARDS) + ["lim"]})

# ---- where the pieces stand on the home stage (1866 x 707 stage px) and the CSS for it; the old painted cards are taken out of the hero picture
S_CARD = 0.84; GAP = 14; ROW_CX = 931; ROW_CY = 296
CARD_SEL = {"play": "#tPlay", "cups": "#tTour", "events": "#tEvents", "mini": "#tMini", "friend": "#tWithFr"}
TILE_W = 384; TILE_BOTTOM = 696; TILE_LEFT = 1456
HERO_ORIG = os.path.join(ROOT, "tools", "art", "home_hero_orig.webp")
HERO_HOLE = (789, 190, 1672, 399)      # stage px: the three old painted cards (events, minigames, with a friend) and the thin strips between them


def layout_css(sprites):
    """CSS (stage px) for the five cards and the limited tile, from the sprites' own sizes and origins"""
    order = ["play", "cups", "events", "mini", "friend"]
    widths = [(CARDS[n][0][2] - CARDS[n][0][0]) * S_CARD for n in order]; x = ROW_CX - (sum(widths) + GAP * 4) / 2; out = []
    for n, w in zip(order, widths):
        (l, t, r, b, rad), _ = CARDS[n]; spr, org = sprites[n]; h = (b - t) * S_CARD; top = ROW_CY - h / 2
        out.append("%s{left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx;border-radius:%.0fpx}" % (CARD_SEL[n], x, top, w, h, rad * S_CARD))
        out.append("%s>.hmci{left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx}" % (CARD_SEL[n], (org[0] - l) * S_CARD, (org[1] - t) * S_CARD, spr.width * S_CARD, spr.height * S_CARD))
        x += w + GAP
    l, t, r, b, rad = LIM; st = TILE_W / (r - l); spr, org = sprites["lim"]; h = (b - t) * st; top = TILE_BOTTOM - h
    out.append("#hLimited{left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx;border-radius:%.0fpx}" % (TILE_LEFT, top, TILE_W, h, rad * st))
    out.append("#hLimited>.hmci{left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx}" % ((org[0] - l) * st, (org[1] - t) * st, spr.width * st, spr.height * st))
    rl, rt, rr_, rb = LIM_RIBBON   # the ribbon's label, and the timer's plate (in the tile's own box)
    out.append("#hLimited .hlim{left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx}" % ((rl - l) * st, (rt - t) * st, (rr_ - rl) * st, (rb - rt) * st))
    out.append("#hLimited .htime{left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx}" % ((1325 - l) * st, (852.5 - t) * st, (1560 - 1325) * st, (892.5 - 852.5) * st))   # the timer's plate (a child of the tile)
    return "\n".join(out)


def _box_blur(a, r):
    """box blur of radius r along both axes of an (h, w, c) float array (cumulative sums, edge-replicated)"""
    for ax in (0, 1):
        n = a.shape[ax]; pad = [(0, 0)] * a.ndim; pad[ax] = (r + 1, r); c = np.cumsum(np.pad(a, pad, mode="edge"), axis=ax, dtype=np.float64)
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax); lo = np.take(c, np.arange(0, n), axis=ax); a = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return a


def _gauss(a, sigma):
    """a Gaussian blur made of three box blurs"""
    r = max(1, int(round(sigma * 0.8)))
    for _ in range(3): a = _box_blur(a, r)
    return a


def clean_hero(ctx=7, detail=0.45, donor_w=600, feather=12):
    """the hero picture without the three old painted cards. The scene behind them is stratified (the skyline's reflection, neon lines, the dark floor), so every row of the hole is a smooth blend of what stands
    left and right of it on the same row (the lines go straight on, nothing is smeared up and down like a blur); the left neighbourhood's own fine texture (its high-pass, mirrored and tiled) is laid over it so it is not
    flat; the edge is feathered into the picture. The new cards are drawn over it, only slivers of it show."""
    im = Image.open(HERO_ORIG).convert("RGB"); a = np.asarray(im).astype(np.float32); h, w = a.shape[:2]; K = w / 1866.0
    x0, y0, x1, y1 = [int(round(v * K)) for v in HERO_HOLE]; hw = x1 - x0
    L = a[y0:y1, x0 - 3 * ctx:x0 - ctx].mean(axis=1); R = a[y0:y1, x1 + ctx:x1 + 3 * ctx].mean(axis=1)
    ker = np.exp(-0.5 * (np.arange(-4, 5) / 1.5) ** 2); ker /= ker.sum()
    for v in (L, R):   # (a little smoothing along y so a single noisy row does not stripe)
        for c in range(3): v[:, c] = np.convolve(np.pad(v[:, c], 4, mode="edge"), ker, mode="valid")
    t = np.linspace(0, 1, hw); t = (t * t * (3 - 2 * t))[None, :, None]; base = L[:, None, :] * (1 - t) + R[:, None, :] * t
    don = a[y0:y1, x0 - donor_w:x0]; hp = don - _gauss(don, 7)
    tiles, flip = [], True
    while sum(q.shape[1] for q in tiles) < hw: tiles.append(hp[:, ::-1] if flip else hp); flip = not flip   # the mirrored copy first: continuous at the edge
    det = np.concatenate(tiles, axis=1)[:, :hw]; fade = np.clip(1 - np.linspace(0, 1, hw) * 0.9, 0, 1)[None, :, None]
    rows = (np.arange(y0, y1) / K)[:, None, None]; amp = np.clip((rows - 285) / 30.0, 0, 1)   # (the left neighbourhood holds lounge furniture in the upper rows: no texture from there, it would show as ghosts)
    out = a.copy(); out[y0:y1, x0:x1] = base + detail * amp * det * fade
    m = np.zeros((h, w, 1), np.float32); m[y0:y1, x0:x1] = 1; fm = np.clip(_gauss(m, feather / 2.0), 0, 1)
    return Image.fromarray(np.clip(a * (1 - fm) + out * fm, 0, 255).astype(np.uint8), "RGB")


ESR = None


def sharpen(img, scale=2.0):
    """Real-ESRGAN x4 (the HD pack's upscaler), then down to `scale` times the natural size: crisp rims instead of the mockup's soft ones"""
    global ESR
    if NO_ESR:
        return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    if ESR is None:
        from esrgan import Upscaler, upscale_rgba
        ESR = (Upscaler(), upscale_rgba)
    big = ESR[1](ESR[0], img)
    return big.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def webp(img, q=90):
    b = io.BytesIO(); img.save(b, "WEBP", quality=q, method=6); return b.getvalue()


def build(parts):
    out = {}
    for k in parts:
        spr = TOP[k](); big = sharpen(spr); out["home_" + k] = (spr, big)
    return out


def sheet(sprites, path, sc=1.0):
    """every sprite on a dark scene colour and on a light grey, side by side (to see fringes)"""
    tiles = []
    for k, (spr, big) in sprites.items():
        for bgc in ((10, 14, 40), (150, 150, 160)):
            b2 = big.resize((round(big.width * SC), round(big.height * SC)), Image.LANCZOS) if SC != 1 else big
            t = Image.new("RGB", (b2.width + 12, b2.height + 12), bgc); t.paste(b2, (6, 6), b2); tiles.append((k, t))
    W = 1800; x = y = 0; rowh = 0; pos = []
    for k, t in tiles:
        if x + t.width > W: x = 0; y += rowh; rowh = 0
        pos.append((x, y, t)); x += t.width; rowh = max(rowh, t.height)
    sh = Image.new("RGB", (W, y + rowh), (40, 40, 40))
    for x, y, t in pos: sh.paste(t, (x, y))
    sh.save(path); print("sheet", path, sh.size)


if __name__ == "__main__":
    parts = ([k for k in TOP if not k.startswith("c_")] if PART == "top" else list(TOP) if PART == "all" else [k for k in PART.split(",") if k in TOP] if PART != "cards" else [k for k in TOP if k.startswith("c_")])
    S = build(parts)
    for k, (spr, big) in S.items(): print(k, spr.size, "->", big.size, len(webp(big)), "bytes")
    if SHEET: sheet(S, SHEET)
    if not SHEET or "--write" in args:
        p = os.path.join(ROOT, "index.html"); s = open(p, encoding="utf-8").read()
        have = {}   # a partial run (--part ...) keeps the pictures it did not make: the block is merged with what index.html already holds
        m0 = re.search(r"/\*HOME_ART\*/(.*?)/\*HOME_ART_END\*/", s, flags=re.S)
        if m0: have = {k: v for k, v in re.findall(r'"(home_[a-z_]+)": "(data:image/webp;base64,[A-Za-z0-9+/=]+)"', m0.group(1))}
        for k, (spr, big) in S.items(): have[k] = "data:image/webp;base64," + base64.b64encode(webp(big)).decode()
        ent = ['"%s": "%s"' % (k, have[k]) for k in sorted(have)]
        block = "/*HOME_ART*/Object.assign(IMG, {%s});/*HOME_ART_END*/" % ", ".join(ent)
        if "/*HOME_ART*/" in s: s = re.sub(r"/\*HOME_ART\*/.*?/\*HOME_ART_END\*/", lambda m: block, s, flags=re.S)
        else:
            i = s.index("/*HUD_ART_END*/"); j = s.index("\n", i)
            s = s[:j + 1] + block + "\n" + s[j + 1:]
        if any(k.startswith("home_c_") for k in S):
            hero = clean_hero(); b = io.BytesIO(); hero.save(b, "WEBP", quality=94, method=6); print("hero", hero.size, len(b.getvalue()), "bytes")
            s, n = re.subn(r'"homeBg":\s*"data:image/webp;base64,[A-Za-z0-9+/=]+"', lambda m: '"homeBg":"data:image/webp;base64,%s"' % base64.b64encode(b.getvalue()).decode(), s, count=1); assert n == 1
            css = layout_css({n: card_sprite(n) for n in list(CARDS) + ["lim"]})
            cblock = "/*HOME_CARDS_CSS*/\n" + css + "\n/*HOME_CARDS_CSS_END*/"
            if "/*HOME_CARDS_CSS*/" in s: s = re.sub(r"/\*HOME_CARDS_CSS\*/.*?/\*HOME_CARDS_CSS_END\*/", lambda m: cblock, s, flags=re.S)
            else:
                i = s.index("#nav #fsBtn{background-image:var(--i-home_fs)!important;font-size:0}"); j = s.index("\n", i)
                s = s[:j + 1] + cblock + "\n" + s[j + 1:]
            print(css)
        open(p, "w", encoding="utf-8").write(s); print("index.html updated")
