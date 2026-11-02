#!/usr/bin/env node
// Portrait pictures for Instagram / Facebook / Pinterest / Reels, made from the same specs as the channel banners (tools/channel_banners/specs.js):
//   social/p_<key>.jpg  1080 x 1350 (4:5, feed posts)        social/v_<key>.jpg  1080 x 1920 (9:16, stories / reels / Pinterest)
//   node tools/build_social_images.js                      # all keys, both formats (only what changed)
//   node tools/build_social_images.js --only p03,t_tas --kind p
//   node tools/build_social_images.js --sheet /tmp/sheet   # contact sheets of what was drawn
// The banner art is drawn by tools/channel_banners/page.js (B.renderSocial) inside the game's own page.
const fs = require("fs"), path = require("path"), http = require("http"), crypto = require("crypto");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "social"), MAN = path.join(OUT, "manifest.json");
const args = process.argv.slice(2), arg = n => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] || true); };
const force = args.includes("--force"), only = arg("--only") ? String(arg("--only")).split(",") : null, kinds = arg("--kind") ? String(arg("--kind")).split(",") : ["p", "v"], sheet = arg("--sheet");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
  const legacyFile = path.join(ROOT, "server", "channel_posts.json");
  const ctx = { legacy: fs.existsSync(legacyFile) ? read(legacyFile) : [], cities: read(path.join(__dirname, "channel_bank", "cities.json")), bank: read(path.join(ROOT, "server", "channel_bank.json")) };
  const pageJs = fs.readFileSync(path.join(__dirname, "channel_banners", "page.js"), "utf8"), pageHash = crypto.createHash("sha1").update(pageJs).digest("hex").slice(0, 10);
  const list = require("./channel_banners/specs.js")(ctx).filter(j => !j.key.startsWith("a_") || (only && only.includes(j.key))), manifest = fs.existsSync(MAN) ? read(MAN) : {};
  const hashOf = (j, k) => crypto.createHash("sha1").update(pageHash + k + JSON.stringify(j.spec || j.city)).digest("hex").slice(0, 12);
  const todo = []; for (const j of list) for (const k of kinds) { const f = `${k}_${j.key}.jpg`; if ((!only || only.includes(j.key)) && (force || only || manifest[f] !== hashOf(j, k) || !fs.existsSync(path.join(OUT, f)))) todo.push({ j, k, f }); }
  if (!todo.length) { console.log("all", list.length * kinds.length, "pictures are up to date"); return; }
  const mime = { ".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".js": "text/javascript", ".json": "application/json" };
  const srv = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html"); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
  const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" })).newPage();
  await page.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" });
  await page.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  await page.addScriptTag({ content: pageJs }); await page.setViewportSize({ width: 1080, height: 1920 });
  const done = [];
  for (const { j, k, f } of todo) {
    try {
      await page.evaluate(([job, kind]) => B.renderSocial(job, kind), [j, k]);
      const h = k === "v" ? 1920 : 1350; await page.screenshot({ path: path.join(OUT, f), type: "jpeg", quality: 84, clip: { x: 0, y: 0, width: 1080, height: h } });
      await page.evaluate(() => B.remove()); manifest[f] = hashOf(j, k); done.push(f); process.stdout.write(".");
    } catch (e) { console.error("\nFAILED", f, e.message.split("\n")[0]); }
  }
  fs.writeFileSync(MAN, JSON.stringify(manifest, null, 1) + "\n");
  console.log(`\n${done.length} pictures drawn, ${(done.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1024 / 1024).toFixed(1)} MB`);
  if (sheet && done.length) {   // contact sheets: 6 portrait pictures per sheet
    const w = 360, per = 6;
    for (let n = 0; n * per < done.length; n++) {
      const part = done.slice(n * per, (n + 1) * per), p2 = await (await b.newContext({ viewport: { width: per * w, height: 700 } })).newPage();
      await p2.setContent(`<body style="margin:0;background:#111;display:flex;width:${per * w}px">${part.map(f => `<div style="width:${w}px;font:13px monospace;color:#ff0"><div style="height:20px;padding:2px 6px">${f}</div><img style="width:${w}px" src="http://localhost:${port}/social/${f}"></div>`).join("")}</body>`);
      await sleep(1200); const o = `${String(sheet).replace(/\.png$/, "")}_${n + 1}.png`; await p2.screenshot({ path: o, fullPage: true }); console.log("sheet:", o);
    }
  }
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
