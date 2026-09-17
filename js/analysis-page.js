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
// The namespace as well, for `fetchByeWeeks`, which is read defensively: a
// season module (or a test stub of one) without it just means "byes unknown".
import * as season from './season.js';
import { enableSort, resort } from './sortable.js';
// `coarsePointer` is no longer imported here: the only two things on this page
// that turned on it — whether the card opens as a sheet, and whether a tap on a
// grid cell counts as a click on a player — both live in js/player-card.js now,
// and it imports it from the same one place the connection bar does.
import { savedConfig, onConnection } from './connection.js';
// The hover/tap card that carries a man's whole season. It lives in its own
// module because the Trade page shows the same card on every player it names,
// and two copies of it is how the two pages start disagreeing about what a
// bye, an unread week and a zero each look like. See the API block at the top
// of js/player-card.js.
import {
  weekRun, registerRun, tipAttr, clearRuns, wireTips, reopenTip, clickIsPlayer,
  zeroKind, byeWeekOf, outMark,
} from './player-card.js';
import { scope } from './prefs.js';
import { optimalLineup, slotsFromCounts } from './forecast.js';
import { slotCountsFromLineups } from './projection.js';
import * as espn from './espn.js';
// The ONE definition of the playoff weeks (last regular week + one per round).
import { playoffWeeks as leaguePlayoffWeeks } from './capture.js';

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
  weeks: [],        // weeks offered in the dropdown — the regular season
  // The playoff weeks, laid out after the regular season in every week-across
  // view (Tim, 2026-09-17) behind a heavy line, and kept out of every Avg and
  // Starts count. Not offered in the dropdown. See spanWeeks().
  poWeeks: [],
  playedWeeks: [],  // of those, the ones that have actually been played
  data: null,       // {week, teams:[...]} for the selected week
  teamId: null,     // team shown in the roster detail
  myTeamId: null,   // the reader's own team, when a live league says so
  // Which source ('demo' | 'live') a team was tapped on THIS visit, or null.
  // A pick on live data stands for the visit; see selectTeam().
  teamPickedOn: null,
  isDemo: true,
  // proTeamId -> bye week, from `fetchByeWeeks()`. Empty means unknown, and
  // then a live 0.00 is read as a bye the way it always was.
  byes: {},
  // A week the reader picked THIS visit. A saved week from an earlier visit is
  // ignored once it has been played; one picked now is honoured, past or not.
  weekPicked: false,

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

  // The "Who to start, week by week" panel at the very foot. One position at a
  // time, because the question it answers — when does my third back actually
  // get in, and is it a bye or just a soft week — is a question about one
  // position's depth chart and nothing else. FLEX is a filter over RB/WR/TE
  // here exactly as it is on the Players page; it is never a position.
  startersPos: 'RB',
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
function playerRef(p, inner, title, attr = 'title') {
  if (p.playerId === null || p.playerId === undefined) return inner;
  // `attr` is 'aria-label' wherever a tip card of our own is doing the talking:
  // a `title` there would have the browser draw a second tooltip on top of it.
  return (
    `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ${attr}="${esc(title)}">` +
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

/**
 * Where each man ranks at his own position ON HIS OWN TEAM — RB4, WR5, TE2.
 *
 * Counted over the WHOLE squad, starters included, because that is what the
 * number means to a manager: a bench running back sitting behind three better
 * ones is his RB4 whether or not the other three are in the lineup this week.
 *
 * Ranked by the grid's own measure, so the number agrees with the column it is
 * printed in — a man can be his team's RB2 for a typical week and their RB4 in
 * a week two of them are on bye, and both are true.
 *
 * Only men with a number are ranked, which keeps the ranks 1..n contiguous: an
 * RB3 really is the third-best of the backs this team has numbers for, rather
 * than the third name in a list with holes in it. The playerId tiebreak stops
 * two identical averages swapping places between repaints. Same rule as the
 * Taken table's ranks on the Players page — deliberately, so the two agree.
 */
function positionRanks(team, measure = avgWeek) {
  const byPosition = new Map();
  for (const p of team.players || []) {
    if (p.playerId === null || p.playerId === undefined) continue;
    if (!byPosition.has(p.position)) byPosition.set(p.position, []);
    byPosition.get(p.position).push({ p, v: measure(p) });
  }

  const ranks = new Map();
  for (const group of byPosition.values()) {
    group
      .filter((e) => typeof e.v === 'number')
      .sort((a, b) => b.v - a.v || a.p.playerId - b.p.playerId)
      .forEach((e, i) => ranks.set(e.p.playerId, i + 1));
  }
  return ranks;
}

/** What the nine score between them. The real sum, not an estimate. */
function totalOf(row) {
  const vals = GRID_SLOTS.map((s) => row[s.key] && row[s.key].v).filter((v) => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, v) => a + v, 0)) : null;
}

// ------------------------------------------------------------ the playoffs
//
// "From now on, when you show the 14 week preview, could you also show weeks
// 15, 16, and 17 to represent the playoffs. Just put a line between 14 and 15."
// — Tim, 2026-09-17. The week-across views (the season grid, who to start, and
// the card's run) run through the playoff weeks; the line is `po-start` in
// css/app.css; the averages stay regular-season.

/** Every week a week-across view lays out: the regular season, then the playoffs. */
function spanWeeks() {
  return [...state.weeks, ...state.poWeeks.filter((w) => !state.weeks.includes(w))];
}

const isPlayoff = (w) => state.poWeeks.includes(w);

/** The mean of a row's REGULAR-SEASON numbers — playoff columns are shown, not averaged. */
function regularAvg(values, weeks) {
  const real = values.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number');
  return real.length ? round1(real.reduce((a, b) => a + b, 0) / real.length) : null;
}

/** The first playoff week in a run of columns — the one the line goes before. */
const firstPlayoffIn = (weeks) => weeks.find(isPlayoff);

/** `po-start` on a week cell, merged into the class it already carries. */
function withPo(td, week, weeks) {
  if (week !== firstPlayoffIn(weeks)) return td;
  return td.replace(/^<td(?: class="([^"]*)")?/, (m, c) => `<td class="${c ? `${c} ` : ''}po-start"`);
}

/** A week's header cell; a playoff week says so in words, not by the line alone. */
function weekHead(w, weeks, cls, title) {
  const start = w === firstPlayoffIn(weeks);
  const classes = [cls, start ? 'po-start' : ''].filter(Boolean).join(' ');
  const label = isPlayoff(w)
    ? `${w}${start ? '<span class="po-tag" aria-hidden="true">PO</span>' : ''}` +
      '<span class="sr-only"> (playoffs)</span>'
    : String(w);
  const why = isPlayoff(w) ? `${title} A playoff week: shown, not counted in Avg.` : title;
  return `<th data-sort class="${classes}" title="${why}">${label}</th>`;
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
//
// The same cache carries what he ACTUALLY scored, which is the Act row under
// the projections. It is the same fetch: `fetchWeekRosters` has always returned
// `actual` beside `projected` on every roster entry, and this page simply never
// read it here.

/**
 * One player's whole season, as the data the three-row chart is drawn from.
 *
 * It used to be lines of text in a native `title`, which was the right first
 * answer — no focus management, no z-index, no touch story — and Tim read it
 * and said it was hard to scan. He is right, and the fix is not a better
 * string: a native tooltip renders in the OS UI font, so "W1 12.5  W2 13.5"
 * cannot be padded into columns that line up. Week numbers over their own
 * projections needs real layout, so this returns structure and the card in
 * js/player-card.js draws it.
 */
function seasonRunData(index, p) {
  const weeks = spanWeeks();
  if (!index || !weeks.length) return null;

  return weekRun({
    heading: state.isDemo
      ? `Sample projections for ${weekRange(weeks)}`
      : `ESPN’s projection for ${weekRange(weeks)}`,
    weeks,
    projections: weeks.map((w) => seasonValue(index, w, p.playerId)),
    actuals: weeks.map((w) => seasonActual(index, w, p.playerId)),
    currentWeek: state.week,
    demo: state.isDemo,
    // Whether a 0.00 is his bye or a man ruled out — player-card.js decides.
    byeWeek: byeWeekOf(p, state.byes),
    injuryStatus: weeks.map((w) => seasonStatus(index, w, p)),
    playoffWeeks: state.poWeeks,
  });
}

/** How a zero in this man's week reads: see `zeroKind` in js/player-card.js. */
function zeroOf(v, week, p, status = p.injuryStatus) {
  return zeroKind(v, {
    week,
    byeWeek: byeWeekOf(p, state.byes),
    injuryStatus: status,
    demo: state.isDemo,
  });
}

/**
 * Read the bye weeks, once per live load. Never throws: a failed read is an
 * empty map, and an empty map is "unknown", which keeps the old reading.
 */
async function loadByes() {
  if (typeof season.fetchByeWeeks !== 'function') return {};
  try {
    const got = await season.fetchByeWeeks();
    return got && typeof got === 'object' ? got : {};
  } catch {
    return {};
  }
}

// ----------------------------------------------------------- the tip card
//
// The card itself — how it draws, where it floats, how it opens as a sheet
// under a finger, and every comment explaining what each of those cost — is in
// js/player-card.js, imported at the top of this file. It moved there when the
// Trade page needed the identical card on every player it names: one copy is
// the only reason the two pages cannot come to different answers about what a
// bye, an unread week and a plain zero look like.
//
// This page's part of the contract is three lines: build a run (above),
// register it and put the key in the markup (gridCell, below), and call
// wireTips on each grid once (at the foot of the file).

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
function gridCell(entry, { withPosition = false, weekGrid = false, index = null, tipKey = '', ranks = null, teamId = null } = {}) {
  if (!entry) return '<td class="slot-cell muted">—</td>';

  const { p, v } = entry;
  const cls = ['slot-cell'];
  const tier = injuryTier(p.injuryStatus);
  if (tier === 'out' || tier === 'ir') cls.push(`st-${tier}`);

  // A 0.00 in a WEEK is either his bye or a man ESPN has ruled out, and only
  // the week grid may read it either way: a season average of zero is a man
  // ESPN projects nothing for all year, which is a different fact. Which of the
  // two it is gets decided in js/player-card.js against his team's bye week.
  const zero = weekGrid ? zeroOf(v, state.week, p) : null;
  const bye = zero === 'bye';
  if (bye) cls.push('bye');
  if (zero === 'out') cls.push('zero-out');

  // The identity line — name, position, NFL team, injury — and then his whole
  // season under it, drawn by the tip card rather than crammed into a `title`.
  const ident =
    `${p.name} · ${p.position} · ${p.proTeam}${tier ? ` · ${p.injuryStatus}` : ''}` +
    (bye ? ' · on bye this week, which is what ESPN’s 0.00 means' : '') +
    (zero === 'out' ? ' · projected at 0.0 because he is ruled out, not on bye' : '');

  // Registered rather than serialised into the markup: thirteen weeks on every
  // one of 170 cells per grid would be tens of kilobytes of attribute repeated
  // in two tables.
  //
  // The key `registerRun` hands back is a bare counter, NOT the playerId. It
  // was the playerId first, and that quietly cost the hover to every man ESPN
  // gave no id for — the card does not depend on the link and must not start
  // to. A counter is unique by construction and needs nothing from the data.
  // `href` is only read when the card opens as a tap-opened sheet, where it
  // becomes the button that replaces the navigation the tap preempted. Built
  // from the same playerId and the same one contract as playerRef below —
  // never a second way of naming a player — and `null` for a man ESPN gave no
  // id for, which is the case the sheet says out loud rather than offering a
  // link that goes nowhere.
  const href =
    p.playerId === null || p.playerId === undefined
      ? null
      : `waivers.html?player=${encodeURIComponent(p.playerId)}`;
  // `id` is what lets an open card survive the next batch repaint: the same
  // man, in the same grid, on the same team. A man with no playerId is named
  // by his line instead, which is unique enough within one team's row.
  const id = `${tipKey || 'g'}:${teamId}:${p.playerId ?? `x:${p.name}`}`;
  const key = registerRun({ ident, run: seasonRunData(index, p), href, id }, tipKey || 'g');

  const shown = v === null
    ? '—'
    : bye
      ? 'Bye'
      : zero === 'out'
        ? `${fmt(v)} <span class="zmark">${esc(outMark(p.injuryStatus))}</span>`
        : fmt(v);

  // The whole of the cell goes inside the link, the bench cell's position span
  // included. The number and the position are two halves of one statement about
  // one man, so splitting them would leave a dead strip in the middle of a cell
  // that is already only a few characters wide.
  // The bench cell carries his position AND where he ranks at it on this team:
  // "12.3 RB4". The position alone said what he is; the number says what he is
  // worth having, which is the question a bench column is actually asked. A man
  // with no number cannot be ranked, so he keeps the bare position rather than a
  // rank invented for him.
  const rank = ranks ? ranks.get(p.playerId) : undefined;
  const posTag = withPosition
    ? ` <span class="pp">${esc(p.position)}${rank === undefined ? '' : rank}</span>`
    : '';
  const inner = `${shown}${posTag}`;

  // NO `title` ON EITHER ELEMENT. The card is the tooltip now, and a `title`
  // alongside it would have the browser draw its own on top of ours a moment
  // later — two tooltips for one cell. The link keeps an `aria-label` instead:
  // it says the same thing to a screen reader and draws nothing.
  //
  // `data-v` stays on the <td>, OUTSIDE the link: sortable.js reads the sort key
  // off the cell, and a key that moved inside an anchor would silently unsort
  // every column in both grids.
  return (
    `<td class="${cls.join(' ')}"${v === null ? '' : ` data-v="${v}"`}` +
    `${tipAttr(key)}>` +
    `${playerRef(p, inner, `${ident}. Click to ${OPENS}.`, 'aria-label')}</td>`
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
  // Never asked for on demo: a sample zero is a man ruled out, never a bye.
  state.byes = {};
  state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  // The sample league's bracket weeks (14–16); demo-rosters.js projects them.
  state.poWeeks = leaguePlayoffWeeks({ weeks: state.weeks });
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
  // Your real league opens on YOUR team, unless you tapped one on it this
  // visit. A demo pick does not carry over: demo ids count from 1 just as
  // ESPN's do, so it would survive the switch looking valid and be a stranger.
  if (state.myTeamId !== null && state.teamPickedOn !== 'live') state.teamId = state.myTeamId;

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.source = 'live';
  state.isDemo = false;
  setToggle('live');
  cache.clear();

  setStatus('Reading the league schedule…');
  let scheduleWeeks = [];
  let poWeeks = [];
  // The bye weeks ride alongside the schedule rather than after it. They only
  // decide how a 0.00 is drawn, so a failure is an empty map, never an error.
  const byesRead = loadByes();
  try {
    const schedule = await fetchSchedule();
    scheduleWeeks = schedule.weeks || [];
    poWeeks = leaguePlayoffWeeks(schedule);
    state.playedWeeks = [...new Set(schedule.games.filter((g) => g.played).map((g) => g.week))]
      .sort((a, b) => a - b);
  } catch {
    state.playedWeeks = [];
  }
  state.byes = await byesRead;
  if (state.source !== 'live') return;   // the reader went back to demo meanwhile
  state.weeks = scheduleWeeks.length
    ? scheduleWeeks
    : Array.from({ length: NFL_WEEKS }, (_, i) => i + 1);
  // No schedule, no bracket: the 18-week guess already covers every week.
  state.poWeeks = scheduleWeeks.length ? poWeeks : [];

  state.week = openingWeek();

  renderWeekPicker();
  await loadWeek();
}

/**
 * Which week a live league opens on: THE COMING ONE.
 *
 * It used to be the last week played, and a saved week was always preferred —
 * so a reader who looked at week 2 once opened on week 2 for the rest of the
 * season. What a manager opens this page for is the week he is about to set a
 * lineup for, so:
 *
 *   - a week picked during THIS visit stays picked, past or not;
 *   - a saved week from an earlier visit is kept only while it has not been
 *     played — once it is in the past, it is ignored;
 *   - otherwise the first week with no result against it, read off the
 *     schedule and never off the calendar;
 *   - and a finished season opens on its last week.
 */
function openingWeek() {
  const played = new Set(state.playedWeeks);
  if (state.weekPicked && state.weeks.includes(state.week)) return state.week;
  const remembered = prefs.get('week', null);
  if (state.weeks.includes(remembered) && !played.has(remembered)) return remembered;
  const coming = state.weeks.find((w) => !played.has(w));
  if (coming !== undefined) return coming;
  return state.weeks[state.weeks.length - 1];
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
  // No teams is a week still LOADING, not a league without the pick in it.
  // Deciding here nulled the selection on every uncached load — the empty
  // render runs before the fetch — so a tapped team, or a saved one, was
  // swapped for your own (or the first) the moment a week was fetched. The
  // Trade page had the same bug and the same fix.
  if (!teams.length) return;
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
    // Only a week's number can be a bye (or a ruled-out zero).
    weekGrid: true,
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

  const opts = {
    weekGrid: !!grid.weekGrid,
    tipKey: grid.id,
  };
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
      const cellOpts = {
        ...opts,
        index: seasonIndexFor(t.id),
        ranks: positionRanks(t, grid.measure),
        teamId: t.id,
      };
      const benchCells = Array.from({ length: benchCols }, (_, i) =>
        gridCell(bench[i] || null, { ...cellOpts, withPosition: true })).join('');
      // NO `title` on the row. On a phone js/touch-titles.js turned it into a
      // sheet over the very tap that selects the team; the key line under the
      // grid already says "tap a row to load that team".
      return `
      <tr class="${cls}" data-team="${t.id}">
        <td class="name">${esc(t.name)}</td>
        ${GRID_SLOTS.map((s) => gridCell(row[s.key], cellOpts)).join('')}
        <td class="grid-total grouped" data-v="${total ?? ''}"><strong>${fmt(total)}</strong></td>
        ${benchCells}
      </tr>`;
    })
    .join('');

  resort(table); // keep whatever sort the user picked across week changes

  // The key names only the marks this grid is actually showing.
  const body = bodyOf(table);
  const dash = [...body.querySelectorAll('td.slot-cell')]
    .some((td) => td.textContent.trim().startsWith('—'));
  renderKey(`${grid.id}Legend`, teams.length ? [
    body.querySelector('td.st-out') && ['<span class="key out">Out</span>', 'this week'],
    body.querySelector('td.st-ir') && ['<span class="key ir">IR</span>', 'injured reserve'],
    body.querySelector('td.bye') && ['<span class="lg-mark bye">Bye</span>', 'no game that week'],
    body.querySelector('td.zero-out') &&
      ['<span class="lg-mark zero-out">0.0 <span class="zmark">OUT</span></span>', 'ruled out, not a bye'],
    dash && ['<span class="lg-mark faint">—</span>', 'empty spot or no number'],
  ] : [], teams.length ? 'Tap or hover a number for the player · tap a row to load that team' : '');
}

/**
 * The compact key under a table: each mark as the table draws it, then a few
 * words. `items` may hold falsy entries for marks not on screen; they are
 * dropped. `hint` is how to use the table, said in a few words, last.
 */
function renderKey(id, items, hint = '') {
  const el = $(id);
  if (!el) return;
  const parts = items
    .filter(Boolean)
    .map(([mark, words]) => `<span class="lg">${mark}<span>${words}</span></span>`);
  if (hint) parts.push(`<span class="lg lg-hint">${hint}</span>`);
  el.innerHTML = parts.join('');
}

function renderOverview() {
  // Cleared here rather than per grid: the rows are about to be replaced, so
  // every key registered against the old ones is dead. Left to grow it would
  // hold a whole other league's squads after a source switch.
  clearRuns();
  for (const grid of GRIDS) renderGrid(grid);
  // NOT hideTip() before the repaint any more. This runs once per batch while
  // the season loads, and closing the card each time made one opened in the
  // first seconds vanish under the reader. The card finds its man again among
  // the new cells and redraws from the newer data — or closes if he is gone.
  reopenTip();
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
    $('rosterLegend').innerHTML = '';
    $('rosterEdited').innerHTML = '';
    $('rosterEdited').classList.add('hidden');
    $('rosterBest').innerHTML = '';
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

  $('rosterBest').innerHTML = bestLineupLine(team, view, projTotal);

  renderRosterNote(view, team);
  resort(table);
}

/**
 * One short line: what the best legal lineup this week would change.
 *
 * `optimalLineup` from js/forecast.js, the same one "Who to start" below and
 * the schedule forecast use, over this week's roster as it is ON SCREEN — swaps
 * included, so after a what-if the line answers "is this better than what I
 * just made". IR is not a lineup choice and is left out of the pool. The slots
 * are the league's own, read off the lineups already held, so this costs no
 * request. Nothing when the slots are not known yet.
 */
function bestLineupLine(team, view, projTotal) {
  const slots = leagueSlots();
  if (!team || !slots || !view.length) return '';
  const keyOf = (p) => (p.playerId === null || p.playerId === undefined ? `n:${p.name}` : p.playerId);

  const pool = view.filter((e) => e.slotId !== IR_SLOT).map((e) => e.p);
  const best = optimalLineup(pool, slots);
  if (!best.starters.length) return '';

  const gain = round1(best.total - (typeof projTotal === 'number' ? projTotal : 0));
  const week = `week ${state.week}`;
  if (!(gain > 0)) {
    return `This lineup is already the best one for ${week}.`;
  }

  const current = new Set(view.filter((e) => e.started).map((e) => keyOf(e.p)));
  const chosen = new Set(best.starters.map(keyOf));
  const byKey = new Map(pool.map((p) => [keyOf(p), p]));
  const ins = best.starters.filter((s) => !current.has(keyOf(s))).map((s) => byKey.get(keyOf(s)) || s);
  const outs = view.filter((e) => e.started && !chosen.has(keyOf(e.p))).map((e) => e.p);
  const name = (p) => playerRef(p, esc(p.name), `${p.name} — ${OPENS}`, 'aria-label');
  const names = (list) => andList(list.map(name));

  // A different set of men is the usual answer; the same men in different
  // slots cannot add points, so `ins` is empty only if a slot was left open.
  const move = ins.length
    ? `start ${names(ins)}${outs.length ? ` over ${names(outs)}` : ''}`
    : 'fill the empty slot';
  return `Best lineup for ${week}: ${move}, <span class="pos">+${gain.toFixed(1)}</span>`;
}

/**
 * What the table is, said every time it is shown — including, now, that the
 * lineup in it can be changed and that changing it goes nowhere near ESPN.
 */
function renderRosterNote(view, team) {
  const hurt = view.filter((e) => injuryTier(e.p.injuryStatus)).length;
  const tiers = new Set(view.map((e) => injuryTier(e.p.injuryStatus)));
  const parts = [];

  // The key: what the row treatments mean, always on screen.
  renderKey('rosterLegend', [
    ['<span class="lg-mark dim">Bench</span>', 'dimmed'],
    ['<span class="lg-mark bold">Name</span>', 'in the flex'],
    tiers.has('out') && ['<span class="key out">Out</span>', 'this week'],
    tiers.has('ir') && ['<span class="key ir">IR</span>', 'injured reserve'],
    view.some((e) => e.moved) && ['<span class="lg-mark ital">• moved</span>', 'swapped by you'],
  ], 'Tap a slot tag to swap · tap a name for his Players page');

  parts.push(
    `Bench rows are dimmed and the flex player is in bold. Red is out this week, dark red is ` +
    `on IR. ${plural(hurt, 'player')} carrying an injury designation this week.`
  );

  parts.push(
    `<strong>Season total</strong> is the whole ${SEASON_GAMES}-game projection; ` +
    `<strong>Avg/wk</strong> is that same number per game, which is what the grid above adds up. ` +
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
    'both men are eligible for each other’s, and a player on IR is not a lineup choice at all.'
  );

  parts.push(
    '<strong>Best lineup</strong>, above the table, is the best legal lineup this squad could field ' +
    'this week on ESPN’s projections — the same solver “Who to start” uses below, over the roster ' +
    'as shown (your swaps included, IR left out), in the league’s own slots. It names who would come ' +
    'in, who would go out, and what that adds to the starters’ total.'
  );

  parts.push(
    '<strong>This is a what-if and nothing else</strong> — nothing on this page is ever sent to ' +
    'ESPN, and the swaps are forgotten the moment you change team or week.'
  );

  $('rosterNote').innerHTML = parts.map((t) => `<p>${t}</p>`).join('');

  // A changed lineup is said where it cannot be missed, not in the toggle.
  const edited = $('rosterEdited');
  edited.innerHTML = lineupEdited()
    ? `<span class="neg">This is not ${team ? `${esc(team.name)}’s` : 'the'} real lineup any ` +
      `more.</span> The number beside the total is the difference from the one ESPN has, and ` +
      `<strong>Proj avg</strong> above deliberately does not move with it: that is the best ` +
      `nine by season average, the same figure the first grid gives this team, and it never ` +
      `depended on how the lineup was set.`
    : '';
  edited.classList.toggle('hidden', !lineupEdited());
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

  const missing = spanWeeks().filter(
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
    // A generator that clamps a week it does not have to one it does would
    // hand back another week's numbers; that is a gap, never a borrowed week.
    const same = built && (built.week === undefined || Number(built.week) === Number(w));
    if (same && built.teams && built.teams.length) state.seasonWeeks.set(w, built.teams);
    else if (isPlayoff(w)) state.poWeeks = state.poWeeks.filter((x) => x !== w);
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
 * week -> Map(playerId -> { projected, actual }) for one team.
 *
 * A week whose payload has no row for this team at all maps to null, so "the
 * league did not contain him that week" stays distinguishable from "the week
 * has not been read yet".
 *
 * BOTH numbers, from the one pass. `fetchWeekRosters` has always returned
 * `actual` beside `projected` and this page only ever read the projection; the
 * card's Act row is that second field, not a second fetch. Building one index
 * with both in it is also what keeps the two rows of the chart honest — they
 * cannot be about different weeks, or different men, because they came out of
 * the same entry.
 */
function seasonIndex(teamId) {
  const byWeek = new Map();
  for (const [week, teams] of state.seasonWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) { byWeek.set(week, null); continue; }
    const byPlayer = new Map();
    for (const p of team.players) {
      byPlayer.set(p.playerId, {
        projected: typeof p.projected === 'number' ? p.projected : null,
        actual: typeof p.actual === 'number' ? p.actual : null,
        // That week's own status, so a zero is judged by who he was THEN.
        injuryStatus: p.injuryStatus || null,
      });
    }
    byWeek.set(week, byPlayer);
  }
  return byWeek;
}

/**
 * One field of one player's week, in five distinguishable states:
 *   'wait'    the week has not been read yet
 *   'failed'  ESPN refused that week for everybody
 *   'off'     he was not on this roster in that week
 *   null      ESPN carried no number for him that week
 *   number    the value itself
 *
 * The three string states are facts about the WEEK and the ROSTER rather than
 * about either number, so they are decided once here and both readers below
 * get the same answer. Splitting them would be two copies of the hardest part.
 */
function seasonField(index, week, playerId, field) {
  const byPlayer = index.get(week);
  if (byPlayer === undefined) return state.seasonFailed.has(week) ? 'failed' : 'wait';
  if (byPlayer === null) return 'off';
  if (!byPlayer.has(playerId)) return 'off';
  return byPlayer.get(playerId)[field];
}

/** His projection for that week. 0 means his NFL team is on bye. */
function seasonValue(index, week, playerId) {
  return seasonField(index, week, playerId, 'projected');
}

/**
 * What he ACTUALLY scored that week — null until the game has been played and
 * ESPN has a number for it, which is what makes the card's Act row blank for
 * every week still to come without this page having to consult a calendar.
 */
function seasonActual(index, week, playerId) {
  return seasonField(index, week, playerId, 'actual');
}

/**
 * His injury status in that week's payload, falling back to the one on the
 * roster being shown. ESPN's is today's status in every week; the sample data
 * varies it week by week, and a ruled-out zero has to be read against its own.
 */
function seasonStatus(index, week, p) {
  const byPlayer = index ? index.get(week) : null;
  const e = byPlayer ? byPlayer.get(p.playerId) : null;
  return (e && e.injuryStatus) || p.injuryStatus || null;
}

/**
 * The cell. No `data-v` at all — never data-v="" — for anything that is not a
 * number, so an unknown sinks to the bottom whichever way the column is sorted.
 *
 * `start` is the "Who to start" panel's marker and nothing else reads it: null
 * from the season grid above, which stays deliberately uncoloured, and
 * `{ slotId, flex }` from the panel at the foot when this man is in the best
 * legal lineup that week. It is threaded through here rather than given a cell
 * renderer of its own because the FIVE ways of having no number — not read yet,
 * ESPN refused the week, not on the roster, no number at all, and a bye — cost
 * real effort to tell apart and must not be reimplemented next door where the
 * two copies can drift.
 */
function seasonCell(v, week, p, isNow, start = null, status = p.injuryStatus) {
  const name = p.name;
  const mark = start ? ` st${start.flex ? ' fx' : ''}` : '';
  const cls = (extra) => `wk${isNow ? ' now' : ''}${extra ? ` ${extra}` : ''}${mark}`;
  // A start is a fact about the lineup, so it is said on every cell that has
  // one — including a bye, which is exactly when a start is worth noticing.
  const says = start
    ? ` ${esc(name)} is in the best legal lineup for week ${week}` +
      (start.flex ? ', in the FLEX.' : `, at ${esc(espn.SLOT_LABELS[start.slotId] || '')}.`)
    : '';

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
    // A 0.00 is his bye only when the week IS his team's bye; otherwise it is a
    // real zero, and a ruled-out man's carries the word. Decided once, in
    // js/player-card.js. The sample data never means a bye by a zero.
    const zero = zeroOf(v, week, p, status);
    if (zero === 'bye') {
      return `<td class="${cls('bye')}" data-v="0" title="${esc(name)} is on bye in week ${week}. ` +
        `ESPN returns 0.00 for a bye, which is not the same as having no number at all.${says}">Bye</td>`;
    }
    const why = state.isDemo
      ? `The sample data has ${esc(name)} ruled out in week ${week}, so it projects nothing for him.`
      : `ESPN projects nothing for ${esc(name)} in week ${week}` +
        (byeWeekOf(p, state.byes) ? `, and it is not his bye (week ${byeWeekOf(p, state.byes)})` : '') +
        (zero === 'out' ? ` — he is listed ${esc(String(status).replace(/_/g, ' ').toLowerCase())}.` : '.');
    if (zero === 'out') {
      return `<td class="${cls('zero-out')}" data-v="0" title="${why}${says}">0.0 ` +
        `<span class="zmark">${esc(outMark(status))}</span></td>`;
    }
    return `<td class="${cls('zero')}" data-v="0" title="${why}${says}">0.0</td>`;
  }
  return `<td class="${cls()}" data-v="${v}" ` +
    `title="ESPN projects ${fmt(v)} for ${esc(name)} in week ${week}.${says}">${fmt(v)}</td>`;
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
      return weekHead(w, weeks, cls, title);
    })
    .join('');

  $('seasonTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="left" data-sort>Slot</th>
       <th class="name" data-sort>Player</th>
       <th class="left" data-sort>Pos</th>
       <th class="left" data-sort>NFL</th>
       <th class="grouped" data-sort title="The mean of the regular-season week columns that carry a number; playoff weeks are not counted. Ours, not ESPN’s: a bye counts as the zero ESPN returns, and a week he is not on the roster for is left out.">Avg</th>
       ${cols}
     </tr>`;
}

function renderSeason() {
  const table = $('seasonTable');
  const tbody = bodyOf(table);
  const team = currentTeam();
  const weeks = spanWeeks();
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
    $('seasonLegend').innerHTML = '';
    $('seasonAlert').innerHTML = '';
    $('seasonAlert').classList.add('hidden');
    tbody.innerHTML = '';
    renderStarters(); // it has an empty state of its own and must reach it
    return;
  }

  const index = seasonIndex(team.id);

  tbody.innerHTML = view
    .map((entry) => {
      const p = entry.p;
      const values = weeks.map((w) => seasonValue(index, w, p.playerId));
      const avg = regularAvg(values, weeks);

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
        ${values.map((v, i) => withPo(seasonCell(v, weeks[i], p, weeks[i] === state.week, null,
          seasonStatus(index, weeks[i], p)), weeks[i], weeks)).join('')}
      </tr>`;
    })
    .join('');

  renderSeasonNote(weeks, players.length);
  resort(table);

  // Driven from here rather than from each of renderSeason's ten call sites:
  // the two panels read the same week cache for the same team, so every reason
  // to repaint one is a reason to repaint the other, and a new call site added
  // later cannot forget this one.
  renderStarters();
}

// ------------------------------------------- who to start, week by week
//
// Tim's ask, in his own words: see who to start each week of the season to keep
// the lineup balanced, and know where and when the bench comes in to cover a
// bye or just a soft week for a starter.
//
// So: one position at a time, that team's men at it in depth order, the same
// week run the season grid draws — and every week a man is in the BEST LEGAL
// LINEUP marked. Read along a row and you see a starter's soft weeks; read down
// a column and you see who covers them.
//
// IT COSTS NOTHING. `state.seasonWeeks` is already bought by the panel above —
// one request per week, no bulk form, which is this page's whole cost model —
// and every team is in every week's payload, so the position buttons and the
// team picker are both repaints. No fetch belongs anywhere near here.

/** QB, RB, WR, TE, DEF, K — and FLEX, which is a filter over three of them. */
const STARTER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];
const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];

/** ESPN's own slot ids that mean "the flex", as opposed to a position's own. */
const FLEX_SLOTS = new Set([3, 5, 7, 23]);

/**
 * The league's starting slots, read off every lineup we hold.
 *
 * ESPN will not accept an illegal lineup, so the non-bench slots in use ARE the
 * configuration — no extra request, and no hand-written default that would
 * understate a three-receiver league by a whole starter if it guessed wrong.
 * Pooled across every week as well as every team, because a manager sitting one
 * slot empty in the week on screen must not shrink the league's shape.
 */
function leagueSlots() {
  const pool = [];
  if (state.data && state.data.teams) pool.push(...state.data.teams);
  for (const teams of state.seasonWeeks.values()) pool.push(...teams);
  const counts = slotCountsFromLineups(pool);
  return counts ? slotsFromCounts(counts) : null;
}

/**
 * Who this team should start in each week, and in which slot.
 *
 * `optimalLineup` is `js/forecast.js`'s, unchanged — the same function the
 * schedule page's forecast and the trade finder both use, so the three can
 * never disagree about who a squad ought to be starting. It fills the most
 * restrictive slots first, which is provably optimal because the eligibility
 * sets nest, and it reads `projected`, which in a week's payload IS that week's
 * projection.
 *
 * A man on bye comes back from ESPN at 0.00 and simply loses his place to
 * somebody better, which is what a manager would do — so byes need no handling
 * of their own here. That they need none is the entire feature: the mark moves
 * off him and onto whoever covers, and the panel shows you who.
 *
 * The reader's what-if swaps in the roster detail are deliberately NOT applied.
 * Those are one week's experiment; this answers what the numbers say across the
 * whole season, and folding an override into it would quietly make a hand-moved
 * lineup look like advice.
 *
 * @returns {Map<number, Map<number, number>>} week -> playerId -> slotId
 */
function weeklyStarters(teamId, slots) {
  const out = new Map();
  if (!slots || teamId === null || teamId === undefined) return out;
  for (const [week, teams] of state.seasonWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) continue;
    const { starters } = optimalLineup(identified(team.players), slots);
    out.set(week, new Map(starters.map((s) => [s.playerId, s.slotId])));
  }
  return out;
}

/**
 * Only men ESPN gave an id for, and the lineup is solved over these alone.
 *
 * A player with no `playerId` cannot be followed from one week to the next —
 * there is nothing to say that the man in week 5 is the man in week 6 — so he
 * can have no row here, and `seasonIndex` would collapse every one of them onto
 * a single `undefined` key if he did. Leaving him IN the solve would then mark a
 * lineup spot that no row can carry, which is the one failure this panel must
 * not have: the reader counts the shaded cells and concludes a slot went empty.
 *
 * So he is left out of both, and `renderStartersNote` says how many that was.
 * Disclosed and slightly incomplete beats confident and unaccountable — and it
 * is the same reason the click-through refuses to link him rather than pointing
 * at `?player=undefined`.
 */
function identified(players) {
  return (players || []).filter((p) => p.playerId !== null && p.playerId !== undefined);
}

/** How many men at this position the panel had to leave out, in the shown weeks. */
function unidentifiedCount(team, weeks) {
  const shown = new Set(weeks);
  let worst = 0;
  for (const [week, teams] of state.seasonWeeks) {
    if (!shown.has(week)) continue;
    const t = teams.find((x) => x.id === (team ? team.id : null));
    const n = ((t && t.players) || [])
      .filter((p) => (p.playerId === null || p.playerId === undefined) && inStarterPos(p)).length;
    worst = Math.max(worst, n);
  }
  const now = ((team && team.players) || [])
    .filter((p) => (p.playerId === null || p.playerId === undefined) && inStarterPos(p)).length;
  return Math.max(worst, now);
}

/** Does this man belong under the button currently pressed? */
function inStarterPos(p) {
  return state.startersPos === 'FLEX'
    ? FLEX_ELIGIBLE.includes(p.position)
    : p.position === state.startersPos;
}

/**
 * Everyone who held this position for this team across the weeks on screen.
 *
 * THE UNION, and not the selected week's roster alone. That was the first
 * version and it was quietly wrong: rosters really do change week to week, so
 * a week whose lineup was filled by somebody since dropped had a starter with
 * no row — and the panel then showed a week where, apparently, nobody at the
 * position started at all. Autumn's week 7 in the sample data is exactly that
 * case: the second back is Kellan Wainwright, who is not on the week 4 roster
 * the page happened to be showing.
 *
 * A mark that cannot be seen is worse than no mark, because the reader counts
 * the shaded cells and concludes a lineup slot went empty. Same rule, and the
 * same reason, as the Taken table's membership on the Players page.
 *
 * The identity comes from the LATEST week he appears in, so a man who changed
 * NFL team mid-season reads as where he is now, and the selected week wins
 * outright when it has him.
 */
function positionPool(team, weeks) {
  const byId = new Map();
  const shown = new Set(weeks);
  for (const [week, teams] of [...state.seasonWeeks].sort((a, b) => a[0] - b[0])) {
    if (!shown.has(week)) continue;
    const t = teams.find((x) => x.id === (team ? team.id : null));
    for (const p of (t && t.players) || []) {
      if (p.playerId === null || p.playerId === undefined) continue;
      byId.set(p.playerId, p);
    }
  }
  for (const p of (team && team.players) || []) {
    if (p.playerId === null || p.playerId === undefined) continue;
    byId.set(p.playerId, p);
  }
  return [...byId.values()].filter(inStarterPos);
}

/**
 * The rows: everyone who held the chosen position, deepest chart first.
 *
 * Ordered by their average over the weeks on screen, which is what "starter to
 * bench" means once you are looking at a whole season rather than one week —
 * ESPN's current slot only says where a manager has parked somebody today, and
 * this panel exists precisely to disagree with that when the numbers do.
 *
 * The rank is computed HERE, off the same averages the panel prints, so the
 * `RB2` beside a row always agrees with the Avg column next to it. Under FLEX
 * every man keeps his OWN position's rank — there is no such thing as a FLEX2,
 * because the rank says how deep this squad is at a position and the button
 * only decides which rows you can see.
 *
 * Only men on the roster in the SELECTED week are ranked. A depth chart is a
 * statement about the squad you have; someone dropped in week 3 is in the table
 * to explain week 3's lineup and is not this manager's RB2 today.
 */
function starterRows(team, weeks, index, starters) {
  const onRosterNow = new Set(
    ((team && team.players) || []).map((p) => p.playerId)
  );

  const rows = positionPool(team, weeks)
    .map((p) => {
      const values = weeks.map((w) => seasonValue(index, w, p.playerId));
      const startsIn = weeks.filter((w) => {
        const wk = starters.get(w);
        return wk && wk.has(p.playerId);
      });
      return {
        p,
        values,
        held: onRosterNow.has(p.playerId),
        avg: regularAvg(values, weeks),
        // Out of the weeks actually READ, never out of all of them: a squad
        // half-loaded would otherwise look like a squad half-benched. The
        // playoff weeks count here: Starts is the number of marked cells on
        // the row, and a playoff week is marked like any other. Only Avg is
        // kept to the regular season.
        starts: startsIn.length,
        decided: weeks.filter((w) => starters.has(w)).length,
      };
    })
    // A man off the roster earns his row by having FILLED a slot, and by
    // nothing else. That is the entire reason the pool is a union — to give
    // every shaded cell somewhere to sit — so a departed player who never
    // started has no mark to explain and is only clutter. Left in, the sample
    // league's running backs ran to fourteen rows, nine of them men Tim no
    // longer holds and seven of those never in a lineup at all.
    .filter((row) => row.held || row.starts > 0)
    .sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity) || a.p.playerId - b.p.playerId);

  // Depth rank, per real position, over the men actually held right now.
  const seen = new Map();
  for (const row of rows) {
    const posIndex = STARTER_POSITIONS.indexOf(row.p.position);
    if (row.held) {
      const n = (seen.get(row.p.position) || 0) + 1;
      seen.set(row.p.position, n);
      row.depth = `${row.p.position === 'DST' ? 'DEF' : row.p.position}${n}`;
      row.depthValue = posIndex * 100 + n;
    } else {
      row.depth = '—';
      // Nulls-last INSIDE the position group, which is the only place it can
      // go: his position is known and only his rank is absent. Dropping the
      // data-v instead would let sortable.js fall back to the cell text, and
      // "—" would lead the column. Same trick, and the same trap, as the Taken
      // table's unranked players.
      row.depthValue = posIndex * 100 + 99;
    }
  }
  return rows;
}

function renderStartersHead(weeks) {
  const cols = weeks
    .map((w) => {
      const failed = state.seasonFailed.has(w);
      const cls = ['wk', w === state.week ? 'now' : '', failed ? 'muted' : '']
        .filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : `ESPN’s projected points for week ${w}, and whether he starts.`;
      return weekHead(w, weeks, cls, title);
    })
    .join('');

  $('startersTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="left" data-sort title="How deep he is at his own position on this squad, by the Avg beside it.">Depth</th>
       <th class="name" data-sort>Player</th>
       <th class="left" data-sort>Pos</th>
       <th class="left" data-sort>NFL</th>
       <th class="grouped" data-sort title="The mean of the regular-season week columns that carry a number; playoff weeks are not counted. A bye counts as the zero ESPN returns; a week he is not on the roster for is left out.">Avg</th>
       <th data-sort title="How many of the weeks read he is in the best legal lineup for, playoff weeks included.">Starts</th>
       ${cols}
     </tr>`;
}

function renderStarters() {
  const table = $('startersTable');
  const tbody = bodyOf(table);
  const team = currentTeam();
  const weeks = spanWeeks();
  const label = state.startersPos === 'DST' ? 'DEF' : state.startersPos;

  $('startersTitle').textContent = team
    ? `Who to start, week by week · ${team.name} · ${label}`
    : 'Who to start, week by week';

  setStarterToggle();
  renderStartersHead(weeks);

  const slots = leagueSlots();
  const index = team ? seasonIndex(team.id) : new Map();
  const starters = team ? weeklyStarters(team.id, slots) : new Map();
  const rows = starterRows(team, weeks, index, starters);

  const show = rows.length > 0 && weeks.length > 0;
  $('startersWrap').classList.toggle('hidden', !show);
  $('startersEmpty').classList.toggle('hidden', show);
  tbody.innerHTML = '';

  if (!show) {
    $('startersEmpty').textContent = startersEmptyReason(team, weeks, label);
    $('startersNote').innerHTML = '';
    $('startersLegend').innerHTML = '';
    $('startersShape').innerHTML = '';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const p = row.p;
      const cells = row.values
        .map((v, i) => {
          const week = weeks[i];
          const slotId = starters.has(week) ? starters.get(week).get(p.playerId) : undefined;
          const start =
            slotId === undefined ? null : { slotId, flex: FLEX_SLOTS.has(slotId) };
          return withPo(seasonCell(v, week, p, week === state.week, start, seasonStatus(index, week, p)),
            week, weeks);
        })
        .join('');

      const cls = [row.starts === 0 ? 'never' : '', row.held ? '' : 'gone']
        .filter(Boolean).join(' ');
      const who = row.held
        ? `${p.name} · ${p.position === 'DST' ? 'DEF' : p.position} · ${p.proTeam}`
        : `${p.name} · ${p.position === 'DST' ? 'DEF' : p.position} · ${p.proTeam} — not on this ` +
          `roster in week ${state.week}. He is here because he filled a lineup spot in one of the ` +
          `weeks shown, and a marked week with no row to put it on would read as an empty slot.`;

      return `
      <tr class="${cls}">
        <td class="left" data-v="${row.depthValue}"><span class="depth-tag${row.held ? '' : ' muted'}">${esc(row.depth)}</span></td>
        <td class="name" title="${esc(who)}">${
          playerRef(p, esc(p.name), `${p.name} — ${OPENS}`)}</td>
        <td class="left">${esc(p.position === 'DST' ? 'DEF' : p.position)}</td>
        <td class="left">${esc(p.proTeam)}</td>
        <td class="avg grouped"${row.avg === null ? '' : ` data-v="${row.avg}"`}>${fmt(row.avg)}</td>
        <td class="starts" data-v="${row.starts}">${row.starts}</td>
        ${cells}
      </tr>`;
    })
    .join('');

  renderStartersNote(weeks, rows, slots, label, unidentifiedCount(team, weeks));
  resort(table);
}

/** Which button is lit, decided by the code rather than by the last click. */
function setStarterToggle() {
  $('starterPosToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.pos === state.startersPos));
}

function startersEmptyReason(team, weeks, label) {
  if (!weeks.length) {
    return 'No weeks came back for this season, so there is nothing to lay out across the top.';
  }
  if (!team) return 'Pick a team above to see who it should start.';
  return `${team.name} has nobody at ${label} in week ${state.week}, so there is no depth chart ` +
    `to follow. Try another position.`;
}

function renderStartersNote(weeks, rows, slots, label, unidentified = 0) {
  const decided = rows.length ? rows[0].decided : 0;
  const pending = weeks.length - decided;

  // How many of this position the league actually starts, said out loud,
  // because "why are two of my three receivers green" is the first question.
  const dedicated = (slots || []).filter((id) => {
    const el = espn.SLOT_ELIGIBILITY[id];
    return el && el.length === 1 && el[0] === state.startersPos;
  }).length;
  const flexes = (slots || []).filter((id) => FLEX_SLOTS.has(id)).length;

  const shape =
    state.startersPos === 'FLEX'
      ? `This league starts <strong>${plural(flexes, 'flex')}</strong>, and everyone here is eligible for one.`
      : dedicated
        ? `This league starts <strong>${plural(dedicated, label)}</strong>` +
          (flexes && FLEX_ELIGIBLE.includes(state.startersPos)
            ? `, plus ${plural(flexes, 'flex')} anyone here can fill.`
            : '.')
        : `This league has no dedicated ${label} slot.`;

  const covered = rows.filter((r) => r.starts > 0 && r.starts < decided).length;
  const gone = rows.filter((r) => !r.held).length;

  // The league's shape for this position answers the first question the
  // shading raises, so it sits beside the position picker rather than in the toggle.
  $('startersShape').innerHTML = shape;

  const table = $('startersTable');
  const body = bodyOf(table);
  renderKey('startersLegend', [
    body.querySelector('td.st:not(.fx)') && ['<span class="lg-mark st">12.3</span>', 'in the best lineup'],
    body.querySelector('td.st.fx') && ['<span class="lg-mark st fx">12.3</span>', 'in it through the flex'],
    gone && ['<span class="lg-mark ital">Name</span>', `not on the roster in week ${state.week}`],
    // The demo notice is already on screen in the Season panel just above.
    ...seasonMarks(table).slice(1),
  ], 'Across a row: his weeks · down a column: who covers');

  const paras = [
    `One position at a time, deepest first. A <strong class="key-st">shaded, bold</strong> number is a week ` +
    `this man is in the <strong>best legal lineup</strong> that team could field — the same rule the ` +
    `grids at the top of the page use, run once per week on that week&rsquo;s own projections. ` +
    `A <strong>F</strong> beside it means he only gets in through the <strong>flex</strong>.`,

    `<strong>Read along a row</strong> to see a starter&rsquo;s soft weeks and his bye; ` +
    `<strong>read down a column</strong> to see who covers them. A cell reading <strong>Bye</strong> is ` +
    `the 0.00 ESPN returns for a player whose NFL team is off that week, which is exactly when the mark ` +
    `moves to somebody else &mdash; ` +
    (covered
      ? `<strong>${plural(covered, 'man')}</strong> here starts some weeks and not others, which is the ` +
        `bench doing its job.`
      : `nobody here starts some weeks and not others, so this position needs no cover over these weeks.`),

    `<strong>Depth</strong> and <strong>Avg</strong> are ours, not ESPN&rsquo;s: the order is each ` +
    `man&rsquo;s mean over the weeks shown, not the slot his manager has him parked in today. ` +
    (gone
      ? `<strong>${plural(gone, 'player')}</strong> here ${gone === 1 ? 'is' : 'are'} <em>italic</em> and ` +
        `ranked &ldquo;&mdash;&rdquo;: not on this roster in week ${state.week}, but ${gone === 1 ? 'he' : 'they'} ` +
        `filled a lineup spot in one of the weeks shown, and a shaded week with no row to sit on would ` +
        `read as a slot going empty. `
      : '') +
    (state.poWeeks.length
      ? `The <strong>playoff weeks</strong> (${weekRange(state.poWeeks)}) sit after a heavy line, ` +
        `headed PO, with the best lineup marked the same way. They count in Starts and are left out of Avg. `
      : '') +
    `<strong>Starts</strong> counts the weeks actually read from ESPN` +
    (pending > 0 ? ` — <strong>${plural(pending, 'week')}</strong> still loading, so it will rise.` : '.'),

    `The swaps in the Roster detail above are a what-if for one week and are deliberately not ` +
    `applied here. Every name is a link to that man&rsquo;s next 13 weeks on the ` +
    `<a href="waivers.html">Players</a> page.`,
  ];
  if (unidentified) {
    paras.push(
      `<strong>${plural(unidentified, label)}</strong> at this position came back from ESPN ` +
      `with no player id, so ${unidentified === 1 ? 'he is' : 'they are'} left out of both the table ` +
      `and the lineups above &mdash; there is nothing to say the man in one week is the man in the ` +
      `next, and a shaded week with no row to sit on would read as a slot going empty.`
    );
  }
  $('startersNote').innerHTML = paras.map((t) => `<p>${t}</p>`).join('');
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
  const regular = weeks.filter((w) => !isPlayoff(w));
  const po = weeks.filter(isPlayoff);
  parts.push(
    `Covering ${weekRange(regular)} — ${plural(regular.length, 'week')} this season runs to` +
    (po.length ? `, then the playoffs (${weekRange(po)}) after the heavy line` : '') +
    (loaded === weeks.length ? ', all loaded.' : `, ${loaded} of ${weeks.length} loaded so far.`)
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
        'is off that week. ESPN also returns 0.00 for a man it has ruled out, so a zero in any ' +
        'other week is printed as <strong>0.0</strong>, with OUT, IR or SUSP beside it when that is ' +
        'why — checked against his NFL team’s bye week, and read as a bye only when that is not known. ') +
    'A dash is not that: it means either that ESPN carried no number for him, or that he was not ' +
    'on this roster in that week — ESPN hands back each past week’s real roster, and today’s ' +
    'roster for every week still to come. Tap or hover a cell to see which.'
  );

  parts.push(
    'Avg is the mean of the weeks that carry a number and is ours, not ESPN’s: a bye counts as ' +
    'the zero ESPN returns, so does a ruled-out week, and a week he is not on the roster for is left out. ' +
    'It is a regular-season average: the playoff weeks are shown but not counted.'
  );

  parts.push(
    'Nothing in this table is highlighted, on purpose. Everyone here is already rostered, so the ' +
    'per-position bar that flags a startable week on the <a href="waivers.html">Players</a> ' +
    'page would light up nearly every cell and tell you nothing.'
  );

  $('seasonNote').innerHTML = parts.map((t) => `<p>${t}</p>`).join('');

  // Weeks ESPN refused are an error, so they are said on screen, not in the toggle.
  const failed = [...state.seasonFailed].sort((a, b) => a - b).filter((w) => weeks.includes(w));
  const alert = $('seasonAlert');
  alert.innerHTML = failed.length
    ? `<span class="neg">ESPN did not return ${failed.length === 1 ? 'week' : 'weeks'} ` +
      `${andList(failed.map(String))}, so ${failed.length === 1 ? 'that column is' : 'those columns are'} ` +
      `blank for everyone and the average is taken from the weeks that did load. Reload the page ` +
      `to try again.</span>`
    : '';
  alert.classList.toggle('hidden', !failed.length);

  renderKey('seasonLegend', seasonMarks($('seasonTable')),
    'Tap or hover a cell for what it means');
}

/**
 * The marks a week run can carry that are not a plain number, for whichever of
 * the two week-run tables is passed in — only those actually on screen.
 */
function seasonMarks(table) {
  const body = bodyOf(table);
  const has = (sel) => !!body.querySelector(sel);
  return [
    state.isDemo && ['<span class="badge demo">Demo</span>', 'generated projections, not ESPN’s'],
    has('td.wk.zero-out') &&
      ['<span class="lg-mark zero-out">0.0 <span class="zmark">OUT</span></span>',
        state.isDemo ? 'ruled out in the sample data' : 'ruled out, not a bye'],
    has('td.wk.zero') &&
      ['<span class="lg-mark">0.0</span>',
        state.isDemo ? 'ruled out in the sample data' : 'projected at zero, not a bye'],
    has('td.wk.bye') && ['<span class="lg-mark bye">Bye</span>', 'no game (ESPN’s 0.00)'],
    has('td.wk.off') && ['<span class="lg-mark faint">—</span>', 'not on this roster that week'],
    has('td.wk.muted') && ['<span class="lg-mark faint">—</span>', 'no number from ESPN'],
    has('td.wk.wait') && ['<span class="lg-mark faint">·</span>', 'not loaded yet'],
    has('td.po-start') &&
      ['<span class="lg-mark po-key"><span class="po-tag">PO</span></span>', 'playoff weeks — not in Avg'],
  ];
}

/** Selecting a team touches four places, so nobody calls them separately. */
function selectTeam(id) {
  if (id === null || Number.isNaN(id) || id === state.teamId) return;
  state.teamId = id;
  // For THIS visit. It used to be saved, and every later visit reopened on
  // whichever squad was tapped last — usually a rival glanced at once. A visit
  // opens on your own team; the pick is remembered only when the connection
  // bar has never been told which team is yours, since then there is nothing
  // better to open on.
  state.teamPickedOn = state.source;
  if (state.myTeamId === null || state.myTeamId === undefined) prefs.set('team', id);
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

/**
 * After a row tap, bring the roster detail on screen — but only if it is not.
 *
 * On a phone the two grids are most of a screen each, so the team a tap just
 * loaded was two screens down and the tap looked like it had done nothing. On
 * a desktop the detail is usually already in view, and yanking the page there
 * would be the page moving on its own; so it scrolls only when the panel's
 * heading is above the window or in the bottom stretch of it. Smooth, so the
 * reader sees where it went. Guarded: a harness has no layout and no scrolling.
 */
function revealRoster() {
  const head = $('rosterTitle');
  if (!head || typeof head.getBoundingClientRect !== 'function') return;
  try {
    const r = head.getBoundingClientRect();
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
    if (!vh) return;
    const visible = r.top >= 0 && r.top <= vh - 120;
    if (visible) return;
    head.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch { /* no layout: the team is selected either way */ }
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
  state.weekPicked = true;   // honoured for the rest of this visit, past or not
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
    if (clickIsPlayer(e)) return;
    const tr = e.target.closest('tr[data-team]');
    if (!tr) return;
    selectTeam(Number(tr.dataset.team));
    revealRoster();
  });
  // The grids are the reason to be here, so they open on the number that ranks
  // teams: Total, high first. Column 10 — the team, the nine spots, then it.
  enableSort($(`${grid.id}Table`), { defaultIndex: GRID_SLOTS.length + 1 });
  wireTips($(`${grid.id}Table`));
}

enableSort($('rosterTable'), { defaultIndex: 0, defaultAsc: true });

// The season grid opens in lineup order — starters first, bench after — so it
// reads as a squad rather than as a leaderboard. Avg is one click away for
// anyone who wants the other question answered.
enableSort($('seasonTable'), { defaultIndex: 0, defaultAsc: true });

// "Who to start" opens on Depth — RB1, RB2, RB3 — because a depth chart read
// out of order is not a depth chart. Ascending, so the starter is at the top.
enableSort($('startersTable'), { defaultIndex: 0, defaultAsc: true });

$('starterPosToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-pos]');
  if (!btn || btn.dataset.pos === state.startersPos) return;
  state.startersPos = btn.dataset.pos;
  prefs.set('startersPos', state.startersPos);
  // A repaint and nothing else. Every week is already in the cache and every
  // team is in every week, so changing position can never cost a request.
  renderStarters();
});

// ------------------------------------------------------------------- start up

const boot = savedConfig();
if (boot && boot.teamId != null) state.myTeamId = Number(boot.teamId);

// A remembered team only when the page has no idea which one is yours — with
// one known, every visit opens on it and `resolveTeam()` picks it.
const rememberedTeam = prefs.get('team', null);
if (rememberedTeam !== null && state.myTeamId === null) state.teamId = rememberedTeam;

// A saved position that is no longer one of the buttons falls back rather than
// wedging the panel on a filter with nothing lit.
const rememberedPos = prefs.get('startersPos', null);
if (STARTER_POSITIONS.includes(rememberedPos) || rememberedPos === 'FLEX') {
  state.startersPos = rememberedPos;
}

// Demo only: the sample season is over, so there is no "coming week" to prefer
// and a saved week is simply honoured. Live mode decides in `openingWeek()`.
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
  else if (!state.isDemo) {
    // "Your team" may have just changed. The detail follows it unless a team
    // was tapped on this league this visit.
    if (state.myTeamId !== null && state.teamPickedOn !== 'live' && state.teamId !== state.myTeamId &&
        state.data && state.data.teams.some((t) => t.id === state.myTeamId)) {
      state.teamId = state.myTeamId;
      render();
    } else {
      renderOverview();
    }
  }
});
