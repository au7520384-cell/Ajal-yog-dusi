#!/usr/bin/env python3
"""A copy of the INBOX window picture (IMG.ibm_bg) WITHOUT the four painted social-media keys (Facebook / Telegram / Instagram / TikTok) and their "News & rewards" label.
Y8 (and the other portals) forbid links to social media; the keys are painted into the owner's picture, so hiding the tap areas is not enough: the portal pages use IMG.ibm_bg_ns.

    python3 tools/make_ibm_clean.py [index.html] [--preview out.png]      (needs Pillow)

It reads IMG.ibm_bg out of index.html, repaints the strip with the picture's own surroundings (every row of a hole is a blend of what stands left and right of it on the SAME row, so the thin
blue glow line and the soft glow along the bottom go straight on; the edges are feathered), clears the keys' glow that reaches down to the golden edge of the frame, and writes IMG.ibm_bg_ns right
behind IMG.ibm_bg (replacing an older copy). The rest of the picture is not touched (it is decoded and encoded again as a lossy WebP at quality 90)."""
import base64, io, os, re, sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
path = args[0] if args else os.path.join(HERE, "..", "index.html")
preview = sys.argv[sys.argv.index("--preview") + 1] if "--preview" in sys.argv else ""
src = open(path, encoding="utf-8").read()
m = re.search(r'"ibm_bg"\s*:\s*"data:image/webp;base64,([A-Za-z0-9+/=]+)"', src)
if not m: sys.exit("IMG.ibm_bg not found in " + path)
im = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert("RGB")
assert im.size == (3230, 1948), im.size   # the boxes below are measured on this picture


def feathered(w, h, f, fb):
    """255 inside the box, soft edges: f px at the left / right / top, fb px at the bottom (0 = a hard edge)"""
    mk = Image.new("L", (w, h + 24), 0); mk.paste(255, (f, f, w - f, h - fb + (24 if fb == 0 else 0)))
    return mk.filter(ImageFilter.GaussianBlur(max(f, fb, 1) / 2.2)).crop((0, 0, w, h))


# (box of the hole, x of the clean strip on its left, x of the clean strip on its right, feather left / right / top, feather at the bottom)
HOLES = [((1090, 1494, 2165, 1572), 1076, 2176, 7, 7),    # the label "News & rewards" with its two ornaments (the thin blue glow line behind it goes straight on)
         ((688, 1540, 2578, 1737), 672, 2592, 6, 0)]       # the four keys with their glow (it stops above the golden edge of the frame, which is 1746 px down at the ends)
out = im.copy()
for (x0, y0, x1, y1), lx, rx, f, fb in HOLES:
    h = y1 - y0
    L = im.crop((lx - 12, y0, lx, y1)).resize((1, h), Image.BOX)     # the clean strip left of the hole, averaged across, one colour per row
    R = im.crop((rx, y0, rx + 12, y1)).resize((1, h), Image.BOX)
    two = Image.new("RGB", (2, h)); two.paste(L, (0, 0)); two.paste(R, (1, 0))
    fill = two.resize((rx - lx, h), Image.BILINEAR).crop((x0 - lx, 0, x1 - lx, h))   # row by row: left colour -> right colour
    out.paste(Image.composite(fill, out.crop((x0, y0, x1, y1)), feathered(x1 - x0, h, f, fb)), (x0, y0))   # (blended with the picture as it is by now: the two holes overlap)

# the glow of the keys also reaches down towards the golden edge of the frame, which is an arc (1746 px down at the ends, 1769 in the middle):
# there the clean colour of the last filled row goes straight down, ending 13 px above the arc
x0, x1, ytop = 688, 2578, 1737 - 3
arc = lambda x: 1746 + 23 * (1 - ((x - 1631) / 943) ** 2)
bot = lambda x: arc(x) - 13
nrows = int(max(bot(x) for x in range(x0, x1 + 1))) - ytop + 8
mask = Image.new("L", (x1 - x0, nrows), 0)
ImageDraw.Draw(mask).polygon([(0, 0)] + [(x - x0, max(3, bot(x) - ytop)) for x in range(x0, x1 + 1, 4)] + [(x1 - x0, 0)], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(3))
row = fill.crop((0, fill.height - 1, fill.width, fill.height)).resize((x1 - x0, nrows), Image.NEAREST)
out.paste(Image.composite(row, out.crop((x0, ytop, x1, ytop + nrows)), mask), (x0, ytop))

if preview: out.crop((560, 1440, 2720, 1830)).save(preview)
buf = io.BytesIO(); out.save(buf, "WEBP", quality=90, method=6)
new = '"ibm_bg_ns":"data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode() + '"'
old = re.search(r',"ibm_bg_ns"\s*:\s*"data:image/webp;base64,[A-Za-z0-9+/=]+"', src)
if old: src = src[:old.start()] + "," + new + src[old.end():]
else: src = src[:m.end()] + "," + new + src[m.end():]
tmp = path + ".tmp"; open(tmp, "w", encoding="utf-8").write(src); os.replace(tmp, path)
print("IMG.ibm_bg_ns written:", len(buf.getvalue()), "bytes (the original is", len(base64.b64decode(m.group(1))), "bytes)")
