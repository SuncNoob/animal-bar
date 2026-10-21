import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Table pieces: a flower arrangement (three styles after the owner's references) and a dice cup with a few dice.
// Flowers are built from bent-plane petals with vertex colours, then baked into a handful of meshes per arrangement.
//   'garden'  — white round ceramic vase: white roses, purple anemones, a calla lily, dusty miller, white/blue fillers
//   'harvest' — cast-iron urn: sunflowers, tiger lilies, crocosmia, an orange strawflower, dark cosmos, berries
//   'ikebana' — shallow blue glazed dish with water and pebbles: a leaning cherry branch and three magnolias
// decorateTable(style) → Group, origin = table top centre-ish, y up, metres.

const C = (hex) => new THREE.Color(hex);
const UP = new THREE.Vector3(0, 1, 0);
const MATS = {
  petal: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xd8d8d8, roughness: 0.78, side: THREE.DoubleSide }), // a touch dim: the yard lamps blow bright petals out into bloom
  green: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xe0e0e0, roughness: 0.75, side: THREE.DoubleSide }),
  gloss: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xdadada, roughness: 0.38 }),
};

// ---------- geometry helpers ----------
function paint(geo, c0, c1 = c0, axis = 'y') { // vertex colours: gradient along an axis of the local geometry
  const p = geo.attributes.position; geo.computeBoundingBox(); const bb = geo.boundingBox, lo = bb.min[axis], span = (bb.max[axis] - lo) || 1;
  const arr = new Float32Array(p.count * 3), a = C(c0), b = C(c1), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) { t.copy(a).lerp(b, (p.getComponent(i, 'xyz'.indexOf(axis)) - lo) / span); arr.set([t.r, t.g, t.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo;
}
// a petal growing along +y from the origin, facing +z. cup: tip bends towards +z; curl: edges roll up
function petalGeo(w, l, { cup = 0.25, curl = 0.25, tip = 0.35, sx = 3, sy = 5 } = {}) {
  const g = new THREE.PlaneGeometry(1, 1, sx, sy), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i) + 0.5; // u -0.5..0.5 across, v 0..1 along
    const width = Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * v)), 0.65) * (1 - (1 - tip) * v * v);
    const x = u * w * width, y = v * l;
    p.setXYZ(i, x, y, cup * l * v * v + curl * (x * x) / (w || 1) * 4);
  }
  g.computeVertexNormals(); return g;
}
const place = (geo, pos, dir = UP, spin = 0, s = 1) => geo.applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin)), new THREE.Vector3(s, s, s)));
function tube(points, r0, r1 = r0, seg = 10, radial = 5) { // tapered tube along a curve
  const curve = new THREE.CatmullRomCurve3(points), g = new THREE.TubeGeometry(curve, seg, 1, radial, false), p = g.attributes.position;
  const pts = curve.getSpacedPoints(seg);
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= radial; j++) {
    const k = i * (radial + 1) + j, c = pts[i], r = THREE.MathUtils.lerp(r0, r1, i / seg);
    p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r);
  }
  g.computeVertexNormals(); return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(); // deterministic: every client sees the same flowers

// ---------- the bouquet builder: collects coloured pieces per material, then bakes ----------
function bouquet() {
  const parts = { petal: [], green: [], gloss: [] };
  const add = (key, geo) => { geo.deleteAttribute('uv'); if (!geo.attributes.color) paint(geo, '#ffffff'); parts[key].push(geo.index ? geo : geo); };
  // a flower head: ring(s) of petals around +y at `pos`, facing `dir`
  function head(pos, dir, rings, center) {
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), m = new THREE.Matrix4().compose(pos, q, V(1, 1, 1));
    for (const r of rings) for (let i = 0; i < r.n; i++) {
      const g = paint(petalGeo(r.w, r.l, r.opt), r.c0, r.c1);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(r.open)); // tilt the petal out from the axis
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, r.y || 0, 0));
      g.applyMatrix4(new THREE.Matrix4().makeRotationY((i / r.n) * Math.PI * 2 + (r.phase || 0)));
      add('petal', g.applyMatrix4(m));
    }
    if (center) for (const c of center) add(c.key || 'gloss', c.geo.applyMatrix4(m));
  }
  const stem = (from, to, r = 0.0035, bend = 0.15) => {
    const mid = from.clone().lerp(to, 0.5).add(V((to.x - from.x) * bend, 0, (to.z - from.z) * bend));
    add('green', paint(tube([from, mid, to], r, r * 0.8, 8, 5), '#3f6b2f', '#5e8c3a'));
  };
  function bake() {
    const G = new THREE.Group();
    for (const [k, geos] of Object.entries(parts)) {
      if (!geos.length) continue;
      const norm = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(a)) n.deleteAttribute(a); return n; });
      const mesh = new THREE.Mesh(mergeGeometries(norm), MATS[k]); mesh.castShadow = true; G.add(mesh);
    }
    return G;
  }
  return { add, head, stem, bake };
}

// ---------- flowers ----------
function rose(B, pos, dir, s = 1) {
  const r = 0.042 * s;
  B.head(pos, dir, [
    { n: 5, w: r * 0.9, l: r * 0.85, open: 0.18, c0: '#f3ead6', c1: '#fffaf0', opt: { cup: 0.45, curl: 0.5 } },
    { n: 7, w: r * 1.1, l: r * 1.0, open: 0.55, c0: '#efe4cc', c1: '#fffdf6', phase: 0.4, opt: { cup: 0.35, curl: 0.4 } },
    { n: 9, w: r * 1.2, l: r * 1.05, open: 1.0, c0: '#e9dcc0', c1: '#fffdf8', phase: 0.15, opt: { cup: 0.3, curl: 0.3 } },
  ], [{ key: 'petal', geo: paint(new THREE.SphereGeometry(r * 0.38, 10, 8).scale(1, 1.25, 1).translate(0, r * 0.3, 0), '#efe0c0', '#fff6e2') }]);
}
function anemone(B, pos, dir, s = 1, col = ['#3b2a8a', '#7b6be0']) {
  const r = 0.04 * s;
  const center = [{ geo: paint(new THREE.SphereGeometry(r * 0.28, 10, 8).scale(1, 0.6, 1), '#120f24') }];
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; center.push({ geo: paint(new THREE.SphereGeometry(r * 0.06, 5, 4).translate(Math.cos(a) * r * 0.36, r * 0.06, Math.sin(a) * r * 0.36), '#1a1530') }); }
  B.head(pos, dir, [{ n: 6, w: r * 1.15, l: r * 0.95, open: 1.25, c0: col[0], c1: col[1], opt: { cup: 0.15, curl: 0.15, tip: 0.85 } }], center);
}
function calla(B, base, top, s = 1) {
  B.stem(base, top, 0.004, 0.05);
  const g = new THREE.CylinderGeometry(0.03 * s, 0.004, 0.085 * s, 16, 5, true, 0, Math.PI * 1.75), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / (0.085 * s) + 0.5, a = Math.atan2(p.getZ(i), p.getX(i)); const flare = Math.max(0, y - 0.6) * (0.5 + 0.5 * Math.cos(a - 0.9)); p.setXYZ(i, p.getX(i) * (1 + flare * 0.9), p.getY(i) + flare * 0.02, p.getZ(i) * (1 + flare * 0.9)); }
  g.computeVertexNormals(); paint(g, '#cfe0b8', '#fbfaf2'); g.translate(0, 0.04 * s, 0);
  const dir = top.clone().sub(base).normalize(); place(g, top, dir.clone().lerp(V(0.6, 0.6, 0.3), 0.5)); B.add('petal', g);
  const spadix = paint(new THREE.CylinderGeometry(0.004, 0.005, 0.045 * s, 6).translate(0, 0.03 * s, 0), '#e8b830', '#f6d24a'); place(spadix, top, dir); B.add('gloss', spadix);
}
function lobedLeaf(B, base, dir, len, wid, col = ['#93a79c', '#c3d0c8'], lobes = 4) {
  const sh = new THREE.Shape(), N = 28; const pts = [];
  for (let i = 0; i <= N; i++) { const t = i / N; const w = wid * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * lobes))); pts.push([w, t * len]); }
  sh.moveTo(0, 0); for (const [w, y] of pts) sh.lineTo(w, y); for (let i = pts.length - 1; i >= 0; i--) sh.lineTo(-pts[i][0], pts[i][1]);
  const g = new THREE.ShapeGeometry(sh, 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, (p.getY(i) / len) ** 2 * len * 0.25);
  g.computeVertexNormals(); paint(g, col[0], col[1]); place(g, base, dir, rnd() * 6); B.add('green', g);
}
function leafSpray(B, base, tip, n = 6, col = ['#4e7a3a', '#7ca35a'], size = 0.028) {
  B.stem(base, tip, 0.0022, 0.25);
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1), p = base.clone().lerp(tip, t), side = i % 2 ? 1 : -1;
    const g = paint(petalGeo(size * 0.55, size, { cup: 0.1, curl: 0.05, tip: 0.3, sx: 2, sy: 3 }), col[0], col[1]);
    place(g, p, V(side * 0.8, 0.6, 0.3 * side), rnd() * 6); B.add('green', g);
  }
}
function floretCluster(B, center, radius, n, petals, cols, size = 0.01, key = 'petal') { // many tiny flowers in a dome
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius, p = center.clone().add(V(Math.cos(a) * r, (1 - r / radius) * radius * 0.5, Math.sin(a) * r));
    const dir = p.clone().sub(center).add(V(0, radius * 0.8, 0)).normalize(), c = cols[i % cols.length];
    if (petals) B.head(p, dir, [{ n: petals, w: size * 0.8, l: size, open: 1.3, c0: c[0], c1: c[1], opt: { cup: 0.1, curl: 0.1, tip: 0.9, sx: 1, sy: 2 } }]);
    else B.add(key, paint(new THREE.IcosahedronGeometry(size * 0.5, 0).translate(p.x, p.y, p.z), c[0], c[1]));
  }
}
function sunflower(B, pos, dir, s = 1) {
  const r = 0.05 * s;
  const disc = [{ geo: paint(new THREE.SphereGeometry(r * 0.45, 16, 8).scale(1, 0.32, 1), '#2a1608', '#4a2a10') }, { geo: paint(new THREE.TorusGeometry(r * 0.45, r * 0.06, 6, 20).rotateX(Math.PI / 2), '#7a4a14') }];
  B.head(pos, dir, [
    { n: 18, w: r * 0.32, l: r * 0.75, open: 1.45, y: r * 0.03, c0: '#f0a810', c1: '#ffd030', opt: { cup: -0.05, curl: 0.25, tip: 0.25, sx: 2, sy: 3 } },
    { n: 16, w: r * 0.3, l: r * 0.65, open: 1.35, phase: 0.2, c0: '#e89a0c', c1: '#fcc828', opt: { cup: 0.05, curl: 0.25, tip: 0.25, sx: 2, sy: 3 } },
  ], disc);
}
function tigerLily(B, pos, dir, s = 1) {
  const r = 0.055 * s, center = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const st = tube([V(0, 0, 0), V(Math.cos(a) * r * 0.3, r * 0.6, Math.sin(a) * r * 0.3), V(Math.cos(a) * r * 0.45, r * 0.85, Math.sin(a) * r * 0.45)], 0.0012, 0.001, 4, 3); paint(st, '#d8b070'); center.push({ key: 'green', geo: st }, { geo: paint(new THREE.SphereGeometry(0.004, 5, 4).scale(0.6, 1.6, 0.6).translate(Math.cos(a) * r * 0.45, r * 0.88, Math.sin(a) * r * 0.45), '#5a2a10') }); }
  B.head(pos, dir, [{ n: 6, w: r * 0.42, l: r, open: 1.15, c0: '#f08a3a', c1: '#ffb070', opt: { cup: -0.55, curl: 0.35, tip: 0.2 } }], center);
}
function crocosmia(B, base, tip, s = 1) {
  const mid = base.clone().lerp(tip, 0.55).add(V(0, 0.05, 0)), ctrl = [base, mid, tip];
  B.add('green', paint(tube(ctrl, 0.0025, 0.0012, 10, 4), '#4a7a2a', '#7a9a3a'));
  const curve = new THREE.CatmullRomCurve3(ctrl);
  for (let i = 0; i < 9; i++) {
    const t = 0.35 + i * 0.075, p = curve.getPointAt(Math.min(1, t)), side = i % 2 ? 1 : -1, sz = 0.016 * s * (1 - i * 0.07);
    const g = paint(new THREE.ConeGeometry(sz * 0.35, sz * 1.6, 6).translate(0, sz * 0.8, 0), i < 4 ? '#e2401a' : '#c0501a', '#ff7a2a');
    place(g, p, V(side * 0.7, 0.7, 0.2)); B.add('petal', g);
  }
}
function strawflower(B, pos, dir, s = 1) {
  const r = 0.045 * s, rings = [];
  for (let k = 0; k < 6; k++) rings.push({ n: 12 + k * 2, w: r * 0.28, l: r * (0.45 + k * 0.08), open: 0.25 + k * 0.24, phase: k * 0.3, c0: '#d86a10', c1: k < 2 ? '#ffb030' : '#f59a1a', opt: { cup: 0.35, curl: 0.4, tip: 0.5, sx: 1, sy: 2 } });
  B.head(pos, dir, rings, [{ geo: paint(new THREE.SphereGeometry(r * 0.25, 8, 6), '#f2c040') }]);
}
function cosmos(B, pos, dir, s = 1) {
  const r = 0.042 * s;
  B.head(pos, dir, [{ n: 8, w: r * 0.75, l: r, open: 1.35, c0: '#3a0610', c1: '#6e1222', opt: { cup: 0.05, curl: 0.1, tip: 0.8 } }], [{ geo: paint(new THREE.SphereGeometry(r * 0.2, 8, 6).scale(1, 0.6, 1), '#4a2a10') }]);
}
function alstro(B, pos, dir, s = 1) {
  const r = 0.035 * s;
  B.head(pos, dir, [{ n: 6, w: r * 0.6, l: r, open: 0.75, c0: '#f0d878', c1: '#fff6c8', opt: { cup: -0.1, curl: 0.3, tip: 0.6 } }], [{ geo: paint(new THREE.SphereGeometry(r * 0.12, 6, 4), '#c8a030') }]);
}
function berries(B, pos, n = 7, col = ['#e8826a', '#f7b39a']) {
  for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, rr = 0.012 + rnd() * 0.016, p = pos.clone().add(V(Math.cos(a) * rr, rnd() * 0.02, Math.sin(a) * rr)); B.stem(pos.clone().add(V(0, -0.025, 0)), p, 0.0012, 0.1); B.add('gloss', paint(new THREE.SphereGeometry(0.0065, 8, 6).translate(p.x, p.y, p.z), col[0], col[1])); }
}
function blossom(B, pos, dir, s = 1) { // 5-petal cherry blossom
  const r = 0.016 * s;
  B.head(pos, dir, [{ n: 5, w: r * 0.95, l: r, open: 1.15, c0: '#f4b8cc', c1: '#fff2f6', opt: { cup: 0.1, curl: 0.15, tip: 0.95, sx: 2, sy: 2 } }], [{ geo: paint(new THREE.SphereGeometry(r * 0.15, 5, 4), '#d86a8a') }]);
}
function magnolia(B, pos, dir, s = 1) {
  const r = 0.07 * s;
  B.head(pos, dir, [
    { n: 3, w: r * 0.5, l: r, open: 0.32, c0: '#b8336a', c1: '#fbe6ef', opt: { cup: 0.25, curl: 0.45, tip: 0.55 } },
    { n: 3, w: r * 0.48, l: r * 0.92, open: 0.12, phase: Math.PI / 3, c0: '#c2457a', c1: '#fff0f6', opt: { cup: 0.3, curl: 0.5, tip: 0.55 } },
  ]);
}

// ---------- vessels ----------
function lathe(profile, seg = 40, smooth = 0) { // smooth > 0: run the profile through a spline for a turned, faceless curve
  let pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  if (smooth) { const c = new THREE.SplineCurve(pts); pts = c.getSpacedPoints(smooth); }
  return new THREE.LatheGeometry(pts, seg);
}
function speckleTex(base, dots) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) { g.fillStyle = dots[i % dots.length]; g.globalAlpha = 0.25 + Math.random() * 0.4; g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); return t;
}

function garden() {
  const G = new THREE.Group();
  const vase = new THREE.Mesh(lathe([[0, 0], [0.035, 0.002], [0.062, 0.025], [0.074, 0.065], [0.066, 0.105], [0.04, 0.13], [0.026, 0.142], [0.027, 0.148], [0.022, 0.146], [0.02, 0.12]], 56, 60),
    new THREE.MeshStandardMaterial({ map: speckleTex('#efebe2', ['#b8ad9a', '#d8d0c0', '#ffffff']), roughness: 0.82 }));
  vase.castShadow = vase.receiveShadow = true; G.add(vase);
  const B = bouquet(), m = V(0, 0.14, 0);
  for (const [x, z, dx, dz, l] of [[-0.02, 0.0, -1.0, 0.1, 0.17], [-0.015, -0.01, -0.8, -0.4, 0.15], [-0.01, 0.01, -0.5, 0.5, 0.13], [0.0, -0.01, -0.2, -0.8, 0.12]]) lobedLeaf(B, m.clone().add(V(x, 0, z)), V(dx, 1.0, dz), l, 0.045);
  rose(B, V(-0.035, 0.2, 0.035), V(-0.3, 1, 0.5), 1.15); B.stem(m, V(-0.035, 0.2, 0.035));
  rose(B, V(0.065, 0.19, 0.03), V(0.6, 0.9, 0.4), 0.85); B.stem(m, V(0.065, 0.19, 0.03));
  anemone(B, V(-0.075, 0.175, 0.03), V(-0.8, 0.6, 0.5), 1.0); B.stem(m, V(-0.075, 0.175, 0.03));
  anemone(B, V(0.02, 0.19, 0.075), V(0.1, 0.6, 0.9), 0.85, ['#4b3fa8', '#9a8ff0']); B.stem(m, V(0.02, 0.19, 0.075));
  calla(B, m.clone().add(V(0.005, 0, 0)), V(0.07, 0.43, -0.02), 1.15);
  leafSpray(B, m, V(0.13, 0.33, -0.02), 7); leafSpray(B, m, V(0.06, 0.38, -0.05), 6);
  floretCluster(B, V(0.085, 0.215, 0.0), 0.045, 14, 5, [['#e8e0ff', '#ffffff'], ['#f4eefc', '#ffffff']], 0.011);   // white stock / jasmine
  floretCluster(B, V(0.02, 0.2, 0.04), 0.035, 12, 4, [['#6a6ad8', '#a8a8ff'], ['#8a7ae8', '#c0b8ff']], 0.011);       // blue lilac
  floretCluster(B, V(-0.005, 0.185, 0.02), 0.03, 26, 0, [['#a8c43a', '#d0e060']], 0.009, 'gloss');                // lady's mantle
  anemone(B, V(-0.03, 0.25, -0.02), V(-0.3, 1, -0.2), 0.45, ['#2a3aa8', '#5a7ae8']);                               // cornflower
  G.add(B.bake()); return G;
}
function harvest() {
  const G = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3e3c, metalness: 0.55, roughness: 0.62 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.022, 0.085), iron); base.position.y = 0.011; G.add(base);
  const urnGeo = lathe([[0, 0.022], [0.026, 0.022], [0.02, 0.04], [0.016, 0.055], [0.03, 0.065], [0.048, 0.09], [0.06, 0.13], [0.07, 0.165], [0.075, 0.172], [0.07, 0.175], [0.062, 0.17]], 48);
  const p = urnGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.065 && y < 0.115) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + 0.07 * Math.max(0, Math.cos(a * 14)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
  urnGeo.computeVertexNormals();
  const urn = new THREE.Mesh(urnGeo, iron); urn.castShadow = urn.receiveShadow = true; G.add(urn);
  const B = bouquet(), m = V(0, 0.17, 0);
  sunflower(B, V(-0.01, 0.34, 0.01), V(-0.15, 1, 0.55), 1.05); B.stem(m, V(-0.01, 0.34, 0.01));
  sunflower(B, V(-0.04, 0.27, 0.06), V(-0.3, 0.6, 0.9), 0.95); B.stem(m, V(-0.04, 0.27, 0.06));
  strawflower(B, V(0.0, 0.21, 0.075), V(0.1, 0.4, 1), 1.0); B.stem(m, V(0.0, 0.21, 0.075));
  tigerLily(B, V(0.07, 0.25, 0.04), V(0.6, 0.6, 0.6), 1.0); B.stem(m, V(0.07, 0.25, 0.04));
  tigerLily(B, V(0.065, 0.2, 0.07), V(0.5, 0.2, 0.9), 0.8); B.stem(m, V(0.065, 0.2, 0.07));
  cosmos(B, V(-0.085, 0.2, 0.06), V(-0.7, 0.3, 0.8), 1.0); B.stem(m, V(-0.085, 0.2, 0.06));
  alstro(B, V(-0.1, 0.27, 0.0), V(-0.8, 0.6, 0.3), 1.0); alstro(B, V(-0.085, 0.3, -0.03), V(-0.6, 0.8, 0.1), 0.9); B.stem(m, V(-0.1, 0.27, 0.0)); B.stem(m, V(-0.085, 0.3, -0.03));
  crocosmia(B, m, V(-0.2, 0.3, 0.03)); crocosmia(B, m, V(0.21, 0.32, -0.01)); crocosmia(B, m, V(-0.13, 0.4, -0.04), 0.9);
  berries(B, V(0.1, 0.33, -0.01)); berries(B, V(0.04, 0.36, -0.03), 6);
  floretCluster(B, V(0.11, 0.28, 0.02), 0.035, 22, 0, [['#b8c83a', '#dcea5a']], 0.009, 'gloss');
  strawflower(B, V(0.19, 0.24, 0.02), V(1, 0.3, 0.3), 0.45); B.stem(m, V(0.19, 0.24, 0.02));
  for (const [x, z] of [[0.05, -0.05], [-0.05, -0.05], [0.08, 0.0]]) leafSpray(B, m, V(x * 2.2, 0.27, z * 2.2), 5, ['#3e6a2a', '#5e8a3a'], 0.03);
  G.add(B.bake()); return G;
}
function ikebana() {
  const G = new THREE.Group();
  const glaze = new THREE.MeshStandardMaterial({ color: 0x1f3f9a, roughness: 0.18, metalness: 0.05, side: THREE.DoubleSide });
  const dish = new THREE.Mesh(lathe([[0, 0], [0.13, 0], [0.142, 0.004], [0.148, 0.03], [0.146, 0.036], [0.14, 0.036], [0.136, 0.012], [0.128, 0.008], [0, 0.008]], 56), glaze);
  dish.castShadow = dish.receiveShadow = true; G.add(dish);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.134, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b1830, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.85 })); water.position.y = 0.026; G.add(water);
  const B = bouquet();
  for (let i = 0; i < 11; i++) { const a = rnd() * Math.PI * 2, r = 0.012 + rnd() * 0.04; B.add('gloss', paint(new THREE.SphereGeometry(0.012 + rnd() * 0.007, 10, 8).scale(1.2, 0.55, 1).translate(Math.cos(a) * r + 0.02, 0.029, Math.sin(a) * r), '#1c1d20', '#3a3c40')); }
  // the cherry branch: leaning up and right, with side twigs, buds and blossoms
  const base = V(0.025, 0.03, 0.0), mid = V(0.06, 0.22, 0.0), tip = V(0.17, 0.5, -0.02);
  const branchPts = [base, V(0.04, 0.12, 0.0), mid, V(0.12, 0.38, -0.01), tip];
  B.add('green', paint(tube(branchPts, 0.01, 0.0035, 18, 7), '#4a3428', '#6a4a38'));
  const curve = new THREE.CatmullRomCurve3(branchPts);
  for (let i = 0; i < 26; i++) {
    const t = 0.28 + (i / 26) * 0.72, p = curve.getPointAt(t), side = i % 2 ? 1 : -1, d = V(side * 0.9, 0.7, (rnd() - 0.5) * 0.8);
    if (rnd() < 0.72) blossom(B, p.clone().add(d.clone().multiplyScalar(0.012)), d, 1.15 + rnd() * 0.45);
    else B.add('gloss', paint(new THREE.SphereGeometry(0.0055, 8, 6).scale(0.8, 1.2, 0.8).translate(p.x + side * 0.008, p.y + 0.005, p.z), '#c2457a', '#e88aa8'));
  }
  // a low side twig full of blossom
  const twig = [V(0.05, 0.16, 0.0), V(0.08, 0.2, 0.02), V(0.11, 0.21, 0.035)];
  B.add('green', paint(tube(twig, 0.0035, 0.0018, 6, 5), '#4a3428'));
  for (let i = 0; i < 7; i++) { const a = rnd() * Math.PI * 2; blossom(B, V(0.105 + Math.cos(a) * 0.018, 0.215 + rnd() * 0.02, 0.035 + Math.sin(a) * 0.018), V(Math.cos(a), 0.8, Math.sin(a)), 1.1); }
  // a second, shorter twig leaning back
  const twig2 = [V(0.07, 0.27, 0.0), V(0.035, 0.33, -0.02), V(0.02, 0.38, -0.035)];
  B.add('green', paint(tube(twig2, 0.004, 0.002, 8, 5), '#4a3428'));
  const c2 = new THREE.CatmullRomCurve3(twig2);
  for (let i = 0; i < 7; i++) { const p = c2.getPointAt(0.25 + i * 0.12), side = i % 2 ? 1 : -1; blossom(B, p, V(side, 0.8, 0.2), 1.1 + rnd() * 0.3); }
  // magnolias low on the left
  for (const [x, y, z, dx, s] of [[-0.075, 0.075, 0.01, -0.9, 1.05], [-0.04, 0.09, 0.02, -0.4, 0.95], [-0.012, 0.085, 0.03, -0.1, 0.85]]) {
    B.add('green', paint(tube([V(0.015, 0.03, 0), V((x + 0.015) / 2, y * 0.6, z / 2), V(x, y - 0.01, z)], 0.003, 0.0025, 6, 5), '#4a3428'));
    magnolia(B, V(x, y, z), V(dx, 0.9, 0.3), s);
  }
  G.add(B.bake()); return G;
}

// ---------- the dice set ----------
let diceMats = null;
function dieMats() {
  if (diceMats) return diceMats;
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  diceMats = [3, 4, 1, 6, 2, 5].map((v) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fbf7ee'; g.fillRect(0, 0, 64, 64);
    for (const i of PIPS[v]) { g.fillStyle = v === 1 || v === 4 ? '#c8102e' : '#1a1820'; g.beginPath(); g.arc(13 + (i % 3) * 19, 13 + Math.floor(i / 3) * 19, v === 1 ? 10 : 5.5, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.35 });
  });
  return diceMats;
}
function diceSet() {
  const G = new THREE.Group();
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x8e1b1b, roughness: 0.25, metalness: 0.1 }), gold = new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.085, 24), cupMat); cup.position.y = 0.0425; cup.castShadow = true; G.add(cup);
  for (const y of [0.004, 0.081]) { const r = new THREE.Mesh(new THREE.TorusGeometry(y < 0.05 ? 0.048 : 0.042, 0.004, 6, 24), gold); r.rotation.x = Math.PI / 2; r.position.y = y; G.add(r); }
  const geo = new RoundedBoxGeometry(0.03, 0.03, 0.03, 2, 0.006), mats = dieMats();
  for (const [x, z, ry] of [[0.07, 0.02, 0.3], [0.085, -0.025, 1.1], [0.055, -0.045, 0.7]]) { const d = new THREE.Mesh(geo, mats); d.position.set(x, 0.015, z); d.rotation.y = ry; d.castShadow = true; G.add(d); }
  return G;
}

const BUILD = { garden, harvest, ikebana };
export function decorateTable(style) {
  const G = new THREE.Group();
  const flowers = (BUILD[style] || garden)(); flowers.scale.setScalar(1.7); G.add(flowers); // chibi world: everything on the table is chunky
  const dice = diceSet(); dice.scale.setScalar(1.5); dice.position.set(0.36, 0, 0.2); dice.rotation.y = -0.6; G.add(dice);
  return G;
}
