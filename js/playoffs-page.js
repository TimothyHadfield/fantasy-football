// The Playoffs page (Tim, 2026-10-16): "everything you need to know about the
// playoffs" in one place, out of numbers the site already works out.
//
//   Teams    every team's chance of making the playoffs and of a first-round
//            bye, and its projected points in each playoff week.
//   Players  js/playoffs-players.js, mounted into #poPlayers once the league
//            is read. It is loaded by a dynamic import so this page works
//            without it.
//
// NOTHING HERE IS NEW MATHS. The odds are the Schedule page's simulation, run
// through the same builder (`capture.simulationInputs`) with the same spread
// (`capture.leagueSpread`), the same projections (`capture.buildProjection`,
// floors included), the same seed and the same default run count, so a
// percentage here is the percentage on Schedule's Simulate season table. The
// weekly figures are the very numbers that simulation plays the bracket with:
// each team's best legal lineup that week, off ESPN's per-player projections
// (`proj.get(week).get(teamId)`). An assumed trade reaches them through
// js/season.js's week rosters, as on every other forward page.

import * as season from './season.js';
import { generateDemoLeague } from './demo.js';
import * as espn from './espn.js';
import * as forecast from './forecast.js';
import * as capture from './capture.js';
import { describeFloors } from './floor.js';
import { heatScale, heatOf, heatMarkHtml } from './heat.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('playoffs');

// The Schedule page's seed and default run count (js/schedule-page.js
// SIM_SEED, SIM_RUN_CHOICE's default), so the two pages print the same odds.
export const SIM_RUNS = 10000;
export const SIM_SEED = 20260901;
// Whole per cent, so half of one printed digit (schedule-page PCT_MIN_SPREAD).
const PCT_MIN_SPREAD = 0.005;

const state = {
  source: prefs.get('source', 'demo'),
  data: null,
  asOf: 0,
  proj: null,          // week -> teamId -> best-lineup points (buildProjection)
  started: null,       // week -> teamId -> started lineup's projection (spread)
  floors: null,
  floorWeek: null,
  live: null,          // capture.liveWeek — the week in progress, or null
  projNote: '',
  pending: false,      // rosters still being read
  sim: null,           // { key, result }
  simToken: 0,
  loadToken: 0,
  myTeamId: null,
  sourceSummary: '',
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dash = '<span class="muted">—</span>';

/** A probability as a whole per cent — js/schedule-page.js's `pctText`. */
function pctText(p) {
  if (!Number.isFinite(p)) return '—';
  const v = Math.min(100, Math.max(0, p * 100));
  if (v > 0 && v < 0.5) return '&lt;1%';
  if (v < 100 && v >= 99.5) return '&gt;99%';
  return `${Math.round(v)}%`;
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

// --------------------------------------------------------------------- loading

/** The sample league's schedule, with demo.js's per-game projections put back. */
async function demoSchedule() {
  let raw = null;
  try {
    const mod = await import('./demo-rosters.js');
    if (typeof mod.generateDemoSchedule === 'function') raw = mod.generateDemoSchedule();
  } catch { /* fall through */ }
  if (!raw) {
    const league = generateDemoLeague();
    const nameById = new Map(league.teams.map((t) => [t.id, t.name]));
    raw = {
      leagueName: league.name,
      teams: league.teams.map((t) => ({ id: t.id, name: t.name })),
      games: league.games.map((g) => ({
        week: g.week, homeId: g.homeId, awayId: g.awayId,
        homeName: nameById.get(g.homeId), awayName: nameById.get(g.awayId),
        homeScore: g.homeActual, awayScore: g.awayActual, played: true,
      })),
    };
  }
  const data = capture.normalizeSchedule(raw, { isDemo: true });
  // Same join as js/schedule-page.js `withDemoProjections`: week + home team.
  const src = new Map(generateDemoLeague().games.map((g) => [`${g.week}:${g.homeId}`, g]));
  for (const g of data.games) {
    if (typeof g.homeProjected === 'number') continue;
    const s = src.get(`${g.week}:${g.homeId}`);
    if (!s || s.awayId !== g.awayId) continue;
    g.homeProjected = s.homeProjected;
    g.awayProjected = s.awayProjected;
  }
  return data;
}

async function loadDemo() {
  const token = ++state.loadToken;
  state.myTeamId = null;
  setStatus('Generated sample data — not your real league.');
  const data = await demoSchedule();
  if (token !== state.loadToken) return;
  let mod = null;
  try { mod = await import('./demo-rosters.js'); } catch { mod = null; }
  if (token !== state.loadToken) return;
  // The sample season "is" at week 4, as on the Players, Trade and Analysis
  // pages (demo-rosters.js DEMO_CURRENT_WEEK); everything from there on is
  // played out.
  const asOf = mod?.DEMO_CURRENT_WEEK ?? data.weeks[0];
  const weeks = capture.playoffWeeks(data);
  let proj = null;
  if (mod && typeof mod.generateDemoWeekRosters === 'function') {
    const weekTeams = new Map(weeks.map((w) => [w, mod.generateDemoWeekRosters(w)?.teams || []]));
    const built = capture.buildProjection(data, capture.pickWeeks(weekTeams, weeks), null);
    proj = built ? built.proj : null;
  }
  adopt(data, {
    asOf, proj, started: null, floors: null, floorWeek: null, live: null,
    projNote: 'Sample league: each playoff week is the best legal lineup from its sample rosters.',
  });
  state.sourceSummary = '';
}

async function loadLive() {
  const saved = savedConfig();
  if (!saved) {
    setStatus('No league connected yet. Connect one in the bar above.', true);
    return false;
  }
  const token = ++state.loadToken;
  const stale = () => token !== state.loadToken;
  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.myTeamId = saved.teamId ?? null;
  setStatus('Loading your league from ESPN…');

  let data;
  try {
    data = capture.normalizeSchedule(await season.fetchSchedule(), { isDemo: false });
  } catch (err) {
    if (!stale()) setStatus(esc(err.message), true);
    return false;
  }
  if (stale()) return true;
  if (!data.games.length) {
    setStatus(`Connected to ${esc(data.leagueName)}, but ESPN returned no matchups.`, true);
    return false;
  }
  state.sourceSummary = `Loaded ${esc(data.leagueName)}.`;
  adopt(data, { asOf: capture.liveAsOf(data), proj: null, started: null, pending: true });

  // THE SCHEDULE PAGE'S READ (refreshStrength): the same weeks, the same floor
  // week, the same builder, in the order asked for.
  const plan = capture.rosterPlan(data);
  const floorWeek = capture.floorWeek(data);
  const floorRead = (typeof season.fetchFloors === 'function' && floorWeek
    ? season.fetchFloors(floorWeek) : Promise.resolve(null))
    .then((f) => (f && f.size ? f : null)).catch(() => null);
  let weekTeams = new Map();
  try {
    weekTeams = await season.fetchWeeksRosters(plan.asking, {
      onProgress: (done, total) => {
        if (stale() || done >= total) return;
        setStatus(`Reading ESPN’s projections… week ${done} of ${total}.`);
      },
    });
  } catch { weekTeams = new Map(); }
  const floors = await floorRead;
  if (stale()) return true;

  const toProject = capture.pickWeeks(weekTeams, plan.project);
  const started = capture.startedProjections(weekTeams, plan.decided);
  const built = toProject.size ? capture.buildProjection(data, toProject, floors) : null;
  let live = null;
  if (built && typeof season.fetchProGames === 'function') {
    let proGames = null;
    try { proGames = await season.fetchProGames(); } catch { proGames = null; }
    if (stale()) return true;
    if (proGames && Object.keys(proGames).length) {
      const week = capture.openWeeks(data)[0];
      live = capture.liveWeek({
        data, weekTeams: toProject, slots: built.slots, floors, proGames,
        asOf: typeof season.weekReadAt === 'function' ? season.weekReadAt(week) : null,
      });
    }
  }
  setStatus(state.sourceSummary);
  const floorSaid = built ? describeFloors(floors, { week: floorWeek }) : '';
  adopt(data, {
    asOf: capture.liveAsOf(data),
    proj: built ? built.proj : null,
    started, floors, floorWeek, live,
    projNote: built
      ? `Each playoff week is ESPN’s own per-player projection for that week, with the best legal lineup filled.${floorSaid ? ` ${floorSaid}` : ''}`
      : 'ESPN returned no usable projection for the weeks ahead.',
  });
  return true;
}

function adopt(data, o) {
  state.data = data;
  state.asOf = o.asOf;
  state.proj = o.proj || null;
  state.started = o.started || null;
  state.floors = o.floors || null;
  state.floorWeek = o.floorWeek ?? null;
  state.live = o.live || null;
  state.projNote = o.projNote || '';
  state.pending = Boolean(o.pending);
  state.sim = null;
  state.simToken++;
  render();
  if (!state.pending) mountPlayers();
}

// The player list (another file). Once, after the first league is on screen.
let playersMounted = false;
function mountPlayers() {
  if (playersMounted) return;
  playersMounted = true;
  import('./playoffs-players.js').then((m) => m.mountPlayoffPlayers(document.getElementById('poPlayers'))).catch(() => {});
}

// ------------------------------------------------------------------ simulation

/** Is this game still ahead of the as-of point? Schedule's `isRemaining`. */
function isRemaining(g) {
  return state.data.isDemo ? g.week >= state.asOf : capture.gameState(g) !== 'final';
}

/** Everything simulateSeason needs — Schedule's `simInputs`, unchanged. */
function simInputs() {
  const d = state.data;
  if (!d || !d.teams.length) return null;
  const spread = capture.leagueSpread(d, (g) => !isRemaining(g), state.started);
  const built = capture.simulationInputs({
    data: d,
    isRemaining,
    proj: state.proj,
    sigma: spread.sigma,
    live: d.isDemo ? null : state.live,
  });
  if (!built) return null;
  return { ...built, spread, key: JSON.stringify([SIM_RUNS, state.asOf, ...built.keyParts]) };
}

function runSimulation(inputs) {
  const token = ++state.simToken;
  const later = (fn) => setTimeout(fn, 0);
  const kick = typeof requestAnimationFrame === 'function'
    ? (fn) => requestAnimationFrame(() => later(fn)) : later;
  kick(() => {
    if (token !== state.simToken || !state.data) return;
    const result = forecast.simulateSeason({
      teamIds: inputs.teamIds,
      banked: inputs.banked,
      games: inputs.games,
      sigma: inputs.sigma,
      runs: SIM_RUNS,
      seed: SIM_SEED,
      playoff: inputs.playoff,
    });
    if (token !== state.simToken || !state.data) return;
    state.sim = { key: inputs.key, result };
    renderTeams();
  });
}

// ---------------------------------------------------------------------- render

function render() {
  const d = state.data;
  if (!d) return;
  $('modeBadge').className = 'badge ' + (d.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = d.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = d.isDemo
    ? `A generated sample league, as of week ${state.asOf}.`
    : `${d.leagueName} · ${d.teams.length} teams`;
  syncSource();
  renderTeams();
}

function syncSource() {
  $('sourceToggle').querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

function renderTeams() {
  const d = state.data;
  if (!d) return;
  const table = $('poTeams');
  const weeks = capture.playoffWeeks(d);

  // The head: name, the two chances, then one column per playoff week.
  table.querySelector('thead').innerHTML = '<tr>' +
    '<th class="name" data-sort>Team</th>' +
    '<th data-sort title="How often this team made the playoffs in the simulated seasons.">Playoffs %</th>' +
    '<th data-sort title="How often this team seeded high enough to skip the first playoff round.">Bye %</th>' +
    weeks.map((w) => `<th data-sort data-week="${w}" title="Projected points in week ${w}: the best legal lineup.">Wk ${w}</th>`).join('') +
    '</tr>';
  const cols = 3 + weeks.length;
  const tbody = table.querySelector('tbody');
  const blank = (msg) => {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">${msg}</td></tr>`;
    $('poKey').hidden = true;
    $('poNote').innerHTML = noteHtml(null);
  };

  if (state.pending) return blank('Reading ESPN’s projections…');
  const inputs = simInputs();
  if (!inputs) return blank('No teams in this league yet.');
  if (!inputs.games.length && !weeks.some((w) => state.proj?.get(w))) {
    return blank('The regular season is decided: nothing left to play out.');
  }
  if (inputs.games.length && !inputs.playable) return blank('No projection for the games left, so nothing to play out.');
  if (!state.sim || state.sim.key !== inputs.key) {
    blank(`Simulating ${SIM_RUNS.toLocaleString('en-US')} seasons…`);
    runSimulation(inputs);
    return;
  }
  const sim = state.sim.result;
  if (!sim) return blank('This season could not be simulated.');

  const byId = new Map(sim.teams.map((t) => [t.teamId, t]));
  const ptsOf = (w, id) => {
    const v = state.proj?.get(w)?.get(id);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const rows = d.teams.map((t) => ({
    id: t.id,
    name: t.name,
    pPlayoffs: byId.get(t.id)?.pPlayoffs ?? null,
    pBye: byId.get(t.id)?.pBye ?? null,
    pts: weeks.map((w) => ptsOf(w, t.id)),
  }));
  // Most likely to make it first, then the bye, then the name.
  rows.sort((a, b) => (b.pPlayoffs ?? -1) - (a.pPlayoffs ?? -1) ||
    (b.pBye ?? -1) - (a.pBye ?? -1) || String(a.name).localeCompare(String(b.name)));

  // THE ONE RED/GREEN SCALE (rule 14), per column: the two chances with the
  // Schedule page's probability guard, each week's points with the default.
  const scales = {
    playoffs: heatScale(rows.map((r) => r.pPlayoffs), { minSpread: PCT_MIN_SPREAD }),
    bye: heatScale(rows.map((r) => r.pBye), { minSpread: PCT_MIN_SPREAD }),
    weeks: weeks.map((_, i) => heatScale(rows.map((r) => r.pts[i]))),
  };
  const cell = (v, text, scale) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return `<td>${dash}</td>`;
    const h = heatOf(v, scale);
    return `<td data-v="${v}"${h ? ` class="${h.cls}"` : ''}>${text}${heatMarkHtml(h)}</td>`;
  };

  tbody.innerHTML = rows.map((r) => {
    const me = !d.isDemo && r.id === state.myTeamId;
    return `<tr data-team="${esc(r.id)}"${me ? ' class="me"' : ''}>` +
      `<td class="name">${esc(r.name)}</td>` +
      cell(r.pPlayoffs, pctText(r.pPlayoffs), scales.playoffs) +
      cell(r.pBye, pctText(r.pBye), scales.bye) +
      r.pts.map((v, i) => cell(v, Number.isFinite(v) ? v.toFixed(1) : '', scales.weeks[i])).join('') +
      '</tr>';
  }).join('');
  resort(table);

  $('poKey').hidden = false;
  $('poKey').textContent = 'Green is better than the league in that column, red worse.';
  $('poNote').innerHTML = noteHtml(sim, inputs);
}

function noteHtml(sim, inputs = null) {
  const d = state.data;
  const field = capture.playoffTeams(d);
  const known = capture.playoffTeamsKnown(d);
  const parts = [
    `Playoffs % and Bye % are the Schedule page’s simulation: the rest of the regular season ` +
    `and the bracket played out ${SIM_RUNS.toLocaleString('en-US')} times from each game’s two ` +
    `projected totals${inputs ? `, with a spread of ${inputs.spread.sigma.toFixed(1)} points ` +
    `${inputs.spread.calibrated ? 'measured from this league’s results' : 'assumed until enough games are played'}` : ''}. ` +
    `ESPN publishes projections, never odds.`,
    `${field} teams make the playoffs${known ? '' : ' (assumed: the league’s setting could not be read)'}` +
    `${sim?.playoff?.byes ? `, and the top ${plural(sim.playoff.byes, 'seed')} skip the first round` : ''}.`,
    state.projNote,
    `Colours compare each number only with the other teams in the same column.`,
  ];
  return parts.filter(Boolean).map((s) => `<p>${s}</p>`).join('');
}

// ----------------------------------------------------------------- interaction

let sourcePicked = false;
$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  sourcePicked = true;
  state.source = btn.dataset.src;
  prefs.set('source', state.source);
  syncSource();
  if (state.source === 'demo') loadDemo();
  else loadLive();
});

// Playoffs % first, highest at the top: the panel's question.
enableSort($('poTeams'), { defaultIndex: 1, defaultAsc: false });

// A league the connection bar finds after boot: go live, unless parked on demo.
let triedLive = false;
onConnection((conn) => {
  if (!conn) return;
  if (state.source === 'live') {
    state.myTeamId = conn.teamId ?? null;
    if (state.data) renderTeams();
    return;
  }
  if (triedLive || sourcePicked || prefs.get('source') === 'demo') return;
  triedLive = true;
  state.source = 'live';
  syncSource();
  loadLive();
});

// Sync now, or a roster move js/season.js noticed: read the league again.
document.addEventListener('ff:refresh', (e) => {
  if (state.source === 'live') e.detail.waitUntil(loadLive());
});

syncSource();
if (state.source === 'live' && savedConfig()) {
  loadLive().then((ok) => {
    if (ok) return;
    const why = $('sourceStatus').innerHTML;
    state.source = 'demo';
    syncSource();
    loadDemo().then(() => setStatus(`${why} Showing demo data instead.`, true));
  });
} else {
  state.source = 'demo';
  loadDemo();
}
