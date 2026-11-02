#!/usr/bin/env python3
"""Replaces the 40 'collector' frame pictures (IMG.fa0 .. fa39 of index.html) with the owner's new frames: tools/replace_frame_art.py <sheet.png> [--size 256] [--preview out.png] [--no-embed]
The sheet is a picture with the frames F01 .. F40 in 4 rows of 10 dark cards (F01 -> fa0, F02 -> fa1 ...). Each frame is cut out of its card, the dark card colour round it and in its window becomes
transparent (the bright frame is found, small dark pockets inside the ornament stay opaque, the colours at the edge are pulled in from the inside so no black fringe is left) and the frame is fitted to the
geometry the game expects of a frame picture: the window is 72 % of the picture and in the middle (the game draws the picture 139 % of the avatar; the avatar is drawn FA_AVS of its size so that it fills the window), the ornament reaches
the edge. Everything that shows a frame through IMG.fa* (the pass frames, and the frames that have no picture of their own) changes at once.
Run it with /usr/bin/python3 (needs Pillow + numpy)."""
import argparse, base64, io, os, re
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def bands(profile, thr, minlen, lo=0):
    out, inb, s = [], False, 0
    for i in range(lo, len(profile)):
        if profile[i] >= thr and not inb: s, inb = i, True
        elif profile[i] < thr and inb:
            if i - s >= minlen: out.append((s, i))
            inb = False
    return out


def cells(rgb, cols=10, rows=4):
    """[(x0, y0, x1, y1)] of the 40 frames, row by row (the bright ornament of each card; the label tags and the card borders are not bright enough / too short)"""
    V = rgb.max(axis=2); H, W = V.shape
    rb = bands((V[:, 20:W - 20] > 170).sum(axis=1), 25, 80, lo=320)   # below the title
    rb = rb[:rows]   # the rows of cards come first; below them the sheet has a bright flourish
    if len(rb) != rows: raise SystemExit("expected %d rows of frames, found %d" % (rows, len(rb)))
    out = []
    for y0, y1 in rb:
        cb = bands((V[y0:y1] > 150).sum(axis=0), 2, 20)
        if len(cb) != cols: raise SystemExit("expected %d frames in a row, found %d" % (cols, len(cb)))
        out += [(x0, y0, x1, y1) for x0, x1 in cb]
    return out


def boxblur(a, r):
    """mean over a (2r+1) x (2r+1) square of a 2-D float array (edges repeated), by running sums"""
    p = np.pad(a.astype(np.float64), r, mode="edge"); k = 2 * r + 1
    c = np.cumsum(p, axis=0); c = np.concatenate([c[k - 1:k], c[k:] - c[:-k]], axis=0)
    c = np.cumsum(c, axis=1); c = np.concatenate([c[:, k - 1:k], c[:, k:] - c[:, :-k]], axis=1)
    return (c / (k * k)).astype(np.float32)


def dilate(m, r=1):
    o = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            o |= np.roll(np.roll(m, dy, 0), dx, 1)
    return o


def erode(m, r=1): return ~dilate(~m, r)


def label(mask):
    """4-connected components (iterative flood fill with a stack): returns (labels, count)"""
    H, W = mask.shape; lab = np.zeros((H, W), np.int32); n = 0
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not lab[y, x]:
                n += 1; st = [(y, x)]; lab[y, x] = n
                while st:
                    cy, cx = st.pop()
                    for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]: lab[ny, nx] = n; st.append((ny, nx))
    return lab, n


def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / float(hi - lo), 0, 1); return t * t * (3 - 2 * t)


def window_walls(A, cx, cy, fb):
    """the window of the frame: from the middle go out along several rows / columns until the ornament starts; the middle value of those walls (a gap in a thin vine does not fool it)"""
    H, W = A.shape; ring = 0.55
    def wall(dy, dx, y0, x0):
        y, x = y0, x0
        while 0 <= y < H and 0 <= x < W and not (A[y, x] > ring and A[min(max(y - dy, 0), H - 1), min(max(x - dx, 0), W - 1)] > 0.3 or A[y, x] > 0.8): y += dy; x += dx
        return x if dx else y
    for _ in range(3):
        L = [wall(0, -1, cy + d, cx) for d in range(-14, 15, 2)]; Rr = [wall(0, 1, cy + d, cx) for d in range(-14, 15, 2)]
        T = [wall(-1, 0, cy, cx + d) for d in range(-14, 15, 2)]; B = [wall(1, 0, cy, cx + d) for d in range(-14, 15, 2)]
        x0, x1, y0, y1 = float(np.median(L)), float(np.median(Rr)), float(np.median(T)), float(np.median(B))
        cx, cy = int(round((x0 + x1) / 2)), int(round((y0 + y1) / 2))
    fw = fb[2] - fb[0]
    if not (0.45 * fw <= x1 - x0 <= 0.88 * fw and 0.45 * fw <= y1 - y0 <= 0.88 * fw):   # the walls could not be found: a typical window
        x0, x1 = fb[0] + 0.19 * fw, fb[2] - 0.19 * fw; y0, y1 = fb[1] + 0.19 * fw, fb[3] - 0.19 * fw
    return (x0, y0, x1, y1)


def key(crop, lo=72, hi=150):
    """RGBA of a frame cut from its dark card (luma key): the card is near black, so the brightness of a pixel says how much frame it holds. alpha ramps from 0 (card, soft glow) to 1 (ornament) between brightness lo and hi,
    the colour is lifted where alpha is small (the pixel is the colour times alpha on black); stray bits outside the ornament (the card's border line) are cut away by a mask round the biggest bright part.
    returns (float RGBA 0..255, window bbox (x0, y0, x1, y1) in crop pixels, frame bbox)"""
    H, W = crop.shape[:2]; V = crop.max(axis=2).astype(np.float32); A = smoothstep(V, lo, hi)
    solid = V > 150
    lab, n = label(erode(dilate(solid, 1), 1))
    if n == 0: raise SystemExit("empty cell")
    big = int(np.argmax(np.bincount(lab.ravel())[1:])) + 1; ys, xs = np.where(lab == big); bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
    sz = np.bincount(lab.ravel(), minlength=n + 1); keep = (lab > 0) & (sz[lab] >= 5)         # the ring comes in pieces (vines, flowers): every piece stays, only specks go
    ys, xs = np.where(keep); bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
    R = np.asarray(Image.fromarray((dilate(keep, 5) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255.0
    A = A * R
    col = np.minimum(crop.astype(np.float32) / np.maximum(A, 0.45)[..., None], 255.0)
    wbox = window_walls(A, (bx0 + bx1) // 2, (by0 + by1) // 2, (bx0, by0, bx1 + 1, by1 + 1))
    ys, xs = np.where(A > 0.3)
    return np.dstack([col, A * 255.0]).astype(np.float32), wbox, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def fit(rgba, win, fr, N, wfrac=0.66, margin=2):
    """the frame on an N x N picture: window centre in the middle, window = wfrac of the picture (smaller if the ornament would be cut off at the edge); returns (picture, scale, window fraction)"""
    wx = (win[0] + win[2]) / 2.0; wy = (win[1] + win[3]) / 2.0; ww = max(win[2] - win[0], win[3] - win[1])
    s = wfrac * N / ww
    ext = max(wx - fr[0], fr[2] - wx, wy - fr[1], fr[3] - wy)           # how far the ornament reaches from the window centre
    s = min(s, (N / 2.0 - margin) / ext)
    A = rgba[..., 3] / 255.0; P = rgba[..., :3] * A[..., None]           # premultiplied colour: resizing never drags black in from the card
    nw, nh = int(round(rgba.shape[1] * s)), int(round(rgba.shape[0] * s))
    ch = [np.asarray(Image.fromarray(P[..., c].astype(np.float32), "F").resize((nw, nh), Image.LANCZOS), np.float32) for c in range(3)]
    al = np.clip(np.asarray(Image.fromarray(A.astype(np.float32), "F").resize((nw, nh), Image.LANCZOS), np.float32), 0, 1)
    rgb = np.clip(np.dstack(ch) / np.maximum(al, 1e-3)[..., None], 0, 255)
    img = Image.fromarray(rgb.astype(np.uint8), "RGB").filter(ImageFilter.UnsharpMask(1.1, 60, 2))
    al = Image.fromarray((np.clip((al - 0.5) * 1.25 + 0.5, 0, 1) * 255).astype(np.uint8), "L")
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0)); layer = Image.merge("RGBA", (*img.split(), al))
    out.alpha_composite(layer, (int(round(N / 2.0 - wx * s)), int(round(N / 2.0 - wy * s))))
    return out, s, ww * s / N


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("sheet"); ap.add_argument("--size", type=int, default=256); ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--preview"); ap.add_argument("--save-dir"); ap.add_argument("--no-embed", action="store_true"); a = ap.parse_args()
    rgb = np.asarray(Image.open(a.sheet).convert("RGB")); grid = cells(rgb); outs = []; avs = []
    for i, (x0, y0, x1, y1) in enumerate(grid):
        crop = rgb[max(0, y0 - 1):y1 + 1, max(0, x0 - 1):x1 + 1]
        rgba, win, fr = key(crop); im, s, wf = fit(rgba, win, fr, a.size); outs.append(im); avs.append(round(min(1.0, wf / 0.72 * 1.05), 3))
        print("F%02d -> fa%d: cut %dx%d, window %.0f%%, avatar x%.2f" % (i + 1, i, crop.shape[1], crop.shape[0], 100 * wf, avs[-1]))
    if a.save_dir:
        os.makedirs(a.save_dir, exist_ok=True)
        for i, im in enumerate(outs): im.save(os.path.join(a.save_dir, "fa%d.png" % i))
    if a.preview:
        C = a.size // 2 + 24; cols = 10; sheet = Image.new("RGB", (cols * C, 4 * 2 * C), (40, 40, 60))
        for i, im in enumerate(outs):
            for j, bgc in enumerate(((36, 58, 102), (216, 216, 230))):
                bg = Image.new("RGBA", im.size, bgc + (255,)); bg.alpha_composite(im); th = bg.convert("RGB").resize((C - 4, C - 4), Image.LANCZOS)
                sheet.paste(th, ((i % cols) * C, ((i // cols) * 2 + j) * C))
        sheet.save(a.preview)
    if not a.no_embed:
        path = os.path.join(ROOT, "index.html"); src = open(path, encoding="utf-8").read(); n = 0
        def sub(m):
            nonlocal n
            k = int(m.group(1))
            if k >= len(outs): return m.group(0)
            b = io.BytesIO(); outs[k].save(b, "WEBP", quality=a.quality, method=6, alpha_quality=100, exact=True); n += 1
            return '"fa%d":"data:image/webp;base64,%s"' % (k, base64.b64encode(b.getvalue()).decode())
        src = re.sub(r'"fa(\d+)":"data:image/webp;base64,[A-Za-z0-9+/=]+"', sub, src)
        block = "const FA_AVS = {" + ", ".join('fa%d: %s' % (k, v) for k, v in enumerate(avs)) + "};   // the avatar under a fa* frame is drawn this much of its size, so it fills the window of the picture (tools/replace_frame_art.py)\n"
        if "const FA_AVS = {" in src:
            i = src.index("const FA_AVS = {"); j = src.index("\n", i) + 1; src = src[:i] + block + src[j:]
        else:
            anchor = "const FRAMES = [\n"; assert src.count(anchor) == 1; src = src.replace(anchor, block + anchor)
        open(path, "w", encoding="utf-8").write(src); print("index.html updated:", n, "frame pictures")


if __name__ == "__main__":
    main()
