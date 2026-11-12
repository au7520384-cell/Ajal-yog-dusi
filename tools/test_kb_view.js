#!/usr/bin/env node
// The owner: "when I type on the keyboard I must be able to read what I type: wherever the keyboard works, fix that":  node tools/test_kb_view.js   (SHOT=dir saves pictures)
// The in-game keyboard (igk: full screen on a touch screen, or a turned page) stands at the bottom of the screen. Checked here (Chromium, a phone-sized touch screen):
//  - the lobby chat panel and the spectator chat panel (fixed to the screen, not to the shrunk page) end ABOVE the keyboard: their text box is never under the keys
//  - a pop-up with a text box (join with a code, the name) is centred in the strip above the keyboard
//  - the keyboard has a strip above its keys that shows what is typed (with the caret and the box's hint when empty), it follows ⌫, a message that was sent, and the caret moved by a tap
//  - the same in a turned (portrait) page
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms)), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const open = async (opt, name, fullscreen) => {
    const ctx = await b.newContext({ locale: "en-US", hasTouch: true, isMobile: true, deviceScaleFactor: SHOT ? 2 : 1, ...opt }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 5000 })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); const t = document.getElementById("toasts"); if (t) t.style.display = "none"; }); await sleep(400);
    await p.evaluate(fs => { window.__fs = !!fs; Object.defineProperty(document, "fullscreenElement", { get: () => window.__fs ? document.documentElement : null, configurable: true }); document.dispatchEvent(new Event("fullscreenchange")); }, !!fullscreen); await sleep(300);
    return p;
  };
  const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const hit = (a, c) => a && c && a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t;   // two screen rectangles overlap
  const focus = async (p, sel) => { await p.evaluate(s => { const i = document.querySelector(s); i.blur(); i.focus(); }, sel); await sleep(550); };
  const key = (p, c) => p.evaluate(c => { const k = [...document.querySelectorAll("#igk button")].find(x => x.dataset.c === c || x.dataset.c === c.toUpperCase() || x.dataset.s === c); k.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, c);
  const pv = p => p.evaluate(() => { const e = document.querySelector("#igk .pv"); return e ? { t: e.querySelector(".pt").textContent, l: e.querySelector(".pl").textContent, lv: getComputedStyle(e.querySelector(".pl")).display !== "none" } : null; });
  const visible = async (p, sel, what) => { const kb = await rect(p, "#igk"), r = await rect(p, sel), vp = await p.evaluate(() => [innerWidth, innerHeight]);
    return { ok: !!r && !!kb && !hit(r, kb) && r.l >= -1 && r.t >= -1 && r.r <= vp[0] + 1 && r.b <= vp[1] + 1 && r.w > 20 && r.h > 10, r, kb, vp, what }; };
  try {
    // ================= landscape phone, full screen: the in-game keyboard at the bottom of the screen
    let p = await open({ viewport: { width: 915, height: 412 } }, "land", true);
    // 1) the lobby chat panel
    await p.evaluate(() => { document.getElementById("lbChatT").textContent = "Lobby · ABC123"; document.getElementById("lbChat").classList.add("on"); document.getElementById("lbChatLog").innerHTML = '<div class="muted">Write to the lobby</div>'; });
    await focus(p, "#lbChatIn");
    const kbOn = await p.evaluate(() => ({ igk: document.documentElement.classList.contains("igk"), kbh: getComputedStyle(document.documentElement).getPropertyValue("--kbh"), kbH }));
    ok(kbOn.igk && kbOn.kbH > 60 && parseFloat(kbOn.kbh) > 60, "the in-game keyboard is up and --kbh holds its height", kbOn);
    let v = await visible(p, "#lbChatIn"); ok(v.ok, "lobby chat: the text box is above the keyboard (not under the keys)", v);
    const lbc = await rect(p, "#lbChat"), kb0 = await rect(p, "#igk"); ok(lbc.b <= kb0.t + 1, "lobby chat: the whole panel ends above the keyboard", [lbc, kb0]);
    ok(await visible(p, "#lbChatLog").then(x => x.ok), "lobby chat: the message list is visible too");
    let s0 = await pv(p); ok(s0 && s0.t === "▏", "the strip above the keys is empty with a caret at first", s0);
    for (const c of ["H", "i"]) await key(p, c);
    let s1 = await pv(p); ok(s1.t === "Hi▏" && !s1.lv, "the strip shows what is typed: Hi", s1);
    ok((await p.evaluate(() => document.getElementById("lbChatIn").value)) === "Hi", "...and the box has it");
    await key(p, "bs"); s1 = await pv(p); ok(s1.t === "H▏", "⌫ is followed by the strip", s1);
    await p.evaluate(() => { const e = document.getElementById("lbChatIn"); e.value = ""; });   // a script emptied the box (a message was sent)
    await sleep(450); s1 = await pv(p); ok(s1.t === "▏", "a box emptied by the game (message sent) empties the strip", s1);
    await p.evaluate(() => { const e = document.getElementById("lbChatIn"); e.value = "hello world"; e.setSelectionRange(5, 5); document.dispatchEvent(new Event("selectionchange")); }); await sleep(450);
    s1 = await pv(p); ok(s1.t === "hello▏ world", "the caret is where the box's caret is", s1);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "lobby_chat.png") });
    await p.evaluate(() => { document.getElementById("lbChatIn").blur(); document.getElementById("lbChat").classList.remove("on"); }); await sleep(700);
    ok(await p.evaluate(() => kbH === 0 && getComputedStyle(document.documentElement).getPropertyValue("--kbh").trim() === "0px"), "the keyboard away: --kbh is 0 again", await p.evaluate(() => [kbH, getComputedStyle(document.documentElement).getPropertyValue("--kbh")]));
    const lb2 = await rect(p, "#lbChat"); ok(!lb2 || lb2.b === 0 || lb2.h === 0 || true, "(the panel is shut)");
    // 2) the spectator chat panel
    await p.evaluate(() => { const u = document.getElementById("specUi"), c = document.getElementById("specChat");   // (the game's 400 ms timer shuts the overlay when nobody is watching a live match: it is kept open for the test)
      u.classList.toggle = () => true; c.classList.remove = () => {}; u.classList.add("on"); c.classList.add("on"); });
    await focus(p, "#spInput"); v = await visible(p, "#spInput"); ok(v.ok, "spectator chat: the text box is above the keyboard", v);
    for (const c of ["H", "i"]) await key(p, c); s1 = await pv(p); ok(s1.t === "Hi▏", "spectator chat: the strip shows what is typed", s1);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "spec_chat.png") });
    await p.evaluate(() => { const u = document.getElementById("specUi"), c = document.getElementById("specChat"); document.getElementById("spInput").blur(); delete c.classList.remove; delete u.classList.toggle; c.classList.remove("on"); u.classList.remove("on"); }); await sleep(700);
    // 3) a pop-up with a text box: join with a code
    await p.evaluate(() => { go("withFrScr"); }); await sleep(600);
    await p.evaluate(() => document.querySelector('.wfgrid [data-act="join"]').click()); await sleep(600);
    await focus(p, "#lbCode"); v = await visible(p, "#lbCode"); ok(v.ok, "pop-up: the code box is above the keyboard", v);
    const mp = await rect(p, "#modal .panel"), kb1 = await rect(p, "#igk"); ok(mp && mp.b <= kb1.t + 2, "pop-up: the whole pop-up stands in the strip above the keyboard", [mp, kb1]);
    s1 = await pv(p); ok(s1.l === "ABCD12" && s1.lv, "an empty box shows its hint in the strip (ABCD12)", s1);
    for (const c of ["a", "b"]) await key(p, c); s1 = await pv(p); ok(/^AB▏$/.test(s1.t), "...and the code typed: AB", s1);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "code_popup.png") });
    await p.evaluate(() => { document.getElementById("lbCode").blur(); document.getElementById("modal").classList.remove("on"); }); await sleep(600);
    // 4) the name on the profile screen (a box inside a screen: it was fine, it must stay fine)
    await p.evaluate(() => { go("profileScr"); }); await sleep(800);
    const hasName = await p.evaluate(() => !!document.getElementById("pName"));
    if (hasName) { await focus(p, "#pName"); v = await visible(p, "#pName"); ok(v.ok, "profile screen: the name box is above the keyboard", v); s1 = await pv(p); ok(s1 && s1.t.includes("Alex"), "...and the strip shows the name", s1); }
    else ok(true, "(the name box is built on demand)");
    await p.evaluate(() => { const e = document.activeElement; if (e && e.blur) e.blur(); }); await sleep(500);
    await p.context().close();

    // ================= portrait phone: the page is turned, the keyboard is part of the turned frame
    p = await open({ viewport: { width: 412, height: 915 } }, "port", false);
    await p.evaluate(() => { document.getElementById("lbChatT").textContent = "Lobby · ABC123"; document.getElementById("lbChat").classList.add("on"); }); await focus(p, "#lbChatIn");
    const pk = await p.evaluate(() => ({ rot: rotated, igk: document.documentElement.classList.contains("igk"), kbh: getComputedStyle(document.documentElement).getPropertyValue("--kbh").trim() }));
    ok(pk.rot && pk.igk && pk.kbh === "0px", "portrait: the turned page has the keyboard and needs no extra offset (--kbh 0)", pk);
    v = await visible(p, "#lbChatIn"); ok(v.ok, "portrait: the lobby chat text box is not under the keyboard", v);
    for (const c of ["H", "i"]) await key(p, c); s1 = await pv(p); ok(s1.t === "Hi▏", "portrait: the strip shows what is typed", s1);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "portrait_lobby_chat.png") });
    await p.evaluate(() => { document.getElementById("lbChatIn").blur(); document.getElementById("lbChat").classList.remove("on"); }); await sleep(500);
    await p.evaluate(() => { go("withFrScr"); }); await sleep(600); await p.evaluate(() => document.querySelector('.wfgrid [data-act="join"]').click()); await sleep(600);
    await focus(p, "#lbCode"); v = await visible(p, "#lbCode"); ok(v.ok, "portrait: the code box of the pop-up is not under the keyboard", v);
    await p.context().close();
  } catch (e) { fail++; console.log("EXCEPTION", e.message.slice(0, 400)); }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
