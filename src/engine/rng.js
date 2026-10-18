// Seeded pseudo-random numbers. Pure, no platform APIs.
// mulberry32: tiny, fast, good enough for card shuffling in a game (not for real-money use).

export function hashSeed(...parts) {
  // FNV-1a over the joined string form of all parts -> uint32
  const s = parts.map(String).join('\u241f');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic RNG derived from any list of seed parts. */
export function makeRng(...parts) {
  return mulberry32(hashSeed(...parts));
}

export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/** In-place Fisher-Yates shuffle. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
