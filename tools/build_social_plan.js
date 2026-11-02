#!/usr/bin/env node
// The 3-month plan for Instagram / Facebook / Threads (posted with Metricool): social/metricool_<YYYY-MM>.csv, one file a month in Metricool's own import format
// (the columns of tools/metricool_template.csv = Planning > menu > Import CSV > Download template).
//   node tools/build_social_plan.js [--from 2026-11-03] [--days 90] [--per-month 20] [--time 19:00] [--threads] [--brand "exact brand name"] [--base <public url of the social/ folder>]
// The free Metricool plan allows 20 posts a month, so --per-month picks that many days of each month (holiday posts first, the rest evenly spread).
// Posts come from server/channel_bank.json (the same texts as the Telegram channel, only those that have a picture in social/), holiday posts on their own dates,
// the weekly ones (Monday reset, Friday lobby ...) on their weekday; no post repeats. The game link is tracked: ...startapp=c_so_<topic> (shown in the game's /src).
// Pictures: social/p_<key>.jpg (4:5) and social/v_<key>.jpg (9:16), made by tools/build_social_images.js; the CSV holds their public (raw.githubusercontent.com) addresses.
const fs = require("fs"), path = require("path"), plan = require("../server/chan_plan");
const ROOT = path.resolve(__dirname, ".."), args = process.argv.slice(2), arg = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const FROM = arg("--from", "2026-11-03"), DAYS = +arg("--days", 90), TIME = arg("--time", "19:00") + ":00", PER = +arg("--per-month", 20), THREADS = args.includes("--threads"), BRAND = arg("--brand", "");   // Threads only with --threads (it must be connected in Metricool); no brand name = the brand that is open when importing
const BASE = arg("--base", "https://raw.githubusercontent.com/au7520384-cell/Ajal-yog-dusi/claude/shunaqa-oyin-yaratish-5dujy5/social");
const LINK = "https://t.me/Billiard8PoolBot/Play?startapp=c_so_";
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "channel_bank.json"), "utf8"));
const pics = it => it.img && fs.existsSync(path.join(ROOT, "social", "p_" + it.img.replace(/\.jpg$/, "") + ".jpg")) ? it.img.replace(/\.jpg$/, "") : null;
const rng = seed => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const usable = bank.filter(it => !it.quiz && !it.poll && pics(it));
const r = rng(20261103), pool = k => shuffle(usable.filter(it => it.cat === k && !it.when), r);
const pools = { feat: pool("feat"), city: pool("city"), shop: pool("shop"), story: pool("story") };
const dated = usable.filter(it => it.cat === "dated" || it.when), used = new Set();
const ROT = ["feat", "city", "shop", "feat", "city", "story", "feat"];   // Mon .. Sun; an empty pool falls back to the next one
const dayOf = d => { const iso = d.toISOString().slice(0, 10); return { key: iso, md: iso.slice(5), dom: d.getUTCDate(), dow: d.getUTCDay() || 7 }; };
const take = k => { for (const kk of [k, "feat", "city", "shop", "story"]) { const it = pools[kk].shift(); if (it) return it; } return null; };
const entries = [], start = new Date(FROM + "T00:00:00Z");
for (let n = 0; n < DAYS; n++) {
  const d = new Date(start.getTime() + n * 864e5), day = dayOf(d);
  const fit = dated.filter(it => !used.has(it.id) && plan.whenOk(it.when, day, 0, 1, true) && it.when);   // holiday (md / range) beats weekly (dow) beats the rest
  const exact = fit.find(it => it.when.md || it.when.range) || fit.find(it => it.when.dow);
  const it = exact || take(ROT[day.dow - 1]); if (!it) break; used.add(it.id);
  entries.push({ day, it, holiday: !!(exact && (exact.when.md || exact.when.range)) });
}
// the days of each month that really get a post
const months = {}; entries.forEach(e => (months[e.day.key.slice(0, 7)] = months[e.day.key.slice(0, 7)] || []).push(e));
const chosen = [];
for (const [m, list] of Object.entries(months)) {
  const hol = list.filter(e => e.holiday), rest = list.filter(e => !e.holiday), room = Math.max(0, PER - hol.length), pick = new Set();
  for (let k = 0; k < Math.min(room, rest.length); k++) pick.add(Math.floor((k + 0.5) * rest.length / Math.min(room, rest.length)));
  chosen.push(...list.filter(e => e.holiday || pick.has(rest.indexOf(e))));
}
// Metricool's own columns; everything not set stays empty / false
const tpl = fs.readFileSync(path.join(__dirname, "metricool_template.csv"), "utf8").replace(/^\ufeff/, "").split(/\r?\n/)[0], cols = tpl.split(",");
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const byMonth = {};
for (const { day, it } of chosen) {
  const key = pics(it), tag = (it.tag || it.cat).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16) || "x";
  const text = `${it.uz}\n\n${it.en}\n\n▶ O'ynash / Play: ${LINK}${tag}\n${plan.hashtags(it)} #8ball #pool #telegramgame`;
  const alt = String(it.uz).split("\n")[0].replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 120);
  const v = { Text: q(text), Date: q(day.key), Time: q(TIME), Draft: false, Facebook: true, Instagram: true, Threads: THREADS && text.length <= 500,   // Threads takes 500 characters
    "Picture Url 1": q(`${BASE}/p_${key}.jpg`), "Alt text picture 1": q(alt), Shortener: false, "Instagram Post Type": q("POST"), "Facebook Post Type": q("POST"), "Threads Post Type": q("POST"), "Brand name": q(BRAND) };
  (byMonth[day.key.slice(0, 7)] = byMonth[day.key.slice(0, 7)] || []).push(cols.map(c => c in v ? v[c] : (/^(Draft|Facebook|Twitter\/X|LinkedIn|GBP|Instagram|Pinterest|TikTok|Youtube|Threads|Bluesky)$/.test(c) ? false : "")).join(","));
}
for (const f of fs.readdirSync(path.join(ROOT, "social"))) if (/^(plan|metricool_.*)\.csv$/.test(f)) fs.unlinkSync(path.join(ROOT, "social", f));
for (const [m, rows] of Object.entries(byMonth)) { fs.writeFileSync(path.join(ROOT, "social", `metricool_${m}.csv`), [tpl, ...rows].join("\r\n") + "\r\n"); console.log(`social/metricool_${m}.csv: ${rows.length} posts`); }
