#!/usr/bin/env node
// Thai (th) and Vietnamese (vi): node tools/test_lang_thvi.js   (B8_ROOT=<repo copy>, SHOT=<dir> for pictures)
//  - both languages are in the picker; the game starts in them (saved language, device language, country)
//  - every one of the 1807 strings (tools/xt.txt) is translated, keeps its {0} {1} placeholders, and is not the English text
//  - the home screen and a few screens switch language without errors
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8772, SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8thvi-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const lines = fs.readFileSync(path.join(ROOT, "tools", "xt.txt"), "utf8").replace(/\n+$/, "").split("\n").map(l => { const [k, v] = l.split("‖"), a = v.split("|"); return { k, th: a[a.length - 2], vi: a[a.length - 1], n: a.length }; });
  ok(lines.length === 1807, "xt.txt has 1807 strings", lines.length);
  const mk = async (prof, locale, tz) => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: locale || "en-US", timezoneId: tz || "Europe/London", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(pr => { localStorage.setItem("b8_hd", "off"); if (pr && !localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(pr)); }, prof);
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    return p;
  };
  try {
    for (const L of ["th", "vi"]) {
      const p = await mk({ name: "Test", tutDone: true, games: 60, lang: L });
      const r = await p.evaluate(([L, lines]) => {
        const out = { lang: LANG, html: document.documentElement.lang, inPicker: LANGS[L], bad: [], same: 0, noPh: [], empty: [] };
        for (const o of lines) {
          const exp = o[L], got = T(o.k);
          if (!exp) { out.empty.push(o.k); continue; }
          if (got !== exp) out.bad.push([o.k, got, exp]);
          const ph = s => (s.match(/\{\d\}/g) || []).sort().join(",");
          if (ph(o.k) && ph(exp) !== ph(o.k)) out.noPh.push(o.k);
          const en = DICT[o.k] && DICT[o.k][0]; if (en && en === exp) out.same++;
        }
        out.core = XL_KEYS.filter(k => !XL[L][k]).length;
        out.home = [...document.querySelectorAll("#home .mc, #home .mcard, #home button")].map(e => e.innerText).join("|").slice(0, 300);
        return out;
      }, [L, lines]);
      ok(r.lang === L && r.html === L, L + ": the game starts in the saved language", r);
      ok(!!r.inPicker, L + ": it is in the language list", r.inPicker);
      ok(r.empty.length === 0, L + ": no empty translation", r.empty.slice(0, 5));
      ok(r.bad.length === 0, L + ": T() returns the translation for all 1807 strings", r.bad.slice(0, 3));
      ok(r.noPh.length === 0, L + ": placeholders kept", r.noPh.slice(0, 3));
      ok(r.same <= (L === "vi" ? 150 : 25), L + ": almost nothing is left in English (Vietnamese keeps city, cue and hall names as they are)", r.same);
      ok(r.core === 0, L + ": the core table has every label", r.core);
      const script = await p.evaluate(L => { const t = [...document.querySelectorAll("#home *")].filter(e => e.children.length === 0).map(e => e.innerText).join(" "); return L === "th" ? /[฀-๿]/.test(t) : /[ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/.test(t); }, L);
      ok(script, L + ": the home screen shows " + L + " text");
      if (SHOT) await p.screenshot({ path: path.join(SHOT, "lang_" + L + ".png") });
      for (const sc of ["shop", "profile", "friends", "tour"]) { try { await p.evaluate(s => { if (typeof go === "function" && document.getElementById(s)) go(s); }, sc); await sleep(500); } catch (e) { errs.push(L + " go " + sc + ": " + e.message.slice(0, 100)); } }
      await p.context().close();
    }
    // the picker switches live
    const p = await mk({ name: "Test", tutDone: true, games: 60, lang: "en" });
    await p.evaluate(() => $("langBtn").click()); await sleep(400);
    const names = await p.evaluate(() => [...document.querySelectorAll("#modal button")].map(x => x.innerText.trim()));
    ok(names.includes("ไทย") && names.includes("Tiếng Việt"), "the picker lists Thai and Vietnamese", names);
    await p.evaluate(() => { [...document.querySelectorAll("#modal button")].find(x => x.innerText.trim() === "Tiếng Việt").click(); }); await sleep(900);
    const v = await p.evaluate(() => ({ l: LANG, t: T("Do'kon"), s: profile.lang })); ok(v.l === "vi" && v.t === "Cửa hàng" && v.s === "vi", "picking Vietnamese switches at once", v);
    await p.evaluate(() => $("langBtn").click()); await sleep(400);
    await p.evaluate(() => { [...document.querySelectorAll("#modal button")].find(x => x.innerText.trim() === "ไทย").click(); }); await sleep(900);
    const t = await p.evaluate(() => ({ l: LANG, t: T("Do'kon") })); ok(t.l === "th" && t.t === "ร้านค้า", "...and Thai", t);
    await p.context().close();
    // automatic choice: a phone in Thailand / Vietnam, device language English or its own
    for (const [loc, tz, want] of [["th-TH", "Asia/Bangkok", "th"], ["vi-VN", "Asia/Ho_Chi_Minh", "vi"], ["en-US", "Asia/Bangkok", "th"], ["en-US", "Asia/Ho_Chi_Minh", "vi"]]) {
      const q = await mk(null, loc, tz); const l = await q.evaluate(() => LANG);
      ok(l === want, `device ${loc} in ${tz} starts in ${want}`, l); await q.context().close();
    }
    const cl = await (await mk({ name: "T", tutDone: true, games: 60, lang: "en" })).evaluate(() => [CC_LANG.TH, CC_LANG.VN, DEV_LANG.th, DEV_LANG.vi]);
    ok(cl[0] === "th" && cl[1] === "vi", "country map: TH->th, VN->vi", cl);
  } catch (e) { ok(false, "exception " + e.message); }
  ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  console.log(`thai/vietnamese: ${pass} passed, ${fail} failed`);
  await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
})();
