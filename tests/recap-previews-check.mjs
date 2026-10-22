// THE WEEK RECAP'S PREVIEWS: the same cards as the rest of the site.
//
// Tim, 2026-10-22: "fantasy: none of the players or anything in the new week
// recap section have previews or anything like that like the rest of the cite.
// fix it"
//
// The real index.html and js/week-summary-page.js, booted in linkedom on the
// phone's synced copy (recap-stub-season.mjs, ten squads of sixteen) and on the
// sample league. Checked:
//
//   - every PLAYER the recap names (Booms, Busts, Positions' top scorer, New
//     injuries, Up while out, Best bench, Best pickup) opens the player card
//     (`data-tip`, js/player-card.js), and is a link to his row on Players;
//   - every MANAGER it names (Results, Standings, Missed points, the facts,
//     the Owner column) and every score opens a stat card (`data-pop`,
//     js/pop.js); Missed points' two figures open their swaps, with no `title`
//     left beside the card (one preview per number);
//   - a mouse hover opens the card beside the name; a tap (hover: none) opens
//     it as the bottom sheet;
//   - nothing is asked of ESPN on the copy (rule 20).
//
//   node recap-previews-check.mjs                 parent
//   node recap-previews-check.mjs child <source>  child (source: full | demo)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

if (process.argv[2] === 'child') {
  const source = process.argv[3];
  const hook = `
    const TESTS = ${JSON.stringify(new URL('./', import.meta.url).href)};
    const SEASON = ${JSON.stringify(new URL('./recap-stub-season.mjs', import.meta.url).href)};
    export async function resolve(spec, ctx, next) {
      const fromTests = ctx.parentURL && ctx.parentURL.startsWith(TESTS);
      if (spec.startsWith('.') && !fromTests && /\\/season\\.js$/.test(spec)) return next(SEASON, ctx);
      return next(spec, ctx);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));

  const { window, document, fetchCalls } = bootDom({
    html: readFileSync(path.join(REPO, 'index.html'), 'utf8'),
    store: { 'ff.connection': { leagueId: '1241838', season: 2026, teamId: 1 } },
  });
  let coarse = false;
  window.matchMedia = (q) => ({
    media: String(q), matches: coarse && String(q).includes('hover: none'),
    addEventListener() {}, removeEventListener() {},
  });
  const src = source === 'demo' ? 'demo' : 'live';
  for (const b of document.querySelectorAll('#sourceToggle button')) b.classList.toggle('on', b.dataset.src === src);

  await import(moduleUrl('js/week-summary-page.js'));
  await waitFor(() => document.querySelectorAll('#recapBody .recap-block').length >= 8 ||
    /neg/.test(document.getElementById('recapStatus')?.className || ''), 20000);
  await new Promise((r) => setTimeout(r, 50));

  const blk = (id) => document.getElementById(id);
  const rows = (id) => [...(blk(id)?.querySelectorAll('tbody tr') || [])].filter((tr) => !tr.querySelector('.name-less'));
  const cell = (tr, i) => tr.children[i];
  const tipped = (el) => !!el && !!el.querySelector('[data-tip]');
  const popped = (el) => !!el && (el.hasAttribute('data-pop') || !!el.querySelector('[data-pop]'));
  const out = { blocks: document.querySelectorAll('#recapBody .recap-block').length, misses: [] };
  const need = (cond, what) => { if (!cond) out.misses.push(what); };
  const count = { tips: 0, pops: 0 };

  // Players.
  for (const id of ['recapBooms', 'recapBusts']) {
    for (const tr of rows(id)) {
      need(tipped(cell(tr, 0)), `${id}: ${text(cell(tr, 0))} has no player card`);
      need(!!cell(tr, 0)?.querySelector('a.pref[href*="waivers.html?player="]'), `${id}: ${text(cell(tr, 0))} is no link to Players`);
      const owner = cell(tr, 2);
      if (text(owner) !== 'FA') need(popped(owner), `${id}: owner ${text(owner)} has no card`);
      count.tips++;
    }
  }
  for (const tr of rows('recapPositions')) {
    if (text(cell(tr, 1)) !== '—') need(tipped(cell(tr, 1)), `recapPositions: ${text(cell(tr, 1))} has no player card`);
  }
  for (const tr of rows('recapInjuries')) {
    need(tipped(cell(tr, 0)), `recapInjuries: ${text(cell(tr, 0))} has no player card`);
    need(!cell(tr, 0).hasAttribute('title'), `recapInjuries: ${text(cell(tr, 0))} still carries a title beside its card`);
    const gains = cell(tr, 2);
    if (text(gains) !== '—') {
      const names = gains.querySelectorAll('[data-tip]').length;
      const nums = gains.querySelectorAll('[data-pop]').length;
      need(names > 0 && names === nums, `recapInjuries: Up while out names/figures without cards (${names}/${nums}): ${text(gains)}`);
      out.gainRows = (out.gainRows || 0) + 1;
    }
  }
  // Managers and scores.
  for (const tr of rows('recapGames')) {
    for (const i of [0, 2]) need(popped(cell(tr, i)), `recapGames: ${text(cell(tr, i))} has no team card`);
    for (const i of [1, 3]) need(popped(cell(tr, i)), `recapGames: score ${text(cell(tr, i))} has no card`);
    count.pops++;
  }
  for (const tr of rows('recapStandings')) need(popped(cell(tr, 1)), `recapStandings: ${text(cell(tr, 1))} has no team card`);
  for (const tr of rows('recapMissed')) {
    need(popped(cell(tr, 0)), `recapMissed: ${text(cell(tr, 0))} has no team card`);
    need(popped(cell(tr, 1)), `recapMissed: score ${text(cell(tr, 1))} has no card`);
    for (const i of [2, 3]) {
      need(popped(cell(tr, i)), `recapMissed: figure ${text(cell(tr, i))} has no swaps card`);
      need(!cell(tr, i).hasAttribute('title'), `recapMissed: figure ${text(cell(tr, i))} still has a title`);
    }
  }
  const facts = Object.fromEntries(rows('recapFacts').map((tr) => [text(tr.children[0]), tr.children[1]]));
  for (const k of ['High score', 'Low score', 'Biggest win', 'Closest']) need(popped(facts[k]), `facts: ${k} has no team card`);
  for (const k of ['Best bench', 'Best pickup']) {
    if (facts[k] && !/^(—|None started|Not known)$/.test(text(facts[k]))) {
      need(tipped(facts[k]), `facts: ${k} player has no card`);
      need(popped(facts[k]), `facts: ${k} owner has no card`);
    }
  }
  out.counts = count;

  // A MOUSE: hover on a boom's name opens the player card beside it.
  const fire = (el, type) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };
  const isOpen = (id) => { const el = document.getElementById(id); return !!el && !el.hasAttribute('hidden'); };
  const firstName = blk('recapBooms')?.querySelector('[data-tip]');
  if (firstName) {
    fire(firstName, 'mouseover');
    out.hoverTip = isOpen('tipCard') && text(document.getElementById('tipCard')).includes(text(firstName).split(' ')[0]);
    out.hoverTipSheet = document.getElementById('tipCard')?.classList.contains('sheet') || false;
    fire(firstName, 'mouseout');
  }
  const figure = blk('recapMissed')?.querySelector('tbody tr td:nth-child(3)[data-pop], tbody tr td:nth-child(3) [data-pop]');
  if (figure) {
    fire(figure, 'mouseover');
    out.hoverPop = isOpen('statCard');
    out.hoverPopText = text(document.getElementById('statCard'));
    fire(figure, 'mouseout');
  }
  const team = blk('recapStandings')?.querySelector('[data-pop]');
  if (team) {
    fire(team, 'mouseover');
    out.hoverTeam = isOpen('statCard') && text(document.getElementById('statCard')).startsWith(text(team));
    fire(team, 'mouseout');
  }
  // A FINGER: a tap opens the same card as the sheet at the foot.
  coarse = true;
  if (firstName) {
    fire(firstName, 'click');
    out.tapTip = isOpen('tipCard') && document.getElementById('tipCard').classList.contains('sheet');
    document.querySelector('#tipCard .tc-close')?.dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  if (team) {
    fire(team, 'click');
    out.tapPop = isOpen('statCard') && document.getElementById('statCard').classList.contains('sheet') &&
      !!document.querySelector('#statCard .tc-open[href*="analysis.html?team="]');
  }

  out.fetches = fetchCalls;
  out.asks = globalThis.__espnAsks || [];
  out.errors = errors.filter((e) => !/unexpected network call/.test(e));
  emit(out);
} else {
  let pass = 0;
  let fail = 0;
  const ok = (c, msg, extra = '') => {
    if (c) pass++;
    else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 600)}` : ''}`); }
  };
  const run = (source) => {
    const r = spawnSync(process.execPath, [self, 'child', source], {
      cwd: path.dirname(self), encoding: 'utf8', env: { ...process.env, RECAP_COPY: source === 'demo' ? 'full' : source }, timeout: 90000,
    });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) { console.log(r.stdout, r.stderr); return null; }
    return JSON.parse(line.slice(2));
  };

  for (const source of ['full', 'demo']) {
    const r = run(source);
    ok(!!r, `${source}: the child reported`);
    if (!r) continue;
    ok(r.blocks === 8, `${source}: all eight blocks drawn`, r.blocks);
    ok(r.errors.length === 0, `${source}: no errors`, r.errors.join(' | '));
    ok(r.misses.length === 0, `${source}: every name and figure in the recap has its card (${r.misses.length} without)`, r.misses.slice(0, 8).join(' | '));
    ok(r.counts.tips >= 5 && r.counts.pops >= 4, `${source}: there were names to check`, JSON.stringify(r.counts));
    ok(r.hoverTip === true && r.hoverTipSheet === false, `${source}: a mouse hover on a boom opens his player card beside it`);
    ok(r.hoverPop === true && /start|sit|No change/i.test(r.hoverPopText || ''), `${source}: a hover on a missed-points figure opens its swaps`, r.hoverPopText);
    ok(r.hoverTeam === true, `${source}: a hover on a manager opens his team card`);
    ok(r.tapTip === true, `${source}: a tap on a name opens the player card as the bottom sheet`);
    ok(r.tapPop === true, `${source}: a tap on a manager opens the sheet, with Open roster`);
    if (source === 'full') {
      ok(r.fetches.length === 0, 'full: no request left the page (rule 20)', r.fetches.join(', '));
      ok(r.asks.length === 0, 'full: nothing the phone would ask ESPN for', r.asks.join(', '));
      ok((r.gainRows || 0) > 0, 'full: an Up while out row was checked', r.gainRows);
    }
  }
  console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
  process.exit(fail ? 1 : 0);
}
