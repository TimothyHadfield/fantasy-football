// Wires the schedule page together: pick a data source, pick a week, and read
// the league four ways — standings, this week's matchups, every result, and a
// grid of who plays who.
//
// The page is read from week 1 onwards, so most of what it shows is a game that
// has NOT been played. Every view here therefore has to say something useful
// about an unplayed matchup: a layout that only comes alive once the season is
// over is the mistake this file used to make, and it went unnoticed because the
// demo season it always booted into was complete by definition.

import { fetchSchedule, fetchWeekRosters } from './season.js';
import { generateDemoLeague } from './demo.js';
import * as espn from './espn.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('schedule');

const state = {
  source: prefs.get('source', 'demo'),
  data: null,               // normalised schedule (see normalizeSchedule)
  week: 'all',              // 'all' or a week number — drives the three week panels
  filterTeam: '',           // '' or a team id, for the results table only
  resultsView: prefs.get('results', 'played'),  // played | upcoming | all
  h2hView: prefs.get('h2h', null),              // null = decide from what's played
  myTeamId: null,           // highlights one row, when we know who you are
  strength: null,           // Map teamId -> comparable strength, any scale
  strengthNote: '',         // how that strength was derived; shown, never implied
  strengthToken: 0,         // guards against a slow fetch landing after a reload
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The stats page writes records with an en dash; this page used a hyphen. One
// league, one way of writing 8–5.
const EN = '–';
const recordText = (r) => (r.t ? `${r.w}${EN}${r.l}${EN}${r.t}` : `${r.w}${EN}${r.l}`);

/** Margin with its sign kept: which way it went is the whole point. */
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

/** First word of a team name, trimmed, for the head-to-head column headers. */
function shortName(name) {
  const full = String(name).trim();
  const first = full.split(/\s+/)[0];
  const s = first.length >= 3 ? first : full;
  return s.length > 11 ? s.slice(0, 10) + '…' : s;
}

// ----------------------------------------------------------------- game state

/**
 * final | live | upcoming, decided here rather than trusted from the source.
 *
 * season.js marks a game played when EITHER side has points. Mid-week that is
 * wrong in the worst possible way: one team's players have finished and the
 * other's have not, so the game flips to played, with a winner and an 80-point
 * margin, and the card confidently reports a final score for a game half of
 * which has not kicked off. Exactly one side on the board means in progress.
 */
function gameState(g) {
  const scored = (v) => typeof v === 'number' && v > 0;

  // A bye has no away side to compare against; trust the source there.
  if (g.awayId === null || g.awayId === undefined) return g.played ? 'final' : 'upcoming';

  if (scored(g.homeScore) !== scored(g.awayScore)) return 'live';
  if (!scored(g.homeScore) && !scored(g.awayScore)) return 'upcoming';
  return g.played ? 'final' : 'live';
}

/** Recomputed from the scores, so a mis-set `winner` upstream can't leak in. */
function winnerOf(g) {
  if (gameState(g) !== 'final') return null;
  if (typeof g.homeScore === 'number' && typeof g.awayScore === 'number') {
    return g.homeScore > g.awayScore ? 'home' : g.awayScore > g.homeScore ? 'away' : 'tie';
  }
  return g.winner;
}

/** Home points minus away points. Positive means the home team won. */
function marginOf(g) {
  if (typeof g.homeScore === 'number' && typeof g.awayScore === 'number') {
    return round1(g.homeScore - g.awayScore);
  }
  return null;
}

const finalGames = (games = state.data.games) => games.filter((g) => gameState(g) === 'final');

/** The games the week picker is currently pointing at. */
function weekGames() {
  const d = state.data;
  return state.week === 'all' ? d.games : d.byWeek.get(Number(state.week)) || [];
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
      homeProjected: g.homeProjected ?? null,
      awayId: g.awayId,
      awayName: nameById.get(g.awayId) || `Team ${g.awayId}`,
      awayScore: played ? round1(away) : null,
      awayProjected: g.awayProjected ?? null,
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
 * demo.js scores every game with a projection as well as an actual, and both
 * schedule builders copy only the actuals across. The projection is the only
 * thing an unplayed demo game can show, so put it back by joining on week plus
 * home team — same seed, same fixtures, so the join is exact. A miss just
 * leaves the game without a projection rather than inventing one.
 */
function withDemoProjections(data) {
  const source = new Map();
  for (const g of generateDemoLeague().games) source.set(`${g.week}:${g.homeId}`, g);

  for (const g of data.games) {
    if (typeof g.homeProjected === 'number') continue;
    const src = source.get(`${g.week}:${g.homeId}`);
    if (!src || src.awayId !== g.awayId) continue;
    g.homeProjected = src.homeProjected;
    g.awayProjected = src.awayProjected;
  }
  return data;
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
  state.myTeamId = null;
  const raw = await demoSchedule();
  adopt(withDemoProjections(normalizeSchedule(raw, { isDemo: true })));
}

async function loadLive() {
  // savedConfig() reads whichever key the connection bar or the Connection page
  // wrote; this page used to read one of them directly and silently never
  // found a league saved by the other.
  const saved = savedConfig();
  if (!saved) {
    setStatus('No league connected yet. Connect one in the bar above, or on the Connection page.', true);
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.myTeamId = saved.teamId ?? null;
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

    const done = finalGames(data.games).length;
    setStatus(
      `Loaded ${plural(data.games.length, 'matchup')} from ${esc(data.leagueName)} — ` +
      `${done} played, ${data.games.length - done} still to come.`
    );
    adopt(data);
  } catch (err) {
    setStatus(err.message, true);
  }
}

/** Take on a freshly loaded schedule and reset what belongs to the old one. */
function adopt(data) {
  state.data = data;
  state.week = restoreWeek(data);
  state.filterTeam = '';
  state.strength = null;
  state.strengthNote = '';
  render();
  refreshStrength();
}

/** The remembered week if it still exists in this league, else the live one. */
function restoreWeek(data) {
  const saved = prefs.get('week', null);
  if (saved === 'all') return 'all';
  if (typeof saved === 'number' && data.weeks.includes(saved)) return saved;
  return currentWeek(data);
}

/**
 * The week the league is actually on: the last one with something on the board,
 * or the first week of the season if nothing has been played at all.
 */
function currentWeek(data = state.data) {
  const started = data.weeks.filter((w) =>
    (data.byWeek.get(w) || []).some((g) => gameState(g) !== 'upcoming')
  );
  return started.length ? started[started.length - 1] : data.weeks[0] ?? 'all';
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

// -------------------------------------------------------------------- strength
//
// One number per team, used only to rank how hard the rest of the schedule
// looks. The scale never matters — a rank is scale-free — but where it came
// from does, so every basis carries the sentence that explains it.

function strengthFromGameProjections() {
  const acc = new Map();
  for (const g of state.data.games) {
    const add = (id, v) => {
      if (id == null || typeof v !== 'number' || v <= 0) return;
      const cur = acc.get(id) || { total: 0, n: 0 };
      cur.total += v;
      cur.n++;
      acc.set(id, cur);
    };
    add(g.homeId, g.homeProjected);
    add(g.awayId, g.awayProjected);
  }
  if (acc.size < state.data.teams.length) return null;
  return new Map([...acc].map(([id, a]) => [id, a.total / a.n]));
}

/** Points per game so far. Honest, but nearly meaningless in September. */
function strengthFromScoring() {
  const acc = new Map();
  for (const g of finalGames()) {
    const add = (id, v) => {
      if (id == null || typeof v !== 'number') return;
      const cur = acc.get(id) || { total: 0, n: 0 };
      cur.total += v;
      cur.n++;
      acc.set(id, cur);
    };
    add(g.homeId, g.homeScore);
    add(g.awayId, g.awayScore);
  }
  if (acc.size < state.data.teams.length) return null;
  return new Map([...acc].map(([id, a]) => [id, a.total / a.n]));
}

/** How many weeks have a completed game in them — the thinness of the sample. */
function weeksPlayed() {
  return new Set(finalGames().map((g) => g.week)).size;
}

/**
 * Fill in state.strength, then repaint just the two panels that use it. Nothing
 * else waits for this, so the page appears immediately and the run-in column
 * fills in a moment later rather than everything blocking on ESPN.
 */
async function refreshStrength() {
  const token = ++state.strengthToken;
  const stale = () => token !== state.strengthToken;

  const fromProjections = strengthFromGameProjections();
  if (fromProjections) {
    apply(fromProjections, 'Strength is each team’s average projected points.');
    return;
  }

  if (!state.data.isDemo) {
    // One request: this week's rosters carry ESPN's season projection for
    // whoever is currently starting, which is the cheapest forward-looking
    // signal available.
    try {
      const { teams } = await fetchWeekRosters(currentWeek());
      if (stale()) return;
      const m = new Map(
        teams
          .filter((t) => typeof t.seasonProjectedTotal === 'number' && t.seasonProjectedTotal > 0)
          .map((t) => [t.id, t.seasonProjectedTotal])
      );
      if (m.size >= state.data.teams.length) {
        apply(m, 'Strength is ESPN’s season projection for each team’s current starters.');
        return;
      }
    } catch {
      // ESPN said no; fall through to what we can compute from the scores.
    }
  }

  if (stale()) return;

  const fromScoring = strengthFromScoring();
  if (!fromScoring) {
    apply(null, 'No projections available and not every team has played, so the run-in is not ranked yet.');
    return;
  }

  const w = weeksPlayed();
  const thin = w < 4 ? ` Thin this early — it is ${plural(w, 'week')} of scoring.` : '';
  apply(fromScoring, `No projections available, so strength is points per game so far.${thin}`);

  function apply(map, note) {
    if (stale() || !state.data) return;
    state.strength = map;
    state.strengthNote = note;
    renderStandings();
    renderMatchups();   // an unplayed card falls back to the strength ranking
  }
}

/**
 * Remaining strength of schedule: the mean strength of the opponents a team has
 * still to play, shown as a rank because the raw mean means nothing on its own
 * and changes units with the basis. Rank 1 is the hardest run-in.
 */
function remainingSos() {
  if (!state.strength) return null;

  const acc = new Map(state.data.teams.map((t) => [t.id, { total: 0, n: 0 }]));
  for (const g of state.data.games) {
    if (gameState(g) === 'final') continue;          // only what is left to play
    if (g.homeId == null || g.awayId == null) continue;
    const add = (id, oppId) => {
      const s = state.strength.get(oppId);
      const cur = acc.get(id);
      if (!cur || typeof s !== 'number') return;
      cur.total += s;
      cur.n++;
    };
    add(g.homeId, g.awayId);
    add(g.awayId, g.homeId);
  }

  const means = [...acc]
    .filter(([, a]) => a.n > 0)
    .map(([id, a]) => ({ id, mean: a.total / a.n }));
  if (!means.length) return null;

  means.sort((a, b) => b.mean - a.mean);            // hardest first
  return new Map(means.map((m, i) => [m.id, { rank: i + 1, mean: m.mean, of: means.length }]));
}

// --------------------------------------------------------------------- render

function render() {
  const d = state.data;
  if (!d) return;

  syncSource();

  $('modeBadge').className = 'badge ' + (d.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = d.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = d.isDemo
    ? 'Showing a generated sample season so you can see the layout with real-looking results in it.'
    : `${d.leagueName} · ${d.weeks.length} week${d.weeks.length === 1 ? '' : 's'} · ${d.teams.length} teams`;

  renderWeekPicker();
  renderTeamPicker();
  renderStandings();
  renderSummary();
  renderMatchups();
  renderResults();
  renderH2H();
}

function syncSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

/** Mark the one button in a segmented control that matches `value`. */
function syncSegmented(id, value) {
  $(id)
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.view === value));
}

function renderWeekPicker() {
  const sel = $('weekSelect');
  const weeks = state.data.weeks;

  // Only rebuild when the league itself changed: rewriting the options under a
  // select the user is in the middle of using is needlessly jumpy.
  const signature = weeks.join(',');
  if (sel.dataset.weeks !== signature) {
    sel.innerHTML =
      '<option value="all">All weeks</option>' +
      weeks.map((w) => `<option value="${w}">Week ${w}</option>`).join('');
    sel.dataset.weeks = signature;
  }
  sel.value = String(state.week);

  const i = weeks.indexOf(Number(state.week));
  $('weekPrev').disabled = state.week !== 'all' && i <= 0;
  $('weekNext').disabled = state.week !== 'all' && i >= weeks.length - 1;

  const where =
    state.week === 'all' ? 'All weeks' : `Week ${state.week} of ${weeks[weeks.length - 1]}`;
  $('weekNote').textContent =
    `${where} · sets the summary, matchups and results below. Standings and the grid stay season-to-date.`;
}

function renderTeamPicker() {
  const sel = $('filterTeam');
  sel.innerHTML =
    '<option value="">Every team</option>' +
    state.data.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  sel.value = state.filterTeam === '' ? '' : String(state.filterTeam);
}

// ------------------------------------------------------------------ standings

/** Season-to-date record, points for and against, and the run-in rank. */
function standingsRows() {
  const record = headToHead();
  const totals = new Map(state.data.teams.map((t) => [t.id, { pf: 0, pa: 0, gp: 0 }]));

  for (const g of finalGames()) {
    const add = (id, mine, theirs) => {
      const cur = totals.get(id);
      if (!cur || typeof mine !== 'number' || typeof theirs !== 'number') return;
      cur.pf += mine;
      cur.pa += theirs;
      cur.gp++;
    };
    add(g.homeId, g.homeScore, g.awayScore);
    add(g.awayId, g.awayScore, g.homeScore);
  }

  const sos = remainingSos();

  return state.data.teams.map((t) => {
    const row = record.get(t.id);
    const rec = { w: 0, l: 0, t: 0 };
    for (const opp of state.data.teams) {
      if (opp.id === t.id) continue;
      const r = row.get(opp.id);
      rec.w += r.w;
      rec.l += r.l;
      rec.t += r.t;
    }
    const tot = totals.get(t.id);
    return { team: t, rec, pf: round1(tot.pf), pa: round1(tot.pa), sos: sos?.get(t.id) || null };
  });
}

function renderStandings() {
  const table = $('standingsTable');
  const tbody = table.querySelector('tbody');
  const rows = standingsRows();

  tbody.innerHTML = rows
    .map(({ team, rec, pf, pa, sos }) => {
      const cls = rec.w > rec.l ? 'pos' : rec.w < rec.l ? 'neg' : 'muted';
      // Wins first, points for as the tie-break — the same order the league
      // itself uses, packed into the one number sortable.js reads.
      const sortKey = rec.w + pf / 100000;

      let sosCell = `<td>${dash}</td>`;
      if (sos) {
        // Rank 1 is the hardest run-in, so the warning colour goes at the top.
        const tone = sos.rank <= 3 ? 'neg' : sos.rank > sos.of - 3 ? 'pos' : '';
        sosCell =
          `<td data-v="${sos.rank}" class="${tone}" ` +
          `title="Opponents still to play average ${fmt(sos.mean)} on this measure.">` +
          `${sos.rank}<span class="muted">/${sos.of}</span></td>`;
      }

      return `<tr${team.id === state.myTeamId ? ' class="me"' : ''}>
          <td class="name">${esc(team.name)}</td>
          <td data-v="${sortKey}" class="${cls}">${recordText(rec)}</td>
          <td data-v="${pf}">${fmt(pf)}</td>
          <td data-v="${pa}">${fmt(pa)}</td>
          ${sosCell}
        </tr>`;
    })
    .join('');

  resort(table);

  const done = finalGames().length;
  const left = state.data.games.length - done;
  const runIn = left
    ? `“Rest of season” ranks the average strength of the opponents each team has still ` +
      `to play; 1 is the hardest run-in. ${state.strengthNote || 'Working out how hard the run-ins are…'}`
    : 'Every game has been played, so there is no run-in left to rank.';

  $('standingsNote').textContent =
    `Season to date — ${done} of ${state.data.games.length} games decided. ${runIn}`;
}

// -------------------------------------------------------------------- summary

function renderSummary() {
  const scoped = weekGames();
  const played = finalGames(scoped);
  const live = scoped.filter((g) => gameState(g) === 'live').length;
  const scopeLabel = state.week === 'all' ? 'the season to date' : `week ${state.week}`;

  $('summaryTitle').textContent = state.week === 'all' ? 'Season so far' : `Week ${state.week}`;

  if (!played.length) {
    $('summary').innerHTML =
      `<div class="stat"><div class="k">Games played</div><div class="v">0</div></div>` +
      `<div class="stat"><div class="k">Scheduled</div><div class="v">${scoped.length}</div></div>`;
    $('summaryNote').textContent = live
      ? `${plural(live, 'game')} in progress; nothing is final yet, so there is nothing to compare.`
      : `Nothing has been played in ${scopeLabel}, so there is nothing to compare.`;
    return;
  }

  const combined = (g) => g.homeScore + g.awayScore;
  const gap = (g) => Math.abs(marginOf(g));

  const highest = played.reduce((a, b) => (combined(b) > combined(a) ? b : a));
  const blowout = played.reduce((a, b) => (gap(b) > gap(a) ? b : a));
  const closest = played.reduce((a, b) => (gap(b) < gap(a) ? b : a));

  const items = [
    ['Highest-scoring game', fmt(combined(highest))],
    ['Biggest blowout', fmt(gap(blowout))],
    ['Closest game', fmt(gap(closest))],
    ['Games played', `${played.length}<span class="muted"> / ${scoped.length}</span>`],
  ];

  $('summary').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  // The headline numbers are meaningless without the games behind them — and,
  // three weeks into a season, without the size of the pool they came from.
  const line = (label, g) =>
    `<strong>${label}:</strong> ${esc(g.homeName)} ${fmt(g.homeScore)} – ` +
    `${fmt(g.awayScore)} ${esc(g.awayName)} (week ${g.week})`;

  $('summaryNote').innerHTML = [
    `Best and worst of ${plural(played.length, 'game')} in ${scopeLabel}` +
      (live ? `, with ${plural(live, 'game')} still in progress` : '') + '.',
    line('Highest scoring', highest),
    line('Biggest blowout', blowout),
    line('Closest', closest),
  ].join('<br>');
}

// ------------------------------------------------------------------- matchups

/**
 * Everything a card needs that isn't in the game itself: each team's record so
 * far, and a per-week points number to put against an unplayed matchup.
 * Computed once per render rather than once per card.
 */
function cardContext() {
  const record = headToHead();
  const records = new Map();
  for (const t of state.data.teams) {
    const rec = { w: 0, l: 0, t: 0 };
    for (const opp of state.data.teams) {
      if (opp.id === t.id) continue;
      const r = record.get(t.id).get(opp.id);
      rec.w += r.w;
      rec.l += r.l;
      rec.t += r.t;
    }
    records.set(t.id, rec);
  }
  // Season strength can be a season-long total (live), which would be nonsense
  // printed as a score, so the fallback for a card is always points per game.
  const ppg = strengthFromScoring();

  // Before anyone has scored there is no per-week number to show at all. The
  // strength ranking survives that, and a rank is safe to show whatever the
  // underlying measure is.
  let ranks = null;
  if (state.strength) {
    const order = [...state.strength].sort((a, b) => b[1] - a[1]);
    ranks = new Map(order.map(([id], i) => [id, i + 1]));
  }

  return { records, ppg, ranks };
}

/** 1st, 2nd, 3rd… */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/** A per-week points number for one side, and where it came from. */
function expectedFor(g, side, ctx) {
  const proj = side === 'home' ? g.homeProjected : g.awayProjected;
  if (typeof proj === 'number' && proj > 0) return { v: proj, basis: 'Projected' };

  const id = side === 'home' ? g.homeId : g.awayId;
  const p = ctx.ppg?.get(id);
  return typeof p === 'number' ? { v: p, basis: 'Points so far' } : null;
}

function renderMatchups() {
  const d = state.data;
  const weeks = state.week === 'all' ? d.weeks : [Number(state.week)];
  const ctx = cardContext();

  $('matchupsTitle').textContent =
    state.week === 'all' ? 'Matchups — all weeks' : `Week ${state.week} matchups`;

  const blocks = weeks
    .map((w) => {
      const games = d.byWeek.get(w) || [];
      if (!games.length) return '';
      const cards = games.map((g) => gameCard(g, ctx)).join('');
      // Only label the week when several are on screen at once.
      const head = state.week === 'all' ? `<p class="week-head">Week ${w}</p>` : '';
      return `<div class="week-block">${head}<div class="matchups">${cards}</div></div>`;
    })
    .filter(Boolean)
    .join('');

  $('matchups').innerHTML = blocks || '<div class="empty">No matchups to show.</div>';

  // An unplayed card carries a number, and a number whose basis isn't stated is
  // a number nobody can trust.
  const scoped = weeks.flatMap((w) => d.byWeek.get(w) || []);
  const upcoming = scoped.filter((g) => gameState(g) === 'upcoming');
  let basis = '';
  if (upcoming.length) {
    if (upcoming.some((g) => typeof g.homeProjected === 'number')) {
      basis = 'The number against an unplayed game is that team’s projection.';
    } else if (ctx.ppg) {
      basis = 'With no projections available, an unplayed game shows each team’s points per game so far.';
    } else if (ctx.ranks) {
      basis = 'Nobody has scored yet, so unplayed games are compared by strength ranking.';
    }
  }
  $('matchupsNote').textContent = `Records are season-to-date. ${basis}`.trim();
}

function gameCard(g, ctx) {
  const st = gameState(g);
  const bye = g.awayId === null || g.awayId === undefined;
  const winner = winnerOf(g);

  // Winner emphasised, loser dimmed. An unplayed or in-progress game gets
  // neither, so it never reads as a settled result.
  const sideClass = (side) =>
    st !== 'final' || winner === 'tie' ? '' : ` ${winner === side ? 'win' : 'lose'}`;

  const recordOf = (id) => {
    const r = ctx.records.get(id);
    return r ? `<span class="trec">${recordText(r)}</span>` : '';
  };

  const side = (which, name, id) =>
    `<div class="side ${which}${sideClass(which)}">
       <span class="tname">${esc(name)}</span>
       ${id == null ? '' : recordOf(id)}
     </div>`;

  const scoreCell = (which, score) => {
    if (st === 'final' || (st === 'live' && typeof score === 'number' && score > 0)) {
      const win = st === 'final' && winner === which ? ' win' : '';
      return `<div class="tscore ${which}${win}">${fmt(score)}</div>`;
    }
    const e = st === 'upcoming' ? expectedFor(g, which, ctx) : null;
    return `<div class="tscore ${which} proj">${e ? fmt(e.v) : '—'}</div>`;
  };

  let meta = '';
  let metaClass = 'gmeta';
  if (bye) {
    meta = 'Bye week';
  } else if (st === 'live') {
    // Half a scoreline is not a result. Say so instead of crowning anyone.
    metaClass += ' live';
    meta = 'In progress — one side still to play';
  } else if (st === 'final') {
    meta =
      winner === 'tie'
        ? 'Tied'
        : `${esc(winner === 'home' ? g.homeName : g.awayName)} by ${fmt(Math.abs(marginOf(g)))}`;
  } else {
    const h = expectedFor(g, 'home', ctx);
    const a = expectedFor(g, 'away', ctx);
    const hr = ctx.ranks?.get(g.homeId);
    const ar = ctx.ranks?.get(g.awayId);
    if (h && a) {
      const diff = h.v - a.v;
      meta =
        Math.abs(diff) < 0.5
          ? `${h.basis} · level`
          : `${h.basis} · ${esc(diff > 0 ? g.homeName : g.awayName)} by ${fmt(Math.abs(diff))}`;
    } else if (hr && ar) {
      // Week 1, nobody has scored: a ranking is the only honest comparison left.
      meta = `Strength ${ordinal(hr)} v ${ordinal(ar)}`;
    } else {
      meta = 'Upcoming';
    }
  }

  return `<div class="game ${st}">
      ${side('home', g.homeName, g.homeId)}
      ${scoreCell('home', g.homeScore)}
      <div class="vs">–</div>
      ${bye ? '<div class="tscore away">—</div>' : scoreCell('away', g.awayScore)}
      ${bye ? '<div class="side away"><span class="tname muted">Bye</span></div>'
            : side('away', g.awayName, g.awayId)}
      <div class="${metaClass}">${meta}</div>
    </div>`;
}

// -------------------------------------------------------------------- results

const VIEW_LABEL = { played: 'Played games', upcoming: 'Upcoming games', all: 'All games' };

function renderResults() {
  const table = $('resultsTable');
  const tbody = table.querySelector('tbody');
  syncSegmented('resultsView', state.resultsView);

  const id = state.filterTeam === '' ? null : Number(state.filterTeam);
  const scoped = weekGames().filter((g) => id === null || g.homeId === id || g.awayId === id);

  // Without this the table is mostly blank rows: at week 2 of a 13-week season
  // it listed ten results followed by fifty-five rows of em dashes.
  const rows = scoped.filter((g) => {
    const st = gameState(g);
    if (state.resultsView === 'played') return st !== 'upcoming';
    if (state.resultsView === 'upcoming') return st === 'upcoming';
    return true;
  });

  const counts = {
    final: scoped.filter((g) => gameState(g) === 'final').length,
    live: scoped.filter((g) => gameState(g) === 'live').length,
    upcoming: scoped.filter((g) => gameState(g) === 'upcoming').length,
  };

  if (!rows.length) {
    const where = state.week === 'all' ? 'this league' : `week ${state.week}`;
    const hint =
      state.resultsView === 'played'
        ? `Nothing has been played in ${where} yet — try Upcoming.`
        : state.resultsView === 'upcoming'
          ? `Every game in ${where} has been played.`
          : `No games match that filter.`;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${hint}</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(resultRow).join('');
  }

  // Keep whatever sort the user picked when the row set changes.
  resort(table);

  const parts = [];
  if (counts.final) parts.push(`${counts.final} final`);
  if (counts.live) parts.push(`${counts.live} in progress`);
  if (counts.upcoming) parts.push(`${counts.upcoming} upcoming`);

  $('resultsNote').textContent =
    `${VIEW_LABEL[state.resultsView]} — ${rows.length} of ${scoped.length} in scope: ` +
    `${parts.join(', ') || 'nothing scheduled'}. Click any header to sort.`;
}

const STATE_CELL = {
  final: '<td class="left muted" data-v="2">Final</td>',
  live: '<td class="left state-live" data-v="1">In progress</td>',
  upcoming: '<td class="left muted" data-v="0">Upcoming</td>',
};

function resultRow(g) {
  const st = gameState(g);
  const winner = winnerOf(g);

  // The win/lose classes are what makes the winner visible at all: they used to
  // be emitted here and only ever styled as `.side.win` on the cards, so every
  // row in this table rendered in the same colour.
  const nameCell = (which, name, extra) => {
    const cls = st !== 'final' || winner === 'tie' ? '' : winner === which ? 'win' : 'lose';
    return `<td class="${`${extra} ${cls}`.trim()}">${esc(name)}</td>`;
  };

  const score = (v) =>
    (st === 'final' || st === 'live') && typeof v === 'number' && v > 0 ? fmt(v) : dash;

  // Signed from the home team's point of view. The old absolute margin left the
  // Home, Away and Margin columns with no direction in them at all.
  const m = st === 'final' ? marginOf(g) : null;
  const marginCell = m === null ? `<td>${dash}</td>` : `<td data-v="${m}">${signed(m)}</td>`;

  return `<tr>
      <td data-v="${g.week}">${g.week}</td>
      ${nameCell('home', g.homeName, 'name')}
      <td>${score(g.homeScore)}</td>
      ${nameCell('away', g.awayName, 'left')}
      <td>${score(g.awayScore)}</td>
      ${marginCell}
      ${STATE_CELL[st]}
    </tr>`;
}

// ---------------------------------------------------------------- head to head

/**
 * record.get(a).get(b) is team a's {w, l, t} against team b.
 * Every completed game writes both directions at once, so the matrix is always
 * symmetric: a's win is b's loss.
 */
function headToHead() {
  const ids = state.data.teams.map((t) => t.id);
  const record = new Map(
    ids.map((a) => [a, new Map(ids.map((b) => [b, { w: 0, l: 0, t: 0 }]))])
  );

  for (const g of state.data.games) {
    if (gameState(g) !== 'final') continue;
    if (g.homeId == null || g.awayId == null) continue;      // bye
    if (!record.has(g.homeId) || !record.has(g.awayId)) continue;

    const home = record.get(g.homeId).get(g.awayId);
    const away = record.get(g.awayId).get(g.homeId);
    const winner = winnerOf(g);

    if (winner === 'tie') { home.t++; away.t++; }
    else if (winner === 'home') { home.w++; away.l++; }
    else { away.w++; home.l++; }
  }

  return record;
}

/** "a:b" -> the weeks those two teams meet, in order. */
function pairWeeks() {
  const map = new Map();
  const push = (a, b, g) => {
    const key = `${a}:${b}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(g);
  };
  for (const g of state.data.games) {
    if (g.homeId == null || g.awayId == null) continue;
    push(g.homeId, g.awayId, g);
    push(g.awayId, g.homeId, g);
  }
  for (const list of map.values()) list.sort((a, b) => a.week - b.week);
  return map;
}

/**
 * Records or fixtures?
 *
 * A records matrix needs a season behind it. At week 2 seventy of its ninety
 * comparative cells are empty, and even a finished season only has 25 of the 45
 * pairings meeting more than once. Early on, the same ten-by-ten grid answers a
 * question that actually has an answer: who does everyone still have to play?
 */
function h2hMode() {
  if (state.h2hView) return state.h2hView;
  const total = state.data.games.length;
  return total && finalGames().length / total >= 0.4 ? 'records' : 'schedule';
}

function renderH2H() {
  const teams = state.data.teams;
  const mode = h2hMode();
  syncSegmented('h2hView', mode);

  if (!teams.length) {
    $('h2hGrid').innerHTML = '<div class="empty">No teams to compare.</div>';
    $('h2hNote').textContent = '';
    return;
  }

  const cols = teams
    .map((t) => `<th data-sort title="${esc(t.name)}">${esc(shortName(t.name))}</th>`)
    .join('');

  const grid = mode === 'records' ? recordsGrid(teams, cols) : scheduleGrid(teams, cols);

  $('h2hTitle').textContent = mode === 'records' ? 'Head to head' : 'Who plays who';
  $('h2hNote').innerHTML = grid.note;

  // The header cells are team names, so they change with the data. Rebuilding
  // the whole table is fine here: this only runs on a full re-render, and
  // sortable.js is re-enabled on the fresh node below.
  $('h2hGrid').innerHTML =
    `<table class="h2h"><thead><tr>${grid.head}</tr></thead><tbody>${grid.body}</tbody></table>`;
  enableSort($('h2hGrid').querySelector('table'), grid.sort);
}

function recordsGrid(teams, cols) {
  const record = headToHead();

  const body = teams
    .map((row) => {
      let w = 0, l = 0, t = 0;
      const cells = teams
        .map((col) => {
          if (col.id === row.id) return '<td class="self">·</td>';
          const r = record.get(row.id).get(col.id);
          w += r.w; l += r.l; t += r.t;
          if (!r.w && !r.l && !r.t) return `<td>${dash}</td>`;
          const cls = r.w > r.l ? 'pos' : r.w < r.l ? 'neg' : 'muted';
          // Sort a column by how far ahead the row team is against that opponent.
          return `<td data-v="${r.w - r.l}" class="${cls}">${recordText(r)}</td>`;
        })
        .join('');

      // The overall record is the most important number in the row, so it gets
      // at least the colour the individual cells already had.
      const cls = w > l ? 'pos' : w < l ? 'neg' : 'muted';
      return `<tr>
          <td class="name">${esc(row.name)}</td>
          <td data-v="${w - l}" class="${cls}">${recordText({ w, l, t })}</td>
          ${cells}
        </tr>`;
    })
    .join('');

  return {
    head: '<th class="name" data-sort>Team</th><th data-sort>Overall</th>' + cols,
    body,
    sort: { defaultIndex: 1 },
    note:
      'Each row is a team, each column an opponent: the cell is that row team&rsquo;s ' +
      'record <em>against</em> that opponent. Green means a winning record, red a ' +
      'losing one. Blank means they haven&rsquo;t met yet. Click a header to sort ' +
      'by win differential in that column.',
  };
}

function scheduleGrid(teams, cols) {
  const pairs = pairWeeks();
  const week = state.week === 'all' ? null : Number(state.week);

  const body = teams
    .map((row) => {
      const cells = teams
        .map((col) => {
          if (col.id === row.id) return '<td class="self">·</td>';
          const games = pairs.get(`${row.id}:${col.id}`) || [];
          if (!games.length) return `<td>${dash}</td>`;

          const weeks = games.map((g) => g.week);
          const next = games.find((g) => gameState(g) !== 'final');

          // Two teams can meet twice, and one of those meetings is often
          // already played, so the state belongs on the week number rather
          // than on the cell.
          // The selected week wins over "already played": finding this week's
          // fixture in the grid is the reason to look at it.
          const label = games
            .map((g) => {
              const cls = g.week === week ? 'now' : gameState(g) === 'final' ? 'done' : '';
              return cls ? `<span class="${cls}">${g.week}</span>` : String(g.week);
            })
            .join(', ');

          // Sorting a column puts the teams who play that opponent soonest
          // first, which is the only ordering a fixture list can usefully have.
          const sortKey = next ? next.week : weeks[weeks.length - 1];
          return `<td data-v="${sortKey}" class="${next ? '' : 'done'}" ` +
            `title="${esc(row.name)} v ${esc(col.name)} — week ${weeks.join(', week ')}">` +
            `${label}</td>`;
        })
        .join('');

      return `<tr><td class="name">${esc(row.name)}</td>${cells}</tr>`;
    })
    .join('');

  return {
    head: '<th class="name" data-sort>Team</th>' + cols,
    body,
    sort: { defaultIndex: 0, defaultAsc: true },
    note:
      'Each cell is the week that row team plays that opponent — the whole season ' +
      'of fixtures at once. Dimmed weeks are already played; the week you have ' +
      'selected above is highlighted. Records take over from fixtures here once ' +
      'about 40% of the season has been played, or switch now with the buttons above.',
  };
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  state.source = btn.dataset.src;
  prefs.set('source', state.source);   // so the page comes back the way you left it
  syncSource();
  state.source === 'demo' ? loadDemo() : loadLive();
});

/** The week picker drives the whole page, so changing it re-renders the page. */
function setWeek(value) {
  state.week = value === 'all' ? 'all' : Number(value);
  prefs.set('week', state.week);
  render();
}

$('weekSelect').addEventListener('change', (e) => setWeek(e.target.value));

// Walking the season one week at a time used to mean thirteen trips through a
// dropdown.
function stepWeek(delta) {
  const weeks = state.data?.weeks || [];
  if (!weeks.length) return;
  if (state.week === 'all') {
    setWeek(delta > 0 ? weeks[0] : weeks[weeks.length - 1]);
    return;
  }
  const i = weeks.indexOf(Number(state.week));
  const next = weeks[i + delta];
  if (next !== undefined) setWeek(next);
}

$('weekPrev').addEventListener('click', () => stepWeek(-1));
$('weekNext').addEventListener('click', () => stepWeek(1));

$('resultsView').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.resultsView = btn.dataset.view;
  prefs.set('results', state.resultsView);
  renderResults();
});

$('h2hView').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.h2hView = btn.dataset.view;
  prefs.set('h2h', state.h2hView);
  renderH2H();
});

$('filterTeam').addEventListener('change', (e) => {
  state.filterTeam = e.target.value;
  renderResults();
});

// Sorted by week, ascending, until the user says otherwise.
enableSort($('resultsTable'), { defaultIndex: 0, defaultAsc: true });
// Standings open on the standings order: most wins first.
enableSort($('standingsTable'), { defaultIndex: 1 });

/**
 * Go live on our own when the connection bar finds a league, so the page shows
 * real data without a second click — unless the user has parked it on demo.
 */
onConnection((conn) => {
  if (!conn) return;
  if (state.source === 'live') {
    // Already live: this is a team change, so only the highlight moves.
    state.myTeamId = conn.teamId ?? null;
    if (state.data) renderStandings();
    return;
  }
  if (prefs.get('source') === 'demo') return;
  state.source = 'live';
  syncSource();
  loadLive();
});

syncSource();
if (state.source === 'live' && savedConfig()) loadLive();
else { state.source = 'demo'; loadDemo(); }
