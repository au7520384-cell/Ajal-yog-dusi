#!/usr/bin/env node
// The cue seen from above:  node tools/test_cue_draw.js
// When the butt is raised (the "Kiy balandligi" slider of the spin screen) the stick has to stay ON the aim line behind the cue ball, keep (or gain) its thickness and only get shorter (never under half).
// It used to be sheared up the screen: it left the aim line and, at some angles, collapsed into a hair-thin line ("a picture, not a cue"). The transform the stick is drawn with is compared with the one of the
// flat cue (elevation 0) at the same angle, for 24 angles x 5 heights, on a wide and on a tall (portrait) screen.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8200"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  for (const [vw, vh] of [[844, 390], [390, 844]]) {
    const portrait = vh > vw, ctx0 = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: portrait, isMobile: portrait, locale: "en-US" }), p = await ctx0.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" })));
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto("http://localhost:8200/index.html", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(600);
    await p.evaluate(() => startMatch("practice", CITIES[0])); await sleep(3500);
    const r = await p.evaluate(() => {
      const G = game, bad = [], seen = []; let rec = null; const orig = window.drawCueStick;
      window.drawCueStick = function (g, L, cd, wm) { const m = g.getTransform(); rec = [m.a, m.b, m.c, m.d]; return orig.apply(this, arguments); };
      const get = (ang, el) => { G.angle = ang; G.elev = el; rec = null; drawCue(G, 0); return rec; };
      try {
        for (let k = 0; k < 24; k++) {
          const ang = -Math.PI + k * Math.PI / 12 + 0.07, T0 = get(ang, 0); if (!T0) { bad.push("no cue drawn at " + ang.toFixed(2)); continue; }
          const l0 = Math.hypot(T0[0], T0[1]), w0 = Math.hypot(T0[2], T0[3]), det0 = T0[0] * T0[3] - T0[1] * T0[2];
          for (const el of [0.2, 0.4, 0.6, 0.8, 1]) {
            const T = get(ang, el), tag = "angle " + ang.toFixed(2) + " height " + el; if (!T) { bad.push("no cue drawn at " + tag); continue; }
            const l = Math.hypot(T[0], T[1]), w = Math.hypot(T[2], T[3]), det = T[0] * T[3] - T[1] * T[2];
            const cross = (T0[0] * T[1] - T0[1] * T[0]) / (l0 * l), dot = (T0[0] * T[0] + T0[1] * T[1]) / (l0 * l);   // the same direction as the flat cue = the aim line
            const cross2 = (T0[2] * T[3] - T0[3] * T[2]) / (w0 * w), thick = det / det0;
            if (Math.abs(cross) > 1e-3 || dot < 0.999) bad.push(tag + ": the stick left the aim line (" + cross.toFixed(3) + ")");
            if (Math.abs(cross2) > 1e-3) bad.push(tag + ": the stick is sheared (" + cross2.toFixed(3) + ")");
            if (l / l0 < 0.499 || l / l0 > 1.001) bad.push(tag + ": length x" + (l / l0).toFixed(2));
            if (w / w0 < 0.999) bad.push(tag + ": thinner (x" + (w / w0).toFixed(2) + ")");
            if (!(thick > 0.45)) bad.push(tag + ": the stick is squeezed or mirrored (area x" + thick.toFixed(2) + ")");
            seen.push([l / l0, w / w0]);
          }
        }
      } finally { window.drawCueStick = orig; }
      const mn = a => Math.min(...a);
      return { n: seen.length, bad, minLen: mn(seen.map(s => s[0])), minThick: mn(seen.map(s => s[1])) };
    });
    console.log(`${vw}x${vh}: ${r.n} angle/height pairs, shortest stick x${r.minLen.toFixed(2)}, thinnest x${r.minThick.toFixed(2)}`);
    ok(r.n === 120 && r.bad.length === 0, `the raised cue is solid and on the aim line (${portrait ? "portrait" : "landscape"})`, r.bad.slice(0, 4));
    await ctx0.close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
