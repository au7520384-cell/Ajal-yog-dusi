#!/usr/bin/env node
// The VIP tile on the home screen (the owner's arrow: where "Limited edition" stood) and the VIP window at launch:  node tools/test_vip_tile.js
// The owner: "abbda ochilganda VIP kiyalar oynasi ochilmayapti ... VIP bo'limini sterelka bilan belgilagan joyimga qo'shib qo'y, bosganda VIP bo'lim chiqsin".
// Real server + Chromium phone, three kinds of page:
//  - the web / Telegram page (card payments on): the VIP window opens by itself a few seconds after the home screen, the tile says VIP and opens the same window again, the price is a real "$" button
//  - the Android app (CARD_PAY=false + a fake Capacitor): the window now opens at launch too; no "$" price anywhere (the pack is bought for 💎 there: tools/test_vip_gems.js)
//  - a Y8 page (referrer y8.com): the launch window stays away (Y8's start has the video gift / the first-click ad), the tile still opens the window
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8676;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8vip-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2800);
  const b = await chromium.launch(), errs = [];
  const phone = async kind => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", serviceWorkers: "block", hasTouch: true, isMobile: true }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(kind + ": " + e.message.slice(0, 200)));
    await p.addInitScript(app => {
      if (app) window.Capacitor = { isNativePlatform: () => true, Plugins: { Browser: { async open() {}, async close() {}, async addListener() { return { remove() {} }; } } } };
      if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000, cues: ["start"], cue: "start" }));
    }, kind === "app");
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    if (kind !== "web") await p.route(`http://localhost:${P}/`, async route => { const r = await route.fetch(); const body = (await r.text()).replace("const CARD_PAY = true,", "const CARD_PAY = false,"); await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body }); });
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit", referer: kind === "y8" ? "https://www.y8.com/" : undefined });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(600);
    return p;
  };
  const vip = p => p.evaluate(() => !!document.querySelector("#modal.on .vipbox, #modal.on .hwin"));   // (two layouts: the classic window, and the tall one of the horror / zodiac sets)
  const waitVip = async (p, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await vip(p)) return true; await sleep(300); } return false; };
  const closeModal = p => p.evaluate(() => document.getElementById("modal").classList.remove("on"));
  const tapTile = async p => { const r = await p.evaluate(() => { const e = document.getElementById("hLimited").getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height * 0.4 }; }); await p.touchscreen.tap(r.x, r.y); await sleep(700); };
  try {
    for (const kind of ["web", "app", "y8"]) {
      const p = await phone(kind), want = kind !== "y8";
      // ---- launch (no go("home") here: it would close the window the page opens by itself)
      const atLaunch = await waitVip(p, want ? 14000 : 8000);
      ok(atLaunch === want, `${kind}: the VIP window ${want ? "opens by itself at launch" : "stays away at launch"}`, atLaunch);
      if (want) await closeModal(p);
      await sleep(400);
      // ---- the tile
      const tile = await p.evaluate(() => ({ lab: document.querySelector("#hLimited .hlim").textContent.trim(), ends: document.getElementById("hLimEnds").textContent, vis: document.getElementById("hLimited").getBoundingClientRect().width > 50 }));
      ok(tile.lab === "VIP" && tile.vis, `${kind}: the tile on the arrow's place says VIP`, tile);
      await tapTile(p);
      ok(await vip(p), `${kind}: a tap on the VIP tile opens the VIP window`);
      ok(await p.evaluate(() => !document.getElementById("limCv")), `${kind}: it is the VIP window, not the old limited cue`);
      // ---- prices (every page of the pager is the tall window now: its price is #hBuy, or "Tez orada" where no card works)
      await p.evaluate(() => vipOffers("sport")); await sleep(500);
      const pr = await p.evaluate(() => ({ buyD: !!document.getElementById("hBuyD"), buy: !!document.getElementById("hBuy"), buyTxt: (document.getElementById("hBuy") || {}).textContent || "", soon: !!document.querySelector(".hbuy small"), dollars: /\$\s?\d/.test(document.getElementById("modal").innerText) }));
      if (kind === "web") ok(pr.buy && /\$\d/.test(pr.buyTxt), "web: a real $ price button", pr);
      else if (kind === "app") ok(!pr.buy && pr.buyD && !pr.soon && !pr.dollars, "app: a 💎 buy button instead of \"coming soon\", no $ anywhere (test_vip_gems.js buys with it)", pr);
      else ok(!pr.buy && !pr.buyD && pr.soon && !pr.dollars, `${kind}: no $ price anywhere, "coming soon" instead of the buy button`, pr);
      // ---- the window remembers its page
      await p.evaluate(() => (document.getElementById("vNext") || document.getElementById("hNext")).click()); await sleep(400);
      const pg = await p.evaluate(() => vipPage); await closeModal(p); await sleep(300); await tapTile(p);
      ok(await p.evaluate(() => vipPage) === pg && await vip(p), `${kind}: the tile opens the window where the player left it (page ${pg})`);
      await p.context().close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); await sleep(300); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
