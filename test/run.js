// `npm test` entry point: unit tests (hand ranking, side pots, engine, UI models)
// followed by the 10,000-hand AI-vs-AI simulation and a 10,000-hand random-legal
// stress run. Exit code is non-zero on any failure, violation or chip mismatch.
//
// Options: SIM_SEED=<n> SIM_HANDS=<n>  (or: npm test -- --seed 123 --hands 10000)

import { runTests } from './harness.js';
import { counters as rankCounters } from './evaluator.test.js';
import { counters as potCounters } from './pots.test.js';
import './engine.test.js';
import { runSimulation, formatSimReport } from './sim.js';

const arg = (name, env, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return Number(process.argv[i + 1]);
  if (process.env[env]) return Number(process.env[env]);
  return def;
};
const seed = arg('seed', 'SIM_SEED', 20261018);
const hands = arg('hands', 'SIM_HANDS', 10000);

console.log('Unit tests');
const unit = await runTests();

console.log('');
let t0 = Date.now();
const sim = runSimulation({ hands, seed, iterations: 60, agent: 'ai' });
console.log(formatSimReport(sim, Date.now() - t0));
console.log('');
t0 = Date.now();
const stress = runSimulation({ hands, seed, agent: 'random' });
console.log(formatSimReport(stress, Date.now() - t0));

const simOk = (s) => s.violations === 0 && s.chipsStart === s.chipsEnd && s.hands === hands;
const ok = unit.failed === 0 && simOk(sim) && simOk(stress);
console.log('');
console.log('================ SUMMARY ================');
console.log(`Unit tests:            ${unit.passed}/${unit.total} passed, ${unit.failed} failed`);
console.log(`Hand-ranking cases:    ${rankCounters.handRankingCases} (+ exhaustive 2,598,960-hand category count)`);
console.log(`Side-pot cases:        ${potCounters.sidePotCases}`);
console.log(`AI sim (seed ${seed}):   ${sim.hands} hands, rule violations ${sim.violations}, chips start ${sim.chipsStart} / end ${sim.chipsEnd}, max AI compute ${sim.maxComputeMs.toFixed(2)} ms`);
console.log(`Stress sim:            ${stress.hands} hands, rule violations ${stress.violations}, chips start ${stress.chipsStart} / end ${stress.chipsEnd}`);
console.log(`RESULT: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
