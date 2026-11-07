# Promo-style artwork for the Y8 developer portal (Portrait Promo 1080x1920, Game Card Promo 760x570): logo + Istanbul picture + short texts, no gameplay screenshot, no buttons.  python3 tools/make_y8_promo.py  (run from the repo root)
from PIL import Image, ImageDraw, ImageFont, ImageFilter
R = "art/"; O = "art/y8_promo/"
bg0 = Image.open(R + "login_bg_istanbul.webp").convert("RGB"); logo0 = Image.open(R + "login_logo.webp").convert("RGBA")
F = lambda n, s: ImageFont.truetype("/usr/share/fonts/opentype/inter/" + n, s)
def cover(im, w, h, cx=0.5, cy=0.5):
    k = max(w / im.width, h / im.height); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x = round((im.width - w) * cx); y = round((im.height - h) * cy); return im.crop((x, y, x + w, y + h))
def grad(w, h, top, bot, a0, a1):   # vertical black-ish gradient overlay
    g = Image.new("RGBA", (w, h)); d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / (h - 1); d.line([(0, y), (w, y)], fill=top + (round(a0 + (a1 - a0) * t),))
    return g
def glow(im, logo, cx, cy, wd):
    lg = logo.resize((wd, round(logo.height * wd / logo.width)), Image.LANCZOS); pad = 90
    big = Image.new("L", (lg.width + 2 * pad, lg.height + 2 * pad), 0); big.paste(lg.split()[3], (pad, pad))
    a = big.filter(ImageFilter.GaussianBlur(28)).point(lambda v: v * 0.8)
    sh = Image.new("RGBA", big.size, (255, 190, 60, 0)); sh.putalpha(a)
    im.alpha_composite(sh, (cx - big.width // 2, cy - big.height // 2)); im.alpha_composite(lg, (cx - lg.width // 2, cy - lg.height // 2))
def text(d, xy, s, font, fill, anchor="mm", sh=3):
    d.text((xy[0] + sh, xy[1] + sh), s, font=font, fill=(0, 0, 0, 200), anchor=anchor); d.text(xy, s, font=font, fill=fill, anchor=anchor)
def chip(d, cx, cy, s, font):
    w = d.textlength(s, font=font) + 56; h = font.size + 30
    d.rounded_rectangle((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), radius=h / 2, fill=(20, 24, 60, 215), outline=(255, 205, 90, 255), width=3)
    d.text((cx, cy), s, font=font, fill=(255, 236, 170, 255), anchor="mm")
def portrait(name, cx):
    W, H = 1080, 1920; im = cover(bg0, W, H, cx, 0.5).convert("RGBA")
    im.alpha_composite(grad(W, H, (4, 6, 20), (4, 6, 20), 150, 40)); im.alpha_composite(grad(W, 700, (4, 6, 20), (4, 6, 20), 0, 235).transform((W, 700), Image.AFFINE, (1, 0, 0, 0, 1, 0)), (0, H - 700))
    glow(im, logo0, W // 2, 560, 1000); d = ImageDraw.Draw(im)
    text(d, (W // 2, 960), "Challenge players worldwide", F("Inter-Bold.otf", 44), (255, 255, 255, 255))
    for i, s in enumerate(["1 vs 1 online matches", "Cups with 16-64 players", "Collect legendary cues & tables"]): chip(d, W // 2, 1330 + i * 135, s, F("Inter-Bold.otf", 46))
    im.convert("RGB").save(O + name, quality=90)
def card(name, cx, cy):
    W, H = 760, 570; im = cover(bg0, W, H, cx, cy).convert("RGBA")
    im.alpha_composite(grad(W, H, (4, 6, 20), (4, 6, 20), 90, 190)); glow(im, logo0, W // 2, 235, 640); d = ImageDraw.Draw(im)
    text(d, (W // 2, 440), "Challenge players worldwide", F("Inter-Bold.otf", 32), (255, 255, 255, 255), sh=2)
    chip(d, W // 2, 505, "Cups  •  Cues  •  Tables", F("Inter-Bold.otf", 26))
    im.convert("RGB").save(O + name, quality=90)
portrait("portrait_1.jpg", 0.30); portrait("portrait_2.jpg", 0.62)
card("card_1.jpg", 0.5, 0.45); card("card_2.jpg", 0.35, 0.3)
