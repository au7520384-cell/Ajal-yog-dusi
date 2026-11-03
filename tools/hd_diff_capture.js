#!/usr/bin/env node
// Screens of the game with the HD pack OFF and ON (and OFF again as the noise reference), saved as PNG:  node tools/hd_diff_capture.js <out_dir>
// then:  python3 tools/hd_diff_compare.py <out_dir>   (a screen that moved / lost a picture when HD came on shows as a big difference in the low frequencies)
// B8_ROOT=<repo copy> tests another copy of the repo.  Env: VW, VH, DPR (default 844 x 390 @ 2).
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), OUT = path.resolve(process.argv[2] || "hd_diff");
const VW = +process.env.VW || 844, VH = +process.env.VH || 390, DPR = +process.env.DPR || 2;
const SCREENS = [
  ["home", "1"], ["shop_cues", "go('shop','cues')"], ["shop_avatars", "go('shop','avatars')"], ["shop_frames", "go('shop','frames')"], ["shop_tables", "go('shop','tables')"], ["shop_boxes", "go('shop','boxes')"],
  ["shop_stickers", "go('shop','stickers')"], ["shop_money", "go('shop','money')"], ["shop_free", "go('shop','free')"], ["cities", "go('cities')"], ["rewards", "go('rewards')"], ["leader", "go('leader')"],
  ["wheel", "go('wheelScr')"], ["profile", "go('profileScr')"], ["tour", "go('tourScr')"], ["friends", "go('friendsScr')"], ["clubs", "go('clubsScr')"], ["events", "go('eventsScr')"], ["free", "go('freeScr')"],
  ["lb", "go('lbScr')"], ["pass", "go('passScr')"], ["road", "go('roadScr')"], ["settings", "go('settingsScr')"],
  ["match0", "startMatch('ai', CITIES[0])"], ["match3", "startMatch('ai', CITIES[3])"], ["match6", "startMatch('ai', CITIES[6])"],
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8dc-")), P = 8351, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const man = await (await fetch(base + "/assets.json")).json(), b = await chromium.launch();
    const ctxOf = () => b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true, locale: "en-US", serviceWorkers: "allow" });
    const prof = hd => ({ name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m", coins: 90000, cash: 500, gems: 500, avatar: 305, frame: 3 });
    const ready = p => p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 240000 });
    const shoot = async (ctx, tag, hdOn) => {
      const p = await ctx.newPage(); p.on("pageerror", e => console.log("pageerror", tag, e.message.slice(0, 120)));
      await p.addInitScript(([pr, off]) => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(pr)); if (off) localStorage.setItem("b8_hd", "off"); }, [prof(), !hdOn]);
      await p.goto(base + "/", { waitUntil: "commit" }); await ready(p); await sleep(1200);
      const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(800);
      const hdw = await p.evaluate(async () => { const im = new Image(); im.src = IMG.ga0; await im.decode(); return im.naturalWidth; });
      console.log(tag, "HD avatar width", hdw);
      for (const [name, code] of SCREENS) {
        try {
          if (name === "home") { await p.evaluate(() => { try { toMenu("home"); } catch (e) {} }); }
          else if (/^match/.test(name)) { await p.evaluate(c => { eval(c); }, code); }
          else { await p.evaluate(() => { try { if (mode !== "menu") toMenu("home"); } catch (e) {} }); await sleep(400); await p.evaluate(c => { eval(c); }, code); }
          await sleep(/^match/.test(name) ? 3000 : 1700);
          await p.screenshot({ path: path.join(OUT, `${tag}_${name}.png`) });
          if (/^match/.test(name)) { await p.evaluate(() => { try { toMenu("home"); } catch (e) {} }); await sleep(700); }
        } catch (e) { console.log("screen failed", tag, name, String(e).slice(0, 100)); }
      }
      await p.close();
    };
    // OFF (a fresh browser that never installs HD)
    let ctx = await ctxOf(); await shoot(ctx, "a_off", false); await ctx.close();
    // ON: first visit installs the pack (the page reloads once), then the screens
    ctx = await ctxOf(); { const p = await ctx.newPage(); await p.addInitScript(pr => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(pr)); }, prof());
      await p.goto(base + "/", { waitUntil: "commit" });
      await p.waitForFunction(() => window.__hd && window.__hd.state === "on" && typeof profile !== "undefined" && !document.getElementById("boot"), null, { timeout: 600000 }).catch(e => console.log("HD install wait:", String(e).slice(0, 80)));
      await p.close(); }
    await shoot(ctx, "b_on", true); await ctx.close();
    // OFF again (noise reference: same state as the first run)
    ctx = await ctxOf(); await shoot(ctx, "c_off", false); await ctx.close();
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
})().catch(e => { console.error(e); process.exit(1); });
