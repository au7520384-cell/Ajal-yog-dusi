// Card (real-money) prices of every item that is sold in the game for cash/gems: node tools/build_prices.js
// Runs the game in a headless browser (playwright), reads the catalog + the dollar price the shop shows, and writes server/prices.json.
// The server sells exactly these prices through Stripe (the client price is never trusted). Re-run after changing any price in index.html.
const {chromium} = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
const path = require("path"), fs = require("fs");
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext()).newPage();
  await p.goto("file://" + path.join(__dirname, "..", "index.html")); await new Promise(r => setTimeout(r, 3500));
  const prices = await p.evaluate(() => {
    const o = {}, r2 = v => Math.round(v * 100) / 100;
    for (const c of CUES) if (c.cur === "cash" && c.usd && c.price > 0) o["cue_" + c.id] = r2(c.usd);
    for (const i of AV_SHOP()) { const q = avPrice(i); if (q.cur === "cash" && q.v > 0) o["av_" + i] = r2(usdOfCash(q.v)); }
    for (const f of FRAMES) if (f.id && !f.pass && !f.vip && f.cur === "cash" && f.v > 0) o["frame_" + f.id] = r2(f.usd || usdOfCash(f.v));
    for (const t of EXTRA_TABLES) if (!t.vip && !t.city && t.cash > 0) o["tbl_" + t.id] = r2(t.usd || usdOfCash(t.cash));
    for (const sp of STICKER_PACKS) o["stk_" + sp.id] = STK_USD;
    return o;
  });
  const sorted = Object.fromEntries(Object.entries(prices).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(path.join(__dirname, "..", "server", "prices.json"), JSON.stringify(sorted, null, 0) + "\n");
  console.log(Object.keys(sorted).length + " prices written");
  await b.close();
})();
