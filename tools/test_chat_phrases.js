#!/usr/bin/env node
// Ready-made chat phrases are shown in the READER's own language (14 languages), text typed by hand stays as written, and the phrase panel scrolls on a low screen:  node tools/test_chat_phrases.js
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8688;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cp-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch(), errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 844, height: 300 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(() => localStorage.getItem("billiard8v2") || localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en" })));
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(800);
    // 1) every phrase has a translation in every language (not the Uzbek source)
    const cov = await p.evaluate(() => { const ph = [...CHAT, ...DM_QUICK], out = {}; for (const k of Object.keys(LANGS)) { applyLang(k); out[k] = k === "uz" ? [] : ph.filter(x => T(x) === x); } applyLang("en"); return { n: ph.length, langs: Object.keys(LANGS).length, miss: Object.entries(out).filter(([k, v]) => v.length) }; });
    ok(cov.n === 14 && cov.langs === 14 && cov.miss.length === 0, "all 14 phrases are translated in all 14 languages", cov);
    // 2) the spectator chat: a phrase from an Uzbek sender is read in the reader's language, hand-typed text is untouched
    const sp = await p.evaluate(() => { const out = {}; for (const k of ["ko", "en", "ru", "uz"]) { applyLang(k); specInfo.log = [{ name: "Ali", avatar: 1, frame: 0, msg: "Yaxshi o'yin! 🤝" }, { name: "Vali", avatar: 2, frame: 0, msg: "Salom do'stlar" }, { me: true, msg: "Rahmat!" }]; const L = document.getElementById("specLog"); specDrawLog(); out[k] = [...L.querySelectorAll(".splb")].map(e => e.textContent.replace(/^(Ali|Vali|Siz|You|Вы|나)/, "")); out[k + "_exp"] = [T("Yaxshi o'yin! 🤝"), T("Rahmat!")]; } applyLang("en"); return out; });
    ok(sp.ko[0] === sp.ko_exp[0] && sp.ko[0] !== "Yaxshi o'yin! 🤝" && /[가-힣]/.test(sp.ko[0]), "spectator chat, Korean reader: the phrase is Korean", sp.ko);
    ok(sp.ru[0] === sp.ru_exp[0] && /[а-яё]/i.test(sp.ru[0]), "spectator chat, Russian reader: the phrase is Russian", sp.ru);
    ok(sp.ko[1] === "Salom do'stlar" && sp.ru[1] === "Salom do'stlar" && sp.en[1] === "Salom do'stlar", "hand-typed text is shown exactly as written", [sp.ko[1], sp.ru[1]]);
    ok(sp.ko[2] === sp.ko_exp[1] && sp.uz[0] === "Yaxshi o'yin! 🤝", "own phrase is translated too; Uzbek stays Uzbek", sp.uz);
    // 3) friends' messages: the quick button sends the SOURCE phrase, the reader sees his language
    const dm = await p.evaluate(async () => {
      const sent = []; Object.defineProperty(Net, "acct", { value: { id: "me" }, configurable: true });
      Net.api = (u, body) => { if (u.startsWith("/api/dm/send")) { sent.push(body); return Promise.resolve({ msg: { me: true, t: body.text, at: Date.now() } }); } if (u.startsWith("/api/dm?")) return Promise.resolve({ friend: { id: "f1", name: "Kim" }, msgs: [{ me: false, t: "Rahmat!", at: Date.now() - 5000 }, { me: false, t: "Qalaysan do'st", at: Date.now() - 3000 }] }); return Promise.resolve({}); };
      applyLang("ko"); openDm("f1"); await new Promise(r => setTimeout(r, 900));
      const btn = document.querySelector('#modal [data-q="3"]'); const label = btn && btn.textContent; btn && btn.click(); await new Promise(r => setTimeout(r, 400));
      const shown = [...document.querySelectorAll("#fdmBox .chatmsg")].map(e => e.firstChild.textContent);
      const r = { sent, label, shown, ko: T("Rahmat!"), ko4: T("Yaxshi o'yin! 👍") }; applyLang("en"); return r; });
    ok(dm.sent.length === 1 && dm.sent[0].text === "Yaxshi o'yin! 👍", "the quick DM button sends the source phrase (not the sender's translation)", dm.sent);
    ok(dm.shown[0] === dm.ko && /[가-힣]/.test(dm.shown[0]), "a received phrase is shown in Korean", dm.shown);
    ok(dm.shown[1] === "Qalaysan do'st", "a received hand-typed text is shown as written", dm.shown);
    // 4) the phrase panel scrolls on a low screen (a phone held sideways): tabs stay, the list scrolls, nothing is cut off
    await p.evaluate(() => { $("modal").classList.remove("on"); toMenu && toMenu(); }); await sleep(500);
    await p.evaluate(() => startMatch("ai", CITIES[0], botPlayer(1, 4))); await sleep(3500);
    const pn = await p.evaluate(async () => { buildChat("p"); $("chatPanel").classList.add("on"); await new Promise(r => setTimeout(r, 300)); const P = $("chatPanel"), L = P.querySelector(".citems"), pr = P.getBoundingClientRect(), t0 = L.scrollTop; const full = L.scrollHeight > L.clientHeight; L.scrollTop = 9999; await new Promise(r => setTimeout(r, 100)); return { panelBottom: Math.round(pr.bottom), vh: innerHeight, top: Math.round(pr.top), canScroll: full, moved: L.scrollTop > t0, lastVisible: (() => { const last = L.lastElementChild.getBoundingClientRect(), lr = L.getBoundingClientRect(); return last.bottom <= lr.bottom + 1; })(), tabs: !!P.querySelector(".ctabs"), input: !!P.querySelector("#chatIn") }; });
    ok(pn.panelBottom <= pn.vh && pn.canScroll && pn.moved && pn.lastVisible && pn.tabs && pn.input, "on a 300 px high screen the panel fits, the list scrolls to the last phrase, tabs and the typing row stay", pn);
    ok(errs.length === 0, "no page errors", errs);
  } finally { await b.close(); srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("pass " + pass + ", fail " + fail); process.exit(fail ? 1 : 0);
})();
