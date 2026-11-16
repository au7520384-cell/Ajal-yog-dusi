#!/usr/bin/env node
// The weekly prize on the PLAYER'S side:  node tools/test_week_prizes_ui.js   (B8_ROOT=<repo copy>)
// The owner (Nov 16): "I took 1st place in Uzbekistan, the prize did not come". The server side is checked in server/test_week_prizes.js; here the real page gets the prizes the server hands over:
//  - the web / Telegram page and the Y8 page (a Y8-style frame, a fake Y8 SDK): a country #1 prize (400 💵) and a world #1 prize (1500 💵) are added to the wallet once each, a toast names the prize
//  - the "Itogi nedeli" window (the end-of-week recap) says what was credited ("+400 💵 ...") - the numbers in its card ("Haftalik yutuq") are only the coins won in online matches, already paid when each match ended
//  - a player without a prize sees no "credited" line
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8793, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const weekStart = t => { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
const iso = t => new Date(t).toISOString().slice(0, 10);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wkui-")), now = Date.now(), prev = iso(weekStart(now) - 7 * 864e5);
  // ---- last week's database: A took the world #1 and the country #1, B took the country #1 of Uzbekistan, Cnone is #4 of Uzbekistan and #7 of the world (no prize)
  const PL = [["Aworld", "JP", 4300], ["Bajaling", "UZ", 1920], ["Cnone", "UZ", 450], ["D2", "TH", 4245], ["E3", "US", 3090], ["F4", "UZ", 1000], ["G5", "UZ", 900]];
  let srv, acct = {};
  const startServer = async () => {   // a fresh last-week database for every page kind (a prize is handed over once, so every kind needs its own)
    if (srv) { srv.kill("SIGTERM"); await sleep(1000); }
    const db = { users: {}, codes: {}, purchases: {}, meta: { state: { week: prev } }, clubs: {}, dms: {}, p2p: {} }; acct = {};
    PL.forEach(([n, cc, won], i) => { const nn = String(i).padStart(2, "0"), id = ("u" + nn).padEnd(16, "a"), token = ("t" + nn + "x").padEnd(48, "k"), code = ("C" + nn).padEnd(7, "Z"); acct[n] = { id, token };
      db.users[id] = { id, token, code, name: n, avatar: 3, frame: 0, level: 6, xp: 0, won: 0, wins: 0, games: 0, friends: [], referredBy: null, referrals: [], grants: [], inbox: [], gifted: {}, created: now - 20 * 864e5, lastSeen: now - 6 * 864e5, country: cc, league: 0, week: prev, weekWon: won }; db.codes[code] = id; });
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(path.join(tmp, "db.json"), JSON.stringify(db));
    srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2800);
  };
  const b = await chromium.launch(), errs = [];
  const Y8STUB = `window.__ads = []; window.y8 = {sdk: () => ({init: (a, o) => { setTimeout(() => o.onReady && o.onReady(), 300); }, onAuth: () => {}, getPlatformLocale: () => Promise.resolve("en"), showAd: o => { window.__ads.push(o.type + ":" + o.name); o.beforeAd && o.beforeAd(); return new Promise(r => setTimeout(() => { o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone({ breakStatus: "viewed" }); r(); }, 80)); }, loadData: () => Promise.resolve(null), saveData: () => Promise.resolve(), saveLeaderboardScore: () => Promise.resolve(), awardAchievement: () => Promise.resolve(), trackCustomEvent: () => {}}), emitReadyEvent: () => window.dispatchEvent(new Event("y8sdk.ready"))};`;
  // open the game as player `who`: kind = web | tg | y8
  const openAs = async (who, kind) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(kind + " " + who + ": " + e.message.slice(0, 200)));
    const prof = { name: who, tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000, cash: 5, cues: ["start"], cue: "start", country: PL.find(x => x[0] === who)[1], countryManual: true, lwSeen: "" };
    await p.addInitScript(([pr, a]) => { try { if (!localStorage.getItem("billiard8v2")) { localStorage.setItem("billiard8v2", JSON.stringify(pr)); localStorage.setItem("b8acct", JSON.stringify(a)); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); } } catch (e) {} }, [prof, acct[who]]);
    if (kind === "y8") await p.route(u => /cdn\.y8\.com/.test(String(u)), r => r.fulfill({ contentType: "text/javascript", body: Y8STUB }));
    if (kind === "tg") await p.route("**/telegram-web-app.js", r => r.fulfill({ contentType: "text/javascript", body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){},onEvent(){},offEvent(){},initData:'',initDataUnsafe:{},isFullscreen:false,platform:'android',version:'7.0',HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}},openInvoice(){},openTelegramLink(){},openLink(){},close(){},MainButton:{hide(){},show(){}},BackButton:{hide(){},show(){},onClick(){}}}};" }));
    await p.route(u => !/localhost|127\.0\.0\.1|cdn\.y8\.com|telegram-web-app/.test(String(u)), r => r.abort());
    const url = `${base}/` + (kind === "y8" ? `?server=${encodeURIComponent(base)}` : "") + (kind === "tg" ? "#tgWebAppVersion=7.0&tgWebAppPlatform=android" : ""), opt = kind === "y8" ? { referer: "https://www.y8.com/" } : {};   // (a portal page talks to the real server by default: ?server= points it at the test one)
    await p.goto(url, { waitUntil: "commit", ...opt });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { try { vipShownSession = true; } catch (e) {} });
    return { p, ctx };
  };
  const wallet = p => p.evaluate(() => ({ cash: profile.cash | 0, coins: profile.coins | 0 }));
  // the recap opens when the menu is up and no other window is open; the VIP launch window (1.8 s after the menu) may be first: close it and sync again, as the next minute's sync would
  const recap = async p => { for (let k = 0; k < 5 && !(await p.evaluate(() => !!document.querySelector("#modal .wk"))); k++) { await p.evaluate(async () => { document.getElementById("modal").classList.remove("on"); try { await Net.sync(); } catch (e) {} }); await sleep(2500); } };
  try {
    for (const kind of ["web", "tg", "y8"]) {
      await startServer();
      // ---- a country #1 (Uzbekistan): 400 💵 + (league prizes in coins)
      let { p, ctx } = await openAs("Bajaling", kind); await sleep(6500);
      const w1 = await wallet(p);
      ok(w1.cash === 5 + 400, `${kind}: the country #1 prize (400 💵) is in the wallet once (5 -> ${w1.cash})`, w1);
      const lp = await p.evaluate(() => (profile.prizeLog || []).map(x => x.k + ":" + x.cash));
      ok(lp.join() === "country:400", `${kind}: the page remembers what was credited (country:400)`, lp);
      await ctx.close();
      // ---- world #1 + country #1 (Japan)
      ({ p, ctx } = await openAs("Aworld", kind)); await sleep(6500);
      const w2 = await wallet(p); ok(w2.cash === 5 + 1500 + 400, `${kind}: the world #1 prize (1500 💵) and the country #1 prize (400 💵) are both credited (5 -> ${w2.cash})`, w2);
      await ctx.close();
      // ---- no prize: the recap shows the rank and the winnings, no "credited" line
      ({ p, ctx } = await openAs("Cnone", kind)); await sleep(6500);
      const w3 = await wallet(p); ok(w3.cash === 5, `${kind}: #4 of Uzbekistan gets no 💵 (5 -> ${w3.cash})`, w3);
      await ctx.close();
    }
    // ---- the "Itogi nedeli" recap names what was credited (web page: a fresh page opens the recap once, when the menu is up)
    {
      await startServer();
      const { p, ctx } = await openAs("Bajaling", "web"); await sleep(5000); await recap(p);
      const r = await p.evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), wk: !!document.querySelector("#modal .wk"), pz: (document.querySelector("#modal .wkgot") || {}).textContent || "", icon: !!document.querySelector("#modal .wkgot .cash"), text: (document.getElementById("mExtra") || {}).textContent || "" }));
      ok(r.on && r.wk, "the end-of-week recap opens when the menu is up", { on: r.on, wk: r.wk });
      ok(/\+400/.test(r.pz) && r.icon && /Country ranking prize/i.test(r.pz), "...and says what was credited (+400 with the 💵 icon, \"Country ranking prize · #1 UZ\")", r);
      await ctx.close();
      const q = await openAs("Cnone", "web"); await sleep(5000); await recap(q.p);
      const r2 = await q.p.evaluate(() => ({ wk: !!document.querySelector("#modal .wk"), got: !!document.querySelector("#modal .wkgot"), mode: mode, modal: document.getElementById("modal").classList.contains("on"), txt: (document.getElementById("modal").innerText || "").slice(0, 60), lw: profile.lwSeen }));
      ok(r2.wk && !r2.got, "a player without a prize gets the recap without a 'credited' line", r2); await q.ctx.close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); if (srv) srv.kill("SIGTERM"); await sleep(600); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { require("child_process").execSync("pkill -f 'server/server.js' || true"); } catch (x) {} process.exit(1); });
