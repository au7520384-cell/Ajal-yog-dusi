// The 1-minute promo video, part 1: records the live scenes of the real game (1920x1080) against the repo server with a cast of demo players (local accounts, not real people).
//   SP=<scratch dir> REC=1 node tools/promo_video/rec_scenes.js lobby club world gift shop vip ...      (no REC: screenshots only, saved to $SP/pv/shot_<scene>_<name>.png)
// Every scene writes $SP/pv/<scene>.webm and its marks (seconds from the start of the video) into $SP/pv/meta.json; build_full.py cuts the pieces.
const L = require('./lib'), { sleep, CAST, http, Bot, chromium } = L, fs = require('fs'), os = require('os'), path = require('path');
const SP = process.env.SP, OUT = SP + '/pv', REC = !!process.env.REC, PORT = +process.env.PORT || 8340, base = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });
const metaFile = OUT + '/meta.json', META = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile)) : {};
const MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
const launch = wav => chromium.launch({ args: [...MEDIA, ...(wav ? ['--use-file-for-fake-audio-capture=' + wav] : [])] });
const guestProfile = c => JSON.stringify({ name: c.name, tutDone: true, games: 60, genderAsked: true, gender: 'm', lang: 'en', coins: 9000000, level: c.lv, avatar: c.av, frame: c.fr, frames: [0, c.fr], country: c.cc });
const homeReady = async (p, to = 150000) => {
  try { await p.waitForFunction(() => typeof profile !== 'undefined' && typeof Net !== 'undefined' && document.getElementById('home') && !document.getElementById('boot'), null, { timeout: to }); }
  catch (e) { console.log('BOOT STUCK:', JSON.stringify(await p.evaluate(() => (document.getElementById('boot') || {}).innerText || 'no boot el').catch(x => String(x))).slice(0, 200)); await p.screenshot({ path: OUT + '/stuck.png' }).catch(() => {}); throw e; }
  await sleep(900);
};
const clean = p => p.evaluate(() => {
  window.unlock = () => {}; window.checkAch = () => {}; document.getElementById('modal').classList.remove('on'); document.querySelectorAll('.toast').forEach(e => e.remove());
  const t = document.getElementById('toasts'); if (t && !window.__tobs) { window.__tobs = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && !/💬|🌐|🎤|🎧/.test(n.textContent || '')) n.remove(); }); window.__tobs.observe(t, { childList: true, subtree: true }); }   // (only the lobby chat / world chat / voice pop-ups may show; medal and reward pop-ups of the demo account stay out of the picture)
});
const code6 = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');
// a smooth scroll of the biggest scrollable box inside a screen (the shop lists): ms long
const autoScroll = (p, sel, frac, ms) => p.evaluate(([sel, frac, ms]) => new Promise(res => {
  const root = document.querySelector(sel); let best = null; for (const e of [root, ...root.querySelectorAll('*')]) if (e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible' && (!best || e.scrollHeight > best.scrollHeight)) best = e;
  if (!best) return res('no scroller'); const a = best.scrollTop, b = a + (best.scrollHeight - best.clientHeight) * frac, t0 = performance.now();
  const f = () => { const k = Math.min(1, (performance.now() - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; best.scrollTop = a + (b - a) * e; if (k < 1) requestAnimationFrame(f); else res(best.id || best.className); }; requestAnimationFrame(f);
}), [sel, frac, ms]);

const SCENES = {
  // 8 players in one lobby, two of them really talking (a fake microphone plays speech-like sound), the others sit in through the game's own websocket
  async lobby(S) {
    const gbs = [await launch(SP + '/pv/voice_1.wav'), await launch(SP + '/pv/voice_2.wav')], pages = [];
    for (const c of [CAST[1], CAST[4]]) {   // Mia and Omar are real pages (voice); the other five are bots
      const ctx = await gbs[pages.length].newContext({ viewport: { width: 640, height: 360 }, locale: 'en-US', permissions: ['microphone'] }), p = await ctx.newPage();
      p.on('pageerror', e => console.log('GUEST', c.name, e.message.slice(0, 120)));
      await p.addInitScript(([pr, acct, av]) => { localStorage.setItem('b8_hd', 'off'); localStorage.setItem('b8_assets', av); localStorage.setItem('billiard8v2', pr); localStorage.setItem('b8acct', JSON.stringify(acct)); }, [guestProfile(c), c.acct, S.assetsV]);
      await p.goto(base + '/', { waitUntil: 'commit' }); await homeReady(p); await clean(p); pages.push({ i: CAST.indexOf(c), c, p });
    }
    const bots = []; for (const i of [0, 2, 3, 5, 6]) bots.push({ i, c: CAST[i], bot: await new Bot(base, CAST[i]).connect() });
    const { ctx, p, t0 } = await S.stage({ video: REC ? OUT + '/v_lobby' : null, toasts: true, css: '.lbslot.on.talk{border-color:#3fe052!important;box-shadow:inset 0 0 14px #3fe05299,0 0 16px #3fe052cc!important}' })   // (in the game the .lbslot.on rule comes after .lbslot.talk, so the green ring of a talking player never shows: see the report; the picture shows the ring as designed)
    const mark = () => +((Date.now() - t0) / 1000).toFixed(2), marks = {};
    await homeReady(p); await clean(p); await sleep(800);
    marks.start = mark();
    await p.evaluate(() => lbTablesOpen(false, '')); await sleep(2300); marks.chooser = mark(); await S.shot(p, 'lobby', 'chooser');
    const city = await p.evaluate(() => { const c = CITIES.find(x => x.id === 'veg') || CITIES[5]; lobbyCreate(c.id); return c.id; });
    await p.waitForFunction(() => LB && !LB.pending && LB.code, null, { timeout: 30000 }); const code = await p.evaluate(() => LB.code); await sleep(1400); marks.created = mark(); await S.shot(p, 'lobby', 'created');
    const order = [...bots.map(x => ({ ...x, kind: 'bot' })), ...pages.map(x => ({ ...x, kind: 'page' }))].sort((a, b) => a.i - b.i);
    const joinOne = async x => { if (x.kind === 'bot') x.bot.join(code, city); else await x.p.evaluate(c => lobbyJoin(c), code); await sleep(420); };
    for (const x of order.slice(0, 4)) await joinOne(x);
    await sleep(500); await p.evaluate(() => document.getElementById('lbWorld').click()); await sleep(1700); marks.posted = mark(); await S.shot(p, 'lobby', 'posted');   // "Post to world chat"
    for (const x of order.slice(4)) await joinOne(x);
    await p.waitForFunction(() => LB.players.length >= 8, null, { timeout: 30000 }); await sleep(900); marks.full = mark(); await S.shot(p, 'lobby', 'full');
    // voice: the two real pages tap the microphone, then the host
    for (const x of pages) { await x.p.waitForFunction(() => LB && !LB.pending, null, { timeout: 20000 }); await x.p.evaluate(() => document.getElementById('lbVoice').click()); await sleep(400); }
    await p.evaluate(() => document.getElementById('lbVoice').click()); marks.micOn = mark(); await sleep(2800); marks.talk = mark(); await S.shot(p, 'lobby', 'talk');
    console.log('voice:', JSON.stringify(await p.evaluate(() => ({ count: LobbyVoice.state().count, talking: [...document.querySelectorAll('.lbslot.talk')].length }))));
    // lines written by the others show up as pop-ups
    for (const [i, msg] of [[0, 'Salom hammaga! 👋'], [2, 'Ready for the cup 🔥'], [3, 'GG in advance 😄']]) { bots.find(x => x.i === i).bot.chat(msg); await sleep(1000); }
    await sleep(1800); marks.chat = mark(); await S.shot(p, 'lobby', 'chat'); await sleep(900); marks.end = mark();
    await S.finish(ctx, 'lobby', marks); for (const x of pages) await x.p.context().close(); for (const g of gbs) await g.close(); bots.forEach(x => x.bot.close());
  },

  // creating a club: the list of clubs, the emblem window (animated emblems), the new club with its members, the weekly chest and the club chat
  async club(S) {
    const { host } = S;
    for (const [c, name, badge] of [[CAST[0], 'Night Owls', 18], [CAST[1], 'Royal Cue', 2], [CAST[2], 'Desert Kings', 10]]) await http(base, c.acct, '/api/clubs/create', { name, badge, color: 0 });
    const { ctx, p, t0 } = await S.stage({ video: REC ? OUT + '/v_club' : null }), mark = () => +((Date.now() - t0) / 1000).toFixed(2), marks = {};
    await homeReady(p); await clean(p); await sleep(800); marks.start = mark();
    await p.evaluate(() => go('clubsScr')); await sleep(2500); marks.list = mark(); await S.shot(p, 'club', 'list');
    await p.click('#clubNew'); await sleep(1700); marks.modal = mark(); await S.shot(p, 'club', 'modal');
    await p.click('#cbName'); await p.keyboard.type('Royal Legends', { delay: 85 }); await sleep(500);
    await p.click('#modal [data-b="4"]'); await sleep(1300); marks.emb1 = mark(); await S.shot(p, 'club', 'emb1');
    await p.click('#modal [data-b="10"]'); await sleep(1500); marks.emb2 = mark(); await S.shot(p, 'club', 'emb2');
    await p.evaluate(() => { clubTab = 'chat'; });   // (the new club opens on its chat: the members list rows have a layout problem, see the report)
    await p.click('#mBtns .btn.green'); await sleep(2300); marks.created = mark(); await S.shot(p, 'club', 'created');
    const club = (await http(base, host.acct, '/api/clubs/mine')).club;
    for (const c of CAST.slice(3)) { await http(base, c.acct, '/api/clubs/join', { id: club.id }); await p.evaluate(() => buildClubs()); await sleep(750); }
    marks.members = mark(); await S.shot(p, 'club', 'members');
    // this week's wins, reported by the members' own devices (once each), fill the chest
    for (const c of CAST.slice(3)) await http(base, c.acct, '/api/sync', { name: c.name, wins: 3, level: c.lv });
    await http(base, host.acct, '/api/sync', { name: 'Alex', wins: 85, level: 14 }); await p.evaluate(() => buildClubs()); await sleep(2400); marks.chest = mark(); await S.shot(p, 'club', 'chest');
    for (const [c, t] of [[CAST[3], 'Welcome to Royal Legends! 👑'], [CAST[4], 'Cup tonight at 9? 🏆'], [CAST[5], 'I am in! 🎱']]) { await http(base, c.acct, '/api/clubs/chat', { text: t }); await p.evaluate(() => buildClubs()); await sleep(900); }
    await p.evaluate(() => document.getElementById('clubMsg').focus({ preventScroll: true })); await p.keyboard.type('Let\'s go, team! 🔥', { delay: 70 }); await sleep(400); await p.evaluate(() => document.getElementById('clubSend').click()); await sleep(1800); marks.chat = mark(); await S.shot(p, 'club', 'chat'); marks.end = mark();
    await S.finish(ctx, 'club', marks);
  },

  // the world chat: lines from players all over the world, stickers, lobbies looking for players, a request to join that the host accepts
  async world(S) {
    // (a framed avatar inside a wide list row gets a huge margin - see the report - so the demo players have plain avatars here; the newest lobby, on top, is the one Alex can afford)
    for (const c of CAST) await http(base, c.acct, '/api/sync', { name: c.name, frame: 0 }); await http(base, S.host.acct, '/api/sync', { name: 'Alex', frame: 0 });
    const bots = []; const hosts = [[CAST[4], 'ist'], [CAST[3], 'mad'], [CAST[2], 'tok']], codes = [];
    for (const [c, city] of hosts) { const b = await new Bot(base, c).connect(); b.autoAccept(base); const code = code6(); b.host(code, city, true); bots.push(b); codes.push([code, city]); await sleep(250); }
    for (const [i, c] of [[2, CAST[5]], [2, CAST[6]], [1, CAST[0]]]) { const b = await new Bot(base, c).connect(); b.join(codes[i][0], codes[i][1]); bots.push(b); await sleep(250); }
    await sleep(700); for (const [c] of hosts) { await http(base, c.acct, '/api/world/lobby', {}); await sleep(300); }
    const say = async (c, t, stk) => { await http(base, c.acct, '/api/world/send', stk ? { stk } : { text: t }); await sleep(420); };
    await say(CAST[1], 'Anyone up for a 1v1 in Vegas? 🎱'); await say(CAST[0], 'Salom hammaga! Turnirga qo\'shiling 🏆'); await say(CAST[2], 'GG! What a final last night 👏'); await say(CAST[3], '', '🏆');
    await say(CAST[4], 'Merhaba! Yeni kiy aldım 🔥'); await say(CAST[5], 'Looking for 2 more players — Tokyo lobby'); await say(CAST[6], 'Kim bilan o\'ynaymiz? 😎'); await say(CAST[1], '', '🦊');
    const { ctx, p, t0 } = await S.stage({ video: REC ? OUT + '/v_world' : null, profile: L.hostProfile({ frame: 0, frames: [0] }) }), mark = () => +((Date.now() - t0) / 1000).toFixed(2), marks = {};
    await homeReady(p); await clean(p); await sleep(900); marks.start = mark();
    await p.click('#hWorld'); await sleep(2800); marks.open = mark(); await S.shot(p, 'world', 'open');
    await p.click('#wChatIn'); await p.keyboard.type('Hi all! Who wants a cup match? 🏆', { delay: 65 }); await sleep(500); await p.keyboard.press('Enter'); await sleep(1600); marks.sent = mark(); await S.shot(p, 'world', 'sent');
    await say(CAST[2], 'Welcome Alex! 🙌'); await sleep(1500); marks.reply = mark();
    await p.click('#wChatEmo'); await sleep(900); await S.shot(p, 'world', 'stickers'); await p.click('#wChatEmoRow [data-s]'); await sleep(1700); marks.sticker = mark();
    const joined = await p.evaluate(() => { const b = document.querySelector('#wLobList [data-w]:not([disabled])'); if (!b) return false; b.click(); return true; }); console.log('join clicked:', joined);
    await sleep(900); await S.shot(p, 'world', 'request'); marks.request = mark(); await sleep(3200); marks.joined = mark(); await S.shot(p, 'world', 'joined'); marks.end = mark();
    await S.finish(ctx, 'world', marks); bots.forEach(b => b.close());
  },

  // the in-game moments: an AI match with a VIP cue - the break, a gift sent to the opponent, the quick chat, a few shots, the win
  async gift(S) {
    const { ctx, p, t0 } = await S.stage({ video: REC ? OUT + '/v_gift' : null, profile: L.hostProfile({ cue: 'vip_champ', cues: ['start', 'vip_champ'], coins: 900000 }) }), mark = () => +((Date.now() - t0) / 1000).toFixed(2), marks = {};
    await homeReady(p); await clean(p); await sleep(600); marks.start = mark();
    await p.evaluate(() => startMatch('ai', CITIES.find(c => c.id === 'mad'), null, null)); await p.evaluate(() => { game.cur = 0; });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await p.locator('#tutSkip').count()) await p.locator('#tutSkip').click().catch(() => {}); if (await p.evaluate(() => typeof canControl === 'function' && canControl())) break; }
    await sleep(1400); marks.ready = mark(); await S.shot(p, 'gift', 'ready');
    const settle = async cap => { await sleep(500); for (let i = 0; i < cap * 4; i++) { await sleep(250); if (await p.evaluate(() => !game.moving && !game.strike)) break; } };
    await p.evaluate(() => requestShot(0.92)); marks.break = mark(); await settle(10); await S.shot(p, 'gift', 'afterbreak'); marks.afterbreak = mark();
    for (let i = 0; i < 60; i++) { if (await p.evaluate(() => typeof canControl === 'function' && canControl())) break; await sleep(300); }   // (the opponent plays if nothing fell)
    await p.evaluate(() => openGiftPanel()); await sleep(1700); marks.panel = mark(); await S.shot(p, 'gift', 'panel');
    await p.click('[data-gi="1"]'); await sleep(450); marks.fly = mark(); await S.shot(p, 'gift', 'fly'); await sleep(1900); marks.land = mark(); await S.shot(p, 'gift', 'land');
    await p.click('#gChat'); await sleep(1100); await S.shot(p, 'gift', 'chat'); marks.chatOpen = mark();
    await p.locator('#chatPanel button', { hasText: 'Great shot' }).first().click(); await sleep(1900); marks.chatSent = mark(); await S.shot(p, 'gift', 'chatsent');
    await p.evaluate(() => { const c = document.getElementById('chatPanel'); if (c) c.classList.remove('on'); });
    await p.evaluate(() => endGame(0, 'test')); await sleep(3600); marks.win = mark(); await S.shot(p, 'gift', 'win'); await sleep(1200); marks.end = mark();
    await S.finish(ctx, 'gift', marks);
  },

  // the shop: cues, tables, avatars, frames (a slow scroll of each list)
  async shop(S) {
    const { ctx, p, t0 } = await S.stage({ video: REC ? OUT + '/v_shop' : null }), mark = () => +((Date.now() - t0) / 1000).toFixed(2), marks = {};
    await homeReady(p); await clean(p);
    for (const [tab, ms] of [['cues', 2500], ['tables', 24000], ['avatars', 6000], ['frames', 4000]]) { await p.evaluate(t => go('shop', t), tab); await sleep(ms); }   // (a first visit of each list, off the cut: the table pictures need ~20 s to be drawn once on this machine)
    await p.evaluate(() => go('home')); await sleep(1500); marks.start = mark();
    for (const tab of ['cues', 'tables', 'avatars', 'frames']) {
      const top = () => p.evaluate(() => [document.getElementById('shop'), ...document.querySelectorAll('#shop *')].forEach(e => { if (e && e.scrollTop) e.scrollTop = 0; }));
      await p.evaluate(t => go('shop', t), tab); await top(); await sleep(900); await top(); await sleep(400); marks[tab] = mark(); await S.shot(p, 'shop', tab);
      let r;
      if (tab === 'avatars') {   // the standard avatars first, then a quick fly down to the legendary / mythic ones
        await sleep(900); marks.avatars_a = mark();
        r = await p.evaluate(() => new Promise(res => { const el = [...document.querySelectorAll('#shop *')].find(e => e.children.length === 0 && /^(legendary|mythic)$/i.test((e.textContent || '').trim())); if (!el) return res('none'); let sc = el.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 40 && getComputedStyle(sc).overflowY !== 'visible')) sc = sc.parentElement; if (!sc) return res('no scroller');
          const a = sc.scrollTop, b = a + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 140, t0 = performance.now(), f = () => { const k = Math.min(1, (performance.now() - t0) / 1500), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; sc.scrollTop = a + (b - a) * e; if (k < 1) requestAnimationFrame(f); else res('jumped'); }; requestAnimationFrame(f); }));
        await sleep(500); marks.avatars_b = mark(); await autoScroll(p, '#shop', 0.05, 1500);
      } else r = await autoScroll(p, '#shop', tab === 'tables' ? 0.5 : tab === 'frames' ? 0.45 : 0.35, 2600);
      console.log('scroll', tab, r); marks[tab + '_end'] = mark(); await S.shot(p, 'shop', tab + '_end');
    }
    await S.finish(ctx, 'shop', marks);
  },

  // contact sheet of the VIP pager pages (screenshots only)
  async vipsheet(S) {
    const { ctx, p } = await S.stage({ css: '.hbuy{visibility:hidden}' }); await homeReady(p); await clean(p); await sleep(500);
    for (let k = 0; k < 26; k++) { await p.evaluate(k => { vipPage = k; vipOffers(); }, k); await sleep(1000); await S.shot(p, 'vip', 'p' + String(k).padStart(2, '0')); }
    await ctx.close();
  },

  async probe(S) {   // which fixed element draws the small "x" at the top right while a window is open (and the legal links at the bottom)?
    const { ctx, p } = await S.stage({ css: '.hbuy{visibility:hidden}' }); await homeReady(p); await clean(p); await sleep(500);
    await p.evaluate(() => { vipPage = 4; vipOffers(); }); await sleep(1200);
    console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return (cs.position === 'fixed' || cs.position === 'absolute') && ((r.left > 1840 && r.top < 70 && r.width < 90 && r.width > 4) || (r.top > 1040 && r.width > 100 && r.height < 40)); }).map(e => (e.tagName + '#' + e.id + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().left) + ',' + Math.round(e.getBoundingClientRect().top) + ' ' + (e.textContent || '').slice(0, 30))))));
    await ctx.close();
  },

  // the VIP cue ad: the pager pages of the VIP window (the price button is hidden: the picture is about the cues)
  async vip(S) {
    const { ctx, p, t0 } = await S.stage({ video: REC ? OUT + '/v_vip' : null, css: '.hbuy{visibility:hidden}.mx{display:none!important}' }), mark = () => +((Date.now() - t0) / 1000).toFixed(2), marks = {};
    await homeReady(p); await clean(p); await sleep(700); marks.start = mark();
    for (const [name, k] of [['champion', 1], ['kaboom', 4], ['aries', 6], ['aquarius', 16], ['wolf', 19], ['ghost', 25]]) {
      await p.evaluate(k => { vipPage = k; vipOffers(); }, k); await sleep(500); marks[name] = mark(); await sleep(2200); marks[name + '_end'] = mark(); await S.shot(p, 'vip', name);
    }
    await S.finish(ctx, 'vip', marks);
  },
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b8promo-')), srv = await L.startServer(PORT, tmp);
  try {
    await L.makeCast(base); const ASSETS_V = (await (await fetch(base + '/assets.json')).json()).v || '';
    const hr = await http(base, null, '/api/register', { name: 'Alex', avatar: 402, country: 'US' }); const host = { acct: { id: hr.id, token: hr.token } };
    await http(base, host.acct, '/api/sync', { name: 'Alex', avatar: 402, frame: 8, level: 14, country: 'US', wins: 80, games: 120 });
    const b = await launch(SP + '/pv/voice_3.wav');
    const S = { b, base, host, cast: CAST,
      assetsV: ASSETS_V, stage: o => L.stage(b, base, { acct: host.acct, assetsV: ASSETS_V, ...o }).then(async r => ({ ...r, t0: Date.now() })),
      shot: async (p, scene, name) => { await p.screenshot({ path: `${OUT}/shot_${scene}_${name}.png` }); },
      finish: async (ctx, scene, marks) => {
        const pg = ctx.pages()[0], vid = pg.video(); await ctx.close(); let file = null;
        if (REC && vid) { file = `${OUT}/${scene}.webm`; await vid.saveAs(file).catch(e => console.log('save', e.message)); }
        META[scene] = { file, marks }; fs.writeFileSync(metaFile, JSON.stringify(META, null, 1)); console.log('scene', scene, JSON.stringify(marks));
      } };
    for (const name of process.argv.slice(2)) { if (!SCENES[name]) { console.log('no scene', name); continue; } console.log('--- scene', name); await SCENES[name](S); }
    await b.close();
  } catch (e) { console.log('CRASH', e); process.exitCode = 2; }
  srv.kill();
})();
