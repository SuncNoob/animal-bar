import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildAnimal, animateAnimal } from '../avatar.js';
import { makeHat } from './hats.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { L } from '../i18n.js';

// Tripo-generated, rigged characters (public/models/*.glb). Each kind falls back to the primitive
// placeholder from avatar.js until (or if) its GLB is unavailable, so the game never blocks on assets.

const FILES = { dog_ge: 'dog', rabbit_mei: 'rabbit', chicken_jibie: 'chicken', cat_tuantuan: 'cat', croc_edazi: 'croc' };
// world height in metres (Tripo normalises models to 1m tall incl. ears)
const HEIGHT = { dog_ge: 1.05, rabbit_mei: 1.25, chicken_jibie: 1.02, cat_tuantuan: 1.0, croc_edazi: 1.6 };
// game action → clip name (first match wins)
const CLIPS = {
  idle: ['idle'], walk: ['walk'], jump: ['dive'], swim: ['swim'], climb: ['walk'], wave: ['greet_01', 'greet', 'wave'], cheer: ['cheer', 'clap', 'greet_01'], sit: ['sit'], hop: ['jump', 'dive'],
};

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
function load(kind) {
  if (!FILES[kind]) return Promise.resolve(null);
  if (!cache.has(kind)) cache.set(kind, loader.loadAsync(`/models/${FILES[kind]}.glb`).catch((e) => { console.warn('model fallback', kind, e.message); return null; }));
  return cache.get(kind);
}
// which clip packs exist per character (see public/models/*-extra*.glb)
const EXTRA_PACKS = { dog_ge: ['extra', 'extra2'], rabbit_mei: ['extra', 'extra2'], cat_tuantuan: ['extra'], croc_edazi: ['extra'] };
const extraCache = new Map();
function loadExtra(kind) {
  // extra clip packs retargeted onto the same rig without geometry (-extra: sit/cheer/walk/swim, -extra2: jump)
  if (!extraCache.has(kind)) extraCache.set(kind, Promise.all((EXTRA_PACKS[kind] || []).map((x) => loader.loadAsync(`/models/${FILES[kind]}-${x}.glb`).then((g) => g.animations).catch(() => [])))
    .then((packs) => packs.flat()));
  return extraCache.get(kind);
}
export const preloadCharacters = (kinds) => Promise.all(kinds.map(load));

// A character without clips of its own borrows another's: every Tripo biped rig has the same bone names, so a clip is
// re-expressed per bone relative to each rig's rest pose; only the hips translate, scaled to this rig's leg length.
const CLIP_DONOR = { chicken_jibie: 'dog_ge' }; // 鸡瘪 has a rig but no clips of its own (no Tripo credits left for them)
const restPose = (scene) => { const m = new Map(); scene.traverse((o) => { if (o.isBone) m.set(o.name, { q: o.quaternion.clone(), p: o.position.clone() }); }); return m; };
function borrowClips(clips, from, to) {
  const hip = [...to.keys()].find((n) => /^(hip|hips)$/i.test(n)) || [...to.keys()].find((n) => /pelvis/i.test(n));
  const q = new THREE.Quaternion(), ia = new THREE.Quaternion();
  return clips.map((c) => {
    const tracks = [];
    for (const t of c.tracks) {
      const dot = t.name.lastIndexOf('.'), bone = t.name.slice(0, dot), prop = t.name.slice(dot + 1), a = from.get(bone), b = to.get(bone);
      if (!a || !b) continue;
      if (prop === 'quaternion') {
        const v = Float32Array.from(t.values); ia.copy(a.q).invert();
        for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(ia).premultiply(b.q); q.toArray(v, i); } // this rest · (donor rest⁻¹ · donor pose)
        tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, v));
      } else if (prop === 'position' && bone === hip) {
        const v = Float32Array.from(t.values), k = b.p.length() / (a.p.length() || 1);
        for (let i = 0; i < v.length; i += 3) { v[i] = b.p.x + (v[i] - a.p.x) * k; v[i + 1] = b.p.y + (v[i + 1] - a.p.y) * k; v[i + 2] = b.p.z + (v[i + 2] - a.p.z) * k; }
        tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
      } // the donor's other translations / scales are its own proportions: dropped
    }
    return new THREE.AnimationClip(c.name, c.duration, tracks);
  });
}

export function createCharacter(kind, { clipDonor = CLIP_DONOR[kind] } = {}) {
  const root = new THREE.Group();
  const placeholder = buildAnimal(kind); placeholder.scale.setScalar(0.95); root.add(placeholder);
  const ch = { root, kind, ready: false, mixer: null, actions: {}, current: null, action: 'idle', speed: 0, outfit: { color: null, hat: 'none' } };

  load(kind).then((gltf) => {
    if (!gltf) return;
    const model = SkeletonUtils.clone(gltf.scene); const rest = clipDonor ? restPose(model) : null;
    const inner = new THREE.Group(); inner.add(model);
    model.rotation.y = -Math.PI / 2; // Tripo exports face +X; the game faces +Z
    const box = new THREE.Box3().setFromObject(model); const h = box.max.y - box.min.y || 1;
    inner.scale.setScalar(HEIGHT[kind] / h);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material.envMapIntensity = 0.6; } } });
    // tilt pivots the whole body about the hips (used to lift swimmers' heads out of the water)
    const tilt = new THREE.Group(); tilt.position.set(0, 0.26, 0.1); inner.position.set(0, -0.26, -0.1); tilt.add(inner);
    root.remove(placeholder); root.add(tilt); ch.tilt = tilt; ch.bones = {};
    root.updateMatrixWorld(true); ch.soles = pickSoles(model);
    model.traverse((o) => { if (o.isBone) ch.bones[o.name] = o; });
    model.traverse((o) => { if (!ch.hip && o.isBone && /^(hip|hips|pelvis)$/i.test(o.name)) ch.hip = o; });
    prepareOutfit(ch, model); // needs ch.bones (hat anchor on the head)
    ch.mixer = new THREE.AnimationMixer(model);
    const bind = (clips) => {
      for (const [act, names] of Object.entries(CLIPS)) {
        if (ch.actions[act] && !names.slice(0, 1).some((n) => clips.some((c) => c.name.toLowerCase() === n))) continue;
        const clip = names.map((n) => clips.find((c) => c.name.toLowerCase() === n)).find(Boolean);
        if (clip) ch.actions[act] = ch.mixer.clipAction(clip);
      }
      for (const a of ['jump', 'sit', 'hop']) if (ch.actions[a]) { ch.actions[a].setLoop(THREE.LoopOnce, 1); ch.actions[a].clampWhenFinished = true; }
    };
    bind(gltf.animations);
    ch.ready = true; ch.current = null; play(ch, ch.action, true); applyOutfit(ch);
    // optional extra clips (sit/cheer) retargeted onto the same rig, shipped without geometry
    if (clipDonor) Promise.all([load(clipDonor), loadExtra(clipDonor)]).then(([g, extra]) => { if (g) { bind(borrowClips([...g.animations, ...extra], restPose(g.scene), rest)); play(ch, ch.action, true); } });
    else loadExtra(kind).then((clips) => { if (clips?.length) { bind(clips); if (ch.action === 'sit' || ch.action === 'cheer' || ch.action === 'hop') play(ch, ch.action, true); } });
  });

  ch.play = (a) => play(ch, a);
  ch.setOutfit = (o) => { ch.outfit = { color: o.color ?? null, hat: o.hat || 'none' }; if (ch.ready) applyOutfit(ch); };
  // step > 1 = animation LOD: far-away characters advance their mixer every `step` frames (same total time)
  ch.update = (dt, moveSpeed = 0, step = 1) => {
    ch.speed = moveSpeed;
    if (!ch.ready) { animateAnimal(placeholder, dt, ch.action); return; }
    keepPose(ch, true);
    ch._acc = (ch._acc || 0) + dt; ch._n = ((ch._n || 0) + 1) % step; if (ch._n !== 0) { keepPose(ch, false); return; } dt = ch._acc; ch._acc = 0;
    const cur = ch.actions[ch.action] || ch.actions.idle;
    if (cur && ch.action === 'walk') cur.timeScale = THREE.MathUtils.clamp(moveSpeed / 2.2, 0.6, 1.6);
    if (cur && ch.action === 'climb') cur.timeScale = 1.4;
    ch.mixer.update(dt);
    keepPose(ch, false);
    keepFeetOnGround(ch, dt);
    if (ch.hat) { ch._ht = (ch._ht || 0) + dt; ch.hat.update(dt, ch._ht); }
    if (ch.kit) { ch._kt = (ch._kt || 0) + dt; ch.kit.tick(ch._kt); }
  };
  return ch;
}

// ---- procedural overlays never pile up ----
// swim / dance / ride poses bend bones on top of the clip every frame. three.js only rewrites a bone when its clip
// value changes, so on a frozen clip (the finished 'sit' while riding) or a skipped LOD frame last frame's bend is
// still on the bone and the next one stacks on it — the rider's spine and legs would spin round and round.
// keepPose(ch, true) before the mixer notes what the overlays left; keepPose(ch, false) after it puts back the clip
// pose wherever the mixer didn't write.
const OVERLAID = ['L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'L_Upperarm', 'R_Upperarm', 'L_Forearm', 'R_Forearm', 'Spine01', 'Waist', 'NeckTwist01', 'Head'];
function keepPose(ch, before) {
  if (!ch.bones) return;
  for (const n of OVERLAID) {
    const b = ch.bones[n]; if (!b) continue; const u = b.userData;
    if (before) { (u.post ||= new THREE.Quaternion()).copy(b.quaternion); continue; }
    if (u.base && b.quaternion.equals(u.post)) b.quaternion.copy(u.base); // untouched by the mixer: drop last frame's bend
    else (u.base ||= new THREE.Quaternion()).copy(b.quaternion);       // a fresh clip pose
  }
}

// ---- feet never sink into the floor ----
// Some clips (the rabbit's walk most of all) push the soles a few cm below the rig's origin. We sample a
// handful of sole vertices once, and each frame lift the body just enough that the lowest one stays at y = 0
// in the character's own space. Only while ch.groundLock is set (standing/walking on the ground).
const _sv = new THREE.Vector3();
function pickSoles(model) {
  const cands = [];
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) { o.getVertexPosition(i, _sv).applyMatrix4(o.matrixWorld); cands.push({ mesh: o, i, y: _sv.y }); } // skinned rest pose
  });
  if (!cands.length) return [];
  let minY = Infinity, maxY = -Infinity; for (const c of cands) { minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); }
  const band = minY + (maxY - minY) * 0.03; // the bottom 3 % of the body = the soles in the bind pose
  const low = cands.filter((c) => c.y <= band);
  const step = Math.max(1, Math.floor(low.length / 72)); // ~72 samples is plenty and cheap
  return low.filter((_, k) => k % step === 0);
}
function keepFeetOnGround(ch, dt) {
  if (!ch.tilt || !ch.soles?.length) return;
  let target = 0;
  if (ch.groundLock) {
    ch.root.updateMatrixWorld(true);
    let mn = Infinity;
    for (const s of ch.soles) { s.mesh.getVertexPosition(s.i, _sv).applyMatrix4(s.mesh.matrixWorld); if (_sv.y < mn) mn = _sv.y; }
    const sole = (mn - ch.root.matrixWorld.elements[13]) / (ch.root.scale.y || 1) - (ch.lift || 0) - (ch.hop || 0); // sole height without our lift (or a dance hop)
    target = THREE.MathUtils.clamp(-sole, 0, 0.25);
  }
  const cur = ch.lift || 0;
  ch.lift = target > cur ? target : cur + (target - cur) * Math.min(1, dt * 16); // rise at once, settle smoothly
  ch.tilt.position.y = 0.26 + ch.lift;
}

function play(ch, a, force) {
  if (ch.action === a && !force && ch.current) return;
  ch.action = a;
  if (!ch.ready) return;
  const next = ch.actions[a] || ch.actions.idle; if (!next || (next === ch.current && !force)) return;
  next.reset(); next.enabled = true; next.setEffectiveWeight(1);
  if (a === 'jump') next.timeScale = 1.6;
  if (a === 'hop') { next.timeScale = 1.9; next.time = Math.min(0.3, next.getClip().duration * 0.15); } // skip most of the crouch
  if (ch.current && ch.current !== next) next.crossFadeFrom(ch.current, a === 'jump' || a === 'hop' ? 0.1 : 0.28, false);
  next.play(); ch.current = next;
}

export async function loadProp(name) {
  const gltf = await loader.loadAsync(`/models/${name}.glb`).catch(() => null);
  if (!gltf) return null;
  const m = gltf.scene; m.rotation.y = -Math.PI / 2;
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const g = new THREE.Group(); g.add(m); return g;
}

// ---- outfits: clothing colour + head wear ----
// The garment is found by hue in the base-colour texture (狗哥's teal jacket, 兔妹's lavender hoodie) and
// re-coloured in the shader, keeping the texture's shading. key = [hue, hue tolerance, garment brightness].
const GARMENT = { dog_ge: [0.533, 0.085, 0.31], rabbit_mei: [0.875, 0.11, 0.67], chicken_jibie: [0.24, 0.075, 0.54] }; // 鸡瘪's sage vest (feathers sit at ~0.12)
const HAT_SCALE = { dog_ge: 1.15, rabbit_mei: 1.0, chicken_jibie: 1.15 }; // chibi heads: wear it big
const CROWN_DROP = { chicken_jibie: 0.075 };
const DEFAULT_TINT = { chicken_jibie: '#26262c' }; // 鸡瘪's 原色 is a 古惑仔 black vest (the model's own is sage) // the crown search finds the top of 鸡瘪's comb: hats sit on the head, comb poking up
export const OUTFIT_COLORS = [
  { id: null, name: L('原色', 'Original'), hex: null },
  { id: 'red', name: L('番茄红', 'Tomato'), hex: '#e5483f' }, { id: 'orange', name: L('橘子橙', 'Tangerine'), hex: '#f2913a' }, { id: 'yellow', name: L('鸭鸭黄', 'Duckling'), hex: '#f4cf3b' },
  { id: 'green', name: L('薄荷绿', 'Mint'), hex: '#59c25c' }, { id: 'cyan', name: L('汽水青', 'Soda'), hex: '#33c4c0' }, { id: 'blue', name: L('宝石蓝', 'Sapphire'), hex: '#3f7fe6' },
  { id: 'purple', name: L('葡萄紫', 'Grape'), hex: '#9b62e3' }, { id: 'pink', name: L('樱花粉', 'Sakura'), hex: '#f48fc0' }, { id: 'black', name: L('夜店黑', 'Club black'), hex: '#3b3a45' }, { id: 'white', name: L('奶油白', 'Cream'), hex: '#f3f1ea' },
];
export const COLOR_IDS = new Set(OUTFIT_COLORS.map((c) => c.id).filter(Boolean));
const TINT_GLSL = `
#include <map_fragment>
if (uTintOn > 0.5) {
  vec3 sc = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(sc.bg, K.wz), vec4(sc.gb, K.xy), step(sc.b, sc.g));
  vec4 q = mix(vec4(p.xyw, sc.r), vec4(sc.r, p.yzx), step(p.x, sc.r));
  float d = q.x - min(q.w, q.y);
  vec3 hsv = vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  float hd = abs(fract(hsv.x - uTintKey.x + 0.5) - 0.5);
  float msk = (1.0 - smoothstep(uTintKey.y * 0.7, uTintKey.y, hd)) * smoothstep(0.07, 0.13, hsv.y);
  float v = clamp(hsv.z * uTint.z / uTintKey.z, 0.0, 1.0);
  vec3 rgb = v * mix(vec3(1.0), clamp(abs(fract(uTint.x + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0), uTint.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, pow(rgb, vec3(2.2)), msk);
}`;
function hexToHsv(hex) {
  const c = new THREE.Color(hex); const r = c.r, g = c.g, b = c.b; // sRGB components? Color stores linear: convert back
  const s = [r, g, b].map((x) => THREE.ColorManagement.enabled ? (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) : x);
  const mx = Math.max(...s), mn = Math.min(...s), d = mx - mn; let h = 0;
  if (d) { if (mx === s[0]) h = ((s[1] - s[2]) / d) % 6; else if (mx === s[1]) h = (s[2] - s[0]) / d + 2; else h = (s[0] - s[1]) / d + 4; h /= 6; if (h < 0) h += 1; }
  return [h, mx ? d / mx : 0, mx];
}
function prepareOutfit(ch, model) {
  const key = GARMENT[ch.kind];
  if (key) {
    ch.tintU = { uTint: { value: new THREE.Vector3() }, uTintKey: { value: new THREE.Vector3(...key) }, uTintOn: { value: 0 } };
    model.traverse((o) => {
      if (!o.isMesh || !o.material?.map) return;
      o.material = o.material.clone(); // per character: each guest has their own colour
      o.material.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, ch.tintU); sh.fragmentShader = 'uniform vec3 uTint; uniform vec3 uTintKey; uniform float uTintOn;\n' + sh.fragmentShader.replace('#include <map_fragment>', TINT_GLSL); };
      o.material.customProgramCacheKey = () => 'tiaohai-tint';
    });
  }
  // hat anchor on the head bone, aligned with the body in the bind pose, sitting on the crown
  const head = ch.bones.Head; if (!head) return;
  const v = new THREE.Vector3(), pts = [];
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const P = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, hi = o.skeleton.bones.indexOf(head);
    for (let i = 0; i < P.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k); if (w < 0.5) continue; o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld); ch.root.worldToLocal(v); pts.push(v.clone()); }
  });
  if (!pts.length) return;
  let x0 = Infinity, x1 = -Infinity, top = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); top = Math.max(top, p.y); }
  const xc = (x0 + x1) / 2, strip = pts.filter((p) => Math.abs(p.x - xc) < 0.035);
  const crownY = Math.max(...strip.map((p) => p.y)), cap = strip.filter((p) => p.y > crownY - 0.03);
  const crown = new THREE.Vector3(xc, crownY - (CROWN_DROP[ch.kind] || 0), cap.reduce((a, p) => a + p.z, 0) / cap.length);
  ch.crown = crown.clone(); ch.earClear = top - crownY;
  const anchor = new THREE.Group(); head.add(anchor);
  const wp = ch.root.localToWorld(crown.clone()); anchor.position.copy(head.worldToLocal(wp));
  const qh = head.getWorldQuaternion(new THREE.Quaternion()), qr = ch.root.getWorldQuaternion(new THREE.Quaternion());
  anchor.quaternion.copy(qh.invert().multiply(qr));
  const sh = head.getWorldScale(new THREE.Vector3()), sr = ch.root.getWorldScale(new THREE.Vector3());
  anchor.scale.set(sr.x / sh.x, sr.y / sh.y, sr.z / sh.z).multiplyScalar(HAT_SCALE[ch.kind] || 1);
  ch.hatAnchor = anchor;
  if (ch.kind === 'chicken_jibie') gangsterKit(ch, model);
}

// a group on `bone` whose frame matches the character root's in the bind pose, origin at `at` (root-local)
function boneAnchor(ch, bone, at) {
  const a = new THREE.Group(); bone.add(a);
  a.position.copy(bone.worldToLocal(ch.root.localToWorld(at.clone())));
  a.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(ch.root.getWorldQuaternion(new THREE.Quaternion())));
  const sb = bone.getWorldScale(new THREE.Vector3()), sr = ch.root.getWorldScale(new THREE.Vector3()); a.scale.set(sr.x / sb.x, sr.y / sb.y, sr.z / sb.z);
  return a;
}
// 古惑仔 鸡瘪: wraparound black shades on the head bone, a glowing Cuban-link gold chain with a $ medallion on the upper spine
let KIT = null;
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function wrap(g, R) { // bend a flat front piece round the face (a cylinder of radius R about the head's vertical axis); normals turn with it
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), a = x / R, rr = R + z, c = Math.cos(a), sn = Math.sin(a);
    p.setXYZ(i, sn * rr, p.getY(i), c * rr - R);
    if (n) { const nx = n.getX(i), nz = n.getZ(i); n.setXYZ(i, nx * c + nz * sn, n.getY(i), -nx * sn + nz * c); }
  }
  return g;
}
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function almond(w, h, sx, grow = 0) { // 山鸡's lens: a narrow oval that tapers and sweeps up toward the temple (sx = which side is outward)
  const s = new THREE.Shape(), N = 48, hw = w / 2 + grow, hh = h / 2 + grow;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2, u = Math.cos(t), x = hw * u, o = sx * u; // o: +1 at the outer end, -1 at the nose
    const y = hh * Math.sin(t) * (1 - 0.32 * Math.max(0, o)) * (1 + 0.12 * Math.max(0, -o)) + 0.011 * Math.max(0, o) ** 2;
    if (i) s.lineTo(x, y); else s.moveTo(x, y);
  }
  return s;
}
// 鸡瘪's head outline at eye height (radius from the head axis, by angle from straight ahead, measured off the mesh)
const HEAD_R = [[0, 0.212], [20, 0.209], [30, 0.212], [40, 0.212], [50, 0.218], [60, 0.227], [70, 0.237], [80, 0.239], [90, 0.239], [100, 0.236], [110, 0.232], [120, 0.223], [130, 0.221]];
const headR = (deg) => { deg = Math.abs(deg); for (let i = 1; i < HEAD_R.length; i++) if (deg <= HEAD_R[i][0]) { const [d0, r0] = HEAD_R[i - 1], [d1, r1] = HEAD_R[i]; return r0 + (r1 - r0) * (deg - d0) / (d1 - d0); } return HEAD_R[HEAD_R.length - 1][1]; };
const SHADES_R = 0.242, SHADES_CZ = 0.03; // the frame wraps a cylinder concentric with the head; the glasses' origin sits on its front
function buildKit() {
  const R = SHADES_R, LW = 0.148, LH = 0.058, GAP = 0.072, cx = LW / 2 + GAP / 2;
  const polar = (aRad, r, y) => new THREE.Vector3(Math.sin(aRad) * r, y, Math.cos(aRad) * r - R); // glasses-local point at angle a, radius r from the head axis
  // --- shades: slim glossy black frame wrapped round the face, smoky glass, chunky end pieces + temples that run back along the head
  const acetate = new THREE.MeshPhysicalMaterial({ color: 0x060608, roughness: 0.16, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 3.5 });
  // smoky glass a few shades lighter than the frame, so the thick black rim reads against it
  const glassTex = canvasTex(8, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2c3038'); gr.addColorStop(0.5, '#3a3a44'); gr.addColorStop(1, '#5a4656'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const glass = new THREE.MeshPhysicalMaterial({ map: glassTex, roughness: 0.02, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.0, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [240, 560], envMapIntensity: 8 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.08, clearcoat: 1, envMapIntensity: 6 });
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc94f, metalness: 1, roughness: 0.14, clearcoat: 0.5, clearcoatRoughness: 0.1, emissive: 0xffa31a, emissiveIntensity: 0.85, envMapIntensity: 5 });
  const frameGeos = [], lensGeos = [];
  for (const sx of [-1, 1]) {
    const rim = almond(LW, LH, sx, 0.017); rim.holes.push(almond(LW, LH, sx, 0)); // a fat, glossy acetate rim (exaggerated so it reads at game distance)
    const f = new THREE.ExtrudeGeometry(rim, { depth: 0.014, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.006, bevelSegments: 4, curveSegments: 6 }); f.translate(sx * cx, 0, -0.008); frameGeos.push(f);
    const lg = new THREE.ShapeGeometry(almond(LW, LH, sx, 0.001), 6); lg.deleteAttribute('normal'); lg.computeVertexNormals();
    const uv = lg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, (lg.attributes.position.getY(i) + LH / 2) / LH); lg.translate(sx * cx, 0, 0); lensGeos.push(lg);
  }
  // a double bridge over the beak: the lenses sit well apart
  for (const [y, dz, r] of [[LH * 0.3, 0.012, 0.0085], [LH * 0.62, 0.004, 0.006]]) frameGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-GAP / 2 - 0.012, y * 0.7, 0.0), new THREE.Vector3(0, y, dz), new THREE.Vector3(GAP / 2 + 0.012, y * 0.7, 0.0)), 14, r, 8));
  const front = wrap(mergeGeometries(frameGeos.map(ni)), R), lenses = wrap(mergeGeometries(lensGeos.map(ni)), R);
  const side = [], studs = [], inlay = [];
  const aTip = (cx + LW / 2 + 0.017) / R; // the rim's outer tip, in radians round the head
  for (const sx of [-1, 1]) {
    // 镜架头: a chunky end piece sweeping from the rim's outer corner round the cheek
    const endPts = []; for (let i = 0; i <= 6; i++) { const a = aTip - 0.12 + i * 0.05; endPts.push(polar(sx * a, Math.max(R + 0.002, headR(a * 57.3) + 0.02), 0.014 + 0.004 * Math.sin(i / 6 * Math.PI))); }
    side.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(endPts), 20, 0.0145, 10));
    // temple: hugs the outside of the head back past the cheek, dropping a little toward the ear
    const tPts = []; const a0 = aTip + 0.17, a1 = 2.05;
    for (let i = 0; i <= 10; i++) { const u = i / 10, a = a0 + (a1 - a0) * u; tPts.push(polar(sx * a, headR(a * 57.3) + 0.019, 0.016 - 0.04 * u * u)); }
    const tc = new THREE.CatmullRomCurve3([endPts[endPts.length - 1], ...tPts]);
    side.push(new THREE.TubeGeometry(tc, 40, 0.0105, 10));
    side.push(new THREE.SphereGeometry(0.0105, 10, 8).translate(...tPts[tPts.length - 1].toArray())); // rounded tip
    // chrome strip down the outside of each temple, a chrome hinge plate, gold rivets
    inlay.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tPts.slice(0, 8).map((p, i) => polar(sx * (a0 + (a1 - a0) * i / 10), headR((a0 + (a1 - a0) * i / 10) * 57.3) + 0.029, p.y + 0.003))), 30, 0.0042, 6));
    const hp = endPts[endPts.length - 1], ha = sx * (aTip + 0.18);
    inlay.push(new THREE.BoxGeometry(0.012, 0.034, 0.05).rotateY(ha).translate(hp.x + Math.sin(ha) * 0.008, hp.y, hp.z + Math.cos(ha) * 0.008));
    studs.push(new THREE.SphereGeometry(0.0065, 10, 8).translate(hp.x + Math.sin(ha) * 0.016, hp.y + 0.004, hp.z + Math.cos(ha) * 0.016));
    const ra = (sx * (cx + LW * 0.36)) / R; studs.push(new THREE.SphereGeometry(0.0048, 8, 6).translate(Math.sin(ra) * (R + 0.012), LH * 0.4, Math.cos(ra) * (R + 0.012) - R)); // rivet on the rim
  }
  const temples = mergeGeometries(side.map(ni)), trim = mergeGeometries(inlay.map(ni));
  // --- chain: dense oval links, every other one turned 90° so they interlock, a front dip, a bail and a $ medallion
  const link = new THREE.TorusGeometry(0.0115, 0.0042, 8, 18); link.scale(1.45, 1, 0.82);
  const N = 62, links = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), pos = new THREE.Vector3(), tan = new THREE.Vector3(), sparks = [];
  const pathAt = (u, out) => { const a = u * Math.PI * 2; return out.set(Math.sin(a) * 0.205, -0.04 * Math.max(0, Math.cos(a)) ** 1.5, Math.cos(a) * 0.19); };
  for (let i = 0; i < N; i++) {
    const u = i / N; pathAt(u, pos); pathAt(u + 0.002, tan).sub(pos).normalize();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan); if (i % 2) q.multiply(qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    const g = link.clone(); g.applyMatrix4(m4.compose(pos, q, new THREE.Vector3(1, 1, 1))); links.push(ni(g));
    if (i % 3 === 0) sparks.push(pos.x, pos.y + 0.006, pos.z, Math.random() * 6.28);
  }
  const coinTex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, w / 2); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#f4be3a'); gr.addColorStop(1, '#a8740e'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a5a08'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 14, 0, 7); g.stroke();
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); // the cylinder cap's UVs run sideways: pre-rotate so the $ stands upright
    g.font = '900 150px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 10; g.strokeStyle = '#7a4c06'; g.strokeText('$', 0, 8); g.fillStyle = '#ffe58a'; g.fillText('$', 0, 8); g.restore();
  });
  const coinMat = new THREE.MeshPhysicalMaterial({ map: coinTex, emissiveMap: coinTex, emissive: 0xffd060, emissiveIntensity: 0.7, metalness: 1, roughness: 0.18, clearcoat: 0.6, envMapIntensity: 5 });
  const coin = new THREE.CylinderGeometry(0.04, 0.04, 0.01, 40).rotateX(Math.PI / 2).translate(0, -0.088, 0.218);
  links.push(ni(new THREE.TorusGeometry(0.04, 0.0045, 8, 40).translate(0, -0.088, 0.218)), ni(new THREE.TorusGeometry(0.01, 0.0035, 8, 16).translate(0, -0.046, 0.214)));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; sparks.push(Math.cos(a) * 0.04, -0.088 + Math.sin(a) * 0.04, 0.224, Math.random() * 6.28); } // diamond ring
  const sg = new THREE.BufferGeometry(), sp = [], ph = [];
  for (let i = 0; i < sparks.length; i += 4) { sp.push(sparks[i], sparks[i + 1], sparks[i + 2]); ph.push(sparks[i + 3]); }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aPh; uniform float uT; varying float vA; void main(){ vA = pow(max(0., sin(uT * 3.1 + aPh * 4.)), 14.); vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = (0.05 / -mv.z) * 900. * (0.3 + vA); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vA; void main(){ vec2 c = gl_PointCoord - .5; float r = length(c); float star = max(0., 1. - abs(c.x) * 14.) * max(0., 1. - abs(c.y) * 2.2) + max(0., 1. - abs(c.y) * 14.) * max(0., 1. - abs(c.x) * 2.2); float a = (smoothstep(.5, 0., r) * .5 + star) * vA; gl_FragColor = vec4(vec3(1., .93, .7) * 2.4, a); }',
  });
  return { acetate, glass, gold, chrome, coinMat, sparkMat, front, lenses, temples, trim, studs: mergeGeometries(studs.map(ni)), chain: mergeGeometries(links), coin, sparks: sg };
}
function gangsterKit(ch) {
  const b = ch.bones; if (!b.Head) return;
  KIT ||= buildKit();
  const glasses = boneAnchor(ch, b.Head, new THREE.Vector3(0, 0.727, SHADES_CZ + SHADES_R)); // on the head's cylinder: far enough out that the bead eyes stay behind the glass
  glasses.add(new THREE.Mesh(KIT.front, KIT.acetate), new THREE.Mesh(KIT.lenses, KIT.glass), new THREE.Mesh(KIT.temples, KIT.acetate), new THREE.Mesh(KIT.trim, KIT.chrome), new THREE.Mesh(KIT.studs, KIT.gold));
  const chain = boneAnchor(ch, b.Spine02 || b.Spine01 || b.Head, new THREE.Vector3(0, 0.535, 0.05));
  const c = new THREE.Mesh(KIT.chain, KIT.gold); c.castShadow = true; const coin = new THREE.Mesh(KIT.coin, KIT.coinMat);
  const sparkle = new THREE.Points(KIT.sparks, KIT.sparkMat); sparkle.frustumCulled = false; sparkle.renderOrder = 3;
  chain.add(c, coin, sparkle);
  ch.kit = { glasses, chain, tick: (t) => { KIT.sparkMat.uniforms.uT.value = t; } };
}
function applyOutfit(ch) {
  const { color, hat } = ch.outfit;
  if (ch.tintU) {
    const hex = OUTFIT_COLORS.find((x) => x.id === color)?.hex || DEFAULT_TINT[ch.kind];
    ch.tintU.uTintOn.value = hex ? 1 : 0;
    if (hex) ch.tintU.uTint.value.set(...hexToHsv(hex));
  }
  if (ch.hatAnchor && ch.hatId !== hat) {
    if (ch.hat) { ch.hatAnchor.remove(ch.hat.obj); ch.hat.obj.traverse((o) => o.geometry?.dispose()); ch.hat = null; }
    ch.hatId = hat;
    const h = makeHat(hat, { earClear: ch.earClear / (HAT_SCALE[ch.kind] || 1) });
    if (h) { ch.hatAnchor.add(h.obj); ch.hat = h; }
  }
  // how tall the whole character is now (name labels sit above it)
  ch.topY = Math.max(ch.crown ? ch.crown.y + (ch.earClear || 0) : 1.2, ch.crown && ch.hat ? ch.crown.y + ch.hat.height * (HAT_SCALE[ch.kind] || 1) : 0);
  ch.onOutfit?.();
}
