#!/usr/bin/env node
// The Mafia screen with the owner's role pictures (the owner, Nov 27: "your Mafia is a toy; the doctor, the commissar, the citizen and the mafia each a beautiful animated picture", then his own four illustrations):  node tools/test_mafia_art.js   (~1 min, no server)
// A made-up match state is put on the real screen (no server needed) and what the player sees is checked:
//  - the owner's own pictures under the screen (Nov 27): the night street and the town square by day, each with a living layer (lamps, moon, mist, steam, bats / fountain, birds, sun); the day one shows from the day on; the four role pictures (a card and a face each) decode; my role chip is the face of my role
//  - the role card at the start (a tap closes it); the shot (his alley picture, the cracked glass with the face of the victim; for ME the words 'you were shot in the night / eliminated') and then the role of the one who died; the rescue; the vote-out; a tie
//  - the seats stand round the scene (me at the bottom): inside the page, not on each other, not on the centre circle, not on the right column, at 5 sizes and 5 - 8 seats
//  - a dead seat has the cross and the face of its role; a seat that is alive and hidden has no face
const { chromium } = require("playwright"), http = require("http"), path = require("path"), fs = require("fs");
const ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
(async () => {
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, b = await chromium.launch(), errs = [];
  const open = async (vp) => {
    const ctx = await b.newContext({ viewport: vp, locale: "en-US", hasTouch: true, isMobile: true }), p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message.slice(0, 200)));
    await p.addInitScript(() => { window.__WZ_OFF = true; localStorage.setItem("b8guest", "1"); localStorage.setItem("billiard8v2", JSON.stringify({ name: "Azizjon", tutDone: true, games: 30, lang: "en", coins: 100000, genderAsked: true })); });
    await p.route(u => !/localhost|127\.0\.0\.1/.test(String(u)), r => r.abort());
    await p.goto(`http://localhost:${port}/index.html`, { waitUntil: "commit" });
    await p.waitForFunction(() => typeof profile !== "undefined" && document.getElementById("home") && !document.getElementById("boot"), null, { timeout: 150000 });
    await p.addStyleTag({ content: "#modal,#toasts,#loginSplash{display:none!important}" });
    await p.evaluate(() => {
      window.__mf = (phase, extra, n) => {
        n = n || 8; const nm = ["Siz", "Shoxrux", "Azamat", "Kenjix", "Bahodir", "Elshod", "Dilnoza", "Sardor"].slice(0, n);
        MFX.seats = nm.map((x, i) => ({ name: x, avatar: (i * 5 + 2) % 40, frame: 0, uid: "u" + i })); MFX.on = true; BR.mf = true; mfEnsure().classList.add("on");
        MFX.v = Object.assign({ phase, day: 1, until: Date.now() + 30000, n, you: 0, role: "citizen", alive: Array(n).fill(true), dead: {}, log: [], bot: Array.from({ length: n }, (_, i) => i > 0), found: [], mates: [], pick: -1, votes: {}, winner: "", roles: null }, extra || {});
        MFX.total = 35000; MFX.key = phase + ":" + MFX.v.day; MFX.off = 0; mfRender(); mfTick();
      };
    });
    return p;
  };
  const p = await open({ width: 915, height: 412 });
  // ---- the pictures
  const art = await p.evaluate(async () => { const o = {}; const load = u => new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = u; });
    for (const r of ["mafia", "doctor", "sheriff", "citizen"]) o[r] = { card: await load(MFA_IMG[r].card), face: await load(MFA_IMG[r].face), faceHtml: mfaFace(r).includes("f-" + r), artHtml: mfaArt(r).includes("a-" + r) }; return o; });
  ok(Object.values(art).every(a => a.card[0] === 1100 && a.card[1] === 435 && a.face[0] === 176 && a.faceHtml && a.artHtml), "four role pictures (the owner's illustrations): a card 1100 x 435 and a face 176 x 176 each, they decode", art);
  const bg = await p.evaluate(() => { const o = {}; for (const r of ["mafia", "doctor", "sheriff", "citizen"]) { const d = document.createElement("div"); d.innerHTML = mfaFace(r) + mfaArt(r); document.body.appendChild(d); o[r] = [...d.children].map(e => getComputedStyle(e).backgroundImage.startsWith("url(")); d.remove(); } return o; });
  ok(Object.values(bg).every(a => a[0] && a[1]), "the picture classes really carry the pictures (a CSS background each)", bg);
  const sc = await p.evaluate(async () => {
    __mf("night", { role: "mafia", mates: [3] });
    const q = (k, c) => document.querySelectorAll(`#mfScr .mfb-${k} ${c}`).length, load = u => new Promise(r => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.onerror = () => r([0, 0]); i.src = u; });
    const pics = {}; for (const k of ["night", "day", "shot"]) pics[k] = await load(MFA_BG[k]); for (const k of ["mn", "md", "ms"]) pics[k] = await load(MFA_BG[k]);
    const bgs = k => getComputedStyle(document.querySelector(`#mfScr .mfb-${k} .mfb-pic`)).backgroundImage.startsWith("url(");
    return { pics, layers: document.querySelectorAll("#mfScr .mf-bg .mfb").length, nightPic: bgs("night"), dayPic: bgs("day"), nLamps: q("night", ".mfb-lamp,.mfb-flick"), nNeon: q("night", ".mfb-neon,.mfb-flick"), nFog: q("night", ".mfb-fog"), nPuff: q("night", ".mfb-puff"), nBat: q("night", ".mfb-fly.bat"), moon: q("night", ".mfb-moon"),
      dFog: q("day", ".mfb-fog"), dBirds: q("day", ".mfb-fly.bird"), dDrops: q("day", ".mfb-drop"), dGlints: q("day", ".mfb-tw"), dRays: q("day", ".mfb-ray"), dBloom: q("day", ".mfb-bloom"), dMotes: q("day", ".mfb-mote"),
      stageCover: (() => { const st = document.querySelector("#mfScr .mfb-night .mfb-st"), r = st.getBoundingClientRect(), c = st.parentElement.getBoundingClientRect(); return r.width >= c.width - 1 && r.height >= c.height - 1 && Math.abs(r.width / r.height - 1920 / 1072) < 0.05; })() };
  });
  ok(sc.pics.night[0] === 1920 && sc.pics.night[1] === 1072 && sc.pics.day[0] === 1920 && sc.pics.shot[0] === 1920 && sc.pics.mn[0] === 1024 && sc.pics.md[0] === 1024 && sc.pics.ms[0] === 1024, "the owner's three pictures (1920 px wide) and the three mist strips decode", sc.pics);
  ok(sc.layers === 2 && sc.nightPic && sc.dayPic && sc.stageCover, "two scenes under the screen, each a picture in a stage that covers the screen (like a photo) at the picture's proportions", sc);
  ok(sc.nLamps >= 7 && sc.nNeon >= 4 && sc.nFog >= 3 && sc.nPuff >= 8 && sc.nBat >= 2 && sc.moon >= 1, "the night street lives: lamps (two fail now and then), neon signs, mist, steam from the manhole, bats, the moon", sc);
  ok(sc.dFog >= 3 && sc.dBirds >= 5 && sc.dDrops >= 9 && sc.dGlints >= 15 && sc.dRays >= 3 && sc.dBloom === 1 && sc.dMotes >= 12, "the town square lives: clouds and haze, birds, the fountain (drops and sparkles), sun on glass, rays of light, dust in the sun, the morning flash", sc);
  const run = await p.evaluate(() => { const names = e => getComputedStyle(e).animationName, pick = c => document.querySelector(`#mfScr .mfb-night ${c}`); return { cam: names(document.querySelector("#mfScr .mfb-night .mfb-st")), fog: names(pick(".mfb-fog")), moon: names(pick(".mfb-moon")), lamp: names(pick(".mfb-flick")), bat: names(pick(".mfb-fly")) }; });
  ok(Object.values(run).every(n => n && n !== "none"), "...and every layer has its animation (CSS only: transform / opacity)", run);
  const op = async () => p.evaluate(() => getComputedStyle(document.querySelector("#mfScr .mf-bg.d")).opacity);
  await sleep(1700); ok(+(await op()) < .05, "the night: the day square is hidden", await op());
  await p.evaluate(() => { __mf("day", { role: "doctor" }); mfSunrise("day"); }); await sleep(1800); ok(+(await op()) > .95, "the day: the day square shows (the morning comes)", await op());
  const paused = await p.evaluate(() => ({ night: getComputedStyle(document.querySelector("#mfScr .mf-bg.n .mfb-fog")).animationPlayState, day: getComputedStyle(document.querySelector("#mfScr .mf-bg.d .mfb-fog")).animationPlayState }));
  ok(paused.night === "paused" && paused.day === "running", "only the scene that is on show runs (the other one is paused: the phone does not animate what nobody sees)", paused);
  await p.evaluate(() => __mf("night", { role: "sheriff", found: [{ seat: 2, mafia: false }] }));
  const chip = await p.evaluate(() => ({ face: !!document.querySelector("#mfRole .mfa-face.f-sheriff"), txt: document.getElementById("mfRole").textContent }));
  ok(chip.face && /Sheriff/.test(chip.txt), "my role chip is the face of my role (the owner's picture)", chip);
  // ---- the events
  const ovState = () => p.evaluate(() => { const o = document.getElementById("mfOv"); return { on: o.classList.contains("on"), cls: o.className, h2: (o.querySelector("h2") || {}).textContent || "", name: (o.querySelector("b") || {}).textContent || "", port: !!o.querySelector(".mfa-art"), role: ((o.querySelector(".mfa-art") || {}).className || "").replace(/.*a-/, ""), crack: !!o.querySelector(".mf-crack"), heal: !!o.querySelector(".mf-heal"), x: !!o.querySelector(".mf-x"), paths: o.querySelectorAll(".mf-crack path").length }; });
  for (const role of ["mafia", "doctor", "sheriff", "citizen"]) {
    await p.evaluate(r => { __mf("reveal", { role: r }); mfEvent(MFX.v); }, role); await sleep(500); const s = await ovState();
    ok(s.on && s.port && s.role === role && s.h2.toLowerCase() === role, `the match opens with the role card of a ${role}: his picture over the screen and the name`, s);
  }
  await p.evaluate(() => document.getElementById("mfOv").click()); await sleep(200); ok(!(await ovState()).on, "a tap closes the role card");
  const D = { alive: [true, true, false, true, true, true, true, true], dead: { 2: "citizen" }, role: "doctor", log: [{ d: 1, k: "died", seat: 2, role: "citizen" }] };
  await p.evaluate(d => { __mf("day", d); mfEvent(MFX.v); }, D); await sleep(900); let s = await ovState();
  ok(s.on && s.crack && s.paths >= 3 && /shot in the night/i.test(s.h2) && s.name === "Azamat" && /shot/.test(s.cls), "a night kill: the owner's alley picture, the cracked glass over the victim, 'Shot in the night', the name", s);
  const pic = await p.evaluate(() => { const o = document.getElementById("mfOv"), st = o.querySelector(".mfb-shot .mfb-st"); return { shotPic: !!o.querySelector(".mfb-shot .mfb-pic"), glints: o.querySelectorAll(".mfb-tw").length, embers: o.querySelectorAll(".mfb-ember").length, smoke: o.querySelectorAll(".mfb-fog").length, flash: !!o.querySelector(".mfb-flash"), hit: st ? getComputedStyle(st).animationName : "" }; });
  ok(pic.shotPic && pic.glints >= 10 && pic.embers >= 20 && pic.smoke >= 3 && pic.flash && pic.hit === "mfbHit", "...over the alley: glints on the cracks, embers, smoke, the muzzle flash and a shake of the camera", pic);
  await sleep(2400); s = await ovState();
  ok(s.on && s.port && s.role === "citizen" && /citizen/i.test(s.h2) && s.name === "Azamat", "...then the role of the one who died (the citizen's picture)", s);
  await sleep(3400); ok(!(await ovState()).on, "...and the pictures go away by themselves");
  const DM = { alive: [false, true, true, true, true, true, true, true], dead: { 0: "doctor" }, role: "doctor", log: [{ d: 1, k: "died", seat: 0, role: "doctor" }] };
  await p.evaluate(d => { __mf("day", d); mfEvent(MFX.v); }, DM); await sleep(900);
  const me = await p.evaluate(() => { const o = document.getElementById("mfOv"), h = o.querySelector(".mf-vt.me h2"), sm = o.querySelector(".mf-vt.me small"), r = h ? h.getBoundingClientRect() : null, pw = o.getBoundingClientRect(); return { cls: o.className, big: h ? h.textContent : "", small: sm ? sm.textContent : "", crack: !!o.querySelector(".mf-crack"), fits: !!r && r.left >= 0 && r.right <= pw.width + 1 && r.top >= 0, size: h ? parseFloat(getComputedStyle(h).fontSize) : 0 }; });
  ok(/shot/.test(me.cls) && /eliminated/i.test(me.big) && /shot in the night/i.test(me.small) && !me.crack && me.fits && me.size >= 24, "when I am the one shot: the owner's picture with its words ('You were shot in the night' / 'Eliminated') written by the game, inside the screen, no medallion", me);
  await p.evaluate(() => { __mf("day", { role: "doctor", log: [{ d: 1, k: "none" }] }); mfEvent(MFX.v); }); await sleep(600); s = await ovState();
  ok(s.on && s.heal && /Nobody died/i.test(s.h2), "nobody died: the green cross (the doctor's rescue stays anonymous)", s);
  const O = { day: 2, role: "citizen", log: [{ d: 1, k: "out", seat: 4, role: "mafia" }], alive: [true, true, true, true, false, true, true, true], dead: { 4: "mafia" } };
  await p.evaluate(d => { __mf("night", d); mfEvent(MFX.v); }, O); await sleep(700); s = await ovState();
  ok(s.on && s.x && /voted out/i.test(s.h2) && !s.crack && /out/.test(s.cls) && !/shot/.test(s.cls), "voted out: the cross over the player (the town square at dusk), no glass, not a shot", s);
  await sleep(2400); s = await ovState(); ok(s.on && s.port && s.role === "mafia" && /mafia/i.test(s.h2) && s.name === "Bahodir", "...then his role (the mafia's picture)", s);
  await p.evaluate(() => { __mf("night", { day: 2, role: "citizen", log: [{ d: 1, k: "tie" }] }); mfEvent(MFX.v); }); await sleep(500); s = await ovState();
  ok(s.on && /tied/i.test(s.h2), "a tie: a short banner", s);
  await p.evaluate(() => { __mf("vote", { role: "citizen" }); mfEvent(MFX.v); }); await sleep(300); ok(!(await ovState()).on, "a phase that has nothing to tell shows no picture");
  // ---- the seats
  await p.evaluate(d => __mf("day", d), D);
  const seats = await p.evaluate(() => [...document.querySelectorAll("#mfScr .mf-p")].map((e, i) => ({ dead: e.classList.contains("dead"), x: !!e.querySelector(".mf-x"), mini: !!e.querySelector(".mf-mini .mfa-face"), role: (e.className.match(/r-(\w+)/) || [])[1] || "" })));
  ok(seats[2].dead && seats[2].x && seats[2].mini && seats[2].role === "citizen", "a dead seat: the cross and the face of its role", seats[2]);
  ok(seats.every((t, i) => i === 2 || i === 0 || !t.mini), "a seat that is alive and hidden shows no face", seats.map(t => t.mini));
  ok(seats[0].mini && seats[0].role === "doctor", "my seat shows my own role", seats[0]);
  await p.context().close();
  for (const [name, vp] of [["915 x 412", { width: 915, height: 412 }], ["740 x 360", { width: 740, height: 360 }], ["568 x 320", { width: 568, height: 320 }], ["412 x 915 (turned)", { width: 412, height: 915 }], ["1280 x 720", { width: 1280, height: 720 }]]) {
    const q = await open(vp);
    for (const n of [5, 8]) {
      const g = await q.evaluate(n => {
        __mf("night", { role: "mafia", mates: [3] }, n);
        const rot = document.documentElement.classList.contains("rot"), W = rot ? innerHeight : innerWidth, H = rot ? innerWidth : innerHeight, page = r => rot ? { l: r.top, t: innerWidth - r.right, r: r.bottom, b: innerWidth - r.left } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
        const R = e => page(e.getBoundingClientRect()), tiles = [...document.querySelectorAll("#mfScr .mf-p")].map(R), avs = [...document.querySelectorAll("#mfScr .mf-av")].map(R), core = R(document.querySelector("#mfScr .mf-core")), right = R(document.querySelector("#mfScr .mf-right"));
        const inter = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1, inside = r => r.l >= -1 && r.t >= -1 && r.r <= W + 1 && r.b <= H + 1;
        let overlap = 0; for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (inter(tiles[i], tiles[j])) overlap++;
        const onCore = avs.filter(a => inter(a, core)).length, onRight = tiles.filter(t => t.r > right.l + 1).length;
        return { W, H, n: tiles.length, allIn: tiles.every(inside), overlap, onCore, onRight, meBottom: tiles[0].t > tiles.slice(1).reduce((m, t) => Math.min(m, t.t), 1e9) };
      }, n);
      ok(g.n === n && g.allIn && g.overlap === 0 && g.onCore === 0 && g.onRight === 0 && g.meBottom, `${name}, ${n} seats: round the village, inside the page, apart from each other, the centre and the right column, me at the bottom`, g);
    }
    await q.context().close();
  }
  ok(errs.length === 0, "no page errors", errs.slice(0, 4));
  console.log(`pass ${pass}, fail ${fail}`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
