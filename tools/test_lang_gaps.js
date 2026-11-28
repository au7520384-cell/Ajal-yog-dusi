#!/usr/bin/env node
// No phrase of the game falls back to English (or stays Uzbek) in another language: node tools/test_lang_gaps.js   (B8_ROOT=<repo copy>; ~1 min, one browser, no game server)
// Found Nov 28 by the owner's tester: in a game played in Chinese the first-run "Who are you?" popup was in ENGLISH. Cause: 85 phrases in tools/xt.txt had only the Thai and
// Vietnamese values (2-value lines), so tr es pt ar id hi fr de ko ja zh had no entry and T() fell back to DICT's English text.
//  1) tools/xt.txt: every line has 2, 13 or 15 values, none empty, the {0} {1} placeholders of the key are kept in every value
//  2) in the page, for each of the 13 languages (tr es pt ar id hi fr de ko ja zh th vi): no DICT key (2100+) lacks a translation, and no literal T("...") of the source stays the Uzbek key
//  3) the first-run "Who are you?" popup, made by the game's own genderAskWait(), in zh / ja / ko / ar / hi: title, text and keys are the translations, no English word on them
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const LANGS = ["tr", "es", "pt", "ar", "id", "hi", "fr", "de", "ko", "ja", "zh", "th", "vi"];
const RAW_UZBEK_OK = new Set(["ID"]);   // a literal that is the same in every language
(async () => {
  // ---- 1) the source file
  const lines = fs.readFileSync(path.join(ROOT, "tools", "xt.txt"), "utf8").replace(/\n+$/, "").split("\n");
  const ph = s => (s.match(/\{\d\}/g) || []).sort().join(","), badShape = [], badPh = [], empty = [];
  for (const ln of lines) {
    const [k, v] = ln.split("‖"), a = (v || "").split("|");
    if (![2, 13, 15].includes(a.length)) { badShape.push([k, a.length]); continue; }
    a.forEach((t, i) => { if (!t.trim()) empty.push([k, i]); else if (ph(t) !== ph(k)) badPh.push([k, i]); });
  }
  ok(lines.length > 2000, "xt.txt is there", lines.length);
  ok(!badShape.length, "every line of xt.txt has 2, 13 or 15 values", badShape.slice(0, 3));
  ok(!empty.length, "no empty value in xt.txt", empty.slice(0, 3));
  ok(!badPh.length, "every value keeps the {0} {1} placeholders of its key", badPh.slice(0, 5));
  // the literal keys of T("...") / TT("...") in the page's source (template strings with ${} are dynamic: skipped)
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), keys = new Set(), re = /\bTT?\(\s*(?:"((?:[^"\\\n]|\\.){2,260})"|'((?:[^'\\\n]|\\.){2,260})')/g;
  for (let m; (m = re.exec(src));) {
    let k = m[1] !== undefined ? m[1] : m[2];
    try { k = m[1] !== undefined ? JSON.parse('"' + k.replace(/\\'/g, "'") + '"') : k.replace(/\\'/g, "'").replace(/\\"/g, '"'); } catch (e) { continue; }
    if (/[A-Za-zЀ-ӿ]/.test(k)) keys.add(k);
  }
  ok(keys.size > 900, "the literal T() keys were found in the source", keys.size);

  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const open = async lang => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", hasTouch: true, isMobile: true, deviceScaleFactor: 1 }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(l => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Test", tutDone: true, games: 3, lang: l, coins: 1000 })); }, lang);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); });
    return { ctx, p };
  };
  try {
    // ---- 2) coverage in the page
    { const { ctx, p } = await open("zh"); await sleep(1500);
      ok(await p.evaluate(() => XT_READY), "the full phrase table is loaded for a player in another language");
      const r = await p.evaluate(([keys, langs]) => {
        const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k), out = {}, all = Object.keys(DICT), eng = k => DICT[k][0] !== k && /[A-Za-z]{3}/.test(DICT[k][0]);
        for (const l of langs) {
          LANG = l; const o = out[l] = { dict: all.filter(k => eng(k) && !(XL[l] && own(XL[l], k) && XL[l][k])), uz: [] };
          for (const k of keys) { if (XL[l] && own(XL[l], k) && XL[l][k]) continue; if (own(DICT, k)) continue; if (T(k) === k) o.uz.push(k); }
        }
        LANG = "zh"; return out;
      }, [[...keys], LANGS]);
      for (const l of LANGS) {
        ok(r[l].dict.length === 0, l + ": every phrase of the dictionary has a " + l + " translation (no English fallback)", r[l].dict.slice(0, 6));
        ok(r[l].uz.filter(k => !RAW_UZBEK_OK.has(k)).length === 0, l + ": no literal T() text stays Uzbek", r[l].uz.filter(k => !RAW_UZBEK_OK.has(k)).slice(0, 6));
      }
      await ctx.close(); }
    // ---- 3) the first-run popup the tester saw
    for (const L of ["zh", "ja", "ko", "ar", "hi"]) {
      const { ctx, p } = await open(L); await sleep(3500);   // genderAskWait() polls every 1.5 s
      const r = await p.evaluate(() => { const m = document.getElementById("modal"), t = e => e ? e.textContent : "";
        return { on: m.classList.contains("on"), title: t(document.getElementById("mTitle")), text: t(document.getElementById("mText")) || t(document.querySelector("#modal .panel p")), btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent),
          want: [T("Siz kimsiz?"), T("Avatar sizga mos qo'yiladi. Keyin Profilda o'zgartira olasiz."), T("Hozirgisi qolsin")], en: DICT["Siz kimsiz?"][0], lang: LANG }; });
      ok(r.on && r.lang === L, L + ": the first-run popup opens in " + L, r);
      ok(r.title === r.want[0] && r.title !== r.en, L + ": its title is the " + L + " text, not \"Who are you?\"", r);
      ok(r.text === r.want[1], L + ": its text is translated", r);
      ok(r.btns.length === 3 && r.btns[2] === r.want[2], L + ": its three keys are translated", r.btns);
      ok(!/[A-Za-z]{3}/.test([r.title, r.text, ...r.btns].join(" ")), L + ": no English word on the popup", [r.title, r.text, r.btns]);
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  ok(errs.length === 0, "no page error", errs.slice(0, 3));
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
