// Boots the REAL analysis.html + js/analysis-page.js and checks the new
// "Season by week" panel end to end.
//
//   node an-test.mjs
//
// Run it with `npm test` from tests/, or on its own with `node an-test.mjs`.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import path from 'node:path';

import { REPO } from './repo.mjs';

// ------------------------------------------------- a league with a missing id
//
// The page must emit no link at all for a player ESPN gave no playerId for —
// `waivers.html?player=undefined` looks like it would work and does not. The
// ordinary stub gives every player an id, and it is not this suite's file to
// change, so scenario (g) wraps it: a loader and an override module, both
// expressed as data: URLs and registered from inside this process, blank the
// id of one man on every team and leave everything else exactly as it was.
//
// Data URLs cannot carry relative imports, so the override reaches the stub by
// its absolute file URL. That also means it can never resolve back through
// './season.js' into itself.

const STUB_URL = new URL('./an-stub-season.mjs', import.meta.url).href;
const dataUrl = (src) => `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;

const NO_ID_SEASON = dataUrl(`
  import * as real from ${JSON.stringify(STUB_URL)};
  export * from ${JSON.stringify(STUB_URL)};

  // Player 00 — every team's QB, so the blank id lands in a lineup column of
  // both grids, in the roster detail and in the season grid all at once.
  const blank = (teams) => teams.map((t) => {
    const players = t.players.map((p) =>
      (p.name.endsWith('Player 00') ? { ...p, playerId: null } : p));
    return {
      ...t,
      players,
      starters: players.filter((p) => p.started),
      bench: players.filter((p) => !p.started),
    };
  });

  export async function fetchWeekRosters(week) {
    const got = await real.fetchWeekRosters(week);
    return { ...got, teams: blank(got.teams) };
  }
  export async function fetchWeeksRosters(weeks, opts) {
    const got = await real.fetchWeeksRosters(weeks, opts);
    const out = new Map();
    for (const [w, teams] of got) out.set(w, blank(teams));
    return out;
  }
`);

const NO_ID_LOADER = dataUrl(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && /\\/season\\.js$/.test(spec)) {
      return next(${JSON.stringify(NO_ID_SEASON)}, ctx);
    }
    return next(spec, ctx);
  }
`);

// ------------------------------------------ a league whose byes are known
//
// A 0.00 is a bye ONLY in his NFL team's bye week (verified against ESPN on
// 2026-09-16: OUT and IR men are projected at exactly 0.00 in ordinary weeks).
// This override wraps the ordinary stub and adds the two things that make the
// rule testable: `fetchByeWeeks()`, answering from AN_BYES ('throw' makes it
// fail), and AN_OUT_ZERO — Player 02, who the stub already lists OUT, projected
// at 0.00 in weeks 8 and 10. Every stub player's proTeamId is 1.
const BYES_SEASON = dataUrl(`
  import * as real from ${JSON.stringify(STUB_URL)};
  export * from ${JSON.stringify(STUB_URL)};

  const BYES = process.env.AN_BYES || '';
  export async function fetchByeWeeks() {
    if (BYES === 'throw') throw new Error('ESPN refused the bye weeks.');
    return BYES ? JSON.parse(BYES) : {};
  }

  const ZERO = new Set((process.env.AN_OUT_ZERO || '').split(',').filter(Boolean).map(Number));
  // AN_DST_ZERO does the same to Player 07, the D/ST — and he matters because
  // he is the ONLY man on the roster eligible for that slot, so a zero of his
  // is the one that must actually reach the season panel's D/ST row. Every
  // other position has cover, and cover is exactly what the panel shows you.
  const DZERO = new Set((process.env.AN_DST_ZERO || '').split(',').filter(Boolean).map(Number));
  const doctor = (teams, week) => teams.map((t) => {
    const players = t.players.map((p) =>
      ((p.name.endsWith('Player 02') && ZERO.has(week)) ||
       (p.name.endsWith('Player 07') && DZERO.has(week))
        ? { ...p, projected: 0 } : p));
    return { ...t, players, starters: players.filter((p) => p.started), bench: players.filter((p) => !p.started) };
  });
  export async function fetchWeekRosters(week) {
    const got = await real.fetchWeekRosters(week);
    return { ...got, teams: doctor(got.teams, week) };
  }
  export async function fetchWeeksRosters(weeks, opts) {
    const got = await real.fetchWeeksRosters(weeks, opts);
    const out = new Map();
    for (const [w, teams] of got) out.set(w, doctor(teams, w));
    return out;
  }
`);

const BYES_LOADER = dataUrl(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && /\\/season\\.js$/.test(spec)) {
      return next(${JSON.stringify(BYES_SEASON)}, ctx);
    }
    return next(spec, ctx);
  }
`);

// --------------------------------------- a league that starts THREE receivers
//
// AUDIT §1.2. Tim's own league starts ten — QB, RB, RB, WR, WR, WR, TE, FLEX,
// D/ST, K — and the ordinary stub starts nine, which is exactly why the `A week`
// grid's hard-coded nine went unnoticed. This override re-parks two men on
// every squad so ESPN's accepted lineups say three WR slots: Player 06 (a WR,
// the stub's FLEX) moves into a WR slot, and Player 09 (a bench RB, the best man
// left) comes off the bench into the FLEX. So the starters ARE the best legal
// ten, and the week grid and the season sheet have no excuse to differ.
const THREE_WR_SEASON = dataUrl(`
  import * as real from ${JSON.stringify(STUB_URL)};
  export * from ${JSON.stringify(STUB_URL)};

  const repark = (teams) => teams.map((t) => {
    const players = t.players.map((p) => {
      if (p.name.endsWith('Player 06')) return { ...p, lineupSlotId: 4, slot: 'WR', started: true };
      if (p.name.endsWith('Player 09')) return { ...p, lineupSlotId: 23, slot: 'FLEX', started: true };
      return p;
    });
    return { ...t, players, starters: players.filter((p) => p.started), bench: players.filter((p) => !p.started) };
  });
  export async function fetchWeekRosters(week) {
    const got = await real.fetchWeekRosters(week);
    return { ...got, teams: repark(got.teams) };
  }
  export async function fetchWeeksRosters(weeks, opts) {
    const got = await real.fetchWeeksRosters(weeks, opts);
    const out = new Map();
    for (const [w, teams] of got) out.set(w, repark(teams));
    return out;
  }
`);

const THREE_WR_LOADER = dataUrl(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && /\\/season\\.js$/.test(spec)) {
      return next(${JSON.stringify(THREE_WR_SEASON)}, ctx);
    }
    return next(spec, ctx);
  }
`);

/**
 * Hover a cell in the all-teams grid and read the card, by team and player.
 *
 * `grid` is 'overview' — the ONE grid, since the two were merged on 2026-09-17
 * and the measure became a control inside the panel. It is still a parameter
 * because every call site says which table it means, and a second grid-shaped
 * table on this page would need one again.
 */
const gridTd = (document, grid, teamId, player) =>
  [...document.querySelectorAll(`#${grid}Table tbody tr[data-team="${teamId}"] td[data-tip]`)]
    .find((td) => {
      const a = td.querySelector('a.pref');
      return a && a.getAttribute('href').endsWith(`player=${teamId * 100 + player}`);
    }) || null;

/**
 * One visit's worth of team choices, for (n) and (o): what it opens on, the
 * connection bar changing "your team", a tap on the grid, what got saved, and
 * a reload of the league in the same visit.
 */
async function teamVisit({ document, window }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const title = () => document.getElementById('seasonTitle').textContent.trim();
  const savedTeam = () => JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}')['analysis.team'];
  const out = { opened: title() };

  // The bar is told a different team is yours — only meaningful when one is set.
  const conn = JSON.parse(globalThis.localStorage.getItem('ff.connection'));
  if (conn.teamId != null) {
    const moved = { ...conn, teamId: 6 };
    globalThis.localStorage.setItem('ff.connection', JSON.stringify(moved));
    document.dispatchEvent(new window.CustomEvent('ff:connection', { detail: moved }));
    await sleep(200);
    out.afterBar = title();
  }

  const row = document.querySelector('#overviewTable tbody tr[data-team="7"] td.name');
  row.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(150);
  out.tapped = title();
  out.savedAfterTap = savedTeam() ?? null;

  document.querySelector('#sourceToggle button[data-src="live"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(700);
  out.reloaded = title();
  globalThis.__an = out;
}

const SCENARIOS = {
  demo: {
    label: '(a) demo mode, nothing connected',
    stub: false,
    prefs: { 'analysis.source': 'demo' },
  },

  // ---- the red/green scale on the all-teams grid (Tim, 2026-09-19) --------
  //
  // ON DEMO DATA, DELIBERATELY, and that is the whole reason this is its own
  // scenario rather than more assertions inside `grids`. The live stub gives
  // every squad IDENTICAL projections, so every column of the Proj avg grid is
  // ten copies of one number and the scale correctly refuses to draw — which
  // proves the flat-column guard and nothing else. demo-rosters.js builds ten
  // genuinely different squads, so a column has a best, a worst and a middle,
  // which is the table Tim was looking at when he asked for the colours.
  'avg-heat': {
    label: '(u) the red/green scale on the all-teams grid, per column',
    stub: false,
    prefs: { 'analysis.source': 'demo', 'analysis.measure': 'avg' },
    after: async ({ document }) => {
      const $ = (id) => document.getElementById(id);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // The average is the whole season, so it is only itself once every week
      // has landed. The season panel's own progress line is the page saying so.
      for (let t = 0; t < 8000; t += 20) {
        if ($('seasonProgress').textContent.trim() === '' &&
            document.querySelectorAll('#seasonTable tbody td.wait').length === 0 &&
            document.querySelectorAll('#seasonTable tbody tr').length > 0) break;
        await sleep(20);
      }
      const table = $('overviewTable');
      globalThis.__an = {
        measure: [...$('measureToggle').querySelectorAll('button[data-measure]')]
          .filter((b) => /\bon\b/.test(b.getAttribute('class') || ''))
          .map((b) => b.getAttribute('data-measure')),
        head: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
          team: tr.children[0].textContent.trim(),
          cells: [...tr.children].slice(1).map((td) => ({
            text: td.textContent.trim(),
            v: td.getAttribute('data-v'),
            cls: td.getAttribute('class') || '',
            title: td.getAttribute('title') || '',
          })),
        })),
        legend: $('overviewLegend').textContent.replace(/\s+/g, ' ').trim(),
        bars: $('overviewBars').textContent.replace(/\s+/g, ' ').trim(),
        // See the week-heat snapshot below for why the PLACEMENT is recorded
        // and not only the words.
        barsInToggle: Boolean($('overviewBars').closest('details.explain')),
        legendInToggle: Boolean($('overviewLegend').closest('details')),
        note: $('overviewNote').textContent.replace(/\s+/g, ' ').trim(),
      };
    },
  },
  // ---- the same scale on the `A week` measure (Tim, 2026-09-19b) ---------
  //
  // THE OPEN QUESTION THIS CLOSES. The week grid was deliberately left off the
  // scale, argued at length above `renderGrid`, on the grounds that its cells
  // already spend colour on four STATE meanings — Bye, a ruled-out 0.0, OUT and
  // IR — which is the "unless it conflicts with something else we already have
  // built" exception Tim named himself. He answered it: "the coloring is good
  // right now but it needs to be added to all the other places a number is
  // referred to across the whole site."
  //
  // So this scenario is the composition made falsifiable. Three things have to
  // be true at once or the change should not have shipped:
  //   1. the numbers are coloured, per column, and a kicker is never measured
  //      against a quarterback;
  //   2. a STATE cell — Bye, a ruled-out 0.0, a man OUT or on IR — is neither
  //      counted in the column's distribution nor tinted, so the state keeps
  //      its cell and the scale keeps its meaning;
  //   3. the bench columns carry no colour at all, because one squad's B1 is a
  //      running back and the next squad's is a quarterback.
  //
  // Demo data, for the same reason `avg-heat` uses it: the live stub gives
  // every squad identical projections, so it can only prove the flat guard.
  'week-heat': {
    label: '(v) the red/green scale on the `A week` grid, per column',
    stub: false,
    prefs: { 'analysis.source': 'demo', 'analysis.measure': 'week' },
    after: async ({ document }) => {
      const $ = (id) => document.getElementById(id);
      const table = $('overviewTable');
      const cellOf = (td) => ({
        text: td.textContent.replace(/\s+/g, ' ').trim(),
        v: td.getAttribute('data-v'),
        cls: td.getAttribute('class') || '',
        // The cells carry NO `title` — the card is this grid's tooltip — so the
        // words live on the link's aria-label and on the card itself.
        aria: (td.querySelector('a.pref') || { getAttribute: () => null })
          .getAttribute('aria-label') || '',
        title: td.getAttribute('title') || '',
      });
      globalThis.__an = {
        measure: [...$('measureToggle').querySelectorAll('button[data-measure]')]
          .filter((b) => /\bon\b/.test(b.getAttribute('class') || ''))
          .map((b) => b.getAttribute('data-measure')),
        head: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
          team: tr.children[0].textContent.trim(),
          cells: [...tr.children].slice(1).map(cellOf),
        })),
        legend: $('overviewLegend').textContent.replace(/\s+/g, ' ').trim(),
        bars: $('overviewBars').textContent.replace(/\s+/g, ' ').trim(),
        // WHERE each half of the key sits, not just what it says. The
        // thresholds belong inside "How this grid works" and the key outside
        // it; a snapshot of the words alone would not notice them swapping
        // back — which is the 2026-09-19c regression (+96 visible words on this
        // page, `node tests/text-audit.mjs`).
        barsInToggle: Boolean($('overviewBars').closest('details.explain')),
        legendInToggle: Boolean($('overviewLegend').closest('details')),
        note: $('overviewNote').textContent.replace(/\s+/g, ' ').trim(),
      };
    },
  },
  live: {
    label: '(b) stubbed live league, every week resolves',
    stub: true,
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'live-partial': {
    label: '(c) stubbed live league, weeks 5 and 11 reject',
    stub: true,
    env: { AN_FAIL_WEEKS: '5,11' },
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'team-switch': {
    label: '(d) switching team, sorting a week column, changing week',
    stub: true,
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const season = await import('./an-stub-season.mjs');
      const table = document.getElementById('seasonTable');
      // The SLOT rows only — the totals band is a tbody of its own and would
      // otherwise land in the middle of every "is this column sorted" check.
      const snap = () => ({
        cols: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        rows: [...table.querySelectorAll('#seasonSlots tr')].map((tr) => ({
          cls: tr.getAttribute('class') || '',
          slot: tr.children[0].textContent.trim(),
          cells: [...tr.children].map((td) => ({
            text: td.textContent.trim(),
            v: td.getAttribute('data-v'),
            cls: td.getAttribute('class') || '',
            pid: td.getAttribute('data-pid'),
          })),
        })),
        total8: (document.querySelector('#seasonTotals tr') || { children: [] })
          .children[1 + 8]?.getAttribute('data-v') ?? null,
        title: document.getElementById('seasonTitle').textContent.trim(),
      });
      const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

      const out = { before: snap() };
      out.fetchesBefore = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- switching the team via the shared picker: a repaint, no requests ---
      const sel = document.getElementById('teamSelect');
      sel.value = '7';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      out.team7 = snap();
      out.fetchesAfterSwitch = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- the picker Tim asked for at the top of Season by week (2026-09-19) --
      // It is the SAME setting as the one in the roster detail, so switching
      // here has to move that one too, and vice versa.
      const seasonSel = document.getElementById('seasonTeamSelect');
      out.seasonPicker = {
        exists: Boolean(seasonSel),
        // Inside the Season by week panel, above its table — not borrowed from
        // the panel at the foot of the page.
        inPanel: Boolean(seasonSel) &&
          seasonSel.closest('section.panel') ===
            document.getElementById('seasonTable').closest('section.panel'),
        aboveTable: Boolean(seasonSel) &&
          !document.getElementById('seasonWrap').contains(seasonSel),
        options: Boolean(seasonSel) && seasonSel.querySelectorAll('option').length,
        followedTheOther: Boolean(seasonSel) && seasonSel.value,
      };
      if (seasonSel) {
        seasonSel.value = '5';
        seasonSel.dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        out.team5 = snap();
        out.team5Pickers = { season: seasonSel.value, roster: sel.value };
        out.team5Roster = document.getElementById('rosterTitle').textContent.trim();
        out.fetchesAfterSeasonPick =
          { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };
      }

      // --- and via a click on the all-teams grid, which drives the same thing --
      const row = document.querySelector('#overviewTable tbody tr[data-team="2"]');
      if (row) click(row);
      await new Promise((r) => setTimeout(r, 120));
      out.team2 = snap();
      out.teamSelectValue = sel.value;
      out.team2Pickers = { season: seasonSel && seasonSel.value, roster: sel.value };
      out.fetchesAfterGridClick = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- sorting week columns ------------------------------------------------
      // Slot, Avg, then one column per week — so week N is header N + 1.
      const ths = [...table.querySelectorAll('thead th')];
      click(ths[8]);               // week 7 — one man has no number that week
      out.wk7desc = snap();
      click(ths[8]);
      out.wk7asc = snap();
      click(ths[7]);               // week 6 — one man is on bye
      out.wk6desc = snap();
      click(ths[7]);
      out.wk6asc = snap();
      click(ths[2]);               // week 1 — the last bench man is not signed
      out.wk1desc = snap();
      click(ths[2]);
      out.wk1asc = snap();
      out.fetchesAfterSort = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- changing the shown week: new row set, still no season refetch ------
      const wk = document.getElementById('weekSelect');
      wk.value = '3';
      wk.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      out.week3 = snap();
      out.note3 = document.getElementById('seasonNote').textContent.replace(/\s+/g, ' ').trim();
      out.fetchesAfterWeek = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      globalThis.__an = out;
    },
  },

  // THE ONE all-teams grid, and the control that decides what is in it.
  //
  // There were TWO of these panels until 2026-09-17 — a season-average grid and
  // a week grid stacked under it — and this scenario used to snapshot both. Tim:
  // "combine the 2 all teams boxes, put the week selection at the top of the all
  // teams box, and allow the user to select which week they want, as well as if
  // they want to show proj avg 2026." So it is one grid and a measure switch,
  // and what used to be "read the two straight down the page" is now "press the
  // other button" — which means the assertions below have to prove the MEASURE
  // still produces exactly the two sets of numbers the two panels did.
  //
  // Team 4 from an-stub-season.mjs makes the arithmetic checkable by hand.
  // seasonProjected is (20 - i) * 17, so avgWeek is exactly 20 - i:
  //
  //   starters  i=0 QB 20 · i=1 RB 19 · i=2 RB 18 · i=3 WR 17 · i=4 WR 16
  //             i=5 TE 15 · i=6 WR 14 · i=7 D/ST 13 · i=8 K 12   total 144
  //   bench     i=9 RB 11 · i=10 WR 10 · i=11 QB 9 · i=12 TE 8
  //             i=13 WR 7 · i=14 RB 6
  //
  // and projFor(i, week) is (20 - i) + week * 0.3, so week 8 is every one of
  // those plus 2.4 — a total of 165.6, which is also what the stub reports as
  // the team's own projectedTotal. Week 6 is the interesting one: i=3 is on
  // bye there, so the lineup has to be re-picked around a 0.00 — and a 0.00 may
  // only READ as a bye on the week measure, never on the season average.
  grids: {
    label: '(f) one all-teams grid: the measure switch, the week picker in the panel, and both measures',
    stub: true,
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const season = await import('./an-stub-season.mjs');
      const $ = (id) => document.getElementById(id);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // One grid, so a snapshot is one table plus the state of the control that
      // decides what is in it. It used to take two of these.
      const grab = () => {
        const table = $('overviewTable');
        return {
          title: $('overviewTitle').textContent.trim(),
          hint: $('measureHint').textContent.replace(/\s+/g, ' ').trim(),
          measure: [...$('measureToggle').querySelectorAll('button[data-measure]')]
            .filter((b) => /\bon\b/.test(b.getAttribute('class') || ''))
            .map((b) => b.getAttribute('data-measure')),
          buttons: [...$('measureToggle').querySelectorAll('button[data-measure]')]
            .map((b) => `${b.getAttribute('data-measure')}=${b.textContent.trim()}`),
          head: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
          rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
            team: tr.children[0].textContent.trim(),
            cls: tr.getAttribute('class') || '',
            cells: [...tr.children].slice(1).map((td) => ({
              text: td.textContent.trim(),
              v: td.getAttribute('data-v'),
              cls: td.getAttribute('class') || '',
              title: td.getAttribute('title') || '',
            })),
          })),
        };
      };
      const fire = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
      // The connection bar can finish its own round trip at any moment and send
      // the page back through useLive(), which empties the grid for one paint
      // while the week is refetched. A snapshot taken in that paint is ten rows
      // short and says nothing about the measure, so every snapshot waits for
      // the table to have its teams back first.
      const settle = async (ms = 4000) => {
        for (let t = 0; t < ms; t += 20) {
          if (document.querySelectorAll('#overviewTable tbody tr').length === 10) return true;
          await sleep(20);
        }
        return false;
      };
      const snap = async () => { await settle(); return grab(); };
      // THE AVERAGE MEASURE IS MADE OF THE WHOLE SEASON (2026-09-19), so a
      // snapshot of it taken while the weeks are still arriving is a table of
      // partial averages — true at that instant and not what any assertion
      // below means. The progress line clearing is the page's own "every week
      // that is coming has come".
      const settleSeason = async (ms = 8000) => {
        for (let t = 0; t < ms; t += 20) {
          if ($('seasonProgress').textContent.trim() === '' &&
              document.querySelectorAll('#seasonTable tbody td.wait').length === 0 &&
              document.querySelectorAll('#seasonTable tbody tr').length > 0) return true;
          await sleep(20);
        }
        return false;
      };
      const setMeasure = async (m) => {
        await settle();
        fire($('measureToggle').querySelector(`button[data-measure="${m}"]`));
        await sleep(60);
      };
      const note = () => $('overviewNote').textContent.replace(/\s+/g, ' ').trim();

      // Which week the REST of the page is on, read off two panels that have
      // nothing to do with the grid's measure.
      const elsewhere = () => ({
        weekSelect: $('weekSelect').value,
        seasonNow: [...$('seasonTable').querySelectorAll('thead th')]
          .filter((th) => /\bnow\b/.test(th.getAttribute('class') || ''))
          .map((th) => th.textContent.trim()),
        glanceWeek: ([...document.querySelectorAll('#teamGlance .stat')]
          .find((s) => s.querySelector('.k').textContent.trim() === 'Week') || null)
          ?.querySelector('.v').textContent.trim() ?? null,
      });

      const out = { initial: await snap() };
      out.fetchesBefore = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };
      out.notes = { week: note() };
      out.elsewhereBefore = elsewhere();

      // WHERE THE CONTROLS LIVE. The week picker moved out of the Data source
      // panel and into this one, which is half of what Tim asked for; a picker
      // that drifted back would be invisible to every other assertion here.
      const panelOf = (sel) => document.querySelector(sel).closest('section.panel');
      out.controls = {
        weekInGridPanel: panelOf('#overviewWrap').contains($('weekSelect')),
        toggleInGridPanel: panelOf('#overviewWrap').contains($('measureToggle')),
        weekInSourcePanel: panelOf('#sourceToggle').contains($('weekSelect')),
        // A control's explanation is a .ctl-hint on the page, never a `title`:
        // js/touch-titles.js deliberately leaves controls alone, so a `title`
        // here would be words no phone could read.
        titledButtons: $('measureToggle').querySelectorAll('button[title]').length,
        hintOnPage: !!$('measureHint'),
      };

      // --- the measure switch: the same squads, a different question --------
      await settleSeason();
      await setMeasure('avg');
      await settleSeason();
      out.avg = await snap();
      out.weeksRead = [...document.querySelectorAll('#seasonTable thead th')]
        .map((th) => th.textContent.trim()).filter((t) => /^\d+/.test(t)).length;
      // The Season by week band's own Avg for the drilled-into squad (team 4).
      // The grid's Total on this measure has to BE this number — that is the
      // whole of "use this exact information".
      out.bandAvg = (() => {
        const td = document.querySelector('#seasonTotals td.avg');
        return td ? td.getAttribute('data-v') : null;
      })();
      out.notes.avg = note();
      // The key under the grid, captured WHILE the average is on screen — the
      // boot switches back to the week measure further down, so reading it at
      // assertion time would read the wrong table's key.
      out.avgLegend = ($('overviewLegend') || { textContent: '' })
        .textContent.replace(/\s+/g, ' ').trim();
      out.elsewhereAfterMeasure = elsewhere();
      out.fetchesAfterMeasure = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };
      out.savedMeasure =
        JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}')['analysis.measure'] ?? null;

      await setMeasure('week');
      out.backToWeek = await snap();

      // --- a click in the grid drives the drill-down ------------------------
      const row = document.querySelector('#overviewTable tbody tr[data-team="2"]');
      if (row) fire(row);
      await sleep(120);
      out.picked = { team: $('teamSelect').value, snap: await snap() };

      // --- a click on a player link must NOT also repoint the drill-down -----
      // The row is click-to-drill-into-a-team and the number inside it is now a
      // link out of the page. Both handlers see the same click; only one of
      // them may act, or the reader comes back to a team he never picked.
      const link = document.querySelector(
        '#overviewTable tbody tr[data-team="5"] td.slot-cell a.pref');
      out.ref = link && { href: link.getAttribute('href'), title: link.getAttribute('title') };
      if (link) fire(link);
      await sleep(80);
      out.afterRefClick = {
        team: $('teamSelect').value,
        picked: [...document.querySelectorAll('#overviewTable tbody tr.picked')]
          .map((tr) => tr.getAttribute('data-team')),
      };

      // ...and a click on the row anywhere ELSE still does drill in.
      const nameCell = document.querySelector('#overviewTable tbody tr[data-team="5"] td.name');
      if (nameCell) fire(nameCell);
      await sleep(80);
      out.afterNameClick = { team: $('teamSelect').value };

      // put it back where the assertions below expect it
      const back = document.querySelector('#overviewTable tbody tr[data-team="2"] td.name');
      if (back) fire(back);
      await sleep(80);

      // --- change the week: the grid follows it on the week measure ---------
      const wk = $('weekSelect');
      wk.value = '6';
      wk.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(400);
      out.week6 = await snap();
      // Week 6 is the one with a 0.00 in it, so it is where byeAtZero can be
      // checked on BOTH measures against the very same fetched data.
      await setMeasure('avg');
      out.week6avg = await snap();
      await setMeasure('week');

      globalThis.__an = out;
    },
  },

  // The measure is remembered between visits, exactly as the week and the
  // position filter are. Same stub and the same league as (f) — only the saved
  // pref differs, which is what makes the pair falsifiable.
  'measure-saved': {
    label: '(r) the measure last chosen is the one the page opens on',
    stub: true,
    prefs: { 'analysis.source': 'live', 'analysis.measure': 'avg' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      const $ = (id) => document.getElementById(id);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // The average is made of the whole season, so it is only itself once the
      // weeks have landed. Waiting on the season panel's own progress line
      // rather than on a fixed sleep — it is the page's "everything is in".
      for (let t = 0; t < 8000; t += 20) {
        if ($('seasonProgress').textContent.trim() === '' &&
            document.querySelectorAll('#seasonTable tbody td.wait').length === 0 &&
            document.querySelectorAll('#seasonTable tbody tr').length > 0) break;
        await sleep(20);
      }
      globalThis.__an = {
        title: $('overviewTitle').textContent.trim(),
        lit: [...$('measureToggle').querySelectorAll('button[data-measure]')]
          .filter((b) => /\bon\b/.test(b.getAttribute('class') || ''))
          .map((b) => b.getAttribute('data-measure')),
        // Team 4's QB cell. On the average measure it is that squad's QB SLOT
        // over the season — never week 8's 22.4, which is the point of the
        // scenario: the page opened on the measure it was left on.
        qb: (document.querySelector(
          '#overviewTable tbody tr[data-team="4"] td.slot-avg, ' +
          '#overviewTable tbody tr[data-team="4"] td.slot-cell') || {})
          .textContent?.trim() ?? null,
        // ...while the REST of the page is still on the week the picker says.
        week: $('weekSelect').value,
        seasonNow: [...$('seasonTable').querySelectorAll('thead th')]
          .filter((th) => /\bnow\b/.test(th.getAttribute('class') || ''))
          .map((th) => th.textContent.trim()),
      };
    },
  },

  // BYEATZERO, WHICH THE MERGE HAD EVERY CHANCE TO LOSE.
  //
  // Only a WEEK's 0.00 can be a bye. A season average of 0.00 is a man ESPN
  // projects nothing for all year, which is a different fact and is printed as
  // a number. That was one flag on one of two grid definitions; it is now one
  // flag on one of two measures, and nothing else in the fixtures can put a
  // zero in front of both measures at once — the stub's season projections are
  // all positive. So AN_ZERO_SEASON zeroes Player 07's SEASON line and
  // AN_DST_ZERO zeroes his week 6, which is also his bye week (AN_BYES), and he
  // is the only D/ST on the roster, so his zero really does reach the DEF
  // column on both measures.
  'bye-vs-zero': {
    label: '(s) a 0.00 is a bye in a week and never on the season average',
    stub: true,
    byes: true,
    env: { AN_BYES: '{"1":6}', AN_DST_ZERO: '6', AN_ZERO_SEASON: '7' },
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const $ = (id) => document.getElementById(id);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // The DEF column, index 7 on either measure: the week grid's nine lineup
      // cells (then the bench), and the average grid's nine lineup SLOTS.
      const def = () => {
        const td = [...document.querySelectorAll(
          '#overviewTable tbody tr[data-team="4"] td.slot-cell, ' +
          '#overviewTable tbody tr[data-team="4"] td.slot-avg')][7];
        return td && { text: td.textContent.trim(), v: td.getAttribute('data-v'), cls: td.getAttribute('class') || '' };
      };
      const setMeasure = async (m) => {
        $('measureToggle').querySelector(`button[data-measure="${m}"]`)
          .dispatchEvent(new window.Event('click', { bubbles: true }));
        await sleep(60);
      };

      // Week 6 is in the past, so it has to be picked rather than opened on.
      const wk = $('weekSelect');
      wk.value = '6';
      wk.dispatchEvent(new window.Event('change', { bubbles: true }));
      // The rows AND the heading: the grid is repainted empty while the new
      // week is in flight, and a snapshot taken there is a heading with no
      // table under it.
      for (let t = 0; t < 4000; t += 20) {
        if (/week 6$/.test($('overviewTitle').textContent.trim()) && def()) break;
        await sleep(20);
      }
      const out = { title: $('overviewTitle').textContent.trim(), week: def() };
      await setMeasure('avg');
      out.avgTitle = $('overviewTitle').textContent.trim();
      out.avg = def();
      globalThis.__an = out;
    },
  },

  // The roster detail's starters/bench split, the total that sits in the gap,
  // and swapping a man across it. Team 4, week 8, from an-stub-season.mjs:
  //
  //   starters  400 QB · 401 RB · 402 RB · 403 WR · 404 WR · 405 TE
  //             406 WR in FLEX · 407 D/ST · 408 K
  //   bench     409 RB · 410 WR · 411 QB · 412 TE · 413 WR · 414 RB
  //
  // projected = (20 - i) + 2.4, so the starters total 165.6 and swapping 409
  // (13.4) in for 402 (20.4) must land on 158.6, exactly seven points down.
  swap: {
    label: '(e) the starters/bench split, its total, and swapping across it',
    stub: true,
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const season = await import('./an-stub-season.mjs');
      const $ = (id) => document.getElementById(id);

      const rowsOf = (id) =>
        [...$(id).querySelectorAll('tr')].map((tr) => {
          const b = tr.children[0].querySelector('button');
          return {
            cls: tr.getAttribute('class') || '',
            slot: tr.children[0].textContent.trim(),
            slotV: tr.children[0].getAttribute('data-v'),
            name: tr.children[1].textContent.trim(),
            proj: tr.children[4].textContent.trim(),
            btn: b
              ? {
                  id: b.getAttribute('data-swap'),
                  cls: b.getAttribute('class') || '',
                  off: b.hasAttribute('disabled'),
                }
              : null,
          };
        });

      const snap = () => {
        const split = document.querySelector('#rosterSplit tr');
        const delta = split && split.children[1].querySelector('.split-delta');
        return {
          starters: rowsOf('rosterStarters'),
          bench: rowsOf('rosterBench'),
          split: split && {
            label: split.children[0].textContent.trim(),
            total: split.children[1].textContent.trim(),
            delta: delta ? delta.textContent.trim() : '',
            hint: split.children[2].textContent.replace(/\s+/g, ' ').trim(),
            spans: [...split.children].map((td) => Number(td.getAttribute('colspan') || 1)),
            bodies: [...document.querySelectorAll('#rosterTable tbody')].map((b) => b.getAttribute('id')),
          },
          reset: ($('lineupReset').getAttribute('class') || ''),
          // The method is in the toggle; "not the real lineup" is on screen.
          note: `${$('rosterNote').textContent} ${$('rosterEdited').textContent}`
            .replace(/\s+/g, ' ').trim(),
          editedShown: !/\bhidden\b/.test($('rosterEdited').getAttribute('class') || ''),
          glance: [...document.querySelectorAll('#teamGlance .stat')].map((s) => [
            s.querySelector('.k').textContent.trim(),
            s.querySelector('.v').textContent.trim(),
          ]),
          // The season panel does NOT share the what-if: it answers what the
          // numbers say you would be projected, and a hand-moved lineup folded
          // into that would make an experiment look like advice. So it is
          // captured to prove it does not move, not to prove it does.
          season: [...document.querySelectorAll('#seasonSlots tr')].map((tr) =>
            `${tr.children[0].textContent.trim()}=` +
            `${tr.children[1 + 8].getAttribute('data-pid')}:` +
            `${tr.children[1 + 8].getAttribute('data-v')}`),
          seasonTotal: (document.querySelector('#seasonTotals tr') || { children: [] })
            .children[1 + 8]?.getAttribute('data-v') ?? null,
        };
      };

      const fire = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
      const tap = (id) => {
        const b = document.querySelector(`#rosterTable button[data-swap="${id}"]`);
        if (b) fire(b);
        return Boolean(b);
      };

      // The glance's Proj avg is this squad's lineup in an average WEEK since
      // 2026-09-19, so it is "—" until the season has landed. Every snapshot
      // here is compared against another, so they all have to be taken on the
      // same side of that — otherwise the swap assertions would be reading a
      // week arriving as though it were the swap moving a number.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let t = 0; t < 8000; t += 20) {
        if ($('seasonProgress').textContent.trim() === '' &&
            document.querySelectorAll('#seasonTable tbody td.wait').length === 0 &&
            document.querySelectorAll('#seasonTable tbody tr').length > 0) break;
        await sleep(20);
      }

      const out = { initial: snap() };
      out.fetchesBefore = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- pick a bench RB up: only the legal landing places light up --------
      tap(409);
      out.holding = snap();

      // --- his own slot again puts him down, changing nothing ---------------
      tap(409);
      out.putDown = snap();

      // --- pick him up again and drop him on the second RB slot -------------
      tap(409);
      tap(402);
      out.swapped = snap();
      out.fetchesAfterSwap = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- a swap that is not allowed: bench QB onto an RB slot --------------
      tap(411);
      out.holdingQB = snap();
      tap(401);                       // refused — the lineup must not move
      out.refused = snap();

      // --- and back to ESPN's own lineup ------------------------------------
      fire($('lineupReset'));
      out.reset = snap();

      // --- sorting must not merge the two groups ----------------------------
      const ths = [...document.querySelectorAll('#rosterTable thead th')];
      fire(ths[4]);                   // Projected, descending
      out.sorted = snap();
      fire(ths[0]);                   // back to Slot
      fire(ths[0]);

      // --- the what-if belongs to one squad in one week ---------------------
      tap(409);
      tap(402);
      out.swappedAgain = snap();
      const sel = $('teamSelect');
      sel.value = '7';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      out.afterTeam = snap();

      globalThis.__an = out;
    },
  },

  // Every team's QB comes back with playerId: null. Nothing else changes, so
  // the whole page still renders and every OTHER man is still linked — which
  // is the point: the rule is "skip the link", not "give up on the row".
  'no-id': {
    label: '(g) a player ESPN gave no id for gets no link',
    stub: false,          // this one registers a loader of its own, below
    noId: true,
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  starters: {
    label: '(i) who to start, week by week — every position, and a team switch',
    stub: false,
    prefs: { 'analysis.source': 'demo' },
    after: async ({ document, window }) => {
      const table = document.getElementById('startersTable');
      const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

      const snap = () => ({
        title: document.getElementById('startersTitle').textContent.trim(),
        head: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        lit: [...document.querySelectorAll('#starterPosToggle button.on')]
          .map((b) => b.dataset.pos),
        note: document.getElementById('startersNote').textContent.replace(/\s+/g, ' ').trim(),
        emptyHidden: (document.getElementById('startersEmpty').getAttribute('class') || '')
          .includes('hidden'),
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
          cls: tr.getAttribute('class') || '',
          depth: tr.children[0].textContent.trim(),
          depthV: tr.children[0].getAttribute('data-v'),
          name: tr.children[1].textContent.trim(),
          pos: tr.children[2].textContent.trim(),
          avg: tr.children[4].getAttribute('data-v'),
          starts: Number(tr.children[5].getAttribute('data-v')),
          // Only the week columns, in week order: the identity block is six wide.
          weeks: [...tr.children].slice(6).map((td) => ({
            text: td.textContent.trim(),
            v: td.getAttribute('data-v'),
            st: /\bst\b/.test(td.getAttribute('class') || ''),
            fx: /\bfx\b/.test(td.getAttribute('class') || ''),
            title: td.getAttribute('title') || '',
          })),
          links: [...tr.querySelectorAll('a.pref')].map((a) => a.getAttribute('href')),
        })),
      });

      // Captured BEFORE the team switch below, because every byPos snapshot
      // belongs to the team the page opened on — reading it afterwards built
      // the expected lineups for the wrong squad and made the page look wrong.
      const teamNow = () => document.getElementById('rosterTitle').textContent
        .replace(/^Roster detail\s*·\s*/, '').trim();

      const out = { byPos: {}, teamName: teamNow() };
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'K']) {
        click(document.querySelector(`#starterPosToggle button[data-pos="${pos}"]`));
        await new Promise((r) => setTimeout(r, 30));
        out.byPos[pos] = snap();
      }

      // Back to RB, then switch team: the panel must follow the shared picker
      // and must not cost a request to do it.
      click(document.querySelector('#starterPosToggle button[data-pos="RB"]'));
      await new Promise((r) => setTimeout(r, 30));
      out.beforeSwitch = snap();

      const sel = document.getElementById('teamSelect');
      const other = [...sel.querySelectorAll('option')][3];
      out.otherTeam = other.textContent.trim();
      sel.value = other.getAttribute('value');
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      out.afterSwitch = snap();
      out.teamAfter = teamNow();

      globalThis.__an = out;
    },
  },

  // ---- "Season by week", rebuilt as lineup slots (Tim, 2026-09-17) ---------
  //
  // Every claim this scenario makes is re-derived in `check` from
  // demo-rosters.js through forecast.js's own optimalLineup, never read back
  // off the page — including the red thresholds, which are recomputed over all
  // ten squads. A panel that filled the wrong man into WR2, or coloured the
  // wrong cell, would otherwise agree with itself all day.
  'season-slots': {
    label: '(p) season by week: the slots, the band, the red marks, the highlight',
    stub: false,
    prefs: { 'analysis.source': 'demo' },
    after: async ({ document, window }) => {
      const $ = (id) => document.getElementById(id);
      const table = $('seasonTable');
      const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const out = {};

      out.team = t($('rosterTitle')).replace(/^Roster detail\s*·\s*/, '');
      out.rows = [...document.querySelectorAll('#seasonSlots tr')].map((tr) => ({
        slot: tr.children[0].textContent.trim(),
        avg: tr.children[1].getAttribute('data-v'),
        cells: [...tr.children].slice(2).map((td) => ({
          text: td.textContent.trim(),
          v: td.getAttribute('data-v'),
          pid: td.getAttribute('data-pid'),
          cls: td.getAttribute('class') || '',
        })),
      }));
      out.totals = [...document.querySelector('#seasonTotals tr').children]
        .slice(2).map((td) => td.getAttribute('data-v'));
      out.bars = t($('seasonBars'));
      out.idle = t($('seasonPick'));

      // --- the highlight: name him at the top, light every week he holds ---
      const litOf = () => [...table.querySelectorAll('td.lit')].map((td) =>
        `${td.parentElement.getAttribute('data-slot')}:${td.getAttribute('data-pid')}`);
      // The man who holds the most cells, so "all his other weeks" has
      // something to prove rather than being a single cell lighting itself.
      const counts = new Map();
      for (const td of table.querySelectorAll('td[data-pid]')) {
        const id = td.getAttribute('data-pid');
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      const [pid, held] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      out.pid = pid;
      out.held = held;
      out.allHis = [...table.querySelectorAll(`td[data-pid="${pid}"]`)].map((td) =>
        `${td.parentElement.getAttribute('data-slot')}:${td.getAttribute('data-pid')}`);

      const cell = table.querySelector(`td[data-pid="${pid}"]`);
      cell.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
      const card = document.getElementById('tipCard');
      out.hover = {
        pick: t($('seasonPick')),
        lit: litOf(),
        card: card && !card.hidden ? t(card.querySelector('.tc-ident')) : '',
      };
      cell.dispatchEvent(new window.Event('mouseout', { bubbles: true }));
      out.afterOut = { pick: t($('seasonPick')), lit: litOf().length };

      // --- the keyboard gets the same thing, and Escape clears it ----------
      const link = cell.querySelector('a.pref');
      link.dispatchEvent(new window.Event('focusin', { bubbles: true }));
      out.focus = { pick: t($('seasonPick')), lit: litOf().length };
      const esc = new window.Event('keydown', { bubbles: true });
      esc.key = 'Escape';
      document.dispatchEvent(esc);
      out.afterEsc = { pick: t($('seasonPick')), lit: litOf().length };

      // --- THE BAND'S GROUP IS THE WEEK COLUMN, and the only way to see it ---
      //
      // The band shows ONE squad, so the nine squads its colours are measured
      // against are not on the screen at all. Walking the team picker puts each
      // of them on screen in turn, which turns "is this scaled per week column
      // or along the row" into something the DOM can answer: inside any one
      // WEEK, a bigger total must never be the redder cell across the league.
      // Scaled along the row instead, that ordering would be nonsense.
      const sel = $('seasonTeamSelect');
      const teamIds = [...sel.querySelectorAll('option')].map((o) => o.getAttribute('value'));
      out.bandByTeam = [];
      for (const id of teamIds) {
        sel.value = id;
        sel.dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        out.bandByTeam.push({
          team: id,
          cells: [...document.querySelector('#seasonTotals tr').children].slice(2).map((td) => ({
            v: td.getAttribute('data-v'),
            cls: td.getAttribute('class') || '',
          })),
        });
      }

      globalThis.__an = out;
    },
  },

  // The guard on a slot with too little behind it to have a standard
  // deviation. AN_SOLO_K leaves team 4 the only squad with a kicker and
  // AN_FAIL_WEEKS leaves week 8 the only readable week, so the K slot has
  // exactly ONE value in the whole league — which `stdev` refuses, and the
  // panel must therefore leave uncoloured while every other slot is marked.
  'thin-slot': {
    label: '(q) a slot with too little behind it draws no colour at all',
    stub: true,
    env: {
      AN_SOLO_K: '1',
      AN_FAIL_WEEKS: '1,2,3,4,5,6,7,9,10,11,12,13,14,15,16',
    },
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      const out = {};
      out.rows = [...document.querySelectorAll('#seasonSlots tr')].map((tr) => ({
        slot: tr.children[0].textContent.trim(),
        wk8: {
          text: tr.children[1 + 8].textContent.trim(),
          v: tr.children[1 + 8].getAttribute('data-v'),
          cls: tr.children[1 + 8].getAttribute('class') || '',
        },
      }));
      out.bars = document.getElementById('seasonBars').textContent.replace(/\s+/g, ' ').trim();
      out.note = document.getElementById('seasonNote').textContent.replace(/\s+/g, ' ').trim();
      // A REFUSAL IS A FACT ABOUT THE TABLE, not method, so it stays in view
      // while the thresholds sit in the toggle — HANDOFF keeps anything that
      // changes what a number means visible. This is the one scenario that
      // draws an uncoloured column beside a coloured band.
      out.legend = document.getElementById('seasonLegend').textContent.replace(/\s+/g, ' ').trim();
      out.bandColoured = Boolean(document.querySelector('#seasonTotals td.heat'));
      globalThis.__an = out;
    },
  },

  // ---- the bye rule, the opening week, the row tap, the best-lineup line ----
  'byes-known': {
    label: '(j) byes known: a bye is only the bye week; an OUT man’s zero is 0.0 OUT',
    stub: true,
    byes: true,
    env: { AN_BYES: '{"1":6}', AN_OUT_ZERO: '8,10', AN_DST_ZERO: '6,9' },
    // A saved week that has since been PLAYED (the stub's schedule has results
    // through week 7) must be ignored: the page opens on the coming week, 8.
    prefs: { 'analysis.source': 'live', 'analysis.week': 3 },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const out = {};
      out.title = document.getElementById('overviewTitle').textContent.trim();
      out.rowTitles = [...document.querySelectorAll('table.grid tbody tr[data-team]')]
        .filter((tr) => tr.hasAttribute('title')).length;

      const cellInfo = (td) => td && {
        text: td.textContent.replace(/\s+/g, ' ').trim(),
        cls: td.getAttribute('class') || '',
        v: td.getAttribute('data-v'),
        title: td.getAttribute('title') || '',
      };
      const w2 = gridTd(document, 'overview', 4, 2);
      out.weekCell02 = cellInfo(w2);
      out.gridLegend = document.getElementById('overviewLegend').textContent.replace(/\s+/g, ' ');

      // The season panel's rows are SLOTS, so a zero only reaches one when
      // nobody better can fill it. Player 07 is the only D/ST on the roster,
      // which is why AN_DST_ZERO is what puts a bye and a plain zero on screen.
      const slotRow = (key) => [...document.querySelectorAll('#seasonSlots tr')]
        .find((tr) => tr.children[0].textContent.trim() === key);
      // A filled season cell carries NO `title` — it draws the player card, and
      // a title beside one would have the browser put a second tooltip on top.
      // The words are on the link's aria-label instead, so that is what is read.
      const wk = (tr, w) => {
        const td = tr && tr.children[1 + w];
        const info = cellInfo(td);
        const a = td && td.querySelector('a.pref');
        if (info) info.label = (a && a.getAttribute('aria-label')) || '';
        return info;
      };
      out.dstW6 = wk(slotRow('D/ST'), 6);     // his bye week
      out.dstW9 = wk(slotRow('D/ST'), 9);     // not his bye: a real zero
      out.dstW8 = wk(slotRow('D/ST'), 8);     // untouched
      out.rb2w8 = wk(slotRow('RB2'), 8);      // the ruled-out back is replaced
      out.seasonLegend = document.getElementById('seasonLegend').textContent.replace(/\s+/g, ' ');

      // The card for the OUT man, hovered in the week grid.
      w2.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
      const card = document.getElementById('tipCard');
      const tds = [...card.querySelectorAll('.tc-run tbody td')];
      out.card = {
        texts: tds.map((t) => t.textContent.trim()),
        kinds: tds.map((t) => t.getAttribute('class') || ''),
        legend: (card.querySelector('.tc-legend') || { textContent: '' }).textContent,
      };
      w2.dispatchEvent(new window.Event('mouseout', { bubbles: true }));
      const h3 = gridTd(document, 'overview', 4, 3);
      h3.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
      const tds3 = [...card.querySelectorAll('.tc-run tbody td')];
      out.card03 = tds3.map((t) => t.textContent.trim());
      h3.dispatchEvent(new window.Event('mouseout', { bubbles: true }));

      // The best-lineup line: Player 02 (an RB starter) is at 0.0 this week,
      // and Player 09 (a bench RB) is the best man who could replace him.
      const best = document.getElementById('rosterBest');
      out.best = best.textContent.replace(/\s+/g, ' ').trim();
      out.bestLinks = [...best.querySelectorAll('a.pref')].map((a) => ({
        href: a.getAttribute('href'), title: a.hasAttribute('title'),
      }));

      // A row tap scrolls the detail into view only when it is off screen.
      const head = document.getElementById('rosterTitle');
      let scrolls = 0;
      let top = 2400;
      window.innerHeight = 800;
      head.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20 });
      head.scrollIntoView = () => { scrolls++; };
      const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
      click(document.querySelector('#overviewTable tbody tr[data-team="2"] td.name'));
      await new Promise((r) => setTimeout(r, 60));
      out.scrollsOff = scrolls;
      out.rosterAfter = document.getElementById('rosterTitle').textContent.trim();
      top = 120;
      click(document.querySelector('#overviewTable tbody tr[data-team="3"] td.name'));
      await new Promise((r) => setTimeout(r, 60));
      out.scrollsOn = scrolls;
      globalThis.__an = out;
    },
  },
  // THE POSITIONAL FLOOR (Tim, 2026-09-18): no slot assessed below what the
  // waiver wire would give you at that position, and the lifted ones drawn in
  // orange. The floors here are deliberately HIGH — a 14.0 kicker and a 20.0
  // D/ST are nothing like a real wire — so that a page which ignored them
  // entirely could not accidentally agree with one that applies them. Week 6
  // is the D/ST's bye, which is Tim's own example: a slot ESPN says is worth
  // 0.00 and a manager would never field empty.
  floors: {
    label: '(t) the waiver floor: a bye is assessed at the wire, in orange',
    stub: true,
    byes: true,
    env: { AN_BYES: '{"1":6}', AN_DST_ZERO: '6', AN_FLOORS: '{"K":14,"DST":20,"QB":3,"RB":3,"WR":3,"TE":3}' },
    prefs: { 'analysis.source': 'live', 'analysis.week': 6 },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      const out = {};
      const rowFor = (key) => [...document.querySelectorAll('#seasonSlots tr')]
        .find((tr) => tr.children[0].textContent.trim() === key);
      const cell = (key, week) => {
        const tr = rowFor(key);
        const td = tr && tr.children[1 + week];
        return td && {
          text: td.textContent.trim(),
          cls: td.getAttribute('class') || '',
          v: td.getAttribute('data-v'),
          title: (td.querySelector('a') || td).getAttribute('aria-label') || td.getAttribute('title') || '',
        };
      };
      out.dstW6 = cell('D/ST', 6);
      out.kW6 = cell('K', 6);
      out.qbW6 = cell('QB', 6);
      // The band has to total the column as drawn, floors and all.
      const band = document.querySelector('#seasonTotals tr');
      out.bandW6 = band && band.children[1 + 6].getAttribute('data-v');
      out.slotValues = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'D/ST', 'K']
        .map((k) => { const c = cell(k, 6); return c ? Number(c.v) : null; });
      out.assumedCount = document.querySelectorAll('#seasonTable tbody td.assumed').length;
      out.legend = document.getElementById('seasonLegend').textContent.replace(/\s+/g, ' ');
      out.note = document.getElementById('seasonNote').textContent.replace(/\s+/g, ' ');
      globalThis.__an = out;
    },
  },
  'byes-other-week': {
    label: '(k) byes known and not week 6: that zero is a real 0.0, and a future saved week is kept',
    stub: true,
    byes: true,
    env: { AN_BYES: '{"1":11}', AN_DST_ZERO: '6' },
    prefs: { 'analysis.source': 'live', 'analysis.week': 11 },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      const out = {};
      out.title = document.getElementById('overviewTitle').textContent.trim();
      const row = [...document.querySelectorAll('#seasonSlots tr')]
        .find((tr) => tr.children[0].textContent.trim() === 'D/ST');
      const td = row && row.children[1 + 6];
      out.dstW6 = td && { text: td.textContent.trim(), cls: td.getAttribute('class') || '', v: td.getAttribute('data-v') };
      out.anyBye = [...document.querySelectorAll('#seasonTable tbody td, #startersTable tbody td')]
        .some((c) => c.textContent.trim() === 'Bye');
      out.seasonLegend = document.getElementById('seasonLegend').textContent.replace(/\s+/g, ' ');
      out.best = document.getElementById('rosterBest').textContent.replace(/\s+/g, ' ').trim();
      globalThis.__an = out;
    },
  },
  'byes-unknown': {
    label: '(l) the bye read fails: every live zero is a bye, exactly as before',
    stub: true,
    byes: true,
    env: { AN_BYES: 'throw', AN_OUT_ZERO: '8', AN_DST_ZERO: '9' },
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      const out = {};
      const td = gridTd(document, 'overview', 4, 2);
      out.weekCell02 = td && { text: td.textContent.trim(), cls: td.getAttribute('class') || '' };
      const row = [...document.querySelectorAll('#seasonSlots tr')]
        .find((tr) => tr.children[0].textContent.trim() === 'D/ST');
      out.dstW9 = row && row.children[1 + 9].textContent.trim();
      globalThis.__an = out;
    },
  },
  // ---- which team a visit opens on (2026-09-17) ------------------------------
  //
  // The drilled-into team used to be saved and restored on every visit, so the
  // page reopened on whichever rival was tapped last. Now a visit opens on YOUR
  // team; a tap holds for the visit only, and is saved only when the page has
  // never been told which team is yours.
  'team-own': {
    label: '(n) a visit opens on your own team, not the last one tapped',
    stub: true,
    prefs: { 'analysis.source': 'live', 'analysis.team': 2 },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: teamVisit,
  },
  'team-noown': {
    label: '(o) with no team of your own known, the last tap is remembered',
    stub: true,
    prefs: { 'analysis.source': 'live', 'analysis.team': 2 },
    conn: { leagueId: '99', season: 2026 },
    after: teamVisit,
  },
  'card-repaint': {
    label: '(m) an open card stays open while the season loads behind it',
    stub: true,
    byes: true,
    env: { AN_DELAY: '70', AN_BYES: '{"1":6}' },
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    wait: 0,
    after: async ({ document, window }) => {
      const out = {};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (fn, ms = 6000) => {
        for (let t = 0; t < ms; t += 20) { if (fn()) return true; await sleep(20); }
        return false;
      };
      const card = () => document.getElementById('tipCard');
      const read = () => [...card().querySelectorAll('.tc-run tbody td')].map((t) => t.textContent.trim());

      // --- hover, while weeks are still arriving -------------------------------
      out.gridUp = await until(() => gridTd(document, 'overview', 4, 1));
      gridTd(document, 'overview', 4, 1).dispatchEvent(new window.Event('mouseover', { bubbles: true }));
      out.hoverOpen = !!card() && !card().hidden;
      out.hoverPendingAtOpen = (card().textContent.includes('Not read yet') || read().includes('·'));
      out.loaded = await until(() =>
        document.getElementById('seasonProgress').textContent.trim() === '' &&
        !document.querySelector('#seasonTable td.wait'));
      await sleep(40);
      out.hoverStillOpen = !card().hidden;
      out.hoverIdent = card().querySelector('.tc-ident')?.textContent || '';
      out.hoverValues = read();
      out.hoverIsLive = !!gridTd(document, 'overview', 4, 1) &&
        document.body.contains(gridTd(document, 'overview', 4, 1));
      gridTd(document, 'overview', 4, 1).dispatchEvent(new window.Event('mouseout', { bubbles: true }));
      out.hoverClosesOnLeave = card().hidden;

      // --- the same as a tap-opened sheet, across a team switch's repaint ------
      window.matchMedia = (q) => ({ matches: /hover:\s*none/.test(q), addEventListener() {}, removeEventListener() {} });
      // Player 14 only joins his squad in week 5 (SIGNED_WEEK in the stub).
      gridTd(document, 'overview', 6, 14).dispatchEvent(new window.Event('click', { bubbles: true }));
      out.sheetOpen = !card().hidden && card().classList.contains('sheet');
      const sel = document.getElementById('teamSelect');
      sel.value = '5';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(40);
      out.sheetAfterRepaint = !card().hidden && card().classList.contains('sheet');
      out.sheetIdent = card().querySelector('.tc-ident')?.textContent || '';

      // --- and it closes when its man is no longer on screen at all ------------
      // A `change`, not a click: a click anywhere outside a sheet closes it on
      // its own, which would make this pass for the wrong reason.
      const wk = document.getElementById('weekSelect');
      wk.value = '3';
      wk.dispatchEvent(new window.Event('change', { bubbles: true }));
      out.sheetBeforeWeekLands = !card().hidden;
      await until(() => /week 3$/.test(document.getElementById('overviewTitle').textContent.trim()) &&
        !gridTd(document, 'overview', 6, 14) && !!gridTd(document, 'overview', 6, 1));
      await sleep(20);
      out.sheetGoneWithMan = card().hidden;
      globalThis.__an = out;
    },
  },
  // AUDIT §1.2: the `A week` Total is the whole starting lineup the league
  // actually starts, floored the way the Proj avg basis is. The K floor (16.0)
  // sits above every kicker's week-8 projection (14.4) and below nobody else's
  // floor, so exactly one slot per squad is lifted — a Total that ignored the
  // floor is 1.6 short, and one that dropped WR3 is ~13 short. Neither can pass.
  'three-wr': {
    label: '(w) a league that starts three receivers: the A week Total is the whole floored lineup',
    stub: true,
    threeWr: true,
    env: { AN_FLOORS: '{"K":16}' },
    prefs: { 'analysis.source': 'live', 'analysis.week': 8, 'analysis.measure': 'week' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document }) => {
      const $ = (id) => document.getElementById(id);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Wait for the week grid to be ten rows AND the season sheet to hold week 8.
      for (let t = 0; t < 6000; t += 20) {
        const band = document.querySelector('#seasonTotals tr');
        if (document.querySelectorAll('#overviewTable tbody tr').length === 10 &&
          band && band.children[1 + 8] && band.children[1 + 8].getAttribute('data-v')) break;
        await sleep(20);
      }
      const table = $('overviewTable');
      const head = [...table.querySelectorAll('thead th')];
      const totalAt = head.findIndex((th) => th.textContent.trim() === 'Total');
      const out = {
        title: $('overviewTitle').textContent.trim(),
        head: head.map((th) => th.textContent.trim()),
        totalTitle: totalAt >= 0 ? head[totalAt].getAttribute('title') || '' : '',
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
          team: Number(tr.getAttribute('data-team')),
          total: totalAt >= 0 ? tr.children[totalAt].getAttribute('data-v') : null,
          totalSays: totalAt >= 0 ? tr.children[totalAt].getAttribute('title') || '' : '',
          // The kicker's own cell, which must stay ESPN's number: a man is
          // never floored, only the squad's total is.
          k: tr.children[head.findIndex((th) => th.textContent.trim() === 'K')]?.getAttribute('data-v') ?? null,
        })),
        seasonTeam: $('teamSelect') ? $('teamSelect').value : null,
        bandW8: document.querySelector('#seasonTotals tr')?.children[1 + 8]?.getAttribute('data-v') ?? null,
        note: $('overviewNote').textContent.replace(/\s+/g, ' '),
      };
      globalThis.__an = out;
    },
  },
};

/**
 * AUDIT §1.2, checked against an answer this file works out for itself.
 *
 * The expected Total is rebuilt from an-stub-season.mjs's raw numbers with the
 * same re-parking the loader applies: ten starters, greedy best-first into the
 * league's ten slots (most restrictive first, FLEX last), then each assessed at
 * max(projection, floor). Nothing is read back off the page to build it.
 */
async function checkThreeWr(c, boot) {
  const w = globalThis.__an;
  const stub = await import('./an-stub-season.mjs');
  const WEEK = 8;
  const FLOORS = { K: 16 };
  const r1 = (v) => Math.round(v * 10) / 10;
  const men = Array.from({ length: stub.SIZE }, (_, i) => i)
    .filter((i) => stub.onRoster(i, WEEK))
    .map((i) => ({ i, pos: stub.POS[i], v: stub.projFor(i, WEEK) }))
    .filter((m) => Number.isFinite(m.v))
    .sort((a, b) => b.v - a.v);
  const SLOTS = [['QB'], ['RB'], ['RB'], ['WR'], ['WR'], ['WR'], ['TE'], ['DST'], ['K'], ['RB', 'WR', 'TE']];
  const used = new Set();
  let expected = 0;
  let unfloored = 0;
  for (const elig of SLOTS) {
    const m = men.find((x) => !used.has(x) && elig.includes(x.pos));
    if (!m) continue;
    used.add(m);
    unfloored += m.v;
    expected += Math.max(m.v, FLOORS[m.pos] ?? -Infinity);
  }
  expected = r1(expected);
  unfloored = r1(unfloored);

  c.ok('THREE-WR: the grid is on week 8', /week 8$/.test(w.title), w.title);
  c.ok('THREE-WR: THE WEEK GRID HAS THE LEAGUE’S TEN SLOTS, WR3 AMONG THEM',
    JSON.stringify(w.head.slice(0, 12)) ===
      JSON.stringify(['Team', 'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'FLEX', 'DEF', 'K', 'Total']),
    JSON.stringify(w.head));
  c.ok('THREE-WR: ten squads on screen', w.rows.length === 10, String(w.rows.length));
  const wrong = w.rows.filter((r) => r.total === null || Math.abs(Number(r.total) - expected) > 0.051);
  c.ok(`THREE-WR: EVERY SQUAD’S A-WEEK TOTAL IS THE WHOLE FLOORED LINEUP (${expected})`,
    w.rows.length === 10 && wrong.length === 0,
    `expected ${expected} (unfloored ${unfloored}); got ${JSON.stringify(w.rows.map((r) => r.total))}`);
  // The same week on the Proj avg basis, as the page itself draws it: the
  // season sheet's Starting lineup band for the squad on screen (team 4).
  const four = w.rows.find((r) => r.team === 4);
  c.ok('THREE-WR: and it is the number Season by week’s band shows for that squad that week',
    Boolean(four) && w.bandW8 !== null && Math.abs(Number(four.total) - Number(w.bandW8)) < 0.051,
    `grid ${four && four.total} vs band ${w.bandW8} (team ${w.seasonTeam})`);
  c.ok('THREE-WR: the kicker’s own cell stays ESPN’s number — only the Total is floored',
    w.rows.every((r) => Number(r.k) === stub.projFor(8, WEEK)),
    JSON.stringify(w.rows.map((r) => r.k)));
  c.ok('THREE-WR: the Total header counts ten, not nine',
    /\bten\b/i.test(w.totalTitle) && !/\bnine\b/i.test(w.totalTitle), w.totalTitle);
  c.ok('THREE-WR: each Total says it is the best ten',
    w.rows.every((r) => /best ten\b/.test(r.totalSays)), w.rows[0] && w.rows[0].totalSays);
  c.ok('THREE-WR: the note says the Total takes the waiver floor and a man’s cell does not',
    /Total is those ten/.test(w.note) && /waiver floor/i.test(w.note) && /own cell/i.test(w.note),
    w.note.slice(0, 600));
  c.ok('THREE-WR: and nothing in the note still says nine columns',
    !/nine (columns|real men)/i.test(w.note), w.note.slice(0, 600));
  return c.out;
}

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  // Registered here rather than through --import, because the module it points
  // at is built in this file. Every import after this point sees it, and the
  // page module is imported at the foot of this function.
  if (cfg.noId) register(NO_ID_LOADER);
  if (cfg.byes) register(BYES_LOADER);
  if (cfg.threeWr) register(THREE_WR_LOADER);
  const html = readFileSync(path.join(REPO, 'analysis.html'), 'utf8');
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
      pathname: '/analysis.html', search: '', hash: '',
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
  process.on('unhandledRejection', (r) => rejections.push(String((r && r.stack) || r)));

  await import(pathToFileURL(path.join(REPO, 'js/analysis-page.js')).href);
  await new Promise((r) => setTimeout(r, cfg.wait ?? 600));
  if (cfg.after) await cfg.after({ document, window });
  console.error = origError;

  return { document, window, errors, fetchCalls, rejections, cfg };
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
  // The roster table's middle tbody is the starters/bench divider and its
  // total, not a player, so it is never part of a row set.
  return [...table.querySelectorAll('tbody tr')]
    .filter((tr) => !/\bsplit-row\b/.test(tr.getAttribute('class') || ''))
    .map((tr) => ({
      cls: tr.getAttribute('class') || '',
      cells: [...tr.children].map((td) => ({
        text: txt(td),
        v: td.getAttribute('data-v'),
        cls: td.getAttribute('class') || '',
        // Which man the number stands for, in the season panel's slot rows.
        pid: td.getAttribute('data-pid'),
        // The sentence a coloured cell carries — channel 3 of "never colour
        // alone", and a tap on a phone via js/touch-titles.js.
        title: td.getAttribute('title') || '',
      })),
    }));
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

/**
 * Hover a grid cell and read the tip card it draws.
 *
 * The week run used to be lines of text in a native `title`, and Tim read it
 * and said it was hard to scan. It is a two-row chart now — week numbers over
 * their own projections — which a `title` cannot do: it renders in the OS UI
 * font, where a space is narrower than a digit, so no padding lines thirteen
 * columns up. So there is a card, and this reads it.
 *
 * The card is a child of <body>, not of the table: both grids sit in an
 * overflow:auto box that would clip it. `mouseover` rather than `mouseenter`,
 * because only the former bubbles to the delegated handler.
 */
function hoverCard(d, window, td) {
  td.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  const card = d.getElementById('tipCard');
  if (!card || card.hidden) return null;
  const one = (sel) => (card.querySelector(sel) ? card.querySelector(sel).textContent.trim() : '');
  const cells = [...card.querySelectorAll('.tc-run tbody td')];
  return {
    ident: one('.tc-ident'),
    heading: one('.tc-head'),
    pending: one('.tc-pending'),
    // The first cell of each row is its label ("Week" / "Proj"), not data.
    weeks: [...card.querySelectorAll('.tc-run thead th')].slice(1).map((t) => t.textContent.trim()),
    values: cells.map((t) => t.textContent.trim()),
    kinds: cells.map((t) => t.getAttribute('class') || ''),
    legend: one('.tc-legend'),
    rows: card.querySelectorAll('.tc-run tr').length,
    text: card.textContent.replace(/\s+/g, ' ').trim(),
  };
}

// THE SEASON PANEL'S ROWS ARE LINEUP SLOTS, NOT PLAYERS (Tim, 2026-09-17):
// "I just want to label the positions as QB, WR1, WR2, etc. and then put the
// player with the proj that matches that position (2nd highest WR proj in WR2,
// etc.)". Both leagues here — the demo and the stub — start the same nine.
const IDENTITY = ['Slot', 'Avg'];
const SLOT_ROWS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'D/ST', 'K'];
/** Which column a week's numbers are in: Slot, Avg, then one per week. */
const weekCol = (w) => w + 1;

/** The totals band under the last slot — a tbody of its own, so bodyRows skips it. */
function totalsRow(table) {
  const tr = table.querySelector('tbody.split tr');
  if (!tr) return null;
  return {
    label: txt(tr.children[0]),
    cells: [...tr.children].map((td) => ({
      text: txt(td), v: td.getAttribute('data-v'), cls: td.getAttribute('class') || '',
    })),
  };
}

// THE WEEK RUN REACHES THE PLAYOFFS (Tim, 2026-09-17). Both leagues here —
// the demo and the stub — are thirteen-week, ten-team seasons, so
// capture.playoffWeeks puts a six-team bracket in weeks 14–16. The first of
// them is headed "PO" and every playoff header says "(playoffs)" in words.
const REGULAR_WEEKS = Array.from({ length: 13 }, (_, i) => i + 1);
const PLAYOFF_WEEKS = [14, 15, 16];
const PLAYOFF_COLS = ['14PO (playoffs)', '15 (playoffs)', '16 (playoffs)'];
const SEASON_COLS = [...REGULAR_WEEKS.map(String), ...PLAYOFF_COLS];
const isPo = (cls) => String(cls || '').split(/\s+/).includes('po-start');

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);
  const table = $('seasonTable');
  const roster = $('rosterTable');
  // The method sits in the "How this works" toggle; a failed week is an error,
  // so it is said on screen in #seasonAlert. Read together, they are the note.
  const note = `${txt($('seasonNote'))} ${txt($('seasonAlert'))}`.trim();

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));
  // A ten-slot league: every shape assertion below is written for the stub's
  // nine, so this scenario is checked on its own terms.
  if (scenario === 'three-wr') return checkThreeWr(c, boot);

  // ---- PANEL ORDER, which is Tim's and not a matter of taste --------------
  //
  // His order, 2026-09-17: one merged all-teams box (the week picker and the
  // proj-avg switch inside it), then Season by week, then Who to start, then
  // Roster detail — the drill-down last, because it is the thing you reach for
  // after the whole league has told you where to look.
  //
  // Read off the DOM in document order, every `<section class="panel">` on the
  // page and not a list anybody maintains, with the team or squad name that
  // gets appended at paint time cut back to the half the markup owns. So
  // swapping two sections in analysis.html fails this and nothing else would.
  const panelOrder = [...d.querySelectorAll('section.panel')].map((s) => {
    const h = s.querySelector('h2');
    return txt(h).split(' · ')[0];
  });
  c.ok('THE PANELS ARE IN TIM’S ORDER, MERGED ALL-TEAMS BOX FIRST',
    JSON.stringify(panelOrder) === JSON.stringify(
      ['Data source', 'All teams', 'Season by week', 'Who to start, week by week', 'Roster detail']),
    JSON.stringify(panelOrder));
  c.ok('and there is exactly ONE all-teams panel, not the two it used to be',
    panelOrder.filter((h) => h.startsWith('All teams')).length === 1,
    JSON.stringify(panelOrder));

  const head = headers(table);
  const rows = bodyRows(table);
  const rosterRows = bodyRows(roster);

  // ---- shape: the rows are LINEUP SLOTS, not players ----------------------
  const totals = totalsRow(table);
  c.ok('the panel exists with its own table', Boolean(table), 'no #seasonTable');
  c.ok('identity columns are Slot and Avg, and nothing else',
    JSON.stringify(head.slice(0, 2)) === JSON.stringify(IDENTITY), JSON.stringify(head));
  c.ok('nothing but week numbers after them',
    head.length > 2 && head.slice(2).every((h) => /^\d+(PO)?( \(playoffs\))?$/.test(h)), JSON.stringify(head));
  c.ok('one column per week of the season, thirteen of them, then the three playoff weeks',
    JSON.stringify(head.slice(2)) === JSON.stringify(SEASON_COLS), JSON.stringify(head));
  // (team-switch deliberately leaves the table sorted by a week column, so
  // there the claim is about the SET of slots rather than their order.)
  c.ok('THE ROWS ARE THIS LEAGUE’S STARTING SLOTS, IN LINEUP ORDER',
    scenario === 'team-switch'
      ? JSON.stringify(rows.map((r) => r.cells[0].text).slice().sort()) ===
        JSON.stringify(SLOT_ROWS.slice().sort())
      : JSON.stringify(rows.map((r) => r.cells[0].text)) === JSON.stringify(SLOT_ROWS),
    JSON.stringify(rows.map((r) => r.cells[0].text)));
  // A name still reaches a screen reader through the link's aria-label, which
  // is the point: what is gone is the NAME COLUMN, not the identification.
  c.ok('and not one player is named in anything the table DRAWS',
    !/Player \d\d/.test(table.textContent),
    (table.textContent.match(/Player \d\d/g) || []).slice(0, 2).join(' '));
  c.ok('but every filled cell still says who it is, to a screen reader',
    (() => {
      const links = [...table.querySelectorAll('tbody td[data-pid] a.pref')];
      return links.length > 0 && links.every((a) =>
        /^.+ (is this squad’s|fills) [A-Z/]+\d? in week \d+/
          .test(a.getAttribute('aria-label') || ''));
    })(),
    [...table.querySelectorAll('tbody td[data-pid] a.pref')][0]?.getAttribute('aria-label'));

  // ---- the playoff line ----------------------------------------------------
  {
    const ths = [...table.querySelectorAll('thead th')];
    const lined = ths.map((th, i) => (isPo(th.getAttribute('class')) ? i : -1)).filter((i) => i >= 0);
    const col = weekCol(PLAYOFF_WEEKS[0]);
    c.ok('SEASON GRID: the playoff line is on week 14\u2019s header, and only there',
      lined.length === 1 && lined[0] === col, JSON.stringify(lined));
    c.ok('SEASON GRID: and on every row\u2019s week-14 cell, the totals band included',
      rows.length > 0 && rows.every((r) => isPo(r.cells[col].cls) &&
        r.cells.filter((x) => isPo(x.cls)).length === 1) &&
      Boolean(totals) && isPo(totals.cells[col].cls),
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.cls)));
    // Avg is the REGULAR season: re-derived from the rendered weeks 1–13.
    const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const nums = (cells) => cells.map((x) => x.v).filter((v) => v !== null && v !== '').map(Number);
    let wrong = 0;
    let moved = 0;
    for (const r of [...rows, ...(totals ? [totals] : [])]) {
      const shown = r.cells[1].v === null ? null : Number(r.cells[1].v);
      const regular = mean(nums(r.cells.slice(2, col)));
      const all = mean(nums(r.cells.slice(2)));
      if (shown !== regular) wrong++;
      if (regular !== null && all !== null && regular !== all) moved++;
    }
    c.ok('SEASON GRID: AVG IGNORES THE PLAYOFF WEEKS, in the band as well as the slots',
      wrong === 0, `${wrong} rows disagree`);
    if (rows.some((r) => nums(r.cells.slice(col)).length)) {
      c.ok('SEASON GRID: and the playoff weeks would have moved it, so that has teeth',
        moved > 0, String(moved));
    }
  }
  c.ok('Avg sits immediately before the week run', head[1] === 'Avg', JSON.stringify(head));
  c.ok('every header is sortable',
    [...table.querySelectorAll('thead th')].every((th) => th.hasAttribute('data-sort')),
    [...table.querySelectorAll('thead th')].filter((th) => !th.hasAttribute('data-sort')).length);
  c.ok('the table lives inside a .table-scroll',
    $('seasonWrap').getAttribute('class').includes('table-scroll'), $('seasonWrap').getAttribute('class'));
  c.ok('the slot cell uses the sticky name treatment, so it freezes on a phone',
    rows.length > 0 && rows.every((r) => /\bname\b/.test(r.cells[0].cls)),
    rows[0] && rows[0].cells[0].cls);
  c.ok('the slot column sorts on lineup order, not on its label',
    rows.every((r) => /^\d+$/.test(r.cells[0].v || '')), rows[0] && rows[0].cells[0].v);

  // ---- the totals band: the Roster detail's own band, reused --------------
  //
  // Tim: "below the last starter, make a starting lineup line with the added up
  // totals of the proj every week, just like how it's displayed in the roster
  // detail box." Same `tbody.split`, same label, and a body of one row is what
  // sortable.js leaves alone \u2014 which is what pins it under the last slot.
  c.ok('THE BAND IS A TBODY OF ITS OWN, so a sort cannot fold it into the slots',
    JSON.stringify([...table.querySelectorAll('tbody')].map((b) => b.getAttribute('id'))) ===
      JSON.stringify(['seasonSlots', 'seasonTotals']),
    JSON.stringify([...table.querySelectorAll('tbody')].map((b) => b.getAttribute('id'))));
  c.ok('and it is the same `split` band the Roster detail draws',
    table.querySelector('tbody#seasonTotals').getAttribute('class') === 'split' &&
    d.querySelector('#rosterSplit').getAttribute('class') === 'split',
    table.querySelector('tbody#seasonTotals').getAttribute('class'));
  c.ok('labelled the way that one is', totals && totals.label === 'Starting lineup',
    totals && totals.label);
  c.ok('THE BAND IS THE SLOT CELLS ADDED UP, WEEK BY WEEK',
    (() => {
      if (!totals) return false;
      for (let i = 2; i < totals.cells.length; i++) {
        const parts = rows.map((r) => r.cells[i].v).filter((v) => v !== null).map(Number);
        const want = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10 : null;
        const got = totals.cells[i].v === null ? null : Number(totals.cells[i].v);
        if (want === null ? got !== null : Math.abs(got - want) > 0.051) return false;
      }
      return true;
    })(), JSON.stringify(totals && totals.cells.map((x) => x.v)));

  // ---- the shared red/green scale, and it is never colour alone ------------
  //
  // REWRITTEN 2026-09-19. Every assertion here USED to be about the two low
  // marks (amber below 1 SD, red below 2, nothing at all for a good number) and
  // every one of them would now fail: there are no `lo1`/`lo2` classes left,
  // and the panel deliberately DOES colour a cell for being good, which the
  // third assertion below used to forbid in so many words.
  c.ok('no cell carries the waiver page\u2019s green class',
    d.querySelectorAll('.hot').length === 0 && !/\bhot\b/.test(d.body.innerHTML),
    d.querySelectorAll('.hot').length);
  c.ok('THE OLD TWO-STEP LOW MARK IS GONE, not merely unused',
    d.querySelectorAll('td.lo1, td.lo2, .lowmark').length === 0 &&
    !/\blo[12]\b|lowmark/.test(d.body.innerHTML),
    d.querySelectorAll('td.lo1, td.lo2, .lowmark').length);
  // Skipped on `thin-slot` alone, and for a reason worth knowing: that
  // scenario hands every squad the SAME value at a slot, so the whole league's
  // spread is a rounding error and the one team on screen happens to sit under
  // the mean at every slot. Everywhere else a squad has good weeks as well as
  // bad ones, and the panel has to colour both.
  if (scenario !== 'thin-slot') {
    c.ok('A GOOD WEEK IS NOW COLOURED TOO, which the old marks never did',
      table.querySelectorAll('td.heat-up-1, td.heat-up-2, td.heat-up-3, td.heat-up-4').length > 0,
      `${table.querySelectorAll('[class*="heat-up"]').length} good cells`);
    c.ok('and a poor one still is',
      table.querySelectorAll('td.heat-dn-1, td.heat-dn-2, td.heat-dn-3, td.heat-dn-4').length > 0,
      `${table.querySelectorAll('[class*="heat-dn"]').length} poor cells`);
  }
  c.ok('no week cell borrows another panel\u2019s colour vocabulary',
    rows.every((r) => r.cells.slice(2).every((td) =>
      !/\b(hot|good|pos|neg|st-out|st-ir|st)\b/.test(td.cls))),
    JSON.stringify(rows[0] && rows[0].cells.slice(2).map((x) => x.cls)));
  // NEVER COLOUR ALONE, on the two channels the DOM can see: the glyph at the
  // end of the scale, and the fact that it points the right way.
  c.ok('EVERY CELL AT THE END OF THE SCALE CARRIES A GLYPH AS WELL AS A COLOUR',
    [...table.querySelectorAll('td.heat-up-4, td.heat-dn-4')]
      .every((td) => td.querySelector('.heatmark')),
    `${table.querySelectorAll('td.heat-up-4, td.heat-dn-4').length} end cells, ` +
    `${table.querySelectorAll('td.heat-up-4 .heatmark, td.heat-dn-4 .heatmark').length} marked`);
  c.ok('pointing up on the good side and down on the poor one',
    [...table.querySelectorAll('td.heat-up-4 .heatmark')].every((s) => txt(s) === '\u25b2') &&
    [...table.querySelectorAll('td.heat-dn-4 .heatmark')].every((s) => txt(s) === '\u25bc'),
    [...table.querySelectorAll('.heatmark')].map((s) => txt(s)).join('|').slice(0, 60));
  c.ok('AND ONLY THERE \u2014 a step-3 cell is tinted but unmarked, or the table is noise',
    [...table.querySelectorAll('td.heat-up-3, td.heat-dn-3, td.heat-up-1, td.heat-dn-1')]
      .every((td) => !td.querySelector('.heatmark')),
    `${table.querySelectorAll('td.heat-up-3 .heatmark, td.heat-dn-3 .heatmark').length} marked`);
  c.ok('the glyph is hidden from a screen reader, which gets the words instead',
    [...table.querySelectorAll('.heatmark')].every((s) => s.getAttribute('aria-hidden') === 'true'),
    [...table.querySelectorAll('.heatmark')].map((s) => s.getAttribute('aria-hidden')).join(','));
  c.ok('no cell is two steps at once',
    [...table.querySelectorAll('td[class*="heat-"]')].every((td) =>
      (td.getAttribute('class').match(/heat-(?:up|dn)-\d|heat-0/g) || []).length === 1),
    JSON.stringify([...table.querySelectorAll('td[class*="heat-"]')]
      .map((td) => td.getAttribute('class')).slice(0, 3)));
  // ---- THE TOTALS BAND IS ON THE SCALE TOO, since 2026-09-19b -------------
  //
  // This used to assert the opposite \u2014 "the totals band is never on the scale,
  // it is not a slot" \u2014 and that was right about the SLOT scale and wrong about
  // the band. Tim: "the coloring ... needs to be added to all the other places
  // a number is referred to across the whole site." A band cell is a whole
  // starting lineup, and ten whole starting lineups in the same week are as
  // honest a comparison group as ten quarterbacks are. Deliberate replacement,
  // not a deletion.
  //
  // What must still hold, and is the point of the assertions below: the band is
  // measured DOWN THE LEAGUE IN ONE WEEK, never across its own row. One scale
  // along the row would be comparing week 4 with week 12 and would paint a
  // bye-heavy week red for every squad at once.
  //
  // `varied` names the scenarios whose ten squads genuinely differ \u2014 the
  // demo-data ones. "There is colour here" can only be demanded of those: the
  // live stub gives every squad IDENTICAL projections, so ten whole lineups are
  // ten copies of one number and `HEAT_MIN_SPREAD` refuses the column outright,
  // which is the flat guard working rather than the feature missing. The
  // INVARIANTS below are asserted everywhere, varied or not.
  const varied = ['demo', 'avg-heat', 'week-heat', 'season-slots'].includes(scenario);
  if (totals) {
    const band = totals.cells.slice(2);
    const bandAvg = totals.cells[1];
    if (varied) {
      c.ok('THE BAND\u2019S WEEK CELLS ARE ON THE SCALE, and its Avg with them',
        band.some((x) => /heat-(up|dn)-\d/.test(x.cls)) &&
        (/\bheat\b/.test(bandAvg.cls) || bandAvg.v === null),
        JSON.stringify(totals.cells.map((x) => x.cls)).slice(0, 220));
    }
    c.ok('a band cell with no number is never coloured',
      totals.cells.filter((x) => x.v === null || x.v === '')
        .every((x) => !/heat-(up|dn)/.test(x.cls)),
      JSON.stringify(totals.cells.map((x) => `${x.v}:${x.cls}`)).slice(0, 220));
    c.ok('no band cell is two steps at once',
      totals.cells.every((x) => (x.cls.match(/heat-(?:up|dn)-\d|heat-0/g) || []).length <= 1),
      JSON.stringify(totals.cells.map((x) => x.cls)).slice(0, 200));
    // THAT THE GROUP IS THE WEEK COLUMN AND NOT THE ROW cannot be proved from
    // this table alone \u2014 the other nine squads' totals are not on screen \u2014 so
    // it is proved in the `season-slots` scenario by walking the team picker
    // and checking the ordering WITHIN each week against the colours. See
    // "THE BAND'S GROUP IS THE WEEK COLUMN" there.
  }

  // ---- THE AVG COLUMN IS ON THE SCALE TOO, on a scale of its OWN ----------
  //
  // Also new on 2026-09-19b, and also a reversal: the note used to say in as
  // many words that Avg was "deliberately left uncoloured". What was right in
  // that argument survives as the thing asserted here \u2014 Avg is NOT on the week
  // cells' scale. It is on the ten-squads-at-this-slot scale, which is the very
  // one the all-teams grid draws, and the `grids` scenario proves the two
  // panels agree number for number.
  {
    const avgCells = rows.map((r) => r.cells[1]);
    const numbered = avgCells.filter((x) => x.v !== null && x.v !== '');
    if (varied) {
      c.ok('EVERY AVG CELL WITH A NUMBER HAS BEEN MEASURED (the class is there)',
        numbered.length > 0 && numbered.every((x) => /\bheat\b/.test(x.cls)),
        JSON.stringify(avgCells.map((x) => `${x.v}:${x.cls}`)).slice(0, 200));
      c.ok('and the column really is coloured, not merely measured',
        avgCells.some((x) => /heat-(up|dn)-\d/.test(x.cls)),
        JSON.stringify(avgCells.map((x) => x.cls)).slice(0, 200));
    }
    c.ok('and an Avg with no number is never coloured',
      avgCells.filter((x) => x.v === null || x.v === '')
        .every((x) => !/heat-(up|dn)/.test(x.cls)),
      JSON.stringify(avgCells.map((x) => `${x.v}:${x.cls}`)).slice(0, 200));
    c.ok('no Avg cell is two steps at once',
      avgCells.every((x) => (x.cls.match(/heat-(?:up|dn)-\d|heat-0/g) || []).length <= 1),
      JSON.stringify(avgCells.map((x) => x.cls)).slice(0, 200));
    c.ok('an Avg at the end of the scale carries the glyph, and only there',
      avgCells.filter((x) => /heat-(up|dn)-4/.test(x.cls)).every((x) => /[\u25b2\u25bc]/.test(x.text)) &&
      avgCells.filter((x) => /heat-(up|dn)-[123]\b/.test(x.cls)).every((x) => !/[\u25b2\u25bc]/.test(x.text)),
      JSON.stringify(avgCells.map((x) => `${x.cls}|${x.text}`)).slice(0, 200));
    c.ok('and every Avg cell says in words what it was measured against \u2014 it is a <td> ' +
      'with no link in it, so a title is the right place and touch-titles makes it a tap',
      numbered.every((x) => /in an average week/.test(x.title || '')),
      numbered[0] && numbered[0].title);
  }

  // ---- the name line: outside the table, reserved, idle until pointed at ---
  c.ok('the name line is above the table, not inside it',
    Boolean($('seasonPick')) && !$('seasonWrap').contains($('seasonPick')), 'no #seasonPick');
  c.ok('and while nothing is named it says what to do with it',
    /Hover or tap a number to name the player/.test(txt($('seasonPick'))), txt($('seasonPick')));
  // TWO THRESHOLDS A SLOT NOW, NOT ONE (2026-09-19). The scale runs both ways,
  // so the green end has to be checkable by hand as well as the red — the
  // single "Low below" line could not say where a cell turned green because
  // nothing ever did.
  //
  // AND SINCE 2026-09-19c THE STRIPS ARE INSIDE "How this table works". Each
  // assertion below checks the LAYER as well as the words: the thresholds
  // behind the toggle, the short cue line in view. The two strips were 73 of
  // this page's 346 visible words while they sat under the table
  // (`node tests/text-audit.mjs`), and a test that only asked "is this text
  // somewhere on the page" would let them drift back out.
  c.ok('THE THRESHOLDS THEMSELVES SURVIVE, so a coloured cell can be checked by hand',
    /Week cells, full colour at \(red \/ green\)/.test(txt($('seasonBars'))) &&
    SLOT_ROWS.every((s) => txt($('seasonBars')).includes(s)),
    txt($('seasonBars')));
  c.ok('and they are INSIDE the “How this table works” toggle, not under the table',
    Boolean($('seasonBars').closest('details.explain')) &&
    Boolean($('seasonAvgBars').closest('details.explain')),
    'a bars line is outside details.explain');
  if ($('seasonTable').querySelector('td.heat')) {
    c.ok('THE VISIBLE KEY STILL CARRIES THE HUE-FREE CUES and says where the points are',
      /arrow/.test(txt($('seasonLegend'))) && /heavier type/.test(txt($('seasonLegend'))) &&
      /toggle below/.test(txt($('seasonLegend'))),
      txt($('seasonLegend')));
    c.ok('and the visible key does NOT repeat the thresholds',
      !/full colour at/i.test(txt($('seasonLegend'))) &&
      Boolean($('seasonLegend')) && !$('seasonLegend').closest('details'),
      txt($('seasonLegend')));
  }
  // TWO SCALES, TWO LINES (2026-09-19b). The Avg column is measured against the
  // other nine squads' Avg at that slot, not against ~160 weekly values, so its
  // thresholds are different numbers and go on a line of their own. One line
  // holding both would invite checking a cell against the wrong pair, which is
  // the misreading js/heat.js section 1 exists to prevent.
  // THE LINE IS THERE EXACTLY WHEN THERE IS SOMETHING TO CHECK. A table that
  // colours nothing — every column flat, which is the live stub — gets no
  // "full colour at" line, because a threshold line for colours that do not
  // exist is a promise it cannot keep. A table that colours anything must
  // carry it, or a reader has no way to check a cell by hand.
  {
    const anyAvgColour = rows.some((r) => /\bheat\b/.test(r.cells[1].cls)) ||
      (totals && /\bheat\b/.test(totals.cells[1].cls));
    if (anyAvgColour) {
      c.ok('AND THE AVG COLUMN’S OWN THRESHOLDS ARE ON A SECOND LINE, never mixed in',
        /Avg column, full colour at \(red \/ green\)/.test(txt($('seasonAvgBars'))) &&
        !/Avg column/.test(txt($('seasonBars'))),
        txt($('seasonAvgBars')));
      c.ok('and that second line covers every slot plus the whole lineup',
        SLOT_ROWS.every((s) => txt($('seasonAvgBars')).includes(s)) &&
        /Lineup/.test(txt($('seasonAvgBars'))),
        txt($('seasonAvgBars')));
    } else {
      c.ok('a table that colours no average carries no threshold line for one',
        txt($('seasonAvgBars')) === '', txt($('seasonAvgBars')));
    }
  }

  // ---- player references: every name, and every number standing for one ----
  //
  // Tim: "if you ever click on a player's name (or a number that refers to the
  // player), it will bring you directly to their position in the players
  // section". The contract is a real <a class="pref" href="waivers.html?
  // player=<espnPlayerId>">, and these run in every scenario.
  const refs = [...d.querySelectorAll('a.pref')];
  const href = (a) => a.getAttribute('href') || '';
  // WHICH MEASURE THE GRID IS ON decides whether it is a surface that names
  // players at all. Since 2026-09-19 its Proj avg setting has one column per
  // LINEUP SLOT averaged over the season, and an average over fourteen weeks is
  // usually several men — so it names nobody and links nobody, deliberately.
  // Read off the lit button rather than passed in, so every scenario gets the
  // right half of this contract without having to say which it is.
  const litButton = d.querySelector('#measureToggle button.on');
  const onAvg = Boolean(litButton) && litButton.getAttribute('data-measure') === 'avg';
  // One all-teams grid since 2026-09-17, not two. If a second grid-shaped table
  // ever comes back it belongs in this list, because the click-through contract
  // is per SURFACE and a surface nobody listed is a surface nobody checked.
  const SURFACES = ['#rosterTable', '#seasonTable'].concat(onAvg ? [] : ['#overviewTable']);

  c.ok('the page emits player reference links at all', refs.length > 0, `${refs.length}`);
  c.ok('EVERY SURFACE THAT NAMES A PLAYER LINKS HIM',
    SURFACES.every((s) => d.querySelectorAll(`${s} tbody a.pref`).length > 0),
    SURFACES.map((s) => `${s}=${d.querySelectorAll(`${s} tbody a.pref`).length}`).join(' '));
  // And the other half, which is the one that could rot silently: a slot
  // average that quietly acquired a link would be pointing at whichever of its
  // several men happened to be first, which looks perfectly fine on screen.
  if (onAvg) {
    c.ok('THE SLOT-AVERAGE GRID LINKS NOBODY, because a slot is not a player',
      d.querySelectorAll('#overviewTable tbody a.pref').length === 0 &&
      d.querySelectorAll('#overviewTable tbody [data-tip]').length === 0,
      `${d.querySelectorAll('#overviewTable tbody a.pref').length} links, ` +
      `${d.querySelectorAll('#overviewTable tbody [data-tip]').length} cards`);
    c.ok('and answers "who is that" in a title instead, which a tap opens on a phone',
      (() => {
        const cells = [...d.querySelectorAll('#overviewTable tbody td.slot-avg')];
        return cells.length > 0 && cells.every((td) => td.hasAttribute('title'));
      })(), 'a slot-average cell with nothing to say');
  }
  c.ok('every reference is a real href, not a click handler',
    refs.every((a) => /^waivers\.html\?player=\d+$/.test(href(a))),
    refs.map(href).filter((h) => !/^waivers\.html\?player=\d+$/.test(h)).slice(0, 3).join(' | '));
  c.ok('the href is relative, so it works from the repo root the pages share',
    refs.every((a) => !/^(https?:)?\/\//.test(href(a)) && !href(a).startsWith('/')),
    refs.map(href).filter((h) => /^\/|^https?:/.test(h)).slice(0, 2).join(' | '));
  const says = (a) => `${a.getAttribute('title') || ''}${a.getAttribute('aria-label') || ''}`;
  c.ok('NO LINK IS EVER EMITTED FOR A PLAYER WITH NO ID',
    !/player=(undefined|null|NaN|&quot;|")/.test(d.body.innerHTML),
    (d.body.innerHTML.match(/player=[^"']{0,12}/g) || [])
      .filter((h) => !/^player=\d+$/.test(h)).slice(0, 3).join(' | '));
  c.ok('every reference says where it goes, in the site\u2019s voice',
    refs.every((a) => /open his next 13 weeks on the Players page/.test(says(a))),
    refs.find((a) => !/open his next 13 weeks/.test(says(a)))?.outerHTML);
  // `title` on the names, `aria-label` on the grid numbers: those cells draw a
  // tip card of their own now, and a `title` beside it would have the browser
  // put a second tooltip on top a moment later. Either way the link says where
  // it goes; only one of them draws anything.
  c.ok('a grid number says it without a title, so it cannot double the card',
    [...d.querySelectorAll('table.grid td.slot-cell a.pref')]
      .every((a) => !a.hasAttribute('title') && a.hasAttribute('aria-label')),
    'a grid link still carries a title');
  c.ok('and neither does the cell under it',
    d.querySelectorAll('table.grid td.slot-cell[title]').length === 0,
    `${d.querySelectorAll('table.grid td.slot-cell[title]').length} cells still titled`);
  c.ok('a link is never put inside the swap button, which would be invalid HTML',
    d.querySelectorAll('button a.pref').length === 0 &&
    d.querySelectorAll('a.pref button').length === 0,
    `${d.querySelectorAll('button a.pref').length}`);
  c.ok('the swap button is untouched \u2014 still a button carrying data-swap',
    [...d.querySelectorAll('#rosterTable button[data-swap]')].length > 0 ||
    rosterRows.length === 0,
    'no swap buttons left');

  // The sort key must stay on the cell. Inside an anchor it would be invisible
  // to sortable.js and every column in the grid would silently stop sorting.
  const keyed = [...d.querySelectorAll('#overviewTable tbody td[data-v], ' +
    '#seasonTable tbody td[data-v], #rosterTable tbody td[data-v]')];
  c.ok('THE SORT KEY STAYS ON THE CELL, OUTSIDE THE LINK',
    keyed.length > 0 &&
    d.querySelectorAll('a.pref[data-v]').length === 0 &&
    d.querySelectorAll('a.pref [data-v]').length === 0,
    `${keyed.length} keyed cells, ` +
    `${d.querySelectorAll('a.pref[data-v], a.pref [data-v]').length} keys inside links`);

  // Wrapping must not change a single character of what the tables read, which
  // is what lets every existing text assertion above stand unaltered.
  const gridCells = [...d.querySelectorAll('#overviewTable tbody td.slot-cell')]
    .filter((td) => td.querySelector('a.pref'));
  if (!onAvg) {
    c.ok('a grid link wraps the WHOLE cell, so the number itself is the target',
      gridCells.length > 0 && gridCells.every((td) => td.querySelector('a.pref').textContent === td.textContent),
      gridCells.slice(0, 2).map((td) => `[${td.textContent}] vs [${td.querySelector('a.pref').textContent}]`).join(' '));
    c.ok('a bench cell keeps its position inside the link, beside the number it labels',
      (() => {
        const bench = gridCells.filter((td) => td.querySelector('.pp'));
        return bench.length > 0 && bench.every((td) => td.querySelector('a.pref .pp'));
      })(), 'a .pp span outside its link');
  }
  c.ok('the roster detail links the name and nothing else in the cell',
    (() => {
      const cells = [...d.querySelectorAll('#rosterTable tbody td.name')];
      // (scenario (g) has one man per team with no id, and so no link at all)
      const linked = cells.filter((td) => td.querySelector('a.pref'));
      return linked.length > 0 &&
        linked.every((td) => td.querySelector('a.pref').textContent === td.textContent);
    })(), 'a name cell whose link does not cover it');
  // The season panel's numbers stand for a man, so each is a link \u2014 and, since
  // Tim's 2026-09-18 change, NOTHING ELSE: no `data-tip`, because this panel
  // draws no card ("we don't need to be providing the 14 week preview"), and
  // still no `title`, because the cell's content is a link and
  // js/touch-titles.js leaves links alone, which would make a title here a
  // desktop-only explanation. Who he is lives on the line above the table.
  c.ok('every filled season cell is a link and nothing else \u2014 no card, no title',
    (() => {
      const cells = [...d.querySelectorAll('#seasonTable tbody td[data-pid]')];
      return cells.length > 0 && cells.every((td) =>
        td.querySelector('a.pref') && !td.hasAttribute('data-tip') && !td.hasAttribute('title'));
    })(),
    `${d.querySelectorAll('#seasonTable tbody td[data-pid]').length} filled, ` +
    `${d.querySelectorAll('#seasonTable tbody td[data-pid][data-tip]').length} still carry a card, ` +
    `${d.querySelectorAll('#seasonTable tbody td[data-pid][title]').length} still titled`);
  c.ok('and the link wraps the whole cell, mark and all',
    [...d.querySelectorAll('#seasonTable tbody td[data-pid]')]
      .every((td) => td.querySelector('a.pref').textContent === td.textContent),
    'a season cell whose link does not cover it');
  c.ok('the pid on the cell is ESPN\u2019s own id, the same one the link carries',
    [...d.querySelectorAll('#seasonTable tbody td[data-pid]')].every((td) =>
      td.querySelector('a.pref').getAttribute('href') ===
      `waivers.html?player=${td.getAttribute('data-pid')}`),
    'a cell whose data-pid and href disagree');

  // ---- the note ----------------------------------------------------------
  c.ok('the note says these are ESPN\u2019s own per-week projections',
    /ESPN\u2019s own projection for that player in that week/.test(note) ||
    /generated sample rosters and generated projections/.test(note), note);
  c.ok('the note explains a Bye against a dash',
    /Bye/.test(note) && /0\.00 ESPN returns/.test(note) && /A dash is not that/.test(note), note);
  c.ok('the note says which weeks are covered',
    /Covering weeks 1\u201313 \u2014 13 weeks this season runs to/.test(note), note);
  c.ok('THE NOTE SAYS THE ROWS ARE SLOTS, AND WHO FILLS ONE',
    /Each row is a lineup slot, not a player/.test(note) &&
    /best legal lineup/.test(note) &&
    /WR1<\/strong> is the best receiver in that week\u2019s lineup/.test($('seasonNote').innerHTML),
    note);
  c.ok('and that FLEX is whoever the flex actually is',
    /FLEX<\/strong> is whoever the flex actually is/.test($('seasonNote').innerHTML), note);
  c.ok('the note says what the band adds up',
    /in the band under the last slot, is those slots added up for that week/.test(note), note);
  // THE SHARED RED/GREEN SCALE replaced the two low marks on 2026-09-19 (Tim:
  // "it will replace the current system we have with the colorization of the
  // season week by week box"). What the note has to own is unchanged in kind
  // and changed in content: where the distribution comes from, and that it is
  // the LEAGUE's rather than his own roster's.
  c.ok('THE NOTE OWNS THE SCALE AS A LEAGUE-WIDE STANDARD DEVIATION, not his own roster',
    /Green is a good number for that slot and red is a poor one/.test(note) &&
    /reaching full colour one standard deviation out/.test(note) &&
    /every squad in the league/.test(note) &&
    /not against your own roster/.test(note), note);
  c.ok('and says the printed thresholds are the ones the colour is decided against',
    /rounded to the tenth, which is exactly the number the colour is decided against/.test(note),
    note);
  c.ok('AND SAYS A GOOD NUMBER IS COLOURED TOO, which the old marks never did',
    /colours both directions/.test(note) &&
    /easier to be in green\/red/.test(note), note);
  c.ok('the note owns Avg as the regular season only',
    /Avg<\/strong> is the mean of the regular-season columns that carry a number/
      .test($('seasonNote').innerHTML), note);
  c.ok('and says the roster detail\u2019s what-if is deliberately not applied here',
    /deliberately not applied here/.test(note), note);

  // ---- (a) demo -----------------------------------------------------------
  if (scenario === 'demo') {
    c.ok('badge says Demo', txt($('modeBadge')) === 'Demo', txt($('modeBadge')));
    c.ok('the demo grid is fully filled in — no week left pending',
      rows.every((r) => r.cells.slice(2).every((td) => !/\bwait\b/.test(td.cls))),
      'pending cells present');
    c.ok('no progress line in demo, because nothing is fetched',
      txt($('seasonProgress')) === '', txt($('seasonProgress')));
    c.ok('the note admits the numbers are generated',
      /generated sample rosters and generated projections/.test(note), note);
    c.ok('every demo slot has an average', rows.every((r) => r.cells[1].v !== null),
      rows.filter((r) => r.cells[1].v === null).length);
    c.ok('the title names the team', /^Season by week \u00b7 .+/.test(txt($('seasonTitle'))),
      txt($('seasonTitle')));
    // The sample data means "ruled out" by a zero, not "on bye", so it must not
    // claim a bye it does not have.
    c.ok('demo never claims a bye it cannot know about',
      rows.every((r) => r.cells.slice(2).every((td) => td.text !== 'Bye')), 'a Bye cell in demo');
    c.ok('the demo note says what a zero means here',
      /in the sample data a zero only means he is ruled out/.test(note), note);

    // The grid follows the same rule, and demo is the mode Tim sees first.
    const gridCells = (id) =>
      [...d.querySelectorAll(`#${id}Table tbody td`)].map((td) => td.textContent.trim());
    c.ok('the grid never claims a bye in demo, where a zero means something else',
      !gridCells('overview').includes('Bye'), 'a Bye cell in a demo grid');
    c.ok('a demo zero is printed as the number it is',
      gridCells('overview').some((t) => t === '0.0' || /^0\.0 [A-Z]/.test(t)),
      'no zero cell in the demo grid at all');

    // ---- THE MERGED PANEL, in the mode Tim sees first ---------------------
    //
    // One box, with the week picker and the measure switch in it, opening on a
    // WEEK rather than on the season average — which is the default Tim's
    // "select which week they want" asks for and the same rule openingWeek()
    // follows. Pressing the other button must give the season-average table the
    // second panel used to give, with no second panel anywhere on the page.
    c.ok('THERE IS EXACTLY ONE ALL-TEAMS GRID',
      d.querySelectorAll('table.grid').length === 1 && !d.getElementById('weeklyTable'),
      `${d.querySelectorAll('table.grid').length} grids, weeklyTable=${!!d.getElementById('weeklyTable')}`);
    c.ok('the panel opens on a WEEK, and says which',
      /^All teams · week \d+$/.test(txt($('overviewTitle'))), txt($('overviewTitle')));
    c.ok('the week picker is inside that panel, not in Data source',
      d.querySelector('#overviewWrap').closest('section.panel').contains($('weekSelect')) &&
      !d.querySelector('#sourceToggle').closest('section.panel').contains($('weekSelect')),
      'the week picker is in the wrong panel');
    {
      const avg = d.querySelector('#measureToggle button[data-measure="avg"]');
      const wkBtn = d.querySelector('#measureToggle button[data-measure="week"]');
      const weekBefore = $('weekSelect').value;
      c.ok('the measure switch offers the two measures and names the season on one',
        !!avg && !!wkBtn && /^Proj avg \d{4}$/.test(txt(avg)), avg && txt(avg));
      avg.dispatchEvent(new boot.window.Event('click', { bubbles: true }));
      c.ok('PRESSING PROJ AVG RE-HEADS THE SAME PANEL AS A SEASON AVERAGE',
        txt($('overviewTitle')).startsWith('All teams · proj avg'), txt($('overviewTitle')));
      c.ok('and no bye can survive on an average — only a week has one',
        !gridCells('overview').includes('Bye'), 'a Bye on the season average');
      c.ok('the week picker is untouched by the measure',
        $('weekSelect').value === weekBefore, `${weekBefore} -> ${$('weekSelect').value}`);
      wkBtn.dispatchEvent(new boot.window.Event('click', { bubbles: true }));
      c.ok('and pressing A week puts the week back in the heading',
        /^All teams · week \d+$/.test(txt($('overviewTitle'))), txt($('overviewTitle')));
    }

    // ---- the week run on the hover, in the mode Tim sees first ------------
    const tipCells = [...d.querySelectorAll('#overviewTable tbody td[data-tip]')];
    c.ok('every grid cell has a card to draw', tipCells.length > 0, `${tipCells.length}`);

    const cards = tipCells.map((td) => hoverCard(d, boot.window, td));
    c.ok('every grid cell hover draws a week run, in demo too',
      cards.every((k) => k && k.weeks.length === 16 && k.values.length === 16),
      JSON.stringify(cards[0] && { w: cards[0].weeks.length, v: cards[0].values.length }));
    c.ok('and it is honest about whose numbers they are',
      cards.every((k) => /Sample projections for weeks 1–16/.test(k.heading)), cards[0].heading);
    c.ok('never claiming they are ESPN’s',
      cards.every((k) => !/ESPN’s projection/.test(k.heading)), cards[0].heading);
    c.ok('THE DEMO RUN NEVER CLAIMS A BYE, because a zero means something else here',
      cards.every((k) => !k.values.includes('Bye')),
      JSON.stringify(cards.find((k) => k.values.includes('Bye'))));
    c.ok('the run is filled in, not thirteen unread weeks',
      cards.every((k) => !k.pending), cards.find((k) => k.pending)?.pending);
    c.ok('the card still opens with the identity line it always had',
      cards.every((k) => /^.+ · (QB|RB|WR|TE|DST|K) · [A-Z]{2,4}/.test(k.ident)), cards[0].ident);
  }

  // ---- (b) live, every week resolves --------------------------------------
  if (scenario.startsWith('live') || scenario === 'team-switch') {
    c.ok('badge says Live', txt($('modeBadge')) === 'Live', txt($('modeBadge')));
  }

  // The detailed cell checks read the live DOM, so they only make sense in the
  // scenario that has not been clicked about in afterwards.
  if (scenario === 'live') {
    const season = await import('./an-stub-season.mjs');
    // Since 2026-09-16 a live league opens on the COMING week — the first with
    // no result on the schedule (the stub has results through week 7) — rather
    // than the last one played.
    c.ok('the page opened on the first week not yet played',
      txt($('overviewTitle')).endsWith(`week ${season.SCHEDULE_PLAYED_THROUGH + 1}`),
      txt($('overviewTitle')));

    // The playoff weeks cost one request each, like any other week.
    c.ok('the season grid costs exactly one request per week, the playoff weeks included',
      JSON.stringify(season.calls.weeks.slice().sort((a, b) => a - b)) ===
        JSON.stringify(Array.from({ length: 16 }, (_, i) => i + 1)),
      JSON.stringify(season.calls.weeks));
    c.ok('the selected week is still fetched by the panels above, once',
      JSON.stringify(season.calls.week) === JSON.stringify([8]), JSON.stringify(season.calls.week));
    c.ok('the progress line clears once every week has landed',
      txt($('seasonProgress')) === '', txt($('seasonProgress')));

    // ---- THE SLOTS, RE-DERIVED FROM THE STUB ------------------------------
    //
    // Not read back off the page: every week's teams are rebuilt here from the
    // stub's own raw numbers, solved with forecast.js's REAL optimalLineup, and
    // then ranked inside each slot the way the panel claims to rank them. A
    // panel that filled the wrong man into WR2 confidently would agree with
    // itself all day, and this is what stops it.
    const { optimalLineup, slotsFromCounts } = await import('../js/forecast.js');
    const { slotCountsFromLineups } = await import('../js/projection.js');
    const teamId = 4;
    const squad = (team, week) => {
      const out = [];
      for (let i = 0; i < season.SIZE; i++) {
        if (!season.onRoster(i, week)) continue;
        out.push({
          playerId: team * 100 + i,
          name: season.playerName(team, i),
          position: season.POS[i],
          lineupSlotId: season.SLOTS[i],
          started: season.SLOTS[i] !== 20,
          projected: season.projFor(i, week),
        });
      }
      return out;
    };
    const wantSlots = slotsFromCounts(slotCountsFromLineups([{ players: squad(teamId, 8) }]));
    c.ok('the stub league starts exactly the nine slots the panel draws',
      wantSlots.length === SLOT_ROWS.length, JSON.stringify(wantSlots));

    /** slot key -> {id, v} for one team in one week, built independently. */
    const wantFill = (team, week) => {
      const { starters } = optimalLineup(squad(team, week), wantSlots);
      const bySlot = new Map();
      for (const s of starters) {
        if (!bySlot.has(s.slotId)) bySlot.set(s.slotId, []);
        bySlot.get(s.slotId).push(s);
      }
      for (const list of bySlot.values()) {
        list.sort((a, b) => b.projected - a.projected || a.playerId - b.playerId);
      }
      const counts = new Map();
      const out = new Map();
      // The slot ids in the same lineup order the labels are in.
      const order = [0, 2, 2, 4, 4, 6, 23, 16, 17];
      order.forEach((slotId, i) => {
        const n = (counts.get(slotId) || 0) + 1;
        counts.set(slotId, n);
        const pick = (bySlot.get(slotId) || [])[n - 1] || null;
        out.set(SLOT_ROWS[i], pick ? { id: pick.playerId, v: Math.round(pick.projected * 10) / 10 } : null);
      });
      return out;
    };

    const bySlotRow = new Map(rows.map((r) => [r.cells[0].text, r]));
    const wrongSlot = [];
    for (let w = 1; w <= 16; w++) {
      const want = wantFill(teamId, w);
      for (const key of SLOT_ROWS) {
        const td = bySlotRow.get(key).cells[weekCol(w)];
        const e = want.get(key);
        if (!e) {
          if (td.v !== null) wrongSlot.push(`${key} wk${w} want empty got ${td.v}`);
          continue;
        }
        if (Math.abs(Number(td.v) - e.v) > 0.051) wrongSlot.push(`${key} wk${w} want ${e.v} got ${td.v}`);
        if (td.pid !== String(e.id)) wrongSlot.push(`${key} wk${w} want #${e.id} got #${td.pid}`);
      }
    }
    c.ok('EVERY SLOT, EVERY WEEK, HOLDS THE MAN THE BEST LEGAL LINEUP PUTS THERE',
      wrongSlot.length === 0, wrongSlot.slice(0, 6).join(' | '));

    // The claim Tim actually made, stated on its own so it cannot pass by
    // accident: WR1 is the best receiver of that week's lineup, WR2 the second.
    const rankWrong = [];
    for (let w = 1; w <= 16; w++) {
      const want = wantFill(teamId, w);
      const a = want.get('WR1');
      const b = want.get('WR2');
      if (a && b && !(a.v >= b.v)) rankWrong.push(`wk${w} WR1 ${a.v} < WR2 ${b.v}`);
      const r1 = bySlotRow.get('RB1').cells[weekCol(w)];
      const r2 = bySlotRow.get('RB2').cells[weekCol(w)];
      if (r1.v !== null && r2.v !== null && Number(r1.v) < Number(r2.v)) {
        rankWrong.push(`wk${w} RB1 ${r1.v} < RB2 ${r2.v}`);
      }
    }
    c.ok('WR1 IS NEVER BELOW WR2, AND RB1 NEVER BELOW RB2 — the rank is the projection',
      rankWrong.length === 0, rankWrong.slice(0, 4).join(' | '));

    // The FLEX is whoever the solver put in the flex, not "the next best man".
    const flexWrong = [];
    for (let w = 1; w <= 16; w++) {
      const want = wantFill(teamId, w);
      const td = bySlotRow.get('FLEX').cells[weekCol(w)];
      const e = want.get('FLEX');
      if (!e) { if (td.v !== null) flexWrong.push(`wk${w} want empty`); continue; }
      if (td.pid !== String(e.id)) flexWrong.push(`wk${w} want #${e.id} got #${td.pid}`);
    }
    c.ok('THE FLEX IS THE ONE THE OPTIMAL LINEUP CHOSE', flexWrong.length === 0,
      flexWrong.slice(0, 4).join(' | '));

    // Week 6 is the bye (stub player 03, a receiver) and week 7 the missing
    // number (player 04). Both must simply move the lineup on rather than
    // leaving a hole, which is the whole reason the rows are slots.
    c.ok('A BYE DOES NOT REACH A SLOT WHEN SOMEBODY BETTER IS AVAILABLE',
      bySlotRow.get('WR1').cells[weekCol(6)].pid !== String(teamId * 100 + 3) &&
      bySlotRow.get('WR2').cells[weekCol(6)].pid !== String(teamId * 100 + 3) &&
      rows.every((r) => r.cells[weekCol(6)].text !== 'Bye'),
      JSON.stringify(rows.map((r) => r.cells[weekCol(6)].text)));
    c.ok('and neither does a week ESPN carried no number for',
      rows.every((r) => r.cells[weekCol(7)].v !== null) &&
      bySlotRow.get('WR1').cells[weekCol(7)].pid !== String(teamId * 100 + 4),
      JSON.stringify(rows.map((r) => r.cells[weekCol(7)].v)));

    // the average, re-derived from the same rebuild
    const avgBad = [];
    for (const key of SLOT_ROWS) {
      const vals = [];
      for (let w = 1; w <= 13; w++) {
        const e = wantFill(teamId, w).get(key);
        if (e) vals.push(e.v);
      }
      const want = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
      const got = Number(bySlotRow.get(key).cells[1].v);
      if (Math.abs(got - want) > 0.06) avgBad.push(`${key} want ${want} got ${got}`);
    }
    c.ok('Avg is that slot’s own regular-season mean', avgBad.length === 0,
      avgBad.slice(0, 3).join(' | '));

    // the totals band, against the same rebuild rather than against the row
    const totalBad = [];
    for (let w = 1; w <= 16; w++) {
      const want = [...wantFill(teamId, w).values()].filter(Boolean)
        .reduce((a, e) => a + e.v, 0);
      const got = Number(totals.cells[weekCol(w)].v);
      if (Math.abs(got - Math.round(want * 10) / 10) > 0.051) {
        totalBad.push(`wk${w} want ${Math.round(want * 10) / 10} got ${got}`);
      }
    }
    c.ok('THE BAND IS THE BEST LEGAL LINEUP’S OWN TOTAL, week by week',
      totalBad.length === 0, totalBad.slice(0, 4).join(' | '));
    // ESPN's own lineup for this squad in week 8 IS the best one, so the two
    // panels have to agree about the number. Where they would not, they are
    // measuring different lineups and the comparison is not made.
    if (/already the best one for week 8/.test(txt($('rosterBest')))) {
      c.ok('and it matches the Roster detail’s own total for the same week',
        totals.cells[weekCol(8)].text ===
          d.querySelector('#rosterSplit .split-total').textContent.trim(),
        `${totals.cells[weekCol(8)].text} vs ` +
        `${d.querySelector('#rosterSplit .split-total').textContent.trim()}`);
    }

    // the week the page is showing is marked
    c.ok('the shown week’s column is bracketed',
      rows.every((r) => /\bnow\b/.test(r.cells[weekCol(8)].cls)) &&
      rows.every((r) => r.cells.slice(2).filter((td) => /\bnow\b/.test(td.cls)).length === 1) &&
      /\bnow\b/.test(totals.cells[weekCol(8)].cls),
      JSON.stringify(rows[0] && rows[0].cells.slice(2).map((x) => x.cls)));

    // ---- the links carry ESPN's OWN id, re-derived from the stub ----------
    // an-stub-season.mjs sets playerId = teamId * 100 + i, so the ids the page
    // emits are computed here rather than read back off the page.
    const want = [];
    for (let i = 0; i < season.SIZE; i++) {
      if (season.onRoster(i, 8)) want.push(`waivers.html?player=${teamId * 100 + i}`);
    }
    const hrefsIn = (sel) =>
      [...d.querySelectorAll(sel)].map((a) => a.getAttribute('href')).sort();
    const sorted = (a) => a.slice().sort();

    c.ok('THE ROSTER DETAIL LINKS EVERY PLAYER BY THE ID ESPN GAVE',
      JSON.stringify(hrefsIn('#rosterTable tbody td.name a.pref')) === JSON.stringify(sorted(want)),
      JSON.stringify(hrefsIn('#rosterTable tbody td.name a.pref')).slice(0, 300));
    c.ok('and every season-panel link is one of this squad’s own ESPN ids',
      (() => {
        const hrefs = hrefsIn('#seasonTable tbody a.pref');
        return hrefs.length > 0 && hrefs.every((h) => want.includes(h));
      })(), JSON.stringify(hrefsIn('#seasonTable tbody a.pref')).slice(0, 300));

    // the grids: one row, all nine spots and the whole bench
    const grid4 = (id) => {
      const tr = d.querySelector(`#${id}Table tbody tr[data-team="${teamId}"]`);
      return [...tr.children].filter((td) => /\bslot-cell\b/.test(td.getAttribute('class') || ''));
    };
    // ONE grid since 2026-09-17, on whichever measure the panel is set to.
    for (const id of ['overview']) {
      const cells = grid4(id);
      c.ok(`the ${id} grid links every one of its fifteen numbers`,
        cells.length === 15 && cells.every((td) => td.querySelector('a.pref')),
        `${cells.length} cells, ${cells.filter((td) => td.querySelector('a.pref')).length} linked`);
      c.ok(`and every ${id} link is one of team ${teamId}’s own ESPN ids`,
        cells.every((td) => want.includes(td.querySelector('a.pref').getAttribute('href'))),
        cells.map((td) => td.querySelector('a.pref').getAttribute('href')).join(' '));
      c.ok(`the ${id} grid keeps its sort key on the cell, outside the link`,
        cells.every((td) => /^-?\d+(\.\d+)?$/.test(td.getAttribute('data-v') || '')) &&
        cells.every((td) => !td.querySelector('a.pref').hasAttribute('data-v')),
        cells.map((td) => td.getAttribute('data-v')).join(' '));
    }

    // ---- the hover card: identity line, then the run as a two-row chart ---
    //
    // It was lines of text in a native `title` and Tim said it was hard to
    // scan. It is a chart now — week numbers along the top, projections
    // directly under their own week — which a `title` cannot draw, because it
    // renders in the OS UI font where padding cannot make columns line up.
    const cells = grid4('overview');
    const card0 = hoverCard(d, boot.window, cells[0]);   // the QB, a clean run

    c.ok('the card opens with name, position and NFL team',
      card0 && /^T4 Player 00 · QB · BUF/.test(card0.ident), card0 && card0.ident);
    c.ok('an injury designation is still on it',
      /· OUT/.test(hoverCard(d, boot.window, cells[2]).ident),
      hoverCard(d, boot.window, cells[2]).ident);
    c.ok('and it says whose projections these are',
      /ESPN’s projection for weeks 1–16/.test(card0.heading), card0.heading);

    // Three rows since Tim asked for "another row below proj that is act": the
    // week numbers, the projection, and what he actually scored. The claim is
    // still the same one — the rows are ONE table, so a column cannot drift out
    // of line — it is just a row longer than it was. What the Act row itself
    // says is asserted in touch-check.mjs, which owns the card.
    c.ok('IT IS A THREE-ROW CHART: WEEK NUMBERS OVER PROJ OVER ACT',
      card0.rows === 3, `${card0.rows} rows in the run table`);
    c.ok('the top row is the weeks, in order, one per week of the season, then the playoffs',
      JSON.stringify(card0.weeks) === JSON.stringify(SEASON_COLS),
      JSON.stringify(card0.weeks));
    {
      // THE CARD'S PLAYOFF LINE: week 14's column carries it in all three rows,
      // and the card says what PO means.
      const card = d.getElementById('tipCard');
      const lined = [...card.querySelectorAll('.tc-run th, .tc-run td')]
        .filter((x) => isPo(x.getAttribute('class')));
      c.ok('CARD: the playoff line is on week 14 in the week, Proj and Act rows — and only there',
        lined.length === 3 && lined[0].textContent.trim().startsWith('14') &&
        [...card.querySelectorAll('.tc-run thead th.po-start')].length === 1,
        lined.map((x) => x.outerHTML).join(' '));
      c.ok('CARD: and says what PO means in words',
        /PO = the playoffs \(weeks 14–16\), after the heavy line/.test(card.textContent),
        card.textContent);
    }
    c.ok('the bottom row is a projection for every one of them',
      card0.values.length === card0.weeks.length, `${card0.values.length} v ${card0.weeks.length}`);
    c.ok('the two rows are one table, so a column cannot drift out of line',
      card0.weeks.length === 16 && card0.values.length === 16, 'the rows are not paired');

    c.ok('every number in the run is the projection ESPN gave for that week',
      (() => {
        const bad = [];
        for (let i = 0; i < season.SIZE; i++) {
          if (!season.onRoster(i, 8)) continue;
          const cell = grid4('overview').find((td) => {
            const k = hoverCard(d, boot.window, td);
            return k && k.ident.startsWith(season.playerName(teamId, i) + ' ');
          });
          if (!cell) { bad.push(`p${i} has no cell`); continue; }
          const k = hoverCard(d, boot.window, cell);
          for (let wk = 1; wk <= 13; wk++) {
            const got = k.values[wk - 1];
            const v = season.onRoster(i, wk) ? season.projFor(i, wk) : 'off';
            const expect = v === 'off' ? 'off' : v === null ? '—' : v === 0 ? 'Bye' : v.toFixed(1);
            if (got !== expect) bad.push(`p${i} wk${wk} want ${expect} got ${got}`);
          }
        }
        return bad.length === 0 ? true : bad.slice(0, 4).join(' | ');
      })() === true,
      'see the run');

    {
      const bye = hoverCard(d, boot.window, cells[3]);
      c.ok('a BYE reads as a bye in the run, and is explained under it',
        bye.values[5] === 'Bye' && /Bye = the 0\.00 ESPN returns/.test(bye.legend),
        `${bye.values[5]} / ${bye.legend}`);
      c.ok('and it is marked as its own kind, not just worded differently',
        /k-bye/.test(bye.kinds[5]), bye.kinds[5]);

      const gap = hoverCard(d, boot.window, cells[4]);
      c.ok('AND A MISSING NUMBER DOES NOT READ AS A BYE',
        gap.values[6] === '—' && !gap.values.includes('Bye') &&
        /ESPN carried no number for him/.test(gap.legend),
        `${gap.values[6]} / ${gap.legend}`);
      c.ok('a week he was not on the roster for is its own third thing',
        (() => {
          const last = grid4('overview').find((td) => {
            const k = hoverCard(d, boot.window, td);
            return k && k.ident.startsWith(season.playerName(teamId, season.SIZE - 1) + ' ');
          });
          if (!last) return false;
          const k = hoverCard(d, boot.window, last);
          return k.values[0] === 'off' && /off = he was not on this roster that week/.test(k.legend);
        })(), 'no off token');
      c.ok('the three no-number states are told apart by class as well as by word',
        new Set([bye.kinds[5], gap.kinds[6], 'k-off']).size === 3,
        `${bye.kinds[5]} / ${gap.kinds[6]}`);
    }

    c.ok('the legend only names the states that actually turn up',
      card0.legend === '', card0.legend);
    c.ok('the week the page is showing is marked in the run',
      card0.kinds[7].includes('now') && card0.kinds.filter((k) => k.includes('now')).length === 1,
      JSON.stringify(card0.kinds));
    c.ok('THE CELL CARRIES NO TITLE, so the browser cannot draw a second tooltip',
      !cells[0].hasAttribute('title') && !cells[0].querySelector('a.pref').hasAttribute('title'),
      cells[0].getAttribute('title'));
    c.ok('the link still says where clicking would go, to a screen reader',
      /Click to open his next 13 weeks on the Players page\./
        .test(cells[0].querySelector('a.pref').getAttribute('aria-label') || ''),
      cells[0].querySelector('a.pref').getAttribute('aria-label'));

    // AND IT COST NOTHING. The week run is the season panel's cache read a
    // second way; the two counts above already pin every request this page
    // makes, so a tooltip that fetched would have moved one of them.
    c.ok('THE HOVER ADDS NO REQUEST — it is the season cache read a second way',
      season.calls.weeks.length === 16 && season.calls.week.length === 1 &&
      season.calls.schedule === 1,
      `weeks=${season.calls.weeks.length} week=${season.calls.week.length} sched=${season.calls.schedule}`);
  }

  // ---- (c) some weeks reject ----------------------------------------------
  if (scenario === 'live-partial') {
    const colOf = weekCol;
    c.ok('the table still renders every slot', rows.length === SLOT_ROWS.length, `${rows.length}`);
    c.ok('the refused weeks are blank for every slot, the band included',
      rows.every((r) => r.cells[colOf(5)].text === '\u2014' && r.cells[colOf(11)].text === '\u2014') &&
      totals.cells[colOf(5)].text === '\u2014' && totals.cells[colOf(11)].text === '\u2014',
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.text)));
    c.ok('a refused week has no sort key',
      rows.every((r) => r.cells[colOf(5)].v === null && r.cells[colOf(11)].v === null), 'sort key present');
    c.ok('a refused week does not masquerade as one still loading',
      rows.every((r) => !/\bwait\b/.test(r.cells[colOf(5)].cls)), 'still says wait');
    c.ok('and it names nobody, so no highlight can point at a week that never loaded',
      rows.every((r) => r.cells[colOf(5)].pid === null && r.cells[colOf(11)].pid === null),
      'a refused cell still carries a data-pid');
    c.ok('the weeks that did load still fill every slot',
      rows.every((r) => /^\d+\.\d/.test(r.cells[colOf(2)].text)),
      rows.map((r) => r.cells[colOf(2)].text).join(','));
    c.ok('the note names the weeks that failed',
      /ESPN did not return weeks 5 and 11/.test(note), note);
    c.ok('the note says what to do about it', /Reload the page to try again/.test(note), note);
    c.ok('the failure is on screen, not tucked in the toggle',
      /ESPN did not return weeks 5 and 11/.test(txt($('seasonAlert'))) &&
      !/\bhidden\b/.test($('seasonAlert').getAttribute('class') || ''),
      $('seasonAlert').getAttribute('class'));
    c.ok('the note says the average came from the weeks that loaded',
      /average is taken from the weeks that did load/.test(note), note);
    c.ok('the failed headers say so on hover',
      /Week 5 did not load/.test(table.innerHTML), 'no failed header tooltip');
    c.ok('the note still counts only the weeks it has',
      /14 of 16 loaded so far/.test(note), note);
  }

  // ---- (d) switching team, sorting, changing week --------------------------
  // ---- who to start, week by week ----------------------------------------
  //
  // The panel marks a week when a man is in the best legal lineup for it. That
  // claim is checked by REBUILDING the lineups here — straight out of
  // demo-rosters.js through forecast.js's optimalLineup — rather than by
  // reading the page's own arithmetic back to it. A panel that marked the
  // wrong cells confidently would agree with itself all day.
  if (scenario === 'starters') {
    const w = globalThis.__an || {};
    const { generateDemoWeekRosters } = await import('../js/demo-rosters.js');
    const { slotCountsFromLineups } = await import('../js/projection.js');
    const { optimalLineup, slotsFromCounts } = await import('../js/forecast.js');

    // The playoff weeks are rebuilt too: the best lineup is marked in them by
    // the same rule, and that is checked the same way.
    const WEEKS = [...REGULAR_WEEKS, ...PLAYOFF_WEEKS];
    const FLEX_SLOTS = new Set([3, 5, 7, 23]);

    const pool = [];
    const weekTeams = new Map();
    for (const wk of WEEKS) {
      const { teams } = generateDemoWeekRosters(wk);
      weekTeams.set(wk, teams);
      pool.push(...teams);
    }
    const slots = slotsFromCounts(slotCountsFromLineups(pool));

    /** week -> Map(playerId -> slotId) for one team, rebuilt from source. */
    const truthFor = (teamName) => {
      const out = new Map();
      for (const wk of WEEKS) {
        const t = weekTeams.get(wk).find((x) => x.name === teamName);
        if (!t) continue;
        const { starters } = optimalLineup(t.players || [], slots);
        out.set(wk, new Map(starters.map((s) => [s.playerId, s.slotId])));
      }
      return out;
    };

    c.ok('the panel has its own table and controls',
      Boolean(w.byPos) && Object.keys(w.byPos).length === 7, Object.keys(w.byPos || {}).length);

    // ---- shape ----------------------------------------------------------
    const rb = w.byPos.RB;
    c.ok('the identity columns are Depth, Player, Pos, NFL, Avg and Starts',
      JSON.stringify(rb.head.slice(0, 6)) ===
        JSON.stringify(['Depth', 'Player', 'Pos', 'NFL', 'Avg', 'Starts']),
      JSON.stringify(rb.head.slice(0, 6)));
    c.ok('one column per week after them, thirteen of them, then the three playoff weeks',
      JSON.stringify(rb.head.slice(6)) === JSON.stringify(SEASON_COLS),
      JSON.stringify(rb.head.slice(6)));
    {
      const ths = [...d.querySelectorAll('#startersTable thead th')];
      const lined = ths.map((th, i) => (isPo(th.getAttribute('class')) ? i : -1)).filter((i) => i >= 0);
      const col = 6 + REGULAR_WEEKS.length;
      const trs = [...d.querySelectorAll('#startersTable tbody tr')];
      c.ok('WHO TO START: the playoff line is on week 14, header and every row',
        lined.length === 1 && lined[0] === col && trs.length > 0 &&
        trs.every((tr) => isPo([...tr.children][col].getAttribute('class')) &&
          [...tr.children].filter((td) => isPo(td.getAttribute('class'))).length === 1),
        JSON.stringify(lined));
      c.ok('WHO TO START: a playoff week is marked like any other — some are shaded',
        Object.values(w.byPos).some((snap) => snap.rows.some((r) =>
          r.weeks.slice(REGULAR_WEEKS.length).some((x) => x.st))));
    }
    c.ok('every header is sortable',
      [...d.querySelectorAll('#startersTable thead th')].every((th) => th.hasAttribute('data-sort')));
    c.ok('the table lives inside a .table-scroll',
      $('startersWrap').getAttribute('class').includes('table-scroll'));

    // ---- one button lit, and it is the one pressed -----------------------
    for (const [pos, snap] of Object.entries(w.byPos)) {
      c.ok(`${pos}: exactly that button is lit`,
        snap.lit.length === 1 && snap.lit[0] === pos, JSON.stringify(snap.lit));
      c.ok(`${pos}: the title names the team and the position`,
        /^Who to start, week by week · .+ · .+$/.test(snap.title), snap.title);
    }

    // ---- the rows are the right men -------------------------------------
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'DST', 'K']) {
      const snap = w.byPos[pos];
      const label = pos === 'DST' ? 'DEF' : pos;
      c.ok(`${pos}: every row really is a ${label}`,
        snap.rows.length > 0 && snap.rows.every((r) => r.pos === label),
        snap.rows.map((r) => r.pos).join(','));
    }
    c.ok('FLEX shows RB, WR and TE together',
      new Set(w.byPos.FLEX.rows.map((r) => r.pos)).size === 3 &&
      ['RB', 'WR', 'TE'].every((p) => w.byPos.FLEX.rows.some((r) => r.pos === p)),
      [...new Set(w.byPos.FLEX.rows.map((r) => r.pos))].join(','));
    c.ok('FLEX is exactly the three position tables put together',
      w.byPos.FLEX.rows.length ===
        w.byPos.RB.rows.length + w.byPos.WR.rows.length + w.byPos.TE.rows.length,
      `${w.byPos.FLEX.rows.length} vs ${w.byPos.RB.rows.length}+${w.byPos.WR.rows.length}+${w.byPos.TE.rows.length}`);
    // FLEX IS A FILTER, NEVER A POSITION. A man keeps his own depth rank under
    // it — there is no such thing as a FLEX2 — and nothing downstream may learn
    // the button exists.
    c.ok('nobody is ranked FLEXn',
      w.byPos.FLEX.rows.every((r) => !/FLEX/.test(r.depth)),
      w.byPos.FLEX.rows.map((r) => r.depth).join(','));
    {
      const rank = new Map(w.byPos.RB.rows.map((r) => [r.name, r.depth]));
      c.ok('and a back keeps the same rank under FLEX as under RB',
        w.byPos.FLEX.rows.filter((r) => r.pos === 'RB')
          .every((r) => rank.get(r.name) === r.depth),
        w.byPos.FLEX.rows.filter((r) => r.pos === 'RB')
          .map((r) => `${r.name}:${r.depth}/${rank.get(r.name)}`).join(' '));
    }

    // ---- depth order ------------------------------------------------------
    // The table OPENS on Depth, ascending — a depth chart read out of order is
    // not a depth chart — so the held men come first, in rank order, and anyone
    // no longer on the roster trails them. Avg is one click away.
    c.ok('rows open as a depth chart: RB1, RB2, RB3 …',
      (() => {
        const held = rb.rows.filter((r) => !/\bgone\b/.test(r.cls));
        return held.length > 1 && held.every((r, i) => r.depth === `RB${i + 1}`);
      })(),
      rb.rows.map((r) => r.depth).join(','));
    c.ok('and men no longer on the roster trail every ranked one',
      (() => {
        const firstGone = rb.rows.findIndex((r) => /\bgone\b/.test(r.cls));
        return firstGone === -1 ||
          rb.rows.slice(firstGone).every((r) => /\bgone\b/.test(r.cls));
      })(),
      rb.rows.map((r) => `${r.depth}${/\bgone\b/.test(r.cls) ? '*' : ''}`).join(','));
    c.ok('the depth ranks really are the Avg order, deepest first',
      (() => {
        const held = rb.rows.filter((r) => !/\bgone\b/.test(r.cls));
        return held.every((r, i) => i === 0 ||
          Number(held[i - 1].avg ?? -Infinity) >= Number(r.avg ?? -Infinity));
      })(),
      rb.rows.map((r) => `${r.depth}:${r.avg}`).join(' '));
    // An unranked man sorts INSIDE his position group, never at the head of the
    // column: the data-v is the only thing stopping sortable.js falling back to
    // the cell text, where "—" would lead.
    c.ok('an unranked man still carries a sortable Depth value',
      rb.rows.every((r) => r.depthV !== null && r.depthV !== '' && /^\d+$/.test(r.depthV)),
      rb.rows.map((r) => `${r.depth}=${r.depthV}`).join(' '));
    c.ok('and it sorts him last within his own position',
      rb.rows.filter((r) => /\bgone\b/.test(r.cls))
        .every((g) => rb.rows.filter((r) => !/\bgone\b/.test(r.cls) && r.pos === g.pos)
          .every((h) => Number(h.depthV) < Number(g.depthV))),
      rb.rows.map((r) => `${r.depth}=${r.depthV}`).join(' '));

    // ---- THE ASSERTION THAT MATTERS -------------------------------------
    {
      const truth = truthFor(w.teamName);
      let marks = 0, checked = 0, wrong = [];
      for (const [pos, snap] of Object.entries(w.byPos)) {
        for (const row of snap.rows) {
          for (let i = 0; i < WEEKS.length; i++) {
            const wk = WEEKS[i];
            const cell = row.weeks[i];
            const lineup = truth.get(wk);
            if (!lineup) continue;
            // The page keys on ESPN's playerId; the test only has names, so it
            // matches on the name the page printed. Demo names are unique
            // within a squad, which is what makes that safe here.
            const slotId = [...lineup.entries()].find(([id]) => {
              const t = weekTeams.get(wk).find((x) => x.name === w.teamName);
              const p = (t.players || []).find((q) => q.playerId === id);
              return p && p.name === row.name;
            });
            const shouldStart = Boolean(slotId);
            checked++;
            if (cell.st) marks++;
            if (cell.st !== shouldStart) {
              wrong.push(`${pos} ${row.name} wk${wk}: page ${cell.st ? 'marks' : 'does not mark'}, truth ${shouldStart}`);
            } else if (shouldStart && cell.fx !== FLEX_SLOTS.has(slotId[1])) {
              wrong.push(`${pos} ${row.name} wk${wk}: flex marker ${cell.fx} vs ${FLEX_SLOTS.has(slotId[1])}`);
            }
          }
        }
      }
      c.ok('EVERY marked week is a week that man really is in the best legal lineup',
        wrong.length === 0, `${wrong.length} wrong, e.g. ${wrong.slice(0, 3).join(' | ')}`);
      c.ok('and the check is not vacuous — plenty of cells are marked',
        marks > 100 && marks < checked, `${marks} marked of ${checked} checked`);
    }

    // ---- the count per week matches what the league actually starts -------
    //
    // The bug this catches is a marked cell with no row to sit on: rosters
    // change week to week, so a lineup filled by somebody since dropped left a
    // week looking as though nobody at the position started at all.
    {
      const truth = truthFor(w.teamName);
      const bad = [];
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'DST', 'K']) {
        const snap = w.byPos[pos];
        for (let i = 0; i < WEEKS.length; i++) {
          const wk = WEEKS[i];
          const lineup = truth.get(wk);
          if (!lineup) continue;
          const t = weekTeams.get(wk).find((x) => x.name === w.teamName);
          const expected = [...lineup.keys()].filter((id) => {
            const p = (t.players || []).find((q) => q.playerId === id);
            return p && p.position === pos;
          }).length;
          const shown = snap.rows.filter((r) => r.weeks[i].st).length;
          if (shown !== expected) bad.push(`${pos} wk${wk}: ${shown} shaded vs ${expected} started`);
        }
      }
      c.ok('EVERY started man has a row — no lineup spot goes missing',
        bad.length === 0, `${bad.length} weeks off, e.g. ${bad.slice(0, 4).join(' | ')}`);
    }

    // ---- Starts agrees with the row it sits on ---------------------------
    for (const [pos, snap] of Object.entries(w.byPos)) {
      c.ok(`${pos}: the Starts column counts the row's own shaded weeks`,
        snap.rows.every((r) => r.starts === r.weeks.filter((x) => x.st).length),
        snap.rows.map((r) => `${r.name}:${r.starts}/${r.weeks.filter((x) => x.st).length}`).join(' '));
    }

    // ---- a man off the roster earns his row by having filled a slot ------
    for (const [pos, snap] of Object.entries(w.byPos)) {
      c.ok(`${pos}: nobody off the roster is here without a start to explain`,
        snap.rows.filter((r) => /\bgone\b/.test(r.cls)).every((r) => r.starts > 0),
        snap.rows.filter((r) => /\bgone\b/.test(r.cls) && r.starts === 0)
          .map((r) => r.name).join(','));
      c.ok(`${pos}: a man who never starts is marked as such`,
        snap.rows.filter((r) => r.starts === 0).every((r) => /\bnever\b/.test(r.cls)),
        snap.rows.filter((r) => r.starts === 0 && !/\bnever\b/.test(r.cls)).map((r) => r.name).join(','));
    }

    // ---- a start is said in words, not only in colour --------------------
    {
      const marked = rb.rows.flatMap((r) => r.weeks.filter((x) => x.st));
      c.ok('every marked cell says in its title that he is in the lineup',
        marked.length > 0 && marked.every((x) => /is in the best legal lineup/.test(x.title)),
        marked.find((x) => !/is in the best legal lineup/.test(x.title))?.title);
      c.ok('and a flex start says FLEX rather than a position',
        marked.filter((x) => x.fx).every((x) => /in the FLEX/.test(x.title)),
        marked.find((x) => x.fx && !/in the FLEX/.test(x.title))?.title);
      c.ok('some starts really are through the flex, so the marker is exercised',
        marked.some((x) => x.fx), `${marked.filter((x) => x.fx).length} flex starts`);
    }

    // ---- a bye is still a bye, and is exactly when cover shows up --------
    {
      const anyBye = Object.values(w.byPos).some((s) =>
        s.rows.some((r) => r.weeks.some((x) => x.text === 'Bye')));
      // Demo deliberately never claims a bye — a zero there means "ruled out",
      // which is a different fact — so this asserts the ABSENCE, and the live
      // scenarios cover the other side.
      c.ok('demo never claims a bye it cannot know about', !anyBye,
        'a demo cell read "Bye"');
    }

    // ---- the click-through contract holds here too -----------------------
    {
      const links = Object.values(w.byPos).flatMap((s) => s.rows.flatMap((r) => r.links));
      c.ok('every name is a link to that man on the Players page',
        links.length > 0 && links.every((h) => /^waivers\.html\?player=\d+$/.test(h)),
        links.find((h) => !/^waivers\.html\?player=\d+$/.test(h)));
      c.ok('one link per row and no more',
        Object.values(w.byPos).every((s) => s.rows.every((r) => r.links.length === 1)));
    }

    // ---- the note states the basis ---------------------------------------
    for (const phrase of ['best legal lineup', 'flex', 'Read along a row', 'read down a column']) {
      c.ok(`the note explains "${phrase}"`, rb.note.includes(phrase), rb.note.slice(0, 200));
    }
    c.ok('the note says the swaps above are not applied here',
      /what-if for one week and are deliberately not applied/.test(rb.note), rb.note.slice(-300));

    // ---- switching team follows the shared picker, and costs nothing -----
    c.ok('switching team repaints the panel with the other squad',
      w.afterSwitch.title !== w.beforeSwitch.title &&
      w.afterSwitch.title.includes(w.otherTeam),
      `${w.beforeSwitch.title} -> ${w.afterSwitch.title}`);
    c.ok('and it is a different set of men',
      JSON.stringify(w.afterSwitch.rows.map((r) => r.name)) !==
      JSON.stringify(w.beforeSwitch.rows.map((r) => r.name)),
      'the same names came back for another team');
    c.ok('the position button survives a team switch',
      w.afterSwitch.lit.join(',') === 'RB', w.afterSwitch.lit.join(','));
    c.ok('SWITCHING TEAM AND POSITION FETCHES NOTHING',
      boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 3).join(' | '));
  }

  if (scenario === 'team-switch') {
    const w = globalThis.__an || {};
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // The rows are SLOTS, so every squad's row LABELS are identical — what
    // changes when the team changes is which men fill them, and that is what
    // the ids on the cells say. Reading the labels would have passed forever.
    const pids = (snap) => snap.rows.map((r) => r.cells[weekCol(8)].pid);

    c.ok('the panel keeps the same slots whatever team is shown',
      eq(w.before.rows.map((r) => r.slot), SLOT_ROWS) &&
      eq(w.team7.rows.map((r) => r.slot), SLOT_ROWS) &&
      eq(w.team2.rows.map((r) => r.slot), SLOT_ROWS),
      JSON.stringify(w.team7 && w.team7.rows.map((r) => r.slot)));
    c.ok('SWITCHING TEAM REFILLS EVERY SLOT WITH THE OTHER SQUAD',
      pids(w.team7).every((id) => /^7\d\d$/.test(id)) &&
      pids(w.before).every((id) => /^4\d\d$/.test(id)),
      `${JSON.stringify(pids(w.before))} -> ${JSON.stringify(pids(w.team7))}`);
    c.ok('switching team renames the panel',
      w.team7 && w.team7.title === 'Season by week · Team 7', w.team7 && w.team7.title);
    c.ok('SWITCHING TEAM FETCHES NOTHING',
      eq(w.fetchesBefore, w.fetchesAfterSwitch),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterSwitch)}`);
    c.ok('every week column is still filled after the switch',
      w.team7 && w.team7.rows.every((r) => r.cells.slice(2).every((td) => !/\bwait\b/.test(td.cls))),
      'pending cells after switch');
    c.ok('the column set is unchanged by the switch',
      eq(w.before.cols, w.team7.cols), JSON.stringify(w.team7 && w.team7.cols));

    // ---- the picker at the top of Season by week (Tim, 2026-09-19) ---------
    //
    // "I want to make it so that you can select which team you are viewing this
    // information about at the top of this box." It is a second VIEW of the
    // page's one team setting, not a second setting: three panels below are
    // about one squad, and a panel with a team of its own would let the page
    // show two at once with both headings claiming to be the same squad.
    c.ok('SEASON BY WEEK HAS ITS OWN TEAM PICKER, inside the panel and above the table',
      w.seasonPicker && w.seasonPicker.exists && w.seasonPicker.inPanel &&
      w.seasonPicker.aboveTable,
      JSON.stringify(w.seasonPicker));
    c.ok('it offers every squad in the league',
      w.seasonPicker && w.seasonPicker.options === 10, String(w.seasonPicker?.options));
    c.ok('and it had already followed a switch made on the other picker',
      w.seasonPicker && w.seasonPicker.followedTheOther === '7',
      String(w.seasonPicker?.followedTheOther));
    c.ok('SWITCHING ON IT REFILLS THE PANEL WITH THAT SQUAD',
      w.team5 && pids(w.team5).every((id) => /^5\d\d$/.test(id)),
      JSON.stringify(w.team5 && pids(w.team5)));
    c.ok('and moves the roster detail with it — one team, three panels',
      w.team5Roster === 'Roster detail · Team 5' &&
      w.team5Pickers && w.team5Pickers.roster === '5' && w.team5Pickers.season === '5',
      `${w.team5Roster} ${JSON.stringify(w.team5Pickers)}`);
    c.ok('and it fetches nothing — every squad is in every week already read',
      eq(w.fetchesAfterSwitch, w.fetchesAfterSeasonPick),
      JSON.stringify(w.fetchesAfterSeasonPick));

    c.ok('clicking a row in the all-teams grid drives the same panel',
      w.team2 && pids(w.team2).every((id) => /^2\d\d$/.test(id)),
      JSON.stringify(w.team2 && pids(w.team2)));
    c.ok('the shared picker follows the grid click, so the two cannot disagree',
      w.teamSelectValue === '2', w.teamSelectValue);
    c.ok('AND SO DOES THE SEASON PANEL’S, which is the same setting seen twice',
      w.team2Pickers && w.team2Pickers.season === '2' && w.team2Pickers.roster === '2',
      JSON.stringify(w.team2Pickers));
    c.ok('the grid click fetches nothing either',
      eq(w.fetchesAfterSwitch, w.fetchesAfterGridClick), JSON.stringify(w.fetchesAfterGridClick));

    // Slot, Avg, then the weeks — so a week's column index is weekCol(w).
    const col = (snap, i) => snap.rows.map((r) => (r.cells[i].v === null ? null : Number(r.cells[i].v)));
    const C7 = weekCol(7);
    const C6 = weekCol(6);
    const C1 = weekCol(1);
    const N = SLOT_ROWS.length;
    const d7 = ordered(col(w.wk7desc, C7), false);
    const a7 = ordered(col(w.wk7asc, C7), true);
    c.ok('sorting a week column orders it descending', d7.monotonic && d7.n === N,
      JSON.stringify(col(w.wk7desc, C7)));
    c.ok('clicking again reverses it', a7.monotonic && a7.n === N, JSON.stringify(col(w.wk7asc, C7)));
    c.ok('SORTING NEVER MOVES THE TOTALS BAND OUT OF THE FOOT',
      w.wk7desc.total8 === w.before.total8 && w.wk1asc.total8 === w.before.total8,
      `${w.before.total8} / ${w.wk7desc.total8} / ${w.wk1asc.total8}`);
    c.ok('and never sorts a slot row into the band',
      w.wk7desc.rows.length === N && w.wk6asc.rows.length === N,
      `${w.wk7desc.rows.length} / ${w.wk6asc.rows.length}`);

    const a6 = ordered(col(w.wk6asc, C6), true);
    c.ok('a week column sorts the same way whichever week it is',
      a6.monotonic && a6.n === N, JSON.stringify(col(w.wk6asc, C6)));
    const d1 = ordered(col(w.wk1desc, C1), false);
    const a1 = ordered(col(w.wk1asc, C1), true);
    c.ok('week 1 sorts both ways as well',
      d1.monotonic && a1.monotonic && d1.n === N,
      `${JSON.stringify(col(w.wk1desc, C1))} / ${JSON.stringify(col(w.wk1asc, C1))}`);
    c.ok('sorting fetches nothing', eq(w.fetchesAfterGridClick, w.fetchesAfterSort),
      JSON.stringify(w.fetchesAfterSort));

    // THE ROW SET NO LONGER MOVES WITH THE WEEK, which is the point of the
    // rebuild: a lineup sheet has the same slots in week 3 as in week 8. What
    // follows the week is the bracket, and the panel above it.
    c.ok('CHANGING THE WEEK KEEPS THE SLOTS AND MOVES THE BRACKET',
      w.week3 && eq(w.week3.rows.map((r) => r.slot).slice().sort(), SLOT_ROWS.slice().sort()) &&
      w.week3.rows.every((r) => /\bnow\b/.test(r.cells[weekCol(3)].cls)) &&
      w.week3.rows.every((r) => !/\bnow\b/.test(r.cells[weekCol(8)].cls)),
      JSON.stringify(w.week3 && w.week3.rows.map((r) => r.slot)));
    c.ok('changing the week costs one request for the week itself and no more season weeks',
      w.fetchesAfterWeek.weeks.length === w.fetchesAfterSort.weeks.length &&
      w.fetchesAfterWeek.week.length === w.fetchesAfterSort.week.length + 1,
      `${JSON.stringify(w.fetchesAfterWeek)} vs ${JSON.stringify(w.fetchesAfterSort)}`);
    c.ok('the column set survives a week change',
      eq(w.before.cols, w.week3.cols), JSON.stringify(w.week3 && w.week3.cols));

    // -- the links must not have touched the sort keys ---------------------
    // Wrapping a cell's contents in an anchor is only safe while the sort key
    // stays on the cell, so a sorted column must hold exactly the same set of
    // keys, in the same shape, as it did before anybody clicked a header.
    const shape = (v) => (v === null ? 'none' : /^-?\d+(\.\d+)?$/.test(v) ? 'num' : `BAD:${v}`);
    const keysOf = (snap, i) => snap.rows.map((r) => r.cells[i].v);
    const shapesOf = (snap, i) => keysOf(snap, i).map(shape).sort();
    c.ok('A SORTED COLUMN’S SORT KEYS ARE UNCHANGED IN SHAPE',
      eq(shapesOf(w.before, C7), shapesOf(w.wk7desc, C7)) &&
      eq(shapesOf(w.before, C7), shapesOf(w.wk7asc, C7)) &&
      shapesOf(w.before, C7).every((s) => s !== 'BAD'),
      `${JSON.stringify(shapesOf(w.before, C7))} vs ${JSON.stringify(shapesOf(w.wk7desc, C7))}`);
    c.ok('and the same values, only reordered — nothing was swallowed by a link',
      eq(keysOf(w.before, C7).slice().sort(), keysOf(w.wk7desc, C7).slice().sort()) &&
      eq(keysOf(w.before, C6).slice().sort(), keysOf(w.wk6asc, C6).slice().sort()),
      `${JSON.stringify(keysOf(w.before, C7))} vs ${JSON.stringify(keysOf(w.wk7desc, C7))}`);
  }

  // ---- (f) the two all-teams grids ---------------------------------------
  if (scenario === 'grids') {
    const w = globalThis.__an || {};
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const HEAD = ['Team', 'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'DEF', 'K', 'Total',
      'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    const teamRow = (g, name) => g.rows.find((r) => r.team === name);
    const nums = (row, from, to) => row.cells.slice(from, to).map((td) => td.v);

    // W is the panel as it OPENS — the week measure. A is the same panel with
    // the switch pressed. They used to be two separate panels on one screen.
    const W = w.initial;
    const A = w.avg;

    // -- one box, with both controls in it ---------------------------------
    c.ok('THERE IS ONE ALL-TEAMS GRID AND NO SECOND ONE',
      d.querySelectorAll('table.grid').length === 1 && !d.getElementById('weeklyTable'),
      `${d.querySelectorAll('table.grid').length} grid tables`);
    c.ok('THE WEEK PICKER LIVES INSIDE THE ALL-TEAMS PANEL NOW',
      w.controls.weekInGridPanel && !w.controls.weekInSourcePanel,
      JSON.stringify(w.controls));
    c.ok('and so does the measure switch',
      w.controls.toggleInGridPanel, JSON.stringify(w.controls));
    c.ok('the switch explains itself on the page, not in a title no phone can read',
      w.controls.titledButtons === 0 && w.controls.hintOnPage, JSON.stringify(w.controls));
    c.ok('the two measures are offered by name, the average carrying the season',
      eq(W.buttons, ['week=A week', 'avg=Proj avg 2026']), JSON.stringify(W.buttons));

    // -- what it opens on --------------------------------------------------
    c.ok('IT OPENS ON THE COMING WEEK, not on the season average',
      W.title === 'All teams · week 8' && eq(W.measure, ['week']),
      `${W.title} / ${JSON.stringify(W.measure)}`);
    c.ok('and the hint under the controls says what the numbers are',
      /week 8/.test(W.hint) && /ESPN/.test(W.hint), W.hint);

    // -- the shape, identical on both measures -----------------------------
    c.ok('the columns are the nine spots, the total, and then the bench',
      eq(W.head, HEAD), JSON.stringify(W.head));
    // THE MEASURE CHANGES THE COLUMNS SINCE 2026-09-19, and that is the change
    // rather than a regression: the average is one column per LINEUP SLOT read
    // off the season sheet below, so it has the league's own ten (here nine,
    // the stub starts two receivers) and no bench at all. It used to be the
    // same nine player spots with a different number in them.
    c.ok('THE AVERAGE IS ONE COLUMN PER LINEUP SLOT, the league’s own shape',
      eq(A.head, ['Team', ...SLOT_ROWS, 'Total']), JSON.stringify(A.head));
    c.ok('and it has no bench, because a slot average has no bench',
      !A.head.some((h) => /^B\d+$/.test(h)) && W.head.some((h) => /^B\d+$/.test(h)),
      JSON.stringify(A.head));
    c.ok('D/ST and the kicker are real columns',
      W.head.includes('DEF') && W.head.includes('K'), JSON.stringify(W.head));
    c.ok('the old estimate columns are gone',
      !W.head.some((h) => /Baseline|Est Total|Wk proj|Wk actual/.test(h)),
      JSON.stringify(W.head));
    c.ok('every header is sortable',
      [...d.querySelectorAll('#overviewTable thead th')].every((th) => th.hasAttribute('data-sort')),
      'a header is not sortable');
    c.ok('both measures carry every team',
      W.rows.length === 10 && A.rows.length === 10, `${W.rows.length} / ${A.rows.length}`);

    // -- NO NAMES in the cells --------------------------------------------
    const cellText = A.rows.flatMap((r) => r.cells).map((td) => td.text);
    c.ok('NOT ONE CELL CARRIES A PLAYER NAME',
      cellText.every((t) => !/Player \d/.test(t)),
      cellText.filter((t) => /Player \d/.test(t)).slice(0, 3).join(' | '));
    c.ok('every slot cell is a bare number',
      A.rows.every((r) => r.cells.slice(0, SLOT_ROWS.length)
        .every((td) => /^-?\d+\.\d$/.test(td.text))),
      JSON.stringify(A.rows[0].cells.slice(0, SLOT_ROWS.length).map((td) => td.text)));
    // The week measure still names men on a hover; the average deliberately
    // does not, because a slot's season is usually several of them.
    const lineupCells = [...d.querySelectorAll('#overviewTable tbody td[data-tip]')];
    c.ok('the AVERAGE opens no player card at all — a slot is not a man',
      A.rows.every((r) => r.cells.every((td) => !/\bslot-cell\b/.test(td.cls))),
      JSON.stringify(A.rows[0].cells.map((td) => td.cls)));
    c.ok('but it says who fills each slot, and how often, in a title a tap opens',
      A.rows.every((r) => r.cells.slice(0, SLOT_ROWS.length)
        .every((td) => /Player \d\d \(\d+\)/.test(td.title))),
      A.rows[0].cells[0].title);
    c.ok('and the WEEK measure still carries its cards',
      lineupCells.length > 0 &&
      [...lineupCells].slice(0, 6).map((td) => hoverCard(d, boot.window, td))
        .every((k) => k && /Player \d\d/.test(k.ident)),
      `${lineupCells.length} cells with a card`);

    // -- the bench, with its position in the cell --------------------------
    // "12.3 RB4" — the position AND where he ranks at it on his own team. The
    // position alone said what he is; the number says what he is worth having,
    // which is the question a bench column is actually asked. Week measure
    // only: the average has no bench columns to put one in.
    c.ok('a bench cell carries the position AND his rank at it, beside the number',
      W.rows.every((r) => r.cells.slice(10).every((td) =>
        /^\d+\.\d (QB|RB|WR|TE|DST|K)\d+$/.test(td.text))),
      JSON.stringify(W.rows[0].cells.slice(10).map((td) => td.text)));
    c.ok('and a lineup cell deliberately does not — its header already says it',
      W.rows.every((r) => r.cells.slice(0, 9).every((td) => !/[A-Z]{1,3}$/.test(td.text))),
      JSON.stringify(W.rows[0].cells.slice(0, 9).map((td) => td.text)));

    // -- team 4's arithmetic, RE-DERIVED, on each measure -------------------
    //
    // TIM, 2026-09-19: the average must be "this exact information" — the Avg
    // column of Season by week, for every squad. So it is rebuilt here from the
    // stub's own raw projections through forecast.js's real optimalLineup,
    // never read back off the page. A grid that averaged the wrong thing
    // confidently would agree with itself all day.
    const { optimalLineup: solve, slotsFromCounts: fromCounts } =
      await import('../js/forecast.js');
    const { slotCountsFromLineups: countSlots } = await import('../js/projection.js');
    const stub = await import('./an-stub-season.mjs');
    const squadOf = (team, week) => {
      const out = [];
      for (let i = 0; i < stub.SIZE; i++) {
        if (!stub.onRoster(i, week)) continue;
        out.push({
          playerId: team * 100 + i,
          name: stub.playerName(team, i),
          position: stub.POS[i],
          lineupSlotId: stub.SLOTS[i],
          started: stub.SLOTS[i] !== 20,
          projected: stub.projFor(i, week),
        });
      }
      return out;
    };
    const gridSlots = fromCounts(countSlots([{ players: squadOf(4, 8) }]));
    /** slot key -> that week's value, independently solved and ranked. */
    const fillOf = (team, week) => {
      const bySlot = new Map();
      for (const s of solve(squadOf(team, week), gridSlots).starters) {
        if (!bySlot.has(s.slotId)) bySlot.set(s.slotId, []);
        bySlot.get(s.slotId).push(s);
      }
      for (const list of bySlot.values()) {
        list.sort((a, b) => b.projected - a.projected || a.playerId - b.playerId);
      }
      const counts = new Map();
      const out = new Map();
      [0, 2, 2, 4, 4, 6, 23, 16, 17].forEach((slotId, i) => {
        const n = (counts.get(slotId) || 0) + 1;
        counts.set(slotId, n);
        const pick = (bySlot.get(slotId) || [])[n - 1] || null;
        out.set(SLOT_ROWS[i], pick ? Math.round(pick.projected * 10) / 10 : null);
      });
      return out;
    };

    const a4 = teamRow(A, 'Team 4');
    const avgWrong = [];
    SLOT_ROWS.forEach((key, i) => {
      const vals = [];
      for (let wk = 1; wk <= 13; wk++) {
        const v = fillOf(4, wk).get(key);
        if (typeof v === 'number') vals.push(v);
      }
      const want = Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10;
      const got = Number(a4.cells[i].v);
      if (Math.abs(got - want) > 0.06) avgWrong.push(`${key} want ${want} got ${got}`);
    });
    c.ok('PROJ AVG IS EACH LINEUP SLOT AVERAGED OVER THE REGULAR SEASON',
      avgWrong.length === 0, avgWrong.slice(0, 4).join(' | '));

    // And it really is a different answer from the one it replaced, which was
    // each man's own season projection over 17 games: 20.0 / 19.0 / 18.0 …
    c.ok('so it is NOT the old per-player season average any more',
      !eq(nums(a4, 0, 9), ['20', '19', '18', '17', '16', '15', '14', '13', '12']),
      JSON.stringify(nums(a4, 0, 9)));

    // -- BOTH MEASURES ARE ON THE SCALE, AND NEITHER IS COLOURED HERE ------
    //
    // This used to assert "THE WEEK MEASURE IS DELIBERATELY NOT ON THE SCALE",
    // which was true until Tim answered the open question on 2026-09-19b: "it
    // needs to be added to all the other places a number is referred to across
    // the whole site." The `week-heat` scenario is where the week measure's
    // colours are proved, on demo data.
    //
    // What this stub proves instead is THE FLAT-COLUMN GUARD, and it now
    // proves it for BOTH measures at once: every squad here gets identical
    // projections, so every column of both tables is ten copies of one number,
    // and a page that coloured on rounding noise would light up the entire
    // grid. That is the exact defect HEAT_MIN_SPREAD was written for.
    c.ok('TEN IDENTICAL SQUADS COLOUR NOTHING ON THE WEEK MEASURE — the flat guard',
      W.rows.every((r) => r.cells.every((td) => !/heat-(up|dn)/.test(td.cls))),
      JSON.stringify(W.rows[0].cells.map((td) => td.cls).slice(0, 4)));
    c.ok('AND A COLUMN OF TEN IDENTICAL NUMBERS IS NOT COLOURED ON THE AVERAGE EITHER',
      A.rows.every((r) => r.cells.every((td) => !/heat-(up|dn)/.test(td.cls))),
      JSON.stringify(A.rows[0].cells.map((td) => td.cls)));
    c.ok('so the key under it offers no swatch it cannot show',
      !/end of the scale|never compared across columns/.test(w.avgLegend || ''),
      w.avgLegend);

    // The total is the LINEUP averaged, not the columns added — and it has to
    // be the very number the panel below prints for this squad.
    const weekTotals = [];
    for (let wk = 1; wk <= 13; wk++) {
      weekTotals.push([...fillOf(4, wk).values()]
        .filter((v) => typeof v === 'number').reduce((x, y) => x + y, 0));
    }
    const wantTotal = Math.round(
      (weekTotals.map((t) => Math.round(t * 10) / 10)
        .reduce((x, y) => x + y, 0) / weekTotals.length) * 10) / 10;
    c.ok('TOTAL IS THE WHOLE LINEUP IN AN AVERAGE WEEK',
      Math.abs(Number(a4.cells[SLOT_ROWS.length].v) - wantTotal) < 0.06,
      `${a4.cells[SLOT_ROWS.length].v} vs ${wantTotal}`);
    c.ok('and it is the same figure the Season by week band shows for that squad',
      w.bandAvg !== null && Math.abs(Number(w.bandAvg) - wantTotal) < 0.06,
      `band ${w.bandAvg} vs grid ${a4.cells[SLOT_ROWS.length].v}`);
    c.ok('the whole regular season is in it, not just the week on screen',
      w.weeksRead >= 13, String(w.weeksRead));

    const w4 = teamRow(W, 'Team 4');
    c.ok('A WEEK IS THE SAME NINE MEN ON THAT WEEK’S NUMBERS',
      eq(nums(w4, 0, 9), ['22.4', '21.4', '20.4', '19.4', '18.4', '17.4', '16.4', '15.4', '14.4']),
      JSON.stringify(nums(w4, 0, 9)));
    c.ok('and its total is what ESPN itself says the team is projected',
      w4.cells[9].text === '165.6', w4.cells[9].text);
    c.ok('the two measures really do disagree — this is not one table twice',
      !eq(nums(w4, 0, 10), nums(a4, 0, 10)),
      `${JSON.stringify(nums(w4, 0, 10))} vs ${JSON.stringify(nums(a4, 0, 10))}`);

    // -- ordering ----------------------------------------------------------
    const totals = (g) => g.rows.map((r) => Number(r.cells[9].v));
    c.ok('the grid opens ranked by Total, best first, on either measure',
      totals(W).every((v, i) => i === 0 || v <= totals(W)[i - 1]) &&
      totals(A).every((v, i) => i === 0 || v <= totals(A)[i - 1]),
      `${JSON.stringify(totals(W))} / ${JSON.stringify(totals(A))}`);

    // -- the switch is a repaint, and it moves nothing else -----------------
    c.ok('SWITCHING THE MEASURE COSTS NO REQUEST — both numbers were already fetched',
      eq(w.fetchesBefore, w.fetchesAfterMeasure),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterMeasure)}`);
    c.ok('AND IT DOES NOT MOVE THE WEEK THE REST OF THE PAGE IS SHOWING',
      eq(w.elsewhereBefore, w.elsewhereAfterMeasure),
      `${JSON.stringify(w.elsewhereBefore)} -> ${JSON.stringify(w.elsewhereAfterMeasure)}`);
    c.ok('the panels below really were pinned to the selected week, so that means something',
      w.elsewhereBefore.weekSelect === '8' && eq(w.elsewhereBefore.seasonNow, ['8']) &&
      w.elsewhereBefore.glanceWeek === '8',
      JSON.stringify(w.elsewhereBefore));
    c.ok('the choice is remembered in the page’s own prefs',
      w.savedMeasure === 'avg', String(w.savedMeasure));
    c.ok('and pressing the other one back gives exactly the table it opened with',
      eq(w.backToWeek.rows, W.rows) && w.backToWeek.title === W.title,
      `${w.backToWeek.title} vs ${W.title}`);

    // -- clicking the grid drills in ---------------------------------------
    c.ok('a click in the grid drives the roster detail below',
      w.picked.team === '2', w.picked.team);
    c.ok('and the grid marks the drilled-into row',
      /\bpicked\b/.test(teamRow(w.picked.snap, 'Team 2').cls),
      teamRow(w.picked.snap, 'Team 2').cls);

    // -- a player link does not drag the drill-down with it -----------------
    c.ok('the grid link is a real href carrying that team’s own ESPN id',
      w.ref && /^waivers\.html\?player=5\d\d$/.test(w.ref.href), w.ref && w.ref.href);
    c.ok('CLICKING A PLAYER LINK LEAVES THE DRILLED-INTO TEAM ALONE',
      w.afterRefClick.team === '2' && eq(w.afterRefClick.picked, ['2']),
      `${w.afterRefClick.team} / ${JSON.stringify(w.afterRefClick.picked)}`);
    c.ok('but clicking the row anywhere else still drills in, as it always did',
      w.afterNameClick.team === '5', w.afterNameClick.team);

    // -- changing the week moves the grid only on the week measure ----------
    const w4b = teamRow(w.week6, 'Team 4');
    const a4b = teamRow(w.week6avg, 'Team 4');
    c.ok('the grid follows the week picker',
      w.week6.title === 'All teams · week 6', w.week6.title);
    c.ok('and the season average is the same table in week 6 as in week 8 — an average is not a week',
      eq(a4b.cells.map((td) => td.text), a4.cells.map((td) => td.text)) &&
      w.week6avg.title === 'All teams · proj avg 2026',
      `${w.week6avg.title} ${JSON.stringify(a4b.cells.map((td) => td.text))}`);

    // Week 6 puts i=3 (a WR) on bye, so the WR spots go to the two WRs who
    // still have a number and the man on 0.00 drops into the FLEX.
    c.ok('A BYE IS DRAWN AS ONE, AND STILL SORTS AS THE ZERO IT IS',
      w4b.cells[6].text === 'Bye' && w4b.cells[6].v === '0' && /\bbye\b/.test(w4b.cells[6].cls),
      `${w4b.cells[6].text} / ${w4b.cells[6].v} / ${w4b.cells[6].cls}`);
    c.ok('the lineup is re-picked on that week’s numbers, around the bye',
      eq(nums(w4b, 0, 9), ['21.8', '20.8', '19.8', '17.8', '15.8', '16.8', '0', '14.8', '13.8']),
      JSON.stringify(nums(w4b, 0, 9)));
    c.ok('and the total counts the bye as the zero ESPN returns',
      w4b.cells[9].text === '141.4', w4b.cells[9].text);
    // byeAtZero, which the merge had every chance to lose: the SAME week's data
    // seen through the season average may not call anything a bye, because a
    // season average of 0.00 is a man ESPN projects nothing for all year.
    c.ok('THE SEASON AVERAGE NEVER CALLS ANYTHING A BYE, even in a week that has one',
      w.week6avg.rows.every((r) => r.cells.every((td) =>
        td.text !== 'Bye' && !/\bbye\b/.test(td.cls))),
      'a Bye on the season average');

    // -- the note, which changes with the measure --------------------------
    //
    // The average's note is its own from top to bottom since 2026-09-19: its
    // columns are slots rather than men, so the shared paragraphs would have
    // been describing a table that is not on the screen.
    c.ok('the average note says a cell is a lineup slot averaged, not a player',
      /lineup slot averaged over the season, not a player/.test(w.notes.avg),
      w.notes.avg.slice(0, 200));
    c.ok('AND THAT IT IS THE SAME NUMBERS AS THE PANEL BELOW, which is the whole ask',
      /Avg column of Season by week/.test(w.notes.avg) &&
      /cannot disagree/.test(w.notes.avg), w.notes.avg.slice(0, 500));
    c.ok('it owns up to what it replaced and why',
      /over 17 games/.test(w.notes.avg) && /bye week/.test(w.notes.avg),
      w.notes.avg.slice(0, 900));
    c.ok('it says how much of the season is actually in the averages',
      /13 of 13 regular-season weeks are in these averages/.test(w.notes.avg),
      w.notes.avg.slice(0, 900));
    c.ok('it says the Total is the lineup averaged, not the columns added',
      /added up, then those totals averaged/.test(w.notes.avg) &&
      /Starting lineup/.test(w.notes.avg), w.notes.avg.slice(0, 1200));
    c.ok('it explains the orange, and that a tap says who filled the slot',
      /orange with a dotted underline/.test(w.notes.avg) &&
      /[Tt]ap or hover any number/.test(w.notes.avg), w.notes.avg.slice(0, 1600));
    c.ok('and says out loud that nothing here is a link, with the reason',
      /No cell here is a link/.test(w.notes.avg) &&
      /usually several men/.test(w.notes.avg), w.notes.avg.slice(-600));
    c.ok('the week note names the week it is measured on',
      /ESPN’s own projection for week 8/.test(w.notes.week), w.notes.week.slice(0, 300));
    c.ok('and offers the other measure by name, so the pair can still be read against each other',
      /Proj avg 2026/.test(w.notes.week) && /better this week than they usually are/.test(w.notes.week),
      w.notes.week.slice(0, 500));
    c.ok('and explains a Bye against having no number at all',
      /0\.00 ESPN returns/.test(w.notes.week), w.notes.week.slice(0, 700));
    c.ok('while the AVERAGE note does not, because its cells are slots',
      !/0\.00 ESPN returns/.test(w.notes.avg), w.notes.avg.slice(0, 900));
    c.ok('the week note still says the picker drives the whole page',
      /week picked above drives the whole page/.test(w.notes.week),
      w.notes.week.slice(-300));
    c.ok('and the average says the picker does NOT change these averages',
      /does not change these averages/.test(w.notes.avg), w.notes.avg.slice(-400));
  }

  // ---- (r) the measure is remembered between visits ------------------------
  if (scenario === 'measure-saved') {
    const w = globalThis.__an || {};
    c.ok('the page opens on the measure the reader last chose',
      w.title === 'All teams · proj avg 2026' && JSON.stringify(w.lit) === JSON.stringify(['avg']),
      `${w.title} / ${JSON.stringify(w.lit)}`);
    // Team 4's QB slot is player 00 in every week — (20 - 0) + 0.3w — so over
    // weeks 1 to 13 it averages 20 + 0.3 x 7 = 22.1. Not week 8's 22.4, and not
    // the 20.0 the old per-player measure gave (his season line over 17 games).
    c.ok('and the numbers are that measure’s — 22.1, neither 22.4 nor the old 20.0',
      w.qb === '22.1', String(w.qb));
    c.ok('while the WEEK is still the coming one, so the panels below are unaffected',
      w.week === '8' && JSON.stringify(w.seasonNow) === JSON.stringify(['8']),
      `${w.week} / ${JSON.stringify(w.seasonNow)}`);
  }

  // ---- (s) byeAtZero: the same zero, read two ways -------------------------
  if (scenario === 'bye-vs-zero') {
    const w = globalThis.__an || {};
    c.ok('the grid really is on week 6, his bye week', w.title === 'All teams · week 6', w.title);
    c.ok('A WEEK’S 0.00 IN HIS BYE WEEK IS DRAWN AS A BYE',
      w.week && w.week.text === 'Bye' && w.week.v === '0' && /\bbye\b/.test(w.week.cls),
      JSON.stringify(w.week));
    c.ok('the same squad on the season average is on the season average',
      w.avgTitle === 'All teams · proj avg 2026', w.avgTitle);
    // Since 2026-09-19 the average is a SLOT over the whole season, so the same
    // fixture proves something stronger than it used to: one bye week cannot
    // make the D/ST slot a bye, and a man ESPN projects nothing for all year
    // (AN_ZERO_SEASON) no longer reaches this measure at all — it reads the
    // week-by-week projections, never the season line.
    c.ok('AND THE SLOT AVERAGE IS A NUMBER, NEVER A BYE',
      w.avg && /^\d+\.\d$/.test(w.avg.text) && !/\bbye\b/.test(w.avg.cls),
      JSON.stringify(w.avg));
    c.ok('a single bye week drags the average down without zeroing it',
      w.avg && Number(w.avg.v) > 0, JSON.stringify(w.avg));
  }

  // ---- (g) a player ESPN gave no id for -----------------------------------
  //
  // Every team's Player 00 comes back with playerId: null. He must be drawn
  // exactly as he always was, but with no link on him — a link to
  // ?player=undefined looks like it would work and would not.
  if (scenario === 'no-id') {
    const season = await import('./an-stub-season.mjs');
    c.ok('badge says Live', txt($('modeBadge')) === 'Live', txt($('modeBadge')));

    const named = (root, name) =>
      [...d.querySelectorAll(root)].filter((td) => txt(td).startsWith(name));
    const noIdName = season.playerName(4, 0);

    // "Who to start" cannot carry him and says so instead of pretending.
    // He has no id, so nothing ties the man in week 5 to the man in week 6 —
    // he is left out of the table AND out of the lineups it marks, because a
    // shaded week with no row to sit on reads as a lineup slot going empty.
    {
      const starters = $('startersTable');
      const btn = d.querySelector('#starterPosToggle button[data-pos="QB"]');
      btn.dispatchEvent(new boot.window.Event('click', { bubbles: true }));
      const rows = [...starters.querySelectorAll('tbody tr')];
      const note = txt($('startersNote'));
      c.ok('the id-less quarterback gets no row in Who to start',
        rows.every((tr) => !txt(tr.children[1]).startsWith(noIdName)),
        rows.map((tr) => txt(tr.children[1])).join(','));
      c.ok('and the note says he was left out, and why',
        /came back from ESPN with no player id/.test(note), note.slice(-320));
      // The count still has to add up for everyone who IS shown: no shaded
      // cell may be left without a row to sit on.
      const shaded = rows.flatMap((tr) =>
        [...tr.children].slice(6).filter((td) => /\bst\b/.test(td.getAttribute('class') || '')));
      c.ok('every shaded cell that remains sits on a real row',
        rows.length === 0 ? shaded.length === 0 : true, `${rows.length} rows, ${shaded.length} shaded`);
      d.querySelector('#starterPosToggle button[data-pos="RB"]')
        .dispatchEvent(new boot.window.Event('click', { bubbles: true }));
    }

    const rosterCell = named('#rosterTable tbody td.name', noIdName)[0];
    c.ok('the man with no id is still on the page, drawn as he always was',
      Boolean(rosterCell) && txt(rosterCell) === noIdName,
      `${rosterCell && txt(rosterCell)}`);
    c.ok('NO LINK IS EMITTED FOR HIM in the roster detail',
      rosterCell && !rosterCell.querySelector('a.pref'),
      `${rosterCell && rosterCell.innerHTML}`);

    // "Season by week" leaves him out of the lineups for the same reason "Who
    // to start" does: nothing ties the man in one week to the man in the next,
    // so the QB slot goes to the OTHER quarterback — team 4's player 11, at
    // (20 - 11) + 8 x 0.3 = 11.4 in the week the page opened on.
    {
      const qb = [...d.querySelectorAll('#seasonSlots tr')]
        .find((tr) => tr.children[0].textContent.trim() === 'QB');
      const cell = qb && qb.children[1 + 8];
      c.ok('THE SEASON PANEL FILLS THE QB SLOT WITH THE MAN IT CAN FOLLOW',
        cell && cell.getAttribute('data-pid') === '411' && cell.getAttribute('data-v') === '11.4',
        cell && `${cell.getAttribute('data-pid')} / ${cell.getAttribute('data-v')}`);
      c.ok('and the id-less man is nowhere in it',
        !d.querySelector('#seasonTable').innerHTML.includes(noIdName) &&
        [...d.querySelectorAll('#seasonSlots td[data-pid]')].every((td) => td.getAttribute('data-pid')),
        'the id-less QB reached the season panel');
      c.ok('the note says so, and why',
        /gave no player id for is left out of the lineups/.test(txt($('seasonNote'))),
        txt($('seasonNote')).slice(-300));
    }

    // He is every team's QB, so it is the QB column of both grids that loses
    // its link — and only that column.
    for (const id of ['overview']) {
      const cells = [...d.querySelectorAll(`#${id}Table tbody tr[data-team] td.slot-cell`)];
      const qb = [...d.querySelectorAll(`#${id}Table tbody tr[data-team]`)]
        .map((tr) => [...tr.children].filter((td) =>
          /\bslot-cell\b/.test(td.getAttribute('class') || ''))[0]);
      c.ok(`the ${id} grid’s QB cell carries the number but no link`,
        qb.length === 10 && qb.every((td) => /^\d+\.\d$/.test(txt(td)) && !td.querySelector('a.pref')),
        qb.map((td) => `${txt(td)}:${td.querySelector('a.pref') ? 'linked' : '-'}`).join(' '));
      c.ok(`and every OTHER ${id} cell is still linked — the rule skips a man, not a row`,
        cells.filter((td) => !qb.includes(td)).every((td) => td.querySelector('a.pref')),
        cells.filter((td) => !qb.includes(td) && !td.querySelector('a.pref')).length);
    }

    c.ok('the card is untouched for him — the run does not depend on the link',
      (() => {
        const td = [...d.querySelectorAll('#overviewTable tbody tr[data-team="4"] td.slot-cell')][0];
        const k = hoverCard(d, boot.window, td);
        return k && k.ident.startsWith(`${noIdName} · QB · BUF`) && k.weeks.length === 16;
      })(), 'no run on the unlinked cell');
    c.ok('and the swap control is untouched — it never became a link either way',
      d.querySelectorAll('#rosterTable button[data-swap]').length === 15 &&
      d.querySelectorAll('#rosterTable button a').length === 0,
      `${d.querySelectorAll('#rosterTable button[data-swap]').length} buttons`);
  }

  // ---- (e) the split, the total in it, and swapping across it -------------
  if (scenario === 'swap') {
    const w = globalThis.__an || {};
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const lineup = (s) => ({
      starters: s.starters.map((r) => `${r.name}=${r.slot}`),
      bench: s.bench.map((r) => `${r.name}=${r.slot}`),
      total: s.split.total,
    });
    const glance = (s, k) => (s.glance.find(([key]) => key === k) || [])[1];
    const btn = (s, id) =>
      [...s.starters, ...s.bench].find((r) => r.btn && r.btn.id === String(id));

    // -- the shape of the split ------------------------------------------
    const i0 = w.initial;
    c.ok('the roster table has three bodies: starters, the split, the bench',
      eq(i0.split.bodies, ['rosterStarters', 'rosterSplit', 'rosterBench']),
      JSON.stringify(i0.split.bodies));
    c.ok('the starters are in one and the bench in the other',
      i0.starters.length === 9 && i0.bench.length === 6,
      `${i0.starters.length} / ${i0.bench.length}`);
    c.ok('every bench row is marked as one, and no starter is',
      i0.bench.every((r) => /\bbench\b/.test(r.cls)) &&
      i0.starters.every((r) => !/\bbench\b/.test(r.cls)),
      i0.bench.map((r) => r.cls).join('|'));

    // -- the total that sits in the gap -----------------------------------
    c.ok('the total sits in the Projected column it is the total of',
      eq(i0.split.spans, [4, 1, 6]), JSON.stringify(i0.split.spans));
    c.ok('and it is the starters added up',
      i0.split.total === '165.6', i0.split.total);
    c.ok('which is also what the glance says the team is projected',
      glance(i0, 'Projected') === '165.6', glance(i0, 'Projected'));
    c.ok('an untouched lineup shows no difference, because there is none',
      i0.split.delta === '' && i0.split.label === 'Starting lineup',
      `${i0.split.label} / ${i0.split.delta}`);
    c.ok('and offers no way to put back a lineup nobody has moved',
      /\bhidden\b/.test(i0.reset), i0.reset);
    c.ok('the note says what the band is and where the number comes from',
      /line between the starting lineup and the bench/.test(i0.note) &&
      /Projected column added up/.test(i0.note), i0.note.slice(0, 300));
    c.ok('the note says how to swap, and that nothing is sent to ESPN',
      /Click any slot tag/.test(i0.note) &&
      /this is a what-if and nothing else/i.test(i0.note) &&
      /nothing on this page is ever sent to ESPN/.test(i0.note),
      i0.note.slice(0, 400));

    // -- picking a man up --------------------------------------------------
    const h = w.holding;
    c.ok('the man in hand is marked as held',
      /\bholding\b/.test(btn(h, 409).btn.cls), btn(h, 409).btn.cls);
    c.ok('both RB slots and the FLEX are offered to a bench RB',
      [401, 402, 406].every((id) => /\btarget\b/.test(btn(h, id).btn.cls)),
      [401, 402, 406].map((id) => `${id}:${btn(h, id).btn.cls}`).join(' '));
    c.ok('the slots he cannot legally take are not',
      [400, 403, 404, 405, 407, 408].every((id) => btn(h, id).btn.off),
      [400, 403, 404, 405, 407, 408].filter((id) => !btn(h, id).btn.off).join(','));
    c.ok('and neither is another bench place, which would change nothing',
      [410, 411, 412, 413, 414].every((id) => btn(h, id).btn.off),
      [410, 411, 412, 413, 414].filter((id) => !btn(h, id).btn.off).join(','));
    c.ok('the line in the gap says who is in hand',
      /Holding T4 Player 09/.test(h.split.hint), h.split.hint);
    c.ok('picking somebody up changes no lineup on its own',
      eq(lineup(h), lineup(i0)), JSON.stringify(lineup(h)));
    c.ok('clicking his own slot again puts him back down',
      eq(lineup(w.putDown), lineup(i0)) &&
      [...w.putDown.starters, ...w.putDown.bench].every((r) => !/\bholding\b/.test(r.btn?.cls || '')),
      JSON.stringify(lineup(w.putDown)));

    // -- the swap itself ---------------------------------------------------
    const s = w.swapped;
    c.ok('the swapped-in man is now a starter, in the slot he was dropped on',
      s.starters.some((r) => r.name === 'T4 Player 09' && r.slot === 'RB'),
      s.starters.map((r) => `${r.name}=${r.slot}`).join(' '));
    c.ok('and the man he replaced is on the bench',
      s.bench.some((r) => r.name === 'T4 Player 02' && r.slot === 'BE'),
      s.bench.map((r) => `${r.name}=${r.slot}`).join(' '));
    c.ok('the group sizes are unchanged — a swap moves two men, not one',
      s.starters.length === 9 && s.bench.length === 6,
      `${s.starters.length} / ${s.bench.length}`);
    c.ok('both of them are marked as moved from where ESPN has them',
      [...s.starters, ...s.bench].filter((r) => /\bmoved\b/.test(r.cls)).length === 2,
      [...s.starters, ...s.bench].filter((r) => /\bmoved\b/.test(r.cls)).map((r) => r.name).join(','));
    c.ok('THE TOTAL MOVES BY THE DIFFERENCE BETWEEN THE TWO',
      s.split.total.startsWith('158.6') && s.split.delta === '-7.0',
      `${s.split.total} / ${s.split.delta}`);
    c.ok('and the panel stops calling it the starting lineup',
      s.split.label === 'Your lineup', s.split.label);
    c.ok('the glance follows it — projected, actual, and the bench behind it',
      glance(s, 'Projected') === '158.6' && glance(s, 'Actual') === '104.9' &&
      glance(s, 'Bench points') === '46.6',
      JSON.stringify(s.glance));
    c.ok('Diff is still actual minus projected, of the lineup on screen',
      glance(s, 'Diff') === '-53.7', glance(s, 'Diff'));
    c.ok('Proj avg deliberately does not move: it never depended on the lineup',
      glance(s, 'Proj avg') === glance(i0, 'Proj avg'),
      `${glance(i0, 'Proj avg')} -> ${glance(s, 'Proj avg')}`);
    c.ok('the way back appears once there is something to go back from',
      !/\bhidden\b/.test(s.reset), s.reset);
    c.ok('the note says out loud that this is no longer the real lineup',
      /is not Team 4’s real lineup any more/.test(s.note), s.note.slice(0, 400));
    c.ok('and says it on screen, not inside the How-this-works toggle',
      s.editedShown === true && i0.editedShown === false, `${i0.editedShown} -> ${s.editedShown}`);
    c.ok('SWAPPING FETCHES NOTHING',
      eq(w.fetchesBefore, w.fetchesAfterSwap),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterSwap)}`);

    // -- the season panel deliberately does NOT follow the what-if ----------
    //
    // It shows the BEST legal lineup each week. A swap the reader made by hand
    // is one week's experiment; folding it in would quietly turn it into the
    // page's own advice, which is the same rule "Who to start" follows.
    c.ok('SWAPPING A MAN DOES NOT MOVE THE SEASON PANEL',
      eq(s.season, i0.season) && s.seasonTotal === i0.seasonTotal,
      `${JSON.stringify(i0.season)} -> ${JSON.stringify(s.season)}`);
    c.ok('and it was showing the best lineup all along, not ESPN\u2019s',
      i0.season.length === 9 && i0.season.every((x) => /^[A-Z/]+\d?=4\d\d:\d/.test(x)),
      i0.season.join(' '));

    // -- an illegal pair ---------------------------------------------------
    c.ok('a bench QB is offered his own position and nothing else',
      /\btarget\b/.test(btn(w.holdingQB, 400).btn.cls) &&
      btn(w.holdingQB, 401).btn.off && btn(w.holdingQB, 402).btn.off,
      `${btn(w.holdingQB, 400).btn.cls} / ${btn(w.holdingQB, 401).btn.off}`);
    c.ok('AND CLICKING A SLOT HE CANNOT TAKE MOVES NOTHING',
      eq(lineup(w.refused), lineup(s)), JSON.stringify(lineup(w.refused)));

    // -- putting it back ---------------------------------------------------
    c.ok('the reset restores ESPN’s own lineup exactly',
      eq(lineup(w.reset), lineup(i0)), JSON.stringify(lineup(w.reset)));
    c.ok('and takes the difference, the label and the button away with it',
      w.reset.split.delta === '' && w.reset.split.label === 'Starting lineup' &&
      /\bhidden\b/.test(w.reset.reset),
      `${w.reset.split.label} / ${w.reset.split.delta} / ${w.reset.reset}`);
    c.ok('nobody is left marked as moved',
      [...w.reset.starters, ...w.reset.bench].every((r) => !/\bmoved\b/.test(r.cls)),
      'a moved row survived the reset');

    // -- sorting must not merge the two groups -----------------------------
    const sorted = w.sorted;
    const nums = (rows) => rows.map((r) => Number(r.proj));
    const desc = (v) => v.every((x, i) => i === 0 || x <= v[i - 1]);
    c.ok('sorting a column sorts the starters among themselves',
      desc(nums(sorted.starters)) && sorted.starters.length === 9,
      JSON.stringify(nums(sorted.starters)));
    c.ok('and the bench among itself',
      desc(nums(sorted.bench)) && sorted.bench.length === 6,
      JSON.stringify(nums(sorted.bench)));
    c.ok('THE SPLIT STAYS BETWEEN THEM, WITH ITS TOTAL INTACT',
      eq(sorted.split.bodies, ['rosterStarters', 'rosterSplit', 'rosterBench']) &&
      sorted.split.total === '165.6',
      `${JSON.stringify(sorted.split.bodies)} ${sorted.split.total}`);

    // -- the what-if belongs to one squad ----------------------------------
    c.ok('the swap took a second time, after the sort',
      w.swappedAgain.split.total.startsWith('158.6'), w.swappedAgain.split.total);
    c.ok('SWITCHING TEAM THROWS THE WHAT-IF AWAY',
      w.afterTeam.split.delta === '' && w.afterTeam.split.label === 'Starting lineup' &&
      [...w.afterTeam.starters, ...w.afterTeam.bench].every((r) => !/\bmoved\b/.test(r.cls)),
      `${w.afterTeam.split.label} / ${w.afterTeam.split.delta}`);
    c.ok('and shows the other squad at its own full strength',
      w.afterTeam.starters.every((r) => r.name.startsWith('T7 ')) &&
      w.afterTeam.split.total === '165.6',
      `${w.afterTeam.starters[0].name} ${w.afterTeam.split.total}`);
  }

  // ---- (j) byes known --------------------------------------------------------
  if (scenario === 'byes-known') {
    const w = globalThis.__an;
    c.ok('A SAVED WEEK THAT HAS BEEN PLAYED IS IGNORED: the page opens on the coming week',
      w.title === 'All teams · week 8', w.title);
    c.ok('no grid row carries a title (touch-titles would sheet over the tap)',
      w.rowTitles === 0, w.rowTitles);

    // Both carry the loud low mark as well, and that is the feature: a slot
    // with nobody to cover a bye is exactly the number Tim asked to see in red.
    c.ok('THE BYE WEEK IS STILL A BYE in the slot nobody else can fill',
      w.dstW6 && w.dstW6.text.startsWith('Bye') && /\bbye\b/.test(w.dstW6.cls) && w.dstW6.v === '0',
      JSON.stringify(w.dstW6));
    // The end of the red side of the scale, and the glyph with it. Under the
    // old two-step mark this was `lo2` and ▼▼; the scale that replaced it on
    // 2026-09-19 has four steps a side and one glyph, at the end.
    c.ok('and it is at the far red end of the scale, since nothing covered it',
      w.dstW6 && /\bheat-dn-4\b/.test(w.dstW6.cls) && w.dstW6.text.includes('▼'),
      JSON.stringify(w.dstW6));
    c.ok('A ZERO IN ANY OTHER WEEK IS A REAL 0.0, not a bye',
      w.dstW9 && w.dstW9.text.startsWith('0.0') && /\bzero\b/.test(w.dstW9.cls) &&
      !/\bbye\b/.test(w.dstW9.cls) && w.dstW9.v === '0', JSON.stringify(w.dstW9));
    c.ok('and the cell says where it stands, in words and in standard deviations',
      w.dstW9 && /SD below the average for a D\/ST across the league/.test(w.dstW9.label) &&
      /Full colour is [\d.]+ or below and [\d.]+ or above/.test(w.dstW9.label),
      w.dstW9 && w.dstW9.label);
    c.ok('and an untouched week is a number as before',
      w.dstW8 && /^\d+\.\d/.test(w.dstW8.text), JSON.stringify(w.dstW8));
    c.ok('A RULED-OUT STARTER IS SIMPLY REPLACED: RB2 is the bench back, not his 0.00',
      w.rb2w8 && w.rb2w8.v === '13.4' && w.rb2w8.label.startsWith('T4 Player 09'),
      JSON.stringify(w.rb2w8));
    c.ok('the season key names the bye it is showing',
      /Bye/.test(w.seasonLegend), w.seasonLegend);

    c.ok('the WEEK grid draws his zero the same way',
      w.weekCell02 && w.weekCell02.text === '0.0 OUT' && /\bzero-out\b/.test(w.weekCell02.cls) &&
      !/\bbye\b/.test(w.weekCell02.cls), JSON.stringify(w.weekCell02));
    c.ok('and its key explains it, without a Bye nobody has',
      /ruled out, not a bye/.test(w.gridLegend) && !/Bye/.test(w.gridLegend), w.gridLegend);

    const k = w.card;
    c.ok('the card agrees: weeks 8 and 10 are 0.0 with OUT under it, class k-out',
      k.texts[7] === '0.0OUT' && k.texts[9] === '0.0OUT' &&
      /\bk-out\b/.test(k.kinds[7]) && /\bk-out\b/.test(k.kinds[9]) && !k.texts.includes('Bye'),
      JSON.stringify(k.texts));
    c.ok('and its legend says why, only because it occurs',
      /ruled out, not on bye/.test(k.legend) && !/Bye =/.test(k.legend), k.legend);
    c.ok('the card of a man whose zero IS his bye still reads Bye in week 6',
      w.card03[5] === 'Bye' && w.card03.filter((t) => t === 'Bye').length === 1, JSON.stringify(w.card03));

    c.ok('BEST LINEUP: start the bench back over the ruled-out one, and by how much',
      w.best === 'Best lineup for week 8: start T4 Player 09 over T4 Player 02, +13.4', w.best);
    c.ok('both names are the site’s player link, with no title on either',
      w.bestLinks.length === 2 &&
      w.bestLinks[0].href === 'waivers.html?player=409' &&
      w.bestLinks[1].href === 'waivers.html?player=402' &&
      w.bestLinks.every((l) => !l.title), JSON.stringify(w.bestLinks));

    c.ok('A ROW TAP WITH THE DETAIL OFF SCREEN SCROLLS TO IT, once',
      w.scrollsOff === 1 && /Team 2$/.test(w.rosterAfter), `${w.scrollsOff} ${w.rosterAfter}`);
    c.ok('and does not move the page when the detail is already in view',
      w.scrollsOn === 1, w.scrollsOn);
  }

  // ---- THE POSITIONAL FLOOR -----------------------------------------------
  //
  // Tim, 2026-09-18: "don't assess that K position to be 0 pts, assess it to
  // be the max number of points that is available on the waivers for that
  // position... In the season by week display, if you're replacing a low or 0
  // proj with an assumed proj, just put the assumed proj # and color code them
  // in orange or something to show it's assumed."
  //
  // Every assertion here is about a number on screen changing, and the floors
  // the scenario declares are far from any real wire, so a page that ignored
  // them could not pass by coincidence.
  if (scenario === 'floors') {
    const w = globalThis.__an;

    // THE BYE. Week 6 is this D/ST's bye, so ESPN says 0.00 and the site now
    // says 20.0 — the wire's best defence, who is who you would stream.
    c.ok('a D/ST on bye is assessed at the wire floor', Number(w.dstW6.v) === 20,
      `data-v was ${w.dstW6.v}`);
    c.ok('and is drawn in orange', /\bassumed\b/.test(w.dstW6.cls), w.dstW6.cls);
    // The glyph may ride along — this fixture declares a 20.0 D/ST floor,
    // which is far above what the league's defences give, so the cell is at
    // the green end of the scale as well as assumed. Both claims on one cell
    // is the case the two channels were designed to survive.
    c.ok('showing the assumed number, not the word Bye',
      w.dstW6.text.replace(/[▲▼]/g, '').trim() === '20.0',
      `cell read "${w.dstW6.text}"`);
    c.ok('AND IT CARRIES BOTH CLAIMS AT ONCE: orange for assumed, the scale for good',
      /\bassumed\b/.test(w.dstW6.cls) && /\bheat-up-\d\b/.test(w.dstW6.cls), w.dstW6.cls);
    c.ok('while the cell still says the bye is why', /bye/i.test(w.dstW6.title), w.dstW6.title);
    c.ok('and names where the assumed number came from',
      /waiver wire/i.test(w.dstW6.title), w.dstW6.title);

    // A LOW WEEK, NOT A ZERO. Tim's second decision: the floor lifts anything
    // below it, so a kicker projecting under 14 is assessed at 14.
    c.ok('a kicker below the floor is lifted to it', Number(w.kW6.v) === 14,
      `data-v was ${w.kW6.v}`);
    c.ok('and marked assumed too', /\bassumed\b/.test(w.kW6.cls), w.kW6.cls);

    // AND IT LEAVES EVERYTHING ELSE ALONE. The QB floor is 3.0, far below any
    // real quarterback here, so his cell must be untouched — a floor that
    // lifted every cell would pass all of the above and be useless.
    c.ok('a man above his floor keeps ESPN’s own number',
      !/\bassumed\b/.test(w.qbW6.cls), `${w.qbW6.v} ${w.qbW6.cls}`);
    c.ok('so only some cells are assumed, not all of them',
      w.assumedCount > 0 && w.assumedCount < 40, String(w.assumedCount));

    // THE BAND TOTALS THE COLUMN AS DRAWN. A band that summed ESPN's numbers
    // while the cells above it showed floored ones would be a panel
    // contradicting itself, which is worse than either number alone.
    const drawn = w.slotValues.filter((v) => Number.isFinite(v));
    const sum = Math.round(drawn.reduce((a, v) => a + v, 0) * 10) / 10;
    c.ok('the Starting lineup band equals the cells above it',
      Math.abs(Number(w.bandW6) - sum) < 0.051, `band ${w.bandW6} vs cells ${sum}`);

    // SAID IN WORDS AS WELL AS IN COLOUR, in both places.
    c.ok('the legend carries the assumed mark', /assumed/i.test(w.legend), w.legend.slice(0, 200));
    c.ok('the note says no slot is assessed below what you could stream',
      /assessed below what you could stream/i.test(w.note), w.note.slice(0, 200));
    c.ok('and prints the floors themselves, so a reader can check a cell',
      /K 14\.0/.test(w.note) && /DST 20\.0/.test(w.note), w.note.slice(0, 400));
    c.ok('and says it is one wire read used for every week',
      /read once and used for every week/.test(w.note), w.note.slice(0, 400));
  }

  if (scenario === 'byes-other-week') {
    const w = globalThis.__an;
    c.ok('a saved week still to come is honoured', w.title === 'All teams · week 11', w.title);
    c.ok('A ZERO OUTSIDE THE BYE WEEK IS A REAL 0.0, not a Bye',
      w.dstW6 && w.dstW6.text.startsWith('0.0') && /\bzero\b/.test(w.dstW6.cls) &&
      !/\bbye\b/.test(w.dstW6.cls) && w.dstW6.v === '0', JSON.stringify(w.dstW6));
    c.ok('so neither week table says Bye anywhere', !w.anyBye, 'a Bye cell');
    c.ok('and the key says what that 0.0 is',
      /projected at zero, not a bye/.test(w.seasonLegend) && !/Bye/.test(w.seasonLegend), w.seasonLegend);
    c.ok('a lineup already at its best says so',
      w.best === 'This lineup is already the best one for week 11.', w.best);
  }

  if (scenario === 'byes-unknown') {
    const w = globalThis.__an;
    c.ok('WITH THE BYES UNKNOWN, A LIVE ZERO IS STILL READ AS A BYE (nothing regresses)',
      w.weekCell02 && w.weekCell02.text === 'Bye' && /\bbye\b/.test(w.weekCell02.cls), JSON.stringify(w.weekCell02));
    c.ok('in the season panel as well, in the slot that had no cover',
      String(w.dstW9).startsWith('Bye'), w.dstW9);
  }

  // ---- (n) / (o) which team a visit opens on ---------------------------------
  if (scenario === 'team-own') {
    const w = globalThis.__an || {};
    const T = (n) => `Season by week · Team ${n}`;
    c.ok('A VISIT OPENS ON YOUR OWN TEAM, not the one tapped on an earlier visit',
      w.opened === T(4), w.opened);
    c.ok('the detail follows the connection bar when it says your team changed',
      w.afterBar === T(6), w.afterBar);
    c.ok('a tapped team is shown', w.tapped === T(7), w.tapped);
    c.ok('BUT IT IS NOT SAVED: the old saved pick is left as it was',
      w.savedAfterTap === 2, JSON.stringify(w.savedAfterTap));
    c.ok('and it holds for the rest of the visit, through a reload of the league',
      w.reloaded === T(7), w.reloaded);
  }
  if (scenario === 'team-noown') {
    const w = globalThis.__an || {};
    const T = (n) => `Season by week · Team ${n}`;
    c.ok('with no team of your own known, the saved pick is where the visit opens',
      w.opened === T(2), w.opened);
    c.ok('a tapped team is shown', w.tapped === T(7), w.tapped);
    c.ok('and, with nothing better to open on, it is saved for next time',
      w.savedAfterTap === 7, JSON.stringify(w.savedAfterTap));
    c.ok('and holds through a reload of the league', w.reloaded === T(7), w.reloaded);
  }

  // ---- (p) SEASON BY WEEK, re-derived from demo-rosters.js ----------------
  //
  // The panel's three claims, each rebuilt from source rather than read back:
  // who fills a slot, what the band totals, and where the red line sits. The
  // last one is the one that could most easily be confidently wrong, so the
  // whole league's distribution is recomputed here and every cell's class is
  // checked against it — plus proof that cells exist on BOTH sides of each
  // threshold, so a panel that coloured nothing could not pass.
  if (scenario === 'season-slots') {
    const w = globalThis.__an || {};
    const { generateDemoWeekRosters } = await import('../js/demo-rosters.js');
    const { slotCountsFromLineups } = await import('../js/projection.js');
    const { optimalLineup, slotsFromCounts } = await import('../js/forecast.js');
    const { stdev } = await import('../js/stats.js');

    const WEEKS = [...REGULAR_WEEKS, ...PLAYOFF_WEEKS];
    const weekTeams = new Map();
    const pool = [];
    for (const wk of WEEKS) {
      const { teams } = generateDemoWeekRosters(wk);
      weekTeams.set(wk, teams);
      pool.push(...teams);
    }
    const slots = slotsFromCounts(slotCountsFromLineups(pool));

    // The row labels, rebuilt from the league's own shape: lineup order, and a
    // number only where the league starts more than one of a position.
    const ORDER = { 0: 1, 1: 1, 2: 2, 4: 3, 6: 4, 3: 5, 5: 5, 23: 5, 7: 6, 16: 7, 17: 8 };
    const LABEL = { 0: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP',
      16: 'D/ST', 17: 'K', 23: 'FLEX' };
    const perSlot = new Map();
    for (const id of slots) perSlot.set(id, (perSlot.get(id) || 0) + 1);
    const keys = [];
    const keyOf = [];
    for (const id of [...perSlot.keys()].sort((a, b) => (ORDER[a] ?? 40) - (ORDER[b] ?? 40) || a - b)) {
      const n = perSlot.get(id);
      for (let i = 1; i <= n; i++) { keys.push(n > 1 ? `${LABEL[id]}${i}` : LABEL[id]); keyOf.push([id, i]); }
    }

    /** slot key -> {id, v} for one team in one week, rebuilt from source. */
    const fillOf = (team) => {
      const { starters } = optimalLineup(
        (team.players || []).filter((p) => p.playerId !== null && p.playerId !== undefined), slots);
      const bySlot = new Map();
      for (const s of starters) {
        if (!bySlot.has(s.slotId)) bySlot.set(s.slotId, []);
        bySlot.get(s.slotId).push(s);
      }
      for (const l of bySlot.values()) {
        l.sort((a, b) => b.projected - a.projected || a.playerId - b.playerId);
      }
      const out = new Map();
      keys.forEach((k, i) => {
        const [id, rank] = keyOf[i];
        const p = (bySlot.get(id) || [])[rank - 1] || null;
        out.set(k, p ? { id: p.playerId, v: Math.round(p.projected * 10) / 10 } : null);
      });
      return out;
    };

    c.ok('THE ROWS ARE THE LEAGUE’S OWN SLOTS, rebuilt from demo-rosters.js',
      JSON.stringify(w.rows.map((r) => r.slot)) === JSON.stringify(keys),
      `${JSON.stringify(w.rows.map((r) => r.slot))} vs ${JSON.stringify(keys)}`);

    const mine = new Map(WEEKS.map((wk) =>
      [wk, weekTeams.get(wk).find((t) => t.name === w.team)]));
    const byKey = new Map(w.rows.map((r) => [r.slot, r]));

    const wrong = [];
    const flexWrong = [];
    WEEKS.forEach((wk, i) => {
      const want = fillOf(mine.get(wk));
      for (const k of keys) {
        const cell = byKey.get(k).cells[i];
        const e = want.get(k);
        if (!e) { if (cell.v !== null) wrong.push(`${k} wk${wk} want empty got ${cell.v}`); continue; }
        if (Math.abs(Number(cell.v) - e.v) > 0.051) wrong.push(`${k} wk${wk} want ${e.v} got ${cell.v}`);
        if (cell.pid !== String(e.id)) wrong.push(`${k} wk${wk} want #${e.id} got #${cell.pid}`);
      }
      const f = want.get('FLEX');
      const fc = byKey.get('FLEX').cells[i];
      if (f && fc.pid !== String(f.id)) flexWrong.push(`wk${wk} want #${f.id} got #${fc.pid}`);
    });
    c.ok('EVERY SLOT IN EVERY WEEK HOLDS THE MAN THE BEST LEGAL LINEUP PUTS THERE',
      wrong.length === 0, wrong.slice(0, 6).join(' | '));
    c.ok('THE FLEX IS THE SOLVER’S OWN FLEX, not "the next best man"',
      flexWrong.length === 0, flexWrong.slice(0, 4).join(' | '));

    // The claim in Tim's own words: "2nd highest WR proj in WR2".
    const wrKeys = keys.filter((k) => /^WR\d$/.test(k));
    c.ok('the league starts more than one receiver, so the ranking has teeth',
      wrKeys.length > 1, JSON.stringify(wrKeys));
    const rankWrong = [];
    WEEKS.forEach((wk, i) => {
      for (const group of [wrKeys, keys.filter((k) => /^RB\d$/.test(k))]) {
        for (let n = 1; n < group.length; n++) {
          const a = byKey.get(group[n - 1]).cells[i].v;
          const b = byKey.get(group[n]).cells[i].v;
          if (a !== null && b !== null && Number(a) < Number(b)) {
            rankWrong.push(`wk${wk} ${group[n - 1]} ${a} < ${group[n]} ${b}`);
          }
        }
      }
    });
    c.ok('WR1 IS THE BEST RECEIVER OF THAT WEEK’S LINEUP, WR2 THE SECOND, and so down',
      rankWrong.length === 0, rankWrong.slice(0, 4).join(' | '));

    // The band, against the rebuild rather than against the row above it.
    const bandWrong = [];
    WEEKS.forEach((wk, i) => {
      const want = [...fillOf(mine.get(wk)).values()].filter(Boolean).reduce((a, e) => a + e.v, 0);
      const got = Number(w.totals[i]);
      if (Math.abs(got - Math.round(want * 10) / 10) > 0.051) {
        bandWrong.push(`wk${wk} want ${Math.round(want * 10) / 10} got ${got}`);
      }
    });
    c.ok('THE STARTING LINEUP BAND IS THE BEST LEGAL LINEUP’S OWN TOTAL',
      bandWrong.length === 0, bandWrong.slice(0, 4).join(' | '));

    // ---- the red/green scale, recomputed across ALL TEN SQUADS -------------
    //
    // REWRITTEN 2026-09-19 for the shared scale (js/heat.js). The comparison
    // group is unchanged and is the point of the panel — a WR2 against every
    // squad's WR2, roughly 160 values — but the boundaries and the number of
    // steps are not, so every expected answer here is rebuilt from the edges
    // rather than from "one SD" and "two SD".
    //
    // The steps are recomputed BY HAND below (`Math.abs(z) >= edge`), not by
    // calling heatOf: reading the module's own answer back to it would prove
    // only that the page called the module, which the classes already show.
    const EDGES = [0.25, 0.5, 0.75, 1];
    const bars = new Map();
    for (const k of keys) {
      const vals = [];
      for (const wk of WEEKS) {
        for (const team of weekTeams.get(wk)) {
          const e = fillOf(team).get(k);
          if (e) vals.push(e.v);
        }
      }
      const sd = stdev(vals);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      bars.set(k, sd === null || !(sd > 0)
        ? { n: vals.length, mean: m, sd: null, lo: null, hi: null }
        : {
          n: vals.length,
          mean: m,
          sd,
          lo: Math.round((m - sd) * 10) / 10,
          hi: Math.round((m + sd) * 10) / 10,
        });
    }
    c.ok('the distribution is the WHOLE LEAGUE’S, not this squad’s',
      [...bars.values()].every((b) => b.n >= weekTeams.get(1).length * WEEKS.length * 0.8),
      JSON.stringify([...bars.entries()].map(([k, b]) => `${k}:${b.n}`)));

    /** '' or 'heat-up-N' / 'heat-dn-N', worked out from the raw distribution. */
    const wantClass = (v, b) => {
      if (b.sd === null) return '';
      const z = (v - b.mean) / b.sd;
      let step = 0;
      for (const e of EDGES) if (Math.abs(z) >= e) step += 1;
      if (!step) return 'heat-0';
      return `heat-${z > 0 ? 'up' : 'dn'}-${step}`;
    };

    const colourWrong = [];
    const seen = new Map();     // class -> how many cells carry it
    let nearest = null;         // the smallest NEUTRAL number, vs its own band
    WEEKS.forEach((wk, i) => {
      for (const k of keys) {
        const cell = byKey.get(k).cells[i];
        if (cell.v === null) continue;
        const v = Number(cell.v);
        const b = bars.get(k);
        const want = wantClass(v, b);
        const m = cell.cls.match(/\bheat-(?:up|dn)-\d\b|\bheat-0\b/);
        const got = m ? m[0] : '';
        if (want !== got) {
          colourWrong.push(`${k} wk${wk} v=${v} want ${want || 'none'} got ${got || 'none'}`);
        }
        seen.set(got, (seen.get(got) || 0) + 1);
        if (got === 'heat-0' && b.sd !== null) {
          const gap = b.mean - v;
          if (nearest === null || gap > nearest.gap) nearest = { gap, k, wk, v, sd: b.sd };
        }
      }
    });
    c.ok('EVERY CELL’S STEP MATCHES ONE RECOMPUTED FROM SOURCE',
      colourWrong.length === 0, colourWrong.slice(0, 6).join(' | '));
    // THE SPECTRUM IS REALLY A SPECTRUM. Tim asked for "more red or more green"
    // rather than two levels, so a sample that only ever reached the ends would
    // pass the assertion above while showing him nothing he asked for.
    const stepsSeen = [...seen.keys()].filter((c) => /heat-(up|dn)-\d/.test(c));
    c.ok('THE SAMPLE USES MORE THAN TWO STEPS, so "on a spectrum" is falsifiable',
      stepsSeen.length >= 4,
      JSON.stringify([...seen.entries()].sort()));
    c.ok('and it straddles both sides as well as the neutral band',
      stepsSeen.some((s) => s.includes('up')) && stepsSeen.some((s) => s.includes('dn')) &&
      (seen.get('heat-0') || 0) > 0,
      JSON.stringify([...seen.entries()].sort()));
    // THE TIGHTENING, MEASURED. Under the old rule a cell was coloured only
    // below one SD; this counts how many cells the new scale colours and
    // insists it is comfortably more, which is the whole of Tim's ask.
    const coloured = [...seen.entries()]
      .filter(([c]) => /heat-(up|dn)-\d/.test(c)).reduce((a, [, n]) => a + n, 0);
    const oldWouldColour = [...seen.entries()].reduce((a, [, n]) => a + n, 0);
    let oldCount = 0;
    WEEKS.forEach((wk, i) => {
      for (const k of keys) {
        const cell = byKey.get(k).cells[i];
        if (cell.v === null) continue;
        const b = bars.get(k);
        if (b.sd !== null && Number(cell.v) < b.mean - b.sd) oldCount += 1;
      }
    });
    c.ok('MANY MORE CELLS CARRY COLOUR THAN THE OLD 1-SD RULE WOULD HAVE COLOURED',
      coloured > oldCount * 2,
      `${coloured} of ${oldWouldColour} now, ${oldCount} under the old rule`);
    c.ok('A CELL INSIDE THE MIDDLE BAND IS LEFT ALONE, and the band is a quarter of a SD',
      nearest !== null && nearest.gap >= 0 && nearest.gap < nearest.sd * 0.25 + 0.05,
      JSON.stringify(nearest));

    // The printed thresholds ARE the ones the colour was decided against — both
    // ends of the scale now, because both ends are drawn.
    const barsWrong = keys.filter((k) => {
      const b = bars.get(k);
      return !w.bars.includes(b.sd === null ? `${k} —` : `${k} ${b.lo.toFixed(1)} / ${b.hi.toFixed(1)}`);
    });
    c.ok('THE KEY PRINTS THOSE EXACT THRESHOLDS, so a reader can check a cell',
      barsWrong.length === 0, `${barsWrong.join(',')} missing from "${w.bars}"`);

    // ---- THE BAND'S GROUP IS THE WEEK COLUMN, not its own row --------------
    //
    // The band shows one squad, so the nine it is measured against are not on
    // the screen — which is exactly why this walks the team picker and reads
    // the band ten times. Two things are then checkable, and neither could be
    // produced by a band scaled along its own row:
    //
    //   - INSIDE ONE WEEK, across the league, a bigger total is never the
    //     redder cell. Scaled along the row, the colours would be about a
    //     squad's own good and bad weeks and this ordering would be noise.
    //   - THE SAME NUMBER IN TWO DIFFERENT WEEKS can be a different colour,
    //     because a 130 in a heavy bye week is a good week and a 130 in a full
    //     week is not. That is the whole reason the group is a week column, and
    //     it is what a single scale across the season would destroy.
    const stepOfCls = (cls) => {
      const m = (cls || '').match(/heat-(up|dn)-(\d)/);
      return m ? (m[1] === 'up' ? 1 : -1) * Number(m[2]) : 0;
    };
    const byTeam = w.bandByTeam || [];
    c.ok('the team picker really did put all ten squads’ bands on screen in turn',
      byTeam.length === 10 && byTeam.every((b) => b.cells.length === WEEKS.length),
      `${byTeam.length} teams, ${byTeam[0] && byTeam[0].cells.length} weeks`);

    const crossWrong = [];
    let colouredWeeks = 0;
    WEEKS.forEach((wk, i) => {
      const col = byTeam
        .map((b) => ({ team: b.team, v: Number(b.cells[i].v), step: stepOfCls(b.cells[i].cls) }))
        .filter((x) => Number.isFinite(x.v))
        .sort((a, b2) => b2.v - a.v);
      if (col.length < 2) return;
      if (col.some((x) => x.step !== 0)) colouredWeeks += 1;
      for (let n = 1; n < col.length; n++) {
        if (col[n].step > col[n - 1].step) {
          crossWrong.push(`wk${wk}: ${col[n].v} greener than ${col[n - 1].v}`);
        }
      }
    });
    c.ok('THE BAND IS SCALED DOWN THE LEAGUE IN ONE WEEK: inside a week, a bigger ' +
      'lineup total is never the redder cell',
      crossWrong.length === 0, crossWrong.slice(0, 4).join(' | '));
    c.ok('and that is not vacuous — most weeks really are coloured',
      colouredWeeks >= WEEKS.length / 2, `${colouredWeeks} of ${WEEKS.length} weeks coloured`);

    // The same total, two weeks, two colours. Built from the walk itself, so
    // it says what the data actually contains rather than what it ought to.
    const byValue = new Map();
    WEEKS.forEach((wk, i) => {
      for (const b of byTeam) {
        const v = b.cells[i].v;
        if (v === null) continue;
        const k = Number(v).toFixed(1);
        if (!byValue.has(k)) byValue.set(k, new Set());
        byValue.get(k).add(`${wk}:${stepOfCls(b.cells[i].cls)}`);
      }
    });
    const disagreeing = [...byValue.entries()].filter(([, set]) =>
      new Set([...set].map((s) => s.split(':')[1])).size > 1);
    c.ok('A WEEK COLUMN IS THE GROUP, NOT THE SEASON: the same lineup total comes out a ' +
      'different colour in a different week, which one scale across the row could not do',
      disagreeing.length > 0,
      JSON.stringify([...byValue.entries()].slice(0, 3).map(([k, s]) => `${k}:${[...s]}`)));

    // ---- naming the man, and lighting every week he holds ------------------
    c.ok('the line is idle until something is pointed at',
      /Hover or tap a number to name the player/.test(w.idle), w.idle);
    c.ok('the busiest man really does hold more than one cell', w.held > 1, String(w.held));
    // NAME, SEASON PROJ, CURRENT AVG — Tim's three, and in his words "that's
    // it", so the old tail ("in the lineup N weeks, at RB1, FLEX") is gone:
    // the highlight says both of those by lighting the cells themselves.
    c.ok('A HOVER NAMES HIM ON THE LINE ABOVE THE TABLE',
      /^.+ · (QB|RB|WR|TE|DST|K) · [A-Z]{2,4} — /.test(w.hover.pick),
      w.hover.pick);
    c.ok('WITH HIS SEASON PROJECTION AND WHAT HE IS AVERAGING',
      /season proj \d|no season projection/.test(w.hover.pick) &&
      /avg \d|nothing scored yet/.test(w.hover.pick),
      w.hover.pick);
    c.ok('AND LIGHTS EVERY OTHER CELL HE HOLDS, ACROSS THE WHOLE SEASON',
      JSON.stringify(w.hover.lit.slice().sort()) === JSON.stringify(w.allHis.slice().sort()) &&
      w.hover.lit.length === w.held,
      `${w.hover.lit.length} lit vs ${w.held} held`);
    // AND NO CARD. It used to be required here — "so a phone gets the name
    // too" — and the line above the table is what covers the phone now, on a
    // tap as well as a hover. The two grids at the top of the page still open
    // the card and their own assertions still prove it.
    c.ok('AND OPENS NO CARD: the 14-week preview is off this panel',
      !w.hover.card || w.hover.card.trim() === '', `card said "${w.hover.card}"`);
    c.ok('leaving the cell clears both the name and the highlight',
      w.afterOut.lit === 0 && /Hover or tap a number/.test(w.afterOut.pick),
      `${w.afterOut.lit} / ${w.afterOut.pick}`);
    c.ok('KEYBOARD FOCUS SHOWS THE SAME THING A HOVER DOES',
      w.focus.lit === w.held && w.focus.pick === w.hover.pick,
      `${w.focus.lit} lit / ${w.focus.pick}`);
    c.ok('and Escape puts it back to rest',
      w.afterEsc.lit === 0 && /Hover or tap a number/.test(w.afterEsc.pick),
      `${w.afterEsc.lit} / ${w.afterEsc.pick}`);
  }

  // ---- (q) too little to go on: no colour at all --------------------------
  //
  // TWO WAYS A SCALE CANNOT EXIST, and this scenario now shows both. `K` has a
  // single value in the whole league, so `stdev` is null; every other slot has
  // ten values that are IDENTICAL, because this stub gives every squad the same
  // projections and only one week is readable. Both must draw nothing — the
  // second is the flat-column guard in js/heat.js, which is there because ten
  // identical floats differ in the fifteenth decimal and produced a fully
  // coloured column the first time the grid was wired up.
  if (scenario === 'thin-slot') {
    const w = globalThis.__an || {};
    const k = w.rows.find((r) => r.slot === 'K');
    const others = w.rows.filter((r) => r.slot !== 'K');
    c.ok('the thin slot still carries its number', k && /^\d+\.\d/.test(k.wk8.text),
      JSON.stringify(k));
    c.ok('A SLOT WITH TOO LITTLE BEHIND IT IS NOT COLOURED',
      k && !/\bheat\b/.test(k.wk8.cls), k && k.wk8.cls);
    c.ok('and its threshold is printed as a dash rather than invented',
      /K —/.test(w.bars), w.bars);
    c.ok('A FLAT SLOT IS NOT COLOURED EITHER — ten identical numbers are not a distribution',
      others.every((r) => !/\bheat\b/.test(r.wk8.cls)),
      JSON.stringify(others.map((r) => `${r.slot}:${r.wk8.cls}`)));
    c.ok('and a flat slot prints a dash too, rather than a threshold equal to its own mean',
      !/\d+\.\d \/ \d+\.\d/.test(w.bars), w.bars);
    c.ok('so the absence of colour is the guard, not an empty table',
      others.some((r) => /^\d+\.\d/.test(r.wk8.text)),
      JSON.stringify(others.map((r) => r.wk8.text)));
    c.ok('and the note says a slot with too little to go on is left uncoloured',
      /A slot with too little to go on is left uncoloured/.test(w.note) &&
      /fewer than two values cannot have a standard deviation/.test(w.note),
      w.note.slice(0, 900));
    // THE REFUSAL STAYS ON SCREEN. The thresholds moved into the toggle on
    // 2026-09-19c and a dash in there says nothing to a reader looking at a
    // bare column beside a coloured band — so the uncoloured slots are named
    // in the key instead, short, and only when there is a colour to contrast
    // them with.
    if (w.bandColoured) {
      c.ok('THE UNCOLOURED SLOTS ARE NAMED IN VIEW, not left to a dash in the toggle',
        /are not coloured/.test(w.legend) && /\bK\b/.test(w.legend), w.legend);
      c.ok('and the reason is given in the same breath',
        /too few numbers, or the whole league inside one printed tenth/.test(w.legend),
        w.legend);
    }
  }

  // ---- (u) the red/green scale on the all-teams grid, per column ----------
  //
  // Tim's own sentence, made falsifiable: "in this All teams, proj avg 2026
  // chart, positions with higher proj than the others will be green and lower
  // will be red." Demo data, because it is the only source here that gives ten
  // genuinely different squads.
  if (scenario === 'avg-heat') {
    const w = globalThis.__an || {};
    const stepOf = (cls) => {
      const m = (cls || '').match(/heat-(up|dn)-(\d)/);
      return m ? (m[1] === 'up' ? 1 : -1) * Number(m[2]) : 0;
    };
    const slots = w.head.slice(1, -1);          // between Team and Total
    const colOf = (i) => w.rows.map((r) => ({
      v: Number(r.cells[i].v), step: stepOf(r.cells[i].cls), team: r.team,
    })).filter((x) => Number.isFinite(x.v));

    c.ok('the page opened on the average measure, which is what this scenario is about',
      JSON.stringify(w.measure) === JSON.stringify(['avg']), JSON.stringify(w.measure));
    c.ok('and it is the ten squads by lineup slot', w.rows.length === 10 && slots.length >= 8,
      `${w.rows.length} rows, ${slots.length} slot columns`);

    const colourWrong = [];
    const orderWrong = [];
    for (let i = 0; i < slots.length; i++) {
      const col = colOf(i).slice().sort((a, b) => b.v - a.v);
      if (col.length < 2) continue;
      if (col[0].step <= 0) colourWrong.push(`${slots[i]}: best ${col[0].v} not green`);
      if (col[col.length - 1].step >= 0) {
        colourWrong.push(`${slots[i]}: worst ${col[col.length - 1].v} not red`);
      }
      // No crossings: a bigger number in a column is never the redder cell.
      for (let n = 1; n < col.length; n++) {
        if (col[n].step > col[n - 1].step) {
          orderWrong.push(`${slots[i]}: ${col[n].v} greener than ${col[n - 1].v}`);
        }
      }
    }
    c.ok('THE BEST SQUAD AT A SLOT IS GREEN AND THE WORST IS RED, in every column',
      colourWrong.length === 0, colourWrong.slice(0, 4).join(' | '));
    c.ok('and the shading never disagrees with the ordering inside a column',
      orderWrong.length === 0, orderWrong.slice(0, 4).join(' | '));
    c.ok('the Total column is on the scale too — ten whole lineups are one group',
      w.rows.some((r) => stepOf(r.cells[r.cells.length - 1].cls) > 0) &&
      w.rows.some((r) => stepOf(r.cells[r.cells.length - 1].cls) < 0),
      JSON.stringify(w.rows.map((r) => r.cells[r.cells.length - 1].cls)));

    // THE COMPARISON GROUP IS A COLUMN, NEVER THE TABLE. This is the rule the
    // whole scale rests on: a quarterback's 22 beside a kicker's 8 is not a
    // comparison, and one scale across the grid would paint every kicker red
    // for being a kicker. The proof is that the best kicker is GREEN while
    // every quarterback in the league outscores him.
    const qbCol = colOf(slots.indexOf('QB'));
    const kCol = colOf(slots.indexOf('K'));
    c.ok('the two columns really are on different scales, so this has teeth',
      qbCol.length && kCol.length &&
      Math.min(...qbCol.map((x) => x.v)) > Math.max(...kCol.map((x) => x.v)),
      `QB min ${Math.min(...qbCol.map((x) => x.v))} vs K max ${Math.max(...kCol.map((x) => x.v))}`);
    c.ok('A COLUMN IS THE COMPARISON GROUP, NEVER THE TABLE: the best kicker is green ' +
      'even though every quarterback outscores him',
      kCol.some((x) => x.step > 0) && kCol.some((x) => x.step < 0),
      JSON.stringify(kCol.map((x) => `${x.v}:${x.step}`)));

    // A SPECTRUM, NOT TWO LEVELS. Tim asked for "more red or more green", so a
    // table that only ever reached the ends would pass everything above while
    // showing him nothing he asked for.
    const used = new Set(w.rows.flatMap((r) => r.cells)
      .map((td) => (td.cls.match(/heat-(?:up|dn)-\d/) || [''])[0]).filter(Boolean));
    c.ok('THE TABLE USES MORE THAN TWO STEPS, so "on a spectrum" is falsifiable',
      used.size >= 4, JSON.stringify([...used].sort()));

    // NEVER COLOUR ALONE.
    const cells = w.rows.flatMap((r) => r.cells);
    const ends = cells.filter((td) => /heat-(up|dn)-4/.test(td.cls));
    c.ok('every cell at the end of the scale carries a glyph as well as a colour',
      ends.length > 0 && ends.every((td) => /[▲▼]/.test(td.text)),
      `${ends.length} end cells: ${ends.slice(0, 3).map((td) => td.text).join(' | ')}`);
    c.ok('and only there — a step-1-to-3 cell is tinted but unmarked, or the table is noise',
      cells.filter((td) => /heat-(up|dn)-[123]\b/.test(td.cls))
        .every((td) => !/[▲▼]/.test(td.text)),
      cells.filter((td) => /heat-(up|dn)-[123]\b/.test(td.cls))
        .map((td) => td.text).slice(0, 4).join(' | '));
    c.ok('and every coloured cell says where it stands, in the title a tap opens',
      cells.filter((td) => /heat-(up|dn)-\d/.test(td.cls))
        .every((td) => /SD (above|below)/.test(td.title)),
      cells.filter((td) => /heat-dn-/.test(td.cls))[0]?.title);
    c.ok('THE KEY UNDER THE GRID SAYS THE COLOUR IS PER COLUMN, which nobody would assume',
      /never compared across columns/.test(w.legend), w.legend);
    c.ok('and it names the arrow and the weight, the two cues that need no hue',
      /arrow/.test(w.legend) && /heavier type/.test(w.legend), w.legend);
    // THE THRESHOLDS IN POINTS, AND WHERE THEY LIVE. Behind "How this grid
    // works" with the method, never under the table — but never deleted
    // either: they are what lets a cell be checked against ESPN by hand.
    c.ok('THE THRESHOLDS ARE THERE, in points, one pair per column',
      /Full colour at \(red \/ green\)/.test(w.bars), w.bars);
    c.ok('inside the toggle, with the key left outside it',
      w.barsInToggle && !w.legendInToggle,
      JSON.stringify({ bars: w.barsInToggle, legend: w.legendInToggle }));
    c.ok('and the note spells the rule out in a sentence',
      /a quarterback is never measured against a kicker/.test(w.note), w.note.slice(0, 400));
    c.ok('the note also says where full colour is reached',
      /reaching full colour one standard deviation out/.test(w.note), w.note.slice(0, 400));
  }

  // ---- (v) the same scale on the `A week` measure -------------------------
  //
  // The open question Tim answered, made falsifiable. See the scenario's own
  // block above for what the three claims are and why they are the three.
  if (scenario === 'week-heat') {
    const w = globalThis.__an || {};
    const stepOf = (cls) => {
      const m = (cls || '').match(/heat-(up|dn)-(\d)/);
      return m ? (m[1] === 'up' ? 1 : -1) * Number(m[2]) : 0;
    };
    const totalIdx = w.head.indexOf('Total') - 1;      // cells[] drops the Team cell
    const slots = w.head.slice(1, totalIdx + 1);
    const bench = (r) => r.cells.slice(totalIdx + 1);
    const colOf = (i) => w.rows.map((r) => ({
      v: Number(r.cells[i].v), step: stepOf(r.cells[i].cls), cls: r.cells[i].cls, team: r.team,
    }));

    c.ok('the page opened on the week measure, which is what this scenario is about',
      JSON.stringify(w.measure) === JSON.stringify(['week']), JSON.stringify(w.measure));
    c.ok('and it is the ten squads by lineup spot, with a Total and a bench',
      w.rows.length === 10 && slots.length === 9 && totalIdx === 9 &&
      w.rows.every((r) => bench(r).length > 0),
      `${w.rows.length} rows, ${slots.length} slots, total at ${totalIdx}`);

    // 1. THE NUMBERS ARE COLOURED, PER COLUMN.
    const colourWrong = [];
    const orderWrong = [];
    for (let i = 0; i < slots.length; i++) {
      const col = colOf(i).filter((x) => Number.isFinite(x.v) && /\bheat\b/.test(x.cls))
        .sort((a, b) => b.v - a.v);
      if (col.length < 2) continue;
      if (col[0].step <= 0) colourWrong.push(`${slots[i]}: best ${col[0].v} not green`);
      if (col[col.length - 1].step >= 0) {
        colourWrong.push(`${slots[i]}: worst ${col[col.length - 1].v} not red`);
      }
      for (let n = 1; n < col.length; n++) {
        if (col[n].step > col[n - 1].step) {
          orderWrong.push(`${slots[i]}: ${col[n].v} greener than ${col[n - 1].v}`);
        }
      }
    }
    c.ok('THE BEST SQUAD AT A SPOT THIS WEEK IS GREEN AND THE WORST IS RED, in every column',
      colourWrong.length === 0, colourWrong.slice(0, 4).join(' | '));
    c.ok('and the shading never disagrees with the ordering inside a column',
      orderWrong.length === 0, orderWrong.slice(0, 4).join(' | '));
    c.ok('the Total column is on the scale too — ten whole lineups in one week are one group',
      w.rows.some((r) => stepOf(r.cells[totalIdx].cls) > 0) &&
      w.rows.some((r) => stepOf(r.cells[totalIdx].cls) < 0),
      JSON.stringify(w.rows.map((r) => r.cells[totalIdx].cls)));

    // A COLUMN IS THE GROUP, NEVER THE TABLE — the same proof `avg-heat` uses:
    // the best kicker is GREEN while every quarterback in the league outscores
    // him, which one scale across the row could not produce.
    const qbCol = colOf(slots.indexOf('QB')).filter((x) => Number.isFinite(x.v) && /\bheat\b/.test(x.cls));
    const kCol = colOf(slots.indexOf('K')).filter((x) => Number.isFinite(x.v) && /\bheat\b/.test(x.cls));
    c.ok('the QB and K columns really are on different scales, so this has teeth',
      qbCol.length > 1 && kCol.length > 1 &&
      Math.min(...qbCol.map((x) => x.v)) > Math.max(...kCol.map((x) => x.v)),
      `QB min ${Math.min(...qbCol.map((x) => x.v))} vs K max ${Math.max(...kCol.map((x) => x.v))}`);
    c.ok('A COLUMN IS THE COMPARISON GROUP, NEVER THE TABLE: the best kicker is green ' +
      'even though every quarterback outscores him',
      kCol.some((x) => x.step > 0) && kCol.some((x) => x.step < 0),
      JSON.stringify(kCol.map((x) => `${x.v}:${x.step}`)));

    // 2. A STATE CELL KEEPS ITS CELL. This is the whole of the composition
    //    argument: the four state meanings and the scale never land together,
    //    so the states are as legible as they were and the scale describes the
    //    men who are actually playing. It also proves the arithmetic half —
    //    a zero in the distribution is bimodal and would flatten the column.
    const all = w.rows.flatMap((r) => r.cells.slice(0, totalIdx));
    // A ZERO IS A STATE WHETHER OR NOT IT CARRIES A CLASS. `bye` and
    // `zero-out` are classed; a plain 0.0 (ESPN projecting nothing for a man
    // who is not hurt and not on bye) is not, and it is the one that would slip
    // through a class-only check — so the VALUE is what is tested here.
    const isState = (td) => /\b(bye|zero-out|st-out|st-ir)\b/.test(td.cls) || td.v === '0';
    const states = all.filter(isState);
    c.ok('the sample league really does put state cells in this grid, so this is not vacuous',
      states.length > 0, `${states.length} state cells`);
    c.ok('A BYE, A RULED-OUT 0.0, AN OUT OR AN IR CELL IS NEVER TINTED — the state keeps its cell',
      states.every((td) => !/\bheat\b/.test(td.cls)),
      JSON.stringify(states.filter((td) => /\bheat\b/.test(td.cls))
        .map((td) => `${td.text}:${td.cls}`).slice(0, 3)));
    c.ok('and every one of them still says what it is, in words',
      states.every((td) => /Bye/.test(td.text) || /OUT|IR|SUSP/.test(td.text) ||
        /on bye|ruled out|OUT|IR/.test(td.aria) || td.text === '0.0'),
      JSON.stringify(states.slice(0, 3).map((td) => `${td.text} | ${td.aria.slice(0, 60)}`)));
    c.ok('while the cells that ARE numbers are measured',
      all.filter((td) => !/\b(bye|zero-out|st-out|st-ir)\b/.test(td.cls) && td.v !== null)
        .every((td) => /\bheat\b/.test(td.cls)),
      JSON.stringify(all.filter((td) => !/\b(bye|zero-out|st-out|st-ir)\b/.test(td.cls) &&
        td.v !== null && !/\bheat\b/.test(td.cls)).map((td) => `${td.text}:${td.cls}`).slice(0, 3)));

    // 3. THE BENCH IS NOT A COLUMN OF ONE KIND OF NUMBER.
    c.ok('NO BENCH CELL IS COLOURED — B1 is a running back on one squad and a quarterback ' +
      'on the next, so that column would be comparing positions',
      w.rows.every((r) => bench(r).every((td) => !/\bheat\b/.test(td.cls))),
      JSON.stringify(w.rows[0] && bench(w.rows[0]).map((td) => td.cls).slice(0, 4)));

    // NEVER COLOUR ALONE, on every channel the DOM can see.
    const ends = all.filter((td) => /heat-(up|dn)-4/.test(td.cls));
    c.ok('every cell at the end of the scale carries a glyph as well as a colour',
      ends.length > 0 && ends.every((td) => /[▲▼]/.test(td.text)),
      `${ends.length} end cells: ${ends.slice(0, 3).map((td) => td.text).join(' | ')}`);
    c.ok('and only there — a step-1-to-3 cell is tinted but unmarked',
      all.filter((td) => /heat-(up|dn)-[123]\b/.test(td.cls))
        .every((td) => !/[▲▼]/.test(td.text)),
      all.filter((td) => /heat-(up|dn)-[123]\b/.test(td.cls)).map((td) => td.text).slice(0, 4).join(' | '));
    c.ok('A SPECTRUM, NOT TWO LEVELS — more than two steps are in use',
      new Set(all.map((td) => (td.cls.match(/heat-(?:up|dn)-\d/) || [''])[0]).filter(Boolean)).size >= 4,
      JSON.stringify([...new Set(all.map((td) =>
        (td.cls.match(/heat-(?:up|dn)-\d/) || [''])[0]).filter(Boolean))].sort()));
    // The words. These cells carry no `title` — the card is this grid's tooltip
    // and a title beside it would have the browser draw a second one — so the
    // sentence is on the link's aria-label and on the card, which a tap opens.
    c.ok('EVERY COLOURED CELL SAYS WHERE IT STANDS, in the words a tap opens',
      all.filter((td) => /heat-(up|dn)-\d/.test(td.cls))
        .every((td) => /SD (above|below)/.test(td.aria)),
      all.filter((td) => /heat-dn-/.test(td.cls))[0]?.aria);
    c.ok('and those cells still carry NO `title`, so the browser cannot draw a second tooltip',
      all.every((td) => td.title === ''),
      JSON.stringify(all.filter((td) => td.title !== '').map((td) => td.title).slice(0, 2)));
    c.ok('the Total cell DOES carry one, because it holds no link and no card',
      w.rows.every((r) => /projects? /.test(r.cells[totalIdx].title) ||
        /No projection/.test(r.cells[totalIdx].title)),
      w.rows[0] && w.rows[0].cells[totalIdx].title);

    // The key, and the thresholds that make it checkable by hand.
    c.ok('THE KEY UNDER THE GRID SAYS THE COLOUR IS PER COLUMN, which nobody would assume',
      /never compared across columns/.test(w.legend), w.legend);
    // The state marks are still named in the key beside the two scale
    // swatches. WHICH states appear depends on the data — the sample league
    // rules men out rather than giving them byes, so it draws "0.0 OUT", Out
    // and IR and no Bye at all — so this checks that the states the grid IS
    // drawing are keyed, not that a particular one of them is.
    c.ok('and the states are still in that key beside it, not pushed out by the scale',
      /ruled out, not a bye|no game that week|injured reserve/.test(w.legend), w.legend);
    c.ok('THE THRESHOLDS SURVIVE, in points, one pair per column',
      /Full colour at \(red \/ green\)/.test(w.bars) &&
      slots.every((s) => w.bars.includes(s)) && /Total/.test(w.bars),
      w.bars);
    // WHERE THEY ARE IS HALF THE ASSERTION. Behind "How this grid works", with
    // the rest of the method; the key stays in view with the cues a reader
    // needs without asking. Swap the two back and this fails.
    c.ok('and they are INSIDE the toggle, while the key stays outside it',
      w.barsInToggle && !w.legendInToggle,
      JSON.stringify({ bars: w.barsInToggle, legend: w.legendInToggle }));
    c.ok('THE VISIBLE KEY NAMES THE ARROW AND THE WEIGHT, so nothing rests on the hue alone',
      /arrow/.test(w.legend) && /heavier type/.test(w.legend), w.legend);
    c.ok('and points at where the numbers went, so they cannot read as dropped',
      /toggle below/.test(w.legend), w.legend);
    c.ok('and the key itself does not carry the thresholds',
      !/Full colour at/i.test(w.legend), w.legend);
    c.ok('the note spells the per-column rule out in a sentence',
      /a quarterback is never measured against a kicker/.test(w.note), w.note.slice(0, 500));
    c.ok('AND THE NOTE SAYS THE STATE CELLS ARE LEFT OUT, or an uncoloured Bye reads as a bug',
      /A cell showing a state rather than a projection is never coloured/.test(w.note) &&
      /left out of the column’s average/.test(w.note), w.note.slice(0, 900));
    c.ok('and that the bench carries none, and why',
      /The bench columns carry no colour either/.test(w.note), w.note.slice(0, 900));
  }

  if (scenario === 'card-repaint') {
    const w = globalThis.__an;
    c.ok('the grid came up and the season was still loading when the card opened',
      w.gridUp && w.hoverOpen && w.hoverPendingAtOpen,
      JSON.stringify({ up: w.gridUp, open: w.hoverOpen, pending: w.hoverPendingAtOpen }));
    c.ok('the whole season landed', w.loaded, 'still loading');
    c.ok('A HOVERED CARD STAYS OPEN ACROSS EVERY BATCH REPAINT',
      w.hoverStillOpen, 'the card closed under the reader');
    c.ok('and it redrew from the newer data: every week filled in, same man',
      /^T4 Player 01/.test(w.hoverIdent) && w.hoverValues.length === 16 && !w.hoverValues.includes('·'),
      `${w.hoverIdent} ${JSON.stringify(w.hoverValues)}`);
    c.ok('it still closes when the pointer leaves the (new) cell', w.hoverClosesOnLeave, 'still open');
    c.ok('A TAP-OPENED SHEET SURVIVES A REPAINT TOO, still a sheet, still him',
      w.sheetOpen && w.sheetAfterRepaint && /^T6 Player 14/.test(w.sheetIdent),
      JSON.stringify({ open: w.sheetOpen, after: w.sheetAfterRepaint, ident: w.sheetIdent }));
    c.ok('and closes once its man is no longer on the page', w.sheetGoneWithMan, 'still open');
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
    console.log('@@' + JSON.stringify({ scenario, results }));
    process.exit(results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    console.log('@@' + JSON.stringify({ scenario, results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }] }));
    process.exit(1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const args = cfg.stub ? ['--import', './an-register.mjs', self, scenario] : [self, scenario];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: path.dirname(self),
    env: { ...process.env, ...(cfg.env || {}) },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 2000)}`);
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
