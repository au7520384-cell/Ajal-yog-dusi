#!/usr/bin/env python3
"""GameMonetize "delta" zip:  python3 tools/gm_delta.py <full gamemonetize zip> <out zip> [gameId]

Why (Nov 21): the portal applied a 374-byte test zip at once but never applied the full zips of v2.5 - v2.7 (36 MB, 1531 files; the Nov 16 zip with 35.2 MB / 1502 files had gone through).
The portal unpacks a zip OVER the files already on its host and the game's pictures are named by their content hash (img/<hash>.webp), so an update needs only index.html plus the pictures
the host does not have yet. This script asks the host (HEAD request for every img/ file of the full zip) and writes a zip with index.html + the missing pictures (about 2 MB instead of 36 MB).
Needs the sandbox to reach html5.gamemonetize.co (environment settings).  Afterwards check the live copy: curl -sSI https://html5.gamemonetize.co/<gameId>/index.html | grep -i last-modified
"""
import sys, zipfile, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

full, out = sys.argv[1], sys.argv[2]
gid = sys.argv[3] if len(sys.argv) > 3 else "esjcoyx21kbp842me139bq7bsc5vspio"
base = f"https://html5.gamemonetize.co/{gid}/"


def exists(name):
    try:
        req = urllib.request.Request(base + name, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=40) as r:
            return name, r.status == 200
    except urllib.error.HTTPError as e:
        return name, False if e.code == 404 else None
    except Exception:
        return name, None


zin = zipfile.ZipFile(full)
names = [n for n in zin.namelist() if n != "index.html" and not n.endswith("/")]
with ThreadPoolExecutor(12) as ex: res = list(ex.map(exists, names))
unknown = [n for n, ok in res if ok is None]
missing = [n for n, ok in res if ok is False] + unknown   # when the host cannot be asked about a file, the file goes in (safe)
if unknown: print("warning: could not ask the host about", len(unknown), "files (they are included)")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("index.html", zin.read("index.html"))
    for n in missing: z.writestr(n, zin.read(n))
print(f"{len(names)} pictures in the full zip, {len(names) - len(missing)} already on the host, {len(missing)} added; {out}: {len(missing) + 1} files")
