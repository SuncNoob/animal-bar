import * as THREE from 'three';
import { lineAt } from './jukebox.js';
import { L, isEn } from './i18n.js';
const note = (t) => (isEn ? t.note_en : t.note) || '';

// Everything people see of the jukebox: the modal (now playing, listen toggle, scrolling lyrics, requests,
// queue), the HUD "now playing" strip, the chat sidebar mini player, the lyric on the 3D jukebox's screen,
// and a floating subtitle above it.

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountJukeboxUI({ jb, me, $, openModal, speech, toast }) {
  let modal = null, lastKey = '', screen = null, jbObj = null, topLocal = 1;

  // ---------- 3D screen on the jukebox model ----------
  function attachObject(obj) {
    jbObj = obj;
    const box = new THREE.Box3().setFromObject(obj.children[0]); // model space (group not yet scaled/placed)
    const w = box.max.x - box.min.x, h = box.max.y - box.min.y; topLocal = box.max.y;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.52, h * 0.2), mat);
    plane.position.set((box.min.x + box.max.x) / 2, box.min.y + h * 0.715, box.max.z + 0.004);
    obj.add(plane); screen = { cv, g: cv.getContext('2d'), tex };
    lastKey = '';
  }
  function drawScreen(track, text, listening, sub) {
    if (!screen) return;
    const { g, cv, tex } = screen;
    g.fillStyle = '#0f1a1c'; g.fillRect(0, 0, cv.width, cv.height);
    const gr = g.createLinearGradient(0, 0, 0, cv.height); gr.addColorStop(0, 'rgba(255,170,80,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffb35c'; g.font = '700 34px "PingFang SC","Hiragino Sans","Microsoft YaHei",sans-serif'; g.fillText(`♪ ${track.title}`, cv.width / 2, 52);
    g.fillStyle = '#fff3dc'; let size = 40; g.font = `600 ${size}px "PingFang SC","Hiragino Sans","Microsoft YaHei",sans-serif`;
    while (g.measureText(text).width > cv.width - 40 && size > 22) { size -= 2; g.font = `600 ${size}px "PingFang SC","Hiragino Sans","Microsoft YaHei",sans-serif`; }
    g.fillText(text || (track.lines.length ? L('～ 间奏 ～', '~ interlude ~') : track.artist || ''), cv.width / 2, sub ? 128 : 150);
    if (sub) { g.fillStyle = 'rgba(255,230,190,.75)'; g.font = '500 26px "PingFang SC","Hiragino Sans","Microsoft YaHei",sans-serif'; g.fillText(sub, cv.width / 2, 176, cv.width - 40); }
    g.fillStyle = listening ? '#7fe3c8' : 'rgba(255,255,255,.35)'; g.font = '500 22px sans-serif'; g.fillText(listening ? L('🔊 公放中', '🔊 On speaker') : L('点唱机 · 来点歌', 'Jukebox · pick a song'), cv.width / 2, 222);
    tex.needsUpdate = true;
  }

  // ---------- modal ----------
  function render() {
    const root = $('modal-body'); root.textContent = '';
    // the player (now playing, buttons, lyrics) stays put; only the song list below it scrolls
    $('modal').querySelector('.modal-card').classList.add('jb-open');
    const top = el('div', 'jb-top'), scroll = el('div', 'jb-scroll'); root.append(top, scroll);
    let body = top;
    body.append(el('h3', null, L('点唱机', 'Jukebox')));
    const now = el('div', 'jb-now');
    const disc = el('div', 'jb-disc', '💿');
    const meta = el('div', 'jb-meta');
    const title = el('div', 'jb-title'), note = el('div', 'jb-note'), who = el('div', 'jb-who'), bar = el('div', 'jb-bar'), fill = el('i'), time = el('div', 'jb-time');
    bar.appendChild(fill); meta.append(title, note, who, bar, time); now.append(disc, meta); body.appendChild(now);
    const ctl = el('div', 'jb-controls');
    const listen = el('button', 'primary'); listen.onclick = () => { jb.setListening(!jb.listening); refresh(true); };
    const vol = el('input'); vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.value = jb.volume; vol.setAttribute('aria-label', L('本机音量', 'Volume on this device')); vol.oninput = () => jb.setVolume(+vol.value);
    const resume = el('button', null, L('点击恢复播放', 'Tap to resume')); resume.hidden = true; resume.onclick = () => jb.resume();
    ctl.append(listen, el('span', 'jb-vol', '🔈'), vol, resume); body.appendChild(ctl);
    const lyr = el('div', 'jb-lyrics'); lyr.setAttribute('aria-label', L('歌词', 'Lyrics')); body.appendChild(lyr);
    body = scroll; scroll.tabIndex = 0; scroll.setAttribute('aria-label', L('歌单', 'Song list'));
    body.append(el('div', 'mood-sub', L('点歌（全场同步 · 每人歌单里只能有一首，放完可以再点）', 'Request a song (everyone hears it · one song each in the queue, request again once it has played)')));
    const lib = el('div', 'jb-lib'); body.appendChild(lib);
    body.append(el('div', 'mood-sub', L('点歌队列', 'Queue')));
    const queue = el('ul', 'jb-queue'); body.appendChild(queue);
    body.append(el('p', 'mood-note', L('没人点歌时循环《院子晚风》；有人点歌会马上切过去。「公放/静音」只管你这台设备的声音。', 'With no requests, “Courtyard Breeze” loops; a request switches over right away. “Speaker / Mute” only affects the sound on this device.')));
    modal = { disc, title, note, who, fill, time, listen, resume, lyr, lib, queue, trackId: null, line: -2 };
    refresh(true); listen.focus();
  }
  function fillLyrics(track) {
    modal.lyr.textContent = '';
    track.lines.forEach((ln, i) => { const p = el('p', 'jb-line', ln.text); if (ln.sub) p.appendChild(el('span', 'jb-sub', ln.sub)); p.dataset.i = i; modal.lyr.appendChild(p); });
    if (!track.lines.length) modal.lyr.appendChild(el('p', 'jb-line jb-nolyric', L(`${track.title} — ${track.artist || ''}\n暂无歌词`, `${track.title} — ${track.artist || ''}\nNo lyrics yet`)));
    modal.trackId = track.id; modal.line = -2; modal.lines = track.lines.length;
  }
  function fillLists(cur) {
    const mine = jb.hasMine();
    modal.lib.textContent = '';
    for (const t of jb.requestable) {
      const row = el('div', 'jb-track' + (t.id === cur.track.id ? ' playing' : ''));
      const info = el('span', 'jb-track-info'); info.append(el('span', 'jb-track-t', t.title), el('span', 'jb-track-n', `${t.artist || ''}${note(t) ? ' · ' + note(t) : ''} · ${mmss(t.duration)}`));
      row.append(info);
      // two steps so a stray tap while scrolling never requests a song: pick the row, then confirm
      if (mine) { const b = el('button', null, L('你的歌还在单里', 'Your song is queued')); b.disabled = true; row.appendChild(b); }
      else if (modal.pick === t.id) {
        row.classList.add('picked');
        const ok = el('button', 'primary jb-confirm', L('确定点这首', 'Request this')), no = el('button', 'link', L('算了', 'Never mind'));
        ok.onclick = (e) => {
          e.stopPropagation(); modal.pick = null;
          const r = jb.request(t.id);
          toast(r === 'now' ? L(`马上播放《${t.title}》`, `Playing “${t.title}” now`) : r === 'queued' ? L(`已点《${t.title}》，排上队了`, `“${t.title}” is in the queue`) : r === 'already' ? L('你点的歌还在歌单里，放完才能再点', 'Your song is still in the queue; request again after it plays') : r === 'full' ? L('歌单满了，稍后再点', 'The queue is full, try again later') : L('连接已断开，恢复后再试', 'Disconnected, try again once it’s back'), 2400);
          refresh(true);
        };
        no.onclick = (e) => { e.stopPropagation(); modal.pick = null; refresh(true); };
        row.append(no, ok);
      } else {
        const b = el('button', 'jb-pick', L('选这首', 'Pick')); row.appendChild(b);
        row.onclick = () => { modal.pick = t.id; refresh(true); }; row.setAttribute('role', 'button'); row.tabIndex = 0;
        row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.onclick(); } };
      }
      modal.lib.appendChild(row);
    }
    modal.queue.textContent = '';
    if (!cur.queue.length) modal.queue.appendChild(el('li', 'jb-empty', cur.by ? L('后面没人排队 · 放完回到《院子晚风》', 'Nothing queued · back to “Courtyard Breeze” after this one') : L('暂无点歌 · 正在循环《院子晚风》', 'No requests · looping “Courtyard Breeze”')));
    cur.queue.forEach((r, i) => {
      const t = jb.tracks.find((x) => x.id === r.trackId); const li = el('li');
      li.append(el('span', null, L(`${i + 1}. 《${t?.title || '?'}》`, `${i + 1}. “${t?.title || '?'}”`)), el('span', 'jb-by', `— ${r.byNick}${r.by === me.id ? L('（我）', ' (me)') : ''}`));
      if (r.by === me.id) { const c = el('button', 'link', L('取消点歌', 'Cancel request')); c.onclick = () => { jb.cancel(r.id); refresh(true); }; li.appendChild(c); }
      modal.queue.appendChild(li);
    });
  }
  function refresh(lists) {
    if (!modal || !modal.lyr.isConnected) { modal = null; return; }
    const cur = jb.now(), t = cur.track;
    if (modal.trackId !== t.id) { fillLyrics(t); lists = true; }
    modal.title.textContent = t.title; modal.note.textContent = [t.artist, note(t)].filter(Boolean).join(' · ');
    modal.who.textContent = cur.by ? L(`🎵 ${cur.byNick}${cur.by === me.id ? '（我）' : ''} 点的`, `🎵 requested by ${cur.byNick}${cur.by === me.id ? ' (me)' : ''}`) : L('没人点歌 · 默认循环', 'No requests · default loop');
    modal.fill.style.width = `${(cur.pos / t.duration) * 100}%`; modal.time.textContent = `${mmss(cur.pos)} / ${mmss(t.duration)}`;
    modal.listen.textContent = jb.listening ? L('🔊 公放中 · 点我静音', '🔊 On speaker · tap to mute') : L('🔇 静音中 · 点我公放', '🔇 Muted · tap to listen');
    modal.disc.classList.toggle('spin', jb.listening);
    modal.resume.hidden = !jb.blocked;
    const i = lineAt(t, cur.pos);
    if (modal.lines !== t.lines.length) { modal.trackId = null; return refresh(true); } // lyrics arrived late (.lrc)
    if (i !== modal.line) {
      modal.lyr.querySelector('.now')?.classList.remove('now');
      const p = i >= 0 ? modal.lyr.children[i] : null;
      if (p) { p.classList.add('now'); modal.lyr.scrollTo({ top: p.offsetTop - modal.lyr.clientHeight / 2 + p.clientHeight / 2, behavior: 'smooth' }); }
      modal.line = i;
    }
    if (lists) fillLists(cur);
  }
  function open() { openModal(L('点唱机', 'Jukebox')); render(); }

  // ---------- per frame: HUD strip, sidebar mini, 3D screen + floating subtitle ----------
  const pill = $('np-pill'); pill.onclick = open;
  const spk = $('speaker-btn'); spk.onclick = () => jb.setListening(!jb.listening);
  const mini = document.querySelector('.jukebox-mini');
  const anchor = (v) => { if (jbObj) v.set(jbObj.position.x, jbObj.position.y + topLocal * jbObj.scale.y + 0.4, jbObj.position.z); return v; };
  function tick() {
    const cur = jb.now(), t = cur.track, i = lineAt(t, cur.pos), text = i >= 0 ? t.lines[i].text : '', sub = i >= 0 ? t.lines[i].sub || '' : '';
    const key = `${t.id}|${i}|${jb.listening}|${jb.blocked}|${t.lines.length}`;
    if (key !== lastKey) {
      lastKey = key;
      drawScreen(t, text, jb.listening, sub);
      spk.textContent = jb.listening ? (jb.blocked ? L('🔊 点一下恢复', '🔊 Tap to resume') : L('🔊 公放', '🔊 Speaker')) : L('🔇 静音', '🔇 Muted'); spk.classList.toggle('on', jb.listening); spk.setAttribute('aria-pressed', jb.listening);
      pill.textContent = `♪ ${t.title}${text ? ' · ' + text : t.artist ? ' · ' + t.artist : ''}`; pill.classList.toggle('on', jb.listening);
      if (mini) { mini.textContent = ''; mini.append(el('b', null, `♪ ${t.title}`), el('div', 'jb-mini-line', text || L('～ 间奏 ～', '~ interlude ~'))); const b = el('button', null, jb.listening ? L('🔇 静音', '🔇 Mute') : L('🔊 公放', '🔊 Speaker')); b.onclick = () => { jb.setListening(!jb.listening); }; mini.appendChild(b); }
      if (text && jbObj && speech && !matchMedia('(max-width: 640px)').matches) speech.say('jukebox', anchor, // phones: lyrics stay in the top strip, no bubble over the yard
        sub ? `${text}\n${sub}` : text, { ms: Math.max(1500, (t.lines[i].end - cur.pos) * 1000 + 500), tone: 'music', name: `♪ ${t.title}` });
    }
    if (modal) refresh(false);
  }
  return { attachObject, open, tick, refreshLists: () => modal && refresh(true) };
}
