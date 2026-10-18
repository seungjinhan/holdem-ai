// Optional headless-browser smoke test (not part of `npm test`, needs Chrome):
//   npm i --no-save puppeteer-core
//   CHROME_PATH=/usr/bin/google-chrome node scripts/browser-smoke.mjs
// Plays real hands through the UI on desktop (1280x800) and mobile (390x844),
// checks that buttons/cards never overflow or overlap, that ?seed= is deterministic,
// that a mid-hand refresh restores the last finished hand's chips, and that there
// are no console errors. Screenshots go to ./smoke-shots/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 8765;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['scripts/serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
mkdirSync('smoke-shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const failures = [];
const fail = (m) => {
  failures.push(m);
  console.log('  FAIL', m);
};

async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => m.type() === 'error' && fail(`console error: ${m.text()}`));
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));
  return { ctx, page };
}

const state = (page) =>
  page.evaluate(() => {
    const t = window.holdem.table;
    const s = t.state;
    return {
      phase: s.phase,
      handNo: s.handNo,
      toAct: s.hand?.toAct,
      result: !!s.hand?.result,
      showdown: !!s.hand?.result && !s.hand.result.uncontested,
      chips: s.players.map((p) => p.chips),
      hole0: s.hand?.hole[0],
      board: s.hand?.board,
      aiMeta: (s.hand?.log ?? []).filter((e) => e.t === 'act' && e.seat !== 0).map((e) => e.meta),
    };
  });

async function layoutCheck(page, label) {
  const r = await page.evaluate(() => {
    const vis = (el) => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]') && !el.closest('dialog:not([open])');
    };
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, id: el.id || el.className + ':' + (el.textContent || '').slice(0, 12) };
    };
    const els = [...document.querySelectorAll('.card, .act, .seat, .presets button, #btn-next')].filter(vis).map(rect);
    const overlaps = [];
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        const ix = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const iy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ix > 1 && iy > 1) overlaps.push(`${a.id} x ${b.id}`);
      }
    // cards inside seats are allowed to be inside their seat box
    const filtered = overlaps.filter((o) => !/^seat/.test(o.split(' x ')[0]) && !/ x seat/.test(o));
    const clipped = [...document.querySelectorAll('.act')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent);
    const offscreen = els.filter((e) => e.l < -1 || e.r > window.innerWidth + 1).map((e) => e.id);
    return { overlaps: filtered, clipped, offscreen, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, count: els.length };
  });
  if (r.overlaps.length) fail(`${label}: overlapping elements ${r.overlaps.slice(0, 5).join('; ')}`);
  if (r.clipped.length) fail(`${label}: clipped button text ${r.clipped.join(', ')}`);
  if (r.offscreen.length) fail(`${label}: offscreen ${r.offscreen.slice(0, 5).join(', ')}`);
  if (r.scrollW > r.innerW) fail(`${label}: horizontal scroll ${r.scrollW} > ${r.innerW}`);
  return r;
}

const shotTaken = new Set();
async function playUntilShowdown(page, label, { maxHands = 30 } = {}) {
  for (let guard = 0; guard < 4000; guard++) {
    const s = await state(page);
    if (s.result) {
      if (s.showdown) return s;
      if (s.handNo >= maxHands) return s;
      await page.click('#btn-next');
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    if (s.phase === 'betting' && s.toAct === 0) {
      if (guard % 7 === 0) await layoutCheck(page, `${label} (your turn)`);
      if (!shotTaken.has(label)) {
        shotTaken.add(label);
        await page.screenshot({ path: `smoke-shots/${label.replace(/\s+/g, '-')}-your-turn.png`, fullPage: true });
      }
      // check if possible, otherwise call
      await page.click('#btn-check');
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('no showdown reached');
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile-390', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }],
]) {
  for (const ai of [5, 3, 1]) {
    const { ctx, page } = await newPage(viewport);
    await page.goto(`${BASE}/?seed=42&ai=${ai}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.holdem?.table?.state?.hand);
    const s = await playUntilShowdown(page, `${label} ai=${ai}`);
    const lc = await layoutCheck(page, `${label} ai=${ai} showdown`);
    await page.screenshot({ path: `smoke-shots/${label}-ai${ai}-showdown.png`, fullPage: true });
    const maxThink = Math.max(0, ...s.aiMeta.map((m) => m.thinkMs));
    if (maxThink >= 2000) fail(`${label}: AI think ${maxThink} ms`);
    if (s.aiMeta.some((m) => typeof m?.thinkMs !== 'number' || typeof m?.ts !== 'number')) fail(`${label}: AI timing missing in log`);
    console.log(`  ${label} ai=${ai}: showdown at hand ${s.handNo}, ${lc.count} elements checked, max AI think ${maxThink} ms`);
    await ctx.close();
  }
}

// Determinism: same seed => same first hand cards, in two fresh browser contexts.
{
  const a = await newPage({ width: 1280, height: 800 });
  const b = await newPage({ width: 1280, height: 800 });
  await a.page.goto(`${BASE}/?seed=9001&ai=4`, { waitUntil: 'networkidle0' });
  await b.page.goto(`${BASE}/?seed=9001&ai=4`, { waitUntil: 'networkidle0' });
  await a.page.waitForFunction(() => window.holdem?.table?.state?.hand);
  await b.page.waitForFunction(() => window.holdem?.table?.state?.hand);
  const deckA = await a.page.evaluate(() => window.holdem.table.state.hand.deck);
  const deckB = await b.page.evaluate(() => window.holdem.table.state.hand.deck);
  if (JSON.stringify(deckA) !== JSON.stringify(deckB)) fail('seed determinism: decks differ');
  else console.log('  ?seed=9001 deals identical decks in two fresh browsers');
  await a.ctx.close();
  await b.ctx.close();
}

// Refresh mid-hand restores chips as of the last finished hand.
{
  const { ctx, page } = await newPage({ width: 390, height: 844, isMobile: true });
  await page.goto(`${BASE}/?seed=314&ai=3`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.holdem?.table?.state?.hand);
  // finish hand 1
  for (let g = 0; g < 400; g++) {
    const s = await state(page);
    if (s.result) break;
    if (s.toAct === 0) await page.click('#btn-check');
    await new Promise((r) => setTimeout(r, 80));
  }
  const finished = await state(page);
  await page.click('#btn-next');
  await new Promise((r) => setTimeout(r, 300));
  const mid = await state(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.holdem?.table);
  const after = await state(page);
  if (JSON.stringify(after.chips) !== JSON.stringify(finished.chips)) fail(`refresh: chips ${after.chips} != ${finished.chips}`);
  else console.log(`  refresh during hand ${mid.handNo} restored chips of hand ${finished.handNo}: ${after.chips.join('/')}`);
  await ctx.close();
}

await browser.close();
server.kill();
console.log(failures.length ? `BROWSER SMOKE: FAIL (${failures.length})` : 'BROWSER SMOKE: PASS');
process.exit(failures.length ? 1 : 0);
