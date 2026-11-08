#!/usr/bin/env node
// Google Play listing pictures made from the real game:  node tools/make_play_shots.js
//   store/play/shot_1..6.jpg  1920 x 1080 (16:9 phone screenshots)   store/play/feature.png  1024 x 500   store/play/icon-512.png  512 x 512
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "store", "play"), P = 8677;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ps-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: "en-US", serviceWorkers: "block" })).newPage();
    await p.addInitScript(() => localStorage.getItem("billiard8v2") || localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 25000, level: 12 })));
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(1500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1500);
    const shot = async (n, fn) => { if (fn) await fn(); await sleep(1800); await p.screenshot({ path: path.join(OUT, `shot_${n}.jpg`), type: "jpeg", quality: 88 }); console.log("shot", n); };
    await shot(1, () => p.evaluate(() => go("home")));
    await shot(2, () => p.evaluate(() => go("cities")));
    await shot(3, () => p.evaluate(() => go("shop")));
    await shot(4, () => p.evaluate(() => go("tourScr")));
    await shot(5, () => p.evaluate(() => go("passScr")));
    await p.evaluate(() => go("home")); await sleep(500);
    await p.evaluate(() => startMatch("ai", CITIES[0], botPlayer(1, 4))); await sleep(9000);
    await shot(6, null);
  } finally { await b.close(); srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
