#!/usr/bin/env node
// The home screen made from the owner's mockup pictures (tools/add_home_art.py):  node tools/test_home_art.js   (B8_ROOT=<repo copy>)
// Chromium, a phone, a small laptop and a big screen; the page is checked as a player sees it:
//  - every picture of the top bar and of the mode cards is loaded (no broken picture) and the two stretched plates (profile, money) have their 9-slice in percentages
//  - the top bar never overlaps itself, stays 62 px high (in menu zoom units) and the name / level / XP numbers stand inside the profile plate
//  - a tap in the middle of every card and of every top-bar key opens the right screen (the cards are scaled back about their middle on a stretched stage: the tap area is the picture)
//  - the cards keep the mockup's proportions (not stretched), do not overlap each other, their words stay inside them, in every language
//  - the limited-edition timer stands inside its tile, the ribbon label inside the ribbon
const { chromium } = require("playwright"), { spawn } = require("child_process"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), PORT = +process.env.TEST_PORT || 8335;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const SIZES = [{ n: "phone 915x412", w: 915, h: 412, mobile: true }, { n: "small laptop 1280x720", w: 1280, h: 720 }, { n: "big 2392x1080", w: 2392, h: 1080 }, { n: "portrait 412x767", w: 412, h: 767, mobile: true }];
(async () => {
  const srv = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" }); await sleep(800);
  const b = await chromium.launch(), errs = [];
  const open = async (sz, lang) => {
    const ctx = await b.newContext({ viewport: { width: sz.w, height: sz.h }, locale: "en-US", hasTouch: !!sz.mobile, isMobile: !!sz.mobile, deviceScaleFactor: 1 }), p = await ctx.newPage();
    p.on("pageerror", e => errs.push(sz.n + ": " + e.message.slice(0, 200)));
    await p.addInitScript(l => localStorage.setItem("billiard8v2", JSON.stringify({ name: "Logistika", tutDone: true, games: 60, genderAsked: true, gender: "m", lang: l, country: "uz", coins: 218524, gems: 6, cash: 6, xp: 36 })), lang || "ru");
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 }); await sleep(600);
    await p.evaluate(() => { const g = document.getElementById("lsGuest"); if (g) g.click(); }); await sleep(500);
    await p.evaluate(() => { go("home"); const t = document.getElementById("toasts"); if (t) t.style.display = "none"; }); await sleep(2500);
    // measure a bar that stands still: a medal / coin landing bumps a money chip (scale) and counts its number up for a moment, and a chip that is mid-bump overlaps its neighbour on purpose (fitNav ignores it too)
    let last = "", still = 0;
    for (let i = 0; i < 50 && still < 4; i++) {
      const st = await p.evaluate(() => ({ run: document.getAnimations().some(a => a.playState === "running" && a.effect && a.effect.getTiming().iterations !== Infinity && a.effect.target && a.effect.target.closest && a.effect.target.closest("#nav")), w: [...document.querySelectorAll("#nav .mchip, #nav .pchip2, #nav .nb")].map(e => Math.round(e.getBoundingClientRect().width * 10)).join(",") }));
      if (!st.run && st.w === last) still++; else still = 0; last = st.w; await sleep(120);
    }
    return p;
  };
  const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);   // (screen pixels: for taps)
  const frame = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return rotated ? { l: r.top, t: r.left, r: r.bottom, b: r.right, w: r.height, h: r.width } : { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);   // (the page's own frame: a turned page has its x axis along the screen's y axis)
  const inside = (a, c, tol = 1.5) => a && c && a.l >= c.l - tol && a.r <= c.r + tol && a.t >= c.t - tol && a.b <= c.b + tol;
  try {
    for (const sz of SIZES) {
      const p = await open(sz);
      // ---- pictures
      const imgs = await p.evaluate(() => [...document.querySelectorAll("#nav img[data-img^=home_], #home img[data-img^=home_c_]")].map(i => [i.dataset.img, i.naturalWidth, i.complete]));
      ok(imgs.length >= 14 && imgs.every(([k, w, c]) => c && w > 20), `${sz.n}: every picture of the top bar and of the cards is loaded`, imgs.filter(([k, w, c]) => !(c && w > 20)));
      const vars = await p.evaluate(() => ["home_pplate", "home_mplate", "home_gem", "home_cash", "home_coin", "home_plus", "home_key", "home_fs", "home_set"].map(k => [k, /^url\(["']?data:image\/webp/.test(getComputedStyle(document.documentElement).getPropertyValue("--i-" + k).trim())]));
      ok(vars.every(v => v[1]), `${sz.n}: the CSS pictures (plates, money icons, keys) are set`, vars.filter(v => !v[1]));
      const slices = await p.evaluate(() => [".pc-plate", ".money"].map(s => getComputedStyle(document.querySelector(s)).borderImageSlice));
      ok(slices.every(s => /%/.test(s)), `${sz.n}: the 9-slice of the plates is in percentages (an HD copy cannot move it)`, slices);
      // ---- top bar
      const nav = await p.evaluate(() => { const n = document.getElementById("nav"), items = []; const add = (name, e) => { if (getComputedStyle(e).display === "none") return; const r = e.getBoundingClientRect(); if (r.width < 2) return; items.push(rotated ? [name, r.top, r.bottom, r.left, r.right] : [name, r.left, r.right, r.top, r.bottom]); };
        for (const c of n.children) { if (c.classList.contains("navbtns") || c.classList.contains("money")) for (const d of c.children) add(d.id || d.className, d); else add(c.id || c.className, c); }
        items.sort((a, b) => a[1] - b[1]); const bad = []; for (let i = 0; i < items.length - 1; i++) if (items[i][2] > items[i + 1][1] + 1.5) bad.push([items[i][0], items[i + 1][0]]);
        const nr = n.getBoundingClientRect(), uz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--uiz")) || 1, lim = rotated ? nr.bottom : nr.right, gaps = [];
        for (let i = 0; i < items.length - 1; i++) gaps.push((items[i + 1][1] - items[i][2]) / uz);
        const fr = e => { const r = document.querySelector(e).getBoundingClientRect(); return rotated ? [r.top, r.bottom] : [r.left, r.right]; }, pc = fr(".pchip2"), nb = fr(".navbtns"), mo = fr(".money");
        return { bad, n: items.length, h: (rotated ? nr.width : nr.height) / uz, rot: rotated, maxGap: Math.max(...gaps), lm: items[0][1] / uz, rm: (lim - items[items.length - 1][2]) / uz, gapL: (nb[0] - pc[1]) / uz, gapR: (mo[0] - nb[1]) / uz, cssW: (rotated ? nr.height : nr.width) / uz }; });
      ok(nav.n >= 10 && nav.bad.length === 0, `${sz.n}: the top bar does not overlap itself (${nav.n} pieces)`, nav);
      ok(nav.cssW > 1760 || (nav.lm <= 16 && nav.rm <= 16), `${sz.n}: the profile card stands in the LEFT corner and the keys in the RIGHT one (margins ${nav.lm.toFixed(0)} / ${nav.rm.toFixed(0)} px)`, nav);
      ok(Math.abs(nav.gapL - nav.gapR) <= 6, `${sz.n}: the icons stand in the middle between the profile plate and the money plate (gaps ${nav.gapL.toFixed(0)} / ${nav.gapR.toFixed(0)} px)`, nav);
      ok(nav.maxGap <= 230, `${sz.n}: the gaps of the top bar do not open up (widest ${nav.maxGap.toFixed(0)} px)`, nav);
      ok(Math.abs(nav.h - 62) < 1.5, `${sz.n}: the top bar is 62 px high (${nav.h.toFixed(1)})`, nav);
      const pl = { chip: await frame(p, ".pchip2"), name: await frame(p, "#navName"), lvl: await frame(p, "#navLvl"), xp: await frame(p, "#navXpT") };
      ok(inside(pl.name, pl.chip) && inside(pl.lvl, pl.chip) && inside(pl.xp, pl.chip), `${sz.n}: name, level and XP numbers stand inside the profile plate`, pl);
      // a coin landing makes its money chip 16% bigger for 0.2 s; the bar must not "squeeze" (hide pieces) because of it
      const bump = await p.evaluate(async () => { const nav = document.getElementById("nav"), seen = []; const chips = [...document.querySelectorAll(".money .mchip")]; const anims = chips.map(c => c.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 700 }));
        for (let i = 0; i < 6; i++) { fitNav(); seen.push(nav.className); await new Promise(r => setTimeout(r, 90)); } anims.forEach(a => a.cancel()); return seen; });
      ok(bump.every(c => !/nf\d/.test(c)), `${sz.n}: a bumping money chip does not squeeze the top bar`, bump);
      // ---- taps on the top bar
      const tapNav = [["#pchip", "profileScr"], ["#nav .navbtns .nb:nth-child(1)", "clubsScr"], ["#nav .navbtns .nb:nth-child(2)", "passScr"], ["#nav .navbtns .nb:nth-child(3)", "shop"], ["#nav .nb-cues", "shop"], ["#nav .navbtns .nb:nth-child(5)", "leader"], ["#nav .nb-mini", "mini"], ["#setBtn", "settingsScr"]];
      for (const [sel, want] of tapNav) {
        await p.evaluate(() => go("home")); await sleep(450);
        const r = await rect(p, sel); if (!r) { ok(false, `${sz.n}: ${sel} exists`); continue; }
        if (sz.mobile) await p.touchscreen.tap(r.l + r.w / 2, r.t + r.h / 2); else await p.mouse.click(r.l + r.w / 2, r.t + r.h / 2);
        await sleep(600); const on = await p.evaluate(() => (document.querySelector(".screen.on") || {}).id);
        ok(on === want, `${sz.n}: a tap on ${sel} opens ${want}`, on);
      }
      // ---- cards
      await p.evaluate(() => go("home")); await sleep(700);
      const cards = ["tPlay", "tTour", "tEvents", "tMini", "tWithFr", "hLimited"];
      const R = {}; for (const id of cards) R[id] = await frame(p, "#" + id);
      const art = await p.evaluate(ids => Object.fromEntries(ids.map(id => { const i = document.querySelector("#" + id + " .hmci"); const r = i.getBoundingClientRect(); return [id, { w: rotated ? r.height : r.width, h: rotated ? r.width : r.height, nw: i.naturalWidth, nh: i.naturalHeight }]; })), cards);
      for (const id of cards) { const a = art[id], asp = (a.w / a.h) / (a.nw / a.nh); ok(Math.abs(asp - 1) < 0.03, `${sz.n}: the picture of #${id} keeps its proportions (${asp.toFixed(3)})`, a); }
      const stage = await frame(p, "#hstage"), rowL = R.tPlay.l - stage.l, rowR = stage.r - R.tWithFr.r, rowW = R.tWithFr.r - R.tPlay.l;
      ok(rowW / stage.w <= 0.72, `${sz.n}: the five cards take at most 72% of the picture's width (${(100 * rowW / stage.w).toFixed(0)}%)`, { rowW, stageW: stage.w });
      ok(Math.abs(rowL - rowR) / stage.w <= 0.03, `${sz.n}: the row of cards is centred (${(100 * rowL / stage.w).toFixed(1)}% / ${(100 * rowR / stage.w).toFixed(1)}%)`, { rowL, rowR });
      const row = cards.slice(0, 5).map(id => R[id]); let ovl = [];
      for (let i = 0; i < row.length - 1; i++) if (row[i].r > row[i + 1].l + 0.5) ovl.push([cards[i], cards[i + 1]]);
      ok(ovl.length === 0, `${sz.n}: the five mode cards do not overlap`, { ovl, row });
      const vp = nav.rot ? { l: 0, t: 0, r: sz.h, b: sz.w } : { l: 0, t: 0, r: sz.w, b: sz.h };
      ok(cards.every(id => inside(R[id], vp, 2)), `${sz.n}: all cards are on the screen`, R);
      ok(R.hLimited.l >= R.tWithFr.r - 4 || R.hLimited.t >= R.tWithFr.b - 2 || R.hLimited.b <= R.tWithFr.t + 2, `${sz.n}: the limited tile does not cover the last mode card`, [R.hLimited, R.tWithFr]);
      const words = await p.evaluate(() => { const out = []; for (const id of ["tPlay", "tTour", "tEvents", "tMini", "tWithFr"]) { const c = document.getElementById(id).getBoundingClientRect(); for (const e of document.querySelectorAll("#" + id + " .hl b, #" + id + " .hl i, #" + id + " small, #" + id + " .hbtag")) { const r = e.getBoundingClientRect(); if (r.width < 1) continue; out.push([id, e.tagName + ":" + e.textContent.trim().slice(0, 24), r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1]); } } return out; });   // (boxes in screen pixels: a card and its words turn together)
      ok(words.length >= 8 && words.every(w => w[2]), `${sz.n}: the words of the cards stand inside the cards`, words.filter(w => !w[2]));
      const lim = await p.evaluate(() => { const t = document.getElementById("hLimited").getBoundingClientRect(), e = document.getElementById("hLimEnds").getBoundingClientRect(), l = document.querySelector("#hLimited .hlim").getBoundingClientRect(); return { tile: { l: t.left, r: t.right, t: t.top, b: t.bottom }, ends: { l: e.left, r: e.right, t: e.top, b: e.bottom, txt: document.getElementById("hLimEnds").textContent }, lab: { l: l.left, r: l.right, t: l.top, b: l.bottom, w: document.querySelector("#hLimited .hlim").scrollWidth, cw: document.querySelector("#hLimited .hlim").clientWidth } }; });   // (screen pixels)
      ok(inside(lim.ends, lim.tile) && /\d/.test(lim.ends.txt), `${sz.n}: the limited timer stands inside its tile (${lim.ends.txt})`, lim);
      ok(lim.lab.w <= lim.lab.cw + 1, `${sz.n}: the ribbon's label fits its ribbon`, lim.lab);
      // ---- taps on the cards
      const tapCards = [["tPlay", "cities"], ["tTour", "tourScr"], ["tEvents", "eventsScr"], ["tMini", "mini"], ["tWithFr", "withFrScr"]];
      for (const [id, want] of tapCards) {
        await p.evaluate(() => go("home")); await sleep(450);
        const r = await rect(p, "#" + id);
        if (sz.mobile) await p.touchscreen.tap(r.l + r.w / 2, r.t + r.h * 0.62); else await p.mouse.click(r.l + r.w / 2, r.t + r.h * 0.62);
        await sleep(600); const on = await p.evaluate(() => (document.querySelector(".screen.on") || {}).id);
        ok(on === want, `${sz.n}: a tap on the card #${id} opens ${want}`, on);
      }
      await p.evaluate(() => go("home")); await sleep(450);
      { const r = await rect(p, "#hLimited"); if (sz.mobile) await p.touchscreen.tap(r.l + r.w / 2, r.t + r.h * 0.4); else await p.mouse.click(r.l + r.w / 2, r.t + r.h * 0.4); await sleep(600);
        ok(await p.evaluate(() => document.getElementById("modal").classList.contains("on")), `${sz.n}: a tap on the limited tile opens its window`); }
      await p.context().close();
    }
    // ---- every language: words stay inside the cards (the longest words are the German / Russian / Indonesian / Arabic ones)
    for (const lang of ["de", "ru", "id", "tr", "es", "pt", "fr", "ar", "ko", "ja", "zh", "hi", "en", "uz"]) {
      const p = await open({ n: "lang " + lang, w: 915, h: 412, mobile: true }, lang);
      const words = await p.evaluate(() => { const out = []; for (const id of ["tPlay", "tTour", "tEvents", "tMini", "tWithFr"]) { const c = document.getElementById(id).getBoundingClientRect(); for (const e of document.querySelectorAll("#" + id + " .hl b, #" + id + " .hl i, #" + id + " small, #" + id + " .hbtag")) { const r = e.getBoundingClientRect(); if (r.width < 1) continue; out.push([id, e.textContent.trim().slice(0, 24), r.left >= c.left - 1 && r.right <= c.right + 1, e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).overflow === "visible"]); } } return out; });
      ok(words.length >= 8 && words.every(w => w[2]), `${lang}: the card words stand inside the cards`, words.filter(w => !w[2]));
      const lim = await p.evaluate(() => { const l = document.querySelector("#hLimited .hlim"), t = document.querySelector("#hLimited").getBoundingClientRect(), r = l.getBoundingClientRect(), e = document.getElementById("hLimEnds").getBoundingClientRect(); return { fits: l.scrollWidth <= l.clientWidth + 1, inTile: r.left >= t.left && r.right <= t.right && e.left >= t.left - 1 && e.right <= t.right + 1, txt: l.textContent }; });
      ok(lim.fits && lim.inTile, `${lang}: the limited-tile label (${lim.txt}) and timer fit`, lim);
      await p.context().close();
    }
    ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  } finally { await b.close(); srv.kill(); }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
