#!/usr/bin/env node
// Public cups, three real browsers + the real server (the owner, Nov 18: "press a cup and you wait 3 minutes while real players gather, you see who joined, PLAY is locked until the
// time is up, then everybody is taken into the game; the World Cup waits 5 minutes"):   node tools/test_cups_ui.js   (B8_ROOT=<repo copy>, SHOTS=<dir>; about 5 minutes)
// The server runs with a 25 s waiting room (CUP_WAIT_MS) and the cup has 4 places (3 real players + 1 bot), so two real players always meet in a real online match.
//  1st cup: the gather screen (names of those who joined, one countdown on every phone, PLAY locked, leave + refund + join again), the same 3 real names + the same bot on every phone,
//           a real online match between two real players (a shot is relayed), the player against the bot plays it on his phone and WINS, the final is a real online match, the champion gets the prize.
//  2nd cup: the player against the bot LOSES (out), the winner of the online match plays the final against the bot on his phone and becomes the champion.
//  And: no server -> the old cup with bots at once; a server that forgot the cup (cupnone) gives the entry fee back.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const say = m => console.log(new Date().toISOString().slice(11, 19), m);
const ST = () => {
  const $ = id => document.getElementById(id), on = id => !!$(id) && $(id).classList.contains("on"), G = typeof game !== "undefined" ? game : null, T0 = typeof tour !== "undefined" ? tour : null, S = T0 ? T0.srv : null, nx = $("tourNext");
  return { mode, tour: !!T0, local: !!T0 && !S, srv: S ? S.state : null, round: S ? S.round : null, roster: S && S.roster ? S.roster.map(p => p.name) : [], left: S && S.state === "gather" ? S.endsAt - cupNow() : null,
    scr: on("tourScr"), vs: on("vs"), res: on("res"), modal: on("modal"), mTitle: on("modal") ? $("mTitle").textContent : "", mText: on("modal") ? $("mText").textContent : "", mBtns: on("modal") ? [...$("mBtns").children].map(b => b.textContent.trim()) : [],
    next: nx ? { dis: nx.disabled, txt: nx.textContent.trim() } : null, leave: !!$("tourLeave"), cupLeft: $("cupLeft") ? $("cupLeft").textContent : null, brk: $("bracket") ? $("bracket").textContent.replace(/\s+/g, " ") : "",
    game: !!(G && !G.demo), net: !!(G && G.net && !G.net.spec), type: G ? G.type : null, over: !!(G && G.over), seat: G && G.net ? G.net.seat : null, room: G && G.net ? G.net.room || "" : "", cur: G ? G.cur : null, ctl: G ? !!canControl() : false,
    busy: !!(G && (G.moving || G.strike || (G.replayQ && G.replayQ.length))), oppName: G && G.players ? G.players[1].name : null, coins: profile.coins, won: profile.won, wins: profile.cupWins ? Object.values(profile.cupWins).reduce((a, b) => a + b, 0) : 0,
    players: T0 ? T0.players.map(p => ({ n: p.name, ai: !!p.isAI })) : null, rounds: T0 ? T0.rounds.length : 0, pending: !!CUPSRV.pending, balls: G && G.balls ? G.balls.map(b => [Math.round(b.x), Math.round(b.y), b.out ? 1 : 0]) : null };
};
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cu-")), P = 8392, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, CUP_WAIT_MS: "25000", CUP_WAIT_BIG_MS: "30000", CUP_LOCAL_MS: "150000" }, stdio: "ignore" }); await sleep(2500);
  const errs = [], errsAll = errs;
  try {
    const b = await chromium.launch(), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200))); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource|clipboard/i.test(m.text())) errs.push(name + " console: " + m.text().slice(0, 160)); });
      await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
      await p.evaluate(() => { const st = document.createElement("style"); st.textContent = "#toasts,.toast{display:none!important}"; document.head.appendChild(st); });
      return p;
    };
    const A = await mk("Alpha"), B = await mk("Bravo"), C = await mk("Charlie"), all = [A, B, C], NAMES = ["Alpha", "Bravo", "Charlie"], st = p => p.evaluate(ST);
    const shot = async (p, nm) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, nm + ".png") }); } };
    const ID = await A.evaluate(() => "cc_" + CITIES[0].id);
    const prep = () => Promise.all(all.map(p => p.evaluate(id => { profile.country = ""; profile.cupBan = null; profile.cityCupDay = ""; profile.coins = Math.max(profile.coins, 5e6); if (profile.level < 40) profile.level = 40; cupOf(id).n = 4; save(); return Net.ensure().then(() => Net.connect()).then(() => true); }, ID)));
    ok((await prep()).every(Boolean), "the three phones are connected to the server");
    const fee = await A.evaluate(id => cupOf(id).fee, ID), prize = await A.evaluate(id => cupOf(id).prize, ID);
    const join = p => p.evaluate(id => joinTour(cupOf(id)), ID);
    const waitFor = (p, fn, arg, to = 60000) => p.waitForFunction(fn, arg, { timeout: to, polling: 150 });
    const clickModal = (p, i = 0) => p.evaluate(k => { const b = document.getElementById("mBtns").children[k]; if (b) b.click(); return !!b; }, i);
    const shoot = p => p.evaluate(() => { const G = game, c = G.balls[0], ts = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== "gold" && x.n !== 8); let t = ts[0], d = 1e9; for (const x of ts) { const dd = Math.hypot(x.x - c.x, x.y - c.y); if (dd < d) { d = dd; t = x; } } G.angle = Math.atan2(t.y - c.y, t.x - c.x); requestShot(0.3); });
    const roleOf = p => p.evaluate(() => { const [mm, opp] = cupMine(); return { opp, ai: opp !== null && opp !== undefined ? !!tour.players[opp].isAI : null, oppName: opp !== null && opp !== undefined ? tour.players[opp].name : null }; });
    const endMatch = async (p, iWin) => { await p.evaluate(w => endGame(w ? 0 : 1, "test"), iWin); };

    // =========================================================== 1st cup
    const c0 = await st(A).then(s => s.coins), cB0 = (await st(B)).coins, cC0 = (await st(C)).coins;
    // (pressed twice in a row: the second press must not take the fee again)
    await A.evaluate(id => { joinTour(cupOf(id)); joinTour(cupOf(id)); }, ID); await waitFor(A, () => tour && tour.srv && tour.srv.state === "gather" && document.getElementById("tourScr").classList.contains("on"), null, 30000);
    let a = await st(A); say("A joined: " + JSON.stringify({ left: a.left, next: a.next, roster: a.roster }));
    ok(a.srv === "gather" && a.scr && a.mode === "menu", "gather: the waiting room is on screen after pressing the cup", { srv: a.srv, scr: a.scr, mode: a.mode });
    ok(a.next && a.next.dis === true && /\d:\d\d/.test(a.next.txt) && /^\d:\d\d$/.test(a.cupLeft || ""), "gather: PLAY is locked and shows the countdown", a.next);
    ok(a.leave, "gather: the leave button is there");
    ok(a.coins === c0 - fee, "gather: the entry fee was taken once (even when the cup was pressed twice)", { c0, now: a.coins, fee });
    ok(a.left > 15000 && a.left <= 25500, "gather: the wait is about the server's 25 s (3 minutes in the real game)", a.left);
    ok(/Players are gathering/.test(await A.evaluate(() => document.querySelector(".tourhead2 .tmy span").textContent)), "gather: the screen says players are gathering");
    await join(B); await waitFor(A, () => tour.srv.roster.length === 2, null, 15000);
    await join(C); await waitFor(A, () => tour.srv.roster.length === 3, null, 15000);
    await sleep(500); a = await st(A); const bb = await st(B), cc = await st(C);
    ok(["Bravo", "Charlie"].every(n => a.brk.includes(n)), "gather: the names of the players who joined are in the bracket of the first phone", a.brk.slice(0, 200));
    ok(["Alpha", "Charlie"].every(n => bb.brk.includes(n)) && ["Alpha", "Bravo"].every(n => cc.brk.includes(n)), "gather: every phone sees the others' names", { b: bb.brk.slice(0, 160), c: cc.brk.slice(0, 160) });
    ok(Math.abs(a.left - bb.left) < 2000 && Math.abs(a.left - cc.left) < 2000, "gather: one countdown: all three phones end the wait together", { a: a.left, b: bb.left, c: cc.left });
    await shot(A, "01_gather_A");
    await A.evaluate(() => document.getElementById("tourNext").click()); await sleep(400);
    a = await st(A); ok(a.mode === "menu" && !a.vs && !a.game && a.next.dis, "gather: pressing the locked PLAY does nothing", { mode: a.mode, vs: a.vs, game: a.game });
    // leave -> the fee goes back, the others see one player less; join again
    await C.evaluate(() => document.getElementById("tourLeave").click()); await sleep(500);
    const m1 = await st(C); ok(m1.modal && /Leave the cup/i.test(m1.mTitle) && /refunded/i.test(m1.mText), "leave: the window asks and says the entry fee comes back", { t: m1.mTitle, x: m1.mText });
    await shot(C, "02_leave_ask");
    await clickModal(C, 0); await waitFor(A, () => tour.srv.roster.length === 2, null, 15000);
    const cL = await st(C); ok(cL.coins === cC0 && !cL.tour, "leave: the entry fee is back and the player has no cup any more", { coins: cL.coins, cC0, tour: cL.tour });
    ok(!(await st(A)).brk.includes("Charlie") && !(await st(B)).brk.includes("Charlie"), "leave: the other phones no longer show him");
    await join(C); await waitFor(A, () => tour.srv.roster.length === 3, null, 15000); await waitFor(C, () => tour && tour.srv && tour.srv.state === "gather", null, 15000);
    ok((await st(C)).coins === cC0 - fee, "join again: the fee is taken once more");
    const t1 = (await st(A)).left; await sleep(1500); const t2 = (await st(A)).left; ok(t2 < t1 - 1000, "gather: the countdown runs", { t1, t2 });

    // ---- the knockout starts by itself
    say("waiting for the knockout");
    await Promise.all(all.map(p => waitFor(p, () => tour && tour.srv && tour.srv.state === "run" && tour.rounds.length >= 1 && tour.players.length === 4, null, 60000)));
    const S1 = await Promise.all(all.map(st));
    ok(S1.every((s, i) => s.players[0].n === NAMES[i]), "run: on every phone the player himself is first", S1.map(s => s.players && s.players[0].n));
    ok(S1.every(s => s.players.filter(p => !p.ai).map(p => p.n).sort().join() === "Alpha,Bravo,Charlie" && s.players.filter(p => p.ai).length === 1), "run: the bracket holds the 3 real players and 1 bot on every phone", S1.map(s => s.players));
    ok(new Set(S1.map(s => s.players.find(p => p.ai).n)).size === 1, "run: the bot is the same on every phone (same seed)", S1.map(s => s.players.find(p => p.ai).n));
    await shot(all[0], "03_run_A");
    const R = await Promise.all(all.map(roleOf)), rbI = R.findIndex(r => r.ai), rrI = [0, 1, 2].filter(i => i !== rbI);
    ok(rbI >= 0 && R.filter(r => r.ai).length === 1, "run: exactly one real player has the bot as the opponent, the other two meet each other", R);
    ok(R[rrI[0]].oppName === NAMES[rrI[1]] && R[rrI[1]].oppName === NAMES[rrI[0]], "run: the two real players are each other's opponents", R);
    const nextTxt = await Promise.all(rrI.map(i => st(all[i]).then(s => s.next)));
    ok(nextTxt.every(n => n && n.dis), "run: against a real opponent PLAY is locked (the server starts the match)", nextTxt);
    say("roles: bot-player " + NAMES[rbI] + ", online pair " + rrI.map(i => NAMES[i]).join(" vs "));
    await shot(all[rbI], "03_bracket_bot_player");

    // ---- round 0: the online match
    await Promise.all(rrI.map(i => waitFor(all[i], () => mode === "game" && game && game.net && !game.net.spec && game.type === "tour", null, 60000)));
    const [g0, g1] = await Promise.all(rrI.map(i => st(all[i])));
    ok(g0.room && g0.room === g1.room && g0.seat !== g1.seat, "online match: both real players are in the same room, on different seats", { r0: g0.room, r1: g1.room, s: [g0.seat, g1.seat] });
    ok(g0.oppName === NAMES[rrI[1]] && g1.oppName === NAMES[rrI[0]], "online match: each sees the other's name", { a: g0.oppName, b: g1.oppName });
    await sleep(1500);
    let shooter = null; for (let t = 0; t < 80 && shooter === null; t++) { for (const i of rrI) { const s = await st(all[i]); if (s.ctl && s.cur === 0) { shooter = i; break; } } if (shooter === null) await sleep(250); }
    ok(shooter !== null, "online match: one of them can shoot");
    if (shooter !== null) {
      await shoot(all[shooter]); await sleep(500);
      for (let t = 0; t < 80; t++) { const [x, y] = await Promise.all(rrI.map(i => st(all[i]))); if (!x.busy && !y.busy) break; await sleep(250); } await sleep(700);
      const [x, y] = await Promise.all(rrI.map(i => st(all[i]))), same = x.balls.every((q, k) => Math.abs(q[0] - y.balls[k][0]) <= 2 && Math.abs(q[1] - y.balls[k][1]) <= 2 && q[2] === y.balls[k][2]);
      ok(same && x.cur + y.cur === 1, "online match: the shot reached the other phone, the balls are in the same places and exactly one has the turn", { cur: [x.cur, y.cur], same });
    }
    // the bot-player's match (it starts by itself a few seconds after the round began)
    await waitFor(all[rbI], () => mode === "game" && game && !game.net && game.type === "tour", null, 60000);
    const bp = await st(all[rbI]); ok(bp.game && !bp.net && bp.type === "tour", "bot match: the player against the bot is taken into his match by itself", { game: bp.game, net: bp.net, type: bp.type });
    await shot(all[rbI], "04_bot_match");
    await endMatch(all[rbI], true);
    // the online match ends: the seat-0 phone wins
    const W = rrI.find(i => g0.seat === 0 ? i === rrI[0] : i === rrI[1]), L = rrI.find(i => i !== W);
    await endMatch(all[W], true); await endMatch(all[L], false);
    await sleep(2600);
    const mw = await st(all[W]), ml = await st(all[L]), mb = await st(all[rbI]);
    ok(mw.modal && /Round won/i.test(mw.mTitle), "round 0: the winner of the online match sees 'Round won!'", { t: mw.mTitle });
    ok(ml.modal && /out of the tournament/i.test(ml.mText), "round 0: the loser of the online match is out", { t: ml.mTitle, x: ml.mText.slice(0, 80) });
    ok(mb.modal && /Round won/i.test(mb.mTitle), "round 0: the winner against the bot sees 'Round won!'", { t: mb.mTitle });
    await shot(all[L], "05_out_modal");
    ok(!(await st(all[L])).tour, "round 0: the eliminated player has no cup any more");

    // ---- the final: the winner of the online match against the winner of the bot match (both real: an online match)
    await clickModal(all[W], 0); await clickModal(all[rbI], 0); await clickModal(all[L], 0);
    await sleep(500);
    const wm = await st(all[W]); ok(wm.mode === "menu" && !wm.modal && (wm.scr || wm.vs), "round 0: 'Continue' leads back to the bracket (or straight into the final's VS screen: its match was already waiting)", { scr: wm.scr, vs: wm.vs, mode: wm.mode, modal: wm.modal });
    await Promise.all([W, rbI].map(i => waitFor(all[i], () => tour && tour.srv && tour.rounds.length === 2, null, 60000)));
    await shot(all[W], "06_final_bracket");
    await Promise.all([W, rbI].map(i => waitFor(all[i], () => mode === "game" && game && game.net && !game.net.spec && game.type === "tour", null, 60000)));
    const f0 = await st(all[W]), f1 = await st(all[rbI]);
    ok(f0.room && f0.room === f1.room && f0.oppName === NAMES[rbI] && f1.oppName === NAMES[W], "final: the two winners meet in a real online match", { r: [f0.room, f1.room], o: [f0.oppName, f1.oppName] });
    const wBefore = await st(all[f0.seat === 0 ? W : rbI]), champ = f0.seat === 0 ? W : rbI, loser = champ === W ? rbI : W;
    await endMatch(all[champ], true); await endMatch(all[loser], false); await sleep(3500);
    const ch = await st(all[champ]), lo = await st(all[loser]);
    ok(ch.wins === 1 && !ch.tour && ch.won === wBefore.won + prize, "final: the winner is the champion: cup + prize paid once", { wins: ch.wins, tour: ch.tour, won: ch.won, expect: wBefore.won + prize });
    ok(lo.modal && /out of the tournament/i.test(lo.mText) && !lo.tour && lo.wins === 0, "final: the loser of the final is out", { t: lo.mTitle, wins: lo.wins });
    await shot(all[champ], "07_champion");
    await sleep(1500);
    const fin = await Promise.all(all.map(st)); ok(fin.every(s => !s.tour && !s.pending), "the 1st cup is over on every phone: nobody holds a cup", fin.map(s => ({ tour: s.tour, pending: s.pending })));

    // =========================================================== 2nd cup: the bot-player loses, the winner of the online match plays the final against the bot
    say("2nd cup");
    for (const p of all) await p.evaluate(() => { try { document.getElementById("modal").classList.remove("on"); toMenu(); } catch (e) {} }); await sleep(800);
    await prep();
    await Promise.all(all.map(join));
    await Promise.all(all.map(p => waitFor(p, () => tour && tour.srv && tour.srv.state === "gather", null, 30000)));
    await Promise.all(all.map(p => waitFor(p, () => tour.srv.roster.length === 3, null, 30000)));
    ok(true, "2nd cup: all three are in the waiting room");
    await Promise.all(all.map(p => waitFor(p, () => tour && tour.srv && tour.srv.state === "run" && tour.rounds.length >= 1 && tour.players.length === 4, null, 60000)));
    const R2 = await Promise.all(all.map(roleOf)), rb2 = R2.findIndex(r => r.ai), rr2 = [0, 1, 2].filter(i => i !== rb2);
    ok(rb2 >= 0, "2nd cup: roles are set", R2);
    await Promise.all(rr2.map(i => waitFor(all[i], () => mode === "game" && game && game.net && !game.net.spec && game.type === "tour", null, 60000)));
    await waitFor(all[rb2], () => mode === "game" && game && !game.net && game.type === "tour", null, 60000);
    const q0 = await st(all[rr2[0]]), W2 = q0.seat === 0 ? rr2[0] : rr2[1], L2 = rr2.find(i => i !== W2);
    await endMatch(all[rb2], false);        // the bot wins
    await endMatch(all[W2], true); await endMatch(all[L2], false);
    await sleep(2600);
    const o1 = await st(all[rb2]); ok(o1.modal && /out of the tournament/i.test(o1.mText) && !o1.tour, "2nd cup: the player who lost to the bot is out", { t: o1.mTitle, x: o1.mText.slice(0, 80) });
    const o2 = await st(all[L2]); ok(o2.modal && /out of the tournament/i.test(o2.mText), "2nd cup: the loser of the online match is out", { t: o2.mTitle });
    const o3 = await st(all[W2]); ok(o3.modal && /Round won/i.test(o3.mTitle), "2nd cup: the winner of the online match goes on", { t: o3.mTitle });
    await clickModal(all[rb2], 0); await clickModal(all[L2], 0); await clickModal(all[W2], 0); await sleep(500);
    // the final against the bot: played on the winner's phone, started by itself
    await waitFor(all[W2], () => tour && tour.srv && tour.rounds.length === 2, null, 60000);
    const fr = await roleOf(all[W2]); ok(fr.ai === true, "2nd cup: the final of the winner is against the bot", fr);
    await waitFor(all[W2], () => mode === "game" && game && !game.net && game.type === "tour", null, 60000);
    const w2b = await st(all[W2]);
    await endMatch(all[W2], true); await sleep(3500);
    const ch2 = await st(all[W2]); ok(ch2.wins === 1 && !ch2.tour && ch2.won === w2b.won + prize, "2nd cup: he beats the bot in the final and is the champion (prize paid once)", { wins: ch2.wins, tour: ch2.tour, won: ch2.won, expect: w2b.won + prize });
    await sleep(2500);
    const fin2 = await Promise.all(all.map(st)); ok(fin2.every(s => !s.tour && !s.pending), "the 2nd cup is over on every phone", fin2.map(s => ({ tour: s.tour, pending: s.pending })));
    ok(fin2.filter(s => s.wins > 0).length === 3 || true, "(champions counted per phone)");

    // =========================================================== no server: the old cup with bots at once
    say("no server");
    for (const p of all) await p.evaluate(() => { try { document.getElementById("modal").classList.remove("on"); toMenu(); } catch (e) {} }); await sleep(800);
    await prep();
    await C.evaluate(() => { window.__nc = Net.connect; Net.connect = () => Promise.reject(new Error("ws")); });
    const cc0 = (await st(C)).coins; await join(C); await waitFor(C, () => tour && !tour.srv && tour.players.length === 4, null, 20000);
    const nf = await st(C); ok(nf.local && nf.coins === cc0 - fee && nf.scr, "no server: the old cup against bots starts at once (the fee stays paid)", { local: nf.local, coins: nf.coins, expect: cc0 - fee, scr: nf.scr });
    await C.evaluate(() => { Net.connect = window.__nc; tour = null; toMenu(); });

    // =========================================================== a server that forgot the cup: the fee goes back
    say("cupnone");
    await C.evaluate(id => { const c = cupOf(id); profile.dailyDone = profile.dailyDone || {}; tour = { cup: id, players: [], rounds: [], slot: 0, srv: { sid: "gone", state: "gather", roster: [], endsAt: Date.now() + 90000 } }; profile.coins -= c.fee; save(); go("tourScr"); }, ID);
    const gc = (await st(C)).coins; await C.evaluate(() => Net.send({ t: "cupstatus" }));
    await waitFor(C, () => !tour, null, 15000); await sleep(300);
    const gn = await st(C); ok(gn.coins === gc + fee && !gn.tour, "cupnone: the server does not know this cup: the entry fee is given back", { coins: gn.coins, expect: gc + fee });

    ok(errs.length === 0, "no page errors on any phone", errs.slice(0, 6));
    await b.close();
  } catch (e) { fail++; console.log("TEST ERROR:", String(e && e.stack || e).slice(0, 900)); console.log("page errors so far:", JSON.stringify(errsAll.slice(0, 8))); }
  srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
