// Fast 5..7 card hand evaluator. Pure, allocation-light.
// Score layout: category << 20 | r0 << 16 | r1 << 12 | r2 << 8 | r3 << 4 | r4
// (ranks 0..12). A higher score is a better hand; equal scores tie.

export const CATEGORY = Object.freeze({
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
});

// 10 named hands: Royal Flush is the ace-high straight flush.
export const HAND_NAMES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
  'Royal Flush',
];

const rc = new Int32Array(13);
const sc = new Int32Array(4);
const sm = new Int32Array(4);

function straightTop(mask) {
  for (let top = 12; top >= 4; top--) {
    if (((mask >> (top - 4)) & 0x1f) === 0x1f) return top;
  }
  // wheel A-2-3-4-5 -> top card is the 5 (rank 3)
  if ((mask & 0x100f) === 0x100f) return 3;
  return -1;
}

function make(cat, r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0) {
  return (cat << 20) | (r0 << 16) | (r1 << 12) | (r2 << 8) | (r3 << 4) | r4;
}

/** Returns the numeric score of the best 5-card hand within `cards` (5..7 ints). */
export function evaluateScore(cards) {
  rc.fill(0);
  sc[0] = sc[1] = sc[2] = sc[3] = 0;
  sm[0] = sm[1] = sm[2] = sm[3] = 0;
  let all = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    rc[r]++;
    sc[s]++;
    sm[s] |= 1 << r;
    all |= 1 << r;
  }
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (sc[s] >= 5) {
      flushSuit = s;
      const sf = straightTop(sm[s]);
      if (sf >= 0) return make(CATEGORY.STRAIGHT_FLUSH, sf);
    }
  }
  let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1, p3 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = rc[r];
    if (n === 4) q = r;
    else if (n === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; else if (p3 < 0) p3 = r; }
  }
  if (q >= 0) {
    let k = -1;
    for (let r = 12; r >= 0; r--) if (r !== q && rc[r] > 0) { k = r; break; }
    return make(CATEGORY.FOUR_OF_A_KIND, q, k < 0 ? 0 : k);
  }
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) {
    return make(CATEGORY.FULL_HOUSE, t1, Math.max(t2, p1));
  }
  if (flushSuit >= 0) {
    const m = sm[flushSuit];
    const ks = [];
    for (let r = 12; r >= 0 && ks.length < 5; r--) if (m & (1 << r)) ks.push(r);
    return make(CATEGORY.FLUSH, ks[0], ks[1], ks[2], ks[3], ks[4]);
  }
  const st = straightTop(all);
  if (st >= 0) return make(CATEGORY.STRAIGHT, st);
  if (t1 >= 0) {
    let k1 = -1, k2 = -1;
    for (let r = 12; r >= 0; r--) {
      if (r === t1 || rc[r] === 0) continue;
      if (k1 < 0) k1 = r; else { k2 = r; break; }
    }
    return make(CATEGORY.THREE_OF_A_KIND, t1, k1, k2);
  }
  if (p2 >= 0) {
    let k = -1;
    for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rc[r] > 0) { k = r; break; }
    return make(CATEGORY.TWO_PAIR, p1, p2, k < 0 ? 0 : k);
  }
  if (p1 >= 0) {
    const ks = [];
    for (let r = 12; r >= 0 && ks.length < 3; r--) if (r !== p1 && rc[r] > 0) ks.push(r);
    return make(CATEGORY.ONE_PAIR, p1, ks[0], ks[1], ks[2]);
  }
  const ks = [];
  for (let r = 12; r >= 0 && ks.length < 5; r--) if (rc[r] > 0) ks.push(r);
  return make(CATEGORY.HIGH_CARD, ks[0], ks[1], ks[2], ks[3], ks[4]);
}

export const categoryOf = (score) => score >> 20;

/** Index into HAND_NAMES (0..9); 9 = Royal Flush. */
export function handRankIndex(score) {
  const cat = score >> 20;
  if (cat === CATEGORY.STRAIGHT_FLUSH && ((score >> 16) & 0xf) === 12) return 9;
  return cat;
}

export function handName(score) {
  return HAND_NAMES[handRankIndex(score)];
}

export function evaluate(cards) {
  const score = evaluateScore(cards);
  return { score, category: score >> 20, name: handName(score) };
}

/** -1 / 0 / 1 comparing two card sets. */
export function compareHands(a, b) {
  const x = evaluateScore(a);
  const y = evaluateScore(b);
  return x === y ? 0 : x > y ? 1 : -1;
}
