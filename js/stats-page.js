// Wires the stats page together: pick a data source, compute, render.

import { generateDemoLeague } from './demo.js';
import { computeLeagueStats } from './stats.js';
import { fetchSeasonData } from './season.js';
import * as espn from './espn.js';
import { lineChart, histogram, boxPlot, SERIES_COLORS } from './charts.js';
import { enableSort, resort } from './sortable.js';

const $ = (id) => document.getElementById(id);

const state = {
  source: 'demo',
  stats: null,
  highlight: null,      // team id to emphasise (charts.js also has its own
                        // click-to-highlight on the legend it draws)
  weeklyMetric: 'actual',
};

// ------------------------------------------------------------------ formatting

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);

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

// --------------------------------------------------------------------- loading

async function loadDemo() {
  setStatus('Generated sample data — not your real league.');
  const data = generateDemoLeague();
  state.stats = computeLeagueStats(data);
  render();
}

async function loadLive() {
  const saved = JSON.parse(localStorage.getItem('ff.config') || '{}');
  if (!saved.leagueId) {
    setStatus('No league connected yet. Set one up on the Connection page first.', true);
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season || 2026 });
  setStatus('Loading your league from ESPN…');

  try {
    const data = await fetchSeasonData({
      onProgress: (done, total, label) =>
        setStatus(`${label} (${done}/${total})`),
    });

    if (!data.games.length) {
      setStatus(
        `Connected to ${data.name}, but no completed matchups were found for ` +
        `${data.season}. If the season hasn't started, try an earlier season.`,
        true
      );
      return;
    }

    state.stats = computeLeagueStats(data);

    if (!data.projectionsAvailable) {
      setStatus(
        `Loaded ${data.gamesFound} games from ${data.name}, but ESPN only returned ` +
        `weekly projections for ${data.gamesWithProjections} of them. Anything ` +
        `built on projections (luck, skill, projection accuracy) will be wrong or ` +
        `blank for the missing weeks.`,
        true
      );
    } else {
      setStatus(`Loaded ${data.gamesFound} games from ${esc(data.name)}.`);
    }
    render();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

// -------------------------------------------------------------------- render

function render() {
  const s = state.stats;
  if (!s) return;

  $('modeBadge').className = 'badge ' + (s.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = s.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = s.isDemo
    ? 'Showing generated sample data so you can see the layout with a full season in it.'
    : `${s.name} · ${s.season} · ${s.weeks} weeks`;

  renderTeamPicker();
  renderGlance();
  renderMainTable();
  renderPending();
  renderCharts();
  renderAccuracy();
  renderWeeklyTable();
}

function renderTeamPicker() {
  const sel = $('highlightTeam');
  const current = state.highlight;
  sel.innerHTML =
    '<option value="">None</option>' +
    state.stats.teams
      .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
      .join('');
  if (current !== null) sel.value = String(current);
}

function renderGlance() {
  const s = state.stats;
  const top = [...s.teams].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)[0];
  const highest = s.leagueActualBox.max;
  const lowest = s.leagueActualBox.min;
  const overall = s.predictionAccuracy.find((a) => a.threshold === 0);

  const items = [
    ['Teams', s.teams.length],
    ['Weeks', s.weeks],
    ['League avg', fmt(s.leagueAvgActual)],
    ['Avg projected', fmt(s.leagueAvgProjected)],
    ['Highest week', fmt(highest)],
    ['Lowest week', fmt(lowest)],
    ['Best record', `${top.wins}–${top.losses} ${esc(top.name)}`],
    ['Projection accuracy', overall && overall.accuracy !== null
      ? `${Math.round(overall.accuracy * 100)}%` : '—'],
  ];

  $('glance').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');
}

function renderMainTable() {
  const table = $('mainTable');
  const tbody = table.querySelector('tbody');

  tbody.innerHTML = state.stats.teams
    .map((t) => `
      <tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>
        <td data-v="${t.wins + t.pointsFor / 100000}">${t.wins}–${t.losses}</td>
        <td>${fmt(t.avgActual)}</td>
        <td>${fmt(t.avgProjected)}</td>
        <td>${signed(t.avgLuck)}</td>
        <td>${t.totalActual}</td>
        <td>${fmt(t.oppAvgActual)}</td>
        <td>${signed(t.skill)}</td>
        <td>${signed(t.forMinusAgainst)}</td>
        <td>${fmt(t.actualStdev)}</td>
      </tr>`)
    .join('');

  // Default to standings order; afterwards keep whatever the user picked.
  enableSort(table, { defaultIndex: 1 });
  resort(table);
}

function renderPending() {
  $('pendingCols').innerHTML =
    '<strong>Not built yet</strong> — these columns from your sheet need their formulas: ' +
    '<code>PTW</code> (projection to win), <code>SD</code> in the luck block, ' +
    'cumulative luck (the &ldquo;adjusted formula&rdquo;), the third column in your ' +
    'Score Differential table, and the LS / PS standings that depend on them.';
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

  histogram($('chartDist'), {
    bins: s.distribution10.bins,
    counts: s.distribution10.counts,
    yLabel: 'Weeks',
    height: 260,
  });

  boxPlot($('chartBox'), {
    rows: [...s.teams]
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
  });
}

function renderAccuracy() {
  const acc = state.stats.predictionAccuracy;
  const table = $('accuracyTable');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = acc
    .map((a) => `
      <tr>
        <td class="name" data-v="${a.threshold}">${a.label}</td>
        <td>${a.games}</td>
        <td>${a.correct}</td>
        <td data-v="${a.accuracy === null ? '' : a.accuracy}">${
          a.accuracy === null ? '<span class="muted">—</span>'
            : `${Math.round(a.accuracy * 100)}%`}</td>
      </tr>`)
    .join('');

  enableSort(table);
  resort(table);

  const ties = acc.tiedProjections || 0;
  $('accuracyNote').textContent = ties
    ? `${ties} game${ties === 1 ? '' : 's'} had both teams projected identically, so ` +
      `the projection made no pick there. Those are excluded.`
    : '';
}

function renderWeeklyTable() {
  const s = state.stats;
  const metric = state.weeklyMetric;

  $('weeklyHead').innerHTML =
    '<th class="name" data-sort>Team</th>' +
    s.weekNumbers.map((w) => `<th data-sort>${w}</th>`).join('') +
    '<th data-sort>Avg</th>';

  const table = $('weeklyTable');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = s.teams
    .map((t) => {
      const cells = s.weekNumbers.map((w) => {
        const row = t.weekly.find((x) => x.week === w);
        if (!row) return '<td class="muted">—</td>';
        const v = row[metric];
        const useSign = metric === 'luck' || metric === 'actualDiff';
        return `<td>${useSign ? signed(v, 0) : fmt(v, 0)}</td>`;
      });
      const vals = t.weekly.map((r) => r[metric]).filter((v) => typeof v === 'number');
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const useSign = metric === 'luck' || metric === 'actualDiff';
      return `<tr class="${state.highlight === t.id ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>${cells.join('')}
        <td>${useSign ? signed(avg, 1) : fmt(avg)}</td>
      </tr>`;
    })
    .join('');

  // Headers are rebuilt above, but sortable.js delegates from the table
  // itself, so the wiring survives.
  enableSort(table);
  resort(table);
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  $('sourceToggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  state.source = btn.dataset.src;
  state.source === 'demo' ? loadDemo() : loadLive();
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
  renderMainTable();
  renderCharts();
  renderWeeklyTable();
});

loadDemo();
