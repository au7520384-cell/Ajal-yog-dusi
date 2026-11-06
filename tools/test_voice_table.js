#!/usr/bin/env node
// Voice in ORDINARY online matches (a random table found by "O'YNASH", no lobby):  node tools/test_voice_table.js   (B8_ROOT=<repo copy>, MATCHES=4)
// The owner asked: "does this kind of error also not happen outside the lobby?" - the in-match voice is the same code for every online match, this proves it with two real
// Chromium browsers (fake microphone) that meet at a table the way two strangers do (playCity -> the server's queue), no lobby anywhere:
//  - nobody has the voice on at first; one player taps 🎤 -> the other one (speaker on, no microphone of his own) joins as a listener by himself and HEARS him (audio packets arrive);
//  - speaker off = muted; speaker on = heard again;
//  - in the next matches the first player's voice starts by itself (saved choice), and the browser is NOT asked for the microphone again - every further question is made to hang
//    (a phone that does not answer): the voice must still come up at every table, and the listener hears him at every table.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), N = +process.env.MATCHES || 4;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8vt-")), P = +process.env.TEST_PORT || 8603, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] }), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US", permissions: ["microphone"] }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
      await p.addInitScript(n => {
        localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 }));
        window.__gum = 0; window.__gumHang = false; const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md); md.getUserMedia = c => { window.__gum++; return window.__gumHang ? new Promise(() => {}) : orig(c); };
      }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500); return p;
    };
    const A = await mk("Alice"), B = await mk("Bob"), both = [A, B];
    const until = async (fn, to = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(400); } return false; };
    const vs = p => p.evaluate(() => Voice.state());
    const click = (p, id) => p.evaluate(i => document.getElementById(i).click(), id);
    const inFlow = async p => { const a = await p.evaluate(async () => (await Voice.stats()).inPackets); await sleep(1300); const c = await p.evaluate(async () => (await Voice.stats()).inPackets); return c - a; };
    const table = async m => {   // both players press "play" at the same table (the first city): the server pairs them, no lobby
      await Promise.all(both.map(p => p.evaluate(() => playCity(CITIES[0]))));
      try { await Promise.all(both.map(p => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.net.spec && !G.over && mode === "game" && !LB; }, null, { timeout: 70000 }))); }
      catch (e) { ok(false, `table ${m}: the two players meet at the table`, await Promise.all(both.map(p => p.evaluate(() => ({ mode, net: !!(typeof game !== "undefined" && game && game.net), lb: !!LB }))))); return false; }
      await sleep(900); return true;
    };
    const leave = async () => {   // the match ends the way a real one does, then both go back to the tables screen
      await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2500);
      await Promise.all(both.map(p => p.evaluate(() => toMenu("cities")))); await sleep(800);
    };
    for (let m = 1; m <= N; m++) {
      if (!(await table(m))) break;
      if (m === 1) {
        const [a, c] = await Promise.all(both.map(vs)); ok(!a.on && !c.on, "table 1: nobody has the voice on at the start", { a: a.on, b: c.on });
        await click(B, "gVoice");                                                                            // Bob taps 🎤
        ok(await until(async () => { const s = await vs(A); return s.on && s.listenOnly && s.pcs === "connected"; }), "table 1: Bob taps 🎤 - Alice (speaker on, no microphone) joins as a listener by herself", await vs(A));
        const s = await vs(A); ok(s.on && s.listenOnly && !s.mic, "Alice is a listener without a microphone", s);
        ok((await inFlow(A)) > 5, "Alice HEARS Bob (audio packets arrive)", await vs(A)); ok(s.audio && !s.paused && !s.elMuted, "and the sound is playing (speaker on)", s);
        ok((await A.evaluate(() => window.__gum)) === 0, "Alice was never asked for a microphone", await A.evaluate(() => window.__gum));
        await click(A, "gSpk"); let t = await vs(A); ok(t.spkOff && t.elMuted, "speaker off: muted, nothing is heard", t);
        await click(A, "gSpk"); t = await vs(A); ok(!t.spkOff && !t.elMuted, "speaker on again: heard again", t);
        await B.evaluate(() => { window.__gumHang = true; });                                                  // from now on Bob's phone "does not answer" a new microphone question
      } else {
        ok(await until(async () => { const s = await vs(B); return s.on && !s.listenOnly && s.mic; }, 20000), `table ${m}: Bob's voice starts by itself (saved choice), no tap, no new question`, await vs(B));
        ok(await until(async () => { const s = await Promise.all(both.map(vs)); return s.every(x => x.on && x.pcs === "connected"); }, 25000), `table ${m}: the call connects (Alice listens)`, await Promise.all(both.map(vs)));
        ok((await inFlow(A)) > 5, `table ${m}: Alice hears Bob`, await vs(A));
      }
      if (m < N) await leave();
    }
    const gum = await Promise.all(both.map(p => p.evaluate(() => window.__gum)));
    ok(gum[1] <= 1 && gum[0] === 0, "the microphone was asked for ONCE (Bob) and never for Alice, however many tables", gum);
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
