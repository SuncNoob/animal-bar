import MENU from './data/menu.json';
import { tuantuanAvatar } from './avatar3d.js';
import { L, isEn } from './i18n.js';

// 团团的怪问题 v3: 四轴人设(疯/懒/暖/拧) × 酒牌。问题不问口味；答案悄悄加分，选一张牌翻开。
const AX = ['疯', '懒', '暖', '拧'];
const AX_EMOJI = { 疯: '🎢', 懒: '🛋️', 暖: '🧣', 拧: '🌵' };
const TITLE = {
  疯: { 疯: '宇宙级整活人', 懒: '躺着发疯家', 暖: '快乐小太阳炮', 拧: '逆行小钢炮' },
  懒: { 疯: '摸鱼界卷王', 懒: '化在椅子上的人', 暖: '温吞小被窝', 拧: '躺平但有原则' },
  暖: { 疯: '暖心大嗓门', 懒: '慢热小太阳', 暖: '行走的暖水袋', 拧: '嘴硬心软话痨' },
  拧: { 疯: '执拗的快乐星人', 懒: '倔强的躺平仙', 暖: '外冷内热糖', 拧: '世界第一拧巴' },
};
const LINES = {
  疯: ['你一出场，池水都想先跳为敬。', '团团悄悄把贵重物品收好了。'],
  懒: ['今晚的任务：坐着，然后继续坐着。', '你是整个胡同最安静的一阵风。'],
  暖: ['有你在，连银杏叶都落得客气。', '团团想把围巾分你一半。'],
  拧: ['说不要就不要，说好看就是好看。', '你的原则比池子还深。'],
};
const TITLE_EN = {
  疯: { 疯: 'Cosmic-Level Chaos Agent', 懒: 'Couch-Bound Lunatic', 暖: 'Joy Cannon', 拧: 'Wrong-Way Pocket Rocket' },
  懒: { 疯: 'Champion Slacker', 懒: 'Melted Into the Chair', 暖: 'Lukewarm Blanket Burrito', 拧: 'Lying Flat, With Principles' },
  暖: { 疯: 'Big-Hearted Loudmouth', 懒: 'Slow-Burn Little Sun', 暖: 'Walking Hot-Water Bottle', 拧: 'Tough-Talking Softie' },
  拧: { 疯: 'Stubbornly Happy Alien', 懒: 'Defiant Couch Immortal', 暖: 'Frosty Shell, Gooey Center', 拧: 'World’s Most Contrary' },
};
const LINES_EN = {
  疯: ['When you walk in, even the pool wants to jump first.', 'Tuantuan quietly put the valuables away.'],
  懒: ['Tonight’s mission: sit. Then keep sitting.', 'You’re the quietest breeze in the whole hutong.'],
  暖: ['With you around, even the ginkgo leaves fall politely.', 'Tuantuan wants to share half a scarf with you.'],
  拧: ['No means no, and pretty means pretty.', 'Your principles run deeper than the pool.'],
};
// saved cards (tiaohai.cards) keep the Chinese title as their key, so the collection survives a language switch
const RARE = { title: '黑板守护神', title_en: 'Guardian of the Blackboard', emoji: '🌟', line: L('三千人里难遇一位。今晚的黑板，为你发光。', 'One in three thousand. Tonight the blackboard shines for you.'), rare: true };
const showTitle = (zh) => { if (!isEn) return zh; if (zh === RARE.title) return RARE.title_en; for (const a of Object.keys(TITLE)) for (const b of Object.keys(TITLE[a])) if (TITLE[a][b] === zh) return TITLE_EN[a][b]; return zh; };

const Q = [
  { q: '鳄搭子递给你一杯，没说是什么。你先——', qe: 'The croc hands you a glass and won’t say what it is. First you—', opts: [
    { t: '凑近闻一闻', te: 'take a sniff', ax: { 暖: 1, 拧: 1 }, w: { 1: 2, 3: 1 }, r: '团团：谨慎派。鳄搭子在偷笑。', re: 'Tuantuan: The cautious type. The croc is snickering.' },
    { t: '怼回去：「你先喝」', te: 'snap back: “You drink first”', ax: { 拧: 2, 疯: 1 }, w: { 5: 2, 2: 1 }, r: '团团：气氛突然很有戏。', re: 'Tuantuan: Ooh, now there’s drama.' },
    { t: '先拍照发朋友圈', te: 'post a photo first', ax: { 疯: 2 }, w: { 6: 2, 2: 1 }, r: '团团：出片比喝到重要，我懂。', re: 'Tuantuan: The pic matters more than the drink. I get it.' },
    { t: '趁人不注意倒进海里', te: 'tip it into the sea when no one’s looking', ax: { 疯: 1, 拧: 1, 懒: 1 }, w: { 4: 1, 7: 2 }, r: '团团：海：？？？', re: 'Tuantuan: The sea: ???' },
  ] },
  { q: '跳进海里，你的第一句话是——', qe: 'You jump in the sea. Your first words are—', opts: [
    { t: '「我的手机！！」', te: '“My phone!!”', ax: { 拧: 2 }, w: { 6: 2, 4: 1 }, r: '团团：手机已经替你游走了。', re: 'Tuantuan: Your phone already swam off without you.' },
    { t: '「好凉好凉好凉」', te: '“Cold cold cold”', ax: { 疯: 1, 暖: 1 }, w: { 7: 2, 2: 1 }, r: '团团：很诚实，水也听见了。', re: 'Tuantuan: Honest. The water heard you too.' },
    { t: '「再来一次！」', te: '“Again!”', ax: { 疯: 2 }, w: { 5: 2, 3: 1 }, r: '团团：台阶在那边，别太上头。', re: 'Tuantuan: The stairs are over there. Don’t get carried away.' },
    { t: '（不说话，直接漂着）', te: '(say nothing, just float)', ax: { 懒: 2 }, w: { 1: 2, 6: 1 }, r: '团团：高手已经在水面睡着了。', re: 'Tuantuan: A true master, asleep on the surface.' },
  ] },
  { q: '兔妹和狗哥同时约你，你的借口是——', qe: 'Bunny Mei and Brother Dog both ask you out at once. Your excuse—', opts: [
    { t: '「我在开会。」', te: '“I’m in a meeting.”', ax: { 拧: 2 }, w: { 4: 2, 5: 1 }, r: '团团：在池子里开会是吧。', re: 'Tuantuan: A meeting. In the pool. Sure.' },
    { t: '「我被银杏叶埋了。」', te: '“I’m buried under ginkgo leaves.”', ax: { 疯: 1, 懒: 1 }, w: { 2: 2, 1: 1 }, r: '团团：这个借口我记下了。', re: 'Tuantuan: I’m stealing that excuse.' },
    { t: '「都去，我会分身。」', te: '“Both. I can clone myself.”', ax: { 暖: 2 }, w: { 3: 2, 4: 1 }, r: '团团：分身请自备口粮。', re: 'Tuantuan: Clones bring their own snacks.' },
    { t: '已读不回', te: 'leave them on read', ax: { 懒: 2 }, w: { 6: 2, 7: 1 }, r: '团团：沉默是今晚的金。', re: 'Tuantuan: Silence is tonight’s gold.' },
  ] },
  { q: '点唱机只剩最后一首歌，你希望它是——', qe: 'The jukebox has one song left. You want it to be—', opts: [
    { t: '循环八百遍的神曲', te: 'the banger you’ve looped 800 times', ax: { 疯: 2 }, w: { 5: 1, 2: 2 }, r: '团团：全院的耳朵都在发抖。', re: 'Tuantuan: Every ear in the yard is trembling.' },
    { t: '下雨天的老歌', te: 'an old rainy-day song', ax: { 暖: 1, 懒: 1 }, w: { 1: 2, 3: 1 }, r: '团团：窗外正好有银杏叶。', re: 'Tuantuan: And there are ginkgo leaves outside the window.' },
    { t: '谁都没听过的冷门', te: 'a deep cut nobody’s heard', ax: { 拧: 2 }, w: { 5: 2, 4: 1 }, r: '团团：品味高到鳄搭子都在查歌名。', re: 'Tuantuan: Taste so niche the croc is googling the title.' },
    { t: '全场一起大合唱', te: 'a song the whole place sings along to', ax: { 暖: 2 }, w: { 3: 2, 7: 1 }, r: '团团：我先把嗓子清一清。', re: 'Tuantuan: Let me clear my throat.' },
  ] },
];
const SAME = isEn
  ? { 疯: 'Tuantuan: Wild again! We’ll need more water in the pool tonight.', 懒: 'Tuantuan: Lying flat tonight? Fine, flip the card lying down.', 暖: 'Tuantuan: Two sweet answers in a row, I’m melting.', 拧: 'Tuantuan: Stubborn again. Respect.' }
  : { 疯: '团团：又一个疯的，今晚池子要加水了。', 懒: '团团：你今晚是想躺平？可以，躺着翻牌。', 暖: '团团：连着两个暖心选项，我要被你融化了。', 拧: '团团：又是倔脾气，我服。' };
const qt = (s) => (isEn ? s.qe : s.q), ot = (o) => (isEn ? o.te : o.t), rt = (o) => (isEn ? o.re : o.r);
// drink fields in the current language
// the English version has its own craft-beer menu in the same slots (see menu.json)
const dn = (d) => (isEn ? d.name_en : d.name), dstyle = (d) => (isEn && d.style_en) || d.style, dem = (d) => (isEn ? d.emoji_en : d.emoji), abv = (d) => (isEn ? d.abv_en : d.abv), dkw = (d) => (isEn ? d.keywords_en : d.keywords), dpitch = (d) => (isEn ? d.pitch_en : d.pitch), dstory = (d) => (isEn ? d.story_en : d.story);

const POOLS = { 都行: (all) => all, 低度: (all) => all.filter((d) => abv(d) <= 5), 不喝酒: (all) => all.filter((d) => abv(d) === 0) };
const POOL_EN = { 都行: 'Anything', 低度: 'Light', 不喝酒: 'No alcohol' };

export function evaluate(answers, mode = '都行', rng = Math.random) {
  const ax = { 疯: 0, 懒: 0, 暖: 0, 拧: 0 }; const sc = {};
  const pool = POOLS[mode](MENU.items); pool.forEach((d) => (sc[d.n] = 0));
  for (const o of answers) { for (const [k, v] of Object.entries(o.ax)) ax[k] += v; for (const [n, v] of Object.entries(o.w)) if (n in sc) sc[n] += v; }
  const ranked = [...AX].sort((a, b) => ax[b] - ax[a] || a.localeCompare(b));
  const a1 = ranked[0], a2 = ax[ranked[1]] > 0 ? ranked[1] : ranked[0];
  const best = Math.max(...Object.values(sc)); const tops = pool.filter((d) => sc[d.n] === best);
  const drink = tops[Math.floor(rng() * tops.length)];
  const rest = pool.filter((d) => d.n !== drink.n).sort((a, b) => sc[b.n] - sc[a.n] || a.n - b.n).slice(0, 2);
  const persona = { key: a1 + a2, title: TITLE[a1][a2], emoji: AX_EMOJI[a1], line: (isEn ? LINES_EN : LINES)[a1][Math.floor(rng() * 2)] };
  const lucky = Math.max(18, Math.min(99, Math.round(24 + (best / (answers.length * 2)) * 62 + (rng() - 0.5) * 36)));
  return { drink, rest, persona, lucky, ax };
}
export const TITLE_COUNT = AX.length * AX.length + 1;

const luckyText = (n) => (n >= 90 ? L('天生一对，别问，就是它。', 'A match made in heaven. Don’t ask, it’s this one.') : n >= 70 ? L('很合拍，放心点。', 'Great fit, order with confidence.') : n >= 45 ? L('有点缘分，试试看。', 'Some chemistry, give it a try.') : L('缘分偏薄——但团团觉得你们可以聊聊。', 'Not much chemistry — but Tuantuan thinks you two should talk.'));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = { get: () => { try { return JSON.parse(localStorage.getItem('tiaohai.cards') || '[]'); } catch { return []; } }, add: (k) => { try { const s = store.get(); if (s.includes(k)) return false; s.push(k); localStorage.setItem('tiaohai.cards', JSON.stringify(s)); return true; } catch { return false; } } };
function ding() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); [880, 1318].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.09); g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.09 + 0.5); o.connect(g).connect(c.destination); o.start(c.currentTime + i * 0.09); o.stop(c.currentTime + i * 0.09 + 0.55); }); } catch {} }
function petals(host, gold) {
  if (calm()) return; const layer = el('div', 'petals'); host.appendChild(layer);
  for (let i = 0; i < 26; i++) { const p = el('span', 'petal' + (gold ? ' gold' : ''), gold ? '✦' : '🍂'); p.style.left = Math.random() * 100 + '%'; p.style.animationDelay = Math.random() * 0.7 + 's'; p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's'; layer.appendChild(p); }
  setTimeout(() => layer.remove(), 4200);
}

export function openMood(host, { onShowMenu, onClose, onShare, onOrder }) {
  const answers = []; let mode = '都行', step = 0, busy = false;
  host.textContent = ''; const root = el('div', 'mood'); host.appendChild(root);
  const avatar = tuantuanAvatar();
  // the live 3D bust sits in the first bubble on screen; any second bubble gets the round picture
  const face = () => { if (!avatar.el.isConnected) return avatar.el; const i = el('img', 'cat-face'); i.src = '/assets/portraits/tuantuan-avatar.webp'; i.alt = L('团团', 'Tuantuan'); return i; };
  const say = (t, cls) => { const b = el('div', 'cat-say' + (cls ? ' ' + cls : '')); b.append(face(), el('span', 'cat-text', t)); return b; };

  function intro() {
    root.textContent = ''; busy = false; answers.length = 0; step = 0;
    root.append(el('h3', 'mood-h', L('团团的怪问题', 'Tuantuan’s Odd Questions')), say(L('四个离谱小问题，不问你爱喝什么。答完，你来翻一张牌。', 'Four ridiculous little questions, none about what you like to drink. Then you flip a card.')));
    root.append(el('div', 'mood-sub', L('今晚酒量', 'Tonight’s limit')));
    const chips = el('div', 'mood-opts');
    for (const m of Object.keys(POOLS)) { const b = el('button', 'opt chip' + (m === mode ? ' sel' : ''), isEn ? POOL_EN[m] : m); b.setAttribute('aria-pressed', m === mode); b.onclick = () => { mode = m; intro(); root.querySelector('.chip.sel')?.focus(); }; chips.appendChild(b); }
    root.appendChild(chips);
    const go = el('button', 'primary big', L('开始翻牌', 'Start')); go.onclick = ask;
    const row = el('div', 'mood-actions spread'); const gal = el('button', 'link', L(`我的牌册 ${store.get().length}/${TITLE_COUNT}`, `My cards ${store.get().length}/${TITLE_COUNT}`)); gal.onclick = gallery; const skip = el('button', 'link', L('先逛逛', 'Just looking')); skip.onclick = onClose; row.append(gal, skip);
    root.append(go, row); go.focus(); avatar.react('wave');
  }
  function gallery() {
    root.textContent = ''; const have = store.get();
    root.append(el('h3', 'mood-h', L(`我的牌册 ${have.length}/${TITLE_COUNT}`, `My cards ${have.length}/${TITLE_COUNT}`)));
    const grid = el('div', 'gallery');
    const all = [...AX.flatMap((a) => AX.map((b) => TITLE[a][b])), RARE.title];
    all.forEach((t) => grid.appendChild(el('div', 'gcard' + (have.includes(t) ? ' got' : '') + (t === RARE.title ? ' rare' : ''), have.includes(t) ? showTitle(t) : '？？？')));
    root.appendChild(grid); const b = el('button', null, L('返回', 'Back')); b.onclick = intro; root.appendChild(b); b.focus();
  }
  function ask() {
    root.textContent = ''; busy = false; const s = Q[step];
    const dots = el('div', 'mood-dots'); Q.forEach((_, i) => dots.appendChild(el('span', 'dot-s' + (i <= step ? ' on' : ''))));
    root.append(el('div', 'mood-prog', L(`第 ${step + 1} / ${Q.length} 题`, `Question ${step + 1} / ${Q.length}`)), dots, say(qt(s)));
    const box = el('div', 'mood-opts col'); const slot = el('div', 'react-slot'); slot.setAttribute('aria-live', 'polite');
    s.opts.forEach((o) => { const b = el('button', 'opt wide', ot(o)); b.onclick = () => pick(o, b, box, slot); box.appendChild(b); });
    root.append(box, slot);
    const row = el('div', 'mood-actions spread'); const back = el('button', 'link', step ? L('上一题', 'Previous') : L('返回', 'Back')); back.onclick = () => { if (busy) return; if (step) { step--; answers.pop(); ask(); } else intro(); }; row.appendChild(back); root.appendChild(row);
    box.firstChild.focus();
  }
  function pick(o, btn, box, slot) {
    if (busy) return; busy = true; answers[step] = o; btn.classList.add('chosen'); [...box.children].forEach((b) => { if (b !== btn) b.classList.add('dim'); b.disabled = true; });
    let line = rt(o); const prev = answers[step - 1];
    if (prev) { const pa = Object.entries(prev.ax).sort((a, b) => b[1] - a[1])[0][0], ca = Object.entries(o.ax).sort((a, b) => b[1] - a[1])[0][0]; if (pa === ca) line = SAME[ca]; }
    slot.textContent = ''; slot.appendChild(say(line, 'pop')); navigator.vibrate?.(15); avatar.react('nod');
    setTimeout(() => { if (step < Q.length - 1) { step++; ask(); } else cards(); }, calm() ? 0 : 1100);
  }
  function cards() {
    root.textContent = ''; busy = false;
    root.append(say(L('题答完了。三张牌背朝上，凭直觉挑一张。', 'All done. Three cards face down: trust your gut and pick one.')));
    const row = el('div', 'card-row');
    for (let i = 0; i < 3; i++) { const c = el('button', 'back-card', '🎴'); c.setAttribute('aria-label', L(`第 ${i + 1} 张牌`, `Card ${i + 1}`)); c.style.animationDelay = i * 0.12 + 's'; c.onclick = () => flip(c, row); row.appendChild(c); }
    root.appendChild(row); row.firstChild.focus();
  }
  function flip(c, row) {
    if (busy) return; busy = true; [...row.children].forEach((x) => { if (x !== c) x.classList.add('gone'); }); c.classList.add('flipping'); navigator.vibrate?.(30);
    setTimeout(result, calm() ? 0 : 1000);
  }
  function result() {
    root.textContent = '';
    const r = evaluate(answers, mode); const rare = Math.random() < 0.03; const p = rare ? RARE : r.persona; const d = r.drink;
    const fresh = store.add(p.title);
    const card = el('div', 'result-card pop' + (rare ? ' rare' : '')); card.setAttribute('role', 'status');
    if (fresh) card.appendChild(el('div', 'new-tag', L('新！已收进牌册', 'New! Added to your cards')));
    card.append(el('div', 'result-emoji', p.emoji), el('div', 'result-title', L(`「${p.title}」`, `“${showTitle(p.title)}”`)), el('div', 'result-line', p.line));
    const dk = el('div', 'drink main'); const b = el('div', 'drink-b');
    const kw = el('div', 'kw'); dkw(d).slice(0, 4).forEach((k) => kw.appendChild(el('span', null, k)));
    const where = d.wallBoard ? L(`墙上 ${d.wallBoard} 号牌`, `board no. ${d.wallBoard} on the wall`) : L('店里新款，问问店员', 'new at the bar, ask the staff');
    b.append(el('div', 'drink-name', `${dem(d)} ${dn(d)}`), el('div', 'drink-meta', `${dstyle(d)} · ${abv(d) === 0 ? L('无酒精', 'alcohol-free') : abv(d) + '% vol'} · ${where}`), kw, el('div', 'drink-blurb', dpitch(d)), el('div', 'drink-story', dstory(d))); dk.appendChild(b); card.appendChild(dk);
    card.append(el('div', 'lucky', L(`缘分指数 ${rare ? 100 : r.lucky}%（纯属好玩）`, `Match score ${rare ? 100 : r.lucky}% (just for fun)`)), el('div', 'lucky-t', rare ? L('稀有牌，天选之人。', 'A rare card. The chosen one.') : luckyText(r.lucky)));
    const why = el('div', 'why'); why.append(el('div', 'why-h', L('你的答案', 'Your answers')), el('div', 'why-b', answers.map((o) => ot(o).replace(/[「」（）()“”]/g, '')).join(' → '))); card.appendChild(why);
    root.appendChild(card); petals(root, rare); ding(); navigator.vibrate?.([20, 40, 20]);
    const host = el('div', 'cat-say'); host.append(face(), el('span', 'cat-text', rare ? L('天哪！稀有牌！', 'No way! A rare card!') : L('就是它了，干杯～', 'This is the one. Cheers~'))); root.insertBefore(host, card); avatar.react('cheer');
    if (r.rest.length) root.append(el('div', 'mood-sub', L('备选牌', 'Runners-up')), ...r.rest.map((x) => { const c = el('div', 'drink'); const bb = el('div', 'drink-b'); bb.append(el('div', 'drink-name', `${dem(x)} ${dn(x)}`), el('div', 'drink-meta', `${dstyle(x)} · ${abv(x) === 0 ? L('无酒精', 'alcohol-free') : abv(x) + '% vol'}${x.wallBoard ? L(' · 墙上 ' + x.wallBoard + ' 号', ` · board no. ${x.wallBoard}`) : ''}`), el('div', 'drink-blurb', dpitch(x))); c.appendChild(bb); return c; }));
    root.append(el('p', 'mood-note', L('这些是常见的精酿风格，只是游戏里的酒单。这只是游戏里的建议，选什么由你；有忌口或酒精方面的顾虑，请先问店员。点「就它了 · 下单」会把你的昵称和这款酒发到全场的点单栏（吧台小票和点单提醒），你的答案不会发出去，只在你本机。', 'These are classic craft-beer styles on the game’s own menu. This is just a suggestion from a game, the choice is yours; if you have dietary or alcohol concerns, ask the staff first. “This one · Order” posts your nickname and this drink to everyone’s order board (the bar ticket and order alert). Your answers are not sent anywhere; they stay on your device.')));
    const act = el('div', 'mood-actions');
    const again = el('button', null, L('再翻一次', 'Try again')); again.onclick = intro;
    const all = el('button', null, L('全部酒单', 'Full menu')); all.onclick = onShowMenu;
    const share = el('button', null, L('发到公屏', 'Share to chat')); share.onclick = () => { const ok = onShare && onShare(L(`${p.emoji}「${p.title}」· 今晚喝 ${d.name} · 缘分指数 ${rare ? 100 : r.lucky}%`, `${p.emoji} “${showTitle(p.title)}” · drinking ${d.name_en} tonight · match ${rare ? 100 : r.lucky}%`)); share.textContent = ok ? L('已发送', 'Sent') : L('发送失败，稍后再试', 'Couldn’t send, try again later'); share.disabled = !!ok; };
    const ok = el('button', 'primary', L('就它了 · 下单', 'This one · Order')); ok.onclick = () => { onOrder?.(d); onClose(); };
    act.append(again, all, share, ok); root.appendChild(act); ok.focus();
  }
  intro();
}
