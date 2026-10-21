import * as THREE from 'three';

// Procedural canvas textures (albedo + normal + roughness) so the scene ships no image files.
// Each generator draws a height field alongside the color, then derives a tangent-space normal map from it.

const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function heightToNormal(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h); const g = out.getContext('2d'); const img = g.createImageData(w, h); const d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1); const i = (y * w + x) * 4;
    d[i] = (dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return out;
}

function noiseSpeckle(g, w, h, n, alpha, light = 255, dark = 0) {
  for (let i = 0; i < n; i++) {
    const v = rand() < 0.5 ? light : dark;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function finish(color, height, rough, { repeat = [1, 1], normalStrength = 2, aniso = 8 } = {}) {
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: mk(color, true), normalMap: mk(heightToNormal(height, normalStrength)), roughnessMap: rough ? mk(rough) : null };
}

// Beijing hutong grey brick: long thin bricks, cool grey with warm/blue variation, recessed light mortar.
export function hutongBrick(opts = {}) {
  const W = 512, H = 512, bw = 64, bh = 21, m = 3;
  const c = canvas(W, H), g = c.getContext('2d'); const hc = canvas(W, H), hg = hc.getContext('2d'); const rc = canvas(W, H), rg = rc.getContext('2d');
  g.fillStyle = '#9a958d'; g.fillRect(0, 0, W, H); hg.fillStyle = '#202020'; hg.fillRect(0, 0, W, H); rg.fillStyle = '#f0f0f0'; rg.fillRect(0, 0, W, H);
  for (let row = 0; row * bh < H; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col * bw < W + bw; col++) {
      const x = col * bw + off + m / 2, y = row * bh + m / 2, w = bw - m, h = bh - m;
      const base = 92 + rand() * 38, warm = (rand() - 0.5) * 14, blue = rand() < 0.15 ? 10 : 0;
      g.fillStyle = `rgb(${base + warm},${base + warm * 0.4},${base - warm * 0.3 + blue})`; g.fillRect(x, y, w, h);
      // weathering: darker lower edge, chipped corners, speckle
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
      if (rand() < 0.25) { g.fillStyle = 'rgba(40,36,32,0.25)'; g.fillRect(x + rand() * w * 0.7, y + rand() * h * 0.5, 4 + rand() * 10, 2 + rand() * 4); }
      const hv = 180 + rand() * 60; hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fillRect(x + 1, y + 1, w - 2, h - 2);
      hg.fillStyle = `rgb(${hv - 40},${hv - 40},${hv - 40})`; hg.fillRect(x, y, w, 1); hg.fillRect(x, y, 1, h);
      const rv = 190 + rand() * 50; rg.fillStyle = `rgb(${rv},${rv},${rv})`; rg.fillRect(x, y, w, h);
    }
  }
  noiseSpeckle(g, W, H, 9000, 0.18); noiseSpeckle(hg, W, H, 6000, 0.25);
  return finish(c, hc, rc, { normalStrength: 3, ...opts });
}

// Big irregular flagstones (courtyard paving) with worn edges and grout.
export function flagstone(opts = {}) {
  const S = 1024, c = canvas(S), g = c.getContext('2d'), hc = canvas(S), hg = hc.getContext('2d'), rc = canvas(S), rg = rc.getContext('2d');
  g.fillStyle = '#6d6862'; g.fillRect(0, 0, S, S); hg.fillStyle = '#101010'; hg.fillRect(0, 0, S, S); rg.fillStyle = '#ffffff'; rg.fillRect(0, 0, S, S);
  const rows = [0, 190, 370, 560, 760, 870, S];
  for (let r = 0; r < rows.length - 1; r++) {
    let x = -rand() * 120; const y0 = rows[r], y1 = rows[r + 1];
    while (x < S) {
      const w = 160 + rand() * 230; const gap = 5;
      const v = 128 + rand() * 22, t = (rand() - 0.5) * 10;
      const px = x + gap / 2, py = y0 + gap / 2, pw = w - gap, ph = y1 - y0 - gap;
      const path = new Path2D(); const k = 10 + rand() * 8; // rounded, slightly irregular corners
      path.moveTo(px + k, py + rand() * 3); path.lineTo(px + pw - k, py + rand() * 3); path.quadraticCurveTo(px + pw, py, px + pw - rand() * 3, py + k);
      path.lineTo(px + pw - rand() * 3, py + ph - k); path.quadraticCurveTo(px + pw, py + ph, px + pw - k, py + ph - rand() * 3);
      path.lineTo(px + k, py + ph - rand() * 3); path.quadraticCurveTo(px, py + ph, px + rand() * 3, py + ph - k); path.lineTo(px + rand() * 3, py + k); path.quadraticCurveTo(px, py, px + k, py);
      g.fillStyle = `rgb(${v + t + 2},${v + t * 0.5 + 1},${v - t * 0.4})`; g.fill(path);
      g.save(); g.clip(path);
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '255,240,220' : '30,24,18'},${0.04 + rand() * 0.06})`; g.beginPath(); g.ellipse(px + rand() * pw, py + rand() * ph, 20 + rand() * 70, 10 + rand() * 40, rand() * 3, 0, 7); g.fill(); }
      if (rand() < 0.35) { g.strokeStyle = 'rgba(25,20,16,0.35)'; g.lineWidth = 1.2; g.beginPath(); let cx = px + rand() * pw, cy = py; g.moveTo(cx, cy); for (let i = 0; i < 6; i++) { cx += (rand() - 0.5) * 40; cy += ph / 6; g.lineTo(cx, cy); } g.stroke(); }
      g.restore();
      const hv = 170 + rand() * 50; hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fill(path);
      hg.save(); hg.clip(path); hg.lineWidth = 10; hg.strokeStyle = 'rgba(0,0,0,0.25)'; hg.stroke(path); hg.restore();
      const rv = 170 + rand() * 60; rg.fillStyle = `rgb(${rv},${rv},${rv})`; rg.fill(path);
      x += w;
    }
  }
  noiseSpeckle(g, S, S, 30000, 0.14); noiseSpeckle(hg, S, S, 20000, 0.2);
  return finish(c, hc, rc, { normalStrength: 2.5, ...opts });
}

// Warm wooden planks with grain + knots, used for deck, counter and furniture.
export function woodPlanks({ planks = 6, tone = [150, 98, 58], vertical = false, ...opts } = {}) {
  const S = 512, c = canvas(S), g = c.getContext('2d'), hc = canvas(S), hg = hc.getContext('2d');
  const ph = S / planks;
  for (let i = 0; i < planks; i++) {
    const k = 0.82 + rand() * 0.3; const [r, gg, b] = tone.map((v) => v * k);
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, i * ph, S, ph);
    for (let l = 0; l < 26; l++) { // grain lines
      const y = i * ph + rand() * ph; g.strokeStyle = `rgba(${rand() < 0.5 ? '60,34,18' : '255,220,170'},${0.08 + rand() * 0.12})`; g.lineWidth = 0.6 + rand() * 1.4;
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + l) * 2 + (rand() - 0.5) * 1.5); g.stroke();
    }
    if (rand() < 0.6) { const kx = rand() * S, ky = i * ph + ph * (0.3 + rand() * 0.4); g.fillStyle = 'rgba(70,40,20,0.55)'; g.beginPath(); g.ellipse(kx, ky, 6 + rand() * 6, 3 + rand() * 3, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(70,40,20,0.3)'; g.beginPath(); g.ellipse(kx, ky, 12, 6, 0, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(30,16,8,0.7)'; g.fillRect(0, i * ph, S, 2); // seam
    const hv = 200 + rand() * 40; hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fillRect(0, i * ph + 3, S, ph - 4); hg.fillStyle = '#303030'; hg.fillRect(0, i * ph, S, 3);
    // end joints
    const jx = rand() * S; g.fillStyle = 'rgba(30,16,8,0.6)'; g.fillRect(jx, i * ph, 2, ph); hg.fillStyle = '#404040'; hg.fillRect(jx, i * ph, 2, ph);
  }
  noiseSpeckle(g, S, S, 5000, 0.08);
  let color = c, height = hc;
  if (vertical) { const rot = (src) => { const o = canvas(S); const og = o.getContext('2d'); og.translate(S / 2, S / 2); og.rotate(Math.PI / 2); og.drawImage(src, -S / 2, -S / 2); return o; }; color = rot(c); height = rot(hc); }
  return finish(color, height, null, { normalStrength: 2, ...opts });
}

// Hand-painted kilim style rug.
export function kilim(opts = {}) {
  const W = 512, H = 768, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#8f2f22'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e9b46a'; g.lineWidth = 10; g.strokeRect(18, 18, W - 36, H - 36);
  g.strokeStyle = '#2f4f6a'; g.lineWidth = 6; g.strokeRect(36, 36, W - 72, H - 72);
  const cols = ['#d97b2b', '#f1d9a6', '#2f4f6a', '#b9472e'];
  for (let y = 90; y < H - 90; y += 120) for (let x = 100; x < W - 60; x += 155) {
    g.save(); g.translate(x + 40, y + 50);
    for (let s = 4; s > 0; s--) { g.fillStyle = cols[s % 4]; g.beginPath(); g.moveTo(0, -s * 14); g.lineTo(s * 12, 0); g.lineTo(0, s * 14); g.lineTo(-s * 12, 0); g.closePath(); g.fill(); }
    g.restore();
  }
  for (let x = 0; x < W; x += 8) { g.fillStyle = '#f1e2c4'; g.fillRect(x, 0, 3, 10); g.fillRect(x, H - 10, 3, 10); }
  noiseSpeckle(g, W, H, 20000, 0.12);
  const hc = canvas(W, H); const hg = hc.getContext('2d'); hg.fillStyle = '#888'; hg.fillRect(0, 0, W, H); noiseSpeckle(hg, W, H, 40000, 0.5);
  return finish(c, hc, null, { normalStrength: 1, ...opts });
}

// Grey clay roof tiles (筒瓦/板瓦 rows): bright rounded tubes alternating with dark channels. Tiles run along V.
export function roofTiles(opts = {}) {
  const S = 512, c = canvas(S), g = c.getContext('2d'), hc = canvas(S), hg = hc.getContext('2d');
  const n = 8, cw = S / n;
  for (let i = 0; i < n; i++) {
    const x = i * cw;
    const ch = g.createLinearGradient(x, 0, x + cw, 0); ch.addColorStop(0, '#2b2d30'); ch.addColorStop(0.5, '#3d4044'); ch.addColorStop(1, '#2b2d30');
    g.fillStyle = ch; g.fillRect(x, 0, cw, S);
    const tx = x + cw * 0.5; const tube = g.createLinearGradient(tx - cw * 0.3, 0, tx + cw * 0.3, 0);
    tube.addColorStop(0, '#3a3c40'); tube.addColorStop(0.35, '#6c6f74'); tube.addColorStop(0.55, '#5a5d62'); tube.addColorStop(1, '#2e3034');
    g.fillStyle = tube; g.fillRect(tx - cw * 0.3, 0, cw * 0.6, S);
    for (let y = 0; y < S; y += 64) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(tx - cw * 0.3, y, cw * 0.6, 3); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + 32, cw, 2); }
    const hgr = hg.createLinearGradient(tx - cw * 0.5, 0, tx + cw * 0.5, 0); hgr.addColorStop(0, '#202020'); hgr.addColorStop(0.2, '#303030'); hgr.addColorStop(0.5, '#f0f0f0'); hgr.addColorStop(0.8, '#303030'); hgr.addColorStop(1, '#202020');
    hg.fillStyle = hgr; hg.fillRect(x, 0, cw, S);
  }
  noiseSpeckle(g, S, S, 14000, 0.15); // lichen + dust
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,120,80,${0.05 + rand() * 0.08})`; g.beginPath(); g.ellipse(rand() * S, rand() * S, 6 + rand() * 18, 4 + rand() * 10, 0, 0, 7); g.fill(); }
  return finish(c, hc, null, { normalStrength: 4, ...opts });
}

// Small helpers for flat-painted textures (fabric, paper lantern) where a normal map is overkill.
export function stripes(colors, n = 8, opts = {}) {
  const c = canvas(256), g = c.getContext('2d');
  for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect(0, i * 256 / n, 256, 256 / n); }
  noiseSpeckle(g, 256, 256, 3000, 0.1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (opts.repeat) t.repeat.set(...opts.repeat); return t;
}

export function paperLantern() {
  const c = canvas(256), g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 180); gr.addColorStop(0, '#fff3d0'); gr.addColorStop(1, '#f2a54a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120,60,20,0.35)'; for (let y = 16; y < 256; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
