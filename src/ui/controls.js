// Pure mapping from engine legal actions to UI controls. No DOM here, so it is
// unit-tested in Node: the UI can only offer what legalActions() allows.

export function clampAmount(range, x) {
  if (!range) return null;
  const v = Math.round(Number(x));
  if (!Number.isFinite(v)) return range.min;
  return Math.max(range.min, Math.min(range.max, v));
}

/**
 * @param {object|null} legal  engine legalActions() for the human seat (null = not your turn)
 * @returns controls model
 */
export function buildControls(legal) {
  const off = { enabled: false };
  if (!legal) {
    return {
      myTurn: false,
      fold: { ...off, label: 'Fold' },
      checkCall: { enabled: false, label: 'Check' },
      betRaise: { enabled: false, label: 'Bet' },
      allIn: { ...off, label: 'All-in' },
      slider: null,
      presets: [],
    };
  }
  const { stack, streetBet, toCall, call, pot } = legal;
  const range = legal.bet ?? legal.raise ?? null;
  const kind = legal.bet ? 'bet' : 'raise';
  const callAllIn = call != null && call >= stack;
  const checkCall = legal.canCheck
    ? { enabled: true, label: 'Check', action: { action: 'check' } }
    : { enabled: call != null, label: callAllIn ? `Call ${call} (all-in)` : `Call ${call}`, action: { action: 'call' } };
  const presets = [];
  if (range) {
    const afterCall = pot + toCall;
    const add = (label, to) => {
      const v = clampAmount(range, to);
      if (!presets.some((p) => p.to === v)) presets.push({ label, to: v });
    };
    add('Min', range.min);
    add('½ Pot', legal.currentBet + Math.floor(afterCall / 2));
    add('Pot', legal.currentBet + afterCall);
  }
  return {
    myTurn: true,
    fold: { enabled: legal.canFold, label: 'Fold', action: { action: 'fold' } },
    checkCall,
    betRaise: range
      ? { enabled: true, label: kind === 'bet' ? 'Bet' : 'Raise to', kind, min: range.min, max: range.max }
      : { enabled: false, label: legal.currentBet === 0 ? 'Bet' : 'Raise to' },
    allIn:
      legal.allIn != null && !callAllIn
        ? { enabled: true, label: `All-in ${stack}`, to: legal.allIn, action: { action: 'allin' } }
        : { enabled: false, label: 'All-in' },
    slider: range ? { min: range.min, max: range.max, step: 1, value: range.min } : null,
    presets,
    info: { toCall, stack, streetBet, pot },
  };
}

/** Action for the bet/raise button given the slider value (clamped to the legal range). */
export function betRaiseAction(controls, sliderValue) {
  const b = controls.betRaise;
  if (!b.enabled) return null;
  return { action: b.kind, amount: clampAmount(b, sliderValue) };
}
