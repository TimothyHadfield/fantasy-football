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
import path from 'node:path';

import { REPO } from './repo.mjs';

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
};

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
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

  return { document, errors, fetchCalls, rejections, cfg };
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
  }

  // ---- (b) live, every week resolves --------------------------------------
  if (scenario.startsWith('live') || scenario === 'team-switch') {
    c.ok('badge says Live', txt($('modeBadge')) === 'Live', txt($('modeBadge')));
  }

  // The detailed cell checks read the live DOM, so they only make sense in the
  // scenario that has not been clicked about in afterwards.
  if (scenario === 'live') {
    const season = await import('./an-stub-season.mjs');
    c.ok('the page opened on the last week played', txt($('overviewTitle')).endsWith('week 8'),
      txt($('overviewTitle')));

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
