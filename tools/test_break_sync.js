#!/usr/bin/env node
// Do the two phones throw the same dice?  node tools/test_break_sync.js   (B8_ROOT=<repo copy>, BREAKS=6)
// The owner: "after the balls hit each other the balls end up in other places than where they were". A hard break used to pop balls off the cloth with Math.random() - every phone rolled its own.
// Here the player who has the first turn breaks at full power, many times (a new 2-player lobby match each time). On the phone that only WATCHES, applyState (the shooter's final positions) is wrapped to
// measure how far its own simulation was from them. Fixed: the two simulations agree (differences < 1 px); before: whole balls in other places.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), N = +process.env.BREAKS || 6;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8bs-")), P = 8596, base = `http://localhost:${P}`, errs = [];
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
    const A = await mk("Host"), B = await mk("Guest");
    for (const p of [A, B]) await p.evaluate(() => { window.__divs = []; const orig = applyState; applyState = m => { try { const G = game; window.__divs.push(Math.max(...G.balls.map((b, i) => Math.hypot(b.x - m.balls[i][0], b.y - m.balls[i][1]) * (b.out === !!m.balls[i][2] ? 1 : 1000)))); } catch (e) {} return orig(m); }; });
    await A.evaluate(() => lobbyCreate(CITIES[0].id, [])); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await A.evaluate(() => LB.code); await B.evaluate(c => lobbyJoin(c), code);
    await B.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); await A.waitForFunction(() => LB && LB.players.length === 2, null, { timeout: 30000 });
    const all = [];
    for (let m = 1; m <= N; m++) {
      await A.evaluate(() => Net.send({ t: "start" }));
      const wait = p => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.over && mode === "game" && !introOn(G); }, null, { timeout: 90000 });
      await Promise.all([wait(A), wait(B)]);
      let who = null; for (let i = 0; i < 100 && !who; i++) { const [a, c] = await Promise.all([A, B].map(p => p.evaluate(() => ({ ctl: canControl(), cur: game.cur })))); if (a.ctl && a.cur === 0) who = [A, B]; else if (c.ctl && c.cur === 0) who = [B, A]; else await sleep(250); }
      if (!who) { ok(false, `match ${m}: nobody can break`); break; }
      const [me, other] = who;
      await me.evaluate(() => { const G = game; G.angle = Math.atan2(G.balls[1].y - G.balls[0].y, G.balls[1].x - G.balls[0].x); requestShot(1); });
      await other.waitForFunction(() => window.__divs.length > 0 && !game.moving, null, { timeout: 60000 }).catch(() => {});
      await sleep(1200);
      const d = await other.evaluate(() => window.__divs.splice(0).pop()); all.push(d);
      await me.evaluate(() => { window.__divs.length = 0; });
      // end the match: both phones, then the host starts the next one
      await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2500);
      await Promise.all([A.evaluate(() => lbAfterMatch()), B.evaluate(() => lbAfterMatch())]); await sleep(800);
    }
    console.log("difference between the watching phone's own simulation and the shooter's final positions, per break (px):", all.map(x => x === undefined ? "?" : +x.toFixed(2)).join(" "));
    ok(all.length === N && all.every(x => x !== undefined && x < 1), "after every break the two simulations agree (< 1 px)", all);
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
