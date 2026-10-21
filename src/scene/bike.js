import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LAYOUT as L } from '../layout.js';

// The yard's bicycle — rideable. Local frame: forward = +x (basket end), up = +y, wheels turn about z.
// place(x, y, z, ry, lean): ry is the RIDER's heading (0 = facing +z), as everywhere else in the game.
// roll(dist) spins the wheels, fall(on) tips it over (knocked off), poof() puffs when it teleports home.

const S = 0.82; // a little smaller than life: the guests are chibi
const _side = new THREE.Vector3();
export const BIKE_HOME = { x: L.bike[0], z: L.bike[1], ry: 0.04 + Math.PI / 2 };

export function createBike(scene) {
  const root = new THREE.Group(); root.name = 'bike'; root.rotation.order = 'YXZ'; scene.add(root);
  const bike = new THREE.Group(); bike.scale.setScalar(S); root.add(bike);
  const teal = new THREE.MeshStandardMaterial({ color: 0x2a8a8a, roughness: 0.4, metalness: 0.3 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, metalness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 });
  const sh = (m) => { m.castShadow = true; return m; };
  const tube = (a, b, r = 0.02, m = teal) => { const d = b.clone().sub(a); const c = sh(new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), m)); c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); bike.add(c); };
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const wheels = [];
  for (const x of [-0.55, 0.55]) {
    const w = new THREE.Group(); w.position.set(x, 0.36, 0); bike.add(w); wheels.push(w);
    w.add(sh(new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 10, 32), iron)));
    w.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.008, 6, 32), brass));
    const sp = []; for (let i = 0; i < 16; i++) { const s = new THREE.CylinderGeometry(0.003, 0.003, 0.6, 3); s.rotateZ(i * Math.PI / 16); sp.push(s); }
    w.add(new THREE.Mesh(mergeGeometries(sp), iron));
    w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10).rotateX(Math.PI / 2), brass)); // hub
  }
  tube(V(-0.55, 0.36), V(-0.05, 0.36)); tube(V(-0.05, 0.36), V(-0.2, 0.82)); tube(V(-0.2, 0.82), V(0.42, 0.85)); tube(V(-0.05, 0.36), V(0.42, 0.85)); tube(V(-0.55, 0.36), V(-0.2, 0.82)); tube(V(0.55, 0.36), V(0.45, 0.95));
  tube(V(0.45, 0.95), V(0.5, 1.05)); tube(V(0.5, 1.05, -0.22), V(0.5, 1.05, 0.22), 0.016, iron);
  for (const z of [-0.22, 0.22]) { const g = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a3220, roughness: 0.7 }))); g.position.set(0.5, 1.05, z * 1.15); bike.add(g); }
  const crank = new THREE.Group(); crank.position.set(-0.05, 0.36, 0); bike.add(crank); // pedals turn with the wheels
  crank.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16).rotateX(Math.PI / 2), brass));
  const pedals = {}; // +1 = the rider's right (+z), -1 = left
  for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.015), iron); arm.position.set(0, s * 0.08, s * 0.06); crank.add(arm); const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.05), iron); pedal.position.set(0, s * 0.16, s * 0.09); crank.add(pedal); pedals[s] = pedal; }
  const saddle = sh(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.06, 0.14, 2, 0.025), new THREE.MeshStandardMaterial({ color: 0x5a3220, roughness: 0.6 }))); saddle.position.set(-0.22, 0.9, 0); bike.add(saddle);
  const basket = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.2, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xb8894a, roughness: 0.9, side: THREE.DoubleSide }))); basket.position.set(0.68, 0.98, 0); bike.add(basket);
  const O = new THREE.Object3D(), flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshStandardMaterial({ color: 0xf09a2a, roughness: 0.8 }), 14);
  for (let i = 0; i < 14; i++) { O.position.set(0.68 + Math.cos(i * 2.4) * 0.1, 1.1 + (i % 3) * 0.04, Math.sin(i * 2.4) * 0.1); O.updateMatrix(); flowers.setMatrixAt(i, O.matrix); }
  bike.add(flowers);
  // a puff of dust for teleports
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xfff3dc, transparent: true, opacity: 0, depthWrite: false });
  const puffs = []; for (let i = 0; i < 10; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), puffMat); p.visible = false; scene.add(p); puffs.push(p); }

  let fallK = 0, fallTarget = 0, puffT = 0, puffAt = new THREE.Vector3();
  const saddleLocal = new THREE.Vector3(-0.22, 0.95, 0).multiplyScalar(S), handLocal = new THREE.Vector3(0.5, 1.05, 0).multiplyScalar(S);
  const api = {
    root, home: BIKE_HOME, radius: 0.33 * S,
    place(x, y, z, ry, lean = 0) { root.position.set(x, y, z); root.rotation.y = ry - Math.PI / 2; root.rotation.x = lean; },
    get ry() { return root.rotation.y + Math.PI / 2; },
    roll(dist) { const a = dist / (0.365 * S); for (const w of wheels) w.rotation.z -= a; crank.rotation.z -= a * 0.55; },
    fall(on) { fallTarget = on ? 1 : 0; },
    poof(x, z) { puffAt.set(x, 0, z); puffT = 0.001; },
    saddleWorld(v) { root.updateMatrixWorld(true); return v.copy(saddleLocal).applyMatrix4(root.matrixWorld); },
    handWorld(v, side) { root.updateMatrixWorld(true); return v.set(handLocal.x, handLocal.y, side * 0.2 * S).applyMatrix4(root.matrixWorld); },
    pedalWorld(v, side, out = 0) { root.updateMatrixWorld(true); pedals[side].getWorldPosition(v); return v.add(_side.set(0, 0, side * out).applyQuaternion(root.quaternion)); }, // `out`: a little wider than the pedal, so legs clear the frame
    update(dt) {
      fallK += (fallTarget - fallK) * Math.min(1, dt * (fallTarget ? 9 : 4));
      bike.rotation.x = fallK * 1.35; bike.position.y = fallK * 0.05; // tipped over on its side
      if (puffT > 0) {
        puffT += dt; const k = puffT / 0.7;
        puffs.forEach((p, i) => { const a = i / puffs.length * Math.PI * 2; p.visible = k < 1; p.position.set(puffAt.x + Math.cos(a) * k * 0.8, 0.2 + k * 0.5, puffAt.z + Math.sin(a) * k * 0.8); p.scale.setScalar(0.6 + k * 1.2); });
        puffMat.opacity = Math.max(0, 0.7 * (1 - k)); if (k >= 1) puffT = 0;
      }
    },
  };
  api.place(BIKE_HOME.x, 0, BIKE_HOME.z, BIKE_HOME.ry);
  return api;
}
