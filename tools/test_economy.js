#!/usr/bin/env node
// The money rules of the game, in the page (real server + a browser):  node tools/test_economy.js
// The owner's rule: 💎 diamonds are the ONLY premium money, 50 per $1, NEVER given for free (only a purchase adds them); every premium cue / table / avatar / frame / box / pass is bought with 💎;
// 💵 cash does not exist any more (an old save is converted once); every free reward pays coins.
// Checks: an old save (cash + old gems) becomes 💎, there is no cash chip / cash button anywhere in the shop, the diamond packs are exactly 50 per $1 at their list price, every premium item costs its dollar price x 50 in 💎,
// buying with 💎 works and a shortage opens the "Not enough diamonds" window (with no packs where nothing can be bought: Android app / Y8), the exchange pays coins for 💎, no reward table / grant / prize adds 💎 (a purchase does), and the source has exactly the two places that may raise 💎.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8631;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8eco-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US" }), errs = [];
  const boot = async (save) => {
    const p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000, ...save });
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1500);
    return p;
  };
  try {
    // ---- 1) an old save: 40 💵 + 2 800 old gems (200 per $) = $2 + $14 = 800 💎 today
    let p = await boot({ cash: 40, gems: 2800, gemx: 1 });
    const s1 = await p.evaluate(() => ({ g: profile.gems, c: profile.cash || 0, dm: profile.dm1, coins: profile.coins }));
    ok(s1.g === 800 && s1.c === 0 && s1.dm === 1, "an old save (40 cash + 2 800 old gems) becomes 800 💎, no cash left", s1);
    await p.reload({ waitUntil: "commit" }); await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(1500);
    ok(await p.evaluate(() => profile.gems) === 800, "the conversion runs once (a reload does not change the balance)");
    ok(await p.evaluate(() => document.querySelectorAll(".money .mchip").length === 3 && !document.getElementById("cashTxt") && document.querySelectorAll(".money .cash").length === 1), "the top bar: 💎, the money chip (a shortcut to the packs, no balance) and 🪙");
    ok(await p.evaluate(() => document.getElementById("gemTxt").textContent.replace(/\D/g, "")) === "800", "the 💎 chip shows 800");
    // ---- 2) the shop: no cash anywhere, the packs
    const tabs = ["offers", "money", "free", "cues", "tables", "avatars", "frames", "stickers", "boxes"], cashSeen = [];
    await p.evaluate(() => go("shop")); await sleep(500);
    for (const t of tabs) {
      await p.evaluate(t => buildShop(t), t); await sleep(500);
      const h = await p.evaluate(() => document.getElementById("shopBody").innerHTML.replace(/data:image\/[^"')]+/g, ""));
      if (/class="cash"|💵|class="cash |Naqd pul|Cash/.test(h)) cashSeen.push(t);
    }
    ok(cashSeen.length === 0, "no cash icon / 💵 / 'Cash' on any shop page", cashSeen);
    // the shop's first page (⭐ Special offers) shows the same six gold-framed 💎 cards as the big store, each with a height of its own (the art must not run over the amount)
    await p.evaluate(() => buildShop("offers")); await sleep(500);
    const off = await p.evaluate(() => ({ cards: [...document.querySelectorAll("#shopBody .dsc")].map(k => (k.querySelector("[data-sku]") || {}).dataset.sku), old: document.querySelectorAll("#shopBody .packgrid.g3").length, hs: [...document.querySelectorAll("#shopBody .dsc")].map(k => Math.round(k.getBoundingClientRect().height)) }));
    ok(off.cards.length === 6 && off.cards.every(s => /^gems_/.test(s)) && off.old === 0 && off.hs.every(h => h >= 170), "the first shop page shows the six big 💎 cards (no old small packs), every card tall enough", off);
    await p.evaluate(() => buildShop("money")); await sleep(500);
    const packs = await p.evaluate(() => [[...document.querySelectorAll("#shopBody .packcol .pk")], [...document.querySelectorAll("#shopBody .dsc")].sort((a, b) => a.querySelector(".dsamt").textContent.replace(/\D/g, "") - b.querySelector(".dsamt").textContent.replace(/\D/g, ""))].map((c, i) => c.map(k => ({ sku: k.querySelector("[data-sku]").dataset.sku, amt: (i ? k.querySelector(".dsamt") : k.querySelector(".amt")).textContent.replace(/\D/g, ""), price: k.querySelector("[data-sku]").textContent.trim(), rib: !!k.querySelector(".rib") }))));
    ok(packs.length === 2 && packs[0].every(k => /^coins_/.test(k.sku)) && packs[1].every(k => /^gems_/.test(k.sku)), "the money page: coin packs | diamond packs (the cash column is gone)", packs.map(c => c.map(k => k.sku)));
    const want = { gems_100: "$1.99", gems_250: "$4.99", gems_500: "$9.99", gems_1000: "$19.99", gems_2500: "$49.99", gems_5000: "$99.99" };
    ok(packs[1].length === 6 && packs[1].every(k => want[k.sku] === k.price && +k.amt === +k.sku.slice(5) && !k.rib), "six diamond packs, each at exactly its list price and without a bonus ribbon", packs[1]);
    ok(packs[1].every(k => Math.abs(k.amt / +k.price.slice(1) - 50) < 0.6), "every pack is 50 💎 per $1 (100/$1.99 ... 5000/$99.99)", packs[1].map(k => (k.amt / +k.price.slice(1)).toFixed(2)));
    // the big diamond store (the 💎 chip and "Not enough diamonds"): six cards, the same list prices
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); go("home"); document.querySelector(".gemchip").click(); }); await sleep(900);
    const st1 = await p.evaluate(() => ({ cards: [...document.querySelectorAll("#modal .dstore .dsc")].map(k => k.querySelector("[data-sku]").dataset.sku + "=" + k.querySelector("[data-sku]").textContent.trim()), bal: document.querySelector("#modal .dsbal").textContent.replace(/\D/g, "") }));
    ok(st1.cards.join() === "gems_100=$1.99,gems_250=$4.99,gems_500=$9.99,gems_1000=$19.99,gems_2500=$49.99,gems_5000=$99.99" && +st1.bal === 800, "the 💎 chip opens the big diamond store: six cards in order, list prices, the balance on top", st1);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); profile.gems = 0; gemShort(); }); await sleep(700);
    ok(await p.evaluate(() => document.querySelectorAll("#modal .dstore .dsc").length === 6 && /Not enough diamonds/i.test(document.querySelector("#modal .dstore").innerText)), "'Not enough diamonds' opens the same store with the note");
    await p.evaluate(() => { profile.gems = 800; document.getElementById("modal").classList.remove("on"); go("shop"); }); await sleep(600);
    // ---- 3) every premium item costs its dollar price x 50 in 💎
    const pr = await p.evaluate(() => {
      const bad = [], chk = (kind, id, usd, g) => { if (!(usd > 0) || Math.abs(g - usd * 50) > 2.51) bad.push([kind, id, usd, g]); }, n = { t: 0, c: 0, f: 0 };
      for (const t of EXTRA_TABLES) if (t.tier) { chk("table", t.id, t.usd, t.gems); n.t++; }
      for (const c of PREMIUM_CUES) { chk("cue", c.id, c.usd, c.gems); n.c++; }
      for (const f of PREMIUM_FRAMES) { chk("frame", f.id, f.usd, f.gems); n.f++; }
      const cashCues = CUES.filter(c => c.cur === "cash" && c.price > 0 && ["standard", "horror", "premium", "country"].includes(c.cat)); for (const c of cashCues) chk("cue", c.id, c.usd, c.gems);
      return { bad, n, ex: [EXTRA_TABLES.find(t => t.id === "l_brz").gems, EXTRA_TABLES.find(t => t.id === "l_opl").gems, SKUS.gems_250.gems, diaFor(4.99), diaFor(1.99), cashCues.length] };
    });
    ok(pr.bad.length === 0 && pr.n.t >= 30 && pr.n.c >= 12 && pr.n.f >= 12, "every premium table / cue / frame / country cue costs dollars x 50 in 💎", pr);
    ok(pr.ex[0] === 250 && pr.ex[1] === 2500 && pr.ex[3] === 250 && pr.ex[4] === 100, "the Bronze table ($4.99) = 250 💎, the Rainbow Opal ($49.99) = 2 500 💎", pr.ex);
    // ---- 4) buying with 💎 and the shortage window
    await p.evaluate(() => { profile.gems = 1000; profile.avs = profile.avs || []; save(); updateNav(); buildShop("avatars"); }); await sleep(800);
    const av0 = await p.evaluate(() => ({ g: profile.gems, n: (profile.avs || []).length, btn: (document.querySelector('#shopBody [data-p="gems"]') || {}).textContent }));
    ok(!!av0.btn && /💎/.test(av0.btn), "the avatar shop has 💎 buttons (and no cash button)", av0);
    const price = +String(av0.btn).replace(/\D/g, "");
    await p.click('#shopBody [data-p="gems"]'); await sleep(900);
    const av1 = await p.evaluate(() => ({ g: profile.gems, n: (profile.avs || []).length }));
    ok(av1.g === 1000 - price && av1.n === av0.n + 1, "buying an avatar takes exactly its 💎 price and gives the avatar", { price, av0, av1 });
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); profile.gems = 0; save(); updateNav(); buildShop("avatars"); }); await sleep(600);
    await p.click('#shopBody [data-p="gems"]'); await sleep(700);
    const sh = await p.evaluate(() => ({ g: profile.gems, open: document.getElementById("modal").classList.contains("on"), txt: (document.querySelector("#modal .panel") || {}).innerText || "" }));
    ok(sh.g === 0 && sh.open && /Not enough diamonds/i.test(sh.txt) && /\$1\.99/.test(sh.txt) && /50 💎 = \$1/.test(sh.txt), "with no 💎 the 'Not enough diamonds' window opens with the packs and the 50 💎 = $1 line", sh.txt.slice(0, 160));
    await p.evaluate(() => document.getElementById("modal").classList.remove("on"));
    // ---- 5) exchange: 💎 -> 🪙 only
    await p.evaluate(() => { profile.gems = 100; profile.coins = 5000; save(); updateNav(); buildShop("money"); }); await sleep(600);
    const xs = await p.evaluate(() => [...document.querySelectorAll("#shopBody [data-x]")].map(b => b.dataset.x));
    ok(xs.length === 4 && xs.every(x => /^gems,\d+,coins,\d+$/.test(x)), "the exchange cards are 💎 -> 🪙 only", xs);
    await p.click('#shopBody [data-x="gems,25,coins,10000"]'); await sleep(500);
    const ex1 = await p.evaluate(() => [profile.gems, profile.coins]); ok(ex1[0] === 75 && ex1[1] >= 15000 && ex1[1] < 16000, "25 💎 -> 10 000 🪙 (the 🪙 count passes 10 000: the \"rich\" achievement adds its own few coins)", ex1);
    // ---- 6) nothing free gives 💎
    const free = await p.evaluate(() => {
      const out = { bad: [], gemsBefore: profile.gems = 77 }, kinds = new Set();
      const look = (name, r) => { if (!r) return; kinds.add(r.k); if (r.k === "gems" || r.k === "cash") out.bad.push([name, r]); };
      for (let k = 0; k < ROAD_N; k++) look("road" + k, roadRew(k));
      for (let i = 0; i < 400; i++) { try { look("cp" + i, cpReward(i)); } catch (e) {} }
      for (let t = 1; t <= PASS_TIERS; t++) { look("passF" + t, passRew(t, false)); look("passP" + t, passRew(t, true)); }
      for (const r of REWARDS) if (r.t === "gems" || r.t === "cash") out.bad.push(["daily", r]);
      for (const w of WHEEL) if (w.t !== "coins") out.bad.push(["wheel", w]);
      for (const s of SCRATCH) if (s.t === "gems" || s.t === "cash") out.bad.push(["scratch", s]);
      for (const r of [...LUCKY_BASE, ...GOLDEN_RINGS]) if (r.t !== "coins") out.bad.push(["ring", r]);
      if (SD_MILESTONES.some(m => m[1].k === "gems" || m[1].k === "cash")) out.bad.push(["showdown"]);
      if (BRK_TIERS.some(m => m.cash || m.gems)) out.bad.push(["breaks"]);
      out.kinds = [...kinds].sort(); return out;
    });
    ok(free.bad.length === 0, "no reward table (trophy road, collection, pass, daily, wheel, scratch, rings, showdown, breaks) lists 💎 or cash", free.bad.slice(0, 4));
    const rw = await p.evaluate(() => {
      const c0 = profile.coins; profile.gems = 77; const r = {};
      giveReward({ k: "gems", v: 50 }); r.afterGems = [profile.gems, profile.coins - c0];
      const c1 = profile.coins; giveReward({ k: "cash", v: 5 }); r.afterCash = [profile.gems, profile.coins - c1];
      const c2 = profile.coins; giveReward2({ k: "gems", v: 9 }); r.afterGems2 = [profile.gems, profile.coins - c2];
      return r;
    });
    ok(rw.afterGems[0] === 77 && rw.afterGems[1] === 5000 && rw.afterCash[0] === 77 && rw.afterCash[1] === 5000 && rw.afterGems2[0] === 77 && rw.afterGems2[1] === 900, "an old reward table entry (50 gems / 5 cash) pays coins (x100 / x1 000), never 💎", rw);
    const gr = await p.evaluate(() => {
      const t = (g) => { const c0 = profile.coins, g0 = profile.gems = 77, v0 = profile.vip || 0; Net.applyGrant(g); return [profile.gems - g0, profile.coins - c0]; };
      return {
        weekly: t({ kind: "weekly", cash: 1500, coins: 0 }), club: t({ kind: "club", cash: 20 }), referral: t({ kind: "referral", coins: 5000, cash: 3, gems: 5 }), quiz: t({ kind: "quiz", coins: 300, cash: 1 }), league: t({ kind: "league", coins: 10000 }), gift: t({ kind: "gift", gems: 99, coins: 500 }),
        buy: t({ kind: "purchase", gems: 100, dm: 1 }), buyCash: t({ kind: "purchase", cash: 20 }), buyOldGems: t({ kind: "purchase", gems: 290 }), buyBundle: t({ kind: "purchase", coins: 100000, gems: 200, dm: 1, vip: 200 }),
      };
    });
    ok(gr.weekly[0] === 0 && gr.weekly[1] === 1500000 && gr.club[0] === 0 && gr.club[1] === 20000 && gr.referral[0] === 0 && gr.referral[1] === 8500 && gr.quiz[0] === 0 && gr.quiz[1] === 1300 && gr.league[0] === 0 && gr.gift[0] === 0 && gr.gift[1] === 10400,
      "a prize / referral / quiz / league / gift grant never adds 💎 (an old cash or gem amount in it is paid as coins)", gr);
    ok(gr.buy[0] === 100 && gr.buyCash[0] === 50 && gr.buyOldGems[0] === 73 && gr.buyBundle[0] === 200 && gr.buyBundle[1] === 100000, "a PURCHASE adds 💎: 100 (dm:1), old order 20 cash = 50, old order 290 gems = 73, a bundle 200", gr);
    ok(await p.evaluate(() => { const e = ELITE_ITEMS.find(i => i.id === "bg"), c0 = profile.coins, g0 = profile.gems; e.give(); return profile.gems === g0 && profile.coins - c0 === 50000 && !ELITE_ITEMS.some(i => i.id === "cash"); }), "the Elite gift is 50 000 coins, not 💎, and the cash item is gone");
    ok(await p.evaluate(() => { const g0 = profile.gems = 5; for (let i = 0; i < 6; i++) addXp(60000); return profile.gems === g0; }), "levelling up does not give 💎");
    ok(await p.evaluate(() => BOX_GEMS === 90 && GOLD_GEMS === 90 && SB_SKIP === 40 && STK_GEMS === 25 && PASS_GEMS === 700 && ELITE_GEMS === 500 && PAST_COST === 1000 && LIMITED_PRICE === 1875 && SCRATCH_PRICE === 5), "the other prices in 💎: box 90, golden shot 90, sticker pack 25, pass 700, Elite 500, past season 1 000, limited cue 1 875");
    // ---- 7) the source
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").split("\n"), up = [];
    src.forEach((l, i) => { if (/profile\.gems\s*(\+=|=(?!=))/.test(l) && !/^\s*\/\//.test(l)) up.push(l.trim()); });
    ok(up.length === 3 && up.every(l => /gDia|GEM_TO_DIA|\* 14/.test(l)), "profile.gems is raised in exactly 3 places: a purchase grant (applyGrant) and the two one-time save conversions", up.map(l => l.slice(0, 100)));
    const cashUse = src.filter(l => /profile\.cash/.test(l)).map(l => l.trim());
    ok(cashUse.length === 1 && /GEM_TO_DIA/.test(cashUse[0]), "profile.cash appears in one place only: the one-time save conversion", cashUse.map(l => l.slice(0, 100)));
    // ---- 8) the Android app / Y8 (no card payment): nothing sells 💎 there, so the shortage window says so instead of showing packs that do nothing
    {
      const q = await ctx.newPage(); q.on("pageerror", e => errs.push(e.message.slice(0, 160)));
      await q.goto(`http://localhost:${P}/`, { waitUntil: "commit", referer: "https://www.y8.com/" });
      await q.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(1500);
      const nc = await q.evaluate(() => { document.getElementById("modal").classList.remove("on"); profile.gems = 0; gemShort(); return { no: NO_CARD, txt: (document.querySelector("#modal .panel") || {}).innerText || "", packs: document.querySelectorAll("#modal [data-sku]").length }; });
      ok(nc.no === true && nc.packs === 0 && /Not enough diamonds/i.test(nc.txt) && /not open in this app yet/i.test(nc.txt), "without card payment (Android app / Y8) the shortage window has no packs that do nothing: it says buying diamonds is not open yet", nc);
    }
    ok(errs.length === 0, "no script error in the page", errs.slice(0, 3));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
