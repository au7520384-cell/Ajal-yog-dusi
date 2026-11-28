#!/usr/bin/env node
// The look of the game's windows (pop-ups): not black.   node tools/test_modal_look.js   (B8_ROOT=<repo copy>; about 50 s, one browser, no server)
// The owner (Nov 28, two pictures): "the bottom of the VICTORY window is black and ugly; the same black dull state at the place I marked with the arrow (the Scratch & Win window), everywhere: fix them all".
// Measured: every ordinary window had a fill of #050a1c at 72-90% over a dark picture (a window's median luminance ~0.03), the picture of the victory windows has a black hollow between its two tables, and the part of a
// victory window under the picture was flat black. Now (pro_i_glam.js, the end of glamStyle): a deep blue-violet fill with a violet bloom at the bottom, a gold one at the top and a few stars, a violet haze (screen blend) in the hollow of the picture.
//  - for 6 windows (a question, a defeat, the Scratch & Win window, the medals, a victory with the picture, a victory in a small phone) x 2 phone shapes (landscape, the turned page): the middle of the window's colour is bluish and
//    not dark (median luminance >= 0.085, blue above red), and the lower third of a victory window (under the picture) is not black
//  - the hollow of the victory picture (the middle of its lower half) is lifted well above black
//  - the layouts are as before: the window fits the screen, the text and the keys are readable (their colours are untouched), the 'glam' windows (lists of the games, the wallet) keep their own look
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), zlib = require("zlib");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function png2(buf) {   // a tiny PNG decoder: 8-bit RGB / RGBA, not interlaced (what a browser screenshot is)
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len); if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } else if (type === "IDAT") idat.push(data); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), st = w * bpp, out = Buffer.alloc(st * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)]; for (let x = 0; x < st; x++) { const v = raw[y * (st + 1) + 1 + x], a = x >= bpp ? out[y * st + x - bpp] : 0, b = y ? out[(y - 1) * st + x] : 0, c = x >= bpp && y ? out[(y - 1) * st + x - bpp] : 0;
      out[y * st + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255; } }
  return { w, h, bpp, d: out };
}
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
// the median colour of a rectangle (fractions of the image) and the share of near-black pixels in it
function stats(im, x0, y0, x1, y1) {
  const L = [], R = [], B = []; let black = 0, n = 0;
  for (let y = Math.floor(y0 * im.h); y < Math.floor(y1 * im.h); y += 2) for (let x = Math.floor(x0 * im.w); x < Math.floor(x1 * im.w); x += 2) { const i = (y * im.w + x) * im.bpp, r = im.d[i], g = im.d[i + 1], b = im.d[i + 2], l = lum(r, g, b); L.push(l); R.push(r); B.push(b); n++; if (l < 0.06) black++; }
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return { lum: +med(L).toFixed(3), r: med(R), b: med(B), black: +(black / n).toFixed(3) };
}
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const WIN = [
    ["a question", () => openModal({ icon: "❓", title: "Exit the game?", text: "Your progress is saved. Are you sure you want to leave?", buttons: [{ label: "Yes", cls: "green", fn() {} }, { label: "No", cls: "gray", fn() {} }] })],
    ["a defeat", () => openModal({ icon: "😞", title: "DEFEAT", text: "3 : 7", buttons: [{ label: "Play again", cls: "green", fn() {} }, { label: "Menu", cls: "gray", fn() {} }] })],
    ["Scratch & Win", () => scratchGame()],
    ["the medals", () => medalsModal()],
    ["a victory (the picture of the pool hall)", () => openModal({ icon: "img:laurel8", title: "VICTORY!", text: "1 : 0", buttons: [{ label: "Play again", cls: "green", fn() {} }, { label: "Menu", cls: "gray", fn() {} }], scene: "room" })],
  ];
  try {
    for (const [shape, vp] of [["landscape", { width: 915, height: 412 }], ["the turned page", { width: 412, height: 915 }], ["a small landscape phone", { width: 740, height: 360 }]]) {
      const ctx = await b.newContext({ viewport: vp, locale: "en-US", hasTouch: true, isMobile: true, deviceScaleFactor: 1 }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
      await p.addInitScript(() => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); });
      await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
      await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
      await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); const st = document.createElement("style"); st.textContent = "#toasts{display:none!important}"; document.head.appendChild(st); });
      await sleep(1500);
      for (const [name, fn] of WIN) {
        await p.evaluate(() => { try { toMenu("mini"); } catch (e) {} }); await sleep(250); await p.evaluate(fn); await sleep(800);
        const box = await p.evaluate(() => { const r = document.querySelector("#modal .panel").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, scened: document.querySelector("#modal .panel").classList.contains("scened"), vw: innerWidth, vh: innerHeight }; });
        const im = png2(await p.screenshot({ clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.w, box.vw - Math.max(0, box.x)), height: Math.min(box.h, box.vh - Math.max(0, box.y)) } }));
        const mid = stats(im, 0.16, 0.16, 0.84, 0.84), tag = `${name}, ${shape}`;
        ok(mid.lum >= 0.085 && mid.b > mid.r + 12 && mid.black < 0.45, `${tag}: the window's colour is a deep blue-violet, not black`, mid);
        if (box.scened) {
          // the window turned on the phone: the picture is on one side, so the 'lower third' is measured on the long axis of the flat part: use the whole window's far corner strip instead
          const land = vp.width > vp.height, low = land ? stats(im, 0.1, 0.72, 0.9, 0.96) : stats(im, 0.04, 0.1, 0.36, 0.9);
          ok(low.lum >= 0.085 && low.black < 0.3, `${tag}: the part of the victory window under the picture is not black`, low);
          const hol = land ? stats(im, 0.4, 0.3, 0.6, 0.46) : stats(im, 0.58, 0.4, 0.78, 0.6);   // the hollow between the two tables of the picture (the middle of its lower half)
          ok(hol.lum >= 0.1 && hol.b > hol.r, `${tag}: the black hollow of the picture is a violet haze`, hol);
        }
        ok(box.x >= -1 && box.y >= -1 && box.x + box.w <= box.vw + 1 && box.y + box.h <= box.vh + 1, `${tag}: the window fits the screen`, box);
        await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); }); await sleep(150);
      }
      // the glass windows keep their own look: the list of a game and the wallet are as dark-blue starry as before (their own rule wins)
      await p.evaluate(() => { try { toMenu("mini"); } catch (e) {} hkPick(); }); await sleep(800);
      const gl = await p.evaluate(() => { const pn = document.querySelector("#modal .panel"); return { glam: pn.classList.contains("glam"), bg: getComputedStyle(pn).backgroundImage.slice(0, 60) }; });
      ok(gl.glam && /url\(/.test(gl.bg), `a list of a game still wears the glass window (${shape})`, gl);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
