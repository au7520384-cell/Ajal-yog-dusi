#!/usr/bin/env node
// Online 2v2 team rooms, on the real server:  node server/test_team.js   (B8_ROOT=<repo copy>; ~15 s)
// The owner (Nov 23): "Online 2v2 ni boshla". The hub seats up to four phones in two sides (seats 0 + 1 = side 0, seats 2 + 3 = side 1), starts the match, relays to the OTHER seats, and keeps the room
// alive while a phone is away. It knows nothing about billiards.
//  - create / join by code (the first free seat, the host's partner first), full / unknown code / already started are refused, a seat can be changed in the waiting room, the host passes on
//  - the host starts with at least two phones connected; every phone gets the same match (room id, seed, first side, the bots' profiles - cleaned - for the empty seats) and the driver (the lowest connected human seat)
//  - tshot / tstate / taim / tchat / tneed reach the three others (not the sender), with the sender's seat and the match id; chat is cleaned; a phone outside the room relays nothing
//  - a phone that drops: its seat is "away", the driver moves on when it was the driver, it comes back with tresume (the match again) and keeps its seat; after the grace the seat is "gone" (a bot plays it)
//  - tend: the room goes back to the waiting room once (a second report is dropped), the seats a bot played are free again, the same people start another match
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8794, base = `http://localhost:${P}`;
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8tm-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, TEAM_GRACE_MS: "700", TEAM_OPEN_GRACE_MS: "1500" }, stdio: "ignore" });
  await sleep(2200);
  try {
    const names = ["Ann", "Bob", "Cat", "Dan", "Eve"], cs = [];
    for (const n of names) { const a = await api("/api/register", { name: n, avatar: 3 }); cs.push(client(a, n)); }
    for (const c of cs) await c.open();
    const [A, B, C, D, E] = cs;

    // ------------------------------------------------------------------ create, join, refuse
    A.send({ t: "tcreate", cue: "start", tbl: "" });
    const r0 = await A.wait(m => m.t === "troom");
    ok(r0 && /^[A-Z2-9]{4}$/.test(r0.code) && r0.host === 0 && r0.state === "open" && r0.seats[0].name === "Ann" && r0.seats[1] === null && r0.seats[0].code === undefined, "a room: a 4-letter code, the host in seat 0, no private fields (invite code) in the seat", r0);
    const code = r0.code;
    B.send({ t: "tjoin", code: code.toLowerCase(), cue: "start" });
    const rb = await B.wait(m => m.t === "troom");
    ok(rb && rb.seats[1] && rb.seats[1].name === "Bob" && rb.seats[0].name === "Ann", "Bob joins (a typed code in lower case works) and sits in seat 1, the host's partner", rb);
    ok((await A.wait(m => m.t === "troom" && m.seats[1]))?.seats[1].name === "Bob", "the host sees him at once");
    C.send({ t: "tjoin", code }); D.send({ t: "tjoin", code });
    await sleep(400);
    const rd = D.last("troom");
    ok(rd && rd.seats.every(Boolean) && rd.seats[2].name === "Cat" && rd.seats[3].name === "Dan", "Cat and Dan take seats 2 and 3 (the other side)", rd && rd.seats.map(s => s && s.name));
    E.send({ t: "tjoin", code }); ok((await E.wait(m => m.t === "terr"))?.why === "full", "a fifth player: the room is full");
    E.clear(); E.send({ t: "tjoin", code: "ZZZZ" }); ok((await E.wait(m => m.t === "terr"))?.why === "none", "an unknown code");

    // ------------------------------------------------------------------ change seat, host passes on
    D.send({ t: "tleave" }); await sleep(250);
    ok(A.last("troom").seats[3] === null, "a player who leaves the waiting room frees his seat");
    C.send({ t: "tmove", seat: 1 }); await sleep(200);
    ok(A.last("troom").seats[2].name === "Cat", "a seat that is taken cannot be moved onto");
    C.send({ t: "tmove", seat: 3 }); await sleep(250);
    const rm = A.last("troom"); ok(rm.seats[2] === null && rm.seats[3].name === "Cat", "a player moves to a free seat", rm.seats.map(s => s && s.name));
    A.send({ t: "tleave" }); await sleep(300);
    const rh = B.last("troom"); ok(rh.host === 1 && rh.seats[0] === null, "the host leaves: the next player is the host", rh);
    A.send({ t: "tjoin", code }); await sleep(300);
    ok(B.last("troom").seats[2].name === "Ann" && B.last("troom").host === 1, "he joins again (the first free seat: 2) and is not the host any more", B.last("troom").seats.map(x => x && x.name));
    A.send({ t: "tmove", seat: 0 }); await sleep(250);
    ok(B.last("troom").seats[0].name === "Ann" && B.last("troom").seats[2] === null && B.last("troom").host === 1, "he moves to seat 0 (the host stays the host)", B.last("troom").seats.map(x => x && x.name));
    // a phone that goes to the background in the waiting room (the share sheet) keeps its seat for a while
    B.drop(); await sleep(300);
    ok(A.last("troom").seats[1].away === 1, "a phone that dropped is shown as away", A.last("troom").seats[1]);
    await B.open(); B.clear(); B.send({ t: "tresume", code }); const rr = await B.wait(m => m.t === "troom" && m.seats[1] && !m.seats[1].away);
    ok(rr && rr.seats[1].name === "Bob" && rr.host === 1, "...and takes its seat (and the host's key) back with tresume", rr);

    // ------------------------------------------------------------------ start
    A.send({ t: "tstart", bots: [] }); await sleep(200); ok(!A.last("tmatch"), "only the host starts");
    for (const c of [A, B, C, D, E]) c.clear();
    const botSeat = { name: "<b>Robot</b>" + "x".repeat(30), avatar: 7, level: 12, cue: "start" };   // (seats now: 0 Ann, 1 Bob, 2 empty, 3 Cat)
    B.send({ t: "tstart", bots: [null, null, botSeat, null] }); await sleep(500);
    const ms = [A, B, C].map(c => c.last("tmatch"));
    ok(ms.every(Boolean) && ms.every(m => m.room === ms[0].room && m.seed === ms[0].seed && m.first === ms[0].first) && ms[0].room.length >= 30 && (ms[0].first === 0 || ms[0].first === 1), "the three phones get the same match (room, seed, first side)", ms);
    ok(ms[0].driver === 0 && ms[0].bots[2] && !/[<>]/.test(ms[0].bots[2].name) && ms[0].bots[2].name.length <= 16 && ms[0].bots[0] === null && ms[0].seats[3] && ms[0].seats[3].name === "Cat", "the driver is the lowest connected human seat; the empty seat's bot is cleaned; Cat keeps seat 3", ms[0]);
    ok(!D.last("tmatch") && !E.last("tmatch"), "people outside the room get nothing");
    const room = ms[0].room;
    E.send({ t: "tjoin", code }); ok((await E.wait(m => m.t === "terr"))?.why === "started", "a match that has started cannot be joined");

    // ------------------------------------------------------------------ relay
    for (const c of [A, B, C, D, E]) c.clear();
    A.send({ t: "tshot", no: 1, power: 0.7, x: 100, y: 200, vx: 5, vy: 1, dir: [1, 0], w: [0, 0, 0], a: 0.2, e: 0 });
    await sleep(300);
    const sh = [B, C].map(c => c.last("tshot"));
    ok(sh.every(m => m && m.from === 0 && m.room === room && m.no === 1 && m.vx === 5) && !A.last("tshot") && !D.last("tshot") && !E.last("tshot"), "a shot reaches the two other seats of the match, with the sender's seat and the match id, not the sender", sh);
    B.send({ t: "tstate", no: 1, turn: 1, balls: [[1, 2, 0]], groups: [null, null], mi: [0, 0] }); C.send({ t: "taim", a: 1, x: 5, y: 6, p: 0.5 });
    await sleep(300);
    ok(A.last("tstate") && A.last("tstate").from === 1 && C.last("tstate") && A.last("taim") && A.last("taim").from === 3, "positions and the aim are relayed too");
    C.send({ t: "tchat", msg: "salom <b>fuck</b>" }); await sleep(250);
    ok(A.last("tchat") && !/[<>]/.test(A.last("tchat").msg) && !/fuck/i.test(A.last("tchat").msg) && A.last("tchat").from === 3, "chat is cleaned", A.last("tchat"));
    D.send({ t: "tshot", no: 2, power: 1 }); E.send({ t: "tstate", no: 2 }); await sleep(250);
    ok(!A.msgs.some(m => m.t === "tshot" && m.no === 2), "a phone outside the room relays nothing");
    A.send({ t: "nonsense", x: 1 }); A.send({ t: "tmove", seat: 3 }); await sleep(100);
    ok(true, "unknown messages are ignored");

    // ------------------------------------------------------------------ a phone drops in the match
    for (const c of [A, B, C]) c.clear();
    A.drop(); const aw = await B.wait(m => m.t === "troom" && m.seats[0] && m.seats[0].away);
    ok(aw && aw.driver === 1, "the driver's phone drops: seat 0 is away and the next phone (seat 1) drives the bots", aw);
    await A.open(); A.clear(); A.send({ t: "tresume", code });
    const back = await A.wait(m => m.t === "tmatch"); const back2 = await A.wait(m => m.t === "troom" && m.seats[0] && !m.seats[0].away);
    ok(back && back.room === room && back.seed === ms[0].seed && back2 && back2.driver === 1, "it comes back with tresume: the same match again, its seat, and the driver stays with seat 1", [back, back2]);
    C.clear(); C.drop(); const gone = await B.wait(m => m.t === "troom" && m.seats[3] && m.seats[3].gone, 3000);
    ok(gone && gone.seats[3].gone === 1, "a phone that stays away longer than the grace is given up: a bot plays its seat", gone && gone.seats);
    await C.open(); C.clear(); C.send({ t: "tresume", code }); ok((await C.wait(m => m.t === "terr"))?.why === "none", "...and it cannot take that seat back");

    // ------------------------------------------------------------------ end: back to the waiting room, once
    for (const c of [A, B]) c.clear();
    A.send({ t: "tend", room, winner: 0 }); B.send({ t: "tend", room, winner: 0 }); await sleep(400);
    ok(B.all("tend").length === 1 && B.last("tend").winner === 0 && B.last("tend").from === 0 && B.last("tend").room === room, "tend is relayed once; the second report of the same match is dropped", B.all("tend"));
    const ro = B.last("troom"); ok(ro && ro.state === "open" && ro.id === "" && ro.seats[3] === null && ro.seats[0].name === "Ann" && ro.seats[1].name === "Bob", "the room is a waiting room again, the seat the bot played is free, the others keep theirs", ro);
    for (const c of [A, B, C, D]) c.clear();
    C.send({ t: "tjoin", code }); D.send({ t: "tjoin", code }); await sleep(400);
    ok(A.last("troom").seats.every(Boolean), "Cat and Dan sit down again and play another match");
    A.send({ t: "tstart", bots: [] }); await sleep(100); ok(!A.last("tmatch"), "...");   // (Ann is not the host: Bob is)
    B.send({ t: "tstart", bots: [] }); await sleep(400);
    ok([A, B, C, D].every(c => c.last("tmatch") && c.last("tmatch").room !== room), "a second match with a new room id and a new seed", A.last("tmatch"));

    // ------------------------------------------------------------------ everybody leaves: the room is gone
    for (const c of [A, B, C, D]) c.send({ t: "tleave" });
    await sleep(500); E.clear(); E.send({ t: "tjoin", code }); ok((await E.wait(m => m.t === "terr"))?.why === "none", "a room nobody is in any more is gone");
    // two phones + two bots: the smallest room
    E.clear(); A.clear(); E.send({ t: "tcreate" }); const re = await E.wait(m => m.t === "troom");
    A.send({ t: "tjoin", code: re.code }); await sleep(300);
    E.clear(); E.send({ t: "tstart", bots: [null, null, { name: "Bot A", avatar: 1, level: 5 }, { name: "Bot B", avatar: 2, level: 6 }] }); await sleep(400);
    const m2 = E.last("tmatch"); ok(m2 && m2.bots[2].name === "Bot A" && m2.bots[3].name === "Bot B" && m2.driver === 0, "two humans against two bots start", m2);
    // a lone host cannot start
    for (const c of [A, E]) c.send({ t: "tleave" }); await sleep(300);
    A.clear(); A.send({ t: "tcreate" }); const ra = await A.wait(m => m.t === "troom"); A.clear(); A.send({ t: "tstart", bots: [] });
    ok((await A.wait(m => m.t === "terr"))?.why === "min" && ra, "one phone alone cannot start (min)");
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); await sleep(500);
  console.log(`pass ${pass}, fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
