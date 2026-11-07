"use strict";
// Planning for the game channel's auto-poster as pure functions: no network, no clock, no database.
// server.js owns the state object (db.meta.chan) and does the sending; test_chan_plan.js runs months of simulated days against these functions.
//
// A day has N slots (default 3: morning / afternoon / evening, Tashkent time). Each slot has a kind of post:
//   slot 0 "feat" (a feature promo, often with a game screenshot), slot 1 "quiz" (a Telegram quiz poll), the last slot rotates "city" (one of the 30 tables) / "shop" / "tip" / "poll" / "story".
// A "dated" post (a weekday, a date, a season change) takes the evening slot of its day. Nothing repeats until a kind's whole list has gone out (the last 3 posts and the last 2 topics are not repeated right away).
// A server that slept through some slots catches up later the same day, one post per `gap`, until the day's cut-off.

const TZ = 5 * 3600e3;   // Tashkent = UTC+5, no daylight saving
const DAY = 864e5;
const pad = n => String(n).padStart(2, "0");

const DEFAULT_SLOTS = {1: ["19:30"], 2: ["12:00", "20:30"], 3: ["10:00", "14:00", "20:30"], 4: ["09:30", "13:00", "17:00", "20:30"], 5: ["09:30", "12:30", "15:30", "18:30", "21:00"], 6: ["09:30", "12:00", "14:30", "17:30", "20:00", "21:30"]};
const EVENING = ["city", "shop", "tip", "city", "poll", "shop", "story", "tip"];   // the last slot of the day, in turn (8 days)
const EVENING2 = ["quiz", "city", "shop", "quiz", "tip", "poll", "quiz", "story"];  // two posts a day: the second one also brings the quizzes
const EXTRA = ["quiz", "feat", "poll", "shop"];                                      // the middle slots when there are 4+ a day
const FALLBACK = ["feat", "quiz", "city", "shop", "tip", "poll", "story"];          // when a kind has no post at all
const CATS = ["feat", "quiz", "city", "shop", "tip", "poll", "story", "dated"];

function localDay(now) {   // the calendar day in Tashkent: key "2026-11-01", n = day number, start = its midnight (UTC ms), dow 1 = Monday ... 7 = Sunday
  const n = Math.floor((now + TZ) / DAY), d = new Date(n * DAY);
  return {key: d.toISOString().slice(0, 10), n, start: n * DAY - TZ, dow: ((d.getUTCDay() + 6) % 7) + 1, dom: d.getUTCDate(), month: d.getUTCMonth() + 1, md: pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate())};
}
function parseHM(s, dflt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? "" : s).trim()); if (!m) return dflt;
  const h = +m[1], mi = +m[2]; return h > 23 || mi > 59 ? dflt : h * 60 + mi;
}
function options(env) {   // CHAN_SLOTS="10:00,14:00,20:30" or CHAN_PER_DAY=3 (1-6), CHAN_JITTER_MIN, CHAN_GAP_MIN, CHAN_END, CHAN_MAX_DAY, CHAN_SILENT
  const e = env || {}, num = (v, d) => (v !== undefined && v !== "" && isFinite(+v) ? +v : d);
  let slots = e.CHAN_SLOTS ? String(e.CHAN_SLOTS).split(/[,\s;]+/).map(s => parseHM(s, -1)).filter(m => m >= 0) : [];
  if (!slots.length) slots = DEFAULT_SLOTS[Math.max(1, Math.min(6, Math.round(num(e.CHAN_PER_DAY, 3))))].map(s => parseHM(s, 600));
  slots = [...new Set(slots)].sort((a, b) => a - b).slice(0, 8);
  return {slots, jitter: Math.max(0, Math.min(25, num(e.CHAN_JITTER_MIN, 15))), gap: Math.max(0, num(e.CHAN_GAP_MIN, 45)) * 60e3, end: parseHM(e.CHAN_END, 22 * 60 + 45),
    max: Math.max(slots.length, Math.round(num(e.CHAN_MAX_DAY, slots.length + 2))), silent: !/^(0|false|no)$/i.test(String(e.CHAN_SILENT || "1"))};
}
function hash01(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
function slotTimes(day, slots, jitter) {   // absolute times of today's slots; the small jitter of each is fixed by the date, so a restart does not move it
  return slots.map((m, i) => day.start + (m + Math.round((hash01(day.key + "#" + i) * 2 - 1) * jitter)) * 60e3);
}
function due(c, now, o) {   // is a slot due right now? {slot, day} or null. Starts a new day in the state when the date changed.
  const day = localDay(now);
  if (c.day !== day.key) { c.day = day.key; c.done = []; c.today = 0; }
  c.done = c.done || []; c.today = c.today | 0;
  if (now > day.start + o.end * 60e3) return null;                  // past the day's cut-off: the slots that are left are dropped
  if (c.today >= o.max || now - (c.last || 0) < o.gap) return null;
  const times = slotTimes(day, o.slots, o.jitter);
  for (let i = 0; i < times.length; i++) if (!c.done.includes(i) && now >= times[i]) return {slot: i, day, at: times[i]};
  return null;
}
function baseCat(dayN, slot, n) {
  if (n === 1) return FALLBACK[dayN % FALLBACK.length];
  if (slot === 0) return "feat";
  if (n === 2) return EVENING2[dayN % EVENING2.length];
  if (slot === 1) return "quiz";
  if (slot === n - 1) return EVENING[dayN % EVENING.length];
  return EXTRA[(dayN + slot) % EXTRA.length];
}

// ---- which post
function inRange(md, a, b) { return a <= b ? md >= a && md <= b : md >= a || md <= b; }
function whenOk(w, day, slot, n, regular) {   // w: {dow: [1..7], dom: [..], md: ["12-31"], range: ["12-25", "01-02"], from/to: "2026-11-27", slot: 0 | "last" | "any"}
  if (!w) return true;
  if (w.dow && !w.dow.includes(day.dow)) return false;
  if (w.dom && !w.dom.includes(day.dom)) return false;
  if (w.md && !w.md.includes(day.md)) return false;
  if (w.range && !inRange(day.md, w.range[0], w.range[1])) return false;
  if (w.from && day.key < w.from) return false;
  if (w.to && day.key > w.to) return false;
  const s = w.slot;
  if (s === "any") return true;
  if (s === undefined) return regular ? true : slot === n - 1;      // a dated post goes out in the evening unless it says otherwise
  return s === "last" ? slot === n - 1 : s === slot;
}
function fromCat(bank, c, cat, day, slot, n, rng) {
  const all = (bank.byCat[cat] || []).filter(it => whenOk(it.when, day, slot, n, true)); if (!all.length) return null;
  c.used = c.used || {}; c.tags = c.tags || {};
  const ids = new Set(all.map(x => x.id)); let used = c.used[cat] = (c.used[cat] || []).filter(id => ids.has(id));
  let left = all.filter(it => !used.includes(it.id));
  if (!left.length) {                                                  // the whole list has gone out: a new round; the last 3 are kept out of its start
    const recent = used.slice(-3); c.used[cat] = used = [];
    left = all.length > 3 ? all.filter(it => !recent.includes(it.id)) : all;
  }
  const last2 = (c.tags[cat] || []).slice(-2), spaced = left.filter(it => !last2.includes(it.tag)), pool = spaced.length ? spaced : left;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}
function pick(bank, c, day, slot, n, rng) {   // {item, cat} for this slot, or null when the bank is empty
  rng = rng || Math.random; c.dated = c.dated || {};
  const ds = (bank.byCat.dated || []).filter(it => whenOk(it.when, day, slot, n, false) && (!c.dated[it.id] || day.n - c.dated[it.id] >= (it.when && it.when.dow ? 21 : 300)));
  const exact = it => (it.when && (it.when.md || it.when.range || it.when.from) ? 1 : 0);          // a post of one particular date wins over a weekday post: its day does not come back
  if (ds.length) { ds.sort((a, b) => exact(b) - exact(a) || (c.dated[a.id] || -1) - (c.dated[b.id] || -1) || rng() - 0.5); return {item: ds[0], cat: "dated"}; }
  for (const cat of [baseCat(day.n, slot, n)].concat(FALLBACK)) { const it = fromCat(bank, c, cat, day, slot, n, rng); if (it) return {item: it, cat: it.cat}; }
  return null;
}
function pickKind(bank, c, cat, day, slot, n, rng) { const it = fromCat(bank, c, cat, day, slot, n, rng || Math.random); return it ? {item: it, cat: it.cat} : null; }   // a post of the kind the owner asked for
function commit(c, item, day) {   // the post went out: remember it
  if (item.cat === "dated") { (c.dated = c.dated || {})[item.id] = day.n; return; }
  c.used = c.used || {}; c.tags = c.tags || {};
  const u = c.used[item.cat] = c.used[item.cat] || []; if (!u.includes(item.id)) u.push(item.id);
  const t = c.tags[item.cat] = c.tags[item.cat] || []; t.push(item.tag || ""); if (t.length > 4) t.shift();
}
function migrate(bank, c) {   // the old one-by-one list (channel_posts.json, ids L00...): the first c.i posts have gone out already
  if (c.mig) return; c.mig = 1;
  for (let i = 0; i < (c.i | 0); i++) { const it = bank.byId["L" + pad(i)]; if (it) commit(c, it, {n: 0}); }
}

// ---- the bank
const BAD = /haqiqiy pul|real money|pulga almashtir|yechib ol|withdraw|pul ishla|daromad|earn money|cash out|kafolat|guarantee|100% yut|garant/i;   // virtual items only: no promise that sounds like money
const GONE = /💵/;   // the game has no cash any more: 💎 diamonds are only bought (never a prize), prizes are coins
const wording = t => BAD.test(t) ? "money wording" : GONE.test(t) ? "cash (💵) does not exist any more" : "";
function lint(it) {   // problems of one post (empty list = fine)
  const p = [], len = s => [...String(s == null ? "" : s)].length;
  if (!it || typeof it !== "object") return ["not an object"];
  if (!it.id || !/^[A-Za-z0-9_-]{1,12}$/.test(it.id)) p.push("bad id");
  if (!CATS.includes(it.cat)) p.push("bad cat " + it.cat);
  if (it.cat === "dated" && !it.when) p.push("dated without when");
  const txt = (...a) => a.filter(Boolean).join(" ");
  if (it.quiz) {
    const q = it.quiz; if (len(`${q.uz} / ${q.en}`) > 300) p.push("quiz question > 300");
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) p.push("quiz options 2-10"); else {
      if (q.options.some(o => !len(o) || len(o) > 100)) p.push("quiz option length"); if (new Set(q.options).size !== q.options.length) p.push("quiz duplicate option");
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) p.push("quiz correct index");
    }
    const e = q.explanation || {}; if (!e.uz || !e.en || len(`${e.uz} / ${e.en}`) > 200) p.push("quiz explanation missing or > 200");
    { const w = wording(txt(q.uz, q.en, e.uz, e.en, ...(q.options || []))); if (w) p.push(w); }
  } else if (it.poll) {
    const q = it.poll; if (len(`${q.uz} / ${q.en}`) > 300) p.push("poll question > 300");
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10 || q.options.some(o => !len(o) || len(o) > 100)) p.push("poll options");
    { const w = wording(txt(q.uz, q.en, ...(q.options || []))); if (w) p.push(w); }
  } else {
    if (!it.uz || !it.en) p.push("text needs uz and en");
    if (len(it.uz) + len(it.en) > (it.img ? 820 : 3000)) p.push("text too long");
    { const w = wording(txt(it.uz, it.en)); if (w) p.push(w); }
  }
  return p;
}
function fromLegacy(p, i) {
  const base = {id: "L" + pad(i), tag: "legacy"};
  if (p.quiz) return {...base, cat: "quiz", quiz: p.quiz};
  if (p.poll) return {...base, cat: "poll", poll: p.poll};
  const t = p.text || p; return {...base, cat: "feat", uz: t.uz, en: t.en, img: p.img};
}
function makeBank(raw, legacy, opt) {   // raw: the entries of channel_bank.json; legacy: channel_posts.json; opt.hasImg(file) tells whether a picture exists;
  // opt.pic(img, id) may give a nicer picture for a post (its banner: b_<name>.jpg, or b_a_<id>.jpg for a post without a picture), or nothing
  const items = [], byCat = {}, byId = {}, problems = [], has = (opt && opt.hasImg) || (() => true), pic = (opt && opt.pic) || (() => null);
  const add = it => {
    const kind = it && (it.quiz ? "quiz" : it.poll ? "poll" : "feat"); if (it && !it.cat) it.cat = kind;
    const bad = lint(it); if (bad.length) { problems.push(`${it && it.id}: ${bad.join("; ")}`); return; }
    if (byId[it.id]) { problems.push(`${it.id}: duplicate id`); return; }
    if (!it.quiz && !it.poll) { const b = pic(it.img, it.id); if (b) it = {...it, img: b}; }
    if (it.img && !has(it.img)) { problems.push(`${it.id}: picture ${it.img} is missing, posted as text`); it = {...it, img: undefined}; }
    it.tag = it.tag || "gen"; items.push(it); byId[it.id] = it; (byCat[it.cat] = byCat[it.cat] || []).push(it);
  };
  (raw || []).forEach(it => add(it && {...it})); (legacy || []).forEach((p, i) => add(fromLegacy(p, i)));
  return {items, byCat, byId, problems};
}

// ---- the text of a post
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const HASH = {city: "shahar", lobby: "lobbi", voice: "ovoz", gifts: "sovgalar", cups: "kubok", rank: "reyting", cities: "shaharlar", cues: "kiylar", tables: "stollar", frames: "ramkalar", avatars: "avatarlar", stickers: "stikerlar", daily: "kunlik", minigames: "minioyinlar", clubs: "klub", pass: "mavsum", showdown: "showdown", friends: "dostlar", modes: "rejimlar", missions: "vazifalar", brand: "bilyard", tips: "maslahat", quiz: "viktorina",
  limited: "cheklangan", chat: "chat", watch: "tomosha", boxes: "qutilar", ring: "uzuk", road: "kubokyoli", route: "sovgalar", wheel: "omadgildiragi", medals: "medallar", profile: "profil", look: "obraz", events: "tadbirlar", league: "liga", goals: "maqsad", newyear: "yangiyil",
  constitution: "bayram", defenders: "bayram", womensday: "bayram", navruz: "bayram", shop: "dokon"};
function hashtags(it) { const h = HASH[it.tag]; return "#RoyalBilliard8" + (h ? " #" + h : ""); }
function format(it, o) {   // o: {link: tracked game link or "", plain: true = no quote blocks}; the shape sendMessage / sendPhoto / sendPoll need
  if (it.quiz) { const q = it.quiz; return {kind: "quiz", question: `${q.uz} / ${q.en}`.slice(0, 300), options: q.options.map(x => String(x).slice(0, 100)), correct: q.correct | 0, explanation: `${q.explanation.uz} / ${q.explanation.en}`.slice(0, 200)}; }
  if (it.poll) { const q = it.poll; return {kind: "poll", question: `${q.uz} / ${q.en}`.slice(0, 300), options: q.options.map(x => String(x).slice(0, 100))}; }
  const quote = !(o && o.plain), qt = (t, exp) => quote ? `<blockquote${exp ? " expandable" : ""}>${t}</blockquote>` : t;
  const lines = String(it.uz).split("\n"), title = `<b>${esc(lines[0])}</b>`, body = lines.length > 1 ? esc(lines.slice(1).join("\n")) : "";
  const head = title + (body ? "\n" + qt(body) : "");
  const en = it.en ? "\n" + qt(`🇬🇧 <i>${esc(String(it.en).replace(/\n/g, " · "))}</i>`, true) : "", go = o && o.link ? `\n\n▶ <a href="${esc(o.link)}">O'ynash · Play</a>` : "", tags = `\n${hashtags(it)}`;
  const max = it.img ? 1000 : 4000; let html = head + en + go + tags;
  if (html.length > max) html = head + en + go;                      // too long for a photo caption: no hashtags,
  if (html.length > max) html = head + go;                            // then no English,
  if (html.length > max) html = title + (body ? "\n" + qt(body.slice(0, max - 80) + "…") : "");
  return {kind: it.img ? "photo" : "text", html, img: it.img};
}

// ---- for the owner: how much is left, what comes next
function stats(bank, c) {   // per kind: {size, used} in the current round
  const out = {}; for (const k of CATS) { const all = bank.byCat[k] || []; if (!all.length) continue; out[k] = {size: all.length, used: k === "dated" ? Object.keys(c.dated || {}).length : ((c.used || {})[k] || []).length}; }
  return out;
}
function outlook(o, now, days) {   // the next days: weekday, times and kinds of the slots
  const rows = [], names = ["", "Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
  for (let i = 0; i < days; i++) {
    const day = localDay(now + i * DAY), times = slotTimes(day, o.slots, o.jitter);
    rows.push(`${day.key.slice(5)} ${names[day.dow]}: ` + times.map((t, s) => `${pad(Math.floor((t - day.start) / 36e5))}:${pad(Math.floor((t - day.start) / 6e4) % 60)} ${baseCat(day.n, s, o.slots.length)}`).join(" · "));
  }
  return rows;
}

module.exports = {TZ, DAY, CATS, localDay, parseHM, options, slotTimes, due, baseCat, whenOk, pick, pickKind, commit, migrate, lint, makeBank, format, hashtags, stats, outlook, esc};
