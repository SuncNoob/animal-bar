// Animal Bar · procedural vegetation (all positions from src/layout.js)
// Hero ginkgo + second ginkgo + leaning islet ginkgo, neighbours' trees and a tree/bamboo ring around the lagoon,
// fallen / falling / floating ginkgo leaves, potted plants, ivy on the north & west walls, hanging greenery,
// lagoon shore reeds / pampas / flowering shrubs and lily pads.
//
//   createPlants({ scene, renderer }) → { update(t, dt), colliders: [{x, z, r}], leafBurst(x, y, z, count?),
//                                          setViewFocus(distance, radius?), group, dispose, stats }
//
// Everything is generated (no texture files). All foliage is instanced; 10 meshes (+6 shadow passes) total.

import * as THREE from 'three';
import { LAYOUT as L } from '../layout.js';

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ world layout (metres) — all from src/layout.js
const WALL_N = L.walls.northZ + L.walls.thick / 2;   // inner faces
const WALL_W = L.walls.westX + L.walls.thick / 2;
const WALL_E = L.walls.eastX - L.walls.thick / 2;
const WALL_H = L.walls.height;
const WALL_S = L.deck.z1;                             // side walls run to the end of the deck
const HERO = { x: L.trees.hero[0], z: L.trees.hero[1] };
const SMALL = { x: L.trees.second[0], z: L.trees.second[1] };
const STEP0 = { x0: L.stairs.x0, x1: L.stairs.x1, z0: L.stairs.z0, z1: L.stairs.z0 + L.stairs.depth, y: L.stairs.topY };
const BAR = { x0: L.bar.x0, x1: L.bar.x1, z0: L.bar.z0, z1: L.bar.z1, y: L.bar.top };
const TABLES = L.tables;
const TABLE_R = L.tableR;
const LOUNGE = { x0: WALL_W, x1: L.lounge.x + 0.42, z0: L.lounge.z0, z1: L.lounge.z1 };
const ARENA = L.arena;
const SIGN = { x0: L.keepOut.signX[0], x1: L.keepOut.signX[1], y0: L.keepOut.signY[0], y1: L.keepOut.signY[1] };
const DOOR = { z0: L.keepOut.doorZ[0], z1: L.keepOut.doorZ[1] };
const SUN_DIR = V3(-12, 16, 8).normalize();

// ------------------------------------------------------------------ small math helpers
function makeRng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.sign = () => (f() < 0.5 ? -1 : 1);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.gauss = () => (f() + f() + f() + f() - 2) * 1.732;
  f.unit = (v = V3()) => {
    const z = f() * 2 - 1, t = f() * TAU, r = Math.sqrt(1 - z * z);
    return v.set(r * Math.cos(t), z, r * Math.sin(t));
  };
  f.weighted = (list) => { // [[value, weight], ...]
    let s = 0; for (const e of list) s += e[1];
    let x = f() * s; for (const e of list) { x -= e[1]; if (x <= 0) return e[0]; }
    return list[list.length - 1][0];
  };
  return f;
}
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const col = (hex) => new THREE.Color(hex);
function jitterColor(c, rng, dh = 0.012, ds = 0.06, dl = 0.05) {
  const hsl = {}; c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h + rng.range(-dh, dh), clamp(hsl.s + rng.range(-ds, ds), 0, 1), clamp(hsl.l + rng.range(-dl, dl), 0, 1));
}

// ------------------------------------------------------------------ canvas textures
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, { srgb = true, aniso = 4, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Ginkgo leaf outline (unit fan radius R=1). Leaf local frame: petiole from origin along +Y,
// blade fans out around B=(0,P), face normal +Z.
const GK = { P: 0.42, TH: 1.12 };
GK.L = GK.P + 1.0;
GK.W = 2 * Math.sin(GK.TH) * 1.02;
function gkRadius(th) {
  const a = Math.abs(th) / GK.TH;
  const notch = 0.3 * Math.exp(-((th / 0.1) ** 2));
  const round = 1 - 0.34 * a ** 4;
  const wave = 1 + 0.03 * Math.sin(th * 13 + 0.5);
  return (1 - notch) * round * wave;
}

function makeGinkgoTexture(aniso) {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
  const toC = (lx, ly) => [(lx / GK.W + 0.5) * S, (1 - ly / GK.L) * S];
  g.fillStyle = '#efe6cc'; g.fillRect(0, 0, S, S);
  const path = new Path2D();
  const [bx, by] = toC(0, GK.P);
  path.moveTo(bx, by);
  for (let i = 0; i <= 120; i++) {
    const th = -GK.TH + (2 * GK.TH * i) / 120, r = gkRadius(th);
    const [x, y] = toC(Math.sin(th) * r, GK.P + Math.cos(th) * r);
    path.lineTo(x, y);
  }
  path.closePath();
  const grad = g.createRadialGradient(bx, by, 0, bx, by, S * 0.62);
  grad.addColorStop(0, '#e4ecb4');
  grad.addColorStop(0.22, '#f7f4d6');
  grad.addColorStop(0.7, '#fffaea');
  grad.addColorStop(1, '#f6e2b2');
  g.fillStyle = grad; g.fill(path);
  g.save(); g.clip(path);
  // dichotomous radiating veins
  g.strokeStyle = 'rgba(125,95,40,0.17)'; g.lineWidth = 1.1;
  const nV = 20;
  for (let i = 0; i < nV; i++) {
    const th = (-1 + (2 * (i + 0.5)) / nV) * GK.TH;
    const r1 = gkRadius(th) * 0.42;
    const [x1, y1] = toC(Math.sin(th) * r1, GK.P + Math.cos(th) * r1);
    g.beginPath(); g.moveTo(bx, by); g.lineTo(x1, y1);
    for (const da of [-0.27, 0.27]) {
      const th2 = th + da * ((2 * GK.TH) / nV);
      const r2 = gkRadius(th2) * 1.03;
      const [x2, y2] = toC(Math.sin(th2) * r2, GK.P + Math.cos(th2) * r2);
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    g.stroke();
  }
  // soft blotches (aging)
  for (let i = 0; i < 26; i++) {
    const th = (Math.random() * 2 - 1) * GK.TH, r = 0.3 + Math.random() * 0.65;
    const [x, y] = toC(Math.sin(th) * r, GK.P + Math.cos(th) * r);
    g.fillStyle = `rgba(${170 + Math.random() * 40 | 0},${120 + Math.random() * 40 | 0},50,${0.04 + Math.random() * 0.05})`;
    g.beginPath(); g.arc(x, y, 3 + Math.random() * 9, 0, TAU); g.fill();
  }
  // darker margin gives each fan a readable silhouette inside dense clumps
  g.lineWidth = 9; g.strokeStyle = 'rgba(160,100,30,0.22)'; g.stroke(path);
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(115,70,20,0.38)'; g.stroke(path);
  g.restore();
  // petiole
  const [px0, py0] = toC(0, 0), [px1, py1] = toC(0, GK.P + 0.05);
  g.strokeStyle = '#c9b77a'; g.lineWidth = 7; g.beginPath(); g.moveTo(px0, py0); g.lineTo(px1, py1); g.stroke();
  return canvasTex(c, { aniso });
}

function makeBarkTextures(rng, aniso) {
  const W = 256, H = 512;
  const cc = makeCanvas(W, H), cg = cc.getContext('2d');
  const hc = makeCanvas(W, H), hg = hc.getContext('2d');
  cg.fillStyle = '#7a6656'; cg.fillRect(0, 0, W, H);
  hg.fillStyle = '#7a7a7a'; hg.fillRect(0, 0, W, H);
  const wrapDraw = (fn) => { for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) fn(dx, dy); };
  // mottled base
  for (let i = 0; i < 260; i++) {
    const x = rng() * W, y = rng() * H, r = rng.range(5, 26), s = rng.range(-22, 22);
    const fill = `rgba(${122 + s | 0},${104 + s * 0.9 | 0},${88 + s * 0.8 | 0},0.28)`;
    wrapDraw((dx, dy) => { cg.fillStyle = fill; cg.beginPath(); cg.ellipse(x + dx, y + dy, r * 0.6, r * 1.6, 0, 0, TAU); cg.fill(); });
  }
  // vertical plates & fissures
  for (let i = 0; i < 95; i++) {
    const x0 = rng() * W, y0 = rng() * H, len = rng.range(50, 300), w = rng.range(1.5, 6.5), ph = rng() * TAU, amp = rng.range(2, 7);
    const pts = [];
    for (let y = 0; y <= len; y += 6) pts.push([x0 + Math.sin(y * 0.028 + ph) * amp + y * rng.range(-0.02, 0.02), y0 + y]);
    const stroke = (g, style, lw, ox) => wrapDraw((dx, dy) => {
      g.strokeStyle = style; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(x + dx + ox, y + dy) : g.moveTo(x + dx + ox, y + dy)));
      g.stroke();
    });
    stroke(cg, 'rgba(48,36,29,0.78)', w, 0);
    stroke(hg, 'rgba(10,10,10,0.9)', w * 1.4, 0);
    stroke(cg, 'rgba(176,156,134,0.30)', w * 0.9, w * 1.1);
    stroke(hg, 'rgba(220,220,220,0.45)', w * 1.6, w * 1.3);
  }
  // horizontal lenticel cracks + lichen dots
  for (let i = 0; i < 90; i++) {
    const x = rng() * W, y = rng() * H, l = rng.range(3, 10);
    wrapDraw((dx, dy) => { cg.strokeStyle = 'rgba(60,45,36,0.5)'; cg.lineWidth = 1.2; cg.beginPath(); cg.moveTo(x + dx, y + dy); cg.lineTo(x + dx + l, y + dy + rng.range(-1, 1)); cg.stroke(); });
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * W, y = rng() * H, r = rng.range(2, 7);
    const lichen = rng() < 0.5 ? 'rgba(150,160,120,0.30)' : 'rgba(190,185,160,0.25)';
    wrapDraw((dx, dy) => { cg.fillStyle = lichen; cg.beginPath(); cg.arc(x + dx, y + dy, r, 0, TAU); cg.fill(); });
  }
  // fine grain
  const id = cg.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rng() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  cg.putImageData(id, 0, 0);
  // normal map from the height canvas
  const hb = makeCanvas(W, H), hbg = hb.getContext('2d');
  hbg.filter = 'blur(1.2px)'; hbg.drawImage(hc, 0, 0);
  const hd = hbg.getImageData(0, 0, W, H).data;
  const nc = makeCanvas(W, H), ng = nc.getContext('2d'), nid = ng.createImageData(W, H), nd = nid.data;
  const h = (x, y) => hd[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  const k = 3.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = -(h(x + 1, y) - h(x - 1, y)) * k, ny = (h(x, y + 1) - h(x, y - 1)) * k;
    const l = Math.hypot(nx, ny, 1), o = (y * W + x) * 4;
    nd[o] = (nx / l * 0.5 + 0.5) * 255; nd[o + 1] = (ny / l * 0.5 + 0.5) * 255; nd[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd[o + 3] = 255;
  }
  ng.putImageData(nid, 0, 0);
  return { map: canvasTex(cc, { aniso, repeat: true }), normal: canvasTex(nc, { srgb: false, aniso, repeat: true }) };
}

function makePotTexture(rng, aniso) {
  const W = 256, H = 128, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f2efe9'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 1) { // wheel-thrown rings
    const a = 0.03 + 0.05 * Math.abs(Math.sin(y * 0.9 + Math.sin(y * 0.13) * 3));
    g.fillStyle = `rgba(90,70,60,${a.toFixed(3)})`; g.fillRect(0, y, W, 1);
  }
  for (let i = 0; i < 900; i++) {
    const v = rng() < 0.5 ? 255 : 60;
    g.fillStyle = `rgba(${v},${v},${v},${rng.range(0.04, 0.14).toFixed(3)})`;
    g.fillRect(rng() * W, rng() * H, rng.range(1, 2.5), rng.range(1, 2.5));
  }
  for (let i = 0; i < 26; i++) { // soft vertical stains / glaze runs
    const x = rng() * W, w = rng.range(3, 12), l = rng.range(10, 60);
    const gr = g.createLinearGradient(0, 0, 0, l);
    gr.addColorStop(0, 'rgba(70,55,45,0.12)'); gr.addColorStop(1, 'rgba(70,55,45,0)');
    g.fillStyle = gr; g.fillRect(x, 0, w, l);
  }
  return canvasTex(c, { aniso, repeat: true });
}

// ------------------------------------------------------------------ foliage shader patch
const WIND_PARS = /* glsl */`
uniform float uTime;
uniform float uShake;
float wHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 windSway(vec3 p, float amp, float baseY) {
  float h = clamp((p.y - baseY) * 0.28, 0.0, 1.6);
  float w = sin(uTime * 0.85 + p.x * 0.32 + p.z * 0.21) + 0.45 * sin(uTime * 1.93 + p.x * 0.9 - p.z * 0.7);
  return vec3(1.0, 0.16, 0.5) * w * amp * h;
}
`;
function windChunks(o) {
  const f = (x) => x.toFixed(4);
  const prelude = /* glsl */`
#ifdef USE_INSTANCING
  vec3 wIP = instanceMatrix[3].xyz;
#else
  vec3 wIP = vec3(0.0);
#endif
  float wH = wHash(wIP);
  float wGust = 0.62 + 0.38 * sin(uTime * 0.29 + 1.7) * sin(uTime * 0.13 + 0.4);
  float wShake = 1.0 + uShake * 4.0;
  float wA = sin(uTime * (1.7 + wH * 1.9) + wH * 40.0) * ${f(o.flutter)} * wGust * wShake;
  float wB = sin(uTime * (1.2 + wH * 1.1) + wH * 17.0) * ${f(o.flutter * 0.6)} * wGust * wShake;
  mat2 wRa = mat2(cos(wA), sin(wA), -sin(wA), cos(wA));
  mat2 wRb = mat2(cos(wB), sin(wB), -sin(wB), cos(wB));
`;
  const pos = /* glsl */`
  transformed.xz = wRa * transformed.xz;
  transformed.yz = wRb * transformed.yz;
  ${o.bend ? `float wY2 = transformed.y * transformed.y;
  transformed.x += ${f(o.bend)} * wY2 * sin(uTime * 1.6 + wH * 30.0) * wGust * wShake;
  transformed.z += ${f(o.bend * 0.6)} * wY2 * sin(uTime * 1.15 + wH * 11.0) * wGust;` : ''}
`;
  const nrm = /* glsl */`
  objectNormal.xz = wRa * objectNormal.xz;
  objectNormal.yz = wRb * objectNormal.yz;
`;
  const proj = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  mvPosition.xyz += windSway(wIP, ${f(o.sway)} * wShake, ${f(o.swayBase)}) * wGust;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;
  return { prelude, pos, nrm, proj };
}

function patchFoliage(mat, o, uniforms) {
  const opt = { sway: 0, swayBase: 0, flutter: 0, bend: 0, translucency: 0, glow: 0, nearFade: null, wind: true, ...o };
  const w = windChunks(opt);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uShake = uniforms.uShake;
    let vs = shader.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_PARS);
    if (opt.wind) {
      vs = vs
        .replace('#include <beginnormal_vertex>', w.prelude + '\n#include <beginnormal_vertex>\n' + w.nrm)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + w.pos)
        .replace('#include <project_vertex>', w.proj);
    }
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    if (opt.nearFade) {
      shader.uniforms.uFocus = uniforms.uFocus;
      fs = fs.replace('#include <common>', '#include <common>\n' + NEAR_FADE_PARS)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + NEAR_FADE_GLSL(opt.nearFade[0], opt.nearFade[1]));
    }
    if (opt.glow) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * ${opt.glow.toFixed(3)};`);
    if (opt.translucency) {
      fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  {
    vec3 tL = directionalLights[ 0 ].direction;
    vec3 tV = normalize( vViewPosition );
    float tBack = max( dot( -normal, tL ), 0.0 );
    float tScatter = pow( max( dot( -tV, tL ), 0.0 ), 3.0 );
    reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * ( tBack * 0.45 + tScatter * 0.75 ) * ${opt.translucency.toFixed(3)};
  }
#endif`);
    }
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'tiaohai-foliage-' + JSON.stringify(opt);
  return mat;
}
// Screen-door fade so a third-person camera never gets buried in foliage:
//  - anything closer than a..b metres to the camera fades out;
//  - an "x-ray tunnel" of radius uFocus.y around the view axis, in front of the focus distance uFocus.x
//    (the camera looks at the player, so this clears the line of sight to them).
const NEAR_FADE_PARS = 'uniform vec2 uFocus;\n';
const NEAR_FADE_GLSL = (a, b) => `
  {
    vec3 nfP = -vViewPosition;
    float nfKeep = smoothstep(${a.toFixed(3)}, ${b.toFixed(3)}, length(nfP));
    if (uFocus.x > 0.0) {
      float nfR = length(nfP.xy), nfDepth = -nfP.z;
      nfKeep *= 1.0 - (1.0 - smoothstep(uFocus.y * 0.55, uFocus.y, nfR)) * (1.0 - smoothstep(uFocus.x - 2.6, uFocus.x - 1.1, nfDepth));
    }
    float nfN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (nfKeep < nfN) discard;
  }`;
function addNearFade(mat, a, b, uniforms) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFocus = uniforms.uFocus;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NEAR_FADE_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + NEAR_FADE_GLSL(a, b));
  };
  mat.customProgramCacheKey = () => `tiaohai-nearfade-${a}-${b}`;
  return mat;
}
function makeWindDepthMaterial(o, uniforms) {
  const opt = { sway: 0, swayBase: 0, flutter: 0, bend: 0, ...o };
  const w = windChunks(opt);
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uShake = uniforms.uShake;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_PARS)
      .replace('#include <begin_vertex>', w.prelude + '\n#include <begin_vertex>\n' + w.pos)
      .replace('#include <project_vertex>', w.proj);
  };
  m.customProgramCacheKey = () => 'tiaohai-depth-' + JSON.stringify(opt);
  return m;
}

// ------------------------------------------------------------------ geometry builders
// One big merged mesh for every woody tube (trunks, branches, roots, vine stems).
class TubeBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  tube(pts, radii, o = {}) {
    const { radial = 8, color = [1, 1, 1], colorFn = null, gnarl = null, texelM = 0.85 } = o;
    const n = pts.length;
    const T = pts.map((p, i) => pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize());
    const N = V3().copy(Math.abs(T[0].y) < 0.9 ? UP : V3(1, 0, 0)).cross(T[0]).normalize();
    const B = V3(), axis = V3(), dir = V3();
    const N0 = N.clone(), B0 = V3().crossVectors(T[0], N).normalize();
    const circ0 = TAU * Math.max(radii[0], 0.004);
    const uRep = Math.max(1, Math.round(circ0 / texelM));
    const vScale = uRep / (2 * circ0);
    const base = this.p.length / 3;
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        s += pts[i].distanceTo(pts[i - 1]);
        axis.crossVectors(T[i - 1], T[i]);
        const l = axis.length();
        if (l > 1e-6) N.applyAxisAngle(axis.divideScalar(l), Math.atan2(l, T[i - 1].dot(T[i])));
        N.addScaledVector(T[i], -N.dot(T[i])).normalize();
      }
      B.crossVectors(T[i], N).normalize();
      const t = n > 1 ? i / (n - 1) : 0;
      const cc = colorFn ? colorFn(pts[i], t) : color;
      for (let j = 0; j <= radial; j++) {
        const phi = (j / radial) * TAU;
        dir.copy(N).multiplyScalar(Math.cos(phi)).addScaledVector(B, Math.sin(phi));
        const r = radii[i] * (gnarl ? gnarl(phi, s, t, pts[i]) : 1);
        this.p.push(pts[i].x + dir.x * r, pts[i].y + dir.y * r, pts[i].z + dir.z * r);
        this.n.push(dir.x, dir.y, dir.z);
        this.uv.push((j / radial) * uRep, s * vScale);
        this.c.push(cc[0], cc[1], cc[2]);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, b = a + radial + 1;
      this.i.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return { N0, B0 };
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// Collects instance transforms + colors; turns into one InstancedMesh.
class InstSet {
  constructor() { this.m = []; this.c = []; }
  add(m4, color) { const e = m4.elements; for (let i = 0; i < 16; i++) this.m.push(e[i]); this.c.push(color.r, color.g, color.b); }
  get count() { return this.c.length / 3; }
  mesh(geo, mat, { cast = true, receive = true, name = '' } = {}) {
    const n = this.count;
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.array.set(this.m);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
    im.castShadow = cast; im.receiveShadow = receive; im.name = name;
    im.computeBoundingSphere();
    if (im.boundingSphere) im.boundingSphere.radius += 0.6;
    im.matrixAutoUpdate = false; im.updateMatrix();
    return im;
  }
}

const _m4 = new THREE.Matrix4(), _bx = V3(), _by = V3(), _bz = V3();
// Instance matrix whose local +Y points along A (petiole → tip) and local +Z along N (face normal).
function basisMatrix(pos, A, N, sx, sy = sx, sz = sx) {
  _by.copy(A).normalize();
  _bz.copy(N).addScaledVector(_by, -N.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.set(_by.y, -_by.x, 0.3);
  _bz.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _m4.makeBasis(_bx.multiplyScalar(sx), _by.multiplyScalar(sy), _bz.multiplyScalar(sz));
  _m4.setPosition(pos);
  return _m4;
}

// Fan-shaped ginkgo leaf. `angles` in [-1,1] (×TH), rings = radial fractions (outermost = 1).
function ginkgoGeometry({ angles, rings, cup, curl, petW = 0.06, lowPetiole = false }) {
  const pos = [], uv = [], idx = [];
  const add = (x, y, z) => { pos.push(x, y, z); uv.push(x / GK.W + 0.5, y / GK.L); return pos.length / 3 - 1; };
  if (lowPetiole) { // single sliver triangle
    const p0 = add(0, 0, -0.03), p2 = add(-petW * 0.5, GK.P + 0.06, 0), p3 = add(petW * 0.5, GK.P + 0.06, 0);
    idx.push(p0, p3, p2);
  } else {
    const p0 = add(-petW * 0.5, 0, -0.03), p1 = add(petW * 0.5, 0, -0.03);
    const p2 = add(-petW * 0.4, GK.P + 0.06, 0), p3 = add(petW * 0.4, GK.P + 0.06, 0);
    idx.push(p0, p1, p3, p0, p3, p2);
  }
  const b = add(0, GK.P, 0);
  let prev = null;
  for (const f of rings) {
    const row = angles.map((a) => {
      const th = a * GK.TH, r = gkRadius(th) * f;
      return add(Math.sin(th) * r, GK.P + Math.cos(th) * r, cup * a * a * r + curl * f * f);
    });
    if (!prev) for (let i = 0; i < row.length - 1; i++) idx.push(b, row[i + 1], row[i]);
    else for (let i = 0; i < row.length - 1; i++) idx.push(prev[i], prev[i + 1], row[i + 1], prev[i], row[i + 1], row[i]);
    prev = row;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// generic helper: geometry from (x,y,z,shade) verts + triangle list, with vertex color = shade
function shadedGeometry(verts, tris) {
  const pos = [], c = [];
  for (const v of verts) { pos.push(v[0], v[1], v[2]); const s = v[3] ?? 1; const tint = v[4] || [1, 1, 1]; c.push(s * tint[0], s * tint[1], s * tint[2]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(tris);
  g.computeVertexNormals();
  return g;
}

// three-lobed (Boston ivy / maple-ish / chrysanthemum foliage) leaf, base at origin, tip +Y.
function lobedLeafGeometry() {
  const outline = [[0, 0.07], [0.2, -0.02], [0.42, 0.11], [0.63, 0.37], [0.37, 0.47], [0.31, 0.72], [0, 1.0],
    [-0.31, 0.72], [-0.37, 0.47], [-0.63, 0.37], [-0.42, 0.11], [-0.2, -0.02]];
  const z = (x, y) => 0.16 * Math.abs(x) - 0.08 * y * y;
  const verts = [[0, 0.42, z(0, 0.42), 1.08]];
  for (const [x, y] of outline) { const tip = Math.hypot(x, y - 0.4) > 0.45; verts.push([x, y, z(x, y), tip ? 0.82 : 0.93]); }
  const tris = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) tris.push(0, 1 + i, 1 + ((i + 1) % n)); // outline runs CCW → +Z face
  return shadedGeometry(verts, tris);
}

// ovate leaf with a midrib fold (bushes, pothos-like hanging strands, succulents)
function broadLeafGeometry() {
  const st = [0, 0.3, 0.62, 1.0];
  const wd = [0.0, 0.36, 0.3, 0.0];
  const verts = [], tris = [];
  st.forEach((y, k) => {
    const w = wd[k], shade = 0.8 + 0.25 * y;
    const zc = -0.12 * y * y;
    verts.push([0, y, zc, shade * 1.1]);
    verts.push([-w, y, zc + 0.22 * w, shade * 0.9]);
    verts.push([w, y, zc + 0.22 * w, shade * 0.9]);
  });
  for (let k = 0; k < st.length - 1; k++) {
    const c0 = k * 3, l0 = c0 + 1, r0 = c0 + 2, c1 = c0 + 3, l1 = c1 + 1, r1 = c1 + 2;
    tris.push(c0, c1, l1, c0, l1, l0); // left half
    tris.push(c0, r0, r1, c0, r1, c1); // right half
  }
  return shadedGeometry(verts, tris);
}

// tapered, curved grass blade: base width 1 (scale x), height 1 (scale y)
function bladeGeometry() {
  const st = [0, 0.35, 0.7, 1.0], wd = [0.5, 0.4, 0.24, 0];
  const verts = [], tris = [];
  st.forEach((y, k) => {
    const z = 0.28 * y * y, s = 0.5 + 0.6 * y;
    if (wd[k] > 0) { verts.push([-wd[k], y, z, s]); verts.push([wd[k], y, z, s]); } else verts.push([0, y, z, s]);
  });
  tris.push(0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6);
  return shadedGeometry(verts, tris);
}

// chrysanthemum / marigold head facing +Y, radius 1
function flowerGeometry() {
  const verts = [], tris = [];
  const ring = (n, r0, r1, w0, w1, tilt, off, s0, s1) => {
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const tx = -sa, tz = ca;
      const y0 = r0 * Math.sin(tilt) * 0.3, y1 = r1 * Math.sin(tilt);
      const h0 = r0 * Math.cos(tilt) + 0.0, h1 = r1 * Math.cos(tilt);
      const b = verts.length;
      verts.push([ca * h0 + tx * w0, y0, sa * h0 + tz * w0, s0]);
      verts.push([ca * h0 - tx * w0, y0, sa * h0 - tz * w0, s0]);
      verts.push([ca * h1 + tx * w1, y1, sa * h1 + tz * w1, s1]);
      verts.push([ca * h1 - tx * w1, y1, sa * h1 - tz * w1, s1]);
      tris.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  };
  ring(13, 0.12, 0.95, 0.05, 0.13, 0.22, 0, 0.62, 1.0);
  ring(11, 0.1, 0.72, 0.05, 0.12, 0.62, 0.5, 0.6, 1.02);
  ring(8, 0.06, 0.45, 0.04, 0.1, 1.05, 0.25, 0.55, 1.05);
  // center button
  const c = verts.length;
  verts.push([0, 0.2, 0, 0.5, [0.75, 0.5, 0.3]]);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; verts.push([Math.cos(a) * 0.16, 0.1, Math.sin(a) * 0.16, 0.45, [0.75, 0.5, 0.3]]); }
  for (let i = 0; i < 7; i++) tris.push(c, c + 1 + ((i + 1) % 7), c + 1 + i);
  const g = shadedGeometry(verts, tris);
  return g;
}

// ------------------------------------------------------------------ trees
function branchObj(pts, radii, depth) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, radii, depth, cum, len: cum[cum.length - 1] };
}
function bSample(b, t, outP, outD) {
  const L = clamp(t, 0, 1) * b.len;
  let i = 0; while (i < b.pts.length - 2 && b.cum[i + 1] < L) i++;
  const seg = Math.max(1e-6, b.cum[i + 1] - b.cum[i]), f = clamp((L - b.cum[i]) / seg, 0, 1);
  outP.lerpVectors(b.pts[i], b.pts[i + 1], f);
  if (outD) outD.subVectors(b.pts[i + 1], b.pts[i]).normalize();
  return lerp(b.radii[i], b.radii[i + 1], f);
}
function perpOf(d, out = V3()) { return out.copy(Math.abs(d.y) < 0.9 ? UP : V3(1, 0, 0)).cross(d).normalize(); }

const GINKGO_PAL = [['#f2c81c', 0.24], ['#eea414', 0.3], ['#e08a10', 0.18], ['#cc6a10', 0.08], ['#c4b62a', 0.09], ['#9aa52c', 0.06], ['#71902e', 0.05]];

function buildGinkgo(cfg, rng, bark, canopy) {
  const tmpP = V3(), tmpD = V3(), tmpU = V3();
  // configs are authored around `origin`; map them onto `base` (x,z) at `baseY`, scaled by `scale`
  const sc = cfg.scale ?? 1, org = cfg.origin ?? [0, 0], bs = cfg.base ?? org, by = cfg.baseY ?? 0;
  const M = (a) => V3(bs[0] + (a[0] - org[0]) * sc, by + a[1] * sc, bs[1] + (a[2] - org[1]) * sc);
  const C = M(cfg.center);
  const ctx = { cx: C.x, cz: C.z };
  const branches = [];
  const tr = cfg.trunk;
  const barkTint = (p) => {
    const moss = smooth(0.9, 0.0, p.y - by);
    return [lerp(1, 0.78, moss) * 0.95, lerp(1, 0.86, moss) * 0.95, lerp(1, 0.66, moss) * 0.95];
  };

  // trunk
  const trunkPts = new THREE.CatmullRomCurve3(tr.pts.map(M), false, 'centripetal').getSpacedPoints(28);
  const trunkR = trunkPts.map((p, i) => lerp(tr.r0, tr.r1, Math.pow(i / (trunkPts.length - 1), 0.75)) * sc);
  const frame = bark.tube(trunkPts, trunkR, {
    radial: tr.radial, colorFn: barkTint,
    gnarl: (phi, s, t, p) => {
      const y = Math.max(0, p.y - by);
      let k = 1 + tr.flare * Math.exp(-y / 0.42) * (0.45 + 0.55 * Math.pow(Math.max(0, Math.cos(5 * phi + 0.7)), 2));
      k *= 1 + 0.2 * (noise3(Math.cos(phi) * 1.3 + 3, y * 1.2, Math.sin(phi) * 1.3) - 0.5) + 0.05 * Math.sin(9 * phi + y * 4);
      return k;
    },
  });
  branches.push(branchObj(trunkPts, trunkR, 0));
  // surface roots along the buttress lobes
  for (let k = 0; k < 5; k++) {
    const phi = (TAU * k - 0.7) / 5;
    const dir = frame.N0.clone().multiplyScalar(Math.cos(phi)).addScaledVector(frame.B0, Math.sin(phi)).setY(0).normalize();
    const b = trunkPts[0];
    let L = tr.rootLen * sc * rng.range(0.75, 1.15);
    const tip = V3(b.x + dir.x * L, 0, b.z + dir.z * L);
    if (tip.x < WALL_W + 0.3 || tip.x > WALL_E - 0.3) L *= 0.5;
    const side = perpOf(dir).multiplyScalar(rng.range(-0.15, 0.15));
    const pts = [0, 0.25, 0.55, 0.8, 1].map((f, i) => V3(b.x + dir.x * L * (0.05 + f * 0.95) + side.x * f, by + [0.5, 0.2, 0.05, -0.04, -0.16][i] * tr.r0 * sc / 0.4, b.z + dir.z * L * (0.05 + f * 0.95) + side.z * f));
    const r = [0.6, 0.42, 0.27, 0.15, 0.07].map((x) => x * tr.r0 * sc);
    bark.tube(new THREE.CatmullRomCurve3(pts).getSpacedPoints(8), Array.from({ length: 9 }, (_, i) => lerp(r[0], r[4], Math.pow(i / 8, 0.8))), { radial: 7, colorFn: barkTint });
  }
  // hand-authored main limbs
  for (const lb of cfg.limbs) {
    const pts = new THREE.CatmullRomCurve3(lb.pts.map(M), false, 'centripetal').getSpacedPoints(16);
    const radii = pts.map((p, i) => lerp(lb.r0, lb.r1, Math.pow(i / (pts.length - 1), 0.85)) * sc);
    bark.tube(pts, radii, { radial: lb.radial || 10, colorFn: barkTint, gnarl: (phi, s) => 1 + 0.08 * Math.sin(3 * phi + s * 2.3) + 0.05 * Math.sin(7 * phi - s * 5) });
    branches.push(branchObj(pts, radii, 1));
  }
  // stubs for character
  for (const st of cfg.stubs || []) {
    const pts = [M(st[0]), M(st[1])];
    bark.tube(pts, [st[2] * sc, st[2] * sc * 0.7], { radial: 6, colorFn: barkTint });
  }

  // procedural sub-branching
  const spurs = [];
  const grow = (parent) => {
    const d = parent.depth + 1;
    if (d > cfg.maxDepth) return;
    const nKids = cfg.kids[parent.depth];
    let az = rng() * TAU;
    for (let k = 0; k < nKids; k++) {
      const t0 = cfg.tMin[d];
      const t = t0 + (1 - t0) * ((k + rng.range(0.15, 0.85)) / nKids) * 0.97;
      const pr = bSample(parent, t, tmpP, tmpD);
      az += 2.39996 + rng.range(-0.5, 0.5);
      const perp = perpOf(tmpD).applyAxisAngle(tmpD, az);
      const ang = rng.range(cfg.angle[d][0], cfg.angle[d][1]);
      const dir = tmpD.clone().multiplyScalar(Math.cos(ang)).addScaledVector(perp, Math.sin(ang));
      const out = V3(tmpP.x - ctx.cx, 0, tmpP.z - ctx.cz);
      if (out.lengthSq() > 1e-4) out.normalize();
      dir.addScaledVector(out, cfg.outBias).addScaledVector(UP, cfg.upBias[d]).normalize();
      const len = parent.len * rng.range(cfg.lenF[d][0], cfg.lenF[d][1]) * (1 - 0.3 * t);
      const r0 = Math.min(pr * 0.72, cfg.rMax[d]);
      const segs = cfg.segs[d];
      const p = tmpP.clone().addScaledVector(dir, -pr * 0.4), dd = dir.clone();
      const pts = [p.clone()];
      for (let i = 0; i < segs; i++) {
        dd.addScaledVector(rng.unit(tmpU), cfg.wander).addScaledVector(UP, cfg.upBias[d] * 0.5);
        if (d >= 3) dd.y -= cfg.droop;
        cfg.avoid(p, dd);
        if (p.y < cfg.minY - 0.3 && d >= 2) dd.y += 0.5;
        dd.normalize();
        p.addScaledVector(dd, len / segs); pts.push(p.clone());
      }
      const smoothPts = d <= 2 ? new THREE.CatmullRomCurve3(pts).getSpacedPoints(segs * 2) : pts;
      const radii = smoothPts.map((_, i) => Math.max(0.006, r0 * (1 - 0.68 * (i / (smoothPts.length - 1)))));
      bark.tube(smoothPts, radii, { radial: cfg.radial[d], colorFn: barkTint });
      const child = branchObj(smoothPts, radii, d);
      branches.push(child);
      grow(child);
    }
  };
  for (const b of branches.filter((b) => b.depth === 1)) grow(b);

  // leaf spurs (ginkgo leaves come in tufts of 3–7 on short spur shoots)
  for (const b of branches) {
    if (b.depth < cfg.spurDepth) continue;
    const tStart = [0, 0, 0.4, 0.15, 0.05][b.depth];
    const n = Math.max(1, Math.round((b.len * (1 - tStart)) / cfg.spurSpacing));
    for (let k = 0; k <= n; k++) {
      const t = tStart + ((1 - tStart) * k) / n;
      bSample(b, t, tmpP, tmpD);
      const off = perpOf(tmpD).applyAxisAngle(tmpD, rng() * TAU).multiplyScalar(rng.range(0.01, 0.05));
      spurs.push({ p: tmpP.clone().add(off), d: tmpD.clone() });
    }
  }

  // leaves
  const leaves = [];
  const pushLeaf = (p, A, N, s, ao = 0.9) => {
    if (p.y - 1.45 * s < cfg.minY) return;
    if (!cfg.leafOK(p)) return;
    leaves.push({ p, A, N, s, ao });
  };
  // foliage puffs at the ends of mid-order branches → readable clumps instead of confetti
  for (const b of branches) {
    if (b.depth !== cfg.puffDepth) continue;
    const tip = b.pts[b.pts.length - 1];
    const R = rng.range(cfg.puffR[0], cfg.puffR[1]);
    const cP = tip.clone().add(V3(0, R * 0.2, 0));
    const n = Math.round(cfg.puffLeaves * (R / 0.5) ** 2);
    for (let k = 0; k < n; k++) {
      const u = rng.unit(V3()); u.y = u.y * 0.7 + 0.18; u.normalize();
      const rr = R * (0.4 + 0.6 * Math.sqrt(rng()));
      const p = cP.clone().add(V3(u.x * rr, u.y * rr * 0.62, u.z * rr));
      const A = u.clone().add(rng.unit(tmpU).multiplyScalar(0.65)).add(V3(0, -0.3, 0)).normalize();
      const N = V3(0, 0.8, 0).addScaledVector(u, 0.7).add(rng.unit(tmpU).multiplyScalar(0.55));
      // clump-local shading: lit crown, darker belly → each puff reads as a mass
      pushLeaf(p, A, N, rng.range(cfg.leafScale[0], cfg.leafScale[1]), 0.58 + 0.42 * smooth(-0.6, 0.8, u.y) * (0.75 + 0.25 * rr / R));
    }
  }
  for (const sp of spurs) {
    const out = sp.p.clone().sub(C); out.y *= 0.55; out.normalize().addScaledVector(sp.d, 0.6).normalize();
    const nL = rng.int(cfg.perSpur[0], cfg.perSpur[1]);
    for (let k = 0; k < nL; k++) {
      const A = out.clone().multiplyScalar(0.75).add(rng.unit(tmpU).multiplyScalar(0.9)).add(V3(0, -0.4, 0)).normalize();
      const N = V3(0, 0.9, 0).addScaledVector(out, 0.6).add(rng.unit(tmpU).multiplyScalar(0.75));
      pushLeaf(sp.p.clone().addScaledVector(A, 0.012), A, N, rng.range(cfg.leafScale[0], cfg.leafScale[1]));
    }
  }
  // thin to target count, preserving distribution
  const keep = Math.min(1, cfg.target / leaves.length);
  const kept = leaves.filter(() => rng() < keep);

  // canopy extents for fake AO / color zoning
  const bb = new THREE.Box3();
  kept.forEach((l) => bb.expandByPoint(l.p));
  const cen = bb.getCenter(V3()), half = bb.getSize(V3()).multiplyScalar(0.5);
  const pal = GINKGO_PAL.map(([h, w]) => [col(h), w]);
  const spawn = [];
  kept.forEach((l, i) => {
    const e = Math.sqrt(((l.p.x - cen.x) / half.x) ** 2 + ((l.p.y - cen.y) / half.y) ** 2 + ((l.p.z - cen.z) / half.z) ** 2);
    const hy = (l.p.y - bb.min.y) / (half.y * 2);
    const patch = noise3(l.p.x * 0.55 + cfg.seedOff, l.p.y * 0.55, l.p.z * 0.55);
    let base;
    if (e < 0.55 && rng() < 0.3) base = rng.pick([pal[4][0], pal[5][0], pal[6][0]]);
    else if (rng() < 0.45) base = pal[clamp(Math.floor(patch * 4.2), 0, 3)][0];
    else base = rng.weighted(pal);
    const c = jitterColor(base, rng);
    const sunward = Math.max(0, V3().subVectors(l.p, cen).normalize().dot(SUN_DIR));
    const ao = (0.5 + 0.5 * smooth(0.15, 0.95, e)) * (0.8 + 0.3 * hy) * (1 + 0.15 * sunward) * l.ao;
    c.multiplyScalar(ao);
    canopy.add(basisMatrix(l.p, l.A, l.N, l.s), c);
    if (i % 3 === 0 && l.p.y > cfg.minY + 0.4) spawn.push(l.p.x, l.p.y, l.p.z);
  });
  return { spawn: new Float32Array(spawn), count: kept.length, box: bb };
}

// Hero / second ginkgo skeletons are authored around `origin` and mapped onto the layout's tree spots.
const HERO_CFG = {
  origin: [-9.3, 5.6], base: L.trees.hero, scale: 0.86,
  center: [-8.0, 5.4, 5.2],
  seedOff: 0,
  trunk: { pts: [[-9.3, -0.2, 5.6], [-9.28, 0.7, 5.6], [-9.06, 1.6, 5.5], [-9.18, 2.4, 5.44], [-8.98, 3.05, 5.5]], r0: 0.4, r1: 0.25, radial: 18, flare: 0.5, rootLen: 1.0 },
  limbs: [
    { pts: [[-9.0, 2.75, 5.48], [-8.0, 3.6, 5.2], [-6.7, 4.3, 4.9], [-5.2, 4.9, 4.6]], r0: 0.2, r1: 0.06 },     // east, over courtyard
    { pts: [[-9.0, 2.9, 5.5], [-9.1, 4.2, 5.8], [-8.8, 5.5, 5.9], [-8.7, 6.7, 5.6]], r0: 0.22, r1: 0.06 },       // leader
    { pts: [[-9.08, 2.85, 5.45], [-9.5, 3.8, 4.6], [-9.6, 4.7, 3.4], [-9.2, 5.4, 2.3]], r0: 0.17, r1: 0.05 },     // north
    { pts: [[-9.15, 2.15, 5.62], [-8.35, 2.85, 6.3], [-7.35, 3.55, 6.95], [-6.4, 4.2, 7.55]], r0: 0.15, r1: 0.05 }, // low SE over the deck
    { pts: [[-9.05, 2.95, 5.6], [-9.35, 3.95, 6.55], [-9.1, 4.85, 7.75], [-8.7, 5.4, 8.6]], r0: 0.15, r1: 0.05 },   // south over the pool edge
    { pts: [[-9.0, 2.55, 5.4], [-8.2, 3.45, 4.35], [-7.3, 4.35, 3.25], [-6.6, 5.1, 2.4]], r0: 0.15, r1: 0.05 },    // north-east
  ],
  stubs: [[[-9.2, 1.55, 5.5], [-9.55, 1.75, 5.25], 0.05], [[-9.1, 2.2, 5.45], [-8.9, 2.4, 5.1], 0.04]],
  kids: [0, 5, 4, 2], maxDepth: 4,
  tMin: [0, 0, 0.25, 0.25, 0.2],
  angle: [null, null, [0.65, 1.05], [0.5, 0.95], [0.45, 0.85]],
  lenF: [null, null, [0.36, 0.52], [0.42, 0.62], [0.5, 0.8]],
  rMax: [0, 0, 0.07, 0.03, 0.014],
  segs: [0, 0, 5, 4, 3], radial: [0, 0, 6, 4, 3],
  upBias: [0, 0, 0.1, 0.06, 0.03], outBias: 0.32, wander: 0.22, droop: 0.1,
  spurDepth: 2, spurSpacing: 0.15, perSpur: [4, 7],
  puffDepth: 3, puffR: [0.38, 0.62], puffLeaves: 30,
  leafScale: [0.125, 0.16], minY: 3.1, target: 5000,
  avoid: (p, d) => { if (p.x < WALL_W + 0.6 && p.y < 4.2) d.x += 0.7; },
  leafOK: (p) => !(p.x < WALL_W + 0.5 && p.y < 4.15),
};
const SMALL_CFG = {
  origin: [10.6, 7.6], base: L.trees.second, scale: 0.95,
  center: [10.0, 4.3, 7.4],
  seedOff: 17,
  trunk: { pts: [[10.6, -0.2, 7.6], [10.56, 0.8, 7.62], [10.42, 1.6, 7.52], [10.46, 2.3, 7.5]], r0: 0.22, r1: 0.15, radial: 14, flare: 0.4, rootLen: 0.6 },
  limbs: [
    { pts: [[10.45, 2.15, 7.5], [9.9, 3.1, 7.25], [9.35, 4.0, 7.0], [8.85, 4.7, 6.8]], r0: 0.1, r1: 0.04, radial: 8 },
    { pts: [[10.46, 2.25, 7.5], [10.5, 3.4, 7.75], [10.3, 4.5, 7.9], [10.2, 5.4, 7.7]], r0: 0.11, r1: 0.04, radial: 8 },
    { pts: [[10.44, 2.1, 7.48], [10.6, 2.95, 6.7], [10.45, 3.75, 5.9], [10.2, 4.3, 5.3]], r0: 0.08, r1: 0.03, radial: 7 },
    { pts: [[10.44, 2.3, 7.55], [10.3, 3.2, 8.4], [10.0, 4.05, 9.05]], r0: 0.08, r1: 0.03, radial: 7 },
    { pts: [[10.44, 2.2, 7.5], [9.8, 2.9, 8.1], [9.1, 3.6, 8.5]], r0: 0.07, r1: 0.03, radial: 6 },
  ],
  stubs: [],
  kids: [0, 3, 3, 2], maxDepth: 4,
  tMin: [0, 0, 0.3, 0.25, 0.2],
  angle: [null, null, [0.6, 1.0], [0.5, 0.9], [0.45, 0.85]],
  lenF: [null, null, [0.45, 0.65], [0.42, 0.62], [0.5, 0.75]],
  rMax: [0, 0, 0.045, 0.022, 0.012],
  segs: [0, 0, 4, 4, 3], radial: [0, 0, 5, 4, 3],
  upBias: [0, 0, 0.12, 0.08, 0.04], outBias: 0.3, wander: 0.2, droop: 0.08,
  spurDepth: 2, spurSpacing: 0.14, perSpur: [4, 6],
  puffDepth: 3, puffR: [0.3, 0.48], puffLeaves: 26,
  leafScale: [0.115, 0.145], minY: 3.0, target: 1600,
  avoid: (p, d) => { if (p.x > WALL_E - 0.5 && p.y < 4.2) d.x -= 0.7; },
  leafOK: (p) => !(p.x > WALL_E - 0.45 && p.y < 4.15),
};
// little leaning ginkgo on the lagoon islet, bowing toward the deck
const ISLAND_CFG = {
  origin: [0, 0], base: [L.sea.island.x, L.sea.island.z], baseY: 0.6, scale: 1,
  center: [-1.0, 2.9, -0.2],
  seedOff: 33,
  trunk: { pts: [[0, -0.25, 0], [-0.1, 0.6, -0.05], [-0.42, 1.3, -0.15], [-0.82, 1.85, -0.28], [-1.12, 2.3, -0.4]], r0: 0.2, r1: 0.11, radial: 12, flare: 0.45, rootLen: 0.55 },
  limbs: [
    { pts: [[-1.1, 2.2, -0.4], [-1.6, 2.8, -0.75], [-2.15, 3.15, -1.1]], r0: 0.075, r1: 0.03, radial: 7 },
    { pts: [[-1.12, 2.25, -0.38], [-1.5, 2.9, 0.1], [-1.95, 3.35, 0.55]], r0: 0.075, r1: 0.03, radial: 7 },
    { pts: [[-0.8, 1.8, -0.28], [-0.4, 2.4, 0.3], [0.1, 2.8, 0.75]], r0: 0.06, r1: 0.025, radial: 6 },
    { pts: [[-1.1, 2.28, -0.42], [-0.92, 3.1, -0.62], [-0.72, 3.75, -0.5]], r0: 0.065, r1: 0.025, radial: 6 },
    { pts: [[-0.6, 1.6, -0.22], [-0.2, 2.2, -0.8], [0.3, 2.6, -1.25]], r0: 0.055, r1: 0.022, radial: 6 },
  ],
  stubs: [],
  kids: [0, 3, 3, 2], maxDepth: 4,
  tMin: [0, 0, 0.3, 0.25, 0.2],
  angle: [null, null, [0.6, 1.0], [0.5, 0.9], [0.45, 0.85]],
  lenF: [null, null, [0.5, 0.7], [0.45, 0.65], [0.5, 0.75]],
  rMax: [0, 0, 0.035, 0.018, 0.01],
  segs: [0, 0, 4, 3, 3], radial: [0, 0, 5, 4, 3],
  upBias: [0, 0, 0.12, 0.08, 0.04], outBias: 0.3, wander: 0.2, droop: 0.08,
  spurDepth: 2, spurSpacing: 0.14, perSpur: [4, 6],
  puffDepth: 3, puffR: [0.32, 0.48], puffLeaves: 28,
  leafScale: [0.11, 0.14], minY: 2.0, target: 1150,
  avoid: () => {},
  leafOK: () => true,
};

// ------------------------------------------------------------------ lagoon helpers
const SEA = (() => {
  const curve = new THREE.CatmullRomCurve3(L.sea.outline.map(([x, z]) => V3(x, 0, z)), true, 'catmullrom', 0.5);
  const pts = curve.getSpacedPoints(480).slice(0, -1);
  const poly = pts.map((p) => [p.x, p.z]);
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const shoreDist = (x, z) => { let m = Infinity; for (const [px, pz] of poly) m = Math.min(m, (px - x) ** 2 + (pz - z) ** 2); return Math.sqrt(m); };
  // outward (land-side) normal at sample i
  const normal = (i) => {
    const n = pts.length, a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const v = V3(b.z - a.z, 0, -(b.x - a.x)).normalize();
    if (inside(pts[i].x + v.x * 0.3, pts[i].z + v.z * 0.3)) v.negate();
    return v;
  };
  return { curve, pts, inside, shoreDist, normal, len: curve.getLength() };
})();
const ISLAND = L.sea.island;
const onStairs = (x, z) => x > STEP0.x0 - 0.15 && x < STEP0.x1 + 0.15 && z > STEP0.z0 - 0.1 && z < STEP0.z0 + L.stairs.depth * L.stairs.steps;

// ------------------------------------------------------------------ distant trees (low-LOD leaf puffs)
const FAR_KINDS = {
  ginkgo: { pal: ['#e0aa22', '#cf901c', '#e8bf34', '#c07a18', '#b9a62a'], narrow: 1, cone: true },
  dark: { pal: ['#55744c', '#628052', '#4a6a44', '#738a4c', '#47664e'], narrow: 0.6 },
  maple: { pal: ['#b4502a', '#9e3f26', '#c4682e', '#8a3426', '#c98a34'], narrow: 0.8 },
  olive: { pal: ['#c9a02c', '#a8862e', '#8a8e3e', '#d6b03a', '#6f7f3a'], narrow: 0.9 },
};
const HAZE = col('#4a3a5c');
function puffTree(at, o, rng, bark, far) {
  const K = FAR_KINDS[o.kind], pal = K.pal.map((h) => col(h).lerp(HAZE, o.haze ?? 0));
  const base = V3(at[0], at[1] || 0, at[2]);
  const tint = [0.72, 0.7, 0.72];
  const tU = V3();
  const lean = V3(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5));
  const top = V3(base.x + lean.x, base.y + o.h * (o.trunkF ?? 0.56), base.z + lean.z);
  const trunk = new THREE.CatmullRomCurve3([base.clone().setY(base.y - 0.25), V3(base.x + lean.x * 0.3 + 0.1, base.y + o.h * 0.3, base.z + lean.z * 0.3), top]).getSpacedPoints(6);
  bark.tube(trunk, trunk.map((_, i) => lerp(o.r, o.r * 0.45, i / 6)), { radial: 7, color: tint });
  const cy = top.y + o.crown[1] * 0.5;
  for (let i = 0; i < o.puffs; i++) {
    const u = rng.unit(V3());
    let rx = o.crown[0];
    if (K.cone) { u.y = rng.range(-0.85, 1); rx *= 1 - 0.5 * (u.y * 0.5 + 0.5); }
    u.y = Math.max(u.y, -0.6);
    const rr = Math.cbrt(rng.range(0.3, 1));
    const c = V3(top.x + u.x * rx * rr, cy + u.y * o.crown[1] * rr, top.z + u.z * rx * rr);
    const s0 = trunk[rng.int(3, 5)];
    const lt = s0.clone().lerp(c, 0.7);
    if (i < (o.limbs ?? 99)) bark.tube([s0.clone(), s0.clone().lerp(lt, 0.5).add(V3(0, 0.25, 0)), lt], [o.r * 0.4, o.r * 0.22, o.r * 0.1], { radial: 4, color: tint });
    const R = rng.range(0.85, 1.3) * (o.crown[0] / 3.0) * (o.puffScale ?? 1);
    const n = Math.round(o.leaves * (R / 1.1) ** 2);
    const hue = rng.pick(pal);
    for (let k = 0; k < n; k++) {
      const v = rng.unit(V3()); v.y = v.y * 0.7 + 0.2; v.normalize();
      const r2 = R * (0.45 + 0.55 * Math.sqrt(rng()));
      const p = V3(c.x + v.x * r2, c.y + v.y * r2 * 0.65, c.z + v.z * r2);
      const A = v.clone().add(rng.unit(tU).multiplyScalar(0.7)).add(V3(0, -0.3, 0)).normalize();
      const N = V3(0, 0.8, 0).addScaledVector(v, 0.7).add(rng.unit(tU).multiplyScalar(0.5));
      const sc = rng.range(o.leaf[0], o.leaf[1]);
      const shade = (0.55 + 0.45 * smooth(-0.6, 0.8, v.y)) * (0.75 + 0.3 * (c.y - cy + o.crown[1]) / (2 * o.crown[1]));
      const cc = jitterColor(rng() < 0.6 ? hue : rng.pick(pal), rng, 0.01, 0.05, 0.04).multiplyScalar(shade * 0.85);
      far.add(basisMatrix(p, A, N, sc * K.narrow, sc, sc), cc);
    }
  }
}
function bambooGrove(at, rng, bark, blades) {
  const tU = V3();
  const n = rng.int(8, 11);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * 1.3;
    const b = V3(at[0] + Math.cos(a) * r, -0.2, at[2] + Math.sin(a) * r);
    const h = rng.range(6, 9);
    const lean = V3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(rng.range(0.03, 0.14) * h).add(V3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
    const pts = [];
    for (let k = 0; k <= 12; k++) { const f = k / 12; pts.push(V3(b.x + lean.x * f * f, b.y + h * f, b.z + lean.z * f * f)); }
    const r0 = rng.range(0.045, 0.065);
    bark.tube(pts, pts.map((_, k) => lerp(r0, r0 * 0.45, k / 12)), { radial: 5, colorFn: (p, t) => (Math.round(t * 12) % 2 ? [0.95, 1.25, 0.55] : [0.8, 1.05, 0.45]) });
    // leaf sprays on the upper half
    for (let k = 5; k <= 12; k++) {
      const p = pts[k];
      const ns = rng.int(6, 9);
      const out = V3(Math.cos(a + rng.range(-1.2, 1.2)), 0, Math.sin(a + rng.range(-1.2, 1.2)));
      for (let j = 0; j < ns; j++) {
        const A = out.clone().add(rng.unit(tU).multiplyScalar(0.6)).add(V3(0, -0.35, 0)).normalize();
        const N = V3(0, 1, 0).add(rng.unit(tU).multiplyScalar(0.4));
        const L2 = rng.range(0.36, 0.52);
        const c = jitterColor(col(rng.pick(['#6f8f3a', '#7f9a3e', '#5f7f36', '#9aa244', '#8a8a3a'])).lerp(HAZE, 0.22), rng).multiplyScalar(0.62 + 0.06 * (k - 5));
        blades.add(basisMatrix(p.clone().addScaledVector(out, 0.04 + 0.08 * rng()), A, N, 0.14, L2, L2 * 0.6), c);
      }
    }
  }
}
function buildBackgroundTrees(rng, bark, far, blades) {
  // neighbours' trees peeking over the courtyard walls
  puffTree([-11, 0, -9], { kind: 'ginkgo', h: 9, crown: [2.6, 3.0], r: 0.3, puffs: 14, leaves: 40, leaf: [0.22, 0.29], haze: 0.2, limbs: 6 }, rng, bark, far);
  puffTree([11, 0, -10], { kind: 'dark', h: 10, crown: [3.2, 2.8], r: 0.36, puffs: 16, leaves: 40, leaf: [0.22, 0.29], haze: 0.2, limbs: 6 }, rng, bark, far);
  puffTree([-12.2, 0, -1.8], { kind: 'maple', h: 7.5, crown: [2.6, 2.2], r: 0.28, puffs: 11, leaves: 38, leaf: [0.21, 0.27], haze: 0.2, limbs: 6 }, rng, bark, far);
  puffTree([12.3, 0, -1.0], { kind: 'olive', h: 8, crown: [2.4, 2.4], r: 0.26, puffs: 10, leaves: 38, leaf: [0.21, 0.27], haze: 0.2, limbs: 6 }, rng, bark, far);
  // ring around the far edge of the lagoon grounds: trees alternating with bamboo groves
  const B = L.sea.shoreBounds, inset = 1.6;
  const ring = [];
  for (let z = B.z0 + 2.2; z < B.z1 - 1; z += rng.range(3.6, 4.6)) ring.push([B.x0 + inset + rng.range(-0.6, 0.6), z]);
  for (let x = B.x0 + 3.5; x < B.x1 - 2.5; x += rng.range(3.8, 4.8)) ring.push([x, B.z1 - inset + rng.range(-0.6, 0.6)]);
  for (let z = B.z1 - 3; z > B.z0 + 1.5; z -= rng.range(3.6, 4.6)) ring.push([B.x1 - inset + rng.range(-0.6, 0.6), z]);
  const kinds = ['ginkgo', 'dark', 'bamboo', 'maple', 'dark', 'ginkgo', 'bamboo', 'olive'];
  ring.forEach(([x, z], i) => {
    if (SEA.inside(x, z) || SEA.shoreDist(x, z) < 2.2) return;
    const kind = kinds[(i + rng.int(0, 1)) % kinds.length];
    if (kind === 'bamboo') bambooGrove([x, 0, z], rng, bark, blades);
    else {
      const big = rng() < 0.35, cw = big ? rng.range(3.0, 3.6) : rng.range(2.2, 2.9);
      puffTree([x, 0, z], { kind, h: big ? rng.range(9, 11) : rng.range(5.5, 8), trunkF: 0.42, crown: [cw, cw * rng.range(0.75, 0.95)], r: rng.range(0.26, 0.34), puffs: big ? rng.int(12, 14) : rng.int(9, 11), limbs: 5, leaves: 22, leaf: [0.4, 0.52], puffScale: 1.05, haze: 0.42 }, rng, bark, far);
    }
  });
}

// ------------------------------------------------------------------ lagoon shore, islet & lilies
const REED_PAL = ['#7f8a3e', '#9a9a4a', '#b8964c', '#c9a45a', '#6f7f3a', '#a88a48'];
function buildShore(rng, sets) {
  const tU = V3();
  const { pts } = SEA;
  const step = Math.max(1, Math.round(pts.length * 0.85 / SEA.len)); // ≈0.85 m between candidates
  let flowersLeft = 7;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (p.z < 6.6 && Math.abs(p.x) < 9.2) continue;            // keep the straight north edge under the deck clear
    const s = (i / pts.length) * SEA.len;
    if (noise3(s * 0.11, 3.1, 7.7) < 0.42) continue;            // open gaps so the water stays visible
    const n = SEA.normal(i);
    const kind = hash3(s * 0.37, 1.3, 2.2);
    const off = rng.range(-0.25, 0.9);
    const c = p.clone().addScaledVector(n, off);
    const wet = off < 0.12;
    const y0 = wet ? L.WATER_Y - 0.12 : -0.03;
    if (kind < 0.5) { // reeds (+ cattails)
      const nb = rng.int(22, 34);
      for (let k = 0; k < nb; k++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * 0.4;
        const lean = rng.range(0.02, 0.32);
        const dir = V3(Math.cos(a), 0, Math.sin(a));
        const A = V3(dir.x * Math.sin(lean), Math.cos(lean), dir.z * Math.sin(lean));
        const h = rng.range(1.0, 1.9) * (1 - 0.35 * r / 0.4);
        sets.blade.add(basisMatrix(V3(c.x + dir.x * r, y0, c.z + dir.z * r), A, V3(dir.x, -0.1, dir.z), rng.range(0.035, 0.05), h, h), jitterColor(col(rng.pick(REED_PAL)), rng));
      }
      if (kind < 0.28) {
        for (let k = 0, m = rng.int(3, 6); k < m; k++) {
          const a = rng() * TAU, r = Math.sqrt(rng()) * 0.25, lean = rng.range(0.0, 0.15);
          const dir = V3(Math.cos(a), 0, Math.sin(a));
          const A = V3(dir.x * Math.sin(lean), Math.cos(lean), dir.z * Math.sin(lean));
          const h = rng.range(1.3, 1.8);
          const base = V3(c.x + dir.x * r, y0, c.z + dir.z * r);
          const mtx = basisMatrix(base, A, V3(dir.x, 0, dir.z), 0.014, h, h * 0.2).clone();
          sets.blade.add(mtx, col('#6b7a3a'));
          const tip = V3(0, 0.86, 0.28 * 0.86 * 0.86).applyMatrix4(mtx);
          const brown = jitterColor(col('#5a3a22'), rng, 0.01, 0.05, 0.03);
          sets.broad.add(basisMatrix(tip, A, V3(dir.x, 0, dir.z), 0.05, 0.2, 0.04), brown);
          sets.broad.add(basisMatrix(tip, A, V3(-dir.z, 0, dir.x), 0.05, 0.2, 0.04), brown);
        }
      }
    } else if (kind < 0.8) { // pampas / miscanthus tussock
      const g = V3(c.x, -0.03, c.z).addScaledVector(n, Math.max(0, 0.25 - off));
      for (let k = 0, nb = rng.int(18, 30); k < nb; k++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * 0.3, lean = rng.range(0.1, 0.6);
        const dir = V3(Math.cos(a), 0, Math.sin(a));
        const A = V3(dir.x * Math.sin(lean), Math.cos(lean), dir.z * Math.sin(lean));
        const h = rng.range(0.6, 1.1);
        sets.blade.add(basisMatrix(V3(g.x + dir.x * r, g.y, g.z + dir.z * r), A, V3(dir.x, -0.1, dir.z), rng.range(0.035, 0.05), h, h), jitterColor(col(rng.pick(GRASS_PAL)), rng));
      }
      for (let k = 0, m = rng.int(3, 6); k < m; k++) {
        const a = rng() * TAU, lean = rng.range(0.05, 0.35);
        const dir = V3(Math.cos(a), 0, Math.sin(a));
        const A = V3(dir.x * Math.sin(lean), Math.cos(lean), dir.z * Math.sin(lean));
        const h = rng.range(1.0, 1.45);
        const base = V3(g.x + dir.x * 0.08, g.y, g.z + dir.z * 0.08);
        sets.blade.add(basisMatrix(base, A, dir, 0.012, h, h), col('#a89660'));
        const tip = base.clone().addScaledVector(A, h * 0.95);
        sets.broad.add(basisMatrix(tip, A.clone().addScaledVector(dir, 0.3), V3(-dir.x, 0.2, -dir.z), 0.08, 0.28, 0.08), jitterColor(col('#eadcb6'), rng));
      }
    } else { // flowering shrub on the bank
      const g = V3(c.x, -0.05, c.z).addScaledVector(n, Math.max(0, 0.6 - off));
      const rad = rng.range(0.45, 0.7), cy = g.y + rad * 0.7;
      for (let k = 0, nl = Math.round(95 * (rad / 0.55) ** 2); k < nl; k++) {
        const u = rng.unit(tU).clone(); u.y = Math.abs(u.y) * 0.9 - 0.1; u.normalize();
        const rr = rad * (0.5 + 0.5 * Math.sqrt(rng()));
        const q = V3(g.x + u.x * rr * 1.15, cy + u.y * rr * 0.85, g.z + u.z * rr * 1.15);
        const A = u.clone().add(rng.unit(tU).multiplyScalar(0.55)).normalize();
        const Nf = u.clone().multiplyScalar(0.7).add(V3(0, 0.8, 0)).add(rng.unit(tU).multiplyScalar(0.5));
        const sc = rng.range(0.1, 0.15);
        sets.broad.add(basisMatrix(q, A, Nf, sc * 0.95, sc, sc), jitterColor(col(rng.pick(BUSH_GREENS)), rng).multiplyScalar(0.55 + 0.5 * (rr / rad)));
      }
      if (flowersLeft-- > 0) {
        const fc = rng.pick([['#ef9ab2', '#f7c6d3', '#e57d9a'], ['#f3ede0', '#f7e7c8', '#efd9b0'], ['#f08a24', '#f4b42c', '#e46a22']]);
        for (let k = 0, nf = rng.int(8, 12); k < nf; k++) {
          const u = rng.unit(tU).clone(); u.y = Math.abs(u.y) * 0.7 + 0.3; u.normalize();
          const q = V3(g.x + u.x * rad * 1.05, cy + u.y * rad * 0.85, g.z + u.z * rad * 1.05);
          const face = u.clone().add(V3(0, 0.8, 0)).normalize();
          sets.flower.add(basisMatrix(q, face, perpOf(face), rng.range(0.06, 0.085)), jitterColor(col(rng.pick(fc)), rng, 0.01, 0.05, 0.04));
        }
      }
    }
  }
}
// low-poly lily pad (notched disc in local XY, face +Z), radius 1
function padGeometry() {
  const verts = [[0, 0, 0.02, 1.05]], tris = [];
  const n = 13, gap = 0.22;
  for (let i = 0; i <= n; i++) {
    const a = gap + ((TAU - 2 * gap) * i) / n;
    verts.push([Math.cos(a), Math.sin(a), 0.0, 0.8 + 0.12 * Math.sin(i * 1.7)]);
  }
  for (let i = 1; i <= n; i++) tris.push(0, i, i + 1);
  return shadedGeometry(verts, tris);
}
function buildLilies(rng, pads, flowers) {
  const lane = (x, z) => x > -6.3 && x < 6.3 && z > 5.8 && z < 14.3;
  const ok = (x, z, minShore) => SEA.inside(x, z) && !lane(x, z) && !onStairs(x, z) && Math.hypot(x - ISLAND.x, z - ISLAND.z) > ISLAND.r + 0.7 && SEA.shoreDist(x, z) > minShore;
  const centers = [];
  let guard = 0;
  while (centers.length < 7 && guard++ < 4000) {
    const x = rng.range(-15, 15), z = rng.range(6, 24);
    if (!ok(x, z, 1.0) || SEA.shoreDist(x, z) > 3.6) continue;
    if (centers.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 5)) continue;
    centers.push([x, z]);
  }
  const padPal = ['#3f6a32', '#4f7a38', '#5d8a3e', '#6e8a3a', '#46703a'];
  const Y = L.WATER_Y + 0.015;
  for (const [cx, cz] of centers) {
    const n = rng.int(10, 18);
    const placed = [];
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const x = cx + rng.gauss() * 0.7, z = cz + rng.gauss() * 0.7;
      const s = rng.range(0.16, 0.32);
      if (!ok(x, z, 0.4 + s)) continue;
      if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < (ps + s) * 0.85)) continue;
      placed.push([x, z, s]);
      const a = rng() * TAU;
      const c = col(rng() < 0.12 ? '#a59a3c' : rng() < 0.08 ? '#8a5a32' : rng.pick(padPal));
      pads.add(basisMatrix(V3(x, Y + k * 0.0006, z), V3(Math.cos(a), 0, Math.sin(a)), UP, s), jitterColor(c, rng, 0.01, 0.05, 0.05));
      k++;
    }
    for (let k = 0, nf = rng.int(1, 3); k < nf && k < placed.length; k++) {
      const [x, z, s] = placed[k];
      sets_flowerOnPad(flowers, rng, x, Y + 0.02, z, s);
    }
  }
}
function sets_flowerOnPad(flowers, rng, x, y, z, s) {
  const c = col(rng.pick(['#f2a6bf', '#f7ede4', '#f6c3d1', '#ffffff']));
  flowers.add(basisMatrix(V3(x + rng.range(-0.05, 0.05), y, z + rng.range(-0.05, 0.05)), UP, V3(1, 0, 0), rng.range(0.08, 0.11)), jitterColor(c, rng, 0.01, 0.04, 0.03));
}

// ------------------------------------------------------------------ pots & potted plants
// floor pots follow LAYOUT.pots (same order), counter pots LAYOUT.counterPots
const POT_STYLES = [
  { kind: 'tall', r: 0.29, h: 0.64, glaze: '#2f6668', plant: 'grass' },                                                // NW corner
  { kind: 'terracotta', r: 0.28, h: 0.4, plant: 'mums', flowers: ['#f08a24', '#f4a92e', '#e46a22', '#f6bf3a'] },        // by the bike / bar
  { kind: 'terracotta', r: 0.36, h: 0.48, plant: 'bush' },                                                             // east wall
  { kind: 'jar', r: 0.34, h: 0.52, glaze: '#d4cbb2', plant: 'maple' },                                                 // east wall
  { kind: 'tub', r: 0.32, h: 0.42, plant: 'bush' },                                                                    // deck, west end
  { kind: 'jar', r: 0.31, h: 0.46, glaze: '#2d4b74', plant: 'mums', flowers: ['#f6c23a', '#f3a52c', '#f7d75a', '#ea8a2a'] }, // deck by the steps
];
const COUNTER_STYLES = [
  { kind: 'small', r: 0.11, h: 0.13, glaze: '#86ab9c', plant: 'succulent' },
  { kind: 'small', r: 0.1, h: 0.14, glaze: '#b9502f', plant: 'miniMums', flowers: ['#f6c23a', '#f08a24'] },
];
const POTS = [
  ...L.pots.map(([x, z], i) => ({ x, z, ...POT_STYLES[i % POT_STYLES.length] })),
  ...L.counterPots.map(([x, z], i) => ({ x, z, y: L.bar.top, noCollider: true, ...COUNTER_STYLES[i % COUNTER_STYLES.length] })),
];
const PROFILES = {
  terracotta: { pts: [[0, 0], [0.7, 0], [0.73, 0.03], [0.86, 0.74], [0.88, 0.78], [0.99, 0.8], [1.0, 0.85], [1.0, 0.96], [0.98, 1.0], [0.91, 1.0], [0.89, 0.96], [0.86, 0.9]], soil: 0.9, inside: 9, maxR: 1.0 },
  small: { pts: [[0, 0], [0.7, 0], [0.73, 0.04], [0.88, 0.72], [0.98, 0.78], [1.0, 0.95], [0.97, 1.0], [0.88, 1.0], [0.86, 0.9]], soil: 0.88, inside: 7, maxR: 1.0 },
  jar: { pts: [[0, 0], [0.56, 0], [0.6, 0.03], [0.86, 0.22], [0.99, 0.48], [0.97, 0.7], [0.86, 0.86], [0.82, 0.9], [0.86, 0.94], [0.88, 1.0], [0.81, 1.0], [0.79, 0.95], [0.78, 0.9]], soil: 0.9, inside: 10, maxR: 0.99 },
  tall: { pts: [[0, 0], [0.74, 0], [0.76, 0.03], [0.82, 0.45], [0.9, 0.88], [0.97, 0.92], [0.98, 1.0], [0.9, 1.0], [0.89, 0.95], [0.88, 0.9]], soil: 0.9, inside: 7, maxR: 0.98 },
  tub: { pts: [[0, 0], [0.84, 0], [0.86, 0.02], [0.95, 0.5], [1.0, 0.97], [0.97, 1.0], [0.92, 1.0], [0.9, 0.9]], soil: 0.88, inside: 6, maxR: 1.0 },
};

function potColor(pot, yf, inside, seg, rng, tint) {
  const clay = col('#b8653f').multiplyScalar(tint);
  if (inside) return { c: (pot.kind === 'tub' ? col('#5a3a22') : clay).multiplyScalar(0.42), r: 0.95 };
  if (pot.kind === 'tub') {
    const band = (yf > 0.16 && yf < 0.24) || (yf > 0.74 && yf < 0.82);
    if (band) return { c: col('#3a3532'), r: 0.45 };
    const staves = ['#8c5c36', '#7b4f2f', '#946640', '#835632'];
    return { c: col(staves[seg % 4]).multiplyScalar(lerp(0.78, 1.05, yf)), r: 0.82 };
  }
  if (pot.kind === 'terracotta' || (pot.kind === 'small' && !pot.glaze)) {
    const c = clay.clone();
    if (yf > 0.78) c.multiplyScalar(1.08);
    c.lerp(col('#d2c2ac'), 0.28 * smooth(0.25, 0.0, yf)); // efflorescence near the foot
    return { c: c.multiplyScalar(lerp(0.85, 1.0, yf)), r: 0.9 };
  }
  // glazed: glossy body, raw clay foot with a soft drip line
  const cut = 0.1 + 0.05 * Math.sin(seg * 1.7) + 0.03 * Math.sin(seg * 4.1);
  if (yf < cut) return { c: col('#a7826a'), r: 0.85 };
  const g = col(pot.glaze);
  if (yf > 0.93) g.lerp(col('#efe6d2'), 0.25);
  return { c: g.multiplyScalar(lerp(0.88, 1.05, yf)), r: 0.28 };
}

function buildPotGeometry(rng) {
  const P = [], N = [], U = [], C = [], R = [];
  const pots = POTS.map((pot) => ({ ...pot, y: pot.y || 0 }));
  for (const pot of pots) {
    const prof = PROFILES[pot.kind];
    const segs = pot.kind === 'small' ? 18 : pot.kind === 'tub' ? 20 : 28;
    const lathe = new THREE.LatheGeometry(prof.pts.map(([x, y]) => new THREE.Vector2(x * pot.r, y * pot.h)), segs).toNonIndexed();
    const tint = rng.range(0.9, 1.06);
    const rot = rng() * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
    const pa = lathe.attributes.position, na = lathe.attributes.normal, ua = lathe.attributes.uv;
    for (let i = 0; i < pa.count; i += 3) {
      let u = 0, yf = 0, inside = false;
      for (let k = 0; k < 3; k++) { u += ua.getX(i + k) / 3; yf += pa.getY(i + k) / pot.h / 3; }
      const seg = Math.floor(u * segs + 1e-4);
      // which profile segment? → inside if any vertex v index ≥ prof.inside
      for (let k = 0; k < 3; k++) if (ua.getY(i + k) * (prof.pts.length - 1) > prof.inside - 0.5) inside = true;
      const { c, r } = potColor(pot, yf, inside, seg, rng, tint);
      for (let k = 0; k < 3; k++) {
        const x = pa.getX(i + k), y = pa.getY(i + k), z = pa.getZ(i + k);
        P.push(pot.x + x * cr - z * sr, pot.y + y, pot.z + x * sr + z * cr);
        const nx = na.getX(i + k), nz = na.getZ(i + k);
        N.push(nx * cr - nz * sr, na.getY(i + k), nx * sr + nz * cr);
        U.push(ua.getX(i + k) * 3, ua.getY(i + k));
        C.push(c.r, c.g, c.b); R.push(r);
      }
    }
    // soil disk
    const last = prof.pts[prof.pts.length - 1];
    const sr0 = last[0] * pot.r * 1.01, sy = prof.soil * pot.h;
    const soil = col('#3b2a1f');
    const segN = 18;
    for (let k = 0; k < segN; k++) {
      const a0 = (k / segN) * TAU, a1 = ((k + 1) / segN) * TAU;
      const verts = [[0, 0], [Math.cos(a1) * sr0, Math.sin(a1) * sr0], [Math.cos(a0) * sr0, Math.sin(a0) * sr0]];
      for (const [x, z] of verts) {
        P.push(pot.x + x, pot.y + sy, pot.z + z); N.push(0, 1, 0); U.push(x * 4, z * 4);
        const s = 0.85 + 0.3 * hash3(x * 9 + pot.x, z * 9, pot.z);
        C.push(soil.r * s, soil.g * s, soil.b * s); R.push(1);
      }
    }
    pot.soilY = pot.y + sy; pot.soilR = sr0; pot.rimY = pot.y + pot.h; pot.maxR = prof.maxR * pot.r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aRough', new THREE.Float32BufferAttribute(R, 1));
  g.computeBoundingSphere();
  return { geometry: g, pots };
}

const BUSH_GREENS = ['#2e5f30', '#3b7136', '#4c823b', '#5a8f40', '#2a5236', '#467a3e'];
const MAPLE_PAL = [['#b8322a', 0.28], ['#d1452b', 0.24], ['#e2702f', 0.18], ['#7d2228', 0.12], ['#e3a23a', 0.1], ['#9a3a24', 0.08]];
const GRASS_PAL = ['#c9a45a', '#b8964c', '#9a9a4a', '#7f8a3e', '#d4b46a', '#a88a48'];

function buildPotPlants(pots, rng, sets, bark) {
  const tU = V3(), tmp = V3();
  for (const pot of pots) {
    const c = V3(pot.x, pot.soilY, pot.z), R = pot.soilR;
    if (pot.plant === 'bush') {
      const rad = pot.r * 1.0, cy = pot.soilY + rad * 0.62;
      for (let i = 0; i < 4; i++) {
        const a = rng() * TAU;
        bark.tube([c.clone().add(V3(Math.cos(a) * 0.05, -0.02, Math.sin(a) * 0.05)), V3(pot.x + Math.cos(a) * rad * 0.3, cy, pot.z + Math.sin(a) * rad * 0.3)], [0.015, 0.008], { radial: 4, color: [0.6, 0.55, 0.4] });
      }
      const n = Math.round(260 * (rad / 0.4) ** 2);
      for (let i = 0; i < n; i++) {
        const u = rng.unit(tU); u.y = Math.abs(u.y) * 0.95 - 0.12; u.normalize();
        const rr = rad * (0.5 + 0.5 * Math.sqrt(rng()));
        const p = V3(pot.x + u.x * rr * 1.1, cy + u.y * rr * 0.85, pot.z + u.z * rr * 1.1);
        if (p.y < pot.rimY - 0.06) p.y = pot.rimY - 0.06 + rng() * 0.05;
        const A = u.clone().add(rng.unit(tmp).multiplyScalar(0.55)).add(V3(0, 0.1, 0)).normalize();
        const Nf = u.clone().multiplyScalar(0.7).add(V3(0, 0.8, 0)).add(rng.unit(tmp).multiplyScalar(0.5));
        const s = rng.range(0.09, 0.14);
        const cc = jitterColor(col(rng() < 0.07 ? '#a6a23c' : rng.pick(BUSH_GREENS)), rng).multiplyScalar(0.55 + 0.5 * (rr / rad));
        sets.broad.add(basisMatrix(p, A, Nf, s * 0.95, s, s), cc);
      }
    } else if (pot.plant === 'maple') {
      const H = pot.kind === 'jar' ? 1.15 : 0.95;
      const tips = [];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + rng.range(-0.4, 0.4);
        const p0 = c.clone().add(V3(Math.cos(a) * 0.04, -0.03, Math.sin(a) * 0.04));
        const top = V3(pot.x + Math.cos(a) * pot.r * 0.7, pot.soilY + H * rng.range(0.75, 1), pot.z + Math.sin(a) * pot.r * 0.7);
        const mid = p0.clone().lerp(top, 0.5).add(V3(rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06)));
        const pts = new THREE.CatmullRomCurve3([p0, mid, top]).getSpacedPoints(6);
        bark.tube(pts, pts.map((_, i) => lerp(0.028, 0.008, i / 6)), { radial: 5, color: [0.75, 0.55, 0.45] });
        tips.push(top);
        for (let j = 0; j < 3; j++) {
          const s = pts[2 + j], b = rng.range(0.25, 0.5);
          const e = s.clone().add(V3(Math.cos(a + rng.range(-1.2, 1.2)) * b, rng.range(0.08, 0.3), Math.sin(a + rng.range(-1.2, 1.2)) * b));
          bark.tube([s.clone(), e], [0.008, 0.004], { radial: 4, color: [0.75, 0.55, 0.45] });
          tips.push(e);
        }
      }
      for (const t of tips) {
        const n = rng.int(16, 24);
        for (let i = 0; i < n; i++) {
          const p = t.clone().add(rng.unit(tmp).multiplyScalar(rng.range(0.02, 0.2)).multiply(V3(1, 0.7, 1)));
          const out = p.clone().sub(V3(pot.x, p.y - 0.2, pot.z)).normalize();
          const A = out.clone().add(rng.unit(tU).multiplyScalar(0.8)).add(V3(0, -0.2, 0)).normalize();
          const Nf = V3(0, 1, 0).add(out.clone().multiplyScalar(0.4)).add(rng.unit(tU).multiplyScalar(0.5));
          const s = rng.range(0.07, 0.1);
          sets.lobed.add(basisMatrix(p, A, Nf, s), jitterColor(col(rng.weighted(MAPLE_PAL)), rng).multiplyScalar(rng.range(0.8, 1.05)));
        }
      }
    } else if (pot.plant === 'grass') {
      const n = 80;
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU, rr = Math.sqrt(rng()) * R * 0.7;
        const p = V3(pot.x + Math.cos(a) * rr, pot.soilY - 0.01, pot.z + Math.sin(a) * rr);
        const lean = rng.range(0.08, 0.55) * (0.4 + rr / R);
        const A = V3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
        const Nf = V3(Math.cos(a), -0.1, Math.sin(a)); // arch outward
        const h = rng.range(0.55, 1.05) * (pot.kind === 'tall' ? 1.05 : 0.9);
        const w = rng.range(0.028, 0.045);
        sets.blade.add(basisMatrix(p, A, Nf, w, h, h), jitterColor(col(rng.pick(GRASS_PAL)), rng));
      }
      for (let i = 0; i < 9; i++) { // feathery plumes
        const a = rng() * TAU, lean = rng.range(0.05, 0.3);
        const h = rng.range(0.85, 1.25);
        const A = V3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
        const base = V3(pot.x + Math.cos(a) * R * 0.3, pot.soilY, pot.z + Math.sin(a) * R * 0.3);
        sets.blade.add(basisMatrix(base, A, V3(Math.cos(a), 0, Math.sin(a)), 0.012, h, h), col('#a89660'));
        const tip = base.clone().addScaledVector(A, h * 0.98);
        sets.broad.add(basisMatrix(tip.addScaledVector(A, -0.05), A.clone().add(V3(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3)), V3(-Math.cos(a), 0.2, -Math.sin(a)), 0.07, 0.24, 0.07), jitterColor(col('#eadcb6'), rng));
      }
    } else if (pot.plant === 'mums' || pot.plant === 'miniMums') {
      const mini = pot.plant === 'miniMums';
      const scl = mini ? 0.35 : 1;
      // dark lobed foliage mound
      const nLeaf = mini ? 22 : 110;
      for (let i = 0; i < nLeaf; i++) {
        const u = rng.unit(tU); u.y = Math.abs(u.y) * 0.8;
        const rr = R * rng.range(0.4, 1.15);
        const p = V3(pot.x + u.x * rr, pot.soilY + rng.range(0.02, 0.3) * scl, pot.z + u.z * rr);
        const A = V3(u.x, 0.35, u.z).add(rng.unit(tmp).multiplyScalar(0.5)).normalize();
        const Nf = V3(u.x * 0.4, 1, u.z * 0.4).add(rng.unit(tmp).multiplyScalar(0.4));
        sets.lobed.add(basisMatrix(p, A, Nf, rng.range(0.06, 0.09) * (mini ? 0.5 : 1)), jitterColor(col(rng.pick(['#2c5230', '#365f34', '#2f4f2c', '#40683a'])), rng));
      }
      const nF = mini ? 6 : 26;
      for (let i = 0; i < nF; i++) {
        const a = rng() * TAU, rr = Math.sqrt(rng()) * R * 0.75;
        const base = V3(pot.x + Math.cos(a) * rr, pot.soilY - 0.01, pot.z + Math.sin(a) * rr);
        const lean = rng.range(0.05, 0.55);
        const A = V3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
        const h = rng.range(0.32, 0.62) * scl;
        const m = basisMatrix(base, A, V3(Math.cos(a), 0, Math.sin(a)), 0.012 * (mini ? 0.6 : 1), h, h).clone();
        sets.blade.add(m, col('#56723a'));
        const tip = V3(0, 1, 0.28).applyMatrix4(m);
        const face = A.clone().add(V3(0, 0.9, 0)).normalize();
        const fs = rng.range(0.055, 0.085) * (mini ? 0.55 : 1);
        sets.flower.add(basisMatrix(tip, face, perpOf(face), fs), jitterColor(col(rng.pick(pot.flowers)), rng, 0.01, 0.05, 0.04));
      }
    } else if (pot.plant === 'succulent') {
      for (let ring = 0; ring < 3; ring++) {
        const n = [5, 7, 9][ring];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + ring * 0.4 + rng.range(-0.15, 0.15);
          const tilt = [0.35, 0.75, 1.1][ring];
          const A = V3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
          const Nf = V3(-Math.cos(a) * Math.cos(tilt), Math.sin(tilt), -Math.sin(a) * Math.cos(tilt));
          const s = [0.045, 0.06, 0.07][ring];
          const cc = col(ring === 0 ? '#a7c4a0' : ring === 1 ? '#8fb39a' : '#7aa08e').lerp(col('#c98a8a'), ring === 2 ? 0.15 : 0);
          sets.broad.add(basisMatrix(c.clone().add(V3(0, 0.005, 0)), A, Nf, s * 1.2, s, s * 1.5), jitterColor(cc, rng));
        }
      }
    }
  }
}

// ------------------------------------------------------------------ ivy & hanging greenery
const IVY_GREEN = ['#2f5a2c', '#3d6c33', '#4d7c38', '#5f8a3d', '#6f9443', '#355f38'];
const IVY_GOLD = ['#a9a03a', '#c2a03a', '#d1b04a', '#b88a30'];
const IVY_RED = ['#8e2626', '#a8352a', '#c2482e', '#d4642f', '#7a2030', '#b8402c'];

function buildIvy(rng, bark, sets) {
  // keep-outs: the shop sign on the north wall, the bar (its roof covers the wall), the red door on the west wall
  const signK = { u0: SIGN.x0 - 0.15, u1: SIGN.x1 + 0.15, v0: SIGN.y0 - 0.15, v1: SIGN.y1 + 0.15 };
  const barK = { u0: BAR.x0 - 0.35, u1: WALL_E + 1, v0: -1, v1: 9 };
  const doorK = { u0: DOOR.z0 - 0.15, u1: DOOR.z1 + 0.15, v0: -1, v1: 9 };
  const walls = {
    N: { p: (u, v, o) => V3(u, v, WALL_N + o), n: V3(0, 0, 1), t: V3(1, 0, 0), u0: WALL_W + 0.08, u1: WALL_E - 0.08, keep: [signK, barK] },
    W: { p: (u, v, o) => V3(WALL_W + o, v, u), n: V3(1, 0, 0), t: V3(0, 0, 1), u0: WALL_N + 0.08, u1: WALL_S - 0.1, keep: [doorK] },
  };
  const keptOut = (w, u, v) => w.keep.some((k) => u > k.u0 && u < k.u1 && v > k.v0 && v < k.v1);
  const PLINTH = 0.47; // the stone course at the wall foot sticks out 0.11 m: vines start on top of it
  const BODY = 1.6;    // below this, guests brush the wall: leaves lie flat instead of sticking out into the walkway
  const blocked = (w, u, v) => u < w.u0 || u > w.u1 || v < PLINTH || w.keep.some((k) => u > k.u0 && u < k.u1 && v > k.v0 && v < k.v1);
  const tU = V3(), tmp = V3();
  // spatially coherent colour: evergreen ivy stays green with a few gold leaves; Boston ivy (爬山虎)
  // ramps green → gold → orange → crimson with height and a soft noise field, so mats read as patches, not confetti
  const RAMP = ['#3d6c33', '#6f8a35', '#b39a30', '#cf7a2c', '#c0482c', '#9a2c2a', '#7a2030'].map(col);
  const leafColor = (type, v, u = 0) => {
    const n = noise3(u * 0.8 + 11.3, v * 0.7, 4.2);
    let c;
    if (type === 'ivy') c = rng() < 0.08 ? col(rng.pick(IVY_GOLD)) : col(IVY_GREEN[Math.floor(n * IVY_GREEN.length * 0.999)]);
    else {
      const t = clamp((v / WALL_H) * 0.75 + (n - 0.5) * 1.1 + 0.18, 0, 0.999) * (RAMP.length - 1);
      const i = Math.floor(t);
      c = RAMP[i].clone().lerp(RAMP[i + 1], t - i);
    }
    return jitterColor(c, rng, 0.012, 0.05, 0.045).multiplyScalar(rng.range(0.78, 1.04));
  };
  const addLeaf = (w, pos, side, v, type, big = 1) => {
    const low = v < BODY;
    const A = w.t.clone().multiplyScalar(side * rng.range(0.15, 0.9)).addScaledVector(UP, rng.range(-1.0, 0.35)).addScaledVector(w.n, low ? rng.range(0.04, 0.14) : rng.range(0.2, 0.55)).normalize();
    if (pos.y < 0.3) A.y = Math.abs(A.y) + 0.25;
    const Nf = w.n.clone().addScaledVector(UP, low ? rng.range(0.0, 0.2) : rng.range(0.1, 0.6)).add(rng.unit(tmp).multiplyScalar(low ? 0.15 : 0.4));
    const s = (type === 'boston' ? rng.range(0.12, 0.18) : rng.range(0.09, 0.14)) * (1.12 - 0.28 * v / WALL_H) * big;
    sets.lobed.add(basisMatrix(pos, A, Nf, s), leafColor(type, v, pos.x + pos.z));
  };
  // A vine = stem random-walk on the wall plane that branches often and curls back upward,
  // so each origin grows into a fan-shaped mat (wider at the top) instead of a single scribble.
  const walk = (w, u, v, heading, maxLen, depth, type) => {
    const pts = [[u, v]];
    let len = 0, turned = false;
    const step = 0.075;
    while (len < maxLen) {
      heading += rng.range(-0.4, 0.4);
      heading = lerp(heading, 0, depth === 0 ? 0.1 : 0.022);
      let ok = false;
      for (const dh of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) {
        const h = heading + dh, nu = u + Math.sin(h) * step, nv = v + Math.cos(h) * step;
        if (!blocked(w, nu, nv) && nv < WALL_H - 0.08) { heading = h; u = nu; v = nv; ok = true; break; }
      }
      if (!ok) {
        if (!turned && v > WALL_H - 0.3) { turned = true; heading = rng.sign() * 1.55; continue; }
        break;
      }
      pts.push([u, v]); len += step;
      const pB = depth === 0 ? 0.09 : depth === 1 ? 0.055 : 0.025;
      if (depth < 3 && len > 0.15 && rng() < pB) walk(w, u, v, heading + rng.sign() * rng.range(1.1, 1.75), Math.max(0.35, (maxLen - len) * rng.range(0.4, 0.75)), depth + 1, type);
    }
    if (pts.length < 3) return;
    const P = pts.map(([pu, pv], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      return w.p((a[0] + pu + b[0]) / 3, (a[1] + pv + b[1]) / 3, 0.014);
    });
    const stem = P.filter((_, i) => i % 2 === 0 || i === P.length - 1);
    const r0 = [0.016, 0.011, 0.008, 0.006][depth];
    bark.tube(stem, stem.map((_, i) => lerp(r0, 0.004, i / (stem.length - 1))), { radial: 3, color: [0.5, 0.42, 0.34] });
    let side = 1;
    for (let i = 1; i < P.length; i++) {
      const x = rng();
      const nL = x < 0.08 ? 0 : x < 0.5 ? 1 : x < 0.88 ? 2 : 3;
      for (let k = 0; k < nL; k++) {
        side = -side;
        const pos = P[i].clone().addScaledVector(w.n, P[i].y < BODY ? rng.range(0.01, 0.03) : rng.range(0.02, 0.07)).addScaledVector(w.t, rng.range(-0.04, 0.04));
        addLeaf(w, pos, side, pos.y, type);
      }
    }
  };
  const vines = [
    ['N', WALL_W + 0.45, 6.0, 'boston'],               // NW corner, climbs past the sign's left edge
    ['N', (SIGN.x0 + SIGN.x1) / 2 + 0.6, 2.4, 'ivy'],  // low mat under the sign
    ['N', SIGN.x1 + 0.5, 4.5, 'boston'],               // between the sign and the bar
    ['W', DOOR.z1 + 0.45, 4.2, 'ivy'],                 // just right of the door
    ['W', -1.6, 5.0, 'boston'],                        // behind the lounge
    ['W', 1.0, 3.2, 'ivy'],
    ['W', WALL_S - 1.4, 4.5, 'boston'],                // behind the hero ginkgo
  ];
  for (const [wk, u, len, type] of vines) walk(walls[wk], u, PLINTH + 0.02, rng.range(-0.25, 0.25), len, 0, type);

  // hanging greenery along wall tops
  const strand = (w, u, len, kind) => {
    const P = [];
    const ph = rng() * TAU;
    for (let y = 0; y <= len; y += 0.065) P.push(w.p(u + Math.sin(y * 2.5 + ph) * 0.04, WALL_H - 0.04 - y, 0.03 + 0.03 * Math.sin(y * 1.7 + ph) + 0.02));
    if (P.length < 3) return;
    const stem = P.filter((_, i) => i % 2 === 0);
    bark.tube(stem, stem.map((_, i) => lerp(0.008, 0.003, i / (stem.length - 1))), { radial: 3, color: [0.45, 0.55, 0.32] });
    P.forEach((p, i) => {
      if (rng() < 0.12) return;
      const side = i % 2 ? 1 : -1;
      const A = w.t.clone().multiplyScalar(side * rng.range(0.3, 0.8)).addScaledVector(UP, rng.range(-1.0, -0.2)).addScaledVector(w.n, rng.range(0.3, 0.7)).normalize();
      const Nf = w.n.clone().addScaledVector(UP, rng.range(0.1, 0.5)).add(rng.unit(tmp).multiplyScalar(0.3));
      const pos = p.clone().addScaledVector(w.n, 0.02);
      const taper = 1 - 0.35 * (i / P.length);
      if (kind === 'pothos') {
        const s = rng.range(0.1, 0.14) * taper;
        sets.broad.add(basisMatrix(pos, A, Nf, s * 0.95, s, s), jitterColor(col(rng.pick(['#3f7a3a', '#4f8a3e', '#5f9545', '#6c9a40'])), rng));
      } else {
        sets.lobed.add(basisMatrix(pos, A, Nf, rng.range(0.09, 0.13) * taper), leafColor('ivy', 3.5));
      }
    });
  };
  const crown = (w, u, n) => {
    for (let i = 0; i < n; i++) {
      const pos = w.p(u + rng.range(-0.35, 0.35), WALL_H - rng.range(0.0, 0.16), rng.range(0.04, 0.14));
      const A = w.n.clone().multiplyScalar(rng.range(0.2, 0.8)).add(rng.unit(tU).multiplyScalar(0.7)).addScaledVector(UP, -0.2).normalize();
      const Nf = UP.clone().addScaledVector(w.n, 0.6).add(rng.unit(tmp).multiplyScalar(0.4));
      sets.lobed.add(basisMatrix(pos, A, Nf, rng.range(0.1, 0.15)), leafColor(rng() < 0.6 ? 'ivy' : 'boston', 3.4));
    }
  };
  // north wall top: left of the bar roof; above the sign only a short fringe
  for (let x = WALL_W + 0.2; x < BAR.x0 - 0.5;) {
    const nS = rng.int(2, 4);
    const kind = rng() < 0.5 ? 'pothos' : 'ivy';
    for (let j = 0; j < nS; j++) {
      const u = x + rng.range(-0.3, 0.3);
      if (u > BAR.x0 - 0.4) continue;
      const overSign = u > signK.u0 - 0.1 && u < signK.u1 + 0.1;
      const len = overSign ? WALL_H - signK.v1 - 0.06 : rng.range(0.35, 1.3);
      if (len > 0.12) strand(walls.N, u, len, kind);
    }
    crown(walls.N, x, rng.int(12, 18));
    x += rng.range(0.7, 1.6);
  }
  // west wall top, skipping the door
  for (let z = WALL_N + 0.4; z < WALL_S - 0.2;) {
    if (!(z > doorK.u0 - 0.3 && z < doorK.u1 + 0.3)) {
      const nS = rng.int(1, 3);
      for (let j = 0; j < nS; j++) strand(walls.W, z + rng.range(-0.3, 0.3), rng.range(0.3, 1.1), rng() < 0.5 ? 'pothos' : 'ivy');
      crown(walls.W, z, rng.int(8, 13));
    }
    z += rng.range(1.0, 2.0);
  }
}

// ------------------------------------------------------------------ fallen / falling leaves
const LITTER_PAL = [['#eeaa1e', 0.3], ['#f2c62a', 0.22], ['#dc8a16', 0.18], ['#c7741c', 0.1], ['#a8702e', 0.06], ['#efd25a', 0.06], ['#b4ae30', 0.05], ['#cf5e1c', 0.03]];

function litterDensity(x, z) {
  let d = 0.12;
  d += 1.5 * Math.exp(-((x - HERO.x - 1.0) ** 2 + (z - HERO.z + 0.3) ** 2) / (2 * 2.7 ** 2));
  d += 0.9 * Math.exp(-((x - SMALL.x + 0.5) ** 2 + (z - SMALL.z) ** 2) / (2 * 1.7 ** 2));
  d += 0.45 * Math.exp(-((x - (HERO.x + 3.0)) ** 2 + (z - (HERO.z - 1.2)) ** 2) / (2 * 1.9 ** 2)); // drift downwind
  d += 0.8 * Math.exp(-(x - WALL_W) / 0.4);
  d += 0.6 * Math.exp(-(z - WALL_N) / 0.4);
  d += 0.55 * Math.exp(-(WALL_E - x) / 0.4);
  d += 0.4 * Math.exp(-((z - L.deck.z0) ** 2) / 0.02); // collects along the deck seam
  if (x > ARENA.x0 && x < ARENA.x1 && z > ARENA.z0 && z < ARENA.z1) d *= 0.55;
  d *= 0.55 + 0.9 * noise3(x * 0.6 + 3.3, 0.5, z * 0.6);
  return d;
}
function litterBlocked(x, z, pots) {
  if (x < WALL_W + 0.08 || x > WALL_E - 0.1 || z < WALL_N + 0.08 || z > L.deck.z1 - 0.06) return true;
  if (x > BAR.x0 - 0.12 && x < BAR.x1 + 0.12 && z < BAR.z1 + 0.06) return true;           // counter & behind it
  if (x > LOUNGE.x0 && x < LOUNGE.x1 && z > LOUNGE.z0 - 0.1 && z < LOUNGE.z1 + 0.1) return true; // bench
  const [jx, jz] = L.spots.jukebox;
  if (Math.abs(x - jx) < 0.6 && Math.abs(z - jz) < 0.5) return true;
  if ((x - HERO.x) ** 2 + (z - HERO.z) ** 2 < 0.55 ** 2) return true;
  if ((x - SMALL.x) ** 2 + (z - SMALL.z) ** 2 < 0.34 ** 2) return true;
  for (const p of pots) if (!p.noCollider && (x - p.x) ** 2 + (z - p.z) ** 2 < (p.maxR + 0.06) ** 2) return true;
  return false;
}
// where a falling leaf comes to rest
function surfaceY(x, z) {
  if (z > L.deck.z1 && SEA.inside(x, z)) {
    if (onStairs(x, z)) {
      const k = clamp(Math.floor((z - STEP0.z0) / L.stairs.depth), 0, L.stairs.steps - 1);
      return Math.max(STEP0.y - k * L.stairs.drop, L.WATER_Y) + 0.012;
    }
    return L.WATER_Y + 0.012;
  }
  if (x > BAR.x0 && x < BAR.x1 && z > BAR.z0 && z < BAR.z1) return BAR.y + 0.006;
  return 0;
}

// ------------------------------------------------------------------ main factory
export function createPlants({ scene, renderer } = {}) {
  const rng = makeRng(0x7a1a0);
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  const group = new THREE.Group();
  group.name = 'plants';
  const uniforms = { uTime: { value: 0 }, uShake: { value: 0 }, uFocus: { value: new THREE.Vector2(8, 1.8) } };

  // --- textures & materials (shared)
  const tex = { ginkgo: makeGinkgoTexture(aniso), bark: makeBarkTextures(makeRng(11), aniso), pot: makePotTexture(makeRng(12), aniso) };
  const canopyWind = { sway: 0.07, swayBase: 3.0, flutter: 0.2 };
  const mats = {
    bark: addNearFade(new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.95, metalness: 0, vertexColors: true }), 1.0, 2.6, uniforms),
    canopy: patchFoliage(new THREE.MeshLambertMaterial({ map: tex.ginkgo, side: THREE.DoubleSide }), { ...canopyWind, translucency: 0.9, glow: 0.12, nearFade: [1.2, 3.4] }, uniforms),
    canopyDepth: makeWindDepthMaterial(canopyWind, uniforms),
    litter: patchFoliage(new THREE.MeshLambertMaterial({ map: tex.ginkgo, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { wind: false, translucency: 0.3, glow: 0.07 }, uniforms),
    foliage: patchFoliage(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { sway: 0.012, swayBase: 0.2, flutter: 0.13, bend: 0.05, translucency: 0.6, glow: 0.05 }, uniforms),
    pot: new THREE.MeshStandardMaterial({ map: tex.pot, vertexColors: true, roughness: 1, metalness: 0 }),
    pad: patchFoliage(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { wind: false, translucency: 0.25, glow: 0.04 }, uniforms),
  };
  mats.pot.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRough;\nvarying float vRough;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRough;').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vRough;');
  };
  mats.pot.customProgramCacheKey = () => 'tiaohai-pot';

  // --- geometry generation
  const bark = new TubeBuilder();
  const canopy = new InstSet(), far = new InstSet(), pads = new InstSet();
  const sets = { broad: new InstSet(), lobed: new InstSet(), blade: new InstSet(), flower: new InstSet() };

  const hero = buildGinkgo(HERO_CFG, rng, bark, canopy);
  const small = buildGinkgo(SMALL_CFG, rng, bark, canopy);
  const isle = buildGinkgo(ISLAND_CFG, rng, bark, canopy);
  buildBackgroundTrees(rng, bark, far, sets.blade);
  const { geometry: potGeo, pots } = buildPotGeometry(rng);
  buildPotPlants(pots, rng, sets, bark);
  buildIvy(rng, bark, sets);
  buildShore(rng, sets);
  buildLilies(rng, pads, sets.flower);

  const add = (o) => { group.add(o); return o; };
  const barkMesh = add(new THREE.Mesh(bark.geometry(), mats.bark));
  barkMesh.castShadow = barkMesh.receiveShadow = true; barkMesh.name = 'plants-wood';
  barkMesh.matrixAutoUpdate = false;

  const canopyGeo = ginkgoGeometry({ angles: [-1, -0.7, -0.42, -0.15, 0, 0.15, 0.42, 0.7, 1], rings: [1], cup: 0.2, curl: -0.06, lowPetiole: true });
  const canopyMesh = add(canopy.mesh(canopyGeo, mats.canopy, { name: 'plants-ginkgo-canopy' }));
  canopyMesh.customDepthMaterial = mats.canopyDepth;
  // distant trees: 5-tri leaves, no shadow casting (they sit outside the shadow frustum anyway)
  const farGeo = ginkgoGeometry({ angles: [-1, -0.38, 0, 0.38, 1], rings: [1], cup: 0.2, curl: -0.06, lowPetiole: true });
  add(far.mesh(farGeo, mats.canopy, { name: 'plants-far-canopy', cast: false, receive: false }));
  add(pads.mesh(padGeometry(), mats.pad, { name: 'plants-lily-pads', cast: false }));

  const potMesh = add(new THREE.Mesh(potGeo, mats.pot));
  potMesh.castShadow = potMesh.receiveShadow = true; potMesh.name = 'plants-pots'; potMesh.matrixAutoUpdate = false;
  add(sets.broad.mesh(broadLeafGeometry(), mats.foliage, { name: 'plants-broadleaf' }));
  add(sets.lobed.mesh(lobedLeafGeometry(), mats.foliage, { name: 'plants-lobedleaf' }));
  add(sets.blade.mesh(bladeGeometry(), mats.foliage, { name: 'plants-blades' }));
  add(sets.flower.mesh(flowerGeometry(), mats.foliage, { name: 'plants-flowers', cast: false }));

  // --- fallen leaves (static) + floating + falling (dynamic) in ONE instanced mesh
  const NG = 520, NF = 30, NA = 48, NB = 32;
  const NDYN = NF + NA + NB, NTOT = NG + NDYN;
  const litterGeo = ginkgoGeometry({ angles: [-1, -0.7, -0.42, -0.15, 0, 0.15, 0.42, 0.7, 1], rings: [0.55, 1], cup: 0.16, curl: 0.05 });
  const litter = new THREE.InstancedMesh(litterGeo, mats.litter, NTOT);
  litter.name = 'plants-leaf-litter';
  litter.receiveShadow = true; litter.castShadow = false;
  litter.frustumCulled = false;
  litter.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  add(litter);

  const qFlat = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -Math.PI / 2);
  const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler(0, 0, 0, 'YXZ'), sTmp = V3(), pTmp = V3(), mTmp = new THREE.Matrix4();
  const flatMatrix = (x, y, z, yaw, pitch, roll, s, flip = false) => {
    eTmp.set(pitch, yaw, roll + (flip ? Math.PI : 0));
    qTmp.setFromEuler(eTmp).multiply(qFlat);
    return mTmp.compose(pTmp.set(x, y, z), qTmp, sTmp.set(s, s, s));
  };
  const litterPal = LITTER_PAL.map(([h, w]) => [col(h), w]);
  {
    let placed = 0, guard = 0;
    const put = (x, z) => {
      if (litterBlocked(x, z, pots)) return false;
      const s = rng.range(0.115, 0.155);
      const y = 0.014 + rng() * 0.014; // sits on top of rugs (~0.012) too
      litter.setMatrixAt(placed, flatMatrix(x, y, z, rng() * TAU, rng.range(-0.12, 0.12), rng.range(-0.12, 0.12), s, rng() < 0.3));
      const c = jitterColor(rng.weighted(litterPal), rng, 0.01, 0.06, 0.05).multiplyScalar(rng.range(0.82, 1.02));
      litter.setColorAt(placed, c);
      placed++;
      return true;
    };
    while (placed < NG && guard++ < 200000) {
      const x = rng.range(WALL_W, WALL_E), z = rng.range(WALL_N, 9.0);
      if (rng() * 2.6 > litterDensity(x, z)) continue;
      if (!put(x, z)) continue;
      if (rng() < 0.22) { // little drifts
        const k = rng.int(2, 5);
        for (let i = 0; i < k && placed < NG; i++) put(x + rng.gauss() * 0.14, z + rng.gauss() * 0.14);
      }
    }
    for (let i = placed; i < NG; i++) litter.setMatrixAt(i, mTmp.makeScale(0, 0, 0));
  }

  // dynamic state
  const D = {
    x: new Float32Array(NDYN), y: new Float32Array(NDYN), z: new Float32Array(NDYN),
    vx: new Float32Array(NDYN), vy: new Float32Array(NDYN), vz: new Float32Array(NDYN),
    ph: new Float32Array(NDYN), om: new Float32Array(NDYN), rad: new Float32Array(NDYN), vt: new Float32Array(NDYN),
    yaw: new Float32Array(NDYN), s: new Float32Array(NDYN), tm: new Float32Array(NDYN), age: new Float32Array(NDYN),
    spin: new Float32Array(NDYN), st: new Uint8Array(NDYN), flip: new Uint8Array(NDYN),
  };
  const S_IDLE = 0, S_FALL = 1, S_LAND = 2, S_WATER = 3, S_FADE = 4, S_FLOAT = 5;
  const dynCol = [col('#f4c43a'), col('#f7dd55'), col('#eba62c'), col('#da8a27'), col('#d0c64a')];
  for (let i = 0; i < NDYN; i++) litter.setColorAt(NG + i, jitterColor(rng.pick(dynCol), rng));

  const spawnFromCanopy = (i) => {
    const r = rng(), src = r < 0.66 ? hero.spawn : r < 0.9 ? small.spawn : isle.spawn;
    const k = Math.floor(rng() * (src.length / 3)) * 3;
    D.x[i] = src[k] + rng.range(-0.2, 0.2); D.y[i] = src[k + 1] - 0.1; D.z[i] = src[k + 2] + rng.range(-0.2, 0.2);
    D.vx[i] = 0; D.vy[i] = 0; D.vz[i] = 0;
    D.vt[i] = rng.range(0.45, 0.8); D.om[i] = rng.range(1.6, 3.2) * rng.sign(); D.rad[i] = rng.range(0.12, 0.42);
    D.ph[i] = rng() * TAU; D.yaw[i] = rng() * TAU; D.s[i] = rng.range(0.1, 0.13); D.age[i] = 0; D.spin[i] = 0; D.tm[i] = 0;
    D.flip[i] = rng() < 0.4 ? 1 : 0;
    D.st[i] = S_FALL;
  };
  // floating leaves on the lagoon: drifted in from the hero tree, the second ginkgo and the islet
  for (let i = 0; i < NF; i++) {
    for (let g = 0; g < 200; g++) {
      const r = rng();
      const [cx, cz, sx, sz] = r < 0.55 ? [HERO.x + 1, 7.5, 3.5, 1.8] : r < 0.75 ? [SMALL.x - 0.5, 7.2, 2.5, 1.5] : [ISLAND.x, ISLAND.z - 1, 3.5, 3];
      D.x[i] = cx + rng.gauss() * sx * 0.6; D.z[i] = cz + rng.gauss() * sz * 0.6;
      if (SEA.inside(D.x[i], D.z[i]) && SEA.shoreDist(D.x[i], D.z[i]) > 0.5 && !onStairs(D.x[i], D.z[i]) && Math.hypot(D.x[i] - ISLAND.x, D.z[i] - ISLAND.z) > ISLAND.r + 0.4) break;
    }
    D.ph[i] = rng() * TAU; D.om[i] = rng.range(0.05, 0.12) * rng.sign(); D.rad[i] = rng.range(0.1, 0.35);
    D.yaw[i] = rng() * TAU; D.s[i] = rng.range(0.09, 0.12); D.st[i] = S_FLOAT; D.flip[i] = rng() < 0.3 ? 1 : 0;
  }
  // ambient falling leaves: stagger their life cycle
  for (let j = 0; j < NA; j++) {
    const i = NF + j;
    spawnFromCanopy(i);
    const f = rng();
    D.y[i] = lerp(0.3, D.y[i], f);
    D.vy[i] = -D.vt[i];
    D.age[i] = 1;
  }
  let burstNext = 0;

  let wx = 0.3, wz = 0.1, tNow = 0;
  const writeDyn = (i, x, y, z, yaw, pitch, roll, s) => litter.setMatrixAt(NG + i, flatMatrix(x, y, z, yaw, pitch, roll, s, D.flip[i] === 1));

  function update(t, dt) {
    dt = Math.min(Math.max(dt ?? 0.016, 0), 0.05);
    tNow = t;
    uniforms.uTime.value = t;
    uniforms.uShake.value = Math.max(0, uniforms.uShake.value - dt * 0.7);
    wx = 0.32 + 0.22 * Math.sin(t * 0.13) + 0.1 * Math.sin(t * 0.71);
    wz = 0.1 * Math.sin(t * 0.07 + 1.0);

    for (let i = 0; i < NDYN; i++) {
      const st = D.st[i];
      if (st === S_IDLE) { litter.setMatrixAt(NG + i, mTmp.makeScale(0, 0, 0)); continue; }
      if (st === S_FLOAT) {
        const a = D.ph[i] + t * D.om[i];
        const x = D.x[i] + Math.cos(a) * D.rad[i], z = D.z[i] + Math.sin(a) * D.rad[i];
        const y = L.WATER_Y + 0.012 + 0.006 * Math.sin(t * 1.3 + D.ph[i] * 3);
        writeDyn(i, x, y, z, D.yaw[i] + t * D.om[i] * 0.8, 0.05 * Math.sin(t * 1.1 + D.ph[i]), 0.05 * Math.cos(t * 0.9 + D.ph[i]), D.s[i]);
        continue;
      }
      if (st === S_FALL) {
        D.age[i] += dt;
        D.vy[i] -= 5.5 * dt;
        if (D.vy[i] < -D.vt[i]) D.vy[i] += (-D.vt[i] - D.vy[i]) * Math.min(1, dt * 4);
        const k = Math.min(1, dt * 1.3);
        D.vx[i] += (wx - D.vx[i]) * k; D.vz[i] += (wz - D.vz[i]) * k;
        let nx = D.x[i] + D.vx[i] * dt, nz = D.z[i] + D.vz[i] * dt;
        const ny = D.y[i] + D.vy[i] * dt;
        // walls: never pass through below the wall top
        if (ny < WALL_H + 0.3) {
          if (nz < WALL_S && ((D.x[i] >= WALL_W) !== (nx >= WALL_W))) nx = D.x[i];
          if (nz < WALL_S && ((D.x[i] <= WALL_E) !== (nx <= WALL_E))) nx = D.x[i];
          if ((D.z[i] >= WALL_N) !== (nz >= WALL_N)) nz = D.z[i];
        }
        // slide off table tops
        if (ny < 0.95) {
          const R = TABLE_R + 0.1;
          for (const [tx, tz] of TABLES) {
            const dx = nx - tx, dz = nz - tz, d2 = dx * dx + dz * dz;
            if (d2 < R * R) { const d = Math.sqrt(d2) || 1; nx = tx + (dx / d) * R; nz = tz + (dz / d) * R; }
          }
          if (nx < LOUNGE.x1 + 0.05 && nz > LOUNGE.z0 && nz < LOUNGE.z1) nx = LOUNGE.x1 + 0.05; // slide off the bench
        }
        D.x[i] = nx; D.y[i] = ny; D.z[i] = nz;
        D.ph[i] += D.om[i] * dt;
        D.spin[i] *= Math.exp(-dt * 1.5);
        const fl = clamp(-D.vy[i] / D.vt[i], 0, 1);
        const rx = Math.cos(D.ph[i]) * D.rad[i] * fl, rz = Math.sin(D.ph[i]) * D.rad[i] * fl;
        const px = nx + rx, pz = nz + rz, py = ny + 0.06 * Math.sin(D.ph[i] * 2) * fl;
        const sY = surfaceY(px, pz);
        if (py <= sY + 0.01) {
          D.x[i] = px; D.z[i] = pz; D.y[i] = sY + 0.003 + rng() * 0.012;
          D.yaw[i] += D.ph[i] * 0.5;
          if (sY < L.WATER_Y + 0.05) { D.st[i] = S_WATER; D.tm[i] = rng.range(6, 11); } else { D.st[i] = S_LAND; D.tm[i] = rng.range(3, 7); }
          writeDyn(i, D.x[i], D.y[i], D.z[i], D.yaw[i], 0, 0, D.s[i]);
          continue;
        }
        const grow = Math.min(1, D.age[i] / 0.35);
        D.tm[i] += D.spin[i] * dt; // tumble angle (burst leaves)
        const pitch = 0.85 * Math.sin(D.ph[i]) * fl + D.tm[i];
        const roll = 0.45 * Math.cos(D.ph[i] * 0.5) * fl;
        writeDyn(i, px, py, pz, D.yaw[i] + D.ph[i] * 0.5, pitch, roll, D.s[i] * grow);
        continue;
      }
      if (st === S_LAND || st === S_WATER) {
        D.tm[i] -= dt;
        if (st === S_WATER) { D.x[i] += wx * 0.04 * dt; D.yaw[i] += 0.05 * dt; }
        const bob = st === S_WATER ? 0.005 * Math.sin(t * 1.3 + i) : 0;
        writeDyn(i, D.x[i], D.y[i] + bob, D.z[i], D.yaw[i], 0, 0, D.s[i]);
        if (D.tm[i] <= 0) { D.st[i] = S_FADE; D.tm[i] = 1.2; }
        continue;
      }
      if (st === S_FADE) {
        D.tm[i] -= dt;
        const f = Math.max(0, D.tm[i] / 1.2);
        writeDyn(i, D.x[i], D.y[i] - (1 - f) * 0.004, D.z[i], D.yaw[i], 0, 0, D.s[i] * f);
        if (D.tm[i] <= 0) {
          if (i >= NF && i < NF + NA) spawnFromCanopy(i); else D.st[i] = S_IDLE;
        }
      }
    }
    litter.instanceMatrix.clearUpdateRanges();
    litter.instanceMatrix.addUpdateRange(NG * 16, NDYN * 16);
    litter.instanceMatrix.needsUpdate = true;
  }

  function leafBurst(x, y, z, count = 20) {
    for (let k = 0; k < count; k++) {
      const i = NF + NA + (burstNext++ % NB);
      const a = rng() * TAU, sp = rng.range(0.5, 1.9);
      D.x[i] = x + rng.range(-0.25, 0.25); D.y[i] = y + rng.range(-0.15, 0.25); D.z[i] = z + rng.range(-0.25, 0.25);
      D.vx[i] = Math.cos(a) * sp; D.vz[i] = Math.sin(a) * sp; D.vy[i] = rng.range(1.2, 2.8);
      D.vt[i] = rng.range(0.45, 0.75); D.om[i] = rng.range(1.8, 3.4) * rng.sign(); D.rad[i] = rng.range(0.1, 0.35);
      D.ph[i] = rng() * TAU; D.yaw[i] = rng() * TAU; D.s[i] = rng.range(0.1, 0.13); D.age[i] = 0;
      D.spin[i] = rng.range(-6, 6); D.tm[i] = 0; D.flip[i] = rng() < 0.4 ? 1 : 0;
      D.st[i] = S_FALL;
    }
    const near = (p, r) => (x - p.x) ** 2 + (z - p.z) ** 2 < r * r;
    if (near(HERO, 4.5) || near(SMALL, 3)) uniforms.uShake.value = 1;
  }

  // --- colliders
  const colliders = [{ x: HERO.x, z: HERO.z, r: 0.56 }, { x: SMALL.x, z: SMALL.z, r: 0.34 }];
  for (const p of pots) if (!p.noCollider) colliders.push({ x: p.x, z: p.z, r: +(p.maxR + 0.08).toFixed(2) });

  update(0, 0);
  scene?.add(group);

  function dispose() {
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    Object.values(mats).forEach((m) => m.dispose());
    tex.ginkgo.dispose(); tex.bark.map.dispose(); tex.bark.normal.dispose(); tex.pot.dispose();
    group.parent?.remove(group);
  }

  // Optional: distance from the camera to what it looks at (the player). Leaves/branches between the camera and
  // that point dither out. Defaults to 8 m (main.js S.dist); call it when the camera zooms. 0 disables the tunnel.
  function setViewFocus(distance, radius = 1.8) { uniforms.uFocus.value.set(distance, radius); }

  return {
    update, colliders, leafBurst, setViewFocus, group, dispose,
    stats: { heroLeaves: hero.count, smallLeaves: small.count, isleLeaves: isle.count, farLeaves: far.count, litter: NG, lobed: sets.lobed.count, broad: sets.broad.count, blades: sets.blade.count, flowers: sets.flower.count, pads: pads.count },
  };
}
