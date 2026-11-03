#!/usr/bin/env node
// Two real clients in one friend lobby playing several matches in a row:  node tools/test_lobby.js   (B8_ROOT=<repo copy>, MATCHES=4, SHOTS=<dir>)
// The owner's report: in the 3rd match of a lobby the screen froze, the turn showed as "mine" on both phones / the opponent shot on his own.
// Checks, for every match: both phones start it, the turn is never "mine" on both (or on neither) when the balls are still, every shot reaches the other phone and its balls end up
// in the same places, and - the race that was found - a match that starts while the other player is still looking at the previous result does not lose the first shots.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), N = +process.env.MATCHES || 4;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const STATE = () => { const G = typeof game !== "undefined" ? game : null; return { mode, hasGame: !!G, net: !!(G && G.net), over: !!(G && G.over), cur: G ? G.cur : null, seat: G && G.net ? G.net.seat : null, busy: !!(G && (G.moving || G.strike)), ctl: G ? !!canControl() : false,
  res: document.getElementById("res").classList.contains("on"), lb: !!(typeof LB !== "undefined" && LB), queued: !!(typeof LB !== "undefined" && LB && LB.queued), room: G && G.net ? G.net.room || "" : "",
  balls: G && G.balls ? G.balls.map(b => [Math.round(b.x), Math.round(b.y), b.out ? 1 : 0]) : null, shots: window.__shots | 0 }; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8lb-")), P = 8391, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const errs = [];
  try {
    const b = await chromium.launch(), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160))); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource|clipboard/i.test(m.text())) errs.push(name + " console: " + m.text().slice(0, 140)); });
      await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
      return p;
    };
    const A = await mk("Host"), B = await mk("Guest"), st = p => p.evaluate(STATE);
    // the lobby
    await A.evaluate(() => lobbyCreate(CITIES[0].id, [])); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await A.evaluate(() => LB.code); await B.evaluate(c => lobbyJoin(c), code);
    await B.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); await A.waitForFunction(() => LB && LB.players.length === 2, null, { timeout: 30000 });
    ok(true, "two players are in the lobby " + code);
    const waitGame = (p, to = 60000) => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.over && mode === "game"; }, null, { timeout: to });
    const still = async () => { for (let i = 0; i < 80; i++) { const [a, c] = [await st(A), await st(B)]; if (!a.busy && !c.busy) return [a, c]; await sleep(250); } return [await st(A), await st(B)]; };
    const shoot = p => p.evaluate(() => { const G = game, c = G.balls[0], ts = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== "gold"); let t = ts[0], d = 1e9; for (const x of ts) { const dd = Math.hypot(x.x - c.x, x.y - c.y); if (dd < d) { d = dd; t = x; } } G.angle = Math.atan2(t.y - c.y, t.x - c.x); requestShot(0.4); });
    const playTurns = async (label, turns) => {
      for (let t = 0; t < turns; t++) {
        let who = null; for (let i = 0; i < 80 && !who; i++) { const [a, c] = [await st(A), await st(B)]; if (a.over || c.over) return; if (a.ctl && a.cur === 0) who = A; else if (c.ctl && c.cur === 0) who = B; else await sleep(250); }
        if (!who) { const [a, c] = [await st(A), await st(B)]; ok(false, `${label}: nobody can shoot (the game froze?)`, { a: { cur: a.cur, ctl: a.ctl, busy: a.busy, over: a.over }, b: { cur: c.cur, ctl: c.ctl, busy: c.busy, over: c.over } }); return; }
        await shoot(who); await sleep(400); const [a, c] = await still(); await sleep(600);
        const [a2, c2] = [await st(A), await st(B)];
        if (a2.over || c2.over) return;
        ok(a2.cur + c2.cur === 1, `${label} turn ${t}: exactly one phone thinks it is its turn`, { a: a2.cur, b: c2.cur });
        const same = JSON.stringify(a2.balls) === JSON.stringify(c2.balls) || a2.balls.every((x, i) => Math.abs(x[0] - c2.balls[i][0]) <= 2 && Math.abs(x[1] - c2.balls[i][1]) <= 2 && x[2] === c2.balls[i][2]);
        ok(same, `${label} turn ${t}: both phones show the balls in the same places`, { a: a2.balls && a2.balls.slice(0, 4), b: c2.balls && c2.balls.slice(0, 4) });
      }
    };
    for (let m = 1; m <= N; m++) {
      const race = m % 2 === 0;   // even matches: the host starts the next match while the guest is still on the result screen
      await A.evaluate(() => Net.send({ t: "start" }));
      await Promise.all([waitGame(A), waitGame(B)]).catch(e => ok(false, `match ${m}: both phones start the match`, String(e).slice(0, 80)));
      const [a0, b0] = [await st(A), await st(B)]; ok(a0.hasGame && b0.hasGame && a0.cur + b0.cur === 1, `match ${m}: started, one phone has the first turn`, { a: a0.cur, b: b0.cur });
      await playTurns(`match ${m}`, 4);
      // the match ends the way a real one does: both phones call endGame (the host wins)
      await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2200);
      if (m === N) break;
      if (!race) {   // clean: both press "Continue", the host starts again
        await Promise.all([A.evaluate(() => lbAfterMatch()), B.evaluate(() => lbAfterMatch())]); await sleep(800);
        const [a1, b1] = [await st(A), await st(B)]; ok(a1.lb && b1.lb && a1.mode === "menu" && b1.mode === "menu", `match ${m}: "Continue" takes both back to the lobby`, { a: [a1.lb, a1.mode], b: [b1.lb, b1.mode] });
      } else {       // race: the guest is still on the result screen when the host's next match starts and the host shoots
        await A.evaluate(() => lbAfterMatch()); await sleep(600);
        await A.evaluate(() => Net.send({ t: "start" }));
        await sleep(300);
        // the guest is on the result screen: the match is queued, not started
        const b1 = await st(B); ok(b1.res && b1.queued, `match ${m + 1} (race): the guest has the new match queued behind the result screen`, { res: b1.res, q: b1.queued });
        await waitGame(A); const ctl = await A.evaluate(() => ({ cur: game.cur, intro: introOn(game) })); await sleep(500);
        if (ctl.cur === 0) { await A.waitForFunction(() => canControl(), null, { timeout: 20000 }).catch(() => {}); await shoot(A); await sleep(5000); }   // the host shoots before the guest has even started the match
        else await sleep(1500);
        await B.evaluate(() => lbAfterMatch()); await waitGame(B).catch(e => ok(false, `match ${m + 1} (race): the guest starts the match`, String(e).slice(0, 80))); await sleep(1500);
        const [a2, c2] = [await st(A), await st(B)];
        ok(a2.cur + c2.cur === 1, `match ${m + 1} (race): after the guest joins, exactly one phone has the turn`, { a: a2.cur, b: c2.cur, hostShot: ctl.cur === 0 });
        ok(JSON.stringify(a2.balls) === JSON.stringify(c2.balls) || a2.balls.every((x, i) => Math.abs(x[0] - c2.balls[i][0]) <= 2 && Math.abs(x[1] - c2.balls[i][1]) <= 2 && x[2] === c2.balls[i][2]), `match ${m + 1} (race): the late phone shows the same balls (the first shot was not lost)`, { a: a2.balls && a2.balls.slice(0, 3), b: c2.balls && c2.balls.slice(0, 3) });
        await playTurns(`match ${m + 1} after the race`, 3);
        m++; await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2200);
        await Promise.all([A.evaluate(() => lbAfterMatch()), B.evaluate(() => lbAfterMatch())]); await sleep(800);
      }
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
