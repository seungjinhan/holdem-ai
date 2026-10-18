// Cards are integers 0..51: rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3.
import { makeRng, shuffle } from './rng.js';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const makeCard = (rank, suit) => (rank << 2) | suit;

export function cardToString(c) {
  return RANK_CHARS[c >> 2] + SUIT_CHARS[c & 3];
}

export function parseCard(s) {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0 || s.length !== 2) throw new Error(`Bad card: ${s}`);
  return makeCard(r, su);
}

export function parseCards(str) {
  return str.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

export function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** The deck for a given hand is a pure function of (game seed, hand number, salt). */
export function shuffledDeck(seed, handNo, salt = 0) {
  return shuffle(newDeck(), makeRng('deck', seed, handNo, salt));
}
