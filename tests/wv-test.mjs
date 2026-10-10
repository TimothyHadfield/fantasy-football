// Boots the REAL waivers.html + js/waivers-page.js against five data
// situations and checks the "Add players" table end to end.
//
//   node wv-test.mjs
//
// Each scenario runs in its own child process: an ES module initialises once
// per process, and waivers-page.js self-boots on import.
//
// Run it with `npm test` from tests/, or on its own with `node wv-test.mjs`.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { settle, settleWaiverPage } from './settle.mjs';
import { emit } from './emit.mjs';

// --------------------------------------------- when has this page finished?
//
// EVERY WAIT ON THE PAGE HERE IS A POLL ON THE PAGE'S OWN SIGNAL. This page buys
// one wire list AND one week of rosters per week on screen and paints as the
// answers arrive, so "has it finished" is a real question with a real answer, and
// the page publishes it three ways. `waiverPagePending()` in
// [settle.mjs](settle.mjs) is that answer, written down once because taken-check
// and cmp-check boot the same page.
//
// WHAT IS STILL A FIXED WAIT, ON PURPOSE. `cfg.wait` is the lead before
// `after()` runs, and for `live-midload` (60 ms) and `source-switch` (40 ms) a
// SHORT one is the whole scenario: they catch the page with the first weeks
// still in the air and then change the span or the source underneath it. Polling
// to "finished" there would delete what they test. Every wait AFTER that first
// interaction is a poll.

const settleWaivers = settleWaiverPage;

// THE PREVIOUS WEEKS (Tim, 2026-10-04: "make the player's section show all
// weeks, not just future weeks"). Every week fully over is a column now, drawn
// BEFORE the priced weeks, so the first priced week is no longer the cell after
// Avg. This counts them off the header the page drew; `check()` then pins the
// count itself (three in the stub's October, thirteen in its December), and
// every index into a row's weeks below is offset by it. Each played week also
// costs one wire request and one roster request, once, after the priced weeks.
const pastCount = (table) => table.querySelectorAll('thead th.wk-past').length;

// ------------------------------------------------------------ the Gain column
//
// Read off the page by HEADER TEXT, so these would report "no Gain column" on a
// build without one rather than read whatever cell happens to sit at an index.

const flat = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

/** The Gain column as drawn: its title, and every free-agent row's cell. */
function gainSnap(document) {
  const table = document.getElementById('waiverTable');
  const ths = [...table.querySelectorAll('thead th')];
  const col = ths.findIndex((th) => flat(th) === 'Gain');
  const rows = [...table.querySelectorAll('tbody tr[data-player]')];
  const cellOf = (tr) => {
    const td = col < 0 ? null : tr.children[col];
    return {
      id: tr.getAttribute('data-player'),
      mine: /\bmine\b/.test(tr.getAttribute('class') || ''),
      // The figure itself: since 2026-10-08 the cell may also carry the scale's
      // arrow, which is not part of the number.
      text: flat((td && td.querySelector('.gn')) || td),
      cls: td ? td.getAttribute('class') || '' : '',
      v: td ? td.getAttribute('data-v') : null,
      opens: Boolean(td && td.querySelector('.gn[data-gain][tabindex="0"][role="button"]')),
      wait: Boolean(td && /\bwait\b/.test(td.getAttribute('class') || '')),
    };
  };
  return {
    col,
    title: col < 0 ? '' : ths[col].getAttribute('title') || '',
    sortable: col >= 0 && ths[col].hasAttribute('data-sort'),
    cells: rows.map(cellOf),
    note: flat(document.getElementById('waiverNote')),
  };
}

/** Is the site's one stat card (js/pop.js) open? */
const cardOpen = (pop) => Boolean(pop && pop.hidden !== true && !pop.hasAttribute('hidden'));

/**
 * What an element's preview says: hover it, read the card, move off again.
 * '' when nothing opens. The harness answers `(hover: none)` with false, so
 * this is the mouse's path; the finger's is the `previews` scenario.
 */
function cardText(el) {
  if (!el) return '';
  const doc = el.ownerDocument;
  const W = doc.defaultView;
  el.dispatchEvent(new W.Event('mouseover', { bubbles: true }));
  const pop = doc.getElementById('statCard');
  // Cell by cell with a space between, the way it reads — `textContent` would
  // run a label straight into its number.
  const said = cardOpen(pop)
    ? pop.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&rarr;/g, '→')
      .replace(/\s+/g, ' ').trim()
    : '';
  el.dispatchEvent(new W.Event('mouseout', { bubbles: true }));
  return said;
}

/** Snap it, sort by it both ways, then open the best man's preview and shut it. */
async function gainProbe({ document, window }) {
  const table = document.getElementById('waiverTable');
  const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const out = { first: gainSnap(document) };
  if (out.first.col < 0) return out;

  const th = () => table.querySelectorAll('thead th')[out.first.col];
  click(th());
  out.desc = gainSnap(document);
  click(th());
  out.asc = gainSnap(document);
  click(th());

  const gn = table.querySelector('tbody td.gain .gn');
  if (!gn) return out;
  out.cell = flat(gn);
  out.label = gn.getAttribute('aria-label') || '';
  // A HOVER opens it (2026-10-08: it is the site's stat card now, and a click
  // on the figure goes to the man the move would drop — the `previews` scenario).
  gn.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  const pop = document.getElementById('statCard');
  const cells = (tr) => (tr ? [...tr.children].map(flat) : []);
  const dropLink = pop && pop.querySelector('.op-drop a');
  out.pop = pop && {
    open: cardOpen(pop),
    shared: /\bstatcard\b/.test(pop.getAttribute('class') || '') && !document.getElementById('gainPop'),
    head: flat(pop.querySelector('.tc-ident')),
    drop: flat(pop.querySelector('.op-drop')),
    dropHref: dropLink ? dropLink.getAttribute('href') || '' : '',
    cols: cells(pop.querySelector('thead tr')),
    rows: [...pop.querySelectorAll('tbody tr')].map(cells),
    foot: [...pop.querySelectorAll('tfoot tr')].map(cells),
    standing: flat(pop.querySelector('.sc-foot')),
    buttons: pop.querySelectorAll('button, .tc-actions').length,
  };
  const esc = new window.Event('keydown', { bubbles: true });
  Object.defineProperty(esc, 'key', { value: 'Escape' });
  document.dispatchEvent(esc);
  out.shut = Boolean(pop && !cardOpen(pop));
  return out;
}

// ------------------------------------------------------- Proj | Value (2026-10-09)
//
// Tim: "for all graphs or charts that show avg position's proj or value or
// anything like that ... have a switch for that graph that also shows the data
// as value rather than just total proj", and Value "displayed at the top of the
// player's preview". The lines below are a league's frozen baseline in the shape
// js/value.js `buildBase` writes; they sit inside the stub's projections
// (QB 11.2–24, RB/WR 6.3–13.5, TE 4.2–9, K 5.6–12, DST 4.9–10.5), so every
// position has men under the waiver line, between the lines and over both.
const VALUE_BASE = {
  v: 1,
  setAt: Date.UTC(2026, 8, 29, 12),
  week: 4,
  lines: {
    QB: { waiver: 14, starter: 18, agents: 3, starters: 10 },
    RB: { waiver: 8, starter: 11, agents: 3, starters: 20 },
    WR: { waiver: 8, starter: 11, agents: 3, starters: 20 },
    TE: { waiver: 5.5, starter: 7.5, agents: 3, starters: 10 },
    K: { waiver: 7, starter: 9.5, agents: 3, starters: 10 },
    DST: { waiver: 6, starter: 8, agents: 3, starters: 10 },
  },
};
// The weeks left in the stub's October: 4–13, no playoff weeks.
const VALUE_WEEKS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const valueEnv = (players = {}) => ({
  FF_VALUE: JSON.stringify({ base: VALUE_BASE, weeks: VALUE_WEEKS, players }),
});
// A plain free agent (no injury tag, no missing week): Player 08 QB.
const VALUE_MAN = 5008;

/** A table as drawn: per row its position, its Avg cell and its week cells by week number. */
function valueSnap(document, tableId) {
  const table = document.getElementById(tableId);
  const heads = [...table.querySelectorAll('thead th')].map(flat);
  const col = (name) => heads.findIndex((h) => h === name || h.startsWith(`${name} `));
  const posCol = col('Pos');
  const avgCol = col('Avg');
  const cellOf = (td) => (td ? {
    text: flat(td).replace(/\s*[▲▼]$/, ''),
    v: td.getAttribute('data-v'),
    cls: td.getAttribute('class') || '',
  } : null);
  const rows = [...table.querySelectorAll('tbody tr[data-player]')].map((tr) => {
    const weeks = {};
    heads.forEach((h, i) => { if (/^\d+/.test(h)) weeks[parseInt(h, 10)] = cellOf(tr.children[i]); });
    return {
      id: Number(tr.getAttribute('data-player')),
      mine: /\bmine\b/.test(tr.getAttribute('class') || ''),
      pos: flat(tr.children[posCol]).replace(/\d+$/, ''),
      avg: cellOf(tr.children[avgCol]),
      weeks,
    };
  });
  return { rows, posCol, avgCol };
}

const hiddenEl = (el) => !el || el.hidden === true || el.hasAttribute('hidden');
const showState = (document) => ({
  wire: !hiddenEl(document.getElementById('showCtl')),
  taken: !hiddenEl(document.getElementById('takenShowCtl')),
  on: ['showToggle', 'takenShowToggle'].map((id) => {
    const b = document.querySelector(`#${id} button.on`);
    return b ? b.getAttribute('data-show') : null;
  }),
});

/** The glance line in a man's open Actual row; '' when there is none. */
function glanceOf(document, tableId, pid) {
  const row = document.querySelector(`#${tableId} tbody tr#p${pid}`);
  const act = row && row.nextElementSibling;
  const g = act && /\bact-row\b/.test(act.getAttribute('class') || '') ? act.querySelector('.act-glance') : null;
  return g ? flat(g) : '';
}

function tapName(document, window, tableId, pid) {
  const link = document.querySelector(`#${tableId} tbody tr#p${pid} a.pref`);
  if (!link) return false;
  const ev = new window.Event('click', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'button', { value: 0 });
  link.dispatchEvent(ev);
  return true;
}

/**
 * The switch end to end on the wire: as it opens, on Value, a free agent's row
 * opened, then the league read again with that row still open on Next 3 — the
 * one case where his Value needs weeks the page is not showing.
 */
async function valueProbe({ document, window, waitFor }) {
  const espn = await import('./wv-stub-espn.mjs');
  const q = (s) => document.querySelector(s);
  const click = (el) => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const out = { ctl: showState(document), proj: valueSnap(document, 'waiverTable') };
  out.loadCalls = espn.calls.weeks.slice();

  click(q('#showToggle button[data-show="value"]'));
  out.switchCalls = espn.calls.weeks.length;
  out.ctlValue = showState(document);
  out.value = valueSnap(document, 'waiverTable');
  out.prefs = globalThis.localStorage.getItem('ff.prefs');
  out.note = flat(document.getElementById('waiverNote'));
  out.takenNote = flat(document.getElementById('takenNote'));

  // His row opened: selecting a man shows every week left, so his Value has
  // every week it needs for no request of its own.
  out.tapped = tapName(document, window, 'waiverTable', VALUE_MAN);
  await waitFor();
  await settle(30);
  await waitFor();
  out.glance = glanceOf(document, 'waiverTable', VALUE_MAN);
  out.openCalls = espn.calls.weeks.slice();

  // Back to Next 3 with the row still open, and the league read again: the
  // table needs weeks 4–6 (and the played 1–3); his Value needs 4–13.
  click(q('#spanFilter button[data-span="3"]'));
  const waits = [];
  document.dispatchEvent(new window.CustomEvent('ff:refresh', { detail: { waitUntil: (p) => waits.push(p) } }));
  await Promise.all(waits);
  await waitFor();
  await settle(30);
  await waitFor();
  out.reGlance = glanceOf(document, 'waiverTable', VALUE_MAN);
  out.reCalls = espn.calls.weeks.slice(out.openCalls.length);
  out.reShown = [...document.querySelectorAll('#waiverTable thead th')].map(flat).filter((h) => /^\d+/.test(h));

  // Put the page back for the checks every scenario shares.
  click(q('#showToggle button[data-show="proj"]'));
  click(q('#jumpNote button[data-clear]'));
  click(q('#posFilter button[data-pos="ALL"]'));
  click(q('#takenPosFilter button[data-pos="ALL"]'));
  await waitFor();
  globalThis.__wvValue = out;
}

const SCENARIOS = {
  demo: {
    label: '(a) demo mode, nothing connected',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
  },
  // THE "YOUR TEAM" PICKER: every team in the league is offered, and choosing
  // one swaps the "Your …" rows to that team's men and remembers the choice.
  'team-pick': {
    label: '(a+) the Your team picker swaps whose men are "Your …"',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
    after: async ({ document, window, waitFor }) => {
      const sel = document.getElementById('teamSelect');
      const mine = () => [...document.querySelectorAll('#waiverTable tbody tr.mine')]
        .map((tr) => tr.children[0].textContent.trim());
      const out = {
        shown: !document.getElementById('teamPick').hidden,
        options: [...sel.options].map((o) => o.value),
        first: sel.value,
        before: mine(),
      };
      const other = out.options.find((v) => v !== sel.value);
      sel.value = other;
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      out.picked = other;
      out.after = mine();
      out.prefs = globalThis.localStorage.getItem('ff.prefs');
      globalThis.__wvTeam = out;
      // Another team is another Gain column, priced after the repaint.
      await waitFor();
    },
  },
  live: {
    label: '(b) stubbed live league, every week resolves',
    stub: true,
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'live-interact': {
    label: '(b+) filtering, sorting and widening the span',
    stub: true,
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window, waitFor }) => {
      const espn = await import('./wv-stub-espn.mjs');
      const table = document.getElementById('waiverTable');
      const snap = () => ({
        rows: [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.children].map((td) => td.getAttribute('data-v') ?? td.textContent.trim())),
        cols: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      });
      const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

      const out = { before: snap(), fetchesBefore: espn.calls.weeks.slice() };

      // --- position filter: a repaint, never a refetch ---------------------
      click(document.querySelector('#posFilter button[data-pos="WR"]'));
      out.wr = snap();
      out.fetchesAfterFilter = espn.calls.weeks.slice();
      out.wrCount = document.querySelector('#posFilter button[data-pos="WR"] .seg-count').textContent;
      click(document.querySelector('#posFilter button[data-pos="ALL"]'));
      out.backToAll = snap();

      // --- FLEX: three positions at once, still costing nothing -------------
      // The counts and the label are read while it is pressed, because both are
      // claims about the set on screen and neither survives being read after.
      click(document.querySelector('#posFilter button[data-pos="FLEX"]'));
      out.flex = snap();
      out.flexCount =
        document.querySelector('#posFilter button[data-pos="FLEX"] .seg-count').textContent.trim();
      out.flexLabel =
        (document.querySelector('#waiverStats .stat .k') || {}).textContent || '';
      out.flexEmpty = document.querySelectorAll('#waiverTable tbody tr.empty-row').length;
      out.flexPrefs = globalThis.localStorage.getItem('ff.prefs');
      out.fetchesAfterFlex = espn.calls.weeks.slice();
      click(document.querySelector('#posFilter button[data-pos="ALL"]'));

      // --- sorting a week column -------------------------------------------
      const ths = [...table.querySelectorAll('thead th')];
      const w0 = 5 + pastCount(table);     // week 4's column
      click(ths[w0 + 1]);                  // week 5
      out.wk5desc = snap();
      click(ths[w0 + 1]);
      out.wk5asc = snap();
      click(ths[w0]);                      // week 4 -- one player has no number
      out.wk4desc = snap();
      click(ths[w0]);
      out.wk4asc = snap();
      out.sortedHeads = [ths[w0].textContent.trim(), ths[w0 + 1].textContent.trim()];
      out.fetchesAfterSort = espn.calls.weeks.slice();

      // --- widening the span: only the new weeks are fetched ---------------
      click(document.querySelector('#spanFilter button[data-span="6"]'));
      // The three new weeks have to actually arrive before the widened table is
      // snapped, and they arrive when they arrive. 400 ms was long enough only
      // while nothing else wanted the CPU.
      await waitFor();
      out.wide = snap();
      out.fetchesAfterWiden = espn.calls.weeks.slice();

      // --- narrowing again: everything is already cached -------------------
      click(document.querySelector('#spanFilter button[data-span="3"]'));
      await waitFor();
      out.narrow = snap();
      out.fetchesAfterNarrow = espn.calls.weeks.slice();
      out.prefs = globalThis.localStorage.getItem('ff.prefs');

      globalThis.__wv = out;
    },
  },
  // ---- the scale must not move when a FILTER moves -----------------------
  //
  // THE ONE WAY THIS FEATURE COULD BE QUIETLY WRONG. Every scale on this page
  // is built from the UNFILTERED pool, so pressing RB — or FLEX, which is three
  // positions at once — repaints both tables and changes not one cell's colour.
  // Built the other way (from the rows on screen) it would still look perfectly
  // reasonable: every cell would carry a class, the table would be green at the
  // top and red at the bottom, and the colour would silently be about the
  // FILTER rather than about the player. `hot-check.mjs` already pins exactly
  // this for the green box; this is the same promise for the scale.
  //
  // Both tables, because they have independent filters and could drift apart.
  'heat-filter': {
    label: '(f) a position filter repaints the tables and moves no colour at all',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
    after: async ({ document, window }) => {
      const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
      // Keyed by the player's own id, so a row moving up or down the table (a
      // filter changes the row SET, and a sort could change the order) cannot
      // be mistaken for a colour changing.
      const snap = (id, avgCol) => {
        const out = {};
        for (const tr of document.querySelectorAll(`#${id} tbody tr[data-player]`)) {
          const cells = [...tr.children];
          out[`${tr.getAttribute('data-player')}:${/\bmine\b/.test(tr.getAttribute('class') || '') ? 'm' : 'a'}`] =
            cells.slice(avgCol).map((td) => (td.getAttribute('class') || '')
              .split(/\s+/).filter((k) => /^heat/.test(k)).join('.'));
        }
        return out;
      };
      const both = () => ({
        wire: snap('waiverTable', 3),
        taken: snap('takenTable', 4),
        wireKey: (document.getElementById('waiverHeatKey') || {}).textContent || '',
        takenKey: (document.getElementById('takenHeatKey') || {}).textContent || '',
        // The thresholds in points live inside "How to read this table" since
        // 2026-09-19c, so the snapshot has to follow them there: comparing the
        // short visible key across filters would prove nothing about the scale.
        wireBands: (document.getElementById('waiverHeatBands') || {}).textContent || '',
        takenBands: (document.getElementById('takenHeatBands') || {}).textContent || '',
      });

      const out = { all: both() };
      click(document.querySelector('#posFilter button[data-pos="RB"]'));
      out.wireRb = both();
      click(document.querySelector('#posFilter button[data-pos="FLEX"]'));
      out.wireFlex = both();
      click(document.querySelector('#posFilter button[data-pos="ALL"]'));
      click(document.querySelector('#takenPosFilter button[data-pos="WR"]'));
      out.takenWr = both();
      click(document.querySelector('#takenPosFilter button[data-pos="FLEX"]'));
      out.takenFlex = both();
      click(document.querySelector('#takenPosFilter button[data-pos="ALL"]'));
      out.back = both();
      globalThis.__wvHeat = out;
    },
  },

  // Both position filters are remembered per table, so both can be handed back
  // a value the page has to make sense of on the very first paint — before a
  // button has been pressed and with nothing on screen to correct it.
  'flex-saved': {
    label: '(b*) a remembered FLEX comes back, and a remembered nonsense does not stick',
    stub: true,
    prefs: {
      'waivers.source': 'live',
      'waivers.position': 'FLEX',
      // Not a filter this page has ever offered. A value like this can only come
      // from an older build or a hand-edited store, and it must not be able to
      // leave a table showing nobody with no button lit to press your way out.
      'waivers.takenPosition': 'FLEX3',
    },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      globalThis.__wv = {
        on: [...document.querySelectorAll('#posFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        takenOn: [...document.querySelectorAll('#takenPosFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        pos: [...document.querySelectorAll('#waiverTable tbody tr')]
          .map((tr) => tr.children[1].textContent.trim()),
        empty: document.querySelectorAll('#waiverTable tbody tr.empty-row').length,
      };
    },
  },
  // DECEMBER: every regular-season game is decided. The page must still show
  // what is left — the playoff weeks — rather than nothing.
  'live-december': {
    label: '(e) the regular season is over: the playoff weeks are what is shown',
    stub: true,
    env: { WV_PLAYED_THROUGH: '13' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'live-midload': {
    label: '(b++) the span is widened while the first weeks are still in the air',
    stub: true,
    env: { WV_DELAY: '80' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    // 60 ms ON PURPOSE: this scenario exists to catch the page with the first
    // weeks still in the air, and a poll to "finished" here would delete it.
    wait: 60,
    after: async ({ document, window, waitFor }) => {
      const espn = await import('./wv-stub-espn.mjs');
      const table = document.getElementById('waiverTable');
      const inFlight = espn.calls.weeks.slice();
      document
        .querySelector('#spanFilter button[data-span="all"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      // THE ASSERTION BELOW IS "every column filled in" (`w.wait === 0`), so the
      // wait has to be the page's own account of that and not 2.5 s of hoping:
      // thirteen weeks are now bought, each of them a wire list and a roster,
      // with the first three already in flight. Polled on the same `td.wait`
      // cells the assertion counts.
      await waitFor();
      globalThis.__wv = {
        inFlight,
        fetches: espn.calls.weeks.slice(),
        cols: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        rows: table.querySelectorAll('tbody tr').length,
        wait: [...table.querySelectorAll('tbody td.wait')].length,
      };
    },
  },
  'source-switch': {
    label: '(b+++) switching back to demo while a live league is still loading',
    stub: true,
    env: { WV_DELAY: '250' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    // 40 ms ON PURPOSE, as above: the live league must still be loading when
    // the source is switched out from under it.
    wait: 40,
    after: async ({ document, window, waitFor }) => {
      document
        .querySelector('#sourceToggle button[data-src="demo"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      // Demo builds its own pool and its own rosters, and the abandoned live
      // league's weeks are still landing behind it; the assertions are about
      // what is on screen once all of that has settled.
      await waitFor();
      const table = document.getElementById('waiverTable');
      const trs = [...table.querySelectorAll('tbody tr')];
      globalThis.__wv = {
        rows: trs.map((tr) => tr.children[0].textContent.trim()),
        available: trs.filter((tr) => !/\bmine\b/.test(tr.getAttribute('class') || ''))
          .map((tr) => tr.children[0].textContent.trim()),
        badge: document.getElementById('modeBadge').textContent.trim(),
        note: (document.getElementById('waiverStatus').textContent + ' ' +
          document.getElementById('waiverNote').textContent).replace(/\s+/g, ' ').trim(),
      };
    },
  },
  'live-partial': {
    label: '(c) stubbed live league, weeks 5 and 6 reject',
    stub: true,
    env: { WV_FAIL_WEEKS: '5,6' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  // Tim, 2026-09-29: "put a up or down arrow by that player's name if their
  // rest-of-season proj/week has increased or decreased by more than 2 than it
  // was at the begginning of the season. make the down arrow red and up arrow
  // green. make sure it's small so it's not too distracting."
  // Real men from the committed preseason copy, projected flat, in a half-PPR
  // league (wv-stub-espn TREND_MEN, wv-stub-season TREND_SQUADS).
  trend: {
    label: '(g) the preseason arrows: green ▲ / red ▼ by a name that moved more than 2 a week',
    stub: true,
    env: { WV_TREND: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    // THE ARROW IS REST OF SEASON, WHATEVER THE SPAN: every row's arrow (class
    // and words) under Next 3, Next 6, Rest of season and back — and what each
    // step bought.
    after: async ({ document, window, waitFor }) => {
      const espn = await import('./wv-stub-espn.mjs');
      const season = await import('./wv-stub-season.mjs');
      const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
      const snap = () => [...document.querySelectorAll('#waiverTable tbody tr[data-player], #takenTable tbody tr[data-player]')]
        .map((tr) => {
          const t = tr.querySelector('.trend');
          const table = tr.closest('table').getAttribute('id');
          return `${table}:${tr.getAttribute('data-player')}:${t ? `${t.getAttribute('class')}|${t.getAttribute('title')}` : '-'}`;
        }).sort();
      const out = {
        next3: snap(),
        wire3: espn.calls.weeks.slice(),
        rosters3: season.calls.rosterWeeks.slice(),
      };
      click(document.querySelector('#spanFilter button[data-span="6"]'));
      await waitFor();
      out.next6 = snap();
      click(document.querySelector('#spanFilter button[data-span="all"]'));
      await waitFor();
      out.all = snap();
      out.wireAll = espn.calls.weeks.slice();
      out.rostersAll = season.calls.rosterWeeks.slice();
      click(document.querySelector('#spanFilter button[data-span="3"]'));
      await waitFor();
      out.back = snap();
      globalThis.__wvTrend = out;
    },
  },
  // AN EARLIER SEASON of the same league (main menu, 2026-10-10): the very men
  // who carry an arrow above carry none — the preseason copy is of 2026, and a
  // 2025 projection set against it would be two different years.
  'trend-past': {
    label: '(g2) an earlier season: the same men, and no preseason arrow or key',
    stub: true,
    env: { WV_TREND: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2025, teamId: 4 },
  },
  // GAIN (2026-10-06): what adding a free agent is worth to YOUR lineup — one
  // sortable column after Avg, filled in after the table paints, whose figure
  // opens the weeks it is formed from. The arithmetic is proved against a brute
  // force in test-waiver-gain.mjs; what is asserted here is the PAGE: the
  // column is there, it sorts, and the preview's rows sum to the cell.
  gain: {
    label: '(h) Gain: sortable, and its preview sums to the cell',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
    after: async ({ document, window, waitFor }) => {
      globalThis.__wvGain = await gainProbe({ document, window, waitFor });
    },
  },
  // THE PREVIEWS (2026-10-08, docs/previews-plan.md "Players"). Every figure on
  // this page that had a `title` opens the site's stat card instead: what the
  // number is made of, where it stands in the group its colour compares it
  // with, and — where there is somewhere to go — a click that goes there.
  // Read here: one card of each kind by hover, the clicks, and the finger's
  // sheet. The page is put back the way it was found afterwards, because the
  // click on a Gain figure selects a man, and the rest of this file's checks
  // read the table as it first draws.
  previews: {
    label: '(p) the previews: a card on every figure, and where each click goes',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
    after: async ({ document, window, waitFor }) => {
      const out = { cards: {}, went: {}, sheet: {} };
      const fire = (el, type) => {
        const ev = new window.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'button', { value: 0 });
        el.dispatchEvent(ev);
        return ev;
      };
      const pop = () => document.getElementById('statCard');
      const q = (sel) => document.querySelector(sel);
      const SPOTS = {
        avg: '#waiverTable tbody tr:not(.mine) td[data-c="avg"]',
        avgMine: '#waiverTable tbody tr.mine td[data-c="avg"]',
        wk: '#waiverTable tbody tr:not(.mine) td[data-c="wk"]',
        beats: '#waiverTable tbody td.beats[data-c="wk"]',
        past: '#waiverTable tbody td[data-c="past"]',
        tag: '#waiverTable tbody .mine-tag',
        gain: '#waiverTable tbody td.gain .gn[data-gain]',
        tAvg: '#takenTable tbody td[data-c="avg"]',
        tWk: '#takenTable tbody td[data-c="wk"]',
        pos: '#takenTable tbody td[data-c="pos"][data-go]',
        own: '#takenTable tbody td[data-c="own"]',
        name: '#waiverTable tbody tr:not(.mine) td.name a.pref',
        nameMine: '#waiverTable tbody tr.mine td.name a.pref',
        tName: '#takenTable tbody td.name a.pref',
      };
      // The row a spot sits in, for the ids its link must carry.
      for (const [k, sel] of Object.entries(SPOTS)) {
        const el = q(sel);
        const tr = el && el.closest('tr');
        out.cards[k] = {
          found: Boolean(el),
          cell: flat(el),
          pid: tr ? tr.getAttribute('data-player') : null,
          week: el ? el.getAttribute('data-w') : null,
          titled: Boolean(el && el.hasAttribute('title')),
          said: cardText(el),
        };
      }
      // WHERE A CLICK GOES, for a mouse. The page's own navigation is caught
      // rather than followed.
      const went = [];
      const loc = window.location;
      const hadAssign = loc.assign;
      loc.assign = (href) => { went.push(String(href)); };
      for (const k of ['avg', 'wk', 'past', 'tag', 'pos', 'own', 'tWk']) {
        const el = q(SPOTS[k]);
        went.length = 0;
        if (el) fire(el, 'click');
        out.went[k] = went.slice();
      }
      // THE FINGER: a tap opens the same card as a sheet, with the link as a
      // button and a Close — and goes nowhere by itself.
      const realMedia = window.matchMedia;
      window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      for (const k of ['pos', 'own', 'past', 'gain', 'avg']) {
        const el = q(SPOTS[k]);
        went.length = 0;
        if (el) fire(el, 'click');
        const p = pop();
        const link = p && p.querySelector('.tc-open');
        const drop = p && p.querySelector('.op-drop a');
        out.sheet[k] = {
          open: cardOpen(p),
          sheet: Boolean(p && /\bsheet\b/.test(p.getAttribute('class') || '')),
          href: link ? link.getAttribute('href') : null,
          label: link ? flat(link) : '',
          drop: drop ? drop.getAttribute('href') : null,
          close: flat(p && p.querySelector('.tc-close')),
          went: went.slice(),
        };
        const x = p && p.querySelector('.tc-close');
        if (x) fire(x, 'click');
        out.sheet[k].shut = !cardOpen(pop());
      }
      // A NAME under a finger has no card: the tap is left to open his row.
      out.nameTouch = cardText(q(SPOTS.name));
      window.matchMedia = realMedia;
      // THE GAIN FIGURE, clicked with a mouse: the man the move would drop is
      // selected on this page, no reload.
      const gn = q(SPOTS.gain);
      const dropId = (/player=(\d+)/.exec((out.sheet.gain || {}).drop || '') || [])[1] || null;
      went.length = 0;
      if (gn) fire(gn, 'click');
      await waitFor();
      // His row is in whichever table holds him — your own man is a Taken one.
      const picked = dropId && [...document.querySelectorAll(`tbody tr#p${dropId}`)]
        .find((tr) => tr.nextElementSibling &&
          /\bact-row\b/.test(tr.nextElementSibling.getAttribute('class') || ''));
      out.jump = {
        dropId,
        went: went.slice(),
        selected: Boolean(picked),
        actual: Boolean(picked && picked.nextElementSibling &&
          /\bact-row\b/.test(picked.nextElementSibling.getAttribute('class') || '')),
        note: flat(document.getElementById('jumpNote')),
        cardShut: !cardOpen(pop()),
      };
      if (hadAssign) loc.assign = hadAssign; else delete loc.assign;
      // Put the page back: no man selected, three weeks, every position.
      const clear = q('#jumpNote button[data-clear]');
      if (clear) fire(clear, 'click');
      fire(q('#spanFilter button[data-span="3"]'), 'click');
      fire(q('#posFilter button[data-pos="ALL"]'), 'click');
      fire(q('#takenPosFilter button[data-pos="ALL"]'), 'click');
      await waitFor();
      globalThis.__wvPreviews = out;
    },
  },
  // Nobody is "you": the column is dashes and its title says how to fix that.
  // Then a team is chosen on the page, and the column fills — for no request.
  // WV_TREND is the stub league that HAS squads (the plain one rosters nobody),
  // and its men are in the preseason copy, so this is also the real-league
  // path: Gain waits for the rest of the season the arrows read, and prices it.
  'gain-noteam': {
    label: '(h+) Gain with no team: dashes, a title saying to pick one, then a team is picked',
    stub: true,
    env: { WV_TREND: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026 },
    after: async ({ document, window, waitFor }) => {
      const espn = await import('./wv-stub-espn.mjs');
      const season = await import('./wv-stub-season.mjs');
      const spent = () => espn.calls.weeks.length + season.calls.rosterWeeks.length;
      const out = { none: gainSnap(document), spentBefore: spent() };
      const sel = document.getElementById('teamSelect');
      sel.value = '4';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await waitFor();
      out.picked = await gainProbe({ document, window, waitFor });
      out.spentAfter = spent();
      globalThis.__wvGain = out;
    },
  },
  // PROJ | VALUE. The league's frozen lines arrive through the stub (FF_VALUE),
  // in the shape js/season.js hands them over.
  value: {
    label: '(v) Proj | Value on the wire, and a free agent’s own Value',
    stub: true,
    env: valueEnv(),
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: valueProbe,
  },
  // The same, on the phone's synced copy: nothing is asked of ESPN for Value.
  'value-cloud': {
    label: '(v+) the synced copy: no request for a Value, a dash where it cannot be said',
    stub: true,
    env: { ...valueEnv(), WV_CLOUD: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: valueProbe,
  },
  // No lines for this league: no switch, and a saved "Value" changes nothing.
  'value-nobase': {
    label: '(v−) no baseline: the switch is hidden and the page is as it was',
    stub: true,
    prefs: { 'waivers.source': 'live', 'waivers.show': 'value' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window, waitFor }) => {
      const out = { ctl: showState(document), proj: valueSnap(document, 'waiverTable') };
      out.note = flat(document.getElementById('waiverNote'));
      tapName(document, window, 'waiverTable', VALUE_MAN);
      await waitFor();
      await settle(30);
      await waitFor();
      out.glance = glanceOf(document, 'waiverTable', VALUE_MAN);
      const click = (el) => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
      click(document.querySelector('#jumpNote button[data-clear]'));
      click(document.querySelector('#spanFilter button[data-span="3"]'));
      click(document.querySelector('#posFilter button[data-pos="ALL"]'));
      await waitFor();
      globalThis.__wvValue = out;
    },
  },
  // The league with squads: the Taken table on Value, your own rows on the
  // wire, and a rostered man's Value from js/season.js on his glance line.
  // 7399's Value is deliberately NOT what his 9.0 a week would give (0.5), so
  // the glance line can only have read it from `fetchPlayerValues().lookup`.
  'value-taken': {
    label: '(v++) Proj | Value on the Taken table, and a rostered man’s own Value',
    stub: true,
    env: { ...valueEnv({ 7399: { position: 'WR', avg: 9.4, value: 0.7 } }), WV_TREND: '1' },
    prefs: { 'waivers.source': 'live', 'waivers.show': 'value' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window, waitFor }) => {
      const out = {
        ctl: showState(document),
        taken: valueSnap(document, 'takenTable'),
        wire: valueSnap(document, 'waiverTable'),
      };
      const click = (el) => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
      const glance = async (pid) => {
        // Selecting a man narrows the table to his position: back to All first.
        click(document.querySelector('#takenPosFilter button[data-pos="ALL"]'));
        tapName(document, window, 'takenTable', pid);
        await waitFor();
        await settle(30);
        await waitFor();
        return glanceOf(document, 'takenTable', pid);
      };
      out.known = await glance(7399);
      out.unknown = await glance(4431459);
      click(document.querySelector('#takenShowToggle button[data-show="proj"]'));
      click(document.querySelector('#takenPosFilter button[data-pos="ALL"]'));
      out.back = showState(document);
      out.takenProj = valueSnap(document, 'takenTable');
      out.prefs = globalThis.localStorage.getItem('ff.prefs');
      click(document.querySelector('#jumpNote button[data-clear]'));
      click(document.querySelector('#spanFilter button[data-span="3"]'));
      click(document.querySelector('#posFilter button[data-pos="ALL"]'));
      click(document.querySelector('#takenPosFilter button[data-pos="ALL"]'));
      await waitFor();
      globalThis.__wvValue = out;
    },
  },
  'live-empty': {
    label: '(d) stubbed live league with an empty free-agent pool',
    stub: true,
    env: { WV_EMPTY: '1' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
};

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  const html = readFileSync(path.join(REPO, 'waivers.html'), 'utf8');
  const { window, document } = parseHTML(html);

  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const head = kids(this, 'THEAD')[0];
      const rows = [];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      rows.push(...kids(this, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  if (!window.location) {
    window.location = {
      href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:',
      pathname: '/waivers.html', search: '', hash: '',
    };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
  if (cfg.prefs) store.set('ff.prefs', JSON.stringify(cfg.prefs));
  if (cfg.conn) store.set('ff.connection', JSON.stringify(cfg.conn));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`unexpected network call: ${url}`);
  };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(String(r)));

  await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);

  // Collected rather than discarded, so a poll that hit its ceiling is asserted
  // below by name instead of turning into a mismatch about a table cell.
  const settles = [];
  const waitFor = async (max) => {
    const r = await settleWaivers(document, max);
    settles.push(r);
    return r;
  };

  // `cfg.wait` is a DELIBERATE mid-load lead (see the note at the top); every
  // other scenario waits for the page to say it has finished. That 500 ms was
  // what `live`, `live-partial`, `live-december`, `live-empty`, `flex-saved` and
  // `heat-filter` all used to get, and on a busy machine it is not enough for a
  // page that buys two requests per week.
  if (cfg.wait != null) await settle(cfg.wait);
  else await waitFor();
  if (cfg.after) await cfg.after({ document, window, waitFor });
  console.error = origError;

  return { document, window, errors, fetchCalls, rejections, cfg, settles };
}

// ------------------------------------------------------------- assertions

function makeChecker() {
  const out = [];
  return {
    out,
    ok(name, cond, detail = '') {
      out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 400) });
    },
  };
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

function headers(table) {
  return [...table.querySelectorAll('thead th')].map((th) => txt(th));
}

function bodyRows(table) {
  return [...table.querySelectorAll('tbody tr')].map((tr) => ({
    cls: tr.getAttribute('class') || '',
    cells: [...tr.children].map((td) => ({
      text: txt(td),
      v: td.getAttribute('data-v'),
      cls: td.getAttribute('class') || '',
      // A cell with a preview carries NO `title` (2026-10-08): the sentence it
      // used to hold is in the stat card, read on demand with `cardText(c.el)`.
      title: td.getAttribute('title') || '',
      el: td,
    })),
  }));
}

/** '' or 'heat-up-N' / 'heat-dn-N' off a class list; 0 for neither. */
function stepOf(cls) {
  const m = (cls || '').match(/heat-(up|dn)-(\d)/);
  return m ? (m[1] === 'up' ? 1 : -1) * Number(m[2]) : 0;
}

/** Monotonic check that ignores rows whose key is missing (they must trail). */
function ordered(values, asc) {
  const nums = [];
  let seenNull = false;
  let nullBeforeNumber = false;
  for (const v of values) {
    if (v === null) { seenNull = true; continue; }
    if (seenNull) nullBeforeNumber = true;
    nums.push(v);
  }
  const monotonic = nums.every((v, i) => i === 0 || (asc ? v >= nums[i - 1] : v <= nums[i - 1]));
  return { monotonic, nullsLast: !nullBeforeNumber, n: nums.length };
}

// =========================================================================
// THE SHARED RED/GREEN SCALE ON THIS PAGE (js/heat.js, Tim 2026-09-19b)
// =========================================================================
//
// "The coloring is good right now but it needs to be added to all the other
// places a number is referred to across the whole site."
//
// This page was the hard case, because it is the one with a green of its own
// (two until 2026-10-09, when the green NUMBER was removed and the box became
// "you would start him"), and the collision is real rather than aesthetic: `td.beats` owns a
// cell's BACKGROUND with a `background` SHORTHAND at higher specificity than
// `.heat-up-3`, so a tint on a shaded week cell would be ERASED — the page
// would have made a claim it never drew. So the scale went where nothing is
// competing for the channel, and what is asserted here is that split:
//
//   - the wire's Avg column IS coloured, per position, over the wire;
//   - the wire's WEEK cells are NOT, and the green box is still there;
//   - the Taken table's Avg AND week columns are coloured, per position (and,
//     for the weeks, per week), which is new — that table carried no colour of
//     any kind before this;
//   - a state cell — Bye, a ruled-out 0.0, a blank — is never coloured;
//   - the colour key comes in TWO LAYERS and each is asserted WHERE IT BELONGS:
//     a short sentence on screen naming the comparison group and the two
//     hue-free cues, and the thresholds in points inside "How to read this
//     table", so a cell can still be checked by hand. Asserting the words
//     without the placement is what would let the thresholds creep back under
//     the table — which is the +193 visible words `node tests/text-audit.mjs`
//     caught on 2026-09-19c.
//
// The "a filter must not recolour anything" half is the `heat-filter` scenario.
function checkHeat(c, d, scenario, note) {
  const wire = bodyRows(d.getElementById('waiverTable'))
    .filter((r) => !/\bempty-row\b/.test(r.cls));
  const taken = bodyRows(d.getElementById('takenTable'))
    .filter((r) => !/\bempty-row\b/.test(r.cls));
  const AVG = 3;            // Player, Pos, Tm, Avg (then Gain, then the weeks)
  const T_AVG = 4;          // Player, Pos, Tm, Owner, Avg
  const wireAvg = wire.map((r) => r.cells[AVG]).filter(Boolean);
  const takenAvg = taken.map((r) => r.cells[T_AVG]).filter(Boolean);
  const wireWeeks = wire.flatMap((r) => r.cells.slice(AVG + 2));
  const takenWeeks = taken.flatMap((r) => r.cells.slice(T_AVG + 1));

  // ---- the wire: Avg, and since 2026-10-08 every week still to play --------
  // ("Available table future-week cells, position by week, the way the Taken
  // table already does it — the existing `hot` and `beats` marks must still
  // read on top." `hot`, the green number, was removed 2026-10-09.) `td.beats` paints a background-COLOR now, so the tint, a
  // background-image, composes over it instead of being erased.
  const RANKED = /\b\d+(st|nd|rd|th) of \d+ /;
  if (wire.length > 2) {
    c.ok('THE WIRE’S WEEK CELLS ARE ON THE SCALE: position by week, as the Taken table is',
      wireWeeks.some((td) => /heat-(up|dn)-\d/.test(td.cls)),
      JSON.stringify(wireWeeks.map((td) => td.cls).slice(0, 6)));
    const claims = wireWeeks.filter((td) => /\b(hot|beats)\b/.test(td.cls));
    c.ok('and a cell is BOTH: the claim green and the scale sit on the same cell',
      claims.length === 0 || claims.some((td) => /\bheat\b/.test(td.cls)),
      JSON.stringify(claims.map((td) => td.cls).slice(0, 3)));
    c.ok('a Bye, a 0.0, a blank and a week already played are never coloured there',
      wireWeeks.filter((td) => /\b(bye|zero|zero-out|wait|wk-past)\b/.test(td.cls) || td.v === null)
        .every((td) => !/\bheat\b/.test(td.cls)),
      JSON.stringify(wireWeeks.filter((td) => (/\b(bye|zero|zero-out|wait|wk-past)\b/.test(td.cls) || td.v === null) &&
        /\bheat\b/.test(td.cls)).map((td) => `${td.text}:${td.cls}`).slice(0, 3)));
    const wkCol = wireWeeks.filter((td) => /heat-(up|dn)-\d/.test(td.cls)).slice(0, 40);
    const wkBad = wkCol.map((td) => cardText(td.el))
      .filter((s) => !(RANKED.test(s) && /free-agent \S+ this week/.test(s) && / · Week \d+/.test(s)) || /\bSD\b/.test(s));
    c.ok('every coloured week cell’s preview says the position AND the week it was measured in',
      wkBad.length === 0, wkBad[0]);
  }
  // Tim, 2026-10-09: "Remove the highlighting the actual number in green feature".
  c.ok('and NOT ONE CELL in either table is a green number any more',
    [...wireWeeks, ...takenWeeks].every((td) => !/\bhot\b/.test(td.cls)) &&
    d.querySelectorAll('td.hot, .legend .hot, .hot-key').length === 0,
    `${[...wireWeeks, ...takenWeeks].filter((td) => /\bhot\b/.test(td.cls)).length} green-text cells`);
  // THE POSITIVE ASSERTION COMES FIRST AND IS UNGUARDED. Everything below it
  // reads the colours that are there, so a page that drew none would simply
  // skip the lot and "pass" — which is exactly the vacuous green this suite
  // exists to avoid. `live-empty` has no wire at all and is the one scenario
  // where there is honestly nothing to colour.
  if (wire.length > 2) {
    c.ok('THE WIRE’S Avg COLUMN IS COLOURED AT ALL',
      wireAvg.some((td) => /heat-(up|dn)-\d/.test(td.cls)),
      JSON.stringify(wireAvg.map((td) => `${td.v}:${td.cls}`).slice(0, 4)));
  }
  if (taken.length > 2) {
    c.ok('AND SO IS THE TAKEN TABLE, which carried no colour of any kind before this',
      takenAvg.some((td) => /heat-(up|dn)-\d/.test(td.cls)) &&
      takenWeeks.some((td) => /heat-(up|dn)-\d/.test(td.cls)),
      `${takenAvg.filter((td) => /heat-(up|dn)/.test(td.cls)).length} avg, ` +
      `${takenWeeks.filter((td) => /heat-(up|dn)/.test(td.cls)).length} week cells`);
  }

  if (wireAvg.some((td) => /\bheat\b/.test(td.cls))) {
    c.ok('every wire Avg with a number carries the class',
      wireAvg.filter((td) => td.v !== null).every((td) => /\bheat\b/.test(td.cls)),
      JSON.stringify(wireAvg.map((td) => `${td.v}:${td.cls}`).slice(0, 4)));
    c.ok('an Avg with no number is never coloured',
      wireAvg.filter((td) => td.v === null).every((td) => !/\bheat\b/.test(td.cls)),
      JSON.stringify(wireAvg.filter((td) => td.v === null).map((td) => td.cls).slice(0, 3)));
    c.ok('and your own “Your …” row is measured too, against those same free agents',
      wire.filter((r) => /\bmine\b/.test(r.cls))
        .every((r) => r.cells[AVG].v === null || /\bheat\b/.test(r.cells[AVG].cls)),
      JSON.stringify(wire.filter((r) => /\bmine\b/.test(r.cls))
        .map((r) => `${r.cells[AVG].v}:${r.cells[AVG].cls}`)));
    const mineSaid = wire.filter((r) => /\bmine\b/.test(r.cls) && /\bheat\b/.test(r.cells[AVG].cls))
      .map((r) => cardText(r.cells[AVG].el));
    c.ok('and it says so in the cell’s preview: yours, and where he WOULD stand among them',
      mineSaid.every((s) => /Yours — would be \d+(st|nd|rd|th) of \d+ free-agent /.test(s)),
      mineSaid[0]);
    // THE ANSWER TO "it runs green, grey, green and looks broken": sorted by
    // value the column mixes positions, so every coloured Avg names its group.
    const avgSaid = wireAvg.filter((td) => /heat-(up|dn)-\d/.test(td.cls)).map((td) => cardText(td.el));
    c.ok('THE COMPARISON GROUP IS HIS POSITION, said in every coloured Avg’s preview ("2nd of 17 free-agent QBs")',
      avgSaid.length > 0 && avgSaid.every((s) => RANKED.test(s) && !/\bSD\b/.test(s) &&
        /free-agent (QBs|RBs|WRs|TEs|kickers|defenses)/.test(s)),
      avgSaid.find((s) => !(RANKED.test(s) && /free-agent (QBs|RBs|WRs|TEs|kickers|defenses)/.test(s))) ?? avgSaid[0]);
    c.ok('and no cell with a preview carries a `title` as well',
      wireAvg.concat(wireWeeks).filter((td) => td.el.hasAttribute('data-c')).every((td) => td.title === ''),
      wireAvg.concat(wireWeeks).find((td) => td.el.hasAttribute('data-c') && td.title)?.title);
    // The swatch in the legend above the table, shown in the very treatment
    // the table draws. `data-when` hides it unless the mark is on screen, so
    // this also proves the selector in waivers.html addresses the right cells —
    // `td.avg.heat-up-4`, the Avg column and nothing else.
    const swatchShown = (id, sel) => {
      const el = d.querySelector(`#${id} [data-when="${sel}"]`);
      return el && !el.hasAttribute('hidden');
    };
    if (wireAvg.some((td) => /heat-up-4/.test(td.cls))) {
      c.ok('the legend above the wire shows the scale’s green swatch when a cell has one',
        swatchShown('waiverLegend', 'td.avg.heat-up-4'),
        d.getElementById('waiverLegend').innerHTML.slice(0, 200));
    }
    // ---- WHERE EACH HALF OF THE COLOUR KEY LIVES ---------------------------
    //
    // Two layers, and the assertions check the LAYER as well as the words. A
    // test that only asked "is this sentence somewhere on the page" would let
    // the thresholds drift back under the table — which is exactly the
    // regression this split fixed, and `node tests/text-audit.mjs` measured at
    // +193 visible words on this page alone.
    const wireKeyEl = d.getElementById('waiverHeatKey');
    const wireBandsEl = d.getElementById('waiverHeatBands');
    c.ok('THE VISIBLE KEY IS SHORT and names the group the colour compares',
      /compares free agents at the same position, week by week/.test(txt(wireKeyEl)) &&
      txt(wireKeyEl).split(/\s+/).length <= 25,
      txt(wireKeyEl));
    c.ok('and it is OUTSIDE the toggle, so the colour is never unexplained on screen',
      wireKeyEl && !wireKeyEl.closest('details'), txt(wireKeyEl));
    c.ok('it names the two cues that do not need red told from green',
      /arrow/.test(txt(wireKeyEl)) && /heavier type/.test(txt(wireKeyEl)), txt(wireKeyEl));
    c.ok('and it does NOT carry the thresholds: that is what made the page wordy',
      !/Full colour at \(red \/ green\)/.test(txt(wireKeyEl)), txt(wireKeyEl));
    c.ok('THE THRESHOLDS IN POINTS SURVIVE, per position — a colour nobody can ' +
      'check by hand is decoration',
      /full colour at \(red \/ green\)/i.test(txt(wireBandsEl)) &&
      /\bQB\b/.test(txt(wireBandsEl)) && /\bDST\b/.test(txt(wireBandsEl)),
      txt(wireBandsEl));
    c.ok('and they are INSIDE “How to read this table”, where the method lives',
      wireBandsEl && !!wireBandsEl.closest('details.explain'),
      wireBandsEl ? 'no details.explain above it' : 'no #waiverHeatBands at all');
    c.ok('the toggle says the week columns are on the scale, and that the green box sits on top of it',
      /Each week cell is on the same scale, measured against the other free agents at his position in that same week/.test(note) &&
      /The green box sits on top of it/.test(note) && !/two greens|green number/.test(note) &&
      !/deliberately left off that scale/.test(note),
      note.slice(note.indexOf('And on the week columns'), note.indexOf('And on the week columns') + 500));
    c.ok('the note argues the pool: the wire at his position, not the whole league',
      /compared only with the other free agents in that same position/.test(note) &&
      /nobody wanted/.test(note), note.slice(0, 1400));
  }

  // ---- the taken table: a table that had no colour of any kind ------------
  if (takenAvg.some((td) => /\bheat\b/.test(td.cls))) {
    c.ok('THE TAKEN TABLE’S Avg COLUMN IS ON THE SCALE',
      takenAvg.filter((td) => td.v !== null).every((td) => /\bheat\b/.test(td.cls)),
      JSON.stringify(takenAvg.map((td) => `${td.v}:${td.cls}`).slice(0, 4)));
    c.ok('AND SO ARE ITS WEEK COLUMNS, which carry no claim cue to collide with',
      takenWeeks.some((td) => /heat-(up|dn)-\d/.test(td.cls)),
      JSON.stringify(takenWeeks.map((td) => td.cls).slice(0, 5)));
    c.ok('but NO GREEN BOX is on that table — nobody here can be claimed',
      takenWeeks.every((td) => !/\b(hot|beats)\b/.test(td.cls)),
      JSON.stringify(takenWeeks.filter((td) => /\b(hot|beats)\b/.test(td.cls))
        .map((td) => td.cls).slice(0, 3)));
    c.ok('A BYE, A RULED-OUT 0.0 AND A BLANK ARE NEVER COLOURED AND NEVER COUNTED',
      takenWeeks.filter((td) => /\b(bye|zero|zero-out|wait)\b/.test(td.cls) || td.v === null)
        .every((td) => !/\bheat\b/.test(td.cls)),
      JSON.stringify(takenWeeks
        .filter((td) => (/\b(bye|zero|zero-out|wait)\b/.test(td.cls) || td.v === null) &&
          /\bheat\b/.test(td.cls)).map((td) => `${td.text}:${td.cls}`).slice(0, 3)));
    const takenSaid = takenWeeks.filter((td) => /heat-(up|dn)-\d/.test(td.cls)).slice(0, 60)
      .map((td) => cardText(td.el));
    c.ok('every coloured week cell’s preview says which position AND which week it was measured in',
      takenSaid.length > 0 && takenSaid.every((s) => /\b\d+(st|nd|rd|th) of \d+ rostered \S+ this week/.test(s) &&
        !/\bSD\b/.test(s) && / · Week \d+/.test(s)),
      takenSaid.find((s) => !/\b\d+(st|nd|rd|th) of \d+ rostered \S+ this week/.test(s)) ?? takenSaid[0]);
    c.ok('a cell at the end of the scale carries the glyph, and only there',
      [...takenAvg, ...takenWeeks].filter((td) => /heat-(up|dn)-4/.test(td.cls))
        .every((td) => /[▲▼]/.test(td.text)) &&
      [...takenAvg, ...takenWeeks].filter((td) => /heat-(up|dn)-[123]\b/.test(td.cls))
        .every((td) => !/[▲▼]/.test(td.text)),
      JSON.stringify([...takenAvg, ...takenWeeks]
        .filter((td) => /heat-(up|dn)-4/.test(td.cls)).map((td) => td.text).slice(0, 3)));
    c.ok('no cell is two steps at once',
      [...takenAvg, ...takenWeeks]
        .every((td) => (td.cls.match(/heat-(?:up|dn)-\d|heat-0/g) || []).length <= 1),
      JSON.stringify([...takenWeeks].map((td) => td.cls).slice(0, 4)));
    // A POSITION IS THE GROUP, NEVER THE TABLE. The proof that survives a
    // re-read: the best kicker is GREEN while every quarterback in the league
    // outscores him, which one scale down the column could not produce.
    const avgByPos = new Map();
    for (const r of taken) {
      const pos = r.cells[1].text.replace(/\d+$/, '');
      const td = r.cells[T_AVG];
      if (td.v === null) continue;
      if (!avgByPos.has(pos)) avgByPos.set(pos, []);
      avgByPos.get(pos).push({ v: Number(td.v), step: stepOf(td.cls) });
    }
    const k = avgByPos.get('K') || [];
    if (k.length > 1) {
      c.ok('a kicker can be green — a whole position is never painted one colour for being ' +
        'that position',
        k.some((x) => x.step > 0) && k.some((x) => x.step < 0),
        JSON.stringify(k.map((x) => `${x.v}:${x.step}`)));
    }
    // THE PROOF THAT THE TABLE IS NOT ONE SCALE, and it is one line: somewhere
    // in this table a GREEN number is SMALLER than a RED one. Under a single
    // scale down the column that is impossible by construction, so this fails
    // the moment the group stops being a position.
    const flat = [...avgByPos.values()].flat();
    const greens = flat.filter((x) => x.step > 0);
    const reds = flat.filter((x) => x.step < 0);
    c.ok('A POSITION IS THE COMPARISON GROUP, NEVER THE TABLE: a green number here is ' +
      'smaller than a red one, which one scale down the column could not produce',
      greens.length > 0 && reds.length > 0 &&
      Math.min(...greens.map((x) => x.v)) < Math.max(...reds.map((x) => x.v)),
      `green min ${Math.min(...greens.map((x) => x.v))} vs red max ${Math.max(...reds.map((x) => x.v))}`);
    // And inside a position, the ordering and the colour never disagree.
    const orderWrong = [];
    for (const [pos, list] of avgByPos) {
      const sorted = list.slice().sort((a, b) => b.v - a.v);
      for (let n = 1; n < sorted.length; n++) {
        if (sorted[n].step > sorted[n - 1].step) {
          orderWrong.push(`${pos}: ${sorted[n].v} greener than ${sorted[n - 1].v}`);
        }
      }
    }
    c.ok('and inside a position the shading never disagrees with the ordering',
      orderWrong.length === 0, orderWrong.slice(0, 3).join(' | '));

    // A WEEK COLUMN IS ALSO A GROUP, and this is the half a per-position-only
    // scale would silently get wrong: the same projection in two different
    // weeks must be able to come out a different colour, because a heavy bye
    // week is not a bad week for the man playing in it.
    const byValue = new Map();
    for (const r of taken) {
      const pos = r.cells[1].text.replace(/\d+$/, '');
      r.cells.slice(T_AVG + 1).forEach((td, i) => {
        if (td.v === null || td.v === '0') return;
        const key = `${pos}:${Number(td.v).toFixed(1)}`;
        if (!byValue.has(key)) byValue.set(key, new Set());
        byValue.get(key).add(`${i}:${stepOf(td.cls)}`);
      });
    }
    const disagreeing = [...byValue.entries()].filter(([, set]) =>
      new Set([...set].map((s) => s.split(':')[1])).size > 1);
    const repeated = [...byValue.entries()].filter(([, set]) =>
      new Set([...set].map((s) => s.split(':')[0])).size > 1);
    if (repeated.length) {
      c.ok('EACH WEEK COLUMN IS ITS OWN GROUP: the same projection comes out a different ' +
        'colour in a different week, which one scale per position could not do',
        disagreeing.length > 0,
        JSON.stringify(repeated.slice(0, 4).map(([key, s]) => `${key}:${[...s]}`)));
    }

    if (takenAvg.some((td) => /heat-dn-4/.test(td.cls)) ||
        takenWeeks.some((td) => /heat-dn-4/.test(td.cls))) {
      const el = d.querySelector('#takenLegend [data-when="td.heat-dn-4"]');
      c.ok('the legend above the taken table shows the scale’s red swatch',
        el && !el.hasAttribute('hidden'),
        d.getElementById('takenLegend').innerHTML.slice(0, 200));
    }
    c.ok('and the chip beside it still says why there is NO GREEN BOX on this table',
      /No green box — nobody here can be claimed/.test(txt(d.getElementById('takenLegend'))),
      txt(d.getElementById('takenLegend')));

    const takenKeyEl = d.getElementById('takenHeatKey');
    const takenBandsEl = d.getElementById('takenHeatBands');
    const takenKey = txt(takenKeyEl);
    const takenBands = txt(takenBandsEl);
    const takenNote = txt(d.getElementById('takenNote'));
    c.ok('THE VISIBLE KEY SAYS THE GROUP IS THE POSITION, AND THE WEEK',
      /compares men at the same position, week by week/.test(takenKey), takenKey);
    c.ok('and it is short, and outside the toggle',
      takenKeyEl && !takenKeyEl.closest('details') && takenKey.split(/\s+/).length <= 25,
      takenKey);
    c.ok('and it names the arrow and the weight, so none of it needs red told from green',
      /arrow/.test(takenKey) && /heavier type/.test(takenKey), takenKey);
    c.ok('THE QUARTERBACK-AND-KICKER RULE IS STILL WRITTEN OUT, in the toggle',
      /a quarterback is never measured against a kicker/i.test(takenBands + ' ' + takenNote),
      takenBands);
    c.ok('the thresholds in points survive, inside “How to read this table”',
      /full colour at \(red \/ green\)/i.test(takenBands) &&
      takenBandsEl && !!takenBandsEl.closest('details.explain'),
      takenBands);
    c.ok('and the visible key does not repeat them',
      !/full colour at/i.test(takenKey), takenKey);
  }
}

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);
  const table = $('waiverTable');
  // The short status line (demo notice, refusals, progress) sits visibly above
  // the table; the rest is tucked in the explanation below it. Both are read.
  const note = txt($('waiverStatus')) + ' ' + txt($('waiverNote'));

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));

  // EVERY POLL REACHED THE PAGE'S FINISHED STATE, not its ceiling — so "the
  // weeks never arrived" is reported as that, by name, rather than as a row
  // count that came up short for no stated reason.
  {
    const stuck = (boot.settles || []).filter((s) => !s.ok);
    c.ok('the page reached its own finished state within the poll’s ceiling',
      stuck.length === 0,
      stuck.map((s) => `after ${s.ms}ms: ${s.why}`).join(' | '));
  }

  const head = headers(table);
  const rows = bodyRows(table);

  // ---- the previous weeks ---------------------------------------------------
  // The stub (and the demo) have played weeks 1-3; `live-december` has played
  // all thirteen. W0 is the column of the first PRICED week.
  const PAST = pastCount(table);
  const W0 = 5 + PAST;
  const wantPast = scenario === 'live-december' ? 13 : 3;
  c.ok(`the weeks fully over (1-${wantPast}) are columns, straight after Avg and Gain`,
    PAST === wantPast &&
    JSON.stringify(head.slice(5, W0)) === JSON.stringify(Array.from({ length: wantPast }, (_, i) => String(i + 1))),
    JSON.stringify(head));
  {
    const ths = [...table.querySelectorAll('thead th')];
    const line = ths.map((th, i) => (/\bfut-start\b/.test(th.getAttribute('class') || '') ? i : -1))
      .filter((i) => i >= 0);
    c.ok('the heavy line is on the first week still to play, and only there',
      JSON.stringify(line) === JSON.stringify([W0]) && txt(ths[W0]).startsWith(String(wantPast + 1)),
      `${JSON.stringify(line)} ${ths[W0] && txt(ths[W0])}`);
    const full = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.children.length === head.length);
    const off = full.filter((tr) => [...tr.children]
      .map((td, i) => (/\bfut-start\b/.test(td.getAttribute('class') || '') ? i : -1))
      .filter((i) => i >= 0).join(',') !== String(W0));
    c.ok('and every row carries it on that column',
      (full.length > 0 || scenario === 'live-empty') && off.length === 0, `${off.length} of ${full.length} rows`);
  }

  // ---- the shape the owner asked for --------------------------------------
  c.ok('identity columns are Player, Pos, Tm, Avg and Gain',
    JSON.stringify(head.slice(0, 5)) === JSON.stringify(['Player', 'Pos', 'Tm', 'Avg', 'Gain']),
    JSON.stringify(head));
  // A playoff week's header carries its label: "14PO (playoffs)", "15 (playoffs)".
  c.ok('nothing but weeks after them',
    head.slice(5).every((h) => /^\d+(PO)?( \(playoffs\))?$/.test(h)) && head.length > 5, JSON.stringify(head));

  // ---- Gain -----------------------------------------------------------------
  // EVERY scenario: no Gain cell is left on its dot (the fill finished), no
  // "Your …" row carries one, and a figure is always a positive number that
  // opens its preview — a dash never sorts as a value.
  {
    const g = gainSnap(d);
    const fa = g.cells.filter((x) => !x.mine);
    c.ok('GAIN: the column is there, sortable, with a one-sentence title',
      g.col === 4 && g.sortable && /\.$/.test(g.title) && !/\. /.test(g.title), `${g.col} ${g.title}`);
    c.ok('GAIN: no cell is left waiting', g.cells.every((x) => !x.wait),
      `${g.cells.filter((x) => x.wait).length} waiting`);
    c.ok('GAIN: a "Your …" row has no gain — he is not a man you can add',
      g.cells.filter((x) => x.mine).every((x) => x.text === '' && x.v === null),
      JSON.stringify(g.cells.filter((x) => x.mine).slice(0, 2)));
    const bad = fa.filter((x) => (x.v === null
      ? x.text !== '—' || x.opens
      : !(Number(x.v) > 0) || !x.opens || !/^\+\d+\.\d$/.test(x.text) ||
        Math.abs(Number(x.text) - Number(x.v)) > 0.051));
    c.ok('GAIN: a figure is a signed per-week number that opens its preview; no gain is a dash with no sort key',
      bad.length === 0, JSON.stringify(bad.slice(0, 3)));
    // GAIN AGAINST THE COLUMN (docs/colour-plan.md, 2026-10-08): the deeper the
    // green, the bigger the gain among the gains on the wire. Every figure is a
    // plus, so none of them is ever red, and a dash is never coloured.
    const figs = fa.filter((x) => x.v !== null);
    const stepUp = (x) => Number((x.cls.match(/heat-up-(\d)/) || [0, 0])[1]);
    if (figs.length > 1) {
      c.ok('GAIN IS ON THE SCALE, against the other gains in the column',
        figs.every((x) => /\bheat\b/.test(x.cls)), JSON.stringify(figs.slice(0, 3)));
      const byV = figs.slice().sort((a, b) => Number(b.v) - Number(a.v));
      c.ok('and a bigger gain is never the paler one',
        byV.every((x, i) => i === 0 || stepUp(x) <= stepUp(byV[i - 1])),
        JSON.stringify(byV.map((x) => `${x.v}:${stepUp(x)}`).slice(0, 8)));
    }
    c.ok('GAIN: a plus is never red, and a dash is never coloured',
      fa.every((x) => !/heat-dn/.test(x.cls)) && fa.filter((x) => x.v === null).every((x) => !/\bheat\b/.test(x.cls)),
      JSON.stringify(fa.filter((x) => /heat-dn/.test(x.cls) || (x.v === null && /\bheat\b/.test(x.cls))).slice(0, 3)));
  }

  // ---- one preview a number, and a one-line title a heading -----------------
  {
    const carded = [...d.querySelectorAll('#waiverTable td[data-c], #takenTable td[data-c], .mine-tag')];
    if (rows.length > 2) {
      c.ok('PREVIEWS: the cells that open a card are marked, in both tables',
        d.querySelectorAll('#waiverTable td[data-c]').length > 0 &&
        (d.querySelectorAll('#takenTable tbody tr[data-player]').length === 0 ||
          d.querySelectorAll('#takenTable td[data-c]').length > 0),
        `${carded.length} cells`);
    }
    c.ok('PREVIEWS: an element with a card carries no `title` — one preview a number',
      carded.every((el) => !el.hasAttribute('title')),
      carded.find((el) => el.hasAttribute('title'))?.getAttribute('title'));
    const who = [...d.querySelectorAll('.who')];
    c.ok('the name in a stat line no longer repeats itself in a `title`',
      who.every((el) => !el.hasAttribute('title')), who.find((el) => el.hasAttribute('title'))?.getAttribute('title'));
    const names = ['Player', 'Pos', 'Tm', 'Owner', 'Avg', 'Gain'];
    const heads = [...d.querySelectorAll('#waiverTable thead th, #takenTable thead th')]
      .filter((th) => names.includes(txt(th)));
    const oneLine = (t) => t.length > 0 && !/[.!?] \S/.test(t);
    c.ok('HEADINGS: every identity column says what it is in one line',
      heads.length >= 5 && heads.every((th) => oneLine(th.getAttribute('title') || '')),
      heads.filter((th) => !oneLine(th.getAttribute('title') || ''))
        .map((th) => `${txt(th)}: ${th.getAttribute('title')}`).join(' | '));
  }

  if (scenario === 'previews') {
    const w = globalThis.__wvPreviews || { cards: {}, went: {}, sheet: {} };
    const k = (name) => w.cards[name] || { said: '' };
    for (const name of ['avg', 'avgMine', 'wk', 'beats', 'past', 'tag', 'gain', 'tAvg', 'tWk', 'pos', 'own']) {
      c.ok(`CARD ${name}: the figure is there, opens a card on hover, and has no title`,
        k(name).found && k(name).said.length > 0 && !k(name).titled, JSON.stringify(w.cards[name]));
    }
    // A NAME'S PREVIEW (Tim, 2026-10-10): "only show the main things like avg,
    // value, etc, not their future proj or scoring".
    for (const name of ['name', 'nameMine', 'tName']) {
      const said = k(name).said;
      c.ok(`NAME ${name}: hovering a name opens his main numbers — Avg, Proj and his position rank`,
        k(name).found && / Avg (\d+\.\d|—) Proj (\d+\.\d|—) (QB|RB|WR|TE|K|D\/ST) rank (#\d+|—)$/.test(said) &&
        k(name).cell.length > 0 && said.startsWith(k(name).cell.split(' ')[0]), JSON.stringify(w.cards[name]));
      c.ok(`NAME ${name}: and nothing the row already shows — no week, no score`,
        !/Week|Mean|scored|Actual/.test(said), said);
    }
    c.ok('NAME: under a finger a name opens no card, so the tap still opens his row',
      w.nameTouch === '', w.nameTouch);
    c.ok('AVG: the weeks it is the mean of, the mean, and his rank among the free agents at his position',
      /Avg, weeks? \d/.test(k('avg').said) && /Week \d+ ?\d+\.\d/.test(k('avg').said) &&
      /Mean of \d+ weeks? ?\d+\.\d/.test(k('avg').said) &&
      /\d+(st|nd|rd|th) of \d+ free-agent (QBs|RBs|WRs|TEs|kickers|defenses)$/.test(k('avg').said),
      k('avg').said);
    c.ok('AVG: the mean in the card is the number in the cell',
      (k('avg').said.match(/Mean of \d+ weeks? ?(\d+\.\d)/) || [])[1] === k('avg').cell.replace(/\s*[▲▼]$/, ''),
      `${k('avg').cell} | ${k('avg').said}`);
    c.ok('A WEEK STILL TO PLAY: the projection, the average free agent at his position, and his rank that week',
      new RegExp(` · Week ${k('wk').week}\\b`).test(k('wk').said) && /Projected ?\d+\.\d/.test(k('wk').said) &&
      /Average free-agent \S+ ?\d+\.\d/.test(k('wk').said) &&
      /\d+(st|nd|rd|th) of \d+ free-agent \S+ this week$/.test(k('wk').said), k('wk').said);
    c.ok('A BOXED CELL says you would start him, and names the man of yours who would sit',
      /You would start him ?Yes/.test(k('beats').said) && /\S he would sit ?\d+\.\d/.test(k('beats').said) &&
      !/your worst|Worth starting/.test(k('beats').said), k('beats').said);
    c.ok('A PLAYED WEEK: "Projected" and "Scored", side by side',
      /Projected ?(\d+\.\d|—)/.test(k('past').said) && /Scored ?(\d+\.\d|—)/.test(k('past').said), k('past').said);
    c.ok('"Your QB2": your own men at that position, ranked by Avg',
      /^Your \S+ · by Avg, weeks? \d/.test(k('tag').said) && /(QB|RB|WR|TE|K|DST)1 /.test(k('tag').said), k('tag').said);
    c.ok('TAKEN Avg and week: ranked among the ROSTERED men at his position',
      /\d+(st|nd|rd|th) of \d+ rostered \S+$/.test(k('tAvg').said) &&
      /\d+(st|nd|rd|th) of \d+ rostered \S+ this week$/.test(k('tWk').said), `${k('tAvg').said} | ${k('tWk').said}`);
    c.ok('"RB1": that manager’s men at the position, ranked by Avg, him among them',
      / · \S+ by Avg, weeks? \d/.test(k('pos').said) && new RegExp(`${k('pos').cell} `).test(k('pos').said), k('pos').said);
    c.ok('GAIN: its card is the same weeks table, and now says where the gain stands',
      /^.+ · weeks? \d/.test(k('gain').said) && /Drop \S+/.test(k('gain').said) &&
      /Per week ?\+\d+\.\d/.test(k('gain').said) && /\d+(st|nd|rd|th) of \d+ gains on the wire$/.test(k('gain').said),
      k('gain').said);
    const none = (name) => (w.went[name] || []).length === 0;
    const one = (name, rx) => (w.went[name] || []).length === 1 && rx.test(w.went[name][0]);
    c.ok('CLICK: a played week goes to that week on Schedule',
      one('past', new RegExp(`^schedule\\.html\\?week=${k('past').week}$`)), JSON.stringify(w.went.past));
    c.ok('CLICK: an owner goes to that team on Analysis',
      one('own', /^analysis\.html\?team=\w+/), JSON.stringify(w.went.own));
    c.ok('CLICK: "Your QB2" goes to your own roster',
      one('tag', /^analysis\.html\?team=\w+/), JSON.stringify(w.went.tag));
    c.ok('CLICK: a taken man’s rank goes to Trade, with his team and him — trade.html?with=<teamId>&get=<playerId>',
      one('pos', new RegExp(`^trade\\.html\\?with=\\w+&get=${k('pos').pid}$`)), `${JSON.stringify(w.went.pos)} for ${k('pos').pid}`);
    c.ok('CLICK: an Avg and a week still to play go nowhere — they only explain',
      none('avg') && none('wk') && none('tWk'), JSON.stringify([w.went.avg, w.went.wk, w.went.tWk]));
    for (const name of ['pos', 'own', 'past', 'gain', 'avg']) {
      const s = w.sheet[name] || {};
      c.ok(`FINGER ${name}: a tap opens the card as a sheet with a Close, goes nowhere, and Close shuts it`,
        s.open && s.sheet && s.close === 'Close' && s.went.length === 0 && s.shut, JSON.stringify(s));
    }
    c.ok('FINGER: where a click would go is a button on the sheet',
      /^trade\.html\?with=/.test(w.sheet.pos?.href || '') && /^Trade for him/.test(w.sheet.pos?.label || '') &&
      /^analysis\.html\?team=/.test(w.sheet.own?.href || '') &&
      /^schedule\.html\?week=\d+$/.test(w.sheet.past?.href || '') && w.sheet.avg?.href === null,
      JSON.stringify([w.sheet.pos, w.sheet.own, w.sheet.past, w.sheet.avg]));
    c.ok('GAIN, on a sheet: "Drop X" is a link to that man, and so is the button',
      /^waivers\.html\?player=\d+$/.test(w.sheet.gain?.drop || '') &&
      /[?&]player=\d+/.test(w.sheet.gain?.href || ''), JSON.stringify(w.sheet.gain));
    const j = w.jump || {};
    c.ok('GAIN, clicked with a mouse: the man it would drop is selected HERE — no reload, his Actual row open',
      j.dropId && j.selected && j.actual && j.went.length === 0 && j.cardShut && j.note.length > 0, JSON.stringify(j));
  }

  if (scenario === 'gain' || scenario === 'gain-noteam') {
    const all = globalThis.__wvGain || {};
    const w = scenario === 'gain' ? all : (all.picked || {});
    if (scenario === 'gain-noteam') {
      const none = all.none || { cells: [] };
      c.ok('NO TEAM: every Gain cell is a dash',
        none.cells.length > 20 && none.cells.every((x) => x.text === '—' && x.v === null && !x.opens),
        JSON.stringify(none.cells.slice(0, 3)));
      c.ok('NO TEAM: the title says to pick a team', /^Pick your team above/.test(none.title), none.title);
      c.ok('NO TEAM: the explanation does not describe a column that is empty',
        !/Gain is what adding him/.test(none.note), none.note.slice(0, 200));
      c.ok('PICKING A TEAM fills the column and costs no request',
        all.spentBefore > 0 && all.spentAfter === all.spentBefore, `${all.spentBefore} -> ${all.spentAfter}`);
    }
    const first = w.first || { cells: [] };
    const nums = (snap) => (snap ? snap.cells.filter((x) => !x.mine).map((x) => (x.v === null ? null : Number(x.v))) : []);
    const some = nums(first).filter((v) => v !== null).length;
    c.ok('somebody on the wire would raise the lineup, and somebody would not',
      some > 0 && some < nums(first).length, `${some} of ${nums(first).length}`);
    c.ok('the title names the weeks it is priced over',
      /^Points a week your best lineup gains over weeks? \d+/.test(first.title), first.title);
    c.ok('the explanation behind the toggle says what Gain is, and over which weeks',
      /Gain is what adding him is worth to your own lineup/.test(first.note) &&
      /over weeks? \d+/.test(first.note), first.note.slice(0, 300));
    const dsc = ordered(nums(w.desc), false);
    const asc = ordered(nums(w.asc), true);
    c.ok('SORT: Gain descending is in order, the dashes last',
      some > 0 && dsc.monotonic && dsc.nullsLast && dsc.n === some && nums(w.desc)[0] !== null,
      JSON.stringify(nums(w.desc).slice(0, 8)));
    c.ok('SORT: ascending is in order, the dashes STILL last',
      some > 0 && asc.monotonic && asc.nullsLast && asc.n === some && nums(w.asc)[0] !== null,
      JSON.stringify(nums(w.asc).slice(0, 8)));
    c.ok('SORT: the two orders differ unless every figure is the same',
      some > 0 && (new Set(nums(w.desc).filter((v) => v !== null)).size < 2 ||
        JSON.stringify(nums(w.desc)) !== JSON.stringify(nums(w.asc))), '');

    // THE PREVIEW: "Drop <player>", one row a week, and the arithmetic closes —
    // each row's + is With him − Now, the rows sum to Total, and Total over the
    // weeks is the figure in the cell.
    const pop = w.pop || { rows: [], foot: [] };
    const n = (s) => Number(String(s).replace('+', '').replace('−', '-'));
    c.ok('PREVIEW: a hover on the figure opens it', pop.open === true, JSON.stringify(pop).slice(0, 200));
    c.ok('PREVIEW: it is the site’s one stat card, not a pop-over of this page’s own',
      pop.shared === true, JSON.stringify(pop).slice(0, 200));
    c.ok('PREVIEW: it names the man the move drops', /^Drop \S+/.test(pop.drop || ''), pop.drop);
    c.ok('PREVIEW: and "Drop X" is a link to that man', /^waivers\.html\?player=\d+$/.test(pop.dropHref || ''), pop.dropHref);
    c.ok('PREVIEW: it says where this gain stands among the gains on the wire',
      /^\d+(st|nd|rd|th) of \d+ gains on the wire$/.test(pop.standing || ''), pop.standing);
    c.ok('PREVIEW: columns are Wk, Now, With him, +',
      JSON.stringify(pop.cols) === JSON.stringify(['Wk', 'Now', 'With him', '+']), JSON.stringify(pop.cols));
    c.ok('PREVIEW: one row per priced week, and each + is With him − Now',
      pop.rows.length > 0 && pop.rows.every((r) => Math.abs(n(r[2]) - n(r[1]) - n(r[3])) < 0.051),
      JSON.stringify(pop.rows));
    const total = pop.foot[0] ? n(pop.foot[0][3]) : NaN;
    const sum = pop.rows.reduce((a, r) => a + n(r[3]), 0);
    c.ok('PREVIEW: the rows sum to Total', Math.abs(sum - total) < 0.001, `${sum} vs ${total}`);
    c.ok('PREVIEW: Total over the weeks is the figure in the cell',
      pop.rows.length > 0 && `+${(total / pop.rows.length).toFixed(1)}` === w.cell &&
      pop.foot[1] && pop.foot[1][1] === w.cell,
      `${total} / ${pop.rows.length} vs ${w.cell} ${JSON.stringify(pop.foot)}`);
    c.ok('PREVIEW: a hover card has no buttons (a finger gets Close on the sheet), and Escape shuts it',
      pop.buttons === 0 && w.shut === true, `${pop.buttons} ${w.shut}`);
    c.ok('the figure is a labelled button, not a hover-only title',
      /where this gain comes from/.test(w.label || ''), w.label);
  }
  const defaultSpan = scenario !== 'live-midload';
  if (defaultSpan) {
    c.ok('one column per week still to price, three of them by default',
      head.length === W0 + 3, JSON.stringify(head));
    c.ok('the note says how many weeks of how many',
      /3 weeks of the 13 this season runs to/.test(note), note);
  }
  c.ok('the note says what the numbers are',
    /projection/i.test(note) && /snapshot/i.test(note), note);
  c.ok('the note explains a Bye against a blank',
    /Bye is the 0\.00 ESPN returns/.test(note) && /blank cell means/.test(note), note);
  c.ok('the note owns the average as ours',
    /Avg is the mean of the weeks shown and is ours, not ESPN’s/.test(note), note);

  // `trend` rosters one man per position, and a group of one has nothing to be
  // coloured against — the scale is not what that scenario is about.
  // (`gain-noteam` is the same stub league.)
  if (scenario !== 'trend' && scenario !== 'trend-past' && scenario !== 'gain-noteam' && scenario !== 'value-taken') checkHeat(c, d, scenario, note);

  // ---- (a) demo ------------------------------------------------------------
  if (scenario === 'demo') {
    c.ok('badge says Demo', txt($('modeBadge')) === 'Demo', txt($('modeBadge')));
    c.ok('badge is styled demo', /\bdemo\b/.test($('modeBadge').getAttribute('class')));
    c.ok('weeks start at the demo current week',
      JSON.stringify(head.slice(W0)) === JSON.stringify(['4', '5', '6']), JSON.stringify(head));
    // Updated when the "Your …" comparison rows landed: the table is no longer
    // free agents alone, so the forty is now a count of the AVAILABLE rows.
    c.ok('about forty demo players',
      rows.filter((r) => !/\bmine\b/.test(r.cls)).length === 40,
      `${rows.filter((r) => !/\bmine\b/.test(r.cls)).length} of ${rows.length}`);
    c.ok('the note admits the players are invented',
      /invented players with invented projections/.test(note), note);
    c.ok('every position is represented',
      ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].every((p) => rows.some((r) => r.cells[1].text === p)),
      rows.map((r) => r.cells[1].text).join(','));
    c.ok('the position buttons carry counts',
      [...d.querySelectorAll('#posFilter .seg-count')].every((s) => /^\d+$/.test(txt(s))),
      [...d.querySelectorAll('#posFilter .seg-count')].map((s) => txt(s)).join(','));

    // ---- the FLEX button, on BOTH controls ---------------------------------
    // It is a filter across RB, WR and TE, not a seventh position, so it is
    // checked for where a flex sits in a lineup — after TE and before K.
    for (const id of ['posFilter', 'takenPosFilter']) {
      const btns = [...d.querySelectorAll(`#${id} button[data-pos]`)]
        .map((b) => b.getAttribute('data-pos'));
      c.ok(`#${id} carries a FLEX button`, btns.includes('FLEX'), btns.join(','));
      c.ok(`and it sits after TE and before K on #${id}`,
        btns.indexOf('FLEX') === btns.indexOf('TE') + 1 &&
        btns.indexOf('K') === btns.indexOf('FLEX') + 1, btns.join(','));
      c.ok(`and it has a count slot of its own on #${id}`,
        Boolean(d.querySelector(`#${id} button[data-pos="FLEX"] .seg-count`)), id);
    }
    // Re-derived from the rendered Pos column. The comparison rows are excluded
    // because they are your own men and are never counted on these buttons.
    const availableRows = rows.filter((r) => !/\bmine\b/.test(r.cls));
    const flexRows = availableRows.filter((r) => ['RB', 'WR', 'TE'].includes(r.cells[1].text));
    c.ok('the FLEX count is RB + WR + TE among the available players',
      Number(txt(d.querySelector('#posFilter button[data-pos="FLEX"] .seg-count'))) === flexRows.length,
      `${txt(d.querySelector('#posFilter button[data-pos="FLEX"] .seg-count'))} vs ${flexRows.length}`);
    c.ok('and it is the sum of the three buttons beside it',
      ['RB', 'WR', 'TE'].reduce((n, p) =>
        n + Number(txt(d.querySelector(`#posFilter button[data-pos="${p}"] .seg-count`))), 0) ===
        flexRows.length,
      ['RB', 'WR', 'TE'].map((p) =>
        `${p}=${txt(d.querySelector(`#posFilter button[data-pos="${p}"] .seg-count`))}`).join(','));
    c.ok('demo shows byes', rows.some((r) => r.cells.some((td) => /\bbye\b/.test(td.cls))),
      'no bye cell');
    c.ok('demo shows a blank week too',
      rows.some((r) => r.cells.slice(W0).some((td) => td.text === '—' && td.v === null)),
      'no blank cell');
    c.ok('the cost line says demo widening is free',
      /costs nothing to widen/.test(txt($('spanCost'))), txt($('spanCost')));

    // ---- THE GLANCE LINE (Tim, 2026-10-02) --------------------------------
    // ESPN's Avg, this week's Proj and position rank. It headed the hover card
    // on a name until 2026-10-04; the card is gone and the line now sits in the
    // man's Actual row, which a click on his name opens.
    // The demo is "at week 4": Proj is the row's own week-4 cell, Avg the mean
    // of the scores in his Actual row (weeks 1–3); a sample squad man's line is
    // re-derived from the week-4 sample rosters.
    {
      const RX = /^(?:Value (?:\d+\.\d|—) · )?Avg (\d+\.\d|—) · Proj (\d+\.\d|—) · (QB|RB|WR|TE|D\/ST|K) #(\d+)$/;
      const W = d.defaultView;
      const press = (el) => el.dispatchEvent(new W.Event('click', { bubbles: true }));
      const tap = (el) => {
        const ev = new W.Event('click', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'button', { value: 0 });
        el.dispatchEvent(ev);
      };
      // Selecting a man narrows his table to his position, so each one is
      // found again with that table's filter back on All.
      const open = (tableId, filterId, pid) => {
        press(d.querySelector(`#${filterId} button[data-pos="ALL"]`));
        const link = d.querySelector(`#${tableId} tbody tr#p${pid} a.pref`);
        if (!link) return { text: '', under: false, acts: [], wk4: '', pid: Number(pid) };
        tap(link);
        const row = d.querySelector(`#${tableId} tbody tr#p${pid}`);
        const act = row && row.nextElementSibling;
        const isAct = Boolean(act && /\bact-row\b/.test(act.getAttribute('class') || ''));
        const g = isAct ? act.querySelector('.act-glance') : null;
        return {
          text: g ? txt(g) : '',
          under: Boolean(g),
          acts: isAct ? [...act.querySelectorAll('td.wk-past')].map((t) => txt(t)) : [],
          // The number alone: the cell may carry the scale's arrow beside it.
          wk4: row ? txt(row.querySelector('td.fut-start')).replace(/\s*[▲▼]$/, '') : '',
          pid: Number(pid),
        };
      };
      const ids = (tableId) => [...d.querySelectorAll(`#${tableId} tbody tr[id]`)]
        .map((tr) => tr.getAttribute('data-player'));
      c.ok('GLANCE: no name carries the old hover card', d.querySelectorAll('[data-tip]').length === 0,
        `${d.querySelectorAll('[data-tip]').length} [data-tip]`);
      const takenIds = ids('takenTable').slice(0, 12);
      const seen = ids('waiverTable').map((pid) => open('waiverTable', 'posFilter', pid));
      c.ok('GLANCE: every free agent’s Actual row shows Avg · Proj · rank',
        seen.length >= 30 && seen.every((s) => s.under && RX.test(s.text)),
        `${seen.length}; ${JSON.stringify(seen.find((s) => !s.under || !RX.test(s.text)))}`);
      const projOk = (s) => {
        const m = s.text.match(RX);
        return m && (/^\d+\.\d$/.test(s.wk4) ? m[2] === s.wk4 : m[2] === '—' || (s.wk4 === 'Bye' && m[2] === '0.0'));
      };
      c.ok('GLANCE: a free agent’s Proj is his week-4 number, as in the table',
        seen.every(projOk), JSON.stringify(seen.find((s) => !projOk(s))));
      const avgOk = (s) => {
        const nums = s.acts.filter((v) => /^\d+\.\d$/.test(v)).map(Number);
        const want = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '—';
        return s.text.match(RX)?.[1] === want;
      };
      c.ok('GLANCE: a free agent’s Avg is the mean of the scores in his Actual row',
        seen.every(avgOk) && seen.some((s) => s.acts.filter((v) => /^\d+\.\d$/.test(v)).length === 3),
        JSON.stringify(seen.find((s) => !avgOk(s))));
      const { generateDemoWeekRosters } = await import(pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href);
      const now = generateDemoWeekRosters(4).teams.flatMap((t) => t.players);
      const f = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');
      const taken = takenIds.map((pid) => open('takenTable', 'takenPosFilter', pid));
      // Value first (Tim, 2026-10-09): the number js/season.js holds for him —
      // the same module instance the page asked, so the same answer.
      const seasonReal = await import(pathToFileURL(path.join(REPO, 'js/season.js')).href);
      const held = await seasonReal.fetchPlayerValues({ demo: true });
      const lead = (pid) => {
        const v = held.lookup(pid);
        return `Value ${typeof v === 'number' ? v.toFixed(1) : '—'} · `;
      };
      const want = (pid) => {
        const p = now.find((x) => x.playerId === pid);
        return p ? `${lead(pid)}Avg ${f(p.seasonAvg)} · Proj ${f(p.projected)} · ${p.position === 'DST' ? 'D/ST' : p.position} #${p.posRank}` : null;
      };
      c.ok('GLANCE: the sample league has lines, and its rostered men have Values over zero',
        takenIds.some((pid) => held.lookup(Number(pid)) > 0), JSON.stringify(takenIds.slice(0, 4).map((pid) => held.lookup(Number(pid)))));
      // A free agent, now that the Values have landed: his own leads his line.
      const again = open('waiverTable', 'posFilter', ids('waiverTable')[0]);
      c.ok('GLANCE: a sample free agent’s Actual row leads with his Value',
        /^Value \d+\.\d · Avg /.test(again.text), again.text);
      c.ok('GLANCE: a rostered man’s Actual row leads with his Value, then his week-4 sample numbers',
        taken.length >= 5 && taken.every((s) => s.under && s.text === want(s.pid)),
        `${taken.length}; ${JSON.stringify(taken.find((s) => !s.under || s.text !== want(s.pid)))} want ${
          JSON.stringify(taken.map((s) => want(s.pid)).slice(0, 1))}`);
    }
  }

  // ---- (a+) the Your team picker ------------------------------------------
  if (scenario === 'team-pick') {
    const w = globalThis.__wvTeam || {};
    c.ok('the Your team picker is shown', w.shown === true, String(w.shown));
    c.ok('it offers every team in the league',
      (w.options || []).length === 10, JSON.stringify(w.options));
    c.ok('it opens on a team that is one of them',
      (w.options || []).includes(w.first), `${w.first} of ${JSON.stringify(w.options)}`);
    c.ok('there are "Your …" rows before the change', (w.before || []).length > 0,
      JSON.stringify(w.before));
    c.ok('choosing another team swaps the "Your …" rows',
      (w.after || []).length > 0 && JSON.stringify(w.after) !== JSON.stringify(w.before),
      `${JSON.stringify(w.before)} -> ${JSON.stringify(w.after)}`);
    c.ok('and the choice is remembered',
      String(JSON.parse(w.prefs || '{}')['waivers.team']) === String(w.picked), w.prefs);
  }

  // ---- (b) live, every week resolves ---------------------------------------
  const liveish = scenario.startsWith('live');
  if (liveish) {
    c.ok('badge says Live', txt($('modeBadge')) === 'Live', txt($('modeBadge')));
    const season = await import('./wv-stub-season.mjs');
    c.ok('the schedule is read exactly once', season.calls.schedule === 1, String(season.calls.schedule));
  }

  if (scenario === 'live' || scenario === 'live-interact') {
    const espn = await import('./wv-stub-espn.mjs');
    const asked = espn.calls.weeks.slice().sort((a, b) => a - b);
    if (scenario === 'live') {
      c.ok('one request per shown week — the three priced and the three played — and no more',
        JSON.stringify(asked) === JSON.stringify([1, 2, 3, 4, 5, 6]), JSON.stringify(espn.calls.weeks));
      c.ok('the priced weeks are asked for first',
        JSON.stringify(espn.calls.weeks.slice(0, 3).sort((a, b) => a - b)) === JSON.stringify([4, 5, 6]),
        JSON.stringify(espn.calls.weeks));
      c.ok('the whole pool is asked for once per week',
        espn.calls.limits.every((l) => l === 100), JSON.stringify(espn.calls.limits));
    }

    c.ok('every stubbed free agent is listed', rows.length === 60, `${rows.length}`);
    c.ok('weeks 4, 5 and 6 are the columns',
      JSON.stringify(head.slice(W0)) === JSON.stringify(['4', '5', '6']), JSON.stringify(head));

    // Values match what parseFreeAgent should have produced.
    const byName = new Map(rows.map((r) => [r.cells[0].text.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''), r]));
    let wrong = [];
    for (const p of espn.roster) {
      const row = byName.get(p.name);
      if (!row) { wrong.push(`${p.name} missing`); continue; }
      [4, 5, 6].forEach((w, i) => {
        const td = row.cells[W0 + i];
        const want = espn.expected(p.id, w);
        if (want === null) {
          if (td.v !== null || td.text !== '—') wrong.push(`${p.name} wk${w} want blank got ${td.text}/${td.v}`);
        } else if (want === 0) {
          if (td.text !== 'Bye' || td.v !== '0') wrong.push(`${p.name} wk${w} want Bye got ${td.text}/${td.v}`);
        } else if (Math.abs(Number(td.v) - want) > 0.051) {
          wrong.push(`${p.name} wk${w} want ${want} got ${td.v}`);
        }
      });
    }
    c.ok('every cell carries the projection ESPN gave', wrong.length === 0, wrong.slice(0, 4).join(' | '));

    // A bye and a missing number look different, and only one of them sorts.
    const byeCells = rows.flatMap((r) => r.cells.slice(W0)).filter((td) => /\bbye\b/.test(td.cls));
    const blankCells = rows.flatMap((r) => r.cells.slice(W0)).filter((td) => td.text === '—');
    c.ok('the bye renders as Bye, not 0.0',
      byeCells.length === 1 && byeCells[0].text === 'Bye' && byeCells[0].v === '0',
      JSON.stringify(byeCells));
    c.ok('a missing number renders as a dash with no sort key',
      blankCells.length === 2 && blankCells.every((td) => td.v === null),
      JSON.stringify(blankCells));

    // Averages: only weeks projecting above zero (D7, the Trade page's rule) —
    // so the bye leaves the divisor, and so does a blank.
    const bye = byName.get('Player 00 QB');
    const want = [4, 5, 6].map((w) => espn.expected(5000, w)).filter((v) => v > 0);
    const mean = want.reduce((a, b) => a + b, 0) / want.length;
    c.ok('the average leaves a bye out of the divisor (weeks projecting above zero only)',
      want.length === 2 && Math.abs(Number(bye.cells[3].v) - mean) < 0.02, `${bye.cells[3].v} vs ${mean}`);

    // AUDIT §1.7: the page's own averaging function on AUDIT's fixture
    // `16 · 0(bye) · 15 · null · 18 · unread`. The old rule printed 12.3; the
    // Trade page prints 16.3, and Tim's D7 says 16.3 is right.
    const page = await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);
    const trade = await import(pathToFileURL(path.join(REPO, 'js/trade.js')).href);
    const { DEFAULT_SLOTS } = await import(pathToFileURL(path.join(REPO, 'js/forecast.js')).href);
    const FIXTURE = [16, 0, 15, null, 18, undefined];
    const pageFig = page.meanOf(FIXTURE);
    c.ok('§1.7 AUDIT fixture 16 · 0(bye) · 15 · null · 18 · unread averages 16.3 on the Players page',
      pageFig !== null && pageFig.toFixed(1) === '16.3', String(pageFig));
    c.ok('§1.7 a ruled-out 0.0 leaves the divisor too, and a man with no scoring week has no average',
      page.meanOf([10, 0, 12]) === 11 && page.meanOf([0, null, undefined]) === null,
      `${page.meanOf([10, 0, 12])} / ${page.meanOf([0, null, undefined])}`);
    const enginePerWeek = (id, weeks, projFor) => trade.priceTradeAcrossWeeks({
      players: [{ playerId: id, position: 'QB', name: String(id) }],
      slots: DEFAULT_SLOTS, weeks, projFor,
    }).roster[0].perWeek;
    const fixWeeks = [4, 5, 6, 7, 8, 9];
    const fixEngine = enginePerWeek(1, fixWeeks, (_, w) => FIXTURE[fixWeeks.indexOf(w)] ?? null);
    c.ok('§1.7 and the Trade engine gives the same figure for the same fixture',
      fixEngine === 16.3 && pageFig.toFixed(1) === fixEngine.toFixed(1), `${pageFig} vs ${fixEngine}`);

    // Same man, same span, on the rendered page: every wire row's Avg as
    // printed equals the Trade engine's perWeek for him over weeks 4–6.
    const disagree = [];
    let compared = 0;
    for (const p of espn.roster) {
      const row = byName.get(p.name);
      if (!row) continue;
      const eng = enginePerWeek(p.id, [4, 5, 6], (pl, w) => espn.expected(pl.playerId, w));
      const shown = (row.cells[3].text.match(/^-?\d+\.\d|^—/) || [row.cells[3].text])[0];
      compared++;
      if ((eng === null ? '—' : eng.toFixed(1)) !== shown) disagree.push(`${p.name} Players ${shown} vs Trade ${eng}`);
    }
    c.ok('§1.7 PLAYERS AVG = TRADE ENGINE perWeek for every man over the same span (bye man included)',
      compared === 60 && disagree.length === 0, `${compared} compared; ${disagree.slice(0, 3).join(' | ')}`);

    const blankGuy = byName.get('Player 02 WR') || byName.get('Player 02 QB');
    c.ok('the average leaves a blank week out',
      blankGuy && Math.abs(Number(blankGuy.cells[3].v) -
        ([5, 6].reduce((a, w) => a + espn.expected(5002, w), 0) / 2)) < 0.02,
      blankGuy ? blankGuy.cells[3].v : 'row missing');

    // OUT / IR are flagged and dimmed.
    c.ok('OUT and IR are flagged on the name',
      rows.filter((r) => /\bOUT\b|\bIR\b/.test(r.cells[0].text)).length === 2,
      rows.filter((r) => /OUT|IR/.test(r.cells[0].text)).map((r) => r.cells[0].text).join(','));
    c.ok('OUT and IR rows are dimmed',
      rows.filter((r) => /unavailable/.test(r.cls)).length === 2,
      rows.filter((r) => /unavailable/.test(r.cls)).length);
    c.ok('questionable is flagged but not dimmed',
      rows.some((r) => / Q$/.test(r.cells[0].text) && !/unavailable/.test(r.cls)),
      'no Q row');

    // Opens on the average, best first. (Only meaningful before the interaction
    // scenario starts clicking headers.)
    if (scenario === 'live') {
      const avgs = rows.map((r) => (r.cells[3].v === null ? null : Number(r.cells[3].v)));
      const o = ordered(avgs, false);
      c.ok('the table opens sorted by average, best first', o.monotonic && o.n === rows.length,
        JSON.stringify(avgs.slice(0, 6)));
    }
  }

  // ---- (b+) filtering, sorting, widening ----------------------------------
  if (scenario === 'live-interact') {
    const w = globalThis.__wv || {};
    const espn = await import('./wv-stub-espn.mjs');

    c.ok('the position filter narrows the rows',
      w.wr && w.wr.rows.length === 17 && w.before.rows.length === 60,
      `${w.wr && w.wr.rows.length} of ${w.before && w.before.rows.length}`);
    c.ok('every remaining row is that position',
      w.wr && w.wr.rows.every((r) => r[1] === '3'), JSON.stringify(w.wr && w.wr.rows[0]));
    c.ok('the button says how many there are', w.wrCount === '17', w.wrCount);
    c.ok('filtering fetches nothing',
      JSON.stringify(w.fetchesBefore) === JSON.stringify(w.fetchesAfterFilter),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterFilter)}`);
    c.ok('clearing the filter brings every row back',
      w.backToAll && w.backToAll.rows.length === 60, `${w.backToAll && w.backToAll.rows.length}`);

    // ---- FLEX, re-derived from the unfiltered rows the page itself drew -----
    // The Pos cell's sort key is the football order, so RB/WR/TE are 2, 3 and 4.
    const FLEXKEYS = ['2', '3', '4'];
    const wantFlex = (w.backToAll ? w.backToAll.rows : []).filter((r) => FLEXKEYS.includes(r[1]));
    c.ok('FLEX shows exactly the running backs, receivers and tight ends',
      w.flex && w.flex.rows.length === wantFlex.length &&
      w.flex.rows.every((r) => FLEXKEYS.includes(r[1])),
      `${w.flex && w.flex.rows.length} shown, ${wantFlex.length} eligible: ` +
      JSON.stringify([...new Set((w.flex ? w.flex.rows : []).map((r) => r[1]))]));
    c.ok('and all three of them, not one position dressed up as three',
      w.flex && new Set(w.flex.rows.map((r) => r[1])).size === 3,
      JSON.stringify([...new Set((w.flex ? w.flex.rows : []).map((r) => r[1]))]));
    c.ok('it is narrower than All and wider than WR, so the check is not vacuous',
      w.flex && w.flex.rows.length < 60 && w.flex.rows.length > (w.wr ? w.wr.rows.length : 0),
      `${w.flex && w.flex.rows.length} vs 60 and ${w.wr && w.wr.rows.length}`);
    c.ok('THE COUNT ON THE FLEX BUTTON IS RB + WR + TE IN THIS TABLE’S POOL',
      Number(w.flexCount) === wantFlex.length, `${w.flexCount} vs ${wantFlex.length}`);
    c.ok('the strip names the three positions rather than quoting the button',
      /^Available RB\/WR\/TE$/.test((w.flexLabel || '').trim()), w.flexLabel);
    c.ok('there is no empty state, because FLEX matched people',
      w.flexEmpty === 0, String(w.flexEmpty));
    c.ok('SELECTING FLEX FETCHES NOTHING — it is a repaint',
      JSON.stringify(w.fetchesAfterFlex) === JSON.stringify(w.fetchesBefore),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterFlex)}`);
    c.ok('and the choice is remembered like any other',
      /"waivers.position":"FLEX"/.test(w.flexPrefs || ''), w.flexPrefs);

    const col = (snap, i) => snap.rows.map((r) => (r[i] === null || r[i] === '—' ? null : Number(r[i])));
    c.ok('the headers clicked were weeks 4 and 5',
      JSON.stringify(w.sortedHeads) === JSON.stringify(['4', '5']), JSON.stringify(w.sortedHeads));
    const d5 = ordered(col(w.wk5desc, W0 + 1), false);
    const a5 = ordered(col(w.wk5asc, W0 + 1), true);
    c.ok('sorting a week column orders it descending', d5.monotonic && d5.n === 60,
      JSON.stringify(col(w.wk5desc, W0 + 1).slice(0, 6)));
    c.ok('clicking again reverses it', a5.monotonic && a5.n === 60,
      JSON.stringify(col(w.wk5asc, W0 + 1).slice(0, 6)));
    c.ok('the bye sorts as the zero it is',
      col(w.wk5asc, W0 + 1)[0] === 0, JSON.stringify(col(w.wk5asc, W0 + 1).slice(0, 3)));

    const d4 = ordered(col(w.wk4desc, W0), false);
    const a4 = ordered(col(w.wk4asc, W0), true);
    c.ok('a week with a missing value still sorts', d4.monotonic && a4.monotonic,
      JSON.stringify(col(w.wk4desc, W0).slice(0, 4)));
    c.ok('the missing value sinks in BOTH directions', d4.nullsLast && a4.nullsLast && d4.n === 59,
      `desc nullsLast=${d4.nullsLast} asc nullsLast=${a4.nullsLast} n=${d4.n}`);
    c.ok('sorting fetches nothing',
      JSON.stringify(w.fetchesAfterSort) === JSON.stringify(w.fetchesAfterFilter),
      JSON.stringify(w.fetchesAfterSort));

    c.ok('widening the span adds three week columns',
      w.wide && w.wide.cols.length === W0 + 6 &&
      JSON.stringify(w.wide.cols.slice(W0)) === JSON.stringify(['4', '5', '6', '7', '8', '9']),
      JSON.stringify(w.wide && w.wide.cols));
    c.ok('widening fetches only the weeks it does not have',
      JSON.stringify(w.fetchesAfterWiden.slice().sort((a, b) => a - b)) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify(w.fetchesAfterWiden));
    c.ok('and the three played weeks were already held before it widened',
      JSON.stringify((w.fetchesBefore || []).slice().sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5, 6]),
      JSON.stringify(w.fetchesBefore));
    c.ok('narrowing again fetches nothing',
      JSON.stringify(w.fetchesAfterNarrow) === JSON.stringify(w.fetchesAfterWiden),
      JSON.stringify(w.fetchesAfterNarrow));
    c.ok('narrowing goes back to three week columns',
      w.narrow && w.narrow.cols.length === W0 + 3, JSON.stringify(w.narrow && w.narrow.cols));
    c.ok('the choices are remembered',
      /"waivers.position":"ALL"/.test(w.prefs || '') && /"waivers.span":"3"/.test(w.prefs || ''), w.prefs);
    c.ok('the whole interaction cost nine wire requests: six priced weeks and the three played',
      espn.calls.weeks.length === 9, JSON.stringify(espn.calls.weeks));
  }

  // ---- (b*) the remembered filters ----------------------------------------
  if (scenario === 'flex-saved') {
    const w = globalThis.__wv || {};
    c.ok('a saved FLEX comes back as FLEX, with that button lit and no other',
      JSON.stringify(w.on) === JSON.stringify(['FLEX']), JSON.stringify(w.on));
    c.ok('and the table opens on the three positions it means',
      (w.pos || []).length > 0 && (w.pos || []).every((p) => ['RB', 'WR', 'TE'].includes(p)),
      JSON.stringify([...new Set(w.pos || [])]));
    c.ok('which is fewer rows than All, so it really was applied',
      (w.pos || []).length < 60, `${(w.pos || []).length}`);
    c.ok('A SAVED VALUE THAT IS NO LONGER A FILTER FALLS BACK TO ALL',
      JSON.stringify(w.takenOn) === JSON.stringify(['ALL']), JSON.stringify(w.takenOn));
    c.ok('and nothing is wedged on an empty table',
      w.empty === 0, String(w.empty));
  }

  // ---- (b++) widening mid-load --------------------------------------------
  if (scenario === 'live-midload') {
    const w = globalThis.__wv || {};
    c.ok('the first weeks were already in the air when the span changed',
      w.inFlight && w.inFlight.length > 0 && w.inFlight.length < 10, JSON.stringify(w.inFlight));
    c.ok('no week is ever fetched twice',
      w.fetches && new Set(w.fetches).size === w.fetches.length, JSON.stringify(w.fetches));
    // REST OF SEASON RUNS THROUGH THE PLAYOFFS (Tim, 2026-09-17). The stub is a
    // 13-week, ten-team league, so capture.playoffWeeks puts its six-team
    // bracket in weeks 14–16 — and those are bought like any other week.
    c.ok('every remaining week is fetched exactly once — the playoff weeks included',
      JSON.stringify(w.fetches.slice().sort((a, b) => a - b)) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), JSON.stringify(w.fetches));
    c.ok('the table ends up with a column for every week, the playoffs labelled',
      JSON.stringify(w.cols.slice(W0)) ===
        JSON.stringify(['4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
          '14PO (playoffs)', '15 (playoffs)', '16 (playoffs)']),
      JSON.stringify(w.cols));

    // THE LINE: `po-start` on the first playoff week's header and on every body
    // cell under it — and nowhere else.
    const isPo = (cls) => String(cls || '').split(/ +/).includes('po-start');
    const ths = [...table.querySelectorAll('thead th')];
    const poHeads = ths.map((th, i) => (isPo(th.getAttribute('class') || '') ? i : -1))
      .filter((i) => i >= 0);
    c.ok('the playoff line is on the week-14 header, and only there',
      poHeads.length === 1 && txt(ths[poHeads[0]]).startsWith('14'), JSON.stringify(poHeads));
    const col = poHeads[0];
    const wire = rows.filter((r) => r.cells.length === head.length);
    c.ok('every row carries the line on that column',
      wire.length > 0 && wire.every((r) => isPo(r.cells[col].cls)),
      JSON.stringify(wire.filter((r) => !isPo(r.cells[col].cls)).slice(0, 2)));
    c.ok('and on no other column',
      wire.every((r) => r.cells.filter((x) => isPo(x.cls)).length === 1));
    c.ok('the playoff header says so in words, not by the line alone',
      /playoffs/.test(txt(ths[col])) && /PO/.test(txt(ths[col])), txt(ths[col]));

    // AVG IS THE REGULAR SEASON. Re-derived from the rendered week cells 4–13
    // (only weeks projecting above zero count — a bye's data-v="0" and a blank
    // are both out, D7), never from the page's own arithmetic — and a row where
    // the playoff weeks WOULD move it proves the check can fail.
    // Rounded to the tenth the way the page and the Trade engine both round it.
    const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const nums = (cells) => cells.map((x) => x.v).filter((v) => v !== null && v !== '').map(Number).filter((v) => v > 0);
    let wrong = 0;
    let moved = 0;
    let movedByPast = 0;
    for (const r of wire) {
      const shown = r.cells[3].v === null ? null : Number(r.cells[3].v);
      const regular = mean(nums(r.cells.slice(W0, col)));
      const everything = mean(nums(r.cells.slice(W0)));
      // …and the previous weeks, were they counted, would move it too.
      const withPast = mean(nums(r.cells.slice(4, col)));
      if (regular !== null && withPast !== null && Math.abs(regular - withPast) > 0.05) movedByPast++;
      if (regular === null ? shown !== null : Math.abs(shown - regular) > 1e-9) wrong++;
      if (regular !== null && everything !== null && Math.abs(regular - everything) > 0.05) moved++;
    }
    c.ok('AVG IGNORES THE PLAYOFF WEEKS — every row is the mean of weeks 4–13 only',
      wrong === 0, `${wrong} rows disagree`);
    c.ok('and the playoff weeks would have moved it, so that check has teeth',
      moved > 0, `${moved}`);
    c.ok('AVG IGNORES THE PREVIOUS WEEKS TOO — and counting them would have moved it',
      wrong === 0 && movedByPast > 0, `${movedByPast} rows would move`);
    c.ok('the cost line counts the playoff weeks it is paying for',
      /13 weeks \(3 of them playoff\) = 26 requests/.test(txt($('spanCost'))), txt($('spanCost')));
    c.ok('the key names the line while it is drawn',
      !$('waiverLegend').querySelector('.po-key').closest('[data-when]').hasAttribute('hidden'));
    c.ok('the explanation says the playoff weeks are not in Avg',
      /left out of Avg/.test(note), note);
    c.ok('every column filled in', w.wait === 0, `${w.wait} cells still pending`);
    c.ok('every player is still listed once', w.rows === 60, `${w.rows}`);
  }

  // ---- (b+++) switching source mid-load -----------------------------------
  if (scenario === 'source-switch') {
    const w = globalThis.__wv || {};
    c.ok('the page ends up on demo data', w.badge === 'Demo', w.badge);
    // Updated when the "Your …" comparison rows landed: forty is the count of
    // AVAILABLE rows now, with the demo stand-in squad's rows on top of it.
    c.ok('the demo pool replaced the live one',
      w.available && w.available.length === 40, `${w.available && w.available.length}`);
    c.ok('not one row of the abandoned league survived',
      w.rows && !w.rows.some((n) => /^Player \d\d /.test(n)),
      (w.rows || []).filter((n) => /^Player \d\d /.test(n)).join(','));
    c.ok('the note is the demo one', /invented players/.test(w.note || ''), w.note);
  }

  // ---- (c) some weeks reject ----------------------------------------------
  if (scenario === 'live-partial') {
    c.ok('the table still renders the week that did load', rows.length === 60, `${rows.length}`);
    c.ok('the failed weeks are blank', rows.every((r) => r.cells[W0 + 1].text === '—' && r.cells[W0 + 2].text === '—'),
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.text)));
    c.ok('week 4 still carries numbers',
      rows.filter((r) => /^\d+\.\d( [▲▼])?$/.test(r.cells[W0].text)).length === 59,
      rows.slice(0, 2).map((r) => r.cells[W0].text).join(','));
    c.ok('the note names the weeks that failed',
      /ESPN did not return weeks 5 and 6/.test(note), note);
    c.ok('a refused week does not masquerade as one still loading',
      rows.every((r) => !/\bwait\b/.test(r.cells[W0 + 1].cls) && !/\bwait\b/.test(r.cells[W0 + 2].cls)),
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.cls)));
    c.ok('a refused week has no sort key',
      rows.every((r) => r.cells[W0 + 1].v === null && r.cells[W0 + 2].v === null), 'sort key present');
    c.ok('the note says what to do about it', /Reload the page to try again/.test(note), note);
    c.ok('the refusal is shown, not tucked behind the toggle',
      /ESPN did not return weeks 5 and 6/.test(txt($('waiverStatus'))) &&
      !$('waiverStatus').closest('details'), txt($('waiverStatus')));
    c.ok('the average is taken from the weeks that did load',
      /average is taken from the weeks that did load/.test(note), note);
  }

  // ---- (e) December --------------------------------------------------------
  if (scenario === 'live-december') {
    c.ok('DECEMBER: the columns are the playoff weeks, the first one labelled',
      JSON.stringify(head.slice(W0)) === JSON.stringify(['14PO (playoffs)', '15 (playoffs)', '16 (playoffs)']),
      JSON.stringify(head));
    c.ok('DECEMBER: and they are filled in, not left waiting',
      rows.length > 0 && rows.every((r) => r.cells.slice(4).every((x) => !x.cls.split(' ').includes('wait'))),
      JSON.stringify(rows[0]));
    // With no regular week left to show, Avg averages what there is.
    // Rounded to the tenth the way the page and the Trade engine both round it.
    const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const wrong = rows.filter((r) => {
      const xs = r.cells.slice(W0).map((x) => x.v).filter((v) => v !== null && v !== '').map(Number)
        .filter((v) => v > 0);
      const want = mean(xs);
      const got = r.cells[3].v === null ? null : Number(r.cells[3].v);
      return want === null ? got !== null : Math.abs(got - want) > 1e-9;
    });
    c.ok('DECEMBER: with only playoff weeks left, Avg is their mean rather than blank',
      wrong.length === 0 && rows.some((r) => r.cells[3].v !== null), `${wrong.length} rows disagree`);
  }

  // ---- (d) empty pool ------------------------------------------------------
  if (scenario === 'live-empty') {
    const empty = table.querySelector('tr.empty-row');
    c.ok('an empty pool says so rather than showing nothing', Boolean(empty), 'no empty row');
    c.ok('the empty state gives the reason',
      empty && /nobody is unrostered in this league right now/.test(txt(empty)), txt(empty));
    c.ok('the empty state spans every column',
      empty && empty.querySelector('td').getAttribute('colspan') === String(W0 + 3),
      empty && empty.querySelector('td').getAttribute('colspan'));
    c.ok('no headline numbers are invented', txt($('waiverStats')) === '', txt($('waiverStats')));
    c.ok('the position counts stay blank',
      [...d.querySelectorAll('#posFilter .seg-count')].every((s) => txt(s) === ''), 'counts shown');
  }

  // ---- (f) a filter repaints, and moves no colour --------------------------
  if (scenario === 'heat-filter') {
    const w = globalThis.__wvHeat || {};
    const same = (a, b, which) => {
      const wrong = [];
      for (const [k, v] of Object.entries(b[which])) {
        const was = a[which][k];
        if (was !== undefined && was.join('|') !== v.join('|')) {
          wrong.push(`${k}: ${was.join('|')} -> ${v.join('|')}`);
        }
      }
      return wrong;
    };

    c.ok('the baseline really is coloured, or none of this proves anything',
      Object.values(w.all.wire).some((cells) => cells.some((k) => /heat-(up|dn)/.test(k))) &&
      Object.values(w.all.taken).some((cells) => cells.some((k) => /heat-(up|dn)/.test(k))),
      JSON.stringify(Object.entries(w.all.wire).slice(0, 3)));
    c.ok('and the filters really did change the row sets, or it proves nothing either',
      Object.keys(w.wireRb.wire).length < Object.keys(w.all.wire).length &&
      Object.keys(w.takenWr.taken).length < Object.keys(w.all.taken).length,
      `${Object.keys(w.all.wire).length} -> ${Object.keys(w.wireRb.wire).length} wire, ` +
      `${Object.keys(w.all.taken).length} -> ${Object.keys(w.takenWr.taken).length} taken`);

    for (const [label, state] of [['RB', w.wireRb], ['FLEX', w.wireFlex], ['back to ALL', w.back]]) {
      c.ok(`PRESSING ${label} ON THE WIRE MOVES NOT ONE CELL’S COLOUR`,
        same(w.all, state, 'wire').length === 0, same(w.all, state, 'wire').slice(0, 3).join(' | '));
    }
    for (const [label, state] of [['WR', w.takenWr], ['FLEX', w.takenFlex], ['back to ALL', w.back]]) {
      c.ok(`PRESSING ${label} ON THE TAKEN TABLE MOVES NOT ONE CELL’S COLOUR`,
        same(w.all, state, 'taken').length === 0, same(w.all, state, 'taken').slice(0, 3).join(' | '));
    }
    // And the thresholds inside each table's toggle are the same numbers too —
    // they are the scale written out, so a moving strip would mean a moving
    // scale even if the visible rows happened not to show it. Both layers are
    // compared: the strip because it carries the numbers, the visible key
    // because a key that changed under a filter would be claiming the scale had.
    c.ok('THE PRINTED THRESHOLDS DO NOT MOVE EITHER, on either table',
      w.all.wireBands.length > 0 && w.all.takenBands.length > 0 &&
      w.wireFlex.wireBands === w.all.wireBands && w.takenFlex.takenBands === w.all.takenBands &&
      w.back.wireBands === w.all.wireBands && w.back.takenBands === w.all.takenBands,
      `${w.all.wireBands.slice(0, 120)}\n${w.wireFlex.wireBands.slice(0, 120)}`);
    c.ok('and neither visible key moves under a filter',
      w.wireFlex.wireKey === w.all.wireKey && w.takenFlex.takenKey === w.all.takenKey &&
      w.back.wireKey === w.all.wireKey && w.back.takenKey === w.all.takenKey,
      `${w.all.wireKey.slice(0, 120)}\n${w.wireFlex.wireKey.slice(0, 120)}`);
    // The two tables' filters are independent, so one must not repaint the
    // other's colours as a side effect either.
    c.ok('and one table’s filter never touches the other table’s colours',
      same(w.all, w.wireFlex, 'taken').length === 0 && same(w.all, w.takenFlex, 'wire').length === 0,
      `${same(w.all, w.wireFlex, 'taken').slice(0, 2).join(' | ')} / ` +
      `${same(w.all, w.takenFlex, 'wire').slice(0, 2).join(' | ')}`);
  }

  // ---- (g) the preseason arrows --------------------------------------------
  //
  // VISIBLE TEXT AND SCREEN-READER TEXT ARE READ SEPARATELY (Traps): the glyph
  // is what an eye sees, the words are what a screen reader says, and a
  // textContent read would blur the two into one string that "contains" both.
  const trendOf = (tr) => {
    const el = tr && tr.querySelector('.trend');
    if (!el) return null;
    const sr = el.querySelector('.sr-only');
    const clone = el.cloneNode(true);
    for (const s of clone.querySelectorAll('.sr-only')) s.remove();
    return {
      dir: /\btrend-up\b/.test(el.getAttribute('class')) ? 'up'
        : /\btrend-down\b/.test(el.getAttribute('class')) ? 'down' : '?',
      visible: txt(clone),
      sr: txt(sr),
      title: el.getAttribute('title') || '',
      // Right after the name: the name link (`a.pref`) or the Trade page's `.nm`.
      afterName: !!(el.previousElementSibling && (el.previousElementSibling.tagName === 'A' ||
        /\bnm\b/.test(el.previousElementSibling.getAttribute('class') || ''))),
    };
  };
  const trendCount = (id) => d.querySelectorAll(`#${id} tbody .trend`).length;
  if (scenario === 'trend') {
    const espn = await import('./wv-stub-espn.mjs');
    const season = await import('./wv-stub-season.mjs');
    const rowOf = (tableId, pid, mine) => [...d.querySelectorAll(`#${tableId} tbody tr[data-player="${pid}"]`)]
      .find((tr) => mine === undefined || /\bmine\b/.test(tr.getAttribute('class') || '') === mine);
    const cases = [
      ...Object.values(espn.TREND_MEN).map((m) => ({ ...m, table: 'waiverTable', mine: false })),
      // The Taken table lists every rostered man, yours included.
      ...season.TREND_SQUADS.flatMap((t) => t.players)
        .map((p) => ({ id: p.playerId, name: p.name, want: p.want, table: 'takenTable' })),
      ...season.TREND_SQUADS.find((t) => t.id === 4).players
        .map((p) => ({ id: p.playerId, name: p.name, want: p.want, table: 'waiverTable', mine: true })),
    ];
    // "Now" is the site's average of ESPN's weekly projections over the REST OF
    // THE SEASON (regular weeks 4–13), and the words say so — not that ESPN
    // published a rest-of-season number.
    const SAYS = (dir, d, from, to) => new RegExp(`^${dir} ${d} a week since preseason: ${from} ` +
      `\\(ESPN’s 9 Sep projection per game\\) → ${to} \\(the site’s average of ESPN’s weekly ` +
      'projections over weeks 4–13\\)$');
    const WORDS = {
      'Jahmyr Gibbs': SAYS('Up', '4\\.8', '19\\.7', '24\\.5'),
      'Puka Nacua': SAYS('Down', '5\\.2', '17\\.2', '12\\.0'),
      'Texans D/ST': SAYS('Up', '2\\.4', '7\\.6', '10\\.0'),
      'Tyler Warren': SAYS('Down', '2\\.1', '9\\.9', '7\\.8'),
      'Wil Lutz': SAYS('Up', '3\\.0', '8\\.0', '11\\.0'),
    };
    for (const m of cases) {
      const tr = rowOf(m.table, m.id, m.mine);
      c.ok(`${m.name} is on the ${m.table === 'takenTable' ? 'Taken' : 'wire'} table${m.mine ? ' as your own row' : ''}`,
        !!tr, `no tr[data-player="${m.id}"]`);
      if (!tr) continue;
      const t = trendOf(tr);
      if (m.want === null) {
        c.ok(`${m.name}: NO arrow (${m.name === 'Josh Allen' ? 'exactly +2.0 — "more than 2" is strict' : 'no preseason line'})`,
          t === null, JSON.stringify(t));
        continue;
      }
      c.ok(`${m.name}: a ${m.want === 'up' ? 'green ▲' : 'red ▼'} by his name`,
        t && t.dir === m.want, JSON.stringify(t));
      if (!t) continue;
      c.ok(`${m.name}: what the eye sees is the glyph alone`,
        t.visible === (m.want === 'up' ? '▲' : '▼'), JSON.stringify(t.visible));
      c.ok(`${m.name}: a screen reader hears how far and from what (sr-only, inside the arrow)`,
        WORDS[m.name].test(t.sr.replace(/^\(|\)$/g, '')), t.sr);
      c.ok(`${m.name}: the tooltip carries the same words`, WORDS[m.name].test(t.title), t.title);
      c.ok(`${m.name}: the arrow sits right after the name`, t.afterName,
        tr.children[0].innerHTML.slice(0, 300));
    }
    // ---- rest of season, whatever the span ----
    const tw = globalThis.__wvTrend || {};
    const arrowed = (list) => (list || []).filter((s) => !s.endsWith(':-'));
    c.ok('GIBBS HAS HIS ▲ UNDER “NEXT 3”, where the three weeks shown alone (21.0, +1.3) would give ' +
      'none — the arrow is his rest of season (24.5, +4.8)',
      (tw.next3 || []).some((s) => s.startsWith('waiverTable:4429795:') && /trend-up/.test(s)),
      JSON.stringify(arrowed(tw.next3)));
    c.ok('SWITCHING THE SPAN CHANGES NO ARROW: Next 3, Next 6, Rest of season and back are identical, ' +
      'class and words, row by row',
      tw.next3 && tw.next3.length > 20 && arrowed(tw.next3).length === 6 &&
      JSON.stringify(tw.next3) === JSON.stringify(tw.next6) &&
      JSON.stringify(tw.next3) === JSON.stringify(tw.all) &&
      JSON.stringify(tw.next3) === JSON.stringify(tw.back),
      JSON.stringify({ n3: arrowed(tw.next3), n6: arrowed(tw.next6), all: arrowed(tw.all) }).slice(0, 400));
    const sorted = (a) => [...(a || [])].sort((x, y) => x - y);
    // Weeks 1-3 are the previous-week columns (2026-10-04): bought once too.
    const REST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    c.ok('THE COST under Next 3: every regular week, each bought once — wire and rosters, ' +
      'weeks 4–13 (the three columns, then seven more for the arrows) and the three played',
      JSON.stringify(sorted(tw.wire3)) === JSON.stringify(REST) &&
      JSON.stringify(sorted(tw.rosters3)) === JSON.stringify(REST),
      `wire ${JSON.stringify(tw.wire3)} rosters ${JSON.stringify(tw.rosters3)}`);
    c.ok('the columns came first: weeks 4–6 were asked for before any week the arrows wanted',
      JSON.stringify(sorted((tw.wire3 || []).slice(0, 3))) === JSON.stringify([4, 5, 6]),
      JSON.stringify(tw.wire3));
    c.ok('and widening to Rest of season then buys only the playoff columns — never a week twice',
      JSON.stringify(sorted(tw.wireAll)) === JSON.stringify([...REST, 14, 15, 16]) &&
      new Set(tw.rostersAll || []).size === (tw.rostersAll || []).length,
      `wire ${JSON.stringify(tw.wireAll)} rosters ${JSON.stringify(tw.rostersAll)}`);
    c.ok('ONLY those men carry an arrow: every stub man is unknown to the preseason copy',
      trendCount('waiverTable') === 3 && trendCount('takenTable') === 3,
      `${trendCount('waiverTable')} on the wire, ${trendCount('takenTable')} taken`);
    const wk = $('waiverTrendKey');
    const tk = $('takenTrendKey');
    c.ok('the wire’s one-line key is shown, and outside the toggle',
      wk && !wk.hasAttribute('hidden') && /Green ▲ \/ red ▼ by a name/.test(txt(wk)) && !wk.closest('details'),
      wk ? `${wk.hasAttribute('hidden')} ${txt(wk)}` : 'no #waiverTrendKey');
    c.ok('and so is the Taken table’s', tk && !tk.hasAttribute('hidden') && /preseason/.test(txt(tk)),
      tk ? `${tk.hasAttribute('hidden')} ${txt(tk)}` : 'no #takenTrendKey');
    c.ok('“How to read this table” states the basis: ESPN’s 9 Sep preseason, re-scored, over the rest ' +
      'of the season whatever the span, and what those weeks cost',
      /9 Sep projection per game, re-scored with your league’s rules/.test(note) &&
      /average of ESPN’s weekly projections, over weeks 4–13/.test(note) &&
      /whatever span is shown/.test(note),
      note.slice(-900));
    c.ok('and the Taken table’s explanation says it too',
      /re-scored with your league’s rules/.test(txt($('takenNote'))), txt($('takenNote')).slice(-600));
  } else if (scenario !== 'live-empty' && scenario !== 'gain-noteam' && scenario !== 'value-taken') {
    // Every other scenario is stub ids or the invented demo: nobody is in the
    // preseason copy, so there must be no arrow and no key for one.
    c.ok('no preseason arrow for a man the copy has never heard of',
      trendCount('waiverTable') === 0 && trendCount('takenTable') === 0,
      `${trendCount('waiverTable')} / ${trendCount('takenTable')}`);
    c.ok('and no key for an arrow that is not there',
      ['waiverTrendKey', 'takenTrendKey'].every((id) => !$(id) || $(id).hasAttribute('hidden')),
      ['waiverTrendKey', 'takenTrendKey'].map((id) => $(id) && txt($(id))).join(' | '));
  }

  // ---- PROJ | VALUE (Tim, 2026-10-09) --------------------------------------
  if (scenario === 'value' || scenario === 'value-cloud') {
    const w = globalThis.__wvValue || {};
    const espn = await import('./wv-stub-espn.mjs');
    const { valueOf, restAvg } = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);
    const f1 = (n) => n.toFixed(1);
    const projRows = new Map(((w.proj || {}).rows || []).map((r) => [r.id, r]));
    const rows = ((w.value || {}).rows || []).filter((r) => !r.mine);
    c.ok('VALUE: with lines for the league the switch is shown on both tables, on Proj',
      w.ctl && w.ctl.wire && w.ctl.taken && w.ctl.on.join() === 'proj,proj', JSON.stringify(w.ctl));
    const man = projRows.get(VALUE_MAN);
    c.ok('VALUE: on Proj a cell is still ESPN’s projection',
      man && man.weeks[4].text === f1(espn.expected(VALUE_MAN, 4)),
      `${man && man.weeks[4].text} want ${f1(espn.expected(VALUE_MAN, 4))}`);
    c.ok('VALUE: loading the page bought nothing for it: the three weeks shown and the three played',
      JSON.stringify((w.loadCalls || []).slice().sort((a, b) => a - b)) === '[1,2,3,4,5,6]', JSON.stringify(w.loadCalls));
    c.ok('VALUE: the switch is a repaint, no request', w.switchCalls === (w.loadCalls || []).length,
      `${(w.loadCalls || []).length} -> ${w.switchCalls}`);
    c.ok('VALUE: pressing it lights Value in both toolbars', w.ctlValue && w.ctlValue.on.join() === 'value,value',
      JSON.stringify(w.ctlValue));
    c.ok('VALUE: and the choice is remembered', JSON.parse(w.prefs || '{}')['waivers.show'] === 'value', w.prefs);

    let converted = 0;
    let zeros = 0;
    let kept = 0;
    const wrong = [];
    for (const r of rows) {
      for (const wk of [4, 5, 6]) {
        const x = espn.expected(r.id, wk);
        const cell = r.weeks[wk];
        if (typeof x === 'number' && x > 0) {
          const want = valueOf(VALUE_BASE, r.pos, x);
          converted++;
          if (want === 0) zeros++;
          if (!cell || cell.text !== f1(want) || Number(cell.v) !== want) wrong.push([r.id, wk, x, want, cell && cell.text, cell && cell.v]);
        } else {
          kept++;
          const was = projRows.get(r.id) && projRows.get(r.id).weeks[wk];
          if (!cell || !was || cell.text !== was.text) wrong.push([r.id, wk, x, 'kept', cell && cell.text, was && was.text]);
        }
      }
    }
    c.ok('VALUE: every projected week cell is exactly valueOf(lines, his position, that projection)',
      rows.length === 60 && converted >= 170 && wrong.length === 0,
      `${rows.length} rows, ${converted} cells; ${JSON.stringify(wrong.slice(0, 3))}`);
    c.ok('VALUE: a Bye, a blank and a missing week stay what they were', kept >= 3 && wrong.length === 0, `${kept}`);
    const low = rows.find((r) => r.pos === 'QB' && espn.expected(r.id, 4) > 0 && espn.expected(r.id, 4) < VALUE_BASE.lines.QB.waiver);
    c.ok('VALUE: a free agent projected under the waiver line shows 0.0, never a negative',
      zeros >= 20 && low && low.weeks[4].text === '0.0' &&
      rows.every((r) => [4, 5, 6].every((wk) => !/^[-−]/.test(r.weeks[wk].text))),
      `${zeros} zeros; ${low && JSON.stringify(low.weeks[4])}`);
    const avgWant = (r) => {
      const vs = [4, 5, 6].map((wk) => espn.expected(r.id, wk)).filter((x) => typeof x === 'number' && x > 0)
        .map((x) => valueOf(VALUE_BASE, r.pos, x));
      return vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10 : null;
    };
    const avgBad = rows.filter((r) => {
      const want = avgWant(r);
      return want === null ? r.avg.text !== '—' : r.avg.text !== f1(want) || Number(r.avg.v) !== want;
    });
    c.ok('VALUE: Avg is the mean of the Values shown', rows.length === 60 && avgBad.length === 0,
      JSON.stringify(avgBad.slice(0, 2).map((r) => [r.id, r.avg, avgWant(r)])));
    const order = ordered(rows.map((r) => (r.avg.v === null ? null : Number(r.avg.v))), false);
    const projOrder = [...projRows.keys()].join();
    c.ok('VALUE: the table is sorted by the Avg shown, so its order is not the Proj order',
      order.monotonic && order.nullsLast && rows.map((r) => r.id).join() !== projOrder,
      JSON.stringify(rows.slice(0, 6).map((r) => r.avg.v)));
    c.ok('VALUE: both tucked notes say what Value is',
      /Points a week over the waiver line at his position/.test(w.note || '') &&
      /Points a week over the waiver line at his position/.test(w.takenNote || ''),
      (w.note || '').slice(-300));

    // A free agent's own Value: his average over the weeks left, as a Value.
    const byWeek = {};
    for (const wk of VALUE_WEEKS) byWeek[wk] = espn.expected(VALUE_MAN, wk);
    const own = valueOf(VALUE_BASE, 'QB', restAvg(byWeek, VALUE_WEEKS, null));
    c.ok('GLANCE: a free agent’s open row leads with his Value over the weeks left',
      own > 0 && new RegExp(`^Value ${f1(own).replace('.', '\\.')} · Avg `).test(w.glance || ''),
      `${w.glance} want Value ${f1(own)}`);
    const opened = (w.openCalls || []).slice().sort((a, b) => a - b);
    // Selecting a man shows every week left (4–13 and the playoff weeks 14–16).
    c.ok('GLANCE: and that cost no request of its own — each week on screen asked for once',
      JSON.stringify(opened) === '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]', JSON.stringify(w.openCalls));
    const re = (w.reCalls || []).slice().sort((a, b) => a - b);
    c.ok('the league read again shows Next 3', JSON.stringify(w.reShown) === '["1","2","3","4","5","6"]',
      JSON.stringify(w.reShown));
    if (scenario === 'value') {
      c.ok('ON THE LAPTOP: an open row on Next 3 buys the weeks his Value still needs, once each',
        JSON.stringify(re) === '[1,2,3,4,5,6,7,8,9,10,11,12,13]', JSON.stringify(w.reCalls));
      c.ok('ON THE LAPTOP: and his Value is the same number again',
        (w.reGlance || '').startsWith(`Value ${f1(own)} · Avg `), w.reGlance);
    } else {
      c.ok('ON THE SYNCED COPY: nothing is asked of ESPN for a Value — only the weeks on screen',
        JSON.stringify(re) === '[1,2,3,4,5,6]', JSON.stringify(w.reCalls));
      c.ok('ON THE SYNCED COPY: his Value is a dash, not a guess from three weeks',
        (w.reGlance || '').startsWith('Value — · Avg '), w.reGlance);
    }
  }

  if (scenario === 'value-nobase') {
    const w = globalThis.__wvValue || {};
    const espn = await import('./wv-stub-espn.mjs');
    const man = ((w.proj || {}).rows || []).find((r) => r.id === VALUE_MAN);
    c.ok('NO LINES: the switch is hidden on both tables', w.ctl && !w.ctl.wire && !w.ctl.taken, JSON.stringify(w.ctl));
    c.ok('NO LINES: a saved "Value" still shows ESPN’s projection',
      man && man.weeks[4].text === espn.expected(VALUE_MAN, 4).toFixed(1),
      `${man && man.weeks[4].text} want ${espn.expected(VALUE_MAN, 4).toFixed(1)}`);
    c.ok('NO LINES: the glance line is the one it always was', /^Avg \S+ · Proj \S+ · QB /.test(w.glance || '') && !/Value/.test(w.glance || ''), w.glance);
    c.ok('NO LINES: and the note says nothing about Value', !/waiver line/.test(w.note || ''), (w.note || '').slice(-200));
  }

  if (scenario === 'value-taken') {
    const w = globalThis.__wvValue || {};
    const { valueOf } = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);
    const { TREND_SQUADS } = await import('./wv-stub-season.mjs');
    const f1 = (n) => n.toFixed(1);
    c.ok('TAKEN: a saved "Value" opens both tables on Value', w.ctl && w.ctl.wire && w.ctl.taken && w.ctl.on.join() === 'value,value',
      JSON.stringify(w.ctl));
    const men = TREND_SQUADS.flatMap((t) => t.players);
    const rows = (w.taken || {}).rows || [];
    const bad = [];
    for (const m of men) {
      const r = rows.find((x) => x.id === m.playerId);
      const want = f1(valueOf(VALUE_BASE, m.position, m.flat));
      if (!r || r.avg.text !== want || ![4, 5, 6].every((wk) => r.weeks[wk].text === want)) {
        bad.push([m.name, want, r && r.avg.text, r && r.weeks[4].text]);
      }
    }
    c.ok('TAKEN: every rostered man’s week cells and Avg are valueOf(lines, his position, his projection)',
      men.length === 4 && bad.length === 0, JSON.stringify(bad));
    const stub = rows.find((x) => x.id === 7399);
    c.ok('TAKEN: by hand — a WR at 9.0 with lines 8 / 11 is half of the point over the waiver line, 0.5',
      stub && stub.weeks[4].text === '0.5' && stub.avg.text === '0.5', JSON.stringify(stub && [stub.weeks[4], stub.avg]));
    const mine = ((w.wire || {}).rows || []).find((r) => r.mine && r.id === 2985659);
    c.ok('TAKEN: your own row on the wire is on Value too (a K at 11.0 with lines 7 / 9.5: 2.8)',
      mine && mine.weeks[4].text === f1(valueOf(VALUE_BASE, 'K', 11)) && mine.weeks[4].text === '2.8',
      JSON.stringify(mine && mine.weeks[4]));
    c.ok('GLANCE: a rostered man’s open row leads with the Value js/season.js holds for him',
      /^Value 0\.7 · Avg /.test(w.known || ''), w.known);
    c.ok('GLANCE: a rostered man it holds none for gets a dash', /^Value — · Avg /.test(w.unknown || ''), w.unknown);
    const back = ((w.takenProj || {}).rows || []).find((x) => x.id === 7399);
    c.ok('TAKEN: back on Proj the cell is his projection again, and that is remembered',
      back && back.weeks[4].text === '9.0' && w.back.on.join() === 'proj,proj' &&
      JSON.parse(w.prefs || '{}')['waivers.show'] === 'proj',
      `${back && back.weeks[4].text} ${JSON.stringify(w.back)} ${w.prefs}`);
  }

  // ---- the summary strip ---------------------------------------------------
  if (scenario === 'demo' || scenario === 'live') {
    const stats = [...$('waiverStats').querySelectorAll('.stat')].map((s) => txt(s));
    c.ok('the strip counts what is on screen', stats.some((s) => /^Available/.test(s)), stats.join(' | '));
    c.ok('the strip states the weeks shown', stats.some((s) => /^Weeks shown/.test(s)), stats.join(' | '));
    c.ok('the strip names the best average by player',
      stats.some((s) => /^Best average/.test(s)), stats.join(' | '));
  }

  // ---- SYNC NOW: the page reads the league AGAIN ---------------------------
  //
  // Tim, 2026-10-08: "in the analysis section and the players section you can
  // tell parts of it aren't caught up like the which team the players belong
  // to." A page already showing the league used to ignore the press. Now
  // js/connection.js sends `ff:refresh`, and the page must load again and hand
  // the bar its load to wait for. Last here: it spends requests on purpose.
  if (scenario === 'live') {
    const season = await import('./wv-stub-season.mjs');
    const espn = await import('./wv-stub-espn.mjs');
    const before = { schedule: season.calls.schedule, wire: espn.calls.weeks.length };
    const waits = [];
    d.dispatchEvent(new boot.window.CustomEvent('ff:refresh', { detail: { waitUntil: (p) => waits.push(p) } }));
    c.ok('SYNC NOW: the page hands the bar its reload to wait for',
      waits.length === 1 && !!waits[0] && typeof waits[0].then === 'function', `${waits.length}`);
    await Promise.all(waits);
    await settleWaivers(d);
    c.ok('SYNC NOW: the schedule is read again', season.calls.schedule === before.schedule + 1,
      `${before.schedule} -> ${season.calls.schedule}`);
    c.ok('SYNC NOW: and the wire, every shown week of it',
      espn.calls.weeks.length === before.wire * 2, `${before.wire} -> ${espn.calls.weeks.length}`);
    c.ok('SYNC NOW: and the same men are listed afterwards',
      bodyRows($('waiverTable')).length === 60, `${bodyRows($('waiverTable')).length}`);
    c.ok('SYNC NOW: with nothing thrown on the way', boot.errors.length === 0 && boot.rejections.length === 0,
      boot.errors.concat(boot.rejections).slice(0, 2).join(' | '));
  }

  return c.out;
}

// ------------------------------------------------------------------ runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const scenario = process.argv[2];
  try {
    const booted = await boot(scenario);
    const results = await check(scenario, booted);
    emit({ scenario, results }, results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    emit({ scenario, results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }] }, 1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const args = cfg.stub ? ['--import', './wv-register.mjs', self, scenario] : [self, scenario];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: path.dirname(self),
    env: { ...process.env, ...(cfg.env || {}) },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 1800)}`);
    failed++;
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   x ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  failed += bad.length;
}

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
