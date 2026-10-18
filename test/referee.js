// Independent referee: re-checks one finished hand purely from the engine's hand log
// (blinds, deals, actions, showdown, awards, end stacks) using its own rule
// bookkeeping and the reference evaluator / side-pot code. Returns a list of
// violation strings (empty = clean hand).

import { refBest, cmpTuple, refPots, refName } from './reference.js';

export function refereeHand(log, { n, smallBlind, bigBlind, prevButton = -1 }) {
  const v = [];
  const fail = (m) => v.push(m);
  const start = log[0];
  if (!start || start.t !== 'start') return ['log does not begin with start'];
  const stacks = [...start.stacks];
  const startSum = stacks.reduce((a, b) => a + b, 0);
  const inHand = stacks.map((c) => c > 0);
  const dealt = inHand.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  const next = (from, pred) => {
    for (let i = 1; i <= n; i++) {
      const k = (from + i) % n;
      if (pred(k)) return k;
    }
    return -1;
  };
  // Positions.
  if (prevButton >= 0) {
    const exp = next(prevButton, (k) => inHand[k]);
    if (start.button !== exp) fail(`button should move to ${exp}, got ${start.button}`);
  }
  if (!inHand[start.button]) fail('button seat has no chips');
  const expSb = dealt.length === 2 ? start.button : next(start.button, (k) => inHand[k]);
  const expBb = next(expSb, (k) => inHand[k]);
  if (start.sb !== expSb || start.bb !== expBb) fail(`blind seats wrong: sb ${start.sb}/${expSb} bb ${start.bb}/${expBb}`);

  const folded = new Array(n).fill(false);
  const allIn = new Array(n).fill(false);
  const acted = new Array(n).fill(false);
  const actedAt = new Array(n).fill(0);
  const bet = new Array(n).fill(0);
  const total = new Array(n).fill(0);
  let curMax = 0;
  let lastFull = bigBlind;
  let street = 'preflop';
  let lastActor = -1;
  const hole = {};
  let board = [];
  const seen = new Set();
  const useCard = (c) => {
    if (!Number.isInteger(c) || c < 0 || c > 51) fail(`bad card ${c}`);
    if (seen.has(c)) fail(`duplicate card ${c}`);
    seen.add(c);
  };
  const live = () => dealt.filter((k) => !folded[k]);
  const canAct = () => live().filter((k) => !allIn[k]);
  const roundComplete = () => {
    const ca = canAct();
    if (live().length <= 1) return true;
    if (ca.length === 0) return true;
    if (ca.length === 1 && bet[ca[0]] >= curMax) return true;
    return ca.every((k) => acted[k] && bet[k] === curMax);
  };
  let blindsPosted = 0;
  let showdownSeen = false;
  let awards = [];
  let ended = null;

  for (let i = 1; i < log.length; i++) {
    const e = log[i];
    switch (e.t) {
      case 'blind': {
        const exp = e.kind === 'sb' ? expSb : expBb;
        const amt = Math.min(e.kind === 'sb' ? smallBlind : bigBlind, stacks[e.seat]);
        if (e.seat !== exp) fail(`${e.kind} posted by wrong seat`);
        if (e.amount !== amt) fail(`${e.kind} amount ${e.amount} != ${amt}`);
        stacks[e.seat] -= e.amount;
        bet[e.seat] += e.amount;
        total[e.seat] += e.amount;
        if (stacks[e.seat] === 0) allIn[e.seat] = true;
        blindsPosted++;
        if (blindsPosted === 2) {
          curMax = bigBlind;
          lastActor = expBb;
        }
        break;
      }
      case 'hole':
        if (!inHand[e.seat]) fail('hole cards to seat not in hand');
        if (e.cards.length !== 2) fail('hole must be 2 cards');
        e.cards.forEach(useCard);
        hole[e.seat] = e.cards;
        break;
      case 'street': {
        if (e.street === 'preflop') break;
        if (!roundComplete()) fail(`${e.street} dealt before betting round completed`);
        const expLen = { flop: 3, turn: 4, river: 5 }[e.street];
        if (e.board.length !== expLen) fail(`board length ${e.board.length} on ${e.street}`);
        for (let j = 0; j < board.length; j++) if (board[j] !== e.board[j]) fail('board changed');
        e.board.slice(board.length).forEach(useCard);
        board = [...e.board];
        street = e.street;
        bet.fill(0);
        acted.fill(false);
        actedAt.fill(0);
        curMax = 0;
        lastFull = bigBlind;
        lastActor = start.button;
        break;
      }
      case 'act': {
        const s = e.seat;
        const expected = next(lastActor, (k) => inHand[k] && !folded[k] && !allIn[k] && (!acted[k] || bet[k] < curMax));
        if (roundComplete()) fail(`action by ${s} after round complete`);
        if (s !== expected) fail(`seat ${s} acted, expected ${expected}`);
        if (e.street !== street) fail(`action street ${e.street} != ${street}`);
        const toCall = curMax - bet[s];
        const cap = bet[s] + stacks[s];
        const reopened = !acted[s] || curMax - actedAt[s] >= lastFull;
        let to = bet[s];
        switch (e.action) {
          case 'fold':
            if (toCall <= 0) fail('fold when check available');
            folded[s] = true;
            break;
          case 'check':
            if (toCall !== 0) fail('check facing a bet');
            break;
          case 'call':
            if (toCall <= 0) fail('call with nothing to call');
            to = bet[s] + Math.min(toCall, stacks[s]);
            break;
          case 'bet':
            if (curMax !== 0) fail('bet when a bet exists');
            to = e.to;
            if (to > cap) fail('bet exceeds stack');
            if (to < bigBlind && to !== cap) fail('bet below big blind');
            break;
          case 'raise':
            if (curMax === 0) fail('raise with no bet');
            if (!reopened) fail('raise when betting not reopened');
            to = e.to;
            if (to > cap) fail('raise exceeds stack');
            if (to - curMax < lastFull && to !== cap) fail(`raise to ${to} below min raise (${curMax}+${lastFull})`);
            break;
          case 'allin':
            to = cap;
            if (to > curMax && curMax > 0 && !reopened) fail('all-in raise when betting not reopened');
            break;
          default:
            fail(`unknown action ${e.action}`);
        }
        if (e.to !== to) fail(`to mismatch ${e.to} != ${to}`);
        const add = to - bet[s];
        if (e.add !== add) fail(`add mismatch ${e.add} != ${add}`);
        if (add < 0 || add > stacks[s]) fail('illegal chip movement');
        stacks[s] -= add;
        total[s] += add;
        bet[s] = to;
        if (stacks[s] === 0 && add > 0) allIn[s] = true;
        if (e.allIn !== allIn[s]) fail('allIn flag mismatch');
        if (to > curMax) {
          if (to - curMax >= lastFull) lastFull = to - curMax;
          curMax = to;
        }
        acted[s] = true;
        actedAt[s] = curMax;
        lastActor = s;
        break;
      }
      case 'showdown': {
        showdownSeen = true;
        if (!roundComplete()) fail('showdown before betting complete');
        if (board.length !== 5) fail('showdown without full board');
        const shownSeats = e.hands.map((x) => x.seat).sort((a, b) => a - b);
        const liveSeats = live().sort((a, b) => a - b);
        if (shownSeats.join() !== liveSeats.join()) fail('showdown seats != live seats');
        // Engine scores must order hands exactly like the reference evaluator.
        const refs = e.hands.map((x) => refBest([...hole[x.seat], ...board]));
        e.hands.forEach((x, a) => {
          if (x.name !== refName(refs[a])) fail(`hand name ${x.name} != ${refName(refs[a])}`);
          e.hands.forEach((y, b) => {
            const es = Math.sign(x.score - y.score);
            if (es !== cmpTuple(refs[a], refs[b])) fail('engine hand comparison disagrees with reference');
          });
        });
        break;
      }
      case 'award':
        awards.push(e);
        break;
      case 'end':
        ended = e;
        break;
      default:
        fail(`unknown log entry ${e.t}`);
    }
  }
  if (blindsPosted !== 2) fail('blinds not posted');
  if (!ended) return [...v, 'hand did not end'];

  // Expected payouts.
  const out = new Array(n).fill(true);
  live().forEach((k) => (out[k] = false));
  const expPay = new Array(n).fill(0);
  const pot = total.reduce((a, b) => a + b, 0);
  if (live().length === 1) {
    expPay[live()[0]] = pot;
    if (showdownSeen) fail('showdown in an uncontested hand');
  } else {
    if (!showdownSeen) fail('contested hand ended without showdown');
    const order = [];
    for (let i = 1; i <= n; i++) order.push((start.button + i) % n);
    const best = {};
    live().forEach((k) => (best[k] = refBest([...hole[k], ...board])));
    for (const p of refPots(total, out)) {
      let top = null;
      for (const k of p.eligible) if (!top || cmpTuple(best[k], top) > 0) top = best[k];
      const winners = order.filter((k) => p.eligible.includes(k) && cmpTuple(best[k], top) === 0);
      const base = Math.floor(p.amount / winners.length);
      let rem = p.amount % winners.length;
      for (const w of winners) expPay[w] += base + (rem-- > 0 ? 1 : 0);
    }
  }
  const gotPay = new Array(n).fill(0);
  for (const a of awards) a.winners.forEach((w, i) => (gotPay[w] += a.shares[i]));
  for (let k = 0; k < n; k++) {
    if (gotPay[k] !== expPay[k]) fail(`seat ${k} paid ${gotPay[k]}, reference ${expPay[k]}`);
    if (ended.stacks[k] !== stacks[k] + expPay[k]) fail(`seat ${k} end stack ${ended.stacks[k]} != ${stacks[k] + expPay[k]}`);
    if (ended.stacks[k] < 0) fail('negative stack');
  }
  const endSum = ended.stacks.reduce((a, b) => a + b, 0);
  if (endSum !== startSum) fail(`chips not conserved in hand: ${startSum} -> ${endSum}`);
  return v;
}
