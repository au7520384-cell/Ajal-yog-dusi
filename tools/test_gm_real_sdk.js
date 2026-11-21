#!/usr/bin/env node
// The GameMonetize build on GameMonetize's REAL sdk.js (with a fake Google IMA, no ad network is touched):
//   GM_SDK_DIR=<folder with sdk.js datax.json dataxx.json dataxxx.json> NODE_PATH=/opt/node-tools/node_modules node tools/test_gm_real_sdk.js
// Skipped when the folder is not given: the files are GameMonetize's, not ours. Fetch them (the host api.gamemonetize.com must be reachable):
//   mkdir -p /tmp/gmsdk && cd /tmp/gmsdk && for f in sdk.js datax.json dataxx.json dataxxx.json; do curl -sSO https://api.gamemonetize.com/$f; done
// Why it exists (Nov 21): the mock SDK of test_gm_ads.js passed while the owner's GameMonetize page showed no ad. The real SDK asks for an ad through the bare name $ (its own jQuery) and the game's own  const $ = ...  hid it;
// only the real script showed that. Re-run this when GameMonetize changes its SDK, or when the page gets a new top-level name that could clash with the SDK's (the SDK's script declares globals like comAPI, ShowAds, promoVideo, adxAds).
// What is checked on a page served as https://cached.gamemonetize.co/ (the owner's address):
//   a bare page: showBanner() -> datax.json -> the ad request (sanity of the harness);  the same page + the game's old  const $ = id => document.getElementById(id)  -> nothing is requested (the bug, kept as a reminder)
//   this game: the entry ad is requested, the SDK's overlay covers the game while it plays (elementFromPoint), the game works after it; no fill -> the SDK's own fallback chain (ADX retry, then the display ad with "You can skip this in N secs") covers the game too
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), DIR = process.env.GM_SDK_DIR || "", sleep = ms => new Promise(r => setTimeout(r, ms));
if (!DIR || !fs.existsSync(path.join(DIR, "sdk.js"))) { console.log("skipped: GM_SDK_DIR must point to a folder with GameMonetize's sdk.js, datax.json, dataxx.json, dataxxx.json (see the top of this file)"); process.exit(0); }
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const rd = f => fs.readFileSync(path.join(DIR, f), "utf8"), SDK = rd("sdk.js"), DATAX = rd("datax.json"), DATAXX = rd("dataxx.json"), DATAXXX = rd("dataxxx.json");
const ORIGIN = "https://cached.gamemonetize.co";
const MIME = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp4": "video/mp4", ".js": "text/javascript", ".json": "application/json" };
const FAKE_IMA = `(function () {
  var AE = {AD_BREAK_READY: "adBreakReady", AD_METADATA: "adMetadata", ALL_ADS_COMPLETED: "allAdsCompleted", CLICK: "click", COMPLETE: "complete", CONTENT_PAUSE_REQUESTED: "contentPauseRequested", CONTENT_RESUME_REQUESTED: "contentResumeRequested", DURATION_CHANGE: "durationChange", FIRST_QUARTILE: "firstQuartile", IMPRESSION: "impression", INTERACTION: "interaction", LINEAR_CHANGED: "linearChanged", LOADED: "loaded", LOG: "log", MIDPOINT: "midpoint", PAUSED: "pause", RESUMED: "resume", SKIPPABLE_STATE_CHANGED: "skippableStateChanged", SKIPPED: "skip", STARTED: "start", THIRD_QUARTILE: "thirdQuartile", USER_CLOSE: "userClose", VOLUME_CHANGED: "volumeChange", VOLUME_MUTED: "volumeMute"};
  window.__ima = {requests: [], started: 0};
  function mkManager() { var L = {}; return {
    addEventListener: function (t, h, c, ctx) { (L[t] = L[t] || []).push(function (e) { return h.call(ctx || null, e); }); },
    init: function () {}, resize: function () {}, destroy: function () {}, getVolume: function () { return 1; }, setVolume: function () {},
    start: function () { window.__ima.started++;
      var fire = function (t) { (L[t] || []).forEach(function (f) { f({type: t, getAd: function () { return {getContentType: function () { return "video/mp4"; }}; }, getAdData: function () { return {}; }}); }); };
      setTimeout(function () { fire(AE.LOADED); fire(AE.CONTENT_PAUSE_REQUESTED); fire(AE.STARTED); }, 30);
      setTimeout(function () { fire(AE.COMPLETE); fire(AE.CONTENT_RESUME_REQUESTED); fire(AE.ALL_ADS_COMPLETED); }, 2500); } }; }
  window.google = {ima: {
    settings: {setVpaidMode: function () {}, setLocale: function () {}, setDisableCustomPlaybackForIOS10Plus: function () {}}, ImaSdkSettings: {VpaidMode: {INSECURE: 2, ENABLED: 1, DISABLED: 0}},
    AdDisplayContainer: function () { this.initialize = function () {}; this.destroy = function () {}; },
    AdsLoader: function () { var L = {}; this.addEventListener = function (t, h, c, ctx) { (L[t] = L[t] || []).push(function (e) { return h.call(ctx || null, e); }); };
      this.requestAds = function (req) { window.__ima.requests.push(req.adTagUrl); setTimeout(function () {
        if (window.__IMA_ERR) { (L.adError || []).forEach(function (f) { f({type: "adError", getError: function () { return {getMessage: function () { return "no fill"; }, getErrorCode: function () { return 1009; }}; }}); }); return; }
        (L.adsManagerLoaded || []).forEach(function (f) { f({getAdsManager: function () { return mkManager(); }}); }); }, 40); };
      this.contentComplete = function () {}; this.destroy = function () {}; },
    AdsManagerLoadedEvent: {Type: {ADS_MANAGER_LOADED: "adsManagerLoaded"}}, AdErrorEvent: {Type: {AD_ERROR: "adError"}}, AdsRequest: function () {}, AdsRenderingSettings: function () {},
    UiElements: {AD_ATTRIBUTION: "adAttribution", COUNTDOWN: "countdown"}, AdEvent: {Type: AE}, ViewMode: {NORMAL: "normal", FULLSCREEN: "fullscreen"}
  }};
})();`;
const BARE = extra => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title><script>
window.__ev = []; window.SDK_OPTIONS = {gameId: "esjcoyx21kbp842me139bq7bsc5vspio", onEvent: function (a) { window.__ev.push(a.name); }};
(function (a, b, c) { var d = a.getElementsByTagName(b)[0]; a.getElementById(c) || (a = a.createElement(b), a.id = c, a.src = "https://api.gamemonetize.com/sdk.js", d.parentNode.insertBefore(a, d)); })(document, "script", "gamemonetize-sdk");
</script>${extra || ""}</head><body><div id="x">bare page</div></body></html>`;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8gmreal-")), site = path.join(tmp, "site");
  const r = spawnSync("python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, PORTAL: "gamemonetize", INLINE_UNDER: "6000", SQUEEZE: "" } });
  ok(r.status === 0, "the GameMonetize build is made", (r.stderr || "").slice(-300)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
  fs.mkdirSync(site); ok(spawnSync("python3", ["-I", "-m", "zipfile", "-e", path.join(tmp, "out", "bilyard8-gamemonetize.zip"), site]).status === 0, "the zip unpacks");
  const b = await chromium.launch();
  const run = async (kind, imaErr) => {   // kind: bare | bare$ | game
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(), reqs = [], errs = [];
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(e => { window.__IMA_ERR = e; }, !!imaErr);
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x");
      localStorage.setItem("billiard8v2", JSON.stringify({ name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); });
    await p.route(() => true, async rt => {
      const u = rt.request().url(); reqs.push(u.replace(/\?.*$/, ""));
      const json = body => rt.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
      if (u === ORIGIN + "/bare.html") return rt.fulfill({ contentType: MIME[".html"], body: BARE() });
      if (u === ORIGIN + "/bare2.html") return rt.fulfill({ contentType: MIME[".html"], body: BARE("<script>const $ = id => document.getElementById(id);</script>") });   // the game's old helper, alone
      if (u.startsWith(ORIGIN + "/")) { const rel = decodeURIComponent(u.slice(ORIGIN.length).split("?")[0]), f = path.join(site, rel === "/" ? "index.html" : rel);
        if (f.startsWith(site) && fs.existsSync(f) && fs.statSync(f).isFile()) return rt.fulfill({ contentType: MIME[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) }); return rt.fulfill({ status: 404, body: "" }); }
      if (/api\.gamemonetize\.com\/sdk\.js/.test(u)) return rt.fulfill({ contentType: "text/javascript", body: SDK });
      if (/api\.gamemonetize\.com\/datax\.json/.test(u)) return json(DATAX);
      if (/api\.gamemonetize\.com\/dataxx\.json/.test(u)) return json(DATAXX);
      if (/api\.gamemonetize\.com\/dataxxx\.json/.test(u)) return json(DATAXXX);
      if (/imasdk\.googleapis\.com\/js\/sdkloader\/ima3\.js/.test(u)) return rt.fulfill({ contentType: "text/javascript", body: FAKE_IMA });
      if (/gamemonetize\.com\/ga\.js/.test(u)) return rt.fulfill({ contentType: "text/javascript", body: "/* ga.js stub */" });
      if (/gamemonetize\.com\/account\/event|opphbh/.test(u)) return rt.fulfill({ status: 204, body: "" });
      return rt.abort();
    });
    await p.goto(ORIGIN + (kind === "bare" ? "/bare.html" : kind === "bare$" ? "/bare2.html" : "/index.html"), { waitUntil: "commit" });
    const samples = [];
    if (kind === "game") {
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
      for (let t = 0; t < 70; t++) {   // up to 14 s: the ad overlay (video ad) or the SDK's display ad (no fill) must come on top of the game
        const st = await p.evaluate(() => { const o = document.getElementById("sdk__advertisement"), pr = document.getElementById("promo"), cs = o && getComputedStyle(o);
          const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest("#sdk__advertisement") ? "sdk__advertisement" : e.closest("#promo") ? "promo" : e.id || e.tagName) : null; };
          return { overlay: !!o && cs.opacity === "1" && cs.transform.indexOf("-9999") < 0, promo: !!pr && getComputedStyle(pr).display !== "none", centre: at(innerWidth / 2, innerHeight / 2), corner: at(30, 30), skip: (document.getElementById("promo-button") || {}).textContent || "" }; });
        if (st.overlay || st.promo) { samples.push(st); if (samples.length >= 3) break; } else if (samples.length) break;
        await sleep(200);
      }
    } else { await sleep(2500); await p.evaluate(() => { try { window.sdk.showBanner(); } catch (e) { window.__showErr = String(e); } }); }
    await sleep(imaErr ? 1500 : 3500);   // the fake video ad lasts 2.5 s
    const info = await p.evaluate(() => ({ sdk: typeof window.sdk, ima: window.__ima, ev: window.__ev, gm: window.__gmN, busy: typeof Y8 !== "undefined" ? !!Y8.busy : null,
      overlayHidden: (() => { const o = document.getElementById("sdk__advertisement"); return !o || getComputedStyle(o).opacity === "0" || getComputedStyle(o).transform.indexOf("-9999") >= 0; })(), home: !!document.getElementById("home") }));
    if (kind === "game" && !imaErr) info.key = await p.evaluate(() => new Promise(res => { let gave = 0, failed = 0; y8Rewarded("test-key", () => gave++, () => failed++); setTimeout(() => res({ gave, failed, busy: !!Y8.busy, imaReqs: window.__ima.requests.length, why: Y8.lastWhy }), 9500); }));   // a 📺 key right after the entry ad: the real SDK refuses a second ad inside its gap
    await ctx.close(); return { reqs, errs, samples, ...info };
  };
  try {
    let x = await run("bare");
    ok(x.sdk === "object" && x.reqs.some(u => /datax\.json/.test(u)) && x.ima.requests.length === 1 && /ca-games-pub-5519830896693885-tag/.test(x.ima.requests[0]), "a bare page: the real SDK's showBanner() asks for the ad (datax.json, then the ad tag)", { reqs: x.reqs.filter(u => /datax|gampad/.test(u)), ima: x.ima });
    ok(x.ev.includes("SDK_GAME_PAUSE") && x.ev.includes("SDK_GAME_START"), "a bare page: SDK_GAME_PAUSE and SDK_GAME_START come around the ad", x.ev);
    x = await run("bare$");
    ok(x.sdk === "object" && x.ima.requests.length === 0 && !x.reqs.some(u => /datax\.json/.test(u)), "the same page with the game's old  const $ = id => ...  asks for nothing (this is the bug the game had; the build renames the helper)", { ima: x.ima, reqs: x.reqs.filter(u => /datax/.test(u)) });
    x = await run("game");
    ok(x.sdk === "object" && x.gm && x.gm.ready === 1, "this game: the SDK is created and says SDK_READY", x.gm);
    ok(x.ima.requests.length === 1 && /ca-games-pub-5519830896693885-tag/.test(x.ima.requests[0]) && x.reqs.some(u => /datax\.json/.test(u)), "this game: the entry ad is requested through the real SDK (datax.json, then the GameMonetize ad tag)", { ima: x.ima });
    ok(x.gm && x.gm.asked === 1 && x.gm.pause === 1 && x.gm.start === 1, "this game: asked 1, shown 1 (SDK_GAME_PAUSE / SDK_GAME_START came)", x.gm);
    ok(x.samples.length > 0 && x.samples.every(s => s.centre === "sdk__advertisement" && s.corner === "sdk__advertisement"), "this game: while the ad plays the SDK's overlay covers the whole game (nothing of the game is above it)", x.samples);
    ok(x.overlayHidden && x.home && x.busy === false, "this game: after the ad the overlay is gone and the game is back to normal", { hidden: x.overlayHidden, home: x.home, busy: x.busy });
    ok(x.errs.length === 0, "this game: no page errors", x.errs.slice(0, 3));
    ok(x.key && x.key.gave === 0 && x.key.failed === 1 && !x.key.busy && x.key.imaReqs === 1, "this game: a 📺 key right after the entry ad is refused by the SDK's own gap (no 2nd ad request, no prize, not stuck)", x.key);
    x = await run("game", true);
    ok(x.ima.requests.length === 2 && /GameMonetize\.com-ADX-AFG-Preroll-Ads/.test(x.ima.requests[1]), "no fill: the SDK retries once with its ADX tag", x.ima.requests.map(u => u.slice(0, 120)));
    ok(x.reqs.some(u => /dataxxx\.json/.test(u)) && x.samples.length > 0 && x.samples.every(s => s.promo && s.centre === "promo" && s.corner === "promo" && /You can skip this in \d+ secs/.test(s.skip)), "no fill: the SDK's display ad (\"You can skip this in N secs\") covers the whole game", x.samples);
    ok(x.busy === false && x.home && x.errs.length === 0, "no fill: the game is not stuck and no page errors", { busy: x.busy, errs: x.errs.slice(0, 3) });
  } finally { await b.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
