#!/usr/bin/env node
// ONE place for every code:  node tools/test_code_join.js   (B8_ROOT=<repo copy>; about 2 minutes; the real server + 2 Chromium phones)
// The owner (Nov 28): "in chess / checkers press Create: it gives a code; he copies it and sends it to his partner; the partner enters the code WHERE? ... he must be able to enter it in one place".
// The old box (With friends -> "Kod bilan qo'shilish") only knew the 8-ball LOBBIES, so a board-room code gave "Bunday lobbi topilmadi". Now the key 🔑 of the top bar and that old box ask the server
// (jcode) what the code names and open the right room:
//  - the server answers jcode for a board room (with its game), a 2v2 room, an 8-ball lobby, and "none" for a code that names nothing; one namespace (a new room never reuses a live room's code)
//  - the key 🔑 opens the code window; a typed code (any case) takes the friend into a shashka room and a Magic Chess room (the room window shows the game), a 2v2 room, an 8-ball lobby
//  - a whole pasted share message works (the first word that names a room wins); an unknown code says "Room not found" and the window stays
//  - the old With-friends box takes a board-room code too; the host's window tells where the partner types the code
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cj-")), P = +process.env.TEST_PORT || 8793, base = `http://localhost:${P}`, errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async name => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage(); p._ctx = ctx;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} }); await sleep(900);
    await p.evaluate(() => { window.__toasts = []; window.toast = (i, t, s) => { window.__toasts.push(String(t) + "|" + String(s || "")); }; Net.ensure().then(() => Net.connect()); });
    p._name = name; return p;
  };
  const until = async (fn, to = 12000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  // the server's own answer to "what does this code name?": the page's route function is swapped for a moment (Net.on keeps one handler per message type)
  const ask = (p, codes) => p.evaluate(c => new Promise(res => { const orig = window.codeRoute; window.codeRoute = m => { window.codeRoute = orig; res(m); }; BR.cj = { words: c, done: false }; Net.send({ t: "jcode", codes: c }); setTimeout(() => { window.codeRoute = orig; res(null); }, 4000); }), codes);
  const typeCode = (p, text) => p.evaluate(t => { const i = document.querySelector("#brRoom .tn-code"); i.value = t; document.querySelector('#brRoom [data-a="join"]').click(); }, text);
  const seats = p => p.evaluate(() => [...document.querySelectorAll("#brRoom .tn-seat b")].map(x => x.textContent.replace(/\s*👑/, "")));
  try {
    const A = await mk("Alice"), B = await mk("Bob");
    ok(await A.evaluate(() => !!document.getElementById("codeBtn") && typeof codeOpen === "function"), "the top bar has the key 🔑");

    // ------------------------------------------------------------------ the host's window says where the partner types the code
    await A.evaluate(() => { toMenu("mini"); shRoomOpen("shashka"); }); await sleep(600);
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || ""))), "a shashka room has its 4-letter code");
    const c1 = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    const hint = await A.evaluate(() => (document.querySelector("#brRoom .tn-hint") || {}).textContent || "");
    ok(/🔑/.test(hint), "the host's window tells the partner where to type the code (the key 🔑)", hint);
    await shot(A, "01_host");

    // ------------------------------------------------------------------ what the server says about a code
    const a1 = await ask(B, [c1]), a2 = await ask(B, ["ZZZZ"]), a3 = await ask(B, ["SHASHKA", "ROYAL", c1.toLowerCase(), "BILLIARD"]);
    ok(a1 && a1.kind === "broom" && a1.game === "shashka" && a1.code === c1 && a1.state === "open", "jcode: a shashka room's code names a board room, its game and state", a1);
    ok(a2 && a2.kind === "none", "jcode: a code that names nothing says none", a2);
    ok(a3 && a3.kind === "broom" && a3.code === c1, "jcode: the first word that names a room wins (a whole share message)", a3);

    // ------------------------------------------------------------------ the key 🔑: a typed code (lower case) takes the friend into the shashka room
    await B.evaluate(() => document.getElementById("codeBtn").click()); await sleep(500);
    ok(await B.evaluate(() => document.getElementById("brRoom").classList.contains("on") && !!document.querySelector("#brRoom .tn-code") && !document.querySelector('#brRoom [data-a="create"]') && /Join with (a )?code/i.test(document.querySelector("#brRoom .tn-head b").textContent)), "the key 🔑 opens the code window: one box, no create key, its own title");
    await shot(B, "02_code_window");
    await typeCode(B, c1.toLowerCase());
    ok(await until(async () => (await Promise.all([A, B].map(seats))).every(n => n.join() === "Alice,Bob")), "the typed code takes the friend in: both phones show Alice and Bob", await Promise.all([A, B].map(seats)));
    ok(await B.evaluate(() => /Checkers/i.test(document.querySelector("#brRoom .tn-head b").textContent)), "the window of the joined room names its game (Checkers)");
    await shot(B, "03_joined");
    await A.evaluate(() => { shLeaveOnline(); brClose(); }); await B.evaluate(() => { shLeaveOnline(); brClose(); }); await sleep(600);

    // ------------------------------------------------------------------ a Magic Chess room, entered by a pasted share message
    await A.evaluate(() => { toMenu("mini"); shRoomOpen("magic"); }); await sleep(600);
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || ""))), "a Magic Chess room has its code", await A.evaluate(() => ({ want: BR.want, R: !!BR.R, on: document.getElementById("brRoom").classList.contains("on"), head: document.querySelector("#brRoom .tn-head b").textContent, body: document.querySelector("#brRoom .tn-body").textContent.slice(0, 120), toasts: window.__toasts })));
    const c2 = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await B.evaluate(() => { toMenu("mini"); codeOpen(); }); await sleep(500);
    await typeCode(B, `Sehrli shaxmat o'ynaymiz! Xona kodi: ${c2} · Royal Billiard 8`);
    ok(await until(async () => (await Promise.all([A, B].map(seats))).every(n => n.join() === "Alice,Bob"), 12000), "a pasted share message takes the friend into the Magic Chess room");
    ok(await B.evaluate(() => /Chess/i.test(document.querySelector("#brRoom .tn-head b").textContent)), "the window names the game (Magic Chess)", await B.evaluate(() => document.querySelector("#brRoom .tn-head b").textContent));
    await A.evaluate(() => { shLeaveOnline(); brClose(); }); await B.evaluate(() => { shLeaveOnline(); brClose(); }); await sleep(600);

    // ------------------------------------------------------------------ a 2v2 room
    await A.evaluate(() => { toMenu("mini"); tnOpen(); }); await sleep(600);
    await A.evaluate(() => document.querySelector('#tnRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#tnRoom .tn-codev") || {}).textContent || ""))), "a 2v2 room has its code");
    const c3 = await A.evaluate(() => document.querySelector("#tnRoom .tn-codev").textContent);
    const a4 = await ask(B, [c3]);
    ok(a4 && a4.kind === "troom", "jcode: a 2v2 room's code names a 2v2 room", a4);
    await B.evaluate(() => { toMenu("mini"); codeOpen(); }); await sleep(500);
    await typeCode(B, c3);
    ok(await until(async () => await B.evaluate(() => document.getElementById("tnRoom") && document.getElementById("tnRoom").classList.contains("on") && document.querySelectorAll("#tnRoom .tn-seat:not(.free)").length >= 2)), "the same box takes the friend into the 2v2 room");
    ok(await B.evaluate(() => !document.getElementById("brRoom").classList.contains("on")), "the code window closed itself");
    await A.evaluate(() => { try { Net.send({ t: "tleave" }); } catch (e) {} const o = document.getElementById("tnRoom"); if (o) o.classList.remove("on"); }); await B.evaluate(() => { try { Net.send({ t: "tleave" }); } catch (e) {} const o = document.getElementById("tnRoom"); if (o) o.classList.remove("on"); }); await sleep(600);

    // ------------------------------------------------------------------ an 8-ball lobby (6 letters)
    await A.evaluate(() => { toMenu("home"); lobbyCreate(null, [], { pub: false }); }); await sleep(1500);
    const c4 = await A.evaluate(() => LB && LB.code);
    ok(/^[A-Z2-9]{6}$/.test(c4 || ""), "an 8-ball lobby has its 6-letter code", c4);
    const a5 = await ask(B, [c4]);
    ok(a5 && a5.kind === "lobby", "jcode: a lobby's code names a lobby", a5);
    await B.evaluate(() => { toMenu("home"); codeOpen(); }); await sleep(500);
    await typeCode(B, c4);
    ok(await until(async () => await B.evaluate(c => !!(LB && LB.code === c && LB.players && LB.players.length >= 2), c4), 12000), "the same box takes the friend into the 8-ball lobby", await B.evaluate(() => LB && { code: LB.code, n: LB.players && LB.players.length }));
    await A.evaluate(() => { try { Net.send({ t: "cancel" }); } catch (e) {} LB = null; }); await B.evaluate(() => { try { Net.send({ t: "cancel" }); } catch (e) {} LB = null; }); await sleep(600);

    // ------------------------------------------------------------------ an unknown code; the old With-friends box
    await B.evaluate(() => { toMenu("home"); window.__toasts = []; codeOpen(); }); await sleep(500);
    await typeCode(B, "QQQQ");
    ok(await until(async () => (await B.evaluate(() => window.__toasts)).some(t => /Room not found/i.test(t) && /QQQQ/.test(t))), "an unknown code says Room not found", await B.evaluate(() => window.__toasts));
    ok(await B.evaluate(() => document.getElementById("brRoom").classList.contains("on") && !!document.querySelector("#brRoom .tn-code")), "the code window stays open after an unknown code (a mistyped letter is typed again)");
    await B.evaluate(() => { shLeaveOnline(); brClose(); }); await sleep(300);
    await A.evaluate(() => { toMenu("mini"); shRoomOpen("shashka"); }); await sleep(600);
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || ""))), "a second shashka room has its code");
    const c5 = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await B.evaluate(() => { go("withFrScr"); }); await sleep(900);
    await B.evaluate(() => document.querySelector('#wfBody .mgc[data-act="join"]').click()); await sleep(500);
    await B.evaluate(c => { document.getElementById("lbCode").value = c; [...document.querySelectorAll("#mBtns button")].find(x => /Join|Qo'shilish/i.test(x.textContent)).click(); }, c5);
    ok(await until(async () => (await Promise.all([A, B].map(seats))).every(n => n.join() === "Alice,Bob"), 12000), "the old With-friends box takes a shashka room code too (it used to say: no such lobby)", await Promise.all([A, B].map(seats)));

    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
    await A._ctx.close(); await B._ctx.close();
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
})();
