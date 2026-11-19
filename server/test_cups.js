#!/usr/bin/env node
// Public cups on the real server, with plain WebSocket clients (no browsers):  node server/test_cups.js   (B8_ROOT=<repo copy>; ~1 min)
// The owner (Nov 18): "press a cup and you go in at once = 100% bots. Make it wait 3 minutes while people gather (the World Cup 5), show who joined, PLAY locked until the time ends, then everybody goes in".
//  - a waiting room: everyone who presses the same cup joins ONE session; each one sees the roster and the end time; leaving takes you out (and tells you), pressing twice does not double you
//  - when the time is up the bracket is made of the real players that came + bots for the rest (every place used once, byes spread, the rounds as a knockout of 2^k)
//  - two real players meet in a real online match (a room with `cup` in its `match` message), a real player against a bot reports his match (cupres), two bots are decided by the server
//  - the whole cup plays to a champion; each round's winners are exactly the next round's players
//  - a player who never plays his match against a bot loses it when the time for it is over; a player who leaves forfeits what he has not played
//  - a player alone gets a bracket of himself and bots (the old way, after the wait)
//  - the real waiting times (a second server without the test's short timers): 3 minutes, a 64-player cup 5
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8821, base = `http://localhost:${P}`;
const WebSocket = require(path.join(ROOT, "server", "node_modules", "ws"));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const api = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.json(); };
async function player(name, opt) {
  const a = await api("/api/register", { name, avatar: 3 });
  const c = { name, acct: a, msgs: [], opt: Object.assign({ win: true, play: true, seat0wins: true }, opt || {}), slots: null, cup: null, res: {} };
  c.ws = new WebSocket(`ws://localhost:${P}/ws?id=${a.id}&token=${a.token}`);
  c.send = m => { try { c.ws.send(JSON.stringify(m)); } catch (e) {} };
  c.ws.on("message", d => {
    const m = JSON.parse(d); c.msgs.push(m);
    if (m.t === "cupstate") c.cup = m;
    if (m.t === "cupbracket") { if (m.slots) c.slots = m.slots; c.br = m; autopilot(c, m); }
    if (m.t === "match" && m.cup) { c.matches = (c.matches || []).concat([m]); if (c.opt.play) setTimeout(() => c.send({ t: "result", winner: c.opt.seat0wins ? 0 : 1 }), 150); }   // both report the same winner seat
  });
  await new Promise((res, rej) => { c.ws.on("open", res); c.ws.on("error", rej); });
  return c;
}
function autopilot(c, br) {   // plays the matches against bots (reports a result), once per round
  if (!c.slots || !c.opt.play) return;
  const me = c.slots.findIndex(s => s && s.uid === c.acct.id); if (me < 0) return;
  const m = br.rounds[br.round].find(x => (x[0] === me || x[1] === me) && x[2] === null && x[1] !== null); if (!m) return;
  const opp = m[0] === me ? m[1] : m[0]; if (c.slots[opp]) return;   // a real opponent: the room decides
  const key = br.sid + ":" + br.round; if (c.res[key]) return; c.res[key] = 1;
  setTimeout(() => c.send({ t: "cupres", sid: br.sid, round: br.round, win: !!c.opt.win }), 120);
}
const last = (c, t) => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].t === t) return c.msgs[i]; return null; };
const waitFor = async (c, pred, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(40); } return null; };
async function realWaits() {   // the real waiting times, on a second server WITHOUT the test's short timers: 3 minutes, a 64-player cup 5 (the owner's numbers)
  const P2 = P + 1, tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "b8cup2-")), srv2 = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P2), DATA_DIR: tmp2 }, stdio: "ignore" }), socks = [];
  try {
    await sleep(2500);
    const one = async (name, cup, n) => {
      const r = await (await fetch(`http://localhost:${P2}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, avatar: 3 }) })).json();
      const ws = new WebSocket(`ws://localhost:${P2}/ws?id=${r.id}&token=${r.token}`); socks.push(ws);
      await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
      return new Promise(res => { ws.on("message", d => { const m = JSON.parse(d); if (m.t === "cupstate") res(m); }); ws.send(JSON.stringify({ t: "cupjoin", cup, n, city: "lon", cue: "start", tbl: "" })); setTimeout(() => res(null), 8000); });
    };
    const s32 = await one("W32", "r32", 32), s48 = await one("W48", "r48", 48), s64 = await one("W64", "r64", 64), w = s => s && s.endsAt - s.now;
    ok(s32 && w(s32) > 175000 && w(s32) <= 180500, "the real waiting room of a 32-player cup is 3 minutes", w(s32));
    ok(s48 && w(s48) > 175000 && w(s48) <= 180500, "the real waiting room of a 48-player cup is 3 minutes", w(s48));
    ok(s64 && w(s64) > 295000 && w(s64) <= 300500, "the real waiting room of the 64-player World Cup is 5 minutes", w(s64));
  } finally { for (const x of socks) try { x.close(); } catch (e) {} srv2.kill("SIGTERM"); await sleep(300); try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch (e) {} }
}
const J = { cup: "t1", n: 8, city: "lon", cue: "start", tbl: "" };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8cup-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, CUP_WAIT_MS: "3000", CUP_WAIT_BIG_MS: "4500", CUP_LOCAL_MS: "6000", CUP_AWAY_MS: "3000" }, stdio: "ignore" }); await sleep(2500);
  const all = [];
  try {
    // ---- 1. the waiting room
    const A = await player("Alpha"), B = await player("Beta"), C = await player("Gamma"), D = await player("Delta"); all.push(A, B, C, D);
    const tj = Date.now(); A.send({ t: "cupjoin", ...J }); await waitFor(A, m => m.t === "cupstate");
    B.send({ t: "cupjoin", ...J }); await sleep(300);
    A.send({ t: "cupjoin", ...J }); await sleep(300);   // pressed twice: not twice in the roster
    const sA = last(A, "cupstate");
    ok(sA && sA.state === "gather" && sA.players.length === 2 && sA.n === 8, "two players in the waiting room, the double press did not add a third", sA && sA.players.map(x => x.name));
    ok(sA && sA.endsAt - sA.now > 1500 && sA.endsAt - sA.now <= 3000, "the end time is about the wait from now (" + (sA && sA.endsAt - sA.now) + " ms)");
    C.send({ t: "cupjoin", ...J }); D.send({ t: "cupjoin", ...J }); await sleep(400);
    const rB = last(B, "cupstate"); ok(rB && rB.players.length === 4 && ["Alpha", "Beta", "Gamma", "Delta"].every(n => rB.players.some(x => x.name === n)), "everybody in the room sees all four names", rB && rB.players.map(x => x.name));
    ok(A.cup.endsAt === C.cup.endsAt, "everybody has the same end time");
    D.send({ t: "cupleave" }); const lf = await waitFor(D, m => m.t === "cupleft"); await sleep(300);
    ok(!!lf, "leaving the waiting room is acknowledged"); ok(last(A, "cupstate").players.length === 3 && !last(A, "cupstate").players.some(x => x.name === "Delta"), "the others see him gone");
    ok(!A.msgs.some(m => m.t === "cupbracket"), "no bracket while the room is still waiting");
    // ---- 2. the time is up: the bracket
    const br = await waitFor(A, m => m.t === "cupbracket", 6000); const waited = Date.now() - tj;
    ok(!!br && waited >= 2900, "the bracket comes only when the wait is over (" + waited + " ms)", waited);
    ok(br && br.slots.length === 8 && br.slots.filter(s => s).length === 3 && br.slots.filter(s => !s).length === 5, "3 real players and 5 bots in the 8 places", br && br.slots.map(s => s ? s.name : null));
    const used = br ? br.rounds[0].flatMap(m => m.slice(0, 2)).filter(x => x !== null).sort((a, b) => a - b) : [];
    ok(br && br.rounds[0].length === 4 && used.join() === "0,1,2,3,4,5,6,7", "round 1 is 4 matches that use every place once", used);
    ok([B, C].every(x => x.msgs.some(m => m.t === "cupbracket" && m.slots)), "everybody got the bracket with the roster");
    // ---- 3. play it out: real-vs-real matches are rooms, real-vs-bot matches are reported
    const end = await waitFor(A, m => m.t === "cupend", 40000);
    ok(!!end, "the cup plays to the end");
    if (end) {
      const rounds = end.rounds; ok(rounds.length === 3, "8 places = 3 rounds", rounds.length);
      let chain = true; for (let r = 0; r < rounds.length - 1; r++) { const win = rounds[r].map(m => m[2]), next = rounds[r + 1].flatMap(m => m.slice(0, 2)).filter(x => x !== null); if (win.join() !== next.join() || win.some(w => w === null)) chain = false; }
      ok(chain, "each round's winners are exactly the next round's players", rounds);
      ok(rounds[2].length === 1 && rounds[2][0][2] === end.champion && end.champion !== null, "one champion, the winner of the final", end.champion);
      ok(end.champion !== null && br.slots[end.champion] && ["Alpha", "Beta", "Gamma"].includes(br.slots[end.champion].name), "the champion is a real player (they all win their matches against bots; real pairs were decided by seat)", br.slots[end.champion]);
      const m1 = [A, B, C].flatMap(x => x.matches || []); ok(m1.length >= 2 && m1.every(m => m.cup && m.cup.sid === br.sid && m.opp && m.opp.name), "the real-vs-real matches came as online matches with the cup in them", m1.map(m => m.cup));
    }
    ok([A, B, C].every(x => x.msgs.some(m => m.t === "cupend")), "everybody is told the cup is over");
    // ---- 4. a player who never plays his match against a bot, and one who leaves
    const E = await player("Eve", { play: false }), F = await player("Fay", { play: false }); all.push(E, F);
    const J2 = { ...J, cup: "t2" };
    E.send({ t: "cupjoin", ...J2 }); F.send({ t: "cupjoin", ...J2 }); await waitFor(E, m => m.t === "cupbracket", 6000);
    const be = last(E, "cupbracket"), sl = E.slots; const meE = sl.findIndex(s => s && s.uid === E.acct.id), meF = sl.findIndex(s => s && s.uid === F.acct.id);
    const mE = be.rounds[0].find(m => m[0] === meE || m[1] === meE), rr = (mE[0] === meF || mE[1] === meF);
    if (rr) { ok(true, "(the two real players were drawn against each other: the walk-over checks are skipped this time)"); }
    else {
      F.send({ t: "cupleave", sid: be.sid }); const lfF = await waitFor(F, m => m.t === "cupleft"); ok(!!lfF, "a player who leaves the running cup is acknowledged");
      await sleep(500); const bf = last(E, "cupbracket"); const mF = bf.rounds[0].find(m => m[0] === meF || m[1] === meF);
      ok(mF[2] !== null && mF[2] !== meF, "what he had not played he forfeits at once (his opponent goes through)", mF);
      const t1 = Date.now(); await waitFor(E, m => m.t === "cupbracket" && m.round >= 1, 12000);
      ok(Date.now() - t1 >= 4000, "Eve never played: the computer takes her match only when the time for it is over (" + (Date.now() - t1) + " ms)", Date.now() - t1);
      const b2 = last(E, "cupbracket"); const mE2 = b2.rounds[0].find(m => m[0] === meE || m[1] === meE); ok(mE2[2] !== meE && mE2[2] !== null, "...and the bot goes on in her place", mE2);
    }
    // ---- 5. a player alone: a bracket of himself and bots
    const G = await player("Gus"); all.push(G); G.send({ t: "cupjoin", ...J, cup: "t3" }); await sleep(300);
    const gb = await waitFor(G, m => m.t === "cupbracket", 6000); ok(gb && gb.slots.filter(s => s).length === 1 && gb.slots.filter(s => !s).length === 7, "alone: 1 real player and 7 bots", gb && gb.slots.filter(s => s).length);
    const ge = await waitFor(G, m => m.t === "cupend", 25000); ok(ge && gb.slots[ge.champion] && gb.slots[ge.champion].uid === G.acct.id, "he wins every match against the bots and is the champion", ge && ge.champion);
    // ---- 6. the last one leaving the waiting room cancels it
    const H = await player("Hal"); all.push(H); H.send({ t: "cupjoin", ...J, cup: "t5" }); await waitFor(H, m => m.t === "cupstate"); H.send({ t: "cupleave" }); await waitFor(H, m => m.t === "cupleft");
    await sleep(3800); ok(!H.msgs.some(m => m.t === "cupbracket"), "an empty waiting room starts nothing");
    // ---- 7. a phone that comes back asks where it is
    const I = await player("Ivy"); all.push(I); I.send({ t: "cupjoin", ...J, cup: "t6" }); await waitFor(I, m => m.t === "cupstate");
    I.send({ t: "cupstatus" }); await sleep(300); ok(last(I, "cupstate") && last(I, "cupstate").players.length === 1, "cupstatus gives the room back"); const J3 = await player("Jon"); all.push(J3);
    J3.send({ t: "cupstatus" }); await sleep(300); ok(!!last(J3, "cupnone"), "a player who is in no cup is told so");
    await waitFor(I, m => m.t === "cupend", 30000);
    // ---- 8. the real waiting times (no test timers)
    await realWaits();
  } finally { for (const c of all) try { c.ws.close(); } catch (e) {} srv.kill("SIGTERM"); await sleep(400); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
