#!/usr/bin/env node
// The "Qirib yuting" (scratch & win) window fits on every screen:  node tools/test_scratch_fit.js   (B8_ROOT=<repo copy>)
// The owner (Nov 16, Telegram, phone held upright = the page turned): "the scratch window got big, shrink it": the 3rd row of cells lay outside the window (the landscape phone had the same). The compact sizes
// written for short screens never applied (a later base rule won, and a media query cannot see the turned page's height): html.mh560 (the logical height) shrinks the window now.
// Checked on a turned phone (412x764, 360x640), landscape phones (915x412, 844x390, 667x375) and a laptop (1280x720, unchanged: 90 px cells): all 9 cells inside the window, the close button inside and
// not on a cell, the window inside the screen.
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const srv = http.createServer((q, s) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" }); fs.createReadStream(f).pipe(s); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  for (const [name, w, h, touch] of [["turned phone 412x764", 412, 764, true], ["turned small phone 360x640", 360, 640, true], ["phone 915x412", 915, 412, true], ["phone 844x390", 844, 390, true], ["small phone 667x375", 667, 375, true], ["laptop 1280x720", 1280, 720, false]]) {
    for (const lang of ["ru", "uz"]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, locale: "ru-RU" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
      await p.addInitScript(l => { localStorage.setItem("b8guest", "1"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 100, lang: l, genderAsked: true, gender: "m", coins: 5000, scratchTries: 3 })); }, lang);
      await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
      await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); try { vipShownSession = true; } catch (e) {} }); await sleep(400);
      await p.evaluate(() => { scratchGame(); }); await sleep(900);
      const r = await p.evaluate(() => { const pn = document.querySelector("#modal .panel"), pr = pn.getBoundingClientRect(), cells = [...document.querySelectorAll(".scell")].map(e => e.getBoundingClientRect()), bb = document.querySelector("#mBtns .btn").getBoundingClientRect();
        const inside = (x, o) => x.left >= o.left - 1 && x.right <= o.right + 1 && x.top >= o.top - 1 && x.bottom <= o.bottom + 1, hit = (a, c) => Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1;
        return { n: cells.length, cellsIn: cells.every(c => inside(c, pr)), btnIn: inside(bb, pr), btnOnCell: cells.some(c => hit(bb, c)), scrolls: pn.scrollHeight > pn.clientHeight + 1 || pn.scrollWidth > pn.clientWidth + 1, panelOnScreen: pr.left >= -1 && pr.top >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1, cw: Math.round(parseFloat(getComputedStyle(document.querySelector(".scell")).width)) }; });
      ok(r.n === 9 && r.cellsIn && r.btnIn && !r.btnOnCell && r.panelOnScreen, `${name}, ${lang}: the whole window fits (9 cells and the close button inside it, not on each other, the window on the screen)`, r);
      if (name.startsWith("laptop")) ok(r.cw === 90, "the laptop keeps the 90 px cells", r.cw); else ok(r.cw === 56, `${name}: 56 px cells`, r.cw);
      await ctx.close();
    }
  }
  ok(errs.length === 0, "no page errors", errs.slice(0, 3)); await b.close(); srv.close();
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
