#!/usr/bin/env node
// Profile photos (the owner, Nov 27: "a player must be able to put his own picture: Google sign-in shows the Google photo, Telegram sign-in the Telegram photo"):  node server/test_photo.js   (~40 s)
// A photo is an avatar whose number is >= 1000 (u.pid, random, handed out by the server); the phones load it from GET /api/photo/<pid>, which the server fetches itself and caches.
// Fake services stand in for Google's tokeninfo, the providers' picture CDN and Telegram's Bot API (the server's GOOGLE_TOKENINFO_URL / TG_API_BASE / B8_PIC_HOSTS point at them).
// Checked: a Google sign-in with a picture and a Telegram sign-in (signed initData) with a photo_url give the account a photo number; the picture is served (image type, cached, 304); a picture address that is NOT on the host list,
// a redirect off the list, an SVG / HTML / oversized / slow answer are never served; a Telegram player with no photo_url gets his picture through the Bot API; sync keeps a photo avatar only for its own owner (a made-up number and
// someone else's number are ignored); the other players read the photo number in the world chat; "photo off" forgets it all; deleting the account makes the number a 404; a bad Telegram signature is refused as before.
const { spawn } = require("child_process"), http = require("http"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 300) : ""); } };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF-photo-from-the-bot-api-".padEnd(60, "x"))]);
const TOKEN = "123456:TESTTOKEN";
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8ph-")), P = +process.env.TEST_PORT || 8751, PF = P + 1, base = `http://localhost:${P}`, hits = {}, botCalls = [];
  const cdn = `http://localhost:${PF}/cdn`;
  // ---- the fake world: tokeninfo, the picture CDN, the Bot API
  const fake = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x"); u.pathname = u.pathname.replace(/=s\d+(-c)?$/, ""); hits[u.pathname] = (hits[u.pathname] || 0) + 1; { const sfx = /=s\d+(-c)?$/.exec(q.url.split("?")[0]); if (sfx) (hits.sizes = hits.sizes || []).push(sfx[0]); }   // (Google's addresses end in =s96-c / =s192-c)
    const json = (code, o) => { r.writeHead(code, { "content-type": "application/json" }); r.end(JSON.stringify(o)); };
    if (u.pathname === "/g") {   // id_token = g|<sub>|<picture path or ->
      const [k, sub, pic] = (u.searchParams.get("id_token") || "").split("|");
      if (k !== "g") return json(400, { error: "invalid_token" });
      return json(200, { aud: "gcid", iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 3600), sub, given_name: "Gina", picture: pic && pic !== "-" ? (pic.startsWith("http") ? pic : cdn + pic + "=s96-c") : undefined });
    }
    if (u.pathname === "/cdn/ok.png") { r.writeHead(200, { "content-type": "image/png" }); return r.end(PNG); }
    if (u.pathname === "/cdn/lies.png") { r.writeHead(200, { "content-type": "image/png" }); return r.end(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".padEnd(80, " "))); }   // says PNG, is not
    if (u.pathname === "/cdn/svg") { r.writeHead(200, { "content-type": "image/svg+xml" }); return r.end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"); }
    if (u.pathname === "/cdn/big") { r.writeHead(200, { "content-type": "image/png" }); return r.end(Buffer.concat([PNG, Buffer.alloc(500 * 1024)])); }
    if (u.pathname === "/cdn/slow") { setTimeout(() => { try { r.writeHead(200, { "content-type": "image/png" }); r.end(PNG); } catch (e) {} }, 7500); return; }
    if (u.pathname === "/cdn/redir-ok") { r.writeHead(302, { location: "/cdn/ok.png" }); return r.end(); }
    if (u.pathname === "/cdn/redir-bad") { r.writeHead(302, { location: `http://127.0.0.1:${PF}/secret/inside.png` }); return r.end(); }
    if (u.pathname === "/secret/inside.png") { r.writeHead(200, { "content-type": "image/png" }); return r.end(PNG); }
    if (u.pathname === "/cdn/missing") { r.writeHead(404); return r.end(); }
    // the Bot API
    const m = /^\/tg\/bot[^/]+\/(\w+)$/.exec(u.pathname);
    if (m && q.method === "POST") { let body = ""; q.on("data", c => body += c); q.on("end", () => { let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) {} botCalls.push([m[1], b]);
      if (m[1] === "getUserProfilePhotos") return json(200, { ok: true, result: b.user_id === 777 ? { total_count: 1, photos: [[{ file_id: "F_SMALL", width: 90, height: 90 }, { file_id: "F_MID", width: 320, height: 320 }, { file_id: "F_BIG", width: 640, height: 640 }]] } : { total_count: 0, photos: [] } });
      if (m[1] === "getFile") return json(200, { ok: true, result: { file_id: b.file_id, file_path: "photos/" + b.file_id + ".jpg" } });
      return json(200, { ok: true, result: {} }); }); return; }
    if (/^\/tg\/file\/bot[^/]+\/photos\/F_MID\.jpg$/.test(u.pathname)) { r.writeHead(200, { "content-type": "image/jpeg" }); return r.end(JPG); }
    r.writeHead(404); r.end();
  });
  await new Promise(r => fake.listen(PF, r));
  const env = { ...process.env, PORT: String(P), DATA_DIR: tmp, APP_URL: base, GOOGLE_CLIENT_ID: "gcid", GOOGLE_TOKENINFO_URL: `http://localhost:${PF}/g`, TELEGRAM_BOT_TOKEN: TOKEN, TG_API_BASE: `http://localhost:${PF}/tg`, B8_PIC_HOSTS: `^http://localhost:${PF}/cdn/` };
  delete env.RENDER_EXTERNAL_URL;
  const srv = spawn("node", [path.join(__dirname, "server.js")], { env, stdio: "ignore" }); await sleep(2800);
  const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const photo = (id, h) => fetch(`${base}/api/photo/${id}`, { headers: h || {} });
  const tgData = (user, ago = 0) => { const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - ago), query_id: "AAH" + crypto.randomBytes(4).toString("hex"), user: JSON.stringify(user) });
    const check = [...p.entries()].map(([k, v]) => k + "=" + v).sort().join("\n"), secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest(); p.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex")); return p.toString(); };
  try {
    // ---- Google: a picture on the list
    const G1 = await api(null, "/api/auth/login", { provider: "google", token: "g|gsub1|/ok.png", name: "Gina", avatar: 3 });
    ok(G1.s === 200 && G1.j.pic && G1.j.pic.id >= 1000 && G1.j.pic.src === "google", "Google sign-in with a picture: the account gets a photo number (>= 1000)", G1.j);
    const A = { id: G1.j.id, token: G1.j.token }, pidA = G1.j.pic && G1.j.pic.id;
    let r = await photo(pidA), buf = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get("content-type") === "image/png" && buf.equals(PNG), "GET /api/photo/<pid>: the picture, as an image", { st: r.status, type: r.headers.get("content-type"), n: buf.length });
    ok(/max-age=\d+/.test(r.headers.get("cache-control") || "") && r.headers.get("access-control-allow-origin") === "*" && /nosniff/.test(r.headers.get("x-content-type-options") || ""), "...cacheable, readable by the game page (CORS), nosniff", Object.fromEntries(r.headers));
    ok(hits["/cdn/ok.png"] === 1 && hits.sizes && hits.sizes.includes("=s192-c"), "Google's picture was asked for in a bigger size (s192-c), once", hits);
    const etag = r.headers.get("etag"); r = await photo(pidA, { "If-None-Match": etag }); ok(r.status === 304, "a repeat with If-None-Match: 304", r.status);
    await photo(pidA); await photo(pidA); ok(hits["/cdn/ok.png"] === 1, "the server keeps the picture: the provider's CDN was asked only once for three loads", hits);
    // ---- numbers that must not give anything
    for (const bad of ["0", "999", "1000", "abc", "-5", "99999999999", "1e9", String(pidA + 1)]) { r = await photo(bad); ok(r.status === 404, `/api/photo/${bad}: 404`, r.status); }
    // ---- a picture address that is not on the list / redirects / false pictures
    const tryG = async (sub, pic) => { const L = await api(null, "/api/auth/login", { provider: "google", token: `g|${sub}|${pic}`, name: "X", avatar: 1 }); return L; };
    { const L = await tryG("gsub2", "https://evil.example/p.png"); ok(L.s === 200 && !L.j.pic, "an address that is not on the list of provider hosts is dropped at sign-in (no photo number)", L.j); }
    { const L = await tryG("gsub3", "http://169.254.169.254/latest/meta-data"); ok(L.s === 200 && !L.j.pic, "an internal address is dropped as well", L.j); }
    { const L = await tryG("gsub4", "-"); ok(L.s === 200 && !L.j.pic, "no picture in the token: no photo number", L.j); }
    const served = async (path) => { const L = await tryG("g" + crypto.randomBytes(3).toString("hex"), path); const id = L.j.pic && L.j.pic.id; const x = id ? await photo(id) : null; return { L, st: x ? x.status : "no-pid" }; };
    { const x = await served("/redir-ok"); ok(x.st === 200, "a redirect to another address on the list is followed", x.st); }
    { const before = hits["/secret/inside.png"] || 0, x = await served("/redir-bad"); ok(x.st === 404 && (hits["/secret/inside.png"] || 0) === before, "a redirect OFF the list is not followed (the server never asks the other host)", { st: x.st, hits: hits["/secret/inside.png"] }); }
    { const x = await served("/lies.png"); ok(x.st === 404, "a body that is not a raster picture although it says image/png (an SVG with a script): never served", x.st); }
    { const x = await served("/svg"); ok(x.st === 404, "an SVG: never served", x.st); }
    { const x = await served("/big"); ok(x.st === 404, "an oversized picture (500 KB, the limit is 160 KB): never served", x.st); }
    { const x = await served("/missing"); ok(x.st === 404, "a picture the CDN does not have: 404", x.st); }
    { const t0 = Date.now(), x = await served("/slow"); ok(x.st === 404 && Date.now() - t0 < 9500, "a CDN that answers after 7 s: given up at 6 s (404)", { st: x.st, ms: Date.now() - t0 }); }
    // ---- sync: a photo avatar only for its owner
    let S = await api(A, "/api/sync", { name: "Gina", avatar: pidA });
    ok(S.s === 200 && S.j.me.avatar === pidA && S.j.pic && S.j.pic.id === pidA, "sync with avatar = my photo number: accepted, and the answer says I have a photo", { av: S.j.me && S.j.me.avatar, pic: S.j.pic });
    S = await api(A, "/api/sync", { name: "Gina", avatar: 123456789 }); ok(S.j.me.avatar === pidA, "a made-up photo number is ignored (the avatar stays)", S.j.me.avatar);
    const T1 = await api(null, "/api/auth/login", { provider: "telegram", token: tgData({ id: 5551, first_name: "Tom", photo_url: cdn + "/ok.png" }), name: "Tom", avatar: 2 });
    ok(T1.s === 200 && T1.j.pic && T1.j.pic.src === "telegram" && T1.j.pic.id !== pidA, "Telegram sign-in with a photo_url in the signed data: the account gets a photo number", T1.j);
    const B = { id: T1.j.id, token: T1.j.token }, pidB = T1.j.pic.id;
    S = await api(B, "/api/sync", { name: "Tom", avatar: pidA }); ok(S.j.me.avatar !== pidA, "someone else's photo number is ignored (he can wear his own photo only)", S.j.me.avatar);
    S = await api(B, "/api/sync", { name: "Tom", avatar: pidB }); ok(S.j.me.avatar === pidB, "his own is accepted", S.j.me.avatar);
    S = await api(A, "/api/sync", { name: "Gina", avatar: 7 }); ok(S.j.me.avatar === 7 && S.j.pic && S.j.pic.id === pidA, "a game avatar can be chosen again at any time (the photo stays on offer)", S.j.me.avatar);
    S = await api(A, "/api/sync", { name: "Gina", avatar: pidA });
    // ---- the other players read it
    await sleep(3100); const sent = await api(A, "/api/world/send", { text: "hello" }), w = (await api(B, "/api/world")).j, line = (w.msgs || []).filter(m => m.uid === A.id).pop();
    ok(sent.s === 200 && line && line.avatar === pidA, "the photo number reaches the other players like any avatar (world chat)", line);
    // ---- Telegram: no photo_url, the Bot API has the picture
    const T2 = await api(null, "/api/auth/login", { provider: "telegram", token: tgData({ id: 777, first_name: "Bota" }), name: "Bota", avatar: 4 }), C = { id: T2.j.id, token: T2.j.token };
    await sleep(500); S = await api(C, "/api/sync", { name: "Bota", avatar: 4 });
    ok(botCalls.some(c => c[0] === "getUserProfilePhotos" && c[1].user_id === 777), "a Telegram player without a photo_url: the Bot API is asked for his profile photos", botCalls.map(c => c[0]));
    ok(S.j.pic && S.j.pic.id >= 1000 && S.j.pic.src === "telegram", "...and the next sync says he has a photo", S.j.pic);
    r = await photo(S.j.pic.id); buf = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get("content-type") === "image/jpeg" && buf.equals(JPG), "...its picture comes through the Bot API (getFile): the bot's token never leaves the server", { st: r.status, type: r.headers.get("content-type") });
    ok(botCalls.some(c => c[0] === "getFile" && c[1].file_id === "F_MID"), "the 320 px size was chosen (not the 90 px or the 640 px one)", botCalls.filter(c => c[0] === "getFile").map(c => c[1].file_id));
    const T3 = await api(null, "/api/auth/login", { provider: "telegram", token: tgData({ id: 888, first_name: "Nobody" }), name: "Nobody", avatar: 4 }); await sleep(400);
    S = await api({ id: T3.j.id, token: T3.j.token }, "/api/sync", { name: "Nobody", avatar: 4 }); ok(!S.j.pic, "a Telegram player who has no photo (or hides it): no photo number", S.j.pic);
    ok((await api(null, "/api/auth/login", { provider: "telegram", token: tgData({ id: 5551, first_name: "Tom", photo_url: cdn + "/ok.png" }).replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64)) })).s === 401, "Telegram data with a wrong signature: refused as before");
    ok((await api(null, "/api/auth/login", { provider: "telegram", token: tgData({ id: 5551, first_name: "Tom" }, 90000) })).s === 401, "Telegram data older than a day: refused as before");
    // ---- photo off, account deletion
    let O = await api(A, "/api/photo/off", {}); S = await api(A, "/api/sync", { name: "Gina", avatar: 9 });
    ok(O.s === 200 && !S.j.pic && S.j.me.avatar === 9, "'photo off': the account has no photo any more", { o: O.j, pic: S.j.pic });
    ok((await photo(pidA)).status === 404, "...and its old number is a 404 now", (await photo(pidA)).status);
    S = await api(A, "/api/sync", { name: "Gina", avatar: pidA }); ok(S.j.me.avatar === 9, "...and it cannot be put back by sync", S.j.me.avatar);
    await api(B, "/api/sync", { name: "Tom", avatar: pidB }); const del = await api(B, "/api/account/delete", { confirm: "DELETE" });
    ok(del.s === 200 && (await photo(pidB)).status === 404, "deleting the account makes its photo number a 404", del.j);
    // a second sign-in of the same Google account with another picture: the same number, the new picture
    const G2 = await api(null, "/api/auth/login", { provider: "google", token: "g|gsub1|/ok.png", name: "Gina", avatar: 3 });
    ok(G2.s === 200 && G2.j.existing === true, "the same Google account signs in again (a new photo number may be given after 'photo off')", { ex: G2.j.existing, pic: G2.j.pic });
  } finally { srv.kill("SIGTERM"); fake.close(); await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
