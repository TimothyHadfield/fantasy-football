// The "Taken players" table on the Players page, end to end against the real
// waivers.html + js/waivers-page.js.
//
//   node taken-check.mjs
//
// Two scenarios, each in its own child process, because an ES module
// initialises once per process and waivers-page.js self-boots on import:
//
//   live  a three-squad stub league (taken-stub-season.mjs) where every answer
//         is known by construction -- who owns whom, what each Avg is, which
//         man is the QB3, and which man ESPN has no number for at all.
//   demo  the real demo rosters, so the path Tim actually lands on first is
//         covered too, with the ranks re-derived from the rendered numbers.
//
// EVERY rank assertion is re-derived here from the Avg column AS RENDERED, not
// from the stub's raw numbers and not from the page's own arithmetic. The page
// is being checked against an independent ordering of its own output, which is
// the only way a wrong sort or a wrong grouping shows up as a failure.
//
// Run it with `npm test` from tests/, or on its own with `node taken-check.mjs`.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';

// The per-position startable bars, copied rather than imported: if the page
// changes one, the "some of these numbers clear the bar" check below should
// still be measuring what it says it measures.
const BARS = { QB: 17, RB: 12, WR: 12, TE: 9, DST: 7, K: 9 };

const SCENARIOS = {
  live: {
    label: '(a) three stub squads: owners, ranks, and nothing coloured',
    stub: true,
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    after: async ({ document, window }) => {
      const season = await import('./taken-stub-season.mjs');
      const espn = await import('./wv-stub-espn.mjs');
      const click = (sel) =>
        document.querySelector(sel).dispatchEvent(new window.Event('click', { bubbles: true }));

      const out = {
        rosterBefore: season.calls.rosterWeeks.slice(),
        wireFetchesBefore: espn.calls.weeks.slice(),
      };

      // Widening has to re-rank: over weeks 4-6 Cade Dunlow is the QB3, over
      // weeks 4-9 he is the QB1. The note claims the span moves the rank, so
      // something had better prove it does.
      click('#spanFilter button[data-span="6"]');
      await new Promise((r) => setTimeout(r, 900));
      out.wide = takenSnapshot(document);
      out.rosterAfterWiden = season.calls.rosterWeeks.slice();

      click('#spanFilter button[data-span="3"]');
      await new Promise((r) => setTimeout(r, 300));

      // EACH TABLE HAS ITS OWN position filter now. Pressing the wire's must
      // leave this one alone — that independence is the whole point of the
      // change, and it is the kind of thing that silently regresses — and
      // pressing this one must not cost a request.
      click('#posFilter button[data-pos="QB"]');
      out.takenAfterWireFilter = takenSnapshot(document);
      out.wireAfterWireFilter = wireSnapshot(document);
      click('#posFilter button[data-pos="ALL"]');

      click('#takenPosFilter button[data-pos="QB"]');
      out.qb = takenSnapshot(document);
      out.wireAfterTakenFilter = wireSnapshot(document);
      click('#takenPosFilter button[data-pos="ALL"]');

      // FLEX. A filter across three positions rather than a seventh position,
      // so the things to watch are that it narrows to exactly RB/WR/TE, that
      // the ranks and the Pos keys come through it untouched, and that the two
      // tables still answer only their own button. Pressed on each table in
      // turn and left pressed on the first while the second is pressed, which
      // is the only way to see one filter fail to leave the other alone.
      const wireBefore = wireSnapshot(document);
      // Taken here rather than at the top of this hook: the span was widened and
      // narrowed again in between, which legitimately bought weeks 7-9, and the
      // claim being made is about what FLEX costs, not about what the span did.
      out.wireFetchesBeforeFlex = espn.calls.weeks.slice();
      out.rosterBeforeFlex = season.calls.rosterWeeks.slice();
      click('#takenPosFilter button[data-pos="FLEX"]');
      out.takenFlex = takenSnapshot(document);
      out.wireDuringTakenFlex = wireSnapshot(document);
      out.takenFlexCount = document
        .querySelector('#takenPosFilter button[data-pos="FLEX"] .seg-count').textContent.trim();
      out.takenFlexLabel = (document.querySelector('#takenStats .stat .k') || {}).textContent || '';
      out.takenFlexEmpty = document.querySelectorAll('#takenTable tbody tr.empty-row').length;

      click('#posFilter button[data-pos="FLEX"]');
      out.wireFlex = wireSnapshot(document);
      out.takenDuringWireFlex = takenSnapshot(document);
      out.wireFlexCount = document
        .querySelector('#posFilter button[data-pos="FLEX"] .seg-count').textContent.trim();
      out.wireFlexLabel = (document.querySelector('#waiverStats .stat .k') || {}).textContent || '';

      click('#takenPosFilter button[data-pos="ALL"]');
      out.wireStillFlex = wireSnapshot(document);
      click('#posFilter button[data-pos="ALL"]');
      out.wireBefore = wireBefore;
      out.wireAfterFlex = wireSnapshot(document);
      out.wireFetchesAfterFlex = espn.calls.weeks.slice();

      out.rosterAfterFilter = season.calls.rosterWeeks.slice();

      globalThis.__taken = out;
    },
  },
  demo: {
    label: '(b) the real demo squads',
    stub: false,
    prefs: { 'waivers.source': 'demo' },
  },

  // ---- landing on one man from a ?player= link elsewhere on the site -------
  //
  // Cade Dunlow (7103) is Ridgeway Rovers' third-best QB over the default three
  // weeks and their best over six, which makes him the right man to land on:
  // the jump widens the span to the whole season, so his rank on arrival must
  // be the WIDE one. The reader's own span preference is deliberately left at
  // the narrow default in prefs, so a reload gives it back.
  jump: {
    label: '(c) a ?player= link lands on one man',
    stub: true,
    prefs: { 'waivers.source': 'live', 'waivers.span': '3' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=7103',
    after: async ({ document, window }) => {
      const season = await import('./taken-stub-season.mjs');
      const out = {
        rows: takenSnapshot(document),
        wire: wireSnapshot(document),
        jump: document.getElementById('jumpNote').textContent.replace(/\s+/g, ' ').trim(),
        jumpCls: document.getElementById('jumpNote').getAttribute('class') || '',
        spot: [...document.querySelectorAll('#takenTable tbody tr.spotlight')]
          .map((tr) => tr.getAttribute('data-player')),
        spotAnywhere: [...document.querySelectorAll('tr.spotlight')].length,
        takenOn: [...document.querySelectorAll('#takenPosFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        wireOn: [...document.querySelectorAll('#posFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        spanOn: [...document.querySelectorAll('#spanFilter button.on')]
          .map((b) => b.getAttribute('data-span')),
        takenSpanOn: [...document.querySelectorAll('#takenSpanFilter button.on')]
          .map((b) => b.getAttribute('data-span')),
        weekCols: [...document.querySelectorAll('#takenTable thead th')].length,
        savedSpan: JSON.parse(localStorage.getItem('ff.prefs') || '{}')['waivers.span'],
        rosterWeeks: season.calls.rosterWeeks.slice().sort((a, b) => a - b),
      };

      // Clearing drops the mark and the strip, and deliberately leaves the span
      // and the filter where the jump put them — they are what is on screen now.
      document.querySelector('#jumpNote button[data-clear]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      out.afterClear = {
        jumpCls: document.getElementById('jumpNote').getAttribute('class') || '',
        spot: [...document.querySelectorAll('tr.spotlight')].length,
        takenOn: [...document.querySelectorAll('#takenPosFilter button.on')]
          .map((b) => b.getAttribute('data-pos')),
        spanOn: [...document.querySelectorAll('#spanFilter button.on')]
          .map((b) => b.getAttribute('data-span')),
      };
      globalThis.__jump = out;
    },
  },

  'jump-unknown': {
    label: '(d) a ?player= link for somebody nobody holds',
    stub: true,
    prefs: { 'waivers.source': 'live' },
    conn: { leagueId: '99', season: 2026, teamId: 1 },
    search: '?player=424242',
    after: async ({ document }) => {
      globalThis.__jump = {
        jump: document.getElementById('jumpNote').textContent.replace(/\s+/g, ' ').trim(),
        jumpCls: document.getElementById('jumpNote').getAttribute('class') || '',
        spot: [...document.querySelectorAll('tr.spotlight')].length,
        rows: takenSnapshot(document).length,
      };
    },
  },
};

// --------------------------------------------------------------- reading it

/**
 * The WIRE table's rows, so the two filters can be shown to be independent.
 * Deliberately excludes the "Your …" comparison rows: they are your own men,
 * not free agents, and they follow the wire's filter for their own reasons.
 */
function wireSnapshot(document) {
  return [...document.querySelectorAll('#waiverTable tbody tr')]
    .filter((tr) => {
      const cls = tr.getAttribute('class') || '';
      return !/\bempty-row\b/.test(cls) && !/\bmine\b/.test(cls);
    })
    .map((tr) => {
      const c = [...tr.children];
      return {
        player: tr.getAttribute('data-player'),
        name: c[0].textContent.replace(/\s+/g, ' ').trim(),
        pos: c[1].textContent.trim(),
      };
    });
}

/** Every row of the taken table, as plain data. */
function takenSnapshot(document) {
  return [...document.querySelectorAll('#takenTable tbody tr')]
    .filter((tr) => !/\bempty-row\b/.test(tr.getAttribute('class') || ''))
    .map((tr) => {
      const c = [...tr.children];
      return {
        id: tr.getAttribute('id'),
        player: tr.getAttribute('data-player'),
        cls: tr.getAttribute('class') || '',
        name: c[0].textContent.replace(/\s+/g, ' ').trim(),
        pos: c[1].textContent.trim(),
        posKey: c[1].getAttribute('data-v'),
        tm: c[2].textContent.trim(),
        owner: c[3].textContent.trim(),
        ownerKey: c[3].getAttribute('data-v'),
        avg: c[4].getAttribute('data-v'),
        avgText: c[4].textContent.trim(),
        week: c.slice(5).map((td) => ({
          v: td.getAttribute('data-v'),
          text: td.textContent.trim(),
          cls: td.getAttribute('class') || '',
        })),
      };
    });
}

/** "QB3" -> "QB"; "TE" -> "TE". The bare position, whatever the rank. */
const bareOf = (pos) => pos.replace(/\d+$/, '');
/** "QB3" -> 3; "TE" -> null. */
const rankOf = (pos) => {
  const m = pos.match(/(\d+)$/);
  return m ? Number(m[1]) : null;
};

/**
 * The rank every row SHOULD carry, worked out from the rendered Avg column.
 *
 * Independent of the page's own arithmetic on purpose: it groups by the owner
 * and the bare position as the page printed them, orders by the Avg as the page
 * printed it, and numbers from 1. A man with a blank Avg gets no rank, because
 * there is nothing to order him by.
 */
function ranksFromRendered(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.owner}|${bareOf(r.pos)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const want = new Map();
  for (const group of groups.values()) {
    group
      .filter((r) => r.avg !== null)
      .sort((a, b) => Number(b.avg) - Number(a.avg) || Number(a.player) - Number(b.player))
      .forEach((r, i) => want.set(r.player, i + 1));
    group.filter((r) => r.avg === null).forEach((r) => want.set(r.player, null));
  }
  return want;
}

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  const html = readFileSync(path.join(REPO, 'waivers.html'), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom returns undefined for a <select>'s value. Shimmed on the SELECT
  // prototype specifically: HTMLElement.prototype is shadowed here, and would
  // break <input> if it were not.
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

  // The table prototype has to come from an element linkedom actually made --
  // window.HTMLTableElement is not always the same object, and defining on the
  // wrong one leaves table.tBodies undefined at the moment a page reads it.
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

  // js/bridge.js reads window.location.origin on every ping, and linkedom gives
  // the window no location at all.
  // `search` is what a ?player= deep link arrives as, so a scenario can set it.
  const search = cfg.search || '';
  if (!window.location) {
    window.location = {
      href: `http://localhost/waivers.html${search}`, origin: 'http://localhost',
      protocol: 'http:', pathname: '/waivers.html', search, hash: '',
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

  // fetch is deliberately not made to work: any real network attempt is a
  // failure this suite reports rather than a request it silently serves.
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
const near = (a, b) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.005;

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);
  const note = txt($('takenNote'));
  const rows = takenSnapshot(d);

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  c.ok('no unexpected network calls', boot.fetchCalls.length === 0, boot.fetchCalls.slice(0, 2).join(' | '));

  // ---- (c)/(d) the ?player= deep link --------------------------------------
  //
  // These two land the page on one man, so the shared assertions below — which
  // all assume an unfiltered table — do not apply and the scenarios answer for
  // themselves.
  if (scenario === 'jump' || scenario === 'jump-unknown') {
    const w = globalThis.__jump || {};

    if (scenario === 'jump') {
      c.ok('the strip names the man the link pointed at',
        /Jumped to Cade Dunlow/.test(w.jump || ''), w.jump);
      c.ok('and says whose roster he is on',
        /Ridgeway Rovers/.test(w.jump || ''), w.jump);
      c.ok('the strip is shown', !/\bhidden\b/.test(w.jumpCls || ''), w.jumpCls);

      c.ok('HIS ROW IS MARKED, AND ONLY HIS',
        JSON.stringify(w.spot) === JSON.stringify(['7103']) && w.spotAnywhere === 1,
        `${JSON.stringify(w.spot)} / ${w.spotAnywhere} marked in the document`);

      c.ok('THE SPAN IS WIDENED TO THE WHOLE SEASON — "his next 13 weeks"',
        JSON.stringify(w.spanOn) === JSON.stringify(['all']), JSON.stringify(w.spanOn));
      c.ok('and both copies of the span control agree, because there is one span',
        JSON.stringify(w.takenSpanOn) === JSON.stringify(w.spanOn),
        `${JSON.stringify(w.spanOn)} vs ${JSON.stringify(w.takenSpanOn)}`);
      c.ok('BUT THE READER’S OWN SPAN PREFERENCE IS NOT OVERWRITTEN',
        w.savedSpan === '3', String(w.savedSpan));

      c.ok('the table he is in is put on HIS position',
        JSON.stringify(w.takenOn) === JSON.stringify(['QB']), JSON.stringify(w.takenOn));
      c.ok('and the OTHER table’s filter is left alone',
        JSON.stringify(w.wireOn) === JSON.stringify(['ALL']), JSON.stringify(w.wireOn));
      c.ok('so what is on screen is him among the men he is measured against',
        (w.rows || []).length > 1 && (w.rows || []).every((r) => bareOf(r.pos) === 'QB'),
        JSON.stringify((w.rows || []).map((r) => r.pos)));

      // He is his squad's QB3 over three weeks and their best over the run-in.
      // The jump widened the span, so the rank on arrival must be the WIDE one:
      // that is the difference between landing on the right answer and landing
      // on the one the reader happened to have set.
      const him = (w.rows || []).find((r) => r.player === '7103');
      c.ok('AND HIS RANK IS THE ONE FOR THE WIDENED SPAN, NOT THE OLD ONE',
        him && him.pos === 'QB1', him && him.pos);

      c.ok('clearing takes the mark and the strip away',
        w.afterClear && w.afterClear.spot === 0 && /\bhidden\b/.test(w.afterClear.jumpCls),
        JSON.stringify(w.afterClear));
      c.ok('but leaves the span and the filter where the jump put them',
        w.afterClear && JSON.stringify(w.afterClear.takenOn) === JSON.stringify(['QB']) &&
        JSON.stringify(w.afterClear.spanOn) === JSON.stringify(['all']),
        JSON.stringify(w.afterClear));

      c.ok('and no roster week was bought twice getting there',
        new Set(w.rosterWeeks || []).size === (w.rosterWeeks || []).length,
        JSON.stringify(w.rosterWeeks));
    }

    if (scenario === 'jump-unknown') {
      c.ok('an id nobody holds says so rather than failing silently',
        /No player with id 424242/.test(w.jump || ''), w.jump);
      c.ok('and offers a reason it might happen',
        /dropped|another league/.test(w.jump || ''), w.jump);
      c.ok('nothing is marked', w.spot === 0, String(w.spot));
      c.ok('and the table is left showing everybody rather than nobody',
        w.rows > 0, String(w.rows));
    }

    return c.out;
  }

  // ---- the shape ------------------------------------------------------------
  const head = [...d.querySelectorAll('#takenTable thead th')].map((th) => txt(th));
  c.ok('the identity columns are Player, Pos, Tm, Owner and Avg',
    JSON.stringify(head.slice(0, 5)) === JSON.stringify(['Player', 'Pos', 'Tm', 'Owner', 'Avg']),
    JSON.stringify(head));
  c.ok('nothing but weeks after them',
    head.length > 5 && head.slice(5).every((h) => /^\d+$/.test(h)), JSON.stringify(head));
  c.ok('the same weeks as the available table',
    JSON.stringify(head.slice(5)) ===
      JSON.stringify([...d.querySelectorAll('#waiverTable thead th')].map((th) => txt(th)).slice(4)),
    JSON.stringify(head));
  c.ok('every header is sortable',
    [...d.querySelectorAll('#takenTable thead th')].every((th) => th.hasAttribute('data-sort')),
    'a header has no data-sort');
  c.ok('the table has rows at all', rows.length > 0, `${rows.length}`);

  // ---- the two tables hold disjoint men -------------------------------------
  const wireRows = [...d.querySelectorAll('#waiverTable tbody tr')]
    .filter((tr) => !/\b(mine|empty-row)\b/.test(tr.getAttribute('class') || ''));
  const takenIds = new Set(rows.map((r) => r.player));
  const wireIds = wireRows.map((tr) => tr.getAttribute('data-player'));
  c.ok('the wire still has its free agents', wireRows.length > 0, `${wireRows.length}`);
  c.ok('not one free agent appears in the taken table',
    wireIds.every((id) => !takenIds.has(id)),
    wireIds.filter((id) => takenIds.has(id)).slice(0, 4).join(','));
  c.ok('and every taken row is a distinct player',
    takenIds.size === rows.length, `${takenIds.size} ids for ${rows.length} rows`);

  // ---- groundwork for the click-through, which is deliberately NOT built ----
  c.ok('every taken row is addressable by player id',
    rows.every((r) => r.id === `p${r.player}` && r.player), JSON.stringify(rows[0]));
  c.ok('so is every wire row',
    wireRows.every((tr) => tr.getAttribute('id') === `p${tr.getAttribute('data-player')}`),
    wireRows.slice(0, 2).map((tr) => tr.getAttribute('id')).join(','));
  const mineRows = [...d.querySelectorAll('#waiverTable tbody tr.mine')];
  c.ok('a comparison row carries the player id but not the element id — it is his second appearance',
    mineRows.every((tr) => tr.getAttribute('data-player') && !tr.hasAttribute('id')),
    mineRows.map((tr) => tr.getAttribute('id')).join(','));
  const allIds = [...d.querySelectorAll('tr[id]')].map((tr) => tr.getAttribute('id'));
  c.ok('no element id is used twice in the document',
    new Set(allIds).size === allIds.length, `${allIds.length} ids, ${new Set(allIds).size} distinct`);
  // The click-through IS built now — this block used to assert the opposite,
  // deliberately, and this is the considered replacement rather than a deletion.
  const takenLinks = [...d.querySelectorAll('#takenTable tbody a.pref')];
  c.ok('every taken row’s name is a link to that player',
    takenLinks.length === rows.length, `${takenLinks.length} links, ${rows.length} rows`);
  c.ok('the link is a real href carrying ESPN’s own id, not a click handler',
    takenLinks.every((a) => /^waivers\.html\?player=\d+$/.test(a.getAttribute('href') || '')),
    takenLinks[0] && takenLinks[0].getAttribute('href'));
  c.ok('and the id in the href is the row’s own player',
    takenLinks.every((a) => {
      const tr = a.closest('tr');
      return a.getAttribute('href') === `waivers.html?player=${tr.getAttribute('data-player')}`;
    }), takenLinks[0] && takenLinks[0].getAttribute('href'));
  c.ok('the wire’s names are links too, by the same contract',
    wireRows.every((tr) => {
      const a = tr.querySelector('td.name a.pref');
      return a && a.getAttribute('href') === `waivers.html?player=${tr.getAttribute('data-player')}`;
    }), 'a wire row has no link, or the wrong one');
  c.ok('linking did not change what a name cell reads',
    rows.every((r) => r.name && !/</.test(r.name)), JSON.stringify(rows[0] && rows[0].name));

  // ---- the rank, re-derived from the rendered Avg ---------------------------
  const want = ranksFromRendered(rows);
  const wrongRank = rows.filter((r) => rankOf(r.pos) !== want.get(r.player));
  c.ok('every rank matches the one re-derived from the rendered Avg column',
    wrongRank.length === 0,
    wrongRank.slice(0, 4).map((r) => `${r.name} ${r.owner} got ${r.pos} want ${want.get(r.player)}`).join(' | '));
  c.ok('and some position group actually has a third man, so that is not vacuous',
    rows.some((r) => rankOf(r.pos) >= 3), JSON.stringify(rows.map((r) => r.pos).slice(0, 8)));
  c.ok('every rank counts from 1 within its owner and position',
    [...new Set(rows.map((r) => `${r.owner}|${bareOf(r.pos)}`))].every((key) => {
      const group = rows.filter((r) => `${r.owner}|${bareOf(r.pos)}` === key && rankOf(r.pos) !== null);
      const ranks = group.map((r) => rankOf(r.pos)).sort((a, b) => a - b);
      return ranks.every((v, i) => v === i + 1);
    }), 'a rank sequence has a hole or starts above 1');

  // ---- the sort keys --------------------------------------------------------
  const POS_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DST: 6 };
  c.ok('the Pos key encodes the football order and the rank together',
    rows.every((r) => Number(r.posKey) ===
      (POS_ORDER[bareOf(r.pos)] ?? 9) * 100 + (rankOf(r.pos) ?? 99)),
    rows.slice(0, 4).map((r) => `${r.pos}=${r.posKey}`).join(','));
  const keyFor = (pos) => {
    const r = rows.find((x) => bareOf(x.pos) === pos);
    return r ? Number(r.posKey) : null;
  };
  c.ok('so the Pos column sorts QB before DST',
    keyFor('QB') !== null && keyFor('DST') !== null && keyFor('QB') < keyFor('DST'),
    `QB ${keyFor('QB')} vs DST ${keyFor('DST')}`);
  const firstQb = rows.filter((r) => r.pos === 'QB1').map((r) => Number(r.posKey));
  const secondQb = rows.filter((r) => r.pos === 'QB2').map((r) => Number(r.posKey));
  c.ok('and rank 1 before rank 2 inside a position',
    firstQb.length > 0 && secondQb.length > 0 && Math.max(...firstQb) < Math.min(...secondQb),
    `${JSON.stringify(firstQb)} vs ${JSON.stringify(secondQb)}`);
  c.ok('the Owner column sorts alphabetically on the name shown',
    rows.every((r) => r.ownerKey === r.owner.toLowerCase()),
    rows.slice(0, 3).map((r) => `${r.owner}/${r.ownerKey}`).join(','));
  c.ok('a blank Avg carries no sort key at all — never data-v=""',
    rows.every((r) => (r.avgText === '—') === (r.avg === null)),
    rows.filter((r) => (r.avgText === '—') !== (r.avg === null)).slice(0, 3)
      .map((r) => `${r.name} ${r.avgText}/${r.avg}`).join(','));

  // ---- no colour, anywhere --------------------------------------------------
  const cells = [...d.querySelectorAll('#takenTable tbody td')];
  c.ok('not one cell in the taken table is green text',
    cells.every((td) => !/\bhot\b/.test(td.getAttribute('class') || '')),
    cells.filter((td) => /\bhot\b/.test(td.getAttribute('class') || '')).length + ' hot');
  c.ok('nor is one shaded',
    cells.every((td) => !/\bbeats\b/.test(td.getAttribute('class') || '')),
    cells.filter((td) => /\bbeats\b/.test(td.getAttribute('class') || '')).length + ' shaded');
  const overBar = rows.reduce((n, r) => n + r.week.filter((td) =>
    td.v !== null && typeof BARS[bareOf(r.pos)] === 'number' &&
    Number(td.v) > BARS[bareOf(r.pos)]).length, 0);
  c.ok('and plenty of those numbers clear the startable bar, so that is not vacuous',
    overBar > 0, `${overBar} over the bar`);
  c.ok('the wire above is still coloured, so the difference is the table and not the data',
    [...d.querySelectorAll('#waiverTable tbody td.hot')].length > 0, 'no green on the wire either');

  // ---- a bye is not a blank -------------------------------------------------
  const byeCells = rows.flatMap((r) => r.week).filter((td) => /\bbye\b/.test(td.cls));
  c.ok('a bye renders as Bye carrying the zero ESPN returned',
    byeCells.length > 0 && byeCells.every((td) => td.text === 'Bye' && td.v === '0'),
    JSON.stringify(byeCells.slice(0, 2)));

  // ---- the note -------------------------------------------------------------
  c.ok('the note says what Avg is and that it is ours',
    /Avg is the mean of the weeks shown and is ours, not ESPN’s/.test(note), note);
  c.ok('the note says byes are counted and blank weeks left out',
    /byes are counted as the zero ESPN returns, and weeks with no number at all are left out/.test(note),
    note);
  c.ok('the note says what the rank means',
    /where he ranks on his own manager’s roster/.test(note) &&
    /QB3 is that manager’s third-best quarterback/.test(note), note);
  c.ok('the note says the rank moves with the span',
    /it moves with the span/.test(note) && /a QB2 can become a QB3/.test(note), note);
  c.ok('the note says the rank is ours and not ESPN’s depth chart',
    /our ordering rather than ESPN’s depth chart/.test(note), note);
  c.ok('the note says an unratable man gets no rank',
    /cannot be ranked at all/.test(note) && /bare position/.test(note), note);
  c.ok('the note says nothing is highlighted',
    /Nothing here is highlighted, on purpose/.test(note), note);
  c.ok('and says why — nobody here can be claimed',
    /nobody on this list can be claimed/.test(note), note);
  c.ok('the note distinguishes a Bye cell from a blank one',
    /Bye is the 0\.00 ESPN returns/.test(note) && /blank cell means/.test(note) &&
    /not the same thing/.test(note), note);
  c.ok('the note says the table covers any week shown, not just the first',
    /on a roster in .{0,20}any.{0,20} of weeks/.test(note.replace(/\s+/g, ' ')), note);
  c.ok('and which week decides who owns whom',
    /Owner is the manager holding him in the earliest of those weeks he actually appears in/
      .test(note.replace(/\s+/g, ' ')), note);
  c.ok('and that a week he was not rostered for is blank rather than guessed',
    /not rostered for is blank rather than guessed at/.test(note.replace(/\s+/g, ' ')), note);
  // This used to assert the opposite — that the counts were the WIRE's, because
  // the two tables shared one control. They do not any more, and the note has to
  // say whose numbers these are or the buttons are quietly claiming the wrong
  // pool. Deliberate replacement, not a deletion.
  c.ok('the note says this table has its own position buttons',
    /its own position buttons/.test(note), note);
  c.ok('and that their counts are this table’s',
    /counts on them are this table’s/.test(note), note);
  c.ok('and that they move nothing but this table',
    /move nothing but this table/.test(note), note);
  c.ok('the note says what FLEX is, in English rather than as a token',
    /FLEX here is the same filter as on the wire above/.test(note) &&
    /every running back, receiver and tight end the league is holding/.test(note), note);
  c.ok('and that FLEX leaves the rank beside a name alone',
    /leaves the rank beside a name completely alone/.test(note) &&
    /there is no such thing as a FLEX2/.test(note), note);
  c.ok('the note says the span is shared, and why',
    /the same one as at the top of the page/.test(note) &&
    /priced\s+over the same weeks/.test(note.replace(/\s+/g, ' ')), note);
  c.ok('the note says the names are links and what following one does',
    /Every name here is a link/.test(note) && /marks his row/.test(note), note);

  // The counts on the buttons must actually BE this table's, not just claimed.
  const takenCounts = [...d.querySelectorAll('#takenPosFilter button[data-pos]')]
    .map((b) => [b.getAttribute('data-pos'), (b.querySelector('.seg-count') || {}).textContent]);
  const byPos = {};
  for (const r of rows) byPos[bareOf(r.pos)] = (byPos[bareOf(r.pos)] || 0) + 1;
  // FLEX is not a position, so its count is the three flex-eligible ones added
  // together — re-derived here from the rendered Pos column rather than from the
  // page's own arithmetic, which is the only version of this check worth having.
  const wantFlex = ['RB', 'WR', 'TE'].reduce((n, p) => n + (byPos[p] || 0), 0);
  c.ok('and the counts match the rows this table actually holds',
    takenCounts.every(([pos, n]) =>
      pos === 'ALL' ? Number(n) === rows.length
        : pos === 'FLEX' ? Number(n) === wantFlex
          : Number(n) === (byPos[pos] || 0)),
    JSON.stringify(takenCounts) + ' vs ' + JSON.stringify(byPos));
  c.ok('THE FLEX COUNT IS RB + WR + TE IN THIS TABLE’S OWN POOL',
    Number((takenCounts.find(([p]) => p === 'FLEX') || [])[1]) === wantFlex,
    `${JSON.stringify(takenCounts.find(([p]) => p === 'FLEX'))} vs ${wantFlex} from ${JSON.stringify(byPos)}`);
  c.ok('and that is neither nobody nor everybody, so the check is not vacuous',
    wantFlex > 0 && wantFlex < rows.length, `${wantFlex} of ${rows.length}`);

  // ---- the FLEX button itself, on BOTH controls -----------------------------
  for (const id of ['posFilter', 'takenPosFilter']) {
    const btns = [...d.querySelectorAll(`#${id} button[data-pos]`)]
      .map((b) => b.getAttribute('data-pos'));
    c.ok(`#${id} carries a FLEX button`, btns.includes('FLEX'), btns.join(','));
    c.ok(`and it sits where a flex sits in a lineup — after TE, before K (#${id})`,
      btns.indexOf('FLEX') === btns.indexOf('TE') + 1 &&
      btns.indexOf('K') === btns.indexOf('FLEX') + 1, btns.join(','));
  }
  c.ok('FLEX is not smuggled into the Pos column as a position',
    rows.every((r) => bareOf(r.pos) !== 'FLEX'),
    rows.filter((r) => /FLEX/.test(r.pos)).map((r) => `${r.name} ${r.pos}`).join(','));

  // ---- the stat strip -------------------------------------------------------
  const stats = [...$('takenStats').querySelectorAll('.stat')].map((s) => txt(s));
  c.ok('the strip counts what is on screen', stats.some((s) => /^Taken/.test(s)), stats.join(' | '));
  c.ok('the strip states the weeks shown', stats.some((s) => /^Weeks shown/.test(s)), stats.join(' | '));
  c.ok('the strip names the best average and who owns him',
    stats.some((s) => /^Best average/.test(s)), stats.join(' | '));

  // ---- (a) the stub league, where every answer is known --------------------
  if (scenario === 'live') {
    const season = await import('./taken-stub-season.mjs');
    const w = globalThis.__taken || {};
    const byName = new Map(rows.map((r) => [r.name.replace(/\s+(OUT|IR|Q|D|SUSP|DTD)$/, ''), r]));

    c.ok('every rostered player appears, and no more',
      rows.length === season.ALL.length, `${rows.length} of ${season.ALL.length}`);
    c.ok('each one exactly once',
      season.ALL.every((p) => rows.filter((r) => r.player === String(p.playerId)).length === 1),
      season.ALL.filter((p) => rows.filter((r) => r.player === String(p.playerId)).length !== 1)
        .map((p) => p.name).join(','));

    const wrongOwner = season.ALL.filter((p) => {
      const row = rows.find((r) => r.player === String(p.playerId));
      return !row || row.owner !== p.owner;
    });
    c.ok('the Owner column names the manager who actually holds him',
      wrongOwner.length === 0,
      wrongOwner.slice(0, 4).map((p) => `${p.name} want ${p.owner}`).join(' | '));
    c.ok('all three squads are represented',
      new Set(rows.map((r) => r.owner)).size === 3,
      [...new Set(rows.map((r) => r.owner))].join(','));

    const wrongAvg = season.ALL.filter((p) => {
      const row = rows.find((r) => r.player === String(p.playerId));
      const expect = season.expectedAvg(p.playerId, [4, 5, 6]);
      return expect === null ? row.avg !== null : !near(row.avg, expect);
    });
    c.ok('the Avg is the mean over the weeks shown, byes counted, blanks left out',
      wrongAvg.length === 0,
      wrongAvg.slice(0, 3).map((p) =>
        `${p.name} got ${(rows.find((r) => r.player === String(p.playerId)) || {}).avg} ` +
        `want ${season.expectedAvg(p.playerId, [4, 5, 6])}`).join(' | '));

    // The QB3-shaped case, spelled out.
    c.ok('the best quarterback on a squad is his manager’s QB1',
      byName.get('Alden Ross') && byName.get('Alden Ross').pos === 'QB1',
      byName.get('Alden Ross') && byName.get('Alden Ross').pos);
    c.ok('the second is QB2',
      byName.get('Brix Calder') && byName.get('Brix Calder').pos === 'QB2',
      byName.get('Brix Calder') && byName.get('Brix Calder').pos);
    c.ok('and the third is QB3',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').pos === 'QB3',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').pos);
    c.ok('the rank is per manager, so another squad has its own QB1 too',
      rows.filter((r) => r.pos === 'QB1').length === 3,
      rows.filter((r) => r.pos === 'QB1').map((r) => `${r.name}/${r.owner}`).join(','));
    c.ok('the QB3’s sort key is 103 — the position, then the rank',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').posKey === '103',
      byName.get('Cade Dunlow') && byName.get('Cade Dunlow').posKey);

    // The man ESPN has no number for.
    const lund = byName.get('Kip Lund');
    c.ok('a player ESPN has no number for shows the bare position',
      lund && lund.pos === 'TE', lund && lund.pos);
    c.ok('and no rank against it', lund && rankOf(lund.pos) === null, lund && lund.pos);
    c.ok('and a blank Avg with no sort key',
      lund && lund.avgText === '—' && lund.avg === null, lund && `${lund.avgText}/${lund.avg}`);
    c.ok('and every one of his weeks is blank, not a zero',
      lund && lund.week.every((td) => td.text === '—' && td.v === null),
      lund && JSON.stringify(lund.week));
    c.ok('he sorts to the end of his own position rather than to the top of the table',
      lund && Number(lund.posKey) === 499, lund && lund.posKey);
    c.ok('the only rated tight end on that squad is still the TE1',
      byName.get('Merrick Nolan') && byName.get('Merrick Nolan').pos === 'TE1',
      byName.get('Merrick Nolan') && byName.get('Merrick Nolan').pos);

    // A bye is the zero ESPN returned, and the average counts it.
    const jessop = byName.get('Ivor Jessop');
    c.ok('a bye on a rostered man renders as Bye',
      jessop && jessop.week[1].text === 'Bye' && jessop.week[1].v === '0',
      jessop && JSON.stringify(jessop.week));
    c.ok('and drags his average down, because the week counts',
      jessop && near(jessop.avg, 4), jessop && jessop.avg);
    c.ok('which is what makes him the WR2 and not the WR1',
      jessop && jessop.pos === 'WR2' && byName.get('Hale Innis').pos === 'WR1',
      jessop && jessop.pos);

    // The cost of all this, said out loud.
    c.ok('every shown week cost a wire request and a roster request',
      JSON.stringify(w.rosterBefore.slice().sort((a, b) => a - b)) === JSON.stringify([4, 5, 6]),
      JSON.stringify(w.rosterBefore));
    c.ok('the cost line says six requests for three weeks',
      /3 weeks = 6 requests to ESPN/.test(txt($('spanCost'))), txt($('spanCost')));
    c.ok('and says what the second request is for',
      /the wire and every squad in the league for each one/.test(txt($('spanCost'))), txt($('spanCost')));
    c.ok('and still says there is no bulk form',
      /there is no bulk form/.test(txt($('spanCost'))), txt($('spanCost')));

    // Widening re-ranks, exactly as the note promises.
    const wideByName = new Map((w.wide || []).map((r) => [r.name, r]));
    c.ok('widening the span re-ranks the quarterbacks',
      wideByName.get('Cade Dunlow') && wideByName.get('Cade Dunlow').pos === 'QB1',
      wideByName.get('Cade Dunlow') && wideByName.get('Cade Dunlow').pos);
    c.ok('and pushes the man who was QB1 down to QB2',
      wideByName.get('Alden Ross') && wideByName.get('Alden Ross').pos === 'QB2',
      wideByName.get('Alden Ross') && wideByName.get('Alden Ross').pos);
    c.ok('and the man who was QB2 down to QB3',
      wideByName.get('Brix Calder') && wideByName.get('Brix Calder').pos === 'QB3',
      wideByName.get('Brix Calder') && wideByName.get('Brix Calder').pos);
    c.ok('the wider Avg is the mean over all six weeks',
      wideByName.get('Cade Dunlow') && near(wideByName.get('Cade Dunlow').avg, 25),
      wideByName.get('Cade Dunlow') && wideByName.get('Cade Dunlow').avg);
    c.ok('widening bought only the roster weeks it did not hold',
      JSON.stringify((w.rosterAfterWiden || []).slice().sort((a, b) => a - b)) ===
        JSON.stringify([4, 5, 6, 7, 8, 9]), JSON.stringify(w.rosterAfterWiden));
    c.ok('and no roster week was ever bought twice',
      new Set(w.rosterAfterWiden || []).size === (w.rosterAfterWiden || []).length,
      JSON.stringify(w.rosterAfterWiden));

    // Each table's own filter narrows that table and nothing else. Costs
    // nothing either way: every week already fetched stays fetched.
    c.ok('the taken table’s own position filter narrows the taken table',
      (w.qb || []).length === 6 && (w.qb || []).every((r) => bareOf(r.pos) === 'QB'),
      `${(w.qb || []).length}: ${(w.qb || []).map((r) => r.pos).join(',')}`);
    c.ok('THE WIRE’S FILTER LEAVES THE TAKEN TABLE ALONE',
      (w.takenAfterWireFilter || []).length === season.ALL.length,
      `${(w.takenAfterWireFilter || []).length} of ${season.ALL.length} taken rows survived`);
    c.ok('and it really did narrow the wire, so that is not a vacuous check',
      (w.wireAfterWireFilter || []).length > 0 &&
      (w.wireAfterWireFilter || []).every((r) => r.pos === 'QB'),
      JSON.stringify((w.wireAfterWireFilter || []).map((r) => r.pos)));
    c.ok('AND THE TAKEN FILTER LEAVES THE WIRE ALONE',
      (w.wireAfterTakenFilter || []).length > (w.wireAfterWireFilter || []).length &&
      (w.wireAfterTakenFilter || []).some((r) => r.pos !== 'QB'),
      `${(w.wireAfterTakenFilter || []).length} wire rows`);
    c.ok('filtering and narrowing again fetch nothing',
      JSON.stringify(w.rosterAfterFilter) === JSON.stringify(w.rosterAfterWiden),
      `${JSON.stringify(w.rosterAfterWiden)} -> ${JSON.stringify(w.rosterAfterFilter)}`);
    c.ok('clearing the filter brings every man back',
      rows.length === season.ALL.length, `${rows.length}`);

    // ---- FLEX ---------------------------------------------------------------
    //
    // A filter across RB, WR and TE. Everything below is checked against the
    // UNFILTERED table as rendered a moment earlier, so the page is being
    // measured against its own output rather than against the stub's numbers.
    const flexOf = (list) => list.filter((r) => ['RB', 'WR', 'TE'].includes(bareOf(r.pos)));
    const wantTakenFlex = flexOf(rows);

    c.ok('FLEX on the taken table shows exactly the RB, WR and TE rows',
      (w.takenFlex || []).length === wantTakenFlex.length &&
      JSON.stringify((w.takenFlex || []).map((r) => r.player).sort()) ===
        JSON.stringify(wantTakenFlex.map((r) => r.player).sort()),
      `${(w.takenFlex || []).length} shown, ${wantTakenFlex.length} eligible`);
    c.ok('and nothing else — no quarterback, kicker or defense survives it',
      (w.takenFlex || []).every((r) => ['RB', 'WR', 'TE'].includes(bareOf(r.pos))),
      [...new Set((w.takenFlex || []).map((r) => bareOf(r.pos)))].join(','));
    c.ok('it really did narrow the table, so that is not a vacuous check',
      (w.takenFlex || []).length > 0 && (w.takenFlex || []).length < rows.length,
      `${(w.takenFlex || []).length} of ${rows.length}`);
    c.ok('and it is wider than any one position, which is the point of it',
      new Set((w.takenFlex || []).map((r) => bareOf(r.pos))).size === 3,
      [...new Set((w.takenFlex || []).map((r) => bareOf(r.pos)))].join(','));
    c.ok('nobody is shown twice for being eligible three ways',
      new Set((w.takenFlex || []).map((r) => r.player)).size === (w.takenFlex || []).length,
      `${(w.takenFlex || []).length} rows`);

    // THE ASSERTION THIS WHOLE BLOCK EXISTS FOR. A rank is a fact about a man's
    // depth at HIS OWN position; a filter is a fact about what you are looking
    // at. If FLEX ever leaks into the first, every rank in the table becomes a
    // different and wrong number, and it would look perfectly plausible.
    const before = new Map(rows.map((r) => [r.player, r]));
    const movedRank = (w.takenFlex || []).filter((r) => {
      const was = before.get(r.player);
      return !was || was.pos !== r.pos || was.posKey !== r.posKey;
    });
    c.ok('EVERY RANK STILL READS BY HIS REAL POSITION UNDER FLEX',
      movedRank.length === 0,
      movedRank.slice(0, 4).map((r) =>
        `${r.name} ${r.pos}/${r.posKey} was ${(before.get(r.player) || {}).pos}`).join(' | '));
    c.ok('and no row reads FLEX in the Pos column',
      (w.takenFlex || []).every((r) => !/FLEX/i.test(r.pos)),
      (w.takenFlex || []).map((r) => r.pos).join(','));
    const flexByName = new Map((w.takenFlex || []).map((r) => [r.name, r]));
    c.ok('the man whose bye made him a WR2 is still a WR2, not a FLEX-anything',
      flexByName.get('Ivor Jessop') && flexByName.get('Ivor Jessop').pos === 'WR2',
      flexByName.get('Ivor Jessop') && flexByName.get('Ivor Jessop').pos);
    c.ok('the only rated tight end on that squad is still the TE1',
      flexByName.get('Merrick Nolan') && flexByName.get('Merrick Nolan').pos === 'TE1',
      flexByName.get('Merrick Nolan') && flexByName.get('Merrick Nolan').pos);
    c.ok('and the unrankable tight end still shows the bare position and keys 499',
      flexByName.get('Kip Lund') && flexByName.get('Kip Lund').pos === 'TE' &&
      flexByName.get('Kip Lund').posKey === '499',
      flexByName.get('Kip Lund') && `${flexByName.get('Kip Lund').pos}/${flexByName.get('Kip Lund').posKey}`);

    c.ok('the count on the FLEX button is what it shows',
      Number(w.takenFlexCount) === wantTakenFlex.length,
      `${w.takenFlexCount} vs ${wantTakenFlex.length}`);
    c.ok('the stat strip names the three positions rather than quoting the button',
      /^Taken RB\/WR\/TE$/.test((w.takenFlexLabel || '').trim()), w.takenFlexLabel);
    c.ok('and there is no empty state, because FLEX matched people',
      w.takenFlexEmpty === 0, String(w.takenFlexEmpty));

    // Independence, which is new for FLEX and is exactly the kind of thing that
    // regresses quietly: each table answers its own button, and holding one on
    // FLEX while the other is pressed must change nothing on the first.
    c.ok('FLEX ON THE TAKEN TABLE LEAVES THE WIRE ALONE',
      (w.wireDuringTakenFlex || []).length === (w.wireBefore || []).length &&
      (w.wireDuringTakenFlex || []).some((r) => !['RB', 'WR', 'TE'].includes(r.pos)),
      `${(w.wireDuringTakenFlex || []).length} of ${(w.wireBefore || []).length} wire rows`);
    c.ok('FLEX on the wire shows exactly its own RB, WR and TE',
      (w.wireFlex || []).length === flexOf(w.wireBefore || []).length &&
      (w.wireFlex || []).every((r) => ['RB', 'WR', 'TE'].includes(r.pos)),
      `${(w.wireFlex || []).length} of ${(w.wireBefore || []).length}`);
    c.ok('with its own count, which is the wire’s pool and not the taken one',
      Number(w.wireFlexCount) === flexOf(w.wireBefore || []).length &&
      Number(w.wireFlexCount) !== wantTakenFlex.length,
      `${w.wireFlexCount} vs wire ${flexOf(w.wireBefore || []).length} / taken ${wantTakenFlex.length}`);
    c.ok('and its own strip label',
      /^Available RB\/WR\/TE$/.test((w.wireFlexLabel || '').trim()), w.wireFlexLabel);
    c.ok('AND FLEX ON THE WIRE LEAVES THE TAKEN TABLE WHERE IT WAS',
      JSON.stringify((w.takenDuringWireFlex || []).map((r) => r.player)) ===
        JSON.stringify((w.takenFlex || []).map((r) => r.player)),
      `${(w.takenDuringWireFlex || []).length} vs ${(w.takenFlex || []).length}`);
    c.ok('and clearing the taken filter does not clear the wire’s',
      (w.wireStillFlex || []).length === (w.wireFlex || []).length,
      `${(w.wireStillFlex || []).length} vs ${(w.wireFlex || []).length}`);
    c.ok('clearing both brings every wire row back',
      (w.wireAfterFlex || []).length === (w.wireBefore || []).length,
      `${(w.wireAfterFlex || []).length} of ${(w.wireBefore || []).length}`);
    c.ok('SELECTING FLEX COSTS NO REQUEST — it is a repaint, on either table',
      JSON.stringify(w.wireFetchesAfterFlex) === JSON.stringify(w.wireFetchesBeforeFlex) &&
      JSON.stringify(w.rosterAfterFilter) === JSON.stringify(w.rosterBeforeFlex),
      `wire ${JSON.stringify(w.wireFetchesBeforeFlex)} -> ${JSON.stringify(w.wireFetchesAfterFlex)}, ` +
      `rosters ${JSON.stringify(w.rosterBeforeFlex)} -> ${JSON.stringify(w.rosterAfterFilter)}`);
  }

  // ---- (b) the real demo squads --------------------------------------------
  if (scenario === 'demo') {
    const { generateDemoWeekRosters } = await import(
      pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href
    );
    // MEMBERSHIP IS THE UNION OVER EVERY WEEK ON SCREEN — weeks 4, 5 and 6 at
    // the default span — and the owner is the earliest of those weeks the man
    // actually appears in.
    //
    // This block asserted week 4 alone until the union replaced it. Rosters
    // really do turn over in the demo (45 of 160 men differ between weeks 4 and
    // 13), so the old rule left a man rostered in week 5 out of a table whose
    // columns include week 5 — and made a link to him from another page land on
    // "he may have been dropped". Re-derived here from demo-rosters.js the same
    // way the page derives it, but written independently.
    const SHOWN = [4, 5, 6];
    const teams = generateDemoWeekRosters(SHOWN[0]).teams;
    const ownerOf = new Map();
    for (const week of SHOWN) {
      for (const t of generateDemoWeekRosters(week).teams) {
        for (const p of t.players) {
          if (!ownerOf.has(String(p.playerId))) ownerOf.set(String(p.playerId), t.name);
        }
      }
    }
    const weekFour = new Set(teams.flatMap((t) => t.players.map((p) => String(p.playerId))));

    c.ok('every man on a demo roster in any week shown is listed',
      rows.length === ownerOf.size, `${rows.length} of ${ownerOf.size}`);
    c.ok('and every row is somebody who is really on one',
      rows.every((r) => ownerOf.has(r.player)),
      rows.filter((r) => !ownerOf.has(r.player)).slice(0, 3).map((r) => r.name).join(','));
    c.ok('the union is genuinely wider than the first week, so that is not vacuous',
      ownerOf.size > weekFour.size, `${ownerOf.size} over ${weekFour.size} in week 4`);
    const wrongOwner = rows.filter((r) => r.owner !== ownerOf.get(r.player));
    c.ok('the Owner column names the manager holding him in the earliest week he appears',
      wrongOwner.length === 0,
      wrongOwner.slice(0, 3).map((r) => `${r.name} got ${r.owner} want ${ownerOf.get(r.player)}`).join(' | '));
    c.ok('a man on a week-4 roster still takes his week-4 owner',
      rows.filter((r) => weekFour.has(r.player))
        .every((r) => r.owner === ownerOf.get(r.player)), 'a week-4 man has the wrong owner');
    c.ok('all ten demo squads are represented',
      new Set(rows.map((r) => r.owner)).size === teams.length,
      `${new Set(rows.map((r) => r.owner)).size}`);
    c.ok('every position appears',
      ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].every((p) => rows.some((r) => bareOf(r.pos) === p)),
      [...new Set(rows.map((r) => bareOf(r.pos)))].join(','));
    c.ok('a demo squad really does run three deep somewhere',
      rows.some((r) => rankOf(r.pos) >= 3), 'no rank of 3 anywhere');
    c.ok('the note admits the squads are invented',
      /invented squads with invented projections/.test(note), note);
    c.ok('the taken table is sorted by Avg, best first',
      (() => {
        const avgs = rows.map((r) => (r.avg === null ? null : Number(r.avg)));
        return avgs.every((v, i) => i === 0 || v === null || avgs[i - 1] === null || v <= avgs[i - 1]);
      })(), JSON.stringify(rows.slice(0, 6).map((r) => r.avg)));
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
    console.log('@@' + JSON.stringify({
      scenario,
      results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }],
    }));
    process.exit(1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const args = cfg.stub ? ['--import', './taken-register.mjs', self, scenario] : [self, scenario];
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
