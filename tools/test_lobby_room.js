#!/usr/bin/env node
// The lobby as ONE room for all its members:  node tools/test_lobby_room.js   (B8_ROOT=<repo copy>)
// The owner (a friends' lobby, one friend inside Telegram): "the microphone does not work for him inside the match either, then he is frozen in the match and cannot play",
// "the next player must not just wait: he must be able to come in and watch our lobby match - nothing shows up for him", "all 8 must be able to switch the microphone on and talk", "add writing messages too".
// Real Chromium browsers with a fake microphone; a lobby of 3 (one of them has a bye), then more members come in while the tournament runs:
//  - VOICE: the lobby's voice room is not paused by a match of the lobby any more: the two players at the table and the one who waits stay connected to each other the whole time and hear each other
//           (the old game dropped the room and left only a 1-to-1 call between the two opponents); the table's 🎤 button is the room's microphone (lit / muted);
//  - WATCH: the live match is a row of the bracket WITH a "Watch" button the waiting player can really see and tap (it used to be thrown to the top-left corner, under the top bar, by a stray CSS rule);
//  - CHAT:  a member writes in the lobby, the players at the table get the line (corner feed + badge) and answer from the table; a member who comes in later gets what was written before;
//  - JOIN:  a player who comes to the lobby while its tournament runs is let in (it used to say "the tournament has started"): he sees the bracket, watches, talks and writes;
//  - NEXT MATCH: the winner who simply stays on the result screen goes on to his next match by himself after a few seconds (the button counts down) - the opponent, who is already at the table,
//           is not left "frozen" - and the match then really plays (a shot is seen on both phones);
//  - a refused microphone (the browser says no; Telegram's built-in browser): the player who tapped 🎤 gets a window that says why and what to do, and still hears the others as a listener.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8lr-")), P = +process.env.TEST_PORT || 8711, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async (name, o = {}) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US", permissions: ["microphone"], ...(o.ua ? { userAgent: o.ua } : {}) }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(([n, deny]) => {
      localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 }));
      if (deny) navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));   // "the browser says no"
    }, [name, !!o.deny]);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500); p._name = name; return p;
  };
  const until = async (fn, to = 25000, step = 400) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const lv = p => p.evaluate(() => { const s = LobbyVoice.state(), pcs = Object.values(s.peers).map(x => x.pc); return { want: s.want, susp: s.susp, mic: s.mic, listenOnly: s.listenOnly, muted: s.muted, count: s.count, pcs, ok: pcs.filter(x => x === "connected").length }; });
  const allTalk = (ps, n) => until(async () => (await Promise.all(ps.map(lv))).every(s => s.want && !s.susp && s.ok >= n - 1), 45000);
  const inSum = async p => p.evaluate(async () => Object.values(await LobbyVoice.stats()).reduce((t, x) => t + x.in, 0));
  const hears = async p => { const a = await inSum(p); await sleep(1500); return (await inSum(p)) - a; };
  const click = (p, id) => p.evaluate(i => document.getElementById(i).click(), id);
  const inGame = p => p.evaluate(() => !!(typeof game !== "undefined" && game && game.net && !game.net.spec && !game.over && mode === "game"));
  const seen = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2), box = document.querySelector(".lbmatches").getBoundingClientRect();
    return { hit: !!t && (t === e || e.contains(t)), inList: r.y >= box.y - 1 && r.y + r.height <= box.y + box.height + 1 && r.x >= box.x - 1, w: Math.round(r.width), txt: e.textContent.trim() }; }, sel);
  try {
    const A = await mk("Alpha"), B = await mk("Beta"), C = await mk("Gamma"), three = [A, B, C];
    await A.evaluate(() => lobbyCreate(CITIES[0].id, [])); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await A.evaluate(() => LB.code);
    for (const p of [B, C]) { await p.evaluate(c => lobbyJoin(c), code); await p.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); }
    await A.waitForFunction(() => LB && LB.players.length === 3, null, { timeout: 30000 }); await sleep(600);
    for (const p of three) { await click(p, "lbVoice"); await sleep(500); }
    ok(await allTalk(three, 3), "in the lobby: the three members are connected to each other in the voice room", await Promise.all(three.map(lv)));

    // ---------------------------------------------------------------- the tournament starts: two play, one has a bye and waits
    await A.evaluate(() => Net.send({ t: "start" }));
    ok(await until(async () => (await Promise.all(three.map(inGame))).filter(Boolean).length === 2, 40000), "the tournament starts: two members are at the table");
    const g0 = await Promise.all(three.map(inGame)), W = three[g0.indexOf(false)], [P1, P2] = three.filter((_, i) => g0[i]); await sleep(1500);
    // VOICE at the table
    ok(await allTalk(three, 3), "the match of the lobby does not pause the voice room: the two players and the waiting member stay connected to each other", await Promise.all(three.map(lv)));
    ok((await hears(W)) > 20, "the waiting member hears the players at the table (audio packets arrive)"); ok((await hears(P1)) > 20, "a player at the table hears the others of the lobby");
    ok((await Promise.all([P1, P2].map(p => p.evaluate(() => Voice.state().on)))).every(x => !x), "no separate 1-to-1 call is made at the table: the lobby's room is the voice");
    ok(await P1.evaluate(() => document.getElementById("gVoice").classList.contains("on") && getComputedStyle(document.getElementById("gVoice")).display !== "none"), "the table's 🎤 button is lit: my microphone is open in the lobby room");
    await click(P1, "gVoice");
    ok(await until(async () => (await lv(P1)).muted && await P1.evaluate(() => document.getElementById("gVoice").classList.contains("mute")) && await W.evaluate(id => { const s = LobbyVoice.state().peers[id]; return !!(s && s.mute); }, await P1.evaluate(() => String(lbMe()))), 8000),
      "tapping it mutes me: the button shows it and the others see my microphone as off");
    await click(P1, "gVoice"); ok(await until(async () => !(await lv(P1)).muted && await P1.evaluate(() => document.getElementById("gVoice").classList.contains("on")), 6000), "tapping again: on again");
    // WATCH: the waiting member's bracket
    await W.waitForFunction(() => document.querySelector("#lbBody .lbm.lblive .lbw"), null, { timeout: 15000 }).catch(() => {});
    const eye = await seen(W, "#lbBody .lbm.lblive .lbw");
    ok(eye && eye.hit && eye.inList && eye.w > 50 && /Watch/.test(eye.txt), "the waiting member SEES the live match in the bracket with a Watch button he can tap (it is inside the list and nothing covers it)", eye);
    ok(await W.evaluate(() => /watch the live match/i.test(document.querySelector(".lbright").textContent)), "and is told that he can watch it");
    // CHAT: the waiting member writes from the lobby screen
    await click(W, "lbChatB"); ok(await W.evaluate(() => document.getElementById("lbChat").classList.contains("on")), "the lobby has a chat button: it opens the lobby chat");
    await W.fill("#lbChatIn", "salom hammaga"); await click(W, "lbChatGo");
    ok(await until(async () => (await Promise.all(three.map(p => p.evaluate(() => LobbyChat.state().n)))).every(n => n === 1), 8000), "a written message reaches every member of the lobby", await Promise.all(three.map(p => p.evaluate(() => LobbyChat.state()))));
    ok(await W.evaluate(() => /salom hammaga/.test(document.getElementById("lbChatLog").textContent) && document.getElementById("lbChatIn").value === ""), "the writer sees his own line in the chat, the box is empty again");
    const p2s = await P2.evaluate(() => ({ st: LobbyChat.state(), btn: document.getElementById("lbChatG").classList.contains("on"), badge: document.getElementById("lbChatGN").textContent, feed: document.getElementById("liveFeed").textContent }));
    ok(p2s.st.unread === 1 && p2s.btn && p2s.badge === "1" && /Gamma|Alpha|Beta/.test(p2s.feed) && /salom hammaga/.test(p2s.feed), "a player at the table gets it: a line in the corner and a chat button with a badge", p2s);
    await click(P2, "lbChatG"); await P2.fill("#lbChatIn", "omad!"); await click(P2, "lbChatGo");
    ok(await until(async () => await W.evaluate(() => /omad!/.test(document.getElementById("lbChatLog").textContent)), 8000), "the player answers from the table: the lobby reads it");
    ok(await P2.evaluate(() => LobbyChat.state().unread === 0), "(opening the chat clears the badge)"); await click(P2, "lbChatX");
    // JOIN while the tournament runs
    const D = await mk("Delta"); await D.evaluate(c => lobbyJoin(c), code);
    ok(await until(async () => await D.evaluate(() => !!LB && !LB.pending && LB.state === "running" && !!LB.tour && document.getElementById("lbScr").classList.contains("on")), 20000), "a player who comes while the tournament runs is let into the lobby (not sent away with 'the tournament has started')", await D.evaluate(() => ({ lb: !!LB, st: LB && LB.state, tour: !!(LB && LB.tour) })));
    await D.waitForFunction(() => document.querySelector("#lbBody .lbm.lblive .lbw"), null, { timeout: 15000 }).catch(() => {});
    const eyeD = await seen(D, "#lbBody .lbm.lblive .lbw");
    ok(eyeD && eyeD.hit && eyeD.inList && await D.evaluate(() => /Tournament in progress/i.test(document.querySelector(".lbright").textContent)), "he sees the bracket of the running tournament and the Watch button", eyeD);
    ok(await until(async () => (await D.evaluate(() => LobbyChat.state().n)) === 2, 6000), "he gets what was written in the chat before he came", await D.evaluate(() => LobbyChat.state()));
    await click(D, "lbVoice");
    ok(await allTalk([A, B, C, D], 4), "he joins the voice room: now four are connected to each other - two of them at the table", await Promise.all([A, B, C, D].map(lv)));
    await D.evaluate(() => document.querySelector("#lbBody .lbw").click());
    ok(await until(async () => await D.evaluate(() => !!(game && game.net && game.net.spec && mode === "game")), 15000), "Watch opens the live match");
    await sleep(2500);
    const ds = await lv(D); ok(ds.want && !ds.susp && ds.ok >= 3, "while he watches he stays in the voice room", ds);
    ok(await D.evaluate(() => document.getElementById("lbChatG").classList.contains("on") && document.getElementById("lbChatG").classList.contains("spec")), "and has the chat button on the watching screen too (in the watcher's corner, above his microphone key)");

    // ---------------------------------------------------------------- the match ends; the winner does NOT tap "Continue"
    const room1 = await P1.evaluate(() => game.net.room);
    await P1.evaluate(() => endGame(0, "test")); await P2.evaluate(() => endGame(1, "test"));   // P1 wins
    ok(await until(async () => await W.evaluate(r => !!(game && game.net && !game.net.spec && !game.over && mode === "game" && game.net.room !== r), room1), 20000), "the member who had the bye is at the table of the final");
    ok(await until(async () => await P1.evaluate(() => document.getElementById("res").classList.contains("on") && /\(\d\)/.test((document.querySelector("#resBtns button.green") || {}).textContent || "")), 12000, 250), "the winner's result screen counts down on its Continue button (his opponent is waiting)", await P1.evaluate(() => (document.querySelector("#resBtns button.green") || {}).textContent));
    ok(await until(async () => await P1.evaluate(r => !!(game && game.net && !game.net.spec && !game.over && mode === "game" && game.net.room !== r), room1), 20000), "without a tap the winner is at the table of the final a few seconds later: nobody is left frozen", await P1.evaluate(() => ({ mode, res: document.getElementById("res").classList.contains("on"), q: !!(LB && LB.queued) })));
    ok(await until(async () => await P2.evaluate(() => !!LB && !!LB.results && LB.results.place >= 2), 8000), "(the loser is out and keeps his result)");
    await sleep(1500);
    const turn = await Promise.all([P1, W].map(p => p.evaluate(() => ({ can: canControl(), seat: seatOf(game.cur) }))));
    ok(turn[0].seat === turn[1].seat && turn.filter(t => t.can).length === 1, "both phones agree whose turn it is and that player can play", turn);
    const sh = turn[0].can ? P1 : W, ot = turn[0].can ? W : P1;
    await sh.evaluate(() => { const G = game, c = G.balls[0], t = G.balls.find(x => !x.out && x.n !== 0); G.angle = Math.atan2(t.y - c.y, t.x - c.x); G.elev = 0; G.spin = { x: 0, y: 0 }; requestShot(0.5); });
    ok(await until(async () => await ot.evaluate(() => (game.shotNo | 0) >= 1 || !!game.moving), 10000), "the final really plays: the shot of one player is seen on the other's phone");
    ok(await allTalk([A, B, C, D], 4), "the voice room is still whole in the final: the four are connected (two at the table, two not)", await Promise.all([A, B, C, D].map(lv)));

    // ---------------------------------------------------------------- a refused microphone
    const E = await mk("Echo", { deny: true }); await E.evaluate(c => lobbyJoin(c), code); await E.waitForFunction(() => LB && !LB.pending, null, { timeout: 30000 }); await sleep(600);
    await click(E, "lbVoice");
    ok(await until(async () => await E.evaluate(() => document.getElementById("modal").classList.contains("on") && /Microphone permission denied/i.test(document.getElementById("mTitle").textContent) && document.getElementById("mText").textContent.length > 20), 8000),
      "the browser refuses the microphone: the player who tapped 🎤 gets a window that says why and what to do (not a toast that is gone in 3 s)", await E.evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), t: document.getElementById("mTitle").textContent })));
    await E.evaluate(() => document.querySelector("#mBtns button").click());
    ok(await until(async () => { const s = await lv(E); return s.want && s.listenOnly && !s.mic && s.ok >= 4; }, 30000) && (await hears(E)) > 20, "he is in the room as a listener and hears the others", await lv(E));
    const F = await mk("Foxtrot", { deny: true, ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Telegram-Android/10.14.5" });
    await F.evaluate(c => lobbyJoin(c), code); await F.waitForFunction(() => LB && !LB.pending, null, { timeout: 30000 }); await sleep(600); await click(F, "lbVoice");
    ok(await until(async () => await F.evaluate(() => document.getElementById("modal").classList.contains("on") && /Telegram did not allow the microphone/i.test(document.getElementById("mTitle").textContent) && /Permissions/.test(document.getElementById("mText").textContent)), 8000),
      "inside Telegram: the window says that Telegram refused the microphone and where to allow it", await F.evaluate(() => document.getElementById("mTitle").textContent));

    // ---------------------------------------------------------------- the final ends: the lobby is open again, everybody is still in the room
    await P1.evaluate(() => endGame(0, "test")); await W.evaluate(() => endGame(1, "test"));
    ok(await until(async () => (await Promise.all([A, B, C, D, E].map(p => p.evaluate(() => !!LB && LB.state === "open" && !!LB.standings)))).every(Boolean), 20000), "the tournament is over: the lobby is open again for all its members, with the standings");
    ok(await until(async () => (await Promise.all([A, B, C, D, E].map(lv))).every(s => s.want && !s.susp && s.ok >= 4), 45000), "and everybody is still in the voice room", await Promise.all([A, B, C, D, E].map(lv)));
    ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
