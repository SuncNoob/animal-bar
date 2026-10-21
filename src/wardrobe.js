import * as THREE from 'three';
import { createCharacter, OUTFIT_COLORS } from './scene/characters.js';
import { HATS } from './scene/hats.js';
import { avatarInfo } from './avatars.js';
import { L } from './i18n.js';

// 换装: colour swatches + head wear chips + a small live 3D preview of your character.
// mountWardrobe(el, { getAvatar, outfit, onChange }) → { setAvatar(kind), refresh(), destroy() }

let preview = null; // one shared WebGL preview (moved between the entry card and the in-game panel)
function getPreview() {
  if (preview) return preview;
  const size = 168;
  const el = document.createElement('div'); el.className = 'wd-preview'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', L('装扮预览', 'Outfit preview'));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(size, size);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.setClearColor(0, 0);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dd, 0x6a5a7a, 1.7));
  const key = new THREE.DirectionalLight(0xffdcb4, 2.4); key.position.set(1.5, 2.4, 2.6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8c8ff, 1.2); rim.position.set(-2, 1.6, -1.6); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  let ch = null, kind = null, raf = 0, last = 0, spin = 0.5, drag = null;
  const frame = (now) => {
    raf = 0; if (!el.isConnected || document.hidden) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!drag) spin += dt * 0.6;
    if (ch) { ch.root.rotation.y = spin; ch.play('idle'); ch.update(dt); }
    renderer.render(scene, camera);
  };
  const start = () => { if (!raf && el.isConnected) { last = 0; raf = requestAnimationFrame(frame); } };
  const mo = new MutationObserver(start); mo.observe(document.body, { childList: true, subtree: true });
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, s: spin }; try { el.setPointerCapture(e.pointerId); } catch {} });
  el.addEventListener('pointercancel', () => { drag = null; }); el.addEventListener('lostpointercapture', () => { drag = null; });
  el.addEventListener('pointermove', (e) => { if (drag) spin = drag.s + (e.clientX - drag.x) / 60; });
  el.addEventListener('pointerup', () => { drag = null; });
  preview = {
    el,
    dispose() { cancelAnimationFrame(raf); raf = 0; mo.disconnect(); el.remove(); renderer.dispose(); renderer.forceContextLoss(); },
    show(k, outfit) {
      if (k !== kind) {
        if (ch) scene.remove(ch.root);
        kind = k; ch = k ? createCharacter(k) : null;
        if (ch) { scene.add(ch.root); ch.root.position.y = -0.02; }
        const h = avatarInfo(k).view;
        camera.position.set(0, h * 0.62, 3.4); camera.lookAt(0, h * 0.5, 0);
      }
      ch?.setOutfit(outfit); start();
    },
  };
  return preview;
}

// free the preview's WebGL context (phones have little GPU memory); it is rebuilt the next time a wardrobe shows
export function releasePreview() { if (preview) { preview.dispose(); preview = null; } }

export function mountWardrobe(el, { getAvatar, outfit, onChange }) {
  el.classList.add('wardrobe');
  el.innerHTML = '';
  const slot = document.createElement('div'); slot.className = 'wd-slot';
  const side = document.createElement('div'); side.className = 'wd-controls';
  const cLabel = document.createElement('div'); cLabel.className = 'wd-label'; cLabel.textContent = L('衣服颜色', 'Outfit colour');
  const colors = document.createElement('div'); colors.className = 'wd-colors'; colors.setAttribute('role', 'radiogroup'); colors.setAttribute('aria-label', L('衣服颜色', 'Outfit colour'));
  for (const c of OUTFIT_COLORS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wd-swatch' + (c.hex ? '' : ' orig'); b.title = c.name; b.setAttribute('aria-label', c.name); b.setAttribute('role', 'radio');
    if (c.hex) b.style.setProperty('--sw', c.hex);
    b.onclick = () => { outfit.color = c.id; sync(); onChange({ ...outfit }); };
    b.dataset.id = c.id ?? ''; colors.appendChild(b);
  }
  const hLabel = document.createElement('div'); hLabel.className = 'wd-label'; hLabel.textContent = L('头饰', 'Headwear');
  const hats = document.createElement('div'); hats.className = 'wd-hats'; hats.setAttribute('role', 'radiogroup'); hats.setAttribute('aria-label', L('头饰', 'Headwear'));
  for (const h of HATS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wd-hat'; b.setAttribute('role', 'radio'); b.dataset.id = h.id;
    b.innerHTML = `<span class="wd-ico" aria-hidden="true">${h.icon}</span><span>${h.name}</span>`;
    b.onclick = () => { outfit.hat = h.id; sync(); onChange({ ...outfit }); };
    hats.appendChild(b);
  }
  const cName = document.createElement('span'); cName.className = 'wd-cname'; cLabel.appendChild(cName);
  side.append(cLabel, colors, hLabel, hats);
  el.append(slot, side);
  function sync() {
    for (const b of colors.children) { const on = (b.dataset.id || null) === (outfit.color ?? null); b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); }
    for (const b of hats.children) { const on = b.dataset.id === (outfit.hat || 'none'); b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); }
    cName.textContent = ' · ' + (OUTFIT_COLORS.find((c) => c.id === (outfit.color ?? null))?.name || L('原色', 'Original'));
    const k = getAvatar(); slot.hidden = !k; if (!k) return;
    const pv = getPreview(); if (pv.el.parentNode !== slot) slot.replaceChildren(pv.el); pv.show(k, outfit);
  }
  sync();
  return { refresh: sync };
}
