"use strict";
/*
 * Bilyard 8 — backend
 *  - guest accounts (id + secret token), profile sync
 *  - unique player ID / invite code, referral bonuses, friends, daily gifts
 *  - global leaderboard
 *  - online 1v1 matchmaking over WebSocket (shots are relayed between the two players)
 *  - real-money purchases through Stripe Checkout (enabled when STRIPE_SECRET_KEY is set)
 *
 * Storage: Postgres when DATABASE_URL is set (e.g. a free Neon database), otherwise a JSON file.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {WebSocketServer} = require("ws");
const createStore = require("./storage");

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET || "";
const ROOT = path.join(__dirname, "..");
const STATIC = {"/": "index.html", "/index.html": "index.html", "/manifest.webmanifest": "manifest.webmanifest", "/icon.svg": "icon.svg", "/sw.js": "sw.js"};
const MIME = {".html": "text/html; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".js": "text/javascript"};

// ---------------------------------------------------------------- catalog (server is the source of truth for prices)
const SKUS = {
  cash_25:     {cash: 25,       usd: 0.99,  name: "25 Cash"},
  cash_150:    {cash: 150,      usd: 4.99,  name: "150 Cash"},
  cash_350:    {cash: 350,      usd: 9.99,  name: "350 Cash"},
  cash_800:    {cash: 800,      usd: 19.99, name: "800 Cash"},
  cash_2000:   {cash: 2000,     usd: 49.99, name: "2 000 Cash"},
  cash_5000:   {cash: 5000,     usd: 99.99, name: "5 000 Cash"},
  coins_250k:  {coins: 250000,   usd: 0.99,  name: "250 000 Coins"},
  coins_1500k: {coins: 1500000,  usd: 4.99,  name: "1 500 000 Coins"},
  coins_4m:    {coins: 4000000,  usd: 9.99,  name: "4 000 000 Coins"},
  coins_10m:   {coins: 10000000, usd: 19.99, name: "10 000 000 Coins"},
};
const REFERRAL = {invitee: {cash: 10, coins: 5000}, inviter: {cash: 25, coins: 15000}};
const GIFT = {coins: 500};
const CITY_PRIZE = {lon: 100, syd: 200, lis: 1000, tok: 5000, veg: 20000, jak: 100000, tor: 200000, cai: 500000, dub: 1000000,
  sha: 2000000, par: 5000000, rom: 8000000, bkk: 10000000, seo: 20000000, mum: 30000000, ber: 50000000, ist: 100000000, osa: 200000000};

// ---------------------------------------------------------------- storage
const store = createStore({databaseUrl: process.env.DATABASE_URL, dataDir: DATA_DIR});
let db = {users: {}, codes: {}, purchases: {}, meta: {}};
let dirty = false, saving = null;
const markDirty = () => { dirty = true; };
function flush() {
  if (!dirty || saving) return saving || Promise.resolve();
  dirty = false;
  saving = store.save(db)
    .catch(e => { dirty = true; console.error("save failed:", e.message); })
    .finally(() => { saving = null; });
  return saving;
}
setInterval(flush, 2000);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => {
  dirty = true;
  if (saving) await saving;
  await flush();
  await store.close().catch(() => {});
  process.exit(0);
});

const today = () => new Date().toISOString().slice(0, 10);
const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16) || "Player";
const int = (v, max = 1e15) => Math.max(0, Math.min(max, Math.floor(+v || 0)));
function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let c = ""; for (let i = 0; i < 7; i++) c += A[crypto.randomInt(A.length)];
    if (!db.codes[c]) return c;
  }
}
function publicUser(u) {
  return {id: u.id, code: u.code, name: u.name, avatar: u.avatar, frame: u.frame || 0, level: u.level, won: u.won, wins: u.wins, games: u.games,
    country: u.country || "", league: u.league || 0, weekWon: u.week === curWeek() ? u.weekWon || 0 : 0,
    online: clients.has(u.id), lastSeen: u.lastSeen};
}
const cleanCountry = c => /^[A-Za-z]{2}$/.test(String(c || "")) ? String(c).toUpperCase() : "";

// ---------------------------------------------------------------- weekly leaderboards & leagues
// Weeks start Monday 00:00 UTC. Every player earns "weekly winnings"; at the end of the week the world top 3 get cash,
// and inside each league the top 20% move up, the bottom 20% move down.
const LEAGUES = ["bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster"];
const WEEK_PRIZES = [1500, 750, 400];
function weekStart(t = Date.now()) {
  const d = new Date(t), day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
const curWeek = () => new Date(weekStart()).toISOString().slice(0, 10);
const weekEndsAt = () => weekStart() + 7 * 864e5;
function addWeekly(u, amount) {
  const w = curWeek();
  if (u.week !== w) { u.week = w; u.weekWon = 0; }
  u.weekWon = (u.weekWon || 0) + Math.max(0, amount);
  lbCache.clear(); markDirty();
}
function rollWeek() {
  db.meta = db.meta || {};
  const state = db.meta.state = db.meta.state || {week: curWeek()};
  if (state.week === curWeek()) return;
  const prev = state.week, all = Object.values(db.users);
  const played = all.filter(u => u.week === prev && u.weekWon > 0).sort((a, b) => b.weekWon - a.weekWon);
  played.forEach((u, i) => {
    u.lastWeek = {week: prev, won: u.weekWon, rank: i + 1, league: u.league || 0, move: 0};
    if (i < WEEK_PRIZES.length) grant(u, {cash: WEEK_PRIZES[i], coins: 0, kind: "weekly", from: `#${i + 1}`});
  });
  for (let t = 0; t < LEAGUES.length; t++) {
    const tier = played.filter(u => u.lastWeek.league === t), n = tier.length;   // league at the start of the week: move at most one step
    const up = t < LEAGUES.length - 1 ? Math.max(1, Math.ceil(n * 0.2)) : 0;
    const down = t > 0 && n >= 5 ? Math.floor(n * 0.2) : 0;
    tier.forEach((u, i) => {
      if (i < up) { u.league = t + 1; u.lastWeek.move = 1; }
      else if (i >= n - down) { u.league = t - 1; u.lastWeek.move = -1; }
    });
  }
  state.lastWeek = {week: prev, top: played.slice(0, 20).map(u => ({name: u.name, avatar: u.avatar, frame: u.frame || 0, country: u.country || "", level: u.level, won: u.weekWon}))};
  state.week = curWeek();
  lbCache.clear(); markDirty();
  console.log(`week ${prev} closed: ${played.length} players ranked`);
}
setInterval(rollWeek, 60000);
function grant(u, g) { (u.grants = u.grants || []).push({...g, at: Date.now()}); markDirty(); }

// ---------------------------------------------------------------- http helpers
function send(res, code, obj) {
  res.writeHead(code, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS"});
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function jsonBody(req) { const b = await readBody(req); try { return JSON.parse(b.toString("utf8") || "{}"); } catch (e) { return {}; } }
function auth(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer ([\w-]+):([\w-]+)$/.exec(h);
  if (!m) return null;
  const u = db.users[m[1]];
  if (!u || m[2].length !== u.token.length || !crypto.timingSafeEqual(Buffer.from(u.token), Buffer.from(m[2]))) return null;
  u.lastSeen = Date.now();
  return u;
}
// tiny per-IP rate limiter
const buckets = new Map();
function limited(req, key, perMin) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const k = key + ip, now = Date.now(), b = buckets.get(k) || {n: 0, t: now};
  if (now - b.t > 60000) { b.n = 0; b.t = now; }
  b.n++; buckets.set(k, b);
  return b.n > perMin;
}
setInterval(() => buckets.clear(), 10 * 60000);

// ---------------------------------------------------------------- leaderboard cache (per scope, 20 s)
const lbCache = new Map();
function board(key, filter) {
  const c = lbCache.get(key);
  if (c && Date.now() - c.at < 20000) return c.list;
  const w = curWeek();
  const wk = u => u.week === w ? u.weekWon || 0 : 0;
  const list = Object.values(db.users).filter(filter).sort((a, b) => wk(b) - wk(a) || b.won - a.won || b.level - a.level);
  lbCache.set(key, {at: Date.now(), list});
  return list;
}
function geoCountry(req) {   // set by some hosts / CDNs (Cloudflare, Vercel…); Render doesn't, so the client also sends it
  return cleanCountry(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["x-country-code"]);
}

// ---------------------------------------------------------------- routes
const routes = {
  "GET /api/health": () => ({ok: true, players: Object.keys(db.users).length, online: clients.size, payments: !!STRIPE_KEY}),
  "GET /api/skus": () => ({skus: SKUS, payments: !!STRIPE_KEY, referral: REFERRAL}),
  "GET /api/online": () => {
    const byCity = {}; for (const [city, q] of queues) byCity[city] = q.length;
    return {total: clients.size, playing: rooms.size * 2, byCity};
  },

  async "POST /api/register"(req) {
    if (limited(req, "reg", 10)) return [429, {error: "slow down"}];
    const b = await jsonBody(req);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16), token = crypto.randomBytes(24).toString("hex");
    const code = newCode();
    const u = {id, token, code, name: cleanName(b.name), avatar: int(b.avatar, 999), frame: 0, level: 1, xp: 0, won: 0, wins: 0, games: 0,
      friends: [], referredBy: null, referrals: [], grants: [], inbox: [], gifted: {}, created: Date.now(), lastSeen: Date.now(),
      country: geoCountry(req) || cleanCountry(b.country), league: 0, week: curWeek(), weekWon: 0};
    db.users[id] = u; db.codes[code] = id; markDirty();
    return {id, token, code};
  },

  async "POST /api/sync"(req, u) {
    const b = await jsonBody(req);
    if (b.name) u.name = cleanName(b.name);
    if (b.avatar !== undefined) u.avatar = int(b.avatar, 999);
    if (b.frame !== undefined) u.frame = int(b.frame, 99);
    if (cleanCountry(b.country)) u.country = cleanCountry(b.country);
    else if (!u.country) u.country = geoCountry(req);
    // coins won on this device since the last sync also count for this week's ranking
    if (b.won !== undefined) { const d = int(b.won) - (u.won || 0); if (d > 0) addWeekly(u, Math.min(d, 2e8)); }
    for (const k of ["level", "won", "wins", "games"]) if (b[k] !== undefined) u[k] = Math.max(u[k] || 0, int(b[k]));
    if (b.xp !== undefined) u.xp = int(b.xp);
    if (u.week !== curWeek()) { u.week = curWeek(); u.weekWon = 0; }
    const grants = u.grants || []; u.grants = [];
    markDirty();
    return {me: publicUser(u), grants, inbox: u.inbox || [], referredBy: u.referredBy, referrals: u.referrals.length, lastWeek: u.lastWeek || null};
  },

  async "POST /api/referral"(req, u) {
    const b = await jsonBody(req), code = String(b.code || "").toUpperCase().trim();
    const inviterId = db.codes[code];
    if (!inviterId) return [404, {error: "code_not_found"}];
    if (inviterId === u.id) return [400, {error: "own_code"}];
    if (u.referredBy) return [400, {error: "already_used"}];
    if (Date.now() - u.created > 7 * 864e5) return [400, {error: "too_late"}];
    const inv = db.users[inviterId];
    u.referredBy = inviterId; inv.referrals.push(u.id);
    grant(u, {...REFERRAL.invitee, kind: "referral", from: inv.name});
    grant(inv, {...REFERRAL.inviter, kind: "invited", from: u.name});
    if (!u.friends.includes(inv.id)) u.friends.push(inv.id);
    if (!inv.friends.includes(u.id)) inv.friends.push(u.id);
    markDirty();
    return {ok: true, reward: REFERRAL.invitee};
  },

  async "POST /api/friends/add"(req, u) {
    const b = await jsonBody(req), fid = db.codes[String(b.code || "").toUpperCase().trim()];
    if (!fid) return [404, {error: "code_not_found"}];
    if (fid === u.id) return [400, {error: "own_code"}];
    const f = db.users[fid];
    if (u.friends.length >= 500) return [400, {error: "too_many"}];
    if (!u.friends.includes(fid)) u.friends.push(fid);
    if (!f.friends.includes(u.id)) f.friends.push(u.id);
    markDirty();
    return {ok: true, friend: publicUser(f)};
  },
  "GET /api/friends"(req, u) {
    const d = today();
    return {friends: u.friends.map(id => db.users[id]).filter(Boolean).map(f => ({...publicUser(f), canGift: (u.gifted || {})[f.id] !== d}))};
  },
  async "POST /api/gift"(req, u) {
    const b = await jsonBody(req), d = today(), ids = [].concat(b.to || []).slice(0, 100);
    let sent = 0;
    u.gifted = u.gifted || {};
    for (const id of ids) {
      if (!u.friends.includes(id) || u.gifted[id] === d || !db.users[id]) continue;
      u.gifted[id] = d; grant(db.users[id], {...GIFT, kind: "gift", from: u.name}); sent++;
    }
    return {sent};
  },
  async "POST /api/gift/request"(req, u) {
    const b = await jsonBody(req), ids = [].concat(b.to || []).slice(0, 100);
    let sent = 0;
    for (const id of ids) {
      const f = db.users[id];
      if (!f || !u.friends.includes(id)) continue;
      f.inbox = (f.inbox || []).filter(m => !(m.kind === "request" && m.fromId === u.id)).slice(-50);
      f.inbox.push({kind: "request", fromId: u.id, from: u.name, at: Date.now()}); sent++;
    }
    markDirty();
    return {sent};
  },
  async "POST /api/inbox/clear"(req, u) { u.inbox = []; markDirty(); return {ok: true}; },

  // ?scope=world | country | friends | league   — ranked by this week's winnings
  "GET /api/leaderboard"(req, u) {
    const scope = new URL(req.url, "http://x").searchParams.get("scope") || "world";
    const lg = u.league || 0, cc = u.country || "";
    const all = scope === "country" ? board("c:" + cc, x => (x.country || "") === cc)
      : scope === "league" ? board("l:" + lg, x => (x.league || 0) === lg)
      : scope === "friends" ? Object.values(db.users).filter(x => x.id === u.id || u.friends.includes(x.id))
          .sort((a, b) => publicUser(b).weekWon - publicUser(a).weekWon || b.won - a.won)
      : board("world", () => true);
    const rank = all.findIndex(x => x.id === u.id);
    const n = all.length;
    return {scope, week: curWeek(), endsAt: weekEndsAt(), prizes: WEEK_PRIZES, leagues: LEAGUES, country: cc, league: lg,
      promote: scope === "league" && lg < LEAGUES.length - 1 ? Math.max(1, Math.ceil(n * 0.2)) : 0,
      demote: scope === "league" && lg > 0 && n >= 5 ? Math.floor(n * 0.2) : 0,
      top: all.slice(0, 100).map(publicUser), me: {...publicUser(u), rank: rank < 0 ? null : rank + 1}, total: n};
  },
  "GET /api/leaderboard/lastweek"(req, u) {
    const s = (db.meta && db.meta.state) || {};
    return {lastWeek: s.lastWeek || null, me: u.lastWeek || null, prizes: WEEK_PRIZES};
  },

  async "POST /api/checkout"(req, u) {
    const b = await jsonBody(req), sku = SKUS[b.sku];
    if (!sku) return [400, {error: "bad_sku"}];
    if (!STRIPE_KEY) return [503, {error: "payments_not_configured"}];
    const form = new URLSearchParams({
      mode: "payment", success_url: `${APP_URL}/?paid=1`, cancel_url: `${APP_URL}/?paid=0`,
      client_reference_id: u.id, "metadata[userId]": u.id, "metadata[sku]": b.sku,
      "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(sku.usd * 100)),
      "line_items[0][price_data][product_data][name]": `Bilyard 8 — ${sku.name}`,
    });
    let r, s;
    try {
      r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST", headers: {Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded"}, body: form,
      });
      s = await r.json();
    } catch (e) { console.error("stripe unreachable:", e.message); return [502, {error: "stripe_error"}]; }
    if (!r.ok) { console.error("stripe", s.error ? s.error.message : s); return [502, {error: "stripe_error"}]; }
    return {url: s.url};
  },
};

async function stripeWebhook(req, res) {
  const raw = await readBody(req, 512 * 1024);
  const sig = String(req.headers["stripe-signature"] || "");
  const parts = Object.fromEntries(sig.split(",").map(p => p.split("=")));
  const expected = crypto.createHmac("sha256", STRIPE_WHSEC).update(`${parts.t}.${raw}`).digest("hex");
  const ok = STRIPE_WHSEC && parts.v1 && parts.v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected)) && Math.abs(Date.now() / 1000 - +parts.t) < 300;
  if (!ok) return send(res, 400, {error: "bad signature"});
  const ev = JSON.parse(raw.toString("utf8"));
  if (ev.type === "checkout.session.completed" && ev.data.object.payment_status === "paid") {
    const s = ev.data.object, u = db.users[s.metadata && s.metadata.userId], sku = SKUS[s.metadata && s.metadata.sku];
    if (u && sku && !db.purchases[s.id]) {
      db.purchases[s.id] = {user: u.id, sku: s.metadata.sku, at: Date.now(), amount: s.amount_total};
      grant(u, {cash: sku.cash || 0, coins: sku.coins || 0, kind: "purchase", from: sku.name});
      if (saving) await saving;
      await flush();   // money: write it down before telling Stripe we got it
      if (dirty) return send(res, 500, {error: "save failed"});   // Stripe retries the webhook
    }
  }
  send(res, 200, {received: true});
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "POST" && url.pathname === "/api/stripe/webhook") return stripeWebhook(req, res);
    const key = `${req.method} ${url.pathname}`, fn = routes[key];
    if (fn) {
      let u = null;
      if (!["GET /api/health", "GET /api/skus", "GET /api/online", "POST /api/register"].includes(key)) {
        u = auth(req); if (!u) return send(res, 401, {error: "unauthorized"});
      }
      const out = await fn(req, u);
      return Array.isArray(out) ? send(res, out[0], out[1]) : send(res, 200, out);
    }
    const file = STATIC[url.pathname];
    if (req.method === "GET" && file) {
      const p = path.join(ROOT, file);
      if (fs.existsSync(p)) {
        res.writeHead(200, {"Content-Type": MIME[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-cache"});
        return fs.createReadStream(p).pipe(res);
      }
    }
    send(res, 404, {error: "not found"});
  } catch (e) {
    console.error(e);
    send(res, 500, {error: "server error"});
  }
});

// ---------------------------------------------------------------- realtime: matchmaking + rooms
const wss = new WebSocketServer({server, path: "/ws", maxPayload: 32 * 1024});
const clients = new Map();          // userId -> ws
const queues = new Map();           // cityId -> [ws]
const rooms = new Map();            // roomId -> room
const RELAY = new Set(["aim", "shot", "state", "chat", "place", "spin"]);

function wsSend(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function leaveQueue(ws) { for (const q of queues.values()) { const i = q.indexOf(ws); if (i >= 0) q.splice(i, 1); } }
function finish(room, winnerSeat, reason) {
  if (room.over) return;
  room.over = true;
  const [a, b] = room.p, w = room.p[winnerSeat], l = room.p[1 - winnerSeat];
  const wu = w && db.users[w.uid], lu = l && db.users[l.uid];
  if (wu) { wu.wins++; wu.games++; wu.won += CITY_PRIZE[room.city] || 0; addWeekly(wu, CITY_PRIZE[room.city] || 0); }
  if (lu) lu.games++;
  markDirty();
  for (const s of [a, b]) { wsSend(s, {t: "end", winner: winnerSeat, reason}); if (s) s.room = null; }
  rooms.delete(room.id);
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x"), u = db.users[url.searchParams.get("id")];
  if (!u || url.searchParams.get("token") !== u.token) return ws.close(4001, "unauthorized");
  const old = clients.get(u.id); if (old && old !== ws) old.close(4000, "replaced");
  clients.set(u.id, ws);
  ws.uid = u.id; ws.alive = true; ws.room = null;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", data => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === "queue") {
      leaveQueue(ws);
      if (ws.room) return;
      const city = String(m.city || "lon").slice(0, 8);
      ws.profile = {name: u.name, avatar: u.avatar, frame: u.frame || 0, country: u.country || "", level: u.level, cue: String(m.cue || "start").slice(0, 16), code: u.code};
      const q = queues.get(city) || []; queues.set(city, q);
      const opp = q.find(o => o.uid !== ws.uid && o.readyState === 1);
      if (!opp) { q.push(ws); return wsSend(ws, {t: "queued", city, waiting: q.length}); }
      q.splice(q.indexOf(opp), 1);
      const room = {id: crypto.randomUUID(), city, p: [opp, ws], seed: crypto.randomInt(2 ** 31), over: false, reports: {}};
      rooms.set(room.id, room);
      const first = crypto.randomInt(2);
      room.p.forEach((s, seat) => { s.room = room; s.seat = seat; });
      room.p.forEach((s, seat) => wsSend(s, {t: "match", room: room.id, seat, first, seed: room.seed, city, opp: room.p[1 - seat].profile}));
    } else if (m.t === "cancel") {
      leaveQueue(ws);
    } else if (RELAY.has(m.t) && ws.room && !ws.room.over) {
      const other = ws.room.p[1 - ws.seat];
      if (m.t === "chat") m.msg = String(m.msg || "").slice(0, 40);
      wsSend(other, {...m, from: ws.seat});
    } else if (m.t === "result" && ws.room) {
      const room = ws.room, w = +m.winner === 1 ? 1 : 0;
      room.reports[ws.seat] = w;
      const r = room.reports;
      // both devices simulate the same game; if they disagree, the loser's own report wins (nobody gains by lying about losing)
      if (r[0] !== undefined && r[1] !== undefined) finish(room, r[0] === r[1] ? r[0] : (r[0] !== 0 ? r[0] : r[1]), "normal");
      else setTimeout(() => { if (!room.over) finish(room, w, "normal"); }, 5000);
    } else if (m.t === "resign" && ws.room) {
      finish(ws.room, 1 - ws.seat, "resign");
    }
  });
  ws.on("close", () => {
    leaveQueue(ws);
    if (clients.get(u.id) === ws) clients.delete(u.id);
    const room = ws.room;
    if (room && !room.over) { wsSend(room.p[1 - ws.seat], {t: "oppLeft"}); finish(room, 1 - ws.seat, "left"); }
  });
  wsSend(ws, {t: "hello", online: clients.size});
});
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 30000);

store.load().then(loaded => {
  if (loaded) db = Object.assign({users: {}, codes: {}, purchases: {}, meta: {}}, loaded);
  db.meta = db.meta || {};
  rollWeek();
  server.listen(PORT, () => console.log(`Bilyard 8 server on :${PORT} (storage ${store.kind}, ${Object.keys(db.users).length} players, payments ${STRIPE_KEY ? "ON" : "off"})`));
}).catch(e => { console.error("Could not load the database:", e.message); process.exit(1); });
