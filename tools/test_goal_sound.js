#!/usr/bin/env node
// The air hockey GOAL sound:  node tools/test_goal_sound.js   (B8_ROOT=<repo copy>; about 30 s, one browser, no server)
// The owner (Nov 28, 18:43, a screenshot of the table): "a strange trilling sound comes out when a goal is scored".
// Measured on the recording of what the page really sent to the speakers: the old goal was a low thud, then FIVE rattling clicks (0.19 - 0.4 s) on top of a chord of three saw / square oscillators that
// each slid down by a different amount (196 -> 190, 294 -> 288, 392 -> 388 Hz: their harmonics drift past each other and beat at 6 - 10 Hz = a warble), plus a band of noise sweeping up; the whole thing
// died away in 0.4 s (level wobble 15 %, 7 clicks). Now: ONE soft thud and ONE steady horn (two notes a fifth apart and their octave = 2 : 3 : 4 of one pitch, every partial an exact multiple of it, no slide,
// no noise, no clicks; a soft start, a steady blast, a smooth end), one prepared buffer (`hkGoal`), no oscillators.
//  - Snd.horn() starts exactly ONE buffer (the goal, 1 - 1.2 s) and NO oscillator and no noise (the old goal started 3 oscillators + a noise burst)
//  - the blast is steady (its level over 3-period windows within 8 %), strictly periodic (the wave repeats every 1/131 s: nothing beats), has no click (no jump bigger than the wave's own), starts and ends smoothly
//  - its energy is below 2.5 kHz (a warm horn, not a buzz), the thud is low (most of its energy under 300 Hz), the end of the buffer is silent
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
function fft(re, im) {   // in place, radix 2
  const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
const share = (x, from, to, SR, lo, hi) => { const n = 16384, m = Math.min(n, to - from), re = new Float64Array(n), im = new Float64Array(n); for (let i = 0; i < m; i++) re[i] = (x[from + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / m));   // (only the part from..to, zero-padded)
   fft(re, im); let a = 0, b = 0; for (let k = 1; k < n / 2; k++) { const f = k * SR / n, e = re[k] * re[k] + im[k] * im[k]; b += e; if (f >= lo && f < hi) a += e; } return a / b; };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] }), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 300)));
  await p.addInitScript(() => {
    window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" }));
    window.__bufs = []; window.__rec = { on: false, osc: 0, src: [] };
    const cb = BaseAudioContext.prototype.createBuffer; BaseAudioContext.prototype.createBuffer = function (...a) { const x = cb.apply(this, a); window.__bufs.push(x); return x; };
    const co = BaseAudioContext.prototype.createOscillator; BaseAudioContext.prototype.createOscillator = function () { const o = co.apply(this, arguments); const st = o.start; o.start = function () { if (window.__rec.on) window.__rec.osc++; return st.apply(this, arguments); }; return o; };
    const cs = BaseAudioContext.prototype.createBufferSource; BaseAudioContext.prototype.createBufferSource = function () { const s = cs.apply(this, arguments); const st = s.start; s.start = function () { if (window.__rec.on) window.__rec.src.push({ dur: this.buffer ? +this.buffer.duration.toFixed(3) : -1, rate: this.playbackRate.value, loop: this.loop }); return st.apply(this, arguments); }; return s; };
  });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); });
  await p.mouse.click(200, 200); await sleep(300);
  try {
    await p.evaluate(() => { Snd.init(); }); await sleep(2500);
    ok((await p.evaluate(() => Snd.state())) === "running", "the sound system is running");
    await p.evaluate(() => { try { Snd.arcWarm(); } catch (e) {} }); await sleep(2500);

    // ---- what one goal starts
    await p.evaluate(() => { window.__rec.on = true; window.__rec.osc = 0; window.__rec.src = []; Snd.horn(); }); await sleep(400);
    const r = await p.evaluate(() => { window.__rec.on = false; return window.__rec; });
    ok(r.src.length === 1 && r.src[0].dur > 1 && r.src[0].dur < 1.2 && !r.src[0].loop, "one goal starts ONE prepared buffer of about 1 s (the thud and the horn together)", r.src);
    ok(r.osc === 0, "...and no oscillator (the old goal started 3: a saw chord that slid by different amounts = a warble) and no noise burst", r.osc);
    await p.evaluate(() => { window.__rec.on = true; window.__rec.src = []; Snd.horn(); Snd.horn(); Snd.horn(); }); await sleep(300);
    const r3 = await p.evaluate(() => { window.__rec.on = false; return window.__rec.src.length; });
    ok(r3 === 3, "each goal makes exactly one sound (three goals, three buffers)", r3);

    // ---- the buffer
    const d = await p.evaluate(() => { const bf = window.__bufs.filter(x => Math.abs(x.duration - 1.08) < 0.01)[0]; return bf ? { rate: bf.sampleRate, x: Array.from(bf.getChannelData(0)) } : null; });
    ok(!!d, "the goal buffer is there (1.08 s)");
    const x = d.x, SR = d.rate, at = t => Math.round(t * SR), peak = Math.max(...x.map(Math.abs)), f0 = 131, per = SR / f0;
    ok(peak > 0.5 && peak < 0.85, "its peak is moderate (a loud goal that does not clip)", +peak.toFixed(3));
    // the thud: the first 0.1 s is low
    ok(share(x, 0, at(0.1), SR, 0, 300) > 0.8, "the thud is LOW (over 80 % of its energy under 300 Hz: a soft 'tup', not a click)", +share(x, 0, at(0.1), SR, 0, 300).toFixed(3));
    // the horn: the steady part is 0.25 - 0.68 s (it starts at 0.11 s, holds, and its release begins at 0.71 s)
    const h0 = at(0.25), h1 = at(0.68);
    // steady: the rms over 3 periods stays within 8 % of the middle value
    const win = Math.round(3 * per), rms = []; for (let i = h0; i + win < h1; i += win) { let s = 0; for (let k = 0; k < win; k++) s += x[i + k] * x[i + k]; rms.push(Math.sqrt(s / win)); }
    const mid = rms.slice().sort((a, c) => a - c)[rms.length >> 1];
    ok(rms.every(v => Math.abs(v - mid) / mid < 0.08), "the blast is STEADY (its level over 3-period windows stays within 8 %: no wobble, no decay)", { mid: +mid.toFixed(3), min: +Math.min(...rms).toFixed(3), max: +Math.max(...rms).toFixed(3) });
    // periodic: the wave repeats every 1/131 s (linear interpolation of the half-sample lag)
    const lag = per, n = at(0.5) - at(0.3); let sxy = 0, sxx = 0, syy = 0; for (let i = at(0.3); i < at(0.3) + n; i++) { const j = i + lag, j0 = Math.floor(j), fr = j - j0, y = x[j0] * (1 - fr) + x[j0 + 1] * fr; sxy += x[i] * y; sxx += x[i] * x[i]; syy += y * y; }
    const ac = sxy / Math.sqrt(sxx * syy);
    ok(ac > 0.995, "the horn is strictly PERIODIC (it repeats every 1/131 s: every partial is an exact multiple of one pitch, so nothing beats against anything)", +ac.toFixed(5));
    // no click: no sample-to-sample jump bigger than the wave's own (measured in the clean middle)
    const jump = (a, c) => { let m = 0; for (let i = a; i < c; i++) m = Math.max(m, Math.abs(x[i + 1] - x[i])); return m; };
    const own = jump(at(0.4), at(0.6)), all = jump(at(0.2), at(0.95));
    ok(all <= own * 1.1, "no click anywhere in the blast (the biggest jump of the whole blast is the wave's own)", { own: +own.toFixed(3), all: +all.toFixed(3) });
    // warm: nearly all of the energy is under 2.5 kHz
    const lo = share(x, at(0.3), at(0.3) + 16384, SR, 0, 2500);   // (0.3 - 0.67 s of the blast)
    ok(lo > 0.97, "the horn is warm (over 97 % of its energy under 2.5 kHz: no buzz, no hiss)", +lo.toFixed(4));
    // soft start and a smooth end: the blast begins from silence (a 16 ms ramp) and fades out before the buffer ends
    let startMax = 0; for (let i = at(0.108); i < at(0.112); i++) startMax = Math.max(startMax, Math.abs(x[i]));
    ok(startMax < 0.15 * peak, "the horn starts softly (from silence, no pop)", +startMax.toFixed(3));
    let endMax = 0; for (let i = at(1.04); i < x.length; i++) endMax = Math.max(endMax, Math.abs(x[i]));
    ok(endMax < 0.01 * peak, "...and ends smoothly (the last 40 ms are silent)", +endMax.toFixed(4));
    let tailMax = 0; for (let i = at(0.955); i < at(0.975); i++) tailMax = Math.max(tailMax, Math.abs(x[i]));
    ok(tailMax < 0.1 * peak, "...the release fades to nothing (no cut-off)", +tailMax.toFixed(3));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
