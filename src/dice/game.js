import * as R from './rules.js';
import { L } from '../i18n.js';

// A table game of 吹牛 over the room's MQTT channel, no server.
// The guest who starts it is the host (庄): it holds the public state, checks every move, runs the clock and the
// bots, and broadcasts { k: 'state' }. Everyone else sends intents { k: 'act' }. Each guest rolls their own dice
// and keeps them on their device until the cups are opened ({ k: 'reveal' }).
// Two modes: 'online' (广东骰: bids, 开/劈/反劈, cups counted for you) and 'offline' (线下玩: the app only rolls the
// cups and opens them — the table shouts its own bids in real life, no clock, everything manual).

export const TURN_MS = 60000, PI_MS = 6000, SHOW_MS = 6000, RESULT_MS = 8000;
const CHEERS_IDLE_MS = 90000; // 广东骰: the loser taps 干了！继续！ to deal the next round — unless they doze off this long
const BEAT_MS = 3000, HOST_LOST_MS = 12000;
// event lines, bot names and end reasons are written by the host, in the host's language
export const BOTS = { 'bot:cat': { nick: L('团团', 'Tuantuan'), npc: 'cat_tuantuan', av: 'cat_tuantuan' }, 'bot:croc': { nick: L('鳄搭子', 'Croc Buddy'), npc: 'croc_edazi', av: 'croc_edazi' } };

export function createDiceGame({ me, getNet, tableMates, myGroup = () => null, onEvent = () => {}, onChange = () => {} }) {
  let game = null;            // latest public state of the game we are part of / watching
  let host = null;            // host-side private data when we run the table
  let my = { n: -1, dice: null, revealed: -1 };
  let lastSeen = 0, lastSeq = {};
  const send = (o) => getNet()?.send({ t: 'dice', id: me.id, ...o });
  const now = () => Date.now();
  const lastBid = (s) => s.bids[s.bids.length - 1] || null;
  const pidx = (s, id) => s.players.findIndex((p) => p.id === id);

  // ---------------- host ----------------
  function publish(ev) {
    const s = host.s; s.seq++; if (ev) s.ev = { seq: s.seq, ...ev };
    send({ k: 'state', g: s.g, s }); apply(s, true);
  }
  function start(group, mode = 'online') {
    if (game && !game.over && game.group === group) return false;
    const g = now().toString(36) + ':' + me.id;
    host = { s: { v: 1, g, mode: mode === 'offline' ? 'offline' : 'online', host: me.id, group, n: 0, players: [], phase: 'idle', turn: 0, bids: [], call: null, deadline: 0, dice: {}, result: null, tally: {}, seq: 0, ev: null, over: false }, botDice: {}, botAt: 0, piBotAt: 0, left: new Set(), lastBeat: 0 };
    newRound(me.id);
    return true;
  }
  function roster() {
    const humans = tableMates(host.s.group).filter((p) => !host.left.has(p.id));
    const ps = humans.map((p) => ({ id: p.id, nick: p.nick, av: p.av }));
    if (humans.length === 1 && host.s.mode === 'online') for (const [id, b] of Object.entries(BOTS)) ps.push({ id, nick: b.nick, bot: true, av: b.av }); // alone at the table: 团团 and 鳄搭子 sit in
    return { ps, humans: humans.length };
  }
  function newRound(starter) {
    const s = host.s, { ps, humans } = roster();
    if (!humans || (ps.length < 2 && s.mode === 'online') || !ps.some((p) => p.id === me.id)) return end(L('人不够了', 'Not enough players'));
    if (s.mode === 'offline') { // 线下玩: just shake every cup; no turns, no clock
      s.players = ps; s.n++; s.phase = 'rolled'; s.bids = []; s.call = null; s.dice = {}; s.result = null; s.deadline = 0;
      return publish({ type: 'round', id: me.id, text: L(`第 ${s.n} 盅，摇！`, `Cup ${s.n}, shake!`) });
    }
    s.players = ps; s.n++; s.phase = 'bidding'; s.bids = []; s.call = null; s.dice = {}; s.result = null;
    for (const p of ps) if (!s.tally[p.id]) s.tally[p.id] = { nick: p.nick, cups: 0, bot: !!p.bot }; else s.tally[p.id].nick = p.nick;
    s.turn = Math.max(0, pidx(s, starter)); s.deadline = now() + TURN_MS;
    host.botDice = {}; for (const p of ps) if (p.bot) host.botDice[p.id] = R.rollHand().dice;
    host.botAt = now() + 1400 + Math.random() * 1200;
    publish({ type: 'round', id: s.players[s.turn].id, text: L(`第 ${s.n} 局，摇！`, `Round ${s.n}, shake!`) });
  }
  function end(why) {
    const s = host.s; s.phase = 'over'; s.over = true; s.deadline = 0; s.why = why || '';
    publish({ type: 'over', id: s.host, text: L('结算！', 'Final tally!') }); host = null;
  }
  function act(from, a, p = {}) { // validate + apply one move (host only)
    const s = host.s, n = s.players.length, lb = lastBid(s);
    if (a === 'leave') { host.left.add(from); if (from === me.id) return end(L('庄家下桌了', 'The host left the table')); if (s.players[s.turn]?.id === from && s.phase === 'bidding') s.deadline = now(); return; }
    if (a === 'end' && from === s.host) return end(L('庄家结束了这桌', 'The host ended this table'));
    if (pidx(s, from) < 0) return;
    if (a === 'cheers' && s.mode === 'online' && s.phase === 'result' && s.result?.loser === from) { // 干了！继续！
      publish({ type: 'cheers', id: from, text: L('干了！🍻', 'Bottoms up! 🍻') }); return newRound(from);
    }
    if (s.mode === 'offline') { // anyone at the table may open the cups or shake a new round
      if (a === 'open' && s.phase === 'rolled') { s.call = { kind: 'open', by: from }; publish({ type: 'kai', id: from, text: L('开！', 'Open!') }); return show(); }
      if (a === 'reroll' && s.phase === 'opened') return newRound();
      return;
    }
    if (a === 'bid' && s.phase === 'bidding' && s.players[s.turn].id === from) {
      const b = R.norm(p); if (!R.validBid(b, lb, n)) return;
      s.bids.push({ id: from, ...b }); s.turn = (s.turn + 1) % n; s.deadline = now() + TURN_MS;
      host.botAt = now() + 1300 + Math.random() * 1500; host.piBotAt = now() + 900 + Math.random() * 1500;
      return publish({ type: 'bid', id: from, text: R.bidText(b) + '！' });
    }
    if (a === 'kai' && s.phase === 'bidding' && lb && s.players[s.turn].id === from && lb.id !== from) {
      s.call = { kind: 'kai', by: from, bidder: lb.id }; publish({ type: 'kai', id: from, text: L('开！', 'Open!') }); return show();
    }
    if (a === 'pi' && s.phase === 'bidding' && lb && lb.id !== from) {
      s.phase = 'pi'; s.call = { kind: 'pi', by: from, bidder: lb.id, until: now() + PI_MS }; s.deadline = s.call.until;
      host.piBotAt = now() + 1500 + Math.random() * 1500;
      return publish({ type: 'pi', id: from, text: L('劈！！', 'Double!!') });
    }
    if (a === 'fanpi' && s.phase === 'pi' && s.call?.bidder === from) {
      s.call.kind = 'fanpi'; publish({ type: 'fanpi', id: from, text: L('反劈！！！', 'Re-double!!!') }); return show();
    }
  }
  function show() {
    const s = host.s; s.phase = 'show'; s.deadline = now() + SHOW_MS; s.dice = { ...host.botDice };
    if (my.n === s.n && my.dice) s.dice[me.id] = my.dice;
    publish(); maybeFinish();
  }
  function reveal(from, n, dice) {
    const s = host?.s; if (!s || s.phase !== 'show' || n !== s.n || pidx(s, from) < 0) return;
    if (!Array.isArray(dice) || dice.length !== R.DICE_PER_PLAYER || dice.some((d) => !(d >= 1 && d <= 6))) return;
    s.dice[from] = dice.map((d) => d | 0); maybeFinish();
  }
  function maybeFinish(force) {
    const s = host.s; if (s.phase !== 'show') return;
    if (!force && !s.players.every((p) => s.dice[p.id])) return publish();
    for (const p of s.players) if (!s.dice[p.id]) s.dice[p.id] = []; // never revealed (dropped): counts nothing
    if (s.mode === 'offline') { s.phase = 'opened'; s.deadline = 0; return publish({ type: 'opened', id: s.call.by, text: L('开盅！', 'Cups up!') }); }
    const lb = lastBid(s), r = R.settle(lb, s.dice, s.call.bidder, s.call.by, s.call.kind);
    s.result = { ...r, bid: lb, kind: s.call.kind, caller: s.call.by, bidder: s.call.bidder };
    s.tally[r.loser].cups += r.cups; s.phase = 'result'; s.deadline = 0; s.resultAt = now(); // no clock: the loser drinks, then deals on
    host.cheersAt = now() + 2400 + s.players.length * 400; // a bot loser drinks up once the cups are lifted
    publish({ type: 'result', id: r.loser, text: L(`喝 ${r.cups} 杯！🍺`, `Drink ${r.cups}! 🍺`) });
  }
  function hostTick() {
    const s = host.s, t = now(), cur = s.players[s.turn], lb = lastBid(s);
    if (s.mode === 'offline') { // only the reveal collection has a (short) timeout
      if (s.phase === 'show' && t > s.deadline) maybeFinish(true);
    } else if (s.phase === 'bidding') {
      if (cur?.bot && t > host.botAt) { // a bot's turn
        const mv = R.botMove(host.botDice[cur.id], lb, s.players.length);
        return mv.a === 'bid' ? act(cur.id, 'bid', mv.bid) : act(cur.id, mv.a === 'pi' && lb ? 'pi' : 'kai');
      }
      if (lb && t > host.piBotAt) { // a bot that is not on turn may smell a lie and 劈
        host.piBotAt = Infinity;
        for (const p of s.players) if (p.bot && p.id !== lb.id && p.id !== cur?.id && R.chanceTrue(lb, host.botDice[p.id], s.players.length) < 0.08 && Math.random() < 0.5) return act(p.id, 'pi');
      }
      if (t > s.deadline) { // too slow: the house moves for you
        if (!lb) { const b = R.minBidFor(6, false, null, s.players.length); return act(cur.id, 'bid', b); }
        return act(cur.id, 'kai');
      }
    } else if (s.phase === 'pi') {
      const bidder = s.players.find((p) => p.id === s.call.bidder);
      if (bidder?.bot && t > host.piBotAt) { host.piBotAt = Infinity; if (R.botFanpi(lastBid(s), host.botDice[bidder.id], s.players.length)) return act(bidder.id, 'fanpi'); }
      if (t > s.deadline) return show();
    } else if (s.phase === 'show') { if (t > s.deadline) return maybeFinish(true); }
    else if (s.phase === 'result') { // wait for the loser's 干了！继续！
      const loser = s.result.loser, lp = s.players.find((p) => p.id === loser);
      if (lp?.bot) { if (t > host.cheersAt) return act(loser, 'cheers'); }
      else if (!lp || host.left.has(loser) || !tableMates(s.group).some((p) => p.id === loser)) return newRound(loser); // they left the table: deal on
      else if (t - (s.resultAt || t) > CHEERS_IDLE_MS) { publish({ type: 'cheers', id: loser, text: L('睡着了…算干了 😴', 'Fell asleep… counts as drunk 😴') }); return newRound(loser); }
    }
    if (t - host.lastBeat > BEAT_MS) { host.lastBeat = t; send({ k: 'state', g: s.g, s }); } // keep late joiners / lost packets in sync
  }

  // ---------------- everyone ----------------
  function apply(s, fromSelf) {
    lastSeen = now();
    if (!fromSelf && game && s.g === game.g && s.seq === game.seq && s.phase === game.phase) return; // a heartbeat: nothing new — don't rebuild the panel under the player's finger
    const mine = s.players.some((p) => p.id === me.id);
    if (s.n !== my.n && mine && !s.over) { const h = R.rollHand(); my = { n: s.n, dice: h.dice, tossed: h.tossed, revealed: -1 }; } // new round: roll my cup (a 顺子 is shaken again)
    if (s.phase === 'show' && mine && my.n === s.n && my.revealed !== s.n && !fromSelf) { my.revealed = s.n; send({ k: 'reveal', g: s.g, n: s.n, dice: my.dice }); }
    if (s.ev && s.ev.seq !== lastSeq[s.g]) { lastSeq[s.g] = s.ev.seq; onEvent(s.ev, s); }
    game = s; onChange(game);
  }
  function receive(m) {
    if (m.k === 'state' && m.s?.v === 1) {
      const s = m.s;
      if (host && host.s.group === s.group && s.g !== host.s.g && !s.over) { // two tables started at once: the older game wins
        if (s.g < host.s.g) { host = null; } else return;
      }
      if (host && s.g === host.s.g) return;
      // show bubbles for every table in the yard; track the one we sit at / play in
      if (s.ev && s.ev.seq !== lastSeq[s.g]) { lastSeq[s.g] = s.ev.seq; onEvent(s.ev, s); }
      const mySeatGroup = myGroup();
      if (s.players.some((p) => p.id === me.id) || (mySeatGroup && mySeatGroup === s.group) || game?.g === s.g) apply(s);
      return;
    }
    if (!host || m.g !== host.s.g) return;
    if (m.k === 'act') act(m.id, m.a, m);
    else if (m.k === 'reveal') reveal(m.id, m.n, m.dice);
  }
  function move(a, p = {}) { if (!game) return; if (host && game.g === host.s.g) act(me.id, a, p); else send({ k: 'act', g: game.g, a, ...p }); }

  setInterval(() => {
    if (host) hostTick();
    else if (game && !game.over && now() - lastSeen > HOST_LOST_MS) { game = { ...game, over: true, phase: 'over', why: L('庄家掉线了', 'The host dropped out') }; onChange(game); }
  }, 250);

  return {
    start, receive, move,
    get state() { return game; }, get myDice() { return game && my.n === game.n ? my.dice : null; }, get myTossed() { return game && my.n === game.n ? my.tossed || [] : []; },
    get isHost() { return !!host; },
    inGame: () => !!game && !game.over && game.players.some((p) => p.id === me.id),
    close() { if (host) return move('end'); /* the host sees the 战报 */ if (game && !game.over) move('leave'); game = null; onChange(null); },
    leave() { if (game && !game.over) move('leave'); },
    dismiss() { game = null; onChange(null); },
  };
}
