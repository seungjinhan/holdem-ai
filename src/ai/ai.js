// Basic AI opponent: hand strength + pot odds, with a per-seat style (tight / loose).
// Pure function of (playerView, rng): no DOM, no timers, deterministic for a seeded rng.
// It only ever returns an action chosen from view.legal, so it cannot break the rules.

import { evaluateScore } from '../engine/evaluator.js';

export const STYLES = Object.freeze({
  tight: { id: 'tight', label: 'Tight', tightness: 0.75, aggression: 0.55, bluff: 0.03 },
  loose: { id: 'loose', label: 'Loose', tightness: 0.3, aggression: 0.7, bluff: 0.1 },
});

/** Chen formula score for two hole cards (-1 .. 20). */
export function chenScore(c1, c2) {
  let r1 = c1 >> 2, r2 = c2 >> 2;
  if (r2 > r1) [r1, r2] = [r2, r1];
  const base = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = base(r1);
  if (r1 === r2) return Math.max(5, Math.ceil(score * 2));
  if ((c1 & 3) === (c2 & 3)) score += 2;
  const gap = r1 - r2 - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && r1 < 10) score += 1;
  return Math.ceil(score);
}

const deckBuf = new Int32Array(52);
const cardsBuf = [0, 0, 0, 0, 0, 0, 0];

/** Monte-Carlo equity of `hole` vs `opponents` random hands. */
export function estimateEquity(hole, board, opponents, iterations, rng) {
  const known = new Set([...hole, ...board]);
  let m = 0;
  for (let c = 0; c < 52; c++) if (!known.has(c)) deckBuf[m++] = c;
  const need = opponents * 2 + (5 - board.length);
  let total = 0;
  const fullBoard = new Array(5);
  for (let it = 0; it < iterations; it++) {
    // partial Fisher-Yates: draw `need` cards into deckBuf[0..need)
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (m - i));
      const t = deckBuf[i];
      deckBuf[i] = deckBuf[j];
      deckBuf[j] = t;
    }
    let p = 0;
    for (let i = 0; i < 5; i++) fullBoard[i] = i < board.length ? board[i] : deckBuf[p++];
    for (let i = 0; i < 5; i++) cardsBuf[i] = fullBoard[i];
    cardsBuf[5] = hole[0];
    cardsBuf[6] = hole[1];
    const mine = evaluateScore(cardsBuf);
    let best = true;
    let ties = 0;
    for (let o = 0; o < opponents && best; o++) {
      cardsBuf[5] = deckBuf[p++];
      cardsBuf[6] = deckBuf[p++];
      const sc = evaluateScore(cardsBuf);
      if (sc > mine) best = false;
      else if (sc === mine) ties++;
    }
    if (best) total += 1 / (ties + 1);
  }
  return total / iterations;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

/**
 * Decide an action.
 * @param {object} view    playerView(state, seat) for the acting seat (view.legal must be set)
 * @param {object} style   one of STYLES
 * @param {function} rng   seeded rng
 * @param {object} [opts]  { iterations }
 * @returns {{action:string, amount?:number}}
 */
export function decide(view, style, rng, opts = {}) {
  const L = view.legal;
  const h = view.hand;
  if (!L || !h || !h.hole) throw new Error('AI asked to act without a legal-action view');
  const st = style ?? STYLES.tight;
  const t = st.tightness;
  const bb = view.config.bigBlind;
  const iterations = opts.iterations ?? 200;
  const opponents = Math.max(1, h.seats.filter((x) => x.inHand && !x.folded && x.seat !== view.seat).length);
  const pot = L.pot;
  const potOdds = L.toCall > 0 ? L.call / (pot + L.call) : 0;

  let strength;
  if (h.board.length === 0) {
    // Preflop: Chen score mapped to 0..1, discounted for many opponents.
    strength = (chenScore(h.hole[0], h.hole[1]) + 1) / 21;
    strength -= 0.02 * (opponents - 1);
  } else {
    strength = estimateEquity(h.hole, h.board, Math.min(opponents, 3), iterations, rng);
  }

  const betTo = (fraction) => {
    // size a bet/raise as a fraction of the pot (after calling)
    const r = L.bet ?? L.raise;
    if (!r) return null;
    const target = L.currentBet + fraction * (pot + L.toCall);
    return clamp(Math.max(target, r.min), r.min, r.max);
  };
  const aggressive = (fraction) => {
    if (L.bet) return { action: 'bet', amount: betTo(fraction) };
    if (L.raise) return { action: 'raise', amount: betTo(fraction) };
    if (L.allIn != null) return { action: 'allin' };
    return passive();
  };
  const passive = () => (L.canCheck ? { action: 'check' } : { action: 'call' });
  const giveUp = () => (L.canCheck ? { action: 'check' } : { action: 'fold' });

  const r = rng();
  if (h.board.length === 0) {
    const playLine = 0.22 + 0.18 * t;
    const raiseLine = 0.45 + 0.15 * t;
    const reraiseLine = 0.62 + 0.12 * t;
    const facingRaise = L.currentBet > bb;
    if (strength >= reraiseLine && r < 0.4 + st.aggression * 0.5) {
      return strength > 0.9 && r < 0.15 && L.allIn != null ? { action: 'allin' } : aggressive(1);
    }
    if (!facingRaise && strength >= raiseLine && r < st.aggression) return aggressive(0.75);
    if (L.canCheck) return { action: 'check' };
    const cost = L.call / Math.max(1, L.stack + L.streetBet);
    if (strength >= playLine + (facingRaise ? 0.1 + cost * 0.6 : cost * 0.5)) return passive();
    if (!facingRaise && L.toCall <= bb / 2 && strength >= playLine - 0.08) return passive(); // complete SB
    return giveUp();
  }

  // Postflop.
  const valueLine = 0.62 + 0.1 * t;
  const raiseLine = 0.78 + 0.06 * t;
  if (L.canCheck) {
    if (strength >= valueLine && r < 0.5 + st.aggression * 0.5) return aggressive(strength > 0.85 ? 0.8 : 0.55);
    if (r < st.bluff) return aggressive(0.5);
    return { action: 'check' };
  }
  if (strength >= raiseLine && r < st.aggression) {
    return strength > 0.92 && r < 0.2 && L.allIn != null ? { action: 'allin' } : aggressive(0.9);
  }
  const margin = 0.03 + 0.08 * t;
  if (strength >= potOdds + margin) return { action: 'call' };
  if (r < st.bluff / 2 && L.toCall <= pot / 3) return { action: 'call' };
  return { action: 'fold' };
}
