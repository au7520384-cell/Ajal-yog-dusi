#!/usr/bin/env bash
# The game's files for the Android app (Capacitor WebView):  bash tools/build_android.sh   -> android/www/
# The light build (pictures as files, API = CONFIG.server) WITHOUT the HD pack inside the app (the app downloads it on the first start from HD_BASE, default the Cloudflare site) and WITHOUT real-money card buttons
# (Google Play wants Google Play Billing for digital goods: the app sells the six 💎 packs through the Capacitor plugin @capgo/native-purchases - the page finds it by itself, see playOn() in index.html - and every premium thing costs 💎).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=android/www
INLINE_UNDER=6000 NO_ZIP=1 python3 tools/build_web.py "$OUT"
rm -rf "$OUT/hd" "$OUT.hd_keep"
python3 - <<'PY'
import json, re
p = "android/www/assets.json"; m = json.load(open(p)); m.pop("hd", None); open(p, "w").write(json.dumps(m, separators=(",", ":")))
f = "android/www/index.html"; s = open(f, encoding="utf-8").read()
n = s.count("const CARD_PAY = true,"); assert n == 1, n
s = s.replace("const CARD_PAY = true,", "const CARD_PAY = false,")
import os
hb = os.environ.get("HD_BASE", "https://frosty-hill-615a.au7520384.workers.dev/")   # where the HD pack is downloaded from (the static site, with CORS); "" = no HD in the app
inj = ""
if hb: inj += "window.__HD_BASE=" + json.dumps(hb) + ";"
av = os.environ.get("APP_VER", "").strip()   # "1.0.5 (14)" from the workflow's version inputs: shown on the start screen and in Settings so it is always clear which build is installed
if av: inj += "window.__APP_VER=" + json.dumps(av) + ";"
if inj:
    assert s.count("<head>") == 1; s = s.replace("<head>", "<head><script>" + inj + "</script>")
open(f, "w", encoding="utf-8").write(s)
print("android/www ready: no HD pack, card buttons off (💎 packs: Google Play Billing)")
PY
du -sh "$OUT"
