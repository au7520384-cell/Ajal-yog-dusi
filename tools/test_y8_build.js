#!/usr/bin/env node
// The Y8 zip (tools/build_y8.py):  node tools/test_y8_build.js [dir of the built site]
// - the page opens fast inside a Y8-style frame (the old 40 MB single page kept the screen black for about a minute)
// - no download screen / service worker there; Y8 rules: no card buttons, prices are "watch N ads"
// - ONE start ad when the menu is up (not twice, not on the very first launch, not for ad-free players)
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
  const STUB = `window.__ads = window.__ads || []; window.y8 = {sdk: () => ({init: (a, o) => { setTimeout(() => o.onReady && o.onReady(), 300); }, onAuth: () => {}, getPlatformLocale: () => Promise.resolve("en"), showAd: o => { window.__ads.push(o.type + ":" + o.name); o.beforeAd && o.beforeAd(); return new Promise(r => setTimeout(() => { o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone(); r(); }, 80)); }, loadData: () => Promise.resolve(null), saveData: () => Promise.resolve(), saveLeaderboardScore: () => Promise.resolve(), awardAchievement: () => Promise.resolve(), trackCustomEvent: () => {}}), emitReadyEvent: () => window.dispatchEvent(new Event("y8sdk.ready"))};`;
  async function open(profile) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(pr => { if (pr && !localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(pr)); }, profile);
    await p.route(u => /cdn\.y8\.com/.test(String(u)), r => r.fulfill({ contentType: "text/javascript", body: STUB }));
    await p.route(u => !/localhost|127\.0\.0\.1|cdn\.y8\.com/.test(String(u)), r => r.abort());
    const t0 = Date.now(); await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
    const fr = () => p.frames().find(f => f.url().includes("/game/"));
    for (let i = 0; i < 400 && !(fr() && await fr().evaluate(() => typeof profile !== "undefined" && !document.getElementById("boot")).catch(() => false)); i++) await sleep(100);
    return { p, fr, ms: Date.now() - t0 };
  }
  const base = { name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" };
  // 1) a returning player
  let t = await open(base); await sleep(5000);
  ok(t.ms < 12000, "the menu is up within 12 s (it took " + t.ms + " ms)", t.ms);
  const o = await t.fr().evaluate(() => ({ boot: !!document.getElementById("boot"), sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), dl: (document.getElementById("bootDl") || {}).className, ads: window.__ads, portal: ON_PORTAL, noCard: NO_CARD, y8: !!Y8.sdk && Y8.adsReady, htmlKB: document.documentElement.outerHTML.length / 1024 | 0 }));
  ok(o.portal && o.noCard, "Y8 mode: portal + no card payments", o); ok(!o.boot, "the black boot picture is gone", o); ok(o.y8, "Y8 SDK ready", o);
  ok(o.ads.length === 1 && o.ads[0] === "start:game-start", "exactly one start ad", o.ads);
  await t.fr().evaluate(() => { go("shop"); }); await sleep(1500);
  const shop = await t.fr().evaluate(() => ({ ads: document.querySelectorAll('[data-p="usd"]').length, adTxt: [...document.querySelectorAll('[data-p="usd"]')].slice(0, 3).map(b => b.textContent.trim()), card: document.querySelectorAll(".cardbtn, [data-card]").length }));
  ok(shop.ads === 0 || shop.adTxt.every(x => /📺/.test(x)), "prices are watch-ads buttons, never dollars", shop);
  await t.p.context().close();
  // 2) first launch (tutorial not done): no start ad
  t = await open({ name: "New", genderAsked: true, gender: "m", lang: "en" }); await sleep(4000);
  const a2 = await t.fr().evaluate(() => window.__ads); ok(a2.length === 0, "no start ad on the very first launch", a2); await t.p.context().close();
  // 3) ad-free player: no start ad
  t = await open({ ...base, adfree: true }); await sleep(4000);
  const a3 = await t.fr().evaluate(() => window.__ads); ok(a3.length === 0, "no start ad for ad-free players", a3); await t.p.context().close();
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
