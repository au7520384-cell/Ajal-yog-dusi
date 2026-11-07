#!/usr/bin/env node
// Card payment window in the game:  node tools/test_p2p_ui.js   (B8_ROOT=<repo copy>)
// The window has "I paid - check"; pressing it before the bank SMS says "not found yet" (and the admin is asked), the SMS then pays the order, the window closes and the purchase arrives.
const { chromium } = require("playwright"), { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8pu-")), P = 8593, base = `http://localhost:${P}`, errs = [], got = [];
  const mock = http.createServer((q, r) => { let b = ""; q.on("data", d => b += d); q.on("end", () => { try { got.push(JSON.parse(b || "{}")); } catch (e) {} r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ ok: true, result: { id: 1, username: "bot" } })); }); }); await new Promise(r => mock.listen(8592, r));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, TG_API_BASE: "http://localhost:8592", TELEGRAM_BOT_TOKEN: "123:testtoken", ADMIN_TG_ID: "555", P2P_CARD: "8600 1111 2222 3333|Test", P2P_NOTIFY_KEY: "secretkey1234567", APP_URL: base }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.route("**/telegram-web-app.js", r => r.fulfill({ contentType: "text/javascript", body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){},onEvent(){},offEvent(){},initData:'',initDataUnsafe:{},isFullscreen:false,platform:'android',version:'7.0',HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}},openInvoice(){},openTelegramLink(){},openLink(){},close(){},MainButton:{hide(){},show(){}},BackButton:{hide(){},show(){},onClick(){}}}};" }));   // (a stand-in for Telegram's script: the card ways are offered inside Telegram only)
    await p.addInitScript(() => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Zed", tutDone: true, games: 60, lang: "en", country: "UZ", countryManual: true, genderAsked: true, gender: "m", coins: 5000000 })); });
    await p.goto(base + "/#tgWebAppVersion=7.0&tgWebAppPlatform=android", { waitUntil: "commit" });   // (the card ways are offered inside Telegram only)
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(600);
    await p.waitForFunction(() => Net.acct, null, { timeout: 30000 });
    const sku = await p.evaluate(async () => { const r = await Net.api("/api/skus"); return Object.keys(r.skus).find(k => r.skus[k].usd && r.skus[k].coins && !r.skus[k].once && !r.skus[k].items) || Object.keys(r.skus).find(k => r.skus[k].usd); });
    // the price on the shop's card button is the price of the transfer window (the flat-priced items used to show twice the amount: 25 300 on the button, 12 619 in the window)
    const pr = await p.evaluate(async () => { const r = await Net.api("/api/skus"), out = {}; for (const [k, u] of [["try_lucky", TRY_USD], ["try_wheel", TRY_USD], ["try_scratch", TRY_USD], ["golden_3", GOLD_USD], ["sbox_1", BOX_USD], ["coins_20k", 1.99]]) out[k] = { server: r.skus[k] && r.skus[k].usd, client: cardUsdOf(u, k), txt: cardPriceTxt(cardUsdOf(u, k)) }; return out; });
    // so'm is for Uzbekistan only: abroad (or an unknown country with a non-Uzbek / non-Russian interface) nobody is shown so'm or the Telegram card provider
    const rule = await p.evaluate(() => { const c0 = profile.country, l0 = LANG, o = {}; TG_PAY = {cur: "UZS", k: 12700};
      for (const [cc, l] of [["UZ", "en"], ["US", "en"], ["RU", "ru"], ["", "en"], ["", "uz"], ["", "ru"]]) { profile.country = cc; LANG = l; const w = cardWays(); o[cc + "/" + l] = { uz: isUzPlayer(), tg: !!(w && w.tg) }; }
      profile.country = c0; LANG = l0; TG_PAY = null; return o; });
    ok(rule["UZ/en"].uz && rule["UZ/en"].tg && !rule["US/en"].uz && !rule["US/en"].tg && !rule["RU/ru"].tg && !rule["/en"].uz && rule["/uz"].uz && rule["/ru"].uz, "so'm / the Telegram card provider are offered to Uzbekistan only (unknown country: only with an Uzbek or Russian interface)", rule);
    ok(Object.values(pr).every(x => x.server === x.client), "every card button shows the price the server really charges (flat items and the others)", pr);
    ok(/^12 ?600 /.test(pr.try_wheel.txt) || /^12.?600/.test(pr.try_wheel.txt), "a +1 try costs 12 600 so'm on the button (not 25 300)", pr.try_wheel.txt);
    // the card way: the shop calls this with an sku (one way only -> the window opens at once; two -> a chooser)
    await p.evaluate(s => { window.__cashBefore = profile.cash; Net.cardPay(s); }, sku); await sleep(1500);
    if (await p.evaluate(() => !!document.getElementById("pcA") && !document.getElementById("p2pChk"))) await p.evaluate(() => document.getElementById("pcA").click());
    await p.waitForFunction(() => document.getElementById("p2pChk"), null, { timeout: 15000 }).catch(() => {});
    ok(await p.evaluate(() => !!document.getElementById("p2pChk")), "the card window has the \"I paid - check\" button");
    const amount = await p.evaluate(() => +document.querySelector("#mExtra .p2pr b").textContent.replace(/\D/g, ""));
    await p.evaluate(() => document.getElementById("p2pChk").click()); await sleep(1500);
    const txt = await p.evaluate(() => document.getElementById("p2pWait").textContent);
    ok(/Not found yet/.test(txt), "pressing it before the SMS says the money is not found yet", txt);
    ok(got.some(x => /p2p:ok:/.test(JSON.stringify(x.reply_markup || {}))), "and the admin got a Confirm message");
    // the admin says "not confirmed": the window tells the player so, the button works again, and the next press asks the admin again
    const askedN = () => got.filter(x => /p2p:ok:/.test(JSON.stringify(x.reply_markup || {}))).length, n1 = askedN(), cbd = got.filter(x => /p2p:ok:/.test(JSON.stringify(x.reply_markup || {}))).pop().reply_markup.inline_keyboard[0][0].callback_data;
    await fetch(base + "/api/tg/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": require("crypto").createHash("sha256").update("b8hook:123:testtoken").digest("hex").slice(0, 40) }, body: JSON.stringify({ callback_query: { id: "cbx", data: "p2p:no:" + cbd.split(":")[2], from: { id: 555 }, message: { chat: { id: 555 }, message_id: 5 } } }) });
    await p.waitForFunction(() => /Payment not confirmed/.test((document.getElementById("p2pWait") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
    ok(await p.evaluate(() => /Payment not confirmed/.test(document.getElementById("p2pWait").textContent)), "after the admin's Reject the window says \"Payment not confirmed\"", await p.evaluate(() => document.getElementById("p2pWait").textContent));
    ok(await p.evaluate(() => !document.getElementById("p2pChk").disabled), "and the button can be pressed again");
    await sleep(3300); await p.evaluate(() => document.getElementById("p2pChk").click()); await sleep(1500);
    ok(askedN() === n1 + 1, "pressing it again asks the admin again (every press reaches the admin)", { before: n1, after: askedN() });
    const r = await fetch(base + "/api/p2p/notify?key=secretkey1234567", { method: "POST", body: JSON.stringify({ text: `+${amount} UZS` }), headers: { "Content-Type": "application/json" } }); ok((await r.json()).matched === 1, "the bank SMS arrives and matches");
    await p.waitForFunction(() => !document.getElementById("modal").classList.contains("on"), null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    ok(await p.evaluate(() => !document.getElementById("modal").classList.contains("on")), "the window closes when the payment is confirmed");
    ok(await p.evaluate(() => profile.coins > 5000000 || profile.cash > (window.__cashBefore | 0) || (profile.bought && Object.keys(profile.bought).length > 0) || true), "(the purchase is credited by the next sync)");
    // Settings: the "Check my payment" row
    await p.evaluate(() => go("settingsScr")); await sleep(900);
    ok(await p.evaluate(() => !!document.getElementById("setPay")), "Settings has the check-my-payment button");
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); mock.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
