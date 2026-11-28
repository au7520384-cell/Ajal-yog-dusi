#!/usr/bin/env node
// Air hockey: do the laws of physics hold?  node tools/test_hockey_physics.js   (B8_ROOT=<repo copy>; about 40 s, one browser, no server)
// The owner (Nov 28): "in the tennis and the hockey too, the physics and the math must work correctly".  Measured on the OLD hockey first (pro_f_hockey.js before this check), these were real defects:
//  - a mallet at its top speed (560 cm/s) was moved in ONE jump per frame and only then was the puck looked at: at 30 fps it jumps 18.7 cm, over a puck that is 7.6 cm across: 40 of 63 test hits did not touch the puck at all (58 of 63 at 20 fps)
//  - the same shot ended 13 cm apart at 30 fps and at 60 fps
//  - the goal slot let in a puck whose edge overlapped the post (a puck 17.4 cm off the middle scored through the post; the slot is 38 cm wide and the puck 7.6 cm), and a puck that hit the corner bounced off a flat wall
//  - a mallet pressed against a puck at the end wall pushed the puck THROUGH the wall: it sat at x = -103.3 (the table ends at -100), under the mallet
//  - the centre of a mallet could reach 1.5 cm from the centre line, i.e. its edge was 5.7 cm in the other half, and the two mallets could overlap
// Here: reflection off the rails (angle and speed), the mallet's impulse (0.9 restitution, a heavy mallet), no tunnelling at 20 - 120 fps, the posts, the same game at every frame rate, a puck pinned at a wall / a rail / a corner stays on the table
// and the mallet is stopped by it, energy never grows with the mallets still, 300 random games stay inside the table and the limits, the mallets stay in their halves and never overlap.
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 900) : ""); } };
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
    await p.evaluate(() => { window.H_fresh = () => { hkOpen({ mode: "local", to: 99 }); HK.tok++; cancelAnimationFrame(HK.raf); hkReset(0); HK.st = "play"; HK.sfxAt = 1e12; HK.seed = 5; };
      window.H_park = () => { for (const [k, x, z] of [[0, -30, -40], [1, 30, 40]]) { const m = HK.ml[k]; m.x = m.tx = x; m.z = m.tz = z; m.vx = m.vz = 0; } }; });
    const R = fn => p.evaluate(fn);

    // ------------------------------------------------------------------ 1) the rail: the angle of reflection, the speed
    const rail = await R(() => { H_fresh(); const r = []; for (const ang of [10, 30, 45, 60, 80]) { HK.pk = { x: 0, z: 30, vx: 300 * Math.cos(ang * Math.PI / 180), vz: 300 * Math.sin(ang * Math.PI / 180) }; const v0 = Math.hypot(HK.pk.vx, HK.pk.vz); for (let i = 0; i < 600 && HK.pk.vz > 0; i++) hkPuck(1 / 240);
      const v = HK.pk; r.push({ ang, after: Math.atan2(-v.vz, v.vx) * 180 / Math.PI, want: Math.atan(0.94 * Math.tan(ang * Math.PI / 180)) * 180 / Math.PI, sp: Math.hypot(v.vx, v.vz), sp0: v0, atRail: HK.pk.z }); } return r; });
    ok(rail.every(r => Math.abs(r.after - r.want) < 1.6 && r.sp <= r.sp0 && r.sp > r.sp0 * 0.9), "a puck bounces off a long rail like a ball off a wall: the angle out follows the angle in (the wall keeps 0.94 of the speed across it, all of the speed along it), and it never leaves with more speed than it came", rail);

    // ------------------------------------------------------------------ 2) the mallet's impulse
    const imp = await R(() => { const r = []; for (const vm of [60, 120, 200, 300, 560]) { H_fresh(); HK.pk = { x: -40, z: 0, vx: 0, vz: 0 }; const m = HK.ml[0]; m.x = -40 - 10.9; m.z = 0; m.vx = vm; m.vz = 0; hkPuck(1 / 240); r.push({ vm, vp: HK.pk.vx, want: Math.min(380, 1.9 * vm) }); }
      // a head-on meeting of a moving puck and a moving mallet: the relative speed is turned round with 0.9 (below the speed limit)
      H_fresh(); HK.pk = { x: -40, z: 0, vx: -80, vz: 0 }; const m = HK.ml[0]; m.x = -40 - 10.9; m.z = 0; m.vx = 50; m.vz = 0; hkPuck(1 / 240); const rel = { before: -80 - 50, after: HK.pk.vx - 50 };
      return { r, rel }; });
    ok(imp.r.every(x => Math.abs(x.vp - x.want) < 2), "a mallet that hits a puck at rest gives it 1.9 x its own speed (restitution 0.9 against a heavy mallet), up to the speed limit of 380 cm/s", imp.r);
    ok(Math.abs(imp.rel.after + 0.9 * imp.rel.before) < 3, "a moving puck meeting a moving mallet: the speed relative to the mallet is turned round and kept at 0.9", imp.rel);

    // ------------------------------------------------------------------ 3) no tunnelling: the left mallet runs at the puck at its top speed, the whole game step, at 20 / 30 / 60 / 120 fps
    const tun = await R(() => { const r = {}; for (const fps of [20, 30, 60, 120]) { let bad = 0, N = 0, ex = null; for (let off = -6; off <= 6; off += 1.5) for (let d0 = 12; d0 <= 30; d0 += 3) { H_fresh(); HK.pk = { x: -20, z: off, vx: 0, vz: 0 }; const m = HK.ml[0]; m.x = -20 - d0; m.z = 0; m.tx = 80; m.tz = 0; m.vx = 0; m.vz = 0; HK.ml[1].x = HK.ml[1].tx = 90; HK.ml[1].z = HK.ml[1].tz = 42;
        for (let i = 0; i < Math.round(fps * 0.22); i++) hkStep(1 / fps); N++; if (Math.hypot(HK.pk.vx, HK.pk.vz) < 100 || HK.pk.vx <= 0) { bad++; if (!ex) ex = { off, d0, vx: +HK.pk.vx.toFixed(0), vz: +HK.pk.vz.toFixed(0) }; } } r[fps] = { bad, N, ex }; } return r; });
    ok(Object.values(tun).every(t => t.bad === 0 && t.N === 63), "a mallet at 560 cm/s always hits a puck in its way (the puck flies forward), at 20, 30, 60 and 120 frames a second: 63 hits each (the mallet used to jump over it)", tun);

    // ------------------------------------------------------------------ 4) the goal slot and its posts
    const posts = await R(() => { const r = []; for (const end of [1, -1]) for (const z of [0, 8, 14.5, 17, 17.4, 19, 20, 22, 30, -14.5, -17.4, -22]) { H_fresh(); H_park(); HK.pk = { x: end * 60, z, vx: end * 300, vz: 0 }; let back = false; for (let i = 0; i < 2400 && HK.st === "play"; i++) { hkPuck(1 / 480); if (HK.pk.vx * end < 0) { back = true; break; } } r.push({ end, z, goal: HK.st === "goal", back }); } return r; });
    const inn = posts.filter(x => Math.abs(x.z) <= 14.5), outt = posts.filter(x => Math.abs(x.z) >= 17);
    ok(inn.every(x => x.goal), "a puck that goes straight at the slot with its whole body between the posts (its centre within 15.2 cm of the middle) is a goal, at both ends", inn);
    ok(outt.every(x => !x.goal && x.back), "a puck whose edge would overlap a post, or that is beside the slot, is NOT a goal: it comes back (the old slot let in a puck 17.4 cm off the middle)", outt);
    const post = await R(() => { H_fresh(); H_park(); HK.pk = { x: 80, z: 17, vx: 300, vz: 0 }; for (let i = 0; i < 400 && HK.pk.vx > 0; i++) hkPuck(1 / 480); return { vx: +HK.pk.vx.toFixed(0), vz: +HK.pk.vz.toFixed(0), st: HK.st }; });
    ok(post.st === "play" && post.vx < 0 && Math.abs(post.vz) > 100, "a puck that clips a post is turned away along the line from the post to its centre (it flies off to the side, toward the middle of the slot's line, not straight back as from a flat wall)", post);

    // ------------------------------------------------------------------ 5) the same game at every frame rate
    const fps = await R(() => { const r = {}; for (const f of [30, 60, 120, 240]) { H_fresh(); HK.pk = { x: -30, z: -20, vx: 250, vz: 160 }; HK.ml[0].tx = -90; HK.ml[1].tx = 90; for (let i = 0; i < f * 2; i++) hkStep(1 / f); r[f] = { x: HK.pk.x, z: HK.pk.z }; } return r; });
    const d30 = Math.hypot(fps[30].x - fps[240].x, fps[30].z - fps[240].z), d60 = Math.hypot(fps[60].x - fps[240].x, fps[60].z - fps[240].z);
    ok(d30 < 1.5 && d60 < 1.5, "a shot with the mallets moving ends at the same place at 30, 60 and 240 frames a second (within 1.5 cm after 2 s; it was 13 cm off at 30 fps)", { d30, d60, fps });

    // ------------------------------------------------------------------ 6) a puck pressed against a wall, a rail, a corner or a post stays on the table and the mallet is stopped by it
    const pin = await R(() => { const r = []; const cases = [["end wall", { x: -90, z: 30 }, { x: -70, z: 30 }, { x: -95, z: 30 }], ["side rail", { x: -50, z: 44 }, { x: -50, z: 25 }, { x: -50, z: 45 }], ["corner", { x: -92, z: 42 }, { x: -70, z: 25 }, { x: -96, z: 45 }], ["post", { x: -94, z: 21 }, { x: -70, z: 15 }, { x: -96, z: 22 }], ["goal mouth", { x: -90, z: 0 }, { x: -70, z: 0 }, { x: -99, z: 0 }]];
      for (const [name, pk, ml, tg] of cases) for (const fps of [30, 60]) { H_fresh(); HK.pk = { x: pk.x, z: pk.z, vx: 0, vz: 0 }; const m = HK.ml[0]; m.x = ml.x; m.z = ml.z; m.tx = tg.x; m.tz = tg.z; let minD = 1e9, maxOut = 0, goal = false;
        for (let i = 0; i < fps * 4 && HK.st === "play"; i++) { hkStep(1 / fps); minD = Math.min(minD, Math.hypot(HK.pk.x - HK.ml[0].x, HK.pk.z - HK.ml[0].z)); maxOut = Math.max(maxOut, Math.abs(HK.pk.z) - 46.2, -HK.pk.x - 96.2 > 0 && Math.abs(HK.pk.z) >= 19 ? -HK.pk.x - 96.2 : 0); }
        r.push({ name, fps, minD: +minD.toFixed(2), maxOut: +maxOut.toFixed(2), st: HK.st, puck: { x: +HK.pk.x.toFixed(1), z: +HK.pk.z.toFixed(1) } }); } return r; });
    ok(pin.every(x => x.maxOut < 0.05), "a mallet pressed against a puck at the end wall / a rail / a corner / a post does not push it through (the puck stays on the table)", pin.filter(x => x.maxOut >= 0.05));
    ok(pin.filter(x => x.name !== "goal mouth").every(x => x.minD > 10.4), "...and the puck stops the mallet: they never overlap", pin.filter(x => x.name !== "goal mouth" && x.minD <= 10.4));

    // ------------------------------------------------------------------ 7) energy: with the mallets still, nothing speeds a puck up
    const en = await R(() => { let worst = 0, n = 0; for (let t = 0; t < 120; t++) { H_fresh(); HK.seed = 100 + t; const a = hkRnd() * 6.2832, v0 = 80 + hkRnd() * 300; HK.pk = { x: (hkRnd() - 0.5) * 100, z: (hkRnd() - 0.5) * 60, vx: v0 * Math.cos(a), vz: v0 * Math.sin(a) }; HK.ml[0].tx = -70; HK.ml[1].tx = 70; let vmax = v0;
      for (let i = 0; i < 60 * 8 && HK.st === "play"; i++) { hkStep(1 / 60); vmax = Math.max(vmax, Math.hypot(HK.pk.vx, HK.pk.vz)); } worst = Math.max(worst, vmax / v0); n++; } return { worst: +worst.toFixed(4), n }; });
    ok(en.worst <= 1.003, "with the mallets still, a puck never leaves a wall, a rail, a post or a mallet faster than it came (120 flights of 8 s)", en);

    // ------------------------------------------------------------------ 8) random games: everything stays inside its limits
    const rnd = await R(() => { const o = { games: 0, off: 0, fast: 0, nan: 0, malletHalf: 0, malletSpeed: 0, overlapMM: 0, puckInMallet: 0, goals: 0, worstIn: 0 };
      for (let g = 0; g < 300; g++) { H_fresh(); HK.seed = 1000 + g; const fps = [30, 45, 60][g % 3]; HK.ml[0].vx = 0; let tt = 0;
        for (let i = 0; i < fps * 20 && HK.st === "play"; i++) { if (i % Math.round(fps / 4) === 0) for (const k of [0, 1]) { const m = HK.ml[k]; m.tx = (hkRnd() - 0.5) * 220; m.tz = (hkRnd() - 0.5) * 120; if (hkRnd() < 0.3) { m.tx = HK.pk.x + (hkRnd() - 0.5) * 30; m.tz = HK.pk.z + (hkRnd() - 0.5) * 30; } }
          const before = HK.ml.map(m => [m.x, m.z]); hkStep(1 / fps); const p = HK.pk;
          if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.vx) || !Number.isFinite(p.vz)) { o.nan++; break; }
          if (HK.st === "play") { if (Math.abs(p.z) > 46.2 + 0.01 || Math.abs(p.x) > 100 + 3.8) o.off++; if (Math.hypot(p.vx, p.vz) > 380.5) o.fast++; }
          for (let k = 0; k < 2; k++) { const m = HK.ml[k]; if (k === 0 ? m.x > -7.7 + 0.01 || m.x < -92.3 - 0.01 : m.x < 7.7 - 0.01 || m.x > 92.3 + 0.01) o.malletHalf++; if (Math.abs(m.z) > 42.8 + 0.01) o.malletHalf++; if (Math.hypot(m.x - before[k][0], m.z - before[k][1]) > 560 / fps + 0.01) o.malletSpeed++; }
          if (Math.hypot(HK.ml[0].x - HK.ml[1].x, HK.ml[0].z - HK.ml[1].z) < 14.4 - 0.01) o.overlapMM++;
          if (HK.st === "play") for (const m of HK.ml) { const d = Math.hypot(p.x - m.x, p.z - m.z); o.worstIn = Math.max(o.worstIn, 11 - d); } }
        if (HK.st === "goal") o.goals++; o.games++; }
      o.worstIn = +o.worstIn.toFixed(2); return o; });
    ok(rnd.games === 300 && rnd.nan === 0 && rnd.off === 0 && rnd.fast === 0, "300 random games of two wild mallets (30 / 45 / 60 fps, 20 s each): the puck stays on the table, never exceeds 380 cm/s, never turns into NaN", rnd);
    ok(rnd.malletHalf === 0 && rnd.malletSpeed === 0 && rnd.overlapMM === 0, "...each mallet stays in its own half (its EDGE does not cross the centre line), never moves faster than 560 cm/s, and the two never overlap", rnd);
    ok(rnd.worstIn < 4.5, "...and a mallet is never deep inside the puck (the worst overlap of the whole run, in cm; a puck squeezed between the two mallets at the centre line is the only way to get any)", rnd);
    ok(rnd.goals >= 10, "...and goals happen in them (the slot is open)", rnd);
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.close(); process.exit(fail ? 1 : 0);
})();
