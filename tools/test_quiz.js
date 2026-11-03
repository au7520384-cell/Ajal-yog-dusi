#!/usr/bin/env node
// Billiard quizzes with a gift (server side, real server on a temp data folder):  node tools/test_quiz.js
// - the daily set: 5 questions, no right answer in what the page gets before it has answered, the same set when asked again
// - a right answer pays 300 coins once (a server grant the game adds at its next sync), a wrong one nothing, answering again nothing; 5/5 adds 1 cash
// - a question linked from a channel post (/api/quiz/one) pays the same way; at most 10 paid answers a day; bad ids / choices are refused
// - the channel's quiz posts point the button at the game question (startapp=q_<id>)
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, ".."), P = 8311, B = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const call = async (u, p, body) => { const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", ...(u ? { authorization: `Bearer ${u.id}:${u.token}` } : {}) }, body: JSON.stringify(body || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const mk = async name => { const r = await call(null, "/api/register", { name }); const u = r.j; await call(u, "/api/sync", { name }); return u; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8quiz-")), srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "channel_bank.json"), "utf8")).filter(x => x.cat === "quiz"), byId = Object.fromEntries(bank.map(x => [x.id, x]));
  const A = await mk("Alisher"), Bo = await mk("Bobur");
  let r = await call(A, "/api/quiz/day"); const items = r.j.items;
  ok(r.s === 200 && items.length === 5 && r.j.coins === 300 && r.j.bonusCash === 1, "the daily set has 5 questions", r.j);
  ok(items.every(x => x.done === null && !("correct" in x) && Array.isArray(x.o) && x.q.uz && x.q.en && byId[x.id]), "no right answer is sent before the answer", items[0]);
  const again = await call(A, "/api/quiz/day"); ok(JSON.stringify(again.j.items.map(x => x.id)) === JSON.stringify(items.map(x => x.id)), "asked again: the same five");
  const other = await call(Bo, "/api/quiz/day"); ok(JSON.stringify(other.j.items.map(x => x.id)) === JSON.stringify(items.map(x => x.id)), "another player gets the same five on the same day");
  // languages: a translation comes with the question, the same number of options (the right answer keeps its place); other languages and unknown ones get no `t` (the page shows English)
  const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "quiz_i18n.json"), "utf8")), langs = Object.keys(i18n);
  ok(langs.includes("ru"), "quiz_i18n.json has Russian", langs);
  for (const lg of langs) {
    const v = (await call(A, "/api/quiz/day", { lang: lg })).j.items; ok(v.length === 5 && v.every(x => x.t && x.t.q && x.t.o.length === x.o.length && x.t.o.every(Boolean)), "the daily set comes in " + lg, v[0]);
  }
  const vx = (await call(A, "/api/quiz/day", { lang: "xx" })).j.items; ok(vx.every(x => !x.t), "an unknown language gets no translation");
  const vu = (await call(A, "/api/quiz/day", { lang: "uz" })).j.items; ok(vu.every(x => !x.t), "Uzbek and English come from the bank itself");
  // a wrong answer
  const q0 = byId[items[0].id], right0 = q0.quiz.correct, wrong0 = (right0 + 1) % q0.quiz.options.length;
  r = await call(A, "/api/quiz/answer", { id: items[0].id, c: wrong0 }); ok(r.s === 200 && r.j.coins === 0 && r.j.done && r.j.done.ok === false && r.j.done.correct === right0 && r.j.done.x.uz, "wrong: nothing paid, the right answer and the explanation are shown", r.j);
  r = await call(A, "/api/quiz/answer", { id: items[0].id, c: right0 }); ok(r.j.again === true && r.j.coins === 0, "the same question again: nothing more is paid", r.j);
  // right answers
  let paid = 0, cash = 0;
  for (let k = 1; k < 5; k++) { const q = byId[items[k].id]; r = await call(A, "/api/quiz/answer", { id: items[k].id, c: q.quiz.correct }); paid += r.j.coins || 0; cash += r.j.cash || 0; ok(r.j.done && r.j.done.ok === true, "right answer " + k, r.j); }
  { const Cc = await mk("Chingiz"), q1 = byId[items[1].id], ans = await call(Cc, "/api/quiz/answer", { id: items[1].id, c: q1.quiz.correct, lang: "ru" }); ok(ans.j.done && ans.j.done.tx && ans.j.done.tx === i18n.ru[items[1].id].x, "the explanation comes in the player's language after the answer", ans.j.done); }
  ok(paid === 4 * 300 && cash === 0, "4 right answers pay 4 x 300 coins and no bonus (one was wrong)", [paid, cash]);
  let sy = await call(A, "/api/sync", { name: "Alisher" }); const g = (sy.j.grants || []).filter(x => x.kind === "quiz");
  ok(g.length === 4 && g.reduce((a, x) => a + (x.coins || 0), 0) === 1200, "the coins arrive as grants at the next sync", g);
  sy = await call(A, "/api/sync", { name: "Alisher" }); ok((sy.j.grants || []).length === 0, "grants are delivered once");
  // 5 of 5 -> +1 cash
  const bday = (await call(Bo, "/api/quiz/day")).j.items; let bcash = 0, bcoins = 0;
  for (const it of bday) { const rr = await call(Bo, "/api/quiz/answer", { id: it.id, c: byId[it.id].quiz.correct }); bcash += rr.j.cash || 0; bcoins += rr.j.coins || 0; }
  ok(bcoins === 1500 && bcash === 1, "5 of 5: 5 x 300 coins and +1 cash", [bcoins, bcash]);
  r = await call(Bo, "/api/quiz/day"); ok(r.j.bonus === true && r.j.items.every(x => x.done && x.done.ok), "the day shows the bonus is paid");
  // a channel question: pays the same; the cap of 10 paid answers a day
  const used = new Set(bday.map(x => x.id)), rest = bank.map(x => x.id).filter(id => !used.has(id));
  r = await call(Bo, "/api/quiz/one", { id: rest[0] }); ok(r.s === 200 && r.j.item.done === null && !("correct" in r.j.item), "a channel question is served without its answer", r.j);
  let got = 0; for (let k = 0; k < 8; k++) { const rr = await call(Bo, "/api/quiz/answer", { id: rest[k], c: byId[rest[k]].quiz.correct }); got += rr.j.coins || 0; }
  ok(got === 5 * 300, "at most 10 paid answers a day (5 more after the daily five)", got);
  ok((await call(Bo, "/api/quiz/one", { id: "ZZZ999" })).s === 404 && (await call(Bo, "/api/quiz/answer", { id: "ZZZ999", c: 0 })).s === 404, "an unknown question is refused");
  ok((await call(A, "/api/quiz/answer", { id: rest[20], c: 99 })).s === 400, "a bad choice is refused");
  ok((await call(null, "/api/quiz/day")).s === 401, "no quiz without a player");
  srv.kill();
  // the channel's quiz post points at the game
  const txt = fs.readFileSync(path.join(ROOT, "server", "server.js"), "utf8");
  ok(/startapp=q_" \+ it\.id/.test(txt) && /Sovg'ani olish/.test(txt), "channel quiz posts link to the game question");
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {} console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
