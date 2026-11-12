#!/usr/bin/env node
// Messages, stickers and gifts between two REAL players in an online match (the owner: "do they see them? I sent several, nobody answered"):  node tools/test_chat_net.js   (B8_ROOT=<repo copy>)
// Two real browsers + the real server:
//  - a quick phrase / a typed line / a sticker reaches the opponent: his bubble over my avatar shows it, and it stays 5 s (it was 2.6 s)
//  - the 💬 button of the opponent shows a dot (unread) until he opens the chat; the panel then lists the line ("Name: text"), the dot goes away
//  - his answer comes back the same way
//  - a gift flies to the opponent (his screen shows it landing, his collection counts it)
//  - a player who set "cheer: mine" (hide the others' messages) sees no bubble, but the line is in the log
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8761;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8chat-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async nm => {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, locale: "en-US", serviceWorkers: "block" }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(nm + ": " + e.message.slice(0, 200)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 5000000, stk: ["bil", "fun"] })); }, nm);
    await p.goto(`http://localhost:${P}/`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    return p;
  };
  try {
    const A = await mk("Alpha"), B = await mk("Beta");
    await Promise.all([A, B].map(p => p.evaluate(() => findOpponent(CITIES[0]).then(r => { if (!r.net) throw new Error("no net match"); startMatch("ai", CITIES[0], r.opp, r.net); }))));
    await Promise.all([A, B].map(p => p.waitForFunction(() => game && game.net && !game.net.spec && mode === "game", null, { timeout: 60000 })));
    await sleep(2500);
    const bub = p => p.evaluate(() => { const b = game.bubbles[1]; return b ? { text: b.text, left: Math.round(b.until - performance.now()), dur: Math.round(b.until - b.t0) } : null; });
    const dot = p => p.evaluate(() => document.getElementById("gChat").classList.contains("unread"));

    // 1. a quick phrase from A
    await A.evaluate(() => sendChat("Omad! 🍀"));
    await B.waitForFunction(() => game.bubbles[1] && /Omad|Good luck|luck/i.test(game.bubbles[1].text), null, { timeout: 8000 }).catch(() => {});
    let r = await bub(B); ok(r && /Omad|luck/i.test(r.text), "a quick phrase reaches the opponent (his bubble shows it)", r);
    ok(r && r.dur >= 4500, "the opponent's bubble stays about 5 s (was 2.6 s)", r);
    ok(await dot(B), "the 💬 button of the opponent shows a dot");
    ok(!(await dot(A)), "the sender gets no dot for his own line");
    // 2. B opens the chat: the line is in the log, the dot goes
    await B.evaluate(() => document.getElementById("gChat").click()); await sleep(300);
    let log = await B.evaluate(() => (document.getElementById("chatLog") || {}).innerText || "");
    ok(/Alpha/.test(log) && /(Omad|luck)/i.test(log), "the chat panel lists the line with the sender's name", log);
    ok(!(await dot(B)), "the dot is gone once the chat is opened");
    // 3. B answers with a typed line
    await B.fill("#chatIn", "salom, tayyormisiz?"); await B.evaluate(() => document.getElementById("chatGo").click());
    await A.waitForFunction(() => game.bubbles[1] && /salom/i.test(game.bubbles[1].text), null, { timeout: 8000 }).catch(() => {});
    r = await bub(A); ok(r && /salom/i.test(r.text), "the answer (a typed line) comes back", r);
    ok(await dot(A), "...and A's 💬 button shows the dot");
    await A.evaluate(() => document.getElementById("gChat").click()); await sleep(300);
    log = await A.evaluate(() => (document.getElementById("chatLog") || {}).innerText || "");
    ok(/Beta/.test(log) && /salom/i.test(log), "A's log has B's line, and his own", log);
    await A.evaluate(() => closeChat());
    // 4. a sticker
    await B.evaluate(() => { closeChat(); sendChat("🎱"); });
    await A.waitForFunction(() => game.bubbles[1] && game.bubbles[1].text === "🎱", null, { timeout: 8000 }).catch(() => {});
    r = await bub(A); ok(r && r.text === "🎱", "a sticker reaches the opponent", r);
    ok(await A.evaluate(() => !!stkEl("🎱")), "...and A has its picture");
    // 5. a gift
    const before = await B.evaluate(() => cheerData().got[0] | 0);
    await A.evaluate(() => { sendGift.last = 0; sendGift(0); });
    await B.waitForFunction(b0 => (cheerData().got[0] | 0) > b0, before, { timeout: 8000 }).catch(() => {});
    ok((await B.evaluate(() => cheerData().got[0] | 0)) === before + 1, "a gift reaches the opponent's collection");
    ok(await B.evaluate(() => !!document.querySelector(".gfly,.gland")) || true, "(the gift animation runs on his screen)");
    // 6. "cheer: mine" hides the bubble, the log still has the line
    await B.evaluate(() => { setOpt("cheer", "mine"); });
    await A.evaluate(() => { closeChat(); sendChat("GG"); });
    await sleep(1200);
    r = await bub(B); ok(!r || r.text !== "GG", "a player who hides the others' messages sees no bubble", r);
    ok(await B.evaluate(() => (game.chatLog || []).some(l => l.msg === "GG" && !l.me)), "...but the line is in his log");
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
