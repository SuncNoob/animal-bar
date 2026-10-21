import SONGS from './data/songs.json';
import { parseLrc } from './lrc.js';
import { isEn } from './i18n.js';

// Shared jukebox without a server. The room keeps ONE retained state on the broker:
//   { v: 2, rev, trackId, by, byNick, startedAt (epoch ms), queue: [{ id, trackId, by, byNick }] }
// Everyone derives "what is playing right now" from that state + the wall clock:
//  - play trackId from startedAt; when it ends take the next request from the queue;
//  - with no requests, the default track (院子晚风) loops;
//  - a request made while the default track plays cuts it immediately.
// Each guest may have at most one song on the list (queued OR playing); once it has played they can add again.

export const TRACKS = SONGS.tracks.map((t) => ({ ...t, title: (isEn && t.title_en) || t.title, artist: (isEn && t.artist_en) || t.artist }));
export const DEFAULT_ID = (TRACKS.find((t) => t.default) || TRACKS[0]).id;
export const REQUESTABLE = TRACKS.filter((t) => !t.default);
const byId = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
const EPOCH = Date.UTC(2026, 9, 19, 0, 0, 0);

export function lineAt(track, pos) {
  const L = track.lines; let lo = 0, hi = L.length - 1, hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].t <= pos) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit >= 0 && pos < L[hit].end + 0.6 ? hit : -1; // keep a line up briefly after it ends
}

// Lyrics for songs that ship without them: the owner can drop /music/<id>.lrc next to the audio.
async function loadMissingLyrics(onLoaded) {
  for (const t of TRACKS) {
    if (t.lines.length) continue;
    try {
      const res = await fetch(`/music/${t.id}.lrc`, { cache: 'no-cache' });
      const ct = res.headers.get('content-type') || ''; if (!res.ok || ct.includes('html')) continue; // SPA fallback = no file
      const lines = parseLrc(await res.text(), t.duration);
      if (lines.length) { t.lines = lines; onLoaded(t); }
    } catch {}
  }
}

export function createJukebox({ getNet = () => null, me, onChange = () => {}, onError = () => {} }) {
  let state = { v: 2, rev: 0, trackId: DEFAULT_ID, by: null, byNick: '', startedAt: EPOCH, queue: [] };
  const audio = new Audio(); audio.preload = 'auto';
  let listening = false, blocked = false;
  try { audio.volume = +(localStorage.getItem('tiaohai.volume') ?? 0.8); listening = localStorage.getItem('tiaohai.speaker') === 'on'; } catch { audio.volume = 0.8; }

  function resolve(now = Date.now()) {
    let t = state.startedAt, id = byId[state.trackId] ? state.trackId : DEFAULT_ID, by = state.by, byNick = state.byNick;
    const q = [...state.queue];
    for (let guard = 0; guard < 1000; guard++) {
      const dur = byId[id].duration * 1000;
      if (id === DEFAULT_ID && !q.length && now >= t + dur) t += Math.floor((now - t) / dur) * dur; // the default just loops
      if (now < t + dur) return { track: byId[id], pos: Math.max(0, (now - t) / 1000), startedAt: t, by, byNick, queue: q };
      t += dur;
      const next = q.shift();
      if (next) { id = next.trackId; by = next.by; byNick = next.byNick; } else { id = DEFAULT_ID; by = null; byNick = ''; }
    }
    return { track: byId[DEFAULT_ID], pos: 0, startedAt: now, by: null, byNick: '', queue: [] };
  }
  function publish(next) { const net = getNet(); if (!net?.setState || !net.setState('jukebox', next)) return false; state = next; sync(); onChange(); return true; }
  const mine = (cur) => cur.by === me.id || cur.queue.some((r) => r.by === me.id);

  function request(trackId) {
    if (!byId[trackId] || trackId === DEFAULT_ID) return 'invalid';
    const cur = resolve();
    if (mine(cur)) return 'already';
    if (cur.queue.length >= 12) return 'full';
    const now = Date.now(), rev = state.rev + 1;
    if (cur.track.id === DEFAULT_ID) // nobody's song is on: cut the default and play this right now
      return publish({ v: 2, rev, trackId, by: me.id, byNick: me.nick, startedAt: now, queue: [] }) ? 'now' : 'offline';
    const req = { id: me.id + ':' + now.toString(36), trackId, by: me.id, byNick: me.nick };
    return publish({ v: 2, rev, trackId: cur.track.id, by: cur.by, byNick: cur.byNick, startedAt: cur.startedAt, queue: [...cur.queue, req] }) ? 'queued' : 'offline';
  }
  function cancel(reqId) {
    const cur = resolve();
    if (!cur.queue.some((r) => r.id === reqId && r.by === me.id)) return false;
    return publish({ v: 2, rev: state.rev + 1, trackId: cur.track.id, by: cur.by, byNick: cur.byNick, startedAt: cur.startedAt, queue: cur.queue.filter((r) => r.id !== reqId) });
  }

  // keep this device roughly in step with the shared timeline (we don't promise sample-accurate sync)
  function sync() {
    const cur = resolve();
    if (!listening) { if (!audio.paused) audio.pause(); return cur; }
    const want = new URL(cur.track.src, location.href).href;
    if (audio.src !== want) { audio.src = want; audio.currentTime = cur.pos; }
    else if (Math.abs(audio.currentTime - cur.pos) > 1.5 && audio.readyState >= 1) audio.currentTime = cur.pos;
    if (audio.paused && !blocked) audio.play().then(() => { blocked = false; }).catch(() => { blocked = true; onError('blocked'); onChange(); }); // wait for a tap before retrying
    return cur;
  }
  setInterval(sync, 1000);
  addEventListener('pointerdown', () => { if (blocked) { blocked = false; sync(); } }, { capture: true }); // any tap unlocks audio after a block
  audio.addEventListener('ended', sync);
  audio.addEventListener('error', () => onError('load'));
  loadMissingLyrics(() => onChange());

  return {
    tracks: TRACKS, requestable: REQUESTABLE, defaultId: DEFAULT_ID,
    now: () => resolve(),
    hasMine: () => mine(resolve()),
    get listening() { return listening; },
    get blocked() { return blocked; },
    get volume() { return audio.volume; },
    setVolume(v) { audio.volume = v; try { localStorage.setItem('tiaohai.volume', v); } catch {} },
    setListening(on) { listening = on; blocked = false; try { localStorage.setItem('tiaohai.speaker', on ? 'on' : 'off'); } catch {} sync(); onChange(); },
    resume() { blocked = false; sync(); },
    request, cancel,
    receive(obj) { // a retained/broadcast state from the room
      if (!obj || obj.v !== 2 || !Array.isArray(obj.queue)) return; // ignore states from older builds
      if (obj.rev < state.rev) return;
      state = { v: 2, rev: obj.rev | 0, trackId: String(obj.trackId), by: obj.by || null, byNick: String(obj.byNick || ''), startedAt: +obj.startedAt || EPOCH, queue: obj.queue.slice(0, 12).filter((r) => byId[r.trackId] && r.trackId !== DEFAULT_ID) };
      sync(); onChange();
    },
  };
}
