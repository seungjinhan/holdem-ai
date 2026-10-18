import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from './harness.js';
import { Table, replay, reduce, legalActions, checkAction, totalChips, playerView, RuleError } from '../src/engine/engine.js';
import { shuffledDeck, parseCards } from '../src/engine/cards.js';
import { makeRng } from '../src/engine/rng.js';
import { aiDecision } from '../src/ai/agent.js';
import { buildControls, betRaiseAction, clampAmount } from '../src/ui/controls.js';
import { saveFinishedHand, markHandInProgress, loadGame, memoryStorage } from '../src/ui/persist.js';
import { AI_TIME_LIMIT_MS, AI_MAX_DELAY_MS, thinkDelay, remainingDelay } from '../src/ui/timing.js';
import { refBest, cmpTuple } from './reference.js';
import { refereeHand } from './referee.js';
import { stackDeck, checkCallDown } from './helpers.js';

const fourPlayers = () => [
  { name: 'You', kind: 'human' },
  { name: 'AI 1', kind: 'ai', style: 'tight' },
  { name: 'AI 2', kind: 'ai', style: 'loose' },
  { name: 'AI 3', kind: 'ai', style: 'tight' },
];

// ---------------------------------------------------------------- AC1
test('AC1: human + 3 AI play a hand to showdown: blinds, 4 betting rounds, winner, payout, button move', () => {
  const t = Table.create({ seed: 4242, players: fourPlayers() });
  t.startHand();
  const h0 = t.state.hand;
  const { button, sb, bb } = h0;
  assert.equal(sb, (button + 1) % 4);
  assert.equal(bb, (button + 2) % 4);
  const blinds = h0.log.filter((e) => e.t === 'blind');
  assert.deepEqual(blinds.map((b) => [b.seat, b.kind, b.amount]), [[sb, 'sb', 5], [bb, 'bb', 10]]);
  assert.equal(h0.toAct, (button + 3) % 4, 'UTG acts first preflop');
  checkCallDown(t);
  const h = t.state.hand;
  const streets = h.log.filter((e) => e.t === 'street').map((e) => [e.street, e.board.length]);
  assert.deepEqual(streets, [['preflop', 0], ['flop', 3], ['turn', 4], ['river', 5]]);
  const actStreets = new Set(h.log.filter((e) => e.t === 'act').map((e) => e.street));
  assert.deepEqual([...actStreets], ['preflop', 'flop', 'turn', 'river'], 'betting happened on all 4 streets');
  // Postflop the first actor is the first live seat left of the button.
  const firstFlopAct = h.log.find((e) => e.t === 'act' && e.street === 'flop');
  assert.equal(firstFlopAct.seat, (button + 1) % 4);
  // Winner = best hand by the independent reference evaluator.
  const sd = h.log.find((e) => e.t === 'showdown');
  assert.equal(sd.hands.length, 4);
  const best = sd.hands.map((x) => refBest([...x.cards, ...h.board]));
  let top = best[0];
  for (const b of best) if (cmpTuple(b, top) > 0) top = b;
  const expWinners = sd.hands.filter((x, i) => cmpTuple(best[i], top) === 0).map((x) => x.seat).sort();
  const awards = h.log.filter((e) => e.t === 'award');
  assert.deepEqual([...awards[0].winners].sort(), expWinners);
  assert.equal(awards.reduce((a, e) => a + e.amount, 0), 40, 'pot of 4 x 10 paid out');
  assert.equal(totalChips(t.state), 4000);
  assert.deepEqual(refereeHand(h.log, { n: 4, smallBlind: 5, bigBlind: 10 }), []);
  // Button moves one seat clockwise.
  t.startHand();
  assert.equal(t.state.hand.button, (button + 1) % 4);
  return `button ${button}→${t.state.hand.button}, winners ${expWinners.join(',')}`;
});

test('heads-up: button posts the small blind and acts first preflop, last postflop', () => {
  const t = Table.create({ seed: 1, players: [{ name: 'A' }, { name: 'B' }] });
  t.startHand();
  const h = t.state.hand;
  assert.equal(h.sb, h.button);
  assert.equal(h.toAct, h.button);
  t.act(h.button, 'call');
  t.act(h.bb, 'check');
  assert.equal(t.state.hand.board.length, 3);
  assert.equal(t.state.hand.toAct, h.bb, 'big blind acts first postflop heads-up');
});

test('big blind gets the option when limped to', () => {
  const t = Table.create({ seed: 3, players: fourPlayers() });
  t.startHand();
  const { bb } = t.state.hand;
  while (t.state.hand.toAct !== bb) t.act(t.legal.seat, 'call');
  const L = t.legal;
  assert.equal(L.canCheck, true);
  assert.deepEqual(L.raise, { min: 20, max: 1000 });
  t.act(bb, 'check');
  assert.equal(t.state.hand.board.length, 3);
});

// ---------------------------------------------------------------- rules / AC4 backing
test('min-raise and stack limits are enforced (illegal amounts rejected)', () => {
  const t = Table.create({ seed: 8, players: fourPlayers() });
  t.startHand();
  const s0 = t.legal.seat;
  assert.deepEqual(t.legal.raise, { min: 20, max: 1000 });
  assert.throws(() => t.act(s0, 'raise', 19), RuleError);
  assert.throws(() => t.act(s0, 'raise', 1001), RuleError);
  assert.throws(() => t.act(s0, 'raise', 25.5), RuleError);
  assert.throws(() => t.act(s0, 'check'), RuleError);
  assert.throws(() => t.act(s0, 'bet', 50), RuleError, 'cannot "bet" facing the blind');
  assert.throws(() => t.act((s0 + 1) % 4, 'call'), RuleError, 'out of turn');
  t.act(s0, 'raise', 50); // raise by 40
  const s1 = t.legal.seat;
  assert.equal(t.legal.minRaise, 40);
  assert.deepEqual(t.legal.raise, { min: 90, max: 1000 });
  assert.throws(() => t.act(s1, 'raise', 89), RuleError);
  t.act(s1, 'raise', 90);
  assert.equal(t.state.hand.currentBet, 90);
  assert.equal(totalChips(t.state), 4000);
});

test('incomplete all-in raise does not reopen betting; cumulative full raise does', () => {
  // seats: 0 big, 1 short (all-in for a little more), 2 big
  const t = Table.create({ seed: 11, players: [{ name: 'A', chips: 1000 }, { name: 'B', chips: 130 }, { name: 'C', chips: 1000 }] });
  t.startHand();
  // Play to the flop with everyone calling.
  while (t.state.hand.street === 0) t.act(t.legal.seat, t.legal.canCheck ? 'check' : 'call');
  const h = t.state.hand;
  const order = [1, 2, 3].map((i) => (h.button + i) % 3);
  // First to act bets 100.
  const first = t.legal.seat;
  assert.equal(first, order[0]);
  assert.notEqual(first, 1, 'seed chosen so the short stack is not the first bettor');
  t.act(first, 'bet', 100);
  // Walk to seat 1 (short, 120 behind) acting.
  while (t.legal.seat !== 1) t.act(t.legal.seat, 'call');
  assert.equal(t.legal.stack, 120);
  assert.equal(t.legal.raise, null, 'cannot make a full raise to 200 with 120');
  assert.equal(t.legal.allIn, 120);
  t.act(1, 'allin'); // to 120: incomplete raise of 20
  // Anyone who already called 100 may only call 20 or fold.
  let checkedSeats = 0;
  while (t.state.phase === 'betting' && t.state.hand.street === 1) {
    const L = t.legal;
    if (t.state.hand.acted[L.seat]) {
      assert.equal(L.raise, null, `seat ${L.seat} must not be allowed to re-raise`);
      assert.equal(L.allIn, null);
      assert.equal(L.call, 20);
      assert.equal(checkAction(t.state, { seat: L.seat, action: 'raise', amount: 300 }) !== null, true);
      checkedSeats++;
    }
    t.act(L.seat, 'call');
  }
  assert.ok(checkedSeats >= 1, 'at least one seat faced the incomplete raise');

  // Cumulative: bet 100, all-in to 150, all-in to 200 => original bettor may re-raise.
  const u = Table.create({ seed: 12, players: [{ name: 'A', chips: 1000 }, { name: 'B', chips: 160 }, { name: 'C', chips: 210 }, { name: 'D', chips: 1000 }] });
  u.startHand();
  while (u.state.hand.street === 0) u.act(u.legal.seat, u.legal.canCheck ? 'check' : 'call');
  // force order: find bettor among big stacks
  let guard = 0;
  let reached = false;
  while (u.state.hand.street === 1 && guard++ < 20) {
    const L = u.legal;
    if (L.currentBet === 0 && (L.seat === 0 || L.seat === 3)) { u.act(L.seat, 'bet', 100); continue; }
    if (L.currentBet === 0) { u.act(L.seat, 'check'); continue; }
    if (L.seat === 1 || L.seat === 2) { u.act(L.seat, 'allin'); continue; }
    if (u.state.hand.acted[L.seat] && u.state.hand.streetBet[L.seat] === 100 && L.currentBet === 200) {
      assert.ok(L.raise, 'bettor faces cumulative raise of 100 >= min raise, betting reopened');
      reached = true;
      break;
    }
    u.act(L.seat, 'call');
  }
  assert.ok(reached, 'cumulative-raise scenario reached');
});

test('short stack facing a bet can only fold or call all-in', () => {
  const t = Table.create({ seed: 21, players: [{ name: 'A', chips: 1000 }, { name: 'B', chips: 40 }] });
  t.startHand();
  // Get B facing a raise larger than its stack.
  if (t.legal.seat === 0) {
    t.act(0, 'raise', 200);
  } else {
    t.act(1, 'call');
    t.act(0, 'raise', 200);
  }
  const L = t.legal;
  assert.equal(L.seat, 1);
  assert.equal(L.raise, null);
  assert.equal(L.call, L.stack, 'call is capped at the remaining stack');
  const c = buildControls(L);
  assert.equal(c.betRaise.enabled, false);
  assert.equal(c.slider, null);
  assert.match(c.checkCall.label, /all-in/);
});

// ---------------------------------------------------------------- AC4: UI controls
test('AC4: UI controls only offer legal actions/amounts (5,000 random game states)', () => {
  const r = makeRng('controls-fuzz', 1);
  let states = 0;
  for (let g = 0; states < 5000; g++) {
    const n = 2 + (g % 5);
    const t = Table.create({ seed: 1000 + g, players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, chips: 20 + Math.floor(r() * 1500) })) });
    for (let hand = 0; hand < 30 && t.state.phase !== 'gameOver'; hand++) {
      t.startHand();
      while (t.state.phase === 'betting') {
        const L = t.legal;
        const c = buildControls(L);
        states++;
        const offered = [];
        if (c.fold.enabled) offered.push(c.fold.action);
        if (c.checkCall.enabled) offered.push(c.checkCall.action);
        if (c.allIn.enabled) offered.push(c.allIn.action);
        if (c.betRaise.enabled) {
          const range = L.bet ?? L.raise;
          assert.equal(c.slider.min, range.min);
          assert.equal(c.slider.max, range.max);
          assert.ok(c.slider.max <= L.streetBet + L.stack, 'slider never exceeds the stack');
          assert.ok(c.slider.min >= L.currentBet + (L.currentBet ? L.minRaise : 0) || L.currentBet === 0, 'slider never below min raise');
          // values outside the range are clamped back inside
          assert.equal(betRaiseAction(c, range.min - 1).amount, range.min);
          assert.equal(betRaiseAction(c, range.max + 1000).amount, range.max);
          for (const p of c.presets) offered.push({ action: c.betRaise.kind, amount: p.to });
          offered.push(betRaiseAction(c, range.min + Math.floor(r() * (range.max - range.min + 1))));
        } else {
          assert.equal(c.slider, null);
        }
        assert.ok(offered.length >= 1);
        for (const a of offered) assert.equal(checkAction(t.state, { seat: L.seat, ...a }), null, JSON.stringify(a));
        // Not offered => illegal
        if (!c.fold.enabled) assert.notEqual(checkAction(t.state, { seat: L.seat, action: 'fold' }), null);
        if (!c.betRaise.enabled) {
          assert.notEqual(checkAction(t.state, { seat: L.seat, action: 'raise', amount: L.currentBet + L.minRaise }), null);
        }
        const pick = offered[Math.floor(r() * offered.length)];
        t.act(L.seat, pick.action, pick.amount);
      }
    }
  }
  return `${states} states`;
});

// ---------------------------------------------------------------- AC6
test('AC6: AI decides well inside 2 s (compute) and UI pacing never exceeds the limit', () => {
  let max = 0;
  let n = 0;
  for (let g = 0; g < 30; g++) {
    const t = Table.create({ seed: 500 + g, players: Array.from({ length: 6 }, (_, i) => ({ name: `AI${i}`, style: i % 2 ? 'loose' : 'tight' })) });
    for (let k = 0; k < 10 && t.state.phase !== 'gameOver'; k++) {
      t.startHand();
      while (t.state.phase === 'betting') {
        const d = aiDecision(t.state, t.legal.seat, { iterations: 300 }); // browser setting
        max = Math.max(max, d.computeMs);
        n++;
        t.act(t.legal.seat, d.action, d.amount);
      }
    }
  }
  assert.ok(max < 500, `max compute ${max} ms`);
  assert.ok(AI_MAX_DELAY_MS < AI_TIME_LIMIT_MS);
  for (const u of [0, 0.5, 0.999]) {
    const target = thinkDelay(u);
    for (const compute of [0, max, 300]) assert.ok(compute + remainingDelay(target, compute) < AI_TIME_LIMIT_MS);
  }
  return `${n} decisions, max compute ${max.toFixed(2)} ms, max total think ≤ ${AI_MAX_DELAY_MS} ms`;
});

// ---------------------------------------------------------------- AC7
function playScripted(seed, { humanPolicy = 'mixed', hands = 25 } = {}) {
  const t = Table.create({ seed, players: fourPlayers() });
  for (let k = 0; k < hands && t.state.phase !== 'gameOver' && t.state.players[0].chips > 0; k++) {
    t.startHand();
    while (t.state.phase === 'betting') {
      const L = t.legal;
      if (L.seat === 0) {
        // deterministic "human": calls small bets, raises every 3rd hand, otherwise checks/folds
        if (humanPolicy === 'mixed' && L.raise && t.state.handNo % 3 === 0) t.act(0, 'raise', L.raise.min);
        else if (L.canCheck) t.act(0, 'check');
        else if (L.call <= 40) t.act(0, 'call');
        else t.act(0, 'fold');
      } else {
        const d = aiDecision(t.state, L.seat);
        t.act(L.seat, d.action, d.amount, { ts: Date.now(), thinkMs: d.computeMs, computeMs: d.computeMs });
      }
    }
  }
  return t;
}
const stripMeta = (events) => events.map(({ meta, ...e }) => e);

test('AC7: same seed => same cards and same game; replaying the event log reproduces the final state', () => {
  const a = playScripted(777);
  const b = playScripted(777);
  assert.deepEqual(stripMeta(a.events), stripMeta(b.events), 'identical event logs');
  for (let k = 1; k <= 5; k++) assert.deepEqual(shuffledDeck(777, k), shuffledDeck(777, k));
  const boardsA = a.events.length;
  // Replay
  const replayed = replay(a.events);
  assert.deepEqual(replayed, a.state, 'replayed state deep-equals the live state');
  // Replay through JSON (as saved to disk / sent over the network)
  assert.deepEqual(replay(JSON.parse(JSON.stringify(a.events))), a.state);
  // Different seed -> different cards
  const c = playScripted(778);
  assert.notDeepEqual(shuffledDeck(777, 1), shuffledDeck(778, 1));
  assert.notDeepEqual(stripMeta(a.events), stripMeta(c.events));
  // reduce() is pure: it never mutates its input
  const before = JSON.stringify(a.state);
  reduce(a.state, { type: 'HAND_STARTED', handNo: a.state.handNo + 1 });
  assert.equal(JSON.stringify(a.state), before);
  return `${boardsA} events, ${a.state.handNo} hands replayed`;
});

test('AI think-time is recorded in the event log', () => {
  const t = playScripted(31337, { hands: 3 });
  const aiActs = t.events.filter((e) => e.type === 'ACTION' && e.seat !== 0);
  assert.ok(aiActs.length > 0);
  for (const e of aiActs) {
    assert.equal(typeof e.meta.ts, 'number');
    assert.equal(typeof e.meta.thinkMs, 'number');
    assert.equal(typeof e.meta.computeMs, 'number');
  }
  const logged = t.state.hand.log.filter((e) => e.t === 'act' && e.seat !== 0);
  for (const e of logged) assert.ok(e.meta && typeof e.meta.thinkMs === 'number');
});

test('player view hides opponents\' hole cards until showdown', () => {
  const t = Table.create({ seed: 2, players: fourPlayers() });
  t.startHand();
  const v = playerView(t.state, 0);
  assert.ok(v.hand.hole);
  for (const s of v.hand.seats) if (s.seat !== 0) assert.equal(s.cards, null);
  assert.ok(v.hand.log.every((e) => e.t !== 'hole' || e.seat === 0));
});

// ---------------------------------------------------------------- AC8
test('AC8: engine is a pure module — no DOM/browser APIs, no wall-clock or Math.random', () => {
  const dir = new URL('../src/engine/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const forbidden = /\b(window|document|localStorage|sessionStorage|navigator|location|setTimeout|setInterval|requestAnimationFrame|fetch|performance|Date\.now|Math\.random|process)\b/;
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const m = src.match(forbidden);
    assert.equal(m, null, `${f} uses ${m && m[0]}`);
    for (const imp of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(imp[1], /^\.\/[\w-]+\.js$/, `${f} imports ${imp[1]}`);
  }
  return files.join(', ');
});

// ---------------------------------------------------------------- AC9
test('AC9: refresh mid-hand restores chips as of the last finished hand', () => {
  const storage = memoryStorage();
  const t = playScripted(4040, { hands: 6 });
  // finished hands -> save
  saveFinishedHand(storage, { events: t.events, settings: { ai: 3 }, salt: 0 });
  const chipsAfterFinished = t.state.players.map((p) => p.chips);
  // start another hand and play part of it (not saved)
  t.startHand();
  markHandInProgress(storage);
  t.act(t.legal.seat, t.legal.canCheck ? 'check' : 'call');
  // "refresh"
  const loaded = loadGame(storage);
  const restored = replay(loaded.events);
  assert.deepEqual(restored.players.map((p) => p.chips), chipsAfterFinished);
  assert.notEqual(restored.phase, 'betting');
  assert.equal(loaded.salt, 1, 'abandoned hand bumps the deck salt');
  // the next hand after reload uses a different deck than the abandoned one
  const r2 = new Table(loaded.events);
  r2.startHand(loaded.salt);
  assert.notDeepEqual(r2.state.hand.deck, t.state.hand.deck);
});

// ---------------------------------------------------------------- referee sanity
test('referee catches tampered logs (sanity check of the violation counter)', () => {
  const t = Table.create({ seed: 77, players: fourPlayers() });
  const { deck } = stackDeck(t.state, ['Ah As', 'Kh Ks', 'Qh Qs', '7c 2d'], '2c 5d 9h Js 3s');
  t.startHand(0, deck);
  checkCallDown(t);
  const log = t.state.hand.log;
  const opts = { n: 4, smallBlind: 5, bigBlind: 10 };
  assert.deepEqual(refereeHand(log, opts), []);
  const tamper = (fn) => {
    const copy = JSON.parse(JSON.stringify(log));
    fn(copy);
    return refereeHand(copy, opts);
  };
  assert.ok(tamper((l) => (l.find((e) => e.t === 'award').shares[0] += 1)).length > 0, 'wrong payout');
  assert.ok(tamper((l) => (l.find((e) => e.t === 'blind').amount = 4)).length > 0, 'wrong blind');
  assert.ok(tamper((l) => { const a = l.find((e) => e.t === 'act' && e.action === 'call'); a.action = 'check'; }).length > 0, 'check facing bet');
  assert.ok(tamper((l) => { const a = l.find((e) => e.t === 'act' && e.street === 'flop'); a.action = 'raise'; a.to = 5; a.add = 5; }).length > 0, 'raise below min');
  assert.ok(tamper((l) => { const i = l.findIndex((e) => e.t === 'act'); const j = l.findIndex((e, k) => k > i && e.t === 'act'); [l[i], l[j]] = [l[j], l[i]]; }).length > 0, 'out of turn');
  assert.ok(tamper((l) => (l.find((e) => e.t === 'end').stacks[0] += 10)).length > 0, 'chips created');
});

test('engine rejects malformed games and events', () => {
  assert.throws(() => Table.create({ seed: 1, players: [{ name: 'solo' }] }), RuleError);
  assert.throws(() => Table.create({ seed: 1, players: Array.from({ length: 7 }, () => ({})) }), RuleError);
  const t = Table.create({ seed: 1, players: fourPlayers() });
  assert.throws(() => t.dispatch({ type: 'HAND_STARTED', handNo: 5 }), RuleError);
  assert.throws(() => t.dispatch({ type: 'NOPE' }), RuleError);
  assert.throws(() => t.act(0, 'check'), RuleError);
  assert.throws(() => t.startHand(0, [1, 2, 3]), RuleError);
  assert.equal(legalActions(t.state), null);
  assert.equal(t.events.length, 1, 'rejected events are never appended');
});
