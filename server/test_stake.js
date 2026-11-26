#!/usr/bin/env node
// Table coins and stake matches, on the real server:  node server/test_stake.js   (B8_ROOT=<repo copy>; about 1 minute)
// The owner (Nov 24): shashka / Magic Chess / Mafia are played for a separate virtual coin. A new player has 12; +1 per rewarded video; $1 = 2000 (at most $5 a day); a stake is 3..100 000; 1-on-1: the winner takes 90% of the pool
// (3 + 3 -> 5), a draw gives the stakes back; Mafia: a mafioso puts in 3 stakes, the winning team shares 90%. The SERVER judges the matches (the rules are cut out of index.html), a phone cannot claim a win.
const { spawn } = require("child_process"), path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms)), ROOT = process.env.B8_ROOT || path.resolve(__dirname, ".."), P = +process.env.TEST_PORT || 8806, base = `http://localhost:${P}`, STRIPE = "whsec_stake";
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ""); } };
const R = require(path.join(ROOT, "server", "boardrules.js")).load();
const api = async (acct, p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(acct ? { Authorization: `Bearer ${acct.id}:${acct.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const pay = async (u, sku, id) => {   // a paid Stripe checkout, signed like Stripe signs it
  const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id, payment_status: "paid", amount_total: 100, metadata: { userId: u.id, sku } } } }), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", STRIPE).update(`${t}.${raw}`).digest("hex");
  return (await fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, body: raw })).status;
};
function client(acct, name) {
  const c = { name, acct, msgs: [], ws: null, acted: new Set() };
  c.open = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${P}/ws?id=${acct.id}&token=${acct.token}`); c.ws = ws; ws.onmessage = ev => { const m = JSON.parse(ev.data); c.msgs.push(m); if (m.t === "mview") c.play(m.v); }; ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws")); });
  c.send = m => c.ws.send(JSON.stringify(m));
  c.last = t => [...c.msgs].reverse().find(m => m.t === t);
  c.wait = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(25); } return null; };
  c.clear = () => { c.msgs.length = 0; c.acted.clear(); };
  c.bal = async () => (await api(acct, "/api/tc")).j;
  c.auto = false;
  c.play = v => {   // Mafia: a simple player
    if (!c.auto) return; const key = v.phase + ":" + v.day; if (c.acted.has(key) || v.you < 0 || !v.alive[v.you] || v.phase === "over") return; c.acted.add(key);
    const al = v.alive.map((a, i) => a ? i : -1).filter(i => i >= 0), others = al.filter(i => i !== v.you), mates = v.mates || [], foes = others.filter(i => !mates.includes(i));
    setTimeout(() => { try {
      if (v.phase === "night") { if (v.role === "mafia") c.send({ t: "mact", k: "kill", to: foes[0] }); else if (v.role === "doctor") c.send({ t: "mact", k: "save", to: others[0] }); else if (v.role === "sheriff") c.send({ t: "mact", k: "check", to: others[0] }); }
      else if (v.phase === "day") c.send({ t: "mact", k: "ready" });
      else if (v.phase === "vote") { const m = (v.found || []).find(f => f.mafia && v.alive[f.seat]); c.send({ t: "mact", k: "vote", to: m ? m.seat : foes[0] }); }
    } catch (e) {} }, 30 + Math.random() * 120);
  };
  return c;
}
const MS = a => 8 * (8 - +a[1]) + "abcdefgh".indexOf(a[0]);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b8st-"));
  const env = { ...process.env, PORT: String(P), DATA_DIR: tmp, MAFIA_SCALE: "0.03", BROOM_GRACE_MS: "700", BROOM_OPEN_GRACE_MS: "1500", BROOM_TURN_MS: "1000", TC_AD_GAP_MS: "400", TC_AD_DAY: "3", STRIPE_WEBHOOK_SECRET: STRIPE, ADMIN_KEY: "adm-stake" };
  let srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env, stdio: "ignore" });
  const up = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/health")).ok) return true; } catch (e) {} await sleep(300); } return false; };
  await up();
  try {
    ok(R.ok, "the server's copy of the rules loads (server/boardcores.js)", R.why);
    const cs = {}, acc = {}; for (const n of ["Ann", "Bob", "Cat", "Dan", "Eve", "Gus", "Fay"]) { acc[n] = (await api(null, "/api/register", { name: n, avatar: 3 })).j; cs[n] = client(acc[n], n); }
    const { Ann: A, Bob: B, Cat: C, Dan: D, Eve: E, Gus: G, Fay: F } = cs;
    for (const c of Object.values(cs)) await c.open();

    // ------------------------------------------------------------------ the wallet
    const w0 = await A.bal();
    ok(w0.tc === 12 && w0.hold === 0 && w0.min === 3 && w0.max === 100000 && w0.fee === 0.1 && w0.tiers[0] === 3 && w0.tiers.at(-1) === 100000 && w0.stakes === true, "a new player has 12 table coins; min stake 3, max 100 000, the house keeps 10%", w0);
    ok(w0.ads.left === 3 && w0.buy.left === 10000 && w0.buy.skus.map(x => x.tc + "/" + x.usd).join() === "2000/1,4000/2,10000/5", "ads left today, the purchase limit ($5 = 10 000), the three packs: $1 = 2000 coins", w0);
    ok((await api(acc.Ann, "/api/sync", { name: "Ann" })).j.tc === 12, "/api/sync carries the balance");
    const a1 = await api(acc.Fay, "/api/tc/ad", {}); ok(a1.j.ok && a1.j.tc === 13 && a1.j.left === 2, "a rewarded video: +1 coin", a1);
    const a2 = await api(acc.Fay, "/api/tc/ad", {}); ok(a2.s === 429 && a2.j.error === "wait" && a2.j.tc === 13, "a second claim at once is refused (the gap between videos)", a2);
    await sleep(450); const a3 = await api(acc.Fay, "/api/tc/ad", {}); await sleep(450); const a4 = await api(acc.Fay, "/api/tc/ad", {}); await sleep(450); const a5 = await api(acc.Fay, "/api/tc/ad", {});
    ok(a3.j.tc === 14 && a4.j.tc === 15 && a5.s === 429 && a5.j.error === "cap" && (await F.bal()).tc === 15, "three coins a day in this test (the cap), then 'cap'", [a3.j, a4.j, a5.j]);
    const skus = (await api(null, "/api/skus")).j.skus;
    ok(skus.tc_2k && skus.tc_2k.tc === 2000 && skus.tc_2k.usd === 1 && skus.tc_4k.usd === 2 && skus.tc_10k.tc === 10000 && skus.tc_10k.usd === 5, "$1 = 2000 coins: the packs are sold at exactly $1 / $2 / $5 (no card surcharge)", [skus.tc_2k, skus.tc_4k, skus.tc_10k]);
    ok(await pay(acc.Dan, "tc_2k", "cs_t1") === 200 && (await D.bal()).tc === 2012, "a paid pack hands over 2000 coins to the server wallet");
    ok(await pay(acc.Dan, "tc_2k", "cs_t1") === 200 && (await D.bal()).tc === 2012, "the same payment twice is delivered once");
    ok(((await api(acc.Dan, "/api/sync", { name: "Dan" })).j.grants || []).every(g => !g.tc), "the phone is not handed coins as a grant (the wallet is the server's)");
    const w1 = await D.bal(); ok(w1.buy.left === 8000, "the purchase limit counts what was bought today", w1.buy);
    const co = await api(acc.Dan, "/api/checkout", { sku: "tc_10k" }); ok(co.s === 400 && co.j.error === "tc_limit", "a pack over the $5-a-day limit cannot be ordered", co);
    for (const n of ["Ann", "Bob", "Eve", "Gus"]) await pay(acc[n], "tc_2k", "cs_" + n);
    ok((await A.bal()).tc === 2012 && (await G.bal()).tc === 2012, "everybody who will play for Mafia bought a pack");

    // ------------------------------------------------------------------ a room with a stake: the rules of making and joining one
    A.send({ t: "bcreate", game: "shashka", stake: 4 }); ok(!!(await A.wait(m => m.t === "berr" && m.why === "stake")), "a stake that is not on the list (4) is refused");
    C.send({ t: "bcreate", game: "shashka", stake: 25 }); const e1 = await C.wait(m => m.t === "berr" && m.why === "coins"); ok(e1 && e1.need === 25, "Cat has 12 coins: a room with a stake of 25 is refused ('need 25')", e1);
    C.clear(); C.send({ t: "bcreate", game: "mafia", stake: 5 }); const e2 = await C.wait(m => m.t === "berr" && m.why === "coins"); ok(e2 && e2.need === 15, "Mafia: the mafioso's stake is 3 times: Cat needs 15 for a stake of 5", e2);
    C.clear(); C.send({ t: "bcreate", game: "shashka" }); const rf = await C.wait(m => m.t === "broom"); ok(rf && rf.stake === 0, "a friendly room (no stake) is as before", rf); C.send({ t: "bleave" }); await sleep(100);

    // ------------------------------------------------------------------ shashka for 3 coins
    const pair = async (X, Y, game, stake) => {   // X makes a room, Y joins, X starts: both get the match
      X.clear(); Y.clear(); X.send({ t: "bcreate", game, stake }); const r = await X.wait(m => m.t === "broom"); if (!r) return null;
      Y.send({ t: "bjoin", code: r.code }); await Y.wait(m => m.t === "broom" && m.seats.filter(Boolean).length === 2); X.send({ t: "bstart" });
      const mx = await X.wait(m => m.t === "bmatch"), my = await Y.wait(m => m.t === "bmatch"); return mx && my ? { code: r.code, mx, my, first: mx.first, room: mx.room, X, Y } : null;
    };
    const seatOf = (p, c) => c === p.X ? 0 : 1, by = (p, seat) => seat === 0 ? p.X : p.Y;
    const plies = (p, G0, n) => { for (let i = 0; i < n; i++) { const mv = (p.game === "magic" ? R.mcLegal(G0.P) : R.shGen(G0.b, G0.side))[0]; if (p.game === "magic") { const path = R.mcPath(mv); R.mcPlay(G0, mv); p.q.push(path); } else { R.shPlay(G0, mv); p.q.push(mv.path); } } };
    const play = async (p, n) => {   // n legal plies, each sent by the seat whose turn it is
      const G0 = p.game === "magic" ? R.mcNew() : R.shNew(); p.q = []; plies(p, G0, n);
      for (let i = 0; i < p.q.length; i++) { by(p, (p.first + i) % 2).send({ t: "bmove", path: p.q[i] }); await sleep(40); }
    };
    let p = await pair(A, B, "shashka", 3); p.game = "shashka";
    ok(p && p.mx.stake === 3 && p.my.stake === 3, "both phones are told the stake of the match (3)", p && p.mx);
    let wa = await A.bal(), wb = await B.bal(); ok(wa.tc === 2009 && wa.hold === 3 && wb.tc === 2009 && wb.hold === 3, "the stake is held when the match starts (3 coins each)", [wa.tc, wa.hold, wb.tc, wb.hold]);
    ok(!!A.last("wallet") && A.last("wallet").tc === 2009, "the phone is told its new balance at once (a 'wallet' message)", A.last("wallet"));
    // an illegal move: refused, the phone gets the real move list back, the other phone hears nothing
    const mover = by(p, p.first), waiter = by(p, 1 - p.first); mover.clear(); waiter.clear(); mover.send({ t: "bmove", path: [0, 1] });
    const sy = await mover.wait(m => m.t === "bsync"); await sleep(200); ok(sy && sy.moves.length === 0 && !waiter.last("bmove"), "an illegal move is refused: the sender gets the move list back (bsync), the opponent hears nothing", sy);
    // a phone cannot claim a win
    const liar = by(p, 0); liar.clear(); waiter.clear(); liar.send({ t: "bover", room: p.room, winner: 0, why: "stuck" }); await sleep(400);
    ok(!liar.last("bend") && !waiter.last("bend") && (await A.bal()).hold === 3, "a claim of a win from a phone is not taken in a stake match: nothing ends, the stake stays held");
    // the first moves: an early resignation moves no coins
    await play(p, 2); const early = by(p, 1); early.send({ t: "bover", room: p.room, winner: 0, why: "resign" });
    const be = await A.wait(m => m.t === "bend"); await sleep(150);
    ok(be && be.void === 1 && be.pay[0] === 0 && be.pay[1] === 0, "a resignation in the first moves is void: no coins move", be);
    wa = await A.bal(); wb = await B.bal(); ok(wa.tc === 2012 && wa.hold === 0 && wb.tc === 2012 && wb.hold === 0, "...both stakes come back", [wa.tc, wb.tc]);
    // the rematch: the stake is held again; this time 4 plies, then a resignation
    A.clear(); B.clear(); A.send({ t: "brematch" }); B.send({ t: "brematch" }); const m2a = await A.wait(m => m.t === "bmatch"); await B.wait(m => m.t === "bmatch");
    p.first = m2a.first; p.room = m2a.room; ok(m2a.stake === 3 && (await A.bal()).hold === 3, "a rematch holds the stake again (the colours swap)");
    await play(p, 4); const loser = by(p, 1); loser.send({ t: "bover", room: p.room, winner: 1, why: "resign" });
    const bw = await A.wait(m => m.t === "bend"); await B.wait(m => m.t === "bend"); await sleep(150);
    ok(bw && bw.winner === 0 && bw.void === 0 && bw.stake === 3 && bw.pay[0] === 2 && bw.pay[1] === -3, "resignation after 4 plies: the winner is the other seat; 3 + 3 -> 5, so +2 for the winner and -3 for the loser", bw);
    wa = await A.bal(); wb = await B.bal(); ok(wa.tc === 2014 && wb.tc === 2009 && wa.hold === 0 && wb.hold === 0, "the balances: 2014 and 2009 (5 paid to the winner, the house kept 1)", [wa.tc, wb.tc]);
    ok(wa.log.at(-1).k === "win" && wa.log.at(-1).d === 2 && wb.log.at(-1).k === "lose" && wb.log.at(-1).d === -3, "the history says win +2 / lose -3", [wa.log.at(-1), wb.log.at(-1)]);
    // a draw: offered by one, accepted by the other; "yes" without an offer, or to your own offer, does nothing
    A.clear(); B.clear(); A.send({ t: "brematch" }); B.send({ t: "brematch" }); const m3 = await A.wait(m => m.t === "bmatch"); await B.wait(m => m.t === "bmatch"); p.first = m3.first; p.room = m3.room;
    await play(p, 4); A.send({ t: "boffer", k: "yes" }); await sleep(200); ok(!A.last("bend"), "'yes' with no offer is not a draw");
    A.send({ t: "boffer", k: "draw" }); await sleep(100); A.send({ t: "boffer", k: "yes" }); await sleep(200); ok(!A.last("bend"), "'yes' to your own offer is not a draw");
    B.send({ t: "boffer", k: "yes" }); const bd = await A.wait(m => m.t === "bend");
    ok(bd && bd.winner === -1 && bd.why === "agreed" && bd.pay[0] === 0 && bd.pay[1] === 0, "an agreed draw: nobody wins", bd);
    ok((await A.bal()).tc === 2014 && (await B.bal()).tc === 2009, "...both stakes come back");

    // ------------------------------------------------------------------ Magic Chess: the fool's mate ends it by the rules (the server sees the mate itself)
    B.send({ t: "bleave" }); A.send({ t: "bleave" }); await sleep(200);
    const bA = (await A.bal()).tc, bB = (await B.bal()).tc;
    p = await pair(A, B, "magic", 5); p.game = "magic";
    ok(p && p.mx.stake === 5 && (await B.bal()).hold === 5, "a Magic Chess room for 5");
    const white = by(p, p.first), black = by(p, 1 - p.first);
    const seq = [[white, [MS("f2"), MS("f3")]], [black, [MS("e7"), MS("e5")]], [white, [MS("g2"), MS("g4")]], [black, [MS("d8"), MS("h4")]]];
    for (const [c, path] of seq) { c.send({ t: "bmove", path }); await sleep(60); }
    const bm = await A.wait(m => m.t === "bend");
    ok(bm && bm.why === "mate" && bm.winner === 1 - p.first && bm.void === 0 && bm.pay[1 - p.first] === 4 && bm.pay[p.first] === -5, "the mate: Black wins by the rules, +4 (9 paid for a stake of 5) and -5", bm);
    const bwin = by(p, 1 - p.first), blos = by(p, p.first), b0 = { [A.name]: bA, [B.name]: bB };
    ok((await bwin.bal()).tc === b0[bwin.name] + 4 && (await blos.bal()).tc === b0[blos.name] - 5, "...and the wallets show +4 / -5", [(await bwin.bal()).tc, (await blos.bal()).tc, b0]);
    // ------------------------------------------------------------------ the clock: the seat that does not move in time loses
    A.clear(); B.clear(); const balA = (await A.bal()).tc, balB = (await B.bal()).tc;
    A.send({ t: "brematch" }); B.send({ t: "brematch" }); const m4 = await A.wait(m => m.t === "bmatch"); await B.wait(m => m.t === "bmatch"); p.first = m4.first; p.room = m4.room; p.game = "magic";
    ok(m4.tl > 0 && m4.tl <= 1000, "the match tells the phones how long the first move may take (tl)", m4.tl);
    await play(p, 4); const tt = await A.wait(m => m.t === "bend", 4000);
    ok(tt && tt.why === "time" && tt.winner === 1 - p.first && tt.void === 0, "after 4 plies the seat on turn does not move in a second: it loses on the clock", tt);
    ok((await A.bal()).tc + (await B.bal()).tc === balA + balB - 1, "the house kept 1 coin of the pool of 10 (the two wallets lost 1 together)", [(await A.bal()).tc + (await B.bal()).tc, balA + balB]);
    // ------------------------------------------------------------------ leaving a running match, and a phone that drops
    A.clear(); B.clear(); A.send({ t: "brematch" }); B.send({ t: "brematch" }); const m5 = await A.wait(m => m.t === "bmatch"); await B.wait(m => m.t === "bmatch"); p.first = m5.first; p.room = m5.room;
    await play(p, 4); const x0 = (await A.bal()).tc, y0 = (await B.bal()).tc; B.send({ t: "bleave" });
    const lv = await A.wait(m => m.t === "bend"); await sleep(150);
    ok(lv && lv.why === "left" && lv.winner === 0 && lv.pay[0] === 4 && lv.pay[1] === -5, "the one who leaves a running match (after 4 plies) loses the stake: the other seat gets the pool", lv);
    ok((await A.bal()).tc === x0 + 9 && (await B.bal()).tc === y0, "...Ann +9 of the 10 held, Bob nothing back", [(await A.bal()).tc - x0, (await B.bal()).tc - y0]);
    // the room is still Ann's: Bob comes back, a new match, Bob's phone drops
    B.clear(); B.send({ t: "bjoin", code: p.code }); await B.wait(m => m.t === "broom" && m.seats.filter(Boolean).length === 2);
    A.clear(); B.clear(); A.send({ t: "bstart" }); const m6a = await A.wait(m => m.t === "bmatch"); await B.wait(m => m.t === "bmatch"); p.first = m6a.first; p.room = m6a.room;
    await play(p, 4); const x1 = (await A.bal()).tc; B.ws.close(); const aw = await A.wait(m => m.t === "bend", 4000);
    ok(aw && aw.why === "away" && aw.winner === 0 && aw.pay[0] === 4, "a phone that stays away past the grace loses (4 plies played)", aw);
    ok((await A.bal()).tc === x1 + 9, "...and the other seat is paid");
    await B.open(); A.send({ t: "bleave" }); await sleep(200);

    // ------------------------------------------------------------------ not enough coins: a join, and a rematch
    C.clear(); D.clear(); C.send({ t: "bcreate", game: "shashka", stake: 10 }); const rc = await C.wait(m => m.t === "broom"); D.send({ t: "bjoin", code: rc.code }); await D.wait(m => m.t === "broom" && m.seats.filter(Boolean).length === 2);
    C.send({ t: "bstart" }); const mc = await C.wait(m => m.t === "bmatch"); await D.wait(m => m.t === "bmatch");
    p = { game: "shashka", X: C, Y: D, first: mc.first, room: mc.room }; await play(p, 4); C.send({ t: "bover", room: mc.room, winner: 0, why: "resign" }); await C.wait(m => m.t === "bend"); await sleep(150);
    ok((await C.bal()).tc === 2, "Cat lost a stake of 10: she has 2 coins");
    C.clear(); D.clear(); C.send({ t: "brematch" }); D.send({ t: "brematch" }); const nc = await D.wait(m => m.t === "berr" && m.why === "coins");
    ok(nc && nc.seat === 0 && nc.need === 10 && !C.last("bmatch") && (await D.bal()).hold === 0, "a rematch is refused when a seat cannot pay the stake (the room says which seat), nothing is held", nc);
    C.send({ t: "bleave" }); D.send({ t: "bleave" }); await sleep(200);
    F.clear(); E.clear(); E.send({ t: "bcreate", game: "shashka", stake: 10 }); const rr = await E.wait(m => m.t === "broom"); C.send({ t: "bjoin", code: rr.code }); const ec = await C.wait(m => m.t === "berr" && m.why === "coins");
    ok(ec && ec.need === 10, "Cat (2 coins) cannot join a room with a stake of 10", ec); E.send({ t: "bleave" }); await sleep(100);

    // ------------------------------------------------------------------ Mafia for 3 coins: no bots, 5 real players, the mafioso's stake is 3 times
    const mp = [A, B, D, E, G]; for (const c of mp) c.clear();
    const startBal = {}; for (const c of mp) startBal[c.name] = (await c.bal()).tc;
    A.send({ t: "bcreate", game: "mafia", stake: 3 }); const mr = await A.wait(m => m.t === "broom"); ok(mr && mr.stake === 3 && mr.max === 8, "a Mafia room with a stake of 3", mr);
    for (const c of [B, D, E]) { c.send({ t: "bjoin", code: mr.code }); await c.wait(m => m.t === "broom"); }
    A.send({ t: "bstart" }); const mn = await A.wait(m => m.t === "berr" && m.why === "min"); ok(mn && mn.need === 5 && !A.last("bmatch"), "a stake match of Mafia needs 5 real players (no bots): 4 are not enough", mn);
    G.send({ t: "bjoin", code: mr.code }); await G.wait(m => m.t === "broom"); await sleep(150);
    for (const c of mp) { c.clear(); c.auto = true; } A.send({ t: "bstart" });
    const v0 = {}; for (const c of mp) v0[c.name] = (await c.wait(m => m.t === "mview")).v;
    const st = {}; for (const c of mp) st[c.name] = c.last("mview").st;
    ok(mp.every(c => st[c.name] === (v0[c.name].role === "mafia" ? 9 : 3)) && mp.every(c => c.last("mview").stake === 3), "the roles are dealt: a mafioso holds 9, everybody else 3 (each phone is told its own stake)", st);
    for (const c of mp) { const w = await c.bal(); ok(w.hold === st[c.name] && w.tc === startBal[c.name] - st[c.name], "held for the match: " + c.name + " (" + v0[c.name].role + ") " + st[c.name], [w.tc, w.hold]); }
    const fin = await A.wait(m => m.t === "mview" && m.v.phase === "over" && m.pay, 30000);
    ok(!!fin, "the match ends and the last view carries the payout", fin && fin.v.phase);
    if (fin) {
      const team = fin.v.winner, roles = fin.v.roles, pool = mp.reduce((a, c) => a + st[c.name], 0), mine = {}; mp.forEach(c => { mine[c.name] = c.last("mview").v.you; });
      const winners = mp.filter(c => (roles[mine[c.name]] === "mafia") === (team === "mafia")), each = Math.floor(Math.floor(pool * 0.9) / winners.length);
      ok(mp.every(c => fin.pay[mine[c.name]] === (winners.includes(c) ? each - st[c.name] : -st[c.name])), "the winning team (" + team + ") shares 90% of the pool " + pool + " equally (" + each + " each); the others lose their stake", fin.pay);
      await sleep(300); for (const c of mp) { const w = await c.bal(); ok(w.hold === 0 && w.tc === startBal[c.name] + fin.pay[mine[c.name]], "paid: " + c.name, [w.tc, w.hold, startBal[c.name], fin.pay[mine[c.name]]]); }
    }
    // a player who leaves a running match loses the stake even if the team wins
    await sleep(600); for (const c of mp) { c.clear(); } for (const c of mp) c.auto = true;
    const sb = {}; for (const c of mp) sb[c.name] = (await c.bal()).tc;
    A.send({ t: "bstart" }); await A.wait(m => m.t === "mview"); const vv = {}; for (const c of mp) vv[c.name] = (await c.wait(m => m.t === "mview")).v;
    const leaver = mp.find(c => c !== A && vv[c.name].role !== "mafia") || E; const lstake = leaver.last("mview").st; await sleep(100); leaver.auto = false; leaver.send({ t: "bleave" });
    const f2 = await A.wait(m => m.t === "mview" && m.v.phase === "over" && m.pay, 30000);
    ok(!!f2 && f2.pay[leaver.last("mview").v.you] === -lstake, "the player who left lost the stake (" + lstake + ") whatever the result", f2 && f2.pay);
    await sleep(300); const wl = await leaver.bal(); ok(wl.tc === sb[leaver.name] - lstake && wl.hold === 0, "...his wallet shows it", [wl.tc, sb[leaver.name], lstake]);
    for (const c of mp) c.auto = false;
    for (const c of mp) { try { c.send({ t: "bleave" }); } catch (e) {} } await sleep(300);

    // ------------------------------------------------------------------ the owner's numbers
    const ad0 = await api(null, "/api/tc/admin"); ok(ad0.s === 403, "the economy page needs the admin key", ad0);
    const ad1 = (await api(null, "/api/tc/admin?key=adm-stake")).j;
    ok(ad1.players >= 7 && ad1.coins > 0 && ad1.held === 0 && Array.isArray(ad1.top) && ad1.top.length > 0 && ad1.winners[0].net >= ad1.losers[0].net && ad1.rooms >= 0, "with the key: coins in circulation, held, the richest, the biggest winners and losers", ad1);
    // ------------------------------------------------------------------ a restart gives back the stakes of the matches it ended
    const rb = [(await A.bal()).tc, (await B.bal()).tc];
    p = await pair(A, B, "shashka", 25); ok(p && (await A.bal()).hold === 25, "a match for 25 is held");
    srv.kill("SIGTERM"); await new Promise(r => srv.once("exit", r)); srv = spawn("node", [path.join(ROOT, "server", "server.js")], { env, stdio: "ignore" }); await up();
    const ra = (await api(acc.Ann, "/api/tc")).j, rbb = (await api(acc.Bob, "/api/tc")).j;
    ok(ra.tc === rb[0] && ra.hold === 0 && rbb.tc === rb[1] && rbb.hold === 0, "after a restart the held stakes are back (no coin is lost with the rooms)", [ra.tc, rb[0], ra.hold, rbb.tc, rb[1]]);
    for (const c of Object.values(cs)) try { c.ws.close(); } catch (e) {}
  } catch (e) { fail++; console.log("EXCEPTION", e && e.stack || e); }
  srv.kill("SIGTERM"); await sleep(400); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
  console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
})();
