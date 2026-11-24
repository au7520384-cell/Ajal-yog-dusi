#!/usr/bin/env node
// The table coins on the PHONE:  node tools/test_stake_ui.js   (B8_ROOT=<repo copy>; SHOT=dir saves pictures; about 2 minutes; the real server + 3 Chromium phones)
// The owner (Nov 24): shashka / Magic Chess / Mafia are played for a virtual coin (12 to start, +1 per rewarded video, $1 = 2000, a stake of 3..100 000). The room window has the stake chips and the wallet key, a room with a stake says
// so, the match has a chip with the stake and the clock, the result says what the match moved, a card of the world chat shows the stake, and a player who cannot pay is sent to the wallet (the window says the coins are virtual).
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "", P = +process.env.TEST_PORT || 8808;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const until = async (fn, to = 15000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
(async () => {
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8sk-")), base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, MAFIA_SCALE: "0.08", WORLD_REQ_MS: "8000", BROOM_TURN_MS: "90000" }, stdio: "ignore" });
  await until(() => fetch(base + "/api/health").then(r => r.ok).catch(() => false), 60000, 300);
  const b = await chromium.launch(), errs = [];
  const open = async (name, portrait) => {
    const ctx = await b.newContext({ viewport: portrait ? { width: 412, height: 915 } : { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, hasTouch: true, isMobile: true }), p = await ctx.newPage(); p._ctx = ctx; p._name = name;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t, s) => window.__toasts.push(String(t) + " | " + String(s || "")); }); await sleep(1500);
    await p.evaluate(() => Net.ensure().then(() => Net.connect())); await sleep(500); return p;
  };
  const chips = p => p.evaluate(() => [...document.querySelectorAll("#brRoom .tcs-c")].map(c => ({ t: c.textContent.trim(), p: c.dataset.tcp, on: c.classList.contains("on"), dis: c.disabled })));
  const coins = p => p.evaluate(() => ({ n: TCX.n, hold: TCX.hold }));
  const tossed = (p, re) => p.evaluate(s => window.__toasts.some(t => new RegExp(s, "i").test(t)), re.source);
  try {
    const A = await open("Ann"), B = await open("Bob"), C = await open("Cat");
    for (const x of [A, B, C]) await x.evaluate(() => toMenu("mini"));
    // ------------------------------------------------------------------ the room window: chips, the wallet key
    await A.evaluate(() => shRoomOpen("shashka")); ok(await until(() => A.evaluate(() => !!document.querySelector("#brRoom .tcs-c") && TCX.ok), 8000), "the room window shows the stake chips and has the wallet loaded");
    const ch = await chips(A);
    ok(ch[0].t === "Friendly" && ch[0].on && ch.slice(1).map(c => c.p).join() === "3,5,10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000", "chips: Friendly (on) and the 15 stakes 3 ... 100 000", ch);
    ok(ch.slice(1).filter(c => !c.dis).map(c => c.p).join() === "3,5,10", "a new player has 12 coins: only 3, 5 and 10 can be chosen", ch);
    ok(await A.evaluate(() => document.querySelector("#brRoom .tcs-w b").textContent.trim()) === "12", "the wallet key shows 12");
    ok(await A.evaluate(() => window.__toasts.some(t => /12 table coins/i.test(t))), "a new player is told about the 12 coins (a gift)", await A.evaluate(() => window.__toasts));
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "01_chips.png") });
    await A.evaluate(() => document.querySelector('#brRoom [data-tcp="3"]').click()); await sleep(300);
    ok((await chips(A)).find(c => c.p === "3").on && /stakes 3 .*winner gets 5/i.test(await A.evaluate(() => document.querySelector("#brRoom .tcs-n").textContent)), "a stake of 3: the note says each of you stakes 3 and the winner gets 5 (3 + 3 -> 5)", await A.evaluate(() => document.querySelector("#brRoom .tcs-n").textContent));
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(() => A.evaluate(() => /^[A-Z2-9]{4}$/.test((document.querySelector("#brRoom .tn-codev") || {}).textContent || "")), 8000), "the room with the stake is made");
    ok(await A.evaluate(() => BR.R && BR.R.stake === 3) && /Stake: 3 .*winner gets 5/i.test(await A.evaluate(() => (document.querySelector("#brRoom .tcb") || {}).textContent || "")), "the room window says 'Stake: 3, the winner gets 5'", await A.evaluate(() => (document.querySelector("#brRoom .tcb") || {}).textContent));
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "02_room.png") });
    const code = await A.evaluate(() => document.querySelector("#brRoom .tn-codev").textContent);
    // the world chat card shows the stake; a player who cannot pay is not let in (the host is not asked)
    await A.evaluate(() => document.querySelector('#brRoom [data-a="world"]').click()); await sleep(800);
    await C.evaluate(() => WorldChat.open()); await sleep(900);
    ok(/🎲 3/.test(await C.evaluate(() => (document.querySelector("#wLobList .wlt") || {}).textContent || "")), "the world chat card shows the stake (🎲 3)", await C.evaluate(() => (document.querySelector("#wLobList .wlt") || {}).textContent));
    if (SHOT) await C.screenshot({ path: path.join(SHOT, "03_world.png") });
    await C.evaluate(() => WorldChat.close());
    // ------------------------------------------------------------------ Bob joins, the match starts: the chip with the stake and the clock
    await B.evaluate(() => shRoomOpen("shashka", document.querySelector("body") && null)); await B.evaluate(c => brJoin(c), code);
    ok(await until(() => B.evaluate(() => BR.R && BR.R.seats.filter(Boolean).length === 2), 8000), "Bob joined the room");
    ok(/Stake: 3/i.test(await B.evaluate(() => (document.querySelector("#brRoom .tcb") || {}).textContent || "")), "Bob's room window shows the stake too");
    await A.evaluate(() => document.querySelector('#brRoom [data-a="start"]').click());
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => SHU.on && SHU.mode === "online")))).every(Boolean), 10000), "the match is on both phones");
    ok(await until(async () => (await Promise.all([A, B].map(x => x.evaluate(() => (coins => coins)(TCX.hold))))).every(h => h === 3), 6000), "the stake is held on both wallets (hold 3)");
    await until(() => A.evaluate(() => !!document.getElementById("tcClk") && getComputedStyle(document.getElementById("tcClk")).display !== "none"), 4000);
    const clk = await A.evaluate(() => { const e = document.getElementById("tcClk"); return e ? { t: e.textContent, d: getComputedStyle(e).display, r: e.getBoundingClientRect().toJSON() } : null; });
    ok(clk && clk.d !== "none" && /🎲 3 · ⏱ \d+:\d\d/.test(clk.t), "over the match: a chip with the stake and the clock of the seat on turn", clk);
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "04_match.png") });
    // four plies through the board, then a resignation counts
    const ply = async n => {
      for (let i = 0; i < n; i++) {
        const w = await until(async () => { for (const x of [A, B]) if (await x.evaluate(k => SHU.on && !SHU.busy && SHU.G.moves.length === k && SHU.G.side === SHU.my, i)) return true; return false; }, 6000);
        if (!w) return false;
        for (const x of [A, B]) { const done = await x.evaluate(k => { if (!(SHU.on && !SHU.busy && SHU.G.moves.length === k && SHU.G.side === SHU.my)) return false; const mv = shGen(SHU.G.b, SHU.G.side)[0]; shTap(mv.path[0]); shTap(mv.path[1]); return true; }, i); if (done) break; }
        if (!await until(async () => (await Promise.all([A, B].map(x => x.evaluate(k => SHU.G.moves.length >= k && !SHU.busy, i + 1)))).every(Boolean), 6000)) return false;
      }
      return true;
    };
    ok(await ply(4), "four plies are played through the boards");
    await B.evaluate(() => document.querySelector('#shScr [data-a="resign"]').click()); await sleep(300);
    await B.evaluate(() => document.querySelector("#mBtns .red").click());
    ok(await until(() => A.evaluate(() => window.__toasts.some(t => /^\+2 \|/.test(t))), 8000), "Ann's phone says +2 (the winner of 3 + 3 -> 5)", await A.evaluate(() => window.__toasts));
    ok(await until(() => B.evaluate(() => window.__toasts.some(t => /^-3 \|/.test(t))), 8000), "Bob's phone says -3", await B.evaluate(() => window.__toasts));
    await sleep(600);
    ok(JSON.stringify(await coins(A)) === '{"n":14,"hold":0}' && JSON.stringify(await coins(B)) === '{"n":9,"hold":0}', "the wallets: Ann 14, Bob 9, nothing held", [await coins(A), await coins(B)]);
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "05_result.png") });
    // ------------------------------------------------------------------ the wallet window
    for (const x of [A, B]) await x.evaluate(() => { try { shLeaveOnline(); } catch (e) {} for (const id of ["shScr", "mcScr"]) { const el = document.getElementById(id); if (el) el.classList.remove("on"); } SHU.on = false; brClose(); document.getElementById("modal").classList.remove("on"); }); await sleep(400);
    await B.evaluate(() => tcWallet()); await sleep(700);
    const wt = await B.evaluate(() => (document.getElementById("tcW") || {}).textContent || "");
    ok(/9/.test(wt) && /Table coins are virtual in-game coins\. They cannot be exchanged for money or sent to another player\./.test(wt), "the wallet window: the balance and the note that the coins have no cash value and cannot be sent", wt);
    ok(await B.evaluate(() => document.querySelector('#tcW [data-tcw="ad"]').disabled) && /Ads are not available here/.test(wt), "no ad network on this page: the video key is off and says why");
    const pk = await B.evaluate(() => [...document.querySelectorAll('#tcW [data-tcw="buy"]')].map(x => ({ sku: x.dataset.sku, t: x.innerText.replace(/\s+/g, " ").trim(), dis: x.disabled })));
    ok(pk.map(x => x.sku).join() === "tc_2k,tc_4k,tc_10k" && pk[0].t === "$1 2 000 🎲" && pk[1].t === "$2 4 000 🎲" && pk[2].t === "$5 10 000 🎲" && pk.every(x => !x.dis) && /10 000 🎲 today/i.test(wt), "three packs: $1 = 2 000, $2 = 4 000, $5 = 10 000; the limit left today is shown", [pk, wt]);
    ok(await B.evaluate(() => { const m = document.querySelector("#modal .box, #modal > div"); const r = (document.getElementById("tcW").closest("#modal > *") || document.getElementById("tcW")).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1; }), "the wallet window fits the screen");
    if (SHOT) await B.screenshot({ path: path.join(SHOT, "06_wallet.png") });
    await B.evaluate(() => document.getElementById("modal").classList.remove("on"));
    // ------------------------------------------------------------------ a stake Bob cannot pay: the room says so and the wallet opens with the missing amount
    await A.evaluate(() => { TCX.pick = 10; profile.tcPick = 10; shRoomOpen("shashka"); }); await until(() => A.evaluate(() => TCX.ok && !!document.querySelector("#brRoom .tcs-c")), 6000);
    await A.evaluate(() => document.querySelector('#brRoom [data-a="create"]').click());
    ok(await until(() => A.evaluate(() => BR.R && BR.R.stake === 10), 8000), "Ann (14 coins) opens a room with a stake of 10");
    const code2 = await A.evaluate(() => BR.R.code);
    await B.evaluate(() => shRoomOpen("shashka")); await sleep(500); await B.evaluate(c => brJoin(c), code2);
    ok(await until(() => tossed(B, /Not enough coins/), 6000), "Bob (9 coins) is told 'Not enough coins'", await B.evaluate(() => window.__toasts));
    ok(await until(() => B.evaluate(() => /Needed: 10/.test((document.getElementById("tcW") || {}).textContent || "")), 4000), "...and the wallet window opens with 'Needed: 10'", await B.evaluate(() => (document.getElementById("tcW") || {}).textContent));
    if (SHOT) await B.screenshot({ path: path.join(SHOT, "07_needed.png") });
    await B.evaluate(() => document.getElementById("modal").classList.remove("on"));
    const wid = (await A.evaluate(() => Net.api("/api/world/lobby", { board: 1 }).then(r => r.lobbies[0].wid))); const j = await B.evaluate(w => Net.api("/api/world/join", { wid: w }), wid);
    ok(j.state === "coins" && j.need === 10, "the world chat answers 'coins' (need 10) to a player who cannot pay: the host is not asked", j);
    await A.evaluate(() => { try { shLeaveOnline(); } catch (e) {} brClose(); }); await sleep(400);
    // ------------------------------------------------------------------ Mafia: the mafioso's stake is 3 times
    await A.evaluate(() => { TCX.pick = 3; profile.tcPick = 3; shRoomOpen("mafia"); }); await until(() => A.evaluate(() => TCX.ok && !!document.querySelector("#brRoom .tcs-c")), 6000); await sleep(300);
    const mch = await chips(A); ok(mch.slice(1).map(c => c.p).join() === "3,5,10,25,50,100,250,500,1000,2500,5000,10000,25000", "Mafia: the chips stop at 25 000 (the mafioso puts in 3 times: 75 000)", mch.map(c => c.p));
    ok(mch.filter(c => c.p !== "0" && !c.dis).map(c => c.p).join() === "3", "Ann has 14: for Mafia only 3 can be chosen (a mafioso needs 9; 5 would need 15)", mch);
    ok(/Citizens stake 3 .*mafia stakes 9 .*5–8 real players \(no bots\)/.test(await A.evaluate(() => document.querySelector("#brRoom .tcs-n").textContent)), "the note: citizens 3, mafia 9, the winning team shares 90%, 5-8 real players without bots", await A.evaluate(() => document.querySelector("#brRoom .tcs-n").textContent));
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "08_mafia_chips.png") });
    await A.evaluate(() => { BR.busy = 0; document.querySelector('#brRoom [data-a="create"]').click(); }); await until(() => A.evaluate(() => BR.R && BR.R.game === "mafia" && BR.R.stake === 3), 6000);
    ok(/Stake: citizens 3 .*mafia 9/.test(await A.evaluate(() => (document.querySelector("#brRoom .tcb") || {}).textContent || "")), "a Mafia room with a stake says 'citizens 3, mafia 9'", await A.evaluate(() => (document.querySelector("#brRoom .tcb") || {}).textContent));
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "09_mafia_room.png") });
    // ------------------------------------------------------------------ the portals (Y8 / Playgama / GameMonetize) have no stakes: no chips, no wallet key, a stake room met by a code is left
    const Q = await open("Pat"); await Q.evaluate(() => { window.CRAZY_BUILD = true; toMenu("mini"); shRoomOpen("shashka"); }); await sleep(900);
    ok(await Q.evaluate(() => !document.querySelector("#brRoom .tcs") && !!document.querySelector('#brRoom [data-a="create"]')), "a portal build: the room window has no stake chips and no wallet key");
    const codeM = await A.evaluate(() => BR.R && BR.R.code); await Q.evaluate(c => brJoin(c), codeM); ok(await until(() => tossed(Q, /Stake rooms are not available here/), 6000) && await until(() => Q.evaluate(() => !BR.R), 4000), "a portal player who meets a stake room by its code leaves it at once", await Q.evaluate(() => window.__toasts)); await Q._ctx.close();
    ok(errs.length === 0, "no page errors", errs.slice(0, 6));
    for (const x of [A, B, C]) await x._ctx.close();
    // ------------------------------------------------------------------ the turned page (Telegram, portrait): the same windows
    if (SHOT) {
      const T1 = await open("Tim", true); await T1.evaluate(() => toMenu("mini")); await T1.evaluate(() => shRoomOpen("shashka")); await until(() => T1.evaluate(() => TCX.ok && !!document.querySelector("#brRoom .tcs-c")), 8000); await sleep(400);
      await T1.screenshot({ path: path.join(SHOT, "10_rot_chips.png") }); await T1.evaluate(() => tcWallet(10)); await sleep(500); await T1.screenshot({ path: path.join(SHOT, "11_rot_wallet.png")});
      ok(await T1.evaluate(() => { const r = document.getElementById("tcW").getBoundingClientRect(); const rect = document.getElementById("modal").getBoundingClientRect(); return rect.width > 0 && r.width > 0; }), "the wallet window exists on the turned page"); await T1._ctx.close();
    }
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
  console.log(`pass ${pass}, fail ${fail}`); try { await b.close(); } catch (e) {} process.exit(fail ? 1 : 0);
})();
