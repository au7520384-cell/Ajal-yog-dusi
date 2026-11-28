#!/usr/bin/env node
// Online air hockey and table tennis, on the real server:  node server/test_arcade.js   (B8_ROOT=<repo copy>; about 1.5 minutes)
// The owner (Nov 28): "air hockey and table tennis need lobbies like chess and checkers: Create -> a code -> the partner enters it and joins; and the stakes must be right".
// The SERVER plays the match (server/arcade.js, the physics is the page's own, cut out of index.html into server/arcadecores.js); the phones send their finger (`ainp`) and draw the state (`ast`).
//  - a room of either game: code, two seats, the host starts it; `jcode` names the room; both phones get `bmatch` and a stream of `ast` (about 30 a second)
//  - a finger moves the mallet / the racket with the speed limit of the game; garbage, strangers and `bmove` do nothing; a seat that is away pauses the match, comes back (bresume) and gets the whole state
//  - a stake match: both stakes are held, the server decides the winner, 90% of the pool goes to him; a match that is left before the 2nd goal / point moves no coins; a leaver after it loses
//  - a rematch starts a new match with the serve swapped
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto"), STRIPE = "whsec_arc";
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8807, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const pay = async (u, sku, id) => {   // a paid Stripe checkout, signed like Stripe signs it ($1 = 2000 coins)
  const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id, payment_status: "paid", amount_total: 100, metadata: { userId: u.id, sku } } } }), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", STRIPE).update(`${t}.${raw}`).digest("hex");
  return (await fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body: raw })).status;
};
function client(acct, name) {
  const c = { name, acct, msgs: [], ws: null, ast: [] };
  c.open = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${P}/ws?id=${acct.id}&token=${acct.token}`); c.ws = ws; ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === "ast") { c.ast.push({ ...m, at: Date.now() }); if (c.ast.length > 4000) c.ast.shift(); } else c.msgs.push(m); }; ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws")); });
  c.send = m => c.ws.send(JSON.stringify(m));
  c.last = t => [...c.msgs].reverse().find(m => m.t === t);
  c.wait = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(25); } return null; };
  c.clear = () => { c.msgs.length = 0; c.ast.length = 0; };
  c.bal = async () => (await api(acct, "/api/tc")).j;
  c.lastAst = () => c.ast[c.ast.length - 1];
  return c;
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8arc-"));
  const env = { ...process.env, PORT: String(P), DATA_DIR: tmp, BROOM_GRACE_MS: "1500", BROOM_OPEN_GRACE_MS: "3000", ARC_TO_TEST: "1,2", TC_AD_GAP_MS: "400", STRIPE_WEBHOOK_SECRET: STRIPE };
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env, stdio: "ignore" });
  const up = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) return true; } catch (e) {} await sleep(300); } return false; };
  await up();
  try {
    const acc = {}, cs = {}; for (const n of ["Ann", "Bob", "Cat"]) { acc[n] = (await api(null, "/api/register", { name: n, avatar: 3 })).j; cs[n] = client(acc[n], n); await cs[n].open(); }
    const { Ann: A, Bob: B, Cat: C } = cs;

    // ------------------------------------------------------------------ a friendly air hockey room
    A.send({ t: "bcreate", game: "hockey", to: 3, cue: "start", tbl: "" });
    const r0 = await A.wait(m => m.t === "broom" && m.game === "hockey");
    ok(r0 && /^[A-Z2-9]{4}$/.test(r0.code) && r0.to === 3 && r0.state === "open" && r0.max === 2 && r0.stake === 0, "a host opens an air hockey room: a 4-letter code, two seats, first to 3 goals, no stake", r0);
    C.send({ t: "jcode", codes: [r0.code] }); const jc = await C.wait(m => m.t === "jcode");
    ok(jc && jc.kind === "broom" && jc.game === "hockey" && jc.state === "open" && !jc.full, "the one code box finds it: jcode names a broom of the game 'hockey'", jc);
    C.send({ t: "bcreate", game: "hockey", to: 99 }); const rBad = await C.wait(m => m.t === "broom"); ok(rBad && rBad.to === 5, "a length that is not offered becomes the default (5 goals)", rBad);
    C.send({ t: "bleave" }); await sleep(200); C.clear();
    B.send({ t: "bjoin", code: r0.code, cue: "start", tbl: "" }); const r1 = await B.wait(m => m.t === "broom" && m.seats.every(Boolean));
    ok(r1 && r1.seats.length === 2 && r1.state === "open", "the partner enters the code and takes the second seat", r1);
    B.clear(); A.clear(); A.send({ t: "bstart" });
    const mA = await A.wait(m => m.t === "bmatch"), mB = await B.wait(m => m.t === "bmatch");
    ok(mA && mB && mA.game === "hockey" && mA.room === mB.room && mA.to === 3 && (mA.first === 0 || mA.first === 1) && mA.stake === 0, "the host starts: both phones get bmatch (game, room, first server, length)", [mA, mB]);
    await sleep(1000); const n0 = A.ast.length, nB0 = B.ast.length; await sleep(1000);
    const rateA = A.ast.length - n0, rateB = B.ast.length - nB0;
    ok(rateA >= 24 && rateA <= 36 && rateB >= 24 && rateB <= 36, "about 30 states a second reach each phone", [rateA, rateB]);
    const s1 = A.lastAst();
    ok(s1 && s1.g === "hockey" && s1.room === mA.room && ["serve", "play"].includes(s1.s) && s1.sc.join() === "0,0" && s1.pk.length === 4 && s1.ml.length === 2 && s1.ml[0].length === 4, "the state: the game, the room, serve / play, the score, the puck [x z vx vz], both mallets", s1);
    // a finger moves the mallet, with the speed limit of the game (560 cm/s)
    A.ast.length = 0; B.send({ t: "ainp", x: 90, z: 30 }); await sleep(900);
    const arr = A.ast.map(s => s.ml[1]), last = arr[arr.length - 1]; let worst = 0; for (let i = 1; i < arr.length; i++) worst = Math.max(worst, Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1]) / 0.0334);
    ok(Math.abs(last[0] - 90) < 2.5 && Math.abs(last[1] - 30) < 2.5 && worst <= 560 * 1.08, "the second seat's finger moves ITS mallet to the point (within 2.5 cm) and no faster than 560 cm/s", { last, worst: Math.round(worst) });
    ok(Math.abs(A.lastAst().ml[0][0] + 70) < 6, "...and the other mallet stays where it was", A.lastAst().ml[0]);
    B.send({ t: "ainp", x: "abc", z: null }); B.send({ t: "ainp", x: 1e9, z: 0 }); B.send({ t: "ainp", x: NaN, z: 5 }); B.send({ t: "ainp" }); await sleep(250);
    const g1 = A.lastAst().ml[1]; ok(Math.abs(g1[0] - 90) < 4 && Math.abs(g1[1] - 30) < 4, "garbage (a word, null, 1e9, NaN, nothing) moves nothing", g1);
    C.send({ t: "ainp", x: -90, z: 0 }); A.send({ t: "bmove", path: [1, 2] }); await sleep(250);
    ok(Math.abs(A.lastAst().ml[0][0] + 70) < 6 && !B.msgs.some(m => m.t === "bmove"), "a stranger's finger and a board-game move do nothing", [A.lastAst().ml[0], B.msgs.filter(m => m.t === "bmove").length]);
    // a seat that is away pauses the match; it comes back and gets the whole state
    const nBefore = A.lastAst().n; B.ws.close(); await sleep(500); const nA1 = A.lastAst().n; await sleep(500); const nA2 = A.lastAst().n;
    ok(nA2 - nA1 <= 3 && nBefore > 100, "when a seat drops the match waits (the state stops advancing)", [nBefore, nA1, nA2]);
    const B2 = client(acc.Bob, "Bob2"); await B2.open(); B2.send({ t: "bresume", code: r0.code });
    const m2 = await B2.wait(m => m.t === "bmatch"); await sleep(300); const f2 = B2.ast[0];
    ok(m2 && m2.room === mA.room && f2 && f2.full === 1 && f2.room === mA.room && f2.n >= nA2, "the seat comes back (bresume): the match, and the whole state at once", [m2 && m2.room, f2 && f2.full, f2 && f2.n, nA2]);
    await sleep(500); const nA3 = A.lastAst().n; await sleep(500); ok(A.lastAst().n - nA3 >= 24, "...and the match goes on", [nA3, A.lastAst().n]);
    A.send({ t: "bleave" }); const bend0 = await B2.wait(m => m.t === "bend");
    ok(bend0 && bend0.room === mA.room && bend0.winner >= 0, "a player who leaves gives up: the other is told (bend) who won", bend0);
    B2.send({ t: "bleave" }); await sleep(200);

    // ------------------------------------------------------------------ the winner is the server's: a stake match of air hockey played to the first goal
    const w0 = [(await A.bal()).tc, (await B2.bal()).tc];
    ok(w0.join() === "12,12", "both players start with 12 table coins", w0);
    A.clear(); B2.clear(); A.send({ t: "bcreate", game: "hockey", to: 1, stake: 5, cue: "start", tbl: "" }); const rs = await A.wait(m => m.t === "broom" && m.game === "hockey");
    ok(rs && rs.stake === 5 && rs.to === 1, "a stake room: 5 coins each, first goal wins (this test only)", rs);
    B2.send({ t: "bjoin", code: rs.code, cue: "start", tbl: "" }); await B2.wait(m => m.t === "broom" && m.seats.every(Boolean)); A.send({ t: "bstart" });
    const ms = await A.wait(m => m.t === "bmatch"); await B2.wait(m => m.t === "bmatch"); await sleep(300);
    const held = [(await A.bal()), (await B2.bal())];
    ok(held[0].tc === 7 && held[0].hold === 5 && held[1].tc === 7 && held[1].hold === 5, "when the match starts both stakes are held (12 - 5 = 7, 5 held)", held.map(h => [h.tc, h.hold]));
    // the server serves the puck to seat `first`: that seat shoots it into the other's goal, the other keeps out of the way
    const att = ms.first, atk = att === 0 ? A : B2, dfn = att === 0 ? B2 : A, dir = att === 0 ? 1 : -1;
    dfn.send({ t: "ainp", x: dir * 92, z: -42 }); await sleep(1100);   // (the serve lasts 0.8 s)
    atk.send({ t: "ainp", x: -dir * 25, z: 0 }); const endS = await A.wait(m => m.t === "bend", 8000), endS2 = await B2.wait(m => m.t === "bend", 3000);
    ok(endS && endS2 && endS.winner === att && endS.why === "score" && endS.stake === 5 && endS.room === ms.room, "the goal is scored by the server: the match ends (bend: winner = the seat that scored, why 'score', the stake)", endS);
    ok(endS && endS.pay && endS.pay[att] === 4 && endS.pay[1 - att] === -5 && !endS.void, "the winner gets 90% of the pool of 10 = 9 (net +4), the loser loses his 5", endS && endS.pay);
    const w1 = [(await A.bal()), (await B2.bal())], won = att === 0 ? w1[0] : w1[1], lost = att === 0 ? w1[1] : w1[0];
    ok(won.tc === 16 && lost.tc === 7 && won.hold === 0 && lost.hold === 0, "the wallets: the winner 16, the loser 7, nothing held any more", w1.map(h => [h.tc, h.hold]));
    ok(won.log.some(l => l.k === "win" && l.g === "hockey" && l.d === 4) && lost.log.some(l => l.k === "lose" && l.g === "hockey" && l.d === -5), "the history says so (win +4 / lose -5, air hockey)", [won.log.slice(-2), lost.log.slice(-2)]);
    // a rematch: both want it, a new match starts with the serve swapped
    A.clear(); B2.clear(); A.send({ t: "brematch" }); B2.send({ t: "brematch" }); const mr = await A.wait(m => m.t === "bmatch", 4000);
    ok(mr && mr.room !== ms.room && mr.first === 1 - ms.first && mr.stake === 5, "a rematch starts a new match (a new room id) with the serve swapped and the same stake", [mr && mr.room === ms.room, mr && mr.first, ms.first]);
    await sleep(400); const heldR = [(await A.bal()).hold, (await B2.bal()).hold]; ok(heldR.join() === "5,5", "...and holds the stakes again", heldR);
    // a match that is left at once moves no coins (a stake cannot be handed over by resigning)
    B2.send({ t: "bleave" }); const endV = await A.wait(m => m.t === "bend", 4000);
    ok(endV && endV.void === 1 && endV.winner === 1 - (await (async () => 0)()) || (endV && endV.void === 1), "a match left before the 2nd goal moves no coins: void", endV);
    await sleep(300); const w2 = [(await A.bal()).tc, (await B2.bal()).tc, (await A.bal()).hold, (await B2.bal()).hold];
    ok(w2[0] + w2[1] === w1[0].tc + w1[1].tc && w2[2] === 0 && w2[3] === 0, "...both get their stake back: the coins in the two wallets are unchanged, nothing is held", [w2, w1.map(h => h.tc)]);
    A.send({ t: "bleave" }); await sleep(200);

    // ------------------------------------------------------------------ table tennis
    A.clear(); B2.clear(); A.send({ t: "bcreate", game: "tennis", to: 3, cue: "start", tbl: "" }); const rt = await A.wait(m => m.t === "broom" && m.game === "tennis");
    ok(rt && rt.to === 3 && rt.max === 2 && /^[A-Z2-9]{4}$/.test(rt.code), "a table tennis room: a code, two seats, first to 3 points", rt);
    C.send({ t: "jcode", codes: ["x", rt.code] }); const jt = await C.wait(m => m.t === "jcode"); ok(jt && jt.kind === "broom" && jt.game === "tennis", "jcode finds it too (a pasted message works: the first word that is a room wins)", jt);
    B2.send({ t: "bjoin", code: rt.code, cue: "start", tbl: "" }); await B2.wait(m => m.t === "broom" && m.seats.every(Boolean)); A.send({ t: "bstart" });
    const mt = await A.wait(m => m.t === "bmatch"); await B2.wait(m => m.t === "bmatch"); await sleep(1500);
    const ts = A.lastAst(); ok(ts && ts.g === "tennis" && ts.b.length === 6 && ts.p.length === 2 && ts.p[0].length >= 5 && ["serve", "rally", "point"].includes(ts.s) && ts.sc.join() === "0,0", "the table tennis state: the ball [x y z vx vy vz], both racquets [z y tilt nod swing], the score", ts);
    A.ast.length = 0; A.send({ t: "ainp", z: 40, y: 25 }); B2.send({ t: "ainp", z: -30, y: 45 }); await sleep(900);
    const tl = A.lastAst(); ok(Math.abs(tl.p[0][0] - 40) < 2.5 && Math.abs(tl.p[0][1] - 25) < 2.5 && Math.abs(tl.p[1][0] + 30) < 2.5 && Math.abs(tl.p[1][1] - 45) < 2.5, "each finger moves its own racquet (seat 0 the near one, seat 1 the far one)", tl.p);
    // swipes serve and hit: wave both racquets until points are made (a point: the server rules, the event goes with the state)
    let wave = true, pts = 0, evs = [];
    const waver = (c, seat) => (async () => { let i = 0; while (wave) { c.send({ t: "ainp", z: (i++ % 2 ? 1 : -1) * 70, y: 30 }); await sleep(90); } })();
    waver(A, 0); waver(B2, 1); const t0 = Date.now(); let sc = [0, 0];
    while (Date.now() - t0 < 40000) { const l = A.lastAst(); if (l) { sc = l.sc; } if (sc[0] + sc[1] >= 2) break; await sleep(100); }
    for (const s of A.ast) for (const e of s.ev || []) evs.push(e[0]);
    ok(sc[0] + sc[1] >= 2 && evs.includes("point") && evs.includes("paddle") && evs.includes("bounce"), "two racquets that swing make points: the events go with the states (paddle, bounce, point)", { sc, ev: [...new Set(evs)] });
    // a leaver after the 2nd point loses (no stake here: the room just ends)
    wave = false; await sleep(200); A.send({ t: "bleave" }); const bt = await B2.wait(m => m.t === "bend", 3000); ok(bt && bt.winner >= 0, "a player who leaves a table tennis match gives it up", bt); B2.send({ t: "bleave" }); await sleep(200);

    // ------------------------------------------------------------------ a stake match of table tennis, to the first point, then the settlement
    A.clear(); B2.clear(); const wb = [(await A.bal()).tc, (await B2.bal()).tc];
    A.send({ t: "bcreate", game: "tennis", to: 1, stake: 3, cue: "start", tbl: "" }); const rts = await A.wait(m => m.t === "broom" && m.game === "tennis" && m.stake === 3); if (!rts) console.log("no stake tennis room; A got", JSON.stringify(A.msgs.slice(-6)));
    B2.send({ t: "bjoin", code: rts.code, cue: "start", tbl: "" }); await B2.wait(m => m.t === "broom" && m.seats.every(Boolean)); A.send({ t: "bstart" }); await A.wait(m => m.t === "bmatch");
    wave = true; waver(A, 0); waver(B2, 1);
    const endT = await A.wait(m => m.t === "bend", 40000); wave = false; await sleep(200);
    ok(endT && endT.why === "score" && endT.stake === 3 && endT.winner >= 0 && endT.pay && endT.pay[endT.winner] === 2 && endT.pay[1 - endT.winner] === -3, "table tennis for 3 coins each: the server decides, the winner gets 90% of 6 = 5 (net +2), the loser loses 3", endT);
    const wa = [(await A.bal()).tc, (await B2.bal()).tc]; ok(endT && wa[endT.winner] === wb[endT.winner] + 2 && wa[1 - endT.winner] === wb[1 - endT.winner] - 3, "the wallets moved by exactly that", [wb, wa]);
    // an under-funded player cannot join a stake room
    const poor = (await api(null, "/api/register", { name: "Poor", avatar: 1 })).j, P1 = client(poor, "Poor"); await P1.open();
    A.clear(); A.send({ t: "bcreate", game: "hockey", to: 3, stake: 10000 }); const eb = await A.wait(m => m.t === "berr"); ok(eb && eb.why === "coins" && eb.need === 10000, "a stake the host cannot pay is refused (coins, need 10 000)", eb);
    const rich = (await api(null, "/api/register", { name: "Rich", avatar: 2 })).j, R1 = client(rich, "Rich"); await R1.open();
    ok(await pay(rich, "tc_2k", "cs_arc1") === 200 && (await R1.bal()).tc === 2012, "$1 = 2000 coins: a paid pack reaches the wallet (2012 = 12 + 2000)");
    R1.send({ t: "bcreate", game: "hockey", to: 3, stake: 10, cue: "start", tbl: "" }); const rp = await R1.wait(m => m.t === "broom" && m.stake === 10);
    P1.send({ t: "bjoin", code: rp.code }); const ep = await P1.wait(m => m.t === "berr" || m.t === "broom");
    ok(ep && ep.t === "broom", "a player with 12 coins can join a 10-coin stake room (it is not 'coins')", ep);
    R1.send({ t: "bleave" }); P1.send({ t: "bleave" }); await sleep(300); P1.clear();
    R1.send({ t: "bcreate", game: "hockey", to: 3, stake: 25, cue: "start", tbl: "" }); const rp2 = await R1.wait(m => m.t === "broom" && m.stake === 25);
    P1.send({ t: "bjoin", code: rp2.code }); const ep2 = await P1.wait(m => m.t === "berr"); ok(ep2 && ep2.why === "coins" && ep2.need === 25, "a player with 12 coins cannot join a 25-coin room: 'coins', need 25 (the phone then opens the wallet)", ep2);
    ok(await pay(poor, "tc_2k", "cs_arc2") === 200 && (await P1.bal()).tc === 2012, "he buys the $1 pack (+2000 coins) ...");
    P1.clear(); P1.send({ t: "bjoin", code: rp2.code }); const ep3 = await P1.wait(m => m.t === "broom" || m.t === "berr"); ok(ep3 && ep3.t === "broom" && ep3.seats.every(Boolean), "... and now the same room takes him (the reward arrived: the stake is chosen by the host, the coins were all that was missing)", ep3);
    R1.send({ t: "bleave" });
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill(); await sleep(200);
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
