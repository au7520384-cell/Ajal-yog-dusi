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
      await p.evaluate(() => { game.cur = game.players.findIndex(q => !q.isAI && !q.remote); }); await sleep(900);
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
    await p.evaluate(() => { game.cur = game.players.findIndex(q => q.isAI); window.__seen.table.clear(); }); await sleep(800);
    const bot = await p.evaluate(() => ({ seen: [...__seen.table], bot: game.players.find(q => q.isAI).cue }));
    ok(bot.seen.every(x => x === bot.bot), "the bot's turn draws the bot's own cue", bot);
    ok(errs.length === 0, "no page errors", errs);
  } finally { srv.kill(); await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("pass " + pass + ", fail " + fail); process.exit(fail ? 1 : 0);
})();
