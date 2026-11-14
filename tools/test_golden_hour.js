#!/usr/bin/env node
// "Oltin soat" / Golden Hour:  node tools/test_golden_hour.js
// Retention idea (the owner chose it): every day 20:00-21:00 by the player's own clock a won match pays +50% of its prize on top (coins only), a daily appointment that also gathers the players of one time zone
// at the same hour. The home strip names it while it runs (minutes left) and teases it 20 minutes before; the header of "Choose a table" always shows its schedule; the result screen gets a star row.
// The clock the game reads is goldenNow() (tests move it); the window is goldenHour(now) -> {on, left, next, start}.
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
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.unlock = () => {}; window.checkAch = () => {}; });   // (medals pay coins once: off, so the coin numbers below are exact)
    await sleep(4500); await p.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach(e => e.remove()); });   // (the start-up gifts - the daily reward, the medals of the profile - have all landed before the first match is measured)
    return p;
  }
  const clock = (p, h, m) => p.evaluate(([h, m]) => { window.goldenNow = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime(); }; }, [h, m]);
  const match = async (p, pre, win, lobby) => {
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { toMenu(); } catch (e) {} });
    await p.evaluate(() => { startMatch("ai", CITIES[2], { name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" }, null); });
    for (let i = 0; i < 40; i++) { await sleep(300); if (await p.locator("#tutSkip").count()) await p.locator("#tutSkip").click().catch(() => {}); if (await p.evaluate(() => canControl())) break; }
    const r = await p.evaluate(([pre, win, lobby]) => { profile.wstreak = pre; if (lobby) game.tourLobby = true; const G = game, c0 = profile.coins, lv0 = profile.level; window.__toasts = []; new MutationObserver(() => { document.querySelectorAll("#toasts .toast").forEach(e => { const t = e.textContent.replace(/\s+/g, " ").trim(); if (!window.__toasts.includes(t)) window.__toasts.push(t); }); }).observe(document.getElementById("toasts"), { childList: true, subtree: true });
      endGame(win ? 0 : 1, "test"); return { rw: G.rw ? JSON.parse(JSON.stringify(G.rw)) : null, c0, lv0, prize: CITIES[2].prize }; }, [pre, win, lobby]);
    await p.waitForSelector("#res.on #resBtns button", { timeout: 20000 }); await sleep(8500);
    const d = await p.evaluate(() => ({ c1: profile.coins, lv1: profile.level, toasts: window.__toasts.join(" | "), rows: [...document.querySelectorAll("#resList .rrow")].map(x => ({ t: x.textContent.trim().replace(/\s+/g, " "), img: !!x.querySelector("img"), k: x.dataset.k || "" })) }));
    return { ...r, ...d };
  };

  let p = await open({ width: 915, height: 412 }, true);
  // 1) the window itself (local clock)
  const w = await p.evaluate(() => { const t = (h, m, s = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, s, 0).getTime(); }, mm = x => Math.round(x / 60e3);
    const a = goldenHour(t(19, 59, 59)), b = goldenHour(t(20, 0)), c = goldenHour(t(20, 30)), d = goldenHour(t(20, 59, 59)), e = goldenHour(t(21, 0)), f = goldenHour(t(12, 0)), g = goldenHour(t(23, 30));
    return { before: [a.on, mm(a.next)], start: [b.on, mm(b.left)], mid: [c.on, mm(c.left)], lastSecond: [d.on], end: [e.on, mm(e.next)], noon: [f.on, mm(f.next)], late: [g.on, mm(g.next)], at: goldenAt(), span: goldenSpan() }; });
  ok(w.before[0] === false && w.before[1] === 0, "19:59:59: not yet, it starts in a second", w.before);
  ok(w.start[0] === true && w.start[1] === 60, "20:00: on, 60 minutes left", w.start);
  ok(w.mid[0] === true && w.mid[1] === 30, "20:30: on, 30 minutes left", w.mid);
  ok(w.lastSecond[0] === true, "20:59:59: still on", w.lastSecond);
  ok(w.end[0] === false && w.end[1] === 23 * 60, "21:00: over, the next one in 23 hours", w.end);
  ok(w.noon[0] === false && w.noon[1] === 8 * 60, "12:00: the next one in 8 hours", w.noon);
  ok(w.late[0] === false && w.late[1] === 20 * 60 + 30, "23:30: the next one tomorrow at 20:00 (20.5 hours)", w.late);
  ok(w.at === "20:00" && w.span === "20:00–21:00", "the schedule reads 20:00 / 20:00–21:00", w);

  // 2) a won match inside the hour: +50% of the prize, coins only, a star row and a toast
  await clock(p, 20, 30);
  let m = await match(p, 0, true, false);
  const gb = Math.round(m.prize * 0.5);
  ok(m.rw && m.rw.golden && m.rw.golden.pct === 50 && m.rw.golden.coins === gb, "a win at 20:30: the game decided +50% of the prize", m.rw);
  ok(m.lv1 !== m.lv0 ? m.c1 - m.c0 >= m.prize + gb : m.c1 - m.c0 === m.prize + gb, "...and the player got the prize + the bonus, in coins (nothing else)", { got: m.c1 - m.c0, prize: m.prize, gb, lv: [m.lv0, m.lv1] });
  const row = m.rows.find(x => /Golden Hour/.test(x.t));
  ok(!!row && row.img && /\+50%/.test(row.t), "...the result screen has the star row (Golden Hour +50%)", m.rows);
  ok(/Golden Hour/.test(m.toasts) && /\+50%/.test(m.toasts), "...and a toast names the Golden Hour", m.toasts.slice(0, 300));
  // 3) it stacks with the win streak (two separate rows, two separate bonuses)
  m = await match(p, 2, true, false);
  ok(m.rw.streak && m.rw.golden && (m.lv1 !== m.lv0 ? m.c1 - m.c0 >= m.prize + m.rw.streak.coins + m.rw.golden.coins : m.c1 - m.c0 === m.prize + m.rw.streak.coins + m.rw.golden.coins), "with the 3rd win in a row: prize + streak bonus + Golden Hour bonus", { got: m.c1 - m.c0, rw: m.rw });
  ok(m.rows.some(x => /×3/.test(x.t)) && m.rows.some(x => /Golden Hour/.test(x.t)), "...both rows are on the result screen", m.rows);
  // 4) no bonus: outside the hour, in a lobby tournament, after a loss
  await clock(p, 21, 5); m = await match(p, 0, true, false);
  ok(!(m.rw && m.rw.golden) && !m.rows.some(x => /Golden Hour/.test(x.t)) && m.c1 - m.c0 >= m.prize, "a win at 21:05 (the hour is over): no bonus", m.rw);
  await clock(p, 20, 30); m = await match(p, 0, true, true);
  ok(!(m.rw && m.rw.golden), "a lobby-tournament match inside the hour: no bonus (its prize is not coins)", m.rw);
  m = await match(p, 0, false, false);
  ok(!(m.rw && m.rw.golden) && !m.rows.some(x => /Golden Hour/.test(x.t)), "a lost match inside the hour: no bonus", m.rw);

  // 5) the home strip: while it runs, a teaser before it, nothing special at noon
  await p.evaluate(() => { profile.wstreak = 0; profile.tp = 0; profile.road = {}; const ps = passState(); ps.ms = []; ps.pts = 0; ps.got = {}; ps.prem = false; });   // (the matches above finished missions and moved the Road: nothing may wait to be taken here)
  const strip = (h, m2) => p.evaluate(([h, m2]) => { window.goldenNow = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m2, 0, 0).getTime(); }; document.getElementById("modal").classList.remove("on"); go("home"); const e = document.getElementById("hGoal"); return { goal: e.dataset.goal, text: document.getElementById("hGoalT").textContent, bar: document.getElementById("hGoalB").style.width, rdy: e.classList.contains("rdy"), icon: document.getElementById("hGoalI").textContent }; }, [h, m2]);
  let sg = await strip(20, 15);
  ok(sg.goal === "golden" && /Golden Hour: \+50% on wins — 45m left/.test(sg.text) && sg.rdy && sg.icon === "🌟" && sg.bar === "75%", "20:15: the strip says 'Golden Hour: +50% on wins — 45m left' (green, bar = time left)", sg);
  sg = await strip(19, 50);
  ok(sg.goal === "goldenSoon" && /Golden Hour at 20:00: \+50% on wins/.test(sg.text), "19:50: the strip teases 'Golden Hour at 20:00: +50% on wins'", sg);
  sg = await strip(12, 0);
  ok(sg.goal !== "golden" && sg.goal !== "goldenSoon", "12:00: the strip names an ordinary goal", sg);
  // a tap on the golden strip opens 'Choose a table'
  await strip(20, 15); await p.evaluate(() => document.getElementById("hGoal").click()); await sleep(500);
  ok(await p.evaluate(() => document.querySelector(".screen.on").id) === "cities", "a tap on the golden strip opens 'Choose a table'");

  // 6) the chip in the header of 'Choose a table'
  const chip = async (h, m2) => { await clock(p, h, m2); await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); go("cities"); }); await sleep(900); return p.evaluate(() => { const c = document.getElementById("ghChip"), h2 = document.querySelector("#cities .head h2"), bk = document.querySelector("#cities .head .back"), rc = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, hit = (a, b2) => a[0] < b2[2] - 1 && b2[0] < a[2] - 1 && a[1] < b2[3] - 1 && b2[1] < a[3] - 1;
    return { text: c.textContent, on: c.classList.contains("on"), shown: getComputedStyle(c).display !== "none" && c.offsetWidth > 0, clash: hit(rc(c), rc(h2)) || hit(rc(c), rc(bk)), clip: c.scrollWidth > c.clientWidth + 1 }; }); };
  let c = await chip(20, 30);
  ok(c.shown && c.on && /Golden Hour \+50% · 30m/.test(c.text) && !c.clash && !c.clip, "the header chip while it runs: 'Golden Hour +50% · 30m' (green)", c);
  c = await chip(14, 0);
  ok(c.shown && !c.on && /Golden Hour 20:00–21:00 · \+50%/.test(c.text) && !c.clash && !c.clip, "the header chip the rest of the day: the schedule", c);
  // 7) the sentences fit in every language
  const langs = ["uz", "en", "ru", "tr", "es", "pt", "ar", "id", "hi", "fr", "de", "ko", "ja", "zh", "th", "vi"], bad = [];
  for (const l of langs) for (const [h, m2] of [[20, 15], [19, 50], [14, 0]]) {
    await clock(p, h, m2); await p.evaluate(l => { applyLang(l); document.getElementById("modal").classList.remove("on"); go("home"); }, l); await sleep(260);
    const g = await p.evaluate(() => { const t = document.getElementById("hGoalT"); return { text: t.textContent, clip: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1, goal: document.getElementById("hGoal").dataset.goal, bad: /undefined|NaN|\{\d\}/.test(t.textContent) || !t.textContent.trim() }; });
    if ((h !== 14 && (g.clip || g.bad || !/^golden/.test(g.goal))) || (h === 14 && g.bad)) bad.push(l + " " + h + ":" + m2 + " " + g.goal + ": " + g.text);
    if (h === 14) { await p.evaluate(() => go("cities")); await sleep(400); const k = await p.evaluate(() => { const c2 = document.getElementById("ghChip"), r = c2.getBoundingClientRect(), hd = document.querySelector("#cities .head").getBoundingClientRect(); return { text: c2.textContent, clip: c2.scrollWidth > c2.clientWidth + 1, out: r.right > hd.right + 2 || r.left < hd.left - 2 }; }); if (k.clip || k.out || !k.text.trim()) bad.push(l + " chip: " + k.text); }
  }
  ok(bad.length === 0, "the golden sentences and the chip fit in all 16 languages", bad);
  await p.evaluate(() => { applyLang("en"); });
  await p.context().close();

  // 8) the chip and the strip collide with nothing at phone and computer sizes
  for (const [name, vp, touch] of [["landscape phone 915x412", { width: 915, height: 412 }, true], ["small landscape phone 832x380", { width: 832, height: 380 }, true], ["upright phone 393x730 (page turned)", { width: 393, height: 730 }, true], ["computer 1280x720", { width: 1280, height: 720 }, false]]) {
    const q = await open(vp, touch); await clock(q, 20, 15); await q.evaluate(() => { go("cities"); }); await sleep(1500);
    const g = await q.evaluate(() => { const c2 = document.getElementById("ghChip"), r = c2.getBoundingClientRect(), s = document.getElementById("cities").getBoundingClientRect(); return { onScreen: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, clip: c2.scrollWidth > c2.clientWidth + 1, text: c2.textContent, cards: document.querySelectorAll("#cities .city:not(.lounge)").length }; });
    ok(g.onScreen && !g.clip && g.cards >= 4, `${name}: the chip is on the screen, not cut, and the city cards are still there`, g);
    await q.context().close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
