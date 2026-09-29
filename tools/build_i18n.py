#!/usr/bin/env python3
"""Rebuild the compressed translation block inside index.html from tools/xt.txt.

xt.txt format, one string per line:   uz key‖en|ru|tr|es|pt|ar|id|hi|fr|de|ko|ja|zh   (13 values)
                                  or  uz key‖tr|es|pt|ar|id|hi|fr|de|ko|ja|zh         (11 values, en/ru already in DICT)
{0} {1} are placeholders for numbers / names.  Run:  python3 tools/build_i18n.py
"""
import re, zlib, base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
xt = (root / "tools" / "xt.txt").read_text(encoding="utf8").strip("\n")
for ln in xt.split("\n"):
    k, v = ln.split("‖"); n = len(v.split("|")); assert n in (11, 13), (k, n)
blob = base64.b64encode(zlib.compress(xt.encode("utf8"), 9)).decode()
p = root / "index.html"; s = p.read_text(encoding="utf8")
s, n = re.subn(r'const XT_Z = "[^"]*";', 'const XT_Z = "%s";' % blob, s)
assert n == 1, "XT_Z marker not found"
p.write_text(s, encoding="utf8")
print("xt lines:", xt.count("\n") + 1, "blob KB:", len(blob) // 1024)
