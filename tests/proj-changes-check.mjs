// The Analysis page's Position | Player switch, and the "Proj changes" box
// under Season by week.
//
//   node proj-changes-check.mjs
//
// TIM, 2026-10-05: "This proj change box will be identical to the current
// season by week chart, but will show you what your season by week chart looked
// like around week 3 or 2 or something so you can see how it changed. ... The
// difference selection just shows the current proj-past proj for each cell".
//
// Why this suite exists: a difference is two numbers a reader cannot see at
// once, taken from two places (today's season read and a copy in storage), so
// a wrong one looks exactly like a right one. Every number asserted below is
// worked out BY HAND from tests/an-stub-season.mjs's formula and the copies
// written out in this file — never read back from the page's own arithmetic.
//
// The real page on the analysis stub (an-register.mjs), one child process per
// scenario, with a storage that can be listed (cap-harness.mjs) because
// js/proj-history.js scans keys.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const LEAGUE = '99';
const SEASON = 2026;
const ME = 4;
const CONN = { leagueId: LEAGUE, season: SEASON, teamId: ME };
const histKey = (week) => `ff.projhist.1.${LEAGUE}.${SEASON}.${week}`;
const snapKey = (week) => `ff.snap.${LEAGUE}.${SEASON}.${week}`;
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const r1 = (n) => Math.round(n * 10) / 10;

// ---- the league as the stub has it (an-stub-season.mjs), restated ----------
const POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'DST', 'K', 'RB', 'WR', 'QB', 'TE', 'WR', 'RB'];
const SLOT = [0, 2, 2, 4, 4, 6, 23, 16, 17, 20, 20, 20, 20, 20, 20];
const nameOf = (i) => `T${ME} Player ${String(i).padStart(2, '0')}`;
/** ESPN's projection in the stub: (20 − i) + 0.3 × week, bar its two holes. */
function projNow(i, week) {
  if (i === 3 && week === 6) return 0;
  if (i === 4 && week === 7) return null;
  return r1((20 - i) + week * 0.3);
}
const scored = (i) => r1(15 - i * 0.7);

// ---- the copies, written out ------------------------------------------------
//
// Week 5's copy of team 4: weeks 5..13, fourteen men. Everyone is at today's
// number EXCEPT the cells listed in THEN5, which are the whole test:
//
//   QB  Player 00  week 8: 20.0 then, 22.4 now  -> +2.4
//                  week 9: 25.0 then, 22.7 now  -> −2.3   (the negative one)
//   K   Player 08  week 8: 10.0 then, 14.4 now  -> +4.4
//   RB  Player 01  untouched: 21.4 both         ->  0.0
//
// Player 14 is NOT in it (on the roster now, not then), and "Gone Man" (499)
// is in it and on no roster now.
const COPY5_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13];
const THEN5 = { '0:8': 20.0, '0:9': 25.0, '8:8': 10.0 };
const COLS = ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'];
const rowOf = (i, weeks, over) => [
  ME * 100 + i, nameOf(i), POS[i], 'BUF', SLOT[i], 'ACTIVE',
  weeks.map((w) => (`${i}:${w}` in over ? over[`${i}:${w}`] : projNow(i, w))),
];
const GONE = [499, 'Gone Man', 'RB', 'BUF', 20, 'ACTIVE', COPY5_WEEKS.map(() => 7.7)];
const COPY5 = {
  v: 1, leagueId: LEAGUE, season: SEASON, week: 5, takenAt: '2026-10-06T15:00:00.000Z',
  weeks: COPY5_WEEKS, cols: COLS,
  teams: { [ME]: [...Array.from({ length: 14 }, (_, i) => rowOf(i, COPY5_WEEKS, THEN5)), GONE] },
};
// Week 3's: the same men, weeks 3..13, and one cell moved — QB week 8 at 18.0.
const COPY3_WEEKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const COPY3 = {
  v: 1, leagueId: LEAGUE, season: SEASON, week: 3, takenAt: '2026-09-22T15:00:00.000Z',
  weeks: COPY3_WEEKS, cols: COLS,
  teams: { [ME]: Array.from({ length: 14 }, (_, i) => rowOf(i, COPY3_WEEKS, { '0:8': 18.0 })) },
};
// A schema-2 READING of week 6, in the shape js/snapshots.js writes: it kept
// the connected manager's own roster and nobody else's.
const READING6_WEEKS = [6, 7, 8, 9, 10, 11, 12, 13];
const READING6 = {
  v: 2, leagueId: LEAGUE, season: SEASON, week: 6, takenAt: '2026-10-13T15:00:00.000Z',
  isDemo: false, leagueName: 'Stub League',
  teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
  playoffs: null, games: [], proj: {}, strength: {}, slots: null, weeksCovered: [],
  projNote: '', strengthNote: '', sigma: null, sigmaCalibrated: false, sigmaSample: 0,
  floors: null, floorWeek: null,
  players: {
    teamId: ME, weeks: READING6_WEEKS, cols: COLS,
    mine: Array.from({ length: 14 }, (_, i) => rowOf(i, READING6_WEEKS, { '0:8': 21.0 })),
  },
};

// =========================================================================
// CHILDREN: the real page
// =========================================================================

async function page(store) {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(String((r && r.stack) || r)));

  const html = readFileSync(path.join(REPO, 'analysis.html'), 'utf8');
  const dom = bootDom({ html, store });
  await import(moduleUrl('js/analysis-page.js'));
  const d = dom.document;
  const live = store['ff.prefs']['analysis.source'] === 'live';
  // Settled: every week of the season sheet has landed (no "·" left in it).
  await waitFor(() => {
    const rows = d.querySelectorAll('#seasonSlots tr');
    return rows.length >= 9 && (!live || !d.querySelector('#seasonTable td.wait'));
  }, 15000);
  await new Promise((r) => setTimeout(r, 150));
  console.error = origError;

  const $ = (id) => d.getElementById(id);
  const click = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const choose = (sel, v) => {
    sel.value = String(v);
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  /** A table as rows of { key, name, cells:[{t, v, cls, title}] }, week cells keyed by header. */
  const sheet = (tableId, bodyId) => {
    const table = $(tableId);
    if (!table) return null;
    const heads = [...table.querySelectorAll('thead tr:last-child th')].map((th) => text(th));
    // The number as printed, without the scale's ▲/▼ beside it.
    const printed = (el) => {
      if (!el) return '';
      const c = el.cloneNode(true);
      c.querySelectorAll('.heatmark').forEach((m) => m.remove());
      return c.textContent.replace(/\s+/g, ' ').trim();
    };
    const rowsOf = (sel) => [...table.querySelectorAll(sel)].map((tr) => ({
      player: tr.getAttribute('data-player'),
      trCls: tr.getAttribute('class') || '',
      slot: tr.getAttribute('data-slot'),
      name: text(tr.children[0]),
      cells: Object.fromEntries([...tr.children].map((td, i) => [heads[i], {
        t: printed(td), v: td.getAttribute('data-v'), cls: td.getAttribute('class') || '',
        // A cell with a card (2026-10-08) carries its sentence as an aria-label.
        title: td.getAttribute('title') || td.getAttribute('aria-label') || '',
        tip: td.getAttribute('data-tip') || '',
        pop: td.getAttribute('data-pop') || '',
        hasTitle: td.hasAttribute('title'),
      }])),
    }));
    return {
      heads,
      group: text(table.querySelector('thead tr.hist-row')),
      rows: rowsOf(`#${bodyId} tr`),
      band: rowsOf('tbody.split tr')[0] || null,
    };
  };
  const changes = () => ({
    title: text($('changesTitle')),
    asOf: $('changesAsOf') ? [...$('changesAsOf').querySelectorAll('option')].map((o) => o.getAttribute('value')) : null,
    asOfNow: $('changesAsOf') ? $('changesAsOf').value : null,
    view: [...d.querySelectorAll('#changesView button')].map((b) =>
      `${text(b)}${/\bon\b/.test(b.getAttribute('class') || '') ? '*' : ''}`),
    controlsHidden: $('changesControls') ? /\bhidden\b/.test($('changesControls').getAttribute('class')) : null,
    tableHidden: $('changesWrap') ? /\bhidden\b/.test($('changesWrap').getAttribute('class')) : null,
    empty: text($('changesEmpty')),
    emptyHidden: $('changesEmpty') ? /\bhidden\b/.test($('changesEmpty').getAttribute('class')) : null,
    sheet: sheet('changesTable', 'changesRows'),
  });
  const rowsToggle = () => [...d.querySelectorAll('#seasonRowsToggle button')].map((b) =>
    `${text(b)}${/\bon\b/.test(b.getAttribute('class') || '') ? '*' : ''}`);
  const done = () => ({
    errors, rejections, fetchCalls: dom.fetchCalls,
    histKeys: [...dom.map.keys()].filter((k) => k.startsWith('ff.projhist')).sort(),
  });
  return { d, $, click, choose, sheet, changes, rowsToggle, done, map: dom.map };
}

const viewBtn = (p, v) => p.d.querySelector(`#changesView button[data-sbw-view="${v}"]`);
const rowsBtn = (p, v) => p.d.querySelector(`#seasonRowsToggle button[data-rows="${v}"]`);

const CHILDREN = {
  /** Two copies in storage, the connected team: every switch, in one sitting. */
  async main() {
    const p = await page({
      'ff.prefs': { 'analysis.source': 'live' },
      'ff.connection': CONN,
      [histKey(3)]: COPY3,
      [histKey(5)]: COPY5,
    });
    const out = { order: [...p.d.querySelectorAll('section.panel')].map((s) => text(s.querySelector('h2')).split(' · ')[0]) };
    // A stat card's key is a bare counter that is never wound back (js/pop.js),
    // so a repaint gives the band's cells new keys for the same cards.
    const seasonHtml = () => p.$('seasonTable').innerHTML.replace(/data-pop="[^"]*"/g, 'data-pop');

    out.toggle0 = p.rowsToggle();
    out.pos0 = seasonHtml();
    out.posSheet = p.sheet('seasonTable', 'seasonSlots');
    out.chPosTotal = p.changes();
    p.click(viewBtn(p, 'diff'));
    out.chPosDiff = p.changes();
    p.click(viewBtn(p, 'total'));

    p.click(rowsBtn(p, 'player'));
    out.toggle1 = p.rowsToggle();
    out.player = p.sheet('seasonTable', 'seasonSlots');
    // Every word a reader can meet on the page as it stands — the text, and
    // every `title` and `aria-label` — that still talks in standard deviations.
    {
      const bad = /standard deviation|\bSD\b|z-score|\bstep \d of \d/i;
      const said = [p.d.body.textContent,
        ...[...p.d.querySelectorAll('[title], [aria-label]')]
          .flatMap((el) => [el.getAttribute('title'), el.getAttribute('aria-label')])];
      out.sdWords = said.filter((s) => s && bad.test(s)).map((s) => {
        const at = s.search(bad);
        return s.slice(Math.max(0, at - 60), at + 60);
      });
    }
    p.choose(p.d.querySelector('#seasonTable select[data-history]'), 'proj');
    out.playerProj = p.sheet('seasonTable', 'seasonSlots');
    p.choose(p.d.querySelector('#seasonTable select[data-history]'), 'actual');

    out.chPlTotal = p.changes();
    p.click(viewBtn(p, 'diff'));
    out.chPlDiff = p.changes();
    out.prefsPlayerDiff = p.map.get('ff.prefs');
    p.choose(p.$('changesAsOf'), 3);
    out.chPlDiff3 = p.changes();
    p.choose(p.$('changesAsOf'), 5);
    p.click(viewBtn(p, 'total'));

    p.click(rowsBtn(p, 'position'));
    out.pos1 = seasonHtml();
    out.same = out.pos0 === out.pos1;
    delete out.pos1;
    out.pos0 = out.pos0.length;
    return { ...out, ...p.done() };
  },

  /** A second visit, with the prefs the first one left: Player, and Difference. */
  async reload() {
    const p = await page({
      'ff.prefs': JSON.parse(process.env.PC_PREFS),
      'ff.connection': CONN,
      [histKey(3)]: COPY3,
      [histKey(5)]: COPY5,
    });
    return {
      toggle: p.rowsToggle(), season: p.sheet('seasonTable', 'seasonSlots'),
      changes: p.changes(), ...p.done(),
    };
  },

  /** No stored copy: one schema-2 reading, which kept the manager's own roster. */
  async reading() {
    const p = await page({
      'ff.prefs': { 'analysis.source': 'live' },
      'ff.connection': CONN,
      [snapKey(6)]: READING6,
    });
    const mine = p.changes();
    const note = text(p.$('changesNote'));
    p.choose(p.$('seasonTeamSelect'), 2);
    await new Promise((r) => setTimeout(r, 100));
    return { mine, note, other: p.changes(), ...p.done() };
  },

  /** Nothing saved at all: the state every browser is in the day this ships. */
  async none() {
    const p = await page({ 'ff.prefs': { 'analysis.source': 'live' }, 'ff.connection': CONN });
    return { changes: p.changes(), ...p.done() };
  },

  /**
   * AN EARLIER SEASON of the league, opened from the main menu (2026-10-10):
   * nothing was saved for it and nothing will be. (SEASON − 1 is before the
   * season being played whatever today's date is.)
   */
  async past() {
    const p = await page({ 'ff.prefs': { 'analysis.source': 'live' }, 'ff.connection': { ...CONN, season: SEASON - 1 } });
    return { changes: p.changes(), ...p.done() };
  },

  /** The sample league. */
  async demo() {
    const p = await page({ 'ff.prefs': { 'analysis.source': 'demo' } });
    p.click(rowsBtn(p, 'player'));
    return { changes: p.changes(), season: p.sheet('seasonTable', 'seasonSlots'), ...p.done() };
  },
};

if (process.argv[2]) {
  try {
    emit({ ok: true, data: await CHILDREN[process.argv[2]]() });
  } catch (err) {
    emit({ ok: false, error: String((err && err.stack) || err) }, 1);
  }
}

// =========================================================================
// PARENT
// =========================================================================

let total = 0;
let failed = 0;
function ok(name, cond, detail = '') {
  total++;
  if (cond) return;
  failed++;
  console.log(`   x ${name}${detail === '' ? '' : ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function run(name, env = {}) {
  const res = spawnSync(process.execPath, ['--import', './an-register.mjs', self, name], {
    encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    ok(`${name}: the child answered`, false, (res.stderr || res.stdout || '').slice(0, 1500));
    return null;
  }
  const got = JSON.parse(line.slice(2));
  ok(`${name}: the page booted`, got.ok, got.error);
  return got.ok ? got.data : null;
}

/** The three things every scenario owes: quiet console, no rejection, NO request. */
function quiet(name, x) {
  ok(`${name}: no console errors`, x.errors.length === 0, x.errors.slice(0, 2).join(' | '));
  ok(`${name}: no unhandled rejections`, x.rejections.length === 0, x.rejections.slice(0, 2).join(' | '));
  ok(`${name}: nothing was fetched`, x.fetchCalls.length === 0, x.fetchCalls.slice(0, 3).join(' | '));
}

const WEEK_HEADS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  '14PO (playoffs)', '15 (playoffs)', '16 (playoffs)'];
const PO = { 14: '14PO (playoffs)', 15: '15 (playoffs)', 16: '16 (playoffs)' };
const col = (w) => PO[w] || String(w);
/** A cell that is not there reads as an empty one, so a missing row FAILS rather than throws. */
const NONE = { t: null, v: null, cls: '', title: '' };
const cell = (row, w) => (row && row.cells[col(w)]) || NONE;
const avgOf = (row) => (row && row.cells.Avg) || NONE;
const byName = (sheet, name) => (sheet ? sheet.rows.find((r) => r.name.startsWith(name)) : null) || null;
const bySlot = (sheet, key) => (sheet ? sheet.rows.find((r) => r.slot === key) : null) || null;
const WORDS = (s) => s.split(/\s+/).filter(Boolean).length;
const NO_COPY = 'No saved projections for this team before week 8. Saved weekly from now on.';

// ---- today's roster in the order the Player view owes: starters in lineup
// order, then the bench by Avg (the mean of weeks 8..13), best first.
const FUTURE = [8, 9, 10, 11, 12, 13];
const avgNow = (i) => r1(FUTURE.map((w) => projNow(i, w)).reduce((a, b) => a + b, 0) / FUTURE.length);
const ROSTER_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** A block of assertions that cannot end the run: a throw is one more failure. */
function block(name, fn) {
  try { fn(); } catch (err) { ok(`${name}: every assertion could be asked`, false, String((err && err.stack) || err)); }
}

// --------------------------------------------------------------- main
block('main', () => {
  const m = run('main', { AN_GONE_BEFORE: '4' });
  if (m) {
    quiet('main', m);
    ok('the box sits right under Season by week, before Who to start',
      same(m.order.slice(m.order.indexOf('Season by week')).slice(0, 3),
        ['Season by week', 'Proj changes', 'Who to start, week by week']), m.order);
    ok('the panel wrote no copy of its own', same(m.histKeys, [histKey(3), histKey(5)]), m.histKeys);

    // ---- Position | Player ------------------------------------------------
    ok('the switch opens on Position', same(m.toggle0, ['Position*', 'Player']), m.toggle0);
    ok('Position is the slot sheet: nine slot rows', m.posSheet.rows.length === 9 &&
      same(m.posSheet.heads.slice(0, 2), ['Slot', 'Avg']), m.posSheet.heads);
    ok('Player lights Player', same(m.toggle1, ['Position', 'Player*']), m.toggle1);
    ok('Position, after a trip to Player and back, is the same table to the byte', m.same && m.pos0 > 1000, m.pos0);

    const P = m.player;
    ok('PLAYER: the head is Player, Avg, then the same sixteen weeks',
      same(P.heads, ['Player', 'Avg', ...WEEK_HEADS]), P.heads);
    ok('PLAYER: the Actual history label and its select are still over weeks 1–7',
      /Actual\s*Proj\s*history/.test(P.group), P.group);
    ok('PLAYER: one row per man on today’s roster, bench included — fifteen',
      same(P.rows.map((r) => Number(r.player)), ROSTER_ORDER.map((i) => ME * 100 + i)), P.rows.map((r) => r.player));
    ok('PLAYER: the man who left in week 4 (415) has no row',
      !P.rows.some((r) => r.player === '415' || /Player 15/.test(r.name)), P.rows.map((r) => r.name));
    ok('PLAYER: the first cell is his name and position',
      P.rows.length > 0 && (P.rows[0].name === `${nameOf(0)}QB` || P.rows[0].name === `${nameOf(0)} QB`), P.rows.length && P.rows[0].name);
    ok('PLAYER: a D/ST reads DEF', P.rows.length > 7 && /DEF$/.test(P.rows[7].name), P.rows.length > 7 && P.rows[7].name);
    ok('PLAYER: the fifth week cell (history) is what he SCORED — 15.0, 14.3, 9.4 on the bench',
      cell(P.rows[0], 5).t === '15.0' && cell(P.rows[1], 5).t === '14.3' && cell(P.rows[8], 5).t === '9.4',
      [cell(P.rows[0], 5), cell(P.rows[1], 5), cell(P.rows[8], 5)]);
    ok('PLAYER: a bench man’s history is his score too (Player 09: 8.7)',
      cell(P.rows[9], 3).t === scored(9).toFixed(1) && scored(9) === 8.7, cell(P.rows[9], 3));
    ok('PLAYER: every history cell of every man who was rostered is his score',
      P.rows.slice(0, 14).every((r, i) => [1, 2, 3, 4, 5, 6, 7].every((w) => cell(r, w).t === scored(i).toFixed(1))),
      P.rows.slice(0, 14).map((r) => cell(r, 2).t));
    ok('PLAYER: a week he was on no roster in the league is a dash that says so (Player 14, weeks 1–4)',
      [1, 2, 3, 4].every((w) => cell(P.rows[14], w).t === '—' && /on no roster/.test(cell(P.rows[14], w).title)) &&
      cell(P.rows[14], 5).t === scored(14).toFixed(1), [cell(P.rows[14], 4), cell(P.rows[14], 5)]);
    ok('PLAYER: weeks to come are ESPN’s projection — QB 22.4 in week 8, 23.9 in week 13; K 14.4',
      cell(P.rows[0], 8).t === '22.4' && cell(P.rows[0], 13).t === '23.9' && cell(P.rows[8], 8).t === '14.4',
      [cell(P.rows[0], 8), cell(P.rows[0], 13), cell(P.rows[8], 8)]);
    ok('PLAYER: every future regular-season cell is the stub’s projection',
      P.rows.every((r, i) => FUTURE.every((w) => cell(r, w).t === projNow(i, w).toFixed(1))),
      P.rows.map((r) => cell(r, 10).t));
    // AVG IS THE MEAN OF THE NUMBERS HIS ROW SHOWS (2026-10-06): seven scores,
    // then six projections — QB (7 × 15.0 + 138.9) / 13 = 18.8. It was the mean
    // of the weeks to come alone (23.2), beside a row it was not the average of.
    // Player 14 joined in week 5, so his four dashes count for nothing.
    const avgShown = (i) => {
      const xs = [...[1, 2, 3, 4, 5, 6, 7].filter((w) => i !== 14 || w >= 5).map(() => scored(i)),
        ...FUTURE.map((w) => projNow(i, w))];
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    ok('PLAYER: Avg is the mean of the numbers shown in his row (QB 18.8, not the 23.2 of the weeks to come)',
      P.rows.length === 15 && P.rows.every((r, i) => Math.abs(Number(avgOf(r).t) - avgShown(i)) < 0.051) &&
      avgOf(P.rows[0]).t === '18.8' && avgNow(0) !== 18.8 &&
      // ONE PLAIN LINE (Tim, 2026-10-08): how many weeks. (The stub's squads
      // are identical at every position, so there is no rank to add here; the
      // sample league below has one.)
      avgOf(P.rows[0]).title === 'Avg of 13 weeks',
      `${P.rows.map((r) => avgOf(r).t)} | ${avgOf(P.rows[0]).title}`);
    // THE PLAYER CARD ON EVERY READ WEEK CELL (Tim, 2026-10-08), the one his
    // name opens; and no cell carries a `title` beside it.
    ok('PLAYER: every read week cell opens his card — the one on his name — and has no title of its own',
      P.rows.every((r) => r.cells.Player && r.cells.Player.tip &&
        WEEK_HEADS.map((h) => r.cells[h]).filter(Boolean).every((c) => c.tip === r.cells.Player.tip && !c.hasTitle)),
      P.rows.map((r) => WEEK_HEADS.map((h) => r.cells[h]).filter((c) => c && c.tip !== r.cells.Player.tip).length));
    ok('NO PREVIEW ON THE PAGE TALKS ABOUT STANDARD DEVIATIONS (Tim: "SD and info we don’t want or need")',
      !m.sdWords.length, m.sdWords.slice(0, 3));
    ok('PLAYER: the heavy line is before week 8 in the body as in the head',
      P.rows.every((r) => /\bfut-start\b/.test(cell(r, 8).cls) && !/\bfut-start\b/.test(cell(r, 7).cls)),
      cell(P.rows[0], 8).cls);
    // COLOURED LIKE POSITION (Tim, 2026-10-06), against the starters at his position.
    const weekCells = P.rows.flatMap((r) => WEEK_HEADS.map((h) => r.cells[h]).filter(Boolean));
    const hot = weekCells.filter((c) => /\bheat-(up|dn)-/.test(c.cls));
    ok('PLAYER: week cells are coloured, in history and in the weeks to come',
      hot.length > 10 && P.rows.some((r) => /\bheat-(up|dn)-/.test(cell(r, 3).cls)) &&
      P.rows.some((r) => /\bheat-(up|dn)-/.test(cell(r, 10).cls)), hot.length);
    ok('PLAYER: every coloured cell says what it is compared with — starters at his position',
      weekCells.filter((c) => /\bheat\b/.test(c.cls)).every((c) =>
        /a starting (QB|RB|WR|TE|K|DEF) (around the league in week \d+|across the league)/.test(c.title)),
      weekCells.filter((c) => /\bheat\b/.test(c.cls)).map((c) => c.title).find((t) => !/a starting/.test(t)));
    ok('PLAYER: a cell with no number takes no colour',
      weekCells.filter((c) => c.t === 'Bye' || c.t === '—').every((c) => !/\bheat\b/.test(c.cls)), '');
    ok('PLAYER: one line, above the first man who is not starting',
      P.rows.filter((r) => /\bbench-start\b/.test(r.trCls)).length === 1 && !/\bbench-start\b/.test(P.rows[0].trCls) &&
      m.posSheet.rows.every((r) => !/\bbench-start\b/.test(r.trCls)),
      P.rows.map((r) => r.trCls));
    ok('PLAYER: the Starting lineup band is the Position sheet’s, number for number',
      Boolean(P.band) && Boolean(m.posSheet.band) && same(Object.values(P.band.cells).map((c) => c.t), Object.values(m.posSheet.band.cells).map((c) => c.t)),
      P.band && Object.values(P.band.cells).map((c) => c.t));

    const PP = m.playerProj;
    ok('PLAYER, Proj: history becomes the pre-game projection — QB week 5 21.5, week 7 22.1',
      cell(PP.rows[0], 5).t === '21.5' && cell(PP.rows[0], 7).t === '22.1' && projNow(0, 5) === 21.5,
      [cell(PP.rows[0], 5), cell(PP.rows[0], 7)]);
    ok('PLAYER, Proj: a week ESPN carried nothing for him is a dash (Player 04, week 7)',
      cell(byName(PP, nameOf(4)), 7).t === '—', cell(byName(PP, nameOf(4)), 7));
    // By name: two receivers in one slot are ordered by Avg, and on Proj the
    // 0.0 Player 03 was projected in week 6 puts him below Player 04.
    ok('PLAYER, Proj: the weeks to come do not move', P.rows.length === PP.rows.length && same(
      P.rows.map((r) => FUTURE.map((w) => cell(byName(PP, r.name), w).t)),
      P.rows.map((r) => FUTURE.map((w) => cell(r, w).t))), '');
    ok('PLAYER, Proj: Avg follows the select — QB (148.4 + 138.9) / 13 = 22.1',
      avgOf(PP.rows[0]).t === '22.1', avgOf(PP.rows[0]));

    // ---- Proj changes: the controls ----------------------------------------
    const T = m.chPlTotal;
    ok('CHANGES: the title names the team', T.title === 'Proj changes · Team 4', T.title);
    ok('CHANGES: As of lists exactly the weeks with a copy', same(T.asOf, ['3', '5']), T.asOf);
    ok('CHANGES: and opens on the latest one before this week', T.asOfNow === '5', T.asOfNow);
    ok('CHANGES: Total | Difference, on Total', same(T.view, ['Total*', 'Difference']), T.view);
    ok('CHANGES: no empty line when there is a copy', T.empty === '' && T.emptyHidden && !T.tableHidden && !T.controlsHidden, T.empty);

    // ---- Total, Player: the copy's own numbers ------------------------------
    const ts = T.sheet;
    ok('TOTAL/PLAYER: the head follows the Player switch', same(ts.heads, ['Player', 'Avg', ...WEEK_HEADS]), ts.heads);
    ok('TOTAL/PLAYER: the rows are the copy’s men — fourteen and Gone Man, not Player 14',
      ts.rows.length === 15 && Boolean(byName(ts, 'Gone Man')) && !byName(ts, nameOf(14)), ts.rows.map((r) => r.name));
    const tq = byName(ts, nameOf(0));
    const tk = byName(ts, nameOf(8));
    ok('TOTAL/PLAYER: QB reads the copy — 20.0 in week 8, 25.0 in week 9', cell(tq, 8).t === '20.0' && cell(tq, 9).t === '25.0',
      [cell(tq, 8), cell(tq, 9)]);
    ok('TOTAL/PLAYER: K reads 10.0 in week 8', cell(tk, 8).t === '10.0', cell(tk, 8));
    ok('TOTAL/PLAYER: Gone Man reads 7.7 in every week of the copy',
      COPY5_WEEKS.every((w) => cell(byName(ts, 'Gone Man'), w).t === '7.7'), byName(ts, 'Gone Man'));
    // K over the copy's nine weeks: 13.5 13.8 14.1 10.0 14.7 15.0 15.3 15.6 15.9
    // = 127.9 / 9 = 14.21. Today's own numbers would average 15.2 over six.
    ok('TOTAL/PLAYER: Avg is the mean of the copy’s regular-season weeks — K 14.2', avgOf(tk).t === '14.2', avgOf(tk));
    ok('TOTAL/PLAYER: weeks 5–7 show the copy too (QB 21.5, 21.8, 22.1)',
      same([5, 6, 7].map((w) => cell(tq, w).t), ['21.5', '21.8', '22.1']), [5, 6, 7].map((w) => cell(tq, w).t));
    ok('TOTAL/PLAYER: weeks the copy does not cover are blank — 1–4 and the playoffs',
      [1, 2, 3, 4, 14, 15, 16].every((w) => cell(tq, w).t === '' && /not in the copy/.test(cell(tq, w).title)),
      [cell(tq, 4), cell(tq, 14)]);

    // ---- Difference, Player -------------------------------------------------
    const D = m.chPlDiff;
    const ds = D.sheet;
    ok('DIFF: the switch lights Difference', same(D.view, ['Total', 'Difference*']), D.view);
    ok('DIFF/PLAYER: the rows are TODAY’s roster, in the sheet’s order — Gone Man is not listed',
      same(ds.rows.map((r) => r.player), m.player.rows.map((r) => r.player)) && !byName(ds, 'Gone Man'),
      ds.rows.map((r) => r.name));
    const dq = byName(ds, nameOf(0));
    const dk = byName(ds, nameOf(8));
    const dr = byName(ds, nameOf(1));
    ok('DIFF/PLAYER: QB week 8 is 22.4 − 20.0 = +2.4, green', cell(dq, 8).t === '+2.4' && /\bd-up\b/.test(cell(dq, 8).cls), cell(dq, 8));
    ok('DIFF/PLAYER: QB week 9 is 22.7 − 25.0 = −2.3, red, with a real minus',
      cell(dq, 9).t === '−2.3' && /\bd-down\b/.test(cell(dq, 9).cls) && cell(dq, 9).v === '-2.3', cell(dq, 9));
    ok('DIFF/PLAYER: K week 8 is 14.4 − 10.0 = +4.4', cell(dk, 8).t === '+4.4', cell(dk, 8));
    ok('DIFF/PLAYER: an unmoved cell is 0.0, dim', cell(dr, 8).t === '0.0' && /\bd-zero\b/.test(cell(dr, 8).cls), cell(dr, 8));
    ok('DIFF/PLAYER: the cell says both numbers', /22\.4 now, 20\.0 in week 5/.test(cell(dq, 8).title), cell(dq, 8).title);
    ok('DIFF/PLAYER: weeks played since the copy are blank — 5, 6, 7',
      [5, 6, 7].every((w) => cell(dq, w).t === '' && /played since week 5/.test(cell(dq, w).title)), cell(dq, 6));
    ok('DIFF/PLAYER: and weeks outside the copy are blank', [1, 2, 3, 4, 14, 15, 16].every((w) => cell(dq, w).t === ''), cell(dq, 14));
    const d14 = byName(ds, nameOf(14));
    ok('DIFF/PLAYER: a man who was not in the copy is dashed, and says why',
      FUTURE.every((w) => cell(d14, w).t === '—' && /was not on the roster in week 5/.test(cell(d14, w).title)) &&
      avgOf(d14).t === '—', [cell(d14, 8), avgOf(d14)]);
    ok('DIFF/PLAYER: Avg is the mean of the differences shown — K: 4.4 over six weeks = +0.7',
      avgOf(dk).t === '+0.7' && avgOf(dr).t === '0.0', [avgOf(dk), avgOf(dr)]);
    ok('DIFF/PLAYER: QB’s Avg: (+2.4 − 2.3) / 6 rounds to 0.0', avgOf(dq).t === '0.0', avgOf(dq));

    // ---- As of week 3 ------------------------------------------------------
    const d3 = byName(m.chPlDiff3.sheet, nameOf(0));
    ok('AS OF 3: the select moved, and QB week 8 is 22.4 − 18.0 = +4.4',
      m.chPlDiff3.asOfNow === '3' && cell(d3, 8).t === '+4.4' && cell(d3, 9).t === '0.0', [m.chPlDiff3.asOfNow, cell(d3, 8)]);
    ok('AS OF 3: weeks 3–7 are blank as played, 1–2 as outside the copy',
      [3, 4, 5, 6, 7].every((w) => /played since week 3/.test(cell(d3, w).title)) &&
      [1, 2].every((w) => /not in the copy/.test(cell(d3, w).title)), [cell(d3, 2), cell(d3, 3)]);

    // ---- Position ----------------------------------------------------------
    //
    // Week 8 today, best legal lineup: QB 22.4, RB 21.4 20.4, WR 19.4 18.4,
    // TE 17.4, FLEX 16.4, D/ST 15.4, K 14.4 = 165.6. As of week 5 the QB was
    // 20.0 and the K 10.0, everything else the same: 158.8. Difference +6.8.
    const pt = m.chPosTotal.sheet;
    ok('TOTAL/POSITION: the head is Slot, and the rows the nine slots',
      same(pt.heads, ['Slot', 'Avg', ...WEEK_HEADS]) &&
      same(pt.rows.map((r) => r.slot), ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'D/ST', 'K']), pt.rows.map((r) => r.slot));
    ok('TOTAL/POSITION: QB is the copy’s best QB — 20.0 in week 8, 25.0 in week 9; K 10.0',
      cell(bySlot(pt, 'QB'), 8).t === '20.0' && cell(bySlot(pt, 'QB'), 9).t === '25.0' && cell(bySlot(pt, 'K'), 8).t === '10.0',
      [cell(bySlot(pt, 'QB'), 8), cell(bySlot(pt, 'K'), 8)]);
    ok('TOTAL/POSITION: Avg is the copy’s too — K 14.2', avgOf(bySlot(pt, 'K')).t === '14.2', avgOf(bySlot(pt, 'K')));
    ok('TOTAL/POSITION: the cell names the man it was', /T4 Player 00/.test(cell(bySlot(pt, 'QB'), 8).title), cell(bySlot(pt, 'QB'), 8).title);
    ok('TOTAL/POSITION: the band is the lineup as it was — 158.8 in week 8',
      Boolean(pt.band) && pt.band.name === 'Starting lineup' && cell(pt.band, 8).t === '158.8', cell(pt.band, 8));
    ok('TOTAL/POSITION: the sheet above says 165.6 for the same week', cell(m.posSheet.band, 8).t === '165.6', cell(m.posSheet.band, 8));
    ok('DIFF/POSITION: Avg is the mean of the differences — K +0.7', avgOf(bySlot(m.chPosDiff.sheet, 'K')).t === '+0.7', avgOf(bySlot(m.chPosDiff.sheet, 'K')));
    const pd = m.chPosDiff.sheet;
    ok('DIFF/POSITION: QB +2.4 then −2.3, K +4.4, RB1 0.0',
      cell(bySlot(pd, 'QB'), 8).t === '+2.4' && cell(bySlot(pd, 'QB'), 9).t === '−2.3' &&
      cell(bySlot(pd, 'K'), 8).t === '+4.4' && cell(bySlot(pd, 'RB1'), 8).t === '0.0',
      [cell(bySlot(pd, 'QB'), 8), cell(bySlot(pd, 'QB'), 9), cell(bySlot(pd, 'K'), 8)]);
    ok('DIFF/POSITION: the band is 165.6 − 158.8 = +6.8, and week 9 is −2.3',
      cell(pd.band, 8).t === '+6.8' && cell(pd.band, 9).t === '−2.3', [cell(pd.band, 8), cell(pd.band, 9)]);
    ok('DIFF/POSITION: played weeks are blank in every row and the band',
      [5, 6, 7].every((w) => cell(pd.band, w).t === '' && pd.rows.every((r) => cell(r, w).t === '')), cell(pd.band, 6));

    // ---- remembered, and it drives the box below ---------------------------
    const r = run('reload', { AN_GONE_BEFORE: '4', PC_PREFS: m.prefsPlayerDiff });
    if (r) {
      quiet('reload', r);
      ok('RELOAD: the page opens on Player', same(r.toggle, ['Position', 'Player*']) &&
        same(r.season.heads.slice(0, 2), ['Player', 'Avg']) && r.season.rows.length === 15, r.toggle);
      ok('RELOAD: and Proj changes on Difference, by player, with the same numbers',
        same(r.changes.view, ['Total', 'Difference*']) && r.changes.sheet.heads[0] === 'Player' &&
        cell(byName(r.changes.sheet, nameOf(0)), 9).t === '−2.3', [r.changes.view, r.changes.sheet.heads[0]]);
    }
  }
});

// --------------------------------------------------------------- reading
block('reading', () => {
  const x = run('reading');
  if (x) {
    quiet('reading', x);
    ok('READING: the manager’s own team has the one week it kept', same(x.mine.asOf, ['6']) && x.mine.asOfNow === '6', x.mine.asOf);
    ok('READING: Total shows that roster’s numbers — QB 21.0 in week 8',
      cell(bySlot(x.mine.sheet, 'QB'), 8).t === '21.0', x.mine.sheet.rows[0]);
    ok('READING: the note says the copy kept one team', /your own team only/.test(x.note), x.note.slice(-200));
    ok('READING: another team has no copy, and gets the one line', x.other.title === 'Proj changes · Team 2' &&
      x.other.empty === NO_COPY && !x.other.emptyHidden && x.other.tableHidden && x.other.controlsHidden,
      [x.other.title, x.other.empty, x.other.tableHidden, x.other.controlsHidden]);
    ok('READING: and no table is left behind it', Boolean(x.other.sheet) && x.other.sheet.rows.length === 0 && !x.other.sheet.band, x.other.sheet && x.other.sheet.rows.length);
  }
});

// ------------------------------------------------------------------ none
block('none', () => {
  const x = run('none');
  if (x) {
    quiet('none', x);
    ok('NO COPY: one line, and it names the week', x.changes.empty === NO_COPY && !x.changes.emptyHidden, x.changes.empty);
    ok('NO COPY: fifteen words or fewer', WORDS(NO_COPY) <= 15, WORDS(NO_COPY));
    ok('NO COPY: no controls and no table', x.changes.controlsHidden && x.changes.tableHidden && Boolean(x.changes.sheet) && x.changes.sheet.rows.length === 0,
      [x.changes.controlsHidden, x.changes.tableHidden]);
    ok('NO COPY: the page did not write one either', x.histKeys.length === 0, x.histKeys);
  }
});

// ------------------------------------------------------------------ past
// An earlier season has no week "now", and nothing is saved for it any more:
// the first sentence alone — never "before week 8", never "from now on".
block('past', () => {
  const x = run('past');
  if (x) {
    quiet('past', x);
    ok('EARLIER SEASON: the one sentence, with no week and no promise',
      x.changes.empty === 'No saved projections for this team.' && !x.changes.emptyHidden, x.changes.empty);
    ok('EARLIER SEASON: it is the start of this season\'s line, not new words', NO_COPY.startsWith('No saved projections for this team'));
    ok('EARLIER SEASON: no controls and no table', x.changes.controlsHidden && x.changes.tableHidden && Boolean(x.changes.sheet) && x.changes.sheet.rows.length === 0,
      [x.changes.controlsHidden, x.changes.tableHidden]);
    ok('EARLIER SEASON: the page did not write a copy', x.histKeys.length === 0, x.histKeys);
  }
});

// ------------------------------------------------------------------ demo
block('demo', () => {
  const x = run('demo');
  if (x) {
    quiet('demo', x);
    ok('DEMO: the one line', x.changes.empty === 'Sample data has no saved projections.' && x.changes.tableHidden, x.changes.empty);
    ok('DEMO: Player rows work on the sample league too', x.season.heads[0] === 'Player' && x.season.rows.length >= 9 &&
      x.season.rows.every((r) => r.player), [x.season.heads[0], x.season.rows.length]);
    // The stub's squads are identical at every position, so its Avg has no scale; the sample's differ.
    ok('DEMO: a Player row’s Avg is on the scale too, against squads’ starters at his position',
      x.season.rows.some((r) => /\bheat\b/.test(avgOf(r).cls)) &&
      // ONE PLAIN LINE (Tim, 2026-10-08): how many weeks, and where it ranks.
      x.season.rows.every((r) => !/\bheat\b/.test(avgOf(r).cls) || /^Avg of \d+ weeks? · \d+(st|nd|rd|th) of \d+$/.test(avgOf(r).title)),
      x.season.rows.map((r) => `${avgOf(r).cls} | ${avgOf(r).title}`));
  }
});

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
