#!/usr/bin/env node
// The HD pack (sharper copies of the small pictures, web/hd/):  node tools/test_hd.js     (B8_ROOT=<repo copy> to test another copy of the repo, SHOTS=<dir> for screenshots)
// - first visit: the start screen shows the standard pack, then "HD graphics" with its own progress, the page reloads once and starts with the HD pictures
// - the service worker answers img/<hash>.webp with the HD copy (an avatar is 400 px instead of 100 px), the second visit opens at once with no download screen
// - Settings can switch HD off (the standard pictures are back) and on again
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8hd-")), P = 8341, base = `http://localhost:${P}`, shots = process.env.SHOTS || "";
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const man = await (await fetch(base + "/assets.json")).json(); ok(man.hd && man.hd.files.length > 50, "assets.json lists an HD pack", man.hd && man.hd.files.length);
    const hdUrl = f => "/hd/" + f[0].slice(4).replace(/\.[^.]+$/, "") + ".webp";
    const one = await fetch(base + hdUrl(man.hd.files[0])); ok(one.status === 200 && /immutable/.test(one.headers.get("cache-control")) && one.headers.get("content-type") === "image/webp", "an HD file is served as image/webp with a one-year cache", [one.status, one.headers.get("content-type")]);
    const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true, locale: "uz-UZ" }), errs = [];
    const open = async () => { const p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160))); await p.addInitScript(() => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "uz", genderAsked: true, gender: "m" })); }); return p; };
    const ready = p => p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 });
    const avW = p => p.evaluate(async () => { const im = new Image(); im.src = IMG.ga0; await im.decode(); return im.naturalWidth; });
    // first visit (slowish network so both screens can be seen)
    let p = await open(); const cdp = await ctx.newCDPSession(p); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 10, downloadThroughput: 25e6 / 8, uploadThroughput: 5e6 });
    let sawBase = false, sawHd = false, loads = 0; p.on("load", () => { loads++; });
    await p.goto(base + "/", { waitUntil: "commit" });
    const t0 = Date.now(); let shot = false;
    while (Date.now() - t0 < 240000) {
      const t = await p.evaluate(() => { const b = document.querySelector("#bootDl b"); return b ? b.textContent : ""; }).catch(() => "");
      if (/Resurslar/.test(t)) sawBase = true;
      if (/HD grafika/.test(t)) { sawHd = true; if (shots && !shot) { shot = true; await sleep(800); await p.screenshot({ path: path.join(shots, "hd_splash.png") }).catch(() => {}); } }
      if (loads >= 2 && await p.evaluate(() => typeof profile !== "undefined" && !document.getElementById("boot")).catch(() => false)) break;
      await sleep(250);
    }
    await ready(p); await sleep(800);
    ok(sawBase && sawHd, "first visit: the start screen showed the standard pack and then the HD pack", { sawBase, sawHd });
    ok(loads === 2, "the page reloaded exactly once to start with the HD pictures", loads);
    const st = await p.evaluate(async () => ({ state: __hd.state, v: localStorage.getItem("b8_hd_v"), n: (await (await caches.open("billiard8-hd")).keys()).length, ctl: !!navigator.serviceWorker.controller }));
    ok(st.state === "on" && st.v === man.hd.v && st.n >= man.hd.files.length && st.ctl, "all HD files are in their own cache and the pack is marked installed", st);
    ok(await avW(p) === 400, "the avatar picture is the 400 px HD copy now (was 100 px)");
    ok(errs.length === 0, "no page errors on the first visit", errs); await p.close();
    // second visit: nothing to download, the HD pictures are used at once
    p = await open(); let sawBar = false; await p.exposeFunction("sawBar", () => { sawBar = true; });
    await p.addInitScript(() => { new MutationObserver(() => { const x = document.getElementById("boot"); if (x && x.classList.contains("dl")) window.sawBar(); }).observe(document, { subtree: true, attributes: true, childList: true }); });
    await p.goto(base + "/", { waitUntil: "commit" }); await ready(p); await sleep(500);
    ok(!sawBar, "second visit: no download screen"); ok(await avW(p) === 400, "second visit: HD avatar at once");
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(600);
    // Settings: the HD row is there and can switch HD off
    await p.evaluate(() => go("settingsScr")); await sleep(900);
    const row = await p.evaluate(() => { const r = [...document.querySelectorAll("#setBody .setrow")].find(x => /HD grafika paketi/.test(x.textContent)); return r ? r.textContent.replace(/\s+/g, " ").trim() : ""; });
    ok(/HD grafika paketi/.test(row) && /Yoqilgan/.test(row), "Settings shows the HD row as on", row);
    if (shots) await p.screenshot({ path: path.join(shots, "hd_settings.png") });
    await Promise.all([p.waitForNavigation({ timeout: 60000 }).catch(() => {}), p.evaluate(() => document.querySelector('[data-hd="off"]').click())]);
    await ready(p); await sleep(600);
    const off = await p.evaluate(async () => ({ pref: localStorage.getItem("b8_hd"), has: await caches.has("billiard8-hd"), state: __hd.state }));
    ok(off.pref === "off" && !off.has && off.state === "off", "HD off: the pack is deleted and remembered as off", off);
    ok(await avW(p) === 100, "HD off: the standard 100 px avatar is back");
    // and on again from Settings
    const g2 = await p.$("#lsGuest"); if (g2) await g2.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => go("settingsScr")); await sleep(700);
    await p.evaluate(() => document.querySelector('[data-hd="on"]').click());
    await p.waitForFunction(() => __hd.state === "ready" || __hd.state === "on", null, { timeout: 120000 }); await sleep(500);
    ok(await p.evaluate(async () => (await (await caches.open("billiard8-hd")).keys()).length) >= man.hd.files.length, "HD on again: the pack is downloaded in the background");
    await p.close();
    ok(errs.length === 0, "no page errors", errs);
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
