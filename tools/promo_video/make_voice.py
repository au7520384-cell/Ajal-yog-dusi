#!/usr/bin/env python3
# Speech-like "microphone" files for the promo video (Chromium's --use-file-for-fake-audio-capture): bursts of voiced sound with pauses, so the lobby's speaking rings pulse like real talking.
# (The video has no sound track; only the rings matter.)  usage: make_voice.py OUT.wav SEED [SECONDS]
import sys, wave, math, random, struct
out, seed = sys.argv[1], int(sys.argv[2]); secs = float(sys.argv[3]) if len(sys.argv) > 3 else 40.0
rnd = random.Random(seed); sr = 48000; n = int(secs * sr); buf = [0.0] * n; t = 0.0
while t < secs - 1:
    for _ in range(rnd.randint(3, 7)):                                   # a phrase of 3-7 syllables
        d = rnd.uniform(0.11, 0.26); f0 = rnd.uniform(105, 210); f1 = f0 * rnd.uniform(0.85, 1.2); i0 = int(t * sr); m = int(d * sr)
        for i in range(m):
            if i0 + i >= n: break
            k = i / m; env = math.sin(math.pi * k) ** 1.5; f = f0 + (f1 - f0) * k; ph = 2 * math.pi * f * (i / sr)
            v = sum(math.sin(ph * h) / h ** 0.8 for h in range(1, 9)) * 0.28 + (rnd.random() - 0.5) * 0.10   # harmonics + a little breath
            buf[i0 + i] += v * env * 0.62
        t += d + rnd.uniform(0.02, 0.08)
    t += rnd.uniform(0.5, 1.3)                                           # a pause between phrases
pk = max(abs(x) for x in buf) or 1.0
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x / pk * 0.9)) * 32767)) for x in buf)); w.close(); print('wrote', out)
