// Roster analysis: every manager's starting lineup, side by side, one week at a
// time.
//
// The top table is the point of the page. The owner's standing request is to see
// the most important information for ALL teams at once, and until now this page
// showed ten rows of totals plus exactly ONE team's actual players — so working
// out who is thin at running back meant clicking through ten teams and holding
// it in your head. The grid puts all ten starting sevens on one screen and lets
// the per-team detail below be a drill-down instead of the only view.
//
// Rosters move week to week — trades, waivers, injuries — so the week selector
// stays the primary control. Everything else re-renders from whatever is picked.

import { fetchWeekRosters, fetchSchedule } from './season.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';
import * as espn from './espn.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('analysis');

const DEMO_WEEKS = 13;
const NFL_WEEKS = 18; // only used when ESPN won't tell us its own schedule

// ESPN's season projection covers the 17-game regular season. Dividing by it is
// what turns a ~2,500-point number into the ~15-point one a manager thinks in.
const SEASON_GAMES = 17;

// The flat D/ST + kicker allowance behind "Est Total". Both sit around 8 points
// a week and both get dropped and streamed constantly, so naming players in the
// grid would be churn for no insight — the allowance is the honest version.
const KDST_ALLOWANCE = 16;

const state = {
  source: 'demo',
  week: DEMO_WEEKS,
  weeks: [],        // weeks offered in the dropdown
  playedWeeks: [],  // of those, the ones that have actually been played
  data: null,       // {week, teams:[...]} for the selected week
  teamId: null,     // team shown in the roster detail
  myTeamId: null,   // the reader's own team, when a live league says so
  isDemo: true,
};

// Cache per week so flipping back to a week already loaded is instant.
const cache = new Map(); // `${source}:${week}` -> {week, teams}

// ------------------------------------------------------------------ formatting

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

function signed(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '<span class="muted">—</span>';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${n.toFixed(digits)}</span>`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const round1 = (n) => Math.round(n * 10) / 10;

/** actual − projected, or null when either half is missing. */
function diff(actual, projected) {
  if (typeof actual !== 'number' || typeof projected !== 'number') return null;
  return round1(actual - projected);
}

/** "Dane Ashworth" -> "D. Ashworth". Seven names per row need the room. */
function shortName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2 || !parts[0]) return String(name);
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

// Child traversal rather than tBodies/rows/cells, matching sortable.js: it copes
// with a table that omits <tbody> and keeps this module testable off-browser.
function bodyOf(table) {
  return Array.from(table.children).find((c) => c.tagName === 'TBODY') || null;
}

// Sort order for the Slot column: starters in lineup order, then bench, then IR.
// Sorting on the visible text would put "BE" above "QB", which is nonsense.
const SLOT_ORDER = {
  0: 1, 1: 1,               // QB / team QB
  2: 2,                     // RB
  4: 3,                     // WR
  6: 4,                     // TE
  3: 5, 5: 5, 23: 5,        // the flex family
  7: 6,                     // OP — reads next to the flex, but it can hold a QB,
                            // so the grid's FLEX rule must never treat it as one
  16: 7,                    // D/ST
  17: 8,                    // K
  18: 9, 19: 10,            // P, HC
  20: 50,                   // bench
  21: 51,                   // IR
};

const INJURY_LABELS = {
  QUESTIONABLE: 'Q',
  DOUBTFUL: 'D',
  OUT: 'OUT',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'SUSP',
  DAY_TO_DAY: 'DTD',
};

/**
 * Three tiers, not two. His sheet colours IR darker than OUT because they mean
 * different things to a manager: OUT is one week to cover, IR is a roster spot
 * gone for a month. They used to share one red here.
 */
function injuryTier(status) {
  if (status === 'INJURY_RESERVE') return 'ir';
  if (status === 'OUT' || status === 'SUSPENSION') return 'out';
  if (!status || status === 'ACTIVE' || status === 'NORMAL') return '';
  return 'q';
}

function injuryCell(status) {
  const tier = injuryTier(status);
  if (!tier) return '<td class="left muted" data-v="">—</td>';
  const label = INJURY_LABELS[status] || status.replace(/_/g, ' ');
  const cls = tier === 'q' ? 'inj' : `inj ${tier}`;
  return `<td class="left" data-v="${esc(label)}"><span class="${cls}">${esc(label)}</span></td>`;
}

// -------------------------------------------------------------- the team grid

// One row per team, one column per lineup spot. No D/ST and no kicker: the
// owner keeps them out because they are interchangeable, and their contribution
// is carried by the flat allowance in Est Total instead.
const GRID_SLOTS = [
  { key: 'QB', eligible: ['QB'] },
  { key: 'RB1', eligible: ['RB'] },
  { key: 'RB2', eligible: ['RB'] },
  { key: 'WR1', eligible: ['WR'] },
  { key: 'WR2', eligible: ['WR'] },
  { key: 'TE', eligible: ['TE'] },
  // Best of what is left, and RB/WR/TE only — a superflex QB is not a flex.
  { key: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
];

/**
 * A player's typical week: ESPN's season projection spread over the season.
 *
 * Falls back to this week's projection for anyone ESPN has no season line for
 * — a just-signed body, a deep bench flier — because a number on a slightly
 * different footing beats a hole in the grid.
 */
function avgWeek(p) {
  if (typeof p.seasonProjected === 'number' && p.seasonProjected > 0) {
    return round1(p.seasonProjected / SEASON_GAMES);
  }
  return typeof p.projected === 'number' ? round1(p.projected) : null;
}

/**
 * Fill the grid's seven spots for one team.
 *
 * Chosen by position and average rather than by ESPN's lineupSlotId, because
 * the slot label only says where a manager parked someone. Two RBs in a league
 * with an RB/WR flex land in RB1/RB2 and the flex goes to whoever is genuinely
 * next best, which is the comparison the owner is actually making.
 */
function gridLineup(team) {
  const from = team.starters.length ? team.starters : team.players;
  const pool = from
    .filter((p) => p.position !== 'DST' && p.position !== 'K')
    .map((p) => ({ p, avg: avgWeek(p) }))
    .sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity));

  const used = new Set();
  const row = {};
  for (const slot of GRID_SLOTS) {
    // The pool is already best-first, so "the next eligible one" IS the best.
    const pick = pool.find((e) => !used.has(e) && slot.eligible.includes(e.p.position));
    if (pick) used.add(pick);
    row[slot.key] = pick || null;
  }
  return row;
}

/** What the seven score between them if everyone has an ordinary week. */
function baselineOf(row) {
  const vals = GRID_SLOTS.map((s) => row[s.key]?.avg).filter((v) => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, v) => a + v, 0)) : null;
}

function slotCell(entry, isFlex) {
  if (!entry) return '<td class="left slot-cell muted" data-v="">—</td>';
  const { p, avg } = entry;
  const cls = ['left', 'slot-cell'];
  const tier = injuryTier(p.injuryStatus);
  if (tier === 'out' || tier === 'ir') cls.push(`st-${tier}`);
  if (isFlex) cls.push('is-flex');
  const tip = `${p.name} · ${p.position} · ${p.proTeam}${tier ? ` · ${p.injuryStatus}` : ''}`;
  return (
    `<td class="${cls.join(' ')}" data-v="${avg ?? ''}" title="${esc(tip)}">` +
    `<span class="pn">${esc(shortName(p.name))}</span> ` +
    `<span class="pa">${fmt(avg)}</span></td>`
  );
}

// -------------------------------------------------------------------- sources

// demo-rosters.js is written by a separate pass. Load it lazily so a missing or
// broken file degrades into a clear message instead of a blank page.
let demoGenerator;
async function getDemoGenerator() {
  if (demoGenerator !== undefined) return demoGenerator;
  try {
    const mod = await import('./demo-rosters.js');
    demoGenerator =
      typeof mod.generateDemoWeekRosters === 'function' ? mod.generateDemoWeekRosters : null;
  } catch {
    demoGenerator = null;
  }
  return demoGenerator;
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/**
 * The status line, rebuilt from current state.
 *
 * Built rather than written at the point of the fetch, because a cache hit used
 * to skip the write entirely: flipping back to a week already loaded left the
 * note describing whichever week had been fetched last.
 */
function describeSource() {
  if (state.source === 'demo') {
    return `Generated sample rosters for week ${state.week} — not your real league.`;
  }
  const teams = state.data ? state.data.teams.length : 0;
  const played = state.playedWeeks.includes(state.week);
  return (
    `Week ${state.week} · ${teams} team${teams === 1 ? '' : 's'} from ESPN` +
    (played
      ? '.'
      : ' · <strong>not played yet</strong> — projections only, actual points arrive after kickoff.')
  );
}

async function loadWeek() {
  const key = `${state.source}:${state.week}`;
  if (cache.has(key)) {
    state.data = cache.get(key);
    render();
    setStatus(describeSource());
    return;
  }

  state.data = null;
  render(); // show the empty state while the fetch is in flight

  // Nothing here is instant, and the connection bar can flip the page to live
  // mid-fetch. A reply that no longer matches what is selected is dropped
  // rather than painted over the top of the newer one.
  const stale = () => `${state.source}:${state.week}` !== key;

  if (state.source === 'demo') {
    const generate = await getDemoGenerator();
    if (stale()) return;
    if (!generate) {
      setStatus(
        'Demo roster data isn’t available yet (js/demo-rosters.js is missing). ' +
        'Switch to <strong>My ESPN league</strong> to see real rosters.',
        true
      );
      return;
    }
    state.data = generate(state.week);
  } else {
    setStatus(`Loading week ${state.week} rosters from ESPN…`);
    let loaded;
    try {
      loaded = await fetchWeekRosters(state.week);
    } catch (err) {
      if (stale()) return;
      // Don't strand the page on a half-live state: fall all the way back so
      // the badge, the week list and the tables agree with each other.
      await fallBackToDemo(err.message);
      return;
    }
    if (stale()) return;
    state.data = loaded;
  }

  cache.set(key, state.data);
  render();
  setStatus(describeSource());
}

/** Put the segmented control where the code says we are, not where a click did. */
function setToggle(source) {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === source));
}

async function useDemo() {
  state.source = 'demo';
  state.isDemo = true;
  state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  state.playedWeeks = state.weeks.slice(); // the demo season is over by definition
  if (!state.weeks.includes(state.week)) state.week = DEMO_WEEKS;
  setToggle('demo');
  renderWeekPicker();
  await loadWeek();
}

/** Every failed route into live mode ends here, so none of them can lie. */
async function fallBackToDemo(message) {
  await useDemo();
  setStatus(message, true);
}

async function useLive() {
  // The bar writes ff.connection and this page used to read ff.config, so the
  // bar could say "Connected" while this button insisted no league was set up.
  const saved = savedConfig();
  if (!saved) {
    await fallBackToDemo('No league connected yet. Set one up on the Connection page first.');
    return;
  }
  if (saved.teamId != null) state.myTeamId = Number(saved.teamId);

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.source = 'live';
  state.isDemo = false;
  setToggle('live');
  cache.clear();

  setStatus('Reading the league schedule…');
  let scheduleWeeks = [];
  try {
    const schedule = await fetchSchedule();
    scheduleWeeks = schedule.weeks || [];
    state.playedWeeks = [...new Set(schedule.games.filter((g) => g.played).map((g) => g.week))]
      .sort((a, b) => a - b);
  } catch {
    state.playedWeeks = [];
  }
  state.weeks = scheduleWeeks.length
    ? scheduleWeeks
    : Array.from({ length: NFL_WEEKS }, (_, i) => i + 1);

  // Which week to open on. NOT the last week offered: before the first kickoff
  // nothing has been played, the offered list is the whole regular season, and
  // "last" meant week 14+ of a season that has not happened — so the page went
  // and fetched rosters for it. Last week actually played, else week one.
  const remembered = prefs.get('week', null);
  state.week = state.weeks.includes(remembered)
    ? remembered
    : state.playedWeeks.length
      ? state.playedWeeks[state.playedWeeks.length - 1]
      : state.weeks[0];

  renderWeekPicker();
  await loadWeek();
}

// --------------------------------------------------------------------- render

function render() {
  $('modeBadge').className = 'badge ' + (state.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = state.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = state.isDemo
    ? 'Generated sample rosters so you can see the layout with a full league in it.'
    : `Your ESPN league · ${espn.getConfig().season} season`;

  $('overviewTitle').textContent = `All teams · week ${state.week}`;

  // Settled before anything paints: the grid highlights the drilled-into row,
  // so it has to know which one that is before it draws it.
  resolveTeam();
  renderOverview();
  renderTeamPicker();
  renderRoster();
}

/**
 * Hold the drill-down selection across weeks when that manager is still in the
 * league, then prefer the reader's own team over whoever happens to be first.
 */
function resolveTeam() {
  const teams = state.data ? state.data.teams : [];
  if (teams.some((t) => t.id === state.teamId)) return;
  const mine = teams.find((t) => t.id === state.myTeamId);
  state.teamId = mine ? mine.id : teams.length ? teams[0].id : null;
}

function renderWeekPicker() {
  // `selected` in the markup rather than assigning .value, so the option list
  // and the selection are written in one go and can't fall out of step.
  $('weekSelect').innerHTML = state.weeks
    .map((w) => `<option value="${w}"${w === state.week ? ' selected' : ''}>Week ${w}</option>`)
    .join('');
}

function renderOverview() {
  const table = $('overviewTable');
  const tbody = bodyOf(table);
  const teams = state.data ? state.data.teams : [];

  $('overviewWrap').classList.toggle('hidden', teams.length === 0);
  $('overviewEmpty').classList.toggle('hidden', teams.length > 0);

  tbody.innerHTML = teams
    .map((t) => {
      const row = gridLineup(t);
      const base = baselineOf(row);
      const est = base === null ? null : round1(base + KDST_ALLOWANCE);
      // "picked" is the drill-down; "me" stays reserved for the reader's own
      // team, and only means anything once a real league says which that is.
      const cls = [
        t.id === state.teamId ? 'picked' : '',
        !state.isDemo && t.id === state.myTeamId ? 'me' : '',
      ].filter(Boolean).join(' ');
      return `
      <tr class="${cls}" data-team="${t.id}" title="Show ${esc(t.name)} below">
        <td class="name">${esc(t.name)}</td>
        ${GRID_SLOTS.map((s) => slotCell(row[s.key], s.key === 'FLEX')).join('')}
        <td data-v="${base ?? ''}">${fmt(base)}</td>
        <td data-v="${est ?? ''}"><strong>${fmt(est)}</strong></td>
        <td>${fmt(t.projectedTotal)}</td>
        <td>${fmt(t.actualTotal)}</td>
      </tr>`;
    })
    .join('');

  resort(table); // keep whatever sort the user picked across week changes
}

function renderTeamPicker() {
  const teams = state.data ? state.data.teams : [];
  $('teamSelect').innerHTML = teams
    .map(
      (t) =>
        `<option value="${t.id}"${t.id === state.teamId ? ' selected' : ''}>${esc(t.name)}</option>`
    )
    .join('');
}

function currentTeam() {
  if (!state.data || state.teamId === null) return null;
  return state.data.teams.find((t) => t.id === state.teamId) || null;
}

function renderRoster() {
  const table = $('rosterTable');
  const tbody = bodyOf(table);
  const team = currentTeam();
  const players = team ? team.players : [];

  $('rosterTitle').textContent = team ? `Roster detail · ${team.name}` : 'Roster detail';
  $('rosterWrap').classList.toggle('hidden', players.length === 0);
  $('rosterEmpty').classList.toggle('hidden', players.length > 0);

  if (!players.length) {
    // Three different situations used to share one message, and the one it
    // chose — "Pick a team" — was wrong precisely when a team WAS picked and
    // the source had returned nothing for it.
    $('rosterEmpty').textContent = !team
      ? state.data
        ? 'Pick a team to see its roster.'
        : 'No roster data for this week.'
      : `No players came back for ${team.name} in week ${state.week}.`;
    $('teamGlance').innerHTML = '';
    $('rosterNote').textContent = '';
    tbody.innerHTML = '';
    return;
  }

  const grid = gridLineup(team);
  const base = baselineOf(grid);
  const flexId = grid.FLEX ? grid.FLEX.p.playerId : null;

  const teamDiff = diff(team.actualTotal, team.projectedTotal);
  const glance = [
    ['Week', state.week],
    ['Baseline week', fmt(base)],
    ['Est Total', fmt(base === null ? null : round1(base + KDST_ALLOWANCE))],
    ['Projected', fmt(team.projectedTotal)],
    ['Actual', fmt(team.actualTotal)],
    ['Diff', signed(teamDiff)],
    ['Bench points', fmt(team.benchActualTotal)],
    ['Starters', team.starters.length],
    ['Bench', team.bench.length],
  ];
  $('teamGlance').innerHTML = glance
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  tbody.innerHTML = players
    .map((p) => {
      const d = diff(p.actual, p.projected);
      const order = SLOT_ORDER[p.lineupSlotId] ?? 40;
      const avg = avgWeek(p);
      const own = typeof p.percentOwned === 'number' ? `${p.percentOwned.toFixed(0)}%` : '—';
      const tier = injuryTier(p.injuryStatus);
      const cls = [
        p.started ? '' : 'bench',
        tier === 'out' || tier === 'ir' ? `st-${tier}` : '',
      ].filter(Boolean).join(' ');
      const isFlex = flexId !== null && p.playerId === flexId;
      return `
      <tr class="${cls}">
        <td class="left" data-v="${order}"><span class="slot-tag">${esc(p.slot)}</span></td>
        <td class="name${isFlex ? ' is-flex' : ''}">${esc(p.name)}</td>
        <td class="left">${esc(p.position)}</td>
        <td class="left">${esc(p.proTeam)}</td>
        <td>${fmt(p.projected)}</td>
        <td>${fmt(p.actual)}</td>
        <td data-v="${d === null ? '' : d}">${signed(d)}</td>
        <td>${fmt(avg)}</td>
        <td>${fmt(p.seasonProjected, 0)}</td>
        <td class="own" data-v="${typeof p.percentOwned === 'number' ? p.percentOwned : ''}">${own}</td>
        ${injuryCell(p.injuryStatus)}
      </tr>`;
    })
    .join('');

  // ESPN's roster view carries ownership only sometimes, and a column of ten em
  // dashes is worse than no column. Hidden rather than removed, so the sort
  // machinery's column indexes stay where they are.
  const hasOwn = players.some((p) => typeof p.percentOwned === 'number');
  table.classList.toggle('no-own', !hasOwn);

  const hurt = players.filter((p) => injuryTier(p.injuryStatus)).length;
  $('rosterNote').textContent =
    `Bench rows are dimmed and the flex player is in bold. Red is out this week, dark red is ` +
    `on IR. Season total is the whole ${SEASON_GAMES}-game projection; Avg/wk is that same ` +
    `number per game, which is what the grid above adds up. ` +
    `${hurt} player${hurt === 1 ? '' : 's'} carrying an injury designation this week.`;

  resort(table);
}

/** Selecting a team touches three places, so nobody calls them separately. */
function selectTeam(id) {
  if (id === null || Number.isNaN(id) || id === state.teamId) return;
  state.teamId = id;
  prefs.set('team', id);
  // Nudged rather than re-rendered: this also runs from the select's own change
  // handler, and rewriting a control's options underneath it loses focus.
  const sel = $('teamSelect');
  if (sel.value !== String(id)) sel.value = String(id);
  renderOverview(); // the picked row is highlighted in the grid too
  renderRoster();
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  // Only a deliberate click is remembered. If the code picked the source — a
  // failed live switch, or the connection bar coming online — the reader has
  // expressed no preference and shouldn't be pinned to the result of it.
  prefs.set('source', btn.dataset.src);
  setToggle(btn.dataset.src);
  btn.dataset.src === 'demo' ? useDemo() : useLive();
});

$('weekSelect').addEventListener('change', (e) => {
  state.week = Number(e.target.value);
  prefs.set('week', state.week);
  loadWeek();
});

$('teamSelect').addEventListener('change', (e) => {
  selectTeam(Number(e.target.value));
});

// Clicking anywhere on a team's row drills into it — the grid is the thing
// people scan, so making them go back to the select below to act on what they
// found would be a step for nothing.
$('overviewTable').addEventListener('click', (e) => {
  const tr = e.target.closest && e.target.closest('tr[data-team]');
  if (tr) selectTeam(Number(tr.dataset.team));
});

// The grid is the reason to be here, so it opens on the number that ranks teams
// before anyone has played: Est Total, high first. Actual points was the old
// default and is entirely null in week 1, which sorted into insertion order.
enableSort($('overviewTable'), { defaultIndex: 9 });
enableSort($('rosterTable'), { defaultIndex: 0, defaultAsc: true });

// ------------------------------------------------------------------- start up

const boot = savedConfig();
if (boot && boot.teamId != null) state.myTeamId = Number(boot.teamId);

const rememberedTeam = prefs.get('team', null);
if (rememberedTeam !== null) state.teamId = rememberedTeam;

const rememberedWeek = prefs.get('week', null);
if (rememberedWeek !== null) state.week = rememberedWeek;

if (prefs.get('source') === 'live' && boot) useLive();
else useDemo();

// Go live on its own once the bar finishes its round trip — the demo data is a
// stand-in for a league we can now actually read. Only someone who has clicked
// "Demo data" on purpose is left where they are.
onConnection((conn) => {
  if (!conn) return;
  if (conn.teamId != null) state.myTeamId = Number(conn.teamId);
  if (state.source !== 'live' && prefs.get('source') !== 'demo') useLive();
  else if (!state.isDemo) renderOverview(); // "your team" may have just changed
});
