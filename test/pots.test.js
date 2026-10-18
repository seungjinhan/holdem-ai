import assert from 'node:assert/strict';
import { test } from './harness.js';
import { computePots, distributePots } from '../src/engine/pots.js';
import { Table, totalChips } from '../src/engine/engine.js';
import { stackDeck } from './helpers.js';
import { refereeHand } from './referee.js';

export const counters = { sidePotCases: 0 };

test('side pots: three different stacks all-in + a caller (hand-calculated)', () => {
  // A=100, B=300, C=500 all-in, D calls 500.
  const pots = computePots([100, 300, 500, 500], [false, false, false, false]);
  assert.deepEqual(pots, [
    { amount: 400, eligible: [0, 1, 2, 3] }, // 100 x 4
    { amount: 600, eligible: [1, 2, 3] }, // 200 x 3
    { amount: 400, eligible: [2, 3] }, // 200 x 2
  ]);
  // A best, then B, then C, D worst.
  const { payouts } = distributePots(pots, [40, 30, 20, 10], [0, 1, 2, 3], 4);
  assert.deepEqual(payouts, [400, 600, 400, 0]);
  // D best: D scoops everything.
  assert.deepEqual(distributePots(pots, [1, 2, 3, 4], [0, 1, 2, 3], 4).payouts, [0, 0, 0, 1400]);
  // C best, A second: C takes all three pots (eligible for all).
  assert.deepEqual(distributePots(pots, [3, 1, 4, 2], [0, 1, 2, 3], 4).payouts, [0, 0, 1400, 0]);
  // A best, D second: A main 400, D both side pots 1000.
  assert.deepEqual(distributePots(pots, [9, 1, 2, 5], [0, 1, 2, 3], 4).payouts, [400, 0, 0, 1000]);
  counters.sidePotCases += 5;
});

test('side pots: folded chips stay in the pot but folded seats cannot win', () => {
  // A all-in 50; B bet 200 then folded; C called 200.
  const pots = computePots([50, 200, 200], [false, true, false]);
  assert.deepEqual(pots, [
    { amount: 150, eligible: [0, 2] },
    { amount: 300, eligible: [2] },
  ]);
  assert.deepEqual(distributePots(pots, [9, -Infinity, 1], [0, 1, 2], 3).payouts, [150, 0, 300]);
  counters.sidePotCases += 2;
});

test('side pots: split pot with odd chip goes to first winner left of the button', () => {
  // two live players 25 each, a folded player put in 35 (more than any live player)
  const pots = computePots([25, 25, 35], [false, false, true]);
  assert.deepEqual(pots, [{ amount: 85, eligible: [0, 1] }]);
  // tie; button is seat 0 so order is 1,2,0 -> seat 1 gets the odd chip
  assert.deepEqual(distributePots(pots, [7, 7, -Infinity], [1, 2, 0], 3).payouts, [42, 43, 0]);
  // three-way tie on 100 -> 34/33/33
  const p3 = computePots([100 / 3 | 0, 33, 34], [false, false, false]);
  const total = p3.reduce((a, p) => a + p.amount, 0);
  assert.equal(total, 100);
  const pay = distributePots(p3, [5, 5, 5], [0, 1, 2], 3).payouts;
  assert.equal(pay.reduce((a, b) => a + b, 0), 100);
  counters.sidePotCases += 3;
});

test('side pots: uncalled excess is returned to the bettor', () => {
  const pots = computePots([300, 1000], [false, false]);
  assert.deepEqual(pots, [
    { amount: 600, eligible: [0, 1] },
    { amount: 700, eligible: [1] },
  ]);
  assert.deepEqual(distributePots(pots, [2, 1], [0, 1], 2).payouts, [600, 700]);
  counters.sidePotCases += 2;
});

test('side pots (engine, stacked deck): 3 players with different stacks all-in, 4th calls', () => {
  const table = Table.create({
    seed: 99,
    players: [
      { name: 'A', chips: 100 },
      { name: 'B', chips: 300 },
      { name: 'C', chips: 500 },
      { name: 'D', chips: 1000 },
    ],
  });
  const { deck } = stackDeck(table.state, ['Ah As', 'Kh Ks', 'Qh Qs', '7c 2d'], '2c 5d 9h Js 3s');
  table.startHand(0, deck);
  while (table.state.phase === 'betting') {
    const L = table.legal;
    // A, B, C shove; D just calls.
    if (L.seat === 3) table.act(3, L.canCheck ? 'check' : 'call');
    else table.act(L.seat, 'allin');
  }
  const chips = table.state.players.map((p) => p.chips);
  // main 400 -> A (aces), side 600 -> B (kings), side 400 -> C (queens); D only called 500, keeps the other 500
  assert.deepEqual(chips, [400, 600, 400, 500]);
  assert.equal(totalChips(table.state), 1900);
  const awards = table.state.hand.result.awards.map((a) => [a.amount, a.winners]);
  assert.deepEqual(awards, [
    [400, [0]],
    [600, [1]],
    [400, [2]],
  ]);
  assert.deepEqual(refereeHand(table.state.hand.log, { n: 4, smallBlind: 5, bigBlind: 10 }), []);
  counters.sidePotCases += 1;
});

test('side pots (engine, stacked deck): short stack wins main, big stacks split the side pot', () => {
  const table = Table.create({
    seed: 5,
    players: [
      { name: 'A', chips: 150 },
      { name: 'B', chips: 600 },
      { name: 'C', chips: 600 },
    ],
  });
  // A has a flush; B and C both play the broadway straight (split side pot).
  const { deck } = stackDeck(table.state, ['8h 2h', 'Ac 3d', 'Ad 4c'], 'Kh Qh Jd Th 9s');
  table.startHand(0, deck);
  while (table.state.phase === 'betting') table.act(table.legal.seat, 'allin');
  const chips = table.state.players.map((p) => p.chips);
  // A: main 450 (flush). Side: 900 split 450/450 between B and C.
  assert.deepEqual(chips, [450, 450, 450]);
  assert.deepEqual(refereeHand(table.state.hand.log, { n: 3, smallBlind: 5, bigBlind: 10 }), []);
  counters.sidePotCases += 1;
});

test('side pots: 2,000 random contribution sets agree with reference peel algorithm', async () => {
  const { refPots } = await import('./reference.js');
  const { makeRng } = await import('../src/engine/rng.js');
  const r = makeRng('pots-fuzz', 3);
  for (let i = 0; i < 2000; i++) {
    const n = 2 + Math.floor(r() * 5);
    const contrib = Array.from({ length: n }, () => (r() < 0.15 ? 0 : 1 + Math.floor(r() * 50) * 10));
    const out = contrib.map((c) => c === 0 || r() < 0.3);
    if (out.every((x) => x)) out[contrib.findIndex((c) => c > 0) >= 0 ? contrib.findIndex((c) => c > 0) : 0] = false;
    if (contrib.every((c) => c === 0)) contrib[0] = 10;
    const a = computePots(contrib, out);
    const b = refPots(contrib, out);
    const sum = (ps) => ps.reduce((x, p) => x + p.amount, 0);
    assert.equal(sum(a), contrib.reduce((x, y) => x + y, 0));
    assert.equal(sum(a), sum(b));
    assert.deepEqual(a.map((p) => p.eligible), b.map((p) => p.eligible).filter((e) => e.length));
    counters.sidePotCases++;
  }
});
