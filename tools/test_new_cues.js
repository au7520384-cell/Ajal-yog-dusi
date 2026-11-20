#!/usr/bin/env node
// The 29 new glowing cues (the owner's sheet, Nov 20: "make these for money, the most expensive 3000"):  node tools/test_new_cues.js   (about 2 minutes; NC_SHOTS=<folder> saves screenshots)
// Checks: 29 cues nc_01..nc_29 with a picture each (thick butt, thin tip), unique names, Premium-page cues sold for 💵 CASH only (the owner: "qog'ozli pul"): 200 .. 3000 💵, the dearest exactly 3000, no 💎 / card price
// / server SKU, stats follow the price; EVERY older cue keeps its price / stats (compared with the page of commit 919cd9c) and server/prices.json is unchanged; the Premium page shows a 💵 button with the price;
// 1 💵 too little buys nothing, exactly enough buys it (💎 untouched) and equips it; it is used in a match (and shown in the in-match cue picker); Try works; no page errors.
const { chromium } = require("playwright"), { spawn, execSync } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8672, BASE = "919cd9c";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const shots = process.env.NC_SHOTS; if (shots) fs.mkdirSync(shots, { recursive: true });
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8nc-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" });
  await sleep(2800);
  const b = await chromium.launch(), errs = [];
  const catalog = () => CUES.map(c => [c.id, c.cat, c.cur, c.usd, c.gems, c.cash, c.price, (c.st || []).join(","), c.name]);
  try {
    // ---- the page of the commit before the new cues: the catalog of every older cue
    const oldFile = path.join(tmp, "old_index.html"); fs.writeFileSync(oldFile, execSync(`git -C ${ROOT} show ${BASE}:index.html`, { maxBuffer: 1 << 29 }));
    const op = await (await b.newContext({ serviceWorkers: "block" })).newPage();
    await op.goto("file://" + oldFile, { waitUntil: "commit" });
    await op.waitForFunction(() => typeof profile !== "undefined" && typeof CUES !== "undefined", null, { timeout: 120000 });
    const oldCat = await op.evaluate(catalog); await op.context().close();

    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(() => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000, gems: 0, cash: 0 })); });
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1500);

    // ---- the catalog
    const newCat = await p.evaluate(catalog), nc = newCat.filter(c => /^nc_\d\d$/.test(c[0])), rest = newCat.filter(c => !/^nc_\d\d$/.test(c[0]));
    ok(nc.length === 29 && nc.every((c, i) => c[0] === "nc_" + String(i + 1).padStart(2, "0")), "29 new cues nc_01 .. nc_29", nc.map(c => c[0]));
    ok(JSON.stringify(rest) === JSON.stringify(oldCat), "every older cue keeps its category, price, 💎, stats and name (same catalog as before)", { old: oldCat.length, now: rest.length, diff: rest.filter((c, i) => JSON.stringify(c) !== JSON.stringify(oldCat[i])).slice(0, 3) });
    const names = newCat.map(c => c[8]); ok(nc.every(c => names.filter(n => n === c[8]).length === 1), "no new cue has the name of another cue", nc.filter(c => names.filter(n => n === c[8]).length !== 1).map(c => c[8]));
    ok(nc.every(c => c[1] === "premium" && c[2] === "cash"), "all new cues are Premium-page cues");
    const cash = nc.map(c => c[6]); ok(Math.max(...cash) === 3000 && cash.filter(g => g === 3000).length === 2 && Math.min(...cash) === 200 && cash.every(g => [200, 400, 600, 1000, 1500, 2250, 3000].includes(g)) && nc.every(c => c[5] === c[6]), "💵 prices: 200 … 3000, the dearest exactly 3000", [...new Set(cash)]);
    ok(nc.every(c => c[3] == null && c[4] == null), "no new cue has a 💎 or a dollar (card) price", nc.filter(c => c[3] != null || c[4] != null).map(c => c[0]));
    const tot = { 200: 25, 400: 28, 600: 30, 1000: 33, 1500: 35, 2250: 38, 3000: 39 };
    ok(nc.every(c => { const st = c[7].split(",").map(Number); return st.length === 4 && st.reduce((a, v) => a + v, 0) === tot[c[6]] && st.every(v => v >= 1 && v <= 10); }), "stats follow the price step (same price = same strength, a dearer step is stronger)", nc.map(c => [c[6], c[7]]).slice(0, 4));
    const art = await p.evaluate(async () => { const n = CUES.filter(c => c.nc); await Promise.all(n.map(c => { cueArtEl(c); return c._ae && c._ae._p; })); return n.map(c => { const e = cueArtEl(c); return e ? [e.naturalWidth, e.naturalHeight] : null; }); });
    ok(art.length === 29 && art.every(a => a && a[0] === 1160 && a[1] >= 40 && a[1] <= 110), "every new cue has its picture (1160 px long, butt left / tip right like the others) and it decodes", art.filter(a => !a || a[0] !== 1160));
    // the picture keeps the cue's real shape: thick butt (left, with its metal rings), tapering to the thin tip (right). A uniform stick is what the owner complained about ("ushlaydigan va uraydigan tomonini bir xil qilib qo'ygansan")
    const prof = await p.evaluate(() => CUES.filter(c => c.nc).map(c => { const e = cueArtEl(c), cv = document.createElement("canvas"); cv.width = e.naturalWidth; cv.height = e.naturalHeight; const g = cv.getContext("2d"); g.drawImage(e, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data, th = f => { const x = Math.min(cv.width - 1, Math.round(cv.width * f)); let n = 0; for (let y = 0; y < cv.height; y++) if (d[(y * cv.width + x) * 4 + 3] > 128) n++; return n; };
      return { id: c.id, butt: th(0.05), body: th(0.25), taper: th(0.9), tip: th(0.97) }; }));
    ok(prof.length === 29 && prof.every(q => q.butt >= 40 && q.body >= 40 && q.taper <= 34 && q.tip <= 30 && q.body >= 1.5 * q.tip && q.butt >= 1.5 * q.tip), "every picture is thick at the butt (>= 40 px) and tapers to a thin tip (<= 30 px, at most 2/3 of the butt): not a uniform stick", prof.filter(q => !(q.butt >= 40 && q.body >= 40 && q.taper <= 34 && q.tip <= 30 && q.body >= 1.5 * q.tip && q.butt >= 1.5 * q.tip)).slice(0, 4));
    const prices = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "prices.json"), "utf8"));
    ok(!Object.keys(prices).some(k => /^cue_nc_/.test(k)), "server/prices.json has no card price for the new cues (they are sold for 💵 only)", Object.keys(prices).filter(k => /^cue_nc_/.test(k)).slice(0, 3));
    const oldPrices = JSON.parse(execSync(`git -C ${ROOT} show ${BASE}:server/prices.json`).toString());
    ok(Object.entries(oldPrices).every(([k, v]) => prices[k] === v), "no older item changed its card price", Object.entries(oldPrices).filter(([k, v]) => prices[k] !== v).slice(0, 3));
    ok(Object.keys(prices).length === Object.keys(oldPrices).length, "…and nothing was added to prices.json", [Object.keys(prices).length, Object.keys(oldPrices).length]);

    // ---- the Premium shop page
    await p.evaluate(() => { go("shop"); cueCat = "premium"; buildShop("cues"); }); await sleep(1500);
    const rows = await p.evaluate(() => [...document.querySelectorAll("#shopBody .cuerow.pcrow")].map(r => ({ n: (r.querySelector(".cuettl b") || {}).textContent || "", t: r.innerText.replace(/\s+/g, " ") })));
    const names29 = await p.evaluate(() => CUES.filter(c => c.nc).map(c => T(c.name)));   // (some names have a translation: Chaqmoq = Lightning ...)
    ok(names29.every(n => rows.some(r => r.n.includes(n))), "the Premium page lists all 29 new cues", names29.filter(n => !rows.some(r => r.n.includes(n))));
    const rowOf = id => rows.find(r => r.n.includes(names29[id - 1]));
    ok(rowOf(19) && /\b3\s?000\b/.test(rowOf(19).t) && rowOf(2) && /\b200\b/.test(rowOf(2).t) && !/💎|\$\d/.test(rowOf(19).t + rowOf(2).t), "a card shows its price in 💵 only: nc_19 3 000, nc_02 200 (no 💎, no $)", [rowOf(19), rowOf(2)].map(r => r && r.t.slice(0, 110)));
    ok(await p.evaluate(() => { const r = [...document.querySelectorAll("#shopBody .cuerow.pcrow")].find(r => (r.querySelector(".cuettl b") || {}).textContent.includes("Qirol Sakkizligi")); return !!r.querySelector('[data-p="cash"] .cash') && !r.querySelector('[data-p="gems"]') && !r.querySelector('[data-p="usd"]'); }), "the card has a 💵 (banknote) button and no 💎 / $ button");
    // scroll to the top one: the card draws its picture
    const shot = async (name, id) => { await p.evaluate(id => { const r = [...document.querySelectorAll("#shopBody .cuerow.pcrow")].find(r => (r.querySelector(".cuettl b") || {}).textContent.includes(id)); if (r) r.scrollIntoView({ block: "center" }); }, id); await sleep(1400); if (shots) await p.screenshot({ path: path.join(shots, name) }); };
    await shot("shop_qirol_sakkizligi.png", names29[18]);
    const drawn = await p.evaluate(() => { const r = [...document.querySelectorAll("#shopBody .cuerow.pcrow")].find(r => (r.querySelector(".cuettl b") || {}).textContent.includes("Qirol Sakkizligi")); const cv = r && r.querySelector(".cuecvw canvas"); if (!cv) return null; const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return { w: cv.width, h: cv.height, opaque: n / (cv.width * cv.height) }; });
    ok(drawn && drawn.opaque > 0.03, "the card draws the cue's picture on its canvas", drawn);
    await shot("shop_oltin_toj.png", names29[0]); await shot("shop_chaqmoq.png", names29[1]);

    // ---- buying
    await p.evaluate(() => { profile.cash = 2999; profile.gems = 7; save(); }); await shot("shop_buy.png", names29[10]);
    const btn = id => p.evaluate(id => { const r = [...document.querySelectorAll("#shopBody .cuerow.pcrow")].find(r => (r.querySelector(".cuettl b") || {}).textContent.includes(id)); const b = r && r.querySelector('[data-p="cash"]'); if (!b) return false; b.click(); return true; }, id);
    ok(await btn("Qirol Sakkizligi"), "the 💵 button exists"); await sleep(600);
    ok(await p.evaluate(() => !profile.cues.includes("nc_19") && profile.cash === 2999 && profile.gems === 7 && !document.querySelector(".dstore")), "1 💵 too little: nothing is bought, nothing is taken", await p.evaluate(() => [profile.cash, profile.gems, profile.cues.includes("nc_19")]));
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); profile.cash = 3000; save(); buildShop("cues"); }); await sleep(900);
    ok(await btn("Qirol Sakkizligi"), "the 💵 button exists (3000 💵 in the wallet)"); await sleep(900);
    ok(await p.evaluate(() => profile.cues.includes("nc_19") && profile.cash === 0 && profile.gems === 7 && profile.cue === "nc_19"), "bought for exactly 3000 💵: owned, cash 0, 💎 untouched, equipped", await p.evaluate(() => [profile.cash, profile.gems, profile.cues.includes("nc_19"), profile.cue]));
    if (shots) await p.screenshot({ path: path.join(shots, "bought_modal.png") });
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); buildShop("cues"); }); await sleep(900);
    const own = await p.evaluate(() => { const r = [...document.querySelectorAll("#shopBody .cuerow.pcrow")].find(r => (r.querySelector(".cuettl b") || {}).textContent.includes("Qirol Sakkizligi")); return r ? r.innerText.replace(/\s+/g, " ") : null; });
    ok(own && /TANLANGAN|SELECTED|IN USE/i.test(own) && !/\b3\s?000\b/.test(own), "the owned card says it is selected and no longer sells it", own);
    await p.evaluate(() => { cueCat = "owned"; buildShop("cues"); }); await sleep(900);
    ok(await p.evaluate(() => [...document.querySelectorAll("#shopBody .cuerow")].some(r => r.innerText.includes("Qirol Sakkizligi"))), "the 'Meniki' (owned) tab lists it");
    await p.evaluate(() => { cueCat = "premium"; });

    // ---- in a match
    await p.evaluate(() => { profile.cues.push("nc_06"); profile.cue = "nc_06"; save(); toMenu(); startMatch("ai", CITIES[0], botPlayer(1, 4)); }); await sleep(2500);
    ok(await p.evaluate(() => !!game && !game.demo && cueDef(barCue(game)).id === "nc_06" && cueDef(stickOf(game, game.players.find(q => !q.isAI))).id === "nc_06"), "a match uses the equipped new cue (my stick; the bot has its own)", await p.evaluate(() => game && cueDef(barCue(game)).id));
    const draw = await p.evaluate(() => { const cv = document.createElement("canvas"); cv.width = 900; cv.height = 90; const g = cv.getContext("2d"), sv = ctx; ctx = g; try { g.setTransform(1, 0, 0, 1, 20, 45); drawCueStick(g, 800, cueDef("nc_06"), 1); } finally { ctx = sv; } const d = g.getImageData(0, 0, 900, 90).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
    ok(draw > 2000, "drawCueStick paints the illustrated cue", draw);
    let listed = false;   // (the picker opens only while no ball moves: the bot may break first, so try until the table rests)
    for (let i = 0; i < 40 && !listed; i++) { listed = await p.evaluate(() => { if (!game || game.moving) return false; cuePicker(); const l = document.getElementById("pickList"); return !!l && l.innerText.includes("Qora Sakkizlik"); }); if (!listed) await sleep(700); }
    ok(listed, "the in-match cue picker lists the owned new cue");
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu(); }); await sleep(900);
    // Try (a trial match with a cue that is not owned)
    await p.evaluate(() => { tryCue(cueDef("nc_11")); }); await sleep(2500);
    ok(await p.evaluate(() => !!game && !game.demo), "'Sinab ko'rish' starts a trial match with a cue that is not owned");
    await p.evaluate(() => { toMenu(); }); await sleep(800);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();
  } finally { srv.kill(); await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("pass " + pass + ", fail " + fail); process.exit(fail ? 1 : 0);
})();
