import json, subprocess, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
SP = os.path.dirname(os.path.abspath(__file__)); ROOT = "/home/user/Ajal-yog-dusi"; os.makedirs(SP + "/seg", exist_ok=True)
meta = {m["ci"]: m for m in json.load(open(SP + "/clips/meta.json"))}
F = lambda s: ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Bold.otf", s)
def run(cmd): subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
X264 = ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-an"]
def clip(name, ci, kind, d):
    m = meta[ci]; k = 0 if kind == "break" else 1; st = max(0.2, m["marks"][k] - (1.2 if kind == "break" else 1.4))
    out = f"{SP}/seg/{name}.mp4"
    run(["ffmpeg", "-y", "-ss", f"{st:.2f}", "-t", str(d), "-i", m["file"], "-vf", "fps=30,scale=1920:1080:flags=lanczos,eq=contrast=1.04:saturation=1.08", *X264, out]); return out, d
def chip(png, text, y):
    im = Image.open(png).convert("RGBA"); d = ImageDraw.Draw(im); f = F(54); w = d.textlength(text, font=f) + 90; h = 100
    cx = 960; d.rounded_rectangle((cx - w / 2, y - h / 2, cx + w / 2, y + h / 2), radius=50, fill=(14, 18, 52, 225), outline=(255, 205, 90, 255), width=4)
    d.text((cx, y), text, font=f, fill=(255, 236, 170, 255), anchor="mm"); o = png.replace(".png", "_c.png"); im.convert("RGB").save(o, quality=95); return o
def still(name, png, d, text=None, zoom=0.07):
    src = chip(png, text, 120) if text else png; out = f"{SP}/seg/{name}.mp4"; n = int(d * 30)
    run(["ffmpeg", "-y", "-framerate", "30", "-loop", "1", "-i", src, "-vf",
         f"scale=3840:2160:flags=lanczos,zoompan=z='1+{zoom}*on/{n}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30", "-t", str(d), *X264, out]); return out, d
def endcard(name, d):
    R = ROOT + "/art/"; bg = Image.open(R + "login_bg_istanbul.webp").convert("RGB"); lg = Image.open(R + "login_logo.webp").convert("RGBA")
    W, H = 1920, 1080; k = max(W / bg.width, H / bg.height); bg = bg.resize((round(bg.width * k), round(bg.height * k)), Image.LANCZOS)
    im = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H)).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (4, 6, 20, 130)); im.alpha_composite(ov)
    wd = 1200; l = lg.resize((wd, round(lg.height * wd / lg.width)), Image.LANCZOS); pad = 90
    big = Image.new("L", (l.width + 2 * pad, l.height + 2 * pad), 0); big.paste(l.split()[3], (pad, pad)); a = big.filter(ImageFilter.GaussianBlur(28)).point(lambda v: v * 0.8)
    sh = Image.new("RGBA", big.size, (255, 190, 60, 0)); sh.putalpha(a); cy = 470
    im.alpha_composite(sh, (W // 2 - big.width // 2, cy - big.height // 2)); im.alpha_composite(l, (W // 2 - l.width // 2, cy - l.height // 2))
    dr = ImageDraw.Draw(im); f = F(60); t = "Challenge players worldwide"
    dr.text((W // 2 + 3, 870 + 3), t, font=f, fill=(0, 0, 0, 200), anchor="mm"); dr.text((W // 2, 870), t, font=f, fill=(255, 255, 255, 255), anchor="mm")
    png = f"{SP}/seg/end.png"; im.convert("RGB").save(png, quality=95); return still(name, png, d, None, 0.04)
T = ROOT + "/../tmp"  # unused
shots = lambda n: f"{SP}/s_{n}.png"
segs = [clip("s1", 0, "break", 3.2), clip("s2", 3, "break", 3.2), clip("s3", 5, "break", 3.2), clip("s4", 7, "aim", 3.4), clip("s5", 1, "break", 3.2), clip("s6", 3, "aim", 3.4),
        still("u1", shots("shop"), 2.9, "Collect legendary cues", 0.05), still("u2", shots("home"), 2.9, "1 on 1 • Cups • Events • Friends", 0.05), endcard("end", 3.4)]
# crossfade chain
FADE = 0.3; cmd = ["ffmpeg", "-y"]
for p, d in segs: cmd += ["-i", p]
flt = []; prev = "[0:v]"; off = 0.0
for i in range(1, len(segs)):
    off += segs[i - 1][1] - FADE; out = f"[v{i}]"; flt.append(f"{prev}[{i}:v]xfade=transition=fade:duration={FADE}:offset={off:.2f}{out}"); prev = out
total = off + segs[-1][1]
flt.append(f"{prev}fade=t=in:st=0:d=0.4,fade=t=out:st={total - 0.6:.2f}:d=0.6[vout]")
cmd += ["-filter_complex", ";".join(flt), "-map", "[vout]", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30", sys.argv[1] if len(sys.argv) > 1 else SP + "/promo_draft.mp4"]
run(cmd); print("total", round(total, 1), "s")
