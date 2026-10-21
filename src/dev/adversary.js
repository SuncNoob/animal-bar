// 对抗测试 (dev only — never in the production bundle): a bot that plays the yard as nastily as it can — squeezes between
// furniture and walls, rams colliders at full dash, crashes the bike, swims into the stairs and the islet, spams sit/stand,
// eats huge bumps from fake guests, runs at 20 fps — and checks the game's invariants on every simulated frame.
//   __adv.run({ episodes: 60, seed: 1, frames: 300 })  → { episodes, frames, violations: { type: { n, samples } } }
//   __adv.run({ only: 'stairs' })                      → one scenario
// It steps the real game loop (__tiaohai.tick with rendering off), so whatever it finds is what players hit.

const TWO_PI = Math.PI * 2;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function mountAdversary(T) {
  let rnd = Math.random;
  const R = (a, b) => a + (b - a) * rnd(), pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const S = T.S, pos = T.pos;
  const Y = () => T.LAYOUT.yard, B = () => T.BOUNDS;

  // ---------- control ----------
  const steer = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; T.joy.x = dx / l; T.joy.y = dz / l; }; // S.yaw is held at 0: joy maps to world x / z
  const idle = () => { T.joy.x = 0; T.joy.y = 0; };
  let teleported = false; // the bot itself just moved us: not a game bug
  function reset(mode, x, z) {
    teleported = true;
    if (S.riding) T.dismount('off');
    S.tw = null; S.mode = mode; S.air = false; S.vy = 0; S.flip = false; S.emote = null; S.seat = null; S.riding = false;
    S.vel.set(0, 0, 0); S.kick.set(0, 0, 0); S.bumpCD = 0; S.dash = 0; S.dashCD = 0; S.yaw = 0; idle();
    for (const k of Object.keys(T.keys)) T.keys[k] = false;
    T.player.root.rotation.x = 0;
    pos.set(x, mode === 'swim' ? T.WATER_Y - 0.48 : T.groundAt(x, z), z);
  }
  const maybeDash = (p) => { if (rnd() < p) T.dash(); };
  const maybeJump = (p) => { if (rnd() < p) T.jump(); };
  let fakeId = 0;
  function bump(j) { // a fake guest rams us
    const a = R(0, TWO_PI); T.inject({ t: 'bump', id: `adv_${fakeId++ % 3}`, to: T.me.id, nx: Math.cos(a), nz: Math.sin(a), j, p: R(0, 3) });
  }
  const perimeterPoint = () => { // somewhere just inside the yard walls
    const b = B(), side = Math.floor(rnd() * 3);
    if (side === 0) return [b.x0 + R(0.05, 0.4), R(b.zNorth + 0.5, 4.5)];
    if (side === 1) return [b.x1 - R(0.05, 0.4), R(b.zNorth + 0.5, 4.5)];
    return [R(b.x0 + 0.3, b.x1 - 0.3), b.zNorth + 0.4 + R(0.02, 0.4)];
  };
  const swimPoint = () => { for (let i = 0; i < 400; i++) { const x = R(-15, 15), z = R(6, 24); if (T.swimmable(x, z)) return [x, z]; } return [0, 10]; };

  // ---------- scenarios: setup(ep) returns a per-frame policy(f) ----------
  const SCEN = {
    wallHug() { // shove into the walls and corners at odd angles, dash, hop
      const [x, z] = perimeterPoint(); reset('land', x, z);
      const out = [x < -7 ? -1 : x > 7 ? 1 : 0, z < -5 ? -1 : 0]; let ang = R(-1, 1);
      return (f) => { if (f % 40 === 0) ang = R(-1.1, 1.1); const c = Math.cos(ang), s = Math.sin(ang); steer(out[0] * c - out[1] * s + (out[0] ? 0 : R(-0.6, 0.6)), out[0] * s + out[1] * c + (out[1] ? 0 : R(-0.6, 0.6))); maybeDash(0.03); maybeJump(0.01); };
    },
    squeeze() { // wedge between a collider and the nearest wall, then wiggle and dash
      const b = B(), cs = T.COLLIDERS.circles.filter((c) => c.r > 0.1 && Math.min(c.x - b.x0, b.x1 - c.x, c.z - b.zNorth - 0.4) < c.r + 1.2 && c.z < 5);
      const c = cs.length ? pick(cs) : pick(T.COLLIDERS.circles);
      const d = [[b.x0 - c.x, 0], [b.x1 - c.x, 0], [0, b.zNorth + 0.4 - c.z]].map(([dx, dz]) => [dx, dz, Math.hypot(dx, dz)]).sort((p, q) => p[2] - q[2])[0];
      const nx = Math.sign(d[0]), nz = Math.sign(d[1]), x = c.x + nx * (c.r + 0.32), z = c.z + nz * (c.r + 0.32);
      reset('land', x, z); if (!T.walkable(pos.x, pos.z)) { pos.x = Math.min(b.x1, Math.max(b.x0, pos.x)); pos.z = Math.max(b.zNorth + 0.4, pos.z); }
      return (f) => { const ph = Math.floor(f / 25) % 4; if (ph === 0) steer(nx, nz); else if (ph === 1) steer(nz || R(-1, 1), nx || R(-1, 1)); else if (ph === 2) steer(-nz || R(-1, 1), -nx || R(-1, 1)); else steer(c.x - pos.x, c.z - pos.z); maybeDash(0.04); };
    },
    ram() { // full dash into a random collider from a random side
      const c = pick(T.COLLIDERS.circles.filter((k) => k.r > 0.1)); const a = R(0, TWO_PI);
      let x = c.x + Math.cos(a) * (c.r + 1.6), z = c.z + Math.sin(a) * (c.r + 1.6); if (!T.walkable(x, z)) { x = c.x + 1.8; z = c.z + 0.5; } if (!T.walkable(x, z)) [x, z] = [0, 1];
      reset('land', x, z);
      return (f) => { steer(c.x - pos.x + R(-0.3, 0.3), c.z - pos.z + R(-0.3, 0.3)); maybeDash(0.06); maybeJump(0.01); };
    },
    deckEdge() { // off the deck into the lagoon, then thrash about
      reset('land', R(-7.5, 7.5), R(4.3, 5.3)); let a = R(-0.9, 0.9);
      return (f) => { if (f % 50 === 0) a = R(-1.4, 1.4); steer(Math.sin(a), Math.cos(a)); maybeDash(0.03); maybeJump(0.02); };
    },
    swimChaos() { // random strokes, sprints, 回岸边, take-overs
      const [x, z] = swimPoint(); reset('swim', x, z); let dir = [R(-1, 1), R(-1, 1)], auto = false;
      return (f) => {
        if (f % 45 === 0) { if (rnd() < 0.2) { idle(); if (S.mode === 'swim') T.startSwimHome(); auto = true; } else { auto = false; dir = rnd() < 0.3 ? [T.STAIRS.x0 + R(-1, 3) - pos.x, T.STAIRS.z1 + R(-1, 1) - pos.z] : rnd() < 0.2 ? [-1.5 - pos.x, 16.5 - pos.z] : [R(-1, 1), R(-1, 1)]; } }
        if (!auto) steer(dir[0], dir[1]); maybeDash(0.02);
      };
    },
    stairs() { // attack the stairs block and the handrails from every side
      const st = T.STAIRS, side = Math.floor(rnd() * 4);
      const [x, z] = side === 0 ? [st.x0 - R(0.8, 2), R(st.z0 + 0.4, st.z1 + 1)] : side === 1 ? [st.x1 + R(0.8, 2), R(st.z0 + 0.4, st.z1 + 1)] : side === 2 ? [R(st.x0 - 1, st.x1 + 1), st.z1 + R(0.7, 2.5)] : [R(st.x0 - 1.2, st.x1 + 1.2), st.z1 + R(0.7, 1.2)];
      if (!T.swimmable(x, z)) return null; reset('swim', x, z);
      return (f) => { steer((st.x0 + st.x1) / 2 + R(-2.5, 2.5) - pos.x, (st.z0 + st.z1) / 2 + R(-1, 2) - pos.z); maybeDash(0.04); };
    },
    bike() { // mount, then ride into walls / furniture / the sea, hop, dash
      reset('land', 0, 1); const p = T.bike?.root.position; if (!p) return null;
      T.receiveBike({ v: 1, rider: null, nick: '', x: R(-6, 6), z: R(-4, 3), ry: R(0, TWO_PI), at: Date.now() + 1e7 + fakeId++, secs: {} }); T.tick(1);
      pos.set(p.x + 0.5, 0, p.z + 0.5); T.mountBike(); teleported = true; if (!S.riding) return null;
      let tgt = [R(-9, 9), R(-7, 8)];
      return (f) => { if (f % 70 === 0) tgt = rnd() < 0.15 ? [R(-6, 6), 9] : [R(-9, 9), R(-7, 5)]; steer(tgt[0] - pos.x, tgt[1] - pos.z); maybeDash(0.03); maybeJump(0.02); if (rnd() < 0.004) bump(R(4, 10)); };
    },
    seats() { // sit, get up by walking off in any direction, get bumped while seated
      const seats = T.seats; if (!seats.length) return null; let s = pick(seats);
      reset('land', s.x + 0.4, s.z + 0.4); T.sitOn(s); teleported = true;
      return (f) => {
        const k = f % 60;
        if (k === 0) { s = pick(seats); reset('land', s.x + R(-0.5, 0.5), s.z + R(-0.5, 0.5)); T.sitOn(s); teleported = true; }
        if (k < 20) idle(); else if (k < 40) steer(Math.cos(f), Math.sin(f)); else idle();
        if (k === 10 && rnd() < 0.3) bump(R(2, 9));
      };
    },
    bumpStorm() { // stand by a wall / the deck edge / the stairs top and get rammed hard and often
      const spots = [perimeterPoint(), [R(-7.5, 7.5), R(4.6, 5.4)], [R(T.STAIRS.x0, T.STAIRS.x1), 5.3], [R(-8, 8), R(-6, -5)]];
      const [x, z] = pick(spots); reset('land', x, z);
      return (f) => { if (f % 20 === 0) bump(R(3, 13)); if (f % 30 === 15) steer(R(-1, 1), R(-1, 1)); else if (f % 30 === 25) idle(); };
    },
    danceWalk() { // 蹦迪 while shuffling into walls and furniture
      const [x, z] = perimeterPoint(); reset('land', x, z); T.emote('dance'); let a = R(0, TWO_PI);
      return (f) => { if (f % 35 === 0) a = R(0, TWO_PI); steer(Math.cos(a), Math.sin(a)); if (rnd() < 0.003) T.emote('dance'); };
    },
  };

  // ---------- invariants ----------
  function checker(report, scen, ep) {
    const prev = pos.clone(); let tweenT = 0, spinPrev = null, prevMode = S.mode, inside = 0;
    const v = (type, extra = {}) => { const r = (report[type] ||= { n: 0, samples: [] }); r.n++; if (r.samples.length < 6) r.samples.push({ scen, ep, mode: S.mode, at: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)], riding: !!S.riding, air: !!S.air, ...extra }); };
    return (f, dt) => {
      if (![pos.x, pos.y, pos.z, S.vel.x, S.vel.z, S.kick.x, S.kick.z].every(Number.isFinite)) { v('nan'); pos.set(0, 0, 1); S.vel.set(0, 0, 0); S.kick.set(0, 0, 0); return; }
      const step = Math.hypot(pos.x - prev.x, pos.z - prev.z);
      if (teleported) teleported = false; else if (step > 30 * dt + 0.6 && !S.tw && prevMode === S.mode) v('teleport', { step: +step.toFixed(2), from: [+prev.x.toFixed(2), +prev.z.toFixed(2)] }); // standing up / climbing out snap you a step, a collider bounce pops you ≤ 0.7 m: by design
      prevMode = S.mode;
      if (S.mode === 'land' && !S.tw) {
        if (!T.walkable(pos.x, pos.z) && !(S.air && (T.insideSea(pos.x, pos.z, 0) || pos.z > T.BOUNDS.zLand))) v('land-off-walkable'); // flying off the deck into the water is fine
        if (!S.air && Math.abs(pos.y - T.groundAt(pos.x, pos.z)) > 0.08 && !S.riding) v('land-height', { y: +pos.y.toFixed(2), ground: +T.groundAt(pos.x, pos.z).toFixed(2) });
        const inC = T.COLLIDERS.circles.find((c) => c.r > 0.12 && !c.npc && Math.hypot(pos.x - c.x, pos.z - c.z) < c.r * 0.75);
        inside = inC ? inside + 1 : 0; // a frame or two inside (a dash into it, the bike dropping under you) is pushed out next frame
        if (inside === 3) { v('inside-collider', { c: [+inC.x.toFixed(2), +inC.z.toFixed(2), inC.r] }); const k = `${inC.x.toFixed(1)},${inC.z.toFixed(1)}`; (report._where ||= {})[k] = (report._where[k] || 0) + 1; }
      }
      if (S.mode === 'swim' && !S.tw) {
        if (T.onStairBlock(pos.x, pos.z) || T.nearStairPost(pos.x, pos.z)) v('swim-in-stairs');
        else if (!T.insideSea(pos.x, pos.z, 0.2)) v('swim-out-of-water');
      }
      if (S.mode === 'jumping' || S.mode === 'climbing' || S.mode === 'surfacing') { tweenT += dt; if (tweenT > 4) { v('stuck-tween', { secs: +tweenT.toFixed(1) }); tweenT = -99; } } else tweenT = 0;
      if (S.riding) { const b = T.bike?.root.position; if (b && Math.hypot(b.x - pos.x, b.z - pos.z) > 0.3) v('bike-detached', { bike: [+b.x.toFixed(2), +b.z.toFixed(2)] }); }
      const sp = T.player?.bones?.Spine01; // overlay pile-up = a spinning body
      if (sp) { if (spinPrev && sp.quaternion.angleTo(spinPrev) > 0.6) v('pose-jump', { rad: +sp.quaternion.angleTo(spinPrev).toFixed(2), act: T.player.action }); (spinPrev ||= sp.quaternion.clone()).copy(sp.quaternion); }
      prev.copy(pos);
    };
  }

  function run({ episodes = 40, seed = 1, frames = 300, only = null, slowEvery = 4 } = {}) {
    if (!T.player) return 'enter the yard first';
    rnd = mulberry32(seed); const report = {}, perScen = {}; let total = 0; const t0 = performance.now();
    const names = only ? [].concat(only) : Object.keys(SCEN);
    T.fast = true;
    try {
      for (let ep = 0; ep < episodes; ep++) {
        const scen = names[ep % names.length]; const policy = SCEN[scen](ep); if (!policy) continue;
        const ms = ep % slowEvery === slowEvery - 1 ? 50 : 1000 / 60; // every few episodes: a slow phone (20 fps → dt clamps at 50 ms)
        const check = checker(report, scen, ep); perScen[scen] = (perScen[scen] || 0) + 1;
        for (let f = 0; f < frames; f++) { policy(f); T.tick(1, ms); check(f, ms / 1000); total++; }
      }
    } finally { T.fast = false; idle(); if (S.riding) T.dismount('off'); S.tw = null; S.mode = 'land'; S.air = false; S.emote = null; pos.set(0, 0, 1); S.vel.set(0, 0, 0); S.kick.set(0, 0, 0); T.tick(2); }
    const out = { episodes, frames: total, secs: +((performance.now() - t0) / 1000).toFixed(1), perScen, clean: !Object.keys(report).length, violations: report };
    console.log('[adversary]', out); return out;
  }
  window.__adv = { run, scenarios: Object.keys(SCEN) };
}
