// Which games swing a season: one team's title chance and last-place chance if
// a given game is won, against the same two if it is lost.
//
// Pure functions only — no DOM, no fetching. The Schedule page's "My season"
// table calls this once per game still to play.
//
// HOW A GAME IS FORCED. The season is simulated twice with that one game marked
// `forced` (js/forecast.js, `simulateSeason`): once as a win for the team, once
// as a loss. Both runs use the same seed, and a forced game takes the same
// draws as an unforced one, so every OTHER game in the league is played out
// identically in the two. The difference between them is then the game itself
// and not two different sets of luck — the Trade page's common-random-numbers
// idea (js/trade-odds.js), applied to a result instead of a roster.
//
// Regular season only: a playoff game has no fixed opponent to force.

import { simulateSeason } from './forecast.js';

/**
 * Seasons per forced run. Measured on league 1241838 (10 teams, 50 games left,
 * 2026-10-06, one team's ten games on twelve seeds), a swing's spread seed to
 * seed, in percentage points (1 SD, mean / worst game):
 *
 *     2,000   title 0.45 / 0.65   last 0.68 / 0.93
 *     5,000   title 0.27 / 0.37   last 0.36 / 0.47
 *    10,000   title 0.16 / 0.22   last 0.34 / 0.41
 *
 * The spread grows with the swing itself — roughly sqrt(swing / runs), so a
 * bottom team whose game moves last place by 30 points wobbles by 0.5 at
 * 10,000 and 0.95 at 5,000 (tests/test-must-win.mjs). 10,000 keeps every case
 * well under a point. A run took about 110 ms that day and a ten-game run-in
 * is twenty of them, which is why the page takes one run per task.
 */
export const SWING_RUNS = 10000;

/** Which side of `game` is `teamId`, or null when it is not in it. */
const sideOf = (game, teamId) =>
  game.homeId === teamId ? 'home' : game.awayId === teamId ? 'away' : null;

/**
 * Can this game's result be forced for this team? Not when a projection is
 * missing, and not once its week is under way (`homeLeft` / `awayLeft`): a game
 * in progress is blank on the page.
 */
export function canForce(game, teamId) {
  if (!game || sideOf(game, teamId) === null) return false;
  if (!Number.isFinite(game.homeProj) || !Number.isFinite(game.awayProj)) return false;
  return game.homeLeft === undefined && game.awayLeft === undefined;
}

/**
 * The index in `games` of this team's game in `week`, or -1.
 *
 * @param {Array} games `capture.simulationInputs().games`
 */
export function gameIndex(games, teamId, week) {
  return (games || []).findIndex((g) => g.week === week && sideOf(g, teamId) !== null);
}

/** One simulated season set with game `index` forced to `side`. */
function forcedRun(inputs, index, side, runs, seed) {
  const games = inputs.games.slice();
  games[index] = { ...games[index], forced: side };
  return simulateSeason({
    teamIds: inputs.teamIds,
    banked: inputs.banked,
    games,
    sigma: inputs.sigma,
    runs,
    seed,
    playoff: inputs.playoff,
  });
}

/** One team's two chances out of a simulation result. Title is null with no bracket. */
function chancesOf(result, teamId) {
  const row = result && result.teams.find((t) => t.teamId === teamId);
  if (!row) return null;
  return { title: Number.isFinite(row.pTitle) ? row.pTitle : null, last: row.pLast };
}

/**
 * One half of a swing: the team's chances with the game forced one way.
 * The page runs the two halves in separate tasks so neither holds a frame long.
 *
 * @param {Object}  inputs `capture.simulationInputs()`: teamIds, banked, games, sigma, playoff
 * @param {*}       teamId
 * @param {number}  index  into `inputs.games`
 * @param {boolean} win    true = the team wins it
 * @returns {{title:number|null, last:number}|null}
 */
export function chancesIf(inputs, teamId, index, win, { runs = SWING_RUNS, seed = 1 } = {}) {
  const game = inputs && inputs.games ? inputs.games[index] : null;
  if (!canForce(game, teamId)) return null;
  const mine = sideOf(game, teamId);
  const side = win ? mine : mine === 'home' ? 'away' : 'home';
  return chancesOf(forcedRun(inputs, index, side, runs, seed), teamId);
}

/**
 * How many seasons the page plays per task. SWING_RUNS in one go held the page
 * for a quarter of a second at a time, twenty times over (measured in headless
 * Chrome, 2026-10-06); in slices the reader can scroll while the cells fill.
 * Slice k of a win and slice k of the loss share a seed, so slicing costs the
 * shared draws nothing.
 */
export const SWING_SLICE = 1000;

/**
 * Equal-sized slices of one forced run, put back together: the mean of each
 * chance, which is the count over all of them.
 */
export function pooled(parts) {
  const list = (parts || []).filter(Boolean);
  if (!list.length) return null;
  const mean = (key) => list.reduce((a, c) => a + c[key], 0) / list.length;
  return { title: list.some((c) => c.title === null) ? null : mean('title'), last: mean('last') };
}

/**
 * Win and loss put together: `title` and `last` are win minus loss, so a game
 * that matters has a positive title swing and a negative last swing.
 */
export function swingOf(win, loss, runs = SWING_RUNS) {
  if (!win || !loss) return null;
  return {
    win,
    loss,
    title: win.title === null || loss.title === null ? null : win.title - loss.title,
    last: win.last - loss.last,
    runs,
  };
}

/** Both halves at once. */
export function gameSwing(inputs, teamId, index, opts = {}) {
  const runs = opts.runs ?? SWING_RUNS;
  return swingOf(
    chancesIf(inputs, teamId, index, true, opts),
    chancesIf(inputs, teamId, index, false, opts),
    runs
  );
}
