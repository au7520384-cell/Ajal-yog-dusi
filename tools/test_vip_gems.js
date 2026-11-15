#!/usr/bin/env node
// A VIP pack for 💎 diamonds in the ANDROID APP:  node tools/test_vip_gems.js   (B8_ROOT=<repo copy>)
// The owner: "abbdayam olmosda sotib olaydigon qilib qo'y": the app has no card payments, its VIP window said "Tez orada". Now the buy button of the tall VIP window is "Hammasini olish 💎 N" (N = the pack's dollar price x 50),
// a confirm window comes first, then the pack gives what the card order gives (the server's SKU: coins, 💵, VIP points, the cue + its frame / table / zodiac avatar, golden shots, surprise boxes). Not enough 💎: the diamond store.
// Real server + Chromium (the app = CARD_PAY false + a fake Capacitor):
//  - app: the 💎 button, no "$" anywhere; "Yopish" in the confirm window charges nothing; the confirm charges once (a second tap on the same button does nothing) and gives the whole pack; the window then says the cue is yours; too few 💎 open the diamond store and charge nothing
//  - for EVERY page of the pager (18 + 64) what the client gives equals the server's SKU (so a pack costs the same and gives the same whichever way it is bought)
//  - web (card build): the $ button as before, no 💎 button; a Y8 page: still "Tez orada"
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8688;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8vg-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2800);
  const skus = (await (await fetch(`http://localhost:${P}/api/skus`)).json()).skus;
  const b = await chromium.launch(), errs = [];
  const phone = async (kind, gems) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(kind + ": " + e.message.slice(0, 200)));
    await p.addInitScript(([app, g]) => {
      if (app) window.Capacitor = { isNativePlatform: () => true, Plugins: { Browser: { async open() {}, async close() {}, async addListener() { return { remove() {} }; } },
        NativePurchases: { async isBillingSupported() { return { isBillingSupported: true }; }, async getProducts() { return { products: [] }; }, async getPurchases() { return { purchases: [] }; }, async purchaseProduct() { throw new Error("not in this test"); }, async consumePurchase() {} } } };   // (Google Play Billing is there: the diamond store can open)
      if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000, cash: 0, gems: g, cues: ["start"], cue: "start" }));
    }, [kind === "app", gems]);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    if (kind !== "web") await p.route(`http://localhost:${P}/`, async route => { const r = await route.fetch(); const body = (await r.text()).replace("const CARD_PAY = true,", "const CARD_PAY = false,"); await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body }); });
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit", referer: kind === "y8" ? "https://www.y8.com/" : undefined });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { vipShownSession = true; });   // (no launch window in the way)
    await sleep(500); await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(2500);
    await p.evaluate(g => { document.getElementById("modal").classList.remove("on"); const t = document.getElementById("toasts"); if (t) t.style.display = "none"; profile.gems = g; save(); }, gems); await sleep(300);
    return p;
  };
  const snap = p => p.evaluate(() => ({ gems: profile.gems | 0, coins: profile.coins, cash: profile.cash | 0, vip: profile.vip | 0, gold: profile.goldShots | 0, sboxes: profile.sboxes | 0, cues: [...profile.cues], frames: [...profile.frames], tables: [...(profile.tables || [])], avs: [...profile.avs], cue: profile.cue, frame: profile.frame }));
  const win = p => p.evaluate(() => ({ vipWin: !!document.querySelector("#modal.on .hwin"), dollars: /\$\s?\d/.test(document.getElementById("modal").innerText), buyD: (document.getElementById("hBuyD") || {}).textContent || "", buy: (document.getElementById("hBuy") || {}).textContent || "", soon: !!document.querySelector(".hbuy small:not(.hend)"), own: !!document.querySelector(".hbuy b"), store: !!document.querySelector("#modal.on .dstore"), conf: [...document.querySelectorAll("#mBtns .btn")].map(x => x.textContent.trim()) }));
  try {
    // ================= the app
    {
      const p = await phone("app", 5000); await p.evaluate(() => vipOffers("sport")); await sleep(700);
      const page = await p.evaluate(() => { const o = VOP()[vipPage % VOP().length], t = o.tiers[0]; return { id: o.id, t, price: vipGems(t) }; });
      const w0 = await win(p);
      ok(w0.vipWin && /💎/.test(w0.buyD) && w0.buyD.replace(/\D/g, "") === String(page.price) && !w0.soon && !w0.dollars && !w0.buy, `app: the VIP window sells the pack for ${page.price} 💎 (no "Tez orada", no $)`, { w0, page: page.id });
      ok(page.price === Math.max(5, Math.round(page.t.usd * 50 / 5) * 5), "the price is the dollar price x 50 (rounded to 5)", page);
      const before = await snap(p), sku = skus[page.t.sku];
      await p.evaluate(() => document.getElementById("hBuyD").click()); await sleep(600);
      const wc = await win(p);
      ok(!wc.vipWin && wc.conf.length === 2 && wc.conf[0].replace(/\D/g, "") === String(page.price), "a confirm window with the price and a close button comes first", wc);
      ok((await snap(p)).gems === before.gems, "nothing is charged before the confirm");
      await p.evaluate(() => [...document.querySelectorAll("#mBtns .btn")].find(x => x.classList.contains("gray")).click()); await sleep(500);
      ok((await win(p)).vipWin && (await snap(p)).gems === before.gems, "closing the confirm brings the VIP window back and charges nothing");
      await p.evaluate(() => document.getElementById("hBuyD").click()); await sleep(600);
      await p.evaluate(() => { const b = document.querySelector("#mBtns .green"); window.__cb = b; b.click(); b.click(); }); await sleep(900);   // (a second tap on the same button)
      const a = await snap(p), g = skus[page.t.sku];
      ok(before.gems - a.gems === page.price, `the 💎 are charged once (${before.gems} -> ${a.gems})`, { before: before.gems, after: a.gems });
      ok(a.coins - before.coins === g.coins && a.cash - before.cash === g.cash && a.vip - before.vip === g.vip, "coins, 💵 and VIP points are those of the server's SKU", { d: [a.coins - before.coins, a.cash - before.cash, a.vip - before.vip], sku: [g.coins, g.cash, g.vip] });
      ok(a.cues.includes(g.items.cues[0]) && a.cue === g.items.cues[0], "the VIP cue is owned and equipped", a.cues.slice(-3));
      const fi = await p.evaluate(id => frameIdx(id), g.items.pframes[0]);
      ok(a.frames.includes(fi) && a.tables.includes(g.items.tables[0]), "its frame and table are owned", { fi, tables: a.tables });
      ok(a.gold - before.gold === (g.items.goldShots | 0) && a.sboxes - before.sboxes === (g.items.sboxes | 0), "golden shots and surprise boxes are added", { gold: [before.gold, a.gold, g.items.goldShots], sboxes: [before.sboxes, a.sboxes, g.items.sboxes] });
      const w1 = await win(p);
      ok(w1.vipWin && w1.own && !w1.buyD, "the window now says the cue is yours (no buy button)", w1);
      // the zodiac pack also gives the avatar
      await p.evaluate(() => { vipSel.zodiac = 3; vipOffers("zodiac"); }); await sleep(600);
      const zb = await snap(p), zt = await p.evaluate(() => { const o = VOP()[vipPage % VOP().length]; return { sku: o.tiers[0].sku, avatar: o.tiers[0].avatar, price: vipGems(o.tiers[0]) }; });
      await p.evaluate(() => document.getElementById("hBuyD").click()); await sleep(500); await p.evaluate(() => document.querySelector("#mBtns .green").click()); await sleep(800);
      const za = await snap(p);
      ok(zb.gems - za.gems === zt.price && za.avs.includes(zt.avatar) && !zb.avs.includes(zt.avatar), `a zodiac pack (${zt.sku}) also gives its avatar`, { zt, avsBefore: zb.avs.length, avsAfter: za.avs.length });
      // too few diamonds: the diamond store, nothing charged
      await p.evaluate(() => { profile.gems = 100; vipOffers("atom"); }); await sleep(600);
      const lb = await snap(p); await p.evaluate(() => document.getElementById("hBuyD").click()); await sleep(900);
      const ws = await win(p), la = await snap(p);
      ok(ws.store && la.gems === 100 && la.cues.length === lb.cues.length, "too few 💎: the diamond store opens, nothing is charged or given", { ws, lb: lb.gems, la: la.gems });
      // a grant that throws: nothing is charged and nothing is given (the pack is applied first, the 💎 are taken after it worked)
      await p.evaluate(() => { profile.gems = 5000; vipOffers("atom"); }); await sleep(600);   // (the atom pack: not bought yet)
      const rb = await snap(p); await p.evaluate(() => { window.__ag = Net.applyGrant; Net.applyGrant = () => { throw new Error("boom"); }; });
      await p.evaluate(() => document.getElementById("hBuyD").click()); await sleep(500); await p.evaluate(() => document.querySelector("#mBtns .green").click()); await sleep(900);
      const ra = await snap(p); await p.evaluate(() => { Net.applyGrant = window.__ag; });
      ok(ra.gems === rb.gems && ra.cues.length === rb.cues.length && ra.coins === rb.coins, "a failing grant charges no 💎 and grants nothing", { rb: [rb.gems, rb.cues.length, rb.coins], ra: [ra.gems, ra.cues.length, ra.coins] });
      await p.context().close();
    }
    // ================= parity: every page of the pager gives what the server's SKU gives
    {
      const p = await phone("app", 100);
      const rows = await p.evaluate(() => VOP().map(o => { const t = o.tiers[0]; return { sku: t.sku, usd: cardUsd(t.usd), price: vipGems(t), pack: vipPack(t) }; }));   // (the server's SKU carries the card price: base + $0.50)
      let bad = [], n = 0;
      for (const r of rows) { const s = skus[r.sku]; n++; if (!s) { bad.push([r.sku, "no such SKU on the server"]); continue; }
        const it = s.items || {}, k = r.pack.items, same = (a, b2) => JSON.stringify([].concat(a || [])) === JSON.stringify([].concat(b2 || []));
        if (r.pack.coins !== s.coins || r.pack.cash !== s.cash || r.pack.vip !== s.vip) bad.push([r.sku, "coins / cash / vip", [r.pack.coins, r.pack.cash, r.pack.vip], [s.coins, s.cash, s.vip]]);
        if (!same(k.cues, it.cues) || !same(k.pframes, it.pframes) || !same(k.tables, it.tables) || !same(k.avs, it.avs) || (k.goldShots | 0) !== (it.goldShots | 0) || (k.sboxes | 0) !== (it.sboxes | 0)) bad.push([r.sku, "items", k, it]);
        if (Math.abs(r.usd - s.usd) > 0.001) bad.push([r.sku, "price", r.usd, s.usd]); }
      ok(n === 82 && bad.length === 0, `all ${n} pages of the pager give exactly what the server's SKU gives (and its card price is the base price + $0.50)`, bad.slice(0, 3));
      await p.context().close();
    }
    // ================= web and Y8: unchanged
    for (const kind of ["web", "y8"]) {
      const p = await phone(kind, 5000); await p.evaluate(() => vipOffers("sport")); await sleep(700);
      const w = await win(p);
      if (kind === "web") ok(w.vipWin && /\$\d/.test(w.buy) && !w.buyD && !w.soon, "web: the $ buy button as before, no 💎 button", w);
      else ok(w.vipWin && w.soon && !w.buyD && !w.buy, "Y8: still \"Tez orada\" (nothing can be bought there)", w);
      await p.context().close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); await sleep(300); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
