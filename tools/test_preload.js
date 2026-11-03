#!/usr/bin/env node
// First-visit download screen (like a big mobile game): node tools/test_preload.js   (the HD pack is switched off here: tools/test_hd.js tests it)
// - first visit: a progress bar with "(x MB / y MB)" shows while every picture / sound goes into the cache, then the game opens; second visit: no download screen, the game opens at once
// - "Later" lets the player in while the download goes on; a changed file list downloads only the new files
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pre-")), P = 8321, base = `http://localhost:${P}`, shots = process.env.SHOTS || "";
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const list = await (await fetch(base + "/assets.json")).json(); ok(list.files && list.files.length > 1000 && list.v, "assets.json lists the pictures and sounds", list.files && list.files.length);
    const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, locale: "uz-UZ" });
    const open = async () => { const p = await ctx.newPage(); p.errs = []; p.on("pageerror", e => p.errs.push(e.message.slice(0, 160))); await p.addInitScript(() => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "uz", genderAsked: true, gender: "m" })); }); return p; };
    // first visit, throttled so the bar can be seen
    let p = await open(); const cdp = await ctx.newCDPSession(p); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: 6e6 / 8 * 8, uploadThroughput: 1e6 });
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => document.querySelector("#bootDl b") && /MB/.test(document.querySelector("#bootDl i").textContent), null, { timeout: 30000 });
    await sleep(2500);
    const mid = await p.evaluate(() => ({ title: document.querySelector("#bootDl b").textContent, cnt: document.querySelector("#bootDl i").textContent, w: parseFloat(document.querySelector("#bootDl .bar u").style.width), dl: document.getElementById("boot").classList.contains("dl"), btn: !!document.querySelector("#bootDl button") }));
    ok(/Resurslar/.test(mid.title) && /\(\d+\.\d MB \/ \d+\.\d MB\)/.test(mid.cnt) && mid.w > 0 && mid.w < 100 && mid.dl && mid.btn, "the progress screen shows title, MB counter and a growing bar", mid);
    if (shots) await p.screenshot({ path: path.join(shots, "pre_portrait.png") });
    await p.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 120000 });
    const n1 = await p.evaluate(async () => (await (await caches.open("billiard8-v6")).keys()).filter(r => /\/(img|a)\//.test(r.url)).length);
    ok(n1 >= list.files.length, "every picture and sound is in the cache after the first visit", [n1, list.files.length]);
    ok(await p.evaluate(() => localStorage.getItem("b8_assets")) === list.v, "the downloaded list version is remembered");
    ok(await p.evaluate(() => typeof profile !== "undefined" && !!document.getElementById("home")), "the game is up behind the screen");
    ok(p.errs.length === 0, "no page errors on the first visit", p.errs); await p.close();
    // second visit: no download screen
    p = await open(); let seenBar = false; await p.exposeFunction("sawBar", () => { seenBar = true; });
    await p.addInitScript(() => { new MutationObserver(() => { const b = document.getElementById("boot"); if (b && b.classList.contains("dl")) window.sawBar(); }).observe(document, { subtree: true, attributes: true, childList: true }); });
    const t0 = Date.now(); await p.goto(base + "/", { waitUntil: "commit" }); await p.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 60000 });
    ok(!seenBar, "second visit: no download screen"); console.log("second visit opened in", Date.now() - t0, "ms"); await p.close();
    // a new file in the list: only that one is downloaded (service workers blocked in this context so the page's requests can be intercepted)
    const ctx3 = await b.newContext({ serviceWorkers: "block", locale: "en-US" }), seed = async () => { const q = await ctx3.newPage(); await q.addInitScript(() => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" })); }); return q; };
    p = await seed(); await p.goto(base + "/", { waitUntil: "commit" }); await p.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 120000 }); await p.close();
    p = await seed(); const fresh = "img/" + "f".repeat(14) + ".webp", got = [], seenOld = [];
    await p.route("**/assets.json", r => { const j = JSON.parse(JSON.stringify(list)); j.v = "newversion01"; j.files.push([fresh, 4000]); r.fulfill({ contentType: "application/json", body: JSON.stringify(j) }); });
    await p.route("**/" + fresh, r => { got.push(1); r.fulfill({ contentType: "image/webp", body: Buffer.alloc(4000, 1) }); });
    await p.goto(base + "/", { waitUntil: "commit" }); await p.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 60000 }); await sleep(800);
    ok(got.length === 1, "after an update only the new file is downloaded", got.length);
    ok(await p.evaluate(() => localStorage.getItem("b8_assets")) === "newversion01", "the new list version is remembered");
    await p.close();
    // "Later": a fresh browser context, the button lets the player in while the download goes on
    const ctx2 = await b.newContext({ viewport: { width: 780, height: 390 }, hasTouch: true, locale: "en-US" }); p = await ctx2.newPage();
    await p.addInitScript(() => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" })); });
    const c2 = await ctx2.newCDPSession(p); await c2.send("Network.enable"); await c2.send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: 1.5e6, uploadThroughput: 1e6 });
    await p.goto(base + "/", { waitUntil: "commit" }); await p.waitForSelector("#bootDl button", { timeout: 30000 }); await sleep(1500);
    ok(/Downloading game resources/.test(await p.textContent("#bootDl b")), "the screen speaks the player's language (en)");
    if (shots) await p.screenshot({ path: path.join(shots, "pre_landscape.png") });
    await p.click("#bootDl button"); await p.waitForFunction(() => !document.getElementById("boot"), null, { timeout: 20000 });
    const c3 = await p.evaluate(async () => (await (await caches.open("billiard8-v6")).keys()).filter(r => /\/(img|a)\//.test(r.url)).length);
    ok(c3 < list.files.length, "\"Later\" let the player in before the download ended", c3);
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
