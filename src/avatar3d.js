import * as THREE from 'three';
import { createCharacter } from './scene/characters.js';
import { L } from './i18n.js';

// A small live 3D 团团 bust for the quiz: same Tripo model as in the yard, framed on the head,
// idles, follows the pointer with its head, and reacts (wave / nod / cheer). Renders only while on screen.

const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _wq = new THREE.Quaternion();
function rot(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.parent.getWorldQuaternion(_pq).invert();
  _ax.copy(axis).applyQuaternion(_pq).normalize();
  bone.quaternion.premultiply(_q.setFromAxisAngle(_ax, angle));
}

let shared = null;
export function releaseAvatar() { if (shared) { shared.dispose(); shared = null; } }
export function tuantuanAvatar() { if (!shared) { shared = makeAvatar('cat_tuantuan'); if (import.meta.env.DEV) window.__avatar = shared; } return shared; }

function makeAvatar(kind, cssSize = 72) {
  const el = document.createElement('div'); el.className = 'avatar3d'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', L('团团', 'Tuantuan'));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(cssSize, cssSize);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1dd, 0x8a6a5a, 1.6));
  const key = new THREE.DirectionalLight(0xffdcb4, 2.6); key.position.set(1.5, 2.2, 2.6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa8c8ff, 1.3); rim.position.set(-2, 1.6, -1.6); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 10);
  camera.position.set(0.4, 0.9, 1.8); camera.lookAt(0.07, 0.77, 0); // head + ears + scarf, centred in the round frame

  const ch = createCharacter(kind); scene.add(ch.root); ch.root.rotation.y = 0.3;
  const look = { x: 0, y: 0, tx: 0, ty: 0 }; let react = null, raf = 0, last = 0;
  const onMove = (e) => {
    const r = el.getBoundingClientRect(); if (!r.width) return;
    look.tx = THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / 300, -1, 1);
    look.ty = THREE.MathUtils.clamp((e.clientY - (r.top + r.height / 2)) / 300, -1, 1);
  };
  const up = new THREE.Vector3(0, 1, 0), lat = new THREE.Vector3();

  function frame(now) {
    raf = 0;
    if (!el.isConnected || document.hidden) { removeEventListener('pointermove', onMove); return; } // parked until shown again
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (react && now > react.until) { react = null; }
    ch.play(react?.clip || 'idle'); ch.update(dt);
    // head follows the pointer (eased), plus a nod for reactions
    look.x += (look.tx - look.x) * Math.min(1, dt * 6); look.y += (look.ty - look.y) * Math.min(1, dt * 6);
    const head = ch.bones?.Head;
    if (head) {
      lat.set(1, 0, 0).applyQuaternion(ch.root.getWorldQuaternion(_wq));
      rot(head, up, look.x * 0.5);
      const nod = react?.nod ? Math.sin((react.until - now) / 1000 * 14) * 0.18 : 0;
      rot(head, lat, look.y * 0.3 + nod);
    }
    ch.root.position.y = Math.sin(now / 700) * 0.008; // breathing
    renderer.render(scene, camera);
  }
  function start() { if (!raf && el.isConnected) { last = 0; addEventListener('pointermove', onMove); raf = requestAnimationFrame(frame); } }
  // start whenever the element is put into the page
  const mo = new MutationObserver(() => { if (el.isConnected) start(); }); mo.observe(document.body, { childList: true, subtree: true });

  return {
    el,
    dispose() { cancelAnimationFrame(raf); raf = 0; mo.disconnect(); removeEventListener('pointermove', onMove); el.remove(); renderer.dispose(); renderer.forceContextLoss(); },
    // dev only: render one big frame and hand back a data URL
    snapshot(px = 384) { renderer.setSize(px, px); renderer.render(scene, camera); const u = renderer.domElement.toDataURL('image/png'); renderer.setSize(cssSize, cssSize); return u; },
    react(kind) {
      const now = performance.now();
      if (kind === 'wave') react = { clip: 'wave', until: now + 2400 };
      else if (kind === 'cheer') react = { clip: 'cheer', until: now + 2600 };
      else if (kind === 'nod') react = { clip: 'idle', nod: true, until: now + 700 };
      start();
    },
  };
}
