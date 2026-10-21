import * as THREE from 'three';
import { LAYOUT as L } from '../layout.js';
import { isEn } from '../i18n.js';

// 跳水板: a springboard on the deck edge, sticking out over the lagoon. The board really bends: setLoad()
// presses the tip down (someone standing / crouching on it), kick() sets it twanging after a launch.

export function createSpringboard(scene, { x = -1.95 } = {}) {
  const G = new THREE.Group(); G.name = 'springboard'; scene.add(G);
  const z0 = L.deck.z1 - 0.95, len = 2.9, z1 = z0 + len, zf = z0 + 0.95; // rear clamp, tip, fulcrum
  const yRear = 0.44, slope = 0.03; // board top height at the rear; rises a little towards the tip
  const W = 0.62, T = 0.085;

  // texture: canvas top = rear end, bottom = tip, canvas x = world +x (BoxGeometry's +y face)
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#2a8ae6'; g.fillRect(0, 0, 128, 600);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.13})`; g.fillRect(Math.random() * 128, Math.random() * 600, 2, 2); } // non-slip grit
    g.fillStyle = '#ffd23f'; g.fillRect(0, 556, 128, 14); g.fillStyle = '#ffffff'; g.fillRect(0, 570, 128, 30); // tip stripes
    g.fillStyle = 'rgba(255,255,255,.95)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const word = (txt, y, px) => { g.save(); g.translate(64, y); g.rotate(Math.PI); g.font = `900 ${px}px "PingFang SC","Noto Sans SC",sans-serif`; g.fillText(txt, 0, 0); g.restore(); }; // upright for someone walking out
    if (isEn) { word('JUMP', 300, 40); word('BOING!', 470, 34); } else { word('跳海', 300, 46); word('弹!', 470, 64); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const side = new THREE.MeshStandardMaterial({ color: 0x1f6fc2, roughness: 0.35 });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
  const geo = new THREE.BoxGeometry(W, T, len, 1, 1, 18);
  geo.translate(0, -T / 2, len / 2); // origin = rear end, top surface
  const rest = geo.attributes.position.array.slice();
  const board = new THREE.Mesh(geo, [side, side, top, side, side, side]); board.position.set(x, yRear, z0); board.rotation.x = -Math.atan(slope); board.castShadow = board.receiveShadow = true; G.add(board);

  const concrete = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.9 });
  const ped = new THREE.Mesh(new THREE.BoxGeometry(0.78, yRear - 0.04, 1.0), concrete); ped.position.set(x, (yRear - 0.04) / 2, z0 + 0.5); ped.castShadow = ped.receiveShadow = true; G.add(ped);
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, W + 0.14, 16), new THREE.MeshStandardMaterial({ color: 0xffc928, roughness: 0.35, metalness: 0.3 }));
  roller.rotation.z = Math.PI / 2; roller.position.set(x, yRear - T - 0.05, zf); G.add(roller);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.5, yRear - T - 0.08, 0.12), concrete); strut.position.set(x, (yRear - T - 0.08) / 2, zf); G.add(strut);
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.15 });
  for (const s of [-1, 1]) { // grab rails at the back
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 8, 20, Math.PI * 0.75), chrome); rail.rotation.y = Math.PI / 2; rail.position.set(x + s * (W / 2 + 0.08), yRear, z0 + 0.42); rail.rotation.z = 0; G.add(rail);
  }

  let load = 0, osc = 0, oscV = 0, lastD = NaN;
  function bendAt(zl) { const u = Math.max(0, (zl - (zf - z0)) / (len - (zf - z0))); return u * u * (3 - u); } // 0 behind the fulcrum → ~2 at the tip
  function applyBend() {
    const d = load + osc; if (Math.abs(d - lastD) < 1e-4) return; lastD = d;
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) p[i + 1] = rest[i + 1] - d * bendAt(rest[i + 2]) * 0.5;
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  }
  const standZ = z1 - 0.35;
  return {
    x, z0, z1, zf, standZ, group: G,
    collider: { x0: x - 0.4, x1: x + 0.4, z0, z1: z0 + 1.0 },
    approach: new THREE.Vector3(x, 0, z0 - 0.35), // where you stand to climb on
    topAt(z) { const zl = z - z0; return yRear + zl * slope - (load + osc) * bendAt(zl) * 0.5; },
    setLoad(v) { load = v; },
    kick(v) { oscV += v; },
    update(dt) {
      oscV += (-osc * 260 - oscV * 5.5) * dt; osc += oscV * dt; // damped twang
      if (Math.abs(osc) < 1e-4 && Math.abs(oscV) < 1e-3) { osc = 0; oscV = 0; }
      applyBend();
    },
  };
}
