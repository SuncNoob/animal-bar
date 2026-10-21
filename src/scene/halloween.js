import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT as L } from '../layout.js';

// 万圣节 night (the light switch's third position): rows of skeletons doing the spooky-scary dance on the wall tops
// and the neighbours' ridges, glowing jack-o'-lanterns on tables / the bar / the deck / the door drums, bats over the yard.
// Everything is instanced (≈ a dozen draw calls) and built hidden; update(dt, t, k) fades it in with k ∈ [0, 1].
// colliders: the deck pumpkins (r = -1 while hidden, so they only block when they're there).

const BPM = 116;
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

// ---------- one skeleton = a little rig of pivots; each part is an instance in a shared InstancedMesh ----------
function partGeos() {
  const bone = (len, r) => { const g = new THREE.CylinderGeometry(r * 0.8, r, len, 7); g.translate(0, -len / 2, 0); const k1 = new THREE.SphereGeometry(r * 1.5, 8, 6), k2 = k1.clone(); k2.translate(0, -len, 0); return mergeGeometries([g, k1, k2]); };
  const skull = (() => {
    const c = new THREE.SphereGeometry(0.13, 16, 12); c.scale(1, 1.06, 1.08);
    const cheek = new THREE.BoxGeometry(0.16, 0.06, 0.12); cheek.translate(0, -0.08, 0.04);
    return mergeGeometries([c, cheek]);
  })();
  const sockets = (() => { const a = new THREE.SphereGeometry(0.037, 10, 8), b = a.clone(); a.translate(-0.048, 0.0, 0.118); b.translate(0.048, 0.0, 0.118); const n = new THREE.ConeGeometry(0.018, 0.04, 3); n.rotateX(Math.PI); n.translate(0, -0.05, 0.13); return mergeGeometries([a, b, n]); })();
  const eyes = (() => { const a = new THREE.SphereGeometry(0.016, 8, 6), b = a.clone(); a.translate(-0.048, 0.0, 0.14); b.translate(0.048, 0.0, 0.14); return mergeGeometries([a, b]); })();
  const jaw = (() => { const g = new THREE.BoxGeometry(0.15, 0.045, 0.1); g.translate(0, -0.03, 0.05); const teeth = new THREE.BoxGeometry(0.12, 0.025, 0.012); teeth.translate(0, 0.0, 0.1); return mergeGeometries([g, teeth]); })();
  const torso = (() => {
    const parts = [new THREE.CylinderGeometry(0.018, 0.022, 0.42, 6).translate(0, 0.21, -0.02)]; // spine
    for (let i = 0; i < 4; i++) { const t = new THREE.TorusGeometry(0.11 - i * 0.008, 0.012, 5, 14, Math.PI * 1.55); t.rotateX(Math.PI / 2); t.rotateZ(Math.PI / 2 + 0.35); t.rotateY(Math.PI / 2); t.scale(1, 1, 0.8); t.translate(0, 0.38 - i * 0.065, 0.02); parts.push(t); }
    parts.push(new THREE.BoxGeometry(0.025, 0.2, 0.02).translate(0, 0.3, 0.1)); // sternum
    parts.push(new THREE.BoxGeometry(0.34, 0.03, 0.04).translate(0, 0.43, 0)); // collarbones
    return mergeGeometries(parts);
  })();
  const pelvis = (() => { const g = new THREE.TorusGeometry(0.085, 0.022, 6, 14); g.rotateX(Math.PI / 2); g.scale(1.25, 1, 0.8); return g; })();
  const hand = (() => { const g = new THREE.BoxGeometry(0.05, 0.07, 0.025); g.translate(0, -0.035, 0); return g; })();
  const foot = (() => { const g = new THREE.BoxGeometry(0.06, 0.03, 0.13); g.translate(0, -0.015, 0.04); return g; })();
  return { skull, sockets, eyes, jaw, torso, pelvis, upper: bone(0.24, 0.02), lower: bone(0.22, 0.017), thigh: bone(0.27, 0.024), shin: bone(0.26, 0.02), hand, foot };
}

function makeRig() {
  const R = new THREE.Group(), O = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
  const hips = O(R, 0, 0.55, 0), torso = O(hips, 0, 0.02, 0), head = O(torso, 0, 0.56, 0), jaw = O(head, 0, -0.1, 0.0);
  const arm = (s) => { const sh = O(torso, s * 0.17, 0.42, 0), el = O(sh, 0, -0.24, 0), ha = O(el, 0, -0.22, 0); return { sh, el, ha }; };
  const leg = (s) => { const hp = O(hips, s * 0.09, -0.02, 0), kn = O(hp, 0, -0.27, 0), ft = O(kn, 0, -0.26, 0); return { hp, kn, ft }; };
  return { R, hips, torso, head, jaw, arms: [arm(-1), arm(1)], legs: [leg(-1), leg(1)] };
}

// ---------- jack-o'-lantern ----------
function pumpkinGeo() {
  const g = new THREE.SphereGeometry(0.17, 28, 16); const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const a = Math.atan2(v.z, v.x); const rib = 1 + 0.07 * Math.cos(a * 8); v.x *= rib; v.z *= rib; v.y *= 0.78; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
function pumpkinTex() {
  const W = 512, H = 256, skin = document.createElement('canvas'), glow = document.createElement('canvas'); skin.width = glow.width = W; skin.height = glow.height = H;
  const s = skin.getContext('2d'), e = glow.getContext('2d');
  const gr = s.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#c4561a'); gr.addColorStop(0.5, '#f07a1e'); gr.addColorStop(1, '#b44a14'); s.fillStyle = gr; s.fillRect(0, 0, W, H);
  s.strokeStyle = 'rgba(110,40,10,.45)'; s.lineWidth = 6; for (let i = 0; i < 8; i++) { const x = (i + 0.5) * W / 8; s.beginPath(); s.moveTo(x, 0); s.lineTo(x, H); s.stroke(); }
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  // the face sits at u = 0.25 (+z, the front of a three.js sphere)
  const cx = W * 0.25, cy = H * 0.5;
  const carve = (pts) => { for (const ctx of [s, e]) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x, cy + y) : ctx.moveTo(cx + x, cy + y))); ctx.closePath(); ctx.fillStyle = ctx === s ? '#2a1204' : '#ffd36a'; ctx.fill(); } };
  carve([[-42, -10], [-20, -10], [-31, -40]]); carve([[20, -10], [42, -10], [31, -40]]); // eyes
  carve([[-6, 4], [6, 4], [0, -10]]); // nose
  carve([[-50, 18], [-36, 26], [-26, 18], [-14, 30], [0, 22], [14, 30], [26, 18], [36, 26], [50, 18], [40, 48], [18, 56], [0, 50], [-18, 56], [-40, 48]]); // grin
  const t1 = new THREE.CanvasTexture(skin), t2 = new THREE.CanvasTexture(glow); t1.colorSpace = t2.colorSpace = THREE.SRGBColorSpace; return { map: t1, emissiveMap: t2 };
}

export function createHalloween(scene) {
  const G = new THREE.Group(); G.name = 'halloween'; G.visible = false; scene.add(G);
  const geo = partGeos();
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xece4cc, roughness: 0.55, emissive: 0x3a4a30, emissiveIntensity: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.9 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: hdr(0x6dff4a, 3.2) });

  // where the rows dance: on the courtyard wall tops and the ridges of the two houses behind the bar
  const W = L.walls, top = W.height + 0.31, rows = [];
  for (let z = -5.6; z <= 2.7; z += 1.2) rows.push([W.westX, top, z, Math.PI / 2]);
  for (let z = -2.6; z <= 3.5; z += 1.2) rows.push([W.eastX, top, z, -Math.PI / 2]);
  for (let x = -8.2; x <= -1.8; x += 1.25) rows.push([x, 6.58, -10.4, 0]);
  for (let x = 0.7; x <= 8.4; x += 1.25) rows.push([x, 7.16, -10.2, 0]);
  const N = rows.length;
  const rigs = rows.map(([x, y, z, ry], i) => { const r = makeRig(); r.R.position.set(x, y, z); r.R.rotation.y = ry; r.ph = i * 0.37; r.base = y; G.add(r.R); return r; });
  const inst = (g, m, n) => { const im = new THREE.InstancedMesh(g, m, n); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = m === boneMat; G.add(im); return im; };
  const I = {
    skull: inst(geo.skull, boneMat, N), sockets: inst(geo.sockets, darkMat, N), eyes: inst(geo.eyes, eyeMat, N), jaw: inst(geo.jaw, boneMat, N),
    torso: inst(geo.torso, boneMat, N), pelvis: inst(geo.pelvis, boneMat, N),
    upper: inst(geo.upper, boneMat, N * 2), lower: inst(geo.lower, boneMat, N * 2), hand: inst(geo.hand, boneMat, N * 2),
    thigh: inst(geo.thigh, boneMat, N * 2), shin: inst(geo.shin, boneMat, N * 2), foot: inst(geo.foot, boneMat, N * 2),
  };
  // rig objects live outside the scene graph (G holds only the instanced meshes): update their world matrices by hand
  for (const r of rigs) G.remove(r.R);

  // ---------- jack-o'-lanterns ----------
  const B = L.bar, TB = L.tables, D = L.deck;
  const spots = [
    ...TB.map(([x, z]) => [x + 0.28, 0.9 + 0.13, z - 0.18, 0.9]),
    [B.x0 + 0.35, B.top + 0.13, B.z1 - 0.25, 0.9], [B.x1 - 0.5, B.top + 0.13, B.z1 - 0.25, 1.1],
    [W.westX + W.thick / 2 + 0.38, 0.92 + 0.12, L.door.z - 1.35, 1], [W.westX + W.thick / 2 + 0.38, 0.92 + 0.12, L.door.z + 1.35, 1],
    [-7.3, 0.13, D.z1 - 0.32, 1.4], [-5.2, 0.13, D.z1 - 0.3, 1.1], [-0.6, 0.13, D.z1 - 0.3, 1.2], [1.7, 0.13, D.z1 - 0.32, 1.0], [7.3, 0.13, D.z1 - 0.32, 1.4],
    [L.spots.jukebox[0] + 0.2, 1.84, L.spots.jukebox[1] - 0.05, 0.8], [-7.6, 0.13, 3.3, 1.6], [-7.95, 0.13, -5.5, 1.3],
  ];
  const ptex = pumpkinTex();
  const pumpMat = new THREE.MeshStandardMaterial({ map: ptex.map, emissiveMap: ptex.emissiveMap, emissive: new THREE.Color(1, 0.62, 0.2), emissiveIntensity: 2.4, roughness: 0.7 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a5a22, roughness: 0.9 });
  const pumps = inst(pumpkinGeo(), pumpMat, spots.length), stems = inst(new THREE.CylinderGeometry(0.02, 0.03, 0.09, 6).translate(0, 0.16, 0), stemMat, spots.length);
  pumps.castShadow = true;
  const colliders = spots.filter(([, y]) => y < 0.3).map(([x, , z, s]) => ({ x, z, r: -1, on: 0.17 * s })); // floor pumpkins block only while they're out
  // ---------- bats ----------
  const NB = 9, batMat = new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.8, side: THREE.DoubleSide });
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.quadraticCurveTo(0.12, 0.08, 0.26, 0.03); wingShape.lineTo(0.21, -0.02); wingShape.lineTo(0.16, 0.0); wingShape.lineTo(0.11, -0.03); wingShape.lineTo(0.05, -0.01); wingShape.closePath();
  const wingG = new THREE.ShapeGeometry(wingShape); wingG.rotateX(-Math.PI / 2);
  const batBody = inst(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 0.9, 1.5), batMat, NB), wingR = inst(wingG, batMat, NB), wingL = inst(wingG.clone().scale(-1, 1, 1), batMat, NB);
  const bats = Array.from({ length: NB }, (_, i) => ({ r: 3 + (i % 4) * 1.6, h: 4.4 + (i % 3) * 0.9, sp: 0.35 + (i % 5) * 0.07, ph: i * 1.9, cx: (i % 2 ? -1.5 : 2), cz: -1 + (i % 3) }));
  // ---------- light: two orange glows at the tables (always in the scene, so switching never recompiles shaders) ----------
  const lights = [new THREE.PointLight(0xff7a1a, 0, 7, 1.8), new THREE.PointLight(0x9a4dff, 0, 9, 1.6)];
  lights[0].position.set(-5.6, 1.4, -1.0); lights[1].position.set(4, 3.2, -1); for (const l of lights) scene.add(l);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function dance(r, t, k) {
    const b = (t * BPM) / 60 + r.ph * 0.25, s = Math.sin(b * Math.PI), s2 = Math.sin(b * Math.PI * 2), side = Math.sin(b * Math.PI * 0.5);
    r.R.position.y = r.base - (1 - k) * 1.1;            // they rise up out of the wall / the roof
    r.R.scale.setScalar(Math.max(0.001, k));
    r.hips.position.y = 0.55 + Math.abs(s) * 0.05; r.hips.rotation.y = side * 0.35;
    r.torso.rotation.z = s * 0.12; r.head.rotation.set(0.1, -side * 0.25, s * 0.3); r.jaw.rotation.x = 0.1 + Math.abs(s2) * 0.35; // jaw chatter
    r.arms.forEach((a, i) => { const sg = i ? 1 : -1, ph = i ? s : -s; a.sh.rotation.set(-0.3 + ph * 0.7, 0, sg * (1.2 + 0.35 * s2)); a.el.rotation.set(-1.2 + ph * 0.6, 0, 0); a.ha.rotation.set(0, 0, sg * 0.3 * s2); });
    r.legs.forEach((l, i) => { const kick = Math.max(0, i ? s : -s); l.hp.rotation.set(-kick * 0.95, 0, (i ? 1 : -1) * 0.08); l.kn.rotation.set(kick * 1.1, 0, 0); l.ft.rotation.set(-kick * 0.4, 0, 0); });
    r.R.updateMatrixWorld(true);
  }
  let shown = false;
  function update(dt, t, k) {
    const vis = k > 0.002; if (vis !== shown) { shown = vis; G.visible = vis; }
    for (const c of colliders) c.r = k > 0.5 ? c.on : -1;
    for (const l of lights) l.intensity = 0;
    if (!vis) return;
    const fl = 0.8 + 0.2 * Math.sin(t * 13.7) * Math.sin(t * 7.3 + 1.1); // candle flicker
    lights[0].intensity = 9 * k * fl; lights[1].intensity = 7 * k;
    pumpMat.emissiveIntensity = 2.4 * fl; eyeMat.color.copy(hdr(0x6dff4a, 2.2 + 1.2 * Math.abs(Math.sin(t * 3))));
    rigs.forEach((r, i) => {
      dance(r, t, k);
      I.skull.setMatrixAt(i, r.head.matrixWorld); I.sockets.setMatrixAt(i, r.head.matrixWorld); I.eyes.setMatrixAt(i, r.head.matrixWorld); I.jaw.setMatrixAt(i, r.jaw.matrixWorld);
      I.torso.setMatrixAt(i, r.torso.matrixWorld); I.pelvis.setMatrixAt(i, r.hips.matrixWorld);
      for (let s = 0; s < 2; s++) {
        const a = r.arms[s], l = r.legs[s], j = i * 2 + s;
        I.upper.setMatrixAt(j, a.sh.matrixWorld); I.lower.setMatrixAt(j, a.el.matrixWorld); I.hand.setMatrixAt(j, a.ha.matrixWorld);
        I.thigh.setMatrixAt(j, l.hp.matrixWorld); I.shin.setMatrixAt(j, l.kn.matrixWorld); I.foot.setMatrixAt(j, l.ft.matrixWorld);
      }
    });
    for (const im of Object.values(I)) im.instanceMatrix.needsUpdate = true;
    spots.forEach(([x, y, z, s], i) => { const sc = s * Math.min(1, k * 1.4); M.compose(P.set(x, y, z), Q.setFromEuler(E.set(0, Math.atan2(-x, 0.8 - z), 0)), S.set(sc, sc, sc)); pumps.setMatrixAt(i, M); stems.setMatrixAt(i, M); }); // grinning at the middle of the yard
    pumps.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true;
    bats.forEach((bt, i) => {
      const a = t * bt.sp + bt.ph, x = bt.cx + Math.cos(a) * bt.r, z = bt.cz + Math.sin(a) * bt.r * 0.8, y = bt.h + Math.sin(t * 1.3 + i) * 0.4;
      const yaw = -a, flap = Math.sin(t * 16 + i) * 0.9;
      M.compose(P.set(x, y - (1 - k) * 6, z), Q.setFromEuler(E.set(0, yaw, 0)), one); batBody.setMatrixAt(i, M);
      M.compose(P, Q.setFromEuler(E.set(0, yaw, flap)), one); wingR.setMatrixAt(i, M);
      M.compose(P, Q.setFromEuler(E.set(0, yaw, -flap)), one); wingL.setMatrixAt(i, M);
    });
    batBody.instanceMatrix.needsUpdate = wingR.instanceMatrix.needsUpdate = wingL.instanceMatrix.needsUpdate = true;
  }
  return { group: G, colliders, update };
}
