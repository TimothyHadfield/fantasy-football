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
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all', 'schedule.results': 'all' },
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
    prefs: { 'schedule.source': 'live', 'schedule.week': 'all', 'schedule.results': 'all' },
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
        status: txt($('snapStatus')),
        // The two panels the whole feature exists for.
        forecast: [...$('forecastTable').querySelectorAll('tbody tr')]
          .map((tr) => [...tr.children].map((td) => txt(td))),
        forecastStats: txt($('forecastStats')),
        forecastNote: txt($('forecastNote')),
        sim: [...$('simTable').querySelectorAll('tbody tr')]
          .map((tr) => [...tr.children].map((td) => td.getAttribute('data-v') ?? txt(td))),
        standings: [...$('standingsTable').querySelectorAll('tbody tr')]
          .map((tr) => [...tr.children].map((td) => txt(td))),
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

      globalThis.__sim = {
        before, duringTeam, afterTeam, duringRuns, afterRuns, pickedName,
        prefs: globalThis.localStorage.getItem('ff.prefs'),
      };
    },
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
  const localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
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

  await import(pathToFileURL(path.join(REPO, 'js/schedule-page.js')).href);
  await new Promise((r) => setTimeout(r, 400));
  if (cfg.after) await cfg.after({ document, window, CustomEvent: window.CustomEvent });
  console.error = origError;

  return { document, errors, fetchCalls, rejections, cfg };
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

/** "62%" | "<1%" | ">99%" | "—" -> number or null */
function pctOf(text) {
  const s = String(text || '').trim();
  if (s === '—' || s === '') return null;
  if (s === '<1%') return 0.4;
  if (s === '>99%') return 99.6;
  const m = /^(\d+)%$/.exec(s);
  return m ? Number(m[1]) : null;
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

function rowsOf(table) {
  return Array.from(table.querySelectorAll('tbody tr')).map((tr) => ({
    tr,
    cls: tr.getAttribute('class') || '',
    cells: Array.from(tr.children).map((td) => txt(td)),
    v: Array.from(tr.children).map((td) => td.getAttribute('data-v')),
  }));
}

async function check(scenario, boot) {
  const c = makeChecker();
  const d = boot.document;
  const $ = (id) => d.getElementById(id);

  c.ok('no console errors', boot.errors.length === 0, boot.errors.slice(0, 2).join(' | '));
  c.ok('no unhandled rejections', boot.rejections.length === 0, boot.rejections.slice(0, 2).join(' | '));
  // The page makes exactly ONE raw fetch of its own, and only on a live league:
  // the archive committed under data/snapshots/, which is what lets a cleared
  // browser restore its history. Everything else goes through js/season.js and
  // is counted below. A blanket "no network calls" hid which call was which, so
  // this names the one that is allowed and still fails on any other.
  const ARCHIVE = /^data\/snapshots\/[^/]+\.json$/;
  const archiveCalls = boot.fetchCalls.filter((u) => ARCHIVE.test(u));
  const unexpected = boot.fetchCalls.filter((u) => !ARCHIVE.test(u));
  c.ok('no unexpected network calls', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
  c.ok('the committed archive is asked for at most once',
    archiveCalls.length <= 1, archiveCalls.join(' | '));
  if (!boot.cfg.stub) {
    // Sample data has no league, so there is nothing committed to ask for and
    // asking would be a guaranteed 404 on every demo page load.
    c.ok('demo asks for no archive at all', archiveCalls.length === 0, archiveCalls.join(' | '));
  } else {
    c.ok('a live league does look for a committed archive',
      archiveCalls.length === 1, boot.fetchCalls.join(' | '));
  }

  // ---- request budget, for the stubbed live scenarios ---------------------
  if (boot.cfg.stub) {
    const season = await import('./fc-stub-season.mjs');
    const espn = await import('./fc-stub-espn.mjs');
    c.ok('one fetchSchedule', season.calls.schedule === 1, `saw ${season.calls.schedule}`);
    // ESPN publishes a per-week projection for every future week but has no
    // bulk form, so the cost is one request per REMAINING week -- weeks 2..13
    // here -- and never a played week, which would be wasted.
    const got = season.calls.rosters.slice().sort((a, b) => a - b);
    c.ok('one roster request per remaining week', JSON.stringify(got) === JSON.stringify([2,3,4,5,6,7,8,9,10,11,12,13]),
      `saw ${JSON.stringify(season.calls.rosters)}`);
    c.ok('no played week refetched', !season.calls.rosters.includes(1), `saw ${JSON.stringify(season.calls.rosters)}`);
    // Byes arrive inside the weekly projections (a bye player is projected 0),
    // so the separate bye-week request is gone.
    c.ok('bye weeks never fetched separately', espn.calls.byes === 0, `saw ${espn.calls.byes}`);
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
    c.ok('switching teams triggers no extra roster reads',
      season.calls.rosters.length === 12, `saw ${season.calls.rosters.length}`);
  }

  // ---- (d): roster fetch rejected ----------------------------------------
  if (scenario === 'live-rosterfail') {
    c.ok('forecast states there is nothing to forecast from', empty && /no projection to put against/i.test(txt(empty)), txt(empty));
    c.ok('note names the cause and a fix', /rosters could not be read/.test(note) && /Reload the page/.test(note), note);
    c.ok('standings still fall back', /points per game so far/.test(txt($('standingsNote'))), txt($('standingsNote')));
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

    // Exactly one team finishes first in every simulated season, and exactly
    // one finishes last, so both columns are complete distributions.
    const sumFirst = simRows.reduce((a, r) => a + Number(r.v[4]), 0);
    const sumLast = simRows.reduce((a, r) => a + Number(r.v[5]), 0);
    c.ok('title chances sum to 100%', Math.abs(sumFirst - 1) < 0.005, String(sumFirst));
    c.ok('last-place chances sum to 100%', Math.abs(sumLast - 1) < 0.005, String(sumLast));

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

    // ---- headline numbers -------------------------------------------------
    const simStats = Array.from($('simStats').querySelectorAll('.stat')).map((s) => ({
      k: txt(s.querySelector('.k')), v: txt(s.querySelector('.v')), who: txt(s.querySelector('.who')),
    }));
    c.ok('four headline numbers', simStats.length === 4, JSON.stringify(simStats));
    c.ok('headline names who wins the season most',
      simStats[0] && simStats[0].k === 'Wins the season most' && teamNames.includes(simStats[0].who),
      JSON.stringify(simStats[0]));
    c.ok('headline names who finishes last most',
      simStats[1] && simStats[1].k === 'Finishes last most' && teamNames.includes(simStats[1].who),
      JSON.stringify(simStats[1]));
    c.ok('both headline names carry a probability',
      pctOf(simStats[0] && simStats[0].v) !== null && pctOf(simStats[1] && simStats[1].v) !== null,
      JSON.stringify(simStats.slice(0, 2)));

    const bestFirst = simRows.slice().sort((a, b) => Number(b.v[4]) - Number(a.v[4]))[0];
    const worstLast = simRows.slice().sort((a, b) => Number(b.v[5]) - Number(a.v[5]))[0];
    c.ok('headline champion is the table’s highest title %',
      simStats[0] && bestFirst.cells[0] === simStats[0].who,
      `${bestFirst.cells[0]} vs ${simStats[0] && simStats[0].who}`);
    c.ok('headline wooden spoon is the table’s highest last %',
      simStats[1] && worstLast.cells[0] === simStats[1].who,
      `${worstLast.cells[0]} vs ${simStats[1] && simStats[1].who}`);

    const myRow = simRows.find((r) => r.cells[0] === picked);
    c.ok('headline shows the selected team’s own chances',
      simStats[2] && simStats[3] && simStats[2].who === picked && simStats[3].who === picked,
      JSON.stringify(simStats.slice(2)));
    c.ok('selected team’s headline chances match its row',
      myRow && simStats[2] && myRow.cells[4] === simStats[2].v && myRow.cells[5] === simStats[3].v,
      myRow ? `${myRow.cells[4]}/${myRow.cells[5]} vs ${simStats[2].v}/${simStats[3].v}` : 'no row');
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
    c.ok('note refuses to call first place a championship',
      /finishing first in the regular-season standings/.test(simNote) &&
      /no playoffs are modelled/.test(simNote), simNote);
    c.ok('note states the points tiebreak',
      /wins first and total points scored second/.test(simNote) &&
      /league’s own tiebreak/.test(simNote), simNote);
    c.ok('note reuses the shared scoring-spread caveat',
      /not published by ESPN/.test(simNote) && /per-team scoring spread/.test(simNote), simNote);
    c.ok('note never calls the odds ESPN’s', !/ESPN[’']s odds/i.test(simNote), simNote);
    c.ok('note quotes the counting noise', /Counting noise: at [\d,]+ runs/.test(simNote), simNote);
    c.ok('run count control defaults to 10,000',
      txt($('simRuns').querySelector('button.on')) === '10,000', txt($('simRuns')));
    c.ok('run count control offers three choices',
      $('simRuns').querySelectorAll('button[data-runs]').length === 3);
    // Named rather than counted. The point of this assertion is that the
    // simulation must not grow a SECOND team picker beside the forecast's —
    // two of them disagreeing about whose season is on screen was the risk.
    // Counting every <select> on the page made it fail the moment an unrelated
    // control arrived (the time machine's week picker), which told nobody
    // anything about team pickers.
    const selectIds = [...d.querySelectorAll('select')].map((s) => s.id).sort();
    c.ok('the page has exactly the four selects it should, and no second team picker',
      JSON.stringify(selectIds) ===
        JSON.stringify(['asOfSelect', 'filterTeam', 'forecastTeam', 'weekSelect']),
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
    c.ok('and warns that until the file is committed there is only one copy',
      a.live && /the only copy is here/.test(a.live.status) &&
      /Export archive/.test(a.live.status),
      a.live && a.live.status.slice(-400));
    c.ok('and says what it does NOT keep',
      a.live && /rosters behind those numbers are not kept/.test(a.live.status),
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
        season.calls.rosters.length === 12, `saw ${season.calls.rosters.length}`);
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
    c.ok('the run count is remembered', /"schedule.runs":50000/.test(s.prefs || ''), s.prefs);
  }

  // ---- every game carries a chance, and the pair sums to 100 --------------
  if (scenario === 'live') {
    const rr = rowsOf($('resultsTable'));
    const upcoming = rr.filter((r) => r.cells[7] === 'Upcoming');
    c.ok('results table lists upcoming games', upcoming.length >= 55, `${upcoming.length}`);
    const homePcts = upcoming.map((r) => pctOf(r.cells[6]));
    c.ok('every upcoming row has a home win %', homePcts.every((p) => p !== null), JSON.stringify(upcoming.slice(0, 2).map((r) => r.cells)));
    c.ok('home win % in 0-100', homePcts.every((p) => p >= 0 && p <= 100));
    const played = rr.filter((r) => r.cells[7] !== 'Upcoming');
    c.ok('decided games carry no forecast', played.every((r) => r.cells[6] === '—'), JSON.stringify(played.slice(0, 2).map((r) => r.cells)));

    // Pair up: my rows in the forecast table against the same game's home %.
    const homeByWeek = new Map();
    for (const r of upcoming) {
      const wk = Number(r.cells[0]);
      if (!homeByWeek.has(wk)) homeByWeek.set(wk, []);
      homeByWeek.get(wk).push({ home: r.cells[1], away: r.cells[3], p: pctOf(r.cells[6]) });
    }
    let pairs = 0;
    let bad = [];
    for (const r of fcRows) {
      const wk = Number(r.cells[0]);
      const opp = r.cells[1];
      const iAmHome = r.cells[2] === 'Home';
      const g = (homeByWeek.get(wk) || []).find((x) => (iAmHome ? x.away === opp : x.home === opp));
      if (!g) continue;
      // The two tables render the two sides of the same matchup independently,
      // so agreeing here IS the "they sum to 100" property.
      const mine = pctOf(r.cells[5]);
      const fromResults = iAmHome ? g.p : 100 - g.p;
      pairs++;
      if (Math.abs(mine + (100 - fromResults) - 100) > 1.01) {
        bad.push(`wk${wk} mine=${mine} home=${g.p} (${iAmHome ? 'home' : 'away'})`);
      }
    }
    c.ok('matchup percentages pair to 100', pairs >= 10 && bad.length === 0, `${pairs} pairs, bad: ${bad.join(', ')}`);

    // Cards carry a chance too.
    const metas = Array.from(d.querySelectorAll('#matchups .game.upcoming .gmeta')).map((e) => txt(e));
    c.ok('upcoming cards show a win %', metas.length > 0 && metas.every((m) => /\d+%$|<1%$|>99%$/.test(m)), metas.slice(0, 3).join(' | '));
    c.ok('card and margin agree in direction',
      metas.every((m) => /by \d+(\.\d)? · (\d+%|<1%|>99%)$/.test(m) || /^Level · 50%$/.test(m)),
      metas.slice(0, 3).join(' | '));
    c.ok('matchups note carries the caveat', /not published by ESPN/.test(txt($('matchupsNote'))), txt($('matchupsNote')));
    c.ok('results note carries the caveat', /not published by ESPN/.test(txt($('resultsNote'))), txt($('resultsNote')));

    // ---- byes reduce a team's projection ---------------------------------
    const mine = new Map(fcRows.map((r) => [Number(r.cells[0]), Number(r.cells[3])]));
    const w9 = mine.get(9), w10 = mine.get(10), w11 = mine.get(11);
    c.ok('bye week measurably lowers the projection',
      w9 && w10 && w11 && w10 < w9 - 20 && w10 < w11 - 20,
      `wk9=${w9} wk10=${w10} wk11=${w11}`);

    // The projection is per WEEK, so it is printable as a score.
    c.ok('projections are week-sized, not season totals',
      [...mine.values()].every((v) => v > 40 && v < 260), JSON.stringify([...mine.entries()]));

    // Strength basis is the new one, stated once.
    const sn = txt($('standingsNote'));
    c.ok('strength note names the per-week projection basis',
      /ESPN’s own projection for each week/.test(sn) && /weeks 2 to 13/.test(sn), sn);
    c.ok('strength note says the lineup is optimised, not the one set',
      /best legal lineup filled rather than the one currently set/.test(sn), sn);
    c.ok('strength note explains byes come back at zero',
      /on bye come back at zero/.test(sn), sn);
    c.ok('slots read from the lineups', /10 starters read from the current lineups/.test(sn), sn);

    c.ok('week note keeps the forecast out of the week contract',
      /Standings, the grid and the season forecast stay season-to-date/.test(txt($('weekNote'))), txt($('weekNote')));
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
