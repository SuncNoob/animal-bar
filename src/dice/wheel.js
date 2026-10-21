import { L } from '../i18n.js';
// An inline picker wheel (iOS-style, but nothing pops up): a column of rows that snaps to the centre.
// Swipe it on a phone, scroll it with the mouse wheel, tap a row, or use ↑/↓ — the centred row is the value.
// wheel({ items: [{ v, label, node? }], value, onPick, label }) → { el, sync() } — call sync() once it is in the page.

const ROW = 40; // px, matches .dp-wheel-item height

export function wheel({ items, value, onPick, label = '' }) {
  const wrap = document.createElement('div'); wrap.className = 'dp-wheel-wrap';
  if (label) { const l = document.createElement('div'); l.className = 'dp-wheel-label'; l.textContent = label; wrap.append(l); }
  const box = document.createElement('div'); box.className = 'dp-wheel'; box.tabIndex = 0;
  box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', label || L('选择', 'Choose'));
  const rows = items.map((it, i) => {
    const r = document.createElement('div'); r.className = 'dp-wheel-item'; r.setAttribute('role', 'option'); r.dataset.i = i;
    if (it.node) r.append(it.node); r.append(document.createTextNode(it.label));
    r.addEventListener('click', () => { touched = true; go(i); });
    return r;
  });
  const pad = () => { const p = document.createElement('div'); p.className = 'dp-wheel-pad'; return p; };
  box.append(pad(), ...rows, pad());
  const band = document.createElement('div'); band.className = 'dp-wheel-band'; band.setAttribute('aria-hidden', 'true');
  wrap.append(box, band);

  let cur = Math.max(0, items.findIndex((it) => it.v === value)), settleT = 0, touched = false; // only a real touch / wheel / key / tap may change the value
  const mark = (i) => rows.forEach((r, k) => { r.classList.toggle('on', k === i); r.setAttribute('aria-selected', k === i); });
  const centred = () => Math.max(0, Math.min(items.length - 1, Math.round(box.scrollTop / ROW)));
  function go(i) { i = Math.max(0, Math.min(items.length - 1, i)); box.scrollTo({ top: i * ROW, behavior: 'smooth' }); mark(i); clearTimeout(settleT); settleT = setTimeout(() => commit(i), 220); } // taps and keys commit directly — no waiting on scroll events
  function commit(i) { if (i === cur) return; cur = i; onPick(items[i].v); }
  for (const ev of ['pointerdown', 'touchstart', 'wheel']) box.addEventListener(ev, () => { touched = true; }, { passive: true });
  box.addEventListener('scroll', () => { mark(centred()); if (!touched) return; clearTimeout(settleT); settleT = setTimeout(() => commit(centred()), 160); }, { passive: true });
  box.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); touched = true; go(cur + (e.key === 'ArrowDown' ? 1 : -1)); } });
  return { el: wrap, sync() { touched = false; box.scrollTop = cur * ROW; mark(cur); requestAnimationFrame(() => { if (!touched) box.scrollTop = cur * ROW; }); } };
}
