import { avatarInfo } from './avatars.js';
import { L } from './i18n.js';
const $ = (id) => document.getElementById(id);
const HKEY = 'tiaohai.history.v1';
const CTRL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]', 'g');
const clean = (s) => [...String(s).replace(CTRL, '')].slice(0, 16).join('').trim();
const hhmm = (ts) => { const d = new Date(ts); return '[' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ']'; };
export const cleanNick = clean;

export class Chat {
  constructor(net, me) {
    this.net = net; this.me = me; this.peers = new Map(); this.seen = new Set(); this.unread = 0; this.open = false;
    this.stickBottom = true; this.onPeers = () => {}; this.onUnread = () => {};
    this.tr = $('transcript');
    net.onmessage = (m) => this.recv(m);
    net.onstatus = (ok) => this.setConn(ok);
    this.tr.addEventListener('scroll', () => {
      this.stickBottom = this.tr.scrollHeight - this.tr.scrollTop - this.tr.clientHeight < 24;
      if (this.stickBottom) $('new-msgs').hidden = true;
    });
    $('new-msgs').onclick = () => this.scrollEnd(true);
    this.tr.addEventListener('click', () => { $('sidebar').classList.remove('open'); $('online-count').setAttribute('aria-expanded', 'false'); });
    const input = $('chat-input');
    // never submit while an IME is composing (Enter confirms the candidate, not the message)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
    $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    $('rename-btn').onclick = () => this.rename($('rename-input').value);
    $('rename-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) this.rename(e.target.value); });
    this.loadHistory();
    this.hello(); this.timer = setInterval(() => this.tick(), 2000);
    addEventListener('beforeunload', () => net.send({ t: 'bye', id: me.id, nick: me.nick }));
    this.sys(L(`${me.nick}进入聊天室。`, `${me.nick} joined the chat.`));
    net.send({ t: 'join', id: me.id, nick: me.nick, avatar: me.avatar, eid: this.eid(), ts: Date.now() });
  }
  setConn(ok) { $('conn').textContent = ok ? '' : L('连接已断开，正在重连', 'Disconnected, reconnecting'); if (ok) { this.hello(); } else if (this.open !== undefined) this.sys(L('连接已断开，正在重连', 'Disconnected, reconnecting')); }
  eid() { return this.me.id + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 7); }
  hello() { this.net.send({ t: 'hello', id: this.me.id, nick: this.me.nick, avatar: this.me.avatar }); this.renderPeers(); }
  tick() {
    this.hello();
    const now = Date.now();
    for (const [id, p] of this.peers) if (now - p.last > 7000) { this.peers.delete(id); this.sys(L(`${p.nick}离开聊天室。`, `${p.nick} left the chat.`)); }
    this.renderPeers();
  }
  recv(m) {
    if (!m || m.id === this.me.id) return;
    const now = Date.now();
    if (m.t === 'hello' || m.t === 'join') {
      const known = this.peers.has(m.id);
      this.peers.set(m.id, { nick: m.nick, avatar: m.avatar, last: now });
      if (!known && m.t === 'hello') this.sys(L(`${m.nick}进入聊天室。`, `${m.nick} joined the chat.`));
      this.renderPeers();
    } else if (m.t === 'bye') {
      if (this.peers.delete(m.id)) { this.sys(L(`${m.nick}离开聊天室。`, `${m.nick} left the chat.`)); this.renderPeers(); }
    } else if (m.t === 'rename') {
      const p = this.peers.get(m.id); if (p) { p.nick = m.nick; p.last = now; }
      this.sys(L(`${m.old}改名为${m.nick}。`, `${m.old} is now ${m.nick}.`)); this.renderPeers();
    } else if (m.t === 'chat') {
      if (this.seen.has(m.eid)) return; this.seen.add(m.eid); this.addMsg(m, false); this.pushHistory(m);
    }
  }
  send() {
    const input = $('chat-input'); const text = [...input.value.replace(/[\r\n]+/g, ' ')].slice(0, 300).join('').trim();
    if (!text) return;
    const m = { t: 'chat', eid: this.eid(), id: this.me.id, nick: this.me.nick, avatar: this.me.avatar, text, ts: Date.now() };
    if (!this.net.send(m)) { this.sys(L('发送失败：连接已断开，恢复后再试。', 'Couldn’t send: disconnected, try again once it’s back.')); return; }
    this.seen.add(m.eid); this.addMsg(m, true); this.pushHistory(m); input.value = ''; this.scrollEnd(true);
  }
  sendText(text) { const m = { t: 'chat', eid: this.eid(), id: this.me.id, nick: this.me.nick, avatar: this.me.avatar, text: String(text).slice(0, 300), ts: Date.now() }; if (!this.net.send(m)) { this.sys(L('发送失败：连接已断开，恢复后再试。', 'Couldn’t send: disconnected, try again once it’s back.')); return false; } this.seen.add(m.eid); this.addMsg(m, true); this.pushHistory(m); return true; }
  rename(raw) {
    const nick = clean(raw); if (!nick || nick === this.me.nick) return;
    const old = this.me.nick; this.me.nick = nick; localStorage.setItem('tiaohai.nick', nick);
    this.net.send({ t: 'rename', id: this.me.id, old, nick }); this.sys(L(`${old}改名为${nick}。`, `${old} is now ${nick}.`));
    $('hud-name').textContent = nick; this.me.onRename && this.me.onRename(nick); this.renderPeers();
  }
  setOpen(v) {
    this.open = v; if (v) { this.unread = 0; this.onUnread(0); $('rename-input').value = this.me.nick; setTimeout(() => { this.scrollEnd(true); }, 0); }
  }
  addMsg(m, mine) {
    const el = document.createElement('div'); el.className = 'msg' + (mine ? ' me' : '');
    const t = document.createElement('span'); t.className = 'time'; t.textContent = hhmm(m.ts);
    const n = document.createElement('span'); n.className = 'nick'; n.textContent = m.nick + '：'; // textContent: never HTML
    const x = document.createElement('span'); x.textContent = m.text;
    el.append(t, n, x); this.append(el, mine);
    if (!mine && !this.open) { this.unread++; this.onUnread(this.unread); }
  }
  sys(text) { const el = document.createElement('div'); el.className = 'msg sys'; el.textContent = L(`${hhmm(Date.now())} 系统：${text}`, `${hhmm(Date.now())} System: ${text}`); this.append(el, false, true); }
  append(el, mine, quiet) {
    const was = this.stickBottom; this.tr.appendChild(el);
    while (this.tr.children.length > 200) this.tr.firstChild.remove();
    if (mine || was) this.scrollEnd(); else if (!quiet) $('new-msgs').hidden = false;
  }
  scrollEnd(force) { this.tr.scrollTop = this.tr.scrollHeight; this.stickBottom = true; $('new-msgs').hidden = true; }
  renderPeers() {
    const ul = $('online-list'); ul.textContent = '';
    const all = [{ nick: this.me.nick, avatar: this.me.avatar, self: true }, ...[...this.peers.values()]];
    const dup = {}; all.forEach((p) => (dup[p.nick] = (dup[p.nick] || 0) + 1));
    all.forEach((p, i) => {
      const li = document.createElement('li'); const d = document.createElement('img'); d.className = 'online-list-portrait'; d.alt = ''; d.src = `/assets/portraits/${avatarInfo(p.avatar).portrait}.webp`;
      const s = document.createElement('span'); s.textContent = p.nick + (dup[p.nick] > 1 ? `#${i + 1}` : '') + (p.self ? L('（我）', ' (me)') : ''); li.append(d, s); ul.appendChild(li);
    });
    $('online-count').textContent = L(`在线 ${all.length}`, `Online ${all.length}`);
    this.onPeers(all.length);
  }
  pushHistory(m) {
    try { const h = JSON.parse(localStorage.getItem(HKEY) || '[]'); if (h.some((x) => x.eid === m.eid)) return; h.push(m); localStorage.setItem(HKEY, JSON.stringify(h.slice(-100))); } catch {}
  }
  loadHistory() {
    try { for (const m of JSON.parse(localStorage.getItem(HKEY) || '[]')) { this.seen.add(m.eid); const el = document.createElement('div'); el.className = 'msg' + (m.id === this.me.id ? ' me' : ''); const t = document.createElement('span'); t.className = 'time'; t.textContent = hhmm(m.ts); const n = document.createElement('span'); n.className = 'nick'; n.textContent = m.nick + '：'; const x = document.createElement('span'); x.textContent = m.text; el.append(t, n, x); this.tr.appendChild(el); } } catch {}
  }
}
