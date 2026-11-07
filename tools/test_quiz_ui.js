#!/usr/bin/env node
// The quiz in the game, end to end (real server + the page in a browser):  node tools/test_quiz_ui.js
// Free rewards -> "Kunlik viktorina" -> five questions answered right -> the coins (5 x 300) and the +1 000 coin bonus arrive by themselves; a question opened as from a channel post (quizOne) pays once.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8314;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8qui-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "channel_bank.json"), "utf8")).filter(x => x.cat === "quiz"), byText = Object.fromEntries(bank.map(x => [x.quiz.en, x]));
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 900, height: 420 }, locale: "en-US" })).newPage(), errs = [];
  p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
  await p.addInitScript(() => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: "en", coins: 1000 })));
  await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
  await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(1500);
  await p.evaluate(() => go("freeScr")); await sleep(1200);
  ok(await p.$("#frQuiz") !== null, "the Free rewards screen has the daily quiz card");
  const before = await p.evaluate(() => [profile.coins, profile.gems || 0]);
  await p.click("#frQuiz"); await sleep(1200);
  const answerRight = async () => {
    const q = await p.evaluate(() => document.querySelector("#modal .panel").innerText), en = Object.keys(byText).find(k => q.includes(k));
    if (!en) return { err: "question not found: " + q.slice(0, 120) };
    const it = byText[en], right = String(it.quiz.options[it.quiz.correct]);
    const btn = await p.evaluateHandle(r => { const t = T(r); return [...document.querySelectorAll("#mBtns button")].find(x => x.textContent.trim() === t); }, right);   // the game shows the options through T() (Parij -> Paris in English)
    if (!btn.asElement()) return { err: "option not found: " + right };
    await btn.asElement().click(); await sleep(900);
    const res = await p.evaluate(() => document.querySelector("#modal .panel").innerText);
    await p.evaluate(() => { const bs = [...document.querySelectorAll("#mBtns button")]; bs[0].click(); }); await sleep(700);
    return { res };
  };
  let all = true, last = "";
  for (let k = 0; k < 5; k++) { const r = await answerRight(); if (r.err) { ok(false, "question " + (k + 1), r.err); all = false; break; } if (!/Correct!/.test(r.res) || !/\+300/.test(r.res)) { ok(false, "right answer " + (k + 1) + " says Correct! +300", r.res.slice(0, 120)); all = false; } last = r.res; }
  ok(all, "five right answers through the real modals");
  await sleep(1200);
  const txt = await p.evaluate(() => document.querySelector("#modal.on .panel") ? document.querySelector("#modal .panel").innerText : "");
  ok(/5\/5/.test(txt) || /5\/5/.test(last), "the result shows 5/5", [txt.slice(0, 80), last.slice(0, 80)]);
  await p.evaluate(() => { const bs = [...document.querySelectorAll("#mBtns button")]; if (bs[0]) bs[0].click(); }); await sleep(400);
  await p.evaluate(() => Net.sync()); await sleep(1800);
  const after = await p.evaluate(() => [profile.coins, profile.gems || 0]);
  ok(after[0] - before[0] === 2500 && after[1] - before[1] === 0, "the coins (5 x 300 + 1 000 bonus) were added by themselves and no 💎 came with them", [before, after]);
  // the question a channel post links to: another one, once
  const day = await p.evaluate(async () => (await Net.api("/api/quiz/day", {})).items.map(x => x.id)), extra = bank.map(x => x.id).find(id => !day.includes(id));
  await p.evaluate(id => quizOne(id), extra); await sleep(1300);
  const q1 = await p.evaluate(() => document.querySelector("#modal.on .panel") ? document.querySelector("#modal .panel").innerText : "");
  ok(/Question|Savol/.test(q1) && !!Object.keys(byText).find(k => q1.includes(k)), "a channel question opens in the game", q1.slice(0, 100));
  const r1 = await answerRight(); ok(!r1.err && /\+300/.test(r1.res), "a right answer to the channel question pays 300", r1);
  await p.evaluate(() => { const bs = [...document.querySelectorAll("#mBtns button")]; if (bs[0]) bs[0].click(); }); await sleep(300);
  await p.evaluate(id => quizOne(id), extra); await sleep(1200);
  const q2 = await p.evaluate(() => document.querySelector("#modal.on .panel") ? document.querySelector("#modal .panel").innerText : "");
  ok(/already answered|avval javob/i.test(q2), "the same channel question again says it was answered", q2.slice(0, 100));
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {} console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
