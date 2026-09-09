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

import { REPO } from './repo.mjs';

// ------------------------------------------------------------------ harness

async function boot(page = 'trade.html', search = '') {
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

  const store = new Map();
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

/** Let the deferred search finish: it hands off through rAF then a timeout. */
const settle = () => new Promise((r) => setTimeout(r, 400));

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
      myGain: Number(tds[5].getAttribute('data-v')),
      theirGain: Number(tds[6].getAttribute('data-v')),
      links: [...tr.querySelectorAll('a.pref')].map((a) => a.getAttribute('href')),
    };
  });
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

function run(name) {
  const res = spawnSync(process.execPath, [self, name], {
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

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
