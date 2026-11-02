#!/usr/bin/env python3
"""Takes the name plaque (a dark panel with a gem) off the bottom of the 28 illustrated frames: the 12 premium frames (pf_*), the 8 scary shop frames (fs_*) and the 8 plain paid frames (PLAIN_*) in FRIMG2 of index.html.
tools/clean_frame_plaques.py [--preview out.png] [--no-embed]
The plaque hung under the window of the frame and covered the card / the board below an avatar. Everything below a cut line (found by eye, in a 256-pixel picture; scaled for the 384-pixel ones) becomes
transparent, with a 3-pixel soft edge; the picture keeps its size, so the avatar window stays where it was. Run it once on the original pictures (a second run changes nothing: the cut is already made).
Run it with /usr/bin/python3 (needs Pillow + numpy)."""
import argparse, base64, io, os, re
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = {"pf_ame": 189, "pf_bdi": 189, "pf_brz": 190, "pf_dia": 190, "pf_emr": 193, "pf_gld": 191, "pf_opl": 190, "pf_plt": 191, "pf_rby": 194, "pf_rgd": 190, "pf_sap": 191, "pf_slv": 191,
       "fs_0": 193, "fs_1": 194, "fs_2": 193, "fs_3": 193, "fs_4": 194, "fs_5": 193, "fs_6": 195, "fs_7": 194,
       "PLAIN_1": 195, "PLAIN_2": 192, "PLAIN_3": 195, "PLAIN_4": 195, "PLAIN_5": 194, "PLAIN_6": 194, "PLAIN_7": 195, "PLAIN_8": 196}


def cut(im, y256):
    im = im.convert("RGBA"); a = np.asarray(im).copy(); H = a.shape[0]; s = H / 256.0; yc = y256 * s; f = 3.0 * s
    rows = np.arange(H, dtype=np.float64) + 0.5
    k = np.clip((yc - rows) / f, 0, 1)            # 1 above the soft edge, 0 below the cut line
    a[..., 3] = (a[..., 3].astype(np.float64) * k[:, None]).round().astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--preview"); ap.add_argument("--no-embed", action="store_true"); a = ap.parse_args()
    path = os.path.join(ROOT, "index.html"); src = open(path, encoding="utf-8").read()
    m = re.search(r"const FRIMG2 = \{", src); end = src.index("\n", m.end()); line = src[m.start():end]
    pairs = []
    def sub(mm):
        k = mm.group(1)
        if k not in CUT: return mm.group(0)
        old = Image.open(io.BytesIO(base64.b64decode(mm.group(2)))).convert("RGBA"); new = cut(old, CUT[k]); b = io.BytesIO()
        new.save(b, "WEBP", quality=92, method=6, alpha_quality=100, exact=True); pairs.append((k, old, new))
        return '"%s":"data:image/webp;base64,%s"' % (k, base64.b64encode(b.getvalue()).decode())
    line2 = re.sub(r'"([A-Za-z0-9_]+)":"data:image/webp;base64,([A-Za-z0-9+/=]+)"', sub, line)
    print(len(pairs), "frames cleaned, FRIMG2 line %.2f MB -> %.2f MB" % (len(line) / 1048576, len(line2) / 1048576))
    if a.preview:
        C = 200; cols = 7; rows = (len(pairs) + cols - 1) // cols; sheet = Image.new("RGB", (cols * C * 2, rows * C), (56, 56, 74))
        for i, (k, o, n) in enumerate(pairs):
            for j, im in enumerate((o, n)):
                bg = Image.new("RGBA", im.size, (56, 56, 74, 255)); bg.alpha_composite(im); sheet.paste(bg.convert("RGB").resize((C, C), Image.LANCZOS), ((i % cols) * C * 2 + j * C, (i // cols) * C))
        sheet.save(a.preview)
    if not a.no_embed:
        open(path, "w", encoding="utf-8").write(src[:m.start()] + line2 + src[end:]); print("index.html updated")


if __name__ == "__main__":
    main()
