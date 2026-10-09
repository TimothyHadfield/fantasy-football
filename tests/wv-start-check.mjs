// "Who to start" on the PLAYERS page (Tim, 2026-10-09): the Analysis page's
// box, above the free agents, for your own squad at the position the filter is
// on. End to end against the real waivers.html + js/waivers-page.js.
//
//   node wv-start-check.mjs
//
// WHAT IS COMPARED WITH WHAT. The box is drawn by js/who-to-start.js, the
// module the Analysis page draws its own with. So after the page has painted,
// each scenario builds the SAME league a second time, straight from the stub
// and without the page — the weeks on screen, the squads in each, who "you"
// are — hands that to the shared module, and requires the page's rows to be
// the rows it gives back, cell for cell. The names and two hand-worked cells
// are then checked against the stub's raw numbers, so the comparison is not
// the module agreeing with itself about a wrong league.
//
// The squads are an-stub-season.mjs's (through start-stub-season.mjs): real
// lineups, seven weeks played, week 8 the one a claim made now would be for.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const ME = 4;
const CONN = { leagueId: '99', season: 2026, teamId: ME };
const NO_TEAM = { leagueId: '99', season: 2026 };
const LIVE = { 'waivers.source': 'live' };
const PLAYED = [1, 2, 3, 4, 5, 6, 7];   // the stub's schedule has these decided
const NOW = 8;

// A league's frozen Value lines, in the shape js/value.js `buildBase` writes.
const VALUE_BASE = {
  v: 1,
  setAt: Date.UTC(2026, 8, 29, 12),
  week: 8,
  lines: {
    QB: { waiver: 14, starter: 18, agents: 3, starters: 10 },
    RB: { waiver: 8, starter: 11, agents: 3, starters: 20 },
    WR: { waiver: 8, starter: 11, agents: 3, starters: 20 },
    TE: { waiver: 5.5, starter: 7.5, agents: 3, starters: 10 },
    K: { waiver: 7, starter: 9.5, agents: 3, starters: 10 },
    DST: { waiver: 6, starter: 8, agents: 3, starters: 10 },
  },
};
const VALUE_ENV = { FF_VALUE: JSON.stringify({ base: VALUE_BASE, weeks: [8, 9, 10, 11, 12, 13], players: {} }) };

const SCENARIOS = {
  all: {
    label: '(a) absent with All positions; there once one is picked; gone again on All',
    prefs: LIVE, conn: CONN,
  },
  noTeam: {
    label: '(b) absent with nobody set as you, whatever the position',
    prefs: { ...LIVE, 'waivers.position': 'WR' }, conn: NO_TEAM,
  },
  wr: {
    label: '(c) WR: exactly your receivers, and every cell the shared renderer’s',
    prefs: { ...LIVE, 'waivers.position': 'WR' }, conn: CONN,
  },
  filter: {
    label: '(d) the position filter and the span change the box, and buy nothing',
    prefs: { ...LIVE, 'waivers.position': 'WR' }, conn: CONN,
  },
  value: {
    label: '(e) Proj | Value: the box follows the page’s one switch',
    prefs: { ...LIVE, 'waivers.position': 'RB' }, conn: CONN, env: VALUE_ENV,
  },
  synced: {
    label: '(f) the phone’s synced copy: the box, and nothing asked of ESPN',
    prefs: { ...LIVE, 'waivers.position': 'WR' }, conn: CONN, env: { START_CLOUD: '1' },
  },
  demo: {
    label: '(g) the sample league: the box for the stand-in team',
    prefs: { 'waivers.source': 'demo', 'waivers.position': 'RB' }, conn: null,
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
        const s = this.querySelector('option[selected]') || this.querySelector('option');
        return s ? s.getAttribute('value') ?? s.textContent : '';
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
  await new Promise((r) => setTimeout(r, 2000));
  console.error = origError;

  return { document, window, errors, fetchCalls, rejections, cfg };
}

// ------------------------------------------------------------- assertions

function makeChecker() {
  const out = [];
  return {
    out,
    ok(name, cond, detail = '') {
      out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 500) });
    },
  };
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What the page has on screen for the box, read off the document. */
function snap(d) {
  const panel = d.getElementById('startPanel');
  const table = d.getElementById('startersTable');
  const rows = table ? [...table.querySelectorAll('tbody tr')] : [];
  return {
    exists: Boolean(panel && table),
    shown: Boolean(panel && !panel.hasAttribute('hidden')),
    title: txt(d.getElementById('startersTitle')),
    headCells: table ? table.querySelectorAll('thead th').length : 0,
    weeks: table ? [...table.querySelectorAll('thead th[data-wkh]')].map((th) => Number(th.getAttribute('data-wkh'))) : [],
    heads: table ? [...table.querySelectorAll('thead tr:last-child th')].slice(0, 6).map(txt) : [],
    names: rows.map((tr) => txt(tr.querySelector('td.name'))),
    pos: rows.map((tr) => txt(tr.children[2])),
    rows: rows.map((tr) => tr.outerHTML),
    cells: rows.map((tr) => [...tr.children].slice(6).map((td) => ({
      text: txt(td), cls: td.getAttribute('class') || '', v: td.getAttribute('data-v'),
    }))),
    starts: rows.map((tr) => txt(tr.children[5])),
  };
}

/**
 * The same box from the shared module, for a league built here from the stub.
 * `weeks` are the columns; `pos` the filter; `valueBase` the lines when the
 * page is on Value. Returned as rows of outerHTML read back through the same
 * parser the page's went through, so the two can be compared as strings.
 */
async function expectedBox(d, { weeks, pos, valueBase = null, history = 'actual' }) {
  const season = await import('./start-stub-season.mjs');
  const shared = await import(pathToFileURL(path.join(REPO, 'js/who-to-start.js')).href);
  const value = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);

  const seasonWeeks = new Map();
  for (const w of weeks) seasonWeeks.set(w, (await season.fetchWeekRosters(w)).teams);
  const state = {
    seasonWeeks,
    seasonFailed: new Set(),
    weeks,
    poWeeks: [],
    playedWeeks: PLAYED,
    week: NOW,
    data: { teams: seasonWeeks.get(NOW) },
    isDemo: false,
    byes: {},
    startersPos: pos,
  };
  shared.configure({
    state,
    valueOn: () => valueBase !== null,
    asValue: (p, x) => value.valueOf(valueBase, p.position, x),
    historyMode: () => history,
    sourceKey: () => `check:${pos}:${weeks.join(',')}:${valueBase ? 'v' : 'p'}:${history}`,
    glanceFor: () => null,
  });
  const team = state.data.teams.find((t) => t.id === ME);
  const data = shared.startersData(team);
  const scratch = d.createElement('table');
  scratch.innerHTML = `<thead>${shared.startersHeadHtml(data)}</thead><tbody>${shared.startersBodyHtml(team, data)}</tbody>`;
  return {
    rows: [...scratch.querySelectorAll('tbody tr')].map((tr) => tr.outerHTML),
    weeks: [...scratch.querySelectorAll('thead th[data-wkh]')].map((th) => Number(th.getAttribute('data-wkh'))),
    count: data.rows.length,
  };
}

// A card is registered under a running number (`data-tip="w:38"`), which counts
// every paint the page has made; which number a cell got is not a difference.
const keyless = (rows) => rows.map((r) => r.replace(/ data-(tip|pop)="[^"]*"/g, ' data-$1')).sort();
const sameRows = (a, b) => a.length === b.length && keyless(a).join('\n') === keyless(b).join('\n');
const firstDiff = (a, b) => {
  const x = keyless(a); const y = keyless(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) {
      const s = x[i] || ''; const t = y[i] || '';
      let k = 0;
      while (k < s.length && s[k] === t[k]) k++;
      return `${x.length} v ${y.length} rows; row ${i} at ${k}: …${s.slice(Math.max(0, k - 60), k + 80)}… v …${t.slice(Math.max(0, k - 60), k + 80)}…`;
    }
  }
  return '';
};

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const w = boot.window;
  const click = (sel) => d.querySelector(sel).dispatchEvent(new w.Event('click', { bubbles: true }));
  const season = await import('./start-stub-season.mjs');
  const espn = await import('./wv-stub-espn.mjs');
  const asked = () => JSON.stringify({ rosters: season.calls.weeks, one: season.calls.week, wire: espn.calls.weeks });

  // Read everything the page shows BEFORE the shared module is pointed at the
  // league built here: it is one module, and the page's box is drawn from it.
  const first = snap(d);
  const askedAtBoot = asked();
  const seen = {};

  if (scenario === 'all') {
    click('#posFilter button[data-pos="WR"]');
    seen.wr = snap(d);
    click('#posFilter button[data-pos="ALL"]');
    seen.back = snap(d);
  }
  if (scenario === 'filter') {
    click('#posFilter button[data-pos="RB"]');
    seen.rb = snap(d);
    click('#posFilter button[data-pos="FLEX"]');
    seen.flex = snap(d);
    click('#posFilter button[data-pos="DST"]');
    seen.dst = snap(d);
    click('#posFilter button[data-pos="WR"]');
    seen.askedAfterFilters = asked();
    click('#spanFilter button[data-span="6"]');
    await sleep(900);
    seen.six = snap(d);
    // The other table's filter is not this one.
    click('#takenPosFilter button[data-pos="QB"]');
    seen.afterTaken = snap(d);
  }
  if (scenario === 'value') {
    seen.switchShown = !d.getElementById('showCtl').hasAttribute('hidden');
    click('#showToggle button[data-show="value"]');
    seen.value = snap(d);
    click('#takenShowToggle button[data-show="proj"]');
    seen.proj = snap(d);
  }
  if (scenario === 'synced') {
    click('#posFilter button[data-pos="RB"]');
    click('#posFilter button[data-pos="WR"]');
    await sleep(300);
    seen.again = snap(d);
    seen.askedAfter = asked();
  }
  const pageErrors = boot.errors.slice();

  c.ok('no console errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));
  c.ok('the box is in the page, directly above the Available players panel', first.exists &&
    (() => {
      const panel = d.getElementById('startPanel');
      const next = panel.nextElementSibling;
      return next && next.contains(d.getElementById('waiverTable'));
    })(), 'not there, or not just above');

  const near3 = [...PLAYED, 8, 9, 10];

  // ---- (a) All positions -----------------------------------------------
  if (scenario === 'all') {
    c.ok('ABSENT WITH "All": the panel is hidden', !first.shown, 'shown');
    c.ok('and it holds nothing — no header, no rows', first.headCells === 0 && first.rows.length === 0,
      `${first.headCells} header cells, ${first.rows.length} rows`);
    c.ok('picking a position brings it in', seen.wr.shown && seen.wr.rows.length > 0, JSON.stringify(seen.wr.names));
    c.ok('headed "Who to start · WR" and nothing more', seen.wr.title === 'Who to start · WR', seen.wr.title);
    c.ok('back on All it is hidden and empty again',
      !seen.back.shown && seen.back.headCells === 0 && seen.back.rows.length === 0,
      `${seen.back.shown} ${seen.back.headCells} ${seen.back.rows.length}`);
  }

  // ---- (b) nobody set as you -------------------------------------------
  if (scenario === 'noTeam') {
    c.ok('the filter IS on a position', /\bon\b/.test(d.querySelector('#posFilter button[data-pos="WR"]').getAttribute('class') || ''),
      'WR not pressed');
    c.ok('ABSENT WITH NO TEAM: the panel is hidden', !first.shown, 'shown');
    c.ok('and it holds nothing', first.headCells === 0 && first.rows.length === 0,
      `${first.headCells} header cells, ${first.rows.length} rows`);
    c.ok('the free agents are still drawn', d.querySelectorAll('#waiverTable tbody tr').length > 5,
      `${d.querySelectorAll('#waiverTable tbody tr').length} rows`);
  }

  // ---- (c) your receivers ----------------------------------------------
  if (scenario === 'wr') {
    const want = await expectedBox(d, { weeks: near3, pos: 'WR' });
    c.ok('the box is shown', first.shown, 'hidden');
    c.ok('headed "Who to start · WR"', first.title === 'Who to start · WR', first.title);

    // From the stub's raw squad, not from any renderer: team 4's receivers.
    const mine = season.POS.map((p, i) => (p === 'WR' ? season.playerName(ME, i) : null)).filter(Boolean);
    c.ok('EXACTLY YOUR PLAYERS AT THE POSITION: five receivers, all team 4’s',
      mine.length === 5 && first.names.length === 5 && mine.every((n) => first.names.includes(n)),
      `${JSON.stringify(first.names)} want ${JSON.stringify(mine)}`);
    c.ok('nobody else’s man, and no other position',
      first.names.every((n) => n.startsWith(`T${ME} `)) && first.pos.every((p) => p === 'WR'),
      `${JSON.stringify(first.names)} ${JSON.stringify(first.pos)}`);

    c.ok('the columns are the Analysis box’s: Depth, Player, Pos, NFL, Avg, Starts',
      first.heads.join('|') === 'Depth|Player|Pos|NFL|Avg|Starts', first.heads.join('|'));
    const wireWeeks = [...d.querySelectorAll('#waiverTable thead tr:last-child th')]
      .map((th) => txt(th)).filter((t) => /^\d+/.test(t)).map((t) => parseInt(t, 10));
    c.ok('the weeks are the Available table’s week columns, in the same order',
      first.weeks.join(',') === near3.join(',') && wireWeeks.join(',') === near3.join(','),
      `box ${first.weeks.join(',')} wire ${wireWeeks.join(',')}`);

    c.ok('THE SAME BOX: every row is the shared renderer’s for this league, cell for cell',
      sameRows(first.rows, want.rows), firstDiff(first.rows, want.rows));
    c.ok('and the shared renderer had five rows to give', want.count === 5, want.count);

    // Two cells worked by hand from the stub's numbers.
    const row = (i) => first.names.indexOf(season.playerName(ME, i));
    const at = (i, week) => first.cells[row(i)][near3.indexOf(week)];
    const p9 = season.projFor(3, 9);
    c.ok('a week to come is ESPN’s projection: Player 03 in week 9',
      at(3, 9) && parseFloat(at(3, 9).text) === p9, `${JSON.stringify(at(3, 9))} want ${p9}`);
    c.ok('and he is marked in the best lineup that week', /\bst\b/.test(at(3, 9).cls), at(3, 9).cls);
    c.ok('the third receiver makes it through the flex', /\bst\b/.test(at(6, 9).cls) && /\bfx\b/.test(at(6, 9).cls), at(6, 9).cls);
    c.ok('the fifth does not make it', !/\bst\b/.test(at(13, 9).cls), at(13, 9).cls);
    c.ok('a week played is what he scored: Player 03 in week 2',
      parseFloat(at(3, 2).text) === Math.round((15 - 3 * 0.7) * 10) / 10, JSON.stringify(at(3, 2)));
    c.ok('Starts counts the marked cells on the row',
      first.cells.every((cells, i) => cells.filter((x) => /\bst\b/.test(x.cls)).length === Number(first.starts[i])),
      first.starts.join(','));
    c.ok('a name is a link to that man on this page',
      [...d.querySelectorAll('#startersTable tbody td.name a.pref')].length === 5 &&
      [...d.querySelectorAll('#startersTable tbody td.name a.pref')].every((a) =>
        /^waivers\.html\?player=4\d\d$/.test(a.getAttribute('href') || '')),
      (d.querySelector('#startersTable tbody td.name') || {}).innerHTML);
  }

  // ---- (d) the filter and the span -------------------------------------
  if (scenario === 'filter') {
    c.ok('it opens on the saved position', first.shown && first.title === 'Who to start · WR', first.title);
    for (const [key, pos, label] of [['rb', 'RB', 'RB'], ['flex', 'FLEX', 'FLEX'], ['dst', 'DST', 'DEF']]) {
      const s = seen[key];
      const want = await expectedBox(d, { weeks: near3, pos });
      c.ok(`${pos}: the heading follows the filter`, s.title === `Who to start · ${label}`, s.title);
      c.ok(`${pos}: the rows are the shared renderer’s for that position`,
        s.shown && sameRows(s.rows, want.rows), firstDiff(s.rows, want.rows));
    }
    c.ok('RB is not WR: different men', seen.rb.names.length > 0 && seen.rb.names.every((n) => !first.names.includes(n)),
      `${JSON.stringify(seen.rb.names)} v ${JSON.stringify(first.names)}`);
    c.ok('RB lists running backs only', seen.rb.pos.every((p) => p === 'RB') && seen.rb.pos.length === 4,
      JSON.stringify(seen.rb.pos));
    c.ok('FLEX lists every RB, WR and TE you hold, each under his own position',
      seen.flex.pos.filter((p) => p === 'RB').length === 4 && seen.flex.pos.filter((p) => p === 'WR').length === 5 &&
      seen.flex.pos.filter((p) => p === 'TE').length === 2 && seen.flex.pos.length === 11,
      JSON.stringify(seen.flex.pos));
    c.ok('FLICKING THROUGH THE POSITIONS BUYS NOTHING: no roster or wire read was added',
      seen.askedAfterFilters === askedAtBoot, `${askedAtBoot} -> ${seen.askedAfterFilters}`);

    const near6 = [...PLAYED, 8, 9, 10, 11, 12, 13];
    const want6 = await expectedBox(d, { weeks: near6, pos: 'WR' });
    c.ok('a wider span adds its weeks to the box', seen.six.weeks.join(',') === near6.join(','), seen.six.weeks.join(','));
    c.ok('and the rows are the shared renderer’s over those weeks',
      sameRows(seen.six.rows, want6.rows), firstDiff(seen.six.rows, want6.rows));
    c.ok('the Taken table’s own filter does not move it',
      seen.afterTaken.title === 'Who to start · WR' && sameRows(seen.afterTaken.rows, seen.six.rows), seen.afterTaken.title);
  }

  // ---- (e) Proj | Value -------------------------------------------------
  if (scenario === 'value') {
    const proj = await expectedBox(d, { weeks: near3, pos: 'RB' });
    const val = await expectedBox(d, { weeks: near3, pos: 'RB', valueBase: VALUE_BASE });
    c.ok('the page has its Proj | Value switch', seen.switchShown, 'hidden');
    c.ok('on Proj the box is the shared renderer’s in points', sameRows(first.rows, proj.rows), firstDiff(first.rows, proj.rows));
    c.ok('ON VALUE THE BOX IS THE SHARED RENDERER’S IN VALUE', sameRows(seen.value.rows, val.rows),
      firstDiff(seen.value.rows, val.rows));
    c.ok('which is not what it showed on Proj', !sameRows(seen.value.rows, first.rows), 'identical');
    // By hand: T4 Player 01, an RB projected 19.7 + 0.3·9 … in week 9 = 21.7;
    // against the RB lines (8 free, 11 a starter) that is far over a starter.
    const p = season.projFor(1, 9);
    const i = seen.value.names.indexOf(season.playerName(ME, 1));
    const cell = seen.value.cells[i][near3.indexOf(9)];
    const value = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);
    const wantV = value.valueOf(VALUE_BASE, 'RB', p);
    c.ok('a week to come reads as his Value at his position, not his points',
      typeof wantV === 'number' && Math.abs(Number(cell.text.replace(/[^\d.+-]/g, '')) - wantV) < 0.051 &&
      Math.abs(wantV - p) > 0.5, `${JSON.stringify(cell)} want ${wantV} (points ${p})`);
    c.ok('the switch under the Taken table is the same switch: back to Proj', sameRows(seen.proj.rows, proj.rows),
      firstDiff(seen.proj.rows, proj.rows));
  }

  // ---- (f) the synced copy ---------------------------------------------
  if (scenario === 'synced') {
    const want = await expectedBox(d, { weeks: near3, pos: 'WR' });
    c.ok('this IS the synced copy', Boolean(await season.cloudSource()), 'not');
    c.ok('the box is drawn there too', first.shown && sameRows(first.rows, want.rows), firstDiff(first.rows, want.rows));
    c.ok('ZERO ESPN REQUESTS: nothing reached the network', boot.fetchCalls.length === 0, boot.fetchCalls.join(' | '));
    c.ok('and the box read nothing of its own: the reads after it is redrawn are the reads at boot',
      seen.askedAfter === askedAtBoot, `${askedAtBoot} -> ${seen.askedAfter}`);
    const boot2 = JSON.parse(askedAtBoot);
    c.ok('the roster weeks read are the ones the page’s own tables need, once each',
      [...boot2.rosters].sort((a, b) => a - b).join(',') === near3.join(',') && boot2.one.length === 0,
      JSON.stringify(boot2));
    c.ok('it is still there after the filter is moved and moved back', sameRows(seen.again.rows, first.rows), 'changed');
  }

  // ---- (g) the sample league -------------------------------------------
  if (scenario === 'demo') {
    c.ok('the box is shown for the stand-in team', first.shown && first.rows.length > 0, `${first.shown} ${first.rows.length}`);
    c.ok('headed "Who to start · RB"', first.title === 'Who to start · RB', first.title);
    c.ok('running backs only', first.pos.length > 0 && first.pos.every((p) => p === 'RB'), JSON.stringify(first.pos));
    const wireWeeks = [...d.querySelectorAll('#waiverTable thead tr:last-child th')]
      .map((th) => txt(th)).filter((t) => /^\d+/.test(t)).map((t) => parseInt(t, 10));
    c.ok('its weeks are the Available table’s', first.weeks.length > 3 && first.weeks.join(',') === wireWeeks.join(','),
      `box ${first.weeks.join(',')} wire ${wireWeeks.join(',')}`);
    c.ok('somebody is marked as a start', first.cells.some((cells) => cells.some((x) => /\bst\b/.test(x.cls))), 'no marks');
    const team = txt(d.querySelector('#teamSelect option[selected]'));
    const mine = [...d.querySelectorAll('#takenTable tbody tr')]
      .filter((tr) => txt(tr).includes(team)).map((tr) => txt(tr.querySelector('td.name')));
    c.ok('every man the box says you hold is that team’s in the Taken table',
      team.length > 0 && [...d.querySelectorAll('#startersTable tbody tr')]
        .filter((tr) => !/\bgone\b/.test(tr.getAttribute('class') || ''))
        .every((tr) => mine.some((n) => n.includes(txt(tr.querySelector('td.name'))))),
      `${team}: ${JSON.stringify(first.names)} v ${JSON.stringify(mine.slice(0, 20))}`);
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
    emit({
      scenario,
      results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }],
    }, 1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const res = spawnSync(
    process.execPath,
    ['--import', './start-register.mjs', self, scenario],
    { encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...(cfg.env || {}) } }
  );
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
