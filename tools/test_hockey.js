#!/usr/bin/env node
// Air hockey, one phone, no server:  node tools/test_hockey.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 2 minutes)
// The owner (Nov 26): "Aeroxokkey bor, u videodagi oshaniyam qo'shaylik" (a 3D air hockey, Japan vs South Korea, first goal wins). Here the SCREEN and the PHYSICS (pro_f_hockey.js):
//  - the mini-games screen has the Arcade row with the Air hockey card; it opens the list (3 bot levels, two on one phone) and the length of the match (the first goal / 3 / 7)
//  - the table is a plane seen by a camera: a point of the table -> the screen -> the same point (the finger is mapped back), also on the turned page; a finger moves the mallet, which cannot leave its half
//  - the puck bounces off the rails, goes into the goal only through the slot, a mallet hits it with the speed it has; a goal is counted, announced ("... SCORES!"), the lamp lights; the match ends at the goal limit
//  - the bot: its mallet is as fast as its level says, it defends and it attacks; two on one phone: each finger has its own half
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
  const until = async (fn, to = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(120); } return false; };
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: document.getElementById("mText") ? document.getElementById("mText").textContent : "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  const still = p => p.evaluate(() => { HK.tok++; cancelAnimationFrame(HK.raf); });   // (the page's own loop stops: the tests step the physics by hand)
  const sim = (p, secs, fn) => p.evaluate(([secs, fn]) => { const f = fn ? new Function("return " + fn)() : null; const n = Math.round(secs * 60); for (let i = 0; i < n; i++) { if (f) f(i); hkStep(1 / 60); } return { sc: HK.sc.slice(), st: HK.st, pk: { ...HK.pk } }; }, [secs, fn ? String(fn) : null]);
  try {
    // ------------------------------------------------------------------ the way in
    const { p, close } = await open({ width: 915, height: 412 });
    await p.evaluate(() => toMenu("mini")); await sleep(900);
    const row = await p.evaluate(() => { const r = document.getElementById("miniArcade"); return r ? { title: (r.querySelector(".sh-rt") || {}).textContent, cards: [...r.querySelectorAll(".sh-card")].map(c => c.dataset.hk), name: (r.querySelector(".sh-card b") || {}).textContent, img: !!r.querySelector(".sh-card img").src, below: r.getBoundingClientRect().top >= document.getElementById("miniBoards").getBoundingClientRect().bottom - 2 } : null; });
    ok(row && row.title === "Arcade games" && row.cards.join() === "air" && row.name === "Air hockey" && row.img && row.below, "the mini-games screen has the Arcade row (Air hockey), under the Board games picture", row);
    await p.evaluate(() => document.getElementById("mini").scrollTo(0, 99999)); await sleep(400); if (SHOT) await p.screenshot({ path: path.join(SHOT, "00_row.png") });
    await p.evaluate(() => document.querySelector("#miniArcade .sh-card").click()); await sleep(600);
    const list = await p.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => r.dataset.id));
    ok(list.join() === "easy,mid,hard,local", "the card opens the list: three bot levels and two on one phone", list);
    await p.evaluate(() => document.querySelector('#mExtra [data-id="hard"]').click()); await sleep(600);
    const m1 = await modal(p); ok(m1 && /Air hockey/i.test(m1.t) && m1.btns.length === 4 && /First goal wins/.test(m1.btns[0]) && /First to 3/.test(m1.btns[1]) && /First to 7/.test(m1.btns[2]), "then the length of the match: the first goal (as in the video), 3, 7", m1);
    await clickBtn(p, "First goal wins"); await sleep(900);
    const s0 = await p.evaluate(() => ({ on: document.getElementById("hkScr").classList.contains("on"), mode: HK.mode, lv: HK.lv, to: HK.to, sc: HK.sc.join(":"), hud: document.getElementById("hkHud").textContent.replace(/\s+/g, " ") }));
    ok(s0.on && s0.mode === "bot" && s0.lv === "hard" && s0.to === 1 && s0.sc === "0:0" && /0\s*:\s*0/.test(s0.hud) && /First goal wins/.test(s0.hud), "the table opens: against the hard bot, the first goal wins, 0:0", s0);
    const fit = await p.evaluate(() => { const r = document.getElementById("hkWrap").getBoundingClientRect(); return { fits: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, ratio: +(r.width / r.height).toFixed(3) }; });
    ok(fit.fits && Math.abs(fit.ratio - 16 / 9) < 0.02, "the picture fits the screen with its own proportions (16:9)", fit);
    await sleep(1500); if (SHOT) await p.screenshot({ path: path.join(SHOT, "01_table.png") });
    const painted = await p.evaluate(() => { const c = document.getElementById("hkCv"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let blue = 0, red = 0, yellow = 0; for (let i = 0; i < d.length; i += 4 * 7) { const r = d[i], gg = d[i + 1], bb = d[i + 2]; if (bb > 110 && bb > r + 40 && bb > gg + 20) blue++; if (r > 200 && gg < 110 && bb < 120) red++; if (r > 220 && gg > 190 && bb < 120) yellow++; } return { blue, red, yellow }; });
    ok(painted.blue > 3000 && painted.red > 60 && painted.yellow > 20, "the canvas is painted: the blue table, the red lines / mallet, the yellow puck", painted);

    // ------------------------------------------------------------------ the camera and the finger
    const rt = await p.evaluate(() => { let worst = 0; for (const [x, z] of [[-90, -40], [-60, 0], [0, 0], [70, 30], [95, 45], [-30, 45]]) { const s = hkProj(x, 0, z), t = hkUnproj(s[0], s[1]); worst = Math.max(worst, Math.hypot(t.x - x, t.z - z)); } const a = hkProj(-100, 0, -50), b2 = hkProj(100, 0, -50), c = hkProj(-100, 0, 50), d = hkProj(100, 0, 50); return { worst, near: b2[0] - a[0], far: d[0] - c[0], onScreen: [a, b2, c, d].every(q => q[0] >= 0 && q[0] <= 1280 && q[1] >= 0 && q[1] <= 720) }; });
    ok(rt.worst < 0.01 && rt.near > rt.far * 1.15 && rt.onScreen, "a point of the table -> the screen -> the same point (the finger is mapped back); the near side is wider than the far side (perspective); the whole table is on the canvas", rt);
    const scr = (x, z) => p.evaluate(([x, z]) => { const c = hkProj(x, 0, z), m = [...document.querySelectorAll("#hkWrap .hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; }, [x, z]);
    await still(p); await p.evaluate(() => { HK.lv = "easy"; hkReset(0); HK.st = "serve"; });
    let q = await scr(-60, -20); await p.mouse.move(q[0], q[1]); await p.mouse.down(); await sleep(100);
    let tg = await p.evaluate(() => ({ x: HK.ml[0].tx, z: HK.ml[0].tz }));
    ok(Math.abs(tg.x + 60) < 1.5 && Math.abs(tg.z + 20) < 1.5, "a finger on the table puts the mallet's target on that very point (-60, -20)", tg);
    q = await scr(90, 10); await p.mouse.move(q[0], q[1]); await sleep(100); tg = await p.evaluate(() => ({ x: HK.ml[0].tx, z: HK.ml[0].tz }));
    await p.evaluate(() => { for (let i = 0; i < 90; i++) hkStep(1 / 60); }); const mm = await p.evaluate(() => ({ x: HK.ml[0].x, z: HK.ml[0].z }));
    ok(tg.x > 80 && mm.x <= -1.4, "a finger on the other half drags the target there, but the mallet stops at the centre line (it cannot cross)", [tg, mm]); await p.mouse.up();
    const cap = await p.evaluate(() => { hkReset(0); HK.st = "serve"; const m = HK.ml[0]; m.x = -70; m.z = 0; m.tx = -20; m.tz = 40; hkMoveMallets(0.1); return Math.hypot(m.x + 70, m.z); });
    ok(cap <= 56.5 && cap > 50, "a mallet cannot teleport: its speed is limited (560 cm/s: 56 cm in a tenth of a second)", cap);

    // ------------------------------------------------------------------ the puck
    await p.evaluate(() => { window.__s = []; for (const k of ["puck", "wallHit", "horn"]) { const f = Snd[k]; Snd[k] = (...a) => { window.__s.push(k); return f.apply(Snd, a); }; } });
    await p.evaluate(() => { hkOpen({ mode: "local", to: 3 }); HK.tok++; cancelAnimationFrame(HK.raf); HK.ml[0].tx = HK.ml[0].x; HK.ml[0].tz = HK.ml[0].z; HK.ml[1].tx = HK.ml[1].x; HK.ml[1].tz = HK.ml[1].z; });
    let r = await p.evaluate(() => { HK.st = "play"; HK.pk = { x: 0, z: 40, vx: 0, vz: 80 }; for (let i = 0; i < 60; i++) hkStep(1 / 60); return { z: HK.pk.z, vz: HK.pk.vz }; });
    ok(r.z <= 46.3 && r.vz < 0, "the puck bounces off the long rail (it does not leave the table) and comes back", r);
    r = await p.evaluate(() => { HK.st = "play"; HK.pk = { x: -90, z: 40, vx: -200, vz: 0 }; for (let i = 0; i < 40; i++) hkStep(1 / 60); return { st: HK.st, sc: HK.sc.join(":"), vx: HK.pk.vx, x: HK.pk.x }; });
    ok(r.st === "play" && r.sc === "0:0" && r.vx > 0 && r.x >= -96.3, "the end wall outside the goal slot bounces the puck: no goal", r);
    const hit = await p.evaluate(() => { HK.sfxAt = 0; HK.st = "play"; HK.pk = { x: -20, z: 0, vx: 0, vz: 0 }; const m = HK.ml[0]; m.x = -32; m.z = 0; m.tx = -8; m.tz = 0; for (let i = 0; i < 3; i++) hkStep(1 / 60); return { vx: HK.pk.vx, x: HK.pk.x }; });
    ok(hit.vx > 150 && hit.x > -20, "a mallet that moves hits the puck with its own speed: the puck flies away fast", hit);
    const snd = await p.evaluate(() => window.__s.slice()); ok(snd.includes("puck") && snd.includes("wallHit"), "the puck makes a sound on the mallet and on the rail", snd);
    r = await p.evaluate(() => { HK.st = "play"; HK.pk = { x: -90, z: 0, vx: -200, vz: 0 }; HK.ml[0].tx = -70; HK.ml[0].tz = 30; HK.ml[0].x = -70; HK.ml[0].z = 30; for (let i = 0; i < 30; i++) hkStep(1 / 60); return { st: HK.st, sc: HK.sc.join(":"), lamp: HK.lamp.slice(), ban: document.getElementById("hkBan").textContent, banOn: document.getElementById("hkBan").classList.contains("on"), horn: window.__s.filter(x => x === "horn").length }; });
    ok(r.st === "goal" && r.sc === "0:1" && r.lamp[0] === 1 && r.lamp[1] === 0 && /SCORES!$/.test(r.ban) && r.banOn && r.horn === 1, "a puck into the open goal slot is a goal for the other side: 0:1, the lamp over that goal lights, '... SCORES!', one horn", r);
    if (SHOT) { await p.evaluate(() => hkDraw()); await sleep(100); await p.screenshot({ path: path.join(SHOT, "02_goal.png") }); }
    await p.evaluate(() => { for (let i = 0; i < 140; i++) hkStep(1 / 60); }); r = await p.evaluate(() => ({ st: HK.st, pk: { ...HK.pk }, lamp: HK.lamp.slice() }));
    ok(r.st === "serve" && r.pk.x === -50 && r.pk.z === 0 && !r.lamp[0], "after the goal the side that conceded serves (the puck is in its half), the lamp goes out", r);
    // the match ends at the goal limit
    r = await p.evaluate(() => { HK.sc = [0, 2]; HK.st = "play"; HK.pk = { x: -90, z: 0, vx: -200, vz: 0 }; HK.ml[0].x = HK.ml[0].tx = -70; HK.ml[0].z = HK.ml[0].tz = 30; for (let i = 0; i < 30; i++) hkStep(1 / 60); for (let i = 0; i < 140; i++) hkStep(1 / 60); return { st: HK.st, sc: HK.sc.join(":") }; });
    ok(r.st === "over" && r.sc === "0:3", "the third goal ends a match played to 3", r);
    await sleep(1300); const mo = await modal(p); ok(mo && /wins!/i.test(mo.t) && /0 : 3/.test(mo.txt) && mo.btns.length === 2, "the result window: who won, the score, Play again / Menu", mo);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "03_result.png") });
    await clickBtn(p, "Play again"); await sleep(600); ok(await p.evaluate(() => HK.on && HK.sc.join() === "0,0" && HK.to === 3 && HK.mode === "local" && !document.getElementById("modal").classList.contains("on")), "Play again: a new match, the same length, 0:0");

    // ------------------------------------------------------------------ two on one phone: each finger has its own half
    await still(p);
    const two = await p.evaluate(() => { const w = document.getElementById("hkWrap"), pt = (x, z) => { const c = hkProj(x, 0, z), m = [...w.querySelectorAll(".hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; };
      const ev = (type, id, x, z) => { const q = pt(x, z); w.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: q[0], clientY: q[1], bubbles: true, cancelable: true })); };
      ev("pointerdown", 11, -55, -10); ev("pointerdown", 12, 60, 25); ev("pointermove", 11, -40, 5); ev("pointermove", 12, 45, -20);
      const out = { a: [HK.ml[0].tx, HK.ml[0].tz], b: [HK.ml[1].tx, HK.ml[1].tz], map: JSON.stringify(HK.ptr) }; ev("pointerup", 11, 0, 0); ev("pointerup", 12, 0, 0); out.after = JSON.stringify(HK.ptr); return out; });
    ok(Math.abs(two.a[0] + 40) < 1.5 && Math.abs(two.a[1] - 5) < 1.5 && Math.abs(two.b[0] - 45) < 1.5 && Math.abs(two.b[1] + 20) < 1.5 && two.after === "{}", "two fingers: the left half moves the left mallet, the right half the right one, each on its own; lifting both frees them", two);
    await p.evaluate(() => hkClose()); ok(await p.evaluate(() => !document.getElementById("hkScr").classList.contains("on") && !HK.on), "the exit key closes the table");

    // ------------------------------------------------------------------ the bot
    const speed = lv => p.evaluate(lv => { hkOpen({ mode: "bot", lv, to: 99 }); HK.tok++; cancelAnimationFrame(HK.raf); HK.seed = 7; hkReset(1); HK.st = "play"; let top = 0; for (let i = 0; i < 1800; i++) { hkStep(1 / 60); top = Math.max(top, Math.hypot(HK.ml[1].vx, HK.ml[1].vz)); if (HK.st === "goal") { for (let k = 0; k < 130; k++) hkStep(1 / 60); } } return { top, sc: HK.sc.join(":") }; }, lv);
    const se = await speed("easy"), sm = await speed("mid"), sh = await speed("hard");
    ok(se.top <= 170.5 && sm.top <= 290.5 && sh.top <= 430.5 && se.top > 60 && sh.top > sm.top && sm.top > se.top, "the bot's mallet is as fast as its level says (easy 170, mid 290, hard 430 cm/s at most) and moves", [se, sm, sh]);
    ok(sh.sc.split(":")[1] >= 1 || sm.sc.split(":")[1] >= 1, "against an idle human the bot attacks and scores", [se, sm, sh]);
    const def = lv => p.evaluate(lv => { let conceded = 0, n = 12; for (let s = 0; s < n; s++) { hkOpen({ mode: "bot", lv, to: 99 }); HK.tok++; cancelAnimationFrame(HK.raf); HK.seed = 100 + s; hkReset(0); HK.st = "play"; const z0 = -26 + s * 4.5, p0 = HK.pk; p0.x = 10; p0.z = z0; p0.vx = 150; p0.vz = (HKW / 2 > 0 ? -z0 * 0.3 : 0); HK.ml[0].tx = HK.ml[0].x = -70; HK.ml[0].tz = HK.ml[0].z = 0; const before = HK.sc[0]; for (let i = 0; i < 240 && HK.st === "play"; i++) hkStep(1 / 60); if (HK.sc[0] > before) conceded++; } return { conceded, n }; }, lv);
    const dh = await def("hard"), de = await def("easy");
    ok(dh.conceded <= 4 && dh.conceded <= de.conceded, "the bot defends: shots at its goal are blocked, the hard bot better than the easy one", [dh, de]);
    await p.evaluate(() => hkClose()); await close();

    // ------------------------------------------------------------------ the turned page (a portrait phone: the page is turned): the same table, the same fingers
    const R = await open({ width: 412, height: 915 }); const P = R.p;
    await P.evaluate(() => { toMenu("mini"); hkOpen({ mode: "bot", lv: "easy", to: 1 }); HK.tok++; cancelAnimationFrame(HK.raf); hkReset(0); }); await sleep(900);
    const rf = await P.evaluate(() => { const r = document.getElementById("hkWrap").getBoundingClientRect(); return { fits: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, rot: document.documentElement.classList.contains("rot"), w: Math.round(r.width), h: Math.round(r.height) }; });
    ok(rf.fits && rf.rot, "on the turned page the table fits the phone (the page is turned 90 degrees)", rf);
    const scr2 = (x, z) => P.evaluate(([x, z]) => { const c = hkProj(x, 0, z), m = [...document.querySelectorAll("#hkWrap .hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; }, [x, z]);
    for (const [x, z] of [[-60, -20], [-85, 25], [-20, 0]]) { const s = await scr2(x, z); await P.mouse.move(s[0], s[1]); await P.mouse.down(); await sleep(80); const t = await P.evaluate(() => ({ x: HK.ml[0].tx, z: HK.ml[0].tz })); await P.mouse.up(); ok(Math.abs(t.x - x) < 2 && Math.abs(t.z - z) < 2, `the turned page: a finger at the table point (${x}, ${z}) puts the mallet there`, t); }
    await P.evaluate(() => { HK.st = "play"; HK.pk = { x: -10, z: 10, vx: 0, vz: 0 }; hkDraw(); }); if (SHOT) await P.screenshot({ path: path.join(SHOT, "04_turned.png") });
    await R.close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
