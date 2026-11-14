#!/usr/bin/env node
// Menus open at once and never flash:  node tools/test_instant_menus.js
// The owner's screen recording showed dark blank frames when a window opened (the 0.24 s screen fade-in and the modal / diamond-store zoom-in started from nothing) and the heavy screens froze for a moment:
//  - the Season Pass built 400 tiers x 2 cells with a picture each (avatar / frame / cue / table canvases) in one go: 1.4 s on this computer, 8 s on a 4x slower phone;
//  - the Trophy Road read each prize's place right after adding a tick to the page, so the whole road was laid out again and again.
// Now: no opening animation at all, the Pass fills its far tiers a few per frame (empty frames first), the Road reads the places once. This test checks the behaviour (not only the speed).
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8198"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 393, height: 730 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
  await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 90000, gems: 6 })));
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto("http://localhost:8198/index.html", { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 }); await sleep(500);
  await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(600);

  // 1. nothing zooms or fades in when a screen / window opens (a frame that starts from nothing is a dark flash)
  const an = await p.evaluate(() => {
    const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } });
    const kf = n => { const r = css.find(x => x.type === 7 && x.name === n); return r ? r.cssText : ""; };
    go("cities");
    const sc = getComputedStyle(document.querySelector("#cities.screen.on") || document.getElementById("cities")).animationName;
    openModal({icon: "", title: "t", text: "x", buttons: [{label: "ok", cls: "gray", fn: () => {}}]});
    const md = getComputedStyle(document.querySelector("#modal .panel")).animationName;
    document.getElementById("modal").classList.remove("on");
    return { sc, md, shine: kf("shine"), pready: [...document.querySelectorAll(".ptier.ready,.cpn2.ok")].map(e => getComputedStyle(e).animationName) };
  });
  ok(an.sc === "none", "a screen opens with no fade-in animation", an.sc);
  ok(an.md === "none", "a window (modal) opens with no zoom-in animation", an.md);
  ok(/transform/.test(an.shine) && !/left/.test(an.shine), "the tile shine moves by transform only (no layout / paint every frame)", an.shine);
  ok(an.pready.every(x => x === "none"), "ready prizes glow steadily (a pulsing box-shadow repainted the whole list)", an.pready);

  // 2. the diamond store opens without a zoom-in too
  const ds = await p.evaluate(() => { openDiamondStore(true); const e = document.querySelector(".dstore"); return e ? getComputedStyle(e).animationName : "no-store"; });
  ok(ds === "none", "the diamond store opens with no zoom-in", ds);
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); go("home"); }); await sleep(300);

  // 3. Season Pass: the far tiers are empty frames at first and fill in (nearest first); a prize that appeared late can be taken
  await p.evaluate(() => { const s = passState(); s.pts = 300 * PASS_STEP + 5; s.got = {}; s.prem = true; save(); });
  const t0 = await p.evaluate(() => { const t = performance.now(); go("passScr"); const sync = performance.now() - t, w = document.querySelector("#passBody .passwrap"), all = w.querySelectorAll(".ptier").length, far = w.querySelectorAll(".fcell").length;
    return { sync: Math.round(sync), all, far, left: w.scrollLeft, tier: Math.floor(passState().pts / PASS_STEP), nearReady: w.querySelectorAll(".ptier:not(.fcell) .qty").length }; });
  ok(t0.all === 800, "the pass has all 800 cells (400 tiers x free + premium)", t0);
  ok(t0.far > 500, "the far tiers start as empty frames (not 800 pictures at once)", t0);
  ok(t0.nearReady >= 30 && t0.nearReady <= 60, "the tiers around the player's place are complete at once", t0);
  ok(t0.sync < 600, `opening the pass is quick (${t0.sync} ms of script on this computer)`, t0);
  await p.evaluate(() => { document.querySelector("#passBody .passwrap").scrollLeft = 3 * 126; }); await sleep(900);
  const t1 = await p.evaluate(() => { const w = document.querySelector("#passBody .passwrap"), c = w.querySelector('[data-claim="5f"]'); return { filled: !w.querySelector('.fcell[data-pc="5f"]'), claim: !!c, thumbs: [...w.querySelectorAll("img[data-tt]")].filter(i => i.src.startsWith("data:image/jpeg")).length }; });
  ok(t1.filled && t1.claim, "scrolling to the first tiers fills them in, with a working Take button", t1);
  const t2 = await p.evaluate(() => { const w = document.querySelector("#passBody .passwrap"), c = w.querySelector('[data-claim="5f"]'); const before = !!passState().got["5f"]; c.click(); return { before, after: !!passState().got["5f"] }; });
  ok(!t2.before && t2.after, "the Take button of a late-filled tier gives the prize", t2);
  await sleep(300);
  const filledAt = async (left, tiers) => { await p.evaluate(l => { document.querySelector("#passBody .passwrap").scrollLeft = l; }, left); await sleep(1500);
    return p.evaluate(ts => { const w = document.querySelector("#passBody .passwrap"); return ts.every(t => !w.querySelector(`.fcell[data-pc="${t}"]`)); }, tiers); };
  ok(await filledAt(1e6, ["400f", "400p", "395f", "392p"]), "scrolled to the end: the last tiers are complete");
  ok(await filledAt(0, ["1f", "1p", "6f", "8p"]), "scrolled back to the start: the first tiers are complete");
  ok(await filledAt(200 * 126, ["200f", "200p", "197f", "203p"]), "scrolled to the middle: the tiers there are complete");
  const t3 = await p.evaluate(() => { const w = document.querySelector("#passBody .passwrap"); return { far: w.querySelectorAll(".fcell").length, tot: w.querySelectorAll(".ptier").length, bare: [...w.querySelectorAll(".ptier:not(.fcell)")].filter(e => !e.querySelector(".qty")).length }; });
  ok(t3.tot === 800 && t3.bare === 0 && t3.far < t0.far, "every cell that is not an empty frame is complete, and the frames shrink as the player scrolls", t3);

  // 4. Trophy Road: the tick under every second prize sits exactly at the prize's centre (places are read once)
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); go("home"); }); await sleep(300);
  await p.evaluate(() => { profile.tp = 300; profile.roadSeen = 300; save(); });
  const rd = await p.evaluate(async () => { const t = performance.now(); go("roadScr"); const sync = performance.now() - t; await new Promise(r => setTimeout(r, 400));
    const tr = document.getElementById("rdTrack"), nodes = [...tr.querySelectorAll(".rdn")], tk = [...tr.querySelectorAll(".rdtk")];
    const bad = tk.filter((e, i) => Math.abs(parseFloat(e.style.left) - (nodes[i * 2].offsetLeft + nodes[i * 2].offsetWidth / 2)) > 1).length;
    return { sync: Math.round(sync), nodes: nodes.length, ticks: tk.length, bad, walk: !!tr.querySelector(".rdwalk") }; });
  ok(rd.nodes > 100 && rd.ticks === Math.ceil(rd.nodes / 2), "the road has a tick under every second prize", rd);
  ok(rd.bad === 0, "every tick is at its prize's centre", rd);
  ok(rd.walk, "the player's marker is on the road", rd);
  ok(rd.sync < 900, `opening the road is quick (${rd.sync} ms of script on this computer)`, rd);

  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
