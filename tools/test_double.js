#!/usr/bin/env node
// The "×2 (video)" button (index.html: dblOk / dblHTML / dblWire / dblGo): a rewarded video (about 30 s) that pays a coin prize once more.
//   node tools/test_double.js            (SHOT=dir also saves a picture of every window)
// - it is offered where a coin prize is given (match won, mystery box, daily gift, lucky shot, wheel, scratch card, new level) and a rewarded video works (Y8 / Telegram / the app / the portals); never for cash, never for a lost match
// - the video is the "reward" kind, named double-<where>; viewed = the prize once more + the button is used up; closed half way / no video = nothing, the button works again; one use per prize
// - its own limit: 10 a day (also for ad-free players, who get it without a video); the shared limit of 10 videos a day applies to everybody else
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms)), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  async function open(prof, sdk = true) {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(pr => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify(pr)); }, { name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", trophies: { lis: 5 }, ...prof });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); });
    await fake(p, sdk); await p.evaluate(() => { try { checkAch(); } catch (e) {} }); await sleep(800); return p;   // (the medals that pay coins are granted once here, so they do not move the numbers below)
  }
  // a stand-in for the ad network: every ad is answered after 120 ms with window.__status (viewed / dismissed / notReady ...)
  const fake = (p, on) => p.evaluate(on => { window.__ads = []; window.__status = "viewed"; if (!on) { Y8.sdk = null; Y8.adsReady = false; return; }
    Y8.sdk = { showAd(o) { window.__ads.push(o.type + ":" + o.name); o.beforeAd && o.beforeAd(); return new Promise(r => setTimeout(() => { const st = window.__status; if (st === "viewed") o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone({ breakStatus: st }); r(); }, 120)); } }; Y8.adsReady = true; }, on);
  const st = p => p.evaluate(() => ({ coins: profile.coins, ads: window.__ads.slice(), n: profile.dblN | 0, day: profile.adCount | 0, btns: [...document.querySelectorAll(".dblb")].map(x => ({ t: x.textContent.trim(), dis: x.disabled })), toast: (document.getElementById("toasts") || {}).textContent || "" }));
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  const modalDbl = p => p.waitForSelector("#modal.on #mExtra .dblb", { timeout: 20000 }).then(async () => { await sleep(700); return true; }, () => false);
  const closeModal = p => p.evaluate(() => { document.getElementById("modal").classList.remove("on"); document.getElementById("mExtra").innerHTML = ""; });

  // ---------------------------------------------------------------- 1) the rules (who is offered the button) and the click, on a generic window
  let p = await open({});
  const g = await p.evaluate(() => { const t = today(), r = {}; const set = (o) => { Object.assign(profile, { adDay: "", adCount: 0, dblDay: "", dblN: 0, adfree: false }, o); };
    set({}); r.on = dblOk(1000); r.min = [dblOk(99), dblOk(100)]; r.html = dblHTML(1000, "x").includes("dblb") && dblHTML(40, "x") === "" && dblHTML(1000, "x", true).startsWith("<button");
    set({ adDay: t, adCount: 10 }); r.capVid = dblOk(1000);
    set({ adDay: t, adCount: 10, adfree: true }); r.capVidAdfree = dblOk(1000);
    set({ dblDay: t, dblN: 10 }); r.capDbl = dblOk(1000);
    set({ dblDay: t, dblN: 10, adfree: true }); r.capDblAdfree = dblOk(1000);
    set({ dblDay: "2000-01-01", dblN: 10 }); r.oldDay = dblOk(1000);
    set({}); const sdk = Y8.sdk; Y8.sdk = null; r.noSdk = dblOk(1000); Y8.sdk = sdk; Y8.adsReady = false; r.notReady = dblOk(1000); Y8.adsReady = true; r.back = dblOk(1000); return r; });
  ok(g.on && g.min[0] === false && g.min[1] === true, "offered from 100 coins up (99: no)", g);
  ok(g.html, "dblHTML: a button for a real prize, nothing for a small one, a plain <button> for the row form", g);
  ok(g.capVid === false && g.capVidAdfree === true, "today's 10 videos used up: no button; ad-free players do not need the video limit", g);
  ok(g.capDbl === false && g.capDblAdfree === false, "10 doubles used today: no button, also for ad-free players", g);
  ok(g.oldDay === true, "yesterday's count does not count today", g);
  ok(g.noSdk === false && g.notReady === false && g.back === true, "no ad SDK / the SDK is not ready: no button", g);
  // the click on a generic window: viewed
  await p.evaluate(() => { profile.coins = 1000; profile.adDay = ""; profile.adCount = 0; profile.dblDay = ""; profile.dblN = 0; openModal({ icon: "🎁", title: "Test", text: "", extra: dblHTML(500, "t"), buttons: [{ label: "OK", cls: "green", fn: () => {} }] }); dblWire(document.getElementById("mExtra")); });
  await sleep(700); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(900);
  let s = await st(p);
  ok(s.ads.length === 1 && s.ads[0] === "reward:double-t", "a tap plays ONE rewarded video named double-<where>", s.ads);
  ok(s.coins === 1500 && s.n === 1 && s.day === 1, "viewed: +500 coins once, counted as one double and one video of the day", s);
  ok(s.btns.length === 1 && s.btns[0].dis && /✅/.test(s.btns[0].t), "the button is used up (✅ ×2, disabled)", s.btns);
  await p.evaluate(() => document.querySelector("#mExtra .dblb").click({ force: true })); await sleep(500); s = await st(p);
  ok(s.ads.length === 1 && s.coins === 1500, "a second tap does nothing (no video, no coins)", s);
  await closeModal(p);
  // closed half way: nothing, and the button works again
  await p.evaluate(() => { window.__status = "dismissed"; openModal({ icon: "🎁", title: "Test", text: "", extra: dblHTML(500, "t"), buttons: [{ label: "OK", cls: "green", fn: () => {} }] }); dblWire(document.getElementById("mExtra")); });
  await sleep(700); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(2200); s = await st(p);
  ok(s.ads.length === 2 && s.coins === 1500 && s.n === 1 && s.day === 1, "closed half way: no coins, nothing counted", s);
  ok(s.btns.length === 1 && !s.btns[0].dis && /×2/.test(s.btns[0].t) && !/✅/.test(s.btns[0].t), "...and the button works again", s.btns);
  ok(/oxirigacha|to the end|finish|watch/i.test(s.toast) || /Reklama|ad/i.test(s.toast), "...and the player is told why (toast)", s.toast);
  // no video available: nothing, and the button works again
  await p.evaluate(() => { window.__status = "notReady"; }); await p.evaluate(() => document.querySelector("#mExtra .dblb").click({ force: true })); await sleep(2200); s = await st(p);
  ok(s.ads.length === 3 && s.coins === 1500 && s.btns.length === 1 && !s.btns[0].dis, "no video available: no coins, the button works again", s);
  ok(/available|mavjud/i.test(s.toast), "...and the player is told no ad is available", s.toast);
  // viewed after the retry
  await p.evaluate(() => { window.__status = "viewed"; }); await p.evaluate(() => document.querySelector("#mExtra .dblb").click({ force: true })); await sleep(900); s = await st(p);
  ok(s.coins === 2000 && s.n === 2 && /✅/.test(s.btns[0].t), "the retry that is watched to the end pays once", s);
  await closeModal(p);
  // ad-free: the prize at once, no video
  await p.evaluate(() => { profile.adfree = true; profile.coins = 1000; window.__ads = []; openModal({ icon: "🎁", title: "Test", text: "", extra: dblHTML(500, "t"), buttons: [{ label: "OK", cls: "green", fn: () => {} }] }); dblWire(document.getElementById("mExtra")); });
  await sleep(700); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(500); s = await st(p);
  ok(s.ads.length === 0 && s.coins === 1500, "ad-free player: the doubled prize at once, no video", s);
  await p.evaluate(() => { profile.adfree = false; }); await closeModal(p);
  // a tap while another ad is playing is ignored
  await p.evaluate(() => { profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; window.__ads = []; openModal({ icon: "🎁", title: "Test", text: "", extra: dblHTML(500, "t"), buttons: [{ label: "OK", cls: "green", fn: () => {} }] }); dblWire(document.getElementById("mExtra")); Y8.busy = true; });
  await p.evaluate(() => document.querySelector("#mExtra .dblb").click({ force: true })); await sleep(400); s = await st(p); await p.evaluate(() => { Y8.busy = false; });
  ok(s.ads.length === 0 && s.coins === 1000 && !s.btns[0].dis, "a tap while another ad is playing is ignored (and the button stays usable)", s);
  await closeModal(p);

  // ---------------------------------------------------------------- 2) a mystery box
  await p.evaluate(() => { profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; window.__ads = []; profile.boxes = [{ tier: 1, city: CITIES[3].id, start: 0 }, null, null, null]; openBox(0); });
  await p.waitForSelector("#boxAnim .bxskip", { timeout: 15000 }); await sleep(500); await p.evaluate(() => document.querySelector("#boxAnim .bxskip").click());   // (the box is tapped three times by a player; "skip" bursts it at once)
  ok(await modalDbl(p), "box: the opened box shows the ×2 button", await st(p));
  const bx = await p.evaluate(() => ({ prize: +document.querySelector("#modal .boxres").textContent.replace(/[^\d]/g, ""), coins: profile.coins, btn: document.querySelector("#mExtra .dblb").dataset.dbl }));
  ok(bx.prize > 0 && bx.btn === bx.prize + "|box" && bx.coins === 1000 + bx.prize, "box: the button doubles exactly the coins of the box", bx);
  await shot(p, "box"); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === 1000 + bx.prize * 2 && s.ads[0] === "reward:double-box" && /✅/.test(s.btns[0].t), "box: +the box once more after the video", [s, bx]);
  await closeModal(p);

  // ---------------------------------------------------------------- 3) the daily gift (coins only)
  await p.evaluate(() => { profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; window.__ads = []; claimReward(REWARDS.find(r => r.t === "coins" && r.v >= 300)); });
  ok(await modalDbl(p), "daily gift: a coin gift opens a window with the ×2 button", await st(p));
  const dg = await p.evaluate(() => ({ coins: profile.coins, btn: document.querySelector("#mExtra .dblb").dataset.dbl }));
  await shot(p, "daily"); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === dg.coins + +dg.btn.split("|")[0] && s.ads[0] === "reward:double-daily", "daily gift: +the gift once more", [s, dg]);
  await closeModal(p);
  const nc = await p.evaluate(() => { const c = [REWARDS.find(r => r.t !== "coins")].filter(Boolean)[0]; window.__ads = []; if (!c) return null; claimReward(c); return { on: document.getElementById("modal").classList.contains("on") && !!document.querySelector("#mExtra .dblb") }; });
  ok(nc === null || nc.on === false, "daily gift: a gift that is not coins gets no button", nc);
  await closeModal(p);

  // ---------------------------------------------------------------- 4) the wheel: coins yes, cash no
  await p.evaluate(() => { profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; profile.wheelTries = 5; window.__ads = []; WHEEL_WEIGHTS.fill(0); WHEEL_WEIGHTS[0] = 1; go("wheelScr"); });
  await sleep(900); await p.evaluate(() => document.getElementById("spinBtn").click());
  ok(await modalDbl(p), "wheel: a coin segment shows the ×2 button", await st(p));
  const wh = await p.evaluate(() => ({ coins: profile.coins, btn: document.querySelector("#mExtra .dblb").dataset.dbl }));
  ok(wh.btn === "1500|wheel" && wh.coins === 2500, "wheel: it doubles the won coins (1 500)", wh);
  await shot(p, "wheel"); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === 4000 && s.ads[0] === "reward:double-wheel", "wheel: +1 500 once more", s);
  await closeModal(p);
  await p.evaluate(() => { go("wheelScr"); WHEEL_WEIGHTS.fill(0); WHEEL_WEIGHTS[2] = 1; }); await sleep(600);
  await p.evaluate(() => document.getElementById("spinBtn").click()); await p.waitForSelector("#modal.on", { timeout: 20000 });
  const wc = await p.evaluate(() => ({ dbl: document.querySelectorAll("#mExtra .dblb").length, cash: !!document.querySelector("#modal .reward .cash") }));
  ok(wc.cash && wc.dbl === 0, "wheel: a cash segment gets no button", wc);
  await closeModal(p);

  // ---------------------------------------------------------------- 5) the scratch card
  await p.evaluate(() => { profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; profile.scratchTries = 5; window.__ads = []; go("home");
    const real = Math.random, seq = [0.05, 0.5, 0.05]; Math.random = () => seq.length ? seq.shift() : real();   // the first three draws: the coin card 500 wins, "the first three scratches match"
    scratchGame(); Math.random = real; });
  await p.waitForSelector("#modal.on .scell", { timeout: 20000 });
  for (const i of [0, 1, 2]) await p.evaluate(i => document.querySelectorAll(".scell canvas")[i].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })), i);
  await sleep(500);
  const sc = await p.evaluate(() => ({ info: document.getElementById("scrInfo").textContent, dbl: [...document.querySelectorAll("#scrInfo .dblb")].map(x => x.dataset.dbl), coins: profile.coins }));
  ok(/500/.test(sc.info) && sc.dbl.length === 1 && sc.dbl[0] === "500|scratch" && sc.coins === 1500, "scratch card: three matching coin cells pay 500 and show the ×2 button", sc);
  await p.evaluate(() => document.querySelectorAll(".scell canvas")[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))); await sleep(300);
  ok((await p.evaluate(() => document.querySelectorAll("#scrInfo .dblb").length)) === 1, "scratch card: scratching on does not remove the button", await st(p));
  await shot(p, "scratch"); await p.locator("#scrInfo .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === 2000 && s.ads[0] === "reward:double-scratch" && /✅/.test(s.btns[0].t), "scratch card: +500 once more", s);
  await closeModal(p);

  // ---------------------------------------------------------------- 6) the lucky shot (coin rings yes, the cash centre no)
  const lucky = async (dist) => { await p.evaluate(() => { profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; window.__ads = []; profile.freeT = {}; go("home"); startLucky(); });
    await sleep(1200); return p.evaluate(d => { const G = game, gold = G.balls[1]; gold.x = G.target.x + d; gold.y = G.target.y; G.shot = { firstHit: "gold" }; luckyFinish(); return LUCKY_RINGS.map(r => r.r); }, dist); };
  await lucky(90); await sleep(1300);
  const lk = await p.evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), dbl: [...document.querySelectorAll("#mExtra .dblb")].map(x => x.dataset.dbl), coins: profile.coins }));
  ok(lk.on && lk.dbl.length === 1 && lk.dbl[0] === "1000|lucky" && lk.coins === 2000, "lucky shot: a coin ring (1 000) shows the ×2 button", lk);
  await shot(p, "lucky"); await p.locator("#mExtra .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === 3000 && s.ads[0] === "reward:double-lucky", "lucky shot: +1 000 once more", s);
  await closeModal(p); await p.evaluate(() => { toMenu(); }); await sleep(600);
  await lucky(0); await sleep(1300);
  const lc = await p.evaluate(() => ({ cash: !!document.querySelector("#modal .reward .cash"), dbl: document.querySelectorAll("#mExtra .dblb").length }));
  ok(lc.cash && lc.dbl === 0, "lucky shot: the cash centre gets no button", lc);
  await closeModal(p); await p.evaluate(() => { toMenu(); }); await sleep(600);

  // ---------------------------------------------------------------- 7) a new level
  await p.evaluate(() => { go("home"); profile.coins = 1000; profile.dblDay = ""; profile.dblN = 0; window.__ads = []; levelUpFx(7, 700, 0); });
  await sleep(1200); await shot(p, "level");
  const lv0 = await p.evaluate(() => ({ dbl: [...document.querySelectorAll("#lvlFx .dblb")].map(x => x.dataset.dbl) }));
  ok(lv0.dbl.length === 1 && lv0.dbl[0] === "700|level", "level up: the celebration shows the ×2 button for the level bonus", lv0);
  await p.locator("#lvlFx .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === 1700 && s.ads[0] === "reward:double-level" && (await p.evaluate(() => !!document.getElementById("lvlFx") && !document.getElementById("lvlFx").classList.contains("out"))), "level up: +700 once more, and the tap on the button does not close the celebration", s);
  await p.evaluate(() => document.getElementById("lvlFx").click()); await sleep(600);
  ok(await p.evaluate(() => !document.getElementById("lvlFx")), "level up: a tap anywhere else still closes it", 0);
  await p.close();

  // ---------------------------------------------------------------- 8) the match result: won (button), lost (none), prize 0 (none), no ad SDK (none)
  const match = async (p, win) => { await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { toMenu(); } catch (e) {} });
    await p.evaluate(() => { profile.dblDay = ""; profile.dblN = 0; window.__ads = []; startMatch("ai", CITIES[2], { name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" }, null); });
    for (let i = 0; i < 40; i++) { await sleep(300); if (await p.locator("#tutSkip").count()) await p.locator("#tutSkip").click().catch(() => {}); if (await p.evaluate(() => canControl())) break; }
    await p.evaluate(w => { endGame(w ? 0 : 1, "test"); }, win); await p.waitForSelector("#res.on #resBtns button.green", { timeout: 15000 }); await sleep(1500); };
  p = await open({});
  await match(p, true);
  const rw = await p.evaluate(() => ({ btns: [...document.querySelectorAll("#resBtns button")].map(x => x.className + ":" + x.textContent.trim()), dbl: [...document.querySelectorAll("#resBtns .dblb")].map(x => x.dataset.dbl), coins: profile.coins, prize: CITIES[2].prize }));
  ok(rw.dbl.length === 1 && rw.dbl[0] === rw.prize + "|win", "match won: the result screen shows the ×2 button for the match prize", rw);
  ok(/orange/.test(rw.btns.find(x => /×2/.test(x)) || "") && /^green:/.test(rw.btns[rw.btns.length - 1]), "...before the main (green) button, not replacing it", rw.btns);
  await sleep(2500); const c0 = (await st(p)).coins; await shot(p, "result");
  await p.locator("#resBtns .dblb").click({ force: true }); await sleep(900); s = await st(p);
  ok(s.coins === c0 + rw.prize && s.ads.length === 1 && s.ads[0] === "reward:double-win" && /✅/.test(s.btns[0].t), "match won: +the match prize once more after the video (tap on the real button)", [c0, s, rw.prize]);
  await match(p, false);
  const rl = await p.evaluate(() => document.querySelectorAll("#resBtns .dblb").length); ok(rl === 0, "match lost: no ×2 button", rl);
  await fake(p, false); await match(p, true);
  const rn = await p.evaluate(() => document.querySelectorAll("#resBtns .dblb").length); ok(rn === 0, "no ad SDK (plain website): no ×2 button", rn);
  await p.close();
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
