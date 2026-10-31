#!/usr/bin/env python3
"""Builds the CrazyGames variant: python3 tools/build_crazy.py [out_dir]  -> bilyard8-crazy.zip
Same game, but ads / cloud save / mute / loading+gameplay events go through the CrazyGames SDK v3.
No Google/Facebook login, no real-money shop, no legal links, no service worker.
PORTAL=playgama python3 tools/build_crazy.py [out_dir]  -> bilyard8-playgama.zip: the same portal game on the Playgama Bridge SDK
(saves only through bridge.storage, language from the platform, ads / audio / pause / game_ready as the Playgama required steps ask)."""
import sys, zipfile, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(root, "index.html"), encoding="utf-8").read()

def sub(old, new, count=1):
    global src
    assert src.count(old) >= 1, "missing: " + old[:60]
    src = src.replace(old, new, count)

PG = os.environ.get("PORTAL", "crazy") == "playgama"
PG_HEAD = r'''<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>
<script>
// Playgama: the Bridge is the first script; the game code runs only after bridge.initialize() and the saved keys are loaded (see the b8main loader at the end of the page)
(function () {
var KEYS = ["billiard8v2", "bilyard8v2", "b8guest", "b8acct", "b8finv", "b8server", "b8pn", "b8kb"];
var C = window.__B8C = {}, dirty = {}, timer = 0, B = window.bridge, live = false;
function flush() {
  clearTimeout(timer); timer = 0;
  var ks = Object.keys(dirty); if (!ks.length || !live) return; dirty = {};
  var setK = [], setV = [], del = [];
  ks.forEach(function (k) { if (k in C) { setK.push(k); setV.push(C[k]); } else del.push(k); });
  try { if (setK.length) B.storage.set(setK, setV).catch(function () {}); if (del.length) B.storage.delete(del).catch(function () {}); } catch (e) {}
}
function mark(k) { dirty[k] = 1; if (!timer) timer = setTimeout(flush, 4000); }   // changes are gathered: one write every few seconds at most, never per frame
window.__b8Put = function (k, v) { C[k] = v; mark(k); };
window.__b8Del = function (k) { delete C[k]; mark(k); };
window.__b8Flush = flush;
addEventListener("pagehide", flush); document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
window.__B8_READY = (B ? B.initialize() : Promise.reject(new Error("no bridge"))).then(function () {
  live = true;
  try { window.__B8_LANG = String(B.platform.language || "").toLowerCase().slice(0, 2); } catch (e) {}
  return B.storage.get(KEYS);
}).then(function (vals) {
  KEYS.forEach(function (k, i) { var v = vals && vals[i]; if (v !== null && v !== undefined) C[k] = typeof v === "string" ? v : JSON.stringify(v); });
}).catch(function (e) { console.warn("Playgama Bridge:", e); });
})();
</script>'''
sub("<head>", '<head>\n' + (PG_HEAD if PG else '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'))
# portal mode on: no card shop, no Google/Facebook, no service worker, server taken from CONFIG
sub("const ON_PORTAL = /(^|\\.)y8\\.com$", "const CRAZY_BUILD = true;\nconst ON_PORTAL = CRAZY_BUILD || /(^|\\.)y8\\.com$")
sub("function y8Init() {\n", "function y8Init() {\nif (CRAZY_BUILD) return " + ("playgamaInit" if PG else "crazyInit") + "();\n")
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
// the lobby (index.html) reports its life cycle here: created -> invite link + button, open(joinable?) -> room update, leave
lobbyHook = (ev, code, joinable) => {
if (ev === "created") crazyInvite(code);
else if (ev === "open") { crazyRoom(code, joinable); try { if (joinable) sdk.game.showInviteButton({roomId: code}); else sdk.game.hideInviteButton(); } catch (e) {} }
else if (ev === "leave") { crazyInviteHide(); crazyLeave(); }
};
// invite link: a friend who opens it lands straight in the lobby (IsInstantMultiplayer)
try {
const rid = String(sdk.game.getInviteParam("roomId") || sdk.game.getInviteParam("roomName") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
if (rid.length >= 3) setTimeout(() => lobbyJoin(rid), 3000);
else if (sdk.game.isInstantMultiplayer) setTimeout(() => lobbyCreate(), 3000);   // party leader: straight into a fresh lobby, no menus
} catch (e) {}
window.addEventListener("pagehide", () => { try { sdk.game.leftRoom(); } catch (e) {} });
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
const link = g.inviteLink({roomId: code}); lobbyLink = link;
try { navigator.clipboard.writeText(link).catch(() => {}); } catch (e) {}
g.showInviteButton({roomId: code});
crazyRoom(code, true);
} catch (e) {}
}
function crazyRoom(code, joinable) {
try { window.CrazyGames.SDK.game.updateRoom({roomId: code, isJoinable: !!joinable, inviteParams: {roomId: code}}); } catch (e) {}
}
function crazyLeave() { try { window.CrazyGames.SDK.game.leftRoom(); } catch (e) {} }
function crazyInviteHide() { try { window.CrazyGames.SDK.game.hideInviteButton(); } catch (e) {} }
'''
PG_JS = r'''
function playgamaInit() {
const B = window.bridge; if (!B || !B.platform) return;
const P = B.platform, A = B.advertisement || {}, EV = B.EVENT_NAME || {};
const bye = () => Promise.resolve();
let cur = null;   // the ad on screen: {kind, handle(state)}
const achSent = new Set();
const onState = kind => state => { try { if (cur && cur.kind === kind) cur.handle(String(state)); } catch (e) {} };
try { A.on(EV.INTERSTITIAL_STATE_CHANGED, onState("interstitial")); A.on(EV.REWARDED_STATE_CHANGED, onState("rewarded")); } catch (e) {}
Y8.sdk = {
// the game's own ad hook: type "reward" = rewarded video (a reward only in the "rewarded" state), anything else = an interstitial at a natural pause (Bridge decides when one is really shown)
showAd(o) {
return new Promise(resolve => {
const kind = o.type === "reward" ? "rewarded" : "interstitial";
let supported = false; try { supported = !!(kind === "rewarded" ? A.isRewardedSupported : A.isInterstitialSupported); } catch (e) {}
const call = () => kind === "rewarded" ? A.showRewarded() : A.showInterstitial("between_matches");
let over = false, guard = 0;
const end = () => { if (over) return; over = true; cur = null; clearTimeout(guard); try { o.adBreakDone && o.adBreakDone(); } catch (e) {} resolve(); };
if (!supported) { try { o.adDismissed && o.adDismissed(); } catch (e) {} return end(); }
let rewarded = false;
cur = {kind, handle: s => {
if (s === "opened") { try { o.beforeAd && o.beforeAd(); } catch (e) {} }
else if (s === "rewarded") { rewarded = true; try { o.adViewed && o.adViewed(); } catch (e) {} }
else if (s === "closed") end();
else if (s === "failed") { if (!rewarded) { try { o.adDismissed && o.adDismissed(); } catch (e) {} } end(); }
}};
guard = setTimeout(end, 120000);
try { call(); } catch (e) { end(); }
});
},
saveData: bye, loadData: bye, trackCustomEvent: bye,
// achievements: the game unlocks each one once; Bridge tracks them (locally on Playgama, natively on Y8 / Lagged, ids in the config)
awardAchievement(o) { try { const k = String(o.achievementKey || ""); if (k && !achSent.has(k) && B.achievements) { achSent.add(k); return Promise.resolve(B.achievements.unlock(k)).catch(() => {}); } } catch (e) {} return bye(); }, showAchievements: bye, showLeaderboard: bye, login() {},
// the total winnings go to the platform's leaderboard where there is one (Facebook, Yandex, Y8 ... through Playgama); on Playgama itself the type is "not_available", then nothing is sent
saveLeaderboardScore(o) { try { const L = B.leaderboards; if (L && L.type && L.type !== "not_available") return Promise.resolve(L.setScore("main", Math.max(0, Math.floor(+o.points || 0)))).catch(() => {}); } catch (e) {} return bye(); },
};
let rewardedOk = false; try { rewardedOk = !!A.isRewardedSupported; } catch (e) {}
Y8.adsReady = rewardedOk;   // the reward buttons show only where rewarded video exists
Y8.user = {nickname: ""};
updateY8Ui();
// audio: start muted when the platform says so, follow its audio and pause events (tab switch, an ad opening)
let audioOn = P.isAudioEnabled !== false, paused = false;
const applyAudio = () => { window.__B8_MUTE = !audioOn || paused; try { Snd.setMuted(!!profile.muted); } catch (e) {} };   // __B8_MUTE: the platform's silence, kept apart from the player's own mute switch
applyAudio();
try { P.on(EV.AUDIO_STATE_CHANGED, en => { audioOn = en !== false; applyAudio(); }); } catch (e) {}
try { P.on(EV.PAUSE_STATE_CHANGED, p => { paused = !!p; if (paused) { try { input.charging = false; input.drag = null; input.power = 0; } catch (e) {} } applyAudio(); }); } catch (e) {}
// the first playable frame: the logo splash is gone and the game accepts input
let sent = false;
const ready = () => { if (sent) return; sent = true; try { const r = P.sendMessage("game_ready"); if (r && r.catch) r.catch(() => {}); } catch (e) {} };
const t0 = Date.now(), iv = setInterval(() => { if (!document.getElementById("boot") || Date.now() - t0 > 7000) { clearInterval(iv); setTimeout(ready, 400); } }, 250);
}
'''
sub("function y8LoadCloud() {", (PG_JS if PG else CRAZY_JS) + "function y8LoadCloud() {")
# keep the player's own name; no Y8 nickname
sub('String(Y8.user.nickname || "O\'yinchi"', 'String((!CRAZY_BUILD && Y8.user.nickname) || "O\'yinchi"')
sub('"☁️", T("Saqlangan o\'yin yuklandi"), "Y8")', '"☁️", T("Saqlangan o\'yin yuklandi"), CRAZY_BUILD ? "" : "Y8")')
# invite: the portal allows no link to another site (the page on Render), so the friend-code share carries the code only
sub('const web = (/^https?:/.test(location.protocol)', 'const web = CRAZY_BUILD ? "" : (/^https?:/.test(location.protocol)')
# lobby invite through the CrazyGames invite link / button
# chat stays (typed + phrases + voice) but every typed line goes through a swear filter, in and out; SDK disableChat hides all of it
FILTER_JS = r'''
const BAD_RE = /(f+u+c+k+|sh[i1]+t|b[i1]tch|a+ssh[o0]le|d[i1]ck|c[u]nt|n[i1]gg|wh[o0]re|sl[u]t|bastard|х[уy]+[йяеёию]|п[и1]зд|бл[яa]+[дт]|[еe]б[аaуyлн]|[еe]бать|сук[аи]|муд[аа]к|гандон|п[и1]д[оа]р|\bsik\b|\bsikay|qo.?t[oa]q|jalab|onangni|ammangni|nomussiz|\bkot\b|\bharom[iy]\b)/gi;
const cleanChat = s => String(s || "").replace(BAD_RE, m => "*".repeat(m.length));
'''
sub("function sendChat(msg) {", FILTER_JS + "function sendChat(msg) {\nif (CRAZY_BUILD) msg = cleanChat(msg);")
sub('Net.on("chat", m => { if (game && game.net && !game.net.spec) bubble(1, String(m.msg || "").slice(0, 40)); });', 'Net.on("chat", m => { if (game && game.net && !game.net.spec) bubble(1, (CRAZY_BUILD ? cleanChat : String)(String(m.msg || "").slice(0, 40))); });')
sub('<head>', '<head>\n<style>.nochat #gChat,.nochat #gVoice,.nochat #chatPanel,.nochat #cheerBar{display:none!important}\n/* the portal has its own sign-in: no Google / Facebook / account switching / recovery-key rows in Settings */\n.setrow:has(#setLogin),.setrow:has(#setSwitch),.setrow:has(#setKey),.setrow:has(#setRecover){display:none!important}</style>')
# default language: the device language (English stays English); the country-based guess is for the standalone game only
sub('const cl = CC_LANG[profile.country || detectCountry()];', 'const cl = CRAZY_BUILD ? "" : CC_LANG[profile.country || detectCountry()];')
# the portal brings its own full-screen button and shows no outside pages: no own full-screen buttons / auto full screen, no legal links in Settings
sub("function goFullscreen(force) {\n", "function goFullscreen(force) {\nif (CRAZY_BUILD) return;\n")
sub('<button class="iconbtn" id="fsBtn" title="To\'liq ekran">⛶</button>', '')
sub('<button class="gbtn gray" id="gFs" title="To\'liq ekran">⛶</button>', '')
sub('$("fsBtn").onclick = toggleFullscreen;', 'if ($("fsBtn")) $("fsBtn").onclick = toggleFullscreen;')
sub('{ const fb = $("gFs"); const can = ', '{ const fb = $("gFs"); if (!fb) { /* CrazyGames: no own full-screen button */ } else { const can = ')
sub('document.addEventListener("webkitfullscreenchange", sync); }', 'document.addEventListener("webkitfullscreenchange", sync); } }')
sub('<br><a href="/privacy" target="_blank" style="color:#8fc4ff">${T("Maxfiylik siyosati")}</a> · <a href="/terms" target="_blank" style="color:#8fc4ff">${T("Foydalanish shartlari")}</a> · <a href="/refund" target="_blank" style="color:#8fc4ff">Refund</a></div>`;', '</div>`;')
# language: English first (CrazyGames requires English; reviewers must not meet another language by chance). The other languages stay one tap away in Settings.
sub("function detectLang() {\nconst saved = profile.lang;\nif (saved && LANGS[saved]) return saved;\n", "function detectLang() {\nconst saved = profile.lang;\nif (saved && LANGS[saved]) return saved;\n" + ("if (CRAZY_BUILD) { const l = window.__B8_LANG; return l && LANGS[l] ? l : \"en\"; }\n" if PG else "if (CRAZY_BUILD) return \"en\";\n"))   # Playgama: the platform's language is the source language; CrazyGames: English first
# hide Y8-only UI
sub("${Y8.sdk && !TG_LAUNCH ? `<div class=\"card\"", "${!CRAZY_BUILD && Y8.sdk && !TG_LAUNCH ? `<div class=\"card\"")
sub('<button class="btn orange y8ad" id="y8Lb" style="display:none;padding:8px 14px;font-size:16px">🏆 Y8</button>', '')
sub('$("y8Lb").onclick =', 'if ($("y8Lb")) $("y8Lb").onclick =')
sub('<div id="hLegal"><a href="/terms" target="_blank">Terms of Service</a> · <a href="/privacy" target="_blank">Privacy Policy</a> · <a href="/refund" target="_blank">Refund Policy</a></div>', '<div id="hLegal"></div>')

# first open: straight onto the table (practice) with the skippable pulsing-marks tutorial, no menus in the way (CrazyGames quality guideline: onboarding in gameplay)
sub("try { loginSplash(); } catch (e) {}\nrequestAnimationFrame(frame);", "try { loginSplash(); } catch (e) {}\nif (!profile.tutDone && !(profile.games | 0)) setTimeout(() => { try { if (mode !== \"game\" && !$(\"modal\").classList.contains(\"on\")) startMatch(\"practice\", CITIES[0]); } catch (e) {} }, 1500);\nrequestAnimationFrame(frame);")

# sharper picture on portals (reviewers judge the game in a small iframe on an ordinary 1x monitor): the canvas is drawn at about twice the page size (never above ~2560 px wide unless the screen itself is denser)
# and shrunk by the browser, graphics level High by default, high-quality image smoothing
sub('let gq = "mid"; try { gq = (profile.set && profile.set.gfx) || "mid"; } catch (e) {}', 'let gq = "high"; try { gq = (profile.set && profile.set.gfx) || "high"; } catch (e) {}')
sub("dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, ({low: 1.5, mid: 2, high: 2.5})[gq] || 2.5) * dprAuto);", "dpr = Math.max(1, Math.min(Math.max(window.devicePixelRatio || 1, Math.min(2, 2560 / Math.max(vw, 1))), ({low: 1.5, mid: 2, high: 2.5})[gq] || 2.5) * dprAuto);")
sub("cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);", 'cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr); try { ctx.imageSmoothingQuality = "high"; } catch (e) {}')
sub('const SET_DEF = { gfx: "mid", fps: "90"', 'const SET_DEF = { gfx: "high", fps: "90"')
# Playgama-only patches
sub('<head>', '<head>\n<style>.chanonly{display:none!important}</style>')   # the channel name switch and the channel row mean nothing on a portal
if PG:
    # saving only through Bridge Storage: the game's one save point (store) reads a cache filled from bridge.storage BEFORE the game starts; writes go back in batches
    sub("const store = {\nget(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },\nset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },\n};",
        "const store = {\nget(k, d) { try { const v = window.__B8C[k]; return v ? JSON.parse(v) : d; } catch (e) { return d; } },\nset(k, v) { try { window.__b8Put(k, JSON.stringify(v)); } catch (e) {} },\ndel(k) { try { window.__b8Del(k); } catch (e) {} },\n};")
    src = src.replace("localStorage.removeItem(", "store.del(")
    for bad in ("localStorage", "sessionStorage", "indexedDB", "document.cookie"):
        assert bad not in src, "the Playgama build must not touch " + bad
    # the platform's silence (audio off / paused) also holds for a sound engine that starts later, and survives the game's own setMuted calls
    sub("master = ac.createGain(); master.gain.value = profile.muted ? 0 : level();", "master = ac.createGain(); master.gain.value = (profile.muted || window.__B8_MUTE) ? 0 : level();")
    sub("setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : level(), ac.currentTime, 0.02); },", "setMuted(m) { if (master) master.gain.setTargetAtTime(m || window.__B8_MUTE ? 0 : level(), ac.currentTime, 0.02); },")
    # ads: no own counters or timers, Bridge decides when an interstitial is really shown; the reward gate stays only for rewarded video
    sub("if (Y8.sdk && Y8.adsReady && Y8.matches % 2 === 0 && Date.now() - Y8.lastBreak > 90000) {", "if (Y8.sdk) {")
    sub("if (!Y8.sdk || !Y8.adsReady || Y8.busy) return resolve(false);", 'if (!Y8.sdk || (type === "reward" && !Y8.adsReady) || Y8.busy) return resolve(false);')
    # the game code waits for bridge.initialize() + the stored keys: it sits in a text/plain block and a loader runs it afterwards
    OPEN = '<script>\n"use strict";'
    i = src.rfind(OPEN); assert i > 0, "main script not found"
    src = src[:i] + '<script id="b8main" type="text/plain">\n"use strict";' + src[i + len(OPEN):]
    j = src.rfind("</script>") + len("</script>")
    LOADER = """
<script>
(function () {
var go = function () {
  var t = document.getElementById("b8main"); if (!t) return;
  var s = document.createElement("script"); s.text = t.textContent; t.parentNode.removeChild(t);
  document.body.appendChild(s);
  if (document.readyState === "complete") { try { window.dispatchEvent(new Event("load")); } catch (e) {} }   // the game listens for "load": it may be over by now
};
(window.__B8_READY || Promise.resolve()).then(go, go);
})();
</script>"""
    src = src[:j] + LOADER + src[j:]
PG_ACH = [("first_win", "First Win"), ("double", "Double Pot"), ("breakpot", "Power Break"), ("runout", "Clean Table"), ("champ", "Tournament Champion"), ("lucky", "Bullseye"), ("streak7", "Loyal Player"), ("rich", "Rich"), ("collector", "Collector")]   # the game's Y8_ACH table
PG_CONFIG = '{\n  "advertisement": {\n    "minimumDelayBetweenInterstitial": 60,\n    "interstitial": {\n      "placements": [\n        {"id": "between_matches"}\n      ]\n    }\n  },\n  "leaderboards": [\n    {"id": "main", "isMain": true}\n  ],\n  "achievements": [\n' + ",\n".join('    {"id": "%s", "name": "%s", "y8": {"achievement": "%s", "achievementkey": "%s"}}' % (k, v, v, k) for k, v in PG_ACH) + '\n  ]\n}\n'

# light build: every embedded picture becomes a real file in img/ (no base64 growth, and a picture is only downloaded when the game actually shows it)
import re, hashlib, base64
IMGS = {}
def _ext(mt): return {"webp": "webp", "png": "png", "jpeg": "jpg", "jpg": "jpg", "gif": "gif", "svg+xml": "svg"}[mt]
SQ_P = float(os.environ.get("SQ_P", "36")); SQ_B = float(os.environ.get("SQ_B", "4"))   # per-picture safety check (PSNR dB / worst 16x16 block error)
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
    if os.environ.get("SINGLE") or len(raw) < int(os.environ.get("INLINE_UNDER", "0")):   # INLINE_UNDER=6000: small pictures stay inside index.html (CrazyGames allows at most 1500 files)
        return "data:image/%s;base64,%s" % (mt, base64.b64encode(raw).decode())
    name = "img/" + hashlib.sha1(raw).hexdigest()[:14] + "." + _ext(mt)
    IMGS[name] = raw
    return name
src = re.sub(r"data:image/(webp|png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)", _file, src)
# the table-rail / cue-art tables hold bare base64 WebP strings ("UklGR..."), about half of the page: files as well (the page turns a path or base64 into a source with W64(), as in build_web.py)
# Playgama build (or BARE_WEBP=1): the page drops from ~10 MB to ~5 MB, those pictures load only when a screen shows them
def _bare(m):
    raw = base64.b64decode(m.group(1))
    if len(raw) < int(os.environ.get("INLINE_UNDER", "0")): return m.group(0)
    name = "img/" + hashlib.sha1(raw).hexdigest()[:14] + ".webp"
    IMGS[name] = raw
    return '"' + name + '"'
if PG or os.environ.get("BARE_WEBP"): src = re.sub(r'"(UklGR[A-Za-z0-9+/=]{300,})"', _bare, src)

out = sys.argv[1] if len(sys.argv) > 1 else root
os.makedirs(out, exist_ok=True)
z = os.path.join(out, "bilyard8-playgama.zip" if PG else "bilyard8-crazy.zip")
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("index.html", src)
    if PG: zf.writestr("playgama-bridge-config.json", PG_CONFIG)   # next to index.html, as the Playgama required steps ask
    for n, raw in IMGS.items(): zf.writestr(n, raw)
    for f in []:   # index.html only: the portal rejects uploads with other file types
        p = os.path.join(root, f)
        if os.path.exists(p): zf.write(p, f)
open(os.path.join(out, "playgama_index.html" if PG else "crazy_index.html"), "w", encoding="utf-8").write(src)
os.makedirs(os.path.join(out, "crazy_site", "img"), exist_ok=True)
open(os.path.join(out, "crazy_site", "index.html"), "w", encoding="utf-8").write(src)
for n, raw in IMGS.items(): open(os.path.join(out, "crazy_site", n), "wb").write(raw)
print(len(IMGS), "images,", sum(map(len, IMGS.values())), "bytes; index.html", len(src.encode()))
print(z, os.path.getsize(z))
