#!/usr/bin/env node
// The full-screen sign-in (#loginSplash) on every kind of screen:  node tools/test_login_layout.js   (B8_ROOT=<repo copy>, SHOTS=<folder for screenshots>)
// The owner's 20:9 phone in landscape had the big logo push Google / Facebook below the bottom edge. The page is opened like a fresh install at many screen sizes and in three languages:
//  - the logo is small and sits on top, the heading + the three buttons (Google, Facebook, guest) + the note are completely inside the screen, never overlap, are big enough to tap, nothing scrolls;
//  - a tap in the middle of each button reaches the right element (Google's own invisible button sits exactly over its picture-matching button);
//  - while the server has not answered yet the buttons already stand in their final places; a sign-in the server has not set up is dropped; "guest" closes the screen and is remembered.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const QUICK = !!process.env.QUICK;   // QUICK=1: five sizes and one other language (about 3 minutes instead of 12)
const ALL_SIZES = [   // [name, width, height, phone?]  (CSS pixels)
  ["owner 20:9 phone", 870, 393, 1], ["Pixel 20:9", 915, 412, 1], ["iPhone Pro Max", 932, 430, 1], ["844x390", 844, 390, 1], ["740x360", 740, 360, 1], ["iPhone 8", 667, 375, 1], ["640x360", 640, 360, 1], ["iPhone SE", 568, 320, 1], ["800x360", 800, 360, 1],
  ["1200x540 (DPR 2 hi-res)", 1200, 540, 1], ["2200x990 (extreme wide)", 2200, 990, 0], ["tablet landscape", 1024, 768, 0], ["desktop 1280x720", 1280, 720, 0], ["desktop 1920x1080", 1920, 1080, 0],
  ["portrait phone", 390, 844, 1], ["portrait small", 360, 640, 1], ["portrait 20:9", 412, 915, 1], ["tablet portrait", 768, 1024, 0]];
const SIZES = ALL_SIZES.filter((_, i) => !QUICK || [0, 4, 7, 12, 14].includes(i));
const STUB_G = `window.google={accounts:{id:{initialize(){},renderButton(el,o){el.innerHTML='<div role="button" id="fakeG" style="width:'+o.width+'px;height:40px;background:#fff;box-sizing:border-box">G</div>'}}}}`, STUB_F = `window.FB={init(){},login(){}}`;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ll-")), P = +process.env.TEST_PORT || 8607, base = `http://localhost:${P}`, errs = [];
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, GOOGLE_CLIENT_ID: "test-google.apps.googleusercontent.com", FACEBOOK_BUTTON: "1", FACEBOOK_APP_ID: "1234567890" }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch();
    // opens the page as a fresh install; cfg = null -> the real server answers, else {google, facebook} is served instead (gate = a promise the answer waits for)
    const open = async (w, h, phone, lang, cfg, gate) => {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: !!phone, isMobile: !!phone, deviceScaleFactor: 2, locale: lang === "ru" ? "ru-RU" : lang === "en" ? "en-US" : "uz-UZ" }), p = await ctx.newPage();
      p.on("pageerror", e => errs.push(`${w}x${h}: ` + e.message.slice(0, 160)));
      await p.route(/^https?:\/\/(?!localhost)/, r => { const u = r.request().url(); if (/accounts\.google\.com\/gsi\/client/.test(u)) return r.fulfill({ contentType: "text/javascript", body: STUB_G }); if (/connect\.facebook\.net/.test(u)) return r.fulfill({ contentType: "text/javascript", body: STUB_F }); return r.abort(); });
      if (cfg !== null) await p.route("**/api/auth/config", async r => { if (gate) await gate; r.fulfill({ contentType: "application/json", body: JSON.stringify(cfg) }); });
      await p.addInitScript(l => { localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: l, genderAsked: true, gender: "m", coins: 1500 })); }, lang);
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
      return [p, ctx];
    };
    const measure = p => p.evaluate(() => {
      const root = document.getElementById("loginSplash");
      const R = sel => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e), r = e.getBoundingClientRect(); let x = 0, y = 0, n = e; while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: c.display !== "none" && c.visibility !== "hidden" && r.width > 0, l: { x, y, w: e.offsetWidth, h: e.offsetHeight, r: x + e.offsetWidth, b: y + e.offsetHeight } }; };
      const hit = sel => { const e = document.querySelector(sel); if (!e) return ""; const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t ? (t.closest("#gBtn") ? "gBtn" : t.closest("#fbBtn") ? "fbBtn" : t.closest("#lsGuest") ? "lsGuest" : (t.id || t.className || t.tagName)) : ""; };
      const lg = document.querySelector("#loginSplash .lsLogo");
      return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, cw: root ? root.clientWidth : 0, ch: root ? root.clientHeight : 0, rot: document.documentElement.classList.contains("rot"),
        logo: R("#loginSplash .lsLogo"), logoLoaded: !!lg && lg.complete && lg.naturalWidth > 0, h2: R("#loginSplash h2"), sub: R("#loginSplash .lsHead p"), note: R("#loginSplash p.muted"),
        g: R("#lsGw"), gOv: R("#gBtn"), fb: R("#fbBtn"), guest: R("#lsGuest"), hitG: hit("#lsGw"), hitF: hit("#fbBtn"), hitU: hit("#lsGuest"), gOn: !!document.querySelector("#lsGw.on"), fbOff: !!document.getElementById("fbBtn") && document.getElementById("fbBtn").disabled };
    });
    const inside = (e, m, pad = 1) => !!e && e.shown && e.x >= -pad && e.y >= -pad && e.r <= m.vw + pad && e.b <= m.vh + pad;
    const overlap = (a, c) => Math.min(a.r, c.r) - Math.max(a.x, c.x) > 1.5 && Math.min(a.b, c.b) - Math.max(a.y, c.y) > 1.5;
    const check = (tag, m, o = {}) => {
      const parts = { logo: m.logo, heading: m.h2, google: m.g, facebook: m.fb, guest: m.guest, note: m.note };
      for (const [k, e] of Object.entries(parts)) { if (k === "facebook" && o.noFb) continue; if (k === "google" && o.noG) continue; ok(inside(e, m), `${tag}: ${k} is completely inside the screen`, { [k]: e, vw: m.vw, vh: m.vh }); }
      const bs = [["google", m.g], ["facebook", m.fb], ["guest", m.guest]].filter(([k]) => !(k === "facebook" && o.noFb) && !(k === "google" && o.noG));
      for (const [k, e] of bs) ok(e && e.l.h >= 34 && e.l.w >= 150, `${tag}: ${k} button is big enough to tap`, e && e.l);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) ok(!overlap(bs[i][1].l, bs[j][1].l), `${tag}: ${bs[i][0]} and ${bs[j][0]} do not overlap`, [bs[i][1].l, bs[j][1].l]);
      ok(m.logoLoaded, `${tag}: the logo picture loaded`);
      ok(m.logo.l.h <= 0.36 * m.ch && m.logo.l.w >= 110, `${tag}: the logo is small (at most 36% of the height) but not tiny`, { w: m.logo.l.w, h: m.logo.l.h, ch: m.ch });
      ok(m.logo.l.b <= Math.min(m.h2.l.y, m.guest.l.y) + 1, `${tag}: the logo does not overlap the sign-in block`, { logoB: m.logo.l.b, h2: m.h2.l.y, guest: m.guest.l.y });
      ok(m.sw <= m.vw + 1 && m.sh <= m.vh + 1, `${tag}: nothing scrolls`, { sw: m.sw, vw: m.vw, sh: m.sh, vh: m.vh });
    };
    let shotN = 0; const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `login_${String(++shotN).padStart(2, "0")}_${name.replace(/[^a-z0-9]+/gi, "_")}.png`) }); } };

    // 1) every screen size, Uzbek (the owner's language) - the server really has Google + Facebook set up (test ids)
    for (const [name, w, h, ph] of SIZES) {
      const [p, ctx] = await open(w, h, ph, "uz", null);
      await p.waitForFunction(() => document.querySelector("#lsGw.on") && !document.getElementById("fbBtn").disabled && document.getElementById("gBtn").style.transform, null, { timeout: 30000 }).catch(() => {});
      await sleep(400); const m = await measure(p); await shot(p, name);
      check(`${name} ${w}x${h}`, m);
      ok(m.gOn && !m.fbOff, `${name}: both sign-ins are switched on after the server answered`, { gOn: m.gOn, fbOff: m.fbOff });
      ok(m.hitG === "gBtn" && m.hitF === "fbBtn" && m.hitU === "lsGuest", `${name}: a tap in the middle of each button reaches its own element (Google's overlay is on top of its button)`, { g: m.hitG, f: m.hitF, u: m.hitU });
      ok(m.gOv && Math.abs(m.gOv.w - m.g.w) < 2.5 && Math.abs(m.gOv.h - m.g.h) < 2.5 && Math.abs(m.gOv.x - m.g.x) < 1.5 && Math.abs(m.gOv.y - m.g.y) < 1.5, `${name}: Google's own button covers its picture-matching button exactly`, { ov: m.gOv, g: m.g });
      await ctx.close();
    }
    // 2) the other languages (longer words) on a very wide phone, a small one and a portrait one
    for (const lang of QUICK ? ["ru"] : ["ru", "en"]) for (const [name, w, h, ph] of QUICK ? [ALL_SIZES[0], ALL_SIZES[7]] : [ALL_SIZES[0], ALL_SIZES[4], ALL_SIZES[7], ALL_SIZES[14]]) {
      const [p, ctx] = await open(w, h, ph, lang, null);
      await p.waitForFunction(() => document.querySelector("#lsGw.on") && document.getElementById("gBtn").style.transform, null, { timeout: 30000 }).catch(() => {});
      await sleep(300); const m = await measure(p); await shot(p, `${lang}_${name}`);
      check(`${lang} ${name} ${w}x${h}`, m);
      const txt = await p.evaluate(() => ["#lsGw .lsBtn", "#fbBtn", "#lsGuest"].map(s => { const e = document.querySelector(s); return e.scrollWidth <= e.clientWidth + 1; }));
      ok(txt.every(Boolean), `${lang} ${name}: no button label is wider than its button`, txt);
      await ctx.close();
    }
    // 3) before the server has answered (a sleeping server): all three buttons already stand where they will be, the Google / Facebook ones dimmed, "guest" works; then the answer comes and nothing moves
    { let release; const gate = new Promise(r => { release = r; }); const [p, ctx] = await open(870, 393, 1, "uz", { google: "x", facebook: "1" }, gate);
      await p.waitForSelector("#loginSplash .lsBtns", { timeout: 20000 }); await sleep(600); const w0 = await measure(p); await shot(p, "waiting_for_server");
      check("waiting for the server", w0); ok(!w0.gOn && w0.fbOff, "waiting: Google / Facebook are not switched on yet (dimmed)", { gOn: w0.gOn, fbOff: w0.fbOff });
      ok(await p.evaluate(() => getComputedStyle(document.getElementById("lsGw")).opacity < 0.9 && getComputedStyle(document.getElementById("fbBtn")).opacity < 0.9), "waiting: the two sign-in buttons look dimmed");
      release(); await p.waitForFunction(() => document.querySelector("#lsGw.on") && !document.getElementById("fbBtn").disabled, null, { timeout: 20000 }); await sleep(400); const w1 = await measure(p);
      ok(["g", "fb", "guest"].every(k => Math.abs(w0[k].l.x - w1[k].l.x) < 1.5 && Math.abs(w0[k].l.y - w1[k].l.y) < 1.5 && Math.abs(w0[k].l.w - w1[k].l.w) < 1.5), "the buttons do not move when the server answers", { w0: [w0.g.l, w0.fb.l, w0.guest.l], w1: [w1.g.l, w1.fb.l, w1.guest.l] });
      await ctx.close(); }
    // 4) only Google is set up: no dead Facebook button, the rest still fits;  only Facebook: no Google button;  nothing set up: the screen goes away
    { const [p, ctx] = await open(870, 393, 1, "uz", { google: "x", facebook: "" });
      await p.waitForFunction(() => document.querySelector("#lsGw.on"), null, { timeout: 20000 }); await sleep(300); const m = await measure(p); await shot(p, "only_google");
      check("only Google", m, { noFb: true }); ok(m.fb && !m.fb.shown, "only Google: the Facebook button is dropped", m.fb); ok(m.hitG === "gBtn" && m.hitU === "lsGuest", "only Google: taps reach Google and guest", { g: m.hitG, u: m.hitU }); await ctx.close(); }
    { const [p, ctx] = await open(870, 393, 1, "uz", { google: "", facebook: "1" });
      await p.waitForFunction(() => !document.getElementById("fbBtn").disabled, null, { timeout: 20000 }); await sleep(300); const m = await measure(p); await shot(p, "only_facebook");
      check("only Facebook", m, { noG: true }); ok(m.g && !m.g.shown, "only Facebook: the Google button is dropped", m.g); ok(m.hitF === "fbBtn" && m.hitU === "lsGuest", "only Facebook: taps reach Facebook and guest", { f: m.hitF, u: m.hitU }); await ctx.close(); }
    { const [p, ctx] = await open(870, 393, 1, "uz", { google: "", facebook: "" });
      await p.waitForFunction(() => !document.getElementById("loginSplash"), null, { timeout: 20000 }).catch(() => {});
      ok(await p.evaluate(() => !document.getElementById("loginSplash")), "nothing set up on the server: no sign-in screen at all"); await ctx.close(); }
    // 5) "guest" closes the screen and the choice is remembered (no sign-in screen after a reload)
    { const [p, ctx] = await open(870, 393, 1, "uz", null);
      await p.waitForFunction(() => document.querySelector("#lsGw.on"), null, { timeout: 20000 }); await sleep(300);
      await p.tap("#lsGuest"); await sleep(400);
      ok(await p.evaluate(() => !document.getElementById("loginSplash")), "guest: the sign-in screen is gone"); ok(await p.evaluate(() => !!store.get("b8guest")), "guest: the choice is remembered");
      await p.reload({ waitUntil: "commit" }); await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(2500);
      ok(await p.evaluate(() => !document.getElementById("loginSplash")), "guest: after a reload the sign-in screen does not come back"); await ctx.close(); }
    ok(errs.length === 0, "no page errors", errs.slice(0, 3));
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
