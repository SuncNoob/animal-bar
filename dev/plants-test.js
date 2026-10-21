// Standalone harness for src/scene/plants.js — placeholder courtyard + lagoon (from src/layout.js) to judge placement & look.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LAYOUT as L } from '../src/layout.js';
import { createPlants } from '../src/scene/plants.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2447);
scene.fog = new THREE.Fog(0x3a2d4d, 28, 60);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 140);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffe2bd, 0x5a4468, 1.6));
const sun = new THREE.DirectionalLight(0xffc088, 2.0);
sun.position.set(-12, 16, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// ---------------------------------------------------------------- placeholder courtyard (all from LAYOUT)
function tex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8; return t;
}
const flag = tex(512, 512, (g, w, h) => {
  g.fillStyle = '#4a4440'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 6; r++) {
    let x = -Math.random() * 60;
    while (x < w) {
      const bw = 60 + Math.random() * 70, v = 100 + Math.random() * 30 | 0;
      g.fillStyle = `rgb(${v + 6},${v},${v - 6})`; g.fillRect(x + 3, r * (h / 6) + 3, bw - 6, h / 6 - 6);
      x += bw;
    }
  }
}, [5, 3.5]);
const brick = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#5e5a57'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 5; x++) {
    const v = 95 + Math.random() * 30 | 0, ox = (y % 2) * 26;
    g.fillStyle = `rgb(${v + 4},${v},${v - 2})`; g.fillRect(x * 52 + ox - 26 + 2, y * 16 + 2, 48, 12);
  }
}, [4, 1.3]);
const plank = tex(256, 64, (g, w) => {
  for (let i = 0; i < 4; i++) { const v = 115 + Math.random() * 25 | 0; g.fillStyle = `rgb(${v + 40},${v},${v - 45})`; g.fillRect(0, i * 16, w, 15); }
}, [8, 1.5]);
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; scene.add(b); return b; };

const Y = L.yard, W = L.walls, D = L.deck;
// yard paving and the land outside the walls
const ground = new THREE.Mesh(new THREE.PlaneGeometry(Y.x1 - Y.x0 + 0.6, Y.z1 - Y.z0 + 0.6), std({ map: flag }));
ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, (Y.z0 + Y.z1) / 2); ground.receiveShadow = true; scene.add(ground);
const outsideM = std({ color: 0x3e3a3c });
const outside = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), outsideM); outside.rotation.x = -Math.PI / 2; outside.position.set(0, -0.02, -9.4); outside.receiveShadow = true; scene.add(outside);
box(D.x1 - D.x0 + 0.6, 0.4, D.z1 - D.z0, std({ map: plank, color: 0xd9b48a }), 0, -0.2, (D.z0 + D.z1) / 2);
// lagoon: shore ground with a hole following the outline, a flat water plane, an islet rock and the stone steps
const S = L.sea;
const curve = new THREE.CatmullRomCurve3(S.outline.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5);
const rim = curve.getSpacedPoints(240).slice(0, -1).map((p) => new THREE.Vector2(p.x, -p.z));
const B = S.shoreBounds;
const shoreShape = new THREE.Shape([new THREE.Vector2(B.x0, -B.z0), new THREE.Vector2(B.x1, -B.z0), new THREE.Vector2(B.x1, -B.z1), new THREE.Vector2(B.x0, -B.z1)]);
shoreShape.holes.push(new THREE.Path(rim));
const shore = new THREE.Mesh(new THREE.ShapeGeometry(shoreShape), std({ color: 0x5a5444 }));
shore.rotation.x = -Math.PI / 2; shore.position.y = -0.01; shore.receiveShadow = true; scene.add(shore);
const water = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(rim)), new THREE.MeshStandardMaterial({ color: 0x2f7f8c, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86 }));
water.rotation.x = -Math.PI / 2; water.position.y = L.WATER_Y; scene.add(water);
const bed = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(rim)), std({ color: 0x1d4a55 }));
bed.rotation.x = -Math.PI / 2; bed.position.y = S.floorY; scene.add(bed);
const isle = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), std({ color: 0x6d675e, flatShading: true }));
isle.scale.set(S.island.r * 1.05, 1.0, S.island.r * 0.95); isle.position.set(S.island.x, -0.15, S.island.z); isle.castShadow = isle.receiveShadow = true; scene.add(isle);
const st = L.stairs;
for (let i = 0; i < st.steps; i++) { const top = st.topY - i * st.drop; box(st.x1 - st.x0, 0.3, st.depth, std({ color: 0x8a8278 }), (st.x0 + st.x1) / 2, top - 0.15, st.z0 + (i + 0.5) * st.depth); }
// walls (+ tile coping), door on the west wall, sign on the north wall
const wallM = std({ map: brick });
const sz0 = W.northZ - W.thick / 2, sz1 = D.z1, sLen = sz1 - sz0;
box(W.eastX - W.westX + W.thick, W.height, W.thick, wallM, 0, W.height / 2, W.northZ);
box(W.thick, W.height, sLen, wallM, W.westX, W.height / 2, (sz0 + sz1) / 2);
box(W.thick, W.height, sLen, wallM, W.eastX, W.height / 2, (sz0 + sz1) / 2);
const eave = std({ color: 0x3b3a40, roughness: 0.7 });
box(W.eastX - W.westX + 1.2, 0.36, 0.95, eave, 0, W.height + 0.18, W.northZ);
box(0.95, 0.36, sLen + 0.4, eave, W.westX, W.height + 0.18, (sz0 + sz1) / 2);
box(0.95, 0.36, sLen + 0.4, eave, W.eastX, W.height + 0.18, (sz0 + sz1) / 2);
const kd = L.keepOut.doorZ, ks = L.keepOut;
box(0.12, 2.6, kd[1] - kd[0] - 0.4, std({ color: 0x8e2a22 }), W.westX + W.thick / 2 + 0.05, 1.3, L.door.z);
box(ks.signX[1] - ks.signX[0], ks.signY[1] - ks.signY[0], 0.12, std({ color: 0xd8742a, emissive: 0x3a1a05 }), (ks.signX[0] + ks.signX[1]) / 2, (ks.signY[0] + ks.signY[1]) / 2, W.northZ + W.thick / 2 + 0.06);
// bar: counter, back cabinet, sloped roof
const bar = L.bar;
box(bar.x1 - bar.x0, bar.top, bar.z1 - bar.z0, std({ color: 0x6b4529 }), (bar.x0 + bar.x1) / 2, bar.top / 2, (bar.z0 + bar.z1) / 2);
box(bar.x1 - bar.x0, 2.3, 0.5, std({ color: 0x4d321f }), (bar.x0 + bar.x1) / 2, 1.15, bar.cabinetZ);
const roofD = bar.roofFrontZ - (W.northZ + W.thick / 2);
const roof = box(bar.x1 - bar.x0 + 1.2, 0.08, Math.hypot(roofD, 0.7), std({ color: 0x55565c }), (bar.x0 + bar.x1) / 2, 3.45, (W.northZ + W.thick / 2 + bar.roofFrontZ) / 2);
roof.rotation.x = Math.atan2(0.7, roofD);
const [jx, jz] = L.spots.jukebox;
box(0.9, 1.6, 0.6, std({ color: 0x2c5a4a, emissive: 0x401a08 }), jx, 0.8, jz);
const rug = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), std({ color: 0x8a2a24 }));
rug.rotation.x = -Math.PI / 2; rug.position.set(L.spots.cat[0], 0.012, L.spots.cat[1]); rug.receiveShadow = true; scene.add(rug);
box(0.66, 0.45, L.lounge.z1 - L.lounge.z0, std({ color: 0x5a3a22 }), L.lounge.x, 0.225, (L.lounge.z0 + L.lounge.z1) / 2);
box(1.7, 0.9, 0.12, std({ color: 0x2c6a6a }), L.bike[0], 0.5, L.bike[1]);
for (const [x, z] of L.tables) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(L.tableR, L.tableR, 0.07, 32), std({ color: 0x7a5232 })); t.position.set(x, 0.74, z); t.castShadow = t.receiveShadow = true; scene.add(t);
  const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.72, 10), std({ color: 0x5a3a22 })); l.position.set(x, 0.36, z); l.castShadow = true; scene.add(l);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; const s = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.45, 12), std({ color: 0x6b4529 })); s.position.set(x + Math.cos(a) * L.stoolRing, 0.225, z + Math.sin(a) * L.stoolRing); s.castShadow = true; scene.add(s); }
}
// arena outline (debug)
{
  const a = L.arena, g = new THREE.BufferGeometry().setFromPoints([[a.x0, a.z0], [a.x1, a.z0], [a.x1, a.z1], [a.x0, a.z1], [a.x0, a.z0]].map(([x, z]) => new THREE.Vector3(x, 0.02, z)));
  const arena = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x66ccff })); arena.visible = false; arena.name = 'arena'; scene.add(arena);
}
// player capsule (1 m)
const player = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.4, 6, 16), std({ color: 0xe8a25a }));
player.position.set(0, 0.5, 2.0); player.castShadow = true; scene.add(player);
// warm string-light stand-ins
for (const [x, y, z] of [[-5, 3.0, -2], [3, 3.0, -1], [-2, 2.8, 3]]) { const l = new THREE.PointLight(0xffb060, 5, 8, 1.6); l.position.set(x, y, z); scene.add(l); }

// ---------------------------------------------------------------- plants
const t0 = performance.now();
const plants = createPlants({ scene, renderer });
const buildMs = performance.now() - t0;
window.plants = plants;
console.log('[plants] build ms', buildMs.toFixed(1), 'colliders', JSON.stringify(plants.colliders), JSON.stringify(plants.stats));

// collider rings (debug)
const ringM = new THREE.LineBasicMaterial({ color: 0xff3366 });
const colliderViz = new THREE.Group();
for (const c of plants.colliders) {
  const g = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 41 }, (_, i) => new THREE.Vector3(c.x + Math.cos(i / 40 * Math.PI * 2) * c.r, 0.03, c.z + Math.sin(i / 40 * Math.PI * 2) * c.r)));
  colliderViz.add(new THREE.Line(g, ringM));
}
colliderViz.visible = false; scene.add(colliderViz);

// per-module stats: my meshes only (geometry triangles × instances), plus measured renderer.info with/without the module
function moduleStats() {
  const rows = plants.group.children.map((m) => {
    const tri = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    return { name: m.name, tris: tri * (m.isInstancedMesh ? m.count : 1), cast: m.castShadow };
  });
  const tris = rows.reduce((a, r) => a + r.tris, 0);
  const meshes = rows.length, shadowMeshes = rows.filter((r) => r.cast).length;
  plants.group.visible = false; renderer.render(scene, camera);
  const off = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  plants.group.visible = true; renderer.render(scene, camera);
  const on = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  return { rows, tris, meshes, shadowMeshes, drawCallsMeasured: on.calls - off.calls, trisMeasured: on.tris - off.tris };
}
window.moduleStats = moduleStats;

// ---------------------------------------------------------------- views
const VIEWS = {
  a: { pos: [0, 5, 10], at: [0, 1.1, 2] },             // game camera: player at (0,0,2), cam 8 m behind/5 m up
  b: { pos: [1.5, 2.6, -2.6], at: [-6.5, 3.4, 2.8] },  // toward the hero ginkgo
  c: { pos: [-4.6, 1.35, 0.6], at: [-6.6, 0, 3.0] },   // fallen leaves close-up
  d: { pos: [0, 40, 16], at: [0, 0, 6] },              // overview
  e: { pos: [-6.5, 5, 5.5], at: [-6.5, 1.1, -2.5] },   // camera inside the hero canopy (near-fade test)
  f: { pos: [3, 3.6, -1], at: [7.4, 3.4, 3.0] },       // second ginkgo
  g: { pos: [-2.5, 2.6, 0.5], at: [-7.5, 1.8, -5.5] }, // NW corner: sign, door, ivy
  h: { pos: [0, 2.2, 5.0], at: [0, 1.0, 16] },         // from the deck over the lagoon
  i: { pos: [-1.5, 6, 2.5], at: [-1.5, 0.8, 15] },     // lagoon from above the deck
  j: { pos: [-11, 2, 9], at: [-14, 0, 13] },           // west shore close
};
let focusOn = true;
function setView(k) {
  const v = VIEWS[k]; if (!v) return;
  focusOn = k === 'a' || k === 'e';
  camera.position.set(...v.pos); controls.target.set(...v.at); camera.lookAt(...v.at); controls.update();
}
window.setView = setView;
window.look = (pos, at) => { camera.position.set(...pos); controls.target.set(...at); camera.lookAt(...at); controls.update(); };
const vbar = document.getElementById('views');
for (const k of Object.keys(VIEWS)) { const b = document.createElement('button'); b.textContent = k; b.onclick = () => setView(k); vbar.appendChild(b); }
const extra = [
  ['burst', () => plants.leafBurst(L.trees.hero[0] + 0.6, 1.2, L.trees.hero[1] - 0.6)],
  ['colliders', () => { colliderViz.visible = !colliderViz.visible; scene.getObjectByName('arena').visible = colliderViz.visible; }],
];
for (const [n, fn] of extra) { const b = document.createElement('button'); b.textContent = n; b.onclick = fn; vbar.appendChild(b); }
setView(new URLSearchParams(location.search).get('view') || 'a');

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const hud = document.getElementById('hud');
const timer = new THREE.Timer(); timer.connect(document);
let frames = 0, fpsT = 0, fps = 0, logged = false, ms = null;
function loop() {
  timer.update(); const dt = timer.getDelta(), t = timer.getElapsed();
  plants.update(t, dt);
  controls.update();
  // the game passes camera→player distance; in the harness only the game-camera views (a, e) use it
  plants.setViewFocus(focusOn ? camera.position.distanceTo(controls.target) : 0);
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  const i = renderer.info.render;
  if (!logged && t > 1) {
    logged = true; ms = moduleStats();
    console.log('[plants] module', JSON.stringify({ tris: ms.tris, meshes: ms.meshes, shadowMeshes: ms.shadowMeshes, drawCallsMeasured: ms.drawCallsMeasured, trisMeasured: ms.trisMeasured }));
    console.log('[plants] per mesh', JSON.stringify(ms.rows));
  }
  hud.textContent = `scene: ${i.calls} calls  ${(i.triangles / 1000).toFixed(1)}k tris  ${fps.toFixed(0)} fps` +
    (ms ? `\nplants: ${ms.meshes} meshes (+${ms.shadowMeshes} shadow) = ${ms.meshes + ms.shadowMeshes} calls max, ${(ms.tris / 1000).toFixed(1)}k tris\nbuild ${buildMs.toFixed(0)} ms` : '');
  requestAnimationFrame(loop);
}
loop();
