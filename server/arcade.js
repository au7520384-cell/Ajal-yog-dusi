"use strict";
// ONLINE ARCADE ROOMS: the server plays the match.  Air hockey and table tennis, two seats.  The phones send where their finger wants the mallet / the racket (`ainp`), the server moves them (the same speed
// limits as on the phone), moves the puck / the ball by the same physics (server/arcadecores.js is cut out of index.html by tools/build_cores.js: ONE copy of the rules and the physics), decides every goal / point and
// the winner, and sends the state to both phones about 30 times a second (`ast`); the phones only draw it.  That is what makes a stake fair: a phone cannot say that it has won.
// A seat that is away pauses the match (the room gives it BROOM_GRACE to come back, then it forfeits: see server.js).
// Coordinates are the table's own: seat 0 plays the left end (x < 0) / the near paddle, seat 1 the right end / the far paddle; a phone of seat 1 turns the picture round (x, z -> -x, -z) so that it too has its own end near.
const CORES = require("./arcadecores.js");
const ARC_GAMES = new Set(["hockey", "tennis"]);
const ARC_TO = {hockey: [3, 5, 7], tennis: [3, 7, 11]}, ARC_DEF = {hockey: 5, tennis: 7};   // the lengths a host may choose (goals / points), and the default
const STEP = 1 / 60, EVERY = 2;   // the match is played in steps of 1/60 s; the state goes out every 2nd step (30 a second)
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const TEST_TO = (process.env.ARC_TO_TEST || "").split(",").map(Number).filter(n => n > 0 && n <= 21);   // (the tests ask for matches of 1 goal / point: ARC_TO_TEST=1,3; never set in production)
function lengthOf(game, want) { const list = (ARC_TO[game] || []).concat(TEST_TO); const n = Number.isInteger(want) ? want : 0; return list.includes(n) ? n : ARC_DEF[game]; }
// a new match: first = the seat that serves / whose end the puck starts at, to = the goals / points that win it
function create(game, first, to) {
  const ev = [], sim = {game, to, ev, acc: 0, last: Date.now(), n: 0, over: null, paused: false, snaps: 0};
  if (game === "hockey") {
    const H = CORES.hockey({
      sfx: (kind, v) => { if (ev.length < 40) ev.push(kind === "horn" ? ["horn"] : [kind, Math.round(v)]); },
      goal: side => { ev.push(["goal", side]); },
      over: () => { sim.over = {winner: H.HK.sc[0] > H.HK.sc[1] ? 0 : 1}; ev.push(["over"]); },
    });
    H.HK.mode = "online"; H.HK.to = to; H.HK.seed = (Math.random() * 1e9 | 0) + 1; H.hkReset(first === 0 || first === 1 ? first : -1);
    sim.core = H; sim.sc = () => H.HK.sc;
    sim.step = dt => H.hkStep(dt);
    sim.input = (seat, m) => { const k = H.HK.ml[seat], x = m.x, z = m.z; if (!k || typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 400 || Math.abs(z) > 400) return false; k.tx = x; k.tz = z; return true; };
    sim.snap = () => { const HK = H.HK, p = HK.pk; return {g: "hockey", s: HK.st, sc: HK.sc.slice(), gf: HK.goalFor, to: HK.to, pk: [r1(p.x), r1(p.z), r1(p.vx), r1(p.vz)], ml: HK.ml.map(m => [r1(m.x), r1(m.z), r1(m.vx), r1(m.vz)]), zt: r2(HK.zoom.t)}; };
  } else if (game === "tennis") {
    const T = CORES.tennis({
      sfx: (kind, v) => { const b = T.TBT.b; if (ev.length < 40) ev.push([kind, Math.round(v), r1(b.x), r1(b.y), r1(b.z)]); },
      point: (winner, why) => { ev.push(["pt", winner, why]); },
      serve: () => { ev.push(["serve", T.TBT.srv]); },
      launch: () => {},
      over: () => { sim.over = {winner: T.TBT.sc[0] > T.TBT.sc[1] ? 0 : 1}; ev.push(["over"]); },
    });
    T.TBT.mode = "online"; T.TBT.to = to; T.TBT.seed = (Math.random() * 1e9 | 0) + 1; T.tbtReset(first === 0 || first === 1 ? first : 0);
    sim.core = T; sim.sc = () => T.TBT.sc;
    sim.step = dt => T.tbtStep(dt);
    sim.input = (seat, m) => { const P = T.TBT.p[seat], z = m.z, y = m.y; if (!P || typeof z !== "number" || typeof y !== "number" || !Number.isFinite(z) || !Number.isFinite(y) || Math.abs(z) > 400 || Math.abs(y) > 400) return false; P.tz = z; P.ty = y; return true; };
    sim.snap = () => { const TB = T.TBT, b = TB.b; return {g: "tennis", s: TB.st, sc: TB.sc.slice(), sv: TB.srv, to: TB.to, la: TB.last, why: TB.why, pb: TB.pointBy, ry: TB.rally, b: [r1(b.x), r1(b.y), r1(b.z), r1(b.vx), r1(b.vy), r1(b.vz)], p: TB.p.map(P => [r1(P.z), r1(P.y), r2(P.tl), r2(P.tp), r2(P.sw), r1(P.sz)])}; };
  } else throw new Error("no such arcade game: " + game);
  sim.points = () => sim.sc()[0] + sim.sc()[1];
  return sim;
}
// advance by the real time that has passed (a stalled server does not run the match in a burst: at most 0.1 s of catching up); `emit(snap)` is called for every 2nd step
function advance(sim, now, emit) {
  if (sim.over) return;
  const dt = Math.min(0.1, Math.max(0, (now - sim.last) / 1000)); sim.last = now; sim.acc += dt;
  while (sim.acc >= STEP && !sim.over) {
    sim.acc -= STEP; sim.step(STEP); sim.n++;
    if (sim.n % EVERY === 0 || sim.over) { const s = sim.snap(); s.n = sim.n; if (sim.ev.length) { s.ev = sim.ev.splice(0, sim.ev.length); } emit(s); }
  }
}
// the whole state (a phone that has just joined or come back); the events are not repeated
function full(sim) { const s = sim.snap(); s.n = sim.n; s.full = 1; return s; }
module.exports = {ARC_GAMES, ARC_TO, ARC_DEF, STEP, lengthOf, create, advance, full};
