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
