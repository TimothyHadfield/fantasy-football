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
import { heatScale, describeHeat, describeHeatPerColumn } from './heat.js';
// THE STANDINGS TABLE'S ROWS, and the cell helpers they are made of, live in
// their own module since 2026-10-05 so a second page (the Decisions review)
// draws the identical table. `heatCell` and the formatters are imported back
// rather than kept twice.
import {
  standingsRowsHtml, standingsScales, standingsHeadings, heatCell, winPctOf,
  fmt, dash, signed, esc,
} from './standings-table.js';
import { enableSort, resort } from './sortable.js';
import { scope } from './prefs.js';
import { savedConfig, onConnection } from './connection.js';

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

    if (!data.projectionsAvailable) {
      setStatus(
        `Loaded ${data.gamesFound} games from ${esc(data.name)}, but ESPN only returned ` +
        `weekly projections for ${data.gamesWithProjections} of them. Anything ` +
        `built on projections (luck, skill, projection accuracy) will be wrong or ` +
        `blank for the missing weeks.`,
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

/** "3–1 Name"; a record with a game in play carries its basis as a title (rule 7). */
function bestRecordTile(top) {
  const r = recordOf(top);
  const rec = r.live ? `<span title="${esc(r.title)}">${r.text}</span>` : r.text;
  return `${rec} ${esc(top.name)}`;
}

function renderGlance() {
  const s = state.stats;
  const weeks = weekCount();
  const top = [...s.teams].sort(byRecord)[0];
  const box = s.leagueActualBox;   // null before there are five scores in the league
  const overall = s.predictionAccuracy.find((a) => a.threshold === 0);

  const none = noGames();

  const items = [
    ['Teams', s.teams.length],
    ['Weeks', weeks],
    // With one week an "average" is just that week, so it says so; with none
    // there is no average at all, and stats.js's 0 must not be printed as one.
    [weeks === 1 ? `Week ${s.weekNumbers[0]} avg` : 'League avg',
      none ? dash : fmt(s.leagueAvgActual)],
    [weeks === 1 ? 'Projected' : 'Avg projected',
      none ? dash : fmt(s.leagueAvgProjected)],
    ['Highest week', box ? fmt(box.max) : dash],
    ['Lowest week', box ? fmt(box.min) : dash],
    ['Best record', top && !none ? bestRecordTile(top) : dash],
    // The one tile that can say something before kickoff. It arrives late — the
    // schedule read is asynchronous — so renderOppProjPanel() repaints this row.
    ['Hardest schedule', hardestScheduleTile()],
    ['Projection accuracy', accuracyTile(overall)],
  ];

  $('glance').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
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

  tbody.innerHTML = standingsRowsHtml(s, {
    highlightId: state.highlight, recordOf, oppProj, scales,
  });

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
    'projected. <strong>PTW</strong> = what you ' +
    'needed to score to beat a typical opponent. <strong>Skill</strong> = your average ' +
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
    'Every other column on this table is left uncoloured on purpose. <strong>LS</strong>, ' +
    '<strong>PS</strong> and <strong>AS</strong> are ranks, which are already an ordering. ' +
    '<strong>Close luck</strong>, <strong>Luck score</strong> and <strong>S+L</strong> carry a ' +
    '±, and early in a season that margin is wider than the gaps between the teams — a colour ' +
    'would claim a ranking the ± says is not there yet. <strong>Total</strong> is the Avg ' +
    'column multiplied by the same number of games for everyone and <strong>Skill</strong> is ' +
    'the Proj column minus the same league average for everyone, so both would repeat a colour ' +
    'that is already in the row. <strong>Spread</strong> and <strong>PTW</strong> have no good ' +
    'end to point at: a low spread is consistency whether a team is good or bad, and PTW rises ' +
    'both when your opponents score more and when your own luck runs against you.',
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

function renderCharts() {
  const s = state.stats;
  const weeks = weekCount();
  const trends = weeks >= MIN_WEEKS;

  // The three ten-series line charts and the ten-row box plot need a season
  // shape to draw. With one week they are ten dots in a vertical stripe, three
  // times over, plus ten 1.5px slivers — about a thousand pixels of scrolling
  // that says nothing. Hide them and say why once, at the top.
  show('panelWeekly', trends);
  show('panelLuck', trends);
  show('panelCumLuck', trends);
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

  lineChart($('chartWeekly'), {
    series: seriesFor((r) => r.actual),
    xLabels,
    yLabel: 'Points',
    height: 320,
    highlight: highlightId,
  });

  lineChart($('chartLuck'), {
    series: seriesFor((r) => r.luck),
    xLabels,
    yLabel: 'Actual − projected',
    height: 300,
    zeroLine: true,
    highlight: highlightId,
  });

  lineChart($('chartCumLuck'), {
    series: s.teams.map((t, i) => ({
      id: t.id,
      name: t.name,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      values: s.weekNumbers.map((w) => {
        const row = t.cumulativeLuck.find((x) => x.week === w);
        return row ? row.value : null;
      }),
    })),
    xLabels,
    yLabel: 'Cumulative luck',
    height: 300,
    zeroLine: true,
    highlight: highlightId,
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

  boxPlot($('chartBox'), {
    rows: withBox
      .sort((a, b) => b.box.median - a.box.median)
      .map(({ t, box }) => ({
        id: t.id,
        name: t.name,
        min: box.min,
        q1: box.q1,
        median: box.median,
        q3: box.q3,
        max: box.max,
        outliers: box.outliers,
      })),
    xLabel: 'Points',
    highlight: highlightId,
  });
}

function renderDistribution() {
  const s = state.stats;
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
    `luck, cumulative luck and per-team spread appear from week ${MIN_WEEKS} — with ` +
    'less than that they draw a shape that is not in the data.' +
    (weeks === 0
      ? ' Schedule luck, further down the page, is the number that does not have to wait.'
      : ''),
  ];

  if (latest) {
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
}

/** "weeks 5–14", "week 14", or '' when nothing is left. */
function restSpan(weeks) {
  if (!weeks || !weeks.length) return '';
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  return first === last ? `week ${first}` : `weeks ${first}–${last}`;
}

function paintOppPanel(chart, note) {
  closeOppPop();
  // The weeks the chart is formed over, said in the heading itself.
  const said = $('oppProjSpan');
  const d = state.oppProj;
  const span = !state.oppPending && d && !d.error && d.rest ? restSpan(d.rest.weeks) : '';
  if (said) said.textContent = span ? ` (${span})` : '';
  wireOppPop(chart);

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

/**
 * Ranked horizontal bars, hardest schedule first.
 *
 * Not charts.js's histogram, which scales from zero: ten averages that all land
 * between about 105 and 120 would draw ten bars of near-identical full height,
 * hiding the differences that are the entire point. These run from the easiest
 * schedule in the league to the hardest, so bar length IS the spread.
 */
function oppBars(rows, leagueAvg) {
  const values = rows.map((r) => r.avgOpp);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const items = rows
    .map((r, i) => {
      const width = 8 + 92 * ((r.avgOpp - min) / span);
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
          <span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>
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

let oppPop = null;

function oppPopHtml(teamId) {
  const data = state.oppProj;
  const rest = data && data.rest;
  const team = state.stats && state.stats.teams.find((t) => String(t.id) === String(teamId));
  const list = team && rest && rest.fixtures ? rest.fixtures.get(team.id) : null;
  if (!list || !list.length) return '';
  const nameOf = (id) => {
    const t = state.stats.teams.find((x) => x.id === id);
    return t ? t.name : '—';
  };
  const avg = list.reduce((a, f) => a + f.opp, 0) / list.length;
  const league = rest.leagueAvg;
  const gap = typeof league === 'number' ? league - avg : null;
  const rows = list.map((f) =>
    `<tr><td class="num">${f.week}</td><td class="name">${esc(nameOf(f.oppId))}</td>` +
    `<td class="num">${fmt(f.opp)}</td></tr>`).join('');
  return (
    `<div class="op-h">${esc(team.name)} <span class="muted">· ${restSpan(list.map((f) => f.week))}</span></div>` +
    '<table><thead><tr><th class="num">Wk</th><th class="name">Opponent</th><th class="num">Proj</th></tr></thead>' +
    `<tbody>${rows}</tbody><tfoot>` +
    `<tr><td></td><td class="name">Average</td><td class="num">${fmt(avg)}</td></tr>` +
    (gap === null ? '' :
      `<tr><td></td><td class="name">League average</td><td class="num">${fmt(league)}</td></tr>` +
      `<tr class="op-gap"><td></td><td class="name">Gap</td><td class="num">${gapOf(gap).text}</td></tr>`) +
    '</tfoot></table>' +
    '<button type="button" class="op-close">Close</button>'
  );
}

function closeOppPop() {
  if (oppPop) oppPop.hidden = true;
}

function openOppPop(el, sheet) {
  const html = oppPopHtml(el.dataset.opp);
  if (!html) return;
  if (!oppPop) {
    oppPop = document.createElement('div');
    oppPop.id = 'oppPop';
    document.body.appendChild(oppPop);
    oppPop.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.op-close')) closeOppPop();
    });
  }
  oppPop.className = sheet ? 'opp-pop sheet' : 'opp-pop';
  oppPop.innerHTML = html;
  oppPop.hidden = false;
  oppPop.style.left = '';
  oppPop.style.top = '';
  if (sheet) return;
  // Beside the figure: its right edge on the figure's, below it unless only
  // above has the room.
  const r = el.getBoundingClientRect();
  const w = oppPop.offsetWidth;
  const h = oppPop.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
  oppPop.style.left = `${left}px`;
  oppPop.style.top = `${top}px`;
}

/** One set of listeners on the chart's host, which outlives every repaint. */
function wireOppPop(chart) {
  if (chart.dataset.oppWired) return;
  chart.dataset.oppWired = '1';
  const target = (e) => (e.target && e.target.closest ? e.target.closest('.dd[data-opp]') : null);
  const noHover = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  chart.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el && !noHover()) openOppPop(el, false);
  });
  chart.addEventListener('mouseout', (e) => {
    if (target(e) && !noHover()) closeOppPop();
  });
  chart.addEventListener('click', (e) => {
    const el = target(e);
    if (el) openOppPop(el, noHover());
  });
  chart.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el && !noHover()) openOppPop(el, false);
  });
  chart.addEventListener('focusout', () => { if (!noHover()) closeOppPop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOppPop(); });
  document.addEventListener('click', (e) => {
    if (!oppPop || oppPop.hidden) return;
    if (oppPop.contains(e.target) || target(e)) return;
    closeOppPop();
  });
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
      `Hardest to easiest spans only ${fmt(spread)} points, which is why the ` +
        'bars run between those two rather than from zero — zero-based bars would all be ' +
        'the same length and show nothing.'
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

function renderAccuracy() {
  const acc = state.stats.predictionAccuracy;
  const table = $('accuracyTable');
  const tbody = table.querySelector('tbody');

  // An empty bucket is a row of zeroes pretending to be a finding, and early in
  // a season most of them are empty.
  const rows = acc.filter((a) => a.games > 0);

  tbody.innerHTML = rows.length
    ? rows
        .map((a) => `
          <tr>
            <td class="name" data-v="${a.threshold}">${a.label}</td>
            <td>${a.games}</td>
            <td>${a.correct}</td>
            <td data-v="${a.accuracy === null ? '' : a.accuracy}">${
              a.accuracy === null ? dash : `${Math.round(a.accuracy * 100)}%`}</td>
          </tr>`)
        .join('')
    : '<tr><td class="name" colspan="4">No completed games yet.</td></tr>';

  enableSort(table);
  resort(table);

  const notes = [];
  const withheld = rows.some((a) => a.accuracy === null);
  if (withheld) {
    notes.push(
      'A percentage is only shown once a bucket holds enough games to mean ' +
      'something — out of five games the only answers available are 0, 20, 40, ' +
      '60, 80 and 100%.'
    );
  }
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

const FIT_PERFECT =
  '<strong>Dotted line</strong> = actual equals projected, where a perfect projection would ' +
  'put every dot. Above it beat the projection, below it fell short. Both axes share one ' +
  'scale, so the dotted line is a true diagonal.';

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
        FIT_PERFECT,
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
  }));
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
    s.weekNumbers.map((w) => `<th data-sort>${w}</th>`).join('') +
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
  const teamAvg = (t) => meanOf(t.weekly.map(valueOf).filter((v) => typeof v === 'number'));

  // Hovering (or, on a phone, tapping) a Luck cell names its three parts.
  const partsTitle = (row) => {
    const p = partsOf(row);
    // Plain text: `signed` wraps its number in a span, which a title cannot hold.
    const pm = (v) => { const n = Number(v.toFixed(0)) + 0; return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`; };
    return `Opp scoring ${pm(p.opp)} · Act−Proj ${pm(p.proj)} · Close game ` +
      `${p.close === null ? 'tie' : pm(p.close)}`;
  };
  const withParts = (td, row) => (metric !== 'luck'
    ? td
    : / title="/.test(td)
      ? td.replace(' title="', ` title="${esc(partsTitle(row))}. `)
      : td.replace('<td', `<td title="${esc(partsTitle(row))}"`));
  // The Avg column is its own group: ten season averages, which are the same
  // kind of number as each other and NOT the same kind as a single week.
  const avgScale = showAvg ? heatScale(s.teams.map(teamAvg)) : null;

  tbody.innerHTML = s.teams
    .map((t) => {
      const cells = s.weekNumbers.map((w) => {
        const row = t.weekly.find((x) => x.week === w);
        if (!row) return w === part ? '<td></td>' : `<td>${dash}</td>`;
        const v = valueOf(row);
        if (v === null) return `<td>${dash}</td>`;
        return withParts(heatCell(v, weekScales.get(w), {
          what: `what the league did in week ${w}`,
          text: cell(v),
        }), row);
      });
      const avg = teamAvg(t);
      return `<tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>${cells.join('')}
        ${showAvg ? heatCell(avg, avgScale, {
    what: 'what the rest of the league averages', text: cell(avg),
  }) : ''}
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
        weekly.map((a) => (a && a.week === part ? '<td></td>' : `<td>${a && typeof a[key] === 'number' ? cell(a[key]) : dash}</td>`)).join('') +
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
  $('weeklyKey').innerHTML = anyScale
    ? '<strong>Colour is down each week, not across the season</strong>: each cell against ' +
      'what the other nine did that week, green above and red below. Ends carry ▲▼ and bold.'
    : '<strong>Nothing is coloured yet</strong> — a week needs at least two teams with a ' +
      'number in it before there is anything to compare.';

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
    'one-point result, near zero for a blowout), added up. Its Avg is the Luck score. ' +
    'Hover or tap a Luck cell for the three.',
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
