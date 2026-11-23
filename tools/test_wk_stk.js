#!/usr/bin/env node
// Two fixes of Nov 23 (the owner's screenshots): node tools/test_wk_stk.js   (B8_ROOT=<repo copy>; about 1 minute, one browser, no game server)
//  1) the weekly results window ("Itogi nedeli"): the 3rd place was a huge empty card because the avatar of that player had a FRAME: a framed avatar carries a margin of 12 % (floral frames 36 %) of its cell's WIDTH,
//     which made the row several times higher than the others. Every one of the game's frames, on an upright phone (the page turned 90 degrees, the owner's case) and on a computer: the three rows are the same
//     height, and so is the player's own bar at the top
//  2) a sticker that a spectator sends shows up as its PICTURE in the corner feed and in the spectators' chat (it was the bare emoji character: the ring sticker came out as a small medal)
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const open = async (vp, touch) => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", deviceScaleFactor: 1, hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 300)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 30, lang: "ru", coins: 100000, genderAsked: true, country: "UZ" })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.toast = () => {}; });
    await sleep(2000);
    return { p, close: () => ctx.close() };
  };

  // ------------------------------------------------------------------ 1) the weekly window: a frame on one avatar does not change the height of its row
  for (const [name, vp, touch] of [["upright phone", { width: 328, height: 611 }, true], ["computer", { width: 1280, height: 720 }, false]]) {
    const { p, close } = await open(vp, touch);
    const r = await p.evaluate(() => {
      const mk = (i, n, won, avatar, frame) => ({ id: "u" + i, name: n, won, country: "TH", level: 6, avatar, frame });
      const week = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10), out = { frames: FRAMES.length, bad: [], base: null };
      const show = (frame3, mine) => { profile.frame = mine | 0; openWeeklyResults({ lastWeek: { week, top: [mk(1, "A1", 8596, 11, 0), mk(2, "A2", 7200, 5, 0), mk(3, "A3", 6100, 8, frame3)] }, me: { rank: 112, won: 200 }, prizes: [1500, 750, 400], countryPrizes: [400, 200, 100], countryTop: [] });
        const rows = [...document.querySelectorAll(".wkrow")].map(e => e.offsetHeight), me = document.querySelector(".wkme").offsetHeight; return { rows, me }; };
      out.base = show(0, 0);
      for (let f = 1; f < FRAMES.length; f++) { const m = show(f, f); if (m.rows.length !== 3 || Math.max(...m.rows) - Math.min(...m.rows) > 3 || Math.abs(m.me - out.base.me) > 3 || Math.abs(m.rows[2] - out.base.rows[2]) > 3) out.bad.push([f, m]); }
      return out;
    });
    ok(r.frames > 100 && r.bad.length === 0 && r.base.rows.length === 3, `weekly window (${name}): every one of the ${r.frames} frames on the 3rd place and on the player's own avatar leaves the rows and the bar the same height`, { base: r.base, bad: r.bad.slice(0, 4) });
    await close();
  }

  // ------------------------------------------------------------------ 2) a spectator's sticker is a picture
  {
    const { p, close } = await open({ width: 915, height: 412 }, true);
    const r = await p.evaluate(() => {
      const sticker = STICKER_PACKS[0].e[8], plain = "Salom";   // (the Bilyard pack's last sticker: the ring with the 8 ball; its character is a medal)
      const fs = chatBody(sticker), ft = chatBody(plain), host = document.createElement("div"), host2 = document.createElement("div"); host.appendChild(fs); host2.appendChild(ft);
      const img = host.querySelector("img.stkimg");
      specInfo.log = [{ name: "Ali", avatar: 3, frame: 0, msg: sticker }, { me: true, msg: STICKER_PACKS[0].e[1] }, { name: "Vali", avatar: 4, frame: 0, msg: plain }];
      specDrawLog();
      const log = document.getElementById("specLog"), imgs = [...log.querySelectorAll("img.stkimg")];
      return { sticker, feedImg: !!img && img.src === STK_IMG[sticker], feedText: host.textContent, feedPlainImg: !!host2.querySelector("img"), feedPlainText: host2.textContent, logImgs: imgs.length, logSrc: imgs.map(i => i.src === STK_IMG[sticker] || i.src === STK_IMG[STICKER_PACKS[0].e[1]]), logText: [...log.querySelectorAll(".splb")].map(e => e.textContent), logBare: log.textContent.includes(sticker) };
    });
    ok(r.feedImg && r.feedText === ": " && !r.feedPlainImg && r.feedPlainText === ": Salom", "the corner feed: a sticker is its picture (the right one), a plain line stays text", r);
    ok(r.logImgs === 2 && r.logSrc.every(Boolean) && !r.logBare && r.logText.some(t => /Salom/.test(t)), "the spectators' chat: both stickers are pictures, the plain line stays text, no bare emoji character", r);
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok(src.includes('row.appendChild(chatBody(String(m.msg || "").slice(0, 60)));') && !src.includes('row.appendChild(document.createTextNode(": " + String(m.msg || "").slice(0, 60)));'), "the 'schat' message handler writes the feed line with chatBody()");
    await close();
  }

  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
