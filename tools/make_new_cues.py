#!/usr/bin/env python3
"""Cuts the owner's sheet of 29 glowing cues (art/cue_sheet_nov20.png, 1536x1024, cues standing upright on black, tip up) into the game's cue pictures.

The game draws an illustrated cue from a horizontal picture with the BUTT on its left and the TIP on its right (drawCueStick), about 1160 px long, with a transparent background.
For every cue: find its silhouette row by row (bright rim + body, the dark glow / reflection under the butt is left out), turn it into an alpha mask, rotate the sheet 90 degrees clockwise
(tip up -> tip right), scale to 1160 px long, centre the cue's axis, write a lossy WebP with alpha.

    /usr/bin/python3 tools/make_new_cues.py                 -> writes the pictures to the scratch folder given by --out (default /tmp/newcues) + a contact sheet
    /usr/bin/python3 tools/make_new_cues.py --apply         -> also writes `const CUE_ART3 = {...}` into index.html (replacing an older one)
(Needs numpy + Pillow.)"""
import os, sys, io, re, json, base64, argparse
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "art", "cue_sheet_nov20.png")
IDS = ["nc_%02d" % i for i in range(1, 30)]
# rows (sheet y) where a cue really carries something wider than its body: an 8 ball, a lion's head, a crown, a dragon's head (cue number -> [(y0, y1)]); everywhere else the body is a clean cone
ORNAMENTS = {3: [(330, 363)], 4: [(329, 395)], 6: [(315, 369)], 11: [(370, 410)], 19: [(315, 360)], 22: [(347, 381)], 27: [(322, 357)]}
TOP, BOT = 33, 933          # the cues stand on y = 33 (tip) .. 933 (butt); below that is their reflection
HALF = 30                   # a cue and its ornaments (crown, 8 ball) fit in +-30 px around its axis; the neighbours' axes are 50+ px away
OUT_LEN = 1160              # same length as the game's other cue pictures
T = 62                      # brightness that counts as "part of the cue" (the faint glow around it is dimmer)

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

def raw_edges(lum, cx):
    """per row: left / right edge (sheet x) of everything brighter than T within +-26 px of cx. Polluted by the glow of the cue itself and by sparks, so it is only used for the AXIS and for the
    rows that carry a real ornament; the body outline comes from the common cone below."""
    w = lum[TOP:BOT + 1, cx - 26: cx + 27]; n = w.shape[0]; l = np.full(n, np.nan); r = np.full(n, np.nan)
    for y in range(n):
        xs = np.where(w[y] > T)[0]
        if len(xs) >= 2: l[y], r[y] = xs[0], xs[-1]
    idx = np.where(~np.isnan(l))[0]
    return np.interp(np.arange(n), idx, l[idx]) - 26 + cx, np.interp(np.arange(n), idx, r[idx]) - 26 + cx

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

def build(sheet_path, out_dir, q=86):
    im = Image.open(sheet_path).convert("RGB"); a = np.asarray(im).astype(int); lum = a.max(axis=2)
    runs = runs_of(lum)
    assert len(runs) == 29, ("expected 29 cues, found", len(runs))
    raws = []
    for x0, x1 in runs:
        cx = (x0 + x1) // 2; ax = find_axis(lum, cx); l, r = raw_edges(lum, int(round(ax)))
        raws.append((ax, l, r))
    # the 29 cues come from one design: the same cone. Per row take a LOW percentile of the widths (glow only ever adds to a width), smooth it, and never let it grow towards the tip
    Wm = np.array([r - l for _, l, r in raws]); Wc = pct_filter(np.percentile(Wm, 30, axis=0), 15, 50)
    for y in range(len(Wc) - 2, -1, -1): Wc[y] = min(Wc[y], Wc[y + 1])         # y grows towards the butt: the width cannot shrink while going to the butt, so the tip side is never wider
    pics = {}; info = []
    for k, ((ax, l, r), cid) in enumerate(zip(raws, IDS)):
        n = len(Wc); orn = np.zeros(n, bool)
        for y0, y1 in ORNAMENTS.get(k + 1, ()): orn[max(0, y0 - 6 - TOP):max(0, y1 + 6 - TOP + 1)] = True
        hl, hr = ax - l, r - ax
        half = Wc / 2 + 1.5
        half = np.where(orn, np.maximum(half, np.minimum(hl, hr)), half)
        half = pct_filter(half, 5, 50)
        H = n; hh = int(np.ceil(half.max())) + 8; W = 2 * hh + 1; off = int(round(ax)) - hh
        crop = im.crop((off, TOP, off + W, BOT + 1))
        sub = lum[TOP:BOT + 1, off:off + W].astype(float)
        soft = np.clip((sub - 60.0) / 110.0, 0, 1) * 255                  # a thin glow rim: really bright pixels within 5 px of the body, fading out
        m = np.zeros((H, W), np.uint8)
        for y in range(H):
            a0 = int(np.floor(ax - half[y] - off)); a1 = int(np.ceil(ax + half[y] - off))
            for x in range(max(0, a0 - 5), min(W, a1 + 6)):
                d = a0 - x if x < a0 else x - a1 if x > a1 else 0
                if d > 0: m[y, x] = int(soft[y, x] * max(0.0, 1.0 - d / 5.5))
            m[y, max(0, a0):min(W, a1 + 1)] = 255
        mask = Image.fromarray(m).filter(ImageFilter.GaussianBlur(0.8))
        mm = np.asarray(mask).astype(float)
        mm[-3:, :] *= np.array([[0.7], [0.45], [0.2]])    # soften the last rows (the reflection starts right below)
        mask = Image.fromarray(mm.astype(np.uint8))
        rgba = crop.convert("RGBA"); rgba.putalpha(mask)
        rot = rgba.rotate(-90, expand=True)             # clockwise: tip (top) -> right, butt -> left
        sc = OUT_LEN / rot.width
        big = rot.resize((OUT_LEN, max(8, int(round(rot.height * sc)))), Image.LANCZOS)
        if big.height % 2: big = big.crop((0, 0, big.width, big.height - 1))
        buf = io.BytesIO(); big.save(buf, "WEBP", quality=q, alpha_quality=96, method=6)
        pics[cid] = buf.getvalue(); info.append((cid, big.size, len(pics[cid])))
        if out_dir: big.save(os.path.join(out_dir, cid + ".png"))
    return pics, info

def contact(pics, path):
    ims = [Image.open(io.BytesIO(b)).convert("RGBA") for b in pics.values()]
    sc = 0.5; rows = []
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
