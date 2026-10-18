// Event-sourced No-Limit Texas Hold'em engine.
//
// - Pure module: no DOM, no browser APIs, no timers, no Math.random.
// - State only changes through serialisable events: GAME_CREATED, HAND_STARTED, ACTION.
// - reduce(state, event) never mutates `state`; replay(events) rebuilds any state.
// - The deck for each hand is derived from (seed, handNo, salt), so the same seed and
//   the same action events always reproduce the same game.
// - Seats act through one interface (ACTION events); the engine does not know whether a
//   seat is a human or an AI.

import { shuffledDeck } from './cards.js';
import { evaluateScore, handName } from './evaluator.js';
import { computePots, distributePots } from './pots.js';
import { makeRng, randInt } from './rng.js';

export const DEFAULT_CONFIG = Object.freeze({ startingChips: 1000, smallBlind: 5, bigBlind: 10 });
export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuleError';
  }
}

const clone = typeof structuredClone === 'function' ? structuredClone : (o) => JSON.parse(JSON.stringify(o));

export function initialState() {
  return { seed: null, config: null, players: [], handNo: 0, button: -1, phase: 'empty', hand: null, eventCount: 0 };
}

/** Build the GAME_CREATED event. players: [{id?, name, kind?: 'human'|'ai', style?}] */
export function createGameEvent({ seed, players, startingChips, smallBlind, bigBlind } = {}) {
  const config = {
    startingChips: startingChips ?? DEFAULT_CONFIG.startingChips,
    smallBlind: smallBlind ?? DEFAULT_CONFIG.smallBlind,
    bigBlind: bigBlind ?? DEFAULT_CONFIG.bigBlind,
  };
  return {
    type: 'GAME_CREATED',
    seed: seed ?? 0,
    config,
    players: players.map((p, i) => ({
      id: p.id ?? `p${i}`,
      name: p.name ?? `Player ${i + 1}`,
      kind: p.kind ?? 'ai',
      style: p.style ?? null,
      ...(p.chips != null ? { chips: p.chips } : {}),
    })),
  };
}

// ---------------------------------------------------------------- reducer

export function reduce(state, event) {
  if (!event || typeof event.type !== 'string') throw new RuleError('Malformed event');
  const s = clone(state);
  switch (event.type) {
    case 'GAME_CREATED':
      gameCreated(s, event);
      break;
    case 'HAND_STARTED':
      handStarted(s, event);
      break;
    case 'ACTION':
      applyAction(s, event);
      break;
    default:
      throw new RuleError(`Unknown event type ${event.type}`);
  }
  s.eventCount++;
  return s;
}

export function replay(events) {
  let s = initialState();
  for (const e of events) s = reduce(s, e);
  return s;
}

function gameCreated(s, ev) {
  if (s.phase !== 'empty') throw new RuleError('Game already created');
  const n = ev.players?.length ?? 0;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new RuleError(`Need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const { startingChips, smallBlind, bigBlind } = ev.config;
  for (const v of [startingChips, smallBlind, bigBlind]) {
    if (!Number.isInteger(v) || v <= 0) throw new RuleError('Config values must be positive integers');
  }
  if (smallBlind > bigBlind) throw new RuleError('Small blind larger than big blind');
  s.seed = ev.seed;
  s.config = { ...ev.config };
  for (const p of ev.players) {
    if (p.chips != null && (!Number.isInteger(p.chips) || p.chips <= 0)) throw new RuleError('Player chips must be positive integers');
  }
  // `chips` per player is optional (used by tests for uneven stacks); default is startingChips.
  s.players = ev.players.map((p, seat) => ({ ...p, seat, chips: p.chips ?? startingChips }));
  s.phase = 'idle';
}

function nextSeat(n, from, pred) {
  for (let i = 1; i <= n; i++) {
    const k = (((from + i) % n) + n) % n;
    if (pred(k)) return k;
  }
  return -1;
}

function handStarted(s, ev) {
  if (s.phase !== 'idle' && s.phase !== 'handOver') throw new RuleError(`Cannot start a hand in phase ${s.phase}`);
  if (ev.handNo !== s.handNo + 1) throw new RuleError(`Expected hand ${s.handNo + 1}, got ${ev.handNo}`);
  const n = s.players.length;
  const dealt = s.players.filter((p) => p.chips > 0).map((p) => p.seat);
  if (dealt.length < 2) throw new RuleError('Not enough players with chips');
  const salt = ev.salt ?? 0;
  const inHand = s.players.map((p) => p.chips > 0);
  const button =
    s.button < 0 ? dealt[randInt(makeRng('button', s.seed), dealt.length)] : nextSeat(n, s.button, (k) => inHand[k]);
  const headsUp = dealt.length === 2;
  const sb = headsUp ? button : nextSeat(n, button, (k) => inHand[k]);
  const bb = nextSeat(n, sb, (k) => inHand[k]);
  const { smallBlind, bigBlind } = s.config;

  const h = {
    handNo: ev.handNo,
    salt,
    button,
    sb,
    bb,
    deck: ev.deck ? validDeck(ev.deck) : shuffledDeck(s.seed, ev.handNo, salt),
    deckPos: 0,
    inHand,
    folded: new Array(n).fill(false),
    allIn: new Array(n).fill(false),
    acted: new Array(n).fill(false),
    actedAt: new Array(n).fill(0),
    streetBet: new Array(n).fill(0),
    total: new Array(n).fill(0),
    hole: new Array(n).fill(null),
    board: [],
    street: 0,
    currentBet: 0,
    minRaise: bigBlind,
    toAct: -1,
    actionCount: 0,
    startStacks: s.players.map((p) => p.chips),
    log: [],
    result: null,
  };
  s.hand = h;
  s.button = button;
  s.handNo = ev.handNo;
  s.phase = 'betting';
  h.log.push({ t: 'start', handNo: h.handNo, salt, button, sb, bb, stacks: [...h.startStacks] });

  postBlind(s, sb, smallBlind, 'sb');
  postBlind(s, bb, bigBlind, 'bb');
  h.currentBet = bigBlind;
  h.minRaise = bigBlind;

  // Deal two cards to each seat, one at a time, starting left of the button.
  const order = [];
  for (let i = 1; i <= n; i++) {
    const k = (button + i) % n;
    if (inHand[k]) order.push(k);
  }
  for (const k of order) h.hole[k] = [];
  for (let r = 0; r < 2; r++) for (const k of order) h.hole[k].push(h.deck[h.deckPos++]);
  for (const k of order) h.log.push({ t: 'hole', seat: k, cards: [...h.hole[k]] });
  h.log.push({ t: 'street', street: 'preflop', board: [] });

  progress(s, bb);
}

// An explicit deck in HAND_STARTED is allowed (stacked-deck tests, phase-2 server dealing).
function validDeck(deck) {
  if (!Array.isArray(deck) || deck.length !== 52 || new Set(deck).size !== 52 || deck.some((c) => !Number.isInteger(c) || c < 0 || c > 51)) {
    throw new RuleError('Explicit deck must be a permutation of 0..51');
  }
  return [...deck];
}

function postBlind(s, seat, amount, kind) {
  const h = s.hand;
  const p = s.players[seat];
  const a = Math.min(amount, p.chips);
  p.chips -= a;
  h.streetBet[seat] += a;
  h.total[seat] += a;
  if (p.chips === 0) h.allIn[seat] = true;
  h.log.push({ t: 'blind', seat, kind, amount: a, allIn: p.chips === 0 });
}

function canActSeat(h, k) {
  return h.inHand[k] && !h.folded[k] && !h.allIn[k];
}

/** Advance the hand after an event until someone must act or the hand is over. */
function progress(s, lastSeat) {
  const h = s.hand;
  const n = s.players.length;
  for (;;) {
    const live = [];
    for (let k = 0; k < n; k++) if (h.inHand[k] && !h.folded[k]) live.push(k);
    if (live.length === 1) return finishUncontested(s, live[0]);
    const canAct = live.filter((k) => !h.allIn[k]);
    const done =
      canAct.length === 0 ||
      (canAct.length === 1 && h.streetBet[canAct[0]] >= h.currentBet) ||
      canAct.every((k) => h.acted[k] && h.streetBet[k] === h.currentBet);
    if (!done) {
      h.toAct = nextSeat(n, lastSeat, (k) => canActSeat(h, k) && (!h.acted[k] || h.streetBet[k] < h.currentBet));
      if (h.toAct < 0) throw new Error('Engine invariant: no seat to act');
      return;
    }
    if (h.street === 3) return showdown(s);
    // Next street.
    h.street++;
    h.streetBet.fill(0);
    h.acted.fill(false);
    h.actedAt.fill(0);
    h.currentBet = 0;
    h.minRaise = s.config.bigBlind;
    h.deckPos++; // burn
    const count = h.street === 1 ? 3 : 1;
    for (let i = 0; i < count; i++) h.board.push(h.deck[h.deckPos++]);
    h.log.push({ t: 'street', street: STREETS[h.street], board: [...h.board] });
    lastSeat = h.button;
  }
}

function finishUncontested(s, winner) {
  const h = s.hand;
  const amount = h.total.reduce((a, b) => a + b, 0);
  s.players[winner].chips += amount;
  h.result = {
    uncontested: true,
    showdown: [],
    awards: [{ amount, eligible: [winner], winners: [winner], shares: [amount] }],
    payouts: s.players.map((p) => (p.seat === winner ? amount : 0)),
  };
  h.log.push({ t: 'award', pot: 0, amount, winners: [winner], shares: [amount], uncontested: true });
  endHand(s);
}

function showdown(s) {
  const h = s.hand;
  const n = s.players.length;
  const scores = new Array(n).fill(-Infinity);
  const shown = [];
  // Show in order starting left of the button.
  const order = [];
  for (let i = 1; i <= n; i++) order.push((h.button + i) % n);
  for (const k of order) {
    if (h.inHand[k] && !h.folded[k]) {
      scores[k] = evaluateScore([...h.hole[k], ...h.board]);
      shown.push({ seat: k, cards: [...h.hole[k]], score: scores[k], name: handName(scores[k]) });
    }
  }
  const out = h.folded.map((f, k) => f || !h.inHand[k]);
  const pots = computePots(h.total, out);
  const { payouts, awards } = distributePots(pots, scores, order, n);
  payouts.forEach((v, k) => (s.players[k].chips += v));
  h.result = { uncontested: false, showdown: shown, awards, payouts };
  h.log.push({ t: 'showdown', board: [...h.board], hands: shown });
  awards.forEach((a, i) => h.log.push({ t: 'award', pot: i, ...a }));
  endHand(s);
}

function endHand(s) {
  const h = s.hand;
  h.toAct = -1;
  h.street = 4;
  const alive = s.players.filter((p) => p.chips > 0).length;
  s.phase = alive <= 1 ? 'gameOver' : 'handOver';
  h.log.push({ t: 'end', stacks: s.players.map((p) => p.chips) });
}

// ---------------------------------------------------------------- actions

/**
 * Legal options for the seat to act. Amounts for bet/raise/allIn are "to" totals
 * (the seat's total commitment on this street).
 */
export function legalActions(state) {
  const h = state.hand;
  if (state.phase !== 'betting' || !h || h.toAct < 0) return null;
  const seat = h.toAct;
  const chips = state.players[seat].chips;
  const mine = h.streetBet[seat];
  const toCall = Math.max(0, h.currentBet - mine);
  const pot = h.total.reduce((a, b) => a + b, 0);
  const bb = state.config.bigBlind;
  const res = {
    seat,
    street: STREETS[h.street],
    stack: chips,
    streetBet: mine,
    currentBet: h.currentBet,
    minRaise: h.minRaise,
    toCall,
    pot,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    call: toCall > 0 ? Math.min(toCall, chips) : null,
    bet: null,
    raise: null,
    allIn: null,
  };
  const maxTo = mine + chips;
  if (h.currentBet === 0) {
    if (chips > 0) res.allIn = maxTo;
    if (chips > bb) res.bet = { min: bb, max: maxTo };
  } else if (chips <= toCall) {
    res.allIn = maxTo; // all-in call
  } else {
    const reopened = !h.acted[seat] || h.currentBet - h.actedAt[seat] >= h.minRaise;
    if (reopened) {
      res.allIn = maxTo;
      const minTo = h.currentBet + h.minRaise;
      if (maxTo > minTo) res.raise = { min: minTo, max: maxTo };
    }
  }
  return res;
}

/** Returns null when legal, otherwise a reason string. Does not throw. */
export function checkAction(state, { seat, action, amount }) {
  if (state.phase !== 'betting') return `No betting in phase ${state.phase}`;
  const h = state.hand;
  if (seat !== h.toAct) return `Seat ${seat} acted out of turn (to act: ${h.toAct})`;
  const L = legalActions(state);
  switch (action) {
    case 'fold':
      return L.canFold ? null : 'Cannot fold when checking is free';
    case 'check':
      return L.canCheck ? null : 'Cannot check facing a bet';
    case 'call':
      return L.call != null ? null : 'Nothing to call';
    case 'bet':
    case 'raise': {
      const r = L[action];
      if (!r) return `Cannot ${action} now`;
      if (!Number.isInteger(amount)) return `${action} amount must be an integer`;
      if (amount < r.min || amount > r.max) return `${action} to ${amount} outside [${r.min}, ${r.max}]`;
      return null;
    }
    case 'allin':
      return L.allIn != null ? null : 'All-in not allowed (betting not reopened)';
    default:
      return `Unknown action ${action}`;
  }
}

function applyAction(s, ev) {
  const err = checkAction(s, ev);
  if (err) throw new RuleError(err);
  const h = s.hand;
  const seat = ev.seat;
  const p = s.players[seat];
  const before = h.streetBet[seat];
  let to = before;
  switch (ev.action) {
    case 'fold':
      h.folded[seat] = true;
      break;
    case 'check':
      break;
    case 'call':
      to = before + Math.min(h.currentBet - before, p.chips);
      break;
    case 'bet':
    case 'raise':
      to = ev.amount;
      break;
    case 'allin':
      to = before + p.chips;
      break;
  }
  if (to > before) {
    const add = to - before;
    p.chips -= add;
    h.streetBet[seat] = to;
    h.total[seat] += add;
    if (p.chips === 0) h.allIn[seat] = true;
    if (to > h.currentBet) {
      const inc = to - h.currentBet;
      if (inc >= h.minRaise) h.minRaise = inc; // full bet/raise
      h.currentBet = to;
    }
  }
  h.acted[seat] = true;
  h.actedAt[seat] = h.currentBet;
  h.actionCount++;
  const entry = {
    t: 'act',
    seat,
    street: STREETS[h.street],
    action: ev.action,
    add: to - before,
    to,
    allIn: h.allIn[seat],
  };
  if (ev.meta) entry.meta = { ...ev.meta };
  h.log.push(entry);
  progress(s, seat);
}

// ---------------------------------------------------------------- helpers

/** Chips on the table: stacks + chips committed to the current pot. Must never change. */
export function totalChips(state) {
  let t = state.players.reduce((a, p) => a + p.chips, 0);
  if (state.hand && state.phase === 'betting') t += state.hand.total.reduce((a, b) => a + b, 0);
  return t;
}

/** What one seat may see: own hole cards, board, public info. Opponents' cards only after showdown. */
export function playerView(state, seat) {
  const h = state.hand;
  const view = {
    seat,
    phase: state.phase,
    config: state.config,
    handNo: state.handNo,
    button: state.button,
    players: state.players.map((p) => ({ seat: p.seat, name: p.name, chips: p.chips })),
    hand: null,
    legal: h && h.toAct === seat ? legalActions(state) : null,
  };
  if (h) {
    const revealed = new Set((h.result?.showdown ?? []).map((x) => x.seat));
    view.hand = {
      handNo: h.handNo,
      street: STREETS[h.street] ?? 'done',
      board: [...h.board],
      hole: h.hole[seat] ? [...h.hole[seat]] : null,
      toAct: h.toAct,
      sb: h.sb,
      bb: h.bb,
      currentBet: h.currentBet,
      pot: h.total.reduce((a, b) => a + b, 0),
      seats: state.players.map((p, k) => ({
        seat: k,
        inHand: h.inHand[k],
        folded: h.folded[k],
        allIn: h.allIn[k],
        streetBet: h.streetBet[k],
        total: h.total[k],
        cards: k === seat || revealed.has(k) ? (h.hole[k] ? [...h.hole[k]] : null) : null,
      })),
      log: h.log.filter((e) => e.t !== 'hole' || e.seat === seat),
      result: h.result,
    };
  }
  return view;
}

/** Convenience wrapper holding the event list and current state. */
export class Table {
  constructor(events = []) {
    this.events = [];
    this.state = initialState();
    for (const e of events) this.dispatch(e);
  }
  static create(opts) {
    const t = new Table();
    t.dispatch(createGameEvent(opts));
    return t;
  }
  dispatch(event) {
    const next = reduce(this.state, event); // throws RuleError on illegal events
    this.events.push(event);
    this.state = next;
    return next;
  }
  startHand(salt = 0, deck) {
    const ev = { type: 'HAND_STARTED', handNo: this.state.handNo + 1, salt };
    if (deck) ev.deck = deck;
    return this.dispatch(ev);
  }
  act(seat, action, amount, meta) {
    const ev = { type: 'ACTION', seat, action };
    if (amount != null) ev.amount = amount;
    if (meta) ev.meta = meta;
    return this.dispatch(ev);
  }
  get legal() {
    return legalActions(this.state);
  }
}
