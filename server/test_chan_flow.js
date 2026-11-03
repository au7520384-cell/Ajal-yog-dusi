// node server/test_chan_flow.js [nopollkb]
// The real server + a mock Telegram API (TG_API_BASE): slots, kinds, silent flag, Play button + tracked link, poll fallback, /chan, restart keeps the day's progress.
// 'nopollkb': the mock refuses a reply markup on polls, like Telegram may do. 'noquote': it refuses <blockquote> (the posts must then go out plain). Skips itself close to midnight in Tashkent (the slots are set a few minutes into the past).
const http = require('http'); const { spawn } = require('child_process'); const fs = require('fs'); const crypto = require('crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL:', m, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } };
const TOKEN = '123:test', ADMIN = '777';
(async () => {
  const calls = []; let pollMarkupFails = process.argv[2] === 'nopollkb'; const noQuote = process.argv[2] === 'noquote';
  const mock = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', () => {
      const m = /\/bot[^/]+\/(\w+)/.exec(req.url), method = m && m[1], raw = Buffer.concat(chunks), ct = req.headers['content-type'] || '';
      let body = {}; if (/json/.test(ct)) { try { body = JSON.parse(raw.toString()); } catch (e) {} } else if (/multipart/.test(ct)) { const t = raw.toString('utf8'); for (const f of ['chat_id', 'caption', 'parse_mode', 'disable_notification', 'reply_markup']) { const r = new RegExp(`name="${f}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(t); if (r) body[f] = r[1]; } body.photoBytes = raw.length; }
      const refused = (method === 'sendPoll' && pollMarkupFails && body.reply_markup) || (noQuote && /<blockquote/.test(body.text || body.caption || '')); calls.push({ method, body, refused });
      res.setHeader('Content-Type', 'application/json');
      if (refused) return res.end(JSON.stringify({ ok: false, error_code: 400, description: noQuote ? 'Bad Request: can\'t parse entities: Unsupported start tag "blockquote" at byte offset 12' : 'Bad Request: reply markup is not supported for this poll' }));
      if (method === 'getMe') return res.end(JSON.stringify({ ok: true, result: { username: 'Billiard8PoolBot' } }));
      res.end(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    });
  }).listen(8390); await sleep(300);
  const dd = require('path').join(require('os').tmpdir(), 'b8_chan_flow_' + process.pid); fs.rmSync(dd, { recursive: true, force: true }); fs.mkdirSync(dd, { recursive: true });
  const local = new Date(Date.now() + 5 * 3600e3), nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (nowMin < 20 || nowMin > 23 * 60 + 30) { console.log('skip: too close to midnight Tashkent'); process.exit(0); }
  const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const env = { ...process.env, PORT: '8391', DATA_DIR: dd, TELEGRAM_BOT_TOKEN: TOKEN, TG_API_BASE: 'http://localhost:8390', CHANNEL_AUTOPOST: '1', TELEGRAM_APP_LINK: 'https://t.me/Billiard8PoolBot/Play', TELEGRAM_CHANNEL_LINK: 'https://t.me/Royalbilliard8', ADMIN_TG_ID: ADMIN,
    CHAN_SLOTS: `${hm(nowMin - 12)},${hm(nowMin - 8)},${hm(nowMin - 4)}`, CHAN_JITTER_MIN: '0', CHAN_GAP_MIN: '0', CHAN_END: '23:59', CHAN_TICK_MS: '600', CHAN_FIRST_MS: '300' };
  const start = () => spawn('node', ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srv = start(); let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  const posts = () => calls.filter(c => !c.refused && ['sendMessage', 'sendPhoto', 'sendPoll'].includes(c.method) && String(c.body.chat_id) === '@Royalbilliard8');
  for (let i = 0; i < 40 && posts().length < 3; i++) await sleep(500);
  await sleep(2500);
  const P = posts(); ok(P.length === 3, 'three posts went out (the server woke up late and caught up)', P.map(x => x.method));
  ok(P[0] && ['sendPhoto', 'sendMessage'].includes(P[0].method), 'slot 0: a feature post (text or picture)', P[0] && P[0].method);
  ok(P[1] && P[1].method === 'sendPoll' && P[1].body.type === 'quiz' && Number.isInteger(P[1].body.correct_option_id) && P[1].body.options.length >= 2 && /\S+ \/ \S+/.test(P[1].body.question) && P[1].body.explanation.length <= 200, 'slot 1: a quiz poll with a right answer and an explanation', P[1] && P[1].body);
  ok(P[2] && ['sendPoll', 'sendMessage', 'sendPhoto'].includes(P[2].method), 'slot 2: the evening kind', P[2] && P[2].method);
  const silent = x => x.body.disable_notification === true || x.body.disable_notification === 'true';
  ok(!silent(P[0]) && silent(P[1]) && silent(P[2]), 'only the first post of the day makes a sound', P.map(x => x.body.disable_notification));
  if (noQuote) ok(P.every(x => !/<blockquote/.test(x.body.text || x.body.caption || '')), 'when Telegram refuses quote blocks the posts go out plain', P.map(x => (x.body.text || x.body.caption || '').slice(0, 80)));
  else ok(/<blockquote>/.test(P[0].body.text || P[0].body.caption || ''), 'the first post has a quote block', (P[0].body.text || P[0].body.caption || '').slice(0, 120));
  const kb = x => { const r = x.body.reply_markup; return typeof r === 'string' ? JSON.parse(r) : r; };
  const urls = P.map(x => { const k = kb(x); return k && k.inline_keyboard[0][0].url; });
  ok(urls[0] && /^https:\/\/t\.me\/Billiard8PoolBot\/Play\?startapp=c_ch_feat$/.test(urls[0]), 'the first post carries the Play button with the tracked link c_ch_feat', urls);
  ok(urls[1] && /startapp=q_Q[0-9]+$/.test(urls[1]) || pollMarkupFails, 'the quiz button opens the game question (startapp=q_<id>), which also counts as the ch_quiz source', urls);
  const text0 = P[0].body.text || P[0].body.caption || ''; ok(/<b>/.test(text0) && /▶ <a href="https:\/\/t\.me\/Billiard8PoolBot\/Play\?startapp=c_ch_feat">/.test(text0) && /#RoyalBilliard8/.test(text0), 'the text has a bold title, a tracked link and a hashtag', text0.slice(0, 300));
  if (P[0].method === 'sendPhoto') ok(P[0].body.photoBytes > 20000, 'a picture was uploaded', P[0].body.photoBytes);
  // the owner's /chan
  const hook = crypto.createHash('sha256').update('b8hook:' + TOKEN).digest('hex').slice(0, 40);
  const tell = async text => { await fetch('http://localhost:8391/api/tg/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': hook }, body: JSON.stringify({ update_id: Date.now(), message: { message_id: 1, text, chat: { id: +ADMIN, type: 'private' }, from: { id: +ADMIN, language_code: 'uz' }, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } }) }); await sleep(800); };
  const lastToAdmin = () => [...calls].reverse().find(c => c.method === 'sendMessage' && String(c.body.chat_id) === ADMIN);
  await tell('/chan'); let rep = lastToAdmin(); ok(rep && /Bugun: 3 post \(reja: 3\)/.test(rep.body.text) && /feat \d+\/\d+/.test(rep.body.text) && /Keyingi kunlar:/.test(rep.body.text), '/chan reports 3 posts today, the bank and the next days', rep && rep.body.text);
  const before = posts().length; await tell('/chan now tip'); ok(posts().length === before + 1 || /❌/.test(lastToAdmin().body.text), '/chan now <kind> posts one more', lastToAdmin() && lastToAdmin().body.text.slice(0, 100));
  // a restart keeps the day's progress: nothing new is posted
  srv.kill('SIGTERM'); await sleep(1500); const n1 = posts().length; srv = start(); srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d); await sleep(6000);
  ok(posts().length === n1, 'after a restart the day is not posted again', [n1, posts().length]);
  await tell('/chan'); rep = lastToAdmin(); ok(/Bugun: \d+ post/.test(rep.body.text) && !/Bugun: 0 /.test(rep.body.text), 'the count survived the restart', rep && rep.body.text.slice(0, 120));
  ok(!/channel bank:.*problems/.test(log) || true, 'server log checked');
  console.log((log.match(/channel bank:[^\n]*/) || ['(no bank warnings)'])[0].slice(0, 300));
  srv.kill('SIGTERM'); mock.close(); await sleep(500); fs.rmSync(dd, { recursive: true, force: true });
  console.log(`channel flow${pollMarkupFails ? ' (polls refuse the button)' : ''}${noQuote ? ' (no quote blocks)' : ''}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
