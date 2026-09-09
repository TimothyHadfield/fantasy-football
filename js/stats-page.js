// Wires the stats page together: pick a data source, compute, render.
//
// Everything here was built and checked against a finished 2025 season, where
// every panel had thirteen weeks under it. A season starts with one. Most of
// the branching below exists for that: a chart or a number that cannot say
// anything honest yet says so, rather than drawing a confident shape out of a
// single game.

import { generateDemoLeague } from './demo.js';
import { computeLeagueStats } from './stats.js';
import { fetchSeasonData } from './season.js';
import * as espn from './espn.js';
import { lineChart, histogram, boxPlot, SERIES_COLORS } from './charts.js';
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

/** Whole points, thousands-separated. A raw 1467 next to one-decimal
 *  neighbours was the only unformatted number on the page. */
const int = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Math.round(n).toLocaleString('en-US');

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Weeks with a completed game in them — the number every guard here turns on. */
const weekCount = () => (state.stats ? state.stats.weekNumbers.length : 0);

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

    if (!data.games.length) {
      setStatus(
        `Connected to ${esc(data.name)}, but no completed matchups were found for ` +
        `${data.season}. If the season hasn't started, try an earlier season.`,
        true
      );
      return false;
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

  const weeks = weekCount();

  $('modeBadge').className = 'badge ' + (s.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = s.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = s.isDemo
    ? 'Showing generated sample data so you can see the layout with a full season in it.'
    : `${s.name} · ${s.season} · ${plural(weeks, 'week')} played`;

  renderTeamPicker();
  renderGlance();
  renderMainTable();
  renderCharts();
  renderAccuracy();
  renderWeeklyTable();
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
  const top = [...s.teams].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)[0];
  const box = s.leagueActualBox;   // null before there are five scores in the league
  const overall = s.predictionAccuracy.find((a) => a.threshold === 0);

  const items = [
    ['Teams', s.teams.length],
    ['Weeks', weeks],
    // With one week an "average" is just that week, so it says so.
    [weeks === 1 ? `Week ${s.weekNumbers[0]} avg` : 'League avg', fmt(s.leagueAvgActual)],
    [weeks === 1 ? 'Projected' : 'Avg projected', fmt(s.leagueAvgProjected)],
    ['Highest week', box ? fmt(box.max) : dash],
    ['Lowest week', box ? fmt(box.min) : dash],
    ['Best record', top ? `${record(top)} ${esc(top.name)}` : dash],
    ['Projection accuracy', accuracyTile(overall)],
  ];

  $('glance').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');
}

/**
 * A light background tint across one column, so the magnitude columns can be
 * scanned as a picture instead of read serially. It encodes size only — a big
 * Opp Avg is a hard schedule, not a good week — and the alpha ceiling keeps the
 * numbers legible on the dark surface. Inline because the ramp is per-render
 * data, not a fixed class.
 */
function heatScale(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || !(hi > lo)) return '';
    const t = (v - lo) / (hi - lo);
    return ` style="background:rgba(59,165,93,${(0.03 + t * 0.14).toFixed(3)})"`;
  };
}

function renderMainTable() {
  const s = state.stats;
  const table = $('mainTable');
  const tbody = table.querySelector('tbody');
  const thin = weekCount() < MIN_WEEKS;

  // Everything downstream of the close-game luck curve is suppressed while the
  // season is short. The curve clamps to ±50 for any margin under about 5.5
  // points, so a 3-point week-1 win prints +41 and a 3-point loss −51: a
  // 92-point spread out of one game, where the whole verified 2025 column
  // spanned about ±15. The maths is untouched; it is simply not shown yet.
  const luck = (v) => (thin ? dash : signed(v));
  const rank = (v, hide) => (hide || v === null ? dash : `<span class="rank">${v}</span>`);

  const heatAvg = heatScale(s.teams.map((t) => t.avgActual));
  const heatProj = heatScale(s.teams.map((t) => t.avgProjected));
  const heatOpp = heatScale(s.teams.map((t) => t.oppAvgActual));

  tbody.innerHTML = s.teams
    .map((t) => `
      <tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>
        <td data-v="${t.wins + t.pointsFor / 100000}">${record(t)}</td>
        <td${heatAvg(t.avgActual)}>${fmt(t.avgActual)}</td>
        <td${heatProj(t.avgProjected)}>${fmt(t.avgProjected)}</td>
        <td data-v="${t.totalActual}">${int(t.totalActual)}</td>
        <td${heatOpp(t.oppAvgActual)}>${fmt(t.oppAvgActual)}</td>
        <td>${signed(t.forMinusAgainst)}</td>
        <td>${fmt(t.actualStdev)}</td>
        <td>${signed(t.avgLuck)}</td>
        <td>${fmt(t.pointsToWin)}</td>
        <td>${luck(t.scoreDiffLuck)}</td>
        <td>${luck(t.luckScore)}</td>
        <td>${signed(t.skill)}</td>
        <td>${luck(t.skillPlusLuck)}</td>
        <td>${rank(t.luckStanding, thin)}</td>
        <td>${rank(t.projectedStanding, thin)}</td>
        <td>${rank(t.actualStanding, false)}</td>
      </tr>`)
    .join('');

  // Single-week columns are that week's score, not an average of anything.
  const oneWeek = weekCount() === 1;
  $('thScoringGroup').textContent = oneWeek ? `Scoring — week ${s.weekNumbers[0]} only` : 'Scoring';
  $('thAvg').textContent = oneWeek ? 'Score' : 'Avg';
  $('thOppAvg').textContent = oneWeek ? 'Opp score' : 'Opp Avg';

  $('mainTableNote').innerHTML =
    'Hover any heading for what that column means. Click one to sort by it. ' +
    '<strong>Luck/wk</strong> = actual − projected. <strong>PTW</strong> = what you ' +
    'needed to score to beat a typical opponent. <strong>Skill</strong> = your average ' +
    'projected score minus the league&rsquo;s. <strong>LS</strong>, <strong>PS</strong> ' +
    'and <strong>AS</strong> rank the league by luck score, by skill + luck, and by ' +
    'actual record.' +
    (thin
      ? ` Close luck, luck score, S+L, LS and PS are held back until week ${MIN_WEEKS}: ` +
        'from one or two games they swing further than a whole season of them does.'
      : '');

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

  $('distNote').textContent = trends
    ? 'Every team’s weekly score, in ten-point buckets.'
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
    `<strong>${plural(weeks, 'week')} of data so far.</strong> Weekly scores, weekly ` +
    `luck, cumulative luck and per-team spread appear from week ${MIN_WEEKS} — with ` +
    'less than that they draw a shape that is not in the data.',
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
  tbody.innerHTML = s.teams
    .map((t) => {
      const cells = s.weekNumbers.map((w) => {
        const row = t.weekly.find((x) => x.week === w);
        return row ? `<td>${cell(row[metric])}</td>` : `<td>${dash}</td>`;
      });
      const vals = t.weekly.map((r) => r[metric]).filter((v) => typeof v === 'number');
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return `<tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>${cells.join('')}
        ${showAvg ? `<td>${cell(avg)}</td>` : ''}
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

  $('weeklyNote').textContent = key
    ? 'The League row is what all ten teams averaged that week, so each cell above ' +
      'can be read against the week it was played in.'
    : 'Margin is your score minus your opponent’s, so the league row would be zero ' +
      'every week by construction and is left out.';

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
