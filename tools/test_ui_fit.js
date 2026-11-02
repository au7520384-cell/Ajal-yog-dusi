#!/usr/bin/env node
// Two screens the owner marked on his phone:  node tools/test_ui_fit.js
// - the four tabs of the friends screen stand in ONE row in every language and at every size (they used to wrap into 3 rows in Russian)
// - the 28 illustrated frames (premium, scary shop, plain) have no name plaque under the window any more: the lowest part of every picture is transparent
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const srv = spawn("python3", ["-m", "http.server", "8199"], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  for (const [vw, vh] of [[844, 390], [640, 300], [1000, 450]]) for (const lang of ["ru", "en", "uz", "de"]) {
    const p = await (await b.newContext({ viewport: { width: vw, height: vh }, locale: "en-US" })).newPage();
    p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
    await p.addInitScript(l => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Alex", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: l })), lang);
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto("http://localhost:8199/index.html", { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(500);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(600);
    await p.evaluate(() => go("friendsScr")); await sleep(1200);
    const m = await p.evaluate(() => { const t = document.querySelector(".ftabs"), r = t.getBoundingClientRect(); return { rows: new Set([...t.children].map(c => Math.round(c.getBoundingClientRect().top))).size, over: t.scrollWidth - t.clientWidth, n: t.children.length, right: Math.max(...[...t.children].map(c => c.getBoundingClientRect().right)) - r.right }; });
    ok(m.rows === 1 && m.over <= 1 && m.n === 4 && m.right <= 1, `the friends tabs are one row in ${lang} at ${vw}x${vh}`, m);
    if (vw === 844 && lang === "en") {
      const fr = await p.evaluate(async () => {
        const ids = [...["ame", "bdi", "brz", "dia", "emr", "gld", "opl", "plt", "rby", "rgd", "sap", "slv"].map(k => "pf_" + k), ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => "fs_" + k), ...[1, 2, 3, 4, 5, 6, 7, 8].map(k => "PLAIN_" + k)], bad = [];
        for (const id of ids) {
          const u = FRIMG2[id]; if (!u) { bad.push(id + ": missing"); continue; }
          const im = new Image(); im.src = u; await im.decode(); const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext("2d"); x.drawImage(im, 0, 0);
          const H = c.height, top = x.getImageData(0, 0, c.width, Math.round(H * 0.72)).data, low = x.getImageData(0, Math.round(H * 0.78), c.width, H - Math.round(H * 0.78)).data;
          let a = 0, lo = 0; for (let i = 3; i < top.length; i += 4) if (top[i] > 40) a++; for (let i = 3; i < low.length; i += 4) if (low[i] > 8) lo++;
          if (a < 3000) bad.push(id + ": the frame is empty"); if (lo) bad.push(id + ": something is left under the frame (" + lo + " px)");
        }
        return { n: ids.length, bad };
      });
      ok(fr.n === 28 && fr.bad.length === 0, "28 frames without a plaque", fr.bad.slice(0, 4));
    }
    await p.close();
  }
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
