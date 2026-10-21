import * as THREE from 'three';
import { L } from '../i18n.js';

// Head wear, built from primitives so it costs no downloads. Inspired by Goose Goose Duck's silly hats and
// Ragnarok Online's iconic headgear. Convention: origin = top of the crown, +Y up, +Z = where the face looks,
// metres, sized for 狗哥's head (crown ~0.32 m wide); the anchor scales it for other heads.
// makeHat(id, { earClear }) → { obj, height, update(dt, t) }  (earClear = how far ears rise above the crown)

export const HATS = [
  { id: 'none', name: L('不戴', 'None'), icon: '⭕' },
  { id: 'poring', name: L('波利帽', 'Poring hat'), icon: '🍮' },
  { id: 'halo', name: L('天使光环', 'Angel halo'), icon: '😇' },
  { id: 'devil', name: L('恶魔角', 'Devil horns'), icon: '😈' },
  { id: 'bow', name: L('大蝴蝶结', 'Big bow'), icon: '🎀' },
  { id: 'chick', name: L('头顶小鸡', 'Chick on top'), icon: '🐤' },
  { id: 'party', name: L('派对帽', 'Party hat'), icon: '🥳' },
  { id: 'crown', name: L('皇冠', 'Crown'), icon: '👑' },
  { id: 'propeller', name: L('竹蜻蜓帽', 'Propeller cap'), icon: '🚁' },
  { id: 'sprout', name: L('嫩芽', 'Sprout'), icon: '🌱' },
  { id: 'chef', name: L('厨师帽', 'Chef hat'), icon: '🧑‍🍳' },
  { id: 'egg', name: L('蛋壳帽', 'Eggshell'), icon: '🥚' },
  { id: 'cowboy', name: L('牛仔帽', 'Cowboy hat'), icon: '🤠' },
];
export const HAT_IDS = new Set(HATS.map((h) => h.id));

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...o });
const glow = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: true });
const M = {}; // shared materials (created on first use)
const m = (key, make) => M[key] || (M[key] = make());
function mesh(geo, material, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, material); o.position.set(x, y, z); o.castShadow = true; return o; }
function eyes(g, y, z, dx, r = 0.018) {
  const black = m('black', () => mat(0x1b1620, { roughness: 0.2 })), shine = m('shine', () => glow(0xffffff, 1.4));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(r, 10, 8), black, s * dx, y, z));
    g.add(mesh(new THREE.SphereGeometry(r * 0.35, 6, 5), shine, s * dx + r * 0.3, y + r * 0.35, z + r * 0.8));
  }
}
function stripes(colors, n = 8, diagonal = true) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  for (let i = 0; i < n * 2; i++) { x.fillStyle = colors[i % colors.length]; x.save(); if (diagonal) { x.translate(64, 64); x.rotate(Math.PI / 5); x.translate(-128, -128); } x.fillRect(0, i * (256 / (n * 2)), 256, 256 / (n * 2) + 1); x.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// bend a vertical geometry: x += k * h², h = height above its base
function bend(geo, k, base) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const h = p.getY(i) - base; p.setX(i, p.getX(i) + k * h * h); } geo.computeVertexNormals(); return geo; }

const BUILD = {
  poring(g) { // RO's pink jelly, wobbling
    const pink = m('poring', () => mat(0xff8fbd, { roughness: 0.18, emissive: 0x5a1030, emissiveIntensity: 0.25 }));
    const body = new THREE.Group(); g.add(body);
    const blob = mesh(new THREE.SphereGeometry(0.16, 28, 18), pink, 0, 0.1, 0); blob.scale.set(1.05, 0.78, 1); body.add(blob);
    const tip = mesh(bend(new THREE.ConeGeometry(0.05, 0.13, 14).translate(0, 0.065, 0), -2.2, 0), pink, 0, 0.21, -0.02); body.add(tip);
    eyes(body, 0.13, 0.14, 0.055, 0.02);
    const mouth = mesh(new THREE.TorusGeometry(0.026, 0.007, 6, 14, Math.PI), m('black', () => mat(0x1b1620)), 0, 0.085, 0.152); mouth.rotation.z = Math.PI; body.add(mouth);
    const hi = mesh(new THREE.SphereGeometry(0.035, 10, 8), m('shine', () => glow(0xffffff, 1.4)), -0.07, 0.17, 0.08); hi.scale.set(1, 0.6, 0.5); body.add(hi);
    return { height: 0.26, update: (dt, t) => { const s = Math.sin(t * 5.5) * 0.06; body.scale.set(1 - s * 0.6, 1 + s, 1 - s * 0.6); } };
  },
  halo(g, { earClear = 0 }) { // angel: floating ring + little wings
    const lift = Math.max(0.2, earClear + 0.08);
    const ring = mesh(new THREE.TorusGeometry(0.13, 0.022, 10, 36), m('halo', () => glow(0xffd76a, 2.6)), 0, lift, 0); ring.rotation.x = Math.PI / 2; ring.castShadow = false; g.add(ring);
    const white = m('feather', () => mat(0xfffaf2, { roughness: 0.7 }));
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.17, -0.1, -0.05); g.add(w);
      for (let i = 0; i < 3; i++) { const f = mesh(new THREE.SphereGeometry(0.07 - i * 0.012, 12, 8), white, s * (0.05 + i * 0.045), 0.03 - i * 0.025, -0.02); f.scale.set(1.2, 0.55, 0.25); f.rotation.z = s * (0.5 + i * 0.25); w.add(f); }
      wings.push([w, s]);
    }
    return { height: lift + 0.05, update: (dt, t) => { ring.position.y = lift + Math.sin(t * 2.2) * 0.02; ring.rotation.z = t * 0.6; for (const [w, s] of wings) w.rotation.y = s * (0.3 + Math.sin(t * 7) * 0.25); } };
  },
  devil(g) {
    const red = m('devil', () => mat(0xd8323c, { roughness: 0.3, emissive: 0x400008, emissiveIntensity: 0.4 }));
    for (const s of [-1, 1]) {
      const geo = bend(new THREE.ConeGeometry(0.055, 0.22, 14, 8).translate(0, 0.11, 0), 2.2, 0);
      const h = mesh(geo, red, s * 0.1, -0.02, 0.02); h.rotation.z = -s * 0.35; h.scale.x = s; g.add(h);
    }
    return { height: 0.2, update: () => {} };
  },
  bow(g) { // RO "Big Ribbon"
    const red = m('bow', () => mat(0xe8384f, { roughness: 0.45 }));
    const b = new THREE.Group(); b.position.set(0.06, 0.05, -0.01); b.rotation.z = -0.25; g.add(b);
    for (const s of [-1, 1]) { const l = mesh(new THREE.SphereGeometry(0.08, 16, 10), red, s * 0.085, 0, 0); l.scale.set(1.25, 0.85, 0.42); l.rotation.z = s * 0.35; b.add(l); }
    b.add(mesh(new THREE.SphereGeometry(0.035, 12, 8), red));
    for (const s of [-1, 1]) { const t = mesh(new THREE.BoxGeometry(0.04, 0.1, 0.012), red, s * 0.03, -0.06, 0); t.rotation.z = s * 0.4; b.add(t); }
    return { height: 0.12, update: (dt, t) => { b.rotation.z = -0.25 + Math.sin(t * 3) * 0.05; } };
  },
  chick(g) { // a chick riding on your head (RO "Chick Hat")
    const y = m('chick', () => mat(0xffd43f, { roughness: 0.75 })), o = m('beak', () => mat(0xff8a2a, { roughness: 0.4 }));
    const c = new THREE.Group(); g.add(c);
    const body = mesh(new THREE.SphereGeometry(0.085, 16, 12), y, 0, 0.07, -0.01); body.scale.set(1, 0.9, 1.05); c.add(body);
    const head = new THREE.Group(); head.position.set(0, 0.165, 0.03); c.add(head);
    head.add(mesh(new THREE.SphereGeometry(0.058, 16, 12), y));
    const beak = mesh(new THREE.ConeGeometry(0.018, 0.035, 8), o, 0, -0.005, 0.06); beak.rotation.x = Math.PI / 2; head.add(beak);
    eyes(head, 0.015, 0.048, 0.025, 0.011);
    for (const s of [-1, 1]) { const w = mesh(new THREE.SphereGeometry(0.035, 10, 8), y, s * 0.08, 0.07, -0.01); w.scale.set(0.4, 0.8, 1); c.add(w); }
    const tuft = mesh(new THREE.ConeGeometry(0.012, 0.04, 6), y, 0, 0.06, 0); head.add(tuft);
    return { height: 0.24, update: (dt, t) => { c.position.y = Math.abs(Math.sin(t * 4)) * 0.02; head.rotation.y = Math.sin(t * 0.9) * 0.6; head.rotation.x = Math.max(0, Math.sin(t * 2.3)) * 0.3; } };
  },
  party(g) {
    const tex = stripes(['#ff4f8b', '#ffd93d', '#3fd0ff'], 6);
    const cone = mesh(new THREE.ConeGeometry(0.1, 0.3, 28, 1, true).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide }), 0.02, -0.03, 0);
    cone.rotation.z = -0.22; g.add(cone);
    const pom = mesh(new THREE.SphereGeometry(0.035, 12, 10), m('pom', () => mat(0xffffff, { roughness: 0.9 })), 0, 0.3, 0); cone.add(pom);
    return { height: 0.3, update: (dt, t) => { cone.rotation.z = -0.22 + Math.sin(t * 2.6) * 0.06; } };
  },
  crown(g) {
    const gold = m('gold', () => mat(0xffc531, { metalness: 0.9, roughness: 0.22, emissive: 0x3a2500, emissiveIntensity: 0.4 }));
    const band = mesh(new THREE.CylinderGeometry(0.12, 0.115, 0.07, 28, 1, true), gold, 0, 0.01, 0); band.material.side = THREE.DoubleSide; g.add(band);
    const gems = [0xff3060, 0x40a0ff, 0x46e08a];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
      const sp = mesh(new THREE.ConeGeometry(0.03, 0.08, 4), gold, Math.cos(a) * 0.115, 0.08, Math.sin(a) * 0.115); g.add(sp);
      g.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), gold, Math.cos(a) * 0.115, 0.125, Math.sin(a) * 0.115));
      const gem = mesh(new THREE.OctahedronGeometry(0.018), m('gem' + (i % 3), () => glow(gems[i % 3], 1.8)), Math.cos(a) * 0.123, 0.01, Math.sin(a) * 0.123); g.add(gem);
    }
    g.rotation.z = 0.12;
    return { height: 0.14, update: () => {} };
  },
  propeller(g) { // GGD-style propeller beanie, spinning
    const geo = new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const cols = [new THREE.Color(0xff4b4b), new THREE.Color(0xffd23f), new THREE.Color(0x3d8bff), new THREE.Color(0x4cd06a)], c = [];
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)) + Math.PI; const k = Math.floor(a / (Math.PI / 2)) % 4; c.push(cols[k].r, cols[k].g, cols[k].b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    const cap = mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 0, -0.06, 0); cap.scale.y = 0.8; g.add(cap);
    const brim = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), m('brim', () => mat(0x3d8bff)), 0, -0.055, 0.07); brim.scale.z = 0.8; g.add(brim);
    const stem = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), m('stem', () => mat(0x222222)), 0, 0.09, 0); g.add(stem);
    const rotor = new THREE.Group(); rotor.position.y = 0.12; g.add(rotor);
    for (const s of [-1, 1]) { const b = mesh(new THREE.BoxGeometry(0.14, 0.006, 0.035), m('blade' + s, () => mat(s > 0 ? 0xff4b4b : 0xffd23f)), s * 0.075, 0, 0); b.rotation.x = s * 0.25; rotor.add(b); }
    rotor.add(mesh(new THREE.SphereGeometry(0.014, 8, 6), m('stem', () => mat(0x222222))));
    return { height: 0.14, update: (dt) => { rotor.rotation.y += dt * 16; } };
  },
  sprout(g) {
    const green = m('leaf', () => mat(0x5fd35a, { roughness: 0.5, emissive: 0x0d3a0a, emissiveIntensity: 0.3 }));
    const s = new THREE.Group(); s.scale.setScalar(1.7); g.add(s);
    s.add(mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.12, 6).translate(0, 0.06, 0), m('stalk', () => mat(0x6fbf3a))));
    for (const k of [-1, 1]) { const l = mesh(new THREE.SphereGeometry(0.05, 14, 8), green, k * 0.045, 0.125, 0); l.scale.set(1, 0.22, 0.55); l.rotation.z = k * 0.45; s.add(l); }
    return { height: 0.26, update: (dt, t) => { s.rotation.z = Math.sin(t * 2.4) * 0.22; s.rotation.x = Math.sin(t * 1.7) * 0.1; } };
  },
  chef(g) {
    const w = m('chef', () => mat(0xf8f6f0, { roughness: 0.85 }));
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 24), w, 0, 0.02, 0));
    const top = new THREE.Group(); top.position.y = 0.12; g.add(top);
    top.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), w, 0, 0.02, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; top.add(mesh(new THREE.SphereGeometry(0.07, 12, 10), w, Math.cos(a) * 0.08, -0.005, Math.sin(a) * 0.08)); }
    return { height: 0.24, update: (dt, t) => { top.scale.setScalar(1 + Math.sin(t * 3) * 0.02); } };
  },
  egg(g) { // RO "Egg Shell": the top of an egg with a zig-zag crack
    const geo = new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const p = geo.attributes.position, last = 12; // zig-zag the lowest ring
    for (let i = 0; i < p.count; i++) { const row = Math.floor(i / 25), col = i % 25; if (row === last) p.setY(i, p.getY(i) + (col % 2 ? 0.028 : -0.012)); }
    geo.computeVertexNormals(); geo.scale(1, 1.25, 1);
    const shell = mesh(geo, m('egg', () => mat(0xfbf5e6, { roughness: 0.4, side: THREE.DoubleSide })), 0, -0.09, 0); g.add(shell);
    shell.rotation.z = 0.15;
    return { height: 0.12, update: () => {} };
  },
  cowboy(g) {
    const brown = m('cowboy', () => mat(0x9a6438, { roughness: 0.8 })), band = m('band', () => mat(0x3b2416, { roughness: 0.6 }));
    const brimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.014, 32, 1);
    const p = brimGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) + x * x * 1.6); } brimGeo.computeVertexNormals();
    const brim = mesh(brimGeo, brown, 0, -0.02, 0); g.add(brim);
    const crown = mesh(new THREE.CylinderGeometry(0.1, 0.125, 0.13, 24), brown, 0, 0.05, 0); crown.scale.z = 0.85; g.add(crown);
    const b = mesh(new THREE.CylinderGeometry(0.124, 0.127, 0.025, 24), band, 0, 0.0, 0); b.scale.z = 0.86; g.add(b);
    const dent = mesh(new THREE.SphereGeometry(0.05, 10, 6), brown, 0, 0.115, 0); dent.scale.set(1.6, 0.3, 1.2); g.add(dent);
    g.rotation.x = -0.12;
    return { height: 0.14, update: () => {} };
  },
};

export function makeHat(id, ctx = {}) {
  const build = BUILD[id]; if (!build) return null;
  const obj = new THREE.Group(); obj.name = 'hat:' + id;
  const r = build(obj, ctx) || {};
  obj.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  return { obj, height: r.height ?? 0.15, update: r.update || (() => {}) };
}
