#!/usr/bin/env node
// The club chest ("Klub sandig'i"), on the server:  node server/test_club_chest.js
// The wins the members' pages report (once each; the first sync back-dates nothing) fill a shared chest with three steps: max(5, 1 x members), max(15, 3 x members), max(30, 6 x members) wins.
// A member who won this week takes each reached step once (coins only, a server grant); a member adds at most 40 wins a week and at most 20 per sync; it survives a restart.
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8chs-")), P = 8672, base = `http://localhost:${P}`;
  const start = () => spawn("node", [path.join(__dirname, "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" });
  let srv = start(); await sleep(2500);
  const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const user = async (name, wins) => { const u = (await api(null, "/api/register", { name, avatar: 1 })).j; u.name = name; await api(u, "/api/sync", { name, level: 8, wins }); return u; };   // (the first sync only learns the win count)
  const sync = async (u, wins) => (await api(u, "/api/sync", { name: u.name, level: 8, wins })).j;
  try {
    const A = await user("Ann", 10), B = await user("Bob", 0), C = await user("Cat", 3), D = await user("Dan", 0);
    ok((await api(A, "/api/clubs/create", { name: "Chest Club", badge: 0, color: 0 })).s === 200, "Ann makes a club");
    const cid = (await api(A, "/api/clubs/mine")).j.club.id;
    await api(B, "/api/clubs/join", { id: cid }); await api(C, "/api/clubs/join", { id: cid });
    let ch = (await api(A, "/api/clubs/mine")).j.chest;
    ok(ch.members === 3 && ch.wins === 0 && ch.mine === 0 && JSON.stringify(ch.tiers.map(t => t.need)) === "[5,15,30]" && JSON.stringify(ch.tiers.map(t => t.coins)) === "[20000,60000,150000]", "a club of 3: steps at 5 / 15 / 30 wins, 20 000 / 60 000 / 150 000 coins, nothing won yet", ch);
    ok((await sync(D, 0)).chest === null, "a player without a club has no chest in his sync");
    ok((await sync(A, 10)).chest.wins === 0, "the first sync back-dated nothing (Ann reported 10 wins before the week: still 0)");
    // ---- wins arrive with the syncs
    ok((await sync(A, 14)).chest.mine === 4, "Ann reports 14 wins (4 more): her part is 4");
    ok((await sync(B, 2)).chest.mine === 2, "Bob reports 2 wins: his part is 2");
    ch = (await api(A, "/api/clubs/mine")).j; ok(ch.chest.wins === 6 && ch.members.find(m => m.name === "Ann").cwins === 4 && ch.members.find(m => m.name === "Bob").cwins === 2 && ch.members.find(m => m.name === "Cat").cwins === 0, "the club has 6 wins; the member list shows 4 / 2 / 0", [ch.chest.wins, ch.members.map(m => [m.name, m.cwins])]);
    // ---- taking steps
    let r = await api(C, "/api/clubs/chest", { tier: 1 }); ok(r.s === 409 && r.j.error === "no_wins", "Cat has not won this week: she cannot take the step (the club reached it)", r);
    r = await api(A, "/api/clubs/chest", { tier: 2 }); ok(r.s === 409 && r.j.error === "not_yet", "step 2 (15 wins) is not reached yet", r);
    r = await api(A, "/api/clubs/chest", { tier: 1 }); ok(r.s === 200 && r.j.coins === 20000 && r.j.chest.got.join() === "1", "Ann takes step 1: 20 000 coins", r.j);
    r = await api(A, "/api/clubs/chest", { tier: 1 }); ok(r.s === 409 && r.j.error === "taken", "...once", r);
    const sa = await sync(A, 14); ok(sa.grants.some(g => g.kind === "clubchest" && g.coins === 20000 && !g.cash && !g.gems && g.from === "Chest Club"), "the grant reaches Ann's next sync (coins only, from the club's name)", sa.grants);
    r = await api(B, "/api/clubs/chest", { tier: 1 }); ok(r.s === 200, "Bob (2 wins) takes step 1 too", r);
    r = await api(D, "/api/clubs/chest", { tier: 1 }); ok(r.s === 400 && r.j.error === "no_club", "a player without a club cannot take anything", r);
    r = await api(A, "/api/clubs/chest", { tier: 9 }); ok(r.s === 400 && r.j.error === "bad_tier", "a step that does not exist", r);
    // ---- caps: 20 wins per sync, 40 a week
    ok((await sync(A, 114)).chest.mine === 24, "a jump of 100 wins counts 20 (the per-sync cap): Ann 4 + 20 = 24");
    ok((await sync(A, 214)).chest.mine === 40 && (await sync(A, 314)).chest.mine === 40, "...and 40 is the most a member adds in a week");
    r = await api(A, "/api/clubs/chest", { tier: 2 }); ok(r.s === 200 && r.j.coins === 60000, "the club now has 42 wins: Ann takes step 2 (60 000)", r.j);
    r = await api(A, "/api/clubs/chest", { tier: 3 }); ok(r.s === 200 && r.j.coins === 150000, "...and step 3 (150 000)", r.j);
    ok((await sync(A, 5)).chest.mine === 40, "a lower win count (a restored save) takes nothing away");
    // ---- the steps scale with the club's size
    const big = []; for (let i = 0; i < 6; i++) big.push(await user("Big" + i, 0));   // (the server lets one address register 10 accounts a minute: 4 + 6)
    await api(big[0], "/api/clubs/create", { name: "Big Club", badge: 1, color: 0 }); const bid = (await api(big[0], "/api/clubs/mine")).j.club.id;
    for (let i = 1; i < 6; i++) await api(big[i], "/api/clubs/join", { id: bid });
    ch = (await api(big[0], "/api/clubs/mine")).j.chest; ok(ch.members === 6 && JSON.stringify(ch.tiers.map(t => t.need)) === "[6,18,36]", "a club of 6: steps at 6 / 18 / 36 wins (1 / 3 / 6 per member beat the minimums 5 / 15 / 30 from 6 members up)", [ch.members, ch.tiers]);
    // ---- it survives a restart
    await sleep(3200); srv.kill(); await sleep(800); srv = start(); await sleep(2500);
    ch = (await api(A, "/api/clubs/mine")).j.chest; ok(ch.mine === 40 && ch.got.join() === "1,2,3" && ch.wins >= 42, "after a restart Ann's wins and her three taken steps are still there", ch);
    r = await api(A, "/api/clubs/chest", { tier: 1 }); ok(r.s === 409 && r.j.error === "taken", "...and she cannot take step 1 again", r);
    const sb = await sync(B, 2); ok(sb.chest.mine === 2, "Bob's part survived too (a repeated count of 2 wins adds nothing)", sb.chest);
  } catch (e) { fail++; console.log("CRASH", e); }
  srv.kill(); console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
