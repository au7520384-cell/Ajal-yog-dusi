#!/usr/bin/env node
// Shashka on its screen, one phone, no server:  node tools/test_shashka_ui.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 2 minutes)
// The owner (Nov 23): shashka in the mini-games. The rules and the bot are tested on their own (tools/test_shashka.js); here the SCREEN:
//  - the mini-games screen has the "Board games" row with the Checkers card; the card opens the list (3 bot levels, two on one phone, online)
//  - the board: 12 + 12 pieces on the dark cells, my colour at the bottom, the board turns round when I am Black; it fits every phone (landscape, small, upright / turned, a computer)
//  - a finger plays: tap a piece, tap where it goes; a compulsory capture is announced and a piece that cannot capture is refused; a route that parts shows the next cells, a forced route is played whole
//  - the bot answers on every level; undo takes back my move and its answer; the result window for a win / a loss / a draw / a resignation; "Play again" against the bot swaps the colours
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "", sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const open = async (vp, touch = true) => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 300)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; });
    await sleep(1800); return { p, close: () => ctx.close() };
  };
  const S = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]);
  const tap = async (p, cells) => { for (const c of [].concat(cells)) { await p.evaluate(i => document.querySelector(`#shBoard .sq[data-i="${i}"]`).click(), typeof c === "string" ? S(c) : c); await sleep(120); } };
  const setBoard = (p, w, W, bl, B, side = 1) => p.evaluate(([w, W, bl, B, side]) => { const S = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]), x = new Int8Array(64); for (const a of w) x[S(a)] = 1; for (const a of W) x[S(a)] = 2; for (const a of bl) x[S(a)] = -1; for (const a of B) x[S(a)] = -2; const G = SHU.G; G.b = x; G.side = side; G.over = null; G.moves = []; G.seen = {}; G.last = null; SHU.sel = []; SHU.fin = 0; shRender(); }, [w, W, bl, B, side]);
  const st = p => p.evaluate(() => ({ ply: SHU.G.moves.length, side: SHU.G.side, over: SHU.G.over, my: SHU.my, flip: SHU.flip, busy: SHU.busy, msg: document.getElementById("shMsg").textContent, sel: SHU.sel.slice(), opts: [...document.querySelectorAll("#shBoard .sq.opt")].map(e => +e.dataset.i), last: SHU.G.moves[SHU.G.moves.length - 1] || null, toasts: window.__toasts.slice(-3), must: document.querySelectorAll("#shPcs .pc.must").length }));
  const until = async (fn, to = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(150); } return false; };
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: document.getElementById("mText") ? document.getElementById("mText").textContent : "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  try {
    const { p, close } = await open({ width: 915, height: 412 });

    // ------------------------------------------------------------------ the way in
    await p.evaluate(() => toMenu("mini")); await sleep(1400);
    const row = await p.evaluate(() => { const r = document.getElementById("miniBoards"), m = document.getElementById("miniStrip"); return r ? { title: (r.querySelector(".sh-rt") || {}).textContent, cards: [...r.querySelectorAll(".sh-pan")].map(c => c.dataset.g), img: r.querySelector(".sh-ban img").naturalWidth >= 1000, below: !!m && r.getBoundingClientRect().top >= m.getBoundingClientRect().bottom - 2 } : null; });
    ok(row && row.title === "Board games" && row.cards.join() === "shashka,magic,mafia" && row.img && row.below, "the mini-games screen has the Board games row (the owner's picture: Checkers, Chess, Mafia), under the new-modes picture", row);
    // the picture is shown IN FULL (the owner, Nov 24: "let it go through in full"): all of it fits the screen when the row is scrolled to, its proportions are the picture's (1672 x 941), the three keys lie inside it side by side and a click in the middle of each opens its own list
    await p.evaluate(() => document.getElementById("mini").scrollTo(0, 99999)); await sleep(400);
    const fit = await p.evaluate(() => { const b = document.querySelector("#miniBoards .sh-ban").getBoundingClientRect(), ps = [...document.querySelectorAll("#miniBoards .sh-pan")].map(x => x.getBoundingClientRect()); return { fits: b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1, ratio: +(b.width / b.height).toFixed(3), inside: ps.every(q => q.left >= b.left - 1 && q.right <= b.right + 1 && q.top >= b.top - 1 && q.bottom <= b.bottom + 1), apart: ps[0].right <= ps[1].left && ps[1].right <= ps[2].left, b: [b.top, b.bottom, innerHeight].map(Math.round) }; });
    ok(fit.fits && Math.abs(fit.ratio - 1672 / 941) < 0.01 && fit.inside && fit.apart, "the Board games picture is shown in full (it fits the screen, its own proportions), the three keys lie inside it, side by side", fit);
    await p.evaluate(() => document.querySelector('#miniBoards .sh-pan[data-g="shashka"]').click()); await sleep(600);
    const list = await p.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => ({ id: r.dataset.id, txt: r.textContent.replace(/\s+/g, " ").trim() })));
    ok(list.map(x => x.id).join() === "easy,mid,hard,local,online" && /Easy/.test(list[0].txt) && /Medium/.test(list[1].txt) && /Hard/.test(list[2].txt) && /one phone/.test(list[3].txt) && /friend/i.test(list[4].txt), "the card opens the list: three bot levels, two on one phone, online with a friend", list);
    await p.evaluate(() => document.getElementById("modal").classList.remove("on"));

    // ------------------------------------------------------------------ two on one phone: the board, a finger
    await p.evaluate(() => shStartLocal()); await sleep(900);
    let g = await p.evaluate(() => ({ w: SHU.G.b.filter(x => x > 0).length, b: SHU.G.b.filter(x => x < 0).length, dom: document.querySelectorAll("#shPcs .pc").length, flip: SHU.flip, cards: [...document.querySelectorAll("#shScr .sh-pl b")].map(x => x.textContent) }));
    ok(g.w === 12 && g.b === 12 && g.dom === 24 && !g.flip && g.cards.length === 2, "12 + 12 pieces on the board, White at the bottom", g);
    const geo = await p.evaluate(() => { const r = e => { const b = document.querySelector(e).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }; return { vp: [innerWidth, innerHeight], bd: r("#shBoard"), info: r("#shScr .sh-info"), btns: r("#shScr .sh-btns") }; });
    ok(Math.abs(geo.bd.w - geo.bd.h) < 1 && geo.bd.t >= 0 && geo.bd.b <= geo.vp[1] && geo.bd.l >= geo.info.r - 1 && geo.bd.r <= geo.btns.l + 1 && geo.btns.r <= geo.vp[0] && geo.info.l >= 0, "915 x 412: the board is a square inside the screen, the players on its left and the keys on its right do not touch it", geo);
    await p.screenshot({ path: SHOT ? path.join(SHOT, "01_local_start.png") : undefined });
    await tap(p, "c3"); let s = await st(p); ok(s.sel.join() === String(S("c3")) && s.opts.length === 2, "a tap on a piece selects it and shows where it can go", s);
    await tap(p, "b4"); await sleep(700); s = await st(p); ok(s.ply === 1 && s.side === -1 && !s.busy && /Black to move/.test(s.msg), "a tap on a landing cell plays the move; Black is to move", s);
    await tap(p, "a3"); s = await st(p); ok(s.sel.length === 0, "a piece of the side that does not move cannot be selected");
    await p.evaluate(() => shUndo()); await sleep(300); s = await st(p); ok(s.ply === 0 && s.side === 1, "undo takes the move back (two on one phone: one move)", s);

    // ------------------------------------------------------------------ compulsory capture, routes
    await setBoard(p, ["c3", "h2"], [], ["d4"], []);
    s = await st(p); ok(s.must === 1 && /compulsory/i.test(s.msg), "a compulsory capture is announced and the piece that has to take it is marked", s);
    await tap(p, "h2"); s = await st(p); ok(s.sel.length === 0 && s.toasts.some(t => /compulsory/i.test(t)), "a piece that cannot capture is refused with a message", s);
    await tap(p, ["c3", "e5"]); await sleep(900); s = await st(p); ok(s.ply === 1 && s.last.join() === [S("c3"), S("e5")].join(), "the jump is played", s);
    await setBoard(p, ["c3"], [], ["d4", "d6", "f6"], []);   // c3 x d4 -> e5, then c7 or g7
    await tap(p, ["c3", "e5"]); s = await st(p); ok(s.ply === 0 && s.sel.length === 2 && s.opts.sort().join() === [S("c7"), S("g7")].sort().join(), "a route that parts: the next landing cells are shown", s);
    await tap(p, "g7"); await sleep(1200); s = await st(p); ok(s.ply === 1 && s.last.join() === [S("c3"), S("e5"), S("g7")].join(), "the chosen route is played to its end", s);
    await setBoard(p, ["a1"], [], ["b2", "d4", "f6"], []);   // one route only: a1 x b2 x d4 x f6 -> g7
    await tap(p, ["a1", "c3"]); await sleep(1500); s = await st(p); ok(s.ply === 1 && s.last.length === 4, "a forced route is played whole after the first landing cell (no more taps)", s);

    // ------------------------------------------------------------------ the end, in a few ways
    await setBoard(p, ["c3"], [], ["d4"], []);
    await tap(p, ["c3", "e5"]); await sleep(1600); let m = await modal(p);
    ok(m && /White wins/i.test(m.t) && /no moves/i.test(m.txt) && m.btns.length === 2, "taking the last piece ends the game: 'White wins!' and why", m);
    await clickBtn(p, "Play again"); await sleep(900);
    ok((await st(p)).ply === 0, "Play again starts a new game");
    await p.evaluate(() => document.querySelector('#shScr [data-a="resign"]').click()); await sleep(400); m = await modal(p);
    ok(m && /resign/i.test(m.t) && m.btns.some(x => /Yes/.test(x)), "the flag key asks 'Do you resign?'", m);
    await clickBtn(p, "Yes"); await sleep(1700); m = await modal(p); ok(m && /Black wins/i.test(m.t) && /Resigned/i.test(m.txt), "after the resignation the other colour wins", m);
    await clickBtn(p, "Play again"); await sleep(700);
    await p.evaluate(() => document.querySelector('#shScr [data-a="draw"]').click()); await sleep(400); m = await modal(p);
    ok(m && /draw/i.test(m.t) && m.btns.length === 2, "the handshake key offers a draw to the other player on the phone", m);
    await clickBtn(p, "Yes"); await sleep(1700); m = await modal(p); ok(m && /^Draw$/i.test(m.t.trim()) && /agreement/i.test(m.txt), "accepted: a draw by agreement", m);
    await clickBtn(p, "Menu"); await sleep(500);
    ok(await p.evaluate(() => !document.getElementById("shScr").classList.contains("on") && document.getElementById("mini").classList.contains("on")), "Menu closes the board and the mini-games screen is there");

    // ------------------------------------------------------------------ the bot, three levels; the colours swap on a rematch
    for (const lv of ["easy", "mid", "hard"]) {
      await p.evaluate(l => shStartBot(l), lv); await sleep(900);
      const my = (await st(p)).my;
      // my first move (if the bot moves first, wait for it)
      ok(await until(async () => (await st(p)).side === my && !(await st(p)).busy, 12000), `${lv}: it is my turn after the bot's move (I am ${my > 0 ? "White" : "Black"})`);
      const f0 = await st(p); ok(f0.flip === (my < 0), `${lv}: the board turns round when I am Black`, f0);
      const mv = await p.evaluate(() => shGen(SHU.G.b, SHU.G.side)[0].path); await tap(p, mv);
      const n0 = f0.ply + 1; ok(await until(async () => (await st(p)).ply >= n0 + 1, 15000), `${lv}: the bot answers`, await st(p));
    }
    await p.screenshot({ path: SHOT ? path.join(SHOT, "02_bot_hard.png") : undefined });
    await p.evaluate(() => shUndo()); await sleep(500); s = await st(p); ok(s.ply % 2 === (s.my > 0 ? 0 : 1) && s.side === s.my, "undo against the bot takes back my move and its answer: it is my turn again", s);
    // win against the bot by a constructed end, then the rematch swaps the colours
    const my0 = (await st(p)).my;
    await p.evaluate(m => { const W = m > 0; const S = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]); const x = new Int8Array(64); if (W) { x[S("c3")] = 1; x[S("d4")] = -1; } else { x[S("d6")] = -1; x[S("c5")] = 1; } const G = SHU.G; G.b = x; G.side = m; G.moves = []; G.over = null; G.seen = {}; SHU.sel = []; SHU.busy = 0; SHU.tok++; SHU.fin = 0; shRender(); }, my0);
    const mv2 = await p.evaluate(() => shGen(SHU.G.b, SHU.G.side)[0].path); await tap(p, mv2); await sleep(1700); m = await modal(p);
    ok(m && /VICTORY|WIN/i.test(m.t) && !/wins/i.test(m.t.replace(/victory/i, "")) || (m && /VICTORY/i.test(m.t)), "a win against the bot: the victory window", m);
    await clickBtn(p, "Play again"); await sleep(1500);
    ok((await st(p)).my === -my0, "Play again against the bot: the colours are swapped", [my0, (await st(p)).my]);
    await p.evaluate(() => shClose());

    // ------------------------------------------------------------------ it fits every screen
    for (const [name, vp, touch] of [["small landscape", { width: 740, height: 360 }, true], ["upright phone (page turned)", { width: 328, height: 611 }, true], ["computer", { width: 1280, height: 720 }, false], ["tablet", { width: 1024, height: 768 }, true]]) {
      const q = await open(vp, touch);
      await q.p.evaluate(() => { toMenu("mini"); shStartLocal(); }); await sleep(900);
      const r = await q.p.evaluate(() => { const rect = e => { const b = document.querySelector(e).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }; const rot = document.documentElement.classList.contains("rot") || getComputedStyle(document.documentElement).getPropertyValue("--rot") === "1"; return { vp: [innerWidth, innerHeight], rot, bd: rect("#shBoard"), info: rect("#shScr .sh-info"), btns: rect("#shScr .sh-btns"), pcs: [...document.querySelectorAll("#shPcs .pc")].every(e => { const b = e.getBoundingClientRect(), bd = document.querySelector("#shBoard").getBoundingClientRect(); return b.left >= bd.left - 1 && b.right <= bd.right + 1 && b.top >= bd.top - 1 && b.bottom <= bd.bottom + 1 && b.width > 12; }) }; });
      const inside = (a, w, h) => a.l >= -1 && a.t >= -1 && a.r <= w + 1 && a.b <= h + 1;
      ok(Math.abs(r.bd.w - r.bd.h) < 1.5 && r.bd.w >= 180 && r.pcs && [r.bd, r.btns, r.info].every(a => inside(a, r.vp[0], r.vp[1])) && !(r.bd.l < r.info.r - 1 && r.bd.r > r.info.l + 1 && r.bd.t < r.info.b && r.bd.b > r.info.t), `${name} (${vp.width}x${vp.height}): a big square board, the pieces inside it, nothing leaves the screen or overlaps`, r);
      if (SHOT) await q.p.screenshot({ path: path.join(SHOT, `03_${vp.width}x${vp.height}.png`) });
      await q.close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 5));
    await close();
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
