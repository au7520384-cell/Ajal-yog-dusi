#!/usr/bin/env node
// A 9-BALL LOBBY with two real phones on the real server:  node tools/test_lobby_nine.js   (B8_ROOT=<repo copy>; about 2 min)
// The owner (Nov 28): "9-ball has no lobby: add one (Create gives a code, the friend enters it in the one box)". The 8-ball lobby is reused: the host picks the GAME, the server tells every phone, and the
// matches of the bracket are 9-ball matches (the diamond rack from the match's seed, the lowest ball first, the 9 wins).
//  - the 9-ball list has a third row "online": it opens the table chooser (titled 9-ball); a table makes a lobby that is a 9-ball lobby on the host's phone and on the server (open lobbies, world chat, quick join)
//  - the friend enters the code in the 🔑 box and sees the same lobby (9-ball in the title)
//  - the match: both phones have the same diamond rack (10 balls), the lowest ball is the target, the 9-ball strip is shown; a foul passes the turn WITH ball in hand on both phones; legal shots keep the
//    two tables equal; a legal 9 wins on both phones, the server ends the tournament and pays it (entry fee + 90 % prize); a second tournament of the lobby is a 9-ball one too
//  - a spectator builds the same table; leaving the lobby goes back to the 9-ball list
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const STATE = () => { const G = typeof game !== "undefined" ? game : null; return { mode, hasGame: !!G, net: !!(G && G.net), over: !!(G && G.over), cur: G ? G.cur : null, seat: G && G.net ? G.net.seat : null, rule: G ? G.rule || "" : "", pro: G ? !!G.pro : false,
  busy: !!(G && (G.moving || G.strike || (G.replayQ && G.replayQ.length))), ctl: G ? !!canControl() : false, bih: G ? !!G.ballInHand : null, brk: G ? !!G.isBreak : null, room: G && G.net ? G.net.room || "" : "",
  res: document.getElementById("res").classList.contains("on"), lb: !!(typeof LB !== "undefined" && LB), lbRule: typeof LB !== "undefined" && LB ? LB.rule : "", lbState: typeof LB !== "undefined" && LB ? LB.state : "", coins: profile.coins,
  low: G && G.rule === "nine" ? nineLow(G) : -1, n: G && G.balls ? G.balls.length : 0, balls: G && G.balls ? G.balls.map(b => [b.n, Math.round(b.x), Math.round(b.y), b.out ? 1 : 0]) : null }; };
const sameBalls = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x[0] === b[i][0] && Math.abs(x[1] - b[i][1]) <= 2 && Math.abs(x[2] - b[i][2]) <= 2 && x[3] === b[i][3]);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8nine-")), P = 8394, base = `http://localhost:${P}`;
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

    // ---- the host: the 9-ball list has the online row, it opens the table chooser of the 9-ball game
    await A.evaluate(() => { toMenu("proScr"); proPickNine(); }); await sleep(900);
    const rows = await A.evaluate(() => [...document.querySelectorAll("#mExtra [data-id]")].map(e => ({ id: e.dataset.id, t: e.textContent.replace(/\s+/g, " ").trim() })));
    ok(rows.length === 3 && rows.map(r => r.id).join() === "bot,hot,online", "the 9-ball list: vs a bot, two on one phone, ONLINE", rows);
    ok(/Online/i.test((rows[2] || {}).t || ""), "...the online row says Online", rows[2]);
    await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(800);
    const ch = await A.evaluate(() => ({ scr: document.getElementById("lbScr").classList.contains("on"), title: document.getElementById("lbTitle").textContent, rule: LBX.rule, from: LBX.from, tables: document.querySelectorAll("#lbBody .lbt").length }));
    ok(ch.scr && /^9-ball/.test(ch.title) && ch.rule === "nine" && ch.tables >= 3, "the table chooser opens, titled 9-ball, with the tables", ch);
    await A.evaluate(() => document.querySelector("#lbBody .lbt").click());
    await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await A.evaluate(() => LB.code), la = await st(A);
    ok(la.lbRule === "nine" && /^[A-Z0-9]{6}$/.test(code), "the host's lobby is a 9-ball lobby with a code", { rule: la.lbRule, code });
    ok(await A.evaluate(() => /^9-ball/.test(document.getElementById("lbTitle").textContent)), "the lobby screen says 9-ball");
    const fee = await A.evaluate(() => LB.fee), coins0 = { A: (await st(A)).coins, B: (await st(B)).coins };

    // ---- a public 9-ball lobby is listed with its game; "quick join" does not drop a player into it (he did not ask for 9-ball); the world chat card names the game
    await A.evaluate(() => Net.send({ t: "lpub", on: true })); await A.waitForFunction(() => LB.pub, null, { timeout: 10000 });
    const lst = await B.evaluate(async () => { await Net.ensure(); return (await Net.api("/api/lobbies")).lobbies; });
    ok(lst.some(x => x.code === code && x.rule === "nine"), "the open lobbies list has the lobby with rule 'nine'", lst);
    const row = await B.evaluate(c => { const x = OPN.list ? null : null; return opRow({ code: c, city: "lon", fee: 50, n: 1, max: 8, state: "open", rule: "nine", host: { uid: "1", name: "A", avatar: 1, frame: 0, country: "UZ", level: 1 }, voice: 0 }); }, code);
    ok(/9-ball/.test(row), "a row of the open lobbies list names the game (9-ball)");
    await B.evaluate(() => { toMenu("mini"); }); await sleep(300);
    await B.evaluate(() => quickJoin(null)); await B.waitForFunction(() => LB && !LB.pending, null, { timeout: 20000 }).catch(() => {}); await sleep(500);
    const qj = await B.evaluate(() => ({ code: LB && LB.code, role: LB && LB.role, rule: LB && LB.rule }));
    ok(qj.code && qj.code !== code && qj.role === "host" && qj.rule === "eight", "quick join does not put him in the 9-ball lobby (it opened a public lobby of his own: 8-ball)", { qj, code });
    await B.evaluate(() => lbDrop()); await sleep(500);
    await A.evaluate(() => WorldChat.postLobby(null)); await sleep(800);
    await A.evaluate(() => WorldChat.open());
    const card = await A.waitForFunction(() => /9-ball/.test((document.getElementById("wLobList") || {}).textContent || ""), null, { timeout: 10000 }).then(() => true, () => false);
    ok(card, "the world chat card of the lobby names the game (9-ball)", await A.evaluate(() => (document.getElementById("wLobList") || {}).textContent));
    await A.evaluate(() => WorldChat.close());

    // ---- the friend enters the code in the one box
    await B.evaluate(c => { toMenu("mini"); codeJoin(c); }, code);
    await B.waitForFunction(() => LB && !LB.pending && LB.rule === "nine", null, { timeout: 40000 }).catch(() => {});
    await A.waitForFunction(() => LB && LB.players.length === 2, null, { timeout: 30000 }).catch(() => {});
    const lb = await st(B);
    ok(lb.lb && lb.lbRule === "nine", "the friend joined by the code box and his lobby is a 9-ball lobby", { lb: lb.lb, rule: lb.lbRule });
    ok(await B.evaluate(() => /^9-ball/.test(document.getElementById("lbTitle").textContent)), "...and his lobby screen says 9-ball too");

    // ---- the match
    const waitGame = (p, to = 60000) => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.over && mode === "game"; }, null, { timeout: to });
    const still = async () => { for (let i = 0; i < 100; i++) { const [a, c] = [await st(A), await st(B)]; if (!a.busy && !c.busy) return [a, c]; await sleep(250); } return [await st(A), await st(B)]; };
    const who = async () => { for (let i = 0; i < 100; i++) { const [a, c] = [await st(A), await st(B)]; if (a.over || c.over) return null; if (a.ctl && a.cur === 0) return A; if (c.ctl && c.cur === 0) return B; await sleep(250); } return null; };
    const aimLow = p => p.evaluate(() => { const G = game, c = G.balls[0], t = legalTargets(G.cur)[0]; G.angle = Math.atan2(t.y - c.y, t.x - c.x); });
    const logCoins = () => { window.__coin = []; const f = addCoins; addCoins = function (n) { window.__coin.push(n); return f.apply(this, arguments); }; };
    await A.evaluate(logCoins); await B.evaluate(logCoins);
    await A.evaluate(() => Net.send({ t: "start" }));
    await Promise.all([waitGame(A), waitGame(B)]).catch(e => ok(false, "both phones start the match", String(e).slice(0, 80)));
    await sleep(1200);
    const [a0, b0] = [await st(A), await st(B)];
    ok(a0.rule === "nine" && b0.rule === "nine", "both phones play a 9-ball match (rule 'nine')", { a: a0.rule, b: b0.rule });
    ok(a0.n === 10 && b0.n === 10, "the table has the cue ball and the balls 1-9", { a: a0.n, b: b0.n });
    ok(a0.room && a0.room === b0.room && a0.seat + b0.seat === 1, "the same room, the two seats", { a: a0.room, b: b0.room });
    ok(sameBalls(a0.balls, b0.balls), "both phones have the same diamond rack (made from the match's seed)");
    ok(a0.low === 1 && b0.low === 1, "the lowest ball is the 1", { a: a0.low, b: b0.low });
    const ns = a0.balls.filter(x => x[0] > 0).map(x => x[0]).sort((x, y) => x - y).join("");
    ok(ns === "123456789", "the rack has the balls 1 to 9, once each", ns);
    ok(!a0.pro && !b0.pro, "an online match is not a 'pro' hot-seat game (its result goes to the server)");
    ok(a0.cur + b0.cur === 1, "one phone has the first turn", { a: a0.cur, b: b0.cur });

    // a FOUL: the cue ball touches nothing: the turn passes and the opponent has the ball in hand - on BOTH phones
    let w = await who(); ok(!!w, "somebody can shoot (the break)");
    const shooter0 = w === A ? "A" : "B";
    await w.evaluate(() => { game.angle = Math.PI; requestShot(0.08); }); await sleep(500);
    let [a1, b1] = await still(); await sleep(900); [a1, b1] = [await st(A), await st(B)];
    ok(a1.cur + b1.cur === 1 && (shooter0 === "A" ? a1.cur === 1 : b1.cur === 1), "after a foul the OTHER player has the turn (on both phones)", { a: a1.cur, b: b1.cur, shooter0 });
    ok(a1.bih && b1.bih, "...and has the ball in hand on both phones", { a: a1.bih, b: b1.bih });
    ok(sameBalls(a1.balls, b1.balls), "...and both tables are the same");

    // legal shots at the lowest ball: the two tables stay equal and the turn is on one phone only
    for (let t = 0; t < 4; t++) {
      w = await who(); if (!w) { ok(false, `turn ${t}: nobody can shoot`); break; }
      await aimLow(w); await w.evaluate(() => requestShot(0.4)); await sleep(500);
      const [a, c] = await still(); await sleep(900);
      const [a2, c2] = [await st(A), await st(B)]; if (a2.over || c2.over) break;
      ok(a2.cur + c2.cur === 1, `shot ${t}: exactly one phone has the turn`, { a: a2.cur, b: c2.cur });
      ok(sameBalls(a2.balls, c2.balls), `shot ${t}: both phones show the balls in the same places`, { a: a2.balls.slice(0, 4), b: c2.balls.slice(0, 4) });
      ok(a2.bih === c2.bih && a2.low === c2.low, `shot ${t}: the same ball in hand / lowest ball on both phones`, { a: [a2.bih, a2.low], b: [c2.bih, c2.low] });
    }

    // the win: only the cue ball and the 9 are left, the 9 sits in front of a corner pocket and the cue ball lines up with it (staged identically on both phones); the legal 9 wins on BOTH phones
    await still(); await sleep(500);
    const stage = () => { const G = game; for (const x of G.balls) { x.vx = x.vy = 0; if (x.n >= 1 && x.n <= 8) x.out = true; if (x.n === 9) { x.x = 110; x.y = 110; x.out = false; } if (x.n === 0) { x.x = 300; x.y = 300; x.out = false; } } G.ballInHand = false; G.isBreak = false; G.pendingState = null; };
    await A.evaluate(stage); await B.evaluate(stage);
    w = await who(); ok(!!w, "somebody can take the winning shot");
    const winner = w === A ? "A" : "B", cw = { A: (await st(A)).coins, B: (await st(B)).coins };
    await w.evaluate(() => { game.angle = Math.atan2(110 - 300, 110 - 300); requestShot(0.5); });
    await Promise.all([A.waitForFunction(() => game.over, null, { timeout: 25000 }), B.waitForFunction(() => game.over, null, { timeout: 25000 })]).catch(e => ok(false, "the 9 ends the match on both phones", String(e).slice(0, 80)));
    const [a3, b3] = [await st(A), await st(B)];
    ok(a3.over && b3.over, "the legal 9 ended the match on both phones", { a: a3.over, b: b3.over });
    await sleep(3500);
    const resA = await A.evaluate(() => LB && LB.results), resB = await B.evaluate(() => LB && LB.results);
    const pw = winner === "A" ? resA : resB, pl = winner === "A" ? resB : resA;
    ok(pw && pw.place === 1 && pl && pl.place === 2, "the server ended the tournament: the shooter is 1st, the other 2nd", { resA, resB, winner });
    const pool = Math.floor(fee * 2 * 0.9), cLog = { A: await A.evaluate(() => window.__coin), B: await B.evaluate(() => window.__coin) }, wl = cLog[winner], ll = cLog[winner === "A" ? "B" : "A"];
    // (the achievements of a first win add their own coins by another way: only the prize of the lobby goes through addCoins here)
    ok(pw && pw.prize === pool && wl.filter(n => n === pool).length === 1, `the winner is paid the prize (90 % of both fees = ${pool}) exactly once`, { prize: pw && pw.prize, winnerAddCoins: wl, pool });
    ok(ll.every(n => n < pool), "the loser is paid nothing", ll);
    ok(coins0.A - fee === cw.A && coins0.B - fee === cw.B || (Math.abs(coins0.A - fee - cw.A) < 2000 && Math.abs(coins0.B - fee - cw.B) < 2000), "both paid the entry fee when the tournament started", { fee, coins0, cw });

    // the lobby is open again and still a 9-ball lobby; the next tournament is a 9-ball one (a new room, a new rack)
    await Promise.all([A.evaluate(() => lbAfterMatch()), B.evaluate(() => lbAfterMatch())]); await sleep(1000);
    const [a4, b4] = [await st(A), await st(B)];
    ok(a4.lb && b4.lb && a4.lbState === "open" && b4.lbState === "open" && a4.lbRule === "nine" && b4.lbRule === "nine", "after the tournament both are in the lobby, open again, still a 9-ball lobby", { a: [a4.lbState, a4.lbRule], b: [b4.lbState, b4.lbRule] });
    await A.evaluate(() => Net.send({ t: "start" }));
    await Promise.all([waitGame(A), waitGame(B)]).catch(e => ok(false, "match 2: both phones start", String(e).slice(0, 80)));
    await sleep(1000);
    const [a5, b5] = [await st(A), await st(B)];
    ok(a5.rule === "nine" && b5.rule === "nine" && a5.n === 10 && sameBalls(a5.balls, b5.balls), "the second tournament's match is a 9-ball match with the same new rack on both phones", { a: a5.rule, b: b5.rule });
    ok(a5.room !== a0.room && JSON.stringify(a5.balls.slice(1, 4)) !== JSON.stringify(a0.balls.slice(1, 4)), "...a new room and a different rack (a new seed)");
    await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2500);
    await Promise.all([A.evaluate(() => lbAfterMatch()), B.evaluate(() => lbAfterMatch())]); await sleep(800);

    // ---- a spectator of a 9-ball match builds the same table (the server's `spec` message has the rule)
    const sp = await B.evaluate(() => { startSpectate({ room: "zz", city: "lon", seed: 777, first: 0, p: [{ name: "X" }, { name: "Y" }], rule: "nine", specs: 1, list: [], log: [] }); const G = game; const r = { rule: G.rule, n: G.balls.length, type: G.type, ns: G.balls.filter(x => x.n > 0).map(x => x.n).sort((p, q) => p - q).join("") }; toMenu(); return r; });
    ok(sp.rule === "nine" && sp.n === 10 && sp.type === "spec" && sp.ns === "123456789", "a spectator's table is the 9-ball diamond", sp);
    const sp8 = await B.evaluate(() => { startSpectate({ room: "zz", city: "lon", seed: 777, first: 0, p: [{ name: "X" }, { name: "Y" }], specs: 1, list: [], log: [] }); const G = game; const r = { rule: G.rule || "", n: G.balls.length }; toMenu(); return r; });
    ok(sp8.rule === "" && sp8.n === 16, "...and without the rule it is the 8-ball table as before (16 balls)", sp8);

    // ---- leaving the lobby goes back to the 9-ball list (where it was opened from)
    await A.evaluate(() => lbShow()); await sleep(500);
    await A.evaluate(() => lbLeave(true)); await sleep(800);
    ok(await A.evaluate(() => document.getElementById("proScr").classList.contains("on")), "leaving the lobby takes the host back to the 9-ball list's screen");
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
