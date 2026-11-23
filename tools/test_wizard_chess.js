#!/usr/bin/env node
// The 3D Wizard Chess inside the game:  node tools/test_wizard_chess.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; PART=A runs only the one-phone part; about 12 minutes: the hall is drawn by the browser's software WebGL, ~20 s to open)
// The owner (Nov 23, with a screenshot of the finished 3D chess): "Mana tayyor" - this is the chess of the Board games row. wizard-chess/index.html is opened in a frame (#wzScr); the game keeps the rules, the room, the voice.
//  - the page is found (wizard-chess/ok.json) and WebGL is there: the Magic Chess card opens the 3D page (against the computer, two on one phone); where the page is not found or WebGL is off, the flat board opens
//  - the 3D page and the game's own rules core (pro_a) are two engines: over six random games every position has the SAME legal moves in both (the frame's engine says, the game's core is compared), a move's text ("e7e8q") and path round-trip
//  - a finger plays in the hall (a tap on the piece, a tap on the cell), the computer answers, the close key frees the hall
//  - the owner's phone: a 412 x 915 window in which the page is turned 90 degrees (html.rot): the hall opens in the turned page and a REAL touch (the screen point goes through the turn into the frame) plays e2e4, the computer answers
//  - online (real server, 2 phones with a fake microphone): the frame draws and takes MY moves, the game checks them by its rules and sends them; the friend's move is played in the other hall; a move out of turn does nothing;
//    a draw offer, the result window, a rematch (the colours swap, the hall opens straight at the board), a resignation, a reload of the page in the middle (the move list brings the hall back), leaving
const { chromium } = require("playwright"), { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const until = async (fn, to = 15000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
(async () => {
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const errs = [], b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const frameOf = p => p.frames().find(f => /wizard-chess\/index\.html/.test(f.url())) || null;
  // (the browser draws the hall in software at a few frames a second: __wcMaxDt lets a frame count as half a second, or the camera sweep and the moves would take a minute)
  const mkPage = async (base, name, o = {}) => {
    const ctx = await b.newContext({ viewport: o.vp || { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, permissions: ["microphone"] }), p = await ctx.newPage(); p._ctx = ctx;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(([n, off]) => { if (/wizard-chess/.test(location.pathname)) { window.__wcTest = true; window.__wcMaxDt = 0.5; window.__wcPR = 0.5; return; } if (off) window.__WZ_OFF = true; localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); localStorage.setItem("b8guest", "1"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 50000 })); }, [name, !!o.off]);
    if (o.block) await p.route(/wizard-chess\/ok\.json/, r => r.abort());
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; }); await sleep(900);
    p._name = name; return p;
  };
  const hall = async (p, to = 120000) => {   // the hall is drawn and the frame said "ready"; then the camera has stopped (a tap is meant for the square that is under the finger)
    if (!await until(async () => await p.evaluate(() => WZ.ready), to, 500)) return false;
    await until(async () => { const f = frameOf(p); const v = f ? await f.evaluate(() => window.__wc ? !window.__wc.cam.anim && !window.__wc.state().introRunning : false).catch(() => false) : false; return v; }, 20000, 300); await sleep(400); return true;
  };
  const sq88 = u => (+u[1] - 1) * 16 + "abcdefgh".indexOf(u[0]);
  const fstate = p => { const f = frameOf(p); return f ? f.evaluate(() => window.__wc ? window.__wc.state() : null).catch(() => null) : Promise.resolve(null); };
  const tapSq = async (p, u, h = 0) => { const f = frameOf(p), xy = await f.evaluate(([sq, h]) => window.__wc.sqScreen(sq, h), [sq88(u), h]); await f.evaluate(([x, y]) => window.__wc.onTap(x, y), xy); await sleep(350); };   // h: the height of the touch (a piece is touched on its body: the tall ones in front hide the ground behind them)
  const tapPiece = async (p, u) => {   // a finger on a piece: a point where the page's own ray picks THAT piece (a tall piece in front can hide the one behind it: the finger goes a little higher / aside)
    const f = frameOf(p), xy = await f.evaluate(sq => { const W = window.__wc; for (const h of [0.45, 0.65, 0.3, 0.85, 0.15, 1.0]) for (const dx of [0, -8, 8, -16, 16]) { const [x, y] = W.sqScreen(sq, h), r = W.pick(x + dx, y); if (r.piece && r.piece[2] === sq) return [x + dx, y]; } return W.sqScreen(sq, 0.45); }, sq88(u));
    await f.evaluate(([x, y]) => window.__wc.onTap(x, y), xy); await sleep(350);
  };
  const tapCell = async (p, u) => {   // a finger on the cell a piece goes to: a point on that cell the page's ray reads as THAT cell (the raised piece that is going there hides the middle of it when it is seen from behind)
    const f = frameOf(p), xy = await f.evaluate(sq => { const W = window.__wc, [x0, y0] = W.sqScreen(sq, 0); for (const [dx, dy] of [[0, 0], [0, -6], [0, 6], [-8, 0], [8, 0], [0, -12], [0, 12], [-14, -6], [14, -6], [-14, 6], [14, 6], [0, -18], [0, 18]]) { const r = W.pick(x0 + dx, y0 + dy); if (r.sq === sq && (!r.piece || r.piece[2] === sq)) return [x0 + dx, y0 + dy]; } return [x0, y0]; }, sq88(u));
    await f.evaluate(([x, y]) => window.__wc.onTap(x, y), xy); await sleep(350);
  };
  const playTap = async (p, uci) => { await tapPiece(p, uci.slice(0, 2)); await tapCell(p, uci.slice(2, 4)); };
  // the page's own entry for a move a finger made (humanMove: it tells the game outside): used for the long runs, where a finger on a piece behind a taller one is a test of the camera, not of the game
  const playDirect = (p, uci) => frameOf(p).evaluate(u => { const W = window.__wc, m = W.E.parseMove(W.game.s, u); W.humanMove(m); }, uci);
  const randomLegal = p => frameOf(p).evaluate(() => { const E = window.__wc.E, ms = E.legalMoves(window.__wc.game.s).map(m => E.toUCI(m)); const nonPromo = ms.filter(u => u.length === 4); return (nonPromo.length ? nonPromo : ms)[Math.floor(Math.random() * (nonPromo.length || ms.length))]; });
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: (document.getElementById("mText") || {}).textContent || "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  try {
    // ================================================================== A. one phone: the page is found, the engines agree, a finger plays
    const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
    await new Promise(r => srv.listen(0, r)); const sbase = `http://localhost:${srv.address().port}`;
    const p = await mkPage(sbase, "Solo");
    ok(await until(async () => (await p.evaluate(() => WZ.ok)) === true, 20000), "the 3D page is found (wizard-chess/ok.json) and WebGL is there: WZ.ok");
    ok(fs.existsSync(path.join(ROOT, "wizard-chess", "three.min.js")) && /<html lang="en">/.test(fs.readFileSync(path.join(ROOT, "wizard-chess", "index.html"), "utf8").slice(0, 100)) && !/cdn\.jsdelivr/.test(fs.readFileSync(path.join(ROOT, "wizard-chess", "index.html"), "utf8")), "the page ships with its own three.js (no CDN) and its HTML is English (lang=\"en\")");
    // the text of a move <-> the game's path
    const rt = await p.evaluate(() => { let bad = 0, n = 0; for (const fen of ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "r3k2r/1P4P1/8/8/8/8/1p4p1/R3K2R w KQkq - 0 1", "r3k2r/1P4P1/8/8/8/8/1p4p1/R3K2R b KQkq - 0 1"]) { const P = mcFen(fen); for (const m of mcLegal(P)) { n++; const path = mcPath(m), u = mcUciOfPath(path); if (JSON.stringify(mcPathOfUci(u)) !== JSON.stringify(path) || !mcFindIn(P, mcPathOfUci(u))) bad++; } } return { bad, n }; });
    ok(rt.bad === 0 && rt.n > 80, `the text of a move ('e7e8q') and its path round-trip, also for promotions (${rt.n} moves)`, rt);
    // the page opens (it is needed for the next parts)
    await p.evaluate(() => { toMenu("mini"); mcStartLocal(); });
    ok(await hall(p), "two on one phone: the hall opens in the frame (the page said ready)");
    let fu = frameOf(p).url(); ok(/embed=1/.test(fu) && /mode=2p/.test(fu) && /lang=en/.test(fu), "the frame was asked for embed=1, mode=2p in the player's language", fu);
    const hud = await frameOf(p).evaluate(() => ({ lang: document.documentElement.lang, turn: document.getElementById("turn").textContent, chip: document.getElementById("sideChip").textContent, hidden: document.querySelectorAll("#bSide[hidden],#bAI[hidden],#bUndo[hidden]").length, modals: [...document.querySelectorAll(".modal")].map(m => getComputedStyle(m).display) }));
    ok(hud.lang === "en" && /White to Move/i.test(hud.turn) && /Two players/i.test(hud.chip) && hud.hidden === 0 && hud.modals.every(d => d === "none"), "the page is in English, White to move, the windows are hidden (a window used to show at once), the page's own keys are all there", hud);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "01_local.png") });
    // the two engines agree
    const per = await frameOf(p).evaluate(() => { const E = window.__wc.E, games = []; for (let g = 0; g < 6; g++) { const s = E.fromFEN(E.START), lines = [], picked = []; let seed = 17 + g * 101; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; for (let ply = 0; ply < 160; ply++) { const ms = E.legalMoves(s); if (!ms.length) break; lines.push(ms.map(m => E.toUCI(m)).sort()); const pro = ms.filter(m => E.toUCI(m).length > 4), cap = ms.filter(m => s.b[E.decode(m).to] !== 0), pool = pro.length ? pro : cap.length && rnd() < 0.5 ? cap : ms, m = pool[Math.floor(rnd() * pool.length)]; picked.push(E.toUCI(m)); E.make(s, m); } games.push({ lines, picked }); } return games; });
    let diff = null, plies = 0, promos = 0;
    for (const g of per) { const gm = await p.evaluate(g => { const G = mcNew(), bad = []; for (let i = 0; i < g.picked.length; i++) { const mine = mcLegal(G.P).map(m => mcUciOfPath(mcPath(m))).sort(); if (JSON.stringify(mine) !== JSON.stringify(g.lines[i])) { bad.push([i, mine.filter(x => !g.lines[i].includes(x)), g.lines[i].filter(x => !mine.includes(x))]); break; } const mv = mcFind(G, mcPathOfUci(g.picked[i])); if (!mv) { bad.push([i, "not found", g.picked[i]]); break; } mcPlay(G, mv); } return { bad, n: g.picked.length, promos: g.picked.filter(u => u.length > 4).length, over: G.over && G.over.why }; }, g); plies += gm.n; promos += gm.promos; if (gm.bad.length && !diff) diff = gm.bad[0]; }
    ok(diff === null && plies > 300, `two engines, one game: the 3D page's engine and the game's rules core have the same legal moves in every one of ${plies} positions (6 random games, ${promos} promotions)`, diff);
    // a finger in the hall
    await tapPiece(p, "e2"); await tapCell(p, "e4"); ok(await until(async () => ((await fstate(p)) || { uci: [] }).uci.join() === "e2e4", 15000), "a tap on the pawn and a tap on the cell: the move is played in the hall");
    ok(await until(async () => { const s = await fstate(p); return s && !s.busy; }, 15000), "its animation ends");
    await tapPiece(p, "e7"); await tapCell(p, "e5"); ok(await until(async () => ((await fstate(p)) || { uci: [] }).uci.join() === "e2e4,e7e5", 15000), "two on one phone: Black answers on the same screen");
    await p.evaluate(() => document.querySelector('#wzScr [data-a="exit"]').click()); await sleep(500);
    ok(await p.evaluate(() => !document.getElementById("wzScr").classList.contains("on") && document.getElementById("wzFrame").src === "about:blank"), "the close key hides the hall and lets its memory go");
    // against the computer
    await p.evaluate(() => mcStartBot("easy")); ok(await hall(p), "against the computer: the hall opens");
    fu = frameOf(p).url(); const hum = /human=(-?1)/.exec(fu)[1]; ok(/mode=ai/.test(fu) && /level=0/.test(fu), "the frame was asked for the computer, the easy level (level=0)", fu);
    if (hum === "1") { await tapPiece(p, "d2"); await tapCell(p, "d4"); } else { ok(await until(async () => ((await fstate(p)) || { uci: [] }).uci.length === 1, 30000), "the computer, White, opens"); await until(async () => { const s = await fstate(p); return s && !s.busy; }, 15000); const u = await randomLegal(p); await playTap(p, u); }
    ok(await until(async () => { const s = await fstate(p); return s && s.uci.length >= 2 && !s.aiPending && !s.busy; }, 40000), `I am ${hum === "1" ? "White" : "Black"}: my move is played and the computer answers`, await fstate(p));
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "02_bot.png") });
    await p.evaluate(() => document.querySelector('#wzScr [data-a="exit"]').click()); await sleep(400);
    // a muted game opens the hall silent; and when the frame cannot draw the hall it says so and the flat board takes over
    await p.evaluate(() => { profile.muted = true; mcStartBot("easy"); }); ok(await hall(p), "a muted game: the hall opens");
    ok(/sound=0/.test(frameOf(p).url()) && /off|o'chiq|выкл/i.test(await frameOf(p).evaluate(() => document.getElementById("bSound").textContent)), "...silent: the frame was asked for sound=0 and its sound key says off", frameOf(p).url());
    await p.evaluate(() => { profile.muted = false; });
    await frameOf(p).evaluate(() => parent.postMessage({ wc: 1, t: "fail", why: "test" }, "*")); await sleep(700);
    ok(await p.evaluate(() => document.getElementById("mcScr").classList.contains("on") && !document.getElementById("wzScr").classList.contains("on") && WZ.ok === false && MCU.use3d === false && document.getElementById("wzFrame").src === "about:blank" && document.querySelectorAll("#mcPcs .mp").length === 32), "the frame says it cannot draw the hall (WebGL refused / context lost): the flat board takes over, and the next games open it at once");
    await p.evaluate(() => mcClose()); await sleep(300);
    // the owner's phone (his screenshots): a PORTRAIT window in which the page is turned 90 degrees (html.rot) - he holds the phone sideways. The hall is drawn in the turned page and a real finger (a touch THROUGH the turn) plays.
    const T = await mkPage(sbase, "Turned", { vp: { width: 412, height: 915 } });
    ok(await T.evaluate(() => rotated === true && document.documentElement.classList.contains("rot")), "a 412 x 915 window: the page is turned 90 degrees (the owner's phone)");
    await T.evaluate(() => { toMenu("mini"); mcOpen({ mode: "bot", lv: "easy", my: 1, pl: [{ name: "Me", avatar: 5, frame: 0 }, { name: "Bot", avatar: 3, frame: 12 }] }); });
    ok(await hall(T), "the turned page: the hall opens in the frame");
    const tg = await T.evaluate(() => { const e = document.getElementById("wzFrame"), r = e.getBoundingClientRect(); return { w: r.width, h: r.height, iw: e.contentWindow.innerWidth, ih: e.contentWindow.innerHeight }; });
    ok(tg.w === 412 && tg.h === 915 && tg.iw === 915 && tg.ih === 412, "the frame fills the turned page: 915 x 412 inside the 412 x 915 window", tg);
    const touchAt = async (xy) => { const [sx, sy] = [tg.w - xy[1], xy[0]]; await T.touchscreen.tap(sx, sy); await sleep(500); };   // the frame's point (x, y) is at the screen's (width - y, x)
    const evs = await frameOf(T).evaluate(() => { window.__ev = []; for (const t of ["pointerdown", "touchend", "click"]) addEventListener(t, e => { const q = (e.changedTouches && e.changedTouches[0]) || e; window.__ev.push([t, Math.round(q.clientX), Math.round(q.clientY)]); }, true); return 1; });
    const pickPiece = await frameOf(T).evaluate(sq => { const W = window.__wc; for (const h of [0.45, 0.65, 0.3, 0.85, 0.15, 1.0]) for (const dx of [0, -8, 8, -16, 16]) { const [x, y] = W.sqScreen(sq, h), r = W.pick(x + dx, y); if (r.piece && r.piece[2] === sq) return [x + dx, y]; } return W.sqScreen(sq, 0.45); }, sq88("e2"));
    await touchAt(pickPiece);
    const seen = await frameOf(T).evaluate(() => window.__ev);
    ok(seen.some(e => e[0] === "pointerdown" && Math.abs(e[1] - Math.round(pickPiece[0])) <= 1 && Math.abs(e[2] - Math.round(pickPiece[1])) <= 1), "a touch on the screen reaches the frame at the point the page asked for (the turn is undone by the browser)", { seen, pickPiece });
    const pickCell = await frameOf(T).evaluate(sq => { const W = window.__wc, [x0, y0] = W.sqScreen(sq, 0); for (const [dx, dy] of [[0, 0], [0, -6], [0, 6], [-8, 0], [8, 0], [0, -12], [0, 12]]) { const r = W.pick(x0 + dx, y0 + dy); if (r.sq === sq) return [x0 + dx, y0 + dy]; } return [x0, y0]; }, sq88("e4"));
    await touchAt(pickCell);
    ok(await until(async () => { const s = await fstate(T); return s && s.uci[0] === "e2e4"; }, 15000), "a finger's tap on the pawn and on the cell, through the turned page: e2e4 is played");
    ok(await until(async () => { const s = await fstate(T); return s && s.uci.length >= 2 && !s.aiPending && !s.busy; }, 40000), "...and the computer answers");
    if (SHOT) { await T.screenshot({ path: path.join(SHOT, "03_turned.png") }); }
    await T.evaluate(() => document.querySelector('#wzScr [data-a="exit"]').click()); await sleep(400);
    ok(await T.evaluate(() => !document.getElementById("wzScr").classList.contains("on")), "the turned page: the close key hides the hall");
    await T._ctx.close();
    // where the page is not there, the flat board
    const q = await mkPage(sbase, "Flat", { off: true }); await q.evaluate(() => { toMenu("mini"); mcStartLocal(); }); await sleep(900);
    ok(await q.evaluate(() => document.getElementById("mcScr").classList.contains("on") && !(document.getElementById("wzScr") || { classList: { contains: () => false } }).classList.contains("on")), "with the 3D page switched off (a portal's zip, no WebGL) the flat Magic Chess board opens instead");
    await q._ctx.close();
    const srv2 = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);   // a copy of the game WITHOUT the 3D page (the Android app, a portal's zip)
      if (/wizard-chess/.test(u) || !f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
    await new Promise(r2 => srv2.listen(0, r2)); const r = await mkPage(`http://localhost:${srv2.address().port}`, "Missing"); await sleep(4500);
    ok((await r.evaluate(() => WZ.ok)) === false, "in a copy of the game without the 3D page (the Android app, a portal's zip) the page is taken as missing (WZ.ok = false)");
    await r.evaluate(() => { toMenu("mini"); mcStartLocal(); }); await sleep(900); ok(await r.evaluate(() => document.getElementById("mcScr").classList.contains("on")), "...and the flat board opens");
    await r._ctx.close(); await p._ctx.close(); srv.close(); srv2.close();
    if (process.env.PART === "A") { console.log(`pass ${pass}, fail ${fail} (part A only: PART=A)`); await b.close(); process.exit(fail ? 1 : 0); }   // (PART=A skips the two-phone part B: about 5 minutes)

    // ================================================================== B. online, two phones (the real server)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wz-")), P = +process.env.TEST_PORT || 8800, base = `http://localhost:${P}`;
    const server = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, BROOM_GRACE_MS: "150000" }, stdio: "ignore" });   // (a page that is reloaded needs more than the usual 30 s to draw its hall again in this slow browser)
    await until(() => fetch(base + "/api/health").then(r => r.ok).catch(() => false), 60000, 300);   // (the server is waited for until it answers: a fixed pause was too short when the machine was busy)
    const A = await mkPage(base, "Alice"), B = await mkPage(base, "Bob");
    for (const x of [A, B]) await x.evaluate(() => Net.ensure().then(() => Net.connect()));
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => WZ.ok)))).every(v => v === true), 30000), "both phones find the 3D page on the real server (it serves /wizard-chess/)");
    await A.evaluate(() => { toMenu("mini"); mcPick(); }); await sleep(700); await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(600);
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "a room is made");
    const code = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await B.evaluate(() => { toMenu("mini"); mcPick(); }); await sleep(600); await B.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(500);
    await B.evaluate(c => { document.querySelector("#brRoom .tn-code").value = c; document.querySelector('#brRoom [data-a="join"]').click(); }, code);
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => document.querySelectorAll("#brRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 10000), "the friend joins");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => document.getElementById("wzScr") && document.getElementById("wzScr").classList.contains("on"))))).every(Boolean), 30000), "Start: both phones open the 3D hall");
    ok((await Promise.all([hall(A), hall(B)])).every(Boolean), "both halls are drawn and say ready");
    const urls = [frameOf(A).url(), frameOf(B).url()], hs = urls.map(u => +/human=(-?1)/.exec(u)[1]);
    ok(urls.every(u => /embed=1/.test(u) && /mode=net/.test(u)) && hs[0] === -hs[1], "the frames were asked for mode=net, one White (human=1), the other Black (human=-1)", urls);
    const hudB = await frameOf(B).evaluate(() => ({ hidden: ["bSide", "bAI", "bUndo", "bNew", "bLevel", "bMode"].map(i => document.getElementById(i).hidden), chip: document.getElementById("sideChip").textContent })); ok(hudB.hidden.every(Boolean), "online the page hides the computer / take back / new game keys", hudB);
    ok(await A.evaluate(() => ["mic", "spk", "draw", "resign", "exit"].every(a => { const e = document.querySelector(`#wzScr [data-a="${a}"]`); return e && getComputedStyle(e).display !== "none"; })), "the game's keys over the hall: voice, speaker, draw, resign, exit");
    if (SHOT) { await A.screenshot({ path: path.join(SHOT, "03_online_A.png") }); await B.screenshot({ path: path.join(SHOT, "03_online_B.png") }); }
    const white = hs[0] === 1 ? A : B, black = white === A ? B : A;
    const same = async () => { const [sa, sb, ga, gb] = await Promise.all([fstate(A), fstate(B), A.evaluate(() => MCU.G.moves.map(mcUciOfPath).join()), B.evaluate(() => MCU.G.moves.map(mcUciOfPath).join())]); return sa && sb && sa.uci.join() === sb.uci.join() && sa.uci.join() === ga && ga === gb && !sa.busy && !sb.busy ? sa.uci.length : -1; };
    // the black phone taps out of turn
    const ob = await randomLegal(black).catch(() => null); await tapPiece(black, "e7"); await tapCell(black, "e5"); await sleep(600); ok(((await fstate(black)) || { uci: [] }).uci.length === 0, "a tap out of turn (Black before White) does nothing");
    let n = 0, bad = null;
    for (let i = 0; i < 6; i++) {
      const wt = await white.evaluate(() => mcTurnMine()), mover = wt ? white : black, u = await randomLegal(mover);
      if (i < 2) { for (let k = 0; k < 3; k++) { const before = ((await fstate(mover)) || { uci: [] }).uci.length; await playTap(mover, u); if (await until(async () => ((await fstate(mover)) || { uci: [] }).uci.length > before, 5000, 300)) break; } }   // (a finger: a tap that the slow software-drawn hall let slip is made again)
      else await playDirect(mover, u);
      if (!await until(async () => (await same()) === i + 1, 45000, 500)) { bad = ["after move " + (i + 1), u, await fstate(A), await fstate(B), await A.evaluate(() => MCU.G.moves.map(mcUciOfPath).join()), await B.evaluate(() => MCU.G.moves.map(mcUciOfPath).join())]; break; }
      n++;
    }
    ok(bad === null && n === 6, `${n} moves: a move made in one hall is played in the other, and the game's rules core on both phones has the same move list`, bad);
    if (SHOT) { await A.screenshot({ path: path.join(SHOT, "04_after_moves_A.png") }); await B.screenshot({ path: path.join(SHOT, "04_after_moves_B.png") }); }
    // the voice keys work over the hall
    await A.evaluate(() => shVoiceBtn("mic"));
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => RV.state().peers.some(p => p.live))))).every(Boolean), 25000), "voice over the hall: Alice taps the mic, Bob listens at once, the call is connected");
    ok(await until(async () => (await B.evaluate(() => RV.stats())).rx > 800, 15000), "Bob hears Alice (audio bytes arrive)");
    // a draw offer
    const mover2 = (await white.evaluate(() => mcTurnMine())) ? white : black;
    await A.evaluate(() => document.querySelector('#wzScr [data-a="draw"]').click());
    ok(await until(async () => { const m = await modal(B); return m && /draw/i.test(m.t); }, 8000), "a draw offer reaches the friend as a question (over the hall)");
    await clickBtn(B, "Yes");
    await until(async () => (await Promise.all([A, B].map(modal))).every(m => m && /^Draw$/i.test(m.t.trim())), 20000, 400);
    const res = await Promise.all([A, B].map(modal)); ok(res.every(m => m && /^Draw$/i.test(m.t.trim())), "he says yes: the result window on both phones", res);
    ok((await Promise.all([A, B].map(x => fstate(x)))).every(s => s && s.gameOver), "and both halls are locked (the game ended outside the rules)");
    // a rematch: the colours swap, the hall opens at the board
    await clickBtn(A, "Play again"); await sleep(500); await clickBtn(B, "Play again");
    ok(await until(async () => { const [x, y] = await Promise.all([A, B].map(z => z.evaluate(() => document.getElementById("wzFrame").src))); return /quick=1/.test(x) && /quick=1/.test(y); }, 15000), "a rematch: the halls open again straight at the board (quick=1)");
    ok((await Promise.all([hall(A), hall(B)])).every(Boolean), "the new halls are ready");
    const hs2 = [frameOf(A).url(), frameOf(B).url()].map(u => +/human=(-?1)/.exec(u)[1]); ok(hs2[0] === -hs[0] && hs2[1] === -hs[1], "the colours are swapped", [hs, hs2]);
    const white2 = hs2[0] === 1 ? A : B, black2 = white2 === A ? B : A;
    for (let i = 0; i < 2; i++) { const wt = await white2.evaluate(() => mcTurnMine()), mover = wt ? white2 : black2, u = await randomLegal(mover); await playDirect(mover, u); ok(await until(async () => (await same()) === i + 1, 45000, 500), `the new match: move ${i + 1} is in both halls`); }
    // the page of one phone is reloaded in the middle
    const was = await A.evaluate(() => MCU.G.moves.map(mcUciOfPath).join());
    await B.reload({ waitUntil: "commit" });
    await B.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(1500);
    await B.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => window.__toasts.push(String(t)); Net.ensure().then(() => Net.connect()); });
    ok(await until(async () => (await B.evaluate(() => WZ.ok)) === true, 20000), "after the reload the page is found again");
    await B.evaluate(() => { toMenu("mini"); mcPick(); }); await sleep(600); await B.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click());
    ok(await until(async () => await B.evaluate(() => document.getElementById("wzScr") && document.getElementById("wzScr").classList.contains("on")), 15000), "Online -> the room window brings the reloaded phone back to the match (the 3D hall opens)");
    ok(await hall(B), "its hall is ready");
    ok(await until(async () => { const s = await fstate(B); return s && s.uci.join() === was && !s.busy; }, 40000, 500), "the hall is set to the match's move list again (it comes from the server's list)", [was, await fstate(B)]);
    ok((await same()) === was.split(",").length, "both phones have the same game again");
    // a resignation
    await B.evaluate(() => document.querySelector('#wzScr [data-a="resign"]').click()); await sleep(400); await clickBtn(B, "Yes");
    await until(async () => { const m = await modal(A); return m && /VICTORY/i.test(m.t); }, 20000, 400);
    const mm = await Promise.all([B, A].map(modal)); ok(mm[0] && mm[1] && /VICTORY/i.test(mm[1].t) && /Resigned/i.test(mm[1].txt), "a resignation: the friend gets the victory window with the reason", mm);
    await clickBtn(A, "Play again"); await clickBtn(B, "Play again");
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => WZ.ready)))).every(Boolean) && (await Promise.all([A, B].map(x => x.evaluate(() => MCU.on && !MCU.G.over)))).every(Boolean), 90000, 500), "another match is on");
    await A.evaluate(() => document.querySelector('#wzScr [data-a="exit"]').click()); await sleep(400); await clickBtn(A, "Leave|Exit");
    ok(await until(async () => { const m = await modal(B); return m && /VICTORY/i.test(m.t) && /left/i.test(m.txt); }, 10000), "a player who leaves in the middle loses: the friend gets the victory window", await modal(B));
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
    server.kill("SIGTERM");
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  try { await b.close(); } catch (e) {} process.exit(fail ? 1 : 0);
})();
