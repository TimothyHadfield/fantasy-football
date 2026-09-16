// Forecasting: turn projections into win probabilities and season outcomes.
//
// Pure functions only — no DOM, no fetching — so this is node-testable and the
// page can stay about rendering.
//
// WHAT THIS IS NOT: ESPN does not publish a win probability through any
// endpoint the site can read. It publishes PROJECTIONS. Everything here is
// derived from those projections plus how far this league's real scores have
// historically drifted from them. Presenting it as "ESPN's odds" would be
// dressing our own model in someone else's authority, so the page says
// "projected" and shows the spread the model is built on.
//
// Slot eligibility comes from js/espn.js rather than being restated here.
// Importing it costs nothing at module scope (that file only touches the
// network when a fetch function is actually called), and a second copy of the
// table is how the flex quietly starts accepting a quarterback.

import { SLOT_ELIGIBILITY } from './espn.js';

// --------------------------------------------------------------- normal model
//
// A team's score is modelled as its projection plus symmetric noise. That is a
// simplification — real fantasy scores are mildly right-skewed, because a
// player can go off for 40 but cannot score less than about zero — but the
// error that matters for a win probability is in the MARGIN, and the skew
// largely cancels when two of them are subtracted.

/** Abramowitz & Stegun 7.1.26. Max absolute error ~1.5e-7, far below the
 *  precision this model deserves. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return sign * y;
}

/** P(Z <= x) for a standard normal. */
export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * The chance `projA` beats `projB`, given a per-team scoring spread.
 *
 * Both teams carry the same spread, and their scores are treated as
 * independent, so the margin's standard deviation is sigma * sqrt(2).
 *
 * @param {number} projA
 * @param {number} projB
 * @param {number} sigma per-team-week standard deviation of (actual - projected)
 * @returns {number|null} probability in 0..1, or null if the inputs cannot support one
 */
export function winProbability(projA, projB, sigma) {
  if (!Number.isFinite(projA) || !Number.isFinite(projB)) return null;
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  return normalCdf((projA - projB) / (sigma * Math.SQRT2));
}

/**
 * The spread to use when the league has no history to learn from.
 *
 * Fantasy weekly team scores sit roughly 25-30 points away from their
 * projection, and the value only moves a win probability slowly: at a 10-point
 * projected edge, 24 vs 30 is 62% vs 59%. So an uncalibrated forecast is still
 * useful — it just must say that it is uncalibrated.
 */
export const DEFAULT_SIGMA = 27;

/** Below this many team-weeks, a measured spread is noisier than the default. */
export const MIN_GAMES_TO_CALIBRATE = 12;

/**
 * Learn the scoring spread from games already played.
 *
 * @param {Array<{homeActual:number,homeProjected:number,awayActual:number,awayProjected:number}>} games
 * @returns {{sigma:number, calibrated:boolean, sample:number}}
 */
export function calibrateSigma(games) {
  const residuals = [];
  for (const g of games || []) {
    if (Number.isFinite(g.homeActual) && Number.isFinite(g.homeProjected) && g.homeProjected > 0) {
      residuals.push(g.homeActual - g.homeProjected);
    }
    if (Number.isFinite(g.awayActual) && Number.isFinite(g.awayProjected) && g.awayProjected > 0) {
      residuals.push(g.awayActual - g.awayProjected);
    }
  }

  if (residuals.length < MIN_GAMES_TO_CALIBRATE) {
    return { sigma: DEFAULT_SIGMA, calibrated: false, sample: residuals.length };
  }

  // Around the observed mean, not around zero: a league whose projections run
  // consistently high has a bias, and folding that bias into the spread would
  // overstate how random the results are.
  const mean = residuals.reduce((a, v) => a + v, 0) / residuals.length;
  const variance =
    residuals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (residuals.length - 1);
  const sigma = Math.sqrt(variance);

  if (!Number.isFinite(sigma) || sigma <= 0) {
    return { sigma: DEFAULT_SIGMA, calibrated: false, sample: residuals.length };
  }
  return { sigma, calibrated: true, sample: residuals.length };
}

// ------------------------------------------------------------- optimal lineup

/**
 * Fallback lineup, used only when ESPN's own settings cannot be read.
 *
 * Prefer `slotsFromCounts(parseLeague(raw).starterSlots)` — leagues differ, and
 * guessing is how you end up projecting a three-receiver league with two.
 */
export const DEFAULT_SLOTS = [0, 2, 2, 4, 4, 4, 6, 23, 16, 17];

/**
 * Expand ESPN's `{slotId: count}` into the flat list of slots to fill.
 *
 * @param {Object<string, number>} counts `parseLeague().starterSlots`
 * @returns {number[]}
 */
export function slotsFromCounts(counts) {
  if (!counts || typeof counts !== 'object') return DEFAULT_SLOTS.slice();
  const slots = [];
  for (const [slotId, count] of Object.entries(counts)) {
    const id = Number(slotId);
    for (let i = 0; i < count; i++) slots.push(id);
  }
  return slots.length ? slots : DEFAULT_SLOTS.slice();
}

/**
 * Fill a lineup with the highest-projected eligible players.
 *
 * Slots are filled from the most restrictive to the least, which is optimal
 * here because the eligibility sets nest: every RB slot is a subset of FLEX,
 * which is a subset of OP. Taking the best RB first can therefore never cost
 * the FLEX anything it could not replace with an equally good WR or TE.
 *
 * @param {Array<{position:string, projected:number}>} players
 * @param {number[]} slots lineupSlotIds to fill
 * @returns {{starters:Array, total:number}}
 */
export function optimalLineup(players, slots = DEFAULT_SLOTS) {
  const pool = (players || [])
    .filter((p) => p && Number.isFinite(p.projected))
    .slice()
    .sort((a, b) => b.projected - a.projected);

  const order = slots
    .map((slotId, i) => ({ slotId, i, breadth: (SLOT_ELIGIBILITY[slotId] || []).length }))
    .sort((a, b) => a.breadth - b.breadth || a.i - b.i);

  const used = new Set();
  const starters = [];

  for (const { slotId } of order) {
    const eligible = SLOT_ELIGIBILITY[slotId];
    if (!eligible) continue;
    const pick = pool.find((p) => !used.has(p) && eligible.includes(p.position));
    if (!pick) continue;
    used.add(pick);
    starters.push({ ...pick, slotId });
  }

  const total = starters.reduce((a, p) => a + p.projected, 0);
  return { starters, total: Math.round(total * 10) / 10 };
}

// ------------------------------------------------------- season win totals

/**
 * The chance of finishing on each possible number of wins.
 *
 * This is a Poisson-binomial: a sum of independent coin flips that each have
 * their own probability. Computed exactly by convolution rather than simulated,
 * because with at most ~13 games it is cheap and an exact answer beats a noisy
 * one.
 *
 * Ties are ignored. They are possible in fantasy but rare enough that modelling
 * them would add a third outcome per game for almost no change in the shape.
 *
 * @param {number[]} probs win probability for each remaining game
 * @param {number} alreadyWon games already won
 * @returns {{wins:number, p:number}[]} one entry per reachable win total
 */
export function winTotalDistribution(probs, alreadyWon = 0) {
  const clean = (probs || []).filter((p) => Number.isFinite(p)).map((p) => Math.min(1, Math.max(0, p)));

  let dist = [1];
  for (const p of clean) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }

  const base = Number.isFinite(alreadyWon) ? alreadyWon : 0;
  return dist.map((p, k) => ({ wins: base + k, p }));
}

/** Expected wins — the sum of the probabilities, plus what is banked. */
export function expectedWins(probs, alreadyWon = 0) {
  const add = (probs || []).filter(Number.isFinite).reduce((a, p) => a + p, 0);
  return Math.round(((alreadyWon || 0) + add) * 10) / 10;
}

// ------------------------------------------------------- whole-season simulation
//
// Where a single team's win total has an exact answer (above), a FINAL PLACING
// does not. Placing depends on the joint outcome of every game in the league at
// once — your rivals' results move you without you playing — and on the
// tiebreak, which is total points scored. There is no closed form for that, so
// this plays the season out many times and counts.
//
// The run is deterministic for a given set of inputs. Re-rendering the page, or
// flipping to another team and back, must not quietly hand you different odds
// for the same season; that would make every number look like noise.

/** mulberry32: small, fast, and good enough for counting outcomes. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal by Box-Muller.
 *
 * Returns one value per call and keeps its twin for the next one, because
 * throwing half of every pair away doubles the cost of the whole simulation.
 */
export function makeNormal(rng) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

// ------------------------------------------------------------ playoff bracket
//
// The regular season decides an ORDER. The title is decided by a knockout on
// top of it, and the two are different questions — a team can top the table in
// four seasons out of ten and lift the trophy in one, because three one-week
// games are three coin flips with a thumb on the scale.
//
// The shape is read from the league where it can be. These are the fallbacks,
// and they are Tim's league's own ESPN settings (league 476225250, pasted from
// ESPN's Basic Settings page on 2026-09-16):
//
//     Playoff Teams: 6          Allow for Playoff Bracket Reseeding: Off
//     Weeks In Round 1 / Round 2 / Championship Round: 1 each
//     Playoff Seeding Tie Breaker: Total Points For
//     Playoff Home Field Advantage: None
//
// ESPN publishes all of this under `settings.scheduleSettings` as
// `playoffTeamCount`, `playoffMatchupPeriodLength` and `playoffReseed`
// (confirmed by probing public leagues 1241838 and 899513 on 2026-09-16 —
// 1241838 returns exactly 6 / 1 / false, 899513 returns 4 / 1 / false). Callers
// that can read those should pass them; a caller that cannot gets these
// numbers and must say on screen that it assumed them.
//
// CONSOLATION IS DELIBERATELY NOT MODELLED. The league runs a consolation
// ladder and Tim's rule is explicit: the wooden spoon is last in the REGULAR
// season, not last in the consolation bracket, and no game outside the
// championship bracket needs playing out. So the only knockout games simulated
// are the ones that can still produce a champion.

/** Tim's league, and the fallback when a league's own settings cannot be read. */
export const DEFAULT_PLAYOFF_TEAMS = 6;

/**
 * The first-round seed order of a standard single-elimination bracket.
 *
 * Built by repeated reflection: [1] -> [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6].
 * Read in pairs, that last one is 1v8, 4v5, 2v7, 3v6 — which is the bracket
 * everybody draws, with 1 and 2 landing in opposite halves so they can only
 * meet in the final.
 *
 * A field that is not a power of two is padded up to one, and the padding seeds
 * are PHANTOMS: a real seed drawn against a phantom has a bye. Six teams pad to
 * eight, so seeds 7 and 8 are phantoms and seeds 1 and 2 skip round one —
 * exactly the two byes ESPN's six-team bracket gives. Four teams pad to four
 * and nobody gets a bye. So "how many byes" is not a separate setting to get
 * wrong; it falls out of the field size.
 *
 * @param {number} fieldSize how many teams make the playoffs
 * @returns {number[]} seed numbers in bracket order, length a power of two
 */
export function bracketSeeds(fieldSize) {
  const k = Math.max(2, Math.floor(fieldSize) || 0);
  let size = 2;
  while (size < k) size *= 2;

  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

/**
 * How many rounds a field of this size needs.
 *
 * Derived, not configured. ESPN's settings page lists three round lengths for
 * a six-team bracket ("Round 1", "Round 2", "Championship"), which is the same
 * three log2(8) gives — so reading the count off the field size cannot drift
 * out of step with the field size the way a second setting could.
 */
export function playoffRoundCount(fieldSize) {
  return Math.round(Math.log2(bracketSeeds(fieldSize).length));
}

// -------------------------------------------------------------- final placing
//
// WHERE A TEAM FINISHES, which is a different question from where it finished
// in the regular-season table and was being answered with the table's answer.
// Tim, in his words: "right now the simulate season shows the data that
// corresponds to the regular season positions, not the playoffs. Positions 1-6
// should be based on the playoffs, and 7-10 should be based on the regular
// season. this is how the graph should be interpreted."
//
// So one placing per simulated season, built from two halves:
//
//   places 1..field   the bracket   — champion, beaten finalist, then the
//                                     losers of each earlier round, latest
//                                     round first
//   places field+1..N the table     — the teams that missed the bracket, in
//                                     regular-season order
//
// THE TWO HALVES CANNOT OVERLAP OR LEAVE A GAP, because the seeds ARE the top
// `field` of the table: the teams that miss the playoffs are exactly the bottom
// N - field of the standings, and the last of them is the worst team in the
// league — which is also Tim's definition of the loser. That agreement is
// asserted in simulateSeason() rather than being arranged by computing "last"
// twice; two ways of working out the wooden spoon is exactly how they start
// disagreeing.
//
// WITHIN A TIER, THE BETTER SEED IS PLACED HIGHER, AND THAT IS AN ASSUMPTION.
// Three one-week rounds settle who wins, who loses the final, who lost in round
// two and who lost in round one — but nothing in them separates 3rd from 4th or
// 5th from 6th. In the real league a consolation ladder does, and Tim was
// explicit that it is not to be simulated: "besides the [teams] who actually
// make the playoffs, you don't need to simulate any other games". So the seed
// breaks the tie — reseeding is off, so the seed IS the league's own ordering
// of those two teams — and the page says so out loud rather than letting a
// reader think 3rd-vs-4th was played out. It moves an average placing by at
// most half a place and moves nothing else at all.

/**
 * Play the rest of the season many times and count where everyone finishes.
 *
 * Each team's score in a game is drawn as its projection plus normal noise of
 * `sigma` — the same model the head-to-head win percentages use, so the two
 * agree with each other by construction rather than by coincidence.
 *
 * Points scored are simulated too, not just wins, because the league breaks a
 * tie on total points. Ranking on wins alone would invent ties that the real
 * standings would have separated.
 *
 * WHY AN EXACT REGULAR-SEASON TIE NEVER HAPPENS HERE, and why that is correct.
 * The league's setting is `Matchup Tie Breaker: No tie breakers`, so a tied
 * regular-season game really is a tie and really does go down as half a win
 * each. The model gives it probability zero: two scores drawn from a continuous
 * distribution are equal only on a set of measure zero, and in floating point
 * only on a coincidence of the last bits. That is not an oversight — a fantasy
 * score is quantised to a tenth of a point in real life, so real ties happen at
 * something like one game in a few hundred, which moves a season win total by
 * well under the counting noise of even 100,000 runs. The half-win branch below
 * is kept anyway so the rule is written down rather than merely improbable.
 *
 * A PLAYOFF tie cannot stand, because somebody has to advance. ESPN's own rule
 * is that the higher seed advances (support.espn.com, "Playoff Tiebreakers":
 * "The higher-seeded team advances", the default in both standard and League
 * Manager leagues). That is what `playoffs()` does. It is established rather
 * than assumed, and like the regular-season case it is a branch that will
 * essentially never be taken.
 *
 * WHAT A "PLACE" MEANS HERE. With a bracket, `places` is the FINAL placing —
 * the knockout for 1..field and the regular-season table below it, as set out
 * above `bracketSeeds`. The table's own placing is kept alongside as
 * `tablePlaces`, because topping the table and finishing 1st are two different
 * facts and the page shows both. With no bracket the two are identical, which
 * is how a caller that never asks for playoffs is left exactly as it was.
 *
 * @param {Object}   o
 * @param {number[]} o.teamIds
 * @param {Map}      o.banked      teamId -> {wins, pointsFor} already decided
 * @param {Array}    o.games       [{homeId, awayId, homeProj, awayProj}] still to play
 * @param {number}   o.sigma
 * @param {number}   [o.runs=10000]
 * @param {number}   [o.seed=1]
 * @param {Object}   [o.playoff]   null/omitted = no bracket, exactly as before.
 *   `{teams, weeks, proj}` — how many qualify, which scoring weeks the rounds
 *   fall in (one per round, longest-first order), and week -> Map(teamId ->
 *   projected points) for those weeks when ESPN published them.
 * @returns {Object|null}
 */
export function simulateSeason({
  teamIds, banked, games, sigma, runs = 10000, seed = 1, playoff = null,
}) {
  const ids = (teamIds || []).slice();
  const n = ids.length;
  if (!n || !Number.isFinite(sigma) || sigma <= 0) return null;

  const runCount = Math.max(1, Math.min(200000, Math.floor(runs) || 0));
  const index = new Map(ids.map((id, i) => [id, i]));

  const baseWins = new Float64Array(n);
  const basePf = new Float64Array(n);
  for (const id of ids) {
    const b = banked?.get(id);
    if (!b) continue;
    baseWins[index.get(id)] = b.wins || 0;
    basePf[index.get(id)] = b.pointsFor || 0;
  }

  // Only games both of whose projections are known can be played out. The rest
  // are reported rather than silently treated as though they do not exist.
  const home = [];
  const away = [];
  const homeProj = [];
  const awayProj = [];
  let skipped = 0;
  for (const g of games || []) {
    const h = index.get(g.homeId);
    const a = index.get(g.awayId);
    if (h === undefined || a === undefined ||
        !Number.isFinite(g.homeProj) || !Number.isFinite(g.awayProj)) {
      skipped++;
      continue;
    }
    home.push(h); away.push(a);
    homeProj.push(g.homeProj); awayProj.push(g.awayProj);
  }

  const gameCount = home.length;
  const rng = makeRng(seed);
  const normal = makeNormal(rng);

  // ---- the bracket, prepared once rather than per run ----------------------
  //
  // Everything here is a fact about the LEAGUE, not about one simulated season:
  // who plays whom in round one is fixed by seed, and only WHICH team holds
  // each seed changes run to run. So it is built once and indexed by seed
  // inside the loop.
  const bracket = playoff ? prepareBracket({
    ids, playoff, home, away, homeProj, awayProj,
  }) : null;

  // TWO PLACINGS, COUNTED SEPARATELY, because they answer two questions.
  //
  //   tableCounts — where the REGULAR-SEASON table put this team. Still what
  //                 "1st in table" and the wooden spoon are measured on, and
  //                 still what decides the seeds.
  //   placeCounts — where the team FINISHED: the hybrid described above.
  //
  // With no bracket there is nothing to hybridise and the two are the same
  // thing, so they are literally the same array — one increment, and a caller
  // that never asks for playoffs sees exactly the numbers it always saw.
  const tableCounts = Array.from({ length: n }, () => new Float64Array(n));
  const placeCounts = bracket ? Array.from({ length: n }, () => new Float64Array(n)) : tableCounts;
  const winTotals = new Float64Array(n);
  const wins = new Float64Array(n);
  const pf = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);

  // Bracket counters. seedCounts[team][seed-1] is how often that team took that
  // seed, which is what makes "seeds are computed per simulated season" a
  // testable claim rather than a promise.
  //
  // There is deliberately NO title counter and no finalist counter: the
  // champion is whoever the placing put 1st and the beaten finalist is whoever
  // it put 2nd, so those are read back off `places` below. A second counter for
  // a number the placing already holds is a second number that can drift.
  const madeCounts = bracket ? new Float64Array(n) : null;
  const byeCounts = bracket ? new Float64Array(n) : null;
  const seedCounts = bracket ? Array.from({ length: n }, () => new Float64Array(n)) : null;
  // Scratch, reused every run so a 100,000-run loop allocates nothing.
  const alive = bracket ? new Int32Array(bracket.size) : null;
  const seedOfTeam = bracket ? new Int32Array(n) : null;
  // Who lost in each round, so the tiers under the final can be placed. Round r
  // has at most `size / 2^(r+1)` games and therefore that many losers; a game
  // against a phantom produces none, which is exactly why a bye leaves a hole
  // in round one rather than a beaten team.
  const roundLosers = bracket
    ? Array.from({ length: bracket.rounds }, (_, r) => new Int32Array(bracket.size >> (r + 1)))
    : null;
  const roundLoserN = bracket ? new Int32Array(bracket.rounds) : null;

  // THE KNOCKOUT DRAWS FROM ITS OWN STREAM, and that is not fussiness. Sharing
  // the league's generator would mean every playoff game shifted the regular
  // season of the NEXT simulated year along by a couple of draws — so asking
  // for a bracket would quietly change the standings numbers beside it, and
  // switching the field size from six to four would move "expected wins" for
  // no reason a reader could ever guess at. Two streams, one seed: still
  // completely deterministic, and the two halves cannot contaminate each other.
  const poNormal = bracket ? makeNormal(makeRng((seed ^ 0x9e3779b9) >>> 0)) : null;

  for (let r = 0; r < runCount; r++) {
    wins.set(baseWins);
    pf.set(basePf);

    for (let g = 0; g < gameCount; g++) {
      const hs = homeProj[g] + sigma * normal();
      const as = awayProj[g] + sigma * normal();
      const h = home[g];
      const a = away[g];
      pf[h] += hs;
      pf[a] += as;
      if (hs > as) wins[h] += 1;
      else if (as > hs) wins[a] += 1;
      else { wins[h] += 0.5; wins[a] += 0.5; }   // vanishingly rare, but defined
    }

    for (let i = 0; i < n; i++) order[i] = i;
    // Wins first, then points scored — the league's own rule. This is also the
    // PLAYOFF SEEDING rule (ESPN: "Playoff Seeding Tie Breaker: Total Points
    // For"), so the seeds below are this same order read from the top, not a
    // second notion of who finished above whom.
    order.sort((x, y) => (wins[y] - wins[x]) || (pf[y] - pf[x]));
    for (let place = 0; place < n; place++) tableCounts[order[place]][place] += 1;
    for (let i = 0; i < n; i++) winTotals[i] += wins[i];

    // ---- and then the knockout ---------------------------------------------
    // Seeds are taken from THIS season's standings, not from today's, which is
    // the whole reason the bracket has to live inside the loop.
    if (bracket) {
      const K = bracket.field;
      for (let s = 0; s < K; s++) {
        const team = order[s];
        seedOfTeam[team] = s;                 // 0-based: seed 1 is index 0
        seedCounts[team][s] += 1;
        madeCounts[team] += 1;
      }
      // alive[i] holds the team sitting in bracket position i, or -1 for a
      // phantom seed (the padding that turns a six-team field into an
      // eight-slot bracket, and so hands seeds 1 and 2 their byes).
      for (let i = 0; i < bracket.size; i++) {
        const seat = bracket.order[i] - 1;    // seed number -> 0-based seed
        alive[i] = seat < K ? order[seat] : -1;
      }

      let width = bracket.size;
      roundLoserN.fill(0);
      for (let round = 0; round < bracket.rounds; round++) {
        const mean = bracket.roundMean[round];
        const beaten = roundLosers[round];
        for (let i = 0; i < width; i += 2) {
          const a = alive[i];
          const b = alive[i + 1];
          let winner;
          if (a < 0) winner = b;
          else if (b < 0) {
            winner = a;
            // A real team drawn against a phantom has a first-round bye. Only
            // round 0 can produce one — every later round's phantoms have
            // already been walked over. No loser is recorded: nobody was beaten.
            if (round === 0) byeCounts[a] += 1;
          } else {
            const sa = mean[a] + sigma * poNormal();
            const sb = mean[b] + sigma * poNormal();
            // Higher seed on an exact tie — ESPN's own rule. seedOfTeam is
            // 0-based, so the SMALLER number is the better seed.
            winner = sa > sb ? a : sb > sa ? b : (seedOfTeam[a] < seedOfTeam[b] ? a : b);
            beaten[roundLoserN[round]++] = winner === a ? b : a;
          }
          alive[i >> 1] = winner;
        }
        width >>= 1;
      }

      // ---- and now where everybody FINISHED --------------------------------
      //
      // Champion first, then each round's losers from the last round backwards:
      // the beaten finalist is 2nd, the teams knocked out a round earlier share
      // the next tier, and so on down to the round-one losers. Within a tier the
      // better seed is placed higher — see the note above `bracketSeeds`; those
      // games are not played here and the page says so.
      let place = 0;
      placeCounts[alive[0]][place++] += 1;
      for (let round = bracket.rounds - 1; round >= 0; round--) {
        const tier = roundLosers[round];
        const m = roundLoserN[round];
        // Insertion sort by seed. A tier is at most half the field — two teams
        // in Tim's six-team bracket — so this beats anything cleverer and,
        // unlike Array#sort, allocates nothing on a 100,000-run loop.
        // seedOfTeam is only written for teams IN the field, which is fine:
        // every team in a tier played a playoff game, so its seed is this
        // season's rather than a leftover from the last one.
        for (let i = 1; i < m; i++) {
          const v = tier[i];
          let j = i - 1;
          while (j >= 0 && seedOfTeam[tier[j]] > seedOfTeam[v]) { tier[j + 1] = tier[j]; j--; }
          tier[j + 1] = v;
        }
        for (let i = 0; i < m; i++) placeCounts[tier[i]][place++] += 1;
      }
      // A knockout among K teams produces exactly one champion and K-1 losers,
      // so `place` is now K and the rest of the league takes the table's order
      // from there down. That is what makes the two halves a permutation of
      // 1..N with no gap and no team counted twice.
      for (let s = place; s < n; s++) placeCounts[order[s]][s] += 1;
    }
  }

  // THE WOODEN SPOON, CHECKED RATHER THAN COMPUTED TWICE.
  //
  // The seeds are the top `field` of the table, so the teams left out of the
  // bracket are exactly the bottom N - field of it and the last place of the
  // final placing has to be the last place of the table. That is an invariant of
  // the loop above, not a property of the data — so it is asserted here, over
  // the finished counts, at a cost of N comparisons for the whole run.
  //
  // It throws rather than degrading quietly. Nothing a league can contain
  // reaches this; only a mistake in the placing can, and a wrong wooden spoon
  // printed confidently is worse for Tim than a panel that fails loudly.
  //
  // When every team qualifies (field === n) there is no such tie-in — the
  // bracket owns the bottom of the placing too — and "last in the table" and
  // "last overall" are then genuinely different questions. `pLast` stays the
  // table's answer either way, because that is Tim's rule.
  if (bracket && bracket.field < n) {
    for (let i = 0; i < n; i++) {
      if (placeCounts[i][n - 1] !== tableCounts[i][n - 1]) {
        throw new Error(
          'simulateSeason: the final placing and the regular-season table disagree about last place'
        );
      }
    }
  }

  const teams = ids.map((id, i) => {
    // THE FINAL PLACING — the bracket for 1..field, the table below that. This
    // is what every placing figure on the page reads, and with no bracket it is
    // the table, unchanged.
    const places = Array.from(placeCounts[i], (c) => c / runCount);
    // The regular-season table on its own. Still a real question — it decides
    // the seeds and it is where the wooden spoon is measured — so it keeps its
    // own array rather than being inferred back out of the placing.
    const tablePlaces = Array.from(tableCounts[i], (c) => c / runCount);
    let meanPlace = 0;
    let best = 0;
    for (let p = 0; p < n; p++) {
      meanPlace += places[p] * (p + 1);
      if (places[p] > places[best]) best = p;
    }
    return {
      teamId: id,
      places,                          // index 0 = chance of FINISHING first
      tablePlaces,                     // index 0 = chance of TOPPING THE TABLE
      meanPlace,
      modePlace: best + 1,
      // FIRST IN THE TABLE, which is not the title and is not 1st place. It
      // buys the top seed and nothing else. See `pTitle`.
      pFirst: tablePlaces[0],
      // LAST IN THE REGULAR-SEASON TABLE. Tim's rule, in his own words: "we
      // mark the loser as the person in last place by the end of the regular
      // season, not the playoffs". So this is deliberately untouched by the
      // bracket and owes nothing to the consolation ladder. It is also 10th in
      // the final placing — asserted above, not computed a second time.
      pLast: tablePlaces[n - 1],
      meanWins: winTotals[i] / runCount,
      // Bracket outcomes. All null when no bracket was asked for, so a caller
      // that does not want playoffs sees exactly what it always saw.
      //
      // The title IS first place and the final IS the top two places, so both
      // are read off the placing rather than counted again beside it.
      pTitle: bracket ? places[0] : null,
      pFinal: bracket ? places[0] + places[1] : null,
      pPlayoffs: bracket ? madeCounts[i] / runCount : null,
      pBye: bracket ? byeCounts[i] / runCount : null,
      // index 0 = chance of being the 1 seed. Only the first `field` entries
      // can be non-zero; the rest exist so the array lines up with `places`.
      seeds: bracket ? Array.from(seedCounts[i], (c) => c / runCount) : null,
    };
  });

  const byMean = teams.slice().sort((a, b) => a.meanPlace - b.meanPlace);
  // DELIBERATELY NOT CALLED `champion`. It used to be, and that was the
  // confusion this whole pass exists to remove: topping the table is not
  // winning the league. The champion is `titleFavourite`.
  const tableWinner = teams.slice().sort((a, b) => b.pFirst - a.pFirst)[0];
  const wooden = teams.slice().sort((a, b) => b.pLast - a.pLast)[0];
  const titleFavourite = bracket
    ? teams.slice().sort((a, b) => b.pTitle - a.pTitle)[0]
    : null;

  return {
    runs: runCount,
    games: gameCount,
    skipped,
    teams,
    byMean,
    tableWinner,
    wooden,
    titleFavourite,
    // Everything the page has to be able to say out loud about the bracket it
    // just played — including, when ESPN had no projection for a playoff week,
    // that the week was modelled rather than projected.
    playoff: bracket ? bracket.meta : null,
    sigma,
  };
}

/**
 * Work out the bracket once: its shape, and what each side is expected to score
 * in each round.
 *
 * THE PROJECTION HORIZON, which is the thing most likely to be wrong here.
 * ESPN publishes a per-player projection for every future week, and — probed on
 * 2026-09-16 against public leagues 1241838 and 899513 — that really does reach
 * the playoff weeks: weeks 15, 16 and 17 came back with a projection for
 * 100% of rostered players, and the numbers are genuinely per-week rather than
 * one figure repeated (only 1 player in 174 carried the same value across all
 * three, the same rate as any adjacent pair of regular-season weeks). So the
 * good case is the normal case: a playoff round uses ESPN's own number for the
 * week it falls in, exactly as a regular-season week does.
 *
 * When a week is missing anyway — the demo season has no roster endpoint, an
 * archived reading predates this feature, ESPN refuses a week — the round falls
 * back to the team's own mean projection over its remaining regular-season
 * games, with the same sigma around it. That is a weaker number and the caller
 * is told so in `meta.roundBasis` so it can say so on screen. It must never be
 * passed off as ESPN's.
 */
function prepareBracket({ ids, playoff, home, away, homeProj, awayProj }) {
  const n = ids.length;
  // A knockout needs two teams to knock out. A one-team league is not a real
  // case, but the field size is clamped UP to two below, so without this the
  // bracket would seat a team that does not exist and place a NaN.
  if (n < 2) return null;
  const field = Math.max(2, Math.min(n, Math.floor(playoff.teams) || 0));
  const order = bracketSeeds(field);
  const size = order.length;
  const rounds = Math.round(Math.log2(size));

  // The fallback mean: what this team is projected to score in a typical week
  // still to come. Built from the same remaining-game projections the regular
  // season is simulated from, so a modelled playoff week and a projected one
  // are at least on the same scale.
  const total = new Float64Array(n);
  const count = new Float64Array(n);
  for (let g = 0; g < home.length; g++) {
    total[home[g]] += homeProj[g]; count[home[g]] += 1;
    total[away[g]] += awayProj[g]; count[away[g]] += 1;
  }
  const fallback = new Float64Array(n);
  let known = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (count[i] > 0) { fallback[i] = total[i] / count[i]; known++; sum += fallback[i]; }
  }
  // A team with no remaining games at all (rare: a bye-heavy fixture list, or a
  // season simulated from its final week) gets the league's own average rather
  // than a zero, because a zero would quietly guarantee it loses every playoff
  // game it reached.
  const leagueMean = known ? sum / known : 0;
  for (let i = 0; i < n; i++) if (count[i] === 0) fallback[i] = leagueMean;

  const weeks = Array.isArray(playoff.weeks) ? playoff.weeks.slice(0, rounds) : [];
  const roundMean = [];
  const roundBasis = [];
  for (let r = 0; r < rounds; r++) {
    const week = weeks[r];
    const forWeek = week != null ? playoff.proj?.get?.(week) : null;
    const mean = new Float64Array(n);
    let covered = 0;
    if (forWeek) {
      for (let i = 0; i < n; i++) {
        const v = forWeek.get(ids[i]);
        if (Number.isFinite(v) && v > 0) { mean[i] = v; covered++; }
      }
    }
    // All or nothing per round. Half a round of real projections against half a
    // round of averages would put two teams on different footings in the same
    // game, which is worse than putting both on the weaker one.
    if (covered === n) {
      roundMean.push(mean);
      roundBasis.push('projected');
    } else {
      roundMean.push(fallback);
      roundBasis.push('modelled');
    }
  }

  const projectedRounds = roundBasis.filter((b) => b === 'projected').length;

  // A round that has to fall back needs something to fall back TO. With no
  // remaining regular-season game carrying a projection there is no such
  // number, and every side would be drawn around the same zero — a title
  // decided purely by noise, which is worse than no title at all. A bracket
  // whose every round is projected does not need the fallback and is built
  // regardless: a season decided down to its last week still has playoffs.
  if (projectedRounds < rounds && !known) return null;

  return {
    field, order, size, rounds, roundMean,
    meta: {
      teams: field,
      rounds,
      byes: size - field,          // seeds 1..(size-field) skip round one
      weeks: weeks.slice(0, rounds),
      roundBasis,
      basis: projectedRounds === rounds ? 'projected'
        : projectedRounds === 0 ? 'modelled'
        : 'mixed',
      reseed: false,               // ESPN: "Allow for Playoff Bracket Reseeding: Off"
      seedingTiebreak: 'points for',
      tieRule: 'higher seed advances',
      // How the final placing was built, so the page can say it rather than
      // imply it. `placesFromBracket` is also how many teams qualify — they are
      // the same number by construction, and naming it twice here is what lets
      // the note talk about "places 1-6" without re-deriving the six.
      placesFromBracket: field,
      // THE ASSUMPTION, CARRIED OUT OF THE MODEL. Nothing simulated separates
      // 3rd from 4th or 5th from 6th; the seed does. Tim may want to confirm it.
      withinTierRule: 'seed',
    },
  };
}

/**
 * The narrowest run of win totals holding at least `mass` of the probability.
 *
 * A single most-likely value badly undersells the uncertainty here — with 13
 * coin flips the modal outcome often carries under a quarter of the weight —
 * so the page quotes a range instead.
 */
export function credibleRange(dist, mass = 0.8) {
  if (!dist || !dist.length) return null;
  let best = null;
  for (let i = 0; i < dist.length; i++) {
    let sum = 0;
    for (let j = i; j < dist.length; j++) {
      sum += dist[j].p;
      if (sum >= mass) {
        const width = j - i;
        if (!best || width < best.width) {
          best = { lo: dist[i].wins, hi: dist[j].wins, p: sum, width };
        }
        break;
      }
    }
  }
  return best;
}
