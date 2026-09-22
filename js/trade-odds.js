// What a trade does to the thing you are actually playing for.
//
// Tim, 2026-09-21: "I want the site to offer virtually the perfect trade to the
// user … the user should essentially open with a goal and all the data aligns
// with that goal. They can either choose between not losing or winning
// everything … The trade should be ranked by the increase/decrease in this
// chance." And on the other manager: "rank by expected value, but add a good
// amount of leeway."
//
// WHY POINTS WERE NOT ENOUGH. The finder in js/trade.js prices a deal by the
// points each lineup gains, summed over the weeks that are left. That is sound
// arithmetic and the wrong objective, three ways at once:
//
//   - every week counts the same — +3 in a week you win by forty is priced like
//     +3 in a coin flip;
//   - the playoff weeks counted for nothing at all, so a deal that makes you a
//     monster in the championship ranked below one that helps in October;
//   - it cannot see that the deal also makes a RIVAL stronger.
//
// The season simulation (js/forecast.js, the one Schedule and Summary run)
// already answers all three: it plays out every remaining game and the bracket,
// ten thousand times, and counts where everyone finishes. So a trade is judged
// by running that same simulation twice — once as the league stands, once with
// the deal made — and reading off the change in the chance the reader picked.
//
// HOW A DEAL REACHES THE SIMULATION: AS A CHANGE IN POINTS, WEEK BY WEEK. The
// finder has already priced, for each week, what each of the two squads would
// field before the deal and after it (best legal lineup, same floors). The
// difference is added to that squad's projection in its game that week, and to
// its bracket projection in a playoff week. Nothing is re-derived, so the
// simulation cannot price a deal on different arithmetic from the row beside it
// — and the same route works for the demo, whose games carry their own
// projections, and for a live league, whose games are projected from rosters.
//
// COMMON RANDOM NUMBERS. Every run uses the same seed, so the league-as-it-is
// and every deal are played out against the SAME ten thousand seasons: the same
// draws, game for game. The difference between two runs is then only the deal,
// and not two different samples of luck. Without that, two offers a tenth of a
// percent apart would swap places at random between page loads.
//
// Pure: no DOM, no fetching. The page does the waiting.

import { simulateSeason } from './forecast.js';

// ------------------------------------------------------------------ the goals

/**
 * The two things a manager can be playing for.
 *
 * `read` takes one team's row out of `simulateSeason().teams`. `better` says
 * which way is good, because the second goal is a chance you want to go DOWN
 * and every comparison below must not have to remember that.
 *
 * "Last" is Tim's own definition, and the simulation already holds it: last in
 * the REGULAR-SEASON table, not the consolation ladder (`pLast` in
 * js/forecast.js). The playoffs therefore cannot move it, which is why the
 * Trade page prices only regular-season weeks under that goal.
 */
export const GOALS = {
  title: {
    key: 'title',
    label: 'Win it all',
    chance: 'title chance',
    better: 'up',
    read: (row) => (row && Number.isFinite(row.pTitle) ? row.pTitle : null),
  },
  last: {
    key: 'last',
    label: 'Don’t finish last',
    chance: 'chance of finishing last',
    better: 'down',
    read: (row) => (row && Number.isFinite(row.pLast) ? row.pLast : null),
  },
};

export const DEFAULT_GOAL = 'title';

/** A goal by key, falling back to the default for anything unrecognised. */
export function goalOf(key) {
  return GOALS[key] || GOALS[DEFAULT_GOAL];
}

/** One team's chance at `goal` in a simulation result, or null. */
export function goalChance(result, teamId, goal) {
  const g = typeof goal === 'string' ? goalOf(goal) : goal;
  const row = result?.teams?.find((t) => t.teamId === teamId);
  return g.read(row);
}

/**
 * How much better off a squad is, as a signed probability: positive is good
 * whichever way the goal points. A 12% chance of last falling to 9% is +0.03.
 */
export function goalGain(before, after, goal) {
  const g = typeof goal === 'string' ? goalOf(goal) : goal;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return g.better === 'down' ? before - after : after - before;
}

// ---------------------------------------------------- will he say yes?
//
// THE ONE JUDGEMENT IN THIS FILE, and it is labelled as one on the page.
//
// Nothing ESPN publishes says whether a manager accepts a trade. What he can
// see is two things, and the estimate is built from exactly those two:
//
//   1. what the deal does to HIS lineup — the finder's own "He gains", per
//      week. A manager who looks at his lineup sees this.
//   2. how the deal LOOKS on ESPN's trade screen — the ESPN projections of the
//      men he receives against the men he sends, added up over the same weeks,
//      per week. A manager who reads names and numbers and never re-fills a
//      lineup sees this, and most of them are that manager.
//
// Weighted equally, because nothing measured says otherwise. Then a logistic
// curve with a deliberately generous LEEWAY (Tim: "a good amount of leeway"):
//
//     perceived  = (his lineup gain + how it looks) / 2          points a week
//     P(yes)     = 1 / (1 + e^−((perceived + LEEWAY) / SCALE))
//
// which reads, at the constants below:
//
//     he comes out +3 a week      98%
//     dead even                   88%
//     he gives up 3 a week        50%
//     he gives up 6 a week        12%
//
// So an even deal is very likely, a mildly lopsided one in your favour is still
// a coin flip, and only a clear fleece is marked down hard. Both constants are
// named here and printed in the page's note, so the curve is checkable and
// easy to change.

/**
 * The least HIS lineup may gain, a week, for a deal to be a candidate at all.
 * Below zero on purpose: a deal that costs him a little can still look good to
 * him on ESPN's screen and be accepted, and the yes-chance marks it down rather
 * than the finder hiding it. At −2 lineup and −2 on ESPN's numbers the chance
 * is 66%; the finder's list is ranked with that already applied.
 */
export const THEIR_MIN_PER_WEEK = -2;

/** Points a week a deal can go against him and still be a coin flip. */
export const ACCEPT_LEEWAY = 3;
/** How quickly the chance falls away past that, in points a week. */
export const ACCEPT_SCALE = 1.5;

const sum = (list) => (list || []).reduce((a, p) => a + (Number.isFinite(p?.projected) ? p.projected : 0), 0);

/**
 * How the deal looks to HIM on ESPN's numbers, in points a week: what he
 * receives (your `send`) minus what he gives up (your `receive`).
 *
 * `projected` on an offer's entries is each man's total over the priced weeks
 * (js/trade.js `scoreAcrossWeeks`), so dividing by the week count puts it on
 * the same per-week scale as his lineup gain.
 */
export function espnLookPerWeek(offer, weekCount) {
  const n = Math.max(1, Number(weekCount) || 0);
  if (!offer) return null;
  return (sum(offer.send) - sum(offer.receive)) / n;
}

/**
 * The chance he says yes, from the two things he can see.
 * Either may be missing; with neither there is nothing to say and it is null.
 */
export function acceptChance({ lineupPerWeek = null, lookPerWeek = null } = {}) {
  const parts = [lineupPerWeek, lookPerWeek].filter((v) => Number.isFinite(v));
  if (!parts.length) return null;
  const perceived = parts.reduce((a, v) => a + v, 0) / parts.length;
  return 1 / (1 + Math.exp(-(perceived + ACCEPT_LEEWAY) / ACCEPT_SCALE));
}

// ------------------------------------------------ a deal, as a season

/**
 * The per-week change a deal makes to each of the two squads.
 *
 * Read straight off the finder's own pricing — `byWeek` for your side and
 * `theirByWeek` for his — so the simulation plays out exactly the points the
 * row beside it prints. A side with no per-week breakdown contributes nothing
 * rather than a guess.
 *
 * @returns {Map<number, Map<number, number>>} teamId -> week -> points
 */
export function offerDeltas(offer, myTeamId) {
  const out = new Map();
  const add = (teamId, byWeek) => {
    if (teamId === null || teamId === undefined || !Array.isArray(byWeek)) return;
    const m = new Map();
    for (const w of byWeek) {
      if (Number.isFinite(w?.week) && Number.isFinite(w?.delta) && w.delta !== 0) m.set(w.week, w.delta);
    }
    if (m.size) out.set(teamId, m);
  };
  add(offer?.mineTeamId ?? myTeamId, offer?.byWeek);
  add(offer?.partner?.id, offer?.theirByWeek);
  return out;
}

/**
 * The season with those changes made — new objects, the inputs untouched.
 *
 * `inputs` is `capture.simulationInputs()`'s result, whose games carry their
 * `week`. A game whose projection is missing stays missing: adding a delta to
 * a null would invent a projection the simulation had rightly refused to play.
 * A playoff week is shifted only where ESPN projected it; a round the bracket
 * has to MODEL from the regular season follows the regular-season shift on its
 * own, because that is what it is modelled from.
 */
export function shiftSeason(inputs, deltas) {
  const shift = (teamId, week, v) => {
    if (!Number.isFinite(v)) return v;
    const d = deltas?.get(teamId)?.get(week);
    return Number.isFinite(d) ? v + d : v;
  };

  const games = (inputs?.games || []).map((g) => ({
    ...g,
    homeProj: shift(g.homeId, g.week, g.homeProj),
    awayProj: shift(g.awayId, g.week, g.awayProj),
  }));

  let playoff = inputs?.playoff || null;
  if (playoff && playoff.proj instanceof Map) {
    const proj = new Map();
    for (const [week, forWeek] of playoff.proj) {
      const row = new Map();
      for (const [teamId, v] of forWeek) row.set(teamId, shift(teamId, week, v));
      proj.set(week, row);
    }
    playoff = { ...playoff, proj };
  }

  return { ...inputs, games, playoff };
}

/** Ten thousand seasons: enough, with a shared seed, to rank deals a tenth apart. */
export const GOAL_RUNS = 10000;
/** Fixed, so a reload does not reshuffle the table. */
export const GOAL_SEED = 20260921;

/**
 * Play the season out with `deltas` applied (none = the league as it is).
 * The seed is shared by every call, which is what makes two runs comparable.
 */
export function simulateWith(inputs, deltas = null, { runs = GOAL_RUNS, seed = GOAL_SEED } = {}) {
  if (!inputs) return null;
  const season = deltas && deltas.size ? shiftSeason(inputs, deltas) : inputs;
  return simulateSeason({
    teamIds: season.teamIds,
    banked: season.banked,
    games: season.games,
    sigma: season.sigma,
    runs,
    seed,
    playoff: season.playoff,
  });
}

// ---------------------------------------------- what a point is worth, by week
//
// THE CANDIDATES FOLLOW THE GOAL, NOT ONLY THE ORDER (2026-09-21, item 1 of
// the road to "the perfect trade"). The finder used to keep only deals that
// gained POINTS over the span, so a deal that loses a little in October and
// wins big in the final was never a candidate at all — the simulation could
// only re-order what points had already chosen.
//
// So before the search, each priced week is given a WEIGHT: how far your chance
// at the goal moves when your squad scores more that week, measured in the same
// simulation on the same seed — ten extra points in that one week, played out,
// divided by ten. A week you are already sure to win or lose is worth little; a
// coin flip against a rival for the last playoff place is worth a lot; a final
// you reach one season in four is worth a quarter of what it would be if you
// were sure to be there. The finder then keeps any deal whose WEIGHTED gain is
// positive, and the exact simulation of each finalist does the rest.
//
// Normalised to a mean of 1, so the weighted gain reads in points: a deal whose
// points land in average weeks has the same weighted gain as points. Floored at
// a twentieth of the largest week, so a week the noise put at zero still counts
// for something and no candidate is thrown out on a rounding of luck. Null when
// the goal does not move at all (a 0.0% chance of last) — the finder then works
// on points exactly as before, and the page says so.

/** Extra points given to one week to measure its weight. */
export const WEIGHT_BUMP = 10;
/** No week counts for less than this share of the heaviest. */
export const WEIGHT_FLOOR = 0.05;

/**
 * @param {Object} inputs   `capture.simulationInputs()` result
 * @param {number} myTeamId
 * @param {number[]} weeks  the priced span, in order
 * @param {string} goal
 * @returns {{weights:number[], raw:number[], base:Object}|null} `raw` is the
 *   measured change in the chance per point, for the note; null when nothing moves.
 */
export function weekWeights(inputs, myTeamId, weeks, goal, { runs = GOAL_RUNS, seed = GOAL_SEED } = {}) {
  if (!inputs || !Array.isArray(weeks) || !weeks.length) return null;
  const base = simulateWith(inputs, null, { runs, seed });
  if (!base) return null;
  const before = goalChance(base, myTeamId, goal);
  const raw = weeks.map((week) => {
    const after = simulateWith(inputs, new Map([[myTeamId, new Map([[week, WEIGHT_BUMP]])]]), { runs, seed });
    const g = goalGain(before, goalChance(after, myTeamId, goal), goal);
    return Number.isFinite(g) ? g / WEIGHT_BUMP : 0;
  });
  const top = Math.max(...raw);
  // Ten points in the most important week moving the chance by less than a
  // twentieth of a point: the goal is settled, and weights would be noise.
  if (!(top * WEIGHT_BUMP > 0.0005)) return null;
  const floored = raw.map((s) => Math.max(s, WEIGHT_FLOOR * top));
  const mean = floored.reduce((a, s) => a + s, 0) / floored.length;
  return { weights: floored.map((s) => s / mean), raw, base };
}

/**
 * Everything the page prints about one deal and the goal.
 *
 * @param {Object} o
 * @param {Object} o.base    the league as it is (`simulateWith(inputs)`)
 * @param {Object} o.after   the league with the deal made
 * @param {number} o.myTeamId
 * @param {number} o.partnerId
 * @param {string|Object} o.goal
 * @param {number|null} o.accept  from `acceptChance`
 * @returns {{mine:{before,after,gain}, theirs:{before,after,gain}, accept, value}}
 *   `value` is your gain times the chance he says yes — the expected change in
 *   your chance, and what the finder ranks by.
 */
export function scoreOffer({ base, after, myTeamId, partnerId, goal, accept = null }) {
  const side = (id) => {
    const before = goalChance(base, id, goal);
    const now = goalChance(after, id, goal);
    return { before, after: now, gain: goalGain(before, now, goal) };
  };
  const mine = side(myTeamId);
  const theirs = side(partnerId);
  const p = Number.isFinite(accept) ? accept : 1;
  return {
    mine,
    theirs,
    accept: Number.isFinite(accept) ? accept : null,
    value: Number.isFinite(mine.gain) ? mine.gain * p : null,
  };
}

/**
 * Best first: expected change in your chance, then the change itself, then the
 * points the finder found. The last key is what orders deals the simulation
 * cannot tell apart — a goal that is already settled (a 0.0% chance of last
 * moves by nothing) leaves the page ranked exactly as it was before any of this.
 */
export function compareByGoal(a, b) {
  const v = (o) => (Number.isFinite(o?.goalScore?.value) ? o.goalScore.value : -Infinity);
  const g = (o) => (Number.isFinite(o?.goalScore?.mine?.gain) ? o.goalScore.mine.gain : -Infinity);
  // Half a hundredth of a percentage point: below what 10,000 shared-seed runs
  // can separate, so it is treated as a tie and the points decide.
  const EPS = 0.00005;
  const dv = v(b) - v(a);
  if (Math.abs(dv) > EPS) return dv;
  const dg = g(b) - g(a);
  if (Math.abs(dg) > EPS) return dg;
  return (b.myGain || 0) - (a.myGain || 0);
}
