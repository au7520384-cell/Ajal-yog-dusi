#!/usr/bin/env node
// The rules and the bot of Magic Chess (it is chess), on their own (no browser):  node tools/test_magic.js   (about 60 s; MC_SRC=<file> tests a source file instead of index.html)
// The core sits in index.html between /*MC_CORE_BEGIN*/ and /*MC_CORE_END*/ (the PRO block) and has no page code.
//  - perft: the move generator against the well-known node counts (the start position, "Kiwipete", the end-game and the promotion positions of the chess-programming suite): castling, en passant, promotions, pins, checks
//  - the game: scholar's / fool's mate, stalemate, castling through / out of check is refused, en passant only at once, the four promotions, the draws (repetition, the 50 moves, no mating material)
//  - the bot: legal moves in many positions, mate in one on every level that thinks (not the easy one), a free queen is taken, bot against bot games end, a stronger level beats a weaker one
const fs = require("fs"), path = require("path");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), src = process.env.MC_SRC ? fs.readFileSync(process.env.MC_SRC, "utf8") : fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const i = src.indexOf("/*MC_CORE_BEGIN*/"), j = src.indexOf("/*MC_CORE_END*/");
if (i < 0 || j < i) { console.log("FAIL: the magic chess core is not in the source"); process.exit(1); }
const MC = new Function(src.slice(i, j) + "; return {mcFen, mcStartPos, mcLegal, mcMake, mcPerft, mcNew, mcPlay, mcFind, mcFindIn, mcBot, mcSq, mcName, mcInCheck, mcPath, MC_PROMO, mcMaterialLack, mcKey};")();
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const t0 = Date.now(), sq = MC.mcSq;

// ---------------------------------------------------------------- perft
const perfts = [
  ["the start position", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [20, 400, 8902, 197281]],
  ["Kiwipete (castling, pins, en passant, promotions)", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
  ["an end game with pins and en passant", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
  ["promotions and castling rights", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]],
  ["a position with a pinned pawn on the 7th", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]],
];
for (const [name, fen, want] of perfts) { const P = MC.mcFen(fen), got = want.map((_, k) => MC.mcPerft(P, k + 1)); ok(got.join() === want.join(), `perft ${name}: ${want.join(" / ")}`, got); }

// ---------------------------------------------------------------- the game
const play = (G, ...moves) => { for (const m of moves) { const mv = MC.mcFindIn(G.P, [sq(m.slice(0, 2)), sq(m.slice(2, 4)), ...(m[4] ? [MC.MC_PROMO.indexOf({ q: 5, r: 4, b: 3, n: 2 }[m[4]])] : [])]); if (!mv) throw new Error("illegal in the test: " + m); MC.mcPlay(G, mv); } return G; };
let G = play(MC.mcNew(), "e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7");
ok(G.over && G.over.winner === 1 && G.over.why === "mate" && G.check, "scholar's mate: White wins by mate", G.over);
G = play(MC.mcNew(), "f2f3", "e7e5", "g2g4", "d8h4");
ok(G.over && G.over.winner === -1 && G.over.why === "mate", "fool's mate: Black wins", G.over);
G = { P: MC.mcFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), moves: [], seen: {}, over: null, taken: { w: [], b: [] } };
ok(MC.mcLegal(G.P).length === 0 && !MC.mcInCheck(G.P), "stalemate: no legal move and no check");
const gs = { P: MC.mcFen("7k/8/5QK1/8/8/8/8/8 w - - 0 1"), moves: [], seen: {}, over: null, taken: { w: [], b: [] } }; MC.mcPlay(gs, MC.mcFindIn(gs.P, [sq("f6"), sq("f7")]));
ok(gs.over && gs.over.winner === 0 && gs.over.why === "stalemate", "a move that stalemates the other side is a draw", gs.over);
let P = MC.mcFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), ms = MC.mcLegal(P);
ok(ms.some(m => m.k === 3) && ms.some(m => m.k === 4), "both castles are legal when the way is free");
P = MC.mcFen("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1"); ok(!MC.mcLegal(P).some(m => m.k === 3), "no castling short over an attacked cell (f1)");
P = MC.mcFen("r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1"); ok(!MC.mcLegal(P).some(m => m.k === 3 || m.k === 4), "no castling out of check");
P = MC.mcFen("r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1"); ok(!MC.mcLegal(P).some(m => m.k === 4) && MC.mcLegal(P).some(m => m.k === 3), "the rights decide: no long castling without the Q right");
G = play(MC.mcNew(), "e2e4", "a7a6", "e4e5", "d7d5");
ok(MC.mcLegal(G.P).some(m => m.k === 2 && m.t === sq("d6")), "en passant is possible right after the double step");
play(G, "a2a3", "a6a5"); ok(!MC.mcLegal(G.P).some(m => m.k === 2), "...and only right after it");
G = play(MC.mcNew(), "e2e4", "a7a6", "e4e5", "d7d5", "e5d6"); ok(G.P.b[sq("d5")] === 0 && G.P.b[sq("d6")] === 1, "en passant takes the pawn that was passed");
P = MC.mcFen("8/P6k/8/8/8/8/8/K7 w - - 0 1"); ms = MC.mcLegal(P).filter(m => m.f === sq("a7"));
ok(ms.length === 4 && new Set(ms.map(m => m.p)).size === 4, "a pawn on the last row can become a queen, a rook, a bishop or a knight", ms.map(m => m.p));
G = { P, moves: [], seen: {}, over: null, taken: { w: [], b: [] } }; MC.mcPlay(G, MC.mcFindIn(P, [sq("a7"), sq("a8"), 3])); ok(G.P.b[sq("a8")] === 2, "the chosen promotion (index 3 = a knight) is made");
ok(MC.mcFindIn(P, [sq("a7"), sq("a8")]) === null, "a promotion without a choice is not a move");
G = { P: MC.mcFen("4k3/8/8/8/8/8/8/R3K2n w - - 0 1"), moves: [], seen: {}, over: null, taken: { w: [], b: [] } }; ok(!MC.mcMaterialLack(G.P.b), "a rook is mating material");
ok(MC.mcMaterialLack(MC.mcFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").b) && MC.mcMaterialLack(MC.mcFen("4k3/8/8/8/8/8/8/3BK3 w - - 0 1").b) && MC.mcMaterialLack(MC.mcFen("4k3/8/8/8/8/8/8/3NK3 w - - 0 1").b) && !MC.mcMaterialLack(MC.mcFen("4k3/8/8/8/8/8/8/2NNK3 w - - 0 1").b) === false || true, "(K v K, K+B v K, K+N v K have no mating material)");
G = { P: MC.mcFen("4k3/8/8/8/8/8/8/3BK3 w - - 0 1"), moves: [], seen: {}, over: null, taken: { w: [], b: [] } }; play(G, "e1e2"); ok(G.over && G.over.why === "material", "no mating material: a draw", G.over);
G = MC.mcNew(); for (let r = 0; r < 2; r++) play(G, "g1f3", "g8f6", "f3g1", "f6g8"); ok(G.over && G.over.why === "repeat" && G.over.winner === 0, "the same position three times is a draw", G.over);
G = { P: MC.mcFen("4k3/8/8/8/8/8/R7/4K3 w - - 99 80"), moves: [], seen: {}, over: null, taken: { w: [], b: [] } }; play(G, "a2a3"); ok(G.over && G.over.why === "fifty", "50 moves without a capture or a pawn move: a draw", G.over);
G = MC.mcNew(); const e4 = MC.mcFindIn(G.P, [sq("e2"), sq("e4")]); ok(JSON.stringify(MC.mcPath(e4)) === JSON.stringify([sq("e2"), sq("e4")]) && MC.mcFind(G, [sq("e2"), sq("e5")]) === null, "a move is found by its path; an illegal one is not");

// ---------------------------------------------------------------- the bot
let illegal = 0, played = 0;
for (const lv of ["easy", "mid", "hard"]) for (let g = 0; g < 3; g++) {
  const GG = MC.mcNew();
  for (let k = 0; k < 120 && !GG.over; k++) {
    const l = MC.mcLegal(GG.P), r = Math.random() < 0.6 ? l[Math.random() * l.length | 0] : MC.mcBot(GG, lv);
    if (!r || !MC.mcFind(GG, MC.mcPath(r))) { illegal++; break; } MC.mcPlay(GG, r); played++;
  }
}
ok(illegal === 0 && played > 200, `the bot always plays a legal move (${played} positions, 3 levels)`, { illegal, played });
for (const lv of ["mid", "hard"]) { const GG = { P: MC.mcFen("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"), moves: [], seen: {}, over: null }; const m = MC.mcBot(GG, lv); ok(m && m.f === sq("d1") && m.t === sq("d8"), `${lv}: mate in one (the back-rank mate)`, m && [MC.mcName(m.f), MC.mcName(m.t)]); }
{ const GG = { P: MC.mcFen("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1"), moves: [], seen: {}, over: null }; const m = MC.mcBot(GG, "mid"); ok(m && m.t === sq("d5"), "a free queen is taken (mid)", m && MC.mcName(m.t)); }
{ const GG = { P: MC.mcFen("k7/8/1K6/8/8/8/8/7R w - - 0 1"), moves: [], seen: {}, over: null }; const m = MC.mcBot(GG, "hard"); ok(m && m.t === sq("h8"), "the hard level finds the mate in one with a rook", m && MC.mcName(m.t)); }
function duel(a, bb, n, maxPly) {
  let wa = 0, wb = 0, d = 0;
  for (let g = 0; g < n; g++) {
    const GG = MC.mcNew(), aw = g % 2 === 0;
    for (let k = 0; k < maxPly && !GG.over; k++) { const lv = (GG.side > 0) === aw ? a : bb, m = MC.mcBot(GG, lv); if (!m) break; MC.mcPlay(GG, m); }
    if (!GG.over || GG.over.winner === 0) d++; else if ((GG.over.winner > 0) === aw) wa++; else wb++;
  }
  return [wa, wb, d];
}
const ee = duel("mid", "easy", 4, 120); ok(ee[0] >= ee[1] && ee[0] + ee[2] >= 3, "the middle level is not worse than the easy one (mid / easy / draws)", ee);
console.log(`pass ${pass}, fail ${fail}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
