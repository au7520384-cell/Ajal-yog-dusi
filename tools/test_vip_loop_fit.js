#!/usr/bin/env node
// The "Next-level promotion" (Loop) window and the VIP window on small / turned screens:  node tools/test_vip_loop_fit.js   (QUICK=1: fewer pages and languages; B8_ROOT=<repo copy>)
// The owner's two Telegram screenshots (turned page, Russian): (1) the Loop window was bigger than its window - the orange so'm card button of every offer was cut off at the edge;
// (2) in the VIP window the framed avatar of the "Ramka" (frame) cell was drawn on top of the cell's label ("Shlyapa" with a picture over it).
// Real server + Chromium, a phone in Telegram (stars only / stars + so'm card button) and a phone / laptop on the web ($ button), the page turned (portrait phone), landscape phones, a laptop:
//  - Loop: for all four offers (golden shot, scratch cards, coins, boxes) in several languages, the whole content fits the window without scrolling, every button stays inside its card and the screen
//  - VIP: for every page of the pager that has a frame, the picture of the frame (the avatar and the frame art around it) stays inside its cell and does not touch the label or the name
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8682, QUICK = !!process.env.QUICK;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const VPS = [   // [name, width, height, touch]: a touch phone held upright turns the page (the game is landscape)
  ["turned phone 412x764", 412, 764, true], ["phone 915x412", 915, 412, true], ["phone 844x390", 844, 390, true], ["small phone 667x375", 667, 375, true], ["laptop 1280x720", 1280, 720, false], ["narrow desktop 412x764", 412, 764, false],
];
const LANGS = QUICK ? ["ru", "de"] : ["ru", "de", "uz", "en", "tr", "ar", "th", "vi"];
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8vl-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2800);
  const b = await chromium.launch(), errs = [];
  const open = async (kind, vp) => {
    const [name, w, h, touch] = vp, ctx = await b.newContext({ viewport: { width: w, height: h }, locale: "ru-RU", serviceWorkers: "block", hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(kind + " " + name + ": " + e.message.slice(0, 200)));
    if (kind === "tg") await p.route("**/telegram-web-app.js", r => r.fulfill({ contentType: "text/javascript", body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){},onEvent(){},offEvent(){},initData:'',initDataUnsafe:{},isFullscreen:false,platform:'android',version:'7.0',HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}},openInvoice(){},openTelegramLink(){},openLink(){},close(){},MainButton:{hide(){},show(){}},BackButton:{hide(){},show(){},onClick(){}}}};" }));
    await p.addInitScript(() => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 100, lang: "ru", country: "UZ", countryManual: true, genderAsked: true, gender: "m", coins: 226639, gems: 6, cash: 6, xp: 400, level: 35 })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${P}/` + (kind === "tg" ? "#tgWebAppVersion=7.0&tgWebAppPlatform=android" : ""), { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(3500);
    await p.evaluate(() => document.getElementById("modal").classList.remove("on")); await sleep(400);
    p._name = name; return p;
  };
  // ---- the Loop window
  const loopCheck = (p, id) => p.evaluate(offer => {
    const w = 36 * 36e5, i = Math.floor(Date.now() / w) % LOOPS.length, want = LOOPS.find(x => x.id === offer), rest = LOOPS.filter(x => x !== want), arr = []; for (let j = 0; j < LOOPS.length; j++) arr[j] = j === i ? want : rest.shift(); LOOPS.length = 0; LOOPS.push(...arr);
    loopModal(); const ex = document.getElementById("mExtra"), cards = [...document.querySelectorAll(".loopc")], R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const out = { fitsY: ex.scrollHeight <= ex.clientHeight + 1, fitsX: ex.scrollWidth <= ex.clientWidth + 1, sh: ex.scrollHeight, ch: ex.clientHeight, sw: ex.scrollWidth, cw: ex.clientWidth, cards: cards.length, btnIn: true, onScreen: true, overlap: false, nb: 0, bad: [] };
    const scr = { l: -0.5, t: -0.5, r: innerWidth + 0.5, b: innerHeight + 0.5 };
    for (const c of cards) { const cr = R(c), bs = [...c.querySelectorAll(".btn")].map(R); out.nb += bs.length;
      for (const x of bs) { if (x.l < cr.l - 1 || x.r > cr.r + 1) { out.btnIn = false; out.bad.push(["btn outside its card", x, cr]); } if (x.l < scr.l || x.t < scr.t || x.r > scr.r || x.b > scr.b) { out.onScreen = false; out.bad.push(["btn off screen", x]); } }
      for (let a = 0; a < bs.length; a++) for (let z = a + 1; z < bs.length; z++) { const p1 = bs[a], p2 = bs[z]; if (p1.l < p2.r - 1 && p2.l < p1.r - 1 && p1.t < p2.b - 1 && p2.t < p1.b - 1) { out.overlap = true; out.bad.push(["buttons overlap", p1, p2]); } } }
    const lb = R(document.querySelector(".loopbox")); if (lb.l < scr.l || lb.t < scr.t || lb.r > scr.r || lb.b > scr.b) { out.onScreen = false; out.bad.push(["the box is off screen", lb]); }
    document.getElementById("modal").classList.remove("on"); return out;
  }, id);
  const MODES = [["tg", "stars", false], ["tg", "stars + so'm", true], ["web", "$", false]];
  for (const [kind, label, som] of MODES) {
    for (const vp of VPS) {
      const p = await open(kind, vp);
      if (kind === "tg") await p.evaluate(s => { TG_PAY = s ? { cur: "UZS", k: 12700 } : null; }, som);
      for (const lang of LANGS) {
        await p.evaluate(l => applyLang(l), lang); await sleep(150);
        for (const id of ["gold", "scr", "coin", "box"]) {
          const r = await loopCheck(p, id), tag = `Loop ${kind} ${label} ${vp[0]} ${lang} ${id}`;
          ok(r.cards === 3 && r.nb >= 3, `${tag}: three offers with buttons`, r);
          ok(r.fitsY && r.fitsX, `${tag}: the content fits the window without scrolling`, { sh: r.sh, ch: r.ch, sw: r.sw, cw: r.cw });
          ok(r.btnIn && r.onScreen && !r.overlap, `${tag}: buttons stay inside their card and the screen`, r.bad.slice(0, 2));
        }
      }
      await p.context().close();
    }
  }
  // ---- the VIP window: the picture of every frame cell stays in its cell
  const vipCheck = (p, k) => p.evaluate(k => {
    vipPage = k; vipOffers(); const out = { cells: 0, frames: 0, bad: [] }, R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const U = rs => rs.reduce((a, r) => ({ l: Math.min(a.l, r.l), t: Math.min(a.t, r.t), r: Math.max(a.r, r.r), b: Math.max(a.b, r.b) }));
    for (const cell of document.querySelectorAll(".hwin .hcol")) {
      out.cells++; const cr = R(cell), ic = cell.querySelector(".hci"), kids = [...ic.querySelectorAll("*")].filter(e => e.getBoundingClientRect().width > 0 && !(e.classList && e.classList.contains("avfx"))), isFr = !!ic.querySelector(".avx.avp");
      if (isFr) out.frames++;
      if (!kids.length) continue; const ir = U(kids.map(R));
      const texts = [...cell.querySelectorAll("small, b")].map(R), hit2 = (a, c, tol) => a.l < c.r - tol && c.l < a.r - tol && a.t < c.b - tol && c.t < a.b - tol;
      if (isFr && texts.some(t => hit2(ir, t, 2))) out.bad.push(["frame", "touches the text", ir, texts[0]]);   // (a line box is a little taller than its letters: 2 px of touching is not covering)
      if (ir.l < cr.l - 1.5 || ir.r > cr.r + 1.5 || ir.t < cr.t - 1.5 || ir.b > cr.b + 1.5) out.bad.push([isFr ? "frame" : "icon", "leaves its cell", ir, cr]);
    }
    document.getElementById("modal").classList.remove("on"); return out;
  }, k);
  for (const vp of VPS) {
    const p = await open("web", vp);
    const pages = await p.evaluate(() => VOP().map((o, k) => [k, !!o.tiers[(vipSel[o.id] | 0) % o.tiers.length].frame]).filter(x => x[1]).map(x => x[0]));
    const use = QUICK ? pages.filter((_, i) => i % 5 === 0) : pages; let frames = 0, cells = 0, bad = [];
    for (const k of use) { const r = await vipCheck(p, k); frames += r.frames; cells += r.cells; for (const x of r.bad) bad.push([k, ...x]); await sleep(60); }
    ok(use.length >= 10 && frames === use.length && cells >= use.length * 4, `VIP ${vp[0]}: ${use.length} pages with a frame, ${cells} cells`, { pages: use.length, frames, cells });
    ok(bad.length === 0, `VIP ${vp[0]}: no picture touches a label or leaves its cell (${bad.length} problems on ${new Set(bad.map(x => x[0])).size} pages)`, bad.slice(0, 3));
    await p.context().close();
  }
  ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  await b.close(); srv.kill(); await sleep(300); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
