// The Trade page: a search for swaps that help both squads, the best set of
// them to make at once, and the depth map the two are built on — plus, when you
// ask for it, the same question priced across every remaining week.
//
// Four panels, and they are four halves of one question. THEY ARE IN ORDER OF
// USEFULNESS, top to bottom (Tim, 2026-09-17), which is not the order they are
// computed in:
//
//   1. the FINDER — what to offer, and to whom. The answer somebody came for.
//   2. the BEST COMBO — which of those offers can all be made at once, because
//      a player can only be traded once and their gains do not add up.
//   3. the DEPTH MAP — who is deep where. The working behind both of the above:
//      read down a column and find the manager whose sign is the opposite of
//      yours. It used to be first, because it is what the engine computes
//      first, which is a fact about the code and not about the reader.
//
// Clicking any offer opens the deal week by week in a pop-up, which is the only
// place the real shape of it shows.
//
// ---------------------------------------------------------------------------
// WHAT THIS PAGE COSTS, which is the one thing it must never understate
//
// On the two cheap measures it is ONE request: a single week of rosters, read
// several ways, and every control is a repaint. That has always been true here
// and still is.
//
// The weekly measure is different and cannot be made cheap. Valuing a squad at
// what it can field in EVERY remaining week needs every remaining week's
// projections, and there is no bulk form — rule 3 in HANDOFF.md, established by
// trying four shapes of the request. So it is one request per week: nine to
// thirteen of them, plus a search that re-fills nine to thirteen lineups per
// offer instead of one and takes a few seconds rather than a quarter of one.
//
// THE PAGE NOW PRICES ITSELF, AND THAT IS A REVERSAL. Tim, 2026-09-19: "make
// this price action an automatic action with the page (it should not load if it
// doesn't price it). ... I would prefer if it does all the loading and checking
// data with espn as soon as you open up the page or choose to sync it with
// espn, and then it's saved there until you re-load it."
//
// What used to be here, and why it was here, is worth keeping on the record:
// nothing on this page fetched a week until a labelled button was pressed — not
// on load, not when a remembered preference said "weekly", not when the
// connection bar flipped the page live — because twelve unasked requests on his
// phone was the surprise this page existed not to spring. He has now asked for
// exactly that, and the reason the answer changed is `js/store.js`: the weeks
// are kept in this browser across a navigation, so the second visit of the day
// spends nothing and the first spends what it always would have spent one
// button-press later. The cost is still named, still counted as it is spent,
// and the button is still there — as a RE-READ, which is the other half of his
// ask ("until you re-load it").
//
// THE COST LINE COUNTS REQUESTS, NOT WEEKS. A week served out of the store cost
// nothing, and a page that counted it would be overstating — which is the same
// dishonesty as understating, one direction over.
//
// ---------------------------------------------------------------------------
// TWO SCALES, AND THEY DIFFER BY A FACTOR OF NINE OR MORE
//
// `typicalWeek` and `weekProjection` produce points PER WEEK. The weekly path
// produces REST-OF-SEASON TOTALS — a +29 there is +29 spread over thirteen
// weeks, about +2.2 a week. Mixing them would make every figure on the page
// wrong by an order of magnitude while looking perfectly plausible, so:
//
//   - the gain columns' headings are rewritten to say which scale they are in;
//   - every season total is printed with its per-week twin beside it;
//   - `send`/`receive` entries carry `projected` (the season total) AND
//     `perWeek` (the mean), and this file never prints the first as the second.
//
// `js/trade.js` holds every decision worth arguing about and is pure. This file
// is wiring and markup.

import { fetchWeekRosters, fetchWeeksRosters, fetchSchedule } from './season.js';
// The namespace as well, for `fetchByeWeeks`, read defensively: a season module
// (or a test stub) without it simply means the bye weeks are unknown.
import * as season from './season.js';
// The positional floor's wording, so this page says the same thing the
// Analysis page does about an assumed number. See js/floor.js.
import { describeFloors } from './floor.js';
import { slotCountsFromLineups } from './projection.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';
import * as espn from './espn.js';
// The ONE definition of the playoff weeks (last regular week + one per round).
import { playoffWeeks as leaguePlayoffWeeks } from './capture.js';
import { stageTrade, isAvailable as bridgeAvailable, extensionVersion } from './bridge.js';
import {
  depthTable, findTrades, slotsForLeague, typicalWeek, weekProjection, PACKAGE_KINDS,
  priceTradeAcrossWeeks, bestCombo, mergeComboByPartner,
} from './trade.js';
// THE SAME SOLVER, NOT A SECOND ONE. `optimalLineup` is what the schedule
// forecast, the trade finder, "Who to start" and the per-week valuation all
// run on, and the reason they cannot disagree about who a squad ought to be
// starting (HANDOFF, "Four features now share optimalLineup"). The card's
// STARTS COUNT is the fifth reader of it and it gets no copy — a second solver
// would let this page and the Analysis page's Starts column print two different
// numbers for one man. `js/trade.js` wraps it rather than importing it here
// because that module is pure; this file needs the STARTERS, which the wrapper
// does not return.
import { optimalLineup } from './forecast.js';
import {
  weekRun, registerRun, tipAttr, clearRuns, wireTips, hideTip, clickIsPlayer,
  zeroKind, byeWeekOf,
} from './player-card.js';
// The ONE lineup-slot layout rule — QB, RB1, RB2, WR1…, FLEX, D/ST, K — shared
// with the analysis page's "Season by week" panel so the two cannot disagree
// about which receiver is WR1. See js/lineup-slots.js.
import { slotRows, fillSlots } from './lineup-slots.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('trade');

const DEMO_WEEKS = 13;
const NFL_WEEKS = 18; // only used when ESPN won't tell us its own schedule

// THE WEEKLY SPAN IS THE REST OF THE SCHEDULE, AND THERE IS NO WEEK CEILING.
//
// This used to stop at 13, on the authority of a rule in HANDOFF.md that said
// ESPN published nothing beyond that week. **That rule was wrong** — it was
// simply the furthest week anybody had asked for, and re-probing found real
// per-week projections through week 18. It is corrected there now.
//
// Leaving the cap in was not harmless. Tim's regular season is FOURTEEN
// matchups, so a 13-week ceiling silently dropped the last week of it from
// every trade he priced — the week before his playoffs, and the one most likely
// to decide whether he is in them.
//
// The span is bounded by the schedule instead, which is the honest bound: ESPN's
// matchup feed stops at the end of the regular season, so `state.weeks` is
// exactly the weeks there are. A week ESPN refuses is already absent rather
// than fatal, so a genuine gap costs a column and not a wrong answer.
//
// What this deliberately does NOT do is price the playoff weeks. They are not
// in the schedule feed at all, so reaching them means fetching by week number
// the way the schedule page's bracket does — worth doing, and noted as open in
// PROGRESS.md, but it is a different question: a trade for weeks 15-17 is only
// worth anything if you get there.
//
// SHOWN, NOT PRICED (2026-09-17). Tim asked for weeks 15–17 wherever a week
// preview appears, and has not decided whether a trade should be priced on
// them. So the pop-up reads them — on the click, like every week it shows —
// and lays each side's lineup out after a line, below the totals, uncoloured;
// the player card's run carries them too. They never reach `weeklySpan()`,
// so no per-week figure, total or ranking on this page moves because of them.

// How many weekly requests to have in the air at once, and it is the same three
// the analysis page uses. Written here rather than imported from that page: it
// is that page's private wiring, and two pages sharing a private helper is how
// one of them ends up repainting the other's state.
const WEEK_BATCH = 3;

const MEASURES = {
  typical: {
    label: 'a typical week',
    scale: 'week',
    basis:
      'ESPN’s full-season projection divided by 17 games, which is the closest ' +
      'thing ESPN publishes to a rest-of-season value',
  },
  week: {
    label: 'the selected week',
    scale: 'week',
    basis: 'ESPN’s own projection for the week selected at the top of the page',
  },
  weeks: {
    label: 'every remaining week',
    scale: 'season',
    basis:
      'ESPN’s own projection for each remaining week, with the best legal lineup ' +
      'picked separately in every one of them — so a squad is worth what it can ' +
      'actually field week by week, not what its averages suggest',
  },
};

const state = {
  source: 'demo',
  week: 1,
  weekPickedLive: false, // the reader chose a live week during THIS visit; see openingWeek()
  weeks: [],
  playedWeeks: [],
  poWeeks: [],         // the playoff weeks: shown for reference, never priced
  poPlayed: [],        // of those, the ones with a result (December)
  scheduleError: null, // why the live schedule could not be read, if it could not
  data: null,          // {week, teams:[...]} for the selected week
  slots: null,         // the league's starting slots, read off the lineups
  // THE POSITIONAL FLOOR (Tim, 2026-09-18): position -> the wire's best man
  // there, read ONCE and used for every week. Null in demo and until the read
  // lands, which prices exactly as this page always did. See js/floor.js.
  floors: null,
  floorWeek: null,
  myTeamId: null,      // the squad the finder trades FROM
  espnTeamId: null,    // the reader's own team, when a live league says so
  isDemo: true,
  byes: {},            // proTeamId -> bye week; empty = unknown (a live 0.00 is then a bye)
  // EVERY REMAINING WEEK IS THE DEFAULT since 2026-09-19 (Tim: "it should not
  // load if it doesn't price it"). It is the measure the page is FOR — rule 10
  // in HANDOFF.md — and the only reason it was not the default was that it had
  // to be paid for by hand. The page pays for it on load now, so the other two
  // are the deliberate choices and this is the plain one. A remembered
  // preference still wins; see the boot block at the foot of this file.
  measure: 'weeks',    // what the reader ASKED for; see basis() for what is drawn
  kind: 'all',         // which package shapes the finder searches
  partner: 'all',      // limit the results to one manager
  search: null,        // the last finder result
  searching: false,
  rows: [],            // the offers currently in the finder's table, in order
  deal: null,          // the offer the modal is showing; null = the modal is shut
  dealKey: null,       // which row opened it, so focus can go back there
  dealWeek: null,      // which week's slot-by-slot breakdown is open inside it
  dealSide: 'mine',    // whose lineup that breakdown shows: 'mine' | 'theirs'
  // CUSTOM TRADES (Tim, 2026-09-18). `custom` is the deal being BUILT in the
  // pickers; `customSaved` is the box it gets kept in, persisted so a reload
  // does not throw his work away.
  //
  // ONLY THE IDENTITIES ARE STORED — two team ids and two lists of playerIds —
  // never a price. A price stored on Tuesday is a lie by Thursday: rosters
  // move, ESPN's projections move, and the span shrinks by a week. Every saved
  // trade is re-priced from the current data on every render, which is also
  // why a man who has since been traded away can be reported as such rather
  // than silently priced at zero.
  custom: { a: null, b: null, sendA: [], sendB: [] },
  customSaved: [],
  combo: null,         // the last bestCombo result
  comboRows: [],       // the combo's offers, MERGED per manager, in row order
  comboRunning: false,
};

const cache = new Map(); // `${source}:${week}` -> {week, teams}

// The five-second memo behind `storedAgeLine()` — declared up here with the
// other module state rather than beside the function that fills it, because
// `resetWeekly()` clears it and sits above it in the file. A `let` read before
// its declaration is evaluated is a throw, not an undefined, and the only thing
// keeping this safe otherwise is the order the boot block happens to run in.
let ageLine = { at: 0, text: '' };

/**
 * Every remaining week's numbers, and what they cost to get.
 *
 * `byWeek` is week -> Map(playerId -> {projected, actual}) across the WHOLE
 * league, not one team: a man's projection does not depend on whose bench he is
 * on, and indexing the league means a player who changed hands mid-season is
 * still found. `failed` is a week ESPN refused — absent rather than fatal, the
 * same rule `fetchWeeksRosters` follows.
 */
const weekly = {
  key: null,
  byWeek: new Map(),
  // week -> Map(teamId -> that squad's players). The per-player index above
  // cannot answer "whose squad was he on in week 4", and the STARTS COUNT
  // (Tim, 2026-09-19) is exactly that question — "the number of starting weeks
  // in that user's lineup" — so the rosters are kept as well as flattened.
  // A man who changed hands mid-season is therefore counted against whoever
  // actually held him each week, which is the only reading of the ask that is
  // true of a real season.
  rosters: new Map(),
  failed: new Set(),
  loading: false,
  progress: null,
  error: null,
  // REQUESTS, NOT WEEKS. A week served out of js/store.js — this browser's own
  // copy, kept across a navigation — cost nothing, and counting it would
  // overstate the page's cost as surely as ignoring a real request understates
  // it. `season.fetchWeeksRosters` reports which source answered each week.
  requests: 0,
  fromStore: 0,
  token: 0,
  means: new Map(), // playerId -> his mean over the span; see weeklyMean()
  // `${week}:${teamId}` -> Set(playerId) of who starts. See startersIn().
  lineups: new Map(),
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

/** "+3.6" / "−0.4" — a real minus sign, and the sign is always printed. */
function signedText(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "weeks 2–13", or "week 13" when there is only one of them. */
function weekRange(weeks) {
  if (!weeks.length) return 'no weeks';
  if (weeks.length === 1) return `week ${weeks[0]}`;
  return `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
}

// Child traversal rather than tBodies, matching sortable.js: it copes with a
// table that omits <tbody> and keeps this module testable off-browser.
function bodyOf(table) {
  return Array.from(table.children).find((c) => c.tagName === 'TBODY') || null;
}

// ===========================================================================
// The weekly span: which weeks, whether we have them, and what they cost
// ===========================================================================

/** Which league these cached weeks belong to. Team ids collide across leagues. */
function sourceKey() {
  const cfg = espn.getConfig();
  return state.source === 'demo' ? 'demo' : `live:${cfg.leagueId}:${cfg.season}`;
}

/**
 * Which weeks have already been played.
 *
 * READ OFF THE SCHEDULE, NEVER OFF THE CALENDAR. A week is played when there is
 * a RESULT against it — the same rule the player card's Act row follows, and
 * for the same reason: a date test looks perfectly correct in demo, where every
 * game is hardcoded as played, and is wrong everywhere else. `state.playedWeeks`
 * is filled in `useLive` from `schedule.games.filter((g) => g.played)` and from
 * nothing else.
 *
 * DEMO IS HANDLED DELIBERATELY RATHER THAN LEFT TO FALL OUT, because the honest
 * reading of the demo schedule is that the sample season is OVER — all thirteen
 * games are marked played — and a page that priced zero weeks would leave the
 * weekly measure, the drill-down and the combo empty in the only mode a reader
 * can try without a league connected. So demo uses the WEEK PICKER as its
 * stand-in for "now": the sample season is replayed as it stood after the
 * selected week, and everything later is the rest of it. It is written here in
 * one place, and the panel notes say which of the two rules they are on.
 */
function playedWeeks() {
  if (state.isDemo) return state.weeks.filter((w) => w <= state.week);
  return state.playedWeeks;
}

/**
 * The weeks the weekly measure prices: every week STILL TO BE PLAYED that ESPN
 * still projects.
 *
 * Tim's ask, in his words: "For the trade analysis, don't let any data on weeks
 * that have already been played be able to affect the trade." He is right, and
 * the reason is not an opinion — a trade changes the REST of the season and
 * nothing else. The points from week 3 are banked. No deal can move them, so
 * week 3 is not evidence about any deal, and a valuation that includes it is
 * answering a question nobody can act on.
 *
 * It used to be "the selected week → week 13", anchored on the week picker so a
 * reader could ask what the rest of the season looked like from there. That is
 * gone: it let a played week into every number on the page whenever the picker
 * sat in the past, which — since `useLive` then OPENED on the last played week —
 * was the normal case rather than an edge one. (It opens on the coming week
 * now; see `openingWeek()`.)
 *
 * So the span is now a DERIVED FACT rather than the reader's pick, and every
 * note that names it says which weeks they are.
 */
function weeklySpan() {
  const played = new Set(playedWeeks());
  return state.weeks.filter((w) => !played.has(w));
}

/**
 * The played weeks the pop-up SHOWS — above a line, uncoloured, and in no total.
 * Tim asked to see them marked as out of the calculation rather than hidden.
 */
function pastWeeksShown() {
  const played = new Set(playedWeeks());
  return state.weeks.filter((w) => played.has(w));
}

/**
 * The playoff weeks the pop-up SHOWS — after a line, uncoloured, in no total,
 * and never in `weeklySpan()`. Only those still to be played: a bracket week
 * with a result is banked like any other.
 */
function playoffWeeksShown() {
  const played = new Set(state.poPlayed);
  return state.poWeeks.filter((w) => !played.has(w) && !state.weeks.includes(w));
}

/**
 * EVERY WEEK THE PAGE READS — the priced span, the played weeks behind it, and
 * the bracket in front.
 *
 * This is what a re-read costs, and it is deliberately not `weeklySpan()`.
 * The button used to name the span because the span was the only thing the
 * button bought; the page reads the whole season now (the played weeks for the
 * player card's Act row, the bracket for the run and the pop-up), so quoting
 * the span on a control that reads all of them would be understating the price
 * by about a third. Understating a cost is the one dishonesty this project
 * avoids.
 */
function readableWeeks() {
  return [...new Set([...pastWeeksShown(), ...weeklySpan(), ...playoffWeeksShown()])]
    .sort((a, b) => a - b);
}

/**
 * Is a 0.00 a bye — for THIS man, in THIS week?
 *
 * Not simply "on ESPN, yes" any more. Verified on 2026-09-16: ESPN projects an
 * OUT or IR man at 0.00 in ordinary weeks too, so a zero is a bye only in his
 * NFL team's bye week. `zeroKind` in js/player-card.js decides that for the
 * whole site; this hands its answer to js/trade.js as a `(player, week)`
 * function. A ruled-out zero therefore stays IN the per-week divisor — it is a
 * week he does not play, and a trade for him buys that — and only a real bye
 * comes out. With the byes unknown the old reading stands.
 *
 * On the sample data a zero is never a bye — a 0 out of `js/demo-rosters.js`
 * means "we have ruled this man OUT" — so demo still passes `false`, the same
 * direction as `projToken(v, demo)`.
 */
const byeAt = (p, week) =>
  zeroKind(0, {
    week,
    byeWeek: byeWeekOf(p, state.byes),
    injuryStatus: p && p.injuryStatus,
    demo: state.isDemo,
  }) === 'bye';
const zeroIsBye = () => (state.isDemo ? false : byeAt);

const haveWeek = (w) => weekly.byWeek.has(w) || weekly.failed.has(w);

/** The weeks of the span still to buy. On demo, still to generate. */
function missingWeeks() {
  if (weekly.key !== sourceKey()) return weeklySpan();
  return weeklySpan().filter((w) => !haveWeek(w));
}

/** Are all the span's weeks in hand, and did at least one of them answer? */
function weeklyReady() {
  if (weekly.key !== sourceKey()) return false;
  const span = weeklySpan();
  if (!span.length) return false;
  return span.every(haveWeek) && span.some((w) => weekly.byWeek.has(w));
}

/**
 * What is actually being drawn, as opposed to what the reader picked.
 *
 * Asking for the weekly measure does not fetch it — that costs requests and has
 * to be pressed for — so between the ask and the press the page draws the
 * typical week and says so in every note. One function decides that for the
 * whole page, because two panels disagreeing about which basis they are on is
 * exactly the failure this page cannot have.
 */
function basis() {
  if (state.measure !== 'weeks') return state.measure;
  return weeklyReady() ? 'weeks' : 'typical';
}

const meta = () => MEASURES[basis()];

/** week -> Map(playerId -> {projected, actual}) for one week's payload. */
function indexTeams(teams) {
  const byPlayer = new Map();
  for (const t of teams || []) {
    for (const p of t.players || []) {
      byPlayer.set(p.playerId, {
        projected: typeof p.projected === 'number' ? p.projected : null,
        actual: typeof p.actual === 'number' ? p.actual : null,
        injuryStatus: p.injuryStatus || null,
      });
    }
  }
  return byPlayer;
}

/**
 * week -> Map(teamId -> that week's roster), kept beside the flattened index.
 *
 * The flattened one answers "what is he projected at" and cannot answer "whose
 * squad was he on", which is the whole of the starts count. Each entry is the
 * team's own `players` array, not a copy: the payload is already this page's
 * and nothing mutates it.
 */
function indexRosters(teams) {
  const byTeam = new Map();
  // playerId -> teamId, so "whose squad was he on" is a lookup rather than a
  // scan of ten rosters. The starts count asks it once per week per card, and
  // a page draws fifty cards a paint.
  const teamOf = new Map();
  for (const t of teams || []) {
    byTeam.set(t.id, t.players || []);
    for (const p of t.players || []) {
      if (p.playerId !== null && p.playerId !== undefined) teamOf.set(p.playerId, t.id);
    }
  }
  return { byTeam, teamOf };
}

function rememberWeek(week, teams) {
  weekly.byWeek.set(week, indexTeams(teams));
  weekly.rosters.set(week, indexRosters(teams));
  weekly.failed.delete(week);
}

function resetWeekly() {
  weekly.key = sourceKey();
  weekly.byWeek = new Map();
  weekly.rosters = new Map();
  weekly.failed = new Set();
  weekly.error = null;
  weekly.requests = 0;
  weekly.fromStore = 0;
  weekly.means = new Map();
  weekly.lineups = new Map();
  // The age line's five-second memo goes with them. A re-read makes every
  // number on screen new, and a cached "3 hours ago" surviving it — even for
  // five seconds — is exactly the stale-looking-fresh failure the line exists
  // to prevent.
  ageLine = { at: 0, text: '' };
  // The token invalidates anything still in the air, and the two flags are
  // cleared here as well as in loadWeekly's `finally`: that clause deliberately
  // leaves a STALE load's flags alone, so without this a source switch during a
  // fetch would strand the button disabled and "reading…" on screen forever.
  weekly.loading = false;
  weekly.progress = null;
  weekly.token++;
}

/**
 * The selected week is already bought — it is what the depth map is drawn from
 * — so it goes straight into the weekly cache rather than being fetched twice.
 * That is one request saved out of every span, and the cost note says so rather
 * than quietly counting it.
 */
function rememberSelectedWeek() {
  if (!state.data) return;
  if (weekly.key !== sourceKey()) resetWeekly();
  rememberWeek(state.data.week, state.data.teams);
  weekly.means = new Map();
}

/**
 * `(player, week) -> number|null`, which is half of what the weekly engine
 * needs. A week we do not hold, and a man nobody in the league rostered that
 * week, are both null — `optimalLineup` drops a null from the pool entirely,
 * which is a different fact from ESPN's 0.00 for a bye, and keeping them apart
 * is what rule 2 in HANDOFF.md exists to protect.
 */
function projFor(p, week) {
  const idx = weekly.byWeek.get(week);
  if (!idx) return null;
  const e = idx.get(p.playerId);
  return e && typeof e.projected === 'number' ? e.projected : null;
}

/**
 * A man's mean projection over the span — the depth map's number under the
 * weekly basis.
 *
 * The depth map is a per-position table and has to stay on a per-WEEK scale, or
 * its cells would be nine times the size of everything a manager thinks in. But
 * it must be made of the same projections the deals are priced from, or the two
 * panels could contradict each other. So it is the same weeks, averaged — with
 * the SAME arithmetic `scoreAcrossWeeks` uses for `perWeek`, byes and all.
 *
 * WHICH NOW MEANS BYES ARE LEFT OUT OF THE DIVISOR. Tim asked for that of the
 * per-week figure beside a player's name, and this table is the other place one
 * man gets a per-week number on this page. Two panels printing two different
 * per-week values for one player — because one of them counted his bye and the
 * other did not — is precisely the contradiction this function's whole reason
 * for existing is to prevent. `zeroIsBye()` decides which zeros count, so the
 * sample data (where a 0 means "ruled out", not "no game") is unaffected.
 *
 * A man with no PLAYABLE week left comes back `null`, which `optimalLineup`
 * drops from the pool entirely — correct, and the same treatment as a man ESPN
 * carries no number for: he cannot be in a lineup in a week that is left.
 *
 * Memoised because `depthTable` asks for the same player several times per
 * paint and the answer cannot change without the cache being rebuilt.
 */
function weeklyMean(p) {
  if (!p || p.playerId === null || p.playerId === undefined) return null;
  const held = weekly.means.get(p.playerId);
  if (held !== undefined) return held;

  const span = weeklySpan();
  let sum = 0;
  let counted = 0;
  let byes = 0;
  for (const w of span) {
    const v = projFor(p, w);
    if (v === null) continue;   // still in the divisor, exactly as it always was
    sum += v;
    counted++;
    // Only his real bye leaves the divisor; a ruled-out zero counts as a zero.
    if (v === 0 && !state.isDemo && byeAt(p, w)) byes++;
  }
  // The span less his byes, matching `scoreAcrossWeeks` line for line — that is
  // what stops the two panels disagreeing about one man.
  const playable = span.length - byes;
  const out = counted && playable > 0 ? Math.round((sum / playable) * 10) / 10 : null;
  weekly.means.set(p.playerId, out);
  return out;
}

/** The scalar the depth map is drawn with, whichever basis is in force. */
function measureFn() {
  if (basis() === 'weeks') return weeklyMean;
  return basis() === 'week' ? weekProjection : typicalWeek;
}

// ------------------------------------------------------------ buying the weeks

/**
 * Every week the page draws ANYWHERE, priced or not: the whole season plus its
 * playoff weeks.
 *
 * `weeklySpan()` is the priced span and is a strictly smaller thing. This is
 * what the player card's run covers (Tim, 2026-09-19: "start displaying all
 * weeks 1-17 in that preview so we can understand their past performance") and
 * what the starts count is taken over. Weeks 1–14 come off the league schedule;
 * 15–17 are the bracket weeks, which are never in the schedule feed until
 * December and are derived from the league's own field size instead.
 */
function seasonWeeks() {
  const all = [...new Set([...state.weeks, ...state.poWeeks])]
    .filter((w) => Number.isFinite(w))
    .sort((a, b) => a - b);
  return all.length ? all : [state.week];
}

/**
 * Fetch (or generate) every week of the span that is not in hand.
 *
 * The live half is the same shape as the analysis page's season panel — one
 * request per week, three at a time, repainting between batches, and a week
 * ESPN refuses simply comes back absent — but written here rather than imported
 * from that page, which owns its own state and must not be reached into.
 *
 * IT USED TO SAY "nothing in this function runs without a press. That is the
 * whole point of it." That was true for three days and Tim has overruled it —
 * see the header. `autoLoad()` below is the press now, and this is still what
 * the BUTTON calls, which is why the two flags exist rather than two functions:
 * a re-read and an automatic first read differ in exactly two ways and nothing
 * else about the path may be allowed to drift between them.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.auto] this was not a press, so a remembered choice of
 *   another measure is left exactly as the reader set it. The weeks are bought
 *   either way — the card and the pop-up want them whichever measure is drawn.
 * @param {boolean} [opts.fresh] ignore this browser's stored weeks and re-read
 *   from ESPN. This is the button's job now ("until you re-load it").
 */
async function loadWeekly({ auto = false, fresh = false } = {}) {
  const key = sourceKey();
  if (weekly.key !== key) resetWeekly();
  rememberSelectedWeek();

  const span = weeklySpan();
  // A finished season has nothing to price and a card still has a whole season
  // to draw, so the history is bought either way.
  if (!span.length || weekly.loading) { paint(); loadHistory(); return; }

  if (!auto) {
    state.measure = 'weeks';
    prefs.set('measure', 'weeks');
    $('measureSelect').value = 'weeks';
  }

  // A RE-READ THROWS EVERY CACHE AWAY FIRST, all three of them: this browser's
  // stored weeks, the weekly index, and the page's own per-week roster cache.
  // Keeping any one of them would serve some of the same numbers straight back
  // — a refresh button that refreshes most of it is the fastest way to lose a
  // reader's trust in every other number on the page, and the SELECTED week is
  // the one he is looking at while he presses it.
  if (fresh) {
    if (typeof season.forgetStored === 'function') {
      try { season.forgetStored(); } catch { /* a cache that will not clear is not an error */ }
    }
    cache.clear();
    resetWeekly();
    // The selected week comes back through the ordinary path, which repaints
    // and re-searches on the way — so the depth map and the finder are never
    // drawn from numbers this press has just declared stale.
    await loadWeek();
    if (sourceKey() !== key) return;
  }

  // Already in hand — switching to them is free, but the finder still has to be
  // re-run: its offers were priced on the OTHER measure, and repainting alone
  // would relabel them rather than recompute them.
  if (!missingWeeks().length && !fresh) { repaint(); loadHistory(); return; }

  if (!(await buyMissingWeeks(null, { fresh }))) return;
  // A deal opened while these were reading is now priceable and stays open.
  runSearch({ keepDeal: true });
  // Then the weeks that are SHOWN but never priced — the played ones and the
  // bracket. They are a second phase on purpose: the priced span is what the
  // page is for, and making the reader wait for week 1's history before the
  // finder re-ranks would be paying for the smaller answer first.
  loadHistory();
}

/**
 * The weeks the page SHOWS but never prices: the ones already played, and the
 * playoff weeks.
 *
 * Tim's ask, in his words: "it doesn't actually display any previous weeks in
 * the chart, so that whole row is useless. Instead of getting rid of that row,
 * just start displaying all weeks 1-17 in that preview so we can understand
 * their past performance."
 *
 * The "Act" row on the player card can only ever be filled from a week that has
 * been READ, and this page never read a played week — the span deliberately
 * excludes them, because a trade cannot move banked points. So the row was
 * empty for everybody, always. It is these requests that fill it.
 *
 * NONE OF THIS REACHES A PRICE. `weeklySpan()` is unchanged, so no gain, total,
 * ranking or per-week figure on this page moves by a thousandth because of
 * them. They are history and reference, and the notes say so.
 *
 * The cost is real and is stated: on a cold cache it is one request per played
 * week plus one per bracket week — about eight in mid-season, and none of them
 * on a second visit, because a played week can never change again and
 * `js/store.js` keeps it for the season on exactly that grounds.
 */
async function loadHistory() {
  const rest = [...pastWeeksShown(), ...playoffWeeksShown()].filter((w) => !haveWeek(w));
  if (!rest.length || weekly.loading) return;
  if (!(await buyMissingWeeks(rest))) return;
  // No search: not one of these weeks is priced, so nothing to re-rank. The
  // cards and the pop-up read them straight out of the cache.
  paint();
}

/**
 * Fetch (or generate) the span's missing weeks into the cache, and nothing
 * else: no change of measure, no repaint, no search. Resolves true when it
 * finished for the source it started on, false when something newer took over.
 *
 * Split out of `loadWeekly` for the week-by-week pop-up, which needs the weeks
 * but must NOT re-run the search — `runSearch` shuts the pop-up, so buying the
 * weeks through the page button would close the very thing that asked for them.
 */
async function buyMissingWeeks(list = null, { fresh = false } = {}) {
  const key = sourceKey();
  const missing = list ? list.filter((w) => !haveWeek(w)) : missingWeeks();
  if (!missing.length) return true;

  const token = ++weekly.token;
  const stale = () => token !== weekly.token || sourceKey() !== key;

  weekly.loading = true;
  weekly.error = null;
  weekly.progress = { done: 0, total: missing.length };
  // The cost line is repainted BEFORE the first request goes out, so the number
  // being spent is on screen while it is being spent and not after.
  renderCost();

  try {
    if (state.source === 'demo') {
      const generate = await getDemoGenerator();
      if (stale()) return false;
      // A missing generator is a message, not an early exit: returning here
      // would skip the caller's repaint and leave the failure written into
      // state where nobody can read it.
      if (!generate) {
        weekly.error = 'Demo roster data isn’t available yet (js/demo-rosters.js is missing).';
      } else {
        for (const w of missing) {
          const built = generate(w);
          if (built && built.teams && built.teams.length) rememberWeek(w, built.teams);
          else weekly.failed.add(w);
          weekly.progress.done++;
        }
        weekly.means = new Map();
      }
    } else {
      for (let i = 0; i < missing.length; i += WEEK_BATCH) {
        const batch = missing.slice(i, i + WEEK_BATCH);
        // WHERE EACH WEEK CAME FROM, counted separately. `season.js` answers
        // 'store' for a week this browser already held, and one of those cost
        // nothing — a page that counted it as a request would be overstating
        // its own cost, which is the same dishonesty as understating it.
        // A season module without the fourth argument (an older stub) reports
        // `undefined`, which falls to 'espn': the safe direction, since it
        // over-counts rather than hiding a real request.
        const sources = new Map();
        const got = await fetchWeeksRosters(batch, {
          fresh,
          onProgress: (done, total, week, from) => {
            if (week !== undefined) sources.set(week, from || 'espn');
            if (stale() || !weekly.progress) return;
            weekly.progress.done++;
            renderCost();
          },
        });
        if (stale()) return false;
        for (const w of batch) {
          if (sources.get(w) === 'store') weekly.fromStore++;
          else weekly.requests++;
          if (got.has(w)) rememberWeek(w, got.get(w));
          else weekly.failed.add(w);
        }
        weekly.means = new Map();
        renderCost();
      }
    }
  } catch (err) {
    if (stale()) return false;
    weekly.error = err && err.message ? err.message : String(err);
  } finally {
    if (!stale()) {
      weekly.loading = false;
      weekly.progress = null;
    }
  }

  return !stale();
}

// --------------------------------------------------------------- the cost line

/**
 * What the weekly-measure button says, and whether it can be pressed.
 *
 * A FUNCTION OF STATE, not of the DOM, and that is the point of it. The combo
 * panel quotes this button by name — "Press <the button> at the top" — and it
 * used to do that by reading `$('loadWeeks').textContent` back off the page,
 * which only ever gave the right answer because `renderCost()` happened to run
 * earlier in `paint()` than `renderCombo()` did. That is a panel working
 * because of the order it is painted in, and the panels have just been
 * reordered; one shared derivation is the fix rather than a comment asking the
 * next person not to move anything.
 */
/**
 * What the weekly-measure button says, and whether it can be pressed.
 *
 * ITS JOB CHANGED ON 2026-09-19. It used to be the only thing on the page that
 * would spend a request, and its face was the cost being asked for. The page
 * prices itself now, so the interesting press is the other one Tim named —
 * "until you re-load it" — and the button is a RE-READ: throw this browser's
 * stored weeks away and buy them again from ESPN. That is the one action a
 * reader cannot get any other way, and it is what somebody reaches for when a
 * number looks wrong.
 *
 * Three other faces remain, and each is a real state rather than a variation
 * on one: a span with nothing in it, a load in flight, and a load that came
 * back short (ESPN refused a week, or the page was switched mid-flight). The
 * last of those is a RETRY and says the number it would spend, because that is
 * the one case where a press is about to cost something the reader has not
 * already paid.
 *
 * A FUNCTION OF STATE, not of the DOM, and that is the point of it. The combo
 * panel quotes this button's face word for word when it has to name it, and it
 * used to do that by reading `$('loadWeeks').textContent` back off the page —
 * which only ever gave the right answer because `renderCost()` happened to run
 * earlier in `paint()` than `renderCombo()` did. Both derive it from here now,
 * so the paint order is free.
 */
function weeksButton() {
  const span = weeklySpan();
  const ready = weeklyReady();

  if (!span.length) return { label: 'No remaining weeks to price', disabled: true, act: 'none' };
  if (weekly.loading) {
    const p = weekly.progress;
    return {
      label: p ? `Reading week ${Math.min(p.done + 1, p.total)} of ${p.total}…` : 'Reading…',
      disabled: true,
      act: 'none',
    };
  }
  if (ready) {
    // The whole season, not the span: a re-read buys the played weeks and the
    // bracket back as well, and the face has to name what it will spend.
    const all = readableWeeks();
    return {
      label: state.isDemo
        ? 'Rebuild the sample weeks — generated, no requests'
        : `Re-read ${weekRange(all)} from ESPN — ${plural(all.length, 'request')}`,
      disabled: false,
      act: 'fresh',
    };
  }
  // Short of a full span: something refused, or the page changed underneath it.
  return {
    label: state.isDemo
      ? `Price ${weekRange(span)} — generated, no requests`
      : `Retry ${weekRange(span)} — ${plural(missingWeeks().length, 'request')}`,
    disabled: false,
    act: 'retry',
  };
}

/**
 * "read 12 minutes ago · weeks 1–4 are final" — or nothing at all.
 *
 * HOW OLD ARE THESE NUMBERS is a question this page could not be asked before,
 * because nothing survived a reload. It can be now, and it has to be able to
 * answer: a stale number that cannot be told from a fresh one is worse than no
 * cache (see the freshness rule in js/store.js, which is where the argument
 * lives).
 *
 * The age quoted is the OLDEST unfinal week, not the newest and not an average.
 * A reader asking this wants to know whether anything on screen predates the
 * news he has just heard, and the oldest week is the only one of the three that
 * answers it. Played weeks are quoted separately and without an age, because
 * they have none worth having — a result does not get staler.
 */
function storedAgeLine() {
  if (state.isDemo || typeof season.storedWeeks !== 'function') return '';
  // MEMOISED FOR FIVE SECONDS, and that is not premature. `renderCost()` runs
  // on every repaint and once per week as a load progresses, and listing the
  // store parses every entry it holds — seventeen weeks is the better part of a
  // megabyte of JSON. Five seconds costs nothing in honesty, because the line
  // it produces is coarse to the minute: "read 12 minutes ago" is the same
  // sentence five seconds later.
  const now = Date.now();
  if (now - ageLine.at < 5000) return ageLine.text;

  const build = () => {
    let held;
    try { held = season.storedWeeks(); } catch { return ''; }
    if (!held || !held.length) return '';
    return describeHeld(held);
  };
  ageLine = { at: now, text: build() };
  return ageLine.text;
}

/**
 * The words, given what the store says it is holding.
 *
 * Split from the memo above so the arithmetic is readable on its own — and so a
 * test can reach it without waiting five seconds for a cache to expire.
 */
function describeHeld(held) {
  const shown = new Set(seasonWeeks());
  const mine = held.filter((e) => shown.has(e.week) && e.fresh);
  if (!mine.length) return '';

  const live = mine.filter((e) => !e.final);
  const banked = mine.length - live.length;
  const oldest = live.reduce((a, e) => (a === null || e.ageMs > a ? e.ageMs : a), null);

  const bits = [];
  if (oldest !== null && typeof season.describeAge === 'function') {
    bits.push(`projections read ${season.describeAge(oldest)}`);
  }
  if (banked) bits.push(`${plural(banked, 'played week')} kept as final`);
  return bits.join(', ');
}

function renderCost() {
  const span = weeklySpan();
  const btn = $('loadWeeks');

  // ------------------------------------------------------------- the button
  const face = weeksButton();
  btn.disabled = face.disabled;
  btn.textContent = face.label;

  // -------------------------------------------------- what has been spent
  //
  // AND HOW OLD IT IS. The page reads itself now, so a reader who did not press
  // anything has no other way of telling a number read four minutes ago from
  // one read this morning — which is rule 7 in HANDOFF.md, and the whole price
  // of being allowed a cache at all. `season.storedWeeks()` is the honest
  // answer; a season module without it (an older stub) simply says nothing.
  const failed = [...weekly.failed].sort((a, b) => a - b);
  const spent = [];
  // "on this reading", not "on this page": a re-read zeroes the counters and
  // starts again, so "on this page" would be a lifetime figure this does not
  // keep and would quietly under-report a browser that has pressed Re-read.
  if (weekly.requests) spent.push(`${plural(weekly.requests, 'request')} spent on this reading`);
  if (weekly.fromStore) {
    spent.push(
      `${plural(weekly.fromStore, 'week')} came from this browser — no request` +
      (weekly.requests ? '' : ' at all')
    );
  }
  const age = storedAgeLine();
  if (age) spent.push(age);
  if (failed.length) spent.push(`ESPN gave nothing for ${failed.map((w) => `week ${w}`).join(', ')}`);

  $('costSpent').innerHTML = weekly.loading
    ? `<span class="working">${esc(
        weekly.progress
          ? `reading week ${Math.min(weekly.progress.done + 1, weekly.progress.total)} of ` +
            `${weekly.progress.total}…`
          : 'reading…'
      )}</span>`
    : spent.map(esc).join(' · ');

  // ------------------------------------------------------------- the words
  //
  // The number is named before it is spent, every time, and the sentence says
  // WHY it cannot be one request: there is no bulk form, and four shapes of
  // that request were tried before this was settled.
  const spanWords = span.length
    ? `${weekRange(span)} — ${plural(span.length, 'week')}`
    : 'no weeks: every week ESPN projects has already been played';

  // Weeks belonging to ANOTHER league are not weeks in hand, so a mismatched
  // cache counts for nothing rather than making the price look smaller.
  const already =
    weekly.key === sourceKey() ? span.filter((w) => weekly.byWeek.has(w)).length : 0;
  const owed = Math.max(0, span.length - already);
  const costLine = state.isDemo
    ? `it is <strong>one request per week</strong> on a real league. Sample rosters are ` +
      `generated inside the page, so on demo data this costs ` +
      `<strong>no requests at all</strong>; on your ESPN league the same span would be ` +
      `<strong>${plural(owed, 'request')}</strong> — one per week.`
    // "ONE request on the other two measures" used to live here and is gone:
    // it stopped being true the day the page started reading the whole season
    // on load, whichever measure is drawn. The card and the deal pop-up want
    // those weeks either way, so choosing a cheap measure no longer buys a
    // cheap page — it only changes which number is printed.
    : `this is <strong>${plural(owed, 'request')}</strong> ` +
      `still to spend — <strong>one request per week</strong>, less the ${already} ` +
      `already in hand. The span itself is ${plural(span.length, 'request')}; ` +
      `<strong>choosing one of the other two measures does not make the page cheaper</strong>, ` +
      `because the weeks are read for the player cards and the deal pop-up whichever measure ` +
      `is on screen.`;

  // WHY IT NO LONGER WAITS TO BE ASKED. This used to be a button you pressed,
  // and the change is worth stating on the page rather than only in the code:
  // the weeks are kept in this browser between pages now, so the same reader
  // opening the page twice pays once.
  const autoLine = state.isDemo
    ? `<strong>The page prices itself.</strong> On sample data every week is generated inside ` +
      `the page, so this costs nothing whenever it happens.`
    : `<strong>The page prices itself on load</strong>, rather than waiting to be asked. That ` +
      `changed on 2026-09-19: the weeks are now kept <strong>in this browser</strong> between ` +
      `pages, so a second visit spends nothing and a first spends what a button press would have ` +
      `spent a moment later. A week that has been <strong>played is kept for the season</strong> — ` +
      `it can never change again — and a week still to come is re-read after six hours, because ` +
      `ESPN revises a future projection as injury news lands. The button above throws all of ` +
      `that away and reads every week again.`;

  // WHICH WEEKS, AND WHY THOSE. The span used to be the reader's pick — the
  // week picker and everything after it — and it is now derived from the
  // schedule, so it has to be stated rather than assumed. Tim can no longer
  // work it out from the control he set.
  const playedNow = playedWeeks();
  const spanReason = state.isDemo
    ? `The sample season is marked as fully played, so demo treats the week you have ` +
      `selected as “now”: <strong>week ${state.week} and everything before it is ` +
      `banked</strong> and the rest of that sample season is what gets priced. On your ` +
      `real league the same sentence is read off the schedule instead.`
    : playedNow.length
      ? `<strong>${weekRange(playedNow)} ${playedNow.length === 1 ? 'has' : 'have'} been ` +
        `played</strong> and ${playedNow.length === 1 ? 'is' : 'are'} left out of every number ` +
        `on this page — a trade changes the rest of the season and cannot move points that are ` +
        `already banked. Which weeks those are is read off the league SCHEDULE (a game with a ` +
        `result), never off today’s date.`
      : `Nothing has been played yet according to the league schedule, so the whole season ` +
        `ahead is priced.`;

  // THE WEEKS THAT ARE SHOWN BUT NEVER PRICED, and there are now two kinds of
  // them: the ones already played (for the player card's whole-season run and
  // its Act row) and the playoff weeks. Both cost a request each on a cold
  // browser and neither reaches a single figure on this page, so both are
  // stated where the cost is stated.
  const past = pastWeeksShown();
  const po = playoffWeeksShown();
  const shownOnly = [...past, ...po];
  const shownLine = shownOnly.length
    ? `<br><br><strong>The weeks it shows but does not price.</strong> ` +
      (past.length
        ? `${weekRange(past)} ${past.length === 1 ? 'has' : 'have'} been played, and ` +
          `${past.length === 1 ? 'is' : 'are'} read so a player’s card can show his whole ` +
          `season — including what he ACTUALLY scored, which only a played week has. `
        : '') +
      (po.length
        ? `${weekRange(po)} are the playoff weeks, shown after a line in a deal’s pop-up and in ` +
          `every card’s run. `
        : '') +
      (state.isDemo
        ? 'On sample data they are generated, so they cost nothing.'
        : `Together that is <strong>${plural(shownOnly.length, 'request')}</strong> on a browser ` +
          `that has not read them before, and none on one that has. ` +
          `<strong>Not one of them is in any figure on this page.</strong>`)
    : '';

  // The method, behind the toggle: which weeks, why those, and what they cost.
  $('costNote').innerHTML =
    `<strong>Every remaining week</strong> prices ${spanWords}. ${spanReason}` + shownLine +
    `<br><br>` + autoLine +
    `<br><br>` +
    `<strong>Cost.</strong> ESPN has no bulk form — asking for thirteen weeks in one call ` +
    `returns only the current one, and four shapes of that request were tried — so ${costLine}` +
    `<br><br>` +
    `<strong>Speed.</strong> Every offer is priced by re-filling ` +
    `${plural(span.length, 'lineup')} instead of one, so the search takes a few seconds rather ` +
    `than a fraction of one.`;

  // What changes the meaning of a number stays in view, never behind the toggle.
  const warns = [
    weekly.error ? `<strong>${esc(weekly.error)}</strong>` : '',
    failed.length
      ? `ESPN returned nothing for ${failed.map((w) => `week ${w}`).join(', ')}; ` +
        `those weeks are left out of every number below, not counted as zero.`
      : '',
    // The page loads them itself now, so this is a PROGRESS line rather than an
    // instruction — but it still changes what every number below means, which
    // is what keeps it out in front of the toggle rather than behind it.
    state.measure === 'weeks' && !weeklyReady()
      ? (weekly.loading
        ? `<strong>Still reading ${weekRange(span)}</strong>` +
          (weekly.progress ? ` — week ${Math.min(weekly.progress.done + 1, weekly.progress.total)} ` +
            `of ${weekly.progress.total}` : '') +
          `. Until they are all in, every figure below is <strong>a typical week</strong>, ` +
          `which is a different number on a different scale.`
        : `<strong>Every remaining week is selected but not loaded</strong>, so the page is ` +
          `showing <strong>a typical week</strong>. Press the button above to read them again.`)
      : '',
  ].filter(Boolean);
  const warnEl = $('costWarn');
  warnEl.innerHTML = warns.join('<br>');
  warnEl.hidden = !warns.length;
}

// -------------------------------------------------------- player references
//
// The site's one contract, unchanged here: every name is a real <a href> to
// that man's row on the Players page, carrying ESPN's own playerId and the
// class `pref`. Never a click handler, never a name, never a row index. A
// second way of naming a player is exactly how the two halves drift apart, and
// `tests/link-check.mjs` follows the ids this page emits to prove they land.
//
// THE LINK SAYS WHERE IT GOES WITH `aria-label`, NOT `title`. It used to carry
// a `title`, and it cannot any more: the element around it now draws a card of
// its own, and a `title` beside a card has the browser paint its own tooltip on
// top a moment later. Same rule, and the same reason, as the analysis grids.

function playerRef(p, inner) {
  if (p.playerId === null || p.playerId === undefined) return inner;
  return (
    `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ` +
    `aria-label="${esc(p.name)} — open his next 13 weeks on the Players page">${inner}</a>`
  );
}

/**
 * The card for one man: who he is, and his week run.
 *
 * Tim asked for this in one line — "whenever a player is named, show the 13
 * week preview just like the analysis section" — and it is the same card,
 * literally: `js/player-card.js` is the analysis page's, extracted.
 *
 * THE RUN IS THE WHOLE SEASON SINCE 2026-09-19, and that is Tim's second ask of
 * the day: "right now in the trade section it shows the act in the preview, but
 * it doesn't actually display any previous weeks in the chart, so that whole row
 * is useless."
 *
 * He was exactly right, and the cause was structural rather than a bug. The run
 * used to cover the weeks this page HELD, and this page only ever bought the
 * REMAINING span — because a trade cannot move banked points, so a played week
 * is not evidence about any deal. But an "Act" row is actual points, and actual
 * points only exist for a week that has been played. So the card's third row
 * was empty for every player on this page, every time, by construction.
 *
 * The run is now weeks 1 to the last playoff week; the played half is bought
 * for the card and reaches no price at all (`loadHistory`). A week that has not
 * arrived yet is the card's own faint dot rather than a gap or a zero.
 *
 * THE STARTS COUNT is his third ask in the same paragraph — "the number of
 * starting weeks in that user's lineup ... based on the information we have in
 * the who to start, week by week box" — and it is on the heading line, which is
 * the only place it can go: `js/player-card.js` is shared with the Analysis
 * page and is a HANDOFF contract, so it draws `ident` and `heading` as plain
 * text and this page does not get to add a row to it.
 */
function cardFor(p) {
  const weeks = cardWeeks();
  const injured = p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? ` · ${p.injuryStatus}` : '';
  // Same rule as `posTag`, and it has to hold here too: the card's identity line
  // is another place a player is rendered on this page, and "Chargers D/ST · DST"
  // says it twice there as much as in a table cell.
  const pos = p.position === 'DST' ? '' : ` · ${p.position}`;
  const ident = `${p.name}${pos}${p.proTeam ? ` · ${p.proTeam}` : ''}${injured}`;
  const href =
    p.playerId === null || p.playerId === undefined
      ? null
      : `waivers.html?player=${encodeURIComponent(p.playerId)}`;

  const heading = state.isDemo
    ? `Sample projections for ${weekRange(weeks)}`
    : `ESPN’s projection for ${weekRange(weeks)}`;
  const tail = startsPhrase(p);

  return {
    ident,
    href,
    run: weekRun({
      heading: heading + tail,
      weeks,
      projections: weeks.map((w) => tokenAt(p, w, 'projected')),
      actuals: weeks.map((w) => tokenAt(p, w, 'actual')),
      currentWeek: state.week,
      demo: state.isDemo,
      // A 0.00 is "Bye" only in his team's bye week; see `zeroKind`.
      byeWeek: byeWeekOf(p, state.byes),
      // The heavy line before the first playoff week, when the run reaches it.
      playoffWeeks: state.poWeeks,
      injuryStatus: weeks.map((w) => {
        const e = weekly.byWeek.get(w)?.get(p.playerId);
        return (e && e.injuryStatus) || p.injuryStatus || null;
      }),
    }),
  };
}

/**
 * THE WHOLE SEASON, weeks 1 to the last playoff week — not the weeks in hand.
 *
 * It used to be "the weeks this page has actually read", which is what left the
 * Act row empty: this page reads the REMAINING span, and an actual only exists
 * for a week already played. A run that is a fact about the PAGE'S CACHE also
 * grows and shrinks under the reader as the weeks land, so a man's season
 * appeared to change length while he looked at it.
 *
 * A week the page has not read yet is the card's own faint "not read" dot —
 * `tokenAt` returns `wait` — which is honest and settles as the weeks arrive.
 * A week ESPN refused stays distinct from that, and both stay distinct from a
 * man who was on nobody's roster (`off`), because they are three different
 * facts and the card draws them three different ways.
 */
function cardWeeks() {
  return seasonWeeks();
}

/**
 * Who starts for one squad in one week, solved once and remembered.
 *
 * `optimalLineup` is `js/forecast.js`'s — the same solver "Who to start" runs,
 * which is why the Starts count here and the Starts column there cannot come to
 * different answers about one man (HANDOFF, "Four features now share
 * optimalLineup").
 *
 * NO FLOORS. HANDOFF rule 13: the positional floor is applied when a lineup is
 * ASSESSED and never when it is CHOSEN, or a flex choice between a 5 and a 4
 * becomes a tie once both are lifted to 8 and the site starts telling him to
 * start different players because of a waiver-wire number. This is a question
 * about who is chosen, so it uses ESPN's own projections and nothing else.
 *
 * Ten squads by seventeen weeks is at most 170 solves for the life of the
 * cache, shared by every card on the page.
 */
function startersIn(week, teamId) {
  const key = `${week}:${teamId}`;
  const held = weekly.lineups.get(key);
  if (held) return held;

  const roster = weekly.rosters.get(week);
  const players = roster ? roster.byTeam.get(teamId) : null;
  // A man with no id cannot be followed from one week to the next and cannot be
  // counted, so he is out of the solve as well — the same rule the analysis
  // page's `identified()` applies, and for the same reason: leaving him in
  // would mark a lineup spot no count can carry.
  const pool = (players || []).filter((p) => p.playerId !== null && p.playerId !== undefined);
  const set = new Set(
    pool.length && state.slots
      ? optimalLineup(pool, state.slots).starters.map((s) => s.playerId)
      : []
  );
  weekly.lineups.set(key, set);
  return set;
}

/**
 * How many of the weeks read this man is in his OWN manager's best lineup.
 *
 * Tim, 2026-09-19: "I want to start showing that player's number of starting
 * weeks in that user's lineup in this same preview that is shown, based on the
 * information we have in the 'who to start, week by week' box."
 *
 * WHOSE LINEUP IS DECIDED PER WEEK, not once. A man traded or claimed in
 * October was somebody else's in September, and counting his whole season
 * against the squad that holds him today would credit one manager with weeks he
 * never had. The roster index knows who held him in each week, so the question
 * asked is the honest one: in the week in question, did the manager who ACTUALLY
 * held him have him in his best legal lineup.
 *
 * OUT OF THE WEEKS READ, never out of all of them — the same rule the analysis
 * page's Starts column follows. A page half-loaded would otherwise report a
 * squad as half-benched, which is a fact about the page and not about the
 * squad. The phrase says how many weeks that was.
 *
 * @returns {{starts:number, weeks:number, team:string, moved:boolean}|null}
 */
function startsFor(p) {
  if (!p || p.playerId === null || p.playerId === undefined) return null;
  if (!state.slots) return null;

  let starts = 0;
  let read = 0;
  let last = null;
  const holders = new Set();
  for (const w of seasonWeeks()) {
    const roster = weekly.rosters.get(w);
    if (!roster) continue;
    const holder = roster.teamOf.get(p.playerId);
    if (holder === undefined) continue;   // nobody rostered him that week
    read++;
    holders.add(holder);
    last = holder;
    if (startersIn(w, holder).has(p.playerId)) starts++;
  }
  if (!read) return null;
  return {
    starts,
    weeks: read,
    // The MOST RECENT holder, which is the squad the reader is looking at him
    // on. `moved` is the honest caveat for the other case: a man who changed
    // hands in October did not earn his September weeks here, and naming one
    // manager without saying so would credit him with somebody else's.
    team: last === null ? '' : nameOfTeam(last),
    moved: holders.size > 1,
  };
}

/** A squad's manager, by id, off the week currently loaded. */
function nameOfTeam(teamId) {
  const t = (state.data ? state.data.teams : []).find((x) => x.id === teamId);
  return t ? t.name : '';
}

/**
 * The starts count as the tail of the card's heading line.
 *
 * It names the squad and the number of weeks the count is over, because both
 * change: "9 of 14" over one manager's weeks is a completely different claim
 * from "9 of 17", and a man who changed hands has two managers in his season.
 * Silent on a man nobody has rostered in any week read — a zero there would be
 * a statement about a squad rather than about him.
 */
function startsPhrase(p) {
  const s = startsFor(p);
  if (!s) return '';
  const who = s.team ? ` for ${s.team}` : '';
  return (
    ` · in the best lineup${who} in ${s.starts} of ${plural(s.weeks, 'week')} read` +
    (s.moved ? ' (he has changed squads this season, so some of those weeks were elsewhere)' : '')
  );
}

/**
 * One cell of a man's run, in the card's own vocabulary.
 *
 * `failed` and a missing week are different things and stay different: ESPN
 * refusing a week is a fact about ESPN, and a week nobody asked for is a fact
 * about this page. A man absent from a week the league answered for is `off` —
 * he was on nobody's roster then.
 */
function tokenAt(p, week, field) {
  if (weekly.failed.has(week)) return 'failed';
  const idx = weekly.byWeek.get(week);
  if (!idx) return 'wait';
  const e = idx.get(p.playerId);
  if (!e) return 'off';
  return e[field];
}

/**
 * A player's position, as a tag — EXCEPT on a defence.
 *
 * Tim's words: "Don't put the defences position label next to the name, because
 * the position is in the name (chargers def)." He is right and it is worth
 * checking rather than assuming: ESPN names every D/ST `"<Franchise> D/ST"`
 * (`docs/espn-draft-api.md`, position id 16, exactly 32 of them) and
 * `js/demo-rosters.js` builds the same string, so "Chargers D/ST · DST" says it
 * twice.
 *
 * THE TEST IS THE POSITION, NOT THE NAME. Matching /D\/ST/ on the name would be
 * a second way of knowing one fact — and the name is the half that varies,
 * between ESPN, the sample data, and whatever a future payload does. The
 * position is `'DST'` in both, because `js/espn.js` maps it there and nothing
 * else on the site is allowed to decide it.
 *
 * It returns a bare space where the tag is suppressed, so the number does not
 * run into the name — the tag's own margin is what usually separates them.
 */
const posTag = (position) =>
  position === 'DST' ? ' ' : `<span class="pp">${esc(position)}</span>`;

/**
 * One man in a package: his name, his position, what he is worth A WEEK, and a
 * card.
 *
 * ONE NUMBER, AND IT IS THE PER-WEEK ONE. Tim's words: "Right now it shows a
 * big number (I think season proj) next to the position and then the per/week
 * after that. Just put per week." The engine still computes the rest-of-season
 * total — `candidates()` ranks by it and the forced cut is decided on it — this
 * is purely about what reaches the screen.
 *
 * WHICH FIELD IS THE PER-WEEK ONE DEPENDS ON THE BASIS, and getting that
 * backwards is the factor-of-nine error this file's header is about. On the two
 * scalar measures `projected` is ALREADY per week (`typicalWeek` is the season
 * projection over 17 games; `weekProjection` is one week's own number). On the
 * weekly measure `projected` is a rest-of-season total and `perWeek` is the
 * mean. So the basis picks the field, and nothing here can print a total.
 *
 * A man with no number at all prints "—" and NOT "—/wk", which would read as a
 * unit on a quantity that is not there.
 */
function perWeekValue(p) {
  if (basis() !== 'weeks') return p.projected;
  // An offer found on a scalar measure carries no `perWeek` — it happens when a
  // pop-up opened on one stays open while the page re-ranks week by week — and
  // printed "—" for every man. `weeklyMean` is the same arithmetic, byes out.
  return Number.isFinite(p.perWeek) ? p.perWeek : weeklyMean(p);
}

function manLine(p) {
  const key = registerRun(cardFor(p), 'pkg');
  const v = perWeekValue(p);
  const val = Number.isFinite(v)
    ? `<span class="val">${fmt(v)}/wk</span>`
    : `<span class="val">—</span>`;
  const inner = `${esc(p.name)}${posTag(p.position)}${val}`;
  return `<span class="man"${tipAttr(key)}>${playerRef(p, inner)}</span>`;
}

// ------------------------------------------------------------- the depth map

/**
 * Which cells get a tint, decided per COLUMN rather than per cell.
 *
 * The number in a cell is points above replacement, and how big a number counts
 * as "deep" is not the same at quarterback as at kicker — so an absolute
 * threshold would tint whole columns and mean nothing. Ranking inside the
 * column asks the only question the table is for: of these ten managers, who is
 * strongest here and who is weakest. The top and bottom three are marked and
 * the middle is left alone, which is also an answer.
 *
 * Ties get the same treatment as each other rather than being split by roster
 * order: three managers level at the bottom are all three of them the bottom.
 */
function tintsFor(rows, position) {
  const values = rows
    .map((r) => r.cells.get(position))
    .map((c) => (c && Number.isFinite(c.startersEdge) ? c.startersEdge : null))
    .filter((v) => v !== null);

  if (values.length < 6) return { deep: null, thin: null }; // too few to rank
  const sorted = [...values].sort((a, b) => b - a);
  const deep = sorted[2];                      // 3rd best
  const thin = sorted[sorted.length - 3];      // 3rd worst
  // A column where everyone is level is a column with nothing to say.
  return deep <= thin ? { deep: null, thin: null } : { deep, thin };
}

function renderDepthHead(positions) {
  $('depthTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort>Manager</th>
       ${positions
         .map(
           (p) =>
             `<th data-sort title="Points above replacement that this manager’s ` +
             `starters at ${esc(p)} are worth.">${esc(p)}</th>`
         )
         .join('')}
       <th class="grouped" data-sort title="The best legal lineup this squad could field, added up.">Lineup</th>
     </tr>`;
}

function depthCellHtml(cell, tints) {
  if (!cell || !Number.isFinite(cell.startersEdge)) {
    return '<td class="cell muted" data-v="">—</td>';
  }

  const cls = ['cell'];
  if (tints.deep !== null && cell.startersEdge >= tints.deep) cls.push('deep');
  else if (tints.thin !== null && cell.startersEdge <= tints.thin) cls.push('thin');

  const spare =
    cell.surplusEdge > 0
      ? `<span class="spare">spare ${signedText(cell.surplusEdge)}</span>`
      : '';

  const tip =
    `${cell.startable} startable ${cell.position}${cell.startable === 1 ? '' : 's'}, ` +
    `${cell.needed} needed in the lineup. ` +
    (cell.surplusEdge > 0
      ? `The spare figure is what he could send without weakening his own lineup.`
      : cell.net < 0
        ? `He is a man short here.`
        : `Nothing spare here.`);

  return (
    `<td class="${cls.join(' ')}" data-v="${cell.startersEdge}" title="${esc(tip)}">` +
    `${signedText(cell.startersEdge)}${spare}</td>`
  );
}

function renderDepth() {
  const teams = state.data ? state.data.teams : [];
  const table = $('depthTable');

  $('depthWrap').classList.toggle('hidden', teams.length === 0);
  $('depthEmpty').classList.toggle('hidden', teams.length > 0);
  if (!teams.length) {
    $('depthBars').innerHTML = '';
    $('spareStrip').innerHTML = '';
    $('depthNote').innerHTML = '';
    $('depthWarn').innerHTML = '';
    $('depthWarn').hidden = true;
    return;
  }

  const map = depthTable(teams, state.slots, measureFn());
  renderDepthHead(map.positions);

  const tints = new Map(map.positions.map((p) => [p, tintsFor(map.rows, p)]));

  bodyOf(table).innerHTML = map.rows
    .map((row) => {
      const mine = row.team.id === state.myTeamId;
      return (
        `<tr${mine ? ' class="me"' : ''} data-team="${esc(row.team.id)}">` +
        `<td class="name">${esc(row.team.name)}</td>` +
        map.positions.map((p) => depthCellHtml(row.cells.get(p), tints.get(p))).join('') +
        `<td class="grouped" data-v="${row.total ?? ''}">${fmt(row.total)}</td>` +
        `</tr>`
      );
    })
    .join('');

  renderBars(map);
  renderSpares(map);
  renderDepthNote(map);
  resort(table);
}

/** The bar every column is measured against, stated rather than implied. */
function renderBars(map) {
  $('depthBars').innerHTML = map.positions
    .map((p) => {
      const r = map.replacement.get(p);
      if (!r || !Number.isFinite(r.value)) return '';
      const tip = r.exhausted
        ? `Every ${p} in the league is in somebody’s lineup, so there is no spare ` +
          `man to set a bar with — the worst starter is used instead.`
        : `${r.startedInLeague} of the ${r.pooled} ${p}s in the league are starting. ` +
          `The bar is the best one who is not.`;
      return (
        `<span class="bar-chip" title="${esc(tip)}">${esc(p)} ` +
        `<strong>${fmt(r.value)}</strong>${r.exhausted ? ' *' : ''}</span>`
      );
    })
    .join('');
}

/**
 * Your own spare men, named.
 *
 * The depth map's cells are numbers, and "spare +4.2" at running back does not
 * tell you WHO. This is the one place on that panel a player is named, and it
 * is the part of a squad a trade can actually reach — so it is also the part
 * most worth putting a week run on. Same card as everywhere else.
 */
function renderSpares(map) {
  const row = map.rows.find((r) => r.team.id === state.myTeamId);
  if (!row) { $('spareStrip').innerHTML = ''; return; }

  const chips = map.positions
    .map((position) => {
      const cell = row.cells.get(position);
      if (!cell || !cell.spare) return '';
      const p = cell.spare.p;
      const key = registerRun(cardFor(p), 'spare');
      const inner =
        `<strong>${esc(p.name)}</strong>${posTag(position)}${fmt(cell.spare.v)}`;
      return `<span class="spare-chip"${tipAttr(key)}>${playerRef(p, inner)}</span>`;
    })
    .filter(Boolean);

  $('spareStrip').innerHTML = chips.length
    ? `<span class="spare-chip">Your spare men →</span>${chips.join('')}`
    : '';
}

function renderDepthNote(map) {
  const m = meta();
  const anyExhausted = map.positions.some((p) => {
    const r = map.replacement.get(p);
    return r && r.exhausted;
  });
  const span = weeklySpan();

  $('depthNote').innerHTML =
    `<strong>What the number is.</strong> Every number is <strong>points above replacement</strong> ` +
    `— how much better this manager’s starters at that position are than the man anybody could ` +
    `have instead. <strong>Replacement</strong> is not a typed-in constant: it is the best player ` +
    `at that position who is <strong>not starting anywhere in the league</strong>. The chips ` +
    `under the table show what that came out at, valued on ${esc(m.label)} (${m.basis}).` +
    `<br><br>` +
    (basis() === 'weeks'
      ? `<strong>Per week.</strong> Every figure in this table is <strong>per week</strong>, over ` +
        `${weekRange(span)} — <strong>the weeks still to be played</strong>, read off the league ` +
        `schedule rather than the calendar, because a week with a result against it is banked and ` +
        `no trade can reach it. A man’s average leaves his <strong>byes</strong> out: a 0.00 is a ` +
        `fact about the fixture list, not about him, and counting it would price him on the weeks ` +
        `he is off rather than the weeks he plays. Only his real bye week counts as one: ESPN also ` +
        `returns 0.00 for a man it has ruled out, and that zero stays in his average. ` +
        `The panels above are per week too, but a deal’s ` +
        `gain is spread over every week in the span, byes and all, so a man’s figure here is ` +
        `deliberately not the same arithmetic.` +
        `<br><br>` +
        `<strong>Lineup</strong> is what those averages would field. Picking each week separately ` +
        `always beats it, and the gap between the two is what depth is worth: a squad whose men ` +
        `swing about has a higher week-by-week total than its averages suggest, and a squad of ` +
        `metronomes has none. That is why the deals above are priced week by week and this table ` +
        `is not.` +
        `<br><br>`
      : '') +
    `<strong>How to read it.</strong> A high number is depth worth trading from; a low one is a ` +
    `lineup spot going to waste. <strong>Read down a column</strong>, not across a row — the ` +
    `manager worth talking to is the one whose number is low where yours is high. ` +
    `<strong>spare</strong> beside a number is what that manager could send ` +
    `<em>without weakening his own lineup</em> — the part of his squad a trade can actually ` +
    `reach; your own spare men are named under the table. The three deepest and three thinnest ` +
    `squads at each position are tinted; every cell prints its sign either way.` +
    (anyExhausted
      ? ` A <strong>*</strong> means every player at that position is already in somebody’s ` +
        `lineup, so there is no spare man in the league to set a bar with and the worst ` +
        `starter stands in for one.`
      : '') +
    `<br><br>` +
    // Tim's question, answered where it is asked: "if we trade an RB for a QB,
    // we might get +1.3, however if we have 3RBs, and 3QBs, then that trade
    // might not be too good." It needs no second rule — the weekly measure
    // already answers it — so this says so rather than inventing one.
    `<strong>A surplus is not the same as a gain.</strong> Being deep at a position says you ` +
    `have men to send; it does not say that acquiring one more there is worth anything. ` +
    (basis() === 'weeks'
      // THE ONE PLACE A PLAYED WEEK CAN STILL REACH A NUMBER on this page, and
      // it is said out loud rather than quietly allowed. "The selected week" is
      // a measure the reader asked for BY NAME, so it is not overridden — but
      // when that week has a result against it, it is history, and pricing a
      // trade on history is the thing the weekly measure exists to stop.
      ? `On this basis it is priced properly: a manager starts whichever of his men is highest ` +
        `<em>that week</em>, so a fourth good quarterback adds nothing once three of them already ` +
        `put an 18 in the lineup most weeks — which is why an offer above can be worth little ` +
        `even where this table says the other manager is thin. Click any offer to see it week by ` +
        `week; those rows and this table are the same projections, so they cannot disagree.`
      : `On a single scalar per man it cannot be priced at all — only one quarterback can ever ` +
        `count, so a fourth good one looks like a straight upgrade. <strong>Every remaining week</strong> ` +
        `is the measure that answers it, because it picks each week’s lineup separately.`) +
    `<br><br>` +
    `Nobody here can be claimed off the wire, so nothing on this page is a waiver ` +
    `suggestion — the <a href="waivers.html">Players</a> page answers that.`;

  // A played week changes what every number in the table means, so it is said
  // in view rather than behind the toggle.
  const playedPick = basis() === 'week' && playedWeeks().includes(state.week);
  $('depthWarn').innerHTML = playedPick
    ? `<strong>Week ${state.week} has already been played.</strong> You asked for it by name, ` +
      `so this table uses it — but those points are banked and no trade can move them. ` +
      `<strong>Every remaining week</strong> prices only the weeks a trade can reach.`
    : '';
  $('depthWarn').hidden = !playedPick;
}

// ----------------------------------------------------------- the trade finder

/**
 * What the deal does to your starting lineup, in names. THE POP-UP ONLY.
 *
 * It used to sit on every row of the finder as well, and Tim had it removed
 * (2026-09-17): "because we're building this new display ... that does the same
 * thing but better, lets remove this". On a row it was two wrapped lines in two
 * strong colours that mostly repeated the names already printed in the You send
 * and You get columns beside it. The week-by-week pop-up is where the before
 * and after belong, so this is drawn there and nowhere else.
 *
 * The two bases mean genuinely different things by this list and it must not
 * pretend otherwise. On a scalar measure there is ONE lineup before and one
 * after, so an entry is a man and his projection. Across weeks there are nine
 * to thirteen of each, so an entry is the CHANGE in a man's season contribution
 * with the number of weeks he starts beside it — a man already in the lineup
 * who merely picks up two more weeks appears with what those two weeks are
 * worth, not with his whole season.
 *
 * What survives both readings is the property worth having: in minus out is
 * exactly the gain.
 *
 * THE ONE FACT THE COLUMNS CANNOT SAY is which of these men are HIS OWN. Both
 * lists mix the traded players — already named twice over in the two package
 * columns — with the men of his that the deal quietly promotes or benches, and
 * the second kind is the whole reason a manager reads this at all: a receiver
 * arriving means one of his own loses his place, and that man is named nowhere
 * else on the page. So every entry that was not in the trade is tagged "yours",
 * with the word as well as a colour (HANDOFF: colour is never the only cue).
 */
function churnHtml(churn, offer) {
  if (!churn) return '';
  const weeks = basis() === 'weeks';

  // Who was in the deal, so that everybody else is one of his own. By ESPN's id
  // rather than by name: the id is the identity everywhere else on this site.
  const sides = offer ? [].concat(offer.send || [], offer.receive || []) : [];
  const traded = new Set(sides.map((p) => String(p.playerId)));
  const mine = (s) => !traded.has(String(s.playerId));

  // The D/ST rule again: his position is already in his name. Written as plain
  // text rather than through `posTag` because this line is a sentence, not a
  // row of tagged cells.
  const pos = (s) => (s.position === 'DST' ? '' : ` ${esc(s.position)}`);

  const tag = (s, dir) => {
    if (!mine(s)) {
      return weeks && s.wasStarting && s.nowStarting ? ' (already starting)' : '';
    }
    if (weeks && s.wasStarting && s.nowStarting) {
      return dir === 'in' ? ' <span class="own">(yours, more weeks)</span>'
        : ' <span class="own">(yours, fewer weeks)</span>';
    }
    return dir === 'in' ? ' <span class="own">(yours, promoted)</span>'
      : ' <span class="own">(yours, benched)</span>';
  };

  const one = (dir) => (s) => {
    const when = weeks && Number.isFinite(s.weeks) ? ` over ${plural(s.weeks, 'week')}` : '';
    return `<b>${esc(s.name)}</b>${pos(s)} ${fmt(s.value)}${when}${tag(s, dir)}`;
  };

  const line = (list, cls, word) =>
    list.length ? `<span class="${cls}">${word} ${list.map(one(cls)).join(', ')}</span>` : '';

  const parts = [
    line(churn.in, 'in', weeks ? 'starts more:' : 'starts:'),
    line(churn.out, 'out', weeks ? 'starts less:' : 'drops out:'),
  ].filter(Boolean);
  return parts.length ? `<div class="churn">${parts.join('<br>')}</div>` : '';
}

/**
 * The package shape, in the only words that need no explaining.
 *
 * Tim, 2026-09-17: "I also don't understand what the straight swap, consolidate,
 * or any shape trade categories means." They were "Straight swap", "You
 * consolidate" and "You add depth" — each of them a description of the CONSEQUENCE
 * of a shape rather than the shape itself. A count each way is the shape, it is
 * shorter, and nobody has to be taught it; the consequence is said once, in the
 * hint under the control, where an explanation of a control belongs.
 */
const SHAPE_LABEL = {
  even: '1 for 1',
  consolidate: '2 for 1',
  depth: '1 for 2',
};

/**
 * ESPN's own trade screen, opened with his side already ticked.
 *
 * The URL was established by reading ESPN's production bundle, and the one
 * thing about it that must be said out loud is what it does NOT do:
 * `players=` pre-ticks ONLY the counterparty's players — the ones you would
 * RECEIVE. There is no parameter for your own side. So the button says "his
 * players only" on its face, and the note beside it says the rest; without
 * that, the first click reads as broken.
 *
 * Only ids from that manager's roster THIS WEEK are sent. ESPN ignores an id
 * that is not on the team silently, which is the worst kind of wrong — a screen
 * that opens with one man ticked instead of two and no explanation.
 *
 * Nothing is ever sent from this site. This is a deep link and the page opens
 * it in a new tab; the deal is still proposed by hand, by him, in ESPN.
 */
/**
 * OPENING AN OFFER IN ESPN WITH BOTH SIDES TICKED.
 *
 * ESPN's own URL can only ever pre-tick the counterparty's players. That is not
 * a choice we made: their trade page matches `players=` against the other
 * team's roster alone, there is no parameter for your own side, and swapping
 * `teamId`/`fromTeamId` fails because ESPN overrides `fromTeamId` to a team you
 * own and then refuses with "You are trying to propose trade to yourself."
 * Their own Decline & Counter button ships a trade link with no players at all,
 * which is the clearest evidence that no both-sides encoding exists.
 *
 * So the extension does the other half, on the page, with a content script that
 * ticks the owner's own men. `stageTrade` leaves it a note; the link is opened;
 * the script reads the note and ticks. **Nothing is sent to ESPN by any of
 * this** — the one write is still his own click on ESPN's own Propose button,
 * and the extension keeps only its read permission.
 *
 * The offers are registered by a bare counter rather than serialised into the
 * markup, the same way `js/player-card.js` registers a week run, and for the
 * same reason: a whole package on every row is a lot of duplicated attribute
 * for something read once.
 */
const ESPN_OFFERS = new Map();
let espnSeq = 0;

function offerKey(offer) {
  const key = `o${espnSeq++}`;
  ESPN_OFFERS.set(key, offer);
  return key;
}

/**
 * Stage the owner's side, then send the tab to ESPN.
 *
 * THE TAB IS OPENED BEFORE THE AWAIT, not after. `window.open` called once a
 * promise has resolved has lost the user gesture that authorised it, and every
 * popup blocker treats that as a popup — so the tab is claimed synchronously
 * inside the click and navigated a moment later. If staging fails for any
 * reason, including the extension simply not being installed, the same tab goes
 * to the plain link and the page behaves exactly as it did before: their side
 * ticked, his side to tick by hand.
 *
 * NO `noopener` IN THE FEATURES. It was here, and it broke the button: with
 * `noopener` the browser opens the tab but `window.open` returns `null` — by
 * spec, always — so the page lost its handle on the blank tab it had just
 * opened, then called `window.open` a second time after the await, with the
 * click's permission spent. Tim got a blank tab, and the real one was blocked.
 * The handle is kept instead and the tab's `opener` cut by hand, which is the
 * same protection `noopener` gives ESPN's page.
 *
 * And the extension is only asked when it has said hello. Absent, nothing ever
 * answers and the ask sits out its full timeout while the tab stays blank.
 */
const STAGE_TIMEOUT_MS = 4000;

/**
 * The oldest extension that ticks your side properly: 0.3.0 added the ticking,
 * 0.3.1 stopped it refusing every trade with a D/ST in it, and 0.3.2 says on
 * ESPN's page when a staged deal does not fit the screen. The extension is
 * unpacked, so it runs whatever version was last RELOADED in Edge rather than
 * what is in the repo — which is exactly the failure this check names.
 */
const MIN_TICK_VERSION = '0.3.2';

function versionAtLeast(have, want) {
  if (!have) return false;
  const a = String(have).split('.').map(Number);
  const b = String(want).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * One line, fixed at the foot of the window, saying what became of your side.
 * It stays until dismissed or replaced: it is what he reads when he comes back
 * from ESPN wondering why nothing of his was ticked.
 */
function showEspnOutcome(outcome) {
  const el = $('espnOutcome');
  if (!el || !outcome) return;
  el.classList.toggle('bad', !!outcome.bad);
  $('espnOutcomeText').textContent = outcome.text;
  el.hidden = false;
}

async function openInEspn(offer, href) {
  let tab = null;
  try {
    tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
  } catch {
    tab = null;
  }

  let url = href;
  const names = offer.send.map((p) => p.name).join(' and ');
  // What happened to YOUR side, said on this page once the tab has gone. Every
  // branch below used to fall back to the plain link in silence, so "my side
  // isn't ticked" had four possible causes and no way to tell them apart.
  let outcome = null;
  const version = extensionVersion();
  if (!bridgeAvailable()) {
    outcome = {
      bad: true,
      text: `ESPN will open with his players ticked, but not yours: the Fantasy Football Bridge ` +
        `extension isn’t running on this page. Tick ${names} yourself.`,
    };
  } else if (!versionAtLeast(version, MIN_TICK_VERSION)) {
    outcome = {
      bad: true,
      text: `Your extension is version ${version || 'unknown'}, and ticking your side needs ` +
        `${MIN_TICK_VERSION} or later. Paste edge://extensions into the address bar and press ` +
        `Reload on Fantasy Football Bridge, then reload this page. For now, tick ${names} yourself.`,
    };
  }
  if (bridgeAvailable()) try {
    const cfg = espn.getConfig();
    // The plain link's own filter, applied to the staged link too: an id not on
    // his roster this week is dropped rather than sent, or the two links would
    // disagree about who is ticked.
    const onLink = new Set(
      (new URL(href).searchParams.get('players') || '').split(',').filter(Boolean).map(Number)
    );
    const res = await stageTrade({
      timeoutMs: STAGE_TIMEOUT_MS,
      leagueId: cfg.leagueId,
      season: cfg.season,
      myTeamId: state.myTeamId,
      theirTeamId: offer.partner.id,
      // ESPN's own `fullName` where we have it — the content script matches on
      // the name when it cannot recover an id from the page, which is the only
      // way a D/ST can be found at all (its row carries a team logo, not a
      // headshot with an id in the URL).
      myPlayers: offer.send.map((p) => ({ id: p.playerId, name: p.name })),
      theirPlayerIds: offer.receive.map((p) => p.playerId).filter((id) => onLink.has(id)),
    });
    if (res && res.ok && res.data && res.data.url) {
      url = res.data.url;
      outcome = outcome || {
        bad: false,
        text: `Handed ${names} to the extension. On ESPN’s page a badge in the bottom-left ` +
          `corner says what it ticked — if no badge appears within half a minute, the ticking ` +
          `didn’t run and ${names} need ticking by hand.`,
      };
    } else {
      outcome = outcome || {
        bad: true,
        text: `The extension didn’t take your side (${(res && res.error) || 'no answer'}). ` +
          `ESPN will open with his players ticked; tick ${names} yourself.`,
      };
    }
  } catch (err) {
    // The plain deep link still works; say why yours is not ticked.
    outcome = outcome || {
      bad: true,
      text: `Couldn’t hand your side to the extension (${(err && err.message) || err}). ` +
        `Tick ${names} yourself on ESPN.`,
    };
  }

  showEspnOutcome(outcome);

  if (tab) {
    // Closed while staging ran is his choice, and is left alone.
    if (!tab.closed) tab.location.href = url;
    return;
  }
  // No tab at all — a blocker refused the open. Opening again here has no click
  // behind it and would be refused too, so this tab goes instead: the Trade
  // page is one Back away.
  window.location.href = url;
}

/**
 * Is the finder searching from someone else's squad? ESPN only lets you
 * propose from your own, and overrides the link to say so — so a deal found
 * from another manager's roster has no screen to open. Unknown (the connection
 * bar was never told your team) is not "someone else".
 */
const tradingForSomeoneElse = () =>
  !state.isDemo && state.espnTeamId != null && state.myTeamId !== state.espnTeamId;

function espnTradeUrl(offer) {
  const cfg = espn.getConfig();
  if (state.isDemo || !state.data || !cfg.leagueId || !offer.partner) return null;
  if (state.myTeamId === null || state.myTeamId === undefined) return null;
  if (tradingForSomeoneElse()) return null;

  const onHisRoster = new Set(
    ((state.data.teams.find((t) => t.id === offer.partner.id) || {}).players || [])
      .map((p) => p.playerId)
      .filter((id) => id !== null && id !== undefined)
  );
  const ids = offer.receive
    .map((p) => p.playerId)
    .filter((id) => onHisRoster.has(id));
  if (!ids.length) return null;

  return (
    'https://fantasy.espn.com/football/team/trade' +
    `?leagueId=${encodeURIComponent(cfg.leagueId)}` +
    `&seasonId=${encodeURIComponent(cfg.season)}` +
    `&teamId=${encodeURIComponent(offer.partner.id)}` +
    `&fromTeamId=${encodeURIComponent(state.myTeamId)}` +
    '&step=1' +
    `&players=${ids.map((id) => encodeURIComponent(id)).join(',')}`
  );
}

/**
 * The button, or the reason there isn't one.
 *
 * NO `title` ON IT, deliberately: `js/touch-titles.js` leaves controls alone —
 * a tap on a control has to work the control — so a `title` here would be
 * invisible on Tim's phone. What it needs to say goes in the panel note and on
 * its own face instead.
 */
function espnCell(offer) {
  const href = espnTradeUrl(offer);
  if (href) {
    // The label changes with what the browser can actually do. ESPN's URL can
    // only ever tick HIS side — verified against their own shipped code, which
    // matches `players=` against the counterparty's roster alone — so without
    // the extension the honest label says so. With it, the content script ticks
    // ours on the page and both sides arrive selected.
    const both = bridgeAvailable();
    return (
      `<a class="espn-open" href="${esc(href)}" target="_blank" rel="noopener"` +
      ` data-offer="${esc(offerKey(offer))}">` +
      `Open in ESPN${both ? '' : ' · his players only'}</a>`
    );
  }
  return (
    `<span class="espn-off">${
      state.isDemo
        ? 'No ESPN league in demo'
        : tradingForSomeoneElse()
          ? 'Only from your own team'
          : 'ESPN can’t be deep-linked for this offer'
    }</span>`
  );
}

/**
 * One offer, as a row. The finder's rows and the combo's rows are THE SAME
 * markup — Tim asked for the combo to "display the trades as a list just like
 * the regular trade box", and two builders producing nearly the same row is how
 * two tables that claim to be the same thing quietly stop being it.
 *
 * `key` is what identifies the row to the click handler and to focus
 * restoration: `f:3` is the finder's fourth row, `c:0` the combo's first. It is
 * a string rather than an index because the two tables share one modal.
 */
/**
 * PER WEEK FIRST, THE TOTAL UNDERNEATH. Tim, 2026-09-16: "measure everything by
 * per/week with the total as a sub-number, not the other way around."
 *
 * The engine still prices a deal as a rest-of-season total — that is what the
 * weekly measure IS, and rule 10 in HANDOFF.md — so these take the total and
 * print it divided by the span, with the total in small type. A gain divides
 * exactly: it is a sum over exactly these weeks. That is NOT true of the figure
 * beside a player, which skips his byes — see `manLine`.
 *
 * Sort keys (`data-v`) stay the totals. Every row shares one span, so dividing
 * would not change a single comparison, and the re-derivations in tr-test check
 * the engine's own totals against them.
 */
const perWeekOf = (total) => total / (weeklySpan().length || 1);

function weeklyGainHtml(total) {
  return (
    `${signedText(perWeekOf(total))}<span class="unit">/wk</span>` +
    `<span class="sub">${signedText(total)} total</span>`
  );
}

function weeklyLineupHtml(before, after) {
  return (
    `${fmt(perWeekOf(before))} → ${fmt(perWeekOf(after))}<span class="unit">/wk</span>` +
    `<span class="sub">${fmt(before)} → ${fmt(after)} total</span>`
  );
}

/** For prose: "+4.5 a week (+53.7 over weeks 2–13)". */
function weeklyPhrase(total) {
  return (
    `<strong>${signedText(perWeekOf(total))} a week</strong> ` +
    `(${signedText(total)} over ${weekRange(weeklySpan())})`
  );
}

/** "You gain a week (wk 2–13)" — per week either way; the span says which weeks. */
const GAIN_HEAD = (who, weeks, span) =>
  weeks && span.length ? `${who} a week (${weekRange(span)})` : `${who}, a week`;

function offerRow(offer, i, key) {
  const send = offer.send.map(manLine).join('');
  const receive = offer.receive.map(manLine).join('');
  const weeks = basis() === 'weeks' && weeklySpan().length > 0;
  const gain = (v) => (weeks && Number.isFinite(v) ? weeklyGainHtml(v) : signedText(v));
  const picked = state.deal && state.deal === offer ? ' picked' : '';

  const merged = offer.merged
    ? `<span class="merged-tag">${plural(offer.mergedFrom, 'deal')} as one</span>`
    : '';

  // A REAL BUTTON, not just a clickable row. The row still opens the modal on a
  // click, because a manager reading with a mouse should not have to find a
  // target — but a <tr> is not in the tab order and answers no key, so on its
  // own it would make the whole breakdown unreachable without a pointer. The
  // button is the keyboard route in AND the element focus returns to when the
  // modal closes. No `title` on it: js/touch-titles.js leaves controls alone.
  const open =
    `<button type="button" class="wk-open" data-open="${esc(key)}">Week by week</button>`;

  return (
    // `offer`, NOT `row`: app.css's `.row` is the flex control bar, and a <tr>
    // wearing it became a wrapping flex box — every offer's cells stacked
    // down the page instead of across it.
    `<tr class="offer${picked}" data-i="${i}" data-key="${esc(key)}">` +
    // The manager's name gets its own element so the merged badge beside it is
    // never read as part of it — by a test, by a sort, or by anyone.
    `<td class="name"><span class="mgr">${esc(offer.partner.name)}</span>${merged}</td>` +
    `<td class="left" data-v="${esc(offer.kind)}">` +
      `<span class="shape" title="${esc(offer.shape)} — you send ${plural(offer.send.length, 'player')}, ` +
      `you receive ${plural(offer.receive.length, 'player')}.">` +
      `${esc(SHAPE_LABEL[offer.kind])}</span>${open}</td>` +
    `<td class="left pkg">${send}</td>` +
    // NO CHURN LINE HERE. It printed two coloured lists under this column and
    // they mostly repeated the two columns either side of them; the week-by-week
    // pop-up carries the before and after now. Tim, 2026-09-17.
    `<td class="left pkg">${receive}</td>` +
    `<td class="before-after" data-v="${offer.myAfter}">` +
      (weeks && Number.isFinite(offer.myBefore) && Number.isFinite(offer.myAfter)
        ? weeklyLineupHtml(offer.myBefore, offer.myAfter)
        : `${fmt(offer.myBefore)} → ${fmt(offer.myAfter)}`) +
      `</td>` +
    `<td class="gain pos" data-v="${offer.myGain}">${gain(offer.myGain)}</td>` +
    `<td class="their-gain pos" data-v="${offer.theirGain}">${gain(offer.theirGain)}</td>` +
    `<td class="left">${espnCell(offer)}</td>` +
    `</tr>`
  );
}

const tradeRow = (offer, i) => offerRow(offer, i, `f:${i}`);

/** The offers currently on screen: the search, narrowed to the chosen manager. */
function visibleOffers() {
  if (!state.search) return [];
  if (state.partner === 'all') return state.search.offers;
  return state.search.offers.filter((o) => String(o.partner.id) === String(state.partner));
}

function renderFinder() {
  const table = $('tradeTable');
  const teams = state.data ? state.data.teams : [];
  const me = teams.find((t) => t.id === state.myTeamId);

  $('finderTitle').textContent = me
    ? `Trades that help both squads · ${me.name}`
    : 'Trades that help both squads';

  // The two gain columns are the page's most dangerous numbers, because the
  // two bases differ by a factor of nine or more and both look plausible. The
  // heading says which, every time, rather than the note alone.
  const weeks = basis() === 'weeks';
  const span = weeklySpan();
  $('thMyGain').textContent = GAIN_HEAD('You gain', weeks, span);
  $('thTheirGain').textContent = GAIN_HEAD('He gains', weeks, span);
  $('thLineup').textContent = 'Your lineup, a week';

  // Both halves are written on EVERY path, and that is not tidiness. Hiding
  // the table without emptying it left the previous search's rows sitting in
  // the document — invisible, but still the answer to a question nobody had
  // asked any more — and the same omission left "Trying every swap…" parked in
  // the hidden empty panel long after the search had finished. Neither showed
  // on screen, which is exactly why both survived until a test read the DOM
  // rather than looking at it.
  const body = bodyOf(table);
  const empty = $('tradeEmpty');

  if (state.searching) {
    state.rows = [];
    body.innerHTML = '';
    $('tradeWrap').classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = `<span class="searching">Trying every swap in the league${
      weeks ? `, in each of ${plural(span.length, 'week')} — this one takes a few seconds` : ''
    }…</span>`;
    renderFinderNote();
    return;
  }

  const offers = visibleOffers();
  state.rows = offers;
  $('tradeWrap').classList.toggle('hidden', offers.length === 0);
  empty.classList.toggle('hidden', offers.length > 0);
  body.innerHTML = offers.map(tradeRow).join('');
  empty.innerHTML = offers.length ? '' : emptyMessage();

  renderFinderNote();
  if (offers.length) resort(table);
}

/**
 * Nothing found is a real answer here, and it gets a real sentence.
 *
 * A win-win trade needs two managers whose weaknesses are opposite, and in a
 * league where everybody is roughly as deep as everybody else there may
 * genuinely not be one. That is worth saying plainly: the alternative is a page
 * that looks broken, or worse, one that relaxes its own rule until it can print
 * something.
 */
function emptyMessage() {
  const teams = state.data ? state.data.teams : [];
  if (!teams.length) return 'No roster data for this week.';
  if (!state.search) return 'Pick a team to search from.';

  const narrowed = state.kind !== 'all' || state.partner !== 'all';
  return (
    `<strong>No trade here makes both squads better.</strong> ` +
    (narrowed
      ? 'Try <em>Any shape</em> and every manager before reading much into that. '
      : 'That is a real answer rather than a gap: it needs two managers who are weak ' +
        'in opposite places, and this league may simply not have a pair. ') +
    `The depth map below shows where the league is level and where it is not.`
  );
}

function renderFinderNote() {
  const m = meta();
  const weeks = basis() === 'weeks';
  const span = weeklySpan();
  const shown = state.rows.length;
  const kindNote =
    state.kind === 'all'
      ? 'one-for-ones, two-for-ones and one-for-twos'
      : state.kind === 'even'
        ? 'one-for-one swaps only'
        : state.kind === 'consolidate'
          ? 'packages where you send two and receive one'
          : 'packages where you send one and receive two';

  // The one line in view: what is being searched, how many came back, and
  // what they are valued on.
  // Nothing when there are no rows: the empty message already says so.
  $('tradeCount').innerHTML = state.searching || !shown
    ? ''
    : `<strong>${plural(shown, 'offer')}</strong> · ` +
      `${kindNote}${state.partner === 'all' ? '' : ', with one manager'} · ` +
      `valued on ${esc(m.label)}.`;

  $('tradeNote').innerHTML =
    `<strong>How offers are found.</strong> Every offer here was found by ` +
    `<strong>re-filling both starting lineups</strong> — before the trade and after it — and ` +
    `keeping only the ones where <strong>both totals go up</strong>. There is no trade-value ` +
    `chart: a bench player is worth nothing to the manager holding him and can be worth a ` +
    `starter to somebody else, which is why a deal can help both sides at once. ` +
    `Valued on ${esc(m.label)} (${m.basis}).` +
    `<br><br>` +
    (weeks
      ? `<strong>Every figure is per week</strong>, averaged over ${weekRange(span)}, with the ` +
        `rest-of-season total in small type underneath — the per-week number is exactly that total ` +
        `divided by ${plural(span.length, 'week')}. Each lineup is filled separately ` +
        `in each week, on that week’s own projections, so a man on bye is simply replaced that week ` +
        `rather than dragging an average down. ` +
        `<strong>Only weeks still to be played are priced</strong> — ${weekRange(span)} — because a ` +
        `trade changes the rest of the season and cannot move points already banked. ` +
        `<strong>The number beside each player is what he is worth in a week he PLAYS</strong>, his ` +
        `byes left out of the average — whereas a gain is spread over every week in the span, byes ` +
        `and all — so the two are deliberately <em>not</em> the same arithmetic.`
      : `<strong>You gain</strong> and <strong>He gains</strong> are points per week added to each ` +
        `best lineup, and so is the figure beside each player.`) +
    // THE FLOOR, SAID OUT LOUD, on the page Tim said it matters most. It moves
    // every gain on screen, so a reader who cannot see where it came from
    // cannot check any of them — rule 7, and this is a page he checks by hand.
    (describeFloors(state.floors, { week: state.floorWeek })
      ? `<br><br><strong>No slot is priced below what you could stream.</strong> ` +
        describeFloors(state.floors, { week: state.floorWeek }) +
        ` That applies to BOTH squads in every offer, so a manager with a hole at one position ` +
        `is not made to look cheaper to trade with than he really is — which is exactly the ` +
        `direction an unfloored price was wrong in.`
      : '') +
    `<br><br>` +
    `<strong>Two-for-ones.</strong> A <strong>two-for-one</strong> forces the side receiving two ` +
    `to drop somebody, and that cut is modelled — his worst man goes — because it is what makes ` +
    `lopsided packages worse than they look. The side left a man short is <em>not</em> credited ` +
    `with a waiver claim to fill the gap, so those offers are understated rather than flattered.` +
    `<br><br>` +
    `<strong>Click any row</strong> — or its <strong>Week by week</strong> button — to open that ` +
    `deal week by week in a pop-up.` +
    `<br><br>` +
    `<strong>Sending it.</strong> This is analysis, not a transaction. ` +
    `<strong>Nothing is sent to ESPN</strong> — ` +
    (state.isDemo
      ? `and there is no ESPN league to open in demo, so the <em>Open in ESPN</em> links are off ` +
        `here; switch to <strong>My ESPN league</strong> for them. `
      : `<strong>Open in ESPN</strong> is a deep link and nothing more: it opens ESPN’s own trade ` +
        `screen with <strong>HIS players ticked only</strong>. There is no parameter for your own ` +
        `side, so ` +
        (bridgeAvailable()
          ? `the Fantasy Football Bridge extension ticks the men you are sending once ESPN’s ` +
            `page loads — check both sides before you press Propose. `
          : `the men you are sending have to be ticked by hand once you are there — or install ` +
            `the Fantasy Football Bridge extension, which ticks them for you. `)) +
    `Send the deal with a line saying what it fixes for him, which is the part that gets offers ` +
    `accepted. Both managers are reading the same ESPN projections, so he can check every number ` +
    `here himself.`;
}

/**
 * Run the search, off the paint.
 *
 * On a scalar measure a ten-team league is a few hundred thousand lineup fills
 * and lands around a quarter of a second. On the weekly measure it is that
 * again for every week in the span and takes a few seconds — which is exactly
 * why the "searching" state has to paint before it starts, and why the message
 * says which of the two is running. Same rAF-then-timeout shape as the season
 * simulation on the schedule page.
 */
function runSearch({ keepDeal = false } = {}) {
  const teams = state.data ? state.data.teams : [];
  // A new search invalidates the drill-down: it is holding an offer object out
  // of the PREVIOUS search, and leaving a pop-up open over a fresh table would
  // put two different answers on one page.
  //
  // `keepDeal` is the one exception: the remaining weeks have just landed, the
  // search is re-ranking on them, and the open pop-up is ALREADY priced on
  // those same weeks — so the two agree, and shutting it would throw away the
  // thing the reader clicked to see. Its row may move, so the key is dropped
  // rather than left pointing at whatever now sits in that position.
  if (keepDeal && state.deal) state.dealKey = null;
  else {
    state.deal = null;
    state.dealKey = null;
  }
  state.combo = null;
  state.comboMerged = null;
  state.comboRows = [];
  // Cancel a combo still queued behind the LAST search. It would spend a few
  // seconds re-pricing offers nobody is looking at any more and then paint them
  // over the new table. Bumping the token here rather than only inside
  // `runCombo` is what makes a re-rank — which the page now does to itself on
  // every load — cheap instead of double.
  runCombo.token++;

  if (!teams.length || state.myTeamId === null) {
    state.deal = null;
    state.search = null;
    state.searching = false;
    paint();
    return;
  }

  state.searching = true;
  state.search = null;
  paint();

  const token = ++runSearch.token;
  const kinds = state.kind === 'all' ? PACKAGE_KINDS : [state.kind];
  const weeks = basis() === 'weeks' ? weeklySpan() : null;

  const go = () => {
    if (token !== runSearch.token) return; // a newer search has started
    const result = findTrades({
      teams,
      myTeamId: state.myTeamId,
      slots: state.slots,
      measure: measureFn(),
      kinds,
      weeks,
      projFor: weeks ? projFor : null,
      zeroIsBye: zeroIsBye(),
      // THE POSITIONAL FLOOR (Tim, 2026-09-18), and this is the page he said
      // it mattered most on. A trade is priced on what each squad would field
      // EACH REMAINING WEEK, so a bye-week hole assessed at zero makes any
      // deal that papers over it look far better than it is — and makes the
      // squad that has the hole look cheaper to trade with. Null until the
      // wire read lands, which prices exactly as this page always did.
      floors: state.floors,
    });
    if (token !== runSearch.token) return;
    state.search = result;
    state.searching = false;
    // A pop-up kept open through the re-rank is holding the OLD search's offer,
    // priced on the old measure — its churn line and per-man figures would be
    // the old answer. Swap in the same deal from the new search when it is
    // still there (same manager, same men both ways).
    if (keepDeal && state.deal && !state.deal.combined) {
      const ids = (list) => list.map((p) => p.playerId).sort().join(',');
      const was = state.deal;
      const same = result.offers.find((o) =>
        o.partner && was.partner && o.partner.id === was.partner.id &&
        ids(o.send) === ids(was.send) && ids(o.receive) === ids(was.receive));
      if (same) state.deal = same;
    }
    paint();
    runCombo();
  };

  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  else setTimeout(go, 0);
}
runSearch.token = 0;

// ======================================================================
// The drill-down: one deal, week by week
// ======================================================================
//
// Tim's ask, in his words: "allow each trade to be clicked on, which pulls up
// an analysis of the trade, and shows your current and changed proj across all
// future weeks, and the difference. Make sure both the current and changed proj
// is assuming you're playing the players with the highest proj THAT WEEK."
//
// That last sentence is the whole of it, and `priceTradeAcrossWeeks` does
// exactly that: it fills the best legal lineup separately in every week, on
// that week's own projections, both before the trade and after it.
//
// A TABLE RATHER THAN A CHART, and `js/charts.js` was available. Nine to
// thirteen rows of three numbers is a small table and a cramped chart, and
// every number here is meant to be checked against ESPN by eye — a chart shows
// the shape of a season while hiding the values it is made of, which is the
// wrong trade for a panel whose job is to be verifiable. The shape is not lost:
// the difference column is signed and coloured, so a deal that is +5 on average
// and −12 in the weeks that decide the season is one glance.

/**
 * The week label in the first column — and the way INTO that week's breakdown.
 *
 * A REAL BUTTON, for the same reason the finder's rows carry one: the row it
 * sits in answers a hover and nothing else, and Tim reads this site on a phone
 * where there is no hover at all. The button is the tap target, the keyboard
 * stop, and the thing `focusin` fires on — three routes to one answer rather
 * than a hover that a thumb and a Tab key can never reach.
 *
 * NO `title` ON IT. js/touch-titles.js deliberately leaves controls alone — a
 * tap on a control has to work the control — so a `title` here would be
 * invisible on his phone. What it needs to say is in the key under the table.
 */
const weekCell = (week, tail = '') =>
  `<td class="name"><button type="button" class="wk-peek" data-wk="${week}" ` +
  `aria-expanded="false" aria-controls="dealWeek">Week ${week}${tail}</button></td>`;

function weekTableHtml(byWeek, total, { label = 'With the trade', past = [], playoff = [] } = {}) {
  // PLAYED WEEKS: above a line, in plain text, and in no total. Tim, 2026-09-16:
  // "draw a line below the previous weeks ... and turn all the numbers above it
  // white (not red or green) to show it's not in the calculation." No up/down
  // class, so no colour; the sign stays, because it is still what the trade
  // would have done that week.
  const pastRows = past
    .map(
      (w) =>
        `<tr class="past" data-wk="${w.week}">` +
        weekCell(w.week) +
        `<td>${fmt(w.before)}</td>` +
        `<td>${fmt(w.after)}</td>` +
        `<td class="delta">${signedText(w.delta)}</td>` +
        `</tr>`
    )
    .join('');
  const divider = past.length
    ? `<tr class="divider"><td colspan="4">Played — not counted. ` +
      `Only the ${plural(byWeek.length, 'week')} below are in the totals.</td></tr>`
    : '';
  const rows = byWeek
    .map(
      (w) =>
        `<tr data-wk="${w.week}">` +
        weekCell(w.week) +
        `<td>${fmt(w.before)}</td>` +
        `<td>${fmt(w.after)}</td>` +
        `<td class="delta ${w.delta > 0 ? 'up' : w.delta < 0 ? 'down' : ''}">` +
        `${signedText(w.delta)}</td>` +
        `</tr>`
    )
    .join('');

  const beforeTotal = byWeek.reduce((a, w) => a + w.before, 0);
  const afterTotal = byWeek.reduce((a, w) => a + w.after, 0);
  const n = byWeek.length || 1;

  // THE PLAYOFF WEEKS: after the totals, below a line, uncoloured — each side's
  // best lineup that week, for reference. Tim has not decided whether a trade
  // should be priced on them, so they are in no figure above.
  const poBlock = playoffTableRows(playoff);

  return (
    `<table class="weeks">` +
    `<thead><tr><th class="name">Week</th><th>As you are now</th>` +
    `<th>${esc(label)}</th><th>Difference</th></tr></thead>` +
    `<tbody>${pastRows}${divider}${rows}` +
    // Per week FIRST, the total under it — Tim's order for every figure here.
    `<tr class="total"><td class="name">Per week</td>` +
    `<td>${fmt(beforeTotal / n)}</td><td>${fmt(afterTotal / n)}</td>` +
    `<td class="delta ${total > 0 ? 'up' : total < 0 ? 'down' : ''}">${signedText(total / n)}</td></tr>` +
    `<tr class="total sub-row"><td class="name">All ${plural(byWeek.length, 'week')}` +
    `${past.length ? ' left' : ''}</td>` +
    `<td>${fmt(beforeTotal)}</td><td>${fmt(afterTotal)}</td>` +
    `<td class="delta ${total > 0 ? 'up' : total < 0 ? 'down' : ''}">${signedText(total)}</td></tr>` +
    poBlock +
    `</tbody></table>`
  );
}

/** The playoff rows and the line above them, or nothing. */
function playoffTableRows(playoff) {
  if (!playoff || !playoff.length) return '';
  const range = weekRange(playoff.map((w) => w.week));
  return (
    `<tr class="divider po-divider"><td colspan="4">Playoffs (${range}) — ` +
    `shown for reference, not in the total.</td></tr>` +
    playoff
      .map(
        (w) =>
          `<tr class="po" data-wk="${w.week}">` +
          weekCell(w.week, ' <span class="po-tag-inline">PO</span>') +
          `<td>${fmt(w.before)}</td>` +
          `<td>${fmt(w.after)}</td>` +
          `<td class="delta">${signedText(w.delta)}</td>` +
          `</tr>`
      )
      .join('')
  );
}

// ===========================================================================
// ONE DEAL, PRICED ONCE — and read three ways
// ===========================================================================
//
// The pop-up needs the same deal over three DIFFERENT spans, and they must stay
// three: the weeks still to be played (which are the totals), the played weeks
// (shown above a heavy line, in no total) and the playoff weeks (shown below
// one, priced nowhere). Each is its own `priceTradeAcrossWeeks` call so nothing
// about the second or third can leak into the first.
//
// It also needs BOTH MANAGERS' lineups, because Tim asked to be able to see the
// other side of the deal — and a squad's lineup is filled from the same weekly
// projections either way, so the partner's side is the same call with the two
// packages swapped over. `priceTradeAcrossWeeks` is symmetric by construction:
// `findTrades` already prices the counterparty exactly this way.
//
// WHAT THIS COSTS IN REQUESTS: NOTHING. Every number comes out of
// `weekly.byWeek`, which the click on the deal already bought. Flipping the
// side toggle, hovering a week, tabbing through the weeks — all of it is
// arithmetic over projections that are already in the page. The one thing it
// costs is lineup fills, so the answer is memoised per (deal, side) and thrown
// away the moment anything underneath it moves.

const dealCache = { key: null, offer: null, sets: null };

/** Whose roster, and which way round the package runs, for one side. */
/**
 * Which squad is on which side of an offer.
 *
 * `mine` is normally the reader's own team, because the finder only ever
 * trades from it. A CUSTOM trade need not involve him at all — "this can be
 * for any player with any team" — so one carries its own `mineTeamId` and
 * that wins. Without this, a custom deal between two other managers would be
 * priced against the reader's roster and quietly produce nonsense.
 */
function sideOf(offer, side) {
  const teams = state.data ? state.data.teams : [];
  const mineId = offer && offer.mineTeamId != null ? offer.mineTeamId : state.myTeamId;
  if (side === 'theirs') {
    // A whole combination has no single manager on the other side of it, so
    // there is no "their lineup" to show. That is a fact about the combination
    // rather than a failure, and the panel says so rather than guessing.
    if (!offer.partner) return null;
    const team = teams.find((t) => t.id === offer.partner.id);
    return team ? { team, send: offer.receive, receive: offer.send } : null;
  }
  const team = teams.find((t) => t.id === mineId);
  return team ? { team, send: offer.send, receive: offer.receive } : null;
}

function priceSide(offer, side, weeks) {
  const s = sideOf(offer, side);
  if (!s || !weeks.length) return null;
  return priceTradeAcrossWeeks({
    players: s.team.players,
    send: s.send,
    receive: s.receive,
    slots: state.slots,
    weeks,
    projFor,
    zeroIsBye: zeroIsBye(),
    // The same floors the finder priced with. A pop-up that priced a deal
    // differently from the row that opened it would be two answers to one
    // question, which is the defect this page has had before.
    floors: state.floors,
  });
}

/**
 * The three spans for one deal and one side, priced and kept.
 *
 * The cache key names every input: the league, how many weeks are in hand (so a
 * week landing mid-read invalidates it rather than being ignored), the selected
 * week, whose squad the finder is trading from, and the side. An identity check
 * on the offer object completes it — `runSearch` builds fresh offer objects, so
 * a re-rank cannot be served a previous search's lineups.
 */
function dealSets(offer, side) {
  const key = `${sourceKey()}|${weekly.byWeek.size}|${weekly.failed.size}|` +
    `${state.week}|${state.myTeamId}|${side}`;
  if (dealCache.key === key && dealCache.offer === offer && dealCache.sets) return dealCache.sets;

  const inHand = (ws) => ws.filter((w) => weekly.byWeek.has(w));
  const sets = {
    span: priceSide(offer, side, weeklySpan()),
    past: priceSide(offer, side, inHand(pastWeeksShown())),
    po: priceSide(offer, side, inHand(playoffWeeksShown())),
  };
  dealCache.key = key;
  dealCache.offer = offer;
  dealCache.sets = sets;
  return sets;
}

/**
 * The playoff weeks for one deal, priced the same way as the rest but on their
 * OWN, so nothing about them can reach the priced span. Only weeks in hand.
 */
function playoffPriced(me, offer) {
  if (!me) return [];
  const po = dealSets(offer, 'mine').po;
  return po ? po.byWeek : [];
}

function sideHtml(title, players) {
  return (
    `<div class="deal-side"><h3>${esc(title)}</h3>` +
    (players.length ? players.map(manLine).join('') : '<span class="muted">nobody</span>') +
    `</div>`
  );
}

function renderDeal() {
  const modal = $('dealModal');
  const offer = state.deal;
  if (!offer) {
    // EMPTIED, not merely hidden. Two panels on this page have already been
    // caught leaving a previous answer sitting invisibly in the document, and a
    // closed dialog with a week table still inside it is the same defect: it is
    // the answer to a question nobody is asking, findable by search, readable
    // by a screen reader, and impossible to see.
    modal.hidden = true;
    $('dealBody').innerHTML = '';
    $('dealNote').innerHTML = '';
    return;
  }
  modal.hidden = false;

  const me = state.data.teams.find((t) => t.id === state.myTeamId);
  $('dealTitle').textContent = offer.combined
    ? `${offer.label} · ${offer.shape}`
    // `offer.shape` is "1-for-1" and the label is now "1 for 1", so printing
    // both said the same thing twice with a middle dot between them.
    // A CUSTOM trade has no shape the finder recognises — it can be 3-for-1, or
    // one-way — so it names its own shape rather than printing `undefined` from
    // a lookup table that only knows the three the finder searches for. It also
    // says which squad is which, because a custom deal need not involve him and
    // "with Nolan" alone would not say who the other side is.
    : offer.custom
      ? `Custom trade · ${offer.shape.replace(/-/g, ' ')} with ${offer.partner.name}`
      : `${SHAPE_LABEL[offer.kind]} with ${offer.partner.name}` +
      (offer.merged ? ` · ${plural(offer.mergedFrom, 'deal')} sent as one` : '');

  const head =
    `<div class="deal-head">` +
    sideHtml('You send', offer.send) +
    sideHtml('You get', offer.receive) +
    `</div>` +
    // The offer goes with it so the line can say which of these men are HIS —
    // the displaced starter is the one fact neither column above carries.
    churnHtml(offer.yourChurn, offer);

  // The table needs every remaining week's projections, and it no longer waits
  // for the page-wide button: opening a deal buys them (see `openDeal`). Until
  // they land the pop-up says what it is reading — never a table spread from
  // one scalar across identical rows, which would be an assumption dressed as a
  // season.
  if (!weeklyReady()) {
    const span = weeklySpan();
    const why = !span.length
      ? 'Every week of the regular season has been played, so there is nothing left for a trade to change' +
        (playoffWeeksShown().length ? ' — the playoff weeks are below, for reference only.' : '.')
      : weekly.error && !weekly.loading
        ? `Couldn’t read the remaining weeks: ${esc(weekly.error)}`
        : state.isDemo
          ? `Generating ${weekRange(span)}…`
          : `Reading ${weekRange(span)} from ESPN — one request per week not already loaded…`;
    // Once the regular season is over the bracket weeks are all that is left:
    // shown (in no total — there is none) rather than nothing.
    const po = !span.length ? playoffPriced(me, offer) : [];
    $('dealBody').innerHTML = head + `<p class="empty">${why}</p>` +
      (po.length
        ? `<table class="weeks"><thead><tr><th class="name">Week</th><th>As you are now</th>` +
          `<th>${esc(offer.combined ? 'With the combination' : 'With the trade')}</th>` +
          `<th>Difference</th></tr></thead><tbody>${playoffTableRows(po)}</tbody></table>` +
          BREAKDOWN_HOST
        : '');
    $('dealNote').innerHTML = '';
    renderDealWeek();
    return;
  }

  const span = weeklySpan();
  // One pricing, kept — the week table reads its totals and the slot-by-slot
  // breakdown below reads the very lineups those totals were added up from, so
  // the two cannot come to different answers about one week.
  const priced = dealSets(offer, 'mine').span;

  const cut = priced.cut.length
    ? `<p class="deal-cut">The roster limit forces you to drop ` +
      `${priced.cut
        .map((p) => `<b>${esc(p.name)}</b>${p.position === 'DST' ? '' : ` ${esc(p.position)}`}`)
        .join(', ')}` +
      ` — a two-for-one leaves you a man over, and this is his cost.</p>`
    : '';

  const href = espnTradeUrl(offer);
  const espnBlock = href
    // `data-offer` too, or the capture handler finds nothing registered and the
    // pop-up's link never asks the extension to tick your side.
    ? `<p><a class="espn-open" href="${esc(href)}" target="_blank" rel="noopener"` +
      ` data-offer="${esc(offerKey(offer))}">` +
      `Open this trade in ESPN${bridgeAvailable() ? '' : ' · his players only'}</a><br>` +
      `<span class="espn-off">ESPN’s screen opens with <strong>${offer.receive
        .map((p) => esc(p.name))
        .join(' and ')}</strong> already ticked on his side. ` +
      (bridgeAvailable()
        ? `The extension ticks ${offer.send.map((p) => esc(p.name)).join(' and ')} on yours; ` +
          `check both sides before you press Propose. `
        : `There is no parameter for your own side, so you tick ` +
          `${offer.send.map((p) => esc(p.name)).join(' and ')} by hand once you are there. `) +
      `Nothing is sent from this site.</span></p>`
    // A whole packing has no single manager on the other side of it, so there
    // is no one screen to open — which is a fact about the combination rather
    // than a failure, and it is said as one. Each manager's own row carries his
    // own link.
    : `<p><span class="espn-off">${
        offer.combined
          ? 'A combination is several trades with several managers, so there is no one ESPN ' +
            'screen for it. Each manager’s own row above opens his.'
          : state.isDemo
            ? 'There is no ESPN league to open in demo — switch to <strong>My ESPN league</strong> ' +
              'for the deep link.'
            : tradingForSomeoneElse()
              ? 'This deal is from another manager’s squad, and ESPN only lets you propose from ' +
                'your own. Pick your team under <strong>Your team</strong> to get links.'
              : 'This offer cannot be deep-linked: none of the men you would receive is on that ' +
              'manager’s roster in the week being shown.'
      }</span></p>`;

  // The played weeks, priced the same way but SEPARATELY, so nothing about them
  // can reach `priced` — they are shown for reference and counted nowhere. Only
  // weeks actually in hand; one still loading simply appears when it lands.
  const pastSet = dealSets(offer, 'mine').past;
  const pastPriced = pastSet ? pastSet.byWeek : [];

  $('dealBody').innerHTML =
    head +
    weekTableHtml(priced.byWeek, priced.delta, {
      label: offer.combined ? 'With the combination' : 'With the trade',
      past: pastPriced,
      playoff: playoffPriced(me, offer),
    }) +
    BREAKDOWN_HOST +
    cut +
    espnBlock;

  const sumOfRows = priced.byWeek.reduce((a, w) => a + w.delta, 0);
  $('dealNote').innerHTML =
    (basis() !== 'weeks'
      ? `<strong>The list behind this is ranked on ${esc(meta().label)}</strong>, not week by week, ` +
        `so its figure for this deal will not match the total here. Choose ` +
        `<strong>Every remaining week</strong> at the top to rank the whole list this way. `
      : '') +
    `<strong>Hover, tap or Tab to a week</strong> to open that week slot by slot, before and ` +
    `after — the same lineups these totals are added up from, laid out the way the Analysis ` +
    `page lays them out, with the men you send and receive marked. Escape closes it. ` +
    `<strong>As you are now</strong> and <strong>With the trade</strong> are both your best legal ` +
    `lineup <em>in that week</em>, filled from that week’s own projections — so both sides of the ` +
    `comparison assume you start whoever is highest that week, which is what you would actually ` +
    `do. <strong>Per week</strong> is the average of the rows, ` +
    `${signedText(priced.delta / (span.length || 1))}; the rows add up to the total underneath, ` +
    `${signedText(sumOfRows)} across ${plural(span.length, 'week')}, printed as ` +
    `${signedText(priced.delta)} (they differ by at most a rounding tenth a row) — and the point of ` +
    `the table is that the average is not the story: the weeks where the difference collapses are ` +
    `byes and soft matchups you already cover, and the weeks where it opens up are the ones the ` +
    `trade is really buying. ` +
    `<strong>Only ${weekRange(span)} appear here</strong>, because those are the weeks still to be ` +
    `played; a week with a result against it is banked and no trade can reach it. ` +
    (playoffWeeksShown().length
      ? `<strong>The playoff weeks</strong> (${weekRange(playoffWeeksShown())}) are shown after the ` +
        `totals for reference and are in no figure on this page. `
      : '') +
    `The per-week number beside each player above is a different arithmetic again — it is what he ` +
    `is worth in a week he PLAYS, with his byes left out — so it does not multiply up to these ` +
    `totals, and is not meant to. ` +
    (priced.cut.length
      ? `The forced cut above is applied <strong>once</strong>, for the whole season, rather than ` +
        `re-decided every week — a manager does not get his dropped man back in week 10. `
      : '') +
    `These are the <strong>same projections</strong> the depth map is drawn from, over the same ` +
    `weeks — that table averages them and this one picks each week separately, and the gap ` +
    `between those two readings is exactly what depth is worth. So the two panels cannot ` +
    `contradict each other about a player; where they differ, it is the arithmetic differing, ` +
    `and that difference is the answer rather than a discrepancy.`;

  // The slot-by-slot panel is re-rendered rather than rebuilt with the body, so
  // that a hover can repaint it without the table under the pointer being
  // replaced mid-gesture. It reads `state.dealWeek`, so a repaint of the whole
  // page leaves the open week open.
  renderDealWeek();
}

// ===========================================================================
// ONE WEEK, SLOT BY SLOT — what the deal does to the lineup you would field
// ===========================================================================
//
// Tim's ask, in his words: "if you hover over a specific week, it shows the
// positions of each proj for that week, before and after your trade, with the
// specific players that are being traded color coded so you can see how the new
// player affected your lineup for that specific week."
//
// The week table above answers "how much"; this answers "through whom". A deal
// that is +6 in week 9 is +6 because ONE man walked into ONE slot and pushed
// ONE of yours out, and until you can see which, the column is a number you
// have to take on trust.
//
// FOUR DECISIONS, and they are the whole of the panel:
//
//   THE SLOT SHAPE IS THE LEAGUE'S OWN, and it is the SAME layout the analysis
//   page's "Season by week" uses — QB, RB1, RB2, WR1…, FLEX, D/ST, K, with each
//   man ranked inside his own slot on that week's projection. That rule lives
//   in js/lineup-slots.js and both pages import it, because "WR2" has to mean
//   the same thing on both or the two panels are quietly describing different
//   lineups. The lineups themselves are `optimalLineup`'s, reached through the
//   same `priceTradeAcrossWeeks` the week table's totals come from — not a
//   second solve, which would be a second chance to disagree.
//
//   COLOUR IS NEVER ALONE. The man arriving is marked IN, the man leaving OUT,
//   and one of your own whose place the deal changes is marked "promoted",
//   "benched" or "moved" — a word in every case, because the site's rule is
//   that a hue is the second cue and never the first (HANDOFF: the two greens
//   on the wire). A slot whose number moved is marked as changed as well, so a
//   reader can find the three rows that did something among the ten that did
//   not without comparing twenty figures by eye.
//
//   ONE SIDE AT A TIME, HIS OWN FIRST. Both lineups side by side is twenty
//   columns on a phone. The toggle is one control and it defaults to the squad
//   the finder is trading FROM, which is the question somebody came with; the
//   other manager's is one press away, and it is the same arithmetic with the
//   two packages swapped over.
//
//   IT COSTS NO REQUESTS. Every projection it reads was bought when the deal
//   was opened. See `dealSets`.

const BREAKDOWN_HOST = '<div id="dealWeek" class="wkx"></div>';

/** An offer's entries are player objects; be tolerant of a bare id anyway. */
const idKey = (p) => String(p && typeof p === 'object' ? p.playerId : p);

/**
 * One week out of whichever of the three spans holds it, with the LINEUPS.
 *
 * The played weeks and the playoff weeks get a breakdown too. They are in no
 * total and the panel says so, but "what would this deal have done in week 3"
 * is a fair question and the lineups for it are already priced.
 */
function weekSlice(offer, side, week) {
  const sets = dealSets(offer, side);
  for (const kind of ['past', 'span', 'po']) {
    const set = sets[kind];
    if (!set) continue;
    const i = set.byWeek.findIndex((w) => w.week === week);
    if (i < 0) continue;
    return { kind, row: set.byWeek[i], before: set.before.byWeek[i], after: set.after.byWeek[i] };
  }
  return null;
}

/** "Ana’s lineup" / "Your lineup" — whose squad the breakdown is showing. */
function sideLabel(offer, side) {
  if (side === 'theirs') return offer.partner ? `${offer.partner.name}’s lineup` : 'His lineup';
  return 'Your lineup';
}

/** The side toggle, or the reason there isn't one. */
function sideToggleHtml(offer) {
  if (!offer.partner) {
    return (
      `<span class="wkx-noside">A combination has several managers on the other side, so there ` +
      `is no one lineup to compare against. Each manager’s own row opens his.</span>`
    );
  }
  const btn = (side) =>
    `<button type="button" class="wkx-side${state.dealSide === side ? ' on' : ''}" ` +
    `data-side="${side}" aria-pressed="${state.dealSide === side}">` +
    `${esc(sideLabel(offer, side))}</button>`;
  return `<span class="wkx-sides" role="group" aria-label="Whose lineup">${btn('mine')}${btn('theirs')}</span>`;
}

/**
 * One man in one slot, with the mark that says what the deal did to him.
 *
 * `column` is which half of the comparison this cell is, and it decides which
 * marks are even possible: a man cannot ARRIVE in the before lineup and cannot
 * LEAVE the after one. A traded man is always marked as traded rather than as
 * displaced, even though he satisfies both tests — "OUT" is the truer sentence
 * about the man you are sending away.
 */
function slotManHtml(entry, column, ctx) {
  if (!entry || !entry.p) return `<span class="wkx-none">—</span>`;
  const p = entry.p;
  const id = idKey(p);

  let mark = null;
  if (column === 'before') {
    if (ctx.leaving.has(id)) mark = { cls: 'gone', word: 'OUT' };
    else if (!ctx.after.has(id)) mark = { cls: 'shift', word: 'benched' };
  } else {
    if (ctx.arriving.has(id)) mark = { cls: 'got', word: 'IN' };
    else if (!ctx.before.has(id)) mark = { cls: 'shift', word: 'promoted' };
    else if (ctx.before.get(id) !== ctx.after.get(id)) mark = { cls: 'shift', word: 'moved' };
  }

  const tag = mark ? `<span class="wkx-mark ${mark.cls}">${esc(mark.word)}</span>` : '';
  const inner = `<span class="wkx-name">${esc(p.name)}</span>`;
  return `${tag}${playerRef(p, inner)} <span class="wkx-v">${fmt(entry.v)}</span>`;
}

/**
 * The whole breakdown for the open week, written into its own container.
 *
 * Deliberately NOT part of `renderDeal`'s markup pass: a hover has to be able
 * to repaint this without replacing the table the pointer is sitting on.
 */
function renderDealWeek() {
  const host = $('dealWeek');
  if (!host) return;
  const offer = state.deal;
  if (!offer) { host.innerHTML = ''; return; }

  // The row the reader is on, marked on the table itself as well as here, so
  // the two halves of the panel are visibly one thing.
  const week = state.dealWeek;
  for (const btn of document.querySelectorAll('#dealBody .wk-peek')) {
    const on = String(btn.getAttribute('data-wk')) === String(week);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    const row = btn.closest ? btn.closest('tr') : null;
    if (row) row.classList.toggle('peeking', on);
  }

  if (week === null || week === undefined) {
    host.innerHTML =
      `<p class="wkx-empty">Hover a week above — or tap one, or Tab to it — to see that week’s ` +
      `starting lineup slot by slot, before the trade and after it.</p>`;
    return;
  }

  const rows = slotRows(state.slots);
  const side = offer.partner ? state.dealSide : 'mine';
  const slice = rows.length ? weekSlice(offer, side, week) : null;
  if (!slice) {
    host.innerHTML =
      `<div class="wkx-head"><h3 class="wkx-title">Week ${esc(week)}, slot by slot</h3>` +
      `${sideToggleHtml(offer)}</div>` +
      `<p class="wkx-empty">No lineup for week ${esc(week)} — that week’s projections are not in ` +
      `hand.</p>`;
    return;
  }

  const beforeFill = fillSlots(slice.before.starters, rows);
  const afterFill = fillSlots(slice.after.starters, rows);

  const s = sideOf(offer, side) || { send: [], receive: [] };
  const ctx = {
    leaving: new Set((s.send || []).map(idKey)),
    arriving: new Set((s.receive || []).map(idKey)),
    before: new Map(slice.before.starters.map((p) => [idKey(p), p.slotId])),
    after: new Map(slice.after.starters.map((p) => [idKey(p), p.slotId])),
  };

  const body = rows
    .map((row) => {
      const b = beforeFill.get(row.key);
      const a = afterFill.get(row.key);
      const bv = b ? b.v : null;
      const av = a ? a.v : null;
      const moved =
        (b ? idKey(b.p) : '') !== (a ? idKey(a.p) : '') ||
        (Number.isFinite(bv) ? bv : null) !== (Number.isFinite(av) ? av : null);
      const d = Number.isFinite(bv) && Number.isFinite(av) ? Math.round((av - bv) * 10) / 10 : null;
      return (
        `<tr class="${moved ? 'changed' : 'same'}">` +
        `<th scope="row" class="wkx-slot">${esc(row.key)}</th>` +
        `<td class="wkx-cell">${slotManHtml(b, 'before', ctx)}</td>` +
        `<td class="wkx-cell">${slotManHtml(a, 'after', ctx)}</td>` +
        `<td class="wkx-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">` +
        `${d === null ? '—' : signedText(d)}</td>` +
        `</tr>`
      );
    })
    .join('');

  // THE TOTALS ARE THE ENGINE'S OWN, not the sum of the tenths above them. The
  // rows are rounded for reading; the week table's figure is not, and these two
  // lines have to be the same number or the panel is arguing with the table it
  // is attached to.
  const foot =
    `<tr class="wkx-total">` +
    `<th scope="row" class="wkx-slot">Starting lineup</th>` +
    `<td class="wkx-cell">${fmt(slice.row.before)}</td>` +
    `<td class="wkx-cell">${fmt(slice.row.after)}</td>` +
    `<td class="wkx-d ${slice.row.delta > 0 ? 'up' : slice.row.delta < 0 ? 'down' : ''}">` +
    `${signedText(slice.row.delta)}</td>` +
    `</tr>`;

  // `scopeNote`, not `scope`: `scope` is js/prefs.js's, imported at the top of
  // this file, and shadowing it inside one function is how a later edit here
  // reaches for the preference store and gets a string.
  const scopeNote =
    slice.kind === 'past'
      ? `<p class="wkx-scope">Week ${esc(week)} has been played, so this is what the deal ` +
        `<em>would</em> have done. It is in no total.</p>`
      : slice.kind === 'po'
        ? `<p class="wkx-scope">Week ${esc(week)} is a playoff week — shown for reference, and in ` +
          `no total on this page.</p>`
        : '';

  host.innerHTML =
    `<div class="wkx-head">` +
    `<h3 class="wkx-title">Week ${esc(week)}, slot by slot — ${esc(sideLabel(offer, side))}</h3>` +
    sideToggleHtml(offer) +
    `</div>` +
    scopeNote +
    `<div class="table-scroll"><table class="wkx-table">` +
    `<thead><tr><th class="wkx-slot">Slot</th><th>As you are now</th>` +
    `<th>${esc(offer.combined ? 'With the combination' : 'With the trade')}</th>` +
    `<th>Difference</th></tr></thead>` +
    `<tbody>${body}${foot}</tbody></table></div>` +
    `<p class="wkx-key">` +
    `<span class="wkx-mark got">IN</span> the man you receive · ` +
    `<span class="wkx-mark gone">OUT</span> the man you send · ` +
    `<span class="wkx-mark shift">promoted</span> / ` +
    `<span class="wkx-mark shift">benched</span> / ` +
    `<span class="wkx-mark shift">moved</span> one of your own whose place the deal changes. ` +
    `A row whose number moved is drawn heavier; the rest are untouched that week.` +
    `</p>`;
}

/** Open one week's breakdown. Hover, tap, focus and Enter all land here. */
function setDealWeek(week) {
  const w = Number(week);
  if (!Number.isFinite(w) || state.dealWeek === w) return;
  state.dealWeek = w;
  renderDealWeek();
}

/** Which manager's lineup the breakdown shows. His own until asked otherwise. */
function setDealSide(side) {
  const want = side === 'theirs' ? 'theirs' : 'mine';
  if (state.dealSide === want) return;
  state.dealSide = want;
  renderDealWeek();
}

/**
 * Open one deal in the modal, remembering what opened it.
 *
 * `key` identifies the ROW rather than the element, and that is deliberate:
 * `paint()` rebuilds both tables' markup, so the button that was clicked is a
 * different object by the time the modal is on screen and by the time it
 * closes. Looking the key up again afterwards is what makes focus come back to
 * where it left — a dialog that dumps you at the top of the document is a
 * dialog a keyboard user has to re-navigate the whole page out of.
 */
function openDeal(offer, key) {
  if (!offer) return;
  state.deal = offer;
  state.dealKey = key || null;
  // A fresh pop-up opens with no week picked and on HIS side — the question
  // somebody came with. Carrying the last deal's week over would answer a
  // question about a different trade with a number that looks like this one's.
  state.dealWeek = null;
  state.dealSide = 'mine';
  paint();
  // The close button, because it is the one control a reader has to be able to
  // reach and the natural first stop in a dialog. Everything inside is after it
  // in the tab order, so nothing is skipped by starting here.
  focusEl($('dealClose'));
  loadWeeksForDeal(offer);
}

/**
 * Buy the remaining weeks for the pop-up, if they are not already in hand.
 *
 * Tim's ask: the pop-up should show the week-by-week numbers, not a sentence
 * telling him to press a button first. Clicking a deal IS the ask for them, so
 * the click pays. It deliberately leaves the page's measure alone and runs no
 * search — the list behind stays exactly as it was ranked, and `runSearch`
 * would shut this pop-up besides.
 */
async function loadWeeksForDeal(offer) {
  if (weekly.key !== sourceKey()) resetWeekly();
  rememberSelectedWeek();
  // The remaining weeks, which are priced, AND the played ones, which the
  // pop-up shows above a line for reference and leaves out of every total —
  // and the playoff weeks, shown after the totals and priced nowhere.
  const needed = [...pastWeeksShown(), ...weeklySpan(), ...playoffWeeksShown()];
  const wasReady = weeklyReady();
  if (weekly.loading || (!weeklySpan().length && !playoffWeeksShown().length) ||
      needed.every(haveWeek)) { paint(); return; }
  const done = await buyMissingWeeks(needed);
  if (!done) return;
  if (wasReady) { if (state.deal === offer) paint(); else renderCost(); return; }
  // The page button may have been pressed while this was reading, switching
  // the whole page to the weekly measure; its own load bailed out on seeing
  // ours in flight, so the re-rank it owes is paid here.
  if (state.measure === 'weeks') { runSearch({ keepDeal: true }); return; }
  // Otherwise repaint only if the reader is still looking at the same deal —
  // the cache is filled either way, so the next deal they open is free.
  if (state.deal === offer) paint();
  else renderCost();
}

/** Close it, and put the keyboard back where it came from. */
function closeDeal() {
  if (!state.deal) return;
  const key = state.dealKey;
  state.deal = null;
  state.dealKey = null;
  state.dealWeek = null;
  state.dealSide = 'mine';
  paint();
  if (key) focusEl(document.querySelector(`[data-open="${cssKey(key)}"]`));
}

/** Focus, when there is anything to focus and a layout to do it in. */
function focusEl(el) {
  if (!el || typeof el.focus !== 'function') return;
  try { el.focus(); } catch { /* no layout, e.g. under a test harness */ }
}

/** Our keys are `f:3` / `c:0`; the colon is legal in an attribute selector. */
const cssKey = (k) => String(k).replace(/["\\]/g, '');

// ======================================================================
// The best combo
// ======================================================================
//
// Tim's ask: "a best combo section that allows the most trades possible for that
// user, knowing that they can't trade a player twice".
//
// Two things in that sentence pull apart, and the engine returns both rather
// than picking one: `best` is the packing worth the most points, `most` is the
// packing with the most trades in it. Three trades worth +2 between them is a
// worse season than two worth +15, so the headline is the first — but he asked
// literally for the most trades possible, so when they differ the other one is
// offered underneath, in words rather than only in numbers.
//
// THE TRAP, and it is why nothing here adds anything up: a combo's gain is NOT
// the sum of its trades' gains. Every offer's gain was measured against your
// current roster, and after one trade that roster no longer exists. The engine
// prices the whole packing in one go; `naiveDelta` is what you would have
// believed if you had added them, and it is printed precisely so the gap is
// visible rather than hidden.

/**
 * The combo's offers, as a table in the finder's own shape.
 *
 * Tim's ask: "In the best combo box, it should display the trades as a list
 * just like the regular trade box, and you should be able to click on the link
 * to fantasy in the same way as well."
 *
 * So it is literally the same row builder and the same head, which is also what
 * gets the ESPN deep link and the week-by-week pop-up for nothing. `rows` are
 * the MERGED offers — one per manager — and `from` is where their keys start,
 * because the best packing and the "most trades" alternative are two tables
 * sharing one `state.comboRows` array and one modal.
 */
function comboTableHtml(rows, from, id) {
  const weeks = basis() === 'weeks';
  const span = weeklySpan();
  return (
    `<div class="table-scroll"><table id="${esc(id)}" class="offers">` +
    `<thead><tr>` +
    `<th class="name">Manager</th>` +
    `<th class="left">Deal</th>` +
    `<th class="left">You send</th>` +
    `<th class="left">You get</th>` +
    `<th>Your lineup, a week</th>` +
    `<th>${esc(GAIN_HEAD('You gain', weeks, span))}</th>` +
    `<th>${esc(GAIN_HEAD('He gains', weeks, span))}</th>` +
    `<th class="left">ESPN</th>` +
    `</tr></thead><tbody>` +
    rows.map((o, k) => offerRow(o, from + k, `c:${from + k}`)).join('') +
    `</tbody></table></div>`
  );
}

/**
 * One packing: the headline, its offers, and the way into its own breakdown.
 *
 * THE COMBINED WEEK TABLE IS BEHIND A CLICK TOO, and that is the rest of Tim's
 * fifth ask — "including the best combo". It used to be printed inline under
 * the list, which is exactly the "separate box below everything" he asked to be
 * rid of. `allIndex` is where the whole-packing pseudo-offer sits in
 * `state.comboRows`, so the button opens the same pop-up the rows do.
 */
function comboBlockHtml(entry, rows, from, id, allIndex, { heading = '', lead = '' } = {}) {
  const span = weeklySpan();
  return (
    (heading ? `<h3>${esc(heading)}</h3>` : '') +
    (lead ? `<p>${lead}</p>` : '') +
    `<div class="combo-head"><span class="big">${signedText(perWeekOf(entry.delta))}</span> a week ` +
    `<span class="sub-inline">(${signedText(entry.delta)} total over ${weekRange(span)})</span> from ` +
    `<strong>${plural(entry.count, 'trade')}</strong>` +
    (rows.length && rows.length < entry.count
      ? ` — sent as ${plural(rows.length, 'offer')}, because two of them are with one manager`
      : '') +
    (entry.count
      ? ` <button type="button" class="wk-open" data-i="${allIndex}" data-key="c:${allIndex}">` +
        `All ${plural(entry.count, 'trade')} week by week</button>`
      : '') +
    `</div>` +
    (entry.count
      ? comboTableHtml(rows, from, id)
      : `<p class="empty">Making none of them is the best answer here — every offer is worth ` +
        `less once the others are made.</p>`)
  );
}

/**
 * The whole packing as one openable "offer".
 *
 * Not a real trade and it does not pretend to be: there is no partner, because
 * there is no one manager on the other side of it, and `espnTradeUrl` returns
 * nothing for it rather than inventing a screen. Each manager's own row carries
 * his own link, which is where a deal actually gets proposed. What this is for
 * is the one number the rows deliberately do NOT add up to — the whole slate,
 * priced once, week by week.
 */
function wholeComboOffer(entry, label) {
  return {
    combined: true,
    label,
    partner: null,
    send: entry.combo.flatMap((o) => o.send),
    receive: entry.combo.flatMap((o) => o.receive),
    kind: 'even',
    shape: `${entry.count}-trade combination`,
    basis: 'weeks',
    myGain: entry.delta,
    myBefore: entry.pricing ? entry.pricing.before.total : null,
    myAfter: entry.pricing ? entry.pricing.after.total : null,
    yourChurn: entry.pricing ? entry.pricing.churn : null,
  };
}

function renderCombo() {
  const body = $('comboBody');
  const note = $('comboNote');
  const span = weeklySpan();

  // Cleared on every path that draws no table, so a click on nothing can never
  // reach a row object left over from the last answer.
  state.comboRows = [];

  if (basis() !== 'weeks') {
    // TWO DIFFERENT REASONS TO BE HERE, and they need different sentences. The
    // page prices itself now (2026-09-19), so a reader sees this either because
    // the weeks are still arriving — in which case there is nothing to press
    // and saying so would be wrong — or because he has deliberately chosen one
    // of the scalar measures, in which case the way back is the picker and not
    // the button beside it.
    //
    // The button's face comes from `weeksButton()`, NOT read back off the
    // element: this panel must not need the toolbar to have been painted first.
    body.innerHTML = weekly.loading
      ? `<p class="empty"><span class="working">Reading ${esc(weekRange(span))}` +
        (weekly.progress
          ? ` — week ${Math.min(weekly.progress.done + 1, weekly.progress.total)} of ` +
            `${weekly.progress.total}`
          : '') +
        `…</span> The best combo is priced on every remaining week, so it waits for them.</p>`
      : `<p class="empty">The best combo is only priced on <strong>every remaining week</strong>. ` +
        `Set <strong>Value on</strong> to <strong>Every remaining week</strong> at the top` +
        (weeklyReady() ? ' — the weeks are already read, so it costs nothing' : '') +
        `. The button beside it — <strong>${esc(weeksButton().label)}</strong> — ` +
        `${weeklyReady() ? 'reads them again from scratch' : 'buys the ones that are missing'}.</p>`;
    note.innerHTML =
      `Two trades cannot be added up honestly on a single number per man: both of them re-fill ` +
      `the same one lineup, so their gains overlap and adding them promises twice what arrives. ` +
      `<br><br>` +
      `Pricing a combination means applying every send and every receive together and filling ` +
      `every remaining week again — which is why this section waits for those weeks rather than ` +
      `estimating without them.`;
    $('comboExplain').hidden = false;
    return;
  }

  // No note on the two paths below, so no empty "How" toggle either.
  if (state.comboRunning) {
    body.innerHTML = '<p class="empty"><span class="searching">Trying every set of trades that ' +
      'can all be made at once…</span></p>';
    note.innerHTML = '';
    $('comboExplain').hidden = true;
    return;
  }

  const combo = state.combo;
  if (!combo || !combo.best) {
    body.innerHTML =
      `<p class="empty">Nothing to combine: the finder has no offers for this squad.</p>`;
    note.innerHTML = '';
    $('comboExplain').hidden = true;
    return;
  }
  $('comboExplain').hidden = false;

  const best = combo.best;
  const most = combo.most;

  // The merged rows, and the index space the two tables share. Computed in
  // `runCombo` rather than here so a repaint — a partner filter, a card
  // clearing — does not re-price every manager's combined side.
  //
  // The two whole-packing pseudo-offers go on the END, so adding one never
  // renumbers a row above it.
  const merged = state.comboMerged || { best: [], most: [] };
  const showAlt = !combo.mostIsBest && !!most;
  const allBestIndex = merged.best.length + merged.most.length;
  const allMostIndex = allBestIndex + 1;
  state.comboRows = merged.best.concat(
    merged.most,
    [wholeComboOffer(best, 'The best combination')],
    showAlt ? [wholeComboOffer(most, 'The most trades possible')] : []
  );

  const naive =
    `Adding the offers’ own gains would have given ${weeklyPhrase(best.naiveDelta)}. ` +
    `Together they are actually worth ${weeklyPhrase(best.delta)}` +
    (best.delta < best.naiveDelta
      ? ` — <em>less</em>, because two upgrades compete for the same lineup places and only the ` +
        `better of them can start.`
      : best.delta > best.naiveDelta
        ? ` — <em>more</em>, because the men one deal sends away are the ones another deal makes ` +
          `surplus, so the roster carries fewer passengers.`
        : `, which is a coincidence rather than a rule.`);

  body.innerHTML =
    `<div class="combo-best">${comboBlockHtml(
      best, merged.best, 0, 'comboTable', allBestIndex, { lead: naive }
    )}</div>` +
    (!showAlt
      ? ''
      : `<div class="combo-alt">` +
        comboBlockHtml(most, merged.most, merged.best.length, 'comboAltTable', allMostIndex, {
          heading: `The most trades possible: ${plural(most.count, 'trade')}`,
          lead:
            `You asked for the most trades that can all be made at once, and that is a different ` +
            `question from the most points. This packing makes ` +
            `<strong>${plural(most.count, 'trade')}</strong> instead of ` +
            `<strong>${plural(best.count, 'trade')}</strong> and is worth ` +
            `${weeklyPhrase(most.delta)} rather than ${weeklyPhrase(best.delta)}. More deals, ` +
            (most.delta < best.delta ? 'fewer points' : 'the same points or better') +
            ` — the one above is the one to make.`,
        }) +
        `</div>`);

  const partners = best.partners || [];
  note.innerHTML =
    `A player can only be traded once, so these ${plural(best.count, 'trade')} share no player ` +
    `between them — not one you send, not one you receive.` +
    `<br><br>` +
    `<strong>Never add the gains up.</strong> Each offer’s gain was measured against your roster as ` +
    `it is today; after one trade that roster no longer exists, so the combination is priced by ` +
    `applying every send and every receive <em>together</em> and re-filling every week once. ` +
    `The forced cut is applied to the combined result too — two one-for-twos leave you two men ` +
    `over the limit and cost you two players, which pricing them separately would miss. ` +
    (partners.length
      ? `Every manager involved was re-priced on his combined side as well, and a packing any of ` +
        `them would refuse is thrown out: ` +
        partners
          .map((p) => `${esc(p.partner.name)} ${signedText(perWeekOf(p.delta))}/wk`)
          .join(', ') + '. '
      : '') +
    `<br><br>` +
    (best.repeatPartners
      ? `<strong>Two of these are with the same manager, and they are shown as ONE offer.</strong> ` +
        `That is not tidying up: he would be sent one trade, he accepts or refuses it once, and the ` +
        `engine has already priced both halves as a single roster change — so splitting them into ` +
        `two rows with two gains would be showing you exactly the arithmetic this section exists to ` +
        `refuse. The merged row is <em>re-priced from scratch</em> as one move; its gain is not the ` +
        `two gains added up. Read it before you send it: a four-player trade is a different ` +
        `conversation from two two-player ones.<br><br>`
      : '') +
    `The gains in the table are each measured against your roster <em>as it is today</em>, so they ` +
    `do not add up to the headline either — only the figure at the top prices the whole slate. ` +
    (combo.exhaustive
      ? `Every combination of the ${plural(combo.offers.length, 'offer')} was tried — ` +
        `${combo.considered} of them survive the no-player-twice rule. `
      : `The search was capped at ${combo.considered} combinations, so this is the best of what ` +
        `was tried rather than provably the best of all. `) +
    `Every figure is per week over ${weekRange(span)}, with the rest-of-season total beside it; ` +
    `nothing here is sent to ESPN.` +
    // THE FLOOR, SAID HERE TOO — and until 2026-09-19 it was not applied here
    // at all. `bestCombo` took no `floors` option, so this panel priced every
    // packing WITHOUT the waiver floor while every row in the finder above was
    // priced WITH it: two different questions on one page, and a headline
    // nobody could reconcile against the table. Tim found it ("the best combo
    // gives me a single trade that is a 2-1 that has a lower +/week than the
    // top trade"). Saying it out loud is rule 7, and it is also what stops the
    // same gap reopening quietly — a note claiming a floor the engine is not
    // applying is a visible lie rather than an invisible one.
    (describeFloors(state.floors, { week: state.floorWeek })
      ? `<br><br><strong>Priced on exactly the same basis as the offers above</strong>, the ` +
        `positional floor included. ` + describeFloors(state.floors, { week: state.floorWeek }) +
        ` Both squads in every deal get it, and so does each partner’s combined side — so a ` +
        `packing can never be ranked on a different question from the rows it is built out of.`
      : '');
}

/**
 * Work out the combos, off the paint.
 *
 * Only ever the whole-league offer list, never the partner-narrowed one: the
 * question is what YOU can do this week, and a filter on the table above is
 * about reading, not about what is possible.
 */
function runCombo() {
  state.combo = null;
  state.comboMerged = null;
  state.comboRows = [];
  const me = state.data ? state.data.teams.find((t) => t.id === state.myTeamId) : null;
  if (basis() !== 'weeks' || !state.search || !state.search.offers.length || !me) {
    state.comboRunning = false;
    renderCombo();
    return;
  }

  state.comboRunning = true;
  renderCombo();

  // THE OFFER LIST IS HELD IN THE CLOSURE, not read back off state when the
  // deferred work runs. `runSearch` nulls `state.search` the moment a new
  // search starts, and this hands off through rAF then a timeout — so a search
  // that begins in that gap left `go()` reading `.offers` off null. It could
  // not happen while the only thing that re-ran the search was a button press;
  // it happens every load now that the page prices itself, because the weekly
  // re-rank arrives behind the first scalar one. The token still guards against
  // a STALE combo being painted; this guards against a stale one being
  // COMPUTED, which is a different failure and needs its own answer.
  const offers = state.search.offers;
  const token = ++runCombo.token;
  const go = () => {
    if (token !== runCombo.token) return;
    state.combo = bestCombo(offers, {
      players: me.players,
      slots: state.slots,
      weeks: weeklySpan(),
      projFor,
      // With the squads in hand every partner's COMBINED side is priced too, so
      // a packing that leaves one of them worse off — two deals that were each
      // a win-win for him but cancel each other out — is dropped rather than
      // proposed.
      teams: state.data.teams,
      requirePartnersGain: true,
      // Two disjoint deals with ONE manager are allowed. They are legal, and
      // they are genuinely one bigger deal he might take — which is now how the
      // page SHOWS them, merged into a single offer with a single re-priced
      // gain, rather than as two rows a reader would be tempted to add up.
      onePerPartner: false,
      zeroIsBye: zeroIsBye(),
      // THE SAME FLOOR THE FINDER WAS GIVEN, and leaving it out was a real
      // defect Tim found on 2026-09-19: "the best combination is actually
      // really bad and doesn't select the best combination at all ... a single
      // trade that is a 2-1 that has a lower +/week than the top trade." The
      // rows above were floored and this panel was not, so the two were ranking
      // on different questions and the combo's own number could not be
      // reconciled against the table it sat under.
      floors: state.floors,
    });

    // Merged here, once per search, and not in the renderer: each merged offer
    // costs a fresh `priceTradeAcrossWeeks` — two fills of every remaining week
    // — and a repaint happens on every card, every filter and every sort.
    const opts = {
      players: me.players,
      slots: state.slots,
      weeks: weeklySpan(),
      projFor,
      zeroIsBye: zeroIsBye(),
      // Same floor again — a merged row is a re-price of the packing's own
      // deals, so on any other basis it would print a gain the packing above it
      // does not agree with.
      floors: state.floors,
    };
    state.comboMerged = {
      best: mergeComboByPartner(state.combo.best, opts),
      most:
        state.combo.mostIsBest || !state.combo.most
          ? []
          : mergeComboByPartner(state.combo.most, opts),
    };

    state.comboRunning = false;
    paint();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  else setTimeout(go, 0);
}
runCombo.token = 0;

// -------------------------------------------------------------------- pickers

function renderTeamPicker() {
  const teams = state.data ? state.data.teams : [];
  const sel = $('teamSelect');
  const want = String(state.myTeamId ?? '');
  sel.innerHTML = teams
    .map(
      (t) =>
        `<option value="${esc(t.id)}"${String(t.id) === want ? ' selected' : ''}>` +
        `${esc(t.name)}</option>`
    )
    .join('');
  if (sel.value !== want) sel.value = want;
}

function renderPartnerPicker() {
  const teams = state.data ? state.data.teams : [];
  const sel = $('partnerSelect');
  const want = String(state.partner);
  sel.innerHTML =
    `<option value="all"${want === 'all' ? ' selected' : ''}>Any manager</option>` +
    teams
      .filter((t) => t.id !== state.myTeamId)
      .map(
        (t) =>
          `<option value="${esc(t.id)}"${String(t.id) === want ? ' selected' : ''}>` +
          `${esc(t.name)}</option>`
      )
      .join('');
  if (sel.value !== want) sel.value = want;
}

function renderWeekPicker() {
  const sel = $('weekSelect');
  sel.innerHTML = state.weeks
    .map(
      (w) =>
        `<option value="${w}"${w === state.week ? ' selected' : ''}>Week ${w}</option>`
    )
    .join('');
  if (sel.value !== String(state.week)) sel.value = String(state.week);
}

/**
 * Hold the selection across weeks when that manager is still in the league,
 * then prefer the reader's own team over whoever happens to be first.
 */
function resolveTeam() {
  const teams = state.data ? state.data.teams : [];
  // No teams is a week still LOADING, not a league without your pick in it.
  // Deciding here used to null the selection on every uncached week change —
  // the empty-state render runs before the fetch — so a squad picked by hand
  // was silently swapped back to your own the moment the week moved.
  if (!teams.length) return;
  if (teams.some((t) => t.id === state.myTeamId)) return;
  const mine = teams.find((t) => t.id === state.espnTeamId);
  state.myTeamId = mine ? mine.id : teams.length ? teams[0].id : null;
  // A partner who is no longer a partner — because he is now you — is dropped
  // rather than left selected on a filter that can match nothing.
  if (String(state.partner) === String(state.myTeamId)) state.partner = 'all';
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

function describeSource() {
  const teams = state.data ? state.data.teams.length : 0;
  const shape = state.slots ? `${state.slots.length} starters` : 'lineup shape unknown';
  if (state.isDemo) {
    return `Generated sample rosters for week ${state.week} — not your real league · ${shape}.`;
  }
  const played = state.playedWeeks.includes(state.week);
  return (
    `Week ${state.week} · ${plural(teams, 'team')} from ESPN · ${shape}` +
    (played
      ? ' · <strong>already played</strong> — the rosters as they stood that week, not today.'
      : ' · <strong>not played yet</strong> — current rosters, projections only.') +
    (state.scheduleError
      ? ` <strong style="color:var(--err)">The league schedule could not be read ` +
        `(${esc(state.scheduleError)}), so this page cannot tell which weeks are already ` +
        `played and would have to treat every week 1–${NFL_WEEKS} as still to come. ` +
        // IT DID NOT PRICE THEM, and saying so is the point: the page reads
        // itself now, and the one thing it refuses to do unasked is spend
        // eighteen requests on a span it has just admitted it cannot work out.
        // See `autoLoad`.
        `<strong>It has not priced them</strong> — that would be eighteen requests on a span ` +
        `this page cannot vouch for. Reload; the button above will read them if you want them ` +
        `anyway.</strong>`
      : '')
  );
}

async function loadWeek() {
  const key = `${state.source}:${state.week}`;
  if (cache.has(key)) {
    state.data = cache.get(key);
    rememberSelectedWeek();
    render();
    setStatus(describeSource());
    return;
  }

  state.data = null;
  render(); // show the empty state while the fetch is in flight

  // The connection bar can flip the page to live mid-fetch. A reply that no
  // longer matches what is selected is dropped rather than painted over a
  // newer one.
  const stale = () => `${state.source}:${state.week}` !== key;
  // Whether this week actually cost a request, or came out of js/store.js.
  let fromEspn = false;

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
      await fallBackToDemo(err.message);
      return;
    }
    if (stale()) return;
    state.data = loaded;
    // A season module that does not say where the week came from (an older
    // stub) is taken to have spent one — over-counting rather than hiding a
    // real request, which is the safe direction of the two.
    fromEspn = loaded.from !== 'store';
  }

  cache.set(key, state.data);
  rememberSelectedWeek();
  // THE OPENING WEEK IS COUNTED TOO, now that the page prices itself. It used
  // not to be — "the opening week is the page's, not the button's" — and that
  // distinction made sense while the button was the only thing that spent
  // anything, because it kept the button's own price honest. There is no button
  // to keep honest any more: every request on this page is the page's, and a
  // spent line that quietly left one out would be understating, which is the
  // one dishonesty this project avoids.
  //
  // AFTER `rememberSelectedWeek`, which may have reset the counters on a change
  // of league. Counted before it, this week's request would be zeroed a line
  // later and the page would report one fewer than it spent.
  if (state.source !== 'demo') {
    if (fromEspn) weekly.requests++;
    else weekly.fromStore++;
  }
  render();
  setStatus(describeSource());
}

function setToggle(id, attr, value) {
  $(id)
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
}

async function useDemo() {
  state.source = 'demo';
  state.isDemo = true;
  state.byes = {};
  // No floors in demo: the demo wire lives on the Players page, not in a
  // shared module, and js/floor.js refuses to invent one. Demo therefore
  // prices exactly as it always has.
  state.floors = null;
  state.floorWeek = null;
  state.scheduleError = null;
  state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  // The sample league's bracket weeks (14–16); demo-rosters.js projects them.
  state.poWeeks = leaguePlayoffWeeks({ weeks: state.weeks });
  state.poPlayed = [];
  // The demo season really is over: `js/demo-rosters.js` hardcodes a result
  // against every one of its thirteen games. Kept honest here, and handled
  // deliberately in `playedWeeks()` — which is the ONE place that decides the
  // sample season should be replayed from the week picker instead.
  state.playedWeeks = state.weeks.slice();
  // WEEK 1, not the last week. This page prices the REST of the season, and the
  // rest of a sample season seen from week 13 is one week — which would make
  // the weekly measure, the drill-down and the combo section look broken in the
  // only mode a reader can try without a league connected.
  if (!state.weeks.includes(state.week)) state.week = 1;
  setToggle('sourceToggle', 'src', 'demo');
  renderWeekPicker();
  await loadWeek();
  autoLoad();
}

/** Every failed route into live mode ends here, so none of them can lie. */
async function fallBackToDemo(message) {
  await useDemo();
  setStatus(message, true);
}

async function useLive() {
  const saved = savedConfig();
  if (!saved) {
    await fallBackToDemo('No league connected yet. Set one up on the Connection page first.');
    return;
  }
  if (saved.teamId != null) state.espnTeamId = Number(saved.teamId);
  // Your real league opens on YOUR team. The remembered pick may be a demo
  // squad — demo ids count from 1 just as ESPN's do, so it survives the switch
  // looking valid — and every ESPN link built from it would then stage another
  // manager's players against a trade screen that shows your own roster.
  if (state.espnTeamId != null) state.myTeamId = state.espnTeamId;

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.source = 'live';
  state.isDemo = false;
  setToggle('sourceToggle', 'src', 'live');
  cache.clear();
  resetWeekly(); // another league's weeks are another league's weeks

  setStatus('Reading the league schedule…');
  let scheduleWeeks = [];
  state.scheduleError = null;
  // The bye weeks, alongside the schedule and awaited with it: they decide
  // which zeros leave a per-week divisor, so nothing is priced before they are
  // in. A failure is an empty map — "unknown" — never an error.
  state.byes = {};
  const byesRead = typeof season.fetchByeWeeks === 'function'
    ? Promise.resolve().then(() => season.fetchByeWeeks()).catch(() => ({}))
    : Promise.resolve({});
  // Once more on failure. The schedule is what says which weeks are PLAYED, and
  // without it every played week is priced into every trade — Tim caught week 1
  // inside a total this way. A second try is cheap against that.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const schedule = await fetchSchedule();
      scheduleWeeks = schedule.weeks || [];
      state.playedWeeks = [...new Set(schedule.games.filter((g) => g.played).map((g) => g.week))]
        .sort((a, b) => a - b);
      state.poWeeks = leaguePlayoffWeeks(schedule);
      state.poPlayed = [...new Set((schedule.playoffGames || [])
        .filter((g) => g.played).map((g) => g.week))];
      state.scheduleError = null;
      break;
    } catch (err) {
      state.playedWeeks = [];
      state.poWeeks = [];
      state.poPlayed = [];
      state.scheduleError = (err && err.message) || String(err);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const byes = await byesRead;
  if (state.source !== 'live') return;   // the reader went back to demo meanwhile
  state.byes = byes && typeof byes === 'object' ? byes : {};
  weekly.means = new Map();
  state.weeks = scheduleWeeks.length
    ? scheduleWeeks
    : Array.from({ length: NFL_WEEKS }, (_, i) => i + 1);

  state.week = openingWeek();

  // THE FLOOR READ: one request, for the week the page opens on, used for
  // every week it prices. Guarded the way the bye read is — a stub or a
  // refused wire leaves `floors` null, and null prices exactly as before.
  state.floorWeek = state.week;
  const floorRead = (typeof season.fetchFloors === 'function'
    ? season.fetchFloors(state.week)
    : Promise.resolve(null))
    .then((f) => {
      if (state.source !== 'live') return;
      state.floors = f && f.size ? f : null;
    })
    .catch(() => { state.floors = null; });

  renderWeekPicker();
  await floorRead;
  await loadWeek();
  autoLoad();
}

/**
 * THE PAGE PRICES ITSELF — Tim, 2026-09-19: "make this price action an
 * automatic action with the page (it should not load if it doesn't price it)."
 *
 * Deliberately NOT awaited by its callers. `loadWeek()` has already painted a
 * usable page on the cheap measure by the time this starts, and the weeks land
 * behind it: a reader who wanted the depth map should not sit in front of an
 * empty screen for thirteen requests to get it. The cost line says what is
 * happening while it happens, and the warning above the finder says every
 * figure is on the other scale until they are all in.
 *
 * `auto: true` is the one thing that distinguishes it from the button: a reader
 * who has deliberately chosen "a typical week" keeps it, and the weeks are
 * bought anyway because the player card and the deal pop-up want them whichever
 * measure is on screen.
 */
function autoLoad() {
  // A load already in flight is a load already in flight. The connection bar
  // can flip the page live a moment after demo has started its own, and two
  // overlapping spans would double every count on the cost line.
  if (weekly.loading) return;

  // NOT WHEN THE SCHEDULE COULD NOT BE READ, and this is the one case where
  // the automatic load is refused. Without the schedule the page does not know
  // which weeks are played — `state.weeks` falls back to all eighteen and
  // `playedWeeks()` is empty — so the "span" is the whole NFL season and
  // auto-pricing it would spend eighteen unasked requests on numbers the page
  // is simultaneously telling him not to trust ("Reload before trusting a
  // trade", in `describeSource`). Spending most on the read that is least
  // likely to be right is the wrong way round. The button is still there, so
  // it is a refusal to guess rather than a feature withdrawn.
  if (!state.isDemo && state.scheduleError) { renderCost(); return; }

  loadWeekly({ auto: true });
}

/**
 * Which week a live league opens on: THE COMING ONE — the same rule as
 * `openingWeek()` in js/analysis-page.js.
 *
 * It used to be the last week PLAYED, and a saved week was honoured forever.
 * But the week picked here is also the week whose ROSTERS the page reads, and
 * the finder, the depth map and the ESPN link are all built from them — so a
 * page sitting on last week all week left out every pickup made since and
 * still offered men who had been dropped. The coming week's rosters are the
 * squads as they stand now. The priced span does not depend on this at all:
 * it is read off the schedule in `playedWeeks()`.
 *
 *   - a week picked during THIS visit, on live data, stays picked, past or not;
 *   - a saved week from an earlier visit is kept only while it is not played;
 *   - otherwise the first week with no result against it;
 *   - and a finished season opens on its last week.
 */
function openingWeek() {
  const played = new Set(state.playedWeeks);
  if (state.weekPickedLive && state.weeks.includes(state.week)) return state.week;
  const remembered = prefs.get('week', null);
  if (state.weeks.includes(remembered) && !played.has(remembered)) return remembered;
  const coming = state.weeks.find((w) => !played.has(w));
  if (coming !== undefined) return coming;
  return state.weeks[state.weeks.length - 1];
}

// --------------------------------------------------------------------- render

/**
 * Every panel, in one pass.
 *
 * ONE `clearRuns()` for the whole page, and everything that registers a card is
 * re-rendered after it. The Map behind those keys has no other way of shrinking
 * — the module cannot clear one container's worth — so a panel that repainted
 * on its own would leak a run per player per repaint, and a panel that did not
 * repaint after a clear would lose its cards silently.
 */
function paint() {
  clearRuns();
  // Same reason as clearRuns(): the offers behind the ESPN links are registered
  // by counter and the Map has no other way of shrinking, so a repaint that did
  // not clear them would grow one entry per offer for the life of the page.
  ESPN_OFFERS.clear();
  hideTip(); // it may be pointing at an element that is about to be replaced
  // IN PANEL ORDER — toolbar, finder, combo, depth map — and the modal last,
  // which is the only one not in the flow of the page.
  //
  // The order is for READING, not for correctness: each of these is a pure
  // function of `state` and the caches, and none of them leaves anything behind
  // for the next. There was exactly one exception and it is gone — the combo
  // panel used to read the weekly-measure button's label straight off the
  // element, so it silently depended on `renderCost()` having run first. Both
  // now call `weeksButton()`. Keep it that way: a panel that only works second
  // is a panel that breaks the next time somebody moves one.
  renderCost();
  renderFinder();
  renderCombo();
  renderDepth();
  renderCustom();
  renderDeal();
}


// ===========================================================================
// CUSTOM TRADES
//
// Tim, 2026-09-18: "I want to be able to pick whichever trade I want in the
// trade menu. Maybe a new box that is 'custom trades' and you can build a
// custom trade and it will be stored in the custom trade box. This can be for
// any player with any team."
//
// The finder answers "what deals exist that help us both". This answers "what
// is THIS deal worth" — the one he has in his head, or the one somebody has
// offered him — and it deliberately has no opinion about whether it is good.
// A custom trade that makes his squad worse still gets priced and still gets
// kept, because knowing a deal is bad is the whole reason to ask.
//
// THREE RULES IT SHARES WITH THE FINDER, and they are not optional:
//   - the same engine (`priceTradeAcrossWeeks`), the same weeks
//     (`weeklySpan()`), the same projections (`projFor`) and the same
//     positional floor (`state.floors`). A custom deal priced differently from
//     an identical one the finder found would be two answers to one question,
//     which is a defect this page has shipped before.
//   - his display rule: per week first, the rest-of-season total as the small
//     sub-number (`weeklyGainHtml`).
//   - played weeks are never priced; `weeklySpan()` already excludes them.
// ===========================================================================

/** The teams available to pick, in the order the rest of the page lists them. */
const customTeams = () => (state.data ? state.data.teams : []);

const teamById = (id) => customTeams().find((t) => t.id === id) || null;

/**
 * Which two squads the pickers start on.
 *
 * His own first, when the league knows which is his, because that is the deal
 * he is most often pricing — but nothing downstream assumes it, which is what
 * makes "any player with any team" true rather than nearly true.
 */
function customDefaults() {
  const teams = customTeams();
  if (!teams.length) return { a: null, b: null };
  const a = state.myTeamId !== null && teams.some((t) => t.id === state.myTeamId)
    ? state.myTeamId
    : teams[0].id;
  const b = (teams.find((t) => t.id !== a) || teams[0]).id;
  return { a, b };
}

/**
 * Keep the pickers pointing at squads that exist.
 *
 * The league changes under this panel in three ways — switching to demo,
 * connecting a real league, or moving to a week whose rosters name different
 * men — and a picker left on a team id that is no longer there renders an
 * empty list with no explanation. Reset rather than guess.
 */
function syncCustomPickers() {
  const teams = customTeams();
  if (!teams.length) { state.custom.a = null; state.custom.b = null; return; }
  const has = (id) => id !== null && teams.some((t) => t.id === id);
  if (!has(state.custom.a) || !has(state.custom.b) || state.custom.a === state.custom.b) {
    const d = customDefaults();
    state.custom.a = has(state.custom.a) ? state.custom.a : d.a;
    state.custom.b = has(state.custom.b) && state.custom.b !== state.custom.a
      ? state.custom.b
      : (teams.find((t) => t.id !== state.custom.a) || teams[0]).id;
    state.custom.sendA = [];
    state.custom.sendB = [];
  }
}

/**
 * What one man is worth beside his name in the list.
 *
 * `measureFn()` — the page's OWN measure, the same one the depth map and the
 * finder use — so the number here cannot disagree with the number the same man
 * carries three panels up. Null when the measure has nothing for him, which is
 * drawn as a dash rather than as a zero.
 */
function customValue(p) {
  const v = measureFn()(p);
  return Number.isFinite(v) ? v : null;
}

/**
 * A squad's whole roster AS A LINEUP: QB, RB1, RB2, WR1…, FLEX, D/ST, K, then
 * the bench.
 *
 * Tim, 2026-09-19: "display the two teams players like most other boxes with
 * order of positions and overall starting lineup (QB, RB1, RB2, ... BE, BE, BE,
 * etc.)". It was best-first on the page's measure, which is a perfectly good
 * order for a list of assets and the wrong one for a list of PLAYERS: a manager
 * reading his own squad reads it as a lineup, and the rest of this site already
 * does — "Season by week" on the Analysis page and this page's own deal pop-up
 * both lay a lineup out through `js/lineup-slots.js`.
 *
 * SO IT USES THAT MODULE, and does not grow a second ordering. `slotRows` says
 * what the league's slots are (read off the lineups ESPN has already accepted,
 * so a three-receiver league gets WR1/WR2/WR3 without being told), and
 * `fillSlots` hands one week's best legal lineup out to them. A manager reading
 * WR2 here and WR2 in the pop-up is reading the same claim.
 *
 * THE LINEUP IS SOLVED ON THE PAGE'S OWN MEASURE, not on the raw week. The
 * number printed beside each man is `customValue`, so solving on anything else
 * would put a list in front of him whose order its own numbers contradict —
 * under "every remaining week" the man who starts is the one with the best mean
 * over the span, and that is the number in the column.
 *
 * WHO IS ON THE BENCH IS THIS PAGE'S ANSWER, NOT ESPN'S. A squad's `BE` here is
 * "not in the best legal lineup", which is the same question every other panel
 * on the site answers, and is deliberately not ESPN's `lineupSlotId` — that
 * only says where a manager has parked somebody today.
 */
function customRoster(teamId) {
  const team = teamById(teamId);
  if (!team) return [];
  const men = (team.players || [])
    .filter((p) => p.playerId !== null && p.playerId !== undefined);
  if (!men.length) return [];

  // The pool the solver sees carries the page's measure as `projected`, which
  // is what `optimalLineup` and `fillSlots` both read. The men handed back are
  // the ORIGINALS — the copies exist only to be ranked.
  const byId = new Map(men.map((p) => [p.playerId, p]));
  const pool = men.map((p) => ({ ...p, projected: customValue(p) }));
  const rows = state.slots ? slotRows(state.slots) : [];
  const filled = rows.length ? fillSlots(optimalLineup(pool, state.slots).starters, rows) : new Map();

  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const pick = filled.get(row.key);
    if (!pick || !byId.has(pick.p.playerId)) {
      // A slot nobody can fill is still a row of the lineup, and saying so is
      // the point — a squad with no kicker has a hole, not a shorter list.
      out.push({ slot: row.key, p: null });
      continue;
    }
    seen.add(pick.p.playerId);
    out.push({ slot: row.key, p: byId.get(pick.p.playerId) });
  }
  // Then the bench, best first on the same measure — which is the order a
  // manager thinks of his own bench in, and the order the roster detail on the
  // Analysis page uses.
  const bench = men
    .filter((p) => !seen.has(p.playerId))
    .sort((a, b) => (customValue(b) ?? -Infinity) - (customValue(a) ?? -Infinity));
  for (const p of bench) out.push({ slot: 'BE', p });
  return out;
}

/**
 * One roster list. The whole row is the label, so a tap anywhere toggles him.
 *
 * EVERY ROW IS DRAWN, and the panel does not scroll (Tim: "just show all 16-17
 * positions, don't make a scrolling space so the view is limited"). An empty
 * slot draws as a row with no checkbox: there is nobody there to trade, and a
 * missing row would make the lineup look one man shorter than it is.
 */
function customList(teamId, picked, which) {
  const rows = customRoster(teamId);
  if (!rows.length) return '<div class="empty">No roster for this squad in this week.</div>';
  const on = new Set(picked.map(String));
  return rows.map(({ slot, p }) => {
    if (!p) {
      return (
        `<div class="cu-man empty-slot">` +
        `<span class="sl">${esc(slot)}</span>` +
        `<span class="nm muted">nobody</span>` +
        `<span class="pv">—</span>` +
        `</div>`
      );
    }
    const lit = on.has(String(p.playerId));
    const v = customValue(p);
    return (
      `<label class="cu-man${lit ? ' on' : ''}">` +
      `<input type="checkbox" data-side="${which}" value="${esc(p.playerId)}"${lit ? ' checked' : ''}>` +
      `<span class="sl">${esc(slot)}</span>` +
      `<span class="nm">${esc(p.name)}</span>` +
      // The position is still here and is still NOT the slot: a man in the FLEX
      // is a WR who happens to be there this week, and the two answer different
      // questions. Suppressed on a defence for the same reason as everywhere
      // else on this page — the position is in the name (see `posTag`).
      `<span class="pos">${p.position === 'DST' ? '' : esc(p.position)}</span>` +
      `<span class="pv">${v === null ? '—' : fmt(v)}</span>` +
      `</label>`
    );
  }).join('');
}

/** The roster entries behind a list of ids, in the order they were picked. */
function playersFor(teamId, ids) {
  const team = teamById(teamId);
  if (!team) return [];
  const by = new Map((team.players || []).map((p) => [String(p.playerId), p]));
  return ids.map((id) => by.get(String(id))).filter(Boolean);
}

/**
 * Price one custom trade, from A's point of view and from B's.
 *
 * Both sides go through `priceTradeAcrossWeeks`, the same call the pop-up
 * makes, so a saved row and the breakdown it opens can never disagree.
 *
 * `error` covers the case that really happens: a man on either list is no
 * longer on the squad that was going to send him, because a saved trade
 * outlives a waiver claim. It is reported rather than priced — silently
 * dropping him would quote a price for a different deal from the one on
 * screen, which is the worst of the three available answers.
 */
function priceCustom(entry) {
  const weeks = weeklySpan();
  const teamA = teamById(entry.a);
  const teamB = teamById(entry.b);
  if (!teamA || !teamB) return { error: 'One of these squads is not in the league this week.' };

  const sendA = playersFor(entry.a, entry.sendA);
  const sendB = playersFor(entry.b, entry.sendB);
  const missing = (entry.sendA.length - sendA.length) + (entry.sendB.length - sendB.length);
  if (missing > 0) {
    return {
      error: `${plural(missing, 'player')} in this trade ${missing === 1 ? 'is' : 'are'} no longer ` +
        `on the squad that was sending ${missing === 1 ? 'him' : 'them'}.`,
    };
  }
  if (!sendA.length && !sendB.length) return { error: 'Nobody is moving in this trade.' };
  if (!weeks.length) return { error: 'Every week has been played, so there is nothing left to price.' };

  const priceOne = (mine, send, receive) => priceTradeAcrossWeeks({
    players: mine.players,
    send,
    receive,
    slots: state.slots,
    weeks,
    projFor,
    zeroIsBye: zeroIsBye(),
    floors: state.floors,
  });

  const forA = priceOne(teamA, sendA, sendB);
  const forB = priceOne(teamB, sendB, sendA);
  return { weeks, teamA, teamB, sendA, sendB, forA, forB };
}

/**
 * A custom trade, in the shape the pop-up already understands.
 *
 * Reusing that shape is the point: the per-week breakdown, the slot-by-slot
 * before-and-after and the side toggle are all real work that already exists,
 * and a second way of drawing the same deal is how two drift apart.
 * `mineTeamId` is the one field the finder's offers do not carry — see
 * `sideOf`, which needs it because a custom trade need not involve him.
 */
function customOffer(entry, priced) {
  return {
    custom: true,
    mineTeamId: entry.a,
    partner: priced.teamB,
    send: priced.sendA,
    receive: priced.sendB,
    kind: 'custom',
    shape: `${priced.sendA.length}-for-${priced.sendB.length}`,
    basis: 'weeks',
    weeks: priced.weeks.slice(),
    myGain: priced.forA.delta,
    theirGain: priced.forB.delta,
    myBefore: priced.forA.before.total,
    myAfter: priced.forA.after.total,
    theirBefore: priced.forB.before.total,
    theirAfter: priced.forB.after.total,
    byWeek: priced.forA.byWeek,
  };
}

/** "Ash Ardent + Bryce Cranmore" — or "nobody", which is a legal half of a trade. */
const customNames = (men) =>
  men.length ? men.map((p) => esc(p.name)).join(' + ') : '<span class="muted">nobody</span>';

function renderCustomPickers() {
  const teams = customTeams();
  const opts = (selected) => teams
    .map((t) => `<option value="${t.id}"${t.id === selected ? ' selected' : ''}>${esc(t.name)}</option>`)
    .join('');
  $('cuTeamA').innerHTML = opts(state.custom.a);
  $('cuTeamB').innerHTML = opts(state.custom.b);

  const a = teamById(state.custom.a);
  const b = teamById(state.custom.b);
  $('cuHeadA').textContent = a ? `${a.name} sends` : 'Sends';
  $('cuHeadB').textContent = b ? `${b.name} sends` : 'Sends';
  $('cuListA').innerHTML = customList(state.custom.a, state.custom.sendA, 'a');
  $('cuListB').innerHTML = customList(state.custom.b, state.custom.sendB, 'b');
}

/**
 * What a side gains, BIG, under that side.
 *
 * Tim, 2026-09-19: "just show the single # a week (over weeks 2-14) big and
 * colorized in green or red under their side of the trade (right now they're
 * both under the first players trade)."
 *
 * He is describing a layout bug and he is right about it. The preview was one
 * `<p>` holding both figures, sitting below a two-column row — so on a laptop
 * the whole sentence lined up under the LEFT column and read as though both
 * numbers belonged to that squad. It was never wrong, and it was never
 * readable. Each figure now lives inside its own `.cu-side`, under the roster
 * it is about, so the column says whose it is and the words do not have to.
 *
 * HIS DISPLAY RULE, UNCHANGED (rule 10 in HANDOFF.md): per week first, the
 * rest-of-season total as the small sub-number. The weekly gains this engine
 * produces are season totals and are roughly nine times a per-week figure —
 * printing one as the other is the factor-of-nine error this whole file's
 * header is about.
 *
 * COLOUR IS NEVER THE ONLY CUE. The sign is always printed, which is the same
 * rule the depth map's tints and the Players page's two greens follow, and it
 * is what keeps the number readable to anyone who cannot separate the hues.
 */
function customGainHtml(delta) {
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return (
    `<span class="cu-num ${cls}">${signedText(perWeekOf(delta))}<span class="unit">/wk</span></span>` +
    `<span class="cu-sub">${signedText(delta)} over ${esc(weekRange(weeklySpan()))}</span>`
  );
}

/** Nothing to show under a side yet — reserved, so the panel cannot jump. */
const CU_BLANK = '<span class="cu-num flat">—</span><span class="cu-sub">no deal yet</span>';

function renderCustomPreview() {
  const el = $('cuPreview');
  const { sendA, sendB } = state.custom;
  const blank = () => {
    $('cuGainA').innerHTML = CU_BLANK;
    $('cuGainB').innerHTML = CU_BLANK;
    $('cuSave').disabled = true;
    $('cuOpen').disabled = true;
  };

  if (!sendA.length && !sendB.length) {
    el.innerHTML = '<span class="muted">Tick who moves on each side to price the deal.</span>';
    blank();
    return;
  }
  const priced = priceCustom(state.custom);
  if (priced.error) {
    el.innerHTML = `<span class="muted">${esc(priced.error)}</span>`;
    blank();
    return;
  }
  $('cuSave').disabled = false;
  $('cuOpen').disabled = false;
  $('cuGainA').innerHTML = customGainHtml(priced.forA.delta);
  $('cuGainB').innerHTML = customGainHtml(priced.forB.delta);
  // The sentence above them is now about the DEAL rather than about the
  // numbers: who moves which way, which the two columns cannot say between
  // them. The figures are under their own squads and do not need naming twice.
  el.innerHTML =
    `<strong>${esc(priced.teamA.name)}</strong> sends ${customNames(priced.sendA)} · ` +
    `<strong>${esc(priced.teamB.name)}</strong> sends ${customNames(priced.sendB)} · ` +
    `priced over ${esc(weekRange(priced.weeks))}`;
}

function renderCustomSaved() {
  const rows = state.customSaved;
  $('cuWrap').hidden = rows.length === 0;
  $('cuEmpty').classList.toggle('hidden', rows.length > 0);

  $('cuRows').innerHTML = rows.map((entry, i) => {
    const priced = priceCustom(entry);
    const a = teamById(entry.a);
    const b = teamById(entry.b);
    const who = `${esc(a ? a.name : 'A squad')} ⇄ ${esc(b ? b.name : 'a squad')}`;
    if (priced.error) {
      return (
        `<tr data-cu="${i}">` +
        `<td class="name">${who}<span class="sub">${esc(priced.error)}</span></td>` +
        `<td class="gain">—</td><td class="gain">—</td>` +
        `<td><button type="button" class="cu-drop" data-drop="${i}">Remove</button></td>` +
        `</tr>`
      );
    }
    return (
      `<tr data-cu="${i}" class="clickable">` +
      `<td class="name">${who}` +
        `<span class="sub">${customNames(priced.sendA)} → ${esc(b ? b.name : '')} · ` +
        `${customNames(priced.sendB)} → ${esc(a ? a.name : '')}</span></td>` +
      `<td class="gain">${weeklyGainHtml(priced.forA.delta)}</td>` +
      `<td class="gain">${weeklyGainHtml(priced.forB.delta)}</td>` +
      `<td><button type="button" class="cu-drop" data-drop="${i}">Remove</button></td>` +
      `</tr>`
    );
  }).join('');
}

function renderCustomNote() {
  const span = weeklySpan();
  $('cuNote').innerHTML =
    `<strong>Priced exactly as the finder prices its own offers.</strong> Both lineups are ` +
    `re-filled week by week over ${span.length ? weekRange(span) : 'the weeks still to play'}, on ` +
    `ESPN&rsquo;s own per-player projection for each of those weeks, and the difference is the gain. ` +
    `Weeks already played are never priced &mdash; a trade cannot move points that are banked.` +
    `<br><br>` +
    `<strong>This box has no opinion about whether a deal is good.</strong> The finder above only ` +
    `shows trades where BOTH squads improve; this prices whatever you build, including a deal that ` +
    `makes your squad worse &mdash; which is exactly the answer you want when somebody has offered ` +
    `you one.` +
    `<br><br>` +
    `<strong>Any two squads, not just yours.</strong> A trade between two other managers is priced ` +
    `the same way, which is how you tell whether a deal you have been shown helps the other side ` +
    `more than it helps you.` +
    `<br><br>` +
    `<strong>Both squads are laid out as a lineup</strong> — QB, RB1, RB2, WR1… then the bench — ` +
    `using the same slot rules the Analysis page&rsquo;s season sheet and this page&rsquo;s own deal ` +
    `pop-up use, so WR2 means the same thing in all three. The slot is this page&rsquo;s answer, not ` +
    `ESPN&rsquo;s: a man is on the bench here when he is not in the best legal lineup, whatever ` +
    `ESPN&rsquo;s roster says he is parked as today. A slot nobody can fill is still a row, because ` +
    `an empty slot is what a hole looks like.` +
    `<br><br>` +
    `<strong>Week by week</strong> opens the deal in the same pop-up a found trade opens &mdash; the ` +
    `per-week breakdown, the slot-by-slot before and after, and the side toggle &mdash; before it is ` +
    `saved as well as after.` +
    `<br><br>` +
    `Only the players and the squads are saved, never the price: one kept from last week would be ` +
    `wrong by this week&rsquo;s projections, so every saved trade is re-priced from the current data ` +
    `each time this page draws. A saved trade whose player has since changed squads says so rather ` +
    `than quietly pricing a different deal.` +
    (describeFloors(state.floors, { week: state.floorWeek })
      ? `<br><br><strong>The same positional floor applies.</strong> ` +
        describeFloors(state.floors, { week: state.floorWeek })
      : '');
}

function renderCustom() {
  syncCustomPickers();
  renderCustomPickers();
  renderCustomPreview();
  renderCustomSaved();
  renderCustomNote();
}

/** Saved trades outlive a reload; the price never does. */
function saveCustomTrades() {
  prefs.set('custom', state.customSaved);
}

function loadCustomTrades() {
  const raw = prefs.get('custom', []);
  if (!Array.isArray(raw)) return [];
  // Sanitised on the way in. This is localStorage, so it can hold whatever a
  // previous version — or a hand-edited browser — put there, and one malformed
  // entry must not take the whole panel down with it.
  return raw
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      a: Number(e.a),
      b: Number(e.b),
      sendA: Array.isArray(e.sendA) ? e.sendA.map(String) : [],
      sendB: Array.isArray(e.sendB) ? e.sendB.map(String) : [],
    }))
    .filter((e) => Number.isFinite(e.a) && Number.isFinite(e.b) && e.a !== e.b &&
      (e.sendA.length > 0 || e.sendB.length > 0));
}

function render() {
  $('modeBadge').className = 'badge ' + (state.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = state.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = state.isDemo
    ? 'Generated sample rosters so you can see the layout with a full league in it.'
    : `Your ESPN league · ${espn.getConfig().season} season`;

  // ESPN will not accept an illegal lineup, so the non-bench slots in use ARE
  // the league's configuration — no extra request, and no hand-written default
  // that would understate every squad by a starter if it guessed wrong.
  const teams = state.data ? state.data.teams : [];
  state.slots = slotsForLeague(teams.length ? slotCountsFromLineups(teams) : null);

  resolveTeam();
  renderTeamPicker();
  renderPartnerPicker();
  paint();
  runSearch();
}

/** Both panels are the same payload read two ways, so a control is a repaint. */
function repaint() {
  paint();
  runSearch();
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  // Only a deliberate click is remembered. If the code picked the source, the
  // reader has expressed no preference and shouldn't be pinned to the result.
  prefs.set('source', btn.dataset.src);
  setToggle('sourceToggle', 'src', btn.dataset.src);
  btn.dataset.src === 'demo' ? useDemo() : useLive();
});

$('kindToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-kind]');
  if (!btn || btn.dataset.kind === state.kind) return;
  state.kind = btn.dataset.kind;
  prefs.set('kind', state.kind);
  setToggle('kindToggle', 'kind', state.kind);
  // The shape is a SEARCH option, not a filter over the results: the finder
  // keeps one offer per man you could acquire, so a straight swap and a
  // two-for-one bringing in the same player compete for the same row and the
  // package with a spare body attached usually wins it. Filtering afterwards
  // would hand back the leftovers of a search that preferred something else.
  runSearch();
});

$('weekSelect').addEventListener('change', (e) => {
  state.week = Number(e.target.value);
  prefs.set('week', state.week);
  // A demo pick is a replay point in a sample season, not a live week, so it
  // does not pin the live league when the reader switches over.
  state.weekPickedLive = state.source === 'live';
  // The span moves with the week, so the memoised means are about a span that
  // no longer exists. The WEEKS themselves are kept — they cost requests, and a
  // week already bought is still that week's projections.
  weekly.means = new Map();
  loadWeek();
});

$('teamSelect').addEventListener('change', (e) => {
  state.myTeamId = Number(e.target.value);
  prefs.set('team', state.myTeamId);
  if (String(state.partner) === String(state.myTeamId)) state.partner = 'all';
  renderPartnerPicker();
  repaint(); // the depth map highlights your row; the finder searches from it
});

$('partnerSelect').addEventListener('change', (e) => {
  state.partner = e.target.value;
  // The only control on the page that is a true filter: narrowing to one
  // manager can never surface an offer the whole-league search did not find,
  // because every offer already belongs to exactly one partner. The combo
  // section deliberately ignores it — that question is about your whole slate.
  // The pop-up shuts: the row it was opened from may not be in the table any
  // more, and a dialog about a deal that is no longer listed is a loose end.
  state.deal = null;
  state.dealKey = null;
  paint();
});

$('measureSelect').addEventListener('change', (e) => {
  const want = MEASURES[e.target.value] ? e.target.value : 'typical';
  state.measure = want;
  prefs.set('measure', state.measure);
  weekly.means = new Map();
  // Choosing the weekly measure does NOT buy the weeks — the button above is
  // the only thing that spends. Until it is pressed the page falls back to the
  // typical week and the cost note says so; either way the finder is re-run,
  // because a repaint alone would relabel offers priced on the old measure
  // rather than recompute them.
  repaint();
});

// The button is a RE-READ now, not a purchase — see `weeksButton()`. `fresh`
// is what makes it one: it throws this browser's stored weeks away first, so a
// press that came back with the same numbers means the numbers really are what
// ESPN is publishing rather than what this browser happened to be holding.
$('loadWeeks').addEventListener('click', () => {
  loadWeekly({ fresh: weeksButton().act === 'fresh' });
});

/**
 * A click on an offer row — in either table — opens that deal in the modal.
 *
 * Registered BEFORE wireTips, so it has already run by the time the card's own
 * handler could stop anything — and it asks `clickIsPlayer` the same question
 * the card asks, so the two can never come to different answers about one
 * click. A link is left alone entirely: the player link has to navigate and the
 * ESPN link has to open.
 *
 * `stopPropagation` is NOT optional here. The document-level handler below
 * closes the modal on a click outside it, and without this the very click that
 * opened it would reach that handler a moment later and shut it again — the
 * same trap `js/player-card.js` documents for its sheet.
 */
function wireOfferClicks(el, rowsFor) {
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (clickIsPlayer(e)) return;
    if (e.target.closest && e.target.closest('a')) return;
    // A row carries both attributes, and so does the combo's headline button —
    // which is not in a row at all, because the whole packing is not one of the
    // offers. One selector covers both rather than two handlers that could come
    // to different answers about one click.
    const host = e.target.closest ? e.target.closest('[data-i][data-key]') : null;
    if (!host) return;
    const offer = rowsFor()[Number(host.getAttribute('data-i'))];
    if (!offer) return;
    e.stopPropagation();
    openDeal(offer, host.getAttribute('data-key'));
  });
}

wireOfferClicks($('tradeTable'), () => state.rows);
// Delegated on the PANEL, not the table: the combo's tables are rebuilt from
// scratch on every repaint and there are two of them.
wireOfferClicks($('comboPanel'), () => state.comboRows);

// -------------------------------------------------- dismissing the modal
//
// Three ways, because a pop-up that can only be closed one way is a pop-up
// somebody gets stuck under — the same rule the player card's sheet follows,
// and the same three: its own button, Escape, and a click outside it.

$('dealClose').addEventListener('click', () => { closeDeal(); });

// ------------------------------------------ one week's lineup, three ways in
//
// HOVER, TAP AND FOCUS ALL LAND ON THE SAME FUNCTION, which is the whole of
// HANDOFF's rule that nothing may be reachable only by hovering. Tim reads this
// site on a phone, where `mouseover` never fires at all; a Tab key never fires
// it either. So:
//
//   `mouseover`  a mouse resting on a week row
//   `click`      a thumb on the week button — and a mouse click, which simply
//                agrees with the hover that already happened
//   `focusin`    the keyboard, arriving on the same button by Tab
//
// All three OPEN rather than toggle, deliberately. A toggle would fight itself
// on a touch screen, where a tap fires a synthetic `mouseover` first and the
// click would immediately undo it — the panel would flash and vanish under the
// thumb. Escape is the way back out, which is the gesture a pop-up already
// teaches, and it is handled below.
//
// Delegated on the PANEL because `#dealBody` is rebuilt on every repaint, and a
// handler bound to the table inside it would be thrown away with the table.
const dealPanel = $('dealPanel');

function weekTargetOf(e) {
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return null;
  const host = t.closest('[data-wk]');
  return host ? host.getAttribute('data-wk') : null;
}

dealPanel.addEventListener('mouseover', (e) => {
  const wk = weekTargetOf(e);
  if (wk !== null) setDealWeek(wk);
});

dealPanel.addEventListener('focusin', (e) => {
  const wk = weekTargetOf(e);
  if (wk !== null) setDealWeek(wk);
});

dealPanel.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  // The side toggle first: it sits inside the breakdown, which sits inside the
  // panel, so a week test would never reach it — but nor must a press on it be
  // read as a week.
  const sideBtn = t.closest('[data-side]');
  if (sideBtn) {
    e.stopPropagation();
    setDealSide(sideBtn.getAttribute('data-side'));
    return;
  }
  // A player link inside the breakdown has to navigate, exactly as it does in
  // every other table on this site.
  if (t.closest('a')) return;
  const wk = weekTargetOf(e);
  if (wk === null) return;
  e.stopPropagation();
  setDealWeek(wk);
});

$('espnOutcomeClose').addEventListener('click', (e) => {
  // Not an outside click as far as the pop-up is concerned.
  e.stopPropagation();
  $('espnOutcome').hidden = true;
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !state.deal) return;
  // The player card is drawn OVER this modal and has an Escape handler of its
  // own. When it is open that press belongs to it — closing the thing behind
  // the thing you are reading is not what anybody meant by Escape. The card is
  // a <body> child with a known id, which is why this can be asked at all.
  const card = document.getElementById('tipCard');
  if (card && !card.hidden) return;
  // ESCAPE CLOSES THE INNERMOST THING FIRST, which is the only reading of it
  // that does not lose somebody their place: the week breakdown is open inside
  // the pop-up, so the first press shuts that and the second shuts the pop-up.
  // Closing the frame out from under the thing being read is exactly what the
  // player-card check above exists to prevent, one layer up.
  if (state.dealWeek !== null) {
    state.dealWeek = null;
    renderDealWeek();
    return;
  }
  closeDeal();
});

document.addEventListener('click', (e) => {
  if (!state.deal) return;
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  // Inside the card itself is not "outside": the modal is the frame, the card
  // is the thing. And the player card sits outside the modal in the DOM while
  // being visually on top of it, so a click on one of its buttons would
  // otherwise read as a click on the page behind.
  if (t.closest('.modal-card') || t.closest('#tipCard')) return;
  closeDeal();
});

/**
 * A plain left-click on an ESPN link stages the owner's side first.
 *
 * Every MODIFIED click is left entirely alone — ctrl/cmd/shift/alt/middle — so
 * open-in-new-tab and copy-link keep working and land on the plain deep link,
 * which is still a perfectly good link. It is a real `<a href>` for exactly
 * that reason, and this only intercepts the one gesture it can improve.
 *
 * Registered in the capture phase so it runs before the outside-click handler
 * above closes the modal out from under a link that lives inside it.
 */
document.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
  const link = e.target && e.target.closest ? e.target.closest('a.espn-open') : null;
  if (!link) return;

  const offer = ESPN_OFFERS.get(link.dataset.offer || '');
  const href = link.getAttribute('href');
  if (!offer || !href) return;   // nothing registered: let the plain link go

  e.preventDefault();
  openInEspn(offer, href);
}, true);

enableSort($('depthTable'));
enableSort($('tradeTable'));

// Every container that names a player gets the card. One call each, delegated,
// so rebuilding the markup inside them costs nothing.
wireTips($('depthTable'));
wireTips($('spareStrip'));
wireTips($('tradeTable'));
wireTips($('dealPanel'));
wireTips($('comboPanel'));

// ------------------------------------------------------------------- start up

const boot = savedConfig();
if (boot && boot.teamId != null) state.espnTeamId = Number(boot.teamId);

const rememberedTeam = prefs.get('team', null);
if (rememberedTeam !== null) state.myTeamId = rememberedTeam;

const rememberedWeek = prefs.get('week', null);
if (rememberedWeek !== null) state.week = rememberedWeek;

// A DELIBERATE CHOICE STILL WINS. The default is now "every remaining week"
// (the page buys it either way), but somebody who picked one of the two scalar
// measures picked it, and a page that overrode that would be answering a
// question he had already answered. The weeks are still bought — the card and
// the pop-up want them whichever measure is drawn — so the choice costs him
// nothing either way.
const rememberedMeasure = prefs.get('measure', null);
if (MEASURES[rememberedMeasure]) state.measure = rememberedMeasure;
$('measureSelect').value = state.measure;


// ---- custom trades: the controls ----------------------------------------
//
// Delegated on the panel rather than bound per row, because both roster lists
// are rebuilt from scratch on every render and per-row handlers would be
// re-bound sixteen times a repaint.

$('cuTeamA').addEventListener('change', (e) => {
  const id = Number(e.target.value);
  if (!Number.isFinite(id)) return;
  // Picking the squad that is already on the other side SWAPS them, rather
  // than refusing: "trade Nolan with Bree" and "trade Bree with Nolan" are the
  // same thought, and a picker that silently refused one of them would look
  // broken. The ticks go with their men.
  if (id === state.custom.b) {
    state.custom.b = state.custom.a;
    const held = state.custom.sendA;
    state.custom.sendA = state.custom.sendB;
    state.custom.sendB = held;
  } else {
    state.custom.sendA = [];
  }
  state.custom.a = id;
  renderCustom();
});

$('cuTeamB').addEventListener('change', (e) => {
  const id = Number(e.target.value);
  if (!Number.isFinite(id)) return;
  if (id === state.custom.a) {
    state.custom.a = state.custom.b;
    const held = state.custom.sendB;
    state.custom.sendB = state.custom.sendA;
    state.custom.sendA = held;
  } else {
    state.custom.sendB = [];
  }
  state.custom.b = id;
  renderCustom();
});

for (const listId of ['cuListA', 'cuListB']) {
  $(listId).addEventListener('change', (e) => {
    const box = e.target.closest ? e.target.closest('input[type="checkbox"]') : null;
    if (!box) return;
    const side = box.getAttribute('data-side') === 'b' ? 'sendB' : 'sendA';
    const id = String(box.value);
    const held = state.custom[side].filter((x) => String(x) !== id);
    state.custom[side] = box.checked ? held.concat(id) : held;
    // THE LISTS ARE STILL NOT REBUILT HERE, only the price — but the reason has
    // changed and the old one is gone. It used to be the scroll position: the
    // roster was a capped scroller, and redrawing it would have thrown that
    // away under the very finger that just ticked somebody in it. The scroller
    // went on 2026-09-19 (Tim: "don't make a scrolling space"), so that reason
    // went with it.
    //
    // What is left is FOCUS, and it is a better reason than the first one.
    // Rebuilding the list replaces the checkbox that was just operated, which
    // sends the keyboard back to the top of the document mid-deal — and it
    // would reorder nothing, since the lineup order is a fact about the
    // projections and not about who is ticked. So there is nothing to gain and
    // a tab position to lose.
    const row = box.closest('.cu-man');
    if (row) row.classList.toggle('on', box.checked);
    renderCustomPreview();
  });
}

$('cuSave').addEventListener('click', () => {
  const priced = priceCustom(state.custom);
  if (priced.error) return;
  const entry = {
    a: state.custom.a,
    b: state.custom.b,
    sendA: state.custom.sendA.map(String),
    sendB: state.custom.sendB.map(String),
  };
  // The same deal twice is one deal. Saving it again would be two identical
  // rows priced identically, which reads as a bug rather than as a list.
  const key = (x) => `${x.a}|${x.b}|${x.sendA.slice().sort().join(',')}|${x.sendB.slice().sort().join(',')}`;
  if (!state.customSaved.some((x) => key(x) === key(entry))) {
    // Newest first: the one just built is the one being looked at.
    state.customSaved = [entry].concat(state.customSaved);
    saveCustomTrades();
  }
  // The pickers keep their squads and lose their ticks, so building a second
  // deal between the same two managers is a couple of taps rather than a
  // reset.
  state.custom.sendA = [];
  state.custom.sendB = [];
  renderCustom();
});

$('cuClear').addEventListener('click', () => {
  state.custom.sendA = [];
  state.custom.sendB = [];
  renderCustom();
});

/**
 * The deal being BUILT opens the same pop-up a found trade does.
 *
 * Tim, 2026-09-19: "allow a trade analysis (identical to the box-pop up that
 * appears when you click on a pre-made trade) for this custom trade just like
 * any other trade that we have."
 *
 * Worth being exact about what was and was not there, because PROGRESS.md said
 * this already worked: a SAVED row has opened the finder's own pop-up since
 * 2026-09-18 and still does. The BUILDER never could — there was no way to look
 * at a deal week by week without committing it to the list first, which is the
 * wrong way round: the week-by-week breakdown is how you decide whether a deal
 * is worth keeping at all.
 *
 * `customOffer` was already the shape the pop-up understands, so this needed no
 * second rendering path — only a control. `stopPropagation` for the same reason
 * the finder's rows do it: the document-level handler treats anything outside
 * the modal card as an outside click, so without it the press that opened the
 * pop-up would reach that handler a moment later and shut it again.
 */
$('cuOpen').addEventListener('click', (e) => {
  const priced = priceCustom(state.custom);
  if (priced.error) return;
  e.stopPropagation();
  openDeal(customOffer(state.custom, priced), 'cu-build');
});

$('cuRows').addEventListener('click', (e) => {
  const drop = e.target.closest ? e.target.closest('button[data-drop]') : null;
  if (drop) {
    const i = Number(drop.getAttribute('data-drop'));
    if (Number.isFinite(i)) {
      state.customSaved = state.customSaved.filter((_, n) => n !== i);
      saveCustomTrades();
      renderCustom();
    }
    return;
  }
  // A saved row opens the SAME pop-up the finder's rows open — the per-week
  // breakdown, the slot-by-slot before and after, the side toggle. All of it
  // already exists and none of it needed to know a custom trade is custom.
  const tr = e.target.closest ? e.target.closest('tr[data-cu]') : null;
  if (!tr) return;
  const i = Number(tr.getAttribute('data-cu'));
  const entry = state.customSaved[i];
  if (!entry) return;
  const priced = priceCustom(entry);
  if (priced.error) return;
  // STOP THE CLICK HERE, exactly as the finder's rows do. A click that reaches
  // the document is "outside the modal" to the handler that closes it, so
  // without this the pop-up opened and the very same click shut it again — it
  // looked like a row that did nothing at all.
  e.stopPropagation();
  openDeal(customOffer(entry, priced), `cu-${i}`);
});

const rememberedKind = prefs.get('kind', null);
if (rememberedKind === 'all' || PACKAGE_KINDS.includes(rememberedKind)) {
  state.kind = rememberedKind;
}
setToggle('kindToggle', 'kind', state.kind);

// The saved custom trades, read before the first render so the box is never
// briefly empty on a reload. Only identities are stored, so this is cheap and
// nothing in it can be stale — every row is re-priced when it is drawn.
state.customSaved = loadCustomTrades();

if (prefs.get('source') === 'live' && boot) useLive();
else useDemo();

// Go live on its own once the bar finishes its round trip. Only someone who has
// clicked "Demo data" on purpose is left where they are.
onConnection((conn) => {
  if (!conn) return;
  if (conn.teamId != null) state.espnTeamId = Number(conn.teamId);
  if (state.source !== 'live' && prefs.get('source') !== 'demo') useLive();
});
