// The weekly summary: one chart a manager can send to the group chat.
//
// Tim's ask, in his words: "I want to be able to send weekly summaries as text
// messages to your league friends. In this message, I want to share a chart
// that has the league members, Overall LUCK (across the season), title %, and
// loser % (using 100,000 simulations)."
//
// He chose the PHONE SHARE SHEET over automated SMS, and that decision is what
// this page is shaped around: the site draws the chart as an image and hands it
// to iOS, he picks Messages and the group, and he reads the message before it
// sends. No backend, no per-message cost, no phone numbers stored anywhere.
// Nothing here ever sends anything — see the note at the foot of summary.html.
//
// THE IMAGE IS THE PRODUCT, not the table. The table is here so he can check it
// before it goes; the PNG is the thing that leaves the site and gets read by
// nine people with none of this page's context. That is why every definition
// and the run count are drawn ON the image rather than only written beside it:
// a percentage with no run count behind it is a number nobody can check, and
// "loser" means something specific in this league that has to survive being
// screenshotted.
//
// WHAT THIS PAGE DOES NOT DO: it does not compute LUCK, and it does not model a
// playoff. LUCK is `luckScore` out of js/stats.js — the column recovered
// verbatim from Tim's own spreadsheet — and the percentages are counted by
// js/forecast.js's `simulateSeason`. Both are read through the same entry
// points the stats page and the schedule page use, because a second way of
// working out either number is exactly how two pages start disagreeing about
// the same league.

import { generateDemoLeague } from './demo.js';
import { computeLeagueStats } from './stats.js';
import { fetchSeasonData, fetchSchedule, fetchWeeksRosters } from './season.js';
import { projectionsFromWeekTeams } from './projection.js';
import * as espn from './espn.js';
import * as forecast from './forecast.js';
import { enableSort, resort } from './sortable.js';
import { scope } from './prefs.js';
import { savedConfig, onConnection } from './connection.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('summary');

// --------------------------------------------------------------- the contract
//
// THE ADAPTER. `simulateSeason` is being extended for the playoff bracket while
// this page is being written, so exactly ONE function here knows what its result
// rows are called. If the field names land differently, this is the only thing
// that changes — nothing below reads a simulation row directly.
//
// As of 2026-09-16 js/forecast.js returns `pTitle` and `pLast` as probabilities
// in 0..1. The brief this page was built to named them `titlePct` and `lastPct`,
// so both spellings are accepted. A name ending in "Pct" is taken to mean PER
// CENT and divided by a hundred; a name beginning with "p" is taken to be a
// probability and used as it stands. Getting that backwards would put a 4,100%
// title chance on the image, which is the kind of wrong that is at least loud.
//
// The two are deliberately different questions and must never be collapsed:
//   title — wins the CHAMPIONSHIP ROUND of the playoff bracket.
//   loser — finishes LAST IN THE REGULAR-SEASON STANDINGS. Tim's league rule,
//           in his words: "we mark the loser as the person in last place by the
//           end of the regular season, not the playoffs." It is emphatically
//           not the bottom of the consolation ladder, which is not modelled at
//           all. `pLast` is a regular-season placing and owes nothing to the
//           bracket, which is why a season whose table is already decided can
//           still report a loser while the title column is blank.

/**
 * One simulation result row, in this page's own vocabulary.
 *
 * @param {Object} row a `simulateSeason().teams[i]`
 * @returns {{teamId:*, title:number|null, last:number|null}|null}
 *          `title` and `last` are probabilities in 0..1, or null when the
 *          simulation could not produce one (no bracket, typically).
 */
export function adaptSimTeam(row) {
  if (!row || typeof row !== 'object') return null;

  const asProbability = (value, name) => {
    if (!Number.isFinite(value)) return null;
    return /Pct$/.test(name) ? value / 100 : value;
  };
  const pick = (...names) => {
    for (const name of names) {
      const v = asProbability(row[name], name);
      if (v !== null) return v;
    }
    return null;
  };

  return {
    teamId: row.teamId !== undefined ? row.teamId : row.id,
    title: pick('pTitle', 'titlePct'),
    last: pick('pLast', 'lastPct'),
  };
}

// ------------------------------------------------------------------ constants

/**
 * Tim asked for 100,000 by name, so it is not a setting.
 *
 * Measured against this page's own demo season (10 teams, 30 regular-season
 * games left after week 8, plus the three-round bracket on top of each run) —
 * see the report in the session notes. It is well over a second of straight-line
 * arithmetic, which is why runSimulation() hands off through rAF + setTimeout
 * and paints a working state instead of freezing the tab. A phone is slower;
 * the panel says how long its own run took, measured rather than promised.
 */
const SIM_RUNS = 100000;

/**
 * The same seed the schedule page's simulation uses.
 *
 * Shared deliberately: the two pages simulate the same league off the same
 * model, so given the same inputs they must produce the SAME numbers. A summary
 * that quoted a title chance a point away from the schedule page's would make
 * both look like noise.
 */
const SIM_SEED = 20260901;

/**
 * How many teams make the playoffs, taken from forecast.js's own constant
 * rather than written down a second time (Tim's ESPN settings: 6).
 *
 * The `?? 6` is not defensive clutter: forecast.js is the file this page has a
 * contract with, and a fallback here means a rename there degrades to the right
 * answer for THIS league rather than to `NaN` teams making the playoffs.
 */
const PLAYOFF_TEAMS = forecast.DEFAULT_PLAYOFF_TEAMS ?? 6;

/**
 * Below this many played weeks, nothing on this page means anything.
 *
 * This is PROGRESS.md's rule — decide what a statistic returns before it has
 * enough data — and the threshold is the stats page's own MIN_WEEKS. With one
 * or two weeks played, LUCK is a single close game wearing a season's clothes
 * (its SD term is designed to be violent about one-score games, and there is
 * nothing yet to average that violence away), and the simulation is very nearly
 * uniform: ten managers at 9-11% each, which looks like a finding and is
 * actually just ten teams and a coin.
 *
 * So the page refuses, on screen AND on the image. Ten near-identical
 * percentages printed confidently would be worse than no chart at all, because
 * the chart is the half that leaves the site.
 */
const MIN_WEEKS = 3;

/**
 * Which week the demo opens on.
 *
 * The demo season is thirteen weeks and every one of them is played (see
 * js/demo-rosters.js — `played: true` is hardcoded), so without a cut-off there
 * would be nothing left to simulate and the title column would be permanently
 * blank. Eight is mid-season: LUCK has had time to settle, and five regular
 * weeks plus the bracket are still to play, so every column on the page has
 * something to say. Tim can move the picker to see any other week, including
 * the early ones the refusal above is about.
 */
const DEMO_THROUGH = 8;

// The share card, in logical pixels. Drawn at CARD_SCALE for retina by setting
// the canvas's width/height ATTRIBUTES — never its CSS size, which would just
// stretch a 1x bitmap and undo the point.
const CARD_W = 760;
const CARD_SCALE = 2;

// The site's own palette, repeated here because a canvas cannot read a CSS
// custom property. Keep these in step with :root in css/app.css by eye; they
// are the only copy and there is nothing that can check them.
const INK = {
  bg: '#171a21',
  band: '#0f1115',
  line: '#272c36',
  text: '#e6e8ec',
  dim: '#8b93a1',
  accent: '#3ba55d',
  err: '#e0525f',
  warn: '#d9a441',
  demoBg: '#3a2f10',
  rowAlt: '#1a1d25',
};

const state = {
  source: prefs.get('source', 'demo'),
  league: null,        // normalised; see normalise()
  throughWeek: 0,      // weeks 1..throughWeek are decided, the rest are played out
  proj: null,          // Map(week -> Map(teamId -> projected)) for weeks still ahead
  projNote: '',        // where those projections came from, in words
  projToken: 0,        // a roster read that lands after the week moved is dropped
  projPending: false,  // a roster read is in flight, so the sim would be doomed
  sim: null,           // { key, result, ms }
  simPending: null,    // key of a run currently in flight
  simToken: 0,         // a run that lands after the data moved is thrown away
  cardText: '',        // the plain-text version of the same chart
  cardDrawn: false,    // whether the canvas holds a real picture
  canShare: false,     // navigator.canShare({files}) said yes, with a real probe
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const dash = '<span class="muted">—</span>';

/** A signed one-decimal number, coloured. Same renderer as the stats page's
 *  LUCK column, so the two pages print the identical string for one team. */
function signed(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return dash;
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}</span>`;
}

/**
 * A probability as a percentage.
 *
 * "<1%" rather than "0%" for anything that happened at all, and "0" only for
 * something that happened in none of a hundred thousand seasons. At this run
 * count that really does mean "never once", which is worth distinguishing from
 * "rounds down".
 */
function pct(p) {
  if (!Number.isFinite(p)) return null;
  if (p <= 0) return '0%';
  if (p < 0.005) return '<1%';
  return `${Math.round(p * 100)}%`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const commas = (n) => Number(n).toLocaleString('en-US');

// ------------------------------------------------------------------ the league
//
// Two sources, one shape. Every panel below reads `state.league` and nothing
// else, so demo and live cannot drift apart.
//
//   teams    [{id, name, teamName}]   `name` is the PERSON — see espn.js
//   played   [{week, homeId, awayId, homeActual, awayActual,
//              homeProjected, awayProjected}]   completed games only
//   fixtures [{week, homeId, awayId, homeProjected, awayProjected}]  every game
//   weeks    sorted week numbers the fixture list covers

function normalise({ season, name, isDemo, teams, played, fixtures }) {
  const weeks = [...new Set(fixtures.map((f) => f.week))].sort((a, b) => a - b);
  return {
    season, name, isDemo, teams, played, fixtures, weeks,
    // THE SCHEDULE IS THE SOURCE OF TRUTH for where the regular season ends.
    // ESPN's matchup feed carries exactly `matchupPeriodCount` weeks and nothing
    // after it, so the last week on the fixture list IS the last regular-season
    // week — in any league, without reading a setting. The demo's thirteen get
    // the same treatment, which is the point of deriving it.
    lastRegularWeek: weeks.length ? weeks[weeks.length - 1] : 0,
  };
}

async function loadDemo() {
  setStatus('Generated sample data — not your real league.');
  const d = generateDemoLeague();
  // The demo carries a projection on every game, played or not, so it needs no
  // roster endpoint: a "remaining" demo game is scored off the number already
  // sitting on it. That is the same thing the schedule page's projectedPoints()
  // does with demo data.
  state.league = normalise({
    season: d.season, name: d.name, isDemo: true,
    teams: d.teams.map((t) => ({ id: t.id, name: t.name, teamName: t.teamName || null })),
    played: d.games,
    fixtures: d.games.map((g) => ({
      week: g.week, homeId: g.homeId, awayId: g.awayId,
      homeProjected: g.homeProjected, awayProjected: g.awayProjected,
    })),
  });
  state.proj = null;
  state.projNote =
    'The demo season carries its own per-game projections, so no roster read is needed.';
  setThroughWeek(clampWeek(DEMO_THROUGH));
  return true;
}

async function loadLive() {
  // Never read localStorage for the league directly — see PROGRESS.md rule 6.
  const cfg = savedConfig();
  if (!cfg) {
    setStatus('No league connected yet. Connect one on the bar above first.', true);
    return false;
  }

  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  setStatus('Loading your league from ESPN…');

  try {
    // TWO different readings of the same schedule, and they are not
    // interchangeable.
    //
    // fetchSeasonData rebuilds each PLAYED week's projected total from the
    // lineup that was actually STARTED that week — which is what ESPN's own
    // site showed at the time, and what Tim's spreadsheet measured LUCK
    // against. fetchSchedule gives the whole fixture list including the games
    // still to come, which the played-games view deliberately omits.
    //
    // The projections for those future weeks are a third thing again: the BEST
    // LEGAL lineup, because that is what a manager will actually field. Using
    // the started lineup for a week nobody has set yet would understate every
    // team by whoever is currently sat on their bench.
    const data = await fetchSeasonData({
      onProgress: (done, total, label) => setStatus(`${esc(label)} (${done}/${total})`),
    });
    const schedule = await fetchSchedule();

    state.league = normalise({
      season: data.season, name: data.name, isDemo: false,
      teams: data.teams,
      played: data.games,
      fixtures: schedule.games.map((g) => ({
        week: g.week, homeId: g.homeId, awayId: g.awayId,
        homeProjected: null, awayProjected: null,
      })),
    });

    const lastPlayed = data.games.reduce((a, g) => Math.max(a, g.week), 0);
    setThroughWeek(clampWeek(lastPlayed));

    if (!data.projectionsAvailable && data.games.length) {
      setStatus(
        `Loaded ${data.gamesFound} games from ${esc(data.name)}, but ESPN only returned ` +
        `weekly projections for ${data.gamesWithProjections} of them, so LUCK will be ` +
        `wrong or blank for the missing weeks.`, true
      );
    } else if (!data.games.length) {
      setStatus(
        `Connected to ${esc(data.name)}, but ESPN has no completed matchups for ` +
        `${data.season} yet. There is nothing to summarise until some weeks are played.`
      );
    } else {
      setStatus(`Loaded ${data.gamesFound} games from ${esc(data.name)}.`);
    }

    // The forward projections are fetched AFTER the page is on screen, because
    // they cost one request per week and the LUCK column does not wait on them.
    refreshProjections();
    return true;
  } catch (err) {
    setStatus(esc(err.message), true);
    return false;
  }
}

/**
 * ESPN's own per-week projection for every week still to play, plus the three
 * playoff weeks.
 *
 * The bracket weeks are NOT on the schedule — ESPN's matchup feed stops at the
 * last regular-season week and only fills the bracket in once it exists — so
 * they are derived from where the regular season ends and asked for by number.
 * ESPN really does publish a per-player projection for them (probed 2026-09-16
 * on public leagues 1241838 and 899513), which is what lets a playoff round be
 * scored off the same numbers as week 4 rather than off a season average.
 */
async function refreshProjections() {
  const L = state.league;
  if (!L || L.isDemo) return;

  // The same token guard the schedule page uses: moving the week picker twice
  // in quick succession puts two reads in the air, and the slower one must not
  // land on top of the newer answer.
  const token = ++state.projToken;
  const stale = () => token !== state.projToken;

  const ahead = L.weeks.filter((w) => w > state.throughWeek);
  const asking = ahead.concat(playoffWeeks());
  if (!asking.length) return;

  // Until these land, EVERY remaining game has a null projection, so running the
  // simulation now would produce a season with nothing in it — and the panel
  // would then say "the regular season is complete", which is a different and
  // completely wrong statement. So the sim waits, and the table says what it is
  // waiting for.
  state.projPending = true;
  render();

  let weekTeams = new Map();
  try {
    weekTeams = await fetchWeeksRosters(asking, {
      onProgress: (done, total) => {
        if (stale() || done >= total) return;
        setStatus(`Reading ESPN’s projections… week ${done} of ${total}.`);
      },
    });
  } catch {
    weekTeams = new Map();   // ESPN said no; the page says so rather than guessing
  }
  if (stale()) return;
  state.projPending = false;

  const built = projectionsFromWeekTeams(weekTeams);
  state.proj = built ? built.proj : null;
  state.projNote = built
    ? `Weeks still to play are scored from ESPN’s own per-player projection for ` +
      `that week, with the best legal lineup filled.`
    : `ESPN returned no usable projection for the weeks still to play, so the ` +
      `simulation has nothing to play them out with.`;

  if (built && !built.countsKnown) {
    state.projNote +=
      ' The starting slots could not be read off the lineups, so a standard ten-slot ' +
      'lineup was assumed.';
  }
  setStatus(built
    ? `Loaded ${esc(L.name)} — ESPN’s own projections read for ` +
      `${plural(built.weeks.length, 'week')} ahead, including the bracket weeks.`
    : `Loaded ${esc(L.name)}, but ESPN returned no projection for any week still to ` +
      `play, so the simulation has nothing to play them out with.`, !built);
  render();
}

// ---------------------------------------------------------------- week picker

/** Keep a week inside the fixture list, and never below week 1. */
function clampWeek(w) {
  const L = state.league;
  if (!L || !L.weeks.length) return 0;
  return Math.max(L.weeks[0], Math.min(L.lastRegularWeek, Number(w) || 0));
}

function setThroughWeek(w) {
  state.throughWeek = w;
}

/** The scoring weeks the bracket falls in, one per round, earliest first. */
function playoffWeeks() {
  const L = state.league;
  if (!L || !L.lastRegularWeek) return [];
  const rounds = typeof forecast.playoffRoundCount === 'function'
    ? forecast.playoffRoundCount(PLAYOFF_TEAMS)
    : 3;
  return Array.from({ length: rounds }, (_, i) => L.lastRegularWeek + 1 + i);
}

// --------------------------------------------------------------------- the view
//
// Everything the table and the image both need, worked out once. Two panels
// reading two slightly different splits of the season is how a page ends up
// contradicting itself in public.

function buildView() {
  const L = state.league;
  if (!L) return null;

  const through = state.throughWeek;
  const banked = L.played.filter((g) => g.week <= through);
  const weeksPlayed = new Set(banked.map((g) => g.week)).size;

  // LUCK comes from js/stats.js, computed over the banked half of the season and
  // nowhere else. `luckScore` is the sheet's own LUCK column, recovered verbatim
  // as `leagueAvgActual - (PTW - SD)`; the stats page reads the same field off
  // the same function. Note the league-average term inside it is computed from
  // the games handed in, so restricting to weeks 1..N genuinely gives LUCK AS OF
  // week N rather than the whole season's answer with some rows removed.
  const stats = computeLeagueStats({
    season: L.season, name: L.name, isDemo: L.isDemo,
    weeks: weeksPlayed, teams: L.teams, games: banked, injuries: [],
  });
  const luckById = new Map(stats.teams.map((t) => [t.id, t.luckScore]));

  return {
    through,
    banked,
    weeksPlayed,
    enough: weeksPlayed >= MIN_WEEKS,
    luckById,
    teams: L.teams,
  };
}

/**
 * Everything simulateSeason needs, plus a key that changes exactly when the
 * answer would.
 *
 * In the key: the run count, the cut-off week, the spread, the teams, each
 * team's banked wins and points, every remaining game's two projections, the
 * field size, the bracket weeks and their projections. Not in it: anything
 * about who is reading, because that changes nothing about the season being
 * played out.
 */
function simInputs(view) {
  const L = state.league;
  if (!L || !L.teams.length) return null;

  const teamIds = L.teams.map((t) => t.id);
  const known = new Set(teamIds);
  const banked = new Map(teamIds.map((id) => [id, { wins: 0, pointsFor: 0 }]));

  for (const g of view.banked) {
    if (!known.has(g.homeId) || !known.has(g.awayId)) continue;
    const h = banked.get(g.homeId);
    const a = banked.get(g.awayId);
    h.pointsFor += g.homeActual;
    a.pointsFor += g.awayActual;
    // The league's matchup tie breaker is "None", so a tie stands and goes down
    // as half a win each. Rare, and defined rather than merely improbable.
    if (g.homeActual > g.awayActual) h.wins += 1;
    else if (g.awayActual > g.homeActual) a.wins += 1;
    else { h.wins += 0.5; a.wins += 0.5; }
  }

  const games = [];
  let playable = 0;
  for (const f of L.fixtures) {
    if (f.week <= view.through) continue;
    if (f.homeId == null || f.awayId == null) continue;   // a bye: nothing to play out
    if (!known.has(f.homeId) || !known.has(f.awayId)) continue;
    const homeProj = projectedFor(f, 'home');
    const awayProj = projectedFor(f, 'away');
    if (homeProj !== null && awayProj !== null) playable++;
    games.push({ homeId: f.homeId, awayId: f.awayId, homeProj, awayProj });
  }

  // Only banked games feed the spread: a forecast may not learn from the games
  // it is being asked to forecast. Early in a real season there is nothing to
  // learn from at all, and calibrateSigma says so rather than pretending.
  const spread = forecast.calibrateSigma(view.banked);

  const weeks = playoffWeeks();
  const playoff = { teams: PLAYOFF_TEAMS, weeks, proj: state.proj };
  const playoffProjKey = weeks.map((w) => {
    const forWeek = state.proj?.get(w);
    return forWeek ? teamIds.map((id) => forWeek.get(id) ?? null) : null;
  });

  const key = JSON.stringify([
    SIM_RUNS, view.through, Math.round(spread.sigma * 1000), teamIds,
    [...banked].map(([id, b]) => [id, b.wins, Math.round(b.pointsFor * 10)]),
    games.map((g) => [g.homeId, g.awayId, g.homeProj, g.awayProj]),
    PLAYOFF_TEAMS, weeks, playoffProjKey,
  ]);

  return { teamIds, banked, games, playable, spread, playoff, key };
}

/** A remaining game's projection for one side, or null when nobody has one. */
function projectedFor(fixture, side) {
  const own = side === 'home' ? fixture.homeProjected : fixture.awayProjected;
  if (typeof own === 'number' && own > 0) return own;
  const id = side === 'home' ? fixture.homeId : fixture.awayId;
  const v = state.proj?.get(fixture.week)?.get(id);
  return typeof v === 'number' && v > 0 ? v : null;
}

/**
 * Run the simulation off the critical path.
 *
 * 100,000 runs is well over a second of straight-line arithmetic. Done inline it
 * would freeze the tab with the "Simulating…" state never painted — the one
 * frame that exists to say the wait is deliberate. rAF fires BEFORE the next
 * paint, so it alone would not help; the setTimeout inside it is what lands the
 * work in a fresh task after the browser has actually drawn.
 *
 * The elapsed time is kept and shown. On Tim's phone this will be slower than on
 * a laptop, and a measured number is worth more than a promise about one.
 */
function runSimulation(inputs) {
  const token = ++state.simToken;
  state.simPending = inputs.key;

  const later = (fn) => setTimeout(fn, 0);
  const kick = typeof requestAnimationFrame === 'function'
    ? (fn) => requestAnimationFrame(() => later(fn))
    : later;

  kick(() => {
    if (token !== state.simToken || !state.league) return;
    const t0 = Date.now();
    const result = forecast.simulateSeason({
      teamIds: inputs.teamIds,
      banked: inputs.banked,
      games: inputs.games,
      sigma: inputs.spread.sigma,
      runs: SIM_RUNS,
      seed: SIM_SEED,
      playoff: inputs.playoff,
    });
    const ms = Date.now() - t0;
    if (token !== state.simToken || !state.league) return;
    // Cached even when null, so a league the model cannot handle is reported
    // once rather than retried on every repaint.
    state.sim = { key: inputs.key, result, ms };
    state.simPending = null;
    render();
  });
}

// ------------------------------------------------------------------- rendering

function render() {
  const L = state.league;
  if (!L) return;

  $('modeBadge').className = 'badge ' + (L.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = L.isDemo ? 'Demo' : 'Live';

  const view = buildView();
  const inputs = simInputs(view);

  // Kick a run only when the answer on screen is not already the right one —
  // and never while the projections it would need are still being read, because
  // a season with no playable games in it does not report as "waiting", it
  // reports as a decided season, which is a completely different claim.
  if (view.enough && inputs && !state.projPending
      && (!state.sim || state.sim.key !== inputs.key)
      && state.simPending !== inputs.key) {
    runSimulation(inputs);
  }

  const sim = state.sim && inputs && state.sim.key === inputs.key ? state.sim : null;
  const rows = buildRows(view, sim);

  $('pageSub').textContent = L.isDemo
    ? `Demo League · week ${view.through} of ${L.lastRegularWeek} · generated data, so you can see the layout`
    : `${L.name} · ${L.season} · summary through week ${view.through}`;

  renderWeekPicker();
  renderTable(view, rows, sim, inputs);
  renderNote(view, sim, inputs);
  renderCard(view, rows, sim, inputs);
}

/**
 * One row per league member, in the order the image and the table both use.
 *
 * Sorted by title chance where there is one, then by LUCK — so the person the
 * chart is about is at the top rather than whoever ESPN happens to list first.
 * The table's own headers can re-sort it; the IMAGE is always this order,
 * because a picture cannot be re-sorted by the person reading it.
 */
function buildRows(view, sim) {
  const byId = new Map();
  if (sim && sim.result) {
    for (const raw of sim.result.teams || []) {
      const row = adaptSimTeam(raw);
      if (row) byId.set(row.teamId, row);
    }
  }

  const rows = view.teams.map((t) => {
    const s = byId.get(t.id) || null;
    return {
      id: t.id,
      name: t.name,
      teamName: t.teamName || null,
      // Every number is null-or-real. `enough` is the early-season refusal:
      // below it there is no number to show, which is a different thing from a
      // number that happens to be zero.
      luck: view.enough ? view.luckById.get(t.id) ?? null : null,
      title: view.enough && s ? s.title : null,
      last: view.enough && s ? s.last : null,
    };
  });

  rows.sort((a, b) =>
    (b.title ?? -1) - (a.title ?? -1) ||
    (b.luck ?? -Infinity) - (a.luck ?? -Infinity) ||
    String(a.name).localeCompare(String(b.name))
  );
  return rows;
}

function renderWeekPicker() {
  const L = state.league;
  const sel = $('weekSelect');
  // Live data can only be summarised up to the last week that has a result;
  // the demo's whole season is played, so its picker offers all of it.
  const lastOffered = L.isDemo
    ? L.lastRegularWeek
    : Math.max(0, L.played.reduce((a, g) => Math.max(a, g.week), 0));

  const weeks = L.weeks.filter((w) => w <= Math.max(lastOffered, L.weeks[0] ?? 0));
  sel.innerHTML = weeks
    .map((w) => `<option value="${w}"${w === state.throughWeek ? ' selected' : ''}>Week ${w}</option>`)
    .join('');
  sel.value = String(state.throughWeek);
}

function renderTable(view, rows, sim, inputs) {
  const table = $('summaryTable');
  const tbody = table.querySelector('tbody');

  // Three different reasons a percentage cell can be empty, and they are not the
  // same fact. Saying which is the whole of the early-season honesty rule.
  const waiting = view.enough && !sim;
  const pctCell = (p) => {
    if (p === null || p === undefined) {
      return waiting ? '<span class="muted">…</span>' : dash;
    }
    return `${pct(p)}`;
  };

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="name"${r.teamName ? ` title="ESPN team name: ${esc(r.teamName)}"` : ''}>${esc(r.name)}</td>
      <td class="num" data-v="${r.luck ?? ''}">${view.enough ? signed(r.luck) : dash}</td>
      <td class="num" data-v="${r.title ?? ''}">${pctCell(r.title)}</td>
      <td class="num" data-v="${r.last ?? ''}">${pctCell(r.last)}</td>
    </tr>`).join('');

  resort(table);

  const status = $('simStatus');
  if (!view.enough) {
    status.textContent = '';
  } else if (state.projPending) {
    status.textContent =
      'Reading ESPN’s projections for the weeks still to play — one request per week, ' +
      'and the simulation starts when they land.';
  } else if (!sim) {
    status.textContent =
      `Simulating ${commas(SIM_RUNS)} seasons… the page stays responsive while it runs.`;
  } else if (!sim.result) {
    status.textContent =
      'The simulation could not run on this season — see the note below.';
  } else if (!sim.result.games && sim.result.skipped) {
    // GAMES LEFT, BUT NOTHING TO PLAY THEM WITH. Not the same fact as a decided
    // season, and reporting it as one would be a confident lie about the state
    // of the league.
    status.textContent =
      `${plural(sim.result.skipped, 'game')} are still to play, but none of them carries a ` +
      'projection for both sides, so there was nothing to simulate.';
  } else if (!sim.result.games) {
    status.textContent =
      'The regular season is complete: there is nothing left to play out, so the ' +
      'loser column is the final table rather than a frequency.';
  } else {
    const took = sim.ms >= 1000 ? `${(sim.ms / 1000).toFixed(1)}s` : `${sim.ms}ms`;
    status.textContent =
      `${commas(sim.result.runs)} simulated seasons, ${plural(sim.result.games, 'game')} ` +
      `played out in each, in ${took} on this device.` +
      (inputs && inputs.playable < sim.result.games
        ? ` ${plural(sim.result.games - inputs.playable, 'game')} had no projection to play with.`
        : '');
  }
}

/** The house rule: state the basis of every derived number, in words, in a note. */
function renderNote(view, sim, inputs) {
  const L = state.league;
  const parts = [];

  if (!view.enough) {
    parts.push(
      `<strong>Too early to say anything.</strong> ${plural(view.weeksPlayed, 'week')} ` +
      `of this season ${view.weeksPlayed === 1 ? 'has' : 'have'} been played, and these ` +
      `numbers need at least ${MIN_WEEKS}. LUCK weights close games heavily on purpose, ` +
      `so one result swings it; and with almost the whole season still to play the ` +
      `simulation puts every manager within a point or two of every other, which looks ` +
      `like a finding and is really just ten teams and a coin. The chart says so too, ` +
      `so a screenshot cannot lose the caveat.`
    );
  } else {
    parts.push(
      `<strong>LUCK</strong> is your spreadsheet’s own column — league average score ` +
      `minus (points to win minus close-game luck) — computed over weeks ` +
      `${L.weeks[0]}–${view.through}. Above zero means the season has broken your way.`
    );
    parts.push(
      `<strong>Title %</strong> is winning the <em>championship round</em>. ` +
      `<strong>Loser %</strong> is finishing <em>last in the regular-season standings</em> — ` +
      `your league’s own rule for the wooden spoon, and nothing to do with the ` +
      `consolation ladder, which is not modelled at all.`
    );

    if (sim && sim.result) {
      const po = sim.result.playoff;
      // Only claim a run count when something was actually run. With no games
      // left the table is a fact, not a frequency — see the same split in
      // cardLines().
      if (sim.result.games > 0) {
        parts.push(
          `Both percentages are counted from ${commas(sim.result.runs)} simulated seasons, not ` +
          `solved for: where you finish turns on everyone else’s results as much as your own, ` +
          `and there is no closed form for that. Each game is its projection plus normal noise ` +
          `of ${sim.result.sigma.toFixed(1)} points` +
          (inputs && inputs.spread.calibrated
            ? `, measured from ${plural(inputs.spread.sample, 'completed team-week')} in this league.`
            : ` — assumed, because there ${inputs && inputs.spread.sample === 1 ? 'is' : 'are'} ` +
              `only ${plural(inputs?.spread.sample ?? 0, 'completed team-week')} carrying a ` +
              `projection to measure it from.`)
        );
      }
      if (po) {
        parts.push(
          `<strong>${po.teams} of ${L.teams.length} teams make the playoffs</strong>, so ` +
          (po.byes > 0 ? `seeds 1–${po.byes} get a bye; ` : `nobody gets a bye; `) +
          `${plural(po.rounds, 'round')} of one week each, in weeks ` +
          `${po.weeks.join(', ')}. Seeding is wins then total points, the bracket is fixed once ` +
          `seeded, and a tied playoff game goes to the higher seed. ` +
          (po.basis === 'projected'
            ? `Each round is scored from ESPN’s own projection for that week.`
            : po.basis === 'modelled'
              ? `ESPN published no per-week projection for those weeks here, so each round is ` +
                `scored from the team’s average projection over its remaining games — a weaker ` +
                `number, and not ESPN’s.`
              : `Some rounds use ESPN’s own projection for the week and some fall back to the ` +
                `team’s average over its remaining games.`)
        );
      } else if (!sim.result.games && !sim.result.skipped) {
        parts.push(
          `There are no games left to play out, so there is no bracket and the title column ` +
          `is blank. The loser column is not: last in the regular-season table is already ` +
          `decided, so that column is the final table rather than a frequency.`
        );
      } else {
        parts.push(
          `No playoff bracket could be built for this season — nothing left to play carries a ` +
          `projection to play it with — so the title column is blank. The loser column still ` +
          `works, because it only needs the regular-season table.`
        );
      }
    }

    parts.push(state.projNote);
  }

  parts.push(
    `Every percentage here is <strong>our model, not ESPN’s</strong>. ESPN publishes ` +
    `projections; it has never published odds.`
  );

  $('summaryNote').innerHTML = parts.filter(Boolean).join(' ');
}

// -------------------------------------------------------------------- the card
//
// What actually leaves the site. Everything a reader needs to judge the numbers
// has to be ON it: the league, the week, both definitions, the run count, and —
// when it is demo data — the fact that none of it is real. A demo chart reaching
// his league looking real is the one failure here that cannot be taken back.

function cardLines(view, sim, inputs) {
  const L = state.league;
  const lines = [];

  if (!view.enough) {
    lines.push(
      `Too early: only ${plural(view.weeksPlayed, 'week')} played, and these numbers ` +
      `need ${MIN_WEEKS}.`,
      `LUCK swings on one close game this early, and every manager’s title chance is ` +
      `within a point or two of every other’s.`
    );
    return lines;
  }

  // One fact per line. These are word-wrapped onto the card rather than
  // truncated — a definition that runs off the right-hand edge is worse than no
  // definition at all, because the reader cannot tell it was cut.
  lines.push(`Title % = wins the championship round.`);
  lines.push(
    `Loser % = LAST IN THE REGULAR SEASON — not the playoffs, ` +
    `not the consolation ladder.`
  );
  lines.push(
    `LUCK = league average score − (points to win − close-game luck), weeks ` +
    `${L.weeks[0]}–${view.through}.`
  );
  // THREE DIFFERENT REASONS THE PERCENTAGES CAN BE MISSING, and they must not
  // share a sentence. The card is redrawn as soon as the simulation lands, so
  // the "still running" wording is on screen for about a second — but it is the
  // wording that would be on a screenshot taken during that second, and a card
  // claiming the season was over when it was merely still counting is exactly
  // the kind of confident wrongness this page is trying not to produce.
  if (sim && sim.result) {
    const po = sim.result.playoff;
    if (sim.result.games > 0) {
      lines.push(
        `From ${commas(sim.result.runs)} simulations of the ${plural(sim.result.games, 'game')} ` +
        `still to play` + (po ? `, plus a ${po.teams}-team bracket.` : `.`)
      );
    } else if (sim.result.skipped) {
      lines.push(
        `${plural(sim.result.skipped, 'game')} are still to play, but none of them has a ` +
        `projection for both sides, so nothing could be simulated.`
      );
    } else {
      // Quoting a run count here would be worse than useless: a hundred thousand
      // replays of a season with no games left produce the identical table every
      // time, so the loser is a FACT about the finished standings and not a
      // frequency. Saying "from 100,000 simulations" would dress a certainty up
      // as an estimate.
      lines.push(
        `The regular season is complete, so nothing was simulated — the loser is ` +
        `whoever the final table says, and there is no title left to play for.`
      );
    }
    if (po === null && sim.result.games > 0) {
      lines.push(`No playoff bracket could be built for this season, so Title % is blank.`);
    }
  } else if (sim) {
    lines.push(`The simulation could not be run on this season, so both percentages are blank.`);
  } else {
    lines.push(`Still simulating ${commas(SIM_RUNS)} seasons — the percentages are not in yet.`);
  }
  lines.push(`Our model, not ESPN’s — ESPN publishes projections, never odds.`);
  return lines;
}

/** The same chart as plain text, for a laptop where pasting beats an image. */
function buildCardText(view, rows, sim, inputs) {
  const L = state.league;
  const head = L.isDemo
    ? `*** DEMO DATA — NOT A REAL LEAGUE ***\n`
    : '';

  const w = Math.max(6, ...rows.map((r) => String(r.name).length));
  const cell = (r) => [
    String(r.name).padEnd(w),
    (r.luck === null ? '—' : `${r.luck > 0 ? '+' : ''}${r.luck.toFixed(1)}`).padStart(6),
    (pct(r.title) ?? '—').padStart(8),
    (pct(r.last) ?? '—').padStart(8),
  ].join('  ');

  const header = ['Member'.padEnd(w), 'LUCK'.padStart(6), 'Title %'.padStart(8), 'Loser %'.padStart(8)].join('  ');

  return [
    head + `${L.name} — week ${view.through}`,
    '',
    header,
    '-'.repeat(header.length),
    ...rows.map(cell),
    '',
    ...cardLines(view, sim, inputs),
  ].join('\n');
}

/**
 * Draw the card.
 *
 * Sizes are in LOGICAL pixels and the context is scaled by CARD_SCALE, so the
 * bitmap is 2x and every number below reads as CSS pixels. The canvas's
 * width/height ATTRIBUTES carry the real pixel count; its CSS box is set to the
 * logical size. Setting the size in CSS alone would stretch a 1x bitmap and give
 * back exactly the soft, unreadable image this is meant to avoid.
 */
function renderCard(view, rows, sim, inputs) {
  const L = state.league;
  const canvas = $('shareCanvas');
  state.cardText = buildCardText(view, rows, sim, inputs);
  $('shareText').textContent = state.cardText;

  if (!canvas) return;

  const pad = 28;
  const font = (size, weight = '400') =>
    `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

  // THE CONTEXT IS TAKEN BEFORE THE CANVAS IS SIZED, on purpose. The footnotes
  // are wrapped to the card's width, so how tall the card has to be is not known
  // until they have been measured — and measuring needs a context. getContext is
  // idempotent, so this is the same object that draws below; setting width or
  // height afterwards resets its state, which is why the transform is applied
  // after the sizing rather than here.
  const ctx = safeContext(canvas);

  const notes = cardLines(view, sim, inputs);
  const wrapped = [];
  if (ctx) {
    ctx.font = font(15);
    for (const line of notes) wrapped.push(...wrap(ctx, line, CARD_W - pad * 2));
  } else {
    wrapped.push(...notes);
  }

  const demoBand = L.isDemo ? 46 : 0;
  const rowH = 38;
  const top = demoBand + 96;                       // title block
  const headH = 34;
  const bodyH = rows.length * rowH;
  const notesH = 18 + wrapped.length * 24;
  const H = top + headH + bodyH + notesH + 20;

  canvas.width = CARD_W * CARD_SCALE;
  canvas.height = H * CARD_SCALE;
  canvas.style.width = `${CARD_W}px`;
  canvas.style.height = `${H}px`;

  if (!ctx) {
    // No 2d canvas in this browser. Say so and point at the text version, which
    // is a complete substitute rather than a consolation prize.
    state.cardDrawn = false;
    $('cardWrap').hidden = true;
    renderSendControls(view, true);
    return;
  }
  $('cardWrap').hidden = false;

  ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0);
  ctx.textBaseline = 'alphabetic';

  // Ground.
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, CARD_W, H);

  // The demo band, first and loudest. An image that says nothing about being
  // fake is one forward away from nine people believing it.
  if (L.isDemo) {
    ctx.fillStyle = INK.demoBg;
    ctx.fillRect(0, 0, CARD_W, demoBand);
    ctx.fillStyle = INK.warn;
    ctx.font = font(20, '700');
    ctx.textAlign = 'center';
    ctx.fillText('DEMO DATA — NOT A REAL LEAGUE', CARD_W / 2, demoBand / 2 + 7);
    ctx.textAlign = 'left';
  }

  // Title block: whose league, and which week. Both, because the image will be
  // read weeks later in a scrolled-back thread.
  ctx.fillStyle = INK.text;
  ctx.font = font(30, '700');
  ctx.fillText(clip(ctx, L.name, CARD_W - pad * 2), pad, demoBand + 46);
  ctx.fillStyle = INK.dim;
  ctx.font = font(17);
  ctx.fillText(
    `Week ${view.through} summary · ${L.season} season · ${plural(view.weeksPlayed, 'week')} played`,
    pad, demoBand + 74
  );

  // Columns. Names left, every number right-aligned on its own edge.
  const colLast = CARD_W - pad;
  const colTitle = colLast - 112;
  const colLuck = colTitle - 112;
  const nameW = colLuck - pad - 90;

  let y = top;
  ctx.font = font(17, '700');
  ctx.fillStyle = INK.dim;
  ctx.textAlign = 'left';
  ctx.fillText('MEMBER', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText('LUCK', colLuck, y);
  ctx.fillText('TITLE %', colTitle, y);
  ctx.fillText('LOSER %', colLast, y);
  ctx.textAlign = 'left';

  y += 10;
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y + 0.5);
  ctx.lineTo(CARD_W - pad, y + 0.5);
  ctx.stroke();

  // Rows. 22px type — large on purpose, because this is read as a thumbnail in a
  // Messages thread before anybody taps it open.
  rows.forEach((r, i) => {
    const rowTop = y + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = INK.rowAlt;
      ctx.fillRect(pad - 8, rowTop + 4, CARD_W - pad * 2 + 16, rowH);
    }
    const baseline = rowTop + rowH - 10;

    ctx.fillStyle = INK.text;
    ctx.font = font(22, '600');
    ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, r.name, nameW), pad, baseline);

    ctx.textAlign = 'right';
    ctx.font = font(22);
    if (r.luck === null) { ctx.fillStyle = INK.dim; ctx.fillText('—', colLuck, baseline); }
    else {
      ctx.fillStyle = r.luck > 0 ? INK.accent : r.luck < 0 ? INK.err : INK.dim;
      ctx.fillText(`${r.luck > 0 ? '+' : ''}${r.luck.toFixed(1)}`, colLuck, baseline);
    }

    ctx.fillStyle = r.title === null ? INK.dim : INK.text;
    ctx.fillText(pct(r.title) ?? '—', colTitle, baseline);
    ctx.fillStyle = r.last === null ? INK.dim : INK.text;
    ctx.fillText(pct(r.last) ?? '—', colLast, baseline);
    ctx.textAlign = 'left';
  });

  // The footnotes, which are the half of the image that makes it checkable.
  let ny = y + bodyH + 30;
  ctx.strokeStyle = INK.line;
  ctx.beginPath();
  ctx.moveTo(pad, ny - 16.5);
  ctx.lineTo(CARD_W - pad, ny - 16.5);
  ctx.stroke();

  ctx.font = font(15);
  ctx.fillStyle = INK.dim;
  ctx.textAlign = 'left';
  for (const line of wrapped) {
    ctx.fillText(line, pad, ny);
    ny += 24;
  }

  state.cardDrawn = true;
  renderSendControls(view, false);
}

/**
 * Break a sentence onto as many lines as it needs.
 *
 * The footnotes are WRAPPED and never truncated, which is the opposite of what
 * a name gets. A member's name cut short is obviously cut short; a definition
 * cut short reads as a complete sentence that happens to say something else —
 * and "Loser % = LAST IN THE REGULAR SEASON" losing its "not the consolation
 * ladder" is exactly the misreading this page exists to prevent. The suite
 * caught it doing precisely that.
 */
function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  if (typeof ctx.measureText !== 'function') return [String(text)];

  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${line} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else { lines.push(line); line = words[i]; }
  }
  lines.push(line);
  return lines;
}

/** Truncate to fit, with a real ellipsis, measured rather than guessed at. */
function clip(ctx, text, maxWidth) {
  const s = String(text);
  if (typeof ctx.measureText !== 'function') return s;
  if (ctx.measureText(s).width <= maxWidth) return s;
  let cut = s;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
  return cut + '…';
}

/** A 2d context, or null in anything that has no canvas at all. */
function safeContext(canvas) {
  if (typeof canvas.getContext !== 'function') return null;
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch { return null; }
  if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.setTransform !== 'function') {
    return null;
  }
  return ctx;
}

// ---------------------------------------------------------------- sending it
//
// THE FEATURE DETECT IS ABOUT FILES, NOT ABOUT SHARING. `navigator.share`
// exists in desktop Chrome and shares a URL perfectly well while refusing a
// file, so testing for `share` alone would offer Tim a button that throws on
// his laptop. `canShare({files})` with a REAL File is the only question worth
// asking, and it is asked with a one-byte probe rather than by waiting for the
// card to be drawn — the button has to be right on the first paint.

function canShareFiles() {
  try {
    if (typeof navigator === 'undefined' || !navigator) return false;
    if (typeof navigator.share !== 'function') return false;
    if (typeof navigator.canShare !== 'function') return false;
    if (typeof File !== 'function') return false;
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
    return Boolean(navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

function fileName(view) {
  const slug = String(state.league?.name || 'league')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league';
  return `${slug}-week-${view?.through ?? 0}.png`;
}

function renderSendControls(view, noCanvas) {
  const share = $('shareBtn');
  const hint = $('shareHint');

  // WHETHER THE BUTTON EXISTS IS A FACT ABOUT THE BROWSER, not about this
  // particular draw. "Can this browser hand a file to a share sheet" is stable
  // for the life of the page, so it is what decides whether the control is
  // there at all. Whether THIS chart happened to draw is a different and far
  // rarer question, and it is answered by the status line when the button is
  // pressed — a control that appears and disappears as the week picker moves
  // would be worse than one that occasionally reports a failure.
  share.hidden = !state.canShare;

  // Download is deliberately NOT disabled when there is nothing to save. A
  // disabled button swallows the click and explains nothing, which is exactly
  // the silent-failure trap this page was warned about; pressed, it says why.
  const parts = [];
  parts.push(state.canShare
    ? 'Share hands the image to your phone’s share sheet — pick Messages, pick the group, ' +
      'and you see the message before it sends. Download and Copy as text are here too, ' +
      'for a laptop.'
    : 'This browser will not let a page share a file — desktop Chrome and Firefox mostly ' +
      'cannot — so the Share button is hidden rather than offered and then failing. ' +
      'Download saves the PNG; Copy as text puts the same chart on the clipboard. ' +
      'Open this page on your iPhone to get the share sheet.');
  if (noCanvas) {
    parts.push(
      'This browser cannot draw to a canvas, so there is no image here at all — the text ' +
      'version below is the same chart and can be pasted into any chat.'
    );
  }
  hint.textContent = parts.join(' ');
}

function sendStatus(msg, isError = false) {
  const el = $('shareStatus');
  el.textContent = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** The drawn card as a PNG blob, or null when there is nothing to make one from. */
function cardBlob() {
  return new Promise((resolve) => {
    const canvas = $('shareCanvas');
    if (!canvas || !state.cardDrawn) return resolve(null);

    if (typeof canvas.toBlob === 'function') {
      try {
        canvas.toBlob((b) => resolve(b || null), 'image/png');
        return;
      } catch { /* fall through to the data-URL route */ }
    }
    if (typeof canvas.toDataURL === 'function') {
      try {
        const url = canvas.toDataURL('image/png');
        const bin = atob(url.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return resolve(new Blob([bytes], { type: 'image/png' }));
      } catch { /* nothing else to try */ }
    }
    resolve(null);
  });
}

async function onShare() {
  const view = buildView();
  const blob = await cardBlob();
  if (!blob) {
    sendStatus('There is no image to share — the chart could not be drawn here.', true);
    return;
  }
  const file = new File([blob], fileName(view), { type: 'image/png' });

  // Asked again with the REAL file, not just the probe: a browser can accept a
  // one-byte png and refuse a 400KB one.
  if (!navigator.canShare?.({ files: [file] })) {
    sendStatus(
      'This browser refused to share the image. Use Download or Copy as text instead.',
      true
    );
    renderSendControls(view, false);
    return;
  }

  try {
    await navigator.share({ files: [file], title: `Week ${view.through} — ${state.league.name}` });
    sendStatus('Handed to your share sheet. Nothing has been sent by this page.');
  } catch (err) {
    // A cancelled share is not a failure and must not be reported as one — he
    // will back out of that sheet more often than he uses it.
    sendStatus(
      err && err.name === 'AbortError'
        ? 'Share cancelled — nothing was sent.'
        : `Could not share: ${err && err.message ? err.message : err}. Try Download instead.`,
      !(err && err.name === 'AbortError')
    );
  }
}

async function onDownload() {
  const view = buildView();
  const name = fileName(view);
  const blob = await cardBlob();
  if (!blob) {
    sendStatus(
      'The image could not be drawn in this browser, so there is nothing to save. ' +
      'The text version below is the same chart — select it and copy it.', true
    );
    return;
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a timer rather than immediately: some browsers have not started
    // reading the blob by the time click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    sendStatus(`Saved ${name} to your downloads.`);
  } catch (err) {
    sendStatus(`Could not save the image: ${err && err.message ? err.message : err}`, true);
  }
}

async function onCopy() {
  const text = state.cardText;
  if (!text) {
    sendStatus('There is nothing to copy yet.', true);
    return;
  }
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('this browser gives the page no clipboard');
    }
    await navigator.clipboard.writeText(text);
    sendStatus('Copied the chart as text. Paste it straight into the group chat.');
  } catch (err) {
    // The failure has to SAY something. A copy button that quietly does nothing
    // is the exact trap this page was warned about.
    sendStatus(
      `Could not write to the clipboard (${err && err.message ? err.message : err}). ` +
      'The same text is in the box below — select it and copy it by hand.', true
    );
    try { $('shareText').focus(); } catch { /* focus is a nicety, not the fix */ }
  }
}

// ------------------------------------------------------------------- controls

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  if (!el) return;
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

function paintSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

// One load at a time: the connection bar can announce a league while the page is
// already fetching one, and two runs would race.
let loading = false;

async function selectSource(src) {
  if (loading) return;
  loading = true;
  try {
    const ok = src === 'demo' ? await loadDemo() : await loadLive();
    if (ok) {
      state.source = src;
      prefs.set('source', src);
      // A new league invalidates whatever was simulated for the old one. Team
      // ids collide across leagues, so a stale run would print the demo
      // season's odds beside a real manager's name.
      state.sim = null;
      state.simPending = null;
      state.simToken++;
      render();
    }
  } finally {
    loading = false;
  }
  paintSource();
}

// Whether the reader chose a source by hand this page load. A league that
// connects a second later must not yank them off a choice they just made.
let sourcePicked = false;

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  sourcePicked = true;
  selectSource(btn.dataset.src);
});

$('weekSelect').addEventListener('change', (e) => {
  const w = clampWeek(e.target.value);
  if (w === state.throughWeek) return;
  state.throughWeek = w;
  // Live projections were fetched for "the weeks after the old cut-off". Moving
  // the cut-off earlier asks for weeks nobody has read yet, so ask again.
  if (state.league && !state.league.isDemo) refreshProjections();
  render();
});

$('shareBtn').addEventListener('click', onShare);
$('downloadBtn').addEventListener('click', onDownload);
$('copyBtn').addEventListener('click', onCopy);

enableSort($('summaryTable'));

// ------------------------------------------------------------------- boot

state.canShare = canShareFiles();
paintSource();
sendStatus('');

/**
 * The remembered source, but never a blank page.
 *
 * LIVE IS TRIED FIRST rather than after a demo boot, and that is not tidiness:
 * booting demo runs a full 100,000-season simulation this reader was never
 * going to look at, so the connected owner would wait a second for an answer
 * about a league that does not exist before his own started loading.
 *
 * It also has to read the preference before anything else, because loading a
 * source WRITES the preference. An earlier draft booted demo and then asked
 * which source was wanted — by which time the answer was always "demo", so a
 * reader who had chosen their real league was quietly put back on sample data
 * every visit, with the page looking entirely correct.
 */
async function start() {
  if (prefs.get('source') === 'live' && savedConfig()) {
    loading = true;
    try {
      if (await loadLive()) {
        state.source = 'live';
        render();
        return;
      }
      // Keep the reason on screen. A page that silently shows demo numbers
      // after failing to reach ESPN is the worst of the three outcomes.
      const why = $('sourceStatus').innerHTML;
      await loadDemo();
      state.source = 'demo';
      render();
      setStatus(`${why} Showing demo data instead.`, true);
    } finally {
      loading = false;
      paintSource();
    }
    return;
  }

  await loadDemo();
  state.source = 'demo';
  render();
  paintSource();
}

start();

// The connection bar probes in the background, so a league arriving after the
// page has booted is the normal case rather than the exception.
let triedLive = false;
onConnection((conn) => {
  if (!conn) return;
  if (triedLive || sourcePicked || state.source === 'live') return;
  triedLive = true;
  selectSource('live');
});
