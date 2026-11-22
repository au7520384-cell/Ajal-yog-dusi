#!/usr/bin/env node
// The Playgama build (tools/build_crazy.py, PORTAL=playgama): achievements through Playgama's Bridge (wiki.playgama.com, Achievements): declare them in playgama-bridge-config.json (id / name / description) and call
// bridge.achievements.unlock(id) ONCE, when it is earned. The game has 71 of them: the 9 main ones (ACHS, unlock()) and the 62 of the second set (ACH2, profile.ach2, checkAch()).
//  - the config declares exactly the game's 71 ids with English names and descriptions; they are the texts the game itself shows (tools/pg_achievements.json is current); the first nine keep their Y8 mapping, the others have none
//  - a main achievement earned in the game is unlocked on the platform once (a second award sends nothing)
//  - a second-set achievement earned in checkAch() is unlocked once; two earned at the same moment are both sent
//  - what the player earned BEFORE this build (profile.ach / profile.ach2) is sent once after game_ready (profile.pgAchSync), and not again on the next visit
//  - no page errors; nothing is written to localStorage
const { chromium } = require("playwright"), { spawnSync } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };

const MOCK = store => `(function () {
  var L = {}; function on(ev, cb) { (L[ev] = L[ev] || []).push(cb); }
  var EV = {INTERSTITIAL_STATE_CHANGED: "is", REWARDED_STATE_CHANGED: "rs", AUDIO_STATE_CHANGED: "as", PAUSE_STATE_CHANGED: "ps"}, S = ${JSON.stringify(store)};
  window.__ach = [];   // every unlock the game asked for
  window.bridge = {EVENT_NAME: EV, initialize: function () { return Promise.resolve(); },
    storage: {get: function (ks) { return Promise.resolve(ks.map(function (k) { return k in S ? S[k] : null; })); }, set: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); }},
    platform: {language: "en", isAudioEnabled: true, on: on, sendMessage: function () { return Promise.resolve(); }},
    advertisement: {isInterstitialSupported: false, isRewardedSupported: false, on: on, showInterstitial: function () {}},
    achievements: {unlock: function (id) { window.__ach.push(id); return Promise.resolve(); }, getAchievements: function () { return Promise.resolve([]); }},
    leaderboards: {type: "not_available"}};
})();`;
const MIME = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4"};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pga-")); let zip = process.env.PG_ZIP;
  if (!zip) {
    const r = spawnSync("/usr/bin/python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { env: { ...process.env, PORTAL: "playgama", INLINE_UNDER: "6000" }, encoding: "utf8", maxBuffer: 1 << 26 });
    ok(r.status === 0, "the Playgama build is made (build_crazy.py PORTAL=playgama)", (r.stderr || "").slice(-400)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
    zip = path.join(tmp, "out", "bilyard8-playgama.zip");
  }
  const dir = path.join(tmp, "site"); fs.mkdirSync(dir); const u = spawnSync("/usr/bin/python3", ["-m", "zipfile", "-e", zip, dir]); ok(u.status === 0, "the zip unpacks");
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "playgama-bridge-config.json"), "utf8")), ach = cfg.achievements || [];
  const MAIN = ["first_win", "double", "breakpot", "runout", "champ", "lucky", "streak7", "rich", "collector"];
  ok(ach.length === 71 && new Set(ach.map(a => a.id)).size === 71, "the config declares 71 distinct achievements", ach.length);
  ok(ach.every(a => typeof a.name === "string" && a.name.trim() && typeof a.description === "string" && a.description.trim()), "each has an English name and a description");
  ok(MAIN.every(k => { const a = ach.find(x => x.id === k); return a && a.y8 && a.y8.achievementkey === k && a.y8.achievement; }) && ach.filter(a => a.y8).length === 9, "the first nine keep their Y8 mapping, the other 62 have none");
  const srv = http.createServer((q, s) => { let f = path.join(dir, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
  await new Promise(r => srv.listen(8692, r)); const b = await chromium.launch(), errs = [];
  const BASE = { name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000, adfree: true };
  const open = async (name, extra) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await ctx.route(x => !/^http:\/\/localhost:8692\//.test(x.href) && !/^(data|blob):/.test(x.href), r => r.abort());
    await ctx.route("https://bridge.playgama.com/**", r => r.fulfill({ contentType: "text/javascript", body: MOCK({ billiard8v2: JSON.stringify({ ...BASE, ...extra }) }) }));
    await p.goto("http://localhost:8692/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
    await sleep(1200); return p;
  };
  const log = p => p.evaluate(() => window.__ach.slice());
  try {
    // 1. the config is what the game shows
    let p = await open("fresh", {});
    const game = await p.evaluate(() => [...Object.entries(ACHS).map(([id, a]) => ({ id, name: T(a.name), description: T(a.d) })), ...ACH2.map(a => ({ id: a.id, name: T(a.name), description: T(a.d) }))]);
    ok(JSON.stringify(game.map(a => a.id)) === JSON.stringify(ach.map(a => a.id)), "the config has exactly the game's achievements, in its order (run: node tools/pg_achievements.js)", { game: game.length, cfg: ach.length });
    ok(game.every((g, i) => ach[i] && ach[i].name === g.name && ach[i].description === g.description), "...with the names and descriptions the game shows in English (tools/pg_achievements.json is current)", game.filter((g, i) => !ach[i] || ach[i].name !== g.name || ach[i].description !== g.description).slice(0, 3));
    ok((await log(p)).length === 0, "a player with nothing earned sends nothing");
    // 2. earned in the game: a main one (once), then the second set
    await p.evaluate(() => { unlock("first_win"); unlock("first_win"); }); await sleep(300);
    let l = await log(p); ok(l.length === 1 && l[0] === "first_win", "a main achievement earned in the game is unlocked on the platform, once (a second award sends nothing)", l);
    await p.evaluate(() => { profile.wins = 1; checkAch(); checkAch(); }); await sleep(300); l = await log(p);
    ok(l.filter(x => x === "w1").length === 1, "a second-set achievement (w1: win 1 game) earned in checkAch() is unlocked once", l);
    await p.evaluate(() => { profile.level = 25; checkAch(); }); await sleep(300); l = await log(p);
    ok(l.includes("l10") && l.includes("l25") && l.filter(x => x === "l10").length === 1, "two earned at the same moment (levels 10 and 25) are both sent", l);
    ok(l.every(id => ach.some(a => a.id === id)), "every id sent is declared in the config", l);
    await p.context().close();

    // 3. what was earned before this build is sent once, after game_ready
    p = await open("old", { ach: { first_win: "2026-11-01", rich: "2026-11-02" }, ach2: { w1: 1, l10: 2, city_lon: 3 } });
    await sleep(10000); l = await log(p);
    ok(["first_win", "rich", "w1", "l10", "city_lon"].every(x => l.includes(x)) && l.length === 5, "the achievements a player earned before are sent once after game_ready", l);
    ok(await p.evaluate(() => profile.pgAchSync === 1), "...and it is remembered (profile.pgAchSync)");
    await p.evaluate(() => { window.__ach.length = 0; pgAchSync(); }); await sleep(200);
    ok((await log(p)).length === 0, "a second sync sends nothing");
    ok(await p.evaluate(() => !("b8" in localStorage) && localStorage.length === 0), "nothing is written to localStorage");
    await p.context().close();
    p = await open("synced", { pgAchSync: 1, ach: { first_win: "2026-11-01" }, ach2: { w1: 1 } });
    await sleep(10000); ok((await log(p)).length === 0, "the next visit (marker set) sends nothing again", await log(p));
    await p.context().close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
