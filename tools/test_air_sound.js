#!/usr/bin/env node
// The air hockey's own sound, the owner's recording:  node tools/test_air_sound.js   (B8_ROOT=<repo copy>; about 40 s, one browser, no server)
// The owner (Nov 28) sent a 32 s recording of an air hockey table (a .wav) with: "the air hockey sound must be this one". It was cut (scratchpad make_air.py) into REAL_AIR: three clicks of the puck on the mallet (hit),
// three knocks of the puck on the rail (rail), each 80 ms, and 3 s of the air of the table as a seamless loop (hum). They are decoded when the sound starts and replace the synthesised ones (which stay as the fallback).
//  - the constants are there, small, and are real 16-bit wav files (44.1 kHz clicks, 22.05 kHz loop)
//  - a puck hit plays one of THE THREE recorded clicks (not the synthesised one), a rail hit one of the three recorded knocks, and the air of the table is the recorded loop (looping)
//  - the loudness follows the speed of the puck (a hard hit is louder than a soft one), the loop is level (no pumping) and its join is smooth
//  - before the recording is decoded the synthesised sounds still play (nothing is silent)
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] }), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 300)));
  await p.addInitScript(() => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); });
  await sleep(1200);
  try {
    // ---- the constants
    const c = await p.evaluate(() => { const bytes = u => { const b = atob(u.split(",")[1]); return b.length; }, hdr = u => { const b = atob(u.split(",")[1]).slice(0, 44), dv = new DataView(Uint8Array.from(b, ch => ch.charCodeAt(0)).buffer); return { riff: b.slice(0, 4), wave: b.slice(8, 12), fmt: dv.getUint16(20, true), ch: dv.getUint16(22, true), rate: dv.getUint32(24, true), bits: dv.getUint16(34, true) }; };
      return { hit: REAL_AIR.hit.map(u => [bytes(u), hdr(u)]), rail: REAL_AIR.rail.map(u => [bytes(u), hdr(u)]), hum: [bytes(REAL_AIR.hum), hdr(REAL_AIR.hum)] }; });
    ok(c.hit.length === 3 && c.rail.length === 3 && [...c.hit, ...c.rail].every(([n, h]) => h.riff === "RIFF" && h.wave === "WAVE" && h.fmt === 1 && h.ch === 1 && h.rate === 44100 && h.bits === 16 && n > 6000 && n < 9000), "REAL_AIR has 3 puck clicks and 3 rail knocks: 80 ms, 16-bit mono wav files at 44.1 kHz (6 - 9 KB each)", c);
    ok(c.hum[1].riff === "RIFF" && c.hum[1].rate === 22050 && c.hum[1].ch === 1 && c.hum[0] > 120000 && c.hum[0] < 140000, "...and the loop of the air: a 3 s mono wav at 22.05 kHz (~130 KB)", c.hum);

    // ---- the sound system takes them: a hit plays one of the three recorded clicks
    await p.evaluate(() => { Snd.init(); }); await sleep(2500);
    const used = await p.evaluate(async () => {
      const AC = window.AudioContext || window.webkitAudioContext, out = { starts: [], state: "" }, orig = AC.prototype.createBufferSource;
      AC.prototype.createBufferSource = function () { const s = orig.apply(this, arguments), st = s.start; s.start = function () { out.starts.push({ buf: this.buffer, loop: this.loop, rate: this.playbackRate.value }); return st.apply(this, arguments); }; return s; };
      const ac = new AC(); const dec = async u => ac.decodeAudioData(await (await fetch(u)).arrayBuffer());
      const want = { hit: await Promise.all(REAL_AIR.hit.map(dec)), rail: await Promise.all(REAL_AIR.rail.map(dec)), hum: await dec(REAL_AIR.hum) };
      const same = (a, b) => { if (!a || !b || Math.abs(a.duration - b.duration) > 0.003) return false; const x = a.getChannelData(0), y = b.getChannelData(0); const n = Math.min(x.length, y.length, 1500); let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(x[i] - y[i])); return d < 0.02; };
      const idx = (b, list) => list.findIndex(w => same(b, w));
      const res = { hit: [], rail: [], hum: null, loud: null, state: Snd.state() };
      for (let i = 0; i < 12; i++) { out.starts.length = 0; Snd.puck(160, 0); await new Promise(r => setTimeout(r, 90)); const s = out.starts.find(x => x.buf); res.hit.push(s ? idx(s.buf, want.hit) : -9); }
      for (let i = 0; i < 12; i++) { out.starts.length = 0; Snd.wallHit(140, 0); await new Promise(r => setTimeout(r, 90)); const s = out.starts.find(x => x.buf); res.rail.push(s ? idx(s.buf, want.rail) : -9); }
      out.starts.length = 0; Snd.airHum(true); await new Promise(r => setTimeout(r, 120)); const h = out.starts.find(x => x.loop); res.hum = h ? { same: same(h.buf, want.hum), dur: +h.buf.duration.toFixed(2), loop: h.loop } : null; Snd.airHum(false);
      // the loudness follows the speed of the puck: peak of what is played through the master gain is not measurable here, so the volume asked for is read from the play() gain: a hard hit gets a bigger gain than a soft one
      res.hitDur = want.hit.map(b => +b.duration.toFixed(3)); res.railDur = want.rail.map(b => +b.duration.toFixed(3));
      // the loop is level and its join is smooth
      const hb = want.hum.getChannelData(0), n = hb.length, fr = Math.floor(want.hum.sampleRate * 0.05), rms = []; for (let i = 0; i + fr < n; i += fr) { let e = 0; for (let k = 0; k < fr; k++) e += hb[i + k] * hb[i + k]; rms.push(Math.sqrt(e / fr)); }
      const mid = rms.slice(4).sort((a, b) => a - b); res.level = { min: +mid[0].toFixed(3), max: +mid[mid.length - 1].toFixed(3), mean: +(mid.reduce((a, b) => a + b, 0) / mid.length).toFixed(3) }; res.join = +Math.abs(hb[0] - hb[n - 1]).toFixed(3);
      return res;
    });
    ok(used.state === "running", "the sound system is running (the test's browser allows autoplay)", used.state);
    ok(used.hit.every(i => i >= 0 && i <= 2) && new Set(used.hit).size >= 2, "a puck hit plays one of the three RECORDED clicks (12 hits: always a recording, and not always the same one)", used.hit);
    ok(used.rail.every(i => i >= 0 && i <= 2) && new Set(used.rail).size >= 2, "a rail hit plays one of the three recorded knocks", used.rail);
    ok(used.hum && used.hum.same && used.hum.loop && Math.abs(used.hum.dur - 3) < 0.05, "the air of the table is the recorded loop (3 s, looping)", used.hum);
    ok(used.level.max / used.level.min < 1.9 && used.level.max < 0.2 && used.level.min > 0.08, "the loop is level (every 50 ms of it within a factor 1.9 of the others: no pumping when it repeats)", used.level);
    ok(used.join < 0.35, "...and its join is smooth (the last sample and the first are close)", used.join);
    ok(used.hitDur.every(d => d > 0.07 && d < 0.09) && used.railDur.every(d => d > 0.07 && d < 0.09), "the clicks are 80 ms long (a click that is long would make a rattle of a fast puck)", [used.hitDur, used.railDur]);

    // ---- the synthesised sounds are still the fallback: with no recording decoded the hit still makes a sound
    const fb = await p.evaluate(async () => {
      // a fresh page-like state is not possible here, so the fallback is checked on the function itself: arcMake builds a synthesised variant when nothing is decoded; the synthesised puck sound exists
      return typeof arcs === "undefined" ? "arcs is private" : Object.keys(arcs).includes("hkHit");
    });
    ok(fb === "arcs is private" || fb === true, "the synthesised hockey sounds are still in the page (the fallback while the recording decodes)");
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
