#!/usr/bin/env node
// THE RULE (the owner, Nov 16: "never lang=uz, never forget this"): the HTML of every page the game ships is English, never lang="uz", with no Uzbek label in it:  node tools/test_html_lang.js   (B8_ROOT=<repo copy>; ~30 s, no browser)
// Why: Y8's developer found that Google AdX judges a page from its raw HTML and does not serve Uzbek pages, so it declined every in-game ad request (noAdPreloaded, eCPM $0.01: no income).
// The Uzbek labels in index.html's markup are only the keys of the translations: tools/portal_html.py (run by build_web.py and build_crazy.py) moves them into window.__SEN and the page puts them back when it starts.
// Run this before every commit that touches index.html (and rebuild web/ first: SAME_ORIGIN=1 INLINE_UNDER=6000 NO_ZIP=1 python3 tools/build_web.py web). Checked here:
//  - the source index.html says lang="en"; no other HTML file / page in the repo says lang="uz"; the manifest has no lang
//  - the committed web/ (what the website and Telegram serve) is built from THIS index.html and its HTML is English with no Uzbek label in it
//  - a default build_web.py page, a Playgama page and the app's page (tools/build_android.sh checks it too) are English
//  - UZ_HTML=1 (the plain Uzbek labels, used by the tests only) is refused when the output is not in the temp folder, and nothing is written
const path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto"), { spawnSync } = require("child_process");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const py = (script, args, env = {}) => spawnSync("python3", [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, env: (() => { const e = { ...process.env, ...env }; delete e.SAME_ORIGIN; if (!("UZ_HTML" in env)) delete e.UZ_HTML; return e; })() });
const readable = raw => raw.replace(/<script\b.*?<\/script\s*>/gs, " ").replace(/<style\b.*?<\/style\s*>/gs, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const UZ = ["Do'kon", "O'ynash", "Sozlamalar", "Kiylar", "Reyting", "Sovg'alar", "Do'stlar", "Tanga", "Profil", "Klublar", "Dunyo", "Davlat", "Tadbirlar", "Orqaga", "Yopish"];
const htmlTag = raw => (raw.slice(0, 3000).match(/<html\b[^>]*>/i) || [""])[0];
// an English page: lang=en, the moved text sits in an ASCII script after <meta charset>, nothing Uzbek is readable
const english = (tag, raw) => {
  ok(/\blang="en"/.test(htmlTag(raw)) && !/lang="uz"/i.test(raw.slice(0, 3000)), `${tag}: <html lang="en">, never uz`, htmlTag(raw));
  ok(!UZ.some(w => readable(raw).includes(w)), `${tag}: no Uzbek menu label is readable in the HTML`, UZ.filter(w => readable(raw).includes(w)));
  const m = raw.match(/window\.__SEN=(\[.*?\]);<\/script>/s);
  ok(m && JSON.parse(m[1]).length >= 70 && !/[^\x00-\x7f]/.test(m[0]) && m.index > raw.indexOf("<meta charset"), `${tag}: the Uzbek labels sit in the ASCII script window.__SEN after <meta charset>`, m && JSON.parse(m[1]).length);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8lang-"));
try {
  // ---- the sources
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(/\blang="en"/.test(htmlTag(src)) && !/lang="uz"/i.test(src.slice(0, 3000)), "the source index.html says lang=\"en\" (its Uzbek labels are translation keys; the builds move them out of the HTML)", htmlTag(src));
  const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git", "android", "web", "y8_site", "y8_site_light", "crazy_site", "web_site"].includes(f.name)) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(html?|webmanifest)$/.test(f.name) || p.endsWith("server/server.js")) files.push(p); } })(ROOT);
  const bad = files.filter(f => /<html\b[^>]*\blang=["']?uz\b|"lang"\s*:\s*"uz"|lang=\\?"uz\\?"/i.test(fs.readFileSync(f, "utf8").replace(/<script\b.*?<\/script\s*>/gs, (m) => m))).map(f => path.relative(ROOT, f));
  ok(bad.length === 0, "no HTML file, manifest or page in server.js says lang=uz", bad);
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8")); ok(!("lang" in man) || man.lang === "en", "the web manifest has no Uzbek lang", man.lang);
  for (const [n, s] of [["tools/build_web.py", ""], ["tools/build_crazy.py", ""]]) { const t = fs.readFileSync(path.join(ROOT, n), "utf8"); ok(/portal_html\.english_static/.test(t) && /plain_allowed/.test(t), `${n} runs the English-HTML step and guards UZ_HTML`); }
  ok(/lang="en"/.test(fs.readFileSync(path.join(ROOT, "tools/build_android.sh"), "utf8")) && /window\.__SEN=/.test(fs.readFileSync(path.join(ROOT, "tools/build_android.sh"), "utf8")), "tools/build_android.sh fails the app build if its HTML is not English");
  ok(fs.existsSync(path.join(ROOT, "CLAUDE.md")) && /never lang="uz"|NEVER lang="uz"/i.test(fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8")), "CLAUDE.md carries the rule (every session reads it)");
  // ---- the committed web/ (website + Telegram): built from this index.html, English
  const WEB = path.join(ROOT, "web");
  if (fs.existsSync(path.join(WEB, "index.html"))) {
    ok(fs.readFileSync(path.join(WEB, ".src"), "utf8").trim() === crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, "index.html"))).digest("hex"), "web/ is built from the current index.html (else the server would serve the single-file page with Uzbek labels): rebuild web/");
    english("web/index.html (website + Telegram)", fs.readFileSync(path.join(WEB, "index.html"), "utf8"));
  }
  // ---- fresh builds
  const w = path.join(tmp, "w"), r1 = py("build_web.py", [w], { INLINE_UNDER: "6000", NO_ZIP: "1" });
  ok(r1.status === 0, "build_web.py (default) is made", (r1.stderr || r1.stdout).slice(-300)); if (!r1.status) english("a default build_web.py page", fs.readFileSync(path.join(w, "index.html"), "utf8"));
  const a = path.join(tmp, "a"), r2 = py("build_crazy.py", [a], { INLINE_UNDER: "6000", PORTAL: "playgama" });
  ok(r2.status === 0, "the Playgama build is made", (r2.stderr || r2.stdout).slice(-300)); if (!r2.status) english("the Playgama page", fs.readFileSync(path.join(a, "playgama_index.html"), "utf8"));
  // ---- UZ_HTML=1 (the plain Uzbek labels) is for the tests only
  const rootInTmp = fs.realpathSync(ROOT).startsWith(fs.realpathSync(os.tmpdir()) + path.sep);   // (a repo copy inside the temp folder has no "outside": the refusal cannot be tried there)
  for (const [n, script, env] of rootInTmp ? [] : [["build_web.py", "build_web.py", { INLINE_UNDER: "6000", NO_ZIP: "1" }], ["build_crazy.py", "build_crazy.py", { INLINE_UNDER: "6000", PORTAL: "playgama" }]]) {
    const outside = path.join(ROOT, "_uz_html_must_not_exist"), r = py(script, [outside], { ...env, UZ_HTML: "1" });
    ok(r.status !== 0 && /tests only/.test(r.stderr + r.stdout) && !fs.existsSync(outside), `${n}: UZ_HTML=1 is refused outside the temp folder and nothing is written`, { status: r.status, out: (r.stderr + r.stdout).slice(0, 200) });
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch (e) {}
  }
  const pl = path.join(tmp, "plain"), r3 = py("build_web.py", [pl], { INLINE_UNDER: "6000", NO_ZIP: "1", UZ_HTML: "1" });
  ok(r3.status === 0 && UZ.some(x => readable(fs.readFileSync(path.join(pl, "index.html"), "utf8")).includes(x)), "(control) UZ_HTML=1 inside the temp folder still gives the plain page with its Uzbek labels, so the checks above can fail");
} finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
