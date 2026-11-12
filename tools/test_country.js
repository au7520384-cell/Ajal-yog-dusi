#!/usr/bin/env node
// "Which country am I playing with?" (the owner): in an online match both players see the other's country:  node tools/test_country.js   (B8_ROOT=<repo copy>)
// Two real browsers + the real server; one plays from Uzbekistan, the other from Turkey.
//  - the opponent's object carries his country (it came from the server, it was dropped before)
//  - the HUD, the VS screen and the result screen show the flag and the country's name; a computer opponent shows no country (🤖 AI)
//  - after the first pill the match shows "flag Country · Name"
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8771;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cty-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async (nm, cc) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(nm + ": " + e.message.slice(0, 200)));
    await p.addInitScript(([n, c]) => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000, country: c, countryManual: true })); }, [nm, cc]);
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    return p;
  };
  try {
    const A = await mk("Alpha", "UZ"), B = await mk("Beta", "TR");
    await Promise.all([A, B].map(p => p.evaluate(() => Net.sync())));
    await Promise.all([A, B].map(p => p.evaluate(() => vsScreen(CITIES[0], 100, () => findOpponent(CITIES[0]), f => startMatch("ai", CITIES[0], f.opp, f.net)))));
    await sleep(3000);
    const vsA = await A.evaluate(() => ({ b: document.getElementById("vsBc").innerText, a: document.getElementById("vsAc").innerText }));
    ok(/T[uü]rk|Turkey/i.test(vsA.b), "the VS screen of the Uzbek player shows the opponent's country (Turkey)", vsA);
    ok(/Uzbek/i.test(vsA.a), "...and his own (Uzbekistan)", vsA);
    await Promise.all([A, B].map(p => p.waitForFunction(() => game && game.net && !game.net.spec && mode === "game", null, { timeout: 60000 })));
    const o = await A.evaluate(() => ({ opp: game.players[1].country, me: game.players[0].country }));
    ok(o.opp === "TR" && o.me === "UZ", "the opponent's object carries his country", o);
    const o2 = await B.evaluate(() => ({ opp: game.players[1].country, me: game.players[0].country }));
    ok(o2.opp === "UZ" && o2.me === "TR", "...on the other phone too", o2);
    await sleep(4200);
    const pill = await A.evaluate(() => game.pill ? game.pill.text : "");
    ok(/T[uü]rk|Turkey/i.test(pill) && /Beta/.test(pill), "after the first pill the match shows \"flag Country · Name\"", pill);
    // result screen
    await A.evaluate(() => endGame(0, "test")); await sleep(3500);
    const res = await A.evaluate(() => ({ b: document.getElementById("resBc").innerText, a: document.getElementById("resAc").innerText }));
    ok(/T[uü]rk|Turkey/i.test(res.b) && /Uzbek/i.test(res.a), "the result screen shows both countries", res);
    // a computer opponent: no country
    await A.evaluate(() => toMenu("home")); await sleep(800);
    await A.evaluate(() => { vsScreen(CITIES[0], 100, () => Promise.resolve({ opp: botPlayer(1, 4) }), f => startMatch("ai", CITIES[0], f.opp)); }); await sleep(4500);
    const bot = await A.evaluate(() => document.getElementById("vsBc").innerText);
    ok(/AI/.test(bot) && !/T[uü]rk/i.test(bot), "a computer opponent shows no country (AI)", bot);
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
