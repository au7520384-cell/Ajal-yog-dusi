#!/usr/bin/env node
// Sign-in through the phone's own browser (the Android app):  node server/test_auth_browser.js
// Google and Facebook refuse to sign players in inside an app's embedded WebView, so the app opens a browser tab: /auth/<provider>/start -> Google / Facebook -> /auth/done -> /api/auth/stash, and the app polls /api/auth/claim.
// Fake token checkers stand in for Google's tokeninfo and Facebook's Graph API (the server's GOOGLE_TOKENINFO_URL / FB_GRAPH_URL point at them). Checks: the start redirect goes to the right sign-in address (client id, OUR redirect
// address, state, nonce), bad requests are refused, the token the page hands over is verified (bad token / wrong nonce / wrong provider refused), the app gets it ONCE and only with its secret, a cancelled sign-in is reported,
// the token logs the player in through the normal /api/auth/login, /auth/done is a page that posts to /api/auth/stash, a provider the server has not set up is refused.
const { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const chOf = v => crypto.createHash("sha256").update(v).digest("base64url"), rnd = n => crypto.randomBytes(n).toString("hex").slice(0, n);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ab-")), tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "b8ab2-")), P = 8611, PG = 8612, PF = 8613, P2 = 8614, base = `http://localhost:${P}`;
  // fake Google tokeninfo: a token is "g|<sub>|<nonce>"; fake Facebook Graph: "fb-good-<n>" is valid
  const fakeG = http.createServer((q, r) => { const u = new URL(q.url, "http://x"), t = u.searchParams.get("id_token") || "", [k, sub, nonce] = t.split("|"); r.writeHead(k === "g" ? 200 : 400, { "content-type": "application/json" });
    r.end(JSON.stringify(k === "g" ? { aud: "gcid", iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 3600), sub, given_name: "Gina", nonce } : { error: "invalid_token" })); });
  const fakeF = http.createServer((q, r) => { const u = new URL(q.url, "http://x"), t = u.searchParams.get("input_token") || u.searchParams.get("access_token") || ""; r.writeHead(200, { "content-type": "application/json" });
    r.end(JSON.stringify(u.pathname === "/debug_token" ? { data: { is_valid: t.startsWith("fb-good"), app_id: "fbid", user_id: "fbuser-" + t } } : { first_name: "Fiona" })); });
  await Promise.all([new Promise(r => fakeG.listen(PG, r)), new Promise(r => fakeF.listen(PF, r))]);
  const env = { ...process.env, PORT: String(P), DATA_DIR: tmp, APP_URL: base, GOOGLE_CLIENT_ID: "gcid", FACEBOOK_BUTTON: "1", FACEBOOK_APP_ID: "fbid", FACEBOOK_APP_SECRET: "fbsecret", GOOGLE_TOKENINFO_URL: `http://localhost:${PG}/tokeninfo`, FB_GRAPH_URL: `http://localhost:${PF}` };
  delete env.RENDER_EXTERNAL_URL;
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env, stdio: "ignore" });
  const bare = spawn("node", [path.join(__dirname, "server.js")], { env: { ...env, PORT: String(P2), DATA_DIR: tmp2, GOOGLE_CLIENT_ID: "", FACEBOOK_APP_ID: "", FACEBOOK_APP_SECRET: "" }, stdio: "ignore" });
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "b8ab3-")), P3 = P2 + 7, envNoFb = { ...env, PORT: String(P3), DATA_DIR: tmp3 }; delete envNoFb.FACEBOOK_BUTTON;   // Facebook is set up on the server but its button is not switched on
  const nofb = spawn("node", [path.join(__dirname, "server.js")], { env: envNoFb, stdio: "ignore" });
  await sleep(2800);
  { const a = await (await fetch(base + "/api/auth/config")).json(), b = await (await fetch(`http://localhost:${P3}/api/auth/config`)).json();
    ok(a.facebook === "fbid" && a.google === "gcid", "config: with FACEBOOK_BUTTON=1 the Facebook button is offered", a);
    ok(b.facebook === "" && b.google === "gcid", "config: without FACEBOOK_BUTTON the Facebook button is hidden (Google stays), the Facebook sign-in itself stays set up", b); }
  const post = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { st: r.status, j: await r.json().catch(() => ({})) }; };
  const begin = async (prov, s, c, b = base) => { const r = await fetch(b + "/api/auth/begin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: prov, s, c }) }); return { st: r.status, j: await r.json().catch(() => ({})) }; };
  const start = async (prov, s, c, b = base) => { const b0 = await begin(prov, s, c, b), r = await fetch(`${b}/auth/${prov}/start?s=${s}`, { redirect: "manual" }); r.begun = b0; return r; };   // the app announces the sign-in first, then the browser opens the start address (only the state is in it)
  try {
    // 1) the start redirect
    { const s = rnd(40), v = rnd(48), r = await start("google", s, chOf(v)), loc = new URL(r.headers.get("location") || "http://none/");
      ok(r.status === 302 && loc.host === "accounts.google.com", "google start: redirects to Google", { st: r.status, loc: loc.href.slice(0, 80) });
      ok(loc.searchParams.get("client_id") === "gcid" && loc.searchParams.get("redirect_uri") === base + "/auth/done" && loc.searchParams.get("response_type") === "id_token", "google start: our client id, our /auth/done as the redirect address, an id_token answer", Object.fromEntries(loc.searchParams));
      ok(loc.searchParams.get("nonce") === s && loc.searchParams.get("state") === s && /openid/.test(loc.searchParams.get("scope") || ""), "google start: state and nonce are the app's state", Object.fromEntries(loc.searchParams)); }
    { const s = rnd(40), r = await start("facebook", s, chOf("x".repeat(30))), loc = new URL(r.headers.get("location") || "http://none/");
      ok(r.status === 302 && loc.host === "www.facebook.com" && /dialog\/oauth$/.test(loc.pathname) && loc.searchParams.get("client_id") === "fbid" && loc.searchParams.get("redirect_uri") === base + "/auth/done" && loc.searchParams.get("response_type") === "token" && loc.searchParams.get("state") === s, "facebook start: redirects to Facebook with our app id and redirect address", { st: r.status, q: Object.fromEntries(loc.searchParams) }); }
    // 2) bad requests
    ok((await start("google", "short", chOf("v".repeat(30)))).status === 400, "start: a too short state is refused");
    ok((await start("google", rnd(40), "notasha")).status === 400, "start: a challenge that is not a sha256 is refused");
    ok((await start("google", "bad state!".padEnd(30, "x"), chOf("v".repeat(30)))).status === 400, "start: a state with odd characters is refused");
    ok((await start("twitter", rnd(40), chOf("v".repeat(30)))).status >= 400, "start: an unknown provider is refused");
    { const r = await start("google", rnd(40), chOf("v".repeat(30)), `http://localhost:${P2}`); ok(r.begun.st === 404 && r.begun.j.error === "not_set_up" && r.status === 400, "a provider the server has not set up is refused (begin: not_set_up, nothing to start)", { b: r.begun, st: r.status }); }
    { const s = rnd(40), c = chOf("v".repeat(30)), r = await fetch(`${base}/auth/google/start?s=${s}`, { redirect: "manual" }); ok(r.status === 400, "start of a sign-in the app never announced (or that expired): refused", r.status);
      ok((await begin("google", s, c)).j.ok === true && (await begin("google", s, c)).st === 409, "begin: announced once, a repeat of the same state is refused");
      const r2 = await fetch(`${base}/auth/facebook/start?s=${s}`, { redirect: "manual" }); ok(r2.status === 400, "start with the other provider than the one announced: refused", r2.status);
      const loc = (await fetch(`${base}/auth/google/start?s=${s}`, { redirect: "manual" })).headers.get("location") || ""; ok(loc.includes("accounts.google.com") && !loc.includes(c), "the redirect to Google carries the state but never the app's challenge"); }
    // 3) the whole round for Google
    { const s = rnd(40), v = rnd(48); await start("google", s, chOf(v));
      ok((await post("/api/auth/claim", { s, v })).j.wait === true, "claim before the browser is done: wait");
      ok((await post("/api/auth/claim", { s, v: rnd(48) })).st === 403, "claim with a wrong secret: refused");
      ok((await post("/api/auth/claim", { s: rnd(40), v })).j.error === "unknown", "claim of an unknown state: unknown");
      ok((await post("/api/auth/stash", { s: rnd(40), provider: "google", token: `g|u1|x` })).st === 404, "stash for an unknown state: refused");
      ok((await post("/api/auth/stash", { s, provider: "facebook", token: "fb-good-1" })).st === 400, "stash with the other provider's token: refused");
      ok((await post("/api/auth/stash", { s, provider: "google", token: "garbage" })).st === 401, "stash with a token Google does not know: refused");
      ok((await post("/api/auth/stash", { s, provider: "google", token: `g|u1|${rnd(40)}` })).st === 401, "stash with a Google token asked for by another sign-in (wrong nonce): refused");
      ok((await post("/api/auth/claim", { s, v })).j.wait === true, "after the refused tokens the app still waits (nothing was stored)");
      const tok = `g|u1|${s}`; ok((await post("/api/auth/stash", { s, provider: "google", token: tok })).j.ok === true, "stash with the right token: accepted");
      ok((await post("/api/auth/claim", { s, v: rnd(48) })).st === 403, "claim with a wrong secret after the stash: still refused (the token is not handed out)");
      const c = (await post("/api/auth/claim", { s, v })).j; ok(c.provider === "google" && c.token === tok, "claim with the right secret: the token", c);
      ok((await post("/api/auth/claim", { s, v })).j.error === "unknown", "the token is handed over ONCE");
      const L = await post("/api/auth/login", { provider: "google", token: c.token }); ok(L.st === 200 && L.j.id && L.j.token, "the token logs the player in (/api/auth/login)", L.j); }
    // 4) cancelled at Google / Facebook
    { const s = rnd(40), v = rnd(48); await start("facebook", s, chOf(v));
      ok((await post("/api/auth/stash", { s, provider: "facebook", error: "access_denied" })).j.ok === true, "cancel: the page reports it");
      ok((await post("/api/auth/claim", { s, v })).j.error === "denied", "cancel: the app is told");
      ok((await post("/api/auth/claim", { s, v })).j.error === "unknown", "cancel: and only once"); }
    // 5) the whole round for Facebook
    { const s = rnd(40), v = rnd(48); await start("facebook", s, chOf(v));
      ok((await post("/api/auth/stash", { s, provider: "facebook", token: "fb-bad-1" })).st === 401, "facebook: a token Facebook does not vouch for is refused");
      ok((await post("/api/auth/stash", { s, provider: "facebook", token: "fb-good-7" })).j.ok === true, "facebook: a good token is accepted");
      const c = (await post("/api/auth/claim", { s, v })).j; ok(c.provider === "facebook" && c.token === "fb-good-7", "facebook: the app gets the token", c);
      const L = await post("/api/auth/login", { provider: "facebook", token: c.token }); ok(L.st === 200 && L.j.id, "facebook: the token logs the player in", L.j); }
    // 6) the page the browser ends on
    { const r = await fetch(base + "/auth/done"), t = await r.text();
      ok(r.status === 200 && /text\/html/.test(r.headers.get("content-type") || "") && t.includes("/api/auth/stash") && t.includes("royalbilliard8://auth") && /no-store/.test(r.headers.get("cache-control") || ""), "/auth/done: a page that posts to /api/auth/stash and opens the app (not cached)", { st: r.status }); }
    // 7) rate limit on the start address
    { let last = 0; for (let i = 0; i < 40; i++) last = (await start("google", rnd(40), chOf("v".repeat(30)))).status; ok(last === 429, "start: hammering it is slowed down", last); }
  } finally { srv.kill(); bare.kill(); nofb.kill(); fakeG.close(); fakeF.close(); for (const d of [tmp, tmp2, tmp3]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
