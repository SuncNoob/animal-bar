import * as THREE from 'three';
import { isEn } from './i18n.js';

// Juice for "human bumper cars": boing sounds, floating 砰! text, dizzy stars, NPC one-liners.

export const BUMP_WORDS = isEn ? ['BAM!', 'THUD!', 'BOING~', 'OOF!', 'YEET!', 'POW!'] : ['砰！', '咚！', 'Duang～', '哎哟！', '撞飞！', '嘭！'];
export const NPC_LINES = {
  cat_tuantuan: isEn ? ['Tuantuan: Ow ow ow!', 'Tuantuan: Easy, easy~', 'Tuantuan: Need a drink to calm your nerves?', 'Tuantuan: You knocked my apron crooked!'] : ['团团：哎哟喂！', '团团：慢点慢点～', '团团：要不要来一杯压压惊？', '团团：围裙都给你撞歪了！'],
  croc_edazi: isEn ? ['Croc Buddy: Solid as a rock.', 'Croc Buddy: …again?', 'Croc Buddy: My tail weighs more than you.', 'Croc Buddy: You okay?'] : ['鳄搭子：稳如泰山。', '鳄搭子：……再来？', '鳄搭子：我尾巴比你重。', '鳄搭子：你没事吧？'],
};
export const pick = (a) => a[Math.floor(Math.random() * a.length)];

let ac = null;
const audio = () => { try { return ac || (ac = new (window.AudioContext || window.webkitAudioContext)()); } catch { return null; } };
export function boing(power = 1) {
  const c = audio(); if (!c || !Number.isFinite(power)) return; power = Math.min(power, 4); if (c.state === 'suspended') c.resume();
  const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(320 + power * 40, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.28);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.min(0.35, 0.12 + power * 0.03), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.4);
  const n = c.createBufferSource(), b = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const ng = c.createGain(); ng.gain.value = 0.12; n.buffer = b; n.connect(ng).connect(c.destination); n.start(t);
}
export function plop() {
  const c = audio(); if (!c) return; if (c.state === 'suspended') c.resume();
  const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(600, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.18);
  g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.3);
}

function textTexture(text, color) {
  const font = '900 72px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  const cv = document.createElement('canvas'); let g = cv.getContext('2d'); g.font = font;
  cv.width = Math.max(256, Math.ceil(g.measureText(text).width + 36)); cv.height = 128; g = cv.getContext('2d'); // long texts get a wider canvas
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 12; g.strokeStyle = '#3a1a08'; g.strokeText(text, cv.width / 2, 64); g.fillStyle = color; g.fillText(text, cv.width / 2, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.userData.aspect = cv.width / 256; return t;
}
const starTex = textTexture('★', '#ffd23f');

export function createBumperFX(scene) {
  const pops = [], dizzies = [];
  function pop(text, at, color = '#ffb347', scale = 1) {
    const map = textTexture(text, color), w = map.userData.aspect || 1;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true }));
    s.renderOrder = 20; s.position.copy(at); s.position.y += 1.5; s.scale.set(0.9 * scale * w, 0.45 * scale, 1); s.userData.base = scale; s.userData.w = w; scene.add(s);
    pops.push({ s, t: 0, life: 0.9 });
  }
  function dizzy(root, headY, dur = 1.4) {
    const g = new THREE.Group(); g.position.y = headY; root.add(g);
    for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, depthTest: false, transparent: true })); s.scale.set(0.28, 0.14, 1); s.renderOrder = 21; s.userData.a = (i / 3) * Math.PI * 2; g.add(s); }
    dizzies.push({ g, root, t: 0, life: dur });
  }
  function update(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]; p.t += dt; const k = p.t / p.life;
      p.s.position.y += dt * 0.9; const sc = (k < 0.15 ? k / 0.15 * 1.3 : 1.3 - (k - 0.15) * 0.4) * p.s.userData.base; p.s.scale.set(0.9 * sc * (p.s.userData.w || 1), 0.45 * sc, 1);
      p.s.material.opacity = 1 - Math.max(0, (k - 0.6) / 0.4);
      if (k >= 1) { scene.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); pops.splice(i, 1); }
    }
    for (let i = dizzies.length - 1; i >= 0; i--) {
      const d = dizzies[i]; d.t += dt;
      d.g.children.forEach((s) => { const a = s.userData.a + d.t * 7; s.position.set(Math.cos(a) * 0.32, Math.sin(d.t * 9 + s.userData.a) * 0.04, Math.sin(a) * 0.32); });
      if (d.t >= d.life) { d.root.remove(d.g); dizzies.splice(i, 1); }
    }
  }
  return { pop, dizzy, update };
}
