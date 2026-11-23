#!/usr/bin/env node
// Magic Chess online with a friend, with voice, end to end:  node tools/test_magic_online.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 3 minutes; the real server + 2 Chromium phones with a fake microphone)
// The same room, move list and voice as shashka (server "board game rooms", RoomVoice), another game on top:
//  - the Online row of the Magic Chess list opens the room window (titled Magic Chess); a typed code takes the friend in; the voice room works (audio both ways)
//  - the match: the colours are drawn, the Black phone's board is turned round, a move on one phone reaches the other, the boards stay equal over 24 plies (captures, checks, castling and promotions are played too:
//    the moves are picked at random with a taste for captures); a promotion travels as [from, to, choice]; a draw offer yes; a rematch swaps the colours; a resignation; leaving gives the match to the other one
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 800) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8mo-")), P = +process.env.TEST_PORT || 8799, base = `http://localhost:${P}`, errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async name => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, permissions: ["microphone"] }), p = await ctx.newPage(); p._ctx = ctx;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { window.__WZ_OFF = true; localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 50000 })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} }); await sleep(900);
    await p.evaluate(() => { window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; Net.ensure().then(() => Net.connect()); });
    p._name = name; return p;
  };
  const until = async (fn, to = 15000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  const view = p => p.evaluate(() => { if (typeof MCU === "undefined" || !MCU.on || !MCU.G) return null; const G = MCU.G; return { my: MCU.my, flip: MCU.flip, mode: MCU.mode, side: G.side, ply: G.moves.length, moves: G.moves.map(x => x.join(".")).join(","), board: Array.from(G.P.b).join(",") + "|" + G.P.cas + "|" + G.P.ep, over: G.over, busy: MCU.busy, net: MCU.net ? { n: MCU.net.n, first: MCU.net.first, wait: !!MCU.net.wait, room: MCU.net.room } : null, turn: mcTurnMine(), msg: document.getElementById("mcMsg").textContent }; });
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: (document.getElementById("mText") || {}).textContent || "", btns: [...document.getElementById("mBtns").querySelectorAll("button")].map(x => x.textContent), picks: document.querySelectorAll("#mExtra .mc-pk").length } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  const tap = async (p, cells) => { for (const c of [].concat(cells)) { await p.evaluate(i => document.querySelector(`#mcBoard .sq[data-i="${i}"]`).click(), c); await sleep(130); } };
  const bothSame = async (A, B2) => { const [a, c] = await Promise.all([view(A), view(B2)]); return a && c && a.board === c.board && a.moves === c.moves && a.side === c.side && a.my === -c.my; };
  // one move by whoever's turn it is: a legal move (a taste for captures, castling and promotions) picked on that phone and played with taps; a promotion's picker is answered
  const playOne = async (A, B2, kinds) => {
    const [a, c] = await Promise.all([view(A), view(B2)]); const mover = a.turn ? A : c.turn ? B2 : null, other = mover === A ? B2 : A; if (!mover) return null;
    const mv = await mover.evaluate(() => { const l = mcLegal(MCU.G.P), fav = l.filter(m => m.c || m.k >= 3 || m.p), pool = fav.length && Math.random() < 0.7 ? fav : l, m = pool[Math.floor(Math.random() * pool.length)]; return { path: mcPath(m), c: m.c, k: m.k, p: m.p }; });
    const before = (await view(mover)).ply; await tap(mover, mv.path.slice(0, 2));
    if (mv.path.length > 2) { await sleep(300); await mover.evaluate(i => document.querySelectorAll("#mExtra .mc-pk")[i].click(), mv.path[2]); }
    const done = await until(async () => { const [x, y] = await Promise.all([view(mover), view(other)]); return x.ply === before + 1 && y.ply === before + 1 && !x.busy && !y.busy; }, 20000);
    if (kinds) { if (mv.c) kinds.cap++; if (mv.k >= 3) kinds.castle++; if (mv.p) kinds.promo++; if (mv.k === 2) kinds.ep++; }
    return done ? mover : false;
  };
  try {
    const A = await mk("Alice"), B = await mk("Bob");

    // ------------------------------------------------------------------ the room window and the voice
    await A.evaluate(() => { toMenu("mini"); mcPick(); }); await sleep(700);
    await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(600);
    ok(await A.evaluate(() => document.getElementById("brRoom").classList.contains("on") && /Magic Chess/.test(document.querySelector("#brRoom .tn-head b").textContent)), "the Online row opens the room window titled Magic Chess");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "creating a room shows its code");
    const code = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await B.evaluate(() => { toMenu("mini"); mcPick(); }); await sleep(600);
    await B.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(500);
    await B.evaluate(c => { document.querySelector("#brRoom .tn-code").value = c; document.querySelector('#brRoom [data-a="join"]').click(); }, code);
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => document.querySelectorAll("#brRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 10000), "the friend joins: both phones show two seats taken");
    ok(await B.evaluate(() => /Magic Chess/.test(document.querySelector("#brRoom .tn-head b").textContent)), "the friend's window is titled Magic Chess too (the game comes from the room)");
    await shot(A, "01_room");
    await A.evaluate(() => shVoiceBtn("mic"));
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => RV.state().peers.some(x => x.live))))).every(Boolean), 20000), "voice: Alice taps the mic, Bob listens by himself, the call is connected");
    ok(await until(async () => (await B.evaluate(() => RV.stats())).rx > 800, 12000), "Bob hears Alice (audio bytes arrive)");

    // ------------------------------------------------------------------ the match
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([A, B].map(view))).every(v => v && v.mode === "online"), 20000), "Start: both phones are at the Magic Chess board");
    await sleep(800);
    const [va, vb] = await Promise.all([A, B].map(view));
    ok(va.my === -vb.my && va.flip === (va.my < 0) && vb.flip === (vb.my < 0) && va.board === vb.board, "one is White, the other Black; the Black phone's board is turned round; same position", [va.my, vb.my, va.flip, vb.flip]);
    ok((va.my > 0 ? va : vb).turn && !(va.my > 0 ? vb : va).turn, "only White can move");
    await shot(va.my > 0 ? A : B, "02_white"); await shot(va.my > 0 ? B : A, "02_black");
    const black = va.my > 0 ? B : A; await tap(black, [8 + 1, 8 * 3 + 1]); ok((await view(black)).ply === 0, "a tap out of turn does nothing");
    const kinds = { cap: 0, castle: 0, promo: 0, ep: 0 }; let played = 0, bad = null;
    for (let i = 0; i < 24; i++) { const r = await playOne(A, B, kinds); if (r === null) { if ((await view(A)).over) break; bad = "nobody can move"; break; } if (r === false) { bad = ["a move did not arrive", await view(A), await view(B)]; break; } await sleep(200); if (!(await bothSame(A, B))) { bad = ["boards differ after move " + (i + 1), await view(A), await view(B)]; break; } played++; if ((await view(A)).over) break; }
    ok(bad === null && played >= 10, `${played} plies (captures ${kinds.cap}, castles ${kinds.castle}, promotions ${kinds.promo}): each reaches the other phone and the boards, the turn and the move lists stay equal`, bad);
    await shot(A, "03_midgame");

    // ------------------------------------------------------------------ a promotion over the wire: [from, to, choice]
    if (!(await view(A)).over) {
      for (const p of [A, B]) await p.evaluate(() => { const G = MCU.G; G.P = mcFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1"); G.side = 1; G.moves = []; G.over = null; G.check = false; G.seen = {}; G.last = null; MCU.sel = null; mcRender(); });   // (the move counter of the wire stays: the next move is the next number for the server too)
      const wp = (await view(A)).my > 0 ? A : B, bp = wp === A ? B : A;
      await tap(wp, [S2("a7"), S2("a8")]); await sleep(400); const pm = await modal(wp); ok(pm && pm.picks === 4, "a promotion over the wire: the picker with four pieces", pm);
      await wp.evaluate(() => document.querySelectorAll("#mExtra .mc-pk")[1].click());   // a rook
      ok(await until(async () => (await bp.evaluate(() => MCU.G.P.b[0])) === 4 || (await bp.evaluate(() => MCU.G.P.b[0])) === 4, 6000) && (await wp.evaluate(() => MCU.G.P.b[0])) === 4, "the choice (a rook) arrives as the third number of the path: both boards have the rook", [await wp.evaluate(() => MCU.G.moves), await bp.evaluate(() => MCU.G.moves)]);
    }
    function S2(a) { return 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]); }

    // ------------------------------------------------------------------ a draw offer, a rematch with swapped colours, a resignation, leaving
    const white = (await view(A)).my > 0 ? A : B, blk = white === A ? B : A;
    await white.evaluate(() => { MCU.G.over = null; document.querySelector('#mcScr [data-a="draw"]').click(); });
    ok(await until(async () => { const m = await modal(blk); return m && /draw/i.test(m.t); }, 6000), "a draw offer reaches the other phone as a question");
    await clickBtn(blk, "Yes"); await sleep(2400);
    const res = await Promise.all([A, B].map(modal)); ok(res.every(m => m && /^Draw$/i.test(m.t.trim())), "he says yes: a draw on both phones", res);
    const my0 = (await view(A)).my;
    await clickBtn(A, "Play again"); await sleep(500); await clickBtn(B, "Play again");
    ok(await until(async () => { const [x, y] = await Promise.all([A, B].map(view)); return x && y && x.ply === 0 && !x.over && !y.over; }, 10000) && (await view(A)).my === -my0, "both want a rematch: a new match with the colours swapped", [my0, (await view(A)).my]);
    ok(await bothSame(A, B), "the new match: the same start position");
    const bw = (await view(A)).my > 0 ? A : B, bb2 = bw === A ? B : A;
    await playOne(A, B);
    await bw.evaluate(() => document.querySelector('#mcScr [data-a="resign"]').click()); await sleep(400); await clickBtn(bw, "Yes"); await sleep(2400);
    const mm = await Promise.all([bw, bb2].map(modal)); ok(mm[0] && mm[1] && /VICTORY/i.test(mm[1].t) && /Resigned/i.test(mm[1].txt), "a resignation: the other phone wins (victory window with the reason)", mm);
    await clickBtn(bw, "Play again"); await clickBtn(bb2, "Play again");
    ok(await until(async () => (await Promise.all([A, B].map(view))).every(v => v && v.ply === 0 && !v.over), 10000), "another match");
    await playOne(A, B);
    await A.evaluate(() => document.querySelector('#mcScr [data-a="exit"]').click()); await sleep(400); await clickBtn(A, "Leave|Exit");
    ok(await until(async () => { const m = await modal(B); return m && /VICTORY/i.test(m.t) && /left/i.test(m.txt); }, 8000), "a player who leaves in the middle loses: the other one gets the victory window", await modal(B));
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  try { await b.close(); } catch (e) {} srv.kill("SIGTERM"); process.exit(fail ? 1 : 0);
})();
