#!/usr/bin/env node
// Board game rooms in the WORLD CHAT:  node tools/test_world_board.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 2 minutes; the real server + 3 Chromium phones)
// The owner (Nov 24): "make it so the lobby of shashka / chess / mafia can be posted to the world chat, people gather faster; friends can be invited". The host of an open board room has a 🌐 key in the room window;
// the world chat lists the room as a card (the game, the seats n/max, the host); the code is never in the list; Join asks the host (a banner: yes / no); only a yes opens the room for the asking player.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "", P = +process.env.TEST_PORT || 8804;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const until = async (fn, to = 15000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
(async () => {
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wb-")), base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, MAFIA_SCALE: "0.08", WORLD_REQ_MS: "8000" }, stdio: "ignore" });
  await until(() => fetch(base + "/api/health").then(r => r.ok).catch(() => false), 60000, 300);
  const b = await chromium.launch(), errs = [];
  const open = async name => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, hasTouch: true, isMobile: true }), p = await ctx.newPage(); p._ctx = ctx; p._name = name;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => window.__toasts.push(String(t)); }); await sleep(1500);
    await p.evaluate(() => Net.ensure().then(() => Net.connect())); await sleep(500); return p;
  };
  const world = p => p.evaluate(() => Net.api("/api/world").then(r => ({ lobbies: r.lobbies, raw: JSON.stringify(r) })));
  const card = p => p.evaluate(() => [...document.querySelectorAll("#wLobList .wlc")].map(c => ({ t: c.querySelector(".wlt").textContent, host: (c.querySelector(".wln b") || {}).textContent, btn: (c.querySelector("button[data-w]") || {}).textContent, dis: !!(c.querySelector("button[data-w]") || {}).disabled })));
  try {
    const A = await open("Ann"), B = await open("Bob"), C = await open("Cat");
    for (const x of [A, B, C]) await x.evaluate(() => toMenu("mini"));
    // ------------------------------------------------------------------ a shashka room
    await A.evaluate(() => shRoomOpen("shashka")); await sleep(600); await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(() => A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "a shashka room is made");
    const code = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    ok(await A.evaluate(() => !!document.querySelector('#brRoom [data-a="world"]')), "the host's room window has the 🌐 key (the world chat)");
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "01_room.png") });
    ok((await world(B)).lobbies.length === 0, "nothing is in the world chat yet");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="world"]').click()); await sleep(800);
    ok(await A.evaluate(() => window.__toasts.some(t => /world chat/i.test(t))), "the 🌐 key posts the room (a note says so)", await A.evaluate(() => window.__toasts));
    const w1 = await world(B), L = w1.lobbies[0];
    ok(w1.lobbies.length === 1 && L.kind === "board" && L.game === "shashka" && L.n === 1 && L.max === 2 && L.open === true && L.name === "Ann", "the world list has the card: a board room, shashka, 1 of 2, open, Ann's", L);
    ok(!w1.raw.includes(code), "the room's code is NOT in what the world chat sends to everybody");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="world"]').click()); await sleep(400);
    ok(await A.evaluate(() => window.__toasts.length >= 2), "a second post right away is asked to wait (no flood)");

    // ------------------------------------------------------------------ Bob sees the card and asks to join; Ann says yes
    await B.evaluate(() => WorldChat.open()); await sleep(900);
    const c1 = await card(B); ok(c1.length === 1 && /Checkers/.test(c1[0].t) && /1\/2/.test(c1[0].t) && c1[0].host === "Ann" && /Join/.test(c1[0].btn) && !c1[0].dis, "Bob's world chat shows the card: Checkers, 1/2, the host, a Join key", c1);
    if (SHOT) await B.screenshot({ path: path.join(SHOT, "02_world.png") });
    await B.evaluate(() => document.querySelector("#wLobList [data-w]").click());
    ok(await until(() => A.evaluate(() => !!document.querySelector("#wReq .wrq .y")), 6000), "Ann gets the question (a banner with yes / no) over her room window");
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "03_banner.png") });
    await A.evaluate(() => document.querySelector("#wReq .wrq .y").click());
    ok(await until(() => B.evaluate(() => !!(document.getElementById("brRoom") && document.getElementById("brRoom").classList.contains("on")) && BR.code), 10000), "yes: Bob's room window opens");
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => document.querySelectorAll("#brRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 8000), "both phones show the two seats taken");
    ok((await B.evaluate(() => BR.code)) === code && !(await B.evaluate(() => document.getElementById("wChat").classList.contains("on"))), "Bob is in Ann's room (the code came only with the yes), the world chat is closed");
    const w2 = await world(C); ok(w2.lobbies.length === 1 && w2.lobbies[0].open === false && w2.lobbies[0].n === 2, "the room is full: its card is closed (2/2)", w2.lobbies[0]);
    await C.evaluate(() => WorldChat.open()); await sleep(900); const c2 = await card(C); ok(c2.length === 1 && c2[0].dis, "Cat sees the card, Join is off", c2);
    ok(((await C.evaluate(() => Net.api("/api/world/join", { wid: document.querySelector("#wLobList [data-w]").dataset.w }))).state) === "full", "a Join on a full room says full");
    await C.evaluate(() => WorldChat.close());
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click()); await sleep(900);
    ok((await world(C)).lobbies.length === 0, "the match starts: the card leaves the list");
    for (const x of [A, B]) await x.evaluate(() => { document.querySelector('#shScr [data-a="exit"]').click(); }); await sleep(400);
    for (const x of [A, B]) { await x.evaluate(() => { const bt = [...document.querySelectorAll("#mBtns button")].find(y => /Exit|Leave/i.test(y.textContent)); if (bt) bt.click(); }); } await sleep(600);

    // ------------------------------------------------------------------ a Mafia room: 1 of 8; a "no" from the host
    for (const x of [A, B]) await x.evaluate(() => { try { shLeaveOnline(); } catch (e) {} brClose(); window.__toasts = []; }); await sleep(500);
    await A.evaluate(() => shRoomOpen("mafia")); await sleep(600); await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(() => A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "a Mafia room is made");
    ok(await A.evaluate(() => !!document.querySelector('#brRoom [data-a="world"]')), "the Mafia room window has the 🌐 key too");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="world"]').click()); await sleep(800);
    const w3 = await world(C), M = w3.lobbies[0]; ok(w3.lobbies.length === 1 && M.game === "mafia" && M.n === 1 && M.max === 8 && M.open === true, "the card: Mafia, 1 of 8, open", M);
    await C.evaluate(() => WorldChat.open()); await sleep(900); const c3 = await card(C); ok(c3.length === 1 && /Mafia/.test(c3[0].t) && /1\/8/.test(c3[0].t), "Cat's world chat shows the Mafia card", c3);
    await C.evaluate(() => document.querySelector("#wLobList [data-w]").click());
    ok(await until(() => A.evaluate(() => !!document.querySelector("#wReq .wrq .n")), 6000), "Ann is asked again");
    await A.evaluate(() => document.querySelector("#wReq .wrq .n").click());
    ok(await until(() => C.evaluate(() => window.__toasts.some(t => /declined/i.test(t))), 8000), "no: Cat is told 'the lobby owner declined'", await C.evaluate(() => window.__toasts));
    ok(await C.evaluate(() => !!!(document.getElementById("brRoom") && document.getElementById("brRoom").classList.contains("on")) && !BR.code), "...and she is not in the room");
    await sleep(600);
    // the host leaves: the card is gone
    await A.evaluate(() => { try { shLeaveOnline(); } catch (e) {} brClose(); }); await sleep(800);
    ok((await world(C)).lobbies.length === 0, "the host leaves: the card is gone");
    // a room that is not posted is not in the list; a player who is not the host cannot post
    await B.evaluate(() => shRoomOpen("shashka")); await sleep(600); await B.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click()); await sleep(900);
    ok((await world(C)).lobbies.length === 0, "a room nobody posted is not listed");
    ok(await C.evaluate(() => Net.api("/api/world/lobby", { board: 1 }).then(() => false).catch(e => /nolobby/.test(String(e && e.message)))), "a player who has no room cannot post one");
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
    for (const x of [A, B, C]) await x._ctx.close();
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} process.exit(fail ? 1 : 0);
})();
