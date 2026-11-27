#!/usr/bin/env node
// A player's own photo on the phone (the owner, Nov 27: "Google sign-in shows the Google photo, Telegram sign-in the Telegram photo"):  node tools/test_photo_ui.js   (about 2 minutes; the real server + fake Google / Telegram / picture CDN)
// An avatar number >= 1000 is a photo the server hands out; the picture is loaded from /api/photo/<number>. Checked on the real page: after a Google / Telegram sign-in the game OFFERS the photo once ("Use your photo as your avatar?"),
// "Yes" makes it the avatar (the nav picture, the server's copy), the avatar shop has a "My photo" card (select / remove), another player's page loads the same picture, a photo that cannot be loaded falls back to a game avatar,
// a canvas can draw it, the Mafia ring shows it, "remove" forgets it everywhere, and the offer does not come back.
const { chromium } = require("playwright"), { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOT = process.env.SHOT || "", P = +process.env.TEST_PORT || 8821, PF = P + 1;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const until = async (fn, to = 15000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < to) { if (await fn()) return true; await sleep(step); } return false; };
// a small real PNG (a 64 x 64 orange square) made here
const crc = Buffer.alloc(1024); { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } for (let i = 0; i < 256; i++) crc.writeUInt32LE(t[i], i * 4); }
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crc.readUInt32LE(((c ^ x) & 255) * 4) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const mkPng = (w, h, [r, g, b]) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", require("zlib").deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); };
const PNG = mkPng(64, 64, [255, 140, 0]);
const TOKEN = "123456:TESTTOKEN";
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8phu-")), base = `http://localhost:${P}`, cdn = `http://localhost:${PF}/cdn`;
  const fake = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x"), pn = u.pathname.replace(/=s\d+(-c)?$/, "");
    if (pn === "/g") { const [k, sub, pic] = (u.searchParams.get("id_token") || "").split("|"); r.writeHead(k === "g" ? 200 : 400, { "content-type": "application/json" }); return r.end(JSON.stringify(k === "g" ? { aud: "gcid", iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 3600), sub, given_name: "Gina", picture: pic && pic !== "-" ? cdn + pic + "=s96-c" : undefined } : { error: "x" })); }
    if (pn === "/cdn/ok.png") { r.writeHead(200, { "content-type": "image/png" }); return r.end(PNG); }
    if (pn === "/cdn/gone.png") { r.writeHead(404); return r.end(); }
    r.writeHead(404); r.end();
  });
  await new Promise(r => fake.listen(PF, r));
  const env = { ...process.env, PORT: String(P), DATA_DIR: tmp, APP_URL: base, GOOGLE_CLIENT_ID: "gcid", GOOGLE_TOKENINFO_URL: `http://localhost:${PF}/g`, TELEGRAM_BOT_TOKEN: TOKEN, TG_API_BASE: `http://localhost:${PF}/tg`, B8_PIC_HOSTS: `^http://localhost:${PF}/cdn/` };
  delete env.RENDER_EXTERNAL_URL;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env, stdio: "ignore" });
  await until(() => fetch(base + "/api/health").then(r => r.ok).catch(() => false), 60000, 300);
  const tgData = user => { const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAH" + crypto.randomBytes(4).toString("hex"), user: JSON.stringify(user) });
    const check = [...p.entries()].map(([k, v]) => k + "=" + v).sort().join("\n"), secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex")); return p.toString(); };
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] }), errs = [];
  const open = async (name, vp = { width: 915, height: 412 }) => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", deviceScaleFactor: SHOT ? 2 : 1, hasTouch: true, isMobile: true }), p = await ctx.newPage(); p._ctx = ctx; p._name = name;
    p.on("pageerror", e => errs.push(name + ": " + e.message.slice(0, 240)));
    await p.addInitScript(n => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: n, tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, country: "UZ" })); }, name);
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.__toasts = []; window.toast = (i, t) => window.__toasts.push(String(t)); }); await sleep(1500);
    await p.evaluate(() => Net.ensure().then(() => Net.sync())); await sleep(400); return p;
  };
  const modal = p => p.evaluate(() => document.getElementById("modal").classList.contains("on") ? { t: document.getElementById("mTitle").textContent, x: document.getElementById("mText").textContent, btns: [...document.querySelectorAll("#mBtns button")].map(x => x.textContent), img: !!document.querySelector("#mExtra img[src*='/api/photo/']") } : null);
  const loaded = (p, sel) => p.evaluate(s => { const i = document.querySelector(s); return !!i && i.complete && i.naturalWidth > 0; }, sel);
  try {
    // ------------------------------------------------------------------ A signs in with Google: a picture comes with it
    const A = await open("Gina");
    ok(await A.evaluate(() => typeof isPhotoAv === "function" && isPhotoAv(1000) && !isPhotoAv(999) && normAv(123456) === 123456 && normAv(70) === 70), "an avatar number >= 1000 is a photo and normAv leaves it alone");
    ok(await A.evaluate(() => avatarURL(1234).endsWith("/api/photo/1234") && avatarURL(5).startsWith("data:")), "a photo's URL is the server's /api/photo/<number>; a game avatar stays a picture of its own");
    await A.evaluate(() => authLogin("google", "g|ps1|/ok.png")); await sleep(800);
    const pic = await A.evaluate(() => Net.pic); ok(pic && pic.id >= 1000 && pic.src === "google", "after the Google sign-in the game knows my photo (its number, its source)", pic);
    ok(await until(() => A.evaluate(() => { try { return !!Net.me; } catch (e) { return false; } }), 6000), "...and the account synced");
    // (the sync that follows a sign-in brings the offer by itself: nothing is touched here)
    ok(await until(() => modal(A).then(m => m && /photo as your avatar/i.test(m.t)), 8000), "the game OFFERS the photo once ('Use your photo as your avatar?')", await modal(A));
    const m1 = await modal(A); ok(m1 && /Google/.test(m1.x) && m1.img && m1.btns.length === 2, "...says where it comes from (Google), shows the picture, has two keys", m1);
    ok(await until(() => loaded(A, "#mExtra img"), 6000), "...the picture in the window is loaded from the server (not a stand-in)", await A.evaluate(() => { const i = document.querySelector("#mExtra img"); return i && [i.src.slice(-30), i.naturalWidth]; }));
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "01_offer.png") });
    await A.evaluate(() => document.querySelectorAll("#mBtns button")[0].click()); await sleep(1200);
    const st = await A.evaluate(() => ({ av: profile.avatar, pid: Net.pic.id, asked: profile.picAsked, srv: Net.me && Net.me.avatar }));
    ok(st.av === st.pid && st.asked === 1, "'Yes': my avatar is the photo", st);
    await A.evaluate(() => Net.sync()); await sleep(600);
    ok(await A.evaluate(() => Net.me.avatar === Net.pic.id), "...and the server has it (so the others see it)", await A.evaluate(() => [Net.me.avatar, Net.pic.id]));
    ok(await until(() => A.evaluate(() => { const i = document.getElementById("navAvE"); return !!i && /\/api\/photo\/\d+$/.test(i.src) && i.complete && i.naturalWidth > 0; }), 5000), "the picture in the top bar is my photo, loaded", await A.evaluate(() => { const i = document.getElementById("navAvE"); return i && [i.src.slice(-30), i.naturalWidth]; }));
    // ------------------------------------------------------------------ the shop
    await A.evaluate(() => { document.getElementById("modal").classList.remove("on"); toMenu("shop"); }); await sleep(900); await A.evaluate(() => { const t = document.querySelector('#cueTabs .tab[data-tab="avatars"]'); if (t) t.click(); else buildShop("avatars"); }); await sleep(700);
    const shop = await A.evaluate(() => { const c = document.querySelector("#avGrid .avcard"), i = c && c.querySelector("img"); return c ? { img: i && /\/api\/photo\/\d+$/.test(i.src), sel: c.classList.contains("sel"), btns: [...c.querySelectorAll("button")].map(x => x.textContent.trim()), txt: c.querySelector("small") && c.querySelector("small").textContent, off: !!c.querySelector(".avoff") } : null; });
    ok(shop && shop.img && shop.sel && /My photo/.test(shop.txt) && /Google/.test(shop.txt) && shop.off && shop.btns.length === 2, "the avatar shop has a 'My photo · Google' card first: selected, with a remove key", shop);
    ok(await A.evaluate(() => document.querySelectorAll("#avGrid .avcard").length > 5), "...followed by the game's own avatars");
    if (SHOT) await A.screenshot({ path: path.join(SHOT, "02_shop.png") });
    await A.evaluate(() => { profile.avatar = 20; save(); buildShop("avatars"); }); await sleep(300);
    ok(await A.evaluate(() => { const c = document.querySelector("#avGrid .avcard"), b = c.querySelector("button:not(.avoff)"); return !c.classList.contains("sel") && !b.disabled; }), "when another avatar is worn the photo card offers 'select' again");
    await A.evaluate(() => document.querySelector("#avGrid .avcard button:not(.avoff)").click()); await sleep(500);
    ok(await A.evaluate(() => profile.avatar === Net.pic.id && profile.avPrev === 20), "...and selecting it wears the photo again (the avatar before is remembered)", await A.evaluate(() => [profile.avatar, profile.avPrev]));
    // ------------------------------------------------------------------ another player's page
    await A.evaluate(() => Net.sync()); const pidA = await A.evaluate(() => Net.pic.id);
    const B = await open("Bobur");
    const other = await B.evaluate(async pid => { const d = document.createElement("div"); d.id = "t1"; d.style.cssText = "position:fixed;left:0;top:0;z-index:99999"; d.innerHTML = avHTML(pid, 0, 60); document.body.appendChild(d); const i = d.querySelector("img"); await new Promise(r => { if (i.complete) r(); else { i.onload = i.onerror = r; setTimeout(r, 4000); } }); return { w: i.naturalWidth, src: i.src.slice(-24) }; }, pidA);
    ok(other.w > 0, "another player's page loads my photo from the same number", other);
    const bad = await B.evaluate(async () => { const d = document.createElement("div"); d.innerHTML = avHTML(2123456789, 0, 60); document.body.appendChild(d); const i = d.querySelector("img"); await new Promise(r => setTimeout(r, 2500)); return { fb: i.dataset.phfb, data: i.src.startsWith("data:"), w: i.naturalWidth }; });
    ok(bad.fb === "1" && bad.data && bad.w > 0, "a photo that cannot be loaded (a number the server does not know) falls back to a game avatar", bad);
    const cv = await B.evaluate(async pid => { for (let i = 0; i < 40; i++) { const d = avDrawable(pid); if (d instanceof HTMLImageElement) return { img: true, w: d.naturalWidth }; await new Promise(r => setTimeout(r, 120)); } return { img: false }; }, pidA);
    ok(cv.img && cv.w > 0 && (await B.evaluate(() => avDrawable(7) instanceof HTMLCanvasElement)), "a canvas can draw a photo (avDrawable): the loaded picture; a game avatar is still a canvas", cv);
    // the Mafia ring
    const ring = await B.evaluate(async pid => {
      MFX.seats = ["Siz", "Gina", "Azamat", "Kenjix", "Bahodir"].map((n, i) => ({ name: n, avatar: i === 1 ? pid : (i * 5 + 2) % 40, frame: 0, uid: "u" + i })); MFX.on = true; BR.mf = true; mfEnsure().classList.add("on");
      MFX.v = { phase: "night", day: 1, until: Date.now() + 30000, n: 5, you: 0, role: "citizen", alive: Array(5).fill(true), dead: {}, log: [], bot: [false, true, true, true, true], found: [], mates: [], pick: -1, votes: {}, winner: "", roles: null }; MFX.total = 30000; MFX.key = "night:1"; MFX.off = 0; mfRender();
      await new Promise(r => setTimeout(r, 1500)); const i = document.querySelector("#mfScr .mf-p:nth-child(2) .mf-av img"); return { src: i && i.src.slice(-26), w: i && i.naturalWidth, n: document.querySelectorAll("#mfScr .mf-p").length };
    }, pidA);
    ok(ring.n === 5 && ring.w > 0 && /\/api\/photo\//.test(ring.src), "the Mafia ring shows the photo on its seat", ring);
    if (SHOT) await B.screenshot({ path: path.join(SHOT, "03_mafia.png") });
    // ------------------------------------------------------------------ the offer does not come back, a refusal is respected
    await A.evaluate(() => { profile.avatar = 21; save(); Net.sync(); }); await sleep(1500);
    ok(!(await modal(A)), "the offer does not come back after an answer (profile.picAsked)", await modal(A));
    // ------------------------------------------------------------------ remove
    await A.evaluate(() => { buildShop("avatars"); document.querySelector("#avGrid .avoff").click(); }); await sleep(500);
    const cf = await modal(A); ok(cf && /Remove photo/i.test(cf.t) && cf.btns.length === 2, "'remove' asks first", cf);
    await A.evaluate(() => document.querySelectorAll("#mBtns button")[0].click()); await sleep(1500);
    const gone = await A.evaluate(() => ({ pic: Net.pic, av: profile.avatar, cards: [...document.querySelectorAll("#avGrid .avcard")].filter(c => c.querySelector("img[src*='/api/photo/']")).length }));
    ok(!gone.pic && gone.av < 1000 && gone.cards === 0, "removed: no photo, a game avatar again, no photo card", gone);
    ok((await fetch(`${base}/api/photo/${pidA}`)).status === 404, "...and the server's number is a 404", (await fetch(`${base}/api/photo/${pidA}`)).status);
    // ------------------------------------------------------------------ Telegram
    const T = await open("Tomas");
    await T.evaluate(init => authLogin("telegram", init), tgData({ id: 4242, first_name: "Tomas", photo_url: cdn + "/ok.png" })); await sleep(800);
    const tp = await T.evaluate(() => Net.pic); ok(tp && tp.src === "telegram" && tp.id >= 1000, "a Telegram sign-in (signed data with photo_url) gives the account a photo as well", tp);
    ok(await until(() => modal(T).then(m => m && /Telegram/.test(m.x)), 8000), "...and the offer names Telegram", await modal(T));
    await T.evaluate(() => document.querySelectorAll("#mBtns button")[1].click()); await sleep(400);
    ok(await T.evaluate(() => !isPhotoAv(profile.avatar) && profile.picAsked === 1), "'No, thanks': the avatar stays as it was and nothing is asked again");
    ok(await T.evaluate(() => { buildShop("avatars"); const c = document.querySelector("#avGrid .avcard"); return !!c && !!c.querySelector("img[src*='/api/photo/']") && !c.classList.contains("sel"); }), "...but the card is in the shop for later");
    // the server forgets a photo: the page that wore it goes back to a game avatar at its next sync
    await T.evaluate(() => { usePhoto(); }); await sleep(800);
    await fetch(base + "/api/photo/off", { method: "POST", headers: { "Content-Type": "application/json", Authorization: await T.evaluate(() => `Bearer ${Net.acct.id}:${Net.acct.token}`) }, body: "{}" });
    await T.evaluate(() => Net.sync()); await sleep(800);
    ok(await T.evaluate(() => !isPhotoAv(profile.avatar) && !Net.pic), "when the server no longer has my photo the page goes back to a game avatar at the next sync", await T.evaluate(() => [profile.avatar, Net.pic]));
    ok(errs.length === 0, "no script errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill("SIGTERM"); fake.close(); await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
