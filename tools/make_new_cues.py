#!/usr/bin/env python3
"""Cuts the owner's sheet of 29 glowing cues (art/cue_sheet_nov20.png, 1536x1024, cues standing upright on black, tip up) into the game's cue pictures, AS THEY ARE IN THE SHEET.

The game draws an illustrated cue from a horizontal picture with the BUTT on its left and the TIP on its right (drawCueStick), about 1160 px long, with a transparent background.
Every cue is cut out with its real outline: thick butt with its metal rings, the body tapering to the thin tip with its ferrule and leather tip, and everything that sticks out of the body
(8 ball, crown, lion's head, dragon coils). Then the sheet is rotated 90 degrees clockwise (tip up -> tip right) and scaled so that the cue is 1160 px long (the same scale for all 29).

How the outline is found (the glow around the cues and dark carbon bodies defeat a plain brightness threshold):
  * FLOOD FILL: everything outside the cue is reachable from the border of a window around the cue through pixels that are dark and flat; the cue's rim (a crisp bright edge, gradient > 20) and
    everything bright (> 110) is a wall. What the flood cannot reach is the cue (holes filled). Works for gold / silver / bright cues, crowns, the lion, the 8 balls.
  * COMMON CONE: the 29 cues are one design (about 14 px wide at the tip, 36 px from the upper third down to the butt cap). Dark cues have dim rims that the flood leaks through, so the
    outline is never thinner than this cone (a low percentile of the 29 measured widths per row, no clamp: a "never thinner towards the butt" clamp once made every cue a uniform stick).
    outline = cone UNION flood-fill silhouette (limited to +-33 px of the axis, which holds the widest thing: the lion's mane).

    /usr/bin/python3 tools/make_new_cues.py                 -> writes the pictures to --out (default /tmp/newcues) + a contact sheet
    /usr/bin/python3 tools/make_new_cues.py --apply         -> also writes `const CUE_ART3 = {...}` into index.html (replacing an older one)
(Needs numpy, Pillow and opencv: the system /usr/bin/python3 has them.)"""
import os, io, re, json, base64, argparse
import numpy as np, cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "art", "cue_sheet_nov20.png")
IDS = ["nc_%02d" % i for i in range(1, 30)]
TOP, BOT = 33, 933          # the cues stand on y = 33 (tip) .. 933 (butt cap); below that is their reflection
Y0, Y1 = TOP - 3, BOT       # the rows of every picture (the same for all, so the same scale)
OUT_LEN = 1160              # same length as the game's other cue pictures
T = 62                      # brightness that counts as "part of the cue" when the cone is measured
WIN = 36                    # flood-fill window: +-36 px around the axis
LIM = 33                    # nothing farther than 33 px from the axis is part of a cue (the lion's mane reaches 33; the neighbours' rims start at ~33)

def runs_of(lum):
    band = lum[100:880, :]
    on = (band > 45).mean(axis=0) > 0.2
    runs, s = [], None
    for x, v in enumerate(on):
        if v and s is None: s = x
        if not v and s is not None:
            if x - s > 10: runs.append((s, x - 1))
            s = None
    if s is not None: runs.append((s, len(on) - 1))
    return runs

def pct_filter(v, k, q):
    p = np.pad(v, (k // 2, k // 2), mode="edge"); return np.array([np.percentile(p[i:i + k], q) for i in range(len(v))])

def find_axis(lum, cx):
    """the x about which the cue is most mirror-symmetric (rows 150..750), robust to one-sided glow"""
    best, bx = -1, cx
    for c2 in np.arange(cx - 5, cx + 5.01, 0.5):
        sc = 0.0
        for d in range(1, 19):
            xl, xr = int(np.floor(c2 - d)), int(np.ceil(c2 + d))
            sc += np.minimum(lum[150:750, xl], lum[150:750, xr]).sum()
        if sc > best: best, bx = sc, c2
    return float(bx)

def raw_widths(lum, ax):
    """per row (TOP..BOT): the width of everything brighter than T within +-26 px of the axis (polluted by glow: only a low percentile over the 29 cues is used)"""
    cx = int(round(ax)); w = lum[TOP:BOT + 1, cx - 26: cx + 27]; n = w.shape[0]; l = np.full(n, np.nan); r = np.full(n, np.nan)
    for y in range(n):
        xs = np.where(w[y] > T)[0]
        if len(xs) >= 2: l[y], r[y] = xs[0], xs[-1]
    idx = np.where(~np.isnan(l))[0]
    return np.interp(np.arange(n), idx, r[idx]) - np.interp(np.arange(n), idx, l[idx])

def grad_mag(win):
    b = cv2.GaussianBlur(win, (0, 0), 0.8)
    mags = []
    for c in range(3):
        gx = cv2.Sobel(b[:, :, c], cv2.CV_32F, 1, 0, ksize=3, scale=1 / 8)
        gy = cv2.Sobel(b[:, :, c], cv2.CV_32F, 0, 1, ksize=3, scale=1 / 8)
        mags.append(np.hypot(gx, gy))
    return np.max(mags, axis=0)

def fill_holes(m):
    inv = 1 - m; n, lab = cv2.connectedComponents(inv.astype(np.uint8), connectivity=4)
    outside = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    holes = np.isin(lab, [l for l in range(1, n) if l not in outside]) & (inv == 1)
    return (m | holes).astype(np.uint8)

def flood_silhouette(sheet, ax, Tg=20, Tb=110):
    """the cue's outline by flood fill from outside (see the module doc). Returns a uint8 0/1 mask of the window rows Y0..Y1 x columns ax-WIN..ax+WIN"""
    cx = int(round(ax)); win = sheet[Y0:Y1 + 1, cx - WIN: cx + WIN + 1].copy()
    g = win.max(axis=2); mag = grad_mag(win)
    wall = cv2.dilate(((mag > Tg) | (g > Tb)).astype(np.uint8), np.ones((3, 3), np.uint8))
    n, lab = cv2.connectedComponents((1 - wall).astype(np.uint8), connectivity=4)
    border = set(lab[:, 0]) | set(lab[:, -1]) | set(lab[0, :]) | set(lab[-1, :])
    bg = np.isin(lab, [l for l in border if l != 0]) & (wall == 0)
    fg = (~bg).astype(np.uint8)
    n2, lab2 = cv2.connectedComponents(fg, connectivity=8)
    mid = lab2[(Y1 - Y0) // 2, WIN]
    if mid != 0: fg = (lab2 == mid).astype(np.uint8)
    return fill_holes(fg)

def cue_mask(sheet, ax, Wc_full):
    """0/1 mask (rows Y0..Y1 x columns ax-WIN..ax+WIN) of one cue: common cone UNION flood-fill silhouette"""
    n = Y1 - Y0 + 1; cx = int(round(ax)); frac = ax - cx; xs = np.arange(-WIN, WIN + 1)
    half = Wc_full / 2 + 1.0
    cone = (np.abs(xs[None, :] - frac) <= half[:, None]).astype(np.uint8)
    fg = cv2.erode(flood_silhouette(sheet, ax), np.ones((3, 3), np.uint8))           # the wall was dilated: the outline sits ~1 px outside the rim
    # what sticks out of the cone (crown, mane, 8 ball, dragon ...) must be a real, solid thing that belongs to THIS cue:
    #  * sparks and light streaks beside the cue hang on it by 1-2 px bridges: the part beyond the cone is opened (3x3) to cut them, only what still touches the cone is kept;
    #  * an ornament of the NEIGHBOUR (its 8 ball, crown, a rim) pokes into the window from the side: it crosses the +-33 px line, nothing of this cue does (the widest, the lion's mane, ends at 33), so any
    #    piece that crosses that line is dropped as a whole.
    band = cv2.dilate(cone, np.ones((3, 3), np.uint8), iterations=2)
    extra = cv2.morphologyEx((fg & (1 - band)).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    far = np.abs(xs) > LIM
    nn, ll = cv2.connectedComponents(extra, connectivity=8)
    extra[np.isin(ll, np.unique(ll[:, far])) & (ll > 0)] = 0
    nn, ll = cv2.connectedComponents((extra | band).astype(np.uint8), connectivity=8)
    touch = np.isin(ll, np.unique(ll[band > 0])) & (extra > 0)
    fg[:, far] = 0
    m = (cone | (fg & band) | touch).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)); m = fill_holes(m)
    n2, lab2 = cv2.connectedComponents(m, connectivity=8); mid = lab2[n // 2, WIN]
    if mid != 0: m = (lab2 == mid).astype(np.uint8)
    return m, cone, fg

def common_cone(lum, axes):
    Wm = np.array([raw_widths(lum, ax) for ax in axes])
    Wc = pct_filter(np.percentile(Wm, 25, axis=0), 15, 50)              # ~14 px at the tip ... ~33 px at the butt (a low percentile: glow only ever adds)
    return np.concatenate([np.full(TOP - Y0, Wc[0]), Wc])                # rows Y0..BOT (the 3 rows above the tip repeat the first)

def build(sheet_path, out_dir, q=86):
    im = Image.open(sheet_path).convert("RGB"); sheet = np.asarray(im).astype(np.float32); lum = sheet.max(axis=2).astype(int)
    runs = runs_of(lum)
    assert len(runs) == 29, ("expected 29 cues, found", len(runs))
    axes = [find_axis(lum, (x0 + x1) // 2) for x0, x1 in runs]
    Wc_full = common_cone(lum, axes)
    pics = {}; info = []
    for ax, cid in zip(axes, IDS):
        cx = int(round(ax)); m, _, _ = cue_mask(sheet, ax, Wc_full)
        alpha = cv2.GaussianBlur(m.astype(np.float32) * 255, (0, 0), 0.7)
        alpha[-2:, :] *= np.array([[0.6], [0.3]], np.float32)                            # the last rows (the reflection starts right below the butt)
        crop = im.crop((cx - WIN, Y0, cx + WIN + 1, Y1 + 1)).convert("RGBA")
        crop.putalpha(Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8)))
        a = np.asarray(crop)[:, :, 3]; cols = np.where(a.max(axis=0) > 8)[0]             # trim the empty columns (the widest thing sets the picture's height), the axis stays in the middle
        hh = int(max(WIN - cols.min(), cols.max() - WIN)) + 2
        crop = crop.crop((WIN - hh, 0, WIN + hh + 1, crop.height))
        rot = crop.rotate(-90, expand=True)                                              # clockwise: tip (top) -> right, butt -> left
        sc = OUT_LEN / rot.width
        big = rot.resize((OUT_LEN, max(8, int(round(rot.height * sc)))), Image.LANCZOS)
        if big.height % 2: big = big.crop((0, 0, big.width, big.height - 1))
        buf = io.BytesIO(); big.save(buf, "WEBP", quality=q, alpha_quality=96, method=6)
        pics[cid] = buf.getvalue(); info.append((cid, big.size, len(pics[cid])))
        if out_dir: big.save(os.path.join(out_dir, cid + ".png"))
    return pics, info

def contact(pics, path):
    ims = [Image.open(io.BytesIO(b)).convert("RGBA") for b in pics.values()]
    sc = 0.5
    W = int(OUT_LEN * sc); H = sum(int(i.height * sc) + 6 for i in ims)
    sheet = Image.new("RGBA", (W, H), (40, 44, 60, 255)); y = 0
    for i in ims:
        t = i.resize((W, int(i.height * sc)), Image.LANCZOS); sheet.alpha_composite(t, (0, y)); y += t.height + 6
    sheet.convert("RGB").save(path)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--sheet", default=SHEET); ap.add_argument("--out", default="/tmp/newcues"); ap.add_argument("--apply", action="store_true"); ap.add_argument("-q", type=int, default=86)
    o = ap.parse_args(); os.makedirs(o.out, exist_ok=True)
    pics, info = build(o.sheet, o.out, o.q)
    for cid, size, n in info: print(cid, size, "%.1f KB" % (n / 1024))
    print("total %.2f MB" % (sum(n for _, _, n in info) / 1048576))
    contact(pics, os.path.join(o.out, "contact.png"))
    if o.apply:
        line = "const CUE_ART3 = " + json.dumps({k: "data:image/webp;base64," + base64.b64encode(v).decode() for k, v in pics.items()}, separators=(",", ":")) + ";"
        p = os.path.join(ROOT, "index.html"); s = open(p, encoding="utf-8").read()
        if re.search(r"^const CUE_ART3 = .*$", s, re.M): s = re.sub(r"^const CUE_ART3 = .*$", lambda m: line, s, count=1, flags=re.M)
        else: raise SystemExit("no `const CUE_ART3 =` line in index.html yet: add it first (see the NEW_CUES block)")
        open(p, "w", encoding="utf-8").write(s); print("index.html updated")
