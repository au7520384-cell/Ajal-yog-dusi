#!/usr/bin/env node
// The Playgama build (tools/build_crazy.py, PORTAL=playgama) with Bridge SaaS: Playgama's own leaderboard service (wiki: Bridge SDK -> SaaS). The real platform has no leaderboard of its own (type "not_available");
// with the PUBLIC token of the game's card in the developer dashboard in the config (saas.publicToken) Bridge reports "in_game" and sends setScore / getEntries to api.playgama.com/api/bridge/v1.
// This test runs the REAL Bridge SDK (fetched from bridge.playgama.com with curl, or taken from B8_BRIDGE_DIR) with its real "playgama" platform bridge on the real page of the build; only the platform's own SDK
// (playgama.com/platform-sdk/v1.js) is a stub and Playgama's backend (api.playgama.com) is a mock that answers like the SaaS client expects (JSON) and logs every request. No network = the test says SKIP.
//  - the build: PG_SAAS_TOKEN goes into the config as saas.publicToken and nothing else (the QA tool is NOT listed: it plays the leaderboard step through its own platform bridge); a token that is not a token stops the build
//  - without the saas block the real Bridge says not_available: no Playgama tab, no request to the backend, no score sent (the build of before)
//  - with it: type in_game; the leaderboard screen opens on the Playgama tab and GETs .../leaderboards/main with x-public-token / x-platform-id / x-player-id; the rows are drawn; the player's own row is marked
//  - the score goes with the visit and after a match (POST {score}) with the same headers
//  - the backend's answers the game does not control: a table in a wrapper is used; an error object, a non-JSON answer and a dead network all give the calm "can't reach" line, no page error
//  - a platform outside Playgama's own list (the "mock" platform stands for the QA tool: same rule) is NOT switched on by the token alone, only by saas.leaderboards.platforms (PG_SAAS_QA=1)
const { chromium } = require("playwright"), { spawnSync } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const TOKEN = "pk_test_0123456789abcdef", CDN = "https://bridge.playgama.com/v2/stable/", PORT = 8694, ORIGIN = "http://localhost:" + PORT;
const MIME = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4"};
const CORS = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-player-id,x-platform-id,x-public-token", "access-control-allow-methods": "GET,POST,OPTIONS" };
const ENT = [{ id: "a1", name: "Alpha", score: 1234567, rank: 1 }, { id: "pg-player-42", name: "Me", score: 98000, rank: 2 }, { id: "c3", name: "Charlie", score: 5000, rank: 3 }, { id: "d4", name: "Delta", score: 700, rank: 4 }];
const OLD = { name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000, adfree: true };

// the platform's own SDK (what bridge/platform-bridges/playgama.js asks of it), with the player's saved game inside
const PLATFORM_SDK = store => `(function () {
  var S = ${JSON.stringify(store)};
  window.PLAYGAMA_SDK = {
    advService: {subscribeToAdStateChanges: function () {}, showInterstitial: function () {}, showRewarded: function () {}, configureAdFrequency: function () { return Promise.resolve(false); }, checkAdBlock: function () { return Promise.resolve(false); }, showAdvancedBanners: function () { return Promise.resolve(); }, hideAdvancedBanners: function () {}},
    platformService: {isReady: Promise.resolve(), getAdditionalParams: function () { return {}; }, getLanguage: function () { return "en"; }, getIsPlayerAuthorizationSupported: function () { return false; }, getIsCloudSaveSupported: function () { return true; }, getIsPaymentsSupported: function () { return false; }, getPayload: function () { return null; }},
    userService: {getUser: function () { return Promise.resolve({id: "pg-player-42", isAuthorized: false}); }, authorizeUser: function () { return Promise.resolve(); }},
    gameService: {gameReady: function () { window.__gameReady = (window.__gameReady | 0) + 1; }, sendMessage: function () {}},
    storageApi: {setItems: function () {}, deleteItems: function () {}},
    cloudSaveApi: {getState: function () { return Promise.resolve(S); }, setItems: function () { return Promise.resolve(); }}};
})();`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pgs-")); let zip = process.env.PG_ZIP;
  // the real Bridge SDK
  const sdkDir = process.env.B8_BRIDGE_DIR || path.join(tmp, "bridge"); fs.mkdirSync(sdkDir, { recursive: true });
  const sdkFile = rel => { const f = path.join(sdkDir, rel); if (!fs.existsSync(f) || fs.statSync(f).size < 200) { fs.mkdirSync(path.dirname(f), { recursive: true }); spawnSync("curl", ["-sS", "-f", "-m", "60", "-o", f, CDN + rel]); } return fs.existsSync(f) && fs.statSync(f).size > 200 ? f : null; };
  if (!sdkFile("playgama-bridge.js") || !sdkFile("platform-bridges/playgama.js")) { console.log("SKIP: the Bridge SDK could not be fetched from " + CDN + " (no network): nothing was tested"); process.exit(0); }
  const sdkVersion = (fs.readFileSync(sdkFile("playgama-bridge.js"), "utf8").match(/get version\(\)\{return"([\d.]+)"\}/) || [])[1];
  console.log("Bridge SDK " + sdkVersion);

  // 0. the build
  const bad = spawnSync("/usr/bin/python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "badout")], { env: { ...process.env, PORTAL: "playgama", INLINE_UNDER: "6000", PG_SAAS_TOKEN: "not a token!" }, encoding: "utf8", maxBuffer: 1 << 26 });
  ok(bad.status !== 0 && /public token/.test((bad.stdout || "") + (bad.stderr || "")), "a token that is not a token stops the build (no zip with a broken config)", ((bad.stderr || "") + (bad.stdout || "")).slice(-300));
  if (!zip) {
    const r = spawnSync("/usr/bin/python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { env: { ...process.env, PORTAL: "playgama", INLINE_UNDER: "6000", PG_SAAS_TOKEN: TOKEN }, encoding: "utf8", maxBuffer: 1 << 26 });
    ok(r.status === 0, "the Playgama build with PG_SAAS_TOKEN is made", (r.stderr || "").slice(-400)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
    zip = path.join(tmp, "out", "bilyard8-playgama.zip");
  }
  const dir = path.join(tmp, "site"); fs.mkdirSync(dir); const u = spawnSync("/usr/bin/python3", ["-m", "zipfile", "-e", zip, dir]); ok(u.status === 0, "the zip unpacks");
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "playgama-bridge-config.json"), "utf8"));
  const token = cfg.saas && cfg.saas.publicToken;
  ok(typeof token === "string" && token.length >= 8 && (process.env.PG_ZIP || token === TOKEN), "the config carries the public token (saas.publicToken)", cfg.saas);
  ok(JSON.stringify(Object.keys(cfg.saas || {})) === '["publicToken"]' && !/qa_tool/.test(JSON.stringify(cfg)), "...and nothing else in saas: the QA tool is not listed (it plays the leaderboard step itself)", cfg.saas);
  ok(JSON.stringify(cfg.leaderboards) === '[{"id":"main","isMain":true}]', "the game-facing leaderboard id is 'main'", cfg.leaderboards);
  const noSaas = { ...cfg }; delete noSaas.saas;

  const srv = http.createServer((q, s) => { let f = path.join(dir, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
  await new Promise(r => srv.listen(PORT, r)); const b = await chromium.launch(), errs = [];

  // a page on the real SDK: platform = "playgama" (the page asks for it with ?platform_id=); config = what the build wrote (or without its saas block); the backend = this object
  const open = async (name, { saas = true, platform = "playgama", config } = {}) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    const be = { calls: [], get: () => ({ body: ENT }), dead: false, other: [] };
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await ctx.route(x => !/^http:\/\/localhost:\d+\//.test(x.href) && !/^(data|blob):/.test(x.href), async route => {
      const req = route.request(), url = req.url(), m = req.method();
      if (url.startsWith(CDN)) { const f = sdkFile(decodeURIComponent(new URL(url).pathname.replace("/v2/stable/", ""))); return f ? route.fulfill({ path: f, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" } }) : route.abort(); }
      if (url === "https://playgama.com/platform-sdk/v1.js") return route.fulfill({ contentType: "text/javascript", body: PLATFORM_SDK({ billiard8v2: JSON.stringify(OLD) }) });
      if (url.startsWith("https://api.playgama.com/")) {
        if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
        const path_ = new URL(url).pathname, J = { ...CORS, "content-type": "application/json" };
        if (path_ === "/api/bridge/v1/timestamp/now") return route.fulfill({ status: 200, headers: J, body: JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) }) });
        if (/^\/api\/bridge\/v1\/leaderboards\//.test(path_)) {
          be.calls.push({ method: m, path: path_, headers: req.headers(), body: req.postData() });
          if (be.dead) return route.abort();
          if (m === "GET") { const r = be.get(); return route.fulfill({ status: r.status || 200, headers: r.raw !== undefined ? { ...CORS, "content-type": "text/html" } : J, body: r.raw !== undefined ? r.raw : JSON.stringify(r.body) }); }
          return route.fulfill({ status: 200, headers: J, body: '{"ok":true}' });
        }
        if (/analytics/.test(path_)) return route.fulfill({ status: 200, headers: J, body: "{}" });
        be.other.push(m + " " + path_); return route.fulfill({ status: 200, headers: J, body: "{}" });
      }
      return route.abort();
    });
    if (config) await ctx.route(ORIGIN + "/playgama-bridge-config.json", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(config) }));
    await p.goto(ORIGIN + "/?platform_id=" + platform, { waitUntil: "commit" });
    await p.waitForFunction(() => window.bridge && window.bridge.isInitialized && typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
    await sleep(1500); p.be = be; return p;
  };
  const view = p => p.evaluate(() => ({ screen: (document.querySelector(".screen.on") || {}).id, scope: lbScope, tab: !!document.getElementById("lbPgTab") && getComputedStyle(document.getElementById("lbPgTab")).display !== "none", tabOn: !!document.querySelector("#lbPgTab.on"),
    rows: document.querySelectorAll("#lbList .lbr").length, text: document.getElementById("lbList").innerText, me: document.querySelectorAll("#lbList .lbr.me").length }));
  const lbCalls = (p, m) => p.be.calls.filter(c => !m || c.method === m);
  try {
    // 1. the build of before: no saas block -> the real Bridge says not_available on "playgama"
    let p = await open("nosaas", { config: noSaas });
    const i0 = await p.evaluate(() => ({ platform: bridge.platform.id, type: bridge.leaderboards.type, player: bridge.player.id, ready: bridge.isInitialized }));
    ok(i0.ready && i0.platform === "playgama" && i0.player === "pg-player-42", "the page runs on the REAL Bridge with its real 'playgama' platform bridge (player id from the platform's SDK)", i0);
    ok(i0.type === "not_available", "without the saas block the real Bridge says not_available on Playgama", i0.type);
    await p.evaluate(() => go("leader")); await sleep(700); let v = await view(p);
    ok(v.scope === "world" && !v.tab && lbCalls(p).length === 0, "...so the game shows no Playgama tab and asks the backend for nothing", { scope: v.scope, tab: v.tab, calls: lbCalls(p).length });
    await p.evaluate(() => { profile.won = 500; Y8.sdk.saveLeaderboardScore({ points: 500 }); }); await sleep(300);
    ok(lbCalls(p).length === 0, "...and sends no score", lbCalls(p));
    await p.context().close();

    // 2. the build with the token
    p = await open("saas");
    const i1 = await p.evaluate(() => ({ type: bridge.leaderboards.type, supported: typeof bridge.leaderboards.getEntries }));
    ok(i1.type === "in_game" && i1.supported === "function", "with the public token the real Bridge says in_game on Playgama", i1);
    ok(lbCalls(p).length === 0, "nothing is asked before the leaderboard is opened", lbCalls(p));
    await p.evaluate(() => go("leader")); await sleep(900); v = await view(p);
    ok(v.screen === "leader" && v.scope === "pg" && v.tab && v.tabOn, "the leaderboard screen opens on the visible Playgama tab", { screen: v.screen, scope: v.scope, tab: v.tab, tabOn: v.tabOn });
    const g = lbCalls(p, "GET");
    ok(g.length === 1 && g[0].path === "/api/bridge/v1/leaderboards/main", "the game asks the backend for the entries once: GET /api/bridge/v1/leaderboards/main", g.map(x => x.path));
    ok(g[0] && g[0].headers["x-public-token"] === token && g[0].headers["x-platform-id"] === "playgama" && g[0].headers["x-player-id"] === "pg-player-42", "...with the public token, the platform id and the player id in the headers", g[0] && g[0].headers);
    ok(v.rows === 4 && /Alpha/.test(v.text) && /Charlie/.test(v.text) && /1\.2M/.test(v.text) && v.me === 1, "the four rows are drawn (names, scores) and the player's own row is marked", { rows: v.rows, me: v.me, text: v.text.slice(0, 120) });
    // the score: with the visit, and after a match
    await p.evaluate(() => { profile.won = 777; go("home"); }); await sleep(200); await p.evaluate(() => go("leader")); await sleep(700);
    let po = lbCalls(p, "POST").filter(c => /"score":777\b/.test(c.body || ""));
    ok(po.length >= 1 && po[0].path === "/api/bridge/v1/leaderboards/main" && po[0].headers["x-public-token"] === token && po[0].headers["x-player-id"] === "pg-player-42", "opening the screen sends the player's total winnings: POST {score: 777} with the same headers", lbCalls(p, "POST").map(c => [c.path, c.body]));
    await p.evaluate(() => { Y8.sdk.saveLeaderboardScore({ points: 1234.7 }); }); await sleep(400);
    po = lbCalls(p, "POST").filter(c => /"score":1234\b/.test(c.body || ""));
    ok(po.length === 1, "after a match the total winnings go the same way: POST {score: 1234}", lbCalls(p, "POST").map(c => c.body));
    // the backend's other answers
    const reopen = async () => { await p.evaluate(() => go("home")); await sleep(200); await p.evaluate(() => go("leader")); await sleep(800); return view(p); };
    p.be.get = () => ({ body: { entries: ENT } }); v = await reopen();
    ok(v.scope === "pg" && v.rows === 4, "a table inside a wrapper ({entries: [...]}) is used", { scope: v.scope, rows: v.rows });
    p.be.get = () => ({ body: [] }); v = await reopen();
    ok(v.scope === "pg" && v.rows === 0 && v.text.trim().length > 0 && !/📡|Loading|Yuklanmoqda/i.test(v.text), "an empty table shows a short message (not the 'can't reach' line, not the loading text)", v.text);
    p.be.get = () => ({ body: { error: "Leaderboard not found" }, status: 404 }); v = await reopen();
    ok(v.scope === "pg" && v.rows === 0 && /📡/.test(v.text), "an error object (e.g. the leaderboard is not created in the dashboard yet) shows the calm 'can't reach' line", v.text);
    p.be.get = () => ({ raw: "<html>Bad gateway</html>", status: 502 }); v = await reopen();
    ok(v.scope === "pg" && v.rows === 0 && /📡/.test(v.text), "a non-JSON answer (a proxy's error page) shows the same line", v.text);
    p.be.dead = true; v = await reopen();
    ok(v.scope === "pg" && v.rows === 0 && /📡/.test(v.text), "a dead network shows the same line", v.text);
    await p.evaluate(() => go("home")); await sleep(300); ok(await p.evaluate(() => document.querySelector(".screen.on").id === "home"), "...and the screen can be left");
    // the game's own tabs
    p.be.dead = false; p.be.get = () => ({ body: ENT }); await p.evaluate(() => go("leader")); await sleep(600);
    await p.click('[data-lb="world"]'); await sleep(700); v = await view(p);
    ok(v.scope === "world" && !v.tabOn, "the game's own World tab still opens", { scope: v.scope });
    ok(p.be.other.length === 0, "the SDK asked the backend for nothing unexpected", p.be.other);
    await p.context().close();

    // 3. a platform outside Playgama's own list ("mock" stands for the QA tool: the same rule) is not switched on by the token alone
    p = await open("mock-token", { platform: "mock" });
    const i2 = await p.evaluate(() => ({ platform: bridge.platform.id, type: bridge.leaderboards.type }));
    ok(i2.platform === "mock" && i2.type === "not_available", "on a platform outside Playgama's list (here 'mock', like the QA tool) the token alone does not switch SaaS on: the platform's own type stays", i2);
    await p.context().close();
    p = await open("mock-listed", { platform: "mock", config: { ...cfg, saas: { publicToken: token, leaderboards: { platforms: ["mock"] } } } });
    ok(await p.evaluate(() => bridge.leaderboards.type) === "in_game", "...it takes saas.leaderboards.platforms to switch it on there (PG_SAAS_QA=1 does that for qa_tool)");
    await p.context().close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
