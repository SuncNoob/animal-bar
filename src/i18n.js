// Two languages: 中文 (zh) and English (en).
// Default comes from the build (VITE_LANG: the Aliyun release builds zh, everything else en); a player's own
// choice (the 中/EN toggle) is kept in localStorage. Strings live next to the code as L('中文', 'English').
// Switching language reloads the page; if the player was already inside, they walk straight back in.
export const LANGS = { zh: '中文', en: 'English' };
const KEY = 'tiaohai.lang', AUTO = 'tiaohai.autoenter';
const buildLang = import.meta.env.VITE_LANG === 'zh' ? 'zh' : 'en';
function pick() { try { const s = localStorage.getItem(KEY); if (LANGS[s]) return s; } catch {} return buildLang; }

export const lang = pick();
export const isEn = lang === 'en';
export const L = (zh, en) => (isEn ? en : zh);

export function setLang(next, { reenter = false } = {}) {
  if (!LANGS[next] || next === lang) return;
  try { localStorage.setItem(KEY, next); if (reenter) sessionStorage.setItem(AUTO, '1'); } catch {}
  location.reload();
}
// true once, right after a language switch made from inside the yard
export function takeAutoEnter() { try { const v = sessionStorage.getItem(AUTO) === '1'; sessionStorage.removeItem(AUTO); return v; } catch { return false; } }

// index.html's static text is swapped by the inline script at the end of <body> (data-en / data-en-html /
// data-en-placeholder / data-en-aria) before the first paint; keep its rule in step with pick() above.

// the little 中 / EN switch (entry card + HUD)
export function langToggle({ reenter = false } = {}) {
  const b = document.createElement('button');
  b.className = 'lang-toggle'; b.type = 'button';
  b.textContent = isEn ? '中文' : 'EN';
  b.setAttribute('aria-label', isEn ? '切换到中文' : 'Switch to English');
  b.onclick = () => setLang(isEn ? 'zh' : 'en', { reenter: typeof reenter === 'function' ? reenter() : reenter });
  return b;
}
