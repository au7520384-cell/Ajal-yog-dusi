#!/usr/bin/env node
// The cue on the table, the one in the power bar and the one on the picker button are the SAME cue (the player's equipped one, or the one being tried out), even when the match's own player record holds a stale copy:  node tools/test_cue_same.js
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8666;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cs-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => localStorage.getItem("billiard8v2") || localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 100000 })));
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1200);
    const ids = await p.evaluate(() => { const own = CUES.filter(c => c.id !== CUES[1].id && c.id !== CUES[0].id)[3], other = CUES.filter(c => c.id !== own.id && c.id !== CUES[1].id)[7]; profile.cues = [...new Set([...(profile.cues || []), own.id, other.id])]; profile.cue = own.id; return { own: own.id, other: other.id, def: CUES[1].id }; });
    await p.evaluate(() => { startMatch("ai", CITIES[0], botPlayer(1, 4)); }); await sleep(2500);
    await p.evaluate(() => { window.__seen = { table: new Set(), bar: new Set(), btn: new Set() }; const o = window.drawCueStick; window.__o = o; window.drawCueStick = function (g, L, cd, wm) { const k = L === 540 ? "table" : L === 420 ? "bar" : L === 38 ? "btn" : null; if (k) window.__seen[k].add(cd.id); return o.apply(this, arguments); }; });
    const run = async (label, want) => {
      await p.evaluate(() => { for (const k of Object.keys(__seen)) __seen[k].clear(); });
      await p.evaluate(() => { game.cur = game.players.findIndex(q => !q.isAI && !q.remote); });
      for (let i = 0; i < 30; i++) { await sleep(250); if (await p.evaluate(() => __seen.table.size > 0 && __seen.bar.size > 0)) break; }   // (wait for a frame in which the stick is really drawn: not while balls roll)
      await sleep(300);
      const s = await p.evaluate(() => ({ table: [...__seen.table], bar: [...__seen.bar], btn: [...__seen.btn] }));
      ok(s.table.length === 1 && s.table[0] === want && s.bar.length === 1 && s.bar[0] === want, label + ": the cue on the table and the one in the power bar are both " + want, s);
      ok(s.btn.includes(want), label + ": the picker button shows it too", s.btn);
    };
    await run("normal", ids.own);
    // a stale copy in the match's player record (the equipped cue changed after the match began / a late cloud save)
    await p.evaluate(d => { game.players.find(q => !q.isAI && !q.remote).cue = d; }, ids.def);
    await run("stale player record", ids.own);
    // trying a cue out: the table, the bar and the button all show the tried one
    await p.evaluate(o => { game.trialCue = o; }, ids.other);
    await run("trial", ids.other);
    await p.evaluate(() => { game.trialCue = null; });
    // the bot keeps its own cue (never the player's)
    await p.evaluate(() => { game.cur = game.players.findIndex(q => q.isAI); window.__seen.table.clear(); });
    for (let i = 0; i < 30; i++) { await sleep(250); if (await p.evaluate(() => __seen.table.size > 0)) break; }
    const bot = await p.evaluate(() => ({ seen: [...__seen.table], bot: game.players.find(q => q.isAI).cue }));
    ok(bot.seen.every(x => x === bot.bot), "the bot's turn draws the bot's own cue", bot);
    // a SPECTATOR (live match of two other players): the table, the power bar and the picker button all show the cue of the player who is shooting, never the cue the spectator owns
    await p.evaluate(() => { toMenu && toMenu(); }); await sleep(800);
    const sp = await p.evaluate(() => { const own = profile.cue, c1 = CUES.find(c => c.id !== own && c.id !== "start"), c2 = CUES.find(c => c.id !== own && c.id !== c1.id && c.id !== "start"); return { own, c1: c1.id, c2: c2.id }; });
    await p.evaluate(m => { startSpectate({ ...m, city: CITIES[0].id }); }, { room: "r1", seed: 7, first: 0, specs: 1, list: [], log: [], p: [{ name: "A", avatar: 1, cue: sp.c1 }, { name: "B", avatar: 2, cue: sp.c2 }] }); await sleep(2500);
    await p.evaluate(() => { window.__seen = { table: new Set(), bar: new Set(), btn: new Set() }; });
    for (const [cur, want] of [[0, sp.c1], [1, sp.c2]]) {
      await p.evaluate(c => { game.cur = c; game.moving = false; for (const k of Object.keys(__seen)) __seen[k].clear(); }, cur);
      for (let i = 0; i < 30; i++) { await sleep(250); if (await p.evaluate(() => __seen.table.size > 0 && __seen.bar.size > 0)) break; }
      await sleep(300);
      const t = await p.evaluate(() => ({ table: [...__seen.table], bar: [...__seen.bar], btn: [...__seen.btn] }));
      ok(t.table.length === 1 && t.table[0] === want && t.bar.length === 1 && t.bar[0] === want, "spectator, player " + cur + " shoots: the table and the power bar both show his cue " + want + " (not the spectator's " + sp.own + ")", t);
      ok(t.btn.includes(want) && !t.btn.includes(sp.own), "spectator: the picker button shows the shooter's cue, not the spectator's " + sp.own, t.btn);
    }
    ok(errs.length === 0, "no page errors", errs);
  } finally { srv.kill(); await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("pass " + pass + ", fail " + fail); process.exit(fail ? 1 : 0);
})();
