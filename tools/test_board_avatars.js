#!/usr/bin/env node
// The player cards of the board games (checkers #shScr, Magic Chess #mcScr) with every avatar frame:  node tools/test_board_avatars.js   (B8_ROOT=<repo copy>; about 1 minute)
// The owner (Nov 23, a screenshot): the opponent's gold frame stood out of its card and the card was taller than mine. The slot of the picture is fixed (60 x 52) and a framed avatar is scaled so that the PAINTED part
// of every one of the 128 FRAMES lies inside the slot and the card (not the frame's image box: it is 139% / 272% of the picture and mostly empty), and both cards keep the same height.
// Three windows: 915 x 412 (a phone held sideways), 412 x 915 (the page turned 90 degrees, as on the owner's phone) and 360 x 640 (a small one, turned).
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const ct = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }[path.extname(f)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  for (const [W, H] of [[915, 412], [412, 915], [360, 640]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, locale: "en-US", deviceScaleFactor: 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 300)));
    await p.addInitScript(() => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); });
    await sleep(1500);
    const turned = await p.evaluate(() => rotated); ok(turned === (H > W), `${W} x ${H}: the page is ${H > W ? "turned" : "not turned"}`, turned);
    for (const which of ["sh", "mc"]) {
      await p.evaluate(w => { if (w === "sh") { if (SHU.on) shClose(); shOpen({ mode: "local", pl: [{ name: "Jasur", avatar: 3, frame: 0 }, { name: "Logistika", avatar: 5, frame: 0 }] }); } else { if (MCU.on) mcClose(); mcOpen({ mode: "local", pl: [{ name: "Jasur", avatar: 3, frame: 0 }, { name: "Logistika", avatar: 5, frame: 0 }] }); } }, which); await sleep(600);
      const res = await p.evaluate(async ([w, W]) => {
        const scr = document.getElementById(w === "sh" ? "shScr" : "mcScr"), pl = w === "sh" ? SHU.pl : MCU.pl, render = w === "sh" ? shRender : mcRender, rot = document.documentElement.classList.contains("rot");
        const page = r => rot ? [r.top, W - r.right, r.bottom, W - r.left] : [r.left, r.top, r.right, r.bottom];   // a rect of the screen -> the page's own frame (x0, y0, x1, y1)
        const R = e => page(e.getBoundingClientRect()), cache = {};
        const alpha = async img => {   // the painted part of a frame's picture: the opaque bounds, as shares of the picture
          const k = img.currentSrc || img.src; if (cache[k]) return cache[k];
          if (!img.complete || !img.naturalWidth) await new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 3000); });
          const nw = img.naturalWidth, nh = img.naturalHeight; if (!nw) return (cache[k] = null);
          const c = document.createElement("canvas"); c.width = nw; c.height = nh; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, nw, nh).data; let x0 = nw, y0 = nh, x1 = -1, y1 = -1;
          for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) if (d[(y * nw + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          return (cache[k] = x1 < 0 ? null : [x0 / nw, y0 / nh, (x1 + 1) / nw, (y1 + 1) / nh]);
        };
        const bad = [], heights = new Set(); let n = 0;
        for (let f = 0; f < FRAMES.length; f++) {
          pl[0].frame = f; pl[1].frame = (f * 7 + 3) % FRAMES.length; render(); await new Promise(r => setTimeout(r, 15));
          const hs = [];
          for (const side of ["opp", "me"]) {
            const card = scr.querySelector(`.sh-pl[data-s="${side}"]`), slot = card.querySelector(".sh-av"), av = slot.querySelector(".avx"), fr = slot.querySelector(".avfr");
            const s = R(slot), c = R(card); let parts = [R(av)];
            if (fr) { const a = await alpha(fr), r = R(fr); if (a) parts.push([r[0] + (r[2] - r[0]) * a[0], r[1] + (r[3] - r[1]) * a[1], r[0] + (r[2] - r[0]) * a[2], r[1] + (r[3] - r[1]) * a[3]]); }
            let ovS = 0, ovC = 0; for (const q of parts) { ovS = Math.max(ovS, s[0] - q[0], s[1] - q[1], q[2] - s[2], q[3] - s[3]); ovC = Math.max(ovC, c[0] - q[0], c[1] - q[1], q[2] - c[2], q[3] - c[3]); }
            hs.push(c[3] - c[1]); n++;
            if (ovS > 1.5 || ovC > 0.5) bad.push({ f, id: FRAMES[f].id, side, ovSlot: +ovS.toFixed(1), ovCard: +ovC.toFixed(1) });
          }
          if (Math.abs(hs[0] - hs[1]) > 1) bad.push({ f, id: FRAMES[f].id, heights: hs.map(Math.round) });
          hs.forEach(h => heights.add(Math.round(h)));
        }
        return { n, bad, heights: [...heights] };
      }, [which, W]);
      ok(res.n === 256 && res.bad.length === 0, `${W} x ${H} ${which === "sh" ? "checkers" : "Magic Chess"}: the painted part of all 128 frames lies inside the slot and the card, the two cards are one height`, { n: res.n, bad: res.bad.slice(0, 6), nbad: res.bad.length });
      ok(res.heights.length === 1, `${W} x ${H} ${which === "sh" ? "checkers" : "Magic Chess"}: every card has the same height whatever the frame`, res.heights);
      await p.evaluate(w => { if (w === "sh") shClose(); else mcClose(); }, which);
    }
    await ctx.close();
  }
  ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  console.log(`pass ${pass}, fail ${fail}`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
