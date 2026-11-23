#!/usr/bin/env node
// Board game rooms (shashka now; chess and mafia will use the same room), on the real server:  node server/test_board.js   (B8_ROOT=<repo copy>; ~15 s)
// The owner (Nov 23): shashka, chess, mafia with voice. The hub seats the players (code, 2 seats for a board game), starts a match, keeps the MOVE LIST, lets only the seat whose turn it is move, relays voice signalling,
// keeps a seat for a phone that drops and gives the match to the other one when it does not come back. It does not know the rules (the phones check every move they receive).
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8797, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const api = async (p, body) => (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
function client(acct, name) {
  const c = { name, acct, msgs: [], ws: null };
  c.open = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${P}/ws?id=${acct.id}&token=${acct.token}`); c.ws = ws; ws.onmessage = ev => c.msgs.push(JSON.parse(ev.data)); ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws")); });
  c.send = m => c.ws.send(JSON.stringify(m));
  c.last = t => [...c.msgs].reverse().find(m => m.t === t);
  c.all = t => c.msgs.filter(m => m.t === t);
  c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(25); } return null; };
  c.clear = () => { c.msgs.length = 0; };
  c.drop = () => { try { c.ws.close(); } catch (e) {} };
  return c;
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8bd-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, BROOM_GRACE_MS: "800", BROOM_OPEN_GRACE_MS: "1500" }, stdio: "ignore" });
  await sleep(2200);
  try {
    const cs = []; for (const n of ["Ann", "Bob", "Cat"]) cs.push(client(await api("/api/register", { name: n, avatar: 3 }), n));
    for (const c of cs) await c.open();
    const [A, B, C] = cs;

    // ------------------------------------------------------------------ create / join
    A.send({ t: "bcreate", game: "chess?" }); await sleep(200); ok(!A.last("broom"), "an unknown game is refused");
    A.send({ t: "bcreate", game: "shashka", cue: "start" });
    const r0 = await A.wait(m => m.t === "broom");
    ok(r0 && /^[A-Z2-9]{4}$/.test(r0.code) && r0.game === "shashka" && r0.max === 2 && r0.host === 0 && r0.state === "open" && r0.seats[0].name === "Ann" && r0.seats[1] === null && r0.seats[0].code === undefined, "a room: a 4-letter code, 2 seats, the host in seat 0, no private fields", r0);
    const code = r0.code;
    B.send({ t: "bjoin", code: code.toLowerCase() }); const rb = await B.wait(m => m.t === "broom");
    ok(rb && rb.seats[1] && rb.seats[1].name === "Bob" && rb.seats[0].name === "Ann", "Bob joins with the typed code (any case) and sits in seat 1", rb);
    ok((await A.wait(m => m.t === "broom" && m.seats[1]))?.seats[1].name === "Bob", "the host sees him at once");
    C.send({ t: "bjoin", code }); ok((await C.wait(m => m.t === "berr"))?.why === "full", "a third player: the room is full");
    C.clear(); C.send({ t: "bjoin", code: "ZZZZ" }); ok((await C.wait(m => m.t === "berr"))?.why === "none", "an unknown code");

    // ------------------------------------------------------------------ start, turn order, moves
    B.send({ t: "bstart" }); await sleep(200); ok(!B.last("bmatch"), "only the host starts");
    A.clear(); B.clear(); A.send({ t: "bstart" });
    const ma = await A.wait(m => m.t === "bmatch"), mb = await B.wait(m => m.t === "bmatch");
    ok(ma && mb && ma.room === mb.room && ma.room.length >= 30 && ma.first === mb.first && (ma.first === 0 || ma.first === 1) && ma.game === "shashka" && ma.seats.length === 2, "both phones get the same match: room id, who has White (first)", [ma, mb]);
    const first = ma.first, W = first === 0 ? A : B, Bk = first === 0 ? B : A;
    const room = ma.room; A.clear(); B.clear();
    Bk.send({ t: "bmove", path: [17, 26] }); await sleep(250);
    ok(!W.last("bmove"), "a move out of turn is ignored (Black cannot move first)");
    W.send({ t: "bmove", path: [40, 33] }); await sleep(250);
    const rm = Bk.last("bmove"); ok(rm && rm.path.join() === "40,33" && rm.from === first && rm.n === 1 && rm.room === room && !W.last("bmove"), "White's move reaches Black only (with the sender's seat, the number and the match id)", rm);
    W.send({ t: "bmove", path: [33, 26] }); await sleep(200); ok(Bk.all("bmove").length === 1, "White cannot move twice in a row");
    for (const bad of [[1], [-1, 5], [1.5, 2], [64, 3], "x", null, Array(20).fill(5)]) { Bk.send({ t: "bmove", path: bad }); }
    await sleep(250); ok(Bk.all("bmove").length === 1 && W.all("bmove").length === 0, "malformed moves are ignored");
    Bk.send({ t: "bmove", path: [17, 26, 35] }); await sleep(250); ok(W.last("bmove")?.path.join() === "17,26,35" && W.last("bmove").n === 2, "Black answers with a multi-jump route (a whole route is ONE move)");

    // ------------------------------------------------------------------ voice signalling
    A.clear(); B.clear();
    A.send({ t: "bvoice", k: "hello", d: { m: 0 } }); B.send({ t: "bvoice", k: "offer", to: A.acct.id, d: { type: "offer", sdp: "x" } }); await sleep(250);
    ok(B.last("bvoice")?.k === "hello" && B.last("bvoice").from === A.acct.id && !A.all("bvoice").some(m => m.k === "hello"), "voice: hello reaches the other seat only");
    ok(A.last("bvoice")?.k === "offer" && A.last("bvoice").d.sdp === "x", "voice: an offer addressed to one player reaches him");
    A.clear(); A.send({ t: "bvoice", k: "evil" }); B.clear(); A.send({ t: "bvoice", k: "hello", to: "nobody" }); await sleep(200); ok(!B.last("bvoice"), "voice: an unknown kind and an unknown addressee are dropped");
    C.send({ t: "bvoice", k: "hello" }); await sleep(150); ok(!A.msgs.some(m => m.t === "bvoice" && m.from === C.acct.id), "a phone outside the room cannot signal into it");

    // ------------------------------------------------------------------ a phone drops and comes back: the move list is given back whole
    B.drop(); const aw = await A.wait(m => m.t === "broom" && m.seats[1] && m.seats[1].away);
    ok(aw, "a dropped phone is shown as away");
    await B.open(); B.clear(); B.send({ t: "bresume", code });
    const bm = await B.wait(m => m.t === "bmatch"), bs = await B.wait(m => m.t === "bsync");
    ok(bm && bm.room === room && bs && bs.room === room && JSON.stringify(bs.moves) === JSON.stringify([[40, 33], [17, 26, 35]]), "it comes back with bresume: the match and EVERY move so far", [bm && bm.room, bs]);
    ok((await A.wait(m => m.t === "broom" && m.seats[1] && !m.seats[1].away, 1500)), "the seat is no longer away");
    W.send({ t: "bmove", path: [42, 33] }); await sleep(200); ok(Bk.last("bmove")?.n === 3, "the match goes on after the return (move 3)");

    // ------------------------------------------------------------------ the end, once; a rematch swaps the colours
    A.clear(); B.clear();
    W.send({ t: "bover", room, winner: first, why: "stuck" }); Bk.send({ t: "bover", room, winner: first, why: "stuck" }); await sleep(350);
    ok(A.all("bend").length === 1 && B.all("bend").length === 1 && A.last("bend").winner === first && A.last("bend").room === room, "the end is reported by both phones: ONE bend for each", [A.all("bend"), B.all("bend")]);
    ok(A.last("broom").state === "open" && A.last("broom").id === "", "the room is a waiting room again");
    A.clear(); B.clear(); A.send({ t: "brematch" }); await sleep(250);
    ok(B.last("boffer")?.k === "rematch" && !B.last("bmatch"), "one phone asks for a rematch: the other is told, nothing starts yet");
    B.send({ t: "brematch" }); await sleep(350);
    const n1 = A.last("bmatch"), n2 = B.last("bmatch");
    ok(n1 && n2 && n1.room === n2.room && n1.room !== room && n1.first === 1 - first, "both want it: a new match starts at once and the colours swap", [n1 && n1.first, first]);

    // ------------------------------------------------------------------ a phone that stays away forfeits; leaving forfeits at once
    A.clear(); B.clear(); B.drop();
    const lost = await A.wait(m => m.t === "bend", 4000);
    ok(lost && lost.why === "left" && lost.winner === 0, "a phone that does not come back within the grace loses: the other seat is the winner (reason: left)", lost);
    const r1 = await A.wait(m => m.t === "broom" && m.state === "open" && m.seats[1] === null, 1500);
    ok(r1 && r1.host === 0, "his seat is free again");
    await B.open(); B.clear(); B.send({ t: "bjoin", code }); await B.wait(m => m.t === "broom" && m.seats[1]);
    A.send({ t: "bstart" }); await sleep(300); A.clear(); B.clear();
    const live = A.last("bmatch") || await A.wait(m => m.t === "bmatch");
    B.send({ t: "bleave" }); const lv = await A.wait(m => m.t === "bend", 2000);
    ok(lv && lv.why === "left" && lv.winner === 0, "a player who leaves in the middle of a match loses at once", lv);
    A.send({ t: "bleave" }); await sleep(400); C.clear(); C.send({ t: "bjoin", code }); ok((await C.wait(m => m.t === "berr"))?.why === "none", "a room nobody is in any more is gone");
    // the waiting room keeps a seat for a phone that dropped (the share sheet), and gives it up after the grace
    C.send({ t: "bcreate", game: "shashka" }); const rc = await C.wait(m => m.t === "broom"); A.clear(); A.send({ t: "bjoin", code: rc.code }); await A.wait(m => m.t === "broom" && m.seats[1]);
    A.drop(); await sleep(300); ok(C.last("broom").seats[1].away === 1, "in the waiting room a dropped phone keeps its seat (away)");
    await sleep(2200); ok(C.last("broom").seats[1] === null, "...and loses it after the grace");
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); await sleep(500);
  console.log(`pass ${pass}, fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
