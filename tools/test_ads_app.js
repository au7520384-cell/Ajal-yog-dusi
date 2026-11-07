#!/usr/bin/env node
// Ads in the ANDROID APP (AppLovin MAX through the Capacitor plugin "RbAds"), seen from the page: the real server + a browser with a fake plugin:  node tools/test_ads_app.js
// Checks: no AppLovin ids on the server = no ads and no ad buttons; with ids the page initialises the plugin with them; rewarded video pays free coins / 💵 (2 a day), a video closed early or not loaded pays nothing and says so;
// an interstitial comes every 4th game (not for new players, not for the Ad-Free owner); "watch N ads" buttons exist only where 💵 buys (frames, stickers, ordinary tables) and never on premium / horror / country cues, premium tables or avatars.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8664, P2 = 8665;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ad-")), tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "b8ad2-"));
  const base = { ...process.env }; for (const k of ["APPLOVIN_SDK_KEY", "APPLOVIN_REWARDED_ID", "APPLOVIN_INTERSTITIAL_ID"]) delete base[k];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...base, PORT: String(P), DATA_DIR: tmp, APPLOVIN_SDK_KEY: "SDKKEY-test-123", APPLOVIN_REWARDED_ID: "rw_unit_1", APPLOVIN_INTERSTITIAL_ID: "in_unit_1" }, stdio: "ignore" });
  const srv2 = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...base, PORT: String(P2), DATA_DIR: tmp2 }, stdio: "ignore" });   // an AppLovin account is not set up yet
  await sleep(2800);
  const b = await chromium.launch(), errs = [];
  const phone = async (port, save = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(o => {
      const A = window.__ad = { init: [], rew: 0, inter: 0, mode: "ok", ready: true };
      const rb = {
        async init(x) { A.init.push(x); return { inited: true }; },
        async ready() { return { inited: true, rewarded: A.ready, interstitial: A.ready }; },
        async showRewarded() { A.rew++; await new Promise(r => setTimeout(r, 80)); return A.mode === "ok" ? { shown: true, rewarded: true } : A.mode === "early" ? { shown: true, rewarded: false } : { shown: false, rewarded: false, reason: "not_ready" }; },
        async showInterstitial() { A.inter++; return { shown: true }; },
      };
      window.Capacitor = { isNativePlatform: () => true, Plugins: { RbAds: rb, Browser: { async open() {}, async close() {}, async addListener() { return { remove() {} }; } } } };
      if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000, ...o }));
    }, save);
    await p.route(`http://localhost:${port}/`, async route => { const r = await route.fetch(); const body = (await r.text()).replace("const CARD_PAY = true,", "const CARD_PAY = false,"); await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body }); });
    await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1200);
    return p;
  };
  const toasts = p => p.evaluate(() => document.getElementById("toasts").innerText);
  const clear = p => p.evaluate(() => { toastQ.length = 0; document.getElementById("toasts").innerHTML = ""; });
  const A = p => p.evaluate(() => ({ rew: __ad.rew, inter: __ad.inter }));
  try {
    // ---- 1) the server has no AppLovin ids: no ads at all
    let p = await phone(P2); await sleep(6500);
    ok(await p.evaluate(() => isApp() && !Y8.sdk && !Y8.adsReady && __ad.init.length === 0), "no AppLovin ids on the server: the plugin is not started, no ads");
    await p.evaluate(() => { go("shop"); buildShop("frames"); }); await sleep(900);
    ok(await p.evaluate(() => document.querySelectorAll('#shopBody [data-p="usd"]').length === 0), "…and no 'watch ads' button anywhere in the shop");
    await p.evaluate(() => { go("home"); buildFree && 0; }); await p.context().close();
    // ---- 2) with ids
    p = await phone(P); await sleep(6500);
    const init = await p.evaluate(() => ({ init: __ad.init, adsReady: Y8.adsReady, every: Y8.every, sdk: !!Y8.sdk }));
    ok(init.adsReady && init.sdk && init.every === 4 && init.init.length === 1 && init.init[0].sdkKey === "SDKKEY-test-123" && init.init[0].rewardedId === "rw_unit_1" && init.init[0].interstitialId === "in_unit_1" && /\/privacy$/.test(init.init[0].privacyUrl), "the page starts the plugin with the server's AppLovin ids and the privacy page", init);
    // free coins / 💵 by rewarded video
    await p.evaluate(() => { go("shop"); buildFree(); }); await sleep(800);
    ok(await p.evaluate(() => !!$("frVid") && !!$("frCash")), "the Free page shows the two video buttons (+15 🪙, +1 💵)");
    const c0 = await p.evaluate(() => profile.coins), h0 = await p.evaluate(() => profile.cash | 0);
    await clear(p); await p.evaluate(() => $("frVid").click()); await sleep(900);
    ok(await p.evaluate(() => profile.coins) === c0 + 15 && (await A(p)).rew === 1, "a watched video pays +15 🪙", [await p.evaluate(() => profile.coins), c0]);
    await p.evaluate(() => { __ad.mode = "early"; }); await clear(p); await p.evaluate(() => $("frVid").click()); await sleep(900);
    ok(await p.evaluate(() => profile.coins) === c0 + 15 && /not (watched|seen)|to the end|completely/i.test(await toasts(p)), "a video closed early pays nothing and says so", await toasts(p));
    await p.evaluate(() => { __ad.mode = "nofill"; }); await clear(p); await p.evaluate(() => $("frVid").click()); await sleep(900);
    ok(await p.evaluate(() => profile.coins) === c0 + 15 && /not available/i.test(await toasts(p)), "no ad loaded yet: nothing paid, 'ads are not available right now'", await toasts(p));
    await p.evaluate(() => { __ad.mode = "ok"; });
    for (let i = 0; i < 2; i++) { await p.evaluate(() => $("frCash").click()); await sleep(700); }
    ok(await p.evaluate(() => profile.cash | 0) === h0 + 2, "two videos pay +1 💵 each", await p.evaluate(() => profile.cash | 0));
    const r2 = (await A(p)).rew; await clear(p); await p.evaluate(() => $("frCash").click()); await sleep(700);
    ok(await p.evaluate(() => profile.cash | 0) === h0 + 2 && (await A(p)).rew === r2 && /over|tomorrow|ended/i.test(await toasts(p)), "the third 💵 video of the day is refused before any ad is shown", await toasts(p));
    // ---- 3) the short ad between games: every 4th game, not for new players, not for the Ad-Free owner
    const brk = n => p.evaluate(async n => { for (let i = 0; i < n; i++) { Y8.lastBreak = 0; await new Promise(r => y8Break(r)); } }, n);
    await p.evaluate(() => { Y8.matches = 0; __ad.inter = 0; }); await brk(8);
    ok((await A(p)).inter === 2, "8 games = 2 short ads (the 4th and the 8th)", await A(p));
    await p.evaluate(() => { Y8.matches = 0; __ad.inter = 0; profile.adfree = 1; }); await brk(8);
    ok((await A(p)).inter === 0, "the Ad-Free owner sees none", await A(p));
    await p.evaluate(() => { Y8.matches = 0; __ad.inter = 0; profile.adfree = 0; profile.games = 1; }); await brk(8);
    ok((await A(p)).inter === 0, "a new player (fewer than 3 games) sees none", await A(p));
    await p.evaluate(() => { profile.games = 60; });
    // ---- 4) 'watch N ads' buttons: only where 💵 buys
    await p.evaluate(() => { go("shop"); buildShop("frames"); }); await sleep(1000);
    const fr = await p.evaluate(() => [...document.querySelectorAll('#shopBody [data-p="usd"]')].map(e => e.textContent.trim()));
    ok(fr.length > 5 && fr.every(t => /^📺 \d+\/\d+$/.test(t)), "frames: every row has a 'watch N ads' button (no card price)", fr.slice(0, 4));
    const rew0 = (await A(p)).rew; await p.evaluate(() => document.querySelector('#shopBody [data-p="usd"]').click()); await sleep(1200);
    ok((await A(p)).rew === rew0 + 1 && await p.evaluate(() => Object.values(profile.adBuy || {}).some(e => e.n === 1)), "one watched video = 1 step towards the frame", await p.evaluate(() => profile.adBuy));
    await p.evaluate(() => { cueCat = "premium"; buildShop("cues"); }); await sleep(900);
    ok(await p.evaluate(() => document.querySelectorAll("#shopBody .cuerow").length > 3 && document.querySelectorAll('#shopBody [data-p="usd"]').length === 0 && !/📺/.test(document.getElementById("shopBody").innerText)), "premium cues: no ad button");
    for (const cat of ["horror", "country"]) { await p.evaluate(c => { cueCat = c; buildShop("cues"); }, cat); await sleep(800); ok(await p.evaluate(() => document.querySelectorAll('#shopBody [data-p="usd"]').length === 0), cat + " cues: no ad button"); }
    await p.evaluate(() => buildShop("avatars")); await sleep(900);
    ok(await p.evaluate(() => document.querySelectorAll("#shopBody .tpay, #shopBody .card").length > 3 && document.querySelectorAll('#shopBody [data-p="usd"]').length === 0), "avatars: no ad button");
    await p.evaluate(() => buildShop("tables")); await sleep(1000);
    const tb = await p.evaluate(() => [...document.querySelectorAll("#shopBody .tpay")].map(e => ({ cash: !!e.querySelector('[data-p="cash"]'), ad: !!e.querySelector('[data-p="usd"]') })));
    ok(tb.length > 4 && tb.every(t => t.cash === t.ad) && tb.some(t => t.cash) && tb.some(t => !t.cash), "tables: the ad button sits exactly where 💵 works (never on premium tables)", tb);
    await p.evaluate(() => buildShop("stickers")); await sleep(800);
    ok(await p.evaluate(() => [...document.querySelectorAll('#shopBody [data-p="usd"], #shopBody [data-sku^="stk_"]')].every(e => !/\$/.test(e.textContent))), "stickers: no card price in the app");
    // the guard also holds when the function is called directly
    const before = (await A(p)).rew; await p.evaluate(() => adCheckout("cue_fire")); await p.evaluate(() => adCheckout("av_3")); await sleep(300);
    ok((await A(p)).rew === before, "adCheckout refuses a premium cue and an avatar even when called directly");
    ok(errs.length === 0, "no page errors", errs);
    await p.context().close();
  } finally { srv.kill(); srv2.kill(); await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmp2, { recursive: true, force: true }); }
  console.log("pass " + pass + ", fail " + fail); process.exit(fail ? 1 : 0);
})();
