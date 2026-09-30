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
  coins_20k:   {coins: 20000,   vip: 130,   usd: 1.99,  name: "20 000 Coins"},
  coins_52k:   {coins: 52000,   vip: 364,   usd: 4.99,  name: "52 000 Coins"},
  coins_112k:  {coins: 112000,  vip: 832,   usd: 9.99,  name: "112 000 Coins"},
  coins_256k:  {coins: 256000,  vip: 1920,  usd: 19.99, name: "256 000 Coins"},
  coins_800k:  {coins: 800000,  vip: 5590,  usd: 49.99, name: "800 000 Coins"},
  coins_2m:    {coins: 2000000, vip: 13000, usd: 99.99, name: "2 000 000 Coins"},
  cash_15:     {cash: 15,       vip: 130,   usd: 1.99,  name: "15 Cash"},
  cash_50:     {cash: 50,       vip: 364,   usd: 4.99,  name: "50 Cash"},
  cash_110:    {cash: 110,      vip: 832,   usd: 9.99,  name: "110 Cash"},
  cash_256:    {cash: 256,      vip: 1920,  usd: 19.99, name: "256 Cash"},
  cash_800:    {cash: 800,      vip: 5590,  usd: 49.99, name: "800 Cash"},
  cash_2000:   {cash: 2000,     vip: 13000, usd: 99.99, name: "2 000 Cash"},
  gems_20:     {gems: 20,       vip: 130,   usd: 1.99,  name: "20 Gems"},
  gems_60:     {gems: 60,       vip: 364,   usd: 4.99,  name: "60 Gems"},
  gems_140:    {gems: 140,      vip: 832,   usd: 9.99,  name: "140 Gems"},
  starter:     {cash: 50, coins: 100000, gems: 20, vip: 200, usd: 2.99, name: "Starter Pack", once: true},
  try_lucky:   {items: {luckyTries: 1},   vip: 60,  usd: 0.99, name: "Lucky Shot +1"},
  try_wheel:   {items: {wheelTries: 1},   vip: 60,  usd: 0.99, name: "Spin & Win +1"},
  try_scratch: {items: {scratchTries: 1}, vip: 60,  usd: 0.99, name: "Scratch & Win +1"},
  golden_3:    {items: {goldShots: 3},    vip: 130, usd: 1.99, name: "Golden Shot x3"},
  sbox_1:      {items: {sboxes: 1},       vip: 60,  usd: 0.99, name: "Surprise Box"},
  sbox_5:      {items: {sboxes: 5},       vip: 260, usd: 3.99, name: "Surprise Box x5"},
  // VIP bundles: exclusive cues that are never sold in the cue shop
  sport_1:     {coins: 120000,  cash: 60,   vip: 332,  items: {cues: ["vip_under"], sboxes: 2},    usd: 3.99,  name: "Sports Madness: Underdog"},
  sport_2:     {coins: 258000,  cash: 90,   vip: 582,  items: {cues: ["vip_champ"], sboxes: 2},    usd: 6.99,  name: "Sports Madness: Champion"},
  sport_3:     {coins: 540000,  cash: 440,  vip: 2708, items: {cues: ["vip_mvp"], sboxes: 4},      usd: 24.99, name: "Sports Madness: M.V.P."},
  atom_1:      {coins: 140000,  cash: 140,  vip: 400,  items: {cues: ["vip_geiger"], goldShots: 4},  usd: 4.99,  name: "Atomic Blast: Geiger"},
  atom_2:      {coins: 360000,  cash: 360,  vip: 832,  items: {cues: ["vip_kaboom"], goldShots: 9},  usd: 9.99,  name: "Atomic Blast: Kaboom"},
  atom_3:      {coins: 1728000, cash: 1720, vip: 5000, items: {cues: ["vip_nemesis"], goldShots: 36}, usd: 39.99, name: "Atomic Blast: Nuclear Nemesis"},
  zod_0:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z0"], avs: [200], sboxes: 5}, usd: 24.99, name: "Zodiac: Aries"},
  zod_1:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z1"], avs: [201], sboxes: 5}, usd: 24.99, name: "Zodiac: Taurus"},
  zod_2:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z2"], avs: [202], sboxes: 5}, usd: 24.99, name: "Zodiac: Gemini"},
  zod_3:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z3"], avs: [203], sboxes: 5}, usd: 24.99, name: "Zodiac: Cancer"},
  zod_4:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z4"], avs: [204], sboxes: 5}, usd: 24.99, name: "Zodiac: Leo"},
  zod_5:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z5"], avs: [205], sboxes: 5}, usd: 24.99, name: "Zodiac: Virgo"},
  zod_6:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z6"], avs: [206], sboxes: 5}, usd: 24.99, name: "Zodiac: Libra"},
  zod_7:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z7"], avs: [207], sboxes: 5}, usd: 24.99, name: "Zodiac: Scorpio"},
  zod_8:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z8"], avs: [208], sboxes: 5}, usd: 24.99, name: "Zodiac: Sagittarius"},
  zod_9:      {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z9"], avs: [209], sboxes: 5}, usd: 24.99, name: "Zodiac: Capricorn"},
  zod_10:     {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z10"], avs: [210], sboxes: 5}, usd: 24.99, name: "Zodiac: Aquarius"},
  zod_11:     {coins: 420000,  cash: 1260, vip: 2708, items: {cues: ["vip_z11"], avs: [211], sboxes: 5}, usd: 24.99, name: "Zodiac: Pisces"},
};
const TABLE_NAMES = {"l_brz": "Bronze", "l_slv": "Silver", "l_gld": "Gold", "l_rgd": "Rose Gold", "l_plt": "Platinum", "l_sap": "Sapphire", "l_emr": "Emerald", "l_rby": "Ruby", "l_ame": "Amethyst", "l_dia": "Brilliant", "l_bdi": "Black Diamond", "l_opl": "Rainbow Opal", "e_sak": "Sakura Garden", "e_ros": "Rose", "e_lol": "Tulip", "e_lot": "Lotus", "e_pax": "Cotton (Rishtan)", "e_orx": "Orchid", "e_kun": "Sunflower", "e_atl": "Atlas Silk", "e_smq": "Samarkand", "e_mal": "Malachite", "e_laz": "Lapis Lazuli", "e_prl": "Pearl", "e_muz": "Ice Crystal", "e_drg": "Dragon Scale", "e_olv": "Fire", "e_kos": "Cosmos", "e_qah": "Amber", "e_tov": "Peacock"};
// Premium table frames (real-money option; the same tables can also be bought in-game with cash or gems)
// VIP horror collection (sold only in the VIP window, rotated weekly in the client): 64 cues, 24 of them with a matching table, every one with a scary avatar frame
const HOR_NAMES = ["Vampire", "Zombie", "Skeleton", "Ghost", "Witch", "Werewolf", "Mummy", "Frankenstein", "Black Cat", "Graveyard", "Devil", "Raven", "Blood Moon", "Devil's Eye", "Wild Spirit", "Skull", "Scream", "Dark Forest", "Queen of Darkness", "Nightmare", "Gargoyle", "Storm Ghost", "Night Hunter", "Curse", "Ashes", "Venom", "Executioner", "Necromancer", "Serpent", "Spider", "Beast", "Fog",
  "Dracula", "Coffin", "Ghoul", "Pumpkin King", "Banshee", "Candle Spirit", "Black Knight", "Head Hunter", "Zombie Hand", "Bloodthirst", "Rotten", "Bone King", "Shadow Hunter", "Witch Cauldron", "Genie", "Alvasti", "Poison Potion", "Wolf King", "Bat King", "Witch Hat", "Angel of Death", "Blood Fangs", "Mountain Ghost", "Ship Ghost", "Deep Horror", "Lantern Spirit", "Black Bonfire", "Executioner Axe", "Mystery Mask", "The Noose", "Weeping Spirit", "Last Nightmare"];
const HOR_USD = [4.99, 6.99, 9.99, 12.99, 14.99, 19.99, 24.99, 29.99], HOR_TABLES = new Set([0, 3, 5, 8, 11, 13, 16, 19, 21, 24, 27, 29, 33, 35, 37, 40, 43, 45, 48, 51, 53, 56, 59, 61]);
HOR_NAMES.forEach((nm, i) => { const usd = HOR_USD[i % 8], items = {cues: ["vh_" + i], pframes: ["vf_" + i], sboxes: 1 + (i % 3)}; if (HOR_TABLES.has(i)) items.tables = ["vt_" + i];
  SKUS["hor_" + i] = {coins: Math.round(usd * 24000), cash: Math.round(usd * 14), vip: Math.round(usd * 66), items, usd, name: "VIP Horror: " + nm}; });
const TABLE_SKUS = {l_brz: 4.99, l_slv: 6.99, l_gld: 9.99, l_rgd: 11.99, l_plt: 14.99, l_sap: 17.99, l_emr: 19.99, l_rby: 21.99, l_ame: 22.99, l_dia: 34.99, l_bdi: 39.99, l_opl: 49.99, e_sak: 2.99, e_ros: 3.49, e_lol: 3.79, e_lot: 3.99, e_pax: 4.19, e_orx: 4.49, e_kun: 2.99, e_atl: 4.79, e_smq: 4.99, e_mal: 5.49, e_laz: 5.79, e_prl: 5.99, e_muz: 5.99, e_drg: 6.49, e_olv: 6.49, e_kos: 6.99, e_qah: 6.99, e_tov: 7.49};
for (const [id, usd] of Object.entries(TABLE_SKUS)) SKUS["tbl_" + id] = {items: {tables: [id]}, vip: Math.round(usd * 65), usd, name: "Table: " + TABLE_NAMES[id]};
// Limited editions: only EDITION_CAP[id] copies of these tables will ever exist; every owner gets a serial number.
const EDITION_CAP = {l_brz: 5000, l_slv: 4000, l_gld: 3000, l_rgd: 2500, l_plt: 2000, l_sap: 1500, l_emr: 1500, l_rby: 1200, l_ame: 1200, l_dia: 1000, l_bdi: 500, l_opl: 300,
  pc_brz: 5000, pc_slv: 4000, pc_gld: 3000, pc_rgd: 2500, pc_plt: 2000, pc_sap: 1500, pc_emr: 1500, pc_rby: 1200, pc_ame: 1200, pc_dia: 1000, pc_bdi: 500, pc_opl: 300,
  pf_brz: 5000, pf_slv: 4000, pf_gld: 3000, pf_rgd: 2500, pf_plt: 2000, pf_sap: 1500, pf_emr: 1500, pf_rby: 1200, pf_ame: 1200, pf_dia: 1000, pf_bdi: 500, pf_opl: 300};
const FRAME_USD = {pf_brz: 2.49, pf_slv: 3.49, pf_gld: 4.99, pf_rgd: 5.99, pf_plt: 6.99, pf_sap: 8.49, pf_emr: 9.49, pf_rby: 10.49, pf_ame: 11.49, pf_dia: 15.99, pf_bdi: 18.99, pf_opl: 22.99};
for (const [id, usd] of Object.entries(FRAME_USD)) SKUS["frame_" + id] = {items: {pframes: [id]}, vip: Math.round(usd * 65), usd, name: "Premium frame " + id.slice(3)};
// Premium cues (real-money option; also sold in-game for cash or gems)
const CUE_USD = {pc_brz: 3.99, pc_slv: 5.99, pc_gld: 8.99, pc_rgd: 10.99, pc_plt: 12.99, pc_sap: 15.99, pc_emr: 17.99, pc_rby: 19.99, pc_ame: 21.99, pc_dia: 29.99, pc_bdi: 36.99, pc_opl: 44.99};
for (const [id, usd] of Object.entries(CUE_USD)) SKUS["cue_" + id] = {items: {cues: [id]}, vip: Math.round(usd * 65), usd, name: "Premium cue " + id.slice(3)};
function claimEdition(u, id) {
  const cap = EDITION_CAP[id]; if (!cap) return {serial: 0};
  u.editions = u.editions || {};
  if (u.editions[id]) return {serial: u.editions[id], cap};
  const ed = db.meta.editions = db.meta.editions || {}, sold = ed[id] | 0;
  if (sold >= cap) return {error: "sold_out", cap};
  ed[id] = sold + 1; u.editions[id] = sold + 1; markDirty();
  return {serial: sold + 1, cap};
}
const TABLE_REFUND_CASH = 1000;
const editionsLeft = () => Object.fromEntries(Object.entries(EDITION_CAP).map(([id, cap]) => [id, {cap, sold: (db.meta.editions || {})[id] | 0}]));
const REFERRAL = {invitee: {cash: 10, coins: 5000}, inviter: {cash: 25, coins: 15000}};
const GIFT = {coins: 500};
const CITY_PRIZE = {lon: 100, syd: 200, lis: 1000, tok: 5000, veg: 20000, jak: 100000, tor: 200000, cai: 500000, dub: 1000000,
  sha: 2000000, par: 5000000, rom: 8000000, bkk: 10000000, seo: 20000000, mum: 30000000, ber: 50000000, ist: 100000000, osa: 200000000};

// ---------------------------------------------------------------- storage
const store = createStore({databaseUrl: process.env.DATABASE_URL, dataDir: DATA_DIR});
let db = {users: {}, codes: {}, purchases: {}, meta: {}, clubs: {}};
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
    country: u.country || "", league: u.league || 0, tbl: u.tbl || "", tblNo: u.tbl && u.editions ? u.editions[u.tbl] || 0 : 0, weekWon: u.week === curWeek() ? u.weekWon || 0 : 0,
    club: u.club && db.clubs[u.club] ? db.clubs[u.club].name : "",
    online: clients.has(u.id) && !(u.prefs && u.prefs.showOnline === false), lastSeen: u.lastSeen};
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
  // clubs: members of the three best clubs of the week get cash
  const clubRank = Object.values(db.clubs).map(c => ({c, score: c.members.reduce((a, id) => a + (db.users[id] && db.users[id].week === prev ? db.users[id].weekWon || 0 : 0), 0)}))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  clubRank.slice(0, CLUB_PRIZES.length).forEach((x, i) => x.c.members.forEach(id => db.users[id] && grant(db.users[id], {cash: CLUB_PRIZES[i], coins: 0, kind: "club", from: x.c.name})));
  clubRank.forEach((x, i) => { x.c.lastWeek = {rank: i + 1, score: x.score}; x.c.league = Math.min(6, Math.floor(Math.log10(x.score + 1) / 1.4)); });
  state.lastWeek = {week: prev, top: played.slice(0, 20).map(u => ({name: u.name, avatar: u.avatar, frame: u.frame || 0, country: u.country || "", level: u.level, won: u.weekWon}))};
  state.week = curWeek();
  lbCache.clear(); markDirty();
  console.log(`week ${prev} closed: ${played.length} players ranked`);
}
setInterval(rollWeek, 60000);
function grant(u, g) { (u.grants = u.grants || []).push({...g, at: Date.now()}); markDirty(); }
const CLUB_MAX = 50, CLUB_LEVEL = 6, CLUB_PRIZES = [50, 25, 10];
function clubScore(c) { const w = curWeek(); return c.members.reduce((a, id) => a + (db.users[id] && db.users[id].week === w ? db.users[id].weekWon || 0 : 0), 0); }
function clubInfo(c) { return {id: c.id, name: c.name, badge: c.badge || 0, color: c.color || 0, members: c.members.length, score: clubScore(c), league: c.league || 0}; }
function clubSay(c, u, text) {
  (c.chat = c.chat || []).push(u ? {from: u.id, name: u.name, avatar: u.avatar, text, at: Date.now()} : {sys: true, text, at: Date.now()});
  if (c.chat.length > 80) c.chat.splice(0, c.chat.length - 80);
}

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
const recoverTries = new Map();
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
  // ICE servers for voice chat: public STUN always, plus your own TURN relay when TURN_URLS is set (needed for some mobile networks)
  "GET /api/ice": () => {
    const iceServers = [{urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}];
    if (process.env.TURN_URLS) iceServers.push({urls: process.env.TURN_URLS.split(",").map(x => x.trim()), username: process.env.TURN_USER || "", credential: process.env.TURN_PASS || ""});
    return {iceServers};
  },
  "GET /api/skus": () => ({skus: SKUS, payments: !!STRIPE_KEY, referral: REFERRAL}),
  "GET /api/editions": () => editionsLeft(),
  async "POST /api/editions/claim"(req, u) {
    if (limited(req, "ed", 30)) return [429, {error: "slow_down"}];
    const b = await jsonBody(req), id = String(b.id || "");
    if (!EDITION_CAP[id]) return [400, {error: "not_limited"}];
    const r = claimEdition(u, id);
    return r.error ? [409, {error: r.error, ...editionsLeft()[id]}] : {id, serial: r.serial, cap: r.cap};
  },
  // real matches in progress, for the Live screen (optionally filtered by the players' country)
  "GET /api/live": req => {
    const cc = (new URL(req.url, "http://x").searchParams.get("country") || "").toUpperCase().slice(0, 2);
    const list = [];
    for (const r of rooms.values()) {
      if (r.over || !r.p[0] || !r.p[1]) continue;
      const p = r.p.map(s => ({name: s.profile.name, avatar: s.profile.avatar, frame: s.profile.frame, country: s.profile.country, level: s.profile.level}));
      if (cc && !p.some(x => (x.country || "").toUpperCase() === cc)) continue;
      list.push({room: r.id, city: r.city, started: r.startedAt, specs: r.specs.size, p});
    }
    list.sort((a, b) => b.specs - a.specs || a.started - b.started);
    const countries = {}; for (const r of rooms.values()) if (!r.over) for (const s of r.p) { const c = (s.profile.country || "").toUpperCase(); if (c) countries[c] = (countries[c] || 0) + 1; }
    return {live: list.slice(0, 50), total: list.length, countries};
  },
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
    if (b.tbl !== undefined) u.tbl = /^[a-z]_[a-z]{3}$/.test(String(b.tbl)) ? String(b.tbl) : "";   // equipped exclusive table (badge)
    // Showdown event points (weekly): the device reports this week's total, the server keeps the highest value
    if (b.sd && b.sd.week === curWeek()) { if (u.sdWeek !== curWeek()) { u.sdWeek = curWeek(); u.sdPts = 0; } u.sdPts = Math.max(u.sdPts || 0, int(b.sd.pts, 1e7)); lbCache.clear(); }
    if (b.prefs && typeof b.prefs === "object") u.prefs = {allowFriend: b.prefs.allowFriend !== false, showOnline: b.prefs.showOnline !== false};
    if (u.week !== curWeek()) { u.week = curWeek(); u.weekWon = 0; }
    const grants = u.grants || []; u.grants = [];
    markDirty();
    return {me: publicUser(u), grants, inbox: u.inbox || [], referredBy: u.referredBy, referrals: u.referrals.length, lastWeek: u.lastWeek || null, bought: u.bought || {}};
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
    if (f.prefs && f.prefs.allowFriend === false && !f.friends.includes(u.id)) return [403, {error: "friends_closed"}];
    if (u.friends.length >= 500) return [400, {error: "too_many"}];
    if (!u.friends.includes(fid)) u.friends.push(fid);
    if (!f.friends.includes(u.id)) f.friends.push(u.id);
    markDirty();
    return {ok: true, friend: publicUser(f)};
  },
  // ---------------- cloud save: the whole game progress, so a player keeps it on a new phone or browser
  async "POST /api/save"(req, u) {
    const raw = (await readBody(req, 256 * 1024)).toString("utf8");
    let b; try { b = JSON.parse(raw); } catch (e) { return [400, {error: "bad_json"}]; }
    if (!b.save || typeof b.save !== "object") return [400, {error: "no_save"}];
    const at = int(b.save.savedAt);
    if (u.save && at < (u.saveAt || 0)) return {ok: false, newer: true, savedAt: u.saveAt};   // never overwrite a newer save
    u.save = b.save; u.saveAt = at || Date.now(); markDirty();
    return {ok: true, savedAt: u.saveAt};
  },
  "GET /api/save"(req, u) { return {save: u.save || null, savedAt: u.saveAt || 0}; },
  // a recovery key lets the player sign in to the same account on another device (ID code + key)
  async "POST /api/recovery/key"(req, u) {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let k = ""; for (let i = 0; i < 10; i++) k += A[crypto.randomInt(A.length)];
    u.rkey = crypto.createHash("sha256").update(u.id + ":" + k).digest("hex"); markDirty();
    return {key: k.slice(0, 5) + "-" + k.slice(5)};
  },
  async "POST /api/recover"(req) {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const t = recoverTries.get(ip) || {n: 0, at: Date.now()};
    if (Date.now() - t.at > 3600e3) { t.n = 0; t.at = Date.now(); }
    if (++t.n > 10) { recoverTries.set(ip, t); return [429, {error: "too_many"}]; }
    recoverTries.set(ip, t);
    const b = await jsonBody(req), id = db.codes[String(b.code || "").toUpperCase().trim()], u = id && db.users[id];
    const key = String(b.key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!u || !u.rkey || crypto.createHash("sha256").update(u.id + ":" + key).digest("hex") !== u.rkey) return [403, {error: "bad_key"}];
    return {id: u.id, token: u.token, code: u.code, save: u.save || null, savedAt: u.saveAt || 0};
  },
  "GET /api/friends/suggested"(req, u) {
    const now = Date.now();
    const list = Object.values(db.users).filter(x => x.id !== u.id && !u.friends.includes(x.id) && !(x.prefs && x.prefs.allowFriend === false))
      .sort((a, b) => (clients.has(b.id) - clients.has(a.id)) || (b.lastSeen || 0) - (a.lastSeen || 0) || ((b.country === u.country) - (a.country === u.country)))
      .slice(0, 20).map(x => ({...publicUser(x), ago: x.lastSeen ? now - x.lastSeen : null}));
    return {players: list};
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
  async "POST /api/inbox/clear"(req, u) { const b = await jsonBody(req); u.inbox = b.kind ? (u.inbox || []).filter(m => m.kind !== b.kind) : []; markDirty(); return {ok: true}; },
  // challenge a friend: the friend gets an inbox message (and a live ping when online) with a private lobby code
  async "POST /api/challenge"(req, u) {
    const b = await jsonBody(req), f = db.users[String(b.to || "")];
    if (!f) return [404, {error: "not_found"}];
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8), city = String(b.city || "lon").slice(0, 8);
    if (code.length < 4) return [400, {error: "bad_code"}];
    f.inbox = (f.inbox || []).filter(m => !(m.kind === "challenge" && m.fromId === u.id)).slice(-50);
    f.inbox.push({kind: "challenge", fromId: u.id, from: u.name, avatar: u.avatar, code, city, at: Date.now()});
    wsSend(clients.get(f.id), {t: "challenge", from: u.name, code, city});
    markDirty();
    return {ok: true};
  },

  // ?scope=world | country | friends | league   — ranked by this week's winnings
  // ---------------- clubs: unlocked at level 6, up to 50 members, ranked by the members' weekly winnings
  "GET /api/clubs"(req, u) {
    const q = new URL(req.url, "http://x").searchParams.get("q") || "";
    let list = Object.values(db.clubs);
    if (q) list = list.filter(c => c.name.toLowerCase().includes(q.toLowerCase().slice(0, 20)));
    return {clubs: list.map(clubInfo).sort((a, b) => b.score - a.score || b.members - a.members).slice(0, 60), mine: u.club || null, max: CLUB_MAX, minLevel: CLUB_LEVEL};
  },
  "GET /api/clubs/mine"(req, u) {
    const c = db.clubs[u.club]; if (!c) return {club: null};
    const members = c.members.map(id => db.users[id]).filter(Boolean).map(m => ({...publicUser(m), role: m.id === c.owner ? "owner" : "member"}))
      .sort((a, b) => b.weekWon - a.weekWon);
    return {club: {...clubInfo(c), desc: c.desc || "", owner: c.owner, lastWeek: c.lastWeek || null}, members, chat: (c.chat || []).slice(-50), prizes: CLUB_PRIZES};
  },
  async "POST /api/clubs/create"(req, u) {
    const b = await jsonBody(req);
    if ((u.level || 1) < CLUB_LEVEL) return [403, {error: "level"}];
    if (u.club && db.clubs[u.club]) return [400, {error: "in_club"}];
    const name = String(b.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
    if (name.length < 3) return [400, {error: "name"}];
    if (Object.values(db.clubs).some(c => c.name.toLowerCase() === name.toLowerCase())) return [400, {error: "name_taken"}];
    const id = "k" + crypto.randomBytes(6).toString("hex");
    db.clubs[id] = {id, name, badge: int(b.badge, 23), color: int(b.color, 7), desc: String(b.desc || "").replace(/[<>]/g, "").slice(0, 80), owner: u.id, members: [u.id], created: Date.now(), chat: [], league: 0};
    u.club = id; markDirty();
    return {ok: true, club: clubInfo(db.clubs[id])};
  },
  async "POST /api/clubs/join"(req, u) {
    const b = await jsonBody(req), c = db.clubs[String(b.id || "")];
    if (!c) return [404, {error: "not_found"}];
    if ((u.level || 1) < CLUB_LEVEL) return [403, {error: "level"}];
    if (u.club && db.clubs[u.club]) return [400, {error: "in_club"}];
    if (c.members.length >= CLUB_MAX) return [400, {error: "full"}];
    c.members.push(u.id); u.club = c.id; clubSay(c, null, "join:" + u.name); markDirty();
    return {ok: true};
  },
  async "POST /api/clubs/leave"(req, u) {
    const c = db.clubs[u.club]; u.club = null;
    if (c) {
      c.members = c.members.filter(id => id !== u.id);
      if (!c.members.length) delete db.clubs[c.id];
      else { if (c.owner === u.id) c.owner = c.members[0]; clubSay(c, null, "leave:" + u.name); }
    }
    markDirty();
    return {ok: true};
  },
  async "POST /api/clubs/chat"(req, u) {
    const b = await jsonBody(req), c = db.clubs[u.club];
    if (!c) return [400, {error: "no_club"}];
    const text = String(b.text || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 140);
    if (!text) return [400, {error: "empty"}];
    if (Date.now() - (u.lastChat || 0) < 1500) return [429, {error: "slow"}];
    u.lastChat = Date.now(); clubSay(c, u, text); markDirty();
    return {ok: true, chat: c.chat.slice(-50)};
  },
  "GET /api/leaderboard"(req, u) {
    const scope = new URL(req.url, "http://x").searchParams.get("scope") || "world";
    const lg = u.league || 0, cc = u.country || "";
    if (scope === "showdown") {
      const w = curWeek(), pts = x => x.sdWeek === w ? x.sdPts || 0 : 0;
      const c = lbCache.get("sd"); let list;
      if (c && Date.now() - c.at < 20000) list = c.list;
      else { list = Object.values(db.users).filter(x => pts(x) > 0 || x.id === u.id).sort((a, b) => pts(b) - pts(a)); lbCache.set("sd", {at: Date.now(), list}); }
      if (!list.includes(u)) list = [...list, u];
      const rank = list.indexOf(u);
      const row = x => ({...publicUser(x), sd: pts(x)});
      return {scope, week: w, endsAt: weekEndsAt(), top: list.slice(0, 100).map(row), me: {...row(u), rank: rank + 1}, total: list.length};
    }
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
    if (sku.once && (u.bought || {})[b.sku]) return [400, {error: "already_bought"}];
    const tid = sku.items && ((sku.items.tables || sku.items.cues || sku.items.pframes || [])[0]);
    if (tid && EDITION_CAP[tid] && !(u.editions || {})[tid] && ((db.meta.editions || {})[tid] | 0) >= EDITION_CAP[tid]) return [409, {error: "sold_out"}];
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
      let items = sku.items || null, refund = 0;
      const tid = items && ((items.tables || items.cues || items.pframes || [])[0]);
      if (tid && EDITION_CAP[tid]) {               // the serial is handed out when the payment arrives
        const r = claimEdition(u, tid);
        if (r.error) { items = null; refund = TABLE_REFUND_CASH; }   // sold out between checkout and payment: cash instead
        else items = {...items, serials: {[tid]: r.serial}};
      }
      grant(u, {cash: (sku.cash || 0) + refund, coins: sku.coins || 0, gems: sku.gems || 0, vip: sku.vip || 0, items, kind: "purchase", from: sku.name});
      const skuId = s.metadata.sku; u.bought = {...(u.bought || {}), [skuId]: (u.bought && u.bought[skuId] || 0) + 1};
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
      if (!["GET /api/health", "GET /api/skus", "GET /api/online", "GET /api/editions", "POST /api/register", "POST /api/recover"].includes(key)) {
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
const RELAY = new Set(["aim", "shot", "state", "chat", "place", "spin", "rtc"]);
const specCount = room => { const msg = {t: "specs", n: room.specs.size}; for (const p of room.p) wsSend(p, msg); for (const sp of room.specs) wsSend(sp, msg); };   // everyone in the room sees how many people are watching
const SPEC_FWD = new Set(["aim", "shot", "state", "place", "spin"]);   // what spectators get (no voice signalling, no chat)
function bucket(ws, key, max, perMs) {   // small token bucket per socket
  const now = Date.now(), b = ws.bk || (ws.bk = {}), x = b[key] || (b[key] = {n: max, t: now});
  x.n = Math.min(max, x.n + (now - x.t) / perMs); x.t = now;
  if (x.n < 1) return false; x.n -= 1; return true;
}

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
  for (const sp of room.specs) { wsSend(sp, {t: "specEnd", winner: winnerSeat, reason}); sp.spec = null; }
  room.specs.clear();
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
      const code = m.code ? String(m.code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) : "";
      ws.profile = {name: u.name, avatar: u.avatar, frame: u.frame || 0, country: u.country || "", level: u.level, cue: String(m.cue || "start").slice(0, 16), tbl: String(m.tbl || "").slice(0, 8), tblNo: (u.editions || {})[String(m.tbl || "")] || 0, code: u.code};
      const qk = code ? "code:" + code : city;
      const q = queues.get(qk) || []; queues.set(qk, q);
      const opp = q.find(o => o.uid !== ws.uid && o.readyState === 1);
      if (!opp) { if (code && m.join) return wsSend(ws, {t: "nocode"}); q.push(ws); return wsSend(ws, {t: "queued", city, waiting: q.length}); }
      q.splice(q.indexOf(opp), 1);
      const first = crypto.randomInt(2);
      const room = {id: crypto.randomUUID(), city, p: [opp, ws], seed: crypto.randomInt(2 ** 31), over: false, reports: {}, specs: new Set(), startedAt: Date.now(), first, last: null};
      rooms.set(room.id, room);
      room.p.forEach((s, seat) => { s.room = room; s.seat = seat; });
      room.p.forEach((s, seat) => wsSend(s, {t: "match", room: room.id, seat, first, seed: room.seed, city, opp: room.p[1 - seat].profile}));
    } else if (m.t === "cancel") {
      leaveQueue(ws);
    } else if (m.t === "spectate") {
      if (ws.room) return;
      if (ws.spec) { ws.spec.specs.delete(ws); ws.spec = null; }
      const room = rooms.get(String(m.room || ""));
      if (!room || room.over || room.specs.size >= 200) return wsSend(ws, {t: "nospec"});
      room.specs.add(ws); ws.spec = room;
      specCount(room);
      wsSend(ws, {t: "spec", room: room.id, seed: room.seed, first: room.first, city: room.city, p: room.p.map(s => { const {code, ...r} = s.profile; return r; }), state: room.last, specs: room.specs.size});
    } else if (m.t === "unspec") {
      if (ws.spec) { const r = ws.spec; r.specs.delete(ws); ws.spec = null; specCount(r); }
    } else if (m.t === "schat" && ws.spec && !ws.spec.over) {   // a spectator writes to the players and the other spectators
      if (!bucket(ws, "schat", 4, 4000)) return;
      const msg = String(m.msg || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60); if (!msg) return;
      const room = ws.spec, out = {t: "schat", name: String(u.name || "Player").slice(0, 16), country: u.country || "", msg};
      for (const p of room.p) wsSend(p, out); for (const sp of room.specs) wsSend(sp, out);
    } else if (RELAY.has(m.t) && ws.room && !ws.room.over) {
      const room = ws.room, other = room.p[1 - ws.seat];
      if (m.t === "chat") {
        if (!bucket(ws, "chat", 6, 1500)) return;
        m.msg = String(m.msg || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40); if (!m.msg) return;
      } else if (m.t === "rtc") {
        if (!bucket(ws, "rtc", 60, 500)) return;
        m = {t: "rtc", k: String(m.k || "").slice(0, 12), d: m.d && typeof m.d === "object" ? m.d : null};
      }
      const out = {...m, from: ws.seat};
      if (m.t === "state") room.last = out;
      wsSend(other, out);
      if (SPEC_FWD.has(m.t) && room.specs.size) for (const sp of room.specs) wsSend(sp, out);
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
    if (ws.spec) { const r = ws.spec; r.specs.delete(ws); ws.spec = null; specCount(r); }
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
  if (loaded) db = Object.assign({users: {}, codes: {}, purchases: {}, meta: {}, clubs: {}}, loaded);
  db.meta = db.meta || {}; db.clubs = db.clubs || {};
  rollWeek();
  server.listen(PORT, () => console.log(`Bilyard 8 server on :${PORT} (storage ${store.kind}, ${Object.keys(db.users).length} players, payments ${STRIPE_KEY ? "ON" : "off"})`));
}).catch(e => { console.error("Could not load the database:", e.message); process.exit(1); });
