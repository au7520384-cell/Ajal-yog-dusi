#!/usr/bin/env node
// The new modes (Nov 22, the owner's list): node tools/test_pro_modes.js   (B8_ROOT=<repo copy>; DAYS=365 plays every day of a year, default 30; ~4 min with the default, one browser, no game server)
//  1) trick shots: the day's five layouts exist, are solvable in the real physics (the shot that the layout was built around pots the 8 and keeps the cue ball on the table, also with a band of aims), are the same for the same day
//  2) the six lessons: solvable, and the spin lessons are NOT solved by a plain shot (follow / draw need the spin); the cue ball's rules (follow line / draw line) work
//  3) a trick shot played through the UI: win -> stars, coins once per puzzle per day, the replay opens, the 10 s clip is a real webm; a miss resets the table and counts the attempt
//  4) bot levels: easy / medium / hard set the bot's aim noise, a match against them ends in our own result window and pays nothing but the one-time first win; the old city match is untouched (G.pro unset, pays as before)
//  5) 9-ball: the rack, "lowest ball first", the rail rule, the 9 on a foul goes back, the legal 9 wins; a whole match against the hard bot ends
//  6) 2v2: the order of shooters is A1, B1, A2, B2 ..., a side keeps its player while it keeps the table; all three modes end
//  7) shot analysis: the numbers of a match, the best and the worst shot keep frames for the replay
//  8) every new text has a translation in all 15 languages
//  9) on a portal (the page in a frame, NO_SOCIAL): the replay plays, but there is no share key and no link on the picture
// 10) the screen of the new modes is made like the Minigames screen: its colours, wooden frames, painted pictures, green keys, the red dots, the leaderboard's rows in the lists
// 11) SCALE (the owner: "pay attention to the scale too"): on every phone / tablet size (landscape, and the page turned on an upright phone) the screen of the new modes shows both rows without a scroll bar and its pictures are visible,
//     and the five lists and the analysis fit their window (no scroll bar inside, the Close key on the screen)
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 300))); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource|unsupported MIME/.test(m.text())) errs.push("console: " + m.text().slice(0, 300)); });
  await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 12 })); });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.unlock = () => {}; window.checkAch = () => {}; });
  await sleep(2500);
  await p.evaluate(() => {
    window.toast = () => {};
    window.simL = (L, ang, power, spx, spy) => {   // one shot in the real physics on a copy of a layout
      const balls = trickBalls(L), cue = balls[0], sp = Math.max(0.6, power * 56);
      cue.vx = Math.cos(ang) * sp; cue.vy = Math.sin(ang) * sp; cue.z = cue.vz = 0; applyStrike(cue, spx || 0, spy || 0, 0.7, 0);
      const g = {balls, pockets: POCKETS, demo: true, shot: {firstHit: null, potted: [], rails: 0}, sinking: [], tray: [], flashes: [], sparks: [], type: "ai"};
      for (let f = 0; f < 900; f++) { physicsFrame(g); if (!anyMoving(balls)) break; }
      return g;
    };
    window.aimOf = L => { const s = L.segs && L.segs[0], a = s ? s[0] : L.cue, c = s ? s[1] : L.G; return Math.atan2(c.y - a.y, c.x - a.x); };
    window.okShot = (L, ang, pw, sx, sy) => { const g = simL(L, ang, pw, sx, sy), s = g.shot, off = s.off || [], c = g.balls[0]; return s.potted.includes(L.target) && !s.potted.includes(0) && !off.includes(0) && !off.includes(L.target) && (!L.goal || !L.goal(c, L)); };
    // a whole match without waiting for the clock: AI seats think at once, a HUMAN seat shoots the bot's plan through requestShot (a human shot for the analysis)
    window.autoplay = maxFrames => {
      const G = game; let n = 0, shots = 0; if (G.intro) G.intro = null;
      for (; n < maxFrames && !G.over; n++) {
        if (G !== game) break;
        const pl = G.players[G.cur];
        if (!G.moving && !G.strike && !G.aiTask && !G.aiGen && !G.over && !G.tut) {
          if (pl.isAI) { aiThink(); shots++; }
          else { const was = pl.isAI; pl.isAI = true; try { aiThink(); } finally { pl.isAI = was; } const a = G.aiTask; G.aiTask = null; G.angle = a.to; G.spin = {x: a.sx || 0, y: a.sy || 0}; requestShot(a.power); shots++; }
        }
        update(); G.turnStart = performance.now();
      }
      return {n, shots, over: G.over, cur: G.cur, winner: G.winnerSide};
    };
  });

  // ------------------------------------------------------------------ 1) the daily five
  const days = [], D = +(process.env.DAYS || 30), d0 = new Date("2026-11-22T00:00:00Z"); for (let i = 0; i < D; i++) days.push(new Date(d0.getTime() + i * 864e5).toISOString().slice(0, 10));
  let layouts = 0, unsolved = [], narrow = [], kinds = {}, same = true;
  for (let c = 0; c < days.length; c += 10) {
    const r = await p.evaluate(chunk => chunk.map(day => { const a = trickDaily(day), b = trickDaily(day); return a.map((L, i) => { const ang = aimOf(L), deg = Math.PI / 180, e = 0.25 * deg;
      let hit = false; for (let k = 0; k <= 6 && !hit; k++) for (const sg of (k ? [1, -1] : [1])) { const A = ang + sg * k * 0.1 * deg; if (okShot(L, A, 0.6, 0, 0) && okShot(L, A - e, 0.6, 0, 0) && okShot(L, A + e, 0.6, 0, 0)) { hit = true; break; } }
      return {day, i, kind: L.kind, hit, n: L.balls.length, same: JSON.stringify(L.cue) === JSON.stringify(b[i].cue) && JSON.stringify(L.balls) === JSON.stringify(b[i].balls), inside: [L.cue, ...L.balls].every(q => q.x > R && q.x < FW - R && q.y > R && q.y < FH - R), sep: [L.cue, ...L.balls].every((q, x, all) => all.every((w, y) => x === y || Math.hypot(q.x - w.x, q.y - w.y) > 2 * R)), tgt: L.balls.filter(q => q.n === 8).length === 1}; }); }).flat(), days.slice(c, c + 10));
    for (const x of r) { layouts++; kinds[x.kind] = (kinds[x.kind] | 0) + 1; if (!x.hit) unsolved.push(x); if (!x.same) same = false; if (!x.inside || !x.sep || !x.tgt) narrow.push(x); }
  }
  ok(layouts === D * 5, "five layouts for each of " + D + " days", layouts);
  ok(unsolved.length === 0, "every layout is solvable with a band of aims (the 8 pots, the cue ball stays on the table)", unsolved.slice(0, 5));
  ok(same, "the same day gives the same five layouts");
  ok(narrow.length === 0, "balls inside the cloth, not touching, exactly one 8", narrow.slice(0, 3));
  ok(["straight", "cut", "bank", "combo"].every(k => kinds[k] > 0) && kinds.straight === D && kinds.cut === D && kinds.bank === D && kinds.combo === 2 * D, "the day's kinds: straight, cut, bank, combo x2", kinds);
  const other = await p.evaluate(() => JSON.stringify(trickDaily("2030-01-01")) !== JSON.stringify(trickDaily("2030-01-02")));
  ok(other, "another day gives other layouts");

  // ------------------------------------------------------------------ 2) the lessons
  const ls = await p.evaluate(() => LESSONS.map(ls => { const L = ls.gen ? trDrain(ls.gen()) : ls.build(), a0 = aimOf(L), deg = Math.PI / 180, o = {id: ls.id, plain: false, spinWorks: false, nearAim: false};
    for (const pw of [0.25, 0.4, 0.6, 0.8]) { if (okShot(L, a0, pw, 0, 0)) o.plain = true; for (const sy of [-0.5, 0.5, -0.9, 0.9]) if (okShot(L, a0, pw, 0, sy)) o.spinWorks = true; }
    for (let k = 1; k <= 6 && !o.plain; k++) for (const sg of [1, -1]) for (const pw of [0.4, 0.6, 0.8]) if (okShot(L, a0 + sg * k * 0.1 * deg, pw, 0, 0)) o.nearAim = true;
    return o; }));
  const by = Object.fromEntries(ls.map(x => [x.id, x]));
  ok(ls.length === 6, "six lessons", ls.length);
  ok(by.aim.plain && by.power.plain && by.cut.plain, "aim / power / cut lessons: a plain shot solves them", by);
  ok(by.bank.plain || by.bank.nearAim, "bank lesson is solvable", by.bank);
  ok(!by.follow.plain && by.follow.spinWorks, "follow lesson: a plain shot does NOT pass the line, top spin does", by.follow);
  ok(!by.draw.plain && by.draw.spinWorks, "draw lesson: a plain shot does NOT bring the cue ball back, back spin does", by.draw);

  // ------------------------------------------------------------------ 3) a trick shot through the UI
  const c0 = await p.evaluate(() => { profile.coins = 100000; profile.cash = 0; profile.pro = undefined; save(); return profile.coins; });
  await p.evaluate(() => { toMenu("proScr"); trickStart({mode: "daily", i: 0}); });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.type === "trick" && !game.moving)) break; }
  const st = await p.evaluate(() => { const G = game; return {type: G.type, balls: G.balls.length, ctl: canControl(), noChat: document.getElementById("gChat").style.display, legal: legalTargets(0).length === G.balls.length - 1, name: G.trick.name}; });
  ok(st.type === "trick" && st.ctl && st.noChat === "none" && st.legal, "a trick shot opens on the table, the player can aim, no chat", st);
  // a miss first: aim 20 degrees off
  await p.evaluate(() => { const G = game; G.angle = aimOf(G.trick.layout) + 0.35; requestShot(0.5); });
  for (let i = 0; i < 80; i++) { await sleep(150); if (await p.evaluate(() => game.over && game.reset)) break; }
  const miss = await p.evaluate(() => ({tries: game.trick.tries, over: game.over, reset: game.reset, modal: document.getElementById("modal").classList.contains("on")}));
  ok(miss.tries === 1 && miss.over && miss.reset && !miss.modal, "a miss counts one attempt and shows no result window", miss);
  for (let i = 0; i < 40; i++) { await sleep(150); if (await p.evaluate(() => !game.over && !game.moving)) break; }
  const back = await p.evaluate(() => { const G = game, L = G.trick.layout; return {over: G.over, moving: G.moving, bi: G.balls.length, cueAtStart: Math.abs(G.balls[0].x - L.cue.x) < 1e-6 && Math.abs(G.balls[0].y - L.cue.y) < 1e-6, ctl: canControl()}; });
  ok(!back.over && back.cueAtStart && back.ctl, "after a miss the table is back as it was and the player can shoot again", back);
  await p.evaluate(() => { const G = game; G.angle = aimOf(G.trick.layout); requestShot(0.6); });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
  const win = await p.evaluate(() => ({title: document.getElementById("mTitle").textContent, extra: document.getElementById("mExtra").textContent, stars: (document.getElementById("mExtra").innerHTML.match(/★/g) || []).length, btns: [...document.querySelectorAll("#mBtns button")].map(b => b.textContent), coins: profile.coins, pro: JSON.parse(JSON.stringify(profile.pro.trick))}));
  ok(/Great shot/.test(win.title) && win.pro.st[0] === 2 && win.pro.paid[0] === 1, "second attempt wins with 2 stars", win);
  ok(win.coins - c0 === 150 * 2, "coins = the puzzle's base (150) x stars (2), once", {gain: win.coins - c0});
  ok(win.btns.some(x => /Next/.test(x)) && win.btns.some(x => /Watch/.test(x)) && win.btns.some(x => /Menu/.test(x)), "result window: Next / Watch again / Again / Menu", win.btns);
  // the replay
  await p.evaluate(() => { [...document.querySelectorAll("#mBtns button")].find(b => /Watch/.test(b.textContent)).click(); });
  await sleep(1500);
  const rep = await p.evaluate(() => { const c = document.getElementById("proRepC"), g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 61) if (d[i] + d[i + 1] + d[i + 2] > 90) lit++; return {on: document.getElementById("proRep").classList.contains("on"), frames: PRO.rep.F.f.length, lit, cap: document.getElementById("proRepCap").textContent}; });
  ok(rep.on && rep.frames > 30 && rep.lit > 1500, "the replay window plays the recorded shot (the table is painted)", rep);
  await p.evaluate(() => document.querySelector("#proRep [data-a=share]").click());
  for (let i = 0; i < 80; i++) { await sleep(300); if (await p.evaluate(() => !!PRO.clip)) break; }
  const clip = await p.evaluate(async () => { const v = document.querySelector("#proRepSave video"), c = PRO.clip; if (!c) return null; let head = ""; if (v) { const bl = await (await fetch(v.src)).blob(); head = [...new Uint8Array(await bl.slice(0, 4).arrayBuffer())].map(x => x.toString(16)).join(" "); } return {size: c.size, type: c.type, head}; });
  ok(clip && clip.size > 20000 && /webm|mp4/.test(clip.type) && (clip.head === "1a 45 df a3" || clip.head === ""), "the 10 s clip is a real video file", clip);
  await p.evaluate(() => document.querySelector("#proRep [data-a=close]").click()); await sleep(300);
  ok(await p.evaluate(() => !document.getElementById("proRep").classList.contains("on") && document.getElementById("modal").classList.contains("on")), "closing the replay brings the result window back");
  // the same puzzle again: no second payment
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); trickStart({mode: "daily", i: 0}); });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.type === "trick" && !game.moving && canControl())) break; }
  const c1 = await p.evaluate(() => profile.coins);
  await p.evaluate(() => { const G = game; G.angle = aimOf(G.trick.layout); requestShot(0.6); });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
  const again = await p.evaluate(() => ({coins: profile.coins, st: profile.pro.trick.st[0]}));
  ok(again.coins === c1 && again.st === 3, "playing a solved puzzle again pays nothing (the stars only go up: 2 -> 3)", {again, c1});
  // a lesson pays once, and a lesson's rule is checked
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); trickStart({mode: "lesson", id: "follow"}); });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.type === "trick" && !game.moving && canControl())) break; }
  await p.evaluate(() => { const G = game, L = G.trick.layout; G.angle = aimOf(L); G.spin = {x: 0, y: 0}; requestShot(0.4); });   // a plain shot: the 8 goes in but the cue ball stops: the lesson says no
  for (let i = 0; i < 80; i++) { await sleep(150); if (await p.evaluate(() => game.over && game.reset)) break; }
  ok(await p.evaluate(() => game.trick.tries === 1 && !document.getElementById("modal").classList.contains("on") && !(profile.pro.lessons || {}).follow), "follow lesson: a plain pot is not enough");
  for (let i = 0; i < 40; i++) { await sleep(150); if (await p.evaluate(() => !game.over && !game.moving)) break; }
  const c2 = await p.evaluate(() => profile.coins);
  await p.evaluate(() => { const G = game, L = G.trick.layout; G.angle = aimOf(L); G.spin = {x: 0, y: -0.5}; requestShot(0.4); });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
  ok(await p.evaluate(c2 => (profile.pro.lessons || {}).follow === 1 && profile.coins - c2 === 300, c2), "follow lesson: top spin passes the line, +300 once");

  // ------------------------------------------------------------------ 4) bot levels
  const lv = {};
  for (const id of ["easy", "mid", "hard"]) {
    await p.evaluate(id => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); proStartBot(id, "eight"); }, id);
    for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.pro === "drill")) break; }
    lv[id] = await p.evaluate(() => { const G = game; return {pro: G.pro, type: G.type, skill: G.skill, tier: aiTier(), bot: G.players[1].isAI, pot: G.pot, noBot: G.bot, cityPill: false}; });
  }
  ok(lv.easy.skill > lv.mid.skill && lv.mid.skill > lv.hard.skill && lv.easy.tier === 0 && lv.mid.tier === 1 && lv.hard.tier === 2, "easy < medium < hard bots: aim noise falls and the bot's shot types grow (plain / draw+follow / english+planning)", lv);
  ok(lv.hard.pro === "drill" && lv.hard.type === "pvp" && lv.hard.bot && !lv.hard.pot, "a level match is a drill: the opponent is a bot, there is no pot", lv.hard);
  // play one to its end: pays nothing but the one-time first win
  const c3 = await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); proStartBot("easy", "eight"); return {coins: profile.coins, games: profile.games, wins: profile.wins, won: profile.won, xp: profile.xp}; });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.pro === "drill")) break; }
  const run = await p.evaluate(() => autoplay(90000));
  ok(run.over, "a match against the easy bot ends", run);
  for (let i = 0; i < 40; i++) { await sleep(300); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
  await sleep(600);
  const res = await p.evaluate(() => ({title: document.getElementById("mTitle").textContent, btns: [...document.querySelectorAll("#mBtns button")].map(b => b.textContent), coins: profile.coins, games: profile.games, wins: profile.wins, won: profile.won, xp: profile.xp, rec: JSON.parse(JSON.stringify(profile.pro.rec)), res: document.getElementById("res").classList.contains("on")}));
  ok(/VICTORY|DEFEAT/.test(res.title) && res.btns.includes("Menu") && res.btns.some(x => /Play again/.test(x)) && !res.res, "our own result window (not the old result screen)", res);
  ok(res.games === c3.games && res.wins === c3.wins && res.won === c3.won && res.xp === c3.xp, "no match count, wins, winnings or XP are added by a level match", {c3, res});
  ok(res.coins - c3.coins === (res.rec.e_easy && res.rec.e_easy.w ? 500 : 0), "the only coins: the one-time first win of a level (+500 for easy)", {gain: res.coins - c3.coins, rec: res.rec});

  // the old match is untouched: a table match against a bot pays exactly as before and is not a pro match
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu(); profile.level = 1; profile.xp = 0; profile.wstreak = 0; startMatch("ai", CITIES[0], {name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start"}, null); });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.type === "ai" && canControl())) break; }
  const old = await p.evaluate(() => { const G = game; const o = {pro: G.pro, rule: G.rule, team: !!G.team, bot: G.bot, skill: G.skill, city: G.skill === CITIES[0].skill, wrapped: typeof doShoot === "function" && typeof resolveShot === "function"}; const w0 = profile.wins; endGame(0, "test"); o.wins = profile.wins - w0; o.winner = G.winnerSide; return o; });
  await p.waitForSelector("#res.on #resBtns button", { timeout: 20000 }); await sleep(1500);
  ok(old.pro === undefined && old.rule === undefined && !old.team && old.bot === true && old.city && old.wins === 1, "a normal table match is not a pro match: city skill, +1 win, the old result screen", old);
  await p.evaluate(() => toMenu());

  // ------------------------------------------------------------------ 5) 9-ball
  const rules = await p.evaluate(() => { const G = (() => { PRO_NEXT = {kind: "nine2", rule: "nine", hot: true, first: 0, until: Date.now() + 60000}; startMatch("pvp", CITIES[0]); return game; })(), res = {};
    const nums = G.balls.map(b => b.n).sort((a, b) => a - b), one = G.balls.find(b => b.n === 1), nine = G.balls.find(b => b.n === 9), apex = G.balls.filter(b => b.n > 0).reduce((a, b) => b.x < a.x ? b : a);
    res.rack = {nums, apex: apex.n, nineMiddle: Math.abs(nine.y - one.y) < 2 && nine.x > one.x, low: nineLow(G), legal: legalTargets(0).map(b => b.n), rule: G.rule, pro: G.pro, hot: G.proOpt.hot};
    const run = (name, tbl, shot, who) => { G.balls = tbl.map(([n, x, y]) => mkBall(n, x, y)); G.sinking = []; G.tray = []; G.over = false; G.winnerSide = undefined; G.isBreak = false; G.cur = who | 0; G.ballInHand = false; G.moving = false; G.shot = Object.assign({firstHit: null, potted: [], rails: 0, rA: 0, off: [], low: nineLow(G)}, shot); resolveNine(G); res[name] = {cur: G.cur, bih: G.ballInHand, over: G.over, winner: G.winnerSide}; };
    const T = [[0, 200, 250], [2, 500, 200], [3, 600, 300], [9, 800, 250]];
    run("miss, a rail after contact", T, {firstHit: 2, rA: 2}); run("wrong first ball", T, {firstHit: 3, rA: 1}); run("no ball hit", T, {firstHit: null}); run("no rail, no pot", T, {firstHit: 2, rA: 0});
    run("legal pot", T, {firstHit: 2, potted: [2]}); run("pot and scratch", T, {firstHit: 2, potted: [2, 0], rA: 1}); run("legal 9", T, {firstHit: 2, potted: [9], rA: 1}); run("9 on a foul", T, {firstHit: 3, potted: [9], rA: 1});
    run("9 and scratch", T, {firstHit: 2, potted: [9, 0], rA: 1}); run("9 last ball", [[0, 200, 250], [9, 800, 250]], {firstHit: 9, potted: [9], rA: 1}); run("opponent's 9", T, {firstHit: 2, potted: [9], rA: 1}, 1); run("ball off the table", T, {firstHit: 2, off: [3], rA: 1});
    return res; });
  ok(JSON.stringify(rules.rack.nums) === "[0,1,2,3,4,5,6,7,8,9]" && rules.rack.apex === 1 && rules.rack.nineMiddle && rules.rack.low === 1 && JSON.stringify(rules.rack.legal) === "[1]" && rules.rack.rule === "nine", "9-ball rack: balls 1-9, the 1 on the apex, the 9 in the middle, only the 1 is a legal target", rules.rack);
  ok(rules["miss, a rail after contact"].cur === 1 && !rules["miss, a rail after contact"].bih, "legal miss: no foul, the turn passes");
  ok(rules["wrong first ball"].cur === 1 && rules["wrong first ball"].bih && rules["no ball hit"].bih && rules["no rail, no pot"].bih && rules["ball off the table"].bih, "wrong first ball / no contact / no rail / ball off the table: foul, ball in hand for the opponent");
  ok(rules["legal pot"].cur === 0 && !rules["legal pot"].bih, "a legal pot: the same player goes on");
  ok(rules["pot and scratch"].bih && rules["pot and scratch"].cur === 1, "a pot with a scratch is a foul");
  ok(rules["legal 9"].over && rules["legal 9"].winner === 0 && rules["9 last ball"].over && rules["opponent's 9"].winner === 1, "the 9 on a legal shot wins (also as a combination, as the last ball, for the other player)");
  ok(!rules["9 on a foul"].over && rules["9 on a foul"].bih && !rules["9 and scratch"].over, "the 9 on a foul does not win: it goes back, the opponent has the ball in hand");
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); proStartBot("hard", "nine"); });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.rule === "nine" && game.pro === "drill")) break; }
  const nm = await p.evaluate(() => autoplay(120000));
  ok(nm.over, "a whole 9-ball match against the hard bot ends", nm);

  // ------------------------------------------------------------------ 6) 2v2
  for (const mode of ["bot", "friend", "four"]) {
    await p.evaluate(mode => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); proStartTeam(mode); }, mode);
    for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && !!game.team)) break; }
    const t = await p.evaluate(() => { const G = game; const names = G.team.map(s => s.map(m => m.name)); const seq = []; G.cur = 0; G.lastSide = undefined; nextTurn(true); seq.push(G.players[G.cur].name);
      for (let k = 0; k < 6; k++) { G.cur = 1 - G.cur; nextTurn(); seq.push(G.players[G.cur].name); } G.cur = G.cur; nextTurn(); const keep = G.players[G.cur].name === seq[seq.length - 1];
      return {names, seq, keep, human: G.team[0].map(m => !m.isAI), skill: G.skill}; });
    const A = t.names[0], B = t.names[1];
    ok(JSON.stringify(t.seq) === JSON.stringify([A[0], B[0], A[1], B[1], A[0], B[0], A[1]]) && t.keep, "2v2 " + mode + ": the shooters go A1, B1, A2, B2, A1 ... and a side keeps its player while it keeps the table", t);
    ok(mode === "bot" ? t.human[0] && !t.human[1] : mode === "friend" ? t.human[0] && t.human[1] : t.human.every(x => x), "2v2 " + mode + ": who is a person and who is a bot", t.human);
    const r = await p.evaluate(() => autoplay(150000));
    ok(r.over, "2v2 " + mode + ": the match ends", r);
    for (let i = 0; i < 40; i++) { await sleep(300); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
    ok(await p.evaluate(() => /jamoa|Team|WINS|YUTDI/i.test(document.getElementById("mTitle").textContent)), "2v2 " + mode + ": the result window names the winning team");
  }

  // ------------------------------------------------------------------ 7) shot analysis (a match with human shots: a bot that runs the table from its break leaves nothing to analyse, so try again)
  let an = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); proStartBot("easy", "eight"); });
    for (let i = 0; i < 60; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.pro === "drill")) break; }
    await p.evaluate(() => autoplay(90000));
    an = await p.evaluate(() => { const st = game.st, mine = st.shots.filter(x => x.mine); return {shots: st.shots.length, mine: mine.length, pots: mine.reduce((s, x) => s + x.n, 0), best: !!st.best, worst: !!st.worst, bestFrames: st.best && st.best.frames.f.length, run: st.run[mine[0] && mine[0].name], allHaveScore: st.shots.every(x => typeof x.score === "number" && typeof x.bad === "number"), badNoFoulScore: st.shots.filter(x => x.foul).every(x => x.score === 0)}; });
    if (an.mine > 3 && an.best) break;
  }
  ok(an.mine > 3 && an.shots > an.mine && an.best && an.bestFrames > 3 && an.allHaveScore && an.badNoFoulScore, "the analysis counts every shot, keeps the best shot's frames, a foul scores nothing", an);
  for (let i = 0; i < 40; i++) { await sleep(300); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
  await p.evaluate(() => { [...document.querySelectorAll("#mBtns button")].find(b => /Tahlil|Analysis/.test(b.textContent)).click(); }); await sleep(600);
  const html = await p.evaluate(() => ({tiles: document.querySelectorAll("#mExtra .pstats .pst").length, rep: document.querySelectorAll("#mExtra [data-rep]").length, rows: document.querySelectorAll("#mExtra .lbr").length, text: document.getElementById("mExtra").innerText.replace(/\s+/g, " ")}));
  ok(html.tiles === 5 && html.rep >= 1 && html.rows >= 1 && /Shots|Zarbalar/.test(html.text), "the analysis window: five stat tiles, the best shot (and the mistake) as rows with a replay key", html);

  // ------------------------------------------------------------------ 8) translations: every text has all 15 languages
  const tr = await p.evaluate(() => {
    const src = [...document.scripts].map(s => s.textContent).join("\n"), blk = src.slice(src.indexOf("/*PRO_BEGIN*/"), src.indexOf("/*PRO_END*/")), keys = new Set(), re = /"((?:[^"\\\n]|\\.)*)"/g; let m;
    while ((m = re.exec(blk))) { const k = m[1].replace(/\\"/g, '"'); if (/^[A-Z0-9][A-Za-z0-9'’ ,.:!?+\-—…()\/{}]*$/.test(k) && /[a-z]{3}/.test(k) && /[ '’]/.test(k) && !/^(ROYAL|Royal|btn |pro-|font|margin|overflow|button|video|rgba)/.test(k) && !k.includes("·")) keys.add(k); }
    for (const x of ["Oson", "O'rta", "Qiyin", "Do'st", "Trick shot", "9-ball", "1-jamoa", "2-jamoa", "Dars", "Qayta", "Tahlil", "Qiyinroq", "Seriya", "Aniqlik", "Xatolar", "Zarbalar", "Urinishlar", "Saqlash", "Kombinatsiya"]) keys.add(x);
    const cand = [...keys], out = [];
    for (const l of Object.keys(LANGS)) { if (l === "uz") continue; LANG = l; for (const k of cand) if (T(k) === k && !/^(9-ball|Trick shot)$/.test(k)) out.push(l + ": " + k); }
    LANG = "en"; return {n: cand.length, miss: out.slice(0, 12), count: out.length};
  });
  ok(tr.n > 40 && tr.count === 0, "every text of the new modes is translated in all 15 languages", tr);

  // ------------------------------------------------------------------ 10) the screen of the new modes is built like the Minigames screen (the owner: "make the new things as beautiful as the rest")
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("mini"); }); await sleep(800);
  const mini = await p.evaluate(() => { const k = document.querySelector("#mini .head .pro-go"), r = k && k.getBoundingClientRect(), g = document.querySelector("#miniBody .mggrid").getBoundingClientRect(); return {key: !!k, img: !!(k && k.querySelector("img") && k.querySelector("img").naturalWidth > 0), inside: !!r && r.width > 40 && r.left > 0 && r.right <= innerWidth, gridH: Math.round(g.height)}; });
  ok(mini.key && mini.img && mini.inside, "the Minigames screen has the gold 'New modes' key with the 8 ball, inside the screen", mini);
  await p.evaluate(() => toMenu("proScr")); await sleep(1500);
  const scr = await p.evaluate(() => { const cards = [...document.querySelectorAll("#proBody .mggrid > .mgc")], mg = document.querySelector("#proBody .mggrid").getBoundingClientRect(), h0 = cards[0].getBoundingClientRect().height;
    return {n: cards.length, themes: cards.map(c => ["mg-teal", "mg-parch", "mg-red", "mg-gold", "mg-felt"].find(t => c.classList.contains(t))).join(), art: cards.map(c => { const i = c.querySelector(".mgart img"); return !!i && i.naturalWidth >= 200 && i.naturalHeight >= 80; }), btn: cards.map(c => !!c.querySelector(".mgbtn")), wood: cards.map(c => /url\(/.test(getComputedStyle(c).borderImageSource)), dots: cards.filter(c => c.querySelector(".dot")).length, bottom: Math.round(mg.bottom), vh: innerHeight, gridH: Math.round(mg.height), tall: cards[4].getBoundingClientRect().height > 1.6 * h0};
  });
  ok(scr.n === 5 && scr.themes === "mg-teal,mg-parch,mg-red,mg-gold,mg-felt", "five cards in the Minigames colours (teal, parchment, red, gold, felt)", scr);
  ok(scr.art.every(Boolean) && scr.btn.every(Boolean) && scr.wood.every(Boolean), "every card has a picture, a green key and the wooden frame", scr);
  ok(scr.tall && scr.bottom <= scr.vh && Math.abs(scr.gridH - mini.gridH) <= 8, "the felt card is the tall one; the grid is as tall as the Minigames grid and fits the phone's screen", {scr, mini});
  ok(scr.dots === 5, "an unopened mode carries the red dot", scr.dots);
  const painted = await p.evaluate(() => { const out = []; for (const c of document.querySelectorAll("#proBody .mgc")) { const im = c.querySelector(".mgart img"), cv = document.createElement("canvas"); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const g = cv.getContext("2d"); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data; let a = 0, col = 0, n = 0; for (let i = 0; i < d.length; i += 16) { n++; if (d[i + 3] > 40) { a++; if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) col++; } } out.push({opaque: +(a / n).toFixed(2), colour: +(col / Math.max(1, a)).toFixed(2)}); } return out; });
  ok(painted.every(x => x.opaque > 0.06 && x.colour > 0.05), "every card picture is painted (solid shapes, in colour), not blank", painted);
  const lists = await p.evaluate(async () => { const res = {}; for (const [k, f, n] of [["trick", () => proPickTrick(), 5], ["lessons", () => proPickLesson(), 6], ["level", () => proPickLevel("eight"), 3], ["nine", () => proPickNine(), 2], ["team", () => proPickTeam(), 3]]) { document.getElementById("modal").classList.remove("on"); f(); await new Promise(r => setTimeout(r, 150)); res[k] = [document.querySelectorAll("#mExtra .lbr.pro-row").length, n, document.querySelectorAll("#mExtra .lbr.pro-row .pro-gl").length]; } document.getElementById("modal").classList.remove("on"); return res; });
  ok(Object.values(lists).every(([got, want, gl]) => got === want && gl === want), "the lists (trick shots 5, lessons 6, levels 3, 9-ball 2, 2v2 3) are leaderboard rows with a picture each", lists);

  // ------------------------------------------------------------------ 11) SCALE: nothing is cut off, whatever the phone (the Minigames screen itself is cut off on 340-385 and 415-505 px tall pages: this screen is not)
  {
    const G0 = () => ({st: {shots: [{mine: true, name: "Azizjon", n: 2, foul: false}, {mine: true, name: "Azizjon", n: 0, foul: true}], run: {Azizjon: {best: 2}},
      best: {rec: {n: 2, combo: true, bank: true, brk: true, won: true}, frames: {f: new Array(10).fill(new Float32Array(4))}}, worst: {rec: {cueP: true}, frames: {f: new Array(10).fill(new Float32Array(4))}}}});
    const VPS = [[568, 320], [640, 360], [700, 340], [740, 360], [780, 360], [804, 392], [844, 390], [915, 412], [932, 430], [960, 440], [1004, 489], [1024, 600], [1024, 768], [390, 844], [360, 740], [430, 932], [412, 915]];
    const bad = [];
    for (const [w, h] of VPS) {
      await p.setViewportSize({width: w, height: h}); await sleep(450);
      await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); }); await sleep(500);
      const m = await p.evaluate(() => { const s = document.getElementById("proScr"), cards = [...document.querySelectorAll("#proBody .mgc")]; let clip = 0, tiny = 0;
        for (const c of cards) { const bt = c.querySelector(".mgbtn"), art = c.querySelector(".mgart"), im = art.querySelector("img"), tt = c.querySelector(".mgtx b");   // (offsets: they do not change when the page is turned 90 degrees)
          if (bt.offsetTop + bt.offsetHeight > c.clientHeight + 1 || tt.offsetTop < -1) clip++; if (im.offsetHeight < 18 || im.offsetWidth < 18 || art.offsetTop + art.offsetHeight > tt.offsetTop + 2) tiny++; }
        return {over: s.scrollHeight - s.clientHeight, cards: cards.length, clip, tiny, rot: document.documentElement.classList.contains("rot")}; });
      if (m.over > 1 || m.cards !== 5 || m.clip || m.tiny) bad.push(["screen", w + "x" + h, m]);
      for (const [name, fn] of [["trick", () => proPickTrick()], ["lessons", () => proPickLesson()], ["level", () => proPickLevel("eight")], ["nine", () => proPickNine()], ["team", () => proPickTeam()], ["analysis", g => proShowAnalysis(g)]]) {
        await p.evaluate(([f, g]) => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); eval("(" + f + ")")(g); }, [fn.toString(), G0()]); await sleep(250);
        const q = await p.evaluate(() => { const ex = document.getElementById("mExtra"), bt = document.getElementById("mBtns").getBoundingClientRect(), pn = document.querySelector("#modal .panel").getBoundingClientRect(); return {ex: ex.scrollHeight - ex.clientHeight, btn: bt.left >= -1 && bt.top >= -1 && bt.right <= innerWidth + 1 && bt.bottom <= innerHeight + 1 && pn.top >= -1 && pn.left >= -1}; });   // (a turned page: its bottom is the screen's left edge, so the key must lie inside the screen on both axes)
        if (q.ex > 1 || !q.btn) bad.push([name, w + "x" + h, q]);
      }
    }
    ok(bad.length === 0, "on 17 phone / tablet sizes (landscape and turned upright) the new screen shows both rows with their pictures, and the five lists and the analysis fit their window", bad.slice(0, 6));
    // the two result windows with the most in them: a trick shot solved (stars, coins, "all five done", the tries, four keys) and a bot match won (the coins, the record, four keys)
    await p.setViewportSize({width: 915, height: 412}); await sleep(400);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); const st = proStore(); st.trick = {day: dshotDayKey(), st: [3, 3, 3, 0, 3], paid: [1, 1, 1, 0, 1], bonus: 0}; trickStart({mode: "daily", i: 3}); });
    for (let i = 0; i < 80; i++) { await sleep(200); if (await p.evaluate(() => !!game && game.type === "trick" && !game.moving && canControl())) break; }
    await p.evaluate(() => { game.trick.tries = 1; game.rec = {f: new Array(10).fill(new Float32Array(4))}; trickWin(game); });   // (a recording: the window then has the 'watch' key too)
    for (let i = 0; i < 30; i++) { await sleep(200); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
    const bad2 = [], measure = async (what, w, h) => { const q = await p.evaluate(() => { const ex = document.getElementById("mExtra"), bt = document.getElementById("mBtns").getBoundingClientRect(), pn = document.querySelector("#modal .panel").getBoundingClientRect();
      return {ex: ex.scrollHeight - ex.clientHeight, on: document.getElementById("modal").classList.contains("on"), nb: document.querySelectorAll("#mBtns button").length, btn: bt.left >= -1 && bt.top >= -1 && bt.right <= innerWidth + 1 && bt.bottom <= innerHeight + 1 && pn.top >= -1 && pn.left >= -1}; });
      if (!q.on || q.ex > 1 || !q.btn) bad2.push([what, w + "x" + h, q]); return q; };
    const win0 = await measure("trick win", 915, 412);
    for (const [w, h] of VPS) { await p.setViewportSize({width: w, height: h}); await sleep(350); await measure("trick win", w, h); }
    ok(win0.nb === 4, "the trick-shot window has its four keys (next, watch, again, menu)", win0);
    await p.setViewportSize({width: 915, height: 412}); await sleep(300);
    for (const [w, h] of VPS) {
      await p.setViewportSize({width: w, height: h}); await sleep(350);
      await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); proResult({proOpt: {kind: "drill", lv: "easy", rule: "eight"}, st: {shots: [{mine: true, name: "A", n: 1}]}, rule: "eight", team: null}, 0, "8-sharni tushirdi!", true, 500, "Azizjon", false); }); await sleep(300);
      await measure("bot result", w, h);
    }
    ok(bad2.length === 0, "on 17 sizes the trick-shot window and the bot-match result window fit the screen (no scroll bar inside, the keys on the screen)", bad2.slice(0, 6));
    await p.setViewportSize({width: 915, height: 412}); await sleep(400);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("proScr"); });
  }

  // ------------------------------------------------------------------ 9) a portal (Y8 ...: the page in a frame): no share key, no link on the picture, the replay itself stays
  {
    const psrv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]);
      if (u === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<!doctype html><body style="margin:0"><iframe id="g" src="/index.html" style="border:0;width:100vw;height:100vh"></iframe></body>`); }
      const f = path.join(ROOT, u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
    await new Promise(r => psrv.listen(0, r)); const pp = psrv.address().port, pctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US" }), q = await pctx.newPage(), perrs = []; q.on("pageerror", e => perrs.push(e.message.slice(0, 200)));
    await q.addInitScript(() => { try { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 12 })); } catch (e) {} });
    await q.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await q.goto(`http://localhost:${pp}/`, { waitUntil: "commit" });
    let fr; for (let i = 0; i < 120; i++) { await sleep(500); fr = q.frames().find(f => f.url().includes("/index.html")); if (fr && await fr.evaluate(() => typeof profile !== "undefined" && !document.getElementById("boot")).catch(() => false)) break; }
    await fr.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); window.toast = () => {}; window.unlock = () => {}; window.checkAch = () => {}; }); await sleep(2500);
    const noSoc = await fr.evaluate(() => NO_SOCIAL);
    await fr.evaluate(() => trickStart({mode: "daily", i: 0}));
    for (let i = 0; i < 60; i++) { await sleep(200); if (await fr.evaluate(() => !!game && game.type === "trick" && !game.moving && canControl()).catch(() => false)) break; }
    await fr.evaluate(() => { const G = game, L = G.trick.layout; G.angle = Math.atan2(L.segs[0][1].y - L.segs[0][0].y, L.segs[0][1].x - L.segs[0][0].x); requestShot(0.6); });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await fr.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
    await fr.evaluate(() => { [...document.querySelectorAll("#mBtns button")].find(b => /Watch/.test(b.textContent)).click(); }); await sleep(1200);
    const port2 = await fr.evaluate(() => ({share: getComputedStyle(document.querySelector("#proRep [data-a=share]")).display, rep: document.getElementById("proRep").classList.contains("on")}));
    ok(noSoc && port2.share === "none" && port2.rep, "on a portal (a framed page) the replay plays but has no share key", {noSoc, port2});
    const anShare = await fr.evaluate(() => { document.querySelector("#proRep [data-a=close]").click(); document.getElementById("modal").classList.remove("on"); const F = PRO.rep ? PRO.rep.F : null; proShowAnalysis({st: {shots: [{mine: true, name: "A", n: 2, foul: false}], run: {A: {best: 2}}, best: {rec: {mine: true, name: "A", n: 2, combo: 1, bank: 0, brk: false, won: false}, frames: {f: [1, 2, 3, 4]}, why: ""}, worst: null}}); return {share: document.querySelectorAll("#mExtra [data-share]").length, rep: document.querySelectorAll("#mExtra [data-rep]").length}; });
    ok(anShare.share === 0 && anShare.rep === 1, "on a portal the analysis has the replay key and no share key", anShare);
    ok(perrs.length === 0, "no page errors in the portal frame", perrs.slice(0, 3));
    await pctx.close(); psrv.close();
  }

  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
