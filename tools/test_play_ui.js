#!/usr/bin/env node
// Google Play Billing in the ANDROID APP, seen from the page (the real server + a fake Google + a browser with a fake Capacitor plugin):  node tools/test_play_ui.js
// The app build has no card payments (NO_CARD, built by tools/build_android.sh - here the same switch is made on the fly) and used to say "buying diamonds is not open yet". With the Capacitor plugin @capgo/native-purchases
// present, the six 💎 packs are bought through Google Play: the page asks the server first (can it verify? the account tag), opens the Google window (purchaseProduct), sends the purchase token to the server (it asks Google, pays once, consumes) and the 💎 arrive with the next sync.
// Checks: the packs and Google's prices in the shop and in "Not enough diamonds", the 💎 chip opens the packs, a purchase pays 250 💎 (account tag, no auto-acknowledge, consumed), a closed Google window changes nothing,
// a verification that failed is repeated later (restore) and pays exactly once, a purchase left over from an earlier session is delivered at start, a server that cannot verify never opens the Google window, an app without the plugin /
// on a phone without Google Play still says "not open yet", no dead "watch ads" buttons in the app, the texts are translated.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const startFakePlay = require("../server/fake_play");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8654, P2 = 8655, GP = 8656;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const tag = id => crypto.createHash("sha256").update("rb8-play:" + id).digest("hex").slice(0, 32);
(async () => {
  const fake = await startFakePlay(GP);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pui-")), tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "b8pui2-"));
  const base = { ...process.env, PLAY_API_BASE: `http://localhost:${GP}`, PLAY_OAUTH_URL: `http://localhost:${GP}/token`, PLAY_PACKAGE: fake.PKG }; delete base.PLAY_SERVICE_ACCOUNT;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...base, PORT: String(P), DATA_DIR: tmp, PLAY_SERVICE_ACCOUNT: fake.saJson }, stdio: "ignore" });
  const srv2 = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...base, PORT: String(P2), DATA_DIR: tmp2 }, stdio: "ignore" });   // a server without the Google key
  await sleep(2800);
  const b = await chromium.launch(), errs = [];
  let n = 0; const T = () => "ptok" + String(++n).padStart(3, "0") + "y".repeat(36);   // purchase tokens
  const reg = async (port, name) => (await (await fetch(`http://localhost:${port}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, avatar: 1 }) })).json());
  // a phone: a page with a fake window.Capacitor; "Google Play" on this phone = the fake Google's orders made through the plugin
  const phone = async (port, o = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: o.lang || "en-US", serviceWorkers: "block" })   /* (a service worker would answer the page's reloads itself, past the route below) */, p = await ctx.newPage(), mine = new Set(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.exposeFunction("__gpBuy", async (opt) => { const token = T(); mine.add(token); const rec = fake.order(token, opt.productIdentifier, { account: opt.appAccountToken || "" }); return { transactionId: token, productIdentifier: opt.productIdentifier, purchaseToken: token, orderId: rec.orderId, isAcknowledged: false, purchaseState: "1", appAccountToken: opt.appAccountToken || null, productType: "inapp" }; });
    await p.exposeFunction("__gpConsume", async (token) => { const r = fake.orders.get(token); if (!r || r.consumed) throw new Error("Failed to consume purchase: Item is not owned"); r.consumed = true; r.acked = true; });
    await p.exposeFunction("__gpOwned", async () => [...fake.orders].filter(([t, r]) => !r.consumed && (mine.has(t) || r.leftover)).map(([t, r]) => ({ transactionId: t, productIdentifier: r.productId, purchaseToken: t, orderId: r.orderId, isAcknowledged: r.acked, purchaseState: r.state === 2 ? "2" : "1", appAccountToken: r.account || null })));
    await p.addInitScript(o2 => {
      const calls = window.__np = { purchase: [], consume: [], getProducts: 0, getPurchases: 0 };
      const np = o2.plugin === false ? undefined : {
        async isBillingSupported() { return { isBillingSupported: o2.billing !== false }; },
        async getProducts({ productIdentifiers }) { calls.getProducts++; return { products: productIdentifiers.map(id => ({ identifier: id, priceString: "€" + (id === "gems_100" ? "1,89" : id === "gems_250" ? "4,69" : id === "gems_500" ? "9,49" : id === "gems_1000" ? "18,99" : id === "gems_2500" ? "47,99" : "94,99"), price: 1 })) }; },
        async purchaseProduct(opt) { calls.purchase.push(opt); if (window.__mode === "cancel") throw Object.assign(new Error("Purchase is not purchased"), { code: "USER_CANCELED" }); if (window.__mode === "pending") throw new Error("Purchase is pending"); await new Promise(r => setTimeout(r, 150)); return await window.__gpBuy(opt); },
        async consumePurchase(opt) { calls.consume.push(opt.purchaseToken); await window.__gpConsume(opt.purchaseToken); },
        async getPurchases() { calls.getPurchases++; return { purchases: await window.__gpOwned() }; },
      };
      window.Capacitor = { isNativePlatform: () => true, Plugins: { Browser: { async open() {}, async close() {}, async addListener() { return { remove() {} }; } }, ...(np ? { NativePurchases: np } : {}) } };
      if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: o2.lang || "en", coins: 1000, ...o2.save }));
      if (o2.acct) localStorage.setItem("b8acct", JSON.stringify(o2.acct));
    }, { plugin: o.plugin, billing: o.billing, lang: o.lang, save: o.save || {}, acct: o.acct || null });
    // the app build has CARD_PAY = false (tools/build_android.sh): the same switch here
    await p.route(`http://localhost:${port}/`, async route => { const r = await route.fetch(); const body = (await r.text()).replace("const CARD_PAY = true,", "const CARD_PAY = false,"); await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body }); });
    await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1500);
    await p.evaluate(() => { toastQ.length = 0; document.getElementById("toasts").innerHTML = ""; });
    return p;
  };
  const toasts = p => p.evaluate(() => document.getElementById("toasts").innerText);
  const gems = p => p.evaluate(() => profile.gems | 0);
  const money = async p => { await p.evaluate(() => go("shop")); await sleep(700); await p.evaluate(() => buildShop("money")); await sleep(900); };
  try {
    // ---- 1) the app with Google Play Billing: the shop
    let p = await phone(P);
    ok(await p.evaluate(() => NO_CARD && isApp() && playOn()), "the app build: no card payments, Google Play Billing on");
    await money(p);
    const shop = await p.evaluate(() => ({ cols: document.querySelectorAll("#shopBody .packcol").length, pk: [...document.querySelectorAll("#shopBody .pk")].map(k => ({ sku: k.querySelector("[data-sku]").dataset.sku, price: k.querySelector("[data-sku]").textContent.trim(), amt: k.querySelector(".amt").textContent.replace(/\D/g, "") })), card: document.querySelectorAll("#shopBody [data-card-sku]").length, ex: document.querySelectorAll("#shopBody .xcard").length, txt: document.getElementById("shopBody").innerText }));
    const byAmt = [...shop.pk].sort((a, c) => a.amt - c.amt);   // (the page lists the biggest pack first)
    ok(shop.cols === 1 && shop.pk.length === 6 && byAmt.map(k => k.sku).join() === "gems_100,gems_250,gems_500,gems_1000,gems_2500,gems_5000", "the Money page of the app: one column with the six diamond packs (no coin packs)", shop);
    ok(byAmt.map(k => k.price).join() === "€1,89,€4,69,€9,49,€18,99,€47,99,€94,99" && byAmt.map(k => k.amt).join() === "100,250,500,1000,2500,5000", "the buttons show Google's own prices, the packs 100 ... 5 000 💎", shop.pk);
    ok(shop.card === 0 && shop.ex === 4 && /Google Play/.test(shop.txt), "no card buttons, the 💎 → 🪙 exchange stays, the page says it is paid through Google Play");
    // the 💎 chip of the top bar leads here
    await p.evaluate(() => { go("home"); }); await sleep(500); await p.evaluate(() => document.querySelector(".gemchip").click()); await sleep(1000);
    ok(await p.evaluate(() => document.querySelectorAll("#shopBody .pk").length) === 6, "the 💎 chip of the top bar opens the packs");
    // "Not enough diamonds" shows the packs, with Google's prices
    await p.evaluate(() => { go("home"); gemShort(); }); await sleep(900);
    const gs = await p.evaluate(() => ({ pk: document.querySelectorAll("#modal .pk").length, price: (document.querySelector('#modal [data-sku="gems_100"]') || {}).textContent, txt: document.getElementById("modal").innerText }));
    ok(gs.pk === 6 && gs.price === "€1,89" && !/not open in this app yet/i.test(gs.txt), "'Not enough diamonds' shows the six packs with Google's prices (not the 'not open yet' note)", gs);
    await p.evaluate(() => closeModal && closeModal()).catch(() => {}); await p.evaluate(() => { const m = document.getElementById("modal"); m.classList.remove("on"); });
    // ---- 2) a purchase
    ok(await gems(p) === 0, "the player has 0 💎 (nothing is ever free)");
    await money(p);
    await p.evaluate(() => document.querySelector('#shopBody [data-sku="gems_250"]').click());
    await p.waitForFunction(() => (profile.gems | 0) >= 250, null, { timeout: 15000 }).catch(() => {}); await sleep(500);
    const acct = await p.evaluate(() => JSON.parse(localStorage.getItem("b8acct")));
    const c1 = await p.evaluate(() => window.__np);
    ok(await gems(p) === 250, "buying the 250-pack pays exactly 250 💎", await gems(p));
    ok(c1.purchase.length === 1 && c1.purchase[0].productIdentifier === "gems_250" && c1.purchase[0].productType === "inapp" && c1.purchase[0].appAccountToken === tag(acct.id) && c1.purchase[0].autoAcknowledgePurchases === false && c1.purchase[0].isConsumable === false, "the Google window is opened for gems_250 with the account tag and NO auto-acknowledge (the server confirms first)", c1.purchase);
    const rec1 = [...fake.orders.values()].find(r => r.productId === "gems_250");
    ok(rec1 && rec1.consumed === true && fake.st.consume >= 1 && c1.consume.length === 1, "the purchase is consumed (by the server, and by the app afterwards), so the pack can be bought again", { rec1, st: fake.st, c1 });
    ok(/\+250/.test(await toasts(p)), "the player is told '+250 💎'", await toasts(p));
    // buy again right away: works (not 'already owned'), and a double tap opens the Google window once
    await p.evaluate(() => { const b = document.querySelector('#shopBody [data-sku="gems_100"]'); b.click(); b.click(); });
    await p.waitForFunction(() => (profile.gems | 0) >= 350, null, { timeout: 15000 }).catch(() => {}); await sleep(400);
    ok(await gems(p) === 350 && (await p.evaluate(() => window.__np.purchase.length)) === 2, "a second purchase works, a double tap opens the Google window only once", [await gems(p), await p.evaluate(() => window.__np.purchase.length)]);
    // ---- 3) the Google window closed / a payment pending: nothing changes
    await p.evaluate(() => { toastQ.length = 0; document.getElementById("toasts").innerHTML = ""; window.__mode = "cancel"; document.querySelector('#shopBody [data-sku="gems_500"]').click(); }); await sleep(1200);
    ok(await gems(p) === 350 && !/⚠|failed|Purchase failed/i.test(await toasts(p)), "closing the Google window changes nothing and shows no error", await toasts(p));
    await p.evaluate(() => { window.__mode = "pending"; document.querySelector('#shopBody [data-sku="gems_500"]').click(); }); await sleep(1200);
    ok(await gems(p) === 350 && /Payment pending/i.test(await toasts(p)), "a payment that is still pending says so", await toasts(p));
    await p.evaluate(() => { window.__mode = ""; });
    // ---- 4) the verification fails (Google refuses the server): the 💎 are not paid, the purchase stays at Google, the retry pays exactly once
    fake.opts.getStatus = 500; await p.evaluate(() => { toastQ.length = 0; document.getElementById("toasts").innerHTML = ""; document.querySelector('#shopBody [data-sku="gems_1000"]').click(); }); await sleep(2500);
    const left = [...fake.orders.values()].filter(r => !r.consumed && r.productId === "gems_1000");
    ok(await gems(p) === 350 && left.length === 1 && /⚠|connection|internet/i.test(await toasts(p)), "Google/server trouble after paying: no 💎 yet, an error is shown, the purchase stays unconsumed at Google", { g: await gems(p), left: left.length, t: await toasts(p) });
    fake.opts.getStatus = 200; await p.evaluate(() => playRestore(true)); await sleep(2500);
    const sku2 = left[0] && left[0].productId, want2 = +String(sku2).slice(5);
    ok(await gems(p) === 350 + want2 && left[0].consumed === true, "the next restore (start / resume / shop open) delivers it: +" + want2 + " 💎, consumed", { g: await gems(p), sku2 });
    const g2 = await gems(p); await p.evaluate(() => playRestore(true)); await sleep(1500);
    ok(await gems(p) === g2, "restoring again pays nothing more");
    // ---- 5) no dead 'watch ads' button on a premium row in the app
    await p.evaluate(() => go("shop")); await sleep(600); await p.evaluate(() => { cueCat = "premium"; buildShop("cues"); }); await sleep(900);
    const rowBtns = await p.evaluate(() => { const r = [...document.querySelectorAll("#shopBody .cuerow")].find(e => e.querySelector('[data-p="gems"]')); return r ? { gems: !!r.querySelector('[data-p="gems"]'), usd: !!r.querySelector('[data-p="usd"]'), ads: /📺/.test(r.innerText) } : null; });
    ok(rowBtns && rowBtns.gems && !rowBtns.usd && !rowBtns.ads, "a premium cue row in the app has the 💎 button and no dead 'watch ads' / card button", rowBtns);
    await p.context().close();
    // ---- 6) a purchase left over from an earlier session is delivered at start
    const old = await reg(P, "Olga"), oldTok = T();
    fake.order(oldTok, "gems_500", { account: tag(old.id), leftover: true });   // owned on the phone, never delivered
    p = await phone(P, { acct: old, save: { name: "Olga" } });
    await p.waitForFunction(() => (profile.gems | 0) >= 500, null, { timeout: 25000 }).catch(() => {});
    ok(await gems(p) === 500 && fake.orders.get(oldTok).consumed === true, "a paid purchase that was never delivered (the app was closed during it) is delivered by itself a few seconds after the app starts", { g: await gems(p) });
    await p.context().close();
    // ---- 7) a server that cannot verify never opens the Google window
    p = await phone(P2);
    ok(await p.evaluate(() => playOn()), "(the app with the plugin, server without the Google key)");
    await money(p); await p.evaluate(() => { toastQ.length = 0; document.getElementById("toasts").innerHTML = ""; document.querySelector('#shopBody [data-sku="gems_100"]').click(); }); await sleep(1800);
    ok((await p.evaluate(() => window.__np.purchase.length)) === 0 && /not enabled yet/i.test(await toasts(p)) && await gems(p) === 0, "the server cannot verify: the Google window is NOT opened (nobody is charged), the player is told", await toasts(p));
    await p.context().close();
    // ---- 8) an app without the plugin / a phone without Google Play: as before
    for (const [label, o] of [["no plugin in the app", { plugin: false }], ["Google Play billing not supported on this phone", { billing: false }]]) {
      p = await phone(P, o); await sleep(800);
      ok(!(await p.evaluate(() => playOn())), label + ": Google Play Billing is off");
      await p.evaluate(() => { go("home"); gemShort(); }); await sleep(700);
      ok(await p.evaluate(() => /not open in this app yet/i.test(document.getElementById("modal").innerText) && !document.querySelector("#modal .pk")), label + ": 'Not enough diamonds' says buying is not open yet (no packs that do nothing)");
      await money(p); ok(await p.evaluate(() => document.querySelectorAll("#shopBody .pk").length === 0 && document.querySelectorAll("#shopBody .xcard").length === 4), label + ": the Money page has only the exchange");
      await p.context().close();
    }
    // ---- 9) the texts are translated
    p = await phone(P, { lang: "ru-RU", save: { lang: "ru" } }); await sleep(500);
    const ru = await p.evaluate(() => { LANG = "ru"; return [T("To'lov kutilmoqda"), T("Xarid bo'lmadi"), T("Bu xarid boshqa hisobga tegishli"), T("To'lov Google Play orqali. Olmos hisobingizga avtomatik tushadi.")].join(" | "); });
    ok(/Платёж ожидается/.test(ru) && /Покупка не удалась/.test(ru) && /другому аккаунту/.test(ru) && /Google Play/.test(ru), "the new texts are translated (ru)", ru);
    const tr = await p.evaluate(() => { LANG = "tr"; return [T("To'lov kutilmoqda"), T("Xarid bo'lmadi")].join(" | "); });
    ok(/Ödeme bekleniyor/.test(tr) && /Satın alma başarısız/.test(tr), "...and tr", tr);
    await p.context().close();
    ok(errs.length === 0, "no page errors", errs);
  } finally { srv.kill(); srv2.kill(); fake.close(); await b.close(); for (const d of [tmp, tmp2]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
