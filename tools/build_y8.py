#!/usr/bin/env python3
"""Y8 upload zip (its HTML is made English for the ad network: tools/portal_html.py):  python3 tools/build_y8.py [out_dir]  -> bilyard8-y8.zip  (index.html + img/ + a/ + icon.svg)
The old Y8 zip was ONE 40 MB index.html with every picture inside it: the player stared at a black screen for about a minute while the browser read it.
This one is the light build (tools/build_web.py: a ~2.5 MB page, pictures and sounds are separate files that load when the game shows them), made for a portal:
the API stays on CONFIG.server (Render), no service worker, no HD pack, no download screen (index.html skips it on y8.com / inside a frame).
Y8 rules are unchanged: real-money buttons are hidden there (NO_CARD) and prices are "watch N ads"; the Y8 SDK gives login, cloud save, ads, leaderboard."""
import os, re, sys, shutil, subprocess, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "y8_site"))
env = dict(os.environ, INLINE_UNDER="6000", NO_ZIP="1"); env.pop("SAME_ORIGIN", None)
tmp = out + "_light"
subprocess.check_call([sys.executable, os.path.join(root, "tools", "build_web.py"), tmp], env=env, cwd=root)
if os.path.isdir(out): shutil.rmtree(out)
os.makedirs(out)
shutil.copytree(os.path.join(tmp, "img"), os.path.join(out, "img")); shutil.copytree(os.path.join(tmp, "a"), os.path.join(out, "a"))
shutil.copy(os.path.join(tmp, "index.html"), os.path.join(out, "index.html")); shutil.copy(os.path.join(root, "icon.svg"), os.path.join(out, "icon.svg"))
shutil.rmtree(tmp)
# Y8 (Nov 16): "the static HTML text is Uzbek ... Google judges the page from its HTML ... Uzbek isn't a supported publisher language, so AdX declines the in-game requests": the raw HTML of the page is English (tools/portal_html.py)
sys.path.insert(0, os.path.join(root, "tools")); import portal_html
ip = os.path.join(out, "index.html"); html = open(ip, encoding="utf-8").read()
html, moved = portal_html.english_static(html); left = portal_html.leftover(html)
if left or moved < 50 or not re.search(r'<html\b[^>]*\blang="en"', html[:2000], re.I): sys.exit(f"the Y8 page's HTML is not English: {moved} pieces moved, left over: {left[:5]}")
open(ip, "w", encoding="utf-8").write(html); print("static text moved out of the markup:", moved, "(lang=en)")
z = os.path.join(root, "bilyard8-y8.zip")
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
    for dp, dn, fn in os.walk(out):
        for f in sorted(fn): p = os.path.join(dp, f); zf.write(p, os.path.relpath(p, out))
n = sum(len(f) for _, _, f in os.walk(out))
print(n, "files;", "index.html", os.path.getsize(os.path.join(out, "index.html")), "bytes;", "zip", os.path.getsize(z), "bytes ->", z)
