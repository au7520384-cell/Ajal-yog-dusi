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
  const saved = {users: new Map(), purchases: new Map()};   // id -> JSON last written
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
      await pool.query(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS purchases (id text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())`);
      const db = {users: {}, codes: {}, purchases: {}};
      for (const r of (await pool.query("SELECT id, data FROM users")).rows) {
        db.users[r.id] = r.data; saved.users.set(r.id, JSON.stringify(r.data));
        if (r.data.code) db.codes[r.data.code] = r.id;
      }
      for (const r of (await pool.query("SELECT id, data FROM purchases")).rows) {
        db.purchases[r.id] = r.data; saved.purchases.set(r.id, JSON.stringify(r.data));
      }
      return db;
    },
    async save(db) {
      for (const table of ["users", "purchases"]) {
        const changed = [];
        for (const [id, obj] of Object.entries(db[table])) {
          const s = JSON.stringify(obj);
          if (saved[table].get(id) !== s) changed.push([id, s]);
        }
        if (!changed.length) continue;
        await upsert(table, changed);
        for (const [id, s] of changed) saved[table].set(id, s);
      }
    },
    async close() { await pool.end(); },
  };
}

module.exports = function createStore({databaseUrl, dataDir}) {
  return databaseUrl ? pgStore(databaseUrl) : fileStore(dataDir);
};
