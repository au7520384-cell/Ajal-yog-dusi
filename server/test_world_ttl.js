#!/usr/bin/env node
// The world chat keeps a line for ONE HOUR only (the owner: "1 soat tursin"):  node server/test_world_ttl.js
// The real server runs with WORLD_TTL_MS=3000 (3 seconds instead of an hour): a line is there, then it is gone from the room, from the admin list and from a report; `from` tells an open window what to drop.
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8wt-")), P = 8673, base = `http://localhost:${P}`, KEY = "ttlAdminKey123";
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp, ADMIN_KEY: KEY, WORLD_TTL_MS: "3000" }, stdio: "ignore" }); await sleep(2500);
  const api = async (acct, p, body, h) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(h || {}), ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const A = (await api(null, "/api/register", { name: "Ann", avatar: 1 })).j, B = (await api(null, "/api/register", { name: "Bob", avatar: 2 })).j;
    const sent = (await api(A, "/api/world/send", { text: "hello world" })).j;
    ok(sent.ok && sent.msg && sent.msg.text === "hello world", "a line is sent", sent);
    let w = (await api(B, "/api/world")).j;
    ok(w.msgs.some(m => m.text === "hello world"), "another player sees it at once", w);
    ok(w.from === sent.msg.id, "`from` is the oldest line still alive (this one)", { from: w.from, id: sent.msg.id });
    let adm = (await api(null, "/api/world/admin", null, { "x-admin-key": KEY })).j; ok(adm.msgs.some(m => m.text === "hello world"), "the admin list has it", adm.msgs);
    await sleep(1800); await api(A, "/api/world/send", { text: "second line" });
    await sleep(1800);   // the 1st line is 3.6 s old now, the 2nd is 1.8 s old
    w = (await api(B, "/api/world")).j;
    ok(!w.msgs.some(m => m.text === "hello world"), "after the time the 1st line is gone from the room", w.msgs);
    ok(w.msgs.some(m => m.text === "second line"), "the younger line is still there", w.msgs);
    ok(w.from > sent.msg.id, "`from` moved on: an open window drops everything older", { from: w.from, id: sent.msg.id });
    w = (await api(B, "/api/world?after=" + sent.msg.id)).j; ok(w.msgs.length === 1 && w.msgs[0].text === "second line" && w.from > sent.msg.id, "the poll `after` shows only the new line and the new `from`", w);
    adm = (await api(null, "/api/world/admin", null, { "x-admin-key": KEY })).j; ok(!adm.msgs.some(m => m.text === "hello world"), "the admin list no longer has the old line", adm.msgs);
    const rep = await api(B, "/api/world/report", { mid: sent.msg.id }); ok(rep.s === 200, "a report about a gone line is answered and ignored", rep);
    await sleep(3300);
    w = (await api(B, "/api/world")).j; ok(w.msgs.length === 0 && w.from === w.last + 1, "an empty room: no lines, `from` is the next id", w);
    const again = (await api(A, "/api/world/send", { text: "back again" })).j; await sleep(300);
    w = (await api(B, "/api/world")).j; ok(w.msgs.length === 1 && w.msgs[0].text === "back again" && w.from === again.msg.id, "a new line after the empty room works", w);
  } catch (e) { fail++; console.log("ERROR", e && e.stack || e); }
  srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
