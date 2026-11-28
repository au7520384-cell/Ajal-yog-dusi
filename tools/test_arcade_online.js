#!/usr/bin/env node
// Air hockey and table tennis online with a friend, end to end:  node tools/test_arcade_online.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 2.5 minutes; the real server + 2 Chromium phones)
// The owner (Nov 28): "air hockey and table tennis need lobbies like chess and checkers: Create -> a code -> the partner enters it in ONE place and joins; billing must work".
//  - the arcade lists have an Online row; it opens the room window (🌐 name · Online), the host picks the length (3 / 5 / 7 goals, 3 / 7 / 11 points) and the stake, makes the room (a code), the friend enters the code in the 🔑 box (lower case works)
//  - the host starts: both phones open their own screen (the server plays the match); my own end is always the near one (the phone of the second seat turns the picture round), a finger moves MY mallet / racket and the other phone sees it
//  - a stake match played to the end: the result window on both phones (who won, the score, what the stake moved), the wallets, a rematch; leaving gives the match up (a confirmation first); a phone that is reloaded gets its match back
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto"), STRIPE = "whsec_ao";
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 900) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ao-")), P = +process.env.TEST_PORT || 8808, base = `http://localhost:${P}`, errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, ARC_TO_TEST: "1", BROOM_GRACE_MS: "20000", STRIPE_WEBHOOK_SECRET: STRIPE }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async name => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage(); p._ctx = ctx;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 50000, country: n === "Alice" ? "UZ" : "JP" })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} }); await sleep(900);
    await p.evaluate(() => { window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; Net.ensure().then(() => Net.connect()); });
    p._name = name; return p;
  };
  const until = async (fn, to = 15000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, txt: (document.getElementById("mText") || {}).textContent || "", btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  // a finger on a screen's table: (x, z) of the table (hockey) / (z, y) of the racket plane (tennis) -> a pointer event at the point of the screen it shows (the phone maps it back through the picture's own corners)
  const finger = (p, game, type, a, bb) => p.evaluate(([game, type, a, bb]) => {
    const w = document.getElementById(game === "hockey" ? "hkWrap" : "tbWrap"), c = game === "hockey" ? hkProj(a, 0, bb) : tbtProj(-TBT_XP, bb, a), m = [...w.querySelectorAll(".hk-m")].map(i => i.getBoundingClientRect());
    const x = m[0].left + c[0] / 1280 * (m[1].left - m[0].left) + c[1] / 720 * (m[2].left - m[0].left), y = m[0].top + c[0] / 1280 * (m[1].top - m[0].top) + c[1] / 720 * (m[2].top - m[0].top);
    w.dispatchEvent(new PointerEvent(type, { pointerId: 51, clientX: x, clientY: y, bubbles: true, cancelable: true })); return true; }, [game, type, a, bb]);
  const st = (p, game) => p.evaluate(game => game === "hockey" ? { on: HK.on, mode: HK.mode, st: HK.st, sc: HK.sc.join(), to: HK.to, names: HK.names.join("|"), ml: HK.ml.map(m => [+m.x.toFixed(1), +m.z.toFixed(1)]), pk: [+HK.pk.x.toFixed(1), +HK.pk.z.toFixed(1)], q: ARO.q.length, my: ARO.my, hud: document.getElementById("hkHud").textContent.replace(/\s+/g, " ") } : { on: TBT.on, mode: TBT.mode, st: TBT.st, sc: TBT.sc.join(), to: TBT.to, names: TBT.names.join("|"), p: TBT.p.map(x => [+x.z.toFixed(1), +x.y.toFixed(1)]), b: [+TBT.b.x.toFixed(1), +TBT.b.y.toFixed(1), +TBT.b.z.toFixed(1)], q: ARO.q.length, my: ARO.my, srv: TBT.srv, hud: document.getElementById("tbHud").textContent.replace(/\s+/g, " ") }, game);
  try {
    const A = await mk("Alice"), B = await mk("Bob");

    // ------------------------------------------------------------------ the room window of the air hockey
    await A.evaluate(() => { toMenu("mini"); hkPick(); }); await sleep(700);
    const rows = await A.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => r.dataset.id));
    ok(rows.join() === "easy,mid,hard,local,online", "the air hockey list has the Online row after the bots and the two-on-one-phone row", rows);
    await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(700);
    const win = await A.evaluate(() => ({ on: document.getElementById("brRoom").classList.contains("on"), head: document.querySelector("#brRoom .tn-head b").textContent, create: !!document.querySelector('#brRoom [data-a="create"]'), chips: [...document.querySelectorAll("#brRoom [data-arcto]")].map(x => x.textContent + (x.classList.contains("on") ? "*" : "")), stakes: document.querySelectorAll("#brRoom [data-tcp]").length }));
    ok(win.on && /Online/.test(win.head) && /Air hockey|Aeroxokkey/i.test(win.head) && win.create, "the Online row opens the room window of the air hockey (🌐 Air hockey · Online)", win);
    ok(win.chips.join() === "First to 3,First to 5*,First to 7", "the host chooses the length: first to 3 / 5 / 7 goals (5 is the default)", win.chips);
    ok(win.stakes >= 2, "...and the stake (the same chips as in the board games: friendly, 3, 5, 10 ... coins)", win.stakes);
    await shot(A, "01_window");
    await A.evaluate(() => document.querySelector('#brRoom [data-arcto="3"]').click()); await sleep(200);
    ok(await A.evaluate(() => document.querySelector('#brRoom [data-arcto="3"]').classList.contains("on")), "a tap on 3 chooses it");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "creating the room shows its 4-letter code");
    const code = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    ok(await A.evaluate(() => /First to 3/.test((document.querySelector("#brRoom .arcb") || {}).textContent || "") && /🔑/.test(document.querySelector("#brRoom .tn-hint").textContent)), "the room says its length (first to 3) and tells the friend to press the 🔑 key");
    // the friend: ONE box, the 🔑 key of the top bar, a lower-case code
    await B.evaluate(() => { toMenu("menu"); }); await sleep(500);
    await B.evaluate(() => document.getElementById("codeBtn").click()); await sleep(500);
    await B.evaluate(c => { document.querySelector("#brRoom .tn-code").value = c.toLowerCase(); document.querySelector('#brRoom [data-a="join"]').click(); }, code);
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => document.querySelectorAll("#brRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 10000), "the friend enters the code in the 🔑 box and both phones show two seats taken");
    ok(await B.evaluate(() => /Online/.test(document.querySelector("#brRoom .tn-head b").textContent) && /Air hockey|Aeroxokkey/i.test(document.querySelector("#brRoom .tn-head b").textContent) && !!document.querySelector("#brRoom .arcb")), "...in the room window of the air hockey (not shashka's), with its length");
    ok(await A.evaluate(() => !document.querySelector('#brRoom [data-a="start"]').disabled) && await B.evaluate(() => !document.querySelector('#brRoom [data-a="start"]')), "only the host has Start");
    await shot(B, "02_joined");

    // ------------------------------------------------------------------ the match
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => HK.on && HK.mode === "online" && document.getElementById("hkScr").classList.contains("on"))))).every(Boolean), 10000), "Start opens the air hockey screen on both phones (the server plays the match)");
    await sleep(1500);
    const sa = await st(A, "hockey"), sb = await st(B, "hockey");
    ok(sa.q > 10 && sb.q > 10 && sa.st === "play" && sb.st === "play" && sa.to === 3 && sb.to === 3 && sa.sc === "0,0", "states come from the server on both phones (the puck is in play, first to 3)", [sa, sb]);
    ok(sa.names === "Alice|Bob" && sb.names === "Bob|Alice" && /Alice · Bob/.test(sa.hud) && /First to 3/.test(sa.hud) && /Bob · Alice/.test(sb.hud), "each phone shows its own player first (Alice · Bob / Bob · Alice) and the length", [sa.hud, sb.hud]);
    ok(sa.ml[0][0] < 0 && sb.ml[0][0] < 0 && sa.ml[1][0] > 0 && sb.ml[1][0] > 0, "my end is always the near one: my mallet is on the near half on both phones (the second seat's picture is turned round)", [sa.ml, sb.ml]);
    // the hockey screen has the voice keys of the room
    ok(await A.evaluate(() => !!document.querySelector('#hkScr [data-a="mic"]') && !!document.querySelector('#hkScr [data-a="spk"]') && getComputedStyle(document.querySelector('#hkScr [data-a="mic"]')).display !== "none"), "the screen has the microphone and speaker keys of the room");
    // A's finger: its mallet goes where it points; on B's screen the other mallet is at the mirrored place
    await finger(A, "hockey", "pointerdown", -60, 22); await sleep(900);
    const ma = await st(A, "hockey"), mb = await st(B, "hockey");
    ok(Math.abs(ma.ml[0][0] + 60) < 3 && Math.abs(ma.ml[0][1] - 22) < 3, "my finger moves my mallet to the point I touch (at once)", ma.ml);
    ok(Math.abs(mb.ml[1][0] - 60) < 6 && Math.abs(mb.ml[1][1] + 22) < 6, "on the other phone that mallet is at the mirrored place: (x, z) -> (-x, -z), the other player's end is the far one", mb.ml);
    await finger(B, "hockey", "pointerdown", -50, -15); await sleep(900);
    const ma2 = await st(A, "hockey"), mb2 = await st(B, "hockey");
    ok(Math.abs(mb2.ml[0][0] + 50) < 3 && Math.abs(mb2.ml[0][1] + 15) < 3 && Math.abs(ma2.ml[1][0] - 50) < 6 && Math.abs(ma2.ml[1][1] - 15) < 6, "and the second seat's finger shows on the first phone, mirrored too", [mb2.ml, ma2.ml]);
    await shot(A, "03_hockey_A"); await shot(B, "04_hockey_B");
    // leaving is confirmed, then gives the match up: the other phone gets the result
    await finger(A, "hockey", "pointerup", 0, 0); await finger(B, "hockey", "pointerup", 0, 0);
    await A.evaluate(() => document.querySelector("#hkScr .hk-x").click()); await sleep(500);
    const m1 = await modal(A); ok(m1 && /Leave the game/i.test(m1.t) && m1.btns.some(x => /Exit/i.test(x)) && m1.btns.some(x => /Continue|Keep/i.test(x)), "the ✕ key asks first (Leave the game? - it counts as a loss)", m1);
    await clickBtn(A, "Continue|Keep"); await sleep(300); ok(await A.evaluate(() => HK.on), "'Continue' stays in the match");
    await A.evaluate(() => document.querySelector("#hkScr .hk-x").click()); await sleep(400); await clickBtn(A, "^Exit$"); await sleep(600);
    ok(await A.evaluate(() => !HK.on && !document.getElementById("hkScr").classList.contains("on")), "'Exit' closes the screen");
    ok(await until(async () => { const m = await modal(B); return m && /VICTORY/i.test(m.t); }, 6000), "the other phone gets the result: victory (the leaver gave up)", await modal(B));
    await clickBtn(B, "Menu"); await sleep(500); ok(await B.evaluate(() => !HK.on), "'Menu' closes the screen");

    // ------------------------------------------------------------------ a stake match of the air hockey, played to the first goal (the test server accepts a 1-goal match)
    const w0 = await Promise.all([A, B].map(p => p.evaluate(() => Net.api("/api/tc").then(r => r.tc))));
    await A.evaluate(() => { toMenu("menu"); }); await B.evaluate(() => { toMenu("menu"); }); await sleep(400);
    await A.evaluate(() => { Net.send({ t: "bcreate", game: "hockey", to: 1, stake: 5, cue: profile.cue, tbl: "" }); }); await sleep(600);
    const code2 = await A.evaluate(() => BR.code); ok(/^[A-Z2-9]{4}$/.test(code2), "a stake room is made (5 coins, first goal)", code2);
    await B.evaluate(c => { BR.want = "hockey"; brJoin(c); }, code2); await until(async () => await A.evaluate(() => BR.R && BR.R.seats.every(Boolean)), 8000);
    await A.evaluate(() => Net.send({ t: "bstart" }));
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => HK.on && HK.mode === "online")))).every(Boolean), 10000), "the stake match opens on both phones");
    ok(await A.evaluate(() => /🎲 5/.test(document.getElementById("hkHud").textContent)), "the stake is on the screen (🎲 5)");
    const first = await A.evaluate(() => ARO.first), att = first === 0 ? A : B, dfn = first === 0 ? B : A;   // the seat that serves attacks; the other keeps out of the way
    await sleep(1100); await finger(dfn, "hockey", "pointerdown", -92, -42); await finger(att, "hockey", "pointerdown", -25, 0); await sleep(300);
    ok(await until(async () => (await Promise.all([A, B].map(p => modal(p)))).every(m => m && /VICTORY|DEFEAT|DEFEATED|VICTORY/i.test(m.t)), 14000), "the goal ends the match: a result window on both phones", await Promise.all([A, B].map(modal)));
    const ra = await modal(A), rb = await modal(B), won = /VICTORY/i.test(ra.t) ? ra : rb, lost = /VICTORY/i.test(ra.t) ? rb : ra;
    ok(/VICTORY/i.test(won.t) && !/VICTORY/i.test(lost.t) && /1 : 0|0 : 1/.test(won.txt) && /🎲 \+4/.test(won.txt) && /🎲 -5/.test(lost.txt), "one phone says VICTORY (🎲 +4: 90% of the pool of 10 minus his stake), the other the defeat (🎲 -5)", [ra, rb]);
    await shot(A, "05_result");
    await sleep(800); const w1 = await Promise.all([A, B].map(p => p.evaluate(() => Net.api("/api/tc").then(r => r.tc))));
    const wi = /VICTORY/i.test(ra.t) ? 0 : 1; ok(w1[wi] === w0[wi] + 4 && w1[1 - wi] === w0[1 - wi] - 5, "the wallets moved by exactly that (the server paid it)", [w0, w1]);
    await clickBtn(A, "Play again"); await clickBtn(B, "Play again");
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => HK.on && HK.mode === "online" && HK.sc.join() === "0,0" && !document.getElementById("modal").classList.contains("on"))))).every(Boolean), 8000), "'Play again' on both phones starts a new match (0:0, same stake)");
    await A.evaluate(() => document.querySelector("#hkScr .hk-x").click()); await sleep(300); await clickBtn(A, "^Exit$"); await sleep(500);
    await sleep(600); const w2 = await Promise.all([A, B].map(p => p.evaluate(() => Net.api("/api/tc").then(r => r.tc))));
    ok(w2[0] + w2[1] === w1[0] + w1[1], "the rematch left at once moves no coins (void): both got their stake back", [w1, w2]);
    await B.evaluate(() => { if (HK.on) arcLeave(); }); await sleep(400);

    // ------------------------------------------------------------------ table tennis: the room, the screen, the swipe serve
    await A.evaluate(() => { toMenu("mini"); tbtPick(); }); await sleep(600);
    await A.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click()); await sleep(600);
    { const tw = await A.evaluate(() => ({ head: document.querySelector("#brRoom .tn-head b").textContent, chips: [...document.querySelectorAll("#brRoom [data-arcto]")].map(x => x.textContent).join(), want: BR.want, room: !!BR.R, on: document.getElementById("brRoom").classList.contains("on"), body: document.querySelector("#brRoom .tn-body").textContent.slice(0, 200) }));
      ok(/Table tennis|Stol tennisi/i.test(tw.head) && tw.chips === "First to 3 points,First to 7 points,First to 11 points", "the table tennis list has its Online row; its room window offers 3 / 7 / 11 points", tw); }
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click()); await until(async () => await A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000);
    const code3 = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await B.evaluate(() => { toMenu("menu"); }); await sleep(300); await B.evaluate(() => document.getElementById("codeBtn").click()); await sleep(400);
    await B.evaluate(c => { document.querySelector("#brRoom .tn-code").value = "Join my game: " + c; document.querySelector('#brRoom [data-a="join"]').click(); }, code3);
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => document.querySelectorAll("#brRoom .tn-seat:not(.free)").length)))).every(n => n === 2), 10000) && await B.evaluate(() => /Table tennis|Stol tennisi/i.test(document.querySelector("#brRoom .tn-head b").textContent)), "a pasted message with the code works in the 🔑 box too, and opens the table tennis room");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([A, B].map(p => p.evaluate(() => TBT.on && TBT.mode === "online")))).every(Boolean), 10000), "Start opens the table tennis screen on both phones");
    await sleep(1500);
    const ta = await st(A, "tennis"), tb = await st(B, "tennis");
    ok(ta.q > 10 && tb.q > 10 && ta.to === 7 && ta.names === "Alice|Bob" && tb.names === "Bob|Alice" && /First to 7 points/.test(ta.hud), "states come from the server; the default is first to 7; each phone shows its own player first", [ta, tb]);
    ok(ta.srv + tb.srv === 1, "exactly one of them serves (on a phone the server is 0 = me, 1 = the other)", [ta.srv, tb.srv]);
    const srvP = ta.srv === 0 ? A : B, rcvP = ta.srv === 0 ? B : A;
    ok(await srvP.evaluate(() => /Swipe the racket to serve/.test(document.getElementById("tbHint").textContent) && document.getElementById("tbHint").classList.contains("on")), "the server's phone says 'Swipe the racket to serve'");
    // a racket follows the finger, and shows on the other phone mirrored (z -> -z)
    await finger(rcvP, "tennis", "pointerdown", 35, 30); await sleep(700);
    const pr = await st(rcvP, "tennis"), po = await st(srvP, "tennis");
    ok(Math.abs(pr.p[0][0] - 35) < 4 && Math.abs(po.p[1][0] + 35) < 6, "a finger moves my racket, and the other phone shows it mirrored (z 35 -> -35)", [pr.p, po.p]);
    // the swipe serve: a quick move of the server's finger sends the ball
    await sleep(600);
    for (let i = 0; i < 10; i++) { await finger(srvP, "tennis", i ? "pointermove" : "pointerdown", -50 + i * 11, 30); await sleep(25); }
    ok(await until(async () => (await st(srvP, "tennis")).st === "rally", 4000), "a swipe of the server's finger serves: the rally begins (the server decided it)");
    await sleep(900); const t1 = await st(rcvP, "tennis"), t2 = await st(srvP, "tennis");
    ok(Math.abs(t1.b[0] - t2.b[0]) > 0.1 || t1.st !== "serve", "the ball flies on both phones", [t1.b, t2.b]);
    await shot(A, "06_tennis_A"); await shot(B, "07_tennis_B");
    await finger(srvP, "tennis", "pointerup", 0, 0); await finger(rcvP, "tennis", "pointerup", 0, 0);

    // ------------------------------------------------------------------ a phone that is reloaded in the middle of a match gets it back
    await B.reload({ waitUntil: "commit" });
    await B.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 }); await sleep(800);
    await B.evaluate(() => { document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; Net.ensure().then(() => Net.connect()); }); await sleep(1500);
    await B.evaluate(() => { toMenu("mini"); tbtPick(); }); await sleep(600); await B.evaluate(() => document.querySelector('#mExtra [data-id="online"]').click());
    { const got = await until(async () => await B.evaluate(() => TBT.on && TBT.mode === "online" && ARO.q.length > 3), 12000);
      ok(got, "the reloaded phone opens the Online row and gets its table tennis match back (the room, the state)", got ? undefined : await B.evaluate(() => ({ open: Net.open, acct: !!Net.acct, R: BR.R && { code: BR.R.code, state: BR.R.state }, want: BR.want, aro: { on: ARO.on, room: ARO.room, q: ARO.q.length }, toasts: window.__toasts.slice(-5), mode: typeof mode !== "undefined" ? mode : "?", brOn: document.getElementById("brRoom") && document.getElementById("brRoom").classList.contains("on") }))); }
    const tr = await st(B, "tennis"); ok(tr.names === "Bob|Alice" && tr.q > 3, "...as the same player (Bob first), with the match going on", tr);
    await B.evaluate(() => { document.querySelector("#tbScr .hk-x").click(); }); await sleep(300); await clickBtn(B, "^Exit$"); await sleep(600);
    ok(await until(async () => { const m = await modal(A); return m && /VICTORY/i.test(m.t); }, 8000), "the table tennis phone that stayed is told it won when the other leaves", await modal(A));
    await clickBtn(A, "Menu");

    // ------------------------------------------------------------------ billing, end to end: a player who cannot pay is sent to the wallet, pays $1, the 2000 coins arrive, and then the same room takes him
    const pay = async (id, sku, ref) => {   // a paid Stripe checkout, signed like Stripe signs it
      const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: ref, payment_status: "paid", amount_total: 100, metadata: { userId: id, sku } } } }), t = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", STRIPE).update(`${t}.${raw}`).digest("hex");
      return (await fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body: raw })).status; };
    const Cc = await mk("Carl"); await Cc.evaluate(() => { toMenu("menu"); }); await sleep(300);
    const cid = await Cc.evaluate(() => Net.acct.id), bid = await B.evaluate(() => Net.acct.id);
    ok(await pay(cid, "tc_2k", "cs_ao_c") === 200, "the host (Carl) buys the $1 pack so that he can open a 25-coin room");
    await B.evaluate(() => { toMenu("menu"); }); await sleep(300);
    const bw0 = await B.evaluate(() => Net.api("/api/tc").then(r => r.tc)); ok(bw0 < 25, "Bob has fewer than 25 coins", bw0);
    await until(async () => (await Cc.evaluate(() => TCX.n)) >= 2000, 8000);
    await Cc.evaluate(() => { Net.send({ t: "bcreate", game: "tennis", to: 3, stake: 25, cue: profile.cue, tbl: "" }); }); await sleep(700);
    const code4 = await Cc.evaluate(() => BR.code); ok(/^[A-Z2-9]{4}$/.test(code4), "Carl opens a 25-coin table tennis room", code4);
    await B.evaluate(c => { BR.want = "tennis"; brJoin(c); }, code4); await sleep(900);
    const need = await B.evaluate(() => ({ wallet: !!document.getElementById("tcW"), need: (document.querySelector("#tcW .tcw-need") || {}).textContent || "", packs: [...document.querySelectorAll('#tcW [data-tcw="buy"]')].map(x => x.dataset.sku).join(), bal: (document.querySelector("#tcW [data-tcn]") || {}).textContent }));
    ok(need.wallet && /Needed: 25/.test(need.need) && need.packs === "tc_2k,tc_4k,tc_10k", "joining a 25-coin room with too few coins opens the wallet: 'Needed: 25' and the three packs ($1 / $2 / $5)", need);
    await shot(B, "08_wallet");
    ok(await pay(bid, "tc_2k", "cs_ao_b") === 200, "Bob pays $1 (the card provider tells the server: a signed webhook)");
    ok(await until(async () => await B.evaluate(b0 => { const e = document.querySelector("#tcW [data-tcn]"); return !!e && parseInt(e.textContent.replace(/\D/g, ""), 10) >= b0 + 2000; }, bw0), 8000), "the 2000 coins arrive in the open wallet window by themselves (no reload)", await B.evaluate(() => (document.querySelector("#tcW [data-tcn]") || {}).textContent));
    const bw1 = await B.evaluate(() => Net.api("/api/tc").then(r => r.tc)); ok(bw1 === bw0 + 2000, "the wallet on the server: exactly +2000 (a payment is delivered once)", [bw0, bw1]);
    await clickBtn(B, "Close"); await sleep(300);
    await B.evaluate(c => { BR.want = "tennis"; brJoin(c); }, code4);
    ok(await until(async () => await B.evaluate(() => BR.R && BR.R.code && BR.R.seats.every(Boolean)), 8000), "...and now the same room takes him (the stake is the host's choice, the coins were all that was missing)");
    await Cc.evaluate(() => Net.send({ t: "bstart" }));
    ok(await until(async () => (await Promise.all([Cc, B].map(p => p.evaluate(() => TBT.on && TBT.mode === "online")))).every(Boolean), 10000), "the table tennis stake match starts on both phones");
    await sleep(800); const hold = await Promise.all([Cc, B].map(p => p.evaluate(() => Net.api("/api/tc").then(r => [r.tc, r.hold]))));
    ok(hold.every(h => h[1] === 25), "both stakes (25) are held", hold);
    await Cc.evaluate(() => arcLeave()); await sleep(800); const aft = await Promise.all([Cc, B].map(p => p.evaluate(() => Net.api("/api/tc").then(r => [r.tc, r.hold]))));
    ok(aft.every(h => h[1] === 0) && aft[0][0] + aft[1][0] === hold[0][0] + hold[1][0] + 50, "a match left at once gives both stakes back (void): nothing is held, nothing lost", [hold, aft]);
    await B.evaluate(() => { if (TBT.on) arcLeave(); });
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} srv.kill(); process.exit(fail ? 1 : 0);
})();
