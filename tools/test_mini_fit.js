#!/usr/bin/env node
// The Minigames screen on the owner's phone:  node tools/test_mini_fit.js
// His phone is 393 px wide and the page is 531 px tall after the 26% smaller menus (412 px phones: 557). That is the band 521..560 px: it got the roomy cards (big pictures) and the grid was
// about 150 px taller than the screen, so the second row of cards was cut off (portrait: its left edge, landscape: the bottom). Now the whole grid fits, turned page (portrait) and landscape.
// Bigger screens keep the roomy cards, smaller phones (page 520 px and below) keep their compact cards.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8197"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  const sizes = [["393x821 portrait (turned page)", 393, 821, true], ["393x730 portrait with the browser bars", 393, 730, true], ["832x393 landscape", 832, 393, true], ["412x766 portrait", 412, 766, true], ["875x412 landscape", 875, 412, true],
    ["832x380 compact phone (page 513 px: below the band)", 832, 380, true], ["1280x720 computer", 1280, 720, false]];
  for (const [name, w, h, touch] of sizes) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, locale: "en-US" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" })));
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto("http://localhost:8197/index.html", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 }); await sleep(500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(600);
    await p.evaluate(() => go("mini")); await sleep(2500);
    const m = await p.evaluate(() => { const S = document.getElementById("mini"), cards = [...S.querySelectorAll(".mgc")], W = innerWidth, H = innerHeight, img = S.querySelector(".mgc .mgart img");
      const out = cards.filter(c => { const r = c.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1; }).length;
      return { n: cards.length, sh: S.scrollHeight, ch: S.clientHeight, out, art: img ? getComputedStyle(img).maxHeight : "", band: document.documentElement.classList.contains("mh560") && !document.documentElement.classList.contains("mh520"), compact: document.documentElement.classList.contains("mh520") }; });
    ok(m.n === 5, `${name}: five minigame cards`, m);
    if (w < 900 && h >= 390) {   // the band 521..560
      ok(m.band, `${name}: the page is in the 521..560 band`, m);
      ok(m.sh <= m.ch + 1, `${name}: the Minigames screen needs no scrolling (${m.sh} <= ${m.ch})`, m);
      ok(m.out === 0, `${name}: every card is fully on the screen`, m);
      ok(m.art === "54px", `${name}: the cards' pictures are the band's size`, m);
    } else if (w < 900) {
      ok(m.compact, `${name}: below the band the compact layout is on`, m); ok(m.art === "62px", `${name}: its pictures keep the compact size (62 px)`, m);
    } else ok(m.art === "110px", `${name}: a computer keeps the roomy card pictures (110 px)`, m);
    await ctx.close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
