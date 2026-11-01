#!/usr/bin/env python3
"""Builds server/channel_bank.json (the posts of the channel auto-poster) from the text sources in tools/channel_bank/.

    python3 tools/build_channel_bank.py          # from the repo root

Source files (tools/channel_bank/*.txt) hold blocks:

    ## <cat> <tag> [picture]          cat: feat quiz city shop tip poll story dated, picture: a file of server/channel/ without .jpg
    uz: first line = the bold title        (the following lines belong to uz until the next key)
    more lines of the Uzbek text
    en: English text (1-3 short lines; line breaks become " · ")
    o: option A | option B | option C      (quiz and poll)
    c: 1                                   (quiz: index of the right option, 0-based)
    xu: explanation in Uzbek               (quiz, shown after the answer, Telegram limit: uz + en <= 200 characters together)
    xe: explanation in English
    when: {"dow": [1], "slot": 0}          (optional, JSON; see whenOk() in server/chan_plan.js)
    // a comment line

city.txt holds only the flavour line of each city ("## city lon" + uz/en): the numbers (entry fee, prize, level, trophies,
ring goal) come from tools/channel_bank/cities.json, which is a dump of the game's CITIES / UNLOCK_TP / TROPHY tables.
Ids are given in the order of the files: F001.., Q001.., C001.., S001.., T001.., P001.., Y001.., D001...
After the build the bank is checked with the same lint the server uses (server/chan_plan.js)."""
import json, os, random, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "channel_bank")
IMG = os.path.join(ROOT, "server", "channel")
OUT = os.path.join(ROOT, "server", "channel_bank.json")
PREFIX = {"feat": "F", "quiz": "Q", "city": "C", "shop": "S", "tip": "T", "poll": "P", "story": "Y", "dated": "D"}
FLAG = {"lon": "🇬🇧", "syd": "🇦🇺", "lis": "🇵🇹", "mad": "🇪🇸", "tok": "🇯🇵", "veg": "🇺🇸", "bue": "🇦🇷", "jak": "🇮🇩", "tor": "🇨🇦", "mex": "🇲🇽",
        "cai": "🇪🇬", "dub": "🇦🇪", "sin": "🇸🇬", "sha": "🇨🇳", "par": "🇫🇷", "ams": "🇳🇱", "rom": "🇮🇹", "bkk": "🇹🇭", "kul": "🇲🇾", "seo": "🇰🇷",
        "mum": "🇮🇳", "ath": "🇬🇷", "ber": "🇩🇪", "ist": "🇹🇷", "cas": "🇲🇦", "osa": "🇯🇵", "tas": "🇺🇿", "rio": "🇧🇷", "nyc": "🇺🇸", "mos": "🇷🇺"}
NAME_UZ = {"lon": "London", "syd": "Sidney", "lis": "Lissabon", "mad": "Madrid", "tok": "Tokio", "veg": "Las-Vegas", "bue": "Buenos-Ayres", "jak": "Jakarta",
           "tor": "Toronto", "mex": "Mexiko", "cai": "Qohira", "dub": "Dubay", "sin": "Singapur", "sha": "Shanxay", "par": "Parij", "ams": "Amsterdam",
           "rom": "Rim", "bkk": "Bangkok", "kul": "Kuala-Lumpur", "seo": "Seul", "mum": "Mumbay", "ath": "Afina", "ber": "Berlin", "ist": "Istanbul",
           "cas": "Kasablanka", "osa": "Osaka", "tas": "Toshkent", "rio": "Rio-de-Janeyro", "nyc": "Nyu-York", "mos": "Moskva"}
KEYS = ("uz", "en", "o", "c", "xu", "xe", "when")


def num(n):
    return f"{n:,}".replace(",", " ")


def parse(path):
    blocks, cur, key = [], None, None
    for raw in open(path, encoding="utf-8").read().split("\n"):
        line = raw.rstrip()
        if line.startswith("//"):
            continue
        if line.startswith("## "):
            parts = line[3:].split()
            cur = {"cat": parts[0], "tag": parts[1] if len(parts) > 1 else "", "img": parts[2] if len(parts) > 2 else None, "f": {}, "src": f"{os.path.basename(path)}:{len(blocks) + 1}"}
            blocks.append(cur); key = None
            continue
        if cur is None:
            continue
        m = re.match(r"^(uz|en|o|c|xu|xe|when):\s?(.*)$", line)
        if m:
            key = m.group(1); cur["f"][key] = m.group(2)
        elif key in ("uz", "en", "xu", "xe") and line.strip():
            cur["f"][key] += "\n" + line
    return blocks


def strip_venue(text, sub):   # the title already names the venue: "Plaza Mayor, Madridning qalbi" -> "Madridning qalbi"
    m = re.match(r"^" + re.escape(sub) + r"[:,]\s+(.*)$", text, re.S)
    t = m.group(1) if m else text
    return t[:1].upper() + t[1:]


def build_city(b, cities):
    cid = b["tag"]; c = cities[cid]; w, l, goal = c["tro"]
    lose_uz = f"mag'lubiyat −{l}" if l else "mag'lubiyatda kubok yo'qolmaydi"
    lose_en = f"a loss −{l}" if l else "no trophies lost on a loss"
    uz = (f"{FLAG[cid]} {NAME_UZ[cid]}: {c['sub']}\n{strip_venue(b['f']['uz'], c['sub'])}\n"
          f"🎟 Kirish: {num(c['fee'])} 🪙 → 💰 yutuq: {num(c['prize'])} 🪙\n"
          f"🔓 {c['lvl']}-daraja" + (f" · {num(c['tp'])} 🏆 kubok yo'lida" if c["tp"] else "") + f"\n💍 Shahar uzugi: {num(goal)} 🏆 (g'alaba +{w}, {lose_uz})")
    en = (f"{c['name']}: {c['sub']}. {strip_venue(b['f']['en'], c['sub'])} Entry {num(c['fee'])} 🪙 → prize {num(c['prize'])} 🪙. "
          f"Needs level {c['lvl']}" + (f" and {num(c['tp'])} 🏆 on the Trophy Road" if c["tp"] else "") + f". City ring: {num(goal)} 🏆 (win +{w}, {lose_en}).")
    return {"cat": "city", "tag": "city", "img": f"t_{cid}.jpg", "uz": uz, "en": en}


def fixed_order(opts):
    """Rows of numbers / times / percentages and two-option questions keep an order that means something."""
    return len(opts) < 3 or all(re.match(r"^[−+\-]?\d", o) for o in opts)


def place(opts, correct, target, rng):
    """The same options with the right one at `target` and the others in a seeded random order."""
    others = [o for i, o in enumerate(opts) if i != correct]; rng.shuffle(others)
    return others[:target] + [opts[correct]] + others[target:], target


def main():
    cities = {c["id"]: c for c in json.load(open(os.path.join(SRC, "cities.json"), encoding="utf-8"))}
    count, items, errors = {}, [], []
    for path in sorted(p for p in (os.path.join(SRC, f) for f in os.listdir(SRC)) if p.endswith(".txt")):
        for b in parse(path):
            cat, f = b["cat"], b["f"]
            if cat not in PREFIX:
                errors.append(f"{b['src']}: unknown cat {cat}"); continue
            try:
                if cat == "city":
                    if b["tag"] not in cities: raise ValueError("unknown city " + b["tag"])
                    it = build_city(b, cities)
                elif cat == "quiz":
                    opts, right = [o.strip() for o in f["o"].split("|")], int(f["c"])
                    it = {"cat": "quiz", "tag": b["tag"], "quiz": {"uz": f["uz"], "en": f["en"], "options": opts, "correct": right,
                                                                  "explanation": {"uz": f["xu"], "en": f["xe"]}}}
                elif cat == "poll":
                    it = {"cat": "poll", "tag": b["tag"], "poll": {"uz": f["uz"], "en": f["en"], "options": [o.strip() for o in f["o"].split("|")]}}
                else:
                    it = {"cat": cat, "tag": b["tag"], "uz": f["uz"], "en": f["en"]}
                    if b["img"]: it["img"] = b["img"] + ".jpg"
                if "when" in f: it["when"] = json.loads(f["when"])
            except Exception as e:   # a missing key / a bad number / bad json
                errors.append(f"{b['src']}: {e!r}"); continue
            if it.get("img") and not os.path.exists(os.path.join(IMG, it["img"])):
                errors.append(f"{b['src']}: picture {it['img']} not found"); continue
            n = count[cat] = count.get(cat, 0) + 1
            it["id"] = f"{PREFIX[cat]}{n:03d}"
            items.append({"id": it.pop("id"), **it})
    # the right answer should not always sit at the same place: rows with a natural order (numbers, times) and two-option questions stay as written (half of
    # the number rows are written backwards); in all the others the right option goes where the answer is least often, the rest in a seeded random order
    quizzes = [x for x in items if x["cat"] == "quiz"]; pos = [0] * 10
    for x in quizzes:
        q = x["quiz"]; rng = random.Random(x["id"] + q["uz"])
        if fixed_order(q["options"]):
            if len(q["options"]) >= 3 and rng.random() < 0.5: q["options"], q["correct"] = q["options"][::-1], len(q["options"]) - 1 - q["correct"]
            pos[q["correct"]] += 1
    for x in quizzes:
        q = x["quiz"]; rng = random.Random(x["id"] + q["uz"])
        if fixed_order(q["options"]) or re.search(r"YO'Q|NOT", q["uz"] + q["en"]): 
            continue
        low = min(pos[:len(q["options"])]); target = rng.choice([i for i in range(len(q["options"])) if pos[i] == low])
        q["options"], q["correct"] = place(q["options"], q["correct"], target, rng); pos[target] += 1
    for x in quizzes:                                  # the questions that say NOT keep the order as written, but still count
        q = x["quiz"]
        if not fixed_order(q["options"]) and re.search(r"YO'Q|NOT", q["uz"] + q["en"]): pos[q["correct"]] += 1
    order = list(PREFIX)
    items.sort(key=lambda x: (order.index(x["cat"]), x["id"]))
    json.dump(items, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    hist = [0] * 10
    for x in items:
        if x["cat"] == "quiz": hist[x["quiz"]["correct"]] += 1
    print("right answer position (quizzes):", {i: n for i, n in enumerate(hist) if n})
    print(f"{len(items)} posts -> {os.path.relpath(OUT, ROOT)}: " + ", ".join(f"{k} {v}" for k, v in sorted(count.items(), key=lambda kv: order.index(kv[0]))))
    # the same checks the server runs when it loads the bank
    js = ("const p=require('./server/chan_plan'),fs=require('fs');const b=p.makeBank(JSON.parse(fs.readFileSync('server/channel_bank.json','utf8')),[],{hasImg:f=>fs.existsSync('server/channel/'+f)});"
          "console.log(b.problems.length?b.problems.join('\\n'):'lint: all posts fine');")
    r = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True)
    print((r.stdout + r.stderr).strip())
    if errors:
        print("\n".join("ERROR " + e for e in errors)); sys.exit(1)
    if "lint: all posts fine" not in r.stdout:
        sys.exit(1)


if __name__ == "__main__":
    main()
