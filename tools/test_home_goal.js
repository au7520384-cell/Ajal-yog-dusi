#!/usr/bin/env node
// "Next goal" strip on the home screen:  node tools/test_home_goal.js
// Retention idea (the owner chose it): a reward that is close makes people play one more game, so the home screen names the NEAREST reward under the mode cards:
//   "Win streak 2/3: +10% bonus", "Trophy Road: 2 more trophies", "Season Pass: 20 points to level 5", a daily mission "4 wins 1/4" ... with a progress bar; a tap opens the right screen.
//   Things that wait to be taken (a finished mission, a Pass tier or a Road prize) come first ("Season Pass: COLLECT!"); the rest are ranked by the WINS they still need.
// This checks the ranking, the tap targets, that the text fits in every language, and that the strip collides with nothing at phone and computer sizes (the owner's home screen is a fixed mock-up).
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const SETUPS = {   // each one is a player state; every state starts from "no mission, no streak, no trophies, no Pass points"
  fresh: "",
  streak: "profile.wstreak = 2; passState().ms = [{i:0,c:0,done:false}];",
  mission: "passState().ms = [{i:1,c:1,done:false}];",
  road: "profile.tp = 6;",
  pass: "passState().pts = PASS_STEP - 20;",
  keep: "profile.wstreak = 6;",
  msnReady: "passState().ms = [{i:2,c:3,done:true,claimed:false}];",
  passReady: "passState().pts = PASS_STEP * 2 + 5;",
  roadReady: "profile.tp = 10;",
  all: "profile.wstreak = 2; passState().ms = [{i:2,c:3,done:true,claimed:false}]; passState().pts = PASS_STEP * 2 + 5; profile.tp = 10;",
};
const BASE = "profile.wstreak = 0; profile.tp = 0; profile.road = {}; const ps = passState(); ps.ms = []; ps.pts = 0; ps.got = {}; ps.prem = false; profile.lastCity = CITIES[0].id;";
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  async function open(vp, touch) {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", deviceScaleFactor: 1, hasTouch: touch, isMobile: touch }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 0 })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.unlock = () => {}; window.checkAch = () => {}; });
    return p;
  }
  const state = (p, k) => p.evaluate(([base, js]) => { (0, eval)(base); if (js) (0, eval)(js); go("home"); document.getElementById("modal").classList.remove("on"); const g = homeGoals(), e = document.getElementById("hGoal"); return { ids: g.map(x => x.id), top: g[0] && g[0].id, shown: !!e && getComputedStyle(e).display !== "none", goal: e && e.dataset.goal, text: document.getElementById("hGoalT").textContent, label: document.getElementById("hGoalL").textContent, bar: document.getElementById("hGoalB").style.width, frac: g[0] && Math.round(g[0].frac * 100) }; }, [BASE, SETUPS[k]]);

  let p = await open({ width: 915, height: 412 }, true);
  await sleep(1500);
  // 1) what comes first
  const R = {}; for (const k of Object.keys(SETUPS)) R[k] = await state(p, k);
  ok(R.fresh.shown && ["road", "pass"].includes(R.fresh.top), "a fresh player gets a goal (the Road or the Pass), the strip is shown", R.fresh);
  ok(R.streak.top === "streak" && /2\/3/.test(R.streak.text) && /10%/.test(R.streak.text) && R.streak.bar === "67%", "win streak 2: 'Win streak 2/3: +10% bonus' first, bar 67%", R.streak);
  ok(R.mission.top === "road" && R.mission.ids.includes("msn1"), "a mission that needs 3 wins comes after the Road prize that needs 2", R.mission);
  ok(R.road.top === "road" && /2 more/.test(R.road.text), "Road: 2 trophies to the next prize", R.road);
  ok(R.pass.top === "pass" && /20 ♞/.test(R.pass.text) && /level 1/.test(R.pass.text), "Pass: 20 points to the next level", R.pass);
  ok(R.keep.top === "streakKeep" && /25%/.test(R.keep.text), "a streak of 6: 'keep your streak: +25%'", R.keep);
  ok(R.msnReady.top === "msnReady" && /COLLECT/i.test(R.msnReady.text) && R.msnReady.bar === "100%", "a finished mission waits to be taken: 'Missions: COLLECT!'", R.msnReady);
  ok(R.passReady.top === "passReady", "Pass tiers waiting to be taken come first", R.passReady);
  ok(R.roadReady.top === "roadReady", "a Road prize waiting to be taken comes first", R.roadReady);
  ok(JSON.stringify(R.all.ids.slice(0, 3)) === JSON.stringify(["msnReady", "passReady", "roadReady"]), "when several wait: missions, then the Pass, then the Road", R.all.ids);
  ok(R.fresh.label === "Next goal", "the label is translated", R.fresh);

  // 2) the tap opens the right place
  const tap = async k => { await state(p, k); await p.evaluate(() => document.getElementById("hGoal").click()); await sleep(500); return p.evaluate(() => ({ screen: (document.querySelector(".screen.on") || {}).id, modal: document.getElementById("modal").classList.contains("on") })); };
  let t = await tap("streak"); ok(t.screen === "cities", "streak goal: opens 'Choose a table'", t);
  t = await tap("road"); ok(t.screen === "roadScr", "Road goal: opens the Trophy Road", t);
  t = await tap("pass"); ok(t.screen === "passScr", "Pass goal: opens the Season Pass", t);
  t = await tap("msnReady"); ok(t.screen === "passScr" && t.modal, "mission waiting: opens the missions window", t);
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); });

  // 3) the text fits in every language (states with the longest sentences)
  const langs = ["uz", "en", "ru", "tr", "es", "pt", "ar", "id", "hi", "fr", "de", "ko", "ja", "zh", "th", "vi"], bad = [];
  for (const l of langs) for (const k of ["keep", "pass", "streak", "road", "msnReady"]) {
    await p.evaluate(([base, js, l]) => { applyLang(l); (0, eval)(base); (0, eval)(js); go("home"); document.getElementById("modal").classList.remove("on"); }, [BASE, SETUPS[k], l]); await sleep(260);
    const c = await p.evaluate(() => { const t = document.getElementById("hGoalT"), e = document.getElementById("hGoal"), r = e.getBoundingClientRect(), tr = t.getBoundingClientRect();
      return { clip: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1, text: t.textContent, empty: !t.textContent.trim() || /undefined|NaN|\{\d\}/.test(t.textContent), inside: tr.left >= r.left - 1 && tr.right <= r.right + 1 && tr.top >= r.top - 1 && tr.bottom <= r.bottom + 1 }; });
    if (c.clip || c.empty || !c.inside) bad.push(l + "/" + k + ": " + c.text);
  }
  ok(bad.length === 0, "the goal text fits inside the strip in all 16 languages (5 states each), no {0} / undefined left", bad);
  await p.evaluate(() => { applyLang("en"); });

  // 4) it comes back to life when the state changes (a won match moves the streak): updateHomeDots refreshes it
  await state(p, "fresh"); const before = await p.evaluate(() => document.getElementById("hGoalT").textContent);
  const after = await p.evaluate(() => { profile.wstreak = 2; passState().ms = []; updateHomeDots(); return document.getElementById("hGoalT").textContent; });
  ok(before !== after && /streak 2\/3/i.test(after), "updateHomeDots refreshes the strip when the player's state changes", { before, after });
  await p.context().close();

  // 5) it collides with nothing, at phone and computer sizes (the home screen is a fixed mock-up)
  for (const [name, vp, touch] of [["landscape phone 915x412", { width: 915, height: 412 }, true], ["small landscape phone 832x380", { width: 832, height: 380 }, true], ["upright phone 393x730 (page turned)", { width: 393, height: 730 }, true], ["upright phone 360x640", { width: 360, height: 640 }, true], ["computer 1280x720", { width: 1280, height: 720 }, false], ["computer 1920x1080", { width: 1920, height: 1080 }, false]]) {
    const q = await open(vp, touch); await sleep(1200); await state(q, "streak"); await sleep(700);
    const g = await q.evaluate(() => { const rc = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, hit = (a, b) => a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1;
      const me = document.getElementById("hGoal"), mr = rc(me), sel = ["#tPlay", "#tTour", "#tEvents", "#tMini", "#tWithFr", "#boxSlots", "#hLimited", "#hLoop", "#hWorld", ".hbt", "#hOnline", ".hpassart"], bad = [];
      for (const s of sel) document.querySelectorAll("#hstage " + s).forEach(o => { if (o.offsetWidth > 0 && getComputedStyle(o).display !== "none" && getComputedStyle(o).visibility !== "hidden" && hit(mr, rc(o))) bad.push(s); });
      const t = document.getElementById("hGoalT"); const long = Math.max(mr[2] - mr[0], mr[3] - mr[1]), short = Math.min(mr[2] - mr[0], mr[3] - mr[1]);   // (a phone held upright shows the page turned: the strip's long side runs up the screen)
      return { bad, long: Math.round(long), h: Math.round(short), onScreen: mr[0] >= 0 && mr[1] >= 0 && mr[2] <= innerWidth + 1 && mr[3] <= innerHeight + 1, fs: parseFloat(getComputedStyle(t).fontSize) * (long / me.offsetWidth) }; });
    ok(g.bad.length === 0 && g.onScreen, `${name}: the strip touches no card, button or box slot and is on the screen`, g);
    ok(g.h >= 30 && g.fs >= 9, `${name}: it is big enough to tap (${g.h} px tall) and to read (${g.fs.toFixed(1)} px text)`, g);
    await q.context().close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
