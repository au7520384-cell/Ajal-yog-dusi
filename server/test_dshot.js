#!/usr/bin/env node
// The daily shot ("Kunlik zarba"), on the server:  node server/test_dshot.js
// The same lucky-shot layout for everybody each Tashkent day (a seed), 3 attempts a day per player, ranked by the distance of the gold ball from the target (smaller = better, 9999 = missed), the board survives a restart.
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8dsh-")), P = 8671, base = `http://localhost:${P}`;
  const start = () => spawn("node", [path.join(__dirname, "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" });
  let srv = start(); await sleep(2500);
  const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const A = (await api(null, "/api/register", { name: "Ann", avatar: 1 })).j, B = (await api(null, "/api/register", { name: "Bob", avatar: 2 })).j, C = (await api(null, "/api/register", { name: "Cat", avatar: 3 })).j;
    // ---- today's shot: the same for everybody
    const da = (await api(A, "/api/dshot/day", {})).j, db_ = (await api(B, "/api/dshot/day", {})).j;
    ok(/^\d{4}-\d{2}-\d{2}$/.test(da.day) && da.tries === 3 && Number.isInteger(da.seed) && da.seed >= 1 && da.seed <= 999983, "the day: a date, 3 tries, a seed the page's generator can take", da);
    ok(da.day === db_.day && da.seed === db_.seed && da.mine === null && da.rank === null && da.total === 0, "everybody gets the same day and seed; nothing played yet", [da, db_]);
    ok((await api(null, "/api/dshot/day", {})).s === 401, "no sign-in: no shot");
    // ---- attempts
    let r = (await api(A, "/api/dshot/submit", { day: da.day, d: 40, hit: true })); ok(r.s === 200 && r.j.n === 1 && r.j.d === 40 && r.j.rank === 1 && r.j.total === 1 && r.j.tries === 3, "Ann's 1st attempt: 40 px, rank 1 of 1", r.j);
    r = await api(A, "/api/dshot/submit", { day: da.day, d: 90, hit: true }); ok(r.j.n === 2 && r.j.d === 40, "a worse 2nd attempt does not replace the best (still 40)", r.j);
    r = await api(A, "/api/dshot/submit", { day: da.day, d: 12.6, hit: true }); ok(r.j.n === 3 && r.j.d === 13 && r.j.rank === 1, "a better 3rd attempt is the new best (13, rounded)", r.j);
    r = await api(A, "/api/dshot/submit", { day: da.day, d: 1, hit: true }); ok(r.s === 409 && r.j.error === "no_tries", "a 4th attempt the same day is refused", r);
    const day2 = (await api(A, "/api/dshot/day", {})).j; ok(day2.mine && day2.mine.n === 3 && day2.mine.d === 13 && day2.rank === 1, "the day call tells Ann what she has done: 3 attempts, best 13", day2);
    // ---- a miss, a bad number, a wrong day
    r = await api(B, "/api/dshot/submit", { day: da.day, d: 5, hit: false }); ok(r.j.d === 9999 && r.j.n === 1, "the gold ball not touched = a miss (9999), whatever distance the page sends", r.j);
    r = await api(B, "/api/dshot/submit", { day: da.day, d: -4, hit: true }); ok(r.j.d === 9999 && r.j.n === 2, "a negative distance is a miss", r.j);
    r = await api(B, "/api/dshot/submit", { day: "2001-01-01", d: 3, hit: true }); ok(r.s === 409 && r.j.error === "old_day" && r.j.day === da.day, "another day's attempt is refused (and the server names today)", r);
    r = await api(B, "/api/dshot/submit", { day: da.day, d: 99999, hit: true }); ok(r.j.d === 9999, "an absurd distance is capped (a miss)", r.j);
    // ---- the board
    r = await api(C, "/api/dshot/submit", { day: da.day, d: 27, hit: true }); ok(r.j.rank === 2 && r.j.total === 3, "Cat (27) is 2nd of 3, behind Ann (13), ahead of Bob (a miss)", r.j);
    const top = (await api(C, "/api/dshot/top", {})).j;
    ok(top.day === da.day && top.total === 3 && top.top.map(x => x.name).join() === "Ann,Cat,Bob" && top.top.map(x => x.d).join() === "13,27,9999", "the board: Ann 13, Cat 27, Bob miss - best first", top.top && top.top.map(x => [x.name, x.d]));
    ok(top.me && top.me.rank === 2 && top.me.d === 27 && top.me.n === 1, "'me' is Cat: rank 2, 27 px, 1 attempt", top.me);
    ok(top.top[0].avatar === 1 && "country" in top.top[0] && !("token" in top.top[0]), "rows carry the public profile (avatar, country ...) and no secrets", top.top[0]);
    const topB = (await api(null, "/api/register", { name: "Dan", avatar: 4 })).j; const dd = (await api(topB, "/api/dshot/top", {})).j; ok(dd.me === null && dd.total === 3, "a player who has not played has no place", dd.me);
    // ---- a tie goes to the earlier shot
    const D = (await api(null, "/api/register", { name: "Eve", avatar: 5 })).j; r = await api(D, "/api/dshot/submit", { day: da.day, d: 13, hit: true }); ok(r.j.rank === 2, "the same distance as Ann (13): Eve is behind her (she was first)", r.j);
    // ---- it survives a restart
    await sleep(3200); srv.kill(); await sleep(800); srv = start(); await sleep(2500);
    const after = (await api(A, "/api/dshot/day", {})).j; ok(after.day === da.day && after.mine && after.mine.n === 3 && after.mine.d === 13 && after.total === 4, "after a restart the attempts and the board are still there", after);
    r = await api(A, "/api/dshot/submit", { day: da.day, d: 2, hit: true }); ok(r.s === 409, "...and Ann still cannot play a 4th time", r);
  } catch (e) { fail++; console.log("CRASH", e); }
  srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
