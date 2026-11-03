#!/usr/bin/env node
// Frame cost of a match by picture quality, HD pack and CPU speed:  node tools/bench_perf.js     (B8_ROOT=<repo copy>, CPUS="1,4" slowdowns, GFX="mid,high,ultra", DPR=3, VW/VH)
// Headless Chromium paints on the CPU (a phone has a GPU), so read the numbers as RELATIVE: how much more a frame costs with 2K / 4K, with HD pictures, on a 4x slower CPU.
// idle = the table with nothing moving, break = the first 2 seconds after a full-power break (all balls rolling). js = the game's own code per frame (ms), frame = time between frames, slow = frames over 25 ms.
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, "..");
const WARM = +process.env.WARM || 2500;   // ms between the start of the match and the first measurement (the first seconds also decode the pictures: a one-off cost)
const CPUS = (process.env.CPUS || "1,4").split(",").map(Number), GFX = (process.env.GFX || "mid,high,ultra").split(","), DPR = +process.env.DPR || 3, VW = +process.env.VW || 915, VH = +process.env.VH || 412;
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8bp-")), P = 8371, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  try {
    const b = await chromium.launch();
    for (const hd of [false, true]) {
      const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true, locale: "en-US" });
      const p = await ctx.newPage(); p.on("pageerror", e => console.log("pageerror", e.message.slice(0, 100)));
      await p.addInitScript(([off]) => { if (off) localStorage.setItem("b8_hd", "off"); localStorage.setItem("b8_assets", localStorage.getItem("b8_assets") || "x"); if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" })); }, [!hd]);
      await p.goto(base + "/?perf=1", { waitUntil: "commit" });
      if (hd) await p.waitForFunction(() => window.__hd && window.__hd.state === "on" && typeof profile !== "undefined" && !document.getElementById("boot"), null, { timeout: 900000 });
      else await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 300000 });
      await sleep(1500); const g = await p.$("#lsGuest"); if (g) await g.click().catch(() => {}); await sleep(600);
      const cdp = await ctx.newCDPSession(p);
      for (const rate of CPUS) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        for (const q of GFX) {
          const r = await p.evaluate(async ([q, W]) => {
            try { toMenu("home"); } catch (e) {} setOpt("gfx", q); startMatch("ai", CITIES[0]);
            await new Promise(r => setTimeout(r, W));
            const frames = async n => { const t = []; let last = performance.now(); await new Promise(res => { let k = 0; const f = now => { t.push(now - last); last = now; if (++k < n) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return t; };
            const stat = (t, js) => ({ js: +(js.s / (js.n || 1)).toFixed(1), jsMax: +js.m.toFixed(0), frame: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1), slow: t.filter(x => x > 25).length });
            perfJ.s = perfJ.n = perfJ.m = 0; const t1 = await frames(60), idle = stat(t1, perfJ);
            perfJ.s = perfJ.n = perfJ.m = 0; game.angle = 0; try { doShoot(1); } catch (e) {} const t2 = await frames(120), brk = stat(t2, perfJ);
            return { canvas: cv.width + "x" + cv.height, dpr: +dpr.toFixed(2), idle, brk };
          }, [q, WARM]);
          console.log(JSON.stringify({ hd, cpu: rate, gfx: q, ...r }));
        }
      }
      await ctx.close();
    }
    await b.close();
  } finally { srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {} }
})().catch(e => { console.error(e); process.exit(1); });
