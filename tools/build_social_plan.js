#!/usr/bin/env node
// The 3-month plan for Instagram / Facebook / Threads / Pinterest (posted with Metricool): social/plan.csv, one post a day.
//   node tools/build_social_plan.js [--from 2026-11-03] [--days 90] [--time 19:00] [--base <public url of the social/ folder>]
// Posts come from server/channel_bank.json (the same texts as the Telegram channel, only those that have a picture in social/), holiday posts on their own dates,
// the weekly ones (Monday reset, Friday lobby ...) on their weekday; no post repeats. The game link is tracked: ...startapp=c_so_<topic> (shown in the game's /src).
// Pictures: social/p_<key>.jpg (4:5) and social/v_<key>.jpg (9:16), made by tools/build_social_images.js; the CSV holds their public (raw.githubusercontent.com) addresses.
const fs = require("fs"), path = require("path"), plan = require("../server/chan_plan");
const ROOT = path.resolve(__dirname, ".."), args = process.argv.slice(2), arg = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const FROM = arg("--from", "2026-11-03"), DAYS = +arg("--days", 90), TIME = arg("--time", "19:00");
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
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const rows = [["date", "time", "networks", "text", "image_4x5", "image_9x16", "post_id", "kind"]];
const start = new Date(FROM + "T00:00:00Z");
for (let n = 0; n < DAYS; n++) {
  const d = new Date(start.getTime() + n * 864e5), day = dayOf(d);
  const fit = dated.filter(it => !used.has(it.id) && plan.whenOk(it.when, day, 0, 1, true) && it.when);   // holiday (md / range) beats weekly (dow) beats the rest
  const exact = fit.find(it => it.when.md || it.when.range) || fit.find(it => it.when.dow);
  const it = exact || take(ROT[day.dow - 1]); if (!it) break; used.add(it.id);
  const key = pics(it), tag = (it.tag || it.cat).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16) || "x";
  const text = `${it.uz}\n\n${it.en}\n\n▶ O'ynash / Play: ${LINK}${tag}\n${plan.hashtags(it)} #8ball #pool #telegramgame`;
  rows.push([day.key, TIME, "facebook,instagram,threads,pinterest", text, `${BASE}/p_${key}.jpg`, `${BASE}/v_${key}.jpg`, it.id, it.cat].map(q));
}
fs.writeFileSync(path.join(ROOT, "social", "plan.csv"), "﻿" + rows.map(x => x.join(",")).join("\r\n") + "\r\n");
console.log(`${rows.length - 1} posts, ${FROM} ... ${rows[rows.length - 1][0].replace(/"/g, "")} -> social/plan.csv`);
const kinds = {}; rows.slice(1).forEach(x => { const k = x[7].replace(/"/g, ""); kinds[k] = (kinds[k] || 0) + 1; }); console.log(kinds);
