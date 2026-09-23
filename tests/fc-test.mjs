// Boots the REAL schedule.html + js/schedule-page.js against four data
// situations and checks the forecast feature end to end.
//
//   node fc-test.mjs
//
// Each scenario runs in its own child process: an ES module initialises once
// per process, and schedule-page.js self-boots on import.
//
// Run it with `npm test` from tests/, or on its own with `node fc-test.mjs`.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';

const SCENARIOS = {
  // THE FIELD SIZE COMES FROM THE LEAGUE, NOT FROM OUR CONSTANT.
  //
  // The page falls back to six when a season carries no ESPN settings, and six
  // is also what Tim's league happens to use — so every other scenario here
  // would pass whether the page read the setting or ignored it entirely. This
  // one makes the stub declare FOUR. If the page is reading, the bracket is two
  // rounds with no byes and the note says it was read; if it is not, everything
  // below fails.
  'playoff-four': {
    label: '(h) the league declares a 4-team bracket, and the page uses it',
    stub: true,
    env: { FC_PLAYOFF_TEAMS: '4' },
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 3 },
    // The simulation hands off through rAF and a timeout so it cannot block the
    // paint, so the panel is empty for a moment after boot. Wait for the note to
    // actually arrive rather than for a fixed delay — a fixed one is either
    // flaky or slow, and on a failure this reports "never rendered" instead of
    // an empty-string mismatch that says nothing about why.
    after: async ({ document }) => {
      for (let i = 0; i < 100; i++) {
        const el = document.getElementById('simNote');
        if (el && el.textContent.trim().length > 40) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  },
  // DIVISIONS ARE READ, AND SAID OUT LOUD WHEN THEY ARE NOT MODELLED.
  //
  // ESPN seeds division winners above every wildcard; this site seeds purely
  // on the table. So a divisional league's Playoffs %, Bye %, Title % and Avg
  // place are all affected, and the panel has to say so where a reader will
  // see it rather than behind the fold.
  //
  // This is the second half of a falsifiable pair. `playoff-four` declares ONE
  // division and asserts the warning is absent; this one declares two and
  // asserts it is present. A page that ignored the setting entirely, or one
  // that warned unconditionally, fails exactly one of the two.
  'playoff-divisions': {
    label: '(h+) the league declares TWO divisions, and the page says seeding ignores them',
    stub: true,
    env: { FC_PLAYOFF_TEAMS: '6', FC_DIVISIONS: '2' },
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 3 },
    after: async ({ document }) => {
      for (let i = 0; i < 100; i++) {
        const el = document.getElementById('simNote');
        if (el && el.textContent.trim().length > 40) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  },
  demo: {
    label: '(a) demo data, default week',
    stub: false,
    prefs: { 'schedule.source': 'demo' },
  },
  'demo-mid': {
    label: '(a) demo data, forecasting from week 5',
    stub: false,
    prefs: { 'schedule.source': 'demo', 'schedule.week': 5 },
  },
  live: {
    label: '(b) stubbed live league, week 2 of 13, no projections on games',
    stub: true,
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'live-noteam': {
    label: '(c) same, with no team set as the owner',
    stub: true,
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026 },
  },
  'live-pickteam': {
    label: '(c+) the owner picks a team in the connection bar afterwards',
    stub: true,
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026 },
    after: async ({ document, CustomEvent }) => {
      document.dispatchEvent(
        new CustomEvent('ff:connection', { detail: { leagueId: '99', season: 2026, teamId: 4 } })
      );
      await new Promise((r) => setTimeout(r, 50));
    },
  },
  'live-switch': {
    label: '(e) switching the forecast through every team in the league',
    stub: true,
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const sel = document.getElementById('forecastTeam');
      const views = {};
      for (const o of [...sel.querySelectorAll('option')]) {
        sel.value = o.getAttribute('value');
        sel.dispatchEvent(new window.Event('change'));
        await new Promise((r) => setTimeout(r, 20));
        views[o.getAttribute('value')] = {
          name: o.textContent.replace(' (you)', ''),
          title: document.getElementById('forecastTitle').textContent.trim(),
          bars: document.getElementById('forecastChart').querySelectorAll('rect').length,
          stats: document.getElementById('forecastStats').textContent.replace(/\s+/g, ' ').trim(),
          rows: [...document.getElementById('forecastTable').querySelectorAll('tbody tr')]
            .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))
            .filter((c) => c.length === 6),
        };
      }
      globalThis.__views = views;
    },
  },
  archive: {
    label: '(g) the time machine: a reading is taken, and replaying gives it back',
    stub: true,
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    after: async ({ document, window }) => {
      const $ = (id) => document.getElementById(id);
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const ls = globalThis.localStorage;
      const out = {};

      const snapPage = () => ({
        badge: txt($('modeBadge')),
        badgeCls: $('modeBadge').getAttribute('class') || '',
        sub: txt($('pageSub')),
        bannerHidden: ($('replayBanner').getAttribute('class') || '').includes('hidden'),
        banner: txt($('replayBanner')),
        asOf: $('asOfSelect').value,
        options: [...$('asOfSelect').querySelectorAll('option')].map((o) => o.getAttribute('value')),
        deleteHidden: ($('snapDelete').getAttribute('class') || '').includes('hidden'),
        // The visible state (what is kept, what still needs exporting) and the
        // tucked explanation, read together: every fact must be on the panel.
        status: txt($('snapStatus')) + ' ' + txt($('snapState')),
        // What needs acting on must be visible, not tucked in <details>.
        state: txt($('snapState')),
        // The two panels the whole feature exists for.
        forecast: [...$('forecastTable').querySelectorAll('tbody tr')]
          .map((tr) => [...tr.children].map((td) => txt(td))),
        forecastStats: txt($('forecastStats')),
        forecastNote: txt($('forecastNote')),
        sim: [...$('simTable').querySelectorAll('tbody tr')]
          .map((tr) => [...tr.children].map((td) => td.getAttribute('data-v') ?? txt(td))),
      });

      // ---- what booting live recorded on its own --------------------------
      const keys = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith('ff.snap.')) keys.push(k);
      }
      out.keys = keys;
      out.auto = keys.length ? JSON.parse(ls.getItem(keys[0])) : null;
      out.live = snapPage();

      // ---- a DOCTORED reading, so replay cannot be confused with live -----
      //
      // Within one boot the archive and the live page hold the same numbers, so
      // "replay works" would be unfalsifiable. This writes a week 1 reading
      // whose projections are all 200-something and whose spread is 5, none of
      // which the live page could produce — so if those numbers reach the
      // screen, they came out of storage and nowhere else.
      if (out.auto) {
        const doctored = JSON.parse(JSON.stringify(out.auto));
        doctored.week = 1;
        doctored.takenAt = '2026-09-01T10:00:00.000Z';
        doctored.sigma = 5;
        doctored.sigmaCalibrated = true;
        doctored.sigmaSample = 40;
        for (const w of Object.keys(doctored.proj)) {
          for (const t of Object.keys(doctored.proj[w])) {
            doctored.proj[w][t] = 200 + Number(t);
          }
        }
        for (const t of Object.keys(doctored.strength)) doctored.strength[t] = 200 + Number(t);
        out.doctored = doctored;
        ls.setItem('ff.snap.99.2026.1', JSON.stringify(doctored));
      }

      // The page builds this option itself on its next render; the test adds it
      // so the change handler — which is what is under test — can be reached
      // without waiting for one.
      const sel = $('asOfSelect');
      const opt = document.createElement('option');
      opt.setAttribute('value', '1');
      opt.textContent = 'Week 1';
      sel.appendChild(opt);
      sel.value = '1';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      out.replayed = snapPage();

      // ---- and back to now ------------------------------------------------
      const sel2 = $('asOfSelect');
      sel2.value = 'live';
      sel2.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      out.back = snapPage();

      globalThis.__arch = out;
    },
  },
  'sim-interact': {
    label: '(f) simulation: switching team repaints, changing the run count re-runs',
    stub: false,
    prefs: { 'schedule.source': 'demo', 'schedule.week': 5 },
    after: async ({ document, window }) => {
      const $ = (id) => document.getElementById(id);
      const snap = () => ({
        rows: [...$('simTable').querySelectorAll('tbody tr')].map((tr) =>
          [...tr.children].map((td) => td.getAttribute('data-v') ?? td.textContent.trim())),
        bars: [...$('simChart').querySelectorAll('path.ff-bar title')].map((t) => t.textContent.trim()),
        cap: $('simCap').textContent.replace(/\s+/g, ' ').trim(),
        note: $('simNote').textContent.replace(/\s+/g, ' ').trim(),
        empty: ($('simTable').querySelector('tr.empty-row') || { textContent: '' })
          .textContent.replace(/\s+/g, ' ').trim(),
        on: [...$('simRuns').querySelectorAll('button.on')].map((b) => b.textContent.trim()),
      });

      const before = snap();

      // --- switch the forecast team: a repaint, never a re-run -------------
      const sel = $('forecastTeam');
      const opts = [...sel.querySelectorAll('option')];
      const other = opts.find((o) => o.getAttribute('value') !== sel.value) || opts[1];
      const pickedName = other.textContent.replace(' (you)', '').trim();
      sel.value = other.getAttribute('value');
      sel.dispatchEvent(new window.Event('change'));
      // Read SYNCHRONOUSLY: no timer has had a chance to fire, so anything on
      // screen now came from the cache rather than from a fresh run.
      const duringTeam = snap();
      await new Promise((r) => setTimeout(r, 300));
      const afterTeam = snap();

      // --- change the run count: this one must re-run ----------------------
      const btn = [...$('simRuns').querySelectorAll('button')]
        .find((b) => b.getAttribute('data-runs') === '50000');
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
      const duringRuns = snap();
      await new Promise((r) => setTimeout(r, 4000));
      const afterRuns = snap();

      // --- and the 100,000 Tim asked for -----------------------------------
      // The one that would actually freeze a browser if it ran inline: over a
      // second of arithmetic, plus a three-round bracket on top of each season.
      // Read synchronously straight after the click, so the "Simulating…" frame
      // being on screen proves the work was handed off rather than blocking.
      const big = [...$('simRuns').querySelectorAll('button')]
        .find((b) => b.getAttribute('data-runs') === '100000');
      const t0 = Date.now();
      big.dispatchEvent(new window.Event('click', { bubbles: true }));
      const duringBig = snap();
      // Polled rather than slept through, so `bigMs` is how long the run
      // actually took rather than how long the test was willing to wait.
      let afterBig = null;
      for (let i = 0; i < 120 && !afterBig; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const now = snap();
        if (now.rows.length === 10) afterBig = now;
      }
      const bigMs = Date.now() - t0;
      if (!afterBig) afterBig = snap();

      globalThis.__sim = {
        before, duringTeam, afterTeam, duringRuns, afterRuns, duringBig, afterBig, bigMs,
        pickedName,
        prefs: globalThis.localStorage.getItem('ff.prefs'),
      };
    },
  },
  // A SAVED WEEK EXPIRES ON LIVE DATA ONCE THE LEAGUE HAS MOVED PAST IT.
  //
  // Week 1 is decided and week 2 is under way, so the page would open on week
  // 2. A week 1 remembered from last Sunday used to pin it there all season.
  // Then, in the same visit, the reader picks week 1 by hand and the league is
  // reloaded: a pick made THIS visit stands.
  'week-stale': {
    label: '(i) a saved week the live league has moved past is dropped',
    stub: true,
    env: { FC_IN_PROGRESS: '1' },
    prefs: { 'schedule.source': 'live', 'schedule.week': 1 },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    reloads: true,   // the "Live" button is pressed once, so every request is paid twice
    after: async ({ document, window }) => {
      const sel = document.getElementById('weekSelect');
      const opened = sel.value;
      sel.value = '1';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector('#sourceToggle button[data-src="live"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      globalThis.__weeks = { opened, reloaded: document.getElementById('weekSelect').value };
    },
  },
  'week-ahead': {
    label: '(i) a saved week still ahead of the live league is kept',
    stub: true,
    env: { FC_IN_PROGRESS: '1' },
    prefs: { 'schedule.source': 'live', 'schedule.week': 6 },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'week-all': {
    label: '(i) "All weeks" is not a week, and never expires',
    stub: true,
    env: { FC_IN_PROGRESS: '1' },
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
  'live-rosterfail': {
    label: '(d) same, roster fetch rejects',
    stub: true,
    env: { FC_ROSTERS_FAIL: '1' },
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all' },
    conn: { leagueId: '99', season: 2026, teamId: 4 },
  },
};

// ------------------------------------------------------------------- child

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  const html = readFileSync(path.join(REPO, 'schedule.html'), 'utf8');
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
    window.location = { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', pathname: '/schedule.html', search: '', hash: '' };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
  if (cfg.prefs) store.set('ff.prefs', JSON.stringify(cfg.prefs));
  if (cfg.conn) store.set('ff.connection', JSON.stringify(cfg.conn));
  // `length` and `key()` are part of the real Storage interface and were
  // missing here. `js/snapshots.js` enumerates keys to list the archive, so
  // without them the time machine would quietly find nothing and every
  // assertion about it would pass by being vacuous.
  // Every write is recorded as well as kept, because the bytes a load LEAVES
  // behind and the bytes it CHURNS are different numbers and both matter on a
  // 5 MB quota (AUDIT §3.7 — test-store.mjs covers eviction order, not size).
  const writes = [];
  const localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { writes.push([k, String(v).length]); store.set(k, String(v)); },
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

  await import(pathToFileURL(path.join(REPO, 'js/schedule-page.js')).href);
  await new Promise((r) => setTimeout(r, 400));
  if (cfg.after) await cfg.after({ document, window, CustomEvent: window.CustomEvent });
  console.error = origError;

  return { document, errors, fetchCalls, rejections, cfg, store, writes };
}

// ------------------------------------------------------------- assertions

function makeChecker() {
  const out = [];
  return {
    out,
    ok(name, cond, detail = '') {
      out.push({ name, pass: Boolean(cond), detail: cond ? '' : detail });
    },
  };
}

// THE SHARED RED/GREEN SCALE puts a ▲ or ▼ INSIDE the cell at the end of the
// scale (js/heat.js, channel 2), so every reader of a cell's text here has to
// strip it first or "62% ▲" stops parsing as a percentage. The glyph is
// stripped from CELLS only and never from note text, because the key sentences
// legitimately talk about ▲ and ▼ and a suite that erased them could not tell
// a key that mentions the marks from one that does not.
const stripMark = (s) => String(s || '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();

/** "62%" | "<1%" | ">99%" | "—" -> number or null */
function pctOf(text) {
  const s = stripMark(text);
  if (s === '—' || s === '') return null;
  if (s === '<1%') return 0.4;
  if (s === '>99%') return 99.6;
  const m = /^(\d+)%$/.exec(s);
  return m ? Number(m[1]) : null;
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

const HEAT_CLS = /\bheat-(up|dn)-([1-4])\b/;
/** 'up' | 'dn' | null — which side of the shared scale a cell was painted. */
const heatSide = (el) => {
  const m = HEAT_CLS.exec((el && el.getAttribute('class')) || '');
  return m ? m[1] : null;
};

/**
 * Every green cell on the good side of its column's mean and every red cell on
 * the bad side — the assertion a flipped `invert` fails outright.
 *
 * The direction is passed in rather than read off the page, because a test that
 * infers it agrees with whatever the page did. It also refuses to pass on a
 * column that drew no colour at all, so "the scale stopped working" cannot look
 * like "every cell was fine".
 */
function heatDirection(cells, goodHigh) {
  const usable = cells
    .map((c) => [Number(c.getAttribute('data-v')), c])
    .filter(([v]) => Number.isFinite(v));
  if (usable.length < 2) return 'fewer than two readable values';
  const mean = usable.reduce((a, [v]) => a + v, 0) / usable.length;
  let ups = 0;
  let downs = 0;
  for (const [v, cell] of usable) {
    const side = heatSide(cell);
    if (!side) continue;
    if (side === 'up') ups++; else downs++;
    if ((side === 'up') !== (goodHigh ? v > mean : v < mean)) {
      return `${v} (mean ${mean.toFixed(3)}) painted ${side} with goodHigh=${goodHigh}`;
    }
  }
  if (!ups) return 'nothing green';
  if (!downs) return 'nothing red';
  return '';
}

/**
 * ON SCREEN, not merely present — AUDIT §3.4.
 *
 * A colour key asserted by its TEXT alone passes just as happily when the key
 * is moved inside its own closed <details>, which is a colour with its key
 * behind a toggle and is what rule 7 forbids. That was demonstrated on
 * 2026-09-20 by moving `forecastKey` (and test-home's two) into their closed
 * toggles and watching both suites stay green. So every key assertion here goes
 * through this, which walks the ancestors for a `hidden` attribute and for a
 * closed toggle.
 */
function onScreen(el) {
  if (!el) return false;
  for (let n = el; n; n = n.parentElement) {
    if (n.hasAttribute && n.hasAttribute('hidden')) return false;
    if (n.tagName === 'DETAILS' && n !== el && !n.hasAttribute('open')) return false;
  }
  return true;
}

/** Where an element sits, for a failure message that says why it is not on screen. */
function placeOf(el) {
  if (!el) return 'no such element';
  const trail = [];
  for (let n = el; n && n.tagName !== 'BODY'; n = n.parentElement) {
    trail.push(n.tagName.toLowerCase() +
      (n.id ? '#' + n.id : '') +
      (n.hasAttribute('hidden') ? '[hidden]' : '') +
      (n.tagName === 'DETAILS' ? (n.hasAttribute('open') ? '[open]' : '[CLOSED]') : ''));
  }
  return trail.join(' < ');
}

/** Population standard deviation, for "was there anything to colour?". */
function sdOf(xs) {
  const v = xs.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (v.length < 2) return 0;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
}

function rowsOf(table) {
  return Array.from(table.querySelectorAll('tbody tr')).map((tr) => ({
    tr,
    cls: tr.getAttribute('class') || '',
    cells: Array.from(tr.children).map((td) => stripMark(txt(td))),
    v: Array.from(tr.children).map((td) => td.getAttribute('data-v')),
    td: Array.from(tr.children),
  }));
}

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));

  // ---- (h) the league's own bracket, not ours -----------------------------
  //
  // The stub declares FOUR playoff teams where the page's fallback is six, so
  // every claim here fails if the setting is being ignored. Four teams is a
  // two-round bracket with nobody on a bye, against six teams / three rounds /
  // two byes — so the round count and the byes are independent evidence that
  // the number really reached the bracket rather than only the sentence.
  if (scenario === 'playoff-four') {
    const note = (d.getElementById('simNote')?.textContent || '').replace(/\s+/g, ' ');

    c.ok('the panel says four of ten qualify', /\b4 of 10 teams make the playoffs/.test(note), note.slice(0, 220));
    // Scoped to the field-size SENTENCE, not the whole note: the scoring-spread
    // paragraph legitimately says "assumed, because" about sigma, and a
    // note-wide search for that phrase would fail for the wrong reason.
    const fieldSentence = note.slice(
      note.indexOf('teams make the playoffs'),
      note.indexOf('teams make the playoffs') + 140
    );
    c.ok('and says the number was READ rather than assumed',
      /read from your league/i.test(fieldSentence) && !/assumed/i.test(fieldSentence),
      fieldSentence);
    c.ok('six is nowhere in the field-size sentence',
      !/\b6 of 10 teams make the playoffs/.test(note), note.slice(0, 200));

    // Four teams is two rounds and no byes. Six would be three and two.
    c.ok('the bracket is two rounds', /\b2 rounds of one week each/.test(note), note.slice(0, 300));
    c.ok('and nobody gets a bye',
      /every qualifier plays every round/.test(note) && !/skip round one/.test(note), note.slice(0, 320));

    // And the arithmetic followed, not just the prose: exactly four teams can
    // have any chance of the title, and the other six must be exactly zero.
    // Title % is column 7 (see COL below). This used to look for a cell whose
    // CLASS contained "title" — nothing has ever carried such a class, so the
    // lookup found nothing, every value came back as 0 and the assertion under
    // it passed vacuously for any page at all. Fixed 2026-09-19 while the
    // column's classes were being changed anyway, which is how it surfaced.
    const rows = [...d.querySelectorAll('#simTable tbody tr')];
    const titles = rows.map((tr) => {
      const cell = [...tr.children][7];
      const v = cell ? Number(cell.getAttribute('data-v')) : NaN;
      return Number.isFinite(v) ? v : 0;
    });
    c.ok('the title column really was read (not a lookup that always misses)',
      rows.length === 0 || titles.some((v) => v > 0),
      `every title % read as 0 across ${rows.length} rows`);
    // WHAT THE FOUR-TEAM FIELD ACTUALLY CONSTRAINS, corrected 2026-09-19.
    //
    // This used to assert "at most four teams have any title chance", which is
    // not true and was never tested: it was reading a cell that does not exist
    // (see above), so every value came back 0 and the count was always 0. With
    // the read fixed, all ten teams have a non-zero chance here — correctly,
    // because with most of the season still to play every team qualifies in
    // SOME simulated season. "Four make the playoffs" is a fact about each
    // season, not about the league.
    //
    // So the real invariants are these two, and they are the ones that fail if
    // the declared field size never reached the bracket: exactly four teams
    // qualify in every season (the column sums to 4, not to 6), and no team can
    // win a title in more seasons than it reached the playoffs in.
    const numAt = (tr, i) => Number([...tr.children][i].getAttribute('data-v'));
    const qualifySum = rows.reduce((a, tr) => a + numAt(tr, 4), 0);
    c.ok('exactly FOUR teams qualify in every simulated season, not six',
      rows.length === 0 || Math.abs(qualifySum - 4) < 0.005, String(qualifySum));
    c.ok('and nobody wins a title in more seasons than they reached the bracket',
      rows.every((tr) => numAt(tr, 7) <= numAt(tr, 4) + 1e-9),
      rows.map((tr) => `${numAt(tr, 7)}>${numAt(tr, 4)}`).join(','));

    // ONE DIVISION, so there is nothing to warn about. This is the half of the
    // pair that fails if the page ever warns unconditionally — without it,
    // "the warning appears for two divisions" would pass for a page that
    // showed the warning to everybody.
    const warn = d.getElementById('simWarn');
    c.ok('the divisions warning is absent in a single-division league',
      Boolean(warn) && warn.hidden === true,
      warn ? `hidden=${warn.hidden}: ${(warn.textContent || '').slice(0, 120)}` : 'no #simWarn element');
    c.ok('and the note says the table IS the whole seeding rule',
      /single division/i.test(note), note.slice(note.indexOf('Seeding is'), note.indexOf('Seeding is') + 260));

    return c.out;
  }

  if (scenario === 'playoff-divisions') {
    const note = (d.getElementById('simNote')?.textContent || '').replace(/\s+/g, ' ');
    const warn = d.getElementById('simWarn');
    const warnText = (warn?.textContent || '').replace(/\s+/g, ' ');

    c.ok('the divisions warning is VISIBLE', Boolean(warn) && warn.hidden === false,
      warn ? `hidden=${warn.hidden}` : 'no #simWarn element');
    c.ok('it says how many divisions ESPN reported', /\b2 divisions\b/.test(warnText), warnText.slice(0, 200));
    c.ok('and that the seeding ignores them', /ignores them/i.test(warnText), warnText.slice(0, 200));
    // The four percentages a wrong seed actually moves are named, so a reader
    // knows which numbers to discount rather than distrusting the whole panel.
    for (const col of ['Playoffs', 'Bye', 'Title', 'Avg place']) {
      c.ok(`it names ${col}`, warnText.includes(col), warnText.slice(0, 240));
    }
    c.ok('the note repeats it where the bracket is explained',
      /NOT modelled here|not modelled here/.test(note) && /division winners/i.test(note),
      note.slice(note.indexOf('Seeding is'), note.indexOf('Seeding is') + 320));
    c.ok('and it does not claim a single division',
      !/single division/i.test(note), note.slice(0, 200));

    // The field size still comes from the league, so declaring divisions has
    // not disturbed the setting beside it.
    c.ok('six of ten still qualify', /\b6 of 10 teams make the playoffs/.test(note), note.slice(0, 220));

    return c.out;
  }
  // The page makes exactly ONE raw fetch of its own, and only on a live league:
  // the archive committed under data/snapshots/, which is what lets a cleared
  // browser restore its history. Everything else goes through js/season.js and
  // is counted below. A blanket "no network calls" hid which call was which, so
  // this names the one that is allowed and still fails on any other.
  const ARCHIVE = /^data\/snapshots\/[^/]+\.json$/;
  const archiveCalls = boot.fetchCalls.filter((u) => ARCHIVE.test(u));
  // A scenario that reloads the league on purpose pays for every load in full.
  const loads = boot.cfg.reloads ? 2 : 1;
  const unexpected = boot.fetchCalls.filter((u) => !ARCHIVE.test(u));
  c.ok('no unexpected network calls', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
  c.ok('the committed archive is asked for at most once per load',
    archiveCalls.length <= loads, archiveCalls.join(' | '));
  if (!boot.cfg.stub) {
    // Sample data has no league, so there is nothing committed to ask for and
    // asking would be a guaranteed 404 on every demo page load.
    c.ok('demo asks for no archive at all', archiveCalls.length === 0, archiveCalls.join(' | '));
  } else {
    c.ok('a live league does look for a committed archive',
      archiveCalls.length === loads, boot.fetchCalls.join(' | '));
  }

  // ---- request budget, for the stubbed live scenarios ---------------------
  if (boot.cfg.stub) {
    const season = await import('./fc-stub-season.mjs');
    const espn = await import('./fc-stub-espn.mjs');
    c.ok('one fetchSchedule per load', season.calls.schedule === loads, `saw ${season.calls.schedule}`);
    // ESPN publishes a per-week projection for every future week but has no
    // bulk form, so the cost is one request per week, each asked for ONCE.
    const got = season.calls.rosters.slice().sort((a, b) => a - b);
    // Weeks 2..13 are the rest of the stub's 13-week regular season and are
    // the projection; 14, 15 and 16 are the three playoff rounds, which are NOT
    // on ESPN's schedule (it stops at the last regular-season week) and so are
    // asked for by number. ESPN really does publish per-player projections for
    // them — verified 2026-09-16 against public leagues 1241838 and 899513,
    // right through week 18 — which is why the bracket is simulated from the
    // same numbers as everything else rather than from an average.
    //
    // CHANGED 2026-09-16: week 1, which is PLAYED, is now read too. This used
    // to assert it never was ("wasted"). It is not wasted any more: its
    // started lineups' projections, set against its scores, are what the
    // scoring spread is measured from — the same residuals the Summary page
    // uses, which is what makes the two pages' title chances agree.
    c.ok('one roster request per week — remaining, playoff, and decided — none twice',
      JSON.stringify(got) ===
        JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].flatMap((w) => Array(loads).fill(w))),
      `saw ${JSON.stringify(season.calls.rosters)}`);
    c.ok('the playoff weeks follow the regular season rather than being hardcoded',
      [14, 15, 16].every((w) => season.calls.rosters.includes(w)),
      `saw ${JSON.stringify(season.calls.rosters)}`);
    c.ok('the played week is read exactly once, for the scoring spread',
      season.calls.rosters.filter((w) => w === 1).length === loads, `saw ${JSON.stringify(season.calls.rosters)}`);
    // Byes arrive inside the weekly projections (a bye player is projected 0),
    // so the separate bye-week request is gone.
    c.ok('bye weeks never fetched separately', espn.calls.byes === 0, `saw ${espn.calls.byes}`);

    // ---- THE TOTAL BILL, which nothing measured until 2026-09-22 (§3.7).
    //
    // Every request above is accounted for one at a time; nobody watched the
    // SUM. That is the number that matters, because this page costs one request
    // per week and a page that starts asking for one more thing per week grows
    // the bill seventeen at a time on a real league — and ESPN is a third party
    // with no published rate limit, so the cost is measured here rather than
    // discovered by being throttled mid-season.
    //
    // 17 per load = 1 schedule + 16 weeks (1 played, 2-13 remaining, 14-16 the
    // bracket), plus the archive lookup that goes through fetch. A cheaper page
    // is welcome; a dearer one is a decision.
    const ESPN_BUDGET_PER_LOAD = 17;
    const ARCHIVE_BUDGET_PER_LOAD = 1;
    const espnCalls = season.calls.schedule + season.calls.rosters.length + espn.calls.byes;
    c.ok('a live load costs no more ESPN requests than its budget',
      espnCalls <= ESPN_BUDGET_PER_LOAD * loads,
      `${espnCalls} ESPN requests over ${loads} load(s), budget ${ESPN_BUDGET_PER_LOAD} each ` +
      `(schedule ${season.calls.schedule}, weeks ${season.calls.rosters.length}, byes ${espn.calls.byes})`);
    c.ok('and no more requests through fetch than its budget',
      boot.fetchCalls.length <= ARCHIVE_BUDGET_PER_LOAD * loads,
      `${boot.fetchCalls.length} over ${loads} load(s): ${boot.fetchCalls.join(' | ')}`);
    // Falsifiable in the other direction too: a budget nothing spends is not a
    // measurement, so the page must really be buying the weeks.
    c.ok('and the budget is one the page actually spends',
      espnCalls >= 10 * loads, `${espnCalls} requests`);
  }

  // ---- what this load LEFT IN THE BROWSER, measured by nothing until
  // 2026-09-22 (AUDIT §3.7). test-store.mjs covers the eviction ORDER when the
  // quota runs out; nothing covered how fast the quota is reached. A page that
  // banks one week per request is the page most able to fill 5 MB quietly, and
  // the failure mode is not a crash — it is eviction, which looks like the site
  // simply re-buying weeks it already had.
  const residentBytes = [...boot.store.entries()]
    .reduce((a, [k, v]) => a + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  const writtenBytes = boot.writes.reduce((a, [k, n]) => a + Buffer.byteLength(k) + n, 0);
  const storageDetail =
    `${residentBytes} B resident in ${boot.store.size} keys, ${writtenBytes} B written over ` +
    `${boot.writes.length} writes; biggest key ` +
    ([...boot.store.entries()].sort((a, b) => b[1].length - a[1].length)[0] || ['none', ''])[0];

  if (boot.cfg.stub) {
    // A live load banks the weeks it bought. The budget is per load and set at
    // the real measured figure; growing past it is a decision, not a drift.
    const RESIDENT_BUDGET = 400 * 1024;   // the archive's own cap (rule 12 / §2.3)
    const WRITTEN_BUDGET = 900 * 1024;
    c.ok('a live load leaves no more in localStorage than its budget',
      residentBytes <= RESIDENT_BUDGET * loads, storageDetail);
    c.ok('and churns no more than its write budget',
      writtenBytes <= WRITTEN_BUDGET * loads, storageDetail);
    // And the budget is one the page really spends, or neither line means much.
    // Not in `live-rosterfail`, where every roster request rejects: a load that
    // bought nothing has nothing to bank, and that is the correct behaviour.
    if (scenario !== 'live-rosterfail') {
      c.ok('and it really does bank what it bought',
        residentBytes > 1024, storageDetail);
    }
  } else {
    // Demo is a fixture, not a season: nothing about it is worth keeping, and
    // the store module refuses to write it (rule 15, test-store.mjs).
    c.ok('a demo load leaves almost nothing in localStorage',
      residentBytes <= 4 * 1024, storageDetail);
  }

  const fcRows = rowsOf($('forecastTable'));
  const note = txt($('forecastNote'));
  const empty = $('forecastTable').querySelector('tr.empty-row');

  // ---- (c): no owner's team ----------------------------------------------
  if (scenario === 'live-noteam') {
    // Not knowing who you are is no longer a dead end: every team's projection
    // is built anyway, so the panel opens on the first team and says so.
    c.ok('forecast still renders without an owner', !empty, empty ? txt(empty) : 'rendered');
    c.ok('a chart is still drawn', $('forecastChart').querySelectorAll('svg').length === 1);
    c.ok('forecast points at the "You are" picker', /“You are” menu in the connection bar/.test(note), note);
    c.ok('note explains it fell back to the first team', /opens on the first team/.test(note), note);
    c.ok('title is the neutral form', /^Season forecast — /.test(txt($('forecastTitle'))), txt($('forecastTitle')));
    c.ok('picker lists every team', $('forecastTeam').querySelectorAll('option').length === 10,
      String($('forecastTeam').querySelectorAll('option').length));
    c.ok('nobody is marked as you', !/\(you\)/.test($('forecastTeam').innerHTML));
  }

  // ---- (e): switching between teams --------------------------------------
  if (scenario === 'live-switch') {
    const views = globalThis.__views || {};
    const ids = Object.keys(views);
    c.ok('every team is offered', ids.length === 10, `${ids.length} options`);

    let withRows = 0, withChart = 0, titled = 0;
    for (const [, v] of Object.entries(views)) {
      if (v.rows.length) withRows++;
      if (v.bars) withChart++;
      if (v.title.includes(v.name)) titled++;
    }
    c.ok('every team has a forecast', withRows === 10, `${withRows}/10`);
    c.ok('every team gets a chart', withChart === 10, `${withChart}/10`);
    c.ok('every title names its team', titled === 10, `${titled}/10`);

    // Two teams see the same game. Their views must be mirror images.
    const idByName = new Map(Object.entries(views).map(([id, v]) => [v.name, id]));
    let pairs = 0, mismatched = 0, badSum = 0, sameSide = 0;
    for (const [id, v] of Object.entries(views)) {
      for (const [wk, opp, where, mine, theirs, pct] of v.rows) {
        const otherId = idByName.get(opp);
        if (!otherId) continue;
        const back = (views[otherId].rows || []).find((r) => r[0] === wk);
        if (!back || back[1] !== v.name) continue;
        pairs++;
        if (Math.abs(Number(pct.replace('%','')) + Number(back[5].replace('%','')) - 100) > 1.5) badSum++;
        if (mine !== back[4] || theirs !== back[3]) mismatched++;
        if ((where === 'Home') === (back[2] === 'Home')) sameSide++;
      }
    }
    c.ok('both views of a game were found', pairs >= 100, `${pairs} paired rows`);
    c.ok('paired win chances sum to 100', badSum === 0, `${badSum} bad`);
    c.ok('paired projections are mirrored', mismatched === 0, `${mismatched} bad`);
    c.ok('exactly one side is home', sameSide === 0, `${sameSide} bad`);

    // Switching is a repaint, not a refetch.
    const season = await import('./fc-stub-season.mjs');
    // 16 = 13 regular weeks + 3 playoff weeks, read once each at load.
    c.ok('switching teams triggers no extra roster reads',
      season.calls.rosters.length === 16, `saw ${season.calls.rosters.length}`);
  }

  // ---- was this week recorded: the status line -----------------------------
  //
  // The one line of the time machine that must always be visible, with the
  // REAL reason when the answer is no. Stubbed live league: week 1 is played,
  // so the reading is filed under week 2.
  const snapLine = txt($('snapLine'));
  const snapTone = $('snapLine').getAttribute('class') || '';
  if (scenario === 'live-rosterfail') {
    c.ok('status line: week 2 NOT recorded, because ESPN refused every roster week',
      /^Week 2: NOT recorded — ESPN refused 15 of 15 roster weeks, so there was no projection to record\.$/.test(snapLine),
      snapLine);
    c.ok('and it is red', /\bneg\b/.test(snapTone), snapTone);
    const note = JSON.parse(globalThis.localStorage.getItem('ff.snapnote.99.2026') || 'null');
    c.ok('the failed attempt is kept, so another page can show it',
      note && note.ok === false && note.week === 2 && note.code === 'no-projection', JSON.stringify(note));
    c.ok('and no reading was saved in its place (first write must not be a hollow one)',
      globalThis.localStorage.getItem('ff.snap.99.2026.2') === null);
  }
  if (['live', 'live-noteam', 'live-pickteam', 'archive'].includes(scenario)) {
    c.ok('status line: week 2 recorded, with the day',
      /^Week 2: recorded \S/.test(snapLine), snapLine);
    c.ok('and it is green', /\bpos\b/.test(snapTone), snapTone);
    const note = JSON.parse(globalThis.localStorage.getItem('ff.snapnote.99.2026') || 'null');
    c.ok('the successful attempt is noted too', note && note.ok === true && note.week === 2, JSON.stringify(note));
  }
  if (scenario === 'demo' || scenario === 'demo-mid') {
    c.ok('status line on demo with no league: NOT recorded, and says why',
      /^This week: NOT recorded — no league is connected\.$/.test(snapLine), snapLine);
  }
  // ---- THE ORDER OF THE PAGE, TOP TO BOTTOM -------------------------------
  //
  // Tim's ask of 2026-09-17, made falsifiable: his own season first, then the
  // simulation, then the week in front of him, then everything else in the
  // order it was already in. Read in DOCUMENT order, so moving a panel without
  // moving this line fails here rather than being noticed on the phone.
  const panelIds = [...d.querySelectorAll('section.panel')].map((s) => s.getAttribute('id'));
  c.ok('the panels are in Tim’s order, top to bottom',
    JSON.stringify(panelIds) === JSON.stringify([
      'forecastPanel', 'simPanel', 'matchupsPanel',
      'sourcePanel', 'timePanel', 'h2hPanel',
    ]),
    JSON.stringify(panelIds));
  // The week picker is INSIDE the matchups panel, at the top of it — the whole
  // point of the combine. A picker that floated between panels again would put
  // it outside #matchupsPanel and fail here.
  const wkPanel = d.getElementById('matchupsPanel');
  const inPanel = wkPanel ? [...wkPanel.querySelectorAll('*')] : [];
  const wkSel = $('weekSelect');
  c.ok('the week picker lives inside the Week matchups panel',
    Boolean(wkSel) && inPanel.includes(wkSel),
    wkSel ? 'the picker is outside #matchupsPanel' : 'no picker');
  c.ok('and it comes before the cards it scopes',
    inPanel.indexOf(wkSel) >= 0 && inPanel.indexOf(wkSel) < inPanel.indexOf($('matchups')),
    `picker at ${inPanel.indexOf(wkSel)}, cards at ${inPanel.indexOf($('matchups'))}`);
  c.ok('the week summary was folded into the same panel, not left as a panel of its own',
    inPanel.includes($('summary')) && !d.getElementById('summaryTitle'),
    'the summary stat row is still somewhere else');
  // THE STANDINGS PANEL IS GONE. Tim's direction: the site adds to ESPN and
  // does not rebuild a league table ESPN already shows.
  c.ok('there is no standings panel, table or note anywhere on the page',
    !d.getElementById('standingsPanel') && !d.getElementById('standingsTable') &&
    !d.getElementById('standingsNote') && !/<h2[^>]*>\s*Standings\s*</i.test(d.body.innerHTML),
    'a standings element survived');

  c.ok('the time machine is unfolded on a wide screen', $('timeFold').hasAttribute('open'));
  c.ok('and its status line is the fold’s summary, first in it',
    $('timeFold').firstElementChild === $('snapLine') && $('snapLine').tagName === 'SUMMARY');

  // ---- (d): roster fetch rejected ----------------------------------------
  if (scenario === 'live-rosterfail') {
    c.ok('forecast states there is nothing to forecast from', empty && /no projection to put against/i.test(txt(empty)), txt(empty));
    c.ok('note names the cause and a fix', /rosters could not be read/.test(note) && /Reload the page/.test(note), note);
    // The strength basis used to be stated under the standings table. That
    // table is gone; the basis moved to the matchups panel, which is what
    // prints a strength ranking against an unplayed card.
    c.ok('the strength basis still falls back, and still says so',
      /points per game so far/.test(txt($('matchupsNote'))), txt($('matchupsNote')));
    c.ok('no chart is drawn', $('forecastChart').querySelectorAll('svg').length === 0);
  }

  // ---- (c+): the team arrives after the page has already rendered ---------
  if (scenario === 'live-pickteam') {
    c.ok('forecast fills in without a reload', fcRows.length === 12 && !empty, `${fcRows.length} rows`);
    c.ok('title names the newly picked team', txt($('forecastTitle')) === 'My season — Team 4', txt($('forecastTitle')));
    c.ok('chart is drawn', $('forecastChart').querySelectorAll('path.ff-bar').length > 0);
  }

  // ---- forecasting scenarios ---------------------------------------------
  const forecasting = ['demo', 'demo-mid', 'live', 'live-pickteam'].includes(scenario);
  if (forecasting) {
    c.ok('forecast has rows', fcRows.length > 0 && !empty, `${fcRows.length} rows`);
    // "My season" only when the league knows who you are; the demo has no
    // owner, so it gets the neutral form. Either way the title names the team.
    c.ok('title names the team',
      /^(My season|Season forecast) — .+/.test(txt($('forecastTitle'))), txt($('forecastTitle')));
    c.ok('picker agrees with the title',
      txt($('forecastTitle')).endsWith($('forecastTeam').querySelector('option[selected]').textContent.replace(' (you)', '')),
      `${txt($('forecastTitle'))} vs ${$('forecastTeam').querySelector('option[selected]').textContent}`);

    const pcts = fcRows.map((r) => pctOf(r.cells[5]));
    c.ok('every row has a win %', pcts.every((p) => p !== null), JSON.stringify(fcRows.map((r) => r.cells)));
    c.ok('win % in 0-100', pcts.every((p) => p !== null && p >= 0 && p <= 100), JSON.stringify(pcts));

    c.ok('every row has both projected scores',
      fcRows.every((r) => /^\d+(\.\d)?$/.test(r.cells[3]) && /^\d+(\.\d)?$/.test(r.cells[4])),
      JSON.stringify(fcRows.map((r) => [r.cells[3], r.cells[4]])));

    c.ok('the next week is highlighted',
      fcRows.filter((r) => /\bnow\b/.test(r.cls)).length === 1,
      fcRows.map((r) => r.cls).join(','));

    // ---- the shared red/green scale, on the one column that can take it ----
    //
    // This table is about ONE team, so the comparison group is that team's own
    // remaining games. Win % is the only column where that is honest, because
    // a win chance is a ratio of two projections FROM THE SAME WEEK — every
    // reason a week is low-scoring for everybody has already cancelled out of
    // it. The two point columns have not, and the assertion that they stay
    // plain is the half that fails if a later pass "finishes the job".
    const winCells = fcRows.map((r) => r.td[5]);
    const shadedWin = winCells.filter((td) => heatSide(td));
    const fcKey = txt($('forecastKey'));

    // The points columns stay plain in EVERY scenario, shaded or not — this is
    // the half that fails if a later pass "finishes the job" and colours them.
    c.ok('the two projected-points columns stay plain',
      !fcRows.some((r) => heatSide(r.td[3]) || heatSide(r.td[4])),
      fcRows.map((r) => `${r.td[3].getAttribute('class')}/${r.td[4].getAttribute('class')}`).join(','));

    // THE KEY IS ON SCREEN — asserted whether anything is shaded or not, since
    // both branches below depend on the reader being able to READ the key.
    // Checking its text only is what let all three of this site's colour keys be
    // moved inside their closed toggles with both suites still green (§3.4).
    c.ok('the forecast key is on screen: not hidden, and not behind a toggle',
      onScreen($('forecastKey')), placeOf($('forecastKey')));

    // NO LONGER A SILENT SKIP (AUDIT §3.4). This block sat behind
    // `if (shadedWin.length)`, so setting the forecast's `minSpread` to 1e9 —
    // nothing shaded anywhere — left fc-test green while its count slid from
    // 1004 to 992. Two assertions close it.
    //
    // First: ONE NAMED SCENARIO MUST SHADE. `demo-mid` forecasts from week 5,
    // so it carries nine remaining games at genuinely different chances — and
    // `demo` deliberately is not the one, because the default week leaves a
    // single game, one value, and no scale is possible on it. (That is exactly
    // why the guard existed; the answer is to pin the scenario that can, not to
    // let every scenario off.)
    const winSd = sdOf(pcts);
    if (scenario === 'demo-mid') {
      c.ok('the demo forecast really does shade its Win % column',
        shadedWin.length > 0,
        `${shadedWin.length} of ${winCells.length} shaded; sd ${winSd.toFixed(2)} pts`);
    }
    // Second, and in EVERY forecasting scenario: 5 percentage points of standard
    // deviation clears heat.js's flat-column guard whichever unit the page hands
    // it (HEAT_MIN_SPREAD is 0.05, so 5 points clears it as a percentage and as
    // a fraction), which leaves no honest reason to be plain.
    c.ok('a Win % column with spread the reader can see is never left plain',
      !(winSd >= 5) || shadedWin.length > 0,
      `sd ${winSd.toFixed(2)} pts over ${pcts.length} games; ${shadedWin.length} shaded`);

    if (shadedWin.length) {
      const whyWin = heatDirection(winCells, true);
      c.ok('forecast Win % is shaded, higher-is-better', !whyWin, whyWin);
      // The `title` already carried where the percentage came from, and the
      // scale's words are APPENDED rather than substituted — two facts, one
      // tap, because js/touch-titles.js can only open one sheet per element.
      const titled = shadedWin[0];
      c.ok('a shaded Win % keeps its original title and gains the scale’s words',
        /scoring spread/.test(titled.getAttribute('title') || '') &&
        /SD (above|below)/.test(titled.getAttribute('title') || ''),
        titled.getAttribute('title'));
      // THE KEY IS SPLIT, the way the Stats page splits it: VISIBLE is what
      // changes what a number means, and the thresholds — the half that lets a
      // shaded cell be checked by hand — sit in the tucked method note. Both
      // halves are required, so both are asserted, AND SO IS THE BOUNDARY: an
      // assertion that only checked the note passes just as happily when
      // `describeHeat` creeps back under the table, which is the regression the
      // split was made to undo (node tests/text-audit.mjs schedule.html).
      c.ok('the forecast carries a visible key saying which comparison is being made',
        /remaining games/.test(fcKey) && /green a better chance/i.test(fcKey),
        fcKey.slice(0, 220));
      c.ok('and the visible key names the glyph, not the thresholds',
        /▲▼/.test(fcKey) && !/standard deviation|% or better/.test(fcKey),
        fcKey.slice(0, 220));
      c.ok('and the tucked note prints the thresholds it turns at',
        /Colour compares each number/.test(note) && /standard deviation/.test(note),
        note.slice(0, 260));
    } else {
      // A run-in with one game left, or ten games all at the same chance. Both
      // are real, and both have to SAY they are — an unexplained absence of
      // colour reads as the feature being broken.
      c.ok('with nothing to tell apart, the key says so rather than going blank',
        /Nothing is shaded/.test(fcKey), fcKey.slice(0, 200));
    }

    // stat row
    const stats = Array.from($('forecastStats').querySelectorAll('.stat')).map((s) => txt(s));
    c.ok('banked record shown', stats.some((s) => /^Banked/.test(s)), stats.join(' | '));
    c.ok('expected wins shown', stats.some((s) => /^Expected wins/.test(s)), stats.join(' | '));
    c.ok('80% range shown', stats.some((s) => /^80% range/.test(s)), stats.join(' | '));

    // chart
    const svg = $('forecastChart').querySelector('svg');
    const bars = svg ? Array.from(svg.querySelectorAll('path.ff-bar')) : [];
    c.ok('chart container populated', Boolean(svg) && bars.length > 0, `${bars.length} bars`);
    const total = bars.reduce((a, b) => {
      const t = txt(b.querySelector('title'));
      const m = /:\s*([\d.,]+)$/.exec(t);
      return a + (m ? Number(m[1].replace(/,/g, '')) : 0);
    }, 0);
    c.ok('distribution sums to ~100%', Math.abs(total - 100) < 1.5, `sum = ${total.toFixed(2)}`);
    c.ok('y axis is labelled Chance (%)', /Chance \(%\)/.test(svg ? svg.textContent : ''), '');
    c.ok('bins are win totals',
      bars.every((b) => /^\d+:/.test(txt(b.querySelector('title')))),
      bars.map((b) => txt(b.querySelector('title'))).slice(0, 3).join(' | '));

    // the caveat
    c.ok('note says the odds are ours, not ESPN’s',
      /not published by ESPN/.test(note) && /ESPN gives projections, never odds/.test(note), note);
    c.ok('note never calls them ESPN’s odds', !/ESPN[’']s odds/i.test(note), note);
    c.ok('note states the scoring spread', /point per-team scoring spread/.test(note), note);
  }

  // ---- the season simulation panel ---------------------------------------
  const simulating =
    ['demo', 'demo-mid', 'live', 'live-pickteam', 'live-noteam', 'live-switch'].includes(scenario);

  if (simulating) {
    const simTable = $('simTable');
    const simRows = rowsOf(simTable);
    const simNote = txt($('simNote'));
    const teamNames = Array.from($('forecastTeam').querySelectorAll('option'))
      .map((o) => o.textContent.replace(' (you)', '').trim());
    const picked = $('forecastTeam')
      .querySelector('option[selected]').textContent.replace(' (you)', '').trim();

    c.ok('simulation renders one row per team',
      simRows.length === teamNames.length && !simTable.querySelector('tr.empty-row'),
      `${simRows.length} rows vs ${teamNames.length} teams`);
    c.ok('every simulated row is a real league team',
      simRows.every((r) => teamNames.includes(r.cells[0])),
      simRows.map((r) => r.cells[0]).join(','));

    const meanPlaces = simRows.map((r) => Number(r.v[2]));
    c.ok('projected table is ordered by average place',
      meanPlaces.length > 1 && meanPlaces.every((v, i) => i === 0 || v >= meanPlaces[i - 1] - 1e-9),
      JSON.stringify(meanPlaces));
    c.ok('average place is inside the league', meanPlaces.every((v) => v >= 1 && v <= teamNames.length),
      JSON.stringify(meanPlaces));
    // A placing is a permutation of 1..N in every simulated season, whichever
    // half of it came from the bracket, so the averages have to sum to
    // N(N+1)/2. Re-derived from the league size rather than written as 55, so a
    // fixture with a different number of teams still checks something true.
    const nTeams = teamNames.length;
    c.ok('average places sum to N(N+1)/2, so the placing is still a permutation',
      Math.abs(meanPlaces.reduce((a, v) => a + v, 0) - (nTeams * (nTeams + 1)) / 2) < 0.02,
      `${meanPlaces.reduce((a, v) => a + v, 0)} for ${nTeams} teams`);

    // The columns, by index, now the bracket has arrived:
    //   0 Team  1 Proj. wins  2 Avg place  3 Most likely
    //   4 Playoffs %  5 Bye %  6 1st in table %  7 Title %  8 Last %
    const COL = { playoffs: 4, bye: 5, first: 6, title: 7, last: 8 };
    c.ok('the simulated table has all nine columns',
      simRows.every((r) => r.cells.length === 9),
      JSON.stringify(simRows[0] && simRows[0].cells));

    // Exactly one team wins the title in every simulated season, exactly one
    // tops the table, and exactly one finishes last — so all three are complete
    // distributions. Six teams qualify and two get byes, in every season, so
    // those columns have their own exact totals to hit.
    // ---- THE SHARED RED/GREEN SCALE, and the two inverted columns ----------
    //
    // Six of the nine columns are shaded and TWO OF THEM POINT THE OTHER WAY.
    // Getting one of those two backwards is the single most damaging mistake
    // available on this page — it would paint the team most likely to finish
    // last, and the team most likely to take the wooden spoon, as the two
    // brightest greens in the table — so each is asserted both generally (every
    // green cell on the good side of the mean) and by NAMING A SPECIFIC CELL,
    // which is what makes a flipped `invert` fail loudly instead of subtly.
    const simCol = (i) => simRows.map((r) => r.td[i]);
    for (const [label, i, goodHigh] of [
      ['Proj. wins', 1, true],
      ['Avg place', 2, false],       // INVERTED: 1st is the good end
      ['Playoffs %', COL.playoffs, true],
      ['1st in table %', COL.first, true],
      ['Title %', COL.title, true],
      ['Last %', COL.last, false],   // INVERTED: the wooden spoon is bad news
    ]) {
      const why = heatDirection(simCol(i), goodHigh);
      c.ok(`simulation ${label} is shaded the right way round`, !why, `${label}: ${why}`);
    }
    // The named cells. simRows is emitted in average-place order, so the FIRST
    // row is the team finishing highest and the LAST is the team finishing
    // lowest — which makes both ends of the inverted Avg place column known
    // without reading any number off the page.
    c.ok('the team with the best average place is GREEN on Avg place',
      heatSide(simRows[0].td[2]) === 'up',
      `${simRows[0].cells[0]} @ ${simRows[0].v[2]} -> "${simRows[0].td[2].getAttribute('class')}"`);
    c.ok('and the team with the worst average place is RED',
      heatSide(simRows[simRows.length - 1].td[2]) === 'dn',
      `${simRows[simRows.length - 1].cells[0]} -> "${simRows[simRows.length - 1].td[2].getAttribute('class')}"`);
    {
      const lasts = simRows.map((r) => Number(r.v[COL.last]));
      const spoon = simRows[lasts.indexOf(Math.max(...lasts))];
      const safest = simRows[lasts.indexOf(Math.min(...lasts))];
      c.ok('the wooden-spoon favourite is RED on Last %, not green',
        heatSide(spoon.td[COL.last]) === 'dn',
        `${spoon.cells[0]} @ ${spoon.v[COL.last]} -> "${spoon.td[COL.last].getAttribute('class')}"`);
      c.ok('and the team least likely to finish last is GREEN there',
        heatSide(safest.td[COL.last]) === 'up',
        `${safest.cells[0]} @ ${safest.v[COL.last]} -> "${safest.td[COL.last].getAttribute('class')}"`);
    }
    // "Most likely" is a modal PLACE — already an ordering — so js/heat.js's own
    // rule says it gets nothing. A later pass that shaded the whole table fails.
    c.ok('"Most likely" is left unshaded: it is a place, not a quantity',
      !simCol(3).some((td) => heatSide(td)),
      simCol(3).map((td) => td.getAttribute('class')).join(','));
    // Every shaded cell must still sort as a number. sortable.js falls back to
    // the cell's text without a data-v and strips only ", + $ %" and spaces, so
    // a cell ending in ▲ would sort as a string.
    c.ok('every shaded cell carries a data-v so its column still sorts numerically',
      [...$('simTable').querySelectorAll('td[class*="heat-"]')]
        .every((td) => td.getAttribute('data-v') !== null));
    // Channel 4: the key, VISIBLE, naming the inverted columns. Without it the
    // colour is unverifiable and the two inverted columns are a trap.
    const simKey = txt($('simKey'));
    c.ok('the simulation carries a visible key for the colours',
      /Green good, red bad/.test(simKey), simKey.slice(0, 140));
    c.ok('and the key says which two columns are turned over',
      /Avg place/.test(simKey) && /Last %/.test(simKey) && /turned over/.test(simKey),
      simKey.slice(0, 200));
    c.ok('and the key names the glyph at the ends',
      /▲▼/.test(simKey), simKey.slice(0, 200));
    // AND THE THRESHOLDS ARE NOT IN IT. This is the half of the split that a
    // "does the note mention it?" assertion cannot catch: `describeHeat` under
    // the table passes every check below while putting ~50 words of permanently
    // visible prose back on the panel (node tests/text-audit.mjs schedule.html).
    c.ok('and the visible key does not carry the thresholds',
      !/standard deviation/.test(simKey) && !/\d+ values\)/.test(simKey),
      simKey.slice(0, 240));
    // The thresholds are the tucked half of the key, with the method, exactly
    // as the Stats page splits the same sentence. Both halves are required.
    c.ok('and the tucked note prints the figures the colours turn at',
      /Colour compares each number/.test(simNote) && /standard deviation/.test(simNote),
      simNote.slice(simNote.indexOf('The colours'), simNote.indexOf('The colours') + 260));
    c.ok('the tucked note says each column is measured on its own, never across the table',
      /never across the table/.test(simNote), simNote.slice(0, 200));
    // MOVED OUT OF THE VISIBLE KEY, NOT DELETED. An uncoloured column with no
    // stated reason reads as the feature having missed it.
    c.ok('and the tucked note says why Most likely is left plain',
      /Most likely<\/strong> is left plain|Most likely is left plain/.test(simNote),
      simNote.slice(0, 200));
    // Strengthened 2026-09-22 (AUDIT §3.4): "not hidden" was not enough — the
    // key can also be put out of reach by moving it inside a closed toggle.
    c.ok('the key is on screen while the table is showing: not hidden, not behind a toggle',
      onScreen($('simKey')), placeOf($('simKey')));

    const colSum = (i) => simRows.reduce((a, r) => a + Number(r.v[i]), 0);
    c.ok('title chances sum to 100%', Math.abs(colSum(COL.title) - 1) < 0.005, String(colSum(COL.title)));
    c.ok('first-in-the-table chances sum to 100%',
      Math.abs(colSum(COL.first) - 1) < 0.005, String(colSum(COL.first)));
    c.ok('last-place chances sum to 100%', Math.abs(colSum(COL.last) - 1) < 0.005, String(colSum(COL.last)));
    // Re-derived from the note rather than hardcoded, so changing PLAYOFF_TEAMS
    // moves the assertion with the page instead of breaking it.
    const fieldSize = Number((/(\d+) of \d+ teams make the playoffs/.exec(simNote) || [])[1]);
    c.ok('the panel states how many teams make the playoffs',
      Number.isFinite(fieldSize) && fieldSize >= 2, simNote.slice(0, 160));
    const byeCount = Math.pow(2, Math.ceil(Math.log2(fieldSize))) - fieldSize;
    c.ok('exactly the stated number of teams qualify in every season',
      Math.abs(colSum(COL.playoffs) - fieldSize) < 0.005, String(colSum(COL.playoffs)));
    c.ok('exactly the derived number of byes is handed out in every season',
      Math.abs(colSum(COL.bye) - byeCount) < 0.005, `${colSum(COL.bye)} vs ${byeCount}`);

    // A team can only win a title it qualified for, and can only top the table
    // if it qualified. Both hold row by row, not merely in total.
    c.ok('nobody wins a title without making the playoffs',
      simRows.every((r) => Number(r.v[COL.title]) <= Number(r.v[COL.playoffs]) + 1e-9),
      simRows.map((r) => `${r.cells[0]}:${r.v[COL.title]}>${r.v[COL.playoffs]}`).join(','));
    c.ok('nobody tops the table without making the playoffs',
      simRows.every((r) => Number(r.v[COL.first]) <= Number(r.v[COL.playoffs]) + 1e-9),
      simRows.map((r) => `${r.cells[0]}:${r.v[COL.first]}/${r.v[COL.playoffs]}`).join(','));
    // Only the top seeds can have a bye, so a bye is never more likely than
    // topping the table plus being second.
    c.ok('a bye is rarer than qualifying',
      simRows.every((r) => Number(r.v[COL.bye]) <= Number(r.v[COL.playoffs]) + 1e-9),
      simRows.map((r) => `${r.cells[0]}:${r.v[COL.bye]}/${r.v[COL.playoffs]}`).join(','));

    // THE TWO FACTS MUST BE ABLE TO DISAGREE. If title % were secretly the old
    // first-place number under a new heading, these two columns would be
    // identical down the table. They must not be.
    c.ok('title % is not just first-in-the-table renamed',
      simRows.some((r) => Math.abs(Number(r.v[COL.title]) - Number(r.v[COL.first])) > 0.01),
      simRows.map((r) => `${r.cells[0]} ${r.v[COL.first]}/${r.v[COL.title]}`).join(' | '));
    // And a team outside the playoff places must have a title % of exactly
    // zero, not a rounded-down small number.
    const missers = simRows.filter((r) => Number(r.v[COL.playoffs]) === 0);
    c.ok('a team that cannot reach the playoffs has a title % of exactly 0',
      missers.every((r) => Number(r.v[COL.title]) === 0),
      missers.map((r) => `${r.cells[0]}:${r.v[COL.title]}`).join(',') || '(none in this season)');

    if (scenario === 'demo') {
      // The demo season is simulated from its last week, so the bottom of the
      // table really is mathematically out. Asserted so the "exactly 0" check
      // above is known to have something to bite on rather than passing
      // vacuously over an empty set.
      c.ok('the demo season contains a team that cannot reach the playoffs at all',
        missers.length > 0, `${missers.length} such teams`);
      // TIM'S RULE, ON THE PAGE. The wooden spoon is last in the REGULAR
      // season — so here it is a team that never plays a playoff game, and
      // therefore cannot possibly be the beaten finalist. If last % had been
      // wired to the bracket, this team could not carry it.
      const byCol = (i) => simRows.slice().sort((a, b) => Number(b.v[i]) - Number(a.v[i]))[0];
      const spoon = byCol(COL.last);
      const topTitle = byCol(COL.title);
      const topTable = byCol(COL.first);
      c.ok('the wooden spoon is decided before the playoffs start',
        Number(spoon.v[COL.last]) === 1 && Number(spoon.v[COL.playoffs]) === 0 &&
        Number(spoon.v[COL.title]) === 0,
        `${spoon.cells[0]} last=${spoon.v[COL.last]} playoffs=${spoon.v[COL.playoffs]}`);
      // And the title goes to somebody else entirely.
      c.ok('the title favourite and the wooden spoon are different teams',
        topTitle.cells[0] !== spoon.cells[0], `${topTitle.cells[0]} vs ${spoon.cells[0]}`);
      // Topping the table does not win it: the two headline names differ here,
      // which is the confusion the split exists to make visible.
      c.ok('topping the table and winning the title are separately reported',
        topTable.cells[0] !== topTitle.cells[0] ||
        Math.abs(Number(topTable.v[COL.first]) - Number(topTitle.v[COL.title])) > 0.01,
        `${topTable.cells[0]}@${topTable.v[COL.first]} vs ${topTitle.cells[0]}@${topTitle.v[COL.title]}`);
    }

    // ---- the selected team's place distribution ---------------------------
    const simSvg = $('simChart').querySelector('svg');
    const simBars = simSvg ? Array.from(simSvg.querySelectorAll('path.ff-bar')) : [];
    c.ok('place distribution is charted', Boolean(simSvg) && simBars.length > 0, `${simBars.length} bars`);
    const placeTotal = simBars.reduce((a, b) => {
      const m = /:\s*([\d.,]+)$/.exec(txt(b.querySelector('title')));
      return a + (m ? Number(m[1].replace(/,/g, '')) : 0);
    }, 0);
    c.ok('charted place probabilities sum to ~100%', Math.abs(placeTotal - 100) < 1.5,
      `sum = ${placeTotal.toFixed(2)}`);
    c.ok('place chart y axis is labelled Chance (%)',
      /Chance \(%\)/.test(simSvg ? simSvg.textContent : ''), '');
    c.ok('place chart bins are finishing places',
      simBars.length > 0 && simBars.every((b) => /^\d+(st|nd|rd|th):/.test(txt(b.querySelector('title')))),
      simBars.map((b) => txt(b.querySelector('title'))).slice(0, 3).join(' | '));
    c.ok('chart caption names the team it is about', txt($('simCap')).includes(picked), txt($('simCap')));

    // ---- THE CHART IS THE FINAL PLACING, NOT THE LEAGUE TABLE --------------
    //
    // This is the assertion the whole change exists for, and it is checkable on
    // the page without trusting a word of the note, because three of the
    // placing's entries are also columns in the table beside it:
    //
    //   P(1st)      == Title %      the champion finishes 1st, by definition
    //   P(last)     == Last %       the teams outside the bracket keep their
    //                               table order, so the worst of them is last
    //   P(1st..6th) == Playoffs %   the six qualifiers fill places 1-6
    //
    // Under the old behaviour the first of those would have been "1st in
    // table %" instead, and in this season those two columns differ — so this
    // cannot pass by accident.
    const myChartRow = simRows.find((r) => r.cells[0] === picked);
    // The page's own ordinal, re-derived rather than imported, so a change to
    // the page's spelling of "10th" is caught here instead of silently making
    // the lookup below miss and compare against a zero.
    const ordinalOf = (v) => {
      const s = v % 100;
      const suffix = s >= 11 && s <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th';
      return `${v}${suffix}`;
    };
    const barPct = (label) => {
      const bar = simBars.find((b) => txt(b.querySelector('title')).startsWith(`${label}:`));
      if (!bar) return 0;   // a zero bar is not drawn at all
      const m = /:\s*([\d.,]+)$/.exec(txt(bar.querySelector('title')));
      return m ? Number(m[1].replace(/,/g, '')) : 0;
    };
    // The bar carries one decimal place of per cent; the cell carries the raw
    // probability. Compare on the bar's precision, which is 0.05 points.
    const cellPct = (i) => Number(myChartRow.v[i]) * 100;
    c.ok('P(finishing 1st) on the chart is the team’s Title %, not its 1st-in-table %',
      myChartRow && Math.abs(barPct('1st') - cellPct(COL.title)) < 0.06,
      `chart ${barPct('1st')} vs title ${cellPct(COL.title)} / table ${cellPct(COL.first)}`);
    c.ok('P(finishing last) on the chart is the team’s Last %',
      myChartRow && Math.abs(barPct(ordinalOf(nTeams)) - cellPct(COL.last)) < 0.06,
      `chart ${barPct(ordinalOf(nTeams))} vs cell ${cellPct(COL.last)}`);
    const topSix = simBars
      .map((b) => txt(b.querySelector('title')))
      .filter((t) => {
        const n = Number(/^(\d+)/.exec(t)[1]);
        return n >= 1 && n <= fieldSize;
      })
      .reduce((a, t) => a + Number((/:\s*([\d.,]+)$/.exec(t) || [0, 0])[1].replace(/,/g, '')), 0);
    // Summed over `fieldSize` bars, so the tolerance is that many bars' worth of
    // the chart's one-decimal rounding rather than one bar's.
    c.ok('P(finishing in the playoff places) on the chart is the team’s Playoffs %',
      myChartRow && Math.abs(topSix - cellPct(COL.playoffs)) < 0.05 * fieldSize + 1e-6,
      `chart ${topSix} vs cell ${cellPct(COL.playoffs)}`);
    // And the two must be able to disagree, or the check above proves nothing.
    c.ok('the selected team’s Title % and 1st-in-table % are not the same number',
      myChartRow && Math.abs(cellPct(COL.title) - cellPct(COL.first)) > 0.5,
      `${cellPct(COL.title)} vs ${cellPct(COL.first)}`);

    // ---- headline numbers -------------------------------------------------
    const simStats = Array.from($('simStats').querySelectorAll('.stat')).map((s) => ({
      k: txt(s.querySelector('.k')), v: txt(s.querySelector('.v')), who: txt(s.querySelector('.who')),
    }));
    const statBy = (k) => simStats.find((s) => s.k === k);
    c.ok('six headline numbers', simStats.length === 6, JSON.stringify(simStats));
    // "Wins the title" and "Tops the table" are separate headlines and neither
    // borrows the other's word. Tim's rule: the title is who wins the league.
    c.ok('headline names who wins the TITLE most',
      statBy('Wins the title most') && teamNames.includes(statBy('Wins the title most').who),
      JSON.stringify(simStats[0]));
    c.ok('headline names who tops the table most',
      statBy('Tops the table most') && teamNames.includes(statBy('Tops the table most').who),
      JSON.stringify(simStats[1]));
    c.ok('no headline calls topping the table a title',
      !simStats.some((s) => /table/i.test(s.k) && /title/i.test(s.k)) &&
      !simStats.some((s) => s.k === 'Wins the season most'),
      simStats.map((s) => s.k).join(' | '));
    c.ok('headline names who finishes last most',
      statBy('Finishes last most') && teamNames.includes(statBy('Finishes last most').who),
      JSON.stringify(simStats[2]));
    c.ok('every headline carries a probability',
      simStats.every((s) => pctOf(s.v) !== null), JSON.stringify(simStats));

    const bestTitle = simRows.slice().sort((a, b) => Number(b.v[COL.title]) - Number(a.v[COL.title]))[0];
    const bestFirst = simRows.slice().sort((a, b) => Number(b.v[COL.first]) - Number(a.v[COL.first]))[0];
    const worstLast = simRows.slice().sort((a, b) => Number(b.v[COL.last]) - Number(a.v[COL.last]))[0];
    c.ok('headline title favourite is the table’s highest title %',
      statBy('Wins the title most') && bestTitle.cells[0] === statBy('Wins the title most').who,
      `${bestTitle.cells[0]} vs ${statBy('Wins the title most') && statBy('Wins the title most').who}`);
    c.ok('headline table-topper is the table’s highest first-in-the-table %',
      statBy('Tops the table most') && bestFirst.cells[0] === statBy('Tops the table most').who,
      `${bestFirst.cells[0]} vs ${statBy('Tops the table most') && statBy('Tops the table most').who}`);
    c.ok('headline wooden spoon is the table’s highest last %',
      statBy('Finishes last most') && worstLast.cells[0] === statBy('Finishes last most').who,
      `${worstLast.cells[0]} vs ${statBy('Finishes last most') && statBy('Finishes last most').who}`);

    const myRow = simRows.find((r) => r.cells[0] === picked);
    const own = ['Title chance', 'Makes the playoffs', 'Last-place chance'];
    c.ok('headline shows the selected team’s own chances',
      own.every((k) => statBy(k) && statBy(k).who === picked),
      JSON.stringify(simStats.slice(3)));
    c.ok('selected team’s headline chances match its row',
      myRow &&
      myRow.cells[COL.title] === statBy('Title chance').v &&
      myRow.cells[COL.playoffs] === statBy('Makes the playoffs').v &&
      myRow.cells[COL.last] === statBy('Last-place chance').v,
      myRow ? `${myRow.cells[COL.title]}/${myRow.cells[COL.playoffs]}/${myRow.cells[COL.last]} vs ` +
              `${statBy('Title chance').v}/${statBy('Makes the playoffs').v}/${statBy('Last-place chance').v}`
            : 'no row');
    c.ok('the selected team’s row is marked',
      simRows.filter((r) => /\bpicked\b/.test(r.cls)).length === 1 &&
      /\bpicked\b/.test((myRow || {}).cls || ''),
      simRows.map((r) => `${r.cells[0]}:${r.cls}`).join(','));

    // ---- it must agree with the forecast panel it sits under ---------------
    const expStat = Array.from($('forecastStats').querySelectorAll('.stat'))
      .find((s) => /^Expected wins/.test(txt(s)));
    const expected = expStat ? Number(txt(expStat).replace('Expected wins', '')) : null;
    c.ok('simulated projected wins agree with the forecast panel’s expected wins',
      myRow && expected !== null && Math.abs(Number(myRow.v[1]) - expected) < 0.15,
      `sim ${myRow && myRow.v[1]} vs forecast ${expected}`);

    // ---- the honesty the panel is required to carry ------------------------
    c.ok('note says it is counted, not solved',
      /counted from a simulation, not solved for/.test(simNote) &&
      /played out [\d,]+ times/.test(simNote), simNote);
    c.ok('note states how many runs', /played out 10,000 times/.test(simNote), simNote);
    c.ok('note says there is no closed form', /no closed form for a final placing/.test(simNote), simNote);

    // ---- the bracket, stated on screen --------------------------------------
    //
    // Tim's settings say six teams and his prose said four. The settings win,
    // and the number has to be VISIBLE so a wrong one is caught by reading the
    // page rather than by reading the code.
    c.ok('note states the field size and the league size',
      /\d+ of \d+ teams make the playoffs/.test(simNote), simNote);
    c.ok('note states the number of rounds and how long each is',
      /\d+ rounds? of one week each/.test(simNote), simNote);
    c.ok('note names the weeks the rounds fall in', /in weeks? [\d, ]+ —/.test(simNote), simNote);
    c.ok('note says who gets a bye',
      /top \d+ seeds? skip round one/.test(simNote) || /every qualifier plays every round/.test(simNote),
      simNote);
    c.ok('note says how the seeds are decided',
      /Seeding is the regular-season table/.test(simNote) &&
      /worked out fresh in every simulated season/.test(simNote), simNote);
    c.ok('note says the bracket does not reseed', /reseeding off/.test(simNote), simNote);
    c.ok('note states the playoff tie rule',
      /tied playoff game is won by the higher seed/.test(simNote) &&
      /ESPN’s own rule/.test(simNote), simNote);
    c.ok('note says the consolation ladder is not modelled',
      /consolation ladder is deliberately not modelled/.test(simNote), simNote);

    // The two facts, named apart, in the words Tim used.
    c.ok('note defines Title % as the championship round',
      /“Title %” is winning the championship round/.test(simNote), simNote);
    c.ok('note defines 1st in table as a DIFFERENT question',
      /is a different question: finishing first in the regular-season standings/.test(simNote), simNote);
    c.ok('note says last place is the regular season, not the playoffs',
      /“Last %” is last in the regular-season table/.test(simNote) &&
      /not last in the playoffs and not the consolation ladder/.test(simNote), simNote);
    // The old sentence must be gone: the panel used to say first place WAS the
    // answer and that no playoffs existed. Both are now false.
    c.ok('note no longer claims no playoffs are modelled',
      !/no playoffs are modelled/i.test(simNote), simNote);
    c.ok('note never calls first place the title',
      !/“Title %” (is|means) finishing first/i.test(simNote), simNote);

    // ---- WHERE A PLACE COMES FROM, SAID ON THE PAGE -----------------------
    //
    // "Avg place" is the number a reader acts on without asking what it counts,
    // and it used to count the regular-season table. The panel now has to say
    // which half of the placing is which, and — the part that is an assumption
    // rather than a count — that 3rd-vs-4th was decided by seed and not played.
    c.ok('note says which places come from the bracket and which from the table',
      /Where a team finishes is the bracket for places 1–\d+ and the regular-season table for \d+–\d+/
        .test(simNote), simNote);
    c.ok('note says the champion is 1st and the beaten finalist 2nd',
      /champion is 1st and the beaten finalist 2nd/.test(simNote), simNote);
    c.ok('note says the non-qualifiers keep their table place',
      /missed the bracket keeps the place the table gave them/.test(simNote), simNote);
    c.ok('note ties last place to the worst regular-season team',
      /the worst regular-season team — the same team, and the same number, as “Last %”/
        .test(simNote), simNote);
    c.ok('note flags the within-round split as an ASSUMPTION, not a result',
      /knocked out in the same round are split by seed, and that is an assumption rather than a result/
        .test(simNote), simNote);
    c.ok('note says no game separates 3rd from 4th',
      /No game played here separates 3rd from 4th/.test(simNote), simNote);
    c.ok('note says the consolation ladder is what really decides those places',
      /consolation ladder decides those in real life/.test(simNote), simNote);
    // The old reading must be gone: "1st in table" is no longer where you
    // finished, and nothing may still describe the placing as the standings.
    c.ok('note says topping the table is not finishing 1st',
      /top the table and lose a playoff game and you did not finish 1st/.test(simNote), simNote);
    c.ok('note no longer calls the placing the regular-season standings',
      !/finishes first in the regular-season standings/i.test(simNote), simNote);
    // The chart's caption has to carry it too — the chart is read on its own.
    c.ok('chart caption says which places come from the bracket',
      /Places 1–\d+ are the playoff bracket; \d+–\d+ are the regular-season table/
        .test(txt($('simCap'))), txt($('simCap')));

    // Where the playoff scores came from, stated either way — the house rule is
    // that a derived number says what it was derived from.
    c.ok('note states the basis of the playoff weeks',
      /Each playoff round is scored from ESPN’s own projection/.test(simNote) ||
      /drawn from its own average projection/.test(simNote) ||
      /drawn from each side’s average projection/.test(simNote), simNote);
    c.ok('note states the points tiebreak',
      /wins first and total points scored second/.test(simNote) &&
      /league’s own tiebreak/.test(simNote), simNote);
    c.ok('note reuses the shared scoring-spread caveat',
      /not published by ESPN/.test(simNote) && /per-team scoring spread/.test(simNote), simNote);
    c.ok('note never calls the odds ESPN’s', !/ESPN[’']s odds/i.test(simNote), simNote);
    c.ok('note quotes the counting noise', /Counting noise: at [\d,]+ runs/.test(simNote), simNote);
    c.ok('run count control defaults to 10,000',
      txt($('simRuns').querySelector('button.on')) === '10,000', txt($('simRuns')));
    c.ok('run count control offers four choices, including the 100,000 Tim asked for',
      $('simRuns').querySelectorAll('button[data-runs]').length === 4 &&
      Boolean($('simRuns').querySelector('button[data-runs="100000"]')),
      [...$('simRuns').querySelectorAll('button')].map((b) => b.getAttribute('data-runs')).join(','));
    // Named rather than counted. The point of this assertion is that the
    // simulation must not grow a SECOND team picker beside the forecast's —
    // two of them disagreeing about whose season is on screen was the risk.
    // Counting every <select> on the page made it fail the moment an unrelated
    // control arrived (the time machine's week picker), which told nobody
    // anything about team pickers.
    const selectIds = [...d.querySelectorAll('select')].map((s) => s.id).sort();
    c.ok('the page has exactly the three selects it should, and no second team picker',
      JSON.stringify(selectIds) ===
        JSON.stringify(['asOfSelect', 'forecastTeam', 'weekSelect']),
      selectIds.join(','));
  }

  if (scenario === 'live' || scenario === 'live-pickteam') {
    const simRows = rowsOf($('simTable'));
    c.ok('the owner’s row is marked in the simulated table',
      simRows.filter((r) => /\bme\b/.test(r.cls)).length === 1,
      simRows.map((r) => `${r.cells[0]}:${r.cls}`).join(','));
  }

  if (scenario === 'demo') {
    c.ok('demo note says which week the simulation runs from',
      /simulates it forward from week \d+/.test(txt($('simNote'))), txt($('simNote')));
    c.ok('demo note ties the panel to the forecast above',
      /the same as-of point the forecast panel above uses/.test(txt($('simNote'))), txt($('simNote')));
  }

  if (scenario === 'live-rosterfail') {
    const simEmpty = $('simTable').querySelector('tr.empty-row');
    c.ok('simulation states there is nothing to play out',
      simEmpty && /no projection to put against any of them/.test(txt(simEmpty)), txt(simEmpty));
    c.ok('simulation note names the cause and a fix',
      /rosters could not be read/.test(txt($('simNote'))) && /Reload the page/.test(txt($('simNote'))),
      txt($('simNote')));
    c.ok('no place chart is drawn', $('simChart').querySelectorAll('svg').length === 0);
    c.ok('no headline numbers are invented', txt($('simStats')) === '', txt($('simStats')));
  }

  // ---- (f): what re-runs the simulation and what merely repaints ----------
  // ---- the time machine ---------------------------------------------------
  //
  // ESPN keeps no history of its own projections, so a forecast that is not
  // captured while it is on screen cannot be recovered. These assertions are
  // about the two halves of that: a reading really is taken, and putting one
  // back really does show what it holds rather than what is live.
  if (scenario === 'archive') {
    const a = globalThis.__arch || {};

    // ---- a reading is taken, on its own, without being asked -------------
    c.ok('booting a live league records a reading by itself',
      a.keys && a.keys.length >= 1, JSON.stringify(a.keys));
    c.ok('and it is filed under this league and season',
      a.keys && a.keys.every((k) => k.startsWith('ff.snap.99.2026.')), JSON.stringify(a.keys));
    c.ok('the reading knows which week it is a view as of',
      a.auto && Number.isFinite(a.auto.week), a.auto && a.auto.week);
    c.ok('and when it was taken',
      a.auto && !Number.isNaN(new Date(a.auto.takenAt).getTime()), a.auto && a.auto.takenAt);
    c.ok('it carries the whole schedule, results included',
      a.auto && Array.isArray(a.auto.games) && a.auto.games.length > 0,
      a.auto && a.auto.games && a.auto.games.length);
    c.ok('and a projected total per team per remaining week',
      a.auto && Object.keys(a.auto.proj || {}).length > 0,
      a.auto && Object.keys(a.auto.proj || {}).join(','));
    // THE PLAYOFF WEEKS RIDE ALONG IN THE SAME MAP, which is the only reason
    // the time machine can replay a bracket at all: js/snapshots.js stores
    // whatever weeks `proj` holds, so the bracket needed no change there. A
    // reading missing them would replay as a MODELLED bracket while the live
    // page showed a projected one — the same reading giving two answers.
    c.ok('a reading carries the playoff weeks too, so a replayed bracket is the projected one',
      a.auto && [14, 15, 16].every((w) => Object.keys(a.auto.proj || {}).includes(String(w))),
      a.auto && Object.keys(a.auto.proj || {}).join(','));
    c.ok('and every team is in each playoff week',
      a.auto && [14, 15, 16].every((w) => Object.keys(a.auto.proj[w] || {}).length === 10),
      a.auto && [14, 15, 16].map((w) => Object.keys(a.auto.proj[w] || {}).length).join(','));
    // Sigma moves as results come in, so replaying without it would re-forecast
    // the past with knowledge it did not have.
    c.ok('and the scoring spread that was in force',
      a.auto && (typeof a.auto.sigma === 'number'), a.auto && a.auto.sigma);
    c.ok('a reading is small enough to keep a season of',
      a.auto && JSON.stringify(a.auto).length < 60000,
      a.auto && JSON.stringify(a.auto).length);

    // ---- while live, the page says it is live ----------------------------
    c.ok('the live page is not wearing the archive badge',
      a.live && a.live.badge === 'Live' && !/archive/.test(a.live.badgeCls),
      a.live && `${a.live.badge} / ${a.live.badgeCls}`);
    c.ok('and the banner is hidden', a.live && a.live.bannerHidden, a.live && a.live.banner);
    c.ok('and the picker is on "Right now"', a.live && a.live.asOf === 'live', a.live && a.live.asOf);
    c.ok('and there is no delete button to press', a.live && a.live.deleteHidden);
    c.ok('the recorded week is offered in the picker',
      a.live && a.auto && a.live.options.includes(String(a.auto.week)),
      a.live && a.live.options.join(','));
    c.ok('the panel explains why the archive has to exist at all',
      a.live && /keeps no record of what it/.test(a.live.status), a.live && a.live.status.slice(0, 200));
    c.ok('and says where readings are taken and where they are kept',
      a.live && /taken in this browser/.test(a.live.status) &&
      /kept in the site/.test(a.live.status),
      a.live && a.live.status.slice(0, 400));
    // The one thing the reader has to act on, and the panel works it out
    // rather than leaving it to them. Nothing is committed in this scenario, so
    // the reading just taken must be named as existing only here.
    // Checked against the VISIBLE state line, not the tucked explanation.
    c.ok('an un-backed-up week is named, not left to be noticed',
      a.live && /exists? only in this browser/.test(a.live.state) &&
      /Export archive/.test(a.live.state),
      a.live && a.live.state);
    c.ok('and the panel says outright that exporting is not a weekly job',
      a.live && /not a weekly job/.test(a.live.state),
      a.live && a.live.state);
    // Schema 2 (AUDIT §2.3) keeps your roster and the other starters, so the
    // panel says exactly that much and that the rest is not kept.
    c.ok('and says which player numbers it keeps',
      a.live && /your own roster’s projection for every week/.test(a.live.status) &&
        /other squad’s starters/.test(a.live.status),
      a.live && a.live.status.slice(-300));
    c.ok('and says what it does NOT keep',
      a.live && /rest of the rosters are not kept/.test(a.live.status),
      a.live && a.live.status.slice(-300));

    // ---- REPLAY SHOWS THE ARCHIVE, NOT THE LIVE PAGE ---------------------
    //
    // The doctored reading's projections are all 200-something and its spread
    // is 5. Neither is a number the live page could produce, so their arrival
    // on screen proves the panels were rebuilt from storage.
    c.ok('replaying puts the page in archive mode',
      a.replayed && /archive/.test(a.replayed.badgeCls) && /Week 1/.test(a.replayed.badge),
      a.replayed && `${a.replayed.badge} / ${a.replayed.badgeCls}`);
    c.ok('and says so loudly, not just in the badge',
      a.replayed && !a.replayed.bannerHidden &&
      /looking at the season as of week 1/.test(a.replayed.banner),
      a.replayed && a.replayed.banner.slice(0, 200));
    c.ok('the banner names when the reading was taken',
      a.replayed && /2026/.test(a.replayed.banner), a.replayed && a.replayed.banner.slice(0, 200));
    c.ok('the sub-heading stops claiming to be current',
      a.replayed && /as the app saw it in week 1/.test(a.replayed.sub), a.replayed && a.replayed.sub);
    c.ok('a delete button appears for the week being viewed',
      a.replayed && !a.replayed.deleteHidden);

    const flat = (rows) => (rows || []).map((r) => r.join('|')).join('\n');
    c.ok('THE FORECAST IS REBUILT FROM THE READING, not from live data',
      /\b2\d\d(\.\d)?\b/.test(flat(a.replayed && a.replayed.forecast)),
      flat(a.replayed && a.replayed.forecast).slice(0, 300));
    c.ok('and it is genuinely different from what was live a moment ago',
      flat(a.replayed && a.replayed.forecast) !== flat(a.live && a.live.forecast),
      'the forecast did not change when the archive was opened');
    c.ok('the simulation is re-run against the reading too',
      flat(a.replayed && a.replayed.sim) !== flat(a.live && a.live.sim),
      'the simulated table did not change');
    c.ok('and the stored spread is used, not today’s',
      a.replayed && /5\.0-point|5-point/.test(a.replayed.forecastNote),
      a.replayed && a.replayed.forecastNote.slice(0, 400));

    // ---- THE WHOLE ROUND TRIP COSTS NOTHING ------------------------------
    //
    // A reading is complete, so going back in time must never send the page off
    // to ESPN — which could not answer the question anyway, since it keeps no
    // history. Coming back must not either: returning to now used to reload,
    // which cost a schedule call plus one per remaining week every time
    // somebody flicked out of the archive, and this scenario is what caught it.
    // Read from the stub's own call log, because the raw `fetch` is never
    // reached in a stubbed scenario and asserting on it would pass vacuously.
    {
      const season = await import('./fc-stub-season.mjs');
      c.ok('OPENING AND LEAVING THE ARCHIVE ADDS NO SCHEDULE FETCH',
        season.calls.schedule === 1, `saw ${season.calls.schedule}`);
      c.ok('AND NO EXTRA ROSTER REQUESTS',
        season.calls.rosters.length === 16, `saw ${season.calls.rosters.length}`);
    }

    // ---- and back to now -------------------------------------------------
    c.ok('choosing "Right now" leaves archive mode',
      a.back && !/archive/.test(a.back.badgeCls), a.back && a.back.badgeCls);
    c.ok('the banner goes with it', a.back && a.back.bannerHidden, a.back && a.back.banner);
    c.ok('and the live numbers come back',
      flat(a.back && a.back.forecast) === flat(a.live && a.live.forecast),
      'the page did not return to what it was showing before');
    c.ok('the archived week is still in the picker afterwards',
      a.back && a.back.options.includes('1'), a.back && a.back.options.join(','));
    c.ok('leaving archive mode did not delete anything',
      a.back && a.auto && a.back.options.includes(String(a.auto.week)),
      a.back && a.back.options.join(','));
  }

  if (scenario === 'sim-interact') {
    const s = globalThis.__sim || {};
    const { before, duringTeam, afterTeam, duringRuns, afterRuns } = s;

    c.ok('the panel simulated on load', before && before.rows.length === 10, `${before && before.rows.length} rows`);

    // Switching team: the cached run is reused, so the table is still on
    // screen in the same tick the change was dispatched.
    c.ok('switching team does not blank the table',
      duringTeam && duringTeam.rows.length === 10 && duringTeam.empty === '',
      duringTeam && duringTeam.empty);
    c.ok('switching team never shows the simulating state',
      duringTeam && !/Simulating/.test(duringTeam.empty) && !/Playing the/.test(duringTeam.note),
      duringTeam && duringTeam.note);
    c.ok('switching team leaves every simulated number untouched',
      JSON.stringify(afterTeam.rows) === JSON.stringify(before.rows),
      `${JSON.stringify(before.rows[0])} vs ${JSON.stringify(afterTeam.rows[0])}`);
    c.ok('switching team leaves the note untouched', afterTeam.note === before.note, afterTeam.note);
    c.ok('switching team redraws the chart for the new team',
      JSON.stringify(afterTeam.bars) !== JSON.stringify(before.bars),
      JSON.stringify(afterTeam.bars).slice(0, 160));
    c.ok('the caption follows the new team',
      afterTeam.cap.includes(s.pickedName) && !before.cap.includes(s.pickedName),
      `${before.cap} -> ${afterTeam.cap}`);

    // Changing the run count: the answer itself changes, so it must re-run,
    // and it must say so before it starts rather than freezing.
    c.ok('changing the run count shows a simulating state first',
      duringRuns && /Simulating 50,000 seasons/.test(duringRuns.empty), duringRuns && duringRuns.empty);
    c.ok('the simulating state says what it is doing',
      duringRuns && /Playing the \d+ remaining games out 50,000 times/.test(duringRuns.note),
      duringRuns && duringRuns.note);
    c.ok('the run lands and refills the table',
      afterRuns && afterRuns.rows.length === 10 && afterRuns.empty === '', afterRuns && afterRuns.empty);
    c.ok('the note reports the new run count',
      afterRuns && /played out 50,000 times/.test(afterRuns.note) &&
      /Counting noise: at 50,000 runs/.test(afterRuns.note), afterRuns && afterRuns.note);
    c.ok('the control marks the new run count', JSON.stringify(afterRuns.on) === '["50,000"]',
      JSON.stringify(afterRuns.on));
    c.ok('more runs sharpens the numbers rather than repeating them',
      JSON.stringify(afterRuns.rows) !== JSON.stringify(before.rows), 'identical');

    // ---- 100,000 runs, the count Tim asked for -----------------------------
    const { duringBig, afterBig } = s;
    c.ok('100,000 runs shows the simulating state rather than freezing',
      duringBig && /Simulating 100,000 seasons/.test(duringBig.empty), duringBig && duringBig.empty);
    // The proof that the work was HANDED OFF: the table was blanked and the
    // waiting sentence painted inside the same tick as the click. If the run
    // had gone inline, this snapshot would already hold the finished table and
    // the browser would have spent a second and a half unable to paint.
    c.ok('the hand-off happens before any of the work does',
      duringBig && duringBig.rows.length === 1 &&      // the empty row, and nothing else
      /Playing the \d+ remaining games out 100,000 times/.test(duringBig.note),
      duringBig && `${duringBig.rows.length} rows — ${duringBig.note}`);
    c.ok('100,000 runs lands and refills the table',
      afterBig && afterBig.rows.length === 10 && afterBig.empty === '', afterBig && afterBig.empty);
    c.ok('the note reports 100,000 runs and the sharper noise figure',
      afterBig && /played out 100,000 times/.test(afterBig.note) &&
      /Counting noise: at 100,000 runs a percentage here is good to roughly ±0\.3/.test(afterBig.note),
      afterBig && afterBig.note);
    c.ok('the control marks 100,000', JSON.stringify(afterBig.on) === '["100,000"]',
      JSON.stringify(afterBig.on));
    c.ok('the bracket survives the bigger run',
      afterBig && /6 of 10 teams make the playoffs/.test(afterBig.note), afterBig && afterBig.note);
    // Measured, not assumed: the panel's own note promises the run count is a
    // wait rather than a hang, and 100,000 seasons with a three-round bracket
    // is the slowest thing this page can be asked to do. Generous here because
    // linkedom and a loaded CI box are both slower than a browser, but a
    // regression that made it minutes would be caught.
    c.ok('100,000 runs with a bracket lands in seconds, not minutes',
      s.bigMs > 0 && s.bigMs < 10000, `${s.bigMs}ms`);
    c.ok('the run count is remembered', /"schedule.runs":100000/.test(s.prefs || ''), s.prefs);
  }

  // ---- every game carries a chance, and the pair sums to 100 --------------
  //
  // THIS USED TO READ THE RESULTS TABLE, which printed one "Home win" cell per
  // fixture. That panel was deleted on 2026-09-23 as an ESPN screen, so the
  // check is re-aimed at the Week matchups cards, which print the same fixture
  // from the same `homeWinChance()`. The property is unchanged and so is what
  // makes it worth asserting: the cards and the forecast table reach a win
  // chance by two different routes — the cards through projectedPoints() for
  // each side of a game, the forecast through the row's own mine/theirs — so
  // the two agreeing IS "the two sides of a matchup sum to 100".
  if (scenario === 'live') {
    // The page is on "All weeks", so every fixture of the season is a card
    // inside a .week-block headed by its week number.
    const cardGames = [];
    for (const block of d.querySelectorAll('.week-block')) {
      const wk = Number((txt(block.querySelector('.week-head')).match(/\d+/) || [])[0]);
      if (!Number.isFinite(wk)) continue;
      for (const game of block.querySelectorAll('.game.upcoming')) {
        const home = txt(game.querySelector('.side.home .tname'));
        const away = txt(game.querySelector('.side.away .tname'));
        const meta = txt(game.querySelector('.gmeta'));
        const pct = pctOf((meta.split('·').pop() || '').trim());
        if (pct === null) { cardGames.push({ wk, home, away, p: null, meta }); continue; }
        // The card prints the FAVOURITE's chance, so it has to be turned back
        // into the home side's before it can be paired with anything.
        const p = /^Level /.test(meta) ? 50
          : meta.startsWith(`${home} by `) ? pct
            : meta.startsWith(`${away} by `) ? 100 - pct
              : null;
        cardGames.push({ wk, home, away, p, meta });
      }
    }
    c.ok('matchup cards cover the upcoming season', cardGames.length >= 55, `${cardGames.length}`);
    c.ok('every upcoming card has a home win %',
      cardGames.every((g) => g.p !== null),
      JSON.stringify(cardGames.filter((g) => g.p === null).slice(0, 3)));
    c.ok('home win % in 0-100', cardGames.every((g) => g.p >= 0 && g.p <= 100));
    // A decided card shows the winner and the margin, never a forecast.
    const decided = [...d.querySelectorAll('.game.final .gmeta')].map((e) => txt(e));
    c.ok('decided cards carry no forecast',
      decided.length > 0 && decided.every((m) => !/%/.test(m)),
      `${decided.length}: ${decided.slice(0, 2).join(' | ')}`);

    // Pair up: my rows in the forecast table against the same game's home %.
    const homeByWeek = new Map();
    for (const g of cardGames) {
      if (!homeByWeek.has(g.wk)) homeByWeek.set(g.wk, []);
      homeByWeek.get(g.wk).push(g);
    }
    let pairs = 0;
    let bad = [];
    for (const r of fcRows) {
      const wk = Number(r.cells[0]);
      const opp = r.cells[1];
      const iAmHome = r.cells[2] === 'Home';
      const g = (homeByWeek.get(wk) || []).find((x) => (iAmHome ? x.away === opp : x.home === opp));
      if (!g) continue;
      const mine = pctOf(r.cells[5]);
      const fromCard = iAmHome ? g.p : 100 - g.p;
      pairs++;
      // 2 points, not 1: both numbers are rounded to a whole per cent, and the
      // card's is rounded on the FAVOURITE's side before being turned over, so
      // a single fixture can legitimately carry two half-point roundings.
      if (Math.abs(mine - fromCard) > 2.01) {
        bad.push(`wk${wk} mine=${mine} card=${g.p} (${iAmHome ? 'home' : 'away'}) "${g.meta}"`);
      }
    }
    c.ok('matchup percentages pair to 100', pairs >= 10 && bad.length === 0, `${pairs} pairs, bad: ${bad.join(', ')}`);

    // The card prints the margin and the percentage as one statement, so they
    // can never point opposite ways.
    const metas = cardGames.map((g) => g.meta);
    c.ok('upcoming cards show a win %', metas.length > 0 && metas.every((m) => /\d+%$|<1%$|>99%$/.test(m)), metas.slice(0, 3).join(' | '));
    c.ok('card and margin agree in direction',
      metas.every((m) => /by \d+(\.\d)? · (\d+%|<1%|>99%)$/.test(m) || /^Level · 50%$/.test(m)),
      metas.slice(0, 3).join(' | '));

    c.ok('matchups note carries the caveat', /not published by ESPN/.test(txt($('matchupsNote'))), txt($('matchupsNote')));

    // ---- byes reduce a team's projection ---------------------------------
    const mine = new Map(fcRows.map((r) => [Number(r.cells[0]), Number(r.cells[3])]));
    const w9 = mine.get(9), w10 = mine.get(10), w11 = mine.get(11);
    c.ok('bye week measurably lowers the projection',
      w9 && w10 && w11 && w10 < w9 - 20 && w10 < w11 - 20,
      `wk9=${w9} wk10=${w10} wk11=${w11}`);

    // The projection is per WEEK, so it is printable as a score.
    c.ok('projections are week-sized, not season totals',
      [...mine.values()].every((v) => v > 40 && v < 260), JSON.stringify([...mine.entries()]));

    // Strength basis is the new one, stated once — in the matchups panel now
    // that there is no standings panel to carry it.
    const sn = txt($('matchupsNote'));
    c.ok('strength note names the per-week projection basis',
      /ESPN’s own projection for each week/.test(sn) && /weeks 2 to 13/.test(sn), sn);
    c.ok('strength note says the lineup is optimised, not the one set',
      /best legal lineup filled rather than the one currently set/.test(sn), sn);
    c.ok('strength note explains byes come back at zero',
      /on bye come back at zero/.test(sn), sn);
    c.ok('slots read from the lineups', /10 starters read from the current lineups/.test(sn), sn);

    c.ok('week note keeps the forecast out of the week contract',
      /The head-to-head grid and the season forecast stay season-to-date/.test(txt($('weekNote'))),
      txt($('weekNote')));

    // ---- what survived the standings table, inside "My season" -------------
    //
    // Two figures, both about the SELECTED team rather than the league: where
    // he sits now (the one row of a table that is about him) and how hard the
    // run-in is (which ESPN publishes nowhere). Anything more would be the
    // table again.
    const fcStats = Array.from($('forecastStats').querySelectorAll('.stat')).map((s) => txt(s));
    c.ok('My season shows this team’s place now',
      fcStats.some((s) => /^Place now\s?\d+(st|nd|rd|th) of 10$/.test(s)), fcStats.join(' | '));
    c.ok('and how hard its run-in is',
      fcStats.some((s) => /^Run-in\s?\d+(st|nd|rd|th) hardest of 10$/.test(s)), fcStats.join(' | '));
    c.ok('the forecast note says which order “Place now” is in, and why there is no table',
      /wins, with a tie as half a win, then points for/.test(note) &&
      /full league table is deliberately not repeated/.test(note), note);
    c.ok('and states the run-in’s basis where the run-in is shown',
      /Run-in<\/strong> ranks the average strength/.test($('forecastNote').innerHTML) &&
      /ESPN’s own projection for each week/.test(note), note);
  }

  if (scenario.startsWith('demo')) {
    c.ok('note says the demo is a backtest as of a week',
      /forecast as it stood before week \d+ was played/.test(note), note);
    c.ok('week note says the picker drives the forecast',
      /the week the forecast is made from/.test(txt($('weekNote'))), txt($('weekNote')));
    c.ok('note states the projection basis',
      /projections ESPN carried for those games/.test(note), note);
  }

  if (scenario === 'demo-mid') {
    c.ok('forecasts from week 5 onwards',
      fcRows.length > 5 && Number(fcRows[0].cells[0]) === 5,
      fcRows.map((r) => r.cells[0]).join(','));
    c.ok('banked record is not empty',
      /Banked\s*\d+–\d+/.test(txt($('forecastStats'))), txt($('forecastStats')));
    c.ok('spread is calibrated from banked games',
      /measured from \d+ completed team-weeks/.test(note), note);
  }

  if (scenario === 'demo') {
    c.ok('default demo view is not blank', fcRows.length > 0 && !empty, `${fcRows.length} rows`);
  }

  // ---- (i) which week a live reload opens on --------------------------------
  //
  // On demo a saved week is the "as of" point and never expires — `demo-mid`
  // above opens on its saved week 5, a week the sample season has played.
  if (scenario === 'demo-mid') {
    c.ok('DEMO keeps a saved week even though the sample season has played it',
      $('weekSelect').value === '5', $('weekSelect').value);
  }
  if (scenario === 'week-stale') {
    const w = globalThis.__weeks || {};
    c.ok('A SAVED WEEK THE LIVE LEAGUE HAS MOVED PAST IS DROPPED: week 2 is under way, so week 2',
      w.opened === '2', `opened on week ${w.opened}`);
    c.ok('a week picked by hand THIS visit survives a reload, played or not',
      w.reloaded === '1', `reloaded on week ${w.reloaded}`);
  }
  if (scenario === 'week-ahead') {
    c.ok('a saved week still ahead of the league is honoured',
      $('weekSelect').value === '6', $('weekSelect').value);
  }
  if (scenario === 'week-all') {
    c.ok('"All weeks" is kept', $('weekSelect').value === 'all', $('weekSelect').value);
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
    console.log('@@' + JSON.stringify({ scenario, results: [{ name: 'boot', pass: false, detail: String(err && err.stack || err) }] }));
    process.exit(1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const args = cfg.stub ? ['--import', './fc-register.mjs', self, scenario] : [self, scenario];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: path.dirname(self),
    env: { ...process.env, ...(cfg.env || {}) },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 1500)}`);
    failed++;
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   ✗ ${r.name}${r.detail ? ` — ${String(r.detail).slice(0, 500)}` : ''}`);
  failed += bad.length;
}

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
