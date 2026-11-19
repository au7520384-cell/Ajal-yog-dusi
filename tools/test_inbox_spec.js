#!/usr/bin/env node
// Two screen fixes from the owner's screenshots (Nov 18):  node tools/test_inbox_spec.js   (B8_ROOT=<repo copy>; ~1 min, one browser, no game server)
//  1) INBOX: two dark bands stood left and right of the INBOX picture ("olib tasha, juda hunik turibdi"): `.screen>.panel{background:...!important}` painted the body of the screen behind the picture.
//     Now #inboxBody has no background / shadow / border at all, so the room picture shows beside the INBOX window.
//  2) Watching a match: the corner feed ("Ajalingman: 😮") started under the round eye key, so the name was hidden. Now the feed starts to the RIGHT of the eye key and its counter badge.
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, errs = [];
  const b = await chromium.launch();
  for (const [nm, w, h, dsf] of [["phone 915x413", 915, 413, 2], ["small phone 740x360", 740, 360, 1], ["computer 1280x576", 1280, 576, 1]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: "en-US", deviceScaleFactor: dsf, hasTouch: true, isMobile: true }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Ajalingman", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 12 })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.unlock = () => {}; window.checkAch = () => {}; const st = document.createElement("style"); st.textContent = "#toasts,.toast{display:none!important}"; document.head.appendChild(st); });
    await sleep(2500);
    // ---- 1) INBOX
    await p.evaluate(() => go("inbox")); await sleep(1500);
    const ib = await p.evaluate(() => { const el = document.getElementById("inboxBody"), cs = getComputedStyle(el), art = document.querySelector("#inboxBody .ibm").getBoundingClientRect(), r = el.getBoundingClientRect();
      return { bgImg: cs.backgroundImage, bgCol: cs.backgroundColor, shadow: cs.boxShadow, border: cs.borderTopWidth + "/" + cs.borderLeftWidth, wider: Math.round(r.width - art.width), artW: Math.round(art.width) }; });
    ok(ib.bgImg === "none" && /rgba\(0, 0, 0, 0\)|transparent/.test(ib.bgCol) && ib.shadow === "none" && ib.border === "0px/0px" && ib.artW > 200, nm + ": INBOX: the screen body behind the picture has no background, shadow or border (no dark bands beside the INBOX window)", ib);
    // the point where the band was (left of the picture, inside the old body): nothing dark and opaque is painted there
    const band = await p.evaluate(() => { const art = document.querySelector("#inboxBody .ibm").getBoundingClientRect(), x = Math.max(2, art.left - 12), y = innerHeight * 0.6; return document.elementsFromPoint(x, y).filter(e => { const c = getComputedStyle(e); return c.backgroundImage !== "none" || (c.backgroundColor !== "rgba(0, 0, 0, 0)" && e !== document.body && e !== document.documentElement); }).map(e => e.tagName + "#" + e.id + "." + String(e.className).slice(0, 20)); });
    ok(!band.some(x => /inboxBody/.test(x)), nm + ": INBOX: beside the picture #inboxBody paints nothing", band);
    await p.evaluate(() => go("home")); await sleep(600);
    // ---- 2) the watcher's corner feed
    await p.evaluate(() => { try { toMenu(); } catch (e) {} startMatch("ai", CITIES[0], botPlayer(1, 4)); });
    for (let i = 0; i < 40; i++) { await sleep(300); if (await p.evaluate(() => canControl())) break; }
    await sleep(1200);
    await p.evaluate(() => { game.net = { spec: true, seat: 0, room: "r", lastAim: 0, sentA: null }; const f = document.getElementById("liveFeed"); for (const [n, m] of [["Ajalingman", "😮"], ["Sardor", "Salom"]]) { const row = document.createElement("div"); row.className = "lf"; const bb = document.createElement("b"); bb.textContent = n; row.appendChild(bb); row.appendChild(document.createTextNode(": " + m)); f.appendChild(row); } });
    await sleep(900);
    const sp = await p.evaluate(() => { const eye = document.getElementById("specEye").getBoundingClientRect(), bd = document.querySelector("#specEye i").getBoundingClientRect(), rows = [...document.querySelectorAll("#liveFeed .lf")].map(r => r.getBoundingClientRect()), on = document.getElementById("specUi").classList.contains("on");
      return { on, eyeRight: Math.max(eye.right, bd.right), feedLeft: Math.min(...rows.map(r => r.left)), rows: rows.length, shown: getComputedStyle(document.getElementById("specEye")).display !== "none" }; });
    ok(sp.on && sp.shown && sp.rows === 2 && sp.feedLeft >= sp.eyeRight + 4, nm + ": watching: the corner feed starts to the right of the eye key and its badge (the name is readable)", sp);
    await ctx.close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
