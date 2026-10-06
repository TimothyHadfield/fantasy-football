// Boots index.html and debug.html for real in linkedom, then drives
// home-page.js's model/render pair with a synthetic PRE-KICKOFF week — the case
// that cannot be reached from the demo data, because the demo season is over.
//
//   node test-home.mjs            (parent: one child process per page)
//   node test-home.mjs index.html (child)
//   node --import <the season stand-in> test-home.mjs toggle <order> (child;
//                                 see "the source buttons" below)

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';
const PAGES = ['index.html', 'debug.html'];

function moduleSrcs(html) {
  const out = [];
  const re = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

async function boot(page) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
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

  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  const fetch = async (url) => { fetchCalls.push(String(url)); throw new Error(`unexpected network call: ${url}`); };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;

  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); orig(...a); };

  const srcs = moduleSrcs(html);
  if (!srcs.length) throw new Error(`${page}: declares no module scripts`);

  const mods = {};
  for (const src of srcs) {
    mods[src] = await import(pathToFileURL(path.join(REPO, src)).href);
  }

  await new Promise((r) => setTimeout(r, 300));
  console.error = orig;

  return { document, mods, errors, fetchCalls, srcs };
}

// ------------------------------------------------------- pre-kickoff fixture

/** Week 1, nothing played, ESPN totals null exactly as season.js now returns. */
function preKickoff() {
  const names = ['Aardvarks', 'Badgers', 'Cobras', 'Dingoes', 'Egrets',
                 'Falcons', 'Gophers', 'Herons', 'Ibexes', 'Jackals'];
  const teams = names.map((n, i) => ({ id: i + 1, name: n }));

  const games = [];
  for (let i = 0; i < 10; i += 2) {
    games.push({
      week: 1,
      homeId: i + 1, homeName: names[i], homeScore: null,
      awayId: i + 2, awayName: names[i + 1], awayScore: null,
      played: false, margin: null, winner: null,
    });
  }

  const byWeek = new Map([[1, games]]);
  for (let w = 2; w <= 13; w++) byWeek.set(w, []);

  const player = (id, name, position, lineupSlotId, slot, projected, injuryStatus) => ({
    playerId: id, name, position, proTeam: 'KC', lineupSlotId, slot,
    started: lineupSlotId !== 20,
    projected, actual: null, seasonProjected: projected * 13,
    injuryStatus, percentOwned: 50,
  });

  const rosterTeams = teams.map((t, i) => {
    const starters = [
      player(t.id * 100 + 1, `QB ${t.name}`, 'QB', 0, 'QB', 18 + i * 0.3, 'ACTIVE'),
      player(t.id * 100 + 2, `RB ${t.name}`, 'RB', 2, 'RB', 12 + i * 0.2, i % 3 === 0 ? 'QUESTIONABLE' : 'ACTIVE'),
      player(t.id * 100 + 3, `WR ${t.name}`, 'WR', 4, 'WR', 11 + i * 0.1, i === 4 ? 'OUT' : 'ACTIVE'),
    ];
    const bench = [player(t.id * 100 + 9, `Bench ${t.name}`, 'RB', 20, 'BE', 6, 'ACTIVE')];
    const projectedTotal = Math.round(starters.reduce((a, p) => a + p.projected, 0) * 10) / 10;
    return {
      id: t.id, name: t.name, abbrev: t.name.slice(0, 3).toUpperCase(),
      players: [...starters, ...bench], starters, bench,
      projectedTotal,
      actualTotal: null,          // nobody has played
      benchActualTotal: null,
      seasonProjectedTotal: Math.round(projectedTotal * 13 * 10) / 10,
    };
  });

  return {
    schedule: {
      leagueName: 'Pre-Kickoff League',
      teams,
      weeks: [...byWeek.keys()],
      byWeek,
      games: [...byWeek.values()].flat(),
    },
    rosters: { week: 1, teams: rosterTeams },
    week: 1,
    teamId: 3,
    isDemo: false,
  };
}

/**
 * The same league with week 1 final.
 *
 * The bench panel is where two of the dashboard's player references live, and
 * it only draws once a week is over, so the pre-kickoff fixture cannot reach it.
 * Every squad here benched an RB who outscored the RB his owner started, which
 * is the one comparison SLOT_ELIGIBILITY allows between these three starters —
 * so every row has a miss, and the two men in it are known by name and by id.
 *
 * `blankIds` strips the ESPN id off named players, which is how the "no id, no
 * link" rule is exercised without inventing a second fixture.
 */
function finishedWeek({ blankIds = [] } = {}) {
  const fx = preKickoff();
  const blank = new Set(blankIds);
  const r1 = (n) => Math.round(n * 10) / 10;

  const teams = fx.rosters.teams.map((t, i) => {
    const withId = (p, actual) => ({
      ...p,
      playerId: blank.has(p.playerId) ? null : p.playerId,
      actual,
    });
    const starters = t.starters.map((p) => withId(p, r1(p.projected - 2)));
    // The benched RB beats the started RB by exactly 4 + i, so the "Cost"
    // column has a value this file can predict rather than read back.
    const bench = t.bench.map((p) => withId(p, r1(starters[1].actual + 4 + i)));
    const sum = (arr) => r1(arr.reduce((a, p) => a + p.actual, 0));

    return {
      ...t,
      players: [...starters, ...bench],
      starters,
      bench,
      actualTotal: sum(starters),
      benchActualTotal: sum(bench),
    };
  });

  const scoreOf = new Map(teams.map((t) => [t.id, t.actualTotal]));
  const games = fx.schedule.byWeek.get(1).map((g) => {
    const homeScore = scoreOf.get(g.homeId);
    const awayScore = scoreOf.get(g.awayId);
    return {
      ...g,
      played: true,
      homeScore,
      awayScore,
      margin: r1(homeScore - awayScore),
      winner: homeScore === awayScore ? 'tie' : homeScore > awayScore ? 'home' : 'away',
    };
  });

  const byWeek = new Map(fx.schedule.byWeek);
  byWeek.set(1, games);

  return {
    ...fx,
    schedule: { ...fx.schedule, byWeek, games: [...byWeek.values()].flat() },
    rosters: { week: 1, teams },
  };
}

// The one shape a player reference is allowed to take. Nothing on the page may
// emit a name, an index, an empty id, or the string "undefined".
const PREF_HREF = /^waivers\.html\?player=\d+$/;

// ------------------------------------------------- the shared red/green scale
//
// js/heat.js paints a cell by class and marks the end of the scale with a glyph
// INSIDE the cell, so every reader of a number on this page has to strip the
// glyph first. `Number("112.3 ▲")` is NaN, which would have made the roster
// strength assertions below fail for a reason that has nothing to do with them.

const HEAT_CLS = /\bheat-(up|dn)-([1-4])\b/;
const stripMark = (s) => String(s || '').replace(/[▲▼]/g, '').trim();
const clsOf = (el) => (el && el.getAttribute('class')) || '';
const heatSide = (el) => {
  const m = HEAT_CLS.exec(clsOf(el));
  return m ? m[1] : null;          // 'up' | 'dn' | null
};

/**
 * Does a coloured column point the RIGHT WAY?
 *
 * This is the assertion the brief asks for and it is built so that flipping a
 * single `invert` fails it: every cell the page painted green must be on the
 * good side of its own column's mean, and every red cell on the bad side. It
 * takes the direction as an argument rather than inferring it, because
 * inferring it from the page is how a test agrees with whatever the page did.
 *
 * It refuses to pass vacuously: a column with no green cell or no red cell
 * reports as a failure rather than as "every cell was fine".
 */
/**
 * ON SCREEN, not merely present — AUDIT §3.4.
 *
 * Both colour keys on this page were asserted by their TEXT alone, and text is
 * still text when the key is moved inside its own closed <details>: a colour
 * with its key behind a toggle, which rule 7 forbids. It was demonstrated on
 * 2026-09-20 by moving `strengthKey` and `benchScaleKey` into their closed
 * toggles — this suite and fc-test both stayed green. So the keys now go
 * through this, which walks the ancestors for `hidden` and for a closed toggle.
 */
function onScreen(el) {
  if (!el) return false;
  for (let n = el; n; n = n.parentElement) {
    if (n.hasAttribute && n.hasAttribute('hidden')) return false;
    if (n.tagName === 'DETAILS' && n !== el && !n.hasAttribute('open')) return false;
  }
  return true;
}

/** Where an element sits, so a failure says WHY it is not on screen. */
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

function directionOk(values, cells, goodHigh) {
  const usable = values.map((v, i) => [v, cells[i]]).filter(([v]) => Number.isFinite(v));
  if (usable.length < 2) return 'fewer than two values';
  const mean = usable.reduce((a, [v]) => a + v, 0) / usable.length;
  let ups = 0;
  let downs = 0;
  for (const [v, cell] of usable) {
    const side = heatSide(cell);
    if (!side) continue;
    if (side === 'up') ups++; else downs++;
    const good = goodHigh ? v > mean : v < mean;
    if ((side === 'up') !== good) {
      return `${v} (mean ${mean.toFixed(2)}) painted ${side} with goodHigh=${goodHigh}`;
    }
  }
  if (!ups) return 'nothing is green — the scale drew nothing, so this proves nothing';
  if (!downs) return 'nothing is red — the scale drew nothing, so this proves nothing';
  return '';
}

/** Every panel whose subject is a fantasy team, not an NFL player. */
const TEAM_PANELS = ['#matchups', '#strength'];

// --------------------------------------------------------- the source buttons
//
// "Demo data | My ESPN league" must say what is ON SCREEN. It did not: with a
// saved league every reload ended on the live league under a lit "Demo data"
// (the connection bar answers at once from its saved copy, so the live load
// started BEFORE the boot's own demo paint, which then lit Demo for good).
//
// The page boots itself on import, so each order of events is a child of its
// own. js/season.js is stood in for by tests/cap-stub-season.mjs — ten squads,
// three weeks decided — behind a wrapper that can hold the schedule back or
// refuse it, registered from a data: URL so this suite needs no file beside it.

const STUB_SEASON = pathToFileURL(path.join(REPO, 'tests', 'cap-stub-season.mjs')).href;
const dataUrl = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const SEASON_SRC = `
export * from ${JSON.stringify(STUB_SEASON)};
import { fetchSchedule as real } from ${JSON.stringify(STUB_SEASON)};
export async function fetchSchedule() {
  const ms = Number(process.env.HOME_SCHED_DELAY || 0);
  if (ms) await new Promise((r) => setTimeout(r, ms));
  if (process.env.HOME_SCHED_FAIL) throw new Error('ESPN would not return the schedule.');
  return real();
}`;
const LOADER_SRC = `
const SEASON = ${JSON.stringify(dataUrl(SEASON_SRC))};
export async function resolve(spec, ctx, next) {
  const fromTests = /\\/tests\\/[^/]*$/.test(ctx.parentURL || '');
  if (spec.startsWith('.') && /\\/season\\.js$/.test(spec) && !fromTests) {
    return { url: SEASON, shortCircuit: true };
  }
  return next(spec, ctx);
}`;
const REGISTER = dataUrl(
  `import { register } from 'node:module'; register(${JSON.stringify(dataUrl(LOADER_SRC))});`);

// What the connection bar keeps once a league has been read: the next page
// load answers `onConnection` from it before anything has been asked of ESPN.
const SAVED = {
  leagueId: '99', season: 2026, teamId: 1, checkedAt: 1, source: 'espn',
  league: {
    leagueId: '99', season: 2026, name: 'Capture Stub League', teamCount: 10,
    teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Manager ${i + 1}` })),
  },
};
const { league: _bar, ...UNREAD } = SAVED;

/** order -> what is in the browser, the stand-in's switches, and what must be on screen. */
const TOGGLE_RUNS = {
  // A reload with a saved league: the bar answers first. THE BUG.
  reload: { store: { 'ff.connection': SAVED }, want: 'Live' },
  // The same from the synced copy, as a phone reads it.
  cloud: { store: { 'ff.connection': { ...SAVED, source: 'cloud' } }, env: { CAP_CLOUD: '1' }, want: 'Live' },
  // A league id saved but never read: the boot's own load goes first.
  unread: { store: { 'ff.connection': UNREAD }, want: 'Live' },
  // Nobody connected.
  none: { store: {}, want: 'Demo' },
  // ESPN refuses: the page stays on the sample league.
  fail: { store: { 'ff.connection': SAVED }, env: { HOME_SCHED_FAIL: '1' }, want: 'Demo' },
  // "Demo data" was clicked on an earlier visit.
  chosen: { store: { 'ff.connection': SAVED, 'ff.prefs': { 'home.source': 'demo' } }, want: 'Demo' },
  // "Demo data" clicked while the league is still being read, then back.
  midload: { store: { 'ff.connection': SAVED }, env: { HOME_SCHED_DELAY: '250' }, want: 'Demo', click: true },
};

if (process.argv[2] === 'toggle') {
  const run = TOGGLE_RUNS[process.argv[3]];
  const errors = [];
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  const { document, window } = bootDom({
    html: readFileSync(path.join(REPO, 'index.html'), 'utf8'), store: run.store,
  });
  await import(pathToFileURL(path.join(REPO, 'js/home-page.js')).href);
  await import(pathToFileURL(path.join(REPO, 'js/connection.js')).href);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const badge = () => document.getElementById('modeBadge').textContent.trim();
  const lit = () => [...document.querySelectorAll('#sourceToggle button')]
    .filter((b) => b.classList.contains('on')).map((b) => b.getAttribute('data-src'));
  const click = (src) => document.querySelector(`#sourceToggle button[data-src="${src}"]`)
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  // Past the bar's own round trip (the extension is allowed 400ms to answer),
  // so a connection event that lands late is inside the reading.
  const settled = async (want) => {
    await waitFor(() => badge() === want, 4000);
    await sleep(900);
    return { badge: badge(), lit: lit() };
  };

  const out = {};
  if (run.click) {
    await sleep(60);                 // the schedule is still on its way
    click('demo');
    out.first = await settled('Demo');
    click('live');
    out.then = await settled('Live');
  } else {
    out.first = await settled(run.want);
  }
  out.errors = errors;
  emit(out);
}

// ------------------------------------------------------------------ child mode

if (process.argv[2]) {
  const page = process.argv[2];
  const problems = [];
  try {
    const { document, mods, errors, fetchCalls } = await boot(page);
    const $ = (id) => document.getElementById(id);
    const text = (id) => ($(id)?.textContent || '').replace(/\s+/g, ' ').trim();

    if (errors.length) problems.push(`console.error: ${errors.slice(0, 3).join(' | ')}`);
    if (fetchCalls.length) problems.push(`network call: ${fetchCalls[0]}`);

    const facts = {};

    if (page === 'index.html') {
      // --- demo boot -----------------------------------------------------
      facts.demoBadge = text('modeBadge');
      facts.demoGames = document.querySelectorAll('#matchups .game').length;
      facts.demoRankRows = document.querySelectorAll('#strength .rank li').length;
      facts.demoBenchRows = document.querySelectorAll('#bench tbody tr').length;
      facts.demoWeekOptions = document.querySelectorAll('#weekSelect option').length;

      if (facts.demoBadge !== 'Demo') problems.push(`badge is "${facts.demoBadge}", expected Demo`);
      if (facts.demoGames !== 5) problems.push(`demo: ${facts.demoGames} matchup cards, expected 5`);
      if (facts.demoRankRows !== 10) problems.push(`demo: ${facts.demoRankRows} strength rows, expected 10`);
      if (!facts.demoBenchRows) problems.push('demo: bench panel is empty on a completed week');
      if (facts.demoWeekOptions !== 13) problems.push(`demo: ${facts.demoWeekOptions} week options, expected 13`);
      if (process.env.DUMP_DEMO) console.error($(process.env.DUMP_DEMO)?.innerHTML || '(none)');

      // The sample league has no lineup to fix and no dates to count down to:
      // neither new line may appear on it.
      facts.demoSwaps = document.querySelectorAll('#matchups .gswap').length;
      if (facts.demoSwaps) problems.push(`demo: ${facts.demoSwaps} start/sit line(s) on the sample league`);
      if (!$('deadlines')) problems.push('demo: the deadlines line has no element');
      else if (onScreen($('deadlines')) || text('deadlines')) {
        problems.push(`demo: the deadlines line shows "${text('deadlines')}" on the sample league`);
      }

      // Every team on a card has its record beside its name (Tim: "where the
      // user's names are listed, put their record by it"). The sample season
      // is over, so all ten are whole numbers and each side's adds up to 13.
      const demoRecs = Array.from(document.querySelectorAll('#matchups .side'))
        .map((s) => (s.querySelector('.trec')?.textContent || '').trim());
      facts.demoRecords = demoRecs.slice(0, 2);
      const adds13 = (r) => /^\d+–\d+(–\d+)?$/.test(r) && r.split('–').reduce((a, n) => a + Number(n), 0) === 13;
      if (demoRecs.length !== 10 || !demoRecs.every(adds13)) {
        problems.push(`record: the demo cards read ${JSON.stringify(demoRecs)}, expected ten W–L records over 13 games`);
      }

      // Roster strength: the ▲/▼ sits in a slot EVERY row has, so a row with a
      // mark and a row without keep the bar and the number in the same place.
      const slots = Array.from(document.querySelectorAll('#strength .rank li'))
        .map((li) => Array.from(li.querySelectorAll('.vv .heatmark')).map((el) => el.textContent.trim()));
      facts.strengthSlots = slots.map((s) => s.join('') || '·').join('');
      if (!slots.every((s) => s.length === 1)) {
        problems.push(`strength: not every row has one mark slot — ${facts.strengthSlots}`);
      } else if (!slots.some((s) => s[0]) || !slots.some((s) => !s[0])) {
        problems.push(`strength: the demo rows are all marked or all plain (${facts.strengthSlots}), so this proves nothing`);
      }

      // --- player references, against the real demo data -------------------
      //
      // The ids are checked against the roster payload the demo generator
      // produces for this week, so a link can only pass by carrying an id that
      // genuinely exists — a name, an index or a fabricated number all fail.
      const demoLinks = Array.from(document.querySelectorAll('a.pref'));
      facts.demoPrefs = demoLinks.length;
      if (!demoLinks.length) problems.push('demo: no player references anywhere on the dashboard');

      const demoBadHref = demoLinks
        .map((a) => a.getAttribute('href'))
        .filter((h) => !PREF_HREF.test(h || ''));
      if (demoBadHref.length) {
        problems.push(`demo: malformed player href ${JSON.stringify(demoBadHref.slice(0, 3))}`);
      }

      const demoWeek = Number((text('matchupsTitle').match(/Week (\d+)/) || [])[1]);
      const demoMod = await import(pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href);
      const realIds = new Set();
      for (const t of demoMod.generateDemoWeekRosters(demoWeek).teams) {
        for (const p of t.players) realIds.add(String(p.playerId));
      }
      const strangers = demoLinks
        .map((a) => (a.getAttribute('href') || '').replace('waivers.html?player=', ''))
        .filter((id) => !realIds.has(id));
      if (strangers.length) {
        problems.push(`demo: ${strangers.length} link(s) point at ids no roster carries: ${JSON.stringify(strangers.slice(0, 3))}`);
      }

      for (const sel of TEAM_PANELS) {
        const n = document.querySelectorAll(`${sel} a`).length;
        if (n) problems.push(`demo: ${n} link(s) inside ${sel} — team names are not players`);
      }

      // --- THE SHARED RED/GREEN SCALE, on the demo season ------------------
      //
      // The demo boots on a complete thirteen-week season, so the one
      // threshold this page still holds back on — a bench week that is final
      // for everybody — is cleared here.
      //
      // The standings panel used to carry the other half of this block (PF up,
      // PA INVERTED, Diff up, W–L plain, and no colour at all before week 4).
      // It was deleted on 2026-09-23 as an ESPN screen. Those rules are not
      // unguarded: the Stats page draws the same record-and-points table with
      // the same scale, and `tests/stats-order.mjs` holds it to them — Opp Avg
      // and Opp proj inverted, Total/Spread/PTW/Skill/W–L refused, the key
      // split between what a colour MEANS and the thresholds behind the
      // toggle. That is the panel Tim kept, because luck, skill and S+L are
      // not on ESPN.

      // (1) Roster strength: one column, ten squads, high is good.
      const sRows = Array.from(document.querySelectorAll('#strength .rank li'));
      // The step class sits INSIDE `.vv` rather than on it, because this page's
      // own `.rank .vv { font-weight: 600 }` is two classes and would otherwise
      // beat the scale's weight step — the tint would show and the weight would
      // silently not. Read the inner element, and fall back to `.vv` so a page
      // that moved the class back out fails on direction rather than on a
      // missing node.
      const sCells = sRows.map((li) => li.querySelector('.vv [class*="heat-"]') || li.querySelector('.vv'));
      const sVals = sRows.map((li) => Number(stripMark(li.querySelector('.vv').textContent)));
      facts.strengthHeat = sCells.filter((el) => heatSide(el)).length;
      if (sVals.some((v) => !Number.isFinite(v))) {
        problems.push(`heat: a strength value is unreadable ${JSON.stringify(sVals.slice(0, 3))}`);
      }
      const sBad = directionOk(sVals, sCells, true);
      if (sBad) problems.push(`heat: roster strength points the wrong way — ${sBad}`);
      // Rows are emitted best-first, so the top row must be on the green side
      // and the bottom on the red. This is the assertion a flipped `invert`
      // fails outright rather than subtly.
      if (heatSide(sCells[0]) !== 'up') {
        problems.push(`heat: the strongest roster is painted "${clsOf(sCells[0])}", expected green`);
      }
      if (heatSide(sCells[sCells.length - 1]) !== 'dn') {
        problems.push(`heat: the weakest roster is painted "${clsOf(sCells[sCells.length - 1])}", expected red`);
      }
      // THE KEY IS SPLIT, the way the Stats page splits it: what is VISIBLE is
      // what changes what a number means, and the thresholds — the half that
      // lets a shaded cell be checked by hand — sit in the tucked note with the
      // method. Both halves are required, so both are asserted, AND SO IS THE
      // BOUNDARY BETWEEN THEM: an assertion that only checked the tucked note
      // still passes when `describeHeat` creeps back under the table, which is
      // exactly the regression this split was made to undo (2026-09-19, the
      // colour sweep put ~90 words of thresholds on screen per panel; `node
      // tests/text-audit.mjs index.html` measures it).
      facts.strengthKey = text('strengthKey');
      // ON SCREEN, not merely present (§3.4): the text below is the same text
      // when the whole key has been moved inside a closed toggle.
      if (!onScreen($('strengthKey'))) {
        problems.push(`heat: the strength key is not on screen — ${placeOf($('strengthKey'))}`);
      }
      if (!/Green beats the other nine lineups/.test(facts.strengthKey)) {
        problems.push(`heat: roster strength has no visible key line — "${facts.strengthKey.slice(0, 80)}"`);
      }
      // Channel 2 named in the key: without it a reader who cannot separate the
      // hues has no way of knowing the ends are marked at all.
      if (!/▲▼/.test(facts.strengthKey)) {
        problems.push('heat: the strength key does not say the ends carry a glyph');
      }
      if (/pts or better|standard deviation/.test(facts.strengthKey)) {
        problems.push(`heat: the thresholds are back in the VISIBLE strength key — "${facts.strengthKey.slice(0, 120)}"`);
      }
      const strengthMethod = text('strengthNote');
      if (!/Colour compares each number/.test(strengthMethod)) {
        problems.push('heat: the strength method note does not describe the scale');
      }
      if (!/\d+\.\d pts or better/.test(strengthMethod)) {
        problems.push('heat: the strength note does not print its thresholds in points');
      }

      // (3) Bench: Started is scaled, Bench and Cost are deliberately not.
      const bRows = Array.from(document.querySelectorAll('#bench tbody tr'))
        .map((tr) => Array.from(tr.children));
      if (bRows.length) {
        const started = bRows.map((c) => c[1]);
        const bad = directionOk(started.map((c) => Number(c.getAttribute('data-v'))), started, true);
        if (bad) problems.push(`heat: bench Started points the wrong way — ${bad}`);
        if (bRows.some((c) => heatSide(c[2]))) {
          problems.push('heat: the Bench column was coloured — neither direction is good there');
        }
        if (bRows.some((c) => heatSide(c[4]))) {
          problems.push('heat: the Cost column was coloured — its best value is a dash, not a number');
        }
        facts.benchScaleKey = text('benchScaleKey');
        // ON SCREEN, not merely present (§3.4) — same trap as the strength key.
        if (!onScreen($('benchScaleKey'))) {
          problems.push(`heat: the bench key is not on screen — ${placeOf($('benchScaleKey'))}`);
        }
        // WHICH column carries the scale stays visible — three of the five are
        // plain, and a reader comparing two numbers has to know which of them
        // was measured. WHY the other two are plain is method, and the assertion
        // below checks it landed in the note rather than vanishing.
        if (!/Only Started is shaded/.test(facts.benchScaleKey)) {
          problems.push(`heat: the bench panel has no visible key line — "${facts.benchScaleKey.slice(0, 80)}"`);
        }
        if (!/▲▼/.test(facts.benchScaleKey)) {
          problems.push('heat: the bench key does not say the ends carry a glyph');
        }
        if (/pts or better|standard deviation/.test(facts.benchScaleKey)) {
          problems.push(`heat: the thresholds are back in the VISIBLE bench key — "${facts.benchScaleKey.slice(0, 120)}"`);
        }
        const benchMethod = text('benchNote');
        if (!/Colour compares each number/.test(benchMethod)) {
          problems.push('heat: the bench method note does not describe the scale');
        }
        // The two refusals are stated where a reader can find them, not only in
        // a source comment — an uncoloured column with no explanation reads as
        // the feature having missed it.
        if (!/Bench<\/strong> is not shaded|Bench is not shaded/.test(benchMethod) ||
            !/Cost<\/strong> is not shaded|Cost is not shaded/.test(benchMethod)) {
          problems.push('heat: the bench note does not say why Bench and Cost are left plain');
        }
      }

      // (4) EVERY COLOURED CELL CARRIES A data-v. sortable.js falls back to the
      //     cell's text when it does not, and it strips only ", + $ %" and
      //     spaces — so a cell ending in ▲ would sort as a string and scatter
      //     the column the first time a heading is clicked.
      const noSortKey = Array.from(document.querySelectorAll('td[class*="heat-"]'))
        .filter((td) => td.getAttribute('data-v') === null);
      if (noSortKey.length) {
        problems.push(`heat: ${noSortKey.length} coloured cell(s) carry no data-v, so the column sorts as text`);
      }

      // --- pre-kickoff ---------------------------------------------------
      const home = mods['js/home-page.js'];
      if (!home?.buildModel || !home?.render) {
        problems.push('home-page.js does not export buildModel/render');
      } else {
        const fx = preKickoff();
        const model = home.buildModel(fx);
        home.render(model);

        facts.preGames = document.querySelectorAll('#matchups .game').length;
        facts.preUpcoming = document.querySelectorAll('#matchups .game.upcoming').length;
        facts.preMine = document.querySelectorAll('#matchups .game.mine').length;
        facts.preNote = text('matchupsNote');
        facts.preBench = text('bench');
        facts.preInjuryRows = document.querySelectorAll('#injuries tbody tr').length;
        facts.preRankRows = document.querySelectorAll('#strength .rank li').length;
        facts.preBadge = text('modeBadge');
        facts.preSub = text('pageSub');

        const cards = $('matchups').innerHTML;
        const scores = Array.from(document.querySelectorAll('#matchups .tscore'))
          .map((el) => el.textContent.trim());

        if (facts.preGames !== 5) problems.push(`pre: ${facts.preGames} cards, expected 5`);
        if (facts.preUpcoming !== 5) problems.push('pre: some cards are not marked upcoming');
        if (facts.preMine !== 1) problems.push(`pre: ${facts.preMine} cards flagged as mine, expected 1`);
        if (!scores.every((s) => s === '—')) problems.push(`pre: fabricated scores ${JSON.stringify(scores)}`);
        if (!/Projected:/.test(cards)) problems.push('pre: no projected favourite shown');
        if (!/Nothing has kicked off/.test(facts.preNote)) problems.push(`pre: matchup note reads "${facts.preNote}"`);
        if (!/has not finished/.test(facts.preBench)) problems.push(`pre: bench not empty-stated: "${facts.preBench.slice(0, 90)}"`);
        if (/0\.0/.test(facts.preBench)) problems.push('pre: a fabricated 0.0 reached the page');
        if (facts.preRankRows !== 10) problems.push(`pre: ${facts.preRankRows} strength rows, expected 10`);

        // ---- ROSTER STRENGTH IS PER WEEK, NOT PER SEASON -------------------
        //
        // Tim, 2026-09-19: "right now the roster strength box has the numbers
        // on the right displayed as across the season. This means nothing to
        // the user. Show it as per week." A season total for a starting lineup
        // is four figures; a week is the hundred-and-something ESPN prints
        // under a lineup, which is the only one of the two a manager can place.
        //
        // Checked against the MODEL's own season totals rather than against a
        // hard-coded number, so the fixture can change without this rotting —
        // and the ranks are checked as unchanged, because dividing every row by
        // the same 17 must not be able to reorder anybody.
        const strengthRows = Array.from(document.querySelectorAll('#strength .rank li'))
          .map((li) => Number(stripMark(li.querySelector('.vv').textContent)));
        const modelStrength = model.strength.filter((r) => r.value !== null);
        facts.preStrengthShown = strengthRows.slice(0, 3);
        facts.preStrengthSeason = modelStrength.slice(0, 3).map((r) => r.seasonTotal);

        if (!strengthRows.length || strengthRows.some((v) => !Number.isFinite(v))) {
          problems.push(`pre: strength values unreadable ${JSON.stringify(strengthRows)}`);
        } else {
          if (strengthRows.some((v) => v > 400)) {
            problems.push(`pre: a strength figure is still a season total ${JSON.stringify(strengthRows)}`);
          }
          const offBy = modelStrength
            .map((r, i) => Math.abs(strengthRows[i] - r.seasonTotal / 17))
            .filter((d) => d > 0.06);
          if (offBy.length) {
            problems.push(`pre: ${offBy.length} strength rows are not the season total over 17 games`);
          }
          const ordered = strengthRows.every((v, i) => i === 0 || v <= strengthRows[i - 1]);
          if (!ordered) problems.push(`pre: strength is no longer best-first ${JSON.stringify(strengthRows)}`);
          if (!/typical week/i.test(text('strengthNote'))) {
            problems.push('pre: the strength note does not say the figure is a week');
          }
          // The season total is the number ESPN actually published, so the
          // panel still has to be able to hand it back rather than losing it.
          const titled = document.querySelector('#strength .rank li[title]');
          if (!titled || !/season-long projection/.test(titled.getAttribute('title'))) {
            problems.push('pre: a strength row no longer carries its season total');
          }
        }
        if (facts.preInjuryRows !== 5) problems.push(`pre: ${facts.preInjuryRows} injured starters, expected 5`);
        if (facts.preBadge !== 'Live') problems.push(`pre: badge "${facts.preBadge}", expected Live`);

        // Rosters missing entirely: three panels degrade, page survives.
        const noRosters = home.buildModel({ ...fx, rosters: null });
        home.render(noRosters);
        facts.noRosterStrength = text('strength');
        facts.noRosterInjuries = text('injuries');
        if (!/unavailable/.test(facts.noRosterStrength)) problems.push('no-rosters: strength panel does not say why it is empty');
        if (!/unavailable/.test(facts.noRosterInjuries)) problems.push('no-rosters: injury panel does not say why it is empty');

        // THE RANK IS ON THE RAW SEASON TOTAL, not the rounded week (AUDIT
        // §1.9). Two squads 1.4 season points apart both print 104.7 a week;
        // sorted on the rounded figure they tie and fall back to ESPN's team
        // order, putting the smaller total (Aardvarks, team 1) first while the
        // rows' own titles show it is smaller.
        {
          const near = preKickoff();
          const bump = { 1: 1779.2, 2: 1780.6 };   // 104.66 and 104.74 a week
          near.rosters.teams = near.rosters.teams.map((t) =>
            bump[t.id] ? { ...t, seasonProjectedTotal: bump[t.id] } : t);
          const s = home.buildModel(near).strength;
          const [a, b] = s;
          if (!(a && b && a.value === 104.7 && b.value === 104.7)) {
            problems.push(`rank: the fixture no longer ties on the rounded figure ${JSON.stringify(s.slice(0, 2))}`);
          } else if (a.id !== 2 || a.rank !== 1 || b.id !== 1 || b.rank !== 2) {
            problems.push(`rank: sorted on the rounded week, not the season total — ${a.name} ${a.seasonTotal} ranked above ${b.name} ${b.seasonTotal}`);
          }
        }

        // ------------------------------------------------- player references
        //
        // Every place the dashboard names a specific NFL player — or shows a
        // number that is his rather than his team's — is an <a class="pref">
        // pointed at waivers.html?player=<ESPN playerId>. Every id expected
        // below is re-derived from the fixture, never read back off the page,
        // so the page cannot pass by agreeing with itself.
        home.render(model);

        const cellText = (td) => (td.textContent || '').replace(/\s+/g, ' ').trim();
        const rowsOf = (sel) => Array.from(document.querySelectorAll(`${sel} tbody tr`));
        const hrefOf = (p) => `waivers.html?player=${p.playerId}`;
        // "Bench Aardvarks" -> "B. Aardvarks", worked out here and not by
        // calling the page's own helper.
        const short = (name) => name.replace(/^(\S)\S*\s+/, '$1. ');

        // (1) The injury table: the name and the projection, both his.
        const injured = [];
        for (const t of fx.rosters.teams) {
          for (const p of t.starters) if (p.injuryStatus !== 'ACTIVE') injured.push(p);
        }

        const injuryLinks = Array.from(document.querySelectorAll('#injuries a.pref'));
        facts.injuryLinks = injuryLinks.length;
        if (injuryLinks.length !== injured.length * 2) {
          problems.push(`pref: ${injuryLinks.length} links in the injury table, expected ${injured.length * 2} (name + Proj on ${injured.length} rows)`);
        }
        for (const a of injuryLinks) {
          const href = a.getAttribute('href');
          if (!PREF_HREF.test(href || '')) problems.push(`pref: malformed injury href "${href}"`);
        }

        for (const row of rowsOf('#injuries')) {
          const c = Array.from(row.children);
          const p = injured.find((x) => cellText(c[0]).startsWith(x.name));
          if (!p) { problems.push(`pref: unrecognised injury row "${cellText(c[0])}"`); continue; }

          // text must be exactly what it was before any of this existed
          if (cellText(c[0]) !== `${p.name} ${p.position}`) {
            problems.push(`pref: linking changed the name cell to "${cellText(c[0])}", expected "${p.name} ${p.position}"`);
          }
          if (cellText(c[4]) !== p.projected.toFixed(1)) {
            problems.push(`pref: linking changed ${p.name}'s Proj cell to "${cellText(c[4])}"`);
          }
          if (c[4].getAttribute('data-v') !== String(p.projected)) {
            problems.push(`pref: ${p.name}'s Proj cell lost its data-v; sortable.js reads that, not the text`);
          }

          const nameA = c[0].querySelector('a.pref');
          const projA = c[4].querySelector('a.pref');
          if (!nameA) { problems.push(`pref: ${p.name} is not a link`); continue; }
          if (nameA.getAttribute('href') !== hrefOf(p)) {
            problems.push(`pref: ${p.name} links to "${nameA.getAttribute('href')}", expected "${hrefOf(p)}"`);
          }
          if (!projA) problems.push(`pref: ${p.name}'s projection is not a link`);
          else if (projA.getAttribute('href') !== nameA.getAttribute('href')) {
            problems.push(`pref: ${p.name}'s name and projection point at different players`);
          }

          const title = nameA.getAttribute('title') || '';
          if (!title.includes(p.name)) problems.push(`pref: ${p.name}'s link title does not name him: "${title}"`);
          if (!/Players page/.test(title)) problems.push(`pref: a link title does not say where it goes: "${title}"`);

          // The "Fantasy team" column is a manager, not a player.
          if (c[2].querySelector('a')) problems.push('pref: the injury table linked a fantasy team name');
          // The two name columns are the ones that give way on a phone.
          if (!/\bwrap\b/.test(clsOf(c[0])) || !/\bwrap\b/.test(clsOf(c[2]))) {
            problems.push(`fit: ${p.name}'s player and team cells are not the wrapping ones ("${clsOf(c[0])}", "${clsOf(c[2])}")`);
          }
        }

        // THE INJURY TABLE'S Proj COLUMN MUST STAY PLAIN. It is a quarterback's
        // 22 above a kicker's 8 above a defence's 6 — whoever happens to be
        // hurt — which is the one comparison js/heat.js exists to refuse. This
        // asserts the refusal rather than trusting the comment that states it.
        const injHeat = document.querySelectorAll('#injuries td[class*="heat-"]').length;
        if (injHeat) {
          problems.push(`heat: ${injHeat} injury cell(s) were coloured — that column mixes positions`);
        }

        facts.injuryNote = text('injuryNote');
        if (!/Players page/.test(facts.injuryNote)) {
          problems.push(`pref: the injury note does not state what its links do: "${facts.injuryNote}"`);
        }

        for (const sel of TEAM_PANELS) {
          const n = document.querySelectorAll(`${sel} a`).length;
          if (n) problems.push(`pref: ${n} link(s) inside ${sel} — team and manager names are not players`);
        }

        // (2) The bench table, on a week that is actually over.
        const fin = finishedWeek();
        home.render(home.buildModel(fin));

        // RULE 5's "too thin to rank" half used to be asserted here, on the
        // standings panel, which held its colours back until week 4. That
        // panel was deleted on 2026-09-23 (an ESPN screen), and the threshold
        // went with it — nothing on Home now withholds a scale by week count.
        //
        // The bench panel is not held back that way and must not be: one
        // week's ten scores ARE a comparison group, and that week is final.
        const benchHeat = document.querySelectorAll('#bench td[class*="heat-"]').length;
        facts.earlyBenchHeat = benchHeat;
        if (!benchHeat) {
          problems.push('heat: bench Started drew no colour on a week that is final for everybody');
        }

        const byTeamName = new Map(fin.rosters.teams.map((t) => [t.name, t]));
        facts.finBenchRows = rowsOf('#bench').length;
        facts.benchLinks = document.querySelectorAll('#bench a.pref').length;
        if (facts.finBenchRows !== 10) problems.push(`fin: ${facts.finBenchRows} bench rows, expected 10`);
        if (facts.benchLinks !== 20) {
          problems.push(`pref: ${facts.benchLinks} links in the bench table, expected 20 (both men in 10 misses)`);
        }

        for (const row of rowsOf('#bench')) {
          const c = Array.from(row.children);
          const t = byTeamName.get(cellText(c[0]));
          if (!t) { problems.push(`pref: unrecognised bench row "${cellText(c[0])}"`); continue; }

          // Team name, and the two team-level totals, belong to nobody.
          if (c[0].querySelector('a')) problems.push('pref: the bench table linked a team name');
          if (c[1].querySelector('a') || c[2].querySelector('a')) {
            problems.push(`pref: a team total in ${t.name}'s row was linked`);
          }
          // Cost is the gap between two players, so it is neither man's number.
          if (c[4].querySelector('a')) problems.push(`pref: ${t.name}'s Cost cell was linked`);

          // The two men by the site's short form ("B. Aardvarks"), so the table
          // fits its half-width panel; the full name is the link's title,
          // checked below. The cell is the one that may wrap.
          const benched = t.bench[0];
          const started = t.starters[1];
          const want =
            `${short(benched.name)} (${benched.actual.toFixed(1)}) over ` +
            `${short(started.name)} (${started.actual.toFixed(1)})`;
          if (cellText(c[3]) !== want) {
            problems.push(`pref: ${t.name}'s miss cell reads "${cellText(c[3])}", expected "${want}"`);
          }
          if (!/\bwrap\b/.test(clsOf(c[3])) || !/\bwrap\b/.test(clsOf(c[0]))) {
            problems.push(`fit: ${t.name}'s team and miss cells are not the wrapping ones ("${clsOf(c[0])}", "${clsOf(c[3])}")`);
          }

          const links = c[3].querySelectorAll('a.pref');
          if (links.length !== 2) {
            problems.push(`pref: ${links.length} links in ${t.name}'s miss, expected 2`);
            continue;
          }
          [benched, started].forEach((p, i) => {
            const href = links[i].getAttribute('href');
            if (href !== hrefOf(p)) {
              problems.push(`pref: ${t.name}'s miss links ${p.name} to "${href}", expected "${hrefOf(p)}"`);
            }
            if (!(links[i].getAttribute('title') || '').includes(p.name)) {
              problems.push(`pref: ${p.name}'s link in a miss has no title naming him`);
            }
          });
        }

        facts.benchNote = text('benchNote');
        if (!/Players page/.test(facts.benchNote)) {
          problems.push(`pref: the bench note does not state what its links do: "${facts.benchNote}"`);
        }

        // (3) A player ESPN gave no id: plain text, not "?player=undefined".
        // Blanking the Aardvarks' benched RB and started RB covers both
        // panels at once — that started RB is also their questionable starter.
        const t0 = fin.rosters.teams[0];
        const noId = finishedWeek({ blankIds: [t0.bench[0].playerId, t0.starters[1].playerId] });
        home.render(home.buildModel(noId));

        const anyBad = Array.from(document.querySelectorAll('a.pref'))
          .map((a) => a.getAttribute('href'))
          .filter((h) => !PREF_HREF.test(h || ''));
        if (anyBad.length) problems.push(`pref: id-less players produced ${JSON.stringify(anyBad.slice(0, 3))}`);

        const n0 = noId.rosters.teams[0];
        const missRow = rowsOf('#bench').find((r) => cellText(r.children[0]) === n0.name);
        facts.noIdMissLinks = missRow ? missRow.children[3].querySelectorAll('a.pref').length : -1;
        if (facts.noIdMissLinks !== 0) {
          problems.push(`pref: ${facts.noIdMissLinks} link(s) emitted for players carrying no id`);
        }
        const wantMiss =
          `${short(n0.bench[0].name)} (${n0.bench[0].actual.toFixed(1)}) over ` +
          `${short(n0.starters[1].name)} (${n0.starters[1].actual.toFixed(1)})`;
        if (missRow && cellText(missRow.children[3]) !== wantMiss) {
          problems.push(`pref: an unlinked miss cell reads "${cellText(missRow.children[3])}", expected "${wantMiss}"`);
        }

        facts.noIdInjuryLinks = document.querySelectorAll('#injuries a.pref').length;
        if (facts.noIdInjuryLinks !== (injured.length - 1) * 2) {
          problems.push(`pref: ${facts.noIdInjuryLinks} injury links with one id missing, expected ${(injured.length - 1) * 2}`);
        }
        const lame = n0.starters[1];
        const lameRow = rowsOf('#injuries').find((r) => cellText(r.children[0]).startsWith(lame.name));
        if (!lameRow) problems.push('pref: the id-less injured starter vanished from the table');
        else {
          if (lameRow.children[0].querySelector('a')) problems.push('pref: linked a player carrying no id');
          if (lameRow.children[4].querySelector('a')) problems.push('pref: linked the projection of a player carrying no id');
          if (cellText(lameRow.children[0]) !== `${lame.name} ${lame.position}`) {
            problems.push(`pref: an unlinked name cell reads "${cellText(lameRow.children[0])}", expected "${lame.name} ${lame.position}"`);
          }
        }

        // --- start A over B, on your own card --------------------------------
        //
        // The pre-kickoff league again, with the Cobras (team 3, "you") holding
        // an RB on the bench projected 20.0 above the 12.4 they start: one swap,
        // +7.6. `withBench` rebuilds a squad's bench so `players`, `starters`
        // and `bench` stay the same objects, as js/season.js hands them over.
        const withBench = (fx0, teamId, change) => ({
          ...fx0,
          rosters: {
            ...fx0.rosters,
            teams: fx0.rosters.teams.map((t) => {
              if (t.id !== teamId) return t;
              const bench = t.bench.map((p) => ({ ...p, ...change }));
              return { ...t, bench, players: [...t.starters, ...bench] };
            }),
          },
        });
        const swapText = () => Array.from(document.querySelectorAll('#matchups .gswap'))
          .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
        const mineCard = () => document.querySelector('#matchups .game.mine');

        // (1) The lineup as set is the best one: three words, on your card only.
        home.render(home.buildModel(preKickoff()));
        facts.swapBest = swapText();
        if (JSON.stringify(facts.swapBest) !== JSON.stringify(['Best lineup set'])) {
          problems.push(`swap: a right lineup reads ${JSON.stringify(facts.swapBest)}, expected ["Best lineup set"]`);
        }
        if (!mineCard()?.querySelector('.gswap')) problems.push('swap: the line is not inside your own card');

        // (2) One swap, no odds yet: the points, and no win figure.
        const swapFx = withBench(preKickoff(), 3, { projected: 20 });
        home.render(home.buildModel(swapFx));
        facts.swapOne = swapText();
        const wantOne = 'Start B. Cobras over R. Cobras: +7.6 pts';
        if (JSON.stringify(facts.swapOne) !== JSON.stringify([wantOne])) {
          problems.push(`swap: one swap reads ${JSON.stringify(facts.swapOne)}, expected ["${wantOne}"]`);
        }
        const swapLinks = Array.from(document.querySelectorAll('#matchups .gswap a.pref'))
          .map((a) => a.getAttribute('href'));
        const c3 = swapFx.rosters.teams.find((t) => t.id === 3);
        const wantLinks = [c3.bench[0], c3.starters[1]].map((p) => `waivers.html?player=${p.playerId}`);
        if (JSON.stringify(swapLinks) !== JSON.stringify(wantLinks)) {
          problems.push(`swap: the two names link to ${JSON.stringify(swapLinks)}, expected ${JSON.stringify(wantLinks)}`);
        }
        if (!onScreen($('matchupsExplain')?.closest('details')) || !/Start . over ./.test(text('matchupsExplain'))) {
          problems.push(`swap: "How this works" does not say what the line is: "${text('matchupsExplain').slice(0, 90)}"`);
        }

        // (3) With the page's odds: the win figure is the same model's. The
        // Cobras' set lineup is QB 18.6 + RB 12.4 + WR 11.2 = 42.2 and their
        // best is 49.8; the opponent total is put at 49.8 and the margin's sd
        // at 10, so the swap is worth Φ(0) − Φ(−0.76) = 0.5 − 0.22363 = 27.6%.
        const fakeOdds = {
          sigma: 10 / Math.SQRT2, calibrated: true, sample: 12, floors: null,
          projection: { slots: [0, 2, 4] },
          points: () => 49.8,
          forGame: () => 0.5,
        };
        home.render(home.buildModel({ ...swapFx, odds: fakeOdds }));
        facts.swapWin = swapText();
        const wantWin = 'Start B. Cobras over R. Cobras: +7.6 pts, +28% win';
        if (JSON.stringify(facts.swapWin) !== JSON.stringify([wantWin])) {
          problems.push(`swap: with odds it reads ${JSON.stringify(facts.swapWin)}, expected ["${wantWin}"]`);
        }

        // (4) Nobody chosen as "you": nothing, on any card.
        home.render(home.buildModel({ ...swapFx, teamId: null }));
        if (swapText().length) problems.push(`swap: no team chosen, yet ${JSON.stringify(swapText())}`);

        // (5) The better man has already played (his score is in): not offered.
        home.render(home.buildModel(withBench(preKickoff(), 3, { projected: 20, actual: 3.2 })));
        if (JSON.stringify(swapText()) !== JSON.stringify(['Best lineup set'])) {
          problems.push(`swap: a bench man who has played is offered: ${JSON.stringify(swapText())}`);
        }

        // (6) ...and so is one whose game kicked off a minute ago, by the clock.
        const kickedAt = Date.now() - 60000;
        home.render(home.buildModel({
          ...withBench(preKickoff(), 3, { projected: 20, proTeamId: 12 }),
          kickoffs: { 12: { 1: kickedAt } }, now: Date.now(),
        }));
        if (JSON.stringify(swapText()) !== JSON.stringify(['Best lineup set'])) {
          problems.push(`swap: a bench man whose game has kicked off is offered: ${JSON.stringify(swapText())}`);
        }
        // A kickoff still ahead locks nobody.
        home.render(home.buildModel({
          ...withBench(preKickoff(), 3, { projected: 20, proTeamId: 12 }),
          kickoffs: { 12: { 1: Date.now() + 3600000 } }, now: Date.now(),
        }));
        if (JSON.stringify(swapText()) !== JSON.stringify([wantOne])) {
          problems.push(`swap: a kickoff an hour away hid the swap: ${JSON.stringify(swapText())}`);
        }

        // (7) A finished week has no lineup left to fix.
        home.render(home.buildModel(finishedWeek()));
        if (swapText().length) problems.push(`swap: a final week still says ${JSON.stringify(swapText())}`);

        // (8) Only the two biggest are printed, biggest first. The Cobras get a
        // second bench man: a QB projected 30.0 over the 18.6 they start (+11.4).
        const two = withBench(preKickoff(), 3, { projected: 20 });
        const t3 = two.rosters.teams.find((t) => t.id === 3);
        const extra = [
          { ...t3.bench[0], playerId: 391, name: 'Spare Passer', position: 'QB', projected: 30 },
          { ...t3.bench[0], playerId: 392, name: 'Spare Catcher', position: 'WR', projected: 12 },
        ];
        t3.bench.push(...extra);
        t3.players.push(...extra);
        home.render(home.buildModel(two));
        facts.swapTwo = swapText();
        const wantTwo = [
          'Start S. Passer over Q. Cobras: +11.4 pts',
          'Start B. Cobras over R. Cobras: +7.6 pts',
        ];
        if (JSON.stringify(facts.swapTwo) !== JSON.stringify(wantTwo)) {
          problems.push(`swap: three swaps on offer read ${JSON.stringify(facts.swapTwo)}, expected ${JSON.stringify(wantTwo)}`);
        }

        // --- the deadlines line ----------------------------------------------
        //
        // 2026-10-06 12:00 UTC is "now"; the deadline is eleven and a half days
        // on (counted up to 12, as the Trade page counts), and waivers clear on
        // the 7th at 12:00 UTC — a Wednesday from UTC−11 to UTC+11.
        const NOW = Date.UTC(2026, 9, 6, 12);
        const DAY = 86400000;
        const dated = (trades, waiverClears) => {
          const fx0 = preKickoff();
          return { ...fx0, schedule: { ...fx0.schedule, trades }, waiverClears, now: NOW };
        };
        const WED = Date.UTC(2026, 9, 7, 12);
        const lineFor = (trades, waiverClears) => {
          home.render(home.buildModel(dated(trades, waiverClears)));
          return onScreen($('deadlines')) ? text('deadlines') : null;
        };

        facts.deadBoth = lineFor({ deadline: NOW + 11.5 * DAY, reviewHours: 24 }, WED);
        if (facts.deadBoth !== 'Trade deadline in 12 days · waivers clear Wed') {
          problems.push(`deadlines: both parts read ${JSON.stringify(facts.deadBoth)}`);
        }
        const panel = $('deadlines')?.closest('section');
        if (!panel || panel !== $('matchups')?.closest('section')) {
          problems.push('deadlines: the line is not in the This week panel');
        } else if (!(panel.innerHTML.indexOf('id="deadlines"') < panel.innerHTML.indexOf('id="matchups"'))) {
          problems.push('deadlines: the line is not above the cards');
        }
        facts.deadTrade = lineFor({ deadline: NOW + 1, reviewHours: null }, null);
        if (facts.deadTrade !== 'Trade deadline in 1 day') problems.push(`deadlines: one day reads ${JSON.stringify(facts.deadTrade)}`);
        facts.deadWaivers = lineFor(null, WED);
        if (facts.deadWaivers !== 'Waivers clear Wed') problems.push(`deadlines: waivers alone read ${JSON.stringify(facts.deadWaivers)}`);
        facts.deadPassed = lineFor({ deadline: NOW - DAY, reviewHours: 24 }, NOW - 1);
        if (facts.deadPassed !== 'Trade deadline passed') problems.push(`deadlines: a passed deadline and a passed waiver run read ${JSON.stringify(facts.deadPassed)}`);
        facts.deadNone = lineFor({ deadline: null, reviewHours: null }, null);
        if (facts.deadNone !== null) problems.push(`deadlines: a league with neither date shows ${JSON.stringify(facts.deadNone)}`);
        home.render(home.buildModel({ ...dated({ deadline: NOW + 5 * DAY }, WED), isDemo: true }));
        if (onScreen($('deadlines'))) problems.push(`deadlines: shown on demo data: "${text('deadlines')}"`);

        // --- the record beside each name on a card ---------------------------
        //
        // Tim: "where the user's names are listed, put their record by it", and
        // for a matchup being played the decimal record the rest of the site
        // prints (3–2 at a 20% chance reads 3.2–2.8), whole numbers otherwise.
        // Every record expected here is worked out from the fixture's scores.
        const sides = () => Array.from(document.querySelectorAll('#matchups .side')).map((s) => ({
          name: (s.querySelector('.tname')?.textContent || '').replace(/\s+/g, ' ').trim(),
          rec: (s.querySelector('.trec')?.textContent || '').trim(),
          title: s.querySelector('.trec')?.getAttribute('title') || '',
          // The record is its own element after the name, in the name's column:
          // a card row stays three columns wide, and the name is what shortens.
          apart: !s.querySelector('.tname .trec') && s.children.length === 3 &&
            s.querySelector('.tname')?.nextElementSibling === s.querySelector('.trec'),
        }));
        const recOf = (name) => sides().find((s) => s.name.startsWith(name));

        // (1) Nothing played: 0–0 for all ten, and the name cell reads as before.
        home.render(home.buildModel(preKickoff()));
        facts.recPre = sides().map((s) => s.rec).join(' ');
        if (!sides().every((s) => s.rec === '0–0' && !s.title)) {
          problems.push(`record: before week 1 the cards read "${facts.recPre}", expected ten of 0–0`);
        }
        if (!sides().every((s) => s.apart)) problems.push('record: the record is not its own element beside the name');
        if (recOf('Cobras')?.name !== 'Cobras (you)') {
          problems.push(`record: your own name cell reads "${recOf('Cobras')?.name}", expected "Cobras (you)"`);
        }

        // (2) Week 1 final: in each pair the later squad out-scored the earlier
        // (every fixture squad scores 0.6 more than the one before it).
        const won = new Set(['Badgers', 'Dingoes', 'Falcons', 'Herons', 'Jackals']);
        home.render(home.buildModel(finishedWeek()));
        facts.recFinal = sides().map((s) => `${s.name.split(' ')[0]} ${s.rec}`).join(', ');
        const wrongFinal = sides().filter((s) => s.rec !== (won.has(s.name.split(' ')[0]) ? '1–0' : '0–1') || s.title);
        if (sides().length !== 10 || wrongFinal.length) {
          problems.push(`record: after week 1 the cards read "${facts.recFinal}"`);
        }

        // (3) Week 2 being played, the Cobras at a 20% chance against the
        // Dingoes: 0–1 reads 0.2–1.8 and 1–0 reads 1.8–0.2, with the basis on
        // the record; the eight squads not in play stay whole.
        const live = finishedWeek();
        const wk2 = preKickoff().schedule.byWeek.get(1).map((g) => ({ ...g, week: 2 }));
        live.schedule.byWeek.set(2, wk2);
        live.schedule.games = [...live.schedule.byWeek.values()].flat();
        home.render(home.buildModel({
          ...live, week: 2, rosters: { week: 2, teams: preKickoff().rosters.teams },
          chances: new Map([[3, 0.2], [4, 0.8]]),
        }));
        facts.recLive = sides().map((s) => `${s.name.split(' ')[0]} ${s.rec}`).join(', ');
        if (recOf('Cobras')?.rec !== '0.2–1.8' || recOf('Dingoes')?.rec !== '1.8–0.2') {
          problems.push(`record: in play the pair reads ${recOf('Cobras')?.rec} and ${recOf('Dingoes')?.rec}, expected 0.2–1.8 and 1.8–0.2`);
        }
        if (!/0–1 so far; 20% to win/.test(recOf('Cobras')?.title || '')) {
          problems.push(`record: the decimal does not state its basis: "${recOf('Cobras')?.title}"`);
        }
        const others = sides().filter((s) => !/^(Cobras|Dingoes)/.test(s.name));
        if (others.length !== 8 || others.some((s) => !/^[01]–[01]$/.test(s.rec) || s.title)) {
          problems.push(`record: squads not in play are not whole numbers: "${facts.recLive}"`);
        }
      }
    }

    if (page === 'debug.html') {
      facts.probeButtons = document.querySelectorAll('.probe-btn').length;
      facts.allDisabled = Array.from(document.querySelectorAll('.probe-btn')).every((b) => b.disabled);
      facts.season = $('season')?.value;
      if (facts.probeButtons !== 5) problems.push(`debug: ${facts.probeButtons} probe buttons, expected 5`);
      if (!facts.allDisabled) problems.push('debug: probes enabled before any league check');
      if (!/^20\d\d$/.test(String(facts.season))) problems.push(`debug: season prefilled as "${facts.season}"`);
    }

    if (process.env.DUMP) console.error($(process.env.DUMP)?.innerHTML || '(no such element)');

    console.log(JSON.stringify({ page, ok: problems.length === 0, problems, facts }));
    process.exit(problems.length ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({ page, ok: false, problems: [String(err?.stack || err)] }));
    process.exit(1);
  }
}

// ----------------------------------------------------------------- parent mode

const self = fileURLToPath(import.meta.url);
let failed = 0;
for (const page of PAGES) {
  const res = spawnSync(process.execPath, [self, page], { encoding: 'utf8' });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }

  if (!parsed) {
    console.log(`FAIL ${page}\n  stdout=${res.stdout}\n  stderr=${(res.stderr || '').slice(0, 1500)}`);
    failed++;
    continue;
  }
  console.log(`${parsed.ok ? 'PASS' : 'FAIL'} ${page}`);
  console.log(`  ${JSON.stringify(parsed.facts)}`);
  for (const p of parsed.problems || []) { console.log(`  - ${p.slice(0, 900)}`); }
  if (!parsed.ok) failed++;
}

// The source buttons, one child per order of events: whatever the badge says is
// on screen, exactly that button is lit.
for (const [name, run] of Object.entries(TOGGLE_RUNS)) {
  const env = { ...process.env };
  for (const k of ['CAP_EARLY', 'CAP_DECIDED', 'CAP_CLOUD', 'HOME_SCHED_DELAY', 'HOME_SCHED_FAIL']) delete env[k];
  const res = spawnSync(process.execPath, ['--import', REGISTER, self, 'toggle', name], {
    encoding: 'utf8', timeout: 60000, env: { ...env, ...(run.env || {}) },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  const problems = [];
  let got = null;
  if (!line) problems.push(`no result: ${(res.stderr || res.stdout || '').slice(0, 900)}`);
  else {
    got = JSON.parse(line.slice(2));
    const check = (at, want) => {
      const lit = want === 'Live' ? 'live' : 'demo';
      if (!at || at.badge !== want) problems.push(`the page shows "${at && at.badge}", expected ${want}`);
      else if (JSON.stringify(at.lit) !== JSON.stringify([lit])) {
        problems.push(`the page shows ${want} with ${JSON.stringify(at.lit)} lit, expected ["${lit}"]`);
      }
    };
    check(got.first, run.want);
    if (run.click) check(got.then, 'Live');
    if (got.errors.length) problems.push(`error: ${got.errors[0]}`);
  }
  console.log(`${problems.length ? 'FAIL' : 'PASS'} source buttons: ${name}`);
  if (got) console.log(`  ${JSON.stringify({ first: got.first, then: got.then })}`);
  for (const p of problems) console.log(`  - ${p.slice(0, 900)}`);
  if (problems.length) failed++;
}
console.log(failed
  ? `\n${failed} page(s) failed`
  : `\nAll ${PAGES.length} pages OK, the source buttons in ${Object.keys(TOGGLE_RUNS).length} orders`);
process.exit(failed ? 1 : 0);
