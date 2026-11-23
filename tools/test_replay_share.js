#!/usr/bin/env node
// The replay window's Share, end to end (Nov 23, the owner's Telegram screenshots):  node tools/test_replay_share.js   (B8_ROOT=<repo copy>; ~3 minutes; the real game server + a mock of Telegram's WebApp)
// What the owner saw: on an upright phone the video preview + "Save" under the keys pushed the table off the screen, Share did not send anything to people, it only offered to download the clip.
//  1) the window always fits: the picture, the caption and the four keys are inside the screen on an upright phone (the page turned), a small landscape phone and a computer; nothing is added below the keys after Share
//  2) Telegram: Share uploads the shot (/api/replay) and opens Telegram's chat picker (t.me/share/url) with a link t.me/<bot>/<app>?startapp=r_<id> and the text; no video, no download link anywhere
//  3) the shot survives the trip: the positions that arrive equal the recorded ones (to 1/16 px), with and without the browser's deflate
//  4) whoever opens the link sees the shot in his game: the Telegram start parameter r_<id> (and it is NOT taken for a lobby code), the web link ?r=<id>&ref=<code> (the address is cleaned afterwards); the caption is in HIS language
//  5) a phone's browser that can share files gets the clip itself (a real video file) and nothing is uploaded; one that cannot share files gets the web link through its share sheet
//  6) no connection: nothing is shared, the player is told, and Share works again; an unknown / old link says so and shows nothing
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8795, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const TGMOCK = sp => `window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){},onEvent(){},offEvent(){},isFullscreen:false,initData:"",initDataUnsafe:{start_param:${JSON.stringify(sp || "")}},version:"8.0",platform:"android",openTelegramLink(u){window.__tgOpened=(window.__tgOpened||[]).concat([u])},openLink(u){window.__linkOpened=u},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}};`;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8rs-")), errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, TELEGRAM_APP_LINK: "https://t.me/TestBot/Play" }, stdio: "ignore" });
  await sleep(2600);
  const b = await chromium.launch();
  const mk = async ({ tg, sp, vp, lang, url, init }) => {
    const ctx = await b.newContext({ viewport: vp || { width: 412, height: 915 }, locale: "en-US", deviceScaleFactor: 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 250)));
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => /telegram-web-app\.js/.test(r.request().url()) ? r.fulfill({ contentType: "application/javascript", body: TGMOCK(sp) }) : r.abort());
    await p.addInitScript(([l, extra]) => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 30, lang: l, coins: 100000, genderAsked: true, country: "UZ", avatar: 3 })); if (extra) { try { (0, eval)(extra); } catch (e) {} } }, [lang || "en", init || ""]);
    await p.goto(url || (tg ? `${base}/?tgWebAppVersion=8.0#tgWebAppData=x` : `${base}/`), { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.unlock = () => {}; window.checkAch = () => {}; });
    await sleep(2500);
    return { p, ctx };
  };
  const repOn = p => p.evaluate(() => { const e = document.getElementById("proRep"); return !!e && e.classList.contains("on"); });   // (the window is made when the first shot is played)
  const clearModals = p => p.evaluate(() => { const m = document.getElementById("modal"), r = document.getElementById("proRep"); if (m && !(r && r.classList.contains("on"))) m.classList.remove("on"); }).catch(() => {});
  const winTrick = async (p, i) => {   // play trick shot i (the shot the layout was built around) until its window opens
    await p.evaluate(i => { window.toast = () => {}; trickStart({ mode: "daily", i }); }, i);
    for (let k = 0; k < 120; k++) { await sleep(200); if (await p.evaluate(() => !!game && game.type === "trick" && !game.moving && canControl())) break; }
    await p.evaluate(() => { const G = game, L = G.trick.layout; G.angle = Math.atan2(L.segs[0][1].y - L.segs[0][0].y, L.segs[0][1].x - L.segs[0][0].x); requestShot(0.6); });
    for (let k = 0; k < 120; k++) { await sleep(250); if (await p.evaluate(() => document.getElementById("modal").classList.contains("on"))) break; }
    await sleep(500);
    await p.evaluate(() => { document.querySelector("#mBtns button.purple").click(); });   // (the "watch" key of the trick-shot window: purple, whatever the language)
    await sleep(1200);
  };
  const inside = p => p.evaluate(() => { const names = ["#proRepC", "#proRepCap", ".pr-bar"], out = {}; let allIn = true;
    for (const s of names) { const e = document.querySelector(s), r = e.getBoundingClientRect(); out[s] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; if (!(r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && Math.max(r.width, r.height) > 20 && Math.min(r.width, r.height) > 8)) allIn = false; }   // (the page may be turned: width and height swap)
    const btns = [...document.querySelectorAll(".pr-bar button")].filter(x => x.offsetParent).map(x => { const r = x.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
    return { allIn, out, btns, n: btns.length, vid: document.querySelectorAll("#proRep video, #proRep a[download]").length, save: !!document.getElementById("proRepSave"), inner: [innerWidth, innerHeight] }; });

  // ------------------------------------------------------------------ 1 + 2) the Telegram sender on an upright phone
  const A = await mk({ tg: true, lang: "ru" });
  ok(await A.p.evaluate(() => !!TG && /t\.me\/TestBot\/Play/.test(TG_LINK)), "the Telegram test page knows its Mini App link");
  await winTrick(A.p, 0);
  const lay0 = await inside(A.p);
  ok(lay0.allIn && lay0.n === 4 && lay0.btns.every(Boolean), "upright phone (page turned): the picture, the caption and the four keys are inside the screen", lay0);
  await A.p.evaluate(() => document.querySelector("#proRep [data-a=share]").click());
  await sleep(2500);
  const lay1 = await inside(A.p), opened = await A.p.evaluate(() => window.__tgOpened || []);
  ok(lay1.allIn && lay1.vid === 0 && !lay1.save && JSON.stringify(lay1.out) === JSON.stringify(lay0.out), "after Share the window is the same: no video, no save link, nothing pushes the table", { lay0: lay0.out, lay1: lay1.out, vid: lay1.vid });
  const um = /^https:\/\/t\.me\/share\/url\?url=([^&]+)&text=(.+)$/.exec(opened[0] || ""), link = um ? decodeURIComponent(um[1]) : "", id = (/startapp=r_([A-Za-z0-9]{10})$/.exec(link) || [])[1];
  ok(opened.length === 1 && /^https:\/\/t\.me\/TestBot\/Play\?startapp=r_[A-Za-z0-9]{10}$/.test(link) && decodeURIComponent(um[2]).includes("Royal Billiard 8"), "Telegram's chat picker opens once with the link t.me/<bot>/<app>?startapp=r_<id> and the text", opened);
  // the shot on the server, and the trip of the positions
  const acct = await A.p.evaluate(() => ({ id: Net.acct.id, token: Net.acct.token, code: Net.acct.code }));
  const got = await (await fetch(`${base}/api/replay?id=${id}`, { headers: { Authorization: `Bearer ${acct.id}:${acct.token}` } })).json();
  ok(got.replay && got.replay.n >= 20 && got.replay.nb === 3 && got.by.name === "Logistika" && got.replay.kind === "trick" && got.replay.wk && got.replay.z === 1, "the server has the shot: frames, 3 balls, a trick, the name of the account, deflated", got.replay && { n: got.replay.n, nb: got.replay.nb, kind: got.replay.kind, wk: got.replay.wk, z: got.replay.z, by: got.by });
  const trip = await A.p.evaluate(async p => { const R = PRO.rep, back = await proUnpackReplay(p), N = R.F.f.length, nb = R.F.nums.length, stride = Math.max(1, N / (REP_SEC * 60)); let worst = 0, off = 0;
    for (let k = 0; k < back.f.length; k++) { const o = R.F.f[Math.min(N - 1, Math.floor(k * stride))]; for (let i = 0; i < nb * 2; i++) { if (i % 2 === 0 && o[i] < -9000) { if (back.f[k][i] > -9000) off++; continue; } worst = Math.max(worst, Math.abs(o[i] - back.f[k][i])); } }
    return { worst, off, frames: back.f.length, N, nums: back.nums.join() === R.F.nums.join() }; }, got.replay);
  ok(trip.worst <= 1 / 32 + 1e-6 && trip.off === 0 && trip.nums && trip.frames === Math.min(600, Math.floor((trip.N - 1) / Math.max(1, trip.N / 600)) + 1), "the positions that come back equal the recorded ones (to 1/32 px), the balls that left the table are still off", trip);
  // without the browser's deflate: a plain shot (z = 0), and the page that cannot inflate refuses the other kind cleanly
  const plain = await A.p.evaluate(async () => { const R = PRO.rep, z = window.CompressionStream; window.CompressionStream = undefined; let body; try { body = await proPackReplay(R); } finally { window.CompressionStream = z; } const back = await proUnpackReplay(body); return { z: body.z, n: body.n, ok: back.f.length === body.n }; });
  ok(plain.z === 0 && plain.ok, "a browser without CompressionStream sends the shot plain and it unpacks", plain);

  // ------------------------------------------------------------------ 4) a Telegram receiver: the start parameter r_<id>, in his own language, and not a lobby
  const R1 = await mk({ tg: true, sp: "r_" + id, lang: "en", init: "window.__lobby = 0;" });
  await R1.p.evaluate(() => { try { lobbyJoin = function () { window.__lobby++; }; } catch (e) {} });
  let on = false; for (let k = 0; k < 40 && !on; k++) { await clearModals(R1.p); await sleep(700); on = await repOn(R1.p); }
  const rv = await R1.p.evaluate(() => ({ on: !!document.getElementById("proRep") && document.getElementById("proRep").classList.contains("on"), cap: (document.getElementById("proRepCap") || {}).textContent, n: PRO.rep && PRO.rep.F.f.length, nums: PRO.rep && PRO.rep.F.nums.length, lobby: window.__lobby | 0, name: PRO.rep && PRO.rep.entry.rec.name, expect: T("Bort orqali zarba") }));
  ok(rv.on && rv.n === got.replay.n && rv.nums === 3 && rv.name === "Logistika", "a Telegram receiver (start parameter r_<id>) sees the shot: same frames and balls, shown under the sharer's name", rv);
  ok(rv.cap && rv.cap !== "Прямой удар" && /^[\x20-\x7e]+$/.test(rv.cap), "the caption is in the RECEIVER's language (English here), not the sharer's (Russian)", rv.cap);
  ok(rv.lobby === 0, "the start parameter r_<id> is not taken for a lobby code", rv.lobby);
  const sum = async p => p.evaluate(() => { let s = 0; for (const a of PRO.rep.F.f) for (const v of a) s += v; return +s.toFixed(3); });
  const s1 = await sum(R1.p), s0 = await A.p.evaluate(async p => { const back = await proUnpackReplay(p); let s = 0; for (const a of back.f) for (const v of a) s += v; return +s.toFixed(3); }, got.replay);
  ok(Math.abs(s1 - s0) < 0.01, "his frames are exactly what the server holds", { s1, s0 });
  const lay2 = await inside(R1.p);
  ok(lay2.allIn && lay2.n === 4, "and the window fits on his screen too", lay2);
  // Share on the receiver's side: the same link again (no second upload)
  const before = await R1.p.evaluate(() => (window.__tgOpened || []).length);
  await R1.p.evaluate(() => document.querySelector("#proRep [data-a=share]").click()); await sleep(1200);
  const re = await R1.p.evaluate(() => window.__tgOpened || []);
  ok(re.length === before + 1 && decodeURIComponent(re[re.length - 1]).includes("startapp=r_" + id), "he can pass the same link on: no new upload, the same id", re);
  await R1.ctx.close();

  // ------------------------------------------------------------------ 4b) the web link ?r=<id>&ref=<code>
  const W1 = await mk({ url: `${base}/?r=${id}&ref=${acct.code}`, vp: { width: 800, height: 360 }, lang: "uz" });
  on = false; for (let k = 0; k < 40 && !on; k++) { await clearModals(W1.p); await sleep(700); on = await repOn(W1.p); }
  const wv = await W1.p.evaluate(() => ({ on: !!document.getElementById("proRep") && document.getElementById("proRep").classList.contains("on"), n: PRO.rep && PRO.rep.F.f.length, search: location.search, cap: (document.getElementById("proRepCap") || {}).textContent }));
  const lay3 = await inside(W1.p);
  ok(wv.on && wv.n === got.replay.n && wv.search === "" && lay3.allIn && lay3.n === 4, "the web link ?r=<id> opens the shot on a small landscape phone (the address is cleaned, the window fits)", { wv, lay3: lay3.out });
  ok(/Bort|zarba|Zarba/i.test(wv.cap), "the Uzbek receiver reads it in Uzbek", wv.cap);
  await W1.ctx.close();

  // ------------------------------------------------------------------ 4c) the page restarts itself while it starts (the HD pictures do it): the shot is not lost although the address was cleaned
  const W3 = await mk({ url: `${base}/`, lang: "en" });
  const want = p => p.evaluate(() => { try { const w = JSON.parse(localStorage.getItem("b8rp") || "null"); return w && w.id || null; } catch (e) { return null; } });   // (what the page remembers: {id, at} in the game's store)
  await W3.p.evaluate(id => { document.getElementById("modal").classList.add("on"); proSharedWant(id); }, id);   // (a popup is in the way: the shot waits)
  const kept0 = await want(W3.p);
  ok(kept0 === id, "a shared link is remembered for the tab while a popup keeps it waiting", kept0);
  await W3.p.reload({ waitUntil: "commit" });
  await W3.p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 });
  on = false; for (let k = 0; k < 40 && !on; k++) { await clearModals(W3.p); await sleep(700); on = await repOn(W3.p); }
  const rl = await W3.p.evaluate(() => ({ n: PRO.rep && PRO.rep.F.f.length })); rl.kept = await want(W3.p);
  ok(on && rl.n === got.replay.n && rl.kept === null, "after the restart the shot is shown, and forgotten once shown", { on, rl });
  await W3.p.evaluate(() => document.querySelector("#proRep [data-a=close]").click());
  await W3.p.reload({ waitUntil: "commit" });
  await W3.p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 180000 });
  await sleep(4500); await clearModals(W3.p); await sleep(2500);
  ok(!(await repOn(W3.p)), "...and a later restart does not show it again");
  await W3.ctx.close();

  // ------------------------------------------------------------------ 5) web senders: a phone that can share files, one that cannot
  const W2 = await mk({ lang: "en", vp: { width: 915, height: 412 }, init: "window.__shared = []; navigator.share = async d => { window.__shared.push({ files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })), url: d.url || '', text: d.text || '' }); }; navigator.canShare = d => !!(d && d.files && d.files.length && window.__canFiles);" });
  await W2.p.evaluate(() => { window.__canFiles = true; });
  await winTrick(W2.p, 1);
  await W2.p.evaluate(() => { window.__toasts = []; window.toast = (i, t) => { window.__toasts.push(String(t)); }; });   // (winTrick silenced the toasts: record them instead)
  const lay4 = await inside(W2.p);
  ok(lay4.allIn && lay4.n === 4, "a computer-sized landscape page: the window fits", lay4);
  await W2.p.evaluate(() => document.querySelector("#proRep [data-a=share]").click());
  let sh = []; for (let k = 0; k < 60 && !sh.length; k++) { await sleep(500); sh = await W2.p.evaluate(() => window.__shared); }
  ok(sh.length === 1 && sh[0].files.length === 1 && /^video\/(webm|mp4)/.test(sh[0].files[0].type) && sh[0].files[0].size > 5000 && sh[0].text.includes("Royal Billiard 8"), "a phone that can share files gets the clip itself (a real video file)", sh);
  await W2.p.evaluate(() => { window.__canFiles = false; window.__shared = []; });
  await sleep(400);
  await W2.p.evaluate(() => document.querySelector("#proRep [data-a=share]").click());
  sh = []; for (let k = 0; k < 40 && !sh.length; k++) { await sleep(400); sh = await W2.p.evaluate(() => window.__shared); }
  ok(sh.length === 1 && sh[0].files.length === 0 && new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\?r=[A-Za-z0-9]{10}&ref=[A-Za-z0-9]+$`).test(sh[0].url), "a phone that cannot share files gets the web link ?r=<id>&ref=<code> in its share sheet", sh);

  // ------------------------------------------------------------------ 6) no connection, an old link
  await W2.p.evaluate(() => { window.__shared = []; }); await W2.p.route("**/api/replay", r => r.abort());
  await W2.p.evaluate(() => { PRO.rep.entry.link = null; });
  await W2.p.evaluate(() => document.querySelector("#proRep [data-a=share]").click()); await sleep(2500);
  const off = await W2.p.evaluate(() => ({ shared: window.__shared.length, busy: !!PRO.rep.busy, toasts: window.__toasts.slice(-3) }));
  ok(off.shared === 0 && !off.busy && off.toasts.some(t => /connection|internet/i.test(t)), "no connection: nothing is shared, the player is told, and Share can be pressed again", off);
  await W2.p.unroute("**/api/replay");
  await W2.p.evaluate(() => document.querySelector("#proRep [data-a=close]").click());
  await W2.p.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("mini"); }); await sleep(800);   // (a shared shot never interrupts a match: it waits for the menu)
  await W2.p.evaluate(() => { proSharedOpen("AAAAAAAAAA"); }); await sleep(3000);
  const gone = await W2.p.evaluate(() => ({ on: !!document.getElementById("proRep") && document.getElementById("proRep").classList.contains("on"), toasts: window.__toasts.slice(-3) })); gone.kept = await W2.p.evaluate(() => { try { const w = JSON.parse(localStorage.getItem("b8rp") || "null"); return w && w.id || null; } catch (e) { return null; } });
  ok(!gone.on && gone.toasts.some(t => /not found|expired/i.test(t)) && gone.kept === null, "an unknown link shows nothing, says so, and is forgotten", gone);
  await W2.ctx.close();

  // ------------------------------------------------------------------ the best shot of a match (analysis) is shared the same way, and the receiver writes its text in HIS language
  await A.p.evaluate(() => { const r = document.getElementById("proRep"); if (r) r.classList.remove("on"); PRO.rep = null; document.getElementById("modal").classList.remove("on"); });
  const best = await A.p.evaluate(async () => { const F = { f: [], nums: [0, 8, 1], look: null, city: CITIES[0] }; for (let k = 0; k < 90; k++) F.f.push(new Float32Array([100 + k * 5, 250, 600, 250, k > 60 ? -9999 : 400, 300]));
    F.look = F.city; const rec = { name: "Logistika", n: 2, combo: 1, bank: 1, brk: false, won: true };
    proReplay({ frames: F, rec, kind: "best", why: proShotText(rec) }, { onClose: () => {} }); await new Promise(r => setTimeout(r, 400)); document.querySelector("#proRep [data-a=share]").click(); await new Promise(r => setTimeout(r, 2500)); return (window.__tgOpened || []).slice(-1)[0]; });
  const id2 = (/startapp%3Dr_([A-Za-z0-9]{10})/.exec(best || "") || [])[1];
  ok(!!id2 && id2 !== id, "the best shot of a match gets its own link", best);
  const R2 = await mk({ tg: true, sp: "r_" + id2, lang: "ru" });
  on = false; for (let k = 0; k < 40 && !on; k++) { await clearModals(R2.p); await sleep(700); on = await repOn(R2.p); }
  const bv = await R2.p.evaluate(() => ({ on: !!document.getElementById("proRep") && document.getElementById("proRep").classList.contains("on"), cap: (document.getElementById("proRepCap") || {}).textContent, want: proShotText({ n: 2, combo: 1, bank: 1, brk: false, won: true }) }));
  ok(bv.on && bv.cap === bv.want && /[А-Яа-я]/.test(bv.cap), "a Russian receiver reads 'winning shot · 2 balls · combination · bank' in Russian", bv);
  await R2.ctx.close(); await A.ctx.close();
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.kill("SIGTERM"); await sleep(800);
  process.exit(fail ? 1 : 0);
})();
