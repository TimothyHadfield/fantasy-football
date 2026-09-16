// The Trade page, end to end: the real trade.html with its real module.
//
//   node tr-test.mjs
//
// `test-trade.mjs` proves the engine. This proves the PAGE — that the depth map
// and the finder actually reach the screen, that the controls repaint the right
// panel, and that none of them costs a request. Those are the failures a pure
// engine suite cannot see, and the ones that only ever show up in a browser.
//
// One scenario per child process: an ES module initialises once per process and
// `js/trade-page.js` self-boots on import, so two boots cannot share one.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

// ------------------------------------------------------------------ harness

async function boot(page = 'trade.html', search = '', seed = null) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom defines <select>.value on HTMLSelectElement.prototype and returns
  // undefined; shimming HTMLElement.prototype does nothing (it is shadowed) and
  // would break <input> too. See tests/README.md.
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

  // Take the table prototype from an element linkedom actually made, NOT from
  // window.HTMLTableElement — they are not always the same object here, and
  // defining on the wrong one leaves table.tBodies undefined.
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const rows = [];
      const head = kids(this, 'THEAD')[0];
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

  // js/bridge.js reads window.location.origin on every ping and linkedom
  // provides no location; the throw would surface as an unhandled rejection out
  // of connection.js and kill the child, which looks like a page failure.
  window.location = {
    href: `http://localhost/${page}${search}`, origin: 'http://localhost',
    protocol: 'http:', pathname: `/${page}`, search, hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  // Seeded BEFORE the page's modules are imported, because connection.js and
  // prefs.js both read storage on first touch — a league written afterwards
  // would arrive too late to put the page on live data.
  const store = new Map(Object.entries(seed || {}));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (u) => { fetchCalls.push(String(u)); throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  await settle();
  console.error = origError;

  return { document, window, errors, fetchCalls };
}

/**
 * Let the deferred work finish: it hands off through rAF then a timeout.
 *
 * The default covers a scalar search, which is a quarter of a second. The
 * WEEKLY search is a different animal — every offer is priced by re-filling
 * nine to thirteen lineups — and needs seconds rather than milliseconds, which
 * is itself a cost the page states.
 */
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function fire(el, type = 'change') {
  const ev = new globalThis.Event(type, { bubbles: true });
  el.dispatchEvent(ev);
}

// ------------------------------------------------------------------- reading

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

function readDepth(document) {
  const table = document.getElementById('depthTable');
  const heads = [...table.querySelectorAll('thead th')].map((th) => text(th));
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) => ({
    team: text(tr.querySelector('td.name')),
    me: tr.getAttribute('class') === 'me',
    cells: [...tr.querySelectorAll('td.cell')].map((td) => ({
      v: td.getAttribute('data-v'),
      text: text(td),
      deep: (td.getAttribute('class') || '').includes('deep'),
      thin: (td.getAttribute('class') || '').includes('thin'),
      tip: td.getAttribute('title') || '',
    })),
    total: text(tr.querySelector('td.grouped')),
  }));
  return { heads, rows, bars: [...document.querySelectorAll('#depthBars .bar-chip')].map(text) };
}

function readTrades(document) {
  const table = document.getElementById('tradeTable');
  return [...table.querySelectorAll('tbody tr')].map((tr) => {
    const tds = [...tr.children];
    return {
      partner: text(tds[0]),
      shape: text(tds[1]),
      send: [...tds[2].querySelectorAll('.man')].map(text),
      receive: [...tds[3].querySelectorAll('.man')].map(text),
      churn: text(tds[3].querySelector('.churn')),
      beforeAfter: text(tds[4]),
      gainText: text(tds[5]),
      myGain: Number(tds[5].getAttribute('data-v')),
      theirGain: Number(tds[6].getAttribute('data-v')),
      espn: (() => {
        const a = tds[7] ? tds[7].querySelector('a') : null;
        return a ? a.getAttribute('href') : text(tds[7] || null);
      })(),
      // Every man named carries a card key. The card itself is opened below;
      // this is only "was one registered at all".
      cards: [...tr.querySelectorAll('.man[data-tip]')].length,
      links: [...tr.querySelectorAll('a.pref')].map((a) => a.getAttribute('href')),
    };
  });
}

/** "+12.3" / "−4.0" / "12.3" -> a number. The minus sign is U+2212. */
const num = (s) => Number(String(s).replace(/−/g, '-').replace(/\+/g, '').trim());

/** The week-by-week table inside a container: one row per week, then totals. */
function readWeekTable(el) {
  const table = el ? el.querySelector('table.weeks') : null;
  if (!table) return null;
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const tds = [...tr.children];
    return {
      label: text(tds[0]),
      total: (tr.getAttribute('class') || '').includes('total'),
      before: num(text(tds[1])),
      after: num(text(tds[2])),
      delta: num(text(tds[3])),
    };
  });
  return {
    weeks: rows.filter((r) => !r.total),
    totals: rows.filter((r) => r.total),
    heads: [...table.querySelectorAll('thead th')].map(text),
  };
}

function readCost(document) {
  return {
    button: text(document.getElementById('loadWeeks')),
    spent: text(document.getElementById('costSpent')),
    note: text(document.getElementById('costNote')),
  };
}

function readDeal(document) {
  const panel = document.getElementById('dealPanel');
  const body = document.getElementById('dealBody');
  return {
    hidden: (panel.getAttribute('class') || '').includes('hidden'),
    title: text(document.getElementById('dealTitle')),
    note: text(document.getElementById('dealNote')),
    body: text(body),
    weeks: readWeekTable(body),
    espn: (() => {
      const a = body.querySelector('a.espn-open');
      return a ? a.getAttribute('href') : '';
    })(),
    cards: [...body.querySelectorAll('.man[data-tip]')].length,
  };
}

/**
 * The combo panel. The BEST packing and the "most trades" alternative are read
 * separately on purpose: they are two different packings of the same offers, so
 * a man may legitimately appear in both, and a reader that pooled them would
 * report a disjointness failure that is not one.
 */
function readCombo(document) {
  const body = document.getElementById('comboBody');
  const best = body.querySelector('.combo-best') || body;
  const alt = body.querySelector('.combo-alt');
  const ids = (el) =>
    el ? [...el.querySelectorAll('.combo-list li a.pref')].map((a) => a.getAttribute('href')) : [];
  // Each trade's two sides, as ESPN ids, so the whole packing can be re-priced
  // from the engine rather than read back off the page that printed it.
  const side = (li, cls) =>
    [...li.querySelectorAll(`.${cls} a.pref`)].map((a) =>
      Number((a.getAttribute('href') || '').replace(/^\D+/, '')));
  const perTrade = [...best.querySelectorAll('.combo-list li')].map((li) => ({
    send: side(li, 'c-send'),
    receive: side(li, 'c-receive'),
  }));
  return {
    head: text(best.querySelector('.combo-head')),
    items: [...best.querySelectorAll('.combo-list li')].map(text),
    // The men, by ESPN's own id rather than by their printed name: the cell
    // text runs a name into a position into two numbers, and the whole point
    // of the site's link contract is that the id is the identity.
    names: ids(best),
    altNames: ids(alt),
    perTrade,
    alt: text(alt),
    weeks: readWeekTable(best),
    body: text(body),
    note: text(document.getElementById('comboNote')),
  };
}

/** Open the hover card on one named player, and read what it drew. */
function openCard(document, selector) {
  const man = document.querySelector(selector);
  if (!man) return null;
  man.dispatchEvent(new globalThis.Event('mouseover', { bubbles: true }));
  const el = document.getElementById('tipCard');
  if (!el) return null;
  return {
    hidden: !!el.hidden,
    ident: text(el.querySelector('.tc-ident')),
    heading: text(el.querySelector('.tc-head')),
    weeks: [...el.querySelectorAll('.tc-run thead th')].map(text).filter((t) => /^\d+$/.test(t)),
    projs: [...el.querySelectorAll('.tc-run tbody td')].map(text),
    hovered: text(man),
  };
}

// ------------------------------------------------------------------ scenarios

const SCENARIOS = {
  /** The page as it opens: demo data, both panels populated. */
  async fresh() {
    const { document, errors, fetchCalls } = await boot();
    return {
      errors, fetchCalls,
      depth: readDepth(document),
      trades: readTrades(document),
      note: text(document.getElementById('depthNote')),
      tradeNote: text(document.getElementById('tradeNote')),
      empty: text(document.getElementById('tradeEmpty')),
      emptyHidden: (document.getElementById('tradeEmpty').getAttribute('class') || '').includes('hidden'),
      badge: text(document.getElementById('modeBadge')),
      teams: [...document.querySelectorAll('#teamSelect option')].map(text),
      partners: [...document.querySelectorAll('#partnerSelect option')].map(text),
    };
  },

  /** Every package shape, searched separately. */
  async shapes() {
    const { document, fetchCalls, errors } = await boot();
    const out = { fetchCalls, errors, byKind: {} };
    for (const kind of ['all', 'even', 'consolidate', 'depth']) {
      const btn = document.querySelector(`#kindToggle button[data-kind="${kind}"]`);
      btn.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
      await settle();
      out.byKind[kind] = {
        on: btn.getAttribute('class') || '',
        rows: readTrades(document).map((r) => ({ shape: r.shape, send: r.send.length, get: r.receive.length })),
        empty: text(document.getElementById('tradeEmpty')),
      };
    }
    return out;
  },

  /** Switching team repaints both panels; switching partner narrows one. */
  async controls() {
    const { document, fetchCalls, errors } = await boot();
    const before = { depth: readDepth(document), trades: readTrades(document) };

    const teamSel = document.getElementById('teamSelect');
    const second = [...teamSel.querySelectorAll('option')][3];
    teamSel.value = second.getAttribute('value');
    fire(teamSel);
    await settle();
    const afterTeam = { depth: readDepth(document), trades: readTrades(document) };

    // Narrow to a manager who DOES have offers, so "only his offers" is a real
    // claim rather than a vacuous one about an empty list — and then to one who
    // has none, which is the path that used to leave stale rows in the document.
    const partnerSel = document.getElementById('partnerSelect');
    const options = [...partnerSel.querySelectorAll('option')].slice(1);
    const withOffers = afterTeam.trades.length ? afterTeam.trades[0].partner : null;
    const busy = options.find((o) => text(o) === withOffers) || options[0];
    const quiet =
      options.find((o) => !afterTeam.trades.some((t) => t.partner === text(o))) || null;

    const narrow = (option) => {
      partnerSel.value = option.getAttribute('value');
      fire(partnerSel);
      return {
        name: text(option),
        trades: readTrades(document),
        // Read raw from the tbody rather than from what is visible. Hiding the
        // wrapper without emptying it is exactly the bug this scenario found,
        // and a reader that skipped hidden rows would have agreed with it.
        wrapHidden: (document.getElementById('tradeWrap').getAttribute('class') || '').includes('hidden'),
        empty: text(document.getElementById('tradeEmpty')),
      };
    };

    const afterPartner = narrow(busy);
    await settle();
    const afterQuietPartner = quiet ? narrow(quiet) : null;
    await settle();

    // Back to everybody: a filter has to be reversible.
    partnerSel.value = 'all';
    fire(partnerSel);
    await settle();
    const afterReset = readTrades(document);

    const measure = document.getElementById('measureSelect');
    measure.value = 'week';
    fire(measure);
    await settle();
    const afterMeasure = { depth: readDepth(document), note: text(document.getElementById('depthNote')) };

    return {
      fetchCalls, errors, before, afterTeam,
      afterPartner, afterQuietPartner, afterReset, afterMeasure,
    };
  },

  /**
   * The weekly measure on demo data: pressed for, then read everywhere.
   *
   * Demo generates its weeks inside the page, so this costs no requests — which
   * is exactly why it is the scenario that can check the whole of the weekly
   * path (the drill-down, the combo, the cards) while still asserting that the
   * page made no network call at all.
   */
  async weekly() {
    const { document, errors, fetchCalls } = await boot();
    const before = {
      cost: readCost(document),
      depth: readDepth(document),
      trades: readTrades(document),
      combo: readCombo(document),
      weeks: [...document.querySelectorAll('#weekSelect option')].map((o) => o.getAttribute('value')),
      week: document.getElementById('weekSelect').value,
    };

    document
      .getElementById('loadWeeks')
      .dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(12000); // 13 weeks of lineup fills per offer; it is not quick

    const after = {
      cost: readCost(document),
      depth: readDepth(document),
      trades: readTrades(document),
      combo: readCombo(document),
      heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
      note: text(document.getElementById('tradeNote')),
      depthNote: text(document.getElementById('depthNote')),
      spares: [...document.querySelectorAll('#spareStrip .spare-chip[data-tip]')].map(text),
      measure: document.getElementById('measureSelect').value,
    };

    // Click the first offer: the drill-down is the whole of ask 3.
    const row = document.querySelector('#tradeTable tbody tr');
    if (row) row.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(1200);
    const deal = readDeal(document);

    // And a card on a player name, which is ask 1.
    const card = openCard(document, '#tradeTable .man[data-tip]');
    const spareCard = openCard(document, '#spareStrip .spare-chip[data-tip]');

    return {
      errors, fetchCalls, before, after, deal, card, spareCard,
      // What the parent needs to rebuild the same league and price the same
      // packing independently.
      myTeamId: document.getElementById('teamSelect').value,
      week: Number(document.getElementById('weekSelect').value),
    };
  },

  /**
   * A real league, stubbed: what the weekly measure COSTS, and what the ESPN
   * deep link says.
   *
   * The stub is four squads built so the two measures disagree on purpose —
   * see tr-stub-season.mjs. Everything here is re-derived from that fixture
   * rather than read back off the page.
   */
  async live() {
    const seed = {
      'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
      'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
    };
    const { document, errors } = await boot('trade.html', '', seed);
    const stub = await import('./tr-stub-season.mjs');

    const before = {
      week: document.getElementById('weekSelect').value,
      badge: text(document.getElementById('modeBadge')),
      cost: readCost(document),
      trades: readTrades(document),
      requests: stub.calls.week.length,
      asked: stub.calls.week.slice(),
    };

    document
      .getElementById('loadWeeks')
      .dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(6000);

    const after = {
      cost: readCost(document),
      trades: readTrades(document),
      combo: readCombo(document),
      heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
      note: text(document.getElementById('tradeNote')),
      requests: stub.calls.week.length,
      asked: stub.calls.week.slice(),
      measure: document.getElementById('measureSelect').value,
    };

    // Drill into the offer with Cy, which survives both measures.
    const rows = [...document.querySelectorAll('#tradeTable tbody tr')];
    const idx = after.trades.findIndex((t) => t.partner === 'Cy');
    if (idx >= 0) rows[idx].dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(1500);
    const deal = readDeal(document);

    return {
      errors, before, after, deal,
      offer: idx >= 0 ? after.trades[idx] : null,
      rosters: { 1: stub.rosterIds(1), 2: stub.rosterIds(2), 3: stub.rosterIds(3) },
      span: stub.WEEKS - stub.PLAYED_THROUGH + 1,
    };
  },
};

// --------------------------------------------------------------- child runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const name = process.argv[2];
  try {
    const out = await SCENARIOS[name]();
    console.log('@@' + JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    console.log('@@' + JSON.stringify({ boot: String((err && err.stack) || err) }));
    process.exit(1);
  }
}

/** `stub: true` redirects js/season.js to tr-stub-season.mjs in the child. */
function run(name, { stub = false } = {}) {
  const args = stub ? ['--import', './tr-register.mjs', self, name] : [self, name];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8', cwd: path.dirname(self),
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`no result for ${name}\n${res.stdout}\n${res.stderr}`);
  return JSON.parse(line.slice(2));
}

// ------------------------------------------------------------------ assertions

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- it opens, on demo data, with both panels full ------------------------

const fresh = run('fresh');
ok('the page boots', !fresh.boot, fresh.boot);
if (!fresh.boot) {
  ok('no console errors', fresh.errors.length === 0, fresh.errors.slice(0, 2).join(' | '));
  ok('and no network call at all — the page is one week of rosters, read twice',
    fresh.fetchCalls.length === 0, fresh.fetchCalls.slice(0, 2).join(' | '));
  eq(fresh.badge, 'Demo', 'it opens on demo data and says so');

  // ---- the depth map -----------------------------------------------------
  eq(fresh.depth.rows.length, 10, 'a row per manager');
  eq(fresh.teams.length, 10, 'every manager is offered as "your team"');
  eq(fresh.partners.length, 10, 'and nine partners plus "Any manager"');
  eq(fresh.partners[0], 'Any manager', 'the partner filter opens wide');
  ok('exactly one row is marked as yours',
    fresh.depth.rows.filter((r) => r.me).length === 1,
    `${fresh.depth.rows.filter((r) => r.me).length} marked`);

  eq(fresh.depth.heads[0], 'Manager', 'the first column names the manager');
  ok('the positions are the ones this league starts',
    fresh.depth.heads.slice(1, -1).join(',') === 'QB,RB,WR,TE,DST,K',
    fresh.depth.heads.join(','));
  eq(fresh.depth.heads[fresh.depth.heads.length - 1], 'Lineup', 'and the squad total closes it');

  ok('every cell carries a sortable value', fresh.depth.rows.every((r) =>
    r.cells.length === 6 && r.cells.every((c) => c.v !== null && c.v !== '')),
    JSON.stringify(fresh.depth.rows[0]));

  // COLOUR IS NEVER THE ONLY CUE. Every cell prints a number, and every cell
  // that is not exactly level prints its own sign — so the table reads with the
  // tint off, in greyscale, or to anyone who cannot separate the two hues. Same
  // rule as the two greens on the Players page. A true zero is left unsigned
  // because it has no sign to print; it is also, by definition, the one value
  // that is not saying anything.
  ok('every cell prints a number', fresh.depth.rows.every((r) =>
    r.cells.every((c) => /^[+−]?\d/.test(c.text))),
    fresh.depth.rows.flatMap((r) => r.cells.map((c) => c.text)).join(' '));
  ok('and every cell that is not level carries an explicit sign',
    fresh.depth.rows.every((r) =>
      r.cells.every((c) => Number(c.v) === 0 || /^[+−]/.test(c.text))),
    fresh.depth.rows.flatMap((r) => r.cells.filter((c) => !/^[+−]/.test(c.text)).map((c) => `${c.v}:${c.text}`)).join(' '));

  // The tint is a ranking within a column, so it cannot be all of one column
  // or none of it.
  for (let i = 0; i < 6; i++) {
    const deep = fresh.depth.rows.filter((r) => r.cells[i].deep).length;
    const thin = fresh.depth.rows.filter((r) => r.cells[i].thin).length;
    const pos = fresh.depth.heads[i + 1];
    ok(`${pos}: the tint marks some squads, not all of them`,
      deep + thin < fresh.depth.rows.length, `${deep} deep, ${thin} thin of 10`);
    ok(`${pos}: no squad is both deep and thin`,
      !fresh.depth.rows.some((r) => r.cells[i].deep && r.cells[i].thin));
  }

  ok('every cell explains itself on hover',
    fresh.depth.rows.every((r) => r.cells.every((c) => /startable/.test(c.tip))),
    fresh.depth.rows[0].cells[0].tip);

  ok('the replacement bar for every column is stated, not implied',
    fresh.depth.bars.length === 6, fresh.depth.bars.join(' | '));

  // The note has to say what the number IS. This is the house rule: state the
  // basis of every derived number in a panel note.
  for (const phrase of ['points above replacement', 'not starting anywhere', 'down a column']) {
    ok(`the depth note explains "${phrase}"`, fresh.note.includes(phrase), fresh.note.slice(0, 160));
  }

  // ---- the finder --------------------------------------------------------
  ok('the finder found trades in the demo league', fresh.trades.length > 0,
    `${fresh.trades.length} offers · ${fresh.empty}`);
  ok('the finder is not left saying it is still searching',
    !/still searching|Trying every swap/.test(fresh.empty), fresh.empty);

  ok('every offer helps YOU', fresh.trades.every((t) => t.myGain > 0),
    JSON.stringify(fresh.trades.map((t) => t.myGain)));
  ok('and every offer helps HIM — which is the whole premise',
    fresh.trades.every((t) => t.theirGain > 0),
    JSON.stringify(fresh.trades.map((t) => t.theirGain)));
  ok('offers are ranked by what they are worth to you',
    fresh.trades.every((t, i) => i === 0 || fresh.trades[i - 1].myGain >= t.myGain),
    fresh.trades.map((t) => t.myGain).join(','));

  ok('every offer names who it is with',
    fresh.trades.every((t) => t.partner.length > 0));
  ok('every offer moves at least one man each way',
    fresh.trades.every((t) => t.send.length >= 1 && t.receive.length >= 1));
  ok('every offer shows your lineup before and after',
    fresh.trades.every((t) => /→/.test(t.beforeAfter)), fresh.trades[0].beforeAfter);

  // THE LINE THAT MAKES AN OFFER CHECKABLE. A net figure asks to be trusted;
  // two names and two numbers can be verified against ESPN by eye.
  ok('every offer says who starts and who drops out',
    fresh.trades.every((t) => /starts:/.test(t.churn)),
    fresh.trades[0].churn);

  // The site-wide click-through contract. link-check.mjs follows these ids to
  // the Players page; here we only insist the page emits them at all.
  const links = fresh.trades.flatMap((t) => t.links);
  ok('every player named is a link to his row on the Players page',
    links.length >= fresh.trades.length * 2 &&
    links.every((h) => /^waivers\.html\?player=\d+$/.test(h)),
    `${links.length} links, e.g. ${links[0]}`);

  for (const phrase of ['both totals go up', 'Nothing is sent to ESPN', 'drop somebody']) {
    ok(`the finder note explains "${phrase}"`, fresh.tradeNote.includes(phrase),
      fresh.tradeNote.slice(0, 200));
  }
}

// ---- the shape filter is a search, and it is honest about what it returns --

const shapes = run('shapes');
ok('the shape scenario boots', !shapes.boot, shapes.boot);
if (!shapes.boot) {
  ok('changing the shape costs no request', shapes.fetchCalls.length === 0,
    shapes.fetchCalls.join(' | '));
  ok('and logs no error', shapes.errors.length === 0, shapes.errors.slice(0, 2).join(' | '));

  const want = {
    even: (r) => r.send === 1 && r.get === 1,
    consolidate: (r) => r.send === 2 && r.get === 1,
    depth: (r) => r.send === 1 && r.get === 2,
  };
  for (const [kind, test] of Object.entries(want)) {
    const got = shapes.byKind[kind];
    ok(`the ${kind} button lights up when pressed`, /\bon\b/.test(got.on), got.on);
    ok(`searching ${kind} returns only that shape`, got.rows.every(test),
      JSON.stringify(got.rows.slice(0, 4)));
  }

  // "Any shape" must be a superset — if it returned fewer than a narrowed
  // search, the narrowing would be finding things the wide search misses.
  const all = shapes.byKind.all.rows.length;
  ok('"Any shape" returns at least as much as any one shape',
    all >= Math.max(...Object.keys(want).map((k) => shapes.byKind[k].rows.length)),
    `all=${all}, ${Object.keys(want).map((k) => `${k}=${shapes.byKind[k].rows.length}`).join(' ')}`);

  // A shape with nothing to offer says so in words rather than showing a blank
  // panel. In the demo league the straight swaps are genuinely empty, which is
  // the case worth having covered.
  for (const kind of Object.keys(want)) {
    const got = shapes.byKind[kind];
    ok(`${kind}: an empty result is explained, not left blank`,
      got.rows.length > 0 || /No trade here makes both squads better/.test(got.empty),
      got.empty.slice(0, 140));
  }
}

// ---- the controls repaint the right panel, and cost nothing ---------------

const ctl = run('controls');
ok('the controls scenario boots', !ctl.boot, ctl.boot);
if (!ctl.boot) {
  ok('driving every control costs no request', ctl.fetchCalls.length === 0,
    ctl.fetchCalls.join(' | '));
  ok('and logs no error', ctl.errors.length === 0, ctl.errors.slice(0, 2).join(' | '));

  // Changing YOUR team moves the highlight and re-runs the search from the new
  // squad. The depth numbers themselves are a property of the league, not of
  // who is reading, so they must NOT move.
  const wasMine = ctl.before.depth.rows.findIndex((r) => r.me);
  const nowMine = ctl.afterTeam.depth.rows.findIndex((r) => r.me);
  ok('picking another team moves the highlight', wasMine !== nowMine, `${wasMine} -> ${nowMine}`);
  ok('exactly one row is still yours',
    ctl.afterTeam.depth.rows.filter((r) => r.me).length === 1);
  ok('but the depth numbers do not move — they are the league, not the reader',
    JSON.stringify(ctl.before.depth.rows.map((r) => r.cells.map((c) => c.v))) ===
    JSON.stringify(ctl.afterTeam.depth.rows.map((r) => r.cells.map((c) => c.v))));
  ok('and the search is re-run from the new squad',
    JSON.stringify(ctl.before.trades.map((t) => t.send)) !==
    JSON.stringify(ctl.afterTeam.trades.map((t) => t.send)),
    'the offers are identical after switching team');
  ok('you are never offered a trade with yourself',
    ctl.afterTeam.trades.every((t) => t.partner !== ctl.afterTeam.depth.rows[nowMine].team),
    ctl.afterTeam.depth.rows[nowMine].team);

  // The partner select is the one true filter on the page: it can only ever
  // narrow what the whole-league search already found.
  ok('narrowing to a manager who has offers actually shows some',
    ctl.afterPartner.trades.length > 0,
    `${ctl.afterPartner.name} came back empty, so the next assertion means nothing`);
  ok('and shows only his',
    ctl.afterPartner.trades.every((t) => t.partner === ctl.afterPartner.name),
    `${ctl.afterPartner.name}: ${[...new Set(ctl.afterPartner.trades.map((t) => t.partner))].join(',')}`);
  ok('and never invents one the wide search had not found',
    ctl.afterPartner.trades.length <= ctl.afterTeam.trades.length,
    `${ctl.afterPartner.trades.length} vs ${ctl.afterTeam.trades.length}`);

  // A filter that matches nothing must EMPTY the table, not merely hide it.
  // Leaving the previous rows in a hidden wrapper is invisible on screen and
  // completely wrong in the document, which is how it survived being looked at.
  if (ctl.afterQuietPartner) {
    ok('a manager with no offers leaves NO stale rows behind',
      ctl.afterQuietPartner.trades.length === 0,
      `${ctl.afterQuietPartner.trades.length} rows still in the table for ${ctl.afterQuietPartner.name}`);
    ok('and the table is hidden rather than showing an empty frame',
      ctl.afterQuietPartner.wrapHidden);
    ok('and the page says why in words',
      /No trade here makes both squads better/.test(ctl.afterQuietPartner.empty),
      ctl.afterQuietPartner.empty.slice(0, 140));
  }

  ok('going back to "Any manager" restores the whole list',
    ctl.afterReset.length === ctl.afterTeam.trades.length,
    `${ctl.afterReset.length} vs ${ctl.afterTeam.trades.length}`);

  // The measure really is wired to both panels.
  ok('switching to the week measure changes the depth numbers',
    JSON.stringify(ctl.afterMeasure.depth.rows.map((r) => r.cells.map((c) => c.v))) !==
    JSON.stringify(ctl.afterTeam.depth.rows.map((r) => r.cells.map((c) => c.v))),
    'the measure toggle changed nothing, so one of the two is being ignored');
  ok('and the note says which basis is in use',
    /selected week/.test(ctl.afterMeasure.note), ctl.afterMeasure.note.slice(0, 200));
}

// ------------------------------------------------- re-deriving, not reading
//
// The suite's own copy of the arithmetic, built from the SAME demo generator
// the page uses but with nothing of the page in it. Everything here is the
// engine called directly, so a page that printed a plausible wrong number has
// nowhere to hide.

/** Price one packing of trades across the rest of the season, from scratch. */
async function repriceCombo(week, teamId, perTrade) {
  if (!perTrade || !perTrade.length) return null;
  const { generateDemoWeekRosters } = await import(moduleUrl('js/demo-rosters.js'));
  const { priceTradeAcrossWeeks, slotsForLeague } = await import(moduleUrl('js/trade.js'));
  const { slotCountsFromLineups } = await import(moduleUrl('js/projection.js'));

  const base = generateDemoWeekRosters(week);
  const slots = slotsForLeague(slotCountsFromLineups(base.teams));

  const span = [];
  for (let w = week; w <= 13; w++) span.push(w);

  const byWeek = new Map();
  for (const w of span) {
    const idx = new Map();
    for (const t of generateDemoWeekRosters(w).teams) {
      for (const p of t.players) idx.set(p.playerId, p.projected);
    }
    byWeek.set(w, idx);
  }
  const projFor = (p, w) => {
    const idx = byWeek.get(w);
    const v = idx ? idx.get(p.playerId) : undefined;
    return typeof v === 'number' ? v : null;
  };

  const me = base.teams.find((t) => String(t.id) === String(teamId));
  if (!me) return null;
  const byId = new Map();
  for (const t of base.teams) for (const p of t.players) byId.set(p.playerId, p);

  // Every send and every receive TOGETHER, in one pricing — which is the only
  // honest way to price a set of trades, and the thing the page must be doing.
  const send = [];
  const receive = [];
  for (const t of perTrade) {
    for (const id of t.send) send.push(byId.get(id) || id);
    for (const id of t.receive) if (byId.get(id)) receive.push(byId.get(id));
  }
  return priceTradeAcrossWeeks({ players: me.players, send, receive, slots, weeks: span, projFor });
}

/** What the page would have claimed if it had added the offers' own gains up. */
const naiveOf = (items) =>
  items.reduce((a, s) => {
    const m = s.match(/on its own ([+−]?[\d.]+)/);
    return a + (m ? num(m[1]) : 0);
  }, 0);

// ---- the weekly measure, on demo data -------------------------------------
//
// Three asks land here: the 13-week card on every name, the per-week drill-down
// and the best-combo section. All three only exist once the weeks are priced,
// and the press that prices them is the first thing asserted.

const wk = run('weekly');
ok('the weekly scenario boots', !wk.boot, wk.boot);
if (!wk.boot) {
  ok('no console errors on the weekly path', wk.errors.length === 0,
    wk.errors.slice(0, 2).join(' | '));
  // The whole point of demo: the weekly measure can be shown off for nothing.
  ok('pricing every week on DEMO data still costs no network call',
    wk.fetchCalls.length === 0, wk.fetchCalls.slice(0, 2).join(' | '));

  // -- the cost is on screen BEFORE it is spent ----------------------------
  const spanLen = wk.before.weeks.filter((w) => Number(w) >= Number(wk.before.week) &&
    Number(w) <= 13).length;
  ok('the page opens on a week with a rest of season to price', spanLen > 1,
    `week ${wk.before.week} of ${wk.before.weeks.join(',')}`);
  ok('the button names the span before it is pressed',
    /Price weeks \d+–\d+/.test(wk.before.cost.button), wk.before.cost.button);
  ok('and the cost note names the real number of weeks',
    wk.before.cost.note.includes(`${spanLen} weeks`), wk.before.cost.note.slice(0, 220));
  ok('and says what it would cost on a real league — one request per week',
    /one per week/.test(wk.before.cost.note) &&
    new RegExp(`${spanLen - 1} requests`).test(wk.before.cost.note),
    wk.before.cost.note.slice(0, 260));
  ok('and says demo data itself costs nothing',
    /no requests at all/.test(wk.before.cost.note), wk.before.cost.note.slice(0, 200));
  ok('there is no combo before the weeks are priced, and it says why',
    /every remaining week/i.test(wk.before.combo.body), wk.before.combo.body.slice(0, 160));

  // -- pressing it switches the measure ------------------------------------
  eq(wk.after.measure, 'weeks', 'pressing the button selects the weekly measure');
  ok('the button then says the span is priced', /priced/.test(wk.after.cost.button),
    wk.after.cost.button);

  // -- THE SCALE IS STATED, which is the trap worth nine times the truth ----
  ok('the gain column says which weeks it is totalling',
    /You gain \(weeks \d+–\d+\)/.test(wk.after.heads.join(' | ')), wk.after.heads.join(' | '));
  ok('the note says these are rest-of-season totals, not weekly figures',
    /rest-of-season total/.test(wk.after.note), wk.after.note.slice(0, 400));
  ok('and every gain carries its per-week twin',
    wk.after.trades.length > 0 && wk.after.trades.every((t) => /\/wk/.test(t.gainText)),
    (wk.after.trades[0] || {}).gainText);
  ok('the depth map says it is still per week, unlike the panels below it',
    /per week/.test(wk.after.depthNote), wk.after.depthNote.slice(0, 400));

  // The two bases must actually produce different numbers, or one of them is
  // being ignored — the failure this whole scenario exists to catch.
  ok('the weekly basis moves the depth numbers',
    JSON.stringify(wk.before.depth.rows.map((r) => r.cells.map((c) => c.v))) !==
    JSON.stringify(wk.after.depth.rows.map((r) => r.cells.map((c) => c.v))));
  ok('and the gains are on a different scale entirely',
    wk.after.trades.length > 0 && wk.before.trades.length > 0 &&
    wk.after.trades[0].myGain > wk.before.trades[0].myGain * 2,
    `${wk.before.trades[0] && wk.before.trades[0].myGain} -> ${wk.after.trades[0] && wk.after.trades[0].myGain}`);

  // -- ask 6: the depth map and the drill-down cannot contradict each other -
  ok('the depth note explains that a surplus is not a gain',
    /surplus is not the same as a gain/i.test(wk.after.depthNote),
    wk.after.depthNote.slice(0, 500));
  ok('and says the two panels are the same projections',
    /cannot disagree/.test(wk.after.depthNote), wk.after.depthNote.slice(-300));

  // -- ask 1: a card on every name -----------------------------------------
  ok('every man in the finder carries a card',
    wk.after.trades.every((t) => t.cards === t.send.length + t.receive.length),
    JSON.stringify(wk.after.trades.map((t) => [t.cards, t.send.length + t.receive.length])));
  ok('your spare men are named under the depth map', wk.after.spares.length > 0,
    wk.after.spares.join(' | '));

  ok('hovering a player name opens the card', wk.card && wk.card.hidden === false,
    JSON.stringify(wk.card));
  if (wk.card) {
    ok('the card names the man it was opened on',
      wk.card.ident.length > 0 && wk.card.hovered.includes(wk.card.ident.split(' · ')[0]),
      `${wk.card.ident} vs ${wk.card.hovered}`);
    ok('and draws the whole run, one column per week priced',
      wk.card.weeks.length === spanLen, `${wk.card.weeks.length} columns for ${spanLen} weeks`);
    ok('and says whose numbers they are, and for which weeks',
      /projections for weeks \d+–\d+/i.test(wk.card.heading), wk.card.heading);
  }
  ok('a spare chip opens the same card', wk.spareCard && wk.spareCard.hidden === false,
    JSON.stringify(wk.spareCard));

  // -- ask 3: the drill-down -----------------------------------------------
  ok('clicking an offer opens the deal', wk.deal && !wk.deal.hidden, JSON.stringify(wk.deal).slice(0, 200));
  if (wk.deal && wk.deal.weeks) {
    eq(wk.deal.weeks.weeks.length, spanLen, 'one row per remaining week');
    ok('the columns are current, changed and the difference',
      /As you are now/.test(wk.deal.weeks.heads.join(' ')) &&
      /With the trade/.test(wk.deal.weeks.heads.join(' ')) &&
      /Difference/.test(wk.deal.weeks.heads.join(' ')),
      wk.deal.weeks.heads.join(' | '));

    // RE-DERIVED: the rows must add up to the total printed beside them, and
    // the total must be the gain the finder's own row claimed. Rounding is a
    // tenth a row and no more.
    const rows = wk.deal.weeks.weeks;
    const totalRow = wk.deal.weeks.totals[0];
    const sum = rows.reduce((a, r) => a + r.delta, 0);
    ok('the per-week differences sum to the stated total',
      Math.abs(sum - totalRow.delta) <= 0.05 * rows.length + 0.051,
      `rows sum to ${sum.toFixed(2)}, total says ${totalRow.delta}`);
    ok('and each row IS after minus before',
      rows.every((r) => Math.abs((r.after - r.before) - r.delta) <= 0.051),
      JSON.stringify(rows.slice(0, 3)));
    ok('and the total matches the gain the finder advertised',
      Math.abs(totalRow.delta - wk.after.trades[0].myGain) <= 0.2,
      `deal ${totalRow.delta} vs row ${wk.after.trades[0].myGain}`);
    ok('the per-week average is shown as well as the total',
      wk.deal.weeks.totals.length === 2 &&
      Math.abs(wk.deal.weeks.totals[1].delta - totalRow.delta / rows.length) <= 0.06,
      JSON.stringify(wk.deal.weeks.totals));
    ok('and the note says both lineups are picked week by week',
      /best legal lineup .{0,20}in that week/.test(wk.deal.note), wk.deal.note.slice(0, 300));
    ok('the deal names its players with cards too', wk.deal.cards >= 2, `${wk.deal.cards} cards`);
    ok('and says there is no ESPN league in demo rather than offering a dead link',
      /no ESPN league to open in demo/.test(wk.deal.body) && wk.deal.espn === '',
      wk.deal.body.slice(-200));
  }

  // -- ask 4: the combo ----------------------------------------------------
  const combo = wk.after.combo;
  ok('the combo section has an answer once the weeks are priced',
    /\d/.test(combo.head), combo.head);
  ok('it states the gain and the number of trades',
    /[+−]\d/.test(combo.head) && /trade/.test(combo.head), combo.head);
  ok('it says a player can only be traded once',
    /only be traded once/.test(combo.note), combo.note.slice(0, 200));
  ok('and warns against adding the offers up',
    /Never add the gains up/.test(combo.note), combo.note.slice(0, 300));
  ok('the naive sum is shown beside the real one',
    /Adding the offers’ own gains/.test(combo.body), combo.body.slice(0, 300));

  // DISJOINTNESS, re-derived from the names on screen rather than trusted.
  ok('no player appears in two trades of the combo',
    combo.names.length > 0 && new Set(combo.names).size === combo.names.length,
    combo.names.join(' | '));
  ok('and none appears twice in the "most trades" packing either',
    new Set(combo.altNames).size === combo.altNames.length, combo.altNames.join(' | '));

  if (combo.weeks) {
    const rows = combo.weeks.weeks;
    const totalRow = combo.weeks.totals[0];
    const sum = rows.reduce((a, r) => a + r.delta, 0);
    ok('the combo is priced week by week too, and those rows add up',
      Math.abs(sum - totalRow.delta) <= 0.05 * rows.length + 0.051,
      `rows sum to ${sum.toFixed(2)}, total says ${totalRow.delta}`);
  }

  // THE NUMBER ITSELF, RE-DERIVED. Everything above reads the page back to
  // itself; this rebuilds the same demo league from scratch, takes the packing
  // the page printed, applies every send and every receive TOGETHER, and prices
  // it with the engine. A combo whose headline was the sum of its trades — the
  // one mistake this section exists to avoid — fails here and nowhere else.
  const priced = await repriceCombo(wk.week, wk.myTeamId, combo.perTrade);
  const claimed = num(combo.head.split(' ')[0]);
  ok('the combo headline survives an independent re-pricing of the same move',
    priced && Math.abs(priced.delta - claimed) <= 0.15,
    `page says ${claimed}, a fresh priceTradeAcrossWeeks says ${priced && priced.delta}`);
  // The naive figure the page prints must BE the sum of the listed offers'
  // own gains — otherwise the warning beside it is decoration — and the real
  // answer must differ from it, which is the whole reason the warning exists.
  const naiveSum = naiveOf(combo.items);
  // The trailing full stop is not part of the number, and a regex that eats it
  // hands Number() a NaN that looks like a mismatch.
  const naiveShown = (combo.body.match(/own gains would have given ([+−]\d+(?:\.\d+)?)/) || [])[1];
  ok('the naive sum shown is exactly the offers’ own gains added up',
    naiveShown !== undefined && Math.abs(num(naiveShown) - naiveSum) <= 0.15,
    `shown ${naiveShown}, the rows add to ${naiveSum.toFixed(1)}`);
  ok('and the real answer is not that sum',
    combo.perTrade.length < 2 || Math.abs(priced.delta - naiveSum) > 0.15 ||
      /coincidence rather than a rule/.test(combo.body),
    `${priced && priced.delta} vs naive ${naiveSum.toFixed(1)}`);
}

// ---- a real league, stubbed: the cost, the ranking, and the ESPN link ------

const live = run('live', { stub: true });
ok('the live scenario boots', !live.boot, live.boot);
if (!live.boot) {
  ok('no console errors on live data', live.errors.length === 0,
    live.errors.slice(0, 2).join(' | '));
  eq(live.before.badge, 'Live', 'the stubbed league puts the page on live data');

  // -- THE COST, stated before it is spent and counted after ---------------
  eq(live.before.requests, 1, 'the page opens on ONE week of rosters, as it always has');
  const span = live.span; // weeks 4..13 inclusive
  ok('the cost note names the real number of requests still to spend',
    live.before.cost.note.includes(`${span - 1} requests`),
    live.before.cost.note.slice(0, 300));
  ok('and the button carries the same number on its face',
    live.before.cost.button.includes(`${span - 1} requests`), live.before.cost.button);
  ok('and the note says what the page costs in total on this measure',
    live.before.cost.note.includes(`${span} requests in total`),
    live.before.cost.note.slice(0, 400));
  ok('nothing was spent before the button was pressed', live.before.requests === 1,
    `${live.before.requests} requests`);

  eq(live.after.requests, span, 'pressing it spends exactly one request per week');
  ok('and it asked for each remaining week exactly once',
    new Set(live.after.asked).size === live.after.asked.length &&
    live.after.asked.length === span,
    live.after.asked.join(','));
  ok('the spent line then says how many went',
    live.after.cost.spent.includes(`${span - 1} requests spent`), live.after.cost.spent);

  // -- THE RANKING ACTUALLY CHANGES ----------------------------------------
  //
  // The fixture's point: Ana holds two quarterbacks who alternate 19 and 7, so
  // on one scalar per man she looks weak at QB and Bo's steady 17 is a +4
  // upgrade — while across the weeks she already starts a 19 every week and the
  // 17 is worth nothing. The scalar basis must offer that trade and the weekly
  // one must not.
  const gotQB = (list) => list.filter((t) => /Bo QB/.test(t.receive.join(' ')));
  ok('on a typical week the page offers the steady quarterback',
    gotQB(live.before.trades).length > 0,
    live.before.trades.map((t) => t.receive.join('+')).join(' | '));
  ok('and across the weeks it does NOT — three quarterbacks already cover it',
    gotQB(live.after.trades).length === 0,
    gotQB(live.after.trades).map((t) => t.receive.join('+')).join(' | '));
  ok('while the deal that survives both measures is still there',
    live.after.trades.some((t) => t.partner === 'Cy'),
    live.after.trades.map((t) => t.partner).join(','));

  // -- THE ESPN DEEP LINK ---------------------------------------------------
  ok('the offer drilled into is with Cy', live.offer && live.offer.partner === 'Cy',
    JSON.stringify(live.offer && live.offer.partner));
  if (live.offer) {
    const url = live.offer.espn;
    ok('every live offer carries an ESPN deep link',
      /^https:\/\/fantasy\.espn\.com\/football\/team\/trade\?/.test(url), url);

    const q = new URLSearchParams(url.split('?')[1] || '');
    eq(q.get('leagueId'), '476225250', 'the link names the league');
    eq(q.get('seasonId'), '2026', 'and the season');
    eq(q.get('teamId'), '3', 'teamId is the PARTNER — whose screen it opens');
    eq(q.get('fromTeamId'), '1', 'fromTeamId is you');
    eq(q.get('step'), '1', 'and it starts at step 1');

    const ids = (q.get('players') || '').split(',').filter(Boolean);
    ok('it pre-ticks at least one player', ids.length > 0, q.get('players'));
    // An id not on that roster is ignored by ESPN in silence, which is the
    // worst kind of wrong: a screen that opens with one man ticked and no
    // explanation. Re-derived from the fixture's own rosters.
    ok('and every id it names is on THAT manager’s roster',
      ids.every((id) => live.rosters[3].includes(Number(id))),
      `${ids.join(',')} vs ${live.rosters[3].join(',')}`);
    ok('and none of them is one of your own men',
      ids.every((id) => !live.rosters[1].includes(Number(id))),
      ids.join(','));
    ok('it names exactly the men you would receive',
      ids.length === live.offer.receive.length,
      `${ids.length} ids for ${live.offer.receive.length} incoming`);

  }
  // A button that pre-ticks half a trade and says nothing reads as broken on
  // the first click, so the words are part of the feature rather than a
  // courtesy.
  ok('the finder note explains that only HIS side is ticked',
    /HIS players ticked only/.test(live.after.note), live.after.note.slice(-500));
  ok('and that nothing is sent to ESPN from here',
    /Nothing is sent to ESPN/.test(live.after.note), live.after.note.slice(-500));

  if (live.deal && !live.deal.hidden) {
    ok('the deal panel offers the same deep link',
      /^https:\/\/fantasy\.espn\.com\/football\/team\/trade\?/.test(live.deal.espn),
      live.deal.espn);
    ok('and says in words that your own side is not ticked',
      /no parameter for your own side/.test(live.deal.body), live.deal.body.slice(-400));
    ok('the deal covers every remaining week',
      live.deal.weeks && live.deal.weeks.weeks.length === span,
      live.deal.weeks ? `${live.deal.weeks.weeks.length} rows` : 'no table');
    if (live.deal.weeks) {
      const rows = live.deal.weeks.weeks;
      const sum = rows.reduce((a, r) => a + r.delta, 0);
      ok('and its rows sum to its total',
        Math.abs(sum - live.deal.weeks.totals[0].delta) <= 0.05 * rows.length + 0.051,
        `${sum} vs ${live.deal.weeks.totals[0].delta}`);
    }
  }
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
