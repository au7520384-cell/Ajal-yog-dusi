#!/usr/bin/env node
// The money rules of the game, in the page (real server + a browser):  node tools/test_economy.js
// The owner's rules: TWO premium moneys. 💎 diamonds (50 per $1, NEVER given for free: only a purchase adds them) pay for premium / horror / country cues, premium tables and avatars (and for everything else too, as a second price);
// 💵 cash ($1 = 20 cash, hard to earn: a few at a time) pays for everything except those: frames, elite and special tables, boxes, sticker packs, surprise box, pass, gifts, emblems, limited cue ...
// Checks: an old save keeps its cash and turns its old gems into 💎, the top bar has the 💵 chip WITH a balance, cash is accepted on the right pages and NOT on avatars / premium, horror, country cues / premium tables, buying with cash and with 💎 works,
// the cash packs and the diamond packs are on the Money page at their list prices, the exchange (💵 -> 🪙, 💎 -> 💵, 💎 -> 🪙), cash rewards are back (daily gifts, wheel, rings, scratch, showdown, records, levels, prizes, referral, quiz), no reward / grant / prize ever adds 💎 (a purchase does).
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
    // ---- 1) an old save: 40 💵 + 2 800 old gems (200 per $ = $14) = 700 💎 today, the cash stays cash
    let p = await boot({ cash: 40, gems: 2800, gemx: 1 });
    const s1 = await p.evaluate(() => ({ g: profile.gems, c: profile.cash || 0, dm: profile.dm1, coins: profile.coins }));
    ok(s1.g === 700 && s1.c === 40 && s1.dm === 1, "an old save (40 cash + 2 800 old gems) keeps its 40 💵 and its old gems become 700 💎", s1);
    await p.reload({ waitUntil: "commit" }); await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(1500);
    ok(await p.evaluate(() => profile.gems) === 700 && await p.evaluate(() => profile.cash) === 40, "the conversion runs once (a reload does not change the balances)");
    ok(await p.evaluate(() => document.querySelectorAll(".money .mchip").length === 3 && !!document.getElementById("cashTxt") && document.querySelectorAll(".money .cash").length === 1), "the top bar: 💎, 💵 (with a balance) and 🪙");
    ok(await p.evaluate(() => document.getElementById("gemTxt").textContent.replace(/\D/g, "")) === "700" && await p.evaluate(() => document.getElementById("cashTxt").textContent.replace(/\D/g, "")) === "40", "the 💎 chip shows 700 and the 💵 chip shows 40");
    ok(await p.evaluate(() => { document.querySelector('.mchip:has(#cashTxt)').click(); return document.getElementById("shop").classList.contains("on"); }), "the 💵 chip opens the shop (Coins & Cash)");
    await p.evaluate(() => go("home")); await sleep(300);
    // ---- 2) the shop: no cash anywhere, the packs
    const tabs = ["offers", "money", "free", "cues", "tables", "avatars", "frames", "stickers", "boxes"], cashSeen = [];
    await p.evaluate(() => go("shop")); await sleep(500);
    for (const t of tabs) {
      await p.evaluate(t => buildShop(t), t); await sleep(500);
      const h = await p.evaluate(() => document.getElementById("shopBody").innerHTML.replace(/data:image\/[^"')]+/g, ""));
      if (/class="cash"|💵|class="cash |Naqd pul|Cash/.test(h)) cashSeen.push(t);
    }
    const withCash = tabs.filter(t => !cashSeen.includes(t));
    ok(["offers", "money", "tables", "frames", "stickers", "boxes"].every(t => cashSeen.includes(t)), "cash is priced on the Special offers, Coins & Cash, tables, frames, stickers and boxes pages", cashSeen);
    ok(!cashSeen.includes("avatars") && !cashSeen.includes("cues"), "...but NOT on the avatars page and the cues page (premium / horror / country cues are 💎 / real money only)", cashSeen);
    // the shop's first page (⭐ Special offers) shows the same six gold-framed 💎 cards as the big store, each with a height of its own (the art must not run over the amount)
    await p.evaluate(() => buildShop("offers")); await sleep(500);
    const off = await p.evaluate(() => ({ cards: [...document.querySelectorAll("#shopBody .dsc")].map(k => (k.querySelector("[data-sku]") || {}).dataset.sku), old: document.querySelectorAll("#shopBody .packgrid.g3").length, hs: [...document.querySelectorAll("#shopBody .dsc")].map(k => Math.round(k.getBoundingClientRect().height)) }));
    ok(off.cards.length === 6 && off.cards.every(s => /^gems_/.test(s)) && off.old === 0 && off.hs.every(h => h >= 170), "the first shop page shows the six big 💎 cards (no old small packs), every card tall enough", off);
    await p.evaluate(() => buildShop("money")); await sleep(500);
    const packs = await p.evaluate(() => [[...document.querySelectorAll("#shopBody .packcol .pk")], [...document.querySelectorAll("#shopBody .dsc")].sort((a, b) => a.querySelector(".dsamt").textContent.replace(/\D/g, "") - b.querySelector(".dsamt").textContent.replace(/\D/g, ""))].map((c, i) => c.map(k => ({ sku: k.querySelector("[data-sku]").dataset.sku, amt: (i ? k.querySelector(".dsamt") : k.querySelector(".amt")).textContent.replace(/\D/g, ""), price: k.querySelector("[data-sku]").textContent.trim(), rib: !!k.querySelector(".rib") }))));
    ok(packs.length === 2 && packs[0].filter(k => /^coins_/.test(k.sku)).length === 6 && packs[0].filter(k => /^cash_/.test(k.sku)).map(k => +k.amt).sort((a, b) => a - b).join() === "20,50,110,250,800,2000" && packs[1].every(k => /^gems_/.test(k.sku)), "the money page: coin packs | 💵 cash packs (20 / 50 / 110 / 250 / 800 / 2000) | diamond packs", packs.map(c => c.map(k => k.sku)));
    const want = { gems_100: "$1.99", gems_250: "$4.99", gems_500: "$9.99", gems_1000: "$19.99", gems_2500: "$49.99", gems_5000: "$99.99" };
    ok(packs[1].length === 6 && packs[1].every(k => want[k.sku] === k.price && +k.amt === +k.sku.slice(5) && !k.rib), "six diamond packs, each at exactly its list price and without a bonus ribbon", packs[1]);
    ok(packs[1].every(k => Math.abs(k.amt / +k.price.slice(1) - 50) < 0.6), "every pack is 50 💎 per $1 (100/$1.99 ... 5000/$99.99)", packs[1].map(k => (k.amt / +k.price.slice(1)).toFixed(2)));
    // the big diamond store (the 💎 chip and "Not enough diamonds"): six cards, the same list prices
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); go("home"); document.querySelector(".gemchip").click(); }); await sleep(900);
    const st1 = await p.evaluate(() => ({ cards: [...document.querySelectorAll("#modal .dstore .dsc")].map(k => k.querySelector("[data-sku]").dataset.sku + "=" + k.querySelector("[data-sku]").textContent.trim()), bal: document.querySelector("#modal .dsbal").textContent.replace(/\D/g, "") }));
    ok(st1.cards.join() === "gems_100=$1.99,gems_250=$4.99,gems_500=$9.99,gems_1000=$19.99,gems_2500=$49.99,gems_5000=$99.99" && +st1.bal === 700, "the 💎 chip opens the big diamond store: six cards in order, list prices, the balance on top", st1);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); profile.gems = 0; gemShort(); }); await sleep(700);
    ok(await p.evaluate(() => document.querySelectorAll("#modal .dstore .dsc").length === 6 && /Not enough diamonds/i.test(document.querySelector("#modal .dstore").innerText)), "'Not enough diamonds' opens the same store with the note");
    await p.evaluate(() => { profile.gems = 700; document.getElementById("modal").classList.remove("on"); go("shop"); }); await sleep(600);
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
    ok(!!av0.btn && /💎/.test(av0.btn) && await p.evaluate(() => !document.querySelector('#shopBody [data-p="cash"]')), "the avatar shop has 💎 buttons and no cash button", av0);
    const price = +String(av0.btn).replace(/\D/g, "");
    await p.click('#shopBody [data-p="gems"]'); await sleep(900);
    const av1 = await p.evaluate(() => ({ g: profile.gems, n: (profile.avs || []).length }));
    ok(av1.g === 1000 - price && av1.n === av0.n + 1, "buying an avatar takes exactly its 💎 price and gives the avatar", { price, av0, av1 });
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); profile.gems = 0; save(); updateNav(); buildShop("avatars"); }); await sleep(600);
    await p.click('#shopBody [data-p="gems"]'); await sleep(700);
    const sh = await p.evaluate(() => ({ g: profile.gems, open: document.getElementById("modal").classList.contains("on"), txt: (document.querySelector("#modal .panel") || {}).innerText || "" }));
    ok(sh.g === 0 && sh.open && /Not enough diamonds/i.test(sh.txt) && /\$1\.99/.test(sh.txt) && /50 💎 = \$1/.test(sh.txt), "with no 💎 the 'Not enough diamonds' window opens with the packs and the 50 💎 = $1 line", sh.txt.slice(0, 160));
    await p.evaluate(() => document.getElementById("modal").classList.remove("on"));
    // ---- 4b) buying with 💵 cash (an ordinary frame) and the shortage; where cash is NOT accepted
    const fr = await p.evaluate(() => { const i = FRAMES.findIndex(f => f.cur === "cash" && f.v > 0 && !f.prem && !f.pass && !f.vip && !f.ps && !EDITION_CAP[f.id]); return { i, v: FRAMES[i].v, g: FRAMES[i].gems }; });
    const fb = await p.evaluate(async ({ i, v }) => { profile.cash = v + 7; profile.gems = 0; profile.frames = [0]; save(); updateNav(); const r = await buyFrame(FRAMES[i], i, "cash", v); document.getElementById("modal").classList.remove("on"); return { r, cash: profile.cash, own: profile.frames.includes(i) }; }, fr);
    ok(fr.i > 0 && fb.r === true && fb.cash === 7 && fb.own, "buying a frame with 💵 takes exactly its cash price and gives the frame", { fr, fb });
    const fs2 = await p.evaluate(async ({ i, v }) => { toastQ.length = 0; profile.cash = v - 1; profile.frames = [0]; const r = await buyFrame(FRAMES[i], i, "cash", v); return { r, cash: profile.cash, own: profile.frames.includes(i), t: document.getElementById("toasts").innerText }; }, fr);
    ok(fs2.r === false && fs2.cash === fr.v - 1 && !fs2.own && /Not enough money/i.test(fs2.t), "with too little 💵 nothing is bought and the player is told so", fs2);
    for (const cat of ["premium", "horror", "country"]) { await p.evaluate(c => { cueCat = c; buildShop("cues"); }, cat); await sleep(700); ok(await p.evaluate(() => document.querySelectorAll('#shopBody [data-p="cash"]').length) === 0, `the ${cat} cue rows have no 💵 button`); }
    await p.evaluate(() => buildShop("tables")); await sleep(900);
    const tb = await p.evaluate(() => { const out = { prem: 0, premCash: 0, elite: 0, eliteCash: 0 }; document.querySelectorAll("#shopBody .tblcard").forEach(c => { if (!c.querySelector('[data-p="try"]')) return; const b = (c.querySelector("b") || {}).textContent || "", has = !!c.querySelector('[data-p="cash"]'); if (/^\s*👑/.test(b)) { out.prem++; if (has) out.premCash++; } else if (/^\s*✨/.test(b)) { out.elite++; if (has) out.eliteCash++; } }); return out; });
    ok(tb.prem > 5 && tb.premCash === 0 && tb.elite > 5 && tb.eliteCash === tb.elite, "premium tables have no 💵 button, elite tables do", tb);
    // ---- 5) exchange: 💵 -> 🪙, 💎 -> 💵, 💎 -> 🪙
    await p.evaluate(() => { profile.gems = 100; profile.cash = 40; profile.coins = 5000; save(); updateNav(); buildShop("money"); }); await sleep(600);
    const xs = await p.evaluate(() => [...document.querySelectorAll("#shopBody [data-x]")].map(b => b.dataset.x));
    ok(xs.length === 10 && xs.filter(x => /^cash,\d+,coins,\d+$/.test(x)).length === 4 && xs.filter(x => /^gems,\d+,cash,\d+$/.test(x)).length === 2 && xs.filter(x => /^gems,\d+,coins,\d+$/.test(x)).length === 4, "the exchange cards: 4 x 💵 -> 🪙, 2 x 💎 -> 💵, 4 x 💎 -> 🪙", xs);
    await p.click('#shopBody [data-x="gems,25,coins,10000"]'); await sleep(500);
    const ex1 = await p.evaluate(() => [profile.gems, profile.coins]); ok(ex1[0] === 75 && ex1[1] >= 15000 && ex1[1] < 16000, "25 💎 -> 10 000 🪙 (the 🪙 count passes 10 000: the \"rich\" achievement adds its own few coins)", ex1);
    await p.click('#shopBody [data-x="cash,10,coins,10000"]'); await sleep(500);
    const ex2 = await p.evaluate(() => [profile.cash, profile.coins]); ok(ex2[0] === 30 && ex2[1] >= 25000 && ex2[1] < 26500, "10 💵 -> 10 000 🪙", ex2);
    await p.click('#shopBody [data-x="gems,25,cash,10"]'); await sleep(500);
    const ex3 = await p.evaluate(() => [profile.gems, profile.cash]); ok(ex3[0] === 50 && ex3[1] === 40, "25 💎 -> 10 💵 (the same dollar value: 1 💵 = $0.05 = 2.5 💎)", ex3);
    // ---- 6) cash rewards are back, 💎 is never free
    const free = await p.evaluate(() => {
      const out = { bad: [], cashIn: [] }, look = (name, r) => { if (!r) return; if (r.k === "gems") out.bad.push([name, r]); if (r.k === "cash") out.cashIn.push(name); };
      for (let k = 0; k < ROAD_N; k++) look("road" + k, roadRew(k));
      for (let i = 0; i < 400; i++) { try { look("cp" + i, cpReward(i)); } catch (e) {} }
      for (let t = 1; t <= PASS_TIERS; t++) { look("passF" + t, passRew(t, false)); look("passP" + t, passRew(t, true)); }
      for (const r of REWARDS) if (r.t === "gems") out.bad.push(["daily", r]);
      for (const w of WHEEL) if (w.t === "gems") out.bad.push(["wheel", w]);
      for (const x of SCRATCH) if (x.t === "gems") out.bad.push(["scratch", x]);
      for (const r of [...LUCKY_BASE, ...GOLDEN_RINGS]) if (r.t === "gems") out.bad.push(["ring", r]);
      if (SD_MILESTONES.some(m => m[1].k === "gems")) out.bad.push(["showdown"]);
      if (BRK_TIERS.some(m => m.gems)) out.bad.push(["breaks"]);
      out.daily = REWARDS.map(r => r.t === "cash" ? r.v : 0); out.wheel = WHEEL.map(w => w.t === "cash" ? w.v : 0); out.rings = [LUCKY_BASE[0], ...GOLDEN_RINGS.slice(0, 2)].map(r => r.t === "cash" ? r.v : 0);
      out.scratch = SCRATCH.filter(x => x.t === "cash").map(x => x.v); out.sd = SD_MILESTONES.filter(m => m[1].k === "cash").map(m => m[1].v); out.brk = BRK_TIERS.map(t => t.cash | 0);
      return out;
    });
    ok(free.bad.length === 0, "no reward table (trophy road, collection, pass, daily, wheel, scratch, rings, showdown, breaks) lists 💎", free.bad.slice(0, 4));
    ok(free.cashIn.length > 10, "the trophy road / collection / pass pay 💵 again", free.cashIn.length);
    ok(free.daily.join() === "0,0,0,1,0,0,2,0" && free.wheel.join() === "0,0,1,0,0,0,5,0" && free.rings.join() === "3,10,5" && free.scratch.join() === "2" && free.sd.join() === "3,8" && free.brk.join() === "0,0,3,20", "cash is back where it was: daily gifts 1 / 2, wheel 1 / 5, rings 3 / 10 / 5, scratch 2, showdown 3 / 8, break records 3 / 20", free);
    const rw = await p.evaluate(() => {
      const c0 = profile.coins, h0 = profile.cash = 10; profile.gems = 77; const r = {};
      giveReward({ k: "gems", v: 50 }); r.afterGems = [profile.gems, profile.coins - c0];
      giveReward({ k: "cash", v: 5 }); r.afterCash = [profile.gems, profile.cash - h0];
      const c2 = profile.coins; giveReward2({ k: "gems", v: 9 }); r.afterGems2 = [profile.gems, profile.coins - c2];
      return r;
    });
    ok(rw.afterGems[0] === 77 && rw.afterGems[1] === 5000 && rw.afterCash[0] === 77 && rw.afterCash[1] === 5 && rw.afterGems2[0] === 77 && rw.afterGems2[1] === 900, "an old gem reward pays coins (x100), never 💎; a cash reward pays 💵", rw);
    const gr = await p.evaluate(() => {
      const t = (g) => { const c0 = profile.coins, g0 = profile.gems = 77, h0 = profile.cash = 0; Net.applyGrant(g); return [profile.gems - g0, profile.coins - c0, profile.cash - h0]; };
      return {
        weekly: t({ kind: "weekly", cash: 1500, coins: 0 }), club: t({ kind: "club", cash: 20 }), referral: t({ kind: "referral", coins: 5000, cash: 3, gems: 5 }), quiz: t({ kind: "quiz", coins: 300, cash: 1 }), league: t({ kind: "league", coins: 10000 }), gift: t({ kind: "gift", gems: 99, coins: 500 }),
        buy: t({ kind: "purchase", gems: 100, dm: 1 }), buyCash: t({ kind: "purchase", cash: 20 }), buyOldGems: t({ kind: "purchase", gems: 290 }), buyBundle: t({ kind: "purchase", coins: 100000, cash: 50, gems: 70, dm: 1, vip: 200 }),
      };
    });
    ok(gr.weekly.join() === "0,0,1500" && gr.club.join() === "0,0,20" && gr.referral.join() === "0,5500,3" && gr.quiz.join() === "0,300,1" && gr.league.join() === "0,10000,0" && gr.gift.join() === "0,10400,0",
      "a prize / referral / quiz / league / gift grant pays 💵 and coins but never adds 💎 (a gem amount in it is paid as coins)", gr);
    ok(gr.buy[0] === 100 && gr.buyCash.join() === "0,0,20" && gr.buyOldGems[0] === 73 && gr.buyBundle.join() === "70,100000,50", "a PURCHASE adds what was bought: 100 💎 (dm:1), 20 💵, an old order of 290 gems = 73 💎, a bundle 70 💎 + 50 💵 + coins", gr);
    ok(await p.evaluate(() => { const e = ELITE_ITEMS.find(i => i.id === "bg"), c0 = profile.coins, g0 = profile.gems, h0 = profile.cash = 0; e.give(); const a = profile.gems === g0 && profile.coins - c0 === 50000; ELITE_ITEMS.find(i => i.id === "cash").give(); return a && profile.cash === 50; }), "the Elite gift is 50 000 coins, not 💎; the Elite shop sells 50 💵 for 💎");
    ok(await p.evaluate(() => { const g0 = profile.gems = 5, h0 = profile.cash = 0, lv0 = profile.level = 1; profile.xp = 0; for (let i = 0; i < 8; i++) addXp(60000); return profile.gems === g0 && profile.cash > 0 && profile.level >= 10; }), "levelling up does not give 💎 but pays 💵 on every 10th level");
    ok(await p.evaluate(() => BOX_GEMS === 90 && GOLD_GEMS === 90 && SB_SKIP === 40 && STK_GEMS === 25 && PASS_GEMS === 700 && ELITE_GEMS === 500 && PAST_COST === 1000 && LIMITED_PRICE === 1875 && SCRATCH_PRICE === 5), "the prices in 💎: box 90, golden shot 90, sticker pack 25, pass 700, Elite 500, past season 1 000, limited cue 1 875");
    ok(await p.evaluate(() => SURPRISE_BOX === 20 && SB_SKIP_CASH === 15 && STK_CASH === 10 && PASS_PRICE === 600 && PAST_CASH === 400 && LIMITED_CASH === 750 && SCRATCH_CASH === 1 && CLUB_CASH.join() === "0,40,200"), "the prices in 💵 (as before): surprise box 20, sticker pack 10, pass 600, past season 400, limited cue 750, scratch +1 = 1, club emblems 40 / 200");
    ok(await p.evaluate(() => { profile.cash = 25; profile.gems = 0; profile.sboxes = 0; return typeof openSurpriseBox === "function"; }), "(the surprise box page loads)");
    // ---- 7) the source
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").split("\n"), up = [];
    src.forEach((l, i) => { if (/profile\.gems\s*(\+=|=(?!=))/.test(l) && !/^\s*\/\//.test(l)) up.push(l.trim()); });
    ok(up.length === 3 && up.every(l => /gDia|GEM_TO_DIA|\* 14/.test(l)), "profile.gems is raised in exactly 3 places: a purchase grant (applyGrant) and the two one-time save conversions", up.map(l => l.slice(0, 100)));
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
