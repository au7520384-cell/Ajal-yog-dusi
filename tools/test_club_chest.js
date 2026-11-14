#!/usr/bin/env node
// The club chest ("Klub sandig'i") in the game, end to end (real server + the page in a browser):  node tools/test_club_chest.js
// Retention idea (the owner chose it): the wins of the club's members this week fill a shared chest with three steps; every member who won this week takes each reached step once (coins). The club screen shows the chest,
// the home "Next goal" strip says "Club Chest: COLLECT!" when a step waits and "Club Chest: N more wins" otherwise.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8318, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8chu-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), errs = [];
  const open = async (vp, touch, lang = "en") => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(l => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: l, coins: 1000, level: 8, wins: 0 })), lang);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); });
    await p.waitForFunction(() => Net.acct && Net.acct.id, null, { timeout: 20000 }); await sleep(1500);
    await p.evaluate(() => { window.unlock = () => {}; window.checkAch = () => {}; document.getElementById("modal").classList.remove("on"); });
    return p;
  };
  const clean = p => p.evaluate(() => { profile.wstreak = 0; profile.tp = 0; profile.road = {}; const ps = passState(); ps.ms = []; ps.pts = 0; ps.got = {}; ps.prem = false; profile.dshot = { day: dshotDayKey(), n: 3, d: 0 }; });   // (nothing else waits on the home strip)

  let p = await open({ width: 915, height: 412 }, true);
  await p.evaluate(async () => { profile.level = 8; await Net.sync(); const r = await Net.api("/api/clubs/create", { name: "Chest Club", badge: 0, color: 0 }); window.__club = r; await Net.sync(); });
  await clean(p);
  // 1) an empty chest
  await p.evaluate(() => go("clubsScr")); await sleep(1500);
  let c = await p.evaluate(() => { const e = document.querySelector("#clubBody .cchest"); return e ? { text: e.innerText.replace(/\s+/g, " "), tiers: [...e.querySelectorAll(".cct")].length, btns: e.querySelectorAll("[data-chest]").length } : null; });
  ok(c && /Club Chest/.test(c.text) && /0 \/ 5 wins/.test(c.text) && c.tiers === 3 && c.btns === 0 && /Win at least once this week/.test(c.text), "the club screen shows an empty chest: 0 / 5 wins, three steps, nothing to take, 'win at least once'", c);
  ok(/20 000/.test(c.text) && /60 000/.test(c.text) && /150k/.test(c.text), "...with the coins of the three steps (20 000 / 60 000 / 150k)", c);
  // 2) six wins: step 1 is reached and Alex has won
  await p.evaluate(async () => { profile.wins = (profile.wins | 0) + 6; save(); await Net.sync(); }); await clean(p);
  await p.evaluate(() => { go("home"); }); await sleep(600);
  let g = await p.evaluate(() => { const e = document.getElementById("hGoal"); return { goal: e.dataset.goal, text: document.getElementById("hGoalT").textContent, rdy: e.classList.contains("rdy"), ids: homeGoals().map(x => x.id) }; });
  ok(g.goal === "chestReady" && /Club Chest: COLLECT!/.test(g.text) && g.rdy, "the home strip: 'Club Chest: COLLECT!' (green) once a step is reached and the player has won", g);
  await p.evaluate(() => document.getElementById("hGoal").click()); await sleep(1800);
  const screen = await p.evaluate(() => document.querySelector(".screen.on").id); ok(screen === "clubsScr", "a tap on it opens the club screen", screen);
  c = await p.evaluate(() => { const e = document.querySelector("#clubBody .cchest"); return { text: e.innerText.replace(/\s+/g, " "), btns: [...e.querySelectorAll("[data-chest]")].map(x => [x.dataset.chest, x.disabled]), on: [...e.querySelectorAll(".cct.on")].length }; });
  ok(/6 \/ 15 wins/.test(c.text) && c.on === 1 && c.btns.length === 1 && c.btns[0][0] === "1" && c.btns[0][1] === false && /Members' wins this week fill the chest/.test(c.text), "the chest: 6 / 15 wins, step 1 lit with an enabled Take key", c);
  // 3) taking it: 20 000 coins arrive, the step shows done
  const coins0 = await p.evaluate(() => profile.coins);
  await p.evaluate(() => document.querySelector("#clubBody [data-chest]").click()); await sleep(3500);
  const after = await p.evaluate(() => ({ coins: profile.coins, e: document.querySelector("#clubBody .cchest") && document.querySelector("#clubBody .cchest").innerText.replace(/\s+/g, " "), done: document.querySelectorAll("#clubBody .cct.got").length, btns: document.querySelectorAll("#clubBody [data-chest]").length }));
  ok(after.coins - coins0 === 20000 && after.done === 1 && after.btns === 0 && /✅/.test(after.e), "Take: +20 000 coins came by the next sync, step 1 shows ✅, no key left", { coins0, after });
  await clean(p); await p.evaluate(() => { go("home"); }); await sleep(600);
  g = await p.evaluate(() => { const x = homeGoals().find(y => y.id === "chest"); return { goal: x && x.id, text: x && x.text, wins: x && x.wins, top: homeGoals()[0].id, chestReady: homeGoals().some(y => y.id === "chestReady") }; });
  ok(g.goal === "chest" && /Club Chest: 9 more wins/.test(g.text) && !g.chestReady, "afterwards the strip knows the next step: 'Club Chest: 9 more wins' (it ranks behind goals that need fewer wins, such as the Road)", g);
  // 4) a player who has not won this week sees the step but cannot take it
  const E = await (await fetch(base + "/api/register", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "" }, body: JSON.stringify({ name: "Eve", avatar: 2 }) })).json();
  await fetch(base + "/api/sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${E.id}:${E.token}` }, body: JSON.stringify({ name: "Eve", level: 8, wins: 0 }) });
  const clubId = (await p.evaluate(() => Net.api("/api/clubs/mine"))).club.id;
  await fetch(base + "/api/clubs/join", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${E.id}:${E.token}` }, body: JSON.stringify({ id: clubId }) });
  const er = await (await fetch(base + "/api/clubs/chest", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${E.id}:${E.token}` }, body: JSON.stringify({ tier: 1 }) })).json();
  ok(er.error === "no_wins", "Eve joined and has not won this week: the server refuses her step 1", er);
  await p.context().close();

  // 5) the card fits at phone sizes and in every language
  for (const [name, vp, touch] of [["landscape phone 915x412", { width: 915, height: 412 }, true], ["upright phone 393x730 (page turned)", { width: 393, height: 730 }, true]]) {
    const q = await open(vp, touch); await q.evaluate(async () => { profile.level = 8; await Net.sync(); await Net.api("/api/clubs/create", { name: "Fit Club " + Math.floor(Math.random() * 900), badge: 0, color: 0 }); profile.wins = 7; save(); await Net.sync(); go("clubsScr"); }); await sleep(2000);
    const f = await q.evaluate(() => { const e = document.querySelector("#clubBody .cchest"), r = e.getBoundingClientRect(), s = document.getElementById("clubsScr").getBoundingClientRect(), cs = [...e.querySelectorAll(".cct, .cch")];
      return { w: Math.round(r.width), inside: r.left >= s.left - 1 && r.right <= s.right + 1, clipped: cs.filter(x => x.scrollWidth > x.clientWidth + 1).length, tall: Math.round(r.height) }; });
    ok(f.inside && f.clipped === 0, `${name}: the chest card is inside the screen and nothing in it is cut`, f);
    await q.context().close();
  }
  const bad = [];
  const q = await open({ width: 915, height: 412 }, true); await q.evaluate(async () => { profile.level = 8; await Net.sync(); await Net.api("/api/clubs/create", { name: "Lang Club", badge: 0, color: 0 }); profile.wins = 7; save(); await Net.sync(); });
  for (const l of ["uz", "en", "ru", "tr", "es", "pt", "ar", "id", "hi", "fr", "de", "ko", "ja", "zh", "th", "vi"]) {
    await q.evaluate(l => { applyLang(l); go("clubsScr"); }, l); await sleep(1100);
    const k = await q.evaluate(() => { const e = document.querySelector("#clubBody .cchest"); if (!e) return { none: true }; const cs = [...e.querySelectorAll(".cct, .cch, .cct b, .cct small, .cch b, .cch span")]; return { clip: cs.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.className + ":" + x.textContent.slice(0, 20)), text: e.innerText, raw: /undefined|NaN|\{\d\}/.test(e.innerText) }; });
    if (k.none || k.clip.length || k.raw) bad.push(l + " " + JSON.stringify(k).slice(0, 160));
  }
  ok(bad.length === 0, "the chest card fits in all 16 languages (no cut text, no {0} left)", bad);
  await q.evaluate(() => applyLang("en")); await q.context().close();
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
