#!/usr/bin/env node
// The Playgama build (tools/build_crazy.py, PORTAL=playgama): a REAL pause. Playgama's certification (step "System Events") sends the platform's pause message 3 s after "Ready" and asks
// "Did the game pause?"; before this the build only went silent (the balls kept rolling, the turn clock kept running, the bot kept playing). The mock Bridge below can send PAUSE_STATE_CHANGED on demand.
//  - a solo / bot match: the balls stand still while the platform says pause, and roll on from the same place after "go on"
//  - the turn clock (number and ring) holds: after a 2.5 s pause the player still has the same time (a control without a pause loses 2.5 s)
//  - the bot's thinking / aiming stands still and goes on
//  - a match that starts while the platform is paused stands still until "go on" (the ad before a match: its "closed" message and the "go on" message come in either order)
//  - an ONLINE match (G.net) is only silenced: its clock keeps running (the opponent's phone cannot wait for one side)
//  - the safety valve: a "go on" message that never comes does not freeze the solo matches for good (a visible page paused for B8_PAUSE_MAX goes on by itself)
//  - the platform's silence (window.__B8_MUTE) is on while paused and off after; the page has no errors; no localStorage use
const { chromium } = require("playwright"), { spawnSync } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };

const MOCK = store => `(function () {
  var L = {}; function on(ev, cb) { (L[ev] = L[ev] || []).push(cb); } function emit(ev, v) { (L[ev] || []).forEach(function (f) { f(v); }); }
  var EV = {INTERSTITIAL_STATE_CHANGED: "is", REWARDED_STATE_CHANGED: "rs", AUDIO_STATE_CHANGED: "as", PAUSE_STATE_CHANGED: "ps"}, S = ${JSON.stringify(store)};
  window.__emit = emit;   // the test sends the platform's messages through this: __emit("ps", true) = pause, __emit("ps", false) = go on
  window.bridge = {EVENT_NAME: EV, initialize: function () { return Promise.resolve(); },
    storage: {get: function (ks) { return Promise.resolve(ks.map(function (k) { return k in S ? S[k] : null; })); }, set: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); }},
    platform: {language: "en", isAudioEnabled: true, on: on, sendMessage: function () { return Promise.resolve(); }},
    advertisement: {isInterstitialSupported: false, isRewardedSupported: false, on: on, showInterstitial: function () {}},
    achievements: {unlock: function () { return Promise.resolve(); }}, leaderboards: {type: "not_available"}};
})();`;

const MIME = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4"};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pgp-")); let zip = process.env.PG_ZIP;
  if (!zip) {
    const r = spawnSync("/usr/bin/python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { env: { ...process.env, PORTAL: "playgama", INLINE_UNDER: "6000" }, encoding: "utf8", maxBuffer: 1 << 26 });
    ok(r.status === 0, "the Playgama build is made (build_crazy.py PORTAL=playgama)", (r.stderr || "").slice(-400)); if (r.status) { console.log(`pass ${pass}, fail ${fail}`); process.exit(1); }
    zip = path.join(tmp, "out", "bilyard8-playgama.zip");
  }
  const dir = path.join(tmp, "site"); fs.mkdirSync(dir); const u = spawnSync("/usr/bin/python3", ["-m", "zipfile", "-e", zip, dir]); ok(u.status === 0, "the zip unpacks");
  const srv = http.createServer((q, s) => { let f = path.join(dir, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); }); });
  await new Promise(r => srv.listen(8682, r)); const b = await chromium.launch(), errs = [];
  // an ad-free returning player: no ad is in the way, the tutorial is done
  const OLD = { name: "Old", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000, adfree: true };
  const open = async name => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await ctx.route(x => !/^http:\/\/localhost:8682\//.test(x.href) && !/^(data|blob):/.test(x.href), r => r.abort());
    await ctx.route("https://bridge.playgama.com/**", r => r.fulfill({ contentType: "text/javascript", body: MOCK({ billiard8v2: JSON.stringify(OLD) }) }));
    await p.goto("http://localhost:8682/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }).catch(() => {});
    await sleep(1500); return p;
  };
  // a bot match; who plays first is set by the test (cur: 0 = the player, 1 = the bot); the turn clock is restarted for that player
  const match = (p, cur) => p.evaluate(c => { startMatch("ai", CITIES[0], botPlayer(1, 4), null, true); return new Promise(res => { const t = setInterval(() => { if (mode === "game" && game && !game.demo) { clearInterval(t); game.cur = c; nextTurn(true); game.intro = null; res(true); } }, 50); }); }, cur);
  const snap = p => p.evaluate(() => ({ b: game.balls.map(x => Math.round(x.x * 100) + "," + Math.round(x.y * 100)).join(";"), moving: !!game.moving, over: !!game.over, left: game.turnLimit ? +(game.turnLimit - (performance.now() - game.turnStart) / 1000).toFixed(2) : null, lim: game.turnLimit,
    aiT: game.aiTask ? game.aiTask.t : -1, hasAi: !!(game.aiTask || game.aiGen), ang: +game.angle.toFixed(4), cur: game.cur, mute: window.__B8_MUTE === true, frz: typeof b8Frz === "function" ? b8Frz() : false }));   // (an older build has no b8Frz: the checks then fail on what the player sees)
  const pause = (p, on) => p.evaluate(v => window.__emit("ps", v), on);
  try {
    let p = await open("pause");
    ok(await p.evaluate(() => typeof b8Frz === "function" && typeof b8Pause === "function" && b8Frz() === false && window.__B8_MUTE !== true), "the pause code is in the Playgama page; nothing is frozen or silent before a pause message");

    // 1. the balls: a break is rolling, the platform says pause -> they stand still; "go on" -> they roll on
    await match(p, 0); await sleep(500);
    await p.evaluate(() => requestShot(1)); await sleep(700);
    let s0 = await snap(p); ok(s0.moving, "the break is rolling before the pause", s0);
    await pause(p, true); await sleep(300); let s1 = await snap(p); await sleep(1500); let s2 = await snap(p);
    ok(s1.b === s2.b && s2.moving && !s2.over, "the balls stand still for 1.5 s while the platform says pause (and the shot is still on)", [s1.b.slice(0, 60), s2.b.slice(0, 60), s2.moving]);
    ok(s1.frz && s2.mute, "the match is frozen and the game is silent during the pause", { frz: s1.frz, mute: s2.mute });
    await pause(p, false); await sleep(500); let s3 = await snap(p);
    ok(s3.b !== s2.b, "the balls roll on after the platform says 'go on'");
    ok(!s3.mute && !s3.frz, "silence and freeze are off after 'go on'", s3);
    // (a control for the measurement: with no pause the same wait moves the balls)
    await sleep(100); let s4 = await snap(p); await sleep(400); let s5 = await snap(p);
    ok(!s4.moving || s4.b !== s5.b, "(control) without a pause the balls keep moving", [s4.moving]);

    // 2. the turn clock: the player's turn, 2.5 s of pause -> the same time is left; a control without a pause loses the time
    await match(p, 0); await sleep(400);
    let c0 = await snap(p); ok(c0.lim > 0 && c0.left > 0, "the player has a turn clock in a bot match", c0);
    await sleep(2500); let c1 = await snap(p); ok(c0.left - c1.left > 2.0 && c0.left - c1.left < 3.2, "(control) without a pause the turn clock loses about 2.5 s in 2.5 s", [c0.left, c1.left]);
    await pause(p, true); await sleep(200); let c2 = await snap(p); await sleep(2500); let c3 = await snap(p); await pause(p, false); await sleep(1000); let c4 = await snap(p);
    ok(Math.abs(c2.left - c3.left) < 0.12, "the turn clock does not run during a 2.5 s pause", [c2.left, c3.left]);
    ok(c3.left - c4.left > 0.6 && c3.left - c4.left < 1.8, "...and runs again after 'go on' (about 1 s in the next second)", [c3.left, c4.left]);
    ok(c2.left > c1.left - 0.6, "the pause did not eat the player's time: about what was left when it began", [c1.left, c2.left, c4.left]);

    // 3. the bot: its aiming and thinking stand still during a pause and go on after it
    await match(p, 1);
    await p.waitForFunction(() => game.aiTask && game.aiTask.t > 3, null, { timeout: 15000 }).catch(() => {});
    let a0 = await snap(p); ok(a0.aiT > 3, "the bot is aiming (its task is running)", a0);
    await pause(p, true); await sleep(250); let a1 = await snap(p); await sleep(1500); let a2 = await snap(p);
    ok(a1.aiT === a2.aiT && a1.ang === a2.ang && !a2.moving, "the bot stands still during the pause (the same step, the same angle, no shot)", [a1.aiT, a2.aiT, a1.ang, a2.ang]);
    await pause(p, false); await sleep(900); let a3 = await snap(p);
    ok(a3.aiT !== a2.aiT || a3.moving || !a3.hasAi, "the bot goes on after 'go on'", [a2.aiT, a3.aiT, a3.moving]);

    // 4. a match that starts while the platform is paused (the ad before a match: its "closed" and the "go on" message come in either order) stands still until "go on"
    await p.evaluate(() => toMenu("home")); await sleep(500);
    await pause(p, true); await sleep(200);
    await match(p, 0); await sleep(300); let m0 = await snap(p); await sleep(2000); let m1 = await snap(p);
    ok(Math.abs(m0.left - m1.left) < 0.12, "a match that starts during the pause keeps its whole turn time until 'go on'", [m0.left, m1.left, m0.lim]);
    await pause(p, false); await sleep(1000); let m2 = await snap(p);
    ok(m1.left - m2.left > 0.6 && m1.left - m2.left < 1.8 && m2.left > m0.lim - 2.5, "...then the clock starts from the full time (no time was spent while paused)", [m1.left, m2.left, m0.lim]);

    // 5. an ONLINE match is only silenced: its clock goes on (the opponent's phone runs its own clock)
    await match(p, 0); await sleep(300);
    await p.evaluate(() => { game.net = { seat: 0, room: "", lastAim: 0, sentA: null }; });
    let n0 = await snap(p); await pause(p, true); await sleep(1800); let n1 = await snap(p);
    ok(n1.mute && !n1.frz, "an online match is silenced but not frozen during the pause", { mute: n1.mute, frz: n1.frz });
    ok(n0.left - n1.left > 1.4, "...its turn clock goes on during the pause (the opponent's clock does)", [n0.left, n1.left]);
    await pause(p, false); await sleep(200); ok(!(await snap(p)).mute, "(and the silence ends with 'go on')");
    await p.evaluate(() => { game.net = null; });

    // 6. the safety valve: a "go on" that never comes ends the freeze of a visible page by itself (here after 1.5 s instead of 3 minutes)
    await match(p, 0); await p.evaluate(() => { B8_PAUSE_MAX = 1500; });
    await pause(p, true); await sleep(400); let v0 = await snap(p); ok(v0.frz && v0.mute, "frozen at first (the valve has not fired yet)", v0);
    await sleep(3200); let v1 = await snap(p); await sleep(1000); let v2 = await snap(p);
    ok(!v1.frz && !v1.mute, "a pause with no 'go on' ends by itself after B8_PAUSE_MAX on a visible page (the match is not frozen for good, the sound is back)", v1);
    ok(v1.left - v2.left > 0.6, "...and the turn clock runs again", [v1.left, v2.left]);
    await p.evaluate(() => { B8_PAUSE_MAX = 180000; });

    ok(await p.evaluate(() => !("b8" in localStorage) && localStorage.length === 0), "nothing is written to localStorage");
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
    await p.context().close();
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
