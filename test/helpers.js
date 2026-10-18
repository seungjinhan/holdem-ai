import { reduce } from '../src/engine/engine.js';
import { parseCards } from '../src/engine/cards.js';

/**
 * Build a stacked 52-card deck for the next hand of `state` so that seat k gets
 * holes[k] (string like 'As Ad') and the board is `board` (5 cards string).
 */
export function stackDeck(state, holes, board) {
  const dry = reduce(state, { type: 'HAND_STARTED', handNo: state.handNo + 1, salt: 0 });
  const h = dry.hand;
  const n = state.players.length;
  const order = [];
  for (let i = 1; i <= n; i++) {
    const k = (h.button + i) % n;
    if (h.inHand[k]) order.push(k);
  }
  const deck = [];
  const hc = {};
  for (const k of order) hc[k] = parseCards(holes[k]);
  for (let r = 0; r < 2; r++) for (const k of order) deck.push(hc[k][r]);
  const b = parseCards(board);
  const burn = () => deck.push(-1);
  burn(); deck.push(b[0], b[1], b[2]); burn(); deck.push(b[3]); burn(); deck.push(b[4]);
  const used = new Set(deck.filter((c) => c >= 0));
  const rest = [...Array(52).keys()].filter((c) => !used.has(c));
  for (let i = 0; i < deck.length; i++) if (deck[i] === -1) deck[i] = rest.shift();
  deck.push(...rest);
  return { deck, button: h.button, sb: h.sb, bb: h.bb, order };
}

/** Everyone checks/calls until the hand ends. */
export function checkCallDown(table) {
  while (table.state.phase === 'betting') {
    const L = table.legal;
    table.act(L.seat, L.canCheck ? 'check' : 'call');
  }
}
