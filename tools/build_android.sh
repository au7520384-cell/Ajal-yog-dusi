#!/usr/bin/env bash
# The game's files for the Android app (Capacitor WebView):  bash tools/build_android.sh   -> android/www/
# The light build (pictures as files, API = CONFIG.server) WITHOUT the HD pack (it is downloaded later from the server, see README) and WITHOUT real-money card buttons
# (Google Play wants Google Play Billing for coins / items: until it is added the shop offers only the ad-based unlocks).
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
open(f, "w", encoding="utf-8").write(s)
print("android/www ready: no HD pack, card buttons off")
PY
du -sh "$OUT"
