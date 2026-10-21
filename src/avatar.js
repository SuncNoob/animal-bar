import * as THREE from 'three';

const mat = (c, rough = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
const ball = (r, c, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat(c));
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
};

const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

export const LOOKS = {
  dog_ge:     { kind: 'dog',    fur: 0xE8A33E, belly: 0xF6E8C8, outfit: 0x2F6A78, trim: 0xE06A1B, ear: 0xD08A2E },
  rabbit_mei: { kind: 'rabbit', fur: 0xF7F0E6, belly: 0xFFFFFF, outfit: 0xB7A2DC, trim: 0xF3C9A0, ear: 0xF4B6C6 },
  chicken_jibie: { kind: 'chicken', fur: 0xF6D45A, belly: 0xFFF6E0, outfit: 0x7E9F78, trim: 0xF2EAD3, ear: 0xE5534B },
  cat_tuantuan: { kind: 'cat',  fur: 0xF0932F, belly: 0xFBE9CC, outfit: 0x2B3A7A, trim: 0xC0392B, ear: 0xF0932F },
  croc_edazi:   { kind: 'croc', fur: 0x93B58A, belly: 0xF2E7BD, outfit: 0x2B3A7A, trim: 0xC0392B, ear: 0x93B58A },
};

// Placeholder animal built from primitives. Front faces +Z.
export function buildAnimal(look) {
  const L = typeof look === 'string' ? LOOKS[look] || LOOKS.dog_ge : look; // an unknown guest (newer build) still gets a body
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const body = ball(0.3, L.outfit, 1, 1.05, 0.9); body.position.y = 0.55; rig.add(body);
  const belly = ball(0.22, L.belly, 0.9, 1, 0.5); belly.position.set(0, 0.5, 0.2); rig.add(belly);
  const head = new THREE.Group(); head.position.y = 0.95; rig.add(head);
  head.add(ball(0.28, L.fur, 1, 0.94, 0.96));
  const snout = ball(0.13, L.belly, 1.1, 0.8, 1); snout.position.set(0, -0.06, 0.24); head.add(snout);
  const nose = ball(0.04, 0x222222); nose.position.set(0, -0.01, 0.35); head.add(nose);
  for (const s of [-1, 1]) { const e = ball(0.035, 0x151515); e.position.set(0.1 * s, 0.05, 0.25); head.add(e); }

  const ears = [];
  const addEar = (s) => {
    const g = new THREE.Group(); g.position.set(0.19 * s, 0.2, 0); head.add(g);
    if (L.kind === 'dog') {
      const e = ball(0.1, L.ear, 0.7, 1.5, 0.45); e.position.set(0.1 * s, -0.12, 0); g.add(e); g.rotation.z = -0.25 * s;
    } else if (L.kind === 'rabbit') {
      const e = ball(0.085, L.fur, 0.6, 2.6, 0.4); e.position.y = 0.22; g.add(e);
      const i = ball(0.06, L.ear, 0.5, 2.1, 0.3); i.position.set(0, 0.22, 0.04); g.add(i); g.rotation.z = -0.1 * s;
    } else if (L.kind === 'cat') {
      const e = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 4), mat(L.ear)); e.position.y = 0.12; g.add(e); const ei = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), mat(0xf6b3b3)); ei.position.set(0, 0.1, 0.03); g.add(ei);
    } else {
      g.visible = false;
    }
    ears.push(g);
  };
  addEar(-1); addEar(1);
  if (L.kind === 'croc') {
    snout.visible = false; nose.visible = false;
    const jaw = ball(0.14, L.fur, 1.3, 0.6, 2.9); jaw.position.set(0, -0.05, 0.45); head.add(jaw);
    const belly2 = ball(0.12, L.belly, 1.2, 0.5, 2.3); belly2.position.set(0, -0.13, 0.4); head.add(belly2);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 5), mat(0xffffff)); t.rotation.x = Math.PI; t.position.set(0.11 * s, -0.095, 0.3 + i * 0.1); head.add(t); }
    for (const s of [-1, 1]) { const eb = ball(0.06, L.fur, 1, 1, 1); eb.position.set(0.11 * s, 0.2, 0.18); head.add(eb); const ey = ball(0.03, 0x151515); ey.position.set(0.11 * s, 0.23, 0.22); head.add(ey); }
    for (let i = 0; i < 3; i++) { const rd = ball(0.035, 0x6f9a68, 1, 1.4, 1); rd.position.set(0, 0.27 - i * 0.02, -0.02 - i * 0.1); head.add(rd); }
    for (let i = -1; i <= 1; i++) { const f = ball(0.045, L.fur, 0.6, 1.2, 1); f.position.set(0, 0.86 - i * 0.12, -0.27 - Math.abs(i) * 0.02); rig.add(f); }
  }
  if (L.kind === 'cat') { // scarf
    const sc = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), mat(L.trim)); sc.position.y = 0.76; sc.rotation.x = Math.PI / 2; rig.add(sc);
  }
  // tail
  const tail = new THREE.Group(); tail.position.set(0, 0.35, -0.25); rig.add(tail);
  const tb = ball(0.1, L.kind === 'rabbit' ? 0xFFFFFF : L.fur, 1, 1, 1.5); tb.position.set(0, 0.05, -0.12); tb.rotation.x = -0.5; tail.add(tb);
  if (L.kind === 'croc') { for (let i = 1; i <= 3; i++) { const seg = ball(0.1 - i * 0.02, L.fur, 1, 0.9, 1.2); seg.position.set(0, 0.0 - i * 0.02, -0.12 - i * 0.2); tail.add(seg); } }
  if (L.kind === 'cat') { // stripes + whiskers so it reads as a cat, not a dog
    snout.scale.set(0.75, 0.55, 0.6); nose.material.color.set(0xd9667a);
    for (let i = -1; i <= 1; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.09, 0.02), mat(0xB85A12)); st.position.set(0.05 * i, 0.22, 0.2); st.rotation.x = -0.3; head.add(st); }
    for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.006), mat(0xffffff)); w.position.set(0.17 * s, -0.04 + k * 0.03, 0.3); w.rotation.z = (0.18 * k) * s; head.add(w); }
  }

  // arms / legs (pivot at shoulder / hip)
  const limb = (x, y, r, len, c) => {
    const g = new THREE.Group(); g.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat(c)); m.position.y = -len / 2; m.castShadow = true; g.add(m);
    return g;
  };
  const armL = limb(-0.33, 0.72, 0.075, 0.2, L.outfit), armR = limb(0.33, 0.72, 0.075, 0.2, L.outfit);
  armL.add(at(ball(0.08, L.belly), 0, -0.34, 0));
  armR.add(at(ball(0.08, L.belly), 0, -0.34, 0));
  const legL = limb(-0.14, 0.3, 0.09, 0.12, L.fur), legR = limb(0.14, 0.3, 0.09, 0.12, L.fur);
  legL.add(at(ball(0.1, L.belly, 1, 0.6, 1.3), 0, -0.24, 0.04));
  legR.add(at(ball(0.1, L.belly, 1, 0.6, 1.3), 0, -0.24, 0.04));
  rig.add(armL, armR, legL, legR);

  root.userData = { rig, head, armL, armR, legL, legR, tail, ears, t: Math.random() * 10 };
  return root;
}

// action: 'idle' | 'walk' | 'swim' | 'jump' | 'wave' | 'climb'
export function animateAnimal(a, dt, action) {
  const u = a.userData; u.t += dt;
  const t = u.t;
  const swing = (amp, f) => Math.sin(t * f) * amp;
  let armLx = 0, armRx = 0, legLx = 0, legRx = 0, tilt = 0, bob = 0, armRz = 0;
  if (action === 'walk') { armLx = swing(0.7, 10); armRx = -armLx; legLx = -armLx; legRx = armLx; bob = Math.abs(Math.sin(t * 10)) * 0.04; }
  else if (action === 'swim') { armLx = -1.7 + swing(0.5, 7); armRx = -1.7 - swing(0.5, 7); legLx = swing(0.5, 9); legRx = -legLx; tilt = 0.25; bob = swing(0.02, 3); }
  else if (action === 'jump') { armLx = -2.6; armRx = -2.6; legLx = 0.4; legRx = -0.3; }
  else if (action === 'climb') { armLx = swing(1, 8) - 1; armRx = -swing(1, 8) - 1; legLx = swing(0.8, 8); legRx = -legLx; tilt = 0.15; }
  else if (action === 'wave') { armRz = -2.4 + swing(0.4, 8); bob = swing(0.01, 2); }
  else { bob = swing(0.012, 2); armLx = swing(0.05, 2); armRx = -armLx; }
  u.armL.rotation.x = armLx; u.armR.rotation.x = armRx; u.armR.rotation.z = armRz || -0.1; u.armL.rotation.z = 0.1;
  u.legL.rotation.x = legLx; u.legR.rotation.x = legRx;
  u.rig.rotation.x = tilt; u.rig.position.y = bob;
  u.tail.rotation.y = swing(0.35, action === 'idle' ? 4 : 9);
  u.head.rotation.z = swing(0.03, 3);
}

export function makeNameLabel(text, self = false) {
  const chars = [...String(text)]; if (chars.length > 10) text = chars.slice(0, 9).join('') + '…';
  const c = document.createElement('canvas'); c.width = 384; c.height = 80;
  const g = c.getContext('2d');
  g.font = '600 34px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  const w = Math.min(360, g.measureText(text).width + 36);
  g.fillStyle = self ? 'rgba(23,99,118,.88)' : 'rgba(40,40,48,.78)';
  g.beginPath(); g.roundRect((384 - w) / 2, 14, w, 52, 26); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 192, 41, 340);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.9, 0.4, 1); s.renderOrder = 10;
  return s;
}
