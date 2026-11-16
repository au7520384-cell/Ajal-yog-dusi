#!/usr/bin/env node
// Typing when the game runs INSIDE AN IFRAME (Y8 and the other portals) on a phone:  node tools/test_iframe_keyboard.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures)
// The owner (Nov 16, Y8 in Chrome, screenshot of the world chat): "while I type, the text box is behind the keyboard, you stuffed the keyboard over it again; and Back turns the screen black".
// Why: inside an iframe document.fullscreenElement is null even when the Y8 page made the frame full screen, and visualViewport does not shrink for a frame, so the game neither knew it was in
// full screen (the in-game keyboard "igk" stands in for the phone's own one there) nor how high the phone's keyboard was (--osk): the text box of the world chat stayed behind the keys and the
// phone's keyboard made Android resize / flash the window. Now a touch phone in an iframe always gets the in-game keyboard (its ⌨ key still hands the box to the phone's own keyboard).
// Checked here (Chromium, a phone-sized touch screen, the game in a frame like Y8's):
//  - the world chat's text box gets the in-game keyboard (inputMode "none": the phone's keyboard stays down), its panel ends above the keys, what is typed is shown in the strip, the keys type, Enter sends
//  - the other panels with a text box (the lobby chat panel) the same; a computer (mouse as the main pointer) in a frame keeps its own keyboard
//  - the Back button (popstate): the first press hides the in-game keyboard, the next one closes the world chat, the next ones do not leave the page (a toast asks for a second press at the home screen)
//  - the same page NOT in a frame keeps working as before (no in-game keyboard in a landscape window that is not full screen)
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms)), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  const wrap = `<!doctype html><body style="margin:0;background:#000"><iframe id="g" src="/index.html" style="border:0;width:100vw;height:100vh;display:block" allow="autoplay"></iframe></body>`;
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]); if (u === "/wrap") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(wrap); }
    const f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  // open the game: inFrame = true -> inside an iframe of /wrap; touch = a phone (coarse main pointer) or a computer
  const open = async (inFrame, touch, name) => {
    const ctx = await b.newContext({ locale: "en-US", viewport: { width: 915, height: 412 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(() => { try { if (location.pathname.endsWith("index.html") || location.pathname === "/") { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 5000 })); } } catch (e) {} });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/${inFrame ? "wrap" : "index.html"}`, { waitUntil: "commit" });
    const fr = () => inFrame ? p.frames().find(f => f.url().includes("/index.html")) : p.mainFrame();
    for (let i = 0; i < 600 && !(fr() && await fr().evaluate(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot")).catch(() => false)); i++) await sleep(200);
    await sleep(600);
    await fr().evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); const t = document.getElementById("toasts"); if (t) t.style.display = "none"; document.getElementById("modal").classList.remove("on"); try { vipShownSession = true; } catch (e) {} });
    await sleep(400); return { p, fr, ctx };
  };
  const rect = (f, sel) => f.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const key = (f, c) => f.evaluate(c => { const k = [...document.querySelectorAll("#igk button")].find(x => x.dataset.c === c || x.dataset.c === c.toUpperCase() || x.dataset.s === c); if (!k) return false; k.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); return true; }, c);
  const state = f => f.evaluate(() => ({ igk: document.documentElement.classList.contains("igk"), kbH, im: (document.getElementById("wChatIn") || {}).inputMode, chat: document.getElementById("wChat").classList.contains("on"), frame: window.top !== window.self }));
  try {
    // ================= the game in a frame, a touch phone (Y8)
    let { p, fr, ctx } = await open(true, true, "frame-touch"); let f = fr();
    ok(await f.evaluate(() => window.top !== window.self && matchMedia("(pointer: coarse)").matches), "(the game is in a frame and the phone's main pointer is coarse)");
    await f.evaluate(() => document.getElementById("hWorld").click()); await sleep(900);
    await f.evaluate(() => { const i = document.getElementById("wChatIn"); i.blur(); i.focus(); }); await sleep(700);
    let s = await state(f);
    ok(s.chat, "the world chat opens", s);
    ok(s.igk && s.kbH > 0 && s.im === "none", "a touch phone in a frame: the text box gets the in-game keyboard (the phone's keyboard stays down: inputMode none)", s);
    const kb = await rect(f, "#igk"), inRow = await rect(f, "#wChat .sp-in"), panel = await rect(f, "#wChat .wcp"), vp = await f.evaluate(() => [innerWidth, innerHeight]);
    ok(kb && inRow && inRow.b <= kb.t + 1 && inRow.t >= -1 && inRow.w > 100, "the world chat's text box stands above the keys, not behind them", { inRow, kb });
    ok(panel && kb && panel.b <= kb.t + 2 && panel.r <= vp[0] + 1, "the whole world chat panel ends above the keyboard", { panel, kb, vp });
    await key(f, "h"); await key(f, "i"); await sleep(200);
    const typed = await f.evaluate(() => ({ v: document.getElementById("wChatIn").value, pv: (document.querySelector("#igk .pv .pt") || {}).textContent || "" }));
    ok(/^hi$/i.test(typed.v) && /hi/i.test(typed.pv), "the keys type into the box and the strip above the keys shows what was typed", typed);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "frame_world_chat.png") });
    // ---- Back: the in-game keyboard first, then the world chat, never out of the page
    const back = async () => { await f.evaluate(() => history.back()); await sleep(500); };
    await back(); s = await state(f);
    ok(!s.igk && s.chat, "Back (1st): the in-game keyboard goes away, the world chat stays", s);
    await back(); s = await state(f);
    ok(!s.chat, "Back (2nd): the world chat closes", s);
    await back(); await sleep(300);
    ok(p.url().includes("/wrap") && (await f.evaluate(() => typeof profile !== "undefined")), "Back (3rd, at the home screen): the page is not left (a toast asks for a second press)", p.url());
    await ctx.close();
    // ================= the game in a frame, a computer (mouse): its own keyboard
    ({ p, fr, ctx } = await open(true, false, "frame-mouse")); f = fr();
    await f.evaluate(() => document.getElementById("hWorld").click()); await sleep(800);
    await f.evaluate(() => { const i = document.getElementById("wChatIn"); i.blur(); i.focus(); }); await sleep(600);
    s = await state(f); ok(!s.igk && s.im !== "none", "a computer (mouse as the main pointer) in a frame keeps its own keyboard", s);
    await ctx.close();
    // ================= not in a frame, a touch phone in a landscape window (not full screen): the phone's own keyboard as before
    ({ p, fr, ctx } = await open(false, true, "plain-touch")); f = fr();
    await f.evaluate(() => document.getElementById("hWorld").click()); await sleep(800);
    await f.evaluate(() => { const i = document.getElementById("wChatIn"); i.blur(); i.focus(); }); await sleep(600);
    s = await state(f); ok(!s.frame && !s.igk && s.im !== "none", "not in a frame, not full screen: no in-game keyboard (the phone's own keyboard, as before)", s);
    await ctx.close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
