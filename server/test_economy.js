#!/usr/bin/env node
// The money rules of the game, on the server:  node server/test_economy.js
// Two premium moneys: 💎 diamonds (50 per $1, flat prices, NEVER given for free) and 💵 cash ($1 = 20 cash, sold in packs, hard to earn: a few at a time).
// Checks: the shop list (six diamond packs at exactly 50 per $1 and six cash packs, nothing marked legacy), a purchase hands over 💎 marked dm:1 (and only a purchase does) or 💵 cash, the starter pack carries cash + 💎 and the VIP bundles cash,
// an order for an OLD gem pack (gems_780) cannot be started any more but is still delivered if it is paid (as 💎 at the old dollar value, old gems x 0.25), the quiz bonus, the referral and the weekly / club prizes are cash.
const { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8eco-")), P = 8661, base = `http://localhost:${P}`, STRIPE = "whsec_testsecret", mock = http.createServer((q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ ok: true, result: {} })); });
  await new Promise(r => mock.listen(8660, r));
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, TG_API_BASE: "http://localhost:8660", TELEGRAM_BOT_TOKEN: "123:eco", STRIPE_WEBHOOK_SECRET: STRIPE, P2P_CARD: "8600 1111 2222 3333|Test", P2P_NOTIFY_KEY: "secretkey1234567", APP_URL: base }, stdio: "ignore" }); await sleep(2600);
  const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const pay = async (u, sku, id) => {   // a paid Stripe checkout, signed like Stripe signs it
    const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id, payment_status: "paid", amount_total: 100, metadata: { userId: u.id, sku } } } }), t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", STRIPE).update(`${t}.${raw}`).digest("hex");
    const r = await fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body: raw }); return r.status;
  };
  const grants = async u => (await api(u, "/api/sync", { name: u.name || "X" })).j.grants || [];
  try {
    const skus = (await api(null, "/api/skus")).j.skus;
    // ---- the shop list
    const dia = Object.entries(skus).filter(([k, s]) => /^gems_/.test(k)).sort((a, b) => a[1].gems - b[1].gems);
    ok(dia.map(([k]) => k).join() === "gems_100,gems_250,gems_500,gems_1000,gems_2500,gems_5000", "six diamond packs: 100 / 250 / 500 / 1000 / 2500 / 5000", dia.map(([k]) => k));
    ok(dia.every(([k, s]) => s.gems === +k.slice(5) && Math.abs(s.gems / s.usd - 50) < 0.6), "every pack is 50 💎 per $1 (no bonus, no discount): " + dia.map(([k, s]) => `${s.gems}/$${s.usd}`).join(" "), dia.map(([k, s]) => [s.gems, s.usd, s.gems / s.usd]));
    ok(dia.every(([k, s]) => [1.99, 4.99, 9.99, 19.99, 49.99, 99.99].includes(s.usd)), "the packs are charged exactly their list price (no card surcharge)", dia.map(([k, s]) => s.usd));
    const cashPacks = Object.entries(skus).filter(([k, s]) => /^cash_\d+$/.test(k)).sort((a, b) => a[1].cash - b[1].cash);
    ok(cashPacks.map(([k, s]) => s.cash).join() === "20,50,110,250,800,2000" && cashPacks.every(([k, s]) => !s.gems && !s.coins && s.usd > 0), "six 💵 cash packs: 20 / 50 / 110 / 250 / 800 / 2000", cashPacks.map(([k, s]) => [k, s.cash]));
    ok(["loop_cash_1", "loop_cash_2", "loop_cash_3"].every(k => skus[k] && skus[k].cash > 0), "the Next-Level Loop cash offers are on sale");
    ok(!Object.values(skus).some(s => s.legacy) && !skus.gems_290, "the old gem orders are not in the shop list");
    ok(skus.starter.cash === 50 && skus.starter.gems === 70 && skus.starter.coins === 100000, "the starter pack: 100 000 coins + 50 💵 + 70 💎", skus.starter);
    ok(skus.sport_1.cash === 15 && skus.zod_0.cash === 185 && skus.atom_3.cash === 200 && skus.hor_0.cash > 0 && !skus.sport_1.gems && !skus.zod_0.gems, "the VIP bundles carry 💵 cash again", [skus.sport_1, skus.zod_0.cash, skus.atom_3.cash, skus.hor_0.cash]);
    // ---- the first diamond purchase: 💎 marked dm:1, nothing else gives 💎
    const A = (await api(null, "/api/register", { name: "Ann", avatar: 1 })).j;
    ok((await grants(A)).length === 0, "a new account has no grants");
    ok(await pay(A, "gems_250", "cs_1") === 200, "a paid gems_250 checkout is accepted");
    const g1 = await grants(A); ok(g1.length === 1 && g1[0].gems === 250 && g1[0].dm === 1 && g1[0].kind === "purchase" && !g1[0].cash, "the purchase hands over 250 💎 (dm:1, no cash)", g1);
    ok(await pay(A, "gems_250", "cs_1") === 200 && (await grants(A)).length === 0, "the same payment twice is delivered once");
    await pay(A, "starter", "cs_2"); const g2 = await grants(A); ok(g2.length === 1 && g2[0].coins === 100000 && g2[0].cash === 50 && g2[0].gems === 70 && g2[0].dm === 1, "the starter pack: coins + 50 💵 + 70 💎", g2);
    await pay(A, "sport_3", "cs_3"); const g3 = await grants(A); ok(g3.length === 1 && g3[0].cash === 110 && !g3[0].gems && g3[0].kind === "purchase", "a VIP bundle: 110 💵", g3);
    // ---- cash packs are sold; an order for an OLD gem pack is only delivered, never started
    await pay(A, "cash_50", "cs_4"); const g4 = await grants(A); ok(g4.length === 1 && g4[0].cash === 50 && !g4[0].gems && g4[0].kind === "purchase", "a paid cash_50 hands over 50 💵 (no 💎)", g4);
    ok((await api(A, "/api/p2p/order", { sku: "cash_50", mode: "auto" })).s === 200, "a cash pack can be ordered by card transfer");
    ok((await api(A, "/api/checkout", { sku: "gems_780" })).s === 400 && (await api(A, "/api/p2p/order", { sku: "gems_780", mode: "auto" })).s === 400, "an old gem pack cannot be bought any more (checkout, card transfer)");
    await pay(A, "gems_780", "cs_5"); const g5 = await grants(A); ok(g5.length === 1 && g5[0].gems === 195 && g5[0].dm === 1, "an old gems_780 order = 195 💎 (the same dollars)", g5);
    // ---- quiz bonus and referral: cash again
    const B = (await api(null, "/api/register", { name: "Bob", avatar: 2 })).j, C = (await api(null, "/api/register", { name: "Cat", avatar: 3 })).j;
    const rf = (await api(C, "/api/referral", { code: B.code })).j; ok(rf.ok && rf.reward && rf.reward.coins === 5000 && rf.reward.cash === 3, "the invited friend's reward: 5 000 coins + 3 💵", rf);
    const gb = await grants(B), gc = await grants(C);
    ok(gb.length === 1 && gb[0].coins === 15000 && gb[0].cash === 5 && !gb[0].gems, "the inviter gets 15 000 coins + 5 💵 (no 💎)", gb);
    ok(gc.length === 1 && gc[0].coins === 5000 && gc[0].cash === 3 && !gc[0].gems, "the friend gets 5 000 coins + 3 💵 (no 💎)", gc);
    const day = (await api(B, "/api/quiz/day", {})).j; ok(day.bonusCash === 1 && !("bonusCoins" in day), "the daily quiz 5/5 bonus is 1 💵", day);
    // ---- prizes are cash
    const lb = (await api(B, "/api/leaderboard?scope=world")).j; ok(!lb.pc && lb.prizes[0] === 1500 && lb.prizes[2] === 400, "the world prizes are 1500 / 750 / 400 💵", [lb.pc, lb.prizes]);
    const lc = (await api(B, "/api/leaderboard?scope=country")).j; ok(!lc.pc && lc.prizes[0] === 400, "the country prizes are 💵", [lc.pc, lc.prizes]);
    const lw = (await api(B, "/api/leaderboard/lastweek")).j; ok(!lw.pc && lw.prizes[0] === 1500 && lw.countryPrizes[0] === 400, "the last-week recap says the same", lw);
    // the source: a 💎 amount only exists in fulfill() (cash is earned in small amounts elsewhere, but 💎 never)
    const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    ok((src.match(/\bgems\s*:/g) || []).length > 0 && (src.match(/grant\([^)]*gems\s*:/g) || []).length === 1, "only one grant() call can carry 💎: the purchase delivery (fulfill)", (src.match(/grant\([^)]*gems\s*:/g) || []).length);
  } finally { srv.kill(); mock.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
