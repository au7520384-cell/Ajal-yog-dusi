#!/usr/bin/env node
// Mafia on the phone, end to end:  node tools/test_mafia_ui.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 3 minutes; the real server with MAFIA_SCALE=0.08, 1-2 Chromium phones with a fake microphone)
// The owner (Nov 23-24): shashka, chess and MAFIA, all with voice. The Mafia card sits in the Board games row; alone against the bots a match is played through the screen (a tap on a seat is the action of the phase),
// each phone shows ONLY its own role, the result window lists every role, "Play again" brings the room back (8 seats), the exit key hands the seat to a bot; two phones in one room: the voice gate (the night is
// silent, the day is for everybody alive) and the two views never show each other's role; every screen size keeps the seats and the panel inside the page.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "", P = +process.env.TEST_PORT || 8803;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const until = async (fn, to = 15000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
(async () => {
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8mfu-")), base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, MAFIA_SCALE: "0.08", BROOM_GRACE_MS: "20000" }, stdio: "ignore" });
  await until(() => fetch(base + "/api/health").then(r => r.ok).catch(() => false), 60000, 300);
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] }), errs = [];
  const open = async (name, vp = { width: 915, height: 412 }) => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, hasTouch: true, isMobile: true, permissions: ["microphone"] }), p = await ctx.newPage(); p._ctx = ctx; p._name = name;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => window.__toasts.push(String(t)); }); await sleep(1500);
    await p.evaluate(() => Net.ensure().then(() => Net.connect())); await sleep(500); return p;
  };
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent) } : null);
  const clickBtn = (p, re) => p.evaluate(r => { const bt = [...document.querySelectorAll("#mBtns button")].find(x => new RegExp(r, "i").test(x.textContent)); if (bt) bt.click(); return !!bt; }, re);
  const ROLEI = ["🔪", "💉", "🕵️", "🧑‍🌾"];
  // play the part of my phase once (a tap on the first valid seat, or the key); the same player for every phone
  const state = p => p.evaluate(() => MFX.on && MFX.v ? { ph: MFX.v.phase, day: MFX.v.day, role: MFX.v.role, you: MFX.v.you, alive: MFX.v.alive, n: MFX.v.n, pick: MFX.v.pick } : null);
  const act = async (p, st, done) => { const key = st.ph + ":" + st.day; if (done.has(key) || !st.alive[st.you]) return; done.add(key);
    if (st.ph === "night" || st.ph === "vote") await p.evaluate(() => { const t = document.querySelector("#mfScr .mf-p.tg"); if (t) t.click(); });
    else if (st.ph === "day") await p.evaluate(() => { const g = document.querySelector('#mfScr [data-a="go"]'); if (g && g.style.display !== "none") g.click(); }); };
  try {
    // ------------------------------------------------------------------ alone with the bots
    const A = await open("Ann");
    await A.evaluate(() => toMenu("mini")); await sleep(900);
    const row = await A.evaluate(() => { const r = document.getElementById("miniBoards"); return { cards: [...r.querySelectorAll(".sh-pan")].map(c => c.dataset.g), imgs: !!r.querySelector(".sh-ban img") && r.querySelector(".sh-ban img").naturalWidth >= 1000 }; });
    ok(row.cards.join() === "shashka,magic,mafia" && row.imgs, "the Board games row is the owner's picture with a key over each card, Mafia the third", row);
    await A.evaluate(() => document.querySelector('#miniBoards [data-g="mafia"]').click()); await sleep(600);
    ok((await A.evaluate(() => [...document.querySelectorAll("#mExtra .pro-row")].map(r => r.dataset.id))).join() === "solo,online", "the card opens the list: with bots (alone) or friends online");
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "01_pick.png") });
    await A.evaluate(() => { window.__sfx = []; for (const k of ["night", "owl", "day", "shot", "heal", "bell", "knock", "reveal", "win", "lose", "tick"]) { const f = Snd[k]; Snd[k] = (...a) => { window.__sfx.push(k); return f.apply(Snd, a); }; } });   // (the sounds of the game are counted)
    await A.evaluate(() => document.querySelector('#mExtra [data-id="solo"]').click());
    ok(await until(() => A.evaluate(() => MFX.on && !!MFX.v), 20000), "alone: a room is made and started at once, the Mafia screen opens");
    const first = await A.evaluate(() => ({ cls: document.getElementById("mfScr").className, tiles: document.querySelectorAll("#mfScr .mf-p").length, me: document.querySelectorAll("#mfScr .mf-p.me").length, bots: document.querySelectorAll("#mfScr .mf-p small").length && [...document.querySelectorAll("#mfScr .mf-p small")].filter(s => s.textContent.includes("🤖")).length, role: MFX.v.role, card: document.getElementById("mfRole").textContent, rolesField: MFX.v.roles }));
    ok(first.tiles === 5 && first.me === 1 && first.bots === 4 && /reveal|night/.test(first.cls) && !first.rolesField && first.card.length > 20, "5 seats: me and 4 bots, my role card, no list of roles", first);
    ok(["mafia", "doctor", "sheriff", "citizen"].includes(first.role), "my role is one of the four", first.role);
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "02_reveal.png") });
    const seen = new Set(), done = new Set(); let leak = 0, picked = 0, opps = 0, over = false, snaps = 0;
    for (let k = 0; k < 900 && !over; k++) {
      const st = await state(A); if (!st) { await sleep(120); continue; } seen.add(st.ph);
      // what the DOM shows about other seats: no role icon on a seat that is not me, not my mate, not dead (and none before the end)
      if (st.ph !== "over") { const bad = await A.evaluate(ic => [...document.querySelectorAll("#mfScr .mf-p")].filter((t, i) => i !== MFX.v.you && MFX.v.alive[i] && !(MFX.v.mates || []).includes(i) && !(MFX.v.found || []).some(f => f.seat === i) && ic.some(x => t.querySelector("small").textContent.includes(x))).length, ROLEI); leak += bad; }
      if (SHOT && snaps < 3 && (st.ph === "night" || st.ph === "vote")) { snaps++; await A.screenshot({ path: path.join(SHOT, `03_${st.ph}${st.day}.png`) }); }
      const was = done.has(st.ph + ":" + st.day); await act(A, st, done);
      if (!was && (st.ph === "night" || st.ph === "vote") && st.alive[st.you]) { opps++; await sleep(120); const pk = await A.evaluate(() => ({ cls: document.querySelectorAll("#mfScr .mf-p.pick").length, pick: MFX.v.pick })); if (pk.cls === 1 || (st.ph === "night" && st.role === "citizen")) picked++; }
      if (st.ph === "over") over = true; await sleep(120);
    }
    ok(seen.has("night") && seen.has("day") && seen.has("vote") && over, "the phases came one after another: night, day, vote, the end", [...seen]);
    ok(leak === 0, "a seat that is alive, not me and not my mate never showed a role icon", leak);
    await until(() => A.evaluate(() => window.__sfx.some(x => x === "win" || x === "lose")), 4000);   // (the end's sound comes a moment after the last view)
    const sfx = await A.evaluate(() => window.__sfx.slice()), sc = k => sfx.filter(x => x === k).length;
    ok(sc("reveal") === 1 && sc("night") >= 1 && sc("owl") >= 1 && sc("bell") >= 1 && (sc("day") >= 1) && (sc("win") + sc("lose") === 1), "Mafia has the sounds of play (the owner, Nov 25 / 27): the roles are dealt (1), the night falls (and an owl calls), the day breaks (the morning birds), the bell of the vote, then one win or lose at the end", sfx);
    ok(sc("shot") + sc("heal") >= 1, "every morning has its sound: a rifle shot when somebody was killed, a rescue chime when nobody died", sfx);
    ok(await A.evaluate(() => { const g = document.querySelector('#mfScr [data-a="go"]'); return getComputedStyle(g).display !== "none" && /Play again/.test(g.textContent); }), "at the end the screen has its own 'Play again' key (it never just stands there)");
    ok(opps >= 1 && picked >= Math.min(2, opps), "a tap on a seat in the night / the vote picks it (the seat is marked) in every phase where I could (a match can end, or I can be killed, after one)", { picked, opps });
    ok(await until(() => modal(A).then(m => m && /win/i.test(m.t)), 6000), "the result window comes", await modal(A));
    const res = await A.evaluate(() => ({ rows: [...document.querySelectorAll(".mf-resl .mf-res")].map(r => r.lastElementChild.textContent), roles: MFX.v.roles }));
    ok(res.rows.length === 5 && res.roles.length === 5 && res.rows.every((r, i) => r.includes({ mafia: "Mafia", doctor: "Doctor", sheriff: "Sheriff", citizen: "Citizen" }[res.roles[i]])), "it lists all 5 roles, the true ones", res);
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "04_over.png") });
    await clickBtn(A, "Play again"); await sleep(500);
    const room = await A.evaluate(() => ({ on: document.getElementById("brRoom").classList.contains("on"), seats: document.querySelectorAll("#brRoom .mf-rseats .tn-seat").length, free: document.querySelectorAll("#brRoom .mf-rseats .tn-seat.free").length, start: !!document.querySelector('#brRoom [data-a="start"]'), scr: document.getElementById("mfScr").classList.contains("on") }));
    ok(room.on && room.seats === 8 && room.free === 7 && room.start && !room.scr, "'Play again': the room window with 8 seats (I am in one, the bots are gone) and the start key", room);
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "05_room.png") });
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(() => A.evaluate(() => MFX.on && MFX.v && MFX.v.n === 5), 8000), "the host starts again: a new match with bots");
    await A.evaluate(() => document.querySelector('#mfScr [data-a="exit"]').click()); await sleep(400);
    ok(!!(await modal(A)) && /Exit|Leave/i.test((await modal(A)).btns.join()), "the exit key asks first (a bot plays in my place)", await modal(A));
    await clickBtn(A, "Exit|Leave"); await sleep(500);
    ok(await A.evaluate(() => !document.getElementById("mfScr").classList.contains("on") && !BR.code && !MFX.on), "leaving: the screen is closed and the room is left");
    await A._ctx.close();

    // ------------------------------------------------------------------ every screen size
    for (const [name, vp] of [["915 x 412", { width: 915, height: 412 }], ["740 x 360", { width: 740, height: 360 }], ["412 x 915 (turned)", { width: 412, height: 915 }], ["360 x 640 (turned)", { width: 360, height: 640 }], ["1280 x 720", { width: 1280, height: 720 }]]) {
      const q = await open("Sz" + vp.width, vp); await q.evaluate(() => toMenu("mini")); await sleep(500); await q.evaluate(() => mfSolo());
      await until(() => q.evaluate(() => MFX.on && !!MFX.v && MFX.v.phase !== "reveal"), 20000); await sleep(300);
      const g = await q.evaluate(() => { const rot = document.documentElement.classList.contains("rot"), W = rot ? innerHeight : innerWidth, H = rot ? innerWidth : innerHeight, page = r => rot ? { l: r.top, t: innerWidth - r.right, r: r.bottom, b: innerWidth - r.left } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
        const R = s => page(document.querySelector(s).getBoundingClientRect()), tiles = [...document.querySelectorAll("#mfScr .mf-p")].map(e => page(e.getBoundingClientRect())), seats = R("#mfSeats"), right = R("#mfScr .mf-right");
        const inside = r => r.l >= -1 && r.t >= -1 && r.r <= W + 1 && r.b <= H + 1; return { W, H, tiles: tiles.length, allIn: tiles.every(inside) && inside(right) && inside(seats), apart: seats.r <= right.l + 1, role: document.getElementById("mfRole").getBoundingClientRect().height > 20, btnIn: inside(page(document.querySelector('#mfScr [data-a="exit"]').getBoundingClientRect())) }; });
      ok(g.tiles === 5 && g.allIn && g.apart && g.role && g.btnIn, `${name}: the seats, the role card and the keys are inside the page and apart`, g);
      if (SHOT) await q.screenshot({ path: path.join(SHOT, `06_size_${vp.width}.png`) }); await q._ctx.close();
    }

    // ------------------------------------------------------------------ two phones in one room: the voice gate, no role seen on the other phone
    const C = await open("Cat"), D = await open("Dan");
    for (const x of [C, D]) await x.evaluate(() => toMenu("mini"));
    await C.evaluate(() => shRoomOpen("mafia")); await sleep(600); await C.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(() => C.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "a Mafia room is made (the room window: the code, 8 seats)");
    const code = await C.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    await D.evaluate(() => shRoomOpen("mafia")); await sleep(500); await D.evaluate(c => { document.querySelector("#brRoom .tn-code").value = c; document.querySelector('#brRoom [data-a="join"]').click(); }, code);
    ok(await until(async () => (await Promise.all([C, D].map(x => x.evaluate(() => document.querySelectorAll("#brRoom .mf-rseats .tn-seat:not(.free)").length)))).every(n => n === 2), 10000), "the friend joins: two seats are taken on both phones");
    ok(await D.evaluate(() => !document.querySelector('#brRoom [data-a="start"]')), "only the host has the start key");
    await C.evaluate(() => shVoiceBtn("mic")); await D.evaluate(() => shVoiceBtn("mic"));
    ok(await until(async () => (await Promise.all([C, D].map(x => x.evaluate(() => RV.state().peers.some(p => p.live))))).every(Boolean), 25000), "voice: both phones are connected in the room (a call between the seats)");
    await C.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([C, D].map(x => x.evaluate(() => MFX.on && !!MFX.v)))).every(Boolean), 15000), "Start: both phones open the Mafia screen (2 people + 3 bots)");
    const doneC = new Set(), doneD = new Set(); let gateNight = [], gateDay = [], leak2 = 0, both = false;
    for (let k = 0; k < 1200; k++) {
      const [A1, B1] = await Promise.all([C, D].map(x => x.evaluate(() => { const v = MFX.on && MFX.v, s = RV.state(); return { st: v ? { ph: v.phase, day: v.day, role: v.role, you: v.you, alive: v.alive, n: v.n, pick: v.pick } : null, gate: s.peers.length ? [s.peers[0].to, s.peers[0].from] : null }; })));
      const sc = A1.st, sd = B1.st, gc = A1.gate, gd = B1.gate; if (!sc || !sd) { await sleep(120); continue; }   // (each phone's phase and gate are read in ONE call: two calls could straddle a phase change and take the day's gate for the night's)
      if (sc.ph === "over" && sd.ph === "over") { both = true; break; }
      if (sc.ph === "night" && sd.ph === "night" && gc && gd && sc.alive[sc.you] && sd.alive[sd.you]) gateNight.push([gc.join(), gd.join()]);
      if (sc.ph === "day" && sd.ph === "day" && gc && gd) { const want = (a, b) => [a.alive[a.you] && b.alive[b.you], b.alive[b.you]].join(); gateDay.push({ c: gc.join(), d: gd.join(), wc: want(sc, sd), wd: want(sd, sc) }); }   // (what the gate must be: I may speak to the other phone when we are both alive, I hear it when it is alive)
      for (const [x, s] of [[C, sc], [D, sd]]) { if (s.ph !== "over") leak2 += await x.evaluate(ic => [...document.querySelectorAll("#mfScr .mf-p")].filter((t, i) => i !== MFX.v.you && MFX.v.alive[i] && !(MFX.v.mates || []).includes(i) && !(MFX.v.found || []).some(f => f.seat === i) && ic.some(c => t.querySelector("small").textContent.includes(c))).length, ROLEI); }
      if (sc.ph === "day" && sd.ph === "day" && !gateDay.length) { await sleep(60); continue; }   // (the day is sampled once before anybody presses "ready": it would end the day sooner than the loop can look)
      await act(C, sc, doneC); await act(D, sd, doneD); await sleep(120);
    }
    ok(both, "both phones play the match to the end");
    ok(gateNight.length > 0 && gateNight.every(g => g[0] === "false,false" && g[1] === "false,false"), "the night is silent: nobody's voice goes to the other phone and nobody is heard (no mafia pair here)", gateNight.slice(0, 3));
    ok(gateDay.length > 0 && gateDay.every(g => g.c === g.wc && g.d === g.wd), "the day is for everybody who is alive: the voice goes both ways between two living phones, and a dead one only listens", gateDay.slice(0, 3));
    ok(leak2 === 0, "neither phone ever showed a role it may not know", leak2);
    ok(await until(async () => (await Promise.all([C, D].map(x => x.evaluate(() => document.querySelectorAll(".mf-resl .mf-res").length)))).every(n => n === 5), 8000), "both phones show the same 5-role result window");
    const rl = await Promise.all([C, D].map(x => x.evaluate(() => JSON.stringify(MFX.v.roles)))); ok(rl[0] === rl[1], "...with the same list of roles", rl);
    await C._ctx.close(); await D._ctx.close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} process.exit(fail ? 1 : 0);
})();
