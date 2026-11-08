# Google Play feature graphic 1024x500 + icon copy:  python3 tools/make_play_feature.py  (from the repo root)
from PIL import Image, ImageDraw, ImageFont, ImageFilter
bg = Image.open("art/login_bg_istanbul.webp").convert("RGB"); logo = Image.open("art/login_logo.webp").convert("RGBA")
W, H = 1024, 500; k = max(W / bg.width, H / bg.height); bg = bg.resize((round(bg.width * k), round(bg.height * k)), Image.LANCZOS)
x = (bg.width - W) // 2; y = round((bg.height - H) * 0.45); im = bg.crop((x, y, x + W, y + H)).convert("RGBA")
ov = Image.new("RGBA", (W, H), (4, 6, 20, 120)); im.alpha_composite(ov)
wd = 640; lg = logo.resize((wd, round(logo.height * wd / logo.width)), Image.LANCZOS); pad = 70
big = Image.new("L", (lg.width + 2 * pad, lg.height + 2 * pad), 0); big.paste(lg.split()[3], (pad, pad))
sh = Image.new("RGBA", big.size, (255, 190, 60, 0)); sh.putalpha(big.filter(ImageFilter.GaussianBlur(24)).point(lambda v: v * 0.8))
cx, cy = W // 2, 205; im.alpha_composite(sh, (cx - big.width // 2, cy - big.height // 2)); im.alpha_composite(lg, (cx - lg.width // 2, cy - lg.height // 2))
d = ImageDraw.Draw(im); f = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Bold.otf", 34)
s = "Online 8-ball pool  •  Cues  •  Tables"; w = d.textlength(s, font=f) + 56; h = 34 + 30; yy = 425
d.rounded_rectangle((W / 2 - w / 2, yy - h / 2, W / 2 + w / 2, yy + h / 2), radius=h / 2, fill=(20, 24, 60, 215), outline=(255, 205, 90, 255), width=3)
d.text((W / 2, yy), s, font=f, fill=(255, 236, 170, 255), anchor="mm")
im.convert("RGB").save("store/play/feature.png"); Image.open("icon-512.png").convert("RGB").save("store/play/icon-512.png")
print("ok")
