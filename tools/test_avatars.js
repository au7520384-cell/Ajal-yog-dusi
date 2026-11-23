#!/usr/bin/env node
// Every avatar, every frame, every kind of place:  node tools/test_avatars.js   (B8_ROOT=<repo copy>; ~1.5 minutes, one browser, no game server)
// The owner (Nov 23): "however many avatars we have, fix the visuals of all of them". The weekly-results window had shown what goes wrong: an avatar with a premium frame (.avx.avp) carried a margin of 12 %
// (floral frames 36 %) of its CONTAINER's width, so in a wide row it pushed the row to several times its height. Every place that puts avHTML() in a wide flex / grid / block had the same risk.
//  1) the art: all 322 avatars (100 drawn, 12 zodiac, 76 portraits, 70 premium portraits, 64 horror) paint something, none is blank, none fails to load; the 128 frames all have their picture
//  2) the margin is bounded for EVERY frame in EVERY kind of container: a wide flex row, a wide block, a grid cell, and the real classes of the lists (chat line, spectators, world chat, lobby host, versus, cup ceremony, profile,
//     friend rows): the margin is never more than 0.4 x the avatar's own size (a frame's own reserve: 12 %, floral 36 %) and the row is never more than 0.8 x the avatar's size higher than the same row without a frame, at 3 container widths x 3 sizes
//  3) the leaderboard-like rows of the real screens (weekly results, ratings) keep one height whatever frame the player has
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 900) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, locale: "en-US", deviceScaleFactor: 1, hasTouch: true, isMobile: true }), p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0, 250)));
  await p.addInitScript(() => { localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true, avatar: 3 })); });
  await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
  await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
  await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 120000 });
  await p.evaluate(() => { const e = document.getElementById("loginSplash"); if (e) e.remove(); document.getElementById("modal").classList.remove("on"); window.toast = () => {}; });
  await sleep(2500);

  // ------------------------------------------------------------------ 1) the art
  const art = await p.evaluate(async () => {
    const ids = [...Array(AV_N).keys(), ...Array.from({ length: 12 }, (_, k) => 200 + k), ...Array.from({ length: PV_N }, (_, k) => PV + k), ...Array.from({ length: GA_N }, (_, k) => GA + k), ...Array.from({ length: 64 }, (_, k) => 500 + k)];
    const out = { n: ids.length, blank: [], broken: [], flat: [], throwsAv: [] };
    for (const i of ids) { try { avatarCanvas(i); } catch (e) { out.throwsAv.push([i, String(e.message).slice(0, 60)]); } }
    await new Promise(r => setTimeout(r, 2500));   // (the portraits are decoded from their pictures)
    for (const i of ids) {
      let cv; try { cv = avatarCanvas(i); } catch (e) { continue; }
      if (!cv || !cv.width) { out.broken.push(i); continue; }
      const g = cv.getContext("2d"), w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data; let solid = 0, r0 = d[0], seen = new Set(), n = 0;
      for (let k = 0; k < d.length; k += 4 * 7) { n++; if (d[k + 3] > 40) { solid++; seen.add((d[k] >> 5) + "," + (d[k + 1] >> 5) + "," + (d[k + 2] >> 5)); } }
      if (solid / n < 0.25) out.blank.push([i, +(solid / n).toFixed(2)]); else if (seen.size < 4) out.flat.push([i, seen.size]);
    }
    return out;
  });
  ok(art.n === 322, "322 avatars in the five sets", art.n);
  ok(art.throwsAv.length === 0 && art.broken.length === 0, "every avatar can be made (no exception, a picture of its own)", { throws: art.throwsAv.slice(0, 5), broken: art.broken.slice(0, 10) });
  ok(art.blank.length === 0 && art.flat.length === 0, "no avatar is blank or one flat colour", { blank: art.blank.slice(0, 10), flat: art.flat.slice(0, 10) });
  const frames = await p.evaluate(async () => {
    const out = { n: FRAMES.length, bad: [], throwsFr: [] };
    const loadOne = src => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth > 0); im.onerror = () => res(false); im.src = src; });
    for (let f = 0; f < FRAMES.length; f++) {
      const fr = FRAMES[f]; let html; try { html = avHTML(3, f, 44); } catch (e) { out.throwsFr.push([f, String(e.message).slice(0, 60)]); continue; }
      const m = /class="avfr" src="([^"]+)"/.exec(html);
      if (fr.prem || fr.art || fr.fj) { if (!m) { out.bad.push([f, "no frame picture"]); continue; } if (!(await loadOne(m[1]))) out.bad.push([f, "picture does not load"]); }
    }
    return out;
  });
  ok(frames.n === 128 && frames.throwsFr.length === 0 && frames.bad.length === 0, "all 128 frames draw, and every framed one has its picture", frames);

  // the avatars of the match HUD are drawn on the canvas (drawAvatar): every avatar with a plain, a premium, a picture-frame and a floral frame draws something and does not throw
  const hud = await p.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 150; const g = cv.getContext("2d"), saved = ctx, out = { n: 0, throws: [], empty: [] };
    const frs = [0, FRAMES.findIndex(f => f.c && !f.prem && !f.fj), FRAMES.findIndex((f, i) => i > 0 && f.prem && !f.fj && !f.fimg), FRAMES.findIndex(f => f.art && !f.fj && !f.fimg), FRAMES.findIndex(f => f.fimg && !f.fj), FRAMES.findIndex(f => f.fj)].filter((f, k, a) => f >= 0 && a.indexOf(f) === k);   // (the kinds that exist in this build)
    const ids = [...Array(AV_N).keys(), ...Array.from({ length: 12 }, (_, k) => 200 + k), ...Array.from({ length: PV_N }, (_, k) => PV + k), ...Array.from({ length: GA_N }, (_, k) => GA + k), ...Array.from({ length: 64 }, (_, k) => 500 + k)];
    ctx = g;
    try { for (const i of ids) for (const fr of frs) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 150, 150);
      try { drawAvatar(40, 40, 70, { avatar: i, frame: fr, level: 5, name: "x", color: "#fff" }, false, undefined); } catch (e) { out.throws.push([i, fr, String(e.message).slice(0, 50)]); continue; }
      out.n++; const d = g.getImageData(0, 0, 150, 150).data; let k = 0; for (let j = 3; j < d.length; j += 36) if (d[j] > 40) k++; if (k < 60) out.empty.push([i, fr]); } } finally { ctx = saved; }
    out.frs = frs; return out;
  });
  ok(hud.frs.length >= 4 && hud.n === 322 * hud.frs.length && hud.throws.length === 0 && hud.empty.length === 0, `the match HUD draws every avatar with each kind of frame (plain, premium, picture, floral: ${hud.n} pictures, none empty, no exception)`, { n: hud.n, throws: hud.throws.slice(0, 5), empty: hud.empty.slice(0, 8), frs: hud.frs });

  // ------------------------------------------------------------------ 2) the margin and the height, every frame, every kind of container
  const sandbox = await p.evaluate(() => {
    const sites = {   // [wrapper CSS, markup around the avatar (A = the avatar)]
      "wide flex row": [`display:flex;align-items:center;gap:8px`, `@AV@<b>Name of the player</b>`],
      "wide block (centred)": [`text-align:center`, `@AV@`],
      "grid cell": [`display:grid;grid-template-columns:var(--s) 1fr`, `@AV@<b>Name</b>`],
      "chat line (.splr)": [``, `<div class="splr">@AV@<div class="splb"><b>Ali</b>salom</div></div>`],
      "my chat line (.splr.me)": [``, `<div class="splr me"><div class="splb"><b>Siz</b>salom</div>@AV@</div>`],
      "spectator (.spl-i)": [``, `<div class="spl-i">@AV@<div><b>Ali</b><small>12</small></div></div>`],
      "world chat (.wlh)": [``, `<div class="wlh">@AV@<div class="wln"><b>Ali</b><small>club</small></div></div>`],
      "lobby host (.ophost)": [``, `<div class="ophost">@AV@<span><small>Host</small><b>Ali</b></span></div>`],
      "versus (.lvp2)": [``, `<div class="lvp2"><div class="nm"><b>Ali</b></div>@AV@</div>`],
      "cup ceremony (.ccwho)": [``, `<div class="ccwho">@AV@<b>Ali</b></div>`],
      "profile (.pbig)": [``, `<div class="pbig">@AV@<button class="pedit">E</button></div>`],
      "friend row (.frow)": [``, `<div class="frow"><div class="av">@AV@</div><div><b>Ali</b><div class="muted">online</div></div></div>`],
      "friend list row (.lbr)": [``, `<div class="lbr"><div class="rk">1</div>@AV@<span></span><span></span><div class="nm"><div><b>Ali</b></div></div><div class="h">12</div></div>`],
    };
    const host = document.createElement("div"); host.id = "avSandbox"; host.style.cssText = "position:fixed;left:0;top:0;z-index:99999;background:#103;overflow:auto;max-height:100vh;max-width:100vw"; document.body.appendChild(host);
    const res = { cells: 0, bad: [], worst: { ratio: 0, where: "" }, tallest: { k: 0, where: "" } };
    for (const [name, [css, inner]] of Object.entries(sites)) for (const W of [60, 300, 700]) for (const size of [28, 40, 76]) {
      const base = (() => { host.innerHTML = `<div class="w" style="width:${W}px;${css};--s:${size}px">${inner.split("@AV@").join(avHTML(3, 0, size))}</div>`; return host.firstChild.offsetHeight; })();
      for (let f = 1; f < FRAMES.length; f++) {
        const fr = FRAMES[f]; if (!(fr.prem || fr.art || fr.fj)) continue;
        host.innerHTML = `<div class="w" style="width:${W}px;${css};--s:${size}px">${inner.split("@AV@").join(avHTML(3, f, size))}</div>`;
        const row = host.firstChild, av = row.querySelector(".avx"), cs = getComputedStyle(av), ml = Math.max(Math.abs(parseFloat(cs.marginLeft) || 0), Math.abs(parseFloat(cs.marginTop) || 0));
        const ratio = ml / size; res.cells++;
        if (ratio > res.worst.ratio) res.worst = { ratio: +ratio.toFixed(2), where: `${name} W${W} s${size} f${f}` };
        if (W >= 300 && (row.offsetHeight - base) / size > res.tallest.k) res.tallest = { k: +((row.offsetHeight - base) / size).toFixed(2), where: `${name} W${W} s${size} f${f}` };
        // (a 60 px container only makes the text wrap: its growth says nothing about the frame, only its margin is judged there)
        if (ratio > 0.4 + 1e-6 || (W >= 300 && row.offsetHeight > base + size * 0.8 + 2)) { if (res.bad.length < 12) res.bad.push(`${name} W${W} s${size} f${f}: margin ${ml.toFixed(0)}px (${ratio.toFixed(2)} x), row ${row.offsetHeight}px against ${base}px without a frame`); }
      }
    }
    host.remove();
    return res;
  });
  ok(sandbox.cells > 5000 && sandbox.bad.length === 0, `no frame in any container has a margin over 0.4 x the avatar or makes the row more than 0.8 x the avatar higher than without a frame (${sandbox.cells} cases; worst margin ${sandbox.worst.ratio} x at ${sandbox.worst.where}; most growth ${sandbox.tallest.k} x at ${sandbox.tallest.where})`, sandbox.bad);

  // ------------------------------------------------------------------ 3) the rows of the real screens
  const rows = await p.evaluate(() => {
    const mk = (i, n, won, avatar, frame) => ({ id: "u" + i, name: n, won, country: "TH", level: 6, avatar, frame });
    const week = new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10), out = { bad: [], frames: 0 };
    const prem = FRAMES.map((f, i) => i).filter(i => i > 0 && (FRAMES[i].prem || FRAMES[i].art || FRAMES[i].fj));
    for (const f of prem) {
      profile.frame = f;
      openWeeklyResults({ lastWeek: { week, top: [mk(1, "A1", 8, 11, 0), mk(2, "A2", 7, 5, 0), mk(3, "A3", 6, 8, f)] }, me: { rank: 112, won: 200 }, prizes: [1500, 750, 400], countryPrizes: [400, 200, 100], countryTop: [] });
      const r = [...document.querySelectorAll(".wkrow")].map(e => e.offsetHeight), me = document.querySelector(".wkme").offsetHeight; out.frames++;
      if (Math.max(...r) - Math.min(...r) > 3 || me > 140) out.bad.push([f, r, me]);
    }
    return out;
  });
  ok(rows.frames > 100 && rows.bad.length === 0, `weekly results: every framed avatar leaves the rows one height (${rows.frames} frames)`, rows.bad.slice(0, 4));
  ok(errs.length === 0, "no page errors", errs.slice(0, 5));
  console.log(`pass ${pass}, fail ${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
