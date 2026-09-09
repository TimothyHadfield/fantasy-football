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

const SCENARIOS = {
  demo: {
    label: '(a) demo mode, nothing connected',
    stub: false,
    prefs: { 'analysis.source': 'demo' },
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
      const snap = () => ({
        cols: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
          cls: tr.getAttribute('class') || '',
          cells: [...tr.children].map((td) => ({
            text: td.textContent.trim(),
            v: td.getAttribute('data-v'),
            cls: td.getAttribute('class') || '',
          })),
        })),
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

      // --- and via a click on the all-teams grid, which drives the same thing --
      const row = document.querySelector('#overviewTable tbody tr[data-team="2"]');
      if (row) click(row);
      await new Promise((r) => setTimeout(r, 120));
      out.team2 = snap();
      out.teamSelectValue = sel.value;
      out.fetchesAfterGridClick = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };

      // --- sorting week columns ------------------------------------------------
      const ths = [...table.querySelectorAll('thead th')];
      click(ths[11]);              // week 7 — one player has no number
      out.wk7desc = snap();
      click(ths[11]);
      out.wk7asc = snap();
      click(ths[10]);              // week 6 — one player is on bye
      out.wk6desc = snap();
      click(ths[10]);
      out.wk6asc = snap();
      click(ths[5]);               // week 1 — one player is not on the roster
      out.wk1desc = snap();
      click(ths[5]);
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

  // The two all-teams grids: the season-average one and the week one below it.
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
  // bye there, so the lineup has to be re-picked around a 0.00.
  grids: {
    label: '(f) the season-average grid, the week grid, and the pair of them',
    stub: true,
    prefs: { 'analysis.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const season = await import('./an-stub-season.mjs');
      const $ = (id) => document.getElementById(id);

      const grab = (id) => {
        const table = $(`${id}Table`);
        return {
          title: $(`${id}Title`).textContent.trim(),
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
      const snap = () => ({ avg: grab('overview'), week: grab('weekly') });
      const fire = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

      const out = { initial: snap() };
      out.fetchesBefore = { week: season.calls.week.slice(), weeks: season.calls.weeks.slice() };
      out.notes = {
        avg: document.querySelector('#overviewWrap').parentElement
          .querySelector('.panel-note').textContent.replace(/\s+/g, ' ').trim(),
        week: document.querySelector('#weeklyWrap').parentElement
          .querySelector('.panel-note').textContent.replace(/\s+/g, ' ').trim(),
      };

      // --- a click in the WEEK grid drives the drill-down too ---------------
      const row = document.querySelector('#weeklyTable tbody tr[data-team="2"]');
      if (row) fire(row);
      await new Promise((r) => setTimeout(r, 120));
      out.picked = { team: $('teamSelect').value, snap: snap() };

      // --- a click on a player link must NOT also repoint the drill-down -----
      // The row is click-to-drill-into-a-team and the number inside it is now a
      // link out of the page. Both handlers see the same click; only one of
      // them may act, or the reader comes back to a team he never picked.
      const link = document.querySelector(
        '#overviewTable tbody tr[data-team="5"] td.slot-cell a.pref');
      out.ref = link && { href: link.getAttribute('href'), title: link.getAttribute('title') };
      if (link) fire(link);
      await new Promise((r) => setTimeout(r, 80));
      out.afterRefClick = {
        team: $('teamSelect').value,
        picked: [...document.querySelectorAll('#overviewTable tbody tr.picked')]
          .map((tr) => tr.getAttribute('data-team')),
      };

      // ...and a click on the row anywhere ELSE still does drill in.
      const nameCell = document.querySelector('#weeklyTable tbody tr[data-team="5"] td.name');
      if (nameCell) fire(nameCell);
      await new Promise((r) => setTimeout(r, 80));
      out.afterNameClick = { team: $('teamSelect').value };

      // put it back where the assertions below expect it
      const back = document.querySelector('#weeklyTable tbody tr[data-team="2"] td.name');
      if (back) fire(back);
      await new Promise((r) => setTimeout(r, 80));

      // --- change the week: only the week grid moves ------------------------
      const wk = $('weekSelect');
      wk.value = '6';
      wk.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      out.week6 = snap();

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
          note: $('rosterNote').textContent.replace(/\s+/g, ' ').trim(),
          glance: [...document.querySelectorAll('#teamGlance .stat')].map((s) => [
            s.querySelector('.k').textContent.trim(),
            s.querySelector('.v').textContent.trim(),
          ]),
          // The season panel shares the lineup, so it has to move with it.
          season: [...document.querySelectorAll('#seasonTable tbody tr')].map((tr) =>
            `${tr.children[1].textContent.trim().replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, '')}` +
            `=${tr.children[0].textContent.trim()}` +
            `${/\bbench\b/.test(tr.getAttribute('class') || '') ? 'B' : 'S'}`),
        };
      };

      const fire = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
      const tap = (id) => {
        const b = document.querySelector(`#rosterTable button[data-swap="${id}"]`);
        if (b) fire(b);
        return Boolean(b);
      };

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
};

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  // Registered here rather than through --import, because the module it points
  // at is built in this file. Every import after this point sees it, and the
  // page module is imported at the foot of this function.
  if (cfg.noId) register(NO_ID_LOADER);
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

const IDENTITY = ['Slot', 'Player', 'Pos', 'NFL', 'Avg'];

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);
  const table = $('seasonTable');
  const roster = $('rosterTable');
  const note = txt($('seasonNote'));

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));

  const head = headers(table);
  const rows = bodyRows(table);
  const rosterRows = bodyRows(roster);

  // ---- shape -------------------------------------------------------------
  c.ok('the panel exists with its own table', Boolean(table), 'no #seasonTable');
  c.ok('identity columns are Slot, Player, Pos, NFL and Avg',
    JSON.stringify(head.slice(0, 5)) === JSON.stringify(IDENTITY), JSON.stringify(head));
  c.ok('nothing but week numbers after them',
    head.length > 5 && head.slice(5).every((h) => /^\d+$/.test(h)), JSON.stringify(head));
  c.ok('one column per week of the season, thirteen of them',
    JSON.stringify(head.slice(5)) ===
      JSON.stringify(Array.from({ length: 13 }, (_, i) => String(i + 1))), JSON.stringify(head));
  c.ok('Avg sits immediately before the week run', head[4] === 'Avg', JSON.stringify(head));
  c.ok('every header is sortable',
    [...table.querySelectorAll('thead th')].every((th) => th.hasAttribute('data-sort')),
    [...table.querySelectorAll('thead th')].filter((th) => !th.hasAttribute('data-sort')).length);
  c.ok('the table lives inside a .table-scroll',
    $('seasonWrap').getAttribute('class').includes('table-scroll'), $('seasonWrap').getAttribute('class'));
  c.ok('the player cell uses the sticky name treatment',
    rows.length > 0 && rows.every((r) => /\bname\b/.test(r.cells[1].cls)),
    rows[0] && rows[0].cells[1].cls);

  // ---- the row set is the shown week's FULL roster ------------------------
  const seasonNames = rows.map((r) => r.cells[1].text.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''));
  const rosterNames = rosterRows.map((r) => r.cells[1].text);
  c.ok('the row set matches the Roster detail panel exactly',
    rows.length === rosterRows.length &&
    JSON.stringify([...seasonNames].sort()) === JSON.stringify([...rosterNames].sort()),
    `${rows.length} vs ${rosterRows.length}`);
  c.ok('the bench is included, not just the starters',
    rows.some((r) => /\bbench\b/.test(r.cls)) && rows.some((r) => !/\bbench\b/.test(r.cls)),
    rows.map((r) => r.cls).join('|'));
  // (team-switch deliberately leaves the table sorted by a week column.)
  if (scenario !== 'team-switch') {
    c.ok('rows open in lineup order, starters before bench',
      (() => {
        const flags = rows.map((r) => /\bbench\b/.test(r.cls));
        return flags.indexOf(true) === -1 || !flags.slice(flags.indexOf(true)).includes(false);
      })(), rows.map((r) => (/\bbench\b/.test(r.cls) ? 'B' : 'S')).join(''));
  }
  c.ok('the slot column sorts on lineup order, not on its label',
    rows.every((r) => /^\d+$/.test(r.cells[0].v || '')), rows[0] && rows[0].cells[0].v);

  // ---- no colour highlighting --------------------------------------------
  c.ok('no cell carries the waiver page\u2019s green class',
    d.querySelectorAll('.hot').length === 0 && !/\bhot\b/.test(d.body.innerHTML),
    d.querySelectorAll('.hot').length);
  c.ok('no week cell is highlighted for being good',
    rows.every((r) => r.cells.slice(5).every((td) =>
      !/\b(hot|good|pos|neg|st-out|st-ir)\b/.test(td.cls))),
    JSON.stringify(rows[0] && rows[0].cells.slice(5).map((x) => x.cls)));

  // ---- player references: every name, and every number standing for one ----
  //
  // Tim: "if you ever click on a player's name (or a number that refers to the
  // player), it will bring you directly to their position in the players
  // section". The contract is a real <a class="pref" href="waivers.html?
  // player=<espnPlayerId>">, and these run in every scenario.
  const refs = [...d.querySelectorAll('a.pref')];
  const href = (a) => a.getAttribute('href') || '';
  const SURFACES = ['#overviewTable', '#weeklyTable', '#rosterTable', '#seasonTable'];

  c.ok('the page emits player reference links at all', refs.length > 0, `${refs.length}`);
  c.ok('EVERY SURFACE THAT NAMES A PLAYER LINKS HIM',
    SURFACES.every((s) => d.querySelectorAll(`${s} tbody a.pref`).length > 0),
    SURFACES.map((s) => `${s}=${d.querySelectorAll(`${s} tbody a.pref`).length}`).join(' '));
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
  // to sortable.js and every column in both grids would silently stop sorting.
  const keyed = [...d.querySelectorAll('#overviewTable tbody td[data-v], #weeklyTable tbody td[data-v], ' +
    '#seasonTable tbody td[data-v], #rosterTable tbody td[data-v]')];
  c.ok('THE SORT KEY STAYS ON THE CELL, OUTSIDE THE LINK',
    keyed.length > 0 &&
    d.querySelectorAll('a.pref[data-v]').length === 0 &&
    d.querySelectorAll('a.pref [data-v]').length === 0,
    `${keyed.length} keyed cells, ` +
    `${d.querySelectorAll('a.pref[data-v], a.pref [data-v]').length} keys inside links`);

  // Wrapping must not change a single character of what the tables read, which
  // is what lets every existing text assertion above stand unaltered.
  const gridCells = [...d.querySelectorAll('#overviewTable tbody td.slot-cell, ' +
    '#weeklyTable tbody td.slot-cell')].filter((td) => td.querySelector('a.pref'));
  c.ok('a grid link wraps the WHOLE cell, so the number itself is the target',
    gridCells.length > 0 && gridCells.every((td) => td.querySelector('a.pref').textContent === td.textContent),
    gridCells.slice(0, 2).map((td) => `[${td.textContent}] vs [${td.querySelector('a.pref').textContent}]`).join(' '));
  c.ok('a bench cell keeps its position inside the link, beside the number it labels',
    (() => {
      const bench = gridCells.filter((td) => td.querySelector('.pp'));
      return bench.length > 0 && bench.every((td) => td.querySelector('a.pref .pp'));
    })(), 'a .pp span outside its link');
  c.ok('the roster detail links the name and nothing else in the cell',
    (() => {
      const cells = [...d.querySelectorAll('#rosterTable tbody td.name')];
      // (scenario (g) has one man per team with no id, and so no link at all)
      const linked = cells.filter((td) => td.querySelector('a.pref'));
      return linked.length > 0 &&
        linked.every((td) => td.querySelector('a.pref').textContent === td.textContent);
    })(), 'a name cell whose link does not cover it');
  c.ok('the season grid links the name and leaves the injury pill beside it',
    d.querySelectorAll('#seasonTable tbody td.name a.pref .inj').length === 0 &&
    [...d.querySelectorAll('#seasonTable tbody td.name')].every((td) => {
      const a = td.querySelector('a.pref');
      return !a || td.textContent.startsWith(a.textContent);
    }),
    `${d.querySelectorAll('#seasonTable tbody td.name a.pref .inj').length} pills inside a link`);

  // ---- the note ----------------------------------------------------------
  c.ok('the note says these are ESPN\u2019s own per-week projections',
    /ESPN\u2019s own projection for that player in that week/.test(note) ||
    /generated sample rosters and generated projections/.test(note), note);
  c.ok('the note explains a Bye against a dash',
    /Bye/.test(note) && /0\.00 ESPN returns/.test(note) && /A dash is not that/.test(note), note);
  c.ok('the note says which weeks are covered',
    /Covering weeks 1\u201313 \u2014 13 weeks this season runs to/.test(note), note);
  c.ok('the note says the rows are the roster as of the shown week',
    /roster as it stands in week \d+/.test(note), note);
  c.ok('the note owns the average as ours',
    /Avg is the mean of the weeks that carry a number and is ours, not ESPN\u2019s/.test(note), note);
  c.ok('the note explains why nothing is highlighted',
    /Nothing in this table is highlighted, on purpose/.test(note), note);

  // ---- (a) demo -----------------------------------------------------------
  if (scenario === 'demo') {
    c.ok('badge says Demo', txt($('modeBadge')) === 'Demo', txt($('modeBadge')));
    c.ok('the demo grid is fully filled in — no week left pending',
      rows.every((r) => r.cells.slice(5).every((td) => !/\bwait\b/.test(td.cls))),
      'pending cells present');
    c.ok('no progress line in demo, because nothing is fetched',
      txt($('seasonProgress')) === '', txt($('seasonProgress')));
    c.ok('the note admits the numbers are generated',
      /generated sample rosters and generated projections/.test(note), note);
    c.ok('every demo row has an average', rows.every((r) => r.cells[4].v !== null),
      rows.filter((r) => r.cells[4].v === null).length);
    c.ok('the title names the team', /^Season by week \u00b7 .+/.test(txt($('seasonTitle'))),
      txt($('seasonTitle')));
    // The sample data means "ruled out" by a zero, not "on bye", so it must not
    // claim a bye it does not have.
    c.ok('demo never claims a bye it cannot know about',
      rows.every((r) => r.cells.slice(5).every((td) => td.text !== 'Bye')), 'a Bye cell in demo');
    c.ok('a demo zero is printed as the number it is, and still sorts',
      rows.some((r) => r.cells.slice(5).some((td) => td.text === '0.0' && td.v === '0')),
      'no zero cell at all');
    c.ok('the demo note says what a zero means here',
      /in the sample data a zero only means he is ruled out/.test(note), note);

    // The grids follow the same rule, and demo is the mode Tim sees first.
    const gridCells = (id) =>
      [...d.querySelectorAll(`#${id}Table tbody td`)].map((td) => td.textContent.trim());
    c.ok('neither grid claims a bye in demo, where a zero means something else',
      !gridCells('overview').includes('Bye') && !gridCells('weekly').includes('Bye'),
      'a Bye cell in a demo grid');
    c.ok('a demo zero in the week grid is printed as the number it is',
      gridCells('weekly').some((t) => t === '0.0' || /^0\.0 [A-Z]/.test(t)),
      'no zero cell in the demo week grid at all');
    c.ok('both grids are headed for what they actually are',
      txt($('overviewTitle')).startsWith('All teams · proj avg') &&
      /^All teams · week \d+$/.test(txt($('weeklyTitle'))),
      `${txt($('overviewTitle'))} / ${txt($('weeklyTitle'))}`);

    // ---- the week run on the hover, in the mode Tim sees first ------------
    const tipCells = [...d.querySelectorAll('#overviewTable tbody td[data-tip], ' +
      '#weeklyTable tbody td[data-tip]')];
    c.ok('every grid cell has a card to draw', tipCells.length > 0, `${tipCells.length}`);

    const cards = tipCells.map((td) => hoverCard(d, boot.window, td));
    c.ok('every grid cell hover draws a week run, in demo too',
      cards.every((k) => k && k.weeks.length === 13 && k.values.length === 13),
      JSON.stringify(cards[0] && { w: cards[0].weeks.length, v: cards[0].values.length }));
    c.ok('and it is honest about whose numbers they are',
      cards.every((k) => /Sample projections for weeks 1–13/.test(k.heading)), cards[0].heading);
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
    c.ok('the page opened on the last week played', txt($('weeklyTitle')).endsWith('week 8'),
      txt($('weeklyTitle')));

    c.ok('the season grid costs exactly one request per week',
      JSON.stringify(season.calls.weeks.slice().sort((a, b) => a - b)) ===
        JSON.stringify(Array.from({ length: 13 }, (_, i) => i + 1)),
      JSON.stringify(season.calls.weeks));
    c.ok('the selected week is still fetched by the panels above, once',
      JSON.stringify(season.calls.week) === JSON.stringify([8]), JSON.stringify(season.calls.week));
    c.ok('the progress line clears once every week has landed',
      txt($('seasonProgress')) === '', txt($('seasonProgress')));

    // every cell carries the projection the stub handed back
    const byName = new Map(rows.map((r) =>
      [r.cells[1].text.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''), r]));
    const teamId = 4;
    const wrong = [];
    for (let i = 0; i < season.SIZE; i++) {
      if (!season.onRoster(i, 8)) continue;
      const row = byName.get(season.playerName(teamId, i));
      if (!row) { wrong.push(`player ${i} missing`); continue; }
      for (let w = 1; w <= 13; w++) {
        const td = row.cells[4 + w];
        if (!season.onRoster(i, w)) {
          if (td.v !== null || !/\boff\b/.test(td.cls)) wrong.push(`p${i} wk${w} want off got ${td.text}/${td.cls}`);
          continue;
        }
        const want = season.projFor(i, w);
        if (want === null) {
          if (td.v !== null || td.text !== '\u2014') wrong.push(`p${i} wk${w} want blank got ${td.text}/${td.v}`);
        } else if (want === 0) {
          if (td.text !== 'Bye' || td.v !== '0') wrong.push(`p${i} wk${w} want Bye got ${td.text}/${td.v}`);
        } else if (Math.abs(Number(td.v) - want) > 0.051) {
          wrong.push(`p${i} wk${w} want ${want} got ${td.v}`);
        }
      }
    }
    c.ok('every cell carries the projection ESPN gave for that week',
      wrong.length === 0, wrong.slice(0, 5).join(' | '));

    // bye vs missing vs not-on-roster, all three distinguishable
    const flat = rows.flatMap((r) => r.cells.slice(5));
    const byes = flat.filter((td) => /\bbye\b/.test(td.cls));
    const blanks = flat.filter((td) => /\bmuted\b/.test(td.cls) && td.text === '\u2014');
    const offs = flat.filter((td) => /\boff\b/.test(td.cls));
    c.ok('a bye renders as the word Bye, not 0.0',
      byes.length === 1 && byes[0].text === 'Bye' && byes[0].v === '0', JSON.stringify(byes));
    c.ok('a bye still sorts as the zero it is', byes[0] && byes[0].v === '0', JSON.stringify(byes));
    c.ok('a missing number renders as a dash with no sort key',
      blanks.length === 1 && blanks[0].v === null, JSON.stringify(blanks));
    c.ok('a week he was not on the roster renders as its own kind of dash',
      offs.length === 4 && offs.every((td) => td.v === null && td.text === '\u2014'),
      `${offs.length} off cells`);
    c.ok('the three no-number states are told apart by class, not colour',
      new Set([byes[0].cls, blanks[0].cls, offs[0].cls]).size === 3,
      `${byes[0].cls} / ${blanks[0].cls} / ${offs[0].cls}`);
    c.ok('a bye is explained on hover',
      /on bye in week 6/.test(table.innerHTML) && /not the same as having no number/.test(table.innerHTML),
      'no bye tooltip');
    c.ok('an off-roster cell is explained on hover',
      /was not on this roster in week 1/.test(table.innerHTML), 'no off tooltip');

    // the average
    const avgWant = (i) => {
      const vals = [];
      for (let w = 1; w <= 13; w++) {
        if (!season.onRoster(i, w)) continue;
        const v = season.projFor(i, w);
        if (typeof v === 'number') vals.push(v);
      }
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    };
    const bad = [];
    for (let i = 0; i < season.SIZE; i++) {
      if (!season.onRoster(i, 8)) continue;
      const row = byName.get(season.playerName(teamId, i));
      if (!row) continue;
      if (Math.abs(Number(row.cells[4].v) - avgWant(i)) > 0.06) {
        bad.push(`p${i} want ${avgWant(i)} got ${row.cells[4].v}`);
      }
    }
    c.ok('Avg counts a bye as zero and leaves the unknown weeks out',
      bad.length === 0, bad.slice(0, 3).join(' | '));

    // the week the page is showing is marked
    c.ok('the shown week\u2019s column is bracketed',
      rows.every((r) => /\bnow\b/.test(r.cells[4 + 8].cls)) &&
      rows.every((r) => r.cells.slice(5).filter((td) => /\bnow\b/.test(td.cls)).length === 1),
      JSON.stringify(rows[0] && rows[0].cells.slice(5).map((x) => x.cls)));

    // injuries are shown, quietly, as availability
    c.ok('an injury designation is carried on the name, as elsewhere on this page',
      /class="inj/.test(table.innerHTML) && /\bOUT\b/.test(table.innerHTML), 'no injury pill');

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
    c.ok('and the season grid links the same men, by the same ids',
      JSON.stringify(hrefsIn('#seasonTable tbody td.name a.pref')) === JSON.stringify(sorted(want)),
      JSON.stringify(hrefsIn('#seasonTable tbody td.name a.pref')).slice(0, 300));

    // the grids: one row, all nine spots and the whole bench
    const grid4 = (id) => {
      const tr = d.querySelector(`#${id}Table tbody tr[data-team="${teamId}"]`);
      return [...tr.children].filter((td) => /\bslot-cell\b/.test(td.getAttribute('class') || ''));
    };
    for (const id of ['overview', 'weekly']) {
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
      /ESPN’s projection for weeks 1–13/.test(card0.heading), card0.heading);

    c.ok('IT IS A TWO-ROW CHART: WEEK NUMBERS OVER THEIR OWN PROJECTIONS',
      card0.rows === 2, `${card0.rows} rows in the run table`);
    c.ok('the top row is the weeks, in order, one per week of the season',
      JSON.stringify(card0.weeks) ===
        JSON.stringify(Array.from({ length: 13 }, (_, i) => String(i + 1))),
      JSON.stringify(card0.weeks));
    c.ok('the bottom row is a projection for every one of them',
      card0.values.length === card0.weeks.length, `${card0.values.length} v ${card0.weeks.length}`);
    c.ok('the two rows are one table, so a column cannot drift out of line',
      card0.weeks.length === 13 && card0.values.length === 13, 'the rows are not paired');

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
    c.ok('the week grid carries the same run — it is the same man either way',
      /ESPN’s projection for weeks 1–13/
        .test(hoverCard(d, boot.window, grid4('weekly')[0]).heading),
      hoverCard(d, boot.window, grid4('weekly')[0]).heading);
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
      season.calls.weeks.length === 13 && season.calls.week.length === 1 &&
      season.calls.schedule === 1,
      `weeks=${season.calls.weeks.length} week=${season.calls.week.length} sched=${season.calls.schedule}`);
  }

  // ---- (c) some weeks reject ----------------------------------------------
  if (scenario === 'live-partial') {
    const colOf = (w) => 4 + w;
    c.ok('the table still renders every player', rows.length === 15, `${rows.length}`);
    c.ok('the refused weeks are blank for everyone',
      rows.every((r) => r.cells[colOf(5)].text === '\u2014' && r.cells[colOf(11)].text === '\u2014'),
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.text)));
    c.ok('a refused week has no sort key',
      rows.every((r) => r.cells[colOf(5)].v === null && r.cells[colOf(11)].v === null), 'sort key present');
    c.ok('a refused week does not masquerade as one still loading',
      rows.every((r) => !/\bwait\b/.test(r.cells[colOf(5)].cls)), 'still says wait');
    // Week 2 is one of the four the last bench player is not yet rostered for.
    c.ok('the weeks that did load still carry numbers',
      rows.filter((r) => /^\d+\.\d$/.test(r.cells[colOf(2)].text)).length === 14 &&
      rows.filter((r) => /\boff\b/.test(r.cells[colOf(2)].cls)).length === 1,
      rows.map((r) => r.cells[colOf(2)].text).join(','));
    c.ok('the note names the weeks that failed',
      /ESPN did not return weeks 5 and 11/.test(note), note);
    c.ok('the note says what to do about it', /Reload the page to try again/.test(note), note);
    c.ok('the note says the average came from the weeks that loaded',
      /average is taken from the weeks that did load/.test(note), note);
    c.ok('the failed headers say so on hover',
      /Week 5 did not load/.test(table.innerHTML), 'no failed header tooltip');
    c.ok('the note still counts only the weeks it has',
      /11 loaded so far/.test(note), note);
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

    const WEEKS = Array.from({ length: 13 }, (_, i) => i + 1);
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
    c.ok('one column per week after them, thirteen of them',
      JSON.stringify(rb.head.slice(6)) === JSON.stringify(WEEKS.map(String)),
      JSON.stringify(rb.head.slice(6)));
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
    const names = (snap) => snap.rows.map((r) => r.cells[1].text.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''));

    c.ok('switching team repaints the grid with the other squad',
      w.team7 && names(w.team7)[0].startsWith('T7 ') && names(w.before)[0].startsWith('T4 '),
      `${names(w.before)[0]} -> ${names(w.team7)[0]}`);
    c.ok('switching team renames the panel',
      w.team7 && w.team7.title === 'Season by week \u00b7 Team 7', w.team7 && w.team7.title);
    c.ok('SWITCHING TEAM FETCHES NOTHING',
      eq(w.fetchesBefore, w.fetchesAfterSwitch),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterSwitch)}`);
    c.ok('every week column is still filled after the switch',
      w.team7 && w.team7.rows.every((r) => r.cells.slice(5).every((td) => !/\bwait\b/.test(td.cls))),
      'pending cells after switch');
    c.ok('the column set is unchanged by the switch',
      eq(w.before.cols, w.team7.cols), JSON.stringify(w.team7 && w.team7.cols));

    c.ok('clicking a row in the all-teams grid drives the same panel',
      w.team2 && names(w.team2)[0].startsWith('T2 '), w.team2 && names(w.team2)[0]);
    c.ok('the shared picker follows the grid click, so the two cannot disagree',
      w.teamSelectValue === '2', w.teamSelectValue);
    c.ok('the grid click fetches nothing either',
      eq(w.fetchesAfterSwitch, w.fetchesAfterGridClick), JSON.stringify(w.fetchesAfterGridClick));

    const col = (snap, i) => snap.rows.map((r) => (r.cells[i].v === null ? null : Number(r.cells[i].v)));
    const d7 = ordered(col(w.wk7desc, 11), false);
    const a7 = ordered(col(w.wk7asc, 11), true);
    c.ok('sorting a week column orders it descending', d7.monotonic && d7.n === 14,
      JSON.stringify(col(w.wk7desc, 11)));
    c.ok('clicking again reverses it', a7.monotonic && a7.n === 14, JSON.stringify(col(w.wk7asc, 11)));
    c.ok('the missing number sinks in BOTH directions', d7.nullsLast && a7.nullsLast,
      `desc=${d7.nullsLast} asc=${a7.nullsLast}`);

    const a6 = ordered(col(w.wk6asc, 10), true);
    c.ok('the bye sorts as the zero it is, at the bottom ascending',
      col(w.wk6asc, 10)[0] === 0 && a6.monotonic && a6.n === 15,
      JSON.stringify(col(w.wk6asc, 10)));

    const d1 = ordered(col(w.wk1desc, 5), false);
    const a1 = ordered(col(w.wk1asc, 5), true);
    c.ok('a week somebody was not rostered for still sorts, and he sinks both ways',
      d1.monotonic && a1.monotonic && d1.nullsLast && a1.nullsLast && d1.n === 14,
      `${JSON.stringify(col(w.wk1desc, 5))} / ${JSON.stringify(col(w.wk1asc, 5))}`);
    c.ok('sorting fetches nothing', eq(w.fetchesAfterGridClick, w.fetchesAfterSort),
      JSON.stringify(w.fetchesAfterSort));

    c.ok('changing the week changes the row set',
      w.week3 && w.week3.rows.length === 14 && w.before.rows.length === 15,
      `${w.week3 && w.week3.rows.length} vs ${w.before.rows.length}`);
    c.ok('the note follows the week it is describing',
      /roster as it stands in week 3/.test(w.note3 || ''), w.note3);
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
      eq(shapesOf(w.before, 11), shapesOf(w.wk7desc, 11)) &&
      eq(shapesOf(w.before, 11), shapesOf(w.wk7asc, 11)) &&
      shapesOf(w.before, 11).every((s) => s !== 'BAD'),
      `${JSON.stringify(shapesOf(w.before, 11))} vs ${JSON.stringify(shapesOf(w.wk7desc, 11))}`);
    c.ok('and the same values, only reordered — nothing was swallowed by a link',
      eq(keysOf(w.before, 11).slice().sort(), keysOf(w.wk7desc, 11).slice().sort()) &&
      eq(keysOf(w.before, 10).slice().sort(), keysOf(w.wk6asc, 10).slice().sort()),
      `${JSON.stringify(keysOf(w.before, 11))} vs ${JSON.stringify(keysOf(w.wk7desc, 11))}`);
  }

  // ---- (f) the two all-teams grids ---------------------------------------
  if (scenario === 'grids') {
    const w = globalThis.__an || {};
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const HEAD = ['Team', 'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'DEF', 'K', 'Total',
      'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    const teamRow = (g, name) => g.rows.find((r) => r.team === name);
    const nums = (row, from, to) => row.cells.slice(from, to).map((td) => td.v);

    const A = w.initial.avg;
    const W = w.initial.week;

    // -- the shape both grids share ---------------------------------------
    c.ok('the season grid is headed as a season average, not as a week',
      A.title === 'All teams · proj avg 2026', A.title);
    c.ok('the week grid is headed by the week the page is on',
      W.title === 'All teams · week 8', W.title);
    c.ok('the columns are the nine spots, the total, and then the bench',
      eq(A.head, HEAD), JSON.stringify(A.head));
    c.ok('and the week grid is the identical table',
      eq(W.head, A.head), JSON.stringify(W.head));
    c.ok('D/ST and the kicker are real columns now',
      A.head.includes('DEF') && A.head.includes('K'), JSON.stringify(A.head));
    c.ok('the old estimate columns are gone from both',
      !A.head.some((h) => /Baseline|Est Total|Wk proj|Wk actual/.test(h)) &&
      !W.head.some((h) => /Baseline|Est Total|Wk proj|Wk actual/.test(h)),
      JSON.stringify(A.head));
    c.ok('every header is sortable',
      [...d.querySelectorAll('#overviewTable thead th')].every((th) => th.hasAttribute('data-sort')),
      'a header is not sortable');
    c.ok('both grids carry every team',
      A.rows.length === 10 && W.rows.length === 10, `${A.rows.length} / ${W.rows.length}`);

    // -- NO NAMES in the cells, but every name on hover --------------------
    const cellText = A.rows.flatMap((r) => r.cells).map((td) => td.text);
    c.ok('NOT ONE CELL CARRIES A PLAYER NAME',
      cellText.every((t) => !/Player \d/.test(t)),
      cellText.filter((t) => /Player \d/.test(t)).slice(0, 3).join(' | '));
    c.ok('a lineup cell is a bare number',
      A.rows.every((r) => r.cells.slice(0, 9).every((td) => /^-?\d+\.\d$/.test(td.text))),
      JSON.stringify(A.rows[0].cells.slice(0, 9).map((td) => td.text)));
    // The name moved from a `title` to the card, so it is read from there.
    const lineupCells = [...d.querySelectorAll('#overviewTable tbody td[data-tip]')];
    const someCards = lineupCells.slice(0, 12).map((td) => hoverCard(d, boot.window, td));
    c.ok('and the name is still there on hover',
      someCards.every((k) => k && /Player \d\d/.test(k.ident)), someCards[0] && someCards[0].ident);
    c.ok('the card carries the position and the NFL team too',
      someCards.every((k) => /· (QB|RB|WR|TE|DST|K) · /.test(k.ident)),
      someCards[0] && someCards[0].ident);

    // -- the bench, with its position in the cell --------------------------
    // "12.3 RB4" — the position AND where he ranks at it on his own team. The
    // position alone said what he is; the number says what he is worth having,
    // which is the question a bench column is actually asked.
    c.ok('a bench cell carries the position AND his rank at it, beside the number',
      A.rows.every((r) => r.cells.slice(10).every((td) =>
        /^\d+\.\d (QB|RB|WR|TE|DST|K)\d+$/.test(td.text))),
      JSON.stringify(A.rows[0].cells.slice(10).map((td) => td.text)));
    c.ok('and a lineup cell deliberately does not — its header already says it',
      A.rows.every((r) => r.cells.slice(0, 9).every((td) => !/[A-Z]{1,3}$/.test(td.text))),
      JSON.stringify(A.rows[0].cells.slice(0, 9).map((td) => td.text)));

    // -- team 4's arithmetic, by hand --------------------------------------
    const a4 = teamRow(A, 'Team 4');
    c.ok('the season grid fills the nine spots best-first by season average',
      eq(nums(a4, 0, 9), ['20', '19', '18', '17', '16', '15', '14', '13', '12']),
      JSON.stringify(nums(a4, 0, 9)));
    c.ok('TOTAL IS THOSE NINE ADDED UP, NOT AN ESTIMATE',
      a4.cells[9].text === '144.0' && a4.cells[9].v === '144',
      `${a4.cells[9].text} / ${a4.cells[9].v}`);
    // Ranks counted over the WHOLE squad, starters included, which is what the
    // number means to a manager. Team 4 holds RBs at 19, 18, 11 and 6, so the
    // bench pair are RB3 and RB4; WRs at 17, 16, 14, 10 and 7 make WR4 and WR5;
    // two QBs make QB2 and two TEs make TE2.
    c.ok('the bench follows it, best first, six deep, each with his rank',
      eq(a4.cells.slice(10).map((td) => td.text),
        ['11.0 RB3', '10.0 WR4', '9.0 QB2', '8.0 TE2', '7.0 WR5', '6.0 RB4']),
      JSON.stringify(a4.cells.slice(10).map((td) => td.text)));
    c.ok('and a lineup cell still carries no position or rank at all',
      a4.cells.slice(0, 9).every((td) => /^-?\d+(\.\d+)?$/.test(td.text)),
      JSON.stringify(a4.cells.slice(0, 9).map((td) => td.text)));

    const w4 = teamRow(W, 'Team 4');
    c.ok('the week grid is the same nine men on that week’s numbers',
      eq(nums(w4, 0, 9), ['22.4', '21.4', '20.4', '19.4', '18.4', '17.4', '16.4', '15.4', '14.4']),
      JSON.stringify(nums(w4, 0, 9)));
    c.ok('and its total is what ESPN itself says the team is projected',
      w4.cells[9].text === '165.6', w4.cells[9].text);

    // -- ordering ----------------------------------------------------------
    const totals = (g) => g.rows.map((r) => Number(r.cells[9].v));
    c.ok('both grids open ranked by Total, best first',
      totals(A).every((v, i) => i === 0 || v <= totals(A)[i - 1]) &&
      totals(W).every((v, i) => i === 0 || v <= totals(W)[i - 1]),
      `${JSON.stringify(totals(A))} / ${JSON.stringify(totals(W))}`);

    // -- clicking either grid drills in ------------------------------------
    c.ok('a click in the WEEK grid drives the roster detail below',
      w.picked.team === '2', w.picked.team);
    c.ok('and both grids mark the drilled-into row',
      /\bpicked\b/.test(teamRow(w.picked.snap.avg, 'Team 2').cls) &&
      /\bpicked\b/.test(teamRow(w.picked.snap.week, 'Team 2').cls),
      `${teamRow(w.picked.snap.avg, 'Team 2').cls} / ${teamRow(w.picked.snap.week, 'Team 2').cls}`);

    // -- a player link does not drag the drill-down with it -----------------
    c.ok('the grid link is a real href carrying that team’s own ESPN id',
      w.ref && /^waivers\.html\?player=5\d\d$/.test(w.ref.href), w.ref && w.ref.href);
    c.ok('CLICKING A PLAYER LINK LEAVES THE DRILLED-INTO TEAM ALONE',
      w.afterRefClick.team === '2' && eq(w.afterRefClick.picked, ['2']),
      `${w.afterRefClick.team} / ${JSON.stringify(w.afterRefClick.picked)}`);
    c.ok('but clicking the row anywhere else still drills in, as it always did',
      w.afterNameClick.team === '5', w.afterNameClick.team);

    // -- changing the week moves ONE of them -------------------------------
    const a4b = teamRow(w.week6.avg, 'Team 4');
    const w4b = teamRow(w.week6.week, 'Team 4');
    c.ok('changing the week leaves the season-average grid exactly as it was',
      eq(a4b.cells.map((td) => td.text), a4.cells.map((td) => td.text)),
      JSON.stringify(a4b.cells.map((td) => td.text)));
    c.ok('and its heading still names the season, not the week',
      w.week6.avg.title === 'All teams · proj avg 2026', w.week6.avg.title);
    c.ok('the week grid follows the selector',
      w.week6.week.title === 'All teams · week 6', w.week6.week.title);

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
    c.ok('the season-average grid never calls anything a bye — an average is not a week',
      w.week6.avg.rows.every((r) => r.cells.every((td) => td.text !== 'Bye')),
      'a Bye in the average grid');

    // -- the notes ---------------------------------------------------------
    c.ok('the season note owns the average as a typical week over 17 games',
      /typical week/.test(w.notes.avg) && /divided by 17 games/.test(w.notes.avg),
      w.notes.avg.slice(0, 200));
    c.ok('it says the Total is nine real men rather than an estimate',
      /nine real men, not an estimate/.test(w.notes.avg), w.notes.avg.slice(0, 400));
    c.ok('it says why the position is in the bench cell and not in the header',
      /every bench is a different shape/.test(w.notes.avg), w.notes.avg.slice(0, 500));
    c.ok('it says the name and the season are on hover, and that it is a chart',
      /Hovering any number gives that man/.test(w.notes.avg) &&
      /weeks along the top, his projection for each one underneath/.test(w.notes.avg),
      w.notes.avg.slice(0, 600));
    c.ok('and it says what the number after a bench position means',
      /where he ranks at that position on his own team/.test(w.notes.avg) &&
      /counting the starters too/.test(w.notes.avg), w.notes.avg.slice(0, 700));
    c.ok('the week note says which week it is measured on',
      /projection for the week selected at the top of the page/.test(w.notes.week),
      w.notes.week.slice(0, 300));
    c.ok('and warns that the lineup is re-picked, so the FLEX can differ',
      /re-picked on that week’s numbers/.test(w.notes.week), w.notes.week.slice(0, 300));
    c.ok('and explains a Bye against having no number at all',
      /0\.00 ESPN returns/.test(w.notes.week), w.notes.week.slice(0, 400));
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
    const seasonCell = named('#seasonTable tbody td.name', noIdName)[0];
    c.ok('the man with no id is still on the page, drawn as he always was',
      Boolean(rosterCell) && Boolean(seasonCell) && txt(rosterCell) === noIdName,
      `${rosterCell && txt(rosterCell)} / ${seasonCell && txt(seasonCell)}`);
    c.ok('NO LINK IS EMITTED FOR HIM, in the roster detail or the season grid',
      rosterCell && !rosterCell.querySelector('a.pref') &&
      seasonCell && !seasonCell.querySelector('a.pref'),
      `${rosterCell && rosterCell.innerHTML} | ${seasonCell && seasonCell.innerHTML}`);

    // He is every team's QB, so it is the QB column of both grids that loses
    // its link — and only that column.
    for (const id of ['overview', 'weekly']) {
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
        return k && k.ident.startsWith(`${noIdName} · QB · BUF`) && k.weeks.length === 13;
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
    c.ok('SWAPPING FETCHES NOTHING',
      eq(w.fetchesBefore, w.fetchesAfterSwap),
      `${JSON.stringify(w.fetchesBefore)} -> ${JSON.stringify(w.fetchesAfterSwap)}`);

    // -- the season panel shares the lineup --------------------------------
    c.ok('the season panel moves the same two men',
      s.season.includes('T4 Player 09=RBS') && s.season.includes('T4 Player 02=BEB'),
      s.season.join(' '));
    c.ok('and had them the other way round before the swap',
      i0.season.includes('T4 Player 09=BEB') && i0.season.includes('T4 Player 02=RBS'),
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
