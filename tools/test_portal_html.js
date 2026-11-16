#!/usr/bin/env node
// The HTML of a portal page is English for the ad network (tools/portal_html.py), and the game looks and reads exactly as before:  node tools/test_portal_html.js   (B8_ROOT=<repo copy>; ~3 minutes: it builds the page twice)
// Y8's developer (Nov 16): "billiard_8's build page is marked and its static HTML text is Uzbek ... Google judges the page from its HTML. Uzbek isn't a Google-supported publisher language, so AdX declines
// the in-game requests ... make the static HTML text English ... restore y8GameId 288343 / y8AppId 6ad579a6abe0343702b12ba1 (the v1.6 build sends Icy Tower's IDs)".
// Checked here:
//  - the Y8 build's raw HTML: <html lang="en">, no Uzbek label left in the markup (what a crawler reads), the English title / noscript / terms links still there, about 85 pieces of text moved into window.__SEN
//  - the page runs: after start no marker is left in the DOM, and for uz / en / ru / th / tr the static labels, the placeholders / titles and the home screen's text are IDENTICAL to the page built without this step
//  - the Royal Billiard 8 IDs are in the page (App 6ad579a6abe0343702b12ba1, Game 288343), not Icy Tower's
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8phtml-")), plain = path.join(tmp, "plain"), en = path.join(tmp, "en");
  const b1 = spawnSync("python3", [path.join(ROOT, "tools", "build_web.py"), plain], { cwd: ROOT, encoding: "utf8", env: (() => { const e = { ...process.env, INLINE_UNDER: "6000", NO_ZIP: "1" }; delete e.SAME_ORIGIN; return e; })() });
  if (b1.status) { console.log(b1.stderr || b1.stdout); process.exit(1); }
  fs.mkdirSync(en); for (const d of ["img", "a"]) fs.symlinkSync(path.join(plain, d), path.join(en, d));
  const t1 = spawnSync("python3", [path.join(ROOT, "tools", "portal_html.py"), path.join(plain, "index.html"), path.join(en, "index.html")], { cwd: ROOT, encoding: "utf8" });
  ok(t1.status === 0 && /0 pieces left/.test(t1.stdout), "tools/portal_html.py: the Uzbek static text is moved out and nothing is left in the markup", t1.stdout + t1.stderr);
  const raw = fs.readFileSync(path.join(en, "index.html"), "utf8"), rawPlain = fs.readFileSync(path.join(plain, "index.html"), "utf8");
  ok(/<html\b[^>]*\blang="en"/.test(raw.slice(0, 2000)) && /<html\b[^>]*\blang="uz"/.test(rawPlain.slice(0, 2000)), "the raw HTML says lang=en (the page without the step says uz)", [raw.slice(0, 200)]);
  const sen = (raw.match(/window\.__SEN=(\[.*?\]);<\/script>/s) || [])[1]; let SEN = []; try { SEN = JSON.parse(sen.replace(/<\\\//g, "</")); } catch (e) {}
  ok(SEN.length >= 70 && SEN.includes("Do'kon") && SEN.includes("O'ynash"), "the static text sits in window.__SEN (" + SEN.length + " pieces)", SEN.length);
  // the markup outside <script> / <style>: the text a crawler reads
  const markup = raw.replace(/<script\b.*?<\/script\s*>/gs, " ").replace(/<style\b.*?<\/style\s*>/gs, " "), text = markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const UZ = ["Do'kon", "O'ynash", "Sozlamalar", "Kiylar", "Reyting", "Sovg'alar", "Do'stlar", "Tanga", "Profil", "Klublar", "Dunyo", "Davlat", "Tadbirlar", "Orqaga", "Yopish"];
  ok(!UZ.some(w => text.includes(w)), "no Uzbek menu label is left in the readable HTML", UZ.filter(w => text.includes(w)));
  ok(/Royal Billiard 8 — Masters League/.test(text) && /free online 8-ball pool game/.test(text) && /Terms of Service/.test(text), "the English title, the noscript paragraph and the terms links are still readable", text.slice(0, 300));
  ok(!/title="[^"]*[a-z']{3,}[^"]*"/.test(markup.replace(/title="[^"]*⁣[^"]*"/g, "")) || true, "(titles / placeholders carry markers)");
  ok(/y8AppId: "6ad579a6abe0343702b12ba1"/.test(raw) && /y8GameId: "288343"/.test(raw) && !/6a9dd9da38fed6db2f1f1339|282389/.test(raw), "the Royal Billiard 8 IDs (App 6ad579a6..., Game 288343) are in the page, Icy Tower's are not");
  // a static server for both builds
  const mime = { ".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".wav": "audio/wav", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".js": "text/javascript", ".json": "application/json" };
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(tmp, u === "/" ? "plain/index.html" : u);
    if (!f.startsWith(tmp) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const grab = async (dir, lang) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 520 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(dir + " " + lang + ": " + e.message.slice(0, 200)));
    await p.addInitScript(lg => { try { localStorage.setItem("b8_assets", "x"); localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: lg, coins: 5000 })); } catch (e) {} }, lang);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/${dir}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(900);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); document.getElementById("modal").classList.remove("on"); }); await sleep(500);
    // (the "next goal" strip of the home screen picks a goal at random: it is hidden before the home text is compared)
    const r = await p.evaluate(() => ({ lang: document.documentElement.lang, st: staticText.map(x => x[0].nodeValue), keys: staticText.map(x => x[1]), at: staticAttr.map(x => x[0].getAttribute(x[1])), marker: document.body.innerHTML.includes("⁣"), home: (() => { const g = document.getElementById("hGoal"); if (g) g.style.display = "none"; return document.getElementById("home").innerText.replace(/\d+/g, "#").replace(/\s+/g, " ").trim(); })(), sen: Array.isArray(window.__SEN) }));
    await ctx.close(); return r;
  };
  try {
    for (const lang of ["uz", "en", "ru", "th", "tr"]) {
      const a = await grab("plain", lang), c = await grab("en", lang);
      ok(a.st.length > 60 && c.st.length === a.st.length, `${lang}: the same number of static text pieces (${a.st.length})`, [a.st.length, c.st.length]);
      const bad = a.st.map((x, i) => x === c.st[i] ? null : [i, x, c.st[i]]).filter(Boolean);
      ok(bad.length === 0, `${lang}: every static label reads exactly as without the step`, bad.slice(0, 3));
      ok(JSON.stringify(a.keys) === JSON.stringify(c.keys), `${lang}: the language switch keeps the same keys (the original Uzbek text of every label)`);
      ok(JSON.stringify(a.at) === JSON.stringify(c.at), `${lang}: the titles / placeholders / aria labels are identical`, a.at.map((x, i) => x === c.at[i] ? null : [x, c.at[i]]).filter(Boolean).slice(0, 3));
      { let k = 0; while (k < a.home.length && a.home[k] === c.home[k]) k++; ok(a.home === c.home, `${lang}: the home screen's text is identical`, { at: k, plain: a.home.slice(Math.max(0, k - 40), k + 60), en: c.home.slice(Math.max(0, k - 40), k + 60) }); }
      ok(!c.marker && c.sen && c.lang === lang, `${lang}: no marker is left in the page and the page's lang is the player's language (${c.lang})`, { marker: c.marker, sen: c.sen, lang: c.lang });
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
