import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { README_ITEMS as ITEMS, REPO } from '../readme.js';
import { L } from '../i18n.js';

// A 1995 beige PC on a little desk beside the jukebox. Its CRT runs a low-res "Netscape" page of this game's own
// README (section titles and things to do cycling through), shown through a CRT shader: barrel curve, scanlines, RGB
// fringing, phosphor flicker and a slow rolling band. createComputer(scene, { x, z, ry }) → { spot, update }

const W = 320, H = 240; // a VGA-ish framebuffer, upscaled with nearest filtering for the pixels
const TAG = { h: 'README', do: L('玩法', 'TO DO') };

export function createComputer(scene, { x, z, ry = 0 }) {
  const G = new THREE.Group(); G.position.set(x, 0, z); G.rotation.y = ry; G.name = 'computer'; scene.add(G);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.6 });
  const beige = new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.55 });
  const beigeDark = new THREE.MeshStandardMaterial({ color: 0xb9ae90, roughness: 0.6 });
  const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  // desk
  const top = sh(new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.05, 0.6, 2, 0.015), wood)); top.position.y = 0.76; G.add(top);
  for (const [lx, lz] of [[-0.42, -0.25], [0.42, -0.25], [-0.42, 0.25], [0.42, 0.25]]) { const leg = sh(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.74, 0.05), wood)); leg.position.set(lx, 0.37, lz); G.add(leg); }
  // CRT: a deep beige box, a thick bezel, the tube's glass inside
  const mon = new THREE.Group(); mon.position.set(-0.05, 0.785, -0.05); G.add(mon);
  const back = sh(new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.34, 0.32, 3, 0.04), beigeDark)); back.position.set(0, 0.2, -0.13); back.scale.set(0.82, 0.85, 1); mon.add(back);
  const bezel = sh(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 0.12, 3, 0.03), beige)); bezel.position.set(0, 0.25, 0.04); mon.add(bezel);
  const foot = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.035, 20), beige)); foot.position.y = 0.017; mon.add(foot);
  const neck = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.05, 12), beigeDark)); neck.position.y = 0.055; mon.add(neck);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40ff60).multiplyScalar(2) })); led.position.set(0.19, 0.075, 0.102); mon.add(led);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.004), new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 0.4, roughness: 0.4 })); badge.position.set(-0.15, 0.072, 0.102); mon.add(badge);

  // the screen
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const screenMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D map; uniform float uTime; varying vec2 vUv;
      vec2 curve(vec2 uv){ uv = uv * 2. - 1.; vec2 o = abs(uv.yx) / vec2(4.6, 3.8); uv += uv * o * o; return uv * .5 + .5; }
      void main(){
        vec2 uv = curve(vUv);
        if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) { gl_FragColor = vec4(0.02, 0.025, 0.02, 1.); return; }
        float ab = .0022; vec3 c = vec3(texture2D(map, uv + vec2(ab, 0.)).r, texture2D(map, uv).g, texture2D(map, uv - vec2(ab, 0.)).b);
        float scan = .72 + .28 * sin(uv.y * ${H}. * 6.2832);
        float mask = .9 + .1 * sin(uv.x * ${W * 3}. * 3.1416);
        float vig = smoothstep(0., .14, uv.x) * smoothstep(1., .86, uv.x) * smoothstep(0., .14, uv.y) * smoothstep(1., .86, uv.y);
        float roll = 1. + .06 * smoothstep(.08, 0., abs(fract(uv.y + uTime * .11) - .5));
        float flick = .965 + .035 * sin(uTime * 57.);
        c = pow(c, vec3(2.2)) * scan * mask * roll * flick * (.45 + .55 * vig);
        gl_FragColor = vec4(c * 1.35 + vec3(.004, .006, .004), 1.); // a touch of phosphor glow
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.285), screenMat); screen.position.set(0, 0.25, 0.101); mon.add(screen);
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.285), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false })); glare.position.set(0, 0.25, 0.103); mon.add(glare);
  // keyboard + mouse
  const kb = sh(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.025, 0.15, 2, 0.008), beige)); kb.position.set(-0.05, 0.795, 0.2); kb.rotation.x = 0.06; G.add(kb);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.11, 1, 1), new THREE.MeshStandardMaterial({ map: keyTex(), roughness: 0.7 })); keys.rotation.x = -Math.PI / 2 + 0.06; keys.position.set(-0.05, 0.81, 0.2); G.add(keys);
  const mouse = sh(new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.025, 0.09, 2, 0.012), beige)); mouse.position.set(0.3, 0.795, 0.2); G.add(mouse);
  const tower = sh(new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.42, 0.42, 2, 0.015), beige)); tower.position.set(0.2, 0.21, -0.04); G.add(tower);
  const drive = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.005), new THREE.MeshStandardMaterial({ color: 0x3a3630 })); drive.position.set(0.2, 0.33, 0.175); G.add(drive);

  // ---- the framebuffer: a little Netscape window on a teal desktop ----
    let page = 0, lastPage = -1;
  function bevel(x, y, w, h, inset) { g.fillStyle = '#c0c0c0'; g.fillRect(x, y, w, h); g.fillStyle = inset ? '#808080' : '#ffffff'; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h); g.fillStyle = inset ? '#ffffff' : '#404040'; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h); }
  function draw() {
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#008080'; g.fillRect(0, 0, W, H);
    bevel(6, 6, W - 12, H - 22, false);
    const tg = g.createLinearGradient(9, 0, W - 9, 0); tg.addColorStop(0, '#000080'); tg.addColorStop(1, '#1084d0'); g.fillStyle = tg; g.fillRect(9, 9, W - 18, 13);
    g.fillStyle = '#fff'; g.font = 'bold 10px "SimSun","Songti SC",monospace'; g.textBaseline = 'middle'; g.fillText('Netscape - [Animal Bar · README]', 13, 16);
    for (let i = 0; i < 3; i++) bevel(W - 45 + i * 12, 11, 10, 9, false);
    g.fillStyle = '#000'; g.font = '9px "SimSun",monospace'; g.fillText(L('地址:', 'Go to:'), 11, 31); bevel(36, 25, W - 48, 12, true); g.fillStyle = '#fff'; g.fillRect(37, 26, W - 50, 10); g.fillStyle = '#000'; g.fillText(REPO.replace('https://', 'http://'), 40, 31);
    // page
    g.fillStyle = '#fff'; g.fillRect(10, 40, W - 20, H - 66);
    g.fillStyle = '#b94f08'; g.font = 'bold 18px Georgia,serif'; g.fillText('🍺 Animal Bar', 16, 58);
    g.fillStyle = '#000'; g.font = 'bold 10px "SimSun","Songti SC",sans-serif'; g.fillText(L('动物酒馆 · 开源啦', 'a hutong bar, open source'), 170, 58);
    g.fillStyle = '#808080'; g.fillRect(14, 77, W - 28, 1);
    const per = 4, start = (page * per) % ITEMS.length;
    for (let k = 0; k < per; k++) {
      const it = ITEMS[(start + k) % ITEMS.length], y = 84 + k * 30;
      g.fillStyle = it.tag === 'h' ? '#000080' : '#1a6a2a'; g.fillRect(16, y, 28, 12);
      g.fillStyle = '#fff'; g.font = '7px "SimSun",sans-serif'; g.fillText(TAG[it.tag], 17, y + 6);
      g.fillStyle = '#0000ee'; g.font = '11px "SimSun","Songti SC",sans-serif'; const t = it.title.length > 22 ? it.title.slice(0, 21) + '…' : it.title; g.fillText(t, 48, y + 6);
      g.fillRect(48, y + 13, Math.min(g.measureText(t).width, W - 70), 1);
      g.fillStyle = '#555'; g.font = '9px "SimSun",sans-serif'; g.fillText(it.sub.slice(0, 30), 48, y + 21);
    }
    // status bar + a blinking cursor
    bevel(6, H - 16, W - 12, 12, true); g.fillStyle = '#000'; g.font = '9px "SimSun",monospace'; g.fillText(L('文档：完成 · 走近按 E 看说明书', 'Document: Done · walk up and press E to read'), 10, H - 10);
    tex.needsUpdate = true;
  }
  draw();
  return {
    spot: new THREE.Vector3(x + Math.sin(ry) * 0.75, 0, z + Math.cos(ry) * 0.75), // where you stand to use it
    colliders: [-0.26, 0.26].map((lx) => ({ x: x + lx * Math.cos(ry), z: z - lx * Math.sin(ry), r: 0.4 })), // the desk is wider than deep
    update(dt, t) {
      screenMat.uniforms.uTime.value = t; led.material.color.setRGB(0.3, 2.2 * (0.7 + 0.3 * Math.sin(t * 3)), 0.5);
      page = Math.floor(t / 4); if (page !== lastPage) { lastPage = page; draw(); }
    },
  };
}

function keyTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 72; const g = c.getContext('2d');
  g.fillStyle = '#cfc6aa'; g.fillRect(0, 0, 256, 72);
  for (let r = 0; r < 5; r++) for (let k = 0; k < 15; k++) { g.fillStyle = (r + k) % 7 ? '#ece5cf' : '#d9d0b6'; g.fillRect(4 + k * 16.6 + (r % 2) * 4, 4 + r * 13.5, 14, 11); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
