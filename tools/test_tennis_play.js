#!/usr/bin/env node
// Table tennis: does the SWING steer the ball, can a short ball be returned, is a human given time?  node tools/test_tennis_play.js   (B8_ROOT=<repo copy>; about 1.5 minutes, one browser, no server)
// The owner (Nov 28): "in tennis there are many errors: if I swing the racket to the left it only stands straight and goes back and forth, and to the right the same; it must be like real table tennis;
// the ball passes by itself".  What was measured on the OLD model first (a perfect player never missed a legal ball, so it was not a missed hit):
//  - the aim used the paddle's speed in the ONE frame of the contact: a finger that rests under the ring (the usual way to play) gives 0, so every return went back straight, slow and short
//  - a short ball bounced twice before it came to the paddle's plane (the plane is 25 cm behind the table end), so it was "a double bounce" the player could not touch
//  - the bots sent balls that crossed in 0.45 s (hard) with no ring: no time to answer
//  - my serve was automatic (the ball went by itself)
// What is checked here (pro_g_tennis.js): the swing (the strongest swipe of the last 0.16 s) aims and powers the return, the side of the racket the ball touches steers it, the ball is met anywhere in a tube
// in front of the paddle's plane, my serve is a swipe (and still happens by itself after 3.6 s), the face of the racket turns toward the swing, the bots' balls leave a human time to answer, a perfect player never loses a legal ball,
// a human-like player (reaction 0.2-0.32 s, a noisy aim, a finger of 1000 cm/s) returns what the bots send, and a REAL finger (pointer events) swiped through the ball steers it.
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 300)));
  await p.addInitScript(() => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.toast = () => {}; });
  await sleep(1500);
  try {
    // helpers that live in the page: open a stopped game, play a contact with a swing, find where a ball lands
    await p.evaluate(() => {
      window.T_fresh = (o, seed) => { tbtOpen(o); TBT.tok++; cancelAnimationFrame(TBT.raf); TBT.seed = seed || 4242; tbtReset(0); TBT.marks = []; TBT.sfxAt = 0; };
      window.T_land = bb => { let x = bb.x, y = bb.y, z = bb.z, vx = bb.vx, vy = bb.vy, vz = bb.vz, apex = y; for (let i = 0; i < 4000; i++) { vy -= TBT_G / 480; x += vx / 480; y += vy / 480; z += vz / 480; apex = Math.max(apex, y); if (y <= TBT_R && vy < 0) return { x, z, apex, speed: Math.hypot(bb.vx, bb.vy, bb.vz) }; } return null; };
      // a slow ball (bounced once on my half) enters the tube in front of my paddle after te seconds; the finger sweeps with (sz, sy) cm/s through the ball's line during [from, until] (default: until the ball is there) and then rests;
      // the swing goes through the real tbtMovePaddles. Returns the first hit: where it was, where the ball lands, how fast and how high it flies
      window.T_contact = o => {
        T_fresh({ mode: "bot", lv: o.lv || "mid", to: 99 }, 7); TBT.st = "rally"; TBT.plan = null; TBT.net = false; TBT.last = 1; TBT.bn = [1, 0]; TBT.sc = [0, 0];
        const P = TBT.p[0], dt = 1 / 120, te = o.te || 0.2, vx = -250, y0 = 22, yE = o.by === undefined ? 30 : o.by, vy = (yE - y0 + 380 * te * te) / te;
        Object.assign(TBT.b, { x: -(TBT_XP - TBT_RX) + 0 - vx * te + 0, y: y0, z: o.bz || 0, vx, vy, vz: 0 });   // enters the tube (56 cm in front of the plane) at te
        const sz = o.sz || 0, sy = o.sy || 0, from = o.from || 0, until = o.until === undefined ? te + 0.05 : o.until, move = o.sweep !== false && (sz || sy);
        // the finger is at its start so that it is at (pz, py) when the sweep ends or when the ball comes
        const endAt = Math.min(until, te); P.z = P.tz = (o.pz || 0) - (move ? sz * (endAt - from) : 0); P.y = P.ty = (o.py === undefined ? 30 : o.py) - (move ? sy * (endAt - from) : 0);
        let t = 0, hit = null;
        while (t < 1.2 && TBT.st === "rally") {
          if (move && t >= from && t < until) { P.tz += sz * dt; P.ty += sy * dt; }
          tbtStep(dt); t += dt; if (TBT.last === 0) { hit = { t, ball: { ...TBT.b }, tl: TBT.p[0].tl }; break; }
        }
        if (!hit) return { hit: false, st: TBT.st, why: TBT.why, t: +t.toFixed(2) };
        const land = T_land(hit.ball); return { hit: true, t: +hit.t.toFixed(3), land: land && { x: +land.x.toFixed(1), z: +land.z.toFixed(1), apex: +land.apex.toFixed(1), speed: +land.speed.toFixed(0) }, tl: +hit.tl.toFixed(2), ball: { x: +hit.ball.x.toFixed(1), y: +hit.ball.y.toFixed(1), z: +hit.ball.z.toFixed(1) } };
      };
    });
    const C = o => p.evaluate(o => T_contact(o), o);

    // ------------------------------------------------------------------ 1) the swing aims the ball, its speed is the power
    const L = {}; for (const v of [-500, -300, -150, 0, 150, 300, 500]) L[v] = await C({ sz: v });
    ok(Object.values(L).every(r => r.hit && r.land), "a ball that comes within reach of a moving racket is hit every time", L);
    ok(L[-500].land.z <= -50 && L[500].land.z >= 50, "a strong swipe to the left sends the ball to the left side, to the right to the right (the corners of the table)", [L[-500].land, L[500].land]);
    ok(L[-300].land.z < -30 && L[300].land.z > 30 && L[-150].land.z < -12 && L[150].land.z > 12, "a medium swipe steers it clearly, a small one a little", [L[-300].land.z, L[300].land.z, L[-150].land.z, L[150].land.z]);
    ok(Math.abs(L[0].land.z) <= 6, "a racket that only waits under the ball sends it straight back", L[0].land);
    ok(L[-500].land.z < L[-300].land.z && L[-300].land.z < L[-150].land.z && L[-150].land.z < L[0].land.z && L[0].land.z < L[150].land.z && L[150].land.z < L[300].land.z && L[300].land.z < L[500].land.z, "the more it is swiped to a side, the further to that side the ball goes (steadily, no jump)", Object.entries(L).map(([k, r]) => [k, r.land.z]));
    ok(Math.abs(L[-300].land.z + L[300].land.z) < 6, "left and right are the same (the table has no favourite side)", [L[-300].land.z, L[300].land.z]);
    ok(L[500].land.x > L[0].land.x + 30 && L[500].land.speed > L[0].land.speed * 1.4, "a hard swipe sends the ball deeper and faster than a rest (the speed of the swipe is the power)", [L[0].land, L[500].land]);
    const up = await C({ sz: 0, sy: 450 }), dn = await C({ sz: 0, sy: -450 });
    ok(up.hit && dn.hit && up.land.apex < dn.land.apex - 5 && up.land.speed > dn.land.speed, "a swipe upward gives a flatter, faster ball (top spin), a swipe downward a higher, slower one (a chop)", [up.land, dn.land]);

    // ------------------------------------------------------------------ 2) the swing is the strongest swipe of the last 0.16 s: a flick that ends just before the ball comes still steers it
    const late = await C({ sz: -500, from: 0.1, until: 0.2, te: 0.3 });   // the finger stops at 0.2 s, the ball comes at 0.3 s
    const stale = await C({ sz: -500, from: 0.0, until: 0.12, te: 0.5 });   // the swipe ended 0.38 s before the ball: forgotten
    ok(late.hit && late.land.z < -20, "a flick of the finger that ended 0.1 s before the ball came still steers it", late);
    ok(stale.hit && Math.abs(stale.land.z) < 12, "a swipe that was over long before the ball came is forgotten", stale);

    // ------------------------------------------------------------------ 3) where on the racket the ball touches
    const offR = await C({ sweep: false, pz: 0, bz: 11 }), offL = await C({ sweep: false, pz: 0, bz: -11 });
    ok(offR.hit && offL.hit && offR.land.z >= 8 && offL.land.z <= -8 && Math.abs(offR.land.z + offL.land.z) < 5, "the side of the racket the ball touches steers it: the right side sends it right, the left side left", [offR.land, offL.land]);

    // ------------------------------------------------------------------ 4) the tube: a short, slow ball is met before its second bounce
    const sh = await p.evaluate(() => {
      const run = (rx, ry) => { T_fresh({ mode: "bot", lv: "hard", to: 99 }, 9); TBT.st = "rally"; TBT.plan = null; TBT.net = false; TBT.last = 1; TBT.bn = [1, 0]; TBT.sc = [0, 0];
        Object.assign(TBT.b, { x: -70, y: 10, z: 0, vx: -120, vy: 150, vz: 0 }); const P = TBT.p[0]; P.z = P.tz = rx; P.y = P.ty = ry;
        for (let i = 0; i < 600 && TBT.st === "rally" && TBT.last === 1; i++) tbtStep(1 / 240); return { last: TBT.last, st: TBT.st, why: TBT.why, bn: TBT.bn.slice(), x: +TBT.b.x.toFixed(0) }; };
      return { near: run(0, 21), far: run(50, 21) };
    });
    ok(sh.near.last === 0 && sh.near.st === "rally", "a slow ball that would bounce a second time before it reaches the paddle's plane is returned if the racket is there (the old plane could not)", sh);
    ok(sh.far.st === "point" && sh.far.why === "double", "...and if the racket is far from it, it is the double bounce (a point for the other side), as the rules say", sh.far);

    // ------------------------------------------------------------------ 5) the serve is a swipe
    const sv = await p.evaluate(() => {
      const o = {}; T_fresh({ mode: "bot", lv: "mid", to: 99 }, 5); TBT.first = 0; TBT.sc = [0, 0]; tbtServe(); const P = TBT.p[0];
      o.human = TBT.humanServe; o.state = TBT.st; o.hintOn = document.getElementById("tbHint").classList.contains("on"); o.hintText = document.getElementById("tbHint").textContent;
      for (let i = 0; i < 60 * 3; i++) tbtStep(1 / 60); o.stillWaiting = TBT.st === "serve";   // 3 s without a swipe: the ball waits
      for (let i = 0; i < 60 * 1; i++) tbtStep(1 / 60); o.byItself = TBT.st === "rally" && TBT.last === 0;   // after 3.6 s it is served for him
      // a swipe to the left serves toward the left
      T_fresh({ mode: "bot", lv: "mid", to: 99 }, 5); TBT.first = 0; TBT.sc = [0, 0]; tbtServe(); const Q = TBT.p[0]; Q.z = Q.tz = 20; for (let i = 0; i < 40; i++) tbtStep(1 / 60);   // 0.67 s
      for (let i = 0; i < 30 && TBT.st === "serve"; i++) { Q.tz -= 8; tbtStep(1 / 60); } o.swiped = TBT.st === "rally" && TBT.last === 0; const l = T_land(TBT.b); o.land = l && { x: +l.x.toFixed(0), z: +l.z.toFixed(0) };
      o.aimHint = /Swipe the racket at the ball/.test(document.getElementById("tbHint").textContent) && document.getElementById("tbHint").classList.contains("on");
      // a swipe at the very start is not taken for a serve (it belongs to the last point)
      T_fresh({ mode: "bot", lv: "mid", to: 99 }, 5); TBT.first = 0; TBT.sc = [0, 0]; tbtServe(); const R = TBT.p[0]; for (let i = 0; i < 6; i++) { R.tz -= 10; tbtStep(1 / 60); } o.earlyIgnored = TBT.st === "serve";
      // the bot serves by itself
      T_fresh({ mode: "bot", lv: "mid", to: 99 }, 5); TBT.first = 1; TBT.sc = [0, 0]; tbtServe(); o.botHuman = TBT.humanServe; for (let i = 0; i < 100; i++) tbtStep(1 / 60); o.botServed = TBT.st === "rally" && TBT.last === 1 || TBT.rally > 0 || TBT.st === "point";
      // two on one phone: the far player serves with his own swipe
      T_fresh({ mode: "local", to: 99 }, 5); TBT.first = 1; TBT.sc = [0, 0]; tbtServe(); const F = TBT.p[1]; o.localHuman = TBT.humanServe; for (let i = 0; i < 40; i++) tbtStep(1 / 60); for (let i = 0; i < 30 && TBT.st === "serve"; i++) { F.tz += 8; tbtStep(1 / 60); } o.farServed = TBT.st === "rally" && TBT.last === 1; const lf = T_land(TBT.b); o.farLand = lf && { x: +lf.x.toFixed(0), z: +lf.z.toFixed(0) };
      return o;
    });
    ok(sv.human && sv.state === "serve" && sv.hintOn && /Swipe the racket to serve/.test(sv.hintText), "my serve waits for a swipe and says so", sv);
    ok(sv.stillWaiting && sv.byItself, "...it waits for 3.6 s and then the ball is served for me (the match never stalls)", sv);
    ok(sv.swiped && sv.land && sv.land.x > 20 && sv.land.z < -20, "a swipe to the left serves the ball to the left side of the other half", sv);
    ok(sv.aimHint, "after the serve the hint says what the swipe does: the ball goes the way you swipe", sv);
    ok(sv.earlyIgnored, "a swipe in the first moments after a point is not taken for the serve", sv);
    ok(sv.botHuman === false && sv.botServed, "the bot serves by itself", sv);
    ok(sv.localHuman && sv.farServed && sv.farLand && sv.farLand.x < -20 && sv.farLand.z > 20, "two on one phone: the far player serves with his own swipe, to the side he swipes", sv);

    // ------------------------------------------------------------------ 6) the face of the racket turns toward the swing
    const face = await p.evaluate(() => {
      T_fresh({ mode: "bot", lv: "mid", to: 99 }, 3); TBT.st = "rally"; TBT.last = 0; const P = TBT.p[0]; P.z = P.tz = 0; P.y = P.ty = 30; const o = {};
      for (let i = 0; i < 12; i++) { P.tz += 7; tbtMovePaddles(1 / 60); } o.right = +P.tl.toFixed(2);
      for (let i = 0; i < 40; i++) tbtMovePaddles(1 / 60); o.restR = +P.tl.toFixed(2);
      for (let i = 0; i < 12; i++) { P.tz -= 7; tbtMovePaddles(1 / 60); } o.left = +P.tl.toFixed(2);
      for (let i = 0; i < 30; i++) tbtMovePaddles(1 / 60);   // (a rest: the last swipe is forgotten after 0.16 s)
      for (let i = 0; i < 12; i++) { P.ty += 6; tbtMovePaddles(1 / 60); } o.nodUp = +P.tp.toFixed(2);
      for (let i = 0; i < 26; i++) { P.ty -= 6; tbtMovePaddles(1 / 60); } o.nodDown = +P.tp.toFixed(2);
      // the drawn head is narrower when the face is turned (it looks to the side): the face's across-axis seen from the camera
      const wd = tl => { P.tl = tl; P.tp = 0; P.hold = 1; return Math.abs(tbtFace(P, 0).e2[2]); }; o.narrow = +wd(1).toFixed(2); o.wide = +wd(0).toFixed(2); P.tl = 0; P.hold = 0;
      let drew = true; try { for (const tl of [-1, 0, 1]) { P.tl = tl; P.tp = tl * 0.7; P.hold = 1; tbtDraw(); } } catch (e) { drew = String(e); } o.drew = drew; P.tl = P.tp = 0; P.hold = 0; return o;
    });
    ok(face.right >= 0.5 && face.left <= -0.5 && Math.abs(face.restR) < 0.15, "the racket's face turns to the side it is swiped and comes back when it rests", face);
    ok(face.nodUp < -0.3 && face.nodDown > 0.3, "it nods forward when brushed up and back when brushed down", face);
    ok(face.drew === true && face.narrow < face.wide, "a turned racket is drawn (no error)", face);
    const hitFace = await C({ sz: -450 }); ok(hitFace.hit && hitFace.tl < -0.4, "at the hit the face is turned to where the ball is sent", hitFace);

    // ------------------------------------------------------------------ 7) the aim mark on the other half follows the swipe (easy / mid)
    const mk = await p.evaluate(() => {
      T_fresh({ mode: "bot", lv: "mid", to: 99 }, 12); TBT.st = "rally"; TBT.last = 1; TBT.bn = [1, 0]; TBT.net = false; TBT.plan = null; Object.assign(TBT.b, { x: -60, y: 30, z: 0, vx: -420, vy: 20, vz: 0 }); const P = TBT.p[0]; P.z = P.tz = 0; P.y = P.ty = 26;
      tbtStep(1 / 240); const a = TBT.aimMk && { ...TBT.aimMk }; P.pkZ = -500; P.pkM = 500; P.pkT = 1; P.sz = -500; tbtStep(1 / 240); const b2 = TBT.aimMk && { ...TBT.aimMk };
      return { rest: a, left: b2, guide: !!TBT.guide };
    });
    ok(mk.guide && mk.rest && mk.left && mk.left.z < mk.rest.z - 30 && mk.left.x > mk.rest.x, "the mark on the other half (where the ball would land) moves to the side of a swipe and further for a hard one", mk);

    // ------------------------------------------------------------------ 8) time to answer: how long a human has between the bot's hit and the ball at his plane
    const tm = await p.evaluate(() => {
      const o = {}; for (const lv of ["easy", "mid", "hard"]) { T_fresh({ mode: "bot", lv, to: 99999 }, 99); let hits = 0, tmin = 9, steps = 0;
        while (hits < 150 && steps < 300000) { steps++; if (TBT.st === "rally" && TBT.last === 1 && TBT.b.vx < 0) { const pr = tbtSim(TBT.b, -TBT_XP, -1); if (pr) { TBT.p[0].tz = pr.z; TBT.p[0].ty = pr.y; } }
          const last0 = TBT.last; tbtStep(1 / 60); if (TBT.st === "rally" && TBT.last === 1 && last0 !== 1) { hits++; const pr = tbtSim(TBT.b, -TBT_XP, -1); if (pr) tmin = Math.min(tmin, pr.t); } if (TBT.st === "over") break; }
        o[lv] = { hits, tmin: +tmin.toFixed(3) }; } return o; });
    ok(tm.easy.hits >= 100 && tm.easy.tmin >= 0.62 && tm.mid.tmin >= 0.53 && tm.hard.tmin >= 0.48, "a human has at least 0.62 s (easy), 0.53 s (mid), 0.48 s (hard) between the bot's hit and the ball at his racket (it was 0.55 / 0.49 / 0.45 s, with no cap on the bots' speed)", tm);

    // ------------------------------------------------------------------ 9) a perfect player never loses a legal ball; a human-like one returns what the bots send
    const play = await p.evaluate(() => {
      let rs = 12345; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }, gauss = () => { let a = 0; for (let i = 0; i < 6; i++) a += rnd(); return (a - 3) / 0.7071; };
      const game = (lv, human, N) => {
        T_fresh({ mode: "bot", lv, to: 99999 }, 4242); const st = { balls: 0, returned: 0, my: 0, bot: 0 }; let steps = 0, react = 0, tgt = null; const fin = { z: 0, y: 32 };
        while (st.balls < N && steps < 600000) { steps++; const dt = 1 / 60, P = TBT.p[0];
          if (TBT.st === "serve" && TBT.srv === 0 && TBT.stT < 3.6 - 0.6 && P.pkM < 100) fin.z = P.z + 40;   // a swipe serves
          if (tgt && TBT.t >= react) { fin.z = tgt.z; fin.y = tgt.y; }
          { const dz = fin.z - P.tz, dy = fin.y - P.ty, d = Math.hypot(dz, dy), cap = (human ? 1000 : 3000) * dt; if (d > cap) { P.tz += dz * cap / d; P.ty += dy * cap / d; } else { P.tz = fin.z; P.ty = fin.y; } }
          const s0 = TBT.st, l0 = TBT.last; tbtStep(dt);
          if (TBT.st === "rally" && TBT.last === 1 && l0 !== 1) { st.balls++; const pr = tbtSim(TBT.b, -TBT_XP, -1); react = TBT.t + (human ? 0.2 + rnd() * 0.12 : 0); tgt = pr ? { z: pr.z + (human ? gauss() * (lv === "hard" ? 12 : 6) : 0), y: pr.y + (human ? gauss() * (lv === "hard" ? 9 : 5) : 0) } : null; }   // (a new ball: the bot has just hit it)
          if (s0 === "rally" && TBT.last === 0 && l0 === 1) st.returned++;
          if (s0 === "rally" && TBT.st === "point") { if (TBT.pointBy === 0) st.my++; else st.bot++; tgt = null; }
          if (TBT.st === "over") break; }
        st.rate = +(st.returned / Math.max(1, st.balls)).toFixed(2); return st; };
      return { perfect: { easy: game("easy", false, 120), mid: game("mid", false, 120), hard: game("hard", false, 120) }, human: { easy: game("easy", true, 150), mid: game("mid", true, 150), hard: game("hard", true, 150) } };
    });
    ok(["easy", "mid", "hard"].every(l => play.perfect[l].balls >= 100 && play.perfect[l].bot === 0), "a perfect player (goes exactly where the ball will be) never loses a point to a missed legal ball, at any level", play.perfect);
    ok(play.human.easy.rate >= 0.95 && play.human.mid.rate >= 0.95 && play.human.hard.rate >= 0.7, "a human-like player (answers after 0.2-0.32 s, a finger of 1000 cm/s, an aim off by a few cm; no ring on hard) returns what the bots send: easy and mid almost every ball, hard most of them", play.human);

    // ------------------------------------------------------------------ 10) the whole chain with a REAL finger: pointer events swiped through the ball
    const fin = await p.evaluate(() => {
      const run = dir => {
        T_fresh({ mode: "bot", lv: "mid", to: 99 }, 21); TBT.st = "rally"; TBT.plan = null; TBT.net = false; TBT.last = 1; TBT.bn = [1, 0]; TBT.sc = [0, 0];
        Object.assign(TBT.b, { x: -60, y: 27, z: 0, vx: -200, vy: 120, vz: 0 }); const w = document.getElementById("tbWrap"), P = TBT.p[0];
        const pt = (y, z) => { const c = tbtProj(-TBT_XP, y, z), m = [...w.querySelectorAll(".hk-m")].map(i => i.getBoundingClientRect()); return [m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top)]; };
        const ev = (type, y, z) => { const q = pt(y, z); w.dispatchEvent(new PointerEvent(type, { pointerId: 31, clientX: q[0], clientY: q[1], bubbles: true, cancelable: true })); };
        ev("pointerdown", 27, -dir * 45); for (let i = 0; i < 8; i++) tbtStep(1 / 60);   // the finger rests at one side, then sweeps through the ball's line (z 0) to the other: about 450 cm/s
        let hitAt = null; for (let i = 0; i < 40 && TBT.last === 1; i++) { ev("pointermove", 27, -dir * 45 + dir * 7.5 * (i + 1)); tbtStep(1 / 60); if (TBT.last === 0) hitAt = i; }
        ev("pointerup", 0, 0); const l = TBT.last === 0 ? T_land(TBT.b) : null; return { hit: TBT.last === 0, at: hitAt, land: l && { x: +l.x.toFixed(0), z: +l.z.toFixed(0) } };
      };
      return { right: run(1), left: run(-1) };
    });
    ok(fin.right.hit && fin.right.land && fin.right.land.z > 25 && fin.right.land.x > 20, "a real finger swiped to the right through the ball sends it to the right", fin);
    ok(fin.left.hit && fin.left.land && fin.left.land.z < -25 && fin.left.land.x > 20, "...and swiped to the left, to the left", fin);

    // ------------------------------------------------------------------ 11) whatever the swipe, every return that connects is legal (over the net, on the other half)
    const fz = await p.evaluate(() => { let bad = [], n = 0; for (let i = 0; i < 160; i++) { T_fresh({ mode: "bot", lv: ["easy", "mid", "hard"][i % 3], to: 99 }, 900 + i); TBT.st = "rally"; TBT.plan = null; TBT.net = false; TBT.last = 1; TBT.bn = [1, 0]; TBT.sc = [0, 0];
        const y = 8 + tbtRnd() * 42, z = (tbtRnd() - 0.5) * 150; Object.assign(TBT.b, { x: -TBT_XP + 20 + tbtRnd() * 50, y, z, vx: -200 - tbtRnd() * 380, vy: (tbtRnd() - 0.5) * 120, vz: (tbtRnd() - 0.5) * 140 });
        const P = TBT.p[0]; P.z = P.tz = z + (tbtRnd() - 0.5) * 20; P.y = P.ty = y + (tbtRnd() - 0.5) * 14; const sz = (tbtRnd() - 0.5) * 1800, sy = (tbtRnd() - 0.5) * 1100;
        for (let k = 0; k < 480 && TBT.st === "rally" && TBT.last === 1; k++) { P.tz += sz / 240; P.ty += sy / 240; tbtStep(1 / 240); } if (TBT.last !== 0) continue; n++;
        for (let k = 0; k < 960 && TBT.st === "rally" && TBT.bn[1] === 0; k++) tbtStep(1 / 240); if (!(TBT.st === "rally" && TBT.bn[1] === 1)) bad.push({ i, st: TBT.st, why: TBT.why }); }
      return { n, bad: bad.length, first: bad[0] || null }; });
    ok(fz.n >= 120 && fz.bad === 0, "160 random balls with random swipes: every hit that connects is a legal return (clears the net, lands on the other half)", fz);
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
