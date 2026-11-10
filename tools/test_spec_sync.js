#!/usr/bin/env node
// Watching a live match (the "eye" / Live matches list):  node tools/test_spec_sync.js          (MODE=normal | slow | both, default both)
// Two online players play real shots; one watcher is in from the start, one comes in late, and (slow mode) a watcher whose own simulation is 3x too slow.
// After every shot the watchers' tables must be exactly the players' table (the positions the shooter reports), the turn must be the real turn, every shot must be
// played on the watcher's screen, and the turn clock (the ring round the avatar) must run. Bugs this guards against (all seen on Y8):
//  - the page's duplicate filter had ONE counter per match, but a watcher gets the messages of BOTH seats (each seat numbers its own): half of the shots / positions were dropped, the balls jumped and the turn went wrong
//  - a shot that arrived while the previous one was still rolling on the watcher's screen was thrown away
//  - the turn clock ring stood still for a watcher
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), MODE = process.env.MODE || "both";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };

async function scenario(name, P, opt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ss-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async nm => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(nm + ": " + e.message.slice(0, 160)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, nm);
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    return p;
  };
  const watch = async (nm, room, slow) => {
    const W = await mk(nm);
    await W.evaluate(slow => {
      window.__rs = 0; window.__frac = [];
      const _rs = requestShot; requestShot = function (p, r) { window.__rs++; return _rs(p, r); };
      const _da = drawAvatar; drawAvatar = function (x, y, s, pl, active, frac) { if (active) window.__frac.push(frac === undefined ? -1 : frac); return _da(x, y, s, pl, active, frac); };
      window.__busy = 0; if (typeof specShot === "function") { const _ss = specShot; specShot = function (G, m) { if (G.moving || G.strike) window.__busy++; return _ss(G, m); }; }   // how often a shot came in while the previous one was still rolling on this screen
      if (slow) { const _pf = physicsFrame; let k = 0; physicsFrame = function (G) { if (G.net && G.net.spec && (k++ % 3)) return; return _pf(G); }; }   // this screen plays the balls 3x too slowly
    }, !!slow);
    await W.evaluate(r => joinSpectate(r), room);
    await W.waitForFunction(() => game && game.net && game.net.spec && mode === "game", null, { timeout: 20000 });
    return W;
  };
  try {
    const A = await mk("Alpha"), B = await mk("Beta");
    await Promise.all([A, B].map(p => p.evaluate(() => findOpponent(CITIES[0]).then(r => { if (!r.net) throw new Error("no net match"); startMatch("ai", CITIES[0], r.opp, r.net); }))));
    await Promise.all([A, B].map(p => p.waitForFunction(() => game && game.net && !game.net.spec && mode === "game", null, { timeout: 60000 })));
    await sleep(1500);
    const room = await A.evaluate(() => game.net.room);
    const watchers = [{ nm: "early", p: await watch("WatcherEarly", room, opt.slow) }];
    let late = null;
    const settle = p => p.evaluate(() => !!(game.moving || game.strike || game.pendingShot || game.pendingState || (game.specQ && game.specQ.length)));
    const tableOf = p => p.evaluate(() => ({ cur: game.cur, turnSeat: game.net.spec ? game.cur : seatOf(game.cur), balls: game.balls.map(b => [b.n, +b.x.toFixed(1), +b.y.toFixed(1), b.out ? 1 : 0]) }));
    let made = 0;
    for (let k = 0; k < opt.shots; k++) {
      if (opt.late && k === 2 && !late) { late = { nm: "late", p: await watch("WatcherLate", room, false) }; watchers.push(late); await sleep(500); }
      let me = null;
      for (let i = 0; i < 240 && !me; i++) { const r = await Promise.all([A, B].map(p => p.evaluate(() => ({ ctl: canControl(), busy: !!(game.moving || game.strike || game.pendingShot || game.pendingState) })))); if (r[0].ctl && !r[0].busy) me = A; else if (r[1].ctl && !r[1].busy) me = B; else await sleep(250); }
      if (!me) { ok(false, "somebody can shoot (shot " + (k + 1) + ")"); break; }
      await sleep(500 + Math.random() * 700);
      await me.evaluate(pw => { const G = game, c = G.balls[0]; const ts = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== "gold"); const t = ts[(Math.random() * ts.length) | 0]; G.angle = Math.atan2(t.y - c.y, t.x - c.x) + (Math.random() - 0.5) * 0.08; G.elev = 0; G.spin = { x: (Math.random() - 0.5) * 0.3, y: (Math.random() - 0.5) * 0.3 }; requestShot(pw); }, 0.2 + Math.random() * 0.35);
      made++;
      await sleep(1200);
      for (let i = 0; i < 200; i++) { const r = await Promise.all([A, B].map(settle)); if (!r[0] && !r[1]) break; await sleep(250); }
      // the watchers must reach the players' table (a slow one needs longer: it is still playing the balls)
      const ta = await tableOf(A), tb = await tableOf(B);
      let dAB = 0; ta.balls.forEach((x, i) => { const y = tb.balls[i]; if (!x[3] && !y[3]) dAB = Math.max(dAB, Math.hypot(x[1] - y[1], x[2] - y[2])); });
      ok(dAB < 0.5, `shot ${k + 1}: the two players have the same table`, dAB);
      if (!opt.slow || k === opt.shots - 1) for (const w of watchers) {   // (a slow watcher is not waited for between the shots: the next shot must come in while he is still rolling the balls of the last one)
        let d = 99, tw = null;
        for (let i = 0; i < (opt.slow ? 400 : 60); i++) {
          if (await settle(w.p)) { await sleep(300); continue; }
          tw = await tableOf(w.p); d = 0; ta.balls.forEach((x, j) => { const y = tw.balls[j]; if (!y || !!x[3] !== !!y[3]) d = 999; else if (!x[3]) d = Math.max(d, Math.hypot(x[1] - y[1], x[2] - y[2])); });
          if (d < 0.5) break; await sleep(300);
        }
        ok(d < 0.5, `shot ${k + 1}: the ${w.nm} watcher's table is the players' table (max diff ${d.toFixed ? d.toFixed(1) : d} px)`, d);
        ok(tw && tw.turnSeat === ta.turnSeat, `shot ${k + 1}: the ${w.nm} watcher sees the real turn`, [tw && tw.turnSeat, ta.turnSeat]);
      }
    }
    // every shot was played on the watcher's own screen (a late one only the ones after it came in)
    for (const w of watchers) { const n = await w.p.evaluate(() => window.__rs); const want = w.nm === "late" ? made - 2 : made; ok(n >= want, `the ${w.nm} watcher played every shot on his screen (${n} of ${want})`, n); }
    if (opt.slow) { const busy = await watchers[0].p.evaluate(() => window.__busy); ok(busy >= 1, "the slow watcher really had a shot arrive while the previous one was still rolling (" + busy + " times): that path was tested", busy); }
    // the turn clock ring runs for a watcher: it goes down while the player thinks
    const W0 = watchers[0].p;
    for (let i = 0; i < 80 && (await settle(W0)); i++) await sleep(250);
    await sleep(600);
    const f1 = await W0.evaluate(() => window.__frac.slice(-1)[0]); await sleep(2500); const f2 = await W0.evaluate(() => window.__frac.slice(-1)[0]);
    ok(f1 > 0 && f1 < 1 && f2 < f1, "the turn clock ring goes down for a watcher (ring " + f1 + " -> " + f2 + ")", [f1, f2]);
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
}
(async () => {
  if (MODE !== "slow") { console.log("-- normal watchers (one from the start, one coming in late)"); await scenario("normal", 8672, { shots: 6, late: true, slow: false }); }
  if (MODE !== "normal") { console.log("-- a watcher whose screen plays the balls 3x too slowly"); await scenario("slow", 8673, { shots: 4, late: false, slow: true }); }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
