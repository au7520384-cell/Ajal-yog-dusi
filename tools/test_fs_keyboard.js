#!/usr/bin/env node
// The owner: "in full screen, when I write a message to my friend the screen goes black once and comes back":  node tools/test_fs_keyboard.js   (B8_ROOT=<repo copy>)
// The phone's own keyboard makes Android resize the window / show and hide its bars. In full screen on a touch screen the in-game keyboard (igk) now stands in for it,
// so nothing outside the page changes. Checked here (Chromium, a phone-sized touch screen):
//  - landscape, NOT full screen: the phone's own keyboard is left alone (no in-game keyboard)
//  - landscape, FULL SCREEN: a text box gets the in-game keyboard at the bottom of the page (full width), the page shrinks above it, the keys type, Enter reaches the box's own handler
//  - leaving full screen takes the in-game keyboard away and gives the box back to the phone's own keyboard (inputMode reset)
//  - a computer (mouse as the main pointer) in full screen keeps its own keyboard
//  - the page turned upright (portrait phone) keeps working as before
//  - a resize that changes nothing does not wipe the game canvas (no blank frame)
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), PORT = +process.env.TEST_PORT || 8297;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  const open = async (opt, name) => {
    const ctx = await b.newContext({ locale: "en-US", ...opt }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" })));
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(500);
    await p.evaluate(() => {   // a fake "full screen" switch (headless Chromium needs a user gesture for the real one) + a text box that counts its Enter presses
      window.__fs = false; Object.defineProperty(document, "fullscreenElement", { get: () => window.__fs ? document.documentElement : null, configurable: true });
      const i = document.createElement("input"); i.className = "name"; i.id = "tIn"; i.maxLength = 50; i.style.cssText = "position:fixed;left:30px;top:90px;z-index:50;width:260px";
      window.__enter = 0; i.addEventListener("keydown", e => { if (e.key === "Enter") window.__enter++; }); document.body.appendChild(i);
    });
    return p;
  };
  const st = p => p.evaluate(() => { const k = document.getElementById("igk"), r = k && k.getBoundingClientRect(), bd = document.body.getBoundingClientRect();
    return { igk: document.documentElement.classList.contains("igk"), on: !!k && k.classList.contains("on"), kbH, rot: rotated, im: document.getElementById("tIn").inputMode,
      kr: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) } : null, ih: innerHeight, iw: innerWidth, bodyH: Math.round(bd.height), bodyB: Math.round(bd.bottom) }; });
  const focusBox = async p => { await p.evaluate(() => { const i = document.getElementById("tIn"); i.blur(); i.focus(); }); await sleep(450); };
  try {
    // ---- 1. landscape phone
    let p = await open({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, "land");
    ok(await p.evaluate(() => matchMedia("(pointer: coarse)").matches), "(the emulated phone has a coarse main pointer)");
    await focusBox(p); let s = await st(p);
    ok(!s.igk && !s.on && s.kbH === 0, "landscape, not full screen: the phone's own keyboard is left alone (no in-game keyboard)", s);
    await p.evaluate(() => { document.getElementById("tIn").blur(); window.__fs = true; document.dispatchEvent(new Event("fullscreenchange")); }); await sleep(300);
    await focusBox(p); s = await st(p);
    ok(s.igk && s.on && s.kbH > 60 && s.rot === false, "landscape, FULL SCREEN: the in-game keyboard comes up for a text box", s);
    ok(s.kr && s.kr.w === s.iw && s.kr.l === 0 && Math.abs(s.kr.b - s.ih) <= 1 && Math.abs(s.kr.h - s.kbH) <= 1, "the keyboard fills the bottom of the screen, full width", s);
    ok(Math.abs(s.bodyB - s.kr.t) <= 2 && s.bodyH < s.ih - 60, "the page shrinks to the strip above the keyboard", s);
    ok(s.im === "none", "the box does not ask the phone's own keyboard to open", s.im);
    for (const c of ["H", "i"]) await p.click(`#igk button[data-c="${c}"]`);   // (an empty box starts with a capital)
    await p.click("#igk button[data-s=sh]"); await p.click('#igk button[data-c="Q"]'); await p.click("#igk button[data-s=bs]");
    await p.evaluate(() => { document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }); await sleep(100);
    ok(await p.evaluate(() => document.getElementById("tIn").value) === "Hi", "the keys type into the box (and ⌫ deletes)", await p.evaluate(() => document.getElementById("tIn").value));
    await p.click("#igk button[data-s=ok]"); await sleep(150);
    ok(await p.evaluate(() => window.__enter) === 1, "⏎ reaches the box's own Enter handler (sending a message)");
    // leaving full screen
    await p.evaluate(() => { window.__fs = false; document.dispatchEvent(new Event("fullscreenchange")); }); await sleep(500); s = await st(p);
    ok(!s.igk && !s.on && s.kbH === 0 && s.im === "", "leaving full screen takes the in-game keyboard away and gives the box back to the phone's own keyboard", s);
    ok(s.bodyH >= s.ih - 2, "the page has its full height again", s);
    // a resize that changes nothing must not wipe the canvas
    const wipes = await p.evaluate(() => { const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width"); let n = 0;
      Object.defineProperty(cv, "width", { get() { return d.get.call(this); }, set(v) { n++; d.set.call(this, v); }, configurable: true });
      resize(); resize(); document.dispatchEvent(new Event("fullscreenchange")); return new Promise(r => setTimeout(() => { delete cv.width; r(n); }, 400)); });
    ok(wipes === 0, "a resize that changes nothing does not rewrite (= wipe) the canvas", wipes);
    await p.context().close();

    // ---- 2. a computer: mouse as the main pointer, full screen: its own keyboard
    p = await open({ viewport: { width: 1280, height: 720 } }, "desk");
    await p.evaluate(() => { window.__fs = true; document.dispatchEvent(new Event("fullscreenchange")); }); await sleep(300);
    await focusBox(p); s = await st(p);
    ok(!s.igk && !s.on && s.kbH === 0, "a computer in full screen keeps its own keyboard", s);
    await p.context().close();

    // ---- 3. the page turned upright (portrait phone), as before
    p = await open({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, "port");
    await focusBox(p); s = await st(p);
    ok(s.rot && s.igk && s.on && s.kbH > 60, "a portrait phone (turned page) still gets the in-game keyboard", s);
    ok(s.kr && s.kr.h === s.ih && s.kr.l <= 1 && s.kr.w >= s.kbH - 1 && s.kr.w <= s.kbH + 1, "...standing at the screen's left edge (the turned page's bottom)", s.kr);
    await p.evaluate(() => document.getElementById("tIn").blur()); await sleep(500); s = await st(p);
    ok(!s.igk && s.kbH === 0 && s.im === "", "...and goes away when the box loses the focus", s);
    await p.context().close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
