# Royal Billiard 8: rules that must never be broken

## 1. The HTML of every page the game ships is English: NEVER lang="uz", no Uzbek text in the HTML
The owner (Nov 16): *"never lang=uz - understood? never forget this."*

- **Why:** Y8's developer found that Google AdX judges a page from its **raw HTML** and does not serve Uzbek pages, so it declined every in-game ad request
  (`noAdPreloaded`, eCPM $0.01, no income). Details: README, section "Y8: AdX declined the page (Uzbek HTML)...".
- **What it means:** every page that leaves this repo (the website + Telegram `web/`, the Android app, Y8, Playgama, any portal) has `<html lang="en">`,
  an English `<title>` / `<noscript>`, and **no Uzbek label in its markup**. The Uzbek labels in `index.html`'s markup are only the *keys* of the translations
  (`collectStatic()` / `T()`): `tools/portal_html.py` (run by `tools/build_web.py` and `tools/build_crazy.py`) moves them into `window.__SEN`, and the page puts them back
  when it starts (`restoreStatic()`), so players see exactly what they always saw.
- **Never:** write `lang="uz"` in any HTML file, add Uzbek text to a page's HTML outside that mechanism, ship a page built without the step, or use `UZ_HTML=1`
  (the plain Uzbek page: the tests use it, the build scripts refuse it outside the temp folder).
- At run time the game still sets `document.documentElement.lang` to the **player's own language** (`applyLang()`): that is the live page, not the HTML an ad network reads.
- **Do this after ANY change of `index.html`:** rebuild `web/` (`SAME_ORIGIN=1 INLINE_UNDER=6000 NO_ZIP=1 python3 tools/build_web.py web`, run it from the repo root, then commit `web/`;
  the server only serves `web/` while `web/.src` is the sha1 of `index.html`), and run `node tools/test_html_lang.js` (about 30 s). `node tools/test_portal_html.js` (about 6 min) proves
  the game reads and looks the same in uz / en / ru / th / tr.
- The Android app gets it through `tools/build_android.sh` (it fails the build if the HTML is not English); the Y8 zip through `tools/build_y8.py`.

## 2. Y8 IDs
Royal Billiard 8 = Y8 **game `288343`**, **app `6ad579a6abe0343702b12ba1`** (`CONFIG.y8GameId` / `y8AppId` in `index.html`).
`282389` / `6a9dd9da38fed6db2f1f1339` are **Icy Tower's**: never put them back. Check an ID against README before changing it.

## 3. Builds the owner does not use
The owner said (Nov 16) that the **CrazyGames** and **GameMonetize** builds are not needed: do not build or send them. The ones the owner uses: the website + Telegram (Render), the Android app,
Y8 and Playgama (`PORTAL=playgama python3 tools/build_crazy.py <out>`).
