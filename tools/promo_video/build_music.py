#!/usr/bin/env python3
# A short original music bed for the promo video, made from scratch with numpy (synthesised drums, bass, pads, plucks, a riser and impacts - no samples, nothing copied, so nobody's licence is involved).
# usage: PYTHONPATH=<numpy dir> python3 build_music.py OUT.wav TOTAL_SECONDS DROP_SECONDS END_SECONDS
#   DROP_SECONDS: where the big moment starts (the VIP-cue ad), END_SECONDS: where the end card starts. The tempo is picked so that both land on a bar line.
import sys, wave
import numpy as np
out, TOTAL, DROP, END = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
SR = 44100; N = int(TOTAL * SR); rng = np.random.default_rng(11)
bars_drop = max(8, round(DROP / 1.9)); BAR = DROP / bars_drop; BEAT = BAR / 4; BPM = 60 / BEAT        # the bar length that puts DROP on a bar line (~124 bpm)
L = np.zeros(N + SR * 4); R = np.zeros(N + SR * 4); WL = np.zeros_like(L); WR = np.zeros_like(R)    # dry and "wet" (reverb) buses
T = lambda s: np.arange(int(s * SR)) / SR
def put(sig, t, g=1.0, pan=0.0, wet=0.0):
    i = int(t * SR)
    if i < 0 or i >= N: return
    sig = sig[: len(L) - i]; gl, gr = g * np.cos((pan + 1) * np.pi / 4), g * np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gl; R[i:i + len(sig)] += sig * gr
    if wet: WL[i:i + len(sig)] += sig * gl * wet; WR[i:i + len(sig)] += sig * gr * wet
def fft_band(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X[(f < lo) | (f > hi)] = 0; return np.fft.irfft(X, len(x))
def kick():
    t = T(0.5); f = 42 + 120 * np.exp(-t * 30); ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 8.5) + 0.25 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 180)) * 0.95
def clap():
    t = T(0.3); n = fft_band(rng.standard_normal(len(t)), 900, 6500); e = sum(np.exp(-np.maximum(t - d, 0) * k) * (t >= d) for d, k in ((0, 90), (0.011, 90), (0.022, 90), (0.034, 22)))
    return n * e * 0.42
def hat(open_=False):
    t = T(0.25 if open_ else 0.06); n = np.diff(np.concatenate([[0], rng.standard_normal(len(t))])); n = np.diff(np.concatenate([[0], n])); return n * np.exp(-t * (16 if open_ else 70)) * 0.11
def saw(f, t, hmax):
    return sum(np.sin(2 * np.pi * f * h * t + h) / h for h in range(1, max(2, min(hmax, int(14000 / f)))))
def bass(f, d):
    t = T(d); e = np.minimum(1, t / 0.006) * np.exp(-t * 3.2) * np.minimum(1, (d - t) / 0.03)
    return np.tanh(2.2 * (0.55 * saw(f, t, 14) / 2.2 + 0.7 * np.sin(2 * np.pi * f * t))) * e * 0.5
def pad(freqs, d):
    t = T(d); e = np.minimum(1, t / 0.45) * np.minimum(1, (d - t) / 0.5); s = np.zeros(len(t))
    for f in freqs:
        for c in (-9, 0, 9): s += saw(f * 2 ** (c / 1200), t, 18) * 0.07
    return s * e
def pluck(f, d=0.5):
    t = T(d); return (saw(f, t, 8) * 0.5 + np.sign(np.sin(2 * np.pi * f * t)) * 0.18) * np.exp(-t * 9) * 0.35
def riser(d):
    t = T(d); base = rng.standard_normal(len(t)); outn = np.zeros(len(t)); k = 7
    for i in range(k):
        lo = 300 * 1.7 ** i; band = fft_band(base, lo, lo * 2.4); w = np.clip((t / d) * k - i, 0, 1) * np.clip(1.6 - ((t / d) * k - i) * 0.5, 0, 1); outn += band * w * 0.45
    sweep = np.sin(2 * np.pi * np.cumsum(180 + 2400 * (t / d) ** 2) / SR) * 0.12
    return (outn + sweep) * (t / d) ** 1.6 * 0.6
def impact():
    t = T(2.2); boom = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 1.4) + 28) / SR) * np.exp(-t * 2.2); nz = fft_band(rng.standard_normal(len(t)), 80, 2500) * np.exp(-t * 6) * 0.6
    return (boom * 0.95 + nz) * 0.95
HZ = lambda n: 440.0 * 2 ** ((n - 69) / 12)
CH = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [48, 52, 55]), (55, [55, 59, 62])]   # Am, F, C, G: bass note + chord
def lead(f, d):
    t = T(d); e = np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.12); tt = t + 0.0012 * np.sin(2 * np.pi * 5.5 * t)      # (vibrato: a slightly wobbling clock)
    return np.tanh(1.8 * saw(f, tt, 10) * 0.35) * e * 0.38
nbars = int(np.ceil(TOTAL / BAR)); K, C, H, HO = kick(), clap(), hat(), hat(True)
secA, secB = BAR * 2, BAR * 10        # the groove starts after 2 bars, the plucked arpeggio joins at bar 10; the last 2 bars before the drop are the build (riser, snare roll, no kick)
for b in range(nbars):
    t0 = b * BAR; root, chord = CH[b % 4]
    if t0 >= END + BAR: break
    on = secA <= t0 < END; pre = DROP - 2 * BAR <= t0 < DROP; drop = DROP <= t0 < END
    put(pad([HZ(n + 12) for n in chord], BAR * 1.02), t0, 0.62 if drop else 0.5, -0.1, 0.55)
    if t0 < secA and b == 1:                                                   # the intro: a few soft hats lead into the groove
        for q in range(4): put(H, t0 + q * BEAT, 0.35, 0.2)
    if not on: continue
    for q in range(4):
        tb = t0 + q * BEAT
        put(H, tb + BEAT / 2, 0.6, 0.25)
        if q % 2: put(H, tb, 0.28, -0.25)
        if pre: continue
        put(K, tb, 0.85)
        if q in (1, 3): put(C, tb, 0.7, 0.05, 0.25)
        if q in (0, 2): put(HO, tb + BEAT * 0.75, 0.5, -0.2)
    if not pre:
        for i, p in enumerate((0, 0.5, 0.75, 1.5, 2, 2.5, 3.25)): put(bass(HZ(root - 12 if i % 2 == 0 else root), BEAT * 0.45), t0 + p * BEAT, 0.8)
        if t0 >= secB:
            for q in range(16): put(pluck(HZ(chord[[0, 1, 2, 1][q % 4]] + 12 * (2 + (q // 4) % 2))), t0 + q * BEAT / 4, 0.42 if not drop else 0.5, -0.5 + 0.1 * (q % 8), 0.5)
    if drop:
        mel = [(0, 69, 1.5), (1.5, 72, 0.5), (2, 76, 1), (3, 74, 1)] if b % 2 == 0 else [(0, 72, 1.5), (1.5, 71, 0.5), (2, 67, 1), (3, 69, 1)]
        for p, n, d in mel: put(lead(HZ(n + 12 * (1 if b % 4 > 1 else 0)), d * BEAT), t0 + p * BEAT, 0.8, 0.0, 0.45)
    if pre:                                                                    # the snare roll into the drop: 8 hits, then 16
        n = 16 if t0 >= DROP - BAR else 8
        for q in range(n): put(C, t0 + q * BAR / n, 0.25 + 0.5 * q / n)
put(riser(2 * BAR), DROP - 2 * BAR, 0.55, 0.0, 0.3)
for t in (0.0, DROP, END): put(impact(), t, 0.85, 0.0, 0.5)
put(pad([HZ(n + 12) for n in (57, 60, 64, 69)], 4.5), END, 0.7, 0.0, 0.7)         # the end card: one long chord
# reverb bus: a decaying noise tail
ir = T(1.7); irl, irr = rng.standard_normal(len(ir)) * np.exp(-ir * 2.6), rng.standard_normal(len(ir)) * np.exp(-ir * 2.6); n = 1 << int(np.ceil(np.log2(len(L) + len(ir))))
def conv(x, h): return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[: len(x)]
L += conv(WL, irl) * 0.08; R += conv(WR, irr) * 0.08
# a pumping duck on everything but the kick is not needed here (the kick sits on top); master: soft clip, fades, normalise
mix = np.stack([L[:N], R[:N]], 1); fade = np.ones(N); fi, fo = int(0.02 * SR), int(2.2 * SR); fade[-fo:] = np.linspace(1, 0, fo) ** 1.5; mix *= fade[:, None]
mix = np.tanh(mix * 1.1); mix *= 0.89 / max(1e-6, np.abs(mix).max())
w = wave.open(out, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype("<i2").tobytes()); w.close()
print(f"wrote {out}: {TOTAL:.1f}s, {BPM:.1f} bpm, bar {BAR:.3f}s, drop at bar {bars_drop}")
