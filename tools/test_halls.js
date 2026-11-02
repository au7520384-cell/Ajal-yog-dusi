#!/usr/bin/env node
// Every table has a hall of its own: paints the background of all tables (with every city's landmark in the windows) and checks that nothing throws, that each painting
// takes a short time and that no two halls look the same.   node tools/test_halls.js
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8197"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1600, height: 720 }, locale: "en-US" })).newPage(), errs = [];
  p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
  await p.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto("http://localhost:8197/index.html", { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  const r = await p.evaluate(() => {
    const cities = CITIES.map(c => c.id), out = [], bad = []; let worst = 0;
    Object.keys(TBL).forEach((id, i) => {
      const city = cities[i % cities.length], oc = document.createElement("canvas"); oc.width = cv.width; oc.height = cv.height; const saved = ctx; ctx = oc.getContext("2d"); ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);
      const t0 = performance.now();
      try { paintBackground(TBL[id].bg, roomSeed(id + "|" + city), null, null, city); } catch (e) { bad.push(id + ": " + e.message); }
      worst = Math.max(worst, performance.now() - t0);
      const sm = document.createElement("canvas"); sm.width = 48; sm.height = 27; sm.getContext("2d").drawImage(oc, 0, 0, 48, 27); ctx = saved;
      out.push([id, Array.from(sm.getContext("2d").getImageData(0, 0, 48, 27).data).join(",")]);
    });
    return { out, bad, worst: Math.round(worst), landmarks: Object.keys(CITIES).length };
  });
  const seen = new Map(), dup = [];
  for (const [id, d] of r.out) { const h = crypto.createHash("sha1").update(d).digest("hex"); if (seen.has(h)) dup.push(id + " = " + seen.get(h)); else seen.set(h, id); }
  console.log(`tables ${r.out.length}, painted without errors ${r.out.length - r.bad.length}, slowest ${r.worst} ms, identical halls ${dup.length}`);
  if (r.bad.length) console.log("ERRORS", r.bad.slice(0, 5)); if (dup.length) console.log("DUPLICATES", dup.slice(0, 5)); if (errs.length) console.log("PAGE ERRORS", errs.slice(0, 3));
  await b.close(); srv.kill(); process.exit(r.bad.length || dup.length || errs.length || r.worst > 400 ? 1 : 0);
})();
