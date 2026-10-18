// Independent, deliberately simple reference implementations used to cross-check
// the engine. They share no code with src/.

// Card int: rank = c >> 2 (0..12), suit = c & 3 (same encoding as the engine).

/** Classify exactly 5 cards. Returns [category, ...tiebreak ranks]. Royal = SF with top 12. */
export function classify5(cards) {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = cards.map((c) => c & 3);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightTop = -1;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
    else if (ranks.join(',') === '12,3,2,1,0') straightTop = 3;
  }
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // groups sorted by count desc then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const byGroup = groups.map((g) => g[0]);
  if (straightTop >= 0 && flush) return [8, straightTop];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightTop >= 0) return [4, straightTop];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...ranks];
}

export function cmpTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** Best tuple over every 5-card subset (brute force, 21 subsets for 7 cards). */
export function refBest(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const t = classify5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || cmpTuple(t, best) > 0) best = t;
          }
  return best;
}

export const REF_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];
export function refName(t) {
  return t[0] === 8 && t[1] === 12 ? REF_NAMES[9] : REF_NAMES[t[0]];
}

/**
 * Reference side pots by "peeling": repeatedly take the smallest remaining
 * contribution among live players and build a pot layer from everyone.
 */
export function refPots(contrib, out) {
  const rem = [...contrib];
  const pots = [];
  for (;;) {
    const liveRem = rem.map((c, i) => (!out[i] && c > 0 ? c : Infinity));
    const m = Math.min(...liveRem);
    if (m === Infinity) {
      const left = rem.reduce((a, b) => a + b, 0);
      if (left > 0 && pots.length) pots[pots.length - 1].amount += left;
      break;
    }
    let amount = 0;
    const eligible = [];
    for (let i = 0; i < rem.length; i++) {
      const take = Math.min(rem[i], m);
      amount += take;
      rem[i] -= take;
      if (!out[i] && contrib[i] - rem[i] > 0 && take === m) eligible.push(i);
    }
    pots.push({ amount, eligible });
  }
  return pots;
}
