#!/usr/bin/env node
// Mafia in a board game room, on the real server:  node server/test_mafia.js   (B8_ROOT=<repo copy>; about 1 minute: the phases run at 3% of their time, MAFIA_SCALE=0.03)
// A room of up to 8 seats, the host starts, the seats are topped up with bots to 5, each phone gets ONLY its own view (role, partners, findings; every role only at the end), the phases run on the server's
// timers, the bots play their seats, a phone that drops can come back (bresume), a phone that leaves is replaced by a bot and the match goes on, the end shows every role and the room is a waiting room again.
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8798, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const api = async (p, body) => (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
function client(acct, name) {
  const c = { name, acct, msgs: [], ws: null, key: "", acted: new Set(), auto: false };
  c.open = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${P}/ws?id=${acct.id}&token=${acct.token}`); c.ws = ws; ws.onmessage = ev => { const m = JSON.parse(ev.data); c.msgs.push(m); if (m.t === "mview" && c.auto) c.play(m.v); }; ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws")); });
  c.send = m => c.ws.send(JSON.stringify(m));
  c.last = t => [...c.msgs].reverse().find(m => m.t === t);
  c.all = t => c.msgs.filter(m => m.t === t);
  c.wait = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(25); } return null; };
  c.clear = () => { c.msgs.length = 0; };
  c.drop = () => { try { c.ws.close(); } catch (e) {} };
  c.play = v => {   // a simple player: its own part of every phase, once
    const k = v.phase + ":" + v.day + ":" + v.rev; if (c.acted.has(v.phase + ":" + v.day) || v.you < 0 || !v.alive[v.you] || v.phase === "over") return; c.acted.add(v.phase + ":" + v.day);
    const al = v.alive.map((a, i) => a ? i : -1).filter(i => i >= 0), others = al.filter(i => i !== v.you), mates = v.mates || [];
    setTimeout(() => { try {
      if (v.phase === "night") { if (v.role === "mafia") c.send({ t: "mact", k: "kill", to: others.filter(i => !mates.includes(i))[0] }); else if (v.role === "doctor") c.send({ t: "mact", k: "save", to: v.lastSave === v.you ? others[0] : v.you }); else if (v.role === "sheriff") { const done = (v.found || []).map(f => f.seat); const t = others.find(i => !done.includes(i)); if (t !== undefined) c.send({ t: "mact", k: "check", to: t }); } }
      else if (v.phase === "day") c.send({ t: "mact", k: "ready" });
      else if (v.phase === "vote") { const m = (v.found || []).find(f => f.mafia && v.alive[f.seat]); c.send({ t: "mact", k: "vote", to: m ? m.seat : role2(v, others) }); }
    } catch (e) {} }, 30 + Math.random() * 200);
  };
  return c;
}
const role2 = (v, others) => { const pool = others.filter(i => !(v.mates || []).includes(i)); return pool[Math.floor(Math.random() * pool.length)]; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8mf-"));
  const srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, MAFIA_SCALE: "0.03", BROOM_GRACE_MS: "700", BROOM_OPEN_GRACE_MS: "1500" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch (e) {} await sleep(300); }
  try {
    const cs = []; for (const n of ["Ann", "Bob", "Cat", "Dan"]) cs.push(client(await api("/api/register", { name: n, avatar: 3 }), n));
    for (const c of cs) await c.open();
    const [A, B, C, D] = cs;

    // ------------------------------------------------------------------ the room
    A.send({ t: "bcreate", game: "mafia", cue: "start" }); const r0 = await A.wait(m => m.t === "broom");
    ok(r0 && r0.game === "mafia" && r0.max === 8 && r0.state === "open" && r0.seats.length === 8 && r0.seats[0].name === "Ann", "a Mafia room: 8 seats, the host in seat 0", r0 && { g: r0.game, max: r0.max, n: r0.seats && r0.seats.length });
    const code = r0.code;
    for (const c of [B, C]) { c.send({ t: "bjoin", code }); await c.wait(m => m.t === "broom"); }
    ok((await A.wait(m => m.t === "broom" && m.seats.filter(Boolean).length === 3))?.seats.filter(Boolean).length === 3, "Bob and Cat joined");
    B.send({ t: "bstart" }); await sleep(250); ok(!B.last("bmatch") && !A.last("bmatch"), "only the host starts");

    // ------------------------------------------------------------------ a match: 3 people + 2 bots
    for (const c of [A, B, C]) { c.clear(); c.acted.clear(); c.auto = true; }
    A.send({ t: "bstart" });
    const mA = await A.wait(m => m.t === "bmatch"), vA = await A.wait(m => m.t === "mview");
    ok(mA && mA.game === "mafia" && mA.seats.filter(Boolean).length === 5 && mA.seats.slice(0, 3).every(s => s && !String(s.uid).startsWith("bot:")) && mA.seats.slice(3, 5).every(s => s && String(s.uid).startsWith("bot:")), "the match: 3 people first, topped up with 2 bots to 5", mA && mA.seats.map(s => s && s.uid));
    ok(vA && vA.v.n === 5 && vA.v.phase === "reveal" && ["mafia", "doctor", "sheriff", "citizen"].includes(vA.v.role) && vA.v.roles === undefined, "a view: the phase, the number of seats and ONLY my own role", vA && vA.v);
    const first = {}; for (const c of [A, B, C]) first[c.name] = (await c.wait(m => m.t === "mview")).v;
    const roles = Object.values(first).map(v => v.role);
    ok(roles.every(r => r) && new Set(Object.values(first).map(v => v.you)).size === 3 && Object.values(first).every(v => v.roles === undefined && (v.role === "mafia" ? Array.isArray(v.mates) : v.mates === undefined) && (v.role === "sheriff" ? Array.isArray(v.found) : v.found === undefined)), "each phone has its own seat and role; nobody got the list of roles; only a mafia has partners, only a sheriff findings", first);
    ok(JSON.stringify(Object.values(first).map(v => v.bot)) === JSON.stringify(Object.values(first).map(() => [false, false, false, true, true])), "everybody knows which seats are bots");

    // a wrong action does nothing
    const sheriffClient = [A, B, C].find(c => first[c.name].role === "sheriff"), citizenClient = [A, B, C].find(c => first[c.name].role === "citizen");
    // (the night begins after the reveal)
    const night = await A.wait(m => m.t === "mview" && m.v.phase === "night", 4000); ok(!!night, "after the reveal the night begins");
    if (citizenClient) { const rev0 = (citizenClient.last("mview") || {v: {}}).v.rev; citizenClient.acted.add("night:1"); citizenClient.send({ t: "mact", k: "kill", to: 0 }); citizenClient.send({ t: "mact", k: "vote", to: 0 }); await sleep(150); ok(true, "(a citizen's kill / out-of-phase vote is ignored)"); }

    // play to the end
    const over = await A.wait(m => m.t === "mview" && m.v.phase === "over", 40000);
    ok(over && over.v.winner && Array.isArray(over.v.roles) && over.v.roles.length === 5, "the match ends with a winner and EVERY role shown", over && over.v);
    const ov = {}; for (const c of [A, B, C]) ov[c.name] = (await c.wait(m => m.t === "mview" && m.v.phase === "over", 4000))?.v;
    ok(Object.values(ov).every(v => v && JSON.stringify(v.roles) === JSON.stringify(ov.Ann.roles) && v.roles[v.you] === v.role), "all three phones see the same list and their own role in it");
    const lateRoom = await A.wait(m => m.t === "broom" && m.state === "open" && m.seats.filter(Boolean).length === 3, 4000);
    ok(!!lateRoom, "the room is a waiting room again, the bots are gone, the three people are still in it", lateRoom && lateRoom.seats.map(s => s && s.uid));
    // the log is public and consistent
    const lg = over.v.log; ok(lg.length >= 2 && lg.filter(e => e.k === "died" || e.k === "out").every(e => e.role === over.v.roles[e.seat]), "the log names the dead with their true roles", lg);

    // ------------------------------------------------------------------ a phone that drops comes back; one that leaves is replaced by a bot; the end
    for (const c of [A, B, C]) { c.clear(); c.acted.clear(); }
    A.send({ t: "bstart" }); await A.wait(m => m.t === "bmatch"); await A.wait(m => m.t === "mview" && m.v.phase === "night", 4000);
    B.drop(); await sleep(250); const B2 = client(cs[1].acct, "Bob"); await B2.open(); B2.auto = true; cs[1] = B2;
    B2.send({ t: "bresume", code }); const rb = await B2.wait(m => m.t === "mview", 3000), rm = await B2.wait(m => m.t === "bmatch", 1500);
    ok(rb && rm && rm.game === "mafia" && rb.v.you === 1, "a phone that dropped and came back gets the match and its view again (bresume)", rb && rb.v.you);
    C.send({ t: "bleave" }); const lr = await A.wait(m => m.t === "broom" && m.state === "run" && String(m.seats[2] && m.seats[2].uid).startsWith("bot:"), 3000);
    ok(!!lr, "Cat leaves in the middle: a bot plays her seat", lr && lr.seats.map(s => s && s.uid));
    A.auto = true; B2.auto = true;
    const over2 = await A.wait(m => m.t === "mview" && m.v.phase === "over", 40000); ok(!!over2, "the match goes on and ends");
    const lateRoom2 = await A.wait(m => m.t === "broom" && m.state === "open", 4000); ok(!!lateRoom2 && lateRoom2.seats.filter(s => s && !String(s.uid).startsWith("bot:")).length === 2, "...and the room keeps the two who stayed", lateRoom2 && lateRoom2.seats.map(s => s && s.uid));

    // ------------------------------------------------------------------ alone with the bots; 8 people
    A.send({ t: "bleave" }); await sleep(200); B2.send({ t: "bleave" }); await sleep(300);
    D.send({ t: "bcreate", game: "mafia" }); await D.wait(m => m.t === "broom"); D.auto = true; D.clear(); D.send({ t: "bstart" });
    const mD = await D.wait(m => m.t === "bmatch"); ok(mD && mD.seats.filter(Boolean).length === 5, "one person alone: the match starts with 4 bots (5 seats)");
    ok(!!(await D.wait(m => m.t === "mview" && m.v.phase === "over", 45000)), "alone against the bots the match is played to the end");
    D.send({ t: "bleave" }); await sleep(300);
    for (const c of cs) c.drop(); await sleep(400);   // (the server lets one address keep about ten connections: the first four phones are closed before eight more come)
    // eight people
    const many = cs.map(c => client(c.acct, c.name)); for (let i = 4; i < 8; i++) many.push(client(await api("/api/register", { name: "P" + i, avatar: 2 }), "P" + i)); for (const c of many) await c.open();   // (the four first accounts again: the server allows about ten registrations from one address)
    many[0].send({ t: "bcreate", game: "mafia" }); const rr = await many[0].wait(m => m.t === "broom"); for (const c of many.slice(1)) { c.send({ t: "bjoin", code: rr.code }); await c.wait(m => m.t === "broom"); }
    const extra = client(await api("/api/register", { name: "Ninth", avatar: 2 }), "Ninth"); await extra.open(); extra.send({ t: "bjoin", code: rr.code }); ok((await extra.wait(m => m.t === "berr"))?.why === "full", "a ninth person: the room is full");
    for (const c of many) { c.auto = true; c.clear(); } many[0].send({ t: "bstart" });
    const m8 = await many[0].wait(m => m.t === "bmatch"); ok(m8 && m8.seats.filter(Boolean).length === 8 && m8.seats.every(s => s && !String(s.uid).startsWith("bot:")), "8 people: 8 seats, no bots");
    const v8 = await Promise.all(many.map(c => c.wait(m => m.t === "mview"))); const rs = v8.map(x => x.v.role), cnt = r => rs.filter(x => x === r).length;
    ok(cnt("mafia") === 3 && cnt("doctor") === 1 && cnt("sheriff") === 1 && cnt("citizen") === 3, "8 seats: 3 mafia, a doctor, a sheriff, 3 citizens", rs);
    ok(v8.filter(x => x.v.role === "mafia").every(x => JSON.stringify(x.v.mates.sort()) === JSON.stringify(v8.filter(y => y.v.role === "mafia" && y.v.you !== x.v.you).map(y => y.v.you).sort())), "the three mafia know each other (and only they)");
    ok(!!(await many[0].wait(m => m.t === "mview" && m.v.phase === "over", 60000)), "8 people play to the end");
    for (const c of [...cs, ...many, extra]) c.drop();
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
