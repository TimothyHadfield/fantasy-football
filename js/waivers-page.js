// The waiver wire, read the one way it is actually useful: a week per column
// and a projection in every cell.
//
// ESPN's own "add players" screen answers a different question. It shows one
// week at a time behind twenty columns of ownership churn, so comparing two
// free agents over the run-in means clicking forward a week at a time and
// holding the numbers in your head. Everything here that is not a week number
// or a projection has been left out on purpose.
//
// THE COST IS THE DESIGN CONSTRAINT. ESPN publishes a per-week projection for
// every future week, but only for ONE week per request: the week comes from
// `scoringPeriodId`, and asking for a batch of weekly stat ids at once returns
// the current week and nothing else. That was tested against a real league
// rather than assumed (see the note over fetchFreeAgents in js/espn.js). So a
// thirteen-week table is thirteen requests, which is why this page:
//
//   - lets you choose how many weeks to price, and opens on three;
//   - renders the shell first and fills the columns in as each week lands;
//   - caches every week it has fetched, so the position filter is free.
//
// THE COMPARISON ROWS. A wire full of numbers still does not answer the only
// question worth asking — "is any of this better than what I already have?" —
// so your own worst player at each position is dropped into the SAME tbody,
// labelled "Your QB3", and sorts and filters alongside everyone else. That
// interleaving IS the answer: sort by Avg and the men above your row are the
// ones worth a claim. It costs a second request per week (rosters as well as
// free agents), cached the same way and keyed by the same week numbers.
//
// THE TAKEN TABLE is the other half of the league, in a second panel below:
// everyone who IS on a roster, priced over the same weeks, with the manager who
// holds him and where he ranks on that manager's squad. It answers a different
// question from the wire — not "who can I add" but "who has what" — so it is a
// separate table rather than more rows in the first one, and it carries
// NO GREEN BOX: the box argues for a claim, and nobody here can be claimed.
//
// ============================================================================
// THE RED/GREEN SCALE ON THIS PAGE, and the collision it had to be fitted round
// ============================================================================
//
// Tim, 2026-09-19b: "the coloring is good right now but it needs to be added to
// all the other places a number is referred to across the whole site." He had
// already named the exception himself — "unless it conflicts with something
// else we already have built" — and this page is where that exception bites
// hardest, because it is the one page with a green of its own.
//
// WHAT THE COLLISION WAS. `js/heat.js` owns a cell's BACKGROUND-IMAGE and its
// WEIGHT. `td.beats` — "this free agent out-projects your own worst man that
// week" — used to own the BACKGROUND with the `background` SHORTHAND, which
// reset `background-image` to none: a scale laid on the wire's week cells was
// erased on exactly the cells that carried the shading. So until 2026-10-08
// the wire's week cells carried no scale at all.
//
// WHERE THE SCALE IS NOW (Tim, 2026-10-08: colour every number that is a
// comparison), five places:
//
//   1. THE WIRE'S Avg COLUMN. Group: the other free agents AT HIS POSITION.
//   2. THE TAKEN TABLE'S Avg COLUMN, same group over the rostered pool.
//   3. THE TAKEN TABLE'S WEEK COLUMNS, one scale per position and week.
//   4. THE WIRE'S WEEK COLUMNS, the same way: a free agent's week against the
//      other free agents at his position in that week. THE GREEN BOX sits ON
//      TOP of it: "you would start him that week" (`lineupTest`) is a shade
//      (`background-color`, so the tint composes over it) WITH A RING round
//      the cell — see `td.beats` in waivers.html. It is the only claim cue:
//      the green NUMBER ("worth starting", a set bar per position) was removed
//      on 2026-10-09 — Tim: "3 different colorizers ... looks so messy".
//   5. THE Gain COLUMN, against the other gains in the column and anchored at
//      zero, so a plus is never red (`gainScale`).
//
// EVERY NUMBER OPENS A PREVIEW (js/pop.js, the site's stat card) that says
// what it is made of and which group it was measured against — "2nd of 17
// free-agent QBs" — so a column that runs green, grey, green when it is sorted
// by value explains itself. See "the previews" below.
//
// That table needs the weekly rosters whether or not a team is set as you, so
// the roster read is now unconditional and every week costs TWO requests. The
// cost line says so; understating it by half would be the one kind of dishonesty
// this page exists to avoid.

import { fetchSchedule, fetchWeeksRosters, fetchWireWeek } from './season.js';
// The namespace too, for `fetchByeWeeks`, read defensively: a season module
// (or a test stub) without it simply means the bye weeks are unknown.
import * as season from './season.js';
import * as espn from './espn.js';
// Only the zero rule — whether a 0.00 is a bye or a man ruled out — so this page
// and the analysis and Trade pages cannot answer it differently.
import { zeroKind, byeWeekOf, outMark } from './player-card.js';
// Only the glance line's markup (Avg · Proj · rank), drawn in the Actual row.
// This page no longer opens the hover card — see "the played weeks" below.
import { glanceHtml } from './player-card.js';
import { enableSort, resort } from './sortable.js';
// THE ONE RED/GREEN SCALE (js/heat.js, rule 14). Imported for the two Avg
// columns, both tables' week columns and Gain — see the block at the top of
// this file. `describeHeatPerColumn` rather than `describeHeat` because both
// tables here carry MANY scales, one per position, so there is no single pair
// of thresholds to put in a sentence; the per-position pairs are printed as a
// strip inside each table's "How to read this table" toggle instead, which is
// the same promise kept in points. THE STRIP IS IN THE TOGGLE AND NOT UNDER THE
// TABLE because it is method, not warning: `node tests/text-audit.mjs` scored
// this page at 299 visible words with it on screen against 106 without, and
// HANDOFF's panel shape is a small visible key over a full method behind the
// toggle. Deleting it was never an option — Tim checks numbers against ESPN by
// hand, and a threshold he cannot read is a colour he cannot check.
import { heatScale, heatOf, heatMarkHtml, describeHeatPerColumn, ordinal } from './heat.js';
import { savedConfig, onConnection, coarsePointer } from './connection.js';
// THE PREVIEWS (Tim, 2026-10-08): every number on this page opens the site's
// stat card, built when it is asked for — see "the previews" below.
import { wirePops, hidePop } from './pop.js';
import { teamHref, playerHref, weekHref } from './links.js';
// The preseason arrows by a name (Tim, 2026-09-30) — see js/proj-trend.js.
import * as trend from './proj-trend.js';
import { scope } from './prefs.js';
// The ONE definition of which weeks are the playoffs — the league's last
// regular week plus one per round — shared with the Schedule page's bracket.
import { playoffWeeks as leaguePlayoffWeeks } from './capture.js';
// THE Gain COLUMN: what adding a free agent is worth to your own lineup, priced
// by the Trade engine (js/waiver-gain.js). The two below it are how the Trade
// page reads the league's lineup slots, so both pages fill the same lineup.
import { gainBase, gainOf } from './waiver-gain.js';
import { slotsForLeague } from './trade.js';
// The site's one lineup solver, for the green box: would he make your lineup.
import { optimalLineup } from './forecast.js';
import { slotCountsFromLineups, projectionsFromWeekTeams } from './projection.js';
// A player's Value: points a week over what is free (docs/value-plan.md).
import * as value from './value.js';
// THE ANALYSIS PAGE'S "WHO TO START" BOX, above the free agents (Tim,
// 2026-10-09) — see "who to start" below. One renderer for both pages.
import * as starters from './who-to-start.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('waivers');

/**
 * How many available players to ask ESPN for, per week.
 *
 * The list comes back ordered by how widely owned each player is, which is the
 * order a waiver wire is worth reading in — so a limit is a cut off the bottom
 * of that order, not a random subset. A hundred is deep enough that every
 * position still has a bench behind it (the real spread at the top of the
 * order runs roughly QB 10 / RB 13 / WR 17 / TE 5 / K 7 / DST 8 per sixty) and
 * shallow enough to stay a table a person can scan.
 */
const POOL_LIMIT = 100;

/**
 * The week counts offered, and the one the page opens on.
 *
 * Three is the default because it is the horizon a waiver claim is actually
 * about — this week and the two you would hold him for — and because it is
 * three requests rather than thirteen on first paint. The other two are there
 * because a bye-week fill and a run-in stash are real questions too, and both
 * of them need more weeks than a claim does.
 */
const SPANS = ['3', '6', 'all'];
const SPAN_CHOICE = (v) => (SPANS.includes(String(v)) ? String(v) : '3');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
// Football's own order rather than the alphabet: sorting the position column
// should put the quarterbacks at one end, not the defenses.
const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i + 1]));

/**
 * FLEX IS A FILTER, NOT A POSITION.
 *
 * It is a button on the position controls that matches every running back,
 * receiver and tight end at once — the men who could fill a flex spot — because
 * "who can I put in the flex" is a question you ask of the wire constantly and
 * answering it otherwise meant pressing RB, then WR, then TE and holding three
 * lists in your head.
 *
 * It is deliberately NOT in POSITIONS and never in POS_ORDER, and no player's
 * own position changes when it is pressed. A tight end under a FLEX filter is
 * still a TE: still his
 * manager's TE2 in the taken table, still "Your TE3" on a comparison row. The
 * alternative — rewriting the Pos column to read FLEX while the button is
 * pressed — would turn a filter into a claim about the player, and the ranks
 * would become lies. So this constant is consulted in exactly
 * two places: whether a row survives the filter, and what the button's count is.
 */
const FLEX = 'FLEX';
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

/**
 * Everything a position button can be, in the order the buttons are drawn.
 *
 * FLEX sits after TE and before K because that is where a flex sits in a lineup:
 * the three positions it spans are the three immediately before it, so the
 * button reads as a summary of the run it follows rather than as a seventh
 * position dropped into the middle of the six.
 *
 * The list is also what a remembered filter is checked against. Both filters are
 * persisted, so a value from an older build of this page — or a hand-edited one
 * — can arrive from localStorage; anything not on this list falls back to ALL
 * rather than filtering the table down to nothing with no button lit to press
 * your way out of.
 */
const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', FLEX, 'K', 'DST'];
const FILTER_CHOICE = (v) => (FILTERS.includes(String(v)) ? String(v) : 'ALL');

/** What the two tables' numbers are shown as: ESPN's projection, or its Value. */
const SHOW_CHOICE = (v) => (v === 'value' ? 'value' : 'proj');

/**
 * The selected filter as a headline label — "WR", "RB/WR/TE".
 *
 * The stat strips read "Available WR" and "Taken QB", which works because every
 * other button IS a position. FLEX is not, and "Available FLEX" would be the
 * button's own token quoted back rather than a count of anything nameable, so it
 * is spelled out as the three positions it stands for. That is both shorter than
 * a sentence and more precise than the token.
 */
const filterLabel = (position) => (position === FLEX ? FLEX_POSITIONS.join('/') : position);

/**
 * The selected filter as a noun phrase that reads inside a sentence.
 *
 * The empty states interpolate this into prose — "No … is available in this
 * league right now" — and prose written for one position does not survive a
 * token that means three. DST has needed this treatment since the beginning ("No
 * DST is available" is not a sentence anybody says); FLEX needs more of it,
 * because a reader who has not pressed the button cannot be assumed to know what
 * it spans, and the empty state is the one moment the page has nothing else to
 * show him. Singular on purpose, so the sentences around it are unchanged.
 */
const filterNoun = (position) => {
  if (position === FLEX) return 'flex-eligible player (running back, receiver or tight end)';
  return position === 'DST' ? 'defense' : position;
};

const state = {
  source: prefs.get('source', 'demo'),
  isDemo: true,
  leagueName: '',
  seasonWeeks: [],          // every REGULAR-SEASON week the league plays
  // The playoff weeks, after the regular season (Tim, 2026-09-17: "show weeks
  // 15, 16, and 17 to represent the playoffs"). Shown after a heavy line,
  // priced by ESPN like any week, and kept OUT of every Avg — see avgOf().
  playoffWeeks: [],
  currentWeek: null,        // the week a claim made now would be for
  // proTeamId -> bye week. Empty = unknown, and then a live 0.00 reads as a bye
  // the way it always did. The sample wire carries its own `byeWeek` instead.
  byes: {},
  // The league's scoringItems, for the preseason arrows; null = unknown.
  scoring: null,
  // The schedule as read (live only), for a team card's record; null = none.
  schedule: null,
  span: SPAN_CHOICE(prefs.get('span', '3')),

  // A position filter PER TABLE. They were one filter driving both, which meant
  // narrowing the taken table to running backs was a scroll back up past a
  // hundred free agents to a control sitting in the other panel — and it
  // dragged the wire along with it, which is rarely what you wanted. They are
  // free (a repaint, never a request), so there is no reason to share one.
  //
  // The SPAN is deliberately still one setting for both: it is the request
  // budget, and both tables are priced over the same weeks. The taken panel
  // shows the same control rather than a second one, so the choice is reachable
  // from either end of the page without becoming two choices to spend.
  //
  // Both are read back through FILTER_CHOICE, so a saved FLEX comes back as
  // FLEX and a saved anything-else comes back as ALL rather than wedging the
  // page on a filter no button can turn off.
  position: FILTER_CHOICE(prefs.get('position', 'ALL')),
  takenPosition: FILTER_CHOICE(prefs.get('takenPosition', 'ALL')),

  // PROJ | VALUE (Tim, 2026-10-09 — see "player Value" below). One setting for
  // both tables, like the span, shown in both toolbars. It only ever takes
  // effect while the league's frozen lines are known (`value.base`).
  show: SHOW_CHOICE(prefs.get('show', 'proj')),
  // `base`: the frozen lines, or null (then the switch is hidden and the page
  // is what it was). `players`: js/season.js's every-rostered-man answer, with
  // the weeks left — asked for only once a row is open. `synced`: this is the
  // phone's synced copy, which buys nothing for a Value.
  value: { base: null, players: null, asked: false, synced: false },

  // The man a `?player=` link landed on. `settled` records that we have found
  // him once and already pointed the page at him, so a later repaint does not
  // keep yanking the filters back or re-scrolling under the reader.
  spotlight: null,
  settled: false,
  scrolled: false,
  // THE ACTUAL ROW (Tim, 2026-10-04): the one man whose drop-down row of real
  // scores is open, under his own row. One at a time for the page.
  open: null,
  // `&week=` on a player link: the played week whose two cells are boxed.
  boxWeek: null,

  // The cache. Fetching is keyed on the week and nothing else, so changing the
  // position filter — or narrowing the span and widening it again — never
  // costs a request.
  pool: new Map(),          // playerId -> identity (name, position, team, status)
  weekData: new Map(),      // week -> Map(playerId -> projection | null)
  failedWeeks: new Set(),   // weeks ESPN refused; named in the note, not hidden

  // Your own squad, cached the same way and keyed by the same week numbers, so
  // the position filter and re-sorting still cost nothing and widening the span
  // never re-buys a week already held.
  rosterWeeks: new Map(),        // week -> the teams array for that week
  rosterProj: new Map(),         // week -> Map(playerId -> projection | null)
  rosterStatus: new Map(),       // week -> Map(playerId -> injury status that week)
  failedRosterWeeks: new Set(),  // roster weeks ESPN refused; also named in the note
  // GAMES ALREADY OVER in a week ESPN has not closed (Tim, 2026-10-04). For a
  // man js/season.js marks `done`, the number in the maps above IS his score;
  // these keep what goes with it. week -> Map(playerId -> { actual, pregame }).
  weekDone: new Map(),           // the wire's
  rosterDone: new Map(),         // the rosters'
  demoTeamId: null,              // the demo league has no owner; a team stands in
  demoLadder: null,              // demo only: each position's season totals (demoGlance)
  // THE "YOUR TEAM" PICKER (Tim, 2026-10-02: "add a user selection for the
  // players menu, just like the other manus"). Null = nobody picked here, so
  // the connection's team (or the demo's stand-in) is you, as before.
  pickedTeamId: prefs.get('team', null),

  // GAIN (see "the Gain column" below). `key` names what the figures in `by`
  // were worked out for — league, team, weeks — and is '' while there is
  // nothing to work out (`why` then says which: 'team', 'weeks' or 'wait').
  // `queue` is the free agents still to price, taken a slice at a time after
  // the table has painted.
  gain: { key: '', why: 'team', weeks: [], base: null, by: new Map(), queue: [], timer: null },
  // The positional floor the Trade page prices with: one wire read per league.
  // `value` is undefined while it is in the air, null for none.
  gainFloors: { token: -1, value: undefined },
  // Whether the preseason copy has been read (or refused): until then nobody
  // knows if the arrows are about to buy the rest of the season.
  baselineSettled: false,

  // THE PLAYED WEEKS: the columns left of the heavy line, and the Actual row.
  // Kept apart from the maps above on purpose: those are the priced weeks (the
  // current week onwards) and what Avg and the colour scale are built from,
  // and a played week is never in either. Bought after the table has painted.
  playedWeeks: [],               // weeks FULLY over, from the schedule
  past: {
    wire: new Map(),             // week -> Map(playerId -> { projected, actual, injuryStatus })
    rosters: new Map(),          // week -> the same shape, from that week's rosters
    teams: new Map(),            // week -> that week's teams array, whole ("who to start")
    failed: new Set(),           // 'wire:2' / 'roster:2' — refused; drawn "—", never retried
    inFlight: new Set(),         // same keys, asked for and not yet back
  },

  // Everything already asked for, so nothing is asked twice. Keyed "wire:4" /
  // "roster:4" rather than by the bare week, because a week now costs two
  // different requests and one of them can be in the air without the other.
  inFlight: new Set(),

  // Guards a slow week landing after the source changed underneath it. It is
  // bumped ONLY when the league being read changes — widening the span must not
  // invalidate a request already in the air, because throwing that week away
  // just means paying for it again, and requests are the scarce thing here.
  token: 0,
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

const dash = '<span class="muted">—</span>';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "weeks 4–6" / "week 4" — an en dash, the way the rest of the site writes ranges. */
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

// ------------------------------------------------------------------ availability
//
// ESPN's injury status is the one piece of "the pile of columns" worth keeping:
// a projection does not say out loud that the player cannot play this week, and
// claiming someone on IR is a wasted move rather than a cheap one.

const INJURY = {
  OUT: { tag: 'OUT', cls: 'bad', dim: true, why: 'ESPN lists this player as out.' },
  INJURY_RESERVE: { tag: 'IR', cls: 'bad', dim: true, why: 'ESPN has this player on injured reserve.' },
  SUSPENSION: { tag: 'SUSP', cls: 'bad', dim: true, why: 'ESPN lists this player as suspended.' },
  DOUBTFUL: { tag: 'D', cls: 'warn', dim: false, why: 'ESPN lists this player as doubtful.' },
  QUESTIONABLE: { tag: 'Q', cls: 'warn', dim: false, why: 'ESPN lists this player as questionable.' },
  DAY_TO_DAY: { tag: 'DTD', cls: 'warn', dim: false, why: 'ESPN lists this player as day to day.' },
};

const availability = (status) => INJURY[status] || null;

// ------------------------------------------------------------------- demo pool
//
// There is no demo waiver wire in the repo, so this page carries its own. It is
// generated from a fixed seed: flicking to demo and back must not hand you a
// different set of players, and a table whose numbers move on their own reads
// as noise even when it is not.
//
// The players are invented on purpose. Plausible-looking real names in a demo
// pool are the one thing that could make somebody act on a number this page
// made up, and the panel note says so in as many words.

const DEMO_SEED = 20260909;
const DEMO_WEEKS = 13;
const DEMO_CURRENT_WEEK = 4;
// Friday 18 September 2026, midday UTC — a Friday in every timezone a reader
// of this site is likely to be in.
const DEMO_WAIVER_CLEARS = Date.UTC(2026, 8, 18, 12);

const DEMO_FIRST = ['Ash', 'Bryce', 'Cal', 'Dane', 'Elias', 'Finn', 'Gray', 'Hollis', 'Ike', 'Jory', 'Knox', 'Lem'];
const DEMO_LAST = [
  'Ardent', 'Bellweather', 'Cranmore', 'Dunhill', 'Everly', 'Fairbanks', 'Grimsby',
  'Hallow', 'Ingram', 'Jessop', 'Kestrel', 'Larkin', 'Mowbray', 'Nettles', 'Ovett',
  'Pike', 'Quarry', 'Rossiter', 'Stillwell', 'Thorne',
];

// Abbreviation and bye week. Real abbreviations, because the column is only
// there to tell two players apart and a made-up one would just look broken.
const DEMO_TEAMS = [
  ['BUF', 7], ['CIN', 10], ['DAL', 6], ['DEN', 12], ['GB', 5], ['KC', 6],
  ['MIA', 9], ['NYJ', 9], ['PHI', 5], ['SEA', 8], ['TB', 11], ['TEN', 10],
];

// Roughly the spread a real waiver wire has at the top of the ownership order.
const DEMO_PLAN = [['QB', 6], ['RB', 9], ['WR', 12], ['TE', 4], ['K', 4], ['DST', 5]];
// Nudged up from where these started so the best demo player at each position
// cleared the set "worth starting" bars of the time (QB 17, RB/WR 12, TE 9) in
// at least some weeks. Those bars and their green number went on 2026-10-09;
// the numbers stay, because every demo fixture is built on them.
const DEMO_BASE = { QB: 15, RB: 9.5, WR: 9.5, TE: 6.5, K: 7.5, DST: 6.5 };

/** A tiny LCG, so the pool is identical on every load and in every browser. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function generateDemoPool() {
  const rand = lcg(DEMO_SEED);
  const players = [];
  let i = 0;

  for (const [position, count] of DEMO_PLAN) {
    for (let k = 0; k < count; k++, i++) {
      const [proTeam, byeWeek] = DEMO_TEAMS[(i * 7) % DEMO_TEAMS.length];
      // Best of each position first, thinning out down the group, so the table
      // has a real top and a real bottom rather than forty similar players.
      const quality = 1.3 - 0.8 * (count === 1 ? 0 : k / (count - 1));
      const surname = DEMO_LAST[(i * 7) % DEMO_LAST.length];
      const name = position === 'DST'
        ? `${surname} Defense`
        : `${DEMO_FIRST[i % DEMO_FIRST.length]} ${surname}`;

      const noise = [];
      for (let w = 0; w < 20; w++) noise.push(0.82 + rand() * 0.36);

      players.push({
        playerId: 900000 + i,
        name,
        position,
        proTeam,
        proTeamId: null,
        byeWeek,
        injuryStatus: i === 4 ? 'OUT' : i === 12 ? 'INJURY_RESERVE' : i === 19 ? 'QUESTIONABLE' : 'ACTIVE',
        // Two men still on waivers, so the demo shows the W tag. A fixed
        // Friday rather than "now plus two days", so the sample never moves.
        status: i === 2 || i === 17 ? 'WAIVERS' : 'FREEAGENT',
        waiverClears: i === 2 || i === 17 ? DEMO_WAIVER_CLEARS : null,
        percentOwned: Math.round(46 * (quality / 1.3) * (0.35 + rand() * 0.65) * 10) / 10,
        base: DEMO_BASE[position] * quality,
        // The last player of each position group is the one ESPN sometimes
        // carries no number for at all — so the demo shows a blank cell and a
        // bye cell side by side, which is the distinction the note makes.
        fringe: k === count - 1,
        noise,
      });
    }
  }

  // ESPN hands the list back most-owned first; so does this.
  players.sort((a, b) => b.percentOwned - a.percentOwned || a.playerId - b.playerId);
  return players;
}

/**
 * One demo player's projection for one week.
 *
 * 0 for a bye and null for "no number at all", because those are the two things
 * live data does and the page renders them differently.
 */
function demoProjection(p, week) {
  if (week === p.byeWeek) return 0;
  if (p.fringe && (week === 4 || week === 9)) return null;
  return Math.round(p.base * p.noise[(week - 1) % p.noise.length] * 10) / 10;
}

/**
 * What an invented free agent "scored" in a played week of the sample season:
 * his projection, pushed up or down by a seeded draw. Invented like everything
 * else in the demo (the page says so); none for a bye or a week with no line.
 */
function demoActual(p, week) {
  const proj = demoProjection(p, week);
  if (proj === null || proj === 0) return null;
  const rand = lcg(DEMO_SEED + p.playerId * 31 + week * 7919);
  rand();
  return Math.round(proj * (0.4 + rand() * 1.2) * 10) / 10;
}

// -------------------------------------------------------------------- loading

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** Throw away every fetched week. Called when the league underneath changes. */
function resetData() {
  state.pool.clear();
  state.weekData.clear();
  state.failedWeeks.clear();
  state.rosterWeeks.clear();
  state.rosterProj.clear();
  state.rosterStatus.clear();
  state.weekDone.clear();
  state.rosterDone.clear();
  state.failedRosterWeeks.clear();
  state.demoTeamId = null;
  state.demoLadder = null;
  state.byes = {};
  state.scoring = null;
  state.schedule = null;
  state.playedWeeks = [];
  state.value = { base: null, players: null, asked: false, synced: false };
  state.past.wire.clear();
  state.past.rosters.clear();
  state.past.teams.clear();
  startRev++;
  state.past.failed.clear();
  state.past.inFlight.clear();
  // A linked man has to be looked for again in the league now being read: the
  // one just left may not have had him (a link opened before the league
  // connected lands on the sample data first).
  state.settled = false;
  state.scrolled = false;
  // Anything still in the air belongs to the league we just left; the token
  // bump drops it when it lands, and clearing this lets the new league ask for
  // the same week numbers straight away.
  state.inFlight.clear();
  state.token++;
}

async function loadDemo() {
  resetData();
  const token = state.token;

  state.isDemo = true;
  // ESPN's default rules for the preseason arrows. The demo's men are
  // invented, so none is in the preseason copy and no arrow is drawn here.
  state.scoring = trend.DEFAULT_PPR;
  state.leagueName = 'Demo League';
  state.seasonWeeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  // The sample season's own bracket weeks (14–16), by the same rule as live.
  state.playoffWeeks = leaguePlayoffWeeks({ weeks: state.seasonWeeks });
  state.currentWeek = DEMO_CURRENT_WEEK;
  // The sample pretends weeks 1-3 are played, so those are what its preview shows.
  state.playedWeeks = state.seasonWeeks.filter((w) => w < DEMO_CURRENT_WEEK);

  // No network, so there is nothing to stagger: fill every week at once and let
  // the same renderers draw it.
  for (const p of generateDemoPool()) {
    // The card's glance line: his sample season so far, ESPN-style — the mean
    // of the played weeks he has a score in. Rank waits for the sample squads
    // (demoWireRank), whose ladder he is slotted into.
    const scored = state.playedWeeks.map((w) => demoActual(p, w)).filter((v) => typeof v === 'number');
    p.demoTotal = Math.round(scored.reduce((a, b) => a + b, 0) * 10) / 10;
    p.seasonAvg = scored.length ? p.demoTotal / scored.length : null;
    state.pool.set(p.playerId, p);
    for (const w of allWeeks()) {
      if (!state.weekData.has(w)) state.weekData.set(w, new Map());
      state.weekData.get(w).set(p.playerId, demoProjection(p, w));
    }
    for (const w of state.playedWeeks) {
      if (!state.past.wire.has(w)) state.past.wire.set(w, new Map());
      state.past.wire.get(w).set(p.playerId, {
        projected: demoProjection(p, w), actual: demoActual(p, w), injuryStatus: p.injuryStatus,
      });
    }
  }

  if (token !== state.token) return;
  setStatus(
    `Generated sample data — invented players, invented projections, not your real league. ` +
    `The season is pretended to be at week ${DEMO_CURRENT_WEEK}.`
  );
  render();
  loadDemoRosters(token);
  loadValue(token);
}

/**
 * The squads the comparison rows come from, in demo mode.
 *
 * demo-rosters.js is loaded lazily and defensively: it is the only thing on
 * this page that needs it, live mode never does, and a missing or broken file
 * should cost the comparison rows and nothing else.
 *
 * The demo league has no owner, so the first team stands in for yours — the
 * same stand-in the schedule page's forecast panel makes when nobody is set as
 * you, and the note says so out loud rather than letting a stranger's bench
 * pass for your own.
 */
async function loadDemoRosters(token) {
  let generate = null;
  try {
    const mod = await import('./demo-rosters.js');
    if (typeof mod.generateDemoWeekRosters === 'function') generate = mod.generateDemoWeekRosters;
    if (token === state.token && typeof mod.demoGlance === 'function') state.demoLadder = mod.demoGlance().ladder;
  } catch { /* handled below, as a missing comparison rather than a broken page */ }

  if (token !== state.token) return;

  if (!generate) {
    for (const w of allWeeks()) state.failedRosterWeeks.add(w);
    render();
    return;
  }

  for (const w of allWeeks()) {
    try {
      const built = generate(w);
      // An older generator clamps a week past its season to its last one; a
      // week that comes back as another week is a gap, never borrowed numbers.
      if (!built || Number(built.week) !== Number(w)) throw new Error(`no demo week ${w}`);
      absorbRosterWeek(built.teams, w);
      if (state.playedWeeks.includes(w)) absorbPastRosters(built.teams, w);
    } catch {
      state.failedRosterWeeks.add(w);
      if (state.playedWeeks.includes(w)) state.past.failed.add(`roster:${w}`);
    }
  }
  const first = state.rosterWeeks.get(state.seasonWeeks[0]);
  state.demoTeamId = first && first.length ? first[0].id : null;
  render();
}

async function loadLive() {
  resetData();
  const token = state.token;

  const saved = savedConfig();
  if (!saved) {
    state.isDemo = false;
    setStatus('No league connected yet. Connect one in the bar above, or on the Connection page.', true);
    render();
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.isDemo = false;
  state.leagueName = 'Your league';
  setStatus('Reading your league…');
  render();

  // The bye weeks, alongside the schedule. They only decide how a 0.00 is
  // drawn, so a failure is an empty map and never an error on screen. When they
  // land, the table is repainted — a zero may turn from Bye into "0.0 OUT".
  if (typeof season.fetchByeWeeks === 'function') {
    Promise.resolve()
      .then(() => season.fetchByeWeeks())
      .then((byes) => {
        if (token !== state.token || !byes || typeof byes !== 'object') return;
        state.byes = byes;
        if (Object.keys(byes).length) render();
      })
      .catch(() => { /* unknown byes: the old reading stands */ });
  }

  // The league's own week list, so the columns are the weeks this league
  // actually plays rather than a guess at how long a season is. One request.
  try {
    const schedule = await fetchSchedule();
    if (token !== state.token) return;
    state.leagueName = schedule.leagueName || 'Your league';
    state.schedule = schedule;
    // The league's scoring rules, for the preseason arrows (js/proj-trend.js).
    state.scoring = Array.isArray(schedule.scoringItems) ? schedule.scoringItems : null;
    state.seasonWeeks = schedule.weeks.slice();
    state.playoffWeeks = leaguePlayoffWeeks(schedule);
    state.currentWeek = currentWeekOf(schedule);
    state.playedWeeks = playedWeeksOf(schedule);
  } catch (err) {
    if (token !== state.token) return;
    setStatus(
      `Could not read this league's schedule, so the weeks below are a guess ` +
      `at a full season. ${esc(err.message)}`,
      true
    );
    state.seasonWeeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
    // No schedule, so no playoff weeks: a guessed season is not also given a
    // guessed bracket.
    state.playoffWeeks = [];
    state.currentWeek = state.seasonWeeks[0];
  }

  if (!state.seasonWeeks.length) {
    setStatus(
      `Connected to ${esc(state.leagueName)}, but ESPN returned no weeks for this season. ` +
      `If the season hasn't started, try an earlier season on the Connection page.`,
      true
    );
    render();
    return;
  }

  render();
  refreshWeeks(token);
  loadValue(token);
}

/**
 * The week a claim made right now would be for: the first week NOT fully over.
 * Once the regular season is over it is the first playoff week still open, so
 * December still shows the bracket weeks ahead. A finished season falls back
 * to its last regular week, so the table always has somewhere to start rather
 * than going blank in January.
 */
function currentWeekOf(schedule) {
  const over = new Set(playedWeeksOf(schedule));
  const open = (schedule.weeks || []).find((w) => !over.has(w));
  if (open !== undefined) return open;
  const next = leaguePlayoffWeeks(schedule).find((w) => !over.has(w));
  if (next !== undefined) return next;
  return schedule.weeks[schedule.weeks.length - 1] ?? 1;
}

/**
 * The weeks FULLY over (Tim, 2026-10-04: "Only count a week as previous if the
 * week is fully over"): a regular week whose every game is decided, and a
 * playoff week whose every real game is — a bracket bye is never "played" by
 * ESPN, so byes are left out, as in capture.js's `playoffWeekDecided`. The
 * schedule's `played` is ESPN's own "decided", so a week in progress (Thursday
 * to Monday) is NOT in here and stays on the future side of the line.
 */
function playedWeeksOf(schedule) {
  const out = new Set();
  for (const w of schedule.weeks || []) {
    const games = schedule.byWeek.get(w) || [];
    if (games.length && games.every((g) => g.played)) out.add(w);
  }
  const bracket = new Map();   // playoff week -> every real game decided so far
  for (const g of schedule.playoffGames || []) {
    if (g.homeId == null || g.awayId == null) continue;
    bracket.set(g.week, (bracket.get(g.week) ?? true) && Boolean(g.played));
  }
  for (const [w, done] of bracket) if (done) out.add(w);
  return [...out].sort((x, y) => x - y);
}

// ---------------------------------------------------------------- week fetching

/** Every week a column can be: the regular season, then the playoff weeks. */
function allWeeks() {
  return [...new Set([...state.seasonWeeks, ...state.playoffWeeks])].sort((a, b) => a - b);
}

const isPlayoff = (w) => state.playoffWeeks.includes(w);

/**
 * The weeks the table is currently showing as columns.
 *
 * "Rest of season" runs through the last PLAYOFF week, and a fixed span that
 * reaches past the regular season carries on into the playoffs — it is the
 * same run of weeks, with a line where the bracket starts.
 */
function shownWeeks() {
  const every = allWeeks();
  const from = state.currentWeek ?? every[0];
  const rest = every.filter((w) => w >= from);
  const weeks = rest.length ? rest : every;
  if (state.span === 'all') return weeks;
  return weeks.slice(0, Number(state.span));
}

/**
 * Avg is a REGULAR-SEASON average. The playoff columns are shown for what they
 * are — per-week facts, green and shading included — but they are not averaged
 * in, so Avg, the Taken ranks and which of your men is the worst all stay
 * regular-season figures. With nothing but playoff weeks on screen (the
 * regular season is over) they are all there is, so they are what is averaged.
 */
function avgMask(weeks) {
  const regular = weeks.map((w) => !isPlayoff(w));
  return regular.some(Boolean) ? regular : weeks.map(() => true);
}

function avgOf(values, weeks) {
  const use = avgMask(weeks);
  return meanOf(values.filter((_, i) => use[i]));
}

/** The first playoff week among these columns — the one the line goes before. */
const firstPlayoffIn = (weeks) => weeks.find(isPlayoff);

/**
 * Put the playoff line on a week's cell: `po-start` on the first playoff
 * column, in every row, merged into whatever class the cell already has.
 */
function withPo(td, week, weeks) {
  return week === firstPlayoffIn(weeks) ? addClass(td, 'po-start') : td;
}

/** Merge a class into a cell's opening tag, whatever it already wears. */
function addClass(td, cls) {
  if (!cls) return td;
  return td.replace(/^<td(?: class="([^"]*)")?/, (m, c) => `<td class="${c ? `${c} ` : ''}${cls}"`);
}

/**
 * THE PREVIOUS WEEKS (Tim, 2026-10-04: "make the player's section show all
 * weeks, not just future weeks. However, make a thick line seperateing the
 * future and previous weeks"). Every week fully over that comes before the
 * first priced column, oldest first. They are extra columns to the LEFT of the
 * priced ones: the span control, Avg, the ranks and every colour scale are
 * still about `weeks` alone.
 */
function pastWeeks(weeks) {
  const from = weeks.length ? weeks[0] : Infinity;
  return state.playedWeeks.filter((w) => w < from);
}

/** The week a `&week=` link boxes, when it is one of the previous columns. */
const boxWeekIn = (past) => (past.includes(state.boxWeek) ? state.boxWeek : null);

/** A week's header: the number, and — for a playoff week — say so in words. */
function weekHead(w, weeks, { cls = '', title = '' } = {}) {
  // `weeks` is every column drawn, previous ones included, so the playoff line
  // falls on the first playoff week whichever side of today it is on.
  const po = isPlayoff(w);
  const start = w === firstPlayoffIn(weeks);
  const classes = [cls, start ? 'po-start' : ''].filter(Boolean).join(' ');
  const label = po
    ? `${w}${start ? '<span class="po-tag" aria-hidden="true">PO</span>' : ''}` +
      '<span class="sr-only"> (playoffs)</span>'
    : String(w);
  const why = po ? `${title} A playoff week: shown for reference, not counted in Avg.` : title;
  return `<th data-sort${classes ? ` class="${classes}"` : ''} title="${why}">${label}</th>`;
}

/** A week's wire is worth asking for: not held, not refused, not already in the air. */
const wantsWire = (w) =>
  !state.weekData.has(w) && !state.failedWeeks.has(w) && !state.inFlight.has(`wire:${w}`);

/**
 * The same test for that week's rosters.
 *
 * Unconditional now. It used to be gated on `comparing()`, because the only
 * thing rosters were for was your own "Your QB3" rows and there is no point
 * buying them when nobody is set as you. The Taken players table needs every
 * squad in the league whether or not one of them is yours, so the gate is gone
 * and the week's cost is two requests for everybody. The caching is untouched:
 * keyed on the week and nothing else.
 */
const wantsRoster = (w) =>
  !state.rosterWeeks.has(w) && !state.failedRosterWeeks.has(w) && !state.inFlight.has(`roster:${w}`);

/**
 * Fetch whatever the chosen span needs and does not already have, filling the
 * columns in as each week lands.
 *
 * Two weeks at a time rather than all at once: thirteen open sockets to ESPN is
 * rude and no faster, and a strict one-at-a-time makes the full season feel
 * slow. A week costs two requests — the wire and the rosters — and
 * they are tracked separately, so one failing loses only its half — a refused
 * roster week costs the Taken table that column and leaves the wire intact, and
 * the other way round. A request
 * ESPN refuses is remembered as failed rather than retried in a loop; the note
 * names it, and reloading is the way to try again.
 */
async function refreshWeeks(token) {
  if (state.isDemo) return;

  const missing = shownWeeks().filter((w) => wantsWire(w) || wantsRoster(w));
  if (!missing.length) {
    render();   // whatever is still in the air will repaint when it lands
    ensurePastWeeks();
    ensureTrendWeeks(token);
    ensureValueWeeks(token);
    return;
  }

  render();
  await fetchWeeks(missing, token);
  if (token !== state.token) return;

  const shown = shownWeeks();
  const got = shown.filter((w) => state.weekData.has(w)).length;
  const rosterGot = shown.filter((w) => state.rosterWeeks.has(w)).length;
  setStatus(
    `Loaded ${plural(state.pool.size, 'available player')} from ${esc(state.leagueName)} ` +
    `across ${plural(got, 'week')}, and every squad in the league for ` +
    `${plural(rosterGot, 'week')}.`
  );
  render();
  // Only now, with the table painted: the played weeks left of the line, then
  // the rest of the season, for the arrows.
  ensurePastWeeks();
  ensureTrendWeeks(token);
  ensureValueWeeks(token);
}

/**
 * Buy these weeks' wire and rosters, two weeks at a time, repainting as each
 * pair lands. Shared by the columns (`refreshWeeks`) and the arrows
 * (`ensureTrendWeeks`), so a week is only ever bought once whichever asked.
 */
async function fetchWeeks(missing, token) {
  for (let i = 0; i < missing.length; i += 2) {
    // Re-checked at the moment the requests are actually about to be spent, not
    // when the list was drawn up: another run started while this one was
    // awaiting may already have claimed one of these weeks.
    const batch = missing.slice(i, i + 2);
    const wire = batch.filter(wantsWire);
    const rosters = batch.filter(wantsRoster);
    if (!wire.length && !rosters.length) continue;

    wire.forEach((w) => state.inFlight.add(`wire:${w}`));
    rosters.forEach((w) => state.inFlight.add(`roster:${w}`));

    const jobs = wire.map(async (week) => {
      // Through season.js rather than straight at ESPN, so a phone reading the
      // copy his computer synced gets the wire too. It falls through to ESPN
      // when there is no cloud, which is every case that worked before.
      let players = null;
      let ok = false;
      try {
        players = await fetchWireWeek(week, POOL_LIMIT);
        ok = true;
      } catch {
        ok = false;
      }
      state.inFlight.delete(`wire:${week}`);

      // A response about a league we have already left is dropped here, before
      // it can repaint a table it is no longer about.
      if (token !== state.token) return;
      if (ok) absorbWeek(players, week);
      else state.failedWeeks.add(week);
    });

    if (rosters.length) {
      // fetchWeeksRosters swallows a week ESPN refuses — it simply comes back
      // absent — so a gap in the result is what marks a failed roster week.
      jobs.push((async () => {
        let got = new Map();
        try {
          got = await fetchWeeksRosters(rosters);
        } catch {
          got = new Map();
        }
        rosters.forEach((w) => state.inFlight.delete(`roster:${w}`));

        if (token !== state.token) return;
        for (const week of rosters) {
          if (got.has(week)) absorbRosterWeek(got.get(week), week);
          else state.failedRosterWeeks.add(week);
        }
      })());
    }

    await Promise.all(jobs);

    if (token !== state.token) return;
    render();
  }
}

// ------------------------------------------------------ the arrows' weeks
//
// THE ARROW IS REST OF SEASON, WHATEVER THE SPAN (manager's brief, 2026-09-30):
// Tim asked about the "rest-of-season proj/week", so "now" is the D7 average
// over EVERY regular-season week still to come, never the Next 3 / Next 6 the
// table happens to show. Under a short span those weeks are not on screen, so
// they are bought here — after the table has painted, only when somebody on
// the page is in the preseason copy (a league of men it has never heard of
// spends nothing), and through the same `fetchWeeks` as the columns, so a week
// is never bought twice and widening the span later costs nothing more. Rosters
// come out of js/store.js when this browser read them in the last six hours;
// the wire is one request a week (rule 3). Until every week is in, a man shows
// NO arrow rather than a span-based one that would then change.

/** The regular-season weeks still to come (the playoff weeks once there are none). */
function rosWeeks() {
  const every = allWeeks();
  const from = state.currentWeek ?? every[0];
  const rest = every.filter((w) => w >= from);
  const weeks = rest.length ? rest : every;
  const use = avgMask(weeks);
  return weeks.filter((_, i) => use[i]);
}

/** Whether the arrows could draw anything at all — the gate on buying weeks for them. */
function trendWorthLoading() {
  if (state.isDemo || !trend.ready() || !Array.isArray(state.scoring)) return false;
  for (const id of state.pool.keys()) if (trend.baselineOf(id, state.scoring)) return true;
  for (const byPlayer of state.rosterProj.values()) {
    for (const id of byPlayer.keys()) if (trend.baselineOf(id, state.scoring)) return true;
  }
  return false;
}

const trendLoading = (on) => {
  const t = $('waiverTable');
  if (!t) return;
  if (on) t.setAttribute('data-trend-loading', '');
  else t.removeAttribute('data-trend-loading');
};

async function ensureTrendWeeks(token) {
  if (!trendWorthLoading()) return;
  // After the columns, never alongside them: the table on screen comes first.
  if (shownWeeks().some((w) => state.inFlight.has(`wire:${w}`) || state.inFlight.has(`roster:${w}`))) return;
  const need = rosWeeks().filter((w) => wantsWire(w) || wantsRoster(w));
  if (!need.length) return;
  trendLoading(true);
  try {
    await fetchWeeks(need, token);
  } finally {
    if (token === state.token) {
      trendLoading(lateWeeksInFlight());
      render();
    }
  }
}

/** Whether a week bought after the table — for the arrows or a Value — is still in the air. */
const lateWeeksInFlight = () =>
  [...rosWeeks(), ...((state.value.players && state.value.players.weeks) || [])]
    .some((w) => state.inFlight.has(`wire:${w}`) || state.inFlight.has(`roster:${w}`));

// ---------------------------------------------------------------- player Value
//
// Tim, 2026-10-09: "I want it to be displayed at the top of the player's
// preview. Additionally for all graphs or charts that show avg position's proj
// or value or anything like that … have a switch for that graph that also shows
// the data as value rather than just total proj." The arithmetic is
// js/value.js; the frozen lines and every rostered man's Value are js/season.js.
//
// TWO THINGS HERE.
//   The switch (Proj | Value, both tables): every projection x on the page is
//     drawn as `valueOf(lines, his position, x)` — see `withShown`. It needs
//     the lines and nothing else, so pressing it never costs a request.
//   "Value 5.5" first on an open man's glance line: HIS Value, over every week
//     left. A rostered man's is js/season.js's. A free agent's is worked out
//     here from the wire weeks this page holds, and needs every week left.
//
// WHAT A FREE AGENT'S VALUE COSTS. Opening a man's row already shows the rest
// of his season (`jumpTo` sets the span to all), which is every week left — so
// in the ordinary case the weeks are bought by the columns and Value costs
// nothing more. `ensureValueWeeks` covers what is left over (a row still open
// after the span was narrowed and the league re-read): it buys only the missing
// weeks, through the same `fetchWeeks` as everything else, after the table.
// ON THE PHONE'S SYNCED COPY IT BUYS NOTHING (rule 20): a Value is worked out
// from the weeks the page already holds or printed "—".

/** The league's frozen lines, once per league read. Null leaves the page as it was. */
function loadValue(token) {
  if (typeof season.fetchValueBase !== 'function') return;
  Promise.resolve()
    .then(() => season.fetchValueBase({ demo: state.isDemo }))
    .then((base) => {
      if (token !== state.token || !value.isBase(base)) return;
      state.value.base = base;
      render();
    })
    .catch(() => { /* no lines: no switch, no Value */ });
}

/** Proj | Value is on Value, and there are lines to measure from. */
const valueOn = () => state.show === 'value' && state.value.base !== null;

/** A projection as its Value at his position; null when it cannot be said. */
const asValue = (p, x) => value.valueOf(state.value.base, p.position, x);

/**
 * Every rostered man's Value and the weeks left, asked for the first time a
 * row is open (the only thing on this page that shows a man's own Value).
 */
function ensurePlayerValues() {
  if (!state.value.base || state.value.asked || state.open === null) return;
  if (typeof season.fetchPlayerValues !== 'function') return;
  state.value.asked = true;
  const token = state.token;
  Promise.resolve()
    .then(() => season.fetchPlayerValues({ demo: state.isDemo }))
    .then((got) => {
      if (token !== state.token || !got || !Array.isArray(got.weeks)) return;
      state.value.players = got;
      render();
      ensureValueWeeks(token);
    })
    .catch(() => { /* no answer: the glance line stays as it was */ });
}

/** Is this the phone's synced copy? (js/season.js `cloudSource`; false when it cannot say.) */
async function onSyncedCopy() {
  if (typeof season.cloudSource !== 'function') return false;
  try {
    return Boolean(await season.cloudSource());
  } catch {
    return false;
  }
}

/** The wire weeks an open free agent's Value still needs — never on the synced copy. */
async function ensureValueWeeks(token) {
  if (state.isDemo || token !== state.token) return;
  const got = state.value.players;
  if (!state.value.base || !got || state.open === null || !state.pool.has(state.open)) return;
  if (!got.weeks.some(wantsWire)) return;
  if (await onSyncedCopy()) {
    if (token === state.token && !state.value.synced) {
      state.value.synced = true;
      render();
    }
    return;
  }
  if (token !== state.token) return;
  // After the columns, never alongside them, like the arrows' weeks.
  if (shownWeeks().some((w) => state.inFlight.has(`wire:${w}`) || state.inFlight.has(`roster:${w}`))) return;
  const need = got.weeks.filter(wantsWire);
  if (!need.length) return;
  trendLoading(true);
  try {
    await fetchWeeks(need, token);
  } finally {
    if (token === state.token) {
      trendLoading(lateWeeksInFlight());
      render();
    }
  }
}

/**
 * A FREE AGENT'S OWN VALUE: `valueOf` his average over the weeks left, his bye
 * left out (js/value.js `restAvg`). In a week under way a man who has played
 * counts at what ESPN projected, not what he scored — the site's one rule, so
 * his Value does not jump at kickoff.
 *
 *   a number   his Value
 *   undefined  not known YET: a week is still to be read (nothing is drawn)
 *   null       cannot be said: a week was refused, or will never be read here
 */
function wireValue(p) {
  const got = state.value.players;
  if (!state.value.base || !got) return undefined;
  if (!got.weeks.length) return null;
  const never = state.isDemo || state.value.synced;
  const byWeek = {};
  for (const w of got.weeks) {
    const v = valueFor(p.playerId, w);
    if (v === undefined) {
      if (never || state.failedWeeks.has(w)) return null;
      return undefined;
    }
    const done = doneFor(p.playerId, w, false);
    byWeek[w] = done ? done.pregame : v;
  }
  return asValue(p, value.restAvg(byWeek, got.weeks, byeWeekOf(p, state.byes)));
}

/** A rostered man's Value, from js/season.js: the same three answers as `wireValue`. */
function takenValue(p) {
  const got = state.value.players;
  if (!state.value.base || !got || typeof got.lookup !== 'function') return undefined;
  const v = got.lookup(p.playerId);
  return typeof v === 'number' ? v : null;
}

/**
 * THE GLANCE LINE, Value first (Tim: "displayed at the top of the player's
 * preview") — the shared card's own markup (`glanceHtml`, `span.tc-value`).
 * With no lines for this league it is the line it always was.
 */
function glanceLine(p, wire) {
  const glance = glanceFor(p, wire);
  if (!state.value.base) return glanceHtml(glance);
  const v = wire ? wireValue(p) : takenValue(p);
  if (v === undefined) return glanceHtml(glance);
  if (typeof v === 'number') return glanceHtml(glance, v);
  // Cannot be said: the word stays where it always is, with a dash.
  const lead = '<span class="tc-value">Value <b>—</b></span>';
  const rest = glanceHtml(glance);
  return rest
    ? rest.replace('<div class="tc-glance">', `<div class="tc-glance">${lead} · `)
    : `<div class="tc-glance">${lead}</div>`;
}

/**
 * WHAT EACH ROW SHOWS. On Proj, its projections and their Avg, as ever. On
 * Value, `shown[i]` is week i's projection as a Value — a number, or null when
 * it cannot be said — and `undefined` for a cell that is not a projection and
 * so stays as it is: a Bye, a 0.0, a blank, a week not read, and a game already
 * over (that number is a score). `shownAvg` is then the mean of the Values
 * shown over the weeks Avg always counted (the regular-season weeks projecting
 * above zero), to the tenth. Colour and sorting read these, so both follow the
 * number on screen.
 */
function withShown(rows, weeks) {
  const on = valueOn();
  const use = avgMask(weeks);
  for (const r of rows) {
    if (!on) {
      r.shown = r.values;
      r.shownAvg = r.avg;
      continue;
    }
    r.shown = r.values.map((v, i) =>
      (measurable(v) && !(r.done && r.done[i]) ? asValue(r.p, v) : undefined));
    let sum = 0;
    let n = 0;
    r.shown.forEach((s, i) => {
      if (!use[i] || typeof s !== 'number' || !(r.values[i] > 0)) return;
      sum += s;
      n++;
    });
    r.shownAvg = n ? Math.round((sum / n) * 10) / 10 : null;
  }
  return rows;
}

/** Week i of a row as the colour scale takes it: the number shown, or null for none. */
function scaleNumber(r, i) {
  if (valueOn()) return typeof r.shown[i] === 'number' ? r.shown[i] : null;
  // A game already over is a score, not a projection: it is left out, so the
  // scale compares the men still to play with each other.
  return measurable(r.values[i]) && !(r.done && r.done[i]) ? r.values[i] : null;
}

/** What Value is, said in both tables' notes (rule 7) — only while there are lines. */
const VALUE_NOTE = () =>
  lead('Value') +
  'Points a week over the waiver line at his position; points below the starter line count ' +
  'half, and both lines are fixed for the season. On Value, each projection is shown that way ' +
  'and Avg is the mean of them; a score stays a score.';

/**
 * His rest-of-season per week: the D7 mean over `rosWeeks()`, read from the
 * wire (a free agent) or the rosters (a rostered man). Null until every one of
 * those weeks has been read — and for good if one was refused, since an
 * average over fewer weeks than it names is not the figure the words claim.
 */
function rosNow(p, rostered) {
  const weeks = rosWeeks();
  if (!weeks.length) return null;
  const read = rostered ? rosterValueFor : valueFor;
  const values = weeks.map((w) => read(p.playerId, w));
  if (values.some((v) => v === undefined)) return null;
  return meanOf(values);
}

/**
 * How far through the weeks on screen we are, derived from the cache rather
 * than counted by the loop — so two overlapping loads (widen the span while the
 * first three weeks are still arriving) report one honest number between them.
 */
function progressText() {
  if (state.isDemo) return '';
  const wanted = shownWeeks();
  // A week is done when BOTH halves of it are — the wire and that week's
  // rosters. Both are always bought now, so both always count.
  const pending = wanted.filter(
    (w) =>
      (!state.weekData.has(w) && !state.failedWeeks.has(w)) ||
      (!state.rosterWeeks.has(w) && !state.failedRosterWeeks.has(w))
  );
  if (!pending.length) return '';
  return `Reading ESPN’s weekly projections… week ${wanted.length - pending.length} of ${wanted.length}.`;
}

/**
 * Merge one week's wire into the cache, keyed by playerId.
 *
 * Takes PARSED players now, not ESPN's raw payload. The parse moved into
 * `js/season.js`'s `fetchWireWeek` so this page could stop being the one that
 * talks to ESPN directly — which was what left it as the only page the cloud
 * substitution could not reach. On a phone its Taken half worked from the
 * synced rosters while the wire above it, the half the page is named for, had
 * nothing at all. `espn.parseFreeAgent` is pure, so moving where it is called
 * changed no number here.
 */
function absorbWeek(players, week) {
  const byPlayer = new Map();
  const done = new Map();

  for (const p of players || []) {
    if (p.playerId === null || p.playerId === undefined) continue;

    const known = state.pool.get(p.playerId);
    if (!known) {
      state.pool.set(p.playerId, {
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        proTeam: p.proTeam,
        proTeamId: p.proTeamId,
        injuryStatus: p.injuryStatus,
        percentOwned: p.percentOwned,
        seasonProjected: p.seasonProjected,
        // On waivers or a free agent — a fact about NOW, the same in every
        // week's payload. null is "ESPN did not say", never "free agent".
        status: p.status ?? null,
        waiverClears: p.waiverClears ?? null,
        // ESPN's season average and position rank (the card's glance line).
        seasonAvg: typeof p.seasonAvg === 'number' ? p.seasonAvg : null,
        posRank: typeof p.posRank === 'number' ? p.posRank : null,
      });
    } else {
      if (typeof p.seasonAvg === 'number') known.seasonAvg = p.seasonAvg;
      if (typeof p.posRank === 'number') known.posRank = p.posRank;
      // The same player comes back in every week's payload. Later weeks carry
      // the fresher injury status and ownership, so let them win; the ordering
      // of the list itself is not assumed to be identical week to week, which
      // is exactly why this merges on playerId rather than on position.
      known.injuryStatus = p.injuryStatus;
      if (p.status !== undefined && p.status !== null) {
        known.status = p.status;
        known.waiverClears = p.waiverClears ?? null;
      }
      if (p.percentOwned !== null) known.percentOwned = p.percentOwned;
      if (p.seasonProjected !== null) known.seasonProjected = p.seasonProjected;
    }

    byPlayer.set(p.playerId, p.projected);
    const over = doneEntry(p);
    if (over) done.set(p.playerId, over);
  }

  state.weekData.set(week, byPlayer);
  state.weekDone.set(week, done);
}

// ------------------------------------------------- a game that is already over
//
// A WEEK IN PROGRESS IS STILL A PRICED WEEK — the first column right of the
// heavy line — but some of its NFL games are finished (Tim, 2026-10-04: "for
// singular player's that have finished their game, their numbers are
// individually updated"). js/season.js says which: on a week ESPN has not
// marked final a man carries `done: true` once his game is over, with
// `pregame` = the projection as it was and `projected` OVERWRITTEN with what he
// scored. So every number this page derives from the week — Avg, the ranks,
// "your worst", the arrows, the glance line — is built on the score without
// being told. What is kept here is only what DRAWING it needs: that the number
// is a fact, and the forecast it replaced.
//
// Final weeks and the sample data carry no `done` at all, and then both maps
// stay empty and nothing below changes a cell.

/** What a finished man's week keeps beside its number, or null. */
function doneEntry(p) {
  if (p.done !== true) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { actual: num(p.actual), pregame: num(p.pregame) };
}

/** His finished game in that week — `{ actual, pregame }` — or null. */
function doneFor(playerId, week, roster) {
  const forWeek = (roster ? state.rosterDone : state.weekDone).get(week);
  return (forWeek && forWeek.get(playerId)) || null;
}

/** Whether anybody on the page has a finished game in a week still open. */
const anyDone = () =>
  [...state.weekDone.values(), ...state.rosterDone.values()].some((m) => m.size > 0);

/**
 * `done` is also what season.js says of a man with NO game that week, and his
 * 0 is a bye, not a score. The site's one zero rule decides (js/player-card.js)
 * — except that a man ESPN was projecting above zero had a game, whatever the
 * bye table says (or when there is none to ask).
 */
function doneIsBye(v, week, p, roster, done) {
  if (v !== 0 || (done.pregame !== null && done.pregame > 0)) return false;
  return zeroKind(v, {
    week, byeWeek: byeWeekOf(p, state.byes), injuryStatus: null, demo: roster && state.isDemo,
  }) === 'bye';
}

/**
 * A FINISHED GAME'S CELL: what he scored, drawn plain like the weeks left of
 * the line. No scale, no green, no shade, no OUT — each of those is a claim
 * about a game still to come. `data-done` is the hook (no class: nothing is
 * styled, and a `td.zero` would light the "projected at zero" key).
 */
function doneCell(v, done) {
  const was = done.pregame === null ? '' : ` (projected ${fmt(done.pregame)})`;
  // A zero is out of Avg whether projected or scored (D7) — said, not silent.
  const zero = v === 0 ? ' — like any zero, left out of Avg' : '';
  return `<td data-v="${v}" data-done title="Final: scored ${fmt(v)}${was}${zero}">${fmt(v)}</td>`;
}

/**
 * Merge one week's rosters into the cache.
 *
 * The whole teams array is kept, not just yours, for two reasons. Changing who
 * "you" are in the connection bar then costs a repaint rather than a refetch.
 * And a man you hold in week 4 can be somebody else's by week 9 — his week 9
 * projection is still the number you are comparing against, so the per-week
 * index is built across every team rather than only your own.
 */
function absorbRosterWeek(teams, week) {
  state.rosterWeeks.set(week, teams);
  startRev++;

  const byPlayer = new Map();
  const status = new Map();
  const done = new Map();
  for (const team of teams || []) {
    for (const p of team.players || []) {
      if (p.playerId === null || p.playerId === undefined) continue;
      byPlayer.set(p.playerId, p.projected);
      status.set(p.playerId, p.injuryStatus || null);
      const over = doneEntry(p);
      if (over) done.set(p.playerId, over);
    }
  }
  state.rosterProj.set(week, byPlayer);
  state.rosterDone.set(week, done);
  state.rosterStatus.set(week, status);
}

/**
 * His injury status in that week's roster payload. A zero is judged by who he
 * was THAT week: the sample squads rule a man out week by week, and the row's
 * own status is only the one from the week that row was anchored on.
 */
function rosterStatusFor(p, week) {
  const byWeek = state.rosterStatus.get(week);
  const s = byWeek ? byWeek.get(p.playerId) : null;
  return s || p.injuryStatus || null;
}

// ------------------------------------------------------------ the played weeks
//
// EVERY WEEK FULLY OVER IS A COLUMN, left of a heavy line, showing what ESPN
// projected for it; a man's ACTUAL scores are a row of their own under his,
// opened by clicking his name (Tim, 2026-10-04 — it replaced the hover card,
// which showed the same two things only while the pointer rested on a name).
//
// WHERE A PLAYED WEEK'S PROJECTION COMES FROM, measured rather than assumed.
// Rule 8 says ESPN keeps no HISTORY of its projections — ask it in week 9 what
// it thought of week 13 back in week 2 and the number is gone. That is about
// revisions of a future week. A week that has been PLAYED is different: read
// for that week (scoringPeriodId), both the roster read and the free-agent read
// still carry the week's projection (statSourceId 1) beside the actual
// (statSourceId 0). Checked on public league 1241838 on 2026-09-29, in week 4:
// every man on a week-1 roster and all 100 week-1 free agents had both. A week
// ESPN carried nothing for prints "—".
//
// WHICH READ, AND WHAT IT COSTS. A man in the Taken table (or your own "Your …"
// row) is read off that week's ROSTERS; a free agent off that week's WIRE — the
// free-agent list for a past week is today's free agents (same 100 men, same
// order, measured the same day), so every man on this wire is on it. One read
// per played week per kind (rule 3 — there is no bulk form), bought once per
// page load, AFTER the priced weeks have painted. Rosters go through
// `fetchWeeksRosters`, whose store keeps a played week for the season (rule
// 15), so on a later visit they are free. A rostered man who was a free agent
// in an early week (or the other way round) is not in that week's read, and
// prints "—" for it.

/** One played week of the wire, kept for the preview. */
function absorbPastWire(players, week) {
  const byPlayer = new Map();
  for (const p of players || []) {
    if (p.playerId === null || p.playerId === undefined) continue;
    byPlayer.set(p.playerId, {
      projected: p.projected ?? null,
      // A wire synced before the parse kept actuals has none: unknown, not 0.
      actual: typeof p.actual === 'number' ? p.actual : null,
      injuryStatus: p.injuryStatus || null,
    });
  }
  state.past.wire.set(week, byPlayer);
}

/** One played week of every roster, kept for the preview. */
function absorbPastRosters(teams, week) {
  const byPlayer = new Map();
  for (const team of teams || []) {
    for (const p of team.players || []) {
      if (p.playerId === null || p.playerId === undefined) continue;
      byPlayer.set(p.playerId, {
        projected: p.projected ?? null,
        actual: typeof p.actual === 'number' ? p.actual : null,
        injuryStatus: p.injuryStatus || null,
      });
    }
  }
  state.past.rosters.set(week, byPlayer);
  // The whole squads too: "who to start" marks each played week's real lineup.
  state.past.teams.set(week, teams || []);
  startRev++;
}

/** Both kinds of played week, once each — the columns need them on every visit. */
function ensurePastWeeks() {
  ensurePast(true);
  ensurePast(false);
}

/**
 * Buy the played weeks one kind of row needs, once. `wire` = a free agent
 * (the wire read), otherwise a rostered man (the roster read). Repaints as
 * weeks land.
 */
async function ensurePast(wire) {
  if (state.isDemo || !state.playedWeeks.length) return;
  const token = state.token;
  const kind = wire ? 'wire' : 'roster';
  const held = wire ? state.past.wire : state.past.rosters;
  const need = state.playedWeeks.filter((w) =>
    !held.has(w) && !state.past.failed.has(`${kind}:${w}`) && !state.past.inFlight.has(`${kind}:${w}`));
  if (!need.length) return;
  need.forEach((w) => state.past.inFlight.add(`${kind}:${w}`));

  if (!wire) {
    let got = new Map();
    try {
      got = await fetchWeeksRosters(need);
    } catch {
      got = new Map();
    }
    need.forEach((w) => state.past.inFlight.delete(`roster:${w}`));
    if (token !== state.token) return;
    for (const w of need) {
      if (got.has(w)) absorbPastRosters(got.get(w), w);
      else state.past.failed.add(`roster:${w}`);
    }
    render();
    return;
  }

  // Two weeks at a time, like the columns: polite to ESPN, and the card fills
  // in as they land.
  for (let i = 0; i < need.length; i += 2) {
    await Promise.all(need.slice(i, i + 2).map(async (w) => {
      let players = null;
      try {
        players = await fetchWireWeek(w, POOL_LIMIT);
      } catch {
        players = null;
      }
      state.past.inFlight.delete(`wire:${w}`);
      if (token !== state.token) return;
      if (players) absorbPastWire(players, w);
      else state.past.failed.add(`wire:${w}`);
    }));
    if (token !== state.token) return;
    render();
  }
}

/**
 * One man in one played week, in the four states a cell can be:
 *   { projected, actual, status }  a read has him
 *   'wait'                         that week has not been read yet
 *   'failed'                       ESPN refused it
 *   null                           read, and he was not in it
 */
function pastOf(p, week, wire) {
  const kind = wire ? 'wire' : 'roster';
  const own = wire ? state.past.wire : state.past.rosters;
  // Either read will do when it has him — a week's projection and score are
  // facts about the man, not about whose roster he was on.
  const at = (m) => (m.get(week) && m.get(week).get(p.playerId)) || null;
  const hit = at(own) || at(state.past.rosters) || at(state.past.wire);
  if (hit) {
    return {
      projected: hit.projected ?? null,
      actual: typeof hit.actual === 'number' ? hit.actual : null,
      status: hit.injuryStatus || p.injuryStatus || null,
    };
  }
  if (state.past.failed.has(`${kind}:${week}`)) return 'failed';
  return own.has(week) ? null : 'wait';
}

/** The two no-number states every played-week cell shares, or '' for a real one. */
function pastGapCell(got, week) {
  if (got === 'wait') {
    return `<td class="wait" title="Week ${week} has not been read from ESPN yet.">·</td>`;
  }
  if (got === 'failed') {
    return `<td class="muted" title="ESPN refused week ${week}. Reload the page to try again.">${dash}</td>`;
  }
  return '';
}

/**
 * A PREVIOUS week's cell in a man's own row: what ESPN PROJECTED for it. Plain
 * on purpose — no green, no shading, no scale: all three are about a claim or a
 * comparison over the priced weeks, and a week that is over is neither.
 */
function pastCell(p, week, wire) {
  const got = pastOf(p, week, wire);
  const gap = pastGapCell(got, week);
  if (gap) return gap;
  const v = got ? got.projected : null;
  if (typeof v !== 'number') {
    return `<td title="ESPN kept no week ${week} projection for ${esc(p.name)}.">${dash}</td>`;
  }
  if (v === 0) {
    // The same zero rule as the priced weeks (js/player-card.js).
    const zero = zeroKind(v, {
      week, byeWeek: byeWeekOf(p, state.byes), injuryStatus: got.status, demo: !wire && state.isDemo,
    });
    if (zero === 'bye') {
      return `<td class="bye" data-v="0" title="${esc(p.name)} was on bye in week ${week}.">Bye</td>`;
    }
    if (zero === 'out') {
      return `<td class="zero-out" data-v="0" title="${esc(p.name)} was projected at 0.0 in week ${week}.">0.0 ` +
        `<span class="zmark">${esc(outMark(got.status))}</span></td>`;
    }
    return `<td class="zero" data-v="0" title="${esc(p.name)} was projected at 0.0 in week ${week}.">0.0</td>`;
  }
  // A real number: the preview says what he scored against it, and its click
  // is that week on the Schedule page (`playedCard`). No `title` beside a card.
  // On Value it is that projection's Value, like the weeks to its right.
  const n = valueOn() ? asValue(p, v) : v;
  if (n === null) {
    return `<td title="No Value can be said at ${esc(p.position)}.">${dash}</td>`;
  }
  return `<td data-v="${n}" data-c="past" data-go data-w="${week}">${fmt(n)}</td>`;
}

/** The same week in his Actual row: what he SCORED. */
function actualCell(p, week, wire) {
  const got = pastOf(p, week, wire);
  const gap = pastGapCell(got, week);
  if (gap) return gap;
  const a = got ? got.actual : null;
  if (typeof a !== 'number') {
    return `<td title="ESPN has no week ${week} score for ${esc(p.name)}.">${dash}</td>`;
  }
  return `<td data-c="act" data-go data-w="${week}">${fmt(a)}</td>`;
}

/**
 * A row's week cells: the previous weeks, the heavy line, then the priced
 * weeks. `future(i)` draws priced week i. `spot` is the row a `&week=` link
 * boxes its week on.
 */
function weekCells(p, weeks, wire, spot, future) {
  const past = pastWeeks(weeks);
  const every = [...past, ...weeks];
  const box = spot ? boxWeekIn(past) : null;
  return past.map((w) =>
    withPo(addClass(pastCell(p, w, wire), `wk-past${w === box ? ' wk-box' : ''}`), w, every)).join('') +
    weeks.map((w, i) =>
      withPo(addClass(future(i), i === 0 && past.length ? 'fut-start' : ''), w, every)).join('');
}

/**
 * THE ACTUAL ROW: one extra row under the selected man, his real score under
 * each previous week and nothing under the weeks to come. The same number of
 * cells as the row above it, so no column moves when it opens; `data-sort-child`
 * is what makes js/sortable.js carry it along under him instead of sorting it.
 * `lead` is how many columns sit between the name and the weeks; they hold the
 * glance line (ESPN's Avg · Proj · rank), which used to head the hover card.
 */
function actualRow(p, weeks, wire, lead) {
  const past = pastWeeks(weeks);
  const every = [...past, ...weeks];
  const box = boxWeekIn(past);
  return `<tr class="act-row" data-sort-child data-actual-for="${esc(p.playerId)}">
      <td class="name">Actual</td>
      <td class="left act-glance" colspan="${lead}">${glanceLine(p, wire)}</td>
      ${past.map((w) =>
        withPo(addClass(actualCell(p, w, wire), `wk-past${w === box ? ' wk-box' : ''}`), w, every)).join('')}
      ${weeks.map((w, i) =>
        withPo(addClass(actualDoneCell(p, w, wire), i === 0 && past.length ? 'fut-start' : ''), w, every)).join('')}
    </tr>`;
}

/**
 * A priced week in his Actual row: empty — it has not been played — unless his
 * own game that week is already over, and then what he scored.
 */
function actualDoneCell(p, week, wire) {
  const done = doneFor(p.playerId, week, !wire);
  if (!done) return '<td></td>';
  const v = wire ? valueFor(p.playerId, week) : rosterValueFor(p.playerId, week);
  const a = done.actual !== null ? done.actual : v;
  if (typeof a !== 'number' || doneIsBye(v, week, p, !wire, done)) return '<td></td>';
  return `<td data-done title="What ${esc(p.name)} scored in week ${week}.">${fmt(a)}</td>`;
}

/** His Actual row, when he is the one open; '' otherwise. */
const actualRowIf = (p, weeks, wire, lead) =>
  (state.open !== null && p.playerId === state.open ? actualRow(p, weeks, wire, lead) : '');

/**
 * THE GLANCE LINE in a man's Actual row (Tim, 2026-10-02): ESPN's season
 * average, his projection for THIS week (`state.currentWeek`, the first week
 * not yet final) and his position rank — what other managers see in ESPN's
 * app. A free agent's come off the wire (`state.pool`), a rostered man's off
 * this week's rosters, else the latest other roster week carrying them.
 *
 * On the demo, the wire's men are this page's own invention: Avg is the mean
 * of their sample scores so far, and the rank slots them into the sample
 * squads' own ladder (`demoGlance` in js/demo-rosters.js), so a rostered man's
 * rank here is the one the Trade and Analysis pages show.
 */
function glanceFor(p, wire) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const now = state.currentWeek;
  if (wire) {
    const known = state.pool.get(p.playerId) || p;
    const v = now === null || now === undefined ? undefined : valueFor(p.playerId, now);
    return {
      avg: num(known.seasonAvg),
      proj: num(v),
      rank: num(known.posRank) ?? demoWireRank(known),
      pos: p.position,
    };
  }
  const find = (teams) => {
    for (const t of teams || []) {
      for (const x of t.players || []) if (x.playerId === p.playerId) return x;
    }
    return null;
  };
  const here = find(state.rosterWeeks.get(now));
  let avg = num(here?.seasonAvg);
  let rank = num(here?.posRank);
  if (avg === null || rank === null) {
    for (const w of [...state.rosterWeeks.keys()].sort((a, b) => b - a)) {
      const x = find(state.rosterWeeks.get(w));
      if (!x) continue;
      if (avg === null) avg = num(x.seasonAvg);
      if (rank === null) rank = num(x.posRank);
      if (avg !== null && rank !== null) break;
    }
  }
  const v = rosterValueFor(p.playerId, now);
  return {
    avg: avg ?? num(p.seasonAvg),
    proj: num(v),
    rank: rank ?? num(p.posRank),
    pos: p.position,
  };
}

/** A sample free agent's place in the sample squads' ladder at his position. */
function demoWireRank(p) {
  if (!state.isDemo || !state.demoLadder || typeof p.demoTotal !== 'number') return null;
  const ladder = state.demoLadder[p.position];
  if (!ladder) return null;
  let above = ladder.filter((t) => t > p.demoTotal).length;
  for (const q of state.pool.values()) {
    if (q !== p && q.position === p.position && typeof q.demoTotal === 'number' &&
        (q.demoTotal > p.demoTotal || (q.demoTotal === p.demoTotal && q.playerId < p.playerId))) above++;
  }
  return above + 1;
}

// ---------------------------------------------------------------------- rows

/**
 * One player's projection for one week, in three distinguishable states:
 *   undefined  the week has not been fetched yet
 *   null       ESPN's list carried no number for him that week
 *   0          his NFL team is on bye — ESPN's own way of saying so
 */
function valueFor(playerId, week) {
  const forWeek = state.weekData.get(week);
  if (!forWeek) return undefined;
  const v = forWeek.get(playerId);
  return v === undefined ? null : v;
}

/**
 * Every row the table could show, with the mean of the weeks on screen.
 *
 * The average is DERIVED — ESPN publishes no such number — and it exists
 * because a column per week has no single "who is best" ordering without one.
 * It is the mean of the weeks that project above zero — see meanOf() for why a
 * bye, a ruled-out zero and a blank week are all left out.
 */
/** A row's finished games, parallel to its `values`: an entry or null per week. */
const doneRun = (p, weeks, roster) => weeks.map((w) => doneFor(p.playerId, w, roster));

function buildRows(weeks) {
  const rows = [];
  for (const p of state.pool.values()) {
    const values = weeks.map((w) => valueFor(p.playerId, w));
    const real = values.filter((v) => typeof v === 'number');
    rows.push({ p, values, done: doneRun(p, weeks, false), avg: avgOf(values, weeks), counted: real.length });
  }
  return rows;
}

/**
 * Does this row survive a position filter? Each table passes its own.
 *
 * The FLEX branch is the whole of what FLEX does. It reads the player's real
 * position and answers whether a flex spot would take him; it does not write
 * anything back, which is why nothing downstream — the Pos column, the rank
 * beside it, the green box, the "Your QB3" label — has to know this button
 * exists.
 */
const matches = (row, position) => {
  if (position === 'ALL') return true;
  if (position === FLEX) return FLEX_POSITIONS.includes(row.p.position);
  return row.p.position === position;
};

/** The wire's filter, which the comparison rows share — they are one table. */
const matchesFilter = (row) => matches(row, state.position);

/** The taken table's own, entirely independent of the wire's. */
const matchesTaken = (row) => matches(row, state.takenPosition);

// ------------------------------------------------------- the comparison rows

/**
 * Whose squad the "Your …" rows are, or null if there is nobody to be.
 *
 * Never localStorage directly: `savedConfig()` is the one reader of that key,
 * and going round it was a real bug once.
 */
function myTeamId() {
  // A team picked on this page wins, while it is a squad in the league loaded.
  const picked = state.pickedTeamId;
  if (picked !== null && leagueTeams().some((t) => String(t.id) === String(picked))) {
    return leagueTeams().find((t) => String(t.id) === String(picked)).id;
  }
  if (state.isDemo) return state.demoTeamId;
  const saved = savedConfig();
  const id = saved ? saved.teamId : null;
  return id === null || id === undefined ? null : Number(id);
}

/** The league's squads as `{id, name}`, off the first roster week held; [] until one lands. */
function leagueTeams() {
  for (const w of state.seasonWeeks || []) {
    const teams = state.rosterWeeks.get(w);
    if (teams && teams.length) return teams.map((t) => ({ id: t.id, name: t.name }));
  }
  const any = state.rosterWeeks.values().next().value;
  return any ? any.map((t) => ({ id: t.id, name: t.name })) : [];
}

/** The picker, filled from the league's squads; hidden until there are any. */
function renderTeamPicker() {
  const teams = leagueTeams();
  const box = $('teamPick');
  const sel = $('teamSelect');
  box.hidden = !teams.length;
  if (!teams.length) { sel.innerHTML = ''; return; }
  const want = String(myTeamId() ?? '');
  // Nobody is "you" yet: say so, in the connection bar's words, rather than
  // show the first team as if it had been chosen.
  const html = (want ? '' : '<option value="" selected>choose your team…</option>') + teams
    .map((t) => `<option value="${esc(t.id)}"${String(t.id) === want ? ' selected' : ''}>${esc(t.name || `Team ${t.id}`)}</option>`)
    .join('');
  if (sel.innerHTML !== html) sel.innerHTML = html;
  if (sel.value !== want) sel.value = want;
}

/** Whether the comparison rows can exist at all. Drives the extra request too. */
const comparing = () => myTeamId() !== null;

/**
 * A rostered player's projection for one week — the same three states as the
 * wire, read out of the roster payload rather than the free-agent list. Used by
 * the comparison rows and by the Taken players table, which is why it is no
 * longer named after "yours".
 */
function rosterValueFor(playerId, week) {
  const forWeek = state.rosterProj.get(week);
  if (!forWeek) return undefined;
  const v = forWeek.get(playerId);
  return v === undefined ? null : v;
}

/**
 * The mean of a run of week values, exactly as buildRows computes the wire's.
 *
 * Shared rather than written out three times, because it is the one thing that
 * MUST be identical everywhere: a comparison between two differently-derived
 * averages is not a comparison, and the Taken table's Avg sits in a second
 * panel where the difference would be even harder to spot.
 *
 * ONLY WEEKS PROJECTING ABOVE ZERO ARE IN IT (Tim, 2026-09-20, decision D7 —
 * "it should only calculate future weeks that actually project any points at
 * all, and then set the avg there"). A bye's 0.00, a ruled-out 0.00, a week
 * ESPN carried no number for and a week not read yet all leave the divisor.
 * It is the Trade page's rule (`perWeek` in js/trade.js `scoreAcrossWeeks`,
 * and `weeklyMean` in js/trade-page.js), and it has to be: the Trade page's
 * player link lands here, and until 2026-09-21 the same man read 16.3 there
 * and 12.3 here. Neither of those is exported as a per-week helper, so the
 * rule is restated here — keep all three in step. A man with no such week has
 * no average (null), never a 0.0.
 *
 * ROUNDED TO THE TENTH HERE, the way the Trade engine rounds `perWeek`
 * (Math.round of ten times the mean). Printing the raw mean with toFixed(1)
 * instead split the two pages by 0.1 on a man whose mean sits on a half-tenth
 * (measured: 8.8 here against 8.9 there on the test wire), because toFixed and
 * Math.round break a floating-point tie differently. Sorting and "worst" read
 * the same rounded figure, so a tie is broken by player id — as on Trade.
 *
 * Exported for tests/wv-test.mjs only; the page itself calls it via avgOf().
 */
export function meanOf(values) {
  let sum = 0;
  let scoring = 0;
  for (const v of values) {
    if (typeof v === 'number' && v > 0) {
      sum += v;
      scoring++;
    }
  }
  return scoring > 0 ? Math.round((sum / scoring) * 10) / 10 : null;
}

/**
 * Your worst player at each position you hold, as rows for the same table.
 *
 * "Worst" is the lowest Avg over the weeks currently shown, computed exactly
 * the way the wire's is — only weeks projecting above zero, see meanOf() —
 * because a comparison between two differently-derived
 * averages is not a comparison.
 *
 * The squad is the one you hold in the EARLIEST week on screen: a claim made
 * now replaces somebody on the roster as it stands now, not as it stood in some
 * later week ESPN happens to have projected. So the label's number — QB3, K2 —
 * is how many you hold at that position today.
 */
function buildMineRows(weeks) {
  const teamId = myTeamId();
  if (teamId === null) return [];

  const anchor = weeks.find((w) => state.rosterWeeks.has(w));
  if (anchor === undefined) return [];

  const team = (state.rosterWeeks.get(anchor) || []).find((t) => t.id === teamId);
  if (!team) return [];

  const held = new Map();   // position -> rows
  for (const p of team.players || []) {
    if (!POS_ORDER.has(p.position)) continue;   // an unknown slot is not a position
    const values = weeks.map((w) => rosterValueFor(p.playerId, w));
    if (!held.has(p.position)) held.set(p.position, []);
    held.get(p.position).push({ p, values, done: doneRun(p, weeks, true), avg: avgOf(values, weeks), mine: true });
  }

  const rows = [];
  for (const [position, group] of held) {
    // Only a player ESPN has actually projected can be called the worst one; a
    // player with no number at all over these weeks is unknown, not bad, and
    // naming him would be inventing the comparison. The depth still counts
    // everybody held there, because that is what depth means.
    const rated = group.filter((r) => r.avg !== null);
    if (!rated.length) continue;
    const worst = rated.reduce((a, b) =>
      b.avg < a.avg || (b.avg === a.avg && b.p.playerId < a.p.playerId) ? b : a
    );
    rows.push({ ...worst, depth: group.length, label: `Your ${position}${group.length}`, group });
  }

  // Football's own order, so an unsorted set of them reads QB first.
  rows.sort((a, b) => (POS_ORDER.get(a.p.position) ?? 9) - (POS_ORDER.get(b.p.position) ?? 9));
  return rows;
}

// ------------------------------------------------------------ the Gain column
//
// WHAT ADDING THIS FREE AGENT IS WORTH TO YOUR LINEUP. ESPN shows his
// projection; it never solves your lineup with him in it. Gain does: add him,
// drop the roster man whose loss costs least, and take the change in your best
// legal lineup, a week, over the weeks still to play. The arithmetic is the
// Trade engine's (js/waiver-gain.js) — its lineups, its floor, its cut.
//
// WHICH WEEKS. The regular-season weeks still to come (`rosWeeks()`, the weeks
// the arrows and Avg already mean by "rest of season"), less a week already
// under way: once a game of it is over its lineups are locked, which is the
// Trade page's rule too. The column's title names them. THIS COLUMN BUYS NO
// WEEK OF ITS OWN — requests are the scarce thing on this page. On a real
// league the arrows read the rest of the season after the table paints, and
// Gain waits for that; where nothing is going to read them (nobody on the page
// is in the preseason copy) it prices the unbroken run of weeks already held,
// so pressing a wider span widens it, and the title says which weeks it used.
//
// AFTER THE TABLE, IN SLICES. The roster's own lineups are solved once per
// team; each free agent is then a few lineup fills, and most are skipped by
// the prune. Measured: about a millisecond a man unpruned. It is still done
// off the paint, a few milliseconds at a time, filling the cells in as it
// goes: the table must never wait on it.

/** How long one slice of the work may hold the page, in milliseconds. */
const GAIN_SLICE_MS = 8;

const weekHeld = (w) => state.weekData.has(w) && state.rosterWeeks.has(w);
const weekRefused = (w) => state.failedWeeks.has(w) || state.failedRosterWeeks.has(w);

/** A week with a finished game in it: locked, so no claim made now can move it. */
const weekUnderWay = (w) =>
  ((state.weekDone.get(w) || {}).size || 0) + ((state.rosterDone.get(w) || {}).size || 0) > 0;

/** The arrows are going to read the rest of the season (or may yet decide to). */
const rosComing = () => !state.isDemo && (!state.baselineSettled || trendWorthLoading());

/**
 * The weeks Gain is priced over; null while one of them is still on its way.
 * [] when there is none to price.
 */
function gainSpan() {
  const ros = rosWeeks();
  const shown = shownWeeks();
  const coming = (w) => !weekHeld(w) && !weekRefused(w) && (shown.includes(w) || rosComing());
  if (ros.some(coming)) return null;
  const run = [];
  for (const w of ros) {
    if (!weekHeld(w)) break;
    run.push(w);
  }
  return run.filter((w) => !weekUnderWay(w));
}

/**
 * The positional floor (js/floor.js), read the way the Trade page reads it:
 * `season.fetchFloors` for the current week, once per league. Undefined while
 * that read is in the air; null for none (the sample data, a stub, a refusal).
 */
function gainFloors() {
  if (state.isDemo || typeof season.fetchFloors !== 'function' || !state.currentWeek) return null;
  if (state.gainFloors.token === state.token) return state.gainFloors.value;
  const token = state.token;
  state.gainFloors = { token, value: undefined };
  Promise.resolve()
    .then(() => season.fetchFloors(state.currentWeek))
    .then((got) => (got && got.size ? got : null), () => null)
    .then((value) => {
      if (token !== state.token) return;
      state.gainFloors.value = value;
      render();
    });
  return undefined;
}

/** A free agent from the id a cell carries (an attribute is always text). */
const poolMan = (id) => state.pool.get(Number(id)) || state.pool.get(id) || null;

/** A man as the engine needs him — and nothing a week-specific read attached. */
const gainMan = (p) => ({ playerId: p.playerId, name: p.name, position: p.position });

/**
 * Decide what Gain is about right now, before the table is drawn. When that
 * has changed — another team, another league, more weeks in hand — the old
 * figures are dropped and the wire is queued again.
 */
function prepareGain() {
  const g = state.gain;
  let why = '';
  let weeks = [];
  let team = null;
  let teams = [];
  let floors = null;

  const teamId = myTeamId();
  if (teamId === null) why = 'team';
  if (!why) {
    weeks = gainSpan();
    if (weeks === null) why = 'wait';
    else if (!weeks.length) why = 'weeks';
  }
  if (!why) {
    // The squad as it stands now: the same week the "Your …" rows are anchored on.
    const anchor = shownWeeks().find((w) => state.rosterWeeks.has(w));
    teams = (anchor === undefined ? null : state.rosterWeeks.get(anchor)) || [];
    team = teams.find((t) => t.id === teamId) || null;
    if (!team || !(team.players || []).length) why = 'team';
  }
  if (!why) {
    floors = gainFloors();
    if (floors === undefined) why = 'wait';
  }

  const key = why ? '' : `${state.token}|${teamId}|${weeks.join(',')}|${state.pool.size}`;
  g.why = why;
  if (key === g.key) return;

  if (g.timer !== null) clearTimeout(g.timer);
  Object.assign(g, {
    key, weeks: why ? [] : weeks, base: null, by: new Map(), queue: [], timer: null,
    scale: null, slices: 0, longest: 0, busy: 0,
  });
  if (!key) return;

  const mine = team.players.filter((p) => p.playerId !== null && p.playerId !== undefined).map(gainMan);
  const held = new Set(mine.map((p) => p.playerId));
  // Your men off the rosters, a free agent off the wire; anything but a number
  // is "no projection", which the engine leaves out of that week's lineup.
  // Remembered, because the engine asks for the same man's same week on every
  // fill, and it fills each week once per man it might cut.
  const seen = new Map();
  const projFor = (p, week) => {
    const at = `${p.playerId}|${week}`;
    if (seen.has(at)) return seen.get(at);
    const v = held.has(p.playerId) ? rosterValueFor(p.playerId, week) : valueFor(p.playerId, week);
    const n = typeof v === 'number' ? v : null;
    seen.set(at, n);
    return n;
  };
  g.base = gainBase({
    players: mine, slots: slotsForLeague(slotCountsFromLineups(teams)), weeks, projFor, floors,
  });
  g.queue = [...state.pool.keys()];
  gainMark('gain-start');
  // After this paint, never inside it.
  g.timer = setTimeout(runGain, 0);
}

/** A timeline mark, so the fill can be timed from outside (`performance.measure`). */
function gainMark(name, detail) {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(name, detail ? { detail } : undefined);
  }
}

/** One slice: price free agents until the time is up, then show them. */
function runGain() {
  const g = state.gain;
  g.timer = null;
  const started = Date.now();
  while (g.queue.length && Date.now() - started < GAIN_SLICE_MS) {
    const p = state.pool.get(g.queue.shift());
    if (p) g.by.set(p.playerId, gainOf(g.base, gainMan(p)));
  }
  paintGain();
  // How long the page was held, worst slice and all of them: one man priced
  // the long way is a single piece of work and can outlast the budget.
  const held = Date.now() - started;
  g.slices = (g.slices || 0) + 1;
  g.longest = Math.max(g.longest || 0, held);
  g.busy = (g.busy || 0) + held;
  if (g.queue.length) {
    g.timer = setTimeout(runGain, 0);
    return;
  }
  gainMark('gain-end', { slices: g.slices, longest: g.longest, busy: g.busy });
  // THE COLUMN IS WHOLE, so it can be coloured against itself: every figure is
  // drawn again from the one builder, now with its shade.
  g.scale = gainScale();
  if (g.scale) {
    $('waiverTable').querySelectorAll('tbody td.gain').forEach((td) => {
      const tr = td.parentNode;
      const mine = /\bmine\b/.test((tr && tr.getAttribute('class')) || '');
      const man = tr && !mine ? poolMan(tr.getAttribute('data-player')) : null;
      if (man && g.by.has(man.playerId)) td.outerHTML = gainCell(man);
    });
  }
  // The cells carry their sort keys now: put the rows back in the chosen order.
  resort($('waiverTable'));
}

/**
 * THE Gain COLUMN'S SCALE: against the other gains in the column, ANCHORED AT
 * ZERO. Every figure here is a plus, and a plus must never be drawn red — so
 * the gains are mirrored round zero before the scale is taken, which puts the
 * average at 0 and leaves only the green half in use: the bigger the gain
 * beside the column's own, the deeper the shade. Built once the whole column
 * is priced; null until then, and for a column with nothing to compare.
 */
function gainScale() {
  const gains = [...state.gain.by.values()].filter((r) => r && r.total > 0).map((r) => r.perWeek);
  return gains.length > 1 ? heatScale([...gains, ...gains.map((v) => -v)]) : null;
}

/** Fill in every cell still on its dot whose figure has arrived. */
function paintGain() {
  const g = state.gain;
  $('waiverTable').querySelectorAll('tbody td.gain.wait[data-for]').forEach((td) => {
    const p = poolMan(td.getAttribute('data-for'));
    if (!p || !g.by.has(p.playerId)) return;
    // The whole cell, from the one builder: a cell filled in here is then the
    // same markup, byte for byte, as one drawn by the next full repaint.
    td.outerHTML = gainCell(p);
  });
}

/** `+1.4` — a gain is always written with its sign. */
const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;

/**
 * A free agent's Gain cell, in parts; `gainCell` below writes them out.
 *
 * A gain is PER WEEK, the Trade page's convention for a move priced over
 * several weeks; the total is in the preview. No gain is the dash the rest of
 * the table uses for "nothing here", with no sort key, so it sinks to the foot
 * of the column either way. The figure is a button, not a titled cell: it
 * opens the preview (`gainCard` below), by hover, focus or tap, and a click
 * goes to the man the move would drop.
 */
function gainCellParts(p) {
  const g = state.gain;
  if (!g.key) {
    return g.why === 'wait'
      ? { cls: 'gain wait', v: null, title: '', html: '·', wait: false }
      : { cls: 'gain', v: null, title: '', html: dash, wait: false };
  }
  const r = g.by.get(p.playerId);
  if (!r) return { cls: 'gain wait', v: null, title: '', html: '·', wait: true };
  if (!(r.total > 0)) {
    return {
      cls: 'gain', v: null, html: dash, wait: false,
      title: `Adding ${p.name} would not raise your lineup in ${weekRange(g.weeks)}.`,
    };
  }
  const heat = heatOf(r.perWeek, g.scale || null);
  return {
    cls: `gain${heat ? ` ${heat.cls}` : ''}`, v: r.perWeek.toFixed(3), title: '', wait: false,
    html: `<span class="gn" data-gain="${esc(p.playerId)}" tabindex="0" role="button" ` +
      `aria-label="${esc(p.name)}: where this gain comes from">${signed(r.perWeek)}</span>` +
      heatMarkHtml(heat),
  };
}

function gainCell(p) {
  const c = gainCellParts(p);
  return `<td class="${c.cls}"${c.wait ? ` data-for="${esc(p.playerId)}"` : ''}` +
    `${c.v === null ? '' : ` data-v="${c.v}"`}${c.title ? ` title="${esc(c.title)}"` : ''}>${c.html}</td>`;
}

/** The column's title: what the number is and, once known, exactly which weeks. */
function gainTitle() {
  const g = state.gain;
  if (!g.key && g.why === 'team') return 'Pick your team above to see what adding each player would gain your lineup.';
  return `Points a week your best lineup gains${g.key ? ` over ${weekRange(g.weeks)}` : ''} ` +
    `if you add him and drop the man it costs least.`;
}

// WHERE A GAIN COMES FROM: the man the move drops, then one row per week —
// your best lineup now, with him, and the difference — summing to the total,
// which over the weeks is the figure in the cell. It is the site's stat card
// (js/pop.js) since 2026-10-08, drawn as this page's own pop-over drew it: a
// mouse gets the card beside the figure on hover or focus; a finger has no
// hover, so a tap opens it as a sheet with a Close button; a tap outside or
// Escape also shuts it.
//
// "DROP X" IS A LINK TO THAT MAN — his row in the Taken table, opened the way
// any name on this page opens. On the sheet it is the name itself and the
// button under the table; with a mouse the card cannot be clicked (it is
// never what the mouse is over), so the click on the figure is the link.

function gainCard(playerId) {
  const g = state.gain;
  const p = poolMan(playerId);
  const r = p ? g.by.get(p.playerId) : null;
  if (!r || !(r.total > 0) || !r.weeks.length) return null;
  const sum = (pick) => r.weeks.reduce((a, w) => a + pick(w), 0);
  const rows = r.weeks.map((w) =>
    `<tr><td class="num">${w.week}</td><td class="num">${fmt(w.before)}</td>` +
    `<td class="num">${fmt(w.after)}</td><td class="num">${signed(w.delta)}</td></tr>`).join('');
  const dropHref = r.drop ? playerHref(r.drop.playerId) : null;
  const dropName = r.drop
    ? (dropHref ? `<a class="pref" href="${esc(dropHref)}">${esc(r.drop.name)}</a>` : esc(r.drop.name))
    : '';
  // His place among the gains, once the whole column is priced.
  const gains = g.queue.length ? [] : [...g.by.values()].filter((x) => x && x.total > 0).map((x) => x.perWeek);
  return {
    title: p.name,
    sub: weekRange(g.weeks),
    tableHtml:
      (r.drop ? `<div class="op-drop">Drop ${dropName}</div>` : '') +
      '<table class="sc-rows"><thead><tr><th class="num">Wk</th><th class="num">Now</th>' +
      '<th class="num">With him</th><th class="num">+</th></tr></thead>' +
      `<tbody>${rows}</tbody><tfoot>` +
      `<tr><td class="lbl">Total</td><td class="num">${fmt(sum((w) => w.before))}</td>` +
      `<td class="num">${fmt(sum((w) => w.after))}</td><td class="num">${signed(r.total)}</td></tr>` +
      `<tr class="sc-total"><td class="lbl" colspan="3">Per week</td><td class="num">${signed(r.perWeek)}</td></tr>` +
      '</tfoot></table>',
    foot: gains.length > 1
      ? `${ordinal(rankIn(r.perWeek, gains))} of ${gains.length} gains on the wire`
      : '',
    href: dropHref,
    hrefLabel: r.drop ? `Open ${r.drop.name}` : null,
  };
}

/** The man a gain figure's move would drop, off the event; null for none. */
function gainDropAt(e) {
  const el = e.target && e.target.closest ? e.target.closest('.gn[data-gain]') : null;
  const p = el ? poolMan(el.getAttribute('data-gain')) : null;
  const r = p ? state.gain.by.get(p.playerId) : null;
  return r && r.drop && r.drop.playerId !== null && r.drop.playerId !== undefined ? r.drop.playerId : null;
}

/**
 * A MOUSE CLICK (or Enter) ON A GAIN FIGURE goes to the man it would drop —
 * answered here, without the reload the card's own link would cost, exactly as
 * a click on a name is (`jumpTo`). Registered BEFORE `wirePops`, so it gets
 * the click first. A finger is left to the card: its tap opens the sheet.
 */
function wireGainJump(table) {
  const jump = (e) => {
    if (coarsePointer() || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    const id = gainDropAt(e);
    if (id === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    hidePop();
    jumpTo(id);
  };
  table.addEventListener('click', jump);
  table.addEventListener('keydown', (e) => { if (e.key === 'Enter') jump(e); });
}

// ---------------------------------------------------------------- the previews
//
// EVERY NUMBER ON THIS PAGE OPENS THE SITE'S STAT CARD (Tim, 2026-10-08: "If
// the user is curious about a number or it's breakdown … they should be able
// to hover over it and show a preview"). A cell that has one carries `data-c`
// — what kind of number it is — and NO `title`; the card is built from `view`
// when it is asked for, so three thousand cells register nothing.
//
//   data-c="avg"   the weeks it is the mean of, the ones left out and why, and
//                  his place in the group the colour compares him with
//   data-c="wk"    a week still to play: the number, that group's average, the
//                  two claim cues in figures, his place that week
//   data-c="past"  a week already played: projected and scored → Schedule
//   data-c="act"   the same week in his Actual row → Schedule
//   data-c="pos"   "RB2": that manager's men at the position, by Avg → Trade
//   data-c="own"   the manager: record, points a week, this week → Analysis
//   .mine-tag      "Your QB3": your men at that position → Analysis
//   .gn            a Gain figure (above) → the man it would drop
//
// THE GROUP IS SAID IN WORDS, because the colour is per position: sorted by
// value the Avg column runs green, grey, green, and "2nd of 17 free-agent QBs"
// is what makes that read as right rather than broken.
//
// A Bye, a 0.0, a dash and a finished game keep the `title` they always had:
// none of them is a number with parts.

/** What the last paint drew, for the previews to be built from. */
const view = {
  weeks: [],
  wireAll: [], wire: new Map(), mine: new Map(), wireWeekScales: new Map(), lineup: null,
  takenAll: [], taken: new Map(), takenWeekScales: new Map(),
  teamProj: null,
};

/** Rows by player id, as text — an attribute is always text. */
const byId = (rows) => new Map(rows.map((r) => [String(r.p.playerId), r]));

/** Every element that opens a preview, in both tables. */
const PREVIEWS = '[data-c], .mine-tag, .gn[data-gain]';

/** "QBs", "kickers" — a position as a group of men. */
const posPlural = (pos) => ({ K: 'kickers', DST: 'defenses' }[pos] || `${pos}s`);

/** 1 for the highest; equal numbers share a place. */
const rankIn = (value, values) => values.filter((x) => x > value + 1e-9).length + 1;

/**
 * "2nd of 17 free-agent QBs". A "Your …" row is measured against the free
 * agents without being one of them, and says so.
 */
function standingWords(kind, value, values, pos, tail = '') {
  if (!values.length) return '';
  const group = `${kind === 'taken' ? 'rostered' : 'free-agent'} ${posPlural(pos)}${tail}`;
  const place = ordinal(rankIn(value, values));
  return kind === 'mine'
    ? `Yours — would be ${place} of ${values.length + 1} ${group}`
    : `${place} of ${values.length} ${group}`;
}

/** The row an element sits in, and which of the three kinds of row it is. */
function rowAt(el) {
  const tr = el.closest('tr');
  const table = el.closest('table');
  if (!tr || !table) return null;
  const id = tr.getAttribute('data-player') ?? tr.getAttribute('data-actual-for');
  if (id === null || id === undefined) return null;
  const taken = table.id === 'takenTable';
  const mine = !taken && /\bmine\b/.test(tr.getAttribute('class') || '');
  const kind = taken ? 'taken' : mine ? 'mine' : 'wire';
  const row = view[kind].get(String(id));
  return row ? { row, kind } : null;
}

/** Why a week is not in Avg, in a word or two. */
function leftOutWord(p, v, week, roster) {
  if (v === undefined) return 'not read yet';
  if (v === null) return 'no projection';
  const zero = zeroKind(v, {
    week,
    byeWeek: byeWeekOf(p, state.byes),
    injuryStatus: roster ? rosterStatusFor(p, week) : p.injuryStatus,
    demo: roster && state.isDemo,
  });
  return zero === 'bye' ? 'bye' : zero === 'out' ? 'ruled out' : 'projected 0.0';
}

/** Avg: the weeks it is the mean of, and where it stands at his position. */
function avgCard(row, kind) {
  if (row.shownAvg === null || row.shownAvg === undefined) return null;
  const weeks = view.weeks;
  const use = avgMask(weeks);
  const on = valueOn();
  const rows = [];
  let counted = 0;
  weeks.forEach((w, i) => {
    if (!use[i]) return;          // a playoff week: never in Avg
    const v = row.values[i];
    const over = Boolean(row.done && row.done[i]);
    // On Value the mean is of the Values shown: a score is not one of them.
    const inIt = typeof v === 'number' && v > 0 && (!on || typeof row.shown[i] === 'number');
    if (inIt) counted++;
    rows.push({
      label: `Week ${w}`,
      note: inIt ? (over ? 'scored' : '')
        : `${on && over ? 'scored' : leftOutWord(row.p, v, w, kind !== 'wire')}, left out`,
      value: inIt ? (on ? row.shown[i] : v) : null,
    });
  });
  const pos = row.p.position;
  const pool = (kind === 'taken' ? view.takenAll : view.wireAll)
    .filter((r) => r.p.position === pos && r.shownAvg !== null).map((r) => r.shownAvg);
  return {
    title: row.p.name,
    sub: `${on ? 'Value, avg' : 'Avg'}, ${weekRange(weeks)}`,
    rows,
    total: { label: `Mean of ${plural(counted, 'week')}`, value: row.shownAvg },
    foot: standingWords(kind, row.shownAvg, pool, pos),
  };
}

/**
 * WHERE A VALUE COMES FROM, as rows that add up to it: the points between the
 * two lines at half, the points over the starter line in full (js/value.js).
 */
function valueRows(p, x) {
  const parts = value.valueParts(state.value.base, p.position, x);
  if (!parts) return null;
  return [
    { label: 'Over the waiver line', note: `${fmt(parts.waiver)}, at half`, value: parts.bench * value.BENCH_WEIGHT },
    { label: 'Over the starter line', note: fmt(parts.starter), value: parts.over },
  ];
}

/** A week still to play: the number, its group, and whether you would start him. */
function weekCard(row, kind, week) {
  const i = view.weeks.indexOf(week);
  const v = i < 0 ? null : row.values[i];
  if (!measurable(v)) return null;
  const pos = row.p.position;
  if (valueOn()) {
    // On Value the cell is that projection's Value: say what it is made of.
    const shown = row.shown[i];
    const parts = typeof shown === 'number' ? valueRows(row.p, v) : null;
    if (!parts) return null;
    const among = (kind === 'taken' ? view.takenAll : view.wireAll)
      .filter((r) => r.p.position === pos && typeof r.shown[i] === 'number')
      .map((r) => r.shown[i]);
    return {
      title: row.p.name,
      sub: `Week ${week} · projected ${fmt(v)}`,
      rows: parts,
      total: { label: 'Value', value: shown },
      foot: standingWords(kind, shown, among, pos, ' this week'),
    };
  }
  const pool = (kind === 'taken' ? view.takenAll : view.wireAll)
    .filter((r) => r.p.position === pos && measurable(r.values[i]) && !(r.done && r.done[i]))
    .map((r) => r.values[i]);
  const rows = [{ label: 'Projected', value: v }];
  if (pool.length > 1) {
    rows.push({
      label: `Average ${kind === 'taken' ? 'rostered' : 'free-agent'} ${pos}`,
      value: pool.reduce((a, b) => a + b, 0) / pool.length,
    });
  }
  if (kind === 'wire') {
    // The green box, in figures: whether he would make your lineup this week,
    // and the man of yours that turns on.
    const got = view.lineup && !(row.done && row.done[i]) ? view.lineup(row.p, v, i) : null;
    if (got) {
      rows.push({ label: 'You would start him', value: got.starts ? 'Yes' : 'No' });
      if (got.out) rows.push({ label: got.out.name, note: 'he would sit', value: got.out.projected });
      if (got.bar) rows.push({ label: got.bar.name, note: 'starts ahead of him', value: got.bar.projected });
    }
  }
  return {
    title: row.p.name,
    sub: `Week ${week}`,
    rows,
    foot: standingWords(kind, v, pool, pos, ' this week'),
  };
}

/** A week already played: what ESPN projected and what he scored. */
function playedCard(row, kind, week) {
  const got = pastOf(row.p, week, kind === 'wire');
  if (!got || typeof got !== 'object') return null;
  const proj = typeof got.projected === 'number' ? got.projected : null;
  return {
    title: row.p.name,
    sub: `Week ${week}`,
    rows: [
      { label: 'Projected', value: proj },
      // On Value the cell above his score is this: the projection's Value.
      ...(valueOn() && proj !== null ? [{ label: 'Value', note: 'of the projection', value: asValue(row.p, proj) }] : []),
      { label: 'Scored', value: got.actual },
    ],
    href: weekHref(week),
    hrefLabel: `Week ${week} matchups`,
  };
}

/** A short list of men as a card's table, the one the cell is about in bold. */
function menTable(men) {
  return '<table class="sc-rows"><tbody>' + men.map((m) =>
    `<tr${m.here ? ' class="sc-here"' : ''}><td class="num sc-lead">${esc(m.lead)}</td>` +
    `<td class="name">${esc(m.name)}</td>` +
    `<td class="num">${m.value === null ? '—' : fmt(m.value)}</td></tr>`).join('') +
    '</tbody></table>';
}

/** Best Avg first; a man with no Avg after every man with one; then by id. */
const byAvg = (a, b) =>
  (a.avg === null) - (b.avg === null) || (b.avg ?? 0) - (a.avg ?? 0) || a.p.playerId - b.p.playerId;

/**
 * WHERE "TRADE FOR HIM" GOES: the Trade page, with his manager chosen and him
 * in the offer — `trade.html?with=<teamId>&get=<playerId>`, the form the Trade
 * page reads. Null for your own man: there is nobody to trade with.
 */
function tradeHrefFor(row) {
  if (row.ownerId === null || row.ownerId === undefined) return null;
  if (row.p.playerId === null || row.p.playerId === undefined) return null;
  const me = myTeamId();
  if (me !== null && String(me) === String(row.ownerId)) return null;
  return `trade.html?with=${encodeURIComponent(row.ownerId)}&get=${encodeURIComponent(row.p.playerId)}`;
}

/** "RB2": that manager's men at the position, ranked the way the cell is. */
function posCard(row) {
  const pos = row.p.position;
  const men = view.takenAll
    .filter((r) => String(r.ownerId) === String(row.ownerId) && r.p.position === pos)
    .sort(byAvg);
  const href = tradeHrefFor(row);
  return {
    title: row.owner,
    sub: `${posPlural(pos)} by Avg, ${weekRange(view.weeks)}`,
    tableHtml: menTable(men.map((r) => ({
      lead: r.rank === null ? pos : `${pos}${r.rank}`, name: r.p.name, value: r.avg, here: r === row,
    }))),
    href,
    hrefLabel: href ? 'Trade for him' : null,
  };
}

/** "Your QB3": your men at that position, and which of them the row is. */
function mineCard(row) {
  const pos = row.p.position;
  const men = (row.group || []).slice().sort(byAvg);
  let place = 0;
  return {
    title: `Your ${posPlural(pos)}`,
    sub: `by Avg, ${weekRange(view.weeks)}`,
    tableHtml: menTable(men.map((r) => ({
      lead: r.avg === null ? pos : `${pos}${++place}`,
      name: r.p.name,
      value: r.avg,
      here: r.p.playerId === row.p.playerId,
    }))),
    href: teamHref(myTeamId(), state.currentWeek),
    hrefLabel: 'Open roster',
  };
}

/** Every squad's best lineup this week, worked out once per paint, on demand. */
function teamProjFor(teamId) {
  if (!view.teamProj) {
    const held = (w) => w !== null && w !== undefined && state.rosterWeeks.has(w);
    const week = held(state.currentWeek) ? state.currentWeek : view.weeks.find(held);
    const got = week === undefined ? null
      : projectionsFromWeekTeams(new Map([[week, state.rosterWeeks.get(week)]]));
    view.teamProj = { week: week ?? null, by: (got && got.proj.get(week)) || new Map() };
  }
  for (const [id, total] of view.teamProj.by) {
    if (String(id) === String(teamId)) return { week: view.teamProj.week, total };
  }
  return null;
}

/** A manager: his record, his points a week, and his best lineup this week. */
function teamCard(row) {
  const id = row.ownerId;
  const rows = [];
  const games = state.schedule && Array.isArray(state.schedule.games) ? state.schedule.games : [];
  let won = 0;
  let lost = 0;
  let tied = 0;
  let points = 0;
  let played = 0;
  for (const g of games) {
    if (!g.played || typeof g.homeScore !== 'number' || typeof g.awayScore !== 'number') continue;
    const home = String(g.homeId) === String(id);
    if (!home && String(g.awayId) !== String(id)) continue;
    const his = home ? g.homeScore : g.awayScore;
    const theirs = home ? g.awayScore : g.homeScore;
    played++;
    points += his;
    if (his > theirs) won++; else if (his < theirs) lost++; else tied++;
  }
  if (played) {
    rows.push({ label: 'Record', value: `${won}-${lost}${tied ? `-${tied}` : ''}` });
    rows.push({ label: 'Points a week', value: points / played });
  }
  const proj = teamProjFor(id);
  if (proj) rows.push({ label: `Week ${proj.week} projection`, value: proj.total });
  return {
    title: row.owner,
    rows,
    href: teamHref(id, state.currentWeek),
    hrefLabel: 'Open roster',
  };
}

/** The preview for one element, or null when it has none. */
function previewFor(el) {
  if (el.matches('.gn[data-gain]')) return gainCard(el.getAttribute('data-gain'));
  const at = rowAt(el);
  if (!at) return null;
  if (el.matches('.mine-tag')) return at.kind === 'mine' ? mineCard(at.row) : null;
  const week = Number(el.getAttribute('data-w'));
  switch (el.getAttribute('data-c')) {
    case 'avg': return avgCard(at.row, at.kind);
    case 'wk': return weekCard(at.row, at.kind, week);
    case 'past':
    case 'act': return playedCard(at.row, at.kind, week);
    case 'pos': return at.kind === 'taken' ? posCard(at.row) : null;
    case 'own': return at.kind === 'taken' ? teamCard(at.row) : null;
    default: return null;
  }
}

// ------------------------------------------------------- the taken players
//
// Everyone who is NOT on the wire, which on this page means everyone the roster
// payload knows about. The wire answers "who can I add"; this answers "who has
// what", and they are different enough questions to deserve different tables.

/**
 * Every rostered player, with his owner and his rank on that owner's squad.
 *
 * WHICH WEEK'S ROSTERS decide who owns whom: the earliest week on screen that
 * loaded, the same anchor buildMineRows uses. Ownership is a fact about now,
 * and the roster as it stands now is the earliest week we hold — a man traded
 * in week 9 should not be listed under the team that will hold him later. His
 * per-week numbers still come from each week's own payload, so a projection is
 * never borrowed across weeks.
 *
 * THE RANK is ours, over the weeks currently shown, best = 1: QB3 means the
 * third-highest Avg among that manager's quarterbacks. It is not ESPN's depth
 * chart and it is not a season figure, so widening the span can move a man from
 * QB2 to QB3 — exactly as it can change which of your men appears as "Your QB3"
 * in the table above, and for the same reason.
 *
 * A player ESPN has no number for over these weeks gets NO rank. Ranking him
 * would mean guessing where he belongs, and this page already refuses that in
 * buildMineRows, which will not call an unrated player the worst one.
 */
function buildTakenRows(weeks) {
  const loaded = weeks.filter((w) => state.rosterWeeks.has(w));
  if (!loaded.length) return [];

  // MEMBERSHIP IS THE UNION OVER EVERY WEEK ON SCREEN, not just the first one.
  //
  // It used to be the earliest week alone, on the reasoning that the squad as
  // it stands now is the one you are deciding against. That reasoning is right
  // about the OWNER and wrong about who is in the table: the columns span
  // weeks 4–6, so a man rostered in week 5 is part of what this table is
  // about, and leaving him out meant the page could not answer a question it
  // was visibly being asked.
  //
  // It also broke the click-through across pages. The analysis page can be
  // pointed at any week of the season, so a link made from week 13 arrived
  // here about a man the table had never heard of, and the page told Tim he
  // "may have been dropped" — a confident, wrong answer. In the demo data 45
  // of 160 men differ between week 4 and week 13; tests/link-check.mjs is what
  // found it, and no single-page suite could have.
  //
  // The owner is still the earliest week he actually appears in: that is the
  // most recent squad this page knows him to have been on, and it is a fact
  // rather than a guess.
  const seen = new Map();   // playerId -> { p, ownerId, owner }
  for (const week of loaded) {
    for (const team of state.rosterWeeks.get(week) || []) {
      const owner = (team.name || '').trim() || `Team ${team.id}`;
      for (const p of team.players || []) {
        if (p.playerId === null || p.playerId === undefined) continue;
        if (!seen.has(p.playerId)) seen.set(p.playerId, { p, ownerId: team.id, owner });
      }
    }
  }

  // GROUPED BY TEAM ID, NOT BY THE LABEL. The ranks are per manager, as they
  // always were — but the thing that identifies a manager has to be his id.
  // Keying on the displayed string merges any two squads that happen to render
  // the same label, and then BOTH of them get a depth chart computed over
  // thirty-two players: every rank on both squads silently wrong, with nothing
  // on screen to suggest it. The label was unique often enough to hide this
  // while it was ESPN's team name; it is likelier to collide now that a squad
  // is labelled with the person holding it, since two owners can share a
  // display name and an unresolved one falls back to a shared shape. The id is
  // ESPN's own and is unique by construction.
  const squads = new Map();
  for (const { p, ownerId, owner } of seen.values()) {
    if (!squads.has(ownerId)) squads.set(ownerId, { owner, players: [] });
    squads.get(ownerId).players.push(p);
  }

  const rows = [];
  for (const [ownerId, { owner, players }] of squads) {
    const byPosition = new Map();
    for (const p of players) {
      const values = weeks.map((w) => rosterValueFor(p.playerId, w));
      const row = { p, values, done: doneRun(p, weeks, true), avg: avgOf(values, weeks), owner, ownerId, rank: null };
      rows.push(row);
      if (!byPosition.has(p.position)) byPosition.set(p.position, []);
      byPosition.get(p.position).push(row);
    }

    // Ranked per owner per position, and only among the men who have a number.
    // Leaving the unrated out keeps the ranks 1..n contiguous, so a QB3 really
    // is the third-best of the quarterbacks this manager has numbers for rather
    // than the third name in a list with holes in it. The playerId tiebreak is
    // there so two identical averages do not swap places between repaints.
    for (const group of byPosition.values()) {
      group
        .filter((r) => r.avg !== null)
        .sort((a, b) => b.avg - a.avg || a.p.playerId - b.p.playerId)
        .forEach((r, i) => { r.rank = i + 1; });
    }
  }

  return rows;
}

/**
 * How many players sit behind each button on a position control.
 *
 * Each table counts its OWN pool, which is the whole reason the two controls
 * are worth having separately: the wire's QB button says how many quarterbacks
 * you could add, the taken one says how many the league is holding. One shared
 * count could only ever have been true of one of them.
 *
 * FLEX has to be counted EXPLICITLY. The loop below only knows how to increment
 * a key that a player's own position names, so a FLEX key seeded to zero and
 * left to that loop would sit at zero for ever and the button would report,
 * confidently, that there is nobody to flex. It is counted as its own sum of the
 * three positions instead — which is also why FLEX is tested before the position
 * key is touched rather than being folded into it: a man is counted once as a
 * running back and once as flex-eligible, and those are two different questions
 * about him, not two positions.
 */
function countsOf(players) {
  const counts = { ALL: 0, [FLEX]: 0 };
  for (const pos of POSITIONS) counts[pos] = 0;
  for (const p of players) {
    counts.ALL++;
    if (FLEX_POSITIONS.includes(p.position)) counts[FLEX]++;
    if (POS_ORDER.has(p.position)) counts[p.position]++;
  }
  return counts;
}

// --------------------------------------------------------------------- render

// ------------------------------------------------------- the player deep link
//
// `waivers.html?player=<espnPlayerId>` lands on one man. Every page on the site
// links here that way — a name, or a number standing for a player — and the
// contract is deliberately a plain `href` rather than a click handler, so
// middle-click and open-in-a-new-tab behave and the same markup works whether
// you arrive from another page or click it on this one.
//
// Landing does three things, and each is answering a different half of what Tim
// asked for ("bring you directly to their position … and show you their next 13
// weeks proj"):
//
//   - widens the span to the whole rest of the season, because the span is what
//     decides how many week columns exist. NOT persisted: it is this visit's
//     answer to a link, not a change of mind, and a reload gives back the span
//     actually chosen.
//   - points the table he is in at HIS position, so he lands among the men he
//     is measured against rather than alone in a list of everybody.
//   - marks his row and scrolls to it, once.
//
// Nothing here fetches on its own. Widening the span costs whatever weeks are
// not already held, exactly as pressing the control by hand would.

/** `?player=` from the URL. Defensive: a harness may provide no location. */
function requestedPlayer() {
  try {
    const m = /[?&]player=(\d+)/.exec((window.location && window.location.search) || '');
    return m ? Number(m[1]) : null;
  } catch {
    return null;   // no location at all is simply "no player asked for"
  }
}

/** `&week=` beside it: the played week a link is about. Null when absent. */
function requestedWeek() {
  try {
    const m = /[?&]week=(\d+)/.exec((window.location && window.location.search) || '');
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Which table holds him, and what position he is, or null if not found yet. */
function findSpotlight(weeks) {
  const id = state.spotlight;
  if (id === null) return null;

  const wire = state.pool.get(id);
  if (wire) return { where: 'wire', position: wire.position, name: wire.name };

  const taken = buildTakenRows(weeks).find((r) => r.p.playerId === id);
  if (taken) {
    return { where: 'taken', position: taken.p.position, name: taken.p.name, owner: taken.owner };
  }
  return null;
}

/**
 * Point the page at him, once.
 *
 * Runs before the tables are drawn, and only until it succeeds: the weeks
 * arrive one request at a time, so the man being asked for may simply not be
 * loaded yet on the first paint. Until he is, this is a no-op and the next
 * repaint tries again.
 */
function settleSpotlight(weeks) {
  if (state.spotlight === null || state.settled) return;

  const found = findSpotlight(weeks);
  if (!found) {
    // Not found is not the same as not looked yet, and the difference matters:
    // the rosters arrive after the first paint in BOTH modes — live fetches them
    // a week at a time, and demo imports demo-rosters.js asynchronously — so
    // giving up on the first pass would declare every rostered man missing.
    //
    // Give up only once there is somewhere to have looked: something in the
    // roster cache, or every week we asked for refused outright. Anything still
    // in flight is a reason to wait rather than to answer.
    const looked = state.rosterWeeks.size > 0;
    const hopeless = weeks.length > 0 && weeks.every((w) => state.failedRosterWeeks.has(w));
    if (state.inFlight.size || !(looked || hopeless)) return;
    state.settled = true;
    return;
  }

  if (found.where === 'wire') state.position = found.position;
  else state.takenPosition = found.position;
  state.settled = true;
}

/** Scroll to the marked row after the tables exist. Once, never again. */
function scrollToSpotlight() {
  if (state.spotlight === null || state.scrolled) return;
  const row = document.getElementById(`p${state.spotlight}`);
  if (!row) return;
  state.scrolled = true;
  // Guarded: jsdom/linkedom have no scrollIntoView, and a harness must not die
  // of a missing browser API.
  try {
    // A `&week=` link is about one cell, so that cell is what is brought into
    // view — sideways too, on a phone where the weeks run off the screen.
    const boxed = row.querySelector('td.wk-box');
    if (boxed) boxed.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    else row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch { /* the row is marked either way, which is the part that matters */ }
}

/** The strip that says who we jumped to, and how to stop. */
function renderJump(weeks) {
  const el = $('jumpNote');
  if (state.spotlight === null) {
    el.className = 'jump hidden';
    el.innerHTML = '';
    return;
  }

  const found = findSpotlight(weeks);
  el.className = 'jump';

  if (!found) {
    el.innerHTML = state.settled
      ? `<span>No player with id ${esc(state.spotlight)} is on the wire or on a roster in ` +
        `this league. He may have been dropped, or the link may be from another league.</span>` +
        `<button type="button" data-clear>Clear</button>`
      : `<span class="muted">Looking for the player this link points at…</span>`;
    return;
  }

  el.innerHTML =
    `<span>Jumped to <strong>${esc(found.name)}</strong>${
      found.where === 'taken' ? ` — on ${esc(found.owner)}’s roster` : ' — on the wire'
    }. Showing every remaining week, and the ${esc(found.position)} filter on the ` +
    `${found.where === 'taken' ? 'Taken' : 'Available'} table.</span>` +
    `<button type="button" data-clear>Clear</button>`;
}

// ---------------------------------------------------------------- who to start
//
// THE ANALYSIS PAGE'S BOX, ABOVE THE FREE AGENTS (Tim, 2026-10-09: "the who to
// start box above the available players section, specifically when a certain
// position is selected. this will help the user know if and how useful an
// added player will be"). Your own men at the position the filter is on, week
// by week, with the weeks each makes your best lineup marked.
//
// IT IS THE SAME BOX, not a likeness: js/who-to-start.js draws it for both
// pages. That module reads the Analysis page's `state` by name, so this page
// hands it a VIEW of its own state in those names (`startView`) — nothing is
// copied, every getter reads what the page holds at that moment.
//
// THE WEEKS ARE THE AVAILABLE TABLE'S COLUMNS, in the same order: the played
// weeks, then the weeks being priced (the span). So Avg, Starts and the depth
// tags are over the weeks on screen — the Analysis page's are over the whole
// season, and the two agree when the span is "Rest of season".
//
// NO REQUEST IS MADE FOR IT. Every week it shows is a roster week this page
// already holds for the "Your …" rows and the Taken table; a week still in the
// air is a blank cell until it lands. On the phone's synced copy that is zero
// ESPN requests, as for the rest of the page.
//
// ABSENT, NOT EMPTY, with "All" positions or nobody set as you: the box is
// `hidden` and its table is blank, so the page is what it was.
//
// WHERE, AND WHO (Tim, later on 2026-10-09: "move that who to start box … to
// right above the list of available players so you don't have to scroll to
// compare. Also remove any players on the who to start list that aren't
// currently on your team. Just don't mark the past weeks with a green line if
// a player who isn't currently on the team started"). It is `#startBox`,
// inside the Available panel and directly on top of `#waiverTable`. Its rows
// are the men on your roster now (`currentOnly`); the marks are still each
// week's best lineup over that week's real squad, so a week a departed man
// started in shows one mark fewer and nobody else's mark, Starts, Avg or depth
// tag changes — each is counted on the man's own row, and depth already ranked
// only the men held now.

/** Bumped whenever a roster week lands or the league changes: the memo key. */
let startRev = 0;

/** The box's columns: the played weeks, then the weeks being priced. */
function startWeeks() {
  const shown = shownWeeks();
  return [...pastWeeks(shown), ...shown];
}

/** week -> that week's squads, for the box's weeks that have landed. */
let startHeld = { key: null, map: new Map() };
function startSeasonWeeks() {
  const weeks = startWeeks();
  const key = `${state.token}:${startRev}:${weeks.join(',')}`;
  if (startHeld.key === key) return startHeld.map;
  const map = new Map();
  for (const w of weeks) {
    const teams = state.rosterWeeks.get(w) || state.past.teams.get(w);
    if (teams && teams.length) map.set(w, teams);
  }
  startHeld = { key, map };
  return map;
}

/** The week the box is anchored on: this week, else the first one held. */
function startAnchor() {
  const held = startSeasonWeeks();
  if (held.has(state.currentWeek)) return state.currentWeek;
  const shown = shownWeeks().find((w) => held.has(w));
  return shown ?? [...held.keys()][0] ?? null;
}

/** Actual | Proj for the played weeks — the select in the box's own header. */
const startHistory = () => (prefs.get('startHistory', 'actual') === 'proj' ? 'proj' : 'actual');

/** This page's state, in the names js/who-to-start.js reads. */
const startView = {
  get seasonWeeks() { return startSeasonWeeks(); },
  get seasonFailed() {
    return new Set(startWeeks().filter((w) =>
      state.failedRosterWeeks.has(w) || state.past.failed.has(`roster:${w}`)));
  },
  get weeks() { return startWeeks().filter((w) => !isPlayoff(w)); },
  get poWeeks() { return startWeeks().filter(isPlayoff); },
  get playedWeeks() { return state.playedWeeks; },
  get week() { return startAnchor(); },
  get data() {
    const w = startAnchor();
    return w === null ? null : { teams: startSeasonWeeks().get(w) };
  },
  get isDemo() { return state.isDemo; },
  get byes() { return state.byes; },
  get startersPos() { return state.position; },
};

starters.configure({
  state: startView,
  valueOn,
  asValue,
  historyMode: startHistory,
  sourceKey: () => `players:${state.token}:${startRev}`,
  glanceFor: (p) => glanceFor(p, false),
  // This page's two differences from the Analysis box (Tim, 2026-10-09):
  // only the men on your roster NOW — a man since dropped or traded has no
  // row, and the week he started in has no mark for it (nobody else's mark
  // moves) — and no band row in the table: Actual | Proj is on the heading.
  currentOnly: true,
  historyBand: false,
});

/** Your squad in the anchor week, or null when the box has nobody to be about. */
function startTeam() {
  if (state.position === 'ALL') return null;
  const me = myTeamId();
  if (me === null || me === undefined) return null;
  const data = startView.data;
  return (data && (data.teams || []).find((t) => String(t.id) === String(me))) || null;
}

function renderStartBox() {
  const panel = $('startBox');
  const table = $('startersTable');
  if (!panel || !table) return;
  const team = startTeam();
  const d = team ? starters.startersData(team) : null;
  if (!d || !d.show) {
    panel.hidden = true;
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '';
    return;
  }
  $('startersTitle').textContent = `Who to start · ${d.label}`;
  // The select the Analysis box carries in its band row, on the heading line
  // here: shown while the box has a played week to be about.
  const hist = $('startHist');
  if (hist) {
    const proj = d.mode === 'proj';
    hist.hidden = !d.weeks.some((w) => d.hist.has(w));
    hist.title = starters.playerHistorySays(proj);
    hist.querySelector('select').value = proj ? 'proj' : 'actual';
  }
  table.querySelector('thead').innerHTML = starters.startersHeadHtml(d);
  table.querySelector('tbody').innerHTML = starters.startersBodyHtml(team, d);
  panel.hidden = false;
  resort(table);
}

// --------------------------------------------------------------------- render

function render() {
  // Before anything is painted: a `?player=` link may need to move the filters
  // it is about to be drawn under. Idempotent once it has found its man.
  settleSpotlight(shownWeeks());

  syncSource();
  renderTeamPicker();
  syncSegmented('posFilter', 'pos', state.position);
  syncSegmented('takenPosFilter', 'pos', state.takenPosition);
  // One span, two controls showing it. Both are painted from the same state, so
  // they can never drift apart and disagree about which weeks are on screen.
  syncSegmented('spanFilter', 'span', state.span);
  syncSegmented('takenSpanFilter', 'span', state.span);
  // Proj | Value: one setting, shown on both tables — and on neither until the
  // league's lines are known, so a page without them is the page it always was.
  for (const [box, id] of [['showCtl', 'showToggle'], ['takenShowCtl', 'takenShowToggle']]) {
    if (!$(box) || !$(id)) continue;
    $(box).hidden = state.value.base === null;
    syncSegmented(id, 'show', state.show);
  }

  $('modeBadge').className = 'badge ' + (state.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = state.isDemo ? 'Demo' : 'Live';

  const weeks = shownWeeks();
  $('pageSub').textContent = state.isDemo
    ? 'Showing a generated sample waiver wire so you can see the layout with real-looking projections in it.'
    : `${state.leagueName} · ${state.pool.size || 'no'} available players · ${weekRange(weeks)}`;

  renderCost(weeks);
  renderCounts(weeks);
  renderStartBox();
  renderTable(weeks);
  renderStats(weeks);
  renderNote(weeks);
  // The second panel is drawn from the same cache in the same pass, so neither
  // its own position filter nor the shared span costs a request to answer.
  renderTaken(weeks);
  renderTakenStats(weeks);
  renderTakenNote(weeks);
  syncKeys('waiverLegend', 'waiverTable');
  syncKeys('takenLegend', 'takenTable');

  // Last, because both are about rows that have to exist first.
  renderJump(weeks);
  scrollToSpotlight();
  // An open row shows the man's own Value: ask for them once (no-op otherwise).
  ensurePlayerValues();
}

/**
 * A key names a mark only while the table is drawing it. Each such key carries
 * `data-when`, the selector for the mark, and is hidden when nothing matches —
 * so a wire with no byes in view says nothing about byes, and the W tag's key
 * appears only when somebody on the list is on waivers.
 */
function syncKeys(legendId, tableId) {
  const legend = $(legendId);
  const body = $(tableId) && $(tableId).querySelector('tbody');
  if (!legend || !body) return;
  legend.querySelectorAll('[data-when]').forEach((el) => {
    if (body.querySelector(el.getAttribute('data-when'))) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });
}

function syncSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

function syncSegmented(id, key, value) {
  $(id)
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset[key] === String(value)));
}

/**
 * What the chosen span costs, said next to the control that spends it — and
 * now next to BOTH copies of that control, because either one spends it.
 */
function setCost(text) {
  $('spanCost').textContent = text;
  $('takenSpanCost').textContent = text;
}

function renderCost(weeks) {
  // The playoff weeks cost what any week costs, and the line says how many of
  // the weeks being paid for are those.
  const po = weeks.filter(isPlayoff).length;
  const poBit = po ? ` (${po} of them playoff)` : '';
  if (state.isDemo) {
    setCost(`${plural(weeks.length, 'week')} shown${poBit}. Demo data costs nothing to widen.`);
    return;
  }
  // A week costs the wire AND that week's rosters, always — the Taken players
  // table needs every squad in the league whether or not one of them is yours,
  // so the roster read is no longer conditional on a team being set as you.
  // Two requests a week for everybody, and the line has to say two: it used to
  // read "one per week" when nobody was set as you, and leaving it that way now
  // would understate the choice by exactly half.
  const per = 2;

  const have = weeks.filter((w) => state.weekData.has(w)).length +
    weeks.filter((w) => state.rosterWeeks.has(w)).length;
  const gone = weeks.filter((w) => state.failedWeeks.has(w)).length +
    weeks.filter((w) => state.failedRosterWeeks.has(w)).length;
  const todo = weeks.length * per - have - gone;

  const bits = [];
  if (have) bits.push(`${have} loaded`);
  if (todo) bits.push(`${todo} to fetch`);
  if (gone) bits.push(`${gone} refused`);

  // Short on purpose: on a phone this sat above the first row as three lines.
  // It still says the count, what each week buys, and why it cannot be one.
  // The played weeks left of the line are bought too, once, whatever the span.
  const played = pastWeeks(weeks).length;
  setCost(
    `${plural(weeks.length, 'week')}${poBit} = ${plural(weeks.length * per, 'request')} to ESPN ` +
    `(wire + rosters per week; there is no bulk form).` +
    (bits.length ? ` ${bits.join(', ')}.` : '') +
    (played ? ` Played weeks: up to ${played * per} more.` : '')
  );
}

function paintCounts(id, counts) {
  $(id).querySelectorAll('button[data-pos]').forEach((b) => {
    const n = counts[b.dataset.pos] ?? 0;
    const slot = b.querySelector('.seg-count');
    // Blank rather than a row of zeroes before anything has loaded: a zero is a
    // claim that there are none, which is not what "we have not read it yet"
    // means anywhere else on this page.
    if (slot) slot.textContent = counts.ALL ? String(n) : '';
  });
}

function renderCounts(weeks) {
  paintCounts('posFilter', countsOf(state.pool.values()));
  paintCounts('takenPosFilter', countsOf(buildTakenRows(weeks).map((r) => r.p)));
}

/**
 * The previous weeks' headers, and the class the first priced week's header
 * takes: with previous weeks drawn, the bracket off Avg (`grouped`) moves to
 * the first of them and the first priced week carries the heavy line instead.
 */
function pastHeads(weeks) {
  const past = pastWeeks(weeks);
  const every = [...past, ...weeks];
  return {
    every,
    first: past.length ? 'fut-start' : 'grouped',
    html: past
      .map((w, i) => weekHead(w, every, {
        cls: `wk-past${i === 0 ? ' grouped' : ''}`,
        title: `ESPN’s projection for week ${w}, already played${valueOn() ? ', as a Value' : ''}. Not in Avg.`,
      }))
      .join(''),
  };
}

/** A priced week's header title, and Avg's: what the numbers under them are right now. */
const weekTitle = (w) => (valueOn()
  ? `ESPN’s projected points for week ${w}, as a Value: points over the waiver line at his position.`
  : `ESPN’s projected points for week ${w}.`);
const avgTitle = () => (valueOn()
  ? 'The mean of the Values shown, over the regular-season weeks that project above zero — ours, not ESPN’s.'
  : 'The mean of the regular-season weeks shown that project above zero — ours, not ESPN’s.');

function renderHead(weeks) {
  const past = pastHeads(weeks);
  const cols = past.html + weeks
    .map((w, i) => {
      const failed = state.failedWeeks.has(w);
      const cls = [i === 0 ? past.first : '', failed ? 'muted' : ''].filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : weekTitle(w);
      return weekHead(w, past.every, { cls, title });
    })
    .join('');

  $('waiverTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort title="A free agent you could claim; click a name for the rest of his season and his actual scores.">Player</th>
       <th class="left" data-sort title="His position.">Pos</th>
       <th class="left" data-sort title="His NFL team.">Tm</th>
       <th data-sort title="${avgTitle()}">Avg</th>
       <th data-sort title="${esc(gainTitle())}">Gain</th>
       ${cols}
     </tr>`;
}

// ====================================================================
// THE GREEN BOX: YOU WOULD START THIS PLAYER THIS WEEK
// ====================================================================
//
// Tim, 2026-10-09: "instead of having the box in green be beats your worst man,
// have it be 'you would start this player this week' if it's boxed in green."
//
// So, per week cell and each on its own week: put the free agent on your
// roster, fill the league's lineup slots with the site's solver
// (`optimalLineup`, each man at his projection for THAT week), and box the
// cell when he is one of the starters. A FLEX is a slot like any other, so a
// back who cannot beat your RB2 but beats your flex man is boxed.
//
//   - YOUR ROSTER is the squad you hold in the earliest week on screen — the
//     one the "Your …" rows and Gain use: a claim made now joins the roster as
//     it stands now. Each man's number is that week's roster read.
//   - THE SLOTS are the Gain column's: counted off the league's lineups.
//   - A BYE OR A RULED-OUT MAN of yours projects 0 and simply loses his place;
//     a man with no number that week is not in the lineup at all.
//   - LEVEL DOES NOT START: the solver gives a tie to the man listed first,
//     and the free agent is listed last.
//   - A WEEK IN PROGRESS: a man of yours whose game is over is locked — a
//     starter keeps his slot, a bench man cannot be used — so the free agent
//     is judged for the slots still open.
//   - NO LINEUP, NO BOX: nobody set as you, or that week's rosters not read.
//
// ALWAYS ON PROJECTIONS, also when the table is showing Value: this is a
// lineup question and a lineup is filled on projections.
//
// The old meaning of the box — "out-projects your own worst man at his
// position" — is gone with it, and so is the green NUMBER (a set bar per
// position, "worth starting"): one claim cue on this table, not two.

/**
 * The judge for one paint: `(p, v, i) -> null | { starts, out, bar }` for free
 * agent `p` projecting `v` in `weeks[i]`, or null when there is no lineup of
 * yours to judge him against at all.
 *
 * `out` is the starter he would send to your bench (null when he fills an
 * empty slot); `bar` is, when he would NOT start, your weakest starter in a
 * slot his position may fill. Both are `{ name, projected }` for the preview.
 */
function lineupTest(weeks) {
  const teamId = myTeamId();
  if (teamId === null) return null;
  const anchor = weeks.find((w) => state.rosterWeeks.has(w));
  if (anchor === undefined) return null;
  const teams = state.rosterWeeks.get(anchor) || [];
  const team = teams.find((t) => t.id === teamId);
  if (!team || !(team.players || []).length) return null;
  const slots = slotsForLeague(slotCountsFromLineups(teams));

  const squads = weeks.map((week) => {
    if (!state.rosterProj.has(week)) return null;
    const over = state.rosterDone.get(week) || new Map();
    const thatWeek = (state.rosterWeeks.get(week) || []).find((t) => t.id === teamId);
    const seat = new Map(((thatWeek && thatWeek.players) || []).map((p) => [p.playerId, p]));
    const open = slots.slice();
    const pool = [];
    for (const p of team.players) {
      if (p.playerId === null || p.playerId === undefined) continue;
      const v = rosterValueFor(p.playerId, week);
      if (typeof v !== 'number') continue;
      const done = over.get(p.playerId);
      // Locked: his game is over. (`done` with a 0 he was never projected to
      // beat is a man with no game — a bye — and he is an ordinary zero.)
      if (done && !(v === 0 && !(done.pregame > 0))) {
        const was = seat.get(p.playerId);
        const at = was && was.started ? open.indexOf(was.lineupSlotId) : -1;
        if (at >= 0) open.splice(at, 1);
        continue;
      }
      pool.push({ playerId: p.playerId, name: p.name, position: p.position, projected: v });
    }
    return { open, pool, before: optimalLineup(pool, open).starters };
  });

  const memo = new Map();
  return (p, v, i) => {
    const squad = squads[i];
    // A zero or less is never a man you would start, whatever slot is empty.
    if (!squad || typeof v !== 'number' || !(v > 0)) return null;
    const key = `${i}|${p.position}|${v}`;
    if (memo.has(key)) return memo.get(key);
    const after = optimalLineup(
      [...squad.pool, { position: p.position, projected: v, claimed: true }], squad.open).starters;
    const starts = after.some((s) => s.claimed);
    const man = (s) => (s ? { name: s.name, projected: s.projected } : null);
    const eligible = (s) => (espn.SLOT_ELIGIBILITY[s.slotId] || []).includes(p.position);
    const got = {
      starts,
      out: starts
        ? man(squad.before.find((b) => !after.some((a) => a.playerId === b.playerId)))
        : null,
      bar: starts
        ? null
        : man(squad.before.filter(eligible).reduce((a, b) => (!a || b.projected < a.projected ? b : a), null)),
    };
    memo.set(key, got);
    return got;
  };
}

// ====================================================================
// THE RED/GREEN SCALE'S COMPARISON GROUPS ON THIS PAGE
// ====================================================================
//
// THE GROUP IS A POSITION, ALWAYS, and never a whole table. A column of this
// page runs straight through every position — a quarterback's 18 sits two rows
// above a kicker's 7 — so one scale down a column would paint every kicker red
// for being a kicker, which is the exact failure rule 14 forbids. So every
// scale here is built per position and a cell is only ever measured against
// men who play the same one.
//
// WHICH POOL, and this is the decision worth arguing rather than the
// arithmetic. Three groups were possible for a free agent's number:
//
//   - THE WIRE AT HIS POSITION — the other free agents you could claim. CHOSEN.
//     The question this table exists to answer is "who should I claim", and a
//     free agent's 9.2 only means something against the other men you could
//     claim instead. Green here reads "the best of what is actually available",
//     which is a claim the reader can act on.
//   - THE WHOLE POSITION POOL, wire and rosters together. REJECTED, and not
//     narrowly: free agents are by definition the men nobody wanted, so almost
//     every wire cell would come out red. That is true and useless — a table
//     that is red from top to bottom teaches a reader to stop looking at the
//     colour, which costs the cue everywhere else it is used.
//   - THE WEEK. REJECTED for the Avg column, because Avg spans several weeks
//     and there is no single week to compare it in. It IS the group used on the
//     Taken table's week columns, where each column really is one week.
//
// THE POOL IS ALWAYS THE UNFILTERED ONE. Every scale is built before the
// position buttons are applied, so pressing RB — or FLEX, which is three
// positions at once — repaints the table and changes NOT ONE CELL'S COLOUR.
// That is the same rule the green box already follows (`hot-check.mjs` asserts
// it), and for the same reason: a colour that moved when you filtered
// would be a colour about the filter rather than about the player.

/**
 * Whether a week's value is a PROJECTION or one of the states.
 *
 * A zero is never a claim about how good a man is — it is his bye, a man ESPN
 * has ruled out, or ESPN saying nothing will happen — and the cell already
 * spends its own treatment saying which. Leaving zeros in would also break the
 * arithmetic: a position-week whose values cluster at 0 and at 12 is bimodal,
 * and a couple of byes roughly double the standard deviation, which drags every
 * real number back inside the middle band and switches the colour off exactly
 * where it was wanted. The same rule, for the same two reasons, as the
 * `A week` grid on the Analysis page.
 */
const measurable = (v) => typeof v === 'number' && v !== 0;

/**
 * position -> a scale over one number per row, for the rows at that position.
 *
 * @param {Array} rows the UNFILTERED rows (see the block above)
 * @param {Function} pick row -> the number this scale is over
 */
function scalesByPosition(rows, pick) {
  const byPos = new Map();
  for (const r of rows) {
    if (!byPos.has(r.p.position)) byPos.set(r.p.position, []);
    byPos.get(r.p.position).push(pick(r));
  }
  return new Map([...byPos].map(([pos, vals]) => [pos, heatScale(vals)]));
}

/**
 * position -> one scale per WEEK COLUMN, for the Taken table's week cells.
 *
 * Two facts at once, and both are needed: a tight end's week 9 is measured
 * against the other tight ends' week 9 and against nothing else. Per position
 * because a kicker is not a quarterback; per week because a heavy bye week is
 * not a bad week for the man playing in it, and one scale across a row would
 * paint the whole league's byes red.
 */
function weekScalesByPosition(rows, weeks) {
  const byPos = new Map();
  for (const r of rows) {
    if (!byPos.has(r.p.position)) byPos.set(r.p.position, weeks.map(() => []));
    const cols = byPos.get(r.p.position);
    // (a game already over is a score, not a projection: `scaleNumber`
    // leaves it out). On Value the numbers compared are the Values shown.
    r.values.forEach((_, i) => {
      const n = scaleNumber(r, i);
      if (n !== null && i < cols.length) cols[i].push(n);
    });
  }
  return new Map([...byPos].map(([pos, cols]) => [pos, cols.map((vals) => heatScale(vals))]));
}

/**
 * The points at which each position reaches full colour, as a strip of pairs.
 *
 * IN POINTS, because that is what makes a colour checkable rather than
 * decorative — a reader looks at a green cell, reads the pair off this strip and
 * decides for himself whether the cell deserves it. Six pairs is short enough
 * to print; the Taken table's WEEK scales are six per week and are not, so
 * those are left to each cell's own `title`, exactly as the Stats page's week
 * grid does it.
 *
 * IT IS DRAWN INSIDE "How to read this table" AND NOT UNDER THE TABLE. That is
 * the 2026-09-19c change and it is a placement, never a deletion: six pairs
 * plus the sentence carrying them measured 88 visible words under the wire and
 * 105 under the taken table, which `node tests/text-audit.mjs` scored as this
 * page going from 106 to 299 words of visible prose. HANDOFF's panel shape puts
 * the full method behind the toggle and keeps a small key on screen, so the
 * strip moved into the toggle beside the prose that explains it and
 * `renderWireHeatKey` / `renderTakenHeatKey` kept the one short sentence.
 */
function heatBandsHtml(scales) {
  const drawn = [...scales.entries()].filter(([, s]) => s);
  if (!drawn.length) return '';
  const round1 = (v) => Math.round(v * 10) / 10;
  return POSITIONS
    .filter((pos) => scales.has(pos))
    .map((pos) => {
      const s = scales.get(pos);
      if (!s) return `<strong>${esc(pos)}</strong> &mdash;`;
      const edge = s.edges[s.edges.length - 1];
      return `<strong>${esc(pos)}</strong> ${fmt(round1(s.mean - edge * s.sd))} / ` +
        `${fmt(round1(s.mean + edge * s.sd))}`;
    })
    .join(' &middot; ');
}

/**
 * One week's cell.
 *
 * `roster` marks a cell whose number came from the roster payload rather than
 * the wire — a comparison row, or any row in the Taken players table. It
 * changes two things: the week it is waiting on is the ROSTER read rather than
 * the wire read, and it is never boxed. The box is an argument for a claim,
 * and a man already on a roster cannot be claimed.
 *
 * `starts`: with him on your roster, your best lineup that week has him in it
 * (`lineupTest`). That cell is boxed in green — the class is still `beats`,
 * from when the box meant "beats your worst man" (the suites assert on it).
 *
 * `scale` is the shared red/green scale for THIS position in THIS week: the
 * rostered men's on the Taken table, the free agents' on the wire (a "Your …"
 * row is measured against the free agents too, and is not counted among them).
 * On the wire the box sits on top of it — see `td.beats` in waivers.html.
 */
function cell(v, week, p, roster = false, starts = false, scale = null, done = null, shown = undefined) {
  const { name, position } = p;
  // `done`: his game that week is over and `v` is what he scored — see
  // doneCell(). A man with no game falls through to the Bye he always was.
  if (done && typeof v === 'number' && !doneIsBye(v, week, p, roster, done)) return doneCell(v, done);
  if (v === undefined) {
    // Three ways to have no number, and a reader has to be able to tell them
    // apart: still coming, refused outright, or ESPN simply had nothing.
    if (roster ? state.failedRosterWeeks.has(week) : state.failedWeeks.has(week)) {
      return `<td class="muted" title="${
        roster
          ? `ESPN refused week ${week}’s rosters, so there is no projection for anyone ` +
            `on a roster that week. Reload the page to try again.`
          : `Week ${week} did not load — ESPN refused it, so this column is empty for ` +
            `everyone. Reload the page to try again.`
      }">${dash}</td>`;
    }
    return `<td class="wait" title="${
      roster
        ? `Week ${week}’s rosters have not been read from ESPN yet.`
        : `Week ${week} has not been read from ESPN yet.`
    }">·</td>`;
  }
  if (v === null) {
    // No data-v at all — never data-v="" — so an unknown sinks to the bottom
    // whichever way the column is sorted.
    return `<td title="ESPN’s week ${week} ${roster ? 'rosters carried' : 'list carried'} ` +
      `no projection for ${esc(name)}.">${dash}</td>`;
  }
  if (v === 0) {
    // A 0.00 is a bye ONLY in his NFL team's bye week: ESPN also projects a man
    // it has ruled out at 0.00. Decided in js/player-card.js, once for the site.
    // The sample wire carries each man's bye week; the sample ROSTERS mean
    // "ruled out" by a zero and never a bye, which is what `demo` says.
    const status = roster ? rosterStatusFor(p, week) : p.injuryStatus;
    const zero = zeroKind(v, {
      week,
      byeWeek: byeWeekOf(p, state.byes),
      injuryStatus: status,
      demo: roster && state.isDemo,
    });
    if (zero === 'bye') {
      return `<td class="bye" data-v="0" ` +
        `title="${esc(name)} is on bye in week ${week}. ESPN returns 0.00 for a bye, ` +
        `which is not the same as a projection of nothing.">Bye</td>`;
    }
    const bye = byeWeekOf(p, state.byes);
    const why = `${esc(name)} is projected at 0.0 in week ${week}` +
      (bye ? `, which is not his bye (week ${bye})` : '') +
      (zero === 'out' ? ` — listed ${esc(String(status).replace(/_/g, ' ').toLowerCase())} that week.` : '.');
    // A real zero. Nobody would start it, so it is never boxed; the word is
    // what says it is not a bye.
    if (zero === 'out') {
      return `<td class="zero-out" data-v="0" title="${why}">0.0 ` +
        `<span class="zmark">${esc(outMark(status))}</span></td>`;
    }
    return `<td class="zero" data-v="0" title="${why}">0.0</td>`;
  }
  // A zero has already returned above, so the box cannot fire on one.
  const beats = !roster && starts === true;
  // The scale. `measurable` has already been satisfied by the returns above —
  // every zero left before this line.
  // ON VALUE (`shown`, from `withShown`) the cell prints that projection's
  // Value and is coloured and sorted by it. The box stays a fact about the
  // projection: a lineup is filled on projections (`lineupTest`).
  const n = shown === undefined ? v : shown;
  if (n === null) {
    return `<td title="No Value can be said at ${esc(position)}.">${dash}</td>`;
  }
  const heat = heatOf(n, scale);
  // THE WORDS ARE IN THE PREVIEW (`weekCard`): the number, the group it was
  // measured against, and the man of yours he would sit. So no `title` here —
  // a card and a title on one cell would be two tooltips.
  const cls = [beats ? 'beats' : '', heat ? heat.cls : '']
    .filter(Boolean).join(' ');
  return `<td${cls ? ` class="${cls}"` : ''} data-v="${n}" data-c="wk" data-w="${week}">` +
    `${fmt(n)}${heatMarkHtml(heat)}</td>`;
}

/**
 * A row's addressable identity, so a later change can find one man's row.
 *
 * This is what `waivers.html?player=<id>` lands on, from anywhere on the site.
 *
 * `data-player` goes on every row; the `id` does not. A player appears at most
 * once on the wire and once in the Taken table — those sets are disjoint, since
 * a man cannot be both rostered and free — but a "Your QB3" comparison row is a
 * SECOND appearance of somebody who already has a row in the Taken table, and
 * two elements with the same id is not a document. So the comparison rows carry
 * the data attribute and let the Taken table own the id.
 */
function rowIdentity(playerId, { addressable = true, cls = '' } = {}) {
  // The classes are built here rather than by each caller because the spotlight
  // has to merge with whatever else the row is wearing — two class attributes on
  // one element is not a document, and the second one silently loses.
  //
  // The spotlight follows `addressable` for exactly the reason the id does. A
  // man who is both somebody's rostered player and your own "Your QB2" is ONE
  // arrival at TWO rows, and marking both of them lit up a comparison row the
  // link had not been aimed at while `scrollIntoView` went to the real one — so
  // the page highlighted one row and moved to another. Found by `link-check`
  // when the Trade page was added and its sample happened to pick such a man;
  // every earlier sample had missed him, which is the whole argument for that
  // suite existing.
  const spotlit = addressable && playerId === state.spotlight;
  const classes = [cls, spotlit ? 'spotlight' : ''].filter(Boolean).join(' ');
  return `${addressable ? ` id="p${esc(playerId)}"` : ''} data-player="${esc(playerId)}"` +
    (classes ? ` class="${classes}"` : '');
}

/**
 * A player's name, as the link every page on the site points at him with.
 *
 * A real href rather than a click handler, so middle-click and open-in-a-new-tab
 * behave — and so the same markup works whether you arrive from another page or
 * click it here. On this page the click is intercepted and answered without a
 * reload, because everything needed to answer it is already in the cache.
 */
function playerLink(p, inner, why, opens = false) {
  if (p.playerId === null || p.playerId === undefined) return inner;
  // `aria-label`, not `title`: a title on a link is the one thing HANDOFF's
  // touch rule forbids — js/touch-titles.js leaves links alone, so the words
  // could never be read on a phone, and the W and injury tags beside the name
  // carry their own titles as spans.
  // `opens`: this is the row his Actual row drops under, so the link says
  // whether it is open (a "Your …" row sends you to his Taken row instead).
  const expanded = opens ? ` aria-expanded="${p.playerId === state.open ? 'true' : 'false'}"` : '';
  return `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ` +
    `aria-label="${why}"${expanded}>${inner}</a>`;
}

/** The injury tag beside a name. Same markup wherever the player came from. */
function injuryTag(status) {
  return status
    ? ` <span class="tag ${status.cls}" title="${esc(status.why)}">${status.tag}</span>`
    : '';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "W · Fri" beside a man still on waivers; nothing for a free agent.
 *
 * A claim on him is not an add: it waits for the waiver run, and somebody with
 * a better priority can take him first. That changes what a green cell is
 * worth, so it is said on the row rather than in the toggle.
 *
 * A `title` on a SPAN, never on the player link: js/touch-titles.js makes a
 * titled span tappable on a phone and deliberately leaves links alone.
 */
function waiverTag(p) {
  if (p.status !== 'WAIVERS') return '';
  const when = Number.isFinite(p.waiverClears) ? new Date(p.waiverClears) : null;
  const day = when && !Number.isNaN(when.getTime()) ? DAYS[when.getDay()] : '';
  const full = when && day
    ? `${day} ${when.getDate()} ${when.toLocaleString('en-US', { month: 'short' })}`
    : '';
  const why = `On waivers${full ? ` until ${full}` : ''}: a claim waits for the waiver run, ` +
    `and a team with a better priority can take him first.`;
  return ` <span class="tag wv" title="${esc(why)}">W${day ? ` · ${day}` : ''}</span>`;
}

/**
 * The three columns after the name, shared by both kinds of row.
 *
 * THE Avg CELL IS WHERE THE RED/GREEN SCALE LIVES ON THIS PAGE. It is the
 * column that orders the table into an answer, the green box is never on it, and
 * it has no link inside it — so the cell itself opens the preview (`avgCard`):
 * hover with a mouse, a tap on a phone.
 *
 * ONE CHANNEL IS DELIBERATELY NOT USED HERE: the weight. `td.avg` in
 * waivers.html is 650 because this column is the one that orders the table, and
 * that rule outranks `.heat-up-1`. Left as it is rather than fought: the
 * scale's steps run 500 / 550 / 620 / 700, so letting them through would draw a
 * slightly-above-average cell LIGHTER than an exactly-average one, which is a
 * worse cue than none. The other three channels all hold — the tint, the ▲/▼ at
 * the ends, and the sentence on the cell.
 */
function identityCells({ p, shownAvg }, heat = null) {
  return `<td class="left" data-v="${POS_ORDER.get(p.position) ?? 9}">${esc(p.position)}</td>
      <td class="left">${esc(p.proTeam)}</td>
      ${avgCellHtml(shownAvg, heat)}`;
}

/**
 * The Avg cell itself, and there is ONE of it.
 *
 * Both tables draw this column and both put the scale on it, so a second
 * spelling would be two chances for the wire and the Taken table to disagree
 * about what a green Avg means — the same reason `cell()` is shared between
 * them rather than copied.
 */
/**
 * THE PRESEASON ARROW (Tim, 2026-09-30): "put a up or down arrow by that
 * player's name if their rest-of-season proj/week has increased or decreased by
 * more than 2 than it was at the begginning of the season". NOW is his REST OF
 * SEASON (`rosNow`: D7 over every regular-season week still to come), never
 * the span on screen — so pressing Next 3 / Next 6 / Rest of season changes no
 * arrow. Preseason and the threshold are js/proj-trend.js's. `rostered` reads
 * the rosters (Taken and "Your …" rows) rather than the wire. '' for no arrow.
 */
const trendMark = (p, rostered) => trend.trendHtml(
  trend.trendOf(p.playerId, rosNow(p, rostered), state.scoring, weekRange(rosWeeks())));

/**
 * A name cell's contents. With an arrow, they go in a `.nm-line` flex row
 * whose NAME is the one part allowed to shrink: on a phone the frozen column
 * is capped at 44vw and a long "Your QB2 Bodie Ravenscroft" used to lose the
 * arrow off its end. Without one, the markup is exactly what it always was.
 */
function nameLine(link, mark, tags = '', lead = '') {
  if (!mark) return `${lead}${link}${tags}`;
  return `<span class="nm-line">${lead}${link}${mark}${tags}</span>`;
}

/** The arrows' line behind "How to read this table": the weeks, and what they cost. */
const trendExplainLine = () => trend.trendExplain(weekRange(rosWeeks()),
  state.isDemo ? '' : 'Those weeks are read once, after the table, whatever span is shown ' +
    '(wire + rosters per week not already loaded).');

/** Fill (or empty and hide) a table's arrow key from the rows it describes (rule 16). */
function setTrendKey(id, html) {
  const el = $(id);
  if (!el) return;
  const on = trend.hasTrend(html);
  el.textContent = on ? trend.TREND_KEY : '';
  el.hidden = !on;
}

function avgCellHtml(avg, heat) {
  // The words are the preview's (`avgCard`): the weeks it is the mean of, and
  // his place in the group the colour compares him with.
  return `<td class="avg grouped${heat ? ` ${heat.cls}` : ''}"${avg === null ? '' : ` data-v="${avg}" data-c="avg"`}>${
      avg === null ? dash : `${fmt(avg)}${heatMarkHtml(heat)}`
    }</td>`;
}

/**
 * A player you could claim.
 *
 * `lineup` is this paint's `lineupTest` (null with no lineup of yours): each
 * week's cell is boxed when he would start for you that week. It reads your
 * whole roster, so the box means the same thing whichever position button is
 * pressed.
 */
function wireRow(row, weeks, lineup, avgScales, weekScales) {
  const { p, values } = row;
  const status = availability(p.injuryStatus);
  const cols = weekScales.get(p.position) || [];

  const owned = p.percentOwned === null || p.percentOwned === undefined
    ? ''
    : ` — owned in ${fmt(p.percentOwned)}% of ESPN leagues`;

  const heat = heatOf(row.shownAvg, avgScales.get(p.position));

  return `<tr${rowIdentity(p.playerId, { cls: status && status.dim ? 'unavailable' : '' })}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}">${nameLine(
        playerLink(p, esc(p.name), `${esc(p.name)}${owned} — jump to his row, show every ` +
          `remaining week and his actual scores`, true), trendMark(p, false),
        `${injuryTag(status)}${waiverTag(p)}`)}</td>
      ${identityCells(row, heat)}
      ${gainCell(p)}
      ${weekCells(p, weeks, true, p.playerId === state.spotlight, (i) =>
        // His own finished game is a score, not a week you could start him in.
        cell(values[i], weeks[i], p, false,
          Boolean(lineup && !row.done[i] && (lineup(p, values[i], i) || {}).starts),
          cols[i] || null, row.done[i], valueOn() ? row.shown[i] : undefined))}
    </tr>${actualRowIf(p, weeks, true, 4)}`;
}

/**
 * The man you would drop. Marked, not dimmed: an OUT free agent is not worth
 * reading first, but your own man being out is the whole reason to look.
 *
 * HIS Avg IS COLOURED AGAINST THE WIRE, and he is NOT in the distribution that
 * sets it. That is deliberate and is the one comparison this row exists to
 * make: the whole point of dropping your own worst man into the same tbody is
 * that he can be read against the men who might replace him, so measuring him
 * against them is the colour saying out loud what the row is for. A deep red
 * "Your RB5" under a green wire is "claim somebody", which is the answer this
 * page is here to give. He stays out of the distribution because he is not
 * claimable: the scale describes what is ON the wire, and folding a rostered
 * man into it would move the thresholds every other cell is measured against.
 */
function mineRow(row, weeks, avgScales, weekScales) {
  const { p, values, label, depth } = row;
  const cols = weekScales.get(p.position) || [];
  const why =
    `${esc(p.name)} — on your roster, not on the wire. Your lowest-averaging ` +
    `${esc(p.position)} over ${weekRange(weeks)}, of the ${depth} you hold there.`;

  const heat = heatOf(row.shownAvg, avgScales.get(p.position));

  return `<tr${rowIdentity(p.playerId, { addressable: false, cls: 'mine' })}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}">` +
        nameLine(playerLink(p, esc(p.name), why), trendMark(p, true),
          injuryTag(availability(p.injuryStatus)),
          // The label opens your men at that position (`mineCard`), keyboard included.
          `<span class="mine-tag" tabindex="0">${esc(label)}</span> `) +
        `</td>
      ${identityCells(row, heat)}
      <td class="gain"></td>
      ${weekCells(p, weeks, false, false, (i) =>
        cell(values[i], weeks[i], p, true, false, cols[i] || null, row.done[i],
          valueOn() ? row.shown[i] : undefined))}
    </tr>`;
}

function renderTable(weeks) {
  const table = $('waiverTable');
  const tbody = table.querySelector('tbody');
  // Before the head: the Gain column's title names the weeks this settles.
  prepareGain();
  renderHead(weeks);

  const all = withShown(buildRows(weeks), weeks);
  const available = all.filter(matchesFilter);
  const mineAll = withShown(buildMineRows(weeks), weeks);
  // The green box's judge, from your whole roster: no filter can move a box.
  const lineup = lineupTest(weeks);
  const mine = mineAll.filter(matchesFilter);
  const cols = pastWeeks(weeks).length + weeks.length + 5;

  // THE Avg COLUMN'S SCALES, from `all` and NOT from `available`: the filter
  // must not be able to move a colour. See the long block above
  // `scalesByPosition` for why the group is the wire at his position and not
  // the whole pool.
  const avgScales = scalesByPosition(all, (r) => r.shownAvg);
  // THE WEEK COLUMNS, one scale per position and week, over the free agents —
  // the way the Taken table has always done its own. Unfiltered, like Avg's.
  const weekScales = weekScalesByPosition(all, weeks);
  renderWireHeatKey(avgScales, available.length + mine.length > 0);
  // What the previews are built from, when one is asked for.
  Object.assign(view, {
    weeks, wireAll: all, wire: byId(all), mine: byId(mineAll), wireWeekScales: weekScales, lineup,
  });

  if (!available.length && !mine.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">${esc(emptyReason(all.length))}</td></tr>`;
    setTrendKey('waiverTrendKey', '');
    resort(table);
    return;
  }

  // One tbody, deliberately. resort() then interleaves your own man with the
  // players who might replace him, which is the entire point of the feature:
  // sort by Avg and everyone above your row is an upgrade.
  tbody.innerHTML =
    available.map((r) => wireRow(r, weeks, lineup, avgScales, weekScales)).join('') +
    mine.map((r) => mineRow(r, weeks, avgScales, weekScales)).join('');
  setTrendKey('waiverTrendKey', tbody.innerHTML);

  // Keep whatever sort the user picked when the row set changes.
  resort(table);
}

/**
 * The wire's colour key, in two layers.
 *
 * ON SCREEN, one sentence: the group the colour compares (the other free agents
 * at that position — nobody would assume that, and it is the whole reason a
 * green here means "best of what you can actually have"), that a week column
 * is compared within that week, and the two cues that survive a reader who
 * cannot separate the hues.
 *
 * BEHIND "How to read this table", the thresholds in points. They are not
 * optional — they are what makes a cell checkable by hand — but the sentence
 * carrying them was 88 of this page's 299 visible words on 2026-09-19c, which
 * is what `node tests/text-audit.mjs` is for. See `heatBandsHtml`.
 *
 * The rest of the argument — why the pool is the wire and not the league, why
 * your own row is measured against them without being counted among them, how
 * the green box sits on top of it on the week cells — is in `renderNote`, where the
 * method has always lived.
 *
 * The Gain column's shade is explained with Gain, in the same toggle.
 */
function renderWireHeatKey(avgScales, anyRows) {
  const el = $('waiverHeatKey');
  const bandsEl = $('waiverHeatBands');
  if (!el) return;
  const bands = heatBandsHtml(avgScales);
  const drawn = anyRows && bands;
  el.innerHTML = !drawn
    ? ''
    : `<strong>Colour compares free agents at the same position, week by week</strong>; ends ` +
      `carry an arrow and heavier type.`;
  if (bandsEl) {
    bandsEl.innerHTML = !drawn
      ? ''
      : `<strong>Avg, full colour at (red / green):</strong> ${bands}. Your own player’s row is ` +
        `measured against those same free agents and is not counted among them.`;
  }
}

/** An empty table says why it is empty and what to do about it. */
function emptyReason(totalPlayers) {
  if (progressText()) return 'Reading the waiver wire from ESPN…';

  if (totalPlayers > 0) {
    return `No ${filterNoun(state.position)} is available in this league right now. ` +
      `Switch the filter back to All to see the other ${plural(totalPlayers, 'player')}.`;
  }

  if (state.isDemo) return 'The demo pool is empty, which should not happen — reload the page.';

  if (!savedConfig()) {
    return 'No league is connected, so there is no waiver wire to read. ' +
      'Connect one in the bar above, or switch back to Demo data.';
  }
  if (state.failedWeeks.size) {
    return `ESPN refused every week we asked for (${andList([...state.failedWeeks].sort((a, b) => a - b).map(String))}). ` +
      'Reload the page to try again, or check the league is still readable on the Connection page.';
  }
  return 'ESPN says nobody is unrostered in this league right now. ' +
    'Every player is on a team — there is nothing to claim until somebody drops one.';
}

// --------------------------------------------------- the taken players table
//
// The same table shape as the wire, one column wider and with every cue taken
// out of it. Its own <thead>, because the Owner column is real: bolting it on
// as a variant of renderHead would mean a conditional in every cell.

function renderTakenHead(weeks) {
  const past = pastHeads(weeks);
  const cols = past.html + weeks
    .map((w, i) => {
      const failed = state.failedRosterWeeks.has(w);
      const cls = [i === 0 ? past.first : '', failed ? 'muted' : ''].filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w}’s rosters did not load — ESPN refused them. Reload the page to try again.`
        : weekTitle(w);
      return weekHead(w, past.every, { cls, title });
    })
    .join('');

  $('takenTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort title="A player already on a roster; click a name for the rest of his season and his actual scores.">Player</th>
       <th class="left" data-sort title="His position, and his rank at it on his own manager’s roster by Avg — best is 1.">Pos</th>
       <th class="left" data-sort title="His NFL team.">Tm</th>
       <th class="left" data-sort title="The manager whose roster he is on, as of the earliest week shown.">Owner</th>
       <th data-sort title="${avgTitle()}">Avg</th>
       ${cols}
     </tr>`;
}

/**
 * One rostered player.
 *
 * The Pos cell carries BOTH sort keys in one number: `POS_ORDER * 100 + rank`,
 * so the column reads QB→RB→WR→TE→K→DST and, inside each position, 1 before 2.
 *
 * An unranked man keys as `POS_ORDER * 100 + 99` — his position, then after
 * every real rank in it. That 99 is never shown and is not a rank: it is the
 * page's nulls-last convention applied INSIDE the position group, which is the
 * only place it can go, because his position is known and only his rank is not.
 * Leaving the key off entirely was tried first and is wrong here: sortable.js
 * falls back to the cell's text when there is no `data-v`, so a bare "TE" would
 * be compared as the string "te" against numbers and lead the column descending
 * — the opposite of sinking. The cells whose value really is absent — his Avg,
 * and any week ESPN had no number for — still carry no `data-v` at all.
 */
function takenRow(row, weeks, avgScales, weekScales) {
  const { p, values, owner, rank } = row;
  const status = availability(p.injuryStatus);
  const posOrder = POS_ORDER.get(p.position) ?? 9;
  const cols = weekScales.get(p.position) || [];

  return `<tr${rowIdentity(p.playerId, { cls: status && status.dim ? 'unavailable' : '' })}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}">${nameLine(
        playerLink(p, esc(p.name), `${esc(p.name)} — on ${esc(owner)}’s roster. Jump to ` +
          `his row, show every remaining week and his actual scores`, true), trendMark(p, true),
        injuryTag(status))}</td>
      <td class="left pos" data-v="${posOrder * 100 + (rank ?? 99)}" data-c="pos"${tradeHrefFor(row) ? ' data-go' : ''}>${
        esc(p.position)}${rank === null ? '' : `<span class="rank">${rank}</span>`}</td>
      <td class="left">${esc(p.proTeam)}</td>
      <td class="left owner" data-v="${esc(owner.toLowerCase())}" data-c="own" data-go>${esc(owner)}</td>
      ${avgCellHtml(row.shownAvg, heatOf(row.shownAvg, avgScales.get(p.position)))}
      ${weekCells(p, weeks, false, p.playerId === state.spotlight, (i) =>
        cell(values[i], weeks[i], p, true, false, cols[i] || null, row.done[i],
          valueOn() ? row.shown[i] : undefined))}
    </tr>${actualRowIf(p, weeks, false, 4)}`;
}

function renderTaken(weeks) {
  const table = $('takenTable');
  const tbody = table.querySelector('tbody');
  renderTakenHead(weeks);

  const all = withShown(buildTakenRows(weeks), weeks);
  const shown = all.filter(matchesTaken);
  const cols = pastWeeks(weeks).length + weeks.length + 5;

  // Built from `all`, never from `shown`: this table's own position buttons
  // must move which rows you see and nothing about their colour.
  const avgScales = scalesByPosition(all, (r) => r.shownAvg);
  const weekScales = weekScalesByPosition(all, weeks);
  renderTakenHeatKey(avgScales, shown.length > 0);
  Object.assign(view, { weeks, takenAll: all, taken: byId(all), takenWeekScales: weekScales, teamProj: null });

  if (!shown.length) {
    tbody.innerHTML =
      `<tr class="empty-row"><td colspan="${cols}">${esc(takenEmptyReason(all.length))}</td></tr>`;
    setTrendKey('takenTrendKey', '');
    resort(table);
    return;
  }

  tbody.innerHTML = shown.map((r) => takenRow(r, weeks, avgScales, weekScales)).join('');
  setTrendKey('takenTrendKey', tbody.innerHTML);
  resort(table);
}

/**
 * The visible key under the Taken table.
 *
 * WHY THIS TABLE TAKES THE SCALE AT ALL, when it has carried no colour since it
 * was built: the green box it refuses is a CLAIM cue — you would start him —
 * and nobody here can be claimed, which is still true and still the reason it
 * is absent. The red/green scale answers a different question
 * entirely, and one this table is the only place on the site that can answer:
 * of everyone in the league holding this position, how good is this one. So
 * there is no collision to fit round here, which is exactly why it is the
 * natural home for the scale on this page.
 *
 * TWO LAYERS, since 2026-09-19c. On screen: what the colour compares, and the
 * two cues that do not depend on telling red from green. Behind the toggle: the
 * Avg thresholds in points, six pairs, which is the channel that makes a cell
 * checkable by hand. The sentence that carried both was 105 of this page's 299
 * visible words — `node tests/text-audit.mjs` — and HANDOFF's panel shape wants
 * the method behind the toggle, so that is where the numbers went.
 *
 * "Neither claim green is here" is not repeated: the legend above the table
 * carries that chip, which is where it belongs and where it already was.
 *
 * The WEEK columns are six scales PER WEEK and cannot be printed anywhere
 * without burying the table, so they are left to each cell's own `title` — the
 * same choice the Stats page's week grid makes, and for the same reason.
 */
function renderTakenHeatKey(avgScales, anyRows) {
  const el = $('takenHeatKey');
  const bandsEl = $('takenHeatBands');
  if (!el) return;
  const bands = heatBandsHtml(avgScales);
  const drawn = anyRows && bands;
  el.innerHTML = !drawn
    ? ''
    : `<strong>Colour compares men at the same position, week by week</strong>; ends carry an ` +
      `arrow and heavier type.`;
  if (bandsEl) {
    bandsEl.innerHTML = !drawn
      ? ''
      : `<strong>Avg, full colour at (red / green):</strong> ${bands}. A quarterback is never ` +
        `measured against a kicker, and each week column only with that same week, so a heavy ` +
        `bye week is not a red stripe. A Bye or a 0.0 is never coloured. Tap any number for ` +
        `where it stands.`;
  }
}

/** An empty taken table says why it is empty and what to do about it. */
function takenEmptyReason(totalPlayers) {
  if (progressText()) return 'Reading the league’s rosters from ESPN…';

  if (totalPlayers > 0) {
    return `Nobody in this league is holding a ${filterNoun(state.takenPosition)} right now. ` +
      `Switch the filter back to All to see the other ${plural(totalPlayers, 'player')}.`;
  }

  if (state.isDemo) {
    return 'The demo squads could not be generated this time, so there is nobody to list. ' +
      'Reload the page, or switch to your ESPN league.';
  }
  if (!savedConfig()) {
    return 'No league is connected, so there are no rosters to read. ' +
      'Connect one in the bar above, or switch back to Demo data.';
  }
  if (state.failedRosterWeeks.size) {
    return `ESPN refused the rosters for every week we asked for ` +
      `(${andList([...state.failedRosterWeeks].sort((a, b) => a - b).map(String))}). ` +
      'Reload the page to try again, or check the league is still readable on the Connection page.';
  }
  return 'ESPN returned no rosters for this league, so there is nobody to list here.';
}

function renderTakenStats(weeks) {
  const el = $('takenStats');
  const rows = withShown(buildTakenRows(weeks), weeks).filter(matchesTaken);

  if (!rows.length) {
    el.innerHTML = '';
    return;
  }

  // The best of the Avg column as it is drawn (its Values, on Value).
  const rated = rows.filter((r) => r.shownAvg !== null);
  const best = rated.length ? rated.reduce((a, b) => (b.shownAvg > a.shownAvg ? b : a)) : null;
  const label = state.takenPosition === 'ALL'
    ? 'Taken'
    : `Taken ${filterLabel(state.takenPosition)}`;

  const items = [
    [label, String(rows.length), `across ${plural(new Set(rows.map((r) => r.owner)).size, 'squad')}`],
    ['Weeks shown', String(weeks.length), weekRange(weeks)],
  ];
  if (best) items.push(['Best average', fmt(best.shownAvg), `${best.p.name} · ${best.owner}`]);

  el.innerHTML = items
    .map(([k, v, who]) =>
      `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>` +
      `${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`)
    .join('');
}

/**
 * What the taken table's numbers are, said every time they are shown.
 *
 * Six things have to be in here or the table is quietly misleading: whose
 * projections these are, what Avg is and that it is ours, what the number after
 * the position means and that the span moves it, which week decides who owns
 * whom, that a Bye cell and a blank cell are different facts, and why nothing
 * is coloured.
 */
function renderTakenNote(weeks) {
  // Two outputs: `status` is the short, always-visible line under the stat
  // tiles (demo notice, errors, progress); `parts` is the full explanation,
  // one paragraph each, behind the "How to read this table" toggle.
  const status = [];
  const parts = [];

  if (state.isDemo) {
    status.push('Demo data: invented squads, not your real league.');
    parts.push(lead('The numbers') +
      'These are the demo league’s invented squads with invented projections — not ESPN’s, ' +
      'and not your league’s. Connect a league in the bar above, or use the toggle, to read the real rosters.');
  } else {
    parts.push(lead('The numbers') +
      'Every number here is ESPN’s own projection for that player in that week, scored under ' +
      'this league’s rules — the same figures as the table above, read off each week’s rosters ' +
      'instead of the wire. Nothing on this table is our forecast except the average and the ' +
      'rank beside the position.');
  }

  parts.push(
    lead('Who is listed') +
    `Everyone on a roster in <strong>any</strong> of ${weekRange(weeks)} — a man picked up in ` +
    `${weeks.length > 1 ? `week ${weeks[1]}` : 'a later week'} belongs in a table whose columns ` +
    `include that week. Owner is the manager holding him in the earliest of those weeks he ` +
    `actually appears in, which is the most recent squad this page knows him to have been on. ` +
    `His week numbers still come from each week’s own payload, so no projection is borrowed ` +
    `across weeks, and a week he was not rostered for is blank rather than guessed at.`
  );

  parts.push(
    lead('Avg') +
    'Avg is the mean of the weeks shown and is ours, not ESPN’s: only weeks projecting above ' +
    'zero count, so a bye, a man ruled out and a week with no number at all are all left out — ' +
    'the same rule as the Trade page’s per-week figure. ' + PLAYOFF_NOTE + ' It is ' +
    'worked out exactly the way the Avg in the table above is, so the two can be read against each other.'
  );

  parts.push(
    lead('The rank') +
    'The number after the position is where he ranks on his own manager’s roster by that Avg — ' +
    'QB3 is that manager’s third-best quarterback over the weeks currently shown, and 1 is the ' +
    'best. It is our ordering rather than ESPN’s depth chart, and it moves with the span: widen ' +
    'the weeks and a QB2 can become a QB3, exactly as widening it can change which of your men ' +
    'appears as Your QB3 above. A player ESPN carried no number for over these weeks cannot be ' +
    'ranked at all, so he shows the bare position with no number against it, and sorts to the ' +
    'end of his own position rather than to a rank we made up. His Avg is blank for the same ' +
    'reason, and a blank Avg carries no sort key at all.'
  );

  // THE GREEN BOX, AND WHY IT IS NOT HERE. The lead scopes the sentence to the
  // box: this table has carried the shared red/green scale since 2026-09-19b
  // and the exception is named in the same breath so the paragraph cannot be
  // read as "no colour at all".
  parts.push(
    lead('No green box') +
    'Nothing here is boxed, on purpose: the green box in the table above argues for a waiver ' +
    'claim, and nobody on this list can be claimed. ' +
    'The red/green scale below is a different thing and asks a different question.'
  );

  parts.push(
    lead('The red/green scale') +
    describeHeatPerColumn({ group: 'position', what: 'everyone else in the league at that position' }) +
    ' Avg is measured over the weeks shown; a week cell is measured against those same men ' +
    '<strong>in that same week</strong>, so a heavy bye week is not a red stripe down the table. ' +
    'A <strong>Bye</strong>, a ruled-out <strong>0.0</strong> and a blank are never coloured and ' +
    'never counted: none of them is a claim about how good the man is, and a couple of zeros in a ' +
    'column would roughly double its spread and switch the colour off for everybody else. ' +
    'Pressing a position button changes which rows you see and <strong>not one cell’s ' +
    'colour</strong> — every scale is built from the whole league before the filter is applied.'
  );

  parts.push(
    lead('Bye and blank') +
    'A cell reading Bye is the 0.00 ESPN returns for a player whose NFL team is off that week; ' +
    'a blank cell means that week’s rosters carried no number for him at all. Those are not the ' +
    'same thing, so they are not drawn the same way. ' + ZERO_NOTE
  );

  parts.push(
    lead('The controls') +
    'This table has <strong>its own position buttons</strong>, and the counts on them are this ' +
    'table’s — how many of each position the league is holding, not how many you could add. ' +
    'They move nothing but this table, so you can read every taken running back while the wire ' +
    'above stays on whatever you left it. The <strong>weeks to price</strong> control beside them ' +
    'is the same one as at the top of the page rather than a second one: both tables are priced ' +
    'over the same weeks, and widening costs requests, so that is one choice shown at both ends ' +
    'of a long page instead of two choices that could disagree.'
  );

  parts.push(
    '<strong>FLEX</strong> here is the same filter as on the wire above — every running back, ' +
    'receiver and tight end the league is holding, counted as those three added together — and ' +
    'it leaves the rank beside a name completely alone. A man is his manager’s RB2 or WR1 at his ' +
    'own position whichever button is pressed; there is no such thing as a FLEX2, because the ' +
    'rank answers how deep a manager is at a position and the button only decides which rows you ' +
    'are looking at.'
  );

  parts.push(
    lead('Links') +
    'Every name here is a link. Clicking one puts the table on his position, widens the weeks to ' +
    'the rest of the season, marks his row and opens his Actual row under it — the same thing ' +
    'that happens when you click a player anywhere else on the site, which is what brings you here. ' +
    'Click the name again to close the Actual row.'
  );

  if (state.playedWeeks.length) parts.push(PLAYED_NOTE());
  if (anyDone()) parts.push(DONE_NOTE);
  if (state.value.base) parts.push(VALUE_NOTE());

  // The preseason arrows' basis (rule 7), only when the table draws one.
  if (trend.hasTrend($('takenTable').querySelector('tbody').innerHTML)) {
    parts.push(trendExplainLine());
  }

  const missing = weeks.filter((w) => state.failedRosterWeeks.has(w));
  if (missing.length) {
    const named = andList(missing.map(String));
    status.push(
      missing.length === weeks.length
        ? `<span class="neg">ESPN refused the rosters for every week shown (${named}), so ` +
          `there is nothing to list here. Reload the page to try again.</span>`
        : `<span class="neg">ESPN refused the rosters for ` +
          `${missing.length === 1 ? 'week' : 'weeks'} ${named}, so ` +
          `${missing.length === 1 ? 'that column is' : 'those columns are'} blank, and both the ` +
          `average and the rank are taken from the weeks that did load. Reload the page to try ` +
          `again.</span>`
    );
  }

  const progress = progressText();
  if (progress) status.push(`<span class="muted">${esc(progress)}</span>`);

  $('takenStatus').innerHTML = paragraphs(status);
  $('takenNote').innerHTML = paragraphs(parts);
}

/** What the playoff columns are, said in both tables' notes. */
const PLAYOFF_NOTE =
  'The playoff weeks sit after a heavy line, headed PO: ESPN’s projection for each, colour and ' +
  'green box included, but left out of Avg — so Avg, the ranks and which of your men is the worst ' +
  'are regular-season figures. With only playoff weeks left to show, they are what Avg averages.';

/** What the columns left of the heavy line are, said in both tables' notes. */
const PLAYED_NOTE = () =>
  lead('Played weeks') +
  'The columns left of the thick line are the weeks fully over — a week still being played stays ' +
  'on the right. Each shows the projection ESPN still keeps for that week; click a name for his ' +
  'Actual row, what he really scored in each. They are not in Avg, the ranks or the colour scale, ' +
  'and the weeks-to-price control does not touch them. “—” means ESPN had nothing for him that week.' +
  (state.isDemo ? '' : ' They are read once, after the table: wire + rosters per played week.');

/** A week in progress, said in both tables' notes — only once somebody has finished. */
const DONE_NOTE = 'A player whose game is over shows his score for that week, uncoloured, and Avg counts it.';

/** What a 0.0 is, said in both tables' notes. */
const ZERO_NOTE =
  'ESPN also returns 0.00 for a man it has ruled out, so a zero outside his NFL team’s bye week ' +
  'is printed as 0.0 — with OUT, IR or SUSP beside it when that is why — and, like a bye, is left ' +
  'out of Avg. When the bye weeks could not be read, every zero is shown as a bye, as it always was.';

/** A short bold label that opens a paragraph of the tucked explanation. */
function lead(label) {
  return `<span class="lead">${esc(label)}.</span> `;
}

/**
 * One <p> per part. Joined with a newline so textContent still has a space
 * between the paragraphs and a sentence never runs into the next one.
 */
function paragraphs(list) {
  return list.map((t) => `<p>${t}</p>`).join('\n');
}

function renderStats(weeks) {
  const el = $('waiverStats');
  const rows = withShown(buildRows(weeks), weeks).filter(matchesFilter);

  if (!rows.length) {
    el.innerHTML = '';
    return;
  }

  const rated = rows.filter((r) => r.shownAvg !== null);
  const best = rated.length ? rated.reduce((a, b) => (b.shownAvg > a.shownAvg ? b : a)) : null;
  const label = state.position === 'ALL'
    ? 'Available'
    : `Available ${filterLabel(state.position)}`;

  const items = [
    [label, String(rows.length), state.position === 'ALL' ? '' : `of ${state.pool.size} in the pool`],
    ['Weeks shown', String(weeks.length), weekRange(weeks)],
  ];
  if (best) items.push(['Best average', fmt(best.shownAvg), best.p.name]);

  el.innerHTML = items
    .map(([k, v, who]) =>
      `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>` +
      `${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`)
    .join('');
}

/**
 * What a "Your …" row is, why that player and not another, and what the number
 * after the position means — plus, when there are none, how to turn them on.
 */
function comparisonNote(weeks, status) {
  const parts = [];

  if (!comparing()) {
    // Said where it can be seen: it is the reason the table has no Your rows,
    // and it tells you the one thing to do about it.
    status.push(
      state.isDemo
        ? 'The demo squads could not be generated this time, so there are no ' +
          '<span class="mine-key">Your …</span> rows to compare the wire against.'
        : 'Nobody is set as you, so the table below is the wire on its own. Choose your team ' +
          'in the “You are” menu in the connection bar and every position you hold gains a ' +
          '<span class="mine-key">Your QB3</span> row — your worst man there, sorted in among ' +
          'the players who could replace him.'
    );
    return parts;
  }

  parts.push(
    lead('Your rows') +
    'A row marked <span class="mine-key">Your QB3</span> is one of your own players rather ' +
    'than someone you can add: the worst man you hold at that position, put in the same list ' +
    'so you can see who on the wire beats him. Worst means the lowest Avg over the weeks ' +
    'currently shown, worked out exactly the way the wire’s is — so widening the span can ' +
    'change which of your men appears. The number is your depth there: QB3 because you hold ' +
    'three quarterbacks, K2 because you hold two kickers. These rows sort and filter with ' +
    'everything else, which is why they are in the table rather than beside it. They are ' +
    'never coloured green as a claim themselves — whether to start your own bench is a different question — and ' +
    'they are never counted on the position buttons, because you cannot add a player you ' +
    'already have.'
  );

  if (state.isDemo) {
    parts[parts.length - 1] +=
      ' The demo league has no owner, so those rows are the first team’s squad standing in ' +
      'for yours.';
  }

  const missing = weeks.filter((w) => state.failedRosterWeeks.has(w));
  if (missing.length) {
    const named = andList(missing.map(String));
    status.push(
      missing.length === weeks.length
        ? `<span class="neg">ESPN refused your rosters for every week shown ` +
          `(${named}), so there is nothing of yours to compare against. The wire below is ` +
          `still ESPN’s. Reload the page to try again.</span>`
        : `<span class="neg">ESPN refused your rosters for ` +
          `${missing.length === 1 ? 'week' : 'weeks'} ${named}, so your own rows average only ` +
          `the weeks that did load. Reload the page to try again.</span>`
    );
  }

  return parts;
}

/**
 * What these numbers are, said every time they are shown.
 *
 * Four things have to be in here or the table is quietly misleading: whose
 * projections these are, that a Bye cell and a blank cell mean different
 * things, how many weeks are on screen out of how many exist, and that
 * "available" is only true at the moment you looked.
 */
function renderNote(weeks) {
  // `status` is the short, always-visible line under the stat tiles: the demo
  // notice, how to turn the comparison on, what ESPN refused, what is still
  // loading. `parts` is the full explanation, one paragraph each, behind the
  // "How to read this table" toggle.
  const status = [];
  const parts = [];

  const season = state.seasonWeeks.length;
  const po = state.playoffWeeks.length;
  const showing =
    `Showing ${weekRange(weeks)} — ${plural(weeks.length, 'week')} of the ${season} this season ` +
    `runs to` +
    (po ? `, plus the playoffs (${weekRange(state.playoffWeeks)})` : '') +
    (state.isDemo ? '.' : `, for the ${POOL_LIMIT} most-owned unrostered players.`);

  if (state.isDemo) {
    status.push('Demo data: invented players, not your real league.');
    parts.push(
      lead('The numbers') +
      'These are invented players with invented projections — not ESPN’s, and not your ' +
      'league’s. Connect a league in the bar above, or use the toggle, to read the real waiver wire. ' +
      showing
    );
  } else {
    parts.push(
      lead('The numbers') +
      'Every number here is ESPN’s own projection for that player in that week, scored under ' +
      'this league’s rules — the same figure the ESPN site shows against a player when you ' +
      'page it forward to that week. Nothing in this table is our forecast except the average. ' +
      showing
    );
  }

  parts.push(
    lead('Avg, Bye and blank') +
    'Avg is the mean of the weeks shown and is ours, not ESPN’s: only weeks projecting above ' +
    'zero count, so a bye, a man ruled out and a week with no number at all are all left out — ' +
    'the same rule as the Trade page’s per-week figure. ' + PLAYOFF_NOTE + ' ' +
    'A cell reading Bye is the 0.00 ESPN returns for a player whose NFL team is off that week; ' +
    'a blank cell means that week’s list carried no number for him at all. Those are not the ' +
    'same thing, so they are not drawn the same way. ' + ZERO_NOTE
  );

  // What Gain is, what it is priced over, and the one thing it does not model.
  if (state.gain.key) {
    parts.push(
      lead('Gain') +
      `Gain is what adding him is worth to your own lineup: your best legal lineup with him ` +
      `in it and without the player it costs least to drop, minus your best lineup as the roster ` +
      `stands, a week, over ${weekRange(state.gain.weeks)}. It is priced exactly as the Trade page ` +
      `prices a trade, and your roster stays the size it is now. A dash means he would not ` +
      `raise your lineup in any of those weeks. Hover or tap a figure for the weeks behind it ` +
      `and the man it would drop; a click goes to him. The shade is deeper the bigger the gain, ` +
      `against the other gains in the column, and a plus is never red.`
    );
  }

  if (state.pool.size && [...state.pool.values()].some((p) => p.status === 'WAIVERS')) {
    parts.push(
      lead('W') +
      'A <span class="tag wv">W</span> beside a name means he is still on waivers, with the day ' +
      'the claim clears: a claim waits for the waiver run, and a team with a better priority can ' +
      'take him first. No tag means ESPN lists him as a free agent you can add straight away ' +
      '(or did not say).'
    );
  }

  // The green box has to say what it means, or it is just decoration. One
  // sentence (Tim, 2026-10-09); the rule itself is over `lineupTest`.
  if (comparing()) {
    parts.push(
      lead('Green box') +
      'A week <span class="beats-key">boxed in green</span> is one where he would make your best lineup.'
    );
  }

  // THE SCALE (Tim, 2026-09-19b: it "needs to be added to all the other places
  // a number is referred to"). It goes after the green box deliberately: a
  // reader has to know what that means before being told what sits under it.
  parts.push(
    lead('The red/green scale') +
    describeHeatPerColumn({ group: 'position', what: 'the other free agents' }) +
    ' Green reads “the best of what is actually available at this position”, which is the question ' +
    'this table exists to answer. It is deliberately not measured against the whole league at ' +
    'that position: free agents are by definition the men nobody wanted, so almost every cell ' +
    'would come out red, which is true and useless. <strong>Your own player’s row is measured ' +
    'against the same free agents and is not counted among them</strong> — a deep red “Your RB5” ' +
    'under a green wire is the whole argument for a claim, in one column. The points each ' +
    'position reaches full colour at are at the foot of this note; tap or hover any number for where ' +
    'it stands. Pressing a position button — FLEX included — changes which rows you see and ' +
    '<strong>not one cell’s colour</strong>, because every scale is built from the whole wire ' +
    'before the filter is applied.'
  );

  parts.push(
    lead('And on the week columns') +
    'Each week cell is on the same scale, measured against the other free agents at his position ' +
    '<strong>in that same week</strong>, so a heavy bye week is not a red stripe down the table. ' +
    'The <span class="beats-key">green box</span> sits on top of it. A Bye, a 0.0, a blank and a week ' +
    'already played are never coloured.'
  );

  parts.push(...comparisonNote(weeks, status));

  // FLEX is the one button whose label is not self-explanatory, and it is a
  // filter rather than a fact about anybody, so the note has to say both halves.
  parts.push(
    '<strong>FLEX</strong> is not a position but a filter across three: press it and the table ' +
    'shows every running back, receiver and tight end at once — the men who could fill a flex ' +
    'spot — with the count on the button being those three added together. It changes nothing ' +
    'about the players themselves: each one keeps his own position in the Pos column, and a week ' +
    'boxed in green under WR is boxed under FLEX.'
  );

  parts.push(
    lead('The controls') +
    'The position buttons above drive <em>this</em> table only — the Taken players panel has its ' +
    'own set — and filtering costs nothing: every week already fetched stays fetched. The weeks ' +
    'to price control is shared with that panel, because both tables are priced over the same ' +
    'weeks and widening is what actually spends requests. Every name is a link that jumps to that ' +
    'player, shows the rest of his season and opens his Actual row; click it again to close the row.'
  );

  if (state.playedWeeks.length) parts.push(PLAYED_NOTE());
  if (anyDone()) parts.push(DONE_NOTE);
  if (state.value.base) parts.push(VALUE_NOTE());

  parts.push(
    lead('Availability') +
    (state.isDemo
      ? 'On a real league, availability is a snapshot of the moment the page loaded — anyone here ' +
        'can be claimed by another team before you get to him.'
      : 'Availability is a snapshot of the moment each week was read. Anyone here can be claimed ' +
        'by another team before you get to him, and this page never refreshes itself.')
  );

  // The preseason arrows' basis (rule 7), only when the table draws one.
  if (trend.hasTrend($('waiverTable').querySelector('tbody').innerHTML)) {
    parts.push(trendExplainLine());
  }

  if (state.failedWeeks.size) {
    const failed = [...state.failedWeeks].sort((a, b) => a - b).filter((w) => weeks.includes(w));
    if (failed.length) {
      status.push(
        `<span class="neg">ESPN did not return ${failed.length === 1 ? 'week' : 'weeks'} ` +
        `${andList(failed.map(String))}, so ${failed.length === 1 ? 'that column is' : 'those columns are'} ` +
        `blank and the average is taken from the weeks that did load. Reload the page to try again.</span>`
      );
    }
  }

  const progress = progressText();
  if (progress) status.push(`<span class="muted">${esc(progress)}</span>`);

  $('waiverStatus').innerHTML = paragraphs(status);
  $('waiverNote').innerHTML = paragraphs(parts);

  // The key shows only the cues this table can actually draw right now: with
  // nobody set as you there is no green box and no Your row to explain.
  $('waiverLegend')
    .querySelectorAll('[data-compare]')
    .forEach((el) => {
      if (comparing()) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn || btn.dataset.src === state.source) return;
  state.source = btn.dataset.src;
  prefs.set('source', state.source);   // so the page comes back the way you left it
  syncSource();
  state.source === 'demo' ? loadDemo() : loadLive();
});

// Who "you" are is a repaint too: every roster week carries every squad, so the
// "Your …" rows and the green box ("you would start him") just re-pick a team.
$('teamSelect').addEventListener('change', (e) => {
  const v = e.target.value;
  state.pickedTeamId = /^\d+$/.test(v) ? Number(v) : v;
  prefs.set('team', state.pickedTeamId);
  render();
});

// Filtering by position is a repaint and nothing more: every week already
// fetched stays fetched, so flicking through the positions costs no requests.
// One handler per table, because the two filters are genuinely separate — a
// shared one meant narrowing the taken table dragged the wire along with it.
function onPositionClick(id, key) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pos]');
    if (!btn || btn.dataset.pos === state[key]) return;
    state[key] = btn.dataset.pos;
    prefs.set(key, state[key]);   // each table comes back the way you left it
    render();
  });
}
onPositionClick('posFilter', 'position');
onPositionClick('takenPosFilter', 'takenPosition');

// Widening the span DOES cost requests — but only for the weeks not already in
// the cache and not already in the air, so narrowing and widening again is
// free, and widening mid-load never pays for the same week twice.
//
// Both copies of the control drive the SAME setting. That is the point: the
// weeks are shared, so this is one choice reachable from either end of a long
// page rather than two choices that could disagree and two costs to spend.
function onSpanClick(id) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-span]');
    if (!btn || btn.dataset.span === state.span) return;
    state.span = SPAN_CHOICE(btn.dataset.span);
    prefs.set('span', state.span);
    render();
    refreshWeeks(state.token);
  });
}
onSpanClick('spanFilter');
onSpanClick('takenSpanFilter');

// Proj | Value is a repaint and nothing more: the lines are already held, and
// a projection's Value is arithmetic on a number already on the page.
function onShowClick(id) {
  if (!$(id)) return;
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-show]');
    if (!btn || btn.dataset.show === state.show) return;
    state.show = SHOW_CHOICE(btn.dataset.show);
    prefs.set('show', state.show);
    render();
  });
}
onShowClick('showToggle');
onShowClick('takenShowToggle');

/**
 * Jump to a player without leaving the page.
 *
 * Everything a `?player=` link asks for is already in this module's cache, so
 * following one from THIS page would be a reload that fetched nothing new and
 * lost the weeks already paid for. So the click is answered here instead —
 * `preventDefault` only for a plain left click, leaving middle-click,
 * ctrl/cmd-click and "open in new tab" to the browser, which is the whole
 * reason the contract is an `<a href>` and not a handler.
 */
function jumpTo(playerId) {
  // A different man: the box a `&week=` link drew was about the one before.
  if (playerId !== state.spotlight) state.boxWeek = null;
  state.spotlight = playerId;
  // Selecting a man opens his Actual row (Tim, 2026-10-04).
  state.open = playerId;
  state.settled = false;
  state.scrolled = false;
  // The span is what decides how many week columns exist, so "show me his next
  // 13 weeks" IS this. Not persisted: answering a link is not a change of mind
  // about the setting, and a reload should give back the span actually chosen.
  state.span = 'all';
  render();
  refreshWeeks(state.token);
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  // A name in a table — or, on a preview's sheet, the link to a man: the
  // "Drop X" line and the button under it are answered here too, no reload.
  const link = e.target.closest && e.target.closest(
    'a.pref[href*="player="], #statCard a[href^="waivers.html?player="]');
  if (!link) return;
  if (link.closest('#statCard')) hidePop();
  const m = /[?&]player=(\d+)/.exec(link.getAttribute('href') || '');
  if (!m) return;
  e.preventDefault();
  const id = Number(m[1]);
  // THE NAME OF THE MAN ALREADY SELECTED, on his own row: the click only opens
  // or closes his Actual row. Nothing else on the page moves.
  const tr = link.closest('tr');
  if (id === state.spotlight && tr && tr.id === `p${id}`) {
    state.open = state.open === id ? null : id;
    render();
    ensureValueWeeks(state.token);
    return;
  }
  jumpTo(id);
});

$('jumpNote').addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('button[data-clear]')) return;
  // Only the mark and the strip go. The span and the filter it moved are left
  // where they are: they are now what the reader is looking at, and yanking
  // them back would undo a page he did not ask to leave.
  state.spotlight = null;
  state.open = null;
  state.boxWeek = null;
  state.settled = false;
  state.scrolled = false;
  render();
});

// The average is the only column that orders the whole table into an answer, so
// that is where it opens: best first.
enableSort($('waiverTable'), { defaultIndex: 3 });
// The gain figure's own click first, then the previews (see `wireGainJump`).
wireGainJump($('waiverTable'));
wirePops($('waiverTable'), { selector: PREVIEWS, card: previewFor });
wirePops($('takenTable'), { selector: PREVIEWS, card: previewFor });
// Same reasoning one column further right, the Owner column having pushed Avg
// from index 3 to index 4.
enableSort($('takenTable'), { defaultIndex: 4 });
// "Who to start" opens as it does on Analysis: by depth, starter first. Its
// Starts figures and week headings open the same cards; Actual | Proj is the
// select on its heading line, kept for this page.
if ($('startersTable')) {
  enableSort($('startersTable'), { defaultIndex: 0, defaultAsc: true });
  wirePops($('startersTable'));
  starters.wireWeekHeads($('startersTable'));
  $('startBox').addEventListener('change', (e) => {
    const pick = e.target.closest ? e.target.closest('select[data-history]') : null;
    if (!pick) return;
    prefs.set('startHistory', pick.value === 'proj' ? 'proj' : null);
    render();
  });
}

/**
 * Go live on our own when the connection bar finds a league, so the page shows
 * the real waiver wire without a second click — unless the user has parked it
 * on demo.
 *
 * Something on this page IS per-team, so an already-live page also has to listen
 * for who you are changing. Answering that costs nothing: every roster week
 * carries every team, and the rosters are bought unconditionally now, so
 * changing who "you" are only re-picks which squad the "Your …" rows come from.
 * refreshWeeks is still called after it, but only so a week that was refused
 * mid-load is not left hanging — it spends nothing on a week already held.
 */
let knownTeamId = (savedConfig() || {}).teamId ?? null;

onConnection((conn) => {
  if (!conn) return;

  if (state.source === 'live') {
    const teamId = conn.teamId ?? null;
    if (teamId === knownTeamId) return;
    knownTeamId = teamId;
    if (state.isDemo) return;
    render();
    refreshWeeks(state.token);
    return;
  }

  knownTeamId = conn.teamId ?? null;
  if (prefs.get('source') === 'demo') return;
  state.source = 'live';
  syncSource();
  loadLive();
});

// Sync now, or a roster move js/season.js noticed (`ff:refresh`, sent by
// js/connection.js): the league is read again, as on a first load.
document.addEventListener('ff:refresh', (e) => {
  if (state.source === 'live' && !state.isDemo) e.detail.waitUntil(loadLive());
});

// A `?player=` link decides the span before the first request goes out, so the
// weeks it needs are bought in the same pass rather than fetched three-wide and
// then immediately widened. Set before the load, never after it.
const landing = requestedPlayer();
if (landing !== null) {
  state.spotlight = landing;
  state.span = 'all';
  // The link's man arrives with his Actual row open, and `&week=` boxes that
  // week's two cells — his projection and his score — when it is a played week.
  state.open = landing;
  state.boxWeek = requestedWeek();
}

// The preseason copy for the arrows by a name: read once, and the tables are
// repainted when it lands (a failed read simply draws no arrows).
// Gain waits on the same answer (`rosComing`), so a refusal repaints too.
trend.loadBaseline().then((b) => {
  state.baselineSettled = true;
  render();
  if (b) ensureTrendWeeks(state.token);
});

if (state.source === 'live' && savedConfig()) loadLive();
else { state.source = 'demo'; loadDemo(); }
