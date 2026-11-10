#!/usr/bin/env node
// The Playgama build (tools/build_crazy.py, PORTAL=playgama) on a mock Playgama Bridge: the ads the Playgama sandbox counts ("0.30 ad shows per play").
//  - a returning player: ONE interstitial when the game opens (placement game_start), even where the platform has no rewarded video (the old gate needed rewarded support)
//  - a brand new player: the same one entry ad (the sandbox plays are mostly new players)
//  - a player who bought "no ads": no ad at all
//  - the end of a match asks for an interstitial too (placement between_matches); Bridge itself decides whether it really shows
//  - the page keeps off localStorage / sessionStorage (Playgama keeps the saves through bridge.storage) and has no page errors
const { chromium } = require("playwright"), { spawnSync } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };

const MOCK = (store, silent) => `(function () {
  var L = {}; function on(ev, cb) { (L[ev] = L[ev] || []).push(cb); } function emit(ev, v) { (L[ev] || []).forEach(function (f) { f(v); }); }
  var EV = {INTERSTITIAL_STATE_CHANGED: "is", REWARDED_STATE_CHANGED: "rs", AUDIO_STATE_CHANGED: "as", PAUSE_STATE_CHANGED: "ps"}, S = ${JSON.stringify(store)};
  window.__ads = []; window.__lsTouched = 0;
  window.bridge = {EVENT_NAME: EV, initialize: function () { return Promise.resolve(); },
    storage: {get: function (ks) { return Promise.resolve(ks.map(function (k) { return k in S ? S[k] : null; })); }, set: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); }},
    platform: {language: "en", isAudioEnabled: true, on: on, sendMessage: function (m) { window.__ads.push("msg:" + m); return Promise.resolve(); }},
    advertisement: {isInterstitialSupported: true, isRewardedSupported: false, on: on,
      showInterstitial: function (p) { window.__ads.push("int:" + p); if (${!!silent}) return; setTimeout(function () { emit(EV.INTERSTITIAL_STATE_CHANGED, "opened"); }, 50); setTimeout(function () { emit(EV.INTERSTITIAL_STATE_CHANGED, "closed"); }, 400); }},
    achievements: {unlock: function () { return Promise.resolve(); }}, leaderboards: {type: "not_available"}};
})();`;

const MIME = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4"};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pg-")); let zip = process.env.PG_ZIP;
  if (!zip) {
    const r = spawnSync("/usr/bin/python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { env: { ...process.env, PORTAL: "playgama", INLINE_UNDER: "6000" }, encoding: "utf8", maxBuffer: 1 << 26 });
    ok(r.status === 0, "the Playgama build is made (build_crazy.py PORTAL=playgama)", (r.stderr || "").slice(-400)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
    zip = path.join(tmp, "out", "bilyard8-playgama.zip");
  }
  const dir = path.join(tmp, "site"); fs.mkdirSync(dir); const u = spawnSync("/usr/bin/python3", ["-m", "zipfile", "-e", zip, dir]); ok(u.status === 0, "the zip unpacks");
  ok(fs.existsSync(path.join(dir, "playgama-bridge-config.json")), "the Bridge config is next to index.html");
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "playgama-bridge-config.json"), "utf8")), pl = (cfg.advertisement && cfg.advertisement.interstitial && cfg.advertisement.interstitial.placements || []).map(x => x.id);
  ok(["game_start", "between_matches", "lobby"].every(x => pl.includes(x)), "the interstitial placements are in the config", pl);
  const srv = http.createServer((q, s) => { let f = path.join(dir, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
  await new Promise(r => srv.listen(8681, r)); const b = await chromium.launch(), errs = [];
  const open = async (store, name, silent) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await ctx.route(u => !/^http:\/\/localhost:8681\//.test(u.href) && !/^(data|blob):/.test(u.href), r => r.abort());   // (a later route wins: the mock Bridge below is registered last)
    await ctx.route("https://bridge.playgama.com/**", r => r.fulfill({ contentType: "text/javascript", body: MOCK(store, silent) }));
    await p.goto("http://localhost:8681/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
    return p;
  };
  const ads = p => p.evaluate(() => window.__ads.filter(a => a.startsWith("int:")));
  const OLD = { name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 };
  try {
    // 1. a returning player: one entry ad, although rewarded video is not supported on this platform
    let p = await open({ billiard8v2: JSON.stringify(OLD) }, "returning"); await sleep(4000);
    let a = await ads(p); ok(a.length === 1 && a[0] === "int:game_start", "a returning player gets exactly one interstitial when the game opens (game_start)", a);
    ok(await p.evaluate(() => Y8.sdk && Y8.adsReady === false), "(rewarded video is not supported here: the entry ad does not need it)");
    // 2. the end of a match asks for an interstitial (placement between_matches)
    await sleep(800); await p.evaluate(() => { Y8.lastBreak = 0; return new Promise(r => y8Break(r)); }); await sleep(600);
    a = await ads(p); ok(a.length === 2 && a[1] === "int:between_matches", "the end of a match asks for an interstitial (between_matches)", a);
    ok(await p.evaluate(() => !!document.getElementById("home") && !Y8.busy), "the game is back to normal after the ad (not stuck behind it)");
    ok(await p.evaluate(() => !("b8" in localStorage) && localStorage.length === 0), "nothing is written to localStorage");
    // 3a. the lobby button ("Do'st bilan"): an interstitial first, then the lobby screen opens
    await p.evaluate(() => { Y8.lastBreak = 0; go("home"); }); await sleep(500);
    await p.click("#tWithFr"); await sleep(1500); a = await ads(p);
    ok(a[a.length - 1] === "int:lobby", "pressing the lobby button asks for an interstitial (lobby)", a);
    ok(await p.evaluate(() => document.getElementById("withFrScr").classList.contains("on")), "the lobby screen opens after the ad");
    await p.context().close();
    // 3b. Bridge takes the call and shows nothing (too early after the last ad): the lobby screen must still open quickly, the game must not wait
    p = await open({ billiard8v2: JSON.stringify(OLD) }, "silent", true); await sleep(5500);
    await p.evaluate(() => go("home")); await sleep(300); const t0 = Date.now();
    await p.click("#tWithFr"); await p.waitForFunction(() => document.getElementById("withFrScr").classList.contains("on"), null, { timeout: 8000 }).catch(() => {});
    const dt = Date.now() - t0; ok(dt < 4000 && await p.evaluate(() => document.getElementById("withFrScr").classList.contains("on") && !Y8.busy), "when Bridge shows no ad the lobby screen opens within about 2 s and the game is not blocked (" + dt + " ms)", dt);
    await p.context().close();
    // 3. a brand new player (the Playgama sandbox plays are mostly new players): the same one entry ad, and the game still starts on the practice table
    p = await open({}, "new"); await sleep(4000); a = await ads(p);
    ok(a.length === 1 && a[0] === "int:game_start", "a brand new player gets the same one interstitial when the game opens", a);
    ok(await p.evaluate(() => mode === "game" && !Y8.busy), "the new player's game goes on after the ad (the practice table)"); await p.context().close();
    // 4. a player who bought "no ads": nothing
    p = await open({ billiard8v2: JSON.stringify({ ...OLD, adfree: true }) }, "adfree"); await sleep(4000); a = await ads(p);
    await p.evaluate(() => { Y8.lastBreak = 0; return new Promise(r => y8Break(r)); }); await sleep(600); a = await ads(p);
    ok(a.length === 0, "an ad-free player gets no ad at all", a); await p.context().close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
