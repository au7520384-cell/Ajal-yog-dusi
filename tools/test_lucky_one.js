#!/usr/bin/env node
// The Lucky Shot is ONE chance per 24 hours again:  node tools/test_lucky_one.js   (B8_ROOT=<repo copy>)
// The owner (Nov 17, Y8, a screenshot of Minigames): "Lucky Shot: when one chance should be given, 3 chances are given; it used to be one chance per 24 hours; this error is everywhere". The 3 chances were the
// "Kunlik zarba" (daily shot: 3 attempts a day, same layout for everybody) that the Lucky Shot card offered first, and the home strip too. CONFIG.dailyShot (default false) switches it off; tools/test_daily_shot.js
// checks the daily shot itself with the flag on. Checked here (a signed-in player, today's 3 daily attempts unused):
//  - flag off (the default): the Lucky Shot card starts ONE plain lucky shot at once (no "Daily Shot (3)" window); it takes the free chance; the next press says when the next free chance comes
//  - the home "next goal" strip never offers the daily shot
//  - flag on (for the test only): the card offers "Daily Shot (3)" again, so the check above is not vacuous
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const srv = http.createServer((q, s) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" }); fs.createReadStream(f).pipe(s); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", hasTouch: true, isMobile: true }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
  await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 5000 })); });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(900);
  await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); try { vipShownSession = true; } catch (e) {} }); await sleep(500);
  ok(await p.evaluate(() => CONFIG.dailyShot === false), "the daily shot is OFF by default (CONFIG.dailyShot)");
  const modalText = () => p.evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), text: (document.querySelector("#modal .panel") || {}).innerText || "" }));
  // signed in, today's daily attempts unused: the case where the card used to offer the 3 attempts
  await p.evaluate(() => { try { Object.defineProperty(Net, "acct", { value: { id: "t", token: "t" }, configurable: true, writable: true }); } catch (e) { Net.acct = { id: "t", token: "t" }; } profile.dshot = null; profile.freeT = {}; profile.luckyTries = 0; go("mini"); }); await sleep(800);
  ok(await p.evaluate(() => !!Net.acct && dshotLeft() === 3), "(the player is signed in and has 3 unused daily attempts: the old offer)");
  await p.evaluate(() => document.querySelector('.mgc[data-act="lucky"]').click()); await sleep(1500);
  const g = await p.evaluate(() => ({ mode, type: game && game.type, daily: !!(game && game.daily), free: (profile.freeT || {}).lucky > 0 }));
  const m = await modalText();
  ok(g.mode === "game" && g.type === "lucky" && !g.daily && !/Daily Shot/i.test(m.text), "the Lucky Shot card starts ONE plain lucky shot at once: no Daily Shot (3) window", { g, m });
  ok(g.free, "...and it took today's free chance");
  await p.evaluate(() => { toMenu("mini"); }); await sleep(900);
  await p.evaluate(() => document.querySelector('.mgc[data-act="lucky"]').click()); await sleep(900);
  const m2 = await modalText(); ok(m2.on && /free|Next/i.test(m2.text) && !/Daily Shot/i.test(m2.text), "the second press says when the next free chance comes (24 h), no new chance", m2);
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); });
  const goals = await p.evaluate(() => { profile.dshot = null; return homeGoals().map(x => x.id); }); ok(!goals.includes("dshot"), "the home strip never offers the daily shot", goals);
  // flag on (test only): the card offers the Daily Shot (3) again
  await p.evaluate(() => { CONFIG.dailyShot = true; profile.freeT = {}; profile.dshot = null; toMenu("mini"); }); await sleep(900);
  await p.evaluate(() => document.querySelector('.mgc[data-act="lucky"]').click()); await sleep(700);
  const m3 = await modalText(); ok(m3.on && /Daily Shot \(3\)/.test(m3.text), "(control) with the flag on the card offers Daily Shot (3) again", m3);
  ok(errs.length === 0, "no page errors", errs.slice(0, 3)); await b.close(); srv.close();
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
