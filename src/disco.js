import * as THREE from 'three';
import { LAYOUT as L } from './layout.js';
import { L as tr, isEn } from './i18n.js'; // L is the layout here

// 灯光总闸: a huge old porcelain rotary switch on the east wall. Each turn (E) moves it on a quarter:
//   常亮 (the normal dusk) → 蹦迪 (mirror ball, beams, chasing bulbs, surf on the lagoon) → 万圣 (green moon, fog,
//   flickering lanterns, the skeleton dance — see scene/halloween.js) → 熄灯 (lights out under a moon) → 常亮 …
// Shared by the room (retained state). The ambient of each mode is blended, so turning it always fades.

const BPM = 124;
export const LIGHT_MODES = ['normal', 'disco', 'halloween', 'dark'];
const WALL_X = L.walls.eastX - L.walls.thick / 2; // inner face of the east wall
const SW_Z = -1.6;
export const DISCO_SWITCH = new THREE.Vector3(WALL_X - 0.85, 0, SW_Z); // where you stand to pull it
const BALL = new THREE.Vector3(-0.5, 3.75, 0.6);
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---- tiny synth for the switch: a big clunk + a rising zap ----
let actx = null;
function clunk(on) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime, out = actx.createGain(); out.gain.value = 0.5; out.connect(actx.destination);
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
    if (on) {
      const z = actx.createOscillator(), zg = actx.createGain(); z.type = 'sawtooth'; z.frequency.setValueAtTime(180, t + 0.05); z.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
      zg.gain.setValueAtTime(0.0001, t); zg.gain.exponentialRampToValueAtTime(0.18, t + 0.12); zg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7); z.connect(zg).connect(out); z.start(t); z.stop(t + 0.75);
    }
  } catch {}
}

export function createDisco(scene, { env, bulbs, quality = 'high' }) {
  const G = new THREE.Group(); G.name = 'disco'; scene.add(G);
  const state = { mode: 'normal', target: 0, lever: 0, leverV: 0, kD: 0, kH: 0, kN: 0 }; // lever counts quarter turns (always clockwise)

  // ---------- the switch: a giant old European porcelain rotary switch (Drehschalter) ----------
  const sw = new THREE.Group(); sw.position.set(WALL_X - 0.005, 0, SW_Z); sw.rotation.y = -Math.PI / 2; sw.scale.setScalar(1.25); G.add(sw); // local +z = out of the wall
  const SY = 1.42; // switch centre height (local)
  const walnut = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.45 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.12, metalness: 0 });
  const bakelite = new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.18, metalness: 0.1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.95, roughness: 0.25 });
  const onWall = (o, x, y, z = 0) => { o.position.set(x, y, z); o.castShadow = true; sw.add(o); return o; };
  // round walnut pattress + porcelain dome
  const pat = onWall(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.06, 48), walnut), 0, SY, 0.03); pat.rotation.x = Math.PI / 2;
  const prof = [[0.31, 0], [0.313, 0.05], [0.308, 0.085], [0.295, 0.108], [0.275, 0.124], [0.25, 0.13], [0, 0.13]].map(([r, y]) => new THREE.Vector2(r, y));
  const dome = onWall(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), porcelain), 0, SY, 0.06); dome.rotation.x = Math.PI / 2; // flat-topped porcelain body
  const faceTex = canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.strokeStyle = '#8a7a66'; x.lineWidth = 3; x.beginPath(); x.arc(w / 2, h / 2, 118, 0, 7); x.stroke();
    x.fillStyle = '#6b5a48'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'italic 600 19px Georgia, serif'; x.fillText('Disco · 1926', w / 2, h / 2 + 88);
  });
  const face = onWall(new THREE.Mesh(new THREE.CircleGeometry(0.245, 48), new THREE.MeshStandardMaterial({ map: faceTex, transparent: true, roughness: 0.15 })), 0, SY, 0.1915); face.castShadow = false;
  // AUS / EIN printed on the walnut ring, where the pointer lands
  const ringTex = canvasTex(512, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 34px Georgia, "Times New Roman", serif';
    const lab = (txt, deg, col) => { const a = deg * Math.PI / 180, r = 222; x.save(); x.translate(w / 2 + Math.cos(a) * r, h / 2 - Math.sin(a) * r); x.rotate(-(a - Math.PI / 2)); x.fillStyle = col; x.fillText(txt, 0, 0); x.restore(); };
    x.font = isEn ? '900 26px system-ui,sans-serif' : '900 34px "PingFang SC","Noto Sans SC",sans-serif';
    lab(tr('常亮', 'ON'), 135, '#f1e6d2'); lab(tr('蹦迪', 'DISCO'), 45, '#ff8ad6'); lab(tr('万圣', 'SPOOKY'), -45, '#ffab4a'); lab(tr('熄灯', 'OFF'), -135, '#a9bcff');
  });
  const ring = onWall(new THREE.Mesh(new THREE.RingGeometry(0.315, 0.415, 64), new THREE.MeshStandardMaterial({ map: ringTex, transparent: true, roughness: 0.4 })), 0, SY, 0.0605); ring.castShadow = false;
  // the wing knob (Flügelknebel): turns a quarter clockwise to switch on
  const knobG = new THREE.Group(); knobG.position.set(0, SY, 0.19); sw.add(knobG);
  const wingG = new THREE.Group(); wingG.rotation.z = Math.PI * 0.75; knobG.add(wingG); // at rest the wing points at AUS (upper left)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.09, 32), bakelite); hub.rotation.x = Math.PI / 2; hub.position.z = 0.045; hub.castShadow = true; knobG.add(hub);
  const wingShape = new THREE.Shape(); wingShape.moveTo(-0.21, -0.035); wingShape.quadraticCurveTo(-0.24, 0, -0.21, 0.035); wingShape.lineTo(-0.06, 0.06); wingShape.lineTo(0.06, 0.06); wingShape.lineTo(0.21, 0.035); wingShape.quadraticCurveTo(0.24, 0, 0.21, -0.035); wingShape.lineTo(0.06, -0.06); wingShape.lineTo(-0.06, -0.06); wingShape.closePath();
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3 }), bakelite); wing.position.z = 0.05; wing.castShadow = true; wingG.add(wing);
  const capB = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), brass); capB.rotation.x = Math.PI / 2; capB.position.z = 0.135; knobG.add(capB);
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.014, 0.006), new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.3 })); pointer.position.set(0.15, 0, 0.136); wingG.add(pointer);
  for (const [sx, sy] of [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]]) { const sc = onWall(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12), brass), sx * 0.95, SY + sy * 0.95, 0.066); sc.rotation.x = Math.PI / 2; }
  // twisted cloth cable up the wall on porcelain cleats
  const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, SY + 0.36, 0.05), new THREE.Vector3(0.04, SY + 0.6, 0.05), new THREE.Vector3(0.55, SY + 0.82, 0.05), new THREE.Vector3(0.78, SY + 1.1, 0.05), new THREE.Vector3(0.8, 2.75, 0.05)]);
  const cloth = new THREE.MeshStandardMaterial({ color: 0xa4743a, roughness: 0.85 });
  for (const ph of [0, Math.PI]) {
    const pts = []; for (let i = 0; i <= 120; i++) { const u = i / 120, p = path.getPointAt(u), tw = u * 60 + ph; pts.push(new THREE.Vector3(p.x + Math.cos(tw) * 0.012, p.y, p.z + Math.sin(tw) * 0.012)); }
    sw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.011, 6), cloth));
  }
  for (const u of [0.18, 0.52, 0.8]) { const p = path.getPointAt(u); const cl = onWall(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 14), porcelain), p.x, p.y, 0.025); cl.rotation.x = Math.PI / 2; }
  // engraved brass plate + a pilot lamp in a brass bezel
  const plateTex = canvasTex(320, 96, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e2c06a'); g.addColorStop(1, '#a8812e'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#7a5a1c'; x.lineWidth = 4; x.strokeRect(6, 6, w - 12, h - 12);
    x.fillStyle = '#3d2a0c'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = isEn ? '900 34px system-ui,sans-serif' : '900 40px "PingFang SC","Noto Sans SC",serif'; x.fillText(tr('灯光总闸', 'MAIN LIGHTS'), w / 2, h / 2 + 2);
  });
  onWall(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.015), [brass, brass, brass, brass, new THREE.MeshStandardMaterial({ map: plateTex, metalness: 0.7, roughness: 0.35 }), brass]), 0, SY - 0.58, 0.01);
  const bezel = onWall(new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 10, 24), brass), 0.56, SY - 0.2, 0.03);
  const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0xff2a2a, 1.5) });
  const lamp = onWall(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lampMat), 0.56, SY - 0.2, 0.03); lamp.rotation.x = Math.PI / 2; lamp.castShadow = false;
  // neon "蹦迪!" above (left of the cable)
  const neonWord = (txt) => canvasTex(512, 200, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.font = isEn ? '900 120px system-ui,sans-serif' : '900 150px "PingFang SC","Noto Sans SC",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 14; x.strokeStyle = 'rgba(255,255,255,0.35)'; x.strokeText(txt, w / 2, h / 2 + 6); x.fillStyle = '#fff'; x.fillText(txt, w / 2, h / 2 + 6);
  });
  const neonTex = neonWord(tr('蹦迪!', 'DISCO!')), neonHal = neonWord(tr('万圣!', 'BOO!'));
  const neonMat = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, depthWrite: false, color: hdr(0xff4fa8, 0.6) });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.45), neonMat); neon.position.set(-0.25, 2.5, 0.03); sw.add(neon);
  // sparks from the knob when it turns
  const SPARKS = 48, sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: hdr(0xfff1a0, 3), size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparkPts.frustumCulled = false; sparkPts.visible = false; sw.add(sparkPts);
  const sv = []; for (let i = 0; i < SPARKS; i++) sv.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 });
  function burst() { for (const q of sv) { const a = Math.random() * Math.PI * 2; q.p.set(Math.cos(a) * 0.3, SY + Math.sin(a) * 0.3, 0.2); q.v.set(Math.cos(a) * 1.6, Math.sin(a) * 1.6 + 1.2, Math.random() * 2); q.life = 0.4 + Math.random() * 0.5; } sparkPts.visible = true; }

  // ---------- mirror ball ----------
  const ballG = new THREE.Group(); ballG.position.copy(BALL).setY(7.5); G.add(ballG);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), new THREE.MeshStandardMaterial({ color: 0xe6ecff, metalness: 1, roughness: 0.08, flatShading: true, envMapIntensity: 3, emissive: 0x16141f }));
  ball.castShadow = false; ballG.add(ball);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 6, 6), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.4 })); chain.position.y = 3.4; ballG.add(chain);
  const glintGeo = new THREE.BufferGeometry(); const gp = [], gc = [];
  const ico = new THREE.IcosahedronGeometry(0.43, 2).attributes.position; for (let i = 0; i < ico.count; i += 7) { gp.push(ico.getX(i), ico.getY(i), ico.getZ(i)); gc.push(1, 1, 1); }
  glintGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); glintGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  const glints = new THREE.Points(glintGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  ball.add(glints);
  const light = new THREE.PointLight(0xff66cc, 0, 18, 1.4); light.position.copy(BALL).add(new THREE.Vector3(0, -0.6, 0)); G.add(light); // always in the scene (intensity 0 when off) so toggling never recompiles shaders

  // ---------- beams ----------
  const beamMat = (color) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uAlpha: { value: 0 }, uLen: { value: 7 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying float vT; varying vec3 vN; varying vec3 vV; uniform float uLen; void main(){ vT = clamp(position.z / uLen, 0., 1.); vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vT; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float a = uAlpha * edge * (1. - vT) * smoothstep(0., .06, vT); gl_FragColor = vec4(uColor, a); }',
  });
  const beamGeo = (len, r) => new THREE.ConeGeometry(r, len, 24, 1, true).translate(0, -len / 2, 0).rotateX(-Math.PI / 2);
  const PALETTE = [0xff2d95, 0x2de2ff, 0xffe02d, 0x7c4dff, 0x39ff88, 0xff6a2d];
  const beams = [];
  const heads = quality === 'low' ? [[-8, 3.3, -6.3], [8, 3.3, 3.7]] : [[-8, 3.3, -6.3], [8, 3.3, -6.3], [-8, 3.3, 3.7], [8, 3.3, 3.7]];
  heads.forEach((h, i) => { // moving-head fixtures on the wall tops
    const piv = new THREE.Group(); piv.position.set(...h); G.add(piv);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.4, metalness: 0.5 })); box.position.set(...h); G.add(box);
    const m = beamMat(hdr(PALETTE[i % PALETTE.length], 1.6)), b = new THREE.Mesh(beamGeo(9, 0.75), m); m.uniforms.uLen.value = 9; piv.add(b);
    beams.push({ piv, m, ph: i * 1.7, base: new THREE.Vector3(-0.5, 0, -1.2), r: 4.5, hue: i / heads.length });
  });
  for (let i = 0; i < (quality === 'low' ? 3 : 5); i++) { // thin beams thrown by the mirror ball
    const piv = new THREE.Group(); piv.position.copy(BALL); G.add(piv);
    const m = beamMat(hdr(PALETTE[(i + 2) % PALETTE.length], 1.3)), b = new THREE.Mesh(beamGeo(6.5, 0.32), m); m.uniforms.uLen.value = 6.5; piv.add(b);
    beams.push({ piv, m, ph: 10 + i * 2.3, base: new THREE.Vector3(BALL.x, 0, BALL.z), r: 5.5, hue: (i + 0.5) / 5, ball: true });
  }

  // ---------- mirror-ball dots + colour spots on the paving ----------
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uBeat: { value: 0 }, uC: { value: new THREE.Vector2(BALL.x, BALL.z) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime, uOn, uBeat; uniform vec2 uC; varying vec2 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 hue(float h){ return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0., .33, .67))); }
      void main(){
        vec2 p = vP - uC; float r = length(p); float a = atan(p.y, p.x) + uTime * 0.32;
        vec2 g = vec2(a * 8. / 3.14159 * (1. + floor(r * 1.1) * .35), r * 2.3); vec2 cell = floor(g); vec2 f = fract(g) - .5;
        float h = hash(cell); float dots = smoothstep(.2, .1, length(f)) * step(.45, h) * (.7 + .6 * fract(h * 7. + uTime * 2.));
        vec3 col = mix(vec3(1.), hue(h + uTime * .05), .72) * dots * 1.25;
        for (int i = 0; i < 3; i++) { float fi = float(i); vec2 c = uC + vec2(sin(uTime * (.5 + fi * .17) + fi * 2.1), cos(uTime * (.43 + fi * .11) + fi)) * (3.2 + fi);
          col += hue(fi / 3. + uTime * .07) * smoothstep(1.9, .2, length(vP - c)) * (.55 + .65 * uBeat); }
        col *= uOn * smoothstep(9., 5.5, r);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(17, 11), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.025, -1.3); floor.visible = false; floor.renderOrder = 2; G.add(floor);

  // ---------- string lights + ambient ----------
  const orig = bulbs?.instanceColor ? bulbs.instanceColor.array.slice() : null;
  const _c = new THREE.Color(), _t = new THREE.Vector3();

  // the yard's own lamps and glowing materials (collected now: the halloween set and the players come later)
  const under = (o, g) => { for (let p = o; p; p = p.parent) if (p === g) return true; return false; };
  const named = (o, n) => { for (let p = o; p; p = p.parent) if (p.name === n) return true; return false; };
  const lamps = [], glows = [], seen = new Set();
  scene.traverse((o) => {
    if ((o.isPointLight || o.isSpotLight) && !under(o, G)) lamps.push({ l: o, i: o.intensity });
    if (!o.isMesh || under(o, G) || named(o, 'neighbours') || o === bulbs) return; // the neighbours keep their windows lit
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m)) continue; seen.add(m);
      if (m.emissive && m.emissiveIntensity > 0 && m.emissive.r + m.emissive.g + m.emissive.b > 0.05) glows.push({ m, e: m.emissiveIntensity });
      else if (m.isMeshBasicMaterial && Math.max(m.color.r, m.color.g, m.color.b) > 1.2) glows.push({ m, c: m.color.clone() });
    }
  });
  const sky = env?.sky?.material?.uniforms;
  const base = { sun: env?.sun?.intensity ?? 0, sunC: env?.sun?.color.clone(), hemi: env?.hemi?.intensity ?? 0, hemiC: env?.hemi?.color.clone(), hemiG: env?.hemi?.groundColor.clone(), rim: env?.rim?.intensity ?? 0, rimC: env?.rim?.color.clone(),
    envI: scene.environmentIntensity ?? 1, fog: scene.fog?.color.clone(), fogN: scene.fog?.near, fogF: scene.fog?.far, bg: scene.background?.isColor ? scene.background.clone() : null };
  // per-mode looks: [normal, disco, halloween, dark]
  const LOOK = {
    sun: [1, 0.28, 0.35, 0.22], sunC: [base.sunC, base.sunC, new THREE.Color(0x9affc8), new THREE.Color(0xa8b8ff)],
    hemi: [1, 0.38, 0.5, 0.4], hemiC: [base.hemiC, base.hemiC, new THREE.Color(0x7a5ab0), new THREE.Color(0x5a6a9a)], hemiG: [base.hemiG, base.hemiG, new THREE.Color(0x10180f), new THREE.Color(0x0a0a14)],
    rim: [1, 3, 2.2, 1.2], rimC: [base.rimC, base.rimC, new THREE.Color(0x7affa0), base.rimC], envI: [1, 0.6, 0.5, 0.35],
    fog: [base.fog, base.fog, new THREE.Color(0x16241c), new THREE.Color(0x0c0e18)], fogN: [base.fogN, base.fogN, 14, 28], fogF: [base.fogF, base.fogF, 62, 80],
    bg: [base.bg, base.bg, new THREE.Color(0x0e1a14), new THREE.Color(0x070810)],
    tint: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(0.85, 0.8, 0.95), new THREE.Vector3(0.32, 0.42, 0.36), new THREE.Vector3(0.16, 0.18, 0.3)],
    moon: [0, 0, 1, 0.9], moonC: [null, null, new THREE.Vector3(0.75, 1.0, 0.6), new THREE.Vector3(0.95, 0.98, 1.1)],
    lamp: [1, 1, 0.45, 0.03],
  };
  const W = [1, 0, 0, 0];
  const mixN = (arr) => W[0] * arr[0] + W[1] * arr[1] + W[2] * arr[2] + W[3] * arr[3];
  const mixC = (out, arr) => { out.setRGB(0, 0, 0); for (let i = 0; i < 4; i++) if (W[i] > 0 && arr[i]) { out.r += arr[i].r * W[i]; out.g += arr[i].g * W[i]; out.b += arr[i].b * W[i]; } return out; };

  function set(mode, { instant = false, silent = false } = {}) {
    const idx = LIGHT_MODES.indexOf(mode); if (idx < 0) return;
    if (mode === state.mode && !instant) return;
    state.mode = mode;
    if (instant) { state.target = state.lever = idx; state.kD = mode === 'disco' ? 1 : 0; state.kH = mode === 'halloween' ? 1 : 0; state.kN = mode === 'dark' ? 1 : 0; }
    else { state.target += ((idx - (((state.target % 4) + 4) % 4)) + 4) % 4 || 4; if (!silent) clunk(mode === 'disco' || mode === 'halloween'); if (mode !== 'dark') burst(); }
  }

  function update(dt, t) {
    // the wing knob snaps a quarter turn with a little overshoot
    state.leverV += ((state.target - state.lever) * 180 - state.leverV * 12) * dt; state.lever += state.leverV * dt;
    knobG.rotation.z = -state.lever * Math.PI / 2;
    const step = (k, on) => THREE.MathUtils.clamp(k + (on ? dt / 0.9 : -dt / 0.6), 0, 1);
    state.kD = step(state.kD, state.mode === 'disco'); state.kH = step(state.kH, state.mode === 'halloween'); state.kN = step(state.kN, state.mode === 'dark');
    const sm = (k) => k * k * (3 - 2 * k);
    const k = state.kD, ease = sm(k), beatT = t * BPM / 60, beat = Math.pow(1 - (beatT % 1), 2.4);
    const eH = sm(state.kH), eN = sm(state.kN);
    // sparks
    if (sparkPts.visible) {
      const arr = sparkGeo.attributes.position.array; let alive = 0;
      sv.forEach((s, i) => { if (s.life > 0) { s.life -= dt; s.v.y -= 9 * dt; s.p.addScaledVector(s.v, dt); alive++; } else s.p.set(0, -50, 0); arr[i * 3] = s.p.x; arr[i * 3 + 1] = s.p.y; arr[i * 3 + 2] = s.p.z; });
      sparkGeo.attributes.position.needsUpdate = true; if (!alive) sparkPts.visible = false;
    }
    // neon + status lamp
    const m = state.mode, flick = Math.sin(t * 23) > 0.94 ? 0.25 : 0.55;
    neonMat.map = m === 'halloween' ? neonHal : neonTex;
    if (m === 'disco') neonMat.color.setHSL((t * 0.15) % 1, 1, 0.55).multiplyScalar(2.2 + beat * 1.4);
    else if (m === 'halloween') neonMat.color.setHSL(Math.sin(t * 2) > 0 ? 0.08 : 0.3, 1, 0.5).multiplyScalar(Math.sin(t * 17) > 0.8 ? 0.4 : 2.2);
    else if (m === 'dark') neonMat.color.setRGB(0.02, 0.02, 0.03);
    else neonMat.color.setHSL(0.92, 1, 0.55).multiplyScalar(flick);
    lampMat.color.copy(m === 'disco' ? hdr(0x3dff6a, 1.6 + beat) : m === 'halloween' ? hdr(0xff8a1a, 1.4 + 0.5 * Math.sin(t * 9)) : m === 'dark' ? hdr(0x4a6aff, 0.5) : hdr(0xff2a2a, 0.8 + 0.7 * (Math.sin(t * 6) > 0 ? 1 : 0)));
    ambient(t, ease, eH, eN, beatT);
    // the disco itself only while (fading) on
    const vis = k > 0.001;
    ballG.visible = vis; floor.visible = vis; for (const b of beams) b.piv.visible = vis;
    if (!vis) { light.intensity = 0; return; }
    // the ball drops in with a little bounce, then spins
    const drop = state.mode === 'disco' ? 1 - Math.pow(1 - ease, 3) * Math.cos(ease * 7) : ease;
    ballG.position.y = THREE.MathUtils.lerp(7.5, BALL.y, drop); ball.rotation.y += dt * 0.9;
    const gc = glintGeo.attributes.color.array; for (let i = 0; i < gc.length; i += 3) { const f = Math.max(0, Math.sin(t * 9 + i * 1.7)) ** 6 * 3; gc[i] = gc[i + 1] = gc[i + 2] = f * k; } glintGeo.attributes.color.needsUpdate = true;
    light.position.set(BALL.x, ballG.position.y - 0.6, BALL.z);
    light.color.setHSL((t * 0.12) % 1, 0.9, 0.6); light.intensity = ease * (9 + beat * 9);
    // beams sweep the floor, pulse on the beat
    for (const b of beams) {
      const s = t * (b.ball ? 0.7 : 0.45) + b.ph;
      _t.set(b.base.x + Math.sin(s) * b.r, 0, b.base.z + Math.cos(s * 1.3) * b.r * 0.7);
      if (b.ball) b.piv.position.set(BALL.x, ballG.position.y, BALL.z);
      b.piv.lookAt(_t);
      b.m.uniforms.uColor.value.setHSL((b.hue + t * 0.06) % 1, 1, 0.55).multiplyScalar(1.5);
      b.m.uniforms.uAlpha.value = ease * (b.ball ? 0.28 : 0.42) * (0.55 + 0.45 * beat);
    }
    floorMat.uniforms.uTime.value = t; floorMat.uniforms.uOn.value = ease; floorMat.uniforms.uBeat.value = beat;
  }

  // ---------- the evening, blended across the four looks ----------
  function ambient(t, eD, eH, eN, beatT) {
    const tot = eD + eH + eN, nrm = tot > 1 ? 1 / tot : 1;
    W[1] = eD * nrm; W[2] = eH * nrm; W[3] = eN * nrm; W[0] = Math.max(0, 1 - W[1] - W[2] - W[3]);
    if (tot < 0.001) { if (!state._amb) return; state._amb = false; } else state._amb = true; // one last pass at W = normal restores everything
    if (env?.sun) { env.sun.intensity = base.sun * mixN(LOOK.sun); mixC(env.sun.color, LOOK.sunC); }
    if (env?.hemi) { env.hemi.intensity = base.hemi * mixN(LOOK.hemi); mixC(env.hemi.color, LOOK.hemiC); mixC(env.hemi.groundColor, LOOK.hemiG); }
    if (env?.rim) { env.rim.intensity = base.rim * mixN(LOOK.rim); mixC(env.rim.color, LOOK.rimC); }
    scene.environmentIntensity = base.envI * mixN(LOOK.envI);
    if (scene.fog && base.fog) { mixC(scene.fog.color, LOOK.fog); scene.fog.near = mixN(LOOK.fogN); scene.fog.far = mixN(LOOK.fogF); }
    if (base.bg && scene.background?.isColor) mixC(scene.background, LOOK.bg);
    if (sky?.uTint) {
      sky.uTint.value.set(0, 0, 0); for (let i = 0; i < 4; i++) sky.uTint.value.addScaledVector(LOOK.tint[i], W[i]);
      sky.uMoon.value = mixN(LOOK.moon); const wm = W[2] + W[3]; if (wm > 0) sky.uMoonCol.value.copy(LOOK.moonC[2]).multiplyScalar(W[2] / wm).addScaledVector(LOOK.moonC[3], W[3] / wm);
    }
    // the yard's lamps / lanterns: candle-flicker in 万圣, out in 熄灯
    const fl = 0.75 + 0.25 * Math.sin(t * 11.3) * Math.sin(t * 5.1 + 0.7);
    const f = W[0] + W[1] + W[2] * LOOK.lamp[2] * fl + W[3] * LOOK.lamp[3];
    for (const L of lamps) L.l.intensity = L.i * f;
    for (const g of glows) { if (g.c) g.m.color.copy(g.c).multiplyScalar(f); else g.m.emissiveIntensity = g.e * f; }
    // string lights: warm (normal), rainbow chase (蹦迪), orange / purple / green flicker (万圣), off (熄灯)
    if (orig) {
      const arr = bulbs.instanceColor.array, n = arr.length / 3;
      for (let i = 0; i < n; i++) {
        let r = orig[i * 3] * W[0], g = orig[i * 3 + 1] * W[0], b = orig[i * 3 + 2] * W[0];
        if (W[1] > 0) { _c.setHSL((i * 0.045 - t * 0.5) % 1 + 1, 1, 0.5).multiplyScalar(0.6 + 0.9 * (((i + Math.floor(beatT * 2)) % 4 === 0) ? 1 : 0.35)); r += _c.r * W[1]; g += _c.g * W[1]; b += _c.b * W[1]; }
        if (W[2] > 0) { _c.set([0xff6a10, 0x9a3dff, 0x5aff3a][i % 3]).multiplyScalar(Math.sin(t * 9 + i * 1.7) > 0.86 ? 0.25 : 1.15); r += _c.r * W[2]; g += _c.g * W[2]; b += _c.b * W[2]; }
        arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b;
      }
      bulbs.instanceColor.needsUpdate = true;
    }
  }

  return {
    switchPos: DISCO_SWITCH, get mode() { return state.mode; }, get on() { return state.mode === 'disco'; }, get level() { return state.kD; },
    get mix() { return { disco: state.kD, halloween: state.kH, dark: state.kN }; },
    beat: (t) => Math.pow(1 - ((t * BPM / 60) % 1), 2.4), set, update,
  };
}
