# holdem-ai

No-Limit Texas Hold'em in the browser: **you vs 1–5 AI opponents**, played until you bust (or take every chip). Virtual chips only — no money, accounts, or servers.

- Starting chips **1,000**, blinds **5/10** (fixed), up to **5 AI** (6-max table)
- Plain static site (vanilla ES modules, no build step, no runtime dependencies) → GitHub Pages
- Rules engine is a pure, **event-sourced** module with no DOM/browser dependency, so phase-2 multiplayer can reuse it as-is

Live (after merge to `main`): https://seungjinhan.github.io/holdem-ai/

## 플레이 가이드

컴퓨터(AI) 상대 1~5명과 노리밋 텍사스 홀덤을 치는 웹 게임입니다. 칩은 게임 안에서만 쓰는 가상 칩이며, 돈이나 결제는 전혀 없습니다. 화면의 버튼과 글자는 영어로 되어 있어서, 아래 설명에는 화면에 보이는 영어 표기를 그대로 적었습니다.

### 1. 게임 열기

- 주소: https://seungjinhan.github.io/holdem-ai/ (이 변경이 main 브랜치에 합쳐진 뒤부터 열립니다)
- 데스크톱 크롬과 모바일 크롬(가로 390px 화면)에서 쓸 수 있습니다. 설치할 것은 없습니다.

### 2. 게임 시작하기

1. 처음 들어가면 **New game** 창이 자동으로 뜹니다. 게임 중에는 화면 오른쪽 위의 **New game** 버튼으로 언제든 다시 열 수 있습니다.
2. **AI opponents**에서 상대 AI 수를 1~5명 중에 고릅니다. 기본값은 3명입니다.
3. **Seed**(시드)는 비워 두어도 됩니다. 비워 두면 매번 다른 카드가 나옵니다. 숫자를 넣으면 같은 숫자에서는 항상 같은 순서로 카드가 나옵니다. 같은 판을 다시 해 보거나 다른 사람과 같은 판을 비교할 때 씁니다.
4. **Start**를 누르면 게임이 시작됩니다. 이미 게임 중이라면 **Cancel**로 창을 닫고 하던 게임으로 돌아갈 수 있습니다.

- 모든 플레이어는 칩 1,000개로 시작하고, 블라인드는 5/10으로 고정입니다.
- 지금 게임의 시드 번호는 화면 오른쪽 위에 `seed 42`처럼 표시됩니다.
- 주소 뒤에 값을 붙여서 바로 시작할 수도 있습니다. 예: `https://seungjinhan.github.io/holdem-ai/?seed=42&ai=3`
  - `?seed=숫자` : 이 시드로 게임을 시작합니다.
  - `&ai=숫자` : 상대 AI 수(1~5)입니다. 빼면 3명입니다.
  - 이 브라우저에 같은 시드로 하던 게임이 저장되어 있으면 새로 시작하지 않고 그 게임을 이어서 엽니다.

### 3. 한 판(핸드)의 흐름

1. 딜러 왼쪽의 두 사람이 스몰 블라인드(5)와 빅 블라인드(10)를 먼저 냅니다. (2명만 남았을 때는 딜러가 스몰 블라인드를 냅니다)
2. 모두 자기만 보는 카드 2장을 받고, 첫 번째 베팅을 합니다.
3. 가운데에 공용 카드 3장(플랍)이 깔리고 베팅, 1장(턴)이 더 깔리고 베팅, 마지막 1장(리버)이 깔리고 베팅을 합니다.
4. 끝까지 남은 사람들이 카드를 공개하고(쇼다운), 자기 카드 2장과 공용 카드 5장 중 5장으로 만든 가장 좋은 패로 승자를 정합니다. 중간에 한 명만 남으면 카드를 공개하지 않고 그 사람이 팟을 가져갑니다.
5. 한 판이 끝나면 딜러 버튼이 다음 사람에게 넘어갑니다.

### 4. 버튼 사용법

내 차례가 되면 화면 가운데에 **Your turn**이 나오고, 지금 규칙상 할 수 있는 버튼만 켜집니다. 할 수 없는 버튼은 흐리게(회색빛으로) 꺼져 있어서 누를 수 없습니다.

| 버튼 | 뜻 |
|---|---|
| **Fold** | 이번 판을 포기합니다. 앞사람이 베팅해서 칩을 내야 할 때만 켜집니다. 공짜로 넘어갈 수 있을 때는 꺼져 있습니다. |
| **Check** | 칩을 더 내지 않고 차례를 넘깁니다. 낼 칩이 없을 때 이 이름으로 보입니다. |
| **Call 숫자** | 앞사람 베팅만큼 칩을 맞춰 냅니다. 예: `Call 20`. 내 칩이 모자라면 `Call 15 (all-in)`처럼 표시되고, 남은 칩을 모두 냅니다. |
| **Bet 숫자** | 아무도 베팅하지 않았을 때 먼저 베팅합니다. 예: `Bet 10`. |
| **Raise to 숫자** | 앞사람 베팅보다 더 올립니다. 숫자는 이번 라운드에 내가 낸 칩의 "총액"입니다. 예: `Raise to 60`. |
| **All-in 숫자** | 남은 칩을 모두 겁니다. 예: `All-in 990`. 눌렀을 때 낼 수 있는 경우에만 켜집니다. |

**베팅 금액 정하는 법**

- 버튼 아래의 **슬라이더**를 움직이거나, 오른쪽 **숫자 칸**에 직접 금액을 적습니다. 정한 금액이 **Bet** / **Raise to** 버튼 글자에 바로 반영됩니다.
- 빠른 금액 버튼: **Min**(가장 작게 올릴 수 있는 금액), **½ Pot**(팟의 절반), **Pot**(팟만큼). 버튼에 실제 금액이 `Min (20)`처럼 함께 적혀 있습니다. 두 버튼의 금액이 같으면 하나만 보입니다.
- 규칙보다 작은 금액(최소 레이즈 미만)을 적으면 자동으로 가장 작은 허용 금액으로 바뀝니다.
- 가진 칩보다 큰 금액을 적으면 자동으로 남은 칩 전부(올인 금액)로 바뀝니다.
- 베팅이나 레이즈를 할 수 없는 상황에서는 슬라이더와 숫자 칸도 꺼집니다.

### 5. 화면 읽는 법

- **위쪽**: 상대 AI들의 칸입니다. 각 칸에 이름, 성향 표시(**Tight** = 신중함, **Loose** = 공격적), 남은 칩, 이번 라운드에 낸 칩(`1000 · bet 20`), 카드 2장(뒷면)이 보입니다.
- **가운데**: 공용 카드 5칸, 몇 번째 판인지와 진행 단계(예: `Hand #3 · Flop`), **Pot**(이번 판에 모인 칩), 안내 문구가 있습니다.
- **아래쪽**: 내 칸(**You**)과 내 카드 2장, 그 아래에 액션 버튼이 있습니다.
- **표시(배지)**
  - **D**: 딜러 버튼
  - **SB** / **BB**: 스몰 블라인드 / 빅 블라인드를 낸 사람 (2명만 남았을 때는 딜러가 스몰 블라인드를 내므로 **D**만 보입니다)
- **칸 테두리**: 노란 테두리는 지금 차례인 사람, 초록 테두리는 이번 판에서 칩을 받은 사람입니다.
- **상태 글자** (각 칸 안)
  - `thinking…` : AI가 고민 중입니다. AI는 2초 안에 행동합니다.
  - `Folded` : 이번 판을 포기했습니다. (칸이 흐려집니다)
  - `All-in` : 칩을 모두 걸었습니다.
  - `Call 10`, `Raise to 60` 같은 글자 : 그 사람이 이번 라운드에서 마지막으로 한 행동입니다.
  - `Busted` : 칩이 0이 되어 게임에서 빠졌습니다.
  - `Wins 40 · Two Pair` : 이번 판에서 칩 40을 받았고, 패는 투 페어입니다.
- **결과 안내** (가운데): 판이 끝나면 누가 얼마를 가져갔는지 나옵니다.
  - 예: `Pot 40: Ben — Two Pair`
  - 여러 명이 올인해서 팟이 나뉘면 `Main pot 400: ... · Side pot 1 600: ...`처럼 팟별로 나옵니다.
  - 같은 패라서 나눠 가지면 `(split)`이 붙습니다.
  - 모두 포기해서 한 명만 남으면 `Ben wins 30 (everyone else folded)`처럼 나옵니다.
  - 쇼다운에서는 남은 AI의 카드가 앞면으로 뒤집혀 보입니다.
- 패 이름도 영어로 나옵니다: High Card(하이카드), One Pair(원 페어), Two Pair(투 페어), Three of a Kind(트리플), Straight(스트레이트), Flush(플러시), Full House(풀하우스), Four of a Kind(포카드), Straight Flush(스트레이트 플러시), Royal Flush(로열 플러시).
- 판이 끝나면 **Next hand** 버튼이 나옵니다. 누르면 다음 판이 시작됩니다.

### 6. 기록 보기 (Event log)

- 화면 맨 아래 **Event log**를 누르면 펼쳐집니다. 블라인드, 받은 카드(내 카드만), 공용 카드, 모든 행동, 쇼다운, 칩 분배, 판이 끝난 뒤 각자의 칩이 순서대로 적힙니다.
- AI 행동 옆에는 고민 시간이 `think 640 ms (compute 1.2 ms)`처럼 표시됩니다.
- **Export JSON** 버튼을 누르면 지금까지의 기록을 파일로 내려받습니다. 문제를 알릴 때 이 파일을 함께 보내 주시면 됩니다.

### 7. 새로고침하면?

- 게임은 이 브라우저에 자동으로 저장됩니다. 저장은 **한 판이 끝날 때마다** 됩니다.
- 판 도중에 새로고침하거나 창을 닫았다 다시 열면, **마지막으로 끝난 판 기준의 칩**으로 돌아옵니다. 중단된 판은 없었던 일이 되고, **Next hand**를 누르면 그 판을 **새 카드로** 다시 나눠 줍니다. (새로고침으로 카드를 미리 보는 것을 막기 위해서입니다)
- 다른 브라우저나 다른 기기에는 저장이 이어지지 않습니다.

### 8. 게임 끝

- 내 칩이 0이 되면 **Out of chips** 창이 뜨고 게임이 끝납니다.
- 내가 다른 모든 플레이어의 칩을 다 따면 **You won! 🏆** 창이 뜹니다.
- 두 경우 모두 **Play again**을 누르면 **New game** 창이 열려 새 게임을 시작할 수 있습니다.

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
