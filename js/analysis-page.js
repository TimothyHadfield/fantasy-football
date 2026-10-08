// Roster analysis: every manager's squad, side by side.
//
// The all-teams grid at the top is the point of the page. The owner's standing
// request is to see the most important information for ALL teams at once, and
// this page once showed ten rows of totals plus exactly ONE team's actual
// players — so working out who was thin at running back meant clicking through
// ten managers and holding it in your head. The grid puts all ten squads on one
// screen, whole: nine lineup spots, what they total, and the bench behind them.
//
// THERE USED TO BE TWO OF IT, one measured on the season average and one on the
// selected week, stacked down the page. Tim, 2026-09-17: "combine the 2 all
// teams boxes, put the week selection at the top of the all teams box, and
// allow the user to select which week they want, as well as if they want to
// show proj avg 2026." So there is one panel, one grid, and the MEASURE is a
// control inside it — which is all the two ever differed by (see MEASURES).
//
// Rosters move week to week — trades, waivers, injuries — so the week selector
// stays the primary control, and it now lives inside that panel. It still
// drives the whole page: the roster detail, the season sheet's "you are here"
// bracket and "who to start" all read the same selected week, whether or not
// the grid is currently measured in it.

import { fetchWeekRosters, fetchWeeksRosters, fetchSchedule } from './season.js';
// The namespace as well, for `fetchByeWeeks`, which is read defensively: a
// season module (or a test stub of one) without it just means "byes unknown".
import * as season from './season.js';
// `sortBy` because ONE table on this page changes shape: the all-teams grid has
// nine player columns on its week measure and one per lineup slot on its
// average, so "the Total column" is not the same index in both.
import { enableSort, resort, sortBy } from './sortable.js';
// `coarsePointer` is no longer imported here: the only two things on this page
// that turned on it — whether the card opens as a sheet, and whether a tap on a
// grid cell counts as a click on a player — both live in js/player-card.js now,
// and it imports it from the same one place the connection bar does.
// `coarsePointer` is back here, and for a new reason: the season panel has no
// player card any more, so THIS file is what has to answer a tap — see the
// click handler at the foot. It is still the one canonical "is this a finger"
// test and still lives in js/connection.js; player-card.js imports the same one.
import { savedConfig, onConnection, coarsePointer } from './connection.js';
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
// The ONE standard deviation on this site, and the ONE rule about when there is
// not enough data to have one: `stdev` returns null below two values, and the
// season panel's red marks are switched off entirely when it does. See rule 5
// in HANDOFF.md — deciding what a statistic returns before it has enough data.
import { stdev } from './stats.js';
// THE SHARED RED/GREEN SCALE (Tim, 2026-09-19). It REPLACED this page's own two
// low marks on "Season by week" — his instruction, in his words: "it will
// replace the current system we have with the colorization of the season week
// by week box". One module, so the season sheet and the all-teams grid above it
// cannot end up on two different scales for what is ultimately the same claim.
// `describeHeatPerColumn` rather than `describeHeat`: both tables here carry
// MANY scales — one per lineup slot — so there is no single pair of thresholds
// to print in a sentence. The season sheet prints its nine pairs under the
// table instead (`seasonBars`), which is the same promise kept table-shaped.
import { heatScale, heatOf, heatMarkHtml, describeHeatPerColumn } from './heat.js';
import * as espn from './espn.js';
// The ONE definition of the playoff weeks (last regular week + one per round).
import { playoffWeeks as leaguePlayoffWeeks } from './capture.js';
// The slot vocabulary is shared with the Trade page's per-week breakdown, so
// the two cannot disagree about what WR2 means. See js/lineup-slots.js.
import { SLOT_ORDER, slotRows, fillSlots } from './lineup-slots.js';
// The small LIVE badge beside a week still being played — the Decisions page's.
import { LIVE_TAG } from './actual-season-table.js';
// THE POSITIONAL FLOOR — no slot assessed below what the wire would give you
// there (Tim, 2026-09-18). Pure, and every one of these is a no-op when
// `state.floors` is null, which is what keeps demo and a failed read honest.
import { flooredValue, slotFloor, describeFloors, floorSource } from './floor.js';
// PROJ CHANGES (Tim, 2026-10-05): the sheet as it stood in an earlier week. The
// copies are kept by js/capture.js; this page only ever READS them — storage,
// never a request — and draws the switch and the signed cells the Trade and
// Decisions pages draw.
import * as projHistory from './proj-history.js';
import { viewSwitchHtml, viewFromClick, signedText, diffOf, diffClass } from './view-switch.js';

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
// grid totals the league's whole starting lineup (ten men in Tim's league) and
// there is no allowance to add.

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

  // What the one all-teams grid is measured in: 'week' (the selected week's own
  // projections) or 'avg' (the season projection spread over a typical week).
  // It replaces the second grid the page used to stack underneath the first,
  // and it is remembered in the page's own prefs. The DEFAULT is the week,
  // because the coming week is what a manager opens this page to set a lineup
  // for — the same reasoning openingWeek() is built on.
  measure: 'week',

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

  // THE POSITIONAL FLOOR (Tim, 2026-09-18): a Map of position -> the best free
  // agent there, read from the wire ONCE and used for every week. Null until
  // the read lands, and null for ever in demo — which is the whole safety of
  // it: with no floors every number on this page is exactly what ESPN sent,
  // and nothing on screen claims otherwise. See js/floor.js.
  floors: null,
  floorWeek: null,

  // The man under the pointer in the season panel, as a playerId (or null).
  // The panel's rows are SLOTS now, so the same man turns up in several of
  // them across the weeks and nowhere is his name written; lighting every cell
  // he holds, and naming him on the line above the table, is what puts the
  // person back into a grid made entirely of bare numbers.
  seasonLit: null,

  // The week the "Proj changes" box was pointed at THIS visit, or null for its
  // own default (the newest saved week before the current one).
  changesWeek: null,

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

  // A link into the roster detail (`?team=&week=`), or null. See "Landing on a
  // roster" below: it is this visit's answer, never a saved choice.
  landing: null,
};

// Cache per week so flipping back to a week already loaded is instant.
const cache = new Map(); // `${source}:${week}` -> {week, teams}

// ------------------------------------------------------------------ formatting

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

// ROUNDED FIRST, THEN SIGNED — the rule js/standings-table.js adopted on
// 2026-10-06: a value that rounds to zero is zero, no sign, the neutral class.
function signed(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '<span class="muted">—</span>';
  const r = Number(n.toFixed(digits)) + 0;   // + 0: a rounded −0 is 0
  const cls = r > 0 ? 'pos' : r < 0 ? 'neg' : 'muted';
  const sign = r > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${r.toFixed(digits)}</span>`;
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

/**
 * THE TWO POINTS WHERE A SCALE REACHES FULL COLOUR, in points.
 *
 * Rounded to the tenth every number on this page is printed at, because this is
 * what goes on screen under the table: a reader checking a green cell reads the
 * threshold off that line and compares it with the number in front of him by
 * eye. A threshold hidden in a decimal he cannot see would make the line look
 * like it disagreed with the colour. `slotThresholds` has computed the same two
 * numbers since the season sheet's first low marks; this is that arithmetic
 * lifted out so the all-teams grid can print its own bands the same way.
 */
function heatBand(scale) {
  if (!scale) return null;
  const edge = scale.edges[scale.edges.length - 1];
  return { lo: round1(scale.mean - edge * scale.sd), hi: round1(scale.mean + edge * scale.sd) };
}

/**
 * The "full colour at" line — one pair of points per column, the same shape as
 * the season sheet's `seasonBars`.
 *
 * It is the channel that makes a colour CHECKABLE rather than decorative, and
 * it is why a per-column table can honour "never colour alone" without printing
 * a sentence in every cell: the words are on the cell's card, the ▲/▼ is on the
 * ends, the weight moves with the step, and the arithmetic is here.
 *
 * IT DRAWS INSIDE "How this works" AND NOT UNDER THE TABLE, since 2026-09-19c.
 * A placement, not a deletion — Tim checks these numbers against ESPN by hand,
 * which is the whole reason they are printed. But three strips of pairs were
 * 109 of this page's 346 visible words when `node tests/text-audit.mjs` was run
 * against them, and HANDOFF's panel shape is a small visible key over the full
 * method behind the toggle. So the ids these write into live inside the
 * `<details class="explain">` in analysis.html, and the key line above each
 * table says what the colour compares and that the ends carry an arrow and
 * heavier type — the part a reader needs without asking.
 */
function renderHeatBands(id, cols, lead = 'Full colour at (red / green):') {
  const el = $(id);
  if (!el) return;
  const drawn = cols.filter(([, scale]) => scale);
  if (!drawn.length) { el.innerHTML = ''; return; }
  const body = cols.map(([key, scale]) => {
    const band = heatBand(scale);
    return band
      ? `<span class="lg"><strong>${esc(key)}</strong> ${fmt(band.lo)} / ${fmt(band.hi)}</span>`
      : `<span class="lg"><strong>${esc(key)}</strong> —</span>`;
  }).join('');
  el.innerHTML =
    `<span class="lg lg-lead" title="At or below the first number a cell in that column is fully ` +
    `red and marked ▼; at or above the second it is fully green and marked ▲. Both are one ` +
    `standard deviation from that column's own average across the league, and the shades between ` +
    `them are quarter-deviation steps. A column the whole league sits inside one printed tenth ` +
    `of shows a dash and is never coloured.">${esc(lead)}</span>${body}`;
}

/**
 * THE SHORT VISIBLE KEY FOR THE SCALE, and it is one chip on the legend line.
 *
 * What it has to say is only this: the colour is not the only cue. The two
 * swatches beside it already name the comparison group ("never compared across
 * columns", "what this slot gives around the league"), so what is missing is
 * the pair of hue-free channels — the ▲/▼ at the end of the scale and the
 * weight that moves with every step — and where the numbers went. Fourteen
 * words, against the ~36 a strip of thresholds costs.
 *
 * It says where the points are rather than assuming they will be found: a
 * reader who checks a cell by hand and cannot see the thresholds concludes they
 * were dropped, which is exactly the thing this change must not look like.
 */
const HEAT_CUES_KEY = 'ends carry an arrow and heavier type; the points are in the toggle below';

/**
 * The columns a scale was REFUSED on, named on screen.
 *
 * A refusal is not method, it is a fact about the table: nine coloured columns
 * beside one bare one is a reader's first question, and HANDOFF keeps anything
 * that changes what a number means in view. The thresholds went behind the
 * toggle on 2026-09-19c and this deliberately did not go with them — in there a
 * refusal is a dash nobody would see.
 *
 * `anyColour` is whether the table draws the scale ANYWHERE, and it is passed in
 * rather than inferred from `cols` because the two are not the same question:
 * the season sheet's Starting lineup band can be coloured while every slot row
 * above it is too thin to scale, which is the one case where naming the
 * uncoloured columns matters most.
 *
 * Empty, and so free, whenever every column is coloured — the usual case, and
 * the one the word counts are measured on.
 */
function heatRefusedHtml(cols, anyColour) {
  const refused = cols.filter(([, scale]) => !scale).map(([key]) => key);
  if (!anyColour || !refused.length) return '';
  return `${andList(refused.map((k) => `<strong>${esc(k)}</strong>`))} ` +
    `${refused.length === 1 ? 'is' : 'are'} not coloured — too few numbers, or the whole ` +
    `league inside one printed tenth`;
}

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

// --------------------------------------------------------------- the team grid
//
// One table, one row per team: the league's lineup spots, what they total, and
// then the bench behind them. It was two tables of exactly this shape until
// 2026-09-17, differing only in the number in every cell — a typical week in
// one, the selected week in the other — which is why merging them is a control,
// not a rewrite: one renderer, handed one of the two MEASURES below.
//
// NO NAMES in the cells. Ten teams across nine spots plus a bench is a wide
// table, and a name is the widest thing that could be in a cell while being the
// thing you least need to compare two teams. Every name is on hover, and the
// roster detail below names everybody.

// THE SPOTS ARE THE LEAGUE'S OWN (AUDIT §1.2, 2026-09-21). This used to be a
// hard-coded nine — QB, two RBs, two WRs, TE, FLEX, D/ST, K — and Tim's league
// starts ten (three receivers), so every `A week` Total was one whole receiver
// light and the Total's colour ranked ten squads on nine-man lineups, while the
// `Proj avg` measure beside it (on `leagueSlots()`) counted ten. Now both read
// the same slots: `gridSlots()` lays out `leagueSlots()` as the season sheet's
// rows, and this nine is only the shape used before any lineup has been read.
const GRID_SLOTS = [
  { key: 'QB', eligible: ['QB'], slotId: 0 },
  { key: 'RB1', eligible: ['RB'], slotId: 2 },
  { key: 'RB2', eligible: ['RB'], slotId: 2 },
  { key: 'WR1', eligible: ['WR'], slotId: 4 },
  { key: 'WR2', eligible: ['WR'], slotId: 4 },
  { key: 'TE', eligible: ['TE'], slotId: 6 },
  // Best of what is left, and RB/WR/TE only — a superflex QB is not a flex.
  { key: 'FLEX', eligible: ['RB', 'WR', 'TE'], slotId: 23 },
  { key: 'DEF', eligible: ['DST'], slotId: 16 },
  { key: 'K', eligible: ['K'], slotId: 17 },
];

/**
 * The week grid's spots: the league's starting slots, in lineup order.
 *
 * The rows are `slotRows(leagueSlots())` — the very rows the season sheet and
 * the `Proj avg` measure are drawn on — so WR3 exists here exactly when the
 * league starts one. Eligibility is ESPN's own (`SLOT_ELIGIBILITY`); a slot the
 * site has no rule for (P, HC) is left out, as `optimalLineup` leaves it out.
 * The D/ST column keeps the header this grid has always had, `DEF`.
 */
function gridSlots() {
  const slots = leagueSlots();
  const rows = (slots ? slotRows(slots) : [])
    .filter((r) => (espn.SLOT_ELIGIBILITY[r.slotId] || []).length > 0);
  if (!rows.length) return GRID_SLOTS;
  return rows.map((r) => ({
    key: r.base === 'D/ST' ? 'DEF' : r.key,
    eligible: espn.SLOT_ELIGIBILITY[r.slotId],
    slotId: r.slotId,
  }));
}

/** A count in words, for the sentences that say how many spots there are. */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const countWord = (n) => COUNT_WORDS[n] || String(n);

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
 * Fill the grid's spots for one team — the league's own, see `gridSlots`.
 *
 * Chosen by position and by the measure rather than by ESPN's lineupSlotId,
 * because the slot label only says where a manager parked someone. Two RBs in
 * a league with an RB/WR flex land in RB1/RB2 and the flex goes to whoever is
 * genuinely next best, which is the comparison the owner is actually making.
 *
 * The pool is who the manager has STARTING, not the whole roster: the bench
 * gets its own columns to the right, and a man cannot be in both.
 */
function gridLineup(team, measure = avgWeek, slots = gridSlots()) {
  const from = team.starters.length ? team.starters : team.players;
  const pool = from
    .map((p) => ({ p, v: measure(p) }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));

  const used = new Set();
  const row = {};
  for (const slot of slots) {
    // The pool is already best-first, so "the next eligible one" IS the best.
    const pick = pool.find((e) => !used.has(e) && slot.eligible.includes(e.p.position));
    if (pick) used.add(pick);
    row[slot.key] = pick || null;
  }
  return row;
}

/** The bench behind the starting spots, best first by the same measure. */
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

/**
 * One squad's whole starting lineup in an average week — the figure the
 * all-teams grid's Total carries on its Proj avg measure, and the one the
 * Season by week band shows. Null until a week of the season has been read.
 */
function teamWeeklyAverage(teamId) {
  const slots = leagueSlots();
  const rows = slots ? slotRows(slots) : [];
  if (!rows.length) return null;
  const got = teamSlotAverages(rows, slots, spanWeeks()).get(teamId);
  return got ? got.total : null;
}

/**
 * What the starting spots are worth between them in the week — ASSESSED, the
 * way the `Proj avg` measure and the season sheet's band total a week.
 *
 * THE TOTAL TAKES THE POSITIONAL FLOOR AND THE CELLS DO NOT (AUDIT §1.2,
 * decided on purpose). A cell is a man, and a man on bye is not a bad
 * quarterback, so his cell keeps ESPN's number. The Total is a claim about the
 * SQUAD's week — rule 13's ground — and a manager would stream the wire's third
 * man into a spot worth less than that, so each spot counts at no less than the
 * floor and an empty spot counts at it. It is `assessed`, the one function the
 * season sheet's band and the Proj avg Total use, so the two measures reconcile
 * week for week; with no wire read it is the plain sum, exactly as before.
 *
 * @returns {{total:number|null, lifted:number}} lifted = spots assessed at the floor
 */
function totalOf(row, slots = gridSlots()) {
  let sum = 0;
  let any = false;
  let lifted = 0;
  for (const s of slots) {
    const e = row[s.key];
    const a = assessed(e && typeof e.v === 'number' ? e : null, s);
    if (a.value === null) continue;
    sum += a.value;
    any = true;
    if (a.assumed) lifted += 1;
  }
  return { total: any ? round1(sum) : null, lifted };
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
function weekHead(w, weeks, cls, title, tag = '') {
  const start = w === firstPlayoffIn(weeks);
  const classes = [cls, start ? 'po-start' : ''].filter(Boolean).join(' ');
  // `tag` rides beside the number: the LIVE badge on a week still being played.
  const label = isPlayoff(w)
    ? `${w}${tag}${start ? '<span class="po-tag" aria-hidden="true">PO</span>' : ''}` +
      '<span class="sr-only"> (playoffs)</span>'
    : `${w}${tag}`;
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
    // The Proj row is the projection as it stood before kickoff: for a man who
    // has finished in a week still open, `pregame`, never his score twice.
    projections: weeks.map((w) => seasonField(index, w, p.playerId, 'pregame')),
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

// ------------------------------------------------- the glance line on the card
//
// Tim, 2026-10-02: ESPN's Avg, this week's Proj and position rank at the top of
// the card, "exactly what we see on the player's info on the espn fantasy app".
// Drawn by `glanceHtml` in js/player-card.js; this page only finds the numbers.
//
// "This week" is ESPN's current scoring period — the first week not yet final
// — never the week picker. The demo uses the sample's "now" (DEMO_CURRENT_WEEK).
// Avg and rank come off that week's payload (the freshest read), else the
// latest other week carrying them, else the row's own player object.

function glanceWeek() {
  if (state.isDemo) return demoNow;
  const played = new Set(state.playedWeeks);
  const now = state.weeks.find((w) => !played.has(w));
  return now !== undefined ? now : state.weeks[state.weeks.length - 1] ?? null;
}

let glanceMemo = { weeks: null, size: -1, now: null, here: null, any: null };

/** playerId -> his entry in the current week, and in the latest week that has the fields. */
function glanceIndex() {
  const now = glanceWeek();
  const m = glanceMemo;
  if (m.weeks === state.seasonWeeks && m.size === state.seasonWeeks.size && m.now === now) return m;
  const here = new Map();
  const any = new Map();
  const cur = now === null ? null : state.seasonWeeks.get(now);
  for (const t of cur || []) for (const p of t.players || []) here.set(p.playerId, p);
  for (const w of [...state.seasonWeeks.keys()].sort((a, b) => b - a)) {
    for (const t of state.seasonWeeks.get(w) || []) {
      for (const p of t.players || []) {
        const got = any.get(p.playerId) || { avg: null, rank: null };
        if (got.avg === null && typeof p.seasonAvg === 'number') got.avg = p.seasonAvg;
        if (got.rank === null && typeof p.posRank === 'number') got.rank = p.posRank;
        any.set(p.playerId, got);
      }
    }
  }
  glanceMemo = { weeks: state.seasonWeeks, size: state.seasonWeeks.size, now, here, any };
  return glanceMemo;
}

function glanceFor(p) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // Another league's weeks still in hand for one paint: see seasonIndexFor.
  const ix = state.seasonKey === sourceKey() ? glanceIndex() : null;
  const here = ix ? ix.here.get(p.playerId) : null;
  const any = ix ? ix.any.get(p.playerId) : null;
  return {
    avg: num(here?.seasonAvg) ?? num(any?.avg) ?? num(p.seasonAvg),
    proj: num(here?.projected),
    rank: num(here?.posRank) ?? num(any?.rank) ?? num(p.posRank),
    pos: p.position,
  };
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
 * WHAT A CELL OF THE `A WEEK` GRID CONTRIBUTES TO ITS COLUMN'S DISTRIBUTION.
 *
 * A number, or null for "this cell is a STATE rather than a projection". The
 * scale builder and the cell renderer both go through here, so the set of cells
 * that are MEASURED and the set that are TINTED are the same set by
 * construction rather than by two conditions that could drift apart.
 *
 * Four kinds are refused, and the reason is the same one every time: none of
 * them is a claim about how good this man is this week.
 *
 *   - ANY ZERO (`zeroOf` !== null). A bye, a man ESPN has ruled out, or a
 *     genuine 0.00. This is the decisive one and it is arithmetic, not taste: a
 *     column of ten quarterbacks with two byes in it is BIMODAL — a cluster at
 *     0 and a cluster around 18 — and a z-score over that is meaningless. One
 *     bye in ten values roughly doubles the standard deviation, which drags
 *     every real number back inside the middle band and switches the colour off
 *     exactly when the reader wanted it. Measuring only the men who are playing
 *     gives the column the question it is actually asked: of the nine squads
 *     fielding a quarterback this week, how good is this one.
 *   - A MAN LISTED OUT OR ON IR. His projection is not a forecast of a
 *     performance, and `st-out` / `st-ir` own the cell's BACKGROUND in
 *     analysis.html — the one channel the scale also owns — so a tint there
 *     would be erased by a rule of higher specificity using the `background`
 *     shorthand and the colour would be claimed but never drawn.
 *
 * On the season AVERAGE measure nothing is refused: `weekGrid` is false, no
 * zero there is a bye, and that grid draws its own cells through `avgCell`.
 */
function gridMeasure(entry, weekGrid) {
  if (!entry || typeof entry.v !== 'number') return null;
  const tier = injuryTier(entry.p.injuryStatus);
  if (tier === 'out' || tier === 'ir') return null;
  if (weekGrid && zeroOf(entry.v, state.week, entry.p) !== null) return null;
  return entry.v;
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
 *
 * `scale` is this COLUMN's scale (see the block above renderGrid) or null for a
 * column that has none — the bench, or a slot the league is inside one printed
 * tenth of. `what` is what the column is, in words, for the sentence the card
 * carries: "a QB in week 5, across the league".
 */
function gridCell(entry, { withPosition = false, weekGrid = false, index = null, tipKey = '', ranks = null, teamId = null, scale = null, what = '' } = {}) {
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

  // WHERE THIS NUMBER STANDS IN ITS OWN COLUMN — the shared scale, and the
  // fourth channel of "never colour alone" is the sentence it comes with.
  // `gridMeasure` decides both whether the cell is in the distribution and
  // whether it is tinted, so a Bye can never end up painted.
  const heat = heatOf(gridMeasure(entry, weekGrid), scale, { what });
  if (heat) cls.push(heat.cls);

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
  // THE WORDS THAT GO WITH THE COLOUR, and the one place on this grid they can
  // go. These cells carry NO `title` (see below), so the card IS the cell's
  // words — and the card is reachable with a finger, which is what HANDOFF's
  // hover rule demands. It goes on the card's own LEGEND line rather than into
  // the identity line, because the identity line is one bold line at the top of
  // the card and a sentence there would wrap it into a paragraph. A cell with
  // no season run gets no legend to hang it on, so there it joins the identity.
  const run = seasonRunData(index, p);
  if (heat && run) run.legend = [...(run.legend || []), `Colour: ${heat.words}`];
  const cardIdent = heat && !run ? `${ident} · ${heat.words}` : ident;
  const key = registerRun({ ident: cardIdent, run, href, id, glance: glanceFor(p) }, tipKey || 'g');

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
  // The ▲/▼ rides with the NUMBER, before the bench cell's position tag, so
  // "18.4 ▲ RB1" reads as one statement rather than leaving the glyph stranded
  // on the far side of a different fact.
  const inner = `${shown}${heatMarkHtml(heat)}${posTag}`;

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
    `${playerRef(p, inner, `${ident}.${heat ? ` ${heat.words}` : ''} Click to ${OPENS}.`, 'aria-label')}</td>`
  );
}

// -------------------------------------------------------------------- sources

// demo-rosters.js is written by a separate pass. Load it lazily so a missing or
// broken file degrades into a clear message instead of a blank page.
let demoGenerator;
// The sample season's "now", for the card's glance line (see glanceWeek).
let demoNow = 4;
async function getDemoGenerator() {
  if (demoGenerator !== undefined) return demoGenerator;
  try {
    const mod = await import('./demo-rosters.js');
    demoGenerator =
      typeof mod.generateDemoWeekRosters === 'function' ? mod.generateDemoWeekRosters : null;
    if (Number.isFinite(mod.DEMO_CURRENT_WEEK)) demoNow = mod.DEMO_CURRENT_WEEK;
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
  // And no floors either. The demo wire lives on the Players page, not in a
  // shared module, so there is nothing here to read a floor from — and an
  // invented floor is the one thing js/floor.js refuses to do. Demo therefore
  // shows ESPN-shaped numbers with no assumptions in them, which is what the
  // legend says.
  state.floors = null;
  state.floorWeek = null;
  state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  // The sample league's bracket weeks (14–16); demo-rosters.js projects them.
  state.poWeeks = leaguePlayoffWeeks({ weeks: state.weeks });
  state.playedWeeks = state.weeks.slice(); // the demo season is over by definition
  if (!state.weeks.includes(state.week)) state.week = DEMO_WEEKS;
  state.week = aimAtLanding(state.week);
  setToggle('demo');
  renderWeekPicker();
  await loadWeek();
}

/** Every failed route into live mode ends here, so none of them can lie. */
async function fallBackToDemo(message) {
  // A link was about the league that could not be read, not about the sample
  // one standing in for it.
  state.landing = null;
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
    // A week is played once EVERY game in it is. A matchup can be final before
    // ESPN closes the week (all its starters have finished), and one such game
    // must not make the page treat the whole week as over.
    const open = new Set(schedule.games.filter((g) => !g.played).map((g) => g.week));
    state.playedWeeks = [...new Set(schedule.games.filter((g) => g.played).map((g) => g.week))]
      .filter((w) => !open.has(w))
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

  // The floor below is read for the week the page would open on, link or no
  // link, so a number here is the same number whichever way the reader came.
  const opening = openingWeek();
  state.week = aimAtLanding(opening);

  // THE FLOOR READ. One request, for the week the page opens on, and its
  // result is used for every week — Tim's choice between that and a read per
  // week, which is exact but doubles the cost of this page. It rides alongside
  // the rosters rather than blocking them: a failure is an empty map, which
  // means "no floor known" and leaves every number as ESPN sent it, so the
  // panel can never fail to render because the wire was busy.
  // Guarded exactly as `loadByes` is: a stub, or any build of season.js
  // without it, must leave this page rendering rather than fail at boot. A
  // missing floor is the same thing as a refused wire read — no floors — and
  // every reader already treats that as "leave the numbers alone".
  state.floorWeek = opening;
  const floorRead = (typeof season.fetchFloors === 'function'
    ? season.fetchFloors(opening)
    : Promise.resolve(null))
    .then((f) => {
      if (state.source !== 'live') return;
      state.floors = f && f.size ? f : null;
      // The season panel may already be on screen by the time this lands, and
      // the floors change every number in it, so it repaints rather than
      // waiting for the next thing the reader touches.
      if (state.floors) {
        renderSeason();
        // The `A week` Total takes the floor too (AUDIT §1.2), and renderSeason
        // only repaints the grid on its Proj avg measure.
        if (!currentGrid().slotGrid) renderOverview();
      }
    })
    .catch(() => { state.floors = null; });

  renderWeekPicker();
  await loadWeek();
  await floorRead;
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

  // A link into the roster detail picks its team here, before anything paints.
  // True means it named nothing this league has and the week it had moved is
  // being put back — that load paints the page, so this pass must not.
  if (settleLanding()) return;

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

  // After everything, the season run included: whether the panel is still
  // being pushed down the page is read off that run.
  followLanding();
}

// ------------------------------------------------------- landing on a roster
//
// `analysis.html?team=<teamId>&week=<week>#rosterDetail` — the Stats page's
// graph sends a reader here from one dot (Tim, 2026-10-04: "bring them to the
// roster detail box in the analysis section with it automatically selected as
// the week it's referring to"). `team` is the ESPN team id, the same id every
// squad on this page is keyed by (rule 9).
//
//   - It is THIS VISIT'S ANSWER. Nothing here writes a pref: following a link
//     to a rival's week 2 is not a change of mind about which week or squad
//     the page should open on next time. Same rule as `?player=` on Players.
//   - Both or neither. A week this league does not have, or a team it does
//     not have, and the page is exactly what it would have been with no link.
//   - It belongs to whichever league is on screen, so it is aimed again when
//     the source changes on its own — the sample league is usually up first
//     and the real one replaces it a moment later.
//   - It ends the moment the reader puts a hand on the week, a team or the
//     source. After that the controls are theirs and nothing pulls them back.

/** `?team=&week=` from the URL. Defensive: a harness may provide no location. */
function requestedRoster() {
  try {
    const q = new URLSearchParams((window.location && window.location.search) || '');
    const team = q.get('team') || '';
    const week = q.get('week') || '';
    if (!/^\d+$/.test(team) || !/^\d+$/.test(week)) return null;
    return {
      team: Number(team),
      week: Number(week),
      on: null,        // the source it has been settled against, hit or miss
      hit: false,      // whether that source had both the week and the team
      back: null,      // the week the page would have opened on without it
      follow: false,   // still keeping the panel in view while the page grows
      touched: false,  // the reader has scrolled; the page is theirs to place
    };
  } catch {
    return null;   // no location at all is simply "no link"
  }
}

/**
 * The week to open on: the link's when this league has it, else `fallback`.
 * Called once the week list is known, on every arrival at a source.
 */
function aimAtLanding(fallback) {
  const l = state.landing;
  if (!l) return fallback;
  l.on = null;
  l.hit = false;
  l.follow = false;
  l.back = fallback;
  return state.weeks.includes(l.week) ? l.week : fallback;
}

/**
 * Pick the link's team, once per source, as soon as that week's squads are in.
 *
 * The rosters arrive after the first paint in both modes — live reads them a
 * week at a time, demo imports its generator — so "no teams yet" is a reason
 * to wait for the next repaint, never an answer.
 *
 * @returns {boolean} true when the link missed and its week is being put back
 */
function settleLanding() {
  const l = state.landing;
  if (!l || l.on === state.source) return false;
  const teams = state.data ? state.data.teams : [];
  if (!teams.length) return false;

  l.on = state.source;
  l.hit = state.week === l.week && teams.some((t) => t.id === l.team);
  if (l.hit) {
    chooseTeam(l.team, false);
    l.follow = !l.touched;
    return false;
  }
  // The week was moved for a team that turned out not to be here.
  if (state.week === l.week && l.back !== null && l.back !== l.week) {
    state.week = l.back;
    renderWeekPicker();
    loadWeek();
    return true;
  }
  return false;
}

/**
 * Keep the roster detail in view until the page above it has stopped growing.
 *
 * One scroll is not enough: the season grid above this panel arrives a few
 * weeks at a time and pushes it down the page each time. So this runs after
 * every repaint that can move it, and stops for good once that run is over —
 * or the moment the reader scrolls, because then where the page sits is theirs.
 */
function followLanding() {
  const l = state.landing;
  if (!l || !l.follow || !l.hit || l.on !== state.source) return;
  if (!currentTeam()) return;
  const panel = $('rosterDetail');
  if (!panel) return;
  if (state.seasonPending === null) l.follow = false;
  // Guarded: jsdom/linkedom have no scrollIntoView, and a harness must not die
  // of a missing browser API.
  try {
    panel.scrollIntoView({ block: 'start' });
  } catch { /* the team and week are selected either way */ }
}

/** The reader has taken a control in hand: the link has done its work. */
function endLanding() {
  const l = state.landing;
  if (!l) return;
  // The week it opened on is the week they are now working in — picked this
  // visit, by following the link — so a later change of source keeps it.
  if (l.hit && l.on === state.source) state.weekPicked = true;
  state.landing = null;
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
 * THE TWO MEASURES, and everything that differs between them.
 *
 * These were two whole panels stacked down the page until 2026-09-17. They were
 * never two tables: same rows, same nine spots, same bench, one renderer, and a
 * single field — `measure` — deciding what number went in a cell. So the merge
 * keeps each one's rules exactly as they were and simply lets the reader pick
 * which is on screen.
 *
 * `weekGrid` is the one rule that must not drift: ONLY a week's number can be a
 * bye (or a ruled-out zero). A season average of 0.00 is a man ESPN projects
 * nothing for all year, which is a different fact and is printed as a number.
 */
const MEASURES = {
  week: {
    key: 'week',
    measure: weekProj,
    button: () => 'A week',
    heading: () => `All teams · week ${state.week}`,
    weekGrid: true,
  },
  // THE AVERAGE IS NO LONGER A PLAYER MEASURE AT ALL (Tim, 2026-09-19). It was
  // `avgWeek` — each man's own season projection over 17 games — and he asked
  // for the season sheet's Avg column instead: what each lineup SLOT is worth
  // per week once you allow that whoever fills it changes from week to week.
  // So this measure has no per-player function, and `renderAvgGrid` draws it
  // from `teamSlotAverages` rather than from `gridLineup`. `measure` is kept
  // null rather than removed so anything reaching for it fails loudly instead
  // of quietly getting a number about the wrong question.
  avg: {
    key: 'avg',
    measure: null,
    slotGrid: true,
    button: () => `Proj avg ${espn.getConfig().season}`,
    heading: () => `All teams · proj avg ${espn.getConfig().season}`,
    weekGrid: false,
  },
};

/** The grid as it is to be drawn right now: the one table, and the measure on it. */
function currentGrid() {
  return { id: 'overview', ...(MEASURES[state.measure] || MEASURES.week) };
}

/** The bench is as deep as the deepest bench, so every row has the same shape. */
function benchWidth(teams) {
  return teams.reduce((n, t) => Math.max(n, (t.bench || []).length), 0);
}

function renderGridHead(table, benchCols, slots = gridSlots()) {
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
       ${slots.map((s) => `<th data-sort>${esc(s.key)}</th>`).join('')}
       <th class="grid-total grouped" data-sort title="The ${countWord(slots.length)} spots to the ` +
         `left added up, each counted at no less than the waiver floor for that spot — the same ` +
         `basis as the Proj avg Total.">Total</th>
       ${bench}
     </tr>`;
}

// ------------------------------------- the grid on its Proj avg measure
//
// One row per squad, one column per LINEUP SLOT, and every cell the season
// sheet's own Avg for that slot — Tim's 2026-09-19 ask, in his words: "it
// doesn't use a single player's proj avg across a season, it uses the avg proj
// points for each position that was calculated and predicted in the box below".
//
// FOUR THINGS ABOUT IT ARE DELIBERATE AND ARE THE PRICE OF THAT:
//
// - THE COLUMNS ARE THE LEAGUE'S OWN SLOTS — and since AUDIT §1.2 the week
//   measure's are too (`gridSlots`). His league starts ten (three receivers), so a nine would
//   have dropped a starter out of every total and could not have agreed with
//   the box below — which is the entire point of the change.
// - A CELL NAMES NOBODY AND LINKS NOWHERE. An average over fourteen weeks is
//   usually several men; a link would have to pick one of them, and picking the
//   first is how a grid quietly starts telling you about the wrong player. Who
//   actually filled it, and how often, is in the cell's `title` — which
//   js/touch-titles.js makes a tap on a phone, so nothing here is hover-only.
// - THERE IS NO BENCH. The bench columns are "best first by the column this
//   table is measured in", and a slot average has no bench: the man covering
//   RB1's bye IS the RB1 average that week. Keeping them would have put a
//   different kind of number in the same row.
// - IT NEEDS THE WHOLE SEASON, so it fills in as the weeks land rather than
//   arriving complete. Until a week is read its cells are the faint dot the
//   season sheet uses, never a zero, and the note says how many weeks are in.
function renderAvgGrid(grid) {
  const table = $(`${grid.id}Table`);
  const teams = state.data ? state.data.teams : [];
  const slots = leagueSlots();
  const rows = slots ? slotRows(slots) : [];
  const weeks = spanWeeks();
  const show = teams.length > 0 && rows.length > 0 && weeks.length > 0;

  $(`${grid.id}Title`).textContent = grid.heading();
  $(`${grid.id}Wrap`).classList.toggle('hidden', !show);
  $(`${grid.id}Empty`).classList.toggle('hidden', show);

  if (!show) {
    $(`${grid.id}Empty`).textContent = teams.length === 0
      ? 'No roster data for this week.'
      : 'The league’s lineup shape is not known yet, so there are no slots to average.';
    $(`${grid.id}Legend`).innerHTML = '';
    renderHeatBands(`${grid.id}Bars`, []);
    bodyOf(table).innerHTML = '';
    return;
  }

  table.querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort>Team</th>
       ${rows.map((r) => `<th data-sort title="What this squad's ${esc(r.key)} is worth in an ` +
         `average week: that slot's projection in every regular-season week read, averaged. ` +
         `Whoever fills it — it is a slot, not a man.">${esc(r.key)}</th>`).join('')}
       <th class="grid-total grouped" data-sort title="What this squad's whole starting lineup ` +
         `projects in an average week. It is the week-by-week lineup total averaged` +
         (historyWeeks(weeks).size ? '' : `, which is the ` +
         `same number the Season by week panel's ‘Starting lineup’ band shows`) + ` — so rounding can ` +
         `leave it a tenth off adding the columns.">Total</th>
     </tr>`;

  const byTeam = teamSlotAverages(rows, slots, weeks);

  // ------------------------------------------- the red/green scale, per COLUMN
  //
  // THIS IS THE TABLE TIM WAS LOOKING AT when he asked for the scale, and his
  // words are the specification: "in this All teams, proj avg 2026 chart,
  // positions with higher proj than the others will be green and lower will be
  // red." So a column is a comparison group and the table is not: a squad's WR2
  // average against the other nine squads' WR2 averages, never against its own
  // QB column. Ten values per scale, which is thin but real — and `heatScale`
  // refuses outright below two, so a league with one squad reading colours
  // nothing rather than colouring everything.
  //
  // NOT THE SAME DISTRIBUTION AS THE SEASON SHEET'S, and deliberately so. The
  // sheet compares one WEEK against every squad's every week (~160 values,
  // wide); this compares one SEASON AVERAGE against nine others (10 values,
  // much tighter, because averaging has already taken the week-to-week noise
  // out). Using the sheet's spread here would colour almost nothing, since
  // every squad's season average sits well inside a single weekly standard
  // deviation. Each table is measured on its own numbers.
  //
  // ON ESPN'S OWN VALUES OR ON THE ASSESSED ONES? On the ASSESSED ones — the
  // numbers actually drawn in the cells — which is the opposite of the choice
  // the season sheet's thresholds make, and the difference is worth stating.
  // There, the spread describes what a slot is WORTH around the league and
  // lifting the low end to the wire first would narrow it with a number that is
  // nobody's actual projection. Here there is no separate population: the ten
  // cells in the column ARE the distribution, so measuring anything other than
  // what is drawn would colour a cell against a number the reader cannot see.
  //
  // SHARED WITH "SEASON BY WEEK" SINCE 2026-09-19b, which is why it is a
  // function rather than two blocks: that panel's Avg column is this table's
  // cell for one squad, so the two would have had to agree by coincidence.
  const { cols: colScale, total: totalScale } = slotAvgScales(rows, weeks);

  bodyOf(table).innerHTML = teams
    .map((t) => {
      const got = byTeam.get(t.id);
      const cls = [
        t.id === state.teamId ? 'picked' : '',
        !state.isDemo && t.id === state.myTeamId ? 'me' : '',
      ].filter(Boolean).join(' ');
      const cells = rows
        .map((r) => avgCell(got ? got.slots.get(r.key) : null, r, t, colScale.get(r.key)))
        .join('');
      const total = got ? got.total : null;
      const th = heatOf(total, totalScale, { what: 'the other squads’ lineups' });
      return `
      <tr class="${cls}" data-team="${t.id}">
        <td class="name">${esc(t.name)}</td>
        ${cells}
        <td class="grid-total grouped${th ? ` ${th.cls}` : ''}"` +
        `${total === null ? '' : ` data-v="${total}"`} ` +
        `title="${esc(totalAvgLabel(t, got) + (th ? ` ${th.words}` : ''))}">` +
        `<strong>${fmt(total)}</strong>${heatMarkHtml(th)}</td>
      </tr>`;
    })
    .join('');

  sortShape(table, `avg:${rows.length}`, rows.length + 1);

  const body = bodyOf(table);
  // Named once: the key says which columns took no scale, the strip inside the
  // toggle prints the ones that did.
  const bandCols = [...rows.map((r) => [r.key, colScale.get(r.key)]), ['Total', totalScale]];
  const refused = heatRefusedHtml(bandCols, !!table.querySelector('td.heat'));
  renderKey(`${grid.id}Legend`, [
    // THE SCALE FIRST, because it is now the loudest thing on the table and a
    // colour with no key is the one thing this site never ships. Two swatches,
    // the two ends; the shades between them are the steps.
    body.querySelector('td.heat-up-4') &&
      ['<span class="lg-mark heat heat-up-4">14.8 <span class="heatmark">▲</span></span>',
        'best in that COLUMN — never compared across columns'],
    body.querySelector('td.heat-dn-4') &&
      ['<span class="lg-mark heat heat-dn-4">9.2 <span class="heatmark">▼</span></span>',
        'worst in it; paler shades are the steps between'],
    // The hue-free cues and where the thresholds are; see HEAT_CUES_KEY.
    body.querySelector('td.heat') && ['', HEAT_CUES_KEY],
    refused && ['', refused],
    body.querySelector('td.assumed') &&
      ['<span class="lg-mark assumed">7.8</span>',
        'some of those weeks are assessed at the waiver floor'],
    body.querySelector('td.wait') && ['<span class="lg-mark faint">·</span>', 'weeks still loading'],
    body.querySelector('td.slot-avg.muted') &&
      ['<span class="lg-mark faint">—</span>', 'no week read for this slot yet'],
  ], 'Tap or hover a number for who fills that slot · tap a row to load that team');

  // The thresholds in points, inside the toggle beside the prose that argues
  // them — the same place the season sheet keeps its two strips. It was missing
  // here altogether while this table was the only coloured one on the page,
  // which left its colours the one thing on the site a reader could not check
  // by hand; moving it into "How this grid works" keeps that channel open.
  renderHeatBands(`${grid.id}Bars`, bandCols);
}

/**
 * THE PER-SLOT SCALES FOR A SEASON AVERAGE, and the one place they are built.
 *
 * Two panels draw the same numbers: the all-teams grid on its Proj avg measure
 * draws all ten squads, and "Season by week" draws one squad's column of them
 * as its Avg. They must therefore be on ONE scale, and the only way to be sure
 * of that is for there to be one function — HANDOFF's "a floor that reaches one
 * panel and not its neighbour is worse than no floor", applied to a colour.
 *
 * THE GROUP IS THE COLUMN: a squad's WR2 average against the other nine squads'
 * WR2 averages, never against its own QB column.
 *
 * @returns {{byTeam:Map, cols:Map<string,Object|null>, total:Object|null}}
 */
function slotAvgScales(rows, weeks) {
  const teams = state.data ? state.data.teams : [];
  const byTeam = teamSlotAverages(rows, leagueSlots(), weeks);
  const cols = new Map(rows.map((r) => [r.key, heatScale(
    teams.map((t) => {
      const got = byTeam.get(t.id);
      const cell = got ? got.slots.get(r.key) : null;
      return cell ? cell.avg : null;
    })
  )]));
  // The Total column is a comparison group of exactly the same kind — ten whole
  // starting lineups in an average week — so it takes the scale too. Leaving it
  // plain in a coloured table would read as "this one could not be measured".
  const total = heatScale(teams.map((t) => {
    const got = byTeam.get(t.id);
    return got ? got.total : null;
  }));
  return { byTeam, cols, total };
}

/** One squad's average at one slot. A number about a SLOT, so it names nobody. */
function avgCell(cell, row, team, scale) {
  const base = 'slot-avg';
  if (!cell || cell.avg === null) {
    // Nothing read yet is not the same as nothing there, and the two must not
    // share a mark: one resolves itself in a few seconds, the other never does.
    return state.seasonWeeks.size === 0
      ? `<td class="${base} wait" title="No week has been read from ESPN yet, so there is nothing ` +
        `to average. The Season by week panel below reports the progress.">·</td>`
      : `<td class="${base} muted" title="No week read so far gives ${esc(team.name)} an ` +
        `${esc(row.key)} at all.">—</td>`;
  }

  const who = cell.who.slice(0, 3)
    .map((p) => `${p.name} (${p.n})`)
    .join(', ');
  const more = cell.who.length > 3 ? `, and ${cell.who.length - 3} more` : '';
  const says =
    `${team.name}'s ${row.key} is worth ${fmt(cell.avg)} in an average week — that slot's ` +
    `projection over ${plural(cell.n, 'regular-season week')} read, whoever fills it` +
    (who ? `: ${who}${more}.` : '.') +
    (cell.assumed
      ? ` ${cell.assumed} of those ${cell.assumed === 1 ? 'is' : 'are'} assessed at the waiver ` +
        `floor rather than ESPN's own number.`
      : '');

  // The scale, and the sentence that goes with it. Both claims can be on one
  // cell — green because it is a good slot, orange because some of the weeks in
  // it are the site's assumption rather than ESPN's number — and they survive
  // together because the scale owns the background and `assumed` owns the text.
  const h = heatOf(cell.avg, scale, { what: `the other squads’ ${row.key}` });

  return `<td class="${base}${cell.assumed ? ' assumed' : ''}${h ? ` ${h.cls}` : ''}" ` +
    `data-v="${cell.avg}" title="${esc(says + (h ? ` ${h.words}` : ''))}">` +
    `${fmt(cell.avg)}${heatMarkHtml(h)}</td>`;
}

/** The Total cell's sentence — it is the one number that ties the two panels together. */
function totalAvgLabel(team, got) {
  if (!got || got.total === null) {
    return `No week has been read yet, so ${team.name}'s lineup has nothing to average.`;
  }
  return `${team.name}'s best legal lineup projects ${fmt(got.total)} in an average week, over ` +
    `${plural(got.weeks, 'regular-season week')} read.` +
    (historyWeeks().size ? '' : ` It is the same figure the Season by week ` +
    `panel's Starting lineup band shows for this squad.`);
}

/**
 * Point the sort at this shape's Total column when the shape CHANGES.
 *
 * The two measures have different column counts, so the index stored when the
 * page loaded belongs to whichever was on screen then. Without this, switching
 * to the average would sort the league by whatever column happened to sit at
 * index 10 — a real ordering, quietly about the wrong thing. A re-render that
 * keeps the shape falls through to `resort`, which is what preserves a column
 * the reader picked for themselves.
 */
let gridShape = null;
function sortShape(table, shape, totalIndex) {
  if (gridShape === shape) { resort(table); return; }
  gridShape = shape;
  sortBy(table, totalIndex, false);
}

// THE `A WEEK` MEASURE TAKES THE RED/GREEN SCALE — and it did not until
// 2026-09-19b, so this comment is the record of both decisions rather than a
// description of the code. It was argued at length here that the scale must
// stay OFF this grid, that was put to Tim as an open question, and he answered
// it: "the coloring is good right now but it needs to be added to all the other
// places a number is referred to across the whole site." So: on.
//
// WHAT THE ORIGINAL ARGUMENT WAS, because half of it was right and survives in
// the code. These cells already spend colour on FOUR established meanings —
// `bye` (amber "Bye"), `zero-out` (a ruled-out man's real 0.0), `st-out` and
// `st-ir` (an injury) — and every one of them answers "why is this number what
// it is", which is a different question from "is this number good". That is the
// exception Tim named himself: "unless it conflicts with something else we
// already have built". The claim was that a spectrum underneath four state
// colours would bury the states, and the states are half of what this grid is
// for — he reads it to find who is on bye and who is hurt this week.
//
// WHY IT TURNS OUT NOT TO CONFLICT, which is the whole of the new decision.
// The conflict is real only if the scale is allowed onto the state cells, and
// there is an independent reason it must not be: THE ARITHMETIC REFUSES THEM
// FIRST. A column of ten quarterbacks with two byes in it is bimodal — a
// cluster at 0.0 and a cluster around 18 — and a z-score over that says
// nothing; one bye in ten values roughly doubles the standard deviation, which
// pulls every real number back inside the middle band and switches the colour
// off exactly where it was wanted. So `gridMeasure` drops every zero and every
// ruled-out man from the distribution, and because the renderer asks the SAME
// function whether to tint, a Bye cell cannot be painted. The four state
// meanings keep their cells untouched and the scale describes the men who are
// actually playing. Both claims survive because they were never put on the same
// cell.
//
// AND `st-out` / `st-ir` OWN A BACKGROUND, not a foreground. This is the one
// place on the site where HANDOFF rule 14's "every existing meaning owns the
// FOREGROUND" is not true: `table.grid tbody tr td.st-out` in analysis.html
// sets a `background` shorthand at higher specificity than `.heat-up-3`, so a
// tint on an injured man's cell would be silently erased — the page would be
// making a claim it never drew. Refusing those cells is therefore the only
// honest option, not merely the tidy one.
//
// THE COMPARISON GROUP IS THE COLUMN, exactly as on `Proj avg`: `heatScale`
// down the ten teams for one GRID_SLOT at a time, plus one for Total. What must
// never happen is one scale across the ROW, which would paint every kicker red
// for being a kicker.
//
// AND "SEASON BY WEEK" DOES THE OPPOSITE WITH A BYE — deliberately, and the
// difference is worth stating because somebody will notice the two panels
// disagreeing about one cell. There, a row is a SLOT and a bye that reaches it
// really does mean the slot is worth nothing that week (nobody on the roster
// projected higher), which is a true and useful thing to paint red — and the
// waiver floor usually lifts it before it gets there. Here a cell is a MAN, and
// a man on bye is not a bad quarterback, he is a quarterback who is not
// playing. Same colour, two different claims, and the claim follows what the
// row is about.
//
// THE BENCH COLUMNS GET NOTHING, and that is not an omission either. B1 is "the
// best man on this bench" — a running back on one squad, a quarterback on the
// next — so a scale down the B1 column would be comparing positions, which is
// the one thing rule 14 forbids. The bench cells still carry their position tag
// and their rank, which is the honest answer to "how good is this bench man".
//
// The other half of the old argument — that a week's distribution is wider than
// a season average's, so fewer cells colour and the hues move when the week
// picker does — is true and is now a feature rather than an objection. That
// churn is the question: `Proj avg` answers "who is strong at this slot" over
// the season and this answers "who is strong at it THIS WEEK", and a manager
// setting a lineup is asking the second one.
function renderGrid(grid) {
  if (grid.slotGrid) return renderAvgGrid(grid);

  const table = $(`${grid.id}Table`);
  const teams = state.data ? state.data.teams : [];
  const benchCols = benchWidth(teams);

  $(`${grid.id}Title`).textContent = grid.heading();
  $(`${grid.id}Wrap`).classList.toggle('hidden', teams.length === 0);
  $(`${grid.id}Empty`).classList.toggle('hidden', teams.length > 0);
  // Put back, because the average grid writes its own reason in here and the
  // two measures share the element.
  $(`${grid.id}Empty`).textContent = 'No roster data for this week.';

  // The league's own starting spots, read once for the head, the cells, the
  // scales and the Total, so the four cannot disagree about how many there are.
  const slots = gridSlots();
  renderGridHead(table, benchCols, slots);

  const opts = {
    weekGrid: !!grid.weekGrid,
    tipKey: grid.id,
  };

  // ------------------------------------------- the red/green scale, per COLUMN
  //
  // One pass over the league to build the rows, so every scale below is over
  // the same starting men per squad the cells are drawn from. See the long
  // block above this function for why a column is the group and why a bench
  // column and a state cell are both left out.
  const lineups = new Map(teams.map((t) => [t.id, gridLineup(t, grid.measure, slots)]));
  const colScale = new Map(slots.map((s) => [s.key, heatScale(
    teams.map((t) => gridMeasure(lineups.get(t.id)[s.key], opts.weekGrid))
  )]));
  // The Total is a comparison group of exactly the same kind — ten whole
  // starting lineups in one week — so it takes the scale too. It is measured on
  // the Total as DRAWN: the squad's week, assessed at the positional floor (see
  // `totalOf`). A bye is a fact about a player in the columns above and a fact
  // about the squad's week down here, and down here the squad would stream the
  // wire's man into it — so the spot counts at the floor, not at zero.
  const assessedTotals = new Map(teams.map((t) => [t.id, totalOf(lineups.get(t.id), slots)]));
  const totals = new Map([...assessedTotals].map(([id, a]) => [id, a.total]));
  const totalScale = heatScale(teams.map((t) => totals.get(t.id)));

  bodyOf(table).innerHTML = teams
    .map((t) => {
      const row = lineups.get(t.id);
      const total = totals.get(t.id);
      const lifted = assessedTotals.get(t.id).lifted;
      const bench = benchEntries(t, grid.measure);
      const th = heatOf(total, totalScale, { what: 'the other squads’ lineups this week' });
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
      // THE TOTAL'S WORDS GO IN A `title`, and that is allowed here where it is
      // not on the cells beside it: this cell holds no link and no card, so
      // there is nothing for the browser's own tooltip to draw on top of, and
      // js/touch-titles.js makes it a tap on a phone.
      const totalSays = total === null
        ? `No projection for ${t.name} this week.`
        : `${t.name}'s ${countWord(slots.length)} starters project ${fmt(total)} in week ${state.week}` +
          (lifted
            ? `, with ${countWord(lifted)} spot${lifted === 1 ? '' : 's'} counted at the waiver floor.`
            : '.');
      return `
      <tr class="${cls}" data-team="${t.id}">
        <td class="name">${esc(t.name)}</td>
        ${slots.map((s) => gridCell(row[s.key], {
          ...cellOpts,
          scale: colScale.get(s.key),
          what: `a ${s.key} in week ${state.week}, across the league`,
        })).join('')}
        <td class="grid-total grouped${th ? ` ${th.cls}` : ''}" data-v="${total ?? ''}" ` +
        `title="${esc(totalSays + (th ? ` ${th.words}` : ''))}">` +
        `<strong>${fmt(total)}</strong>${heatMarkHtml(th)}</td>
        ${benchCells}
      </tr>`;
    })
    .join('');

  // Keeps whatever sort the reader picked across week changes; retargets Total
  // only when the shape changed under it, which means a measure switch.
  sortShape(table, `week:${slots.length}`, slots.length + 1);

  // The key names only the marks this grid is actually showing.
  const body = bodyOf(table);
  const dash = [...body.querySelectorAll('td.slot-cell')]
    .some((td) => td.textContent.trim().startsWith('—'));
  // The column list the thresholds are built from, named once: the key needs it
  // to say which columns took no scale, and the strip in the toggle to print
  // the ones that did.
  const bandCols = [...slots.map((s) => [s.key, colScale.get(s.key)]), ['Total', totalScale]];
  const refused = heatRefusedHtml(bandCols, !!table.querySelector('td.heat'));
  renderKey(`${grid.id}Legend`, teams.length ? [
    // THE SCALE FIRST, the same two swatches and the same order the average
    // measure uses, so switching the button does not move the key about.
    body.querySelector('td.heat-up-4') &&
      ['<span class="lg-mark heat heat-up-4">22.4 <span class="heatmark">▲</span></span>',
        'best in that COLUMN this week — never compared across columns'],
    body.querySelector('td.heat-dn-4') &&
      ['<span class="lg-mark heat heat-dn-4">11.2 <span class="heatmark">▼</span></span>',
        'worst in it; paler shades are the steps between'],
    // The scale's hue-free cues, and where its thresholds live. See
    // HEAT_CUES_KEY: the strip of points is in the toggle below, and this is
    // what a reader needs in view to know the colour is not the only cue.
    body.querySelector('td.heat') && ['', HEAT_CUES_KEY],
    // Nothing here when every column took a scale, which is the usual case.
    refused && ['', refused],
    body.querySelector('td.st-out') && ['<span class="key out">Out</span>', 'this week'],
    body.querySelector('td.st-ir') && ['<span class="key ir">IR</span>', 'injured reserve'],
    body.querySelector('td.bye') && ['<span class="lg-mark bye">Bye</span>', 'no game that week'],
    body.querySelector('td.zero-out') &&
      ['<span class="lg-mark zero-out">0.0 <span class="zmark">OUT</span></span>', 'ruled out, not a bye'],
    dash && ['<span class="lg-mark faint">—</span>', 'empty spot or no number'],
  ] : [], teams.length ? 'Tap or hover a number for the player · tap a row to load that team' : '');

  // The thresholds, in points, inside "How this grid works" — the channel that
  // makes a colour checkable by hand. Total last, because that is where it sits
  // in the table.
  renderHeatBands(`${grid.id}Bars`, teams.length ? bandCols : []);
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
  const grid = currentGrid();
  // Cleared for THIS grid, not wholesale: the rows are about to be replaced, so
  // every key registered against the old ones is dead — but the season panel
  // below registers cards of its own and is not being repainted here, and
  // clearing the lot from in here left its `data-tip`s pointing at nothing.
  clearRuns(grid.id);
  renderMeasureToggle(grid);
  renderGrid(grid);
  renderOverviewNote(grid);
  // NOT hideTip() before the repaint any more. This runs once per batch while
  // the season loads, and closing the card each time made one opened in the
  // first seconds vanish under the reader. The card finds its man again among
  // the new cells and redraws from the newer data — or closes if he is gone.
  reopenTip();
}

/**
 * The measure control, and the one line that says what it does.
 *
 * Which button is lit is decided by the code rather than by the last click, the
 * same rule the source and position toggles follow — the reader can arrive with
 * a remembered measure, and a control that only moved when clicked would then
 * be showing the wrong one.
 *
 * The explanation is a `.ctl-hint` on the page, never a `title`: a `title` on a
 * button is invisible on iOS and js/touch-titles.js deliberately leaves controls
 * alone, because a tap on a control has to work the control.
 */
function renderMeasureToggle(grid) {
  const toggle = $('measureToggle');
  if (toggle) {
    for (const b of toggle.querySelectorAll('button[data-measure]')) {
      const m = MEASURES[b.dataset.measure];
      if (m) b.textContent = m.button();
      b.classList.toggle('on', b.dataset.measure === grid.key);
    }
  }
  // The lede says what the rows are, and that differs by measure: `A week` is
  // the lineup AS SET (`gridLineup` pools `team.starters`), Proj avg the best.
  const lede = $('overviewLede');
  if (lede) {
    lede.textContent = grid.key === 'avg'
      ? 'Every squad’s best lineup and bench, side by side.'
      : 'Every squad’s set lineup and bench.';
  }
  const hint = $('measureHint');
  if (hint) {
    // Once a week is history the sheet's Avg holds real scores and this does not.
    hint.textContent = grid.key === 'avg'
      ? `One column per lineup slot, averaged over the season week by week — ` +
        (historyWeeks().size ? `every week at its projection.` : `the Avg column of Season by week, for every squad.`) +
        ` The week still sets the rest of the page.`
      : `Scored on ESPN’s projection for week ${state.week}, which is also the week the panels below show.`;
  }
}

/**
 * The method behind the grid, written for whichever measure is on screen.
 *
 * It is one note now rather than two panels' worth, and the paragraph that
 * changes is the FIRST one — what a number in a cell actually is. The bye
 * paragraph only appears on the week measure, because only a week can have one.
 */
function renderOverviewNote(grid) {
  const el = $('overviewNote');
  if (!el) return;
  const season = espn.getConfig().season;
  const parts = [];

  // THE AVERAGE HAS ITS OWN NOTE FROM TOP TO BOTTOM since 2026-09-19. It is not
  // the same table measured differently any more — its columns are slots rather
  // than men, it has no bench and no player links — so sharing the paragraphs
  // below would have it describing a table that is not on the screen.
  if (grid.slotGrid) {
    const weeks = spanWeeks();
    const read = [...state.seasonWeeks.keys()].filter((w) => !isPlayoff(w)).length;
    const regular = weeks.filter((w) => !isPlayoff(w)).length;

    parts.push(
      `Every number is a <strong>lineup slot averaged over the season</strong>, not a player: the ` +
      `QB column is what that squad’s quarterback spot is worth in an average week, filled each ` +
      `week by whoever actually starts there. ` +
      (historyWeeks(weeks).size
        ? `<strong>Every week counts at its projection, played ones too</strong>, so this is not ` +
          `the Avg column of Season by week below, which averages the scores shown there.`
        : `<strong>This is the Avg column of Season by week ` +
          `below, computed for all ten squads</strong> — the same weeks, the same slots, the same ` +
          `waiver floor — so a row here and that panel cannot disagree.`)
    );

    parts.push(
      `It replaced a per-player average (each man’s full-season ${season} projection over ` +
      `${SEASON_GAMES} games) because that could not see the things that decide a season: a bye ` +
      `week, a squad with two useful backs who never both start, or a slot with nobody in it. ` +
      `<strong>${read} of ${regular} regular-season week${regular === 1 ? '' : 's'}</strong> ` +
      `${read === 1 ? 'is' : 'are'} in these averages so far${read < regular
        ? ' — the rest fill in as they arrive.' : '.'} Playoff weeks are never counted.`
    );

    parts.push(
      `<strong>Total</strong> is the whole starting lineup in an average week — each week’s lineup ` +
      `added up, then those totals averaged` +
      (historyWeeks(weeks).size ? '' : `, which is exactly the “Starting lineup” band in the panel below`) +
      `. Rounding can leave it a tenth away from adding the columns across.`
    );

    // THE SCALE (Tim, 2026-09-19). This is the table he was looking at when he
    // asked for it, so the note quotes the rule that makes it honest rather
    // than just describing the colours.
    parts.push(
      `<strong>Green is a better number than the other squads have and red is a worse one</strong>, ` +
      `deepening in four steps and reaching full colour one standard deviation out. ` +
      describeHeatPerColumn({ group: 'column', what: 'the other nine squads' })
    );

    parts.push(
      `A cell in <span class="lg-mark assumed">orange with a dotted underline</span> has at least one ` +
      `week in it that ESPN did not publish: the slot was empty, or the man in it projected below ` +
      `what the waiver wire would give you there, so it is assessed at the wire instead. ` +
      `<strong>Tap or hover any number</strong> for who filled that slot and how often, and for ` +
      `how many of its weeks were assumed.`
    );

    parts.push(
      `<strong>No cell here is a link</strong>, and that is deliberate: an average over a season is ` +
      `usually several men, so there is no one player to point at. The names are in Season by week ` +
      `and in the roster detail below. Click a row to load that squad into both, and click any ` +
      `header to sort. <strong>The week picked above still drives the rest of the page</strong>; ` +
      `it does not change these averages, which are the whole season either way.`
    );

    el.innerHTML = parts.map((t) => `<p>${t}</p>`).join('');
    return;
  }

  parts.push(
    `Every number is <strong>ESPN’s own projection for week ${state.week}</strong>, the week ` +
    `picked above. Switch to <strong>Proj avg ${season}</strong> for the same squads measured on ` +
    `what each lineup SLOT is worth in an average week, and read the two against each other to see ` +
    `who is better this week than they usually are.`
  );

  // THE COUNT IS THE LEAGUE'S, from the lineups ESPN accepted (AUDIT §1.2) —
  // never a hard-coded "nine", which undercounted Tim's three-receiver league.
  const spots = countWord(gridSlots().length);
  parts.push(
    `The ${spots} columns are the league’s own starting spots, filled from the men that squad ` +
    `has starting, ranked by the measure above rather than by where the manager has parked ` +
    `them. <strong>FLEX</strong> is the best remaining RB, WR or TE, never a QB.`
  );

  // THE TOTAL'S FLOOR, stated because it is the one number on this measure that
  // is not ESPN's (rule 7). Decided on purpose: a cell is a man and stays
  // unfloored; the Total is the squad's week and takes the floor (rule 13).
  parts.push(
    `<strong>Total</strong> is those ${spots} added up, on the same basis as the ` +
    `<strong>Proj avg ${season}</strong> Total and the Starting lineup band in Season by week: a spot ` +
    `whose man projects below the waiver floor for it — on bye, ruled out, or simply weak — counts ` +
    `at the floor instead, because that is what the squad could stream in. A man’s own cell never ` +
    `moves; the floor is a claim about the squad’s week, not about him. ` +
    (state.floors
      ? `Tap or hover a Total to see how many of its spots were counted at the floor.`
      : state.isDemo
        ? `The demo has no waiver wire, so here every spot counts at its own number.`
        : `No waiver-wire read is in yet, so every spot counts at ESPN’s own number for now.`)
  );

  parts.push(
    `<strong>B1…</strong> are the bench, best first by the same measure. Each man’s position is in ` +
    `the cell because every bench is a different shape — and after it where he ranks at that ` +
    `position on his own team, counting the starters too, so <strong>RB4</strong> is his squad’s ` +
    `fourth-best back whether or not the other three are in the lineup.`
  );

  // THE SCALE, ON THIS MEASURE (Tim, 2026-09-19b: "it needs to be added to all
  // the other places a number is referred to across the whole site"). The
  // paragraph has to carry the two things a reader cannot infer from looking:
  // that a column is the group, and that the state cells are deliberately out
  // of it — otherwise an uncoloured "Bye" in a coloured column reads as a bug.
  parts.push(
    `<strong>Green is a better number than the other squads have in that column this week and red ` +
    `is a worse one</strong>, deepening in four steps and reaching full colour one standard ` +
    `deviation out. ` +
    describeHeatPerColumn({ group: 'column', what: 'the other nine squads' })
  );

  parts.push(
    `<strong>A cell showing a state rather than a projection is never coloured</strong> — a ` +
    `<strong>Bye</strong>, a ruled-out <strong>0.0</strong>, and anyone listed OUT or on IR — and ` +
    `those cells are left out of the column’s average as well. A zero is not a poor week for a ` +
    `quarterback, it is no quarterback; counting a couple of them would roughly double the spread ` +
    `and switch the colour off for everybody else. So the scale describes the men who are actually ` +
    `playing this week, and the four state marks keep their cells to themselves. ` +
    `<strong>The bench columns carry no colour either</strong>: one squad’s B1 is a running back ` +
    `and the next squad’s is a quarterback, so a scale down that column would be comparing ` +
    `positions — the one thing this scale never does.`
  );

  if (grid.weekGrid) {
    parts.push(
      `A cell reading <strong>Bye</strong> is the 0.00 ESPN returns for a player whose NFL team is ` +
      `off that week, which is not the same as having no number at all. ESPN also returns 0.00 for ` +
      `a man it has ruled out, so a zero outside his team’s bye week reads <strong>0.0</strong> ` +
      `with OUT, IR or SUSP beside it. Neither can appear on <strong>Proj avg</strong>, whose ` +
      `cells are slots rather than men: a bye there is simply the next man up, averaged in.`
    );
  }

  parts.push(
    `<strong>Tap or hover any number</strong> for that man’s name and his whole season as a chart: ` +
    `the weeks along the top, his projection for each one underneath, and what he actually scored ` +
    `under that. On a phone it opens as a panel at the foot of the screen, with a button through to ` +
    `his next 13 weeks. Every name is in full in the roster detail at the foot of the page.`
  );

  parts.push(
    `<strong>Every number is a link</strong> to that man’s next 13 weeks on the ` +
    `<a href="waivers.html">Players</a> page. Click the row anywhere else to load that team into the ` +
    `panels below, and click any header to sort. <strong>The week picked above drives the whole ` +
    `page</strong> — the roster detail, the season sheet’s bracketed column and “who to start” all ` +
    `follow it, whichever measure this grid is on.`
  );

  el.innerHTML = parts.map((t) => `<p>${t}</p>`).join('');
}

/**
 * The team pickers — plural since 2026-09-19, and deliberately not two settings.
 *
 * Tim asked for one at the top of "Season by week" ("select which team you are
 * viewing this information about"). The obvious reading is a picker of that
 * panel's own, and it is the wrong one: three panels down this page are about
 * ONE squad — season by week, who to start, the roster detail — and a panel
 * with a team of its own would let the page show two squads at once while both
 * headings read "Season by week · …". So both selects write `state.teamId` and
 * both are nudged to it; which one the reader used is not a fact worth keeping.
 */
const TEAM_PICKERS = ['teamSelect', 'seasonTeamSelect'];

function renderTeamPicker() {
  const teams = state.data ? state.data.teams : [];
  const options = teams
    .map(
      (t) =>
        `<option value="${t.id}"${t.id === state.teamId ? ' selected' : ''}>${esc(t.name)}</option>`
    )
    .join('');
  for (const id of TEAM_PICKERS) {
    const sel = $(id);
    if (sel) sel.innerHTML = options;
  }
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
  const pick = typeof key === 'function' ? key : (p) => p[key];
  const vals = entries.map((e) => pick(e.p)).filter((v) => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, v) => a + v, 0)) : null;
}

/**
 * A man's week as the roster detail and the card print it: what he was
 * projected, and what he scored.
 *
 * In a week ESPN has not closed, js/season.js marks each man `done` or not. A
 * finished man's `projected` has been overwritten with his score, so his
 * projection is `pregame`; a man still to finish may carry a running score,
 * which is not a result and is left out. A week with no `done` on it (final,
 * demo, a stub) reads exactly as it always did.
 */
function weekLine(p) {
  if (p.done === true) {
    return {
      proj: typeof p.pregame === 'number' ? p.pregame : null,
      actual: typeof p.actual === 'number' ? p.actual
        : typeof p.projected === 'number' ? p.projected : null,
    };
  }
  if (p.done === false) return { proj: p.projected, actual: null };
  return { proj: p.projected, actual: p.actual };
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
  // PROJ AVG IS THE SAME NUMBER THE ALL-TEAMS GRID GIVES THIS SQUAD, and that
  // is the whole reason it moved (Tim, 2026-09-19). It used to be the best nine
  // by ESPN's season projection over 17 games; the grid above now measures the
  // average on the week-by-week lineup instead, and two different numbers under
  // one label on one page is the defect this site works hardest to avoid. It is
  // "—" until a week of the season has been read, rather than falling back to
  // the old figure — a number that silently changes meaning is worse than one
  // that is honestly not there yet.
  const avgTotal = teamWeeklyAverage(team.id);
  const flexId = grid.FLEX ? grid.FLEX.p.playerId : null;

  const starters = view.filter((e) => e.started);
  const benched = view.filter((e) => !e.started);
  const held = state.held === null ? null : view.find((e) => e.p.playerId === state.held) || null;

  // Totalled from the lineup ON SCREEN rather than taken from ESPN's own team
  // totals, so a swap moves them. With nothing swapped the rule is the one
  // season.js uses, so these are the numbers ESPN gave, to the decimal.
  // In a week still being played the totals follow the rows: the projection is
  // the pre-game one, and only finished men's scores count (see `weekLine`).
  const midWeek = view.some((e) => typeof e.p.done === 'boolean');
  const projTotal = sumOf(starters, (p) => weekLine(p).proj);
  const actualTotal = sumOf(starters, (p) => weekLine(p).actual);
  const benchActual = sumOf(benched, (p) => weekLine(p).actual);
  // The Diff of a part-played lineup is the finished men's only — the sum of
  // the Diff column — never their scores against the whole lineup's projection.
  const diffTotal = midWeek
    ? sumOf(starters, (p) => { const l = weekLine(p); return diff(l.actual, l.proj); })
    : diff(actualTotal, projTotal);

  const glance = [
    ['Week', state.week],
    ['Proj avg', fmt(avgTotal)],
    ['Projected', fmt(projTotal)],
    ['Actual', fmt(actualTotal)],
    ['Diff', signed(diffTotal)],
    ['Bench points', fmt(benchActual)],
    ['Starters', starters.length],
    ['Bench', benched.length],
  ];
  $('teamGlance').innerHTML = glance
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  // Only this table's cards: the grids above register their own under 'g'.
  clearRuns('r');
  const index = seasonIndexFor(team.id);
  const row = (entry) => {
    const { p } = entry;
    const line = weekLine(p);
    const d = diff(line.actual, line.proj);
    // Still to finish: Actual and Diff are blank, not a dash — there is no
    // result yet, which is a different fact from ESPN having no number.
    const open = p.done === false;
    const avg = avgWeek(p);
    const own = typeof p.percentOwned === 'number' ? `${p.percentOwned.toFixed(0)}%` : '—';
    const tier = injuryTier(p.injuryStatus);
    const cls = [
      entry.started ? '' : 'bench',
      entry.moved ? 'moved' : '',
      tier === 'out' || tier === 'ir' ? `st-${tier}` : '',
    ].filter(Boolean).join(' ');
    const isFlex = flexId !== null && p.playerId === flexId;
    // THE SAME CARD THE GRIDS SHOW (Tim, 2026-09-30): his season, week by week,
    // on a hover or a tap, rather than only behind the link. The card is the
    // name's words now, so the link carries an aria-label instead of a title —
    // a title would draw the browser's own tooltip on top of the card.
    const href = p.playerId === null || p.playerId === undefined
      ? null
      : `waivers.html?player=${encodeURIComponent(p.playerId)}`;
    const key = registerRun({
      ident: `${p.name} · ${p.position} · ${p.proTeam}${tier ? ` · ${p.injuryStatus}` : ''}`,
      run: seasonRunData(index, p),
      href,
      id: `r:${team.id}:${p.playerId ?? `x:${p.name}`}`,
      glance: glanceFor(p),
    }, 'r');
    return `
      <tr class="${cls}">
        ${slotControl(entry, held)}
        <td class="name${isFlex ? ' is-flex' : ''}"${tipAttr(key)}>${
          playerRef(p, esc(p.name), `${p.name}. Click to ${OPENS}.`, 'aria-label')}</td>
        <td class="left">${esc(p.position)}</td>
        <td class="left">${esc(p.proTeam)}</td>
        <td>${fmt(line.proj)}</td>
        <td>${open ? '' : fmt(line.actual)}</td>
        <td data-v="${d === null ? '' : d}">${open ? '' : signed(d)}</td>
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

  // The best-lineup line compares like with like: the solver prices a finished
  // man at his score, so the lineup on screen is totalled the same way.
  $('rosterBest').innerHTML = bestLineupLine(team, view,
    midWeek ? sumOf(starters, 'projected') : projTotal);

  renderRosterNote(view, team);
  resort(table);
  reopenTip();
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

  // The basis of Actual and Diff in a week still being played (rule 7). Only
  // then: a final week, the demo and a week nobody has kicked off in say nothing.
  if (view.some((e) => e.p.done === true)) {
    parts.push(
      `Week ${state.week} is still being played. A player whose NFL game is over shows the ` +
      `projection he started with and his score; anyone still to finish shows no Actual, and ` +
      `the totals count finished players only.`
    );
  }

  // WHY THIS TABLE IS NOT ON THE RED/GREEN SCALE. It is the one table on the
  // page where the rule the scale rests on rules it out outright, so it is
  // worth saying on screen: every other numeric table here is coloured, and a
  // reader who does not know why this one is not will think it was missed.
  parts.push(
    `<strong>Nothing here is on the red/green scale</strong>, and it is the one table on this page ` +
    `where that is a rule rather than a choice: a column down this table runs through every ` +
    `position at once, so a quarterback&rsquo;s 22 would be sitting in the same column as a ` +
    `kicker&rsquo;s 8. That is not a comparison, and colouring it would paint every kicker on the ` +
    `squad red for being a kicker. The scale needs a column of one kind of number &mdash; one ` +
    `lineup slot across the league &mdash; which is what the grid at the top of the page and ` +
    `Season by week both are.`
  );

  parts.push(
    `<strong>Season total</strong> is the whole ${SEASON_GAMES}-game projection and ` +
    `<strong>Avg/wk</strong> is that same number per game — one man's own average, which is a ` +
    `different question from the <strong>Proj avg</strong> above: that is what this squad's ` +
    `lineup is worth in an average week, slot by slot, whoever fills each slot that week. ` +
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
      `<strong>Proj avg</strong> above deliberately does not move with it: that is what this ` +
      `squad's best legal lineup is worth in an average week, the same figure the all-teams grid ` +
      `gives this team on its <strong>Proj avg</strong> setting, and it never depended on how ` +
      `the lineup was set.`
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
  followLanding();
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
      followLanding();
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
  followLanding();
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
      const line = weekLine(p);
      byPlayer.set(p.playerId, {
        // What the grids price him at — for a man who has finished, his score.
        projected: typeof p.projected === 'number' ? p.projected : null,
        // The card's two rows: his pre-game projection, and a RESULT — never
        // the running score of a man still playing.
        pregame: typeof line.proj === 'number' ? line.proj : null,
        actual: typeof line.actual === 'number' ? line.actual : null,
        done: p.done === true,
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
/** Has he finished that week's game while the week is still open? Then his number is a score. */
function seasonDone(index, week, p) {
  const byPlayer = index ? index.get(week) : null;
  const e = byPlayer ? byPlayer.get(p.playerId) : null;
  return Boolean(e && e.done);
}

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
/** The "Who to start" mark's class and its sentence, for whichever cell carries it. */
const startMark = (start) => (start ? ` st${start.flex ? ' fx' : ''}` : '');
const startSays = (name, week, start) => (start
  ? ` ${name} is in the best legal lineup for week ${week}` +
    (start.flex ? ', in the FLEX.' : `, at ${espn.SLOT_LABELS[start.slotId] || ''}.`)
  : '');

function seasonCell(v, week, p, isNow, start = null, status = p.injuryStatus, scored = false) {
  const name = p.name;
  const mark = startMark(start);
  const cls = (extra) => `wk${isNow ? ' now' : ''}${extra ? ` ${extra}` : ''}${mark}`;
  // A start is a fact about the lineup, so it is said on every cell that has
  // one — including a bye, which is exactly when a start is worth noticing.
  const says = esc(startSays(name, week, start));

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
    const why = scored
      ? `${esc(name)} scored nothing in week ${week}.`
      : state.isDemo
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
    `title="${scored
      ? `${esc(name)} scored ${fmt(v)} in week ${week}.`
      : `ESPN projects ${fmt(v)} for ${esc(name)} in week ${week}.`}${says}">${fmt(v)}</td>`;
}

// ------------------------------------------- the season panel's slot rows
//
// TIM, 2026-09-17, in his own words: "Instead of showing my current starting
// lineup and then the weekly proj of each player, I just want to label the
// positions as QB, WR1, WR2, etc. and then put the player with the proj that
// matches that position (2nd highest WR proj in WR2, etc.). ... This system is
// much better at telling the true story because it shows what you will actually
// be proj that week given the information we currently have."
//
// So the rows are LINEUP SLOTS, not men. Each week's cells are that week's BEST
// LEGAL LINEUP — `optimalLineup` from js/forecast.js, the same solver "Who to
// start" below and the schedule forecast use, so the three cannot disagree —
// laid out with the chosen men RANKED inside their own slot, best first. WR1 is
// therefore the best receiver in that week's lineup and WR2 the second, whoever
// they happen to be, and a bye simply moves the names down a row.
//
// The price of that is the one thing this panel must pay back: NOBODY IS NAMED
// ANYWHERE. That is what the identity line above the table and the cross-week
// highlight are for, and it is why these cells carry the same player card the
// grids at the top do — on a phone there is no hover, and the card as a sheet
// is the only thing that can answer "who is that" with a thumb.

/**
 * One team's best legal lineup in every week the cache holds.
 *
 * The single call site for `optimalLineup` over the season cache: the slot rows
 * here and the marks in "Who to start" below are the SAME answer read two ways,
 * and a second solve would be a second chance for them to disagree about who a
 * squad ought to be starting on the very same screen.
 *
 * @returns {Map<number, Array>} week -> the starters, each carrying its slotId
 */
function weeklyLineups(teamId, slots) {
  const out = new Map();
  if (!slots || teamId === null || teamId === undefined) return out;
  for (const [week, teams] of state.seasonWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) continue;
    out.set(week, optimalLineup(identified(team.players), slots).starters);
  }
  return out;
}

// -------------------------------------------------- how low is low, per slot
//
// Tim: "I also want to colorize numbers in red in this section for starting
// positions that have a lower number than where they should be at (QB good
// range should be 17+ or something like that). I'm thinking maybe 1-2 standard
// deviations below the mean? (I'm not sure if the sample size should be based
// on my own players or others, but whatever you think is best)."
//
// THE LEAGUE, not his own roster — decided here, and worth stating because he
// asked the question. His own squad gives at most one value per slot per week,
// and, worse, it is the thing being judged: a manager whose QB has been 11
// points all year would have 11 sitting one standard deviation from ITS OWN
// mean and the panel would call his weakest spot normal. Every squad's best
// lineup, across every week on screen, is ~160 values per slot, and it
// self-calibrates to this league's scoring rules without a single number being
// hard-coded — which is what a "QB good range is 17+" would have been.
//
// REPLACED 2026-09-19 BY THE SHARED SCALE, on Tim's instruction — "it will
// replace the current system we have with the colorization of the season week
// by week box". What was here: two levels, both on the LOW side, amber ▼ below
// one standard deviation and red ▼▼ below two. What is here now: js/heat.js,
// four steps each way, full colour at one standard deviation, and a GOOD number
// coloured as well as a bad one.
//
// THE COMPARISON GROUP IS UNCHANGED AND IS THE WHOLE VALUE OF THE PANEL: every
// squad's best lineup, in every week on screen, ranked inside its own slot —
// roughly 160 values per slot. A WR2 is only ever measured against other WR2s.
// That was already the answer to his original question ("my own players or
// others?") and the new scale inherits it rather than reopening it.
//
// AND IT DRAWS NOTHING WHEN IT CANNOT BE SURE. `stdev` returns null below two
// values (js/stats.js), `heatScale` returns null when it does, and the cell
// draws no colour at all: that is the honest answer on a Tuesday in week 1, and
// a confident one would be exactly the failure rule 5 in HANDOFF.md exists to
// prevent.

const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ------------------------------------------ one solve, read three ways
//
// Every squad's best legal lineup, in every week the cache holds, handed out to
// the league's slot rows. THREE panels are drawn from this one pass — the low
// marks below, the season sheet's own cells, and (since 2026-09-19) the
// all-teams grid on its Proj avg measure — and that is the point: ten squads
// times seventeen weeks is 170 calls to `optimalLineup`, and three copies of it
// would be three chances for the page to disagree with itself about who starts.

/** Memoised against the league, the rows and how much of the season has landed. */
let seasonFills = { key: null, byWeek: new Map() };

/** The key every memo on this data shares. Floors are NOT in it — see below. */
function fillsKey(rows, weeks) {
  return `${sourceKey()}|${rows.map((r) => r.key).join(',')}|` +
    `${[...state.seasonWeeks.keys()].sort((a, b) => a - b).join(',')}|${weeks.join(',')}`;
}

/** @returns {Map<number, Map<number, Map<string, {p:object, v:number}|null>>>} week -> team -> slots */
function weeklyFills(rows, slots, weeks) {
  const key = fillsKey(rows, weeks);
  if (seasonFills.key === key) return seasonFills.byWeek;

  const byWeek = new Map();
  const shown = new Set(weeks);
  for (const [week, teams] of state.seasonWeeks) {
    if (!shown.has(week)) continue;
    const perTeam = new Map();
    for (const team of teams) {
      perTeam.set(team.id, fillSlots(optimalLineup(identified(team.players), slots).starters, rows));
    }
    byWeek.set(week, perTeam);
  }

  seasonFills = { key, byWeek };
  return byWeek;
}

/**
 * What a slot is ASSESSED at in one week — the number the sheet draws.
 *
 * The floor is the whole reason this is not just `entry.v`: an empty slot is
 * worth what you would stream into it, and a man below the wire was never
 * really worth his own number. Shared by the sheet's Avg column, its totals
 * band and the all-teams grid, so the three cannot disagree about a cell.
 *
 * `null` and `undefined` are DIFFERENT and the difference is load-bearing:
 * `null` is a week we have read in which nobody could fill this slot, which is
 * exactly what a floor is for; `undefined` is a week that has not arrived (or
 * that ESPN refused), and flooring that would be a claim about a week nobody
 * has looked at — it would also march every average up as the page loaded.
 *
 * `exact` is the same assessment on the UNROUNDED projection (`raw` from
 * `fillSlots`), and it is what a week total adds up. `value` is a cell, to the
 * tenth; ten of those added came out 0.1–0.2 away from the Schedule page, which
 * adds the unrounded lineup and rounds once (measured 2026-10-06, 57 of 100).
 *
 * @returns {{value:number|null, assumed:boolean, exact:number|null}}
 */
function assessed(entry, row) {
  if (entry === undefined) return { value: null, assumed: false, exact: null };
  if (entry === null) {
    const sf = slotFloor(row.slotId, state.floors);
    return { value: sf ? sf.value : null, assumed: Boolean(sf), exact: sf ? sf.value : null };
  }
  const raw = typeof entry.raw === 'number' ? entry.raw : entry.v;
  // A FINISHED MAN'S SCORE IS A FACT (js/floor.js: a banked score is never
  // floored) — no streaming decision can reach back into it.
  if (entry.p && entry.p.done === true) return { value: entry.v, assumed: false, exact: raw };
  // The SLOT's floor, not the man's position's (AUDIT §1.8): a zero TE in the
  // FLEX is worth what an empty FLEX is, the best of RB/WR/TE on the wire.
  const a = flooredValue({ position: entry.p.position, projected: entry.v }, state.floors, row.slotId);
  const x = flooredValue({ position: entry.p.position, projected: raw }, state.floors, row.slotId);
  return {
    value: a.value === null ? entry.v : a.value,
    assumed: a.assumed,
    exact: x.value === null ? raw : x.value,
  };
}

/** Memoised against the league and how much of it has landed. */
let slotBars = { key: null, bars: new Map() };

/**
 * Per slot label, the whole league's distribution over the weeks on screen.
 *
 * ESPN'S OWN NUMBERS, deliberately unfloored. These bars say what a WR2 is
 * worth around this league, and lifting every low value to the wire before
 * measuring the spread would narrow the distribution using a number that is not
 * a fact about anybody's squad. A cell is compared against it on its assessed
 * value, which is the honest pairing: "given what this slot is really worth,
 * how does it sit against what the league's are worth".
 *
 * @returns {Map<string, {n:number, mean:number|null, sd:number|null,
 *                        scale:Object|null, hi:number|null, lo:number|null}>}
 *
 * `scale` is js/heat.js's own object and is what every cell is coloured from.
 * `hi` and `lo` are the two points where the colour reaches full saturation,
 * rounded to the tenth — which is the number PRINTED in the key, so a reader
 * checking a cell against the threshold gets the same answer the page did
 * rather than one hidden in a decimal nobody can see.
 */
function slotThresholds(rows, slots, weeks) {
  const key = fillsKey(rows, weeks);
  if (slotBars.key === key) return slotBars.bars;

  const values = new Map(rows.map((r) => [r.key, []]));
  for (const perTeam of weeklyFills(rows, slots, weeks).values()) {
    for (const fill of perTeam.values()) {
      for (const row of rows) {
        const e = fill.get(row.key);
        if (e && typeof e.v === 'number') values.get(row.key).push(e.v);
      }
    }
  }

  const bars = new Map();
  for (const row of rows) {
    const xs = values.get(row.key);
    const scale = heatScale(xs);
    const sd = stdev(xs);
    const m = avgOf(xs);
    // `stdev` is still read here rather than taken off the scale: it is this
    // page's existing "is there enough to be sure" test, `heatScale` makes the
    // same call for the same reason, and having both agree in the open is
    // cheaper than a comment claiming they do.
    bars.set(row.key, scale === null
      ? { n: xs.length, mean: m, sd: null, scale: null, hi: null, lo: null }
      : {
        n: xs.length,
        mean: m,
        sd,
        scale,
        hi: round1(m + scale.edges[scale.edges.length - 1] * sd),
        lo: round1(m - scale.edges[scale.edges.length - 1] * sd),
      });
  }

  slotBars = { key, bars };
  return bars;
}

// ------------------------------------ what a squad averages, slot by slot
//
// TIM, 2026-09-19: "In the analysis section, in week by week, there is an Avg
// column that shows the avg proj points of the players who are going to play
// that position, not just the same player every week. This is really good and I
// like it a lot. ... I want to use this exact information and apply it to the
// box above it (all teams, season proj avg), so that for that season avg, it
// doesn't use a single player's proj avg across a season, it uses the avg proj
// points for each position that was calculated and predicted in the box below."
//
// So this is the Avg column of "Season by week", computed for EVERY squad
// rather than only the one on screen. It is the same pass, the same slot rows,
// the same floor and the same regular-season-only rule — "this exact
// information" — and the all-teams grid reads it straight off.
//
// WHY IT IS BETTER THAN WHAT IT REPLACES, in one line: the old Proj avg was
// each man's own season projection over 17 games, so a squad's QB slot was
// worth its quarterback's average even in the week he is on bye, and a manager
// with two useful backs was credited for both in RB1 and RB2 every week whether
// or not they play the same one. This asks a different question — what will
// this SLOT actually be worth, week by week, given whoever fills it — and byes,
// depth and the waiver floor all fall out of it instead of being ignored.

/** Memoised on the same key as the fills, plus the floors, which move the numbers. */
let slotAvgs = { key: null, byTeam: new Map() };

/** A signature for the floors, so a late wire read repaints rather than being cached over. */
function floorsKey() {
  if (!state.floors) return 'nofloor';
  return [...state.floors.entries()].map(([k, f]) => `${k}${f.value}`).join(',');
}

/**
 * Every squad's per-slot average over the regular-season weeks on screen.
 *
 * @returns {Map<number, {slots: Map<string, {avg:number|null, n:number,
 *   assumed:number, who:Array<{name:string, n:number, playerId:*}>}>,
 *   total:number|null, weeks:number}>}
 *
 * The TOTAL is the whole lineup averaged — each week's assessed starting
 * eleven added up, then those totals averaged — and NOT the sum of the ten
 * column averages. They are the same arithmetic in principle and can differ by
 * a tenth in practice, because each column is rounded before it is printed and
 * because a week nobody could fill a slot in leaves that column one week short.
 * Taking it this way is what makes the grid's Total the very number the season
 * sheet's "Starting lineup" band shows for that squad; the note says so.
 */
function teamSlotAverages(rows, slots, weeks) {
  const key = `${fillsKey(rows, weeks)}|${floorsKey()}`;
  if (slotAvgs.key === key) return slotAvgs.byTeam;

  const byWeek = weeklyFills(rows, slots, weeks);
  const teamIds = new Set();
  for (const perTeam of byWeek.values()) for (const id of perTeam.keys()) teamIds.add(id);

  const byTeam = new Map();
  for (const id of teamIds) {
    const cells = new Map();
    for (const row of rows) {
      // Aligned to `weeks` so `regularAvg` can drop the playoff columns by
      // index — the same function the sheet's own Avg column uses, which is
      // what keeps "not counted in Avg" meaning one thing on this page.
      const values = [];
      const who = new Map();
      let assumedWeeks = 0;
      for (const w of weeks) {
        const perTeam = byWeek.get(w);
        const fill = perTeam ? perTeam.get(id) : null;
        if (!fill) { values.push(null); continue; }
        const e = fill.get(row.key) || null;
        const a = assessed(e, row);
        values.push(a.value);
        if (a.assumed && !isPlayoff(w)) assumedWeeks += 1;
        if (e && !isPlayoff(w)) {
          const k = String(e.p.playerId ?? e.p.name);
          const held = who.get(k);
          if (held) held.n += 1;
          else who.set(k, { name: e.p.name, playerId: e.p.playerId ?? null, n: 1 });
        }
      }
      const counted = values.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number').length;
      cells.set(row.key, {
        avg: regularAvg(values, weeks),
        n: counted,
        assumed: assumedWeeks,
        who: [...who.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
      });
    }

    // The week totals, exactly as the season sheet's band builds them.
    const totals = weeks.map((w) => {
      const perTeam = byWeek.get(w);
      const fill = perTeam ? perTeam.get(id) : null;
      if (!fill) return null;
      let sum = 0;
      let any = false;
      for (const row of rows) {
        const a = assessed(fill.get(row.key) || null, row);
        if (a.exact !== null) { sum += a.exact; any = true; }
      }
      return any ? round1(sum) : null;
    });

    byTeam.set(id, {
      slots: cells,
      total: regularAvg(totals, weeks),
      weeks: totals.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number').length,
    });
  }

  slotAvgs = { key, byTeam };
  return byTeam;
}

/** Memoised on the same key as the averages, floors included — they move it. */
let weekTotals = { key: null, byWeek: new Map() };

/**
 * EVERY SQUAD'S ASSESSED STARTING-LINEUP TOTAL, WEEK BY WEEK.
 *
 * The "Starting lineup" band of "Season by week" is one row of this map, and
 * since 2026-09-19b the band is COLOURED from the rest of it: a squad's week-9
 * total against the other nine squads' week-9 totals. That is the comparison
 * group rule applied to a whole lineup instead of a slot — and it is the same
 * shape the Stats page's week grid already uses, measured per WEEK COLUMN so a
 * week the whole league is quiet in does not come out as a red stripe.
 *
 * It is the same arithmetic `teamSlotAverages` averages, taken one week at a
 * time and kept, rather than a second copy of it: the band used to add its own
 * column up in a loop of its own, and two spellings of "what does this lineup
 * project" is how a band starts disagreeing with the grid above it.
 *
 * @returns {Map<number, Map<number, number|null>>} week -> team -> total
 */
function teamWeekTotals(rows, slots, weeks) {
  const key = `${fillsKey(rows, weeks)}|${floorsKey()}`;
  if (weekTotals.key === key) return weekTotals.byWeek;

  const fills = weeklyFills(rows, slots, weeks);
  const byWeek = new Map();
  for (const w of weeks) {
    const perTeam = fills.get(w);
    const totals = new Map();
    if (perTeam) {
      for (const [id, fill] of perTeam) {
        let sum = 0;
        let any = false;
        for (const r of rows) {
          // `|| null` for the same reason `teamSlotAverages` does it: a slot
          // key the fill has no entry for is a slot nobody could fill, which
          // is exactly what the waiver floor is for — not a week nobody read.
          // UNROUNDED slots, rounded once (`exact`), so the total is the
          // Schedule page's to the tenth.
          const a = assessed(fill.get(r.key) || null, r);
          if (a.exact !== null) { sum += a.exact; any = true; }
        }
        totals.set(id, any ? round1(sum) : null);
      }
    }
    byWeek.set(w, totals);
  }

  weekTotals = { key, byWeek };
  return byWeek;
}

// ------------------------------------------------ what has already happened
//
// TIM, 2026-10-05: "both the weekly totals and season by week chart show a
// little missleading or completely wrong info for current/past weeks. Instead
// of doing whatever we're doing now, just put a label above those weeks that
// says "Actual History" or something like that and then just show the numbers
// they actually recieved for that week, not anything different. ... make the
// "Actual" word on "actual history" a drop down that you can change with proj
// in case you're wondering what you were proj those weeks."
//
// WHAT WAS WRONG, measured on league 1241838 that day: a played week was drawn
// exactly like one still to come — the best legal lineup RE-SOLVED over that
// week's roster and floored at today's wire — so a squad that scored 108 read
// 125.1. And in a week whose players carry `done`, their scores stand in for
// projections, so the solver picked on the SCORES: the hindsight-perfect
// lineup (170.3 for a squad that really scored 161).
//
// So a week that is finished or being played is HISTORY, and both panels draw
// it from the lineup the squad REALLY started (`started` / `lineupSlotId` in
// the same season read — no solve, no floor, no second fetch). Everything
// above this block is untouched and still answers for the weeks to come, for
// the Avg columns and for the all-teams grid.

/** `prefs` key for the Actual / Proj choice — one per league. */
const historyPrefKey = () => `history.${sourceKey()}`;

/** 'actual' (the default) or 'proj': what the history columns show. */
function historyMode() {
  return prefs.get(historyPrefKey(), 'actual') === 'proj' ? 'proj' : 'actual';
}

/**
 * The weeks that have happened: every week the schedule has finished, and then
 * the one being played — the first week after them, once somebody in it has
 * finished (`done`, js/season.js). A run from the left, never a scattering.
 */
function historyWeeks(weeks = spanWeeks()) {
  const played = new Set(state.playedWeeks);
  const out = new Set();
  for (const w of weeks) {
    if (played.has(w)) { out.add(w); continue; }
    const teams = state.seasonWeeks.get(w);
    if (teams && teams.some((t) => (t.players || []).some((p) => p.done === true))) out.add(w);
    break;
  }
  return out;
}

/** The first week still to come — the column the heavy line is drawn before. */
function firstFuture(weeks, hist) {
  return hist.size ? weeks.find((w) => !hist.has(w)) : undefined;
}

/** Still being played: a starter somewhere in the league has not finished. */
function weekLive(week) {
  const teams = state.seasonWeeks.get(week);
  return Boolean(teams && teams.some((t) =>
    (t.players || []).some((p) => p.started === true && p.done === false)));
}

/** Memoised like the fills: the league, the rows, what has landed, what is history. */
let realFills = { key: null, byWeek: new Map() };

/**
 * Every squad's REAL lineup in every history week, handed out to the slot rows.
 *
 * Each starter is a copy carrying the two numbers of `weekLine`: `projected`
 * his projection before kickoff, `actual` his RESULT (null while he is still
 * playing — a running score is not one). `fillSlots` ranks men sharing a slot
 * on that projection, so the row a man sits in is the same on Actual and Proj.
 *
 * @returns {Map<number, Map<number, {fill:Map, starters:Array}>>} week -> team
 */
function realLineups(rows, weeks) {
  const hist = [...historyWeeks(weeks)];
  const key = `${fillsKey(rows, weeks)}|h${hist.join(',')}`;
  if (realFills.key === key) return realFills.byWeek;

  const byWeek = new Map();
  for (const w of hist) {
    const teams = state.seasonWeeks.get(w);
    if (!teams) continue;
    const perTeam = new Map();
    for (const team of teams) {
      const starters = (team.players || []).filter((p) => p.started === true).map((p) => {
        const line = weekLine(p);
        return {
          ...p,
          slotId: p.lineupSlotId,
          projected: typeof line.proj === 'number' ? line.proj : null,
          actual: typeof line.actual === 'number' ? line.actual : null,
        };
      });
      perTeam.set(team.id, { fill: fillSlots(starters, rows), starters });
    }
    byWeek.set(w, perTeam);
  }

  realFills = { key, byWeek };
  return byWeek;
}

/** A real starter's number on the chosen side, to the tenth; null when he has none. */
function historyValue(p, mode) {
  const v = mode === 'proj' ? p.projected : p.actual;
  return typeof v === 'number' ? round1(v) : null;
}

/** A real lineup added up: the score (finished starters only), or what it was projected. */
function historyTotal(starters, mode) {
  const vals = starters.map((p) => (mode === 'proj' ? p.projected : p.actual))
    .filter((v) => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, b) => a + b, 0)) : null;
}

/**
 * The week totals AS DRAWN: history weeks from the real lineups, on the chosen
 * side, and every other week straight out of `teamWeekTotals`. Weekly totals
 * and the Starting lineup band both read this, so they cannot disagree.
 *
 * @returns {Map<number, Map<number, number|null>>} week -> team -> total
 */
function shownTotals(rows, slots, weeks) {
  const best = teamWeekTotals(rows, slots, weeks);
  const hist = historyWeeks(weeks);
  if (!hist.size) return best;
  const real = realLineups(rows, weeks);
  const mode = historyMode();
  const out = new Map();
  for (const w of weeks) {
    if (!hist.has(w)) { out.set(w, best.get(w) || new Map()); continue; }
    const totals = new Map();
    for (const [id, got] of real.get(w) || []) totals.set(id, historyTotal(got.starters, mode));
    out.set(w, totals);
  }
  return out;
}

/**
 * A week still being played, shown as scores, is a set of PART totals: not
 * coloured and not averaged, the same refusal the Stats week grid makes.
 */
const partScores = (week, hist) => hist.has(week) && historyMode() === 'actual' && weekLive(week);

/**
 * THE AVG COLUMNS, AS DRAWN: every squad's mean of the numbers its row SHOWS.
 *
 * Until 2026-10-06 Avg stayed the best-lineup projection while the history
 * columns beside it showed real scores, so no reader could get it from the row
 * (measured on league 1241838: one squad's Avg 131.6 against 127.4 shown). Now
 * a history week counts at the number in its cell — the score, or on Proj the
 * real starter's projection — and a week to come at its assessed cell, exactly
 * as before. A dash counts for nothing; a part total (`partScores`) is left
 * out, as the League row leaves it out. With no history at all these are
 * `teamSlotAverages`' own numbers, so the sheet and the grid's Proj avg agree.
 *
 * The scales are built here too, from the same numbers, so what a cell prints,
 * sorts on and is coloured by is one value.
 *
 * @returns {{byTeam:Map<number,{slots:Map<string,number|null>, total:number|null}>,
 *            cols:Map<string,Object|null>, total:Object|null}}
 */
function shownAverages(rows, slots, weeks) {
  const teams = state.data ? state.data.teams : [];
  const hist = historyWeeks(weeks);
  const mode = historyMode();
  const fills = weeklyFills(rows, slots, weeks);
  const real = realLineups(rows, weeks);
  const totals = shownTotals(rows, slots, weeks);

  // To the tenth, as the cell prints it: a 7.96 shown as 8.0 counts as 8.0.
  const tenth = (v) => (typeof v === 'number' ? round1(v) : null);
  const byTeam = new Map();
  for (const t of teams) {
    const cells = new Map();
    for (const row of rows) {
      cells.set(row.key, regularAvg(weeks.map((w) => {
        if (hist.has(w)) {
          const got = (real.get(w) || new Map()).get(t.id);
          const e = got ? got.fill.get(row.key) : null;
          return e ? tenth(historyValue(e.p, mode)) : null;
        }
        const fill = (fills.get(w) || new Map()).get(t.id);
        return fill ? tenth(assessed(fill.get(row.key) || null, row).value) : null;
      }), weeks));
    }
    byTeam.set(t.id, {
      slots: cells,
      total: regularAvg(weeks.map((w) => (partScores(w, hist)
        ? null
        : (totals.get(w) || new Map()).get(t.id) ?? null)), weeks),
    });
  }

  const scaleOf = (pick) => heatScale(teams.map((t) => pick(byTeam.get(t.id))));
  return {
    byTeam,
    cols: new Map(rows.map((r) => [r.key, scaleOf((got) => got.slots.get(r.key))])),
    total: scaleOf((got) => got.total),
  };
}

/** What a history total says on a hover. */
function historyTotalLabel(v, week, live) {
  if (v === null) {
    return state.seasonWeeks.has(week)
      ? `Week ${week}: nothing recorded yet.`
      : totalLabel(null, week, 0);
  }
  if (historyMode() === 'proj') {
    return `Week ${week}: projected ${fmt(v)} before kickoff — the real starters added up.`;
  }
  return live
    ? `Week ${week}: ${fmt(v)} scored so far — finished starters only.`
    : `Week ${week}: scored ${fmt(v)}.`;
}

/**
 * The band above the history columns: "Actual history", with the word a select
 * (Actual | Proj). Null when nothing has happened yet. `tr.colgroup` is the
 * site's group band, and sortable.js reads only the LAST header row. `lead` is
 * how many columns come before the weeks (six in "Who to start").
 */
function historyGroupRow(weeks, hist, says = null, lead = 2) {
  const n = weeks.filter((w) => hist.has(w)).length;
  if (!n) return '';
  const mode = historyMode();
  const opt = (v, text) => `<option value="${v}"${mode === v ? ' selected' : ''}>${text}</option>`;
  const why = says || (mode === 'proj'
    ? 'Weeks played or in play: what each team’s real starters were projected before kickoff.'
    : 'Weeks played or in play: what each team’s real starters scored.');
  return `<tr class="colgroup hist-row"><th colspan="${lead}"></th>` +
    `<th colspan="${n}" class="hist-group" title="${why}">` +
    `<select class="hist-pick" data-history aria-label="History shows">` +
    `${opt('actual', 'Actual')}${opt('proj', 'Proj')}</select> history</th>` +
    (weeks.length > n ? `<th colspan="${weeks.length - n}" class="fut-start"></th>` : '') +
    `</tr>`;
}

/** `fut-start` on the first future week's cell — the heavy line, as `withPo` does `po-start`. */
function withFut(td, week, fut) {
  if (week !== fut) return td;
  return td.replace(/^<td(?: class="([^"]*)")?/, (m, c) => `<td class="${c ? `${c} ` : ''}fut-start"`);
}

/** What the Avg column's heading says once some of its weeks are history. */
const AVG_HEAD = 'The mean of the regular-season week columns that carry a number; playoff weeks are shown but not counted.';
const AVG_HEAD_HISTORY = 'The mean of the regular-season numbers shown in the row.';

/**
 * Where one number stands against its own slot around the league — the shared
 * scale, and the ONE place this panel asks for it.
 *
 * Returns null when the slot has no distribution, which is what makes the
 * "draw nothing rather than guess" rule a single early return everywhere below
 * rather than a condition repeated at four call sites.
 */
function slotHeat(v, bar, row) {
  return bar && bar.scale
    ? heatOf(v, bar.scale, { what: `a ${row.key} across the league` })
    : null;
}

// ------------------------------------------------- and the Avg column's own
//
// THE AVG COLUMN IS COLOURED SINCE 2026-09-19b, and the note above it used to
// say — in as many words — that it never would be: "It is deliberately left
// uncoloured — a season average is a different kind of number from a single
// week and does not belong on the same scale." That sentence was RIGHT about
// the scale it was talking about and WRONG about the conclusion, and Tim's
// "add it to all the other places a number is referred to" is what forced the
// distinction into the open.
//
// The week cells beside it are measured against ~160 values — every squad's
// every week at that slot — which is a wide distribution because a slot's
// weekly number swings. A SEASON AVERAGE of the same slot has had that swing
// averaged out of it, so ten squads' averages sit well inside one weekly
// standard deviation and putting them on the cells' scale would have coloured
// nothing at all. That is the real reason it was left alone, and the answer is
// not to leave it alone: it is to measure it against the right group, which is
// THE OTHER NINE SQUADS' AVERAGE AT THE SAME SLOT.
//
// Those are exactly the numbers the all-teams grid draws one panel up, on the
// same scale, out of `slotAvgScales` — one function, so a cell here and the
// cell for the same squad up there cannot come out different colours. That was
// the old note's own suggestion ("the all-teams grid colours it, against the
// other nine squads, which is the comparison that makes sense for an average");
// this panel now simply makes it without a scroll.
//
// THE WEIGHT CHANNEL IS THE ONE THING THIS COLUMN GIVES UP. `#seasonTable
// td.avg` is 650 weight because it is the column that orders the table into an
// answer, and that rule is more specific than `.heat-up-1`, so the scale's
// weight steps do not apply here. Left alone deliberately rather than fought:
// the steps run 500 / 550 / 620 / 700, so letting them through would draw a
// slightly-above-average cell LIGHTER than an exactly-average one, which is a
// worse cue than none. The other three channels are all present — the tint,
// the ▲/▼ at the ends, and the cell's own `title` in words.

/** One slot's Avg against the other nine squads' Avg at that slot. */
function avgHeatOf(avg, row, scales) {
  return heatOf(avg, scales.cols.get(row.key), { what: `the other squads’ ${row.key}` });
}

/** The Avg cell's sentence. A <td> with no link in it, so a `title` is right. */
function avgLabel(avg, row, team, heat, history = false) {
  if (avg === null) {
    return `No regular-season week read so far gives ${team ? team.name : 'this squad'} an ` +
      `${row.key} at all, so there is nothing to average.`;
  }
  // With history on screen the row holds real scores, so it is no longer the
  // grid's Proj avg: only the first half of the sentence is still true.
  return `${team ? team.name : 'This squad'}'s ${row.key} is worth ${fmt(avg)} in an average ` +
    `week — the regular-season cells in this row, averaged, assumed numbers included.` +
    (history ? '' : ` It is the same figure the all-teams grid shows for this squad on Proj avg.`) +
    (heat ? ` ${heat.words}` : '');
}

/** The band's Avg cell — the one number that ties this panel to the grid above. */
function bandAvgLabel(totalAvg, team, heat, history = false) {
  if (totalAvg === null) {
    return 'No week has been read yet, so there is no lineup to average.';
  }
  if (history) {
    return `${team ? team.name : 'This squad'} averages ${fmt(totalAvg)} a week — the ` +
      `regular-season totals shown in this row, averaged; a week still being played is left out.` +
      (heat ? ` ${heat.words}` : '');
  }
  return `${team ? team.name : 'This squad'}'s best legal lineup projects ${fmt(totalAvg)} in an ` +
    `average week — every week column in this band, averaged. It is the Total the all-teams grid ` +
    `shows for this squad on Proj avg.` + (heat ? ` ${heat.words}` : '');
}

// ---------------------------------------------------------------- the cell

/**
 * One slot's week.
 *
 * FOUR ways of having no number, told apart by class and by word, exactly as
 * the "Who to start" run below does — except that "he was not on this roster
 * that week" cannot happen to a SLOT, and is replaced by the one that can:
 * nobody eligible was available to fill it at all.
 *
 * `data-pid` is what the highlight is driven off. It is ESPN's own id and the
 * same one the link carries — never a name and never a row index, the same one
 * contract as everywhere else on this page.
 *
 * NO `title` ON A FILLED CELL. It stays off even now the card has gone from
 * this panel: the cell's content is a link, and `js/touch-titles.js`
 * deliberately leaves links alone, so a `title` here would be a desktop-only
 * explanation — exactly what HANDOFF forbids. The link keeps its `aria-label`,
 * which says the same thing, draws nothing, and is what a screen reader reads.
 */
function slotCell(entry, row, week, bar, index) {
  const cls = (extra) => `wk${week === state.week ? ' now' : ''}${extra ? ` ${extra}` : ''}`;

  if (!state.seasonWeeks.has(week)) {
    return state.seasonFailed.has(week)
      ? `<td class="${cls('muted')}" title="Week ${week} did not load — ESPN refused it, so this ` +
        `column is empty for everyone. Reload the page to try again.">—</td>`
      : `<td class="${cls('wait')}" title="Week ${week} has not been read from ESPN yet.">·</td>`;
  }
  if (!entry) {
    // AN EMPTY SLOT IS WORTH THE WIRE, NOT NOTHING (Tim, 2026-09-18). A squad
    // with no kicker left does not field an empty kicker slot — it streams
    // one — so the honest assessment is the best free agent there. With no
    // wire read this stays the dash it always was.
    const sf = slotFloor(row.slotId, state.floors);
    if (sf) {
      // It carries a real assessed number, so it takes the scale like any
      // other cell — a streamed replacement that is still well below what the
      // league gets at this slot is exactly the thing worth seeing in red.
      const h = slotHeat(sf.value, bar, row);
      return `<td class="${cls(`assumed${h ? ` ${h.cls}` : ''}`)}" data-v="${sf.value}" ` +
        `title="Nobody on this squad could fill ${esc(row.key)} in week ${week}, so it is ` +
        `assessed at ${fmt(sf.value)} — ${esc(floorSource(sf))}, who is ` +
        `who you would stream. ESPN projects nothing here.${h ? ` ${esc(h.words)}` : ''}">` +
        `${fmt(sf.value)}${heatMarkHtml(h)}</td>`;
    }
    return `<td class="${cls('muted')}" title="Nobody could fill ${esc(row.key)} in week ${week} — ` +
      `this squad had no ${esc(row.base)} with a projection that week.">—</td>`;
  }

  const { p, v: raw } = entry;
  const status = seasonStatus(index, week, p);

  // THE POSITIONAL FLOOR. `v` from here on is the ASSESSED number — what the
  // slot is really worth once you allow that a man below the wire would simply
  // be replaced — and `raw` is what ESPN actually said. Everything that reads
  // as a fact about ESPN (is this a bye, is he ruled out) is judged on `raw`;
  // everything that is an assessment (the value, the low marks, the totals)
  // uses `v`. Getting that split wrong would either hide a bye or colour a
  // lifted cell as though the man himself were having a bad week.
  // At the SLOT's floor, as `assessed` does, so this cell and the Avg and band
  // beside it cannot disagree about a FLEX (AUDIT §1.8).
  // A man who has finished is never floored: his number is a score (`assessed`).
  const scored = p.done === true;
  const lifted = scored
    ? { value: raw, raw, assumed: false, floor: null }
    : flooredValue({ position: p.position, projected: raw }, state.floors, row.slotId);
  const v = lifted.value === null ? raw : lifted.value;
  const assumed = lifted.assumed;

  const heat = slotHeat(v, bar, row);
  const zero = raw === 0 ? zeroOf(raw, week, p, status) : null;

  const why =
    zero === 'bye'
      ? `${p.name} fills ${row.key} in week ${week} on a bye — ESPN returns 0.00 for one, ` +
        `and nobody on this roster projected higher.`
      : zero === 'out'
        ? `${p.name} fills ${row.key} in week ${week} at 0.0: ESPN has ruled him out, and ` +
          `nobody on this roster projected higher.`
        : `${p.name} is this squad’s ${row.key} in week ${week}, ` +
          `${scored ? 'and scored' : 'projected'} ${fmt(raw)}.`;
  // The assumption, said in full on the cell that carries it. It is a number
  // ESPN never published, so a reader who cannot see where it came from has no
  // way to check it — and this is a panel Tim checks by hand.
  const assumedWhy = assumed
    ? ` Assessed at ${fmt(v)} instead: that is ${esc(floorSource(lifted.floor))}, ` +
      `and a manager would stream him rather than take ${fmt(raw)} here.`
    : '';
  // WHERE IT STANDS, IN WORDS. This is the channel of "never colour alone"
  // that carries the actual figure, and it matters more here than the mark
  // does: the mark says "end of the scale", the words say how far out and
  // against what. Full colour is at ${bar.lo} / ${bar.hi}, which the strip
  // inside "How this table works" also prints — and which is why every cell
  // stays checkable by hand now that the strip is behind the toggle.
  const says = heat
    ? ` ${heat.words} Full colour is ${fmt(bar.lo)} or below and ${fmt(bar.hi)} or above.`
    : '';

  // WHAT IS DRAWN IS THE ASSESSED NUMBER, and "Bye" gives way to it. A bye
  // that has been floored is no longer the answer to "what is this slot
  // worth" — the whole change is that it stopped being zero — so printing the
  // word would contradict the total underneath. The bye is still in the
  // explanation and still in the class.
  const shown = assumed
    ? fmt(v)
    : zero === 'bye'
      ? 'Bye'
      : zero === 'out'
        ? `${fmt(v)} <span class="zmark">${esc(outMark(status))}</span>`
        : fmt(v);
  const mark = heatMarkHtml(heat);

  const extra = [
    zero === 'bye' ? 'bye' : zero === 'out' ? 'zero-out' : zero === 'zero' ? 'zero' : '',
    // THE SCALE OWNS THE BACKGROUND AND THE WEIGHT, and nothing else — so the
    // orange `assumed` below still owns the TEXT of a floored cell, and a cell
    // can be green and assumed at once without either claim being lost. See
    // the block above `.heat` in css/app.css.
    heat ? heat.cls : '',
    // Tim: "if you're replacing a low or 0 proj with an assumed proj, just put
    // the assumed proj # and color code them in orange or something to show
    // it's assumed." Word as well as colour, via the title and the legend —
    // colour alone is the one thing this site never does.
    assumed ? 'assumed' : '',
  ].filter(Boolean).join(' ');

  // NO PLAYER CARD ON THIS PANEL, and no `data-tip` — Tim, 2026-09-18: "because
  // the player's season-wide proj is highlighted when you hover over that
  // number, we don't need to be providing the 14 week preview when you hover
  // over it as well. Just put the name of that player somewhere outside of the
  // chart, and their season proj, and current avg. That's it."
  //
  // The whole point of this panel is reading a man ACROSS the weeks, and the
  // lighting already does that on the table itself, so a card redrawing the
  // same thirteen numbers beside it was answering a question the panel had
  // already answered. What the card DID carry that the lighting does not —
  // who he is, and the link — moves to the line above the table (`paintLit`).
  // The two grids above keep their cards: there, one row is one team and a
  // cell really is the only place a man appears.
  return `<td class="${cls(extra)}" data-v="${v}" data-pid="${esc(p.playerId ?? '')}">` +
    `${playerRef(p, `${shown}${mark}`, `${why}${assumedWhy}${says} Click to ${OPENS}.`, 'aria-label')}</td>`;
}

/**
 * One slot's week IN HISTORY: the man who really started there and his number
 * on the chosen side — his score, or his projection before kickoff. No floor,
 * no "Bye" word, no assumption: a zero is the zero he scored.
 *
 * The same markup as `slotCell` (link, `aria-label`, `data-pid`), so the name
 * line and the lighting treat a history cell like any other. `scale` is this
 * slot around the league IN THIS WEEK, on the numbers shown.
 */
function historyCell(entry, row, week, scale) {
  if (!state.seasonWeeks.has(week)) return slotCell(null, row, week, null, null);
  const cls = (extra) => `wk hist${week === state.week ? ' now' : ''}${extra ? ` ${extra}` : ''}`;
  if (!entry) {
    return `<td class="${cls('muted')}" title="Nobody started at ${esc(row.key)} in week ${week}.">—</td>`;
  }
  const p = entry.p;
  const proj = historyMode() === 'proj';
  const v = historyValue(p, historyMode());
  // No id, no link (`playerRef`) — and then no `data-pid` either, so nothing
  // looks for a link the cell does not have.
  const pid = p.playerId === null || p.playerId === undefined ? '' : ` data-pid="${esc(p.playerId)}"`;
  const who = `${p.name} started at ${row.key} in week ${week}`;
  if (v === null) {
    const why = proj
      ? `${who}; no projection was recorded for him.`
      : p.done === false ? `${who} and has not finished yet.` : `${who}; no score was recorded for him.`;
    return `<td class="${cls('muted')}"${pid}>${playerRef(p, '—', `${why} Click to ${OPENS}.`, 'aria-label')}</td>`;
  }
  const heat = heatOf(v, scale, { what: `the other squads’ ${row.key} in week ${week}` });
  const why = proj ? `${who}, projected ${fmt(v)} before kickoff.` : `${who} and scored ${fmt(v)}.`;
  return `<td class="${cls(heat ? heat.cls : '')}" data-v="${v}"${pid}>` +
    `${playerRef(p, `${fmt(v)}${heatMarkHtml(heat)}`,
      `${why}${heat ? ` ${heat.words}` : ''} Click to ${OPENS}.`, 'aria-label')}</td>`;
}

/** What the totals band's cell says on a hover. It is a <td>, so a title is right. */
function totalLabel(total, week, slotCount) {
  if (total === null) {
    return state.seasonFailed.has(week)
      ? `Week ${week} did not load — ESPN refused it, so there is nothing to add up.`
      : `Week ${week} has not been read from ESPN yet.`;
  }
  return `The best legal lineup for week ${week} projects ${fmt(total)} — the ${slotCount} ` +
    `slots above added up.`;
}

function renderSeasonHead(weeks) {
  const hist = historyWeeks(weeks);
  const fut = firstFuture(weeks, hist);
  const proj = historyMode() === 'proj';
  if (rowsMode() === 'player') {
    $('seasonTable').querySelector('thead').innerHTML = playerHead(weeks, hist, fut, proj);
    return;
  }
  const cols = weeks
    .map((w) => {
      const failed = state.seasonFailed.has(w);
      const cls = ['wk', w === state.week ? 'now' : '', failed ? 'muted' : '',
        w === fut ? 'fut-start' : '']
        .filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : hist.has(w)
          ? `Week ${w}: the lineup really started, slot by slot — ` +
            (proj ? 'what each starter was projected before kickoff.' : 'what each starter scored.')
          : `The best legal lineup's projection for week ${w}, slot by slot.`;
      return weekHead(w, weeks, cls, title, hist.has(w) && weekLive(w) ? LIVE_TAG : '');
    })
    .join('');

  $('seasonTable').querySelector('thead').innerHTML =
    `${historyGroupRow(weeks, hist)}<tr>
       <th class="name" data-sort title="A starting slot in this league's own lineup, filled by that week's best legal lineup. Where a league starts more than one of a position, 1 is the best of them that week.${hist.size ? ' History weeks show the lineup really started instead.' : ''}">Slot</th>
       <th class="grouped" data-sort title="${hist.size ? AVG_HEAD_HISTORY : AVG_HEAD}">Avg</th>
       ${cols}
     </tr>`;
}

/**
 * The season sheet, and — since 2026-09-19 — the all-teams grid with it.
 *
 * The grid's Proj avg measure is made of the very weeks this panel is made of,
 * so a batch landing moves both, and every route that repaints one has to
 * repaint the other or the two boxes would disagree about a squad's average
 * for as long as the reader left the page open. Doing it here rather than at
 * `renderSeason`'s twelve call sites is what stops the thirteenth forgetting.
 * The grid on its WEEK measure is untouched by any of this, so it is not
 * repainted for nothing.
 */
function renderSeason() {
  paintTotals();
  paintSeason();
  if (currentGrid().slotGrid) renderOverview();
  // And the roster detail, for ONE figure in it: its Proj avg is this squad's
  // lineup in an average week, which is made of these weeks too. Without this
  // the tile sat at "—" until the reader happened to touch something else and
  // then filled in, which reads as a bug in the number rather than as a week
  // arriving. A repaint of it is cheap and is built entirely from state.
  renderRoster();
}

/**
 * Weekly totals: one row per squad, one column per week, each cell that squad's
 * best legal lineup for the week added up. Tim, 2026-10-02: "user's as first
 * column, week as top row, each cell is that user's total proj for their
 * starters for that week".
 *
 * NOT A SUM OF ITS OWN. It reads `teamWeekTotals`, the very numbers the Season
 * by week panel's "Starting lineup" band shows and colours, so a squad's row
 * here and its band below cannot disagree. Coloured the same way too: each week
 * column against the other squads in that week.
 */
function paintTotals() {
  const table = $('totalsTable');
  const teams = state.data ? state.data.teams : [];
  const weeks = spanWeeks();
  const rows = slotRows(leagueSlots());
  const show = teams.length > 0 && weeks.length > 0 && rows.length > 0;
  $('totalsWrap').classList.toggle('hidden', !show);
  $('totalsEmpty').classList.toggle('hidden', show);
  const foot = table.querySelector('tfoot');
  if (!show) {
    $('totalsEmpty').textContent = '';
    table.querySelector('thead').innerHTML = '<tr></tr>';
    bodyOf(table).innerHTML = '';
    if (foot) foot.innerHTML = '';
    return;
  }

  // HISTORY WEEKS ARE WHAT HAPPENED (see `historyWeeks`): the real score, or on
  // Proj what the real starters were projected. Avg is the mean of the row as
  // shown (`shownAverages`), on a scale built from those same ten means.
  const hist = historyWeeks(weeks);
  const fut = firstFuture(weeks, hist);
  const proj = historyMode() === 'proj';
  const totals = shownTotals(rows, leagueSlots(), weeks);
  const scales = new Map(weeks.map((w) => [w, partScores(w, hist) ? null : heatScale(
    [...(totals.get(w) || new Map()).values()]
  )]));
  const shownAvg = shownAverages(rows, leagueSlots(), weeks);
  const avgScale = shownAvg.total;

  table.querySelector('thead').innerHTML = `${historyGroupRow(weeks, hist)}<tr>` +
    `<th class="name" data-sort>Team</th>` +
    `<th class="grouped" data-sort title="${hist.size ? AVG_HEAD_HISTORY : AVG_HEAD}">Avg</th>` +
    weeks.map((w) => weekHead(w, weeks,
      `wk${w === state.week ? ' now' : ''}${w === fut ? ' fut-start' : ''}`,
      hist.has(w)
        ? `Week ${w}: ` + (proj
          ? 'what each team’s real starters were projected before kickoff.'
          : 'each team’s real score.')
        : `Each team's best legal lineup for week ${w}, projected.`,
      hist.has(w) && weekLive(w) ? LIVE_TAG : '')).join('') + `</tr>`;

  const avgs = [];
  bodyOf(table).innerHTML = teams.map((t) => {
    const vals = weeks.map((w) => (totals.get(w) || new Map()).get(t.id) ?? null);
    const avg = (shownAvg.byTeam.get(t.id) || { total: null }).total;
    avgs.push(avg);
    const ah = heatOf(avg, avgScale, { what: 'the other squads’ lineups' });
    return `<tr>` +
      `<td class="name" data-v="${esc(t.name)}">${esc(t.name)}</td>` +
      `<td class="avg grouped${ah ? ` ${ah.cls}` : ''}"${avg === null ? '' : ` data-v="${avg}"`} ` +
      `title="${esc(bandAvgLabel(avg, t, ah, hist.size > 0))}">${fmt(avg)}${heatMarkHtml(ah)}</td>` +
      vals.map((v, i) => {
        const w = weeks[i];
        const past = hist.has(w);
        const h = heatOf(v, scales.get(w), {
          what: past
            ? `the other teams’ ${proj ? 'projections' : 'scores'} in week ${w}`
            : `the other squads’ lineups in week ${w}`,
        });
        const says = past ? historyTotalLabel(v, w, weekLive(w)) : totalLabel(v, w, rows.length);
        return withFut(withPo(
          `<td class="wk${past ? ' hist' : ''}${w === state.week ? ' now' : ''}${h ? ` ${h.cls}` : ''}"` +
          `${v === null ? '' : ` data-v="${v}"`} ` +
          `title="${esc(`${t.name}: ` + says + (h ? ` ${h.words}` : ''))}">` +
          `${fmt(v)}${heatMarkHtml(h)}</td>`, w, weeks), w, fut);
      }).join('') +
      `</tr>`;
  }).join('');

  // THE LEAGUE ROW (Tim, 2026-10-05: "add another row at the bottom seperated
  // from the rest that is just the avg of the user's weeks or whatever to show
  // where the line is"). A `tfoot`, as on the Stats week grid, so click-to-sort
  // never files it among the teams; never coloured; blank where a column has
  // nothing to average — and in a week still being played, as Stats leaves it.
  if (foot) {
    const mean = (xs) => {
      const got = xs.filter((v) => typeof v === 'number');
      return got.length ? round1(got.reduce((a, b) => a + b, 0) / got.length) : null;
    };
    const show1 = (v) => (v === null ? '' : fmt(v));
    foot.innerHTML = `<tr class="league-row">` +
      `<td class="name">League</td>` +
      `<td class="avg grouped" title="The teams’ Avg, averaged.">${show1(mean(avgs))}</td>` +
      weeks.map((w) => {
        const v = partScores(w, hist)
          ? null
          : mean(teams.map((t) => (totals.get(w) || new Map()).get(t.id) ?? null));
        const says = partScores(w, hist)
          ? `Week ${w} is still being played, so there is no league average yet.`
          : `Week ${w}: the teams’ numbers in this column, averaged.`;
        return withFut(withPo(
          `<td class="wk${w === state.week ? ' now' : ''}" title="${says}">${show1(v)}</td>`,
          w, weeks), w, fut);
      }).join('') +
      `</tr>`;
  }
  resort(table);
}

function paintSeason() {
  const table = $('seasonTable');
  const team = currentTeam();
  const weeks = spanWeeks();
  const slots = leagueSlots();
  const rows = slotRows(slots);
  const players = team ? team.players : [];

  $('seasonTitle').textContent = team
    ? `Season by week · ${team.name}`
    : 'Season by week';

  setRowsToggle();
  renderSeasonHead(weeks);
  renderSeasonProgress(weeks);

  const show = players.length > 0 && weeks.length > 0 && rows.length > 0;
  $('seasonWrap').classList.toggle('hidden', !show);
  $('seasonEmpty').classList.toggle('hidden', show);

  if (!show) {
    $('seasonEmpty').textContent = seasonEmptyReason(team, weeks, rows);
    $('seasonNote').innerHTML = '';
    $('seasonLegend').innerHTML = '';
    $('seasonBars').innerHTML = '';
    $('seasonAvgBars').innerHTML = '';
    $('seasonPick').innerHTML = '';
    $('seasonAlert').innerHTML = '';
    $('seasonAlert').classList.add('hidden');
    $('seasonSlots').innerHTML = '';
    $('seasonTotals').innerHTML = '';
    paintChanges();   // and so has the box that follows this one
    renderStarters(); // it has an empty state of its own and must reach it
    return;
  }

  const index = seasonIndex(team.id);
  const bars = slotThresholds(rows, slots, weeks);
  // THE AVG COLUMN'S OWN SCALE, and it is NOT the week cells' scale beside it.
  // See the block above `avgHeatOf` — one number per squad, ten of them, which
  // is a far tighter distribution than the ~160 weekly values the cells are
  // measured against. The ten are each squad's row AS SHOWN (`shownAverages`);
  // with no history that is the very scale the all-teams grid uses.
  const avgScales = shownAverages(rows, slots, weeks);
  const shownAvg = avgScales.byTeam.get(team.id) || { slots: new Map(), total: null };
  // HISTORY (see `historyWeeks`): those columns are the lineup really started,
  // so the band there is the real score — `shownTotals`, the very numbers the
  // Weekly totals panel draws — and each slot is coloured against the other
  // squads' same slot IN THAT WEEK, on the numbers shown. A week still being
  // played, shown as scores, is part totals: no colour (`partScores`).
  const hist = historyWeeks(weeks);
  const fut = firstFuture(weeks, hist);
  const mode = historyMode();
  const real = realLineups(rows, weeks);
  const shown = shownTotals(rows, slots, weeks);
  const bandScales = new Map(weeks.map((w) => [w, partScores(w, hist) ? null : heatScale(
    [...(shown.get(w) || new Map()).values()]
  )]));
  const histScale = (w, row) => (partScores(w, hist) ? null : heatScale(
    [...(real.get(w) || new Map()).values()].map((got) => {
      const e = got.fill.get(row.key);
      return e ? historyValue(e.p, mode) : null;
    })
  ));
  const bandAvgScale = avgScales.total;

  // week -> slot key -> who is in it. Built once and read by both the slot rows
  // and the totals band, so the band can only ever be the column it sits under.
  // Taken out of the one league-wide solve, so this squad's rows here and its
  // row in the all-teams grid above are the same answer rather than two.
  const fills = weeklyFills(rows, slots, weeks);
  const byWeek = new Map();
  for (const w of weeks) {
    const perTeam = fills.get(w);
    byWeek.set(w, (perTeam && perTeam.get(team.id)) || null);
  }

  // Who each id IS, for the line above the table. Kept here rather than written
  // into every cell: one man holds up to sixteen of them, and his name is the
  // widest thing that could be repeated 160 times for something read for two
  // seconds. Rebuilt with the rows, so it can never describe a stale squad.
  seasonWho.clear();

  // PLAYER ROWS (see `rowsMode`): the men instead of the slots. Everything
  // around the rows — the head's label and line, the band, the note — is the
  // same code either way, so the band under them shows the same numbers.
  const menScales = rowsMode() === 'player' ? playerScales(rows, slots, weeks, hist, real, mode) : null;
  $('seasonSlots').innerHTML = rowsMode() === 'player'
    ? playerRows(team, weeks, index, hist)
      .map((row, i, all) => playerRowHtml(row, team, weeks, index, hist, fut, menScales,
        i > 0 && !row.starter && all[i - 1].starter)).join('')
    : rows
    .map((row) => {
      const values = weeks.map((w) => {
        const fill = byWeek.get(w);
        return fill ? fill.get(row.key) : undefined;
      });
      // What is DRAWN: the real starter in a history week, the solve elsewhere.
      const drawn = weeks.map((w, i) => {
        if (!hist.has(w)) return values[i];
        const got = (real.get(w) || new Map()).get(team.id);
        return got ? got.fill.get(row.key) : undefined;
      });
      for (const e of drawn) {
        if (e && e.p.playerId !== null && e.p.playerId !== undefined) {
          const p = e.p;
          const injured = injuryTier(p.injuryStatus);
          const scored = scoredToDate(index, p);
          seasonWho.set(String(p.playerId), {
            // The same identity line the grids' card draws, word for word. Two
            // spellings of "who is this" on one page is how two answers drift.
            ident: `${p.name} · ${p.position} · ${p.proTeam}${injured ? ` · ${p.injuryStatus}` : ''}`,
            seasonProj: typeof p.seasonProjected === 'number' ? p.seasonProjected : null,
            avg: scored.avg,
            games: scored.games,
            href: `waivers.html?player=${encodeURIComponent(p.playerId)}`,
          });
        }
      }
      // AVG AVERAGES WHAT THE ROW SHOWS, floors included. It used to average
      // ESPN's own numbers while the cells beside it showed the assessed ones,
      // so a row whose kicker was floored in three weeks reported an Avg no
      // reader could reproduce from the cells in front of them. An unfilled
      // slot contributes its floor here for the same reason it does in the
      // band: that is what the cell says it is worth. And a history week counts
      // at the number its cell shows (`shownAverages`), not at a re-solve.
      const avg = shownAvg.slots.get(row.key) ?? null;
      const bar = bars.get(row.key);
      const ah = avgHeatOf(avg, row, avgScales);

      return `
      <tr data-slot="${esc(row.key)}">
        <td class="name" data-v="${row.order}"><span class="slot-tag">${esc(row.key)}</span></td>
        <td class="avg grouped${ah ? ` ${ah.cls}` : ''}"${avg === null ? '' : ` data-v="${avg}"`} ` +
        `title="${esc(avgLabel(avg, row, team, ah, hist.size > 0))}">${fmt(avg)}${heatMarkHtml(ah)}</td>
        ${drawn.map((e, i) => withFut(withPo(hist.has(weeks[i])
          ? historyCell(e || null, row, weeks[i], histScale(weeks[i], row))
          : slotCell(e || null, row, weeks[i], bar, index), weeks[i], weeks), weeks[i], fut)).join('')}
      </tr>`;
    })
    .join('');

  // THE TOTALS BAND, the same one the Roster detail draws — Tim: "make a
  // starting lineup line with the added up totals of the proj every week, just
  // like how it's displayed in the roster detail box". Same `tbody.split`, same
  // styles, and a body of one row is what sortable.js leaves alone, so it stays
  // pinned under the last slot however the table is ordered.
  // THE BAND TOTALS THE COLUMN ABOVE IT, cell for cell — which now means the
  // ASSESSED numbers, floors included, or the band would disagree with the
  // very cells it is under. An unfilled slot contributes its slot floor for
  // the same reason the cell shows one: a squad with no kicker fields a
  // streamed kicker, not a hole. With no wire read every `flooredValue` is a
  // no-op and this is the arithmetic it always was.
  //
  // IT READS `teamWeekTotals` NOW rather than adding the column up in a loop of
  // its own. Same arithmetic to the digit — that is what an-test checks — but
  // one spelling of it, because the band is also COLOURED against the other
  // nine squads' totals for the same week and the number being coloured has to
  // be the number in the distribution.
  // THE AVG IS THE MEAN OF THE BAND AS DRAWN — the real score under "history",
  // the solve ahead — and the very figure Weekly totals prints for this squad.
  const totalAvg = shownAvg.total;
  const totals = weeks.map((w) => (shown.get(w) || new Map()).get(team.id) ?? null);
  const bandAvgHeat = heatOf(totalAvg, bandAvgScale, { what: 'the other squads’ lineups' });
  $('seasonTotals').innerHTML = `
    <tr class="split-row">
      <td class="name split-label">Starting lineup</td>
      <td class="avg grouped split-total${bandAvgHeat ? ` ${bandAvgHeat.cls}` : ''}"` +
      `${totalAvg === null ? '' : ` data-v="${totalAvg}"`} ` +
      `title="${esc(bandAvgLabel(totalAvg, team, bandAvgHeat, hist.size > 0))}">` +
      `${fmt(totalAvg)}${heatMarkHtml(bandAvgHeat)}</td>
      ${totals.map((t, i) => {
        // ONE WEEK COLUMN IS ONE COMPARISON GROUP: this squad's week-9 lineup
        // against the other nine squads' week-9 lineups. Measured per week and
        // never across the row, for the same reason the Stats page's week grid
        // is — a week the whole league is quiet in is not a bad week for
        // everybody, it is a bye-heavy week, and one scale across the season
        // would paint it as a red stripe down every squad's sheet.
        const past = hist.has(weeks[i]);
        const h = heatOf(t, bandScales.get(weeks[i]), {
          what: past
            ? `the other teams’ ${mode === 'proj' ? 'projections' : 'scores'} in week ${weeks[i]}`
            : `the other squads’ lineups in week ${weeks[i]}`,
        });
        const says = past
          ? historyTotalLabel(t, weeks[i], weekLive(weeks[i]))
          : totalLabel(t, weeks[i], rows.length);
        return withFut(withPo(
          `<td class="wk split-total${past ? ' hist' : ''}${weeks[i] === state.week ? ' now' : ''}` +
          `${h ? ` ${h.cls}` : ''}"` +
          `${t === null ? '' : ` data-v="${t}"`} ` +
          `title="${esc(says + (h ? ` ${h.words}` : ''))}">` +
          `${fmt(t)}${heatMarkHtml(h)}</td>`, weeks[i], weeks), weeks[i], fut);
      }).join('')}
    </tr>`;

  renderSeasonNote(weeks, rows, bars, avgScales);
  resort(table);
  // A repaint throws the highlight away with the cells that carried it, so it
  // is put straight back: the season panel repaints once per batch of weeks
  // while the league loads, and a highlight that vanished under the reader
  // three times in the first two seconds is the same defect the card had.
  paintLit();
  // And an open card finds its cell again among the new ones, for the same
  // reason and by the same route the grids use.
  reopenTip();

  // Driven from here rather than from each of renderSeason's ten call sites:
  // the two panels read the same week cache for the same team, so every reason
  // to repaint one is a reason to repaint the other, and a new call site added
  // later cannot forget this one.
  renderStarters();
  // And "Proj changes", for the same reason: same team, same weeks, same rows.
  paintChanges();
}

// ------------------------------------------------ rows: the slots, or the men
//
// TIM, 2026-10-05: "at the top of the current season by week chart, allow the
// user to select "player" or "position". Right now we have it on position ...
// For the player selection, show the player's name and position on the left,
// and then show what they're proj for all future weeks, and what the scored
// for all previous weeks. This means you will need to add many more rows so
// that the bench players are also shown in this (don't show past players, just
// current)."
//
// So Position is the sheet exactly as it was, and Player is one row per man on
// the roster the page is showing — the Roster detail's roster: starters, bench,
// and IR where ESPN lists it. The columns, the "Actual history" label and its
// select, the line before the weeks to come and the band are the same either
// way. NOT COLOURED: the page's scale compares a lineup slot around the
// league, and a man is not a slot ("Who to start" argues the same below).

/** `prefs` key for the Position / Player choice — one per league. */
const rowsPrefKey = () => `rows.${sourceKey()}`;

/** 'position' (the default) or 'player': what a row of the sheet is. */
function rowsMode() {
  return prefs.get(rowsPrefKey(), 'position') === 'player' ? 'player' : 'position';
}

/** Which button is lit, decided by the code rather than by the last click. */
function setRowsToggle() {
  const box = $('seasonRowsToggle');
  if (!box) return;
  const mode = rowsMode();
  box.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.rows === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/** Memoised against the league and how much of the season has landed. */
let leagueWeeks = { key: null, byWeek: new Map() };

/**
 * week -> playerId -> his week, WHICHEVER squad held him: `{ proj, actual,
 * done, teamId }`, the two numbers as `weekLine` reads them. A man's score is
 * his own, so a Player row finds it under any team in the league — and a week
 * nobody here held him has no entry, because the season read is rosters only.
 */
function leagueIndex() {
  const key = `${sourceKey()}|${[...state.seasonWeeks.keys()].sort((a, b) => a - b).join(',')}`;
  if (leagueWeeks.key === key) return leagueWeeks.byWeek;
  const byWeek = new Map();
  for (const [week, teams] of state.seasonWeeks) {
    const byPlayer = new Map();
    for (const team of teams) {
      for (const p of team.players || []) {
        if (p.playerId === null || p.playerId === undefined) continue;
        const line = weekLine(p);
        byPlayer.set(p.playerId, {
          proj: typeof line.proj === 'number' ? line.proj : null,
          actual: typeof line.actual === 'number' ? line.actual : null,
          done: p.done,
          teamId: team.id,
        });
      }
    }
    byWeek.set(week, byPlayer);
  }
  leagueWeeks = { key, byWeek };
  return byWeek;
}

/** DEF, as "Who to start" prints a D/ST's position. */
const posLabel = (p) => (p.position === 'DST' ? 'DEF' : p.position);

/**
 * Starters first, in lineup order, then everyone else by Avg, best first.
 * `slotId` is where ESPN has the man parked; a null one is the bench.
 */
function orderPlayers(list) {
  const lineup = (id) => id !== null && id !== undefined && id !== BENCH_SLOT && id !== IR_SLOT;
  const byAvg = (a, b) =>
    (b.avg ?? -Infinity) - (a.avg ?? -Infinity) || Number(a.p.playerId) - Number(b.p.playerId);
  const starters = list.filter((r) => lineup(r.slotId))
    .sort((a, b) => (SLOT_ORDER[a.slotId] ?? 40) - (SLOT_ORDER[b.slotId] ?? 40) || byAvg(a, b));
  const bench = list.filter((r) => !lineup(r.slotId)).sort(byAvg);
  return [...starters, ...bench].map((r, i) => ({ ...r, order: i, starter: i < starters.length }));
}

/**
 * THE PLAYER ROWS' SCALES (Tim, 2026-10-06: "colorize the boxes in the season
 * by week player version, just like the position version"). A man is measured
 * against the league's STARTERS AT HIS POSITION, never against another
 * position (js/heat.js §1):
 *
 *   week(w, pos)  a history week: that week's real starters at his position,
 *                 on the numbers shown. A week of part scores has none.
 *   ahead         a week to come: every best-lineup value at his position over
 *                 the weeks on screen — the Position rows' own pool
 *                 (`slotThresholds`), by position instead of by slot.
 *   avg           one number per squad: what its starters at that position
 *                 show on average over the regular season.
 */
function playerScales(rows, slots, weeks, hist, real, mode) {
  const fills = weeklyFills(rows, slots, weeks);
  const add = (map, k, v) => {
    if (typeof v !== 'number') return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  };
  const ahead = new Map();
  const byWeek = new Map();
  const perTeam = new Map();
  const ofTeam = (id) => {
    if (!perTeam.has(id)) perTeam.set(id, new Map());
    return perTeam.get(id);
  };
  for (const w of weeks) {
    const regular = !isPlayoff(w);
    for (const [id, fill] of fills.get(w) || []) {
      for (const row of rows) {
        const e = fill.get(row.key);
        if (!e || !e.p || typeof e.v !== 'number') continue;
        add(ahead, e.p.position, e.v);
        if (regular && !hist.has(w)) add(ofTeam(id), e.p.position, e.v);
      }
    }
    if (!hist.has(w) || partScores(w, hist)) continue;
    const here = new Map();
    for (const [id, got] of real.get(w) || []) {
      for (const s of got.starters) {
        const v = historyValue(s, mode);
        add(here, s.position, v);
        if (regular) add(ofTeam(id), s.position, v);
      }
    }
    byWeek.set(w, here);
  }
  const scalesOf = (map) => new Map([...map].map(([pos, xs]) => [pos, heatScale(xs)]));
  const means = new Map();
  for (const byPos of perTeam.values()) {
    for (const [pos, xs] of byPos) add(means, pos, avgOf(xs));
  }
  const weekScales = new Map([...byWeek].map(([w, here]) => [w, scalesOf(here)]));
  return {
    ahead: scalesOf(ahead),
    avg: scalesOf(means),
    week: (w, pos) => (weekScales.has(w) ? weekScales.get(w).get(pos) || null : null),
  };
}

/** A finished cell with its place on a scale added: class, words, the mark. */
function withHeat(td, heat) {
  if (!heat) return td;
  return td
    .replace(/^<td class="([^"]*)"/, (m, c) => `<td class="${c} ${heat.cls}"`)
    .replace(/ title="([^"]*)"/, (m, t) => ` title="${t} ${esc(heat.words)}"`)
    .replace(/<\/td>$/, `${heatMarkHtml(heat)}</td>`);
}

/**
 * The Player rows: every man on the roster on screen who can be followed from
 * week to week (`identified`), with his projection in each week still to come.
 * "Proj changes" lists the same men in the same order, so the two boxes read
 * across.
 *
 * AVG IS THE MEAN OF THE NUMBERS HIS ROW SHOWS, to the tenth as shown: what he
 * scored (or on Proj was projected) in a history week, his projection ahead.
 * A cell with no number — "Bye", a dash — counts for nothing.
 */
function playerRows(team, weeks, index, hist) {
  const mode = historyMode();
  return orderPlayers(identified(team.players).map((p) => {
    const ahead = weeks.map((w) => (hist.has(w) ? null : seasonValue(index, w, p.playerId)));
    const shown = weeks.map((w, i) => {
      if (hist.has(w)) return playerHistoryValue(p, w, mode);
      const v = ahead[i];
      if (typeof v !== 'number') return null;
      return v === 0 && zeroOf(v, w, p, seasonStatus(index, w, p)) === 'bye' ? null : round1(v);
    });
    return { p, slotId: p.lineupSlotId, ahead, shown, avg: regularAvg(shown, weeks) };
  }));
}

/** The number a Player row's history cell shows, or null when it shows none. */
function playerHistoryValue(p, week, mode) {
  const byPlayer = state.seasonWeeks.has(week) ? leagueIndex().get(week) : null;
  const e = byPlayer ? byPlayer.get(p.playerId) : null;
  const v = e ? (mode === 'proj' ? e.proj : e.actual) : null;
  if (typeof v !== 'number') return null;
  const bye = byeWeekOf(p, state.byes);
  return v === 0 && bye !== null && Number(bye) === Number(week) ? null : round1(v);
}

/** His name, a link like every other name on the page, then his position. */
function playerNameCell(row) {
  const p = row.p;
  return `<td class="name" data-v="${row.order}">` +
    `${playerRef(p, esc(p.name), `${p.name} — ${OPENS}`)}` +
    `<span class="row-pos">${esc(posLabel(p))}</span></td>`;
}

const PLAYER_AVG_HEAD = 'The mean of the regular-season numbers shown; a bye is left out.';

/**
 * The week headers of a table whose rows are MEN — the Player view here and
 * "Who to start" below: the heavy line, LIVE, and what a history week holds.
 * `ahead` words a week still to come.
 */
function playerWeekHeads(weeks, hist, fut, proj, ahead = (w) => `Each player’s projection for week ${w}.`) {
  return weeks
    .map((w) => {
      const failed = state.seasonFailed.has(w);
      const cls = ['wk', w === state.week ? 'now' : '', failed ? 'muted' : '',
        w === fut ? 'fut-start' : '']
        .filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : hist.has(w)
          ? `Week ${w}: ` + (proj ? 'what each player was projected before kickoff.' : 'what each player scored.')
          : ahead(w);
      return weekHead(w, weeks, cls, title, hist.has(w) && weekLive(w) ? LIVE_TAG : '');
    })
    .join('');
}

/** What the "Actual history" label says on a hover when the rows are men. */
const playerHistorySays = (proj) => (proj
  ? 'Weeks played or in play: what each player was projected before kickoff.'
  : 'Weeks played or in play: what each player scored.');

/** The Player view's two header rows: the same label, select and line. */
function playerHead(weeks, hist, fut, proj) {
  const cols = playerWeekHeads(weeks, hist, fut, proj);
  const says = playerHistorySays(proj);
  return `${historyGroupRow(weeks, hist, says)}<tr>
       <th class="name" data-sort title="A player on this roster: starters in lineup order, then the bench by Avg.">Player</th>
       <th class="grouped" data-sort title="${PLAYER_AVG_HEAD}">Avg</th>
       ${cols}
     </tr>`;
}

/**
 * One man's week IN HISTORY: what he scored — started or not, on whichever
 * squad held him — or on Proj what he was projected before kickoff. A man
 * still playing has no score yet, as in `historyCell`. `start` is "Who to
 * start"'s mark, as in `seasonCell`; the Player rows pass none.
 */
function playerHistoryCell(p, week, mode, teamId, start = null) {
  if (!state.seasonWeeks.has(week)) {
    return seasonCell(state.seasonFailed.has(week) ? 'failed' : 'wait', week, p, week === state.week, start);
  }
  const cls = (extra) => `wk hist${week === state.week ? ' now' : ''}${extra ? ` ${extra}` : ''}${startMark(start)}`;
  const says = startSays(p.name, week, start);
  const e = leagueIndex().get(week).get(p.playerId);
  if (!e) {
    return `<td class="${cls('off')}" title="${esc(p.name)} was on no roster in this league in ` +
      `week ${week}, so the season read has no number for him.">—</td>`;
  }
  const v = mode === 'proj' ? e.proj : e.actual;
  const bye = byeWeekOf(p, state.byes);
  const onBye = bye !== null && Number(bye) === Number(week);
  if (typeof v !== 'number' || (v === 0 && onBye)) {
    if (onBye) {
      return `<td class="${cls('bye')}"${v === 0 ? ' data-v="0"' : ''} ` +
        `title="${esc(`${p.name} was on bye in week ${week}.${says}`)}">Bye</td>`;
    }
    const why = mode === 'proj'
      ? `No projection was recorded for ${p.name} in week ${week}.`
      : e.done === false
        ? `${p.name} has not finished week ${week} yet.`
        : `No score was recorded for ${p.name} in week ${week}.`;
    return `<td class="${cls('muted')}" title="${esc(why + says)}">—</td>`;
  }
  const shown = round1(v);
  const why = (mode === 'proj'
    ? `${p.name} was projected ${fmt(shown)} before kickoff in week ${week}.`
    : `${p.name} scored ${fmt(shown)} in week ${week}.`) +
    (e.teamId === teamId ? '' : ' He was on another team then.');
  return `<td class="${cls()}" data-v="${shown}" title="${esc(why + says)}">${fmt(shown)}</td>`;
}

/** One Player row: name and position, Avg, then history and the weeks to come. */
function playerRowHtml(row, team, weeks, index, hist, fut, scales = null, benchStart = false) {
  const p = row.p;
  const mode = historyMode();
  const pos = posLabel(p);
  // His place among the league's starters at his position (`playerScales`). A
  // cell that shows no number — "Bye", a dash — takes no colour.
  const heatAt = (w, i) => (!scales ? null : hist.has(w)
    ? heatOf(row.shown[i], scales.week(w, p.position), { what: `a starting ${pos} around the league in week ${w}` })
    : heatOf(row.shown[i], scales.ahead.get(p.position), { what: `a starting ${pos} across the league` }));
  const cells = weeks.map((w, i) => withFut(withPo(withHeat(hist.has(w)
    ? playerHistoryCell(p, w, mode, team.id)
    : seasonCell(row.ahead[i], w, p, w === state.week, null, seasonStatus(index, w, p)),
  heatAt(w, i)), w, weeks), w, fut)).join('');
  const ah = scales
    ? heatOf(row.avg, scales.avg.get(p.position), { what: `a squad’s starting ${pos}, on average` })
    : null;
  return `
      <tr data-player="${esc(p.playerId)}"${benchStart ? ' class="bench-start"' : ''}>
        ${playerNameCell(row)}
        <td class="avg grouped${ah ? ` ${ah.cls}` : ''}"${row.avg === null ? '' : ` data-v="${row.avg}"`} ` +
        `title="${esc(`${p.name}: the mean of the regular-season numbers shown in his row.${ah ? ` ${ah.words}` : ''}`)}">` +
        `${fmt(row.avg)}${heatMarkHtml(ah)}</td>
        ${cells}
      </tr>`;
}

// ------------------------------------------------------------ proj changes
//
// TIM, 2026-10-05: "I want to make a proj changes chart in the analysis section
// that basically shows how a player's proj has changed between a certain time
// period/range. ... This proj change box will be identical to the current
// season by week chart, but will show you what your season by week chart
// looked like around week 3 or 2 or something so you can see how it changed.
// ... At the top of this proj difference chart, allow the user to select which
// week they want the chart to refer to, and then if it shows total or
// difference. The difference selection just shows the current proj-past proj
// for each cell in the chart".
//
// ESPN KEEPS NO HISTORY OF ITS PROJECTIONS (rule 8), so "as of week N" exists
// only where js/capture.js kept a copy that week (js/proj-history.js). This
// box READS those copies and what the sheet above already holds: no request is
// made from here, and a team with no copy gets one line saying so.
//
//   Total       the copy itself, in the shape of the sheet above: the men as
//               the roster stood then, or the best legal lineup re-solved from
//               them with the page's own solver and slots. A week the copy
//               does not cover is blank.
//   Difference  now − then, cell by cell, in the weeks still to come. A week
//               played since is blank: scored − projected is luck, not a
//               projection that moved.
//
// THE FLOOR IS THE SHEET'S: a slot is assessed through `assessed`, at today's
// wire, on both sides — the only wire there is — so a Position difference is a
// projection that moved and never a floor that appeared on one side only.

/** `prefs` key for Total / Difference — one per league. */
const changesPrefKey = () => `changes.${sourceKey()}`;

/** 'total' (the default) or 'diff'. */
function changesView() {
  return prefs.get(changesPrefKey(), 'total') === 'diff' ? 'diff' : 'total';
}

/** The week being played or next up: the first the schedule has not finished. */
function currentWeek(weeks) {
  const played = new Set(state.playedWeeks);
  const w = weeks.find((x) => !played.has(x));
  return w === undefined ? null : w;
}

/**
 * Every saved copy that has THIS team in it, earliest first. Storage only.
 * The sample league is never copied, so it has none.
 *
 * @returns {Array<{week:number, copy:object}>}
 */
function changesCopies(team) {
  if (state.isDemo || !team) return [];
  const out = [];
  try {
    const cfg = espn.getConfig();
    for (const e of projHistory.list(cfg.leagueId, cfg.season)) {
      const copy = projHistory.teamAsOf(cfg.leagueId, cfg.season, e.week, team.id);
      if (copy && copy.players.length && copy.weeks.length) out.push({ week: copy.week, copy });
    }
  } catch { /* unreadable storage is no history */ }
  return out;
}

/** The reader's week when it has a copy; else the newest one before this week. */
function changesAsOf(copies, weeks) {
  if (copies.some((c) => c.week === state.changesWeek)) return state.changesWeek;
  const now = currentWeek(weeks);
  const before = copies.filter((c) => now === null || c.week < now);
  return (before.length ? before[before.length - 1] : copies[0]).week;
}

/** The copy's best legal lineup in every week it covers: week -> slot key -> who. */
function thenLineups(men, copyWeeks, slots, rows) {
  const out = new Map();
  for (const w of copyWeeks) {
    const pool = men.map((p) => ({ ...p, projected: p.proj.get(w) }));
    out.set(w, fillSlots(optimalLineup(pool, slots).starters, rows));
  }
  return out;
}

function paintChanges() {
  const table = $('changesTable');
  if (!table) return;
  const team = currentTeam();
  const weeks = spanWeeks();
  const slots = leagueSlots();
  const rows = slotRows(slots);

  $('changesTitle').textContent = team ? `Proj changes · ${team.name}` : 'Proj changes';

  const ready = Boolean(team) && team.players.length > 0 && weeks.length > 0 && rows.length > 0;
  const copies = ready ? changesCopies(team) : [];
  const show = copies.length > 0;
  $('changesControls').classList.toggle('hidden', !show);
  $('changesWrap').classList.toggle('hidden', !show);
  const empty = $('changesEmpty');
  if (!show) {
    const now = currentWeek(weeks);
    empty.textContent = state.isDemo
      ? 'Sample data has no saved projections.'
      : !ready
        ? ''
        : `No saved projections for this team${now === null ? '' : ` before week ${now}`}. ` +
          `Saved weekly from now on.`;
    empty.classList.toggle('hidden', !empty.textContent);
    table.querySelector('thead').innerHTML = '<tr></tr>';
    $('changesRows').innerHTML = '';
    $('changesTotals').innerHTML = '';
    renderChangesNote(null);
    return;
  }
  empty.textContent = '';
  empty.classList.add('hidden');

  // ---- the two controls. Rewritten only when what they offer has changed:
  // replacing a control under the hand that is on it loses the focus.
  const asOf = changesAsOf(copies, weeks);
  const copy = copies.find((c) => c.week === asOf).copy;
  const sel = $('changesAsOf');
  const offered = copies.map((c) => c.week).join(',');
  if (sel.getAttribute('data-weeks') !== offered) {
    sel.innerHTML = copies.map((c) => `<option value="${c.week}">Week ${c.week}</option>`).join('');
    sel.setAttribute('data-weeks', offered);
  }
  if (sel.value !== String(asOf)) sel.value = String(asOf);

  const view = changesView();
  const box = $('changesView');
  if (!box.querySelector('button')) {
    box.innerHTML = viewSwitchHtml(view, {
      labels: ['Total', 'Difference'], label: 'Proj changes shows', box: 'changes',
    });
  }
  box.querySelectorAll('button[data-sbw-view]').forEach((b) => {
    const on = b.getAttribute('data-sbw-view') === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });

  // ---- what a column can hold
  const diff = view === 'diff';
  const byPlayer = rowsMode() === 'player';
  const hist = historyWeeks(weeks);
  const fut = firstFuture(weeks, hist);
  const inCopy = new Set(copy.weeks);
  /** 'cell' when a number belongs in this column, else why it is blank. */
  const colOf = (w) => (!inCopy.has(w) ? 'out' : diff && hist.has(w) ? 'played' : 'cell');
  const blankWhy = (w) => (colOf(w) === 'out'
    ? `Week ${w} is not in the copy saved in week ${asOf}.`
    : `Week ${w} has been played since week ${asOf}, so no projection is left to compare.`);
  const nowCls = (w) => (w === state.week ? ' now' : '');
  const wrap = (td, w) => withFut(withPo(td, w, weeks), w, fut);
  const blank = (w, band = '') =>
    wrap(`<td class="wk${band}${nowCls(w)}" title="${esc(blankWhy(w))}"></td>`, w);
  const dash = (w, why, band = '') =>
    wrap(`<td class="wk${band}${nowCls(w)} muted" title="${esc(why)}">—</td>`, w);
  const diffTd = (d, w, says, band = '') => (d === null
    ? dash(w, says, band)
    : wrap(`<td class="wk${band}${nowCls(w)} ${diffClass(d)}" data-v="${d}" title="${esc(says)}">` +
      `${signedText(d)}</td>`, w));
  /** The Avg cell: a mean of what the row shows — signed on Difference. */
  const avgTd = (vals, says, band = '') => {
    const avg = regularAvg(vals, weeks);
    if (avg === null) return `<td class="avg grouped${band}" title="${esc(says)}">—</td>`;
    return diff
      ? `<td class="avg grouped${band} ${diffClass(avg)}" data-v="${avg}" title="${esc(says)}">${signedText(avg)}</td>`
      : `<td class="avg grouped${band}" data-v="${avg}" title="${esc(says)}">${fmt(avg)}</td>`;
  };

  // ---- the two sheets: then (the copy) and now (what the panel above holds)
  // A copy keeps an NFL team's letters, not its id, so a man's bye week is
  // looked up through whoever holds him today.
  const known = new Map();
  for (const t of state.data.teams) {
    for (const p of t.players || []) known.set(String(p.playerId), p);
  }
  const then = identified(copy.players).map((p) => ({
    ...p, proTeamId: (known.get(String(p.playerId)) || {}).proTeamId ?? null,
  }));
  const thenById = new Map(then.map((p) => [String(p.playerId), p]));
  const thenFill = thenLineups(then, copy.weeks, slots, rows);
  const nowFill = weeklyFills(rows, slots, weeks);
  const index = seasonIndex(team.id);
  const slotThen = (row, w) => {
    const e = thenFill.get(w).get(row.key) || null;
    return { e, ...assessed(e, row) };
  };
  const slotNow = (row, w) => {
    const fill = (nowFill.get(w) || new Map()).get(team.id);
    const e = fill ? fill.get(row.key) || null : undefined;
    return { e, ...assessed(e, row) };
  };

  // ---- the head
  const avgHead = diff
    ? 'The mean of the differences shown; playoff weeks are not counted.'
    : `The mean of the regular-season weeks shown, as projected in week ${asOf}.`;
  table.querySelector('thead').innerHTML = `<tr>` +
    `<th class="name" data-sort>${byPlayer ? 'Player' : 'Slot'}</th>` +
    `<th class="grouped" data-sort title="${avgHead}">Avg</th>` +
    weeks.map((w) => weekHead(w, weeks, `wk${nowCls(w)}${w === fut ? ' fut-start' : ''}`,
      colOf(w) !== 'cell'
        ? blankWhy(w)
        : diff
          ? `Week ${w}: the projection now minus the projection in week ${asOf}.`
          : `Week ${w} as it was projected in week ${asOf}.`)).join('') +
    `</tr>`;

  // ---- the rows
  let body;
  if (byPlayer && !diff) {
    // TOTAL, PLAYER: the roster as it stood then, each man's projection then.
    body = orderPlayers(then.map((p) => {
      const vals = weeks.map((w) => (inCopy.has(w) ? p.proj.get(w) : undefined));
      // What Avg counts: the numbers shown — a "Bye" cell is not one, as above.
      const nums = vals.map((v, i) =>
        (v === 0 && zeroOf(0, weeks[i], p, p.injuryStatus) === 'bye' ? null : v));
      return { p, slotId: p.slotId, vals, nums, avg: regularAvg(nums, weeks) };
    })).map((row) => {
      const p = row.p;
      const cells = row.vals.map((v, i) => {
        const w = weeks[i];
        if (colOf(w) !== 'cell') return blank(w);
        if (typeof v !== 'number') return dash(w, `No projection was saved for ${p.name} in week ${w}.`);
        const says = `As of week ${asOf}, ${p.name} was projected ${fmt(v)} for week ${w}.`;
        const bye = v === 0 && zeroOf(0, w, p, p.injuryStatus) === 'bye';
        return wrap(`<td class="wk${nowCls(w)}${bye ? ' bye' : ''}" data-v="${round1(v)}" ` +
          `title="${esc(says)}">${bye ? 'Bye' : fmt(v)}</td>`, w);
      }).join('');
      return `<tr data-player="${esc(p.playerId)}">${playerNameCell(row)}` +
        avgTd(row.nums, `${p.name}: the mean of the regular-season weeks shown, as projected in week ${asOf}.`) +
        `${cells}</tr>`;
    }).join('');
  } else if (byPlayer) {
    // DIFFERENCE, PLAYER: the men on the roster NOW, as the sheet above lists
    // them. One who was not on it then has nothing to subtract.
    body = playerRows(team, weeks, index, hist).map((row) => {
      const p = row.p;
      const was = thenById.get(String(p.playerId));
      const off = `${p.name} was not on the roster in week ${asOf}.`;
      const ds = weeks.map((w, i) => {
        if (colOf(w) !== 'cell' || !was) return null;
        return diffOf(row.ahead[i], was.proj.get(w));
      });
      const cells = weeks.map((w, i) => {
        if (colOf(w) !== 'cell') return blank(w);
        if (!was) return dash(w, off);
        if (row.ahead[i] === 'wait') return wrap(seasonCell('wait', w, p, w === state.week), w);
        return diffTd(ds[i], w, ds[i] === null
          ? `${p.name} has no projection for week ${w} on one side, so there is nothing to compare.`
          : `${p.name}, week ${w}: ${fmt(row.ahead[i])} now, ${fmt(was.proj.get(w))} in week ${asOf}.`);
      }).join('');
      return `<tr data-player="${esc(p.playerId)}">${playerNameCell(row)}` +
        avgTd(ds, was ? `${p.name}: the mean of the differences shown.` : off) +
        `${cells}</tr>`;
    }).join('');
  } else {
    // POSITION, both views: the copy's best legal lineup, slot by slot — and on
    // Difference, the sheet above's own slot minus it.
    body = rows.map((row) => {
      const vals = weeks.map((w) => {
        if (colOf(w) !== 'cell') return null;
        return diff ? diffOf(slotNow(row, w).value, slotThen(row, w).value) : slotThen(row, w).value;
      });
      const cells = weeks.map((w, i) => {
        if (colOf(w) !== 'cell') return blank(w);
        const was = slotThen(row, w);
        const who = (x) => (x.e ? ` (${x.e.p.name})` : '');
        if (diff) {
          const is = slotNow(row, w);
          if (is.e === undefined) return wrap(slotCell(null, row, w, null, null), w);
          return diffTd(vals[i], w, vals[i] === null
            ? `${row.key} in week ${w} has no number on one side, so there is nothing to compare.`
            : `${row.key}, week ${w}: ${fmt(is.value)} now${who(is)}, ` +
              `${fmt(was.value)} in week ${asOf}${who(was)}.`);
        }
        if (was.value === null) {
          return dash(w, `Nobody on the roster of week ${asOf} could fill ${row.key} in week ${w}.`);
        }
        const bye = Boolean(was.e) && was.e.v === 0 && !was.assumed &&
          zeroOf(0, w, was.e.p, was.e.p.injuryStatus) === 'bye';
        const says = (was.e
          ? `As of week ${asOf}, ${was.e.p.name} was this squad’s ${row.key} for week ${w}, ` +
            `projected ${fmt(was.e.v)}.`
          : `As of week ${asOf}, nobody could fill ${row.key} in week ${w}.`) +
          (was.assumed ? ` Assessed at ${fmt(was.value)}: today’s waiver floor, as in the sheet above.` : '');
        return wrap(`<td class="wk${nowCls(w)}${bye ? ' bye' : was.assumed ? ' assumed' : ''}" ` +
          `data-v="${was.value}" title="${esc(says)}">${bye ? 'Bye' : fmt(was.value)}</td>`, w);
      }).join('');
      return `<tr data-slot="${esc(row.key)}">` +
        `<td class="name" data-v="${row.order}"><span class="slot-tag">${esc(row.key)}</span></td>` +
        avgTd(vals, diff
          ? `${row.key}: the mean of the differences shown.`
          : `${row.key}: the mean of the regular-season weeks shown, as projected in week ${asOf}.`) +
        `${cells}</tr>`;
    }).join('');
  }
  $('changesRows').innerHTML = body;

  // ---- the band: the same "Starting lineup" the sheet above carries. Then =
  // the copy's slots added up; now = that sheet's own band (`teamWeekTotals`).
  const bandNow = teamWeekTotals(rows, slots, weeks);
  const thenTotal = (w) => {
    const got = rows.map((r) => slotThen(r, w).exact).filter((v) => v !== null);
    return got.length ? round1(got.reduce((a, b) => a + b, 0)) : null;
  };
  const band = weeks.map((w) => {
    if (colOf(w) !== 'cell') return null;
    const was = thenTotal(w);
    return diff ? diffOf((bandNow.get(w) || new Map()).get(team.id), was) : was;
  });
  $('changesTotals').innerHTML = `<tr class="split-row">` +
    `<td class="name split-label">Starting lineup</td>` +
    avgTd(band, diff
      ? 'The mean of the differences shown.'
      : `The best legal lineup as projected in week ${asOf}, averaged over the regular-season weeks shown.`,
    ' split-total') +
    weeks.map((w, i) => {
      if (colOf(w) !== 'cell') return blank(w, ' split-total');
      if (diff) {
        return diffTd(band[i], w, band[i] === null
          ? `Week ${w} has no lineup total on one side, so there is nothing to compare.`
          : `Week ${w}: the best legal lineup projects ${fmt((bandNow.get(w) || new Map()).get(team.id))} ` +
            `now and projected ${fmt(thenTotal(w))} in week ${asOf}.`, ' split-total');
      }
      return band[i] === null
        ? dash(w, `No lineup could be made for week ${w} from the copy of week ${asOf}.`, ' split-total')
        : wrap(`<td class="wk split-total${nowCls(w)}" data-v="${band[i]}" ` +
          `title="${esc(`As of week ${asOf}, the best legal lineup for week ${w} projected ${fmt(band[i])}.`)}">` +
          `${fmt(band[i])}</td>`, w);
    }).join('') +
    `</tr>`;

  renderChangesNote({ asOf, copy, team });
  resort(table);
}

/** The method, behind the toggle. Nothing when there is no copy to explain. */
function renderChangesNote(got) {
  const el = $('changesNote');
  if (!el) return;
  const parts = [
    'ESPN keeps no history of its projections: a future week’s number is overwritten in place. ' +
    'So this site saves a copy of every roster’s projections <strong>once a week</strong>, the ' +
    'first time a page is opened that week, <strong>in this browser</strong>. “As of” lists only ' +
    'the weeks that have one for this team; a week nobody opened the site in cannot be recovered.',

    '<strong>Total</strong> is that copy laid out like Season by week. On Player it is the roster ' +
    'as it stood then, each man at his projection then. On Position it is the best legal lineup ' +
    're-solved from that roster, with the same solver, slots and waiver floor as the sheet above ' +
    '(today’s floor: no older one was kept). Weeks before the copy are blank.',

    '<strong>Difference</strong> is the projection now minus the projection then, cell by cell, ' +
    'for the weeks still to come; green is up and red is down. Weeks played since are blank, ' +
    'because scored minus projected is luck rather than a projection that moved. On Player the ' +
    'rows are today’s roster: a man who was not on it then shows a dash, and a man who has left ' +
    'is not listed. <strong>Avg</strong> is the mean of the regular-season cells shown.',
  ];
  if (got && got.copy.source === 'reading') {
    parts.push(
      `The week ${got.asOf} copy comes from that week’s reading, which kept your own team only.`
    );
  }
  el.innerHTML = parts.map((t) => `<p>${t}</p>`).join('');
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
  // `weeklyLineups` is the single solve, shared with the "Season by week" panel
  // above: the slot rows there and the marks here are the same answer read two
  // ways, and a second call to optimalLineup would be a second chance for the
  // two panels on one screen to disagree about who ought to be starting.
  for (const [week, starters] of weeklyLineups(teamId, slots)) {
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
 *
 * AVG IS THE MEAN OF THE NUMBERS HIS ROW SHOWS (2026-10-06), as a Player row's
 * is on the sheet above (`playerRows`): what he scored — or on Proj was
 * projected — in a history week, his projection ahead, each to the tenth. A
 * cell with no number — "Bye", a dash — counts for nothing.
 */
function starterRows(team, weeks, index, starters, hist = new Set()) {
  const onRosterNow = new Set(
    ((team && team.players) || []).map((p) => p.playerId)
  );
  const mode = historyMode();

  const rows = positionPool(team, weeks)
    .map((p) => {
      const values = weeks.map((w) => seasonValue(index, w, p.playerId));
      const shown = weeks.map((w, i) => {
        const v = values[i];
        if (hist.has(w)) return playerHistoryValue(p, w, mode);
        if (typeof v !== 'number') return null;
        return v === 0 && zeroOf(v, w, p, seasonStatus(index, w, p)) === 'bye' ? null : round1(v);
      });
      const startsIn = weeks.filter((w) => {
        const wk = starters.get(w);
        return wk && wk.has(p.playerId);
      });
      return {
        p,
        values,
        held: onRosterNow.has(p.playerId),
        avg: regularAvg(shown, weeks),
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

/**
 * HISTORY HERE TOO (2026-10-06): the played weeks sit under the sheet's own
 * "Actual history" label and select, before the same heavy line — one choice
 * for the three tables — and show what each man scored (`playerHistoryCell`).
 * The shading still answers the panel's question: the best legal lineup.
 */
function renderStartersHead(weeks, hist, fut) {
  const proj = historyMode() === 'proj';
  const cols = playerWeekHeads(weeks, hist, fut, proj,
    (w) => `ESPN’s projected points for week ${w}, and whether he starts.`);

  $('startersTable').querySelector('thead').innerHTML =
    `${historyGroupRow(weeks, hist, playerHistorySays(proj), 6)}<tr>
       <th class="left" data-sort title="How deep he is at his own position on this squad, by the Avg beside it.">Depth</th>
       <th class="name" data-sort>Player</th>
       <th class="left" data-sort>Pos</th>
       <th class="left" data-sort>NFL</th>
       <th class="grouped" data-sort title="${PLAYER_AVG_HEAD}">Avg</th>
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

  const hist = historyWeeks(weeks);
  const fut = firstFuture(weeks, hist);
  const mode = historyMode();

  setStarterToggle();
  renderStartersHead(weeks, hist, fut);

  const slots = leagueSlots();
  const index = team ? seasonIndex(team.id) : new Map();
  const starters = team ? weeklyStarters(team.id, slots) : new Map();
  const rows = starterRows(team, weeks, index, starters, hist);

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
          // A history week is what he scored, on whichever squad held him —
          // the very cell his Player row has on the sheet above.
          return withFut(withPo(hist.has(week)
            ? playerHistoryCell(p, week, mode, team.id, start)
            : seasonCell(v, week, p, week === state.week, start, seasonStatus(index, week, p),
              seasonDone(index, week, p)),
          week, weeks), week, fut);
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
    `grid at the top of the page uses, run once per week on that week&rsquo;s own projections. ` +
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

    // WHY THIS PANEL IS NOT ON THE RED/GREEN SCALE, said on screen rather than
    // only in a comment, because every other table on this page now is and an
    // unexplained gap reads as an oversight. Two independent reasons, and
    // either alone would be enough.
    `<strong>There is no red/green scale on this table</strong>, and that is deliberate. The ` +
    `shading here already owns a cell&rsquo;s background and it answers a <em>yes/no</em> &mdash; ` +
    `is he in the best lineup that week &mdash; which is the whole point of the panel; a value ` +
    `spectrum underneath it would be two meanings fighting over one channel. And the only honest ` +
    `comparison group for these numbers would be every ${label} in the league, which would paint a ` +
    `depth chart red for being a depth chart. <strong>Where a value scale belongs is Season by ` +
    `week above</strong>, whose rows are lineup slots and which carries it.`,

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
function seasonEmptyReason(team, weeks, rows = null) {
  if (!weeks.length) {
    return 'No weeks came back for this season, so there is nothing to lay out across the top. ' +
      'Check the league on the Connection page, or switch to Demo data.';
  }
  if (!state.data) return 'No roster data for this week yet, so there are no players to follow.';
  if (!team) return 'Pick a team above to follow its lineup through the season.';
  if (rows && !rows.length) {
    return 'The league’s starting slots aren’t known yet — they are read off the lineups ESPN ' +
      'has already accepted, so they arrive with the first week of rosters.';
  }
  return `No players came back for ${team.name} in week ${state.week}, so there is no lineup ` +
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
 * Five things have to be in here or the table is quietly misleading: whose
 * projections these are, that the rows are SLOTS rather than men and who
 * therefore fills one, what the totals band adds up, where the red thresholds
 * came from, and that a Bye cell and a dash mean different things.
 */
function renderSeasonNote(weeks, rows, bars, avgScales) {
  const parts = [];
  const team = currentTeam();

  parts.push(
    state.isDemo
      ? 'These are generated sample rosters and generated projections — not ESPN’s, and not ' +
        'your league’s. Switch to <strong>My ESPN league</strong> above to follow a real squad.'
      : 'Every number in the week columns is ESPN’s own projection for that player in that week, ' +
        'scored under this league’s rules — the same figure ESPN shows when you page a lineup ' +
        'forward. What is ours is which man lands in which slot, the total, and the low marks.'
  );

  const byPlayer = rowsMode() === 'player';
  if (byPlayer) {
    parts.push(
      `<strong>Each row is a player on this roster in week ${state.week}</strong>, starters first in ` +
      `lineup order, then the bench by Avg. A week under “Actual history” shows what he scored, ` +
      `started or not, on whichever squad in this league held him; a week nobody here held him is a ` +
      `dash. Switch Actual to <strong>Proj</strong> for what he was projected before kickoff. The ` +
      `weeks to come are his projection. <strong>Avg</strong> is the mean of the regular-season ` +
      `numbers shown in his row, a bye left out. Colour compares him with the league’s ` +
      `starters at his position; the line is where the bench begins. The ` +
      `<strong>Starting lineup</strong> band and everything below are as on Position.`
    );
  }
  parts.push(
    `<strong>${byPlayer ? 'On Position, each' : 'Each'} row is a lineup slot, not a player.</strong> Every week is filled with the ` +
    `<strong>best legal lineup</strong> ${team ? `${esc(team.name)} ` : 'that squad '} could field ` +
    `that week — the same solver “Who to start” below and the schedule forecast use — and the men ` +
    `it picks are then ranked inside their own slot on that week’s projection, so ` +
    `<strong>WR1</strong> is the best receiver in that week’s lineup and <strong>WR2</strong> the ` +
    `second. <strong>FLEX</strong> is whoever the flex actually is. Nobody is named in a cell: ` +
    `hover or tap one and the line above the table names him and lights up every other week he holds ` +
    `a slot.`
  );

  // HISTORY IS NOT SOLVED (Tim, 2026-10-05). Said here because every paragraph
  // around this one describes the weeks still to come.
  if (historyWeeks(weeks).size) {
    parts.push(
      `<strong>The weeks under “Actual history” are not solved at all.</strong> They show the ` +
      `lineup really started and what each starter scored, with no waiver floor, and Starting ` +
      `lineup there is the real score; a week still being played counts finished starters only. ` +
      `Switch Actual to <strong>Proj</strong> for what those same starters were projected before ` +
      `kickoff. Those cells are coloured against the other squads’ same slot in that week. ` +
      `<strong>Avg counts them as shown</strong>: it is the mean of the regular-season numbers in ` +
      `its row, so it is no longer the grid’s Proj avg.`
    );
  }

  parts.push(
    `<strong>Starting lineup</strong>, in the band under the last slot, is those slots added up for ` +
    `that week — the same band, and the same arithmetic, as the Roster detail above. It totals the ` +
    `column exactly as drawn, assumed numbers included, so the band can never disagree with the ` +
    `cells above it.`
  );

  // THE FLOOR, SAID OUT LOUD. Rule 7, and it matters more here than usual: an
  // assumed number is one ESPN never published, so a reader who cannot see
  // where it came from has no way to check it — and this is a panel Tim checks
  // by hand against ESPN's own site.
  const floorSaid = describeFloors(state.floors, { week: state.floorWeek });
  if (floorSaid) {
    parts.push(
      `<strong>No slot is assessed below what you could stream.</strong> ` + floorSaid +
      ` A FLEX counts at the best of the floors for the positions it takes, whoever is in it.` +
      ` Those cells are drawn in orange with a dotted underline, and the cell itself says who the ` +
      `assumed number came from. It is an assessment, not a prediction that you will make the ` +
      `claim — and it never changes which men the site says to start, only what a slot is counted ` +
      `as being worth.`
    );
  } else if (!state.isDemo) {
    parts.push(
      `<strong>No waiver floor is in use</strong>, so every number here is ESPN's own and a slot ` +
      `nobody can fill is a dash rather than a streamed replacement. The wire read either has not ` +
      `landed yet or was refused.`
    );
  }

  const withBar = rows.filter((r) => (bars.get(r.key) || {}).sd !== null);
  const sample = withBar.length ? (bars.get(withBar[0].key) || {}).n : 0;
  parts.push(
    `<strong>Green is a good number for that slot and red is a poor one</strong>, deepening in ` +
    `four steps and reaching full colour one standard deviation out — measured per slot across ` +
    `<strong>every squad in the league</strong> over the weeks on screen ` +
    (sample ? `(${sample} values a slot) ` : '') +
    `— not against your own roster, which would have far too little of it and would quietly call ` +
    `your weakest position normal. The two full-colour points are printed at the foot of this note, ` +
    `rounded to the tenth, which is exactly the number the colour is decided against. ` +
    (withBar.length === rows.length
      ? 'The cells at either end also carry ▲ or ▼, and the type gets heavier the further out a ' +
        'number is, so none of it depends on telling red from green.'
      : '<strong>A slot with too little to go on is left uncoloured</strong> — fewer than two values ' +
        'cannot have a standard deviation, and a confident colour there would be worse than none.')
  );

  // WHY THE SCALE CHANGED, said once. Tim asked for it and will see it move, and
  // a number he read as "fine" last week reading as amber this week is exactly
  // the kind of thing that looks like a bug when it is not explained.
  parts.push(
    `<strong>This scale replaced the old ▼ / ▼▼ low marks on 2026-09-19</strong> (Tim: “I want the ` +
    `range to be a lot tighter so it’s easier to be in green/red, not just the extremes”). Those ` +
    `coloured nothing for being GOOD and started only a full standard deviation below the mean; ` +
    `this one colours both directions and starts a quarter of a standard deviation out, so most ` +
    `cells carry some colour and the depth is the information. It is the same scale the ` +
    `all-teams grid at the top of the page uses, and the Stats page with it.`
  );

  const loaded = weeks.filter((w) => state.seasonWeeks.has(w)).length;
  const regular = weeks.filter((w) => !isPlayoff(w));
  const po = weeks.filter(isPlayoff);
  parts.push(
    `Covering ${weekRange(regular)} — ${plural(regular.length, 'week')} this season runs to` +
    (po.length ? `, then the playoffs (${weekRange(po)}) after the heavy line` : '') +
    (loaded === weeks.length ? ', all loaded.' : `, ${loaded} of ${weeks.length} loaded so far.`) +
    ' <strong>Avg</strong> is the mean of the regular-season columns that carry a number: the' +
    ' playoff weeks are shown but never counted in it.'
  );

  // THE AVG COLUMN AND THE BAND, both coloured since 2026-09-19b and both on
  // scales of their own. This paragraph exists because the previous one said
  // for a day that Avg would never be coloured, and because a reader who
  // assumed the whole table was on ONE scale would read every Avg cell against
  // the wrong pair of thresholds — the exact misreading rule 14 section 1 is
  // written to prevent.
  parts.push(
    `<strong>The Avg column is on its own scale</strong>, and it is not the one the week cells ` +
    `beside it use. A week cell is measured against every squad’s every week at that slot; an Avg ` +
    `is measured against <strong>the other nine squads’ Avg at the same slot</strong>` +
    (historyWeeks(weeks).size
      ? `. It has to be a `
      : ` — which is the very number the all-teams grid at the top of the page shows for each of ` +
        `them, on the same scale, so a cell here and that grid cannot come out different colours. ` +
        `It has to be a `) +
    `separate scale: averaging has already taken the week-to-week swing out, so ten season ` +
    `averages sit well inside one weekly standard deviation and the cells’ scale would have ` +
    `coloured none of them. The two sets of thresholds are printed at the foot of this note on two ` +
    `lines for the same reason.`
  );

  parts.push(
    `<strong>The Starting lineup band is coloured per WEEK COLUMN</strong>: this squad’s week-9 ` +
    `total against the other nine squads’ week-9 totals, and never across the season. A week the ` +
    `whole league is quiet in — a heavy bye week — is not a bad week for everybody, and one scale ` +
    `across the row would draw it as a red stripe down every squad’s sheet. Its <strong>Avg</strong> ` +
    `is measured against the other nine squads’ lineup averages` +
    (historyWeeks(weeks).size ? '.' : ', which is the Total on the grid above.')
  );

  parts.push(
    (state.isDemo
      ? 'On a real league a cell reading <strong>Bye</strong> is the 0.00 ESPN returns for a ' +
        'player whose NFL team is off that week — it only reaches a slot when nobody on the roster ' +
        'projected higher; in the sample data a zero only means he is ruled out, so it is printed ' +
        'as a number. '
      : 'A cell reading <strong>Bye</strong> is the 0.00 ESPN returns for a player whose NFL team ' +
        'is off that week, and it only reaches a slot when nobody else on the roster projected ' +
        'higher. ESPN also returns 0.00 for a man it has ruled out, so a zero in any other week is ' +
        'printed as <strong>0.0</strong>, with OUT, IR or SUSP beside it. ') +
    'A dash is not that: it means either that the week has not been read, or that nobody on this ' +
    'squad could fill the slot at all. <strong>Every number is a link</strong> to that man’s next ' +
    '13 weeks on the <a href="waivers.html">Players</a> page.'
  );

  parts.push(
    'The swaps in the Roster detail above are a what-if for one week and are deliberately not ' +
    'applied here: this panel answers what the numbers say you would be projected each week, and ' +
    'folding a hand-moved lineup into it would make an experiment look like advice. A man ESPN ' +
    'gave no player id for is left out of the lineups for the same reason “Who to start” leaves ' +
    'him out — nothing ties the man in one week to the man in the next.'
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

  const table = $('seasonTable');
  const body = bodyOf(table);
  // The slots this sheet could not scale, named in view. The strip that used to
  // draw them as a dash is inside the toggle now, where an uncoloured column
  // would go unexplained — and a refusal is a fact about the table rather than
  // method, so it stays where HANDOFF keeps warnings.
  const refused = heatRefusedHtml(
    rows.map((r) => [r.key, (bars.get(r.key) || {}).sd !== null ? bars.get(r.key) : null]),
    !!table.querySelector('td.heat'));
  renderKey('seasonLegend', [
    // Player rows name the man themselves, so nothing lights.
    !byPlayer && ['<span class="lg-mark lit">12.3</span>', 'the same man, every week'],
    // The two ENDS of the scale and nothing in between — a key with eight
    // swatches on it is a legend nobody reads, and the strip inside "How this
    // table works" prints the points each slot reaches them at.
    body.querySelector('td.heat-up-4') &&
      ['<span class="lg-mark heat heat-up-4">18.7 <span class="heatmark">▲</span></span>',
        'best of what this slot gives around the league'],
    body.querySelector('td.heat-dn-4') &&
      ['<span class="lg-mark heat heat-dn-4">9.8 <span class="heatmark">▼</span></span>',
        'worst of it — lighter shades are the steps between'],
    // The hue-free cues, and where the two strips of thresholds went. One chip
    // covers both scales: see HEAT_CUES_KEY.
    // THE WHOLE TABLE, not `body`: the Starting lineup band is its own <tbody>
    // and carries the scale even in a league whose slots are too thin to take
    // one (the `thin-slot` scenario is exactly that), and a coloured band with
    // nothing in the key saying the ends are marked is the colour standing
    // alone that rule 14 forbids.
    table.querySelector('td.heat') && ['', HEAT_CUES_KEY],
    refused && ['', refused],
    ['<span class="lg-mark tot">165.6</span>', 'the slots added up'],
    ...seasonMarks(table),
    // No "hover or tap" hint here: the line above the table says it already,
    // and saying it twice is the sort of thing the declutter pass removed.
  ]);

  // THE THRESHOLDS THEMSELVES, inside "How this table works". A reader can
  // check any coloured cell against these by eye, which is the difference
  // between a rule and a claim. Two numbers a slot now, not one: the scale runs
  // both ways, so the green end has to be checkable as well as the red.
  const barText = rows.map((r) => {
    const b = bars.get(r.key);
    return b && b.sd !== null
      ? `<span class="lg"><strong>${esc(r.key)}</strong> ${fmt(b.lo)} / ${fmt(b.hi)}</span>`
      : `<span class="lg"><strong>${esc(r.key)}</strong> —</span>`;
  }).join('');
  $('seasonBars').innerHTML =
    `<span class="lg lg-lead" title="At or below the first number a slot is fully red and marked ▼; ` +
    `at or above the second it is fully green and marked ▲. Both are one standard deviation from ` +
    `what that slot gives across the whole league over the weeks on screen, and the shades between ` +
    `them are quarter-deviation steps. A slot with too little behind it shows a dash and is never ` +
    `coloured.">Week cells, full colour at (red / green):</span>${barText}`;

  // AND THE AVG COLUMN'S, which are different numbers against a different
  // group. On its own line: a reader checking a cell has to be able to see
  // which pair belongs to it, and two scales interleaved on one line is how he
  // would check a season average against a weekly threshold and conclude the
  // page had coloured it wrong.
  renderHeatBands('seasonAvgBars',
    rows.map((r) => [r.key, avgScales ? avgScales.cols.get(r.key) : null])
      .concat([['Lineup', avgScales ? avgScales.total : null]]),
    'Avg column, full colour at (red / green):');
}

// ---------------------------------------- naming the man under the pointer
//
// Every cell in this panel is a bare number, and the row it sits in is a SLOT,
// so unlike the old layout there is nowhere at all that a name appears. Tim's
// own answer, and it is the right one: "if you hover over a number, it will
// show you the name of the selected player at the top of the box, and
// additionally, all other numbers for all weeks will be highlighted".
//
// Two rules it has to keep:
//
//   - NOTHING REACHABLE BY HOVER ALONE (HANDOFF). The same line is written on a
//     tap and on keyboard focus, and the cells also carry the shared player
//     card, which opens as a sheet under a finger — so a thumb gets the name,
//     the man's whole season, and the link the tap preempted.
//   - THE LINE MUST NOT REFLOW THE TABLE. It is always in the DOM and its
//     height is reserved in CSS, so naming somebody moves nothing.

/**
 * playerId (as a string) -> what the line above the table says about him:
 * `{ ident, seasonProj, avg, games, href }`. Rebuilt with the rows, so it can
 * never describe a stale squad.
 *
 * It holds the NUMBERS as well as the name because Tim asked for all three
 * outside the chart, and because the alternative — reading them back off the
 * cells — would give the wrong ones: a cell carries that WEEK's projection,
 * and "season proj" and "current avg" are season-wide facts.
 */
const seasonWho = new Map();

/**
 * What a man has actually AVERAGED so far, over every week loaded.
 *
 * His actual, not his projection — the panel's own Avg column is already the
 * mean of the projections, so repeating that on the line would say nothing
 * new. A week with no actual recorded is not a game (see the Act row rule:
 * read the DATA, never the calendar), and his BYE week is skipped rather than
 * averaged in as a zero, which would quietly punish everyone who has had one.
 *
 * `games` comes back with the average so the line can print the basis. With no
 * game played it is null, not 0.0 — rule 5: decide what a statistic returns
 * before it has enough data.
 */
function scoredToDate(index, p) {
  if (!index) return { avg: null, games: 0 };
  const bye = byeWeekOf(p, state.byes);
  const vals = [];
  for (const week of index.keys()) {
    if (bye !== null && Number(week) === Number(bye)) continue;
    const v = seasonActual(index, week, p.playerId);
    if (typeof v === 'number') vals.push(v);
  }
  if (!vals.length) return { avg: null, games: 0 };
  return { avg: vals.reduce((a, v) => a + v, 0) / vals.length, games: vals.length };
}

/** Paint whatever `state.seasonLit` says, over the cells that are there now. */
function paintLit() {
  const table = $('seasonTable');
  if (!table || typeof table.querySelectorAll !== 'function') return;
  for (const td of table.querySelectorAll('td.lit')) td.classList.remove('lit');

  const pid = state.seasonLit;
  const line = $('seasonPick');
  // Player rows carry the name already. The line keeps its reserved height, so
  // switching rows moves nothing; it just has nothing to say.
  if (rowsMode() === 'player') {
    if (line) line.innerHTML = '';
    return;
  }
  if (pid === null || !seasonWho.has(pid)) {
    if (line) {
      line.innerHTML = '<span class="pick-idle">Hover or tap a number to name the player.</span>';
    }
    return;
  }

  const mine = [...table.querySelectorAll(`td[data-pid="${pid}"]`)];
  for (const td of mine) td.classList.add('lit');
  if (!line) return;

  // NAME, SEASON PROJ, CURRENT AVG — and nothing else. Tim's words were "just
  // put the name of that player somewhere outside of the chart, and their
  // season proj, and current avg. That's it", so the count of weeks he is in
  // the lineup and the list of slots he fills came OUT: the highlight on the
  // table already shows both, by lighting the cells.
  //
  // Each number says what it is. "214.6" and "14.2" beside a name are two
  // unlabelled figures a reader has to guess at, and they answer different
  // questions — ESPN's whole-season forecast, and what he has really been
  // scoring per game. Either can legitimately be missing, and says so rather
  // than printing a confident zero.
  const who = seasonWho.get(pid);
  const bits = [
    who.seasonProj === null
      ? '<span class="pick-none">no season projection</span>'
      : `season proj <strong>${fmt(who.seasonProj)}</strong>`,
    who.avg === null
      ? '<span class="pick-none">nothing scored yet</span>'
      : `avg <strong>${fmt(who.avg)}</strong> over ${plural(who.games, 'game')}`,
  ];
  // The link the card's sheet used to offer. It has to live here now: on a
  // phone the tap is answered by this line instead of by navigation, so
  // without it the click-through would be desktop-only from this panel.
  const open = who.href
    ? ` <a class="pref pick-open" href="${esc(who.href)}">Open player</a>`
    : '';

  line.innerHTML = `<strong>${esc(who.ident)}</strong> — ${bits.join(' · ')}${open}`;
}

/** Light one man across the whole grid, or clear it. */
function lightPlayer(pid) {
  const next = pid === null || pid === undefined || pid === '' ? null : String(pid);
  if (state.seasonLit === next) return;
  state.seasonLit = next;
  paintLit();
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
    // The assumed mark leads, and only when one is actually on screen: it is
    // the only cue here that means "this number is not ESPN's", which is a
    // bigger thing to know about a cell than any of the states below it.
    has('td.wk.assumed') &&
      ['<span class="lg-mark assumed">7.8</span>',
        'assumed — the wire’s best for that slot, because ESPN’s was lower'],
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

/**
 * Which squad the page is about, and whose choice that was.
 *
 * For THIS visit. It used to be saved, and every later visit reopened on
 * whichever squad was tapped last — usually a rival glanced at once. A visit
 * opens on your own team; the pick is remembered only when the connection bar
 * has never been told which team is yours, since then there is nothing better
 * to open on — and never when it came from a link (`remember` false), which is
 * somebody else's pointer rather than the reader's pick.
 */
function chooseTeam(id, remember) {
  state.teamId = id;
  state.teamPickedOn = state.source;
  if (remember && (state.myTeamId === null || state.myTeamId === undefined)) prefs.set('team', id);
}

/** Selecting a team touches four places, so nobody calls them separately. */
function selectTeam(id) {
  endLanding();   // a hand on a team: a link into the page has done its work
  if (id === null || Number.isNaN(id) || id === state.teamId) return;
  chooseTeam(id, true);
  // Nudged rather than re-rendered: this also runs from a select's own change
  // handler, and rewriting a control's options underneath it loses focus. BOTH
  // pickers are nudged — the one at the top of Season by week and the one in
  // the roster detail are two views of a single setting, and a tap on a grid
  // row has to move both or the page would be showing one squad while a control
  // on it named another.
  for (const pid of TEAM_PICKERS) {
    const sel = $(pid);
    if (sel && sel.value !== String(id)) sel.value = String(id);
  }
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
  endLanding();
  setToggle(btn.dataset.src);
  btn.dataset.src === 'demo' ? useDemo() : useLive();
});

$('weekSelect').addEventListener('change', (e) => {
  endLanding();
  state.week = Number(e.target.value);
  state.weekPicked = true;   // honoured for the rest of this visit, past or not
  prefs.set('week', state.week);
  loadWeek();
});

for (const pid of TEAM_PICKERS) {
  const sel = $(pid);
  if (sel) sel.addEventListener('change', (e) => selectTeam(Number(e.target.value)));
}

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

// Clicking anywhere on a team's row drills into it — the grid is the thing
// people scan, so making them go back to the select below to act on what they
// found would be a step for nothing.
//
// Registered ONCE, on the table, not on the rows: the measure switch repaints
// every row, and a handler that lived on a row would be thrown away with it.
$('overviewTable').addEventListener('click', (e) => {
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
// The grid is the reason to be here, so it opens on the number that ranks
// teams: Total, high first — the team, the spots, then it. This index is only
// the opening guess; `sortShape` retargets Total once the league's slots are read.
enableSort($('overviewTable'), { defaultIndex: GRID_SLOTS.length + 1 });
wireTips($('overviewTable'));

/**
 * THE MEASURE SWITCH: a typical week, or the week picked beside it.
 *
 * A repaint and nothing else — both numbers are already on every player in the
 * week already fetched, so flipping between them can never cost a request. The
 * choice is remembered for the next visit; the WEEK is not changed by it, which
 * is what keeps the panels below agreeing with the picker.
 */
$('measureToggle').addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('button[data-measure]');
  if (!btn || !MEASURES[btn.dataset.measure] || btn.dataset.measure === state.measure) return;
  state.measure = btn.dataset.measure;
  prefs.set('measure', state.measure);
  renderOverview();
});

enableSort($('rosterTable'), { defaultIndex: 0, defaultAsc: true });
wireTips($('rosterTable'));

// The season grid opens in LINEUP ORDER — QB, RB1, RB2, … — so it reads as a
// lineup sheet rather than as a leaderboard. Avg is one click away for anyone
// who wants the other question answered, and the totals band is a tbody of one
// row, which sortable.js leaves alone, so it stays pinned under the last slot.
enableSort($('seasonTable'), { defaultIndex: 0, defaultAsc: true });
// Weekly totals opens on Avg, best first.
enableSort($('totalsTable'), { defaultIndex: 1 });

// ACTUAL | PROJ, the word in "Actual history" (Tim, 2026-10-05). One choice for
// both tables, kept per league; a repaint of those two panels and nothing else.
// "Who to start" carries the same select since 2026-10-06; `paintSeason`
// repaints it.
for (const id of ['totalsTable', 'seasonTable', 'startersTable']) {
  $(id).addEventListener('change', (e) => {
    const pick = e.target.closest ? e.target.closest('select[data-history]') : null;
    if (!pick) return;
    prefs.set(historyPrefKey(), pick.value === 'proj' ? 'proj' : null);
    paintTotals();
    paintSeason();
  });
}

// POSITION | PLAYER (Tim, 2026-10-05): what a row of the sheet is. Kept per
// league, and "Proj changes" below follows it — `paintSeason` repaints both.
$('seasonRowsToggle').addEventListener('click', (e) => {
  const btn = e.target.closest ? e.target.closest('button[data-rows]') : null;
  if (!btn) return;
  const mode = btn.dataset.rows === 'player' ? 'player' : 'position';
  if (mode === rowsMode()) return;
  prefs.set(rowsPrefKey(), mode === 'player' ? 'player' : null);
  paintSeason();
});

// PROJ CHANGES: which saved week, and Total | Difference. Neither reads ESPN.
enableSort($('changesTable'), { defaultIndex: 0, defaultAsc: true });
$('changesAsOf').addEventListener('change', (e) => {
  state.changesWeek = Number(e.target.value);
  paintChanges();
});
$('changesView').addEventListener('click', (e) => {
  const hit = viewFromClick(e);
  if (!hit || hit.box !== 'changes' || hit.view === changesView()) return;
  prefs.set(changesPrefKey(), hit.view === 'diff' ? 'diff' : null);
  paintChanges();
});

// NO `wireTips` HERE. This panel deliberately has no player card — Tim,
// 2026-09-18 — so the line above the table and the highlight are the whole of
// what pointing at a number does. See `slotCell`.

// NAMING THE MAN, AND LIGHTING HIS OTHER WEEKS.
//
// Registered on the table itself, on hover, focus and click, so the same
// answer arrives from a mouse, a keyboard and a thumb — the card used to be
// what covered the thumb, and with the card gone this is.
//
// A MOUSE click follows the link and leaves the page, so the highlight it sets
// on the way out costs nothing and is simply never seen. A TAP is intercepted
// instead: on a phone, letting it navigate would mean the name, the season
// projection and the average were reachable by hover alone, which HANDOFF
// forbids outright. The line carries an "Open player" link so the action the
// tap preempted is still one tap away — the same bargain the card's sheet
// struck, minus the thirteen numbers he did not want.
{
  const season = $('seasonTable');
  const cellOf = (e) => (e.target.closest ? e.target.closest('td[data-pid]') : null);
  const light = (e) => {
    const td = cellOf(e);
    if (td) lightPlayer(td.getAttribute('data-pid'));
  };
  season.addEventListener('mouseover', light);
  season.addEventListener('focusin', light);
  season.addEventListener('click', (e) => {
    const td = cellOf(e);
    if (!td) return;
    // Modified clicks are the browser's, always — open-in-new-tab has to work
    // on a touch device with a keyboard attached too.
    if (coarsePointer() && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button !== 1) {
      e.preventDefault();
    }
    light(e);
  });
  const leave = (e) => {
    const td = cellOf(e);
    if (!td) return;
    // Moving onto the link INSIDE the same cell is not a leave, and treating it
    // as one is what makes a highlight flicker. Same rule the card follows.
    if (e.relatedTarget && td.contains(e.relatedTarget)) return;
    lightPlayer(null);
  };
  season.addEventListener('mouseout', leave);
  season.addEventListener('focusout', leave);
}

// Escape clears it, the same key that closes the card — so one press puts the
// panel back to rest however it was opened.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lightPlayer(null);
});

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

// Which measure the all-teams grid is on, from the last visit. Anything that is
// not one of the two falls back to the default rather than wedging the panel on
// a measure with no renderer behind it.
const rememberedMeasure = prefs.get('measure', null);
if (rememberedMeasure && MEASURES[rememberedMeasure]) state.measure = rememberedMeasure;

// A link into the roster detail. Read before the first load so the week it
// names is the one that load asks for.
state.landing = requestedRoster();
if (state.landing) {
  // Scrolling by hand ends the page's own scrolling for good; a tap or a key
  // on a control does not, so connecting a league from the bar still lands.
  const hands = () => {
    if (!state.landing) return;
    state.landing.touched = true;
    state.landing.follow = false;
  };
  for (const type of ['wheel', 'touchmove']) {
    document.addEventListener(type, hands, { passive: true });
  }
}

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

// Sync now, or a roster move js/season.js noticed (`ff:refresh`, sent by
// js/connection.js): the league is read again, as on a first load.
document.addEventListener('ff:refresh', (e) => {
  if (state.source !== 'live' || state.isDemo) return;
  // The season table's weeks are held against the league, so that switching
  // teams is free. This is the one time they are let go (`ensureSeasonWeeks`).
  state.seasonKey = null;
  e.detail.waitUntil(useLive());
});
