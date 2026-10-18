// Save / restore the game in a localStorage-like store. Pure apart from the
// injected `storage` object, so it is unit-tested in Node with an in-memory store.
//
// Only events up to the last *finished* hand are saved, so a refresh mid-hand
// restores the chip counts as of the end of the previous hand. A hand abandoned by a
// refresh bumps the deck salt so the same cards are not dealt again.

export const STORAGE_KEY = 'holdem-ai:v1';

export function saveFinishedHand(storage, { events, settings, salt }) {
  const data = { v: 1, events, settings, salt: salt ?? 0, inProgress: false, savedAt: Date.now() };
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Call when a new hand starts (not saving its events, just flagging it). */
export function markHandInProgress(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    data.inProgress = true;
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

/** @returns {{events:object[], settings:object, salt:number}|null} */
export function loadGame(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.v !== 1 || !Array.isArray(data.events)) return null;
    return { events: data.events, settings: data.settings ?? {}, salt: (data.salt ?? 0) + (data.inProgress ? 1 : 0) };
  } catch {
    return null;
  }
}

export function clearGame(storage) {
  storage.removeItem(STORAGE_KEY);
}

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
