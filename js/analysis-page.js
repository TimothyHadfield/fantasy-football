// Roster analysis: every manager's squad, side by side.
//
// The two grids at the top are the point of the page. The owner's standing
// request is to see the most important information for ALL teams at once, and
// this page once showed ten rows of totals plus exactly ONE team's actual
// players — so working out who was thin at running back meant clicking through
// ten managers and holding it in your head. The grids put all ten squads on one
// screen, whole: nine lineup spots, what they total, and the bench behind them.
//
// They are the SAME table twice over, measured two ways — a typical week in the
// first, the week selected at the top of the page in the second — so the
// comparison a manager actually wants ("is this team better now than it usually
// is?") is reading straight down the page rather than holding two numbers in
// your head. Everything below them is a drill-down.
//
// Rosters move week to week — trades, waivers, injuries — so the week selector
// stays the primary control. Everything else re-renders from whatever is picked.

import { fetchWeekRosters, fetchWeeksRosters, fetchSchedule } from './season.js';
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

// The D/ST and the kicker used to be a flat 16-point allowance on top of a
// seven-man baseline, on the grounds that both get streamed constantly and
// naming them would be churn. They are real columns now — Tim's call — so the
// grid totals nine actual men and there is no allowance to add.

const state = {
  source: 'demo',
  week: DEMO_WEEKS,
  weeks: [],        // weeks offered in the dropdown
  playedWeeks: [],  // of those, the ones that have actually been played
  data: null,       // {week, teams:[...]} for the selected week
  teamId: null,     // team shown in the roster detail
  myTeamId: null,   // the reader's own team, when a live league says so
  isDemo: true,

  // The season-by-week panel at the foot of the page. It costs one request per
  // week, so everything about it is built to be paid for once: the cache is
  // keyed on the LEAGUE, not on the team, because every team is in every week's
  // payload already and switching teams must therefore be a repaint.
  seasonKey: null,              // which league seasonWeeks belongs to
  seasonWeeks: new Map(),       // week -> that week's teams array
  seasonFailed: new Set(),      // weeks ESPN would not answer for
  seasonPending: null,          // key of a run currently in flight
  seasonProgress: null,         // { done, total } while weeks are arriving
  seasonError: null,            // the whole run fell over
  seasonToken: 0,               // drops an answer about a league we have left

  // The what-if lineup in the roster detail. `lineup` holds only the slots that
  // DIFFER from ESPN's, so "has anything been changed" is just its size, and
  // swapping a man back where he started removes him from it rather than
  // recording a change that isn't one. `held` is the player picked up and
  // waiting for somewhere to go. Both belong to one team in one week of one
  // league, so `lineupKey` throws them away when any of those changes.
  lineupKey: null,
  lineup: new Map(),            // playerId -> the slot the reader has put him in
  held: null,                   // playerId picked up for a swap, or null
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------- player references
//
// Tim's rule, in his own words: "if you ever click on a player's name (or a
// number that refers to the player), it will bring you directly to their
// position in the players section and show you their next 13 weeks proj."
//
// So every reference to a specific man on this page — the numbers in the two
// grids, the names in the roster detail and in the season grid — is a link to
// his row on the Players page. Three things about it are not negotiable:
//
//   - It is a real <a href>, never a click handler, so middle-click and
//     open-in-new-tab work the way the reader already expects them to.
//   - It carries ESPN's own playerId, the same number `data-swap` and
//     `state.lineup` use. Never a name, never a row index: the destination
//     looks him up by that id and nothing else can identify him.
//   - The class is always `pref`, so the destination side, the stylesheet and
//     the tests all have one selector between them.

/** Where a player reference goes, said the same way everywhere. */
const OPENS = 'open his next 13 weeks on the Players page';

/**
 * Wrap `inner` in a link to this player's row on the Players page.
 *
 * `inner` is markup that is already escaped — the number, the name, the
 * position span beside a bench number — and the link never changes it, so
 * wrapping a cell cannot change what the cell reads.
 *
 * A player ESPN gave no id for is handed straight back unwrapped: a link to
 * `?player=undefined` is worse than no link at all, because it looks like it
 * would work.
 */
function playerRef(p, inner, title) {
  if (p.playerId === null || p.playerId === undefined) return inner;
  return (
    `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" title="${esc(title)}">` +
    `${inner}</a>`
  );
}

/** "weeks 1–13" / "week 4" — an en dash, the way the rest of the site writes ranges. */
function weekRange(weeks) {
  if (!weeks.length) return 'no weeks';
  if (weeks.length === 1) return `week ${weeks[0]}`;
  return `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
}

/** "5 and 7" / "5, 7 and 9" — for naming the weeks that failed. */
function andList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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

// ESPN's own slot ids for the two places that are not a lineup spot.
const BENCH_SLOT = 20;
const IR_SLOT = 21;

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

// -------------------------------------------------------------- the team grids
//
// Two tables of the same shape, one row per team: nine lineup spots, what those
// nine total, and then the bench behind them. The only difference between the
// two is the number in every cell — a typical week in one, the week selected at
// the top of the page in the other — so they are built by one renderer handed a
// different MEASURE, and comparing them is reading straight down the page.
//
// NO NAMES in the cells. Ten teams across nine spots plus a bench is a wide
// table, and a name is the widest thing that could be in a cell while being the
// thing you least need to compare two teams. Every name is on hover, and the
// roster detail below names everybody.

// The nine spots. D/ST and the kicker are real columns now rather than a flat
// allowance, so the total is nine actual men.
const GRID_SLOTS = [
  { key: 'QB', eligible: ['QB'] },
  { key: 'RB1', eligible: ['RB'] },
  { key: 'RB2', eligible: ['RB'] },
  { key: 'WR1', eligible: ['WR'] },
  { key: 'WR2', eligible: ['WR'] },
  { key: 'TE', eligible: ['TE'] },
  // Best of what is left, and RB/WR/TE only — a superflex QB is not a flex.
  { key: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
  { key: 'DEF', eligible: ['DST'] },
  { key: 'K', eligible: ['K'] },
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

/** This week's own projection, which is what the second grid is made of. */
function weekProj(p) {
  return typeof p.projected === 'number' ? round1(p.projected) : null;
}

/**
 * Fill the grid's nine spots for one team.
 *
 * Chosen by position and by the measure rather than by ESPN's lineupSlotId,
 * because the slot label only says where a manager parked someone. Two RBs in
 * a league with an RB/WR flex land in RB1/RB2 and the flex goes to whoever is
 * genuinely next best, which is the comparison the owner is actually making.
 *
 * The pool is who the manager has STARTING, not the whole roster: the bench
 * gets its own columns to the right, and a man cannot be in both.
 */
function gridLineup(team, measure = avgWeek) {
  const from = team.starters.length ? team.starters : team.players;
  const pool = from
    .map((p) => ({ p, v: measure(p) }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));

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

/** The bench behind those nine, best first by the same measure. */
function benchEntries(team, measure = avgWeek) {
  return (team.bench || [])
    .map((p) => ({ p, v: measure(p) }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
}

/** What the nine score between them. The real sum, not an estimate. */
function totalOf(row) {
  const vals = GRID_SLOTS.map((s) => row[s.key] && row[s.key].v).filter((v) => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, v) => a + v, 0)) : null;
}

// ------------------------------------------------ the week run on the hover
//
// A grid cell is one number standing for one man, and the question it always
// provoked was "yes, but is that his week, or is that him?". So the hover now
// carries his whole season under the identity line: every week ESPN projects
// for him, in week order.
//
// IT COSTS NOTHING. The numbers are already bought — the season panel at the
// foot of the page spends one request per week and there is no bulk form, which
// is this page's entire cost model — and `seasonIndex`/`seasonValue` already
// turn that cache into exactly this shape. This is that machinery read a second
// way, not a second copy of it, and no fetch belongs anywhere near here.

/** Five weeks to a line. Thirteen on one line is a 100-character wall; five
 *  lands each line at about the width of the identity line above it, and 13
 *  weeks comes out as 5 + 5 + 3 rather than an awkward pair of long rows. */
const RUN_PER_LINE = 5;

/**
 * How a week reads in the run.
 *
 * The three ways of having no number stay three different things, exactly as
 * they are in the season grid — that table tells them apart by class, and a
 * plain-text tooltip has to tell them apart by word.
 */
function runToken(v) {
  if (v === 'wait') return '…';
  if (v === 'failed') return '—';
  if (v === 'off') return 'off';
  if (v === null) return '—';
  // Only ESPN means "no game that week" by a 0.00. The sample data means "we
  // have ruled him out", so demo prints the number rather than claiming a bye
  // it cannot know about — the same rule seasonCell() follows.
  if (v === 0 && !state.isDemo) return 'Bye';
  return fmt(v);
}

/** Explained only when it actually turns up, so a clean run has no legend. */
const RUN_KEYS = [
  ['Bye', 'Bye = the 0.00 ESPN returns for a player whose NFL team is off that week'],
  ['—', '— = ESPN carried no number for him that week'],
  ['off', 'off = he was not on this roster that week'],
  ['…', '… = that week has not been read from ESPN yet'],
];

/**
 * One player's whole season as lines of text for a native `title`.
 *
 * Native, deliberately: a `title` needs no focus management, no touch story and
 * no z-index, and it already carries newlines. A hover card of our own would be
 * a far larger change for a tooltip that is read for two seconds.
 *
 * The weeks arrive in batches behind the page, so this has to read correctly
 * when they are not all in — which is why an unread week is its own token and
 * why a run with nothing in it yet says so in words instead of printing
 * thirteen dots.
 */
function seasonRun(index, p) {
  const weeks = state.weeks;
  if (!index || !weeks.length) return '';

  const values = weeks.map((w) => seasonValue(index, w, p.playerId));
  const heading = state.isDemo
    ? `Sample projections for ${weekRange(weeks)}`
    : `ESPN’s projection for ${weekRange(weeks)}`;

  if (values.every((v) => v === 'wait')) {
    return `${heading}: not read yet — they fill in behind the page.`;
  }

  const tokens = values.map((v, i) => `W${weeks[i]} ${runToken(v)}`);
  const lines = [];
  for (let i = 0; i < tokens.length; i += RUN_PER_LINE) {
    lines.push(tokens.slice(i, i + RUN_PER_LINE).join('  '));
  }

  const used = new Set(values.map(runToken));
  const legend = RUN_KEYS.filter(([t]) => used.has(t)).map(([, s]) => s);
  return [`${heading}:`, ...lines, ...legend].join('\n');
}

/**
 * The season cache, but only when it belongs to the league on screen.
 *
 * Team ids collide across leagues, and there is one paint — between a source
 * switch and the ensureSeasonWeeks() that resets the cache — where the old
 * league's weeks are still in hand. Reading them there would put another
 * league's numbers on a hover, which is worse than an empty one.
 */
function seasonIndexFor(teamId) {
  if (state.seasonKey !== sourceKey()) return null;
  return seasonIndex(teamId);
}

/**
 * One cell.
 *
 * `withPosition` is what the bench columns use. A bench column cannot be headed
 * by a position the way a lineup spot can — every team's bench is a different
 * shape — so the position rides next to the number instead. The lineup columns
 * do not repeat it, because their header already says it.
 *
 * `index` is that team's season cache, built once per row by renderGrid, and it
 * is what puts the week run on the hover.
 */
function gridCell(entry, { withPosition = false, byeAtZero = false, index = null } = {}) {
  if (!entry) return '<td class="slot-cell muted">—</td>';

  const { p, v } = entry;
  const cls = ['slot-cell'];
  const tier = injuryTier(p.injuryStatus);
  if (tier === 'out' || tier === 'ir') cls.push(`st-${tier}`);

  // ESPN's 0.00 in a WEEK is how it says "no game that week". Only the week
  // grid may read a zero that way: a season average of zero is a man ESPN
  // projects nothing for all year, which is a different fact. And the sample
  // data means something else again by a zero — it pins a player it has ruled
  // out — so demo prints the number, the same rule the season grid follows.
  const bye = v === 0 && byeAtZero;
  if (bye) cls.push('bye');

  // The identity line first — name, position, NFL team, injury — and then his
  // whole season under it. A `title` carries newlines, so both fit in one.
  const ident =
    `${p.name} · ${p.position} · ${p.proTeam}${tier ? ` · ${p.injuryStatus}` : ''}` +
    (bye ? ' · on bye this week, which is what ESPN’s 0.00 means' : '');
  const run = seasonRun(index, p);
  const tip = run ? `${ident}\n${run}` : ident;

  const shown = v === null ? '—' : bye ? 'Bye' : fmt(v);

  // The whole of the cell goes inside the link, the bench cell's position span
  // included. The number and the position are two halves of one statement about
  // one man, so splitting them would leave a dead strip in the middle of a cell
  // that is already only a few characters wide.
  const inner = `${shown}${withPosition ? ` <span class="pp">${esc(p.position)}</span>` : ''}`;

  // `data-v` stays on the <td>, OUTSIDE the link: sortable.js reads the sort key
  // off the cell, and a key that moved inside an anchor would silently unsort
  // every column in both grids. The <td> keeps its own title as well, so the
  // hover is unchanged for anyone who lands on the cell's padding rather than
  // on the number; the link repeats it and says where clicking would go.
  return (
    `<td class="${cls.join(' ')}"${v === null ? '' : ` data-v="${v}"`} title="${esc(tip)}">` +
    `${playerRef(p, inner, `${tip}\nClick to ${OPENS}.`)}</td>`
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

  // Settled before anything paints: the grids highlight the drilled-into row,
  // so they have to know which one that is before they draw it.
  resolveTeam();
  renderOverview();
  renderTeamPicker();
  renderRoster();
  renderSeason();

  // Last, and deliberately not awaited: the season grid costs one request per
  // week, so everything above is on screen before it starts spending them.
  ensureSeasonWeeks();
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

/**
 * The two grids, and everything that differs between them.
 *
 * They are the same table twice over — same rows, same nine spots, same bench —
 * measured two different ways, so one renderer builds both and the pair can be
 * read straight down the page.
 */
const GRIDS = [
  {
    id: 'overview',
    measure: avgWeek,
    heading: () => `All teams · proj avg ${espn.getConfig().season}`,
  },
  {
    id: 'weekly',
    measure: weekProj,
    heading: () => `All teams · week ${state.week}`,
    // Only a week's number can be a bye, and only ESPN means it that way.
    byeAtZero: () => !state.isDemo,
  },
];

/** The bench is as deep as the deepest bench, so every row has the same shape. */
function benchWidth(teams) {
  return teams.reduce((n, t) => Math.max(n, (t.bench || []).length), 0);
}

function renderGridHead(table, benchCols) {
  const benchTip =
    'the bench, best first by the column this table is measured in. Every team’s bench is a ' +
    'different shape, so the position is in the cell rather than in this header.';
  const bench = Array.from({ length: benchCols }, (_, i) =>
    `<th data-sort${i === 0 ? ' class="grouped"' : ''} ` +
    `title="Bench ${i + 1} of ${benchCols} — ${benchTip}">B${i + 1}</th>`
  ).join('');

  table.querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort>Team</th>
       ${GRID_SLOTS.map((s) => `<th data-sort>${esc(s.key)}</th>`).join('')}
       <th class="grid-total grouped" data-sort title="The nine spots to the left added up. ` +
         `Nine real men, not an estimate.">Total</th>
       ${bench}
     </tr>`;
}

function renderGrid(grid) {
  const table = $(`${grid.id}Table`);
  const teams = state.data ? state.data.teams : [];
  const benchCols = benchWidth(teams);

  $(`${grid.id}Title`).textContent = grid.heading();
  $(`${grid.id}Wrap`).classList.toggle('hidden', teams.length === 0);
  $(`${grid.id}Empty`).classList.toggle('hidden', teams.length > 0);

  renderGridHead(table, benchCols);

  const opts = { byeAtZero: grid.byeAtZero ? grid.byeAtZero() : false };
  bodyOf(table).innerHTML = teams
    .map((t) => {
      const row = gridLineup(t, grid.measure);
      const total = totalOf(row);
      const bench = benchEntries(t, grid.measure);
      // "picked" is the drill-down; "me" stays reserved for the reader's own
      // team, and only means anything once a real league says which that is.
      const cls = [
        t.id === state.teamId ? 'picked' : '',
        !state.isDemo && t.id === state.myTeamId ? 'me' : '',
      ].filter(Boolean).join(' ');
      // Built once per row, not once per cell: seventeen cells share one team's
      // week cache, and it is what puts the season run on every hover.
      const cellOpts = { ...opts, index: seasonIndexFor(t.id) };
      const benchCells = Array.from({ length: benchCols }, (_, i) =>
        gridCell(bench[i] || null, { ...cellOpts, withPosition: true })).join('');
      return `
      <tr class="${cls}" data-team="${t.id}" title="Show ${esc(t.name)} below">
        <td class="name">${esc(t.name)}</td>
        ${GRID_SLOTS.map((s) => gridCell(row[s.key], cellOpts)).join('')}
        <td class="grid-total grouped" data-v="${total ?? ''}"><strong>${fmt(total)}</strong></td>
        ${benchCells}
      </tr>`;
    })
    .join('');

  resort(table); // keep whatever sort the user picked across week changes
}

function renderOverview() {
  for (const grid of GRIDS) renderGrid(grid);
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

// ------------------------------------------------------------ the what-if lineup
//
// The roster detail lets you move a man out of the starting lineup and another
// in, and shows what that does to the total. It is a WHAT-IF and nothing else.
// Nothing here is ever sent to ESPN — writes are a later phase and will go
// behind the extension popup, never behind an open page — so the only place a
// changed lineup exists is the override map below, and it is gone the moment
// you change team, week or league. The note says so in as many words.

/** Which team, in which week, of which league the overrides belong to. */
function lineupKeyNow() {
  return `${sourceKey()}:${state.week}:${state.teamId}`;
}

/** Drop the what-if when it stops being about the squad on screen. */
function syncLineup() {
  const key = lineupKeyNow();
  if (state.lineupKey === key) return;
  state.lineupKey = key;
  state.lineup = new Map();
  state.held = null;
}

/** Whether the reader has moved anybody at all. */
const lineupEdited = () => state.lineup.size > 0;

/**
 * The roster as the page is showing it: ESPN's lineup with the reader's swaps
 * applied on top. One shape, used by both panels below, so the two can never
 * disagree about who is starting.
 */
function rosterView(team) {
  syncLineup();
  return (team ? team.players : []).map((p) => {
    const slotId = state.lineup.has(p.playerId) ? state.lineup.get(p.playerId) : p.lineupSlotId;
    return {
      p,
      slotId,
      slot: espn.SLOT_LABELS[slotId] ?? String(slotId),
      started: slotId !== BENCH_SLOT && slotId !== IR_SLOT,
      moved: slotId !== p.lineupSlotId,
    };
  });
}

/**
 * Sum one of a player's numbers over a set of entries.
 *
 * Deliberately the same rule season.js uses for its own totals: nulls are left
 * out, and all-null is null rather than a real-looking 0.0. That is what makes
 * an unswapped lineup total exactly what ESPN said it would.
 */
function sumOf(entries, key) {
  const vals = entries.map((e) => e.p[key]).filter((v) => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, v) => a + v, 0)) : null;
}

/** Whether a slot may legally hold a player of this position. */
function slotAccepts(slotId, position) {
  if (slotId === BENCH_SLOT) return true;   // the bench takes anyone
  // IR is ESPN's call about an injury, not a lineup choice, so it is not a
  // place this page will move anybody into or out of.
  if (slotId === IR_SLOT) return false;
  const eligible = espn.SLOT_ELIGIBILITY[slotId];
  return Array.isArray(eligible) && eligible.includes(position);
}

/**
 * Two men may trade places only if each is legal where the other is standing.
 *
 * Bench-for-bench is refused because it changes nothing: both totals, both
 * groups and every number on the page would be identical afterwards.
 */
function canSwap(a, b) {
  if (!a || !b || a.p.playerId === b.p.playerId) return false;
  if (a.slotId === IR_SLOT || b.slotId === IR_SLOT) return false;
  if (!a.started && !b.started) return false;
  return slotAccepts(b.slotId, a.p.position) && slotAccepts(a.slotId, b.p.position);
}

/** Record a slot, or forget it again when it is the one ESPN already has. */
function setSlot(p, slotId) {
  if (slotId === p.lineupSlotId) state.lineup.delete(p.playerId);
  else state.lineup.set(p.playerId, slotId);
}

function applySwap(idA, idB) {
  const view = rosterView(currentTeam());
  const a = view.find((e) => e.p.playerId === idA);
  const b = view.find((e) => e.p.playerId === idB);
  if (!canSwap(a, b)) return false;
  setSlot(a.p, b.slotId);
  setSlot(b.p, a.slotId);
  return true;
}

/**
 * The slot cell: a control, not a label.
 *
 * The slot IS what a swap changes, so picking a man up by his slot and putting
 * him down on somebody else's needs no extra column and no extra explanation.
 * The cell keeps its lineup-order sort key either way.
 */
function slotControl(entry, held) {
  const { p, slot, slotId } = entry;
  const cell = (inner) => `<td class="left" data-v="${SLOT_ORDER[slotId] ?? 40}">${inner}</td>`;
  const button = (cls, attrs) =>
    cell(`<button type="button" class="slot-tag${cls}" data-swap="${p.playerId}"${attrs}>` +
      `${esc(slot)}</button>`);

  // IR is ESPN's call about an injury rather than a lineup choice, so its tag
  // stays a plain label — there is nothing here to decide.
  if (slotId === IR_SLOT) {
    return cell(`<span class="slot-tag" title="ESPN has ${esc(p.name)} on injured reserve. ` +
      `He cannot be started, so there is nothing to swap.">${esc(slot)}</span>`);
  }

  if (!held) {
    return button('', ` title="Pick ${esc(p.name)} up, then click another player’s slot to swap ` +
      `the two. A what-if only — nothing is sent to ESPN."`);
  }
  if (held.p.playerId === p.playerId) {
    return button(' holding', ` title="Holding ${esc(p.name)}. Click a highlighted slot to put ` +
      `him there, or click this one again to put him down."`);
  }
  if (canSwap(held, entry)) {
    return button(' target', ` title="Swap ${esc(held.p.name)} into ${esc(slot)} and ` +
      `${esc(p.name)} into ${esc(held.slot)}."`);
  }
  return button('', ` disabled title="${esc(held.p.name)} is a ${esc(held.p.position)} and ` +
    `${esc(p.name)} is a ${esc(p.position)}, so these two cannot trade places."`);
}

/**
 * The row between the two groups: the gap, and the starters' total in it.
 *
 * The total sits in the Projected column it is the total of, not off to one
 * side, so it reads as the column's own sum. When the lineup has been changed
 * it also carries the difference from the one ESPN has, because seeing that
 * number move is the entire reason to be allowed to change it.
 */
function splitRow(proj, espnTotal, held, columns) {
  // Only shown once something has actually been moved: against ESPN's own
  // lineup the difference is zero by construction, and printing "+0.0" would
  // invite the reader to wonder what it was measuring.
  const delta = lineupEdited() ? diff(proj, espnTotal) : null;

  const label = lineupEdited() ? 'Your lineup' : 'Starting lineup';
  const hint = held
    ? `Holding <strong>${playerRef(held.p, esc(held.p.name), `${held.p.name} — ${OPENS}`)}` +
      `</strong> — click a highlighted slot to put him there, or his own again to drop it.`
    : lineupEdited()
      ? 'A what-if only. Nothing on this page is sent to ESPN.'
      : 'Click any slot tag to pick that player up, then click another to swap them.';

  return `<tr class="split-row">
      <td class="split-label" colspan="4">${label}</td>
      <td class="split-total">${fmt(proj)}${
        delta === null ? '' : `<span class="split-delta">${signed(delta)}</span>`
      }</td>
      <td class="split-rest" colspan="${columns - 5}">${hint}</td>
    </tr>`;
}

function renderRoster() {
  const table = $('rosterTable');
  const team = currentTeam();
  const view = rosterView(team);
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
    $('rosterNote').innerHTML = '';
    $('rosterStarters').innerHTML = '';
    $('rosterSplit').innerHTML = '';
    $('rosterBench').innerHTML = '';
    $('lineupReset').classList.add('hidden');
    return;
  }

  const grid = gridLineup(team);
  const avgTotal = totalOf(grid);
  const flexId = grid.FLEX ? grid.FLEX.p.playerId : null;

  const starters = view.filter((e) => e.started);
  const benched = view.filter((e) => !e.started);
  const held = state.held === null ? null : view.find((e) => e.p.playerId === state.held) || null;

  // Totalled from the lineup ON SCREEN rather than taken from ESPN's own team
  // totals, so a swap moves them. With nothing swapped the rule is the one
  // season.js uses, so these are the numbers ESPN gave, to the decimal.
  const projTotal = sumOf(starters, 'projected');
  const actualTotal = sumOf(starters, 'actual');
  const benchActual = sumOf(benched, 'actual');

  const glance = [
    ['Week', state.week],
    ['Proj avg', fmt(avgTotal)],
    ['Projected', fmt(projTotal)],
    ['Actual', fmt(actualTotal)],
    ['Diff', signed(diff(actualTotal, projTotal))],
    ['Bench points', fmt(benchActual)],
    ['Starters', starters.length],
    ['Bench', benched.length],
  ];
  $('teamGlance').innerHTML = glance
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  const row = (entry) => {
    const { p } = entry;
    const d = diff(p.actual, p.projected);
    const avg = avgWeek(p);
    const own = typeof p.percentOwned === 'number' ? `${p.percentOwned.toFixed(0)}%` : '—';
    const tier = injuryTier(p.injuryStatus);
    const cls = [
      entry.started ? '' : 'bench',
      entry.moved ? 'moved' : '',
      tier === 'out' || tier === 'ir' ? `st-${tier}` : '',
    ].filter(Boolean).join(' ');
    const isFlex = flexId !== null && p.playerId === flexId;
    return `
      <tr class="${cls}">
        ${slotControl(entry, held)}
        <td class="name${isFlex ? ' is-flex' : ''}">${
          playerRef(p, esc(p.name), `${p.name} — ${OPENS}`)}</td>
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
  };

  const columns = table.querySelectorAll('thead th').length;
  $('rosterStarters').innerHTML = starters.map(row).join('');
  $('rosterSplit').innerHTML = splitRow(projTotal, team.projectedTotal, held, columns);
  $('rosterBench').innerHTML = benched.map(row).join('');
  $('lineupReset').classList.toggle('hidden', !lineupEdited());

  // ESPN's roster view carries ownership only sometimes, and a column of ten em
  // dashes is worse than no column. Hidden rather than removed, so the sort
  // machinery's column indexes stay where they are.
  const hasOwn = players.some((p) => typeof p.percentOwned === 'number');
  table.classList.toggle('no-own', !hasOwn);

  renderRosterNote(view, team);
  resort(table);
}

/**
 * What the table is, said every time it is shown — including, now, that the
 * lineup in it can be changed and that changing it goes nowhere near ESPN.
 */
function renderRosterNote(view, team) {
  const hurt = view.filter((e) => injuryTier(e.p.injuryStatus)).length;
  const parts = [];

  parts.push(
    `Bench rows are dimmed and the flex player is in bold. Red is out this week, dark red is ` +
    `on IR. Season total is the whole ${SEASON_GAMES}-game projection; Avg/wk is that same ` +
    `number per game, which is what the grid above adds up. ` +
    `${plural(hurt, 'player')} carrying an injury designation this week. ` +
    `<strong>Click any player’s name</strong> to open his next 13 weeks on the ` +
    `<a href="waivers.html">Players</a> page.`
  );

  parts.push(
    'The band across the middle is the line between the starting lineup and the bench, and the ' +
    'number in it is what those starters are projected to score between them — the Projected ' +
    'column added up, which is why it sits in that column. Sorting sorts the two groups ' +
    'separately, so the line stays where it is however you order the table.'
  );

  parts.push(
    '<strong>Click any slot tag</strong> to pick that player up, then click another player’s to ' +
    'swap the two, and watch the total move. Only legal moves are offered: a slot lights up when ' +
    'both men are eligible for each other’s, and a player on IR is not a lineup choice at all. ' +
    '<strong>This is a what-if and nothing else</strong> — nothing on this page is ever sent to ' +
    'ESPN, and the swaps are forgotten the moment you change team or week.'
  );

  if (lineupEdited()) {
    parts.push(
      `<span class="neg">This is not ${team ? `${esc(team.name)}’s` : 'the'} real lineup any ` +
      `more.</span> The number beside the total is the difference from the one ESPN has, and ` +
      `<strong>Proj avg</strong> above deliberately does not move with it: that is the best ` +
      `nine by season average, the same figure the first grid gives this team, and it never ` +
      `depended on how the lineup was set.`
    );
  }

  $('rosterNote').innerHTML = parts.join(' ');
}

// --------------------------------------------- the season-long roster grid
//
// One team's WHOLE roster down the side — starters and bench — and every week
// of the season across the top, each cell being ESPN's own projection for that
// player in that week. It is the Players page's layout pointed at a squad
// instead of at the wire, which is the comparison a manager actually makes
// once the squad exists: who carries this team through the run-in, and which
// week does the bye fall in.
//
// Two things it deliberately does NOT do:
//
//   - It does not colour a cell for being good. Every player here is rostered,
//     so the per-position bar that means something on the waiver wire would
//     light up almost every cell. If a highlight ever belongs in this table it
//     needs a scheme of its own, built against rostered players.
//   - It does not have a team picker. It shares the one above it, so the two
//     panels can never disagree about whose squad you are looking at.
//
// THE COST IS THE DESIGN CONSTRAINT, exactly as on the waivers page: rosters
// come back one week per request and there is no bulk form. So the panel is
// filled in behind the rest of the page, a few weeks at a time, and the answer
// is cached against the LEAGUE — every team is in every week's payload, so
// switching teams is a repaint and costs nothing.

/** Which league the week cache belongs to. Team ids collide across leagues. */
function sourceKey() {
  if (state.source === 'demo') return 'demo';
  const cfg = espn.getConfig();
  return `live:${cfg.leagueId}:${cfg.season}`;
}

/** Weeks fetched three at a time, so columns appear in groups rather than in
 *  one lump at the end. Matches the batch size season.js uses internally. */
const SEASON_BATCH = 3;

function resetSeason(key) {
  state.seasonKey = key;
  state.seasonWeeks = new Map();
  state.seasonFailed = new Set();
  state.seasonPending = null;
  state.seasonProgress = null;
  state.seasonError = null;
  state.seasonToken++; // anything still in the air belongs to the old league
}

/**
 * Fill the panel, once per league, lazily.
 *
 * Called last out of render() and never awaited: the rest of the page is
 * already on screen before this starts spending requests. It is a no-op on
 * every repaint after the first, which is what makes the team picker free.
 */
function ensureSeasonWeeks() {
  const key = sourceKey();
  if (state.seasonKey !== key) resetSeason(key);

  // Nothing to hang the rows off yet, and no week list to ask for.
  if (!state.data || !state.weeks.length) return;
  if (state.seasonPending === key) return;

  const missing = state.weeks.filter(
    (w) => !state.seasonWeeks.has(w) && !state.seasonFailed.has(w)
  );
  if (!missing.length) return;

  if (state.source === 'demo') {
    loadDemoSeason(key, missing);
    return;
  }
  refreshSeason(key, missing);
}

/**
 * Demo mode builds the whole grid with no network at all — demo-rosters.js
 * answers synchronously — so there is no progress line and no partial state.
 * The generator is still imported lazily, but loadWeek() has already resolved
 * it by the time anything here runs.
 */
async function loadDemoSeason(key, missing) {
  const token = state.seasonToken;
  state.seasonPending = key;
  const generate = await getDemoGenerator();
  if (token !== state.seasonToken) return;
  state.seasonPending = null;

  if (!generate) {
    state.seasonError =
      'Demo roster data isn’t available yet (js/demo-rosters.js is missing).';
    renderSeason();
    return;
  }
  for (const w of missing) {
    const built = generate(w);
    if (built && built.teams && built.teams.length) state.seasonWeeks.set(w, built.teams);
    else state.seasonFailed.add(w);
  }
  renderSeason();
  renderOverview(); // the grids' hovers are made of these weeks too
}

/**
 * The live version: one request per week, in batches, repainting between them.
 *
 * Guarded by a token so a slow batch landing after the league or the source
 * changed is thrown away rather than painted over the top of the newer one.
 * fetchWeeksRosters swallows a week ESPN refuses — it simply comes back absent
 * — so a gap is recorded as a failed week and named in the note.
 */
async function refreshSeason(key, missing) {
  const token = ++state.seasonToken;
  const stale = () => token !== state.seasonToken || sourceKey() !== key;

  state.seasonPending = key;
  state.seasonError = null;
  state.seasonProgress = { done: 0, total: missing.length };
  renderSeason();

  try {
    for (let i = 0; i < missing.length; i += SEASON_BATCH) {
      const batch = missing.slice(i, i + SEASON_BATCH);
      const got = await fetchWeeksRosters(batch, {
        onProgress: () => {
          if (stale() || !state.seasonProgress) return;
          state.seasonProgress.done++;
          renderSeason();
        },
      });
      if (stale()) return;
      for (const w of batch) {
        if (got.has(w)) state.seasonWeeks.set(w, got.get(w));
        else state.seasonFailed.add(w);
      }
      renderSeason();
      // And the grids, because their hovers carry the same week run. Once per
      // BATCH rather than once per week: the progress tick above fires while
      // the batch is still in flight and state.seasonWeeks has not moved, so
      // repainting there would rewrite ten rows to produce identical markup.
      // Five repaints for thirteen weeks, all inside the first second or two.
      // resort() keeps whatever sort the reader picked and the drilled-into row
      // is recomputed from state, so neither can be knocked out by this.
      renderOverview();
    }
  } catch (err) {
    if (stale()) return;
    state.seasonError = err && err.message ? err.message : String(err);
  } finally {
    if (!stale() && state.seasonPending === key) {
      state.seasonPending = null;
      state.seasonProgress = null;
    }
  }

  if (stale()) return;
  renderSeason();
}

/**
 * week -> Map(playerId -> projection | null) for one team.
 *
 * A week whose payload has no row for this team at all maps to null, so "the
 * league did not contain him that week" stays distinguishable from "the week
 * has not been read yet".
 */
function seasonIndex(teamId) {
  const byWeek = new Map();
  for (const [week, teams] of state.seasonWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) { byWeek.set(week, null); continue; }
    const byPlayer = new Map();
    for (const p of team.players) {
      byPlayer.set(p.playerId, typeof p.projected === 'number' ? p.projected : null);
    }
    byWeek.set(week, byPlayer);
  }
  return byWeek;
}

/**
 * One player's projection for one week, in five distinguishable states:
 *   'wait'    the week has not been read yet
 *   'failed'  ESPN refused that week for everybody
 *   'off'     he was not on this roster in that week
 *   null      ESPN carried no number for him that week
 *   number    the projection (0 means his NFL team is on bye)
 */
function seasonValue(index, week, playerId) {
  const byPlayer = index.get(week);
  if (byPlayer === undefined) return state.seasonFailed.has(week) ? 'failed' : 'wait';
  if (byPlayer === null) return 'off';
  if (!byPlayer.has(playerId)) return 'off';
  return byPlayer.get(playerId);
}

/**
 * The cell. No `data-v` at all — never data-v="" — for anything that is not a
 * number, so an unknown sinks to the bottom whichever way the column is sorted.
 */
function seasonCell(v, week, name, isNow) {
  const cls = (extra) => `wk${isNow ? ' now' : ''}${extra ? ` ${extra}` : ''}`;

  if (v === 'wait') {
    return `<td class="${cls('wait')}" title="Week ${week} has not been read from ESPN yet.">·</td>`;
  }
  if (v === 'failed') {
    return `<td class="${cls('muted')}" title="Week ${week} did not load — ESPN refused it, ` +
      `so this column is empty for everyone. Reload the page to try again.">—</td>`;
  }
  if (v === 'off') {
    return `<td class="${cls('off')}" title="${esc(name)} was not on this roster in week ${week}. ` +
      `ESPN returns each past week’s real roster, and today’s roster for weeks still to come.">—</td>`;
  }
  if (v === null) {
    return `<td class="${cls('muted')}" title="ESPN’s week ${week} roster carried no projection ` +
      `for ${esc(name)}.">—</td>`;
  }
  if (v === 0) {
    // ESPN's 0.00 IS its way of saying "no game that week". The sample data
    // means something else by a zero — it pins a player it has ruled out — so
    // demo mode prints the number rather than claiming a bye that isn't one.
    if (state.isDemo) {
      return `<td class="${cls()}" data-v="0" title="The sample data has ${esc(name)} ruled out ` +
        `in week ${week}, so it projects nothing for him.">0.0</td>`;
    }
    return `<td class="${cls('bye')}" data-v="0" title="${esc(name)} is on bye in week ${week}. ` +
      `ESPN returns 0.00 for a bye, which is not the same as having no number at all.">Bye</td>`;
  }
  return `<td class="${cls()}" data-v="${v}" ` +
    `title="ESPN projects ${fmt(v)} for ${esc(name)} in week ${week}.">${fmt(v)}</td>`;
}

function renderSeasonHead(weeks) {
  const cols = weeks
    .map((w) => {
      const failed = state.seasonFailed.has(w);
      const cls = ['wk', w === state.week ? 'now' : '', failed ? 'muted' : '']
        .filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : `ESPN’s projected points for week ${w}.`;
      return `<th data-sort class="${cls}" title="${title}">${w}</th>`;
    })
    .join('');

  $('seasonTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="left" data-sort>Slot</th>
       <th class="name" data-sort>Player</th>
       <th class="left" data-sort>Pos</th>
       <th class="left" data-sort>NFL</th>
       <th class="grouped" data-sort title="The mean of the week columns that carry a number. Ours, not ESPN’s: a bye counts as the zero ESPN returns, and a week he is not on the roster for is left out.">Avg</th>
       ${cols}
     </tr>`;
}

function renderSeason() {
  const table = $('seasonTable');
  const tbody = bodyOf(table);
  const team = currentTeam();
  const weeks = state.weeks.slice();
  // The same view the panel above draws, swaps included, so the two can never
  // disagree about who is starting for the squad they are both showing.
  const view = rosterView(team);
  const players = team ? team.players : [];

  $('seasonTitle').textContent = team
    ? `Season by week · ${team.name}`
    : 'Season by week';

  renderSeasonHead(weeks);
  renderSeasonProgress(weeks);

  const show = players.length > 0 && weeks.length > 0;
  $('seasonWrap').classList.toggle('hidden', !show);
  $('seasonEmpty').classList.toggle('hidden', show);

  if (!show) {
    $('seasonEmpty').textContent = seasonEmptyReason(team, weeks);
    $('seasonNote').innerHTML = '';
    tbody.innerHTML = '';
    return;
  }

  const index = seasonIndex(team.id);

  tbody.innerHTML = view
    .map((entry) => {
      const p = entry.p;
      const values = weeks.map((w) => seasonValue(index, w, p.playerId));
      const real = values.filter((v) => typeof v === 'number');
      const avg = real.length ? round1(real.reduce((a, b) => a + b, 0) / real.length) : null;

      const order = SLOT_ORDER[entry.slotId] ?? 40;
      const tier = injuryTier(p.injuryStatus);
      const label = tier ? INJURY_LABELS[p.injuryStatus] || p.injuryStatus.replace(/_/g, ' ') : '';
      // Availability, not a value judgement — so it is allowed a colour where
      // the week columns are not. Kept to the pill this page already uses.
      //
      // It sits BESIDE the player link rather than inside it. The pill is a
      // fact about this week, not part of who he is, and it carries a title of
      // its own: inside the link the two tooltips would fight over the same few
      // pixels, and the link's hover underline would drag through the pill's
      // rounded border. Outside, the name is the target and the pill is a label.
      const tag = tier
        ? ` <span class="inj${tier === 'q' ? '' : ` ${tier}`}" ` +
          `title="ESPN lists ${esc(p.name)} as ${esc(p.injuryStatus.replace(/_/g, ' ').toLowerCase())}.">` +
          `${esc(label)}</span>`
        : '';

      return `
      <tr class="${entry.started ? '' : 'bench'}">
        <td class="left" data-v="${order}"><span class="slot-tag">${esc(entry.slot)}</span></td>
        <td class="name" title="${esc(p.name)} · ${esc(p.position)} · ${esc(p.proTeam)}">${
          playerRef(p, esc(p.name), `${p.name} — ${OPENS}`)}${tag}</td>
        <td class="left">${esc(p.position)}</td>
        <td class="left">${esc(p.proTeam)}</td>
        <td class="avg grouped"${avg === null ? '' : ` data-v="${avg}"`}>${fmt(avg)}</td>
        ${values.map((v, i) => seasonCell(v, weeks[i], p.name, weeks[i] === state.week)).join('')}
      </tr>`;
    })
    .join('');

  renderSeasonNote(weeks, players.length);
  resort(table);
}

/** An empty table says why it is empty and what to do about it. */
function seasonEmptyReason(team, weeks) {
  if (!weeks.length) {
    return 'No weeks came back for this season, so there is nothing to lay out across the top. ' +
      'Check the league on the Connection page, or switch to Demo data.';
  }
  if (!state.data) return 'No roster data for this week yet, so there are no players to follow.';
  if (!team) return 'Pick a team above to follow its roster through the season.';
  return `No players came back for ${team.name} in week ${state.week}, so there is no roster ` +
    `to follow. Try another week.`;
}

/** The one visible sign that thirteen requests are being spent. */
function renderSeasonProgress(weeks) {
  const el = $('seasonProgress');
  if (state.seasonError) {
    el.innerHTML = `<span class="neg">${esc(state.seasonError)}</span>`;
    return;
  }
  // Demo builds every week synchronously out of demo-rosters.js, so there is
  // nothing to report progress on and a "reading from ESPN" line would be a lie.
  if (state.isDemo) { el.textContent = ''; return; }

  const pending = weeks.filter(
    (w) => !state.seasonWeeks.has(w) && !state.seasonFailed.has(w)
  );
  if (!pending.length) { el.textContent = ''; return; }

  const p = state.seasonProgress;
  const done = p ? Math.min(p.done, p.total) : weeks.length - pending.length;
  const total = p ? p.total : weeks.length;
  el.textContent =
    `Reading ESPN’s weekly projections… week ${done} of ${total}. ` +
    `One request per week — there is no bulk form — so the columns fill in as they land.`;
}

/**
 * What these numbers are, said every time they are shown.
 *
 * Four things have to be in here or the table is quietly misleading: whose
 * projections these are, that a Bye cell and a dash mean different things,
 * which weeks are covered, and — the one peculiar to this panel — that the
 * rows are the roster AS OF the week selected at the top of the page, not some
 * season-long squad that never existed.
 */
function renderSeasonNote(weeks, rowCount) {
  const parts = [];
  const team = currentTeam();

  parts.push(
    state.isDemo
      ? 'These are generated sample rosters and generated projections — not ESPN’s, and not ' +
        'your league’s. Switch to <strong>My ESPN league</strong> above to follow a real squad.'
      : 'Every number in the week columns is ESPN’s own projection for that player in that week, ' +
        'scored under this league’s rules — the same figure ESPN shows when you page a lineup ' +
        'forward. Nothing here is ours except <strong>Avg</strong>.'
  );

  const loaded = weeks.filter((w) => state.seasonWeeks.has(w)).length;
  parts.push(
    `Covering ${weekRange(weeks)} — ${plural(weeks.length, 'week')} this season runs to` +
    (loaded === weeks.length ? ', all loaded.' : `, ${loaded} loaded so far.`)
  );

  parts.push(
    `The rows are ${team ? `${esc(team.name)}’s` : 'this team’s'} roster <strong>as it stands in ` +
    `week ${state.week}</strong> — the same ${plural(rowCount, 'player')} as the table above, ` +
    `starters in lineup order and then the bench. Change the week at the top of the page and this ` +
    `row set changes with it. <strong>Click any player’s name</strong> to open him on the ` +
    `<a href="waivers.html">Players</a> page, priced against the wire.`
  );

  parts.push(
    (state.isDemo
      ? 'On a real league a cell reading <strong>Bye</strong> is the 0.00 ESPN returns for a ' +
        'player whose NFL team is off that week; in the sample data a zero only means he is ruled ' +
        'out, so it is printed as a number. '
      : 'A cell reading <strong>Bye</strong> is the 0.00 ESPN returns for a player whose NFL team ' +
        'is off that week. ') +
    'A dash is not that: it means either that ESPN carried no number for him, or that he was not ' +
    'on this roster in that week — ESPN hands back each past week’s real roster, and today’s ' +
    'roster for every week still to come. Hover a cell to see which.'
  );

  parts.push(
    'Avg is the mean of the weeks that carry a number and is ours, not ESPN’s: a bye counts as ' +
    'the zero ESPN returns, and a week he is not on the roster for is left out.'
  );

  parts.push(
    'Nothing in this table is highlighted, on purpose. Everyone here is already rostered, so the ' +
    'per-position bar that flags a startable week on the <a href="waivers.html">Players</a> ' +
    'page would light up nearly every cell and tell you nothing.'
  );

  if (state.seasonFailed.size) {
    const failed = [...state.seasonFailed].sort((a, b) => a - b).filter((w) => weeks.includes(w));
    if (failed.length) {
      parts.push(
        `<span class="neg">ESPN did not return ${failed.length === 1 ? 'week' : 'weeks'} ` +
        `${andList(failed.map(String))}, so ${failed.length === 1 ? 'that column is' : 'those columns are'} ` +
        `blank for everyone and the average is taken from the weeks that did load. Reload the page ` +
        `to try again.</span>`
      );
    }
  }

  $('seasonNote').innerHTML = parts.join(' ');
}

/** Selecting a team touches four places, so nobody calls them separately. */
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
  // A repaint and nothing else. Every team is in every week already fetched,
  // so flicking through the managers never costs a request.
  renderSeason();
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

/**
 * The swap: pick a man up by his slot, put him down on somebody else's.
 *
 * Delegated from the table, so the rows may be rewritten as freely as they
 * already are. sortable.js listens on the same element for `th[data-sort]`,
 * which cannot be the same target as a button inside a `td`.
 */
$('rosterTable').addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('button[data-swap]');
  if (!btn || btn.disabled) return;
  const id = Number(btn.dataset.swap);

  // Nobody in hand: pick him up. Him again: put him down unchanged.
  if (state.held === null || state.held === id) {
    state.held = state.held === null ? id : null;
    renderRoster();
    return;
  }

  // An illegal pair cannot get here — its button is disabled — but the model
  // refuses it anyway rather than trusting the markup it just wrote.
  const done = applySwap(state.held, id);
  state.held = null;
  renderRoster();
  if (done) renderSeason();   // the two panels share one lineup
});

$('lineupReset').addEventListener('click', () => {
  if (!lineupEdited() && state.held === null) return;
  state.lineup = new Map();
  state.held = null;
  renderRoster();
  renderSeason();
});

// Clicking anywhere on a team's row drills into it — the grids are the thing
// people scan, so making them go back to the select below to act on what they
// found would be a step for nothing. Either grid drives it.
for (const grid of GRIDS) {
  $(`${grid.id}Table`).addEventListener('click', (e) => {
    if (!e.target.closest) return;
    // A number in these cells is now a link to that player, and the row it sits
    // in still drills into the team. Both would fire on one click: the reader
    // would leave for the Players page while this page quietly re-pointed the
    // three panels below at a team he never picked, and find them changed when
    // he came back. The link wins, and the drill-down is left alone.
    if (e.target.closest('a.pref')) return;
    const tr = e.target.closest('tr[data-team]');
    if (tr) selectTeam(Number(tr.dataset.team));
  });
  // The grids are the reason to be here, so they open on the number that ranks
  // teams: Total, high first. Column 10 — the team, the nine spots, then it.
  enableSort($(`${grid.id}Table`), { defaultIndex: GRID_SLOTS.length + 1 });
}

enableSort($('rosterTable'), { defaultIndex: 0, defaultAsc: true });

// The season grid opens in lineup order — starters first, bench after — so it
// reads as a squad rather than as a leaderboard. Avg is one click away for
// anyone who wants the other question answered.
enableSort($('seasonTable'), { defaultIndex: 0, defaultAsc: true });

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
