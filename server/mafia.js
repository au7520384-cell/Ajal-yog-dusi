"use strict";
// MAFIA (Werewolf) rules as a pure state machine: no sockets, no clock of its own. The server (server.js, "board game rooms") owns one `g` per room, calls act(g, seat, action, now) for a phone's
// action and tick(g, now) when a phase runs out, and sends view(g, seat) to each seat. The roles live ONLY here: view() never hands a seat anything it may not know (its own role, the other mafia
// for a mafia, the sheriff's own findings, who is dead and what they were; every role at the end).
// A game: seats 0..n-1 (5..8), roles dealt at random: 1 mafia for 5, 2 for 6-7, 3 for 8, one doctor, one sheriff, the rest citizens.
// Phases: reveal (everyone sees the role) -> night (the mafia choose a victim, the doctor a person to save, the sheriff a person to check) -> day (talk, voice open) -> vote (everybody names one person or none)
// -> night ... until the mafia are gone (town wins) or are as many as the others (mafia win). A night with no kill, or a kill the doctor saved, is "nobody died". A vote with a tie sends nobody out.
const ROLES = ["mafia", "doctor", "sheriff", "citizen"];
const TIMES = {reveal: 8000, night: 35000, day: 60000, vote: 30000};   // ms
const MIN = {night: 9000, day: 12000, vote: 4000};   // a phase never ends sooner than this when everybody has acted (a fast night would tell the town that nobody special is left)
const mafiaCount = n => n >= 8 ? 3 : n >= 6 ? 2 : 1;
const rolesFor = n => [...Array(mafiaCount(n)).fill("mafia"), "doctor", "sheriff", ...Array(n - mafiaCount(n) - 2).fill("citizen")];
const shuffle = (a, rnd) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function create(n, bots, opts = {}) {   // n seats (5..8), bots: [bool x n] (a bot's seat is played by bot(), it never waits for a phone)
  if (!(n >= 5 && n <= 8)) throw new Error("mafia needs 5 to 8 seats");
  const rnd = opts.rnd || Math.random, now = opts.now || Date.now(), t = Object.assign({}, TIMES, opts.times || {}), mn = Object.assign({}, MIN, opts.min || {});
  const g = {n, rnd, t, mn, role: shuffle(rolesFor(n), rnd), bot: Array.from({length: n}, (_, i) => !!(bots && bots[i])), alive: Array(n).fill(true), phase: "reveal", day: 0, until: now + t.reveal, minAt: 0,
    acts: {}, ready: {}, votes: {}, found: [], lastSave: -1, log: [], over: null, rev: 0, dead: {}};   // dead: seat -> role (public once a seat is out)
  return g;
}
const alive = g => g.alive.map((a, i) => a ? i : -1).filter(i => i >= 0);
const need = role => role === "mafia" ? "kill" : role === "doctor" ? "save" : role === "sheriff" ? "check" : "";
const actors = g => alive(g).filter(i => g.phase === "night" ? !!need(g.role[i]) : true);
const winner = g => { const m = alive(g).filter(i => g.role[i] === "mafia").length, o = alive(g).length - m; return m === 0 ? "town" : m >= o ? "mafia" : ""; };
function enter(g, phase, now) {
  g.phase = phase; g.rev++; g.acts = {}; g.ready = {}; g.votes = {}; g.until = now + g.t[phase]; g.minAt = now + (g.mn[phase] || 0);
  if (phase === "day") for (const i of alive(g)) if (g.bot[i]) g.ready[i] = true;   // (a bot is always ready to vote)
}
function finish(g, who, now) { g.over = {winner: who}; g.phase = "over"; g.until = 0; g.rev++; g.log.push({d: g.day, k: "over", winner: who}); }
function die(g, seat) { g.alive[seat] = false; g.dead[seat] = g.role[seat]; }
function start(g, now) { enter(g, "reveal", now); }
function night(g, now) {   // the night is over: kill, save, check
  const picks = {}; for (const i of alive(g)) if (g.role[i] === "mafia" && g.acts[i] !== undefined) picks[g.acts[i]] = (picks[g.acts[i]] || 0) + 1;
  const top = Math.max(0, ...Object.values(picks)), tied = Object.keys(picks).filter(k => picks[k] === top).map(Number);
  const victim = tied.length ? tied[Math.floor(g.rnd() * tied.length)] : -1;
  const doc = alive(g).find(i => g.role[i] === "doctor"), saved = doc !== undefined && g.acts[doc] !== undefined ? g.acts[doc] : -1;
  const sh = alive(g).find(i => g.role[i] === "sheriff"); if (sh !== undefined && g.acts[sh] !== undefined) g.found.push({seat: g.acts[sh], mafia: g.role[g.acts[sh]] === "mafia", d: g.day});
  g.lastSave = saved;
  if (victim >= 0 && victim !== saved) { die(g, victim); g.log.push({d: g.day, k: "died", seat: victim, role: g.role[victim]}); } else g.log.push({d: g.day, k: "none"});
  const w = winner(g); if (w) return finish(g, w, now); enter(g, "day", now);
}
function vote(g, now) {   // the vote is over
  const c = {}; for (const [v, to] of Object.entries(g.votes)) if (to >= 0 && g.alive[v]) c[to] = (c[to] || 0) + 1;
  const top = Math.max(0, ...Object.values(c)), lead = Object.keys(c).filter(k => c[k] === top).map(Number);
  if (top > 0 && lead.length === 1) { die(g, lead[0]); g.log.push({d: g.day, k: "out", seat: lead[0], role: g.role[lead[0]], votes: top}); } else g.log.push({d: g.day, k: "tie"});
  const w = winner(g); if (w) return finish(g, w, now); g.day++; enter(g, "night", now);
}
function advance(g, now) {
  if (g.over) return;
  if (g.phase === "reveal") { g.day = 1; enter(g, "night", now); }
  else if (g.phase === "night") night(g, now);
  else if (g.phase === "day") enter(g, "vote", now);
  else if (g.phase === "vote") vote(g, now);
}
function tick(g, now) { let n = 0; while (!g.over && now >= g.until && n++ < 6) advance(g, g.until); return g; }   // (a long pause runs the phases that were due one after another, each from its own end time)
function maybeEarly(g, now) {   // everybody who has a part in this phase has acted: it ends soon (not before its minimum)
  if (g.over || !["night", "day", "vote"].includes(g.phase)) return;
  const done = actors(g).every(i => g.phase === "night" ? g.acts[i] !== undefined : g.phase === "day" ? g.ready[i] : g.votes[i] !== undefined);
  if (done) g.until = Math.min(g.until, Math.max(now + 700, g.minAt));
}
function act(g, seat, a, now) {   // a: {k: "kill" | "save" | "check" | "vote" | "ready", to}; true when it was taken
  if (g.over || !Number.isInteger(seat) || seat < 0 || seat >= g.n || !g.alive[seat] || !a || typeof a !== "object") return false;
  const k = String(a.k || ""), to = a.to === undefined || a.to === null ? -1 : a.to;
  if (g.phase === "night") {
    if (k !== need(g.role[seat]) || !Number.isInteger(to) || to < 0 || to >= g.n || !g.alive[to]) return false;
    if (k === "kill" && g.role[to] === "mafia") return false;
    if (k === "check" && (to === seat || g.found.some(f => f.seat === to))) return false;
    if (k === "save" && to === g.lastSave) return false;   // (the same person two nights in a row: no)
    g.acts[seat] = to;
  } else if (g.phase === "day") { if (k !== "ready") return false; g.ready[seat] = true; }
  else if (g.phase === "vote") {
    if (k !== "vote" || !Number.isInteger(to) || to < -1 || to >= g.n || (to >= 0 && (!g.alive[to] || to === seat))) return false;
    g.votes[seat] = to;
  } else return false;
  g.rev++; maybeEarly(g, now); return true;
}
function bot(g, seat) {   // what a bot does now: an action for act(), or null
  if (g.over || !g.alive[seat] || !g.bot[seat]) return null;
  const al = alive(g), r = g.rnd, pick = a => a[Math.floor(r() * a.length)], role = g.role[seat];
  if (g.phase === "night") {
    if (g.acts[seat] !== undefined) return null;   // (it has acted)
    if (role === "mafia") { const mates = al.filter(i => g.role[i] === "mafia" && i !== seat && g.acts[i] !== undefined).map(i => g.acts[i]), pool = al.filter(i => g.role[i] !== "mafia"); return pool.length ? {k: "kill", to: mates.length && r() < 0.8 ? mates[0] : pick(pool)} : null; }
    if (role === "doctor") { const pool = al.filter(i => i !== g.lastSave); return pool.length ? {k: "save", to: pick(pool)} : null; }
    if (role === "sheriff") { const pool = al.filter(i => i !== seat && !g.found.some(f => f.seat === i)); return pool.length ? {k: "check", to: pick(pool)} : null; }
    return null;
  }
  if (g.phase === "day") return g.ready[seat] ? null : {k: "ready"};
  if (g.phase === "vote") {
    if (g.votes[seat] !== undefined) return null;
    const others = al.filter(i => i !== seat);
    if (role === "sheriff") { const m = g.found.find(f => f.mafia && g.alive[f.seat]); if (m) return {k: "vote", to: m.seat}; }
    if (role === "mafia") { const pool = others.filter(i => g.role[i] !== "mafia"); return {k: "vote", to: pool.length ? pick(pool) : -1}; }
    const c = {}; for (const [v, to] of Object.entries(g.votes)) if (to >= 0 && +v !== seat) c[to] = (c[to] || 0) + 1;
    const lead = Object.keys(c).sort((a, b) => c[b] - c[a]).map(Number).find(i => i !== seat && g.alive[i]);
    return {k: "vote", to: r() < 0.1 ? -1 : lead !== undefined && r() < 0.55 ? lead : pick(others)};
  }
  return null;
}
function view(g, seat, now) {   // everything seat may know now
  const mine = Number.isInteger(seat) && seat >= 0 && seat < g.n, role = mine ? g.role[seat] : "", over = !!g.over;
  const v = {phase: g.phase, day: g.day, until: g.until, n: g.n, you: mine ? seat : -1, role, alive: g.alive.slice(), dead: Object.assign({}, g.dead), log: g.log.slice(-14), rev: g.rev, bot: g.bot.slice()};
  if (role === "mafia") v.mates = g.role.map((r, i) => r === "mafia" && i !== seat ? i : -1).filter(i => i >= 0);
  if (g.phase === "night" && mine && g.alive[seat]) {
    v.pick = g.acts[seat] === undefined ? -1 : g.acts[seat];
    if (role === "mafia") v.partner = Object.fromEntries(Object.entries(g.acts).filter(([i]) => +i !== seat && g.role[i] === "mafia"));   // what the other mafia have chosen
    if (role === "doctor") v.lastSave = g.lastSave;
  }
  if (role === "sheriff") v.found = g.found.slice();
  if (g.phase === "day") { v.ready = mine && !!g.ready[seat]; v.readyN = alive(g).filter(i => g.ready[i]).length; }
  if (g.phase === "vote") { v.votes = Object.assign({}, g.votes); v.pick = mine && g.votes[seat] !== undefined ? g.votes[seat] : -2; }
  if (over) { v.roles = g.role.slice(); v.winner = g.over.winner; }
  return v;
}
module.exports = {ROLES, TIMES, MIN, mafiaCount, rolesFor, create, start, act, tick, advance, bot, view, alive, winner};
