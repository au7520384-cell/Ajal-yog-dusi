#!/usr/bin/env node
// A FULL lobby: 8 players, all with the microphone on, a whole knockout tournament:  node tools/test_lobby_8.js   (B8_ROOT=<repo copy>, TEST_PORT)
// The owner: "8 people play in the lobby: all of them must be able to switch the microphone on and talk", "the next match: he is frozen and cannot play".
// 8 real Chromium browsers (fake microphone) against the real server:
//  - everybody taps the lobby 🎤: every phone is connected to the 7 others (a mesh of 28 calls) and audio flows;
//  - one writes in the lobby chat: all 8 get it;
//  - the host starts: round 1 = 4 matches (all 8 at a table), the room is still whole at the tables (every phone connected to the 7 others, audio flows), nobody taps "Continue" -
//    round 2 (4 players, 2 matches) and the final start by themselves; the eliminated ones (now only watching or waiting) keep talking; every started match really plays (a shot is seen on the other phone);
//  - at the end the lobby is open again with the standings, all 8 still in the voice room.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), N = +process.env.PLAYERS || 8;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8l8-")), P = +process.env.TEST_PORT || 8731, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async name => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US", permissions: ["microphone"] }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 }); await sleep(600);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(400); p._name = name; return p;
  };
  const until = async (fn, to = 30000, step = 500) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const lv = p => p.evaluate(() => { const s = LobbyVoice.state(), v = Object.values(s.peers); return { want: s.want, susp: s.susp, mic: s.mic, listenOnly: s.listenOnly, ok: v.filter(x => x.pc === "connected").length, n: v.length }; });
  const whole = async (ps, need, to = 90000) => { let last = []; const r = await until(async () => { last = await Promise.all(ps.map(lv)); return last.every(s => s.want && !s.susp && s.ok >= need); }, to, 1000); return { r, last }; };
  const inSum = p => p.evaluate(async () => Object.values(await LobbyVoice.stats()).reduce((t, x) => t + x.in, 0));
  const hears = async p => { const a = await inSum(p); await sleep(1500); return (await inSum(p)) - a; };
  const atTable = p => p.evaluate(() => !!(typeof game !== "undefined" && game && game.net && !game.net.spec && !game.over && mode === "game"));
  try {
    const ps = []; for (let i = 0; i < N; i++) ps.push(await mk("P" + (i + 1)));
    const H = ps[0]; await H.evaluate(() => lobbyCreate(CITIES[0].id, [])); await H.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await H.evaluate(() => LB.code);
    for (const p of ps.slice(1)) { await p.evaluate(c => lobbyJoin(c), code); await p.waitForFunction(() => LB && !LB.pending, null, { timeout: 90000 }); }
    ok(await until(async () => await H.evaluate(n => LB.players.length === n, N), 30000), `all ${N} are in the lobby`);
    for (const p of ps) { await p.evaluate(() => document.getElementById("lbVoice").click()); await sleep(400); }
    let w = await whole(ps, N - 1, 120000);
    ok(w.r, `all ${N} are in the voice room, every phone is connected to the other ${N - 1}`, w.last);
    ok((await hears(ps[N - 1])) > 20 && (await hears(ps[1])) > 20, "audio flows to the phones (the first and the last one hear the others)");
    await ps[3].evaluate(() => document.getElementById("lbChatB").click()); await ps[3].fill("#lbChatIn", "hammaga salom"); await ps[3].evaluate(() => document.getElementById("lbChatGo").click());
    ok(await until(async () => (await Promise.all(ps.map(p => p.evaluate(() => LobbyChat.state().n)))).every(n => n === 1), 10000), `a line written in the lobby chat reaches all ${N}`);

    await H.evaluate(() => Net.send({ t: "start" }));
    const rounds = [N / 2, N / 4, 1].filter(x => x >= 1);   // matches in round 1, 2, 3 (8 players)
    for (let r = 0; r < rounds.length; r++) {
      const want = rounds[r] * 2;
      ok(await until(async () => (await Promise.all(ps.map(atTable))).filter(Boolean).length === want, 90000, 1000), `round ${r + 1}: ${want} players are at the ${rounds[r]} table(s) - without anybody tapping Continue`, (await Promise.all(ps.map(atTable))));
      await sleep(2000);
      w = await whole(ps, N - 1, 60000);
      ok(w.r, `round ${r + 1}: the room is whole at the tables - every phone is connected to the other ${N - 1}`, w.last);
      const at = (await Promise.all(ps.map(atTable))).map((x, i) => x ? ps[i] : null).filter(Boolean), off = ps.filter(p => !at.includes(p));
      if (off.length) ok((await hears(off[0])) > 20, `round ${r + 1}: a member who is not at a table hears the others`);
      // a shot at one table is seen on the other phone of that table
      const info = await Promise.all(at.map(p => p.evaluate(() => ({ room: game.net.room, seat: game.net.seat, can: canControl() }))));
      const sh = at[info.findIndex(x => x.can)]; const rm = info.find(x => x.can) && info.find(x => x.can).room, ot = at.find((p, i) => info[i].room === rm && !info[i].can);
      if (sh && ot) { await sh.evaluate(() => { const G = game, c = G.balls[0], t = G.balls.find(x => !x.out && x.n !== 0); G.angle = Math.atan2(t.y - c.y, t.x - c.x); G.elev = 0; G.spin = { x: 0, y: 0 }; requestShot(0.5); });
        ok(await until(async () => await ot.evaluate(() => (game.shotNo | 0) >= 1 || !!game.moving), 10000), `round ${r + 1}: a started match really plays (the shot is seen on the opponent's phone)`); }
      else ok(false, `round ${r + 1}: found a player who can shoot`, info);
      // every match ends: the player of seat 0 wins everywhere
      await Promise.all(at.map(async (p, i) => p.evaluate(seat => endGame(seat === 0 ? 0 : 1, "test"), info[i].seat)));
      await sleep(3000);
    }
    ok(await until(async () => (await Promise.all(ps.map(p => p.evaluate(() => !!LB && LB.state === "open" && !!LB.standings)))).every(Boolean), 90000, 1000), "the tournament is over: the lobby is open again with the standings for all");
    w = await whole(ps, N - 1, 90000); ok(w.r, "and all of them are still in the voice room", w.last);
    ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
