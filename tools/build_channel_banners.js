#!/usr/bin/env node
// Builds the pictures of the channel posts: tools/channel_banners/specs.js says what each banner shows; the banners are drawn inside the game's own page
// (so they can use its art and its font) by tools/channel_banners/page.js and saved as server/channel/b_<key>.jpg (1280x720).
//   node tools/build_channel_banners.js                  # only the banners whose spec changed
//   node tools/build_channel_banners.js --force          # all of them
//   node tools/build_channel_banners.js --only tas,p03   # some of them (keys without the b_ prefix, city tables are t_<id>)
//   node tools/build_channel_banners.js --sheet out.png  # also a contact sheet of what was drawn
// The text posts need server/channel_bank.json (python3 tools/build_channel_bank.py); run that again afterwards so the posts pick the banners up.
const fs = require("fs"), path = require("path"), http = require("http"), crypto = require("crypto");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "server", "channel"), MAN = path.join(OUT, "banners.json");
const args = process.argv.slice(2), arg = n => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] || true); };
const force = args.includes("--force"), only = arg("--only") ? String(arg("--only")).split(",") : null, sheet = arg("--sheet");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
  const legacyFile = path.join(ROOT, "server", "channel_posts.json");
  const ctx = {legacy: fs.existsSync(legacyFile) ? read(legacyFile) : [], cities: read(path.join(__dirname, "channel_bank", "cities.json")), bank: fs.existsSync(path.join(ROOT, "server", "channel_bank.json")) ? read(path.join(ROOT, "server", "channel_bank.json")) : []};
  const pageJs = fs.readFileSync(path.join(__dirname, "channel_banners", "page.js"), "utf8"), pageHash = crypto.createHash("sha1").update(pageJs).digest("hex").slice(0, 10);
  const list = require("./channel_banners/specs.js")(ctx), manifest = fs.existsSync(MAN) ? read(MAN) : {};
  const hashOf = j => crypto.createHash("sha1").update(pageHash + JSON.stringify(j.spec || j.city)).digest("hex").slice(0, 12);
  const todo = list.filter(j => (!only || only.includes(j.key)) && (force || only || manifest[j.key] !== hashOf(j) || !fs.existsSync(path.join(OUT, `b_${j.key}.jpg`))));
  if (!todo.length) { console.log("all", list.length, "banners are up to date"); return; }
  const mime = {".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".js": "text/javascript", ".json": "application/json"};
  const srv = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html"); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, {"Content-Type": mime[path.extname(f)] || "application/octet-stream"}); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
  const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" })).newPage();
  await page.addInitScript(s => { if (!localStorage.getItem("billiard8v2")) localStorage.setItem("billiard8v2", JSON.stringify(s)); }, { name: "Alex", tutDone: true, games: 60, lang: "en", genderAsked: true, gender: "m" });
  await page.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  await page.addScriptTag({ content: pageJs });
  const done = [];
  for (const j of todo) {
    try {
      await page.evaluate(([spec, city]) => city ? B.renderCity(city) : B.render(spec), [j.spec || null, j.city || null]);
      const file = path.join(OUT, `b_${j.key}.jpg`); await page.screenshot({ path: file, type: "jpeg", quality: 86, clip: { x: 0, y: 0, width: 1280, height: 720 } });
      await page.evaluate(() => B.remove()); manifest[j.key] = hashOf(j); done.push(j.key); process.stdout.write(".");
    } catch (e) { console.error("\nFAILED", j.key, e.message.split("\n")[0]); }
  }
  fs.writeFileSync(MAN, JSON.stringify(manifest, null, 1) + "\n");
  console.log(`\n${done.length} banners drawn, ${(done.reduce((n, k) => n + fs.statSync(path.join(OUT, `b_${k}.jpg`)).size, 0) / 1024 / 1024).toFixed(1)} MB`);
  if (sheet && done.length) {   // contact sheets of 12 banners (4 x 3): <sheet>_1.png, <sheet>_2.png ...
    const cols = 4, w = 480, h = 270, per = 12;
    for (let n = 0; n * per < done.length; n++) {
      const part = done.slice(n * per, (n + 1) * per), rows = Math.ceil(part.length / cols), p2 = await (await b.newContext({ viewport: { width: cols * w, height: rows * (h + 20) } })).newPage();
      await p2.setContent(`<body style="margin:0;background:#111;display:flex;flex-wrap:wrap;width:${cols * w}px">${part.map(k => `<div style="width:${w}px;height:${h + 20}px;font:13px monospace;color:#ff0"><div style="height:20px;padding:2px 6px">${k}</div><img style="width:${w}px;height:${h}px" src="http://localhost:${port}/server/channel/b_${k}.jpg"></div>`).join("")}</body>`);
      await sleep(1200); const f = `${String(sheet).replace(/\.png$/, "")}_${n + 1}.png`; await p2.screenshot({ path: f, fullPage: true }); console.log("sheet:", f);
    }
  }
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
