#!/usr/bin/env node
// The shop's tables list must move under a finger  (the owner, Nov 19, Telegram, the Premium tables row: "when I try to go down it freezes and goes down in jerks"):
//   node tools/test_table_scroll.js      (B8_ROOT=<repo copy>; about 4 minutes, one browser, no game server)
// Why it froze (measured with a 4x slower CPU, a finger swipe sent by the browser's own input events, on the turned page where the PAGE's JS - not the browser - scrolls a list):
//  - a table's picture costs 0.35 s here / 1.3 s on a 4x slower phone, 85% of it the colouring of the big table photo (tintedTable); the list drew four of them in one go each time a new row came into view, inside the scroll;
//  - the colouring canvases (6 MB each, one per table) were all kept: 150 tables = 900 MB;
//  - a demo match plays behind every menu; it was simulated and drawn although a full-screen menu hides it (3/4 of the work of every frame of the shop);
//  - 112 shine animations ran at once on the lux cards.
// Now: the colouring runs in ~8 ms slices and only while nothing touches the list (the same pixels: checked below and, one-off against the old page, for all 156 tables), the cards on the screen first, the colouring canvas
// dropped once the picture is made, the demo paused behind the screens that hide it (checked below with a magenta canvas), the shine only on the cards on the screen and not while the list is dragged.
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, errs = [];
  const b = await chromium.launch();
  const open = async (vp, dsf, mobile) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile, locale: "en-US" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push((e.stack || e.message).slice(0, 300)));
    await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "ru", coins: 264674, gems: 6, level: 12 })));
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(2500);
    return [ctx, p];
  };

  // ======================================================= 1. the screens that hide the demo really hide the canvas (portrait turned page and landscape)
  for (const [nm, vp, mobile] of [["portrait (turned page)", { width: 393, height: 851 }, true], ["landscape", { width: 915, height: 413 }, true]]) {
    const [ctx, p] = await open(vp, 2, mobile), p2 = await ctx.newPage(); await p.bringToFront();
    const ids = await p.evaluate(() => typeof DEMO_COVER !== "undefined" ? [...DEMO_COVER] : []);
    ok(ids.length >= 10, nm + ": the page lists the screens that hide the demo match", ids);
    await p.evaluate(() => { const st = document.createElement("style"); st.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}#toasts,.toast{display:none!important}"; document.head.appendChild(st); });
    const bad = [];
    for (const id of ids) {
      await p.evaluate(id => { window.frame = () => {}; toMenu("home"); go(id); }, id); await sleep(250);
      await p.evaluate(() => { window.frame = () => {}; const g = cv.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#ff00ff"; g.fillRect(0, 0, cv.width, cv.height); }); await sleep(120);
      const png = (await p.screenshot()).toString("base64"); await p2.goto("about:blank");
      const m = await p2.evaluate(async b64 => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] > 200) n++; return n; }, png);
      if (m > 30) bad.push([id, m]);
    }
    ok(ids.length > 0 && bad.length === 0, nm + ": every one of them hides the canvas completely (a magenta canvas does not show through)", bad);
    await ctx.close();
  }

  // ======================================================= 1b. behind a screen that hides it the demo match is not drawn; on the home screen it plays again
  {
    const [ctx, p] = await open({ width: 393, height: 851 }, 2, true);
    const n = async () => p.evaluate(() => sprFrame);   // (render() counts its frames in sprFrame)
    await p.evaluate(() => { toMenu("home"); }); await sleep(800); const h0 = await n(); await sleep(900); const h1 = await n();
    await p.evaluate(() => { go("shop"); buildShop("tables"); }); await sleep(800); const s0 = await n(); await sleep(1200); const s1 = await n();
    await p.evaluate(() => { go("home"); }); await sleep(800); const b0 = await n(); await sleep(900); const b1 = await n();
    ok(h1 - h0 > 5, "home: the demo match is drawn (the frame counter runs)", [h0, h1]);
    ok(s1 - s0 <= 1, "shop: the demo match behind it is not drawn (the frame counter stands)", [s0, s1]);
    ok(b1 - b0 > 5, "back on the home screen the demo is drawn again", [b0, b1]);
    ok(await p.evaluate(() => { const G = game; return !!G && G.demo; }), "the demo match is still there (paused, not thrown away)");
    await ctx.close();
  }

  // ======================================================= 2. the same pictures, made in slices or at once (1x CPU)
  {
    const [ctx, p] = await open({ width: 393, height: 851 }, 2, true); await sleep(10000);   // (the lazy pictures of some tables load in the first seconds)
    const r = await p.evaluate(async () => {
      if (typeof tintedTableGen !== "function" || typeof tintSlices !== "function") return { missing: true };
      const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
      const hashCv = async c => hex(await crypto.subtle.digest("SHA-256", c.getContext("2d").getImageData(0, 0, c.width, c.height).data.buffer));
      const hashS = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
      const pick = [TABLE_SKINS().find(t => t.tier === "premium"), TABLE_SKINS().filter(t => t.tier === "premium")[5], TABLE_SKINS().find(t => t.tier === "elite"), TABLE_SKINS().find(t => t.city && t.id !== "syd"), TABLE_SKINS().find(t => t.vip), TABLE_SKINS().find(t => !t.tier && !t.city && !t.vip)].filter(Boolean);
      const out = [];
      for (const t of pick) {
        const look = tintLook(t); const key = tintKeyOf(look);
        delete TINT_TBL[key]; delete tblThumbs[t.id];
        const t0 = performance.now(); const a = tintedTable(look), ta = performance.now() - t0, ha = await hashCv(a), thumbA = await hashS(tableThumb(t));   // all at once (what the game does)
        delete TINT_TBL[key]; delete tblThumbs[t.id];
        let maxSlice = 0, slices = 0; const it = tintedTableGen(look); let rr; do { const s0 = performance.now(); rr = it.next(); maxSlice = Math.max(maxSlice, performance.now() - s0); slices++; await new Promise(q => setTimeout(q, 0)); } while (!rr.done);
        const hb = await hashCv(rr.value), n0 = Object.keys(TINT_TBL).length, thumbB = await hashS(tableThumb(t)), n1 = Object.keys(TINT_TBL).length;   // in slices, then the picture from the cached colouring
        out.push({ id: t.id, same: ha === hb, sameThumb: thumbA === thumbB, slices, maxSliceMs: Math.round(maxSlice), allAtOnceMs: Math.round(ta), noNewColouring: n1 === n0 });
      }
      return { out };
    });
    ok(!r.missing, "the colouring exists as a generator (tintedTableGen) and the shop's slice runner (tintSlices)");
    if (r.out) {
      ok(r.out.length >= 5 && r.out.every(x => x.same), "the colouring made in slices is the same picture, pixel for pixel, as the one made at once", r.out.filter(x => !x.same));
      ok(r.out.every(x => x.sameThumb), "the shop picture made after sliced colouring is byte for byte the one made the old way", r.out.filter(x => !x.sameThumb));
      ok(r.out.every(x => x.noNewColouring), "after the sliced colouring the picture is made from the cached colouring (it does not colour the table again)", r.out.filter(x => !x.noNewColouring).map(x => x.id));
      ok(r.out.every(x => x.slices > 30), "the colouring really gives way (many slices)", r.out.map(x => x.slices));
      ok(r.out.every(x => x.maxSliceMs < 130), "no single slice of the colouring is long (1x CPU, ms; the native canvas calls are the longest, ~50-75 ms; all at once it is 260-470)", r.out.map(x => x.maxSliceMs));
    }
    await ctx.close();
  }

  // ======================================================= 3. a finger on the list, 4x slower CPU, the turned page
  {
    const [ctx, p] = await open({ width: 393, height: 851 }, 2.75, true), cdp = await ctx.newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await p.evaluate(() => { go("shop"); buildShop("tables"); }); await sleep(6000);
    const pt = await p.evaluate(() => { const sc = document.getElementById("shop"); for (let x = 60; x < innerWidth - 20; x += 25) for (let y = 120; y < innerHeight - 60; y += 25) { const t = document.elementFromPoint(x, y); if (t && t.closest && !t.closest("canvas,input[type=range],button") && sc.contains(t)) return [x, y]; } return [300, 500]; });
    await p.evaluate(() => { window.__lat = []; window.__lt = []; window.__fr = []; window.__sc = [];
      addEventListener("touchmove", ev => { window.__lat.push(performance.now() - ev.timeStamp); }, { capture: true, passive: true });
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch (e) {}
      let last = performance.now(); const sc = document.getElementById("shop"); const tick = t => { window.__fr.push(t - last); window.__sc.push(sc.scrollTop); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const thumbs = () => p.evaluate(() => Object.keys(tblThumbs).length);
    let during = 0, shineDrag = [], t0 = Date.now();
    for (let s = 0; s < 6; s++) {
      const a = await thumbs();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt[0], y: pt[1] }] });
      for (let i = 1; i <= 30; i++) {
        await sleep(16); await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt[0] + i * 9, y: pt[1] }] });
        if (s === 2 && i === 20) shineDrag = await p.evaluate(() => [...document.querySelectorAll(".tblcard.lux.shn .tprev")].slice(0, 6).map(e => getComputedStyle(e, "::after").animationPlayState));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      during += (await thumbs()) - a; await sleep(900);
    }
    const secs = (Date.now() - t0) / 1000;
    const r = await p.evaluate(() => { const lat = window.__lat.slice().sort((a, b) => a - b), fr = window.__fr.slice(3), lt = window.__lt, sc = window.__sc; let moved = 0; for (let i = 1; i < sc.length; i++) if (sc[i] !== sc[i - 1]) moved++;
      const q = (a, f) => a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * f))]) : 0;
      return { moves: lat.length, median: q(lat, 0.5), p90: q(lat, 0.9), max: q(lat, 1), fps: Math.round(fr.length / (fr.reduce((a, x) => a + x, 0) / 1000) * 10) / 10, longest: Math.max(0, ...lt), moved, scrolled: Math.round(sc[sc.length - 1] - sc[0]) }; });
    console.log("  finger test (4x CPU, " + secs.toFixed(0) + " s):", JSON.stringify(r), "| pictures drawn while the finger was on the list:", during);
    ok(r.scrolled > 800 && r.moved > 50, "the list follows the finger", { scrolled: r.scrolled, moved: r.moved });
    ok(r.median <= 150 && r.p90 <= 300, "touch events are handled promptly (median / p90 delay, ms)", { median: r.median, p90: r.p90 });
    ok(r.max <= 1500, "no touch event waits more than 1.5 s (the old page: 5.9 s)", r.max);
    ok(r.fps >= 15, "the page keeps at least 15 frames a second while the list is dragged (the old page: 4)", r.fps);
    ok(r.longest <= 900, "no task blocks the page for more than 0.9 s (the old page: 1.8 s)", r.longest);
    ok(during <= 2, "no table picture is drawn while the finger is on the list", during);
    ok(shineDrag.length > 0 && shineDrag.every(x => x === "paused"), "the shine stands still while the list is dragged", shineDrag);

    // let it rest: the cards on the screen get their pictures, one at a time, and the big colouring canvases are not kept
    const n0 = await thumbs(); let first = -1, t1 = Date.now();
    for (let i = 0; i < 60; i++) { await sleep(1000); if ((await thumbs()) > n0 && first < 0) first = (Date.now() - t1) / 1000; if ((await thumbs()) >= n0 + 4) break; }
    const rest = await p.evaluate(() => { const cards = [...document.querySelectorAll(".tblcard .tprev")], shown = cards.filter(e => { const r = e.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; });
      const lux = [...document.querySelectorAll(".tblcard.lux")]; return { thumbs: Object.keys(tblThumbs).length, tint: Object.keys(TINT_TBL).length, shown: shown.length, shownPainted: shown.filter(e => e.style.backgroundImage).length,
        shineOn: lux.filter(c => getComputedStyle(c.querySelector(".tprev"), "::after").display !== "none").length, shineOnScreen: lux.filter(c => { const r = c.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; }).length, luxAll: lux.length,
        running: [...document.querySelectorAll(".tblcard.lux.shn .tprev")].slice(0, 5).map(e => getComputedStyle(e, "::after").animationPlayState) }; });
    console.log("  at rest:", JSON.stringify(rest), "| first picture after", first, "s");
    ok(first > 0 && first <= 30, "once the finger is off, the first picture comes within 30 s (4x CPU)", first);
    ok(rest.thumbs >= n0 + 3, "pictures keep coming, one at a time", { n0, now: rest.thumbs });
    ok(rest.tint <= 3, "the big colouring canvases (6 MB each) are not kept after the pictures are made", rest.tint);
    ok(rest.luxAll > 50 && rest.shineOn <= rest.shineOnScreen + 14, "only the cards on the screen (and a few beside them) have a shine, not all " + rest.luxAll, { on: rest.shineOn, onScreen: rest.shineOnScreen });
    ok(rest.running.length > 0 && rest.running.every(x => x === "running"), "at rest the shine runs again", rest.running);
    await ctx.close();
  }

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
