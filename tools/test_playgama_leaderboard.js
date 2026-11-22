#!/usr/bin/env node
// The Playgama build (tools/build_crazy.py, PORTAL=playgama): the platform's leaderboard in "in_game" mode. Playgama's certification step "Leaderboards" (the QA tool) said
// "Leaderboard entries were not requested: when opening the leaderboard the game did not request player data. In In-Game mode you must fetch entries from the platform."
// (bridge.leaderboards.type === "in_game": the platform keeps the scores - setScore - and the game draws the table from getEntries(id)). The mock Bridge below can be in any mode and logs every call.
//  - in_game: the leaderboard screen opens on a "Playgama" tab and asks the platform for the entries ONCE when it opens (getEntries("main")); the rows show rank, name and score; the top three get medals; a name with markup is shown as text;
//    a picture that cannot load falls back; the game's own tabs (World ...) still work and the Playgama tab asks again when it is chosen; the screen opens on the Playgama tab again the next time
//  - an empty answer and a failed request leave a calm message, no page error
//  - not_available (the real Playgama platform today) and native_popup: no tab, no request, the screen is the game's own as before
//  - the score goes to the platform (setScore("main", points)) in in_game and not in not_available
const { chromium } = require("playwright"), { spawnSync } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };

const MOCK = (store, lb) => `(function () {
  var L = {}; function on(ev, cb) { (L[ev] = L[ev] || []).push(cb); }
  var EV = {INTERSTITIAL_STATE_CHANGED: "is", REWARDED_STATE_CHANGED: "rs", AUDIO_STATE_CHANGED: "as", PAUSE_STATE_CHANGED: "ps"}, S = ${JSON.stringify(store)}, LB = ${JSON.stringify(lb)};
  window.__lb = [];   // what the game asked the platform
  window.bridge = {EVENT_NAME: EV, initialize: function () { return Promise.resolve(); },
    storage: {get: function (ks) { return Promise.resolve(ks.map(function (k) { return k in S ? S[k] : null; })); }, set: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); }},
    platform: {language: "en", isAudioEnabled: true, on: on, sendMessage: function () { return Promise.resolve(); }},
    advertisement: {isInterstitialSupported: false, isRewardedSupported: false, on: on, showInterstitial: function () {}},
    achievements: {unlock: function () { return Promise.resolve(); }},
    player: {id: "p-me"},
    leaderboards: {type: LB.type,
      setScore: function (id, s) { window.__lb.push("set:" + id + ":" + s); return Promise.resolve(); },
      getEntries: function (id) { window.__lb.push("get:" + id); return LB.reject ? Promise.reject(new Error("no")) : new Promise(function (r) { setTimeout(function () { r(LB.entries || []); }, 60); }); },
      showNativePopup: function (id) { window.__lb.push("popup:" + id); return Promise.resolve(); }}};
})();`;

const MIME = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4"};
const ENT = [
  { id: "a1", name: "Alpha", score: 1234567, rank: 1, photo: "https://example.invalid/a.png" },
  { id: "p-me", name: "Me <b>bold</b>", score: 98000, rank: 2, photo: "" },
  { id: "c3", name: "<img src=x onerror=\"window.__xss=1\">Mallory", score: 5000, rank: 3 },
  { id: "d4", name: "Delta", score: 700, rank: 4, photo: "javascript:alert(1)" },
  { id: "e5", name: "Echo", score: 12, rank: 5 }];

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pgl-")); let zip = process.env.PG_ZIP;
  if (!zip) {
    const r = spawnSync("/usr/bin/python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { env: { ...process.env, PORTAL: "playgama", INLINE_UNDER: "6000" }, encoding: "utf8", maxBuffer: 1 << 26 });
    ok(r.status === 0, "the Playgama build is made (build_crazy.py PORTAL=playgama)", (r.stderr || "").slice(-400)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
    zip = path.join(tmp, "out", "bilyard8-playgama.zip");
  }
  const dir = path.join(tmp, "site"); fs.mkdirSync(dir); const u = spawnSync("/usr/bin/python3", ["-m", "zipfile", "-e", zip, dir]); ok(u.status === 0, "the zip unpacks");
  const srv = http.createServer((q, s) => { let f = path.join(dir, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
  await new Promise(r => srv.listen(8687, r)); const b = await chromium.launch(), errs = [];
  const OLD = { name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000, adfree: true };
  const open = async (name, lb) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await ctx.route(x => !/^http:\/\/localhost:8687\//.test(x.href) && !/^(data|blob):/.test(x.href), r => r.abort());
    await ctx.route("https://example.invalid/**", r => r.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }));   // (the one photo of the test entries)
    await ctx.route("https://bridge.playgama.com/**", r => r.fulfill({ contentType: "text/javascript", body: MOCK({ billiard8v2: JSON.stringify(OLD) }, lb) }));
    await p.goto("http://localhost:8687/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
    await sleep(1500); return p;
  };
  const gets = p => p.evaluate(() => window.__lb.filter(x => x.startsWith("get:")).length);
  const view = p => p.evaluate(() => ({ screen: (document.querySelector(".screen.on") || {}).id, scope: lbScope, tab: !!document.getElementById("lbPgTab") && getComputedStyle(document.getElementById("lbPgTab")).display !== "none", tabOn: !!document.querySelector("#lbPgTab.on"),
    rows: document.querySelectorAll("#lbList .lbr").length, text: document.getElementById("lbList").innerText, cols: getComputedStyle(document.querySelector("#leader .lbcols")).display, head: document.getElementById("lbInfo").innerText }));
  try {
    // 1. in_game with entries
    let p = await open("ingame", { type: "in_game", entries: ENT });
    ok(await p.evaluate(() => typeof pgLeader === "function" && typeof pgLbOn === "function" && pgLbOn() === true), "the leaderboard code is in the Playgama page and sees the in_game mode");
    ok((await gets(p)) === 0, "nothing is asked before the leaderboard is opened");
    await p.evaluate(() => go("leader")); await sleep(700);
    let v = await view(p);
    ok(v.screen === "leader" && v.scope === "pg" && v.tab && v.tabOn, "the leaderboard screen opens on the visible Playgama tab", { screen: v.screen, scope: v.scope, tab: v.tab, tabOn: v.tabOn });
    ok((await gets(p)) === 1 && (await p.evaluate(() => window.__lb.includes("get:main"))), "the game asks the platform for the entries once, when the screen opens (getEntries('main'))", await p.evaluate(() => window.__lb));
    ok(v.rows === 5 && v.cols === "none", "five rows are drawn and the 'weekly winnings' header of the game's own tabs is hidden", { rows: v.rows, cols: v.cols });
    ok(/Alpha/.test(v.text) && /Delta/.test(v.text) && /Echo/.test(v.text) && /1\.2M/.test(v.text), "names and scores are shown (1 234 567 -> 1.2M)", v.text.slice(0, 160));
    ok(await p.evaluate(() => document.querySelectorAll("#lbList .lbr.r1 .lbmd, #lbList .lbr.r2 .lbmd, #lbList .lbr.r3 .lbmd").length === 3 && document.querySelectorAll("#lbList .lbr .rkn").length === 2), "ranks 1-3 have a medal, ranks 4 and 5 a number");
    ok(await p.evaluate(() => !window.__xss && !document.querySelector('#lbList img[src="x"]') && /Mallory/.test(document.getElementById("lbList").innerText) && /<b>bold<\/b>/.test(document.getElementById("lbList").innerText)), "a name with markup is shown as plain text (nothing is injected)");
    ok(await p.evaluate(() => document.querySelectorAll("#lbList .lbr.me").length === 1 && /Me /.test(document.querySelector("#lbList .lbr.me").innerText)), "the player's own row (bridge.player.id) is marked");
    ok(await p.evaluate(() => { const im = Array.from(document.querySelectorAll("#lbList .avc img")); return !im.some(i => /^javascript:/i.test(i.getAttribute("src") || "")) && (() => { const pl = im.filter(i => i.getAttribute("referrerpolicy") === "no-referrer"); return pl.length === 1 && pl.every(i => /^https:\/\//.test(i.getAttribute("src") || "")); })(); }), "only https pictures come from the platform (a javascript: photo is ignored; the others get the game's own avatar)");
    // 2. the game's own tab still works, and the Playgama tab asks again when it is chosen
    await p.click('[data-lb="world"]'); await sleep(900); v = await view(p);
    ok(v.scope === "world" && !v.tabOn && v.cols !== "none", "the game's own World tab opens (its header is back)", { scope: v.scope, cols: v.cols });
    ok(/Can't reach the server|Yuklanmoqda|Loading/i.test(v.text) || v.rows >= 1, "...and shows its own content (here: no server)", v.text.slice(0, 100));
    ok((await gets(p)) === 1, "the game's own tab does not ask the platform");
    await p.click('[data-lb="pg"]'); await sleep(500); v = await view(p);
    ok(v.scope === "pg" && v.rows === 5 && (await gets(p)) === 2, "choosing the Playgama tab asks again and shows the rows", { scope: v.scope, rows: v.rows });
    // 3. the next opening starts on the Playgama tab again
    await p.click('[data-lb="world"]'); await sleep(300);
    await p.evaluate(() => go("home")); await sleep(300); await p.evaluate(() => go("leader")); await sleep(600); v = await view(p);
    ok(v.scope === "pg" && v.rows === 5 && (await gets(p)) === 3, "opening the screen again starts on the Playgama tab (asks again)", { scope: v.scope, rows: v.rows, gets: await gets(p) });
    // 3b. the total winnings go to the platform with the visit (the player is in the table), without holding the entries back
    await p.evaluate(() => { profile.won = 777; window.__lb.length = 0; go("home"); }); await sleep(200); await p.evaluate(() => go("leader")); await sleep(600);
    ok(await p.evaluate(() => window.__lb.includes("set:main:777") && window.__lb.includes("get:main")), "opening the screen also sends the player's total winnings (setScore) and still asks for the entries", await p.evaluate(() => window.__lb));
    // 4. the score goes to the platform
    await p.evaluate(() => { window.__lb.length = 0; Y8.sdk.saveLeaderboardScore({ points: 1234.7 }); }); await sleep(200);
    ok(await p.evaluate(() => window.__lb.includes("set:main:1234")), "the total winnings go to the platform's leaderboard: setScore('main', 1234)", await p.evaluate(() => window.__lb));
    await p.context().close();

    // 5. an empty table and a failed request: a calm message, no errors
    p = await open("empty", { type: "in_game", entries: [] }); await p.evaluate(() => go("leader")); await sleep(600); v = await view(p);
    ok(v.scope === "pg" && v.rows === 0 && v.text.trim().length > 0 && !/Loading|Yuklanmoqda/i.test(v.text), "an empty answer shows a short message, not the loading text", v.text);
    await p.context().close();
    p = await open("reject", { type: "in_game", reject: true }); await p.evaluate(() => go("leader")); await sleep(600); v = await view(p);
    ok(v.scope === "pg" && v.rows === 0 && /📡/.test(v.text), "a failed request shows the 'can't reach' message", v.text);
    await p.evaluate(() => go("home")); await sleep(300); ok(await p.evaluate(() => document.querySelector(".screen.on").id === "home"), "...and the screen can be left");
    await p.context().close();

    // 6. the other modes: no tab, no request, the game's own screen
    for (const type of ["not_available", "native_popup"]) {
      p = await open(type, { type, entries: ENT }); await p.evaluate(() => go("leader")); await sleep(900); v = await view(p);
      ok(v.scope === "world" && !v.tab && !v.tabOn && (await gets(p)) === 0 && v.cols !== "none", type + ": no Playgama tab, no request, the game's own World screen as before", { scope: v.scope, tab: v.tab, gets: await gets(p), cols: v.cols });
      if (type === "not_available") { await p.evaluate(() => { window.__lb.length = 0; Y8.sdk.saveLeaderboardScore({ points: 500 }); }); await sleep(200); ok(await p.evaluate(() => window.__lb.length === 0), "not_available: no score is sent"); }
      await p.context().close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
