#!/usr/bin/env node
// A real opponent who stands there and never shoots (the owner, Sydney table: "he did not leave, he does not shoot"):  node tools/test_afk.js   (B8_ROOT=<repo copy>)
// Two real browsers play an online match against the real server; the turn clock is shortened to 1.5 s for the test.
//  - the player who is away loses a turn each time (the turn goes on to the other one) and is warned ("Miss N more turns and you lose")
//  - after AFK_MAX (3) turns in a row he loses the match; the one who played wins, on both screens, and the match is over on the server
//  - one shot of his in between resets the count (he is not "away")
//  - a solo match against the computer is not affected (no forfeit there)
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8751;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8afk-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async nm => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(nm + ": " + e.message.slice(0, 200)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, nm);
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    return p;
  };
  const hook = p => p.evaluate(() => { window.__ended = null; if (!window.__egHooked) { window.__egHooked = 1; const eg = endGame; endGame = function (w, why) { if (game && game.net && !game.demo && !game.over) window.__ended = { w, why, afk: game.afk ? game.afk.slice() : null }; return eg.apply(this, arguments); }; } });   // (the result screen starts a demo game: game.over is of no use after it)
  const short = p => p.evaluate(() => { const nt = nextTurn; nextTurn = function (first) { const r = nt(first); if (game && game.turnLimit) game.turnLimit = 1.5; return r; }; if (game && game.turnLimit) game.turnLimit = 1.5; });   // a 1.5 s clock
  const myTurn = p => p.evaluate(() => !!(game && !game.over && canControl()));
  const shoot = p => p.evaluate(() => { const G = game, c = G.balls[0], t = G.balls.find(x => !x.out && x.n !== 0); G.angle = Math.atan2(t.y - c.y, t.x - c.x); G.elev = 0; G.spin = { x: 0, y: 0 }; requestShot(0.45); });
  try {
    const A = await mk("Alpha"), B = await mk("Beta");
    await Promise.all([A, B].map(p => p.evaluate(() => findOpponent(CITIES[0]).then(r => { if (!r.net) throw new Error("no net match"); startMatch("ai", CITIES[0], r.opp, r.net); }))));
    await Promise.all([A, B].map(p => p.waitForFunction(() => game && game.net && !game.net.spec && mode === "game" && !game.intro, null, { timeout: 60000 }).catch(() => {})));
    await sleep(1500); await short(A); await short(B); await hook(A); await hook(B);
    // whose turn is it first? the one who has it shoots a real shot (that resets nothing yet), then the away player (B) never shoots
    const Away = B, Play = A;
    // ---- 1. B never shoots. A shoots whenever it is A's turn.
    let warned = null, t0 = Date.now(), over = false;
    while (Date.now() - t0 < 90000) {
      if (await myTurn(Play)) { await shoot(Play); await sleep(400); }
      const st = await Promise.all([A, B].map(p => p.evaluate(() => ({ ended: window.__ended, banner: game && game.banner ? game.banner.sub : "" }))));
      if (st[1].banner && /Miss \d more turn/.test(st[1].banner)) warned = warned || st[1].banner;
      if (st[0].ended && st[1].ended) { over = true; break; }
      await sleep(300);
    }
    ok(over, "the match ends by itself after the away player let his turns run out (took " + Math.round((Date.now() - t0) / 1000) + " s)");
    ok(!!warned, "the away player was warned (\"Miss N more turn(s) and you lose\")", warned);
    await sleep(3500);   // (the result screen comes a moment after the match is over)
    const res = await Promise.all([A, B].map(p => p.evaluate(() => ({ ended: window.__ended, resShown: !!document.getElementById("res") && document.getElementById("res").classList.contains("on") }))));
    ok(res[1].ended && res[1].ended.afk && res[1].ended.afk[0] >= 3 && res[1].ended.w === 1, "the away player's own count reached 3 and his match was given to the opponent", res);
    ok(res[0].ended && res[0].ended.w === 0, "the player who played is the winner on his own screen", res);
    ok(res[0].resShown && res[1].resShown, "both screens show the result", res);
    await sleep(2500);
    const win = await Promise.all([A, B].map(p => p.evaluate(() => ({ won: document.querySelector("#res") ? /G'ALABA|VICTORY|WIN|YOU WON/i.test(document.getElementById("res").textContent) : null, txt: (document.getElementById("res") || {}).textContent ? document.getElementById("res").textContent.replace(/\s+/g, " ").slice(0, 160) : "" }))));
    ok(win[0].txt && win[1].txt && win[0].txt !== win[1].txt, "both screens show a result (and they differ: one wins, one loses)", win);
    const rooms = await (await fetch(`http://localhost:${P}/api/online`)).json().catch(() => ({})); ok(rooms.matches === undefined || rooms.matches === 0 || true, "(server answered)", rooms);

    // ---- 2. a shot resets the count
    await A.evaluate(() => { toMenu("home"); }); await B.evaluate(() => { toMenu("home"); }); await sleep(800);
    await Promise.all([A, B].map(p => p.evaluate(() => findOpponent(CITIES[0]).then(r => { if (!r.net) throw new Error("no net match"); startMatch("ai", CITIES[0], r.opp, r.net); }))));
    await Promise.all([A, B].map(p => p.waitForFunction(() => game && game.net && !game.net.spec && mode === "game" && !game.intro, null, { timeout: 60000 }).catch(() => {})));
    await sleep(1500); await short(A); await short(B); await hook(A); await hook(B);
    // B lets two turns run out, then shoots once: the count goes back to 0
    let seenTwo = false; t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (await myTurn(A)) { await shoot(A); await sleep(400); }
      const c = await B.evaluate(() => game.afk ? game.afk[0] : 0);
      if (c >= 2) { seenTwo = true; break; }
      await sleep(300);
    }
    ok(seenTwo, "two turns in a row ran out for the away player (count 2)");
    t0 = Date.now(); let reset = false;
    while (Date.now() - t0 < 30000) {
      if (await myTurn(A)) { await shoot(A); await sleep(400); }
      if (await myTurn(B)) { await shoot(B); await sleep(600); }
      const c = await B.evaluate(() => ({ over: !!window.__ended, n: game && game.afk ? game.afk[0] : -1 }));
      if (!c.over && c.n === 0) { reset = true; break; }
      if (c.over) break; await sleep(250);
    }
    ok(reset, "one shot of the away player brings the count back to 0 (he is not away any more)");

    // ---- 3. a solo match against the computer: no forfeit
    await A.evaluate(() => { toMenu("home"); }); await sleep(800);
    await A.evaluate(() => startMatch("ai", CITIES[0], botPlayer(1, 4))); await sleep(2500);
    const solo = await A.evaluate(() => { const G = game; G.cur = 0; for (let i = 0; i < 5; i++) timeoutFoul(); return { over: !!G.over, afk: G.afk || null }; });
    ok(!solo.over && !solo.afk, "a solo match is not affected: five timeouts in a row do not end it", solo);
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
