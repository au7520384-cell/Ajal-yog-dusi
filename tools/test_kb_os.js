#!/usr/bin/env node
// The owner (Chrome, a phone held upright): "the world chat is cut off behind the phone's own keyboard":  node tools/test_kb_os.js
// In a browser the phone's own keyboard lies OVER the page (the page keeps its size, only window.visualViewport gets shorter). resize() measures it as --osk (class html.osk) when a text box is in use and
// the game's own keyboard is not up; the chat panels end above the keys (an upright page) or are narrowed from the right (a turned page, whose screen bottom is the page's right edge).
// The keyboard is simulated by replacing window.visualViewport (Chromium on a computer has no on-screen keyboard).
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms)), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  try {
    for (const [name, vp, frac] of [["turned (portrait)", { width: 412, height: 915 }, 0.55], ["landscape", { width: 915, height: 412 }, 0.5]]) {
      const ctx = await b.newContext({ viewport: vp, locale: "en-US", hasTouch: true, isMobile: true, deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
      await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 5000 })); });
      await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
      await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(600);
      await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); const t = document.getElementById("toasts"); if (t) t.style.display = "none"; document.getElementById("modal").classList.remove("on"); }); await sleep(500);
      await p.evaluate(() => document.getElementById("hWorld").click()); await sleep(900);
      const g = () => p.evaluate(() => { const r = id => { const e = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(e.left), t: Math.round(e.top), r: Math.round(e.right), b: Math.round(e.bottom) }; }; const bd = document.body.getBoundingClientRect(), nv = document.getElementById("nav") && document.getElementById("nav").getBoundingClientRect(); return { body: { t: Math.round(bd.top), b: Math.round(bd.bottom), l: Math.round(bd.left), r: Math.round(bd.right) }, osk: document.documentElement.classList.contains("osk"), wChat: r("wChat"), go: r("wChatGo"), inp: r("wChatIn"), ih: innerHeight, iw: innerWidth }; });
      await p.evaluate(() => { document.getElementById("wChatIn").focus(); igkToOs(); }); await sleep(500);   // the box is handed to the phone's own keyboard
      const a0 = await g(); ok(!a0.osk, name + ": class osk is off without a keyboard", a0);
      await p.evaluate(f => { const ih = innerHeight; Object.defineProperty(window, "visualViewport", { value: { height: Math.round(ih * (1 - f)), offsetTop: 0, width: innerWidth, scale: 1, addEventListener() {} }, configurable: true }); resize(); }, frac); await sleep(500);
      const a = await g(), limit = Math.round(a.ih * (1 - frac));
      ok(a.osk, name + ": the phone's keyboard over the page is measured (class osk)", a);
      ok(a.go.b <= limit + 1 && a.inp.b <= limit + 1 && a.go.t >= 0, name + ": the send key and the text box are above the keyboard (visible part " + limit + " px)", [a, limit]);
      ok(a.wChat.b <= limit + 1, name + ": the whole panel ends above the keyboard", [a.wChat, limit]);
      ok(a.body.b <= limit + 1, name + ": the whole page (not only the chat) fits above the keyboard, so every text box of the game stays in sight", [a.body, limit]);
      if (SHOT) await p.screenshot({ path: path.join(SHOT, "osk_" + name.split(" ")[0] + ".png") });
      await p.evaluate(() => { Object.defineProperty(window, "visualViewport", { value: { height: innerHeight, offsetTop: 0, width: innerWidth, scale: 1, addEventListener() {} }, configurable: true }); document.activeElement.blur(); resize(); }); await sleep(400);
      const c = await g(); ok(!c.osk && c.body.b >= c.ih - 1, name + ": keyboard gone, the page is full size again", c);
      // a zoomed page (pinch) has a short visualViewport too, but no text box in use: no --osk
      await p.evaluate(() => { Object.defineProperty(window, "visualViewport", { value: { height: Math.round(innerHeight * 0.5), offsetTop: 0, width: innerWidth, scale: 2, addEventListener() {} }, configurable: true }); resize(); }); await sleep(300);
      const z = await g(); ok(!z.osk, name + ": a zoomed page with no text box in use does not count as a keyboard", z);
      await ctx.close();
    }
  } catch (e) { ok(false, "exception " + e.message); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 3));
  console.log(`keyboard of the phone itself: ${pass} passed, ${fail} failed`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
