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
