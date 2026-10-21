import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// 3D dice tray for the 吹牛 panel: real dice under a lacquered cup.
//  mine(roundKey, dice, hl)  → your 5 dice: the cup shakes (rattle), slams, lifts, the dice tumble out and settle
//  all(roundKey, rows, hl)   → 开盅: one row per player, cups lift one after another, matching dice pop up in gold
// hl = { f, zhai } or null: which dice count for the bid (1s are wild unless 斋)

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_ORDER = [3, 4, 1, 6, 2, 5]; // BoxGeometry groups: +x, -x, +y, -y, +z, -z  (opposite faces add up to 7)
const NORMAL = { 3: [1, 0, 0], 4: [-1, 0, 0], 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1] };
const UP = new THREE.Vector3(0, 1, 0);

function faceTex(v) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grd = g.createRadialGradient(54, 50, 10, 64, 64, 90); grd.addColorStop(0, '#fffef8'); grd.addColorStop(1, '#efe6d2'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const red = v === 1 || v === 4;
  for (const i of PIPS[v]) {
    const x = 26 + (i % 3) * 38, y = 26 + Math.floor(i / 3) * 38, r = v === 1 ? 21 : 11.5;
    const pg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r); pg.addColorStop(0, red ? '#ff4a55' : '#4a4652'); pg.addColorStop(1, red ? '#b3101f' : '#141218');
    g.fillStyle = pg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function feltTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#2a6a4c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
}
function labelTex(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112; const g = c.getContext('2d');
  let px = 76; g.font = `900 ${px}px "PingFang SC","Noto Sans SC",sans-serif`;
  while (px > 40 && g.measureText(text).width > 500) { px -= 4; g.font = `900 ${px}px "PingFang SC","Noto Sans SC",sans-serif`; } // long names shrink to fit
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(10,30,20,.6)'; g.strokeText(text, 256, 58); g.fillStyle = '#fff3dc'; g.fillText(text, 256, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---- rattle: little clicks of dice against the cup ----
let actx = null;
function clicks(n, spread, loud = 0.25) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.random() * spread, o = actx.createOscillator(), g = actx.createGain(), f = actx.createBiquadFilter();
      o.type = 'square'; o.frequency.value = 1800 + Math.random() * 2600; f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 2;
      g.gain.setValueAtTime(loud * (0.4 + Math.random() * 0.6), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(f).connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.04);
    }
  } catch {}
}

export function createDiceTray() {
  const el = document.createElement('div'); el.className = 'dp-tray'; el.setAttribute('role', 'img');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1d4634);
  scene.add(new THREE.HemisphereLight(0xfff3dc, 0x20402e, 1.4));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(-3, 9, 5); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 }); sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; scene.add(sun, sun.target);
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: feltTex(), roughness: 0.95 })); felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true; scene.add(felt);
  const camera = new THREE.OrthographicCamera(-5, 5, 1, -1, 0.1, 60);

  const dieGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.16);
  const dieMats = FACE_ORDER.map((v) => new THREE.MeshStandardMaterial({ map: faceTex(v), roughness: 0.32 }));
  const ringGeo = new THREE.RingGeometry(0.6, 0.72, 32).rotateX(-Math.PI / 2), ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd66e).multiplyScalar(1.4), transparent: true, opacity: 0 });
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x8e1b1b, roughness: 0.28, metalness: 0.1 }), rimMat = new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.9, roughness: 0.3 });
  function makeCup(r = 1.55, h = 2.1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 40, 1, true), cupMat); body.position.y = h / 2; body.castShadow = true; g.add(body);
    const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.82, 40).rotateX(-Math.PI / 2), cupMat); top.position.y = h; g.add(top);
    for (const [y, rr] of [[0.06, r], [h - 0.04, r * 0.82], [h * 0.55, r * 0.9]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.02, 0.05, 8, 40), rimMat); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring); }
    body.material.side = THREE.DoubleSide; return g;
  }
  const pool = []; // dice meshes
  const getDie = (i) => { if (!pool[i]) { const m = new THREE.Mesh(dieGeo, dieMats); m.castShadow = true; const ring = new THREE.Mesh(ringGeo, ringMat.clone()); ring.position.y = 0.01; scene.add(ring); m.userData.ring = ring; scene.add(m); pool[i] = m; } pool[i].visible = true; return pool[i]; };
  const cups = [], labels = [];
  const getCup = (i) => { if (!cups[i]) { cups[i] = makeCup(); scene.add(cups[i]); } cups[i].visible = true; return cups[i]; };
  const getLabel = (i, text) => {
    if (!labels[i]) { labels[i] = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.66).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); scene.add(labels[i]); }
    const L = labels[i]; if (L.userData.text !== text) { L.material.map?.dispose(); L.material.map = labelTex(text); L.material.needsUpdate = true; L.userData.text = text; }
    L.visible = true; return L;
  };

  let anim = [], t0 = 0, endAt = 0, raf = 0, key = '', mode = '', W = 520, H = 120, pxu = 52, hl = null, grid = { cols: 1, rows: 1 };
  const counts = (v) => hl && (v === hl.f || (!hl.zhai && hl.f !== 1 && v === 1));
  // five dice like the five pips of a die (梅花): four corners and the middle
  const QX = 1.04, PLUM = [[-QX, -QX], [QX, -QX], [0, 0], [-QX, QX], [QX, QX]];
  const CELL_W = 3.8, CELL_H = 4.6; // one player's cluster + name in the 开盅 view
  function layout() {
    W = Math.max(110, el.clientWidth || el.parentElement?.clientWidth || 200);
    if (mode === 'mine') { pxu = W / 4.5; H = W; camera.position.set(0, 9, 5.2); camera.lookAt(0, 0, 0.15); } // square tray, one cup
    else { pxu = W / (grid.cols * CELL_W + 0.3); H = Math.round(grid.rows * CELL_H * pxu + 6); camera.position.set(0, 14, 2.6); camera.lookAt(0, 0, 0); }
    const hw = W / pxu / 2, hh = H / pxu / 2;
    Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh }); camera.updateProjectionMatrix();
    renderer.setSize(W, H); sun.target.position.set(0, 0, 0);
  }
  const qFor = (v, yaw) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...NORMAL[v]), UP).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  function hideAll() { pool.forEach((d) => { d.visible = false; d.userData.ring.visible = false; }); cups.forEach((c) => (c.visible = false)); labels.forEach((l) => (l.visible = false)); }

  // a die's flight: from `from` (in the cup) to `to`, tumbling and bouncing, landing on face v
  function tumble(d, v, from, to, start, dur) {
    d.userData.v = v;
    const qEnd = qFor(v, 0), axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize(), spin = (3 + Math.random() * 3) * Math.PI;
    d.visible = false; // hidden in the cup until it lifts
    anim.push({ start, dur, step(k) {
      d.visible = true; const e = 1 - Math.pow(1 - k, 3);
      d.position.lerpVectors(from, to, e);
      d.position.y = 0.5 + Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 1.4 + (1 - e) * (from.y - 0.5) * 0.4;
      d.quaternion.copy(qEnd).multiply(new THREE.Quaternion().setFromAxisAngle(axis, (1 - e) * spin));
    } });
  }
  // 开盅: no spinning — each die is already face up and just settles where the cup was
  function place(d, v, to, start) {
    d.userData.v = v; d.visible = false; const q = qFor(v, 0);
    anim.push({ start, dur: 0.3, step(k) { d.visible = true; d.quaternion.copy(q); d.position.set(to.x, 0.5 + (1 - k) * (1 - k) * 0.35, to.z); } });
  }
  function pop(d, v, start) { // counted dice hop up and get a gold ring
    const ring = d.userData.ring, y0 = 0.5;
    anim.push({ start, dur: 0.6, step(k) {
      ring.visible = true; ring.position.set(d.position.x, 0.01, d.position.z);
      const on = counts(v); ring.material.opacity = on ? Math.min(1, k * 2) * 0.95 : 0;
      d.position.y = y0 + (on ? Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.5 + Math.min(1, k * 3) * 0.12 : 0);
    } });
  }

  let hlKey = '';
  const setHl = (h) => { hl = h; const k = h ? `${h.f}:${h.zhai}` : ''; const changed = k !== hlKey; hlKey = k; return changed; };
  function mine(roundKey, dice, h) {
    const hlChanged = setHl(h), fresh = roundKey !== key || mode !== 'mine'; mode = 'mine';
    if (!fresh) { if (hlChanged) refreshHighlight(); else if (!raf) renderer.render(scene, camera); return; }
    key = roundKey; layout(); hideAll(); anim = []; t0 = performance.now() / 1000;
    const cup = getCup(0); cup.scale.setScalar(1); cup.position.set(0, 0, 0); cup.rotation.set(0, 0, 0);
    dice.forEach((v, i) => { const d = getDie(i); d.position.set((Math.random() - 0.5) * 0.6, 0.7 + i * 0.25, (Math.random() - 0.5) * 0.4); d.userData.ring.visible = false; });
    // shake → slam → lift away
    anim.push({ start: 0, dur: 1.0, step(k) { const s = Math.sin(k * Math.PI * 9) * (1 - k * 0.4); cup.position.x = s * 0.55; cup.position.y = Math.abs(Math.sin(k * Math.PI * 9)) * 0.35; cup.rotation.z = -s * 0.22; } });
    anim.push({ start: 1.0, dur: 0.15, step(k) { cup.position.set(0, 0.25 * (1 - k), 0); cup.rotation.z = 0; cup.scale.set(1 + 0.06 * Math.sin(k * Math.PI), 1 - 0.08 * Math.sin(k * Math.PI), 1 + 0.06 * Math.sin(k * Math.PI)); } });
    anim.push({ start: 1.25, dur: 0.55, step(k) { const e = k * k; cup.position.set(-e * 3.5, e * 5, -e * 3); cup.rotation.z = e * 0.9; if (k >= 1) cup.visible = false; } });
    dice.forEach((v, i) => { const d = getDie(i); tumble(d, v, d.position.clone().setY(0.9), new THREE.Vector3(PLUM[i % 5][0], 0.5, PLUM[i % 5][1] + 0.1), 1.25 + i * 0.05, 1.0 + Math.random() * 0.25); pop(d, v, 2.85); });
    endAt = 3.5; clicks(26, 1.0, 0.3); setTimeout(() => clicks(10, 0.9, 0.2), 1300); run();
  }
  function all(roundKey, rows, h) { // rows: [{ name, dice: [..] | [] }]
    const hlChanged = setHl(h), fresh = roundKey !== key || mode !== 'all'; mode = 'all';
    if (!fresh) { if (hlChanged) refreshHighlight(); else if (!raf) renderer.render(scene, camera); return; }
    const n = rows.length; grid.cols = n <= 4 ? n : 3; grid.rows = Math.ceil(n / grid.cols);
    key = roundKey; layout(); hideAll(); anim = []; t0 = performance.now() / 1000;
    let di = 0;
    rows.forEach((r, ri) => {
      const col = ri % grid.cols, row = Math.floor(ri / grid.cols), inRow = Math.min(grid.cols, n - row * grid.cols);
      const cx = (col - (inRow - 1) / 2) * CELL_W, cz = (row - (grid.rows - 1) / 2) * CELL_H - 0.35;
      const L = getLabel(ri, r.name); L.position.set(cx, 0.02, cz + 1.98);
      const cup = getCup(ri); cup.scale.setScalar(0.98); cup.position.set(cx, 0, cz); cup.rotation.set(0, 0, 0); // one cup per player
      const st = 0.25 + ri * 0.4;
      anim.push({ start: st, dur: 0.45, step(k) { const e = k * k; cup.position.set(cx, e * 6, cz - e * 2.5); if (k >= 1) cup.visible = false; } });
      (r.dice || []).forEach((v, j) => {
        const d = getDie(di++); d.userData.ring.visible = false;
        place(d, v, new THREE.Vector3(cx + PLUM[j % 5][0], 0.5, cz + PLUM[j % 5][1]), st + 0.12);
        pop(d, v, 0.25 + n * 0.4 + 0.45);
      });
      setTimeout(() => clicks(6, 0.5, 0.18), st * 1000);
    });
    endAt = 0.25 + rows.length * 0.4 + 1.5; run();
  }
  function refreshHighlight() { // the bid changed but the dice did not: just re-pop
    const now = performance.now() / 1000 - t0; if (now < endAt) return; // still animating; the pops will use the new hl
    anim = []; t0 = performance.now() / 1000; pool.forEach((d) => { if (d.visible) pop(d, d.userData.v, 0); }); endAt = 0.7; run();
  }
  function run() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; if (!el.isConnected) return;
    const t = performance.now() / 1000 - t0;
    for (const a of anim) { if (t >= a.start) a.step(Math.min(1, (t - a.start) / a.dur)); }
    renderer.render(scene, camera);
    if (t < endAt + 0.1) raf = requestAnimationFrame(frame);
  }
  const ro = new ResizeObserver(() => { if (mode && el.isConnected) { layout(); renderer.render(scene, camera); } }); ro.observe(el);
  return { el, mine, all, reset() { key = ''; }, dispose() { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); el.remove(); renderer.dispose(); renderer.forceContextLoss(); } };
}
