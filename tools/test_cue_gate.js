#!/usr/bin/env node
// The cue lock by ⚜ Collection Power (the 8 Ball Pool rule), in the page (real server + a browser):  node tools/test_cue_gate.js
// A coin-sold Standard cue stays LOCKED, even with the coins in hand, until the player's ⚜ Collection Power reaches the cue's `needCP`
// (55% of the ⚜ of every cue in the cheaper steps, rounded to 10; the cheapest step is always open). 💎 cues, owned cues and every other cue are never locked.
// Checks: the nine price steps and their needCP (data), the shop rows (padlock button "+N ⚜", grey picture, the ⚜ now / needed), a click on a locked cue buys nothing and says so,
// the unlock after enough cues, an owned cue is never locked, a 💎 cue is open at ⚜ 0, a stale row (rendered when the power was high) is refused too, the in-match cue picker has the same lock, the texts follow the language.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8641;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cue-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US" }), errs = [];
  const boot = async (save) => {
    const p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 20e9, ...save });
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1500);
    return p;
  };
  // the standard coin ladder, as the page built it: [[id, price, needCP] x 5] per step
  const ladder = p => p.evaluate(() => { const coin = CUES.filter(c => c.cat === "standard" && c.cur === "coin" && c.price > 0).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id)), steps = [];
    for (let k = 0; k * 5 < coin.length; k++) steps.push(coin.slice(k * 5, k * 5 + 5).map(c => ({ id: c.id, price: c.price, need: c.needCP, pw: cuePower(c) }))); return steps; });
  const rows = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#shopBody .cuerow")].map(el => { const c = el.querySelector(".cuecvw")._cue, lb = el.querySelector("button.cplock");
    return [c.id, { locked: el.classList.contains("cuelk"), lock: lb ? lb.textContent.trim() : "", need: (el.querySelector(".cpneed") || {}).textContent || "", green: !!el.querySelector("button.green"), use: /USE|TANLASH/i.test((el.querySelector("button") || {}).textContent || "") }]; })));
  const openCues = (p, cat) => p.evaluate(cat => { cueCat = cat; go("shop"); buildShop("cues"); }, cat).then(() => sleep(700));
  const clickBuy = (p, id) => p.evaluate(id => { const el = [...document.querySelectorAll("#shopBody .cuerow")].find(e => e.querySelector(".cuecvw")._cue.id === id); const bt = el && el.querySelector("button"); if (bt) bt.click(); return !!bt; }, id);
  const state = p => p.evaluate(() => ({ coins: profile.coins, cues: profile.cues.slice(), gems: profile.gems, cp: collectionPower() }));
  try {
    let p = await boot({});
    // ---- 1) the data: nine steps of five, the cheapest open, the others rise, nothing else carries a lock
    const L = await ladder(p);
    ok(L.length === 9 && L.every(s => s.length === 5), "nine price steps of five coin cues", L.map(s => s.length));
    ok(L.every(s => s.every(c => c.price === s[0].price && c.need === s[0].need)), "the five cues of a step share price and requirement");
    ok(L[0][0].need === 0, "the cheapest step is always open (needCP 0)", L[0][0]);
    ok(L.every((s, k) => k === 0 || s[0].need > L[k - 1][0].need), "the requirement rises with every step", L.map(s => s[0].need));
    let below = 0; const exact = L.every((s, k) => { const want = Math.round(below * 0.55 / 10) * 10; below += s.reduce((a, c) => a + c.pw, 0); return s[0].need === want && want % 10 === 0; });
    ok(exact, "needCP = 55% of the ⚜ of every cue in the cheaper steps (rounded to 10)", L.map(s => s[0].need));
    const others = await p.evaluate(() => CUES.filter(c => c.needCP !== undefined && !(c.cat === "standard" && c.cur === "coin" && c.price > 0)).map(c => c.id));
    ok(others.length === 0, "no other cue (💎, country, victory, VIP, premium, start) has a lock", others);
    ok(await p.evaluate(() => CUES.filter(c => c.cat === "standard" && c.cur === "cash").length) >= 9, "the 💎-priced standard cues exist (and stay open)");
    const k3 = L[3][0].need, k1 = L[1][0].need;
    // ---- 2) the shop at ⚜ 0 with 20 000 000 000 coins: only the first step can be bought
    ok((await state(p)).cp === 0, "a new player has ⚜ 0");
    await openCues(p, "standard");
    let R = await rows(p);
    ok(L[0].every(c => R[c.id] && !R[c.id].locked && R[c.id].green && !R[c.id].lock), "step 1 cues: open, green coin button", L[0].map(c => R[c.id]));
    ok(L.slice(1).every((s, i) => s.every(c => R[c.id] && R[c.id].locked && !R[c.id].green)), "every cue of the steps 2-9 is locked with 20 000 000 000 coins in hand");
    ok(R[L[1][0].id].lock === `🔒 +${k1} ⚜` && R[L[1][0].id].need === `⚜ 0 / ${k1}`, "the padlock button says how much ⚜ is missing, and the line under it ⚜ now / needed", R[L[1][0].id]);
    ok(R[L[3][0].id].lock === `🔒 +${k3} ⚜`, "a pricier cue (440 000 coins) is locked at +" + k3 + " ⚜", R[L[3][0].id]);
    ok(await p.evaluate(() => /Pricier cues unlock/.test(document.querySelector("#shopBody").innerText)), "the Standard page explains the lock");
    const before = await state(p), target = L[1][0].id;
    await p.evaluate(() => { toastQ.length = 0; document.getElementById("toasts").innerHTML = ""; });   // the medals of a fresh account would queue up in front of our message
    await clickBuy(p, target); await sleep(900);
    const after = await state(p);
    ok(after.coins === before.coins && !after.cues.includes(target), "a click on a locked cue buys nothing (coins and cues unchanged)", { before, after });
    ok(await p.evaluate(() => /Collection power is too low/i.test(document.getElementById("toasts").innerText) && /You need ⚜ \d+ more/i.test(document.getElementById("toasts").innerText)), "...and says why", await p.evaluate(() => document.getElementById("toasts").innerText));
    // ---- 3) collect cues: the lock opens when ⚜ reaches the requirement
    const s0 = L[0].map(c => c.id);
    for (let i = 0; i < 2; i++) { await clickBuy(p, s0[i]); await sleep(700); }
    let st = await state(p); R = await rows(p);
    ok(st.cp === L[0][0].pw * 2 && st.cp < k1, "two cheap cues: ⚜ " + st.cp + " is still below " + k1, st);
    ok(R[L[1][0].id].locked && R[L[1][0].id].lock === `🔒 +${k1 - st.cp} ⚜` && R[L[1][0].id].need === `⚜ ${st.cp} / ${k1}`, "the gap shrinks as ⚜ grows: +" + (k1 - st.cp), R[L[1][0].id]);
    await clickBuy(p, s0[2]); await sleep(700); st = await state(p); R = await rows(p);
    ok(st.cp === L[0][0].pw * 3 && st.cp >= k1, "three cheap cues: ⚜ " + st.cp + " reaches " + k1, st);
    ok(L[1].every(c => !R[c.id].locked && R[c.id].green), "the second step opens (green coin buttons)", L[1].map(c => R[c.id]));
    ok(L.slice(2).every(s => s.every(c => R[c.id].locked)), "the third step and above are still locked");
    const c0 = (await state(p)).coins; await clickBuy(p, L[1][0].id); await sleep(700); st = await state(p);
    ok(st.cues.includes(L[1][0].id) && c0 - st.coins === L[1][0].price, "an unlocked cue is bought for its coin price (" + L[1][0].price + ")", { c0, st });
    // ---- 4) an owned cue is never locked (a save that has a pricey cue but little power)
    await p.evaluate(id => { profile.cues = ["start", id]; profile.cue = "start"; save(); }, L[8][0].id);
    await openCues(p, "standard"); R = await rows(p);
    ok(!R[L[8][0].id].locked && R[L[8][0].id].use && !R[L[8][0].id].lock, "an owned top-step cue shows USE (never a padlock), even at ⚜ " + (await state(p)).cp);
    // ---- 5) the 💎 cues are open at ⚜ 0
    await p.evaluate(() => { profile.cues = ["start"]; profile.cue = "start"; profile.gems = 5000; save(); });
    await openCues(p, "standard"); R = await rows(p);
    const dia0 = await p.evaluate(() => CUES.filter(c => c.cat === "standard" && c.cur === "cash").map(c => c.id));
    ok(dia0.every(id => !R[id]), "the 💎-priced 'standard' cues are NOT on the Standard page any more");
    await openCues(p, "premium"); R = await rows(p);
    ok(dia0.every(id => R[id]), "...they are on the Premium page");
    const dia = await p.evaluate(() => CUES.filter(c => c.cat === "standard" && c.cur === "cash").map(c => c.id));
    ok(dia.every(id => R[id] && !R[id].locked && !R[id].lock), "the 💎-priced standard cues have no padlock at ⚜ 0", dia.map(id => R[id]));
    const g0 = (await state(p)).gems, did = dia[0];
    await p.evaluate(id => { const el = [...document.querySelectorAll("#shopBody .cuerow")].find(e => e.querySelector(".cuecvw")._cue.id === id); el.querySelector('[data-p="gems"]').click(); }, did); await sleep(900);
    st = await state(p);
    ok(st.cues.includes(did) && st.gems < g0, "a 💎 cue is bought at ⚜ 0 (no lock on paid cues)", { st, g0 });
    // ---- 6) a stale row: rendered while ⚜ was high, bought after it dropped -> refused by the buy code itself
    await p.evaluate(ids => { profile.cues = ["start", ...ids]; save(); }, L.slice(0, 7).flat().map(c => c.id));
    await openCues(p, "standard"); R = await rows(p); const top = L[8][1].id;
    ok(!R[top].locked && R[top].green, "with the first seven steps owned (⚜ " + (await state(p)).cp + ") the top step is open", R[top]);
    await p.evaluate(() => { profile.cues = ["start"]; });   // the power drops, the row on screen does not change
    const b6 = await state(p); await clickBuy(p, top); await sleep(900); const a6 = await state(p);
    ok(a6.coins === b6.coins && !a6.cues.includes(top), "a stale 'buy' button cannot buy a locked cue either (the lock is in the buy code, not only on the screen)", { b6, a6 });
    // ---- 7) the in-match cue picker has the same lock
    await p.evaluate(() => { profile.cues = ["start"]; profile.cue = "start"; save(); toMenu(); startMatch("ai", CITIES[0], botPlayer(1, 4)); });
    await p.evaluate(() => new Promise(res => { const t = setInterval(() => { if (typeof game !== "undefined" && game && !game.moving) { clearInterval(t); cuePicker(); res(); } }, 40); })); await sleep(600);   // the picker only opens while no ball moves (the bot breaks after ~2 s)
    await p.evaluate(() => { document.querySelector('#mExtra [data-pc="standard"]').click(); }); await sleep(600);
    const pick = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#mExtra [data-pick]")].map(el => [el.dataset.pick, (el.querySelector("button") || {}).className + "|" + ((el.querySelector("button") || {}).textContent || "").trim()])));
    ok(pick[L[0][0].id].includes("green") && pick[L[1][0].id].includes("cplock") && pick[L[1][0].id].endsWith(`🔒 +${k1} ⚜`) && pick[L[8][0].id].includes("cplock"), "the in-match picker: step 1 open, the others padlocked with the gap", [pick[L[0][0].id], pick[L[1][0].id], pick[L[8][0].id]]);
    const b7 = await state(p);
    await p.evaluate(id => { document.querySelector(`#mExtra [data-pick="${id}"] button`).click(); }, L[2][0].id); await sleep(700);
    const a7 = await state(p);
    ok(a7.coins === b7.coins && !a7.cues.includes(L[2][0].id), "a click on a padlocked cue in the picker buys nothing", { b7, a7 });
    await p.evaluate(id => { document.querySelector(`#mExtra [data-pick="${id}"] button`).click(); }, L[0][0].id); await sleep(700);
    ok((await state(p)).cues.includes(L[0][0].id), "an open cue can still be bought and equipped from the picker");
    // ---- 8) the texts follow the language (Uzbek source + 13 translations)
    for (const [lang, rx] of [["ru", /Не хватает силы коллекции/], ["tr", /Koleksiyon gücü yetersiz/], ["uz", /Kolleksiya kuchi yetmaydi/]]) {
      const txt = await p.evaluate(l => { LANG = l; return T("Kolleksiya kuchi yetmaydi") + " | " + TT("Yana ⚜ {0} kerak: arzonroq kiylarni yig'ing.", "150"); }, lang);
      ok(rx.test(txt) && /150/.test(txt) && !/\{0\}/.test(txt), "the lock texts are translated (" + lang + ")", txt);
    }
    ok(errs.length === 0, "no page errors", errs);
    await p.close();
  } finally { srv.kill(); await b.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
