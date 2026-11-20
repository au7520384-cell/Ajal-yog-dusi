#!/usr/bin/env node
// Google Play Age Signals in the ANDROID APP, seen from the page (the Java side: bash tools/test_age_plugin.sh): the real server + a browser with a fake plugin "RbAge":  node tools/test_age_app.js
// Checks: outside the app nothing is asked; in the app the page asks once when the menu is up (never during a match, never twice at once), keeps the answer only in window.__AGE on the phone (it is NOT sent anywhere),
// turns the range into child / teen / adult / unknown, survives a plugin that fails or throws, and changes nothing in the game.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8667;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8age-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" });
  await sleep(2800);
  const b = await chromium.launch(), errs = [], reqs = [];
  const phone = async (app, answer) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    p.on("request", r => reqs.push({ u: r.url(), d: r.postData() || "" }));
    await p.addInitScript(([app, answer]) => {
      const A = window.__ageCalls = { n: 0, answer };
      const rb = { async check() { A.n++; const a = A.answer; if (a === "throw") throw new Error("boom"); if (a === "hang") return new Promise(() => {}); return a; } };
      if (app) window.Capacitor = { isNativePlatform: () => true, Plugins: { RbAge: rb, Browser: { async open() {}, async close() {}, async addListener() { return { remove() {} }; } } } };
      if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000 }));
    }, [app, answer]);
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1200);
    return p;
  };
  const AGE = p => p.evaluate(() => window.__AGE);
  const calls = p => p.evaluate(() => window.__ageCalls.n);
  try {
    // ---- 1) a browser / Telegram / portal: no plugin, nothing is asked, nothing is kept
    let p = await phone(false, { status: "shared", ageLower: 13, ageUpper: 15 }); await sleep(9500);
    ok(await AGE(p) === null && await p.evaluate(() => ageBand()) === "unknown", "outside the app: no age check, __AGE stays empty");
    await p.context().close();

    // ---- 2) the app, a teen who shares the range
    p = await phone(true, { status: "shared", ageLower: 13, ageUpper: 15 });
    ok(await calls(p) <= 1, "the check does not start before the menu has been up for a while", await calls(p));
    await sleep(9500);
    let a = await AGE(p);
    ok(await calls(p) === 1 && a && a.status === "shared" && a.lo === 13 && a.hi === 15 && a.band === "teen" && typeof a.at === "number", "the app asked Play once; 13-15 is kept as a teen", { a, n: await calls(p) });
    // the answer stays on the phone: no request mentions it
    await p.evaluate(() => { go("settingsScr"); }); await sleep(1500); await p.evaluate(() => { go("home"); }); await sleep(800);
    ok(reqs.length > 3 && reqs.some(r => r.u.startsWith(`http://localhost:${P}/api/`)), "(the page did talk to the server while we watched)", reqs.length);
    ok(!reqs.some(r => /ageLower|ageUpper|__AGE|"band"|age_?signals/i.test(r.u + r.d)), "nothing about the age range was sent to any server", reqs.filter(r => /age/i.test(r.u + r.d)).slice(0, 3));
    ok(await p.evaluate(() => !JSON.stringify(profile).match(/ageLower|"band"|__AGE/)) && await p.evaluate(() => !(localStorage.getItem("billiard8v2") || "").match(/ageLower|"band"|__AGE/)), "…and it is not saved in the profile either");

    // ---- 3) the bands
    const bands = await p.evaluate(() => {
      const t = (status, lo, hi) => { window.__AGE = { status, lo, hi, at: 0 }; return ageBand(); };
      return { child: t("shared", 0, 12), teen1: t("shared", 13, 15), teen2: t("shared", 16, 17), adult: t("shared", 18, null), custom1: t("shared", 13, null), custom2: t("shared", 0, 17), ns: t("not_shared", null, null), vr: t("verification_required", null, null), err: t("error", null, null), noLo: t("shared", null, 15), none: (window.__AGE = null, ageBand()) };
    });
    ok(bands.child === "child" && bands.teen1 === "teen" && bands.teen2 === "teen" && bands.adult === "adult", "0-12 child, 13-15 and 16-17 teen, 18+ adult", bands);
    ok(bands.custom1 === "unknown" && bands.ns === "unknown" && bands.vr === "unknown" && bands.err === "unknown" && bands.noLo === "unknown" && bands.none === "unknown" && bands.custom2 === "teen", "not shared / verification / error / unclear custom range -> unknown (never guessed)", bands);

    // ---- 4) never in the middle of a match, never two at once
    const n0 = await calls(p);
    await p.evaluate(() => { window.__AGE = null; mode = "play"; ageSoon(); ageSoon(); }); await sleep(300);
    ok(await calls(p) === n0 && await p.evaluate(() => ageWait === true), "during a match the check waits", { n: await calls(p), n0 });
    await p.evaluate(() => { mode = "menu"; ageSoon(); ageSoon(); ageSoon(); }); await sleep(400);
    ok(await calls(p) === n0 + 1, "back in the menu it asks once (three quick calls = one)", { n: await calls(p), n0 });
    // the app comes back to the front after hours: asked again; after a minute: not
    await p.evaluate(() => { window.__AGE.at = Date.now() - 7 * 3600 * 1000; document.dispatchEvent(new Event("visibilitychange")); }); await sleep(400);
    ok(await calls(p) === n0 + 2, "coming back to the app after more than 6 hours asks again", await calls(p));
    await p.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); }); await sleep(400);
    ok(await calls(p) === n0 + 2, "coming back within 6 hours does not", await calls(p));
    await p.context().close();

    // ---- 5) other answers
    for (const [ans, st, band] of [[{ status: "not_shared" }, "not_shared", "unknown"], [{ status: "verification_required" }, "verification_required", "unknown"], [{ status: "shared", ageLower: 18 }, "shared", "adult"], [{ status: "shared", ageLower: 0, ageUpper: 12 }, "shared", "child"], [{ status: "error", error: "timeout" }, "error", "unknown"], ["throw", "error", "unknown"], [null, "error", "unknown"]]) {
      p = await phone(true, ans); await sleep(9500);
      a = await AGE(p);
      ok(a && a.status === st && a.band === band && a.lo === (ans && ans.ageLower != null ? ans.ageLower : null), "answer " + JSON.stringify(ans) + " -> " + st + " / " + band, a);
      await p.context().close();
    }
    // a plugin that never answers: no second call piles up and the page keeps working
    p = await phone(true, "hang"); await sleep(9500);
    await p.evaluate(() => { ageSoon(); ageSoon(); }); await sleep(300);
    ok(await calls(p) === 1 && await AGE(p) === null && await p.evaluate(() => !!document.getElementById("home")), "a check that never answers is not repeated and does not freeze the game", await calls(p));
    ok(errs.length === 0, "no page errors", errs);
    await p.context().close();
  } finally { srv.kill(); await b.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("pass " + pass + ", fail " + fail); process.exit(fail ? 1 : 0);
})();
