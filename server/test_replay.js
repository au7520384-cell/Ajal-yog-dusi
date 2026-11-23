#!/usr/bin/env node
// Shared shots, on the real server:  node server/test_replay.js   (B8_ROOT=<repo copy>; ~15 s)
// The owner (Nov 23, Telegram): the replay window's "Share" did not send the shot to people. Now the shot (ball positions: a few KB) is kept on the server and a link opens it in the game of whoever gets it.
//  - POST /api/replay keeps a well-formed shot (plain or deflated) and answers with an id; GET /api/replay?id= gives the same shot back, with who shared it (name / avatar from the account, not from the page)
//  - anything else is refused: a wrong size for n frames x nb balls, bad base64, ball numbers out of range, a body over the limit, no sign-in; an unknown / malformed id is a 404
//  - the shots survive a restart; the oldest go first above 400; a shot older than 30 days is gone; deleting the account deletes the shots he shared; many uploads in a minute are slowed down
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os"), zlib = require("zlib");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8793, base = `http://localhost:${P}`;
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ""); } };
const api = async (acct, p, body, raw) => { try { const r = await fetch(base + p, { method: body !== undefined ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; } catch (e) { return { s: 0, j: { error: String(e.message) } }; } };
// a shot like the page makes it: n frames of nb balls, (x, y) as Int16 in 1/16 px, little endian; the cue ball and the 8 on the table, the 8 leaves the table half way (x = -32768)
function shot(n, nb, z) {
  const buf = Buffer.alloc(n * nb * 4);
  for (let k = 0; k < n; k++) for (let i = 0; i < nb; i++) { const o = (k * nb + i) * 4; buf.writeInt16LE(i === 1 && k > n / 2 ? -32768 : Math.round((100 + i * 60 + k * 2) * 16), o); buf.writeInt16LE(Math.round((250 + i * 5) * 16), o + 2); }
  const data = z ? zlib.deflateRawSync(buf) : buf;
  return { v: 1, z: z ? 1 : 0, nb, n, nums: Array.from({ length: nb }, (_, i) => i), city: "golden", tbl: "", f: data.toString("base64"), kind: "best", wk: "", why: "G'alaba zarbasi · Bort orqali zarba", rec: { name: "x", n: 2, combo: 1, bank: 1, brk: false, won: true } };
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8rp-")), file = path.join(tmp, "db.json");
  const start = () => spawn("node", [path.join(ROOT, "server", "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" });
  let srv = start(); await sleep(2200);
  const stop = async () => { srv.kill("SIGTERM"); await sleep(1500); };
  const reg = async name => (await api(null, "/api/register", { name, avatar: 7 })).j;
  const ann = await reg("Ann"), bob = await reg("Bob");
  ok(ann.id && ann.token && bob.id, "two accounts", { ann, bob });

  // ------------------------------------------------------------------ keep and fetch
  const a = await api(ann, "/api/replay", shot(300, 6, false)), b = await api(ann, "/api/replay", { ...shot(120, 4, true), kind: "trick", wk: "Bort orqali zarba", why: "x".repeat(300) });
  ok(a.s === 200 && /^[A-Za-z0-9]{10}$/.test(a.j.id || "") && b.s === 200 && b.j.id && b.j.id !== a.j.id, "a plain and a deflated shot are kept: an id of 10 letters / digits each", { a, b });
  const ga = await api(bob, "/api/replay?id=" + a.j.id), gb = await api(bob, "/api/replay?id=" + b.j.id), sa = shot(300, 6, false);
  ok(ga.s === 200 && ga.j.replay.f === sa.f && ga.j.replay.n === 300 && ga.j.replay.nb === 6 && ga.j.replay.z === 0 && ga.j.replay.kind === "best" && ga.j.replay.rec.combo === 1 && ga.j.replay.rec.won === true, "another player gets the same shot back (positions, kind, what the shot did)", ga);
  ok(ga.j.by.name === "Ann" && ga.j.by.avatar === 7, "it says who shared it: the account's own name and avatar", ga.j.by);
  ok(gb.s === 200 && gb.j.replay.z === 1 && gb.j.replay.kind === "trick" && gb.j.replay.wk === "Bort orqali zarba" && gb.j.replay.why.length === 120, "the deflated shot, the trick name key, and a long text cut to 120", gb.j.replay);

  // ------------------------------------------------------------------ refused
  const bad = async (m, body, raw) => { const r = await api(ann, "/api/replay", body, raw); ok(r.s === 400 || r.s === 0, "refused: " + m, r); };
  const s1 = shot(100, 4, false);
  await bad("a size that is not n x nb x 4 bytes", { ...s1, n: 101 });
  await bad("a deflated size that is not n x nb x 4 bytes", { ...shot(100, 4, true), n: 90 });
  await bad("data that is not deflate although it says so", { ...s1, z: 1 });
  await bad("bad base64", { ...s1, f: "***not base64***" });
  await bad("ball numbers out of range", { ...s1, nums: [0, 1, 2, 99] });
  await bad("nb that does not match the ball numbers", { ...s1, nb: 3 });
  await bad("one ball only", { ...shot(100, 1, false), nums: [0], nb: 1 });
  await bad("more than 620 frames", shot(700, 4, false));
  await bad("no version", { ...s1, v: undefined });
  await bad("not JSON", "{{{", true);
  await bad("a body over the limit (120 KB)", { ...s1, junk: "x".repeat(120 * 1024) });
  ok((await api(null, "/api/replay", s1)).s === 401 && (await api(null, "/api/replay?id=" + a.j.id)).s === 401, "no sign-in: 401 for both");
  ok((await api(bob, "/api/replay?id=NOPE1234ab")).s === 404 && (await api(bob, "/api/replay?id=../../etc")).s === 404 && (await api(bob, "/api/replay")).s === 404, "an unknown or malformed id is a 404");
  const sane = await api(ann, "/api/replay", { ...s1, city: "<b>x</b>\u0001" + "c".repeat(50), tbl: "t".repeat(50) }), gs = await api(bob, "/api/replay?id=" + sane.j.id);
  ok(sane.s === 200 && !/[<>\u0001]/.test(gs.j.replay.city) && gs.j.replay.city.length <= 24 && gs.j.replay.tbl.length <= 24, "text fields are cleaned and cut", gs.j.replay);

  // ------------------------------------------------------------------ restart, the age limit, the number limit
  await stop();
  const db = JSON.parse(fs.readFileSync(file, "utf8")), all = db.replays || {};
  ok(all[a.j.id] && all[b.j.id] && all[a.j.id].u === ann.id, "the shots are in the database file", Object.keys(all));
  const t0 = Date.now(); all[a.j.id].at = t0 - 31 * 864e5;   // 31 days old: gone
  for (let i = 0; i < 405; i++) all["old" + String(i).padStart(4, "0") + "Zz"] = { ...all[b.j.id], id: "old" + i, at: t0 - 20 * 864e5 + i * 1000 };   // 405 more, oldest first
  fs.writeFileSync(file, JSON.stringify(db));
  srv = start(); await sleep(2200);
  ok((await api(bob, "/api/replay?id=" + b.j.id)).s === 200, "after a restart a shot is still there");
  ok((await api(bob, "/api/replay?id=" + a.j.id)).s === 404, "a shot older than 30 days is a 404");
  const c = await api(ann, "/api/replay", shot(60, 3, true));   // an upload prunes
  await stop();
  const after = JSON.parse(fs.readFileSync(file, "utf8")).replays || {}, ids = Object.keys(after);
  ok(ids.length <= 400 && !!after[c.j.id], "above 400 the oldest go first and the new one stays (kept: " + ids.length + ")", ids.length);
  ok(!after[a.j.id] && !after["old0000Zz"] && after["old0404Zz"], "the 30-day-old one and the oldest of the old are gone, the newest of the old stays", { a: !!after[a.j.id], oldest: !!after["old0000Zz"], newest: !!after["old0404Zz"] });

  // ------------------------------------------------------------------ account deletion, slowing down
  srv = start(); await sleep(2200);
  const own = await api(bob, "/api/replay", shot(80, 4, false));
  ok(own.s === 200 && (await api(ann, "/api/replay?id=" + own.j.id)).s === 200, "Bob shares a shot and Ann can open it");
  ok((await api(bob, "/api/account/delete", { confirm: "DELETE" })).s === 200 && (await api(ann, "/api/replay?id=" + own.j.id)).s === 404, "when Bob deletes his account, the shots he shared are gone");
  let slow = 0; for (let i = 0; i < 25; i++) { const r = await api(ann, "/api/replay", shot(10, 2, false)); if (r.s === 429) slow++; }
  ok(slow >= 3, "many uploads in a minute are slowed down (429)", slow);
  await stop();
  console.log(`pass ${pass}, fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
