#!/usr/bin/env node
// The light build (./web) served by the game server: node tools/test_web_serve.js
// - the page is the small one (a few MB, not 40), pictures / sounds come as files with a one-year "immutable" cache and 304 for a tag, Range works for the little video
// - the game boots to the menu and a match starts with no page error and no failed request; a second visit downloads (almost) nothing again (the first one downloads all pictures with a progress screen: see test_preload.js)
// - a build older than index.html is ignored (the single-file page is served and /api/health says web:false)
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const start = (server, port, data) => { const c = spawn("node", [server], { env: { ...process.env, PORT: String(port), DATA_DIR: data }, stdio: ["ignore", "pipe", "pipe"] }); c.out = ""; c.stdout.on("data", d => c.out += d); c.stderr.on("data", d => c.out += d); return c; };
const get = async (u, h) => { const r = await fetch(u, { headers: h || {} }); return { status: r.status, h: r.headers, buf: Buffer.from(await r.arrayBuffer()) }; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8web-")), P = 8301, base = `http://localhost:${P}`;
  const srv = start(path.join(ROOT, "server", "server.js"), P, path.join(tmp, "d1")); await sleep(2500);
  const health = await (await fetch(base + "/api/health")).json();
  ok(health.web === true, "/api/health says the light build is served (run: SAME_ORIGIN=1 INLINE_UNDER=6000 NO_ZIP=1 python3 tools/build_web.py web)", health);
  const page = await get(base + "/", { "accept-encoding": "identity" });
  ok(page.status === 200 && page.buf.length < 8e6, "the page is the light one (< 8 MB)", page.buf.length);
  const img = (page.buf.toString().match(/img\/[0-9a-f]{14}\.webp/) || [])[0]; ok(!!img, "the page points at picture files");
  const r1 = await get(base + "/" + img); ok(r1.status === 200 && /immutable/.test(r1.h.get("cache-control")) && /max-age=31536000/.test(r1.h.get("cache-control")) && r1.h.get("content-type") === "image/webp", "a picture is cached for a year (immutable) as image/webp", [r1.status, r1.h.get("cache-control")]);
  const r2 = await get(base + "/" + img, { "if-none-match": r1.h.get("etag") }); ok(r2.status === 304, "a picture asked with its tag is a 304", r2.status);
  const mp4 = (page.buf.toString().match(/a\/[0-9a-f]{14}\.mp4/) || [])[0];
  if (mp4) { const r3 = await get(base + "/" + mp4, { range: "bytes=0-99" }); ok(r3.status === 206 && r3.buf.length === 100 && /^bytes 0-99\//.test(r3.h.get("content-range")), "the video answers a Range request", [r3.status, r3.buf.length]); }
  const bad = await get(base + "/img/..%2f..%2fserver.js"); ok(bad.status === 404, "no way out of the picture folder", bad.status);
  const idx2 = await get(base + "/", { "accept-encoding": "identity", "if-none-match": page.h.get("etag") }); ok(idx2.status === 304, "the page asked with its tag is a 304", idx2.status);

  // the game itself in a browser: first visit, then a second one
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 900, height: 420 }, locale: "en-US" }), errs = [], failed = [];
  const visit = async () => {
    const p = await ctx.newPage(); let bytes = 0, reqs = 0; const own = new Set();   // bytes = what really came over the network (CDP: a copy from the cache counts 0)
    p.on("pageerror", e => errs.push(e.message.slice(0, 160))); p.on("requestfailed", r => { if (r.url().startsWith(base)) failed.push(r.url().slice(-60)); });
    const cdp = await ctx.newCDPSession(p); await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", e => { if (e.request.url.startsWith(base)) { own.add(e.requestId); reqs++; } });
    cdp.on("Network.loadingFinished", e => { if (own.has(e.requestId)) bytes += e.encodedDataLength || 0; });
    await p.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" });
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 90000 }); await sleep(1200);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(800);
    return { p, get bytes() { return bytes; }, get reqs() { return reqs; } };
  };
  const v1 = await visit();
  await v1.p.evaluate(() => { startMatch("ai", CITIES[0]); }); await sleep(2500);
  // floorSheet() is null until the sheet has loaded (the first ask starts the download); the first table is no longer London, so nobody has asked for London's sheet yet: ask, then wait for the file
  const m = await v1.p.evaluate(async () => { const t0 = Date.now(); let sh = floorSheet(FLOOR_FOR.lon[0]); while (!sh && Date.now() - t0 < 20000) { await new Promise(r => setTimeout(r, 200)); sh = floorSheet(FLOOR_FOR.lon[0]); } return { mode, sheet: !!sh, snd: typeof Snd !== "undefined" }; });
  ok(m.mode === "game" && m.sheet, "a match starts and its floor sheet has loaded from a file", m);
  const wav = (page.buf.toString().match(/a\/[0-9a-f]{14}\.wav/) || [])[0];
  if (wav) { const d = await v1.p.evaluate(async u => { const ac = new (window.AudioContext || window.webkitAudioContext)(), b = await ac.decodeAudioData(await (await fetch(u)).arrayBuffer()); return b.duration; }, wav); ok(d > 0.01, "a sound file of the light build decodes", d); }
  const first = v1.bytes; await v1.p.close();
  const v2 = await visit(); const second = v2.bytes; await v2.p.close();
  console.log(`first visit: ${v1.reqs} requests, ${(first / 1e6).toFixed(1)} MB; second visit: ${v2.reqs} requests, ${(second / 1e6).toFixed(1)} MB`);
  ok(first < 100e6, "the first visit stays under 100 MB (every picture once, standard 33 MB + HD pack 51 MB, with a progress screen; the single-file page was 40 MB)", first);
  ok(second < 0.35 * first + 300000, "the second visit downloads far less than the first", [first, second]);
  ok(errs.length === 0, "no page errors", errs); ok(failed.length === 0, "no failed requests", failed.slice(0, 5));
  await b.close(); srv.kill();

  // a stale build is ignored: a copy of the server next to a different index.html
  const t2 = path.join(tmp, "stale"); fs.mkdirSync(path.join(t2, "server"), { recursive: true }); fs.mkdirSync(path.join(t2, "web"));
  fs.cpSync(path.join(ROOT, "server"), path.join(t2, "server"), { recursive: true, filter: f => !/node_modules|[\\/]data([\\/]|$)/.test(f) });
  fs.symlinkSync(path.join(ROOT, "server", "node_modules"), path.join(t2, "server", "node_modules"));
  for (const f of ["manifest.webmanifest", "icon.svg"]) { try { fs.copyFileSync(path.join(ROOT, f), path.join(t2, f)); } catch (e) {} }
  fs.writeFileSync(path.join(t2, "index.html"), "<html>single-file page</html>"); fs.writeFileSync(path.join(t2, "web", "index.html"), "<html>old light page</html>"); fs.writeFileSync(path.join(t2, "web", ".src"), "0000");
  const s2 = start(path.join(t2, "server", "server.js"), P + 1, path.join(tmp, "d2")); await sleep(2000);
  const h2 = await (await fetch(`http://localhost:${P + 1}/api/health`)).json(), pg2 = await get(`http://localhost:${P + 1}/`, { "accept-encoding": "identity" });
  ok(h2.web === false && /single-file page/.test(pg2.buf.toString()), "a stale light build is ignored", [h2.web, pg2.buf.toString().slice(0, 40)]);
  s2.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
