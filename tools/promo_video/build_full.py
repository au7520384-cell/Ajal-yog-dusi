#!/usr/bin/env python3
# The 1-minute promo video, part 2: cuts the live scenes recorded by rec_scenes.js (and the match clips of the first 26 s video) into shots, adds caption chips, a VIP-cue ad, an end card
# and joins everything with cross-fades.  usage:  SP=<scratch dir> /usr/bin/python3.12 tools/promo_video/build_full.py OUT.mp4 [en|uz]
# (ffmpeg + Pillow; the font is Inter Bold.)  The video has no sound track: build_music.py adds a generated music bed afterwards.
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
SP = os.environ["SP"]; PV = SP + "/pv"; ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else PV + "/promo_full.mp4"; LANG = sys.argv[2] if len(sys.argv) > 2 else "en"
WD = PV + "/seg_" + LANG; os.makedirs(WD, exist_ok=True)
META = json.load(open(PV + "/meta.json")); OLD = {m["ci"]: m for m in json.load(open(SP + "/promo/clips/meta.json"))}
FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"; F = lambda s: ImageFont.truetype(FONT, s)
FPS = 30; W, H = 1920, 1080
def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode: print(" ".join(cmd)[:400]); print(r.stderr.decode()[-1500:]); raise SystemExit(1)

# ---------------------------------------------------------------- captions
TXT = {  # key -> (en, uz)
    "title": ("ROYAL BILLIARD 8", "ROYAL BILLIARD 8"), "title_sub": ("Play · Chat · Compete", "O'ynang · Gaplashing · Bellashing"),
    "physics": ("Real 8-ball physics", "Real 8-shar fizikasi"), "tables": ("30 tables around the world", "Dunyo bo'ylab 30 ta stol"),
    "club": ("Create your own club", "O'z klubingizni yarating"), "club2": ("Emblems · chest · chat", "Emblemalar · sandiq · chat"),
    "lobby": ("Lobby for 8 players", "8 kishilik lobbi"), "voice": ("Talk by voice", "Ovozli suhbat"),
    "world": ("World chat", "Dunyo chati"), "world2": ("Find a game with anyone", "Istalgan kishi bilan o'ynang"),
    "gift": ("Send gifts", "Sovg'alar yuboring"), "chat": ("Chat with your opponent", "Raqib bilan chat"),
    "cues": ("Legendary cues", "Afsonaviy kiylar"), "tbl": ("Premium tables", "Premium stollar"), "avs": ("Hero avatars", "Qahramon avatarlar"), "frames": ("Epic frames", "Epik ramkalar"),
    "vip": ("VIP CUES", "VIP KIYLAR"), "vip_sub": ("80+ designs · sport · atomic · zodiac · horror", "80+ dizayn · sport · atom · burjlar · qo'rqinchli"),
    "champion": ("CHAMPION", "CHEMPION"), "kaboom": ("KABOOM", "KABOOM"), "aries": ("ARIES", "HAMAL"), "aquarius": ("AQUARIUS", "DALV"), "wolf": ("WOLF KING", "BO'RI SHOH"), "ghost": ("GHOST SHIP", "SHARPA KEMA"),
    "vip_end": ("Unlock the legend", "Afsonani oching"), "end": ("Challenge players worldwide", "Butun dunyo bilan bellashing"),
}
def tx(k): return TXT[k][0 if LANG == "en" else 1]
def chip_png(key, name, sub=None, big=False):
    text = tx(key); sub = tx(sub) if sub else None
    f = F(96 if big else 50); w = int(ImageDraw.Draw(Image.new("RGBA", (10, 10))).textlength(text, font=f)) + (150 if big else 90); h = 150 if big else 92
    fs = F(40); ws = int(ImageDraw.Draw(Image.new("RGBA", (10, 10))).textlength(sub, font=fs)) + 60 if sub else 0
    cw = max(w, ws) + 8; ch = h + (74 if sub else 0) + 8; im = Image.new("RGBA", (cw, ch), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((4, 4, cw - 4, 4 + h), radius=h // 2, fill=(14, 18, 52, 232), outline=(255, 205, 90, 255), width=5 if big else 4)
    d.text((cw / 2, 4 + h / 2), text, font=f, fill=(255, 236, 170, 255), anchor="mm")
    if sub:
        d.rounded_rectangle((cw / 2 - ws / 2, h + 16, cw / 2 + ws / 2, h + 78), radius=31, fill=(8, 10, 30, 215))
        d.text((cw / 2, h + 47), sub, font=fs, fill=(255, 255, 255, 255), anchor="mm")
    out = f"{WD}/chip_{name}.png"; im.save(out); return out, cw, ch
def lower_png(key, name, tag=None):   # a lower-third for the VIP ad: a big name with a gold bar
    text = tx(key); f = F(120); d0 = ImageDraw.Draw(Image.new("RGBA", (10, 10))); w = int(d0.textlength(text, font=f)) + 120
    im = Image.new("RGBA", (w + 40, 230), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for dx, dy in ((4, 4), (-2, 3)): d.text((50 + dx, 80 + dy), text, font=f, fill=(0, 0, 0, 200), anchor="lm")
    d.text((50, 80), text, font=f, fill=(255, 226, 120, 255), anchor="lm", stroke_width=3, stroke_fill=(70, 38, 0, 255))
    d.rounded_rectangle((50, 165, 50 + w - 100, 175), radius=5, fill=(255, 205, 90, 255))
    if tag: d.text((50, 205), tag, font=F(36), fill=(255, 255, 255, 235), anchor="lm")
    out = f"{WD}/low_{name}.png"; im.save(out); return out, im.width, im.height

# ---------------------------------------------------------------- shots and segments
X_FAST = ["-c:v", "libx264", "-crf", "13", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an"]
X_FINAL = ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-an"]
_n = [0]
def shot(src, ss, dur, speed=1.0, zoom=None):
    """one continuous piece of a recording: src window [ss, ss+dur*speed] shown over dur seconds; zoom = (z0, z1, ax, ay): a slow push-in (anchor x,y as fractions of the picture)"""
    _n[0] += 1; out = f"{WD}/p{_n[0]:03d}.mp4"; n = int(round(dur * FPS))
    vf = f"setpts=PTS/{speed},fps={FPS},scale={W}:{H}:flags=lanczos,eq=contrast=1.04:saturation=1.08"
    if zoom:
        z0, z1, ax, ay = zoom
        vf += f",scale={W*2}:{H*2}:flags=bicubic,zoompan=z='{z0}+({z1}-{z0})*on/{max(1, n - 1)}':x='(iw-iw/zoom)*{ax}':y='(ih-ih/zoom)*{ay}':d=1:s={W}x{H}:fps={FPS}"
    run(["ffmpeg", "-y", "-ss", f"{max(0, ss):.3f}", "-t", f"{dur * speed:.3f}", "-i", src, "-vf", vf, "-frames:v", str(n), *X_FAST, out]); return out, dur
def still(png, dur, zoom=(1.0, 1.06, 0.5, 0.5)):
    _n[0] += 1; out = f"{WD}/p{_n[0]:03d}.mp4"; n = int(round(dur * FPS)); z0, z1, ax, ay = zoom
    run(["ffmpeg", "-y", "-framerate", str(FPS), "-loop", "1", "-i", png, "-vf", f"scale={W*2}:{H*2}:flags=lanczos,zoompan=z='{z0}+({z1}-{z0})*on/{max(1, n - 1)}':x='(iw-iw/zoom)*{ax}':y='(ih-ih/zoom)*{ay}':d=1:s={W}x{H}:fps={FPS}", "-frames:v", str(n), *X_FAST, out]); return out, dur
def sc(scene, mark, off=0.0):   # a time in a recorded scene: the mark + an offset
    return META[scene]["marks"][mark] + off
def rec(scene, mark, off, dur, speed=1.0, zoom=None): return shot(META[scene]["file"], sc(scene, mark, off), dur, speed, zoom)
def old(ci, kind, dur, zoom=None):   # the match clips of the first video: the break (starts 1.2 s before it) or an aimed shot (1.4 s before)
    m = OLD[ci]; k = 0 if kind == "break" else 1; return shot(m["file"], max(0.2, m["marks"][k] - (1.2 if kind == "break" else 1.4)), dur, 1.0, zoom)
def concat(pieces, name):
    lst = f"{WD}/{name}.txt"; open(lst, "w").write("".join(f"file '{p}'\n" for p, _ in pieces)); out = f"{WD}/{name}.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out]); return out, sum(d for _, d in pieces)
def overlay_chips(seg, name, items):
    """items: [(png, w, h, x, y, t_in, t_out)] -> the segment with the chips faded in and out"""
    if not items: return seg
    src, dur = seg; out = f"{WD}/{name}_c.mp4"; cmd = ["ffmpeg", "-y", "-i", src]; flt = []; last = "[0:v]"
    for i, (png, w, h, x, y, a, b) in enumerate(items, 1):
        cmd += ["-loop", "1", "-t", f"{dur:.2f}", "-i", png]
        flt.append(f"[{i}:v]format=rgba,fade=t=in:st={a:.2f}:d=0.28:alpha=1,fade=t=out:st={max(a + 0.3, b - 0.28):.2f}:d=0.28:alpha=1[c{i}]")
        flt.append(f"{last}[c{i}]overlay=x={x}:y={y}:shortest=1[o{i}]"); last = f"[o{i}]"
    run(cmd + ["-filter_complex", ";".join(flt), "-map", last, "-t", f"{dur:.2f}", "-r", str(FPS), *X_FAST, out]); return out, dur
def seg(name, pieces, chips=(), lows=()):
    s = concat(pieces, name) if len(pieces) > 1 else pieces[0]; items = []
    for key, a, b, *o in chips:   # (key, t_in, t_out[, sub_key[, position: 'bottom' (default, small) | 'top' | 'mid' (big)]])
        sub = o[0] if len(o) > 0 else None; pos = o[1] if len(o) > 1 else "bottom"; big = pos != "bottom"
        png, w, h = chip_png(key, f"{name}_{key}", sub, big); y = {"bottom": H - h - 34, "top": 60, "mid": 330}[pos]; items.append((png, w, h, (W - w) // 2, y, a, b))
    for key, a, b, tag in lows:
        png, w, h = lower_png(key, f"{name}_{key}", tag); items.append((png, w, h, 90, H - h - 90, a, b))
    return overlay_chips(s, name, items)

def vip_card(dur):   # "VIP CUES": a blurred, darkened page of the VIP window behind a big gold title
    frame = f"{WD}/vipbg.png"; run(["ffmpeg", "-y", "-ss", f"{META['vip']['marks']['champion'] + 1.0:.2f}", "-i", META["vip"]["file"], "-frames:v", "1", frame])
    bg = Image.open(frame).convert("RGB").resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(16)); bg = Image.eval(bg, lambda v: int(v * 0.42)).convert("RGBA")
    vg = Image.new("L", (W, H), 0); ImageDraw.Draw(vg).ellipse((-W * .25, -H * .35, W * 1.25, H * 1.35), fill=255); vg = vg.filter(ImageFilter.GaussianBlur(160)); dark = Image.new("RGBA", (W, H), (0, 0, 0, 200)); bg = Image.composite(bg, dark, vg)
    text = tx("vip"); f = F(250); mask = Image.new("L", (W, H), 0); dm = ImageDraw.Draw(mask); dm.text((W // 2, 450), text, font=f, fill=255, anchor="mm", stroke_width=4, stroke_fill=255)
    glow = mask.filter(ImageFilter.GaussianBlur(34)).point(lambda v: min(255, int(v * 1.1))); gl = Image.new("RGBA", (W, H), (255, 176, 40, 0)); gl.putalpha(glow); bg.alpha_composite(gl)
    grad = Image.new("RGBA", (W, H)); gd = ImageDraw.Draw(grad)
    for y in range(H): k = min(1, max(0, (y - 320) / 260)); gd.line((0, y, W, y), fill=(int(255 - 40 * k), int(244 - 90 * k), int(176 - 120 * k), 255))
    edge = Image.new("L", (W, H), 0); ImageDraw.Draw(edge).text((W // 2, 450), text, font=f, fill=255, anchor="mm", stroke_width=14, stroke_fill=255)
    brown = Image.new("RGBA", (W, H), (84, 44, 0, 255)); brown.putalpha(edge); bg.alpha_composite(brown); grad.putalpha(mask); bg.alpha_composite(grad)
    d = ImageDraw.Draw(bg); sub = tx("vip_sub"); fs = F(58); wsub = d.textlength(sub, font=fs) + 100
    d.rounded_rectangle((W / 2 - wsub / 2, 640, W / 2 + wsub / 2, 730), radius=45, fill=(8, 10, 30, 215), outline=(255, 205, 90, 255), width=4); d.text((W / 2, 685), sub, font=fs, fill=(255, 255, 255, 255), anchor="mm")
    png = f"{WD}/vipcard.png"; bg.convert("RGB").save(png, quality=95); return still(png, dur, (1.0, 1.07, 0.5, 0.45))
def endcard(dur):
    R = ROOT + "/art/"; bg = Image.open(R + "login_bg_istanbul.webp").convert("RGB"); lg = Image.open(R + "login_logo.webp").convert("RGBA")
    k = max(W / bg.width, H / bg.height); bg = bg.resize((round(bg.width * k), round(bg.height * k)), Image.LANCZOS)
    im = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H)).convert("RGBA"); im.alpha_composite(Image.new("RGBA", (W, H), (4, 6, 20, 130)))
    wd = 1200; l = lg.resize((wd, round(lg.height * wd / lg.width)), Image.LANCZOS); pad = 90
    big = Image.new("L", (l.width + 2 * pad, l.height + 2 * pad), 0); big.paste(l.split()[3], (pad, pad)); a = big.filter(ImageFilter.GaussianBlur(28)).point(lambda v: v * 0.8)
    sh = Image.new("RGBA", big.size, (255, 190, 60, 0)); sh.putalpha(a); cy = 470
    im.alpha_composite(sh, (W // 2 - big.width // 2, cy - big.height // 2)); im.alpha_composite(l, (W // 2 - l.width // 2, cy - l.height // 2))
    dr = ImageDraw.Draw(im); f = F(60); t = tx("end")
    dr.text((W // 2 + 3, 870 + 3), t, font=f, fill=(0, 0, 0, 200), anchor="mm"); dr.text((W // 2, 870), t, font=f, fill=(255, 255, 255, 255), anchor="mm")
    png = f"{WD}/end.png"; im.convert("RGB").save(png, quality=95); return still(png, dur, (1.0, 1.04, 0.5, 0.5))

CH = []
def add(c, trans="fade", td=0.3): CH.append((c[0], c[1], trans, td))
def starts():   # where every clip starts on the final timeline (the music uses the VIP start and the end card start)
    t = 0.0; out = []
    for i, (p, d, tr, td) in enumerate(CH): t = t - td if i else 0.0; out.append((os.path.basename(p), round(t, 2))); t += d
    return out
def render(out):
    cmd = ["ffmpeg", "-y"]; flt = []; prev = "[0:v]"; cum = CH[0][1]
    for p, d, tr, td in CH: cmd += ["-i", p]
    for i in range(1, len(CH)):
        p, d, tr, td = CH[i]; off = cum - td; o = f"[v{i}]"; flt.append(f"{prev}[{i}:v]xfade=transition={tr}:duration={td}:offset={off:.3f}{o}"); prev = o; cum += d - td
    flt.append(f"{prev}fade=t=in:st=0:d=0.35,fade=t=out:st={cum - 0.7:.3f}:d=0.7[vout]")
    run(cmd + ["-filter_complex", ";".join(flt), "-map", "[vout]", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", str(FPS), out]); print("total", round(cum, 2), "s ->", out); return cum

if __name__ == "__main__":
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "storyboard.py")).read())
