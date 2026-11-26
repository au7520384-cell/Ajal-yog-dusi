"use strict";
/*
 * Storage for the in-memory `db` object ({users, codes, purchases}).
 *  - DATABASE_URL set  → Postgres (e.g. a free Neon database). Each user / purchase is one JSONB row,
 *                        and only rows that changed since the last save are written.
 *  - otherwise         → a JSON file in DATA_DIR (local development / a server with a persistent disk).
 * The game keeps everything in memory and saves every 2 seconds, so requests stay fast.
 */
const fs = require("fs");
const path = require("path");

function fileStore(dir) {
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, "db.json");
  let last = "";
  return {
    kind: "file",
    async load() {
      try { const db = JSON.parse(fs.readFileSync(file, "utf8")); last = JSON.stringify(db); return db; } catch (e) { return null; }
    },
    async save(db) {
      const s = JSON.stringify(db);
      if (s === last) return;
      fs.writeFileSync(file + ".tmp", s);
      fs.renameSync(file + ".tmp", file);
      last = s;
    },
    async close() {},
  };
}

function pgStore(url) {
  const {Pool} = require("pg");
  const pool = new Pool({connectionString: url, max: 4, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000});
  pool.on("error", e => console.error("postgres pool:", e.message));
  const TABLES = ["users", "purchases", "meta", "clubs", "dms", "p2p", "replays"];     // meta: small shared state (current week, last week's results); dms: direct messages between friends (one row per pair); replays: shots a player shared (a few KB each, 30 days)
  const saved = {users: new Map(), purchases: new Map(), meta: new Map(), clubs: new Map(), dms: new Map(), p2p: new Map(), replays: new Map()};   // id -> signature of the row as last written (see sig)
  // The free Neon plan counts the hours its compute runs (100 CU-hours a month) and the compute sleeps only after 5 minutes WITHOUT a query. `lastSeen` of an online
  // player moves at every request (a phone syncs every minute), so comparing the rows as they are wrote every active player every minute, kept the compute awake day
  // and night and used the whole quota in ~17 days (Nov 26: "Your account or project has exceeded the quota", every new server failed to start). So rows are compared with
  // `lastSeen` rounded down to SEEN_WRITE_MS (30 min): in memory it moves exactly as before (online status, pushes); alone it writes a row only when it crosses
  // a bucket, and any other change writes the row in full with the exact value.
  const SEEN_WRITE_MS = Math.max(1, +process.env.SEEN_WRITE_MS || 30 * 60e3);
  const sig = o => JSON.stringify(o, (k, v) => k === "lastSeen" && typeof v === "number" ? Math.floor(v / SEEN_WRITE_MS) : v);
  async function upsert(table, rows) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200), params = [], values = [];
      chunk.forEach(([id, json], k) => { params.push(id, json); values.push(`($${2 * k + 1}, $${2 * k + 2}::jsonb)`); });
      await pool.query(`INSERT INTO ${table} (id, data) VALUES ${values.join(",")} ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()`, params);
    }
  }
  return {
    kind: "postgres",
    async load() {
      const db = {users: {}, codes: {}, purchases: {}, meta: {}, clubs: {}, dms: {}, p2p: {}, replays: {}};
      for (const t of TABLES) {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (id text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())`);
        for (const r of (await pool.query(`SELECT id, data FROM ${t}`)).rows) { db[t][r.id] = r.data; saved[t].set(r.id, sig(r.data)); }
      }
      for (const [id, u] of Object.entries(db.users)) if (u.code) db.codes[u.code] = id;
      return db;
    },
    async save(db) {
      let wrote = 0, deleted = 0; const t0 = Date.now();
      for (const table of TABLES) {
        const changed = [];
        for (const [id, obj] of Object.entries(db[table] || {})) {
          const s = sig(obj);
          if (saved[table].get(id) !== s) changed.push([id, JSON.stringify(obj), s]);   // the row is written in full, with the exact lastSeen
        }
        const gone = [...saved[table].keys()].filter(id => !(db[table] || {})[id]);
        if (gone.length) { await pool.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [gone]); gone.forEach(id => saved[table].delete(id)); deleted += gone.length; }
        if (!changed.length) continue;
        await upsert(table, changed.map(([id, json]) => [id, json]));
        for (const [id, , s] of changed) saved[table].set(id, s);
        wrote += changed.length;
      }
      if (wrote || deleted) console.log(`db: ${wrote} row(s) written, ${deleted} deleted (${Date.now() - t0} ms)`);   // one line per batch: the log shows how often the database is really touched
    },
    async close() { await pool.end(); },
  };
}

// The read at start-up can fail for a moment (Neon waking a suspended or archived branch takes a few seconds and one try waits only 15 s): try a few times.
// "exceeded the quota" never gets better by waiting: fail at once, so the deploy fails fast and the OLD instance, which holds the latest data, keeps serving.
async function loadWithRetry(store, {tries = 5, waitMs = 8000, log = console.error, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  for (let i = 1; ; i++) {
    try { return await store.load(); }
    catch (e) {
      const msg = String((e && e.message) || e);
      if (/exceeded the .{0,20}quota|upgrade your plan/i.test(msg) || i >= tries) throw e;
      log(`database not ready (try ${i} of ${tries}): ${msg}`);
      await sleep(waitMs);
    }
  }
}

module.exports = function createStore({databaseUrl, dataDir}) {
  return databaseUrl ? pgStore(databaseUrl) : fileStore(dataDir);
};
module.exports.loadWithRetry = loadWithRetry;
