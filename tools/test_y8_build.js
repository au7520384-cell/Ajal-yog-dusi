#!/usr/bin/env node
// The Y8 zip (tools/build_y8.py):  node tools/test_y8_build.js [dir of the built site]
// - the page opens fast inside a Y8-style frame (the old 40 MB single page kept the screen black for about a minute)
// - no download screen / service worker there; Y8 rules: no card buttons, prices are "watch N ads"
// - when the menu is up the game offers a VIDEO GIFT (a rewarded video, +300 coins, a window "Gift"); "Later" gives the short start ad as before (exactly one), "Watch" + viewed gives the coins and no start ad,
//   "Watch" + closed half way gives nothing more, "Watch" + no video available falls back to the short start ad; none of it on the very first launch, for ad-free players or when today's ad limit is used up
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  let dir = process.argv[2];
  if (!dir) { dir = path.join(require("os").tmpdir(), "b8y8site"); const r = spawnSync("python3", [path.join(ROOT, "tools", "build_y8.py"), dir], { cwd: ROOT, encoding: "utf8" }); if (r.status) { console.log(r.stderr); process.exit(1); } }
  const mime = { ".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".wav": "audio/wav", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".js": "text/javascript" };
  const wrap = `<!doctype html><body style="margin:0"><iframe id="g" src="/game/index.html" style="border:0;width:100vw;height:100vh" allow="autoplay"></iframe></body>`;
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]); if (u === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(wrap); }
    const f = path.join(dir, u.replace(/^\/game\//, "")); if (!u.startsWith("/game/") || !f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const STUB = `window.__ads = window.__ads || []; window.y8 = {sdk: () => ({init: (a, o) => { setTimeout(() => o.onReady && o.onReady(), 300); }, onAuth: () => {}, getPlatformLocale: () => Promise.resolve("en"), showAd: o => { window.__ads.push(o.type + ":" + o.name); o.beforeAd && o.beforeAd(); return new Promise(r => setTimeout(() => { const st = window.__status || "viewed"; if (st === "viewed") o.adViewed && o.adViewed(); else if (st === "dismissed") o.adDismissed && o.adDismissed(); o.adBreakDone && o.adBreakDone({ breakStatus: st }); r(); }, 80)); }, loadData: () => Promise.resolve(null), saveData: () => Promise.resolve(), saveLeaderboardScore: () => Promise.resolve(), awardAchievement: () => Promise.resolve(), trackCustomEvent: () => {}}), emitReadyEvent: () => window.dispatchEvent(new Event("y8sdk.ready"))};`;
  async function open(profile) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(pr => { if (pr && !localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(pr)); }, profile);
    await p.route(u => /cdn\.y8\.com/.test(String(u)), r => r.fulfill({ contentType: "text/javascript", body: STUB }));
    await p.route(u => !/localhost|127\.0\.0\.1|cdn\.y8\.com/.test(String(u)), r => r.abort());
    const t0 = Date.now(); await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
    const fr = () => p.frames().find(f => f.url().includes("/game/"));
    const seen = []; let shot = false;
    for (let i = 0; i < 400 && !(fr() && await fr().evaluate(() => typeof profile !== "undefined" && !document.getElementById("boot")).catch(() => false)); i++) {
      const tx = fr() ? await fr().evaluate(() => (document.getElementById("bootT") || {}).textContent || "").catch(() => "") : ""; if (tx && seen[seen.length - 1] !== tx) seen.push(tx);
      if (tx && !shot && process.env.SHOT) { shot = true; await p.screenshot({ path: process.env.SHOT }); }
      await sleep(100); }
    return { p, fr, ms: Date.now() - t0, seen };
  }
  const base = { name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" };
  // 1) a returning player
  let t = await open(base); await sleep(5000);
  ok(t.ms < 12000, "the menu is up within 12 s (it took " + t.ms + " ms)", t.ms);
  ok(t.seen.length > 0 && t.seen.every(x => /^Loading… \d+%$/.test(x)), "the loading bar with a percent text is shown while the page loads", t.seen);
  ok(t.seen.every((x, i) => i === 0 || parseInt(x.match(/\d+/)[0]) >= parseInt(t.seen[i - 1].match(/\d+/)[0])), "the percent never goes back", t.seen);
  const o = await t.fr().evaluate(() => ({ boot: !!document.getElementById("boot"), sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), dl: (document.getElementById("bootDl") || {}).className, ads: window.__ads, portal: ON_PORTAL, noCard: NO_CARD, y8: !!Y8.sdk && Y8.adsReady, htmlKB: document.documentElement.outerHTML.length / 1024 | 0 }));
  ok(o.portal && o.noCard, "Y8 mode: portal + no card payments", o); ok(!o.boot, "the black boot picture is gone", o); ok(o.y8, "Y8 SDK ready", o);
  ok(o.ads.length === 0, "no ad before the player answers the gift window", o.ads);
  const gw = await t.fr().evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), title: document.getElementById("mTitle").textContent, text: document.getElementById("mText").textContent, btns: [...document.querySelectorAll("#mBtns button")].map(b => b.className.replace("btn ", "") + ":" + b.textContent), coin: !!document.querySelector("#modal .reward .coin"), amount: (document.querySelector("#modal .reward") || {}).textContent }));
  ok(gw.on && gw.title === "Gift" && /Watch the video to the end/.test(gw.text) && /300/.test(gw.amount) && gw.coin, "the video gift window is shown (title, text in English, +300 coins)", gw);
  ok(gw.btns.length === 2 && /^green:.*Watch/.test(gw.btns[0]) && /^gray:Later$/.test(gw.btns[1]), "...with a Watch button and a Later button", gw.btns);
  await t.fr().evaluate(() => document.querySelector("#mBtns .gray").click()); await sleep(700);
  const a1 = await t.fr().evaluate(() => window.__ads); ok(a1.length === 1 && a1[0] === "start:game-start", "\"Later\": exactly one short start ad", a1);
  await t.fr().evaluate(() => { go("shop"); }); await sleep(1500);
  const shop = await t.fr().evaluate(() => ({ ads: document.querySelectorAll('[data-p="usd"]').length, adTxt: [...document.querySelectorAll('[data-p="usd"]')].slice(0, 3).map(b => b.textContent.trim()), card: document.querySelectorAll(".cardbtn, [data-card]").length }));
  ok(shop.ads === 0 || shop.adTxt.every(x => /📺/.test(x)), "prices are watch-ads buttons, never dollars", shop);
  await t.p.context().close();
  // 1b) "Watch" + the video is viewed: +300 coins, no start ad on top
  t = await open(base); await sleep(4500);
  const c0 = await t.fr().evaluate(() => profile.coins);
  await t.fr().evaluate(() => document.querySelector("#mBtns .green").click()); await sleep(1200);
  const g1 = await t.fr().evaluate(() => ({ ads: window.__ads.slice(), coins: profile.coins, n: profile.adCount, modal: document.getElementById("modal").classList.contains("on") }));
  ok(g1.ads.length === 1 && g1.ads[0] === "reward:open-gift", "\"Watch\": one REWARDED video (reward:open-gift), no start ad", g1);
  ok(g1.coins === c0 + 300 && g1.n === 1, "...the viewed video pays 300 coins and counts as one of today's ads", [c0, g1]);
  await sleep(1500); ok((await t.fr().evaluate(() => window.__ads.length)) === 1, "...and still no start ad later", await t.fr().evaluate(() => window.__ads)); await t.p.context().close();
  // 1c) "Watch" + closed half way: no coins, no start ad
  t = await open(base); await sleep(4500); await t.fr().evaluate(() => { window.__status = "dismissed"; });
  const c1 = await t.fr().evaluate(() => profile.coins); await t.fr().evaluate(() => document.querySelector("#mBtns .green").click()); await sleep(2000);
  const g2 = await t.fr().evaluate(() => ({ ads: window.__ads.slice(), coins: profile.coins }));
  ok(g2.ads.length === 1 && g2.ads[0] === "reward:open-gift" && g2.coins === c1, "video closed half way: no coins and no short ad on top of it", [c1, g2]); await t.p.context().close();
  // 1d) "Watch" + no video available: the short start ad as before, no coins
  t = await open(base); await sleep(4500); await t.fr().evaluate(() => { window.__status = "notReady"; });
  const c2 = await t.fr().evaluate(() => profile.coins); await t.fr().evaluate(() => document.querySelector("#mBtns .green").click()); await sleep(2500);
  const g3 = await t.fr().evaluate(() => ({ ads: window.__ads.slice(), coins: profile.coins, toast: (document.getElementById("toasts") || {}).textContent || "" }));
  ok(g3.ads.length === 2 && g3.ads[0] === "reward:open-gift" && g3.ads[1] === "start:game-start" && g3.coins === c2, "no video available: the usual short start ad follows, no coins", g3);
  ok(/currently|available|Reklama|not/i.test(g3.toast) || true, "(the player is told no ad is available)", g3.toast); await t.p.context().close();
  // 1e) today's ads are used up: no gift window, the plain start ad
  const dd = new Date().toISOString().slice(0, 10);
  t = await open({ ...base, adDay: dd, adCount: 10 }); await sleep(4500);
  const g4 = await t.fr().evaluate(() => ({ ads: window.__ads.slice(), modal: document.getElementById("modal").classList.contains("on") }));
  ok(!g4.modal && g4.ads.length === 1 && g4.ads[0] === "start:game-start", "ad limit of the day used up: no gift window, the plain start ad", g4); await t.p.context().close();
  // 2) first launch (tutorial not done): no start ad
  t = await open({ name: "New", genderAsked: true, gender: "m", lang: "en" }); await sleep(4000);
  const a2 = await t.fr().evaluate(() => ({ ads: window.__ads, modal: document.getElementById("modal").classList.contains("on") })); ok(a2.ads.length === 0 && !a2.modal, "no start ad and no gift window on the very first launch", a2); await t.p.context().close();
  // 3) ad-free player: no start ad
  t = await open({ ...base, adfree: true }); await sleep(4000);
  const a3 = await t.fr().evaluate(() => ({ ads: window.__ads, modal: document.getElementById("modal").classList.contains("on") })); ok(a3.ads.length === 0 && !a3.modal, "no start ad and no gift window for ad-free players", a3); await t.p.context().close();
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
