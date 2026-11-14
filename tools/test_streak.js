#!/usr/bin/env node
// The win streak pays:  node tools/test_streak.js
// The game counted `profile.wstreak` (shown only in the profile) but paid nothing for it. Retention idea (the owner chose it): 3 wins in a row = +10% of the match prize, 5 and more = +25%.
// Coins only (never diamonds), only for a won city match that pays a prize (not lobby tournaments, trials or lost matches); a loss ends the streak.
// The bonus is paid as a toast + coins a moment after the win, and the result screen gets a row (flame, "+coins", "x3 · +10%") under the prize; the row must not collide with anything at phone sizes.
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  async function open(vp, touch) {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", deviceScaleFactor: 1, hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 12 })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); });
    await p.evaluate(() => { window.unlock = () => {}; window.checkAch = () => {}; }); await sleep(4500); return p;   // (the medals pay coins once - the streak medals (3, 5, 10 ... in a row), the first win, the clean table ... - switched off here, so they do not move the coin numbers below)
  }
  // a match of city 2 ended at once: pre = the streak before it, win = true / false, lobby = a lobby-tournament match; returns what the game decided and what the player got
  const match = async (p, pre, win, lobby) => {
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { toMenu(); } catch (e) {} });
    await p.evaluate(() => { startMatch("ai", CITIES[2], { name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" }, null); });
    for (let i = 0; i < 40; i++) { await sleep(300); if (await p.locator("#tutSkip").count()) await p.locator("#tutSkip").click().catch(() => {}); if (await p.evaluate(() => canControl())) break; }
    const r = await p.evaluate(([pre, win, lobby]) => { profile.wstreak = pre; if (lobby) game.tourLobby = true; const G = game, c0 = profile.coins, lv0 = profile.level; endGame(win ? 0 : 1, "test"); return { rw: G.rw ? JSON.parse(JSON.stringify(G.rw)) : null, c0, lv0, prize: CITIES[2].prize, streak: profile.wstreak }; }, [pre, win, lobby]);
    await p.waitForSelector("#res.on #resBtns button.green, #res.on #resBtns button", { timeout: 20000 }); await sleep(6500);
    const d = await p.evaluate(() => ({ c1: profile.coins, lv1: profile.level, rows: [...document.querySelectorAll("#resList .rrow")].map(x => ({ t: x.textContent.trim().replace(/\s+/g, " "), img: !!x.querySelector("img"), k: x.dataset.k || "" })) }));
    return { ...r, ...d };
  };

  // 1) the rule
  let p = await open({ width: 915, height: 412 }, true);
  const rule = await p.evaluate(() => ({ pct: [0, 1, 2, 3, 4, 5, 6, 9, 20].map(streakPct), next: [0, 1, 2, 3, 4, 5, 9].map(n => streakNext(n)) }));
  ok(JSON.stringify(rule.pct) === JSON.stringify([0, 0, 0, 10, 10, 25, 25, 25, 25]), "streakPct: 3 wins +10%, 5 and more +25%, nothing below 3", rule.pct);
  ok(JSON.stringify(rule.next) === JSON.stringify([[3, 10], [3, 10], [3, 10], [5, 25], [5, 25], null, null]), "streakNext: the step the streak heads for (null at the top)", rule.next);

  // 2) the third win in a row: +10% of the prize
  let m = await match(p, 2, true, false);
  ok(m.streak === 3 && m.rw && m.rw.streak && m.rw.streak.n === 3 && m.rw.streak.pct === 10 && m.rw.streak.coins === Math.round(m.prize * 0.10), "3rd win in a row: the game decided +10% of the prize", m);
  ok(m.lv1 !== m.lv0 ? m.c1 - m.c0 >= m.prize + m.rw.streak.coins : m.c1 - m.c0 === m.prize + m.rw.streak.coins, "...and the player got the prize + the bonus, in coins (nothing else)", { got: m.c1 - m.c0, prize: m.prize, bonus: m.rw && m.rw.streak && m.rw.streak.coins, lv: [m.lv0, m.lv1] });
  const row = m.rows.find(x => /×3/.test(x.t));
  ok(!!row && /\+10%/.test(row.t) && row.img && row.t.includes(String(m.rw.streak.coins).slice(0, 1)), "...and the result screen has the streak row (flame, coins, ×3 · +10%)", m.rows);
  ok(m.rows.some(x => x.k === "coins") && m.rows.findIndex(x => /×3/.test(x.t)) > m.rows.findIndex(x => x.k === "coins"), "...under the prize row", m.rows);

  // 3) the fifth: +25%, and further wins stay at +25%
  m = await match(p, 4, true, false);
  ok(m.streak === 5 && m.rw.streak && m.rw.streak.pct === 25 && m.rw.streak.coins === Math.round(m.prize * 0.25), "5th win in a row: +25% of the prize", m.rw);
  m = await match(p, 11, true, false);
  ok(m.streak === 12 && m.rw.streak && m.rw.streak.pct === 25, "12th win in a row: still +25% (the cap)", m.rw);

  // 4) no bonus below three, in a lobby tournament, or after a loss; a loss ends the streak
  m = await match(p, 0, true, false);
  ok(m.streak === 1 && !(m.rw && m.rw.streak) && !m.rows.some(x => /×\d/.test(x.t)), "1st win: no bonus, no row", m);
  m = await match(p, 1, true, false);
  ok(m.streak === 2 && !(m.rw && m.rw.streak), "2nd win: no bonus yet", m.rw);
  m = await match(p, 6, true, true);
  ok(m.streak === 7 && !(m.rw && m.rw.streak) && !m.rows.some(x => /×\d/.test(x.t)), "a lobby-tournament win counts for the streak but pays no streak bonus (its prize is not coins)", m);
  m = await match(p, 4, false, false);
  ok(m.streak === 0 && !(m.rw && m.rw.streak) && !m.rows.some(x => /×\d/.test(x.t)), "a lost match: the streak is 0 again and there is no bonus", m);

  // 5) the toast of the bonus names the streak (toasts wait in a queue, so collect them for a while)
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { toMenu(); } catch (e) {} window.__toasts = []; new MutationObserver(() => { document.querySelectorAll("#toasts .toast").forEach(e => { const t = e.textContent.replace(/\s+/g, " ").trim(); if (!window.__toasts.includes(t)) window.__toasts.push(t); }); }).observe(document.getElementById("toasts"), { childList: true, subtree: true }); });
  await p.evaluate(() => { startMatch("ai", CITIES[2], { name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" }, null); });
  for (let i = 0; i < 40; i++) { await sleep(300); if (await p.locator("#tutSkip").count()) await p.locator("#tutSkip").click().catch(() => {}); if (await p.evaluate(() => canControl())) break; }
  await p.evaluate(() => { profile.wstreak = 2; endGame(0, "test"); }); await sleep(16000);
  const toast = await p.evaluate(() => window.__toasts.join(" | "));
  ok(/×3 · \+10%/.test(toast), "the toast says: win streak ×3 · +10%", toast.slice(0, 400));
  await p.context().close();

  // 6) the extra row does not collide with anything: landscape phone, upright phone (the page turns), computer
  for (const [name, vp, touch] of [["landscape phone 915x412", { width: 915, height: 412 }, true], ["small landscape phone 832x380", { width: 832, height: 380 }, true], ["upright phone 393x730", { width: 393, height: 730 }, true], ["computer 1280x720", { width: 1280, height: 720 }, false]]) {
    const q = await open(vp, touch); const r = await match(q, 4, true, false);
    const g = await q.evaluate(() => { const rc = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, hit = (a, b) => a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1;
      const rows = [...document.querySelectorAll("#resList .rrow")], others = [...document.querySelectorAll("#resBtns button, #resA, #resB, #resPot, #resLogo")].filter(e => e.offsetWidth > 0), bad = [];
      rows.forEach(w => others.forEach(o => { if (hit(rc(w), rc(o))) bad.push((w.textContent.trim().slice(0, 12)) + " x " + (o.id || o.className)); }));
      const sr = rows.filter(w => /×/.test(w.textContent))[0], list = document.getElementById("resList"), lr = rc(list);
      return { n: rows.length, bad, hasStreak: !!sr, inScreen: rows.every(w => { const q = rc(w); return q[0] >= -1 && q[1] >= -1 && q[2] <= innerWidth + 1 && q[3] <= innerHeight + 1; }), clipped: sr ? sr.scrollWidth > sr.clientWidth + 1 : null }; });
    ok(g.hasStreak && g.n >= 4, `${name}: the result list shows the streak row (${g.n} rows)`, g);
    ok(g.bad.length === 0 && g.inScreen, `${name}: no row collides with the keys, avatars or logo, all on the screen`, g);
    ok(g.clipped === false, `${name}: the streak row's text fits its row`, g);
    await q.context().close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
