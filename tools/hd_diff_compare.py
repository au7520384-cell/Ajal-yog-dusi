#!/usr/bin/env python3
"""Compares the screens saved by tools/hd_diff_capture.js:  python3 tools/hd_diff_compare.py <dir>
a_off = HD off, b_on = HD on, c_off = HD off again (how much a screen changes by itself: animations, clocks).
Both pictures are blurred and cut into blocks; HD makes edges sharper (high frequencies) but must not move or remove anything (low frequencies),
so a screen whose HD-vs-off difference is clearly above its off-vs-off difference has a problem. Writes <dir>/diff_<screen>.png for the worst ones."""
import os, sys, re
import numpy as np
from PIL import Image, ImageFilter
d = sys.argv[1]
def load(p):
    im = Image.open(p).convert("RGB"); w, h = im.size
    return np.asarray(im.resize((w // 4, h // 4), Image.BOX).filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)
def blocks(a, b, bs=12):
    diff = np.abs(a - b).mean(axis=2); H, W = diff.shape; H2, W2 = H // bs * bs, W // bs * bs
    m = diff[:H2, :W2].reshape(H2 // bs, bs, W2 // bs, bs).mean(axis=(1, 3)); return m, diff
names = sorted(f[len("a_off_"):-4] for f in os.listdir(d) if f.startswith("a_off_") and f.endswith(".png"))
print(f"{'screen':16s} {'noise max':>9s} {'HD max':>8s} {'noise mean':>10s} {'HD mean':>8s}  verdict")
bad = 0
for n in names:
    pa, pb, pc = (os.path.join(d, f"{t}_{n}.png") for t in ("a_off", "b_on", "c_off"))
    if not (os.path.exists(pb) and os.path.exists(pc)): print(f"{n:16s} missing"); continue
    A, B, C = load(pa), load(pb), load(pc)
    mn, _ = blocks(A, C); mh, dh = blocks(A, B)
    nmax, hmax, nmean, hmean = mn.max(), mh.max(), mn.mean(), mh.mean()
    worse = hmax > max(18.0, 2.0 * nmax) or hmean > max(2.0, 2.0 * nmean + 0.5)
    print(f"{n:16s} {nmax:9.1f} {hmax:8.1f} {nmean:10.2f} {hmean:8.2f}  {'CHECK' if worse else 'ok'}")
    if worse:
        bad += 1
        a = Image.open(pa).convert("RGB"); b = Image.open(pb).convert("RGB"); h = np.clip(np.asarray(Image.fromarray(np.clip(dh * 6, 0, 255).astype(np.uint8)).resize(a.size)), 0, 255)
        sheet = Image.new("RGB", (a.width * 3, a.height)); sheet.paste(a, (0, 0)); sheet.paste(b, (a.width, 0)); sheet.paste(Image.fromarray(h).convert("RGB"), (a.width * 2, 0)); sheet.save(os.path.join(d, f"diff_{n}.png"))
print(f"{bad} of {len(names)} screens need a look")
