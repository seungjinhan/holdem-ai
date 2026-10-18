// AI-vs-AI simulation. Every action is checked against the engine's legal-action
// rules before dispatch, every event is checked for chip conservation, and every
// finished hand is re-checked by the independent referee.
//
// CLI: node test/sim.js [--hands 10000] [--seed 20261018] [--iterations 60] [--random]

import { Table, checkAction, totalChips, legalActions, DEFAULT_CONFIG } from '../src/engine/engine.js';
import { hashSeed, makeRng } from '../src/engine/rng.js';
import { aiDecision } from '../src/ai/agent.js';
import { refereeHand } from './referee.js';

const STYLE_IDS = ['tight', 'loose'];
const MAX_HANDS_PER_GAME = 400;

/** Random-but-legal agent for stress testing (exercises many more all-ins / side pots). */
function randomDecision(state, seat, rng) {
  const L = legalActions(state);
  const opts = [];
  if (L.canFold && rng() < 0.5) opts.push({ action: 'fold' });
  if (L.canCheck) opts.push({ action: 'check' });
  if (L.call != null) opts.push({ action: 'call' }, { action: 'call' });
  const range = L.bet ?? L.raise;
  if (range) opts.push({ action: L.bet ? 'bet' : 'raise', amount: range.min + Math.floor(rng() * (range.max - range.min + 1)) });
  if (L.allIn != null && rng() < 0.25) opts.push({ action: 'allin' });
  if (!opts.length) opts.push(L.canCheck ? { action: 'check' } : { action: 'fold' });
  return { ...opts[Math.floor(rng() * opts.length)], computeMs: 0 };
}

export function runSimulation({ hands = 10000, seed = 20261018, iterations = 60, agent = 'ai', onProgress } = {}) {
  const stats = {
    agent,
    seed,
    handsTarget: hands,
    hands: 0,
    games: 0,
    actions: 0,
    events: 0,
    showdowns: 0,
    uncontested: 0,
    multiPotHands: 0,
    splitPots: 0,
    allInActions: 0,
    illegalAiActions: 0,
    chipConservationFailures: 0,
    refereeViolations: 0,
    violationSamples: [],
    chipsStart: 0,
    chipsEnd: 0,
    maxComputeMs: 0,
    totalComputeMs: 0,
    tableSizes: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  };
  const sample = (msg) => {
    if (stats.violationSamples.length < 20) stats.violationSamples.push(msg);
  };
  let g = 0;
  while (stats.hands < hands) {
    const nPlayers = 2 + (g % 5); // 2..6 seated = 1..5 opponents
    const gameSeed = hashSeed(seed, 'game', g);
    const players = Array.from({ length: nPlayers }, (_, i) => ({
      id: `ai${i}`,
      name: `AI ${i + 1}`,
      kind: 'ai',
      style: STYLE_IDS[(i + g) % 2],
    }));
    const table = Table.create({ seed: gameSeed, players });
    const expected = nPlayers * DEFAULT_CONFIG.startingChips;
    stats.chipsStart += totalChips(table.state);
    stats.games++;
    stats.tableSizes[nPlayers]++;
    let prevButton = -1;
    let handsThisGame = 0;
    while (table.state.phase !== 'gameOver' && handsThisGame < MAX_HANDS_PER_GAME && stats.hands < hands) {
      table.startHand();
      while (table.state.phase === 'betting') {
        const seat = table.state.hand.toAct;
        const d =
          agent === 'random'
            ? randomDecision(table.state, seat, makeRng('rand-agent', gameSeed, table.state.handNo, table.state.hand.actionCount))
            : aiDecision(table.state, seat, { iterations });
        stats.maxComputeMs = Math.max(stats.maxComputeMs, d.computeMs);
        stats.totalComputeMs += d.computeMs;
        const action = { seat, action: d.action, amount: d.amount };
        const err = checkAction(table.state, action);
        if (err) {
          stats.illegalAiActions++;
          sample(`game ${g} hand ${table.state.handNo}: illegal AI action ${JSON.stringify(action)}: ${err}`);
          const L = table.legal;
          table.act(seat, L.canCheck ? 'check' : 'fold');
        } else {
          if (d.action === 'allin') stats.allInActions++;
          table.act(seat, d.action, d.amount, { ts: 0, thinkMs: d.computeMs, computeMs: d.computeMs });
        }
        stats.actions++;
        if (totalChips(table.state) !== expected) {
          stats.chipConservationFailures++;
          sample(`game ${g} hand ${table.state.handNo}: chip total ${totalChips(table.state)} != ${expected}`);
        }
      }
      const h = table.state.hand;
      const violations = refereeHand(h.log, {
        n: nPlayers,
        smallBlind: table.state.config.smallBlind,
        bigBlind: table.state.config.bigBlind,
        prevButton,
      });
      if (violations.length) {
        stats.refereeViolations += violations.length;
        violations.forEach((m) => sample(`game ${g} hand ${h.handNo}: ${m}`));
      }
      prevButton = h.button;
      if (h.result.uncontested) stats.uncontested++;
      else stats.showdowns++;
      if (h.result.awards.length > 1) stats.multiPotHands++;
      if (h.result.awards.some((a) => a.winners.length > 1)) stats.splitPots++;
      if (totalChips(table.state) !== expected) {
        stats.chipConservationFailures++;
        sample(`game ${g} after hand ${h.handNo}: chip total ${totalChips(table.state)} != ${expected}`);
      }
      stats.hands++;
      handsThisGame++;
      if (onProgress && stats.hands % 1000 === 0) onProgress(stats);
    }
    stats.events += table.events.length;
    stats.chipsEnd += totalChips(table.state);
    g++;
  }
  stats.violations = stats.illegalAiActions + stats.chipConservationFailures + stats.refereeViolations;
  stats.avgComputeMs = stats.totalComputeMs / Math.max(1, stats.actions);
  return stats;
}

export function formatSimReport(s, ms) {
  return [
    `Simulation (${s.agent === 'random' ? 'random-legal stress agents' : 'AI vs AI'}): ${s.hands} hands, ${s.games} games (table sizes ${JSON.stringify(s.tableSizes)}), seed ${s.seed}`,
    `  actions ${s.actions}, events ${s.events}, showdowns ${s.showdowns}, uncontested ${s.uncontested}, multi-pot hands ${s.multiPotHands}, split pots ${s.splitPots}, all-ins ${s.allInActions}`,
    `  RULE VIOLATIONS: ${s.violations}  (illegal AI actions ${s.illegalAiActions}, referee ${s.refereeViolations}, chip-conservation ${s.chipConservationFailures})`,
    `  CHIP TOTAL: start ${s.chipsStart}  end ${s.chipsEnd}  ${s.chipsStart === s.chipsEnd ? '(conserved)' : '(MISMATCH)'}`,
    `  AI decision compute: max ${s.maxComputeMs.toFixed(2)} ms, avg ${s.avgComputeMs.toFixed(3)} ms${ms != null ? `; wall time ${(ms / 1000).toFixed(1)} s` : ''}`,
    ...(s.violationSamples.length ? ['  samples:', ...s.violationSamples.map((m) => `    - ${m}`)] : []),
  ].join('\n');
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
  };
  const t0 = Date.now();
  const s = runSimulation({ hands: arg('hands', 10000), seed: arg('seed', 20261018), iterations: arg('iterations', 60), agent: process.argv.includes('--random') ? 'random' : 'ai' });
  console.log(formatSimReport(s, Date.now() - t0));
  process.exit(s.violations === 0 && s.chipsStart === s.chipsEnd ? 0 : 1);
}
