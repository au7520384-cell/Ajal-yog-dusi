#!/usr/bin/env node
// The rules and the bot of shashka (Russian draughts), on their own (no browser):  node tools/test_shashka.js   (about 40 s)
// The core sits in index.html between /*SH_CORE_BEGIN*/ and /*SH_CORE_END*/ (the PRO block) and has no page code: this loads that text and plays with it.
//  - the start position, the first moves (perft 7 / 49 / 302 / 1469, the same numbers as every 8x8 draughts without captures yet)
//  - compulsory capture (also backwards by a man), a route is played to its end, a flying king takes from a distance and must land where it can go on, a piece is not jumped twice (Turkish strike),
//    a man that reaches the far row in the middle of a capture goes on as a king, promotion at the end of a step, the side that cannot move loses, the draws
//  - the bot: legal moves on every level from many positions, it takes a win in one, bot against bot games end, and a stronger level beats a weaker one
const fs = require("fs"), path = require("path");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const i = src.indexOf("/*SH_CORE_BEGIN*/"), j = src.indexOf("/*SH_CORE_END*/");
if (i < 0 || j < i) { console.log("FAIL: the shashka core is not in index.html"); process.exit(1); }
const core = src.slice(i, j);
const SH = new Function(core + "; return {shStart, shGen, shApply, shNew, shPlay, shFind, shKey, shPerft, shCount, shBot, shEval, SH_LV};")();
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const S = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]);   // "a1" is the bottom left, a dark cell
const name = s => "abcdefgh"[s & 7] + (8 - (s >> 3));
const board = (w, W, b, B) => { const x = new Int8Array(64); for (const a of w || []) x[S(a)] = 1; for (const a of W || []) x[S(a)] = 2; for (const a of b || []) x[S(a)] = -1; for (const a of B || []) x[S(a)] = -2; return x; };
const routes = (b, side) => SH.shGen(b, side).map(m => m.path.map(name).join("-")).sort();
const t0 = Date.now();

// ---------------------------------------------------------------- the start
const G0 = SH.shNew(), c0 = SH.shCount(G0.b);
ok(c0.w === 12 && c0.b === 12 && G0.side === 1 && !G0.over, "12 + 12 pieces, White to move");
ok(Array.from(G0.b).every((p, k) => !p || ((k >> 3) + (k & 7)) % 2 === 1), "only dark cells are used");
ok(S("a1") === 56 && (7 + 0) % 2 === 1, "a1 is a dark cell at the bottom left");
ok(routes(G0.b, 1).join() === ["a3-b4", "c3-b4", "c3-d4", "e3-d4", "e3-f4", "g3-f4", "g3-h4"].sort().join(), "the seven first moves of White", routes(G0.b, 1));
const per = [1, 2, 3, 4].map(d => SH.shPerft(G0.b, 1, d));
ok(per.join() === "7,49,302,1469", "perft 1..4 = 7, 49, 302, 1469", per);

// ---------------------------------------------------------------- captures
let b = board(["c3"], [], ["d4"], []);
ok(routes(b, 1).join() === "c3-e5", "a capture is compulsory: the only move is the jump", routes(b, 1));
b = board(["c3", "h2"], [], ["d4"], []);
ok(routes(b, 1).join() === "c3-e5", "...even when another piece could just step", routes(b, 1));
b = board(["d4"], [], ["c3"], []);
ok(routes(b, 1).join() === "d4-b2", "a man captures backwards as well", routes(b, 1));
b = board(["a1"], [], ["b2", "d4", "f6"], []);   // a1 x b2 -> c3 x d4 -> e5 x f6 -> g7
ok(routes(b, 1).join() === "a1-c3-e5-g7", "a route is played to its end (no stopping half way)", routes(b, 1));
b = board(["c3"], [], ["d4", "d6", "f6"], []);   // c3xd4->e5, then e5xd6->c7 or e5xf6->g7
ok(routes(b, 1).join() === ["c3-e5-c7", "c3-e5-g7"].sort().join(), "two ways to go on: both are legal moves", routes(b, 1));
// a piece is not taken twice (it stays on the board until the route is over): a ring of four black men around the cells
b = board(["a1"], [], ["b2", "d2", "d4", "b4"], []);   // a1xb2->c3, c3xd2->e1, c3xd4->e5, c3xb4->a5; from e1: xd2 is used
const rs = routes(b, 1); ok(rs.length >= 3 && rs.every(r => r.split("-").length <= 4), "no piece is jumped twice in one route", rs);

// ---------------------------------------------------------------- kings
b = board([], ["a1"], ["d4"], []);
ok(routes(b, 1).join() === ["a1-e5", "a1-f6", "a1-g7", "a1-h8"].sort().join(), "a flying king takes from a distance and may land on any free cell behind", routes(b, 1));
b = board([], ["a1"], ["d4", "g5"], []);   // after taking d4 the king can land on e5 / f6 / g7(no): from f6 it can take g5 (h4 free)? g5 is on f6-g5-h4
const kr = routes(b, 1); ok(kr.every(r => r.split("-").length === 3) && kr.length >= 1, "a king that can go on from some landing cell must land there", kr);
b = board([], ["a1"], ["b2", "f6"], []);   // blocked: b2 then c3.. d4.. e5 free, f6 black with g7 free -> capture both? a1xb2 -> lands c3..e5; from e5 takes f6 -> g7/h8
ok(routes(b, 1).every(r => r.startsWith("a1-") && r.split("-").length === 3), "a king takes both pieces on the diagonal in one route", routes(b, 1));
b = board([], ["d4"], [], []);
ok(SH.shGen(b, 1).length === 13, "a lone king on d4 has 13 moves", SH.shGen(b, 1).length);

// ---------------------------------------------------------------- promotion
b = board(["c7"], [], [], []);
const mv = SH.shGen(b, 1).find(m => m.path[1] === S("b8")), after = SH.shApply(b, mv);
ok(mv && after[S("b8")] === 2, "a man reaching the far row by a step becomes a king", after[S("b8")]);
b = board(["f6"], [], ["g7", "d6"], []);   // f6 x g7 -> h8 (the far row): a capture that ends on the far row makes a king
const pm = SH.shGen(b, 1); ok(pm.length >= 1 && pm.every(m => m.caps.length >= 1) && SH.shApply(b, pm[0])[S("h8")] === 2, "a capture that ends on the far row makes a king", pm.map(m => m.path.map(name).join("-")));
b = board(["g6"], [], ["f7", "d7"], []);   // g6 x f7 -> e8 (the far row: a king); then, as a king, e8 x d7 -> c6 / b5 / a4
const pr = SH.shGen(b, 1), prs = pr.map(m => m.path.map(name).join("-"));
ok(prs.length >= 1 && prs.every(r => r.startsWith("g6-e8-")) && SH.shApply(b, pr[0])[pr[0].path[pr[0].path.length - 1]] === 2, "a man that reaches the far row in the middle of a capture goes on as a king (and stays one)", prs);

// ---------------------------------------------------------------- the end of a game
const G1 = { b: board(["c3"], [], ["d4"], []), side: 1, ply: 0, noProg: 0, seen: {}, moves: [], over: null };
SH.shPlay(G1, SH.shGen(G1.b, 1)[0]);
ok(G1.over && G1.over.winner === 1 && G1.over.why === "stuck", "the side that cannot move (no pieces) loses", G1.over);
const bR = board([], ["a1"], [], ["h2"]), G2 = { b: bR, side: 1, ply: 0, noProg: 0, seen: { [SH.shKey(bR, 1)]: 1 }, moves: [], over: null };
const dance = ["b2", "g1", "a1", "h2"]; let rep = 0;   // the kings step to and fro and never meet
for (let k = 0; k < 12 && !G2.over; k++) { const pick = SH.shGen(G2.b, G2.side).find(x => name(x.path[1]) === dance[k % 4]); if (!pick) break; SH.shPlay(G2, pick); rep++; }
ok(G2.over && G2.over.winner === 0 && G2.over.why === "repeat" && rep === 8, "the same position three times is a draw", { over: G2.over, rep });
const G3 = { b: board([], ["a1"], [], ["h8"]), side: 1, ply: 0, noProg: 29, seen: {}, moves: [], over: null };
SH.shPlay(G3, SH.shGen(G3.b, 1).find(x => name(x.path[1]) === "b2")); ok(G3.over && G3.over.why === "kings", "30 half-moves of kings only without a capture: a draw", G3.over);
const G4 = SH.shNew(); ok(SH.shFind(G4, [S("c3"), S("d4")]) && !SH.shFind(G4, [S("c3"), S("e5")]), "a move that came over the wire is found among the legal ones, an illegal one is not");

// ---------------------------------------------------------------- the bot
let illegal = 0, played = 0;
for (const lv of ["easy", "mid", "hard"]) for (let g = 0; g < 4; g++) {
  const G = SH.shNew();
  for (let k = 0; k < 400 && !G.over; k++) {
    const r = Math.random() < 0.6 ? SH.shGen(G.b, G.side)[Math.random() * SH.shGen(G.b, G.side).length | 0] : SH.shBot(G, lv);   // (a mix of random and bot moves: many different positions)
    if (!r || !SH.shFind(G, r.path)) { illegal++; break; } SH.shPlay(G, r); played++;
    if (k % 7 === 3 && !G.over) { const m = SH.shBot(G, lv); if (!m || !SH.shFind(G, m.path)) illegal++; }
  }
}
ok(illegal === 0 && played > 200, `the bot always plays a legal move (${played} positions, 3 levels)`, { illegal, played });
b = board(["c3"], [], ["d4"], []); const wb = SH.shBot({ b, side: 1 }, "hard"); ok(wb && wb.path.join() === [S("c3"), S("e5")].join(), "the bot takes a win in one");
b = board(["c3", "g3"], [], ["d4", "h8"], []);   // two moves are possible: a capture is compulsory, the bot plays it
ok(SH.shBot({ b, side: 1 }, "easy").caps.length === 1, "compulsory capture also for the bot");
function duel(a, bb, n) {   // a plays White in even games; returns [wins of a, wins of bb, draws]
  let wa = 0, wb2 = 0, d = 0;
  for (let g = 0; g < n; g++) {
    const G = SH.shNew(), aw = g % 2 === 0;
    for (let k = 0; k < 200 && !G.over; k++) { const lv = (G.side > 0) === aw ? a : bb; const m = SH.shBot(G, lv); if (!m) break; SH.shPlay(G, m); }
    if (!G.over || G.over.winner === 0) d++; else if ((G.over.winner > 0) === aw) wa++; else wb2++;
  }
  return [wa, wb2, d];
}
const ee = duel("mid", "easy", 6); ok(ee[0] > ee[1], "the middle level beats the easy one (mid / easy / draws)", ee);
const mh = duel("hard", "mid", 2); ok(mh[0] >= mh[1], "the hard level is not worse than the middle one (hard / mid / draws)", mh);
console.log(`pass ${pass}, fail ${fail}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
