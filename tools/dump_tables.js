#!/usr/bin/env node
// Lists every table of the game with the colours of its hall: node tools/dump_tables.js > tables.json   ->  {"lon": ["#2a3a5c", "#0c1426"], ...}  (TBL of index.html, the order of the game;
// the tables of the shop are added by code, so the list has to come from the running page). tools/add_floor_patterns.py --tables tables.json reads it.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8198"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1000, height: 450 }, locale: "en-US" })).newPage();
  await p.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto("http://localhost:8198/index.html", { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  const t = await p.evaluate(() => { const o = {}; for (const id of Object.keys(TBL)) o[id] = (TBL[id].bg || ["#26324f", "#151d33"]).slice(0, 2); return o; });
  process.stdout.write(JSON.stringify(t) + "\n"); await b.close(); srv.kill();
})();
