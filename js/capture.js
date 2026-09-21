// The time machine's reading, taken the same way from anywhere — and the parts
// of the season model the Schedule and Summary pages must never disagree about.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// ESPN keeps no history of its own projections, so a week whose reading is not
// taken while it is live is gone for good (HANDOFF, rule 8). Until 2026-09-16 a
// reading was taken in exactly one place: the Schedule page, when it loaded on
// live data. Tim reads the site on his phone, which can never take one, and a
// desktop visit to some OTHER page took none either. Week 1 was lost that way.
//
// So everything a reading needs was moved here, out of js/schedule-page.js, and
// the connection bar — which runs on every page — calls `captureIfDue()`. The
// Schedule page uses the very same functions, so there is ONE way of building a
// reading and the two routes cannot drift into writing different ones. The
// suite `tests/test-capture.mjs` holds them to byte-for-byte equality.
//
// ---------------------------------------------------------------------------
// WHAT ELSE LIVES HERE, AND WHY
//
// The Summary page's title % and the Schedule page's title % are the same
// question about the same league. They used to be answered from different
// inputs: the Summary page assumed a six-team bracket and calibrated the
// scoring spread from last week's lineups, while the Schedule page read the
// league's field size and had no spread to calibrate from at all. So the season
// model the simulation is fed from — what is banked, what is still to play,
// what each side is projected to score, and how wide the noise is — is built
// here, once, and both pages call it. `tests/cross-sim-check.mjs` records the
// arguments each page hands the simulation and requires them to be identical.
//
// Pure apart from `snapshots.js` storage: no DOM, no fetching of its own. The
// fetchers are passed in, which is what lets the connection bar call this
// without importing js/season.js at link time (the test stubs of that module
// do not have every export), and what lets the suites drive it directly.

import * as forecast from './forecast.js';
import * as snapshots from './snapshots.js';
import { projectionsFromWeekTeams } from './projection.js';

export const round1 = (n) => Math.round(n * 10) / 10;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------ game state

/**
 * final | live | upcoming, decided here rather than trusted from the source.
 *
 * The source marks a game played when EITHER side has points. Mid-week that is
 * wrong in the worst possible way: one team's players have finished and the
 * other's have not, so the game flips to played, with a winner and an 80-point
 * margin, and a card confidently reports a final score for a game half of
 * which has not kicked off. Exactly one side on the board means in progress.
 */
export function gameState(g) {
  const scored = (v) => typeof v === 'number' && v > 0;

  // A bye has no away side to compare against; trust the source there.
  if (g.awayId === null || g.awayId === undefined) return g.played ? 'final' : 'upcoming';

  if (scored(g.homeScore) !== scored(g.awayScore)) return 'live';
  if (!scored(g.homeScore) && !scored(g.awayScore)) return 'upcoming';
  return g.played ? 'final' : 'live';
}

/** Recomputed from the scores, so a mis-set `winner` upstream can't leak in. */
export function winnerOf(g) {
  if (gameState(g) !== 'final') return null;
  if (typeof g.homeScore === 'number' && typeof g.awayScore === 'number') {
    return g.homeScore > g.awayScore ? 'home' : g.awayScore > g.homeScore ? 'away' : 'tie';
  }
  return g.winner;
}

// ------------------------------------------------------------ the schedule

/**
 * Fill in anything a source left out and guarantee byWeek is a real Map, so
 * the renderers never have to guess.
 */
export function normalizeSchedule(raw, { isDemo }) {
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
    // Carried through, not rebuilt: a field dropped here is a field the
    // bracket can never see — which is exactly what once happened to the
    // league's own playoff settings. Null means "ESPN did not say", never a
    // number; `playoffTeams()` falls back for it.
    playoffs: raw.playoffs || null,
    weeks,
    byWeek,
    games,
    isDemo,
  };
}

/**
 * How many teams make the playoffs, for this season.
 *
 * ESPN's own `scheduleSettings` when the league said; forecast.js's fallback
 * (six, from Tim's pasted settings) when it did not — demo, an old reading, a
 * stub. Clamped to the league size, because a six-team bracket in a four-team
 * league would seat teams that do not exist.
 */
export function playoffTeams(data) {
  const n = data?.teams?.length || 0;
  const said = data?.playoffs?.playoffTeams;
  const want = Number.isFinite(said) && said > 0 ? said : forecast.DEFAULT_PLAYOFF_TEAMS;
  return n ? Math.min(want, n) : want;
}

/** Did ESPN tell us the field size, or are we assuming it? */
export function playoffTeamsKnown(data) {
  return Number.isFinite(data?.playoffs?.playoffTeams);
}

/**
 * How many DIVISIONS the league has — and it matters, because the seeding
 * this site computes ignores them.
 *
 * ESPN seeds division winners ahead of every wildcard, so in a league with
 * more than one division a 9-4 team can be seeded below an 8-5 one that won
 * its division, and every title % downstream of the seeds would be wrong.
 * `js/forecast.js` seeds purely on the table (wins, a tie as half a win, then
 * points), which is right for a single-division league and only for that.
 *
 * This was an open question put to Tim twice. It should never have been a
 * question: ESPN publishes `settings.scheduleSettings.divisions` and
 * `espn.parsePlayoffs` has decoded the count all along — nothing read it. So
 * the league answers it on the next live load, and until then `null` means
 * "ESPN did not say" rather than "one", the same rule as every other field
 * here. Demo, a stub and any reading archived before this all yield null.
 */
export function divisionCount(data) {
  const n = data?.playoffs?.divisions;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True only when the league REALLY said it has more than one division. */
export function hasDivisions(data) {
  const n = divisionCount(data);
  return n !== null && n > 1;
}

/**
 * The last week of the regular season, read off the schedule.
 *
 * js/season.js's `fetchSchedule` hands over the REGULAR SEASON only — ESPN's
 * feed also carries the bracket and consolation games once they exist, and
 * season.js moves those to `playoffGames` — so the last week on the schedule
 * IS the last regular-season week, in every league, without a setting.
 */
export function regularSeasonLastWeek(data) {
  const w = data?.weeks || [];
  return w.length ? w[w.length - 1] : 0;
}

/** The scoring weeks the bracket falls in, one per round, earliest first. */
export function playoffWeeks(data) {
  const last = regularSeasonLastWeek(data);
  if (!last) return [];
  const rounds = forecast.playoffRoundCount(playoffTeams(data));
  return Array.from({ length: rounds }, (_, i) => last + 1 + i);
}

/** Weeks with at least one game not yet final. */
export function openWeeks(data) {
  return data.weeks.filter((w) => (data.byWeek.get(w) || []).some((g) => gameState(g) !== 'final'));
}

/** Weeks with at least one final game — the ones a spread can be learned from. */
export function decidedWeeks(data) {
  return data.weeks.filter((w) => (data.byWeek.get(w) || []).some((g) => gameState(g) === 'final'));
}

/**
 * The week the league is actually on: the last one with something on the
 * board, or the first week of the season if nothing has been played at all.
 */
export function currentWeek(data) {
  const started = data.weeks.filter((w) =>
    (data.byWeek.get(w) || []).some((g) => gameState(g) !== 'upcoming')
  );
  return started.length ? started[started.length - 1] : data.weeks[0] ?? 'all';
}

/**
 * THE WEEK A LIVE READING IS FILED UNDER: the first week still open.
 *
 * The Schedule page's `forecastAsOf()` on live data, and the week the
 * connection bar records. One definition, so the two routes file a reading
 * under the same number and "first write wins" means the same thing to both.
 * Once every game is decided it is the week after the last one.
 */
export function liveAsOf(data) {
  if (!data || !data.weeks.length) return 0;
  const open = openWeeks(data);
  return open.length ? open[0] : data.weeks[data.weeks.length - 1] + 1;
}

// ---------------------------------------------------------------- projection

/**
 * Which roster weeks a live reading needs, and what each is for.
 *
 *   project — the weeks still to play, plus the playoff weeks, which are not
 *             regular-season weeks and are asked for by number (their games do
 *             not exist until the bracket is seeded). These become
 *             the projection. (Once the regular season is decided there is no
 *             bracket to show, so only the current week is asked for.)
 *   decided — weeks with a result in them. Their STARTED lineups' projection,
 *             set against the score, is what the scoring spread is measured
 *             from — the same number the Summary page's LUCK column uses, so
 *             the two pages calibrate on the same residuals.
 *   asking  — both, once each, in that order.
 */
export function rosterPlan(data) {
  const open = openWeeks(data);
  const weeks = open.length ? open : [currentWeek(data)];
  const project = weeks.concat(open.length ? playoffWeeks(data) : []);
  const decided = decidedWeeks(data);
  const asking = [...new Set(decided.concat(project))];
  return { weeks, project, decided, asking };
}

/** The entries of `weekTeams` for `weeks`, in THAT order — never arrival order. */
export function pickWeeks(weekTeams, weeks) {
  const out = new Map();
  for (const w of weeks) {
    const teams = weekTeams?.get(w);
    if (teams && teams.length) out.set(w, teams);
  }
  return out;
}

/**
 * week -> teamId -> what that squad's STARTERS were projected to score.
 *
 * `projectedTotal` is js/season.js's own figure for the lineup actually set
 * that week — the number ESPN's site showed at the time, and the one
 * `fetchSeasonData` puts on a played game for LUCK. Missing or zero is left
 * out, never counted as zero.
 */
export function startedProjections(weekTeams, weeks) {
  const out = new Map();
  for (const w of weeks) {
    const row = new Map();
    for (const t of weekTeams?.get(w) || []) {
      if (typeof t.projectedTotal === 'number' && t.projectedTotal > 0) row.set(t.id, t.projectedTotal);
    }
    if (row.size) out.set(w, row);
  }
  return out;
}

/**
 * Turn per-week rosters into everything a page needs from a projection.
 *
 * projection.js works out the points; this adds a comparable strength per
 * team, a refusal to hand back a projection with a hole in it, and a note
 * saying where the numbers came from — including whether the starting slots
 * were read off the lineups or assumed, because guessing a two-receiver league
 * when it has three understates every team by a whole starter.
 *
 * THE POSITIONAL FLOOR passes straight through (Tim, 2026-09-18): no slot is
 * assessed below what the wire would give you there. It has to arrive here
 * rather than being read here, because this module is used by the weekly
 * READING as well as by the live page, and a reading must record what was on
 * screen at the time rather than fetching a wire of its own months later.
 *
 * @param {Object} data a normalised schedule
 * @param {Map<number, Array>} weekTeams week -> teams, for the weeks to project
 * @param {Map} [floors] from `floor.positionFloors`, or null for none
 * @returns {Object|null} null when the projection cannot cover the league
 */
export function buildProjection(data, weekTeams, floors = null) {
  const built = projectionsFromWeekTeams(weekTeams, floors);
  if (!built) return null;
  const { proj, slots, countsKnown } = built;

  // A projection that only covers some of the league would rank a run-in
  // against a hole. Better to hand back nothing and let the fallbacks speak.
  const covered = proj.get([...proj.keys()][0]);
  if (!covered || covered.size < data.teams.length) return null;

  // The comparable number per team: how many points they average over the
  // weeks still to play. Per WEEK, so it is safe to print on a card as a score.
  const ahead = [...proj.keys()].filter((w) =>
    (data.byWeek.get(w) || []).some((g) => gameState(g) !== 'final')
  );
  const over = ahead.length ? ahead : [...proj.keys()];
  const strength = new Map();
  for (const t of data.teams) {
    let total = 0;
    let n = 0;
    for (const w of over) {
      const v = proj.get(w)?.get(t.id);
      if (typeof v === 'number') { total += v; n++; }
    }
    if (n) strength.set(t.id, total / n);
  }
  if (strength.size < data.teams.length) return null;

  const starters = slots.length;
  const slotSource = countsKnown
    ? `${plural(starters, 'starter')} read from the current lineups`
    : `${plural(starters, 'starter')} assumed — this league’s own lineup settings could not be read`;

  const got = built.weeks;

  // The playoff weeks ride along in the same map — which is how a reading gets
  // them for free — but they are NOT part of the strength figure and must not
  // be described as though they were. `reach` is the regular season only.
  const lastRegular = regularSeasonLastWeek(data);
  const regular = got.filter((w) => w <= lastRegular);
  const bracketWeeks = got.filter((w) => w > lastRegular);
  const span = regular.length ? regular : got;
  const reach =
    span.length > 1 ? `weeks ${span[0]} to ${span[span.length - 1]}` : `week ${span[0]}`;
  const bracketNote = bracketWeeks.length
    ? ` The playoff weeks (${bracketWeeks.join(', ')}) are read the same way and ` +
      `used only by the simulation below — the regular season ends at week ` +
      `${lastRegular} and the bracket has no games until it is seeded, so those ` +
      `weeks are asked for by number.`
    : '';

  return {
    proj,
    slots,
    countsKnown,
    strength,
    weeksCovered: got,
    playoffWeeksCovered: bracketWeeks,
    note:
      `Strength is ESPN’s own projection for each week (${reach}), with the best ` +
      `legal lineup filled rather than the one currently set (${slotSource}) — ` +
      `the same total the ESPN site shows under a lineup paged forward to that ` +
      `week, except that a bench player projected above a starter is counted as ` +
      `starting. Players on bye come back at zero from ESPN, so they sit down on ` +
      `their own.${bracketNote}`,
  };
}

/**
 * Projected points for one side of one game.
 *
 * A projection carried on the game itself wins (the demo season has real
 * ones); otherwise it is the best lineup that team could field that week.
 */
export function projectedPoints(g, side, proj) {
  const own = side === 'home' ? g.homeProjected : g.awayProjected;
  if (typeof own === 'number' && own > 0) return own;
  const id = side === 'home' ? g.homeId : g.awayId;
  const v = proj?.get(g.week)?.get(id);
  return typeof v === 'number' && v > 0 ? v : null;
}

// ------------------------------------------------------------ scoring spread

/**
 * How far this league's scores land from their projections.
 *
 * Only BANKED, FINAL games feed it: a forecast may not learn from the results
 * it is being asked to forecast. The projection a score is set against is the
 * one carried on the game when there is one (demo), and otherwise the started
 * lineup's projection for that week (`startedProjections`). Both pages pass the
 * same two things, so they measure the same spread.
 *
 * @param {Object} data a normalised schedule
 * @param {(g) => boolean} banked is this game behind the as-of point?
 * @param {Map|null} started week -> teamId -> started-lineup projection
 */
export function leagueSpread(data, banked, started) {
  const pick = (g, side) => {
    const own = side === 'home' ? g.homeProjected : g.awayProjected;
    if (typeof own === 'number' && own > 0) return own;
    const id = side === 'home' ? g.homeId : g.awayId;
    return started?.get(g.week)?.get(id) ?? null;
  };
  const games = (data?.games || [])
    .filter((g) => gameState(g) === 'final' && banked(g))
    .map((g) => ({
      homeActual: g.homeScore,
      homeProjected: pick(g, 'home'),
      awayActual: g.awayScore,
      awayProjected: pick(g, 'away'),
    }));
  return forecast.calibrateSigma(games);
}

// ------------------------------------------------------------ matchup odds

/**
 * The roster weeks a page needs to quote the win chance for `week`'s games
 * the way the Schedule page does, and no more.
 *
 *   - every DECIDED week, because the spread is measured from them;
 *   - the first week still to project, because the starting slots are counted
 *     off the first week the Schedule page projects (`rosterPlan().project[0]`),
 *     and a different week could count them differently;
 *   - `week` itself, if it is a week the Schedule page projects at all. A week
 *     already decided has no win chance to quote.
 *
 * Decided weeks first, the same order `rosterPlan().asking` uses.
 */
export function oddsWeeks(data, week) {
  const plan = rosterPlan(data);
  const want = plan.decided.slice();
  if (plan.project.length) want.push(plan.project[0]);
  if (plan.project.includes(week)) want.push(week);
  return [...new Set(want)];
}

/**
 * THE WIN CHANCE FOR ANY GAME, WORKED OUT EXACTLY AS THE SCHEDULE PAGE DOES.
 *
 * Home and Schedule once quoted different chances for the same game — Home
 * compared the lineups as currently SET against an assumed 27-point spread,
 * Schedule the BEST legal lineups against the spread measured from this
 * league's played weeks. This is the Schedule page's route bundled into one
 * call, built from the same pieces it calls one by one (`pickWeeks`,
 * `buildProjection`, `startedProjections`, `leagueSpread`, `projectedPoints`),
 * so a page that uses it cannot drift from Schedule without Schedule moving
 * too. `tests/home-winpct-check.mjs` holds the two to the same figure.
 *
 * @param {Object} data       a normalised schedule
 * @param {Map} weekTeams     week -> teams; `oddsWeeks()` says which it needs
 * @param {Object} [o]
 * @param {(g) => boolean} [o.banked]  may this game's result feed the spread?
 *        On live data that is every final game, which is the default.
 * @returns {{probability:Function, forGame:Function, points:Function,
 *            projection:Object|null, sigma:number, calibrated:boolean, sample:number}}
 */
export function matchupOdds(data, weekTeams, { banked = () => true } = {}) {
  const plan = rosterPlan(data);
  const toProject = pickWeeks(weekTeams, plan.project);
  const projection = toProject.size ? buildProjection(data, toProject) : null;
  const started = startedProjections(weekTeams, plan.decided);
  const { sigma, calibrated, sample } = leagueSpread(data, banked, started);
  const proj = projection ? projection.proj : null;

  /** One side's projected points: the best lineup, as on Schedule's cards. */
  const points = (g, side) => projectedPoints(g, side, proj);

  /** The HOME side's chance, or null without both projections. */
  const forGame = (g) => {
    if (!g || g.homeId == null || g.awayId == null) return null;
    const h = points(g, 'home');
    const a = points(g, 'away');
    if (h === null || a === null) return null;
    return forecast.winProbability(h, a, sigma);
  };

  /** `teamA`'s chance against `teamB` in `week`, whichever side is home. */
  const probability = (teamA, teamB, week) => {
    const games = data?.byWeek?.get(week) || [];
    const g = games.find((x) =>
      (x.homeId === teamA && x.awayId === teamB) || (x.homeId === teamB && x.awayId === teamA));
    if (g) {
      const p = forGame(g);
      if (p === null) return null;
      return g.homeId === teamA ? p : 1 - p;
    }
    // No such fixture: the same arithmetic on the two best lineups.
    const a = proj?.get(week)?.get(teamA);
    const b = proj?.get(week)?.get(teamB);
    if (!(a > 0) || !(b > 0)) return null;
    return forecast.winProbability(a, b, sigma);
  };

  return { probability, forGame, points, projection, sigma, calibrated, sample };
}

// ------------------------------------------------------------ the simulation

/**
 * Everything `simulateSeason` needs apart from the run count and the seed.
 *
 * BOTH pages call this, and that is the whole point: title % on the Summary
 * page and on the Schedule page are the same question, and they can only give
 * the same answer if they are asked it with the same banked table, the same
 * remaining games, the same projections, the same spread and the same bracket.
 *
 * @param {Object} o
 * @param {Object} o.data        a normalised schedule
 * @param {(g) => boolean} o.isRemaining  is this game still to be played out?
 * @param {Map|null} o.proj      week -> teamId -> projected points
 * @param {number} o.sigma
 */
export function simulationInputs({ data, isRemaining, proj, sigma }) {
  if (!data || !data.teams.length) return null;

  const teamIds = data.teams.map((t) => t.id);
  const banked = new Map(teamIds.map((id) => [id, { wins: 0, pointsFor: 0 }]));
  const games = [];
  let playable = 0;

  for (const g of data.games) {
    if (g.homeId == null || g.awayId == null) continue;        // bye: nothing to play out
    if (!banked.has(g.homeId) || !banked.has(g.awayId)) continue;

    if (isRemaining(g)) {
      const homeProj = projectedPoints(g, 'home', proj);
      const awayProj = projectedPoints(g, 'away', proj);
      if (homeProj !== null && awayProj !== null) playable++;
      // `week` rides along for js/trade-odds.js, which shifts one squad's
      // projection in the weeks a trade changes. simulateSeason ignores it.
      games.push({ week: g.week, homeId: g.homeId, awayId: g.awayId, homeProj, awayProj });
      continue;
    }

    // A game in progress is neither banked nor played out: half a scoreline is
    // not a result, and winnerOf() returns null for it.
    const winner = winnerOf(g);
    if (winner === null) continue;

    const h = banked.get(g.homeId);
    const a = banked.get(g.awayId);
    if (typeof g.homeScore === 'number') h.pointsFor += g.homeScore;
    if (typeof g.awayScore === 'number') a.pointsFor += g.awayScore;
    // The league's matchup tie breaker is "None": a tie stands, half a win each.
    if (winner === 'tie') { h.wins += 0.5; a.wins += 0.5; }
    else if (winner === 'home') h.wins += 1;
    else a.wins += 1;
  }

  const weeks = playoffWeeks(data);
  const field = playoffTeams(data);
  const playoff = { teams: field, weeks, proj: proj || null };
  const playoffProjKey = weeks.map((w) => {
    const forWeek = proj?.get(w);
    return forWeek ? teamIds.map((id) => forWeek.get(id) ?? null) : null;
  });

  // Everything that changes the answer, for a caller's cache key. The run
  // count is the caller's to add.
  const keyParts = [
    Math.round(sigma * 1000),
    teamIds,
    [...banked].map(([id, b]) => [id, b.wins, Math.round(b.pointsFor * 10)]),
    games.map((g) => [g.homeId, g.awayId, g.homeProj, g.awayProj]),
    field,
    weeks,
    playoffProjKey,
  ];

  return { teamIds, banked, games, playable, sigma, playoff, keyParts };
}

/**
 * Standings order: win percentage with a tie as half a win, then points for.
 *
 * ESPN's own order. The old sort on raw wins ignored ties entirely, so a 2-0-1
 * team sat level with a 2-1 one and was split on points.
 *
 * @returns {number} a sort value, higher first
 */
export function standingsKey({ w, l, t }, pf) {
  const gp = w + l + t;
  const pct = gp ? (w + t / 2) / gp : 0;
  // Two different win percentages over a season of up to ~17 games differ by
  // at least 1/1,156; points for at 1e-8 per point cannot reach that below
  // 80,000 points, so it only ever splits teams level on percentage.
  return pct + (Number(pf) || 0) * 1e-8;
}

// --------------------------------------------------------------- the reading

/**
 * Freeze a reading. The one call both routes make, so the fields cannot drift.
 */
export function readingFrom({ leagueId, season, week, data, projection, strengthNote, spread }) {
  return snapshots.snapshotFrom({
    leagueId,
    season,
    week,
    data,
    projection,
    strengthNote,
    sigma: spread ? spread.sigma : null,
    calibrated: spread ? spread.calibrated : false,
    sample: spread ? spread.sample : 0,
  });
}

/** Why a reading could not be built from what ESPN sent, in words. */
function projectionGap(asked, got) {
  const missing = asked - got;
  return missing > 0
    ? `ESPN refused ${missing} of ${asked} roster weeks, so there was no projection to record.`
    : 'ESPN’s rosters did not cover every team, so there was no projection to record.';
}

/**
 * Fetch and build a live reading. Throws nothing; reports what happened.
 *
 * @returns {Promise<{snap:Object|null, code:string, text:string, week:number}>}
 */
export async function takeReading({ leagueId, season, data, fetchWeeksRosters }) {
  const week = liveAsOf(data);
  const plan = rosterPlan(data);

  let weekTeams = new Map();
  try {
    weekTeams = (await fetchWeeksRosters(plan.asking)) || new Map();
  } catch {
    weekTeams = new Map();
  }

  const toProject = pickWeeks(weekTeams, plan.project);
  const projection = toProject.size ? buildProjection(data, toProject) : null;
  if (!projection) {
    return { snap: null, week, code: 'no-projection', text: projectionGap(plan.project.length, toProject.size) };
  }

  const started = startedProjections(weekTeams, plan.decided);
  // On live data "banked" is exactly "final" — the as-of week is the first open one.
  const spread = leagueSpread(data, () => true, started);
  const snap = readingFrom({
    leagueId, season, week, data, projection, strengthNote: projection.note, spread,
  });
  return { snap, week, code: 'ok', text: '' };
}

// ----------------------------------------------------- the connection bar's route

/** How long a failed attempt blocks another from the bar, for the same week. */
export const RETRY_MS = 10 * 60 * 1000;

let inFlight = null;

/**
 * Take this week's reading, if it is due, from whatever page is open.
 *
 * Called by js/connection.js after it has connected. It only ever runs where a
 * reading can honestly be taken:
 *
 *   - the bridge extension is present (so the data is live ESPN, never the
 *     synced cloud copy and never demo);
 *   - the league is a real one;
 *   - this week has no reading yet — FIRST WRITE WINS, exactly as on the
 *     Schedule page, and the committed archive is consulted before deciding,
 *     so a new browser does not overwrite the week the repo already holds
 *     with a later reading.
 *
 * Every failure is silent to the page and recorded with
 * `snapshots.saveAttempt`, which is what the Schedule page's status line and
 * the bar's chip read.
 *
 * @returns {Promise<{code:string, week?:number, recorded?:boolean, text?:string}>}
 */
export function captureIfDue(opts) {
  if (inFlight) return inFlight;
  inFlight = runCapture(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function runCapture({
  leagueId, season, bridgePresent,
  fetchSchedule, fetchWeeksRosters, cloudSource = null,
  fetchRemote = snapshots.fetchRemote, now = () => Date.now(),
}) {
  const id = String(leagueId ?? '');
  if (!bridgePresent) return { code: 'no-bridge' };
  if (!/^\d+$/.test(id)) return { code: 'no-league' };
  if (typeof fetchSchedule !== 'function' || typeof fetchWeeksRosters !== 'function') {
    return { code: 'no-fetchers' };
  }

  const record = (rec) => {
    const full = { at: now(), source: 'bar', ...rec };
    snapshots.saveAttempt(id, season, full);
    return full;
  };

  try {
    // Belt and braces: with the bridge present js/season.js never serves the
    // cloud, but a reading from a synced copy is the one thing this must never
    // take, so it asks rather than assumes.
    if (typeof cloudSource === 'function') {
      let down = null;
      try { down = await cloudSource(); } catch { down = null; }
      if (down) {
        return record({ ok: false, week: null, code: 'cloud', text: CLOUD_TEXT });
      }
    }

    let raw;
    try {
      raw = await fetchSchedule();
    } catch (err) {
      return record({
        ok: false, week: null, code: 'schedule-failed',
        text: `ESPN refused the schedule (${(err && err.message) || 'no reason given'}).`,
      });
    }
    const data = normalizeSchedule(raw, { isDemo: false });
    if (!data.games.length) {
      return record({ ok: false, week: null, code: 'no-schedule', text: 'ESPN returned no matchups for this season.' });
    }

    const week = liveAsOf(data);
    if (snapshots.get(id, season, week)) return { code: 'recorded', week, recorded: true };

    const last = snapshots.lastAttempt(id, season);
    if (last && !last.ok && last.week === week && now() - last.at < RETRY_MS) {
      return { code: last.code, week, text: last.text, throttled: true };
    }

    // The committed archive first: a week the repo already holds is recorded,
    // and taking a later reading here would replace it the next time this
    // browser's archive is exported.
    try { await fetchRemote(id, season); } catch { /* silent, as everywhere */ }
    if (snapshots.get(id, season, week)) return { code: 'recorded', week, recorded: true };

    const reading = await takeReading({ leagueId: id, season, data, fetchWeeksRosters });
    if (!reading.snap) return record({ ok: false, week, code: reading.code, text: reading.text });

    // Re-checked after the awaits: the Schedule page may have written it
    // meanwhile, and the first write is the one kept.
    if (snapshots.get(id, season, week)) return { code: 'recorded', week, recorded: true };

    const res = snapshots.save(reading.snap);
    if (!res.ok) return record({ ok: false, week, code: 'save-failed', text: res.reason });
    record({ ok: true, week, code: 'ok', text: '' });
    return { code: 'recorded', week, recorded: true, fresh: true };
  } catch (err) {
    return record({
      ok: false, week: null, code: 'error',
      text: `Something went wrong taking the reading (${(err && err.message) || err}).`,
    });
  }
}

// --------------------------------------------------------------- saying so

export const CLOUD_TEXT =
  'this is the synced copy from your computer, and readings are only taken on your computer.';

/** The words for a page's own reason a reading was not taken. */
export const CONTEXT_TEXT = {
  'no-league': 'no league is connected.',
  demo: 'demo data is on. Readings are taken from your live league, on your computer.',
  cloud: CLOUD_TEXT,
  replay: 'you are replaying an archived week. Choose “Right now” to take this week’s reading.',
  'no-live': 'there is no live connection to ESPN on this page.',
  pending: 'still reading ESPN’s projections…',
};

/**
 * The one status line: was this week recorded, and if not, why not.
 *
 * @param {Object} o
 * @param {number|null} o.week     the week in question, when known
 * @param {Object|null} o.snap     the reading held for it, if any
 * @param {Object|null} o.attempt  `snapshots.lastAttempt()`
 * @param {Object|null} o.context  the page's own reason, `{code, text?}`
 * @returns {{recorded:boolean, tone:'pos'|'neg'|'dim', text:string}}
 */
export function statusLine({ week = null, snap = null, attempt = null, context = null } = {}) {
  const label = Number.isFinite(week) && week > 0 ? `Week ${week}` : 'This week';
  if (snap) {
    const when = new Date(snap.takenAt);
    const stamp = Number.isNaN(when.getTime())
      ? 'at an unknown time'
      : when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return { recorded: true, tone: 'pos', text: `${label}: recorded ${stamp}` };
  }

  if (context && context.code === 'pending') {
    return { recorded: false, tone: 'dim', text: `${label}: not recorded yet — ${CONTEXT_TEXT.pending}` };
  }

  // A failure from THIS week outranks a generic page state: it is the real
  // reason, and it may have come from another page's attempt.
  const sameWeek = attempt && !attempt.ok && (week == null || attempt.week == null || attempt.week === week);
  let why = '';
  if (context && context.code && context.code !== 'ok') {
    why = context.text || CONTEXT_TEXT[context.code] || context.code;
    if (sameWeek && attempt.text && context.code !== 'cloud' && context.code !== 'demo') why = attempt.text;
  } else if (sameWeek) {
    why = attempt.text || attempt.code;
  } else {
    why = 'no reading has been attempted on this computer yet. Open this page on live data with the extension.';
  }
  return { recorded: false, tone: 'neg', text: `${label}: NOT recorded — ${why}` };
}
