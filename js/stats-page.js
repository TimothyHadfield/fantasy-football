// Wires the stats page together: pick a data source, compute, render.
//
// Everything here was built and checked against a finished 2025 season, where
// every panel had thirteen weeks under it. A season starts with one. Most of
// the branching below exists for that: a chart or a number that cannot say
// anything honest yet says so, rather than drawing a confident shape out of a
// single game.

import { generateDemoLeague } from './demo.js';
import { generateDemoSchedule, generateDemoWeekRosters } from './demo-rosters.js';
import {
  computeLeagueStats, teamFitPoints, playerFitPoints, boxStats, weekLuckParts, leagueAvgActualOf, closeLuckOf,
  WEEK_LUCK_LIMIT,
} from './stats.js';
import { fetchSeasonData, fetchSchedule, fetchWeeksRosters } from './season.js';
// THE POSITIONAL FLOOR (Tim, 2026-09-18). Schedule luck is the average
// PROJECTED opponent, so it is a per-position assessment like any other: an
// opponent with a kicker on bye is not really worth zero there, and counting
// him as such would flatter everyone who plays him. Read defensively, the way
// the bye read is, so a stub or a refused wire leaves the old numbers exactly
// as they were.
import * as season from './season.js';
import {
  projectionsFromWeekTeams,
  opponentProjections,
  leagueAverageOpponent,
} from './projection.js';
import * as espn from './espn.js';
// `floorWeek` — the one definition of which week's wire the floor is read for,
// shared with Schedule, Home and Summary.
import * as capture from './capture.js';
import { describeFloors } from './floor.js';
import { lineChart, histogram, boxPlot, scatterChart, leastSquares, SERIES_COLORS } from './charts.js';
// THE SHARED RED/GREEN SCALE (Tim, 2026-09-19). It REPLACED a local
// `heatScale()` that lived here — see `heatCell` below for what was wrong with
// it and why the two could not coexist.
import {
  heatScale, heatOf, heatMarkHtml, describeHeat, describeHeatPerColumn, heatStanding, ordinal,
} from './heat.js';
// ROSTER STRENGTH AND FUTURE PROJ DIFF (Tim, 2026-10-08): a squad's best-lineup
// week, the very arithmetic the Analysis page's Weekly totals are made of.
import { lineupWeekTotals, futureAverages, futureDiffs } from './lineup-avg.js';
// THE STANDINGS TABLE'S ROWS, and the cell helpers they are made of, live in
// their own module since 2026-10-05 so a second page (the Decisions review)
// draws the identical table. `heatCell` and the formatters are imported back
// rather than kept twice.
import {
  standingsRowsHtml, standingsScales, standingsHeadings, standingsExplain, heatCell, winPctOf,
  fmt, pf, dash, signed, esc,
} from './standings-table.js';
import { enableSort, resort } from './sortable.js';
import { scope } from './prefs.js';
import { savedConfig, onConnection, coarsePointer } from './connection.js';
import { wirePops, hidePop } from './pop.js';
import { readParam, teamHref, weekHref } from './links.js';
import { playerCardFromWeeks, registerRun, clearRuns, showCard, hideTip } from './player-card.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('stats');

// Three weeks is where the season-shaped panels start carrying information.
// Below it a ten-series line chart has no line to draw, a team's box plot is
// its own two scores, and the close-game luck curve — which is designed to be
// violent about one-score games — has nothing to average that violence away.
const MIN_WEEKS = 3;

const state = {
  source: 'demo',
  stats: null,
  highlight: null,      // team id to emphasise (charts.js also has its own
                        // click-to-highlight on the legend it draws)
  weeklyMetric: 'actual',
  sourcePicked: false,  // the user chose a source by hand this page load

  // Schedule luck. Built from the fixture list plus a per-week roster read, so
  // it is the one thing here that is worth showing before a ball is kicked —
  // and the only thing that costs a request per week, hence the cache, the
  // pending flag and the token. See ensureOppProj().
  oppProj: null,        // { key, byTeam, leagueAvg, ... } or { key, error }
  oppPending: null,     // key of a run currently in flight
  oppProgress: null,    // { done, total } while rosters are being read
  oppToken: 0,

  // The weekly rosters that same read brought back, kept for the players
  // scatter (renderFit). It is the SAME read — nothing extra is asked of ESPN.
  weekTeams: null,      // { key, map: Map<week, teams[]> }

  // Each team's chance of winning the game it is playing right now, off that
  // same read (`capture.liveWinChancesFrom`). Empty unless a matchup is under
  // way; null on demo and until the read lands. See `recordOf`.
  live: null,           // { key, chances: Map<teamId, 0..1> }
};

// "Which team am I" is the same answer every visit, so it is remembered; the
// connection bar's team, when there is one, is the better first guess than None.
state.highlight = prefs.get('highlight', null);
if (state.highlight === null) {
  const cfg = savedConfig();
  if (cfg && cfg.teamId != null) state.highlight = cfg.teamId;
}

// ------------------------------------------------------------------ formatting

// `fmt`, `dash`, `signed` and `esc` come from js/standings-table.js.

/**
 * A team's record as it stands now (`capture.recordNow`, the one Schedule and
 * Summary print too): W–L, plus the tie a two-game season can already contain
 * — ties were computed and never shown, so a team that tied then won read as
 * "1–0" — and, while its game is being played, that game counted as its chance
 * of winning it: 3–2 at 20% reads 3.2–2.8 (Tim, 2026-10-05). `.text` to print,
 * `.title` for the basis, `.wins` / `.games` to sort on.
 */
const recordOf = (t) => capture.recordNow(
  { w: t.wins, l: t.losses, t: t.ties },
  state.live && state.live.key === scheduleKey() ? state.live.chances.get(t.id) ?? null : null,
);
const record = (t) => recordOf(t).text;

/**
 * Win percentage the way ESPN ranks a standings table: a tie is half a win.
 * This league has no matchup tie-breaker, so a tie stands and has to count.
 * Null before a game is played. A game being played counts as a game, won by
 * its chance — the number the Record cell shows — so the column sorts on what
 * it prints and a team mid-game is not ranked on one game fewer than a team
 * whose matchup finished early.
 */
const winPct = (t) => winPctOf(recordOf(t));

/** ESPN's order: win percentage, then points for. (The Record cell's own sort
 *  key is the same order as one number: `recordSortKey` in standings-table.js.) */
const byRecord = (a, b) => (winPct(b) ?? 0) - (winPct(a) ?? 0) || b.pointsFor - a.pointsFor;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A long note as short paragraphs. Empty entries are dropped. */
const paras = (lines) =>
  lines.filter(Boolean).map((l) => `<p>${l}</p>`).join('');

/** Hide or show an element by its hidden attribute. */
function setHidden(el, hide) {
  if (!el) return;
  if (hide) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

/** A "How this works" toggle with nothing in it is hidden rather than offered. */
function tuckIfEmpty(noteId) {
  const note = $(noteId);
  const box = note && note.closest('details');
  if (box) setHidden(box, !note.textContent.trim());
}

/** Weeks with a completed game in them — the number every guard here turns on. */
const weekCount = () => (state.stats ? state.stats.weekNumbers.length : 0);

/**
 * Nothing has been played.
 *
 * stats.js averages an empty week list to 0 rather than to null, which is the
 * right answer for arithmetic and the wrong one to print: a column of 0.0s
 * reads as ten teams who all scored nothing, not as a season that has not
 * started. Everything derived from a result is dashed while this is true.
 */
const noGames = () => weekCount() === 0;

/**
 * THE WEEK STILL BEING PLAYED, when some of its matchups are already final
 * (Tim, 2026-10-04) — or null.
 *
 * js/season.js hands a matchup over as soon as every starter in it has
 * finished, so the latest week can hold results for only some teams. It is
 * recognised by the count alone: fewer teams with a game in it than in the
 * fullest week before it (or, in week 1, than the league can pair up). A
 * league with an odd team on bye has the same count every week, so a bye is
 * never mistaken for a game still going.
 */
function partWeek() {
  const s = state.stats;
  if (!s || !s.weekNumbers.length) return null;
  const count = (w) => s.teams.filter((t) => t.weekly.some((r) => r.week === w)).length;
  const last = s.weekNumbers[s.weekNumbers.length - 1];
  const before = s.weekNumbers.slice(0, -1).map(count);
  const full = before.length ? Math.max(...before) : s.teams.length - (s.teams.length % 2);
  return count(last) < full ? last : null;
}

const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

// --------------------------------------------------------------------- loading
//
// Both loaders return whether they actually produced a rendered league, because
// the source toggle used to paint itself before finding out.

async function loadDemo() {
  setStatus('Generated sample data — not your real league.');
  const data = generateDemoLeague();
  state.stats = computeLeagueStats(data);
  render();
  return true;
}

async function loadLive() {
  // savedConfig() reads whichever key the connection bar last wrote. Reading
  // localStorage['ff.config'] directly here is what used to make a connected
  // league look unconnected.
  const cfg = savedConfig();
  if (!cfg) {
    setStatus('No league connected yet. Set one up on the Connection page first.', true);
    return false;
  }

  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  setStatus('Loading your league from ESPN…');

  try {
    const data = await fetchSeasonData({
      onProgress: (done, total, label) =>
        setStatus(`${esc(label)} (${done}/${total})`),
    });

    // No completed games used to return here, before render(), so the page
    // showed nothing at all — at precisely the moment when the one number that
    // needs no results (schedule luck, below) is the only thing worth reading.
    // It renders now: every column built on a result reports itself empty, and
    // the schedule-luck panel fills itself in from the fixture list.
    if (!data.games.length) {
      state.stats = computeLeagueStats(data);
      setStatus(
        `Connected to ${esc(data.name)}, but ESPN has no completed matchups for ` +
        `${data.season} yet, so every number below that needs a result is blank. ` +
        'Schedule luck does not need one and is shown. If you expected results, ' +
        'the season may be the wrong one — pick an earlier one on the strip above.'
      );
      render();
      return true;
    }

    state.stats = computeLeagueStats(data);

    // A PLAYED WEEK WHOSE LINEUPS COULD NOT BE READ. Its games are in the
    // record and the points; js/stats.js leaves them out of everything formed
    // from a projection, so those cells are dashes and the averages skip the
    // week. Which weeks is said here, in the gap wording the page already uses
    // ("Incomplete:"), rather than a warning that the numbers "will be wrong".
    const gaps = data.projectionsAvailable ? [] : weeksWithoutProjections(data);
    if (gaps.length) {
      setStatus(
        `Loaded ${data.gamesFound} games from ${esc(data.name)}. <strong>Incomplete:</strong> ` +
        `${gaps.length === 1 ? 'week' : 'weeks'} ${gaps.join(', ')} projections missing — luck ` +
        `leaves ${gaps.length === 1 ? 'it' : 'them'} out.`,
        true
      );
    } else {
      setStatus(`Loaded ${data.gamesFound} games from ${esc(data.name)}.`);
    }
    render();
    return true;
  } catch (err) {
    setStatus(esc(err.message), true);
    return false;
  }
}

/** The played weeks with a game that has no projection: js/season.js names
 *  them; a source that does not (a stub, an older copy) is read off its games. */
function weeksWithoutProjections(data) {
  if (Array.isArray(data.weeksWithoutProjections)) return data.weeksWithoutProjections;
  const bare = (data.games || []).filter((g) => !(g.homeProjected > 0 && g.awayProjected > 0));
  return [...new Set(bare.map((g) => g.week))].sort((a, b) => a - b);
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** The toggle reflects `state.source`, which only moves once data arrived. */
function paintSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

// One season load at a time: the connection bar can announce a league while the
// page is already fetching one, and two fetchSeasonData runs would race.
let loading = false;

async function selectSource(src) {
  if (loading) return;
  loading = true;
  try {
    const ok = src === 'demo' ? await loadDemo() : await loadLive();
    if (ok) {
      state.source = src;
      prefs.set('source', src);
    }
  } finally {
    loading = false;
  }
  // A failed switch snaps back, so "My ESPN league" can never sit selected over
  // demo numbers. At the start of a season the no-completed-games path is the
  // likely one, which is exactly when the lie mattered most.
  paintSource();
}

// -------------------------------------------------------------------- render

function render() {
  const s = state.stats;
  if (!s) return;

  // Schedule luck belonging to a league we are no longer showing has to go
  // before anything is painted from it: team ids collide across leagues, so a
  // stale map would print the demo season's schedule beside a real team's name.
  const key = scheduleKey();
  if (state.oppProj && state.oppProj.key !== key) state.oppProj = null;
  if (state.oppPending && state.oppPending !== key) state.oppPending = null;
  if (state.weekTeams && state.weekTeams.key !== key) state.weekTeams = null;
  if (state.live && state.live.key !== key) state.live = null;

  const weeks = weekCount();

  $('modeBadge').className = 'badge ' + (s.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = s.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = s.isDemo
    ? 'Showing generated sample data so you can see the layout with a full season in it.'
    : `${s.name} · ${s.season} · ` +
      (weeks ? `${plural(weeks, 'week')} played` : 'no week played yet');

  renderTeamPicker();
  renderGlance();
  renderMainTable();
  renderOppPanel();
  renderCharts();
  renderAccuracy();
  renderFit();
  renderWeeklyTable();

  // Last, and deliberately not awaited: the schedule-luck panel costs a request
  // per week, so the rest of the page is on screen before it starts.
  ensureOppProj();
}

function renderTeamPicker() {
  const sel = $('highlightTeam');
  const teams = state.stats.teams;

  // A demo→live switch replaces the team list wholesale. An id saved against
  // the old list has to be dropped, or the select shows blank while a row
  // somewhere is still painted as "me".
  if (state.highlight !== null && !teams.some((t) => t.id === state.highlight)) {
    state.highlight = null;
    prefs.set('highlight', null);
  }

  sel.innerHTML =
    '<option value="">None</option>' +
    teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  sel.value = state.highlight === null ? '' : String(state.highlight);
}

/** Projection accuracy with its denominator. A bare "60%" from five games read
 *  exactly like 69% from sixty-five. */
function accuracyTile(bucket) {
  if (!bucket || !bucket.games) return dash;
  const n = `<small class="muted">${plural(bucket.games, 'game')}</small>`;
  return bucket.accuracy === null
    ? `${dash} ${n}`
    : `${Math.round(bucket.accuracy * 100)}% ${n}`;
}

/** "3–1 Name". The basis of a record with a game in play (rule 7) is the last
 *  line of the tile's card (`glanceSpec`); it was a title on the figure. */
function bestRecordTile(top) {
  return `${recordOf(top).text} ${esc(top.name)}`;
}

function renderGlance() {
  const s = state.stats;
  const weeks = weekCount();
  const top = [...s.teams].sort(byRecord)[0];
  const box = s.leagueActualBox;   // null before there are five scores in the league
  const overall = s.predictionAccuracy.find((a) => a.threshold === 0);

  const none = noGames();

  // The third entry names the tile's card (`glanceSpec`). Teams and Weeks have
  // none: each is a count of things already on the page.
  const items = [
    ['Teams', s.teams.length],
    ['Weeks', weeks],
    // With one week an "average" is just that week, so it says so; with none
    // there is no average at all, and stats.js's 0 must not be printed as one.
    [weeks === 1 ? `Week ${s.weekNumbers[0]} avg` : 'League avg',
      none ? dash : fmt(s.leagueAvgActual), 'leagueAvg'],
    [weeks === 1 ? 'Projected' : 'Avg projected',
      none ? dash : fmt(s.leagueAvgProjected), 'leagueProj'],
    ['Highest week', box ? fmt(box.max) : dash, 'high'],
    ['Lowest week', box ? fmt(box.min) : dash, 'low'],
    ['Best record', top && !none ? bestRecordTile(top) : dash, 'record'],
    // The one tile that can say something before kickoff. It arrives late — the
    // schedule read is asynchronous — so renderOppProjPanel() repaints this row.
    ['Hardest schedule', hardestScheduleTile(), 'schedule'],
    ['Projection accuracy', accuracyTile(overall), 'accuracy'],
  ];

  wirePops($('glance'), { selector: '.stat[data-glance]', card: (el) => glanceSpec(el.dataset.glance) });
  $('glance').innerHTML = items
    .map(([k, v, card]) => `<div class="stat"${card && v !== dash ? ` data-glance="${card}" tabindex="0"` : ''}>` +
      `<div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');
}

// ------------------------------------------------- the shared red/green scale
//
// WHAT WAS HERE BEFORE, AND WHY IT HAD TO GO. This page carried its own
// `heatScale()`: a single green ramp from the column's minimum to its maximum,
// written as an inline `rgba()` per cell. It encoded MAGNITUDE and nothing
// else, so the biggest number in a column was the greenest and the smallest was
// simply plain — including on Opp Avg, where the biggest number is the HARDEST
// schedule and being green for it is backwards.
//
// Tim's 2026-09-19 ask is the opposite of that on both counts: two hues, and
// good/bad rather than big/small. The two systems cannot sit on one page
// without the green meaning two different things in two tables, so the local
// one is gone and js/heat.js is the only scale here now. Three other things
// came with the move: the boundaries are standard deviations rather than the
// column's own min and max (one outlier no longer rescales everything under
// it), the tints are CSS classes rather than inline styles (themeable, and
// assertable in a test), and every cell carries the words that go with the
// colour.
//
// WHICH DIRECTION IS GOOD IS DECIDED HERE, PER COLUMN, and js/heat.js refuses
// to guess it. A high score is good; a high projected opponent is a hard
// schedule, which is why those two columns pass `invert`.

// `heatCell` — one cell on that scale, attributes and content together — is
// imported from js/standings-table.js, which builds the standings rows with it.

function renderMainTable() {
  const s = state.stats;
  const table = $('mainTable');
  const tbody = table.querySelector('tbody');
  // With no completed weeks every one of these is an average of nothing, which
  // stats.js correctly computes as 0 and this must not print as a score.
  const none = noGames();

  // THE ROWS ARE BUILT IN js/standings-table.js (one implementation, shared
  // with the Decisions review). What this page adds is what only it knows:
  // whose row to mark, the record with a game in play counted as its chance
  // (`recordOf`), and the opponent projections its own lazy read brought back.
  //
  // SIX SCALES, ONE PER COLUMN, and never one across the table — Avg, Proj,
  // Opp Avg, Opp proj, F−A and Luck/wk; the two opponent columns INVERTED,
  // because a high opponent average is a hard schedule. Which columns are left
  // uncoloured, and why, is the last paragraph of the note below. The scales
  // are asked for here because that note prints their thresholds.
  const oppProj = state.oppProj && state.oppProj.byTeam ? state.oppProj.byTeam : null;
  const scales = standingsScales(s, { oppProj });
  const { avg: heatAvg, opp: heatOpp, fa: heatFA, luckWk: heatLuckWk } = scales;

  // `explain`: PTW, Close luck, Luck score, Skill and S+L open their parts
  // (`explainSpec`, further down). The cell a card hangs off is about to go.
  hidePop();
  wirePops(table, {
    selector: 'td[data-explain]',
    card: (el) => explainSpec(el.dataset.team, el.dataset.explain),
  });
  // `cards`: every other cell opens a preview of its own (`cellSpec`), and
  // `moreColour` puts Total, Skill and Luck score on the scale (2026-10-08).
  wirePops(table, {
    selector: 'td[data-cell]',
    card: (el) => cellSpec(el.dataset.team, el.dataset.cell),
  });
  tbody.innerHTML = standingsRowsHtml(s, {
    highlightId: state.highlight, recordOf, oppProj, scales, explain: true,
    moreColour: true, cards: true,
  });
  markLinkedRow();

  // Single-week columns are that week's score, not an average of anything.
  const heads = standingsHeadings(s);
  $('thScoringGroup').textContent = heads.group;
  $('thAvg').textContent = heads.avg;
  $('thOppAvg').textContent = heads.oppAvg;

  // The one line under the table that stays on screen: what the ± means, or —
  // before a game is played — why the result columns are dashes. Since
  // 2026-09-19 it also has to say what the red and green mean, because a colour
  // with no key is exactly the thing rule 7 forbids, and because the same green
  // means the OPPOSITE thing on the two opponent columns.
  $('mainTableStatus').innerHTML = (none
    ? '<strong>Nothing played yet</strong>, so columns drawn from results are blank. ' +
      'Opp proj needs no games. '
    : '<strong>±</strong> = how far Close luck, Luck score and S+L could still move. ' +
      'It narrows every week. ') +
    // THE TWO INVERTED COLUMNS ARE THE REASON THIS CLAUSE IS ON SCREEN rather
    // than in the toggle: green on Opp Avg is the opposite arithmetic to green
    // on Avg, and a reader who misses it reads the softest schedule in the
    // league as the hardest. Everything else — the four steps, where each
    // column's colours turn in its own units — is method and is behind "What
    // the columns mean". Naming F−A and Luck/wk separately went with it: they
    // follow the general rule in the first clause, so saying so again was ten
    // words spent confirming the default (node tests/text-audit.mjs stats.html).
    // The opening clause keeps its full wording on purpose: tests/stats-weeks.mjs
    // (another suite) asserts it verbatim as this table's key, and quietly
    // renaming a thing two suites agree on is how a contract drifts.
    '<strong>Green is good for that team, red is bad</strong>, down each column — but ' +
    '<strong>Opp Avg</strong> and <strong>Opp proj</strong> are turned over: green is an ' +
    '<em>easy</em> schedule. Ends carry ▲▼ and bold.';

  // The full glossary, behind "What the columns mean". "Tap or hover a heading"
  // is the lede above the table — a `title` draws nothing on iOS, and
  // js/touch-titles.js opens the same words as a sheet on a tap.
  $('mainTableNote').innerHTML = paras([
    '<strong>Opp proj</strong> = the average projected score of the opponents on your ' +
    'schedule, which needs no games played. <strong>Luck/wk</strong> = actual − ' +
    'projected. <strong>PTW</strong> = the projection you ' +
    'needed to beat a typical opponent. <strong>Skill</strong> = your average ' +
    'projected score minus the league&rsquo;s.',
    '<strong>LS</strong>, <strong>PS</strong> ' +
    'and <strong>AS</strong> rank the league by luck score, by skill + luck, and by ' +
    'actual record.',
    // Rule 7, only while it applies: the basis of a decimal W–L.
    s.teams.some((t) => recordOf(t).live)
      ? `<strong>W–L:</strong> ${esc(capture.LIVE_RECORD_TEXT)} Every other column, AS ` +
        'included, counts finished games only.'
      : '',
    none
      ? 'Nothing has been played yet, so every column drawn from a result is blank ' +
        'rather than zero. Opp proj is the exception, and the Schedule luck panel ' +
        'further down the page explains why.'
      : '<strong>±</strong> beside Close, Luck and S+L is how far that figure could still ' +
        'move: one standard error of an average of this team&rsquo;s games, from how much ' +
        'the per-game number varies across the league. About two times in three the ' +
        'figure a full season settles on is inside it.',
    none
      ? ''
      : 'It is wide after a game or two — ' +
        'a 3-point result alone swings Close luck by up to 50 — and narrows every week, ' +
        'so LS and PS early on are a guess with the range beside it, not a verdict.',
    // THE SCALE, IN FULL AND IN POINTS. The visible line above says what the
    // colours mean; this says where the lines actually fall, so a cell can be
    // checked by hand rather than believed. `describeHeat` writes it off the
    // scale the table was drawn with, so the two can never drift.
    heatAvg
      ? `<strong>Avg:</strong> ${describeHeat(heatAvg, {
        what: 'what the other nine teams average a week',
        high: 'scoring more than the league', low: 'scoring less',
      })}`
      : 'Nothing is coloured yet: a scale needs at least two teams with a number in the ' +
        'column to compare them against each other.',
    heatOpp
      ? '<strong>Opp Avg</strong> and <strong>Opp proj</strong> are the same scale turned ' +
        'over, because a big number there is a hard schedule rather than a good week: green ' +
        'is the easier half of the league, red the harder.'
      : '',
    heatFA
      ? `<strong>F&minus;A:</strong> ${describeHeat(heatFA, {
        what: 'the margins the other nine teams are winning or losing by',
        high: 'winning by more', low: 'losing by more',
      })}`
      : '',
    heatLuckWk
      ? `<strong>Luck/wk:</strong> ${describeHeat(heatLuckWk, {
        what: 'how far the other nine teams are landing from their own projections',
        high: 'beating the projection', low: 'falling short of it',
      })}`
      : '',
    // WHICH COLUMNS ARE LEFT ALONE, AND WHY. Kept as one sentence a reader can
    // check against the table rather than a shrug: three different reasons, and
    // every one of them is a rule in js/heat.js rather than a preference.
    '<strong>Total</strong>, <strong>Skill</strong> and <strong>Luck score</strong> are ' +
    'coloured the same way, each down its own column: more is green.',
    'Every other column on this table is left uncoloured on purpose. <strong>LS</strong>, ' +
    '<strong>PS</strong> and <strong>AS</strong> are ranks, which are already an ordering. ' +
    '<strong>Close luck</strong> and <strong>S+L</strong> carry a ' +
    '±, and early in a season that margin is wider than the gaps between the teams. ' +
    '<strong>Spread</strong> and <strong>PTW</strong> have no good ' +
    'end to point at: a low spread is consistency whether a team is good or bad, and PTW rises ' +
    'both when your opponents score more and when your own luck runs against you.',
    'Hover or tap any number for what it is made of. A click on a team&rsquo;s name opens its ' +
    'roster on Analysis.',
  ]);

  // Default to standings order; afterwards keep whatever the user picked.
  enableSort(table, { defaultIndex: 1 });
  resort(table);
}

// ---------------------------------------------------------------------- charts

function seriesFor(valueFn) {
  return state.stats.teams.map((t, i) => ({
    id: t.id,
    name: t.name,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    values: state.stats.weekNumbers.map((w) => {
      const row = t.weekly.find((x) => x.week === w);
      return row ? valueFn(row) : null;
    }),
  }));
}

// ---- view switches (Tim, 2026-10-08: "at least give the option of switching
// it to a differnt view. I think cumulative graphs are often really nice but
// there are also other great alternatives"; docs/charts-plan.md B1, B2, B5).
// One small segmented control per chart, the first button being the view the
// chart always had. The choice is remembered per viewer; the chart is drawn
// at the same height from the same teams in every view, so its box - and
// everything under it - holds still when a button is pressed.
const VIEWS = {
  scoresView: ['week', 'total', 'vsavg', 'rank'],
  luckView: ['week', 'total'],
  spreadView: ['boxes', 'dots'],
};
const view = {};
for (const [id, list] of Object.entries(VIEWS)) {
  const saved = prefs.get(id, list[0]);
  view[id] = list.includes(saved) ? saved : list[0];
}

function paintViews() {
  for (const id of Object.keys(VIEWS)) {
    const seg = $(id);
    if (!seg) continue;
    seg.querySelectorAll('button[data-view]').forEach((b) => {
      const on = b.dataset.view === view[id];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  // Weekly luck's sentence follows its view. Both are in the markup, stacked
  // (stats.html `.lede-swap`); the one not showing is invisible, not removed.
  const total = view.luckView === 'total';
  for (const [id, on] of [['luckLedeWeek', !total], ['luckLedeTotal', total]]) {
    const el = $(id);
    if (!el) continue;
    if (on) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', 'true');
  }
}

for (const id of Object.keys(VIEWS)) {
  const seg = $(id);
  if (seg) {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || !VIEWS[id].includes(btn.dataset.view)) return;
      view[id] = btn.dataset.view;
      prefs.set(id, view[id] === VIEWS[id][0] ? null : view[id]);
      if (state.stats) renderCharts();
    });
  }
}

/**
 * Weekly scores, four ways (B2). Every view is made of the same weekly scores:
 *   week    the score itself
 *   total   the season's points so far, after each week (a bye holds the line)
 *   vsavg   the score minus what the league averaged THAT week
 *   rank    where the score placed in the league that week, 1 = highest;
 *           equal scores share a place
 * A week still being played has only some teams' scores, so it has no league
 * average and no ranking: those two views leave it out, as the Week by week
 * grid leaves it uncoloured.
 */
function scoreView(kind) {
  const s = state.stats;
  const part = partWeek();
  const base = { height: 320, yLabel: 'Points' };
  if (kind === 'total') {
    return {
      ...base,
      yLabel: 'Total points',
      series: s.teams.map((t, i) => {
        let sum = 0;
        return {
          id: t.id,
          name: t.name,
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          values: s.weekNumbers.map((w) => {
            const row = t.weekly.find((x) => x.week === w);
            if (!row) return w === part ? null : sum;
            sum += row.actual;
            return sum;
          }),
        };
      }),
    };
  }
  if (kind === 'vsavg' || kind === 'rank') {
    const scores = new Map(s.weekNumbers.map((w) => [w, w === part ? [] : s.teams
      .map((t) => t.weekly.find((x) => x.week === w))
      .filter((r) => r && typeof r.actual === 'number').map((r) => r.actual)]));
    if (kind === 'vsavg') {
      const avg = (w) => { const v = scores.get(w); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      return {
        ...base,
        yLabel: 'Points vs league average',
        zeroLine: true,
        series: seriesFor((r) => (avg(r.week) === null ? null : r.actual - avg(r.week))),
      };
    }
    const n = s.teams.length;
    return {
      ...base,
      yLabel: 'Rank that week',
      // Half a place of room at each end, so 1st and last are not drawn on the frame.
      yDomain: [0.5, Math.max(2, n) + 0.5],
      yTicks: Array.from({ length: Math.max(2, n) }, (_, i) => i + 1),
      yReverse: true,
      series: seriesFor((r) => {
        const v = scores.get(r.week);
        return v.length ? 1 + v.filter((o) => o > r.actual).length : null;
      }),
    };
  }
  return { ...base, series: seriesFor((r) => r.actual) };
}

function renderCharts() {
  const s = state.stats;
  const weeks = weekCount();
  const trends = weeks >= MIN_WEEKS;
  paintViews();

  // The two ten-series line charts and the ten-row box plot need a season
  // shape to draw. With one week they are ten dots in a vertical stripe, twice
  // over, plus ten 1.5px slivers — about a thousand pixels of scrolling
  // that says nothing. Hide them and say why once, at the top.
  show('panelWeekly', trends);
  show('panelLuck', trends);
  show('panelBox', trends);
  show('panelEarly', !trends);
  // With no weeks the grid is ten team names and no columns to put beside them.
  show('panelWeekGrid', weeks > 0);

  $('distNote').textContent = trends
    ? 'Every team’s weekly score, in ten-point buckets.'
    : weeks === 0
      ? 'Nothing has been played, so there are no scores to bucket yet.'
      : `Every team’s score so far, in ten-point buckets — ${plural(s.teams.reduce((n, t) => n + t.weekly.length, 0), 'score')}.`;

  if (!trends) {
    renderEarly();
    renderDistribution();
    return;
  }

  const xLabels = s.weekNumbers.map(String);
  // KEYED ON THE TEAM ID, never the name it renders as (rule 9, AUDIT §1.9):
  // two managers showing the same string used to get both lines emphasised.
  const highlightId = state.highlight ?? undefined;

  // The preview over a week names the week, and adds My team's game in it: the
  // opponent and the result (docs/previews-plan.md).
  const weekTip = {
    tipTitle: (i, label) => `Week ${label}`,
    tipExtra: (i) => {
      const t = state.highlight === null ? null : teamOfId(state.highlight);
      const r = t ? t.weekly.find((x) => x.week === s.weekNumbers[i]) : null;
      return r ? [{ value: resultText(r), name: `vs ${teamName(r.oppId)}` }] : null;
    },
  };

  lineChart($('chartWeekly'), {
    ...scoreView(view.scoresView),
    xLabels,
    highlight: highlightId,
    ...weekTip,
  });

  // Weekly luck, two ways (B1). "Running total" is the chart that used to be
  // its own Cumulative luck panel: the luck score as it stood after each week.
  lineChart($('chartLuck'), {
    series: view.luckView === 'total'
      ? s.teams.map((t, i) => ({
        id: t.id,
        name: t.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        values: s.weekNumbers.map((w) => {
          const row = t.cumulativeLuck.find((x) => x.week === w);
          return row ? row.value : null;
        }),
      }))
      : seriesFor((r) => r.luck),
    xLabels,
    yLabel: view.luckView === 'total' ? 'Cumulative luck' : 'Actual − projected',
    height: 300,
    zeroLine: true,
    highlight: highlightId,
    ...weekTip,
  });

  renderDistribution();

  // A team's five-number summary wants about five weeks. Below that the boxes
  // are drawn anyway from the weeks there are (Tim, 2026-10-05: "just show the
  // partial information now and have a note that says it should have about 5
  // weeks"), and the note above the chart says how thin they are. stats.js
  // still withholds `actualBox` under five scores, so the early box is built
  // here from the same weekly scores.
  const BOX_WEEKS = 5;
  const withBox = s.teams
    .map((t) => ({ t, box: t.actualBox || boxStats((t.weekly || []).map((w) => w.actual), 2) }))
    .filter((r) => r.box);
  const thinBox = withBox.some((r) => !r.t.actualBox);
  const early = $('boxEarly');
  if (early) {
    early.hidden = !thinBox;
    early.textContent = thinBox
      ? `Early look: ${plural(weeks, 'week')} so far. A spread wants about ${BOX_WEEKS}.`
      : '';
  }
  if (!withBox.length) {
    $('chartBox').innerHTML =
      `<p class="empty">A team&rsquo;s spread needs at least two weeks of scores — ` +
      `there ${weeks === 1 ? 'is' : 'are'} ${plural(weeks, 'week')} so far.</p>`;
    return;
  }

  // A TEAM'S ROW IS ITS OWN COLOUR. The rows arrive sorted by median, and with
  // no colour handed over the chart coloured them by position - so a team was
  // one colour here and another on the line charts above (docs/charts-plan.md
  // A5). The slot is the team's place in the league list, as in `seriesFor`.
  const slot = new Map(s.teams.map((t, i) => [t.id, SERIES_COLORS[i % SERIES_COLORS.length]]));
  boxPlot($('chartBox'), {
    rows: withBox
      .sort((a, b) => b.box.median - a.box.median)
      .map(({ t, box }) => ({
        id: t.id,
        name: t.name,
        color: slot.get(t.id),
        min: box.min,
        q1: box.q1,
        median: box.median,
        q3: box.q3,
        max: box.max,
        outliers: box.outliers,
        href: teamHref(t.id),
        // "Every week as a dot" (B5): the scores the box was made from.
        points: (t.weekly || []).filter((w) => typeof w.actual === 'number')
          .map((w) => ({ value: w.actual, label: `week ${w.week}`, href: teamHref(t.id, w.week) })),
      })),
    xLabel: 'Points',
    mode: view.spreadView === 'dots' ? 'dots' : undefined,
    highlight: highlightId,
    // In plain words, and naming the weeks: a box is a typical week, the middle
    // half of them, and the best and the worst; a dot is one week and its game.
    tipRows: (row, pt) => {
      const t = teamOfId(row.key);
      const played = t ? t.weekly.filter((w) => isNum(w.actual)) : [];
      if (!played.length) return null;
      if (pt) {
        const r = played.find((w) => `week ${w.week}` === pt.label);
        return r ? [{ color: row.color, value: fmt(r.actual), name: `week ${r.week} vs ${teamName(r.oppId)}` }] : null;
      }
      const best = played.reduce((a, b) => (b.actual > a.actual ? b : a));
      const worst = played.reduce((a, b) => (b.actual < a.actual ? b : a));
      return [
        { color: row.color, value: fmt(row.median), name: 'typical week' },
        { value: `${fmt(row.q1)}–${fmt(row.q3)}`, name: 'middle half' },
        { value: fmt(best.actual), name: `best, week ${best.week}` },
        { value: fmt(worst.actual), name: `worst, week ${worst.week}` },
      ];
    },
  });
}

function renderDistribution() {
  const s = state.stats;
  // A bar opens the scores in it (`distSpec`), so the chart's own small
  // preview of the count stays shut: one preview a bar.
  const box = $('chartDist');
  box.dataset.ffTip = 'off';
  wirePops(box, { selector: '.ff-hit', card: (el) => distSpec(Number(el.getAttribute('data-i'))) });
  histogram($('chartDist'), {
    bins: s.distribution10.bins,
    counts: s.distribution10.counts,
    yLabel: 'Weeks',
    height: 260,
  });
}

/**
 * What weeks 1-2 can honestly say: how many weeks there are, how far the whole
 * league landed from its projection, and the spread of every score played so
 * far as one box. Ten scores a week is thin, but it is a real distribution —
 * unlike a single team's two.
 */
function renderEarly() {
  const s = state.stats;
  const weeks = weekCount();
  const latest = s.weeklyLeagueAverages[s.weeklyLeagueAverages.length - 1];

  const lines = [
    (weeks === 0
      ? '<strong>No week has been played yet.</strong> Weekly scores, weekly '
      : `<strong>${plural(weeks, 'week')} of data so far.</strong> Weekly scores, weekly `) +
    // (Cumulative luck is a view of Weekly luck now, not a panel of its own.)
    `luck and per-team spread appear from week ${MIN_WEEKS} — with ` +
    'less than that they draw a shape that is not in the data.' +
    (weeks === 0
      ? ' Schedule luck, further down the page, is the number that does not have to wait.'
      : ''),
  ];

  // (Not for a week whose projections could not be read: `avgLuck` is null.)
  if (latest && latest.avgLuck !== null) {
    const err = latest.avgLuck;
    lines.push(
      `In week ${latest.week} the league scored ${fmt(Math.abs(err))} points ` +
      `${err < 0 ? 'under' : 'over'} projection on average: ${fmt(latest.avgActual)} ` +
      `actual against ${fmt(latest.avgProjected)} projected.`
    );
  }
  $('earlyNote').innerHTML = lines.join(' ');

  const box = s.leagueActualBox;
  if (!box) {
    $('chartLeagueBox').innerHTML = '<p class="empty">No completed games yet.</p>';
    return;
  }
  boxPlot($('chartLeagueBox'), {
    rows: [{
      name: 'Every team',
      min: box.min, q1: box.q1, median: box.median, q3: box.q3, max: box.max,
      outliers: box.outliers,
    }],
    xLabel: 'Points',
    height: 110,
  });
}

// -------------------------------------------------------------- schedule luck
//
// Average projected opponent: for every fixture a team plays, what the other
// side is projected to score that week, averaged over that team's fixtures.
//
// The point of it is that it needs ZERO completed games. Everything else on
// this page is an average over results, so in week 0 the page has nothing to
// say; this is a fact about the fixture list and everyone's rosters, and it is
// true before the first ball is kicked. High means a hard schedule, which is
// bad luck the manager had no hand in.
//
// The arithmetic all lives in js/projection.js, which the schedule page's
// forecast also uses — one answer to "how good is this team in week w", not two
// that can drift apart.

/**
 * What the current numbers were built from. Used as a cache key: while it is
 * unchanged the panel never refetches, and a result that lands after it changed
 * is discarded rather than shown against the wrong league.
 */
function scheduleKey() {
  const s = state.stats;
  if (!s) return null;
  if (s.isDemo) return 'demo';
  const cfg = savedConfig();
  return `live:${cfg ? cfg.leagueId : '?'}:${s.season}`;
}

/** Teams that have a number, hardest schedule first. */
function oppRows(byTeam = state.oppProj && state.oppProj.byTeam) {
  if (!byTeam || !state.stats) return [];
  return state.stats.teams
    .map((t) => {
      const o = byTeam.get(t.id);
      return o
        ? { id: t.id, name: t.name, record: record(t), avgOpp: o.avgOpp, own: o.own, games: o.games }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.avgOpp - a.avgOpp);
}

/** The chart's rows: the fixtures still to be played, and nothing else. */
const restRows = () => oppRows(state.oppProj && state.oppProj.rest ? state.oppProj.rest.byTeam : new Map());

/**
 * The tile is the top row of the chart beside it: the hardest run of opponents
 * STILL TO PLAY (Tim, 2026-10-05: schedule luck is rest of season), and it says
 * so. It used to be the whole season's figure, so it read 127.5 for a team the
 * chart had at 127.8. Before a game is played the two are the same number.
 * With no week left there is no rest of season, and it falls back to the whole
 * season's — the Opp proj column — labelled as that.
 */
function hardestScheduleTile() {
  const rest = restRows();
  const rows = rest.length ? rest : oppRows();
  if (!rows.length) return dash;
  const span = rest.length ? 'rest of season' : 'whole season';
  return `${fmt(rows[0].avgOpp)} <small class="muted">${esc(rows[0].name)} · ${span}</small>`;
}

/**
 * A gap from the league average as it is printed: rounded to the tenth first,
 * then signed, so a gap of −0.04 is "0.0" and never "-0.0". `value` is that
 * rounded number, for anything that turns on its sign.
 */
function gapOf(d) {
  const value = Number(d.toFixed(1)) + 0;
  return { value, text: `${value > 0 ? '+' : ''}${value.toFixed(1)}` };
}

/**
 * Fetch it once per league, lazily, and never again while the league is the
 * same. A failure is cached too, so a league ESPN will not answer for is
 * reported once instead of retried on every repaint.
 */
function ensureOppProj() {
  const key = scheduleKey();
  if (!key) return;
  if (state.oppProj && state.oppProj.key === key) return;
  if (state.oppPending === key) return;

  // Demo mode makes no request at all: demo-rosters.js answers synchronously,
  // so the panel is simply there on first paint.
  if (key === 'demo') {
    const weekTeams = demoWeekTeams();
    state.weekTeams = { key, map: weekTeams };
    state.oppProj = buildOppProj(key, generateDemoSchedule(), weekTeams);
    afterOppProj();
    return;
  }
  refreshOppProj(key);
}

function demoWeekTeams() {
  const schedule = generateDemoSchedule();
  return new Map(schedule.weeks.map((w) => [w, generateDemoWeekRosters(w).teams]));
}

/**
 * The live version: one request for the schedule, then one per week for the
 * rosters. Deliberately not awaited by render() — the page is already on screen
 * and this fills in behind it — and guarded by a token, so a slow answer about
 * last season cannot land on top of the league that replaced it.
 */
async function refreshOppProj(key) {
  const token = ++state.oppToken;
  const stale = () => token !== state.oppToken || scheduleKey() !== key;

  state.oppPending = key;
  state.oppProgress = null;
  renderOppPanel();
  renderFit();

  try {
    const schedule = await fetchSchedule();
    if (stale()) return;

    if (!schedule.weeks.length) {
      state.oppProj = { key, error: 'ESPN has published no fixtures for this season yet.' };
      return;
    }

    const weekTeams = await fetchWeeksRosters(schedule.weeks, {
      onProgress: (done, total) => {
        if (stale() || done >= total) return;
        state.oppProgress = { done, total };
        renderOppPanel();
      },
    });
    if (stale()) return;
    // Kept for the players scatter, whatever happens to the averages below.
    state.weekTeams = { key, map: weekTeams };

    // One wire read, for the current week (the first still being projected —
    // `capture.floorWeek`, the week Schedule, Home and Summary read), used for
    // every week: the shape Tim chose. It was `schedule.weeks[0]`, week 1's
    // wire for the whole season (AUDIT §1.4). A failure is no floors at all,
    // never an error.
    let floors = null;
    let floorWeek = null;
    try {
      floorWeek = capture.floorWeek(capture.normalizeSchedule(schedule, { isDemo: false }));
      if (typeof season.fetchFloors === 'function' && floorWeek) {
        const got = await season.fetchFloors(floorWeek);
        floors = got && got.size ? got : null;
      }
    } catch { floors = null; }
    if (stale()) return;

    // THE WEEK IN PROGRESS, off the rosters and floors just read — Schedule's
    // own route to a team's chance in the game it is playing (`capture.
    // liveWinChancesFrom`), for the W–L column. The NFL's games are the payload
    // the roster read already fetched for byes, so this asks ESPN for nothing
    // more; a stub without the read, or a failure, is simply no live record.
    const chances = await liveChances(schedule, weekTeams, floors);
    // The week being played, for the rest-of-season chart to leave out.
    const open = capture.openWeeks(capture.normalizeSchedule(schedule, { isDemo: false }))[0];
    state.live = { key, chances, week: chances.size && open !== undefined ? open : null };
    if (stale()) return;

    state.oppProj = buildOppProj(key, schedule, weekTeams, floors, floorWeek);
  } catch (err) {
    if (stale()) return;
    state.oppProj = { key, error: esc(err.message || String(err)) };
  } finally {
    if (state.oppPending === key) {
      state.oppPending = null;
      state.oppProgress = null;
    }
  }

  if (stale()) return;
  afterOppProj();
}

/** teamId -> chance of winning the game being played now; empty when none is. */
async function liveChances(schedule, weekTeams, floors) {
  try {
    if (typeof season.fetchProGames !== 'function') return new Map();
    const data = capture.normalizeSchedule(schedule, { isDemo: false });
    const proGames = await season.fetchProGames();
    const week = capture.openWeeks(data)[0];
    return capture.liveWinChancesFrom({
      data, weekTeams, floors, proGames,
      asOf: typeof season.weekReadAt === 'function' && week !== undefined
        ? season.weekReadAt(week) : null,
    });
  } catch {
    return new Map();
  }
}

/** Turn a schedule plus a week→rosters map into the per-team averages. */
function buildOppProj(key, schedule, weekTeams, floors = null, floorWeek = null) {
  const built = projectionsFromWeekTeams(weekTeams, floors);
  if (!built) {
    return {
      key,
      error:
        'ESPN returned no usable player projections for these weeks, so there is ' +
        'nothing to project an opponent from. It usually means the season is not ' +
        'open yet — try again once ESPN has published the week&rsquo;s lineups.',
    };
  }

  const byTeam = opponentProjections(
    schedule.games,
    built.proj,
    state.stats.teams.map((t) => t.id)
  );
  if (!byTeam.size) {
    return {
      key,
      error:
        'The fixture list and the weeks ESPN would project do not overlap, so no ' +
        'opponent average can be formed.',
    };
  }

  // REST OF SEASON (Tim, 2026-10-05: "a rest-of-season chart that doesn't
  // include any information that is currently being shown or calculated for").
  // A week with a result on the board — finished, or in play with one matchup
  // final early — is out, and so is the week being played right now. The
  // Opp proj column above stays the whole season's.
  const liveWeek = state.live && state.live.key === key ? state.live.week : null;
  const started = new Set(schedule.games.filter((g) => g.played).map((g) => g.week));
  const restWeeks = built.weeks.filter((w) => !started.has(w) && w !== liveWeek);
  const restByTeam = opponentProjections(
    schedule.games.filter((g) => restWeeks.includes(g.week)),
    built.proj,
    state.stats.teams.map((t) => t.id)
  );

  // WHERE EACH NUMBER COMES FROM (Tim, 2026-10-06: "a chart that shows the
  // future proj of the teams that that player is playing each week that they
  // play them"): the same fixtures the average is formed from, kept one by one.
  // `weeks` is the weeks that HAVE such a fixture, so the label over the chart
  // names the weeks counted (5–14) and not the playoff weeks ESPN also projects.
  const restFixtures = new Map();
  for (const g of schedule.games) {
    if (!restWeeks.includes(g.week) || g.homeId == null || g.awayId == null) continue;
    const forWeek = built.proj.get(g.week);
    if (!forWeek) continue;
    for (const [id, oppId] of [[g.homeId, g.awayId], [g.awayId, g.homeId]]) {
      const opp = forWeek.get(oppId);
      if (!restByTeam.has(id) || !Number.isFinite(opp)) continue;
      if (!restFixtures.has(id)) restFixtures.set(id, []);
      restFixtures.get(id).push({ week: g.week, oppId, opp });
    }
  }
  for (const list of restFixtures.values()) list.sort((a, b) => a.week - b.week);
  const countedWeeks = [...new Set([...restFixtures.values()].flat().map((f) => f.week))]
    .sort((a, b) => a - b);

  return {
    key,
    byTeam,
    leagueAvg: leagueAverageOpponent(byTeam),
    rest: {
      byTeam: restByTeam,
      leagueAvg: restByTeam.size ? leagueAverageOpponent(restByTeam) : null,
      weeks: countedWeeks,
      fixtures: restFixtures,
    },
    future: buildFuture(schedule, weekTeams, restWeeks, floors),
    scheduleWeeks: schedule.weeks,
    projectedWeeks: built.weeks,
    countsKnown: built.countsKnown,
    starters: built.slots.length,
    // What the note has to say about the floor (rule 7, AUDIT §1.5): '' when
    // none was applied.
    floorSaid: describeFloors(floors, { week: floorWeek }),
  };
}

/** Everything that shows a schedule-luck number, repainted where it stands. */
function afterOppProj() {
  renderGlance();
  renderMainTable();
  renderOppPanel();
  renderFit();
}

function renderOppPanel() {
  const chart = $('oppProjChart');
  const note = $('oppProjNote');
  if (!chart || !note) return;
  paintOppPanel(chart, note);
  // The data gaps stay on screen; the method sits behind "How this works".
  const warn = $('oppProjWarn');
  const gaps = state.oppPending ? [] : oppGaps(state.oppProj);
  if (warn) {
    warn.innerHTML = gaps.length ? `<strong>Incomplete:</strong> ${gaps.join(' ')}` : '';
    setHidden(warn, !gaps.length);
  }
  tuckIfEmpty('oppProjNote');
  // The two boxes beside it are made of the same read and repaint with it.
  renderFuturePanels();
}

/** "weeks 5–14", "week 14", or '' when nothing is left. */
function restSpan(weeks) {
  if (!weeks || !weeks.length) return '';
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  return first === last ? `week ${first}` : `weeks ${first}–${last}`;
}

function paintOppPanel(chart, note) {
  hidePop();
  // The weeks the chart is formed over, said in the heading itself.
  const said = $('oppProjSpan');
  const d = state.oppProj;
  const span = !state.oppPending && d && !d.error && d.rest ? restSpan(d.rest.weeks) : '';
  if (said) said.textContent = span ? ` (${span})` : '';
  wirePops(chart, { selector: '.dd[data-opp]', card: (el) => oppPopSpec(el.dataset.opp) });

  if (state.oppPending) {
    const p = state.oppProgress;
    chart.innerHTML =
      '<p class="pending">Reading ESPN&rsquo;s own projections' +
      (p ? ` — <strong>week ${p.done} of ${p.total}</strong>` : '') +
      '&hellip;</p>';
    note.innerHTML = paras([
      'ESPN publishes projections one week at a time and has no bulk form, so this ' +
      'costs one request per week of the season. Nothing else on the page is waiting ' +
      'for it.',
    ]);
    return;
  }

  const data = state.oppProj;
  if (!data) {
    chart.innerHTML = '<p class="empty">Loading the schedule&hellip;</p>';
    note.textContent = '';
    return;
  }

  if (data.error) {
    chart.innerHTML = `<p class="empty">${data.error}</p>`;
    note.textContent = '';
    return;
  }

  const rows = restRows();
  if (!rows.length) {
    chart.innerHTML = data.rest && !data.rest.weeks.length
      ? '<p class="empty">No weeks left to play.</p>'
      : '<p class="empty">No fixtures could be matched to a projected week.</p>';
    note.textContent = '';
    return;
  }

  chart.innerHTML = oppBars(rows, data.rest.leagueAvg);
  note.innerHTML = oppNote(rows, data);
}

// ------------------------------------------------ bars from a zero line
//
// Tim, 2026-10-08: "right now the schedule luck, roster strength, and future
// proj diff all show green bars coming from the right to display quanitity,
// but because our numbers correlate to +- numbers, have the 0 bar run down the
// middle and negative bars go to the left in red and positive bars to the
// right in green."
//
// So each of the three boxes draws its bar from a line down the middle of the
// track: a plus grows right, in green; a minus grows left, in red. ONE SCALE A
// BOX — the biggest figure in it, either way, fills its half of the track and
// every other bar is in proportion, so two bars in a box can be compared by
// length and a bar twice as long is a figure twice as big.
//
// THE BAR IS THE PRINTED FIGURE, rounded as it is printed: a gap that prints
// "0.0" draws no bar rather than a sliver on one side of the line.
//
//   Schedule luck     the gap from the league average (league − yours), so an
//                     EASIER run of opponents is the plus: right, green.
//   Future proj diff  the figure itself.
//   Roster strength   prints an ABSOLUTE average (~120–130), which has no
//                     minus. Its bar is that figure minus the league's average
//                     of the same figures — above the league right, below it
//                     left. The printed number stays the absolute one.

/** One bar per value: which side of the line, and how much of the track. */
function zeroBars(values) {
  const shown = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(1)) + 0 : 0));
  const most = Math.max(0, ...shown.map(Math.abs));
  return shown.map((v) => ({
    side: v > 0 ? 'pos' : v < 0 ? 'neg' : '',
    // Half the track is one side of the line, so the longest bar is 50% of it.
    width: most ? (50 * Math.abs(v)) / most : 0,
  }));
}

/** The track, its zero line (CSS, `.bar.zero`) and the bar. */
const zeroBarHtml = (b) => '<span class="bar zero">' +
  (b.side ? `<i class="${b.side}" style="width:${b.width.toFixed(1)}%"></i>` : '') + '</span>';

/**
 * Ranked horizontal bars, hardest schedule first, each drawn from the zero
 * line: the gap from the league average (see "bars from a zero line").
 *
 * Not charts.js's histogram, which scales from zero: ten averages that all land
 * between about 105 and 120 would draw ten bars of near-identical full height,
 * hiding the differences that are the entire point.
 */
function oppBars(rows, leagueAvg) {
  // Without a league figure to be a gap from, the mean of the rows stands in.
  const base = typeof leagueAvg === 'number'
    ? leagueAvg
    : rows.reduce((a, r) => a + r.avgOpp, 0) / (rows.length || 1);
  const bars = zeroBars(rows.map((r) => gapOf(base - r.avgOpp).value));

  const items = rows
    .map((r, i) => {
      // League average minus yours, so an easier run of opponents reads as a
      // plus (Tim, 2026-10-05: "it's better to have a low future opponent proj").
      const d = typeof leagueAvg === 'number' ? gapOf(leagueAvg - r.avgOpp) : null;
      const gap =
        d === null
          ? ''
          : `<span class="dd ${d.value < 0 ? 'hard' : ''}" data-opp="${esc(r.id)}" tabindex="0" role="button" ` +
            `aria-label="${esc(r.name)}: the opponents behind this number">${d.text}</span>`;
      return `<li class="${state.highlight === r.id ? 'me' : ''}">
          <span class="rk">${i + 1}</span>
          <span class="nm">${esc(r.name)} <small class="muted rec">${r.record}</small></span>
          ${zeroBarHtml(bars[i])}
          <span class="vv">${fmt(r.avgOpp)}</span>
          ${gap}
        </li>`;
    })
    .join('');

  return `<ol class="oppbars">${items}</ol>`;
}

// ------------------------------------------- where the last figure comes from
//
// Tim, 2026-10-06: "if you hover over the number it says on the end, have it
// show a preview of a chart that shows the future proj of the teams that that
// player is playing each week". One row per fixture still to play — week,
// opponent, what he is projected to score that week — then the average of
// those, the league's, and the gap, which is the figure hovered.
//
// A mouse: hover shows it, moving off hides it. A finger has no hover, so a tap
// opens it as a sheet with a Close button; a tap outside or Escape also shuts
// it. Nothing here is reachable only by hovering.

// THE CARD ITSELF IS SHARED (js/pop.js, 2026-10-08): this page opened the
// first one, and the frame, the hover, the sheet and the closing were lifted
// out of here so every page opens the same thing. What stays is what only this
// page knows — the rows.

function oppPopSpec(teamId) {
  const data = state.oppProj;
  const rest = data && data.rest;
  const team = state.stats && state.stats.teams.find((t) => String(t.id) === String(teamId));
  const list = team && rest && rest.fixtures ? rest.fixtures.get(team.id) : null;
  if (!list || !list.length) return null;
  const nameOf = (id) => {
    const t = state.stats.teams.find((x) => x.id === id);
    return t ? t.name : '—';
  };
  const avg = list.reduce((a, f) => a + f.opp, 0) / list.length;
  const league = rest.leagueAvg;
  const gap = typeof league === 'number' ? league - avg : null;
  return {
    title: team.name,
    sub: restSpan(list.map((f) => f.week)),
    head: ['Wk', 'Opponent', 'Proj'],
    rows: list.map((f) => ({ lead: f.week, label: nameOf(f.oppId), html: fmt(f.opp) })),
    totals: [
      { label: 'Average', html: fmt(avg) },
      ...(gap === null ? [] : [{ label: 'League average', html: fmt(league) }]),
    ],
    total: gap === null ? null : { label: 'Gap', html: gapOf(gap).text },
  };
}

// ------------------------------------------ where a season luck cell comes from
//
// Tim, 2026-10-05: "If the user hovers over this number however, you can show
// them a preview of each of the three numbers". PTW, Close luck, Luck score,
// Skill and S+L: a label and a number per row, adding up to the cell
// (`standingsExplain` in js/standings-table.js, where the rows are formed and
// where the adding up is kept exact). No sentences: the definitions are behind
// "What the columns mean".

function explainSpec(teamId, key) {
  const team = state.stats && state.stats.teams.find((t) => String(t.id) === String(teamId));
  const ex = team ? standingsExplain(state.stats, team, key) : null;
  if (!ex) return null;
  const num = (r) => (r.signed ? signed(r.value) : fmt(r.value));
  // Luck score and Skill are on the colour scale (2026-10-08), and a colour
  // never goes without its words: where the figure stands, under the parts.
  let foot = '';
  if (key === 'luckScore' || key === 'skill') {
    const scale = heatScale(state.stats.teams.filter((t) => t.weekly.length).map((t) => t[key]).filter(isNum));
    const place = standingWords(team[key], scale);
    // The standing alone: "League avg" is already a row of the Luck score's
    // parts, where it means the league's scoring.
    if (place) foot = place;
  }
  return {
    title: team.name,
    sub: ex.label,
    rows: ex.rows.map((r) => ({ label: r.label, html: num(r) })),
    total: { label: ex.mean ? 'Average' : ex.foot.label, html: num(ex.foot) },
    foot,
  };
}

// ------------------------------------------------- a preview on every number
//
// Tim, 2026-10-08: "If the user is curious about a number or it's breakdown …
// they should be able to hover over it and show a preview", and "connectors to
// other places in the cite using previews". Every card below is built when it
// is asked for (`wirePops` with a `card` function), from figures the page
// already holds: nothing is registered, nothing is read from ESPN, and nothing
// here talks about the colour scale — a card says where a number came from and
// where it stands, in points and places (docs/previews-plan.md, Stats).

const teamOfId = (id) => (state.stats
  ? state.stats.teams.find((t) => String(t.id) === String(id)) || null
  : null);
const teamName = (id) => { const t = teamOfId(id); return t ? t.name : '—'; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** "Won 131.2–118.4", the team's own score first. */
const resultText = (r) => `${r.tied ? 'Tied' : r.won ? 'Won' : 'Lost'} ${fmt(r.actual)}–${fmt(r.oppActual)}`;

/** "3rd highest of 10": the short count, so nobody has to ask which end is 1st. */
function standingWords(v, scale) {
  const st = heatStanding(v, scale);
  if (!st) return null;
  const top = st.rank <= st.lowRank;
  const r = top ? st.rank : st.lowRank;
  const end = top ? 'highest' : 'lowest';
  return `${r === 1 ? end[0].toUpperCase() + end.slice(1) : `${ordinal(r)} ${end}`} of ${st.of}`;
}

/** A team, in five lines, and the way to its roster. */
function teamSpec(t) {
  const s = state.stats;
  const heads = standingsHeadings(s);
  const played = t.weekly.length > 0 && !noGames();
  return {
    title: t.name,
    sub: played ? recordOf(t).text : '',
    rows: played ? [
      { label: heads.avg, value: t.avgActual },
      { label: 'Proj', value: t.avgProjected },
      { label: 'Total', html: pf(t.totalActual) },
      ...(isNum(t.luckScore) ? [{ label: 'Luck score', html: signed(t.luckScore) }] : []),
      ...(isNum(t.actualStanding) ? [{ label: 'Standing', value: `${ordinal(t.actualStanding)} of ${s.teams.length}` }] : []),
    ] : [],
    href: teamHref(t.id),
    hrefLabel: 'Open roster',
  };
}

// The standings columns that are one number per week, averaged (or summed):
// the weeks are the card.
const WEEK_COLUMNS = {
  avg: { of: (t) => t.avgActual, wk: (r) => r.actual, head: 'Scored' },
  proj: { label: 'Proj', of: (t) => t.avgProjected, wk: (r) => r.projected, head: 'Proj' },
  total: { label: 'Total', of: (t) => t.totalActual, wk: (r) => r.actual, head: 'Scored', show: (v) => pf(v) },
  oppAvg: { of: (t) => t.oppAvgActual, wk: (r) => r.oppActual, head: 'They scored' },
  fa: { label: 'F−A', of: (t) => t.forMinusAgainst, wk: (r) => r.actualDiff, head: 'Margin', sign: true },
  luckWk: { label: 'Luck/wk', of: (t) => t.avgLuck, wk: (r) => r.luck, head: 'Act−Proj', sign: true },
  spread: { label: 'Spread', of: (t) => t.actualStdev, wk: (r) => r.actual, head: 'Scored' },
};
const RANK_COLUMNS = {
  ls: { label: 'LS', by: 'luckStanding', sub: 'by luck score', show: (t) => signed(t.luckScore) },
  ps: { label: 'PS', by: 'projectedStanding', sub: 'by skill + luck', show: (t) => signed(t.skillPlusLuck) },
  as: { label: 'AS', by: 'actualStanding', sub: 'by record', show: (t) => recordOf(t).text },
};

/** One cell of the standings table that is not one of `explainSpec`'s five. */
function cellSpec(teamId, key) {
  const s = state.stats;
  const t = teamOfId(teamId);
  if (!s || !t) return null;
  if (key === 'name') return teamSpec(t);
  const heads = standingsHeadings(s);
  const link = { href: teamHref(t.id), hrefLabel: 'Open roster' };
  const withGames = s.teams.filter((x) => x.weekly.length);

  if (key === 'record') {
    const rec = recordOf(t);
    return {
      title: t.name,
      sub: 'W–L',
      head: ['Wk', 'Opponent', 'Result'],
      rows: t.weekly.map((r) => ({ lead: r.week, label: `vs ${teamName(r.oppId)}`, value: resultText(r) })),
      total: { label: 'W–L', value: rec.text },
      // Rule 7: the basis of a record with a game in play.
      foot: rec.live ? rec.title : '',
      ...link,
    };
  }

  const col = WEEK_COLUMNS[key];
  if (col) {
    if (!t.weekly.length) return null;
    const label = col.label || (key === 'avg' ? heads.avg : heads.oppAvg);
    const show = col.show || (col.sign ? signed : fmt);
    const scale = heatScale(withGames.map(col.of).filter(isNum));
    const place = standingWords(col.of(t), scale);
    return {
      title: t.name,
      sub: label,
      head: ['Wk', 'Opponent', col.head],
      rows: t.weekly.map((r) => ({
        lead: r.week,
        label: `vs ${teamName(r.oppId)}`,
        html: col.sign ? signed(col.wk(r)) : fmt(col.wk(r)),
      })),
      totals: [
        ...(scale ? [{ label: 'League avg', html: show(scale.mean) }] : []),
        ...(place ? [{ label: 'Rank', value: place }] : []),
      ],
      total: { label, html: isNum(col.of(t)) ? show(col.of(t)) : dash },
      ...link,
    };
  }

  if (key === 'oppProj') {
    const data = state.oppProj;
    const o = data && data.byTeam ? data.byTeam.get(t.id) : null;
    if (!o) return null;
    const scale = heatScale(oppRows().map((r) => r.avgOpp));
    const place = standingWords(o.avgOpp, scale);
    return {
      title: t.name,
      sub: 'Opp proj',
      rows: [{ label: 'Games on the schedule', value: String(o.games) }],
      totals: [
        ...(isNum(data.leagueAvg) ? [{ label: 'League avg', value: data.leagueAvg }] : []),
        ...(place ? [{ label: 'Rank', value: place }] : []),
      ],
      total: { label: 'Opp proj', value: o.avgOpp },
    };
  }

  const rank = RANK_COLUMNS[key];
  if (rank) {
    const order = withGames.filter((x) => isNum(x[rank.by])).sort((a, b) => a[rank.by] - b[rank.by]);
    if (!order.length) return null;
    return {
      title: t.name,
      sub: `${rank.label} · ${rank.sub}`,
      rows: order.map((x) => ({ lead: x[rank.by], label: x.name, html: rank.show(x) })),
    };
  }
  return null;
}

/**
 * One week of the league: its games, and what the ten averaged.
 * `link` is off for a column heading, whose click sorts.
 */
function weekSpec(week, { link = true } = {}) {
  const s = state.stats;
  if (!s) return null;
  const w = Number(week);
  const seen = new Set();
  const rows = [];
  for (const t of s.teams) {
    const r = t.weekly.find((x) => x.week === w);
    if (!r || seen.has(t.id)) continue;
    seen.add(t.id);
    seen.add(r.oppId);
    // The winner first, so the score reads the way the sentence does.
    const flip = r.actual < r.oppActual;
    const [a, b] = flip ? [teamName(r.oppId), t.name] : [t.name, teamName(r.oppId)];
    const [x, y] = flip ? [r.oppActual, r.actual] : [r.actual, r.oppActual];
    rows.push({ label: `${a} ${r.tied ? 'tied' : 'beat'} ${b}`, value: `${fmt(x)}–${fmt(y)}` });
  }
  if (!rows.length) return null;
  const lg = w === partWeek() ? null : s.weeklyLeagueAverages.find((a) => a.week === w);
  return {
    title: `Week ${w}`,
    rows,
    totals: lg ? [
      { label: 'League avg', value: lg.avgActual },
      { label: 'Avg projected', value: lg.avgProjected },
    ] : [],
    ...(link ? { href: weekHref(w), hrefLabel: 'Open week' } : {}),
  };
}

// What `renderWeeklyTable` last drew, for the cards of its cells: the measure
// on the grid, its value for a row, and the scale each week was coloured by.
let grid = null;
const GRID_LABEL = {
  actual: 'Actual', projected: 'Projected', luck: 'Luck', luckProj: 'Act−Proj',
  luckOpp: 'Opp scoring', luckClose: 'Close game', actualDiff: 'Margin',
};

/**
 * One cell of the week-by-week grid — the preview Tim named (2026-10-08): the
 * team and week, the opponent and the result, Proj / Scored / Difference, the
 * league that week and where the cell ranks in it. Under a luck button the
 * week's three parts follow, adding up to the week's luck; a week past the
 * single-week limit says what it counts as.
 */
function gridSpec(teamId, week) {
  const t = teamOfId(teamId);
  const r = t && grid ? t.weekly.find((x) => x.week === Number(week)) : null;
  if (!r) return null;
  const { metric } = grid;
  const v = grid.valueOf(r);
  const scale = grid.weekScales.get(r.week) || null;
  const st = isNum(v) ? heatStanding(v, scale) : null;
  const show = grid.useSign ? signed : fmt;
  const luckView = metric in LUCK_PART;
  const p = luckView ? grid.partsOf(r) : null;
  const what = metric === 'actual' ? '' : ` ${GRID_LABEL[metric].toLowerCase()}`;
  return {
    title: t.name,
    sub: `Week ${r.week}`,
    rows: [
      { label: `vs ${teamName(r.oppId)}`, value: resultText(r) },
      { label: 'Proj', value: r.projected },
      { label: 'Scored', value: r.actual },
      { label: 'Difference', html: signed(r.actual - r.projected) },
      ...(metric === 'actualDiff' ? [{ label: 'Margin', html: signed(r.actualDiff) }] : []),
      ...(p ? [
        { label: 'Opp scoring', html: signed(p.opp) },
        { label: 'Act−Proj', html: signed(p.proj) },
        { label: 'Close game', html: p.close === null ? 'tie' : signed(p.close) },
      ] : []),
    ],
    totals: [
      ...(p ? [{ label: 'Luck', html: signed(p.total) }] : []),
      ...(metric === 'luck' && grid.capped(r) ? [{ label: 'Counts as', html: signed(r.weekLuckCounted, 0) }] : []),
      ...(st ? [
        // Under any button but Actual the two lines say which measure they are of.
        { label: what ? `League${what}` : 'League that week', html: show(st.mean) },
        { label: what ? `Rank by${what}` : 'Rank that week', value: `${ordinal(st.rank)} of ${st.of}` },
      ] : []),
    ],
    href: teamHref(t.id, r.week),
    hrefLabel: 'Open roster',
  };
}

/** The grid's trailing Avg: the weeks it is the average of. */
function gridAvgSpec(teamId) {
  const t = teamOfId(teamId);
  if (!t || !grid || !t.weekly.length) return null;
  const show = grid.useSign ? signed : fmt;
  const avg = grid.teamAvg(t);
  const place = isNum(avg) ? standingWords(avg, grid.avgScale) : null;
  return {
    title: t.name,
    sub: GRID_LABEL[grid.metric],
    head: ['Wk', 'Opponent', GRID_LABEL[grid.metric]],
    rows: t.weekly.map((r) => {
      const v = grid.countedOf(r);
      return { lead: r.week, label: `vs ${teamName(r.oppId)}`, html: isNum(v) ? show(v) : dash };
    }),
    totals: [
      ...(grid.avgScale ? [{ label: 'League avg', html: show(grid.avgScale.mean) }] : []),
      ...(place ? [{ label: 'Rank', value: place }] : []),
    ],
    total: { label: 'Average', html: isNum(avg) ? show(avg) : dash },
    href: teamHref(t.id),
    hrefLabel: 'Open roster',
  };
}

/** Every finished game once, from the weekly rows the page holds. */
function gamesPlayed() {
  const out = [];
  const seen = new Set();
  for (const t of state.stats.teams) {
    for (const r of t.weekly) {
      const id = `${r.week}:${[String(t.id), String(r.oppId)].sort().join(':')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ week: r.week, proj: r.projected, oppProj: r.oppProjected, pts: r.actual, oppPts: r.oppActual });
    }
  }
  return out;
}

/**
 * One row of Projection accuracy, week by week: "3 of 5" right. The games are
 * counted here by the rule js/stats.js states (`predictionAccuracy`), and the
 * card is offered only when that count is the row's own — a card that disagreed
 * with the table it hangs off would be worse than none.
 */
function accSpec(threshold) {
  const s = state.stats;
  const t = Number(threshold);
  const bucket = s && s.predictionAccuracy.find((a) => a.threshold === t);
  if (!bucket || !bucket.games) return null;
  const counted = gamesPlayed().filter((g) => g.proj > 0 && g.oppProj > 0 &&
    g.proj !== g.oppProj && Math.abs(g.proj - g.oppProj) > t);
  const right = (g) => (g.proj > g.oppProj) === (g.pts > g.oppPts);
  if (counted.length !== bucket.games || counted.filter(right).length !== bucket.correct) return null;
  const weeks = [...new Set(counted.map((g) => g.week))].sort((a, b) => a - b);
  return {
    title: 'Projection accuracy',
    sub: t === 0 ? 'all games' : `projected gap over ${t}`,
    rows: weeks.map((w) => {
      const of = counted.filter((g) => g.week === w);
      return { label: `Week ${w}`, value: `${of.filter(right).length} of ${of.length}` };
    }),
    total: {
      label: 'Favourite won',
      value: `${bucket.correct} of ${bucket.games}` +
        (bucket.accuracy === null ? '' : ` · ${Math.round(bucket.accuracy * 100)}%`),
    },
  };
}

/** A tile of the glance row: who, and when. */
function glanceSpec(kind) {
  const s = state.stats;
  if (!s || noGames()) return kind === 'schedule' ? scheduleSpec() : null;
  if (kind === 'leagueAvg' || kind === 'leagueProj') {
    const key = kind === 'leagueAvg' ? 'avgActual' : 'avgProjected';
    const part = partWeek();
    return {
      title: kind === 'leagueAvg' ? 'League avg' : 'Avg projected',
      sub: 'a team, a week',
      rows: s.weeklyLeagueAverages.filter((a) => a.week !== part)
        .map((a) => ({ label: `Week ${a.week}`, value: a[key] })),
      total: { label: 'All weeks', value: kind === 'leagueAvg' ? s.leagueAvgActual : s.leagueAvgProjected },
    };
  }
  if (kind === 'high' || kind === 'low') {
    const all = s.teams.flatMap((t) => t.weekly.map((r) => ({ t, r })))
      .sort((a, b) => (kind === 'high' ? b.r.actual - a.r.actual : a.r.actual - b.r.actual));
    if (!all.length) return null;
    return {
      title: kind === 'high' ? 'Highest week' : 'Lowest week',
      head: ['Wk', 'Team', 'Scored'],
      rows: all.slice(0, 3).map(({ t, r }) => ({ lead: r.week, label: t.name, value: r.actual })),
      href: teamHref(all[0].t.id, all[0].r.week),
      hrefLabel: 'Open roster',
    };
  }
  if (kind === 'record') {
    const top = [...s.teams].sort(byRecord)[0];
    return top ? cellSpec(top.id, 'record') : null;
  }
  if (kind === 'schedule') return scheduleSpec();
  if (kind === 'accuracy') return accSpec(0);
  return null;
}

/** The Hardest schedule tile: everyone's run of opponents, hardest first. */
function scheduleSpec() {
  const rest = restRows();
  const rows = rest.length ? rest : oppRows();
  if (!rows.length) return null;
  return {
    title: 'Hardest schedule',
    sub: rest.length ? 'rest of season' : 'whole season',
    head: ['Team', 'Opponents’ proj'],
    rows: rows.map((r) => ({ label: r.name, value: r.avgOpp })),
  };
}

/** The two numbers over each scatter, in one plain line each. */
const FIT_LINES = {
  R2: ['R²', 'How closely scores follow projections: 1 is exactly, 0 is not at all.'],
  Gap: ['Off perfect', 'How far the scores sit from their projections, in points. 0 is spot on.'],
};
function fitSpec(el) {
  const v = el.querySelector('.v');
  const kind = v && /R2$/.test(v.id) ? 'R2' : 'Gap';
  if (!v || v.textContent.trim() === '—') return null;
  return { title: FIT_LINES[kind][0], sub: v.textContent.trim(), foot: FIT_LINES[kind][1] };
}

/** One bar of Score distribution: the scores in it, highest first. */
const DIST_ROWS = 10;
function distSpec(i) {
  const s = state.stats;
  const bin = s && s.distribution10.bins[i];
  if (!bin) return null;
  const lo = parseInt(bin, 10);
  const all = s.teams.flatMap((t) => t.weekly.map((r) => ({ t, r })))
    .filter(({ r }) => r.actual >= lo && r.actual < lo + 10)
    .sort((a, b) => b.r.actual - a.r.actual);
  if (!all.length) return null;
  return {
    title: bin,
    sub: plural(all.length, 'score'),
    head: ['Wk', 'Team', 'Scored'],
    rows: all.slice(0, DIST_ROWS).map(({ t, r }) => ({ lead: r.week, label: t.name, value: r.actual })),
    foot: all.length > DIST_ROWS ? `and ${all.length - DIST_ROWS} more` : '',
  };
}

// ------------------------------------------------ arriving from another page
//
// `stats.html?team=7` (js/links.js `statsHref`) is a card somewhere else on the
// site saying "this team, in the standings". The row is outlined and brought
// into view. It is NOT the "My team" choice — that is a saved preference, and a
// link must not rewrite it — so it lasts for this visit only.

const linkedTeam = readParam('team');
// THE LANDING lasts until the reader touches the page. The table is painted
// several times on the way in — the sample first, then the league, then again
// as lazy reads arrive — and the panels above it grow each time, so one scroll
// on the first paint leaves the row wherever the later ones pushed it. Each
// paint therefore puts it back, after the rest of that paint has landed; the
// first scroll, tap or key of the reader's own ends it for good, so nothing
// ever drags the page out from under him.
let landing = linkedTeam !== null;
if (landing && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const stop = () => { landing = false; };
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, stop, { passive: true, once: true });
  }
}

function markLinkedRow() {
  if (linkedTeam === null) return;
  const row = [...$('mainTable').querySelectorAll('tbody tr')].find((tr) => {
    const cell = tr.querySelector('[data-team]');
    return (tr.dataset.team ?? (cell ? cell.dataset.team : null)) === linkedTeam;
  });
  if (!row) return;
  row.classList.add('linked');
  if (!landing) return;
  setTimeout(() => {
    const now = $('mainTable').querySelector('tbody tr.linked');
    if (landing && now && typeof now.scrollIntoView === 'function') now.scrollIntoView({ block: 'center' });
  }, 0);
}

/** What the number is, that it needs no games, how it was derived, and over what. */
function oppNote(rows, data) {
  const weeks = data.rest.weeks;
  const span = restSpan(weeks);

  const fixtures = rows.map((r) => r.games);
  const loF = Math.min(...fixtures);
  const hiF = Math.max(...fixtures);
  const perTeam =
    loF === hiF ? `${plural(loF, 'fixture')} each` : `${loF}–${hiF} fixtures each`;

  const values = rows.map((r) => r.avgOpp);
  const spread = Math.max(...values) - Math.min(...values);

  const lines = [
    '<strong>The average projected score of the opponents you still have to play.</strong> ' +
      'For every fixture left on your schedule, take what the other side is projected to ' +
      'score that week, then average those. High means a hard run-in — which is ' +
      'luck, not skill: nobody picks their own opponents.',

    '<strong>Rest of season only.</strong> A week that is finished or being played is left ' +
      'out, so nothing here repeats a result shown elsewhere. The Opp proj column in the ' +
      'standings is the whole season.',

    'Each ' +
      'weekly number is ESPN&rsquo;s own per-player projection for that week, with the ' +
      `best legal lineup filled for every team (${plural(data.starters, 'starter')})` +
      (data.countsKnown
        ? ', using the starting slots read off the league&rsquo;s own lineups'
        : ' — the league&rsquo;s slot counts could not be read off its lineups, so a ' +
          'standard lineup is assumed and a league with unusual slots will be a little out') +
      `. Those team totals are then averaged over ${span}: ${perTeam}.` +
      (data.floorSaid ? ` ${data.floorSaid}` : ''),
  ];

  if (typeof data.rest.leagueAvg === 'number') {
    lines.push(
      `The league&rsquo;s average opponent is <strong>${fmt(data.rest.leagueAvg)}</strong>, so ` +
        'the figure beside each bar is the gap from that: a positive number is that many ' +
        'points a week easier than the league&rsquo;s typical schedule, a negative one that ' +
        'much harder.',
      'The bar is that gap, drawn from the line down the middle: right and green for an ' +
        'easier schedule than the league&rsquo;s, left and red for a harder one. Hardest to ' +
        `easiest spans ${fmt(spread)} points; the longest bar is the biggest gap.`
    );
  }

  // The same gaps are also shown, above the toggle, by renderOppPanel().
  lines.push(...oppGaps(data, rows));

  return paras(lines);
}

/** What the schedule-luck numbers are missing, in words. Empty when complete. */
function oppGaps(data, rows = oppRows()) {
  if (!data || data.error || !data.byTeam || !state.stats) return [];
  const out = [];
  const weeks = data.projectedWeeks || [];
  const missing = (data.scheduleWeeks || []).filter((w) => !weeks.includes(w));
  if (missing.length) {
    out.push(
      `ESPN would not return rosters for ${plural(missing.length, 'week')} ` +
        `(${missing.join(', ')}), so those fixtures are left out of every average above ` +
        'rather than counted as zero.'
    );
  }

  const missingTeams = state.stats.teams.length - rows.length;
  if (rows.length && missingTeams > 0) {
    out.push(
      `${plural(missingTeams, 'team')} could not be projected at all and ${
        missingTeams === 1 ? 'is' : 'are'
      } left out of the ranking and of the league average.`
    );
  }
  return out;
}

// ------------------------------------ roster strength and future proj diff
//
// Tim, 2026-10-08: "right now roster stength shows numbers closer to 100,
// which is hard to understand because most of the time we're proj around
// 120-130. Could you fix it so it matches our future avg proj like in the
// analysis section? Also move it to the stats section right next to the
// schedule luck box. Additionally show a future proj dif box that has the avg
// proj difference between you and you're opponents as the proj stands right
// now."
//
// Both are made of ONE thing: every squad's best legal lineup in each week
// still to play, added up (`lineupWeekTotals`, js/lineup-avg.js — the function
// the Analysis page's Weekly totals come out of, so a week here and a week
// there are the same number). Roster strength is those weeks averaged; the
// diff is, game by game, that week's total minus the opponent's, averaged.
//
// THE WEEKS ARE SCHEDULE LUCK'S OWN (`restWeeks` in `buildOppProj`), so the
// three boxes on the line cover the same span and say so in their headings.
// THE ROSTERS ARE ITS OWN TOO: nothing more is asked of ESPN.
//
// Drawn as the box beside them is — the same `.oppbars` rows — with the
// number on the house red→green scale, each box against its own ten values.
// The number opens the weeks behind it in the page's one preview card.

/** week totals → the two boxes' numbers. */
function buildFuture(schedule, weekTeams, restWeeks, floors) {
  const ids = state.stats.teams.map((t) => t.id);
  const totals = lineupWeekTotals(weekTeams, restWeeks, floors);
  const weeks = restWeeks.filter((w) => totals.has(w));
  return {
    weeks,
    strength: futureAverages(totals, weeks, ids),
    diff: futureDiffs(schedule.games, totals, weeks, ids),
  };
}

/** The two boxes: where each draws, what its rows are and what its number says. */
const FUTURE_BOXES = [
  {
    kind: 'strength', chart: 'strengthChart', note: 'strengthNote', key: 'strengthKey', span: 'strengthSpan',
    label: 'the weeks behind this number',
    text: (v) => fmt(v),
    what: 'the other teams’ lineups',
    weeksOf: (got) => got.weeks.map((x) => x.week),
  },
  {
    kind: 'diff', chart: 'projDiffChart', note: 'projDiffNote', key: 'projDiffKey', span: 'projDiffSpan',
    label: 'the games behind this number',
    text: (v) => gapOf(v).text,
    what: 'the other teams’ gaps',
    weeksOf: (got) => got.games.map((x) => x.week),
  },
];

/** A box's rows, best first: sorted on the unrounded mean, printed to the tenth. */
function futureRows(kind) {
  const d = state.oppProj;
  const byTeam = d && !d.error && d.future ? d.future[kind] : null;
  if (!byTeam || !state.stats) return [];
  return state.stats.teams
    .map((t) => {
      const got = byTeam.get(t.id);
      return got && typeof got.avg === 'number'
        ? { id: t.id, name: t.name, record: record(t), value: got.avg, raw: got.raw, got }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.raw - a.raw);
}

function renderFuturePanels() {
  for (const box of FUTURE_BOXES) {
    const chart = $(box.chart);
    const note = $(box.note);
    if (!chart || !note) continue;
    wirePops(chart, { selector: '.vv[data-fut]', card: (el) => futurePopSpec(el.dataset.fut, el.dataset.team) });
    const key = $(box.key);
    const said = $(box.span);
    const plain = (html) => {
      chart.innerHTML = html;
      note.textContent = '';
      if (said) said.textContent = '';
      if (key) { key.textContent = ''; setHidden(key, true); }
      tuckIfEmpty(box.note);
    };

    const d = state.oppProj;
    if (state.oppPending || !d) { plain('<p class="empty">Loading the schedule&hellip;</p>'); continue; }
    if (d.error) { plain('<p class="empty">No projections to rank.</p>'); continue; }
    const rows = futureRows(box.kind);
    if (!rows.length) { plain('<p class="empty">No weeks left to play.</p>'); continue; }

    const span = restSpan([...new Set(rows.flatMap((r) => box.weeksOf(r.got)))].sort((a, b) => a - b));
    if (said) said.textContent = span ? ` (${span})` : '';
    const scale = heatScale(rows.map((r) => r.value));
    chart.innerHTML = futureBars(box, rows, scale);
    if (key) {
      key.innerHTML = scale ? '<strong>Green is above the league, red below.</strong>' : '';
      setHidden(key, !scale);
    }
    note.innerHTML = futureNote(box, rows, scale, d);
    tuckIfEmpty(box.note);
  }
}

/** The rows, in the markup of the schedule-luck bars beside them. */
function futureBars(box, rows, scale) {
  // From the zero line (see "bars from a zero line"): the diff is its own
  // figure; strength is the figure against the league's average of them.
  const values = rows.map((r) => r.value);
  const league = values.reduce((a, v) => a + v, 0) / (values.length || 1);
  const bars = zeroBars(box.kind === 'strength' ? values.map((v) => v - league) : values);
  const items = rows.map((r, i) => {
    const h = heatOf(r.value, scale, { what: box.what });
    // The mark has a slot in every row, so the numbers end in one place.
    const mark = (h && heatMarkHtml(h)) || ' <span class="heatmark" aria-hidden="true"></span>';
    const num = h ? `<span class="${h.cls}">${box.text(r.value)}</span>` : box.text(r.value);
    return `<li class="${state.highlight === r.id ? 'me' : ''}">
        <span class="rk">${i + 1}</span>
        <span class="nm">${esc(r.name)} <small class="muted rec">${r.record}</small></span>
        ${zeroBarHtml(bars[i])}
        <span class="vv" data-fut="${box.kind}" data-team="${esc(r.id)}" data-v="${r.value}" tabindex="0" role="button" ` +
          `aria-label="${esc(r.name)}: ${box.label}">${num}${mark}</span>
      </li>`;
  }).join('');
  return `<ol class="oppbars one">${items}</ol>`;
}

/** The preview behind a number: its weeks, then their average — the number. */
function futurePopSpec(kind, teamId) {
  const d = state.oppProj;
  const team = state.stats && state.stats.teams.find((t) => String(t.id) === String(teamId));
  const got = team && d && d.future && d.future[kind] ? d.future[kind].get(team.id) : null;
  if (!got) return null;
  const card = (weeks, tableHtml) => ({
    title: team.name, sub: restSpan(weeks), tableHtml, href: teamHref(team.id), hrefLabel: 'Open roster',
  });
  if (kind === 'strength') {
    const rows = got.weeks.map((x) =>
      `<tr><td class="num">${x.week}</td><td class="num">${fmt(x.total)}</td></tr>`).join('');
    return card(got.weeks.map((x) => x.week),
      '<table class="sc-rows"><thead><tr><th class="num">Wk</th><th class="num">Proj</th></tr></thead>' +
      `<tbody>${rows}</tbody><tfoot>` +
      `<tr class="sc-total"><td class="name">Average</td><td class="num">${fmt(got.avg)}</td></tr>` +
      '</tfoot></table>');
  }
  const nameOf = (id) => {
    const t = state.stats.teams.find((x) => x.id === id);
    return t ? t.name : '—';
  };
  const rows = got.games.map((x) =>
    `<tr><td class="num">${x.week}</td><td class="name">${esc(nameOf(x.oppId))}</td>` +
    `<td class="num">${fmt(x.own)}</td><td class="num">${fmt(x.opp)}</td>` +
    `<td class="num">${gapOf(x.gap).text}</td></tr>`).join('');
  return card(got.games.map((x) => x.week),
    '<table class="sc-rows"><thead><tr><th class="num">Wk</th><th class="name">Opponent</th><th class="num">Proj</th>' +
    '<th class="num">Opp proj</th><th class="num">Gap</th></tr></thead>' +
    `<tbody>${rows}</tbody><tfoot>` +
    `<tr class="sc-total"><td></td><td class="name">Average</td><td class="num">${fmt(got.own)}</td>` +
    `<td class="num">${fmt(got.opp)}</td><td class="num">${gapOf(got.avg).text}</td></tr>` +
    '</tfoot></table>');
}

/** What the number is and what it is made of (rule 7), behind the toggle. */
function futureNote(box, rows, scale, data) {
  const span = restSpan([...new Set(rows.flatMap((r) => box.weeksOf(r.got)))].sort((a, b) => a - b));
  const lines = box.kind === 'strength'
    ? [
      '<strong>What each team&rsquo;s lineup is projected to score in an average week from here.</strong> ' +
        'For every week still to play, the best legal lineup from the roster as it stands is filled ' +
        'from ESPN&rsquo;s projections for that week — so a bye moves the next man in — and added up; ' +
        `those week totals are then averaged over ${span}.`,
      'They are the same week totals the <a href="analysis.html">Analysis</a> page shows under ' +
        'Weekly totals for the weeks still to come. Tap or hover a number for its weeks.',
    ]
    : [
      '<strong>How far ahead of its opponents each team is projected, per game.</strong> ' +
        'For every game still to play, the team&rsquo;s projected lineup total that week minus its ' +
        `opponent&rsquo;s, as the projections stand now; those gaps are then averaged over ${span}. ` +
        'A plus means the team is projected to outscore the teams it still has to play.',
      'The week totals are Roster strength&rsquo;s own. Tap or hover a number for its games.',
    ];
  lines.push(box.kind === 'strength'
    ? 'The bar is the figure against the league&rsquo;s average of these figures, drawn from the ' +
      'line down the middle: right and green above the league, left and red below it. The number ' +
      'printed is the average itself.'
    : 'The bar is the figure, drawn from the line down the middle: right and green for a plus, ' +
      'left and red for a minus.');
  if (data.floorSaid) lines.push(data.floorSaid);
  if (scale) {
    lines.push(`<strong>The colours.</strong> ${describeHeat(scale, {
      what: box.kind === 'strength' ? 'the other teams’ lineups' : 'the other teams’ gaps',
      high: box.kind === 'strength' ? 'a stronger squad' : 'a bigger edge',
      low: box.kind === 'strength' ? 'a weaker one' : 'a smaller one',
    })}`);
  }
  return paras(lines);
}

function renderAccuracy() {
  const acc = state.stats.predictionAccuracy;
  const table = $('accuracyTable');
  const tbody = table.querySelector('tbody');

  // An empty bucket is a row of zeroes pretending to be a finding, and early in
  // a season most of them are empty.
  const rows = acc.filter((a) => a.games > 0);
  // Every cell of a row opens the games it counted, week by week (`accSpec`).
  const accAttr = (a) => ` data-acc="${a.threshold}" tabindex="0"`;
  wirePops(table, { selector: 'td[data-acc]', card: (el) => accSpec(el.dataset.acc) });

  tbody.innerHTML = rows.length
    ? rows
        .map((a) => `
          <tr>
            <td class="name" data-v="${a.threshold}"${accAttr(a)}>${a.label}</td>
            <td${accAttr(a)}>${a.games}</td>
            <td${accAttr(a)}>${a.correct}</td>
            <td data-v="${a.accuracy === null ? '' : a.accuracy}"${accAttr(a)}>${
              a.accuracy === null ? dash : `${Math.round(a.accuracy * 100)}%`}</td>
          </tr>`)
        .join('')
    : '<tr><td class="name" colspan="4">No completed games yet.</td></tr>';

  enableSort(table);
  resort(table);

  const notes = [];
  const ties = acc.tiedProjections || 0;
  if (ties) {
    notes.push(
      `${plural(ties, 'game')} had both teams projected identically, so the ` +
      'projection made no pick there. Those are excluded.'
    );
  }
  $('accuracyNote').textContent = notes.join(' ');
}

// ------------------------------------------- projected against actual (dots)

//
// Two scatters (Tim, 2026-10-04): across is what was projected, up is what was
// scored. One dot per team per finished week, and one per rostered player per
// finished week. On each, a dotted line where a perfect projection would put
// every dot, and the solid least-squares line the dots actually make.
//
// WHERE THE NUMBERS COME FROM, and why neither graph costs a request:
//   teams    `state.stats` — the weekly rows behind the Proj and Avg columns,
//            Weekly luck and the Projection accuracy table beside this.
//   players  the weekly rosters the Schedule-luck read already brought back
//            (`state.weekTeams`). On a real league those weeks are held in the
//            store, so walking here from another page re-buys nothing.
//
// A hovered or tapped dot opens a preview that is a link: a team to its roster
// on Analysis in that week, a player to the Players page in that week.

/** What the line says, in words, for the note behind the toggle. */
function fitWords(fit, n, only = '') {
  if (!fit) {
    return 'There is no solid line yet: a line needs at least two dots that differ in ' +
      'their projection.';
  }
  const b = fit.slope;
  const a = fit.intercept;
  const lean = Math.abs(b - 1) < 0.05
    ? 'About 1: a point more projected has meant about a point more scored.'
    : b < 1
      ? 'Under 1: big projections have come in low and small ones high.'
      : 'Over 1: big projections have been beaten and small ones missed.';
  const count = n.toLocaleString('en-US');
  return `<strong>Solid line</strong> = the least-squares line through ` +
    (only ? `the ${count} highlighted dots (${esc(only)})` : `these ${count} dots`) +
    `, the straight line with the smallest total squared miss: actual = ` +
    `${a < 0 ? '−' : ''}${Math.abs(a).toFixed(1)} + ${b.toFixed(2)} × projected. ` +
    'The first number is what a projection of 0 would score on this line; the slope is the ' +
    'points scored per extra point projected. ' +
    `<strong>Slope ${b.toFixed(2)}.</strong> ${lean}` +
    (fit.r === null
      ? ''
      : ` <strong>r = ${fit.r.toFixed(2)}</strong>, so the projection accounts for ` +
        `${Math.round(fit.r * fit.r * 100)}% of the differences in score (r²); 1 would be ` +
        'every dot on one line, 0 no relation at all.');
}

const FIT_PERFECT_LINE =
  '<strong>Dotted line</strong> = actual equals projected, where a perfect projection would ' +
  'put every dot. Above it beat the projection, below it fell short.';
const FIT_PERFECT = `${FIT_PERFECT_LINE} Both axes share one scale, so the dotted line is a true diagonal.`;
// The teams graph is ZOOMED TO FIT (docs/charts-plan.md A4): team projections
// sit within a few points of each other while scores range widely, and on one
// shared scale the dots were a stripe a quarter of the graph wide.
const FIT_PERFECT_ZOOMED = `${FIT_PERFECT_LINE} Each axis is fitted to its own numbers so the ` +
  'dots fill the graph: across covers the projections, up covers the scores. The dotted line ' +
  'is still actual = projected, but it is steeper than a corner-to-corner diagonal here.';

// The two numbers above each graph, and their basis (rule 7).
const FIT_NUMBERS =
  '<strong>R²</strong> = how closely the dots follow the solid line: r squared, the share of ' +
  'the differences in score that line accounts for. 1 = every dot on it, 0 = no relation. ' +
  '<strong>Off perfect</strong> = how far the solid line sits from the dotted one: the ' +
  'up-and-down gap between the two, in points, averaged over every dot&rsquo;s projection. ' +
  '0 = the lines coincide. Both use the dots the solid line is fitted to.';

const FIT_GROUPS =
  '<strong>Colour by</strong> colours the dots by group. Press a group under the graph to ' +
  'highlight it: the others dim and cannot be opened, and the solid line, R² and Off perfect ' +
  'are refitted to that group alone. Press it again to clear.';

// ---- "Colour by" (Tim, 2026-10-04: "sorted by a variety of metricts. For
// example Position, User (team), week ... highlight these specific moments ...
// or just colorized (ex: RB-red, QB-green etc. ex: week 1-red, week 2-yellow)").
// The grouping is remembered per graph; the highlighted group is not.
const FIT_BY = { teams: ['none', 'team', 'week'], players: ['none', 'position', 'team', 'week'] };
const FIT_PREF = { teams: 'fitTeamsBy', players: 'fitPlayersBy' };
const fitBy = { teams: 'none', players: 'none' };
const fitFocus = { teams: null, players: null };
for (const which of Object.keys(fitBy)) {
  const saved = prefs.get(FIT_PREF[which], 'none');
  if (FIT_BY[which].includes(saved)) fitBy[which] = saved;
}

// A position keeps its colour whoever is on the graph (slots of SERIES_COLORS,
// from 0): RB red and QB green are Tim's own example.
const POSITION_SLOT = { QB: 6, RB: 9, WR: 0, TE: 1, K: 3, DST: 4 };
const POSITION_SPARE = [5, 7, 2, 8];
// A defence is 'DST' in the data and "D/ST" to a reader (as on the player card).
const POSITION_LABEL = { DST: 'D/ST' };

/** Weeks run in order along one hue ramp, red first, the latest week violet. */
const weekColor = (i, count) =>
  `hsl(${count > 1 ? Math.round((300 * i) / (count - 1)) : 0}, 70%, 60%)`;

/** The groups one "Colour by" choice makes: their order, labels, colours, and
 *  which one a dot belongs to. */
function fitGroups(by, pts) {
  const s = state.stats;
  if (by === 'team') {
    return {
      label: 'Team',
      // The same slot per team as the line charts above (seriesFor).
      groups: s.teams.map((t, i) => ({
        key: t.id, label: t.name, color: SERIES_COLORS[i % SERIES_COLORS.length],
      })),
      of: (p) => p.teamId,
    };
  }
  if (by === 'week') {
    const w = s.weekNumbers;
    return {
      label: 'Week',
      groups: w.map((wk, i) => ({ key: wk, label: `Wk ${wk}`, color: weekColor(i, w.length) })),
      of: (p) => p.week,
    };
  }
  const of = (p) => (p.position === 'D/ST' ? 'DST' : p.position || 'Other');
  const extra = [...new Set(pts.map(of))].filter((k) => !(k in POSITION_SLOT)).sort();
  return {
    label: 'Position',
    groups: [
      ...Object.keys(POSITION_SLOT).map((k) => ({
        key: k, label: POSITION_LABEL[k] || k, color: SERIES_COLORS[POSITION_SLOT[k]],
      })),
      ...extra.map((k, i) => ({
        key: k, label: k, color: SERIES_COLORS[POSITION_SPARE[i % POSITION_SPARE.length]],
      })),
    ],
    of,
  };
}

/** Draw one of the two graphs with its grouping; `after(svg, only)` repaints
 *  whatever follows the solid line (the two numbers, the note). */
function drawFit(which, box, pts, opts, after) {
  const by = fitBy[which];
  const g = by === 'none' ? null : fitGroups(by, pts);
  // A focus left over from other data (another league) names no dot here.
  if (!g || (fitFocus[which] != null &&
      !pts.some((p) => String(g.of(p)) === String(fitFocus[which])))) {
    fitFocus[which] = null;
  }
  const only = () => {
    const hit = g && fitFocus[which] != null
      ? g.groups.find((it) => String(it.key) === String(fitFocus[which]))
      : null;
    return hit ? hit.label : '';
  };
  const svg = scatterChart(box, {
    ...opts,
    points: g ? pts.map((p) => ({ ...p, group: g.of(p) })) : pts,
    groups: g ? g.groups : undefined,
    groupLabel: g ? g.label : undefined,
    focus: g ? fitFocus[which] ?? undefined : undefined,
    onFocus: (key, next) => { fitFocus[which] = key; after(next, only()); },
  });
  after(svg, only());
}

/** The two figures above a graph. A dash when there is no line, never NaN. */
function paintFitStats(prefix, svg) {
  const fit = (svg && svg.__ffFit) || null;
  const gap = svg ? svg.__ffGap : null;
  const r2 = $(`${prefix}R2`);
  const off = $(`${prefix}Gap`);
  if (r2) r2.textContent = fit && Number.isFinite(fit.r2) ? fit.r2.toFixed(2) : '—';
  if (off) off.textContent = Number.isFinite(gap) ? `${gap.toFixed(1)} pts` : '—';
}

function paintFitBy() {
  for (const which of Object.keys(fitBy)) {
    const seg = $(FIT_PREF[which]);
    if (!seg) continue;
    seg.querySelectorAll('button[data-by]').forEach((b) => {
      const on = b.dataset.by === fitBy[which];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
}

for (const which of Object.keys(fitBy)) {
  const seg = $(FIT_PREF[which]);
  if (seg) {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-by]');
      if (!btn || !FIT_BY[which].includes(btn.dataset.by)) return;
      fitBy[which] = btn.dataset.by;
      fitFocus[which] = null;           // another grouping clears the highlight
      prefs.set(FIT_PREF[which], fitBy[which] === 'none' ? null : fitBy[which]);
      renderFit();
    });
  }
}

// The player cards the dots have opened so far: "playerId:week" -> run key.
const fitRuns = new Map();
// The two numbers over each graph open one plain line (`fitSpec`).
if (typeof document.querySelectorAll === 'function') {
  document.querySelectorAll('.fit-stats').forEach((row) => wirePops(row, { selector: '.stat', card: fitSpec }));
}

function renderFit() {
  const s = state.stats;
  const teamsBox = $('chartFitTeams');
  const playersBox = $('chartFitPlayers');
  if (!s || !teamsBox || !playersBox) return;

  // Nothing played: no dot exists on either graph, so neither panel is offered.
  const none = noGames();
  show('panelFitTeams', !none);
  show('panelFitPlayers', !none);
  if (none) return;
  paintFitBy();

  const weeks = s.weekNumbers;
  const span = weeks.length === 1
    ? `week ${weeks[0]}`
    : `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
  const fitN = (svg) => ((svg && svg.__ffFitPoints) || []).length;

  // ---- teams ----
  const teamPts = teamFitPoints(s).map((p) => ({
    x: p.x,
    y: p.y,
    name: p.name,
    week: p.week,
    key: p.teamId,
    teamId: p.teamId,
    // Rule 9: the link carries the team id, never its label.
    href: `analysis.html?team=${encodeURIComponent(p.teamId)}&week=${encodeURIComponent(p.week)}#rosterDetail`,
  }));
  const teamCount = new Set(teamPts.map((p) => p.key)).size;
  drawFit('teams', teamsBox, teamPts, {
    xLabel: 'Projected',
    yLabel: 'Actual',
    height: 320,
    zoom: true,
    highlight: state.highlight ?? undefined,
    empty: 'No finished week has a projection yet',
  }, (svg, only) => {
    paintFitStats('fitTeams', svg);
    $('fitTeamsNote').innerHTML = teamPts.length
      ? paras([
        '<strong>Each dot is one team in one finished week.</strong> Across is ESPN&rsquo;s ' +
          'projection for the lineup it started; up is what that lineup scored. These are the ' +
          'numbers behind Proj, Avg and Weekly luck, so the graphs cannot disagree. ' +
          `${teamPts.length.toLocaleString('en-US')} dots: ${plural(teamCount, 'team')}, ${span}. ` +
          'Your team&rsquo;s dots are ringed when My team is set.',
        FIT_PERFECT_ZOOMED,
        fitWords(svg && svg.__ffFit, fitN(svg), only),
        FIT_NUMBERS,
        FIT_GROUPS,
        'Hover or tap a dot for the team and week; a click or tap anywhere on the graph then ' +
          'opens that roster on Analysis.',
      ])
      : '';
    tuckIfEmpty('fitTeamsNote');
  });

  // ---- players ----
  const held = state.weekTeams && state.weekTeams.key === scheduleKey() ? state.weekTeams.map : null;
  if (!held) {
    // Either the weekly rosters are still being read (the same read Schedule
    // luck is waiting on), or that read failed and there is nothing to plot.
    scatterChart(playersBox, {
      points: [],
      height: 320,
      empty: state.oppPending || !state.oppProj
        ? 'Reading each week’s rosters…'
        : 'No weekly rosters could be read',
    });
    paintFitStats('fitPlayers', null);
    $('fitPlayersNote').textContent = '';
    tuckIfEmpty('fitPlayersNote');
    return;
  }

  // THE WEEK IN PROGRESS. A man whose NFL game is over (`done`) is a finished
  // player-week whether or not his manager's matchup is, so he gets his dot —
  // across his projection as it stood (`pregame`; `projected` now holds his
  // score), up what he scored. A man still to finish has no result and no dot,
  // even with a score so far.
  const inPlay = [...held.keys()]
    .filter((w) => (held.get(w) || []).some((t) => (t.players || []).some((p) => p.done === true)))
    .sort((a, b) => a - b);
  const playerWeeks = [...new Set([...weeks, ...inPlay])].sort((a, b) => a - b);
  const settled = inPlay.length
    ? new Map(playerWeeks.filter((w) => held.has(w)).map((w) => [w, held.get(w).map((t) => ({
      ...t,
      players: (t.players || [...(t.starters || []), ...(t.bench || [])])
        .filter((p) => p.done !== false)
        .map((p) => (p.done === true ? { ...p, projected: p.pregame ?? null } : p)),
    }))]))
    : held;

  const playerPts = playerFitPoints(settled, playerWeeks).map((p) => ({
    x: p.x,
    y: p.y,
    name: p.name,
    detail: [p.position, p.proTeam].filter(Boolean).join(' · '),
    week: p.week,
    key: `p${p.playerId}`,
    teamId: p.teamId,
    position: p.position,
    href: `waivers.html?player=${encodeURIComponent(p.playerId)}&week=${encodeURIComponent(p.week)}`,
    // A DOT OPENS THE PLAYER CARD, with the dot's week marked (2026-10-08).
    // `card` only says "this dot has one": the card itself is built when the
    // dot is first pointed at (`playerDotCard`) — there are thousands of dots.
    card: 'player',
    playerId: p.playerId,
    proTeam: p.proTeam,
  }));
  clearRuns('fit');
  fitRuns.clear();
  const cardWeeks = [...held.keys()].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const playerDotCard = {
    show: (key, el, p) => {
      const id = `${p.playerId}:${p.week}`;
      if (!fitRuns.has(id)) {
        fitRuns.set(id, registerRun(playerCardFromWeeks(held, {
          playerId: p.playerId, name: p.name, position: p.position, proTeam: p.proTeam,
        }, { weeks: cardWeeks, currentWeek: p.week, demo: !!s.isDemo, href: p.href }), 'fit'));
      }
      showCard(fitRuns.get(id), el);
    },
    hide: hideTip,
  };
  const readWeeks = playerWeeks.filter((w) => held.has(w));
  const missing = playerWeeks.filter((w) => !held.has(w));
  const pSpan = playerWeeks.length === 1
    ? `week ${playerWeeks[0]}`
    : `weeks ${playerWeeks[0]}–${playerWeeks[playerWeeks.length - 1]}`;
  const going = inPlay.filter((w) => (held.get(w) || [])
    .some((t) => (t.players || []).some((p) => p.done === false)));
  drawFit('players', playersBox, playerPts, {
    xLabel: 'Projected',
    yLabel: 'Actual',
    height: 320,
    empty: 'No player has both a projection and a score yet',
    card: playerDotCard,
  }, (svg, only) => {
    paintFitStats('fitPlayers', svg);
    $('fitPlayersNote').innerHTML = playerPts.length
      ? paras([
        '<strong>Each dot is one player in one finished week</strong> — everyone on a league ' +
          'roster that week, starters and bench. Across is ESPN&rsquo;s projection for him that ' +
          'week; up is what he scored. ' +
          `${playerPts.length.toLocaleString('en-US')} dots over ${plural(readWeeks.length, 'week')} ` +
          `(${pSpan}).` +
          (going.length
            ? ` Week ${going[going.length - 1]} is still being played: a player is plotted once ` +
              'his own NFL game is over, against the projection he started with.'
            : ''),
        'Left out: a player with no projection or no score, and one projected 0 who scored 0 ' +
          '(a bye, or ruled out) — he was not expected to play and did not, which tests nothing. ' +
          'Free agents are not plotted.' +
          (missing.length
            ? ` ${plural(missing.length, 'week')} could not be read (${missing.join(', ')}) and ` +
              `${missing.length === 1 ? 'is' : 'are'} missing from the graph.`
            : ''),
        FIT_PERFECT,
        fitWords(svg && svg.__ffFit, fitN(svg), only),
        FIT_NUMBERS,
        FIT_GROUPS,
        'Hover or tap a dot for the player and week; a click or tap anywhere on the graph then ' +
          'opens him on Players.',
      ])
      : '';
    tuckIfEmpty('fitPlayersNote');
  });
}

// The league's own week, as a baseline under the grid. It was already computed
// on every render and shown nowhere; with it, every cell above is readable as
// "above or below what everyone else did that week" instead of a bare number.
const LEAGUE_KEY = { actual: 'avgActual', projected: 'avgProjected', luckProj: 'avgLuck' };

// The Luck button is the week's share of the Luck score; the three after it
// are its parts (`weekLuckParts` in js/stats.js).
const LUCK_PART = { luck: 'total', luckProj: 'proj', luckOpp: 'opp', luckClose: 'close' };

function renderWeeklyTable() {
  const s = state.stats;
  const metric = state.weeklyMetric;
  const useSign = metric in LUCK_PART || metric === 'actualDiff';
  const leagueAvg = leagueAvgActualOf(s.teams);
  const partsOf = (row) => weekLuckParts(row, leagueAvg);
  // A tied game's close-game luck is 0 and it is a game (`closeLuckOf`), so its
  // cell is a 0 that the Avg beside it counts — the rule the Close luck column
  // above is formed by.
  const valueOf = (row) => (metric === 'luckClose'
    ? closeLuckOf(row)
    : metric in LUCK_PART ? partsOf(row)[LUCK_PART[metric]] : row[metric]);
  const meanOf = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  const weeks = weekCount();
  // With one week the trailing average is a copy of the only column there is.
  const showAvg = weeks > 1;

  $('weeklyHead').innerHTML =
    '<th class="name" data-sort>Team</th>' +
    s.weekNumbers.map((w) => `<th data-sort data-week="${w}">${w}</th>`).join('') +
    (showAvg ? '<th data-sort>Avg</th>' : '');

  // Whole points everywhere in this grid, trailing average included. It used to
  // round the week cells and then print the average to a tenth, so the row
  // changed precision halfway across.
  const cell = (v) => (useSign ? signed(v, 0) : fmt(v, 0));

  const table = $('weeklyTable');
  const tbody = table.querySelector('tbody');

  // ONE SCALE PER WEEK COLUMN, never one across the grid (Tim's red/green
  // system, 2026-09-19). The rule in js/heat.js is that a number is compared
  // only with the same kind of number, and on this grid the kind is "a week":
  // week 4 can be a low-scoring week for everybody, and a scale over the whole
  // table would paint that entire column red for something no manager did.
  // This is the colour version of the League row already in the tfoot below,
  // whose whole purpose is "read each cell against the week it was played in".
  //
  // ALL FOUR METRICS POINT THE SAME WAY — more actual, more projected, more
  // luck and a bigger margin are all good for the team — so none of them
  // inverts. If a metric is ever added where that is not true, it needs its own
  // `invert` here; js/heat.js will not guess it.
  //
  // THE WEEK STILL BEING PLAYED (`partWeek`) shows the scores of the matchups
  // that are final and leaves the rest of its column EMPTY — not a dash, which
  // on this grid means a bye. It is not coloured and has no League figure: an
  // average of the squads that happen to have finished is not the league's
  // week (the Home page's bench panel refuses the same comparison).
  const part = partWeek();
  const weekScales = new Map(s.weekNumbers.map((w) => [w, w === part ? null : heatScale(
    s.teams.map((t) => {
      const row = t.weekly.find((x) => x.week === w);
      return row ? valueOf(row) : null;
    })
  )]));

  // The plain mean of the cells in the row, whatever the button. Under Luck
  // that IS the Luck score, tie or no tie: js/stats.js forms it from these same
  // unrounded weekly terms (`weekLuckParts`, `closeLuckOf`), so this column and
  // the standings above cannot disagree.
  //
  // UNDER LUCK A WEEK PAST THE SINGLE-WEEK LIMIT COUNTS AS THE LIMIT (Tim,
  // 2026-10-06; `WEEK_LUCK_LIMIT` in js/stats.js). The cell keeps its real
  // number and is marked `capped`; the Avg is of what each week COUNTS
  // (`weekLuckCounted`, off the row), which is what the Luck score averages.
  const countedOf = (row) => (metric === 'luck' ? row.weekLuckCounted : valueOf(row));
  const teamAvg = (t) => meanOf(t.weekly.map(countedOf).filter((v) => typeof v === 'number'));
  // Marked by the number the cell PRINTS: a week of +50.3 prints "+50", and a
  // "+50" underlined as "counts as +50" would be a mark that says nothing.
  const capped = (row) => metric === 'luck' && row.weekLuck !== null &&
    Math.abs(Number(row.weekLuck.toFixed(0))) > WEEK_LUCK_LIMIT;
  let anyCapped = false;

  // EVERY CELL OPENS A CARD (`gridSpec`, 2026-10-08) and so carries no `title`:
  // its place in the week, and under Luck its three parts and what a week past
  // the limit counts as, are lines of the card. They were a title, which read
  // "5th highest of 10 · avg 111.3 for week 1" and, before that, in standard
  // deviations — the preview Tim named as the bad one.
  const untitled = (td) => td.replace(/ title="[^"]*"/, '');
  const withParts = (td, row) => {
    const out = untitled(td);
    if (!capped(row)) return out;
    anyCapped = true;
    return / class="/.test(out)
      ? out.replace(' class="', ' class="capped ')
      : out.replace('<td', '<td class="capped"');
  };
  // The Avg column is its own group: ten season averages, which are the same
  // kind of number as each other and NOT the same kind as a single week.
  const avgScale = showAvg ? heatScale(s.teams.map(teamAvg)) : null;

  grid = { metric, useSign, valueOf, partsOf, capped, countedOf, teamAvg, weekScales, avgScale };
  wirePops(table, { selector: 'td[data-wk]', card: (el) => gridSpec(el.dataset.team, el.dataset.wk) });
  wirePops(table, { selector: 'td[data-wkavg]', card: (el) => gridAvgSpec(el.dataset.team) });
  wirePops(table, { selector: 'tbody td.name[data-team]', card: (el) => { const t = teamOfId(el.dataset.team); return t ? teamSpec(t) : null; } });
  wirePops(table, { selector: 'tfoot td[data-week]', card: (el) => weekSpec(el.dataset.week) });
  // A heading's click sorts, so its card links nowhere; and a finger has no
  // hover, so on a phone the week's card is the League row's.
  wirePops(table, { selector: 'th[data-week]', card: (el) => (coarsePointer() ? null : weekSpec(el.dataset.week, { link: false })) });

  tbody.innerHTML = s.teams
    .map((t) => {
      const cells = s.weekNumbers.map((w) => {
        const row = t.weekly.find((x) => x.week === w);
        if (!row) return w === part ? '<td></td>' : `<td>${dash}</td>`;
        const v = valueOf(row);
        if (v === null) return `<td>${dash}</td>`;
        return withParts(heatCell(v, weekScales.get(w), {
          text: cell(v),
          extra: `data-wk="${w}" data-team="${esc(t.id)}" tabindex="0"`,
        }), row);
      });
      const avg = teamAvg(t);
      return `<tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name" data-team="${esc(t.id)}" tabindex="0">${esc(t.name)}</td>${cells.join('')}
        ${showAvg ? untitled(heatCell(avg, avgScale, {
    text: cell(avg),
    extra: `data-wkavg data-team="${esc(t.id)}" tabindex="0"`,
  })) : ''}
      </tr>`;
    })
    .join('');

  // The parts with no ready-made league figure average their own column.
  const key = LEAGUE_KEY[metric] || (metric in LUCK_PART ? 'own' : null);
  const tfoot = table.querySelector('tfoot');
  if (tfoot) {
    if (key) {
      const weekly = s.weekNumbers.map((w) => (key === 'own'
        ? { week: w, own: meanOf(s.teams.map((t) => t.weekly.find((x) => x.week === w))
          .map((row) => (row ? valueOf(row) : null)).filter((v) => typeof v === 'number')) }
        : s.weeklyLeagueAverages.find((a) => a.week === w)));
      const vals = weekly.filter((a) => !a || a.week !== part)
        .map((a) => (a ? a[key] : null)).filter((v) => typeof v === 'number');
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      tfoot.innerHTML =
        // `league-row` is the heavier rule that sets it off from the teams (css/app.css).
        `<tr class="league-row"><td class="name">League</td>` +
        weekly.map((a) => (a && a.week === part ? '<td></td>'
          : `<td${a ? ` data-week="${a.week}" tabindex="0"` : ''}>${a && typeof a[key] === 'number' ? cell(a[key]) : dash}</td>`)).join('') +
        (showAvg ? `<td>${cell(avg)}</td>` : '') +
        '</tr>';
    } else {
      // Every margin is cancelled by its opposite, so the league's average
      // margin is zero by construction and says nothing worth a row.
      tfoot.innerHTML = '';
    }
  }

  // The visible key, and it says the one thing a reader would otherwise get
  // wrong: the colour runs DOWN a week, not across a team's season.
  const anyScale = [...weekScales.values()].some(Boolean);
  // The four steps and the tap hint moved into `weeklyNote` with the rest of
  // the method (`describeHeatPerColumn` there says both). What a reader gets
  // wrong without this line is the DIRECTION of the comparison, and that has
  // to stay in view.
  $('weeklyKey').innerHTML = (anyScale
    ? '<strong>Colour is down each week, not across the season</strong>: each cell against ' +
      'what the other nine did that week, green above and red below. Ends carry ▲▼ and bold.'
    : '<strong>Nothing is coloured yet</strong> — a week needs at least two teams with a ' +
      'number in it before there is anything to compare.') +
    // Only under Luck, and only when a week on the grid is past the limit.
    (anyCapped ? ` Underlined: counts as ±${WEEK_LUCK_LIMIT} toward the season.` : '');

  $('weeklyNote').innerHTML = paras([
    key
      ? 'The League row is what all ten teams averaged that week, so each cell above ' +
        'can be read against the week it was played in. It is never coloured itself: it is ' +
        'the baseline the colours are measured from, not a competitor in the table.'
      : 'Margin is your score minus your opponent’s, so the league row would be zero ' +
        'every week by construction and is left out. The colours are unaffected — they are ' +
        'measured from each week’s own ten values, not from the league row.',
    describeHeatPerColumn({ group: 'week', what: 'what the other nine teams did' }),
    part === null
      ? ''
      : `Week ${part} is still being played. A matchup is counted as soon as every starter ` +
        'in it has finished; the others are left empty, and the week has no colour or League ' +
        'figure until it is complete.',
    'Every measure points the same way here — more points, a better projection, more ' +
    'luck and a bigger margin are all good for the team — so green always means good on ' +
    'this grid whichever button is pressed.',
    '<strong>Luck</strong> is the week’s share of the Luck score: <strong>Opp scoring</strong> ' +
    '(the league’s season average minus what your opponent scored), <strong>Act−Proj</strong> ' +
    '(your score minus your projection) and <strong>Close game</strong> (near ±50 for a ' +
    'one-point result, near zero for a blowout), added up. Its Avg is the Luck score, ' +
    `where one week counts ±${WEEK_LUCK_LIMIT} at most. ` +
    'Hover or tap a Luck cell for the three.',
    'Hover or tap any cell for that week: the opponent and the result, what was projected ' +
    'and scored, and where the cell stands in the league that week. A click opens that ' +
    'team&rsquo;s roster for the week on Analysis; the League row opens the week on Schedule.',
  ]);

  // Headers are rebuilt above, but sortable.js delegates from the table
  // itself, so the wiring survives.
  enableSort(table);
  resort(table);
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  state.sourcePicked = true;
  selectSource(btn.dataset.src);
});

$('weeklyMetric').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-metric]');
  if (!btn) return;
  $('weeklyMetric').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  state.weeklyMetric = btn.dataset.metric;
  renderWeeklyTable();
});

$('highlightTeam').addEventListener('change', (e) => {
  state.highlight = e.target.value ? Number(e.target.value) : null;
  prefs.set('highlight', state.highlight);
  renderMainTable();
  renderOppPanel();
  renderCharts();
  renderFit();
  renderWeeklyTable();
});

// A league connected on another page (or in the bar above) should show up here
// without a second click on a toggle that says the same thing.
let triedLive = false;
onConnection((conn) => {
  if (!conn) return;

  if (prefs.get('highlight', null) === null && conn.teamId != null) {
    state.highlight = conn.teamId;
    if (state.stats) render();
  }

  if (triedLive || state.sourcePicked || state.source === 'live') return;
  triedLive = true;
  selectSource('live');
});

// Sync now, or a roster move js/season.js noticed (`ff:refresh`, sent by
// js/connection.js): the league is read again, as on a first load.
document.addEventListener('ff:refresh', (e) => {
  if (state.source === 'live') e.detail.waitUntil(selectSource('live'));
});

async function start() {
  // Remembered source, but never a blank page: if the saved league will not
  // load, fall back to demo and keep the reason on screen.
  if (prefs.get('source') === 'live' && savedConfig()) {
    loading = true;
    try {
      if (await loadLive()) {
        state.source = 'live';
        return;
      }
      const why = $('sourceStatus').innerHTML;
      await loadDemo();
      setStatus(`${why} Showing demo data instead.`, true);
    } finally {
      loading = false;
      paintSource();
    }
    return;
  }
  await loadDemo();
  paintSource();
}

start();
