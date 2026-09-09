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

const SCENARIOS = {
  demo: {
    label: '(a) demo mode, nothing connected',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
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
    after: async ({ document, window }) => {
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
      click(ths[5]);                       // week 5
      out.wk5desc = snap();
      click(ths[5]);
      out.wk5asc = snap();
      click(ths[4]);                       // week 4 -- one player has no number
      out.wk4desc = snap();
      click(ths[4]);
      out.wk4asc = snap();
      out.fetchesAfterSort = espn.calls.weeks.slice();

      // --- widening the span: only the new weeks are fetched ---------------
      click(document.querySelector('#spanFilter button[data-span="6"]'));
      await new Promise((r) => setTimeout(r, 400));
      out.wide = snap();
      out.fetchesAfterWiden = espn.calls.weeks.slice();

      // --- narrowing again: everything is already cached -------------------
      click(document.querySelector('#spanFilter button[data-span="3"]'));
      await new Promise((r) => setTimeout(r, 200));
      out.narrow = snap();
      out.fetchesAfterNarrow = espn.calls.weeks.slice();
      out.prefs = globalThis.localStorage.getItem('ff.prefs');

      globalThis.__wv = out;
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
  'live-midload': {
    label: '(b++) the span is widened while the first weeks are still in the air',
    stub: true,
    env: { WV_DELAY: '80' },
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    wait: 60,
    after: async ({ document, window }) => {
      const espn = await import('./wv-stub-espn.mjs');
      const table = document.getElementById('waiverTable');
      const inFlight = espn.calls.weeks.slice();
      document
        .querySelector('#spanFilter button[data-span="all"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2500));
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
    wait: 40,
    after: async ({ document, window }) => {
      document
        .querySelector('#sourceToggle button[data-src="demo"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      const table = document.getElementById('waiverTable');
      const trs = [...table.querySelectorAll('tbody tr')];
      globalThis.__wv = {
        rows: trs.map((tr) => tr.children[0].textContent.trim()),
        available: trs.filter((tr) => !/\bmine\b/.test(tr.getAttribute('class') || ''))
          .map((tr) => tr.children[0].textContent.trim()),
        badge: document.getElementById('modeBadge').textContent.trim(),
        note: document.getElementById('waiverNote').textContent.replace(/\s+/g, ' ').trim(),
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
  await new Promise((r) => setTimeout(r, cfg.wait ?? 500));
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

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);
  const table = $('waiverTable');
  const note = txt($('waiverNote'));

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));

  const head = headers(table);
  const rows = bodyRows(table);

  // ---- the shape the owner asked for --------------------------------------
  c.ok('identity columns are Player, Pos, Tm and Avg',
    JSON.stringify(head.slice(0, 4)) === JSON.stringify(['Player', 'Pos', 'Tm', 'Avg']),
    JSON.stringify(head));
  c.ok('nothing but weeks after them',
    head.slice(4).every((h) => /^\d+$/.test(h)) && head.length > 4, JSON.stringify(head));
  const defaultSpan = scenario !== 'live-midload';
  if (defaultSpan) {
    c.ok('one column per week, three of them by default',
      head.length === 7, JSON.stringify(head));
    c.ok('the note says how many weeks of how many',
      /3 weeks of the 13 this season runs to/.test(note), note);
  }
  c.ok('the note says what the numbers are',
    /projection/i.test(note) && /snapshot/i.test(note), note);
  c.ok('the note explains a Bye against a blank',
    /Bye is the 0\.00 ESPN returns/.test(note) && /blank cell means/.test(note), note);
  c.ok('the note owns the average as ours',
    /Avg is the mean of the weeks shown and is ours, not ESPN’s/.test(note), note);

  // ---- (a) demo ------------------------------------------------------------
  if (scenario === 'demo') {
    c.ok('badge says Demo', txt($('modeBadge')) === 'Demo', txt($('modeBadge')));
    c.ok('badge is styled demo', /\bdemo\b/.test($('modeBadge').getAttribute('class')));
    c.ok('weeks start at the demo current week',
      JSON.stringify(head.slice(4)) === JSON.stringify(['4', '5', '6']), JSON.stringify(head));
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
      rows.some((r) => r.cells.slice(4).some((td) => td.text === '—' && td.v === null)),
      'no blank cell');
    c.ok('the cost line says demo widening is free',
      /costs nothing to widen/.test(txt($('spanCost'))), txt($('spanCost')));
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
      c.ok('one request per shown week, and no more',
        JSON.stringify(asked) === JSON.stringify([4, 5, 6]), JSON.stringify(espn.calls.weeks));
      c.ok('the whole pool is asked for once per week',
        espn.calls.limits.every((l) => l === 100), JSON.stringify(espn.calls.limits));
    }

    c.ok('every stubbed free agent is listed', rows.length === 60, `${rows.length}`);
    c.ok('weeks 4, 5 and 6 are the columns',
      JSON.stringify(head.slice(4)) === JSON.stringify(['4', '5', '6']), JSON.stringify(head));

    // Values match what parseFreeAgent should have produced.
    const byName = new Map(rows.map((r) => [r.cells[0].text.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''), r]));
    let wrong = [];
    for (const p of espn.roster) {
      const row = byName.get(p.name);
      if (!row) { wrong.push(`${p.name} missing`); continue; }
      [4, 5, 6].forEach((w, i) => {
        const td = row.cells[4 + i];
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
    const byeCells = rows.flatMap((r) => r.cells.slice(4)).filter((td) => /\bbye\b/.test(td.cls));
    const blankCells = rows.flatMap((r) => r.cells.slice(4)).filter((td) => td.text === '—');
    c.ok('the bye renders as Bye, not 0.0',
      byeCells.length === 1 && byeCells[0].text === 'Bye' && byeCells[0].v === '0',
      JSON.stringify(byeCells));
    c.ok('a missing number renders as a dash with no sort key',
      blankCells.length === 2 && blankCells.every((td) => td.v === null),
      JSON.stringify(blankCells));

    // Averages: byes counted, blanks left out.
    const bye = byName.get('Player 00 QB');
    const want = ([4, 5, 6].map((w) => espn.expected(bye.cells[0] && 5000, w)));
    const mean = want.reduce((a, b) => a + b, 0) / 3;
    c.ok('the average counts a bye as the zero ESPN returned',
      Math.abs(Number(bye.cells[3].v) - mean) < 0.02, `${bye.cells[3].v} vs ${mean}`);

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
    const d5 = ordered(col(w.wk5desc, 5), false);
    const a5 = ordered(col(w.wk5asc, 5), true);
    c.ok('sorting a week column orders it descending', d5.monotonic && d5.n === 60,
      JSON.stringify(col(w.wk5desc, 5).slice(0, 6)));
    c.ok('clicking again reverses it', a5.monotonic && a5.n === 60,
      JSON.stringify(col(w.wk5asc, 5).slice(0, 6)));
    c.ok('the bye sorts as the zero it is',
      col(w.wk5asc, 5)[0] === 0, JSON.stringify(col(w.wk5asc, 5).slice(0, 3)));

    const d4 = ordered(col(w.wk4desc, 4), false);
    const a4 = ordered(col(w.wk4asc, 4), true);
    c.ok('a week with a missing value still sorts', d4.monotonic && a4.monotonic,
      JSON.stringify(col(w.wk4desc, 4).slice(0, 4)));
    c.ok('the missing value sinks in BOTH directions', d4.nullsLast && a4.nullsLast && d4.n === 59,
      `desc nullsLast=${d4.nullsLast} asc nullsLast=${a4.nullsLast} n=${d4.n}`);
    c.ok('sorting fetches nothing',
      JSON.stringify(w.fetchesAfterSort) === JSON.stringify(w.fetchesAfterFilter),
      JSON.stringify(w.fetchesAfterSort));

    c.ok('widening the span adds three week columns',
      w.wide && w.wide.cols.length === 10 &&
      JSON.stringify(w.wide.cols.slice(4)) === JSON.stringify(['4', '5', '6', '7', '8', '9']),
      JSON.stringify(w.wide && w.wide.cols));
    c.ok('widening fetches only the weeks it does not have',
      JSON.stringify(w.fetchesAfterWiden.slice().sort((a, b) => a - b)) ===
        JSON.stringify([4, 5, 6, 7, 8, 9]), JSON.stringify(w.fetchesAfterWiden));
    c.ok('narrowing again fetches nothing',
      JSON.stringify(w.fetchesAfterNarrow) === JSON.stringify(w.fetchesAfterWiden),
      JSON.stringify(w.fetchesAfterNarrow));
    c.ok('narrowing goes back to three week columns',
      w.narrow && w.narrow.cols.length === 7, JSON.stringify(w.narrow && w.narrow.cols));
    c.ok('the choices are remembered',
      /"waivers.position":"ALL"/.test(w.prefs || '') && /"waivers.span":"3"/.test(w.prefs || ''), w.prefs);
    c.ok('the whole interaction cost nine requests',
      espn.calls.weeks.length === 6, JSON.stringify(espn.calls.weeks));
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
    c.ok('every remaining week is fetched exactly once',
      JSON.stringify(w.fetches.slice().sort((a, b) => a - b)) ===
        JSON.stringify([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), JSON.stringify(w.fetches));
    c.ok('the table ends up with a column for every week',
      JSON.stringify(w.cols.slice(4)) ===
        JSON.stringify(['4', '5', '6', '7', '8', '9', '10', '11', '12', '13']),
      JSON.stringify(w.cols));
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
    c.ok('the failed weeks are blank', rows.every((r) => r.cells[5].text === '—' && r.cells[6].text === '—'),
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.text)));
    c.ok('week 4 still carries numbers',
      rows.filter((r) => /^\d+\.\d$/.test(r.cells[4].text)).length === 59,
      rows.slice(0, 2).map((r) => r.cells[4].text).join(','));
    c.ok('the note names the weeks that failed',
      /ESPN did not return weeks 5 and 6/.test(note), note);
    c.ok('a refused week does not masquerade as one still loading',
      rows.every((r) => !/\bwait\b/.test(r.cells[5].cls) && !/\bwait\b/.test(r.cells[6].cls)),
      JSON.stringify(rows[0] && rows[0].cells.map((x) => x.cls)));
    c.ok('a refused week has no sort key',
      rows.every((r) => r.cells[5].v === null && r.cells[6].v === null), 'sort key present');
    c.ok('the note says what to do about it', /Reload the page to try again/.test(note), note);
    c.ok('the average is taken from the weeks that did load',
      /average is taken from the weeks that did load/.test(note), note);
  }

  // ---- (d) empty pool ------------------------------------------------------
  if (scenario === 'live-empty') {
    const empty = table.querySelector('tr.empty-row');
    c.ok('an empty pool says so rather than showing nothing', Boolean(empty), 'no empty row');
    c.ok('the empty state gives the reason',
      empty && /nobody is unrostered in this league right now/.test(txt(empty)), txt(empty));
    c.ok('the empty state spans every column',
      empty && empty.querySelector('td').getAttribute('colspan') === '7',
      empty && empty.querySelector('td').getAttribute('colspan'));
    c.ok('no headline numbers are invented', txt($('waiverStats')) === '', txt($('waiverStats')));
    c.ok('the position counts stay blank',
      [...d.querySelectorAll('#posFilter .seg-count')].every((s) => txt(s) === ''), 'counts shown');
  }

  // ---- the summary strip ---------------------------------------------------
  if (scenario === 'demo' || scenario === 'live') {
    const stats = [...$('waiverStats').querySelectorAll('.stat')].map((s) => txt(s));
    c.ok('the strip counts what is on screen', stats.some((s) => /^Available/.test(s)), stats.join(' | '));
    c.ok('the strip states the weeks shown', stats.some((s) => /^Weeks shown/.test(s)), stats.join(' | '));
    c.ok('the strip names the best average by player',
      stats.some((s) => /^Best average/.test(s)), stats.join(' | '));
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
