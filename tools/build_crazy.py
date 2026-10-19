#!/usr/bin/env python3
"""Builds the CrazyGames variant: python3 tools/build_crazy.py [out_dir]  -> bilyard8-crazy.zip
Same game, but ads / cloud save / mute / loading+gameplay events go through the CrazyGames SDK v3.
No Google/Facebook login, no real-money shop, no legal links, no service worker."""
import sys, zipfile, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, "index.html"), encoding="utf-8").read()

def sub(old, new, count=1):
    global src
    assert src.count(old) >= 1, "missing: " + old[:60]
    src = src.replace(old, new, count)

sub("<head>", '<head>\n<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>')
# portal mode on: no card shop, no Google/Facebook, no service worker, server taken from CONFIG
sub("const ON_PORTAL = /(^|\\.)y8\\.com$", "const CRAZY_BUILD = true;\nconst ON_PORTAL = CRAZY_BUILD || /(^|\\.)y8\\.com$")
sub("function y8Init() {\n", "function y8Init() {\nif (CRAZY_BUILD) return crazyInit();\n")
CRAZY_JS = r'''
function crazyInit() {
const CG = () => window.CrazyGames && window.CrazyGames.SDK;
const bye = () => Promise.resolve();
let playing = false;
const run = async () => {
const sdk = CG(); if (!sdk) return;
try { await sdk.init(); } catch (e) { console.warn("CrazyGames init failed", e); return; }
try { sdk.game.loadingStart(); } catch (e) {}
Y8.sdk = {
showAd(o) {
return new Promise(resolve => {
const type = o.type === "reward" ? "rewarded" : "midgame";
let got = false;
sdk.ad.requestAd(type, {
adStarted: () => { try { o.beforeAd && o.beforeAd(); } catch (e) {} },
adFinished: () => { got = true; o.adViewed && o.adViewed(); o.adBreakDone && o.adBreakDone(); resolve(); },
adError: () => { o.adDismissed && o.adDismissed(); o.adBreakDone && o.adBreakDone(); resolve(); },
});
});
},
saveData(o) { try { sdk.data.setItem(o.key, o.value); } catch (e) {} return bye(); },
loadData(o) { try { return Promise.resolve(sdk.data.getItem(o.key)); } catch (e) { return Promise.resolve(null); } },
awardAchievement: bye, saveLeaderboardScore: bye, trackCustomEvent: bye, showAchievements: bye, showLeaderboard: bye, login() {},
};
Y8.adsReady = true; Y8.user = {nickname: ""};
cloudSaveHook = y8QueueSave;
y8LoadCloud();
updateY8Ui();
try {
const apply = s => { if (s && typeof s.muteAudio === "boolean") Snd.setMuted(s.muteAudio || !!profile.muted); };
apply(sdk.game.settings); sdk.game.addSettingsChangeListener(apply);
} catch (e) {}
try { sdk.game.loadingStop(); } catch (e) {}
// invite link: a friend who opens it lands straight in the lobby (IsInstantMultiplayer)
try {
const rid = String(sdk.game.getInviteParam("roomId") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
if (rid.length >= 4) setTimeout(() => lobbyJoin(rid), 3000);
} catch (e) {}
setInterval(() => {
try { if (mode === "game" && !playing) { playing = true; sdk.game.gameplayStart(); } else if (mode !== "game" && playing) { playing = false; sdk.game.gameplayStop(); } } catch (e) {}
}, 1000);
};
if (CG()) run(); else window.addEventListener("load", run, {once: true});
}
'''
CRAZY_JS += r'''
function crazyInvite(code) {
try {
const g = window.CrazyGames.SDK.game;
const link = g.inviteLink({roomId: code});
try { navigator.clipboard.writeText(link); } catch (e) {}
g.showInviteButton({roomId: code});
toast("🔑", `${T("Kod")}: ${code}`, T("Havola nusxalandi — do'stingizga yuboring!"));
} catch (e) {}
}
function crazyInviteHide() { try { window.CrazyGames.SDK.game.hideInviteButton(); } catch (e) {} }
'''
sub("function y8LoadCloud() {", CRAZY_JS + "function y8LoadCloud() {")
# keep the player's own name; no Y8 nickname
sub('String(Y8.user.nickname || "O\'yinchi"', 'String((!CRAZY_BUILD && Y8.user.nickname) || "O\'yinchi"')
sub('"☁️", T("Saqlangan o\'yin yuklandi"), "Y8")', '"☁️", T("Saqlangan o\'yin yuklandi"), CRAZY_BUILD ? "" : "Y8")')
# lobby invite through the CrazyGames invite link / button
sub('else { const link = location.origin + location.pathname + "?join=" + code;', 'else if (CRAZY_BUILD) crazyInvite(code);\nelse { const link = location.origin + location.pathname + "?join=" + code;')
sub('const fail = msg => { if (done) return; done = true;', 'const fail = msg => { if (done) return; done = true; if (CRAZY_BUILD) crazyInviteHide();')
sub('if (done) return; done = true; clearTimeout(timer);\nconst o = m.opp', 'if (done) return; done = true; clearTimeout(timer); if (CRAZY_BUILD) crazyInviteHide();\nconst o = m.opp')
# hide Y8-only UI
sub("${Y8.sdk ? `<div class=\"card\"", "${!CRAZY_BUILD && Y8.sdk ? `<div class=\"card\"")
sub('<button class="btn orange y8ad" id="y8Lb" style="display:none;padding:8px 14px;font-size:16px">🏆 Y8</button>', '')
sub('$("y8Lb").onclick =', 'if ($("y8Lb")) $("y8Lb").onclick =')
sub('<div id="hLegal"><a href="/terms" target="_blank">Terms of Service</a> · <a href="/privacy" target="_blank">Privacy Policy</a> · <a href="/refund" target="_blank">Refund Policy</a></div>', '<div id="hLegal"></div>')

out = sys.argv[1] if len(sys.argv) > 1 else root
os.makedirs(out, exist_ok=True)
z = os.path.join(out, "bilyard8-crazy.zip")
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("index.html", src)
    for f in ["icon.svg", "favicon-48.png", "icon-192.png", "icon-512.png"]:
        p = os.path.join(root, f)
        if os.path.exists(p): zf.write(p, f)
open(os.path.join(out, "crazy_index.html"), "w", encoding="utf-8").write(src)
print(z, os.path.getsize(z))
