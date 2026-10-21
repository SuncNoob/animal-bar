import * as THREE from 'three';
import { buildArchitecture } from './scene/architecture.js';
import { buildFurniture } from './scene/furniture.js';
import { LAYOUT as L, WATER_Y } from './layout.js';

// Gameplay geometry derived from the shared layout + land collision + the lagoon's swim test.
export { WATER_Y };
const D = L.deck, Y = L.yard, ST = L.stairs;
export const BOUNDS = { x0: Y.x0 + 0.25, x1: Y.x1 - 0.25, zLand: D.z1 - 0.15, zNorth: Y.z0 };
export const DECK = D;
export const STAIRS = {
  x0: ST.x0, x1: ST.x1, z0: ST.z0, z1: ST.z0 + ST.depth * ST.steps,
  top: new THREE.Vector3((ST.x0 + ST.x1) / 2, 0, D.z1 - 0.5),
  foot: new THREE.Vector3((ST.x0 + ST.x1) / 2, WATER_Y, ST.z0 + ST.depth * ST.steps - 0.6),
};
export const JUMP_EDGE_Z = D.z0 + 0.45;
const v3 = ([x, z]) => new THREE.Vector3(x, 0, z);
export const SPOTS = { jukebox: v3(L.spots.jukebox), cat: v3(L.spots.cat), croc: v3(L.spots.croc) };

export const COLLIDERS = {
  circles: [{ x: SPOTS.jukebox.x, z: SPOTS.jukebox.z, r: 0.6 }, { x: SPOTS.croc.x, z: SPOTS.croc.z, r: 0.75, npc: 'croc_edazi' }, { x: SPOTS.cat.x, z: SPOTS.cat.z, r: 0.45, npc: 'cat_tuantuan' }],
  rects: [],
};

// ---- lagoon outline as a polygon (closed centripetal Catmull-Rom, densely sampled)
const curve = new THREE.CatmullRomCurve3(L.sea.outline.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
export const SEA_POLY = curve.getSpacedPoints(220).slice(0, -1).map((p) => [p.x, p.z]);
function distToPoly(x, z) {
  let best = Infinity;
  for (let i = 0, n = SEA_POLY.length; i < n; i++) {
    const [ax, az] = SEA_POLY[i], [bx, bz] = SEA_POLY[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
function inPoly(x, z) {
  let inside = false;
  for (let i = 0, j = SEA_POLY.length - 1; i < SEA_POLY.length; j = i++) {
    const [xi, zi] = SEA_POLY[i], [xj, zj] = SEA_POLY[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function localInsideSea(x, z, margin = 0) {
  const isl = L.sea.island;
  if (Math.hypot(x - isl.x, z - isl.z) < isl.r + margin) return false;
  return inPoly(x, z) && (margin <= 0 || distToPoly(x, z) >= margin);
}

// Ground height outside the courtyard (the shore undulates); the water module provides it.
let groundFn = () => 0;
const onLanding = (x, z) => { const ax = Math.abs(x); return ax > 7.85 && ax < 9.85 && z > 4.9 && z < 5.93; }; // the stone slabs at the deck corners
export function groundAt(x, z) { return inYard(x, z) || onLanding(x, z) ? 0 : groundFn(x, z); }
// lagoon bed height (for keeping swimmers' legs out of the shallow banks); very deep when unknown
let bedFn = () => -5;
export function bedAt(x, z) { return bedFn(x, z); }

// Swim test: the water module's own (matches its drawn shore exactly) once loaded, else the polygon above.
let seaTest = localInsideSea;
export function insideSea(x, z, margin = 0) { return seaTest(x, z, margin); }

// Fallback water until the polished lagoon module is present.
function simpleSea(scene) {
  const shape = new THREE.Shape(SEA_POLY.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape, 1); geo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x2aa6b8, roughness: 0.1, transparent: true, opacity: 0.85 }));
  water.position.y = WATER_Y; scene.add(water);
  const b = L.sea.shoreBounds; const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0), new THREE.MeshStandardMaterial({ color: 0x5f6b45 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set((b.x0 + b.x1) / 2, -0.02, (b.z0 + b.z1) / 2); scene.add(ground);
  return { update() {}, splash: null, surfaceHeight: () => WATER_Y };
}

export function buildWorld(scene, { renderer, camera, wordmarkTex, menuTex, createPool, createPlants }) {
  buildArchitecture(scene, { wordmarkTex });
  const furniture = buildFurniture(scene, { menuTex });
  COLLIDERS.circles.push(...furniture.colliders.circles); COLLIDERS.rects.push(...furniture.colliders.rects);
  let pool;
  try { pool = createPool ? createPool({ renderer, scene, camera }) : simpleSea(scene); } catch (e) { console.warn('water module failed', e); pool = simpleSea(scene); }
  if (typeof pool.insideSea === 'function') seaTest = pool.insideSea;
  if (typeof pool.groundHeight === 'function') groundFn = (x, z) => Math.max(WATER_Y, pool.groundHeight(x, z));
  if (typeof pool.groundHeight === 'function') bedFn = (x, z) => pool.groundHeight(x, z);
  if (pool.setGlintLights && furniture.glints) pool.setGlintLights(furniture.glints);
  let plants = null;
  try { plants = createPlants ? createPlants({ scene, renderer }) : null; } catch (e) { console.warn('plants module failed', e); }
  if (plants?.colliders) COLLIDERS.circles.push(...plants.colliders);
  return {
    pool, plants, seats: furniture.seats, bulbs: furniture.bulbs,
    update(t, dt) { furniture.update(t); pool.update?.(t, dt); plants?.update?.(t, dt); },
  };
}

// ---- walkable land = the courtyard + deck, plus the natural ground all around the lagoon,
// fenced by invisible "air walls" at the edge of the world.
export const AIR = { x0: -19.3, x1: 19.3, z1: 29.3 }; // just inside the dry-stone boundary wall (x = ±20, z = 30)
const SHORE_Z0 = 5.55;
export function inYard(x, z) { return x >= BOUNDS.x0 && x <= BOUNDS.x1 && z >= BOUNDS.zNorth + 0.4 && z <= BOUNDS.zLand; }
export function inShore(x, z) {
  if (z > AIR.z1 || x < AIR.x0 || x > AIR.x1) return false;
  const ax = Math.abs(x);
  if (ax <= 7.9) { if (z < 6.05) return false; }        // right off the deck edge: water, not ground
  else if (ax <= 9.8) { if (z < 5.4) return false; }    // stone landing at each deck corner (the yard walls end at z = 5)
  else if (ax < 12.5) { if (z < 5.95) return false; }   // keep off the ground's back edge
  else if (z < 6.7) return false;                       // the low dry-stone wall pieces at z ≈ 6.05
  const isl = L.sea.island; if (Math.hypot(x - isl.x, z - isl.z) < isl.r + 0.4) return false; // the islet is scenery
  return !insideSea(x, z, 0);
}
export const walkable = (x, z) => inYard(x, z) || inShore(x, z);

// Land walking: push out of colliders (the yard clamp is applied only while inside the courtyard). Returns the collider normal if we hit something
// (used for bumper-car bounces), else null.
const hit = new THREE.Vector3();
export function resolveLand(pos, clampYard = pos.z <= BOUNDS.zLand + 0.05) {
  let hitAny = false; hit.set(0, 0, 0); hit.npc = null;
  if (clampYard) {
    const cx = Math.min(BOUNDS.x1, Math.max(BOUNDS.x0, pos.x)), cz = Math.min(BOUNDS.zLand, Math.max(BOUNDS.zNorth + 0.4, pos.z));
    if (cx !== pos.x) { hit.x += Math.sign(cx - pos.x); hitAny = true; } if (cz !== pos.z) { hit.z += Math.sign(cz - pos.z); hitAny = true; }
    pos.x = cx; pos.z = cz;
  }
  for (const c of COLLIDERS.circles) {
    const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + 0.3;
    if (d < m) { const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0; pos.x = c.x + nx * m; pos.z = c.z + nz * m; hit.x += nx; hit.z += nz; hitAny = true; hit.npc = c.npc; }
  }
  for (const r of COLLIDERS.rects) {
    const m = 0.3;
    if (pos.x > r.x0 - m && pos.x < r.x1 + m && pos.z > r.z0 - m && pos.z < r.z1 + m) {
      const dl = pos.x - (r.x0 - m), dr = r.x1 + m - pos.x, dd = r.z1 + m - pos.z, du = pos.z - (r.z0 - m);
      const mn = Math.min(dl, dr, dd, du);
      if (mn === dd) { pos.z = r.z1 + m; hit.z += 1; } else if (mn === du) { pos.z = r.z0 - m; hit.z -= 1; } else if (mn === dl) { pos.x = r.x0 - m; hit.x -= 1; } else { pos.x = r.x1 + m; hit.x += 1; }
      hitAny = true;
    }
  }
  if (!hitAny) return null;
  hit.y = 0; if (hit.lengthSq() > 0) hit.normalize(); return hit;
}
