#!/usr/bin/env node
// The HTML of every build is English for the ad network (tools/portal_html.py), and the game looks and reads exactly as before:  node tools/test_portal_html.js   (B8_ROOT=<repo copy>; ~6 minutes: it makes six builds)
// Y8's developer (Nov 16): "billiard_8's build page is marked and its static HTML text is Uzbek ... Google judges the page from its HTML. Uzbek isn't a Google-supported publisher language, so AdX declines
// the in-game requests ... make the static HTML text English ... restore y8GameId 288343 / y8AppId 6ad579a6abe0343702b12ba1 (the v1.6 build sends Icy Tower's IDs)".
// Then the owner: "did you make lang=en everywhere: Telegram, the app, Playgama too?" - so the step runs in tools/build_web.py (website + Telegram, the Android app, the Y8 zip) and tools/build_crazy.py
// (Playgama, and the CrazyGames / GameMonetize variants); UZ_HTML=1 keeps the plain page (tests only: the builds refuse it outside the temp folder). THE RULE: CLAUDE.md, tools/test_html_lang.js.
// Checked here:
//  - the default build_web.py page (website / Telegram / app): <html lang="en">, no Uzbek label left in the markup (what a crawler reads), the English title / noscript / terms links still there, 85 pieces of text
//    in window.__SEN; it is byte for byte what tools/portal_html.py makes of the plain page, and running the tool on it again changes nothing
//  - window.__SEN is plain ASCII (emoji as \u escapes) and stands AFTER <meta charset> (a host that sends no charset cannot make the labels unreadable), the charset itself is in the first 1024 bytes
//  - the page runs: after start no marker is left in the DOM, and for uz / en / ru / th / tr the static labels, the placeholders / titles and the home screen's text are IDENTICAL to the plain page
//  - the Playgama page and the Y8 zip: the raw HTML says lang=en with no Uzbek label in it (their runtime: tools/test_playgama_ads.js, tools/test_y8_build.js)
//  - the Royal Billiard 8 IDs are in the Y8 page (App 6ad579a6abe0343702b12ba1, Game 288343), not Icy Tower's
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const py = (script, args, env = {}) => spawnSync("python3", [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, env: (() => { const e = { ...process.env, ...env }; delete e.SAME_ORIGIN; if (!("UZ_HTML" in env)) delete e.UZ_HTML; return e; })() });
// the text a crawler reads: the markup outside <script> / <style>
const readable = raw => raw.replace(/<script\b.*?<\/script\s*>/gs, " ").replace(/<style\b.*?<\/style\s*>/gs, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const UZ = ["Do'kon", "O'ynash", "Sozlamalar", "Kiylar", "Reyting", "Sovg'alar", "Do'stlar", "Tanga", "Profil", "Klublar", "Dunyo", "Davlat", "Tadbirlar", "Orqaga", "Yopish"];
const senOf = raw => { const m = raw.match(/window\.__SEN=(\[.*?\]);<\/script>/s); try { return { arr: JSON.parse(m[1]), script: m[0], at: m.index }; } catch (e) { return { arr: [], script: "", at: -1 }; } };
// the raw-HTML rules every build must follow; tag = which build
const rawChecks = (tag, raw) => {
  ok(/<html\b[^>]*\blang="en"/.test(raw.slice(0, 2000)), `${tag}: the raw HTML says lang=en`, [raw.slice(0, 160)]);
  ok(!UZ.some(w => readable(raw).includes(w)), `${tag}: no Uzbek menu label is left in the readable HTML`, UZ.filter(w => readable(raw).includes(w)));
  const s = senOf(raw); ok(s.arr.length >= 70 && s.arr.includes("Do'kon") && s.arr.includes("O'ynash"), `${tag}: the static text sits in window.__SEN (${s.arr.length} pieces)`, s.arr.length);
  ok(s.script && !/[^\x00-\x7f]/.test(s.script), `${tag}: the window.__SEN script is plain ASCII (emoji as \\u escapes)`);
  const cs = raw.indexOf("<meta charset");
  ok(cs >= 0 && s.at > cs, `${tag}: window.__SEN stands after <meta charset>`, { cs, at: s.at });
  ok(/<title>Royal Billiard 8 — Masters League<\/title>/.test(raw) && /free online 8-ball pool game/.test(raw), `${tag}: the English title and the noscript paragraph are still there`);
};
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8phtml-")), plain = path.join(tmp, "plain"), en = path.join(tmp, "en");
  const b1 = py("build_web.py", [plain], { INLINE_UNDER: "6000", NO_ZIP: "1", UZ_HTML: "1" });
  if (b1.status) { console.log(b1.stderr || b1.stdout); process.exit(1); }
  const b2 = py("build_web.py", [en], { INLINE_UNDER: "6000", NO_ZIP: "1" });
  if (b2.status) { console.log(b2.stderr || b2.stdout); process.exit(1); }
  const raw = fs.readFileSync(path.join(en, "index.html"), "utf8"), rawPlain = fs.readFileSync(path.join(plain, "index.html"), "utf8");
  ok(UZ.some(w => readable(rawPlain).includes(w)) && senOf(rawPlain).arr.length === 0, "(UZ_HTML=1 keeps the plain page: its Uzbek labels are in the HTML, nothing moved)");
  ok(/static text moved out of the markup: 85 \(lang=en\)/.test(b2.stdout), "build_web.py (the website, Telegram, the app) reports the 85 pieces it moved", b2.stdout.slice(0, 200));
  rawChecks("website / Telegram / app (build_web.py)", raw);
  // the tool: the plain page through tools/portal_html.py is byte for byte the default build, and a second pass changes nothing
  const t1 = py("portal_html.py", [path.join(plain, "index.html"), path.join(tmp, "cli.html")]);
  ok(t1.status === 0 && /0 pieces left/.test(t1.stdout), "tools/portal_html.py: the Uzbek static text is moved out and nothing is left in the markup", t1.stdout + t1.stderr);
  ok(fs.readFileSync(path.join(tmp, "cli.html"), "utf8") === raw, "the default build is exactly the plain page through tools/portal_html.py");
  const t2 = py("portal_html.py", [path.join(en, "index.html"), path.join(tmp, "cli2.html")]);
  ok(t2.status === 0 && fs.readFileSync(path.join(tmp, "cli2.html"), "utf8") === raw, "running the tool on a page that already went through it changes nothing", t2.stdout + t2.stderr);
  ok(/^[\s\S]{0,1024}<meta charset="utf-8">/.test(Buffer.from(raw, "utf8").subarray(0, 1024).toString("latin1")), "<meta charset> is inside the first 1024 bytes (what a browser looks at before it decodes anything)");
  // the other builds: the raw HTML
  const portals = [["Playgama", { PORTAL: "playgama" }]];   // (the owner does not use the CrazyGames / GameMonetize variants: build_crazy.py still refuses to build them with Uzbek HTML)
  for (const [name, env] of portals) {
    const o = path.join(tmp, "p_" + name), r = py("build_crazy.py", [o], { INLINE_UNDER: "6000", ...env });
    ok(r.status === 0, `${name}: the build is made (tools/build_crazy.py)`, (r.stderr || r.stdout).slice(-300));
    if (r.status) continue;
    const f = fs.readdirSync(o).find(x => /_index\.html$/.test(x)); rawChecks(name, fs.readFileSync(path.join(o, f), "utf8"));
  }
  { const o = path.join(tmp, "y8"), r = py("build_y8.py", [o]); ok(r.status === 0, "Y8: the zip is made (tools/build_y8.py)", (r.stderr || r.stdout).slice(-300));
    if (!r.status) { const h = fs.readFileSync(path.join(o, "index.html"), "utf8"); rawChecks("Y8", h);
      ok(/y8AppId: "6ad579a6abe0343702b12ba1"/.test(h) && /y8GameId: "288343"/.test(h) && !/6a9dd9da38fed6db2f1f1339|282389/.test(h), "Y8: the Royal Billiard 8 IDs (App 6ad579a6..., Game 288343) are in the page, Icy Tower's are not"); } }
  // a static server for both web builds
  const mime = { ".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".wav": "audio/wav", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".js": "text/javascript", ".json": "application/json" };
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(tmp, u === "/" ? "plain/index.html" : u);
    if (!f.startsWith(tmp) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); });   // (no charset in the header on purpose)
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const grab = async (dir, lang) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(dir + " " + lang + ": " + e.message.slice(0, 200)));
    await p.addInitScript(lg => { try { localStorage.setItem("b8_assets", "x"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: lg, coins: 5000 })); } catch (e) {} }, lang);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/${dir}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(900);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); }); await sleep(500);
    // (the "next goal" strip of the home screen picks a goal at random: it is hidden before the home text is compared)
    const r = await p.evaluate(() => ({ lang: document.documentElement.lang, enc: document.characterSet, st: staticText.map(x => x[0].nodeValue), keys: staticText.map(x => x[1]), at: staticAttr.map(x => x[0].getAttribute(x[1])), marker: document.body.innerHTML.includes("⁣"), home: (() => { const g = document.getElementById("hGoal"); if (g) g.style.display = "none"; return document.getElementById("home").innerText.replace(/\d+/g, "#").replace(/\s+/g, " ").trim(); })(), sen: Array.isArray(window.__SEN) }));
    await ctx.close(); return r;
  };
  try {
    for (const lang of ["uz", "en", "ru", "th", "tr"]) {
      const a = await grab("plain", lang), c = await grab("en", lang);
      ok(a.st.length > 60 && c.st.length === a.st.length, `${lang}: the same number of static text pieces (${a.st.length})`, [a.st.length, c.st.length]);
      const bad = a.st.map((x, i) => x === c.st[i] ? null : [i, x, c.st[i]]).filter(Boolean);
      ok(bad.length === 0, `${lang}: every static label reads exactly as without the step (emoji included, the server sends no charset)`, bad.slice(0, 3));
      ok(JSON.stringify(a.keys) === JSON.stringify(c.keys), `${lang}: the language switch keeps the same keys (the original Uzbek text of every label)`);
      ok(JSON.stringify(a.at) === JSON.stringify(c.at), `${lang}: the titles / placeholders / aria labels are identical`, a.at.map((x, i) => x === c.at[i] ? null : [x, c.at[i]]).filter(Boolean).slice(0, 3));
      { let k = 0; while (k < a.home.length && a.home[k] === c.home[k]) k++; ok(a.home === c.home, `${lang}: the home screen's text is identical`, { at: k, plain: a.home.slice(Math.max(0, k - 40), k + 60), en: c.home.slice(Math.max(0, k - 40), k + 60) }); }
      ok(!c.marker && c.sen && c.lang === lang, `${lang}: no marker is left in the page and the page's lang is the player's language (${c.lang})`, { marker: c.marker, sen: c.sen, lang: c.lang });
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
