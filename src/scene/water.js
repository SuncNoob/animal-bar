// Animal Bar · the "sea" — a stylized dusk lagoon south of the deck.
//
//   * one continuous terrain heightfield: mossy ground -> pebbly bank -> sandy shelf -> deep bed (+ islet mound)
//   * analytic water surface (shader-only ripples, Fresnel dusk sky, lamp glints, shore foam, splash rings),
//     driven by a baked signed-distance / bed-height field — no render targets, no texture files
//   * masonry wall under the deck edge, stone stairs + wooden handrails, faceted boulders & pebbles,
//     soft dry-stone boundary wall, post lanterns, drifting ginkgo leaves, pooled splash VFX
//
// API:
//   export const WATER_Y
//   export insideSea(x, z, margin = 0)            -> bool (inside the outline and off the islet, by margin)
//   createPool({ renderer, scene, camera })        -> { update(t, dt), splash(x, z, s), surfaceHeight(x, z, t),
//                                                      setGlintLights(list), group, dispose() }
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT, WATER_Y } from '../layout.js';

export { WATER_Y };

// ---------------------------------------------------------------------------
// layout (all derived from LAYOUT; metres, Y up, courtyard is -z)
// ---------------------------------------------------------------------------
const SEA = LAYOUT.sea;
const ISL = SEA.island;
const FLOOR_Y = SEA.floorY, SHELF_Y = SEA.shelfY;
const SB = SEA.shoreBounds;
const NORTH_Z = SEA.outline[0][1]; // straight north edge under the deck
const WALL_X = Math.abs(SEA.outline[0][0]); // north wall spans x ∈ [-WALL_X, WALL_X]
const DECK_Z1 = LAYOUT.deck.z1;
const BED_Y = FLOOR_Y - 0.15; // solid things (stairs, wall, posts) go down to here
const ST = LAYOUT.stairs;
const STAIR = { x0: ST.x0, x1: ST.x1, z0: ST.z0, z1: ST.z0 + ST.depth * ST.steps };
const STEP_TOP = (i) => ST.topY - ST.drop * i;
const STEP_Z0 = (i) => ST.z0 + ST.depth * i;
const RAIL_X = [ST.x0 - 0.1, ST.x1 + 0.1];
const POST_Z = [DECK_Z1 + 0.12, STAIR.z1 + 0.2];
const RAIL_TOP = [ST.topY + 0.57, WATER_Y + 0.42];
const COURT = { x: LAYOUT.walls.eastX + LAYOUT.walls.thick / 2, z0: LAYOUT.walls.northZ - LAYOUT.walls.thick / 2, h: LAYOUT.walls.height + 0.5 };
const ISL_TOP = 0.45, ISL_FALL = 2.4; // islet mound: flat top height, fall-off
const ISL_WL = 0.7 + 1.6 * Math.pow((ISL_TOP - WATER_Y) / ISL_FALL, 1 / 1.4); // waterline radius of the mound
const SUN_DIR = new THREE.Vector3(-12, 16, 8).normalize();
// default warm courtyard lights for water glints (override with setGlintLights)
const DEFAULT_GLINTS = [[-7.9, 2.2, 0.8], [7.6, 2.2, 3.0], [2.9, 2.6, -4.2], [-3.0, 1.6, 5.3], [3.0, 1.6, 5.3]];

const MAX_RINGS = 8;
const MAX_GLINTS = 16;
const N_LANTERNS = 6;
const DROP_SLOTS = 16, DROPS_PER_SLOT = 40; // half of them end up as crest spray while 蹦迪 surf is up
const CROWN_SLOTS = 6;
const FLOAT_LEAVES = 18, GROUND_LEAVES = 16;

// low-frequency swell (shared by GPU + CPU so surfaceHeight matches the mesh)
const WAVES = [
  { d: [0.83, 0.56], len: 5.6, spd: 0.6, amp: 0.014, ph: 0.0 },
  { d: [-0.6, 0.8], len: 3.4, spd: 0.5, amp: 0.01, ph: 1.7 },
  { d: [0.28, -0.96], len: 2.0, spd: 0.42, amp: 0.006, ph: 4.1 },
  { d: [-0.93, -0.36], len: 1.3, spd: 0.35, amp: 0.004, ph: 2.6 },
].map((w) => {
  const l = Math.hypot(w.d[0], w.d[1]);
  const k = (2 * Math.PI) / w.len;
  return { dx: w.d[0] / l, dz: w.d[1] / l, k, om: k * w.spd, amp: w.amp, ph: w.ph };
});
const RING = { speed: 1.35, k: (2 * Math.PI) / 0.75, decay: 0.85, amp: 0.055, life: 5.5 };
// 蹦迪 surf: big swells rolling in toward the deck, calmed near every bank / the islet / the stairs (setSurf(0..1)).
// Each swell is pow(0.5 + 0.5 sin(θ + skew·sin θ), SURF_PEAK): a negative skew gives a steep front face and a long back.
// The first one is the main set (lip foam, lace and spray all key off it).
const SURF_PEAK = 2.2;
const SURF = [
  { d: [0.12, -1], len: 9.0, spd: 3.4, amp: 0.62, ph: 0, skew: -0.7 },
  { d: [-0.35, -1], len: 5.2, spd: 2.8, amp: 0.2, ph: 1.3, skew: -0.4 },
  { d: [0.6, -0.8], len: 2.6, spd: 1.9, amp: 0.06, ph: 3.7, skew: 0 },
].map((w) => {
  const l = Math.hypot(w.d[0], w.d[1]), k = (2 * Math.PI) / w.len;
  let bias = 0; for (let i = 0; i < 256; i++) { const th = (i / 256) * 2 * Math.PI; bias += Math.pow(0.5 + 0.5 * Math.sin(th + w.skew * Math.sin(th)), SURF_PEAK) / 256; } // mean height -> 0
  return { dx: w.d[0] / l, dz: w.d[1] / l, k, om: k * w.spd, amp: w.amp, ph: w.ph, skew: w.skew, bias, spd: w.spd };
});
const swell = (th, skew) => Math.pow(0.5 + 0.5 * Math.sin(th + skew * Math.sin(th)), SURF_PEAK);
// main set at a point: hn = normalized height 0..1, c < 0 on the front face (height falling as the crest approaches)
const surfMain = (x, z, t) => { const w = SURF[0], th = (x * w.dx + z * w.dz) * w.k - t * w.om + w.ph, ph = th + w.skew * Math.sin(th); return { hn: swell(th, w.skew), c: Math.cos(ph) * (1 + w.skew * Math.cos(th)) }; };

const fl = (x) => (+x).toFixed(6);
const lin = (hex) => new THREE.Color(hex); // hex -> linear working space
const rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b); // already linear
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(i, j), hash2(i + 1, j), u), lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u), v);
}
const fbm2 = (x, z) => vnoise2(x, z) * 0.55 + vnoise2(x * 2.1 + 5.3, z * 2.1 + 1.7) * 0.3 + vnoise2(x * 4.3 + 9.1, z * 4.3 + 3.3) * 0.15;
function vnoise3(x, y, z) {
  const k = Math.floor(z), fz = z - k, w = fz * fz * (3 - 2 * fz);
  return lerp(vnoise2(x + k * 17.31, y - k * 9.17), vnoise2(x + (k + 1) * 17.31, y - (k + 1) * 9.17), w);
}

// ---------------------------------------------------------------------------
// lagoon shape: closed centripetal Catmull-Rom loop (north edge straight), SDF grid, terrain height
// ---------------------------------------------------------------------------
function crPoint(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const mix = (a, b, ta, tb) => [((tb - tt) * a[0] + (tt - ta) * b[0]) / (tb - ta), ((tb - tt) * a[1] + (tt - ta) * b[1]) / (tb - ta)];
  const A1 = mix(p0, p1, t0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
  const B1 = mix(A1, A2, t0, t2), B2 = mix(A2, A3, t1, t3);
  return mix(B1, B2, t1, t2);
}

let SHAPE = null;
function shape() { return SHAPE || (SHAPE = buildShape()); }

function buildShape() {
  const P = SEA.outline, n0 = P.length;
  const poly = [];
  for (let i = 0; i < n0 - 1; i++) { // the closing segment (last -> first) stays straight
    const p0 = P[(i - 1 + n0) % n0], p1 = P[i], p2 = P[i + 1], p3 = P[(i + 2) % n0];
    for (let k = 0; k < 14; k++) poly.push(crPoint(p0, p1, p2, p3, k / 14));
  }
  poly.push(P[n0 - 1]);
  const n = poly.length;
  const AX = new Float64Array(n), AZ = new Float64Array(n), EX = new Float64Array(n), EZ = new Float64Array(n), IL = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    AX[i] = a[0]; AZ[i] = a[1]; EX[i] = b[0] - a[0]; EZ[i] = b[1] - a[1];
    IL[i] = 1 / Math.max(1e-9, EX[i] * EX[i] + EZ[i] * EZ[i]);
    minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]); minZ = Math.min(minZ, a[1]); maxZ = Math.max(maxZ, a[1]);
  }
  // signed distance to the outline (positive inside the water). natOut receives the signed distance
  // to the NATURAL shore only (the straight deck edge is a wall, not a beach) — it drives the bed depth.
  const nat = [0];
  const sdfExact = (x, z, natOut = nat) => {
    let best = Infinity, bestN = Infinity, inside = false;
    for (let i = 0; i < n; i++) {
      const px = x - AX[i], pz = z - AZ[i];
      let h = (px * EX[i] + pz * EZ[i]) * IL[i];
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const dx = px - EX[i] * h, dz = pz - EZ[i] * h, d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
      if (i !== n - 1 && d2 < bestN) bestN = d2;
      const z0 = AZ[i], z1 = AZ[i] + EZ[i];
      if ((z0 > z) !== (z1 > z) && x < AX[i] + ((z - z0) / (z1 - z0)) * EX[i]) inside = !inside;
    }
    natOut[0] = inside ? Math.sqrt(bestN) : -Math.sqrt(bestN);
    return inside ? Math.sqrt(best) : -Math.sqrt(best);
  };
  const CS = 0.15, M = 1.6;
  const GX0 = minX - M, GZ0 = minZ - M;
  const NX = Math.ceil((maxX + M - GX0) / CS) + 1, NZ = Math.ceil((maxZ + M - GZ0) / CS) + 1;
  const grid = new Float32Array(NX * NZ), gridN = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      grid[j * NX + i] = sdfExact(GX0 + i * CS, GZ0 + j * CS);
      gridN[j * NX + i] = nat[0];
    }
  }
  const inGrid = (x, z) => x >= GX0 && z >= GZ0 && x < GX0 + (NX - 1) * CS && z < GZ0 + (NZ - 1) * CS;
  const bilinear = (G, x, z) => {
    const fx = (x - GX0) / CS, fz = (z - GZ0) / CS, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * NX + i;
    return lerp(lerp(G[k], G[k + 1], u), lerp(G[k + NX], G[k + NX + 1], u), v);
  };
  const sdfAt = (x, z) => (inGrid(x, z) ? bilinear(grid, x, z) : sdfExact(x, z));
  const natAt = (x, z) => { if (inGrid(x, z)) return bilinear(gridN, x, z); sdfExact(x, z); return nat[0]; };
  return { poly, sdfExact, sdfAt, natAt, inGrid, grid, NX, NZ, GX0, GZ0, CS, minX, maxX, minZ, maxZ };
}

const islandDist = (x, z) => Math.hypot(x - ISL.x, z - ISL.z);

// ground / bank / bed height (y) at (x, z); d = signed shore distance (positive in the water)
function terrainHeight(x, z, d = shape().sdfAt(x, z)) {
  let y;
  const ax = Math.abs(x);
  if (d > 0 || (ax < WALL_X && z < NORTH_Z + 0.05)) {
    // bed depth follows the distance to the natural shore (the deck edge is a wall: deep right below it);
    // shelf width wanders with low-frequency noise so it never reads as a uniform ring
    const dn = Math.max(0, shape().natAt(x, z)) / (0.7 + 0.6 * fbm2(x * 0.11 + 3.1, z * 0.11 - 1.7));
    y = lerp(WATER_Y - 0.03, SHELF_Y, smooth(0, 1.6, dn));
    y = lerp(y, FLOOR_Y, smooth(2.3, 5.4, dn));
    y += (vnoise2(x * 0.6, z * 0.6) - 0.5) * 0.08 * smooth(0.4, 2.0, dn);
  } else {
    const e = -d;
    y = lerp(WATER_Y - 0.03, 0, smooth(0, 1.1, e));
    y += (vnoise2(x * 2.3, z * 2.3) - 0.5) * 0.04 * smooth(0.2, 1.0, e);
    y += fbm2(x * 0.16, z * 0.16) * 0.45 * smooth(1.2, 6, e) * smooth(5.6, 9.0, z);
    const edge = Math.min(SB.x1 - Math.abs(x), SB.z1 - z);
    y += 0.55 * (1 - smooth(0.5, 4.5, edge)) * smooth(5.6, 8, z);
    y = lerp(0, y, smooth(DECK_Z1, NORTH_Z + 0.05, z)); // seam with deck / courtyard
  }
  // islet mound (grassy top for a small tree)
  const di = islandDist(x, z);
  if (di < ISL.r + 1.5) {
    const s = Math.max(0, di - 0.7) / 1.6;
    y = Math.max(y, ISL_TOP - ISL_FALL * Math.pow(s, 1.4) + (vnoise2(x * 1.3, z * 1.3) - 0.5) * 0.12);
  }
  return y;
}

/** true if (x, z) is inside the water outline by at least `margin` and off the islet by `margin` */
/** ground / bank / bed height at (x, z) — lets walkers stand on the undulating shore */
export function groundHeight(x, z) { return terrainHeight(x, z); }

export function insideSea(x, z, margin = 0) {
  if (islandDist(x, z) < ISL.r + margin) return false;
  const S = shape();
  if (!S.inGrid(x, z)) return false;
  return S.sdfAt(x, z) >= margin;
}

// ---------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------
const waveHGlsl = WAVES.map((w) => `${fl(w.amp)} * sin(dot(p, vec2(${fl(w.dx)}, ${fl(w.dz)})) * ${fl(w.k)} - uPwTime * ${fl(w.om)} + ${fl(w.ph)})`).join(' +\n    ');
const waveGGlsl = WAVES.map((w) => `g += vec2(${fl(w.dx)}, ${fl(w.dz)}) * (${fl(w.amp * w.k)} * cos(dot(p, vec2(${fl(w.dx)}, ${fl(w.dz)})) * ${fl(w.k)} - uPwTime * ${fl(w.om)} + ${fl(w.ph)}));`).join('\n  ');

const COMMON = /* glsl */ `
#define PW_WATER_Y ${fl(WATER_Y)}
uniform float uPwTime;
uniform vec4 uPwRings[${MAX_RINGS}];
uniform sampler2D uPwRipple;
uniform sampler2D uPwCaus;
uniform sampler2D uPwField; // r: shore SDF (+water), g: bed height, b: foam distance (shore, islet, rocks)
uniform vec4 uPwFieldXf;
uniform vec3 uPwSunDir;
uniform vec3 uPwSunRefr;
uniform vec3 uPwSunCol;
uniform vec3 uPwCausCol;
uniform vec3 uPwAbsorb;
uniform vec3 uPwScatter;
uniform vec3 uPwLanterns[${N_LANTERNS}];
uniform vec3 uPwLanternCol;

float pw_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float pw_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pw_hash12(i), pw_hash12(i + vec2(1.0, 0.0)), u.x),
             mix(pw_hash12(i + vec2(0.0, 1.0)), pw_hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec4 pw_field(vec2 xz) { return texture2D(uPwField, (xz - uPwFieldXf.xy) * uPwFieldXf.zw); }
float pw_waveH0(vec2 p) {
  return ${waveHGlsl};
}
vec2 pw_waveG0(vec2 p) {
  vec2 g = vec2(0.0);
  ${waveGGlsl}
  return g;
}
uniform float uPwSurf;
float pw_surfDamp(vec2 p) {
  float d = pw_field(p).r;
  d = min(d, length(p - vec2(${fl(ISL.x)}, ${fl(ISL.z)})) - ${fl(ISL_WL)});
  vec2 q = abs(p - vec2(${fl((STAIR.x0 + STAIR.x1) / 2)}, ${fl((STAIR.z0 + STAIR.z1) / 2)})) - vec2(${fl((STAIR.x1 - STAIR.x0) / 2 + 0.4)}, ${fl((STAIR.z1 - STAIR.z0) / 2 + 0.4)});
  d = min(d, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
  return smoothstep(0.3, 3.2, d);
}
float pw_swell(float th, float skew) { return pow(0.5 + 0.5 * sin(th + skew * sin(th)), ${fl(SURF_PEAK)}); }
float pw_surfH(vec2 p) {
  if (uPwSurf < 0.001) return 0.0;
  float h = 0.0;
  ${SURF.map((w) => `h += ${fl(w.amp)} * (pw_swell(dot(p, vec2(${fl(w.dx)}, ${fl(w.dz)})) * ${fl(w.k)} - uPwTime * ${fl(w.om)} + ${fl(w.ph)}, ${fl(w.skew)}) - ${fl(w.bias)});`).join('\n  ')}
  return h * uPwSurf * pw_surfDamp(p);
}
vec2 pw_surfG(vec2 p) {
  if (uPwSurf < 0.001) return vec2(0.0);
  const float e = 0.04;
  float h0 = pw_surfH(p);
  return vec2(pw_surfH(p + vec2(e, 0.0)) - h0, pw_surfH(p + vec2(0.0, e)) - h0) / e;
}
// main set: x = lip foam on the breaking front edge, y = lace left on the back face, z = crest thickness (backlit glow),
// w = phase along the travel direction (for noise that rides with the crest)
vec4 pw_surfLook(vec2 p) {
  if (uPwSurf < 0.001) return vec4(0.0);
  float th = dot(p, vec2(${fl(SURF[0].dx)}, ${fl(SURF[0].dz)})) * ${fl(SURF[0].k)} - uPwTime * ${fl(SURF[0].om)} + ${fl(SURF[0].ph)};
  float ph = th + ${fl(SURF[0].skew)} * sin(th);
  float hn = pow(0.5 + 0.5 * sin(ph), ${fl(SURF_PEAK)});
  float c = cos(ph) * (1.0 + ${fl(SURF[0].skew)} * cos(th));
  float hn2 = pw_swell(dot(p, vec2(${fl(SURF[1].dx)}, ${fl(SURF[1].dz)})) * ${fl(SURF[1].k)} - uPwTime * ${fl(SURF[1].om)} + ${fl(SURF[1].ph)}, ${fl(SURF[1].skew)});
  float k = uPwSurf * pw_surfDamp(p);
  float lip = smoothstep(0.72, 0.95, hn) * smoothstep(0.02, -0.2, c) * (1.0 - smoothstep(-0.35, -0.75, c));
  float lace = smoothstep(0.05, 0.3, c) * smoothstep(0.35, 0.6, hn) * (1.0 - smoothstep(0.85, 0.98, hn));
  return vec4(lip * k, lace * k, clamp(hn * 0.85 + hn2 * 0.35, 0.0, 1.0) * k, th);
}
vec2 pw_waveG(vec2 p) { return pw_waveG0(p) + pw_surfG(p); }
float pw_waveH(vec2 p) { return pw_waveH0(p) + pw_surfH(p); }
// x: height, yz: gradient of the expanding splash rings
vec3 pw_ringHG(vec2 p) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    vec4 r = uPwRings[i];
    float age = uPwTime - r.z;
    if (age < 0.0 || age > ${fl(RING.life)}) continue;
    vec2 dv = p - r.xy;
    float d = length(dv) + 1e-4;
    vec2 dir = dv / d;
    float fall = exp(-age * ${fl(RING.decay)}) * r.w * ${fl(RING.amp)};
    float R1 = 0.2 + ${fl(RING.speed)} * age, w1 = 0.18 + 0.22 * age, u1 = d - R1;
    float e1 = exp(-u1 * u1 / (w1 * w1)) * fall;
    float c1 = cos(${fl(RING.k)} * u1), s1 = sin(${fl(RING.k)} * u1);
    acc.x += e1 * c1;
    float dh = e1 * (-2.0 * u1 / (w1 * w1) * c1 - ${fl(RING.k)} * s1);
    float R2 = 0.1 + ${fl(RING.speed * 0.55)} * age, w2 = 0.14 + 0.16 * age, u2 = d - R2;
    float e2 = exp(-u2 * u2 / (w2 * w2)) * fall * 0.6 * exp(-age * 0.4);
    float k2 = ${fl(RING.k * 1.35)};
    float c2 = cos(k2 * u2), s2 = sin(k2 * u2);
    acc.x += e2 * c2;
    dh += e2 * (-2.0 * u2 / (w2 * w2) * c2 - k2 * s2);
    acc.yz += dh * dir;
  }
  return acc;
}
const mat2 PW_R1 = mat2(0.8, 0.6, -0.6, 0.8);
const mat2 PW_R2 = mat2(0.28, -0.96, 0.96, 0.28);
// fine ripple slopes from 3 scrolling layers of a tileable gradient texture
vec2 pw_rippleG(vec2 p, float detail) {
  vec2 g = (texture2D(uPwRipple, p * 0.17 + uPwTime * vec2(0.012, 0.008)).rg * 2.0 - 1.0) * 0.085;
  vec2 g2 = (texture2D(uPwRipple, PW_R1 * p * 0.42 + uPwTime * vec2(-0.02, 0.016)).rg * 2.0 - 1.0) * 0.065;
  g += transpose(PW_R1) * g2;
  vec2 g3 = (texture2D(uPwRipple, PW_R2 * p * 1.1 + uPwTime * vec2(0.034, -0.027)).rg * 2.0 - 1.0) * 0.045 * detail;
  g += transpose(PW_R2) * g3;
  return g;
}
// two drifting Voronoi-edge webs, warped by the ripple field so the lines wobble with the waves
float pw_caustics(vec2 p) {
  vec2 w = (texture2D(uPwRipple, p * 0.23 + uPwTime * vec2(0.013, 0.009)).rg - 0.5) * 0.32;
  float a = texture2D(uPwCaus, (p + w) * 0.5 + uPwTime * vec2(0.021, 0.014)).r;
  float b = texture2D(uPwCaus, PW_R1 * (p - w) * 0.58 + uPwTime * vec2(-0.016, 0.023)).g;
  float s = (a + b) * 0.62;
  return s * s * 1.15 + s * 0.1;
}
// view-path absorption + in-scatter for anything below the waterline
vec3 pw_underwater(vec3 col, vec3 wp) {
  float below = PW_WATER_Y - wp.y;
  if (below <= 0.0) return col;
  float L = length(wp - cameraPosition);
  float under = cameraPosition.y > PW_WATER_Y ? L * below / max(cameraPosition.y - wp.y, 1e-3) : L;
  vec3 tr = exp(-uPwAbsorb * (under + below * 1.3));
  return mix(col, col * tr + uPwScatter * (1.0 - tr), smoothstep(0.0, 0.04, below));
}
vec3 pw_lanternGlow(vec3 p, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${N_LANTERNS}; i++) {
    vec3 d = uPwLanterns[i] - p;
    float d2 = dot(d, d);
    acc += max(dot(n, d * inversesqrt(d2)), 0.0) / (1.0 + d2 * 1.6);
  }
  return acc * uPwLanternCol;
}
`;

// ---------------------------------------------------------------------------
// procedural textures
// ---------------------------------------------------------------------------
function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function dataTex(data, N, aniso) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
function canvasTex(c, aniso, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  return t;
}
// draw fn(x, y) plus wrapped copies so the canvas tiles seamlessly
function wrapDraw(S, x, y, r, fn) {
  for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) {
    if (x + ox < -r || x + ox > S + r || y + oy < -r || y + oy > S + r) continue;
    fn(x + ox, y + oy);
  }
}

// tileable slope field (sum of integer-wavevector waves). RG = dh/du, dh/dv, B = height
function makeRippleTexture(rand, aniso) {
  const N = 256;
  const S = new Float32Array(N), C = new Float32Array(N);
  for (let i = 0; i < N; i++) { S[i] = Math.sin((2 * Math.PI * i) / N); C[i] = Math.cos((2 * Math.PI * i) / N); }
  const H = new Float32Array(N * N), GX = new Float32Array(N * N), GY = new Float32Array(N * N);
  for (let w = 0; w < 40; w++) {
    const f = 2 + Math.pow(rand(), 1.4) * 14;
    const ang = rand() * Math.PI * 2;
    let kx = Math.round(Math.cos(ang) * f), ky = Math.round(Math.sin(ang) * f);
    if (kx === 0 && ky === 0) kx = 2;
    const amp = 1 / Math.pow(Math.hypot(kx, ky), 1.35);
    const ph = rand() * Math.PI * 2, cp = Math.cos(ph), sp = Math.sin(ph);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const m = (((kx * x + ky * y) % N) + N) % N;
        const s = S[m] * cp + C[m] * sp, c = C[m] * cp - S[m] * sp;
        const i = y * N + x;
        H[i] += amp * s; GX[i] += amp * kx * c; GY[i] += amp * ky * c;
      }
    }
  }
  let gm = 0, hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < N * N; i++) {
    gm = Math.max(gm, Math.abs(GX[i]), Math.abs(GY[i]));
    hmin = Math.min(hmin, H[i]); hmax = Math.max(hmax, H[i]);
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round((GX[i] / gm) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((GY[i] / gm) * 127.5 + 127.5);
    data[i * 4 + 2] = Math.round(((H[i] - hmin) / (hmax - hmin)) * 255);
    data[i * 4 + 3] = 255;
  }
  return dataTex(data, N, aniso);
}

// tileable caustic web: domain-warped Voronoi edges (F2 - F1), one layer per channel
function voronoiEdges(rand, G, N, width, out, ch) {
  const jx = [], jy = [], br = [];
  for (let i = 0; i < G * G; i++) { jx.push(0.12 + 0.76 * rand()); jy.push(0.12 + 0.76 * rand()); br.push(0.65 + 0.35 * rand()); }
  const TAU = Math.PI * 2, ph = rand() * TAU;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const fx = (u + 0.035 * Math.sin(TAU * (2 * v) + ph) + 0.02 * Math.sin(TAU * (3 * u + 2 * v) + 0.7)) * G;
      const fy = (v + 0.035 * Math.sin(TAU * (2 * u) + ph * 1.7) + 0.02 * Math.sin(TAU * (2 * u - 3 * v) + 0.2)) * G;
      const cx = Math.floor(fx), cy = Math.floor(fy);
      let d1 = 1e9, d2 = 1e9, b1 = 1, b2 = 1;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = cx + i, gy = cy + j;
          const k = (((gy % G) + G) % G) * G + (((gx % G) + G) % G);
          const d = Math.hypot(gx + jx[k] - fx, gy + jy[k] - fy);
          if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = br[k]; } else if (d < d2) { d2 = d; b2 = br[k]; }
        }
      }
      const e = d2 - d1;
      out[(y * N + x) * 4 + ch] = Math.min(255, Math.exp(-(e * e) / (width * width)) * (b1 + b2) * 0.5 * 255);
    }
  }
}
function makeCausticTexture(rand, aniso) {
  const N = 256, data = new Uint8Array(N * N * 4);
  voronoiEdges(rand, 5, N, 0.16, data, 0);
  voronoiEdges(rand, 6, N, 0.16, data, 1);
  for (let i = 0; i < N * N; i++) data[i * 4 + 3] = 255;
  return dataTex(data, N, aniso);
}

// mossy grass with blades, moss blobs and a little grit (2.5 m tile)
function makeGrassTexture(rand, aniso) {
  const S = 512;
  const [c, g] = canvas2d(S, S);
  g.fillStyle = '#5a6833'; g.fillRect(0, 0, S, S);
  const moss = ['#4f5d2b', '#66763a', '#5d6a30', '#738241', '#7d7a3c'];
  for (let k = 0; k < 110; k++) {
    const x = rand() * S, y = rand() * S, r = 12 + rand() * 38, col = moss[(rand() * moss.length) | 0];
    wrapDraw(S, x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, col + 'aa'); grd.addColorStop(1, col + '00');
      g.fillStyle = grd; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    });
  }
  const blades = ['#6e7d3b', '#7b8943', '#566430', '#889046', '#a29a4c', '#4b5729', '#93a052', '#b0a457'];
  g.lineCap = 'round';
  for (let k = 0; k < 5200; k++) {
    const x = rand() * S, y = rand() * S, len = 3 + rand() * 7, a = rand() * Math.PI * 2;
    g.strokeStyle = blades[(rand() * blades.length) | 0]; g.lineWidth = 1 + rand() * 0.9;
    wrapDraw(S, x, y, len, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); g.stroke(); });
  }
  for (let k = 0; k < 140; k++) {
    const x = rand() * S, y = rand() * S, r = 0.8 + rand() * 1.8, v = 120 + rand() * 70;
    g.fillStyle = `rgb(${v | 0},${(v - 6) | 0},${(v - 16) | 0})`;
    wrapDraw(S, x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); });
  }
  return canvasTex(c, aniso);
}

// sand + rounded pebbles with soft shading (2 m tile)
function makeGravelTexture(rand, aniso) {
  const S = 512;
  const [c, g] = canvas2d(S, S);
  g.fillStyle = '#a69a83'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 6000; k++) {
    const v = 130 + rand() * 60;
    g.fillStyle = `rgba(${v | 0},${(v - 8) | 0},${(v - 22) | 0},0.5)`;
    g.fillRect(rand() * S, rand() * S, 1 + rand(), 1 + rand());
  }
  for (let k = 0; k < 620; k++) {
    const x = rand() * S, y = rand() * S, rx = 2 + Math.pow(rand(), 1.6) * 8, ry = rx * (0.55 + rand() * 0.4), rot = rand() * Math.PI;
    const h = 25 + rand() * 25, s = 6 + rand() * 14, l = 42 + rand() * 30;
    wrapDraw(S, x, y, rx + 2, (px, py) => {
      g.fillStyle = 'rgba(40,32,24,0.32)'; g.beginPath(); g.ellipse(px + 1, py + 1.6, rx, ry, rot, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`; g.beginPath(); g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,250,235,0.28)'; g.beginPath(); g.ellipse(px - rx * 0.25, py - ry * 0.3, rx * 0.5, ry * 0.4, rot, 0, Math.PI * 2); g.fill();
    });
  }
  return canvasTex(c, aniso);
}

function makeGlowTexture() {
  const [c, g] = canvas2d(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
// Box with chamfered top edges, flat-shaded, per-face vertex colours. Non-indexed.
function chamferBox(x0, x1, y0, y1, z0, z1, b, col, opt = {}) {
  const P = [], N = [], C = [];
  const ctr = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3(), fc = new THREE.Vector3();
  const tri = (a, bb, c, color) => {
    va.fromArray(a); vb.fromArray(bb); vc.fromArray(c);
    n.subVectors(vb, va).cross(fc.subVectors(vc, va));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    fc.copy(va).add(vb).add(vc).multiplyScalar(1 / 3).sub(ctr);
    if (n.dot(fc) < 0) { const t = vb.clone(); vb.copy(vc); vc.copy(t); n.negate(); }
    for (const v of [va, vb, vc]) { P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); C.push(color.r, color.g, color.b); }
  };
  const quad = (a, bb, c, d, color) => { tri(a, bb, c, color); tri(a, c, d, color); };
  const top = col, edge = opt.edgeCol || col.clone().multiplyScalar(1.13), side = opt.sideCol || col.clone().multiplyScalar(0.9);
  const yt = y1, ye = y1 - b;
  const t00 = [x0 + b, yt, z0 + b], t10 = [x1 - b, yt, z0 + b], t11 = [x1 - b, yt, z1 - b], t01 = [x0 + b, yt, z1 - b];
  const e00 = [x0, ye, z0], e10 = [x1, ye, z0], e11 = [x1, ye, z1], e01 = [x0, ye, z1];
  const b00 = [x0, y0, z0], b10 = [x1, y0, z0], b11 = [x1, y0, z1], b01 = [x0, y0, z1];
  quad(t00, t10, t11, t01, top);
  if (b > 0) {
    quad(e00, e10, t10, t00, edge); quad(e10, e11, t11, t10, edge);
    quad(e11, e01, t01, t11, edge); quad(e01, e00, t00, t01, edge);
  }
  quad(b00, b10, e10, e00, side); quad(b10, b11, e11, e10, side);
  quad(b11, b01, e01, e11, side); quad(b01, b00, e00, e01, side);
  if (opt.bottom) quad(b00, b01, b11, b10, side);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return geo;
}
// block whose chamfered face points +z (x0..x1, y0..y1, back zb .. front zf)
function frontBlock(x0, x1, y0, y1, zb, zf, b, col) {
  return chamferBox(x0, x1, zb, zf, -y1, -y0, b, col).rotateX(Math.PI / 2);
}

// convert any built-in geometry to non-indexed position/normal/color (rounded edges get lifted)
function prepColored(geo, col, edgeLift = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.normal, cnt = g.attributes.position.count;
  const arr = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const ax = Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i)));
    const f = ax < 0.985 ? 1 + edgeLift : 1;
    arr[i * 3] = col.r * f; arr[i * 3 + 1] = col.g * f; arr[i * 3 + 2] = col.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function vary(base, rand, amt = 0.06, hueAmt = 0.01) {
  const c = base.clone();
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h + (rand() - 0.5) * hueAmt, hsl.s * (0.9 + rand() * 0.2), hsl.l);
  return c.multiplyScalar(1 + (rand() - 0.5) * 2 * amt);
}

// split [a, b] into blocks of random length, never leaving a sliver at the end
function runs(a, b, rand, min, span, minLast = 0.3) {
  const out = [];
  let s = a;
  while (s < b - 1e-3) {
    let len = min + rand() * span;
    if (b - (s + len) < minLast) len = b - s;
    out.push([s, s + len]);
    s += len;
  }
  return out;
}

// chunky faceted boulder: lumpy icosphere sliced by random planes (flat cleaved faces), flattened base
function rockGeometry(detail, seed) {
  const r = mulberry32(seed * 7919);
  const planes = [[0, 1, 0, 0.5 + r() * 0.15]];
  for (let k = 0; k < 6; k++) {
    const a = r() * Math.PI * 2, e = (r() - 0.3) * 1.1;
    planes.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e), 0.62 + r() * 0.25]);
  }
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const s = 0.85 + 0.3 * vnoise3(x * 1.3 + seed, y * 1.3 + 3.1, z * 1.3 - seed);
    x *= s; y *= s; z *= s;
    for (const [nx, ny, nz, off] of planes) {
      const e = x * nx + y * ny + z * nz - off;
      if (e > 0) { x -= nx * e; y -= ny * e; z -= nz * e; }
    }
    if (y < -0.4) y = -0.4 + (y + 0.4) * 0.3;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// material patching (MeshStandardMaterial + water-aware lighting tricks)
// ---------------------------------------------------------------------------
// caustics modulate the directional light (so the real shadow map still applies)
const SUNBOOST = /* glsl */ `
{
  float pwBelow = PW_WATER_Y - vPW.y;
  float pwUw = smoothstep(0.0, 0.1, pwBelow);
  if (pwUw > 0.0) {
    vec2 sp = vPW.xz + uPwSunRefr.xz * (pwBelow / uPwSunRefr.y);
    float inSea = smoothstep(-0.1, 0.25, pw_field(sp).r);
    float c = pw_caustics(sp);
    vec3 boost = (vec3(0.22, 0.4, 0.44) + uPwCausCol * c * 3.0) * mix(0.25, 1.0, inSea);
    pwSunBoost = mix(vec3(1.0), boost, pwUw);
  }
}
`;

const WET_LINE = 'float wl = PW_WATER_Y + 0.04 + 0.02 * sin(uPwTime * 1.3 + vPW.x * 1.7 + vPW.z * 1.3);';

function colorMod(kind) {
  if (kind === 'ground') return /* glsl */ `
  {
    vec2 p = vPW.xz;
    vec3 grass = texture2D(uPwGrassTex, p * 0.4).rgb;
    grass = mix(grass, texture2D(uPwGrassTex, PW_R1 * p * 0.23 + 0.37).rgb, 0.4);
    vec3 grav = texture2D(uPwGravelTex, p * 0.5).rgb;
    float n = pw_vnoise(p * 0.45) * 0.6 + pw_vnoise(p * 1.7 + 7.0) * 0.4;
    float gm = smoothstep(0.72, 0.84, n) * 0.6;
    // pebbly bank right at the water, grass takes over on higher ground (e.g. the islet top)
    gm = max(gm, (1.0 - smoothstep(0.35, 1.3 + 0.7 * n, -vShoreD)) * (1.0 - smoothstep(0.02, 0.22, vPW.y)));
    vec3 land = mix(grass * mix(0.85, 1.12, pw_vnoise(p * 0.7 + 3.0)), grav, gm);
    vec3 sand = mix(grav, vec3(0.62, 0.56, 0.44), 0.5);
    float rip = sin(dot(p, vec2(0.6, 0.8)) * 9.0 + pw_vnoise(p * 0.8) * 6.0) * 0.5 + 0.5;
    sand *= 0.9 + 0.14 * rip;
    float under = smoothstep(PW_WATER_Y + 0.03, PW_WATER_Y - 0.1, vPW.y);
    diffuseColor.rgb *= mix(land, sand, under);
    ${WET_LINE}
    pwWet = (1.0 - smoothstep(wl, wl + 0.2, vPW.y)) * (1.0 - under * 0.5);
    diffuseColor.rgb *= mix(1.0, 0.58, pwWet);
  }`;
  if (kind === 'stone' || kind === 'rock') return /* glsl */ `
  {
    vec3 an = abs(vPN);
    vec2 np = an.y > 0.5 ? vPW.xz : (an.x > 0.5 ? vPW.zy : vPW.xy);
    float m = pw_vnoise(np * 2.1) * 0.45 + pw_vnoise(np * 7.0) * 0.35 + pw_vnoise(np * 23.0) * 0.2;
    diffuseColor.rgb *= 0.8 + 0.38 * m;
    ${kind === 'rock' ? `
    float moss = smoothstep(0.35, 0.8, vPN.y) * smoothstep(PW_WATER_Y + 0.12, PW_WATER_Y + 0.35, vPW.y) * smoothstep(0.3, 0.62, pw_vnoise(vPW.xz * 2.7 + vPW.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.22, 0.06), moss * 0.9);` : ''}
    ${WET_LINE}
    pwWet = 1.0 - smoothstep(wl, wl + 0.28, vPW.y);
    diffuseColor.rgb *= mix(1.0, 0.6, pwWet);
  }`;
  if (kind === 'wood') return /* glsl */ `
  {
    vec3 an = abs(vPN);
    vec2 np = an.y > 0.5 ? vPW.xz : (an.x > 0.5 ? vPW.zy : vPW.xy);
    float m = pw_vnoise(np * vec2(2.0, 26.0)) * 0.5 + pw_vnoise(np * 7.0) * 0.5;
    diffuseColor.rgb *= 0.84 + 0.3 * m;
    ${WET_LINE}
    pwWet = 1.0 - smoothstep(wl, wl + 0.22, vPW.y);
    diffuseColor.rgb *= mix(1.0, 0.55, pwWet);
  }`;
  return '';
}

const POSTMOD = /* glsl */ `
{
  outgoingLight += diffuseColor.rgb * pw_lanternGlow(vPW, normalize(vPN));
  outgoingLight = pw_underwater(outgoingLight, vPW);
}
`;

function patchStandard(mat, kind, shared) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    const isGround = kind === 'ground';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPW;\nvarying vec3 vPN;\n${isGround ? 'attribute float aShoreD;\nvarying float vShoreD;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 pwWp = vec4(transformed, 1.0);
  vec3 pwNo = objectNormal;
  #ifdef USE_INSTANCING
    pwWp = instanceMatrix * pwWp;
    pwNo = mat3(instanceMatrix) * pwNo;
  #endif
  vPW = (modelMatrix * pwWp).xyz;
  vPN = normalize(mat3(modelMatrix) * pwNo);
  ${isGround ? 'vShoreD = aShoreD;' : ''}
}`);
    let fs = sh.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>\n${COMMON}\nvarying vec3 vPW;\nvarying vec3 vPN;\n${isGround ? 'varying float vShoreD;\nuniform sampler2D uPwGrassTex;\nuniform sampler2D uPwGravelTex;' : ''}\nvec3 pwSunBoost = vec3(1.0);\nfloat pwWet = 0.0;\n`);
    fs = fs.replace('#include <lights_pars_begin>', THREE.ShaderChunk.lights_pars_begin.replace('light.color = directionalLight.color;', 'light.color = directionalLight.color * pwSunBoost;'));
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + colorMod(kind));
    fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, pwWet);');
    fs = fs.replace('#include <lights_fragment_begin>', SUNBOOST + '\n#include <lights_fragment_begin>');
    fs = fs.replace('#include <opaque_fragment>', POSTMOD + '\n#include <opaque_fragment>');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'tiaohai-sea-' + kind;
  return mat;
}

// ---------------------------------------------------------------------------
// water surface shader
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */ `
${COMMON}
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += pw_waveH(wp.xz) + pw_ringHG(wp.xz).x;
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const stepBox = { c: [(STAIR.x0 + STAIR.x1) / 2, ST.z0 + ST.depth / 2], h: [(STAIR.x1 - STAIR.x0) / 2, ST.depth / 2] };

const WATER_FRAG = /* glsl */ `
#include <common>
${COMMON}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoamCol;
uniform vec3 uSurfGlow;
uniform vec3 uSkyZen;
uniform vec3 uSkyMid;
uniform vec3 uSkyHor;
uniform vec3 uWallRefl;
uniform vec3 uSilhouette;
uniform vec3 uGlintCol;
uniform vec4 uGlints[${MAX_GLINTS}];
uniform int uGlintCount;
uniform float uDeepAlpha;
uniform float uShallowAlpha;
varying vec3 vW;
#include <fog_pars_fragment>

float sdBox2(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// same palette as the game's sky dome (env.js)
vec3 skyCol(vec3 R) {
  float h = clamp(R.y, 0.0, 1.0);
  vec3 c = mix(uSkyHor, uSkyMid, smoothstep(-0.02, 0.13, h));
  c = mix(c, uSkyZen, smoothstep(0.1, 0.55, h));
  float s = max(dot(normalize(vec3(R.x, 0.0, R.z) + 1e-5), normalize(vec3(uPwSunDir.x, 0.0, uPwSunDir.z))), 0.0);
  c += vec3(1.0, 0.45, 0.2) * pow(s, 6.0) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.9;
  return c;
}
vec3 envRefl(vec3 P, vec3 R) {
  vec3 c = skyCol(R);
  // soft treeline / rooftops all around
  float tanE = R.y / (length(R.xz) + 1e-4);
  float az = atan(R.x, R.z);
  float line = 0.17 + 0.06 * sin(az * 3.0 + 0.7) + 0.04 * sin(az * 7.0 + 2.1) + 0.025 * sin(az * 17.0 + 0.4);
  c = mix(c, uSilhouette, (1.0 - smoothstep(line - 0.03, line + 0.03, tanE)) * 0.85);
  // the courtyard block (walls + roofs) north of the deck, ray-cast as a box
  vec3 bmin = vec3(${fl(-COURT.x)}, -1.0, ${fl(COURT.z0)}), bmax = vec3(${fl(COURT.x)}, ${fl(COURT.h)}, ${fl(DECK_Z1)});
  vec3 iv = 1.0 / (R + vec3(1e-5));
  vec3 t0 = (bmin - P) * iv, t1 = (bmax - P) * iv;
  vec3 tn3 = min(t0, t1), tf3 = max(t0, t1);
  float tn = max(max(tn3.x, tn3.y), tn3.z), tf = min(min(tf3.x, tf3.y), tf3.z);
  if (tf > max(tn, 0.0)) {
    vec3 hp = P + R * max(tn, 0.0);
    vec3 wc = uWallRefl * (0.45 + 0.55 * smoothstep(0.0, ${fl(COURT.h - 0.5)}, hp.y));
    c = mix(wc, uWallRefl * 0.5, smoothstep(${fl(COURT.h - 0.6)}, ${fl(COURT.h - 0.4)}, hp.y));
  }
  return c;
}

void main() {
  vec3 P = vW;
  vec2 xz = P.xz;
  vec3 toC = cameraPosition - P;
  float dist = length(toC);
  vec3 V = toC / dist;
  float detail = 1.0 - smoothstep(8.0, 30.0, dist);

  vec3 rg = pw_ringHG(xz);
  vec2 gRip = pw_rippleG(xz, detail) * mix(0.6, 1.0, detail);
  vec2 g = pw_waveG(xz) + rg.yz + gRip;
  // full-detail normal for glints, calmer normal for the mirror image at grazing angles
  vec3 Ng = normalize(vec3(-g.x, 1.0, -g.y));
  float graze = smoothstep(0.03, 0.45, V.y);
  vec2 gm = pw_waveG(xz) + rg.yz + gRip * mix(0.3, 1.0, graze);
  vec3 N = normalize(vec3(-gm.x, 1.0, -gm.y));

  vec4 fld = pw_field(xz);
  float sd = fld.b;
  sd = min(sd, sdBox2(xz, vec2(${fl(stepBox.c[0])}, ${fl(stepBox.c[1])}), vec2(${fl(stepBox.h[0])}, ${fl(stepBox.h[1])})));
  sd = min(sd, min(length(xz - vec2(${fl(RAIL_X[0])}, ${fl(POST_Z[1])})), length(xz - vec2(${fl(RAIL_X[1])}, ${fl(POST_Z[1])}))) - 0.06);
  float depth = PW_WATER_Y - fld.g;

  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 4.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = envRefl(P, R) * 0.82;

  float shallow = 1.0 - smoothstep(0.15, 1.35, depth);
  vec3 body = mix(uDeep, uShallow, shallow);
  float a = mix(uDeepAlpha, uShallowAlpha, shallow);
  a *= mix(0.6, 1.0, smoothstep(0.0, 1.4, sd));
  // 蹦迪 swell: a moving mass of water — dark troughs, glassy green-blue crests lit through from behind
  vec4 sl = pw_surfLook(xz);
  float swellK = uPwSurf * pw_surfDamp(xz);
  body = mix(body, uDeep * 0.5, swellK * (1.0 - sl.z / max(swellK, 1e-3)) * 0.7);
  a = mix(a, 0.88, swellK * 0.85);
  vec3 col = mix(body, refl, F);
  a = mix(a, 1.0, F);
  float thin = sl.z * sl.z * (0.45 + 0.55 * (1.0 - clamp(V.y * 1.6, 0.0, 1.0)));
  col += uSurfGlow * thin * (1.0 - F * 0.6);

  // shoreline: soft brightening + lacy contact line
  float n1 = texture2D(uPwRipple, xz * 0.55 + vec2(uPwTime * 0.02, 0.0)).b;
  float n2 = texture2D(uPwRipple, PW_R2 * xz * 1.6 - vec2(0.0, uPwTime * 0.03)).b;
  float shore = 1.0 - smoothstep(0.0, 0.9, sd);
  col = mix(col, uShallow * 1.3, shore * 0.2);
  float fw = fwidth(sd) + 1e-4;
  float lineW = 0.035 + 0.045 * n1 + 0.015 * sin(uPwTime * 1.7 + xz.x * 0.8 + xz.y * 0.6);
  float near = 1.0 - smoothstep(10.0, 32.0, dist);
  float foam = (1.0 - smoothstep(lineW - fw, lineW + fw + 0.02, sd)) * smoothstep(0.22, 0.62, n2 + 0.3 * n1) * mix(0.45, 0.9, near);
  foam += (1.0 - smoothstep(0.0, 0.5, sd)) * smoothstep(0.62, 0.9, n2 * 0.65 + n1 * 0.5) * 0.35;

  // splash foam: crest line + lacy patch that dissolves
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    vec4 r = uPwRings[i];
    float age = uPwTime - r.z;
    if (age < 0.0 || age > 3.5) continue;
    float d = distance(xz, r.xy);
    float R1 = 0.2 + ${fl(RING.speed)} * age, w1 = 0.18 + 0.22 * age;
    float cu = (d - R1) / (w1 * 0.5);
    float crest = exp(-cu * cu) * exp(-age * 1.5) * r.w;
    float patchF = r.w * exp(-age * 0.9) * (1.0 - smoothstep(0.15, 0.5 + 0.55 * age, d));
    float lace = smoothstep(0.38, 0.72, n2 + 0.3 * n1 - age * 0.06);
    foam += crest * (0.35 + 0.65 * lace) + patchF * (0.25 + 0.75 * lace);
  }
  if (sl.x + sl.y > 0.002) {
    // lip: torn white edge riding with the crest (noise in crest-aligned coordinates); lace: thin web left behind it
    vec2 cq = vec2(dot(xz, vec2(${fl(-SURF[0].dz)}, ${fl(SURF[0].dx)})), sl.w / ${fl(SURF[0].k)});
    float ln = texture2D(uPwRipple, cq * vec2(0.22, 0.9)).b * 0.65 + texture2D(uPwRipple, cq * vec2(0.6, 2.3) + 0.37).b * 0.45;
    foam += sl.x * smoothstep(0.42, 0.62, ln + 0.3 * sl.x);
    float web = (1.0 - smoothstep(0.0, 0.05, abs(n2 + 0.35 * n1 - 0.62))) * smoothstep(0.45, 0.7, ln);
    foam += sl.y * web * 0.45;
  }
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, uFoamCol, foam);
  a = max(a, foam * 0.95);

  // speculars: sun + lamp glints (anisotropic: tight in azimuth, loose in elevation -> broken pillars)
  float rough = smoothstep(6.0, 35.0, dist);
  vec3 H = normalize(uPwSunDir + V);
  float nh = max(dot(Ng, H), 0.0);
  vec3 spec = uPwSunCol * (pow(nh, mix(1600.0, 400.0, rough)) * 3.0 + pow(nh, 160.0) * 0.08);
  vec3 Rg = reflect(-V, Ng);
  Rg.y = abs(Rg.y);
  vec2 ra = normalize(Rg.xz + 1e-5);
  for (int i = 0; i < ${MAX_GLINTS}; i++) {
    if (i >= uGlintCount) break;
    vec4 gq = uGlints[i];
    vec3 Ld = gq.xyz - P;
    float dl = length(Ld);
    vec3 L = Ld / dl;
    float az = 1.0 - dot(ra, normalize(L.xz + 1e-5));
    float el = Rg.y - L.y;
    float core = exp(-az * 2600.0 - el * el * 70.0);
    float soft = exp(-az * 140.0 - el * el * 9.0);
    spec += uGlintCol * gq.w * (core * 0.95 + soft * 0.06) / (1.0 + dl * 0.05);
  }
  spec *= 1.0 - foam;

  vec3 prem = col * a + spec;
  float aOut = clamp(max(a, max(spec.r, max(spec.g, spec.b))), 0.0, 1.0);
  gl_FragColor = vec4(prem / max(aOut, 1e-4), aOut);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb += (pw_hash12(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

// ---------------------------------------------------------------------------
// splash VFX shaders
// ---------------------------------------------------------------------------
const DROP_VERT = /* glsl */ `
uniform float uPwTime;
uniform float uPxH;
attribute vec3 aVel;
attribute vec2 aInfo; // birth, size
varying float vA;
void main() {
  float age = uPwTime - aInfo.x;
  vec3 p = position + aVel * age + vec3(0.0, -4.6 * age * age, 0.0);
  bool dead = age < 0.0 || age > 2.2 || (p.y < ${fl(WATER_Y - 0.02)} && age > 0.06);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  gl_PointSize = dead ? 0.0 : aInfo.y * projectionMatrix[1][1] * uPxH / max(-mv.z, 0.1);
  vA = clamp(1.0 - age / 1.8, 0.0, 1.0);
}
`;
const DROP_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = (1.0 - smoothstep(0.32, 0.5, r)) * vA;
  float hi = 1.0 - smoothstep(0.0, 0.22, length(c - vec2(-0.13, -0.13)));
  vec3 col = mix(vec3(0.72, 0.93, 0.96), vec3(1.25, 1.2, 1.1), hi);
  gl_FragColor = vec4(col, a * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const CROWN_VERT = /* glsl */ `
uniform float uPwTime;
attribute vec4 aData; // x, z, birth, strength
varying float vA;
varying float vV;
varying float vAng;
varying float vSeed;
void main() {
  float age = uPwTime - aData.z;
  float s = aData.w;
  float life = 0.65 + 0.35 * s;
  float k = age / life;
  vV = position.y + 0.5;
  vAng = atan(position.z, position.x);
  vSeed = aData.z;
  if (k < 0.0 || k > 1.0 || s <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float rad = (0.14 + 0.62 * sqrt(k)) * mix(0.65, 1.0, s);
  float lobes = 0.78 + 0.22 * sin(vAng * 7.0 + aData.z * 13.0) + 0.12 * sin(vAng * 13.0 + aData.z * 5.0);
  float hgt = s * 0.62 * sin(3.14159 * min(k * 1.15, 1.0)) * lobes;
  float flare = 1.0 + vV * (0.3 + 0.7 * k);
  vec3 p = vec3(position.x * 2.0 * rad * flare, vV * hgt, position.z * 2.0 * rad * flare);
  vec3 wp = vec3(aData.x, ${fl(WATER_Y - 0.03)}, aData.y) + p;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vA = pow(1.0 - k, 1.4);
}
`;
const CROWN_FRAG = /* glsl */ `
varying float vA;
varying float vV;
varying float vAng;
varying float vSeed;
void main() {
  float streak = 0.55 + 0.45 * sin(vAng * 23.0 + vSeed * 7.0 + vV * 3.0);
  float a = vA * (1.0 - smoothstep(0.55, 1.0, vV)) * mix(0.6, 1.0, streak) * smoothstep(0.0, 0.06, vV);
  vec3 col = mix(vec3(0.8, 0.97, 0.98), vec3(1.15, 1.12, 1.05), vV);
  gl_FragColor = vec4(col, min(1.0, a * 1.05));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------
export function createPool({ renderer, scene, camera } = {}) { // eslint-disable-line no-unused-vars
  const rand = mulberry32(20241019);
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  const S = shape();
  const group = new THREE.Group();
  group.name = 'sea';
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // walk the natural (curved) shore: points with outward normals, for rocks / pebbles / lanterns
  const shorePts = [];
  {
    const poly = S.poly, n = poly.length;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if (Math.abs(a[1] - NORTH_Z) < 0.02 && Math.abs(b[1] - NORTH_Z) < 0.02) continue; // straight deck edge
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      for (let s = 0; s < len; s += 0.1) {
        const x = a[0] + tx * s, z = a[1] + tz * s;
        // outward normal: pick the side where the SDF decreases
        let nx = tz, nz = -tx;
        if (S.sdfAt(x + nx * 0.2, z + nz * 0.2) > S.sdfAt(x - nx * 0.2, z - nz * 0.2)) { nx = -nx; nz = -nz; }
        shorePts.push({ x, z, nx, nz, s: acc + s });
      }
      acc += len;
    }
  }
  const shoreLen = shorePts[shorePts.length - 1].s;
  const shoreAt = (s) => { // nearest sample at arc length s
    s = ((s % shoreLen) + shoreLen) % shoreLen;
    let lo = 0, hi = shorePts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (shorePts[m].s < s) lo = m + 1; else hi = m; }
    return shorePts[lo];
  };

  // lanterns on wooden posts along the bank
  const lanterns = [];
  for (let i = 0; i < N_LANTERNS; i++) {
    const p = shoreAt(shoreLen * (0.07 + (0.86 * i) / (N_LANTERNS - 1)));
    const x = p.x + p.nx * 1.25, z = p.z + p.nz * 1.25;
    const g = terrainHeight(x, z);
    lanterns.push({ x, z, ground: g, y: g + 1.3 + 0.04 + 0.2 });
  }

  // ---- shared uniforms ----
  const rings = Array.from({ length: MAX_RINGS }, () => ({ x: 0, z: 0, t0: -1e4, s: 0 }));
  const sunRefr = (() => {
    const d = SUN_DIR.clone().negate(); // light travel direction
    const eta = 1 / 1.333, c = -d.y;
    const k = 1 - eta * eta * (1 - c * c);
    return d.multiplyScalar(eta).add(new THREE.Vector3(0, eta * c - Math.sqrt(k), 0)).normalize().negate();
  })();
  const shared = {
    uPwTime: { value: 0 },
    uPwSurf: { value: 0 },
    uPwRings: { value: rings.map(() => new THREE.Vector4(0, 0, -1e4, 0)) },
    uPwRipple: { value: keep(makeRippleTexture(rand, aniso)) },
    uPwCaus: { value: keep(makeCausticTexture(rand, aniso)) },
    uPwField: { value: null },
    uPwFieldXf: { value: new THREE.Vector4() },
    uPwSunDir: { value: SUN_DIR.clone() },
    uPwSunRefr: { value: sunRefr },
    uPwSunCol: { value: lin(0xffb27a).multiplyScalar(1.6) },
    uPwCausCol: { value: lin(0xfff0c8) },
    uPwAbsorb: { value: new THREE.Vector3(0.52, 0.15, 0.12) },
    uPwScatter: { value: lin(0x11788a).multiplyScalar(0.62) },
    uPwLanterns: { value: lanterns.map((l) => new THREE.Vector3(l.x, l.y, l.z)) },
    uPwLanternCol: { value: lin(0xff9a40).multiplyScalar(1.5) },
  };

  // =========================================================================
  // ROCKS: shore boulders, islet stack, pebbles (instanced, faceted)
  // =========================================================================
  const boulders = []; // { x, y, z, sx, sy, sz, ry, rx, rz }
  const pebbles = [];
  {
    const place = (list, x, z, sx, sy, sz, sink = 0.35) => {
      list.push({ x, z, y: terrainHeight(x, z) - sy * sink, sx, sy, sz, ry: rand() * Math.PI * 2, rx: (rand() - 0.5) * 0.3, rz: (rand() - 0.5) * 0.3 });
    };
    // along the natural shore, hugging the waterline (mostly on the land side)
    for (let s = rand() * 0.6; s < shoreLen; s += 0.75 + rand() * 1.1) {
      const p = shoreAt(s);
      const sx = 0.3 + Math.pow(rand(), 1.5) * 0.45;
      const off = Math.max(sx - 0.42, -0.05 + rand() * 0.55); // never poke > 0.42 m into the water (swim margin)
      place(boulders, p.x + p.nx * off, p.z + p.nz * off, sx, sx * (0.55 + rand() * 0.35), sx * (0.7 + rand() * 0.5));
      if (rand() < 0.35) {
        const o2 = off + 0.35 + rand() * 0.4, t = (rand() - 0.5) * 0.6, s2 = sx * (0.45 + rand() * 0.3);
        place(boulders, p.x + p.nx * o2 - p.nz * t, p.z + p.nz * o2 + p.nx * t, s2, s2 * 0.7, s2 * 0.9);
      }
    }
    // corner boulders hide the deck-wall / bank junctions
    for (const sgn of [-1, 1]) {
      place(boulders, sgn * (WALL_X + 0.45), NORTH_Z + 0.25, 0.66, 0.42, 0.52, 0.2);
      place(boulders, sgn * (WALL_X + 1.15), NORTH_Z + 0.55, 0.45, 0.3, 0.4, 0.3);
      place(boulders, sgn * (WALL_X + 0.15), NORTH_Z + 0.78, 0.3, 0.2, 0.26, 0.4);
    }
    // islet: low slabs and a few stacked accent rocks around a grassy hump (middle left free for a tree)
    const isl = [ // angle (deg), radius, sx, sy, top above water
      [200, 1.25, 0.75, 0.42, 0.42], [250, 1.3, 0.6, 0.5, 0.75], [300, 1.35, 0.58, 0.4, 0.5], [345, 1.3, 0.55, 0.62, 1.15],
      [20, 1.35, 0.62, 0.38, 0.45], [75, 1.3, 0.7, 0.45, 0.6], [125, 1.35, 0.55, 0.36, 0.38], [160, 1.3, 0.5, 0.55, 0.9],
      [330, 1.6, 0.32, 0.22, 0.18], [100, 1.7, 0.28, 0.18, 0.12], [225, 1.7, 0.3, 0.2, 0.15],
    ];
    for (const [deg, rr, sx, sy, top] of isl) {
      const a = (deg * Math.PI) / 180 + (rand() - 0.5) * 0.15;
      boulders.push({ x: ISL.x + Math.cos(a) * rr, z: ISL.z + Math.sin(a) * rr, y: WATER_Y + top - sy, sx, sy, sz: sx * (0.8 + rand() * 0.35), ry: rand() * 6.28, rx: (rand() - 0.5) * 0.2, rz: (rand() - 0.5) * 0.2 });
    }
    // pebbles on the bank and the shallow shelf
    for (let k = 0; k < 300; k++) {
      const p = shoreAt(rand() * shoreLen);
      const off = -1.6 + rand() * 3.0;
      const sc = 0.05 + Math.pow(rand(), 2) * 0.12;
      place(pebbles, p.x + p.nx * off, p.z + p.nz * off, sc, sc * (0.5 + rand() * 0.3), sc * (0.7 + rand() * 0.5), 0.4);
    }
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2, r = 0.8 + rand() * 1.2;
      const sc = 0.06 + rand() * 0.1;
      place(pebbles, ISL.x + Math.cos(a) * r, ISL.z + Math.sin(a) * r, sc, sc * 0.6, sc * 0.8, 0.4);
    }
    const mat = patchStandard(new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, flatShading: true, dithering: true }), 'rock', shared);
    keep(mat);
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const tones = [lin(0xa59b8b), lin(0xb4a690), lin(0x948f89), lin(0xbcae97), lin(0x8d857a)];
    const build = (list, geo, name) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((r, i) => {
        dummy.position.set(r.x, r.y, r.z); dummy.rotation.set(r.rx, r.ry, r.rz); dummy.scale.set(r.sx, r.sy, r.sz);
        dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, col.copy(tones[(rand() * tones.length) | 0]).multiplyScalar(0.85 + rand() * 0.3));
      });
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      m.computeBoundingSphere();
      group.add(m); keep(geo);
      return m;
    };
    build(boulders.filter((_, i) => i % 2 === 0), rockGeometry(1, 3.7), 'sea-boulders-a');
    build(boulders.filter((_, i) => i % 2 === 1), rockGeometry(1, 11.3), 'sea-boulders-b');
    build(pebbles, rockGeometry(0, 9.1), 'sea-pebbles').castShadow = false;
  }

  // =========================================================================
  // FIELD texture: shore SDF / bed height / foam distance (incl. islet + rock footprints)
  // =========================================================================
  {
    const { NX, NZ, GX0, GZ0, CS, grid } = S;
    const foam = new Float32Array(NX * NZ);
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const x = GX0 + i * CS, z = GZ0 + j * CS, k = j * NX + i;
        foam[k] = Math.min(grid[k], islandDist(x, z) - ISL_WL);
      }
    }
    for (const r of boulders) { // ellipsoid cross-section at the waterline
      const t = (WATER_Y - r.y) / r.sy;
      if (Math.abs(t) >= 0.95) continue;
      const rad = Math.min(r.sx, r.sz) * 0.85 * Math.sqrt(1 - t * t);
      const i0 = Math.max(0, Math.floor((r.x - rad - 0.8 - GX0) / CS)), i1 = Math.min(NX - 1, Math.ceil((r.x + rad + 0.8 - GX0) / CS));
      const j0 = Math.max(0, Math.floor((r.z - rad - 0.8 - GZ0) / CS)), j1 = Math.min(NZ - 1, Math.ceil((r.z + rad + 0.8 - GZ0) / CS));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * NX + i;
        foam[k] = Math.min(foam[k], Math.hypot(GX0 + i * CS - r.x, GZ0 + j * CS - r.z) - rad);
      }
    }
    const data = new Uint16Array(NX * NZ * 4);
    const h = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i, x = GX0 + i * CS, z = GZ0 + j * CS;
        data[k * 4] = h(grid[k]); data[k * 4 + 1] = h(terrainHeight(x, z, grid[k])); data[k * 4 + 2] = h(foam[k]); data[k * 4 + 3] = h(1);
      }
    }
    const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    shared.uPwField.value = keep(tex);
    shared.uPwFieldXf.value.set(GX0 - CS / 2, GZ0 - CS / 2, 1 / (NX * CS), 1 / (NZ * CS));
  }

  // =========================================================================
  // TERRAIN: ground + bank + lagoon bed + islet mound, one heightfield
  // =========================================================================
  {
    const nx = 150, nz = Math.round((nx * (SB.z1 - SB.z0)) / (SB.x1 - SB.x0));
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), sh = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = SB.x0 + ((SB.x1 - SB.x0) * i) / nx, z = SB.z0 + ((SB.z1 - SB.z0) * j) / nz;
        const d = S.sdfAt(x, z), k = j * (nx + 1) + i;
        pos[k * 3] = x; pos[k * 3 + 1] = terrainHeight(x, z, d); pos[k * 3 + 2] = z;
        sh[k] = Math.min(d, islandDist(x, z) - ISL_WL);
      }
    }
    const idx = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aShoreD', new THREE.BufferAttribute(sh, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, dithering: true });
    patchStandard(mat, 'ground', { ...shared, uPwGrassTex: { value: keep(makeGrassTexture(rand, aniso)) }, uPwGravelTex: { value: keep(makeGravelTexture(rand, aniso)) } });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sea-terrain';
    mesh.receiveShadow = true;
    group.add(mesh);
    keep(geo); keep(mat);
  }

  // =========================================================================
  // STONE: deck-edge masonry wall, stairs, dry-stone boundary wall (one mesh)
  // =========================================================================
  {
    const geos = [];
    const wallCol = lin(0xb8ae9f), stairCol = lin(0xc4baab), dryCol = lin(0x9d968b);
    // coursed wall face under the deck edge, from y = 0 down into the bed
    const courses = [[-0.36, -0.01], [-0.74, -0.36], [-1.12, -0.74], [-1.5, -1.12], [BED_Y - 0.05, -1.5]];
    courses.forEach(([y0, y1], ci) => {
      const off = ci % 2 ? 0.35 : 0;
      for (const [a, b] of runs(-WALL_X - off, WALL_X, rand, 0.6, 0.55)) {
        const xa = Math.max(-WALL_X, a), xb = Math.min(WALL_X, b);
        if (xb - xa < 0.05) continue;
        geos.push(frontBlock(xa + 0.006, xb - 0.006, y0 + 0.006, y1 - 0.006, DECK_Z1, NORTH_Z + rand() * 0.018, 0.035, vary(wallCol, rand, 0.07, 0.02)));
      }
    });
    // stairs: N steps x 3 blocks, solid down to the bed, worn rounded edges
    const bw = (STAIR.x1 - STAIR.x0) / 3;
    for (let i = 0; i < ST.steps; i++) {
      const top = STEP_TOP(i), z0 = STEP_Z0(i), z1 = z0 + ST.depth, h = top - BED_Y;
      for (let b = 0; b < 3; b++) {
        const g = new RoundedBoxGeometry(bw - 0.012, h, ST.depth - 0.008, 2, 0.045);
        g.translate(STAIR.x0 + bw * (b + 0.5), BED_Y + h / 2, (z0 + z1) / 2);
        geos.push(prepColored(g, vary(stairCol, rand, 0.05), 0.12));
      }
    }
    // soft dry-stone boundary wall around the far edge
    const dryWall = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len, ang = Math.atan2(-dz, dx);
      [[0, 0.36], [0.33, 0.33], [0.62, 0.2]].forEach(([yo, hgt], row) => {
        for (const [a, b] of runs(row * 0.21, len, rand, 0.38 + row * 0.05, 0.42)) {
          const mid = (a + b) / 2, side = (rand() - 0.5) * 0.08;
          const lowSpot = vnoise2(mid * 0.3 + x0 * 0.7, z0 * 0.7); // the wall sags and dips along its length
          if (row === 2 && (rand() < 0.25 || lowSpot < 0.45)) continue; // ragged top
          if (row === 1 && lowSpot < 0.18) continue;
          const cx = x0 + dx * mid - dz * side, cz = z0 + dz * mid + dx * side;
          const ground = terrainHeight(cx, cz);
          const w = b - a - 0.035, dep = 0.58 - row * 0.12 + rand() * 0.06, hh = hgt * (0.85 + rand() * 0.3);
          const g = chamferBox(-w / 2, w / 2, row ? -0.02 : -0.25, hh, -dep / 2, dep / 2, 0.05 + rand() * 0.03, vary(dryCol, rand, 0.12, 0.03), { bottom: row > 0 });
          g.rotateY(ang + (rand() - 0.5) * 0.12);
          g.translate(cx, ground + yo, cz);
          geos.push(g);
        }
      });
    };
    const ex = SB.x1 - 1.0, ez = SB.z1 - 1.0, nz0 = SB.z0 + 0.45;
    dryWall(-ex, ez, ex, ez);
    dryWall(-ex, nz0, -ex, ez);
    dryWall(ex, nz0, ex, ez);
    dryWall(-ex, nz0, -12.8, nz0);
    dryWall(12.8, nz0, ex, nz0);
    const geo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mat = patchStandard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, dithering: true }), 'stone', shared);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sea-stone';
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    keep(geo); keep(mat);
  }

  // =========================================================================
  // WOOD: stair handrails, lantern posts + frames
  // =========================================================================
  {
    const geos = [];
    const woodCol = lin(0x8a5530), darkWood = lin(0x4a2c1a);
    const postTop = [RAIL_TOP[0] + 0.14, RAIL_TOP[1] + 0.12];
    const beam = (p0, p1, hw, hh, col) => {
      const len = p0.distanceTo(p1);
      const g = chamferBox(-hw, hw, -hh, hh, -len / 2, len / 2, Math.min(hw, hh) * 0.35, col, { bottom: true });
      g.rotateX(Math.atan2(p0.y - p1.y, p1.z - p0.z));
      g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
      geos.push(g);
    };
    const capPost = (x, z, top) => {
      const cap = new THREE.ConeGeometry(0.115, 0.07, 4, 1);
      cap.rotateY(Math.PI / 4); cap.translate(x, top + 0.035 + 0.012, z);
      geos.push(prepColored(cap, darkWood.clone().multiplyScalar(1.3)));
      geos.push(chamferBox(x - 0.085, x + 0.085, top - 0.002, top + 0.014, z - 0.085, z + 0.085, 0.006, darkWood.clone().multiplyScalar(1.3), { bottom: true }));
    };
    for (const x of RAIL_X) {
      const [pz0, pz1] = POST_Z;
      geos.push(chamferBox(x - 0.07, x + 0.07, -0.01, postTop[0], pz0 - 0.07, pz0 + 0.07, 0.015, vary(woodCol, rand, 0.05)));
      geos.push(chamferBox(x - 0.07, x + 0.07, BED_Y, postTop[1], pz1 - 0.07, pz1 + 0.07, 0.015, vary(woodCol, rand, 0.05)));
      capPost(x, pz0, postTop[0]); capPost(x, pz1, postTop[1]);
      const a = new THREE.Vector3(x, RAIL_TOP[0] - 0.035, pz0 - 0.02), b = new THREE.Vector3(x, RAIL_TOP[1] - 0.035, pz1 + 0.02);
      beam(a, b, 0.05, 0.035, vary(woodCol, rand, 0.04).multiplyScalar(1.05));
      beam(a.clone().setY(a.y - 0.26), b.clone().setY(b.y - 0.2), 0.032, 0.028, vary(woodCol, rand, 0.04).multiplyScalar(0.9));
    }
    // post lanterns
    for (const L of lanterns) {
      const { x, z } = L, yb = L.ground + 1.3, c = darkWood;
      geos.push(chamferBox(x - 0.065, x + 0.065, L.ground - 0.2, yb, z - 0.065, z + 0.065, 0.012, vary(woodCol, rand, 0.05).multiplyScalar(0.8)));
      geos.push(chamferBox(x - 0.19, x + 0.19, yb, yb + 0.04, z - 0.19, z + 0.19, 0.01, c, { bottom: true }));
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        geos.push(chamferBox(x + dx * 0.15 - 0.022, x + dx * 0.15 + 0.022, yb + 0.04, yb + 0.46, z + dz * 0.15 - 0.022, z + dz * 0.15 + 0.022, 0.006, c));
      }
      geos.push(chamferBox(x - 0.2, x + 0.2, yb + 0.44, yb + 0.48, z - 0.2, z + 0.2, 0.01, c, { bottom: true }));
      for (const yy of [yb + 0.17, yb + 0.31]) { // cross bars on each face of the paper shade
        geos.push(chamferBox(x - 0.15, x + 0.15, yy - 0.01, yy + 0.01, z - 0.145, z - 0.13, 0, c));
        geos.push(chamferBox(x - 0.15, x + 0.15, yy - 0.01, yy + 0.01, z + 0.13, z + 0.145, 0, c));
        geos.push(chamferBox(x - 0.145, x - 0.13, yy - 0.01, yy + 0.01, z - 0.15, z + 0.15, 0, c));
        geos.push(chamferBox(x + 0.13, x + 0.145, yy - 0.01, yy + 0.01, z - 0.15, z + 0.15, 0, c));
      }
      const roof = new THREE.ConeGeometry(0.27, 0.13, 4, 1);
      roof.rotateY(Math.PI / 4); roof.translate(x, yb + 0.48 + 0.065, z);
      geos.push(prepColored(roof, lin(0x3b3e44)));
    }
    const geo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mat = patchStandard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, dithering: true }), 'wood', shared);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sea-wood';
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    keep(geo); keep(mat);
  }

  // =========================================================================
  // LANTERN paper shades (HDR, picked up by bloom) + soft halos
  // =========================================================================
  {
    const geos = [];
    for (const L of lanterns) {
      const g = new THREE.BoxGeometry(0.27, 0.38, 0.27, 1, 4, 1).toNonIndexed();
      const p = g.attributes.position, cols = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const v = p.getY(k) / 0.38 + 0.5;
        const f = 0.55 + 0.45 * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.85);
        cols[k * 3] = f; cols[k * 3 + 1] = f * (0.85 + 0.15 * v); cols[k * 3 + 2] = f * (0.7 + 0.3 * v);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.deleteAttribute('uv');
      g.translate(L.x, L.y, L.z);
      geos.push(g);
    }
    const geo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mat = new THREE.MeshBasicMaterial({ color: rgb(3.0, 1.25, 0.4), vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sea-lantern-paper';
    group.add(mesh);
    keep(geo); keep(mat);

    const hp = new Float32Array(lanterns.length * 3);
    lanterns.forEach((L, i) => hp.set([L.x, L.y, L.z], i * 3));
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    const hm = new THREE.PointsMaterial({ map: keep(makeGlowTexture()), color: rgb(1.0, 0.5, 0.18), size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const halos = new THREE.Points(hg, hm);
    halos.name = 'sea-lantern-halos';
    halos.renderOrder = 3;
    group.add(halos);
    keep(hg); keep(hm);
  }

  // =========================================================================
  // WATER SURFACE (masked grid covering only the lagoon; edges tuck under the bank)
  // =========================================================================
  const glintArr = Array.from({ length: MAX_GLINTS }, () => new THREE.Vector4());
  const waterUniforms = {
    ...shared,
    uDeep: { value: lin(0x065264) },
    uShallow: { value: lin(0x2fbcc4) },
    uFoamCol: { value: lin(0xeaf7f4) },
    uSurfGlow: { value: rgb(0.05, 0.55, 0.42) },
    uSkyZen: { value: rgb(0.05, 0.06, 0.2) },
    uSkyMid: { value: rgb(0.3, 0.18, 0.46) },
    uSkyHor: { value: rgb(1.45, 0.66, 0.3) },
    uWallRefl: { value: rgb(0.16, 0.12, 0.13) },
    uSilhouette: { value: rgb(0.08, 0.06, 0.07) },
    uGlintCol: { value: lin(0xff9a3c) },
    uGlints: { value: glintArr },
    uGlintCount: { value: 0 },
    uDeepAlpha: { value: 0.42 },
    uShallowAlpha: { value: 0.16 },
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
  };
  // lamp glints on the water: our lanterns + courtyard lights (pass {x,y,z,intensity} or Vector3)
  const setGlintLights = (list = DEFAULT_GLINTS.map(([x, y, z]) => ({ x, y, z, intensity: 1 }))) => {
    const all = lanterns.map((L) => ({ x: L.x, y: L.y, z: L.z, intensity: 1 }));
    for (const l of list) all.push({ x: l.x, y: l.y, z: l.z, intensity: l.intensity ?? 1 });
    const n = Math.min(MAX_GLINTS, all.length);
    for (let i = 0; i < n; i++) glintArr[i].set(all[i].x, all[i].y, all[i].z, all[i].intensity);
    waterUniforms.uGlintCount.value = n;
  };
  setGlintLights();
  {
    const cs = 0.25;
    const x0 = S.minX - 0.8, z0 = DECK_Z1, nx = Math.ceil((S.maxX + 0.8 - x0) / cs), nz = Math.ceil((S.maxZ + 0.8 - z0) / cs);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), keepV = new Uint8Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * cs, z = z0 + j * cs, k = j * (nx + 1) + i;
        pos[k * 3] = x; pos[k * 3 + 1] = WATER_Y; pos[k * 3 + 2] = z;
        keepV[k] = S.sdfAt(x, z) > -0.7 && islandDist(x, z) > ISL_WL - 0.6 ? 1 : 0;
      }
    }
    const idx = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        if (keepV[a] | keepV[b] | keepV[c] | keepV[d]) idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: waterUniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, depthWrite: true, fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sea-water';
    mesh.renderOrder = 1;
    group.add(mesh);
    keep(geo); keep(mat);
  }

  // =========================================================================
  // GINKGO LEAVES: drifting on the water + a few resting on the bank
  // =========================================================================
  const leaves = [];
  let leafMesh;
  {
    const P = [], C = [], idx = [];
    const base = lin(0xd38f1c), rim = lin(0xf6c437);
    P.push(0, 0.0, 0); C.push(base.r, base.g, base.b);
    const NSEG = 12, spread = 1.05;
    for (let i = 0; i <= NSEG; i++) {
      const a = -spread + (2 * spread * i) / NSEG;
      let r = 1 - Math.exp(-Math.pow(a / 0.1, 2)) * 0.3;
      r *= 1 - 0.05 * Math.cos(a * 9);
      P.push(Math.sin(a) * r, 0.05 * Math.abs(a) + 0.03, Math.cos(a) * r);
      C.push(rim.r, rim.g, rim.b);
    }
    for (let i = 1; i <= NSEG; i++) idx.push(0, i, i + 1);
    const s0 = P.length / 3; // stem
    P.push(-0.025, 0.0, 0.02, 0.025, 0.0, 0.02, 0.012, -0.01, -0.36, -0.012, -0.01, -0.36);
    for (let k = 0; k < 4; k++) C.push(base.r * 0.8, base.g * 0.8, base.b * 0.8);
    idx.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
    leafMesh = new THREE.InstancedMesh(geo, mat, FLOAT_LEAVES + GROUND_LEAVES);
    leafMesh.name = 'sea-leaves';
    leafMesh.frustumCulled = false;
    leafMesh.receiveShadow = true;
    const tint = new THREE.Color();
    for (let i = 0; i < FLOAT_LEAVES + GROUND_LEAVES; i++) {
      tint.setHSL(0.11 + (rand() - 0.5) * 0.04, 0.9, 0.5 + (rand() - 0.5) * 0.12);
      leafMesh.setColorAt(i, tint.multiplyScalar(1.8));
    }
    for (let i = 0; i < FLOAT_LEAVES; i++) {
      let x, z, tries = 0;
      do {
        x = S.minX + rand() * (S.maxX - S.minX); z = S.minZ + rand() * (S.maxZ - S.minZ);
      } while ((!insideSea(x, z, 0.8) || (x > STAIR.x0 - 0.5 && x < STAIR.x1 + 0.5 && z < STAIR.z1 + 0.6)) && ++tries < 200);
      leaves.push({ x, z, px: x, pz: z, vx: 0, vz: 0, rot: rand() * Math.PI * 2, spin: (rand() - 0.5) * 0.15, ph: rand() * 10, sc: 0.13 + rand() * 0.05 });
    }
    const dummy = new THREE.Object3D();
    for (let k = 0; k < GROUND_LEAVES; k++) {
      const p = shoreAt(rand() * shoreLen), off = 0.5 + rand() * 2.5;
      const x = p.x + p.nx * off, z = p.z + p.nz * off;
      dummy.position.set(x, terrainHeight(x, z) + 0.012, z);
      dummy.rotation.set((rand() - 0.5) * 0.15, rand() * Math.PI * 2, (rand() - 0.5) * 0.15);
      dummy.scale.setScalar(0.12 + rand() * 0.05);
      dummy.updateMatrix();
      leafMesh.setMatrixAt(FLOAT_LEAVES + k, dummy.matrix);
    }
    group.add(leafMesh);
    keep(geo); keep(mat);
  }

  // =========================================================================
  // SPLASH VFX: droplets (Points) + crown (instanced open cylinder); pooled
  // =========================================================================
  const NDROP = DROP_SLOTS * DROPS_PER_SLOT;
  const dropPos = new Float32Array(NDROP * 3), dropVel = new Float32Array(NDROP * 3), dropInfo = new Float32Array(NDROP * 2);
  for (let i = 0; i < NDROP; i++) dropInfo[i * 2] = -1e4;
  const dropGeo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(dropPos, 3).setUsage(THREE.DynamicDrawUsage);
  const aVel = new THREE.BufferAttribute(dropVel, 3).setUsage(THREE.DynamicDrawUsage);
  const aInfo = new THREE.BufferAttribute(dropInfo, 2).setUsage(THREE.DynamicDrawUsage);
  dropGeo.setAttribute('position', aPos); dropGeo.setAttribute('aVel', aVel); dropGeo.setAttribute('aInfo', aInfo);
  const dropMat = new THREE.ShaderMaterial({
    uniforms: { uPwTime: shared.uPwTime, uPxH: { value: 800 } },
    vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.name = 'sea-splash-drops';
  drops.frustumCulled = false; drops.renderOrder = 2; drops.visible = false;
  group.add(drops);
  keep(dropGeo); keep(dropMat);

  const crownBase = new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 4, true);
  const crownGeo = new THREE.InstancedBufferGeometry();
  crownGeo.index = crownBase.index;
  crownGeo.setAttribute('position', crownBase.attributes.position);
  const crownData = new Float32Array(CROWN_SLOTS * 4);
  for (let i = 0; i < CROWN_SLOTS; i++) crownData[i * 4 + 2] = -1e4;
  const aCrown = new THREE.InstancedBufferAttribute(crownData, 4).setUsage(THREE.DynamicDrawUsage);
  crownGeo.setAttribute('aData', aCrown);
  crownGeo.instanceCount = CROWN_SLOTS;
  const crownMat = new THREE.ShaderMaterial({
    uniforms: { uPwTime: shared.uPwTime }, vertexShader: CROWN_VERT, fragmentShader: CROWN_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const crown = new THREE.Mesh(crownGeo, crownMat);
  crown.name = 'sea-splash-crown';
  crown.frustumCulled = false; crown.renderOrder = 2; crown.visible = false;
  group.add(crown);
  keep(crownBase); keep(crownGeo); keep(crownMat);

  scene.add(group);

  // =========================================================================
  // CPU mirrors + runtime
  // =========================================================================
  let now = 0;
  let dropSlot = 0, crownSlot = 0;
  let lastActive = -1e4;
  const bufSize = new THREE.Vector2();

  function ringHeight(x, z, t) {
    let h = 0;
    for (const r of rings) {
      const age = t - r.t0;
      if (age < 0 || age > RING.life || r.s <= 0) continue;
      const d = Math.hypot(x - r.x, z - r.z) + 1e-4;
      const fall = Math.exp(-age * RING.decay) * r.s * RING.amp;
      const R1 = 0.2 + RING.speed * age, w1 = 0.18 + 0.22 * age, u1 = d - R1;
      h += Math.exp(-(u1 * u1) / (w1 * w1)) * fall * Math.cos(RING.k * u1);
      const R2 = 0.1 + RING.speed * 0.55 * age, w2 = 0.14 + 0.16 * age, u2 = d - R2;
      h += Math.exp(-(u2 * u2) / (w2 * w2)) * fall * 0.6 * Math.exp(-age * 0.4) * Math.cos(RING.k * 1.35 * u2);
    }
    return h;
  }
  // animated water height at (x, z) — identical to the rendered vertex displacement
  const surfDamp = (x, z) => {
    let d = Math.min(S.sdfAt(x, z), islandDist(x, z) - ISL_WL);
    const qx = Math.abs(x - (STAIR.x0 + STAIR.x1) / 2) - ((STAIR.x1 - STAIR.x0) / 2 + 0.4), qz = Math.abs(z - (STAIR.z0 + STAIR.z1) / 2) - ((STAIR.z1 - STAIR.z0) / 2 + 0.4);
    d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
    const k = Math.min(1, Math.max(0, (d - 0.3) / 2.9)); return k * k * (3 - 2 * k);
  };
  function surfHeight(x, z, t) {
    const surf = shared.uPwSurf.value; if (surf < 0.001) return 0;
    let h = 0; for (const w of SURF) h += w.amp * (swell((x * w.dx + z * w.dz) * w.k - t * w.om + w.ph, w.skew) - w.bias);
    return h * surf * surfDamp(x, z);
  }
  function surfaceHeight(x, z, t = now) {
    let h = WATER_Y;
    for (const w of WAVES) h += w.amp * Math.sin((x * w.dx + z * w.dz) * w.k - t * w.om + w.ph);
    return h + ringHeight(x, z, t) + surfHeight(x, z, t);
  }

  function splash(x, z, strength = 1) {
    const s = Math.max(0.05, Math.min(1.6, strength));
    let best = 0, bestE = Infinity; // ring slot: reuse the weakest / expired one
    rings.forEach((r, i) => {
      const age = now - r.t0;
      const e = age > RING.life ? -1 : r.s * Math.exp(-age * RING.decay);
      if (e < bestE) { bestE = e; best = i; }
    });
    Object.assign(rings[best], { x, z, t0: now, s });
    shared.uPwRings.value[best].set(x, z, now, s);
    if (s >= 0.45) { // crown sheet only for real jumps
      const i = crownSlot; crownSlot = (crownSlot + 1) % CROWN_SLOTS;
      crownData.set([x, z, now, Math.min(s, 1.3)], i * 4);
      aCrown.needsUpdate = true;
    }
    const slot = dropSlot; dropSlot = (dropSlot + 1) % DROP_SLOTS;
    const n = Math.round(DROPS_PER_SLOT * Math.min(1, 0.2 + s * 0.8));
    for (let k = 0; k < DROPS_PER_SLOT; k++) {
      const i = slot * DROPS_PER_SLOT + k;
      if (k >= n) { dropInfo[i * 2] = -1e4; continue; }
      const a = Math.random() * Math.PI * 2, rr = Math.random();
      const r0 = (0.1 + rr * 0.3) * (0.6 + 0.4 * s);
      dropPos[i * 3] = x + Math.cos(a) * r0; dropPos[i * 3 + 1] = WATER_Y + 0.02; dropPos[i * 3 + 2] = z + Math.sin(a) * r0;
      const up = (1.6 + Math.random() * 2.6) * (0.45 + 0.55 * s) * (1.15 - rr * 0.4);
      const out = (0.4 + Math.random() * 1.5) * (0.5 + 0.5 * s);
      dropVel[i * 3] = Math.cos(a) * out; dropVel[i * 3 + 1] = up; dropVel[i * 3 + 2] = Math.sin(a) * out;
      dropInfo[i * 2] = now + Math.random() * 0.08 * s;
      dropInfo[i * 2 + 1] = (0.035 + Math.random() * 0.06) * (0.7 + 0.3 * s);
    }
    aPos.needsUpdate = aVel.needsUpdate = aInfo.needsUpdate = true;
    for (const L of leaves) { // shove nearby leaves
      const dx = L.x - x, dz = L.z - z, d = Math.hypot(dx, dz) + 1e-3;
      if (d < 4.5) {
        const p = s * 0.9 * (1 - d / 4.5);
        L.vx += (dx / d) * p; L.vz += (dz / d) * p; L.spin += (Math.random() - 0.5) * p * 2;
      }
    }
    lastActive = now;
  }

  const dummy = new THREE.Object3D();
  function updateLeaves(t, dt) {
    for (let i = 0; i < leaves.length; i++) {
      const L = leaves[i];
      const cx = 0.035 * Math.sin(0.23 * L.z + t * 0.11 + L.ph) + 0.012;
      const cz = 0.03 * Math.cos(0.19 * L.x + t * 0.09 + L.ph * 0.7);
      const k = Math.min(1, dt * 0.45);
      L.vx += (cx - L.vx) * k; L.vz += (cz - L.vz) * k;
      L.spin *= 1 - Math.min(1, dt * 0.3);
      const nx = L.x + L.vx * dt, nz = L.z + L.vz * dt;
      const blocked = !insideSea(nx, nz, 0.3) || (nx > STAIR.x0 - 0.15 && nx < STAIR.x1 + 0.15 && nz < ST.z0 + ST.depth + 0.15)
        || RAIL_X.some((px) => Math.hypot(nx - px, nz - POST_Z[1]) < 0.22);
      if (blocked) { L.vx *= -0.5; L.vz *= -0.5; } else { L.x = nx; L.z = nz; }
      L.rot += L.spin * dt;
      const y = surfaceHeight(L.x, L.z, t);
      const gx = (surfaceHeight(L.x + 0.12, L.z, t) - y) / 0.12, gz = (surfaceHeight(L.x, L.z + 0.12, t) - y) / 0.12;
      dummy.position.set(L.x, y + 0.006, L.z);
      dummy.rotation.set(gz * 1.2, L.rot, -gx * 1.2, 'YXZ');
      dummy.scale.setScalar(L.sc);
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i, dummy.matrix);
    }
    leafMesh.instanceMatrix.needsUpdate = true;
  }

  // spray torn off the breaking lip: a few drops thrown forward with the swell
  let sprayT = 0;
  function spray(t, dt) {
    if (shared.uPwSurf.value < 0.5 || (sprayT -= dt) > 0) return;
    sprayT = 0.12;
    const w = SURF[0];
    for (let tries = 0; tries < 8; tries++) {
      const x = S.minX + Math.random() * (S.maxX - S.minX), z = S.minZ + Math.random() * (S.maxZ - S.minZ);
      if (!insideSea(x, z, 1)) continue;
      const m = surfMain(x, z, t), damp = surfDamp(x, z);
      if (m.hn < 0.7 || m.c > -0.05 || damp < 0.6) continue;
      const slot = dropSlot; dropSlot = (dropSlot + 1) % DROP_SLOTS;
      const y = surfaceHeight(x, z, t), px = -w.dz, pz = w.dx; // along the crest
      for (let k = 0; k < DROPS_PER_SLOT; k++) {
        const i = slot * DROPS_PER_SLOT + k;
        if (k >= 22) { dropInfo[i * 2] = -1e4; continue; }
        const s = (Math.random() - 0.5) * 2.2, fw = w.spd * (0.5 + Math.random() * 0.5);
        dropPos[i * 3] = x + px * s; dropPos[i * 3 + 1] = y + 0.05; dropPos[i * 3 + 2] = z + pz * s;
        dropVel[i * 3] = w.dx * fw + (Math.random() - 0.5) * 0.6; dropVel[i * 3 + 1] = 1.2 + Math.random() * 2.2; dropVel[i * 3 + 2] = w.dz * fw + (Math.random() - 0.5) * 0.6;
        dropInfo[i * 2] = t + Math.random() * 0.1;
        dropInfo[i * 2 + 1] = 0.03 + Math.random() * 0.05;
      }
      aPos.needsUpdate = aVel.needsUpdate = aInfo.needsUpdate = true;
      lastActive = t;
      return;
    }
  }

  function update(t, dt = 1 / 60) {
    now = t;
    shared.uPwTime.value = t;
    updateLeaves(t, Math.min(dt, 0.1));
    spray(t, Math.min(dt, 0.1));
    const active = t - lastActive < 2.5;
    drops.visible = active; crown.visible = active;
    if (active && renderer) {
      renderer.getDrawingBufferSize(bufSize);
      dropMat.uniforms.uPxH.value = bufSize.y * 0.5;
    }
  }

  function dispose() {
    scene.remove(group);
    disposables.forEach((d) => d.dispose && d.dispose());
  }

  const setSurf = (v) => { shared.uPwSurf.value = Math.max(0, Math.min(1, v)); };
  return { update, splash, surfaceHeight, setSurf, get surf() { return shared.uPwSurf.value; }, surfDir: { x: SURF[0].dx, z: SURF[0].dz }, setGlintLights, insideSea, groundHeight, group, dispose };
}
