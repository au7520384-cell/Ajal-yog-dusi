#!/usr/bin/env node
// The daily shot ("Kunlik zarba") in the game, end to end (real server + the page in a browser):  node tools/test_daily_shot.js
// Retention idea (the owner chose it): the same lucky-shot layout for every player each day (the server gives the day and a seed), 3 attempts, ranked by how close the gold ball stops to the target; share the result.
// The Lucky shot card offers it first while attempts are left; the home strip offers it too; the board shows everybody's best. Coins only (5 000 in the centre instead of the plain shot's 💵 3).
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8316, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8dsu-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), errs = [];
  const open = async (vp, touch) => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000 })));
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); });
    await p.waitForFunction(() => Net.acct && Net.acct.id, null, { timeout: 20000 }); await sleep(1200);
    await p.evaluate(() => { window.unlock = () => {}; window.checkAch = () => {}; document.getElementById("modal").classList.remove("on"); });
    return p;
  };
  const modal = p => p.evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), text: (document.querySelector("#modal .panel") || {}).innerText || "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent.trim()) }));
  const clickBtn = (p, re) => p.evaluate(r => { const b = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r).test(x.textContent)); if (b) b.click(); return !!b; }, re);
  // an attempt: the page has built the game; put the gold ball where the test wants it and end the shot
  const shoot = async (p, how) => { await p.evaluate(h => { const G = game; if (h === "miss") { G.shot = { firstHit: "8" }; G.balls[1].x = G.target.x + 400; G.balls[1].y = G.target.y; } else { G.shot = { firstHit: "gold" }; G.balls[1].x = G.target.x + (h === "near" ? 30 : 0); G.balls[1].y = G.target.y; } luckyFinish(); }, how); await sleep(3800); };

  let p = await open({ width: 915, height: 412 }, true);
  // 1) the layout is the same for the same seed, different for another, random without a seed, and always on the table
  const lay = await p.evaluate(() => { const same = JSON.stringify(luckyLayout(avRng(4242))) === JSON.stringify(luckyLayout(avRng(4242))), diff = JSON.stringify(luckyLayout(avRng(4242))) !== JSON.stringify(luckyLayout(avRng(4243))), rand = JSON.stringify(luckyLayout()) !== JSON.stringify(luckyLayout());
    let bad = 0; for (let s = 1; s <= 60; s++) { const L = luckyLayout(avRng(s * 7919)); for (const q of [L.cue, L.gold, L.target, ...L.extra]) if (!(q.x > 20 && q.x < FW - 20 && q.y > 20 && q.y < FH - 20)) bad++; }
    return { same, diff, rand, bad }; });
  ok(lay.same && lay.diff && lay.rand && lay.bad === 0, "luckyLayout(seed): the same seed, the same layout; another seed another one; no seed random; every ball on the table", lay);

  // 2) the Lucky shot card offers the daily shot first
  await p.evaluate(() => { profile.dshot = null; go("mini"); }); await sleep(900);
  await p.evaluate(() => document.querySelector('.mgc[data-act="lucky"]').click()); await sleep(600);
  let m = await modal(p);
  ok(m.on && /Daily Shot/.test(m.text) && m.btns.some(x => /Daily Shot \(3\)/.test(x)) && m.btns.some(x => /Lucky Shot/.test(x)), "the Lucky shot card offers: Daily Shot (3) or the plain Lucky Shot", m);
  await clickBtn(p, "Daily Shot"); await sleep(1800);
  const g1 = await p.evaluate(() => ({ mode, type: game && game.type, daily: game && game.daily, same: !!game && !!game.daily && JSON.stringify([game.balls[0].x, game.balls[0].y, game.balls[1].x, game.balls[1].y, game.target.x, game.target.y]) === (() => { const L = luckyLayout(avRng(game.daily.seed)); return JSON.stringify([L.cue.x, L.cue.y, L.gold.x, L.gold.y, L.target.x, L.target.y]); })() }));
  ok(g1.mode === "game" && g1.type === "lucky" && g1.daily && /^\d{4}-\d{2}-\d{2}$/.test(g1.daily.day) && g1.daily.n === 0 && g1.same, "the shot starts on the seeded layout of the server's day", g1);
  const coins0 = await p.evaluate(() => ({ c: profile.coins, cash: profile.cash || 0 }));

  // 3) attempt 1: a centre hit pays 5 000 coins (not cash), the window shows the place and the keys
  await shoot(p, "centre");
  m = await modal(p); const coins1 = await p.evaluate(() => ({ c: profile.coins, cash: profile.cash || 0 }));
  ok(m.on && /Daily Shot 1\/3/.test(m.text) && /Best: 0 px · #1 of 1/.test(m.text), "attempt 1: 'Daily Shot 1/3' and 'Best: 0 px · #1 of 1'", m.text);
  ok(coins1.c - coins0.c === 5000 && coins1.cash === coins0.cash, "...the centre pays 5 000 coins and no cash", { coins0, coins1 });
  ok(m.btns.some(x => /Again \(2\)/.test(x)) && m.btns.some(x => /Leaderboard/.test(x)) && m.btns.some(x => /Share/.test(x)) && m.btns.some(x => /Menyu|Menu/.test(x)), "...keys: Again (2), Leaderboard, Share, Menu", m.btns);
  // 4) attempt 2: a worse shot does not replace the best; attempt 3 is a miss
  await clickBtn(p, "Again"); await sleep(1800); await shoot(p, "near");
  m = await modal(p); ok(/Daily Shot 2\/3/.test(m.text) && /Best: 0 px · #1 of 1/.test(m.text), "attempt 2 (30 px): 2/3, the best is still 0 px", m.text);
  await clickBtn(p, "Again"); await sleep(1800); await shoot(p, "miss");
  m = await modal(p); ok(/Daily Shot 3\/3/.test(m.text) && !m.btns.some(x => /Again/.test(x)), "attempt 3 (a miss): 3/3, no 'Again' key any more", m);
  const srv1 = await p.evaluate(() => Net.api("/api/dshot/day", {}));
  ok(srv1.mine && srv1.mine.n === 3 && srv1.mine.d === 0 && srv1.rank === 1, "the server counted 3 attempts, best 0, rank 1", srv1);
  // 5) used up: the daily call shows the board; the card goes straight to the plain Lucky shot
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("mini"); }); await sleep(900);
  await p.evaluate(() => startDailyShot()); await sleep(1500); m = await modal(p);
  ok(m.on && /Today's best/.test(m.text) && /Alex|Guest|Player/i.test(m.text) || (m.on && /Today's best/.test(m.text)), "all attempts used: starting it shows today's board", m.text.slice(0, 200));
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); });
  await p.evaluate(() => { go("mini"); }); await sleep(700);
  await p.evaluate(() => document.querySelector('.mgc[data-act="lucky"]').click()); await sleep(900);
  const g2 = await p.evaluate(() => ({ modal: document.getElementById("modal").classList.contains("on"), mode, type: game && game.type, daily: game && game.daily }));
  ok(!g2.modal && g2.mode === "game" && g2.type === "lucky" && !g2.daily, "the card after the three attempts: the plain Lucky shot starts at once (no daily)", g2);
  await p.evaluate(() => { toMenu("home"); }); await sleep(500);

  // 6) the board shows another player too (registered straight on the server; the same distance: the earlier shot ranks higher)
  const Z = await (await fetch(base + "/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Zed", avatar: 7 }) })).json();
  const day = (await p.evaluate(() => Net.api("/api/dshot/day", {}))).day;
  await fetch(base + "/api/dshot/submit", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Z.id}:${Z.token}` }, body: JSON.stringify({ day, d: 0, hit: true }) });
  await p.evaluate(() => dailyShotTop()); await sleep(1500); m = await modal(p);
  const rows = await p.evaluate(() => [...document.querySelectorAll("#modal .lbr")].map(x => ({ t: x.innerText.replace(/\s+/g, " ").trim(), me: x.classList.contains("me") })));
  ok(rows.length === 2 && rows[0].me && /Alex/.test(rows[0].t) && /Zed/.test(rows[1].t) && /0 px/.test(rows[0].t) && /0 px/.test(rows[1].t) && /#1 of 2/.test(m.text), "the board: Alex first (0 px, the earlier shot of the same distance), Zed second; Alex is marked as me, '#1 of 2'", { rows, m: m.text.slice(0, 160) });
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); });

  // 7) the share text
  const sh = await p.evaluate(async () => { window.__share = null; navigator.share = async o => { window.__share = o; }; const TGsave = typeof TG !== "undefined" ? TG : null; shareDailyShot(7, 3); await new Promise(r => setTimeout(r, 200)); return window.__share; });
  ok(sh && /Daily Shot: the gold ball stopped 7 px from the target! Beat me! #3/.test(sh.text) && /^https?:/.test(sh.url || ""), "the share text names the distance and the place, with a link", sh);

  // 8) the home strip offers it while attempts are left, and not afterwards
  const strip = await p.evaluate(() => { profile.dshot = null; const a = homeGoals().map(x => x.id); profile.dshot = { day: dshotDayKey(), n: 3, d: 0 }; const b = homeGoals().map(x => x.id); profile.dshot = { day: "2001-01-01", n: 3, d: 0 }; const c = homeGoals().map(x => x.id); return { fresh: a.includes("dshot"), used: b.includes("dshot"), old: c.includes("dshot") }; });
  ok(strip.fresh && !strip.used && strip.old, "home strip: offered while attempts are left, gone when all 3 are used, back the next day", strip);
  await p.context().close();

  // 9) the windows fit the screen at phone sizes
  for (const [name, vp, touch] of [["landscape phone 915x412", { width: 915, height: 412 }, true], ["upright phone 393x730 (page turned)", { width: 393, height: 730 }, true]]) {
    const q = await open(vp, touch);
    await q.evaluate(() => { profile.dshot = null; startDailyShot(); }); await sleep(2200);
    await shoot(q, "near"); await q.waitForSelector("#modal.on #mBtns button", { timeout: 8000 });
    const f = await q.evaluate(() => { const r = document.querySelector("#modal .panel").getBoundingClientRect(), bs = [...document.querySelectorAll("#mBtns button")].map(x => { const t = x.getBoundingClientRect(); return t.left >= -1 && t.top >= -1 && t.right <= innerWidth + 1 && t.bottom <= innerHeight + 1; }); return { panel: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, buttons: bs.every(Boolean), n: bs.length }; });
    ok(f.panel && f.buttons && f.n >= 3, `${name}: the result window and its keys are on the screen`, f);
    await q.context().close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
