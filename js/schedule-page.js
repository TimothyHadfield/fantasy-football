// Wires the schedule page together: pick a data source, pick a week, render
// matchups, a sortable results table and the head-to-head grid.

import { fetchSchedule } from './season.js';
import { generateDemoLeague } from './demo.js';
import * as espn from './espn.js';
import { enableSort, resort } from './sortable.js';

const $ = (id) => document.getElementById(id);

const state = {
  source: 'demo',
  data: null,        // normalised schedule (see normalizeSchedule)
  week: 'all',       // 'all' or a week number
  filterTeam: '',    // '' or a team id, for the results table only
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

const round1 = (n) => Math.round(n * 10) / 10;

const dash = '<span class="muted">—</span>';

/** First word of a team name, trimmed, for the head-to-head column headers. */
function shortName(name) {
  const full = String(name).trim();
  const first = full.split(/\s+/)[0];
  const s = first.length >= 3 ? first : full;
  return s.length > 11 ? s.slice(0, 10) + '…' : s;
}

// -------------------------------------------------------------------- loading

/**
 * demo-rosters.js is being written alongside this page, so it may not exist.
 * Import it dynamically: if it's there we use its generateDemoSchedule(), and
 * if it isn't we derive the same shape from the demo league in demo.js. Either
 * way the page loads.
 */
async function demoSchedule() {
  try {
    const mod = await import('./demo-rosters.js');
    if (typeof mod.generateDemoSchedule === 'function') return mod.generateDemoSchedule();
  } catch {
    // Module missing or failed to parse — fall through to the local builder.
  }
  return scheduleFromDemoLeague(generateDemoLeague());
}

/** Turn demo.js's league (games with homeActual/awayActual) into schedule shape. */
function scheduleFromDemoLeague(league) {
  const nameById = new Map(league.teams.map((t) => [t.id, t.name]));

  const games = league.games.map((g) => {
    const home = g.homeActual;
    const away = g.awayActual;
    const played = typeof home === 'number' && typeof away === 'number';
    return {
      week: g.week,
      homeId: g.homeId,
      homeName: nameById.get(g.homeId) || `Team ${g.homeId}`,
      homeScore: played ? round1(home) : null,
      awayId: g.awayId,
      awayName: nameById.get(g.awayId) || `Team ${g.awayId}`,
      awayScore: played ? round1(away) : null,
      played,
      margin: played ? round1(home - away) : null,
      winner: played ? (home > away ? 'home' : away > home ? 'away' : 'tie') : null,
    };
  });

  return {
    leagueName: league.name,
    teams: league.teams.map((t) => ({ id: t.id, name: t.name })),
    games,
    isDemo: true,
  };
}

/**
 * Fill in anything a source left out and guarantee byWeek is a real Map, so
 * the renderers never have to guess. Cheap insurance against a slightly
 * different demo-rosters.js.
 */
function normalizeSchedule(raw, { isDemo }) {
  const games = raw.games || [...(raw.byWeek?.values?.() || [])].flat();

  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  // Prefer the source's team list; otherwise recover it from the games.
  let teams = raw.teams;
  if (!teams || !teams.length) {
    const seen = new Map();
    for (const g of games) {
      if (g.homeId != null && !seen.has(g.homeId)) seen.set(g.homeId, g.homeName);
      if (g.awayId != null && !seen.has(g.awayId)) seen.set(g.awayId, g.awayName);
    }
    teams = [...seen].map(([id, name]) => ({ id, name }));
  }

  return {
    leagueName: raw.leagueName || (isDemo ? 'Demo League' : 'Your league'),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    weeks,
    byWeek,
    games,
    isDemo,
  };
}

async function loadDemo() {
  setStatus('Generated sample data — not your real league.');
  const raw = await demoSchedule();
  adopt(normalizeSchedule(raw, { isDemo: true }));
}

async function loadLive() {
  const saved = JSON.parse(localStorage.getItem('ff.config') || '{}');
  if (!saved.leagueId) {
    setStatus('No league connected yet. Set one up on the Connection page first.', true);
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season || 2026 });
  setStatus('Loading your schedule from ESPN…');

  try {
    const raw = await fetchSchedule();
    const data = normalizeSchedule(raw, { isDemo: false });

    if (!data.games.length) {
      setStatus(
        `Connected to ${esc(data.leagueName)}, but ESPN returned no matchups. ` +
        `If the season hasn't started, try an earlier season on the Connection page.`,
        true
      );
      return;
    }

    const played = data.games.filter((g) => g.played).length;
    setStatus(
      `Loaded ${data.games.length} matchup${data.games.length === 1 ? '' : 's'} ` +
      `from ${esc(data.leagueName)} — ${played} played.`
    );
    adopt(data);
  } catch (err) {
    setStatus(err.message, true);
  }
}

/** Take on a freshly loaded schedule and reset the week/team pickers. */
function adopt(data) {
  state.data = data;
  state.week = defaultWeek(data);
  state.filterTeam = '';
  render();
}

/** Land on the most recent week that has a result — that's what people want. */
function defaultWeek(data) {
  const playedWeeks = data.weeks.filter((w) =>
    (data.byWeek.get(w) || []).some((g) => g.played)
  );
  return playedWeeks.length ? playedWeeks[playedWeeks.length - 1] : (data.weeks[0] ?? 'all');
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

// --------------------------------------------------------------------- render

function render() {
  const d = state.data;
  if (!d) return;

  $('modeBadge').className = 'badge ' + (d.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = d.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = d.isDemo
    ? 'Showing a generated sample season so you can see the layout with real-looking results in it.'
    : `${d.leagueName} · ${d.weeks.length} week${d.weeks.length === 1 ? '' : 's'} · ${d.teams.length} teams`;

  renderWeekPicker();
  renderTeamPicker();
  renderSummary();
  renderMatchups();
  renderResults();
  renderH2H();
}

function renderWeekPicker() {
  const sel = $('weekSelect');
  sel.innerHTML =
    '<option value="all">All weeks</option>' +
    state.data.weeks.map((w) => `<option value="${w}">Week ${w}</option>`).join('');
  sel.value = String(state.week);
}

function renderTeamPicker() {
  const sel = $('filterTeam');
  sel.innerHTML =
    '<option value="">Every team</option>' +
    state.data.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  sel.value = state.filterTeam === '' ? '' : String(state.filterTeam);
}

function renderSummary() {
  const played = state.data.games.filter((g) => g.played);
  const total = state.data.games.length;

  if (!played.length) {
    $('summary').innerHTML =
      `<div class="stat"><div class="k">Games played</div><div class="v">0</div></div>` +
      `<div class="stat"><div class="k">Scheduled</div><div class="v">${total}</div></div>`;
    $('summaryNote').textContent = 'Nothing has been played yet, so there is nothing to compare.';
    return;
  }

  const combined = (g) => g.homeScore + g.awayScore;
  const gap = (g) => Math.abs(g.margin);

  const highest = played.reduce((a, b) => (combined(b) > combined(a) ? b : a));
  const blowout = played.reduce((a, b) => (gap(b) > gap(a) ? b : a));
  const closest = played.reduce((a, b) => (gap(b) < gap(a) ? b : a));

  const items = [
    ['Highest-scoring game', fmt(combined(highest))],
    ['Biggest blowout', fmt(gap(blowout))],
    ['Closest game', fmt(gap(closest))],
    ['Games played', `${played.length}<span class="muted"> / ${total}</span>`],
  ];

  $('summary').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  // The headline numbers are meaningless without the games behind them.
  const line = (label, g) =>
    `<strong>${label}:</strong> ${esc(g.homeName)} ${fmt(g.homeScore)} – ` +
    `${fmt(g.awayScore)} ${esc(g.awayName)} (week ${g.week})`;

  $('summaryNote').innerHTML = [
    line('Highest scoring', highest),
    line('Biggest blowout', blowout),
    line('Closest', closest),
  ].join('<br>');
}

function renderMatchups() {
  const d = state.data;
  const weeks = state.week === 'all' ? d.weeks : [Number(state.week)];

  $('matchupsTitle').textContent =
    state.week === 'all' ? 'Matchups — all weeks' : `Week ${state.week} matchups`;

  const blocks = weeks
    .map((w) => {
      const games = d.byWeek.get(w) || [];
      if (!games.length) return '';
      const cards = games.map(gameCard).join('');
      // Only label the week when several are on screen at once.
      const head = state.week === 'all' ? `<p class="week-head">Week ${w}</p>` : '';
      return `<div class="week-block">${head}<div class="matchups">${cards}</div></div>`;
    })
    .filter(Boolean)
    .join('');

  $('matchups').innerHTML = blocks || '<div class="empty">No matchups to show.</div>';
}

function gameCard(g) {
  const bye = g.awayId === null || g.awayId === undefined;

  // Winner emphasised, loser dimmed; an unplayed game gets neither, so it
  // never reads as a 0–0 loss.
  const cls = (side) =>
    !g.played ? 'side' : g.winner === 'tie' ? 'side' : `side ${g.winner === side ? 'win' : 'lose'}`;

  const row = (side, name, score) =>
    `<div class="${cls(side)}">
       <span class="tname">${esc(name)}</span>
       <span class="tscore">${g.played ? fmt(score) : dash}</span>
     </div>`;

  let meta;
  if (bye) meta = 'Bye week';
  else if (!g.played) meta = 'Upcoming';
  else if (g.winner === 'tie') meta = 'Tied';
  else {
    const winnerName = g.winner === 'home' ? g.homeName : g.awayName;
    meta = `${esc(winnerName)} by ${fmt(Math.abs(g.margin))}`;
  }

  return `<div class="game${g.played ? '' : ' upcoming'}">
      ${row('home', g.homeName, g.homeScore)}
      ${bye ? '' : row('away', g.awayName, g.awayScore)}
      <div class="gmeta">${meta}</div>
    </div>`;
}

function renderResults() {
  const table = $('resultsTable');
  const tbody = table.querySelector('tbody');

  const id = state.filterTeam === '' ? null : Number(state.filterTeam);
  const rows = state.data.games.filter(
    (g) => id === null || g.homeId === id || g.awayId === id
  );

  tbody.innerHTML = rows.map(resultRow).join('');

  // Keep whatever sort the user picked when the row set changes.
  resort(table);

  const played = rows.filter((g) => g.played).length;
  $('resultsNote').textContent =
    `${rows.length} game${rows.length === 1 ? '' : 's'} listed, ${played} played. ` +
    `Click any header to sort.`;
}

function resultRow(g) {
  const won = (side) => g.played && g.winner === side;
  const nameCell = (side, name, extra) => {
    const cls = !g.played || g.winner === 'tie' ? '' : won(side) ? 'win' : 'lose';
    return `<td class="${extra} ${cls}">${esc(name)}</td>`;
  };

  const score = (v) => (g.played ? fmt(v) : dash);

  // Margin is shown as the winning margin; the Winner column carries the side.
  const marginCell = g.played
    ? `<td data-v="${Math.abs(g.margin)}">${fmt(Math.abs(g.margin))}</td>`
    : `<td>${dash}</td>`;

  const winnerCell = !g.played
    ? `<td class="left">${dash}</td>`
    : g.winner === 'tie'
      ? '<td class="left muted">Tie</td>'
      : `<td class="left">${esc(g.winner === 'home' ? g.homeName : g.awayName)}</td>`;

  return `<tr>
      <td>${g.week}</td>
      ${nameCell('home', g.homeName, 'name')}
      <td>${score(g.homeScore)}</td>
      ${nameCell('away', g.awayName, 'left')}
      <td>${score(g.awayScore)}</td>
      ${marginCell}
      ${winnerCell}
    </tr>`;
}

// ---------------------------------------------------------------- head to head

/**
 * record.get(a).get(b) is team a's {w, l, t} against team b.
 * Every played game writes both directions at once, so the matrix is always
 * symmetric: a's win is b's loss.
 */
function headToHead() {
  const ids = state.data.teams.map((t) => t.id);
  const record = new Map(
    ids.map((a) => [a, new Map(ids.map((b) => [b, { w: 0, l: 0, t: 0 }]))])
  );

  for (const g of state.data.games) {
    if (!g.played) continue;
    if (g.homeId == null || g.awayId == null) continue;      // bye
    if (!record.has(g.homeId) || !record.has(g.awayId)) continue;

    const home = record.get(g.homeId).get(g.awayId);
    const away = record.get(g.awayId).get(g.homeId);

    if (g.winner === 'tie') { home.t++; away.t++; }
    else if (g.winner === 'home') { home.w++; away.l++; }
    else { away.w++; home.l++; }
  }

  return record;
}

function renderH2H() {
  const teams = state.data.teams;
  const record = headToHead();

  if (!teams.length) {
    $('h2hGrid').innerHTML = '<div class="empty">No teams to compare.</div>';
    return;
  }

  const head =
    '<th class="name" data-sort>Team</th>' +
    '<th data-sort>Overall</th>' +
    teams
      .map((t) => `<th data-sort title="${esc(t.name)}">${esc(shortName(t.name))}</th>`)
      .join('');

  const body = teams
    .map((row) => {
      let w = 0, l = 0, t = 0;
      const cells = teams
        .map((col) => {
          if (col.id === row.id) return '<td class="self">·</td>';
          const r = record.get(row.id).get(col.id);
          w += r.w; l += r.l; t += r.t;
          if (!r.w && !r.l && !r.t) return `<td>${dash}</td>`;
          const label = r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
          const cls = r.w > r.l ? 'pos' : r.w < r.l ? 'neg' : 'muted';
          // Sort a column by how far ahead the row team is against that opponent.
          return `<td data-v="${r.w - r.l}" class="${cls}">${label}</td>`;
        })
        .join('');

      const overall = t ? `${w}-${l}-${t}` : `${w}-${l}`;
      return `<tr>
          <td class="name">${esc(row.name)}</td>
          <td data-v="${w - l}">${overall}</td>
          ${cells}
        </tr>`;
    })
    .join('');

  // The header cells are team names, so they change with the data. Rebuilding
  // the whole table is fine here: this only runs on a full data load, never on
  // a filter change, so no sort the user picked is lost. (sortable.js delegates
  // from the table element, so replacing just the thead would also have worked
  // — a fresh node simply needs enableSort called on it again.)
  $('h2hGrid').innerHTML =
    `<table class="h2h"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  enableSort($('h2hGrid').querySelector('table'));
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  $('sourceToggle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  state.source = btn.dataset.src;
  state.source === 'demo' ? loadDemo() : loadLive();
});

$('weekSelect').addEventListener('change', (e) => {
  state.week = e.target.value === 'all' ? 'all' : Number(e.target.value);
  renderMatchups();
});

$('filterTeam').addEventListener('change', (e) => {
  state.filterTeam = e.target.value;
  renderResults();
});

// Sorted by week, ascending, until the user says otherwise.
enableSort($('resultsTable'), { defaultIndex: 0, defaultAsc: true });

loadDemo();
