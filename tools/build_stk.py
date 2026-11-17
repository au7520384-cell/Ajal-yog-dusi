#!/usr/bin/env python3
"""Voiced stickers (the owner, Nov 17: "stickers must have a sound, and move").
Every voiced sticker has a short recorded sound (made with an AI sound-effect model, then trimmed and levelled here); its picture moves with the loudness of that sound
(index.html: STK_VOX / STK_MOVE / stkMove, drawn in the match bubble) and a tap on it in the world chat plays it again.

    python3 tools/build_stk.py --import <dir>     process the raw sounds <dir>/<slug>_raw.mp3 -> art/stk/<slug>.mp3 (trim, level, fade, 22 kHz mono MP3 ~12 KB)
    python3 tools/build_stk.py                    write `const STK_VOX = {...}` into index.html from art/stk/manifest.json (the sounds are embedded like every other sound of the game;
                                                  tools/build_web.py moves them into a/<hash>.mp3 for the light build)
    python3 tools/build_stk.py --check            only say whether index.html is up to date (exit 1 when it is not)

art/stk/manifest.json:  {"<sticker emoji>": {"slug": "tiger", "move": "roar"}, ...}   (move = a key of STK_MOVE in index.html)
Needs ffmpeg (decode / encode); plain Python otherwise."""
import os, re, sys, json, base64, subprocess, array, math

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(root, "art", "stk")
SR = 22050                 # the stickers are short effects: 22 kHz mono is plenty and keeps a sound at ~12 KB
STEP = 0.05                # the loudness curve has one value per 50 ms (0-9)

def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    a = array.array("h"); a.frombytes(raw[: len(raw) // 2 * 2]); return a

def encode(samples, out):
    p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", "48k", "-ar", str(SR), "-ac", "1", out],
                       input=samples.tobytes(), capture_output=True)
    if p.returncode: sys.exit("ffmpeg could not encode " + out + ": " + p.stderr.decode()[-300:])

def process(raw_path, out_path):
    x = decode(raw_path); n = len(x); w = int(0.01 * SR)
    r = [math.sqrt(sum(v * v for v in x[i:i + w]) / max(1, len(x[i:i + w]))) for i in range(0, n, w)]   # loudness in 10 ms steps
    m = max(r) or 1.0
    s0 = next((i for i, v in enumerate(r) if v > 0.10 * m), 0); s1 = next((i for i in range(len(r) - 1, -1, -1) if r[i] > 0.04 * m), len(r) - 1)
    a = max(0, (s0 - 3) * w); b = min(n, (s1 + 13) * w)                    # 30 ms before the sound starts, 120 ms after it has faded: a faint hiss before / after is cut
    y = [float(v) for v in x[a:b]]
    rms = math.sqrt(sum(v * v for v in y) / max(1, len(y))) or 1.0; pk = max(abs(v) for v in y) or 1.0
    g = min(0.12 * 32768 / rms, 0.89 * 32768 / pk)          # the same loudness for every sticker (RMS -18 dBFS), never over -1 dBFS
    fi, fo = int(0.006 * SR), min(len(y) // 2, int(0.09 * SR))
    for i in range(len(y)):
        k = g
        if i < fi: k *= i / fi
        if i >= len(y) - fo: k *= (len(y) - i) / fo
        y[i] *= k
    out = array.array("h", [max(-32768, min(32767, int(round(v)))) for v in y]); encode(out, out_path)
    return len(y) / SR, g

def envelope(path):
    x = decode(path); w = int(STEP * SR); r = []
    for i in range(0, len(x), w):
        seg = x[i:i + w]; r.append(math.sqrt(sum(v * v for v in seg) / len(seg)) if seg else 0.0)
    r = [(r[max(0, i - 1)] + 2 * r[i] + r[min(len(r) - 1, i + 1)]) / 4 for i in range(len(r))]   # a little smoothing: the picture must not flicker
    m = max(r) or 1.0
    return "".join(str(min(9, int(round(v / m * 9)))) for v in r)

def build():
    man = json.load(open(os.path.join(ART, "manifest.json"), encoding="utf-8")); vox = {}
    for key, d in man.items():
        p = os.path.join(ART, d["slug"] + ".mp3")
        if not os.path.exists(p): sys.exit("missing " + p)
        vox[key] = {"u": "data:audio/mpeg;base64," + base64.b64encode(open(p, "rb").read()).decode(), "e": envelope(p), "m": d["move"]}
    return "const STK_VOX = " + json.dumps(vox, ensure_ascii=False, separators=(",", ":")) + ";"

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--import":
        d = sys.argv[2]; os.makedirs(ART, exist_ok=True)
        for f in sorted(os.listdir(d)):
            if f.endswith("_raw.mp3"):
                slug = f[:-8]; dur, g = process(os.path.join(d, f), os.path.join(ART, slug + ".mp3")); print("%-8s %.2fs  gain x%.2f -> art/stk/%s.mp3 (%d bytes)" % (slug, dur, g, slug, os.path.getsize(os.path.join(ART, slug + ".mp3"))))
        sys.exit(0)
    block = build(); path = os.path.join(root, "index.html"); s = open(path, encoding="utf-8").read()
    s2, n = re.subn(r"const STK_VOX = \{.*?\};\n", lambda m: block + "\n", s, count=1, flags=re.S)
    if n != 1: sys.exit("`const STK_VOX = {...};` not found in index.html")
    if "--check" in sys.argv: print("up to date" if s2 == s else "STALE: run python3 tools/build_stk.py"); sys.exit(0 if s2 == s else 1)
    if s2 != s: open(path, "w", encoding="utf-8").write(s2); print("STK_VOX written: %d sounds, %d bytes" % (block.count('"u":'), len(block)))
    else: print("STK_VOX already up to date")
