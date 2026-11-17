#!/usr/bin/env node
// The 8-ball pocketed on the break goes back on the table - and the player is TOLD:  node tools/test_eight_break.js   (B8_ROOT=<repo copy>)
// The owner (Nov 17, GameMonetize's Verify window): "at the start I pocketed one ball and it came back to its starting place by itself; is it only GameMonetize? if it is everywhere, fix it". It is everywhere (the same code
// on every platform): the 8 pocketed on the break is put back (the usual rule), but the message "8-shar joyiga qaytarildi" was only the small pill, which the next turn's text replaced in the same moment: the ball seemed to
// come back by itself. Now the message is a banner in the middle of the screen (after any other banner that is still up).
// Checked (the plain page, an AI match; the break is set up by hand: the 8 straight into the corner pocket):
//  - the 8 leaves the pocket, is on the table again (not "out"), near the head of the rack; the match goes on (no end of the game)
//  - a banner "8 ball returned to its spot" is shown for at least a second, and is still shown when another banner (the group banner) was up at the same moment
//  - the same for the GameMonetize page (the build for that portal) with its SDK mocked
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const MIME = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp4": "video/mp4", ".js": "text/javascript", ".json": "application/json" };
const GMSDK = `window.sdk = {showBanner() { const o = window.SDK_OPTIONS; setTimeout(() => o.onEvent({name: "SDK_GAME_PAUSE"}), 50); setTimeout(() => o.onEvent({name: "SDK_GAME_START"}), 500); }}; setTimeout(() => window.SDK_OPTIONS && window.SDK_OPTIONS.onEvent({name: "SDK_READY"}), 100);`;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8eb-")); let gmDir = path.join(tmp, "gm");
  const r = spawnSync("python3", [path.join(ROOT, "tools", "build_crazy.py"), path.join(tmp, "out")], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, PORTAL: "gamemonetize", INLINE_UNDER: "6000" } });
  ok(r.status === 0, "(the GameMonetize page is built)", (r.stderr || "").slice(-200)); fs.mkdirSync(gmDir); spawnSync("python3", ["-I", "-m", "zipfile", "-e", path.join(tmp, "out", "bilyard8-gamemonetize.zip"), gmDir]);
  const serve = root => { const s = http.createServer((q, res) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(root, u === "/" ? "index.html" : u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); }); return new Promise(rs => s.listen(0, () => rs(s))); };
  const sw = await serve(ROOT), sg = await serve(gmDir), b = await chromium.launch(), errs = [];
  for (const [name, port, gm] of [["plain page", sw.address().port, false], ["GameMonetize page", sg.address().port, true]]) {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", hasTouch: true, isMobile: true }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 160)));
    await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 900000 })); });
    if (gm) await p.route(/api\.gamemonetize\.com\/sdk\.js/, r => r.fulfill({ contentType: "text/javascript", body: GMSDK }));
    await p.route(u => !/localhost|127\.0\.0\.1|gamemonetize/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(900);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); try { vipShownSession = true; } catch (e) {} }); await sleep(3500);
    for (const withOther of [false, true]) {
      await p.evaluate(() => { try { toMenu(); } catch (e) {} }); await sleep(600);
      await p.evaluate(() => { startMatch("ai", CITIES[2], { name: "Elif", avatar: 301, frame: 0, level: 5, isAI: true, color: "#d33", cue: "start" }, null); });
      for (let i = 0; i < 100; i++) { await sleep(300); if (await p.evaluate(() => canControl())) break; }
      const res = await p.evaluate(async withOther => {
        const G = game, cue = G.balls[0], b8 = G.balls.find(b => b.n === 8), seen = [];
        G.cur = 0; G.isBreak = true; G.ballInHand = false; G.groups = [null, null];
        if (!withOther) {   // the real thing: the 8 rolled straight into the corner pocket by the cue ball
          const pk = POCKETS[0], cx = FW / 2, cy = FH / 2, dx = pk.x - cx, dy = pk.y - cy, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
          G.balls.forEach(b => { if (b !== cue && b !== b8) { b.x = 60 + (b.n * 40) % 300; b.y = FH - 40 - (b.n % 3) * 30; b.vx = b.vy = 0; } });
          b8.x = pk.x - ux * 70; b8.y = pk.y - uy * 70; b8.vx = b8.vy = 0; cue.x = b8.x - ux * 120; cue.y = b8.y - uy * 120; cue.vx = cue.vy = 0; G.angle = Math.atan2(uy, ux); doShoot(0.45);
        } else {   // the 8 AND a solid pocketed in one break: the group banner is up in the same moment
          const b3 = G.balls.find(b => b.n === 3); b8.out = true; b3.out = true; G.shot = { potted: [8, 3], off: [], firstHit: 3, ownBefore: 0, rails: 2, oo: new Set(), rb: new Set() }; resolveShot();
        }
        const t0 = performance.now(); let first = 0, last = 0;
        for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 100)); const bn = G.banner && performance.now() - G.banner.t0 < G.banner.dur ? G.banner.text : ""; if (bn && !seen.includes(bn)) seen.push(bn); if (/8 ball returned/i.test(bn)) { if (!first) first = performance.now() - t0; last = performance.now() - t0; } }
        return { out: !!b8.out, x: Math.round(b8.x), y: Math.round(b8.y), banners: seen, shownMs: Math.round(last - first), over: !!G.over || !game };
      }, withOther);
      ok(!res.out && res.x > 450, `${name}${withOther ? " (8 + a solid together)" : ""}: the 8 is back on the table, near the rack`, res);
      ok(res.banners.some(t => /8 ball returned/i.test(t)) && res.shownMs >= 1000, `${name}${withOther ? " (8 + a solid together)" : ""}: the player is told ("8 ball returned to its spot", shown for ${res.shownMs} ms)`, res.banners);
      ok(!res.over, `${name}: the match goes on`);
    }
    await ctx.close();
  }
  ok(errs.length === 0, "no page errors", errs.slice(0, 3)); await b.close(); sw.close(); sg.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
