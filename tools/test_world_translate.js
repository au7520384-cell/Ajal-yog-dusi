#!/usr/bin/env node
// World chat translation (the owner's idea, Nov 16: "a player writes in English, I am Japanese: I press translate and it turns into my language"; only the world chat):  node tools/test_world_translate.js   (B8_ROOT=<repo copy>)
// Real server + real Chromium phones + a MOCK Google Translate (the real service needs the owner's key: GOOGLE_TRANSLATE_KEY on Render, never in chat; so the real translation is checked by the owner on his phone):
//  - no key on the server: no "Translate" button, the endpoint says "off"
//  - with a key: another player's text line has a button, a sticker and my own lines do not; pressing it shows the translation under the line, in MY game language (the request carries the target language and the key in a header, not in the URL)
//  - the same line for the same language is asked from Google once (cache); a line already in my language says so; a failure shows "not available" and the button comes back; a dead line id is "gone"
//  - the daily character budget and the per-player rate stop the calls (Google is not asked), the room never breaks
const { chromium } = require("playwright"), { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8737, MP = P + 1, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const calls = []; let failNext = false;
  const mock = http.createServer((q, s) => { let d = ""; q.on("data", c => d += c); q.on("end", () => { const b = JSON.parse(d || "{}"); calls.push({ key: q.headers["x-goog-api-key"], url: q.url, ...b });
    if (failNext) { failNext = false; s.writeHead(500); return s.end("{}"); }
    const src = /^Salom/.test(b.q) ? "uz" : /^Hello|^English/.test(b.q) ? "en" : "ru";
    s.writeHead(200, { "Content-Type": "application/json" }); s.end(JSON.stringify({ data: { translations: [{ translatedText: `[${b.target}] ${b.q}`, detectedSourceLanguage: src }] } })); }); });
  await new Promise(r => mock.listen(MP, r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wt-")); let srv;
  const start = async env => { if (srv) { srv.kill("SIGTERM"); await sleep(900); } fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, ...env }, stdio: "ignore" }); await sleep(2500); };
  const b = await chromium.launch(), errs = [];
  const mk = async (name, lang) => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(([n, l]) => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); localStorage.setItem("b8guest", "1"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: l, genderAsked: true, gender: "m", coins: 5000 })); }, [name, lang]);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); try { vipShownSession = true; } catch (e) {} }); await sleep(600); return p;
  };
  const open = async p => { await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); const w = document.getElementById("wChat"); if (!w.classList.contains("on")) document.getElementById("hWorld").click(); }); await sleep(1200); };
  const say = (p, t) => p.evaluate(t => Net.api("/api/world/send", { text: t }).then(() => "ok", e => e.message), t);
  const until = async (fn, to = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(300); } return false; };
  const lines = p => p.evaluate(() => [...document.querySelectorAll("#wChatLog .wcm")].map(r => ({ id: +r.dataset.id, me: r.classList.contains("me"), text: (r.querySelector(".wcx") || {}).textContent || "", btn: !!r.querySelector("[data-tr]"), tr: (r.querySelector(".wctt") || {}).textContent || "" })));
  const api = (p, url, body) => p.evaluate(([u, bd]) => Net.api(u, bd).then(r => ({ ok: true, r }), e => ({ ok: false, e: e.message })), [url, body]);
  try {
    // ---------- no key
    await start({});
    let A = await mk("Haruto", "ja"), B = await mk("Bob", "en");
    await say(B, "Hello friends"); await open(A);
    ok(await until(async () => (await lines(A)).some(l => /Hello friends/.test(l.text))), "(the line arrives)");
    ok((await lines(A)).every(l => !l.btn), "no key on the server: there is no Translate button");
    const off = await api(A, "/api/world/translate", { id: 1, to: "ja" }); ok(!off.ok && /off/.test(off.e), "...and the endpoint says off", off);
    await A.context().close(); await B.context().close();
    // ---------- with a key (a small daily budget: 120 characters)
    await start({ GOOGLE_TRANSLATE_KEY: "test-key-123", TRANSLATE_URL: `http://localhost:${MP}/v2`, TRANSLATE_DAILY_CHARS: "120" });
    A = await mk("Haruto", "ja"); B = await mk("Bob", "en"); const C = await mk("Eng", "en");
    await say(B, "Hello friends"); await open(A); await open(B); await open(C);
    ok(await until(async () => (await lines(A)).some(l => /Hello friends/.test(l.text))), "(the line arrives)");
    let la = await lines(A), line = la.find(l => /Hello friends/.test(l.text));
    ok(line && line.btn, "another player's text line has a Translate button");
    ok((await lines(B)).filter(l => /Hello/.test(l.text)).every(l => !l.btn), "my own line has none");
    const label = await A.evaluate(() => document.querySelector("#wChatLog [data-tr]").textContent.trim()); ok(/翻訳/.test(label), "the button speaks my language (Japanese)", label);
    await A.click(`#wChatLog [data-tr="${line.id}"]`);
    ok(await until(async () => (await lines(A)).some(l => /\[ja\] Hello friends/.test(l.tr))), "pressing it shows the translation under the line, in my game language (target ja)", await lines(A));
    if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); await A.screenshot({ path: path.join(process.env.SHOT, "translate_ja.png") }); }
    ok(calls.length === 1 && calls[0].key === "test-key-123" && calls[0].target === "ja" && calls[0].q === "Hello friends" && !/key=/.test(calls[0].url), "Google got the text, target ja and the key in a header (not in the URL)", calls[0]);
    ok(!(await lines(A)).find(l => l.id === line.id).btn, "the button is replaced by the translation (it stays after the room refreshes)");
    // the same line, same language, another player: from the cache
    await say(C, "x1"); await sleep(300);
    const again = await api(B, "/api/world/translate", { id: line.id, to: "ja" }); ok(again.ok && /\[ja\]/.test(again.r.t) && calls.length === 1, "the same line in the same language is not asked from Google again (cache)", { again, n: calls.length });
    // already in my language
    const same = await api(B, "/api/world/translate", { id: line.id, to: "en" }); ok(same.ok && same.r.same === true, "a line already in my language says so", same);
    await sleep(3200); await say(B, "Salom hammaga"); await until(async () => (await lines(C)).some(l => /Salom/.test(l.text)));
    const sal = (await lines(C)).find(l => /Salom/.test(l.text)); await C.click(`#wChatLog [data-tr="${sal.id}"]`);
    ok(await until(async () => (await lines(C)).some(l => /\[en\] Salom/.test(l.tr))), "an Uzbek line is translated for an English reader");
    // sticker / dead id / bad language
    const gone = await api(A, "/api/world/translate", { id: 99999, to: "ja" }); ok(!gone.ok && /gone/.test(gone.e), "a line that is gone is 'gone'", gone);
    const bad = await api(A, "/api/world/translate", { id: line.id, to: "xx" }); ok(!bad.ok && /bad/.test(bad.e), "an unknown language is refused", bad);
    // failure: the button comes back
    await sleep(3200); await say(B, "English again please"); await until(async () => (await lines(A)).some(l => /English again/.test(l.text)));
    const ag = (await lines(A)).find(l => /English again/.test(l.text)); failNext = true; await A.click(`#wChatLog [data-tr="${ag.id}"]`);
    ok(await until(async () => (await A.evaluate(id => (document.querySelector(`.wcm[data-id="${id}"] .wctt`) || {}).textContent || "", ag.id)).length > 0), "a Google failure shows 'not available'");
    ok(await until(async () => (await lines(A)).find(l => l.id === ag.id).btn, 7000), "...and the button comes back a few seconds later");
    // budget: 120 chars a day; used so far 13 (ja) + 13 (en check) + 13 (uz line) = 39 (the failed call is given back): a 68-character line fits once, the second language goes over
    const used0 = calls.length; await sleep(3200); await say(B, "English " + "long ".repeat(12)); await until(async () => (await lines(A)).some(l => /English long/.test(l.text)));
    const lg = (await lines(A)).find(l => /English long/.test(l.text)); await api(A, "/api/world/translate", { id: lg.id, to: "ja" });
    const lim = await api(C, "/api/world/translate", { id: lg.id, to: "de" });
    ok(!lim.ok && /limit/.test(lim.e) && calls.length === used0 + 1, "the daily character budget stops the calls (Google is asked no more)", { lim, calls: calls.length - used0 });
    ok((await lines(A)).length > 3, "the room still works");
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
  } finally { await b.close(); if (srv) srv.kill("SIGTERM"); mock.close(); await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { require("child_process").execSync("pkill -f 'server/server.js' || true"); } catch (x) {} process.exit(1); });
