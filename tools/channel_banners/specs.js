// What each banner shows. key = the name of the screenshot the posts use (p03, l_open ...) -> server/channel/b_<key>.jpg; the 30 city tables are t_<id>;
// b_a_<post id> are made for the posts that have no picture of their own (from the title of the post and the topic = tag of the post).
// Art keys: the game's own pictures (IMG: ls_bg, tour_bg, cup_c4, chest, gi_jet, rg_lon ...), "cue:<id>", "tier:<tier>:<n>", "cat:<cat>:<n>", "stk:<pack>:<n>", "lg:<n>", "shot:<picture>".
module.exports = ctx => {
  const out = [], T = (key, spec) => out.push({ key, spec: { key, ...spec } });
  const COINS = { x: 690, y: 585, w: 560, h: 100, n: 20 };
  const fan = (keys) => ({ preset: "cues", keys });
  T("p11", { raw: "ls_bg", line: "HAMMASI BIR JOYDA" });
  // ---- the first set of screenshots
  T("p01", { bg: { k: "lvl_bg", blur: 5 }, title: "Omadli zarba", sub: "Oltin sharni nishon markaziga yuboring", en: "Lucky Shot: a free try every day", hero: "target", badge: "BEPUL", coins: COINS });
  T("p02", { bg: "homeBg", top: true, textW: 1100, oneLine: true, title: "30 shahar · 30 stol", sub: "Qaysi stollarni ochdingiz?", en: "30 cities, each with its own table", hero: "cityCards", glow: false, sparks: false, badge: "30", soc: { s: 0.95, hx: 640, cy: 470 } });
  T("p03", { bg: "tour_bg", title: "Kunlik kuboklar", sub: "Kuniga 4 marta", en: "09:00 · 15:00 · 21:00 · 03:00 Tashkent time", hero: "dailyCups", badge: "4×", coins: { x: 700, y: 595, w: 540, h: 80, n: 16 } });
  T("p04", { bg: "shop_bg", title: "Kiylar kolleksiyasi", sub: "470 dan ortiq kiy", en: "Over 470 cues, each with its own stats", hero: [fan(["cue:olov", "cue:ajdar", "cue:galaktika", "cue:afsona", "cue:s4"])], badge: "470+" });
  T("p05", { bg: { k: "lvl_bg", blur: 4 }, title: "Omad g'ildiragi", sub: "Har 24 soatda bitta aylantirish bepul", en: "One free spin every 24 hours", hero: "wheel", badge: "BEPUL", coins: COINS });
  T("p06", { bg: { k: "lvl_bg", blur: 4 }, title: "Kunlik sovg'alar", sub: "Har kuni kirsangiz, sovg'a kattalashadi", en: "The daily reward route: 8 days", hero: "chest", badge: "8 KUN", coins: { x: 700, y: 590, w: 540, h: 90, n: 22 } });
  T("p07", { bg: "shop_bg", title: "Aniq zarba", sub: "Nishon, kuch, aylanish", en: "Aim, power and spin", shot: { k: "p07", w: 620 }, coins: false });
  T("p08", { bg: { k: "lvl_bg", blur: 4 }, title: "Mini-o'yinlar", sub: "Besh qisqa o'yin: tanaffus uchun", en: "Five quick games for a break", shot: { k: "p08", w: 620 }, badge: "5 TA", coins: false });
  T("p09", { bg: "tour_bg", title: "Tadbirlar", sub: "Grandmaster · Showdown · King's Gambit", en: "Special events for the strongest", hero: "events3", soc: { hx: 975 } });
  T("p10", { bg: { k: "lvl_bg", blur: 4 }, title: "Mavsum yo'li", sub: "400 daraja, har oy yangi mavzu", en: "The Season Pass", shot: { k: "p10", w: 620 }, badge: "400", coins: false });
  // ---- shop
  T("s_avatars", { bg: "shop_bg", title: "Avatarlar", sub: "76 ta portret bepul", en: "76 free portraits", hero: "avatarsFree", badge: "76 BEPUL" });
  T("s_avatars_all", { bg: "shop_bg", title: "Premium avatarlar", sub: "70 ta, 5 xil noyoblik", en: "From Common to Mythic", hero: "avatarsPremium", badge: "70" });
  T("s_boxes", { bg: { k: "lvl_bg", blur: 4 }, title: "Qutilar", sub: "Oddiy · Epik · Afsonaviy", en: "Rare, Epic and Legendary boxes", hero: "boxes", coins: COINS });
  T("s_frames", { bg: "shop_bg", title: "Ramkalar", sub: "120 dan ortiq ramka", en: "Frames for your avatar", hero: "frames", badge: "120+" });
  T("s_frames2", { bg: "shop_bg", title: "Cheklangan ramkalar", sub: "Bronza 5 000 dan Opal 300 gacha", en: "Limited editions in 12 tiers", hero: [{ preset: "frames", keys: [["fa33", "pv62"], ["fa25", "pv9"], ["fa19", "pv33"], ["fa10", "pv71"], ["fa5", "pv41"], ["fa0", "pv14"]] }], badge: "300 DONA" });
  T("s_stickers", { bg: "shop_bg", title: "Stikerlar", sub: "6 ta to'plam, 50 dan ortiq stiker", en: "Send them in the match chat", hero: "stickers", badge: "6 TO'PLAM" });
  T("s_tables", { bg: "shop_bg", title: "150+ stol", sub: "O'yin sahnangizni tanlang", en: "Collector tables for your matches", hero: "tables3", coins: false });
  // ---- cues
  T("c_country", { bg: "shop_bg", title: "199 davlat kiyi", sub: "Har biri bayrog'i ranglarida", en: "Every country has its own cue", hero: [fan(["cue:c_UZ", "cue:c_TR", "cue:c_US", "cue:c_GB", "cue:c_DE"])], badge: "199" });
  T("c_uz", { bg: { k: "shop_bg", tint: "rgba(0,120,180,.55)" }, title: "O'zbekiston kiyi", sub: "Bayrog'ingiz qo'lingizda", en: "The Uzbekistan cue", hero: [{ preset: "uzFlag" }, ["cue:c_UZ", { cx: 940, cy: 590, w: 720, rot: -4 }]], soc: { s: 1.25, hx: 925 } });
  T("c_horror", { bg: { k: "homeBg", tint: "rgba(110,20,160,.7)", blend: "color", dim: 0.55 }, title: "Qo'rqinchli kiylar", sub: "Haftalik takliflar aylanib turadi", en: "Weekly horror offers", hero: [fan(["tier:Qo'rqinchli:0", "tier:Qo'rqinchli:3", "tier:Qo'rqinchli:5", "tier:Qo'rqinchli:8", "tier:Qo'rqinchli:11"])], badge: "12 TA" });
  T("c_premium2", { bg: "shop_bg", title: "Premium kiylar", sub: "Bronzadan Kamalak opalgacha", en: "12 tiers of premium cues", hero: [fan(["tier:Premium:0", "tier:Premium:6", "tier:Premium:12", "tier:Premium:18", "tier:Premium:24"])], badge: "12 DARAJA" });
  T("c_premium3", { bg: "tour_bg", title: "Cheklangan nashr", sub: "Faqat 300 dan 5 000 gacha nusxa", en: "Every owner gets a serial number", hero: [fan(["tier:Premium:19", "tier:Premium:20", "tier:Premium:21", "tier:Premium:22", "tier:Premium:23"])], badge: "№ 17 / 300" });
  T("c_standard", { bg: "shop_bg", title: "Boshlash uchun pul kerak emas", sub: "Boshlang'ich kiy doim bepul", en: "The starter cue is always free", hero: [fan(["cat:standard:0", "cat:standard:1", "cat:standard:2", "cat:standard:3", "cat:standard:4"])], badge: "BEPUL" });
  T("c_surprise", { bg: { k: "lvl_bg", blur: 4 }, title: "Syurpriz kiylar", sub: "Afsonaviy kiy omadingizga bog'liq", en: "Legendary cues from surprise boxes", hero: [fan(["cat:surprise:0", "cat:surprise:1", "cat:surprise:2"]), ["chest", { cx: 1100, cy: 560, h: 220, rot: 6 }]] });
  T("c_victory", { bg: "tour_bg", title: "Victory kiylari", sub: "G'alaba bilan yig'iladi: 4 bo'lak = 1 kiy", en: "Earned by winning in the listed city", hero: [fan(["cat:victory:0", "cat:victory:1", "cat:victory:2", "cat:victory:3", "cat:victory:4"])], badge: "4 BO'LAK" });
  // ---- match, lobby
  T("m_chat", { bg: "homeBg", title: "Tezkor xabarlar", sub: "Salom, omad, zo'r zarba: bir bosishda", en: "Quick messages in the match", shot: { k: "m_chat", w: 620 }, coins: false });
  T("m_gifts", { bg: "homeBg", title: "13 xil sovg'a", sub: "Raqibga uchib boradi", en: "Send a gift in the match", hero: "gifts", badge: "13" });
  T("l_hub", { bg: "homeBg", title: "Do'stlar bilan lobbi", sub: "Kod yuboring, 8 kishigacha yig'iling", en: "Play with friends", shot: { k: "l_hub", w: 620 }, coins: false });
  T("l_open", { bg: "homeBg", title: "Ochiq lobbilar", sub: "Sherik qidirib yurmang", en: "Find a game in seconds", shot: { k: "l_open", w: 620 }, badge: { t: "YANGI" }, coins: false });
  T("l_voice", { bg: "homeBg", title: "Ovozli xona", sub: "Lobbida jonli gaplashing", en: "Talk live in the lobby", hero: [{ preset: "mic" }], shot: { k: "l_voice", w: 470, cx: 1030, cy: 545, rot: 3 }, badge: { t: "YANGI" }, coins: false, glowAt: [900, 300] });
  // ---- pass, road, missions, friends, profile, Showdown
  T("x_friends", { bg: "homeBg", title: "Do'stlar", sub: "Kod va havola bilan qo'shing", en: "Invite and play together", shot: { k: "x_friends", w: 620 }, coins: false });
  T("x_missions", { bg: { k: "lvl_bg", blur: 4 }, title: "Kunlik vazifalar", sub: "Bajaring va mukofot oling", en: "A new goal every day", shot: { k: "x_missions", w: 620 }, coins: false });
  T("x_pass", { bg: { k: "lvl_bg", blur: 4 }, title: "Mavsum yo'li", sub: "400 daraja, har oy yangi mavzu", en: "Free and premium tracks", shot: { k: "x_pass", w: 620 }, badge: "400", coins: false });
  T("x_profile", { bg: "tour_bg", title: "Profil", sub: "O'yin tarixingiz bir joyda", en: "Games, wins, medals, trophy road", shot: { k: "x_profile", w: 620 }, coins: false });
  T("x_road", { bg: "tour_bg", title: "Kubok yo'li", sub: "G'alaba, kubok, yangi shahar", en: "The Trophy Road", shot: { k: "x_road", w: 620 }, coins: false });
  T("x_showdown", { bg: { k: "homeBg", tint: "rgba(200,20,30,.65)", blend: "color", dim: 0.55 }, title: "Showdown", sub: "Har g'alaba hisobga olinadi", en: "A new week every Monday", hero: [["frame:ev_sd", { cx: 960, cy: 385, h: 520, rot: 2 }]], badge: "HAFTALIK" });
  // ---- the 30 city tables
  ctx.cities.forEach((c, i) => out.push({ key: "t_" + c.id, city: { id: c.id, uz: c.uz, sub: c.sub, en: c.name, fee: c.fee, prize: c.prize, no: i + 1 } }));
  // ---- posts without a picture of their own
  const TAGS = {
    rank: { bg: "tour_bg", hero: "globe", coins: true }, league: { bg: { k: "lvl_bg", blur: 4 }, hero: "leagues", glow: false }, clubs: { bg: { k: "lvl_bg", blur: 4 }, hero: [["frame:nv_club", { cx: 960, cy: 380, h: 400, rot: -3 }]] },
    medals: { bg: { k: "lvl_bg", blur: 4 }, hero: "medals" }, ring: { bg: "tour_bg", hero: "rings" }, cups: { bg: "tour_bg", hero: "cups4" }, daily: { bg: "tour_bg", hero: "dailyCups" },
    showdown: { bg: { k: "homeBg", tint: "rgba(200,20,30,.65)", blend: "color", dim: 0.55 }, hero: [["frame:ev_sd", { cx: 960, cy: 385, h: 520, rot: 2 }]] }, events: { bg: "tour_bg", hero: "events3" },
    route: { bg: { k: "lvl_bg", blur: 4 }, hero: "daily", coins: true }, wheel: { bg: { k: "lvl_bg", blur: 4 }, hero: "wheel" }, gifts: { bg: "homeBg", hero: "gifts" },
    friends: { bg: "homeBg", hero: "avatarsFree" }, watch: { bg: "homeBg", hero: [["frame:wf_tv", { cx: 960, cy: 370, h: 400, rot: 3 }]] }, modes: { bg: "homeBg", hero: "balls" },
    pass: { bg: { k: "lvl_bg", blur: 4 }, hero: "pass" }, goals: { bg: { k: "lvl_bg", blur: 4 }, hero: "target" }, tips: { bg: "shop_bg", hero: "balls", kicker: "MASLAHAT" },
    newyear: { bg: "homeBg", hero: "fireworks", coins: true }, constitution: { bg: { k: "homeBg", tint: "rgba(0,120,180,.55)" }, hero: "uzFlag" }, defenders: { bg: { k: "homeBg", tint: "rgba(0,120,180,.55)" }, hero: "uzFlag" },
    navruz: { bg: { k: "homeBg", tint: "rgba(0,120,180,.55)" }, hero: "uzFlag" }, womensday: { bg: { k: "lvl_bg", blur: 4 }, hero: [["gi_bouq", { cx: 950, cy: 360, h: 380 }], ["gi_cake", { cx: 780, cy: 500, h: 190, rot: -8 }], ["gi_clover", { cx: 1130, cy: 480, h: 170, rot: 8 }]] },
    stickers: { bg: "shop_bg", hero: "stickers" }, limited: { bg: "tour_bg", hero: [fan(["tier:Premium:19", "tier:Premium:20", "tier:Premium:21", "tier:Premium:22", "tier:Premium:23"])] },
    tables: { bg: "shop_bg", shot: { k: "s_tables", w: 620 }, coins: false }, cues: { bg: "shop_bg", hero: [fan(["cue:olov", "cue:ajdar", "cue:galaktika", "cue:afsona", "cue:s4"])] },
    profile: { bg: "tour_bg", shot: { k: "x_profile", w: 620 }, coins: false }, lobby: { bg: "homeBg", shot: { k: "l_open", w: 620 }, coins: false }, voice: { bg: "homeBg", hero: [{ preset: "mic" }], glowAt: [900, 300] },
    story: { bg: "tour_bg", hero: "balls", kicker: "HIKOYA" }, look: { bg: "shop_bg", hero: "avatarsPremium" }, avatars: { bg: "shop_bg", hero: "avatarsFree" }, frames: { bg: "shop_bg", hero: "frames" },
    boxes: { bg: { k: "lvl_bg", blur: 4 }, hero: "boxes" }, missions: { bg: { k: "lvl_bg", blur: 4 }, shot: { k: "x_missions", w: 620 }, coins: false }, road: { bg: "tour_bg", shot: { k: "x_road", w: 620 }, coins: false },
  };
  const KICK = { tip: "MASLAHAT", story: "HIKOYA", dated: "BUGUN", shop: "DO'KON" };
  const plain = (s, re) => String(s || "").split("\n")[0].replace(/^[^\p{L}\p{N}«"]+/u, "").replace(re || /$^/, "").trim();
  // the older posts (channel_posts.json, ids L00...) are part of the bank too
  const legacy = (ctx.legacy || []).map((p, i) => { if (p.quiz || p.poll || p.img) return null; const t = p.text || p; return { id: "L" + String(i).padStart(2, "0"), cat: /^[^\p{L}]*Maslahat/u.test(String(t.uz)) ? "tip" : "feat", tag: "legacy", uz: t.uz, en: t.en }; }).filter(Boolean);
  for (const it of [...ctx.bank, ...legacy]) {
    if (it.img || it.quiz || it.poll || !["feat", "shop", "tip", "story", "dated"].includes(it.cat)) continue;
    const isNew = /^(YANGI|Yangi)[:,]/.test(plain(it.uz)), title = plain(it.uz, /^(Maslahat|YANGI|Yangi)[:,]\s*/), en = plain(it.en, /^(Tip|NEW|New): ?/);
    const n = parseInt(it.id.slice(1), 10) || 0, POOL = ["balls", "rack", "ghost", "cueBall"], BGS = ["shop_bg", "tour_bg", { k: "lvl_bg", blur: 4 }];
    const base = TAGS[it.tag] && it.tag !== "tips" && it.tag !== "story" ? TAGS[it.tag] : { bg: BGS[n % 3], hero: POOL[n % 4], kicker: it.cat === "story" ? "HIKOYA" : "MASLAHAT" };
    if (it.tag === "brand" && it.cat === "feat") { out.push({ key: "a_" + it.id, spec: { key: "a_" + it.id, raw: "ls_bg", line: title.toUpperCase().slice(0, 40) } }); continue; }
    out.push({ key: "a_" + it.id, spec: { key: "a_" + it.id, kicker: KICK[it.cat] || "", ...base, title: title.slice(0, 64), en: en.slice(0, 70), badge: isNew ? "YANGI" : undefined, coins: base.coins, maxFs: 100 } });
  }
  return out;
};
