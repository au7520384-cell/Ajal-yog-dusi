#!/usr/bin/env node
// The Android app's HD pack:  node tools/test_android_hd.js   (B8_ROOT=<repo copy>)
// The app (android/www: standard pack inside, no HD) is served on one port and the "static site" with the HD pack (web/, with CORS) on another.
// Checks: the standard pack needs no download, the HD pack comes from the other address into its own cache, the page reloads once and uses the 400 px avatars.
const { chromium } = require("playwright"), { spawn, execSync } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const MIME = { html: "text/html", json: "application/json", js: "text/javascript", webp: "image/webp", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", webmanifest: "application/manifest+json", wav: "audio/wav", mp4: "video/mp4" };
const serve = (dir, port, cors) => new Promise(res => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html"; const f = path.join(dir, p);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  const h = { "content-type": MIME[f.split(".").pop()] || "application/octet-stream" }; if (cors) h["access-control-allow-origin"] = "*"; r.writeHead(200, h); fs.createReadStream(f).pipe(r); }).listen(port, () => res(s)); });
(async () => {
  const A = 8561, H = 8562, out = path.join(ROOT, "android", "www");
  execSync(`HD_BASE=http://localhost:${H}/ bash tools/build_android.sh`, { cwd: ROOT, stdio: "ignore" });
  const app = await serve(out, A, false), site = await serve(path.join(ROOT, "web"), H, true), errs = [];
  try {
    const man = JSON.parse(fs.readFileSync(path.join(out, "assets.json"), "utf8")); ok(!man.hd && !fs.existsSync(path.join(out, "hd")), "the app has no HD pack inside");
    const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true, locale: "uz-UZ" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "uz", genderAsked: true, gender: "m" })); });
    let loads = 0; p.on("load", () => { loads++; });
    await p.goto(`http://localhost:${A}/`, { waitUntil: "commit" });
    const t0 = Date.now(); let sawHd = false, laterShown = false;
    while (Date.now() - t0 < 240000) {
      const t = await p.evaluate(() => { const b = document.querySelector("#bootDl b"); return b ? b.textContent : ""; }).catch(() => "");
      if (/HD grafika/.test(t)) { sawHd = true; const vis = await p.evaluate(() => { const b = document.querySelector("#bootDl button"); return !!b && getComputedStyle(b).display !== "none"; }).catch(() => null); if (vis === true) laterShown = true; }   // the HD pack is a must in the app: no "Later" button while it downloads
      if (loads >= 2 && await p.evaluate(() => typeof profile !== "undefined" && !document.getElementById("boot")).catch(() => false)) break;
      await sleep(250);
    }
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const st = await p.evaluate(async () => ({ state: __hd.state, n: (await (await caches.open("billiard8-hd")).keys()).length, avail: __hd.avail }));
    const hdN = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "assets.json"), "utf8")).hd.files.length;
    ok(sawHd, "the HD download screen was shown (the standard pack is already in the app)");
    ok(!laterShown, "no \"Later\" button while the HD pack downloads (it is not optional in the app)");
    ok(st.state === "on" && st.n >= hdN, "the HD pictures are in their own cache, downloaded from the other address", { st, hdN });
    ok(loads === 2, "the page reloaded once", loads);
    const w = await p.evaluate(async () => { const im = new Image(); im.src = IMG.ga0; await im.decode(); return im.naturalWidth; });
    ok(w === 400, "the avatar is the 400 px HD copy", w);
    // who skips the HD pack in the app: only a 2G / 3G connection - a weak phone or data saver on 4G still downloads it
    const fresh = async (conn, mem) => {
      const c2 = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "uz-UZ" }), q = await c2.newPage();
      await q.addInitScript(([cn, mm]) => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "uz", genderAsked: true, gender: "m" }));
        Object.defineProperty(navigator, "connection", { value: cn, configurable: true }); if (mm) Object.defineProperty(navigator, "deviceMemory", { value: mm, configurable: true }); }, [conn, mem]);
      await q.goto(`http://localhost:${A}/`, { waitUntil: "commit" }); return [q, c2];
    };
    { const [q, c2] = await fresh({ effectiveType: "3g", saveData: false }, 0);
      await q.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
      const r = await q.evaluate(() => ({ state: __hd.state, avail: __hd.avail })); ok(r.state === "skipped", "3G: the HD pack is skipped", r); await c2.close(); }
    { const [q, c2] = await fresh({ effectiveType: "4g", saveData: true }, 1);
      let saw = false, later = false; const t1 = Date.now();
      while (Date.now() - t1 < 60000 && !saw) { const t = await q.evaluate(() => { const b = document.querySelector("#bootDl b"), bt = document.querySelector("#bootDl button"); return { t: b ? b.textContent : "", v: !!bt && getComputedStyle(bt).display !== "none" }; }).catch(() => ({ t: "", v: false })); if (/HD grafika/.test(t.t)) { saw = true; later = t.v; } else await sleep(250); }
      ok(saw, "4G (weak phone, data saver on): the HD pack is downloaded, not skipped"); ok(!later, "and there is no \"Later\" for it"); await c2.close(); }
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { app.close(); site.close(); }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
