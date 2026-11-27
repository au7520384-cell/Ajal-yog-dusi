#!/usr/bin/env node
// The painted Mafia screen (the owner, Nov 27: "your Mafia is a toy; the doctor, the commissar, the citizen and the mafia each a beautiful animated picture"):  node tools/test_mafia_art.js   (~1 min, no server)
// A made-up match state is put on the real screen (no server needed) and what the player sees is checked:
//  - two painted villages (night and day) under the screen, the day one shows from the day on; four role portraits; my role chip is the portrait of my role
//  - the role card at the start (a tap closes it); the shot (cracked glass) and then the role of the one who died; the rescue; the vote-out; a tie
//  - the seats stand round the village (me at the bottom): inside the page, not on each other, not on the centre circle, not on the right column, at 5 sizes and 5 - 8 seats
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
  const art = await p.evaluate(() => { const o = {}; for (const r of ["mafia", "doctor", "sheriff", "citizen"]) { const d = document.createElement("div"); d.innerHTML = mfaPortrait(r); const s = d.firstChild; o[r] = { cls: s.getAttribute("class"), eyes: s.querySelectorAll(".mfa-eye").length, body: s.querySelectorAll(".mfa-body").length, head: s.querySelectorAll(".mfa-head").length }; } return o; });
  ok(Object.entries(art).every(([r, a]) => a.cls.includes("mfa-" + r) && a.eyes === 2 && a.body === 1 && a.head === 1), "four role portraits: mafia, doctor, sheriff, citizen, each with a body, a head and two eyes that blink", art);
  const sc = await p.evaluate(() => { __mf("night", { role: "mafia", mates: [3] }); return { layers: document.querySelectorAll("#mfScr .mf-bg svg.mfa-scene").length, win: document.querySelectorAll("#mfScr .mfa-win").length, trees: document.querySelectorAll("#mfScr .mfa-sway").length, crows: document.querySelectorAll("#mfScr .mfa-crow").length, stars: document.querySelectorAll("#mfScr .mfa-tw").length }; });
  ok(sc.layers === 2 && sc.win > 8 && sc.trees >= 8 && sc.crows >= 6 && sc.stars >= 40, "two painted villages under the screen: lit windows, swaying trees, crows, stars", sc);
  const op = async () => p.evaluate(() => getComputedStyle(document.querySelector("#mfScr .mf-bg.d")).opacity);
  await sleep(1700); ok(+(await op()) < .05, "the night: the day village is hidden", await op());
  await p.evaluate(() => { __mf("day", { role: "doctor" }); mfSunrise("day"); }); await sleep(1800); ok(+(await op()) > .95, "the day: the day village shows (the sun rises)", await op());
  await p.evaluate(() => __mf("night", { role: "sheriff", found: [{ seat: 2, mafia: false }] }));
  const chip = await p.evaluate(() => ({ svg: !!document.querySelector("#mfRole .mfa-port.mfa-sheriff"), txt: document.getElementById("mfRole").textContent }));
  ok(chip.svg && /Sheriff/.test(chip.txt), "my role chip is the painted face of my role", chip);
  // ---- the events
  const ovState = () => p.evaluate(() => { const o = document.getElementById("mfOv"); return { on: o.classList.contains("on"), cls: o.className, h2: (o.querySelector("h2") || {}).textContent || "", name: (o.querySelector("b") || {}).textContent || "", port: !!o.querySelector(".mfa-port"), crack: !!o.querySelector(".mf-crack"), heal: !!o.querySelector(".mf-heal"), x: !!o.querySelector(".mf-x"), paths: o.querySelectorAll(".mf-crack path").length }; });
  for (const role of ["mafia", "doctor", "sheriff", "citizen"]) {
    await p.evaluate(r => { __mf("reveal", { role: r }); mfEvent(MFX.v); }, role); await sleep(500); const s = await ovState();
    ok(s.on && s.port && s.h2.toLowerCase() === { mafia: "mafia", doctor: "doctor", sheriff: "sheriff", citizen: "citizen" }[role], `the match opens with the role card of a ${role}: the portrait and the name`, s);
  }
  await p.evaluate(() => document.getElementById("mfOv").click()); await sleep(200); ok(!(await ovState()).on, "a tap closes the role card");
  const D = { alive: [true, true, false, true, true, true, true, true], dead: { 2: "citizen" }, role: "doctor", log: [{ d: 1, k: "died", seat: 2, role: "citizen" }] };
  await p.evaluate(d => { __mf("day", d); mfEvent(MFX.v); }, D); await sleep(900); let s = await ovState();
  ok(s.on && s.crack && s.paths >= 3 && /shot in the night/i.test(s.h2) && s.name === "Azamat", "a night kill: the cracked glass over the victim, 'Shot in the night', the name", s);
  await sleep(2400); s = await ovState();
  ok(s.on && s.port && /citizen/i.test(s.h2) && s.name === "Azamat", "...then the role of the one who died (the citizen's portrait)", s);
  await sleep(3400); ok(!(await ovState()).on, "...and the pictures go away by themselves");
  await p.evaluate(() => { __mf("day", { role: "doctor", log: [{ d: 1, k: "none" }] }); mfEvent(MFX.v); }); await sleep(600); s = await ovState();
  ok(s.on && s.heal && /Nobody died/i.test(s.h2), "nobody died: the green cross (the doctor's rescue stays anonymous)", s);
  const O = { day: 2, role: "citizen", log: [{ d: 1, k: "out", seat: 4, role: "mafia" }], alive: [true, true, true, true, false, true, true, true], dead: { 4: "mafia" } };
  await p.evaluate(d => { __mf("night", d); mfEvent(MFX.v); }, O); await sleep(700); s = await ovState();
  ok(s.on && s.x && /voted out/i.test(s.h2) && !s.crack, "voted out: the cross over the player, no glass", s);
  await sleep(2400); s = await ovState(); ok(s.on && s.port && /mafia/i.test(s.h2) && s.name === "Bahodir", "...then his role (the mafia's portrait)", s);
  await p.evaluate(() => { __mf("night", { day: 2, role: "citizen", log: [{ d: 1, k: "tie" }] }); mfEvent(MFX.v); }); await sleep(500); s = await ovState();
  ok(s.on && /tied/i.test(s.h2), "a tie: a short banner", s);
  await p.evaluate(() => { __mf("vote", { role: "citizen" }); mfEvent(MFX.v); }); await sleep(300); ok(!(await ovState()).on, "a phase that has nothing to tell shows no picture");
  // ---- the seats
  await p.evaluate(d => __mf("day", d), D);
  const seats = await p.evaluate(() => [...document.querySelectorAll("#mfScr .mf-p")].map((e, i) => ({ dead: e.classList.contains("dead"), x: !!e.querySelector(".mf-x"), mini: !!e.querySelector(".mf-mini"), role: (e.className.match(/r-(\w+)/) || [])[1] || "" })));
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
