import * as THREE from 'three';

// DOM speech bubbles anchored to 3D points (crisp CJK text, cheap). One live bubble per speaker.
const _v = new THREE.Vector3();

export function createSpeech(container, camera) {
  const live = new Map(); // speaker id → { el, anchor, until }
  function say(id, anchor, text, { ms = 4200, name, tone = 'cat' } = {}) {
    let b = live.get(id);
    if (!b) {
      // outer element is positioned every frame; the inner one carries the pop animation
      const el = document.createElement('div'); el.className = `bubble ${tone}`; el.setAttribute('aria-live', 'polite');
      const inner = document.createElement('div'); inner.className = 'bubble-inner'; el.appendChild(inner);
      if (name) { const n = document.createElement('b'); n.className = 'bubble-name'; inner.appendChild(n); }
      const t = document.createElement('span'); t.className = 'bubble-text'; inner.appendChild(t);
      container.appendChild(el); b = { el, inner }; live.set(id, b);
    }
    if (name) b.el.querySelector('.bubble-name').textContent = name;
    b.el.querySelector('.bubble-text').textContent = text; // textContent: never HTML
    b.anchor = anchor; b.until = performance.now() + ms;
    b.inner.classList.remove('pop'); void b.inner.offsetWidth; b.inner.classList.add('pop');
  }
  function update() {
    const now = performance.now(), w = innerWidth, h = innerHeight;
    for (const [id, b] of live) {
      if (now > b.until) { b.el.remove(); live.delete(id); continue; }
      b.anchor(_v);
      const dist = camera.position.distanceTo(_v);
      _v.project(camera);
      const on = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && dist < 24;
      b.el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) continue;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const k = THREE.MathUtils.clamp(1.25 - dist / 30, 0.7, 1.1);
      b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`;
      b.el.style.opacity = String(Math.min(1, (b.until - now) / 400));
    }
  }
  return { say, update, has: (id) => live.has(id) };
}
