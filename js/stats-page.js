// Wires the stats page together: pick a data source, compute, render.
//
// Everything here was built and checked against a finished 2025 season, where
// every panel had thirteen weeks under it. A season starts with one. Most of
// the branching below exists for that: a chart or a number that cannot say
// anything honest yet says so, rather than drawing a confident shape out of a
// single game.

import { generateDemoLeague } from './demo.js';
import { generateDemoSchedule, generateDemoWeekRosters } from './demo-rosters.js';
import { computeLeagueStats } from './stats.js';
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
import { lineChart, histogram, boxPlot, SERIES_COLORS } from './charts.js';
// THE SHARED RED/GREEN SCALE (Tim, 2026-09-19). It REPLACED a local
// `heatScale()` that lived here — see `heatCell` below for what was wrong with
// it and why the two could not coexist.
import { heatScale, heatOf, heatMarkHtml, describeHeat, describeHeatPerColumn } from './heat.js';
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
};

// "Which team am I" is the same answer every visit, so it is remembered; the
// connection bar's team, when there is one, is the better first guess than None.
state.highlight = prefs.get('highlight', null);
if (state.highlight === null) {
  const cfg = savedConfig();
  if (cfg && cfg.teamId != null) state.highlight = cfg.teamId;
}

// ------------------------------------------------------------------ formatting

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);

/** Points for, as ESPN shows it: one decimal, thousands-separated (1,845.6).
 *  Whole points used to be shown, which read 1845.60 as 1,846. */
const pf = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const dash = '<span class="muted">—</span>';

function signed(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return dash;
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${n.toFixed(digits)}</span>`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/** W–L, plus the tie a two-game season can already contain. Ties were computed
 *  and never shown, so a team that tied then won read as "1–0". */
const record = (t) => `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`;

/**
 * Win percentage the way ESPN ranks a standings table: a tie is half a win.
 * This league has no matchup tie-breaker, so a tie stands and has to count.
 * Null before a game is played.
 */
const winPct = (t) => {
  const games = t.wins + t.losses + t.ties;
  return games ? (t.wins + t.ties / 2) / games : null;
};

/** ESPN's order: win percentage, then points for. */
const byRecord = (a, b) => (winPct(b) ?? 0) - (winPct(a) ?? 0) || b.pointsFor - a.pointsFor;

/** One sortable number for the same order. A step in win percentage is at
 *  least 1/30 of a game, which times 1e6 dwarfs any season's points for. */
const recordKey = (t) => (winPct(t) ?? 0) * 1e6 + t.pointsFor;

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
    ['Best record', top && !none ? `${record(top)} ${esc(top.name)}` : dash],
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

/**
 * One heat-scaled cell, attributes and content together.
 *
 * @param {number|null} v
 * @param {Object|null} scale from `heatScale`, or null to draw no colour at all
 * @param {Object} [opts]
 * @param {string} [opts.what] the comparison group, in words, for the title
 * @param {string} [opts.text] what to print, when it is not just the number
 * @param {string} [opts.extra] extra attributes (a `data-v` for the sort)
 *
 * The `title` is the "never colour alone" channel that carries the actual
 * standing — js/touch-titles.js turns it into a tap on a phone, so it is not
 * hover-only — and the ▲/▼ at the end of the scale is the one that needs no
 * interaction at all.
 */
function heatCell(v, scale, { what = 'the rest of the league', text = null, extra = '' } = {}) {
  const shown = text === null ? fmt(v) : text;
  const h = heatOf(v, scale, { what });
  if (!h) return `<td${extra ? ` ${extra}` : ''}>${shown}</td>`;
  return `<td class="${h.cls}"${extra ? ` ${extra}` : ''} title="${esc(h.words)}">` +
    `${shown}${heatMarkHtml(h)}</td>`;
}

function renderMainTable() {
  const s = state.stats;
  const table = $('mainTable');
  const tbody = table.querySelector('tbody');
  // With no completed weeks every one of these is an average of nothing, which
  // stats.js correctly computes as 0 and this must not print as a score.
  const none = noGames();

  // SHOWN FROM WEEK 1, WITH A MARGIN. These were held back until week 3,
  // because the close-game curve clamps to ±50 under a ~5.5-point margin and a
  // single game swings them further than a whole season does. Tim asked for
  // them from the start with "a wide margin for the first few games" instead,
  // so each carries a ± (one standard error — see attachLuckMargins in
  // stats.js) that is huge after one game and narrows every week.
  const luck = (v, m) => {
    if (none || v === null || v === undefined) return `<td>${dash}</td>`;
    const pm = m === null || m === undefined ? '' : `<span class="pm">±${Math.round(m)}</span>`;
    return `<td data-v="${v}">${signed(v)}${pm}</td>`;
  };
  const rank = (v) => (none || v === null ? dash : `<span class="rank">${v}</span>`);
  const num = (v) => (none ? dash : fmt(v));
  const sgn = (v) => (none ? dash : signed(v));

  // FOUR SCALES, ONE PER COLUMN, and never one across the table. A column is a
  // comparison group precisely because every value in it is the same kind of
  // number; the row is not (it holds an average, a total and two ranks), and a
  // scale across the row would be the "quarterback against a kicker" mistake in
  // another costume. See the header of js/heat.js.
  const heatAvg = heatScale(none ? [] : s.teams.map((t) => t.avgActual));
  const heatProj = heatScale(none ? [] : s.teams.map((t) => t.avgProjected));
  // INVERTED, both of them. A high opponent average is a hard schedule — the
  // old local ramp painted exactly this column its greenest for being hardest,
  // which is the defect that made the two systems irreconcilable.
  const heatOpp = heatScale(none ? [] : s.teams.map((t) => t.oppAvgActual), { invert: true });
  const heatOppProj = heatScale(oppRows().map((r) => r.avgOpp), { invert: true });

  const W_AVG = 'what the league averages a week';
  const W_PROJ = 'what the league is projected a week';
  const W_OPP = 'the opponents the rest of the league has faced';

  tbody.innerHTML = s.teams
    .map((t) => `
      <tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>
        <td data-v="${recordKey(t)}">${record(t)}</td>
        ${heatCell(none ? null : t.avgActual, heatAvg, { what: W_AVG, text: num(t.avgActual) })}
        ${heatCell(none ? null : t.avgProjected, heatProj, { what: W_PROJ, text: num(t.avgProjected) })}
        <td${none ? '' : ` data-v="${t.pointsFor}"`}>${none ? dash : pf(t.totalActual)}</td>
        ${heatCell(none ? null : t.oppAvgActual, heatOpp, { what: W_OPP, text: num(t.oppAvgActual) })}
        <td>${sgn(t.forMinusAgainst)}</td>
        <td>${num(t.actualStdev)}</td>
        ${oppProjCell(t.id, heatOppProj)}
        <td>${sgn(t.avgLuck)}</td>
        <td>${num(t.pointsToWin)}</td>
        ${luck(t.scoreDiffLuck, t.margins && t.margins.scoreDiffLuck)}
        ${luck(t.luckScore, t.margins && t.margins.luckScore)}
        <td>${sgn(t.skill)}</td>
        ${luck(t.skillPlusLuck, t.margins && t.margins.skillPlusLuck)}
        <td>${rank(t.luckStanding)}</td>
        <td>${rank(t.projectedStanding)}</td>
        <td>${rank(t.actualStanding)}</td>
      </tr>`)
    .join('');

  // Single-week columns are that week's score, not an average of anything.
  const oneWeek = weekCount() === 1;
  $('thScoringGroup').textContent = oneWeek ? `Scoring — week ${s.weekNumbers[0]} only` : 'Scoring';
  $('thAvg').textContent = oneWeek ? 'Score' : 'Avg';
  $('thOppAvg').textContent = oneWeek ? 'Opp score' : 'Opp Avg';

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
    '<strong>Green is good for that team, red is bad</strong>, against the rest of the league ' +
    'in that column — so on <strong>Opp Avg</strong> and <strong>Opp proj</strong> green is an ' +
    '<em>easy</em> schedule. Full colour is one SD out, marked ▲ or ▼.';

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
        'is the easier half of the league, red the harder. Every other column on this table ' +
        'is left uncoloured on purpose — a rank is already an ordering, and a ± is a margin ' +
        'rather than a quantity.'
      : '',
  ]);

  // Default to standings order; afterwards keep whatever the user picked.
  enableSort(table, { defaultIndex: 1 });
  resort(table);
}

// ---------------------------------------------------------------------- charts

function seriesFor(valueFn) {
  return state.stats.teams.map((t, i) => ({
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
      : `Every team’s score so far, in ten-point buckets — ${plural(weeks * s.teams.length, 'score')}.`;

  if (!trends) {
    renderEarly();
    renderDistribution();
    return;
  }

  const xLabels = s.weekNumbers.map(String);
  const highlightName = state.highlight
    ? s.teams.find((t) => t.id === state.highlight)?.name
    : undefined;

  lineChart($('chartWeekly'), {
    series: seriesFor((r) => r.actual),
    xLabels,
    yLabel: 'Points',
    height: 320,
    highlight: highlightName,
  });

  lineChart($('chartLuck'), {
    series: seriesFor((r) => r.luck),
    xLabels,
    yLabel: 'Actual − projected',
    height: 300,
    zeroLine: true,
    highlight: highlightName,
  });

  lineChart($('chartCumLuck'), {
    series: s.teams.map((t, i) => ({
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
    highlight: highlightName,
  });

  renderDistribution();

  // A team's five-number summary needs about five weeks, so between weeks 3 and
  // 4 the trend charts are back but this one is not. Say which, rather than
  // letting the chart's generic "no data" carry it.
  const withBox = [...s.teams].filter((t) => t.actualBox);
  if (!withBox.length) {
    $('chartBox').innerHTML =
      `<p class="empty">A team&rsquo;s spread needs about five weeks of scores — ` +
      `there ${weeks === 1 ? 'is' : 'are'} ${plural(weeks, 'week')} so far.</p>`;
    return;
  }

  boxPlot($('chartBox'), {
    rows: withBox
      .sort((a, b) => b.actualBox.median - a.actualBox.median)
      .map((t) => ({
        name: t.name,
        min: t.actualBox.min,
        q1: t.actualBox.q1,
        median: t.actualBox.median,
        q3: t.actualBox.q3,
        max: t.actualBox.max,
        outliers: t.actualBox.outliers,
      })),
    xLabel: 'Points',
    highlight: state.highlight
      ? s.teams.find((t) => t.id === state.highlight)?.name
      : undefined,
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

const oppFor = (id) => {
  const p = state.oppProj;
  return p && p.byTeam ? p.byTeam.get(id) || null : null;
};

/** Teams that have a number, hardest schedule first. */
function oppRows() {
  const p = state.oppProj;
  if (!p || !p.byTeam || !state.stats) return [];
  return state.stats.teams
    .map((t) => {
      const o = p.byTeam.get(t.id);
      return o ? { id: t.id, name: t.name, avgOpp: o.avgOpp, own: o.own, games: o.games } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.avgOpp - a.avgOpp);
}

/**
 * The Opp proj cell. data-v is omitted entirely when the number is unknown —
 * an empty data-v parses as 0 and would rank a team we know nothing about as
 * having the easiest schedule in the league.
 */
function oppProjCell(teamId, scale) {
  const o = oppFor(teamId);
  if (!o) return `<td>${dash}</td>`;
  return heatCell(o.avgOpp, scale, {
    what: 'the schedules the rest of the league drew',
    extra: `data-v="${o.avgOpp}"`,
  });
}

function hardestScheduleTile() {
  const rows = oppRows();
  if (!rows.length) return dash;
  return `${fmt(rows[0].avgOpp)} <small class="muted">${esc(rows[0].name)}</small>`;
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
    state.oppProj = buildOppProj(key, generateDemoSchedule(), demoWeekTeams());
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

    // One wire read, for the first week on screen, used for every week — the
    // shape Tim chose. A failure is no floors at all, never an error.
    let floors = null;
    try {
      if (typeof season.fetchFloors === 'function' && schedule.weeks.length) {
        const got = await season.fetchFloors(schedule.weeks[0]);
        floors = got && got.size ? got : null;
      }
    } catch { floors = null; }
    if (stale()) return;

    state.oppProj = buildOppProj(key, schedule, weekTeams, floors);
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

/** Turn a schedule plus a week→rosters map into the per-team averages. */
function buildOppProj(key, schedule, weekTeams, floors = null) {
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

  return {
    key,
    byTeam,
    leagueAvg: leagueAverageOpponent(byTeam),
    scheduleWeeks: schedule.weeks,
    projectedWeeks: built.weeks,
    countsKnown: built.countsKnown,
    starters: built.slots.length,
  };
}

/** Everything that shows a schedule-luck number, repainted where it stands. */
function afterOppProj() {
  renderGlance();
  renderMainTable();
  renderOppPanel();
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

function paintOppPanel(chart, note) {
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

  const rows = oppRows();
  if (!rows.length) {
    chart.innerHTML = '<p class="empty">No fixtures could be matched to a projected week.</p>';
    note.textContent = '';
    return;
  }

  chart.innerHTML = oppBars(rows, data.leagueAvg);
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
      const d = typeof leagueAvg === 'number' ? r.avgOpp - leagueAvg : null;
      const gap =
        d === null
          ? ''
          : `<span class="dd ${d > 0.05 ? 'hard' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;
      return `<li class="${state.highlight === r.id ? 'me' : ''}">
          <span class="rk">${i + 1}</span>
          <span class="nm">${esc(r.name)}</span>
          <span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>
          <span class="vv">${fmt(r.avgOpp)}</span>
          ${gap}
        </li>`;
    })
    .join('');

  return `<ol class="oppbars">${items}</ol>`;
}

/** What the number is, that it needs no games, how it was derived, and over what. */
function oppNote(rows, data) {
  const weeks = data.projectedWeeks;
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const span = weeks.length === 1 ? `week ${first}` : `weeks ${first}–${last}`;

  const fixtures = rows.map((r) => r.games);
  const loF = Math.min(...fixtures);
  const hiF = Math.max(...fixtures);
  const perTeam =
    loF === hiF ? `${plural(loF, 'fixture')} each` : `${loF}–${hiF} fixtures each`;

  const values = rows.map((r) => r.avgOpp);
  const spread = Math.max(...values) - Math.min(...values);

  const lines = [
    '<strong>The average projected score of the opponents you have to play.</strong> ' +
      'For every fixture on your schedule, take what the other side is projected to ' +
      'score that week, then average those. High means a hard schedule — which is ' +
      'luck, not skill: nobody picks their own opponents.',

    'It needs <strong>no games played</strong>, which is the whole point of it.',

    'Each ' +
      'weekly number is ESPN&rsquo;s own per-player projection for that week, with the ' +
      `best legal lineup filled for every team (${plural(data.starters, 'starter')})` +
      (data.countsKnown
        ? ', using the starting slots read off the league&rsquo;s own lineups'
        : ' — the league&rsquo;s slot counts could not be read off its lineups, so a ' +
          'standard lineup is assumed and a league with unusual slots will be a little out') +
      `. Those team totals are then averaged over ${span}: ${perTeam}.`,
  ];

  if (typeof data.leagueAvg === 'number') {
    lines.push(
      `The league&rsquo;s average opponent is <strong>${fmt(data.leagueAvg)}</strong>, so ` +
        'the figure beside each bar is the gap from that: a positive number is that many ' +
        'points a week harder than the league&rsquo;s typical schedule, a negative one that ' +
        'much easier.',
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

// The league's own week, as a baseline under the grid. It was already computed
// on every render and shown nowhere; with it, every cell above is readable as
// "above or below what everyone else did that week" instead of a bare number.
const LEAGUE_KEY = { actual: 'avgActual', projected: 'avgProjected', luck: 'avgLuck' };

function renderWeeklyTable() {
  const s = state.stats;
  const metric = state.weeklyMetric;
  const useSign = metric === 'luck' || metric === 'actualDiff';
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
  const weekScales = new Map(s.weekNumbers.map((w) => [w, heatScale(
    s.teams.map((t) => {
      const row = t.weekly.find((x) => x.week === w);
      return row ? row[metric] : null;
    })
  )]));

  const teamAvg = (t) => {
    const vals = t.weekly.map((r) => r[metric]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  // The Avg column is its own group: ten season averages, which are the same
  // kind of number as each other and NOT the same kind as a single week.
  const avgScale = showAvg ? heatScale(s.teams.map(teamAvg)) : null;

  tbody.innerHTML = s.teams
    .map((t) => {
      const cells = s.weekNumbers.map((w) => {
        const row = t.weekly.find((x) => x.week === w);
        if (!row) return `<td>${dash}</td>`;
        return heatCell(row[metric], weekScales.get(w), {
          what: `what the league did in week ${w}`,
          text: cell(row[metric]),
        });
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

  const key = LEAGUE_KEY[metric];
  const tfoot = table.querySelector('tfoot');
  if (tfoot) {
    if (key) {
      const weekly = s.weekNumbers.map((w) =>
        s.weeklyLeagueAverages.find((a) => a.week === w)
      );
      const vals = weekly.map((a) => (a ? a[key] : null)).filter((v) => typeof v === 'number');
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      tfoot.innerHTML =
        `<tr><td class="name">League</td>` +
        weekly.map((a) => `<td>${a ? cell(a[key]) : dash}</td>`).join('') +
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
  $('weeklyKey').innerHTML = anyScale
    ? '<strong>Colour is down each week, not across the season</strong>: each cell against ' +
      'what the other nine teams did that week. Green is above that week’s average, red ' +
      'below, in four steps; the darkest carry ▲ or ▼. Tap a number for where it stands.'
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
    'All four measures point the same way here — more points, a better projection, more ' +
    'luck and a bigger margin are all good for the team — so green always means good on ' +
    'this grid whichever button is pressed.',
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
