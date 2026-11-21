#!/usr/bin/env node
// The GameMonetize build (tools/build_crazy.py, PORTAL=gamemonetize) on a mock GameMonetize SDK:  node tools/test_gm_ads.js   (B8_ROOT=<repo copy>)
// The owner (Nov 17, GameMonetize's "Verify SDK in the game" window): "this GameMonetize shows no ad". GameMonetize's check wants to see an advertisement shown through its SDK while the game runs in their frame; the game's
// entry ad used to wait for rewarded video (Y8.adsReady), which GameMonetize does not have, so it never came, and the between-match ad needs two finished matches. Checked here:
//  - a returning player: ONE sdk.showBanner() when the game opens; the game is silent while the SDK says SDK_GAME_PAUSE and sound is back at SDK_GAME_START; the game is back to normal after it (not stuck behind the ad)
//  - the SDK script arrives 2.5 s late (it loads from GameMonetize): the entry ad still comes (the game waits for it); the SDK never arrives: the game starts and works, no hang, no error
//  - a brand new player: the same one ad; a player who bought "no ads": none
//  - the end of every 2nd match: an interstitial (at most one per 90 s); a rewarded-video key (GameMonetize has no rewarded video) does not hang the game
//  - Nov 21, after the owner showed that Icy Tower gets GameMonetize ads and this game does not: the REAL sdk.js asks for an ad through the bare name $ (its own jQuery), and the game's own  const $ = id => ...  hid it. The mock SDK below does the same
//    (so the old build fails these checks), the build renames the game's helper to $b8, and a real parser (acorn) finds no reference to $ left in the page
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const MIME = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp4": "video/mp4", ".js": "text/javascript", ".json": "application/json" };
// The mock works like the REAL sdk.js (read Nov 21): the SDK brings its own jQuery on window.$ and asks for an ad through the BARE name $ ($.getJSON("datax.json", ...) -> the ad request), all inside its own try/catch.
// A page with a $ of its own in the global scope (the game had  const $ = id => document.getElementById(id)) hides it: nothing is requested and nothing shows an error. That is why GameMonetize never showed an ad (asked 1, shown 0).
// calls = how often the game called showBanner(); ads = how many of those got through to the ad request.
const GMSDK = `window.__gm = {ads: 0, calls: 0, mute: []};
window.jQuery = window.$ = {getJSON(u, cb) { setTimeout(() => cb([]), 20); }, each(a, f) { for (const k in a) f(k, a[k]); }, now() { return Date.now(); }};
window.sdk = {showBanner() { window.__gm.calls++; try { $.getJSON("https://api.gamemonetize.com/datax.json", () => { window.__gm.ads++; const o = window.SDK_OPTIONS; setTimeout(() => o.onEvent({name: "SDK_GAME_PAUSE"}), 50); setTimeout(() => o.onEvent({name: "SDK_GAME_START"}), 700); }); } catch (e) {} }};
setTimeout(() => window.SDK_OPTIONS && window.SDK_OPTIONS.onEvent({name: "SDK_READY"}), 100);`;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8gm-")), dir = path.join(tmp, "site");
  const r = spawnSync("python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, PORTAL: "gamemonetize", INLINE_UNDER: "6000", SQUEEZE: "" } });
  ok(r.status === 0, "the GameMonetize build is made", (r.stderr || "").slice(-300)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
  fs.mkdirSync(dir); ok(spawnSync("python3", ["-I", "-m", "zipfile", "-e", path.join(tmp, "out", "bilyard8-gamemonetize.zip"), dir]).status === 0, "the zip unpacks");
  // the game's own helper is not called $ in this build (the SDK's jQuery owns that name): a real parser finds no reference to $ left in any inline script, and every script parses
  try {
    const acorn = require("acorn"), walk = require("acorn-walk"), html = fs.readFileSync(path.join(dir, "index.html"), "utf8"), re = /(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi; let m, scripts = 0, bad = 0, dollar = 0, mine = 0;
    while ((m = re.exec(html))) { scripts++; let ast; try { ast = acorn.parse(m[2], { ecmaVersion: "latest", sourceType: "script", allowHashBang: true }); } catch (e) { bad++; continue; }
      walk.full(ast, n => { if (n.type === "Identifier") { if (n.name === "$") dollar++; else if (n.name === "$b8") mine++; } }); }
    ok(scripts >= 3 && bad === 0, "every inline script of the GameMonetize page parses", { scripts, bad });
    ok(dollar === 0 && mine >= 500, "no reference to the bare name $ is left in the page (the game's helper is $b8; $ belongs to the SDK's jQuery)", { dollar, mine });
  } catch (e) { console.log("acorn is not installed (NODE_PATH=/opt/node-tools/node_modules): the parser check is skipped:", String(e.message).slice(0, 80)); }
  const srv = http.createServer((q, res) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(dir, u === "/" ? "index.html" : u); if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const open = async (profileObj, name, sdk) => {   // sdk: "now" | "late" | "none"
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await p.addInitScript(pr => { localStorage.setItem("b8guest", "1"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (pr) localStorage.setItem("billiard8v2", pr); }, profileObj ? JSON.stringify(profileObj) : null);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    if (sdk === "now") await p.route(/api\.gamemonetize\.com\/sdk\.js/, r => r.fulfill({ contentType: "text/javascript", body: GMSDK }));
    if (sdk === "late") await p.route(/api\.gamemonetize\.com\/sdk\.js/, async r => { await sleep(2500); r.fulfill({ contentType: "text/javascript", body: GMSDK }); });
    await p.addInitScript(() => { window.__muteLog = []; setInterval(() => { if (window.__B8_MUTE !== window.__lastMute) { window.__lastMute = window.__B8_MUTE; window.__muteLog.push(!!window.__B8_MUTE); } }, 40); });
    await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
    return p;
  };
  const ads = p => p.evaluate(() => window.__gm ? window.__gm.ads : -1);
  const OLD = { name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 };
  try {
    // 1. a returning player: one entry ad; silent during it, sound back after it
    let p = await open(OLD, "returning", "now"); await sleep(4500);
    ok(await ads(p) === 1, "a returning player gets exactly one sdk.showBanner() when the game opens", await ads(p));
    ok(await p.evaluate(() => $ === window.jQuery), "the bare name $ in the page is the SDK's jQuery (the game's own helper does not hide it)");
    ok(await p.evaluate(() => window.__gm.calls) === 1, "the game called showBanner() once, and that call reached the ad request (none swallowed inside the SDK)", await p.evaluate(() => window.__gm.calls));
    const ml = await p.evaluate(() => window.__muteLog); ok(ml.includes(true) && ml[ml.length - 1] === false, "the game is silent while the SDK says SDK_GAME_PAUSE and the sound is back at SDK_GAME_START", ml);
    ok(await p.evaluate(() => !Y8.busy && !!document.getElementById("home")), "the game is back to normal after the ad (not stuck behind it)");
    // 1b. the owner (Nov 20, on cached.gamemonetize.co: "did you remove the full-screen one?"): the game's own full-screen keys stay in this page (they hide by themselves where the frame may not go full screen)
    ok(await p.evaluate(() => !!document.getElementById("fsBtn") && !!document.getElementById("gFs")), "the game's full-screen keys (menu bar + in a match) are in the GameMonetize page");
    // 1c. what the SDK did is written at the end of Settings, so a screenshot tells what GameMonetize answered (ready? asked? really shown?)
    await p.evaluate(() => { go("settingsScr"); }); await sleep(2600);
    const diag = await p.evaluate(() => (document.getElementById("setBuild") || {}).textContent || "");
    ok(/GM sdk ok ready ok asked 1 shown 1\b/.test(diag), "Settings shows 'GM sdk ok ready ok asked 1 shown 1' after the entry ad", diag.slice(-90));
    await p.evaluate(() => { go("home"); });
    // 1d. the line under the 'ads are not available' toast: GameMonetize has no rewarded video, it must not read like a fault
    ok(await p.evaluate(() => adNoWhy()) === "no-rewarded-video-here", "the why-line of a 📺 key says there is no rewarded video here (not 'sdk-not-ready')", await p.evaluate(() => adNoWhy()));
    // 2. the end of every 2nd match: an interstitial (the clock is moved past the 90 s guard)
    await p.evaluate(() => { const d = Date.now.bind(Date); window.__skew = 100000; Date.now = () => d() + window.__skew; Y8.lastBreak = 0; });
    await p.evaluate(() => y8Break(() => {})); await sleep(300); const one = await ads(p);
    await p.evaluate(() => new Promise(r => y8Break(r))); await sleep(1500);
    ok(one === 1 && await ads(p) === 2, "the end of the 2nd match asks for an interstitial (the 1st match does not)", { after1: one, after2: await ads(p) });
    // 3. a rewarded-video key: GameMonetize has none: no hang
    const rw = await p.evaluate(async () => { let failed = false; try { await Promise.race([new Promise(r => { y8Rewarded("test", () => r("gave"), () => { failed = true; r("failed"); }); }), new Promise(r => setTimeout(() => r("timeout"), 4000))]); } catch (e) {} return { failed, busy: !!Y8.busy }; });
    ok(!rw.busy, "a rewarded-video key does not leave the game stuck (no rewarded video here)", rw);
    await p.context().close();
    // 4. the SDK script arrives 2.5 s late: the entry ad waits for it
    p = await open(OLD, "late", "late"); await sleep(7000);
    ok(await ads(p) === 1, "the SDK arrives 2.5 s late: the entry ad still comes (once)", await ads(p)); await p.context().close();
    // 5. the SDK never arrives: the game starts and works
    p = await open(OLD, "nosdk", "none"); await sleep(9000);
    ok(await p.evaluate(() => !!document.getElementById("home") && !Y8.busy && typeof profile !== "undefined"), "the SDK never arrives: the game starts and nothing hangs"); await p.context().close();
    // 6. a brand new player: the same one ad, the game goes on
    p = await open(null, "new", "now"); await sleep(4500);
    ok(await ads(p) === 1, "a brand new player gets the same one entry ad", await ads(p));
    ok(await p.evaluate(() => !Y8.busy && (mode === "game" || !!document.getElementById("home"))), "the new player's game goes on after the ad"); await p.context().close();
    // 7. a player who bought "no ads": nothing
    p = await open({ ...OLD, adfree: true }, "adfree", "now"); await sleep(4500);
    await p.evaluate(() => { Y8.lastBreak = 0; return new Promise(r => y8Break(r)); }); await p.evaluate(() => new Promise(r => y8Break(r))); await sleep(800);
    ok(await ads(p) === 0, "an ad-free player gets no ad at all", await ads(p)); await p.context().close();
    // 8. the game itself works in this build (the helper rename touched ~700 places): every screen opens, a practice match starts
    p = await open(OLD, "walk", "now"); await sleep(1500);
    const walk = await p.evaluate(async () => { const out = []; for (const id of ["cities", "tourScr", "shop", "rewards", "leader", "mini", "eventsScr", "freeScr", "roadScr", "inbox", "liveScr", "withFrScr", "openScr", "lbScr", "wheelScr", "friendsScr", "profileScr", "settingsScr", "clubsScr", "passScr", "home"]) { try { go(id); await new Promise(r => setTimeout(r, 120)); out.push(id); } catch (e) { out.push(id + " ERR " + e.message); } } return out; });
    ok(walk.length === 21 && walk.every(x => !/ERR/.test(x)), "every screen opens without an error in the GameMonetize page", walk.filter(x => /ERR/.test(x)));
    await p.evaluate(() => startMatch("practice", CITIES[0])); await sleep(2500);
    ok(await p.evaluate(() => mode === "game"), "a practice match starts"); await p.context().close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
