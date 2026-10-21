import { L } from '../i18n.js';
// 广东骰 / 吹牛 (liar's dice, bar rules) — pure functions, no DOM, no network.
//  - everyone has 5 dice under a cup; bids are "N 个 F" over ALL dice on the table
//  - 飞: 1s are wild (count as any face); 斋: 1s are not wild. Bidding 1s is always 斋.
//  - opening: 人头一 (as many 1s as players), 斋 at least 人头 + 1, 飞 at least 人头 + 2
//  - same mode (飞→飞, 斋→斋): more dice, or the same count with a bigger face (2 < 3 < … < 6 < 1)
//  - 飞 → 斋 may drop by one die at most: after N 飞, any N-1 斋 or more is fine
//  - 破斋 (斋 → 飞): 翻倍 with a bigger face, or 翻倍 + 1 with any face
//  - 开 (stake 1): the next player calls the last bid; 劈 (stake 2): anyone but the bidder calls it;
//    反劈 (stake 4): the bidder doubles back. Cups are flipped: if the table really has ≥ N, the caller drinks.
//  - 豹子: a cup whose five dice all show the face counts as 6, not 5 (in 飞 the 1s join in: 3 3 1 3 1 is a 豹子 of 3s)

export const DICE_PER_PLAYER = 5;
export const FACES = [2, 3, 4, 5, 6, 1];
export const RANK = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 1: 5 };
export const STAKE = { kai: 1, pi: 2, fanpi: 4 };
export const maxCount = (players) => players * (DICE_PER_PLAYER + 1); // every cup a 豹子

export const norm = (b) => ({ q: b.q | 0, f: b.f | 0, zhai: b.f === 1 ? true : !!b.zhai });
export const minOpen = (players, zhai, f) => (f === 1 ? players : players + (zhai ? 1 : 2)); // 人头一 / 人头+1 斋 / 人头+2 飞

export function validBid(b, prev, players) {
  b = norm(b);
  if (!RANK.hasOwnProperty(b.f) || b.q < 1 || b.q > maxCount(players)) return false;
  if (!prev) return b.q >= minOpen(players, b.zhai, b.f);
  prev = norm(prev);
  if (prev.zhai === b.zhai) return b.q > prev.q || (b.q === prev.q && RANK[b.f] > RANK[prev.f]);
  if (b.zhai) return b.q >= prev.q - 1;                                              // 飞 → 斋: 只能减 1
  return b.q > prev.q * 2 || (b.q === prev.q * 2 && RANK[b.f] > RANK[prev.f]);       // 破斋: 翻倍 / 翻倍 + 1
}

// the cheapest legal bid on a face/mode (used for the UI default and by bots)
export function minBidFor(f, zhai, prev, players) {
  zhai = f === 1 ? true : zhai;
  for (let q = 1; q <= maxCount(players); q++) if (validBid({ q, f, zhai }, prev, players)) return { q, f, zhai };
  return null;
}

// one cup's count of face f; 豹子 (all five match, wild 1s included in 飞) counts as 6
export function handCount(dice, f, zhai) {
  const n = dice.filter((d) => d === f || (!zhai && f !== 1 && d === 1)).length;
  return n === DICE_PER_PLAYER ? DICE_PER_PLAYER + 1 : n;
}
export const isLeopard = (dice, f, zhai) => handCount(dice, f, zhai) > DICE_PER_PLAYER;
export function countFace(allDice, f, zhai) {
  let n = 0;
  for (const dice of allDice) n += handCount(dice, f, zhai);
  return n;
}

// resolve a call: returns { count, holds, loser, cups }
export function settle(bid, allDiceById, bidderId, callerId, kind) {
  bid = norm(bid);
  const count = countFace(Object.values(allDiceById), bid.f, bid.zhai);
  const holds = count >= bid.q;
  return { count, holds, loser: holds ? callerId : bidderId, cups: STAKE[kind] || 1 };
}

export const openText = (n) => L(`人头一 ${n} 个 1 · 斋 ${n + 1} · 飞 ${n + 2}`, `one per head: ${n}× 1 · pure ${n + 1} · wild ${n + 2}`);
export const roll = (rng = Math.random) => Array.from({ length: DICE_PER_PLAYER }, () => 1 + Math.floor(rng() * 6));
// 顺子: no two dice alike (e.g. 1 2 3 4 5, 2 3 4 5 6, 1 3 4 5 6) — a hand worth nothing, so the cup is shaken again.
export const isStraight = (d) => new Set(d).size === d.length;
export function rollHand(rng = Math.random) { const tossed = []; let d = roll(rng); while (isStraight(d)) { tossed.push(d); d = roll(rng); } return { dice: d, tossed }; }
export const bidText = (b) => { b = norm(b); return L(`${b.q} 个 ${b.f}${b.f === 1 ? '' : b.zhai ? '（斋）' : '（飞）'}`, `${b.q}× ${b.f}${b.f === 1 ? '' : b.zhai ? ' (pure)' : ' (wild)'}`); };

// ---- a small bot brain (团团 / 鳄搭子) ----
function binomTail(n, p, k) { // P(X >= k), X ~ Bin(n, p)
  if (k <= 0) return 1; if (k > n) return 0;
  let s = 0, c = 1; for (let i = 0; i <= n; i++) { if (i > 0) c = c * (n - i + 1) / i; if (i >= k) s += c * p ** i * (1 - p) ** (n - i); }
  return s;
}
export function chanceTrue(bid, myDice, players) {
  bid = norm(bid);
  const mine = countFace([myDice], bid.f, bid.zhai), unknown = (players - 1) * DICE_PER_PLAYER;
  const p = bid.zhai || bid.f === 1 ? 1 / 6 : 1 / 3;
  return binomTail(unknown, p, bid.q - mine);
}
// returns { a: 'bid', bid } | { a: 'kai' } | { a: 'pi' }
export function botMove(myDice, prev, players, rng = Math.random) {
  if (prev) {
    const c = chanceTrue(prev, myDice, players);
    if (c < 0.12 && rng() < 0.55) return { a: 'pi' };
    if (c < 0.38) return { a: 'kai' };
  }
  // raise on the face we hold most of (wild 1s help in 飞), sometimes bluff a little
  const options = [];
  for (const f of FACES) for (const zhai of [false, true]) {
    const b = minBidFor(f, zhai, prev, players); if (!b) continue;
    const bluff = rng() < 0.25 ? 1 : 0; const bb = { ...b, q: b.q + (rng() < 0.15 ? 1 : 0) };
    const c = chanceTrue(bb, myDice, players);
    options.push({ bid: bb, score: c + bluff * 0.1 + rng() * 0.08 });
  }
  options.sort((x, y) => y.score - x.score);
  if (!options.length || (prev && options[0].score < 0.3)) return { a: 'kai' };
  return { a: 'bid', bid: options[0].bid };
}
export const botFanpi = (bid, myDice, players, rng = Math.random) => chanceTrue(bid, myDice, players) > 0.72 && rng() < 0.8;
