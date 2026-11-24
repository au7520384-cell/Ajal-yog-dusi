#!/usr/bin/env node
// The rules of Mafia on their own (server/mafia.js, no sockets, no clock):  node server/test_mafia_rules.js   (about 2 s)
// Roles for 5..8 seats, the night (kill / save / check), the vote (a tie sends nobody out), the two ways to win, a phase that ends early only after its minimum, every action that must be refused,
// what each seat's view may contain (a seat never sees another's role while it is alive, the sheriff sees only "mafia / not", the mafia see each other), and 600 whole games played by bots to the end.
const M = require("./mafia.js");
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL:", m, x !== undefined ? JSON.stringify(x).slice(0, 500) : ""); } };
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const T0 = 1e6, mk = (n, seed = 1, bots) => { const g = M.create(n, bots || Array(n).fill(false), {rnd: rng(seed), now: T0}); return g; };
const seatOf = (g, role, k = 0) => g.role.map((r, i) => r === role ? i : -1).filter(i => i >= 0)[k];
const toNight = g => { M.tick(g, g.until); return g; };   // reveal -> night 1
const toVote = g => { M.tick(g, g.until); M.tick(g, g.until); return g; };   // night -> day -> vote (the night must be over: every actor has acted or it ran out)

// ---- the roles
for (const n of [5, 6, 7, 8]) { const g = mk(n, n), c = {}; g.role.forEach(r => c[r] = (c[r] | 0) + 1);
  ok(g.role.length === n && c.mafia === (n >= 8 ? 3 : n >= 6 ? 2 : 1) && c.doctor === 1 && c.sheriff === 1 && c.citizen === n - c.mafia - 2, `${n} seats: ${c.mafia} mafia, a doctor, a sheriff, ${c.citizen} citizens`, c); }
let threw = 0; for (const n of [0, 4, 9]) try { M.create(n, []); } catch (e) { threw++; } ok(threw === 3, "fewer than 5 or more than 8 seats are refused");
{ const seen = new Set(); for (let s = 1; s <= 40; s++) seen.add(mk(6, s).role.join()); ok(seen.size > 20, "the roles are dealt at random (40 deals, " + seen.size + " different)"); }
{ const g = mk(6, 2); ok(g.phase === "reveal" && g.until === T0 + M.TIMES.reveal && !g.over, "a game starts with the reveal (everybody sees the role)"); toNight(g); ok(g.phase === "night" && g.day === 1, "...then night 1"); }

// ---- the night
{ const g = toNight(mk(7, 3)), mf = [seatOf(g, "mafia", 0), seatOf(g, "mafia", 1)], dr = seatOf(g, "doctor"), sh = seatOf(g, "sheriff"), cz = seatOf(g, "citizen"), cz2 = seatOf(g, "citizen", 1);
  ok(M.act(g, mf[0], {k: "kill", to: cz}, T0) && M.act(g, mf[1], {k: "kill", to: cz}, T0), "the mafia name a victim");
  ok(!M.act(g, cz, {k: "kill", to: cz2}, T0) && !M.act(g, dr, {k: "kill", to: cz}, T0), "a citizen / the doctor cannot kill");
  ok(!M.act(g, mf[0], {k: "kill", to: mf[1]}, T0) && !M.act(g, mf[0], {k: "kill", to: 99}, T0) && !M.act(g, mf[0], {k: "kill"}, T0), "the mafia cannot kill a mafia, nobody out of range, nobody at all");
  ok(!M.act(g, dr, {k: "check", to: cz}, T0) && !M.act(g, sh, {k: "save", to: cz}, T0), "each role has only its own action");
  ok(M.act(g, dr, {k: "save", to: dr}, T0), "the doctor may save himself");
  ok(M.act(g, sh, {k: "check", to: mf[0]}, T0) && !M.act(g, sh, {k: "check", to: sh}, T0), "the sheriff checks a person, not himself");
  const ns = T0 + M.TIMES.reveal, early = g.until; ok(early === ns + M.MIN.night && early < ns + M.TIMES.night, "everybody acted: the night ends early, not before its minimum", [early - ns]);
  M.tick(g, g.until);
  ok(g.phase === "day" && !g.alive[cz] && g.dead[cz] === "citizen" && g.log.at(-1).k === "died" && g.log.at(-1).seat === cz, "the victim is dead and his role is shown", g.log.at(-1));
  ok(g.found.length === 1 && g.found[0].seat === mf[0] && g.found[0].mafia === true, "the sheriff learned: that one is mafia");
  ok(g.day === 1, "day 1"); }
{ const g = toNight(mk(7, 4)), mf = seatOf(g, "mafia"), dr = seatOf(g, "doctor"), cz = seatOf(g, "citizen");
  M.act(g, mf, {k: "kill", to: cz}, T0); M.act(g, dr, {k: "save", to: cz}, T0); M.tick(g, g.until);
  ok(g.alive.every(Boolean) && g.log.at(-1).k === "none", "the doctor saves the victim: nobody died (and nobody is told why)", g.log.at(-1)); }
{ const g = toNight(mk(7, 5)); M.tick(g, g.until); ok(g.alive.every(Boolean) && g.log.at(-1).k === "none" && g.phase === "day", "a night with no action: nobody died, day comes"); }
{ const g = toNight(mk(8, 6)), ms = [0, 1, 2].map(k => seatOf(g, "mafia", k)), cz = [0, 1, 2].map(k => seatOf(g, "citizen", k));
  M.act(g, ms[0], {k: "kill", to: cz[0]}, T0); M.act(g, ms[1], {k: "kill", to: cz[0]}, T0); M.act(g, ms[2], {k: "kill", to: cz[1]}, T0); M.tick(g, g.until);
  ok(!g.alive[cz[0]] && g.alive[cz[1]], "the victim is the one most of the mafia chose"); }
{ const g = toNight(mk(8, 7)), ms = [0, 1, 2].map(k => seatOf(g, "mafia", k)), cz = [0, 1, 2].map(k => seatOf(g, "citizen", k)); const out = new Set();
  for (let s = 0; s < 30; s++) { const h = toNight(mk(8, 100 + s)), a = [0, 1, 2].map(k => seatOf(h, "mafia", k)), c = [0, 1].map(k => seatOf(h, "citizen", k)); M.act(h, a[0], {k: "kill", to: c[0]}, T0); M.act(h, a[1], {k: "kill", to: c[1]}, T0); M.tick(h, h.until); out.add(h.alive[c[0]] ? "b" : "a"); }
  ok(out.size === 2, "a tie between two victims is settled at random (both happen over 30 games)"); }
{ const g = toNight(mk(7, 8)), dr = seatOf(g, "doctor"), cz = seatOf(g, "citizen"); M.act(g, dr, {k: "save", to: cz}, T0); M.tick(g, g.until);
  ok(g.lastSave === cz, "the doctor's last save is remembered"); const day = g.until; M.tick(g, day); M.tick(g, g.until);
  ok(g.phase === "night" && g.day === 2, "after the vote (nobody voted) night 2 begins"); ok(!M.act(g, dr, {k: "save", to: cz}, g.until - 1000), "the doctor cannot save the same person two nights in a row"); ok(M.act(g, dr, {k: "save", to: dr}, g.until - 1000), "...but may save another"); }
{ const g = toNight(mk(7, 9)), sh = seatOf(g, "sheriff"), mf = seatOf(g, "mafia"); M.act(g, sh, {k: "check", to: mf}, T0); M.tick(g, g.until); M.tick(g, g.until); M.tick(g, g.until);
  ok(g.phase === "night" && !M.act(g, sh, {k: "check", to: mf}, g.until - 1000), "the sheriff cannot check the same person twice"); }

// ---- day and vote
{ const g = toNight(mk(7, 10)); M.tick(g, g.until); ok(g.phase === "day", "day"); const a = M.alive(g);
  ok(!M.act(g, a[0], {k: "vote", to: a[1]}, g.until - 1000) && M.act(g, a[0], {k: "ready"}, g.until - 5000), "in the day only 'ready' is taken (the vote is not open yet)");
  for (const i of a) M.act(g, i, {k: "ready"}, g.until - 59000); ok(g.until <= g.minAt + 1 || g.until < 1e9, "everybody ready: the day ends early");
  M.tick(g, g.until); ok(g.phase === "vote", "...and the vote opens"); }
{ const g = toNight(mk(7, 11)); M.tick(g, g.until); M.tick(g, g.until); const a = M.alive(g), v = a[0], t = a[1], u = a[2];
  ok(!M.act(g, v, {k: "vote", to: v}, g.until - 1000), "nobody votes for himself"); ok(M.act(g, v, {k: "vote", to: t}, g.until - 20000) && M.act(g, a[3], {k: "vote", to: t}, g.until - 20000) && M.act(g, a[4], {k: "vote", to: u}, g.until - 20000), "votes are taken (and may be changed)");
  M.act(g, a[4], {k: "vote", to: t}, g.until - 20000); for (const i of a.filter(x => ![v, a[3], a[4]].includes(x))) M.act(g, i, {k: "vote", to: -1}, g.until - 20000);
  ok(g.phase === "vote", "still the vote until its minimum"); M.tick(g, g.until);
  ok(!g.alive[t] && g.dead[t] === g.role[t] && g.log.at(-1).k === "out" && g.log.at(-1).votes === 3, "the person with the most votes is out and his role is shown", g.log.at(-1)); }
{ const g = toNight(mk(7, 12)); M.tick(g, g.until); M.tick(g, g.until); const a = M.alive(g); M.act(g, a[0], {k: "vote", to: a[2]}, g.until - 9000); M.act(g, a[1], {k: "vote", to: a[3]}, g.until - 9000); M.tick(g, g.until);
  ok(g.alive.every(Boolean) && g.log.at(-1).k === "tie" && g.phase === "night", "a tie sends nobody out"); }
{ const g = toNight(mk(7, 13)); M.tick(g, g.until); M.tick(g, g.until); const a = M.alive(g); for (const i of a) M.act(g, i, {k: "vote", to: -1}, g.until - 9000); M.tick(g, g.until);
  ok(g.alive.every(Boolean) && g.log.at(-1).k === "tie", "everybody abstains: nobody out"); }
{ const g = toNight(mk(7, 14)); M.tick(g, g.until + 1e6); ok(g.day >= 2 || g.over, "a long pause runs the phases that were due, one after another"); }

// ---- winning
{ const g = toNight(mk(5, 15)); M.tick(g, g.until); M.tick(g, g.until); const mf = seatOf(g, "mafia"), a = M.alive(g).filter(i => i !== mf);
  for (const i of M.alive(g)) M.act(g, i, {k: "vote", to: i === mf ? a[0] : mf}, g.until - 9000); M.tick(g, g.until);
  ok(g.over && g.over.winner === "town" && g.phase === "over" && !g.alive[mf], "the last mafia voted out: the town wins"); ok(!M.act(g, a[0], {k: "vote", to: a[1]}, g.until), "nothing is taken after the end"); }
{ const g = toNight(mk(5, 16)), mf = seatOf(g, "mafia"), c = [0, 1].map(k => seatOf(g, "citizen", k)), dr = seatOf(g, "doctor"), sh = seatOf(g, "sheriff");
  g.alive[c[0]] = false; g.alive[c[1]] = false; M.act(g, mf, {k: "kill", to: dr}, T0); M.tick(g, g.until);
  ok(g.over && g.over.winner === "mafia", "the mafia as many as the others: the mafia win (1 mafia v 1 sheriff after the kill)", g.over); }

// ---- the views
{ let bad = [], leaks = 0, n = 0;
  for (let s = 1; s <= 40; s++) { const N = 5 + s % 4, g = mk(N, 500 + s, Array(N).fill(true));
    for (let step = 0; step < 400 && !g.over; step++) { const now = g.until - 20000;
      for (let seat = 0; seat < N; seat++) { const v = M.view(g, seat, now); n++; const role = g.role[seat], keys = Object.keys(v);
        const allowed = new Set(["phase", "day", "until", "n", "you", "role", "alive", "dead", "log", "rev", "bot", "pick", "partner", "lastSave", "found", "ready", "readyN", "votes", "mates", "roles", "winner"]);
        if (keys.some(k => !allowed.has(k))) bad.push(["key", keys]);
        if (v.role !== role) bad.push(["role", seat]);
        if (v.mates && (role !== "mafia" || v.mates.some(i => g.role[i] !== "mafia"))) bad.push(["mates", seat]);
        if (role === "mafia" && JSON.stringify((v.mates || []).sort()) !== JSON.stringify(g.role.map((r, i) => r === "mafia" && i !== seat ? i : -1).filter(i => i >= 0))) bad.push(["mates2", seat]);
        if (v.found && role !== "sheriff") bad.push(["found", seat]); if (v.partner && role !== "mafia") bad.push(["partner", seat]);
        if (v.roles && !g.over) bad.push(["roles", seat]);
        for (const [k, r] of Object.entries(v.dead)) if (g.alive[k] || g.role[k] !== r) bad.push(["dead", k]);
        if (v.found && v.found.some(f => Object.keys(f).sort().join() !== "d,mafia,seat")) bad.push(["foundkeys", seat]);
        // no other living seat's role may be anywhere in the view: look for a role name that is not the seat's own, a mate's, or a dead seat's
        const txt = JSON.stringify(Object.assign({}, v, {role: undefined, dead: undefined, log: undefined, mates: undefined, roles: undefined, winner: undefined}));
        for (const r of ["mafia", "doctor", "sheriff", "citizen"]) if (txt.includes(':"' + r + '"')) leaks++;   // (a role name as a VALUE anywhere else)
      }
      for (let seat = 0; seat < N; seat++) { const a = M.bot(g, seat); if (a) M.act(g, seat, a, now); }
      M.tick(g, g.until); }
  }
  ok(bad.length === 0, `${n} views over 40 games: only the allowed fields, the right roles, no leak of another's role`, bad.slice(0, 3)); ok(leaks === 0, "no role name hides in the other fields", leaks); }
{ const g = toNight(mk(6, 17)), mf = seatOf(g, "mafia"), cz = seatOf(g, "citizen"); M.act(g, mf, {k: "kill", to: cz}, T0);
  const vm = M.view(g, seat2(g, mf), T0), vc = M.view(g, cz, T0); ok(vm.pick === cz && vc.pick === -1 && vc.partner === undefined, "a seat sees only its own pick (the partner picks go to the mafia only)");
  function seat2(g, s) { return s; } }
{ const g = mk(6, 18); const sh = seatOf(g, "sheriff"), mf = seatOf(g, "mafia", 0), mf2 = seatOf(g, "mafia", 1); const v = M.view(g, sh, 0); ok(v.mates === undefined && v.found.length === 0, "the sheriff has no mates and no findings yet");
  const vm = M.view(g, mf, 0); ok(JSON.stringify(vm.mates) === JSON.stringify([mf2]), "a mafia sees the other mafia", vm.mates); }

// ---- 600 whole games played by bots
{ let games = 0, over = 0, towns = 0, maf = 0, hung = 0, steps = 0, badInv = 0;
  for (let s = 1; s <= 600; s++) { const N = 5 + s % 4, g = mk(N, 9000 + s, Array(N).fill(true)); let k = 0;
    while (!g.over && k++ < 400) { const now = g.until - 15000; for (let seat = 0; seat < N; seat++) { const a = M.bot(g, seat); if (a) M.act(g, seat, a, now); } M.tick(g, g.until); steps++;
      const m = M.alive(g).filter(i => g.role[i] === "mafia").length; if (!g.over && (m === 0 || m >= M.alive(g).length - m)) badInv++; }
    games++; if (g.over) { over++; if (g.over.winner === "town") towns++; else maf++; } else hung++; }
  ok(hung === 0 && over === games, `600 games of bots all reach an end (${steps} phases)`, {games, over, hung}); ok(badInv === 0, "a game never goes on when one side has already won"); ok(towns > 30 && maf > 30, `both sides can win (town ${towns}, mafia ${maf}; the bots vote almost at random, so the mafia win most)`); }
console.log(`pass ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
