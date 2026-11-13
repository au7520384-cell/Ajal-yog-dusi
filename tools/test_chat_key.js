#!/usr/bin/env node
// The owner marked on his Telegram screenshot (a phone held upright, the page turned 90°): "put the round key for writing a message from the arrow to the circle":  node tools/test_chat_key.js   (SHOT=dir saves pictures)
// The lobby chat key (#lbChatG) used to sit on top of the zoom "+" key (left 12 px, bottom 76 px); now it stands just BEYOND the zoom keys, centred on them (the same spot on every platform:
// Telegram, the website, the app, the portals - it is one page). Checked on phones turned and sideways, a small one and a monitor: it overlaps no zoom key, the corner feed of new lines
// starts after it, a watcher keeps the old corner (class .spec), and on the owner's phone shape (412x767 CSS px, the page turned) its centre is where he drew the circle (41 px from the screen's left edge, 80 px from its top).
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms)), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const hit = (a, c) => a && c && a[0] < c[2] && a[2] > c[0] && a[1] < c[3] && a[3] > c[1];
  try {
    for (const [w, h] of [[412, 767], [360, 640], [390, 844], [915, 412], [844, 390], [740, 360], [1280, 720]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: "en-US", hasTouch: true, isMobile: true, deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(w + "x" + h + ": " + e.message.slice(0, 200)));
      await p.addInitScript(() => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "en", coins: 5000, genderAsked: true, gender: "m", lastClaim: new Date().toISOString().slice(0, 10) })); });
      await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
      await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(600);
      await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); const t = document.getElementById("toasts"); if (t) t.style.display = "none"; }); await sleep(400);
      await p.evaluate(() => startMatch("ai", CITIES[1], { name: "Logistika", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" }, null));
      for (let i = 0; i < 40; i++) { await sleep(300); if (await p.evaluate(() => canControl())) break; }
      // (there is no lobby here: the key and the feed are switched on by hand, and kept on against the game's own timer)
      await p.evaluate(() => { const g = document.getElementById("lbChatG"); g.classList.add("on"); new MutationObserver(() => { if (!g.classList.contains("on")) g.classList.add("on"); }).observe(g, { attributes: true, attributeFilter: ["class"] }); document.getElementById("lbChatGN").textContent = "3"; document.getElementById("liveFeed").innerHTML = '<div class="lf"><b>Anvar</b> Salom!</div><div class="lf"><b>Ali</b> Omad!</div>'; });
      await sleep(500);
      const g = () => p.evaluate(() => { const r = id => { const e = document.getElementById(id), q = e.getBoundingClientRect(); return [Math.round(q.left * 10) / 10, Math.round(q.top * 10) / 10, Math.round(q.right * 10) / 10, Math.round(q.bottom * 10) / 10]; }; return { rot: rotated, chat: r("lbChatG"), zIn: r("zIn"), zOut: r("zOut"), feed: r("liveFeed"), gMenu: r("gMenu"), vis: getComputedStyle(document.getElementById("lbChatG")).display !== "none" }; });
      const a = await g(), nm = `${w}x${h}`, z = [Math.min(a.zIn[0], a.zOut[0]), Math.min(a.zIn[1], a.zOut[1]), Math.max(a.zIn[2], a.zOut[2]), Math.max(a.zIn[3], a.zOut[3])];
      ok(a.vis && a.chat[2] - a.chat[0] > 20, nm + ": the chat key is shown", a);
      ok(!hit(a.chat, a.zIn) && !hit(a.chat, a.zOut), nm + ": it does not cover the zoom + / - keys", a);
      // beyond the zoom keys along the table's bottom-left edge: sideways phone = to their right, turned phone (the page's bottom edge is the screen's left edge) = below them
      ok(a.rot ? a.chat[1] >= z[3] + 8 : a.chat[0] >= z[2] + 8, nm + ": it stands just beyond the zoom keys (" + (a.rot ? "below" : "right of") + " them)", [a.chat, z]);
      ok(!hit(a.chat, a.feed), nm + ": the corner feed of new lines starts after it (not under it)", [a.chat, a.feed]);
      ok(a.chat[0] >= 0 && a.chat[1] >= 0 && a.chat[2] <= w && a.chat[3] <= h, nm + ": it is on the screen", a.chat);
      if (w === 412 && h === 767) {
        const cx = (a.chat[0] + a.chat[2]) / 2, cy = (a.chat[1] + a.chat[3]) / 2;
        ok(Math.abs(cx - 41.5) <= 6 && Math.abs(cy - 79.4) <= 8, "the owner's phone shape: the key's centre is where he drew the circle (41, 80)", [cx, cy]);
      }
      if (SHOT) await p.screenshot({ path: path.join(SHOT, "chatkey_" + nm + ".png") });
      if (w === 915) {   // a watcher keeps the old corner (his lobby microphone key is there: the chat key sits above it)
        await p.evaluate(() => document.getElementById("lbChatG").classList.add("spec")); await sleep(200);
        const s = await g(); ok(s.chat[0] < 14 && s.chat[1] < a.chat[1] - 20, nm + ": a watcher's key stays in the old corner (class spec)", [s.chat, a.chat]);
      }
      await ctx.close();
    }
  } catch (e) { ok(false, "exception " + e.message); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 3));
  console.log(`lobby chat key: ${pass} passed, ${fail} failed`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
