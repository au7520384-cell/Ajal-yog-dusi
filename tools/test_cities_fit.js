#!/usr/bin/env node
// "Choose a table" on the owner's phone:  node tools/test_cities_fit.js
// His phone (393 px tall, 412 px phones too) is in the band 521..560 of the page's own height (after the 26% smaller menus). It got the ROOMY city card: the stats list filled the card, the city
// picture (the beautiful skyline of London, Sydney ...) was squeezed into a ~58 px strip at the top and the cards looked big (the owner: "why did you push the beautiful cities to the top").
// The list also scrolls without the blur filter, backdrop blur and filtered lock overlay of the cards (the owner's screen flickered while he scrolled past the locked cities).
// Now that band gets the compact card of the phones just below it: a big picture, short stats, the fee on the PLAY key; four cards fit the row. Bigger screens keep the roomy card.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8196"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  // [name, w, h, touch, minFullCards, kind]
  const sizes = [["393x821 portrait (turned page)", 393, 821, true, 4, "band"], ["393x730 portrait with the browser bars", 393, 730, true, 3, "band"], ["873x393 landscape", 873, 393, true, 4, "band"],
    ["412x766 portrait", 412, 766, true, 3, "band"], ["875x412 landscape", 875, 412, true, 4, "band"], ["832x380 compact phone (below the band)", 832, 380, true, 3, "compact"], ["1280x720 computer", 1280, 720, false, 3, "roomy"]];
  for (const [name, w, h, touch, minFull, kind] of sizes) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, locale: "en-US" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" })));
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto("http://localhost:8196/index.html", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 }); await sleep(500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(600);
    await p.evaluate(() => go("cities")); await sleep(2500);
    const m = await p.evaluate(() => { const cs = (e, k, pe) => getComputedStyle(e, pe)[k], list = [...document.querySelectorAll("#cities .city")], C = list[0], B = C.querySelector(".cban");
      const full = list.filter(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }).length;
      const ch = parseFloat(cs(C, "height")), bh = parseFloat(cs(B, "height")), cw = parseFloat(cs(C, "width"));
      const lk = document.querySelector("#cities .city .lock");
      return { n: list.length, full, ch, bh, cw, ratio: bh / ch, blur: cs(C, "filter", "::before"), backdrop: cs(C.querySelector(".prize"), "backdropFilter"), lockFilter: lk ? cs(lk, "filter") : "no-lock", fee: cs(C.querySelector(".cplay"), "content", "::after"), rows: [...C.querySelectorAll(".crow")].map(e => cs(e, "display")), band: document.documentElement.classList.contains("mh560") && !document.documentElement.classList.contains("mh520") }; });
    ok(m.n >= 30, `${name}: the city cards are there`, m);
    ok(m.bh >= 100, `${name}: the city picture is big (${Math.round(m.bh)} px, not a strip)`, m);
    ok(m.blur === "none" && m.backdrop === "none" && m.lockFilter === "none", `${name}: the cards carry no blur / backdrop / lock filter (smooth scrolling)`, m);
    if (kind !== "roomy") ok(m.ratio >= 0.4, `${name}: the picture is at least 40% of the card (${Math.round(m.ratio * 100)}%)`, m);
    ok(m.full >= minFull, `${name}: ${minFull}+ cards fit the screen fully (${m.full})`, m);
    if (kind === "band") { ok(m.band, `${name}: the page is in the 521..560 band`, m); ok(m.cw >= 190 && m.cw <= 225, `${name}: the compact card width (190..225 px, 22% of the page: ${Math.round(m.cw)})`, m); ok(/🪙/.test(m.fee), `${name}: the fee is on the PLAY key`, m); ok(m.rows.every(d => d === "none"), `${name}: the extra rows are hidden`, m); }
    if (kind === "compact") ok(m.cw >= 190 && m.cw <= 225, `${name}: the compact card width is unchanged (190..225 px: ${Math.round(m.cw)})`, m);
    if (kind === "roomy") ok(Math.round(m.cw) >= 260 && !/🪙/.test(m.fee), `${name}: a computer keeps the roomy card (${Math.round(m.cw)} px)`, m);
    await ctx.close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
