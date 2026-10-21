import * as R from './rules.js';
import { createDiceTray } from './dice3d.js';
import { wheel } from './wheel.js';
import { TURN_MS, PI_MS, SHOW_MS, RESULT_MS } from './game.js';
import { L } from '../i18n.js';

// The 吹牛 panel: a bottom sheet over the 3D view (the yard stays visible above it).

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export function dieEl(v, cls = '') {
  const d = document.createElement('span'); d.className = `die f${v} ${cls}`; d.setAttribute('aria-label', L(`${v} 点`, `${v} pips`));
  for (let i = 0; i < 9; i++) { const p = document.createElement('i'); if (PIPS[v]?.includes(i)) p.className = 'pip'; d.appendChild(p); }
  return d;
}
const AV = { dog_ge: '🐶', rabbit_mei: '🐰', chicken_jibie: '🐥', cat_tuantuan: '🐱', croc_edazi: '🐊' };
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountDiceUI({ dice, me, onStart }) {
  const el = h('section', 'dice-panel'); el.id = 'dice-panel'; el.hidden = true; el.setAttribute('aria-label', L('吹牛骰子', 'Liar’s dice')); el.setAttribute('aria-live', 'polite');
  document.getElementById('hud').appendChild(el);
  let sel = { q: 4, f: 5, zhai: false }, selFor = '', collapsed = false, timerBar = null, secs = null, lastState = null, tray = null;
  let choosing = null, check = { f: 5, zhai: false }; // mode picker callback; the 线下玩 counting helper
  const getTray = () => tray || (tray = createDiceTray());

  const nickOf = (s, id) => s.players.find((p) => p.id === id)?.nick || s.tally[id]?.nick || L('有人', 'Someone');
  function renderChooser() {
    el.hidden = false; el.textContent = ''; el.classList.remove('collapsed'); document.body.classList.add('dice-open');
    const head = h('div', 'dp-head'); head.append(h('span', 'dp-title', L('🎲 开一桌，玩哪种？', '🎲 New table: which game?')), h('span', 'spacer'));
    const x = h('button', 'dp-x', '×'); x.setAttribute('aria-label', L('取消', 'Cancel')); x.onclick = () => { choosing = null; render(); }; head.append(x); el.append(head);
    const cards = h('div', 'dp-modes');
    for (const [mode, icon, title, desc] of [
      ['offline', '🍻', L('线下玩', 'Table play'), L('大家围坐一起自己喊数。App 只帮你摇骰盅、一起开盅、数点数。不计时，全手动。', 'Sit together and call your bids out loud. The app just shakes the cups, opens them together and counts. No timer, all by hand.')],
      ['online', '🎲', L('广东骰', 'Canton Dice'), L('在 App 里叫数：人头一、斋飞、开 / 劈 / 反劈，每回合 60 秒，自动算谁喝几杯。一个人也能和团团、鳄搭子玩。', 'Bid in the app: one per head, pure / wild, open / double / re-double, 60 s a turn, and it works out who drinks how many. On your own you can play Tuantuan and Croc Buddy.')],
    ]) {
      const b = h('button', 'dp-modecard ' + mode); b.type = 'button';
      b.append(h('span', 'dp-mc-icon', icon), h('b', 'dp-mc-title', title), h('span', 'dp-mc-desc', desc));
      b.onclick = () => { const cb = choosing; choosing = null; cb?.(mode); };
      cards.append(b);
    }
    el.append(cards);
  }
  function render(s = dice.state) {
    lastState = s;
    if (choosing && (!s || s.over)) return renderChooser();
    document.body.classList.toggle('dice-open', !!s);
    if (!s) { el.hidden = true; if (tray) { tray.dispose(); tray = null; } return; } // free the tray's WebGL context while no table is open
    el.hidden = false; el.textContent = ''; el.classList.toggle('collapsed', collapsed);
    const offline = s.mode === 'offline';
    const meIn = s.players.some((p) => p.id === me.id), n = s.players.length, lb = s.bids[s.bids.length - 1] || null;
    const cur = s.players[s.turn], myTurn = meIn && s.phase === 'bidding' && cur?.id === me.id;
    // ---- header
    const head = h('div', 'dp-head');
    head.append(h('span', 'dp-title', offline ? (s.over ? L('🍻 线下玩 · 散桌', '🍻 Table play · done') : L(`🍻 线下玩 · 第 ${s.n} 盅`, `🍻 Table play · cup ${s.n}`)) : s.over ? L('🎲 广东骰 · 战报', '🎲 Canton Dice · results') : L(`🎲 广东骰 · 第 ${s.n} 局`, `🎲 Canton Dice · round ${s.n}`)));
    if (!s.over) head.append(h('span', 'dp-rule', offline ? L(`${n} 人 · 自己喊，App 只管摇和开`, `${n} players · call it yourselves, the app just shakes and opens`) : L(`${n} 人 · 起叫 ${R.openText(n)}`, `${n} players · opening bid ${R.openText(n)}`)));
    const fold = h('button', 'dp-fold', collapsed ? L('展开', 'Expand') : L('收起', 'Collapse')); fold.onclick = () => { collapsed = !collapsed; render(); };
    const close = h('button', 'dp-x', '×'); close.setAttribute('aria-label', s.over ? L('关闭', 'Close') : dice.isHost ? L('结束这桌', 'End this table') : L('离开这桌', 'Leave this table'));
    close.onclick = () => { if (!s.over && !offline && !confirm(dice.isHost ? L('结束这桌并结算？', 'End this table and tally up?') : L('不玩了？下桌后这局按跑路处理', 'Quit? Leaving now counts as running out on this round'))) return; dice.close(); };
    head.append(h('span', 'spacer'), fold, close); el.append(head);
    if (collapsed) { el.append(statusLine(s, lb, cur, meIn)); return; }
    // ---- players
    const row = h('div', 'dp-seats');
    for (const p of s.players) {
      const c = h('div', 'dp-seat'); const t = s.tally[p.id];
      const turn = s.phase === 'bidding' && cur?.id === p.id;
      if (turn) c.classList.add('turn');
      if (p.id === me.id) c.classList.add('me');
      if (s.call && (s.call.by === p.id || s.call.bidder === p.id) && (s.phase === 'pi' || s.phase === 'show')) c.classList.add('hot');
      const av = h('span', 'dp-av', AV[p.av] || '🙂');
      const name = h('b', 'dp-seat-name', p.nick); name.title = p.nick;
      const sub = h('span', 'dp-seat-sub');
      if (offline) sub.textContent = s.phase === 'show' || s.phase === 'opened' ? (s.dice[p.id] ? L('✅ 已开', '✅ open') : L('… 开盅中', '… opening')) : L('🎲 摇好了', '🎲 shaken');
      else if (s.phase === 'result' && s.result?.loser === p.id) { // don't spoil it before the cups are up
        const d = `${0.65 + s.players.length * 0.4}s`, pre = h('span', 'cups pre', `🍺 ×${(t?.cups || 0) - s.result.cups}`), post = h('span', 'cups post', `🍺 ×${t?.cups || 0}`);
        pre.style.animationDelay = post.style.animationDelay = d; sub.append(pre, post);
      } else sub.textContent = turn ? L('叫数中…', 'bidding…') : `🍺 ×${t?.cups || 0}`;
      const tags = h('span', 'dp-seat-tags'); if (p.id === me.id) tags.append(h('i', 'tag me', L('你', 'you'))); if (p.bot) tags.append(h('i', 'tag bot', L('陪玩', 'bot')));
      c.append(av, h('span', 'dp-seat-txt'), tags); c.children[1].append(name, sub);
      row.append(c);
    }
    if (!s.over) el.append(row);
    // ---- body by phase
    if (s.over) return offline ? renderOfflineOver(s) : renderOver(s);
    if (offline) return renderOffline(s, meIn);
    const timerRow = () => { const tw = h('div', 'dp-timerrow'); timerBar = h('div', 'dp-timer'); timerBar.append(h('i')); secs = h('span', 'dp-secs'); tw.append(timerBar, secs); return tw; };
    if (s.phase === 'show' || s.phase === 'result') { el.append(statusLine(s, lb, cur, meIn), timerRow()); tick(); return renderReveal(s, lb); }
    // bidding / 劈: two columns — my cup on the left, the table's call and my controls on the right
    const main = h('div', 'dp-main'); el.append(main);
    const left = h('div', 'dp-left'); main.append(left);
    const myDice = dice.myDice;
    if (meIn && myDice) {
      const box = h('div', 'dp-cupbox square'); box.append(h('span', 'dp-cuplabel', L('🤫 你的骰', '🤫 Your dice')), straightNote());
      const t = getTray(); box.append(t.el); left.append(box);
      const hl = myTurn ? sel : lb;
      t.mine(`${s.g}:${s.n}`, myDice, hl && R.norm(hl));
    } else left.append(h('p', 'dp-note', L('你在旁观，下一局自动入局。', 'You’re watching; you’ll join automatically next round.')));
    main.append(bidCard(s, lb, cur, meIn, myTurn), timerRow()); tick();
    if (s.bids.length > 1) { const hi = history(s); hi.classList.add('wide'); main.append(hi); }
    if (!meIn || !myTurn) return;
    // ---- my bid: 斋/飞 on top, then how many of what (dropdowns, no typing); one tap +1 个 / 人头一
    const key = s.g + ':' + s.n + ':' + s.bids.length;
    if (selFor !== key) {
      selFor = key; const z = lb ? R.norm(lb).zhai : false; const f = !z && sel.f === 1 ? 6 : sel.f;
      sel = R.minBidFor(f, z, lb, n) || R.minBidFor(6, z, lb, n) || R.minBidFor(6, !z, lb, n) || sel;
    }
    const zhai = R.norm(sel).zhai;
    const minQ = R.minBidFor(sel.f, zhai, lb, n)?.q ?? n * 5 + 1;
    if (sel.q < minQ) sel.q = minQ;
    const form = h('div', 'dp-bidform steps');
    const s1 = h('div', 'dp-steprow');
    const mode = h('div', 'dp-mode');
    for (const [z, label] of [[false, L('飞 · 1 当万能', 'Wild · 1s count as any')], [true, L('斋 · 1 不算', 'Pure · 1s don’t count')]]) {
      const b2 = h('button', 'dp-modebtn' + (zhai === z ? ' sel' : ''), label); b2.type = 'button';
      b2.onclick = () => { sel.zhai = z; if (!z && sel.f === 1) sel.f = 6; const m = R.minBidFor(sel.f, z, lb, n); if (m) sel.q = m.q; render(); };
      mode.append(b2);
    }
    s1.append(mode);
    const s2 = h('div', 'dp-steprow');
    // two inline wheels (no pop-up): swipe / scroll / tap — how many, and which face
    const qs = []; for (let q = minQ; q <= n * 5 + 1; q++) qs.push({ v: q, label: L(`${q} 个`, `${q}×`) });
    const qW = wheel({ items: qs, value: sel.q, label: L('叫几个', 'How many'), onPick: (v) => { sel.q = v; render(); } });
    const faces = (zhai ? [2, 3, 4, 5, 6, 1] : [2, 3, 4, 5, 6]).map((f) => ({ v: f, label: L(`${f} 点`, `${f}s`), node: dieEl(f, 'mini') }));
    const fW = wheel({ items: faces, value: sel.f, label: L('叫几点', 'Which face'), onPick: (v) => { sel.f = v; const m = R.minBidFor(sel.f, zhai, lb, n); if (m && !R.validBid(sel, lb, n)) sel.q = m.q; render(); } }); // keep the chosen count if it is still legal, else the cheapest legal one
    s2.append(qW.el, fW.el); queueMicrotask(() => { qW.sync(); fW.sync(); });
    form.append(s1, s2); form.classList.add('wide'); main.append(form);
    const ctr = h('div', 'dp-controls wide');
    if (lb) { // +1 个: same face, same 斋/飞, one more die
      const up = R.norm({ ...lb, q: lb.q + 1 });
      if (R.validBid(up, lb, n)) { const b4 = h('button', 'dp-plus1', L(`+1 个 → ${R.bidText(up)}`, `+1 → ${R.bidText(up)}`)); b4.onclick = () => dice.move('bid', up); ctr.append(b4); }
    } else { // the opener can shout 人头一
      const rt = { q: n, f: 1, zhai: true };
      if (R.validBid(rt, null, n)) { const b3 = h('button', 'dp-rentou', L(`人头一！（${n} 个 1）`, `One per head! (${n}× 1)`)); b3.onclick = () => dice.move('bid', rt); ctr.append(b3); }
    }
    const call = h('button', 'dp-call', L(`叫：${R.bidText(sel)}`, `Bid: ${R.bidText(sel)}`)); call.disabled = !R.validBid(sel, lb, n);
    call.onclick = () => dice.move('bid', R.norm(sel));
    ctr.append(call); main.append(ctr);
  }
  // the big "who bid what" card, with 劈 / 开 / 反劈 right next to it
  function bidCard(s, lb, cur, meIn, myTurn) {
    const n = s.players.length, card = h('div', 'dp-bigbid' + (s.phase === 'pi' ? ' hot' : ''));
    const left = h('div', 'dp-bb-left'), acts = h('div', 'dp-bb-acts');
    const showBid = (b) => {
      const nb = R.norm(b), main = h('div', 'dp-bb-main');
      main.append(h('span', 'dp-bb-q', L(`${nb.q} 个`, `${nb.q}×`)), dieEl(nb.f, 'big'), h('span', 'dp-badge ' + (nb.zhai ? 'zhai' : 'fei'), nb.zhai ? L('斋', 'pure') : L('飞', 'wild')));
      if (nb.f === 1 && nb.q === n) main.append(h('span', 'dp-badge rentou', L('人头一', 'one per head')));
      return main;
    };
    if (s.phase === 'pi') {
      const who = h('div', 'dp-bb-who'); who.append(h('b', 'dp-name', nickOf(s, s.call.by)), h('span', null, L(' 劈了 ', ' doubled ')), h('b', 'dp-name', nickOf(s, s.call.bidder)), h('span', null, L('！', '!')));
      left.append(who, showBid(lb));
      if (s.call.bidder === me.id) { const f = h('button', 'dp-fanpi', L('反劈！×4', 'Re-double! ×4')); f.onclick = () => dice.move('fanpi'); acts.append(f); }
      else acts.append(h('span', 'dp-bb-wait', L(`等 ${nickOf(s, s.call.bidder)} 反劈…`, `waiting for ${nickOf(s, s.call.bidder)} to re-double…`)));
    } else if (lb) {
      const who = h('div', 'dp-bb-who'); who.append(h('b', 'dp-name', nickOf(s, lb.id) + (lb.id === me.id ? L('（你）', ' (you)') : '')), h('span', null, L(' 叫：', ' bid:')));
      left.append(who, showBid(lb));
      if (meIn && lb.id !== me.id) { const p = h('button', 'dp-pi', L('劈！×2', 'Double! ×2')); p.title = L(`劈 ${nickOf(s, lb.id)}：赌他吹牛，输的喝 2 杯`, `Double on ${nickOf(s, lb.id)}: bet they’re bluffing, the loser drinks 2`); p.onclick = () => dice.move('pi'); acts.append(p); }
      if (myTurn && lb.id !== me.id) { const k = h('button', 'dp-kai', L('开 ×1', 'Open ×1')); k.title = L('开上家：输的喝 1 杯', 'Open the last bid: the loser drinks 1'); k.onclick = () => dice.move('kai'); acts.append(k); }
    } else {
      const who = h('div', 'dp-bb-who'); if (cur?.id === me.id) who.append(h('b', 'dp-name', L('轮到你起叫！', 'Your opening bid!'))); else who.append(h('span', null, L('等 ', 'Waiting for ')), h('b', 'dp-name', cur?.nick || ''), h('span', null, L(' 起叫…', ' to open…')));
      left.append(who, h('div', 'dp-bb-rule', L(`起叫：${R.openText(n)}`, `Opening bid: ${R.openText(n)}`)));
    }
    card.append(left); if (acts.childElementCount) card.append(acts);
    if (s.phase === 'bidding' && (lb || cur?.id !== me.id)) { const tn = h('div', 'dp-bb-turn'); tn.append(h('span', null, L('👉 轮到 ', '👉 Turn: ')), h('b', null, cur?.id === me.id ? L('你', 'you') : cur?.nick || '')); card.append(tn); }
    return card;
  }
  // "摇出顺子 1 2 3 4 5 → 重摇" on my cup when the deal shook it again (only I see my cup)
  function straightNote() {
    const t = dice.myTossed; if (!t.length) return document.createTextNode('');
    return h('span', 'dp-straight', L(`顺子 ${t[t.length - 1].slice().sort((a, b) => a - b).join(' ')} → 重摇${t.length > 1 ? ` ×${t.length}` : ''}`, `straight ${t[t.length - 1].slice().sort((a, b) => a - b).join(' ')} → reshaken${t.length > 1 ? ` ×${t.length}` : ''}`));
  }
function history(s) {
    const row = h('div', 'dp-history');
    for (const b of s.bids.slice(-7, -1)) { const c = h('span', 'dp-hchip'); c.append(h('b', null, nickOf(s, b.id)), h('span', null, ' ' + R.bidText(b))); row.append(c); }
    return row;
  }
  // ---- 线下玩: shake, open together, count
  function renderOffline(s, meIn) {
    const st = h('div', 'dp-status');
    if (s.phase === 'rolled') st.append(h('span', null, L('摇好了！看自己的骰，大家当面喊数；有人喊「开」就点下面。', 'Shaken! Check your dice and call bids out loud; when someone shouts “open”, tap below.')));
    else if (s.phase === 'show') st.append(h('b', null, L(`${nickOf(s, s.call?.by)} 开盅！`, `${nickOf(s, s.call?.by)} opens the cups!`)));
    else if (s.phase === 'opened') st.append(h('b', null, L('开盅！数一数：', 'Cups up! Count them:')));
    el.append(st);
    if (s.phase === 'rolled') {
      st.remove(); const main = h('div', 'dp-main'); el.append(main); const left = h('div', 'dp-left'); main.append(left);
      if (meIn && dice.myDice) { const box = h('div', 'dp-cupbox square'); box.append(h('span', 'dp-cuplabel', L('🤫 你的骰', '🤫 Your dice')), straightNote()); const t = getTray(); box.append(t.el); left.append(box); t.mine(`${s.g}:${s.n}`, dice.myDice, null); }
      else left.append(h('p', 'dp-note', L('你在旁观，下一盅自动入局。', 'You’re watching; you’ll join automatically next cup.')));
      const card = h('div', 'dp-bigbid calm'); const lt = h('div', 'dp-bb-left'); lt.append(h('div', 'dp-bb-who', L('摇好了！', 'Shaken!')), h('div', 'dp-bb-rule', L('看自己的骰，大家当面喊数。有人喊「开」就点下面，全桌一起开盅。', 'Check your dice and call bids out loud. When someone shouts “open”, tap below and the whole table opens together.'))); card.append(lt); main.append(card);
      if (meIn) { const b = h('button', 'dp-pi big', L('开！全桌开盅', 'Open! All cups up')); b.onclick = () => dice.move('open'); const c = h('div', 'dp-controls wide'); c.append(b); main.append(c); }
      return;
    }
    if (s.phase === 'show') return renderReveal(s, null);
    // opened: everyone's dice + a counter for whatever was shouted
    const t = getTray(), box = h('div', 'dp-cupbox all'); box.append(t.el); el.append(box);
    t.all(`${s.g}:${s.n}:all`, s.players.map((p) => ({ name: p.nick, dice: s.dice[p.id] || [] })), R.norm(check));
    const all = Object.values(s.dice), cnt = R.countFace(all, check.f, R.norm(check).zhai);
    const form = h('div', 'dp-bidform');
    const fW = wheel({ items: [2, 3, 4, 5, 6, 1].map((f) => ({ v: f, label: L(`${f} 点`, `${f}s`), node: dieEl(f, 'mini') })), value: check.f, label: L('数哪个点', 'Count which face'), onPick: (v) => { check.f = v; render(); } });
    const fBox = fW.el; queueMicrotask(() => fW.sync());
    const mBox = h('div', 'dp-field'); mBox.append(h('span', 'dp-flabel', L('1 算不算', 'Do 1s count?'))); const mode = h('div', 'dp-mode');
    for (const [z, label] of [[false, L('飞 · 1 万能', 'Wild · 1s are any')], [true, L('斋 · 1 不算', 'Pure · 1s don’t count')]]) { const b = h('button', 'dp-modebtn' + (R.norm(check).zhai === z ? ' sel' : ''), label); b.type = 'button'; b.disabled = check.f === 1 && !z; b.onclick = () => { check.zhai = z; render(); }; mode.append(b); }
    mBox.append(mode);
    const res = h('div', 'dp-count'); res.append(h('span', null, L('全桌一共 ', 'Whole table: ')), h('b', null, L(`${cnt} 个 ${check.f}`, `${cnt}× ${check.f}`)), h('span', null, check.f === 1 ? '' : R.norm(check).zhai ? L('（斋）', ' (pure)') : L('（1 当万能）', ' (1s wild)')));
    form.append(fBox, mBox, res); el.append(form);
    const again = h('button', 'dp-call', L('再摇一盅 🎲', 'Shake again 🎲')); again.onclick = () => dice.move('reroll');
    const c = h('div', 'dp-controls'); c.append(again); el.append(c);
  }
  function renderOfflineOver(s) {
    const box = h('div', 'dp-over'); box.append(h('p', 'dp-king', L('🍻 这桌散了，下次再摇', '🍻 Table’s done, shake again next time')));
    if (s.why) box.append(h('p', 'dp-note', s.why));
    const again = h('button', 'dp-call', L('再开一桌', 'New table')); again.onclick = () => { dice.dismiss(); onStart?.(); };
    const ok = h('button', 'dp-step wide', L('关闭', 'Close')); ok.onclick = () => dice.dismiss();
    const btns = h('div', 'dp-controls'); btns.append(again, ok); box.append(btns); el.append(box);
  }
  function statusLine(s, lb, cur, meIn) {
    const st = h('div', 'dp-status'); const n = s.players.length;
    if (s.phase === 'bidding') {
      if (lb) { st.append(h('span', 'dp-bidder', nickOf(s, lb.id) + L('：', ': '))); st.append(h('b', 'dp-bid', R.bidText(lb))); }
      else st.append(h('span', null, L(`${cur?.nick || ''} 起叫（${R.openText(n)}）`, `${cur?.nick || ''} opens (${R.openText(n)})`)));
      st.append(h('span', 'dp-turn', cur?.id === me.id ? L(' · 轮到你！', ' · your turn!') : L(` · 轮到 ${cur?.nick || ''}`, ` · ${cur?.nick || ''}’s turn`)));
    } else if (s.phase === 'pi') {
      st.append(h('b', 'dp-hot', L(`${nickOf(s, s.call.by)} 劈了 ${nickOf(s, s.call.bidder)}！`, `${nickOf(s, s.call.by)} doubled ${nickOf(s, s.call.bidder)}!`)));
      st.append(h('span', null, s.call.bidder === me.id ? L(' 你敢反劈吗？（×4）', ' Dare to re-double? (×4)') : L(` 等 ${nickOf(s, s.call.bidder)} 反劈…`, ` waiting for ${nickOf(s, s.call.bidder)} to re-double…`)));
    } else if (s.phase === 'show') st.append(h('b', null, L('开盅！', 'Cups up!')));
    else if (s.phase === 'result' && s.result) {
      const r = s.result;
      st.classList.add('late'); st.style.animationDelay = `${0.65 + s.players.length * 0.4}s`; // after the cups are up
      st.classList.add('dp-verdict');
      const l1 = h('div', 'dp-v1'); l1.append(h('b', null, nickOf(s, r.bidder)), h('span', null, L(` 叫 ${R.bidText(r.bid)}，`, ` bid ${R.bidText(r.bid)}, `)), h('b', null, nickOf(s, r.caller)), h('span', null, L(` ${{ kai: '开', pi: '劈', fanpi: '反劈' }[r.kind]}！ 实际 `, ` ${{ kai: 'opened', pi: 'doubled', fanpi: 're-doubled' }[r.kind]}! Actually `)), h('b', 'dp-v-count', L(`${r.count} 个`, `${r.count}`)));
      const l2 = h('div', 'dp-v2'); l2.append(h('span', 'dp-v-loser', nickOf(s, r.loser)), h('span', null, L(` 喝 ${r.cups} 杯！`, ` drinks ${r.cups}!`)), h('span', null, ' 🍺'.repeat(Math.min(r.cups, 4))));
      st.append(l1, l2);
    }
    return st;
  }
  function renderReveal(s, lb) {
    const bid = s.result?.bid || lb, nb = bid && R.norm(bid);
    if (s.phase === 'result') { // everyone's dice are in: lift the cups in 3D
      const t = getTray(), box = h('div', 'dp-cupbox all'); box.append(t.el); el.append(box);
      t.all(`${s.g}:${s.n}:all`, s.players.map((p) => ({ name: p.nick, dice: s.dice[p.id] || [] })), nb);
      const gone = s.players.filter((p) => !s.dice[p.id]?.length); if (gone.length) el.append(h('p', 'dp-note', L(gone.map((p) => p.nick).join('、') + ' 掉线了，骰子不算', gone.map((p) => p.nick).join(', ') + ' dropped out, their dice don’t count')));
      const loser = s.mode === 'online' && s.result?.loser, delay = `${0.65 + s.players.length * 0.4}s`; // after the cups are up, like the verdict
      if (loser === me.id) {
        const b = h('button', 'dp-pi big dp-cheers', L('干了！继续！🍻', 'Bottoms up! Next! 🍻')); b.onclick = () => { b.disabled = true; b.textContent = L('咕咚咕咚…', 'Glug glug…'); dice.move('cheers'); };
        const c = h('div', 'dp-controls wide late'); c.style.animationDelay = delay; c.append(b); el.append(c);
      } else if (loser) { const w = h('p', 'dp-note dp-wait-cheers late', L(`等 ${nickOf(s, loser)} 干了这杯，下一局才开始…`, `Next round starts once ${nickOf(s, loser)} downs this one…`)); w.style.animationDelay = delay; el.append(w); }
      return;
    }
    const grid = h('div', 'dp-reveal');
    for (const p of s.players) {
      const r = h('div', 'dp-rrow'); r.append(h('span', 'dp-rname', p.nick));
      const d = s.dice[p.id];
      if (!d) r.append(h('span', 'dp-wait', L('🫳 开盅中…', '🫳 opening…')));
      else if (!d.length) r.append(h('span', 'dp-wait', L('掉线了，不算', 'dropped out, doesn’t count')));
      else r.append(h('span', 'dp-wait', L('✅ 已开', '✅ open')));
      grid.append(r);
    }
    el.append(grid);
  }
  function renderOver(s) {
    const list = Object.entries(s.tally).map(([id, t]) => ({ id, ...t })).sort((a, b) => b.cups - a.cups);
    const box = h('div', 'dp-over');
    if (s.why) box.append(h('p', 'dp-note', s.why));
    const king = list[0];
    box.append(h('p', 'dp-king', king && king.cups ? L(`🏆 今晚酒王：${king.nick}（${king.cups} 杯）`, `🏆 Tonight’s drinking king: ${king.nick} (${king.cups})`) : L('没人喝酒？再来！', 'Nobody drank? Again!')));
    const tbl = h('ol', 'dp-tally');
    for (const t of list) { const li = h('li'); li.append(h('b', 'dp-name', t.nick + (t.bot ? ' 🐾' : '')), h('span', null, t.cups ? L(` 喝 ${t.cups} 杯 `, ` drank ${t.cups} `) + '🍺'.repeat(Math.min(t.cups, 8)) : L(' 滴酒未沾 😎', ' stone-cold sober 😎'))); tbl.append(li); }
    box.append(tbl);
    const again = h('button', 'dp-call', L('再开一局', 'Play again')); again.onclick = () => { dice.dismiss(); onStart?.(); };
    const ok = h('button', 'dp-step wide', L('关闭', 'Close')); ok.onclick = () => dice.dismiss();
    const btns = h('div', 'dp-controls'); btns.append(again, ok); box.append(btns);
    el.append(box);
  }
  function tick() {
    const s = lastState; if (!timerBar || !s || !s.deadline) return;
    const total = { pi: PI_MS, show: SHOW_MS, result: RESULT_MS }[s.phase] || TURN_MS;
    const left = Math.max(0, s.deadline - Date.now());
    timerBar.firstChild.style.width = `${Math.min(100, (left / total) * 100)}%`;
    const low = s.phase === 'bidding' && left < 10000; timerBar.classList.toggle('low', low);
    if (secs) { secs.textContent = s.phase === 'bidding' || s.phase === 'pi' ? `⏱ ${Math.ceil(left / 1000)}s` : ''; secs.classList.toggle('low', low); }
  }
  setInterval(() => { if (!el.hidden) tick(); }, 200);
  return { render, chooseMode(cb) { choosing = cb; render(); }, get open() { return !el.hidden; } };
}
