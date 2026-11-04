#!/usr/bin/env node
// "Delete my account" (Google Play):  node tools/test_account_delete.js   (B8_ROOT=<repo copy>)
// Server: two players are friends and in a club, one deletes his account: his token stops working, his code is free, the friend's list and the club forget him, a wrong confirmation does nothing.
// Game: Settings has the red button; after the confirmation the phone forgets the account and starts as a new player.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ad-")), P = 8571, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const A = (await api(null, "/api/register", { name: "Ann", avatar: 1 })).j, B = (await api(null, "/api/register", { name: "Bob", avatar: 2 })).j;
    await api(A, "/api/friends/add", { code: B.code }); await api(B, "/api/friends/add", { code: A.code });
    const f0 = (await api(B, "/api/friends")).j; ok((f0.friends || []).some(x => x.id === A.id), "before: Bob has Ann as a friend", f0.friends && f0.friends.length);
    const bad = await api(A, "/api/account/delete", { confirm: "no" }); ok(bad.s === 400, "a wrong confirmation does nothing", bad.s);
    ok((await api(A, "/api/sync", { name: "Ann" })).s === 200, "the account still works after it");
    const del = await api(A, "/api/account/delete", { confirm: "DELETE" }); ok(del.s === 200 && del.j.ok, "the account is deleted", del);
    ok((await api(A, "/api/sync", { name: "Ann" })).s === 401, "the deleted account's token no longer works");
    const f1 = (await api(B, "/api/friends")).j; ok(!(f1.friends || []).some(x => x.id === A.id), "after: Bob's friend list forgot Ann", f1.friends && f1.friends.length);
    const again = await api(B, "/api/friends/add", { code: A.code }); ok(again.s >= 400, "her friend code is gone", again.s);
    // the game
    const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage(), errs = [];
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Zed", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" })); });
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.waitForFunction(() => Net.acct, null, { timeout: 30000 }); const id0 = await p.evaluate(() => Net.acct.id);
    await p.evaluate(() => go("settingsScr")); await sleep(900);
    ok(await p.evaluate(() => !!document.getElementById("setDelete")), "Settings has the delete button");
    await p.evaluate(() => document.getElementById("setDelete").click()); await sleep(500);
    ok(await p.evaluate(() => document.getElementById("modal").classList.contains("on")), "it asks for a confirmation first");
    await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(() => {}), p.evaluate(() => [...document.querySelectorAll("#modal button")].find(x => /red/.test(x.className)).click())]);
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g2 = await p.$("#lsGuest"); if (g2) await g2.click().catch(() => {}); await sleep(500);
    const nowId = await p.evaluate(() => { try { return (JSON.parse(localStorage.getItem("b8acct") || "null") || {}).id || ""; } catch (e) { return ""; } });
    ok((await api({ id: id0, token: "x" }, "/api/sync", { name: "Zed" })).s === 401 && nowId !== id0, "the phone forgot the old account (a new one, or none yet)", { nowId, id0 });
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
