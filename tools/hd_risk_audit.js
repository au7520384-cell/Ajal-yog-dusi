#!/usr/bin/env node
// Which pictures would break if their file became 2-4 times bigger?  node tools/hd_risk_audit.js [out.json]     (B8_ROOT=<repo copy>)
// An HD copy has the same picture but more pixels. Code that sizes things by the picture's own pixels (an <img> with no CSS size, a background-size:auto, drawImage(img, x, y) with no size,
// drawImage(img, x, y, img.width, img.height)) would draw it 2-4 times too big. This visits the screens with the HD pack OFF and lists every picture that is shown at its natural size.
// CRAWL=1 also clicks the buttons / cards of every screen one by one (dialogs, popups) and looks again after each click (slow: ~20 min).
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), OUTF = process.argv[2] || "";
const SCREENS = [["home", ""], ["shop_cues", "go('shop','cues')"], ["shop_avatars", "go('shop','avatars')"], ["shop_frames", "go('shop','frames')"], ["shop_tables", "go('shop','tables')"], ["shop_boxes", "go('shop','boxes')"],
  ["shop_stickers", "go('shop','stickers')"], ["shop_money", "go('shop','money')"], ["shop_free", "go('shop','free')"], ["shop_mini", "go('shop','mini')"], ["cities", "go('cities')"], ["rewards", "go('rewards')"], ["leader", "go('leader')"], ["mini", "go('mini')"],
  ["wheel", "go('wheelScr')"], ["profile", "go('profileScr')"], ["tour", "go('tourScr')"], ["friends", "go('friendsScr')"], ["clubs", "go('clubsScr')"], ["events", "go('eventsScr')"], ["free", "go('freeScr')"],
  ["lb", "go('lbScr')"], ["pass", "go('passScr')"], ["road", "go('roadScr')"], ["settings", "go('settingsScr')"], ["live", "go('liveScr')"], ["open", "go('openScr')"], ["withFr", "go('withFrScr')"],
  ["match0", "startMatch('ai', CITIES[0])"], ["match3", "startMatch('ai', CITIES[3])"], ["match6", "startMatch('ai', CITIES[6])"], ["match9", "startMatch('ai', CITIES[9])"]];
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ra-")), P = 8361, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const found = {};   // hash -> {kinds, where}
  const add = (h, kind, where, info) => { if (!h) return; const e = found[h] = found[h] || { kinds: {}, where: {}, info }; e.kinds[kind] = (e.kinds[kind] || 0) + 1; e.where[where] = 1; };
  try {
    const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "en-US" });
    const p = await ctx.newPage(); p.on("pageerror", e => console.log("pageerror", e.message.slice(0, 120)));
    await p.addInitScript(() => {
      localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", "x");
      if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 90000, cash: 500, gems: 500, avatar: 305, frame: 3 }));
      window.__cv = {}; const dI = CanvasRenderingContext2D.prototype.drawImage, hash = u => { const m = /\/img\/([0-9a-f]{14})\./.exec(u || ""); return m ? m[1] : null; };
      CanvasRenderingContext2D.prototype.drawImage = function (im) {
        try { if (im instanceof HTMLImageElement) { const h = hash(im.currentSrc || im.src), a = arguments; if (h) { const k = a.length === 3 ? "canvas3" : (a.length === 5 && Math.abs(a[3] - im.naturalWidth) < 0.5 && Math.abs(a[4] - im.naturalHeight) < 0.5 ? "canvasNat" : ""); if (k) (window.__cv[h] = window.__cv[h] || {})[k] = 1; } } } catch (e) {}
        return dI.apply(this, arguments);
      };
    });
    p.on("dialog", d => d.dismiss().catch(() => {})); ctx.on("page", pg => { if (pg !== p) pg.close().catch(() => {}); });
    await p.addInitScript(() => { window.__clk = () => [...document.querySelectorAll("button, .btn, .card, .tab, [data-go], [data-tab], [data-s], .avcard, .gitem, .tile, [onclick]")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.top < innerHeight && r.left < innerWidth && !e.closest("#perfBox") && !e.hasAttribute("data-hd") && e.id !== "lsGuest" && !/pay|buy|stripe|ads?|watch/i.test(e.id + e.className); }); });
    await p.goto(base + "/", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(1200);
    const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(800);
    const audit = () => p.evaluate(() => {
          const out = [], hash = u => { const m = /\/img\/([0-9a-f]{14})\./.exec(u || ""); return m ? m[1] : null; };
          for (const im of document.images) {
            const r = im.getBoundingClientRect(), h = hash(im.currentSrc || im.src); if (!h || !im.complete || !im.naturalWidth || (r.width === 0 && r.height === 0)) continue;
            if (Math.abs(r.width - im.naturalWidth) <= 1.5 && Math.abs(r.height - im.naturalHeight) <= 1.5) out.push({ k: "img", h, nat: [im.naturalWidth, im.naturalHeight], c: (im.id || "") + "." + (im.className || "") + " < " + ((im.parentElement || {}).id || "") + "." + ((im.parentElement || {}).className || "") });
          }
          for (const el of document.querySelectorAll("*")) {
            const cs = getComputedStyle(el), bi = cs.backgroundImage; if (!bi || bi === "none" || !/img\/[0-9a-f]{14}/.test(bi)) continue;
            const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
            if (/(^|,\s*)auto/.test(cs.backgroundSize)) for (const m of bi.matchAll(/img\/([0-9a-f]{14})/g)) out.push({ k: "bg", h: m[1], c: (el.id || "") + "." + (el.className || "") + " size=" + cs.backgroundSize });
          }
          for (const el of document.querySelectorAll("*")) { const cs = getComputedStyle(el); for (const pr of ["listStyleImage", "borderImageSource", "maskImage", "webkitMaskImage"]) { const v = cs[pr]; if (v && /img\/[0-9a-f]{14}/.test(v)) out.push({ k: pr, h: (v.match(/img\/([0-9a-f]{14})/) || [])[1], c: (el.id || "") + "." + (el.className || "") }); } }
          return out;
        });
    const clicks = async name => {   // CRAWL=1: click every visible button / card of the screen, one per round, and audit the result
      const n = await p.evaluate(() => window.__clk().length); let k = 0;
      for (let i = 0; i < Math.min(n, +process.env.MAXC || 30); i++) {
        try {
          await p.evaluate(() => { try { if (mode !== "menu") toMenu("home"); } catch (e) {} }); await sleep(250);
          const code = SCREENS.find(x => x[0] === name)[1]; if (code) await p.evaluate(c => { eval(c); }, code); await sleep(900);
          const did = await p.evaluate(i => { const e = window.__clk()[i]; if (!e) return false; e.click(); return true; }, i); if (!did) continue; await sleep(900);
          for (const r of await audit()) add(r.h, r.k, name + "#click" + i, r.c); k++;
        } catch (e) { /* a click that navigated away */ }
      }
      return k;
    };
    for (const [name, code] of SCREENS) {
      try {
        if (!/^match/.test(name)) await p.evaluate(() => { try { if (mode !== "menu") toMenu("home"); } catch (e) {} }); await sleep(300);
        if (code) await p.evaluate(c => { eval(c); }, code);
        await sleep(/^match/.test(name) ? 3000 : 1600);
        const risk = await audit();
        for (const r of risk) add(r.h, r.k, name, r.c);
        if (process.env.CRAWL === "1" && !/^match/.test(name)) console.log("crawled", name, await clicks(name), "clicks");
      } catch (e) { console.log("screen failed", name, String(e).slice(0, 100)); }
      if (/^match/.test(name)) { await p.evaluate(() => { try { toMenu("home"); } catch (e) {} }); await sleep(600); }
    }
    const cv = await p.evaluate(() => window.__cv); for (const h in cv) for (const k in cv[h]) add(h, k, "canvas", "");
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
  const list = Object.entries(found).map(([h, e]) => ({ h, kinds: Object.keys(e.kinds), where: Object.keys(e.where), info: e.info }));
  console.log(list.length, "pictures are shown at their natural size somewhere:"); for (const r of list) console.log(" ", r.h, r.kinds.join("+"), r.where.slice(0, 4).join(","), r.info.slice(0, 90));
  if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(list, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
