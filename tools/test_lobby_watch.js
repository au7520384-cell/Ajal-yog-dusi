#!/usr/bin/env node
// Watching a bracket match of the lobby (the player who got a bye / was knocked out):  node tools/test_lobby_watch.js   (B8_ROOT=<repo copy>)
// 3 players in one lobby: two play round 1, the third waits and gets an eye button next to the live match; it takes him into that match as a spectator (with the lobby voice mic button),
// and when the match ends and his own match (the final) is created he is taken out of the watching screen into it.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8lw-")), P = 8392, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch(), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
      await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500); return p;
    };
    const P1 = await mk("Host"), P2 = await mk("Two"), P3 = await mk("Three"), all = [P1, P2, P3];
    await P1.evaluate(() => lobbyCreate(CITIES[0].id, [])); await P1.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await P1.evaluate(() => LB.code);
    for (const p of [P2, P3]) { await p.evaluate(c => lobbyJoin(c), code); await p.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); }
    await P1.waitForFunction(() => LB && LB.players.length === 3, null, { timeout: 30000 });
    await P1.evaluate(() => Net.send({ t: "start" }));
    await sleep(7500);   // the VS screens
    const st = await Promise.all(all.map(p => p.evaluate(() => ({ g: !!(game && game.net && !game.net.spec && !game.over && mode === "game"), live: LB && LB.tour ? (LB.tour.matches || []).filter(x => x.live && x.room).length : 0 }))));
    const playing = all.filter((p, i) => st[i].g), waiting = all.filter((p, i) => !st[i].g);
    ok(playing.length === 2 && waiting.length === 1, "two players are in the match, the third waits (bye)", st);
    const W = waiting[0];
    await W.waitForFunction(() => document.querySelector("#lbBody .lbw"), null, { timeout: 15000 }).catch(() => {});
    ok(await W.evaluate(() => !!document.querySelector("#lbBody .lbw")), "the waiting player sees an eye button next to the live match");
    const mineHas = await Promise.all(playing.map(p => p.evaluate(() => !!document.querySelector("#lbBody .lbw"))));
    ok(!mineHas.some(Boolean), "the two players of that match have no eye button for their own match");
    await W.evaluate(() => document.querySelector("#lbBody .lbw").click());
    await W.waitForFunction(() => game && game.net && game.net.spec && mode === "game", null, { timeout: 15000 }).catch(() => {});
    const sp = await W.evaluate(() => ({ spec: !!(game && game.net && game.net.spec), mic: !!document.getElementById("specMic"), balls: game && game.balls ? game.balls.length : 0, lb: !!LB }));
    ok(sp.spec && sp.balls === 16 && sp.lb, "the eye button takes him into the match as a watcher (the lobby stays)", sp);
    ok(sp.mic, "the lobby voice mic button is on the watching screen");
    // the match ends: the watcher is taken to his own match (the final)
    await playing[0].evaluate(() => endGame(0, "test")); await playing[1].evaluate(() => endGame(1, "test"));
    const own = await W.waitForFunction(() => game && game.net && !game.net.spec && !game.over && mode === "game", null, { timeout: 25000 }).then(() => true, () => false);
    ok(own, "when the watched match ends and his own match is created he is taken into it");
    ok(!(await W.evaluate(() => !!document.getElementById("specMic"))), "the watching mic button is gone");
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
