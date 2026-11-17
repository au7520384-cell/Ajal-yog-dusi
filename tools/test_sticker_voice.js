#!/usr/bin/env node
// Voiced stickers (the owner, Nov 17: "stickers must have a sound, and move"):  node tools/test_sticker_voice.js   (B8_ROOT=<repo copy>; ~2 min, one browser, no game server)
// The nine animal stickers (fox, tiger, panda, eagle, frog, wolf, bear, rabbit, lizard) have a recorded sound (art/stk/*.mp3, embedded as STK_VOX by tools/build_stk.py) and move with its loudness (STK_MOVE / stkMove):
//  - the data is whole: nine sounds, a loudness curve each, a known way to move, the picture exists
//  - stkMove is a function of the time since the sound began: it moves while the sound is loud and is null (the plain sticker) when the sound is over, for a sticker with no voice, and before the start
//  - in a match a voiced sticker (mine or the opponent's) plays its sound once, at most one per 1.2 s (a second one inside that is silent), never when muted, never when "show only mine" hides the opponent's sticker;
//    the picture drawn on the canvas really shakes / swells while it sounds, and a sticker with no voice is drawn exactly as before (still)
//  - a tap on a voiced sticker in the world chat plays it again (also inside the 1.2 s) and wiggles it
//  - the light build moves the sounds out of the page into a/<hash>.mp3 (the page keeps only their paths) and they are valid MP3 files
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const ANIMALS = ["🦊", "🐯", "🐼", "🦅", "🐸", "🐺", "🐻", "🐰", "🦎"];
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, errs = [];
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
  await p.addInitScript(() => {
    localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, gender: "m", wins: 12 }));
    window.__starts = []; const os = AudioBufferSourceNode.prototype.start;   // every sound-file playback of the page (the game's own synthesised sounds are oscillators, not buffers)
    AudioBufferSourceNode.prototype.start = function (...a) { window.__starts.push({ d: this.buffer ? this.buffer.duration : 0, t: performance.now() }); return os.apply(this, a); };
    window.__draws = []; const od = CanvasRenderingContext2D.prototype.drawImage;     // the sticker of a match bubble is drawn with drawImage(im, -46, -46, 92, 92)
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (window.__rec && a.length === 5 && a[3] === 92 && a[4] === 92) { const m = this.getTransform(); window.__draws.push({ t: performance.now(), a: m.a, b: m.b, e: m.e, f: m.f }); } return od.apply(this, a); };
  });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); });
  await sleep(3500);

  // ---------------------------------------------------------------- 1) the data
  const d = await p.evaluate(() => ({ keys: Object.keys(STK_VOX), mp3: Object.values(STK_VOX).every(v => /^data:audio\/mpeg;base64,/.test(v.u) && v.u.length > 3000), env: Object.values(STK_VOX).map(v => /^[0-9]{8,}$/.test(v.e) && Math.max(...[...v.e].map(Number)) === 9), moves: Object.values(STK_VOX).every(v => !!STK_MOVE[v.m]), art: Object.keys(STK_VOX).every(k => !!STK_IMG[k]), styles: Object.keys(STK_MOVE).length }));
  ok(JSON.stringify(d.keys.slice().sort()) === JSON.stringify(ANIMALS.slice().sort()) && d.mp3, "STK_VOX holds the nine animal stickers, each with an MP3 sound", d.keys);
  ok(d.env.every(Boolean) && d.moves && d.art, "...each has a loudness curve (0-9, the loudest step is 9), a known way to move and a picture", d);

  // ---------------------------------------------------------------- 2) stkMove
  const mv = await p.evaluate(() => {
    const at = (t, ms) => stkMove(t, ms), t = STK_VOX["🐯"].e.length * 50, r = {};
    r.tigerLoud = Math.max(...[...Array(40)].map((_, i) => (at("🐯", 100 + i * 45) || { s: 1 }).s));
    r.tigerShake = Math.max(...[...Array(80)].map((_, i) => Math.abs((at("🐯", 100 + i * 20) || { r: 0 }).r)));
    r.over = at("🐯", t + 200); r.before = at("🐯", -1); r.plain = at("🎱", 300); r.text = at("Salom!", 300);
    r.wolfTilt = Math.min(...[...Array(70)].map((_, i) => (at("🐺", 300 + i * 20) || { r: 0 }).r));
    r.frogHop = Math.min(...[...Array(100)].map((_, i) => (at("🐸", 100 + i * 20) || { y: 0 }).y));
    r.rings = { tiger: Math.max(...[...Array(40)].map((_, i) => (at("🐯", 100 + i * 45) || { ring: 0 }).ring)), frog: Math.max(...[...Array(100)].map((_, i) => (at("🐸", 100 + i * 20) || { ring: 0 }).ring)) };
    r.finite = ANIMALS_ALL = Object.keys(STK_VOX).every(k => { for (let ms = 0; ms < 2100; ms += 37) { const m = at(k, ms); if (m && !["s", "r", "x", "y", "ring", "w"].every(q => Number.isFinite(m[q]))) return false; } return true; });
    return r;
  });
  ok(mv.tigerLoud > 1.15 && mv.tigerShake > 0.04, "stkMove: the tiger swells (up to x1.2) and shakes while it roars", mv);
  ok(mv.over === null && mv.before === null && mv.plain === null && mv.text === null, "...null when the sound is over, before it starts, for a sticker with no voice and for plain text", mv);
  ok(mv.wolfTilt < -0.2 && mv.frogHop < -6 && mv.rings.tiger > 0.5 && mv.rings.frog === 0 && mv.finite, "...each animal moves its own way: the wolf's head goes back, the frog jumps, the tiger sends out rings, the frog does not; every number is finite", mv);

  // ---------------------------------------------------------------- 3) in a match
  await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { toMenu(); } catch (e) {} startMatch("ai", CITIES[0], botPlayer(1, 4)); });
  for (let i = 0; i < 40; i++) { await sleep(300); if (await p.locator("#tutSkip").count()) await p.locator("#tutSkip").click().catch(() => {}); if (await p.evaluate(() => canControl())) break; }
  await p.evaluate(() => { Snd.init(); setOpt("cheer", "all"); profile.muted = false; });
  await sleep(4200);   // (the 3 s warm-up decodes the sounds; it also lets the opening chatter of the bot's bubble pass)
  const starts = async (lo, hi) => p.evaluate(([lo, hi]) => window.__starts.filter(s => s.d >= lo && s.d <= hi).length, [lo, hi]);
  const D = await p.evaluate(() => Object.fromEntries(Object.keys(STK_VOX).map(k => [k, 0])));   // (the decoded durations are read from the played buffers below)
  const run = async (fn, wait = 450) => { const n0 = await p.evaluate(() => window.__starts.length); await p.evaluate(fn); await sleep(wait); return p.evaluate(n0 => window.__starts.slice(n0).map(s => +s.d.toFixed(3)), n0); };

  await sleep(1300);
  let s1 = await run(() => bubble(0, "🐯", 2600));
  const tigerD = s1.find(x => x > 1.9 && x < 2.2);
  ok(!!tigerD, "my voiced sticker (tiger) plays its sound once", s1);
  let s2 = await run(() => bubble(1, "🐺", 5000), 450);   // 0.45 s later: inside the 1.2 s
  ok(!s2.some(x => x > 1.9 && x < 2.0) && !s2.some(x => x > 1.8 && x < 2.0 && x !== tigerD), "a second voiced sticker within 1.2 s is silent (nobody can machine-gun a roar)", { s2, tigerD });
  await sleep(1300);
  let s3 = await run(() => bubble(1, "🐺", 5000));
  ok(s3.some(x => x > 1.8 && x < 2.0) && s3.filter(x => x > 1.8 && x < 2.0).length === 1, "...after that the opponent's wolf plays (its own, shorter sound), once", s3);
  await sleep(1300);
  let s4 = await run(() => { bubble(0, "🎱", 2600); bubble(0, "Salom!", 2600); });
  ok(!s4.some(x => x > 0.3 && x < 2.2 && Math.abs(x - 2.064) < 0.1), "a sticker with no voice and a text bubble play no sticker sound", s4);
  await sleep(1300);
  await p.evaluate(() => { profile.muted = true; });
  let s5 = await run(() => bubble(0, "🐼", 2600));
  ok(s5.length === 0, "muted: nothing plays (the picture still moves)", s5);
  await p.evaluate(() => { profile.muted = false; }); await sleep(1300);
  await p.evaluate(() => setOpt("cheer", "mine"));
  let s6 = await run(() => bubble(1, "🐰", 5000));
  const shown = await p.evaluate(() => !!(game.bubbles[1] && game.bubbles[1].text === "🐰"));
  ok(s6.length === 0 && !shown, "\"show only mine\": the opponent's sticker is not shown and makes no sound", { s6, shown });
  await p.evaluate(() => setOpt("cheer", "all")); await sleep(1300);

  // ---------------------------------------------------------------- 4) the picture on the canvas
  await p.evaluate(() => { window.__draws.length = 0; window.__rec = true; bubble(0, "🦅", 2600); });
  await sleep(2300);
  const ea = await p.evaluate(() => { window.__rec = false; return window.__draws.filter(x => x.t > performance.now() - 2300).slice(); });
  const late = ea.filter(x => x.t - ea[0].t > 350);
  const sc = late.map(x => Math.hypot(x.a, x.b)), sh = late.map(x => Math.abs(x.b) / Math.hypot(x.a, x.b)), xs = late.map(x => x.e);
  ok(late.length > 40, "the eagle sticker is drawn on the canvas every frame", late.length);
  ok(Math.max(...sh) > 0.05 && Math.max(...sc) / Math.min(...sc) > 1.1 && Math.max(...xs) - Math.min(...xs) > 1.5, "...and while it sounds it shakes (rotation), swells (scale) and jitters sideways", { shake: Math.max(...sh), swell: Math.max(...sc) / Math.min(...sc), dx: Math.max(...xs) - Math.min(...xs) });
  await sleep(1500);
  await p.evaluate(() => { window.__draws.length = 0; window.__rec = true; bubble(0, "🎱", 2600); });
  await sleep(2000);
  const pl = await p.evaluate(() => { window.__rec = false; return window.__draws.slice(); }), plate = pl.filter(x => x.t - pl[0].t > 350);
  const psc = plate.map(x => Math.hypot(x.a, x.b)), psh = plate.map(x => Math.abs(x.b)), pxs = plate.map(x => x.e);
  ok(plate.length > 30 && Math.max(...psh) < 1e-6 && Math.max(...psc) - Math.min(...psc) < 0.01 && Math.max(...pxs) - Math.min(...pxs) < 0.01, "a sticker with no voice is drawn still, exactly as before (no rotation, no swelling, no jitter)", { n: plate.length, shake: Math.max(...psh), swell: Math.max(...psc) - Math.min(...psc), dx: Math.max(...pxs) - Math.min(...pxs) });

  // ---------------------------------------------------------------- 5) the world chat: a tap plays it again and wiggles it
  await sleep(1300);
  const tap = await p.evaluate(async () => {
    const log = document.getElementById("wChatLog"); log.innerHTML = `<div class="wcm"><div class="wcb"><div class="wcs" data-s="🐺">${stkHTML("🐺")}</div></div></div><div class="wcm"><div class="wcb"><div class="wcs">${stkHTML("🎱")}</div></div></div>`;
    const n0 = window.__starts.length, voiced = log.querySelector('.wcs[data-s]'), plain = log.querySelectorAll(".wcs")[1];
    voiced.click(); await new Promise(r => setTimeout(r, 300)); voiced.click(); await new Promise(r => setTimeout(r, 300)); plain.click(); await new Promise(r => setTimeout(r, 300));
    return { starts: window.__starts.slice(n0).map(s => +s.d.toFixed(3)), wig: voiced.classList.contains("stkplay"), plainWig: plain.classList.contains("stkplay"), msgAttr: typeof stkHTML === "function" };
  });
  ok(tap.starts.filter(x => x > 1.8 && x < 2.0).length === 2 && tap.wig && !tap.plainWig, "world chat: every tap on a voiced sticker plays its sound (also inside the 1.2 s) and wiggles it; a sticker with no voice does nothing", tap);

  // ---------------------------------------------------------------- 6) the light build: the sounds become files
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8stk-")), out = path.join(tmp, "w");
  try {
    const r = spawnSync("python3", [path.join(ROOT, "tools", "build_web.py"), out], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, INLINE_UNDER: "6000", NO_ZIP: "1" } });
    ok(r.status === 0, "build_web.py makes the light build", (r.stderr || r.stdout).slice(-300));
    if (r.status === 0) {
      const page = fs.readFileSync(path.join(out, "index.html"), "utf8"), mp3 = fs.existsSync(path.join(out, "a")) ? fs.readdirSync(path.join(out, "a")).filter(f => f.endsWith(".mp3")) : [];
      const i = page.indexOf("const STK_VOX = "), j = page.indexOf(";\n", i), vox = eval("(" + page.slice(i + 16, j) + ")");
      ok(mp3.length >= 9 && !/data:audio\/mpeg/.test(page) && Object.values(vox).every(v => /^a\/[0-9a-f]{14}\.mp3$/.test(v.u) && fs.existsSync(path.join(out, v.u))), "the light build moves the nine sounds out of the page into a/<hash>.mp3 and the page keeps their paths", { mp3: mp3.length, u: Object.values(vox).map(v => v.u).slice(0, 2) });
      const bad = mp3.filter(f => { const q = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(out, "a", f)], { encoding: "utf8" }); return q.status !== 0 || !(parseFloat(q.stdout) > 0.3); });
      ok(bad.length === 0, "...and every one is a valid MP3 of more than 0.3 s", bad);
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.close(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
