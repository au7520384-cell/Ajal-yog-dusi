#!/usr/bin/env node
// The world chat (the owner: "like Mobile Legends: one chat for players of the whole world, with stickers; each line shows the sender's league; a player who posts a lobby gets a Join button next to it;
// pressing it asks the lobby's owner (✓ accept / ✗ decline); accepted = he joins the lobby, declined = not"; his video: chat on the left, the list of lobbies that look for players on the right):
//   node tools/test_world_chat.js   (SHOT=dir saves pictures; B8_ROOT=<repo copy>)
// Real server + real Chromium phones (4 players):
//  - the small round button on the home screen opens the window; lines show name, league badge, level; text / emoji / the stickers the player owns; everybody sees everybody's lines within a few seconds
//  - links, phone numbers, @names are refused (a toast), swear words are masked, the same line twice and a flood are stopped, a muted player cannot write
//  - the host posts his open lobby: a card in the list on the right with the table, the entry fee, the seats (1/8) and his league; the lobby's CODE is never in what the server sends to the room
//  - Join sends the host a request (✓ / ✗ banner): declined = the asking player stays out, accepted = he is in that lobby; no answer in time = "did not answer"; too many open requests = "busy"; a closed lobby leaves the list
//  - tap a name: report (the admin page / API lists it; three different reporters mute the sender for a while) and block (his lines are hidden here)
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wc-")), P = +process.env.TEST_PORT || 8721, base = `http://localhost:${P}`, KEY = "testadminkey123", errs = [];
  if (SHOT) fs.mkdirSync(SHOT, { recursive: true });
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, ADMIN_KEY: KEY, WORLD_REQ_MS: "7000", WORLD_PENDING_MAX: "1" }, stdio: "ignore" }); await sleep(2500);
  const b = await chromium.launch();
  const mk = async (name, o = {}) => {
    const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1 }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 200)));
    await p.addInitScript(n => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 50000 })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(800);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(500);
    await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); try { checkAch(); } catch (e) {} }); await sleep(700);
    p._name = name; return p;
  };
  const until = async (fn, to = 14000, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
  const open = async p => { await p.evaluate(() => { document.getElementById("modal").classList.remove("on"); const w = document.getElementById("wChat"); if (!w.classList.contains("on")) document.getElementById("hWorld").click(); }); await sleep(900); };
  const rows = p => p.evaluate(() => [...document.querySelectorAll("#wChatLog .wcm")].map(r => ({ id: +r.dataset.id, me: r.classList.contains("me"), name: (r.querySelector(".wch b") || {}).textContent, text: (r.querySelector(".wcx") || {}).textContent || "", stk: !!r.querySelector(".wcs img"), lg: !!r.querySelector(".wch img.lgm") })));
  const lobs = p => p.evaluate(() => [...document.querySelectorAll("#wLobList .wlc")].map(r => ({ txt: r.textContent, off: r.classList.contains("off"), lg: !!r.querySelector("img.lgm"), join: r.querySelector("[data-w]") ? { dis: r.querySelector("[data-w]").disabled, txt: r.querySelector("[data-w]").textContent } : null, name: (r.querySelector(".wln b") || {}).textContent })));
  const hasL = async (p, f, to) => until(async () => (await lobs(p)).some(f), to);
  const say = async (p, t) => { await p.evaluate(t => { const i = document.getElementById("wChatIn"); i.value = t; document.getElementById("wChatGo").click(); }, t); };
  const toasts = p => p.evaluate(() => (document.getElementById("toasts") || {}).textContent || "");
  const has = async (p, f, to) => until(async () => (await rows(p)).some(f), to);
  const shot = (p, n) => SHOT ? p.screenshot({ path: path.join(SHOT, n + ".png") }) : 0;
  const api = (p, url, body) => p.evaluate(([u, bd]) => Net.api(u, bd).then(r => ({ ok: true, r }), e => ({ ok: false, e: e.message, status: e.status })), [url, body || null]);
  const adm = async (url, body) => { const r = await fetch(base + url, { method: body ? "POST" : "GET", headers: { "x-admin-key": KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const A = await mk("Host"), B = await mk("Guest"), C = await mk("Third"), D = await mk("Fourth");
    // ---- the button and the window
    const btn = await A.evaluate(() => { const e = document.getElementById("hWorld"), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { w: r.width, h: r.height, x: r.x, y: r.y, hit: t === e || e.contains(t), vis: getComputedStyle(e).display !== "none" }; });
    ok(btn.vis && btn.w >= 30 && btn.h >= 30 && btn.x >= 0 && btn.y >= 0 && btn.hit, "the small round world-chat button is on the home screen, big enough to tap and not covered", btn);
    await shot(A, "home_button");
    await open(A); ok(await A.evaluate(() => document.getElementById("wChat").classList.contains("on") && document.getElementById("wChatT").textContent === "World chat"), "the button opens the window (title in the player's language)");
    ok(await A.evaluate(() => /No messages yet/.test(document.getElementById("wChatLog").textContent)), "an empty room says so");
    ok(await until(async () => await A.evaluate(() => /No open lobbies yet/.test(document.getElementById("wLobList").textContent)), 6000), "the list on the right says there is no open lobby yet");
    const lay = await A.evaluate(() => { const R = s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, r.width, r.height]; }; return { vp: [innerWidth, innerHeight], panel: R(".wcp"), chat: R(".wcol1"), list: R(".wcol2"), input: R("#wChatIn"), post: R("#wLobPost"), go: R("#wChatGo") }; });
    ok(lay.panel[0] >= 0 && lay.panel[1] >= 0 && lay.panel[2] <= lay.vp[0] + 1 && lay.panel[3] <= lay.vp[1] + 1, "the window fits the screen", lay);
    ok(lay.chat[4] > 300 && lay.list[4] > 200 && lay.chat[2] <= lay.list[0] + 1, "two panes side by side: chat on the left, the lobby list on the right (like the video)", lay);
    ok(lay.input[3] <= lay.panel[3] && lay.input[4] > 80 && lay.go[5] >= 28 && lay.post[3] <= lay.panel[3], "the text box, the send button and the list's button are inside the window and big enough", lay);
    await shot(A, "world_empty");
    // ---- text
    await say(A, "salom hammaga");
    ok(await has(A, r => r.me && r.text === "salom hammaga" && r.lg && r.name === "Host"), "my line appears at once with my name and my league badge");
    await open(B); ok(await has(B, r => r.text === "salom hammaga" && r.name === "Host" && !r.me && r.lg, 8000), "another player opening the room sees what was written (history), with the sender's name and league");
    await say(B, "hello from Guest");
    ok(await has(A, r => r.text === "hello from Guest" && !r.me && r.name === "Guest"), "a line written by another player reaches me within a few seconds");
    // ---- filters and limits
    const before = (await rows(B)).length;
    const verdicts = []; for (const bad of ["write me t.me/spam", "call +998 90 123 45 67", "add @someone_x", "visit www.site.com", "go to casino.uz"]) { await sleep(3200); verdicts.push((await api(B, "/api/world/send", { text: bad })).e); }   // (3 s apart: the server lets one line through per 3 s)
    ok(verdicts.every(v => v === "link"), "the server refuses links, phone numbers, @names, www. and domains (5 tries, each answered \"link\")", verdicts);
    ok((await rows(B)).length === before, "...and none of them reached the room", await rows(B));
    await sleep(3200); await say(B, "write me t.me/spam"); await sleep(700);
    ok(/Links, phone numbers/.test(await toasts(B)), "...and the player who types one is told why (toast)", await toasts(B));
    await sleep(3400); await say(B, "give me 100 000 coins");   // (the server lets one line through per 3 s; the refused tries above used the tokens up)
    ok(await has(B, r => r.me && r.text === "give me 100 000 coins"), "a line with an ordinary number goes through");
    await sleep(3400); await say(B, "you are a fuck"); ok(await has(B, r => r.me && /\*{4}/.test(r.text) && !/fuck/i.test(r.text)), "a swear word is masked with stars");
    const dup1 = (await rows(B)).length; await sleep(3400); await say(B, "same line"); await sleep(1200); await say(B, "same line"); await sleep(1500);
    ok((await rows(B)).length === dup1 + 1, "the same line again within 20 s is dropped", (await rows(B)).slice(-3));
    const flood = await api(B, "/api/world/send", { text: "x1" }), f2 = await B.evaluate(async () => { const out = []; for (let i = 0; i < 6; i++) out.push(await Net.api("/api/world/send", { text: "flood " + i }).then(() => "ok", e => e.message)); return out; });
    ok(f2.includes("slow"), "a flood from one player is stopped by the server (slow)", f2);
    // ---- stickers (the ones the player owns)
    await A.evaluate(() => { profile.stk = ["bil"]; }); await A.evaluate(() => document.getElementById("wChatEmo").click()); await sleep(400);
    const stk = await A.evaluate(() => [...document.querySelectorAll("#wChatEmoRow button[data-s] img")].length); ok(stk >= 9, "the emoji panel offers the stickers of the owned pack (9) and plain emoji", stk);
    await sleep(1100); await A.evaluate(() => document.querySelector("#wChatEmoRow button[data-s]").click());
    ok(await has(B, r => r.stk && r.name === "Host", 9000), "a sticker is shown as a picture to the others");
    const badStk = await api(A, "/api/world/send", { stk: "💣" }); ok(!badStk.ok && /bad/.test(badStk.e), "a sticker that is not in the game's packs is refused", badStk);
    await shot(B, "chat_text_sticker");
    // ---- typing with the game's own keyboard (the owner: "I must read what I am typing"): full screen on a touch phone = the keys stand at the bottom of the screen
    await D.evaluate(() => { window.__fs = true; Object.defineProperty(document, "fullscreenElement", { get: () => window.__fs ? document.documentElement : null, configurable: true }); document.dispatchEvent(new Event("fullscreenchange")); }); await sleep(500);
    await open(D); await D.evaluate(() => { const i = document.getElementById("wChatIn"); i.blur(); i.focus(); }); await sleep(800);
    const kbw = await D.evaluate(() => { const r = s => { const e = document.querySelector(s).getBoundingClientRect(); return [e.left, e.top, e.right, e.bottom]; }; return { igk: document.documentElement.classList.contains("igk"), kb: r("#igk"), box: r("#wChatIn"), panel: r(".wcp"), post: r("#wLobPost") }; });
    ok(kbw.igk && kbw.panel[3] <= kbw.kb[1] + 1 && kbw.box[3] <= kbw.kb[1] + 1 && kbw.box[1] >= 0 && kbw.panel[1] >= -1, "full screen + the game's keyboard: the window and its text box stand above the keys", kbw);
    const kkey = (p, c) => p.evaluate(c => { const k = [...document.querySelectorAll("#igk button")].find(x => x.dataset.c === c || x.dataset.c === c.toUpperCase() || x.dataset.s === c); k.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, c);
    for (const c of ["H", "i"]) await kkey(D, c);
    ok((await D.evaluate(() => document.querySelector("#igk .pv .pt").textContent)) === "Hi▏" && (await D.evaluate(() => document.getElementById("wChatIn").value)) === "Hi", "what is typed is shown in the strip above the keys (Hi)");
    await shot(D, "chat_with_keyboard");
    await kkey(D, "ok");
    ok(await has(A, r => r.text === "Hi" && r.name === "Fourth", 9000) && await D.evaluate(() => document.getElementById("wChatIn").value === ""), "the keyboard's ✓ key sends the line (the others get it), the box and the strip are empty again");
    await D.evaluate(() => { WorldChat.close(); window.__fs = false; document.dispatchEvent(new Event("fullscreenchange")); }); await sleep(500);
    // ---- a lobby post
    ok(await A.evaluate(() => /Open a lobby/.test(document.getElementById("wLobPost").textContent)), "without a lobby the button under the list says \"Open a lobby\"");
    await A.evaluate(() => { WorldChat.close(); lobbyCreate(CITIES[0].id, []); }); await A.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 60000 }); await sleep(800);
    const code = await A.evaluate(() => LB.code);
    ok(await A.evaluate(() => !!document.getElementById("lbWorld")), "the host's lobby screen has the \"post to the world chat\" button");
    ok(await A.evaluate(() => !document.getElementById("lbWorld").disabled), "the post button is enabled");
    await shot(A, "lobby_screen");
    await A.evaluate(() => document.getElementById("lbWorld").click());
    ok(await hasL(B, r => /London/.test(r.txt) && r.name === "Host", 9000), "the post shows up in the lobby list as a card");
    const card = (await lobs(B)).find(r => /London/.test(r.txt));
    ok(card && /1\/8/.test(card.txt) && /Entry fee/.test(card.txt) && card.join && !card.join.dis && /Join/.test(card.join.txt) && card.lg, "the card shows the table, the seats (1/8), the fee, the host's league and an enabled Join button", card);
    ok(await B.evaluate(() => /Lobbies · 1/.test(document.getElementById("wLobT").textContent)), "the list's title counts the lobbies");
    const raw = await B.evaluate(() => fetch(Net.base + "/api/world", { headers: { Authorization: `Bearer ${Net.acct.id}:${Net.acct.token}` } }).then(r => r.text()));
    ok(!raw.includes(code) && !/"code"/.test(raw), "the lobby's code is NOT in what the server sends to the room", raw.slice(0, 200));
    const again = await api(A, "/api/world/lobby", {}); ok(!again.ok && /wait|slow/.test(again.e), "posting the same lobby again at once is refused (wait)", again);
    const noLobby = await api(B, "/api/world/lobby", {}); ok(!noLobby.ok && /nolobby/.test(noLobby.e), "a player who has no open lobby cannot post one", noLobby);
    ok(await B.evaluate(() => (document.querySelector("#wLobList .wlc .btn") || {}).textContent.includes("➜")), "Join carries the arrow like in the video");
    await shot(B, "world_lobby_list");
    // ---- join: declined
    await B.evaluate(() => document.querySelector("#wLobList [data-w]").click());
    ok(await B.waitForFunction(() => document.querySelector("#wReq .wrq.me"), null, { timeout: 8000 }).then(() => true, () => false), "Join shows the asking player a waiting line (with Cancel)");
    ok(await A.waitForFunction(() => document.querySelector("#wReq .wrq .y") && document.querySelector("#wReq .wrq .n"), null, { timeout: 8000 }).then(() => true, () => false), "the host gets the request with ✓ and ✗ right where he is (his lobby screen)");
    await sleep(600);   // (the banner pops in with an animation: measure it when it stands still)
    const bn = await A.evaluate(() => { const t = document.querySelector("#wReq .wrq .t"); return { txt: t.textContent, w: document.querySelector("#wReq .wrq .y").getBoundingClientRect().width }; });
    ok(/Guest/.test(bn.txt) && /accept/i.test(bn.txt) && bn.w >= 30, "...naming the player and asking \"accept?\" with buttons big enough to tap", bn);
    await shot(A, "host_request_banner");
    await A.evaluate(() => document.querySelector("#wReq .wrq .n").click());
    ok(await until(async () => /declined/i.test(await toasts(B)), 9000), "declined: the asking player is told", await toasts(B));
    ok(await B.evaluate(() => !LB && !document.querySelector("#wReq .wrq")), "...and stays out of the lobby, the waiting line is gone");
    ok(await A.evaluate(() => LB.players.length === 1), "the lobby still has only its host");
    // ---- join: accepted
    await sleep(1500); await B.evaluate(() => document.querySelector("#wLobList [data-w]").click());
    await A.waitForFunction(() => document.querySelector("#wReq .wrq .y"), null, { timeout: 8000 }); await A.evaluate(() => document.querySelector("#wReq .wrq .y").click());
    ok(await B.waitForFunction(c => LB && !LB.pending && LB.code === c, code, { timeout: 15000 }).then(() => true, () => false), "accepted: the asking player is in the host's lobby (same code)");
    ok(await until(() => A.evaluate(() => LB.players.length === 2), 10000), "the host's lobby now has 2 players");
    // ---- join: no answer / closed
    await C.evaluate(() => { document.getElementById("modal").classList.remove("on"); });
    await open(C); ok(await hasL(C, r => /2\/8/.test(r.txt), 9000), "a third player sees the card with the seats NOW (2/8)", await lobs(C));
    const wid = await C.evaluate(() => document.querySelector("#wLobList [data-w]").dataset.w);
    await C.evaluate(() => document.querySelector("#wLobList [data-w]").click()); await sleep(900);
    const busy = await api(D, "/api/world/join", { wid }); ok(busy.ok && busy.r.state === "busy", "a lobby that already has the most open requests answers \"busy\" (the host is not flooded with pop-ups)", busy);
    ok(await until(async () => /did not answer/i.test(await toasts(C)), 16000), "no answer from the host in time: \"did not answer\"", await toasts(C));
    await A.evaluate(() => { for (const e of document.querySelectorAll("#wReq .wrq")) e.remove(); });
    await A.evaluate(() => lbLeave()); await sleep(1500);
    ok(await until(async () => (await lobs(C)).length === 0, 12000), "a closed lobby leaves the list", await lobs(C));
    ok(await C.evaluate(() => /No open lobbies yet/.test(document.getElementById("wLobList").textContent)), "...and the list says so");
    const goneJoin = await api(C, "/api/world/join", { wid: "0000000000" }); ok(goneJoin.ok && goneJoin.r.state === "gone", "Join on a lobby that is gone answers \"gone\"", goneJoin);
    // ---- block / report
    await C.evaluate(() => document.querySelector('#wChatLog .wch[data-u]').click()); await sleep(500);
    const who = await C.evaluate(() => ({ on: document.getElementById("modal").classList.contains("on"), btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent.trim()) }));
    ok(who.on && who.btns.length === 3 && /Report/.test(who.btns[0]) && /Block/.test(who.btns[1]), "tapping a name opens: Report / Block / Close", who);
    const hostId = await A.evaluate(() => Net.acct.id);
    await C.evaluate(() => document.querySelectorAll("#mBtns button")[1].click()); await sleep(600);
    ok(await C.evaluate(h => !document.querySelector(`#wChatLog [data-u="${h}"]`) && (profile.wblock || []).includes(h), hostId), "block: the blocked player's lines are gone from my room");
    await C.evaluate(() => { document.querySelector('#wChatLog [data-u]') && document.querySelector('#wChatLog [data-u]').click(); }); await sleep(400);
    const noMine = await C.evaluate(() => document.getElementById("modal").classList.contains("on")); await C.evaluate(() => document.getElementById("modal").classList.remove("on"));
    await C.evaluate(h => { profile.wblock = (profile.wblock || []).filter(x => x !== h); WorldChat.draw(true); }, hostId); await sleep(300);
    // report through the window, then three reporters mute
    await C.evaluate(() => document.querySelector('#wChatLog .wch[data-u]').click()); await sleep(400); await C.evaluate(() => document.querySelectorAll("#mBtns button")[0].click()); await sleep(600);
    ok(/Report sent/.test(await toasts(C)), "report: the reporter gets \"Report sent\"", await toasts(C));
    const adminList = await adm("/api/world/admin"); ok(adminList.status === 200 && adminList.j.reports.length >= 1 && adminList.j.msgs.some(m => m.text === "salom hammaga"), "the admin list shows the room's lines and the report", adminList.status);
    ok((await fetch(base + "/api/world/admin")).status === 403, "the admin list refuses a request without the key");
    const mid = adminList.j.msgs.find(m => m.uid === hostId && m.kind === "text").id;
    ok(Array.isArray(adminList.j.lobbies), "the admin list also shows the lobbies in the room");
    for (const p of [B, D]) { await p.evaluate(() => { WorldChat.close(); }); const r = await api(p, "/api/world/report", { mid }); ok(r.ok, "a report goes through (" + p._name + ")"); }
    const muteTry = await api(A, "/api/world/send", { text: "after reports" }); ok(!muteTry.ok && /muted/.test(muteTry.e), "three different reporters mute the sender (30 minutes): he cannot write", muteTry);
    const un = await adm("/api/world/mute", { uid: hostId, mins: 0 }); const back = await api(A, "/api/world/send", { text: "back again" }); ok(un.status === 200 && back.ok, "the admin can unmute at once", [un.status, back]);
    await adm("/api/world/mute", { uid: hostId, mins: 5 }); await A.evaluate(() => { document.getElementById("wChatIn").value = "muted try"; document.getElementById("wChatGo").click(); }); await sleep(900);
    ok(/cannot write/i.test(await toasts(A)), "a muted player who types gets \"You cannot write for now\"", await toasts(A)); await adm("/api/world/mute", { uid: hostId, mins: 0 });
    // ---- deleting an account takes his lines, posts and reports out of the room (Google Play: "delete my data")
    const dTok = await D.evaluate(() => `${Net.acct.id}:${Net.acct.token}`), dId = dTok.split(":")[0];
    const preDel = await adm("/api/world/admin"); ok(preDel.j.msgs.some(m => m.uid === dId), "(before) the admin list has the fourth player's line");
    await D.close();
    const del = await fetch(base + "/api/account/delete", { method: "POST", headers: { Authorization: "Bearer " + dTok, "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) }); ok(del.status === 200, "the fourth player deletes his account", del.status);
    const postDel = await adm("/api/world/admin"); ok(!postDel.j.msgs.some(m => m.uid === dId) && !postDel.j.reports.some(x => x.uid === dId || x.by === dId), "...and none of his lines or reports is left in the room", postDel.j.msgs.map(m => m.uid));
    // ---- a match closes the room; the page text in another language
    await A.evaluate(() => { WorldChat.close(); });
    ok(await A.evaluate(() => !document.getElementById("wChat").classList.contains("on")), "the window closes with its ✕ / button");
    await open(A); await A.evaluate(() => document.getElementById("wChat").click()); await sleep(400);
    ok(await A.evaluate(() => !document.getElementById("wChat").classList.contains("on")), "a tap on the dark side closes it too");
    await shot(A, "home_after");
    ok(errs.length === 0, "no page errors", errs);
    await b.close();
  } catch (e) { fail++; console.log("EXCEPTION", e.message.slice(0, 600)); try { await b.close(); } catch (x) {} }
  srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
