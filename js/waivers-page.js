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
//
// THE TAKEN TABLE is the other half of the league, in a second panel below:
// everyone who IS on a roster, priced over the same weeks, with the manager who
// holds him and where he ranks on that manager's squad. It answers a different
// question from the wire — not "who can I add" but "who has what" — so it is a
// separate table rather than more rows in the first one, and it carries NO
// colour at all: both greens above argue for a claim, and nobody here can be
// claimed.
//
// That table needs the weekly rosters whether or not a team is set as you, so
// the roster read is now unconditional and every week costs TWO requests. The
// cost line says so; understating it by half would be the one kind of dishonesty
// this page exists to avoid.

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

/**
 * FLEX IS A FILTER, NOT A POSITION.
 *
 * It is a button on the position controls that matches every running back,
 * receiver and tight end at once — the men who could fill a flex spot — because
 * "who can I put in the flex" is a question you ask of the wire constantly and
 * answering it otherwise meant pressing RB, then WR, then TE and holding three
 * lists in your head.
 *
 * It is deliberately NOT in POSITIONS and never in POS_ORDER, and no player's
 * own position changes when it is pressed. A tight end under a FLEX filter is
 * still a TE: still measured against the TE bar in STARTABLE, still his
 * manager's TE2 in the taken table, still "Your TE3" on a comparison row. The
 * alternative — rewriting the Pos column to read FLEX while the button is
 * pressed — would turn a filter into a claim about the player, and the ranks and
 * the greens would both become lies. So this constant is consulted in exactly
 * two places: whether a row survives the filter, and what the button's count is.
 */
const FLEX = 'FLEX';
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

/**
 * Everything a position button can be, in the order the buttons are drawn.
 *
 * FLEX sits after TE and before K because that is where a flex sits in a lineup:
 * the three positions it spans are the three immediately before it, so the
 * button reads as a summary of the run it follows rather than as a seventh
 * position dropped into the middle of the six.
 *
 * The list is also what a remembered filter is checked against. Both filters are
 * persisted, so a value from an older build of this page — or a hand-edited one
 * — can arrive from localStorage; anything not on this list falls back to ALL
 * rather than filtering the table down to nothing with no button lit to press
 * your way out of.
 */
const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', FLEX, 'K', 'DST'];
const FILTER_CHOICE = (v) => (FILTERS.includes(String(v)) ? String(v) : 'ALL');

/**
 * The selected filter as a headline label — "WR", "RB/WR/TE".
 *
 * The stat strips read "Available WR" and "Taken QB", which works because every
 * other button IS a position. FLEX is not, and "Available FLEX" would be the
 * button's own token quoted back rather than a count of anything nameable, so it
 * is spelled out as the three positions it stands for. That is both shorter than
 * a sentence and more precise than the token.
 */
const filterLabel = (position) => (position === FLEX ? FLEX_POSITIONS.join('/') : position);

/**
 * The selected filter as a noun phrase that reads inside a sentence.
 *
 * The empty states interpolate this into prose — "No … is available in this
 * league right now" — and prose written for one position does not survive a
 * token that means three. DST has needed this treatment since the beginning ("No
 * DST is available" is not a sentence anybody says); FLEX needs more of it,
 * because a reader who has not pressed the button cannot be assumed to know what
 * it spans, and the empty state is the one moment the page has nothing else to
 * show him. Singular on purpose, so the sentences around it are unchanged.
 */
const filterNoun = (position) => {
  if (position === FLEX) return 'flex-eligible player (running back, receiver or tight end)';
  return position === 'DST' ? 'defense' : position;
};

const state = {
  source: prefs.get('source', 'demo'),
  isDemo: true,
  leagueName: '',
  seasonWeeks: [],          // every week the league plays
  currentWeek: null,        // the week a claim made now would be for
  span: SPAN_CHOICE(prefs.get('span', '3')),

  // A position filter PER TABLE. They were one filter driving both, which meant
  // narrowing the taken table to running backs was a scroll back up past a
  // hundred free agents to a control sitting in the other panel — and it
  // dragged the wire along with it, which is rarely what you wanted. They are
  // free (a repaint, never a request), so there is no reason to share one.
  //
  // The SPAN is deliberately still one setting for both: it is the request
  // budget, and both tables are priced over the same weeks. The taken panel
  // shows the same control rather than a second one, so the choice is reachable
  // from either end of the page without becoming two choices to spend.
  //
  // Both are read back through FILTER_CHOICE, so a saved FLEX comes back as
  // FLEX and a saved anything-else comes back as ALL rather than wedging the
  // page on a filter no button can turn off.
  position: FILTER_CHOICE(prefs.get('position', 'ALL')),
  takenPosition: FILTER_CHOICE(prefs.get('takenPosition', 'ALL')),

  // The man a `?player=` link landed on. `settled` records that we have found
  // him once and already pointed the page at him, so a later repaint does not
  // keep yanking the filters back or re-scrolling under the reader.
  spotlight: null,
  settled: false,
  scrolled: false,

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

/**
 * The same test for that week's rosters.
 *
 * Unconditional now. It used to be gated on `comparing()`, because the only
 * thing rosters were for was your own "Your QB3" rows and there is no point
 * buying them when nobody is set as you. The Taken players table needs every
 * squad in the league whether or not one of them is yours, so the gate is gone
 * and the week's cost is two requests for everybody. The caching is untouched:
 * keyed on the week and nothing else.
 */
const wantsRoster = (w) =>
  !state.rosterWeeks.has(w) && !state.failedRosterWeeks.has(w) && !state.inFlight.has(`roster:${w}`);

/**
 * Fetch whatever the chosen span needs and does not already have, filling the
 * columns in as each week lands.
 *
 * Two weeks at a time rather than all at once: thirteen open sockets to ESPN is
 * rude and no faster, and a strict one-at-a-time makes the full season feel
 * slow. A week costs two requests — the wire and the rosters — and
 * they are tracked separately, so one failing loses only its half — a refused
 * roster week costs the Taken table that column and leaves the wire intact, and
 * the other way round. A request
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
  const rosterGot = shown.filter((w) => state.rosterWeeks.has(w)).length;
  setStatus(
    `Loaded ${plural(state.pool.size, 'available player')} from ${esc(state.leagueName)} ` +
    `across ${plural(got, 'week')}, and every squad in the league for ` +
    `${plural(rosterGot, 'week')}.`
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
  // A week is done when BOTH halves of it are — the wire and that week's
  // rosters. Both are always bought now, so both always count.
  const pending = wanted.filter(
    (w) =>
      (!state.weekData.has(w) && !state.failedWeeks.has(w)) ||
      (!state.rosterWeeks.has(w) && !state.failedRosterWeeks.has(w))
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
    rows.push({ p, values, avg: meanOf(values), counted: real.length });
  }
  return rows;
}

/**
 * Does this row survive a position filter? Each table passes its own.
 *
 * The FLEX branch is the whole of what FLEX does. It reads the player's real
 * position and answers whether a flex spot would take him; it does not write
 * anything back, which is why nothing downstream — the Pos column, the rank
 * beside it, the STARTABLE bar, the "Your QB3" label — has to know this button
 * exists.
 */
const matches = (row, position) => {
  if (position === 'ALL') return true;
  if (position === FLEX) return FLEX_POSITIONS.includes(row.p.position);
  return row.p.position === position;
};

/** The wire's filter, which the comparison rows share — they are one table. */
const matchesFilter = (row) => matches(row, state.position);

/** The taken table's own, entirely independent of the wire's. */
const matchesTaken = (row) => matches(row, state.takenPosition);

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

/**
 * A rostered player's projection for one week — the same three states as the
 * wire, read out of the roster payload rather than the free-agent list. Used by
 * the comparison rows and by the Taken players table, which is why it is no
 * longer named after "yours".
 */
function rosterValueFor(playerId, week) {
  const forWeek = state.rosterProj.get(week);
  if (!forWeek) return undefined;
  const v = forWeek.get(playerId);
  return v === undefined ? null : v;
}

/**
 * The mean of a run of week values, exactly as buildRows computes the wire's.
 *
 * Shared rather than written out three times, because it is the one thing that
 * MUST be identical everywhere: a comparison between two differently-derived
 * averages is not a comparison, and the Taken table's Avg sits in a second
 * panel where the difference would be even harder to spot. A bye counts as the
 * zero ESPN returns; a week with no number at all is left out.
 */
function meanOf(values) {
  const real = values.filter((v) => typeof v === 'number');
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
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
    const values = weeks.map((w) => rosterValueFor(p.playerId, w));
    if (!held.has(p.position)) held.set(p.position, []);
    held.get(p.position).push({ p, values, avg: meanOf(values), mine: true });
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

// ------------------------------------------------------- the taken players
//
// Everyone who is NOT on the wire, which on this page means everyone the roster
// payload knows about. The wire answers "who can I add"; this answers "who has
// what", and they are different enough questions to deserve different tables.

/**
 * Every rostered player, with his owner and his rank on that owner's squad.
 *
 * WHICH WEEK'S ROSTERS decide who owns whom: the earliest week on screen that
 * loaded, the same anchor buildMineRows uses. Ownership is a fact about now,
 * and the roster as it stands now is the earliest week we hold — a man traded
 * in week 9 should not be listed under the team that will hold him later. His
 * per-week numbers still come from each week's own payload, so a projection is
 * never borrowed across weeks.
 *
 * THE RANK is ours, over the weeks currently shown, best = 1: QB3 means the
 * third-highest Avg among that manager's quarterbacks. It is not ESPN's depth
 * chart and it is not a season figure, so widening the span can move a man from
 * QB2 to QB3 — exactly as it can change which of your men appears as "Your QB3"
 * in the table above, and for the same reason.
 *
 * A player ESPN has no number for over these weeks gets NO rank. Ranking him
 * would mean guessing where he belongs, and this page already refuses that in
 * buildMineRows, which will not call an unrated player the worst one.
 */
function buildTakenRows(weeks) {
  const loaded = weeks.filter((w) => state.rosterWeeks.has(w));
  if (!loaded.length) return [];

  // MEMBERSHIP IS THE UNION OVER EVERY WEEK ON SCREEN, not just the first one.
  //
  // It used to be the earliest week alone, on the reasoning that the squad as
  // it stands now is the one you are deciding against. That reasoning is right
  // about the OWNER and wrong about who is in the table: the columns span
  // weeks 4–6, so a man rostered in week 5 is part of what this table is
  // about, and leaving him out meant the page could not answer a question it
  // was visibly being asked.
  //
  // It also broke the click-through across pages. The analysis page can be
  // pointed at any week of the season, so a link made from week 13 arrived
  // here about a man the table had never heard of, and the page told Tim he
  // "may have been dropped" — a confident, wrong answer. In the demo data 45
  // of 160 men differ between week 4 and week 13; tests/link-check.mjs is what
  // found it, and no single-page suite could have.
  //
  // The owner is still the earliest week he actually appears in: that is the
  // most recent squad this page knows him to have been on, and it is a fact
  // rather than a guess.
  const seen = new Map();   // playerId -> { p, owner }
  for (const week of loaded) {
    for (const team of state.rosterWeeks.get(week) || []) {
      const owner = (team.name || '').trim() || `Team ${team.id}`;
      for (const p of team.players || []) {
        if (p.playerId === null || p.playerId === undefined) continue;
        if (!seen.has(p.playerId)) seen.set(p.playerId, { p, owner });
      }
    }
  }

  // Grouped by owner so the ranks are per manager, as they always were.
  const squads = new Map();
  for (const { p, owner } of seen.values()) {
    if (!squads.has(owner)) squads.set(owner, []);
    squads.get(owner).push(p);
  }

  const rows = [];
  for (const [owner, players] of squads) {
    const byPosition = new Map();
    for (const p of players) {
      const values = weeks.map((w) => rosterValueFor(p.playerId, w));
      const row = { p, values, avg: meanOf(values), owner, rank: null };
      rows.push(row);
      if (!byPosition.has(p.position)) byPosition.set(p.position, []);
      byPosition.get(p.position).push(row);
    }

    // Ranked per owner per position, and only among the men who have a number.
    // Leaving the unrated out keeps the ranks 1..n contiguous, so a QB3 really
    // is the third-best of the quarterbacks this manager has numbers for rather
    // than the third name in a list with holes in it. The playerId tiebreak is
    // there so two identical averages do not swap places between repaints.
    for (const group of byPosition.values()) {
      group
        .filter((r) => r.avg !== null)
        .sort((a, b) => b.avg - a.avg || a.p.playerId - b.p.playerId)
        .forEach((r, i) => { r.rank = i + 1; });
    }
  }

  return rows;
}

/**
 * How many players sit behind each button on a position control.
 *
 * Each table counts its OWN pool, which is the whole reason the two controls
 * are worth having separately: the wire's QB button says how many quarterbacks
 * you could add, the taken one says how many the league is holding. One shared
 * count could only ever have been true of one of them.
 *
 * FLEX has to be counted EXPLICITLY. The loop below only knows how to increment
 * a key that a player's own position names, so a FLEX key seeded to zero and
 * left to that loop would sit at zero for ever and the button would report,
 * confidently, that there is nobody to flex. It is counted as its own sum of the
 * three positions instead — which is also why FLEX is tested before the position
 * key is touched rather than being folded into it: a man is counted once as a
 * running back and once as flex-eligible, and those are two different questions
 * about him, not two positions.
 */
function countsOf(players) {
  const counts = { ALL: 0, [FLEX]: 0 };
  for (const pos of POSITIONS) counts[pos] = 0;
  for (const p of players) {
    counts.ALL++;
    if (FLEX_POSITIONS.includes(p.position)) counts[FLEX]++;
    if (POS_ORDER.has(p.position)) counts[p.position]++;
  }
  return counts;
}

// --------------------------------------------------------------------- render

// ------------------------------------------------------- the player deep link
//
// `waivers.html?player=<espnPlayerId>` lands on one man. Every page on the site
// links here that way — a name, or a number standing for a player — and the
// contract is deliberately a plain `href` rather than a click handler, so
// middle-click and open-in-a-new-tab behave and the same markup works whether
// you arrive from another page or click it on this one.
//
// Landing does three things, and each is answering a different half of what Tim
// asked for ("bring you directly to their position … and show you their next 13
// weeks proj"):
//
//   - widens the span to the whole rest of the season, because the span is what
//     decides how many week columns exist. NOT persisted: it is this visit's
//     answer to a link, not a change of mind, and a reload gives back the span
//     actually chosen.
//   - points the table he is in at HIS position, so he lands among the men he
//     is measured against rather than alone in a list of everybody.
//   - marks his row and scrolls to it, once.
//
// Nothing here fetches on its own. Widening the span costs whatever weeks are
// not already held, exactly as pressing the control by hand would.

/** `?player=` from the URL. Defensive: a harness may provide no location. */
function requestedPlayer() {
  try {
    const m = /[?&]player=(\d+)/.exec((window.location && window.location.search) || '');
    return m ? Number(m[1]) : null;
  } catch {
    return null;   // no location at all is simply "no player asked for"
  }
}

/** Which table holds him, and what position he is, or null if not found yet. */
function findSpotlight(weeks) {
  const id = state.spotlight;
  if (id === null) return null;

  const wire = state.pool.get(id);
  if (wire) return { where: 'wire', position: wire.position, name: wire.name };

  const taken = buildTakenRows(weeks).find((r) => r.p.playerId === id);
  if (taken) {
    return { where: 'taken', position: taken.p.position, name: taken.p.name, owner: taken.owner };
  }
  return null;
}

/**
 * Point the page at him, once.
 *
 * Runs before the tables are drawn, and only until it succeeds: the weeks
 * arrive one request at a time, so the man being asked for may simply not be
 * loaded yet on the first paint. Until he is, this is a no-op and the next
 * repaint tries again.
 */
function settleSpotlight(weeks) {
  if (state.spotlight === null || state.settled) return;

  const found = findSpotlight(weeks);
  if (!found) {
    // Not found is not the same as not looked yet, and the difference matters:
    // the rosters arrive after the first paint in BOTH modes — live fetches them
    // a week at a time, and demo imports demo-rosters.js asynchronously — so
    // giving up on the first pass would declare every rostered man missing.
    //
    // Give up only once there is somewhere to have looked: something in the
    // roster cache, or every week we asked for refused outright. Anything still
    // in flight is a reason to wait rather than to answer.
    const looked = state.rosterWeeks.size > 0;
    const hopeless = weeks.length > 0 && weeks.every((w) => state.failedRosterWeeks.has(w));
    if (state.inFlight.size || !(looked || hopeless)) return;
    state.settled = true;
    return;
  }

  if (found.where === 'wire') state.position = found.position;
  else state.takenPosition = found.position;
  state.settled = true;
}

/** Scroll to the marked row after the tables exist. Once, never again. */
function scrollToSpotlight() {
  if (state.spotlight === null || state.scrolled) return;
  const row = document.getElementById(`p${state.spotlight}`);
  if (!row) return;
  state.scrolled = true;
  // Guarded: jsdom/linkedom have no scrollIntoView, and a harness must not die
  // of a missing browser API.
  try {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch { /* the row is marked either way, which is the part that matters */ }
}

/** The strip that says who we jumped to, and how to stop. */
function renderJump(weeks) {
  const el = $('jumpNote');
  if (state.spotlight === null) {
    el.className = 'jump hidden';
    el.innerHTML = '';
    return;
  }

  const found = findSpotlight(weeks);
  el.className = 'jump';

  if (!found) {
    el.innerHTML = state.settled
      ? `<span>No player with id ${esc(state.spotlight)} is on the wire or on a roster in ` +
        `this league. He may have been dropped, or the link may be from another league.</span>` +
        `<button type="button" data-clear>Clear</button>`
      : `<span class="muted">Looking for the player this link points at…</span>`;
    return;
  }

  el.innerHTML =
    `<span>Jumped to <strong>${esc(found.name)}</strong>${
      found.where === 'taken' ? ` — on ${esc(found.owner)}’s roster` : ' — on the wire'
    }. Showing every remaining week, and the ${esc(found.position)} filter on the ` +
    `${found.where === 'taken' ? 'Taken' : 'Available'} table.</span>` +
    `<button type="button" data-clear>Clear</button>`;
}

// --------------------------------------------------------------------- render

function render() {
  // Before anything is painted: a `?player=` link may need to move the filters
  // it is about to be drawn under. Idempotent once it has found its man.
  settleSpotlight(shownWeeks());

  syncSource();
  syncSegmented('posFilter', 'pos', state.position);
  syncSegmented('takenPosFilter', 'pos', state.takenPosition);
  // One span, two controls showing it. Both are painted from the same state, so
  // they can never drift apart and disagree about which weeks are on screen.
  syncSegmented('spanFilter', 'span', state.span);
  syncSegmented('takenSpanFilter', 'span', state.span);

  $('modeBadge').className = 'badge ' + (state.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = state.isDemo ? 'Demo' : 'Live';

  const weeks = shownWeeks();
  $('pageSub').textContent = state.isDemo
    ? 'Showing a generated sample waiver wire so you can see the layout with real-looking projections in it.'
    : `${state.leagueName} · ${state.pool.size || 'no'} available players · ${weekRange(weeks)}`;

  renderCost(weeks);
  renderCounts(weeks);
  renderTable(weeks);
  renderStats(weeks);
  renderNote(weeks);
  // The second panel is drawn from the same cache in the same pass, so neither
  // its own position filter nor the shared span costs a request to answer.
  renderTaken(weeks);
  renderTakenStats(weeks);
  renderTakenNote(weeks);

  // Last, because both are about rows that have to exist first.
  renderJump(weeks);
  scrollToSpotlight();
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

/**
 * What the chosen span costs, said next to the control that spends it — and
 * now next to BOTH copies of that control, because either one spends it.
 */
function setCost(text) {
  $('spanCost').textContent = text;
  $('takenSpanCost').textContent = text;
}

function renderCost(weeks) {
  if (state.isDemo) {
    setCost(`${plural(weeks.length, 'week')} shown. Demo data costs nothing to widen.`);
    return;
  }
  // A week costs the wire AND that week's rosters, always — the Taken players
  // table needs every squad in the league whether or not one of them is yours,
  // so the roster read is no longer conditional on a team being set as you.
  // Two requests a week for everybody, and the line has to say two: it used to
  // read "one per week" when nobody was set as you, and leaving it that way now
  // would understate the choice by exactly half.
  const per = 2;

  const have = weeks.filter((w) => state.weekData.has(w)).length +
    weeks.filter((w) => state.rosterWeeks.has(w)).length;
  const gone = weeks.filter((w) => state.failedWeeks.has(w)).length +
    weeks.filter((w) => state.failedRosterWeeks.has(w)).length;
  const todo = weeks.length * per - have - gone;

  const bits = [];
  if (have) bits.push(`${have} already loaded`);
  if (todo) bits.push(`${todo} still to fetch`);
  if (gone) bits.push(`${gone} refused by ESPN`);

  setCost(
    `${plural(weeks.length, 'week')} = ${plural(weeks.length * per, 'request')} to ESPN, ` +
    `the wire and every squad in the league for each one` +
    ` — there is no bulk form.` + (bits.length ? ` ${bits.join(', ')}.` : '')
  );
}

function paintCounts(id, counts) {
  $(id).querySelectorAll('button[data-pos]').forEach((b) => {
    const n = counts[b.dataset.pos] ?? 0;
    const slot = b.querySelector('.seg-count');
    // Blank rather than a row of zeroes before anything has loaded: a zero is a
    // claim that there are none, which is not what "we have not read it yet"
    // means anywhere else on this page.
    if (slot) slot.textContent = counts.ALL ? String(n) : '';
  });
}

function renderCounts(weeks) {
  paintCounts('posFilter', countsOf(state.pool.values()));
  paintCounts('takenPosFilter', countsOf(buildTakenRows(weeks).map((r) => r.p)));
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
 * `roster` marks a cell whose number came from the roster payload rather than
 * the wire — a comparison row, or any row in the Taken players table. It
 * changes two things: the week it is waiting on is the ROSTER read rather than
 * the wire read, and it is never coloured green. Both greens are arguments for
 * a claim, and a man already on a roster cannot be claimed, so on those rows
 * they would be answering a question that does not arise.
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
function cell(v, week, name, position, roster = false, yours = null) {
  if (v === undefined) {
    // Three ways to have no number, and a reader has to be able to tell them
    // apart: still coming, refused outright, or ESPN simply had nothing.
    if (roster ? state.failedRosterWeeks.has(week) : state.failedWeeks.has(week)) {
      return `<td class="muted" title="${
        roster
          ? `ESPN refused week ${week}’s rosters, so there is no projection for anyone ` +
            `on a roster that week. Reload the page to try again.`
          : `Week ${week} did not load — ESPN refused it, so this column is empty for ` +
            `everyone. Reload the page to try again.`
      }">${dash}</td>`;
    }
    return `<td class="wait" title="${
      roster
        ? `Week ${week}’s rosters have not been read from ESPN yet.`
        : `Week ${week} has not been read from ESPN yet.`
    }">·</td>`;
  }
  if (v === null) {
    // No data-v at all — never data-v="" — so an unknown sinks to the bottom
    // whichever way the column is sorted.
    return `<td title="ESPN’s week ${week} ${roster ? 'rosters carried' : 'list carried'} ` +
      `no projection for ${esc(name)}.">${dash}</td>`;
  }
  if (v === 0) {
    return `<td class="bye" data-v="0" ` +
      `title="${esc(name)} is on bye in week ${week}. ESPN returns 0.00 for a bye, ` +
      `which is not the same as a projection of nothing.">Bye</td>`;
  }
  // A bye has already returned above, so neither cue can fire on one — which is
  // right for both: 0.00 is never startable, and it cannot beat anybody.
  const hot = !roster && isStartable(v, position);
  const beats = !roster && yours !== null && typeof yours.value === 'number' && v > yours.value;
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

/**
 * A row's addressable identity, so a later change can find one man's row.
 *
 * This is what `waivers.html?player=<id>` lands on, from anywhere on the site.
 *
 * `data-player` goes on every row; the `id` does not. A player appears at most
 * once on the wire and once in the Taken table — those sets are disjoint, since
 * a man cannot be both rostered and free — but a "Your QB3" comparison row is a
 * SECOND appearance of somebody who already has a row in the Taken table, and
 * two elements with the same id is not a document. So the comparison rows carry
 * the data attribute and let the Taken table own the id.
 */
function rowIdentity(playerId, { addressable = true, cls = '' } = {}) {
  // The classes are built here rather than by each caller because the spotlight
  // has to merge with whatever else the row is wearing — two class attributes on
  // one element is not a document, and the second one silently loses.
  const classes = [cls, playerId === state.spotlight ? 'spotlight' : '']
    .filter(Boolean).join(' ');
  return `${addressable ? ` id="p${esc(playerId)}"` : ''} data-player="${esc(playerId)}"` +
    (classes ? ` class="${classes}"` : '');
}

/**
 * A player's name, as the link every page on the site points at him with.
 *
 * A real href rather than a click handler, so middle-click and open-in-a-new-tab
 * behave — and so the same markup works whether you arrive from another page or
 * click it here. On this page the click is intercepted and answered without a
 * reload, because everything needed to answer it is already in the cache.
 */
function playerLink(p, inner, why) {
  if (p.playerId === null || p.playerId === undefined) return inner;
  return `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ` +
    `title="${why}">${inner}</a>`;
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

  const owned = p.percentOwned === null || p.percentOwned === undefined
    ? ''
    : ` — owned in ${fmt(p.percentOwned)}% of ESPN leagues`;

  return `<tr${rowIdentity(p.playerId, { cls: status && status.dim ? 'unavailable' : '' })}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}">${
        playerLink(p, esc(p.name), `${esc(p.name)}${owned} — jump to his row and show every ` +
          `remaining week`)}${injuryTag(status)}</td>
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

  return `<tr${rowIdentity(p.playerId, { addressable: false, cls: 'mine' })}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}">` +
        `<span class="mine-tag">${esc(label)}</span> ` +
        `${playerLink(p, esc(p.name), why)}` +
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
    return `No ${filterNoun(state.position)} is available in this league right now. ` +
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

// --------------------------------------------------- the taken players table
//
// The same table shape as the wire, one column wider and with every cue taken
// out of it. Its own <thead>, because the Owner column is real: bolting it on
// as a variant of renderHead would mean a conditional in every cell.

function renderTakenHead(weeks) {
  const cols = weeks
    .map((w, i) => {
      const failed = state.failedRosterWeeks.has(w);
      const cls = [i === 0 ? 'grouped' : '', failed ? 'muted' : ''].filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w}’s rosters did not load — ESPN refused them. Reload the page to try again.`
        : `ESPN’s projected points for week ${w}.`;
      return `<th data-sort${cls ? ` class="${cls}"` : ''} title="${title}">${w}</th>`;
    })
    .join('');

  $('takenTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort>Player</th>
       <th class="left" data-sort title="The position, and where he ranks on his own manager’s roster by the Avg below — best is 1. Ours, over the weeks shown, so widening the span can move him.">Pos</th>
       <th class="left" data-sort>Tm</th>
       <th class="left" data-sort title="The manager whose roster he is on, as of the earliest week shown.">Owner</th>
       <th data-sort title="The mean of the week columns shown. Ours, not ESPN's: a bye counts as the zero ESPN returns, a week with no number at all is left out. Worked out exactly the way the Avg above it is.">Avg</th>
       ${cols}
     </tr>`;
}

/**
 * One rostered player.
 *
 * The Pos cell carries BOTH sort keys in one number: `POS_ORDER * 100 + rank`,
 * so the column reads QB→RB→WR→TE→K→DST and, inside each position, 1 before 2.
 *
 * An unranked man keys as `POS_ORDER * 100 + 99` — his position, then after
 * every real rank in it. That 99 is never shown and is not a rank: it is the
 * page's nulls-last convention applied INSIDE the position group, which is the
 * only place it can go, because his position is known and only his rank is not.
 * Leaving the key off entirely was tried first and is wrong here: sortable.js
 * falls back to the cell's text when there is no `data-v`, so a bare "TE" would
 * be compared as the string "te" against numbers and lead the column descending
 * — the opposite of sinking. The cells whose value really is absent — his Avg,
 * and any week ESPN had no number for — still carry no `data-v` at all.
 */
function takenRow(row, weeks) {
  const { p, values, owner, rank } = row;
  const status = availability(p.injuryStatus);
  const posOrder = POS_ORDER.get(p.position) ?? 9;

  const posTitle = rank === null
    ? `ESPN carried no projection for ${esc(p.name)} over ${weekRange(weeks)}, so there is ` +
      `no Avg to rank him by. The position is shown on its own rather than with a made-up number.`
    : `${esc(p.name)} is ${esc(owner)}’s ${esc(p.position)}${rank} by Avg over ` +
      `${weekRange(weeks)}. That is our ordering, not ESPN’s depth chart, and widening ` +
      `the span can change it.`;

  return `<tr${rowIdentity(p.playerId, { cls: status && status.dim ? 'unavailable' : '' })}>
      <td class="name" data-v="${esc(p.name.toLowerCase())}">${
        playerLink(p, esc(p.name), `${esc(p.name)} — on ${esc(owner)}’s roster. Jump to ` +
          `his row and show every remaining week`)}${injuryTag(status)}</td>
      <td class="left pos" data-v="${posOrder * 100 + (rank ?? 99)}" title="${posTitle}">${
        esc(p.position)}${rank === null ? '' : `<span class="rank">${rank}</span>`}</td>
      <td class="left">${esc(p.proTeam)}</td>
      <td class="left owner" data-v="${esc(owner.toLowerCase())}" title="${esc(owner)}">${esc(owner)}</td>
      <td class="avg grouped"${row.avg === null ? '' : ` data-v="${row.avg}"`}>${
        row.avg === null ? dash : fmt(row.avg)
      }</td>
      ${values.map((v, i) => cell(v, weeks[i], p.name, p.position, true)).join('')}
    </tr>`;
}

function renderTaken(weeks) {
  const table = $('takenTable');
  const tbody = table.querySelector('tbody');
  renderTakenHead(weeks);

  const all = buildTakenRows(weeks);
  const shown = all.filter(matchesTaken);
  const cols = weeks.length + 5;

  if (!shown.length) {
    tbody.innerHTML =
      `<tr class="empty-row"><td colspan="${cols}">${esc(takenEmptyReason(all.length))}</td></tr>`;
    resort(table);
    return;
  }

  tbody.innerHTML = shown.map((r) => takenRow(r, weeks)).join('');
  resort(table);
}

/** An empty taken table says why it is empty and what to do about it. */
function takenEmptyReason(totalPlayers) {
  if (progressText()) return 'Reading the league’s rosters from ESPN…';

  if (totalPlayers > 0) {
    return `Nobody in this league is holding a ${filterNoun(state.takenPosition)} right now. ` +
      `Switch the filter back to All to see the other ${plural(totalPlayers, 'player')}.`;
  }

  if (state.isDemo) {
    return 'The demo squads could not be generated this time, so there is nobody to list. ' +
      'Reload the page, or switch to your ESPN league.';
  }
  if (!savedConfig()) {
    return 'No league is connected, so there are no rosters to read. ' +
      'Connect one in the bar above, or switch back to Demo data.';
  }
  if (state.failedRosterWeeks.size) {
    return `ESPN refused the rosters for every week we asked for ` +
      `(${andList([...state.failedRosterWeeks].sort((a, b) => a - b).map(String))}). ` +
      'Reload the page to try again, or check the league is still readable on the Connection page.';
  }
  return 'ESPN returned no rosters for this league, so there is nobody to list here.';
}

function renderTakenStats(weeks) {
  const el = $('takenStats');
  const rows = buildTakenRows(weeks).filter(matchesTaken);

  if (!rows.length) {
    el.innerHTML = '';
    return;
  }

  const rated = rows.filter((r) => r.avg !== null);
  const best = rated.length ? rated.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const label = state.takenPosition === 'ALL'
    ? 'Taken'
    : `Taken ${filterLabel(state.takenPosition)}`;

  const items = [
    [label, String(rows.length), `across ${plural(new Set(rows.map((r) => r.owner)).size, 'squad')}`],
    ['Weeks shown', String(weeks.length), weekRange(weeks)],
  ];
  if (best) items.push(['Best average', fmt(best.avg), `${best.p.name} · ${best.owner}`]);

  el.innerHTML = items
    .map(([k, v, who]) =>
      `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>` +
      `${who ? `<div class="who" title="${esc(who)}">${esc(who)}</div>` : ''}</div>`)
    .join('');
}

/**
 * What the taken table's numbers are, said every time they are shown.
 *
 * Six things have to be in here or the table is quietly misleading: whose
 * projections these are, what Avg is and that it is ours, what the number after
 * the position means and that the span moves it, which week decides who owns
 * whom, that a Bye cell and a blank cell are different facts, and why nothing
 * is coloured.
 */
function renderTakenNote(weeks) {
  const parts = [];

  parts.push(
    state.isDemo
      ? 'These are the demo league’s invented squads with invented projections — not ESPN’s, ' +
        'and not your league’s. Connect a league in the bar above, or use the toggle, to read ' +
        'the real rosters.'
      : 'Every number here is ESPN’s own projection for that player in that week, scored under ' +
        'this league’s rules — the same figures as the table above, read off each week’s rosters ' +
        'instead of the wire. Nothing on this table is our forecast except the average and the ' +
        'rank beside the position.'
  );

  parts.push(
    `Everyone on a roster in <strong>any</strong> of ${weekRange(weeks)} — a man picked up in ` +
    `${weeks.length > 1 ? `week ${weeks[1]}` : 'a later week'} belongs in a table whose columns ` +
    `include that week. Owner is the manager holding him in the earliest of those weeks he ` +
    `actually appears in, which is the most recent squad this page knows him to have been on. ` +
    `His week numbers still come from each week’s own payload, so no projection is borrowed ` +
    `across weeks, and a week he was not rostered for is blank rather than guessed at.`
  );

  parts.push(
    'Avg is the mean of the weeks shown and is ours, not ESPN’s: byes are counted as the zero ' +
    'ESPN returns, and weeks with no number at all are left out. It is worked out exactly the ' +
    'way the Avg in the table above is, so the two can be read against each other.'
  );

  parts.push(
    'The number after the position is where he ranks on his own manager’s roster by that Avg — ' +
    'QB3 is that manager’s third-best quarterback over the weeks currently shown, and 1 is the ' +
    'best. It is our ordering rather than ESPN’s depth chart, and it moves with the span: widen ' +
    'the weeks and a QB2 can become a QB3, exactly as widening it can change which of your men ' +
    'appears as Your QB3 above. A player ESPN carried no number for over these weeks cannot be ' +
    'ranked at all, so he shows the bare position with no number against it, and sorts to the ' +
    'end of his own position rather than to a rank we made up. His Avg is blank for the same ' +
    'reason, and a blank Avg carries no sort key at all.'
  );

  parts.push(
    'Nothing here is highlighted, on purpose: both greens in the table above argue for a waiver ' +
    'claim — worth starting at all, and better than the man the claim would drop — and nobody on ' +
    'this list can be claimed. Colouring them would be answering a question that does not arise.'
  );

  parts.push(
    'A cell reading Bye is the 0.00 ESPN returns for a player whose NFL team is off that week; ' +
    'a blank cell means that week’s rosters carried no number for him at all. Those are not the ' +
    'same thing, so they are not drawn the same way.'
  );

  parts.push(
    'This table has <strong>its own position buttons</strong>, and the counts on them are this ' +
    'table’s — how many of each position the league is holding, not how many you could add. ' +
    'They move nothing but this table, so you can read every taken running back while the wire ' +
    'above stays on whatever you left it. The <strong>weeks to price</strong> control beside them ' +
    'is the same one as at the top of the page rather than a second one: both tables are priced ' +
    'over the same weeks, and widening costs requests, so that is one choice shown at both ends ' +
    'of a long page instead of two choices that could disagree.'
  );

  parts.push(
    '<strong>FLEX</strong> here is the same filter as on the wire above — every running back, ' +
    'receiver and tight end the league is holding, counted as those three added together — and ' +
    'it leaves the rank beside a name completely alone. A man is his manager’s RB2 or WR1 at his ' +
    'own position whichever button is pressed; there is no such thing as a FLEX2, because the ' +
    'rank answers how deep a manager is at a position and the button only decides which rows you ' +
    'are looking at.'
  );

  parts.push(
    'Every name here is a link. Clicking one puts the table on his position, widens the weeks to ' +
    'the rest of the season and marks his row — the same thing that happens when you click a ' +
    'player anywhere else on the site, which is what brings you here.'
  );

  const missing = weeks.filter((w) => state.failedRosterWeeks.has(w));
  if (missing.length) {
    const named = andList(missing.map(String));
    parts.push(
      missing.length === weeks.length
        ? `<span class="neg">ESPN refused the rosters for every week shown (${named}), so ` +
          `there is nothing to list here. Reload the page to try again.</span>`
        : `<span class="neg">ESPN refused the rosters for ` +
          `${missing.length === 1 ? 'week' : 'weeks'} ${named}, so ` +
          `${missing.length === 1 ? 'that column is' : 'those columns are'} blank, and both the ` +
          `average and the rank are taken from the weeks that did load. Reload the page to try ` +
          `again.</span>`
    );
  }

  const progress = progressText();
  if (progress) parts.push(`<span class="muted">${esc(progress)}</span>`);

  $('takenNote').innerHTML = parts.join(' ');
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
  const label = state.position === 'ALL'
    ? 'Available'
    : `Available ${filterLabel(state.position)}`;

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
      'page it forward to that week. Nothing in this table is our forecast except the average.'
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

  parts.push(
    'The position buttons above drive <em>this</em> table only — the Taken players panel has its ' +
    'own set — and filtering costs nothing: every week already fetched stays fetched. The weeks ' +
    'to price control is shared with that panel, because both tables are priced over the same ' +
    'weeks and widening is what actually spends requests. Every name is a link that jumps to that ' +
    'player and shows the rest of his season.'
  );

  // FLEX is the one button whose label is not self-explanatory, and it is a
  // filter rather than a fact about anybody, so the note has to say both halves.
  parts.push(
    '<strong>FLEX</strong> is not a position but a filter across three: press it and the table ' +
    'shows every running back, receiver and tight end at once — the men who could fill a flex ' +
    'spot — with the count on the button being those three added together. It changes nothing ' +
    'about the players themselves. Each one keeps his own position in the Pos column and is still ' +
    'measured against his own position’s bar for the green above, so a receiver over 12 is green ' +
    'under FLEX exactly as he is under WR; there is no separate flex bar, because what makes a ' +
    'week worth starting does not depend on which button you pressed to find it.'
  );

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
// One handler per table, because the two filters are genuinely separate — a
// shared one meant narrowing the taken table dragged the wire along with it.
function onPositionClick(id, key) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pos]');
    if (!btn || btn.dataset.pos === state[key]) return;
    state[key] = btn.dataset.pos;
    prefs.set(key, state[key]);   // each table comes back the way you left it
    render();
  });
}
onPositionClick('posFilter', 'position');
onPositionClick('takenPosFilter', 'takenPosition');

// Widening the span DOES cost requests — but only for the weeks not already in
// the cache and not already in the air, so narrowing and widening again is
// free, and widening mid-load never pays for the same week twice.
//
// Both copies of the control drive the SAME setting. That is the point: the
// weeks are shared, so this is one choice reachable from either end of a long
// page rather than two choices that could disagree and two costs to spend.
function onSpanClick(id) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-span]');
    if (!btn || btn.dataset.span === state.span) return;
    state.span = SPAN_CHOICE(btn.dataset.span);
    prefs.set('span', state.span);
    render();
    refreshWeeks(state.token);
  });
}
onSpanClick('spanFilter');
onSpanClick('takenSpanFilter');

/**
 * Jump to a player without leaving the page.
 *
 * Everything a `?player=` link asks for is already in this module's cache, so
 * following one from THIS page would be a reload that fetched nothing new and
 * lost the weeks already paid for. So the click is answered here instead —
 * `preventDefault` only for a plain left click, leaving middle-click,
 * ctrl/cmd-click and "open in new tab" to the browser, which is the whole
 * reason the contract is an `<a href>` and not a handler.
 */
function jumpTo(playerId) {
  state.spotlight = playerId;
  state.settled = false;
  state.scrolled = false;
  // The span is what decides how many week columns exist, so "show me his next
  // 13 weeks" IS this. Not persisted: answering a link is not a change of mind
  // about the setting, and a reload should give back the span actually chosen.
  state.span = 'all';
  render();
  refreshWeeks(state.token);
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest && e.target.closest('a.pref[href*="player="]');
  if (!link) return;
  const m = /[?&]player=(\d+)/.exec(link.getAttribute('href') || '');
  if (!m) return;
  e.preventDefault();
  jumpTo(Number(m[1]));
});

$('jumpNote').addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('button[data-clear]')) return;
  // Only the mark and the strip go. The span and the filter it moved are left
  // where they are: they are now what the reader is looking at, and yanking
  // them back would undo a page he did not ask to leave.
  state.spotlight = null;
  state.settled = false;
  state.scrolled = false;
  render();
});

// The average is the only column that orders the whole table into an answer, so
// that is where it opens: best first.
enableSort($('waiverTable'), { defaultIndex: 3 });
// Same reasoning one column further right, the Owner column having pushed Avg
// from index 3 to index 4.
enableSort($('takenTable'), { defaultIndex: 4 });

/**
 * Go live on our own when the connection bar finds a league, so the page shows
 * the real waiver wire without a second click — unless the user has parked it
 * on demo.
 *
 * Something on this page IS per-team, so an already-live page also has to listen
 * for who you are changing. Answering that costs nothing: every roster week
 * carries every team, and the rosters are bought unconditionally now, so
 * changing who "you" are only re-picks which squad the "Your …" rows come from.
 * refreshWeeks is still called after it, but only so a week that was refused
 * mid-load is not left hanging — it spends nothing on a week already held.
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

// A `?player=` link decides the span before the first request goes out, so the
// weeks it needs are bought in the same pass rather than fetched three-wide and
// then immediately widened. Set before the load, never after it.
const landing = requestedPlayer();
if (landing !== null) {
  state.spotlight = landing;
  state.span = 'all';
}

if (state.source === 'live' && savedConfig()) loadLive();
else { state.source = 'demo'; loadDemo(); }
