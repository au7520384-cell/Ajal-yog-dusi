#!/usr/bin/env node
// Writes tools/pg_achievements.json: every achievement of the game (the 9 main ones, ACHS, and the 62 of the second set, ACH2) with its English name and description exactly as the game shows them (T()).
// tools/build_crazy.py declares them in playgama-bridge-config.json ("achievements": id / name / description, the way Playgama's Bridge docs ask) and the Playgama build unlocks each one on the platform when it is earned.
// Run it again after ACHS / ACH2 change:   node tools/pg_achievements.js        (tools/test_playgama_achievements.js fails when the file is out of date)
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), OUT = process.argv[2] || path.join(__dirname, "pg_achievements.json");
(async () => {
  const srv = http.createServer((q, s) => { fs.readFile(path.join(ROOT, q.url.split("?")[0] === "/" ? "index.html" : "nope"), (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": "text/html" }); s.end(d); }); });
  await new Promise(r => srv.listen(8691, r)); const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
  await ctx.route(x => !/^http:\/\/localhost:8691\//.test(x.href) && !/^(data|blob):/.test(x.href), r => r.abort());
  await p.addInitScript(() => { try { localStorage.setItem("billiard8v2", JSON.stringify({ name: "A", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" })); } catch (e) {} });
  await p.goto("http://localhost:8691/", { waitUntil: "commit" });
  await p.waitForFunction(() => typeof ACH2 !== "undefined" && typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 });
  const out = await p.evaluate(() => ({ lang: LANG, list: [...Object.entries(ACHS).map(([id, a]) => ({ id, name: T(a.name), description: T(a.d) })), ...ACH2.map(a => ({ id: a.id, name: T(a.name), description: T(a.d) }))] }));
  await b.close(); srv.close();
  if (out.lang !== "en") { console.error("the game is not in English: " + out.lang); process.exit(1); }
  fs.writeFileSync(OUT, JSON.stringify(out.list, null, 1) + "\n"); console.log(out.list.length + " achievements -> " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
