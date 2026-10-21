import * as THREE from 'three';
import { LAYOUT as L } from '../layout.js';
import { L as tr } from '../i18n.js'; // L is the layout here

// 点单小票: a brass pass-rail on the bar counter where the latest orders hang as paper tickets (newest on the right).
export function createOrderRail(scene) {
  const G = new THREE.Group(); G.name = 'order-rail'; scene.add(G);
  const B = L.bar, z = B.z1 - 0.12, y0 = B.top, x0 = 0.25, x1 = 3.45, H = 0.44;
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, x1 - x0 + 0.1, 12), brass); rail.rotation.z = Math.PI / 2; rail.position.set((x0 + x1) / 2, y0 + H, z); G.add(rail);
  for (const x of [x0 - 0.02, x1 + 0.02]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, H, 10), brass); post.position.set(x, y0 + H / 2, z); post.castShadow = true; G.add(post); }
  const slots = [], N = 6, W = 0.27, TH = 0.36, GAP = 0.5;
  const ticketGeo = new THREE.PlaneGeometry(W, TH).translate(0, -TH / 2, 0); // hangs from its top edge
  for (let i = 0; i < N; i++) {
    const c = document.createElement('canvas'); c.width = 200; c.height = 270;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(ticketGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
    m.position.set((x0 + x1) / 2, y0 + H - 0.01, z + 0.024); m.visible = false; m.castShadow = true; G.add(m);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.012), brass); clip.position.set(0, 0.002, 0.004); m.add(clip);
    slots.push({ m, c, tex, key: '', swing: 0, ph: Math.random() * 6 });
  }
  function draw(s, o) {
    const g = s.c.getContext('2d'), w = s.c.width, h = s.c.height;
    g.fillStyle = '#fffaf0'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,90,60,.06)'; for (let i = 0; i < 9; i++) g.fillRect(0, 30 + i * 26, w, 1);
    g.fillStyle = '#c0392b'; g.font = '900 30px "PingFang SC","Noto Sans SC",sans-serif'; g.textAlign = 'left'; g.fillText('#' + o.no, 14, 40);
    const tm = new Date(o.at); g.fillStyle = '#8a6a4a'; g.font = '600 18px system-ui'; g.textAlign = 'right'; g.fillText(`${String(tm.getHours()).padStart(2, '0')}:${String(tm.getMinutes()).padStart(2, '0')}`, w - 12, 38);
    g.strokeStyle = '#d8c7ad'; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(10, 54); g.lineTo(w - 10, 54); g.stroke(); g.setLineDash([]);
    g.textAlign = 'center'; g.fillStyle = '#2b2016'; g.font = '800 24px "PingFang SC","Noto Sans SC",sans-serif'; g.fillText(o.nick.slice(0, 7), w / 2, 92);
    g.font = '64px "Apple Color Emoji","Noto Color Emoji",sans-serif'; g.fillText(o.emoji, w / 2, 170);
    g.fillStyle = '#b94f08'; g.font = '900 26px "PingFang SC","Noto Sans SC",sans-serif';
    const name = o.name; if (g.measureText(name).width > w - 16) { g.font = '900 20px "PingFang SC","Noto Sans SC",sans-serif'; }
    g.fillText(name, w / 2, 222, w - 16);
    if (o.board) { g.fillStyle = '#8a6a4a'; g.font = '600 17px system-ui'; g.fillText(tr(`墙上 ${o.board} 号牌`, `board no. ${o.board}`), w / 2, 252); }
    s.tex.needsUpdate = true;
  }
  return {
    show(list) {
      const items = list.slice(-N); // centred on the rail, oldest left → newest right
      slots.forEach((s, i) => {
        const o = items[i];
        if (!o) { s.m.visible = false; s.key = ''; return; }
        s.m.visible = true; s.m.position.x = (x0 + x1) / 2 + (i - (items.length - 1) / 2) * GAP;
        if (s.key !== o.k) { s.key = o.k; draw(s, o); s.swing = 1; }
      });
    },
    update(dt, t) { for (const s of slots) { if (!s.m.visible) continue; s.swing = Math.max(0, s.swing - dt * 0.5); s.m.rotation.x = Math.sin(t * 1.3 + s.ph) * 0.04 + Math.sin(t * 9) * 0.35 * s.swing * s.swing; } },
  };
}
