import * as THREE from 'three';
import { createCharacter } from './scene/characters.js';
import { makeNameLabel } from './avatar.js';
import { COLLIDERS } from './world.js';
import { LAYOUT as L } from './layout.js';
import { isEn, L as tr } from './i18n.js'; // L is the layout here

// NPCs follow deterministic loops driven by wall-clock time, so every guest sees them in the same place
// without any network traffic. Walkers stroll the courtyard; two crocs do lazy backstroke laps in the lagoon.

const WALK_ROUTES = {
  // [x, z, idle seconds at this point, facing when idle (radians) or null = keep heading]
  cat_tuantuan: { speed: 1.0, label: tr('团团', 'Tuantuan'), labelY: 1.4, route: [
    [L.spots.cat[0], L.spots.cat[1], 7, 0.5], [-3.8, -0.6, 4, -1.3], [-3.6, 2.6, 3, 0.4], [0.8, 3.2, 4, 0], [2.8, 0.6, 4, 1.2], [-1.0, 0.6, 0, null], // around the jukebox
  ] },
  croc_edazi: { speed: 0.8, label: tr('鳄搭子', 'Croc Buddy'), labelY: 1.95, route: [
    [L.spots.croc[0], L.spots.croc[1], 8, -0.35], [3.6, -1.8, 3, Math.PI], [1.2, 0.2, 4, 0.3], [2.4, 3.0, 4, 0], [3.2, -0.4, 3, null],
  ] },
};

function buildTimeline(route, speed) {
  const segs = []; let t = 0;
  for (let i = 0; i < route.length; i++) {
    const [x, z, idle, face] = route[i], [nx, nz] = route[(i + 1) % route.length];
    const heading = Math.atan2(nx - x, nz - z);
    segs.push({ kind: 'idle', t0: t, t1: t + idle, x, z, ry: face ?? heading }); t += idle;
    const d = Math.hypot(nx - x, nz - z);
    segs.push({ kind: 'walk', t0: t, t1: t + d / speed, x, z, x2: nx, z2: nz, ry: heading }); t += d / speed;
  }
  return { segs, T: t };
}

// Rotate a bone about a WORLD-space axis on top of whatever pose the mixer gave it this frame.
const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _rq = new THREE.Quaternion();
function rotateBoneWorld(bone, worldAxis, angle) {
  bone.parent.getWorldQuaternion(_pq).invert();
  _ax.copy(worldAxis).applyQuaternion(_pq).normalize();
  bone.quaternion.premultiply(_q.setFromAxisAngle(_ax, angle));
}
const STROKE = (Math.PI * 2) / 1.9; // one arm circle every 1.9 s

// What they say. Ambient lines are picked from wall-clock time, so every guest sees the same line at the same moment.
const LINES_ZH = {
  cat_tuantuan: {
    ambient: ['今晚想喝点啥？来问我呀～', '第一杯不知道喝什么？捷克皮尔森准没错。', '跳海不收门票，上岸记得甩甩水。', '谁把银杏叶扫到吧台上了？',
      '我今天的围裙是不是很好看？', '不喝酒也行，啤酒花气泡水超好喝！', '外面风大，进来坐坐～', '嘘——点唱机还在等歌。',
      '鳄搭子说他不会游泳，我不信。', '今晚的月亮像一块柚子皮。', '碰碰车可以，别撞翻我的托盘！', '湖里那两位又在仰泳了……'],
    greet: ['嗨～{nick}！今晚想喝点什么？', '{nick}来啦！坐哪儿都行～', '{nick}，要不要玩我的怪问题？'],
    bump: ['哎哟喂！', '慢点慢点～', '要不要来一杯压压惊？', '围裙都给你撞歪了！'],
  },
  croc_edazi: {
    ambient: ['……欢迎。', '慢慢喝，夜还长。', '我的尾巴，不是凳子。', '浑浊 IPA，浑是故意的。', '上次有人问我会不会咬人。我说看心情。',
      '吧台擦过三遍了。', '帝国世涛？那是今晚的句号。', '别冲太快，地滑。', '湖里那俩是我表弟。', '西海岸 IPA……苦，跟我一样。'],
    greet: ['{nick}，坐。', '{nick}。……要喝点什么？', '来了啊，{nick}。'],
    bump: ['稳如泰山。', '……再来？', '我尾巴比你重。', '你没事吧？'],
  },
  swimmer: {
    ambient: ['咕噜咕噜～', '仰泳使我快乐。', '今天的星星好多。', '水温刚刚好～', '游完这圈就上岸……骗你的。', '别挡我道哦～', '表哥在吧台，我在湖里。'],
    bump: ['咕噜！', '别挡道！', '噗——', '谁戳我肚皮！'],
  },
};
const LINES_EN = {
  cat_tuantuan: {
    ambient: ['What are you drinking tonight? Ask me~', 'Not sure what to start with? A Czech Pilsner never misses.', 'No cover charge for jumping in the sea. Shake off the water when you climb out.', 'Who swept ginkgo leaves onto the bar?',
      'Isn’t my apron cute today?', 'No alcohol? The hop water is really good!', 'It’s windy out there, come sit~', 'Shh— the jukebox is still waiting for a song.',
      'Croc Buddy says he can’t swim. I don’t buy it.', 'Tonight’s moon looks like a piece of yuzu peel.', 'Bumper cars, fine, just don’t knock over my tray!', 'Those two in the lake are doing backstroke again…'],
    greet: ['Hey~ {nick}! What are you drinking tonight?', '{nick} is here! Sit anywhere~', '{nick}, want to try my odd questions?'],
    bump: ['Ow ow ow!', 'Easy, easy~', 'Need a drink to calm your nerves?', 'You knocked my apron crooked!'],
  },
  croc_edazi: {
    ambient: ['…Welcome.', 'Take your time. The night is long.', 'My tail. Is not. A stool.', 'Hazy IPA. Cloudy on purpose.', 'Someone once asked if I bite. I said it depends on my mood.',
      'Wiped the bar three times already.', 'Imperial Stout? That’s tonight’s full stop.', 'Don’t run. Floor’s slippery.', 'Those two in the lake are my cousins.', 'West Coast IPA… bitter. Like me.'],
    greet: ['{nick}. Sit.', '{nick}. …What’ll it be?', 'Ah, {nick}. You’re here.'],
    bump: ['Solid as a rock.', '…again?', 'My tail weighs more than you.', 'You okay?'],
  },
  swimmer: {
    ambient: ['Blub blub~', 'Backstroke makes me happy.', 'So many stars tonight.', 'Water’s just right~', 'One more lap and I’ll get out… just kidding.', 'Don’t get in my lane~', 'My cousin’s at the bar, I’m in the lake.'],
    bump: ['Blub!', 'Out of my lane!', 'Pfft—', 'Who poked my belly!'],
  },
};
export const LINES = isEn ? LINES_EN : LINES_ZH;
const pickBy = (arr, k) => arr[((k % arr.length) + arr.length) % arr.length];
const pickRnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createNPCs(scene, { insideSea, splash, speech, getNick = () => '' }) {
  const walkers = [];
  for (const [id, cfg] of Object.entries(WALK_ROUTES)) {
    const ch = createCharacter(id); scene.add(ch.root);
    const l = makeNameLabel(cfg.label); l.position.set(0, cfg.labelY, 0); l.scale.multiplyScalar(1.2); ch.root.add(l);
    const col = COLLIDERS.circles.find((c) => c.npc === id) || (COLLIDERS.circles.push({ x: 0, z: 0, r: id === 'croc_edazi' ? 0.75 : 0.45, npc: id }), COLLIDERS.circles.at(-1));
    walkers.push({ id, ch, col, cfg, ...buildTimeline(cfg.route, cfg.speed), offset: id.length * 7.3, wobble: 0, waving: 0, ry: 0, greetAt: -1e9, slot: -1 });
  }

  // lagoon swimmers: ellipses around the islet, opposite directions, checked against the shore
  const isl = L.sea.island;
  const swimmers = [];
  for (const [i, rx, rz, speed, dir] of [[0, 4.8, 3.4, 0.5, 1], [1, 9.6, 6.3, 0.45, -1]]) {
    let k = 1; // shrink the loop until every sample is comfortably inside the water
    for (; k > 0.5; k -= 0.05) { let ok = true; for (let a = 0; a < Math.PI * 2; a += 0.1) if (!insideSea(isl.x + Math.cos(a) * rx * k, isl.z + Math.sin(a) * rz * k, 1.1)) { ok = false; break; } if (ok) break; }
    const ch = createCharacter('croc_edazi');
    // backstroke: the treading-water swim clip tipped onto its back (belly up, head leading the way)
    const roll = new THREE.Group(); roll.add(ch.root); ch.root.rotation.x = -Math.PI / 2; scene.add(roll);
    swimmers.push({ id: 'swimmer' + i, ch, roll, rx: rx * k, rz: rz * k, w: (speed / ((rx + rz) * k * 0.5)) * dir, phase: i * 2.4, wobble: 0, ripple: i * 0.4, slot: -1 });
  }

  const at = (w, now) => {
    const t = ((now + w.offset) % w.T + w.T) % w.T;
    const s = w.segs.find((g) => t >= g.t0 && t < g.t1) || w.segs[0];
    if (s.kind === 'idle') return { x: s.x, z: s.z, ry: s.ry, walking: false, idleLeft: s.t1 - t };
    const k = (t - s.t0) / (s.t1 - s.t0);
    return { x: s.x + (s.x2 - s.x) * k, z: s.z + (s.z2 - s.z) * k, ry: s.ry, walking: true };
  };
  const headOf = (obj, y) => (v) => v.set(obj.position.x, obj.position.y + y, obj.position.z);
  const speak = (who, text, ms) => {
    if (!speech) return;
    if (who.roll) speech.say(who.id, headOf(who.roll, 0.75), text, { ms, tone: 'swim', name: tr('仰泳鳄', 'Backstroke Croc') });
    else speech.say(who.id, headOf(who.ch.root, who.cfg.labelY + 0.35), text, { ms, tone: who.id === 'croc_edazi' ? 'croc' : 'cat', name: who.cfg.label });
  };
  // ambient chatter on a shared clock: every NPC talks in its own ~11–15 s rhythm
  const ambient = (who, lines, now, period, offset) => {
    const slot = Math.floor((now + offset) / period);
    if (slot !== who.slot && (now + offset) % period < 1) { who.slot = slot; speak(who, pickBy(lines, slot * 7 + offset | 0), 4200); }
  };
  const lerpAngle = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

  return {
    walkers, swimmers,
    position(id) { return walkers.find((w) => w.id === id)?.ch.root.position; },
    bump(id) { const w = walkers.find((q) => q.id === id); if (w && !(w.wobble > 0.2)) { w.wobble = 1; speak(w, pickRnd(LINES[id].bump), 2600); return true; } return false; },
    bumpSwimmer(s) { s.wobble = 1; speak(s, pickRnd(LINES.swimmer.bump), 2200); },
    say(id, text, ms = 3200) { const w = walkers.find((q) => q.id === id) || swimmers.find((q) => q.id === id); if (w) speak(w, text, ms); },
    update(dt, playerPos, surfaceHeight, camPos) {
      const lod = (p) => { if (!camPos) return 1; const d = camPos.distanceTo(p); return d < 12 ? 1 : d < 22 ? 2 : 3; };
      const now = Date.now() / 1000;
      for (const w of walkers) {
        const p = at(w, now);
        w.ch.root.position.set(p.x, 0, p.z); w.col.x = p.x; w.col.z = p.z;
        w.ry = lerpAngle(w.ry, p.ry, Math.min(1, dt * 6)); w.ch.root.rotation.y = w.ry;
        const near = playerPos && Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < 3.2;
        if (!p.walking && near && w.waving <= 0 && p.idleLeft > 2.5) w.waving = 2.8;
        const close = playerPos && Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < 2.6;
        if (close && now - w.greetAt > 40) { w.greetAt = now; speak(w, pickRnd(LINES[w.id].greet).replace('{nick}', getNick() || tr('朋友', 'friend')), 3600); }
        else ambient(w, LINES[w.id].ambient, now, w.id === 'croc_edazi' ? 15 : 11, w.offset);
        w.waving = Math.max(0, w.waving - dt);
        w.ch.groundLock = true; w.ch.play(p.walking ? 'walk' : w.waving > 0 ? 'wave' : 'idle'); w.ch.update(dt, p.walking ? 1.4 : 0, lod(w.ch.root.position));
        if (w.wobble > 0) { w.wobble = Math.max(0, w.wobble - dt * 1.2); w.ch.root.rotation.z = Math.sin(now * 18) * 0.18 * w.wobble; w.ch.root.rotation.x = Math.cos(now * 14) * 0.1 * w.wobble; }
        else { w.ch.root.rotation.z = 0; w.ch.root.rotation.x = 0; }
      }
      for (const s of swimmers) {
        const a = now * s.w + s.phase, x = isl.x + Math.cos(a) * s.rx, z = isl.z + Math.sin(a) * s.rz;
        const dx = -Math.sin(a) * s.rx * Math.sign(s.w), dz = Math.cos(a) * s.rz * Math.sign(s.w);
        const y = surfaceHeight ? surfaceHeight(x, z, now) : L.WATER_Y;
        s.roll.position.set(x, y - 0.12 + Math.sin(now * 2.1 + s.phase) * 0.03, z); s.roll.rotation.set(0, Math.atan2(dx, dz) + Math.PI, 0); // head is local −z after tipping
        if (s.wobble > 0) { s.wobble = Math.max(0, s.wobble - dt * 1.5); s.roll.rotation.z = Math.sin(now * 16) * 0.35 * s.wobble; }
        // backstroke: idle base pose + windmilling arms (half a turn apart), flutter kick, a little body roll
        s.ch.play('idle'); s.ch.update(dt, 0, 1);
        if (s.ch.ready) {
          if (!s.bones) { s.bones = {}; s.ch.root.traverse((o) => { if (o.isBone) s.bones[o.name] = o; }); }
          const b = s.bones, lat = s.lat || (s.lat = new THREE.Vector3()), ph = now * STROKE + s.phase;
          lat.set(1, 0, 0).applyQuaternion(s.ch.root.getWorldQuaternion(_rq));
          if (b.L_Upperarm) rotateBoneWorld(b.L_Upperarm, lat, -ph % (Math.PI * 2));
          if (b.R_Upperarm) rotateBoneWorld(b.R_Upperarm, lat, -(ph + Math.PI) % (Math.PI * 2));
          if (b.L_Thigh) rotateBoneWorld(b.L_Thigh, lat, Math.sin(ph * 2.2) * 0.32);
          if (b.R_Thigh) rotateBoneWorld(b.R_Thigh, lat, -Math.sin(ph * 2.2) * 0.32);
          s.ch.root.rotation.y = Math.sin(ph) * 0.16; // roll about the head-to-feet axis toward the stroking arm
        }
        s.ripple -= dt; if (s.ripple <= 0) { s.ripple = 1.1; splash?.(x, z, 0.25); }
        ambient(s, LINES.swimmer.ambient, now, 17, 5 + s.phase * 4);
      }
    },
  };
}
