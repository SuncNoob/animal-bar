// Standalone test bench for src/scene/water.js (the lagoon), rendered through the game's own env.js
//   keys: Space = splash at random spot, 1..6 = camera views (a..f), A = toggle auto splashes
//   url:  ?view=a|b|c|d|e|f  &demo=0 (no auto splashes)  &hud=0  &bloom=0 (plain render)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LAYOUT } from '../src/layout.js';
import { createPool, insideSea, WATER_Y } from '../src/scene/water.js';
import { setupEnvironment } from '../src/scene/env.js';

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const env = setupEnvironment(renderer, scene, camera, 'high');
env.resize(innerWidth, innerHeight, renderer.getPixelRatio());

// --- placeholder courtyard context (not part of the module) ---
{
  const { yard, walls, deck } = LAYOUT;
  const std = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; scene.add(b); return b; };
  box(yard.x1 - yard.x0, 0.3, yard.z1 - walls.northZ, 0, -0.15, (yard.z1 + walls.northZ) / 2, std(0x857a72));
  box(deck.x1 - deck.x0, 0.3, deck.z1 - deck.z0, 0, -0.15, (deck.z0 + deck.z1) / 2, std(0x8f5d38, 0.8));
  const wallM = std(0x77767a);
  for (const x of [walls.westX, walls.eastX]) box(walls.thick, walls.height, deck.z1 - walls.northZ, x, walls.height / 2, (deck.z1 + walls.northZ) / 2, wallM);
  box(walls.eastX * 2 + walls.thick, walls.height, walls.thick, 0, walls.height / 2, walls.northZ, wallM);
  // deck lanterns + courtyard lights (also fed to the water as glint sources)
  const glints = [];
  for (const [x, y, z, I] of [[-7.9, 2.2, 0.8, 14], [7.6, 2.2, 3.0, 10], [2.9, 2.6, -4.2, 30], [-3.0, 1.6, 5.3, 6], [3.0, 1.6, 5.3, 6]]) {
    const p = new THREE.PointLight(0xffa850, I, 10, 1.8); p.position.set(x, y, z); scene.add(p);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.9) }));
    bulb.position.copy(p.position); scene.add(bulb);
    glints.push({ x, y, z, intensity: 1 });
  }
  window.__glints = glints;
}

// --- players (1 m capsules) ---
const capGeo = new THREE.CapsuleGeometry(0.3, 0.4, 6, 16);
const dog = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xd8984e, roughness: 0.9 }));
dog.position.set(0, 0.5, 4.8); dog.castShadow = true; scene.add(dog);
const bunny = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xf2e8e6, roughness: 0.9 }));
bunny.castShadow = true; scene.add(bunny);
const SWIM = [2.0, 10.0];

// --- the lagoon ---
const t0 = performance.now();
const pool = createPool({ renderer, scene, camera });
const buildMs = performance.now() - t0;
pool.setGlintLights(window.__glints);

// --- views ---
const VIEWS = {
  a: { pos: [0, 5.5, 0.5], target: [0, -0.3, 14] },       // 3/4 overview from the courtyard side
  b: { pos: [0, 0.2, 9], target: [0, 0.0, 20] },          // low swim camera looking south
  c: { pos: [1.6, 1.5, 10.2], target: [5.2, -0.4, 7.2] }, // stairs + handrails close-up
  d: { pos: [0, 44, 15.01], target: [0, 0, 15] },         // top-down
  e: { pos: [0, 2.2, 4.9], target: [0, -0.3, 20] },       // from the deck across the whole lagoon
  f: { pos: [2.6, 0.2, 13.2], target: [-1.5, 0.3, 16.5] },// swimmer's low view near the islet
};
function setView(k) {
  const v = VIEWS[k];
  if (!v) return;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}
setView(params.get('view') || 'a');

let auto = params.get('demo') !== '0';
const randomSplash = (s = 1) => {
  for (let i = 0; i < 50; i++) {
    const x = -12 + Math.random() * 24, z = 7 + Math.random() * 15;
    if (insideSea(x, z, 1)) { pool.splash(x, z, s); return; }
  }
};
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { randomSplash(1); e.preventDefault(); }
  if (e.key >= '1' && e.key <= '6') setView('abcdef'[+e.key - 1]);
  if (e.key === 'a' || e.key === 'A') auto = !auto;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  env.resize(innerWidth, innerHeight, renderer.getPixelRatio());
});

const info = document.getElementById('info');
if (params.get('hud') === '0') info.style.display = 'none';
const useBloom = params.get('bloom') !== '0';
const timer = new THREE.Timer();
let nextAuto = 0.8, nextSwim = 1.2, frames = 0, fpsT = 0, fps = 0;
const focus = new THREE.Vector3(0, 0, 12);
let stats = { calls: 0, tris: 0 };

function frame(dt) {
  const t = timer.getElapsed();
  if (auto && t > nextAuto) { randomSplash(1); nextAuto = t + 5 + Math.random() * 2; }
  if (t > nextSwim) { pool.splash(SWIM[0] + Math.sin(t) * 0.1, SWIM[1], 0.3); nextSwim = t + 1.6; }
  pool.update(t, dt);
  bunny.position.set(SWIM[0], pool.surfaceHeight(SWIM[0], SWIM[1], t) - 0.47 + 0.5, SWIM[1]);
  bunny.rotation.z = Math.sin(t * 1.3) * 0.05;
  controls.update();
  env.update(t, focus);
  renderer.info.autoReset = false;
  renderer.info.reset();
  if (useBloom) env.render(); else renderer.render(scene, camera);
  stats = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}
window.__pool = pool; window.__setView = setView; window.__camera = camera; window.__controls = controls;
window.__renderer = renderer; window.__insideSea = insideSea; window.__buildMs = buildMs;
window.__frame = () => { timer.update(); frame(1 / 60); return stats; };
window.__stats = () => stats;

renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = timer.getDelta();
  frame(dt);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  info.textContent = `fps ${fps.toFixed(0)}  calls ${stats.calls}  tris ${stats.tris}  build ${buildMs.toFixed(0)}ms\n` +
    `cam ${camera.position.toArray().map((v) => v.toFixed(1)).join(',')}  [1-6 views, Space splash, A auto:${auto ? 'on' : 'off'}]`;
});
