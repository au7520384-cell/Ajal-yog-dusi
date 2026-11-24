#!/usr/bin/env node
// Magic Chess on its screen, one phone, no server:  node tools/test_magic_ui.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 2 minutes)
// The owner (Nov 23): only ONE chess in the game, the magic one. The rules and the bot are tested on their own (tools/test_magic.js: perft); here the SCREEN:
//  - the mini-games row has the Magic Chess card next to Checkers; it opens the list (3 bot levels, two on one phone, online)
//  - 32 magic pieces (SVG, drawn in code), the board turns round for Black, the labels a-h / 1-8, it fits every screen
//  - a finger plays: tap a piece (the cells it can go to light up, the cells with an enemy ring red), tap the cell; check glows red and the message says it; a capture is a spell (sparks, the piece bursts, the board shakes);
//    castling moves the rook too; a pawn on the last row asks what it becomes (4 pieces) and the choice is made; mate = lightning + the result window; stalemate, draw, resignation
//  - the bot answers on every level; undo; "Play again" against the bot swaps the colours
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
    await p.addInitScript(() => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; });
    await sleep(1800); return { p, close: () => ctx.close() };
  };
  const S = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]);
  const tap = async (p, cells) => { for (const c of [].concat(cells)) { await p.evaluate(i => document.querySelector(`#mcBoard .sq[data-i="${i}"]`).click(), typeof c === "string" ? S(c) : c); await sleep(130); } };
  const setFen = (p, fen) => p.evaluate(f => { const G = MCU.G; G.P = mcFen(f); G.side = G.P.side; G.moves = []; G.seen = {}; G.over = null; G.last = null; G.check = mcInCheck(G.P); G.taken = { w: [], b: [] }; MCU.sel = null; MCU.fin = 0; MCU.busy = 0; mcRender(); }, fen);
  const st = p => p.evaluate(() => ({ ply: MCU.G.moves.length, side: MCU.G.side, over: MCU.G.over, my: MCU.my, flip: MCU.flip, busy: MCU.busy, msg: document.getElementById("mcMsg").textContent, sel: MCU.sel, opts: [...document.querySelectorAll("#mcBoard .sq.opt")].map(e => +e.dataset.i), hits: [...document.querySelectorAll("#mcBoard .sq.hit")].map(e => +e.dataset.i), chk: [...document.querySelectorAll("#mcBoard .sq.chk")].map(e => +e.dataset.i), pcs: document.querySelectorAll("#mcPcs .mp").length, last: MCU.G.moves[MCU.G.moves.length - 1] || null, toasts: window.__toasts.slice(-3) }));
  const until = async (fn, to = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(150); } return false; };
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: document.getElementById("mText") ? document.getElementById("mText").textContent : "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent), picks: document.querySelectorAll("#mExtra .mc-pk").length } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  try {
    const { p, close } = await open({ width: 915, height: 412 });

    // ------------------------------------------------------------------ the way in
    await p.evaluate(() => toMenu("mini")); await sleep(1400);
    const row = await p.evaluate(() => { const r = document.getElementById("miniBoards"); return r ? { cards: [...r.querySelectorAll(".sh-card")].map(c => c.querySelector("b").textContent), imgs: [...r.querySelectorAll(".sh-card img")].every(i => i.src.startsWith("data:")) } : null; });
    ok(row && row.cards.join() === "Checkers,Magic Chess,Mafia" && row.imgs, "the Board games row has Checkers, Magic Chess (no plain chess) and Mafia", row);
    await p.evaluate(() => document.getElementById("mini").scrollTo(0, 99999)); await sleep(500); if (SHOT) await p.screenshot({ path: path.join(SHOT, "00_row.png") });
    await p.evaluate(() => document.querySelector('#miniBoards [data-g="magic"]').click()); await sleep(600);
    const list = await p.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => r.dataset.id));
    ok(list.join() === "easy,mid,hard,local,online", "the card opens the list: three bot levels, two on one phone, online with a friend", list);
    await p.evaluate(() => document.getElementById("modal").classList.remove("on"));

    // ------------------------------------------------------------------ the board and a finger
    await p.evaluate(() => mcStartLocal()); await sleep(900);
    let g = await p.evaluate(() => ({ n: document.querySelectorAll("#mcPcs .mp").length, w: document.querySelectorAll("#mcPcs .mp.w").length, svgs: [...document.querySelectorAll("#mcPcs .mp svg")].every(s => s.querySelectorAll("path,circle").length >= 4), types: [...new Set([...document.querySelectorAll("#mcPcs .mp")].map(e => e.className.match(/t\d/)[0]))].sort().join(), labels: [...document.querySelectorAll("#mcBoard .sq")].map(e => e.dataset.l).filter(Boolean).join("") }));
    ok(g.n === 32 && g.w === 16 && g.svgs && g.types === "t1,t2,t3,t4,t5,t6" && g.labels.replace(/\d/g, "") === "abcdefgh" && g.labels.replace(/[a-h]/g, "") === "87654321", "32 magic pieces (all six kinds, drawn as SVG) and the labels a-h / 8-1", g);
    const geo = await p.evaluate(() => { const r = e => { const b = document.querySelector(e).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }; return { vp: [innerWidth, innerHeight], bd: r("#mcBoard"), info: r("#mcScr .sh-info"), btns: r("#mcScr .sh-btns") }; });
    ok(Math.abs(geo.bd.w - geo.bd.h) < 1 && geo.bd.t >= 0 && geo.bd.b <= geo.vp[1] && geo.bd.l >= geo.info.r - 1 && geo.bd.r <= geo.btns.l + 1 && geo.btns.r <= geo.vp[0], "915 x 412: the board is a square inside the screen, the players and the keys do not touch it", geo);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "01_start.png") });
    await tap(p, "e2"); let s = await st(p); ok(s.sel === S("e2") && s.opts.sort().join() === [S("e3"), S("e4")].sort().join(), "a tap on a pawn selects it and lights up its two cells", s);
    await tap(p, "e4"); await sleep(900); s = await st(p); ok(s.ply === 1 && s.side === -1 && /Black to move/.test(s.msg) && !s.busy, "the move is played: Black to move", s);
    await tap(p, "e5"); s = await st(p); ok(s.sel === null, "a piece of the side that does not move cannot be selected");
    await p.evaluate(() => mcUndo()); await sleep(300); s = await st(p); ok(s.ply === 0 && s.side === 1, "undo takes the move back");

    // ------------------------------------------------------------------ check, a capture spell, castling, promotion
    await setFen(p, "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1");
    await tap(p, ["e2", "a2"]); await sleep(900); s = await st(p); ok(s.ply === 1 && s.chk.length === 0, "a quiet move");
    await setFen(p, "4k3/8/8/8/8/8/R7/4K3 w - - 0 1");
    await tap(p, ["a2", "a8"]); await sleep(900); s = await st(p);
    ok(s.chk.join() === String(S("e8")) && /Check!/.test(s.msg), "a check: the king's cell glows red and the message says Check!", s);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "02_check.png") });
    await setFen(p, "4k3/8/8/3p4/8/8/8/R3K3 w - - 0 1"); await p.evaluate(() => { const G = MCU.G; G.P.b[8 * 3 + 3] = -1; G.P.b[8 * 7 + 3] = 4; G.P.b[8 * 7] = 0; mcRender(); });
    await tap(p, "d1"); s = await st(p); ok(s.hits.join() === String(S("d5")), "a cell with an enemy piece is ringed red (a capture) and the others are dots", s);
    await tap(p, "d5"); await sleep(380);
    const fx = await p.evaluate(() => ({ sparks: document.querySelectorAll("#mcFx i").length, shatter: document.querySelectorAll("#mcPcs .mp.shatter").length, shake: document.getElementById("mcBoard").classList.contains("shake") }));
    ok(fx.sparks >= 10 && fx.shatter === 1 && fx.shake, "a capture is a spell: sparks, the taken piece bursts, the board shakes", fx);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "03_spell.png") });
    await sleep(900); s = await st(p); ok(s.ply === 1 && s.pcs === 3, "the move is played and the taken piece is gone (3 pieces are left)", s);
    const gotc = await p.evaluate(() => document.querySelectorAll("#mcScr .sh-pl .mc-cap svg").length); ok(gotc === 1, "the taken piece is shown under the player who took it", gotc);
    await setFen(p, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    await tap(p, ["e1", "g1"]); await sleep(1000); const cs = await p.evaluate(() => ({ k: MCU.G.P.b[62], r: MCU.G.P.b[61], h: MCU.G.P.b[63] })); ok(cs.k === 6 && cs.r === 4 && cs.h === 0, "castling short: the king and the rook both move", cs);
    await setFen(p, "4k3/P7/8/8/8/8/p7/4K3 w - - 0 1");
    await tap(p, ["a7", "a8"]); await sleep(400); let m = await modal(p);
    ok(m && m.picks === 4 && /pawn/i.test(m.t), "a pawn on the last row asks what it becomes: four pieces to pick", m);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "04_promotion.png") });
    await p.evaluate(() => document.querySelectorAll("#mExtra .mc-pk")[3].click()); await sleep(1200); s = await st(p);
    ok(s.ply === 1 && (await p.evaluate(() => MCU.G.P.b[0])) === 2, "the choice (the 4th = a knight) is made", s);
    await setFen(p, "4k3/P7/8/8/8/8/p7/4K3 w - - 0 1"); await tap(p, ["a7", "a8"]); await sleep(300); await clickBtn(p, "Cancel"); await sleep(300);
    ok((await st(p)).ply === 0 && (await st(p)).sel === null, "cancelling the choice leaves the pawn where it was");

    // ------------------------------------------------------------------ the end: mate, stalemate, draw, resignation
    await p.evaluate(() => { const G = mcNew(); MCU.G = G; MCU.sel = null; MCU.fin = 0; MCU.busy = 0; mcRender(); });
    for (const [f, t] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) { await tap(p, [f, t]); await sleep(900); }
    await sleep(1500); m = await modal(p);
    ok(m && /Black wins/i.test(m.t) && /Checkmate/i.test(m.txt) && m.btns.length === 2, "fool's mate: 'Black wins!' with the reason Checkmate", m);
    ok(await p.evaluate(() => document.getElementById("mcScr").classList.contains("zap")), "a mate is a flash of lightning");
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "05_mate.png") });
    await clickBtn(p, "Play again"); await sleep(900); ok((await st(p)).ply === 0, "Play again starts a new game");
    await setFen(p, "7k/8/5QK1/8/8/8/8/8 w - - 0 1"); await tap(p, ["f6", "f7"]); await sleep(1700); m = await modal(p);
    ok(m && /^Draw$/i.test(m.t.trim()) && /Stalemate/i.test(m.txt), "stalemate: a draw with the reason", m);
    await clickBtn(p, "Play again"); await sleep(700);
    await p.evaluate(() => document.querySelector('#mcScr [data-a="resign"]').click()); await sleep(400); await clickBtn(p, "Yes"); await sleep(1700); m = await modal(p);
    ok(m && /Black wins/i.test(m.t) && /Resigned/i.test(m.txt), "a resignation: the other colour wins", m);
    await clickBtn(p, "Play again"); await sleep(700);
    await p.evaluate(() => document.querySelector('#mcScr [data-a="draw"]').click()); await sleep(400); await clickBtn(p, "Yes"); await sleep(1700); m = await modal(p);
    ok(m && /^Draw$/i.test(m.t.trim()) && /agreement/i.test(m.txt), "a draw by agreement", m);
    await clickBtn(p, "Menu"); await sleep(500);
    ok(await p.evaluate(() => !document.getElementById("mcScr").classList.contains("on") && document.getElementById("mini").classList.contains("on")), "Menu closes the board: the mini-games screen is there");

    // ------------------------------------------------------------------ the bot
    for (const lv of ["easy", "mid", "hard"]) {
      await p.evaluate(l => mcStartBot(l), lv); await sleep(900);
      const my = (await st(p)).my;
      ok(await until(async () => { const x = await st(p); return x.side === my && !x.busy; }, 15000), `${lv}: it is my turn (I am ${my > 0 ? "White" : "Black"})`);
      const f0 = await st(p); ok(f0.flip === (my < 0), `${lv}: the board turns round when I am Black`, f0);
      const mv = await p.evaluate(() => { const l = mcLegal(MCU.G.P); return mcPath(l[Math.floor(Math.random() * l.length)]); }); await tap(p, mv.slice(0, 2));
      if (mv.length > 2) { await sleep(300); await p.evaluate(() => { const bt = document.querySelector("#mExtra .mc-pk"); if (bt) bt.click(); }); }
      ok(await until(async () => (await st(p)).ply >= f0.ply + 2, 20000), `${lv}: the bot answers`, await st(p));
    }
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "06_bot.png") });
    await p.evaluate(() => mcUndo()); await sleep(500); s = await st(p); ok(s.side === s.my, "undo against the bot takes back my move and its answer", s);
    const my0 = (await st(p)).my;
    await p.evaluate(m => { const f = m > 0 ? "7k/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1" : "r5k1/5ppp/8/8/8/8/5PPP/7K b - - 0 1"; const G = MCU.G; G.P = mcFen(f); G.side = G.P.side; G.moves = []; G.seen = {}; G.over = null; G.check = false; G.taken = { w: [], b: [] }; MCU.sel = null; MCU.fin = 0; MCU.busy = 0; MCU.tok++; mcRender(); }, my0);
    await tap(p, my0 > 0 ? ["a1", "a8"] : ["a8", "a1"]); await sleep(1900); m = await modal(p);
    ok(m && /VICTORY/i.test(m.t), "a win against the bot (a back-rank mate): the victory window", m);
    await clickBtn(p, "Play again"); await sleep(1500); ok((await st(p)).my === -my0, "Play again against the bot: the colours are swapped", [my0, (await st(p)).my]);
    await p.evaluate(() => mcClose());

    // ------------------------------------------------------------------ it fits every screen
    for (const [name, vp, touch] of [["small landscape", { width: 740, height: 360 }, true], ["upright phone (page turned)", { width: 328, height: 611 }, true], ["computer", { width: 1280, height: 720 }, false], ["tablet", { width: 1024, height: 768 }, true]]) {
      const q = await open(vp, touch);
      await q.p.evaluate(() => { toMenu("mini"); mcStartLocal(); }); await sleep(900);
      const r = await q.p.evaluate(() => { const rect = e => { const b = document.querySelector(e).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }; return { vp: [innerWidth, innerHeight], bd: rect("#mcBoard"), info: rect("#mcScr .sh-info"), btns: rect("#mcScr .sh-btns"), pcs: [...document.querySelectorAll("#mcPcs .mp")].every(e => { const b = e.getBoundingClientRect(), bd = document.querySelector("#mcBoard").getBoundingClientRect(); return b.left >= bd.left - 1 && b.right <= bd.right + 1 && b.top >= bd.top - 1 && b.bottom <= bd.bottom + 1 && b.width > 12; }) }; });
      const inside = (a, w, h) => a.l >= -1 && a.t >= -1 && a.r <= w + 1 && a.b <= h + 1;
      ok(Math.abs(r.bd.w - r.bd.h) < 1.5 && r.bd.w >= 180 && r.pcs && [r.bd, r.btns, r.info].every(a => inside(a, r.vp[0], r.vp[1])) && !(r.bd.l < r.info.r - 1 && r.bd.r > r.info.l + 1 && r.bd.t < r.info.b && r.bd.b > r.info.t), `${name} (${vp.width}x${vp.height}): a big square board, the pieces inside it, nothing leaves the screen or overlaps`, r);
      if (SHOT) await q.p.screenshot({ path: path.join(SHOT, `07_${vp.width}x${vp.height}.png`) });
      await q.close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 5));
    await close();
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
