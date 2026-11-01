// Runs INSIDE the game page (tools/build_channel_banners.js injects it after the game has loaded): it needs the game's own art (IMG, CUES, STK_ART, LEAGUE_IMG ...)
// and its font (Philosopher). B.render(spec) builds one 1280x720 banner in a fixed overlay; the driver takes the screenshot.
(() => {
  const W = 1280, H = 720, NS = "http://www.w3.org/2000/svg", SHOTS = "/server/channel/";
  const rng = seed => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const div = (style, html) => { const e = document.createElement("div"); e.style.cssText = style; if (html != null) e.innerHTML = html; return e; };
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const GOLD_TEXT = "linear-gradient(#fffbe3 0%,#ffe27a 30%,#ffb52e 62%,#c9780f 100%)";

  // ---- art sources: a key of the game's IMG, "cue:<id>", "stk:<pack>:<n>", "lg:<n>", "shot:<name of a picture in server/channel>"
  function src(k) {
    if (!k) return "";
    if (k.startsWith("cue:")) { const c = CUES.find(x => x.id === k.slice(4)); return c && c.art; }
    if (k.startsWith("stk:")) { const [, p, i] = k.split(":"); return STK_ART[p][+i]; }
    if (k.startsWith("lg:")) return LEAGUE_IMG[+k.slice(3)];
    if (k.startsWith("tier:") || k.startsWith("cat:")) { const [t, v, n] = k.split(":"), l = CUES.filter(c => c.art && (t === "tier" ? c.tier === v : c.cat === v)); const c = l[(+n || 0) % l.length]; return c && c.art; }
    if (k.startsWith("shot:")) return SHOTS + k.slice(5) + ".jpg";
    return IMG[k] || k;
  }

  function defs() {
    if (document.getElementById("bnDefs")) return;
    const s = document.createElementNS(NS, "svg"); s.id = "bnDefs"; s.setAttribute("width", 0); s.setAttribute("height", 0); s.style.cssText = "position:fixed;left:-10px;top:-10px";
    s.innerHTML = `<defs>
      <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe3"/><stop offset=".3" stop-color="#ffe27a"/><stop offset=".62" stop-color="#ffb52e"/><stop offset="1" stop-color="#c9780f"/></linearGradient>
      <radialGradient id="gCoin" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#fff8cc"/><stop offset=".42" stop-color="#ffcb3d"/><stop offset="1" stop-color="#b4690a"/></radialGradient>
      <linearGradient id="gRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c0"/><stop offset="1" stop-color="#d98f12"/></linearGradient>
      <radialGradient id="gBall" cx=".34" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="#fff" stop-opacity=".0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
      <filter id="fBlur" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="9"/></filter>
    </defs>`;
    document.body.appendChild(s);
  }

  // ---- text
  function measure(text, fs, weight) { const c = measure.c || (measure.c = document.createElement("canvas").getContext("2d")); c.font = `${weight || 700} ${fs}px Philosopher`; return c.measureText(text).width; }
  function balance(t) {   // 1-3 lines of about the same length
    if (t.includes("\n")) return t.split("\n");
    const words = t.split(/\s+/), n = t.length <= 15 ? 1 : t.length <= 34 ? 2 : 3; if (words.length < 2 || n === 1) return [t];
    const target = t.length / n, lines = []; let cur = "";
    for (const w of words) { if (cur && (cur + " " + w).length > target * 1.18 && lines.length < n - 1) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    lines.push(cur); return lines;
  }
  function titleSVG(text, maxW, maxFs, minFs, one) {   // big gold lettering: a soft glow, a dark outline, a gold gradient
    const lines = one ? [String(text).toUpperCase()] : balance(String(text).toUpperCase()), unit = Math.max(...lines.map(l => measure(l, 100))) / 100;
    const fs = Math.max(minFs || 46, Math.min(maxFs || 112, maxW / unit)), lh = fs * 1.02, w = Math.ceil(unit * fs) + 40, h = Math.ceil(lines.length * lh + fs * 0.3) + 30;
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", w); svg.setAttribute("height", h); svg.style.cssText = "display:block;overflow:visible";
    lines.forEach((l, i) => {
      for (const layer of ["glow", "outline", "fill"]) {
        const t = document.createElementNS(NS, "text"); t.setAttribute("x", 20); t.setAttribute("y", 20 + fs * 0.82 + i * lh); t.setAttribute("font-family", "Philosopher"); t.setAttribute("font-weight", 700); t.setAttribute("font-size", fs); t.setAttribute("stroke-linejoin", "round"); t.textContent = l;
        if (layer === "glow") { t.setAttribute("fill", "#ffa81c"); t.setAttribute("stroke", "#ff9400"); t.setAttribute("stroke-width", fs * 0.2); t.setAttribute("filter", "url(#fBlur)"); t.setAttribute("opacity", 0.6); }
        if (layer === "outline") { t.setAttribute("fill", "#3a1800"); t.setAttribute("stroke", "#3a1800"); t.setAttribute("stroke-width", fs * 0.17); }
        if (layer === "fill") { t.setAttribute("fill", "url(#gGold)"); t.setAttribute("stroke", "#8a4700"); t.setAttribute("stroke-width", fs * 0.018); }
        svg.appendChild(t);
      }
    });
    svg.dataset.fs = fs; svg.dataset.lines = lines.length; return svg;
  }

  // ---- drawn art: coins, balls, sparkles, rays
  const coinG = (x, y, r, tilt, rot, num) => { const ry = r * tilt, th = r * 0.17;
    return `<g transform="translate(${x} ${y}) rotate(${rot})"><ellipse cx="0" cy="${th}" rx="${r}" ry="${ry}" fill="#8a4f05"/><rect x="${-r}" y="0" width="${2 * r}" height="${th}" fill="#a35c07"/><ellipse cx="0" cy="${th}" rx="${r}" ry="${ry}" fill="#a35c07"/>
      <ellipse cx="0" cy="0" rx="${r}" ry="${ry}" fill="url(#gCoin)" stroke="url(#gRim)" stroke-width="${r * 0.07}"/><ellipse cx="0" cy="0" rx="${r * 0.72}" ry="${ry * 0.72}" fill="none" stroke="#bf780f" stroke-width="${r * 0.05}" opacity=".85"/>
      <g transform="scale(1 ${tilt})"><text x="0" y="${r * 0.34}" text-anchor="middle" font-family="Philosopher" font-weight="700" font-size="${r * 0.95}" fill="#b36c06" opacity=".92">${num || 8}</text></g></g>`; };
  const BALLS = ["#f2c500", "#1a5fd6", "#d8281e", "#6a2a9e", "#f07c10", "#12a14a", "#8a1c24", "#141414"];
  const ballG = (x, y, r, n) => { const stripe = n > 8, c = BALLS[((stripe ? n - 8 : n) - 1) % 8], id = "bc" + Math.round(x) + "_" + Math.round(y);
    return `<g transform="translate(${x} ${y})"><defs><clipPath id="${id}"><circle r="${r}"/></clipPath></defs>${stripe ? `<circle r="${r}" fill="#f4f4ec"/><rect x="${-r}" y="${-r * 0.55}" width="${2 * r}" height="${r * 1.1}" fill="${c}" clip-path="url(#${id})"/>` : `<circle r="${r}" fill="${c}"/>`}<circle r="${r * 0.46}" fill="#fff"/><text y="${r * 0.19}" text-anchor="middle" font-family="Philosopher" font-weight="700" font-size="${r * 0.62}" fill="#111">${n}</text><circle r="${r}" fill="url(#gBall)"/></g>`; };
  const starG = (x, y, s, o) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0,-1 L.22,-.22 L1,0 L.22,.22 L0,1 L-.22,.22 L-1,0 L-.22,-.22Z" fill="#fff6c4" opacity="${o}"/>`;

  function svgLayer(html, z) { const s = document.createElementNS(NS, "svg"); s.setAttribute("width", W); s.setAttribute("height", H); s.setAttribute("viewBox", `0 0 ${W} ${H}`); s.style.cssText = `position:absolute;left:0;top:0;z-index:${z || 5};pointer-events:none`; s.innerHTML = html; return s; }
  function pile(R, n, seed, rmin, rmax) {   // a heap of gold coins inside the rectangle R = {x, y, w, h}
    const r = rng(seed), list = []; for (let i = 0; i < n; i++) list.push({x: R.x + r() * R.w, y: R.y + Math.pow(r(), 0.8) * R.h, r: rmin + r() * (rmax - rmin), tilt: 0.4 + r() * 0.3, rot: (r() - 0.5) * 70, n: 8});
    list.sort((a, b) => a.y - b.y); return list.map(c => coinG(c.x, c.y, c.r, c.tilt, c.rot, c.n)).join("");
  }
  function sparkles(R, n, seed, smax) { const r = rng(seed); let h = ""; for (let i = 0; i < n; i++) h += starG(R.x + r() * R.w, R.y + r() * R.h, 5 + r() * (smax || 16), 0.35 + r() * 0.6); return h; }
  const rays = (cx, cy, size, z, col) => div(`position:absolute;left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;z-index:${z || 2};border-radius:50%;background:repeating-conic-gradient(from 7deg, ${col || "rgba(255,226,140,.26)"} 0 5deg, transparent 5deg 15deg);-webkit-mask-image:radial-gradient(closest-side, #000 18%, transparent 98%);mask-image:radial-gradient(closest-side, #000 18%, transparent 98%)`);
  const glow = (cx, cy, r, col, z) => div(`position:absolute;left:${cx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px;z-index:${z || 3};border-radius:50%;background:radial-gradient(closest-side, ${col || "rgba(255,206,92,.62)"}, rgba(255,150,30,.18) 55%, transparent 100%)`);

  // ---- pictures
  function img(k, o) {   // o: {cx, cy, h | w, rot, flip, round, ring, glow, op, z}
    const e = document.createElement("img"); e.src = src(k); e.draggable = false;
    const filt = o.noshadow ? "" : `drop-shadow(0 14px 16px rgba(0,0,0,.6)) drop-shadow(0 0 ${o.glow === undefined ? 20 : o.glow}px rgba(255,190,70,.38))`;
    e.style.cssText = `position:absolute;left:${o.cx}px;top:${o.cy}px;${o.h ? `height:${o.h}px;` : ""}${o.w ? `width:${o.w}px;` : ""}transform:translate(-50%,-50%) rotate(${o.rot || 0}deg)${o.flip ? " scaleX(-1)" : ""};z-index:${o.z || 6};${filt ? `filter:${filt};` : ""}${o.op ? `opacity:${o.op};` : ""}${o.round ? `border-radius:50%;border:${o.ring || 5}px solid ${o.col || "#ffd24d"};box-shadow:0 8px 18px rgba(0,0,0,.6),0 0 22px ${o.col || "#ffd24d"}99;object-fit:cover;` : ""}`;
    return e;
  }
  function shot(k, o) {   // a screenshot of the game in a gold frame
    const w = o.w || 560, h = Math.round(w * 9 / 16), box = div(`position:absolute;left:${o.cx}px;top:${o.cy}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${o.rot === undefined ? -3 : o.rot}deg);z-index:${o.z || 8};padding:6px;border-radius:20px;background:linear-gradient(135deg,#fff3b0,#e8a21c 45%,#8a4f05);box-shadow:0 22px 34px rgba(0,0,0,.65),0 0 34px rgba(255,190,70,.45)`);
    const i = document.createElement("img"); i.src = src("shot:" + k); i.style.cssText = `width:100%;height:100%;border-radius:15px;object-fit:cover;display:block${o.pos ? ";object-position:" + o.pos : ""}${o.zoom ? `;transform:scale(${o.zoom})` : ""}`;
    const wrap = div("width:100%;height:100%;border-radius:15px;overflow:hidden"); wrap.appendChild(i); box.appendChild(wrap); return box;
  }

  // ---- hero presets: lists of drawing instructions in the right part of the banner
  const HERO = {
    cups4: () => [["cup_c1", {cx: 655, cy: 468, h: 400, rot: -3}], ["cup_c2", {cx: 1160, cy: 468, h: 470, rot: 3}], ["cup_c3", {cx: 815, cy: 440, h: 500, rot: -2}], ["cup_c4", {cx: 970, cy: 400, h: 620}]],
    cupWorld: () => [["cup_c4", {cx: 955, cy: 385, h: 650}]],
    dailyCups: () => [["cup_daily0", {cx: 800, cy: 215, h: 290}], ["cup_daily1", {cx: 1040, cy: 215, h: 290}], ["cup_daily2", {cx: 800, cy: 505, h: 290}], ["cup_daily3", {cx: 1040, cy: 505, h: 290}]],
    events3: () => [["frame:ev_gm", {cx: 800, cy: 430, h: 270, rot: -6}], ["frame:ev_sg", {cx: 1150, cy: 430, h: 270, rot: 6}], ["frame:ev_sd", {cx: 975, cy: 370, h: 330}]],
    tables3: () => [["frame:shot:t_mad", {cx: 950, cy: 190, h: 220, rot: -4}], ["frame:shot:t_veg", {cx: 1060, cy: 390, h: 220, rot: 3}], ["frame:shot:t_tas", {cx: 930, cy: 590, h: 220, rot: -3}]],
    rack: () => [["svg", rackSVG()]], ghost: () => [["svg", ghostSVG()]], cueBall: () => [["svg", cueBallSVG()]],
    chest: () => [["chest", {cx: 940, cy: 400, h: 390}], ["gi_crown", {cx: 1075, cy: 250, h: 190, rot: 14}], ["gi_gem", {cx: 810, cy: 280, h: 150, rot: -12}]],
    gifts: () => [["gi_car", {cx: 770, cy: 470, h: 230, rot: -6}], ["gi_jet", {cx: 1110, cy: 205, h: 220, rot: 8}], ["gi_crown", {cx: 940, cy: 250, h: 240}], ["gi_bike", {cx: 1130, cy: 470, h: 210, rot: 6}], ["gi_gem", {cx: 940, cy: 520, h: 190}], ["gi_cake", {cx: 790, cy: 235, h: 170, rot: -8}], ["gi_ball", {cx: 1210, cy: 330, h: 150, rot: 10}], ["gi_clover", {cx: 690, cy: 345, h: 130, rot: -10}]],
    rings: ks => grid(ks || ["rg_lon", "rg_tas", "rg_mos", "rg_par", "rg_nyc", "rg_tok"], 3, {x: 640, y: 150, w: 600, h: 470}, 205),
    avatarsFree: () => grid(["pv0", "pv9", "pv14", "pv20", "pv33", "pv41", "pv55", "pv62", "pv71"].map(k => ({k, round: 1})), 3, {x: 700, y: 110, w: 540, h: 520}, 150),
    avatarsPremium: () => grid([0, 8, 20, 30, 40, 50, 60, 65, 69].map(i => { const r = RARITY[GA_PRICE[i][2]]; return {k: "ga" + i, round: 1, col: r[1]}; }), 3, {x: 700, y: 110, w: 540, h: 520}, 150),
    frames: ks => grid((ks || [["fa5", "pv9"], ["fa10", "pv33"], ["fa19", "pv14"], ["fa25", "pv55"], ["fa33", "pv41"], ["fa0", "pv20"]]).map(([f, a]) => ({k: f, under: a})), 3, {x: 700, y: 150, w: 540, h: 460}, 190),
    mic: () => [["svg", micSVG(955, 330)]],
    uzFlag: () => [["svg", uzFlagSVG(950, 340)]],
    fireworks: () => [["svg", fireworksSVG()]],
    stickers: ks => grid((ks || ["stk:fun:0", "stk:bil:1", "stk:hrt:0", "stk:ani:0", "stk:fod:0", "stk:mag:1", "stk:fun:3", "stk:ani:3", "stk:hrt:4"]).map(k => ({k})), 3, {x: 700, y: 110, w: 540, h: 520}, 160),
    medals: () => grid([0, 5, 12, 20, 3, 9, 15, 25, 31].map(i => ({k: "md" + i})), 3, {x: 700, y: 110, w: 540, h: 520}, 160),
    leagues: () => grid([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({k: "lg:" + i})), 5, {x: 640, y: 190, w: 600, h: 340}, 112),
    globe: () => [["wk_globe", {cx: 950, cy: 380, h: 420}]],
    cues: ks => (ks || ["cue:olov", "cue:ajdar", "cue:galaktika", "cue:afsona", "cue:s4"]).map((k, i, a) => [k, {cx: 970 + (i - (a.length - 1) / 2) * 30, cy: 395 + (i - (a.length - 1) / 2) * 62, w: 760, rot: -24 + i * 1.6, glow: 14}]),
    boxes: () => [["bx_leg", {cx: 940, cy: 420, h: 370}], ["bx_epic", {cx: 735, cy: 500, h: 220, rot: -6}], ["bx_rare", {cx: 1150, cy: 500, h: 220, rot: 6}]],
    shield: () => [["nv_club", {cx: 950, cy: 380, h: 330}]],
    trophy: () => [["cx_hero", {cx: 950, cy: 380, h: 380}]],
    pass: () => [["nv_pass", {cx: 940, cy: 330, h: 230, rot: -8}], ["chest", {cx: 1010, cy: 500, h: 250}], ["gi_crown", {cx: 800, cy: 450, h: 170, rot: -10}]],
    daily: () => [["cx_daily", {cx: 950, cy: 330, h: 300}], ["chest", {cx: 810, cy: 530, h: 190}], ["gi_gem", {cx: 1120, cy: 520, h: 150}]],
    wheel: () => [["svg", wheelSVG(950, 380, 220)]],
    target: () => [["svg", targetSVG(950, 380, 210)]],
    balls: () => [["svg", ballsSVG()]],
    cityCards: ks => (ks || ["lc_lon", "lc_mad", "lc_tok", "lc_dub", "lc_tas"]).map((k, i) => ["card", {k, cx: 190 + i * 225, cy: 470, w: 205, rot: (i - 2) * 3}]),
  };
  function grid(items, cols, R, size) {   // items: keys or {k, round, col, under}; centres of the cells inside R
    const rows = Math.ceil(items.length / cols), cw = R.w / cols, ch = R.h / rows, out = [];
    items.forEach((it, i) => { const o = typeof it === "string" ? {k: it} : it, c = i % cols, r = Math.floor(i / cols), cx = R.x + cw * (c + 0.5), cy = R.y + ch * (r + 0.5);
      if (o.under) out.push([o.under, {cx, cy, h: size * 0.64, round: 1, ring: 0, noshadow: 1, z: 5}]);
      out.push([o.k, {cx, cy, h: o.round ? size * 0.8 : size, rot: (i % 3 - 1) * 2, round: o.round, col: o.col, ring: 4, z: 6}]); });
    return out;
  }
  function wheelSVG(cx, cy, r) {
    const cols = ["#e8362a", "#2a6fe0", "#27b24a", "#f5b81c", "#8a3bd6", "#f07c10", "#12b3b3", "#e84a9a"]; let s = "";
    s += `<circle cx="${cx}" cy="${cy}" r="${r + 26}" fill="#000" opacity=".35" filter="url(#fBlur)"/><circle cx="${cx}" cy="${cy}" r="${r + 18}" fill="url(#gRim)" stroke="#7a3d00" stroke-width="5"/>`;
    for (let i = 0; i < 8; i++) { const a0 = (i * 45 - 90 - 22.5) * Math.PI / 180, a1 = a0 + Math.PI / 4, x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      s += `<path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" fill="${cols[i]}" stroke="#fff6c0" stroke-width="4"/>`;
      const am = (a0 + a1) / 2, tx = cx + r * 0.68 * Math.cos(am), ty = cy + r * 0.68 * Math.sin(am), lab = ["500", "5", "1 000", "35", "2 000", "25", "1", "15"][i];
      s += `<circle cx="${tx}" cy="${ty}" r="${r * 0.13}" fill="#fff" opacity=".9"/><text x="${tx}" y="${ty + 9}" text-anchor="middle" font-family="Philosopher" font-weight="700" font-size="${lab.length > 3 ? 21 : 27}" fill="#2a1a00">${lab}</text>`; }
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, x = cx + (r + 9) * Math.cos(a), y = cy + (r + 9) * Math.sin(a); s += `<circle cx="${x}" cy="${y}" r="5" fill="${i % 2 ? "#fff6c0" : "#ff6a3a"}"/>`; }
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="url(#gCoin)" stroke="#7a3d00" stroke-width="5"/><text x="${cx}" y="${cy + 17}" text-anchor="middle" font-family="Philosopher" font-weight="700" font-size="52" fill="#8a4700">8</text>`;
    s += `<path d="M${cx - 24},${cy - r - 36} L${cx + 24},${cy - r - 36} L${cx},${cy - r + 14}Z" fill="#e8362a" stroke="#fff6c0" stroke-width="5" stroke-linejoin="round"/>`; return s;
  }
  function targetSVG(cx, cy, r) {
    let s = `<circle cx="${cx}" cy="${cy}" r="${r + 22}" fill="#000" opacity=".35" filter="url(#fBlur)"/><circle cx="${cx}" cy="${cy}" r="${r + 12}" fill="url(#gRim)" stroke="#7a3d00" stroke-width="5"/>`;
    ["#1b4fb8", "#f4f4f4", "#d8281e", "#f4f4f4", "#1b4fb8"].forEach((c, i) => { s += `<circle cx="${cx}" cy="${cy}" r="${r * (1 - i * 0.18)}" fill="${c}" stroke="#2a1a00" stroke-width="2"/>`; });
    s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="url(#gCoin)" stroke="#7a3d00" stroke-width="3"/><text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="Philosopher" font-weight="700" font-size="34" fill="#8a4700">8</text>`;
    s += `<g transform="translate(${cx + 8} ${cy - 4}) rotate(-38)"><rect x="-6" y="-300" width="12" height="300" rx="5" fill="#3a2a1a"/><path d="M-6,-300 L0,-330 L6,-300Z" fill="#ddd"/><path d="M-6,-6 L-26,22 L0,8 L26,22 L6,-6Z" fill="#d8281e"/></g>`; return s;
  }
  function micSVG(cx, cy) {
    let s = `<ellipse cx="${cx}" cy="${cy + 215}" rx="150" ry="22" fill="#000" opacity=".4"/>`;
    for (let i = 1; i <= 3; i++) { const r = 150 + i * 62; s += `<path d="M${cx - r * 0.78},${cy - 30} A${r},${r} 0 0 0 ${cx - r * 0.78},${cy + 110}" fill="none" stroke="#7dff8a" stroke-width="${10 - i * 2}" stroke-linecap="round" opacity="${0.85 - i * 0.2}"/><path d="M${cx + r * 0.78},${cy - 30} A${r},${r} 0 0 1 ${cx + r * 0.78},${cy + 110}" fill="none" stroke="#7dff8a" stroke-width="${10 - i * 2}" stroke-linecap="round" opacity="${0.85 - i * 0.2}"/>`; }
    s += `<path d="M${cx - 105},${cy + 10} v40 a105,105 0 0 0 210,0 v-40" fill="none" stroke="url(#gRim)" stroke-width="20" stroke-linecap="round"/><rect x="${cx - 14}" y="${cy + 150}" width="28" height="62" fill="url(#gRim)"/><rect x="${cx - 74}" y="${cy + 204}" width="148" height="18" rx="9" fill="url(#gRim)"/>`;
    s += `<rect x="${cx - 72}" y="${cy - 190}" width="144" height="262" rx="72" fill="#1c2a4a" stroke="url(#gRim)" stroke-width="10"/>`;
    for (let i = 0; i < 8; i++) s += `<line x1="${cx - 60}" y1="${cy - 140 + i * 26}" x2="${cx + 60}" y2="${cy - 140 + i * 26}" stroke="#ffd75a" stroke-width="4" opacity=".55"/>`;
    s += `<ellipse cx="${cx - 24}" cy="${cy - 120}" rx="14" ry="50" fill="#fff" opacity=".18"/>`; return s;
  }
  function uzFlagSVG(cx, cy) {
    const x = cx - 260, y = cy - 140, w = 520, h = 260, hh = h / 3; let s = `<ellipse cx="${cx}" cy="${y + h + 70}" rx="260" ry="20" fill="#000" opacity=".35"/><rect x="${x - 18}" y="${y - 26}" width="14" height="${h + 150}" rx="7" fill="url(#gRim)"/><circle cx="${x - 11}" cy="${y - 34}" r="14" fill="url(#gCoin)"/>`;
    s += `<g transform="rotate(-2 ${cx} ${cy})"><rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="#0099b5"/><rect x="${x}" y="${y + hh}" width="${w}" height="${hh}" fill="#fff"/><rect x="${x}" y="${y + 2 * hh}" width="${w}" height="${hh}" fill="#1eb53a"/><rect x="${x}" y="${y + hh - 5}" width="${w}" height="6" fill="#ce1126"/><rect x="${x}" y="${y + 2 * hh - 1}" width="${w}" height="6" fill="#ce1126"/>`;
    s += `<circle cx="${x + 62}" cy="${y + hh / 2}" r="30" fill="#fff"/><circle cx="${x + 73}" cy="${y + hh / 2}" r="27" fill="#0099b5"/>`;
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]].forEach(([i, r], k) => { const sx = x + 118 + i * 26 + (r === 0 ? 26 : r === 1 ? 13 : 0), sy = y + 24 + r * 22; s += starG(sx, sy, 8, 1).replace('fill="#fff6c4"', 'fill="#fff"'); });
    s += `</g>`; return s;
  }
  function fireworksSVG() {
    let s = ""; const cols = ["#ffd24d", "#ff6a5a", "#6ae0ff", "#9dff7a", "#ff8ad8"], r = rng(99);
    [[820, 190, 120, 0], [1100, 230, 150, 1], [960, 470, 170, 2], [720, 520, 95, 3], [1190, 520, 100, 4]].forEach(([x, y, R, ci]) => { for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12 + r() * 0.1, r0 = R * 0.22, r1 = R * (0.75 + r() * 0.3); s += `<line x1="${x + r0 * Math.cos(a)}" y1="${y + r0 * Math.sin(a)}" x2="${x + r1 * Math.cos(a)}" y2="${y + r1 * Math.sin(a)}" stroke="${cols[ci]}" stroke-width="${4 + r() * 3}" stroke-linecap="round" opacity=".9"/><circle cx="${x + r1 * 1.08 * Math.cos(a)}" cy="${y + r1 * 1.08 * Math.sin(a)}" r="${3 + r() * 3}" fill="#fff"/>`; } s += `<circle cx="${x}" cy="${y}" r="${R * 0.12}" fill="#fff" opacity=".9"/>`; });
    return s;
  }
  function rackSVG() {   // 15 balls in a triangle, the apex to the left
    const r = 44, dx = r * 1.74, cx = 790, cy = 385; let s = `<path d="M${cx - 44},${cy} L${cx + 4 * dx + 62},${cy - 5 * r - 20} L${cx + 4 * dx + 62},${cy + 5 * r + 20}Z" fill="none" stroke="url(#gRim)" stroke-width="12" stroke-linejoin="round" opacity=".9"/>`, n = 0; const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
    for (let c = 0; c < 5; c++) for (let k = 0; k <= c; k++) { const x = cx + 16 + c * dx, y = cy + (k - c / 2) * 2 * r * 0.99; s += `<ellipse cx="${x + 6}" cy="${y + r * 0.9}" rx="${r * 0.85}" ry="${r * 0.18}" fill="#000" opacity=".3"/>` + ballG(x, y, r * 0.96, order[n++]); }
    return s;
  }
  function ghostSVG() {   // the "ghost ball" aim diagram: cue ball, the ghost position, the object ball and the pocket
    let s = `<circle cx="1120" cy="190" r="72" fill="#0b0f18" stroke="url(#gRim)" stroke-width="10"/><path d="M1000,320 L1120,190" stroke="#ffd24d" stroke-width="8" stroke-dasharray="4 18" stroke-linecap="round"/><path d="M745,520 L880,410" stroke="#fff" stroke-width="8" stroke-dasharray="4 18" stroke-linecap="round"/>`;
    s += `<circle cx="890" cy="402" r="60" fill="#ffffff22" stroke="#fff" stroke-width="6" stroke-dasharray="11 10"/>` + ballG(1000, 320, 60, 1) + `<circle cx="745" cy="520" r="60" fill="#f6f6ee"/><circle cx="745" cy="520" r="60" fill="url(#gBall)"/>`;
    s += `<text x="1010" y="475" text-anchor="middle" font-family="Philosopher" font-weight="700" font-size="34" fill="#ffe9a8">ghost ball</text><path d="M960,448 L915,420" stroke="#ffe9a8" stroke-width="4" stroke-linecap="round"/>`; return s;
  }
  function cueBallSVG() {
    let s = `<ellipse cx="960" cy="590" rx="190" ry="26" fill="#000" opacity=".4"/><circle cx="960" cy="390" r="190" fill="#f4f4ec"/><circle cx="960" cy="390" r="190" fill="url(#gBall)"/>`;
    s += `<circle cx="1004" cy="330" r="22" fill="#e8362a" stroke="#fff" stroke-width="4"/><path d="M1004,330 L1090,250" stroke="#ffd24d" stroke-width="7" stroke-dasharray="3 14" stroke-linecap="round"/>`;
    s += `<g transform="translate(690 640) rotate(-35)"><rect x="0" y="-12" width="520" height="24" rx="12" fill="url(#gRim)"/><rect x="0" y="-12" width="140" height="24" rx="12" fill="#3a2a1a"/><rect x="505" y="-12" width="22" height="24" rx="6" fill="#7ab8ff"/></g>`; return s;
  }
  function ballsSVG() { let s = ""; [[800, 520, 78, 8], [925, 560, 70, 3], [1050, 515, 74, 1], [870, 400, 72, 5], [1000, 420, 70, 6], [1130, 400, 66, 2], [930, 285, 68, 4], [1060, 300, 64, 7]].forEach(([x, y, r, n]) => { s += `<ellipse cx="${x + 8}" cy="${y + r * 0.92}" rx="${r * 0.9}" ry="${r * 0.2}" fill="#000" opacity=".4"/>` + ballG(x, y, r, n); }); return s; }

  // ---- the banner
  async function render(spec) {
    defs();
    const old = document.getElementById("bn"); if (old) old.remove();
    const root = div(`position:fixed;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;z-index:2147483647;background:#06101f;font-family:Philosopher,Georgia,serif;color:#fff`); root.id = "bn"; document.body.appendChild(root);
    if (spec.raw) return renderRaw(root, spec);
    const hasHero = !!(spec.hero || spec.shot), textW = spec.textW || (hasHero ? 520 : 900);
    // 1) background art, blurred a little and darkened, plus a tint
    const bg = typeof spec.bg === "string" ? {k: spec.bg} : (spec.bg || {k: "tour_bg"});
    const bgEl = div(`position:absolute;inset:-30px;background:url("${src(bg.k)}") ${bg.pos || "center"}/cover no-repeat;filter:blur(${bg.blur === undefined ? 3 : bg.blur}px) brightness(${bg.dim || 0.7}) saturate(${bg.sat || 1.15});z-index:0`); root.appendChild(bgEl);
    if (bg.tint) root.appendChild(div(`position:absolute;inset:0;background:${bg.tint};mix-blend-mode:${bg.blend || "soft-light"};z-index:1`));
    // 2) shade: the left side (text) is darker
    root.appendChild(div(`position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,rgba(4,8,20,.92) 0%,rgba(4,8,20,.72) ${hasHero ? 38 : 60}%,rgba(4,8,20,.15) ${hasHero ? 72 : 100}%,rgba(4,8,20,0) 100%),radial-gradient(ellipse at 50% 120%,rgba(0,0,0,.65),transparent 60%),radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,.45) 100%)`));
    // 3) light behind the hero
    const hc = spec.glowAt || [950, 385];
    if (hasHero && spec.glow !== false) { root.appendChild(rays(hc[0], hc[1], 1050, 3, spec.rays)); root.appendChild(glow(hc[0], hc[1], 380, spec.glowCol, 3)); }
    // 4) hero art
    const ops = []; for (const e of (typeof spec.hero === "string" ? [{preset: spec.hero, keys: spec.heroKeys}] : (spec.hero || []))) { if (Array.isArray(e)) ops.push(e); else ops.push(...HERO[e.preset](e.keys)); }
    const svgBits = [];
    for (const [k, o] of ops) {
      if (k === "svg") { svgBits.push(o); continue; }
      if (k === "card") { const c = div(`position:absolute;left:${o.cx}px;top:${o.cy}px;width:${o.w}px;aspect-ratio:3/2;transform:translate(-50%,-50%) rotate(${o.rot}deg);padding:5px;border-radius:16px;background:linear-gradient(135deg,#fff3b0,#e8a21c 45%,#8a4f05);box-shadow:0 16px 26px rgba(0,0,0,.6);z-index:7`); const w = div("width:100%;height:100%;border-radius:12px;overflow:hidden"); const i = document.createElement("img"); i.src = src(o.k); i.style.cssText = "width:100%;height:100%;object-fit:cover;display:block"; w.appendChild(i); c.appendChild(w); root.appendChild(c); continue; }
      if (k.startsWith("frame:")) { const f = div(`position:absolute;left:${o.cx}px;top:${o.cy}px;height:${o.h}px;box-sizing:border-box;transform:translate(-50%,-50%) rotate(${o.rot || 0}deg);padding:6px;border-radius:20px;background:linear-gradient(135deg,#fff3b0,#e8a21c 45%,#8a4f05);box-shadow:0 18px 28px rgba(0,0,0,.65),0 0 28px rgba(255,190,70,.4);z-index:${o.z || 7}`); const i = document.createElement("img"); i.src = src(k.slice(6)); i.style.cssText = "height:100%;display:block;border-radius:15px"; f.appendChild(i); root.appendChild(f); continue; }
      root.appendChild(img(k, o));
    }
    // 5) drawn extras: svg art, coin heaps, sparkles
    let extra = svgBits.join("");
    if (spec.coins) { const c = spec.coins === true ? {x: 650, y: 560, w: 600, h: 120, n: 22} : spec.coins; extra += pile(c, c.n || 20, hashStr(spec.key || spec.title), c.rmin || 20, c.rmax || 34); }
    if (hasHero && spec.sparks !== false) extra += sparkles({x: 620, y: 40, w: 640, h: 640}, 22, hashStr(spec.title) ^ 7, 15);
    if (extra) root.appendChild(svgLayer(extra, spec.coinsFront ? 9 : 5));
    // 6) a screenshot of the game in a frame
    if (spec.shot) { const s = typeof spec.shot === "string" ? {k: spec.shot} : spec.shot; root.appendChild(shot(s.k, {cx: 955, cy: 385, w: 600, ...s})); }
    // 7) the text column
    const col = div(`position:absolute;left:64px;top:0;width:${textW}px;height:${H}px;display:flex;flex-direction:column;justify-content:${spec.top ? "flex-start" : "center"};${spec.top ? "padding-top:46px;box-sizing:border-box;" : ""}z-index:12`); root.appendChild(col);
    const bd = spec.badge ? (typeof spec.badge === "string" ? {t: spec.badge} : spec.badge) : null, red = bd && (bd.red || /yangi|new/i.test(bd.t));
    const pill = bd ? `<span style="margin-left:6px;padding:4px 18px;border-radius:10px;background:${red ? "linear-gradient(#ff8a6a,#e0281e 55%,#a81408)" : "linear-gradient(#fff3b0,#ffc13a 50%,#e0901a)"};color:${red ? "#fff" : "#3a1800"};font:700 30px Philosopher;letter-spacing:2px;border:2px solid ${red ? "#ffd0c0" : "#fff8d0"};box-shadow:0 4px 0 rgba(0,0,0,.4),0 0 20px ${red ? "#ff4a2a88" : "#ffb02088"};text-shadow:${red ? "0 2px 0 #7a0c04" : "0 1px 0 #fff6"}">${bd.t}</span>` : "";
    col.appendChild(div(`display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:14px;font:700 25px Philosopher;letter-spacing:4px;color:#ffd75a;text-shadow:0 2px 6px #000;white-space:nowrap`, `<span style="display:inline-block;width:34px;height:3px;background:#ffd75a;box-shadow:0 0 8px #ffb02088"></span>${(spec.kicker || "ROYAL BILLIARD 8").toUpperCase()}${pill}`));
    const t = titleSVG(spec.title, textW, spec.maxFs || 118, spec.minFs || 46, spec.oneLine); t.style.cssText += ";margin-left:-20px;margin-bottom:6px"; col.appendChild(t);
    if (spec.sub) col.appendChild(div(`font:700 ${spec.subFs || 38}px/1.18 Philosopher;color:#fff;text-shadow:0 3px 8px #000,0 0 18px #000;max-width:${textW}px;margin-top:2px`, spec.sub));
    if (spec.en) col.appendChild(div(`font:400 ${spec.enFs || 26}px/1.25 Philosopher;color:#c9d6ff;text-shadow:0 2px 6px #000;max-width:${textW}px;margin-top:10px;font-style:italic`, spec.en));
    if (spec.chips && spec.chips.length) col.appendChild(div("display:flex;gap:10px;margin-top:22px", spec.chips.map(c => `<div style="display:flex;align-items:center;gap:10px;padding:6px 16px 6px 8px;border-radius:999px;background:rgba(10,18,40,.82);border:2px solid #ffd24d;box-shadow:0 0 16px #ffb02055;font:700 27px Philosopher;color:#fff;white-space:nowrap">${c.coin === false ? "" : `<svg width="36" height="36" viewBox="-22 -22 44 44"><g>${coinG(0, 0, 19, 1, 0, 8)}</g></svg>`}<span style="line-height:1">${c.t}<small style="display:block;font:400 15px Philosopher;color:#ffd75a;letter-spacing:1px;margin-top:2px">${c.s || ""}</small></span></div>`).join("")));
    // 8) the button-like call to action and the bot's name
    const cta = div(`position:absolute;left:64px;bottom:40px;z-index:12;display:flex;align-items:center;gap:16px`, `<div style="display:flex;align-items:center;gap:12px;padding:10px 26px 10px 18px;border-radius:999px;background:linear-gradient(#7dff8a,#1fb84a 55%,#0e8a34);border:3px solid #eaffd0;box-shadow:0 6px 0 #0a5a22,0 0 22px #3dff7a66;font:700 29px Philosopher;color:#fff;text-shadow:0 2px 0 #0a5a22;letter-spacing:1px"><span style="display:inline-block;width:0;height:0;border-left:20px solid #fff;border-top:12px solid transparent;border-bottom:12px solid transparent;filter:drop-shadow(0 2px 0 #0a5a22)"></span>${spec.cta || "BEPUL O'YNANG"}</div><span style="font:700 26px Philosopher;color:#ffe9a8;text-shadow:0 2px 6px #000">@Billiard8PoolBot</span>`); root.appendChild(cta);
    // wait for the pictures and the font
    await document.fonts.load("700 60px Philosopher", String(spec.title) + (spec.sub || "") + (spec.kicker || "") + "ROYAL BILLIARD 8 BEPUL O'YNANG 0123456789"); await document.fonts.load("400 26px Philosopher", String(spec.en || spec.sub || "x")); await document.fonts.ready;
    await Promise.all([...root.querySelectorAll("img")].map(i => i.decode().catch(() => 0)));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  }
  async function renderRaw(root, spec) {   // the game's own key art as it is (the logo picture), with the call to action at the bottom
    root.appendChild(div(`position:absolute;inset:0;background:url("${src(spec.raw)}") center/cover no-repeat;z-index:0`));
    root.appendChild(div("position:absolute;left:0;right:0;bottom:0;height:200px;z-index:2;background:linear-gradient(transparent,rgba(3,8,22,.88))"));
    if (spec.line) root.appendChild(div(`position:absolute;left:0;right:0;bottom:104px;z-index:12;text-align:center;font:700 54px Philosopher;letter-spacing:3px;color:#fff;text-shadow:0 3px 10px #000,0 0 24px #000`, spec.line));
    root.appendChild(div(`position:absolute;left:0;right:0;bottom:34px;z-index:12;display:flex;align-items:center;justify-content:center;gap:22px`, `<div style="display:flex;align-items:center;gap:12px;padding:10px 28px 10px 18px;border-radius:999px;background:linear-gradient(#7dff8a,#1fb84a 55%,#0e8a34);border:3px solid #eaffd0;box-shadow:0 6px 0 #0a5a22,0 0 22px #3dff7a66;font:700 29px Philosopher;color:#fff;text-shadow:0 2px 0 #0a5a22;letter-spacing:1px"><span style="display:inline-block;width:0;height:0;border-left:20px solid #fff;border-top:12px solid transparent;border-bottom:12px solid transparent"></span>${spec.cta || "BEPUL O'YNANG"}</div><span style="font:700 28px Philosopher;color:#ffe9a8;text-shadow:0 2px 6px #000">@Billiard8PoolBot</span>`));
    await document.fonts.load("700 54px Philosopher", String(spec.line || "") + "BEPUL O'YNANG @Billiard8PoolBot"); await document.fonts.ready;
    await Promise.all([...root.querySelectorAll("img")].map(i => (i.complete && i.naturalWidth) ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    const probe = new Image(); probe.src = src(spec.raw); await probe.decode().catch(() => 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  }
  // the city banners: a blurred landmark as the air around, the table of the game in a frame, the name in gold
  async function renderCity(c) {
    const spec = {key: "city_" + c.id, bg: {k: "lc_" + c.id, blur: 7, dim: 0.62, sat: 1.25}, kicker: `SHAHAR STOLI · ${c.no} / 30`, title: c.uz, sub: c.sub, en: c.en, textW: 520, maxFs: 112, glow: false, sparks: false,
      chips: [{t: fmt(c.fee), s: "KIRISH"}, {t: fmt(c.prize), s: "YUTUQ"}], hero: [], badge: c.badge, glowAt: [960, 380]};
    await render(spec);
    const root = document.getElementById("bn");
    root.appendChild(shot("t_" + c.id, {cx: 965, cy: 330, w: 600, rot: -2, z: 8}));
    const card = div(`position:absolute;left:1030px;top:548px;width:300px;aspect-ratio:3/2;transform:translate(-50%,-50%) rotate(3deg);padding:5px;border-radius:16px;background:linear-gradient(135deg,#fff3b0,#e8a21c 45%,#8a4f05);box-shadow:0 16px 26px rgba(0,0,0,.6);z-index:9`);
    const w = div("width:100%;height:100%;border-radius:12px;overflow:hidden"), i = document.createElement("img"); i.src = src("lc_" + c.id); i.style.cssText = "width:100%;height:100%;object-fit:cover;display:block"; w.appendChild(i); card.appendChild(w); root.appendChild(card);
    await Promise.all([...root.querySelectorAll("img")].map(im => im.decode().catch(() => 0))); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  }
  window.B = {render, renderCity, remove() { const e = document.getElementById("bn"); if (e) e.remove(); }};
})();
