// AI pacing for the browser. The AI decides in a few milliseconds; we add a short,
// human-feeling pause but always act well inside the 2-second limit.
export const AI_TIME_LIMIT_MS = 2000;
export const AI_MIN_DELAY_MS = 350;
export const AI_MAX_DELAY_MS = 1100;

/** Total think time target for one AI action (ms), from a [0,1) random value. */
export function thinkDelay(u) {
  return Math.round(AI_MIN_DELAY_MS + u * (AI_MAX_DELAY_MS - AI_MIN_DELAY_MS));
}

/** Remaining wait after the decision took computeMs. */
export function remainingDelay(targetMs, computeMs) {
  return Math.max(0, Math.min(targetMs, AI_TIME_LIMIT_MS - 200) - computeMs);
}
