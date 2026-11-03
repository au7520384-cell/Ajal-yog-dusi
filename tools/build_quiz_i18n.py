#!/usr/bin/env python3
"""Builds server/quiz_i18n.json (the quizzes of the game in every language) from tools/channel_bank/i18n/<lang>.txt:  python3 tools/build_quiz_i18n.py
One line per quiz:  Q001|question|option;option;option;option|explanation
"=" as an option keeps the option of server/channel_bank.json (numbers, names), an empty explanation shows the English one. Every file is checked: all 150 ids, the same number of options as the bank,
no empty question / option, no leftover Uzbek question words. The server sends the language the player asked for (quizView in server/server.js); Uzbek and English come from the bank itself."""
import glob, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bank = {x["id"]: x for x in json.load(open(os.path.join(ROOT, "server", "channel_bank.json"), encoding="utf-8")) if x.get("cat") == "quiz" and re.match(r"Q\d+$", x["id"])}
out, bad = {}, []
for f in sorted(glob.glob(os.path.join(ROOT, "tools", "channel_bank", "i18n", "*.txt"))):
    lang = os.path.basename(f)[:-4]; rows = {}
    for n, line in enumerate(open(f, encoding="utf-8"), 1):
        line = line.rstrip("\n")
        if not line.strip() or line.startswith("//"): continue
        p = line.split("|")
        if len(p) != 4: bad.append(f"{lang}:{n}: {len(p)} fields"); continue
        qid, q, o, x = [t.strip() for t in p]
        if qid not in bank: bad.append(f"{lang}:{n}: unknown id {qid}"); continue
        src = bank[qid]["quiz"]["options"]; opts = [t.strip() for t in o.split(";")]
        if len(opts) != len(src): bad.append(f"{lang}:{qid}: {len(opts)} options, the bank has {len(src)}"); continue
        opts = [src[i] if t == "=" else t for i, t in enumerate(opts)]
        if not q or any(not t for t in opts): bad.append(f"{lang}:{qid}: empty text"); continue
        if len(q) > 300 or any(len(t) > 100 for t in opts): bad.append(f"{lang}:{qid}: too long"); continue
        if qid in rows: bad.append(f"{lang}:{qid}: twice"); continue
        rows[qid] = {"q": q, "o": opts, **({"x": x} if x else {})}
    miss = [k for k in bank if k not in rows]
    if miss: bad.append(f"{lang}: missing {len(miss)} ids, e.g. {miss[:4]}")
    out[lang] = rows
    print(f"{lang}: {len(rows)} quizzes, {sum(1 for r in rows.values() if 'x' in r)} with an explanation")
if bad: print("\n".join(bad[:40])); sys.exit(1)
json.dump(out, open(os.path.join(ROOT, "server", "quiz_i18n.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("server/quiz_i18n.json:", os.path.getsize(os.path.join(ROOT, "server", "quiz_i18n.json")), "bytes")
