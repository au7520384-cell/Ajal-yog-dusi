#!/usr/bin/env node
// Card-to-card payments: the "Check" button, a late transfer, the admin's Telegram way:  node server/test_p2p.js
// A mock Telegram API records what the server sends to the admin. Checks: before the SMS the check asks the admin (once per 2 minutes), the SMS pays the order and the item arrives,
// a transfer that comes after the order expired is still accepted, /orders in the bot chat lists the open orders and the admin's Confirm pays an unmatched one, /api/health shows that SMS arrive.
const { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8p2p-")), P = 8591, base = `http://localhost:${P}`, TOKEN = "123:testtoken", sent = [];
  const mock = http.createServer((q, r) => { let b = ""; q.on("data", d => b += d); q.on("end", () => { try { sent.push({ url: q.url, body: JSON.parse(b || "{}") }); } catch (e) { sent.push({ url: q.url, body: {} }); } r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ ok: true, result: { id: 1, username: "bot" } })); }); });
  await new Promise(r => mock.listen(8590, r));
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, TG_API_BASE: "http://localhost:8590", TELEGRAM_BOT_TOKEN: TOKEN, ADMIN_TG_ID: "555", P2P_CARD: "8600 1111 2222 3333|Test", P2P_NOTIFY_KEY: "secretkey1234567", P2P_TTL_MS: "2500", APP_URL: base }, stdio: "ignore" }); await sleep(2500);
  const api = async (acct, p, body, hdr) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(hdr || {}), ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const adminMsgs = () => sent.filter(x => /sendMessage$/.test(x.url) && String(x.body.chat_id) === "555");
  try {
    const A = (await api(null, "/api/register", { name: "Ann", avatar: 1 })).j;
    const skus = (await api(null, "/api/skus")).j.skus, skuId = Object.keys(skus).find(k => skus[k].usd && skus[k].coins && !skus[k].once && !skus[k].items) || Object.keys(skus).find(k => skus[k].usd);
    const h0 = (await api(null, "/api/health")).j; ok(h0.p2p && h0.p2p.auto && h0.p2p.admin && h0.p2p.smsCount === 0, "health: card payments on, admin set, no SMS yet", h0.p2p);
    const o = (await api(A, "/api/p2p/order", { sku: skuId, mode: "auto" })).j; ok(o.id && o.amount > 0, "an order with a unique amount", o);
    const c1 = (await api(A, "/api/p2p/check", { id: o.id })).j; ok(c1.waiting === 1 && c1.asked === 1 && !(c1.paid || []).length, "check before the SMS: still waiting, the admin is asked", c1);
    await sleep(400); const m1 = adminMsgs().pop(); ok(m1 && /p2p:ok:/.test(JSON.stringify(m1.body.reply_markup)), "the admin got a message with a Confirm button", m1 && m1.body.text);
    const c2 = (await api(A, "/api/p2p/check", { id: o.id })).j; ok(c2.asked === 0 && c2.waiting === 1, "pressing Check again at once does not ask the admin again", c2);
    // the SMS arrives: the order is paid and the item is granted
    const n1 = (await api(null, "/api/p2p/notify?key=secretkey1234567", { text: `Postuplenie: +${String(o.amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.00 UZS ***3333 Balans: 5 000.00` })).j; ok(n1.matched === 1, "the bank SMS pays the order", n1);
    ok((await api(A, "/api/p2p/status", { id: o.id })).j.st === "paid", "the order is paid");
    const sy = (await api(A, "/api/sync", { name: "Ann" })).j; ok((sy.grants || []).length >= 1, "the purchase arrives with the next sync", (sy.grants || []).length);
    const h1 = (await api(null, "/api/health")).j; ok(h1.p2p.smsCount === 1 && h1.p2p.lastSms > 0, "health shows that an SMS arrived", h1.p2p);
    // a late transfer: the order expired (2.5 s here), the money comes afterwards
    const B = (await api(null, "/api/register", { name: "Bob", avatar: 2 })).j, o2 = (await api(B, "/api/p2p/order", { sku: skuId, mode: "auto" })).j;
    await sleep(3500);
    const n2 = (await api(null, "/api/p2p/notify?key=secretkey1234567", { message: `+${o2.amount} UZS` })).j; ok(n2.matched === 1, "a transfer that arrives after the order expired is still accepted", n2);
    ok((await api(B, "/api/p2p/status", { id: o2.id })).j.st === "paid", "the late order is paid");
    // the SMS never comes: the admin lists the open orders in the bot chat and confirms by hand
    const C = (await api(null, "/api/register", { name: "Cat", avatar: 3 })).j, o3 = (await api(C, "/api/p2p/order", { sku: skuId, mode: "auto" })).j;
    const before = adminMsgs().length;
    const wh = await fetch(base + "/api/tg/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": require("crypto").createHash("sha256").update("b8hook:" + TOKEN).digest("hex").slice(0, 40) }, body: JSON.stringify({ message: { text: "/orders", from: { id: 555 }, chat: { id: 555, type: "private" } } }) });
    await sleep(600); const listed = adminMsgs().slice(before).filter(x => /p2p:ok:/.test(JSON.stringify(x.body.reply_markup)));
    ok(wh.status === 200 && listed.some(x => JSON.stringify(x.body.reply_markup).includes(o3.id)), "/orders lists the open order with Confirm / Reject", { status: wh.status, n: listed.length });
    const cb = await fetch(base + "/api/tg/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": require("crypto").createHash("sha256").update("b8hook:" + TOKEN).digest("hex").slice(0, 40) }, body: JSON.stringify({ callback_query: { id: "cb1", data: "p2p:ok:" + o3.id, from: { id: 555 }, message: { chat: { id: 555 }, message_id: 7 } } }) });
    await sleep(600); ok(cb.status === 200 && (await api(C, "/api/p2p/status", { id: o3.id })).j.st === "paid", "the admin's Confirm pays the order");
    ok((await api(null, "/api/p2p/notify?key=wrongkey", { text: "+1000" })).s === 403, "a wrong key is refused");
  } finally { srv.kill(); mock.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
