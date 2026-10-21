import * as THREE from 'three';
import { makeNameLabel } from './avatar.js';
import { createCharacter, preloadCharacters, loadProp, COLOR_IDS } from './scene/characters.js';
import { HAT_IDS } from './scene/hats.js';
import { mountWardrobe, releasePreview } from './wardrobe.js';
import { releaseAvatar } from './avatar3d.js';
import { createDisco, DISCO_SWITCH, LIGHT_MODES } from './disco.js';
import { createHalloween } from './scene/halloween.js';
import { createSpringboard } from './scene/springboard.js';
import { createOrderRail } from './scene/orderrail.js';
import { createBike, BIKE_HOME } from './scene/bike.js';
import { createDiceGame, BOTS } from './dice/game.js';
import { mountDiceUI } from './dice/ui.js';
import { setupEnvironment, detectQuality } from './scene/env.js';
import { buildWorld, resolveLand, COLLIDERS, insideSea, walkable, groundAt, bedAt, AIR, WATER_Y, DECK, STAIRS, SPOTS, JUMP_EDGE_Z, BOUNDS } from './world.js';
import { LAYOUT } from './layout.js';
import { createNPCs } from './npcs.js';
import { createSpeech } from './speech.js';
import { swimPose, landPose, dancePose, ridePose, surfPose, DEPTH_IDLE } from './swimpose.js';
import { createJukebox } from './jukebox.js';
import { mountJukeboxUI } from './jukeboxUI.js';
import { createBumperFX, boing, plop, pick, BUMP_WORDS, NPC_LINES } from './bumper.js';
import { createNet } from './net.js';
import { Chat, cleanNick } from './chat.js';
import { openMood } from './mood.js';
import { AVATARS, avatarInfo } from './avatars.js';
import { L, isEn, langToggle, takeAutoEnter } from './i18n.js';
import MENU from './data/menu.json';
import { boardsCanvas, signCanvas } from './scene/menuboards.js';

const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---------- entry ----------
const sess = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
const me = { id: sess.get('tiaohai.uid') || 'u_' + Math.random().toString(36).slice(2, 10), nick: store.get('tiaohai.nick') || '', avatar: store.get('tiaohai.avatar') || '' };
sess.set('tiaohai.uid', me.id); // per tab: two tabs of one browser are two guests
const okColor = (c) => (COLOR_IDS.has(c) ? c : null), okHat = (h) => (HAT_IDS.has(h) ? h : 'none');
me.outfit = { color: okColor(store.get('tiaohai.color')), hat: okHat(store.get('tiaohai.hat')) };
function setOutfit(o) {
  me.outfit = { color: okColor(o.color), hat: okHat(o.hat) };
  store.set('tiaohai.color', me.outfit.color || ''); store.set('tiaohai.hat', me.outfit.hat);
  player?.setOutfit(me.outfit); sendPos?.();
}
let started = false;
const nickInput = $('nick-input'); nickInput.value = me.nick;
const refreshEntry = () => {
  document.querySelectorAll('.avatar-btn').forEach((b) => { const on = b.dataset.avatar === me.avatar; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
  $('enter-btn').disabled = !(cleanNick(nickInput.value) && me.avatar);
  entryWardrobe?.refresh();
};
const entryWardrobe = mountWardrobe($('entry-wardrobe'), { getAvatar: () => me.avatar, outfit: { ...me.outfit }, onChange: setOutfit });
document.querySelectorAll('.avatar-btn').forEach((b) => (b.onclick = () => { me.avatar = b.dataset.avatar; refreshEntry(); }));
nickInput.addEventListener('input', refreshEntry);
nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && !$('enter-btn').disabled) $('enter-btn').click(); });
refreshEntry();
$('entry-lang').append(langToggle());
$('hud-lang').append(langToggle({ reenter: () => started }));
$('enter-btn').onclick = () => {
  me.nick = cleanNick(nickInput.value); if (!me.nick || !me.avatar) return;
  store.set('tiaohai.nick', me.nick); store.set('tiaohai.avatar', me.avatar);
  $('entry').hidden = true; $('hud').hidden = false; $('hud-name').textContent = me.nick; releasePreview(); // the entry card's 3D preview is not needed any more
  start();
};

// ---------- three ----------
const canvas = $('game');
const quality = detectQuality();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
const maxPR = Math.min(devicePixelRatio, quality === 'low' ? 1.5 : 1.75);
let pixelRatio = Math.min(maxPR, 1.5);
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
const env = setupEnvironment(renderer, scene, camera, quality);
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false); env.resize(innerWidth, innerHeight, pixelRatio);
  camera.aspect = innerWidth / innerHeight;
  // portrait phones: keep ~60° of horizontal view instead of a letterbox-narrow slice
  camera.fov = camera.aspect < 1 ? Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(30)) / camera.aspect))) : 52;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize); resize();

const tl = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res) => tl.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));

// ---------- state ----------
let world, chat, player, net;
let disco = null, board = null, dice = null, diceUI = null, bike = null, halloween = null, surfBoard = null;
const bikeCol = { x: BIKE_HOME.x, z: BIKE_HOME.z, r: 0.35 }; // the parked bike's collider (off while someone rides it)
const remotes = new Map(); // id -> {obj, label, target, ry, st, last}
let npcs = null, speech = null, jb = null, jbui = null;
const S = { mode: 'land', t: 0, tw: null, yaw: 0, pitch: 0.5, dist: 8, vel: new THREE.Vector3(), kick: new THREE.Vector3(), ry: Math.PI, dash: 0, dashCD: 0, bumpCD: 0, squash: 0, camShake: 0, bumps: 0, vy: 0, air: false };
const GRAVITY = 18, JUMP_V = 6.2;
const keys = {}; const joy = { x: 0, y: 0 };
const pos = new THREE.Vector3((Math.random() - 0.5) * 4 - 0.5, 0, 1.2 + Math.random() * 1.8);
let fx;
let hudHidden = false;

const sceneModules = import.meta.glob('./scene/{water,plants}.js');
async function loadSceneModules() {
  const out = {};
  const w = sceneModules['./scene/water.js']; if (w) { try { out.createPool = (await w()).createPool; } catch (e) { console.warn('water module failed', e); } }
  const p = sceneModules['./scene/plants.js']; if (p) { try { out.createPlants = (await p()).createPlants; } catch (e) { console.warn('plants module failed', e); } }
  return out;
}

// ---------- loading screen: the yard is built in stages so the bar can paint between them; the welcome card stays up
// (its motion is CSS transform/opacity, so it keeps moving through the heavy steps) until the yard has been drawn ----------
const ld = { el: $('loading'), fill: $('ld-fill'), step: $('ld-step') };
// a frame is painted, or 120 ms pass (a background tab gets no frames and must not stall the load)
const nextPaint = () => new Promise((r) => { const t = setTimeout(r, 120); requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0)); });
function loadStep(k, text) { performance.mark('load:' + k); ld.fill.style.transform = `scaleX(${k})`; ld.step.textContent = text; return nextPaint(); }
function loadDone() { ld.el.classList.add('done'); setTimeout(() => ld.el.remove(), 800); if (takeAutoEnter() && !$('enter-btn').disabled) $('enter-btn').click(); }

// The courtyard renders behind the entry card (slow orbit), so the first screen is the bar itself.
let sceneReady = null;
function initScene() {
  if (sceneReady) return sceneReady;
  sceneReady = (async () => {
  await loadStep(0.08, L('正在推开院门…', 'Opening the gate…'));
  const canvasTex = (c) => Object.assign(new THREE.CanvasTexture(c), { colorSpace: THREE.SRGBColorSpace });
  const wordmarkTex = canvasTex(signCanvas()), menuTex = canvasTex(boardsCanvas()); // the shop sign and the six drink boards are drawn, in the player's language
  const mods = await loadSceneModules();
  await loadStep(0.3, L('正在布置院子…', 'Setting up the yard…'));
  world = buildWorld(scene, { renderer, camera, wordmarkTex, menuTex, ...mods });
  const chars = preloadCharacters([...Object.keys(AVATARS), 'cat_tuantuan', 'croc_edazi']);
  await loadStep(0.5, L('团团和鳄搭子正在就位…', 'The cat and the croc are taking their places…'));
  speech = createSpeech($('bubbles'), camera);
  jb = createJukebox({ getNet: () => net, me, onChange: () => jbui?.refreshLists(), onError: (k) => toast(k === 'blocked' ? L('浏览器拦住了声音：点「一起听」或「点击恢复播放」', 'Your browser blocked the sound: tap “Listen along” or “Tap to resume”') : L('这首歌加载失败，稍后再试', 'This song failed to load, try again later'), 3000) });
  jbui = mountJukeboxUI({ jb, me, $, openModal, speech, toast });
  npcs = createNPCs(scene, { insideSea, splash: (x, z, s) => world.pool.splash?.(x, z, s), speech, getNick: () => me.nick }); if (import.meta.env.DEV) window.__npcs = npcs;
  loadProp('jukebox').then((obj) => {
    if (!obj) return; jbui.attachObject(obj);
    const box = new THREE.Box3().setFromObject(obj), k = 1.7 / (box.max.y - box.min.y);
    obj.scale.setScalar(k); obj.position.copy(SPOTS.jukebox); obj.position.y = -box.min.y * k; // feet on the floor
    obj.rotation.y = 0; scene.add(obj); // faces the yard
  });
  fx = createBumperFX(scene);
  await loadStep(0.68, L('正在点亮灯串…', 'Switching on the string lights…'));
  disco = createDisco(scene, { env, bulbs: world.bulbs, quality });
  halloween = createHalloween(scene); COLLIDERS.circles.push(...halloween.colliders); // after the switch: it mustn't dim the pumpkins' own lights
  board = createSpringboard(scene); COLLIDERS.rects.push(board.collider);
  world.orderRail = createOrderRail(scene);
  bike = createBike(scene); COLLIDERS.circles.push(bikeCol);
  camera.position.set(14, 7, 10);
  await loadStep(0.82, L('最后擦一遍吧台…', 'One last wipe of the bar…'));
  try { await renderer.compileAsync(scene, camera); } catch {} // compile shaders off the main thread where the GPU driver allows
  last = performance.now(); requestAnimationFrame(loop);
  document.body.classList.add('scene-ready');
  await nextPaint(); await nextPaint(); // the first frames (shadow maps, post-processing) are the heaviest
  await loadStep(0.94, L('等大家换好衣服…', 'Waiting for everyone to get dressed…'));
  await Promise.race([chars, new Promise((r) => setTimeout(r, 6000))]); // slow network: don't hold the door forever
  await loadStep(1, L('开门啦！', 'We’re open!'));
  setTimeout(loadDone, 300);
  })();
  return sceneReady;
}
initScene();

async function start() {
  if (started) return; started = true;
  await initScene();
  player = createCharacter(me.avatar); scene.add(player.root);
  const labelY = avatarInfo(me.avatar).label;
  let myLabel = makeNameLabel(me.nick, true); myLabel.position.set(0, labelY, 0); player.root.add(myLabel);
  me.onRename = (n) => { player.root.remove(myLabel); myLabel.material.map.dispose(); myLabel = makeNameLabel(n, true); myLabel.position.set(0, labelAt(player, labelY), 0); player.root.add(myLabel); };
  player.onOutfit = () => myLabel.position.set(0, labelAt(player, labelY), 0); // tall hats push the name up
  player.setOutfit(me.outfit);
  net = createNet(me);
  chat = new Chat(net, me);
  dice = createDiceGame({ me, getNet: () => net, tableMates, myGroup: () => (S.mode === 'sit' ? S.seat?.group : null), onEvent: diceEvent, onChange: (s) => diceUI?.render(s) });
  diceUI = mountDiceUI({ dice, me, onStart: startDice });
  chat.onUnread = (n) => { $('unread').hidden = !n; $('unread').textContent = n; };
  chat.onPeers = () => {};
  const pill = $('net-pill'); const showNet = (ok) => { pill.hidden = ok && net.kind !== 'local'; pill.textContent = net.kind === 'local' ? L('本机模式（未联网）', 'Local mode (offline)') : L('重连中…', 'Reconnecting…'); };
  const st0 = net.onstatus; net.onstatus = (ok) => { st0(ok); showNet(ok); }; showNet(net.online);
  net.onstate = (name, obj) => { if (name === 'jukebox') jb.receive(obj); else if (name === 'disco') receiveDisco(obj); else if (name === 'orders') receiveOrders(obj); else if (name === 'bike') receiveBike(obj); }; net.loadState?.('jukebox'); net.loadState?.('disco'); net.loadState?.('orders'); net.loadState?.('bike');
  const prev = net.onmessage;
  net.onmessage = (m) => { handleNet(m); prev(m); };
  setInterval(() => sendPos(), 100);
  toast(matchMedia('(pointer: coarse)').matches ? L('摇杆移动 · 「跳」「冲」可以撞人 · 走到水边能「跳海」', 'Joystick to move · “Jump” and “Go!” bump people · walk to the edge to jump in the sea') : L('WASD 移动 · 空格跳 · Shift 冲撞 · E 互动', 'WASD move · Space jump · Shift charge · E interact'));
}

// ---------- input ----------
addEventListener('keydown', (e) => { if (isTyping() || overlayOpen()) return; keys[e.code] = true; if (e.code === 'Space') { jump(); e.preventDefault(); } if (e.code === 'KeyE' || e.code === 'Enter') { doAction(); e.preventDefault(); } if (e.code === 'Digit1') emote('wave'); if (e.code === 'Digit2') emote('cheer'); if (e.code === 'Digit3') emote('dance'); if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyF') dash(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const overlayOpen = () => !$('modal').hidden || !$('chat').hidden;
const isTyping = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
let drag = null;
const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} }; // capture can fail for a touch iOS already cancelled — never let that break the controls
canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; capture(canvas, e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (!drag || drag.id !== e.pointerId) return; S.yaw -= (e.clientX - drag.x) * 0.006; S.pitch = Math.min(1.2, Math.max(0.1, S.pitch + (e.clientY - drag.y) * 0.004)); drag.x = e.clientX; drag.y = e.clientY; });
const dragEnd = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
canvas.addEventListener('pointerup', dragEnd); canvas.addEventListener('pointercancel', dragEnd); canvas.addEventListener('lostpointercapture', dragEnd);
canvas.addEventListener('wheel', (e) => { S.dist = Math.min(14, Math.max(3, S.dist + e.deltaY * 0.004)); e.preventDefault(); }, { passive: false });
const js = $('joystick'), stick = $('stick'); let jid = null;
const jmove = (e) => { const r = js.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const m = Math.hypot(dx, dy), R = 50; if (m > R) { dx = dx / m * R; dy = dy / m * R; } stick.style.transform = `translate(${dx}px,${dy}px)`; joy.x = dx / R; joy.y = dy / R; };
js.addEventListener('pointerdown', (e) => { e.stopPropagation(); jid = e.pointerId; jmove(e); capture(js, jid); });
js.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
const jend = (e) => { if (e.pointerId === jid) { jid = null; joy.x = joy.y = 0; stick.style.transform = ''; } };
js.addEventListener('pointerup', jend); js.addEventListener('pointercancel', jend); js.addEventListener('lostpointercapture', jend);
// a finger the browser "forgot" (system gesture, app switch, notification) must never leave the stick held or the camera grabbed
function releaseInputs() { for (const k in keys) keys[k] = false; jid = null; joy.x = joy.y = 0; stick.style.transform = ''; drag = null; }
addEventListener('blur', releaseInputs); document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInputs(); });

// ---------- phones: no accidental page zoom (pinch between two thumbs, fast double taps), and undo it if it happens ----------
const zoomOk = (t) => !!t?.closest?.('.menu-scroll'); // the drink menu may be pinched
document.addEventListener('gesturestart', (e) => { if (!zoomOk(e.target)) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturechange', (e) => { if (!zoomOk(e.target)) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && !zoomOk(e.target)) e.preventDefault(); }, { passive: false });
let lastTouch = { t: 0, el: null };
document.addEventListener('touchend', (e) => { // a quick second tap on the same spot is a double-tap zoom on iOS
  const now = Date.now(), el = e.target;
  if (now - lastTouch.t < 350 && el === lastTouch.el && !el.closest?.('input,textarea,select,.menu-scroll')) e.preventDefault();
  lastTouch = { t: now, el };
}, { passive: false });
const vpMeta = document.querySelector('meta[name=viewport]'), coarse = matchMedia('(pointer: coarse)').matches;
function unzoom() {
  const vv = window.visualViewport; if (!coarse || !vv || isTyping()) return;
  if (vv.scale > 1.01 || Math.abs(vv.offsetLeft) > 1 || Math.abs(vv.offsetTop) > 1 || scrollX || scrollY) {
    const c = vpMeta.content; vpMeta.content = c.replace('maximum-scale=1,', 'maximum-scale=1.01,'); requestAnimationFrame(() => { vpMeta.content = c; scrollTo(0, 0); });
  }
}
window.visualViewport?.addEventListener('resize', unzoom); window.visualViewport?.addEventListener('scroll', unzoom); setInterval(unzoom, 1500);

// ---------- UI wiring ----------
function toast(t, ms = 3200) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), ms); }
let lastFocus = null;
const syncOverlay = () => { document.body.classList.toggle('overlay-open', overlayOpen()); for (const k in keys) keys[k] = false; joy.x = joy.y = 0; };
function openChat(v) {
  if (!chat) return; // not inside yet (still entering)
  if (v) lastFocus = document.activeElement; $('chat').hidden = !v; chat.setOpen(v); syncOverlay();
  if (v) setTimeout(() => $('chat-input').focus(), 50); else { lastFocus?.focus?.(); }
}
$('btn-chat').onclick = () => openChat(true);
$('chat-back').onclick = () => openChat(false);
$('online-count').onclick = () => { const s = $('sidebar'); const o = s.classList.toggle('open'); $('online-count').setAttribute('aria-expanded', o); };
let modalOpenedAt = 0;
function openModal(label) { modalOpenedAt = performance.now(); lastFocus = document.activeElement; $('modal-body').textContent = ''; const card = $('modal').querySelector('.modal-card'); card.setAttribute('aria-label', label); card.classList.remove('win95', 'jb-open'); $('modal').hidden = false; syncOverlay(); }
function closeModal() { if ($('modal').hidden) return; $('modal').hidden = true; $('modal-body').textContent = ''; syncOverlay(); lastFocus?.focus?.(); releasePreview(); releaseAvatar(); }
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else if (!$('chat').hidden) openChat(false); }
  if (e.key === 'Tab' && !$('modal').hidden) { // keep focus inside the dialog
    const f = [...$('modal').querySelectorAll('button,input,[tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return; const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
  }
});
$('modal').addEventListener('click', (e) => { if (e.target === e.currentTarget && performance.now() - modalOpenedAt > 500) closeModal(); });
$('modal-close').onclick = closeModal;
function showMenu() {
  openModal(L('酒单', 'Drinks'));
  const body = $('modal-body');
  const h = document.createElement('h3'); h.textContent = L('酒单', 'Drinks');
  const sc = document.createElement('div'); sc.className = 'menu-scroll'; sc.tabIndex = 0;
  const img = document.createElement('img'); img.src = boardsCanvas().toDataURL('image/png'); img.alt = L('吧台上方的 1–6 号酒牌', 'Drink boards 1–6 above the bar'); sc.appendChild(img);
  const p = document.createElement('p'); p.textContent = L('吧台上方的手绘酒牌，另有 7 号黑板：啤酒花气泡水（无酒精）。这是游戏里的酒单。手机上可左右拖动或双指放大。', 'The painted boards above the bar, plus blackboard no. 7: Hop Water (alcohol-free). This is the in-game menu. On a phone, drag sideways or pinch to zoom.');
  const b = document.createElement('button'); b.className = 'primary'; b.textContent = L('不知道喝啥？让团团帮你选', 'Can’t decide? Let Tuantuan pick for you'); b.onclick = showMood;
  body.append(h, sc, p, b); b.focus();
  if (orders.length) { // 最近点单 (newest first)
    const oh = document.createElement('div'); oh.className = 'mood-sub'; oh.textContent = L('最近点单', 'Recent orders');
    const ul = document.createElement('ul'); ul.className = 'order-list';
    for (const o of orders.slice().reverse()) {
      const li = document.createElement('li'); const tm = new Date(o.at);
      li.append(Object.assign(document.createElement('b'), { textContent: `#${o.no}` }), Object.assign(document.createElement('span'), { textContent: ` ${o.nick} · ${drinkEmoji(o)} ${drinkName(o)}` }), Object.assign(document.createElement('i'), { textContent: ` ${String(tm.getHours()).padStart(2, '0')}:${String(tm.getMinutes()).padStart(2, '0')}` }));
      ul.append(li);
    }
    body.append(oh, ul);
  }
}
$('btn-menu').onclick = showMenu;
function showWardrobe() {
  openModal(L('换装', 'Outfit'));
  const h = document.createElement('h3'); h.textContent = L('换装', 'Outfit'); const box = document.createElement('div');
  const p = document.createElement('p'); p.className = 'wd-note'; p.textContent = L('改完马上生效，院子里的人都能看到。拖动小人可以转圈看。', 'Changes apply right away and everyone in the yard sees them. Drag the figure to spin it.');
  $('modal-body').append(h, box, p);
  mountWardrobe(box, { getAvatar: () => me.avatar, outfit: { ...me.outfit }, onChange: setOutfit });
}
$('btn-wardrobe').onclick = showWardrobe;
function showMood() {
  openModal(L('团团的怪问题', 'Tuantuan’s odd questions'));
  openMood($('modal-body'), { onShowMenu: showMenu, onClose: closeModal, onShare: (t) => chat.sendText(t), onOrder: placeOrder });
}
function showJukebox() { jbui.open(); }

// ---------- actions ----------
let nearAction = null;
function currentAction() {
  if (S.riding) return { label: L('下车', 'Get off'), run: () => dismount('off') };
  if (S.mode === 'land' && !S.air && bike && bikeNear()) return { label: bikeFree() ? L('骑车 🚲', 'Ride 🚲') : L('🚲 有人在骑', '🚲 Someone’s riding'), run: mountBike };
  if (S.mode === 'sit' && dice && S.seat) { const g = dice.state; return { label: g && !g.over && g.group === S.seat.group ? L('🎲 骰子', '🎲 Dice') : L('🎲 开一局吹牛', '🎲 Play liar’s dice'), run: startDice }; }
  if (S.mode !== 'land') return null;
  if (board && Math.abs(pos.x - board.x) < 0.9 && pos.z > board.z0 - 1.4 && pos.z < board.z0 + 0.1) return { label: L('上跳板', 'Diving board'), run: startSpring };
  const dSw = Math.hypot(pos.x - DISCO_SWITCH.x, pos.z - DISCO_SWITCH.z);
  if (disco && dSw < 1.3 && dSw < pos.distanceTo(SPOTS.jukebox)) { const n = LIGHT[nextLight()]; return { label: `${L('灯光', 'Lights')} → ${n.name} ${n.icon}`, run: cycleLights }; }
  if (pos.z > JUMP_EDGE_Z && pos.z <= BOUNDS.zLand + 0.05 && !onStairs()) return { label: L('跳海', 'Jump in the sea'), run: () => startJump(false) };
  // the jukebox stands between bar stools and 团团 roams nearby: offer whichever is closest
  const catPos = npcs.position('cat_tuantuan'), crocPos = npcs.position('croc_edazi'), seat = nearestSeat();
  const opts = [];
  const dj = Math.hypot(pos.x - SPOTS.jukebox.x, pos.z - SPOTS.jukebox.z); if (dj < 1.9) opts.push([dj, { label: L('点唱机', 'Jukebox'), run: showJukebox }]);
  if (catPos) { const dc = Math.hypot(pos.x - catPos.x, pos.z - catPos.z); if (dc < 2.2) opts.push([dc + 0.3, { label: L('问问团团', 'Ask Tuantuan'), run: showMood }]); }
  if (seat) opts.push([Math.hypot(pos.x - seat.x, pos.z - seat.z) - 0.25, { label: L('坐下', 'Sit down'), run: () => sitOn(seat) }]);
  if (opts.length) return opts.sort((a, b) => a[0] - b[0])[0][1];
  if ((crocPos && pos.distanceTo(crocPos) < 2.4) || (pos.z < -2.6 && pos.x > -1.8)) return { label: L('看酒单', 'See the drinks'), run: showMenu };
  return null;
}
function doAction() { if (nearAction) nearAction.run(); }
tapButton($('action-btn'), doAction);
tapButton($('return-btn'), startSwimHome);

// jump → surface → swim → climb → land
function tween(dur, fn, done, act) { S.tw = { t: 0, dur, fn, done, act }; }
const ease = (t) => t * t * (3 - 2 * t);
const SWIM_DEPTH = DEPTH_IDLE; // root depth below the surface when treading water (swimPose refines it while moving)
const _hip = new THREE.Vector3();
const _tv = new THREE.Vector3();
const SIT_DROP = 0.42; // the sit clip lowers the hips this far below the root; the root goes below the seat by this much

function emote(name) {
  if (S.mode !== 'land' || !player || S.riding) return;
  if (name === 'dance' && S.emote?.name === 'dance') { S.emote = null; return; } // tap 蹦迪 again to stop
  S.emote = { name, t: name === 'dance' ? Infinity : 2.6 }; /* the dance goes on (walking slowly is fine) until you tap 蹦迪 again, jump or dash */ if (name === 'cheer') world.plants?.leafBurst?.(pos.x, 1.8, pos.z, 16); }
document.querySelectorAll('[data-emote]').forEach((b) => tapButton(b, () => emote(b.dataset.emote)));
function sitOn(seat) {
  S.mode = 'sit'; S.seat = seat; S.emote = null;
  pos.set(seat.x, Math.max(0, seat.y - SIT_DROP), seat.z); S.ry = seat.ry;
}
// a seat is taken while another guest reports sitting on it
function seatTaken(seat) { for (const r of remotes.values()) if (r.st === 'sit' && r.seat === seat.id) return true; return false; }
function nearestSeat() {
  let best = null, bd = 1.05;
  for (const s of world.seats || []) { const d = Math.hypot(s.x - pos.x, s.z - pos.z); if (d < bd && !seatTaken(s)) { bd = d; best = s; } }
  return best;
}
function standUp(msg) {
  if (S.mode !== 'sit' || !S.seat) return;
  const s = S.seat; S.mode = 'land'; S.seat = null; if (dice?.inGame()) dice.close();
  pos.set(s.x + Math.sin(s.ry + Math.PI) * 0.75, 0, s.z + Math.cos(s.ry + Math.PI) * 0.75); landSafe(pos, s.x, s.z);
  if (msg) toast(msg);
}
function onStairs() { return pos.x > STAIRS.x0 - 0.35 && pos.x < STAIRS.x1 + 0.35; }
const _wallN = new THREE.Vector3();
// the stone stairs and their handrails are solid (the lagoon bed under them isn't): swim round them, climb them from the front
const onStairBlock = (x, z) => x > STAIRS.x0 - 0.7 && x < STAIRS.x1 + 0.7 && z > DECK.z1 && z < STAIRS.z1 + 0.55; // margins: a swimmer lies flat, nose ~0.4 m ahead
const nearStairPost = (x, z) => Math.hypot(x - (STAIRS.x0 - 0.1), z - (STAIRS.z1 + 0.2)) < 0.65 || Math.hypot(x - (STAIRS.x1 + 0.1), z - (STAIRS.z1 + 0.2)) < 0.65; // the handrails' front posts
const swimmable = (x, z) => insideSea(x, z, 0.45) && bedAt(x, z) < WATER_Y - 0.3 && !onStairBlock(x, z) && !nearStairPost(x, z);
// walk (or get shoved) off the edge: a little hop into the water in the direction we were going
function wadeIn(px, pz, vx, vz) {
  const sp = Math.hypot(vx, vz) || 1, dx = vx / sp, dz = vz / sp;
  if (px > STAIRS.x0 + 0.15 && px < STAIRS.x1 - 0.15 && dz > 0.3 && pz < STAIRS.z0 + 0.3) return walkDownStairs(px);
  let tx = px + dx * 1.6, tz = pz + dz * 1.6;
  for (let k = 0; k < 10 && !swimmable(tx, tz); k++) { tx += dx * 0.5; tz += dz * 0.5; }
  if (!swimmable(tx, tz)) { const q = nearest(px, Math.max(pz, DECK.z1) + 1.2, swimmable, 3); [tx, tz] = q || [px, Math.max(pz, DECK.z1) + 1.2]; } // fallback: the nearest open water off the deck
  S.mode = 'jumping'; S.vel.set(0, 0, 0); S.kick.multiplyScalar(0.2); const a = new THREE.Vector3(px, pos.y, pz), b = new THREE.Vector3(tx, WATER_Y - 0.45, tz);
  S.ry = Math.atan2(dx, dz); const fromDeck = pz <= BOUNDS.zLand + 0.2;
  tween(fromDeck ? 0.55 : 0.45, (k) => { pos.lerpVectors(a, b, k); pos.y = THREE.MathUtils.lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * (fromDeck ? 0.6 : 0.3); }, () => { splash(pos); plop(); fx.pop(L('扑通！', 'SPLASH!'), pos, '#7fe3ff'); announceDunk(); startSurface(); });
}
// stepping off the deck at the top of the stairs: walk down them into the water (instead of leaping over them)
function walkDownStairs(px) {
  const st = LAYOUT.stairs, sx = THREE.MathUtils.clamp(px, STAIRS.x0 + 0.6, STAIRS.x1 - 0.6), a = pos.clone(), zEnd = STAIRS.z1 + 0.9, low = WATER_Y - SWIM_DEPTH;
  const yAt = (z) => (z < STAIRS.z0 ? 0 : Math.max(low, Math.min(0, st.topY - st.drop * Math.max(0, (z - STAIRS.z0) / st.depth - 0.5)))); // feet on the steps
  S.mode = 'climbing'; S.vel.set(0, 0, 0); S.kick.set(0, 0, 0); S.ry = 0; S.emote = null;
  tween(1.4, (k) => { pos.x = THREE.MathUtils.lerp(a.x, sx, Math.min(1, k * 3)); pos.z = THREE.MathUtils.lerp(a.z, zEnd, k); pos.y = yAt(pos.z); }, () => { splash(pos); startSurface(); }, 'walk');
}
// where to stand after climbing out of the water toward (dx, dz)
// Push out of furniture / NPC / bike colliders — but never through a wall. resolveLand only shoves radially, so someone wedged
// between the parked bike (or a pot, or a walking NPC) and a wall used to be pushed into the wall, and the wall slide then kept
// them there. A shove that ends off the walkable ground is undone; anyone already stuck is pulled back to the nearest floor.
function landSafe(p, prevX, prevZ, clampYard) {
  const n = resolveLand(p, clampYard);
  // a pot / the bike right against a wall: clamp back inside and push out again, a few times — that slides you round it
  if (!walkable(p.x, p.z) && prevZ <= BOUNDS.zLand + 0.05) { // a pot / the parked bike right against a wall shoved us into it:
    const x0 = BOUNDS.x0, x1 = BOUNDS.x1, z0 = BOUNDS.zNorth + 0.4, z1 = BOUNDS.zLand, cl = () => { p.x = THREE.MathUtils.clamp(p.x, x0, x1); p.z = THREE.MathUtils.clamp(p.z, z0, z1); };
    cl();
    for (const c of COLLIDERS.circles) { // …slide along the wall to where it meets the collider's edge, on the side we're already on
      const m = c.r + 0.3, dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz >= m * m) continue;
      if (p.x <= x0 + 1e-6 || p.x >= x1 - 1e-6) p.z = c.z + (dz >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, m * m - dx * dx));
      else if (p.z <= z0 + 1e-6 || p.z >= z1 - 1e-6) p.x = c.x + (dx >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, m * m - dz * dz));
    }
    cl();
  }
  if (!walkable(p.x, p.z)) { if (walkable(prevX, prevZ)) { p.x = prevX; p.z = prevZ; } else unstick(p); }
  return n;
}
// the closest spot (ring search, up to rMax) that passes test(x, z), or null
function nearest(x0, z0, test, rMax = 4) {
  if (test(x0, z0)) return [x0, z0];
  for (let r = 0.1; r <= rMax; r += 0.1) for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r; if (test(x, z)) return [x, z]; }
  return null;
}
const dryLand = (x, z) => walkable(x, z) && !insideSea(x, z, 0);
function unstick(p) { const q = nearest(p.x, p.z, dryLand); if (q) { p.x = q[0]; p.z = q[1]; } return !!q; }
function findLanding(x, z, dx, dz) {
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  for (let d = 0.6; d <= 2.2; d += 0.2) { const lx = x + dx * d, lz = z + dz * d; if (dryLand(lx, lz)) return dryLand(lx + dx * 0.3, lz + dz * 0.3) ? new THREE.Vector3(lx + dx * 0.3, 0, lz + dz * 0.3) : new THREE.Vector3(lx, 0, lz); } // a step further in, unless that's off the strip
  return null;
}
function startJump(fromKnock) {
  S.mode = 'jumping'; S.vel.set(0, 0, 0); const a = pos.clone();
  const b = new THREE.Vector3(THREE.MathUtils.clamp(a.x + S.kick.x * 0.2, DECK.x0 + 0.6, DECK.x1 - 0.6), WATER_Y - 0.5, DECK.z1 + (fromKnock ? 1.3 : 5.2));
  if (onStairBlock(b.x, b.z)) b.x = b.x < (STAIRS.x0 + STAIRS.x1) / 2 ? STAIRS.x0 - 0.7 : STAIRS.x1 + 0.7; // knocked off by the stairs: splash down beside them
  S.kick.set(0, 0, 0); if (!fromKnock) S.ry = Math.atan2(b.x - a.x, b.z - a.z);
  if (fromKnock) announceDunk();
  const big = !fromKnock, T = big ? 1.35 : 0.6, apex = big ? 3.4 : 0.7;
  if (big) { S.flip = true; player.root.rotation.order = 'YXZ'; S.squash = 0.5; boing(1.2); }
  tween(T, (k) => {
    pos.lerpVectors(a, b, k); pos.y = THREE.MathUtils.lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * apex;
    if (big) player.root.rotation.x = -Math.PI * 2 * THREE.MathUtils.smoothstep(k, 0.12, 0.82); // a full front flip in the air
  }, () => {
    player.root.rotation.x = 0; S.flip = false;
    if (big) { // cannonball: crown splash + a ring of extra bursts, big shake
      world.pool.splash?.(pos.x, pos.z, 2.2);
      for (let i = 0; i < 5; i++) { const ang = i * 1.256, r = 0.9 + Math.random() * 0.5; world.pool.splash?.(pos.x + Math.cos(ang) * r, pos.z + Math.sin(ang) * r, 0.9); }
      S.camShake = 0.45; buzz([30, 30, 60]); fx.pop(L('扑通！！', 'SPLASH!!'), pos, '#7fe3ff', 1.7); world.plants?.leafBurst?.(pos.x, 1.2, pos.z, 12);
    } else { splash(pos); fx.pop(L('扑通！', 'SPLASH!'), pos, '#7fe3ff'); }
    plop(); startSurface();
  });
}
// ---------- 吹牛骰子 (seated guests of one table play together; alone, 团团 and 鳄搭子 sit in) ----------
function tableMates(group) {
  const out = [];
  if (S.mode === 'sit' && S.seat?.group === group) out.push({ id: me.id, nick: me.nick, seat: S.seat.id, av: me.avatar });
  for (const [id, r] of remotes) if (r.st === 'sit' && world.seats[r.seat]?.group === group) out.push({ id, nick: r.nick, seat: r.seat, av: r.avatar });
  return out.sort((a, b) => a.seat - b.seat);
}
function startDice() {
  if (S.mode !== 'sit' || !S.seat || !dice) return toast(L('先找个位子坐下', 'Find a seat first'));
  const g = dice.state;
  if (g && !g.over && g.group === S.seat.group) return diceUI.render(g); // a game is on at this table: just show it
  diceUI.chooseMode((mode) => { // 线下玩 / 广东骰
    if (S.mode !== 'sit' || !S.seat) return;
    const mates = tableMates(S.seat.group).length;
    if (!dice.start(S.seat.group, mode)) return;
    if (mode === 'offline') toast(mates > 1 ? L(`线下玩：同桌 ${mates} 人的骰盅都摇好了`, `Table play: dice cups shaken for all ${mates} at the table`) : L('线下玩：骰盅摇好了，叫上旁边的人一起', 'Table play: your cup is shaken, call over whoever’s next to you'), 2600);
    else toast(mates > 1 ? L(`广东骰开局！同桌 ${mates} 人都入局了`, `Liar’s dice is on! All ${mates} at the table are in`) : L('一个人？团团和鳄搭子来陪你摇', 'On your own? Tuantuan and the croc will play with you'), 2600);
  });
}
function diceEvent(ev, s) {
  const who = ev.id; let at;
  if (who === me.id) at = (v) => v.set(pos.x, pos.y + 1.55, pos.z);
  else if (BOTS[who]) { const p = npcs?.position(BOTS[who].npc); if (!p) return; at = (v) => v.set(p.x, p.y + 1.7, p.z); }
  else { const r = remotes.get(who); if (!r) return; at = (v) => v.set(r.obj.position.x, r.obj.position.y + 1.55, r.obj.position.z); }
  const nick = s.players.find((p) => p.id === who)?.nick || s.tally[who]?.nick;
  const hot = ev.type === 'pi' || ev.type === 'fanpi' || ev.type === 'result';
  speech?.say('dice:' + who, at, ev.type === 'round' ? '🎲 ' + ev.text : ev.text, { ms: ev.type === 'result' ? 3600 : 2600, tone: hot ? 'dicehot' : 'dice', name: nick });
  const close = s.players.some((p) => p.id === me.id) || pos.distanceTo(at(new THREE.Vector3())) < 7;
  if (close) { if (ev.type === 'pi' || ev.type === 'fanpi') { boing(ev.type === 'fanpi' ? 1.6 : 1.1); S.camShake = 0.12; } else if (ev.type === 'result') plop(); }
}

// ---------- 点单: "就它了" posts an order the whole room sees — a ticket pops up for everyone and the bar's rail keeps the latest ----------
let orders = []; const ordersSeen = new Set();
const cleanOrder = (o) => o && typeof o.k === 'string' && typeof o.name === 'string' ? { k: o.k.slice(0, 64), no: Math.max(1, +o.no | 0), id: String(o.id || '').slice(0, 40), nick: String(o.nick || L('有人', 'Someone')).slice(0, 16), name: o.name.slice(0, 24), dn: Number.isInteger(o.dn) ? o.dn : null, emoji: String(o.emoji || '🍺').slice(0, 4), board: Number.isInteger(o.board) ? o.board : null, at: +o.at || 0 } : null;
// orders carry the drink's menu number (dn) so each guest reads the name in their own language; name is the fallback
const menuItem = (o) => (o.dn != null ? MENU.items.find((i) => i.n === o.dn) : null);
const drinkName = (o) => menuItem(o)?.[isEn ? 'name_en' : 'name'] || o.name;
const drinkEmoji = (o) => menuItem(o)?.[isEn ? 'emoji_en' : 'emoji'] || o.emoji;
function placeOrder(d) {
  const at = Date.now(), no = orders.reduce((m, o) => Math.max(m, o.no), 0) + 1;
  const o = { k: me.id + ':' + at.toString(36), no, id: me.id, nick: me.nick, name: d.name, dn: d.n ?? null, emoji: d.emoji, board: d.wallBoard || null, at };
  const list = [...orders, o].slice(-12);
  const ok = net?.setState?.('orders', { v: 1, list });
  receiveOrders({ v: 1, list });
  if (!ok && net?.kind !== 'local') toast(L('没连上网：点单只在你这儿', 'Not connected: the order only shows on your screen'), 2600);
}
function receiveOrders(obj) {
  if (!obj || obj.v !== 1 || !Array.isArray(obj.list)) return;
  const byK = new Map(orders.map((o) => [o.k, o])); // merge: an order placed at the same moment elsewhere is not lost
  for (const raw of obj.list.slice(-24)) { const o = cleanOrder(raw); if (o) byK.set(o.k, o); }
  orders = [...byK.values()].sort((a, b) => a.at - b.at).slice(-12);
  for (const o of orders) if (!ordersSeen.has(o.k)) { ordersSeen.add(o.k); if (Date.now() - o.at < 20000) orderTicket(o); }
  world?.orderRail?.show(orders.slice(-6).map((o) => ({ ...o, name: drinkName(o), emoji: drinkEmoji(o) })));
}
function orderTicket(o) {
  const box = $('order-tickets'); if (!box) return;
  const el = document.createElement('div'); el.className = 'order-ticket'; el.setAttribute('role', 'status');
  const mine = o.id === me.id;
  el.innerHTML = '<div class="ot-head"><span></span><b></b></div><div class="ot-who"></div><div class="ot-drink"></div><div class="ot-where"></div>';
  el.querySelector('.ot-head span').textContent = L('🧾 新点单', '🧾 New order'); el.querySelector('.ot-head b').textContent = '#' + o.no;
  el.querySelector('.ot-who').textContent = mine ? L('你点了', 'You ordered') : L(`${o.nick} 点了`, `${o.nick} ordered`);
  el.querySelector('.ot-drink').textContent = `${drinkEmoji(o)} ${drinkName(o)}`;
  el.querySelector('.ot-where').textContent = o.board ? L(`墙上 ${o.board} 号牌`, `board no. ${o.board} on the wall`) : L('问问店员', 'ask the staff');
  box.prepend(el); while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 7000); setTimeout(() => el.remove(), 7600);
  try { const a = new (window.AudioContext || window.webkitAudioContext)(), t0 = a.currentTime; for (const [f, dt] of [[1318, 0], [1760, 0.12]]) { const osc = a.createOscillator(), g = a.createGain(); osc.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.18, t0 + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5); osc.connect(g).connect(a.destination); osc.start(t0 + dt); osc.stop(t0 + dt + 0.55); } setTimeout(() => a.close(), 900); } catch {} // 叮～
  if (!mine) npcs?.say('croc_edazi', L(`收到！${o.nick} 的 ${drinkName(o)}`, `Got it! ${drinkName(o)} for ${o.nick}`), 2600);
}

// ---------- 🚲 the yard's bicycle: ride it, ram people with it, get rammed off it (抢车) ----------
let bikeState = { v: 1, rider: null, nick: '', x: BIKE_HOME.x, z: BIKE_HOME.z, ry: BIKE_HOME.ry, at: 0, secs: {} };
let bikeFallT = 0, bikeBeat = 0, rideStart = 0, bikePill = null;
const _sd = new THREE.Vector3(), _hp = new THREE.Vector3(), _iq = new THREE.Quaternion();
const riderHere = () => bikeState.rider && (bikeState.rider === me.id ? S.riding : remotes.has(bikeState.rider));
const bikeFree = () => !riderHere();
const parkedAt = () => (!bikeState.rider && bikeState.at && Date.now() - bikeState.at > 120000 ? BIKE_HOME : bikeState); // left lying around for 2 min → back home
function bikeNear() { const p = parkedAt(); return !riderHere() ? Math.hypot(pos.x - p.x, pos.z - p.z) < 1.5 : remotes.has(bikeState.rider) && remotes.get(bikeState.rider).obj.position.distanceTo(pos) < 1.5; }
function publishBike(patch) {
  bikeState = { ...bikeState, ...patch, v: 1, at: Math.max(Date.now(), bikeState.at + 1) };
  net?.setState?.('bike', bikeState);
}
function creditRide() { // 抢车王: total seconds on the bike
  if (!rideStart) return; const s = (Date.now() - rideStart) / 1000; rideStart = 0;
  const secs = { ...bikeState.secs }; const cur = secs[me.id]?.s || 0; secs[me.id] = { nick: me.nick, s: Math.round(cur + s) };
  bikeState.secs = Object.fromEntries(Object.entries(secs).sort((a, b) => b[1].s - a[1].s).slice(0, 8));
}
function mountBike() {
  if (!bikeFree()) return toast(L(`${bikeState.nick || '有人'} 正骑着呢 —— 冲撞他抢车！`, `${bikeState.nick || 'Someone'} is riding it — ram them to steal the bike!`), 2400);
  const p = parkedAt(); S.riding = true; S.emote = null; rideStart = Date.now(); bikeFallT = 0;
  pos.set(p.x, groundAt(p.x, p.z), p.z); S.ry = p.ry; S.vel.set(0, 0, 0); S.kick.set(0, 0, 0);
  publishBike({ rider: me.id, nick: me.nick, x: p.x, z: p.z, ry: p.ry, since: Date.now() });
  toast(L('上车！撞人更狠；被人冲撞会摔下来。别骑进海里～', 'On the bike! You hit harder, but get rammed and you fall off. Don’t ride into the sea~'), 2800); boing(0.6);
}
function dismount(kind, at = pos) {
  if (!S.riding) return; S.riding = false; creditRide();
  const x = kind === 'sea' ? BIKE_HOME.x : at.x, z = kind === 'sea' ? BIKE_HOME.z : at.z, ry = kind === 'sea' ? BIKE_HOME.ry : S.ry;
  if (kind === 'off') { const ox = pos.x, oz = pos.z; pos.x -= Math.cos(S.ry) * 0.6; pos.z += Math.sin(S.ry) * 0.6; landSafe(pos, ox, oz, false); } // step off to the side
  publishBike({ rider: null, nick: '', x, z, ry, fell: kind === 'crash' ? Date.now() : 0 });
}
function crashBike(nx, nz, from) {
  if (!S.riding) return; const by = from && remotes.get(from)?.nick;
  dismount('crash'); bikeFallT = 1.6; S.kick.x += nx * 5; S.kick.z += nz * 5; S.vy = 4.5; S.air = true;
  fx.pop(L('摔车！', 'WIPEOUT!'), pos, '#ff6b3d', 1.3); S.camShake = 0.3; buzz([30, 30, 60]);
  if (by) { net?.send({ t: 'bikesteal', id: me.id, by: from, victim: me.nick }); toast(L(`${by} 把你撞下了车！快抢回来`, `${by} knocked you off the bike! Get it back`), 2600); }
}
function rideIntoSea() { dismount('sea'); bike?.poof(BIKE_HOME.x, BIKE_HOME.z); toast(L('连人带车冲进了海里…自行车自己回家了 🚲', 'You rode straight into the sea… the bike went home by itself 🚲'), 2600); }
function receiveBike(obj) {
  if (!obj || obj.v !== 1 || (+obj.at || 0) <= bikeState.at) return;
  const prev = bikeState;
  bikeState = { v: 1, rider: typeof obj.rider === 'string' ? obj.rider.slice(0, 40) : null, nick: String(obj.nick || '').slice(0, 16), x: +obj.x || BIKE_HOME.x, z: +obj.z || BIKE_HOME.z, ry: +obj.ry || 0, at: +obj.at, since: +obj.since || +obj.at, fell: +obj.fell || 0, secs: obj.secs && typeof obj.secs === 'object' ? obj.secs : {} };
  if (S.riding && bikeState.rider !== me.id) { S.riding = false; creditRide(); toast(L(`${bikeState.nick || '有人'} 抢先一步骑走了自行车`, `${bikeState.nick || 'Someone'} grabbed the bike first`), 2400); }
  const fresh = Date.now() - bikeState.at < 8000;
  if (fresh && bikeState.rider && bikeState.rider !== me.id && bikeState.rider !== prev.rider) toast(L(`🚲 ${bikeState.nick} 骑上了自行车 —— 撞他下来抢车！`, `🚲 ${bikeState.nick} hopped on the bike — ram them off and take it!`), 2600);
  if (fresh && !bikeState.rider && prev.rider && prev.rider !== me.id) {
    if (Math.hypot(bikeState.x - BIKE_HOME.x, bikeState.z - BIKE_HOME.z) < 0.1 && !bikeState.fell) bike?.poof(BIKE_HOME.x, BIKE_HOME.z);
    if (bikeState.fell) bikeFallT = 1.6;
  }
}
function seatOnBike(ch) { // hips onto the saddle (works through the tilt group, so remotes' smoothing is untouched)
  if (!ch.hip || !ch.tilt) return;
  bike.saddleWorld(_sd); ch.root.updateMatrixWorld(true); ch.hip.getWorldPosition(_hp);
  _sd.sub(_hp).applyQuaternion(ch.root.getWorldQuaternion(_iq).invert()).divideScalar(ch.root.scale.y || 1);
  ch.tilt.position.add(_sd);
}
function unseat(ch) { if (ch.tilt) { ch.tilt.position.x = 0; ch.tilt.position.z = 0.1; } }
function updateBike(dt) {
  if (!bike) return;
  const remoteRider = !S.riding && bikeState.rider && remotes.get(bikeState.rider);
  if (S.riding) {
    const sp = Math.hypot(S.vel.x, S.vel.z); bike.place(pos.x, pos.y, pos.z, S.ry, THREE.MathUtils.clamp(-(S.turn || 0) * sp * 0.035, -0.35, 0.35)); bike.roll(sp * dt);
    seatOnBike(player); S.wasOnBike = true;
    bikeBeat -= dt; if (bikeBeat <= 0) { bikeBeat = 3; publishBike({ x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), ry: +S.ry.toFixed(2) }); } // keep the parked spot current in case we drop out
  } else {
    if (S.wasOnBike) { unseat(player); S.wasOnBike = false; }
    if (remoteRider && remoteRider.bk) { const o = remoteRider.obj; bike.place(o.position.x, o.position.y, o.position.z, o.rotation.y, 0); bike.roll((remoteRider.spd || 0) * dt); }
    else { const p = parkedAt(); bike.place(p.x, groundAt(p.x, p.z), p.z, p.ry); }
  }
  bikeFallT = Math.max(0, bikeFallT - dt); bike.fall(bikeFallT > 0 && !S.riding && !remoteRider); bike.update(dt);
  const ridden = S.riding || (remoteRider && remoteRider.bk);
  if (ridden) bikeCol.r = -1; else { const p = parkedAt(); bikeCol.x = p.x; bikeCol.z = p.z; bikeCol.r = 0.35; }
  // the 抢车 pill
  bikePill = bikePill || $('bike-pill');
  if (bikePill) {
    const who = S.riding ? L('你', 'You') : remoteRider && remoteRider.bk ? bikeState.nick : null;
    bikePill.hidden = !who;
    if (who) { const s = Math.max(0, Math.floor((Date.now() - (S.riding ? rideStart : bikeState.since || bikeState.at)) / 1000)); const top = Object.values(bikeState.secs || {})[0]; bikePill.textContent = L(`🚲 ${who} 骑车中 ${s}s${top ? ` · 抢车王 ${top.nick} ${top.s}s` : ''}`, `🚲 ${who} riding ${s}s${top ? ` · bike king ${top.nick} ${top.s}s` : ''}`); }
  }
}

// ---------- 灯光总闸: 常亮 → 蹦迪 → 万圣 → 熄灯 ----------
const LIGHT = {
  normal: { name: L('常亮', 'Lights on'), icon: '💡', pop: L('开灯！', 'LIGHTS ON!'), col: '#ffe9a8', lines: isEn ? ['Lights are back, keep drinking', 'Back to the real world~', 'What just happened?'] : ['灯亮了，继续喝', '回到人间～', '刚才发生了什么？'] },
  disco: { name: L('蹦迪', 'Disco'), icon: '🪩', pop: L('蹦迪模式！', 'DISCO MODE!'), col: '#ff4fa8', lines: isEn ? ['Jump around!! 🪩', 'When these lights come on I can’t control myself', 'Waves on the sea! Let’s go surfing 🏄', 'DJ, turn it up!'] : ['蹦起来！！🪩', '这灯一开我就控制不住我自己', '海上起浪了！冲浪去 🏄', 'DJ，大声点！'] },
  halloween: { name: L('万圣', 'Halloween'), icon: '🎃', pop: L('万圣夜！', 'HALLOWEEN!'), col: '#ff8a1a', lines: isEn ? ['Are those skeletons on the wall dancing?!', 'The pumpkins lit up… kinda creepy', 'Trick or treat! 🍬', 'Who just tapped my shoulder… 👻'] : ['墙头上那排骷髅在跳舞？！', '南瓜灯亮了…有点瘆人', '不给糖就捣蛋！🍬', '谁在后面拍我肩膀…👻'] },
  dark: { name: L('熄灯', 'Lights out'), icon: '🌙', pop: L('熄灯', 'LIGHTS OUT'), col: '#9fb4ff', lines: isEn ? ['Who turned off the lights?!', 'Pitch dark, perfect for the moon 🌙', 'Shhh—', 'I can’t see a thing'] : ['谁关的灯？！', '黑灯瞎火，正好看月亮 🌙', '嘘——', '我啥也看不见了'] },
};
const nextLight = () => LIGHT_MODES[(LIGHT_MODES.indexOf(disco?.mode || 'normal') + 1) % LIGHT_MODES.length];
let discoStamp = 0; // time of the newest switch state we know; older messages (incl. our own echoes) are ignored
function cycleLights() {
  const mode = nextLight(); disco.set(mode); discoStamp = Date.now();
  const ok = net?.setState?.('disco', { v: 2, mode, on: mode === 'disco', by: me.id, byNick: me.nick, at: discoStamp });
  if (!ok && net?.kind !== 'local') toast(L('没连上网：只有你这儿的灯变了', 'Not connected: the lights only changed on your screen'));
  S.camShake = 0.3; buzz(mode === 'disco' ? [20, 40, 80] : 20);
  const lm = LIGHT[mode]; fx.pop(lm.pop, pos, lm.col, mode === 'dark' ? 1 : 1.6);
  if (mode === 'disco' && S.emote?.name !== 'dance') emote('dance');
  lightChatter(mode);
}
function lightChatter(mode) { const lines = LIGHT[mode].lines; npcs?.say('cat_tuantuan', pick(lines)); setTimeout(() => npcs?.say('croc_edazi', pick(lines)), 900); }
function receiveDisco(obj) {
  if (!obj || (+obj.at || 0) <= discoStamp) return;
  const mode = obj.v === 2 ? obj.mode : obj.v === 1 ? (obj.on ? 'disco' : 'normal') : null; // v1: the old two-way 蹦迪 switch
  if (!LIGHT_MODES.includes(mode)) return;
  discoStamp = +obj.at || 0;
  if (Date.now() - discoStamp >= 8000) { disco.set(mode, { instant: true }); return; } // joining a room that's already in that mode
  if (mode === disco.mode) return;
  disco.set(mode);
  if (obj.by !== me.id) { toast(L(`${obj.byNick || '有人'} 把灯光转到了「${LIGHT[mode].name}」${LIGHT[mode].icon}`, `${obj.byNick || 'Someone'} switched the lights to “${LIGHT[mode].name}” ${LIGHT[mode].icon}`), 2800); lightChatter(mode); }
}

// ---------- 冲浪: while 蹦迪 is on the lagoon swells; swimmers stand up on a board and ride them ----------
function makeSurfboard() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#fff6e6'; g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#ff4f7a'; g.fillRect(52, 0, 24, 512); g.fillStyle = '#23b6c4'; g.fillRect(44, 0, 6, 512); g.fillRect(78, 0, 6, 512);
  g.save(); g.translate(64, 300); g.rotate(-Math.PI / 2); g.fillStyle = '#123a52'; g.font = isEn ? '900 46px system-ui,sans-serif' : '900 54px "PingFang SC","Noto Sans SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(L('动物酒馆', 'ANIMAL BAR'), 0, 0); g.restore();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sh = new THREE.Shape(), len = 1.25, Wd = 0.21; // outline in (x, z): pointed nose at +z, squash tail
  sh.moveTo(0, len * 0.55); sh.bezierCurveTo(Wd * 0.9, len * 0.4, Wd, -len * 0.15, Wd * 0.62, -len * 0.45); sh.lineTo(-Wd * 0.62, -len * 0.45); sh.bezierCurveTo(-Wd, -len * 0.15, -Wd * 0.9, len * 0.4, 0, len * 0.55);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 16 });
  geo.rotateX(Math.PI / 2); geo.translate(0, -0.012, 0); // lying flat, top face at y = 0 under the feet
  const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - (p.getX(i) + Wd) / (2 * Wd), (p.getZ(i) + len * 0.45) / len); // seen from above: +x is on the left
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35 })); m.castShadow = true; m.visible = false; return m;
}
const _sg = new THREE.Vector2(), _sg2 = new THREE.Vector2(), _aim = new THREE.Vector3();
function waveSlope(x, z, out = _sg) { const h = world.pool.surfaceHeight, e = 0.3; return out.set((h(x + e, z, S.t) - h(x - e, z, S.t)) / (2 * e), (h(x, z + e, S.t) - h(x, z - e, S.t)) / (2 * e)); }
function tiltOnWave(obj, ry, slope, k) { // pitch / roll the rider + board with the water under them
  const f = slope.x * Math.sin(ry) + slope.y * Math.cos(ry), sd = slope.x * Math.cos(ry) - slope.y * Math.sin(ry);
  obj.rotation.order = 'YXZ'; obj.rotation.x += (-Math.atan(f) * 0.9 - obj.rotation.x) * k; obj.rotation.z += (Math.atan(sd) * 0.9 - obj.rotation.z) * k;
}

// ---------- 跳水板: hop on, two warm-up bounces, then a monster launch ----------
const RATINGS = isEn ? ['Judges: 10!', 'Rip entry!', '9.8!', 'MEGA SPLASH!', 'Difficulty 3.5!', 'Is that even humanly possible?'] : ['裁判：10 分！', '水花压得漂亮！', '9.8 分！', '惊天大水花！', '难度系数 3.5！', '这是人能跳的？'];
function startSpring() {
  S.mode = 'jumping'; S.vel.set(0, 0, 0); S.kick.set(0, 0, 0); S.emote = null; S.ry = 0;
  const a = pos.clone(), sz = board.standZ, p1 = new THREE.Vector3(board.x, board.topAt(sz), sz);
  tween(0.6, (k) => { pos.lerpVectors(a, p1, k); pos.y = THREE.MathUtils.lerp(a.y, board.topAt(pos.z), k) + Math.sin(k * Math.PI) * 0.55; }, () => springBounce(0), 'hop');
}
function springBounce(n) {
  const deep = [0.22, 0.32, 0.5][n], sz = board.standZ;
  // crouch with the board…
  tween(n === 2 ? 0.26 : 0.17, (k) => { board.setLoad(deep * Math.sin(k * Math.PI / 2)); pos.y = board.topAt(sz); }, () => {
    board.setLoad(0); board.kick(n === 2 ? -9 : -4 - n * 2); net?.send({ t: 'board', id: me.id, a: n === 2 ? -9 : -4 - n * 2 });
    boing(0.7 + n * 0.45); S.squash = 0.8;
    if (n < 2) { // …and spring up, a little higher each time
      const h = [0.75, 1.5][n], y0 = board.topAt(sz);
      tween(0.42 + n * 0.12, (k) => { pos.y = y0 + Math.sin(k * Math.PI) * h; }, () => springBounce(n + 1), 'hop');
    } else springLaunch();
  }, 'idle');
}
function springLaunch() {
  const a = pos.clone(), b = new THREE.Vector3(board.x + (Math.random() - 0.5) * 1.6, WATER_Y - 0.5, 12.6), T = 1.8, apex = 5.8;
  S.flip = true; player.root.rotation.order = 'YXZ'; S.camShake = 0.35; buzz([20, 20, 40]);
  fx.pop(L('起飞！！', 'LIFTOFF!!'), pos, '#ffd23f', 1.6);
  tween(T, (k) => {
    pos.lerpVectors(a, b, k); pos.y = THREE.MathUtils.lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * apex;
    player.root.rotation.x = -Math.PI * 4 * THREE.MathUtils.smoothstep(k, 0.08, 0.86); // a double front flip…
    S.ry = Math.PI * 2 * THREE.MathUtils.smoothstep(k, 0.2, 0.8);                       // …with a full twist
  }, () => {
    player.root.rotation.x = 0; S.flip = false; S.ry = 0;
    world.pool.splash?.(pos.x, pos.z, 2.8);
    for (let i = 0; i < 7; i++) { const ang = i * 0.9, r = 1 + Math.random() * 0.7; world.pool.splash?.(pos.x + Math.cos(ang) * r, pos.z + Math.sin(ang) * r, 1.1); }
    S.camShake = 0.55; buzz([40, 30, 80]); plop();
    fx.pop(L('扑通！！！', 'SPLASH!!!'), pos, '#7fe3ff', 1.9); setTimeout(() => fx.pop(pick(RATINGS), pos, '#ffd23f', 1.3), 450);
    world.plants?.leafBurst?.(pos.x, 1.2, pos.z, 14); announceDunk(); startSurface();
  }, 'jump');
}
function recoverPlayer() {
  if (import.meta.env.DEV) console.warn('recovered a stuck player from', S.mode);
  S.stuckT = 0; S.flip = false; S.air = false; S.vy = 0; S.vel.set(0, 0, 0); S.kick.set(0, 0, 0); S.emote = null;
  player.root.rotation.x = 0; board?.setLoad(0);
  if (insideSea(pos.x, pos.z, 0)) { S.mode = 'swim'; pos.y = WATER_Y - SWIM_DEPTH; }
  else { S.mode = 'land'; landSafe(pos, pos.x, pos.z, false); pos.y = groundAt(pos.x, pos.z); }
}
function startSurface() {
  if (!swimmable(pos.x, pos.z)) { const q = nearest(pos.x, pos.z, swimmable, 3); if (q) { pos.x = q[0]; pos.z = q[1]; } } // flung into the shallows / onto the steps: come up in open water
  S.mode = 'surfacing'; const y0 = pos.y;
  const yEnd = Math.max(WATER_Y - SWIM_DEPTH, bedAt(pos.x, pos.z) + 0.12);
  tween(0.7, (k) => { pos.y = THREE.MathUtils.lerp(y0, yEnd, ease(k)); }, () => { S.mode = 'swim'; toast(L('畅游吧！游到任何岸边往岸上走就能上来', 'Enjoy the swim! Head for any bank and keep going to climb out')); });
}
// 回岸边: an autopilot that swims you back — to the stairs if they're about as close, otherwise straight to the nearest bit
// of deck edge, round the islet if it's in the way — and climbs out there. Push the joystick (or tap again) to take over.
let shore = null; // { x, z, stairs, ax, az, stall }
function startSwimHome() {
  if (S.mode !== 'swim') return;
  if (shore) { shore = null; return; }
  const tx = THREE.MathUtils.clamp(pos.x, DECK.x0 + 0.8, DECK.x1 - 0.8), tz = DECK.z1 + 0.85, sz = STAIRS.z1 + 0.6; // the stairs are boarded from the front
  const dEdge = Math.hypot(pos.x - tx, pos.z - tz), dSt = Math.hypot(pos.x - STAIRS.foot.x, pos.z - sz);
  shore = dSt < dEdge + 2.5 || onStairBlock(tx, tz) ? { x: STAIRS.foot.x, z: sz, stairs: true } : { x: tx, z: tz, stairs: false };
  shore.ax = pos.x; shore.az = pos.z; shore.stall = 0; S.emote = null;
}
function swimHome(mv, dt) { // points mv the way home; false once it has handed over to the climb
  const isl = LAYOUT.sea.island; let gx = shore.x, gz = shore.z;
  if (shore.stairs && pos.z < STAIRS.z1 + 0.7) { gx = pos.x < STAIRS.foot.x ? STAIRS.x0 - 1.0 : STAIRS.x1 + 1.0; gz = STAIRS.z1 + 1.0; } // beside the stairs: round the handrail to the front first
  const sx = gx - pos.x, sz = gz - pos.z, k = THREE.MathUtils.clamp(((isl.x - pos.x) * sx + (isl.z - pos.z) * sz) / (sx * sx + sz * sz || 1), 0, 1);
  const cx = pos.x + sx * k - isl.x, cz = pos.z + sz * k - isl.z, cd = Math.hypot(cx, cz);
  if (cd < isl.r + 1.0) { const nx = cd > 1e-3 ? cx / cd : Math.sign(pos.x - isl.x) || 1, nz = cd > 1e-3 ? cz / cd : 0; gx = isl.x + nx * (isl.r + 1.8); gz = isl.z + nz * (isl.r + 1.8); } // the islet is in the way: aim past its side
  const d = Math.hypot(shore.x - pos.x, shore.z - pos.z);
  if (Math.hypot(pos.x - shore.ax, pos.z - shore.az) > 0.4) { shore.ax = pos.x; shore.az = pos.z; shore.stall = 0; } else shore.stall += dt; // pinned against a bank?
  if (d < 0.7 || shore.stall > 1.5) { // there (or stuck on a bank): climb out
    const h = shore; shore = null;
    if (h.stairs || (h.stall > 1.5 && d > 3)) startClimb(true); else startClimb(false, h.x);
    return false;
  }
  mv.set(gx - pos.x, 0, gz - pos.z).normalize(); return true;
}
// climb out at the stairs (force = 回岸边 button) or straight onto the deck edge where you are
function startClimb(force, atX) {
  S.mode = 'climbing'; S.vel.set(0, 0, 0); S.kick.set(0, 0, 0);
  const a = pos.clone();
  const landing = atX?.isVector3 ? atX : null;
  const sx = THREE.MathUtils.clamp(pos.x, STAIRS.x0 + 0.6, STAIRS.x1 - 0.6); // up the stairs where you are, not always up the middle
  const foot = landing ? pos.clone() : atX === undefined ? new THREE.Vector3(sx, 0, STAIRS.foot.z) : new THREE.Vector3(atX, 0, DECK.z1 + 0.5);
  const top = landing ? (walkable(landing.x, landing.z) ? landing : landing.clone().lerp(pos, 0.3)) : atX === undefined ? new THREE.Vector3(sx, 0, STAIRS.top.z) : new THREE.Vector3(atX, 0, DECK.z1 - 0.45);
  foot.y = WATER_Y - SWIM_DEPTH;
  const pre = THREE.MathUtils.clamp(a.distanceTo(foot) / 5, 0.25, 2.2), up = 1.0, T = pre + up;
  S.ry = Math.atan2(top.x - a.x, top.z - a.z);
  tween(T, (k) => {
    const t = k * T;
    if (t < pre) { pos.lerpVectors(a, foot, ease(t / pre)); pos.y = foot.y; }
    else { const k2 = ease((t - pre) / up); pos.lerpVectors(foot, top, k2); pos.y = THREE.MathUtils.lerp(foot.y, groundAt(top.x, top.z), k2) + Math.sin(k2 * Math.PI) * 0.15; }
  }, () => { S.mode = 'land'; if (!dryLand(pos.x, pos.z)) unstick(pos); pos.y = groundAt(pos.x, pos.z); S.shake = 1.0; toast(L('甩甩水，回到岸上', 'Shake off the water, you’re back on land')); });
}
function dash() {
  if (!player || S.dashCD > 0 || (S.mode !== 'land' && S.mode !== 'swim')) return;
  S.dash = 0.32; S.dashCD = 0.9; S.emote = null; fx.pop(L('冲！', 'GO!'), pos, '#ffd23f', 0.7);
}
// HUD buttons fire on pointerdown: a second finger (while the first steers the joystick) never gets a click
// …but a phone still sends a delayed "click" where the finger lifted. If that button just opened a dialog, the click would land
// on the dialog's backdrop and close it again at once (the 点酒 "闪退"). Swallow that ghost click.
let ghost = { until: 0, x: 0, y: 0 };
document.addEventListener('click', (e) => {
  if (performance.now() < ghost.until && Math.hypot(e.clientX - ghost.x, e.clientY - ghost.y) < 60) { e.preventDefault(); e.stopPropagation(); ghost.until = 0; }
}, true);
function tapButton(el, fn) {
  let fired = 0;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fired = performance.now(); if (e.pointerType !== 'mouse') ghost = { until: fired + 800, x: e.clientX, y: e.clientY }; fn(); });
  el.addEventListener('click', (e) => { if (performance.now() - fired < 600) { e.preventDefault(); return; } fn(); }); // keyboard / mouse fallback
}
tapButton($('dash-btn'), dash);
function jump() {
  if (!player) return;
  if (S.mode === 'sit') { S.mode = 'land'; S.seat = null; pos.y = 0; }
  if (S.mode !== 'land' || S.air) return;
  if (S.riding) { S.vy = JUMP_V * 0.75; S.air = true; boing(0.5); return; } // bunny hop
  S.vy = JUMP_V; S.air = true; S.emote = null; S.squash = 0.35; player.play('hop');
}
tapButton($('jump-btn'), jump);
function announceDunk() {
  if (S.lastBumper && S.t - S.lastBumper.t < 3) {
    net?.send({ t: 'dunk', id: me.id, by: S.lastBumper.id, victim: me.nick, byNick: S.lastBumper.nick });
    toast(L(`${S.lastBumper.nick} 把你撞进了海里！`, `${S.lastBumper.nick} knocked you into the sea!`), 2600);
  }
}
// a bump: push me along n (unit, xz) with strength j
function getBumped(nx, nz, j, at, from, push = 0) {
  if (S.riding) { if (push > 1.4 || j > 7.5) { crashBike(nx, nz, from); j *= 1.25; } else j *= 0.35; } // a rider rams hard but only falls when rammed
  if (S.bumpCD > 0) return; S.bumpCD = 0.35;
  if (from) S.lastBumper = { id: from, nick: remotes.get(from)?.nick || L('有人', 'Someone'), t: S.t };
  if (S.mode === 'sit') { S.mode = 'land'; S.seat = null; pos.y = 0; }
  let shove = 1.15;
  if (S.mode === 'land') for (let d = 0.6; d <= 3; d += 0.6) if (insideSea(pos.x + nx * d, pos.z + nz * d, 0.2) || (pos.z + nz * d > DECK.z1 && Math.abs(pos.x + nx * d) < 7.9 && pos.z > 3)) { shove = 1.7; break; } // water that way → help it along
  S.kick.x += nx * j * shove; S.kick.z += nz * j * shove; S.squash = 1;
  if (S.mode === 'land' && j > 3) { S.vy = Math.max(S.vy, Math.min(7.5, 2.6 + j * 0.45)); S.air = true; } // 撞飞: a proper arc, ~4–7 m
  S.camShake = Math.min(0.35, 0.08 + j * 0.03);
  boing(j / 3); buzz(Math.min(60, 15 + j * 5));
  fx.pop(pick(BUMP_WORDS), at || pos, j > 7 ? '#ff6b3d' : '#ffb347', j > 7 ? 1.25 : 1);
  if (j > 7) { fx.dizzy(player.root, avatarInfo(me.avatar).head, 1.6); world.plants?.leafBurst?.(pos.x, 1.4, pos.z, 18); }
  S.bumps++; $('bump-count').hidden = false; $('bump-count').textContent = `💥 ${S.bumps}`;
}
// splash particles
const splashes = [];
function splash(p) {
  if (world?.pool?.splash) { world.pool.splash(p.x, p.z, 1); return; }
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xcdf3ff, transparent: true }));
    m.position.set(p.x, WATER_Y, p.z); scene.add(m);
    const a = Math.random() * 6.28, s = 1 + Math.random() * 1.6; splashes.push({ m, v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 2.5, Math.sin(a) * s), life: 0.9 });
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, WATER_Y + 0.03, p.z); scene.add(ring); splashes.push({ m: ring, ring: true, life: 1.4, t: 0 });
}

// ---------- multiplayer ----------
function buzz(p) { if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.(p); } // vibration only after a real tap
const labelAt = (ch, base) => Math.max(base, (ch.topY || 0) + 0.3);
function sendPos() { if (!net || !player) return; net.send({ t: 'pos', id: me.id, nick: me.nick, avatar: me.avatar, x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), z: +pos.z.toFixed(3), ry: +S.ry.toFixed(3), st: S.mode, em: S.emote?.name || null, d: S.dash > 0 ? 1 : 0, rx: S.flip ? +player.root.rotation.x.toFixed(2) : 0, seat: S.mode === 'sit' && S.seat ? S.seat.id : -1, c: me.outfit.color || '', h: me.outfit.hat, bk: S.riding ? 1 : 0, sf: S.surfing ? 1 : 0 }); }
function handleNet(m) {
  if (!m || m.id === me.id) return;
  if (m.t === 'pos') {
    let r = remotes.get(m.id);
    if (!r) { const ch = createCharacter(m.avatar); const obj = ch.root; scene.add(obj); const label = makeNameLabel(m.nick); label.position.set(0, avatarInfo(m.avatar).label, 0); obj.add(label); obj.position.set(m.x, m.y, m.z); r = { ch, obj, label, nick: m.nick, avatar: m.avatar, target: new THREE.Vector3(m.x, m.y, m.z), ry: m.ry, st: m.st, last: 0 }; remotes.set(m.id, r); const rr = r; ch.onOutfit = () => rr.label.position.set(0, labelAt(ch, avatarInfo(rr.avatar).label), 0); }
    if (r.nick !== m.nick) { r.obj.remove(r.label); r.label = makeNameLabel(m.nick); r.label.position.set(0, labelAt(r.ch, avatarInfo(r.avatar).label), 0); r.obj.add(r.label); r.nick = m.nick; }
    const oc = okColor(m.c || null), oh = okHat(m.h); if (oc !== r.oc || oh !== r.oh) { r.oc = oc; r.oh = oh; r.ch.setOutfit({ color: oc, hat: oh }); }
    const now = performance.now(), dtm = Math.max(0.05, (now - (r.last || now - 100)) / 1000);
    r.vel = r.vel || new THREE.Vector3();
    const vx = (m.x - r.target.x) / dtm, vz = (m.z - r.target.z) / dtm, vs = Math.hypot(vx, vz); // smoothed; a teleport (respawn, climb-out) isn't a velocity
    if (vs > 12) r.vel.set(0, 0, 0); else { r.vel.x += (vx - r.vel.x) * 0.6; r.vel.z += (vz - r.vel.z) * 0.6; }
    r.target.set(m.x, m.y, m.z); r.ry = m.ry; r.st = m.st; r.em = m.em; r.dashing = !!m.d; r.bk = !!m.bk; r.sf = !!m.sf; r.rx = +m.rx || 0; r.seat = Number.isInteger(m.seat) ? m.seat : -1; r.last = now;
    // two guests sat down on the same seat at the same moment: the one with the larger id gets up
    if (r.st === 'sit' && S.mode === 'sit' && S.seat && r.seat === S.seat.id && m.id < me.id) standUp(L('这个位置刚被人坐了，换一个吧', 'Someone just took that seat, try another one'));
  } else if (m.t === 'dice') { dice?.receive(m);
  } else if (m.t === 'bikesteal') { if (m.by === me.id) { toast(L(`你把 ${m.victim} 撞下了车！快骑上去 🚲`, `You knocked ${m.victim} off the bike! Hop on 🚲`), 2400); emote('cheer'); } else toast(L(`${remotes.get(m.by)?.nick || '有人'} 把 ${m.victim} 撞下了车！`, `${remotes.get(m.by)?.nick || 'Someone'} knocked ${m.victim} off the bike!`), 2200);
  } else if (m.t === 'board') { board?.kick(Math.max(-10, Math.min(0, +m.a || 0)));
  } else if (m.t === 'bump' && m.to === me.id && player) {
    const r = remotes.get(m.id); if (r) r.squash = 1; getBumped(m.nx, m.nz, m.j, r ? r.obj.position.clone().lerp(pos, 0.5) : pos, m.id, +m.p || 0);
  } else if (m.t === 'dunk') {
    if (m.by === me.id) { toast(L(`你把 ${m.victim} 撞进了海里！🎉`, `You knocked ${m.victim} into the sea! 🎉`), 2600); emote('cheer'); world.plants?.leafBurst?.(pos.x, 1.6, pos.z, 30); } else toast(L(`${m.byNick} 把 ${m.victim} 撞进了海里！`, `${m.byNick} knocked ${m.victim} into the sea!`), 2600);
  } else if (m.t === 'bye') { const r = remotes.get(m.id); if (r) { scene.remove(r.obj); remotes.delete(m.id); } }
}

// ---------- loop ----------
let last = 0; const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), tmp = new THREE.Vector3();
// Adaptive quality: watch real frame times and trade resolution (then bloom) for smoothness.
const perf = { frames: [], next: 0, bloomOff: false };
function governQuality(frameMs, now) {
  if (document.hidden || frameMs > 250) return;
  perf.frames.push(frameMs); if (perf.frames.length > 90) perf.frames.shift();
  if (now < perf.next || perf.frames.length < 60) return;
  const sorted = [...perf.frames].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  if (med > 22) { // under ~45 fps
    if (pixelRatio > 1) pixelRatio = Math.max(1, pixelRatio - 0.25);
    else if (!perf.bloomOff) { perf.bloomOff = true; env.bloom.enabled = false; }
    renderer.setPixelRatio(pixelRatio); resize(); perf.frames.length = 0; perf.next = now + 2000;
  } else if (med < 13 && (pixelRatio < maxPR || perf.bloomOff)) { // comfortably fast: give quality back slowly
    if (perf.bloomOff) { perf.bloomOff = false; env.bloom.enabled = true; } else pixelRatio = Math.min(maxPR, pixelRatio + 0.25);
    renderer.setPixelRatio(pixelRatio); resize(); perf.frames.length = 0; perf.next = now + 5000;
  }
}
let devFast = false; // dev only (see src/dev/adversary.js)
function loop(now) { requestAnimationFrame(loop); frame(now); }
function frame(now) {
  if (now < last) return; // a dev tick() ran the clock ahead: wait for real time to catch up
  if (!devFast) governQuality(now - last, now);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; S.t += dt;
  world.update(S.t, dt); disco?.update(dt, S.t); halloween?.update(dt, S.t, disco?.mix.halloween || 0); world.pool.setSurf?.(disco?.mix.disco || 0); board?.update(dt); world.orderRail?.update(dt, S.t);
  if (!player) { // attract camera: slow orbit over the courtyard
    npcs.update(dt, null, world.pool.surfaceHeight, camera.position);
    const a = S.t * 0.06 + 0.6; camera.position.set(Math.sin(a) * 13, 6.2, -1.5 + Math.cos(a) * 11); camera.lookAt(0, 1.4, -3);
    env.update(S.t, null); env.render(); jbui.tick(); speech.update(); return;
  }
  // input vector (camera-relative)
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  fwd.set(-Math.sin(S.yaw), 0, -Math.cos(S.yaw)); rgt.set(Math.cos(S.yaw), 0, -Math.sin(S.yaw));
  const mv = tmp.set(0, 0, 0).addScaledVector(rgt, ix).addScaledVector(fwd, -iz);
  let moving = mv.lengthSq() > 0.01;
  if (shore) { if (S.mode !== 'swim' || moving) shore = null; else if (swimHome(mv, dt)) moving = true; } // 回岸边 autopilot until you steer yourself
  let action = 'idle';
  if (S.tw) { try { S.tw.t += dt; const k = Math.min(1, S.tw.t / S.tw.dur); S.tw.fn(k); if (k >= 1) { const d = S.tw.done; S.tw = null; d && d(); } } catch (err) { S.tw = null; console.error('tween', err); } action = S.tw?.act || (S.mode === 'climbing' ? 'climb' : S.mode === 'jumping' ? 'jump' : 'swim'); }
  else if (S.mode === 'sit') {
    action = 'sit';
    if (player.hip) { // put the pelvis on the seat whatever the character's proportions
      player.hip.getWorldPosition(_hip); player.root.worldToLocal(_hip);
      const c = Math.cos(S.ry), s = Math.sin(S.ry);
      const tx = S.seat.x - (_hip.x * c + _hip.z * s), tz = S.seat.z - (-_hip.x * s + _hip.z * c), ty = S.seat.y + 0.05 - _hip.y;
      const k = Math.min(1, dt * 10); pos.x += (tx - pos.x) * k; pos.z += (tz - pos.z) * k; pos.y += (ty - pos.y) * k;
    }
    if (moving) { S.mode = 'land'; pos.set(S.seat.x + mv.x * 0.75, 0, S.seat.z + mv.z * 0.75); landSafe(pos, S.seat.x, S.seat.z); S.seat = null; if (dice?.inGame()) dice.close(); }
  }
  else if (S.mode === 'land' || S.mode === 'swim') {
    const swim = S.mode === 'swim';
    // velocity model: input steers S.vel; bumps live in S.kick and decay on their own
    if (S.riding && !swim) { // a bike: turns with a radius, rolls on, coasts to a stop
      const want = moving ? Math.atan2(mv.x, mv.z) : S.ry, dA = ((want - S.ry + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const turn = THREE.MathUtils.clamp(dA, -2.6 * dt, 2.6 * dt); S.ry += turn; S.turn = turn / Math.max(dt, 1e-3);
      const throttle = moving ? Math.min(1, mv.length()) * (Math.abs(dA) < 2.2 ? 1 : 0.25) : 0;
      _tv.set(Math.sin(S.ry), 0, Math.cos(S.ry)).multiplyScalar((S.dash > 0 ? 9.5 : 6.2) * throttle);
      S.vel.lerp(_tv, 1 - Math.exp(-dt * (moving ? 2.4 : 1.2)));
      S.kick.multiplyScalar(Math.exp(-dt * 3.2));
    } else {
      const grooving = !swim && S.emote?.name === 'dance'; // 蹦迪 keeps going while you shuffle along, slowly
      const surf = swim && S.surfing;
      const speed = S.dash > 0 ? (surf ? 8 : swim ? 6 : 8.5) : (surf ? 4.6 : swim ? 3.0 : grooving ? 1.3 : 3.6);
      if (S.dash > 0 && !moving) _tv.set(Math.sin(S.ry), 0, Math.cos(S.ry)).multiplyScalar(speed); else _tv.copy(mv).multiplyScalar(speed);
      S.vel.lerp(_tv, 1 - Math.exp(-dt * (S.dash > 0 ? 20 : 11)));
      S.kick.multiplyScalar(Math.exp(-dt * (swim ? 2.2 : 3.2)));
      if (moving) { S.ry = Math.atan2(mv.x, mv.z); if (!grooving) S.emote = null; }
    }
    // safety net: physics must never run away (bounces add to kick; cap it and recover from NaN)
    const kl = S.kick.length(); if (!Number.isFinite(kl)) { S.kick.set(0, 0, 0); if (import.meta.env.DEV) console.warn('kick NaN reset'); } else if (kl > 14) { S.kick.multiplyScalar(14 / kl); if (import.meta.env.DEV) console.warn('kick clamp', kl.toFixed(1)); }
    const vl = S.vel.length(); if (!Number.isFinite(vl)) S.vel.set(0, 0, 0); else if (vl > 10) S.vel.multiplyScalar(10 / vl);
    const vx = S.vel.x + S.kick.x, vz = S.vel.z + S.kick.z, sp = Math.hypot(vx, vz);
    // bumper cars vs other guests (same medium only)
    for (const [rid, r] of remotes) {
      if ((r.st === 'swim') !== swim || (r.st !== 'land' && r.st !== 'swim')) continue;
      const dx = pos.x - r.obj.position.x, dz = pos.z - r.obj.position.z, d = Math.hypot(dx, dz), R = 0.8;
      if (d >= R) continue;
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      pos.x += nx * (R - d) * 0.5; pos.z += nz * (R - d) * 0.5; // never overlap
      const closing = -(vx * nx + vz * nz) + ((r.vel?.x || 0) * nx + (r.vel?.z || 0) * nz);
      if (closing > 1.6 && S.bumpCD <= 0) {
        const j = Math.min(12, 2 + closing * 1.15 + (r.dashing ? 3 : 0)) * (swim ? 0.7 : 1);
        const at = r.obj.position.clone().lerp(pos, 0.5);
        const myPush = -(vx * nx + vz * nz) + (S.dash > 0 ? 3 : 0), theirPush = (r.vel?.x || 0) * nx + (r.vel?.z || 0) * nz + (r.dashing ? 3 : 0);
        net?.send({ t: 'bump', id: me.id, to: rid, nx: -nx, nz: -nz, j: +(j * 0.9 * (S.riding ? 1.5 : 1)).toFixed(2), p: +myPush.toFixed(2) }); // a bike hits harder
        r.squash = 1; getBumped(nx, nz, j, at, rid, theirPush);
      }
    }
    if (!swim) {
      const px = pos.x, pz = pos.z;
      pos.x += vx * dt; pos.z += vz * dt;
      if (S.air) { S.vy -= GRAVITY * dt; pos.y += S.vy * dt; S.kick.multiplyScalar(Math.exp(dt * 2.4)); /* much less drag in the air: flyers sail */ }
      const overSea = insideSea(pos.x, pos.z, 0.3);
      const offDeck = pos.z > BOUNDS.zLand && pos.z < 6.4 && Math.abs(pos.x) <= 7.9 && vz > 0.2; // stepping/knocked off the deck edge (incl. the stairs)
      if (S.air && (overSea || (offDeck && pos.z > DECK.z1))) { // flying over the water: drop in when we reach it
        if (pos.y <= WATER_Y) { S.air = false; S.vy = 0; S.kick.multiplyScalar(0.3); splash(pos); plop(); fx.pop(L('扑通！', 'SPLASH!'), pos, '#7fe3ff'); announceDunk(); startSurface(); }
      } else if ((!S.air || !walkable(pos.x, pos.z)) && (offDeck || insideSea(pos.x, pos.z, 0))) { // walked, got shoved or flew off the edge → in we go (same edge as walkable())
        if (S.riding) rideIntoSea(); // the rider goes in, the bike goes home
        wadeIn(px, pz, vx, vz);
      } else {
        const gy = groundAt(pos.x, pos.z);
        if (S.air && pos.y <= gy) { pos.y = gy; S.air = false; S.vy = 0; S.squash = 0.6; if (Math.hypot(S.kick.x, S.kick.z) > 3) { boing(0.6); fx.pop(L('咚！', 'THUD!'), pos, '#ffb347', 0.6); } }
        const yKeep = pos.y;
        let wall = null;
        if (!walkable(pos.x, pos.z)) { // courtyard walls + the invisible air walls at the world's edge: slide along them
          wall = _wallN.set(0, 0, 0);
          if (walkable(pos.x, pz)) { wall.z = Math.sign(pz - pos.z); pos.z = pz; }
          else if (walkable(px, pos.z)) { wall.x = Math.sign(px - pos.x); pos.x = px; }
          else { wall.set(Math.sign(px - pos.x), 0, Math.sign(pz - pos.z)); pos.x = px; pos.z = pz; }
          if (wall.lengthSq()) wall.normalize(); else wall = null;
        }
        const n = landSafe(pos, px, pz, false) || wall; // bounds come from walkable(); this pushes out of furniture/NPC colliders, never into a wall
        pos.y = S.air ? yKeep : groundAt(pos.x, pos.z); // feet on the undulating shore
        if (n && sp > 4.2) { // bounced off furniture / walls / NPCs
          const vn = vx * n.x + vz * n.z; if (vn < 0) { S.kick.x += -n.x * vn * 1.4; S.kick.z += -n.z * vn * 1.4; S.vel.multiplyScalar(0.2); }
          if (S.bumpCD <= 0) { S.bumpCD = 0.3; S.squash = 0.7; boing(sp / 4); fx.pop(n.npc ? pick(BUMP_WORDS) : L('咚！', 'THUD!'), pos, '#ffb347', 0.8); S.camShake = 0.12; }
          if (n.npc) npcs.bump(n.npc);
          if (S.riding && sp > 6.8) crashBike(n.x, n.z, null); // flat out into a wall: off you go
        }
      }
      if (S.riding) action = 'sit';
      else if (S.mode === 'land' && S.air) action = 'hop';
      else if (S.mode === 'land') { action = Math.hypot(S.vel.x, S.vel.z) > 0.4 ? 'walk' : 'idle'; if (action === 'idle' && S.emote) { action = S.emote.name; S.emote.t -= dt; if (S.emote.t <= 0) S.emote = null; } if (S.shake > 0) { S.shake -= dt; action = 'wave'; } }
    } else if (onStairBlock(pos.x, pos.z)) { startClimb(false); action = 'swim'; // in the water on the steps (an older build let you swim through them): walk up them
    } else {
      // swim inside the lagoon outline: move per axis so we slide along the shore instead of sticking
      const ox = pos.x; pos.x += vx * dt; if (!swimmable(pos.x, pos.z)) { pos.x = ox; S.vel.x *= -0.2; S.kick.x *= -0.5; }
      const oz = pos.z; pos.z += vz * dt; if (!swimmable(pos.x, pos.z)) { pos.z = oz; S.vel.z *= -0.2; S.kick.z *= -0.5; }
      // over the shallow shelf the swimmer rides higher so legs never sink into the bank
      const wy = world.pool.surfaceHeight ? world.pool.surfaceHeight(pos.x, pos.z, S.t) : WATER_Y;
      const surfNow = (world.pool.surf || 0) > 0.5 && !shore; // 蹦迪 swell: stand up on the board (回岸边 still swims you in)
      if (surfNow !== !!S.surfing) { S.surfing = surfNow; if (surfNow && !S.surfTold) { S.surfTold = true; toast(L('浪来了！站上冲浪板 🏄 顺着浪往岸边冲', 'Surf’s up! Stand on the board 🏄 and ride the waves to shore'), 2600); } }
      if (S.surfing) {
        pos.y = wy + 0.03; action = 'idle';
        const sl = waveSlope(pos.x, pos.z); S.kick.x -= sl.x * 16 * dt; S.kick.z -= sl.y * 16 * dt; // slide down the wave face
        S.ripple = (S.ripple || 0) - dt; if (S.ripple <= 0 && Math.hypot(vx, vz) > 1.5) { S.ripple = 0.18; world.pool.splash?.(pos.x - Math.sin(S.ry) * 0.55, pos.z - Math.cos(S.ry) * 0.55, 0.25 + Math.min(0.4, Math.hypot(vx, vz) * 0.05)); }
      } else { pos.y = Math.max(wy - (S.swimDepth ?? SWIM_DEPTH), bedAt(pos.x, pos.z) + 0.12); action = 'swim'; }
      for (const c of npcs.swimmers) { // the backstroke crocs are big soft bumpers
        const dx = pos.x - c.roll.position.x, dz = pos.z - c.roll.position.z, d = Math.hypot(dx, dz);
        if (d < 1.15 && S.bumpCD <= 0) { const nx = dx / (d || 1), nz = dz / (d || 1), bx = pos.x, bz = pos.z; pos.x = c.roll.position.x + nx * 1.15; pos.z = c.roll.position.z + nz * 1.15; if (!swimmable(pos.x, pos.z)) { pos.x = bx; pos.z = bz; } npcs.bumpSwimmer(c); getBumped(nx, nz, 3 + Math.hypot(vx, vz) * 1.2, pos); }
      }
      if (!S.surfing) { S.ripple = (S.ripple || 0) - dt; if (S.ripple <= 0 && Math.hypot(vx, vz) > 0.8) { S.ripple = S.dash > 0 ? 0.25 : 0.7; world.pool.splash?.(pos.x, pos.z, S.dash > 0 ? 0.45 : 0.3); } }
      if (moving && mv.z < -0.35 && pos.x > STAIRS.x0 + 0.1 && pos.x < STAIRS.x1 - 0.1 && onStairBlock(pos.x + mv.x * 0.7, pos.z + mv.z * 0.7)) startClimb(false); // swum up to the stairs between the handrails
      else if (moving && !swimmable(pos.x + mv.x * 0.7, pos.z + mv.z * 0.7)) { // pushing against a bank (or into the shallows): climb out there
        const land = findLanding(pos.x, pos.z, mv.x, mv.z);
        if (land) startClimb(false, land);
      }
    }
  }
  // watchdog: an in-between mode with no animation driving it would freeze the player for good — stand them back up
  if (!S.tw && (S.mode === 'jumping' || S.mode === 'climbing' || S.mode === 'surfacing')) { S.stuckT = (S.stuckT || 0) + dt; if (S.stuckT > 0.5) recoverPlayer(); } else S.stuckT = 0;
  S.dash = Math.max(0, S.dash - dt); S.dashCD = Math.max(0, S.dashCD - dt); S.bumpCD = Math.max(0, S.bumpCD - dt);
  player.root.position.copy(pos); player.root.rotation.y = lerpAngle(player.root.rotation.y, S.ry, Math.min(1, dt * 12));
  if (S.squash > 0) { S.squash = Math.max(0, S.squash - dt * 2.6); const q = Math.sin((1 - S.squash) * Math.PI * 3) * S.squash * 0.28; player.root.scale.set(1 + q, 1 - q, 1 + q); } else player.root.scale.set(1, 1, 1);
  player.groundLock = S.mode === 'land' && !S.air && !S.riding; player.play(action); player.update(dt, Math.hypot(S.vel.x, S.vel.z));
  if (S.mode !== 'swim') S.surfing = false;
  if (!surfBoard && player.ready) { surfBoard = makeSurfboard(); player.root.add(surfBoard); }
  if (surfBoard) surfBoard.visible = !!S.surfing;
  if (S.surfing) { // on the board: stand, arms out, ride the swell
    landPose(player, dt); surfPose(player, S.sfp || (S.sfp = {}), dt, true, Math.hypot(S.vel.x, S.vel.z));
    tiltOnWave(player.root, player.root.rotation.y, waveSlope(pos.x, pos.z), Math.min(1, dt * 8));
  } else if (!S.flip && (player.root.rotation.x || player.root.rotation.z)) { player.root.rotation.x *= Math.max(0, 1 - dt * 10); player.root.rotation.z *= Math.max(0, 1 - dt * 10); if (Math.abs(player.root.rotation.x) + Math.abs(player.root.rotation.z) < 0.005) player.root.rotation.x = player.root.rotation.z = 0; }
  if (!S.surfing && (S.mode === 'swim' || S.mode === 'surfacing')) {
    S.sp = S.sp || {}; const prev = S.sp.stroke ?? 0, sp = Math.hypot(S.vel.x, S.vel.z);
    S.swimDepth = swimPose(player, S.sp, dt, { speed: S.mode === 'swim' ? sp : 0, dash: S.dash > 0 });
    // a paw slapping the water at the bottom of each stroke
    if (sp > 0.8 && Math.sign(prev) !== Math.sign(S.sp.stroke)) world.pool.splash?.(pos.x + Math.sin(S.ry) * 0.45, pos.z + Math.cos(S.ry) * 0.45, S.dash > 0 ? 0.3 : 0.12);
  } else if (!S.surfing) landPose(player, dt);
  if (!S.surfing && S.sfp?.w) surfPose(player, S.sfp, dt, false, 0);
  dancePose(player, S.dp || (S.dp = {}), dt, action === 'dance' || (action === 'walk' && S.emote?.name === 'dance')); // walking: the walk clip's legs, the dance up top
  updateBike(dt); // seats the rider first, so the riding pose aims at this frame's pedals
  ridePose(player, S.rp || (S.rp = {}), dt, S.riding, Math.hypot(S.vel.x, S.vel.z), S.riding ? bike : null);
  fx.update(dt);

  // remotes
  const t = performance.now();
  for (const [id, r] of remotes) {
    if (t - r.last > 6000) { scene.remove(r.obj); remotes.delete(id); continue; }
    // dead reckoning while walking / swimming freely: aim at last report + velocity × time since (≤ 0.15 s, ≤ 0.6 m),
    // so remotes don't trail a send interval plus network delay behind; tweens (jump, climb, seat, bike) just ease in
    const lead = (r.st === 'land' || r.st === 'swim') && !r.bk && r.seat < 0 ? Math.min((t - r.last) / 1000, 0.15) : 0;
    _aim.copy(r.target); if (lead) { const k = Math.min(lead, 0.6 / Math.max(0.6, Math.hypot(r.vel.x, r.vel.z))); _aim.x += r.vel.x * k; _aim.z += r.vel.z * k; }
    const before = r.obj.position.clone(); r.obj.position.lerp(_aim, Math.min(1, dt * 12));
    const spd = before.distanceTo(r.obj.position) / Math.max(dt, 1e-3);
    r.obj.rotation.y = lerpAngle(r.obj.rotation.y, r.ry, Math.min(1, dt * 10));
    r.ch.groundLock = r.st === 'land' && Math.abs(r.obj.position.y - r.target.y) < 0.05;
    r.ch.groundLock = r.ch.groundLock && !r.bk;
    r.ch.play(r.bk && bikeState.rider === id ? 'sit' : r.sf && r.st === 'swim' ? 'idle' : r.st === 'swim' || r.st === 'surfacing' ? 'swim' : r.st === 'jumping' ? 'jump' : r.st === 'climbing' ? 'climb' : r.st === 'sit' ? 'sit' : (r.st === 'land' && r.target.y > 0.2) ? 'hop' : spd > 0.3 ? 'walk' : r.em || 'idle'); r.ch.update(dt, spd, (r.st === 'swim' || r.st === 'surfacing' || r.em === 'dance' || camera.position.distanceTo(r.obj.position) < 14) ? 1 : 2); // swim / dance overlays need a fresh clip pose every frame
    const rSurf = r.sf && r.st === 'swim';
    if (rSurf) { if (!r.board && r.ch.ready) { r.board = makeSurfboard(); r.obj.add(r.board); } landPose(r.ch, dt); surfPose(r.ch, r.sfp || (r.sfp = {}), dt, true, spd); tiltOnWave(r.obj, r.obj.rotation.y, waveSlope(r.obj.position.x, r.obj.position.z, _sg2), Math.min(1, dt * 8)); }
    else if (r.st === 'swim' || r.st === 'surfacing') swimPose(r.ch, r.sp || (r.sp = {}), dt, { speed: r.st === 'swim' ? Math.hypot(r.vel?.x || 0, r.vel?.z || 0) : 0, dash: r.dashing }); else landPose(r.ch, dt);
    if (r.board) r.board.visible = rSurf;
    if (!rSurf && r.sfp?.w) { surfPose(r.ch, r.sfp, dt, false, 0); if (!r.rx) { r.obj.rotation.x *= 0.85; r.obj.rotation.z *= 0.85; } }
    dancePose(r.ch, r.dp || (r.dp = {}), dt, r.st === 'land' && r.em === 'dance');
    const onBike = r.bk && bikeState.rider === id; r.spd = spd;
    if (onBike) seatOnBike(r.ch); else if (r.wasOnBike) unseat(r.ch); r.wasOnBike = onBike; ridePose(r.ch, r.rp || (r.rp = {}), dt, onBike, spd, onBike ? bike : null);
    // flips (跳海 / 跳板) arrive as the sender's pitch angle; ease towards it, and unwind whole turns when it ends
    if (r.rx || r.obj.rotation.x) { r.obj.rotation.order = 'YXZ'; if (!r.rx && Math.abs(r.obj.rotation.x) > Math.PI) r.obj.rotation.x %= Math.PI * 2; r.obj.rotation.x += ((r.rx || 0) - r.obj.rotation.x) * Math.min(1, dt * 14); if (!r.rx && Math.abs(r.obj.rotation.x) < 0.01) r.obj.rotation.x = 0; }
    if (r.squash > 0) { r.squash = Math.max(0, r.squash - dt * 2.6); const q = Math.sin((1 - r.squash) * Math.PI * 3) * r.squash * 0.28; r.obj.scale.set(1 + q, 1 - q, 1 + q); } else r.obj.scale.set(1, 1, 1);
  }
  npcs.update(dt, pos, world.pool.surfaceHeight, camera.position);
  // splash fx
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i]; s.life -= dt;
    if (s.ring) { s.t += dt; s.m.scale.setScalar(1 + s.t * 5); s.m.material.opacity = Math.max(0, s.life / 1.4) * 0.8; }
    else { s.v.y -= 9 * dt; s.m.position.addScaledVector(s.v, dt); s.m.material.opacity = Math.max(0, s.life); }
    if (s.life <= 0 || (!s.ring && s.m.position.y < WATER_Y - 0.1)) { scene.remove(s.m); splashes.splice(i, 1); }
  }
  // action buttons
  nearAction = currentAction();
  const ab = $('action-btn'); ab.hidden = !nearAction || !$('chat').hidden; if (nearAction && ab.dataset.label !== nearAction.label) { ab.dataset.label = nearAction.label; ab.textContent = nearAction.label; const k = document.createElement('kbd'); k.textContent = 'E'; ab.appendChild(k); }
  const rb = $('return-btn'); rb.hidden = S.mode !== 'swim' || !$('chat').hidden;
  const rbText = shore ? L('游回岸边中… 点我停', 'Swimming to shore… tap to stop') : L('回岸边', 'Swim to shore'); if (rb.textContent !== rbText) { rb.textContent = rbText; rb.classList.toggle('on', !!shore); }
  $('hud-place').textContent = (S.mode === 'land' || S.mode === 'sit') ? (pos.z < JUMP_EDGE_Z ? L('院子', 'Yard') : pos.z <= BOUNDS.zLand + 0.05 ? L('栈桥', 'Jetty') : L('湖边', 'Lakeside')) : L('海里', 'In the sea');
  $('emotes').hidden = S.mode !== 'land' && S.mode !== 'sit';
  $('jump-btn').hidden = (S.mode !== 'land' && S.mode !== 'sit') || !$('chat').hidden;
  $('dash-btn').hidden = (S.mode !== 'land' && S.mode !== 'swim') || !$('chat').hidden; $('dash-btn').classList.toggle('cool', S.dashCD > 0);

  // camera follow (water view stays at the surface)
  const cy = Math.sin(S.pitch), cx = Math.cos(S.pitch);
  const focus = tmp.set(pos.x, Math.max(pos.y, WATER_Y + 0.1) + 1.1, pos.z);
  const cam = new THREE.Vector3(focus.x + Math.sin(S.yaw) * cx * S.dist, focus.y + cy * S.dist, focus.z + Math.cos(S.yaw) * cx * S.dist);
  const overSea = focus.z > DECK.z0 - 0.5;
  cam.x = overSea ? THREE.MathUtils.clamp(cam.x, AIR.x0 - 1, AIR.x1 + 1) : THREE.MathUtils.clamp(cam.x, BOUNDS.x0 + 0.3, BOUNDS.x1 - 0.3);
  cam.z = THREE.MathUtils.clamp(cam.z, BOUNDS.zNorth + 0.8, AIR.z1 + 1.5); cam.y = Math.max(cam.y, WATER_Y + 0.5, groundAt(cam.x, cam.z) + 0.45);
  if (cam.y > 2.5 && cam.z < LAYOUT.bar.roofFrontZ + 0.6 && cam.x > LAYOUT.bar.x0 - 1.4 && cam.x < LAYOUT.bar.x1 + 0.8) cam.z = LAYOUT.bar.roofFrontZ + 0.6; // stay out of the bar roof
  camera.position.lerp(cam, Math.min(1, dt * 10));
  if (S.camShake > 0) { S.camShake = Math.max(0, S.camShake - dt * 1.5); camera.position.x += (Math.random() - 0.5) * S.camShake; camera.position.y += (Math.random() - 0.5) * S.camShake; }
  camera.lookAt(focus);
  if (world.plants?.setViewFocus && S._vf !== S.dist) { S._vf = S.dist; world.plants.setViewFocus(S.dist); }
  env.update(S.t, pos);
  if (devFast) return; // dev: the adversarial bot steps the simulation without drawing it
  env.render();
  jbui.tick();
  speech.update();
}
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }

// auto-start for returning users who already have name + avatar? keep the entry card; user confirms.
if (import.meta.env.DEV) window.__tiaohai = { S, pos, THREE, createCharacter, get scene() { return scene; }, get dice() { return dice; }, get me() { return me; }, receiveBike, get bikeState() { return bikeState; }, get remotes() { return remotes; }, get player() { return player; }, get world() { return world; }, startJump, startClimb,
  inject(msg) { handleNet(msg); }, dash, jump,
  info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; },
  async snap(name = 'snap', cam) { frame(last + 1000 / 60); if (cam) { camera.position.set(...cam.pos); camera.lookAt(...cam.look); env.render(); } const url = canvas.toDataURL('image/jpeg', 0.85); return (await fetch('/__snap?name=' + name, { method: 'POST', body: url })).text(); }, // dev only
  tick(frames = 60, ms = 1000 / 60) { for (let i = 0; i < frames; i++) frame(last + ms); }, get pixelRatio() { return pixelRatio; }, // dev: advance frames while the tab is hidden
  // for the adversarial bot (src/dev/adversary.js)
  keys, joy, walkable, swimmable, onStairBlock, nearStairPost, insideSea, groundAt, COLLIDERS, STAIRS, DECK, BOUNDS, LAYOUT, WATER_Y,
  mountBike, dismount, sitOn, standUp, startSwimHome, emote, getBumped, get bike() { return bike; }, get shore() { return shore; }, get seats() { return world?.seats || []; },
  set fast(v) { devFast = !!v; }, get fast() { return devFast; }, get disco() { return disco; }, cycleLights, get surfBoard() { return surfBoard; },
};
if (import.meta.env.DEV) import('./dev/adversary.js').then((m) => m.mountAdversary(window.__tiaohai));
