# holdem-ai

No-Limit Texas Hold'em in the browser: **you vs 1–5 AI opponents**, played until you bust (or take every chip). Virtual chips only — no money, accounts, or servers.

- Starting chips **1,000**, blinds **5/10** (fixed), up to **5 AI** (6-max table)
- Plain static site (vanilla ES modules, no build step, no runtime dependencies) → GitHub Pages
- Rules engine is a pure, **event-sourced** module with no DOM/browser dependency, so phase-2 multiplayer can reuse it as-is

Live (after merge to `main`): https://seungjinhan.github.io/holdem-ai/

## Run it

```bash
npm test          # unit tests + 10,000-hand AI sim + 10,000-hand stress sim (Node >= 18, no install needed)
npm start         # static server at http://localhost:8080/
npm run sim -- --hands 10000 --seed 123          # AI-vs-AI simulation only
npm run sim -- --hands 10000 --seed 123 --random # random-legal stress agents
SIM_SEED=123 npm test                            # whole suite with another simulation seed
```

URL parameters: `?seed=<n>` makes all deals deterministic (same seed + same actions => same game); `?ai=<1..5>` sets the number of opponents. The current seed is shown in the header and kept in the URL so it can be shared. The in-game **Event log** shows every action, with AI think time (ms), compute time and timestamp, and can be exported as JSON (the exported events replay with `replay()`).

Optional browser smoke test (needs Chrome): `npm i --no-save puppeteer-core && CHROME_PATH=/usr/bin/google-chrome node scripts/browser-smoke.mjs` — plays hands on desktop (1280x800) and mobile (390x844), checks for overlapping/clipped/off-screen buttons and cards, seed determinism, refresh-restore and console errors; screenshots go to `smoke-shots/`.

## Layout

```
src/engine/   pure rules engine (Node + browser)
  engine.js     reducer: GAME_CREATED / HAND_STARTED / ACTION events -> state; legalActions, checkAction, replay, playerView, Table
  evaluator.js  5-7 card hand evaluator (10 hand ranks incl. Royal Flush, kickers, ties)
  pots.js       side pots + distribution (odd chip to first winner left of the button)
  cards.js      card encoding, seeded per-hand deck
  rng.js        seeded RNG (mulberry32 + FNV-1a seed hashing)
src/ai/       basic AI (Chen score preflop, Monte-Carlo equity + pot odds postflop; tight/loose styles)
src/ui/       browser UI (main.js) + pure, unit-tested UI models (controls, persistence, timing)
test/         zero-dependency test runner, independent reference evaluator/side-pot code, referee, simulator
scripts/      local static server, optional headless-browser smoke test
```

### Event sourcing

All state changes happen through three serialisable events:

| event | payload |
|---|---|
| `GAME_CREATED` | `seed`, `config {startingChips, smallBlind, bigBlind}`, `players [{id, name, kind, style}]` |
| `HAND_STARTED` | `handNo`, `salt` (deck = f(seed, handNo, salt)) |
| `ACTION` | `seat`, `action` (`fold`/`check`/`call`/`bet`/`raise`/`allin`), `amount` (bet/raise "to" total), `meta {ts, thinkMs, computeMs}` |

`replay(events)` rebuilds the exact state; `reduce` never mutates its input and rejects illegal events with `RuleError`. Every hand also keeps a derived log (blinds, deals, actions with timing, showdown, pot awards, stacks). Humans and AIs submit actions through the same `ACTION` interface — the engine never knows which is which. `playerView(state, seat)` redacts opponents' hole cards (ready for networked play).

### Rules notes

- Heads-up: the button posts the small blind and acts first preflop, last postflop.
- Min raise = size of the last full bet/raise (BB at the start of each street). An all-in for less than a full raise does not reopen betting for players who already acted; incomplete raises that add up to a full raise do.
- A short big blind still makes the amount to call the full big blind; the excess comes back through side pots.
- Folding is only offered when facing a bet (no folding when checking is free).
- Odd chips in split pots go to the first winner clockwise from the button.
- Busted players sit out; the button moves to the next seat that still has chips. All live hands are shown at showdown.
- Refreshing mid-hand restores chips as of the last finished hand; the abandoned hand is re-dealt with a new deck salt so its cards can't be peeked by refreshing.
