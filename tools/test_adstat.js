#!/usr/bin/env node
// What the ad network answered, counted by the server so that "no ad came" can be told from "the game never asked":  node tools/test_adstat.js   (B8_ROOT=<repo copy>)
// The owner: "the Y8 ad does not pay / is not called". The Y8 page (in a frame, like Y8's own) reports every ad break (breakStatus) to POST /api/adstat;
// the owner reads it on /admin/ads (needs the ADMIN_KEY). Checked here against the real server and a fake Y8 SDK:
//  - the start ad when the game opens is reported (start / game-start / viewed)
//  - an ad the network did not give (notReady) is reported as such, with viewed = 0
//  - an ad break every 2nd finished match (y8Break), none after the 1st
//  - the numbers need the admin key; the page /admin/ads exists; junk is refused
const { chromium } = require("playwright"), { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SP = +process.env.TEST_PORT || 8741, GP = SP + 1;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ads-")), base = `http://localhost:${SP}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(SP), DATA_DIR: tmp, ADMIN_KEY: "adminkey123" }, stdio: "ignore" }); await sleep(2500);
  const wrap = `<!doctype html><body style="margin:0"><iframe id="g" src="/game/index.html?server=${encodeURIComponent(base)}" style="border:0;width:100vw;height:100vh" allow="autoplay"></iframe></body>`;
  const web = http.createServer((q, s) => { const u = decodeURIComponent(q.url.split("?")[0]); if (u === "/") { s.writeHead(200, { "Content-Type": "text/html" }); return s.end(wrap); }
    const f = path.join(ROOT, u.replace(/^\/game\//, "")); if (!u.startsWith("/game/") || !f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { "Content-Type": u.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(s); });
  await new Promise(r => web.listen(GP, r));
  const b = await chromium.launch(), errs = [];
  const STUB = `window.__ads = []; window.__status = "viewed"; window.y8 = {sdk: () => ({init: (a, o) => { setTimeout(() => o.onReady && o.onReady(), 200); }, onAuth: () => {}, getPlatformLocale: () => Promise.resolve("en"),
    showAd: o => { window.__ads.push(o.type + ":" + o.name); o.beforeAd && o.beforeAd(); return new Promise(res => setTimeout(() => { if (window.__status === "viewed") o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone({ breakStatus: window.__status }); res(); }, 40)); } }), emitReadyEvent: () => window.dispatchEvent(new Event("y8sdk.ready")) };`;
  const get = async (key) => { const r = await fetch(`${base}/api/adstat`, { headers: key ? { "x-admin-key": key } : {} }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const flat = j => { const o = {}; for (const d of Object.values(j.days || {})) for (const [k, v] of Object.entries(d)) { o[k] = o[k] || { n: 0, viewed: 0 }; o[k].n += v.n; o[k].viewed += v.viewed; } return o; };
  try {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 500 }, locale: "en-US" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(() => { try { if (location.pathname.includes("/game/") && !localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" })); } catch (e) {} });
    await p.route(u => /cdn\.y8\.com/.test(String(u)), r => r.fulfill({ contentType: "text/javascript", body: STUB }));
    await p.route(u => !/localhost|127\.0\.0\.1|cdn\.y8\.com/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${GP}/`, { waitUntil: "commit" });
    const fr = () => p.frames().find(f => f.url().includes("/game/"));
    for (let i = 0; i < 600 && !(fr() && await fr().evaluate(() => typeof profile !== "undefined" && !document.getElementById("boot") && window.__bootGone).catch(() => false)); i++) await sleep(200);
    await sleep(4000);
    ok(await fr().evaluate(() => ON_PORTAL && Y8.sdk && Y8.adsReady), "the page runs in Y8 mode with the (fake) SDK ready");
    ok(JSON.stringify(await fr().evaluate(() => window.__ads)) === JSON.stringify(["start:game-start"]), "one start ad when the game opens", await fr().evaluate(() => window.__ads));
    let r = await get("adminkey123"); let f = flat(r.j);
    ok(r.status === 200 && f["y8 | start | game-start | viewed"] && f["y8 | start | game-start | viewed"].n === 1 && f["y8 | start | game-start | viewed"].viewed === 1, "the start ad is counted as viewed", f);
    // the network gives no ad
    await fr().evaluate(() => { window.__status = "notReady"; Y8.lastBreak = 0; return y8Ad("next", "between-matches"); }); await sleep(600);
    r = await get("adminkey123"); f = flat(r.j);
    ok(f["y8 | next | between-matches | notReady"] && f["y8 | next | between-matches | notReady"].n === 1 && f["y8 | next | between-matches | notReady"].viewed === 0, "an ad the network did not give is counted as notReady, not viewed", f);
    ok(await fr().evaluate(() => Y8.lastStatus === "notReady" && !Y8.busy), "the game goes on (not stuck behind the ad)");
    // every 2nd finished match
    await fr().evaluate(() => { window.__status = "viewed"; window.__ads.length = 0; Y8.matches = 0; Y8.lastBreak = 0; window.__cb = 0; y8Break(() => window.__cb++); });
    await sleep(300); ok(await fr().evaluate(() => window.__ads.length === 0 && window.__cb === 1), "after the 1st finished match: no ad break, the game goes straight on", await fr().evaluate(() => [window.__ads, window.__cb]));
    await fr().evaluate(() => { Y8.lastBreak = 0; y8Break(() => window.__cb++); }); await sleep(600);
    ok(await fr().evaluate(() => window.__ads.length === 1 && window.__ads[0] === "next:between-matches" && window.__cb === 2), "after the 2nd finished match: an ad break, then the game goes on", await fr().evaluate(() => [window.__ads, window.__cb]));
    r = await get("adminkey123"); f = flat(r.j);
    ok(f["y8 | next | between-matches | viewed"] && f["y8 | next | between-matches | viewed"].n === 1, "...and it is counted", f);
    // access
    ok((await get("")).status === 403 && (await get("wrong")).status === 403, "the numbers need the admin key");
    const pg = await fetch(`${base}/admin/ads`); ok(pg.status === 200 && /Reklama hisobi/.test(await pg.text()), "the page /admin/ads exists");
    const bad = await fetch(`${base}/api/adstat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ s: "viewed" }) }); ok(bad.status === 400, "a report without a platform / type is refused", bad.status);
    const junk = await fetch(`${base}/api/adstat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p: "y8", t: "<script>x", n: "a b", s: "v'iewed" }) }); ok(junk.status === 200, "a report with odd characters is cleaned, not trusted");
    const keys = Object.keys(flat((await get("adminkey123")).j)); ok(keys.every(k => !/[<>' ]{2,}|<|>|'/.test(k.replace(/ \| /g, "|"))), "no markup / quotes get into the stored names", keys);
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); web.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
