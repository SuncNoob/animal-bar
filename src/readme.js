import README from '../README.md?raw';
import { L } from './i18n.js';

// The yard computer's browser: a Windows 95 / Netscape window inside a beige CRT, showing this project's own
// README (rendered from README.md, screenshots and all) as if it were 1995 and GitHub had just been invented.
// Links inside the README open in a new tab; in WeChat & co. they ask first, since that leaves the game.
// openReadme(body, { onClose, onShare })

export const REPO = 'https://github.com/SuncNoob/animal-bar';
const IN_APP = /MicroMessenger|QQ\/|Weibo|DingTalk|Lark|Feishu|AlipayClient/i.test(navigator.userAgent);
const SHOTS = import.meta.glob('../docs/screenshots/*', { eager: true, query: '?url', import: 'default' });

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// just enough Markdown for README.md: headings, paragraphs, lists, tables, fenced code, **bold**, `code`, links, images
function inline(host, text) {
  const re = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) host.append(text.slice(last, m.index));
    if (m[2]) { const src = SHOTS[`../${m[2]}`]; if (src) { const i = el('img'); i.src = src; i.alt = m[1]; i.loading = 'lazy'; host.append(i); } }
    else if (m[4]) { const a = el('a', null, m[3]); a.href = /^https?:/.test(m[4]) ? m[4] : `${REPO}/blob/main/${m[4]}`; host.append(a); }
    else if (m[5]) host.append(el('b', null, m[5]));
    else host.append(el('code', null, m[6]));
    last = re.lastIndex;
  }
  if (last < text.length) host.append(text.slice(last));
  return host;
}
function renderMarkdown(md) {
  const out = el('div', 'md'), lines = md.split('\n'); let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) { const code = []; for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]); i++; const pre = el('pre'); pre.append(el('code', null, code.join('\n'))); out.append(pre); continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(line); if (h) { out.append(inline(el('h' + h[1].length), h[2])); i++; continue; }
    if (line.startsWith('|')) {
      const t = el('table'); let first = true;
      for (; i < lines.length && lines[i].startsWith('|'); i++) {
        const cells = lines[i].slice(1, -1).split('|').map((c) => c.trim());
        if (cells.every((c) => /^-*$/.test(c))) continue;
        if (first && cells.every((c) => !c)) { first = false; continue; } // the README's empty header row
        const tr = el('tr'); cells.forEach((c) => tr.append(inline(el(first ? 'th' : 'td'), c))); t.append(tr); first = false;
      }
      out.append(t); continue;
    }
    if (/^- /.test(line)) {
      const ul = el('ul');
      while (i < lines.length && /^- /.test(lines[i])) { let item = lines[i].slice(2); for (i++; i < lines.length && /^ {2}\S/.test(lines[i]); i++) item += ' ' + lines[i].trim(); ul.append(inline(el('li'), item)); }
      out.append(ul); continue;
    }
    const para = [line]; for (i++; i < lines.length && lines[i].trim() && !/^(#|- |\||```)/.test(lines[i]); i++) para.push(lines[i]);
    out.append(inline(el('p'), para.join(' ')));
  }
  return out;
}
// the headings and "Things to do" bullets, for the CRT on the desk (src/scene/computer.js)
// title = the heading / the bold lead of a bullet, sub = the start of what follows it
export const README_ITEMS = README.split('\n').filter((l) => /^## |^- \*\*/.test(l)).map((l) => {
  const todo = l.startsWith('- '), b = /\*\*([^*]+)\*\*\s*(.*)/.exec(l);
  return todo && b ? { tag: 'do', title: b[1].replace(/[.:]$/, ''), sub: b[2] } : { tag: 'h', title: l.replace(/^#+ /, ''), sub: 'README.md' };
});

export function openReadme(body, { onClose, onShare }) {
  const crt = el('div', 'crt');
  const win = el('div', 'w95'); crt.append(win);
  const tb = el('div', 'w95-title');
  const ico = el('span', 'w95-ico', 'N'); ico.setAttribute('aria-hidden', 'true');
  const btns = el('span', 'w95-btns');
  for (const [t, lab] of [['_', L('最小化', 'Minimize')], ['□', L('最大化', 'Maximize')]]) { const b = el('button', 'w95-tbtn', t); b.tabIndex = -1; b.setAttribute('aria-label', lab); b.onclick = () => nope(); btns.append(b); }
  const x = el('button', 'w95-tbtn', '×'); x.setAttribute('aria-label', L('关闭', 'Close')); x.onclick = onClose; btns.append(x);
  tb.append(ico, el('span', 'w95-ttl', 'Netscape - [Animal Bar · README]'), btns);
  const menu = el('div', 'w95-menu'); for (const m of L(['文件(F)', '编辑(E)', '查看(V)', '前往(G)', '书签(B)', '选项(O)', '帮助(H)'], ['File', 'Edit', 'View', 'Go', 'Bookmarks', 'Options', 'Help'])) menu.append(el('span', null, m));
  const tools = el('div', 'w95-tools');
  const tool = (glyph, label, fn) => { const b = el('button', 'w95-tool'); b.append(el('i', null, glyph), el('span', null, label)); b.setAttribute('aria-label', label); b.onclick = fn; tools.append(b); return b; };
  tool('⌂', L('回到顶部', 'Top'), () => { page.scrollTop = 0; });
  tool('↻', L('重新载入', 'Reload'), () => { page.scrollTop = 0; load(); });
  tool('↗', 'GitHub', () => go(REPO));
  if (onShare) tool('✉', L('分享', 'Share'), () => { const ok = onShare(L(`🖥 院子的电脑上在放这个游戏的说明书：${REPO}`, `🖥 The yard computer is showing this game's README: ${REPO}`)); stText.textContent = ok ? L('已经发到酒馆聊天室', 'Posted to the bar chat') : L('发送失败，稍后再试', 'Couldn’t send, try again later'); });
  const throb = el('div', 'w95-throb', 'N'); throb.setAttribute('aria-hidden', 'true'); tools.append(throb);
  const addr = el('div', 'w95-addr'); addr.append(el('span', null, L('位置:', 'Location:')));
  const url = el('input', 'w95-url'); url.value = REPO; url.readOnly = true; url.setAttribute('aria-label', L('网址', 'Address')); addr.append(url);
  const page = el('div', 'w95-page'); page.tabIndex = 0; page.append(renderMarkdown(README));
  const foot = el('div', 'sw-foot'); const a = el('a', 'w95-btn big ext', L('在 GitHub 上看源码 ↗', 'See the source on GitHub ↗')); a.href = REPO; foot.append(a); page.append(foot);
  const status = el('div', 'w95-status'); const stText = el('span', 'w95-st', L('文档：完成', 'Document: Done')); const bar = el('span', 'w95-bar'); const fill = el('i'); bar.append(fill); status.append(stText, bar);
  win.append(tb, menu, tools, addr, page, status);
  const chin = el('div', 'crt-chin'); chin.append(el('span', 'crt-brand', 'ANIMAL·BAR·15″'), el('span', 'crt-knobs'), el('span', 'crt-led')); crt.append(chin);
  body.append(crt);

  page.addEventListener('click', (e) => { const l = e.target.closest('a'); if (!l) return; e.preventDefault(); go(l.href); });
  page.addEventListener('pointerover', (e) => { const l = e.target.closest('a'); stText.textContent = l ? L(`↗ 在新窗口打开 ${l.href}`, `↗ Open in a new window: ${l.href}`) : L('文档：完成', 'Document: Done'); });

  let tm = 0;
  function load() { // a dial-up page load: throbber, progress bar, the page painting top to bottom
    crt.classList.add('loading'); page.classList.remove('painted'); void page.offsetWidth; page.classList.add('painted'); page.style.setProperty('--paint', '1.15s');
    let p = 0; clearInterval(tm);
    tm = setInterval(() => {
      p = Math.min(100, p + 7 + Math.random() * 16); fill.style.width = `${p}%`;
      stText.textContent = p < 100 ? L(`正在连接 github.com… ${Math.round(p)}%（14.4 kbps）`, `Connecting to github.com… ${Math.round(p)}% (14.4 kbps)`) : L('文档：完成', 'Document: Done');
      if (p >= 100) { clearInterval(tm); crt.classList.remove('loading'); setTimeout(() => { fill.style.width = '0'; }, 400); }
    }, 90);
  }
  function nope(msg = L('这台 1995 年的电脑不支持这个功能 :)', 'This 1995 computer doesn’t support that :)')) { win.classList.remove('nope'); void win.offsetWidth; win.classList.add('nope'); stText.textContent = msg; }
  function go(href) {
    if (!IN_APP) { window.open(href, '_blank', 'noopener,noreferrer'); return; }
    win.querySelector('.w95-dlg')?.remove();
    const dlg = el('div', 'w95-dlg'); dlg.setAttribute('role', 'alertdialog'); dlg.setAttribute('aria-label', L('离开酒馆', 'Leave the bar'));
    const t = el('div', 'w95-title'); t.append(el('span', 'w95-ttl', 'Netscape'));
    const msg = el('div', 'w95-dlg-msg'); msg.append(el('span', 'w95-dlg-ico', '!'), el('span', null, L('在微信里打开会离开酒馆，回来要重新进门。继续吗？', 'Opening it in WeChat leaves the bar, and you’ll have to come back in. Continue?')));
    const row = el('div', 'w95-dlg-row'); const ok = el('button', 'w95-btn', L('确定', 'OK')), no = el('button', 'w95-btn', L('取消', 'Cancel'));
    ok.onclick = () => { location.href = href; }; no.onclick = () => dlg.remove(); row.append(ok, no);
    dlg.append(t, msg, row); win.append(dlg); ok.focus();
  }
  load();
}
