import assert from 'node:assert/strict';
import { test } from './harness.js';
import { evaluate, evaluateScore, handRankIndex, HAND_NAMES } from '../src/engine/evaluator.js';
import { parseCards, makeCard } from '../src/engine/cards.js';
import { makeRng, shuffle } from '../src/engine/rng.js';
import { refBest, cmpTuple, refName } from './reference.js';

export const counters = { handRankingCases: 0 };

const name = (s) => evaluate(parseCards(s)).name;
const cmp = (a, b) => Math.sign(evaluateScore(parseCards(a)) - evaluateScore(parseCards(b)));

// ---- 1. Hand-written fixtures: every category, kickers, ties, wheel, board plays.
const NAMED = [
  ['As Ks Qs Js Ts 2d 3c', 'Royal Flush'],
  ['9h Th Jh Qh Kh Ah 2c', 'Royal Flush'],
  ['5c 4c 3c 2c Ac Kd Kh', 'Straight Flush'],
  ['9d 8d 7d 6d 5d 4d Ad', 'Straight Flush'],
  ['7s 7h 7d 7c 2s 3h 4d', 'Four of a Kind'],
  ['Ks Kh Kd 2s 2h 2d 9c', 'Full House'],
  ['Ah Ad 3c 3d 3s Kc Kd', 'Full House'],
  ['Ah 9h 7h 4h 2h Kd Kc', 'Flush'],
  ['Ah Kh Qh Jh 9h Th 2c', 'Royal Flush'],
  ['As 2d 3c 4h 5s 9d Kc', 'Straight'],
  ['Ts Jd Qc Kh As 2d 3c', 'Straight'],
  ['6s 7d 8c 9h Ts Td Tc', 'Straight'],
  ['Qs Qd Qc 2h 5s 8d Kc', 'Three of a Kind'],
  ['Js Jd 4c 4h 9s 9d 2c', 'Two Pair'],
  ['As Ad 7c 4h 9s 3d 2c', 'One Pair'],
  ['As Kd 9c 7h 5s 3d 2c', 'High Card'],
  ['Ks Qs Js Ts 9s', 'Straight Flush'],
  ['2c 3c 4c 5c 7c', 'Flush'],
];
const COMPARE = [
  // [a, b, expected sign]
  ['Ah Ad Kc 7d 4s 3h 2c', 'As Ac Qc 7h 4d 3s 2d', 1], // pair kicker
  ['Ah Ad Kc 7d 4s 3h 2c', 'As Ac Kd 7h 4d 3s 2d', 0], // identical ranks -> tie
  ['Kh Kd Qc Qd 4s 3h 2c', 'Kc Ks Qh Qs 5d 3s 2d', -1], // two pair, 5th-card kicker
  ['Kh Kd 5c 5d As 3h 2c', 'Kc Ks 4h 4s Ad 3s 2d', 1], // second pair decides
  ['5c 4c 3c 2c Ac', '6d 5d 4d 3d 2d', -1], // steel wheel < 6-high SF
  ['As 2d 3c 4h 5s', '2s 3d 4c 5h 6s', -1], // wheel < 6-high straight
  ['Ts Jd Qc Kh As', '9s Td Jc Qh Ks', 1],
  ['7s 7h 7d 7c As', '7s 7h 7d 7c Ks', 1], // quads kicker
  ['Ks Kh Kd 2s 2h', 'Qs Qh Qd As Ah', 1], // FH: trips rank first
  ['Ks Kh Kd 3s 3h', 'Kc Kh Kd 2s 2h', 1],
  ['Ah 9h 7h 4h 3h', 'Ah 9h 7h 4h 2h', 1], // flush 5th card
  ['Ah 9h 7h 4h 3h', 'Ad 9d 7d 4d 3d', 0], // equal flushes tie
  ['Qs Qd Qc 9h 5s', 'Qs Qd Qc 9h 4s', 1], // trips kicker
  ['As Kd 9c 7h 5s', 'As Kd 9c 7h 4s', 1],
  ['As Kd 9c 7h 5s', 'Ad Kc 9h 7s 5d', 0],
  ['2s 3d 4c 5h 7s 8d 9c', '2s 3d 4c 5h 6s 8d 9c', -1],
  // board plays: both players play the same 5 board cards -> tie
  ['2c 3d Ts Js Qs Ks As', '4c 5d Ts Js Qs Ks As', 0],
  ['2c 3d 9h 9d 9s 9c Ah', '4c 5d 9h 9d 9s 9c Ah', 0],
  // counterfeited two pair: third pair beats the old kicker
  ['Ac Kd 8h 8d 5s 5c 2h', 'Qc Jd 8h 8d 5s 5c 2h', 1],
  // every category beats the one below
  ['Ts Js Qs Ks As', '9s Ts Js Qs Ks', 1],
  ['9s Ts Js Qs Ks', '7s 7h 7d 7c As', 1],
  ['2s 2h 2d 2c 3s', 'As Ah Ad Ks Kh', 1],
  ['2s 2h 2d 3c 3s', 'Ah Kh Qh Jh 9h', 1],
  ['2h 3h 4h 5h 7h', 'Ts Jd Qc Kh As', 1],
  ['As 2d 3c 4h 5s', 'As Ah Ad Kh Qs', 1],
  ['2s 2h 2d 4c 5s', 'As Ah Kd Kh Qs', 1],
  ['2s 2h 3d 3c 4s', 'As Ah Kd Qh Js', 1],
  ['2s 2h 3d 4c 5d', 'As Kh Qd Jh 9s', 1],
];

test('hand ranking: hand-written fixtures (all 10 hands, kickers, ties, wheel, board plays)', () => {
  for (const [cards, exp] of NAMED) {
    assert.equal(name(cards), exp, cards);
    counters.handRankingCases++;
  }
  for (const [a, b, exp] of COMPARE) {
    assert.equal(cmp(a, b), exp, `${a} vs ${b}`);
    assert.equal(cmp(b, a), exp === 0 ? 0 : -exp, `${b} vs ${a}`);
    counters.handRankingCases += 2;
  }
  return `${NAMED.length + COMPARE.length * 2} cases`;
});

// ---- 2. Constructed hands with answers known by construction.
const rng = makeRng('constructed-hands', 1);
const ri = (n) => Math.floor(rng() * n);
const pickRanks = (k, exclude = []) => {
  const pool = shuffle([...Array(13).keys()].filter((r) => !exclude.includes(r)), rng);
  return pool.slice(0, k).sort((a, b) => b - a);
};
const isStraight = (ranks) => {
  const s = [...ranks].sort((a, b) => b - a);
  return s[0] - s[4] === 4 || s.join() === '12,3,2,1,0';
};
const offsuit = (ranks) => {
  // random suits, never all equal; and for groups, never repeat a suit within a rank
  for (;;) {
    const used = new Map();
    const cards = ranks.map((r) => {
      const taken = used.get(r) || [];
      const free = [0, 1, 2, 3].filter((s) => !taken.includes(s));
      const s = free[ri(free.length)];
      used.set(r, [...taken, s]);
      return makeCard(r, s);
    });
    if (new Set(cards.map((c) => c & 3)).size > 1) return cards;
  }
};
const suited = (ranks) => {
  const s = ri(4);
  return ranks.map((r) => makeCard(r, s));
};
const straightRanks = (top) => (top === 3 ? [3, 2, 1, 0, 12] : [top, top - 1, top - 2, top - 3, top - 4]);
const GENERATORS = [
  () => { let r; do r = pickRanks(5); while (isStraight(r)); return { cards: offsuit(r), t: [0, ...r] }; },
  () => { const [p] = pickRanks(1); const k = pickRanks(3, [p]); return { cards: offsuit([p, p, ...k]), t: [1, p, ...k] }; },
  () => { const [a, b] = pickRanks(2); const [k] = pickRanks(1, [a, b]); return { cards: offsuit([a, a, b, b, k]), t: [2, a, b, k] }; },
  () => { const [x] = pickRanks(1); const k = pickRanks(2, [x]); return { cards: offsuit([x, x, x, ...k]), t: [3, x, ...k] }; },
  () => { const top = 3 + ri(10); return { cards: offsuit(straightRanks(top)), t: [4, top] }; },
  () => { let r; do r = pickRanks(5); while (isStraight(r)); return { cards: suited(r), t: [5, ...r] }; },
  () => { const [x, y] = shuffle(pickRanks(2), rng); return { cards: offsuit([x, x, x, y, y]), t: [6, x, y] }; },
  () => { const [q, k] = shuffle(pickRanks(2), rng); return { cards: offsuit([q, q, q, q, k]), t: [7, q, k] }; },
  () => { const top = 3 + ri(10); return { cards: suited(straightRanks(top)), t: [8, top] }; },
];
const expectedIndex = (t) => (t[0] === 8 && t[1] === 12 ? 9 : t[0]);

test('hand ranking: 1,800 constructed hands match their known category', () => {
  const seenIdx = new Set();
  for (let i = 0; i < 1800; i++) {
    const { cards, t } = GENERATORS[i % GENERATORS.length]();
    const sc = evaluateScore(shuffle([...cards], rng));
    assert.equal(handRankIndex(sc), expectedIndex(t), `${cards} expected ${HAND_NAMES[expectedIndex(t)]}`);
    seenIdx.add(expectedIndex(t));
    counters.handRankingCases++;
  }
  // make sure royal flush appeared too
  assert.equal(handRankIndex(evaluateScore(suited(straightRanks(12)))), 9);
  assert.equal(seenIdx.size, 10);
  return `categories covered: ${seenIdx.size}/10`;
});

test('hand ranking: 3,000 constructed pairs (same and different categories, forced ties) compare correctly', () => {
  let ties = 0;
  for (let i = 0; i < 3000; i++) {
    const ga = GENERATORS[ri(9)];
    const same = i % 3 === 0;
    const gb = same ? ga : GENERATORS[ri(9)];
    const A = ga();
    let B = gb();
    if (i % 10 === 0) {
      // forced tie: same ranks, re-suited (keep flush/non-flush shape)
      const ranks = A.cards.map((c) => c >> 2);
      B = { cards: A.t[0] === 5 || A.t[0] === 8 ? suited(ranks) : offsuit(ranks), t: A.t };
    }
    const exp = cmpTuple(A.t, B.t);
    if (exp === 0) ties++;
    const got = Math.sign(evaluateScore(A.cards) - evaluateScore(B.cards));
    assert.equal(got, exp, `${A.cards} vs ${B.cards}`);
    counters.handRankingCases++;
  }
  return `${ties} ties`;
});

test('hand ranking: exhaustive 2,598,960 five-card hands give the textbook category counts', () => {
  const counts = new Array(10).fill(0);
  const c = [0, 0, 0, 0, 0];
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let d = b + 1; d < 52; d++)
        for (let e = d + 1; e < 52; e++)
          for (let f = e + 1; f < 52; f++) {
            c[0] = a; c[1] = b; c[2] = d; c[3] = e; c[4] = f;
            counts[handRankIndex(evaluateScore(c))]++;
          }
  assert.deepEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 36, 4]);
  counters.handRankingCases += 10;
  return 'high 1302540 … royal 4';
});

test('hand ranking: 4,000 random 7-card hands agree with brute-force reference', () => {
  const r = makeRng('seven-card-xcheck', 7);
  const hands = [];
  for (let i = 0; i < 4000; i++) {
    const deck = shuffle([...Array(52).keys()], r);
    const cards = deck.slice(0, 7);
    const ref = refBest(cards);
    const sc = evaluateScore(cards);
    assert.equal(evaluate(cards).name, refName(ref), String(cards));
    hands.push({ sc, ref });
    counters.handRankingCases++;
  }
  for (let i = 0; i + 1 < hands.length; i++) {
    const x = hands[i], y = hands[i + 1];
    assert.equal(Math.sign(x.sc - y.sc), cmpTuple(x.ref, y.ref));
    counters.handRankingCases++;
  }
  return '7,999 checks';
});
