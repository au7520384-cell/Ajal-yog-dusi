#!/usr/bin/env node
// A picture card for every checked quiz of the channel bank: node tools/build_quiz_cards.js [--only Q001,Q002] [--preview]
// 1080 x 1080 JPG, server/channel/qc_<id>.jpg: the question in Uzbek and English, the options A-D and the gift line. The channel sends the card first and the quiz poll right under it
// (a poll cannot carry a picture); the same cards serve Instagram / Facebook posts. Needs: playwright. Text comes from server/channel_bank.json.
const { chromium } = require("playwright"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "server", "channel");
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "channel_bank.json"), "utf8")).filter(x => x.cat === "quiz" && /^Q\d+$/.test(x.id));
const only = (process.argv.find(a => a.startsWith("--only=")) || (process.argv.includes("--only") ? "--only=" + process.argv[process.argv.indexOf("--only") + 1] : "")).slice(7).split(",").filter(Boolean);
const cap = s => { const a = Array.from(String(s)); return a.length ? a[0].toLocaleUpperCase() + a.slice(1).join("") : ""; };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const split = t => { const m = /^(\S+)\s+(?:Viktorina|Quiz):\s*(.*)$/su.exec(t); return m ? { icon: m[1], text: m[2] } : { icon: "🎱", text: t.replace(/^(?:Viktorina|Quiz):\s*/, "") }; };
const HUES = [[212, 175, 55], [90, 200, 130], [100, 170, 255], [255, 130, 130], [190, 140, 255], [255, 170, 80]];   // the gold stays, the glow colour changes from card to card
const html = (it, n) => {
  const q = it.quiz, u = split(q.uz), e = split(q.en), [r, g, b] = HUES[n % HUES.length], L = "ABCD";
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:1080px;height:1080px;overflow:hidden;font-family:"DejaVu Sans","Noto Sans",sans-serif;color:#fff;background:radial-gradient(circle at 50% 18%,rgba(${r},${g},${b},.28),transparent 55%),radial-gradient(circle at 15% 95%,rgba(40,90,190,.5),transparent 55%),linear-gradient(160deg,#101a3c,#070b1c);position:relative}
.frame{position:absolute;inset:26px;border:3px solid #d4af37;border-radius:34px;box-shadow:inset 0 0 40px rgba(212,175,55,.25),0 0 30px rgba(212,175,55,.3)}
.in{position:absolute;inset:26px;padding:46px 60px 40px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:2px;color:#d4af37;font-size:28px}
.badge{background:linear-gradient(#ffe27a,#d4af37);color:#2a1d00;padding:8px 26px;border-radius:30px;font-size:26px;letter-spacing:3px}
.ic{font-size:86px;text-align:center;margin:18px 0 4px;line-height:1.1}
#q{font-weight:800;text-align:center;line-height:1.22;font-size:54px;margin:6px 0 4px}
#e{text-align:center;color:#aebbe0;line-height:1.25;font-size:30px;margin:2px 0 18px;font-style:italic}
.opts{display:flex;flex-direction:column;gap:12px;margin-top:auto}
.o{display:flex;align-items:center;gap:18px;background:rgba(255,255,255,.07);border:2px solid rgba(212,175,55,.55);border-radius:22px;padding:11px 20px;font-size:36px;font-weight:700;line-height:1.15}
.o i{flex:none;width:52px;height:52px;border-radius:50%;background:linear-gradient(#ffe27a,#c89a1a);color:#2a1d00;font-style:normal;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:30px}
.gift{margin-top:16px;text-align:center;font-size:28px;font-weight:800;color:#7dffa0}
</style><div class="frame"></div><div class="in">
<div class="top"><span>🎱 ROYAL BILLIARD 8</span><span class="badge">VIKTORINA</span></div>
<div class="ic">${u.icon}</div><div id="q">${esc(cap(u.text))}</div><div id="e">${esc(cap(e.text))}</div>
<div class="opts">${q.options.map((o, i) => `<div class="o"><i>${L[i]}</i><span>${esc(o)}</span></div>`).join("")}</div>
<div class="gift">🎁 To'g'ri javob = o'yinda 300 tanga · 300 coins</div></div>
<script>(function(){const body=document.querySelector(".in"),lim=body.clientHeight;const els=[["#q",54,34],["#e",30,22]];let guard=0;
while(body.scrollHeight>lim+1&&guard++<60){let moved=false;for(const [s,mx,mn] of els){const el=document.querySelector(s),f=parseFloat(getComputedStyle(el).fontSize);if(f>mn){el.style.fontSize=(f-2)+"px";moved=true;}}
document.querySelectorAll(".o").forEach(o=>{const f=parseFloat(getComputedStyle(o).fontSize);if(f>24&&guard>8){o.style.fontSize=(f-1)+"px";moved=true;}});if(!moved)break;}document.title=body.scrollHeight>lim+1?"OVERFLOW":"ok";})();</script>`;
};
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 })).newPage(); let n = 0, bad = [];
  for (const [i, it] of bank.entries()) {
    if (only.length && !only.includes(it.id)) continue;
    await p.setContent(html(it, i)); await p.waitForTimeout(60);
    if ((await p.title()) === "OVERFLOW") bad.push(it.id);
    await p.screenshot({ path: path.join(OUT, `qc_${it.id}.jpg`), type: "jpeg", quality: 82 }); n++;
  }
  await b.close(); console.log(`${n} cards in server/channel/qc_*.jpg` + (bad.length ? `, text too long for: ${bad.join(" ")}` : ", all fit"));
})();
