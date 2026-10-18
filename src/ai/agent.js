// Glue between the engine and the AI: build the seat's view, seed the rng
// deterministically, decide, and measure compute time. Usable in Node and browsers.

import { playerView } from '../engine/engine.js';
import { makeRng } from '../engine/rng.js';
import { decide, STYLES } from './ai.js';

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

/** RNG for one AI decision: same seed + same history => same decision. */
export function decisionRng(state, seat) {
  const h = state.hand;
  return makeRng('ai', state.seed, h.handNo, h.salt, h.actionCount, seat);
}

/** @returns {{action:string, amount?:number, computeMs:number}} */
export function aiDecision(state, seat, opts = {}) {
  const t0 = now();
  const view = playerView(state, seat);
  const styleId = state.players[seat].style;
  const style = STYLES[styleId] ?? STYLES.tight;
  const choice = decide(view, style, decisionRng(state, seat), opts);
  const computeMs = Math.round((now() - t0) * 100) / 100;
  return { ...choice, computeMs };
}
