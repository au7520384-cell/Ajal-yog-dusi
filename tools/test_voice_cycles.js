#!/usr/bin/env node
// Voice through many matches:  node tools/test_voice_cycles.js   (B8_ROOT=<repo copy>, CYCLES=16)
// The owner: "after ~15 games the voice in the lobby stopped coming", "the microphone asks for permission again and again" and
// "if listening is on I must hear the opponent even without my own microphone; with listening off nothing is heard".
// Real Chromium browsers with a fake microphone.
//  Part 1 - listening: nobody has a microphone on; one player taps 🎤 in a match, the other one (speaker on) hears him at once, without a tap. Speaker off = muted, nothing joins. Speaker on again = joins and hears.
//  Part 2 - the lobby voice room through CYCLES matches in a row (it pauses around every match and comes back): connected both ways with audio flowing after EVERY match, in the matches the voice is on by itself,
//           and the browser is asked for the microphone ONCE (every later question is made to hang, like a phone that does not answer): a room that depends on a new question dies after the first match.
//  Part 3 - the choice is remembered: leave the lobby, open another one - the voice is on without a tap and without a new question.
//  Part 4 - no microphone permission at all (the browser says no): tapping 🎤 does not break anything, the player joins as a listener, nothing is saved, nothing is asked again in the next match.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), N = +process.env.CYCLES || 16;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8vc-")), P = +process.env.TEST_PORT || 8597, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] }), mk = async name => {
      const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US", permissions: ["microphone"] }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
      await p.addInitScript(n => {
        localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 }));
        window.__gum = 0; window.__gumHang = false; const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md); md.getUserMedia = c => { window.__gum++; return window.__gumHang ? new Promise(() => {}) : orig(c); };   // __gumHang: "the phone does not answer the question"
      }, name);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500); return p;
    };
    const lobbyOf = async (A, B) => {
      await A.evaluate(() => lobbyCreate(CITIES[0].id, [])); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 });
      const code = await A.evaluate(() => LB.code); await B.evaluate(c => lobbyJoin(c), code);
      await B.waitForFunction(() => LB && !LB.pending, null, { timeout: 60000 }); await A.waitForFunction(() => LB && LB.players.length === 2, null, { timeout: 30000 });
    };
    const startMatch = async (A, B, m) => {
      await A.evaluate(() => Net.send({ t: "start" }));
      try { await Promise.all([A, B].map(p => p.waitForFunction(() => { const G = typeof game !== "undefined" ? game : null; return G && G.net && !G.over && mode === "game"; }, null, { timeout: 40000 }))); }
      catch (e) { const s = await Promise.all([A, B].map(p => p.evaluate(() => ({ mode, lb: !!LB, queued: !!(LB && LB.queued), res: document.getElementById("res").classList.contains("on"), net: !!(typeof game !== "undefined" && game && game.net) })))); ok(false, `match ${m}: both phones start the match`, s); return false; }
      await sleep(700); return true;
    };
    const endMatch = async (A, B) => {   // the match ends the way a real one does: both phones call endGame (the host wins); the result screen comes up ~2 s later; "Continue" on both
      await A.evaluate(() => endGame(0, "test")); await B.evaluate(() => endGame(1, "test")); await sleep(2300);
      await Promise.all([A, B].map(p => p.evaluate(() => lbAfterMatch()))); await sleep(500);
    };
    const until = async (fn, to = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(400); } return false; };
    const vs = p => p.evaluate(() => Voice.state());
    const inFlow = async p => { const a = await p.evaluate(async () => (await Voice.stats()).inPackets); await sleep(1300); const c = await p.evaluate(async () => (await Voice.stats()).inPackets); return c - a; };
    const click = (p, id) => p.evaluate(i => document.getElementById(i).click(), id);

    // ---------------------------------------------------------------- part 1: listening
    {
      const A = await mk("Host1"), B = await mk("Guest1"); await lobbyOf(A, B);
      if (await startMatch(A, B, "L1")) {
        let [a, c] = [await vs(A), await vs(B)]; ok(!a.on && !c.on, "nobody has the voice on at the start (no saved microphone)", { a: a.on, b: c.on });
        await click(B, "gVoice");                                                                                             // B taps 🎤
        ok(await until(async () => { const s = await vs(A); return s.on && s.listenOnly && s.pcs === "connected"; }), "the opponent taps 🎤: my speaker is on, so I join as a listener by myself and the call connects", await vs(A));
        a = await vs(A); c = await vs(B);
        ok(a.on && a.listenOnly && !a.mic, "I am a listener: no microphone of my own", a); ok(c.on && !c.listenOnly && c.mic, "he talks with his microphone", c);
        ok((await inFlow(A)) > 5, "I hear him: audio packets arrive", await vs(A)); ok(a.audio && !a.paused && !a.elMuted, "the player is playing the sound (speaker on)", a);
        ok((await A.evaluate(() => window.__gum)) === 0, "I was never asked for a microphone", await A.evaluate(() => window.__gum));
        await click(A, "gSpk"); a = await vs(A); ok(a.spkOff && a.elMuted, "speaker off: the sound is muted, nothing is heard", a);
        await click(A, "gSpk"); a = await vs(A); ok(!a.spkOff && !a.elMuted, "speaker on again: heard again", a);
        await click(A, "gSpk");                                                                                               // speaker off for the next match
        await endMatch(A, B);
        if (await startMatch(A, B, "L2")) {                                                                                    // B's microphone is saved: his voice is on by itself
          ok(await until(async () => { const s = await vs(B); return s.on && !s.listenOnly; }, 15000), "his saved microphone starts by itself in the next match, no tap", await vs(B));
          await sleep(4000); a = await vs(A); ok(!a.on, "my speaker is off: I do not join, nothing is heard", a);
          await click(A, "gSpk");
          ok(await until(async () => { const s = await vs(A); return s.on && s.listenOnly && s.pcs === "connected"; }), "speaker on while he is talking: I join as a listener and the call connects", await vs(A));
          ok((await inFlow(A)) > 5, "I hear him", await vs(A));
        }
        ok((await B.evaluate(() => window.__gum)) <= 1, "his microphone was asked for once for two matches", await B.evaluate(() => window.__gum));
      }
      await A.context().close(); await B.context().close();
    }

    // ---------------------------------------------------------------- part 2: the lobby voice room through many matches
    const A = await mk("Host"), B = await mk("Guest"), both = [A, B]; await lobbyOf(A, B);
    await Promise.all(both.map(p => p.evaluate(() => LobbyVoice.micTap()))); await sleep(1500);
    const connected = async (to = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { const s = await Promise.all(both.map(p => p.evaluate(() => { const st = LobbyVoice.state(); return { want: st.want, susp: st.susp, pcs: Object.values(st.peers).map(x => x.pc) }; }))); if (s.every(x => x.want && !x.susp && x.pcs.length && x.pcs.every(c => c === "connected"))) return true; await sleep(500); } return false; };
    const flowing = async () => { const read = () => Promise.all(both.map(p => p.evaluate(async () => Object.values(await LobbyVoice.stats()).reduce((a, x) => a + x.in, 0)))); const a = await read(); await sleep(1200); const c = await read(); return a.map((x, i) => c[i] - x); };
    ok(await connected(), "the voice room connects before the first match");
    await Promise.all(both.map(p => p.evaluate(() => { window.__gumHang = true; })));   // from now on the phone "does not answer" a new microphone question
    let firstBad = 0, firstBadIn = 0, inMatch = 0;
    for (let m = 1; m <= N; m++) {
      if (!(await startMatch(A, B, m))) break;
      // in the match the voice is on by itself (the saved "microphone on") and the two phones are connected
      const live = await until(async () => { const s = await Promise.all(both.map(vs)); return s.every(x => x.on && !x.listenOnly && x.pcs === "connected"); }, 20000);
      if (live) inMatch++; else { if (!firstBadIn) firstBadIn = m; if (firstBadIn === m) console.log(`match ${m}: the in-match voice is not up on both phones:`, JSON.stringify(await Promise.all(both.map(vs)))); }
      await endMatch(A, B);
      const c = await connected(25000), f = c ? await flowing() : [0, 0];
      if (!(c && f.every(x => x > 5)) && !firstBad) firstBad = m;
      if (m % 4 === 0 || !c) console.log(`match ${m}: lobby room connected=${c}, audio packets in the last 1.2 s: ${f.join("/")}, voice on in the match: ${live}, microphone questions so far: ${(await Promise.all(both.map(p => p.evaluate(() => window.__gum)))).join("/")}`);
    }
    ok(!firstBad, "the lobby voice room is connected with audio flowing after every one of the matches", { firstBadMatch: firstBad });
    ok(!firstBadIn, "in every match the voice is on by itself and connected (no tap)", { firstBadMatch: firstBadIn, ok: inMatch });
    const gum = await Promise.all(both.map(p => p.evaluate(() => window.__gum)));
    ok(gum.every(x => x <= 1), "the microphone is asked for once, not again after every match", gum);

    // ---------------------------------------------------------------- part 3: the choice is remembered
    await Promise.all(both.map(p => p.evaluate(() => lbLeave(true)))); await sleep(800);
    await Promise.all(both.map(p => p.evaluate(() => { window.__gumHang = false; })));
    await lobbyOf(A, B);
    ok(await until(async () => { const s = await Promise.all(both.map(p => p.evaluate(() => LobbyVoice.state()))); return s.every(x => x.want && x.mic && !x.listenOnly && Object.values(x.peers).every(q => q.pc === "connected") && Object.keys(x.peers).length === 1); }, 30000), "in another lobby the voice room is on by itself (saved choice), connected, no tap", await Promise.all(both.map(p => p.evaluate(() => LobbyVoice.state()))));
    const gum2 = await Promise.all(both.map(p => p.evaluate(() => window.__gum)));
    ok(gum2.every(x => x <= 1), "and the microphone was not asked for again (it was kept open)", gum2);
    // the ✕ button = off for good: the next lobby does not switch it on
    await both[0].evaluate(() => document.getElementById("lbVoff").click()); await sleep(500);
    const off = await both[0].evaluate(() => ({ st: LobbyVoice.state(), mic: typeof MicHub !== "undefined" ? MicHub.mic() : null })); ok(!off.st.want && !off.mic, "✕ switches the voice off and it is remembered", off);
    // ---------------------------------------------------------------- part 4: the browser refuses the microphone
    {
      const nb = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });   // no fake-ui flag: a question for the microphone is answered "no"
      const mkWith = async (br, name) => {
        const ctx = await br.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage();
        p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
        await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000 })); window.__gum = 0; const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md); md.getUserMedia = c => { window.__gum++; return orig(c); }; }, name);
        await p.goto(base + "/", { waitUntil: "commit" });
        await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
        const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500); return p;
      };
      const A4 = await mkWith(nb, "Host4"), B4 = await mkWith(nb, "Guest4"); await lobbyOf(A4, B4);
      if (await startMatch(A4, B4, "R1")) {
        await click(A4, "gVoice");
        ok(await until(async () => { const s = await vs(A4); return s.on && s.listenOnly && !s.mic; }, 15000), "the microphone is refused: the player still joins, as a listener", await vs(A4));
        ok(await until(async () => { const s = await Promise.all([A4, B4].map(vs)); return s.every(x => x.on && x.pcs === "connected"); }, 25000), "and the call between the two connects", await Promise.all([A4, B4].map(vs)));
        ok(await A4.evaluate(() => MicHub.mic() === false), "a refused microphone is not saved as \"microphone on\"");
        await endMatch(A4, B4);
        if (await startMatch(A4, B4, "R2")) { await sleep(3500); const q = await vs(A4); ok(!q.on || q.listenOnly, "next match: no automatic microphone, no new question", q); ok((await A4.evaluate(() => window.__gum)) <= 1, "the browser was asked once", await A4.evaluate(() => window.__gum)); }
      }
      await nb.close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
