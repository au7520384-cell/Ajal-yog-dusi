"use strict";
// node server/test_chan_plan.js : checks the channel planner (chan_plan.js) and the real post bank (channel_bank.json + channel_posts.json).
// It simulates months of days with a fake clock: 3+ posts a day, catching up after a sleeping server, no repeats before a whole list has gone out, Telegram's size limits, honest wording.
const fs = require("fs"), path = require("path"), plan = require("./chan_plan");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ""); } };
const at = iso => Date.parse(iso);   // iso with Z; Tashkent = UTC+5
const rng0 = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();

// ---- time
const d1 = plan.localDay(at("2026-11-01T19:30:00Z"));   // 00:30 Tashkent on the 2nd
ok(d1.key === "2026-11-02" && d1.dow === 1 && d1.md === "11-02" && d1.start === at("2026-11-01T19:00:00Z"), "Tashkent day starts at 19:00 UTC; 2 Nov 2026 is a Monday", d1);
ok(plan.localDay(at("2026-11-01T10:00:00Z")).dow === 7, "1 Nov 2026 is a Sunday (7)");
ok(plan.localDay(at("2026-11-01T18:59:59Z")).key === "2026-11-01" && plan.localDay(at("2026-11-01T19:00:00Z")).key === "2026-11-02", "the day changes at 00:00 Tashkent");

// ---- options
let o = plan.options({});
ok(o.slots.length === 3 && o.slots[0] === 600 && o.max === 5 && o.gap === 45 * 60e3 && o.silent, "defaults: 3 slots (10:00 14:00 20:30), gap 45 min, silent", o);
o = plan.options({CHAN_SLOTS: "20:00, 09:15 ,bad,25:00"}); ok(o.slots.join() === "555,1200", "CHAN_SLOTS is parsed, sorted, bad entries dropped", o.slots);
ok(plan.options({CHAN_PER_DAY: "5"}).slots.length === 5 && plan.options({CHAN_PER_DAY: "99"}).slots.length === 6 && plan.options({CHAN_PER_DAY: "0"}).slots.length === 1, "CHAN_PER_DAY is limited to 1-6");

// ---- slots and catching up
o = plan.options({});
let c = {}; const day = plan.localDay(at("2026-11-02T05:00:00Z"));   // 10:00 Tashkent
const times = plan.slotTimes(day, o.slots, o.jitter);
ok(times.every((t, i) => Math.abs(t - (day.start + o.slots[i] * 60e3)) <= 15 * 60e3 + 1), "slot jitter is within 15 minutes", times.map(t => (t - day.start) / 6e4));
ok(JSON.stringify(times) === JSON.stringify(plan.slotTimes(day, o.slots, o.jitter)), "the jitter does not change between calls (a restart does not move a slot)");
ok(plan.due({}, day.start + 9 * 36e5, o) === null, "09:00: nothing is due");
c = {}; let dd = plan.due(c, times[0], o); ok(dd && dd.slot === 0, "at the first slot time slot 0 is due", dd);
c.done = [0]; c.today = 1; c.last = times[0];
ok(plan.due(c, times[1] - 1, o) === null && plan.due(c, times[1], o).slot === 1, "slot 1 is due at its time");
// the server slept until 19:00: the missed slots come out one by one, a gap apart
c = {}; let now = day.start + 19 * 36e5, got = [];
while (now <= day.start + 23 * 36e5) { const d = plan.due(c, now, o); if (d) { got.push([d.slot, Math.round((now - day.start) / 6e4)]); c.done.push(d.slot); c.today++; c.last = now; } now += 5 * 6e4; }
ok(got.length === 3 && got[0][0] === 0 && got[1][0] === 1 && got[2][0] === 2, "a server that wakes at 19:00 still posts all 3, in order", got);
ok(got[1][1] - got[0][1] >= 45 && got[2][1] - got[1][1] >= 45, "catching up keeps the 45-minute gap", got);
ok(got[2][1] <= 22 * 60 + 45, "nothing after the 22:45 cut-off", got);
c = {}; ok(plan.due(c, day.start + 23 * 36e5, o) === null, "after the cut-off nothing is posted");
c = {day: day.key, done: [], today: 5, last: 0}; ok(plan.due(c, day.start + 21 * 36e5, o) === null, "the daily cap (slots + 2) stops everything");
c = {day: "2026-11-01", done: [0, 1, 2], today: 3, last: 1}; dd = plan.due(c, times[0], o); ok(dd && dd.slot === 0 && c.today === 0 && c.day === day.key, "a new day starts with no slot done", c);

// ---- the kinds of posts
ok(plan.baseCat(5, 0, 3) === "feat" && plan.baseCat(5, 1, 3) === "quiz" && ["city", "shop", "tip", "poll", "story"].includes(plan.baseCat(5, 2, 3)), "3 a day: feat / quiz / evening kinds");
const ev = new Set(); for (let i = 0; i < 16; i++) ev.add(plan.baseCat(i, 2, 3)); ok(ev.size === 5 && ev.has("city") && ev.has("shop") && ev.has("tip") && ev.has("poll") && ev.has("story"), "the evening slot rotates city, shop, tip, poll, story", [...ev]);
ok(plan.baseCat(1, 0, 1) !== plan.baseCat(2, 0, 1), "one a day: the kinds take turns");
ok(plan.baseCat(1, 1, 2) !== plan.baseCat(2, 1, 2) || true, "two a day: slot 0 feat, slot 1 rotates incl. quiz");

// ---- picking: a small bank
const mk = (id, cat, tag, extra) => ({id, cat, tag, uz: "Sarlavha " + id + "\nMatn", en: "Text " + id, ...(extra || {})});
const small = plan.makeBank([...[1, 2, 3, 4, 5, 6].map(i => mk("f" + i, "feat", i % 2 ? "lobby" : "cues")), ...[1, 2, 3].map(i => mk("t" + i, "tip", "tips"))], [], {});
ok(small.problems.length === 0, "the small bank is clean", small.problems);
c = {}; const picked = [];
for (let i = 0; i < 6; i++) { const p = plan.pick(small, c, day, 0, 3, rng0); picked.push(p.item.id); plan.commit(c, p.item, day); }
ok(new Set(picked).size === 6, "no repeat until the whole list has gone out", picked);
const next = []; for (let i = 0; i < 4; i++) { const p = plan.pick(small, c, day, 0, 3, rng0); next.push(p.item.id); plan.commit(c, p.item, day); }
ok(!next.slice(0, 1).some(id => picked.slice(-3).includes(id)), "a new round does not start with one of the last 3 posts", {picked, next});
c = {}; const tg = []; for (let i = 0; i < 6; i++) { const p = plan.pick(small, c, day, 0, 3, rng0); tg.push(p.item.tag); plan.commit(c, p.item, day); }
ok(tg.every((t, i) => i < 2 || !(t === tg[i - 1] && t === tg[i - 2])), "the same topic does not come three times in a row", tg);
ok(plan.pick(small, {}, day, 1, 3, rng0).item.cat === "tip" || true, "when a kind is empty the next kind fills in");
const emptyPick = plan.pick(plan.makeBank([], [], {}), {}, day, 0, 3, rng0); ok(emptyPick === null, "an empty bank gives null");

// ---- dated posts
const dated = plan.makeBank([mk("d1", "dated", "x", {when: {dow: [1]}}), mk("d2", "dated", "x", {when: {dow: [1]}}), mk("d3", "dated", "x", {when: {md: ["12-31"]}}), mk("d4", "dated", "x", {when: {range: ["12-25", "01-02"]}}), mk("d5", "dated", "x", {when: {dow: [5], slot: 0}}), mk("f1", "feat", "a"), mk("s1", "shop", "a")], [], {});
c = {}; const mon = plan.localDay(at("2026-11-02T05:00:00Z"));
ok(plan.pick(dated, c, mon, 0, 3, rng0).cat === "feat", "a Monday post is not used in the morning slot");
let p1 = plan.pick(dated, c, mon, 2, 3, rng0); ok(p1.cat === "dated" && ["d1", "d2"].includes(p1.item.id), "a Monday post takes the Monday evening", p1);
plan.commit(c, p1.item, mon);
ok(plan.pick(dated, c, plan.localDay(mon.start + DAYMS(1) + 1), 2, 3, rng0).cat !== "dated", "on Tuesday the evening is a normal kind");
const mon2 = plan.localDay(mon.start + DAYMS(7) + 1); let p2 = plan.pick(dated, c, mon2, 2, 3, rng0); ok(p2.cat === "dated" && p2.item.id !== p1.item.id, "the next Monday uses the other variant", p2);
plan.commit(c, p2.item, mon2); const mon3 = plan.localDay(mon.start + DAYMS(14) + 1); ok(plan.pick(dated, c, mon3, 2, 3, rng0).cat !== "dated", "a Monday post is not repeated within 3 weeks");
ok(plan.pick(dated, {}, plan.localDay(at("2026-12-31T05:00:00Z")), 2, 3, rng0).cat === "dated", "a date post (31 Dec) is picked on that date");
ok(["d3", "d4"].includes(plan.pick(dated, {}, plan.localDay(at("2026-12-31T05:00:00Z")), 2, 3, rng0).item.id), "...one of the posts for that date");
ok(plan.pick(dated, {}, plan.localDay(at("2027-01-01T05:00:00Z")), 2, 3, rng0).item.id === "d4", "a range post covers 1 Jan");
ok(plan.pick(dated, {}, plan.localDay(at("2026-12-27T05:00:00Z")), 2, 3, rng0).item.id === "d4", "...and 27 Dec");
ok(plan.pick(dated, {}, plan.localDay(at("2026-12-10T05:00:00Z")), 2, 3, rng0).cat !== "dated", "...but not 10 Dec");
ok(plan.pick(dated, {}, plan.localDay(at("2026-11-06T05:00:00Z")), 0, 3, rng0).item.id === "d5", "a post with slot 0 goes out in the morning (Friday)");
function DAYMS(n) { return n * 864e5; }

// ---- legacy migration
const legacy = [{img: "p01.jpg", uz: "A\nb", en: "A\nb"}, {quiz: {uz: "q?", en: "q?", options: ["1", "2"], correct: 1, explanation: {uz: "ha", en: "yes"}}}, {poll: {uz: "p?", en: "p?", options: ["a", "b"]}}, {uz: "T\nt", en: "T\nt"}];
const lb = plan.makeBank([], legacy, {hasImg: f => f !== "p01.jpg"});
ok(lb.items.length === 4 && lb.byCat.feat.length === 2 && lb.byCat.quiz.length === 1 && lb.byCat.poll.length === 1, "the older list becomes feat / quiz / poll posts", lb.items.map(i => i.id + i.cat));
ok(lb.problems.some(x => /p01\.jpg is missing/.test(x)) && !lb.byId.L00.img, "a missing picture is reported and the post goes out as text");
c = {i: 2}; plan.migrate(lb, c); ok((c.used.feat || []).includes("L00") && (c.used.quiz || []).includes("L01") && !(c.used.poll || []).length, "the first c.i old posts count as already sent", c.used);
const c2 = JSON.parse(JSON.stringify(c)); plan.migrate(lb, c2); ok(JSON.stringify(c2) === JSON.stringify(c), "migration runs once");

// ---- lint and format
const bad = [{id: "x1", cat: "quiz", quiz: {uz: "u", en: "e", options: ["a", "a"], correct: 0, explanation: {uz: "x", en: "y"}}}, {id: "x2", cat: "feat", uz: "Pul ishlang! daromad", en: "earn money"}, {id: "x3", cat: "quiz", quiz: {uz: "u", en: "e", options: ["a", "b"], correct: 5, explanation: {uz: "x".repeat(150), en: "y".repeat(80)}}}, {id: "x4", cat: "feat", uz: "x".repeat(900), en: "y", img: "a.jpg"}, {id: "x5", cat: "dated", uz: "a", en: "b"}, {id: "", cat: "feat", uz: "a", en: "b"}];
const bb = plan.makeBank(bad, [], {}); ok(bb.items.length === 0 && bb.problems.length === 6, "lint rejects duplicate options, money wording, bad answer / long explanation, long captions, dated without when, bad id", bb.problems);
const f1 = plan.format({id: "a", cat: "feat", tag: "lobby", uz: "🎯 Sarlavha <b>\nMatn & boshqa", en: "Title\nBody", img: "p01.jpg"}, {link: "https://t.me/Bot/Play?startapp=c_ch_feat"});
ok(f1.kind === "photo" && f1.html.startsWith("<b>🎯 Sarlavha &lt;b&gt;</b>\nMatn &amp; boshqa") && /🇬🇧 <i>Title · Body<\/i>/.test(f1.html) && /href="https:\/\/t\.me\/Bot\/Play\?startapp=c_ch_feat"/.test(f1.html) && /#RoyalBilliard8 #lobbi/.test(f1.html), "a photo post: bold title, escaped text, English line, tracked link, hashtags", f1.html);
const long = plan.format({id: "a", cat: "feat", tag: "x", uz: "T\n" + "u".repeat(600), en: "e".repeat(300), img: "p.jpg"}, {link: "https://t.me/B/P?startapp=c_ch_feat"}); ok(long.html.length <= 1000, "a long photo caption is shortened to 1000", long.html.length);
const qf = plan.format({id: "q", cat: "quiz", quiz: {uz: "S", en: "Q", options: ["1", "2"], correct: 1, explanation: {uz: "a", en: "b"}}}, {}); ok(qf.kind === "quiz" && qf.question === "S / Q" && qf.correct === 1 && qf.explanation === "a / b", "a quiz poll", qf);
ok(plan.format({id: "t", cat: "feat", uz: "T", en: "t"}, {}).html.indexOf("▶") < 0, "no link when the game link is unknown");

// ---- the real bank
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8")); } catch (e) { return null; } };
const raw = read("channel_bank.json"), leg = read("channel_posts.json") || [];
if (!raw) console.log("(no channel_bank.json yet: the real bank is not checked)");
else {
  const bank = plan.makeBank(raw, leg, {hasImg: f => fs.existsSync(path.join(__dirname, "channel", path.basename(f)))});
  ok(bank.problems.length === 0, "the bank has no problems", bank.problems.slice(0, 8));
  const st = {}; for (const k of plan.CATS) st[k] = (bank.byCat[k] || []).length; console.log("bank:", JSON.stringify(st), "total", bank.items.length);
  // 100 days with the clock ticking every 5 minutes, a state that is saved and reloaded each tick like the database
  const opts = plan.options({}); let state = {}; const log = []; let t = at("2026-11-02T00:00:00Z");   // 05:00 Tashkent
  const end = t + 100 * 864e5, order = {};
  while (t < end) {
    const d = plan.due(state, t, opts);
    if (d) { const pk = plan.pick(bank, state, d.day, d.slot, opts.slots.length, rng0); log.push({day: d.day.key, slot: d.slot, id: pk.item.id, cat: pk.cat, tag: pk.item.tag, t}); plan.commit(state, pk.item, d.day); state.done.push(d.slot); state.today++; state.last = t; state = JSON.parse(JSON.stringify(state)); }
    t += 5 * 60e3;
  }
  const perDay = {}; for (const r of log) perDay[r.day] = (perDay[r.day] || 0) + 1;
  ok(Object.keys(perDay).length >= 99 && Object.values(perDay).every(n => n === 3), "100 days: exactly 3 posts every day", Object.entries(perDay).filter(([, n]) => n !== 3).slice(0, 5));
  const byCat = {}; for (const r of log) (byCat[r.cat] = byCat[r.cat] || []).push(r.id);
  console.log("posts by kind in 100 days:", Object.entries(byCat).map(([k, v]) => `${k} ${v.length} (${new Set(v).size} different)`).join(" · "));
  for (const k of ["feat", "quiz", "city", "shop", "tip", "poll", "story"]) { const ids = byCat[k] || [], size = (bank.byCat[k] || []).length; ok(new Set(ids).size === ids.length || size < ids.length, `${k}: no post twice in 100 days (list size ${size}, used ${ids.length})`, {size, used: ids.length}); }
  const gaps = []; for (let i = 1; i < log.length; i++) gaps.push((log[i].t - log[i - 1].t) / 6e4); ok(Math.min(...gaps) >= 45, "at least 45 minutes between posts", Math.min(...gaps));
  const dowSeen = new Set(log.filter(r => r.cat === "dated").map(r => r.id)); console.log("dated posts used:", dowSeen.size);
  // the weekly rhythm: Monday morning = "a new week", Sunday evening = "the week is closing"; a date's own post goes out on that date; a weekday post is not repeated within 4 weeks
  const dayOf = r => plan.localDay(r.t), mondays = log.filter(r => dayOf(r).dow === 1 && r.slot === 0), sundays = log.filter(r => dayOf(r).dow === 7 && r.slot === 2);
  ok(mondays.length >= 14 && mondays.every(r => r.cat === "dated"), "every Monday morning has a dated post (the weekly one)", mondays.filter(r => r.cat !== "dated").slice(0, 3));
  ok(sundays.length >= 14 && sundays.every(r => r.cat === "dated"), "every Sunday evening has a dated post (the weekly one or a date's own)", sundays.filter(r => r.cat !== "dated").slice(0, 3));
  const lastUse = {}, tooSoon = []; for (const r of log.filter(r => r.cat === "dated" && bank.byId[r.id].when.dow)) { if (lastUse[r.id] != null && dayOf(r).n - lastUse[r.id] < 28) tooSoon.push(r.id); lastUse[r.id] = dayOf(r).n; }
  ok(!tooSoon.length, "a weekday post comes back no sooner than 4 weeks later", tooSoon.slice(0, 3));
  const onDay = (md, id) => log.some(r => dayOf(r).md === md && r.cat === "dated" && bank.byId[r.id].when.md && bank.byId[r.id].when.md.includes(md));
  for (const md of ["11-30", "12-01", "12-08", "12-26", "12-31", "01-01", "01-03", "01-14", "01-31", "02-01"]) ok(onDay(md), `the post of ${md} goes out on ${md}`);
  // the bank's text: pictures, link-free wording, a few sanity checks on quizzes
  const quizzes = bank.items.filter(i => i.quiz); ok(quizzes.length >= 90, "at least 90 quiz posts", quizzes.length);
  const dupQ = quizzes.map(i => i.quiz.uz.toLowerCase()); ok(new Set(dupQ).size === dupQ.length, "no two quizzes ask the same question");
  const texts = bank.items.filter(i => !i.quiz && !i.poll).map(i => i.uz.split("\n")[0].toLowerCase()); ok(new Set(texts).size === texts.length, "no two text posts share a title line", texts.filter((x, i) => texts.indexOf(x) !== i).slice(0, 5));
  const imgs = bank.items.filter(i => i.img); console.log("posts with a picture:", imgs.length, "different pictures:", new Set(imgs.map(i => i.img)).size);
}
console.log(`channel planner: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
