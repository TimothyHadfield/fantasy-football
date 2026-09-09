// The waiver wire, read the one way it is actually useful: a week per column
// and a projection in every cell.
//
// ESPN's own "add players" screen answers a different question. It shows one
// week at a time behind twenty columns of ownership churn, so comparing two
// free agents over the run-in means clicking forward a week at a time and
// holding the numbers in your head. Everything here that is not a week number
// or a projection has been left out on purpose.
//
// THE COST IS THE DESIGN CONSTRAINT. ESPN publishes a per-week projection for
// every future week, but only for ONE week per request: the week comes from
// `scoringPeriodId`, and asking for a batch of weekly stat ids at once returns
// the current week and nothing else. That was tested against a real league
// rather than assumed (see the note over fetchFreeAgents in js/espn.js). So a
// thirteen-week table is thirteen requests, which is why this page:
//
//   - lets you choose how many weeks to price, and opens on three;
//   - renders the shell first and fills the columns in as each week lands;
//   - caches every week it has fetched, so the position filter is free.
//
// THE COMPARISON ROWS. A wire full of numbers still does not answer the only
// question worth asking — "is any of this better than what I already have?" —
// so your own worst player at each position is dropped into the SAME tbody,
// labelled "Your QB3", and sorts and filters alongside everyone else. That
// interleaving IS the answer: sort by Avg and the men above your row are the
// ones worth a claim. It costs a second request per week (rosters as well as
// free agents), cached the same way and keyed by the same week numbers.

import { fetchSchedule, fetchWeeksRosters } from './season.js';
import * as espn from './espn.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('waivers');

/**
 * How many available players to ask ESPN for, per week.
 *
 * The list comes back ordered by how widely owned each player is, which is the
 * order a waiver wire is worth reading in — so a limit is a cut off the bottom
 * of that order, not a random subset. A hundred is deep enough that every
 * position still has a bench behind it (the real spread at the top of the
 * order runs roughly QB 10 / RB 13 / WR 17 / TE 5 / K 7 / DST 8 per sixty) and
 * shallow enough to stay a table a person can scan.
 */
const POOL_LIMIT = 100;

/**
 * The week counts offered, and the one the page opens on.
 *
 * Three is the default because it is the horizon a waiver claim is actually
 * about — this week and the two you would hold him for — and because it is
 * three requests rather than thirteen on first paint. The other two are there
 * because a bye-week fill and a run-in stash are real questions too, and both
 * of them need more weeks than a claim does.
 */
const SPANS = ['3', '6', 'all'];
const SPAN_CHOICE = (v) => (SPANS.includes(String(v)) ? String(v) : '3');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
// Football's own order rather than the alphabet: sorting the position column
// should put the quarterbacks at one end, not the defenses.
const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i + 1]));

const state = {
  source: prefs.get('source', 'demo'),
  isDemo: true,
  leagueName: '',
  seasonWeeks: [],          // every week the league plays
  currentWeek: null,        // the week a claim made now would be for
  span: SPAN_CHOICE(prefs.get('span', '3')),
  position: prefs.get('position', 'ALL'),

  // The cache. Fetching is keyed on the week and nothing else, so changing the
  // position filter — or narrowing the span and widening it again — never
  // costs a request.
  pool: new Map(),          // playerId -> identity (name, position, team, status)
  weekData: new Map(),      // week -> Map(playerId -> projection | null)
  failedWeeks: new Set(),   // weeks ESPN refused; named in the note, not hidden

  // Your own squad, cached the same way and keyed by the same week numbers, so
  // the position filter and re-sorting still cost nothing and widening the span
  // never re-buys a week already held.
  rosterWeeks: new Map(),        // week -> the teams array for that week
  rosterProj: new Map(),         // week -> Map(playerId -> projection | null)
  failedRosterWeeks: new Set(),  // roster weeks ESPN refused; also named in the note
  demoTeamId: null,              // the demo league has no owner; a team stands in

  // Everything already asked for, so nothing is asked twice. Keyed "wire:4" /
  // "roster:4" rather than by the bare week, because a week now costs two
  // different requests and one of them can be in the air without the other.
  inFlight: new Set(),

  // Guards a slow week landing after the source changed underneath it. It is
  // bumped ONLY when the league being read changes — widening the span must not
  // invalidate a request already in the air, because throwing that week away
  // just means paying for it again, and requests are the scarce thing here.
  token: 0,
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

const dash = '<span class="muted">—</span>';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "weeks 4–6" / "week 4" — an en dash, the way the rest of the site writes ranges. */
function weekRange(weeks) {
  if (!weeks.length) return 'no weeks';
  if (weeks.length === 1) return `week ${weeks[0]}`;
  return `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
}

/** "5 and 7" / "5, 7 and 9" — for naming the weeks that failed. */
function andList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ------------------------------------------------------------------ availability
//
// ESPN's injury status is the one piece of "the pile of columns" worth keeping:
// a projection does not say out loud that the player cannot play this week, and
// claiming someone on IR is a wasted move rather than a cheap one.

const INJURY = {
  OUT: { tag: 'OUT', cls: 'bad', dim: true, why: 'ESPN lists this player as out.' },
  INJURY_RESERVE: { tag: 'IR', cls: 'bad', dim: true, why: 'ESPN has this player on injured reserve.' },
  SUSPENSION: { tag: 'SUSP', cls: 'bad', dim: true, why: 'ESPN lists this player as suspended.' },
  DOUBTFUL: { tag: 'D', cls: 'warn', dim: false, why: 'ESPN lists this player as doubtful.' },
  QUESTIONABLE: { tag: 'Q', cls: 'warn', dim: false, why: 'ESPN lists this player as questionable.' },
  DAY_TO_DAY: { tag: 'DTD', cls: 'warn', dim: false, why: 'ESPN lists this player as day to day.' },
};

const availability = (status) => INJURY[status] || null;

// ------------------------------------------------------------------- demo pool
//
// There is no demo waiver wire in the repo, so this page carries its own. It is
// generated from a fixed seed: flicking to demo and back must not hand you a
// different set of players, and a table whose numbers move on their own reads
// as noise even when it is not.
//
// The players are invented on purpose. Plausible-looking real names in a demo
// pool are the one thing that could make somebody act on a number this page
// made up, and the panel note says so in as many words.

const DEMO_SEED = 20260909;
const DEMO_WEEKS = 13;
const DEMO_CURRENT_WEEK = 4;

const DEMO_FIRST = ['Ash', 'Bryce', 'Cal', 'Dane', 'Elias', 'Finn', 'Gray', 'Hollis', 'Ike', 'Jory', 'Knox', 'Lem'];
const DEMO_LAST = [
  'Ardent', 'Bellweather', 'Cranmore', 'Dunhill', 'Everly', 'Fairbanks', 'Grimsby',
  'Hallow', 'Ingram', 'Jessop', 'Kestrel', 'Larkin', 'Mowbray', 'Nettles', 'Ovett',
  'Pike', 'Quarry', 'Rossiter', 'Stillwell', 'Thorne',
];

// Abbreviation and bye week. Real abbreviations, because the column is only
// there to tell two players apart and a made-up one would just look broken.
const DEMO_TEAMS = [
  ['BUF', 7], ['CIN', 10], ['DAL', 6], ['DEN', 12], ['GB', 5], ['KC', 6],
  ['MIA', 9], ['NYJ', 9], ['PHI', 5], ['SEA', 8], ['TB', 11], ['TEN', 10],
];

// Roughly the spread a real waiver wire has at the top of the ownership order.
const DEMO_PLAN = [['QB', 6], ['RB', 9], ['WR', 12], ['TE', 4], ['K', 4], ['DST', 5]];
// Nudged up from where these started so the best demo player at each position
// clears the startable bar in STARTABLE at least some weeks. They previously
// topped out just under it for RB, WR and TE — arithmetically fine, but it
// meant the green highlight could never appear for three of the six positions
// and the feature looked broken to anyone reading the demo.
const DEMO_BASE = { QB: 15, RB: 9.5, WR: 9.5, TE: 6.5, K: 7.5, DST: 6.5 };

/** A tiny LCG, so the pool is identical on every load and in every browser. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function generateDemoPool() {
  const rand = lcg(DEMO_SEED);
  const players = [];
  let i = 0;

  for (const [position, count] of DEMO_PLAN) {
    for (let k = 0; k < count; k++, i++) {
      const [proTeam, byeWeek] = DEMO_TEAMS[(i * 7) % DEMO_TEAMS.length];
      // Best of each position first, thinning out down the group, so the table
      // has a real top and a real bottom rather than forty similar players.
      const quality = 1.3 - 0.8 * (count === 1 ? 0 : k / (count - 1));
      const surname = DEMO_LAST[(i * 7) % DEMO_LAST.length];
      const name = position === 'DST'
        ? `${surname} Defense`
        : `${DEMO_FIRST[i % DEMO_FIRST.length]} ${surname}`;

      const noise = [];
      for (let w = 0; w < 20; w++) noise.push(0.82 + rand() * 0.36);

      players.push({
        playerId: 900000 + i,
        name,
        position,
        proTeam,
        proTeamId: null,
        byeWeek,
        injuryStatus: i === 4 ? 'OUT' : i === 12 ? 'INJURY_RESERVE' : i === 19 ? 'QUESTIONABLE' : 'ACTIVE',
        percentOwned: Math.round(46 * (quality / 1.3) * (0.35 + rand() * 0.65) * 10) / 10,
        base: DEMO_BASE[position] * quality,
        // The last player of each position group is the one ESPN sometimes
        // carries no number for at all — so the demo shows a blank cell and a
        // bye cell side by side, which is the distinction the note makes.
        fringe: k === count - 1,
        noise,
      });
    }
  }

  // ESPN hands the list back most-owned first; so does this.
  players.sort((a, b) => b.percentOwned - a.percentOwned || a.playerId - b.playerId);
  return players;
}

/**
 * One demo player's projection for one week.
 *
 * 0 for a bye and null for "no number at all", because those are the two things
 * live data does and the page renders them differently.
 */
function demoProjection(p, week) {
  if (week === p.byeWeek) return 0;
  if (p.fringe && (week === 4 || week === 9)) return null;
  return Math.round(p.base * p.noise[(week - 1) % p.noise.length] * 10) / 10;
}

// -------------------------------------------------------------------- loading

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** Throw away every fetched week. Called when the league underneath changes. */
function resetData() {
  state.pool.clear();
  state.weekData.clear();
  state.failedWeeks.clear();
  state.rosterWeeks.clear();
  state.rosterProj.clear();
  state.failedRosterWeeks.clear();
  state.demoTeamId = null;
  // Anything still in the air belongs to the league we just left; the token
  // bump drops it when it lands, and clearing this lets the new league ask for
  // the same week numbers straight away.
  state.inFlight.clear();
  state.token++;
}

async function loadDemo() {
  resetData();
  const token = state.token;

  state.isDemo = true;
  state.leagueName = 'Demo League';
  state.seasonWeeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  state.currentWeek = DEMO_CURRENT_WEEK;

  // No network, so there is nothing to stagger: fill every week at once and let
  // the same renderers draw it.
  for (const p of generateDemoPool()) {
    state.pool.set(p.playerId, p);
    for (const w of state.seasonWeeks) {
      if (!state.weekData.has(w)) state.weekData.set(w, new Map());
      state.weekData.get(w).set(p.playerId, demoProjection(p, w));
    }
  }

  if (token !== state.token) return;
  setStatus(
    `Generated sample data — invented players, invented projections, not your real league. ` +
    `The season is pretended to be at week ${DEMO_CURRENT_WEEK}.`
  );
  render();
  loadDemoRosters(token);
}

/**
 * The squads the comparison rows come from, in demo mode.
 *
 * demo-rosters.js is loaded lazily and defensively: it is the only thing on
 * this page that needs it, live mode never does, and a missing or broken file
 * should cost the comparison rows and nothing else.
 *
 * The demo league has no owner, so the first team stands in for yours — the
 * same stand-in the schedule page's forecast panel makes when nobody is set as
 * you, and the note says so out loud rather than letting a stranger's bench
 * pass for your own.
 */
async function loadDemoRosters(token) {
  let generate = null;
  try {
    const mod = await import('./demo-rosters.js');
    if (typeof mod.generateDemoWeekRosters === 'function') generate = mod.generateDemoWeekRosters;
  } catch { /* handled below, as a missing comparison rather than a broken page */ }

  if (token !== state.token) return;

  if (!generate) {
    for (const w of state.seasonWeeks) state.failedRosterWeeks.add(w);
    render();
    return;
  }

  for (const w of state.seasonWeeks) {
    try {
      absorbRosterWeek(generate(w).teams, w);
    } catch {
      state.failedRosterWeeks.add(w);
    }
  }
  const first = state.rosterWeeks.get(state.seasonWeeks[0]);
  state.demoTeamId = first && first.length ? first[0].id : null;
  render();
}

async function loadLive() {
  resetData();
  const token = state.token;

  const saved = savedConfig();
  if (!saved) {
    state.isDemo = false;
    setStatus('No league connected yet. Connect one in the bar above, or on the Connection page.', true);
    render();
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.isDemo = false;
  state.leagueName = 'Your league';
  setStatus('Reading your league…');
  render();

  // The league's own week list, so the columns are the weeks this league
  // actually plays rather than a guess at how long a season is. One request.
  try {
    const schedule = await fetchSchedule();
    if (token !== state.token) return;
    state.leagueName = schedule.leagueName || 'Your league';
    state.seasonWeeks = schedule.weeks.slice();
    state.currentWeek = currentWeekOf(schedule);
  } catch (err) {
    if (token !== state.token) return;
    setStatus(
      `Could not read this league's schedule, so the weeks below are a guess ` +
      `at a full season. ${esc(err.message)}`,
      true
    );
    state.seasonWeeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
    state.currentWeek = state.seasonWeeks[0];
  }

  if (!state.seasonWeeks.length) {
    setStatus(
      `Connected to ${esc(state.leagueName)}, but ESPN returned no weeks for this season. ` +
      `If the season hasn't started, try an earlier season on the Connection page.`,
      true
    );
    render();
    return;
  }

  render();
  refreshWeeks(token);
}

/**
 * The week a claim made right now would be for: the first week nothing has been
 * scored in. A finished season falls back to its last week, so the table always
 * has somewhere to start rather than going blank in January.
 */
function currentWeekOf(schedule) {
  for (const w of schedule.weeks) {
    const games = schedule.byWeek.get(w) || [];
    if (!games.some((g) => g.played)) return w;
  }
  return schedule.weeks[schedule.weeks.length - 1] ?? 1;
}

// ---------------------------------------------------------------- week fetching

/** The weeks the table is currently showing as columns. */
function shownWeeks() {
  const from = state.currentWeek ?? state.seasonWeeks[0];
  const rest = state.seasonWeeks.filter((w) => w >= from);
  const weeks = rest.length ? rest : state.seasonWeeks.slice();
  if (state.span === 'all') return weeks;
  return weeks.slice(0, Number(state.span));
}

/** A week's wire is worth asking for: not held, not refused, not already in the air. */
const wantsWire = (w) =>
  !state.weekData.has(w) && !state.failedWeeks.has(w) && !state.inFlight.has(`wire:${w}`);

/** The same test for that week's rosters — only asked for when there is a you. */
const wantsRoster = (w) =>
  comparing() &&
  !state.rosterWeeks.has(w) && !state.failedRosterWeeks.has(w) && !state.inFlight.has(`roster:${w}`);

/**
 * Fetch whatever the chosen span needs and does not already have, filling the
 * columns in as each week lands.
 *
 * Two weeks at a time rather than all at once: thirteen open sockets to ESPN is
 * rude and no faster, and a strict one-at-a-time makes the full season feel
 * slow. A week now costs up to two requests — the wire and the rosters — and
 * they are tracked separately, so one failing loses only its half. A request
 * ESPN refuses is remembered as failed rather than retried in a loop; the note
 * names it, and reloading is the way to try again.
 */
async function refreshWeeks(token) {
  if (state.isDemo) return;

  const missing = shownWeeks().filter((w) => wantsWire(w) || wantsRoster(w));
  if (!missing.length) {
    render();   // whatever is still in the air will repaint when it lands
    return;
  }

  render();

  for (let i = 0; i < missing.length; i += 2) {
    // Re-checked at the moment the requests are actually about to be spent, not
    // when the list was drawn up: another run started while this one was
    // awaiting may already have claimed one of these weeks.
    const batch = missing.slice(i, i + 2);
    const wire = batch.filter(wantsWire);
    const rosters = batch.filter(wantsRoster);
    if (!wire.length && !rosters.length) continue;

    wire.forEach((w) => state.inFlight.add(`wire:${w}`));
    rosters.forEach((w) => state.inFlight.add(`roster:${w}`));

    const jobs = wire.map(async (week) => {
      let raw = null;
      let ok = false;
      try {
        raw = await espn.fetchFreeAgents(week, POOL_LIMIT);
        ok = true;
      } catch {
        ok = false;
      }
      state.inFlight.delete(`wire:${week}`);

      // A response about a league we have already left is dropped here, before
      // it can repaint a table it is no longer about.
      if (token !== state.token) return;
      if (ok) absorbWeek(raw, week);
      else state.failedWeeks.add(week);
    });

    if (rosters.length) {
      // fetchWeeksRosters swallows a week ESPN refuses — it simply comes back
      // absent — so a gap in the result is what marks a failed roster week.
      jobs.push((async () => {
        let got = new Map();
        try {
          got = await fetchWeeksRosters(rosters);
        } catch {
          got = new Map();
        }
        rosters.forEach((w) => state.inFlight.delete(`roster:${w}`));

        if (token !== state.token) return;
        for (const week of rosters) {
          if (got.has(week)) absorbRosterWeek(got.get(week), week);
          else state.failedRosterWeeks.add(week);
        }
      })());
    }

    await Promise.all(jobs);

    if (token !== state.token) return;
    render();
  }

  if (token !== state.token) return;

  const shown = shownWeeks();
  const got = shown.filter((w) => state.weekData.has(w)).length;
  const mineGot = shown.filter((w) => state.rosterWeeks.has(w)).length;
  setStatus(
    `Loaded ${plural(state.pool.size, 'available player')} from ${esc(state.leagueName)} ` +
    `across ${plural(got, 'week')}` +
    (comparing() ? `, and your own squad for ${plural(mineGot, 'week')}` : '') + '.'
  );
  render();
}

/**
 * How far through the weeks on screen we are, derived from the cache rather
 * than counted by the loop — so two overlapping loads (widen the span while the
 * first three weeks are still arriving) report one honest number between them.
 */
function progressText() {
  if (state.isDemo) return '';
  const wanted = shownWeeks();
  // A week is done when BOTH halves of it are — the wire and, when there is a
  // you to compare against, that week's rosters.
  const pending = wanted.filter(
    (w) =>
      (!state.weekData.has(w) && !state.failedWeeks.has(w)) ||
      (comparing() && !state.rosterWeeks.has(w) && !state.failedRosterWeeks.has(w))
  );
  if (!pending.length) return '';
  return `Reading ESPN’s weekly projections… week ${wanted.length - pending.length} of ${wanted.length}.`;
}

/** Merge one week's payload into the cache, keyed by playerId. */
function absorbWeek(raw, week) {
  const byPlayer = new Map();

  for (const entry of raw?.players || []) {
    const p = espn.parseFreeAgent(entry, week);
    if (p.playerId === null || p.playerId === undefined) continue;

    const known = state.pool.get(p.playerId);
    if (!known) {
      state.pool.set(p.playerId, {
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        proTeam: p.proTeam,
        proTeamId: p.proTeamId,
        injuryStatus: p.injuryStatus,
        percentOwned: p.percentOwned,
        seasonProjected: p.seasonProjected,
      });
    } else {
      // The same player comes back in every week's payload. Later weeks carry
      // the fresher injury status and ownership, so let them win; the ordering
      // of the list itself is not assumed to be identical week to week, which
      // is exactly why this merges on playerId rather than on position.
      known.injuryStatus = p.injuryStatus;
      if (p.percentOwned !== null) known.percentOwned = p.percentOwned;
      if (p.seasonProjected !== null) known.seasonProjected = p.seasonProjected;
    }

    byPlayer.set(p.playerId, p.projected);
  }

  state.weekData.set(week, byPlayer);
}

/**
 * Merge one week's rosters into the cache.
 *
 * The whole teams array is kept, not just yours, for two reasons. Changing who
 * "you" are in the connection bar then costs a repaint rather than a refetch.
 * And a man you hold in week 4 can be somebody else's by week 9 — his week 9
 * projection is still the number you are comparing against, so the per-week
 * index is built across every team rather than only your own.
 */
function absorbRosterWeek(teams, week) {
  state.rosterWeeks.set(week, teams);

  const byPlayer = new Map();
  for (const team of teams || []) {
    for (const p of team.players || []) {
      if (p.playerId === null || p.playerId === undefined) continue;
      byPlayer.set(p.playerId, p.projected);
    }
  }
  state.rosterProj.set(week, byPlayer);
}

// ---------------------------------------------------------------------- rows

/**
 * One player's projection for one week, in three distinguishable states:
 *   undefined  the week has not been fetched yet
 *   null       ESPN's list carried no number for him that week
 *   0          his NFL team is on bye — ESPN's own way of saying so
 */
function valueFor(playerId, week) {
  const forWeek = state.weekData.get(week);
  if (!forWeek) return undefined;
  const v = forWeek.get(playerId);
  return v === undefined ? null : v;
}

/**
 * Every row the table could show, with the mean of the weeks on screen.
 *
 * The average is DERIVED — ESPN publishes no such number — and it exists
 * because a column per week has no single "who is best" ordering without one.
 * A bye counts as the zero ESPN returns, because a week he cannot play is part
 * of what you are getting; a week with no number at all is left out, because
 * counting it as zero would punish a player for a gap in ESPN's data.
 */
function buildRows(weeks) {
  const rows = [];
  for (const p of state.pool.values()) {
    const values = weeks.map((w) => valueFor(p.playerId, w));
    const real = values.filter((v) => typeof v === 'number');
    rows.push({
      p,
      values,
      avg: real.length ? real.reduce((a, b) => a + b, 0) / real.length : null,
      counted: real.length,
    });
  }
  return rows;
}

const matchesFilter = (row) =>
  state.position === 'ALL' || row.p.position === state.position;

// ------------------------------------------------------- the comparison rows

/**
 * Whose squad the "Your …" rows are, or null if there is nobody to be.
 *
 * Never localStorage directly: `savedConfig()` is the one reader of that key,
 * and going round it was a real bug once.
 */
function myTeamId() {
  if (state.isDemo) return state.demoTeamId;
  const saved = savedConfig();
  const id = saved ? saved.teamId : null;
  return id === null || id === undefined ? null : Number(id);
}

/** Whether the comparison rows can exist at all. Drives the extra request too. */
const comparing = () => myTeamId() !== null;

/** One of your players' projection for one week — the same three states as the wire. */
function myValueFor(playerId, week) {
  const forWeek = state.rosterProj.get(week);
  if (!forWeek) return undefined;
  const v = forWeek.get(playerId);
  return v === undefined ? null : v;
}

/**
 * Your worst player at each position you hold, as rows for the same table.
 *
 * "Worst" is the lowest Avg over the weeks currently shown, computed exactly
 * the way the wire's is — byes counted as the zero ESPN returns, weeks with no
 * number at all left out — because a comparison between two differently-derived
 * averages is not a comparison.
 *
 * The squad is the one you hold in the EARLIEST week on screen: a claim made
 * now replaces somebody on the roster as it stands now, not as it stood in some
 * later week ESPN happens to have projected. So the label's number — QB3, K2 —
 * is how many you hold at that position today.
 */
function buildMineRows(weeks) {
  const teamId = myTeamId();
  if (teamId === null) return [];

  const anchor = weeks.find((w) => state.rosterWeeks.has(w));
  if (anchor === undefined) return [];

  const team = (state.rosterWeeks.get(anchor) || []).find((t) => t.id === teamId);
  if (!team) return [];

  const held = new Map();   // position -> rows
  for (const p of team.players || []) {
    if (!POS_ORDER.has(p.position)) continue;   // an unknown slot is not a position
    const values = weeks.map((w) => myValueFor(p.playerId, w));
    const real = values.filter((v) => typeof v === 'number');
    if (!held.has(p.position)) held.set(p.position, []);
    held.get(p.position).push({
      p,
      values,
      avg: real.length ? real.reduce((a, b) => a + b, 0) / real.length : null,
      mine: true,
    });
  }

  const rows = [];
  for (const [position, group] of held) {
    // Only a player ESPN has actually projected can be called the worst one; a
    // player with no number at all over these weeks is unknown, not bad, and
    // naming him would be inventing the comparison. The depth still counts
    // everybody held there, because that is what depth means.
    const rated = group.filter((r) => r.avg !== null);
    if (!rated.length) continue;
    const worst = rated.reduce((a, b) =>
      b.avg < a.avg || (b.avg === a.avg && b.p.playerId < a.p.playerId) ? b : a
    );
    rows.push({ ...worst, depth: group.length, label: `Your ${position}${group.length}` });
  }

  // Football's own order, so an unsorted set of them reads QB first.
  rows.sort((a, b) => (POS_ORDER.get(a.p.position) ?? 9) - (POS_ORDER.get(b.p.position) ?? 9));
  return rows;
}

/** How many players sit behind each button on the position control. */
function positionCounts() {
  const counts = { ALL: state.pool.size };
  for (const pos of POSITIONS) counts[pos] = 0;
  for (const p of state.pool.values()) {
    if (counts[p.position] !== undefined) counts[p.position]++;
  }
  return counts;
}

// --------------------------------------------------------------------- render

function render() {
  syncSource();
  syncSegmented('posFilter', 'pos', state.position);
  syncSegmented('spanFilter', 'span', state.span);

  $('modeBadge').className = 'badge ' + (state.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = state.isDemo ? 'Demo' : 'Live';

  const weeks = shownWeeks();
  $('pageSub').textContent = state.isDemo
    ? 'Showing a generated sample waiver wire so you can see the layout with real-looking projections in it.'
    : `${state.leagueName} · ${state.pool.size || 'no'} available players · ${weekRange(weeks)}`;

  renderCost(weeks);
  renderCounts();
  renderTable(weeks);
  renderStats(weeks);
  renderNote(weeks);
}

function syncSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

function syncSegmented(id, key, value) {
  $(id)
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset[key] === String(value)));
}

/** What the chosen span costs, said next to the control that spends it. */
function renderCost(weeks) {
  if (state.isDemo) {
    $('spanCost').textContent =
      `${plural(weeks.length, 'week')} shown. Demo data costs nothing to widen.`;
    return;
  }
  // A week costs the wire AND, once there is a you to compare against, that
  // week's rosters. The line has to say so, or it understates the choice by half.
  const withMine = comparing();
  const per = withMine ? 2 : 1;

  let have = weeks.filter((w) => state.weekData.has(w)).length;
  let gone = weeks.filter((w) => state.failedWeeks.has(w)).length;
  if (withMine) {
    have += weeks.filter((w) => state.rosterWeeks.has(w)).length;
    gone += weeks.filter((w) => state.failedRosterWeeks.has(w)).length;
  }
  const todo = weeks.length * per - have - gone;

  const bits = [];
  if (have) bits.push(`${have} already loaded`);
  if (todo) bits.push(`${todo} still to fetch`);
  if (gone) bits.push(`${gone} refused by ESPN`);

  $('spanCost').textContent =
    `${plural(weeks.length, 'week')} = ${plural(weeks.length * per, 'request')} to ESPN, ` +
    (withMine ? 'the wire and your roster for each one' : 'one per week') +
    ` — there is no bulk form.` + (bits.length ? ` ${bits.join(', ')}.` : '');
}

function renderCounts() {
  const counts = positionCounts();
  $('posFilter').querySelectorAll('button[data-pos]').forEach((b) => {
    const n = counts[b.dataset.pos] ?? 0;
    const slot = b.querySelector('.seg-count');
    if (slot) slot.textContent = state.pool.size ? String(n) : '';
  });
}

function renderHead(weeks) {
  const cols = weeks
    .map((w, i) => {
      const failed = state.failedWeeks.has(w);
      const cls = [i === 0 ? 'grouped' : '', failed ? 'muted' : ''].filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : `ESPN’s projected points for week ${w}.`;
      return `<th data-sort${cls ? ` class="${cls}"` : ''} title="${title}">${w}</th>`;
    })
    .join('');

  $('waiverTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort>Player</th>
       <th class="left" data-sort>Pos</th>
       <th class="left" data-sort>Tm</th>
       <th data-sort title="The mean of the week columns shown. Ours, not ESPN's: a bye counts as the zero ESPN returns, a week with no number at all is left out.">Avg</th>
       ${cols}
     </tr>`;
}

/**
 * What counts as a genuinely startable week, by position — Tim's numbers.
 *
 * These are thresholds, not percentiles: a week is worth noticing on its own
 * terms, not relative to whoever else happens to be on the wire this week. A
 * position with no entry is never highlighted rather than being given a
 * borrowed number.
 */
const STARTABLE = { QB: 17, RB: 12, WR: 12, TE: 9, DST: 7, K: 9 };

/** Strictly over the line: "over 17" does not include 17. */
function isStartable(v, position) {
  const bar = STARTABLE[position];
  return typeof bar === 'number' && typeof v === 'number' && v > bar;
}

/**
 * One week's cell.
 *
 * `mine` marks a cell on a comparison row, which changes two things: the week
 * it is waiting on is the ROSTER read rather than the wire read, and it is
 * never coloured green. The green flags a wire player worth starting — an
 * argument for claiming him. On a man already on your bench it would be
 * answering a different question, so those weeks stay uncoloured.
 *
 * `yours` is the matching "Your …" row's number for the SAME week, when you
 * hold anyone at that position. A wire week that beats it is shaded, because
 * that is the whole question a waiver claim asks. The two greens are separate
 * cues answering separate questions and a cell can carry both at once:
 *
 *   the accent text  he is worth starting in his own right (the STARTABLE bar)
 *   the green shade  he out-projects the man you would drop, that week
 *
 * So they are a colour AND a treatment apart, not two shades of one colour.
 */
function cell(v, week, name, position, mine = false, yours = null) {
  if (v === undefined) {
    // Three ways to have no number, and a reader has to be able to tell them
    // apart: still coming, refused outright, or ESPN simply had nothing.
    if (mine ? state.failedRosterWeeks.has(week) : state.failedWeeks.has(week)) {
      return `<td class="muted" title="${
        mine
          ? `ESPN refused week ${week}’s rosters, so there is no projection for your own ` +
            `players that week. Reload the page to try again.`
          : `Week ${week} did not load — ESPN refused it, so this column is empty for ` +
            `everyone. Reload the page to try again.`
      }">${dash}</td>`;
    }
    return `<td class="wait" title="${
      mine
        ? `Week ${week}’s rosters have not been read from ESPN yet.`
        : `Week ${week} has not been read from ESPN yet.`
    }">·</td>`;
  }
  if (v === null) {
    // No data-v at all — never data-v="" — so an unknown sinks to the bottom
    // whichever way the column is sorted.
    return `<td title="ESPN’s week ${week} ${mine ? 'rosters carried' : 'list carried'} ` +
      `no projection for ${esc(name)}.">${dash}</td>`;
  }
  if (v === 0) {
    return `<td class="bye" data-v="0" ` +
      `title="${esc(name)} is on bye in week ${week}. ESPN returns 0.00 for a bye, ` +
      `which is not the same as a projection of nothing.">Bye</td>`;
  }
  // A bye has already returned above, so neither cue can fire on one — which is
  // right for both: 0.00 is never startable, and it cannot beat anybody.
  const hot = !mine && isStartable(v, position);
  const beats = !mine && yours !== null && typeof yours.value === 'number' && v > yours.value;
  if (!hot && !beats) return `<td data-v="${v}">${fmt(v)}</td>`;

  const why = [`${fmt(v)} projected in week ${week}`];
  if (hot) why.push(`over the ${STARTABLE[position]} that makes a ${esc(position)} worth starting`);
  if (beats) {
    why.push(
      `ahead of ${esc(yours.name)} on ${fmt(yours.value)} — your worst ${esc(position)}, ` +
      `the man this claim would drop`
    );
  }

  const cls = [hot ? 'hot' : '', beats ? 'beats' : ''].filter(Boolean).join(' ');
  return `<td class="${cls}" data-v="${v}" title="${why.join(', ')}.">${fmt(v)}</td>`;
}

/** The injury tag beside a name. Same markup wherever the player came from. */
function injuryTag(status) {
  return status
    ? ` <span class="tag ${status.cls}" title="${esc(status.why)}">${status.tag}</span>`
    : '';
}

/** The three columns after the name, shared by both kinds of row. */
function identityCells({ p, avg }) {
  return `<td class="left" data-v="${POS_ORDER.get(p.position) ?? 9}">${esc(p.position)}</td>
      <td class="left">${esc(p.proTeam)}</td>
      <td class="avg grouped"${avg === null ? '' : ` data-v="${avg}"`}>${
        avg === null ? dash : fmt(avg)
      }</td>`;
}

/**
 * A player you could claim.
 *
 * `mine` is the position -> comparison row map, so each week's cell can be
 * measured against your own man's number for that same week. Built from the
 * UNFILTERED set, so the shading means the same thing whichever position
 * button is pressed.
 */
function wireRow(row, weeks, mine) {
  const { p, values } = row;
  const status = availability(p.injuryStatus);
  const yours = mine.get(p.position) || null;

  return `<tr${status && status.dim ? ' class="unavailable"' : ''}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}" title="${esc(p.name)}${
        p.percentOwned === null || p.percentOwned === undefined
          ? ''
          : ` — owned in ${fmt(p.percentOwned)}% of ESPN leagues`
      }">${esc(p.name)}${injuryTag(status)}</td>
      ${identityCells(row)}
      ${values
        .map((v, i) =>
          cell(v, weeks[i], p.name, p.position, false,
            yours ? { name: yours.p.name, value: yours.values[i] } : null))
        .join('')}
    </tr>`;
}

/**
 * The man you would drop. Marked, not dimmed: an OUT free agent is not worth
 * reading first, but your own man being out is the whole reason to look.
 */
function mineRow(row, weeks) {
  const { p, values, label, depth } = row;
  const why =
    `${esc(p.name)} — on your roster, not on the wire. Your lowest-averaging ` +
    `${esc(p.position)} over ${weekRange(weeks)}, of the ${depth} you hold there.`;

  return `<tr class="mine">
      <td class="name" data-v="${esc(p.name.toLowerCase())}" title="${why}">` +
        `<span class="mine-tag">${esc(label)}</span> ${esc(p.name)}` +
        `${injuryTag(availability(p.injuryStatus))}</td>
      ${identityCells(row)}
      ${values.map((v, i) => cell(v, weeks[i], p.name, p.position, true)).join('')}
    </tr>`;
}

function renderTable(weeks) {
  const table = $('waiverTable');
  const tbody = table.querySelector('tbody');
  renderHead(weeks);

  const all = buildRows(weeks);
  const available = all.filter(matchesFilter);
  const mineAll = buildMineRows(weeks);
  // Keyed by position for the shading, and built before the filter: a wire RB
  // is measured against your worst RB whether or not the RB button is pressed.
  const byPosition = new Map(mineAll.map((r) => [r.p.position, r]));
  const mine = mineAll.filter(matchesFilter);
  const cols = weeks.length + 4;

  if (!available.length && !mine.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">${esc(emptyReason(all.length))}</td></tr>`;
    resort(table);
    return;
  }

  // One tbody, deliberately. resort() then interleaves your own man with the
  // players who might replace him, which is the entire point of the feature:
  // sort by Avg and everyone above your row is an upgrade.
  tbody.innerHTML =
    available.map((r) => wireRow(r, weeks, byPosition)).join('') +
    mine.map((r) => mineRow(r, weeks)).join('');

  // Keep whatever sort the user picked when the row set changes.
  resort(table);
}

/** An empty table says why it is empty and what to do about it. */
function emptyReason(totalPlayers) {
  if (progressText()) return 'Reading the waiver wire from ESPN…';

  if (totalPlayers > 0) {
    const label = state.position === 'DST' ? 'defense' : state.position;
    return `No ${label} is available in this league right now. ` +
      `Switch the filter back to All to see the other ${plural(totalPlayers, 'player')}.`;
  }

  if (state.isDemo) return 'The demo pool is empty, which should not happen — reload the page.';

  if (!savedConfig()) {
    return 'No league is connected, so there is no waiver wire to read. ' +
      'Connect one in the bar above, or switch back to Demo data.';
  }
  if (state.failedWeeks.size) {
    return `ESPN refused every week we asked for (${andList([...state.failedWeeks].sort((a, b) => a - b).map(String))}). ` +
      'Reload the page to try again, or check the league is still readable on the Connection page.';
  }
  return 'ESPN says nobody is unrostered in this league right now. ' +
    'Every player is on a team — there is nothing to claim until somebody drops one.';
}

function renderStats(weeks) {
  const el = $('waiverStats');
  const rows = buildRows(weeks).filter(matchesFilter);

  if (!rows.length) {
    el.innerHTML = '';
    return;
  }

  const rated = rows.filter((r) => r.avg !== null);
  const best = rated.length ? rated.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const label = state.position === 'ALL' ? 'Available' : `Available ${state.position}`;

  const items = [
    [label, String(rows.length), state.position === 'ALL' ? '' : `of ${state.pool.size} in the pool`],
    ['Weeks shown', String(weeks.length), weekRange(weeks)],
  ];
  if (best) items.push(['Best average', fmt(best.avg), best.p.name]);

  el.innerHTML = items
    .map(([k, v, who]) =>
      `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>` +
      `${who ? `<div class="who" title="${esc(who)}">${esc(who)}</div>` : ''}</div>`)
    .join('');
}

/**
 * What a "Your …" row is, why that player and not another, and what the number
 * after the position means — plus, when there are none, how to turn them on.
 */
function comparisonNote(weeks) {
  const parts = [];

  if (!comparing()) {
    parts.push(
      state.isDemo
        ? 'The demo squads could not be generated this time, so there are no ' +
          '<span class="mine-key">Your …</span> rows to compare the wire against.'
        : 'Nobody is set as you, so the table below is the wire on its own. Choose your team ' +
          'in the “You are” menu in the connection bar and every position you hold gains a ' +
          '<span class="mine-key">Your QB3</span> row — your worst man there, sorted in among ' +
          'the players who could replace him.'
    );
    return parts;
  }

  parts.push(
    'A row marked <span class="mine-key">Your QB3</span> is one of your own players rather ' +
    'than someone you can add: the worst man you hold at that position, put in the same list ' +
    'so you can see who on the wire beats him. Worst means the lowest Avg over the weeks ' +
    'currently shown, worked out exactly the way the wire’s is — so widening the span can ' +
    'change which of your men appears. The number is your depth there: QB3 because you hold ' +
    'three quarterbacks, K2 because you hold two kickers. These rows sort and filter with ' +
    'everything else, which is why they are in the table rather than beside it. They are never ' +
    'coloured green themselves — whether to start your own bench is a different question — and ' +
    'they are never counted on the position buttons, because you cannot add a player you ' +
    'already have. Their week numbers are what the green shading above is measured against.'
  );

  if (state.isDemo) {
    parts.push(
      'The demo league has no owner, so those rows are the first team’s squad standing in ' +
      'for yours.'
    );
  }

  const missing = weeks.filter((w) => state.failedRosterWeeks.has(w));
  if (missing.length) {
    const named = andList(missing.map(String));
    parts.push(
      missing.length === weeks.length
        ? `<span class="neg">ESPN refused your rosters for every week shown ` +
          `(${named}), so there is nothing of yours to compare against. The wire below is ` +
          `still ESPN’s. Reload the page to try again.</span>`
        : `<span class="neg">ESPN refused your rosters for ` +
          `${missing.length === 1 ? 'week' : 'weeks'} ${named}, so your own rows average only ` +
          `the weeks that did load. Reload the page to try again.</span>`
    );
  }

  return parts;
}

/**
 * What these numbers are, said every time they are shown.
 *
 * Four things have to be in here or the table is quietly misleading: whose
 * projections these are, that a Bye cell and a blank cell mean different
 * things, how many weeks are on screen out of how many exist, and that
 * "available" is only true at the moment you looked.
 */
function renderNote(weeks) {
  const parts = [];

  if (state.isDemo) {
    parts.push(
      'These are invented players with invented projections — not ESPN’s, and not your ' +
      'league’s. Connect a league in the bar above, or use the toggle, to read the real ' +
      'waiver wire.'
    );
  } else {
    parts.push(
      'Every number here is ESPN’s own projection for that player in that week, scored under ' +
      'this league’s rules — the same figure the ESPN site shows against a player when you ' +
      'page it forward to that week. Nothing on this page is our forecast except the average.'
    );
  }

  const season = state.seasonWeeks.length;
  parts.push(
    `Showing ${weekRange(weeks)} — ${plural(weeks.length, 'week')} of the ${season} this season ` +
    `runs to` +
    (state.isDemo ? '.' : `, for the ${POOL_LIMIT} most-owned unrostered players.`)
  );

  parts.push(
    'A cell reading Bye is the 0.00 ESPN returns for a player whose NFL team is off that week; ' +
    'a blank cell means that week’s list carried no number for him at all. Those are not the ' +
    'same thing, so they are not drawn the same way.'
  );

  parts.push(
    'Avg is the mean of the weeks shown and is ours, not ESPN’s: byes are counted as the zero ' +
    'ESPN returns, and weeks with no number at all are left out.'
  );

  // The green has to say what it means, or it is just decoration.
  parts.push(
    'A week in <span class="hot-key">green</span> is one worth starting the player for: ' +
    Object.entries(STARTABLE)
      .map(([pos, bar]) => `${esc(pos)} over ${bar}`)
      .join(', ') +
    '. Those are set bars, not a ranking against the rest of the wire, so a quiet week for ' +
    'everyone stays uncoloured rather than promoting the best of a bad set.'
  );

  if (comparing()) {
    parts.push(
      'A week on a <span class="beats-key">green background</span> is a different claim: that ' +
      'player out-projects your own worst man at his position — the ' +
      '<span class="mine-key">Your …</span> row further down — in that week specifically. It ' +
      'does not say he is any good, only that he is better than the man the claim would drop, ' +
      'so a shaded run against an unshaded one is the argument for making the move. Strictly ' +
      'ahead: level does not count, and a bye is never shaded because 0.00 cannot beat anybody. ' +
      'The two greens are independent — a cell can be worth starting, worth claiming, both or ' +
      'neither.'
    );
  }

  parts.push(...comparisonNote(weeks));

  parts.push(
    state.isDemo
      ? 'On a real league, availability is a snapshot of the moment the page loaded — anyone here ' +
        'can be claimed by another team before you get to him.'
      : 'Availability is a snapshot of the moment each week was read. Anyone here can be claimed ' +
        'by another team before you get to him, and this page never refreshes itself.'
  );

  if (state.failedWeeks.size) {
    const failed = [...state.failedWeeks].sort((a, b) => a - b).filter((w) => weeks.includes(w));
    if (failed.length) {
      parts.push(
        `<span class="neg">ESPN did not return ${failed.length === 1 ? 'week' : 'weeks'} ` +
        `${andList(failed.map(String))}, so ${failed.length === 1 ? 'that column is' : 'those columns are'} ` +
        `blank and the average is taken from the weeks that did load. Reload the page to try again.</span>`
      );
    }
  }

  const progress = progressText();
  if (progress) parts.push(`<span class="muted">${esc(progress)}</span>`);

  $('waiverNote').innerHTML = parts.join(' ');
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn || btn.dataset.src === state.source) return;
  state.source = btn.dataset.src;
  prefs.set('source', state.source);   // so the page comes back the way you left it
  syncSource();
  state.source === 'demo' ? loadDemo() : loadLive();
});

// Filtering by position is a repaint and nothing more: every week already
// fetched stays fetched, so flicking through the positions costs no requests.
$('posFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-pos]');
  if (!btn || btn.dataset.pos === state.position) return;
  state.position = btn.dataset.pos;
  prefs.set('position', state.position);
  render();
});

// Widening the span DOES cost requests — but only for the weeks not already in
// the cache and not already in the air, so narrowing and widening again is
// free, and widening mid-load never pays for the same week twice.
$('spanFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-span]');
  if (!btn || btn.dataset.span === state.span) return;
  state.span = SPAN_CHOICE(btn.dataset.span);
  prefs.set('span', state.span);
  render();
  refreshWeeks(state.token);
});

// The average is the only column that orders the whole table into an answer, so
// that is where it opens: best first.
enableSort($('waiverTable'), { defaultIndex: 3 });

/**
 * Go live on our own when the connection bar finds a league, so the page shows
 * the real waiver wire without a second click — unless the user has parked it
 * on demo.
 *
 * Something on this page IS per-team now, so an already-live page also has to
 * listen for who you are changing. Answering that costs no requests when the
 * roster weeks are already held — every one of them carries every team — so
 * this is a repaint, and refreshWeeks only spends anything when the rosters
 * were never asked for because nobody was set as you.
 */
let knownTeamId = (savedConfig() || {}).teamId ?? null;

onConnection((conn) => {
  if (!conn) return;

  if (state.source === 'live') {
    const teamId = conn.teamId ?? null;
    if (teamId === knownTeamId) return;
    knownTeamId = teamId;
    if (state.isDemo) return;
    render();
    refreshWeeks(state.token);
    return;
  }

  knownTeamId = conn.teamId ?? null;
  if (prefs.get('source') === 'demo') return;
  state.source = 'live';
  syncSource();
  loadLive();
});

if (state.source === 'live' && savedConfig()) loadLive();
else { state.source = 'demo'; loadDemo(); }
