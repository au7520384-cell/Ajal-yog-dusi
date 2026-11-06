#!/usr/bin/env node
// The opponent must see my cue and how I hold it:  node tools/test_cue_sync.js   (B8_ROOT=<repo copy>)
// Two players in a lobby; the guest equips ANOTHER cue after joining (the lobby used to keep the cue he joined with) and, in the match, raises the butt (the elevation slider) while aiming.
// Checks: the host's game shows the guest's new cue; the guest's elevation and hit point reach the host while he aims and with his shot.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cs-")), P = 8595, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch(), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
      await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500); return p;
    };
    const A = await mk("Host"), B = await mk("Guest");
    await A.evaluate(() => lobbyCreate(CITIES[0].id, [])); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
    const code = await A.evaluate(() => LB.code); await B.evaluate(c => lobbyJoin(c), code);
    await B.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); await A.waitForFunction(() => LB && LB.players.length === 2, null, { timeout: 30000 });
    // the guest gets another cue AFTER he is in the lobby
    const cue = await B.evaluate(() => { const c = CUES.find(q => q.id !== profile.cue && q.id !== "start" && q.cat !== "vip") || CUES[5]; profile.cues = (profile.cues || []).concat(c.id); profile.cue = c.id; save(); return c.id; });
    await sleep(2500);   // the page tells the server within a couple of seconds
    await A.evaluate(() => Net.send({ t: "start" }));
    const wait = p => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.over && mode === "game" && canControl !== undefined; }, null, { timeout: 60000 });
    await Promise.all([wait(A), wait(B)]);
    const seen = await A.evaluate(() => game.players[1].cue); ok(seen === cue, "the host's game shows the cue the guest equipped after joining the lobby", { seen, cue });
    // whose turn is it? the player who has it raises the butt and aims; the other one must see the same
    const turn = async () => { for (let i = 0; i < 120; i++) { const [a, c] = await Promise.all([A, B].map(p => p.evaluate(() => ({ ctl: canControl(), cur: game.cur, busy: !!(game.moving || game.strike) })))); if (a.ctl && a.cur === 0 && !a.busy) return [A, B]; if (c.ctl && c.cur === 0 && !c.busy) return [B, A]; await sleep(300); } return null; };
    const t = await turn(); ok(!!t, "someone can aim");
    if (t) {
      const [me, other] = t;
      await me.evaluate(() => { const G = game, c = G.balls[0], ts = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== "gold"); G.angle = Math.atan2(ts[0].y - c.y, ts[0].x - c.x); G.elev = 0.6; G.spin = { x: 0.3, y: -0.2 }; input.power = 0.05; });
      await sleep(900);
      const o = await other.evaluate(() => ({ e: game.elev, sx: game.spin.x, sy: game.spin.y, cur: game.cur }));
      ok(o.cur === 1 && Math.abs(o.e - 0.6) < 0.02, "the opponent sees the cue raised while I aim", o);
      ok(Math.abs(o.sx - 0.3) < 0.02 && Math.abs(o.sy + 0.2) < 0.02, "and the point where I hit the ball", o);
      await me.evaluate(() => requestShot(0.4)); await sleep(700);
      ok(await other.evaluate(() => Math.abs(game.elev - 0.6) < 0.02), "the raised cue stays while the shot is played");
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
