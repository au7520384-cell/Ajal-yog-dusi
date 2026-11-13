const { chromium } = require('playwright'); const { spawn } = require('child_process'), fs = require('fs');
const SP = process.env.SP + '/promo', PORT = 8161, base = `http://localhost:${PORT}`, sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync('/tmp/claude-0/promo-'); const srv = spawn('node', ['server.js'], { cwd: '/home/user/Ajal-yog-dusi/server', env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await sleep(200); }
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' }); const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem('b8_hd', 'off'); });
  await p.goto(base + '/', { waitUntil: 'commit' });
  await p.addStyleTag({ content: '#loginSplash,#boot{display:none!important}' });
  await p.waitForFunction(() => typeof Net !== 'undefined' && Net.acct && Net.acct.id, null, { timeout: 60000 });
  await p.evaluate(() => { applyLang('en'); profile.name = 'Alex'; profile.tutDone = true; profile.coins = 250000; document.getElementById('modal').classList.remove('on'); });
  await sleep(1500);
  for (const s of ['home', 'shop', 'tourScr', 'cities', 'leader', 'rewards']) { await p.evaluate(s => go(s), s); await sleep(1500); await p.screenshot({ path: `${SP}/s_${s}.png` }); }
  console.log(await p.evaluate(() => CITIES.map((c, i) => i + ':' + c.name + ':' + c.felt[0]).join(' ')));
  await b.close(); srv.kill();
})();
