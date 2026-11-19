#!/usr/bin/env node
// An online match whose player is silent for a long time and then shoots anyway (the owner, Nov 18: "his turn ran out; a little later it said 'the opponent did not respond'; then he shoots, the shot
// reaches me late and the balls change places"):  node tools/test_turn_clash.js   (B8_ROOT=<repo copy>; ~7 min; two real browsers against the real server)
// Both phones play every shot themselves and then agree on the final places (`state`). When one phone (Q) loses sight of the other (P) for turnLimit + 8 s it takes the turn ("opponent did not respond"),
// and Q's own shot / state then meet P's LATE shot / state: each phone used to accept the other's table, so the two tables were swapped for good.
//  - the match goes on in the normal way first (no clash: both tables the same after every shot, nobody "did not respond")
//  - P's phone is cut off (its messages are held for 14 s, in order, like a stalled mobile connection) right after P shot; Q takes the turn and shoots too; then P's messages arrive.
//    Afterwards BOTH tables are the same (P's shot was in time on P's clock: it counts, Q's shot does not), both phones agree whose turn it is, and the match goes on with a normal shot
//  - the same when Q does NOT shoot after taking the turn
//  - a take-over that is RIGHT (P did not shoot at all, his phone was frozen): Q takes the turn, shoots, P's phone replays it and goes on; both tables the same after Q's shot and after P's next shot (the new rules must not touch it)
//  - P's OWN clock runs out (he does not shoot) while Q takes the turn and shoots: P's late "time-out" table is older than Q's shot and must not put the balls back
//  - six normal shots with every message 0.6 s late both ways: the same tables after each
//  - the take-over itself still works (see tools/test_afk.js for the three-turns rule)
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), PORT = +process.env.TEST_PORT || 8771;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };

// a WebSocket whose outgoing messages can be held back (strictly in order, like TCP on a stalled mobile connection): window.__hold = ms
const HOLD = () => {
  const WS = window.WebSocket; window.__hold = 0; window.__due = 0;
  const W = function (u, p) {
    const w = p ? new WS(u, p) : new WS(u), send = w.send.bind(w), q = []; let timer = 0;
    const pump = () => { timer = 0; while (q.length && q[0][1] <= Date.now()) { try { send(q.shift()[0]); } catch (e) { q.length = 0; } } if (q.length) timer = setTimeout(pump, Math.max(1, q[0][1] - Date.now())); };
    w.send = d => { const due = Math.max(Date.now() + (window.__hold | 0), q.length ? q[q.length - 1][1] : 0); if (!q.length && due <= Date.now()) return send(d); q.push([d, due]); if (!timer) timer = setTimeout(pump, Math.max(1, due - Date.now())); };
    return w;
  };
  W.prototype = WS.prototype; ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(k => { W[k] = WS[k]; }); window.WebSocket = W;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8clash-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(4000);
  const b = await chromium.launch();
  const mk = async nm => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(nm + ": " + e.message.slice(0, 200)));
    await p.addInitScript(HOLD);
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, nm);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { window.__nt0 = nextTurn; });
    return p;
  };
  const SHORT = p => p.evaluate(() => { const nt = nextTurn; nextTurn = function (first) { const r = nt(first); if (game && game.turnLimit && curP().remote) game.turnLimit = 1.5; return r; }; if (game && game.turnLimit && curP().remote) game.turnLimit = 1.5; });   // the OTHER player's clock, as seen on this phone, is 1.5 s: the take-over comes after 1.5 + 8 s (a phone's own clock stays the normal one: nobody times out by himself during the test)
  const mine = p => p.evaluate(() => !!(game && !game.over && canControl()));
  const shoot = (p, pw) => p.evaluate(pw => { const G = game, c = G.balls[0], t = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== 8 && x.n !== "gold").sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0] || G.balls.find(x => !x.out && x.n !== 0); G.angle = Math.atan2(t.y - c.y, t.x - c.x); G.elev = 0; G.spin = { x: 0, y: 0 }; requestShot(pw || 0.5); }, pw);
  const snap = p => p.evaluate(() => { const G = game; if (!G || !G.net) return null; return { cur: seatOf(G.cur), bih: !!G.ballInHand, moving: !!G.moving, strike: !!G.strike, over: !!G.over, no: G.shotNo | 0, afk: G.afk ? G.afk.slice() : null, banner: G.banner && performance.now() - G.banner.t0 < G.banner.dur + 400 ? G.banner.text + "|" + (G.banner.sub || "") : "", balls: G.balls.map(x => [Math.round(x.x * 10) / 10, Math.round(x.y * 10) / 10, x.out ? 1 : 0]) }; });
  const diff = (a, b) => { let m = 0; for (let i = 0; i < a.balls.length; i++) { const x = a.balls[i], y = b.balls[i]; if (x[2] !== y[2]) return 999; if (!x[2]) m = Math.max(m, Math.hypot(x[0] - y[0], x[1] - y[1])); } return Math.round(m * 10) / 10; };
  const idle = async (A, B, secs, cap) => {   // both phones quiet (nothing rolling, no strike pending) for `secs` seconds in a row
    let still = 0; const t0 = Date.now();
    while (Date.now() - t0 < (cap || 90) * 1000) { const s = await Promise.all([snap(A), snap(B)]); if (s[0] && s[1] && !s[0].moving && !s[0].strike && !s[1].moving && !s[1].strike) { still += 0.4; if (still >= secs) return s; } else still = 0; await sleep(400); }
    return Promise.all([snap(A), snap(B)]);
  };
  const newMatch = async (A, B) => {
    for (let tries = 0; tries < 3; tries++) {
      await A.evaluate(() => { try { if (game && game.net && !game.over) Net.send({ t: "resign" }); } catch (e) {} }); await sleep(1500);   // (the match before this one ends on the server first: a phone in a room is not paired again)
      for (const p of [A, B]) await p.evaluate(() => { try { toMenu("home"); } catch (e) {} }); await sleep(800);
      const r = await Promise.all([A, B].map(p => p.evaluate(() => findOpponent(CITIES[0]).then(r => { if (!r.net) return false; startMatch("ai", CITIES[0], r.opp, r.net); return true; }))));
      if (r[0] && r[1]) break;   // (a search that found nobody within 15 s ends in a bot match: ask again)
      if (tries === 2) throw new Error("the two phones found no online match");
    }
    await Promise.all([A, B].map(p => p.waitForFunction(() => game && game.net && !game.net.spec && mode === "game" && !game.intro, null, { timeout: 60000 }).catch(() => {})));
    await sleep(1500); for (const p of [A, B]) await p.evaluate(() => { nextTurn = window.__nt0; if (game) game.net.__x = 0; });   // (no clock hack of an earlier scenario stays)
  };
  try {
    const A = await mk("Alpha"), B = await mk("Beta");
    // ---- 0. the normal way: two shots in turn, the same tables after each, nobody "did not respond"
    await newMatch(A, B);
    for (let i = 0; i < 2; i++) {
      const who = (await mine(A)) ? A : B; await shoot(who); await sleep(500);
      const s = await idle(A, B, 2.5, 40);
      ok(s[0] && s[1] && diff(s[0], s[1]) <= 1 && s[0].cur === s[1].cur, `normal shot ${i + 1}: both tables the same and both phones agree on the turn`, [s[0] && s[0].cur, s[1] && s[1].cur, s[0] && s[1] && diff(s[0], s[1])]);
      ok(!/did not respond|not responding/i.test((s[0] || {}).banner + (s[1] || {}).banner), `normal shot ${i + 1}: nobody is told "the opponent did not respond"`, [s[0] && s[0].banner, s[1] && s[1].banner]);
    }
    // ---- 1. P is cut off right after he shot; Q takes the turn and shoots too; then P's messages arrive
    for (const q of [true, false]) {
      await newMatch(A, B);
      const P = (await mine(A)) ? A : B, Q = P === A ? B : A, nm = q ? "Q shoots after taking the turn" : "Q only takes the turn"; await SHORT(Q);   // (only Q's view of P's clock is short: P's own view of Q's clock stays the normal one, so P does not take a turn of its own in the test)
      await P.evaluate(() => { window.__hold = 14000; });
      const tShot = Date.now(); await shoot(P, 0.6); await sleep(600); await P.evaluate(() => { window.__hold = 0; });   // (everything P sends from now on waits behind the first held message: 14 s, in order)
      let took = false; const t0 = Date.now();
      while (Date.now() - t0 < 16000) { if (await mine(Q)) { took = true; break; } await sleep(300); }
      const sq = await snap(Q); ok(took, `${nm}: Q takes the turn after P was silent (the "opponent did not respond" take-over still works)`, sq && sq.banner);
      if (q && took) { await sleep(300); await shoot(Q, 0.5); }
      while (Date.now() - tShot < 14000 + 1500) await sleep(300);   // P's held messages (the shot, then its final positions) reach Q at tShot + 14 s: look only after that
      const s = await idle(A, B, 3.5, 70);   // ...and after whatever they start has stopped rolling
      ok(s[0] && s[1] && diff(s[0], s[1]) <= 1, `${nm}: after P's late messages BOTH tables are the same (not swapped)`, [s[0] && s[1] && diff(s[0], s[1]), s[0] && s[0].no, s[1] && s[1].no]);
      ok(s[0] && s[1] && s[0].cur === s[1].cur && s[0].bih === s[1].bih, `${nm}: both phones agree whose turn it is (and about the ball in hand)`, [s[0] && [s[0].cur, s[0].bih], s[1] && [s[1].cur, s[1].bih]]);
      ok(s[0] && s[1] && !s[0].over && !s[1].over, `${nm}: the match is still on`, [s[0] && s[0].over, s[1] && s[1].over]);
      // the match goes on with a normal shot of whoever has the turn
      const who = (await mine(A)) ? A : (await mine(B)) ? B : null;
      if (who) { await shoot(who, 0.5); await sleep(500); const s2 = await idle(A, B, 2.5, 40); ok(s2[0] && s2[1] && diff(s2[0], s2[1]) <= 1 && s2[0].cur === s2[1].cur, `${nm}: the next normal shot is the same on both phones`, s2[0] && s2[1] && [diff(s2[0], s2[1]), s2[0].cur, s2[1].cur]); }
      else ok(false, `${nm}: somebody has the turn afterwards`, await Promise.all([snap(A), snap(B)]));
    }
    // ---- 2. a take-over that is right: P does not shoot at all (his phone froze); Q takes the turn and shoots; P's phone wakes up and plays on
    await newMatch(A, B);
    {
      const P = (await mine(A)) ? A : B, Q = P === A ? B : A; await SHORT(Q);
      // (P just does nothing: his own clock is the normal one, Q's view of it is 1.5 s + 8)
      let took = false; const t0 = Date.now();
      while (Date.now() - t0 < 16000) { if (await mine(Q)) { took = true; break; } await sleep(300); }
      ok(took, "right take-over: Q takes the turn when P says nothing", (await snap(Q) || {}).banner);
      if (took) {
        await sleep(300); await shoot(Q, 0.5); await sleep(500);
        let s1 = await idle(A, B, 2.5, 60);
        ok(s1[0] && s1[1] && diff(s1[0], s1[1]) <= 1 && s1[0].cur === s1[1].cur, "right take-over: both tables the same after Q's shot and both phones agree on the turn", s1[0] && s1[1] && [diff(s1[0], s1[1]), s1[0].cur, s1[1].cur]);
        for (let k = 0; k < 2; k++) {   // the match goes on: whoever has the turn shoots, P's next shot is accepted by Q (it is the next shot in order, not a clash)
          const who = (await mine(A)) ? A : (await mine(B)) ? B : null; if (!who) { ok(false, "right take-over: somebody has the turn (shot " + (k + 2) + ")", await Promise.all([snap(A), snap(B)])); break; }
          await shoot(who, 0.5); await sleep(500); s1 = await idle(A, B, 2.5, 60);
          ok(s1[0] && s1[1] && diff(s1[0], s1[1]) <= 1 && s1[0].cur === s1[1].cur, "right take-over: shot " + (k + 2) + " is the same on both phones", s1[0] && s1[1] && [diff(s1[0], s1[1]), s1[0].cur, s1[1].cur]);
        }
      }
    }
    // ---- 3. P's own clock runs out (he does not shoot); his "time-out" table is held 14 s; Q takes the turn at the same time and shoots; then P's old table arrives
    await newMatch(A, B);
    {
      const P = (await mine(A)) ? A : B, Q = P === A ? B : A; await SHORT(Q);
      await P.evaluate(() => { const nt = nextTurn; nextTurn = function (first) { const r = nt(first); if (game && game.turnLimit && !curP().remote) game.turnLimit = 1.5; return r; }; if (game && game.turnLimit && !curP().remote) game.turnLimit = 1.5; window.__hold = 24000; });
      const tHold = Date.now(); await sleep(2500); await P.evaluate(() => { window.__hold = 0; nextTurn = window.__nt0; if (game && !curP().remote) game.turnLimit = 40; });   // (P's clock ran out once at 1.5 s: his own clock is the normal one again, so he does not run out of turns)   // (P's clock ran out at 1.5 s: his time-out table is the first held message)
      let took = false; const t0 = Date.now();
      while (Date.now() - t0 < 16000) { if (await mine(Q)) { took = true; break; } await sleep(300); }
      ok(took, "time-out crossing the take-over: Q has the turn", (await snap(Q) || {}).banner);
      if (took) { await sleep(300); await shoot(Q, 0.5); }
      while (Date.now() - tHold < 24000 + 1500) await sleep(300);   // (P's old table arrives after Q's shot has stopped rolling: Q is idle when it comes)
      const s3 = await idle(A, B, 3.5, 70);
      ok(s3[0] && s3[1] && diff(s3[0], s3[1]) <= 1, "time-out crossing the take-over: after P's old table arrives BOTH tables are the same (Q's shot is not put back)", s3[0] && s3[1] && [diff(s3[0], s3[1]), s3[0].no, s3[1].no]);
      ok(s3[0] && s3[1] && s3[0].cur === s3[1].cur, "time-out crossing the take-over: both phones agree whose turn it is", [s3[0] && s3[0].cur, s3[1] && s3[1].cur]);
    }
    // ---- 4. six normal shots with every message 0.6 s late, both ways
    await newMatch(A, B);
    for (const p of [A, B]) await p.evaluate(() => { window.__hold = 600; });
    for (let i = 0; i < 6; i++) {
      let who = null; const t0 = Date.now();
      while (Date.now() - t0 < 25000 && !who) { who = (await mine(A)) ? A : (await mine(B)) ? B : null; if (!who) await sleep(300); }
      if (!who) { ok(false, "slow network: somebody has the turn (shot " + (i + 1) + ")", await Promise.all([snap(A), snap(B)])); break; }
      await shoot(who, 0.35 + (i % 4) * 0.15); await sleep(800);
      const s4 = await idle(A, B, 3, 60);
      ok(s4[0] && s4[1] && diff(s4[0], s4[1]) <= 1 && s4[0].cur === s4[1].cur && !/did not respond|not responding/i.test(s4[0].banner + s4[1].banner), "slow network: shot " + (i + 1) + " is the same on both phones, nobody is told \"did not respond\"", s4[0] && s4[1] && [diff(s4[0], s4[1]), s4[0].cur, s4[1].cur, s4[0].banner, s4[1].banner]);
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
