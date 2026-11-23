#!/usr/bin/env node
// Online 2v2, end to end:  node tools/test_team_online.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 6 minutes; the real server + 4 real Chromium phones)
// The owner (Nov 23): "Online 2v2 ni boshla". Four phones in one room (seats 0 + 1 against seats 2 + 3):
//  - the 2v2 list has the "Online" row; the room window creates a room (a code), the other three join with it, every phone shows the same four seats; the host starts
//  - every phone has the same table (the seed), the same turn (the SAME seat holds the cue on all four phones, each in its own view: my team is on my side), and exactly one phone can control it
//  - shot after shot: the shooter's numbers are played on the other three and the table afterwards is the same on all four (positions, whose turn, who shoots next, the groups)
//  - a phone is closed in the middle of the match: after the grace a bot plays its seat on the three others, the driver's phone plays the bot's shots, the table stays the same on every phone
//  - the match ends on one phone: the other three end it too, each with the right winner in its own view (my team / theirs); "Play again" brings the same people back to the room window; the host starts a second match
//  - two phones against two bots: the driver plays the bots, the other phone shows the same shots
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 900) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8tn-")), P = +process.env.TEST_PORT || 8795, base = `http://localhost:${P}`, errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, TEAM_GRACE_MS: "3500" }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), ctxs = [];
  const mk = async name => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage(); ctxs.push(ctx); p._ctx = ctx;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    p.on("console", m => { if (m.type() === "error" && /tnet|pro team|frame error/.test(m.text())) errs.push(name + " console: " + m.text().slice(0, 240)); });
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 50000, avatar: 401 })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} window.toast = () => {}; }); await sleep(900);
    await p.evaluate(() => Net.ensure().then(() => Net.connect()));
    p._name = name; return p;
  };
  const until = async (fn, to = 15000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  // a phone's view of the match, in GLOBAL terms (sides / seats), so the four can be compared
  const view = p => p.evaluate(() => {
    const G = typeof game !== "undefined" ? game : null; if (!G || !G.tnet) return null; const N = G.tnet, gs = ls => ls === 0 ? (N.seat >> 1) : 1 - (N.seat >> 1), groups = [], mi = [];
    for (const ls of [0, 1]) { groups[gs(ls)] = G.groups[ls]; mi[gs(ls)] = G.mi[ls]; }
    return { seat: N.seat, driver: N.driver, over: G.over, moving: G.moving, strike: !!G.strike, shotNo: G.shotNo | 0, cur: gs(G.cur), shooter: tnShooter(G), mi, groups, bih: G.ballInHand, brk: G.isBreak, can: canControl(), win: G.over ? gs(G.winnerSide | 0) : -1,
      names: G.team.map(t => t.map(x => x.name + (x.bot ? "*" : (x.remote ? "r" : "")))), balls: G.balls.map(q => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100, q.out ? 1 : 0]), seed: G.simSeed0, mode, modal: document.getElementById("modal").classList.contains("on") ? (document.getElementById("mTitle") || {}).textContent : "" };
  });
  const same = (vs, keys) => vs.every(v => v && keys.every(k => JSON.stringify(v[k]) === JSON.stringify(vs[0][k])));
  const shoot = p => p.evaluate(() => {   // a plain shot at the nearest ball the shooter may hit
    const G = game; if (!canControl()) return false; const cue = G.balls[0];
    if (G.ballInHand && !G.isBreak) { const s = freeSpot(cue.x, cue.y); cue.x = s.x; cue.y = s.y; }
    const ts = legalTargets(G.cur).filter(x => x.n !== 0 && !x.out).sort((a, c) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(c.x - cue.x, c.y - cue.y));
    const t = G.isBreak ? G.balls.find(x => x.n === 1) : ts[0] || G.balls.find(x => x.n && !x.out); if (!t) return false;
    G.angle = Math.atan2(t.y - cue.y, t.x - cue.x); G.spin = { x: 0, y: 0 }; G.elev = 0; requestShot(G.isBreak ? 1 : 0.55); return true;
  });
  const settle = async (Ps, no, to = 60000) => until(async () => { const vs = await Promise.all(Ps.map(view)); return vs.every(v => v && !v.moving && !v.strike && v.shotNo >= no) && same(vs, ["shotNo", "cur", "shooter"]); }, to, 400);
  const KEYS = ["shotNo", "cur", "shooter", "mi", "groups", "bih", "brk"], tableSame = vs => vs.every(v => JSON.stringify(v.balls) === JSON.stringify(vs[0].balls));
  // a moment at which every phone is at rest on shot `no` and has the same table, turn and groups (a bot may start the next shot a second later: the phones are compared the moment they have all stopped)
  const converge = async (Ps, no, to = 60000) => { const t0 = Date.now(); let last = null; while (Date.now() - t0 < to) { const vs = await Promise.all(Ps.map(view)); last = vs; if (vs.every(v => v && !v.moving && !v.strike && v.shotNo >= no) && same(vs, KEYS) && tableSame(vs)) return { ok: true, vs }; await sleep(100); } return { ok: false, vs: last }; };
  try {
    const A = await mk("Alice"), B = await mk("Bob"), C = await mk("Cara"), D = await mk("Dave"), all = [A, B, C, D];

    // ------------------------------------------------------------------ the list, the room window
    await A.evaluate(() => { toMenu("proScr"); proPickTeam(); }); await sleep(700);
    const row = await A.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => ({ id: r.dataset.id, txt: r.textContent })));
    ok(row.length === 4 && row[3].id === "online" && /Online/.test(row[3].txt), "the 2v2 list has the Online row (after bot partner / friend / four on one phone)", row);
    await shot(A, "01_list");
    await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(600);
    ok(await A.evaluate(() => document.getElementById("tnRoom").classList.contains("on") && !!document.querySelector('#tnRoom [data-a="create"]') && !!document.querySelector("#tnRoom .tn-code")), "the Online row opens the room window: create a room, or type a code");
    await shot(A, "02_window");
    await A.evaluate(() => document.querySelector('#tnRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#tnRoom .tn-codev") || {}).textContent || "")), 8000), "creating a room shows its 4-letter code");
    const code = await A.evaluate(() => document.querySelector("#tnRoom .tn-codev").textContent);
    // the others type the code (B), or open an invite link (C, D)
    await B.evaluate(() => { toMenu("proScr"); tnOpen(); }); await sleep(400);
    await B.evaluate(c => { document.querySelector("#tnRoom .tn-code").value = c.toLowerCase(); document.querySelector('#tnRoom [data-a="join"]').click(); }, code);
    ok(await until(async () => await B.evaluate(() => (document.querySelector("#tnRoom .tn-codev") || {}).textContent) === code, 8000), "a typed code (lower case works) takes the second player into the room");
    for (const p of [C, D]) await p.evaluate(c => { toMenu("proScr"); tnInvite(c); }, code);
    ok(await until(async () => (await Promise.all(all.map(p => p.evaluate(() => document.querySelectorAll("#tnRoom .tn-seat:not(.free)").length)))).every(n => n === 4), 10000), "an invite link puts the other two in: every phone shows four seats taken");
    const seats = await Promise.all(all.map(p => p.evaluate(() => [...document.querySelectorAll("#tnRoom .tn-team")].map(t => [...t.querySelectorAll(".tn-seat b")].map(x => x.textContent.replace(/\s*👑/, ""))))));
    ok(seats.every(s => JSON.stringify(s) === JSON.stringify([["Alice", "Bob"], ["Cara", "Dave"]])), "all four see the same room: Alice + Bob against Cara + Dave", seats);
    ok(await A.evaluate(() => !document.querySelector('#tnRoom [data-a="start"]').disabled) && !(await B.evaluate(() => !!document.querySelector('#tnRoom [data-a="start"]'))), "only the host has the Start key");
    await shot(A, "03_room");
    await shot(B, "03_room_guest");

    // ------------------------------------------------------------------ the match
    await A.evaluate(() => document.querySelector('#tnRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all(all.map(p => p.evaluate(() => !!(typeof game !== "undefined" && game && game.tnet && mode === "game"))))).every(Boolean), 20000), "Start: all four phones are at the table");
    await sleep(1500);
    let vs = await Promise.all(all.map(view));
    ok(same(vs, ["seed", "cur", "shooter", "shotNo", "bih", "brk"]) && vs.map(v => v.seat).join() === "0,1,2,3", "same seed, same turn (the same seat holds the cue on every phone), seats 0 1 2 3", vs.map(v => [v.seat, v.seed, v.cur, v.shooter]));
    ok(vs.every(v => JSON.stringify(v.balls) === JSON.stringify(vs[0].balls)), "the same table on every phone before the first shot");
    ok(vs[0].names[0][0] === "Alice" && vs[0].names[0][1] === "Bobr" && vs[2].names[0][0] === "Cara" && vs[2].names[1].join() === "Alicer,Bobr", "each phone has its own team on its own side (side 0 = my team), the others are remote players", vs.map(v => v.names));
    ok(vs.every(v => v.names.flat().every(n => !/\*/.test(n))), "no bots: four humans");
    await shot(A, "04_table_A"); await shot(C, "04_table_C");

    const SHOTS = +process.env.SHOTS || 8; let played = 0, bad = [];
    for (let i = 1; i <= SHOTS; i++) {
      if (!await until(async () => (await Promise.all(all.map(p => view(p).then(v => v && v.can)))).filter(Boolean).length === 1, 40000, 300)) { bad.push(["nobody / several can shoot at shot " + i, await Promise.all(all.map(view))]); break; }
      const vv = await Promise.all(all.map(view)), who = vv.findIndex(v => v.can);
      ok(vv[who].seat === vv[who].shooter, "the phone that can control is the shooter's own (shot " + i + ")", [who, vv[who].shooter]);
      if (i === 1) await shot(all[who], "05_aim_shooter");
      if (!await shoot(all[who])) { bad.push(["could not shoot " + i]); break; }
      if (i === 1) { await sleep(900); await shot(all[(who + 1) % 4], "05_flight_other"); }
      if (!(await converge(all, i)).ok) { bad.push(["not converged after shot " + i, await Promise.all(all.map(view))]); break; }
      await sleep(900);
      const v2 = await Promise.all(all.map(view)); played = i;
      const agree = same(v2, ["shotNo", "cur", "shooter", "mi", "groups", "bih", "brk"]) && v2.every(v => JSON.stringify(v.balls) === JSON.stringify(v2[0].balls));
      if (!agree) { bad.push(["phones disagree after shot " + i, v2.map(v => ({ seat: v.seat, no: v.shotNo, cur: v.cur, sh: v.shooter, mi: v.mi, g: v.groups, bih: v.bih })), v2.map(v => v.balls.map((q, k) => JSON.stringify(q) !== JSON.stringify(v2[0].balls[k]) ? k : -1).filter(k => k >= 0))]); break; }
      if (v2[0].over) break;
    }
    ok(bad.length === 0 && played >= Math.min(SHOTS, 3), `${played} shots played: after each one the table, the turn, the next shooter, the groups are the same on all four phones`, bad);
    await shot(A, "06_midgame"); await shot(D, "06_midgame_D");

    // ------------------------------------------------------------------ a phone is closed: a bot takes its seat
    const before = await Promise.all(all.map(view)), cur = before[0].shooter;
    const victim = [2, 3, 1].find(s => s !== cur) ?? 2, vp = all[victim], rest = all.filter((_, i) => i !== victim);
    await vp._ctx.close();
    ok(await until(async () => (await Promise.all(rest.map(p => p.evaluate(s => { const G = game; return !!G && !G.over && G.team.flat().some(x => x.bot); }, victim)))).every(Boolean), 15000), "after the grace a bot plays the seat of the closed phone, on all three that are left (its name is kept, the robot sign is added)");
    const rv = await Promise.all(rest.map(view));
    const driver = rv[0].driver;
    ok(rv.every(v => v.driver === driver) && rest.every((p, i) => rv[i].seat !== victim) && (victim !== driver), "all three agree on who drives the bots (the lowest live seat)", rv.map(v => [v.seat, v.driver]));
    ok(rv.every(v => v.names.flat().filter(n => /\*/.test(n)).length === 1), "exactly one bot", rv.map(v => v.names));
    // play until the bot has shot (it is the driver's phone that plays it)
    let botShot = false, bad2 = [];
    for (let i = played + 1; i <= played + 10 && !botShot; i++) {
      const curv = await Promise.all(rest.map(view));
      if (curv.some(v => v.over)) break;
      const botTurn = curv[0].shooter === victim;
      if (botTurn) { botShot = true; if (!await until(async () => (await Promise.all(rest.map(view))).every(v => v.shotNo >= i), 45000, 400)) { bad2.push("the bot did not shoot"); break; } }
      else { if (!await until(async () => (await Promise.all(rest.map(view))).filter(v => v.can).length === 1, 40000, 300)) { bad2.push(["nobody can shoot", await Promise.all(rest.map(view))]); break; } const w = (await Promise.all(rest.map(view))).findIndex(v => v.can); await shoot(rest[w]); }
      const cv = await converge(rest, i, 70000); played = i;
      if (!cv.ok) { bad2.push(["not converged after " + i, (cv.vs || []).map(v => v && [v.seat, v.shotNo, v.cur, v.shooter, v.moving])]); break; }
    }
    ok(botShot && bad2.length === 0, "the bot shot (played on the driver's phone) and the three phones that are left have the same table again", bad2);

    // ------------------------------------------------------------------ the end, each in its own view, and again
    const endP = rest[rest.length - 1];
    await endP.evaluate(() => endGame(0, "test"));
    ok(await until(async () => (await Promise.all(rest.map(view))).every(v => v.over), 12000), "the match ended on one phone: the others end it too");
    await sleep(2500);
    const ev = await Promise.all(rest.map(view));
    const winG = await endP.evaluate(() => tnGs(game, 0));
    ok(ev.every(v => v.win === winG), "everybody has the same winning side (global): the team of the phone that ended it", ev.map(v => [v.seat, v.win]));
    const titles = await Promise.all(rest.map(p => p.evaluate(() => [document.getElementById("mTitle").textContent, document.getElementById("mBtns").textContent])));
    ok(titles.every(t => /YUTDI|WIN|WON/i.test(t[0]) && /&/.test(t[0])), "the result window names the winning team (two names)", titles);
    await shot(rest[0], "07_result");
    const hostP = all[0], again = rest.filter(p => p !== vp);
    for (const p of rest) await p.evaluate(() => [...document.querySelectorAll("#mBtns button")].find(x => /play again|yana/i.test(x.textContent)).click());
    ok(await until(async () => (await Promise.all(rest.map(p => p.evaluate(() => document.getElementById("tnRoom").classList.contains("on"))))).every(Boolean), 10000), "'Play again': the same people are back in the room window");
    ok(await until(async () => (await Promise.all(rest.map(p => p.evaluate(() => document.querySelectorAll("#tnRoom .tn-seat:not(.free)").length)))).every(n => n === 3), 8000), "the room has three people (the seat the bot played is free)");
    await shot(hostP, "08_room_again");
    // ------------------------------------------------------------------ the second match: two phones + two bots (the closed phone's seat is free)
    // Cara (seat 2) leaves the room: Alice + Bob against two bots? No - leave Alice (host) and Bob, plus the free seats as bots
    const leaver = rest.find(p => p !== hostP && p._name !== "Bob");
    if (leaver) { await leaver.evaluate(() => document.querySelector('#tnRoom [data-a="close"]').click()); await sleep(800); }
    const two = rest.filter(p => p !== leaver);
    ok(await until(async () => (await Promise.all(two.map(p => p.evaluate(() => document.querySelectorAll("#tnRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 8000), "a player who leaves the waiting room frees his seat");
    await hostP.evaluate(() => document.querySelector('#tnRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all(two.map(p => p.evaluate(() => !!(typeof game !== "undefined" && game && game.tnet && !game.over && mode === "game"))))).every(Boolean), 20000), "the host starts a second match with two phones: two bots play the empty seats");
    const cv0 = await converge(two, 0, 40000), bv = cv0.vs || await Promise.all(two.map(view));   // (a bot may break at once: the phones are compared the moment they have both stopped)
    ok(cv0.ok && same(bv, ["seed"]) && bv.every(v => v.names.flat().filter(n => /\*/.test(n)).length === 2) && bv.every(v => v.driver === 0), "the same table, the same turn, two bots, the host drives them", bv.map(v => [v.seat, v.cur, v.shooter, v.names]));
    await shot(two[0], "09_two_bots");
    // play five shots: human shots on whichever phone holds the cue, bot shots by the driver
    let bad3 = [], n3 = 0;
    for (let i = 1; i <= 5; i++) {
      await until(async () => { const v = await Promise.all(two.map(view)); return v.every(x => !x.moving && !x.strike) && same(v, ["shooter", "shotNo"]); }, 30000, 300);
      await sleep(1200);
      const v = await Promise.all(two.map(view)); if (v.some(x => x.over)) break;
      const h = v.findIndex(x => x.can);
      if (h >= 0) await shoot(two[h]);
      const cv = await converge(two, v[0].shotNo + 1, 70000);
      if (!cv.ok) { bad3.push(["not converged after " + v[0].shotNo, (cv.vs || []).map(x => x && [x.seat, x.cur, x.shooter, x.can, x.shotNo, x.moving])]); break; }
      n3++;
    }
    ok(bad3.length === 0 && n3 >= 4, `two phones + two bots: ${n3} shots (human and bot ones), the table is the same on both phones after each`, bad3);
    // ------------------------------------------------------------------ no page errors
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  try { await b.close(); } catch (e) {} srv.kill("SIGTERM"); process.exit(fail ? 1 : 0);
})();
