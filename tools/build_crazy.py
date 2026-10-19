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
const apply = s => { if (!s) return; if (typeof s.muteAudio === "boolean") Snd.setMuted(s.muteAudio || !!profile.muted); document.body.classList.toggle("nochat", !!s.disableChat); };
apply(sdk.game.settings); sdk.game.addSettingsChangeListener(apply);
} catch (e) {}
try { sdk.game.loadingStop(); } catch (e) {}
// invite link: a friend who opens it lands straight in the lobby (IsInstantMultiplayer)
try {
const rid = String(sdk.game.getInviteParam("roomId") || sdk.game.getInviteParam("roomName") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
if (rid.length >= 3) setTimeout(() => lobbyJoin(rid), 3000);
else if (sdk.game.isInstantMultiplayer) setTimeout(() => lobbyCreate(), 3000);   // party leader: straight into a fresh lobby, no menus
} catch (e) {}
try {
sdk.game.addJoinRoomListener(q => { const id = String((q && (q.roomId || q.roomName)) || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); if (id.length >= 3) lobbyJoin(id); });
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
sub('if (done) return; done = true; clearTimeout(timer); lobbyRematch = code;\nconst o = m.opp', 'if (done) return; done = true; clearTimeout(timer); lobbyRematch = code; if (CRAZY_BUILD) crazyInviteHide();\nconst o = m.opp')
sub("if (!code || code.length < 4) return;", "if (!code || code.length < 3) return;")
# chat stays (typed + phrases + voice) but every typed line goes through a swear filter, in and out; SDK disableChat hides all of it
FILTER_JS = r'''
const BAD_RE = /(f+u+c+k+|sh[i1]+t|b[i1]tch|a+ssh[o0]le|d[i1]ck|c[u]nt|n[i1]gg|wh[o0]re|sl[u]t|bastard|х[уy]+[йяеёию]|п[и1]зд|бл[яa]+[дт]|[еe]б[аaуyлн]|[еe]бать|сук[аи]|муд[аа]к|гандон|п[и1]д[оа]р|\bsik\b|\bsikay|qo.?t[oa]q|jalab|onangni|ammangni|nomussiz|\bkot\b|\bharom[iy]\b)/gi;
const cleanChat = s => String(s || "").replace(BAD_RE, m => "*".repeat(m.length));
'''
sub("function sendChat(msg) {", FILTER_JS + "function sendChat(msg) {\nif (CRAZY_BUILD) msg = cleanChat(msg);")
sub('Net.on("chat", m => { if (game && game.net && !game.net.spec) bubble(1, String(m.msg || "").slice(0, 40)); });', 'Net.on("chat", m => { if (game && game.net && !game.net.spec) bubble(1, (CRAZY_BUILD ? cleanChat : String)(String(m.msg || "").slice(0, 40))); });')
sub('<head>', '<head>\n<style>.nochat #gChat,.nochat #gVoice,.nochat #chatPanel,.nochat #cheerBar{display:none!important}</style>')
# hide Y8-only UI
sub("${Y8.sdk ? `<div class=\"card\"", "${!CRAZY_BUILD && Y8.sdk ? `<div class=\"card\"")
sub('<button class="btn orange y8ad" id="y8Lb" style="display:none;padding:8px 14px;font-size:16px">🏆 Y8</button>', '')
sub('$("y8Lb").onclick =', 'if ($("y8Lb")) $("y8Lb").onclick =')
sub('<div id="hLegal"><a href="/terms" target="_blank">Terms of Service</a> · <a href="/privacy" target="_blank">Privacy Policy</a> · <a href="/refund" target="_blank">Refund Policy</a></div>', '<div id="hLegal"></div>')

# light build: every embedded picture becomes a real file in img/ (no base64 growth, and a picture is only downloaded when the game actually shows it)
import re, hashlib, base64
IMGS = {}
def _ext(mt): return {"webp": "webp", "png": "png", "jpeg": "jpg", "jpg": "jpg", "gif": "gif", "svg+xml": "svg"}[mt]
SQ_P = float(os.environ.get("SQ_P", "30")); SQ_B = float(os.environ.get("SQ_B", "6"))   # per-picture safety check (PSNR dB / worst 16x16 block error)
def _ok(a, b):
    import numpy as np
    e = np.abs(a.astype(np.int16) - b.astype(np.int16)).astype(np.float32)
    mse = (e ** 2).mean()
    if mse == 0: return True
    psnr = 10 * np.log10(65025 / mse)
    h, w = e.shape[:2]; h -= h % 16; w -= w % 16
    if h == 0 or w == 0: return psnr >= SQ_P
    bl = e[:h, :w].mean(axis=2).reshape(h // 16, 16, w // 16, 16).mean(axis=(1, 3))
    return psnr >= SQ_P and np.percentile(bl, 99.5) <= SQ_B
def _squeeze(raw):
    # lowest webp quality whose result still passes the check against the original; smooth pictures (table felt) fail it and stay untouched
    try:
        import io
        import numpy as np
        from PIL import Image
        im = Image.open(io.BytesIO(raw)); im.load()
        if getattr(im, "is_animated", False): return raw
        im = im.convert("RGBA"); a = np.asarray(im)
        # smooth pictures (felt, soft shadows) show stair-step blotches when squeezed: keep them as they are
        lum = a[:, :, :3].mean(axis=2); h, w = lum.shape; h -= h % 16; w -= w % 16
        if h and w and (lum[:h, :w].reshape(h // 16, 16, w // 16, 16).std(axis=(1, 3)) < 4).mean() >= float(os.environ.get("SQ_FLAT", "0.5")): return raw
        for q in (60, 70, 80, 90):
            b = io.BytesIO(); im.save(b, "WEBP", quality=q, method=4); nb = b.getvalue()
            if len(nb) >= len(raw) * 0.9: return raw
            if _ok(a, np.asarray(Image.open(io.BytesIO(nb)).convert("RGBA"))): return nb
        return raw
    except Exception:
        return raw
def _file(m):
    mt, raw = m.group(1), base64.b64decode(m.group(2))
    if mt == "webp" and os.environ.get("SQUEEZE"): raw = _squeeze(raw)   # off by default: it left blocky patches on table felt
    if os.environ.get("SINGLE"):
        return "data:image/%s;base64,%s" % (mt, base64.b64encode(raw).decode())
    name = "img/" + hashlib.sha1(raw).hexdigest()[:14] + "." + _ext(mt)
    IMGS[name] = raw
    return name
src = re.sub(r"data:image/(webp|png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)", _file, src)

out = sys.argv[1] if len(sys.argv) > 1 else root
os.makedirs(out, exist_ok=True)
z = os.path.join(out, "bilyard8-crazy.zip")
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("index.html", src)
    for n, raw in IMGS.items(): zf.writestr(n, raw)
    for f in []:   # index.html only: the portal rejects uploads with other file types
        p = os.path.join(root, f)
        if os.path.exists(p): zf.write(p, f)
open(os.path.join(out, "crazy_index.html"), "w", encoding="utf-8").write(src)
os.makedirs(os.path.join(out, "crazy_site", "img"), exist_ok=True)
open(os.path.join(out, "crazy_site", "index.html"), "w", encoding="utf-8").write(src)
for n, raw in IMGS.items(): open(os.path.join(out, "crazy_site", n), "wb").write(raw)
print(len(IMGS), "images,", sum(map(len, IMGS.values())), "bytes; index.html", len(src.encode()))
print(z, os.path.getsize(z))
