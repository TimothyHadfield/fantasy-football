// Roster analysis: one week at a time, every manager's team laid out in full.
//
// Rosters move week to week — trades, waivers, injuries — so the week selector
// is the primary control here. Everything else re-renders from whatever week is
// selected.

import { fetchWeekRosters, fetchSchedule } from './season.js';
import { enableSort, resort } from './sortable.js';
import * as espn from './espn.js';

const $ = (id) => document.getElementById(id);

const DEMO_WEEKS = 13;

const state = {
  source: 'demo',
  week: DEMO_WEEKS,
  weeks: [],        // weeks offered in the dropdown
  data: null,       // {week, teams:[...]} for the selected week
  teamId: null,     // team shown in the roster detail
  isDemo: true,
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

// Sort order for the Slot column: starters in lineup order, then bench, then IR.
// Sorting on the visible text would put "BE" above "QB", which is nonsense.
const SLOT_ORDER = {
  0: 1, 1: 1,               // QB / team QB
  2: 2,                     // RB
  4: 3,                     // WR
  6: 4,                     // TE
  3: 5, 5: 5, 7: 5, 23: 5,  // the flex family
  16: 6,                    // D/ST
  17: 7,                    // K
  18: 8, 19: 9,             // P, HC
  20: 50,                   // bench
  21: 51,                   // IR
};

const INJURY_LABELS = {
  QUESTIONABLE: 'Q',
  DOUBTFUL: 'D',
  OUT: 'OUT',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'SUSP',
  DAY_TO_DAY: 'DTD',
};

function injuryCell(status) {
  if (!status || status === 'ACTIVE' || status === 'NORMAL') {
    return '<td class="muted" data-v="">—</td>';
  }
  const label = INJURY_LABELS[status] || status.replace(/_/g, ' ');
  const severe = status === 'OUT' || status === 'INJURY_RESERVE' || status === 'SUSPENSION';
  return `<td data-v="${esc(label)}"><span class="inj${severe ? ' out' : ''}">${esc(label)}</span></td>`;
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

async function loadWeek() {
  const key = `${state.source}:${state.week}`;
  if (cache.has(key)) {
    state.data = cache.get(key);
    render();
    return;
  }

  state.data = null;
  render(); // show the empty state while the fetch is in flight

  if (state.source === 'demo') {
    const generate = await getDemoGenerator();
    if (!generate) {
      setStatus(
        'Demo roster data isn’t available yet (js/demo-rosters.js is missing). ' +
        'Switch to <strong>My ESPN league</strong> to see real rosters.',
        true
      );
      return;
    }
    setStatus('Generated sample rosters — not your real league.');
    state.data = generate(state.week);
  } else {
    setStatus(`Loading week ${state.week} rosters from ESPN…`);
    try {
      state.data = await fetchWeekRosters(state.week);
      setStatus(`Week ${state.week} · ${state.data.teams.length} teams loaded from ESPN.`);
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
  }

  cache.set(key, state.data);
  render();
}

async function useDemo() {
  state.source = 'demo';
  state.isDemo = true;
  state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  if (!state.weeks.includes(state.week)) state.week = DEMO_WEEKS;
  renderWeekPicker();
  await loadWeek();
}

async function useLive() {
  const saved = JSON.parse(localStorage.getItem('ff.config') || '{}');
  if (!saved.leagueId) {
    state.isDemo = false;
    state.data = null;
    render();
    setStatus('No league connected yet. Set one up on the Connection page first.', true);
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season || 2026 });
  state.source = 'live';
  state.isDemo = false;
  cache.clear();

  // Which weeks actually happened? The schedule knows; if it can't be read we
  // fall back to offering the standard regular season.
  setStatus('Finding which weeks have data…');
  try {
    const schedule = await fetchSchedule();
    const played = schedule.games.filter((g) => g.played).map((g) => g.week);
    const weeks = [...new Set(played)].sort((a, b) => a - b);
    state.weeks = weeks.length ? weeks : schedule.weeks;
  } catch {
    state.weeks = [];
  }
  if (!state.weeks.length) state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);

  state.week = state.weeks[state.weeks.length - 1]; // latest week with data
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

  $('overviewTitle').textContent = `League overview · week ${state.week}`;

  renderOverview();
  renderTeamPicker();
  renderRoster();
}

function renderWeekPicker() {
  const sel = $('weekSelect');
  sel.innerHTML = state.weeks.map((w) => `<option value="${w}">Week ${w}</option>`).join('');
  sel.value = String(state.week);
}

function renderOverview() {
  const table = $('overviewTable');
  const tbody = table.tBodies[0];
  const teams = state.data ? state.data.teams : [];

  $('overviewWrap').classList.toggle('hidden', teams.length === 0);
  $('overviewEmpty').classList.toggle('hidden', teams.length > 0);

  tbody.innerHTML = teams
    .map((t) => {
      const d = diff(t.actualTotal, t.projectedTotal);
      return `
      <tr class="${t.id === state.teamId ? 'me' : ''}">
        <td class="name">${esc(t.name)}</td>
        <td>${fmt(t.projectedTotal)}</td>
        <td>${fmt(t.actualTotal)}</td>
        <td data-v="${d === null ? '' : d}">${signed(d)}</td>
        <td>${fmt(t.benchActualTotal)}</td>
        <td>${fmt(t.seasonProjectedTotal)}</td>
      </tr>`;
    })
    .join('');

  resort(table); // keep whatever sort the user picked across week changes
}

function renderTeamPicker() {
  const sel = $('teamSelect');
  const teams = state.data ? state.data.teams : [];

  sel.innerHTML = teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

  // Hold the selection across weeks when that manager is still in the league.
  if (!teams.some((t) => t.id === state.teamId)) {
    state.teamId = teams.length ? teams[0].id : null;
  }
  if (state.teamId !== null) sel.value = String(state.teamId);
}

function currentTeam() {
  if (!state.data || state.teamId === null) return null;
  return state.data.teams.find((t) => t.id === state.teamId) || null;
}

function renderRoster() {
  const table = $('rosterTable');
  const tbody = table.tBodies[0];
  const team = currentTeam();
  const players = team ? team.players : [];

  $('rosterWrap').classList.toggle('hidden', players.length === 0);
  $('rosterEmpty').classList.toggle('hidden', players.length > 0);
  if (!team) {
    $('teamGlance').innerHTML = '';
    $('rosterNote').textContent = '';
    tbody.innerHTML = '';
    return;
  }

  const teamDiff = diff(team.actualTotal, team.projectedTotal);
  const glance = [
    ['Week', state.week],
    ['Projected', fmt(team.projectedTotal)],
    ['Actual', fmt(team.actualTotal)],
    ['Diff', signed(teamDiff)],
    ['Bench points', fmt(team.benchActualTotal)],
    ['Starters', team.starters.length],
    ['Bench', team.bench.length],
  ];
  $('teamGlance').innerHTML = glance
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  tbody.innerHTML = players
    .map((p) => {
      const d = diff(p.actual, p.projected);
      const order = SLOT_ORDER[p.lineupSlotId] ?? 40;
      const own = typeof p.percentOwned === 'number' ? `${p.percentOwned.toFixed(0)}%` : '—';
      return `
      <tr class="${p.started ? '' : 'bench'}">
        <td data-v="${order}"><span class="slot-tag">${esc(p.slot)}</span></td>
        <td class="name">${esc(p.name)}</td>
        <td>${esc(p.position)}</td>
        <td>${esc(p.proTeam)}</td>
        <td>${fmt(p.projected)}</td>
        <td>${fmt(p.actual)}</td>
        <td data-v="${d === null ? '' : d}">${signed(d)}</td>
        <td>${fmt(p.seasonProjected)}</td>
        <td data-v="${typeof p.percentOwned === 'number' ? p.percentOwned : ''}">${own}</td>
        ${injuryCell(p.injuryStatus)}
      </tr>`;
    })
    .join('');

  const hurt = players.filter(
    (p) => p.injuryStatus && p.injuryStatus !== 'ACTIVE' && p.injuryStatus !== 'NORMAL'
  ).length;
  $('rosterNote').textContent =
    `Bench and IR rows are dimmed. ${hurt} player${hurt === 1 ? '' : 's'} carrying an ` +
    `injury designation this week.`;

  resort(table);
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  $('sourceToggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  btn.dataset.src === 'demo' ? useDemo() : useLive();
});

$('weekSelect').addEventListener('change', (e) => {
  state.week = Number(e.target.value);
  loadWeek();
});

$('teamSelect').addEventListener('change', (e) => {
  state.teamId = Number(e.target.value);
  renderOverview(); // the selected team is highlighted in the overview too
  renderRoster();
});

// Overview defaults to actual points, high first; the roster to lineup order.
enableSort($('overviewTable'), { defaultIndex: 2 });
enableSort($('rosterTable'), { defaultIndex: 0, defaultAsc: true });

useDemo();
