#!/usr/bin/env node
// Shashka online with a friend, with voice, end to end:  node tools/test_board_online.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 3 minutes; the real server + 2 Chromium phones with a fake microphone)
// The owner (Nov 23): shashka in the mini-games, "playing while talking". Two phones in one room:
//  - the list's Online row opens the room window: create a room (a code), the friend joins with a typed code (or an invite link), both see both seats; only the host has Start
//  - the voice: one taps 🎤, the other (speaker on) listens at once, and then talks back: audio bytes arrive in BOTH directions; the speaker key mutes the playback
//  - the match: the colours are drawn (one White, one Black, the board turns round for Black), a move on one phone is on the other one a moment later, out-of-turn taps do nothing, every move keeps the boards equal
//  - a draw offer is answered no, then yes; the result window on both; a rematch swaps the colours; a resignation; the page of one phone is reloaded in the middle of a match and the room window brings it back to the same position
//  - leaving the match gives it to the other one
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 800) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8bo-")), P = +process.env.TEST_PORT || 8798, base = `http://localhost:${P}`, errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async name => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, permissions: ["microphone"] }), p = await ctx.newPage(); p._ctx = ctx;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 50000 })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} }); await sleep(900);
    await p.evaluate(() => { window.__toasts = []; const o = window.toast; window.toast = (i, t) => { window.__toasts.push(String(t)); }; Net.ensure().then(() => Net.connect()); });
    p._name = name; return p;
  };
  const until = async (fn, to = 15000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  const S = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]);
  const view = p => p.evaluate(() => { if (typeof SHU === "undefined" || !SHU.on || !SHU.G) return null; const G = SHU.G; return { my: SHU.my, flip: SHU.flip, mode: SHU.mode, side: G.side, ply: G.moves.length, moves: G.moves.map(x => x.join(".")).join(","), board: Array.from(G.b).join(""), over: G.over, busy: SHU.busy, net: SHU.net ? { n: SHU.net.n, first: SHU.net.first, wait: !!SHU.net.wait, room: SHU.net.room } : null, turn: shTurnMine(), msg: document.getElementById("shMsg").textContent }; });
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: (document.getElementById("mText") || {}).textContent || "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  const tap = async (p, cells) => { for (const c of [].concat(cells)) { await p.evaluate(i => document.querySelector(`#shBoard .sq[data-i="${i}"]`).click(), c); await sleep(120); } };
  const bothSame = async (A, B2) => { const [a, c] = await Promise.all([view(A), view(B2)]); return a && c && a.board === c.board && a.moves === c.moves && a.side === c.side && a.my === -c.my; };
  // one move by whoever's turn it is: a legal move picked on that phone, played with taps
  const playOne = async (A, B2) => {
    const [a, c] = await Promise.all([view(A), view(B2)]); const mover = a.turn ? A : c.turn ? B2 : null, other = mover === A ? B2 : A; if (!mover) return null;
    const mv = await mover.evaluate(() => { const l = shGen(SHU.G.b, SHU.G.side); return l[Math.floor(Math.random() * l.length)].path; });
    const before = (await view(mover)).ply; await tap(mover, mv);
    const done = await until(async () => { const [x, y] = await Promise.all([view(mover), view(other)]); return x.ply === before + 1 && y.ply === before + 1 && !x.busy && !y.busy; }, 20000);
    return done ? mover : false;
  };
  try {
    const A = await mk("Alice"), B = await mk("Bob");

    // ------------------------------------------------------------------ the room window
    await A.evaluate(() => { toMenu("mini"); shPick(); }); await sleep(700);
    await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(600);
    ok(await A.evaluate(() => document.getElementById("brRoom").classList.contains("on") && !!document.querySelector('#brRoom [data-a="create"]') && !!document.querySelector("#brRoom .tn-code")), "the Online row opens the room window: create a room, or type a code");
    await shot(A, "01_window");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "creating a room shows its 4-letter code");
    const code = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await B.evaluate(() => { toMenu("mini"); shPick(); }); await sleep(600);
    await B.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(500);
    await B.evaluate(c => { document.querySelector("#brRoom .tn-code").value = c.toLowerCase(); document.querySelector('#brRoom [data-a="join"]').click(); }, code);
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => document.querySelectorAll("#brRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 10000), "a typed code takes the friend in: both phones show two seats taken");
    const names = await Promise.all([A, B].map(p => p.evaluate(() => [...document.querySelectorAll("#brRoom .tn-seat b")].map(x => x.textContent.replace(/\s*👑/, "")))));
    ok(names.every(n => n.join() === "Alice,Bob"), "both see the same two players", names);
    ok(await A.evaluate(() => !document.querySelector('#brRoom [data-a="start"]').disabled) && !(await B.evaluate(() => !!document.querySelector('#brRoom [data-a="start"]'))), "only the host has the Start key");
    await shot(A, "02_room"); await shot(B, "02_room_guest");

    // ------------------------------------------------------------------ the voice (in the room, before the match)
    await A.evaluate(() => shVoiceBtn("mic"));
    ok(await until(async () => (await B.evaluate(() => RV.state())).want, 8000), "Alice taps 🎤: Bob (speaker on) joins as a listener by himself");
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => RV.state().peers.some(x => x.live))))).every(Boolean), 15000), "the two phones are connected (a call)");
    ok(await until(async () => (await B.evaluate(() => RV.stats())).rx > 800, 12000), "Bob HEARS Alice: audio bytes arrive", await B.evaluate(() => RV.stats()));
    const bst = await B.evaluate(() => RV.state()); ok(bst.listenOnly && !bst.mic, "Bob is a listener (no microphone of his own yet)", bst);
    await B.evaluate(() => shVoiceBtn("mic"));
    ok(await until(async () => { const s = await B.evaluate(() => RV.state()); return s.mic && !s.listenOnly; }, 8000), "Bob taps 🎤 as well: now he talks too");
    ok(await until(async () => (await A.evaluate(() => RV.stats())).rx > 800, 12000), "Alice HEARS Bob: audio bytes arrive both ways", await A.evaluate(() => RV.stats()));
    await shot(A, "03_voice");
    await A.evaluate(() => shVoiceBtn("mic")); const mu = await A.evaluate(() => ({ muted: RV.state().muted, cls: document.querySelector('#brRoom [data-a="mic"]').className })); ok(mu.muted && /mute/.test(mu.cls), "the mic key mutes / unmutes", mu);
    await A.evaluate(() => shVoiceBtn("mic"));

    // ------------------------------------------------------------------ the match
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([A, B].map(view))).every(v => v && v.mode === "online"), 20000), "Start: both phones are at the board");
    await sleep(800);
    let [va, vb] = await Promise.all([A, B].map(view));
    ok(va.my === -vb.my && va.flip === (va.my < 0) && vb.flip === (vb.my < 0) && va.board === vb.board && va.net.first !== undefined, "one is White, the other Black; the Black phone's board is turned round; same position", [va.my, vb.my, va.flip, vb.flip]);
    ok((va.my > 0 ? va : vb).turn && !(va.my > 0 ? vb : va).turn, "only White can move");
    await shot(va.my > 0 ? A : B, "04_white"); await shot(va.my > 0 ? B : A, "04_black");
    // a tap out of turn does nothing
    const black = va.my > 0 ? B : A; await tap(black, [S("b6"), S("a5")]); ok((await view(black)).ply === 0, "a tap out of turn does nothing");
    let played = 0, bad = null;
    for (let i = 0; i < 12; i++) { const r = await playOne(A, B); if (r === null) { if ((await view(A)).over) break; bad = "nobody can move"; break; } if (r === false) { bad = ["a move did not arrive", await view(A), await view(B)]; break; } await sleep(250); if (!(await bothSame(A, B))) { bad = ["boards differ after move " + (i + 1), await view(A), await view(B)]; break; } played++; }
    ok(bad === null && played >= 8, `${played} moves: each one reaches the other phone and the boards, the turn and the move lists stay equal`, bad);
    await shot(A, "05_midgame");

    // ------------------------------------------------------------------ a draw offer: no, then yes
    const white = (await view(A)).my > 0 ? A : B, blk = white === A ? B : A;
    await white.evaluate(() => document.querySelector('#shScr [data-a="draw"]').click());
    ok(await until(async () => { const m = await modal(blk); return m && /draw/i.test(m.t); }, 6000), "a draw offer reaches the other phone as a question");
    await clickBtn(blk, "^No$|^Yo'q$|No"); await sleep(500);
    ok((await white.evaluate(() => window.__toasts)).some(t => /declined/i.test(t)) && !(await view(white)).over, "he says no: the game goes on and the offerer is told");
    await white.evaluate(() => document.querySelector('#shScr [data-a="draw"]').click()); await until(async () => { const m = await modal(blk); return m && /draw/i.test(m.t); }, 6000);
    await clickBtn(blk, "Yes"); await sleep(2200);
    const res = await Promise.all([A, B].map(modal));
    ok(res.every(m => m && /^Draw$/i.test(m.t.trim())) && (await Promise.all([A, B].map(view))).every(v => v.over && v.over.winner === 0), "he says yes: a draw on both phones (the result window)", res);
    await shot(A, "06_draw");

    // ------------------------------------------------------------------ a rematch: the colours swap
    const my0 = (await view(A)).my;
    await clickBtn(A, "Play again"); await sleep(600);
    ok((await B.evaluate(() => window.__toasts)).some(t => /rematch/i.test(t)), "Alice asks for a rematch: Bob is told");
    ok((await view(A)).net.wait, "she waits for him");
    await clickBtn(B, "Play again");
    ok(await until(async () => { const [x, y] = await Promise.all([A, B].map(view)); return x && y && x.ply === 0 && !x.over && !y.over && x.net && x.net.room !== y.net.wait; }, 10000) && (await view(A)).my === -my0, "both want it: a new match starts at once and the colours are swapped", [my0, (await view(A)).my]);

    // ------------------------------------------------------------------ the page of one phone is reloaded in the middle of a match
    for (let i = 0; i < 4; i++) { const r = await playOne(A, B); if (!r) break; await sleep(200); }
    const before = await view(A), room = before.net.room; ok(before.ply >= 3, "four moves played before the reload", before.ply);
    await B.reload({ waitUntil: "commit" });
    await B.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(1500);
    await B.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => window.__toasts.push(String(t)); Net.ensure().then(() => Net.connect()); }); await sleep(1500);
    await B.evaluate(() => { toMenu("mini"); shPick(); }); await sleep(500);
    await B.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click());
    ok(await until(async () => { const [x, y] = await Promise.all([A, B].map(view)); return y && y.net && y.net.room === room && y.moves === x.moves && y.board === x.board; }, 12000), "the reloaded phone: Online -> the room window brings it back to the same position (the whole move list)", [await view(A), await view(B)]);
    ok(await bothSame(A, B), "...and the boards are equal again");
    for (let i = 0; i < 2; i++) { const r = await playOne(A, B); ok(r, "the match goes on after the return (move " + (i + 1) + ")"); }

    // ------------------------------------------------------------------ a resignation, and leaving
    const bw = (await view(A)).my > 0 ? A : B, bb2 = bw === A ? B : A;
    await bw.evaluate(() => document.querySelector('#shScr [data-a="resign"]').click()); await sleep(400); await clickBtn(bw, "Yes"); await sleep(2200);
    const mm = await Promise.all([bw, bb2].map(modal));
    ok(mm[0] && /DEFEAT|LOSS|MAG|LOST/i.test(mm[0].t) && mm[1] && /VICTORY|WIN/i.test(mm[1].t) && /Resigned/i.test(mm[1].txt), "a resignation: the other phone wins (victory window with the reason)", mm);
    await clickBtn(bw, "Play again"); await clickBtn(bb2, "Play again");
    ok(await until(async () => (await Promise.all([A, B].map(view))).every(v => v && v.ply === 0 && !v.over), 10000), "another match");
    await playOne(A, B);
    await A.evaluate(() => document.querySelector('#shScr [data-a="exit"]').click()); await sleep(400); await clickBtn(A, "Leave|Chiqish|Exit");
    ok(await until(async () => { const m = await modal(B); return m && /VICTORY|WIN/i.test(m.t) && /left/i.test(m.txt); }, 8000), "a player who leaves in the middle loses: the other one gets the victory window ('the opponent left')", await modal(B));
    ok(await A.evaluate(() => !document.getElementById("shScr").classList.contains("on")), "the leaver is back in the menu");
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  try { await b.close(); } catch (e) {} srv.kill("SIGTERM"); process.exit(fail ? 1 : 0);
})();
