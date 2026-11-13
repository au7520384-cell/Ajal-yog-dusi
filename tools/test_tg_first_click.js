#!/usr/bin/env node
// Telegram Mini App: the first click of a visit starts the (Adsgram) start ad - once; none without an interstitial block, for ad-free players or on the plain website:  node tools/test_tg_first_click.js
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); fs.createReadStream(path.join(ROOT, "index.html")).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const open = async (hash, profile, startAds) => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(pr => { localStorage.setItem("b8_assets", "x"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("billiard8v2", JSON.stringify(pr)); }, profile);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/${hash}`, { waitUntil: "commit" }); await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(1500);
    await p.evaluate(sa => { window.__ads = []; if (sa !== null) { Y8.sdk = { showAd: o => { window.__ads.push(o.type + ":" + o.name); o.beforeAd && o.beforeAd(); return new Promise(r => setTimeout(() => { o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone(); r(); }, 200)); } }; Y8.adsReady = true; Y8.startAds = sa; } }, startAds === undefined ? null : startAds);
    return p; };
  const click = async p => { await p.mouse.click(700, 330); await sleep(800); };
  const base = { name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" };
  let p = await open("#tgWebAppVersion=7.0", base, "tg"); await click(p); await click(p); await click(p);
  let a = await p.evaluate(() => window.__ads); ok(a.length === 1 && a[0] === "start:first-click", "Telegram with an Adsgram block: the first click starts the start ad, once", a); await p.context().close();
  p = await open("#tgWebAppVersion=7.0", { name: "New", genderAsked: true, gender: "m", lang: "en" }, "tg"); await click(p); a = await p.evaluate(() => window.__ads);
  ok(a.length === 1 && a[0] === "start:first-click", "...a new player too", a); await p.context().close();
  p = await open("#tgWebAppVersion=7.0", base, 0); await click(p); await click(p); a = await p.evaluate(() => window.__ads); ok(a.length === 0, "Telegram without an interstitial block: no ad", a); await p.context().close();
  p = await open("#tgWebAppVersion=7.0", { ...base, adfree: true }, "tg"); await click(p); await click(p); a = await p.evaluate(() => window.__ads); ok(a.length === 0, "ad-free player: no ad", a); await p.context().close();
  p = await open("", base, "tg"); await click(p); await click(p); a = await p.evaluate(() => window.__ads); ok(a.length === 0, "the plain website (not Telegram, not a portal): no ad", a); await p.context().close();
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
