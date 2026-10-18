// Side-pot construction and distribution. Pure.

/**
 * @param {number[]} contrib  total chips each seat put in this hand
 * @param {boolean[]} folded  seat folded?
 * @returns {{amount:number, eligible:number[]}[]} main pot first
 */
export function computePots(contrib, folded) {
  const levels = [...new Set(contrib.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  let carry = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contrib) amount += Math.min(c, level) - Math.min(c, prev);
    const eligible = [];
    contrib.forEach((c, seat) => {
      if (!folded[seat] && c >= level) eligible.push(seat);
    });
    prev = level;
    if (eligible.length === 0) {
      // Chips above every live player's contribution (only possible if the top
      // contributors folded): fold them into the previous pot.
      if (pots.length) pots[pots.length - 1].amount += amount;
      else carry += amount;
      continue;
    }
    amount += carry;
    carry = 0;
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length && last.eligible.every((s, i) => s === eligible[i])) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots;
}

/**
 * Award pots. `scores[seat]` = hand score (higher wins). `order` = seats clockwise
 * starting left of the button; odd chips go to the earliest winner in that order.
 * @returns {{payouts:number[], awards:{amount:number, eligible:number[], winners:number[], shares:number[]}[]}}
 */
export function distributePots(pots, scores, order, seatCount) {
  const payouts = new Array(seatCount).fill(0);
  const awards = [];
  for (const pot of pots) {
    let best = -Infinity;
    for (const s of pot.eligible) if (scores[s] > best) best = scores[s];
    const winners = order.filter((s) => pot.eligible.includes(s) && scores[s] === best);
    const base = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - base * winners.length;
    const shares = winners.map(() => base);
    for (let i = 0; rem > 0; i = (i + 1) % winners.length, rem--) shares[i]++;
    winners.forEach((s, i) => (payouts[s] += shares[i]));
    awards.push({ amount: pot.amount, eligible: pot.eligible, winners, shares });
  }
  return { payouts, awards };
}
