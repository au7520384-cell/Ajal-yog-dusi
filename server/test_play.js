#!/usr/bin/env node
// Google Play Billing on the server (a fake Google + the real server):  node server/test_play.js
// The Android app buys a 💎 pack with Google Play and sends the purchase token to POST /api/play/verify. The server signs a service-account JWT (RS256), asks the Google Play Developer API
// (purchases.products.get) whether the token is a real, paid purchase of that pack, hands the 💎 over ONCE (dm:1 grant, kind "purchase") and consumes the purchase (purchases.products.consume, else acknowledge).
// Checks: not configured -> 503; the JWT really verifies against the key; a good purchase pays the pack's 💎 once; the same token twice pays once; pending / canceled / unknown tokens pay nothing;
// a token tied to another player is refused; a token already used by another player is refused; only the six 💎 packs can be verified; consume failing -> acknowledge, the next call consumes; Google down / refusing -> an error and nothing paid, a retry works.
const { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const startFakePlay = require("./fake_play"), GP = 8651, P = 8652, P2 = 8653, PKG = "com.royalbilliard8.app";
const tag = id => crypto.createHash("sha256").update("rb8-play:" + id).digest("hex").slice(0, 32);   // what the app gives Google as the account id (the server computes the same)
(async () => {
  const fake = await startFakePlay(GP), orders = fake.orders, st = fake.st, SA = fake.saJson, order = fake.order;   // the fake Google (server/fake_play.js)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8play-")), tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "b8play2-"));
  const base = { ...process.env, PLAY_API_BASE: `http://localhost:${GP}`, PLAY_OAUTH_URL: `http://localhost:${GP}/token`, PLAY_PACKAGE: PKG };
  delete base.PLAY_SERVICE_ACCOUNT;
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env: { ...base, PORT: String(P), DATA_DIR: tmp, PLAY_VOID_MS: "1500", PLAY_VOID_FIRST_MS: "500", PLAY_SERVICE_ACCOUNT: Buffer.from(SA).toString("base64") }, stdio: "ignore" });   // the key as base64 (how it is easiest to paste into a Render env var)
  const srv2 = spawn("node", [path.join(__dirname, "server.js")], { env: { ...base, PORT: String(P2), DATA_DIR: tmp2 }, stdio: "ignore" });   // a server without the key
  await sleep(2800);
  const api = async (port, acct, p, body) => { const r = await fetch(`http://localhost:${port}${p}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const A = (acct, p, body) => api(P, acct, p, body);
  const grants = async u => (await A(u, "/api/sync", { name: u.name || "X" })).j.grants || [];
  const T = n => "tok" + String(n).padStart(2, "0") + "x".repeat(40);   // purchase tokens: letters / digits, long
  try {
    const ann = (await api(P, null, "/api/register", { name: "Ann", avatar: 1 })).j, bob = (await api(P, null, "/api/register", { name: "Bob", avatar: 2 })).j;
    // ---- not configured / not signed in
    const bob2 = (await api(P2, null, "/api/register", { name: "Zed", avatar: 3 })).j;
    ok((await api(P2, bob2, "/api/play/status")).j.configured === false, "a server without the key says configured:false");
    ok((await api(P2, bob2, "/api/play/verify", { sku: "gems_100", token: T(0) })).s === 503, "...and verify answers 503 (nothing is asked from Google)");
    ok((await A(null, "/api/play/verify", { sku: "gems_100", token: T(1) })).s === 401 && (await A(null, "/api/play/status")).s === 401, "verify and status need a signed-in player (401)");
    const s0 = await A(ann, "/api/play/status");
    ok(s0.s === 200 && s0.j.configured === true && s0.j.acct === tag(ann.id) && s0.j.skus.join() === "gems_100,gems_250,gems_500,gems_1000,gems_2500,gems_5000", "status: configured, the account tag of this player, the six pack ids", s0.j);
    // ---- a good purchase: paid once, consumed
    order(T(10), "gems_250", { account: tag(ann.id) });
    const v1 = await A(ann, "/api/play/verify", { sku: "gems_250", token: T(10) });
    ok(v1.s === 200 && v1.j.ok === true && v1.j.gems === 250 && !v1.j.again, "a real gems_250 purchase is accepted", v1);
    const g1 = await grants(ann); ok(g1.length === 1 && g1[0].gems === 250 && g1[0].dm === 1 && g1[0].kind === "purchase" && !g1[0].cash && !g1[0].coins, "the grant: 250 💎, dm:1, kind purchase, no cash / coins", g1);
    ok(orders.get(T(10)).consumed === true && st.consume === 1, "the server consumed the purchase at Google (so the pack can be bought again)", st);
    ok(st.jwtOk === 1 && st.oauth === 1, "the service-account JWT (RS256, iss / scope / aud / exp) was accepted by the token endpoint", st);
    // ---- the same token again: paid once, no second consume, no second Google lookup
    const getsBefore = st.get, consBefore = st.consume;
    const v2 = await A(ann, "/api/play/verify", { sku: "gems_250", token: T(10) });
    ok(v2.s === 200 && v2.j.ok === true && v2.j.again === true, "the same token again is answered 'again' (ok)", v2);
    ok((await grants(ann)).length === 0 && st.get === getsBefore && st.consume === consBefore, "...pays nothing more and does not ask Google again", st);
    ok(st.oauth === 1, "the OAuth access token is reused (one token request for all calls)", st);
    // ---- every pack pays its own amount
    for (const [i, [sku, gems]] of [["gems_100", 100], ["gems_500", 500], ["gems_1000", 1000], ["gems_2500", 2500], ["gems_5000", 5000]].entries()) {
      order(T(20 + i), sku, { account: tag(ann.id) }); const r = await A(ann, "/api/play/verify", { sku, token: T(20 + i) }); const g = await grants(ann);
      ok(r.s === 200 && g.length === 1 && g[0].gems === gems && g[0].dm === 1, `${sku} pays ${gems} 💎`, [r.s, g]);
    }
    // ---- pending / canceled / unknown / wrong product
    order(T(30), "gems_100", { account: tag(ann.id), state: 2 });
    const p1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(30) });
    ok(p1.s === 202 && p1.j.pending === true && (await grants(ann)).length === 0, "a PENDING purchase (cash payment not finished yet) pays nothing and says pending (202)", p1);
    orders.get(T(30)).state = 0; const p2 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(30) });
    ok(p2.s === 200 && (await grants(ann)).length === 1, "...and pays when Google later says purchased (the app asks again)", p2);
    order(T(31), "gems_100", { account: tag(ann.id), state: 1 });
    const c1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(31) });
    ok(c1.s === 402 && (await grants(ann)).length === 0, "a CANCELED purchase pays nothing (402)", c1);
    const u1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(32) });
    ok(u1.s === 400 && u1.j.error === "bad_token" && (await grants(ann)).length === 0, "a token Google does not know pays nothing (400 bad_token)", u1);
    order(T(33), "gems_500", { account: tag(ann.id) });
    const w1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(33) });
    ok(w1.s === 400 && (await grants(ann)).length === 0, "a token of another product than the one claimed pays nothing (a gems_500 token claimed as gems_100)", w1);
    // ---- not a diamond pack / malformed
    const gets2 = st.get;
    for (const bad of [{ sku: "starter", token: T(40) }, { sku: "cash_50", token: T(40) }, { sku: "gems_290", token: T(40) }, { sku: "nope", token: T(40) }, { sku: "gems_100", token: "short" }, { sku: "gems_100", token: "bad token with spaces and / slashes ........" }, {}]) {
      const r = await A(ann, "/api/play/verify", bad); ok(r.s === 400, "refused as a bad request: " + JSON.stringify(bad).slice(0, 60), r);
    }
    ok(st.get === gets2 && (await grants(ann)).length === 0, "none of those reached Google or paid anything");
    // ---- bound to another player / used by another player
    order(T(50), "gems_100", { account: tag(bob.id) });
    const o1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(50) });
    ok(o1.s === 403 && o1.j.error === "other_account" && (await grants(ann)).length === 0, "a purchase made for another player's account is refused (403) - the token cannot be handed over", o1);
    const o2 = await A(bob, "/api/play/verify", { sku: "gems_100", token: T(50) });
    ok(o2.s === 200 && (await grants(bob)).length === 1, "...and the right player gets it", o2);
    order(T(51), "gems_100", { account: "" });   // no account id (an app build that did not send one): accepted, the first player to claim it gets it
    const n1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(51) });
    ok(n1.s === 200 && (await grants(ann)).length === 1, "a purchase without an account id is accepted (the first claimer)", n1);
    const n2 = await A(bob, "/api/play/verify", { sku: "gems_100", token: T(51) });
    ok(n2.s === 403 && n2.j.error === "other_account" && (await grants(bob)).length === 0, "a token already paid to Ann cannot be claimed by Bob (403)", n2);
    // ---- consume fails: acknowledge, and the next call consumes
    fake.opts.failConsume = true; order(T(60), "gems_250", { account: tag(ann.id) });
    const k1 = await A(ann, "/api/play/verify", { sku: "gems_250", token: T(60) });
    ok(k1.s === 200 && orders.get(T(60)).acked === true && orders.get(T(60)).consumed === false && (await grants(ann)).length === 1, "consume failing: the 💎 are paid, the purchase is acknowledged (no 3-day refund)", [k1, st]);
    fake.opts.failConsume = false; const k2 = await A(ann, "/api/play/verify", { sku: "gems_250", token: T(60) });
    ok(k2.s === 200 && k2.j.again === true && orders.get(T(60)).consumed === true && (await grants(ann)).length === 0, "...the app's next call consumes it, and pays nothing twice", k2);
    // ---- a purchase the app (or Google) already consumed before the server saw it is still paid once
    order(T(61), "gems_100", { account: tag(ann.id), consumed: true, acked: true });
    const k3 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(61) }); const consN = st.consume;
    ok(k3.s === 200 && (await grants(ann)).length === 1 && st.consume === consN, "an already consumed purchase is still paid once (and not consumed again)", [k3, st]);
    // ---- Google down / refusing: an error, nothing paid, a retry works
    order(T(70), "gems_100", { account: tag(ann.id) }); fake.opts.getStatus = 500;
    const d1 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(70) });
    ok(d1.s === 502 && d1.j.error === "play_down" && (await grants(ann)).length === 0, "Google answering 500: 502 play_down, nothing paid", d1);
    fake.opts.getStatus = 403; const d2 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(70) });
    ok(d2.s === 502 && d2.j.error === "play_auth" && (await grants(ann)).length === 0, "Google refusing the service account (403): 502 play_auth, nothing paid", d2);
    fake.opts.getStatus = 200; const d3 = await A(ann, "/api/play/verify", { sku: "gems_100", token: T(70) });
    ok(d3.s === 200 && (await grants(ann)).length === 1, "...and the retry pays", d3);
    // ---- refunds: Google voids (refunds / charges back) a purchase that was delivered -> the 💎 are taken back ONCE (a "refund" grant; the app subtracts them, never below 0)
    fake.voidOrder(T(10), 7);   // Ann's gems_250: charged back
    await sleep(2600);   // the server asks Google for voided purchases every 1.5 s here (30 min for real)
    const rf = await grants(ann);
    ok(rf.length === 1 && rf[0].kind === "refund" && rf[0].take === 250 && !rf[0].gems && !rf[0].coins, "a refunded purchase: one 'refund' grant of the same 250 💎", rf);
    await sleep(2200); ok((await grants(ann)).length === 0, "...taken back only once (the next checks add nothing)");
    const rv = await A(ann, "/api/play/verify", { sku: "gems_250", token: T(10) });
    ok(rv.s === 200 && rv.j.again === true && (await grants(ann)).length === 0, "the refunded token cannot be claimed again for more 💎", rv);
    order(T(80), "gems_100", { account: tag(ann.id) }); fake.voidOrder(T(80), 1);   // refunded before the app ever sent it to the server: nothing was delivered, nothing to take back
    order(T(81), "gems_100", { account: tag(bob.id) }); fake.voidOrder(T(81), 5);
    await sleep(2200); ok((await grants(ann)).length === 0 && (await grants(bob)).length === 0, "a refund of a purchase the server never delivered takes nothing back");
    const hp = (await A(null, "/api/health")).j.play;
    ok(hp && hp.on === true && hp.refunded === 1 && hp.refundChecks >= 3 && hp.err === "", "/api/health shows the refund checks (1 refund taken back, no error)", hp);
    fake.opts.voidedStatus = 403; await sleep(2200);
    const he = (await A(null, "/api/health")).j.play; ok(/^403/.test(he.err) && srv.exitCode === null, "Google refusing the refund list (403): shown in /api/health, the server keeps running", he);
    fake.opts.voidedStatus = 200; await sleep(2200); ok(((await A(null, "/api/health")).j.play || {}).err === "", "...and the error clears when Google answers again");
    // ---- the key never leaves the server
    const pub = JSON.stringify([(await A(ann, "/api/play/status")).j, (await A(null, "/api/skus")).j]);
    ok(!/PRIVATE KEY|private_key|royal-test\.iam/.test(pub), "no key material in the public answers");
    ok(srv.exitCode === null, "the server is still running");
  } finally { srv.kill(); srv2.kill(); fake.close(); for (const d of [tmp, tmp2]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
