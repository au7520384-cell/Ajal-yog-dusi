#!/usr/bin/env node
// The weekly prizes, end to end on the real server:  node server/test_week_prizes.js   (B8_ROOT=<repo copy>)
// The owner (Nov 16, Telegram screenshots of "Itogi nedeli"): "I took 1st place in Uzbekistan, the prize did not come; do the world top 3 get paid?"
// What is checked: players of the week that just ended are put in the database (the week field = last Monday), the server is started (it closes the old week at start, like Render does after a sleep),
//  - the world top 3 get 💵 1500 / 750 / 400, the top 3 of every country get 💵 400 / 200 / 100 (on top of a world prize), nobody else gets cash; a player with 0 winnings gets nothing
//  - the prizes arrive in the answer of /api/sync, each once; the "last week" page lists them with the right ranks, and says who is in the world top 3 and the country top 3
//  - a player who syncs in the first minute of the new week (the server stayed awake over Monday 00:00 UTC; a fake clock jumps it) does not lose last week's result: the week is closed before his request
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8791, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const weekStart = t => { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
const iso = t => new Date(t).toISOString().slice(0, 10);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wk-"));
  const start = () => spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" });
  let srv;
  // ---- 12 players: 5 in UZ, 4 in TH, 2 in US, 1 in JP (the world order is the order of `won`)
  const PL = [["jp1", "JP", 4300], ["th1", "TH", 4245], ["us1", "US", 3090], ["uz1", "UZ", 1920], ["th2", "TH", 1500], ["uz2", "UZ", 1000], ["uz3", "UZ", 900], ["th3", "TH", 800], ["uz4", "UZ", 700], ["us2", "US", 600], ["uz5", "UZ", 450], ["th4", "TH", 300], ["zero", "UZ", 0]];
  const acct = {};
  // ---- last week's database (the players are written like /api/register writes them; the registration itself is rate-limited to 10 an hour)
  const now = Date.now(), cur = weekStart(now), prev = iso(cur - 7 * 864e5), file = path.join(tmp, "db.json");
  const db = { users: {}, codes: {}, purchases: {}, meta: { state: { week: prev } }, clubs: {}, dms: {}, p2p: {} };
  PL.forEach(([n, cc, won], i) => {
    const nn = String(i).padStart(2, "0"), id = ("u" + nn).padEnd(16, "a"), token = ("t" + nn + "x").padEnd(48, "k"), code = ("C" + nn).padEnd(7, "Z");
    acct[n] = { id, token, code };
    db.users[id] = { id, token, code, name: n, avatar: 3, frame: 0, level: 5, xp: 0, won: 0, wins: 0, games: 0, friends: [], referredBy: null, referrals: [], grants: [], inbox: [], gifted: {}, created: now - 20 * 864e5, lastSeen: now - 6 * 864e5, country: cc, league: 0, week: prev, weekWon: won };
    db.codes[code] = id;
  });
  fs.writeFileSync(file, JSON.stringify(db));
  srv = start(); await sleep(2600);   // (the start closes last week: rollWeek() runs before the first request)
  const stop = async () => { srv.kill("SIGTERM"); await sleep(1200); };
  const sync = async n => (await api(acct[n], "/api/sync", { name: n, country: PL.find(x => x[0] === n)[1] })).j;
  const cash = gs => gs.filter(g => g.cash).map(g => g.kind + ":" + g.cash + ":" + g.from).sort();
  const g = {}; for (const [n] of PL) g[n] = await sync(n);
  const kinds = n => (g[n].grants || []).filter(x => x.cash).map(x => x.kind + ":" + x.cash);
  // world top 3 (cash 1500 / 750 / 400)
  ok(kinds("jp1").includes("weekly:1500") && kinds("th1").includes("weekly:750") && kinds("us1").includes("weekly:400"), "world #1 / #2 / #3 get 💵 1500 / 750 / 400", { jp1: kinds("jp1"), th1: kinds("th1"), us1: kinds("us1") });
  ok(!kinds("uz1").some(k => k.startsWith("weekly")) && !kinds("th2").some(k => k.startsWith("weekly")), "the world #4 and below get no world prize", { uz1: kinds("uz1"), th2: kinds("th2") });
  // country top 3 (cash 400 / 200 / 100), on top of a world prize
  ok(kinds("uz1").includes("country:400") && kinds("uz2").includes("country:200") && kinds("uz3").includes("country:100"), "Uzbekistan #1 / #2 / #3 get 💵 400 / 200 / 100 (the owner's case)", { uz1: kinds("uz1"), uz2: kinds("uz2"), uz3: kinds("uz3") });
  ok(!kinds("uz4").some(k => k.startsWith("country")) && !kinds("uz5").some(k => k.startsWith("country")), "Uzbekistan #4 and #5 get no country prize", { uz4: kinds("uz4"), uz5: kinds("uz5") });
  ok(kinds("jp1").includes("country:400") && kinds("th1").includes("country:400") && kinds("us1").includes("country:400") && kinds("th2").includes("country:200") && kinds("th3").includes("country:100") && !kinds("th4").some(k => k.startsWith("country")), "every country has its own top 3 (Japan, Thailand, USA ...); a world winner also gets the country prize", { th: [kinds("th1"), kinds("th2"), kinds("th3"), kinds("th4")] });
  ok((g.zero.grants || []).filter(x => x.cash).length === 0, "a player with 0 winnings gets nothing", g.zero.grants);
  // the "last week" page
  const lw = (await api(acct.uz5, "/api/leaderboard/lastweek")).j;
  ok(lw.me && lw.me.rank === 11 && lw.me.won === 450, "the 'last week' page: the player's own rank (11 of 12) and his weekly winnings (450 = what he won in online matches that week)", lw.me);
  ok(lw.lastWeek && lw.lastWeek.top.slice(0, 3).map(u => u.name).join() === "jp1,th1,us1" && JSON.stringify(lw.prizes) === "[1500,750,400]" && JSON.stringify(lw.countryPrizes) === "[400,200,100]", "...the world top 3 and the prizes", { top: (lw.lastWeek || {}).top && lw.lastWeek.top.slice(0, 3).map(u => u.name), p: lw.prizes, cp: lw.countryPrizes });
  ok(JSON.stringify(lw.countryTop.map(u => u.name)) === JSON.stringify(["uz1", "uz2", "uz3"]), "...and the country top 3 of the player's country", lw.countryTop);
  // each prize arrives once
  const again = await sync("uz1"); ok(!(again.grants || []).some(x => x.kind === "country"), "a delivered prize is not delivered again", again.grants);
  await stop();
  // ---- the week changes while the server runs (Render keeps it awake; the old 60-second timer left a minute after Monday 00:00 UTC in which a sync / a finished match wiped last week's result)
  // a fake clock (tools/fake_clock.js, test only) jumps from Sunday 23:59:30 to Monday 00:00:10 UTC, the first request of the new week comes from the player who was #1 of his country
  const clock = path.join(tmp, "clock.txt"), T0 = Date.UTC(2026, 10, 8, 23, 59, 30), T1 = Date.UTC(2026, 10, 9, 0, 0, 10), W0 = "2026-11-02";
  const PB = [["ann", "UZ", 1920], ["bob", "UZ", 1000], ["cat", "TH", 500]], acctB = {}, dbB = { users: {}, codes: {}, purchases: {}, meta: { state: { week: W0 } }, clubs: {}, dms: {}, p2p: {} };
  PB.forEach(([n, cc, won], i) => { const id = ("b0" + i).padEnd(16, "c"), token = ("tb" + i + "x").padEnd(48, "m"), code = ("B0" + i).padEnd(7, "Y"); acctB[n] = { id, token, code };
    dbB.users[id] = { id, token, code, name: n, avatar: 3, frame: 0, level: 5, xp: 0, won: 0, wins: 0, games: 0, friends: [], referredBy: null, referrals: [], grants: [], inbox: [], gifted: {}, created: T0 - 20 * 864e5, lastSeen: T0 - 3600e3, country: cc, league: 0, week: W0, weekWon: won }; dbB.codes[code] = id; });
  fs.writeFileSync(file, JSON.stringify(dbB)); fs.writeFileSync(clock, String(T0 - Date.now()));
  srv = spawn("node", ["-r", path.join(ROOT, "tools", "fake_clock.js"), path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, CLOCK_FILE: clock }, stdio: "ignore" }); await sleep(2600);
  const st0 = (await api(acctB.ann, "/api/sync", { name: "ann", country: "UZ" })).j;
  ok(st0.me && st0.me.weekWon === 1920 && !(st0.grants || []).length, "before midnight: the week is still the old one (ann has 1920, nothing paid yet)", { w: st0.me && st0.me.weekWon, g: st0.grants });
  fs.writeFileSync(clock, String(T1 - Date.now()));   // Monday 00:00:10 UTC; the 60-second timer has not fired yet
  const syncB = async n => (await api(acctB[n], "/api/sync", { name: n, country: PB.find(x => x[0] === n)[1] })).j;
  const a1 = await syncB("ann"), b1 = await syncB("bob"), c1 = await syncB("cat");
  const kb = x => (x.grants || []).filter(g => g.cash).map(g => g.kind + ":" + g.cash).sort().join();
  ok(kb(a1) === "country:400,weekly:1500", "the first sync of the new week (ann, the country #1) still gets last week's prizes: world #1 1500 + country #1 400", { ann: kb(a1), lastWeek: a1.lastWeek });
  ok(kb(b1) === "country:200,weekly:750" && kb(c1) === "country:400,weekly:400", "...and the others get theirs (bob: world #2 + country #2, cat: world #3 + country #1 of Thailand)", { bob: kb(b1), cat: kb(c1) });
  ok(a1.lastWeek && a1.lastWeek.won === 1920 && a1.lastWeek.rank === 1 && a1.me.weekWon === 0, "ann's last week is kept (rank 1, 1920) and the new week starts at 0", { lw: a1.lastWeek, w: a1.me && a1.me.weekWon });
  const lwB = (await api(acctB.cat, "/api/leaderboard/lastweek")).j;
  ok(lwB.lastWeek && lwB.lastWeek.week === W0 && lwB.lastWeek.top.length === 3 && lwB.lastWeek.top[0].name === "ann", "the 'last week' page lists all three players", lwB.lastWeek);
  await stop(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { require('child_process').execSync(`pkill -f "PORT=${P}" || true`); } catch (x) {} process.exit(1); });
