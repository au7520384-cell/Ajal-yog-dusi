#!/usr/bin/env node
// Table tennis, one phone, no server:  node tools/test_tennis.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 3 minutes)
// The owner (Nov 26: "Stol tennis qani"): the arcade game after the air hockey (pro_g_tennis.js). Here the SCREEN, the CAMERA, the RULES and the BOT:
//  - the Arcade row has the Table tennis key over the owner's picture (Nov 27); it opens the list (3 bot levels, two on one phone) and the length of the match (3 / 7 / 11 points)
//  - a point of the paddle's plane -> the screen -> the same point (the finger is mapped back, also on the turned page); a finger moves the paddle, which has a speed limit
//  - the flight a hit gives (tbtShot) clears the net and lands on the other half for every ball and every swipe; the ball bounces on the table, is stopped by the net, is hit only after its bounce and only within reach
//  - the rules: a double bounce, a ball on your own half, the net, a ball out, a missed ball are points for the other side; the serve changes every 2 points; the match ends at the limit
//  - the bot: its paddle is as fast as its level says, it returns a serve more often the better it is, an idle human loses to it; two on one phone: each finger has its own paddle
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "", sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
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
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: document.getElementById("mText") ? document.getElementById("mText").textContent : "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  // the page's own loop is stopped: the tests step the game by hand
  const fresh = (p, o) => p.evaluate(o => { tbtOpen(o); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = o.seed || 4242; tbtReset(0); TBT.marks = []; return true; }, o);
  const put = (p, s) => p.evaluate(s => { TBT.sfxAt = 0; TBT.st = "rally"; TBT.plan = null; TBT.net = false; TBT.last = s.last; TBT.bn = s.bn || [0, 0]; Object.assign(TBT.b, { x: 0, y: 30, z: 0, vx: 0, vy: 0, vz: 0 }, s.b); for (const k of [0, 1]) if (s.p && s.p[k]) { const P = TBT.p[k], q = s.p[k]; P.z = P.tz = q[0]; P.y = P.ty = q[1]; P.vz = P.vy = 0; } TBT.sc = s.sc || [0, 0]; return true; }, s);
  const run = (p, secs) => p.evaluate(secs => { const n = Math.round(secs * 120); for (let i = 0; i < n && TBT.st === "rally"; i++) tbtStep(1 / 120); return { st: TBT.st, sc: TBT.sc.slice(), why: TBT.why, last: TBT.last, bn: TBT.bn.slice(), net: TBT.net, b: { ...TBT.b } }; }, secs);
  try {
    // ------------------------------------------------------------------ the way in
    const { p, close } = await open({ width: 915, height: 412 });
    await p.evaluate(() => toMenu("mini")); await sleep(900);
    const row = await p.evaluate(() => { const c = document.querySelector('#miniArcade .sh-pan[data-hk="tt"]'); return c ? { name: c.getAttribute("aria-label"), img: document.querySelector("#miniArcade .sh-ban img").naturalWidth >= 1000 } : null; });
    ok(row && row.name === "Table tennis" && row.img, "the Arcade row has the Table tennis key over the owner's picture", row);
    await p.evaluate(() => document.querySelector('#miniArcade [data-hk="tt"]').scrollIntoView({ block: "center" })); await sleep(400); if (SHOT) await p.screenshot({ path: path.join(SHOT, "00_row.png") });
    await p.evaluate(() => document.querySelector('#miniArcade [data-hk="tt"]').click()); await sleep(600);
    const list = await p.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => r.dataset.id));
    ok(list.join() === "easy,mid,hard,local", "the key opens the list: three bot levels and two on one phone", list);
    await p.evaluate(() => document.querySelector('#mExtra [data-id="mid"]').click()); await sleep(600);
    const m1 = await modal(p); ok(m1 && /Table tennis/i.test(m1.t) && m1.btns.length === 4 && /First to 3 points/.test(m1.btns[0]) && /First to 7 points/.test(m1.btns[1]) && /First to 11 points/.test(m1.btns[2]), "then the length of the match: 3, 7 or 11 points", m1);
    await clickBtn(p, "First to 7 points"); await sleep(900);
    const s0 = await p.evaluate(() => ({ on: document.getElementById("tbScr").classList.contains("on"), mode: TBT.mode, lv: TBT.lv, to: TBT.to, sc: TBT.sc.join(":"), hud: document.getElementById("tbHud").textContent.replace(/\s+/g, " "), srv: TBT.st }));
    ok(s0.on && s0.mode === "bot" && s0.lv === "mid" && s0.to === 7 && s0.sc === "0:0" && /First to 7 points/.test(s0.hud) && /TABLE TENNIS/.test(s0.hud), "the table opens: against the mid bot, first to 7, 0:0", s0);
    const fit = await p.evaluate(() => { const r = document.getElementById("tbWrap").getBoundingClientRect(); return { fits: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, ratio: +(r.width / r.height).toFixed(3) }; });
    ok(fit.fits && Math.abs(fit.ratio - 16 / 9) < 0.02, "the picture fits the screen with its own proportions (16:9)", fit);
    await sleep(1800); if (SHOT) await p.screenshot({ path: path.join(SHOT, "01_table.png") });
    const painted = await p.evaluate(() => { const c = document.getElementById("tbCv"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let blue = 0, red = 0, white = 0; for (let i = 0; i < d.length; i += 4 * 7) { const r = d[i], gg = d[i + 1], bb = d[i + 2]; if (bb > 140 && bb > r + 60 && bb > gg + 30) blue++; if (r > 190 && gg < 110 && bb < 120) red++; if (r > 215 && gg > 215 && bb > 215) white++; } return { blue, red, white }; });
    ok(painted.blue > 4000 && painted.red > 150 && painted.white > 60, "the canvas is painted: the blue table, my red paddle, the white lines and net", painted);

    // ------------------------------------------------------------------ the camera and the finger
    await fresh(p, { mode: "bot", lv: "easy", to: 7 });
    const rt = await p.evaluate(() => { let worst = 0; for (const [z, y] of [[-95, 5], [0, 32], [95, 78], [40, 12], [-60, 60]]) { const s = tbtProj(-TBT_XP, y, z), t = tbtUnprojPlane(s[0], s[1], -TBT_XP); worst = Math.max(worst, Math.hypot(t.z - z, t.y - y)); } for (const [z, y] of [[-50, 20], [60, 70]]) { const s = tbtProj(TBT_XP, y, z), t = tbtUnprojPlane(s[0], s[1], TBT_XP); worst = Math.max(worst, Math.hypot(t.z - z, t.y - y)); }
      const nearW = tbtProj(-137, 0, 76)[0] - tbtProj(-137, 0, -76)[0], farW = tbtProj(137, 0, 76)[0] - tbtProj(137, 0, -76)[0], all = [[-137, 0, -76], [137, 0, 76], [-TBT_XP, 0, -100], [-TBT_XP, 80, 100], [TBT_XP, 88, 0], [0, 20, 80]].map(q => tbtProj(...q));
      return { worst, nearW, farW, onScreen: all.every(q => q[0] >= 0 && q[0] <= 1280 && q[1] >= 0 && q[1] <= 720), farUp: tbtProj(137, 0, 0)[1] < tbtProj(-137, 0, 0)[1] }; });
    ok(rt.worst < 0.01 && rt.nearW > rt.farW * 1.3 && rt.onScreen && rt.farUp, "a point of a paddle's plane -> the screen -> the same point (the finger is mapped back); the near end is wider than the far end (perspective); the table and both planes are on the canvas", rt);
    const scr = (x, y, z) => p.evaluate(([x, y, z]) => { const c = tbtProj(x, y, z), m = [...document.querySelectorAll("#tbWrap .hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; }, [x, y, z]);
    for (const [z, y] of [[-70, 20], [55, 60], [0, 35]]) { const q = await scr(-162, y, z); await p.mouse.move(q[0], q[1]); await p.mouse.down(); await sleep(80); const t = await p.evaluate(() => ({ z: TBT.p[0].tz, y: TBT.p[0].ty })); await p.mouse.up(); ok(Math.abs(t.z - z) < 1.5 && Math.abs(t.y - y) < 1.5, `a finger on the paddle plane at (z ${z}, height ${y}) puts the paddle's target there`, t); }
    let q = await scr(-162, 20, 0); await p.mouse.move(q[0], q[1]); await p.mouse.down(); q = await scr(-162, 75, 95); await p.mouse.move(q[0], q[1]); await sleep(80);
    const cap = await p.evaluate(() => { TBT.p[0].z = -100; TBT.p[0].y = 20; TBT.p[0].tz = 100; TBT.p[0].ty = 20; tbtMovePaddles(0.1); return Math.hypot(TBT.p[0].z + 100, TBT.p[0].y - 20); }); await p.mouse.up();
    ok(cap <= 130.5 && cap > 120, "a paddle cannot teleport: its speed is limited (1300 cm/s: 130 cm in a tenth of a second)", cap);
    const lim = await p.evaluate(() => { TBT.p[0].tz = 400; TBT.p[0].ty = -50; for (let i = 0; i < 60; i++) tbtMovePaddles(1 / 60); return { z: TBT.p[0].z, y: TBT.p[0].y }; });
    ok(lim.z <= 100.01 && lim.y >= 2.99, "the paddle stays in its reach (|z| <= 100, height >= 3)", lim);

    // ------------------------------------------------------------------ the flight a hit gives: it must clear the net and land on the other half, for every ball and every swipe
    const shots = await p.evaluate(() => { let bad = [], n = 0; TBT.seed = 99; for (let i = 0; i < 400; i++) { const k = i % 2, hx = (k === 0 ? -1 : 1) * TBT_XP, hy = 4 + tbtRnd() * 60, hz = (tbtRnd() - 0.5) * 190, xt = 36 + tbtRnd() * 84, zt = (tbtRnd() - 0.5) * 130, ha = TBT_N + TBT_R + 8 + tbtRnd() * 50, v = tbtShot(k, hx, hy, hz, xt, zt, ha);
        // fly it: it must be above the net at x = 0 and its first bounce must be on the other half, inside the table
        let x = hx, y = hy, z = hz, vx = v.vx, vy = v.vy, vz = v.vz, over = null, land = null; const h = 1 / 480; n++;
        for (let t = 0; t < 4 && !land; t += h) { const px = x; vy -= TBT_G * h; x += vx * h; y += vy * h; z += vz * h; if (((px < 0 && x >= 0) || (px > 0 && x <= 0)) && over === null) over = y; if (y <= TBT_R && vy < 0) land = { x, z }; }
        const side = k === 0 ? 1 : -1; if (!(over !== null && over > TBT_N + TBT_R + 0.5 && land && land.x * side > 0 && Math.abs(land.x) < TBT_L / 2 && Math.abs(land.z) < TBT_W / 2)) bad.push({ k, hy: +hy.toFixed(1), hz: +hz.toFixed(0), xt: +xt.toFixed(0), zt: +zt.toFixed(0), over, land }); }
      return { n, bad: bad.length, first: bad[0] || null }; });
    ok(shots.n === 400 && shots.bad === 0, "every one of 400 hits (both sides, any height 4-64, any lateral spot, any depth and aim) clears the net and lands inside the other half", shots);

    // ------------------------------------------------------------------ the ball, the net, the rules
    await fresh(p, { mode: "bot", lv: "mid", to: 7 });
    await p.evaluate(() => { window.__s = []; for (const k of ["paddle", "tbounce", "netHit"]) { const f = Snd[k]; Snd[k] = (...a) => { window.__s.push(k); return f.apply(Snd, a); }; } });
    let r = await put(p, { last: 0, bn: [0, 0], b: { x: 60, y: 40, z: 0 }, p: { 1: [0, 70] } }) && await run(p, 1.2);
    ok(r.st === "point" && r.sc.join() === "1,0" && r.why === "double", "a ball that bounces twice on the other half (it was not returned) is a point for the one who hit it", r);
    r = await put(p, { last: 0, bn: [0, 0], b: { x: -60, y: 30, z: 0 } }) && await run(p, 1);
    ok(r.st === "point" && r.sc.join() === "0,1" && r.why === "own", "a ball that falls on the hitter's own half is a point for the other side", r);
    r = await put(p, { last: 0, bn: [0, 0], b: { x: -30, y: 8, z: 0, vx: 300 } }) && await run(p, 1.5);
    ok(r.st === "point" && r.sc.join() === "0,1" && r.why === "net" && r.net, "a ball stopped by the net falls back on the hitter's side: a point for the other side ('Net')", r);
    ok(await p.evaluate(() => window.__s.includes("netHit")), "the net has its own sound");
    r = await put(p, { last: 0, bn: [0, 0], b: { x: 0, y: 40, z: 60, vx: 100, vz: 300 } }) && await run(p, 2);
    ok(r.st === "point" && r.sc.join() === "0,1" && r.why === "out", "a ball that flies off the side of the table without landing on it: out, a point for the other side", r);
    r = await put(p, { last: 0, bn: [0, 1], b: { x: 100, y: 25, z: 0, vx: 300 }, p: { 1: [90, 70] } }) && await run(p, 2);
    ok(r.st === "point" && r.sc.join() === "1,0" && r.why === "miss", "a ball that bounced on the other half and was not returned: a point for the one who hit it ('Missed')", r);
    // a hit
    r = await put(p, { last: 1, bn: [1, 0], b: { x: -140, y: 20, z: 10, vx: -300 }, p: { 0: [12, 19] } }) && await p.evaluate(() => { for (let i = 0; i < 20; i++) tbtStep(1 / 120); return { last: TBT.last, vx: TBT.b.vx, bn: TBT.bn.slice(), st: TBT.st, snd: window.__s.filter(x => x === "paddle").length }; });
    ok(r.last === 0 && r.vx > 100 && r.st === "rally" && r.snd >= 1, "the ball that has bounced once on my half and comes within reach of my paddle is hit: it goes back toward the other end (with a sound)", r);
    r = await p.evaluate(() => { for (let i = 0; i < 480 && TBT.st === "rally" && TBT.last === 0 && TBT.bn[1] === 0; i++) tbtStep(1 / 240); return { st: TBT.st, last: TBT.last, bn: TBT.bn.slice(), net: TBT.net, x: +TBT.b.x.toFixed(0) }; });
    ok(r.st === "rally" && r.last === 0 && r.bn[1] === 1 && r.bn[0] === 0 && r.x > 0, "...it clears the net and lands on the other half (and the point goes on)", r);
    r = await put(p, { last: 1, bn: [0, 0], b: { x: -100, y: 60, z: 0, vx: -300 }, p: { 0: [0, 43] } }) && await p.evaluate(() => { for (let i = 0; i < 70; i++) tbtStep(1 / 120); return { last: TBT.last, x: TBT.b.x }; });
    ok(r.last === 1 && r.x < -162, "a ball that has not bounced on my half is NOT hit (there is no volley): it passes the paddle", r);
    r = await run(p, 2); ok(r.st === "point" && r.sc.join() === "1,0" && r.why === "out", "...and, never having landed on my half, it is out: a point for me", r);
    r = await put(p, { last: 1, bn: [1, 0], b: { x: -140, y: 20, z: 0, vx: -300 }, p: { 0: [40, 19] } }) && await run(p, 2);
    ok(r.st === "point" && r.sc.join() === "0,1" && r.why === "miss", "a paddle too far from the ball (40 cm) does not touch it: a point for the other side", r);
    // 80 balls, 80 hits: every hit is a legal return, whatever the paddle does
    const rets = await p.evaluate(() => { let bad = [], n = 0; for (let i = 0; i < 80; i++) { TBT.seed = 700 + i; tbtReset(0); TBT.st = "rally"; TBT.sc = [0, 0]; TBT.plan = null; TBT.net = false; TBT.last = 1; TBT.bn = [1, 0];
        const y = 8 + tbtRnd() * 42, z = (tbtRnd() - 0.5) * 150; Object.assign(TBT.b, { x: -150, y, z, vx: -260 - tbtRnd() * 200, vy: (tbtRnd() - 0.5) * 80, vz: (tbtRnd() - 0.5) * 120 });
        const P = TBT.p[0]; P.z = P.tz = z + (tbtRnd() - 0.5) * 20; P.y = P.ty = y + (tbtRnd() - 0.5) * 14; P.vz = (tbtRnd() - 0.5) * 1600; P.vy = (tbtRnd() - 0.5) * 1000;
        for (let k = 0; k < 600 && TBT.st === "rally" && TBT.last === 1; k++) tbtStep(1 / 240); if (TBT.last !== 0) continue; n++;
        for (let k = 0; k < 960 && TBT.st === "rally" && TBT.bn[1] === 0; k++) tbtStep(1 / 240); if (!(TBT.st === "rally" && TBT.bn[1] === 1)) bad.push({ i, st: TBT.st, why: TBT.why }); }
      return { n, bad: bad.length, first: bad[0] || null }; });
    ok(rets.n >= 60 && rets.bad === 0, "80 different balls hit with 80 different swipes: every hit that connects is a legal return (over the net, on the other half)", rets);

    // ------------------------------------------------------------------ the serve and the match
    const sv = await p.evaluate(() => { const o = []; for (const sc of [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3]]) { TBT.first = 0; TBT.sc = sc.slice(); tbtServe(); o.push(TBT.srv); } TBT.first = 1; TBT.sc = [0, 0]; tbtServe(); o.push(TBT.srv); return o; });
    ok(sv.join() === "0,0,1,1,0,0,1,1", "the serve changes every 2 points (and the first server is the one who was drawn)", sv);
    r = await p.evaluate(() => { TBT.to = 3; TBT.sc = [2, 0]; TBT.st = "rally"; TBT.pointBy = -1; TBT.last = 0; TBT.bn = [0, 1]; tbtPoint(0, "miss"); const a = TBT.st; for (let i = 0; i < 300 && TBT.st === "point"; i++) tbtStep(1 / 60); return { a, st: TBT.st, sc: TBT.sc.join() }; });
    ok(r.a === "point" && r.st === "over" && r.sc === "3,0", "the point that reaches the limit ends the match", r);
    await sleep(1300); const mo = await modal(p); ok(mo && /VICTORY/i.test(mo.t) && /3 : 0/.test(mo.txt) && mo.btns.length === 2, "the result window: victory, the score, Play again / Menu", mo);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, "02_result.png") });
    await clickBtn(p, "Play again"); await sleep(500); ok(await p.evaluate(() => TBT.on && TBT.sc.join() === "0,0" && TBT.to === 3 && TBT.mode === "bot" && !document.getElementById("modal").classList.contains("on")), "Play again: a new match, the same length, 0:0");
    ok(await p.evaluate(() => { const b = document.getElementById("tbBan"); return !!b; }), "(the banner of a point exists)");

    // ------------------------------------------------------------------ the bot
    const spd = lv => p.evaluate(lv => { tbtOpen({ mode: "bot", lv, to: 99 }); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = 11; tbtReset(1); let top = 0, pts = 0; for (let i = 0; i < 3600; i++) { tbtStep(1 / 60); top = Math.max(top, Math.hypot(TBT.p[1].vz, TBT.p[1].vy)); } return { top, pts: TBT.sc.join() }; }, lv);
    const se = await spd("easy"), sm = await spd("mid"), sh = await spd("hard");
    ok(se.top <= 330 * 1.01 && sm.top <= 540 * 1.01 && sh.top <= 840 * 1.01 && se.top > 100 && sh.top > sm.top && sm.top > se.top, "the bot's paddle is as fast as its level says (easy 330, mid 540, hard 840 cm/s at most) and it moves", [se, sm, sh]);
    const ret = lv => p.evaluate(lv => { let back = 0, N = 30; for (let i = 0; i < N; i++) { tbtOpen({ mode: "bot", lv, to: 99 }); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = 1000 + i * 7; tbtReset(0); TBT.first = 0; TBT.sc = [0, 0]; tbtServe(); for (let k = 0; k < 600 && TBT.st !== "point" && TBT.rally < 1; k++) tbtStep(1 / 60); if (TBT.rally >= 1) back++; } return { back, N }; }, lv);
    const re = await ret("easy"), rm = await ret("mid"), rh = await ret("hard");
    ok(rh.back >= 26 && rm.back >= 22 && re.back >= 15 && rh.back > re.back && rm.back > re.back - 1, "the bot returns my serve: hard almost always, mid mostly, easy less often", [re, rm, rh]);
    const idle = lv => p.evaluate(lv => { let won = 0, over = 0; const N = 10; for (let g = 1; g <= N; g++) { tbtOpen({ mode: "bot", lv, to: 5 }); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = 31 * g; tbtReset(0); for (let i = 0; i < 60 * 240 && TBT.st !== "over"; i++) tbtStep(1 / 60); if (TBT.st === "over") over++; if (TBT.sc[0] > TBT.sc[1]) won++; } return { won, over, N }; }, lv);
    const ie = await idle("easy"), im = await idle("mid"), ih = await idle("hard");
    ok(ie.over === 10 && im.over === 10 && ih.over === 10 && ie.won <= 3 && im.won === 0 && ih.won === 0, "a human who does not move loses to the bot (the easy bot can lose a match to its own missed serves, 3 in 10 at most; mid and hard never)", [ie, im, ih]);
    const oracle = lv => p.evaluate(lv => { let w = 0, rallyMax = 0, N = 4; for (let g = 0; g < N; g++) { tbtOpen({ mode: "bot", lv, to: 5 }); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = 50 + g * 13; tbtReset(g % 2); for (let i = 0; i < 60 * 400 && TBT.st !== "over"; i++) { if (TBT.last === 1 && TBT.b.vx < 0 && TBT.st === "rally") { const pr = tbtSim(TBT.b, -TBT_XP, -1); if (pr) { TBT.p[0].tz = pr.z; TBT.p[0].ty = pr.y; } } rallyMax = Math.max(rallyMax, TBT.rally); tbtStep(1 / 60); } if (TBT.sc[0] > TBT.sc[1]) w++; } return { w, N, rallyMax }; }, lv);
    const oe = await oracle("easy"), oh = await oracle("hard");
    ok(oe.w >= 3 && oe.rallyMax >= 4 && oh.rallyMax >= 4, "a human who goes where the ring says beats the easy bot, and long rallies happen even with the hard one", [oe, oh]);
    const guide = await p.evaluate(() => { const o = {}; for (const lv of ["easy", "hard"]) { tbtOpen({ mode: "bot", lv, to: 99 }); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = 77; tbtReset(0); let seen = 0; for (let i = 0; i < 60 * 12; i++) { tbtStep(1 / 60); if (TBT.guide) seen++; } o[lv] = seen; } return o; });
    ok(guide.easy > 10 && guide.hard === 0, "the ring that shows where the ball comes is there on easy (and mid) and not on hard", guide);
    await p.evaluate(() => tbtClose()); ok(await p.evaluate(() => !document.getElementById("tbScr").classList.contains("on") && !TBT.on), "the exit closes the table");

    // ------------------------------------------------------------------ two on one phone, then the turned page
    await p.evaluate(() => { tbtOpen({ mode: "local", to: 3 }); TBT.tok++; cancelAnimationFrame(TBT.raf); });
    const two = await p.evaluate(() => { const w = document.getElementById("tbWrap"), pt = (x, y, z) => { const c = tbtProj(x, y, z), m = [...w.querySelectorAll(".hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; };
      const ev = (type, id, x, y, z) => { const q = pt(x, y, z); w.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: q[0], clientY: q[1], bubbles: true, cancelable: true })); };
      ev("pointerdown", 21, -162, 30, -40); ev("pointerdown", 22, 162, 50, 30); ev("pointermove", 21, -162, 45, -20); ev("pointermove", 22, 162, 35, 55);
      const out = { a: [TBT.p[0].tz, TBT.p[0].ty], b: [TBT.p[1].tz, TBT.p[1].ty], map: JSON.stringify(TBT.ptr) }; ev("pointerup", 21, 0, 0, 0); ev("pointerup", 22, 0, 0, 0); out.after = JSON.stringify(TBT.ptr); return out; });
    ok(Math.abs(two.a[0] + 20) < 1.5 && Math.abs(two.a[1] - 45) < 1.5 && Math.abs(two.b[0] - 55) < 1.5 && Math.abs(two.b[1] - 35) < 1.5 && two.after === "{}", "two fingers: the one low on the screen moves my paddle, the one high on the screen the far paddle, each on its own", two);
    await p.evaluate(() => tbtClose()); await close();
    const R = await open({ width: 412, height: 915 }); const P = R.p;
    await P.evaluate(() => { toMenu("mini"); tbtOpen({ mode: "bot", lv: "easy", to: 7 }); TBT.tok++; cancelAnimationFrame(TBT.raf); tbtReset(0); }); await sleep(900);
    const rf = await P.evaluate(() => { const r = document.getElementById("tbWrap").getBoundingClientRect(); return { fits: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, rot: document.documentElement.classList.contains("rot") }; });
    ok(rf.fits && rf.rot, "on the turned page (a portrait phone, the page turned 90 degrees) the table fits the phone", rf);
    const scr2 = (x, y, z) => P.evaluate(([x, y, z]) => { const c = tbtProj(x, y, z), m = [...document.querySelectorAll("#tbWrap .hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; }, [x, y, z]);
    for (const [z, y] of [[-60, 20], [70, 55], [0, 35]]) { const s = await scr2(-162, y, z); await P.mouse.move(s[0], s[1]); await P.mouse.down(); await sleep(80); const t = await P.evaluate(() => ({ z: TBT.p[0].tz, y: TBT.p[0].ty })); await P.mouse.up(); ok(Math.abs(t.z - z) < 2 && Math.abs(t.y - y) < 2, `the turned page: a finger at (z ${z}, height ${y}) puts the paddle's target there`, t); }
    await P.evaluate(() => { TBT.st = "rally"; TBT.last = 1; TBT.bn = [1, 0]; TBT.b = { x: -60, y: 25, z: 20, vx: -200, vy: 40, vz: -30 }; tbtDraw(); }); if (SHOT) await P.screenshot({ path: path.join(SHOT, "03_turned.png") });
    await R.close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
