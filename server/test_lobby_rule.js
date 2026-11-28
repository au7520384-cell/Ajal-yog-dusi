#!/usr/bin/env node
// A 9-ball lobby on the real server, with plain WebSocket clients (no browsers):  node server/test_lobby_rule.js   (B8_ROOT=<repo copy>; ~15 s)
// The owner (Nov 28): "9-ball has no lobby: add one - Create gives a code, the friend enters it in one place". The 8-ball lobby (up to 8 players, a knockout, entry fee, prizes) is reused:
// the host says which GAME the lobby is (`rule: "nine"` in his `queue` message) and every message that follows carries it, so each phone builds the right table.
//  - the lobby state, the code box (`jcode`), the list of open lobbies and the world chat cards say "nine" (an 8-ball lobby says nothing: its messages are exactly as before)
//  - the bracket's matches are 9-ball matches: both players' `match` message has rule "nine" (and the same seed / first / room), a spectator's `spec` message too, and a phone that comes back
//    after a reconnect is told the match again with the rule
//  - the whole tournament plays to its end; the next one in the same lobby is still a 9-ball one; a lobby of 8-ball next to it is not touched
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8834, base = `http://localhost:${P}`;
const WebSocket = require(path.join(ROOT, "server", "node_modules", "ws"));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const api = async (p, body, acct) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
async function player(name) {
  const a = await api("/api/register", { name, avatar: 3 });
  const c = { name, acct: a, msgs: [] };
  const open = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`ws://localhost:${P}/ws?id=${a.id}&token=${a.token}`);
    c.ws.on("message", d => c.msgs.push(JSON.parse(d)));
    c.ws.on("open", res); c.ws.on("error", rej);
  });
  c.send = m => { try { c.ws.send(JSON.stringify(m)); } catch (e) {} };
  c.reopen = async () => { try { c.ws.close(); } catch (e) {} await sleep(300); await open(); };
  await open();
  return c;
}
const last = (c, t) => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].t === t) return c.msgs[i]; return null; };
const waitFor = async (c, pred, ms = 8000, from = 0) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.slice(from).find(pred); if (m) return m; await sleep(40); } return null; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8lrule-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const socks = [];
  try {
    const A = await player("Aziz"), B = await player("Bobur"), C = await player("Chori"), D = await player("Dilya"), E = await player("Elbek");
    socks.push(A, B, C, D, E);
    const join = { city: "lon", cue: "start", tbl: "", lobby: true };

    // ---- a 9-ball lobby: the host says the game, the others learn it
    A.send({ t: "queue", ...join, code: "NINE01", rule: "nine", pub: true });
    const sA = await waitFor(A, m => m.t === "lobbystate" && m.code === "NINE01");
    ok(sA && sA.rule === "nine", "the host's lobby state says 'nine'", sA);
    B.send({ t: "queue", ...join, code: "NINE01", join: true });
    const sB = await waitFor(B, m => m.t === "lobbystate" && m.code === "NINE01");
    ok(sB && sB.rule === "nine" && sB.players.length === 2, "a guest who enters the code is told the game ('nine') and sees both players", sB && { rule: sB.rule, n: sB.players && sB.players.length });

    // the 8-ball lobby next to it: nothing changes in its messages
    D.send({ t: "queue", ...join, code: "EIGHT1", pub: true });
    const sD = await waitFor(D, m => m.t === "lobbystate" && m.code === "EIGHT1");
    ok(sD && !("rule" in sD), "an 8-ball lobby's state has no 'rule' (its messages are exactly as before)", sD);
    E.send({ t: "queue", ...join, code: "EIGHT1", join: true });
    await waitFor(E, m => m.t === "lobbystate" && m.code === "EIGHT1");

    // ---- the one code box
    A.send({ t: "jcode", code: "NINE01" });
    const jc = await waitFor(A, m => m.t === "jcode" && m.code === "NINE01");
    ok(jc && jc.kind === "lobby" && jc.rule === "nine", "the code box knows NINE01 is a lobby of 9-ball", jc);
    A.send({ t: "jcode", code: "EIGHT1" });
    const jc8 = await waitFor(A, m => m.t === "jcode" && m.code === "EIGHT1");
    ok(jc8 && jc8.kind === "lobby" && !("rule" in jc8), "...and EIGHT1 is a plain lobby (no rule)", jc8);

    // ---- the list of open lobbies
    const lst = (await api("/api/lobbies", null, A.acct)).lobbies || [], l9 = lst.find(x => x.code === "NINE01"), l8 = lst.find(x => x.code === "EIGHT1");
    ok(l9 && l9.rule === "nine" && l9.n === 2, "the open lobbies list shows the 9-ball lobby with its game and 2 players", l9);
    ok(l8 && !("rule" in l8), "...and the 8-ball one without a rule", l8);

    // ---- the bracket's matches are 9-ball matches
    const i0 = { A: A.msgs.length, B: B.msgs.length };
    A.send({ t: "start" });
    const mA = await waitFor(A, m => m.t === "match", 8000, i0.A), mB = await waitFor(B, m => m.t === "match", 8000, i0.B);
    ok(mA && mB, "the host starts: both phones get their match", { a: !!mA, b: !!mB });
    ok(mA.rule === "nine" && mB.rule === "nine", "both players' match message says rule 'nine'", { a: mA.rule, b: mB.rule });
    ok(mA.room === mB.room && mA.seed === mB.seed && mA.first === mB.first && mA.seat !== mB.seat && mA.tour && mA.tour.rounds === 1, "same room / seed / first turn, different seats, one round (a final)", { a: mA, b: mB });
    const ts = await waitFor(A, m => m.t === "tourstart", 3000, i0.A);
    ok(ts && ts.n === 2 && ts.fee > 0 && ts.pool > 0, "the entry fee and the prize pool are announced as for an 8-ball tournament (the same economy)", ts);

    // ---- a spectator of the live match builds the same table
    C.send({ t: "queue", ...join, code: "NINE01", join: true });
    await waitFor(C, m => m.t === "lobbystate" && m.code === "NINE01");
    C.send({ t: "spectate", room: mA.room });
    const sp = await waitFor(C, m => m.t === "spec");
    ok(sp && sp.rule === "nine" && sp.seed === mA.seed && sp.first === mA.first, "a spectator's 'spec' message has rule 'nine' and the same seed", sp && { rule: sp.rule, seed: sp.seed, want: mA.seed });

    // ---- shots are relayed as for any lobby match (the server knows no game rules: the phones play and report)
    A.send({ t: "state", balls: [[1, 2, 0]], turn: 1, groups: [null, null], bih: false, brk: false, no: 1 });
    const rel = await waitFor(B, m => m.t === "state" && m.room === mA.room);
    ok(rel && rel.from === mA.seat, "a position of one player reaches the other one", rel);

    // ---- a phone that was cut off comes back: the match message again, with the rule
    const k0 = A.msgs.length;
    await A.reopen();
    A.send({ t: "queue", ...join, code: "NINE01", rejoin: true });
    const again = await waitFor(A, m => m.t === "match" && m.room === mA.room, 6000, k0);
    ok(again && again.rule === "nine", "after a reconnect the phone is told its match again, still a 9-ball one", again);

    // ---- the match ends (both report the same winner seat): the tournament is over, the lobby is open again and is STILL a 9-ball lobby
    const e0 = { A: A.msgs.length, B: B.msgs.length };
    C.send({ t: "unspec" }); C.send({ t: "cancel" });   // (the spectator leaves the lobby: a third player would make a 3-player bracket, where somebody has a bye)
    A.send({ t: "result", winner: 0 }); B.send({ t: "result", winner: 0 });
    const done = await waitFor(A, m => m.t === "tourdone", 8000, e0.A), res = await waitFor(A, m => m.t === "tourresult", 3000, e0.A) || await waitFor(B, m => m.t === "tourresult", 3000, e0.B);
    ok(done && res, "the final ends the tournament: the standings and the prizes are announced", { done: !!done, res: !!res });
    const st2 = await waitFor(A, m => m.t === "lobbystate" && m.state === "open" && m.code === "NINE01", 4000, e0.A);
    ok(st2 && st2.rule === "nine", "the lobby is open again and still a 9-ball lobby", st2);
    const f0 = { A: A.msgs.length, B: B.msgs.length };
    A.send({ t: "start" });
    const m2 = await waitFor(B, m => m.t === "match", 6000, f0.B);
    ok(m2 && m2.rule === "nine" && m2.room !== mA.room, "the next tournament of the same lobby is a 9-ball one too (a new room)", m2 && { rule: m2.rule, room: m2.room });
    A.send({ t: "result", winner: 1 }); B.send({ t: "result", winner: 1 });
    await waitFor(A, m => m.t === "tourdone", 6000, f0.A);

    // ---- the 8-ball lobby plays as always
    const g0 = { D: D.msgs.length, E: E.msgs.length };
    D.send({ t: "start" });
    const m8 = await waitFor(E, m => m.t === "match", 6000, g0.E);
    ok(m8 && !("rule" in m8), "an 8-ball lobby's match message has no rule (the phones play 8-ball as before)", m8);
    D.send({ t: "result", winner: 0 }); E.send({ t: "result", winner: 0 });
    await waitFor(D, m => m.t === "tourdone", 6000, g0.D);
    const sD2 = await waitFor(D, m => m.t === "lobbystate" && m.state === "open", 3000, g0.D);
    ok(sD2 && !("rule" in sD2), "...and its lobby is still an 8-ball one after the tournament", sD2);

    // ---- a guest cannot turn the lobby into another game: only the creating message has a say
    C.send({ t: "cancel" }); await sleep(200);
    const c0 = C.msgs.length;
    C.send({ t: "queue", ...join, code: "NINE01", join: true, rule: "eight" });
    const sC = await waitFor(C, m => m.t === "lobbystate" && m.code === "NINE01", 4000, c0);
    ok(sC && sC.rule === "nine", "a guest's 'rule' is ignored: the lobby stays a 9-ball lobby", sC);
    // an unknown rule is the 8-ball lobby (nothing else is accepted)
    E.send({ t: "cancel" }); await sleep(200);
    const x0 = E.msgs.length;
    E.send({ t: "queue", ...join, code: "ODD001", rule: "snooker" });
    const sX = await waitFor(E, m => m.t === "lobbystate" && m.code === "ODD001", 4000, x0);
    ok(sX && !("rule" in sX), "an unknown rule makes an ordinary 8-ball lobby", sX);
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  finally { for (const c of socks) try { c.ws.close(); } catch (e) {} srv.kill("SIGTERM"); await sleep(300); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
