// The Trade page's best deals, kept for the Notifications page.
//
//   node test-notify-trades.mjs
//
// Tim, 2026-10-11: "… messages on any trade notifications you have, or elete
// trade opportunities, these will all be shown in the notifications setting."
//
// Two halves.
//
//   A. js/notify-trades.js on its own — the picking and the shaping, on rows in
//      the shape the Trade page's offers have (a partner, the men each way with
//      the fields a roster read gives them, and the two figures the row prints).
//
//   B. the real trade.html with its real module on tests/tr-stub-season.mjs
//      (the hand-built four-squad league), one scenario per child process as
//      tr-test.mjs does it. The note in localStorage is compared with the
//      table ON SCREEN, re-read here cell by cell: the kept deals are the first
//      rows whose two gain cells both print above zero, in the table's order,
//      with the numbers those cells print. And nothing is written for the
//      sample league, an earlier season, or a search from another squad.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { machineSpeed, scaledBudget } from './settle.mjs';
import { emit } from './emit.mjs';
import { shownNames, printedName } from './last-name.mjs';

const KEY_HEAD = 'ff.notes.trades.';
const LEAGUE = '476225250';   // the stub's league id (tests/tr-stub-season.mjs)
/** The season the site calls current today — js/bridge.js `currentSeason`. */
const thisSeason = () => {
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
};

// ------------------------------------------------------------------ harness
// tr-value-check.mjs's `boot`, `settle` and `settleGoal`, with the store kept
// in reach so a scenario can list every key the page wrote.

async function boot(seed = null) {
  const page = 'trade.html';
  const html = readFileSync(path.join(REPO, page), 'utf8');
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

  window.location = {
    href: `http://localhost/${page}`, origin: 'http://localhost',
    protocol: 'http:', pathname: `/${page}`, search: '', hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map(Object.entries(seed || {}));
  {
    // The regular-season span (tr-test pins the same goal for the same reason).
    let prefs = {};
    try { prefs = JSON.parse(store.get('ff.prefs') || '{}'); } catch { prefs = {}; }
    if (!('trade.goal' in prefs)) prefs['trade.goal'] = 'last';
    store.set('ff.prefs', JSON.stringify(prefs));
  }
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (u) => { throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: (q) => ({
      matches: /min-width/.test(String(q)), media: String(q),
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }),
  });
  window.localStorage = localStorage;
  window.matchMedia = globalThis.matchMedia;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  // Read at once, before the search is waited out: what was written (if
  // anything) while the list was still being worked out.
  const early = { ranked: document.getElementById('tradeTable').getAttribute('data-ranked'), notes: notesIn(store) };
  await settle();
  console.error = origError;
  return { document, window, errors, store, early };
}

/** Every trade note in the store, by key. */
function notesIn(store) {
  const out = {};
  for (const [k, v] of store) {
    if (!k.startsWith('ff.notes.')) continue;
    try { out[k] = JSON.parse(v); } catch { out[k] = `unreadable: ${v}`; }
  }
  return out;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function searchRunning() {
  const document = globalThis.document;
  const el = document && document.getElementById('tradeEmpty');
  return !!(el && !/\bhidden\b/.test(el.getAttribute('class') || '') && el.querySelector('.searching'));
}
const settle = async (ms = 400) => {
  await pause(ms);
  const t0 = Date.now();
  while (searchRunning() && Date.now() - t0 < 180000) await pause(25);
  if (Date.now() - t0 >= 25) await pause(50);
};
let machine = null;
/** Wait for the list to be FINAL: the table's own `data-ranked` signal. */
async function settleRanked(document, idleMax = 90000) {
  const max = scaledBudget(idleMax, (machine || (machine = machineSpeed())).factor);
  const t0 = Date.now();
  await settle(600);
  const table = document.getElementById('tradeTable');
  while (Date.now() - t0 < max && !table.hasAttribute('data-ranked')) await settle(100);
  // The other-goal column fills in after the ranking; a note written twice
  // would show up here as a second `at`.
  const t1 = Date.now();
  while (/…/.test(table.textContent) && Date.now() - t1 < max) await pause(100);
  await settle(300);
  return table.getAttribute('data-ranked');
}

// ------------------------------------------------------------------- reading

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const cls = (el) => (el ? (el.getAttribute('class') || '').split(/\s+/) : []);
/** The headline figure a gain cell prints: "+1.2/wk…" → 1.2, "−0.4/wk…" → −0.4. */
const shown = (el) => {
  const m = text(el).match(/^[+−-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0].replace('−', '-')) : null;
};

/** The ranked table as it is on screen, top to bottom. */
function readTable(document) {
  return [...document.querySelectorAll('#tradeTable tbody tr.offer')].map((tr) => {
    // THE SPLIT CELLS (2026-10-12): each figure is a box (`.hv`) in half of a
    // cell now, wearing the classes its own cell used to. And a man is printed
    // by his LAST NAME, so each one is read as the row prints him
    // (`printedName`: his link's text in front of his tag and his number).
    const mine = tr.querySelector('.hv.gain');
    const his = tr.querySelector('.hv.their-gain');
    const printed = (sel) => [...tr.querySelectorAll(`${sel} .man`)].map(printedName);
    return {
      withName: text(tr.querySelector('.mgr')),
      send: text(tr.querySelector('.hv.pkg.send')),
      sendMen: tr.querySelectorAll('.hv.pkg.send .man').length,
      sendNames: printed('.hv.pkg.send'),
      get: text(tr.querySelector('.hv.pkg.recv')),
      getMen: tr.querySelectorAll('.hv.pkg.recv .man').length,
      getNames: printed('.hv.pkg.recv'),
      // The removed "Your lineup, a week" column, and the row's cells in order.
      lineupCells: tr.querySelectorAll('.before-after').length,
      // (a cell's sign, `pos`/`neg`, is not part of which cell it is)
      cells: [...tr.children].map((td) => (td.getAttribute('class') || '').replace(/\b(pos|neg)\b/g, '').replace(/\s+/g, ' ').trim()),
      gain: shown(mine),
      gainPos: cls(mine).includes('pos'),
      perWeek: /\/wk/.test(text(mine)),
      theirGain: shown(his),
      theirPos: cls(his).includes('pos'),
    };
  });
}

// ----------------------------------------------------------------- scenarios

const liveSeed = (season, extra = {}) => ({
  'ff.connection': JSON.stringify({ leagueId: LEAGUE, season, teamId: 1 }),
  'ff.prefs': JSON.stringify({ 'trade.source': 'live', ...extra }),
});

const SCENARIOS = {};

/** This season, your own squad: the list finishes and the note is there. */
SCENARIOS.live = async function live() {
  const t0 = Date.now();
  const { document, window, errors, store, early } = await boot(liveSeed(thisSeason()));
  const ranked = await settleRanked(document);
  const first = notesIn(store);
  const rows = readTable(document);
  const teams = [...document.getElementById('teamSelect').querySelectorAll('option')]
    .map((o) => ({ id: o.getAttribute('value'), name: text(o) }));

  // Then the same page searched from ANOTHER squad: nothing new may be kept.
  const sel = document.getElementById('teamSelect');
  sel.value = '3';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  const rankedOther = await settleRanked(document);
  const other = notesIn(store);
  const otherTitle = text(document.getElementById('finderTitle'));

  // And back to your own: a fresh list, a fresh note.
  sel.value = '1';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  const rankedBack = await settleRanked(document);
  const back = notesIn(store);
  const rowsBack = readTable(document);
  return { errors, early, ranked, first, rows, teams, rankedOther, other, otherTitle, rankedBack, back, rowsBack,
    t0, t1: Date.now() };
};

/** The sample league: nothing is kept. */
SCENARIOS.demo = async function demo() {
  const { document, errors, store } = await boot({});
  const ranked = await settleRanked(document);
  return { errors, ranked, rows: readTable(document).length, notes: notesIn(store), badge: text(document.getElementById('finderTitle')) };
};

/** An earlier season of the same league: nothing is kept. */
SCENARIOS.past = async function past() {
  const { document, errors, store } = await boot(liveSeed(thisSeason() - 1));
  const ranked = await settleRanked(document);
  return { errors, ranked, rows: readTable(document).length, notes: notesIn(store) };
};

/** Narrowed to one shape: what it finds is kept, an empty answer is not. */
SCENARIOS.narrow = async function narrow() {
  const { document, errors, store } = await boot(liveSeed(thisSeason(), { 'trade.kind': process.env.NT_KIND }));
  const ranked = await settleRanked(document);
  return { errors, ranked, rows: readTable(document), notes: notesIn(store) };
};

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const name = process.argv[2];
  try {
    emit(await SCENARIOS[name](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

function run(name, env = {}) {
  const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', self, name], {
    encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    const tail = (t) => String(t || '').trimEnd().split('\n').slice(-6).join('\n');
    return { boot: `no result for ${name} - exit ${res.status}\nstderr:\n${tail(res.stderr)}\nstdout:\n${tail(res.stdout)}` };
  }
  return JSON.parse(line.slice(2));
}

// -------------------------------------------------------------------- claims

if (!process.argv[2]) {
  let pass = 0;
  const fails = [];
  const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const eq = (name, got, want) => ok(name, same(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

  // ============================================================ A. the module
  let mod = null;
  try {
    mod = await import(pathToFileURL(path.join(REPO, 'js/notify-trades.js')).href);
  } catch (err) {
    ok('js/notify-trades.js loads', false, String(err && err.message));
  }

  if (mod) {
    const { pickDeals, tradesNote, goodForBoth, worthSaving, tradesKey, saveTradesNote, readTradesNote, validNote, MAX_DEALS } = mod;

    // A man as a roster read hands him to the Trade page, and an offer as the
    // finder hands it to the row (js/trade.js `findTrades`), with the two
    // figures the row prints added by the page (`shownGainsOf`).
    const man = (playerId, name, position) => ({
      playerId, name, position, proTeamId: 12, lineupSlotId: 20, slot: 'BE', started: false,
      projected: 11.4, actual: null, injuryStatus: 'ACTIVE',
    });
    const TEAM = {
      2: { id: 2, name: 'Bo', players: [] },
      3: { id: 3, name: 'Cy', players: [] },
      4: { id: 4, name: 'Di', players: [] },
    };
    const row = (partnerId, send, receive, gain, theirGain) => ({
      partner: TEAM[partnerId], send, receive, gain, theirGain,
      // What an offer also carries; none of it may leak into the note.
      myGain: gain * 9, myBefore: 1100.4, myAfter: 1100.4 + gain * 9, theirWeeks: 9,
      byWeek: [{ week: 5, delta: gain }], theirByWeek: [{ week: 5, delta: theirGain }],
      goalScore: { value: 0.012 }, goalPlace: 1,
    });
    const A = { qb: man(100, 'Ana QB1', 'QB'), te: man(110, 'Ana TE2', 'TE'), wr: man(103, 'Ana WR1', 'WR'), rb: man(101, 'Ana RB1', 'RB') };
    const B = { rb: man(201, 'Bo RB1', 'RB'), wr: man(204, 'Bo WR2', 'WR') };
    const C = { rb: man(309, 'Cy RB3', 'RB'), te: man(305, 'Cy TE1', 'TE') };
    const D = { qb: man(400, 'Di QB1', 'QB') };

    eq('the key carries the league and the season in its name', tradesKey('476225250', 2026), 'ff.notes.trades.476225250-2026');
    eq('at most three', MAX_DEALS, 3);

    // The page's order is kept, and only rows good for both sides get in.
    const RANKED = [
      row(3, [A.te], [C.rb], 1.24, 0.86),            // both gain
      row(2, [A.wr], [B.rb], 2.6, -0.4),             // he loses
      row(4, [A.qb, A.te], [D.qb], 0.31, 0.12),      // both gain, two for one
      row(3, [A.rb], [C.te], -0.2, 1.9),             // you lose
      row(2, [A.rb], [B.wr], 0.44, 0.04),            // his gain prints "+0.0"
      row(2, [A.qb], [B.rb, B.wr], 0.1, 0.1),        // both gain
      row(4, [A.wr], [D.qb], 0.9, 0.9),              // both gain — a fourth
    ];
    const deals = pickDeals(RANKED);
    eq('three kept out of four that qualify, in the list’s own order', deals.map((d) => [d.withTeamId, d.gain, d.theirGain]),
      [[3, 1.2, 0.9], [2, 2.6, -0.4], [4, 0.3, 0.1]]);
    ok('you gain and the pair gains: kept though he loses a little', worthSaving({ gain: 2.6, theirGain: -0.4 }));
    ok('he loses more than you gain: not kept', !worthSaving({ gain: 0.5, theirGain: -0.6 }));
    ok('you lose: not kept whatever he gains', !worthSaving({ gain: -0.2, theirGain: 1.9 }));
    eq('a deal in full: who with, the men each way by id and name, the two printed figures', deals[2], {
      withTeamId: 4, withName: 'Di',
      get: [{ id: 400, name: 'Di QB1' }],
      send: [{ id: 100, name: 'Ana QB1' }, { id: 110, name: 'Ana TE2' }],
      gain: 0.3, theirGain: 0.1,
    });
    eq('a deal carries nothing else', Object.keys(deals[0]).sort(), ['gain', 'get', 'send', 'theirGain', 'withName', 'withTeamId']);
    eq('a man is his id and his name, nothing else', Object.keys(deals[0].get[0]).sort(), ['id', 'name']);
    eq('the fourth is there when four are asked for', pickDeals(RANKED, 4).map((d) => d.withTeamId), [3, 2, 4, 2]);
    eq('one asked for is the top one', pickDeals(RANKED, 1).map((d) => d.gain), [1.2]);
    ok('the rows handed in are not touched', RANKED[0].gain === 1.24 && RANKED[0].send[0] === A.te);

    // The rule, figure by figure: as the row prints it, to the tenth.
    ok('both above zero: kept', goodForBoth({ gain: 0.1, theirGain: 0.1 }));
    ok('he loses: not kept', !goodForBoth({ gain: 3, theirGain: -0.1 }));
    ok('you lose: not kept', !goodForBoth({ gain: -0.1, theirGain: 3 }));
    ok('his gain prints 0.0: not kept', !goodForBoth({ gain: 3, theirGain: 0.04 }));
    ok('your gain prints 0.0: not kept', !goodForBoth({ gain: 0.049, theirGain: 3 }));
    ok('a gain that prints 0.1 counts', goodForBoth({ gain: 0.06, theirGain: 0.051 }));
    ok('exactly zero: not kept', !goodForBoth({ gain: 0, theirGain: 0 }));
    ok('no figure for him: not kept', !goodForBoth({ gain: 2, theirGain: null }));
    ok('no figure for you (−Infinity, NaN): not kept', !goodForBoth({ gain: -Infinity, theirGain: 2 }) && !goodForBoth({ gain: NaN, theirGain: 2 }));
    ok('nothing at all: not kept', !goodForBoth(null) && !goodForBoth(undefined) && !goodForBoth({}));

    eq('nobody qualifies: an empty list', pickDeals([RANKED[3], { ...RANKED[1], gain: 0.5, theirGain: -0.6 }]), []);
    eq('an empty list in, an empty list out', pickDeals([]), []);
    eq('no list at all: an empty list, no throw', [pickDeals(null), pickDeals(undefined)], [[], []]);
    eq('a row with no partner, or nobody on one side, is passed over',
      pickDeals([{ ...RANKED[0], partner: null }, { ...RANKED[0], send: [] }, { ...RANKED[0], receive: undefined }, RANKED[2]])
        .map((d) => d.withTeamId), [4]);

    // THE GOAL GUARD (Tim, 2026-10-14: "Yes, add that guard"): a deal that
    // lowers your goal chance by more than the band is never kept, whatever its
    // gains — the page marks it `lowersGoal` (js/trade-odds.js `lowersGoal`).
    // The case that reaches here: the bench-value switch, whose gate does not
    // drop such deals, so they sit below the rest and fill the top three when
    // fewer than three others qualify.
    {
      const lower = { ...RANKED[1], lowersGoal: true };
      const kept = pickDeals([RANKED[0], lower, { ...RANKED[2], lowersGoal: false }]);
      eq('a goal-lowering deal is never kept, however good its gains', kept.map((d) => [d.withTeamId, d.gain]), [[3, 1.2], [4, 0.3]]);
      eq('only goal-lowering deals: nothing kept', pickDeals([lower, { ...RANKED[0], lowersGoal: true }]), []);
      eq('no mark (not played out yet): kept as before', pickDeals([{ ...RANKED[0], lowersGoal: undefined }]).length, 1);
      eq('the mark does not leak into the note', Object.keys(kept[0]).sort(), ['gain', 'get', 'send', 'theirGain', 'withName', 'withTeamId']);
    }

    // The whole note.
    const note = tradesNote({ team: 1, week: 5, at: 1760000000000, rows: RANKED });
    eq('the note’s fields', Object.keys(note).sort(), ['at', 'deals', 'perWeek', 'team', 'v', 'week']);
    eq('the note: version, team, week, time, the units', [note.v, note.team, note.week, note.at, note.perWeek], [1, 1, 5, 1760000000000, true]);
    eq('the note’s deals are the picked ones', note.deals, deals);
    eq('totals rather than a week: said so', tradesNote({ team: 1, week: 5, at: 1, perWeek: false, rows: [] }).perWeek, false);
    eq('a finished list with nothing in it: deals is an empty list', tradesNote({ team: 1, week: 5, at: 7, rows: [] }),
      { v: 1, team: 1, week: 5, at: 7, perWeek: true, deals: [] });
    eq('no week to name: null, not NaN', tradesNote({ team: 1, week: undefined, at: 7, rows: [] }).week, null);
    ok('the note survives JSON', same(JSON.parse(JSON.stringify(note)), note));
    ok('a note is recognised; a stranger is not', validNote(note) && !validNote(null) && !validNote({ v: 2, at: 1, deals: [] }) &&
      !validNote({ v: 1, at: 1, deals: [{ withTeamId: 2 }] }) && !validNote({ v: 1, at: 'x', deals: [] }));

    // Storage: written under the league's own key, read back, and never thrown from.
    const mem = new Map();
    const box = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
    ok('saved', saveTradesNote('476225250', 2026, note, box) === true);
    eq('under the league-season’s key and no other', [...mem.keys()], ['ff.notes.trades.476225250-2026']);
    eq('read back whole', readTradesNote('476225250', 2026, box), note);
    eq('another league, another season: nothing', [readTradesNote('1241838', 2026, box), readTradesNote('476225250', 2025, box)], [null, null]);
    const full = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    ok('a full or refusing browser: false, no throw', saveTradesNote('476225250', 2026, note, full) === false);
    ok('an unreadable browser: null, no throw', readTradesNote('476225250', 2026, full) === null);
    mem.set('ff.notes.trades.9-2026', '{not json');
    ok('a damaged note reads as none', readTradesNote('9', 2026, box) === null);
    ok('no league, no season, or not a note: nothing is written',
      saveTradesNote('', 2026, note, box) === false && saveTradesNote('476225250', undefined, note, box) === false &&
      saveTradesNote('476225250', 2026, { deals: [] }, box) === false && mem.size === 2);
  }

  // ============================================================== B. the page
  const season = thisSeason();
  const key = `${KEY_HEAD}${LEAGUE}-${season}`;

  /** What the note should hold, read off the table on screen. */
  const good = (r) => r.gain > 0 && Math.round((r.gain + r.theirGain) * 10) > 0;
  const fromTable = (rows) => rows.filter(good).slice(0, 3);
  // THE NOTE KEEPS FULL NAMES; THE ROW PRINTS LAST NAMES (Tim, 2026-10-12:
  // "name the players as their lastname only"). So a deal's men are put through
  // the row's own rule (tests/last-name.mjs, the men of both sides together)
  // and must be the row's men, name for name and in its order.
  const asPrinted = (deal) => {
    const all = shownNames(deal.send.concat(deal.get));
    return { send: all.slice(0, deal.send.length), get: all.slice(deal.send.length) };
  };
  const same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const matches = (deal, r) => deal && r && deal.withName === r.withName && deal.gain === r.gain && deal.theirGain === r.theirGain &&
    deal.send.length === r.sendMen && deal.get.length === r.getMen &&
    same2(asPrinted(deal).send, r.sendNames) && same2(asPrinted(deal).get, r.getNames);

  // TR_SPARE_QB: with no kicker or D/ST offered (Tim, 2026-10-16) the base
  // stub keeps only three good rows, so the cap of three would prove nothing;
  // the QB hole (tests/tr-stub-season.mjs, `specOf`) adds good rows.
  const live = run('live', { TR_SPARE_QB: '1' });
  ok('live: the page boots clean and the list finishes', !live.boot && live.errors.length === 0 && !!live.ranked && live.rows.length > 0,
    live.boot || JSON.stringify([live.errors, live.ranked, live.rows && live.rows.length]));
  if (!live.boot) {
    const note = live.first[key];
    eq('live: exactly one note, under this league-season’s key', Object.keys(live.first), [key]);
    ok('live: nothing was written before the list was final',
      !(live.early.ranked === null && Object.keys(live.early.notes).length), JSON.stringify(live.early));
    if (note && typeof note === 'object') {
      const want = fromTable(live.rows);
      // Every row of this hand-built league helps both squads, so the page half
      // proves the order, the cap of three and the figures; rows that must be
      // passed over are half A's.
      ok('live: the table has more good rows than are kept (or the cap proves nothing)',
        want.length === 3 && live.rows.filter(good).length > 3,
        JSON.stringify(live.rows.map((r) => [r.gain, r.theirGain])));
      eq('live: as many deals as the table has good ones, up to three', note.deals.length, want.length);
      note.deals.forEach((d, i) => ok(`live: deal ${i + 1} is the table’s good row ${i + 1} — manager, men, both printed figures`,
        matches(d, want[i]), JSON.stringify([d, want[i]])));
      ok('live: every kept row is one whose two gain cells the page colours as gains',
        want.every((r) => r.gainPos && r.theirPos), JSON.stringify(want));
      ok('live: the figures are a week, as the row prints them', note.perWeek === true && live.rows.every((r) => r.perWeek));
      eq('live: the team is the squad searched from, the week the first still to play', [note.v, note.team, note.week], [1, 1, 5]);
      ok('live: stamped while this scenario ran', note.at >= live.t0 && note.at <= live.t1, `${live.t0} ≤ ${note.at} ≤ ${live.t1}`);
      ok('live: partner ids are the league’s own team ids',
        note.deals.every((d) => live.teams.some((t) => String(t.id) === String(d.withTeamId) && t.name === d.withName)),
        JSON.stringify([note.deals.map((d) => [d.withTeamId, d.withName]), live.teams]));
      ok('live: the men carry numeric ids and names', note.deals.every((d) => d.get.concat(d.send).every((p) =>
        Number.isFinite(p.id) && typeof p.name === 'string' && p.name.length > 0)));

      // THE ROW'S NEW SHAPE (2026-10-12) must not reach the note: the note is
      // what the bell prints, away from the table, so it keeps whole names.
      // On the page before that day the row printed the whole name too, and the
      // second of these fails there ("Cy RB1" is in the row's text).
      const kept = note.deals.flatMap((d) => d.get.concat(d.send));
      const short = kept.filter((p) => !/D\/ST$/.test(p.name));
      ok('live: the note keeps each man’s WHOLE name (first and last), not the row’s short one',
        short.length > 0 && short.every((p) => p.name.trim().split(' ').length >= 2), JSON.stringify(short.map((p) => p.name)));
      ok('live: while the row prints him by his last name only — his whole name is nowhere in it',
        short.length > 0 && note.deals.every((d, i) => d.get.concat(d.send).filter((p) => !/D\/ST$/.test(p.name))
          .every((p) => !`${want[i].send} ${want[i].get}`.includes(p.name))),
        JSON.stringify(want.map((r) => [r.send, r.get])));
      ok('live: a defence keeps its whole name in the row',
        note.deals.every((d, i) => d.send.concat(d.get).filter((p) => /D\/ST$/.test(p.name))
          .every((p) => want[i].sendNames.concat(want[i].getNames).includes(p.name))),
        JSON.stringify(want.map((r) => [r.sendNames, r.getNames])));
      eq('live: no row has a "Your lineup, a week" cell any more', live.rows.reduce((n, r) => n + r.lineupCells, 0), 0);
      eq('live: every row is Manager, Chance, Send, Gain, Value, His proj, ESPN',
        [...new Set(live.rows.map((r) => r.cells.join(' | ')))],
        ['name | split chance | split left deal | split gains | split wkproj | value val-change | appeal | total | opp-proj | left espn']);

      // From another squad.
      ok('other squad: its list finished too', !!live.rankedOther && /Cy/.test(live.otherTitle), JSON.stringify([live.rankedOther, live.otherTitle]));
      eq('other squad: the note is untouched — still yours, same stamp', live.other, live.first);

      // Back on your own.
      const again = live.back[key];
      ok('back on your squad: the list finished again', !!live.rankedBack && live.rowsBack.length > 0);
      ok('back on your squad: a fresh note, the same deals', again && again.team === 1 && again.at > note.at &&
        same(again.deals, note.deals), JSON.stringify([again && again.at, note.at, again && again.deals]));
      eq('back on your squad: still one key', Object.keys(live.back), [key]);
    } else {
      ok('live: the note is there', false, JSON.stringify(live.first));
    }
  }

  const demo = run('demo');
  ok('demo: boots clean and its list finishes', !demo.boot && demo.errors.length === 0 && !!demo.ranked && demo.rows > 0,
    demo.boot || JSON.stringify([demo.errors, demo.ranked, demo.rows]));
  if (!demo.boot) eq('demo: nothing is kept', demo.notes, {});

  const past = run('past');
  ok('earlier season: boots clean and its list finishes', !past.boot && past.errors.length === 0 && !!past.ranked && past.rows > 0,
    past.boot || JSON.stringify([past.errors, past.ranked, past.rows]));
  if (!past.boot) eq('earlier season: nothing is kept', past.notes, {});

  // One shape only. "2 for 2" finds deals good for both sides on this league.
  const narrow = run('narrow', { NT_KIND: 'two' });
  if (narrow.boot) ok('one shape: boots', false, narrow.boot);
  else {
    const want = fromTable(narrow.rows);
    const note = narrow.notes[key];
    ok('one shape: boots clean and finishes', narrow.errors.length === 0 && !!narrow.ranked, JSON.stringify([narrow.errors, narrow.ranked]));
    if (want.length) {
      ok('one shape: what it found is kept', !!note && note.deals.length === want.length && note.deals.every((d, i) => matches(d, want[i])),
        JSON.stringify([note, want]));
    } else {
      eq('one shape with nothing good in it: no note (it is no proof there is nothing)', narrow.notes, {});
    }
  }

  if (fails.length) {
    console.log(`\n${fails.length} FAILED:`);
    for (const f of fails) console.log(`  FAIL ${f}`);
  }
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}
