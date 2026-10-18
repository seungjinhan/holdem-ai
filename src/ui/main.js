// Browser UI. All game rules live in src/engine; this file only renders state,
// turns clicks into ACTION events and paces the AI.

import { Table, checkAction, STREETS } from '../engine/engine.js';
import { RANK_CHARS, SUIT_SYMBOLS } from '../engine/cards.js';
import { hashSeed } from '../engine/rng.js';
import { aiDecision } from '../ai/agent.js';
import { STYLES } from '../ai/ai.js';
import { buildControls, betRaiseAction, clampAmount } from './controls.js';
import { saveFinishedHand, markHandInProgress, loadGame, clearGame } from './persist.js';
import { thinkDelay, remainingDelay } from './timing.js';

const HUMAN = 0;
const AI_NAMES = ['Ava', 'Ben', 'Cleo', 'Dan', 'Eve'];
const MAX_LOG_LINES = 400;

const $ = (id) => document.getElementById(id);
const storage = (() => {
  try {
    const k = '__holdem_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  }
})();

let table = null;
let settings = null; // { seed, ai }
let salt = 0;
let aiTimer = null;
let turnStartedAt = 0;
let thinkingSeat = -1;
let logCursor = 0;
let controls = null;

// ------------------------------------------------------------------ setup

function parseSeed(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  return /^\d{1,10}$/.test(s) ? Number(s) >>> 0 : hashSeed(s);
}
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

function boot() {
  const params = new URLSearchParams(location.search);
  const urlSeed = parseSeed(params.get('seed'));
  const urlAi = Math.min(5, Math.max(1, Number(params.get('ai')) || 3));
  const saved = loadGame(storage);
  if (saved && (urlSeed == null || saved.settings.seed === urlSeed)) {
    try {
      restore(saved);
      return;
    } catch (e) {
      console.warn('Could not restore saved game', e);
      clearGame(storage);
    }
  }
  if (urlSeed != null) startNewGame({ seed: urlSeed, ai: urlAi });
  else openSetup(false);
}

function openSetup(cancellable) {
  $('setup-cancel').hidden = !cancellable;
  $('seed-input').value = '';
  $('setup').showModal();
}

function startNewGame({ seed, ai }) {
  clearTimeout(aiTimer);
  const players = [{ id: 'you', name: 'You', kind: 'human' }];
  for (let i = 0; i < ai; i++) {
    players.push({ id: `ai${i + 1}`, name: AI_NAMES[i], kind: 'ai', style: i % 2 === 0 ? 'tight' : 'loose' });
  }
  table = Table.create({ seed, players });
  settings = { seed, ai };
  salt = 0;
  logCursor = 0;
  $('log').innerHTML = '';
  persist();
  syncUrl();
  $('table').hidden = false;
  nextHand();
}

function restore(saved) {
  table = new Table(saved.events);
  settings = saved.settings;
  salt = saved.salt;
  logCursor = 0;
  $('log').innerHTML = '';
  syncUrl();
  $('table').hidden = false;
  addLog('Game restored from this browser (chips as of the last finished hand).', 'hand');
  persist();
  if (table.state.handNo > 0) {
    // show last finished hand result, then let the player continue
    render();
    afterHand(true);
  } else {
    nextHand();
  }
}

function syncUrl() {
  const u = new URL(location.href);
  u.searchParams.set('seed', String(settings.seed));
  u.searchParams.set('ai', String(settings.ai));
  history.replaceState(null, '', u);
  $('seed-label').textContent = String(settings.seed);
}

function persist() {
  saveFinishedHand(storage, { events: table.events, settings, salt });
}

// ------------------------------------------------------------------ flow

function nextHand() {
  $('btn-next').hidden = true;
  if (isGameOver()) return showGameOver();
  table.startHand(salt);
  markHandInProgress(storage);
  logCursor = 0;
  flushLog();
  schedule();
}

function isGameOver() {
  const s = table.state;
  return s.players[HUMAN].chips === 0 || s.phase === 'gameOver';
}

function schedule() {
  clearTimeout(aiTimer);
  thinkingSeat = -1;
  const s = table.state;
  if (s.phase !== 'betting') return afterHand(false);
  const seat = s.hand.toAct;
  turnStartedAt = performance.now();
  if (seat === HUMAN) return render();
  // AI: decide now (a few ms), then wait out a short human-like pause (< 2 s total).
  thinkingSeat = seat;
  render();
  const d = aiDecision(s, seat);
  const wait = remainingDelay(thinkDelay(Math.random()), d.computeMs);
  aiTimer = setTimeout(() => {
    const thinkMs = Math.round(performance.now() - turnStartedAt);
    dispatchAction(seat, d.action, d.amount, { ts: Date.now(), thinkMs, computeMs: d.computeMs });
  }, wait);
}

function dispatchAction(seat, action, amount, meta) {
  try {
    table.act(seat, action, amount, meta);
  } catch (e) {
    console.error(e);
    $('message').textContent = `Rejected: ${e.message}`;
    return;
  }
  flushLog();
  schedule();
}

function afterHand(restored) {
  if (!restored) persist();
  render();
  const h = table.state.hand;
  if (h?.result) $('message').textContent = resultText(h);
  if (isGameOver()) {
    setTimeout(showGameOver, restored ? 0 : 1200);
  } else {
    $('btn-next').hidden = false;
    $('btn-next').focus({ preventScroll: true });
  }
}

function showGameOver() {
  const s = table.state;
  const won = s.players[HUMAN].chips > 0;
  $('gameover-title').textContent = won ? 'You won! 🏆' : 'Out of chips';
  $('gameover-text').textContent = won
    ? `You took every chip in ${s.handNo} hands.`
    : `You busted after ${s.handNo} hands. Start a new game to play again.`;
  if (!$('gameover').open) $('gameover').showModal();
}

// ------------------------------------------------------------------ human input

function humanAct(a) {
  const s = table.state;
  if (s.phase !== 'betting' || s.hand.toAct !== HUMAN || !a) return;
  const err = checkAction(s, { seat: HUMAN, ...a });
  if (err) {
    $('message').textContent = err;
    return;
  }
  dispatchAction(HUMAN, a.action, a.amount, { ts: Date.now(), thinkMs: Math.round(performance.now() - turnStartedAt) });
}

function sliderValue() {
  return Number($('bet-input').value);
}

function setSlider(v) {
  if (!controls?.slider) return;
  const c = clampAmount(controls.slider, v);
  $('bet-range').value = String(c);
  $('bet-input').value = String(c);
  $('btn-bet').textContent = `${controls.betRaise.label} ${c}`;
}

// ------------------------------------------------------------------ rendering

function cardEl(c, { hidden = false, empty = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (empty) {
    el.classList.add('empty');
    return el;
  }
  if (hidden || c == null) {
    el.classList.add('back');
    return el;
  }
  const suit = c & 3;
  if (suit === 1 || suit === 2) el.classList.add('red');
  const r = RANK_CHARS[c >> 2];
  el.innerHTML = `<span class="r">${r === 'T' ? '10' : r}</span><span class="s">${SUIT_SYMBOLS[suit]}</span>`;
  el.setAttribute('aria-label', cardText(c));
  return el;
}

function cardText(c) {
  const r = RANK_CHARS[c >> 2];
  return `${r === 'T' ? '10' : r}${SUIT_SYMBOLS[c & 3]}`;
}

function lastActionText(h, seat) {
  for (let i = h.log.length - 1; i >= 0; i--) {
    const e = h.log[i];
    if (e.t === 'street' && e.street !== 'preflop' && i > 0) break;
    if (e.t === 'act' && e.seat === seat) return actionWord(e);
  }
  return '';
}

function actionWord(e) {
  switch (e.action) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return e.allIn ? `Call ${e.add} (all-in)` : `Call ${e.add}`;
    case 'bet': return e.allIn ? `Bet ${e.to} (all-in)` : `Bet ${e.to}`;
    case 'raise': return e.allIn ? `Raise to ${e.to} (all-in)` : `Raise to ${e.to}`;
    case 'allin': return `All-in ${e.to}`;
    default: return e.action;
  }
}

function seatEl(el, k) {
  const s = table.state;
  const p = s.players[k];
  const h = s.hand;
  el.className = 'seat' + (k === HUMAN ? ' mine' : '');
  el.innerHTML = '';
  const winners = new Set((h?.result?.awards ?? []).flatMap((a) => a.winners));
  if (h) {
    if (s.phase === 'betting' && h.toAct === k) el.classList.add('turn');
    if (h.folded[k]) el.classList.add('folded');
    if (!h.inHand[k]) el.classList.add('out');
    if (h.result && winners.has(k)) el.classList.add('winner');
  } else if (p.chips === 0) el.classList.add('out');

  const name = document.createElement('div');
  name.className = 'name';
  name.innerHTML = `<span class="label"></span>`;
  name.querySelector('.label').textContent = p.name;
  if (p.style && STYLES[p.style]) {
    const st = document.createElement('span');
    st.className = 'style';
    st.textContent = STYLES[p.style].label;
    name.append(st);
  }
  if (h && h.button === k) name.insertAdjacentHTML('beforeend', '<span class="badge d" title="Dealer button">D</span>');
  if (h && h.sb === k && h.sb !== h.button) name.insertAdjacentHTML('beforeend', '<span class="badge sb">SB</span>');
  if (h && h.bb === k) name.insertAdjacentHTML('beforeend', '<span class="badge bb">BB</span>');
  el.append(name);

  const chips = document.createElement('div');
  chips.className = 'chips';
  const bet = h && h.street < 4 && h.streetBet[k] ? ` · bet ${h.streetBet[k]}` : '';
  chips.innerHTML = `<strong>${p.chips}</strong>${bet}`;
  el.append(chips);

  const status = document.createElement('div');
  status.className = 'status';
  if (h) {
    if (!h.inHand[k]) status.textContent = p.chips === 0 ? 'Busted' : '';
    else if (thinkingSeat === k) status.textContent = 'thinking…';
    else if (h.result && winners.has(k)) {
      const won = h.result.payouts[k];
      status.textContent = `Wins ${won}`;
    } else if (h.folded[k]) status.textContent = 'Folded';
    else if (h.allIn[k]) status.textContent = 'All-in';
    else status.textContent = lastActionText(h, k);
  }
  el.append(status);

  if (k !== HUMAN) {
    const mini = document.createElement('div');
    mini.className = 'mini';
    if (h && h.inHand[k] && !h.folded[k]) {
      const shown = h.result?.showdown?.find((x) => x.seat === k);
      for (let i = 0; i < 2; i++) mini.append(shown ? cardEl(shown.cards[i]) : cardEl(null, { hidden: true }));
    }
    el.append(mini);
  }
  const shownHand = h?.result?.showdown?.find((x) => x.seat === k);
  if (shownHand) status.textContent = `${winners.has(k) ? `Wins ${h.result.payouts[k]} · ` : ''}${shownHand.name}`;
}

function render() {
  const s = table.state;
  const h = s.hand;
  // opponents
  const opp = $('opponents');
  const n = s.players.length;
  while (opp.children.length > n - 1) opp.lastChild.remove();
  while (opp.children.length < n - 1) opp.append(document.createElement('div'));
  for (let k = 1; k < n; k++) seatEl(opp.children[k - 1], k);
  seatEl($('my-seat'), HUMAN);

  // board
  const board = $('board');
  board.innerHTML = '';
  for (let i = 0; i < 5; i++) board.append(h && h.board[i] != null ? cardEl(h.board[i]) : cardEl(null, { empty: true }));
  $('pot').textContent = h ? (h.result ? 0 : h.total.reduce((a, b) => a + b, 0)) : 0;
  $('street').textContent = h ? (h.result ? `Hand #${h.handNo} over` : `Hand #${h.handNo} · ${STREETS[h.street]}`) : '–';
  if (!h?.result) {
    const turn = s.phase === 'betting' ? h.toAct : -1;
    $('message').textContent = turn === HUMAN ? 'Your turn' : turn >= 0 ? `${s.players[turn].name} to act…` : '';
  }

  // my cards
  const mine = $('my-cards');
  mine.innerHTML = '';
  if (h && h.hole[HUMAN]) for (const c of h.hole[HUMAN]) mine.append(cardEl(c));

  renderControls();
}

function renderControls() {
  const s = table.state;
  const legal = s.phase === 'betting' && s.hand.toAct === HUMAN ? table.legal : null;
  controls = buildControls(legal);
  const c = controls;
  const set = (id, ctl) => {
    const b = $(id);
    b.disabled = !ctl.enabled;
    b.textContent = ctl.label;
  };
  set('btn-fold', c.fold);
  set('btn-check', c.checkCall);
  set('btn-bet', c.betRaise);
  set('btn-allin', c.allIn);
  const sizing = $('sizing');
  const presets = $('presets');
  presets.innerHTML = '';
  if (c.slider) {
    sizing.classList.remove('disabled');
    for (const id of ['bet-range', 'bet-input']) {
      const el = $(id);
      el.min = String(c.slider.min);
      el.max = String(c.slider.max);
      el.disabled = false;
    }
    setSlider(c.slider.min);
    for (const p of c.presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${p.label} (${p.to})`;
      b.addEventListener('click', () => setSlider(p.to));
      presets.append(b);
    }
  } else {
    sizing.classList.add('disabled');
    for (const id of ['bet-range', 'bet-input']) {
      $(id).disabled = true;
      $(id).min = $(id).max = $(id).value = '0';
    }
  }
}

function resultText(h) {
  const names = table.state.players.map((p) => p.name);
  if (h.result.uncontested) {
    const a = h.result.awards[0];
    return `${names[a.winners[0]]} wins ${a.amount} (everyone else folded)`;
  }
  const byName = new Map(h.result.showdown.map((x) => [x.seat, x.name]));
  return h.result.awards
    .map((a, i) => {
      const who = a.winners.map((w) => names[w]).join(' & ');
      const label = h.result.awards.length > 1 ? (i === 0 ? 'Main pot' : `Side pot ${i}`) : 'Pot';
      const split = a.winners.length > 1 ? ' (split)' : '';
      return `${label} ${a.amount}: ${who}${split} — ${byName.get(a.winners[0]) ?? ''}`;
    })
    .join(' · ');
}

// ------------------------------------------------------------------ event log

function addLog(text, cls) {
  const li = document.createElement('li');
  if (cls) li.className = cls;
  li.textContent = text;
  const ol = $('log');
  ol.append(li);
  while (ol.children.length > MAX_LOG_LINES) ol.firstChild.remove();
  ol.scrollTop = ol.scrollHeight;
}

function flushLog() {
  const s = table.state;
  const h = s.hand;
  if (!h) return;
  const names = s.players.map((p) => p.name);
  for (; logCursor < h.log.length; logCursor++) {
    const e = h.log[logCursor];
    switch (e.t) {
      case 'start':
        addLog(`— Hand #${e.handNo} — dealer ${names[e.button]}${e.salt ? ` (salt ${e.salt})` : ''}`, 'hand');
        break;
      case 'blind':
        addLog(`${names[e.seat]} posts ${e.kind.toUpperCase()} ${e.amount}${e.allIn ? ' (all-in)' : ''}`);
        break;
      case 'hole':
        if (e.seat === HUMAN) addLog(`Your cards: ${e.cards.map(cardText).join(' ')}`);
        break;
      case 'street':
        if (e.street !== 'preflop') addLog(`${e.street[0].toUpperCase()}${e.street.slice(1)}: ${e.board.map(cardText).join(' ')}`);
        break;
      case 'act': {
        const m = e.meta;
        const timing = m && e.seat !== HUMAN
          ? ` · think ${m.thinkMs} ms (compute ${m.computeMs} ms) @ ${new Date(m.ts).toLocaleTimeString()}`
          : m ? ` · ${m.thinkMs} ms` : '';
        addLog(`${names[e.seat]}: ${actionWord(e)}${timing}`);
        break;
      }
      case 'showdown':
        for (const x of e.hands) addLog(`${names[x.seat]} shows ${x.cards.map(cardText).join(' ')} — ${x.name}`);
        break;
      case 'award':
        addLog(`${e.winners.map((w) => names[w]).join(' & ')} win${e.winners.length > 1 ? '' : 's'} ${e.amount}${e.pot > 0 ? ` (side pot ${e.pot})` : ''}`);
        break;
      case 'end':
        addLog(`Stacks: ${e.stacks.map((c, k) => `${names[k]} ${c}`).join(', ')}`);
        break;
    }
  }
}

function exportLog() {
  const blob = new Blob([JSON.stringify({ seed: settings.seed, settings, events: table.events }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `holdem-seed${settings.seed}-hand${table.state.handNo}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ wiring

$('btn-fold').addEventListener('click', () => humanAct(controls?.fold.action));
$('btn-check').addEventListener('click', () => humanAct(controls?.checkCall.action));
$('btn-allin').addEventListener('click', () => humanAct(controls?.allIn.action));
$('btn-bet').addEventListener('click', () => controls && humanAct(betRaiseAction(controls, sliderValue())));
$('bet-range').addEventListener('input', (e) => setSlider(e.target.value));
$('bet-input').addEventListener('change', (e) => setSlider(e.target.value));
$('btn-next').addEventListener('click', nextHand);
$('btn-new').addEventListener('click', () => openSetup(!!table));
$('setup-cancel').addEventListener('click', () => $('setup').close());
$('setup-form').addEventListener('submit', () => {
  const seed = parseSeed($('seed-input').value) ?? randomSeed();
  startNewGame({ seed, ai: Number($('ai-count').value) });
});
$('gameover-restart').addEventListener('click', () => {
  $('gameover').close();
  openSetup(false);
});
$('btn-export').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  exportLog();
});

// expose for QA / debugging in the console
window.holdem = { get table() { return table; }, get settings() { return settings; } };

boot();
