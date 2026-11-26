#!/usr/bin/env node
// The server's rules of shashka / Magic Chess:  node server/test_boardcores.js   (a few seconds, no server, no browser)
// server/boardcores.js is the file the server loads (instead of reading the 50 MB index.html at start, which held ~100 MB of RAM for as long as it ran: a 512 MB Render plan has none to spare).
// It must be EXACTLY what tools/build_cores.js makes of the blocks of index.html (else a phone and the server would judge a match by different rules), it must play, and boardrules.js must not read index.html.
const fs = require("fs"), path = require("path");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const { build } = require(path.join(ROOT, "tools", "build_cores.js")), have = fs.readFileSync(path.join(ROOT, "server", "boardcores.js"), "utf8");
ok(build() === have, "server/boardcores.js is exactly what index.html says (if not: run  node tools/build_cores.js  and commit the file)");
const R = require(path.join(ROOT, "server", "boardrules.js")).load();
ok(R.ok && ["shNew", "shFind", "shPlay", "shGen", "mcNew", "mcFind", "mcPlay", "mcLegal", "mcPath"].every(k => typeof R[k] === "function"), "the rules load and have the functions the server uses", R.why);
const G = R.shNew(); ok(R.shGen(G.b, 1).length === 7 && R.shGen(G.b, -1).length === 7, "shashka: 7 opening moves for each side");
const mv = R.shFind(G, [40, 33]); ok(!!mv && !R.shFind(G, [0, 1]), "shashka: a legal move is found, an illegal one is not"); R.shPlay(G, mv); ok(G.ply === 1 && G.side === -1 && !G.over, "shashka: a move is played");
const M = R.mcNew(); ok(R.mcLegal(M.P).length === 20 && !!R.mcFind(M, [52, 36]) && !R.mcFind(M, [52, 20]), "chess: 20 opening moves, e2-e4 is legal, e2-e6 is not");
for (const p of [[53, 45], [12, 28], [54, 38], [3, 39]]) R.mcPlay(M, R.mcFind(M, p)); ok(M.over && M.over.why === "mate" && M.over.winner === -1, "chess: the fool's mate ends the game by the rules (Black wins)", M.over);
ok(!/readFileSync\([^)]*index\.html/.test(fs.readFileSync(path.join(ROOT, "server", "boardrules.js"), "utf8")), "boardrules.js does not read index.html (the server must not hold 50 MB of page in memory)");
console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
