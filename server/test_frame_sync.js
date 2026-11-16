#!/usr/bin/env node
// The frame a player wears reaches the other players unchanged:  node server/test_frame_sync.js
// The owner (Nov 16, a screenshot of the friends list, arrow on one player): "he chose another avatar, but to the others it shows like this". The server stored the frame with int(b.frame, 99), the game has 128 frames:
// every frame from #100 on (scary, VIP, newest) arrived at the others as #99. Checked: frames 0, 99, 100, 127 (and a far-fetched 5000 stays inside the limit), the avatar 563, as the other players read them (world chat line, friends).
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8frm-")), P = +process.env.TEST_PORT || 8741, base = `http://localhost:${P}`;
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env: { ...process.env, PORT: String(P), DATA_DIR: tmp }, stdio: "ignore" }); await sleep(2500);
  const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const A = (await api(null, "/api/register", { name: "Framer", avatar: 563 })).j, B = (await api(null, "/api/register", { name: "Viewer", avatar: 1 })).j;
    for (const fr of [0, 99, 100, 127, 5000]) {
      await api(A, "/api/sync", { name: "Framer", avatar: 563, frame: fr });
      await sleep(3100); const sent = await api(A, "/api/world/send", { text: "hello " + fr }); // (one line per 3 s)
      const w = (await api(B, "/api/world")).j, line = (w.msgs || []).filter(m => m.uid === A.id).pop();
      const want = fr === 5000 ? 999 : fr;
      ok(sent.s === 200 && line && line.frame === want && line.avatar === 563, `frame ${fr} reaches the other players as ${want} (avatar 563 as it is)`, line);
    }
  } finally { srv.kill("SIGTERM"); await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
