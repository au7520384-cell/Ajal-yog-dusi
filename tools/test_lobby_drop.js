#!/usr/bin/env node
// A lobby match that loses its connection:  node tools/test_lobby_drop.js   (B8_ROOT=<repo copy>)
// The owner's report: "I entered the game, it left the lobby by itself and froze again - I kept shooting and the other player stood frozen in the lobby".
// Causes found: (1) the quick-match search replaced the lobby's "match" handler and every later lobby match was answered with "resign"; (2) a bracket match that came while a result screen was open waited
// for "Continue" for ever; (3) a connection that was dead but looked open froze the match, and a real drop ended it for the cut-off player at once.
// Checks: the search does not break the lobby, a queued match starts by itself, a dead / closed connection in a match is recovered with no shot lost, and a phone that never comes back loses after the grace time.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const STATE = () => { const G = typeof game !== "undefined" ? game : null; return { mode, hasGame: !!G, net: !!(G && G.net), over: !!(G && G.over), cur: G ? G.cur : null, bih: !!(G && G.ballInHand), busy: !!(G && (G.moving || G.strike || (G.replayQ && G.replayQ.length))), ctl: G ? !!canControl() : false,
  res: document.getElementById("res").classList.contains("on"), lb: !!(typeof LB !== "undefined" && LB), recov: typeof recov !== "undefined" && !!recov, open: Net.open, socks: window.__socks.length,
  balls: G && G.balls ? G.balls.map(b => [Math.round(b.x), Math.round(b.y), b.out ? 1 : 0]) : null }; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ld-")), P = 8393, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, MATCH_GRACE_MS: "6000" }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch(), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
      await p.addInitScript(n => {
        localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x");
        if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 }));
        // every WebSocket of the page is remembered; "deaf" makes one look open but dead (nothing arrives, nothing is sent): what a phone that changed network has
        const W = window.WebSocket; window.__socks = [];
        window.WebSocket = function (u, pr) {
          const s = pr ? new W(u, pr) : new W(u); window.__socks.push(s); let h = null; const orig = s.send.bind(s);
          s.send = d => { if (!s.__deaf) orig(d); };
          s.addEventListener("message", ev => { if (!s.__deaf && h) h.call(s, ev); });
          Object.defineProperty(s, "onmessage", { get: () => h, set: f => { h = f; }, configurable: true });
          return s;
        };
        window.WebSocket.prototype = W.prototype; for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) window.WebSocket[k] = W[k];
      }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
      return p;
    };
    const A = await mk("Host"), B = await mk("Guest"), st = p => p.evaluate(STATE);
    const waitGame = (p, to = 60000) => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.over && mode === "game"; }, null, { timeout: to });
    const still = async () => { for (let i = 0; i < 120; i++) { const [a, c] = [await st(A), await st(B)]; if (!a.busy && !c.busy) return [a, c]; await sleep(250); } return [await st(A), await st(B)]; };
    const shoot = p => p.evaluate(() => { const G = game, c = G.balls[0], ts = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== "gold"); let t = ts[0], d = 1e9; for (const x of ts) { const dd = Math.hypot(x.x - c.x, x.y - c.y); if (dd < d) { d = dd; t = x; } } G.angle = Math.atan2(t.y - c.y, t.x - c.x); requestShot(0.4); });
    const shooter = async () => { for (let i = 0; i < 80; i++) { const [a, c] = [await st(A), await st(B)]; if (a.over || c.over) return null; if (a.ctl && a.cur === 0) return A; if (c.ctl && c.cur === 0) return B; await sleep(250); } return null; };
    const same = (a, c) => a.balls && c.balls && a.balls.every((x, i) => (i === 0 && (a.bih || c.bih)) || (Math.abs(x[0] - c.balls[i][0]) <= 2 && Math.abs(x[1] - c.balls[i][1]) <= 2 && x[2] === c.balls[i][2]));   // (a cue ball in hand is moved by the player who holds it: it is not part of the agreed positions)
    const syncCheck = async label => { const [a, c] = await still(); await sleep(700); const [a2, c2] = [await st(A), await st(B)];
      ok(!a2.over && !c2.over, `${label}: the match is still on for both`, { a: a2.over, b: c2.over }); ok(a2.cur + c2.cur === 1, `${label}: exactly one phone has the turn`, { a: a2.cur, b: c2.cur }); ok(same(a2, c2), `${label}: both phones show the balls in the same places`, { a: a2.balls && a2.balls.slice(0, 3), b: c2.balls && c2.balls.slice(0, 3) }); };
    const lobby = async () => {
      await A.evaluate(() => lobbyCreate(CITIES[0].id, [])); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
      const code = await A.evaluate(() => LB.code); await B.evaluate(c => lobbyJoin(c), code);
      await B.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); await A.waitForFunction(() => LB && LB.players.length === 2, null, { timeout: 30000 });
    };

    // 1. the quick-match search takes a player out of the lobby (the client must forget it too) and does not break the lobby matches that come afterwards
    await lobby();
    await A.evaluate(() => { findOpponent(CITIES[0]); });
    await sleep(1500);
    const a1 = await st(A); ok(!a1.lb, "the search took the player out of the lobby on his side too");
    await B.waitForFunction(() => LB && LB.players.length === 1, null, { timeout: 15000 }).catch(() => {});
    ok(await B.evaluate(() => LB && LB.players.length === 1), "the other player sees him gone from the lobby");
    await sleep(15500);   // the search ends with the bot answer: the old handler used to stay behind and answer every later lobby match with "resign"
    ok(await A.evaluate(() => searchWait === null), "the search is over and leaves nothing behind");
    await B.evaluate(() => lbLeave(true)); await sleep(500);
    await A.evaluate(() => { if (typeof game !== "undefined" && game) game.over = true; toMenu("home"); }).catch(() => {}); await sleep(800);
    await lobby();
    await A.evaluate(() => Net.send({ t: "start" }));
    const both = await Promise.all([waitGame(A), waitGame(B)]).then(() => true, () => false);
    ok(both, "after a search the lobby match starts on both phones (it used to be given up by the old handler)");

    // 2. a match that comes while a result screen is open starts by itself once the player is back on a menu screen
    await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2500);
    await A.evaluate(() => lbAfterMatch()); await sleep(600);
    await A.evaluate(() => Net.send({ t: "start" })); await sleep(700);
    const q = await st(B); ok(q.res, "the guest still looks at the result screen when the next match comes");
    await B.evaluate(() => toMenu("home"));   // he leaves the result screen by any other way than "Continue"
    const auto = await waitGame(B, 15000).then(() => true, () => false);
    ok(auto, "the queued match starts by itself (no \"Continue\" needed)");
    await waitGame(A); await sleep(1500);

    // 3. a connection that is dead but looks open (the phone changed network): the shot is not lost
    const X = await shooter(); ok(!!X, "someone can shoot"); const Y = X === A ? B : A;
    if (X) {
      const n0 = (await st(X)).socks;
      await X.evaluate(() => { __socks[__socks.length - 1].__deaf = true; });
      await shoot(X);
      const back = await X.waitForFunction(n => { const G = game; return __socks.length > n && Net.open && !recov && G && !G.over; }, n0, { timeout: 60000 }).then(() => true, () => false);
      ok(back, "the dead connection is noticed and the phone reconnects");
      await sleep(2000);   // the shot that was sent again now reaches the other phone, which plays it
      await syncCheck("after the dead connection");
    }
    // 4. a connection that closes: the match goes on
    const X2 = await shooter();
    if (X2) {
      const n1 = (await st(X2)).socks;
      await X2.evaluate(() => { __socks[__socks.length - 1].close(); });
      await shoot(X2);
      const back2 = await X2.waitForFunction(n => __socks.length > n && Net.open && !recov, n1, { timeout: 30000 }).then(() => true, () => false);
      ok(back2, "a closed connection is replaced at once");
      await sleep(2000);
      await syncCheck("after the closed connection");
    }
    // 5. a phone that never comes back: after the grace time the other player wins instead of waiting for ever
    const Z = A, W = B;
    await Z.context().setOffline(true);
    await Z.evaluate(() => { __socks[__socks.length - 1].close(); });
    const won = await W.waitForFunction(() => game && game.over, null, { timeout: 25000 }).then(() => true, () => false);
    ok(won, "the opponent of a phone that is gone is not left waiting: the match ends for him after the grace time");
    await Z.context().setOffline(false);
    // 6. the ordinary quick match (two players search the same table) still finds each other through the single "match" router
    const C = await mk("Cee"), D = await mk("Dee");
    await Promise.all([C, D].map(p => p.evaluate(() => { window.__fo = null; findOpponent(CITIES[0]).then(r => { window.__fo = r.net ? r.net.room : "bot"; }); })));
    await Promise.all([C, D].map(p => p.waitForFunction(() => window.__fo, null, { timeout: 20000 }).catch(() => {})));
    const [rc, rd] = await Promise.all([C, D].map(p => p.evaluate(() => window.__fo)));
    ok(rc && rc === rd && rc !== "bot", "two players searching the same table are matched with each other (one room)", { rc, rd });
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
