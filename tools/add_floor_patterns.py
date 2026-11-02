#!/usr/bin/env python3
"""Floor patterns for the halls: node tools/dump_tables.js > tables.json; /usr/bin/python3 tools/add_floor_patterns.py <folder with the pictures: naqsh_001.jpg or 001_marmar_01.jpg ...> --tables tables.json [--margin 0.045] [--cell 400] [--quality 80] [--preview out.png] [--no-embed]

One picture of a floor (marble, parquet, tiles, an inlaid medallion ...) for every table that has no hall picture of its own (ROOM_FOR): the 156 pictures an artist / an AI made
are matched to the 156 tables by colour (the table's hall colour against the picture's average colour, the best overall pairing - Hungarian method), so a red table stands on a
red marble, a blue one on a blue-grey stone and so on, and no two tables get the same floor.
* every picture is cut to its middle (--margin = the part thrown away on each side, default 4.5 % for the clean 'tuzatilgan' set that has only a thin frame line at the edge; the first AI set needed 16 %: black bands, gold frames, lanterns and vases)
* the cut pictures are packed 5 x 4 into sheets of 20 (WebP, a 2 px rim repeated around every picture so scaling never bleeds into the neighbour) - 8 files in the portal builds, not 156
* index.html gets FLOOR_SRC (the sheets, bare base64 WebP like ROOM_SRC), FLOOR_FOR (table -> [sheet, number on the sheet]) and FLOOR_CELL / FLOOR_PAD / FLOOR_COLS between
  the FLOOR_PATTERNS_BEGIN / _END marker lines; the game lays the picture as tiles (every second one mirrored, so the joins never show), see floorTiles() in index.html.
--margin-for 087=0.2,102=0.22 cuts single pictures more. --map writes the pairing as CSV. Run it with /usr/bin/python3 (needs Pillow + numpy)."""
import argparse, base64, glob, io, math, os, re, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PER, COLS = 20, 5


def lab(rgb):
    """sRGB (0..255, shape (..., 3)) -> CIE Lab (D65)"""
    c = np.asarray(rgb, np.float64) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def hungarian(cost):
    """minimum-cost assignment of rows to columns (square matrix); returns col index for every row"""
    n = len(cost)
    INF = float("inf")
    u = [0.0] * (n + 1); v = [0.0] * (n + 1); p = [0] * (n + 1); way = [0] * (n + 1)
    for i in range(1, n + 1):
        p[0] = i; j0 = 0
        minv = [INF] * (n + 1); used = [False] * (n + 1)
        while True:
            used[j0] = True; i0 = p[j0]; delta = INF; j1 = 0
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]: minv[j] = cur; way[j] = j0
                    if minv[j] < delta: delta = minv[j]; j1 = j
            for j in range(n + 1):
                if used[j]: u[p[j]] += delta; v[j] -= delta
                else: minv[j] -= delta
            j0 = j1
            if p[j0] == 0: break
        while True:
            j1 = way[j0]; p[j0] = p[j1]; j0 = j1
            if j0 == 0: break
    ans = [0] * n
    for j in range(1, n + 1): ans[p[j] - 1] = j - 1
    return ans


def tables(src, jpath):
    """[(id, bg0)] of every table (tables.json from tools/dump_tables.js) and the ids that already stand in a hall picture (ROOM_FOR)"""
    import json
    rows = [(k, v[0]) for k, v in json.load(open(jpath)).items()]
    m = re.search(r"const ROOM_FOR = \{(.*?)\};", src)
    taken = set(re.findall(r'"([A-Za-z0-9_]+)"', m.group(1))) if m else set()
    return rows, taken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder"); ap.add_argument("--tables", required=True, help="tables.json from node tools/dump_tables.js"); ap.add_argument("--margin", type=float, default=0.045); ap.add_argument("--margin-for", default="")
    ap.add_argument("--cell", type=int, default=400); ap.add_argument("--pad", type=int, default=2); ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--preview", help="PNG of the first sheet"); ap.add_argument("--map", help="CSV: table id, picture number, sheet, number on the sheet")
    ap.add_argument("--no-embed", action="store_true")
    a = ap.parse_args()
    files = sorted((f for f in glob.glob(os.path.join(a.folder, "**", "*.jpg"), recursive=True) if re.match(r"(?:naqsh_)?\d+", os.path.basename(f))), key=os.path.basename)   # naqsh_001.jpg or 001_marmar_01.jpg
    over = {int(k): float(v) for k, v in (x.split("=") for x in a.margin_for.split(",") if x)}
    path = os.path.join(ROOT, "index.html"); src = open(path, encoding="utf-8").read()
    tbl, taken = tables(src, a.tables); tbl = [t for t in tbl if t[0] not in taken]
    print(len(files), "pictures,", len(tbl), "tables without a hall picture")
    if len(files) != len(tbl): sys.exit("the number of pictures must equal the number of tables")
    cells, means = [], []
    for f in files:
        num = int(re.match(r"(?:naqsh_)?(\d+)", os.path.basename(f)).group(1)); im = Image.open(f).convert("RGB"); w, h = im.size; m = over.get(num, a.margin)
        im = im.crop((round(w * m), round(h * m), round(w * (1 - m)), round(h * (1 - m)))).resize((a.cell, a.cell), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.0, 45, 3))
        cells.append((num, im)); means.append(np.asarray(im, np.float64).reshape(-1, 3).mean(axis=0))
    pl = lab(np.array(means)); tl = lab(np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for _, c in tbl], np.float64))
    d = pl[None, :, :] - tl[:, None, :]; cost = np.sqrt((0.35 * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)   # the hue matters most, the lightness a little
    pick = hungarian(cost.tolist())
    print("average colour distance: pairing %.1f, in order %.1f" % (np.mean([cost[i][pick[i]] for i in range(len(tbl))]), np.mean(np.diag(cost))))
    st = a.cell + 2 * a.pad; sheets = []
    for s in range(math.ceil(len(cells) / PER)):
        chunk = cells[s * PER:(s + 1) * PER]; rows = math.ceil(len(chunk) / COLS); sheet = Image.new("RGB", (COLS * st, rows * st))
        for k, (num, im) in enumerate(chunk):
            sheet.paste(Image.fromarray(np.pad(np.asarray(im), ((a.pad, a.pad), (a.pad, a.pad), (0, 0)), mode="edge")), ((k % COLS) * st, (k // COLS) * st))
        b = io.BytesIO(); sheet.save(b, "WEBP", quality=a.quality, method=6); sheets.append(b.getvalue())
        if s == 0 and a.preview: sheet.save(a.preview)
    print("sheets:", [len(x) // 1024 for x in sheets], "KB, total %.1f MB" % (sum(map(len, sheets)) / 1048576))
    pairing = {tbl[i][0]: pick[i] for i in range(len(tbl))}
    forjs = ", ".join("%s: [%d, %d]" % (t, pick[i] // PER, pick[i] % PER) for i, (t, _) in enumerate(tbl))
    if a.map:
        with open(a.map, "w") as fo:
            fo.write("table,picture,sheet,index\n")
            for i, (t, _) in enumerate(tbl): fo.write("%s,%03d,%d,%d\n" % (t, cells[pick[i]][0], pick[i] // PER, pick[i] % PER))
    if a.no_embed: return
    block = ("// FLOOR_PATTERNS_BEGIN (generated by tools/add_floor_patterns.py: the floor pictures of the halls, 20 to a sheet; FLOOR_FOR = table -> [sheet, number on the sheet])\n"
             "const FLOOR_SRC = [\n" + ",\n".join('"%s"' % base64.b64encode(x).decode() for x in sheets) + "\n];\n"
             "const FLOOR_FOR = {" + forjs + "};\n"
             "const FLOOR_CELL = %d, FLOOR_PAD = %d, FLOOR_COLS = %d;\n// FLOOR_PATTERNS_END\n" % (a.cell, a.pad, COLS))
    if "// FLOOR_PATTERNS_BEGIN" in src:
        i = src.index("// FLOOR_PATTERNS_BEGIN"); j = src.index("// FLOOR_PATTERNS_END\n") + len("// FLOOR_PATTERNS_END\n"); src = src[:i] + block + src[j:]
    else:
        anchor = "const ROOM_IMG = {};\n"
        assert src.count(anchor) == 1; src = src.replace(anchor, anchor + block)
    open(path, "w", encoding="utf-8").write(src)
    print("index.html updated:", len(tbl), "tables")


if __name__ == "__main__":
    main()
