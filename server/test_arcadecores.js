#!/usr/bin/env node
// The server's copy of the arcade games:  node server/test_arcadecores.js   (a few seconds, no server, no browser)
// server/arcadecores.js is cut out of index.html by tools/build_cores.js (the blocks HK_CORE and TBT_CORE): the phone and the server must play by the SAME physics and rules, so the file must be exactly what the page says.
// It must also run on its own (no DOM): a puck and a ball move, goals and points are counted, a match ends at its limit, and server/arcade.js sends the state 30 times per second of game time.
const fs = require("fs"), path = require("path");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const { buildArcade } = require(path.join(ROOT, "tools", "build_cores.js")), have = fs.readFileSync(path.join(ROOT, "server", "arcadecores.js"), "utf8");
ok(buildArcade() === have, "server/arcadecores.js is exactly what index.html says (if not: run  node tools/build_cores.js  and commit the file)");
ok(!/\b(document|window|localStorage|performance\.now)\b/.test(have.replace(/\/\/[^\n]*/g, "")), "the cores do not touch the page (no document / window / localStorage / performance.now)");
const A = require(path.join(ROOT, "server", "arcade.js"));
ok(A.lengthOf("hockey", 3) === 3 && A.lengthOf("hockey", 7) === 7 && A.lengthOf("hockey", 4) === 5 && A.lengthOf("tennis", 11) === 11 && A.lengthOf("tennis", 5) === 7 && A.lengthOf("tennis", "7") === 7 && A.lengthOf("tennis", 0) === 7, "the lengths a host may choose: hockey 3 / 5 / 7 goals, tennis 3 / 7 / 11 points; anything else is the default");
// hockey: random wild mallets for 5 minutes of game time at 30 fps: no NaN, the puck on the table, goals and the end of a match
{ const sim = A.create("hockey", 0, 3), seen = { goal: 0, hit: 0, wall: 0, horn: 0, over: 0 }, snaps = []; let bad = 0, t = 0, rs = 7; const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 60 * 300 && !sim.over; i++) { if (i % 20 === 0) for (const k of [0, 1]) sim.input(k, { x: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 100 }); t += 1000 / 60; A.advance(sim, sim.last + 1000 / 60, s => snaps.push(s)); }
  for (const s of snaps) { for (const e of s.ev || []) seen[e[0]] = (seen[e[0]] || 0) + 1; const p = s.pk; if (!p.every(Number.isFinite) || Math.abs(p[1]) > 47 || Math.abs(p[0]) > 104) bad++; }
  ok(bad === 0, "hockey: 5 minutes of wild mallets, the state is always a number and the puck on the table", bad);
  ok(seen.goal >= 1 && seen.hit > 10 && seen.wall > 10 && seen.horn >= 1, "hockey: hits, walls, goals and the horn are events of the state", seen);
  ok(sim.over && (sim.over.winner === 0 || sim.over.winner === 1) && Math.max(...sim.sc()) === 3 && seen.over === 1, "hockey: the match ends when a side has 3 goals, once", [sim.over, sim.sc(), seen.over]);
  ok(snaps.length > 30 && snaps.every(s => s.g === "hockey" && s.ml.length === 2) && Math.abs(snaps.length - sim.n / 2) <= 1, "hockey: a state goes out every 2nd step (30 a second)", [snaps.length, sim.n]); }
// the inputs: a word, null, a huge number, NaN and an unknown seat are refused
{ const sim = A.create("hockey", 0, 3); ok(sim.input(0, { x: -50, z: 10 }) && !sim.input(0, { x: "5", z: 1 }) && !sim.input(0, { x: null, z: 1 }) && !sim.input(0, { x: 1e9, z: 0 }) && !sim.input(0, { x: NaN, z: 0 }) && !sim.input(2, { x: 0, z: 0 }) && !sim.input(0, {}), "hockey: only two finite numbers are a finger"); }
{ const sim = A.create("tennis", 0, 3); ok(sim.input(1, { z: 20, y: 30 }) && !sim.input(1, { z: "1", y: 1 }) && !sim.input(1, { z: null, y: 1 }) && !sim.input(1, { z: 1e9, y: 0 }) && !sim.input(5, { z: 0, y: 0 }), "tennis: only two finite numbers are a finger"); }
// tennis: two waving racquets for 5 minutes: points, the end of a match, no NaN
{ const sim = A.create("tennis", 1, 3), seen = {}, snaps = []; let bad = 0, i = 0;
  while (i < 60 * 600 && !sim.over) { if (i % 6 === 0) for (const k of [0, 1]) sim.input(k, { z: ((i / 6 + k) % 2 ? 1 : -1) * 70, y: 30 }); i++; A.advance(sim, sim.last + 1000 / 60, s => snaps.push(s)); }
  for (const s of snaps) { for (const e of s.ev || []) seen[e[0]] = (seen[e[0]] || 0) + 1; if (!s.b.every(Number.isFinite) || !s.p.every(p => p.every(Number.isFinite))) bad++; }
  ok(bad === 0, "tennis: the state is always a number", bad);
  ok(seen.paddle > 3 && seen.bounce > 3 && seen.point >= 3 && seen.serve >= 1, "tennis: paddle, bounce, point and serve are events of the state", seen);
  ok(sim.over && Math.max(...sim.sc()) === 3 && seen.over === 1, "tennis: the match ends when a side has 3 points, once", [sim.over, sim.sc()]);
  ok(snaps.length > 30 && Math.abs(snaps.length - sim.n / 2) <= 1, "tennis: a state goes out every 2nd step", [snaps.length, sim.n]); }
// a stalled server does not run the match in a burst: at most 0.1 s of catching up
{ const sim = A.create("hockey", 0, 3); sim.last = 1000; const out = []; A.advance(sim, 61000, s => out.push(s)); ok(sim.n <= 7 && out.length <= 4, "a minute of stall is 0.1 s of game", [sim.n, out.length]); }
console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
