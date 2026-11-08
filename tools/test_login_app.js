#!/usr/bin/env node
// Google / Facebook sign-in INSIDE THE ANDROID APP (a Capacitor WebView):  node tools/test_login_app.js   (B8_ROOT=<repo copy>)
// Both refuse to sign players in inside an app's embedded WebView, so in the app the buttons open the phone's own browser (the Capacitor Browser plugin = a Chrome tab) and the page where that tab ends hands the token back through the
// server. Here the app is a normal Chromium page with a fake window.Capacitor (isNativePlatform + a Browser plugin that only records the address), a second page plays "the phone's browser" and opens /auth/done the way Google /
// Facebook would send it, and fake token checkers stand in for Google's tokeninfo and Facebook's Graph API. Checks: the app never loads Google's / Facebook's web scripts, the button opens /auth/<provider>/start with a state and a
// challenge, the real /auth/done page hands the token over, the app logs in with it (screen closes, account linked), a cancelled sign-in is reported and can be tried again, a closed browser tab stops the waiting.
const { chromium } = require("playwright"), { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8la-")), P = 8621, PG = 8622, PF = 8623, base = `http://localhost:${P}`, errs = [];
  const fakeG = http.createServer((q, r) => { const t = new URL(q.url, "http://x").searchParams.get("id_token") || "", [k, sub, nonce] = t.split("|"); r.writeHead(k === "g" ? 200 : 400, { "content-type": "application/json" });
    r.end(JSON.stringify(k === "g" ? { aud: "gcid", iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 3600), sub, given_name: "Gina", nonce } : { error: "invalid_token" })); });
  const fakeF = http.createServer((q, r) => { const u = new URL(q.url, "http://x"), t = u.searchParams.get("input_token") || ""; r.writeHead(200, { "content-type": "application/json" });
    r.end(JSON.stringify(u.pathname === "/debug_token" ? { data: { is_valid: t.startsWith("fb-good"), app_id: "fbid", user_id: "fbuser-" + t } } : { first_name: "Fiona" })); });
  await Promise.all([new Promise(r => fakeG.listen(PG, r)), new Promise(r => fakeF.listen(PF, r))]);
  const env = { ...process.env, PORT: String(P), DATA_DIR: tmp, APP_URL: base, GOOGLE_CLIENT_ID: "gcid", FACEBOOK_BUTTON: "1", FACEBOOK_APP_ID: "fbid", FACEBOOK_APP_SECRET: "fbsecret", GOOGLE_TOKENINFO_URL: `http://localhost:${PG}/tokeninfo`, FB_GRAPH_URL: `http://localhost:${PF}` };
  delete env.RENDER_EXTERNAL_URL;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env, stdio: "ignore" }); await sleep(2800);
  try {
    const b = await chromium.launch();
    // the app: a fresh install with the sign-in screen up, window.Capacitor faked
    const openApp = async () => {
      const ctx = await b.newContext({ viewport: { width: 870, height: 393 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: "uz-UZ" }), p = await ctx.newPage(), seen = { gsi: 0, fb: 0, claims: 0, begins: 0 };
      p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
      p.on("request", r => { const u = r.url(); if (/accounts\.google\.com\/gsi/.test(u)) seen.gsi++; if (/connect\.facebook\.net/.test(u)) seen.fb++; if (/\/api\/auth\/claim/.test(u)) seen.claims++; if (/\/api\/auth\/begin/.test(u)) seen.begins++; });
      await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
      await p.addInitScript(() => {
        localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 0, lang: "uz", genderAsked: true, gender: "m", coins: 1500 }));
        window.__opened = []; window.__lis = {};
        window.Capacitor = { isNativePlatform: () => true, Plugins: { Browser: { async open(o) { window.__opened.push(o.url); }, async close() { window.__closed = (window.__closed || 0) + 1; }, async addListener(ev, fn) { window.__lis[ev] = fn; return { remove() { delete window.__lis[ev]; } }; } } } };
      });
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
      await p.waitForFunction(() => document.querySelector("#lsGw.on") && !document.getElementById("fbBtn").disabled, null, { timeout: 30000 }); await sleep(300);
      return { p, ctx, seen };
    };
    // the phone's browser: opens the page the sign-in ends on, the way Google (fragment) / Facebook (fragment, or ?error=) send the player back
    const browserDone = async (ctx, hash) => { const q = await ctx.newPage(); await q.route(/^https?:\/\/(?!localhost)/, r => r.abort()); await q.goto(base + "/auth/done" + hash, { waitUntil: "load" }).catch(() => {});
      await q.waitForFunction(() => document.getElementById("i").textContent !== "⏳", null, { timeout: 15000 }).catch(() => {}); const r = { icon: await q.textContent("#i"), back: await q.evaluate(() => { const a = document.getElementById("a"); return !a.hidden && a.getAttribute("href"); }), url: q.url() }; await q.close(); return r; };
    const stateOf = url => { const u = new URL(url); return { s: u.searchParams.get("s"), path: u.pathname, q: u.search }; };
    const gone = p => p.waitForFunction(() => !document.getElementById("loginSplash"), null, { timeout: 20000 }).then(() => true).catch(() => false);

    // 1) Google: the whole round
    { const { p, ctx, seen } = await openApp();
      ok(await p.evaluate(() => getComputedStyle(document.getElementById("gBtn")).display === "none"), "app: Google's own (web) button is not used - the picture-matching button itself is the button");
      await p.tap("#lsGw .lsBtn"); await sleep(500);
      const op = await p.evaluate(() => window.__opened); ok(op.length === 1, "app: tapping Google opens the browser once", op);
      const st = stateOf(op[0]); ok(op[0].startsWith(base + "/auth/google/start?") && /^[a-z0-9]{40}$/.test(st.s || ""), "app: it opens SERVER/auth/google/start?s=<state>", op[0]);
      ok(st.q === "?s=" + st.s, "app: only the state is in the address that opens in the browser (no challenge, no secret)", st.q); ok(seen.begins === 1, "app: the server was told about the sign-in first (/api/auth/begin)", seen.begins);
      await p.tap("#lsGw .lsBtn"); await sleep(300); ok((await p.evaluate(() => window.__opened)).length === 1, "app: a second tap while it waits does not open a second tab");
      ok((await p.evaluate(() => !!document.getElementById("loginSplash"))), "app: the sign-in screen waits while the browser works");
      await fetch(op[0], { redirect: "manual" });   // the browser's first step (the server remembers the request; Google's own page is out of reach here)
      const d = await browserDone(ctx, `#id_token=${encodeURIComponent(`g|gsub-1|${st.s}`)}&state=${st.s}`);
      ok(d.icon === "✅" && d.back === "royalbilliard8://auth", "the page the browser ends on: done, with a button back to the app (royalbilliard8://auth)", d);
      ok(!/id_token/.test(d.url), "the page removes the token from the address bar", d.url);
      ok(await gone(p), "app: the token arrives, the sign-in screen closes");
      await p.waitForFunction(() => profile.prov && profile.prov.google === 1, null, { timeout: 15000 }).catch(() => {});   // the screen closes first, the login call to the server follows
      const r = await p.evaluate(() => ({ prov: profile.prov, guest: store.get("b8guest"), acct: !!(Net.acct && Net.acct.id), closed: window.__closed || 0 }));
      ok(r.prov && r.prov.google === 1 && r.guest && r.acct, "app: the account is linked to Google and the game goes on", r); ok(r.closed >= 1, "app: the browser tab is asked to close", r);
      ok(seen.gsi === 0 && seen.fb === 0, "app: Google's / Facebook's web scripts were never loaded", seen);
      await ctx.close(); }

    // 2) Facebook: the whole round
    { const { p, ctx, seen } = await openApp();
      await p.tap("#fbBtn"); await sleep(500);
      const op = await p.evaluate(() => window.__opened), st = stateOf(op[0] || "http://x/");
      ok(op.length === 1 && st.path === "/auth/facebook/start", "app: tapping Facebook opens SERVER/auth/facebook/start", op);
      await fetch(op[0], { redirect: "manual" });
      const d = await browserDone(ctx, `#access_token=fb-good-9&data_access_expiration_time=1&expires_in=5000&state=${st.s}`); ok(d.icon === "✅", "facebook: the page the browser ends on is done", d);
      ok(await gone(p), "facebook: the sign-in screen closes");
      await p.waitForFunction(() => profile.prov && profile.prov.facebook === 1, null, { timeout: 15000 }).catch(() => {});
      const r = await p.evaluate(() => ({ prov: profile.prov, acct: !!(Net.acct && Net.acct.id) })); ok(r.prov && r.prov.facebook === 1 && r.acct, "facebook: the account is linked to Facebook", r);
      ok(seen.gsi === 0 && seen.fb === 0, "facebook: no web scripts loaded", seen);
      await ctx.close(); }

    // 3) cancelled at Google, then tried again
    { const { p, ctx } = await openApp();
      await p.tap("#lsGw .lsBtn"); await sleep(500); const st = stateOf((await p.evaluate(() => window.__opened))[0]); await fetch((await p.evaluate(() => window.__opened))[0], { redirect: "manual" });
      const d = await browserDone(ctx, `#error=access_denied&state=${st.s}`); ok(d.icon === "✖", "cancel: the page says so", d);
      await sleep(3500);
      ok(await p.evaluate(() => !!document.getElementById("loginSplash") && !profile.prov), "cancel: the sign-in screen stays, nothing is linked");
      await p.tap("#lsGw .lsBtn"); await sleep(500); ok((await p.evaluate(() => window.__opened)).length === 2, "cancel: the player can try again (a new tab)");
      await ctx.close(); }

    // 4) the player closes the browser tab without finishing: the app stops waiting (after a few seconds) and can be tried again
    { const { p, ctx, seen } = await openApp();
      await p.tap("#lsGw .lsBtn"); await sleep(2200); const n0 = seen.claims; ok(n0 >= 1, "waiting: the app asks the server every moment", n0);
      await p.evaluate(() => window.__lis.browserFinished && window.__lis.browserFinished()); await sleep(11000); const n1 = seen.claims; await sleep(4500);
      ok(seen.claims === n1, "closed tab: the app stops asking the server", { n1, now: seen.claims });
      await p.tap("#lsGw .lsBtn"); await sleep(500); ok((await p.evaluate(() => window.__opened)).length === 2, "closed tab: and the button works again");
      await ctx.close(); }

    // 5) the sign-in window of the settings (not the start screen) in the app: its Google button is an ordinary button that opens the browser
    { const { p, ctx } = await openApp();
      await p.tap("#lsGuest"); await sleep(600);
      await p.evaluate(() => loginUI(false, { google: "gcid", facebook: "fbid" })); await sleep(600);
      ok(await p.evaluate(() => !!document.getElementById("gAppBtn")), "settings window: the Google button is an ordinary button in the app");
      await p.tap("#gAppBtn"); await sleep(500); const op = await p.evaluate(() => window.__opened); ok(op.length === 1 && /\/auth\/google\/start\?/.test(op[0]), "settings window: it opens the browser sign-in", op);
      await p.tap("#fbBtn"); await sleep(300);   // (the first sign-in is still waiting: a second tab is not opened)
      ok((await p.evaluate(() => window.__opened)).length === 1, "settings window: a sign-in that is already waiting is not doubled");
      await ctx.close(); }
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); fakeG.close(); fakeF.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
