// Promo video recorder (the owner: "make a video like Miniclip's"): records 1080p practice matches on 5 tables with the real game (the game shows the city title itself). Needs the repo server and Playwright; paths use $SP (a scratch dir). build.py cuts, adds zoomed screenshots + end card and crossfades them (ffmpeg, Pillow via python3.12).
const { chromium } = require('playwright'); const { spawn } = require('child_process'), fs = require('fs');
const SP = process.env.SP + '/promo', PORT = 8162, base = `http://localhost:${PORT}`, sleep = ms => new Promise(r => setTimeout(r, ms));
const CITIES_TO = (process.env.CITIES || '0,3,5,7,1').split(',').map(Number);
(async () => {
  const dir = fs.mkdtempSync('/tmp/claude-0/promo-'); fs.mkdirSync(SP + '/clips', { recursive: true });
  const srv = spawn('node', ['server.js'], { cwd: '/home/user/Ajal-yog-dusi/server', env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await sleep(200); }
  const b = await chromium.launch(), meta = [];
  for (const ci of CITIES_TO) {
    const vdir = fs.mkdtempSync('/tmp/claude-0/pv-'); const tCtx = Date.now();
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US', recordVideo: { dir: vdir, size: { width: 1920, height: 1080 } } });
    const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 150)));
    await p.addInitScript(() => { localStorage.setItem('b8_hd', 'off'); });
    await p.goto(base + '/', { waitUntil: 'commit' });
    await p.addStyleTag({ content: '#loginSplash,#boot,#toasts{display:none!important}' }).catch(() => {});
    await p.waitForFunction(() => typeof Net !== 'undefined' && Net.acct && Net.acct.id, null, { timeout: 90000 });
    await p.evaluate(() => { applyLang('en'); profile.name = 'Alex'; profile.tutDone = true; profile.lastClaim = today(); document.querySelectorAll('.toast, #toast').forEach(e => e.remove()); document.getElementById('modal').classList.remove('on'); });
    await sleep(800);
    await p.evaluate(i => startMatch('practice', CITIES[i], null, null), ci);
    for (let i = 0; i < 60; i++) { await sleep(250); if (await p.locator('#tutSkip').count()) await p.locator('#tutSkip').click().catch(() => {}); if (await p.evaluate(() => typeof canControl === 'function' && canControl())) break; }
    const rotateTo = (ang, ms) => p.evaluate(([a, ms]) => new Promise(res => { const G = game, a0 = G.angle; let d = a - a0; d = Math.atan2(Math.sin(d), Math.cos(d)); const s = performance.now(); const f = () => { const k = Math.min(1, (performance.now() - s) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; G.angle = a0 + d * e; if (k < 1) requestAnimationFrame(f); else res(); }; f(); }), [ang, ms]);
    const pick = () => p.evaluate(() => { const G = game, cue = G.balls[0]; let best = null; const left = G.balls.filter(x => !x.out && x.n !== 0 && x.n !== 8).length;
      for (const bl of G.balls) { if (bl.n === 0 || bl.out || (bl.n === 8 && left)) continue;
        for (const pk of POCKETS) { const dx = pk.x - bl.x, dy = pk.y - bl.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, gx = bl.x - ux * 2 * R, gy = bl.y - uy * 2 * R, cx = gx - cue.x, cy = gy - cue.y, dc = Math.hypot(cx, cy); if (dc < 5) continue;
          const dot = (cx / dc) * ux + (cy / dc) * uy; if (dot < 0.65) continue; let clear = true;
          for (const o of G.balls) { if (o === cue || o === bl || o.out) continue; const t = ((o.x - cue.x) * cx + (o.y - cue.y) * cy) / (dc * dc); if (t < 0 || t > 1) continue; if (Math.hypot(cue.x + t * cx - o.x, cue.y + t * cy - o.y) < 2.1 * R) { clear = false; break; } }
          if (!clear) continue; const score = dc + d * 0.8 - dot * 250; if (!best || score < best.score) best = { score, ang: Math.atan2(cy, cx), dist: dc + d }; } }
      return best ? { ang: best.ang, power: Math.min(0.8, 0.3 + best.dist / FW * 0.55) } : null; });
    const settle = async cap => { await sleep(500); for (let i = 0; i < cap * 4; i++) { await sleep(250); if (await p.evaluate(() => !game.moving && !game.strike)) break; } };
    await sleep(1500); const t0 = (Date.now() - tCtx) / 1000;
    const marks = [];
    await p.evaluate(() => requestShot(0.92)); marks.push((Date.now() - tCtx) / 1000); await settle(9);
    for (let k = 0; k < 2; k++) {
      await sleep(400); const s = await pick(); if (!s) break;
      await rotateTo(s.ang, 900); await sleep(450); marks.push((Date.now() - tCtx) / 1000); await p.evaluate(pw => requestShot(pw), s.power); await settle(8);
    }
    const t1 = (Date.now() - tCtx) / 1000; await sleep(600);
    const name = await p.evaluate(() => 0); await ctx.close();
    const f = fs.readdirSync(vdir).find(x => x.endsWith('.webm')); const out = `${SP}/clips/city${ci}.webm`; fs.copyFileSync(vdir + '/' + f, out);
    meta.push({ ci, file: out, t0, t1, marks }); console.log('city', ci, 't0', t0.toFixed(1), 'shots at', marks.map(m => m.toFixed(1)).join(','), 'end', t1.toFixed(1));
    fs.writeFileSync(SP + '/clips/meta.json', JSON.stringify(meta));
  }
  await b.close(); srv.kill(); console.log('DONE');
})().catch(e => { console.log('CRASH', e); process.exit(2); });
