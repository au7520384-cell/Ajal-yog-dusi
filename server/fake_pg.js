"use strict";
// A tiny in-memory stand-in for the `pg` module. TESTS ONLY (server/test_storage.js); nothing in the server requires this file.
//  - require("./fake_pg.js") in a test, or  node -r ./fake_pg.js server.js  with DATABASE_URL=postgres://fake/db: the real Postgres code path of storage.js runs without a database.
//  - Every statement is also appended to the file named by FAKE_PG_LOG (one line each: "INSERT users 3", "DELETE users 1", "SELECT users", "CREATE users"), so a test that spawns the server can count them.
const Module = require("module"), fs = require("fs"), path = require("path");
const tables = {};
const stats = {statements: {insert: 0, delete: 0, select: 0, create: 0}, rows: {}};
const reset = () => { stats.statements = {insert: 0, delete: 0, select: 0, create: 0}; stats.rows = {}; };
const note = line => { if (process.env.FAKE_PG_LOG) fs.appendFileSync(process.env.FAKE_PG_LOG, line + "\n"); };
class Pool {
  constructor(opt) { this.opt = opt; }
  on() {}
  async end() {}
  async query(sql, params = []) {
    let m;
    if ((m = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql))) { tables[m[1]] = tables[m[1]] || new Map(); stats.statements.create++; note("CREATE " + m[1]); return {rows: []}; }
    if ((m = /^SELECT id, data FROM (\w+)/.exec(sql))) { stats.statements.select++; note("SELECT " + m[1]); return {rows: [...tables[m[1]]].map(([id, data]) => ({id, data: JSON.parse(JSON.stringify(data))}))}; }
    if ((m = /^INSERT INTO (\w+)/.exec(sql))) {
      let n = 0; for (let i = 0; i < params.length; i += 2) { tables[m[1]].set(params[i], JSON.parse(params[i + 1])); n++; }
      stats.statements.insert++; stats.rows[m[1]] = (stats.rows[m[1]] || 0) + n; note(`INSERT ${m[1]} ${n}`); return {rows: []};
    }
    if ((m = /^DELETE FROM (\w+)/.exec(sql))) { for (const id of params[0]) tables[m[1]].delete(id); stats.statements.delete++; note(`DELETE ${m[1]} ${params[0].length}`); return {rows: []}; }
    throw new Error("fake pg: unexpected statement: " + sql);
  }
}
const self = path.join(__dirname, "__fake_pg_module__.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === "pg" ? self : orig.call(this, req, ...a); };
require.cache[self] = {id: self, filename: self, loaded: true, exports: {Pool}};
module.exports = {Pool, tables, stats, reset};
