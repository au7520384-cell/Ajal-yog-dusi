#!/usr/bin/env node
// Two owner rules (Nov 17):  "levels rise much too fast, they must rise slowly"  and  "when playing against a bot no coins must be given":  node tools/test_bot_free.js   (B8_ROOT=<repo copy>; ~2.5 min, one browser, no game server)
//  1) levels: xpNeed(l) = 400 + (l - 1) * 320 (it was 100 + (l - 1) * 80): about 4 times more XP for every level; a level-up still pays 100 x the new level in coins
//  2) a table match against a BOT (nobody was found online in 15 s, or the server cannot be reached) is free practice:
//       - the entry fee goes back (it is taken before the search, so the player sees it held while he is searched for), and the VS screen shows no stake / no coins flying into a pot
//       - a win pays NOTHING in coins: no prize, no streak / Golden Hour / table / Elite bonus, no Elite-table coins, no "+0" coin row, no x2 button, nothing added to the lifetime winnings
//       - a loss takes nothing (the fee was never taken); XP, trophies, the box and the missions stay (it is practice, not a punishment)
//     a match against a REAL player (G.net, found by the server) pays exactly as before: prize + all the bonuses (the control, so the checks above can fail)
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
  await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 12 })); });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.unlock = () => {}; window.checkAch = () => {}; });   // (medals pay coins once: off, so the coin numbers below are exact)
  await sleep(4500);   // (the start-up gifts - the daily reward - have landed)
  await p.evaluate(() => { Y8.sdk = { showAd(o) { o.beforeAd && o.beforeAd(); return new Promise(r => setTimeout(() => { o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone({ breakStatus: "viewed" }); r(); }, 100)); } }; Y8.adsReady = true; });   // (a rewarded-video SDK is there, so the x2 button of a won match CAN show: its absence after a bot win means something)

  // ------------------------------------------------------------------ 1) the level curve
  const lv = await p.evaluate(() => {
    const cum = (f, n) => { let t = 0; for (let l = 1; l < n; l++) t += f(l); return t; }, old = l => 100 + (l - 1) * 80;
    profile.level = 1; profile.xp = 0; const c0 = profile.coins; addXp(399); const a = { level: profile.level, xp: profile.xp, coins: profile.coins - c0 };
    addXp(1); const b = { level: profile.level, xp: profile.xp, coins: profile.coins - c0 };
    return { need: [1, 2, 3, 5, 10, 20].map(xpNeed), c10: cum(xpNeed, 10), o10: cum(old, 10), c20: cum(xpNeed, 20), o20: cum(old, 20), a, b, winXp: 40 + Math.round(Math.log10(CITIES[2].prize) * 15) };
  });
  ok(JSON.stringify(lv.need) === JSON.stringify([400, 720, 1040, 1680, 3280, 6480]), "xpNeed: 400 for level 1, then +320 for every level", lv.need);
  ok(lv.c10 === 15120 && lv.o10 === 3780 && lv.c10 / lv.o10 === 4 && Math.abs(lv.c20 / lv.o20 - 3.6) < 0.4, "reaching level 10 takes 15 120 XP (it took 3 780): 4 times slower; level 20 about 3.6 times", lv);
  ok(lv.a.level === 1 && lv.a.xp === 399 && lv.a.coins === 0, "399 XP is not a level yet (no level-up bonus)", lv.a);
  ok(lv.b.level === 2 && lv.b.xp === 0 && lv.b.coins === 200, "400 XP: level 2, and the level-up still pays 100 x the new level in coins", lv.b);
  ok(lv.winXp >= 80 && lv.winXp < 400 / 4, "a table win gives about 85 XP: a new player needs ~5 such wins for level 2 (it was 2)", lv.winXp);
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); const e = document.getElementById("lvlFx"); if (e) e.remove(); });

  // ------------------------------------------------------------------ 2) one match, ended at once.  real: a REAL player (found by the server) / a bot;  golden: 20:30 (the Golden Hour) / 12:30;  pre: the streak before it
  const DUB = await p.evaluate(() => CITIES.findIndex(c => c.id === "dub"));
  const play = async o => {
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); const e = document.getElementById("lvlFx"); if (e) e.remove(); try { toMenu(); } catch (e) {} });
    await p.evaluate(o => {
      const t = (h, m) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime(); };
      window.goldenNow = () => t(o.golden ? 20 : 12, 30);
      profile.level = 1; profile.xp = 0; profile.wstreak = o.pre | 0; profile.tableSkin = "e_sak"; profile.eliteUntil = Date.now() + 30 * 864e5;   // (every coin bonus the game has is switched on: a table bonus, Elite, Golden Hour, the streak, an Elite-table city)
      const opp = o.real ? { name: "Rival", avatar: 301, frame: 0, level: 5, isAI: false, remote: true, color: "#d33", cue: "start" } : { name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" };
      startMatch("ai", CITIES[o.city], opp, o.real ? { seat: 0, room: "ctl", seed: 3 } : null);
    }, o);
    for (let i = 0; i < 40; i++) { await sleep(300); if (await p.locator("#tutSkip").count()) await p.locator("#tutSkip").click().catch(() => {}); if (o.real ? await p.evaluate(() => !!game && game.type === "ai") : await p.evaluate(() => canControl())) break; }
    if (o.real) await sleep(1500);
    const r = await p.evaluate(o => { const G = game, c0 = profile.coins, w0 = profile.won, x0 = profile.xp, wins0 = profile.wins;
      const pre = { bot: G.bot, pot: G.pot, net: !!G.net, prize: CITIES[o.city].prize, fee: CITIES[o.city].fee, tb: tableBonus(profile.tableSkin), elite: isElite(), golden: goldenHour().on };
      endGame(o.win ? 0 : 1, "test");
      return { pre, rw: G.rw ? JSON.parse(JSON.stringify(G.rw)) : null, c0, w0, x0, wins0 }; }, o);
    await p.waitForSelector("#res.on #resBtns button", { timeout: 20000 }); await sleep(7500);
    const d = await p.evaluate(() => ({ c1: profile.coins, w1: profile.won, x1: profile.xp, l1: profile.level, wins1: profile.wins, pot: (document.getElementById("resPot") || {}).textContent, fly: document.querySelectorAll(".flycoin, .rwfly").length, dbl: document.querySelectorAll("#resAr .dblb, #resBtns .dblb").length,
      rows: [...document.querySelectorAll("#resList .rrow")].map(x => ({ t: x.textContent.trim().replace(/\s+/g, " "), k: x.dataset.k || "", neg: x.classList.contains("neg") })) }));
    return { ...r, ...d };
  };

  // 2a) a WIN against a bot: not a coin (the control below gets all of them)
  const bw = await play({ real: false, win: true, city: DUB, pre: 4, golden: true });
  ok(bw.pre.bot === true && bw.pre.pot === 0 && !bw.pre.net, "bot match: the game knows it (G.bot), there is no pot", bw.pre);
  ok(bw.pre.tb > 0 && bw.pre.elite && bw.pre.golden, "(every coin bonus was switched on for this match: a table bonus, Elite, the Golden Hour)", bw.pre);
  ok(bw.c1 === bw.c0 && bw.l1 === 1, "bot match won: the coins did not change at all (prize, streak x5, Golden Hour, table, Elite, Elite-table coins: none)", [bw.c0, bw.c1, bw.l1]);
  ok(bw.rw && bw.rw.coins === 0 && !bw.rw.streak && !bw.rw.golden && !bw.rw.eliteCoins, "...the game decided no coin row and no bonus", bw.rw);
  ok(bw.w1 === bw.w0, "...and the lifetime winnings (profile.won) did not grow", [bw.w0, bw.w1]);
  ok(!bw.rows.some(x => x.k === "coins" || /🔥|×\d|Golden/.test(x.t)) && bw.dbl === 0 && bw.pot === "0" && bw.fly === 0, "...the result screen has no coin row, no bonus row, no x2 button, a pot of 0 and no coins flying", { rows: bw.rows, dbl: bw.dbl, pot: bw.pot, fly: bw.fly });
  ok(bw.rw && bw.rw.xp > 0 && bw.x1 === bw.x0 + bw.rw.xp && bw.wins1 === bw.wins0 + 1 && bw.rw.trophy !== undefined && bw.rows.length >= 2, "...but it is still practice that counts: XP, the win, trophies", { rw: bw.rw, x: [bw.x0, bw.x1], wins: [bw.wins0, bw.wins1] });

  // 2b) the CONTROL: the same match against a real player pays the prize and every bonus (so the checks above can fail)
  const rwn = await play({ real: true, win: true, city: DUB, pre: 4, golden: true });
  ok(rwn.pre.bot === false && rwn.pre.net && rwn.pre.pot === rwn.pre.prize, "real player match: G.bot is false and the pot is the prize", rwn.pre);
  const sum = rwn.rw ? rwn.rw.coins + ((rwn.rw.streak || {}).coins | 0) + ((rwn.rw.golden || {}).coins | 0) + (rwn.rw.eliteCoins | 0) : 0;
  ok(rwn.rw && rwn.rw.coins === rwn.pre.prize && rwn.rw.streak && rwn.rw.streak.pct === 25 && rwn.rw.golden && rwn.rw.eliteCoins > 0, "(control) the game decided the prize, the x5 streak bonus, the Golden Hour bonus and the Elite-table coins", rwn.rw);
  ok(rwn.c1 - rwn.c0 >= sum + Math.round(rwn.pre.prize * 0.25), "(control) ...and the player got them in coins (prize + streak + Golden Hour + Elite 25% + table bonus + Elite-table coins)", { got: rwn.c1 - rwn.c0, sum, prize: rwn.pre.prize });
  ok(rwn.w1 === rwn.w0 + rwn.pre.prize && rwn.rows.some(x => x.k === "coins") && rwn.dbl === 1, "(control) ...profile.won grew by the prize, the coin row and the x2 button are there", { w: [rwn.w0, rwn.w1], dbl: rwn.dbl });

  // 2c) a LOSS against a bot takes nothing and shows no minus row; against a real player the result still shows the fee that was lost
  const bl = await play({ real: false, win: false, city: 1, pre: 3, golden: false });
  ok(bl.c1 === bl.c0 && bl.rw && bl.rw.coins === 0 && !bl.rows.some(x => x.k === "coins"), "bot match lost: no coins taken, no minus row", { c: [bl.c0, bl.c1], rw: bl.rw, rows: bl.rows });
  const rl = await play({ real: true, win: false, city: 1, pre: 3, golden: false });
  ok(rl.c1 === rl.c0 && rl.rw && rl.rw.coins === -rl.pre.fee && rl.rows.some(x => x.k === "coins" && x.neg), "(control) real player match lost: the minus row shows the fee (it was taken before the match)", { rw: rl.rw, fee: rl.pre.fee, rows: rl.rows });

  // ------------------------------------------------------------------ 3) the entry fee: held while the server searches, back when the answer is a bot, kept when a real player is found
  const stub = (what) => p.evaluate(what => { window.__net = window.__net || { ensure: Net.ensure, connect: Net.connect, send: Net.send };
    if (what === "off") { Net.ensure = () => Promise.reject(new Error("offline")); }                                                                         // the server cannot be reached
    else if (what === "quiet") { Net.ensure = () => Promise.resolve({}); Net.connect = () => Promise.resolve(); Net.send = () => {}; }                         // the server answers, nobody is online
    else { Net.ensure = window.__net.ensure; Net.connect = window.__net.connect; Net.send = window.__net.send; } }, what);
  const state = () => p.evaluate(() => ({ coins: profile.coins, game: !!game && game.type === "ai" && !game.demo ? { bot: game.bot, pot: game.pot, net: !!game.net, fee: game.city.fee, prize: game.city.prize } : null, vs: document.getElementById("vs").classList.contains("on"),
    bn: (document.getElementById("vsBn") || {}).textContent || "", aOn: document.getElementById("vsAf").classList.contains("on"), bOn: document.getElementById("vsBf").classList.contains("on"), fly: document.querySelectorAll(".flycoin").length, paid: document.getElementById("vsAf").classList.contains("paid") || document.getElementById("vsBf").classList.contains("paid"),
    toast: [...document.querySelectorAll("#toasts .toast")].map(e => e.textContent.replace(/\s+/g, " ").trim()).join(" | ") }));
  const toTable = async () => { await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); const e = document.getElementById("lvlFx"); if (e) e.remove(); try { toMenu(); } catch (e) {} profile.cityWins = Object.fromEntries(CITIES.map(c => [c.id, 1])); profile.coins = 100000;   /* (every table is open: played before, level and trophies are enough) */ profile.tp = 500; profile.level = 60; profile.xp = 0; save(); document.querySelectorAll("#toasts .toast").forEach(e => e.remove()); }); await sleep(400); };

  // 3a) the server cannot be reached: the bot comes at once, the fee is back at once
  await stub("off"); await toTable();
  const fee = await p.evaluate(() => CITIES[1].fee); ok(fee > 0, "(the table used for the fee checks has an entry fee)", fee);
  await p.evaluate(() => playCity(CITIES[1])); await sleep(500);
  let s = await state(); ok(s.vs && s.coins === 100000, "no server: the fee is taken for a moment and is back before the VS screen finds the bot", s);
  await p.waitForFunction(() => /🤖/.test((document.getElementById("vsBn") || {}).textContent || ""), null, { timeout: 15000 }); await sleep(450); s = await state();
  ok(!s.aOn && !s.bOn && s.fly === 0 && s.coins === 100000, "...the VS screen shows no stake and no coins fly into a pot", s);
  ok(/refunded/i.test(s.toast) && /no coins/i.test(s.toast), "...and a toast says that the entry fee went back and no coins are given", s.toast);
  await p.waitForFunction(() => !!game && game.type === "ai" && !game.demo, null, { timeout: 15000 }); s = await state();
  ok(s.game && s.game.bot === true && s.game.pot === 0 && !s.game.net && s.coins === 100000, "...and the match is a bot match: no pot, the coins are all still there", s);

  // 3b) the server answers, nobody is online: the fee is held for the whole search (15 s) and goes back with the bot
  await stub("quiet"); await toTable();
  await p.evaluate(() => playCity(CITIES[1])); await sleep(3000); s = await state();
  ok(s.vs && s.coins === 100000 - fee && /Searching|…|\.\.\./.test(s.bn) && !/🤖/.test(s.bn), "searching: the fee is held while the server looks for a player", { coins: s.coins, bn: s.bn });
  await p.waitForFunction(() => /🤖/.test((document.getElementById("vsBn") || {}).textContent || ""), null, { timeout: 20000 }); await sleep(450); s = await state();
  ok(s.coins === 100000 && !s.aOn && !s.bOn && s.fly === 0 && /refunded/i.test(s.toast), "after 15 s the answer is a bot: the fee is back, no stake on the VS screen, the toast says so", s);
  await p.waitForFunction(() => !!game && game.type === "ai" && !game.demo, null, { timeout: 15000 }); s = await state(); ok(s.game && s.game.bot === true && s.game.pot === 0, "...bot match, no pot", s.game);

  // 3c) the CONTROL: a real player is found: the fee stays taken, the stakes fly into the pot, and the match is not a bot match
  await toTable();
  await p.evaluate(() => playCity(CITIES[1])); await sleep(700);
  await p.evaluate(() => searchWait({ opp: { name: "Rival", avatar: 3, level: 7, country: "UZ", cue: "start" }, seat: 0, room: "r1", seed: 11 }));
  await p.waitForFunction(() => /Rival/.test((document.getElementById("vsBn") || {}).textContent || ""), null, { timeout: 15000 }); await sleep(900); s = await state();
  ok(s.coins === 100000 - fee && !/🤖/.test(s.bn), "(control) a real player is found: the fee stays taken", { coins: s.coins, bn: s.bn });
  ok(s.fly > 0 || s.paid, "(control) ...the stakes of both players fly into the pot on the VS screen", { fly: s.fly, paid: s.paid, aOn: s.aOn, bOn: s.bOn });
  await p.waitForFunction(() => !!game && game.type === "ai" && !game.demo, null, { timeout: 15000 }); s = await state();
  ok(s.game && s.game.bot === false && s.game.net && s.game.pot === s.game.prize, "(control) ...and the match is a real one: G.net, the pot is the prize", s.game);

  // 3d) the Lounge (double or nothing): the stake goes back too, and it is a bot match without a pot
  await stub("off"); await toTable();
  await p.evaluate(() => playLounge(5000)); await sleep(500); s = await state(); ok(s.vs && s.coins === 100000, "Lounge, no server: the stake (5 000) is back at once", s);
  await p.waitForFunction(() => !!game && game.type === "ai" && !game.demo, null, { timeout: 20000 }); s = await state();
  ok(s.game && s.game.bot === true && s.game.pot === 0 && s.coins === 100000, "...a bot match, no pot, no coins lost", s);
  await stub("real");

  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
