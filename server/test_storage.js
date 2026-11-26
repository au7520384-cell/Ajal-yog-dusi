#!/usr/bin/env node
// How the server saves:  node server/test_storage.js   (~45 s)
// The free Neon database stops its compute after 5 minutes without a query and counts every hour it runs; a phone that syncs every minute changed the player's `lastSeen`,
// so every active player wrote the database every minute, the compute never slept and the quota was gone in ~17 days (Nov 26: "exceeded the quota", no new server could start).
//  (1) the Postgres store (against server/fake_pg.js) writes only what really changed: `lastSeen` moving inside its 30-minute bucket writes NOTHING; a real change writes the row
//      in full with the exact lastSeen; a gone row is deleted; what was read back is not written again.
//  (2) the start-up read is tried again for a moment, but never for "exceeded the quota" (the deploy must fail fast so the old instance keeps serving).
//  (3) the real server: a file store saves 2 s after a change as before; with SAVE_EVERY_MS the changes go in batches (the first at once) and a SIGTERM writes what waits;
//      on the Postgres path a phone that syncs every second does not write the database every second; /api/health says how it is (the default with Postgres is 15 min).
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const fakePg = require("./fake_pg.js");   // installs the stand-in for `pg` in THIS process
process.env.SEEN_WRITE_MS = String(30 * 60e3);
const createStore = require("./storage");

async function saveCapture(s, db) { const l = console.log, lines = []; console.log = (...a) => lines.push(a.join(" ")); try { await s.save(db); } finally { console.log = l; } return lines; }

async function unit() {
  const BUCKET = 30 * 60e3, T0 = Math.floor(Date.now() / BUCKET) * BUCKET + 5 * 60e3;   // 5 minutes into a bucket
  const s = createStore({ databaseUrl: "postgres://fake/db" });
  const db = await s.load();
  ok(s.kind === "postgres" && Object.keys(db.users).length === 0, "an empty database reads as an empty db");
  db.users.a = { id: "a", code: "AAA", name: "Ann", xp: 1, lastSeen: T0 }; db.users.b = { id: "b", code: "BBB", name: "Bob", xp: 1, lastSeen: T0 }; db.users.c = { id: "c", code: "CCC", name: "Cy", xp: 1, lastSeen: T0 };
  db.meta.week = { n: 1 };
  fakePg.reset(); const lines = await saveCapture(s, db);
  ok(fakePg.stats.rows.users === 3 && fakePg.stats.rows.meta === 1, "the first save writes every new row", fakePg.stats);
  ok(lines.length === 1 && /4 row\(s\) written/.test(lines[0]), "one log line per batch (the log shows how often the database is really touched)", lines);
  fakePg.reset(); await s.save(db);
  ok(fakePg.stats.statements.insert === 0, "nothing changed: nothing is written", fakePg.stats);
  for (const u of Object.values(db.users)) u.lastSeen += 60e3;   // every phone synced a minute later
  fakePg.reset(); await s.save(db);
  ok(fakePg.stats.statements.insert === 0, "only lastSeen moved (1 min, same bucket): nothing is written", fakePg.stats);
  for (const u of Object.values(db.users)) u.lastSeen += 10 * 60e3;   // ten more minutes: T0 is 5 min into the bucket, so 16 min in
  fakePg.reset(); await s.save(db);
  ok(fakePg.stats.statements.insert === 0, "lastSeen 11 minutes later, still the same bucket: nothing is written", fakePg.stats);
  db.users.a.xp = 2; db.users.a.lastSeen += 2 * 60e3;
  fakePg.reset(); await s.save(db);
  ok(fakePg.stats.rows.users === 1 && fakePg.stats.statements.insert === 1, "a real change writes that one row (and only it)", fakePg.stats);
  ok(fakePg.tables.users.get("a").xp === 2 && fakePg.tables.users.get("a").lastSeen === db.users.a.lastSeen, "...in full, with the exact lastSeen", fakePg.tables.users.get("a"));
  db.users.b.lastSeen = T0 + BUCKET;   // crossed into the next bucket
  fakePg.reset(); await s.save(db);
  ok(fakePg.stats.rows.users === 1 && fakePg.tables.users.get("b").lastSeen === T0 + BUCKET, "lastSeen that crosses a bucket writes the row (the stored time is never more than a bucket old)", fakePg.stats);
  delete db.users.c;
  fakePg.reset(); await s.save(db);
  ok(fakePg.stats.statements.delete === 1 && !fakePg.tables.users.has("c"), "a row that is gone is deleted", fakePg.stats);
  const s2 = createStore({ databaseUrl: "postgres://fake/db" }), back = await s2.load();
  ok(Object.keys(back.users).sort().join() === "a,b" && back.users.a.xp === 2 && back.codes.AAA === "a" && back.meta.week.n === 1, "a restart reads back what was written (and rebuilds `codes`)", Object.keys(back.users));
  fakePg.reset(); await s2.save(back);
  ok(fakePg.stats.statements.insert === 0 && fakePg.stats.statements.delete === 0, "...and a save right after the read writes nothing", fakePg.stats);
  back.users.a.lastSeen += 3 * 60e3; back.users.a.inbox = [{ t: "x" }];
  fakePg.reset(); await s2.save(back);
  ok(fakePg.stats.rows.users === 1 && fakePg.tables.users.get("a").inbox.length === 1, "after the restart a real change is written as usual", fakePg.stats);
}

async function retries() {
  const { loadWithRetry } = createStore, logs = [], opt = { tries: 5, waitMs: 1, log: m => logs.push(m), sleep: async () => {} };
  let n = 0; const flaky = { load: async () => { if (++n < 3) throw new Error("Connection terminated due to connection timeout"); return { users: {} }; } };
  const got = await loadWithRetry(flaky, opt);
  ok(n === 3 && got && got.users && logs.length === 2 && /try 1 of 5/.test(logs[0]), "a database that wakes up on the 3rd try is read (2 notes in the log)", { n, logs });
  n = 0; let err = null;
  try { await loadWithRetry({ load: async () => { n++; throw new Error("Your account or project has exceeded the quota. Upgrade your plan to increase limits."); } }, opt); } catch (e) { err = e; }
  ok(err && n === 1 && /exceeded the quota/.test(err.message), "\"exceeded the quota\": no second try, the error goes up at once", { n, err: err && err.message });
  n = 0; err = null;
  try { await loadWithRetry({ load: async () => { n++; throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); } }, { ...opt, tries: 4 }); } catch (e) { err = e; }
  ok(err && n === 4, "a database that never answers: it gives up after the tries", { n });
}

async function server() {
  const srvJs = path.join(__dirname, "server.js"), fakeJs = path.join(__dirname, "fake_pg.js");
  const start = async (P, env, pre) => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8st-")); const srv = spawn("node", [...(pre ? ["-r", fakeJs] : []), srvJs], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, FAKE_PG_LOG: path.join(tmp, "pg.log"), ...env }, stdio: "ignore" }); await sleep(2500); return { srv, tmp, base: `http://localhost:${P}` }; };
  const api = async (S, acct, p, body) => { const r = await fetch(S.base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const names = S => { try { return Object.values(JSON.parse(fs.readFileSync(path.join(S.tmp, "db.json"), "utf8")).users).map(u => u.name); } catch (e) { return []; } };
  const pgLines = S => { try { return fs.readFileSync(path.join(S.tmp, "pg.log"), "utf8").split("\n").filter(Boolean); } catch (e) { return []; } };
  const stop = async (S, sig) => { await new Promise(res => { S.srv.once("exit", res); S.srv.kill(sig || "SIGTERM"); setTimeout(res, 4000); }); };

  // file store + batches of 10 minutes
  let S = await start(8681, { SAVE_EVERY_MS: "600000" });
  try {
    await api(S, null, "/api/register", { name: "Ann", avatar: 1 }); await sleep(2600);
    ok(names(S).includes("Ann"), "SAVE_EVERY_MS=600000: the first change is saved at once", names(S));
    await api(S, null, "/api/register", { name: "Bob", avatar: 2 }); await sleep(2600);
    ok(!names(S).includes("Bob"), "...the next one waits for the next batch", names(S));
    const h = (await api(S, null, "/api/health")).j;
    ok(h.ok && h.db && h.db.kind === "file" && h.db.everyMs === 600000 && h.db.pending === true && h.db.lastOk === true && typeof h.db.ageSec === "number", "/api/health says: file store, batch 600000 ms, a change is waiting, the last save was fine", h && h.db);
    await stop(S);
    ok(names(S).includes("Bob"), "a SIGTERM (a deploy, Render's spin-down) writes what waits", names(S));
  } finally { await stop(S, "SIGKILL"); fs.rmSync(S.tmp, { recursive: true, force: true }); }

  // file store, nothing set: as before
  S = await start(8682, {});
  try {
    await api(S, null, "/api/register", { name: "Cy", avatar: 1 }); await sleep(2600);
    ok(names(S).includes("Cy"), "a file store with nothing set: saved within 2 s as before", names(S));
    const h = (await api(S, null, "/api/health")).j; ok(h.db && h.db.everyMs === 0 && h.db.pending === false, "/api/health: everyMs 0 (the old behaviour), nothing waits", h && h.db);
  } finally { await stop(S, "SIGKILL"); fs.rmSync(S.tmp, { recursive: true, force: true }); }

  // Postgres path (fake pg), the default batch
  S = await start(8683, { DATABASE_URL: "postgres://fake/db" }, true);
  try {
    const A = (await api(S, null, "/api/register", { name: "Dee", avatar: 1 })).j; await sleep(2600);
    let ins = pgLines(S).filter(l => /^INSERT users/.test(l)).length;
    ok(ins === 1, "Postgres, default settings: the first change is written at once", pgLines(S));
    await api(S, null, "/api/register", { name: "Eve", avatar: 2 }); await sleep(2600);
    ok(pgLines(S).filter(l => /^INSERT users/.test(l)).length === 1, "...the next one waits (the default batch is 15 minutes)", pgLines(S));
    const h = (await api(S, null, "/api/health")).j;
    ok(h.db && h.db.kind === "postgres" && h.db.everyMs === 900000 && h.db.pending === true, "/api/health: postgres, 900000 ms, a change is waiting", h && h.db);
    ok(A && A.token, "(the account was made)");
  } finally { await stop(S, "SIGKILL"); fs.rmSync(S.tmp, { recursive: true, force: true }); }

  // Postgres path with the OLD 2-second cadence: a phone that syncs every second must not write the database every second
  S = await start(8684, { DATABASE_URL: "postgres://fake/db", SAVE_EVERY_MS: "2000" }, true);
  try {
    const A = (await api(S, null, "/api/register", { name: "Fay", avatar: 1 })).j;
    for (let i = 0; i < 9; i++) { await api(S, A, "/api/sync", { name: "Fay", avatar: 1, level: 3, xp: 10, lang: "en" }); await sleep(1000); }
    const inserts = pgLines(S).filter(l => /^INSERT users/.test(l)).length;
    ok(inserts >= 1 && inserts <= 3, "a phone syncing every second for 9 s (9 requests, lastSeen moving each time) wrote the database at most 3 times, not 9", { inserts, log: pgLines(S) });
    await api(S, A, "/api/sync", { name: "Fay2", avatar: 1, level: 3, xp: 10 }); await sleep(2600);
    ok(pgLines(S).filter(l => /^INSERT users/.test(l)).length > inserts, "...and a real change (a new name) is still written within the cadence", pgLines(S));
  } finally { await stop(S, "SIGKILL"); fs.rmSync(S.tmp, { recursive: true, force: true }); }
}

(async () => {
  try { await unit(); await retries(); await server(); } catch (e) { fail++; console.log("ERROR", e && e.stack || e); }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
