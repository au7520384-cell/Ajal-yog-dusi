// Shared pieces of the 1-minute promo video recorder (rec_scenes.js): the real repo server, a cast of demo players (accounts on a LOCAL server,
// not real people), websocket bots that sit in a lobby, and the profile the recorded page starts with.
const { chromium } = require('playwright'), { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), WS = require(path.join(ROOT, 'server', 'node_modules', 'ws'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the 7 demo players: avatar = 400 + n (the premium avatars), fr = frame index, lv = level
const CAST = [
  { name: 'Dilshod', av: 400, fr: 6, lv: 31, cc: 'UZ' }, { name: 'Mia', av: 412, fr: 7, lv: 24, cc: 'US' }, { name: 'Kenji', av: 409, fr: 5, lv: 27, cc: 'JP' },
  { name: 'Sofia', av: 414, fr: 3, lv: 19, cc: 'ES' }, { name: 'Omar', av: 425, fr: 4, lv: 22, cc: 'TR' }, { name: 'Lena', av: 403, fr: 2, lv: 16, cc: 'DE' }, { name: 'Jasur', av: 413, fr: 1, lv: 12, cc: 'UZ' },
];

async function startServer(port, dataDir) {
  const srv = spawn('node', [path.join(ROOT, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch (e) {} await sleep(200); }
  return srv;
}
const http = async (base, acct, p, body) => {
  const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(p + ' ' + (j.error || r.status)); e.status = r.status; throw e; } return j;
};
async function makeCast(base) {   // registers the demo players (the server lets one address register 10 accounts a minute: 7 here + the recorded page's own)
  for (const c of CAST) {
    const r = await http(base, null, '/api/register', { name: c.name, avatar: c.av, country: c.cc });
    c.acct = { id: r.id, token: r.token };
    await http(base, c.acct, '/api/sync', { name: c.name, avatar: c.av, frame: c.fr, level: c.lv, country: c.cc, wins: 0, games: 40 + c.lv });
  }
  return CAST;
}

// a player that only sits in the lobby (no page): the websocket the game uses
class Bot {
  constructor(base, c) { this.c = c; this.url = base.replace(/^http/, 'ws') + `/ws?id=${encodeURIComponent(c.acct.id)}&token=${encodeURIComponent(c.acct.token)}`; this.msgs = []; }
  async connect() { this.ws = new WS(this.url); this.ws.on('message', d => { try { this.msgs.push(JSON.parse(String(d))); } catch (e) {} }); await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); return this; }
  send(o) { this.ws.send(JSON.stringify(o)); }
  host(code, city, pub) { this.send({ t: 'queue', city, code, lobby: true, cue: 'start', tbl: '', pub: !!pub }); }
  join(code, city) { this.send({ t: 'queue', city, code, join: true, lobby: true, cue: 'start', tbl: '' }); }
  chat(msg) { this.send({ t: 'lchat', msg }); }
  // a lobby host who says yes to every "I want in" request of the world chat
  autoAccept(base, ms = 1200) { this.ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'wreq') setTimeout(() => http(base, this.c.acct, '/api/world/answer', { rid: m.rid, ok: true }).catch(() => {}), ms); } catch (e) {} }); }
  close() { try { this.ws.close(); } catch (e) {} }
}

// what the recorded page starts with: a level-14 player with coins, three city rings (clubs open at level 6 + 3 rings), a premium avatar and frame, a few animated club emblems
const hostProfile = (extra = {}) => JSON.stringify({
  name: 'Alex', tutDone: true, games: 120, genderAsked: true, gender: 'm', lang: 'en', coins: 380000, cash: 640, level: 14, wins: 80, xp: 400, avatar: 402, frame: 8, frames: [0, 8, 6, 7], avs: [402],
  rings: { lon: 1, syd: 1, lis: 1 }, emb: [4, 10, 13], stk: ['bil', 'fun', 'ani'], cue: 'start', cues: ['start'], ...extra,
});
const stage = async (b, base, opts = {}) => {   // a recorded 1920x1080 page of the real game, signed in with its own account
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US', permissions: ['microphone'], ...(opts.video ? { recordVideo: { dir: opts.video, size: { width: 1920, height: 1080 } } } : {}) });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 160)));
  await p.addInitScript(([hp, acct, av]) => {
    localStorage.setItem('b8_hd', 'off');
    const d = new Date(), t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!localStorage.getItem('billiard8v2')) localStorage.setItem('billiard8v2', JSON.stringify({ ...JSON.parse(hp), lastClaim: t }));
    if (acct) localStorage.setItem('b8acct', JSON.stringify(acct));
    if (av) localStorage.setItem('b8_assets', av);   // the version of assets.json: the "downloading game resources" screen is skipped (the pictures load on demand from the local server)
  }, [opts.profile || hostProfile(), opts.acct || null, opts.assetsV || '']);
  await p.goto(base + '/', { waitUntil: 'commit' });
  await p.addStyleTag({ content: '#loginSplash,#boot,#hLegal' + (opts.toasts ? '' : ',#toasts') + '{display:none!important}' + (opts.css || '') }).catch(() => {});
  return { ctx, p };
};
module.exports = { ROOT, sleep, CAST, startServer, http, makeCast, Bot, hostProfile, stage, chromium };
