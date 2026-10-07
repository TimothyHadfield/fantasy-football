// League statistics.
//
// These formulas come from Tim's 2025 Google Sheet. Most were reverse-engineered
// from a PDF of it; the last five were read directly out of the sheet's xlsx
// export on 2026-09-08 and are marked with the cell they came from. Everything
// below is CONFIRMED — it reproduces the sheet's own numbers. See PROGRESS.md.
//
// Input shape (produced by demo.js, and eventually by espn.js):
//   { season, weeks, teams: [{id, name}], games: [...], injuries: [...] }

// ------------------------------------------------------------- small helpers

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Quartile using the inclusive method, which is what Excel's QUARTILE.INC and
 * Google Sheets' QUARTILE both use. Matching this matters — the sheet's box
 * charts were built in Sheets.
 */
export function quartile(sortedValues, p) {
  const n = sortedValues.length;
  if (!n) return 0;
  if (n === 1) return sortedValues[0];

  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (pos - lo) * (sortedValues[hi] - sortedValues[lo]);
}

/**
 * Sample standard deviation, or null when a single value cannot have one.
 *
 * It used to return 0, which the page printed as "Std Dev 0.0" — indis-
 * tinguishable from a genuinely metronomic team, when all it meant was that
 * one week had been played. Callers render null as a dash.
 */
export function stdev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

/**
 * How much luck decided a single game, from its final margin.
 *
 * CONFIRMED — this is the sheet's third Score Differential column, recovered
 * verbatim from the xlsx:
 *   =MIN(MAX((150/margin) - 7*SIGN(margin), -50), 50)
 *
 * Observed behaviour: the shape is inverse, so a one-point game returns a
 * near-maximal +/-50 while a 71-point blowout returns about -4.9. The -7*SIGN
 * term makes it cross zero around a 21-point margin, past which a comfortable
 * win scores as *negative* luck.
 *
 * The reasoning behind 150, -7 and the +/-50 clamp is Tim's and he has not
 * explained it yet. Do not infer it, retune it, or "simplify" it — reproduce it
 * exactly until he does.
 *
 * Returns null for a tied game, where the sheet itself shows #DIV/0!. What a
 * tie then COUNTS as is `closeLuckOf`, below.
 */
export function gameLuck(margin) {
  if (!margin) return null;
  const s = margin > 0 ? 1 : -1;
  return Math.min(Math.max((150 / margin) - 7 * s, -50), 50);
}

/**
 * Five-number summary plus Tukey outlier fences at 1.5 x IQR.
 * CONFIRMED: reproduces the sheet's "Under 49 / Over 183" for actual scores
 * (Q1 99, Q3 133, IQR 34) and "Under 95 / Over 151" for projected.
 *
 * Below `minCount` values there is no distribution to summarise — quartiles of
 * two numbers are just those two numbers wearing a box, and the chart drew them
 * as 1.5px slivers — so this returns null and charts.js falls through to its
 * empty state. It bites on a single team in week 1; the league-wide boxes see
 * one score per team per week and clear the floor immediately.
 */
export function boxStats(values, minCount = 5) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length < minCount) return null;
  const q1 = quartile(s, 0.25);
  const median = quartile(s, 0.5);
  const q3 = quartile(s, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  return {
    min: s[0],
    q1, median, q3,
    max: s[s.length - 1],
    iqr,
    lowerFence,
    upperFence,
    outliers: s.filter((v) => v < lowerFence || v > upperFence),
  };
}

/**
 * A game's close-game luck as every average counts it: a tie is 0.
 *
 * ONE RULE FOR A TIE (2026-10-06). A tie is half a win and half a loss — that
 * is how the standings rank it — and the formula above runs to +50 for the
 * narrowest win and −50 for the narrowest loss, so half of each is nothing. It
 * is still a game played, so it is in the count the average divides by. Close
 * luck, the Luck score, the cumulative series, the ± margins and the week-by-
 * week grid all go through here; before, the Luck score left a tie out of the
 * count while the weekly cells counted it as 0, and a team with a tie had
 * weeks that did not average to its own Luck score.
 */
export const closeLuckOf = (row) => row.gameLuck ?? 0;

// ------------------------------------------------------- per-team weekly rows

/**
 * Flatten the game list into one row per team per week, with the opponent's
 * numbers attached so every downstream metric can be computed locally.
 *
 * CONFIRMED: luck = actual - projected
 * CONFIRMED: actualDiff = own actual - opponent actual
 * CONFIRMED: projectedDiff = own projected - opponent projected
 *
 * UNROUNDED (2026-10-06). The four differences used to be stored to a tenth,
 * and every season figure built on them — Luck/wk, PTW, the Luck score, S+L —
 * was then an average of rounded numbers: a tenth off what the scores on the
 * page give by hand. Rounding is for the cell that prints the number.
 *
 * A GAME WHOSE PROJECTIONS COULD NOT BE READ (2026-10-06). js/season.js hands
 * on every decided game, and one from a week whose lineups ESPN would not
 * return carries projection 0 on both sides. That is "none", not a forecast of
 * nothing: set against it, a 120-point week was 120 points of luck. So for
 * such a game `projected`, `oppProjected`, `luck`, `oppLuck` and
 * `projectedDiff` are null, and everything built on them — `readRows` below —
 * leaves the game out. Its score, margin, result and close-game figure need no
 * projection and are whole.
 */
const projectionRead = (side) => side.projected > 0 && side.oppProjected > 0;

/** The rows of a team's season whose projections were read: what luck is formed from. */
const readRows = (weekly) => weekly.filter((w) => w.luck !== null);

function buildWeeklyRows(data) {
  const rows = new Map(); // teamId -> array of weekly rows
  for (const t of data.teams) rows.set(t.id, []);

  for (const g of data.games) {
    const pair = [
      { id: g.homeId, actual: g.homeActual, projected: g.homeProjected,
        oppId: g.awayId, oppActual: g.awayActual, oppProjected: g.awayProjected },
      { id: g.awayId, actual: g.awayActual, projected: g.awayProjected,
        oppId: g.homeId, oppActual: g.homeActual, oppProjected: g.homeProjected },
    ];

    for (const side of pair) {
      const read = projectionRead(side);
      rows.get(side.id).push({
        week: g.week,
        actual: side.actual,
        projected: read ? side.projected : null,
        luck: read ? side.actual - side.projected : null,
        oppId: side.oppId,
        oppActual: side.oppActual,
        oppProjected: read ? side.oppProjected : null,
        oppLuck: read ? side.oppActual - side.oppProjected : null,
        actualDiff: side.actual - side.oppActual,
        projectedDiff: read ? side.projected - side.oppProjected : null,
        // CONFIRMED: the sheet's third Score Differential column.
        gameLuck: gameLuck(side.actual - side.oppActual),
        won: side.actual > side.oppActual,
        tied: side.actual === side.oppActual,
      });
    }
  }

  for (const arr of rows.values()) arr.sort((a, b) => a.week - b.week);
  return rows;
}

// --------------------------------------------------------------- team metrics

/**
 * One week's share of the luck score, and the three parts it is made of
 * (Tim, 2026-10-05: "Opponent scoring, close game, and act-proj all go into
 * this weekly number").
 *
 *   Luck score = leagueAvg − mean(oppActual − luck) + mean(gameLuck)
 *
 * (before the single-week limit, `WEEK_LUCK_LIMIT`, which changes what a week
 * COUNTS toward the season and never what this returns) so week by week it is (leagueAvg − oppActual) + (actual − projected) +
 * gameLuck, and a team's weeks average back to its Luck score. The league
 * average is the season's, the one the Luck score itself uses — not that
 * week's — or the weeks would not add up to it. A tied game has no close-game
 * figure of its own (`close: null`, so a hover can say "tie") and counts 0
 * towards the total — `closeLuckOf`, the one rule the Luck score uses too.
 *
 * A week whose projections could not be read has no Act−Proj part and so no
 * total (both null); the Luck score leaves the same week out, so the weeks
 * that do have a total still average to it.
 */
export function weekLuckParts(row, leagueAvgActual) {
  const proj = row.luck === null ? null : row.actual - row.projected;
  const opp = leagueAvgActual - row.oppActual;
  const close = row.gameLuck;
  return { proj, opp, close, total: proj === null ? null : proj + opp + closeLuckOf(row) };
}

/**
 * THE SINGLE-WEEK LIMIT (Tim, 2026-10-06). "A single unlucky event … shouldn't
 * be able to affect your entire luck ranking for the season", and of the size:
 * "lets just round it out to a limit of +- 50". So one week's TOTAL luck — the
 * three parts added up — counts at most this far from zero toward the season
 * Luck score. A fixed number around zero: no spread, no fences, no drift.
 *
 * It is a rule about how weeks are COMBINED, never about what a week scores:
 * `gameLuck`, its own ±50 clamp and `weekLuckParts` are untouched, and every
 * weekly cell prints its real number. A full close game (±50 on its own) still
 * counts whole; only a week where several things pile up is held back.
 */
export const WEEK_LUCK_LIMIT = 50;

/** What a week's total luck COUNTS as toward the season: held within the limit. */
export const countedWeekLuck = (total) =>
  (total === null ? null : Math.min(Math.max(total, -WEEK_LUCK_LIMIT), WEEK_LUCK_LIMIT));

/** How far the limit moves a week: counted − real. Exactly 0 inside the limit. */
const limitShift = (total) => countedWeekLuck(total) - total;

/** The unrounded league average score over every team-week played. */
export function leagueAvgActualOf(teams) {
  const all = [];
  for (const t of teams) for (const r of t.weekly) all.push(r.actual);
  return mean(all);
}

/**
 * The sheet's "Cumulative Luck (adjusted formula)" series, one value per week,
 * each computed from weeks 1..w rather than from that week alone.
 *
 * CONFIRMED:  luck(w) = leagueAvgActual(1..w) - PTW(1..w) + SD(1..w)
 *
 * Per Tim, this is not a metric of its own — it is just LUCK evaluated at each
 * week, since LUCK already folds in every week to date. The point of plotting
 * it is the convergence: if luck really is random, every team's line should
 * trend toward zero as the season lengthens, and the spread between them should
 * shrink. That is what the sheet's STDEV row underneath was demonstrating.
 *
 * Recovered by residual analysis against the sheet's own 130 values: with this
 * shape, the leftover term is identical across all ten teams to 15 significant
 * figures, which is what pins it down.
 *
 * One deliberate difference from the sheet. Tim hardcoded the league-average
 * term as a typed constant and updated it only occasionally — 122.7 for weeks
 * 1-8, 121.4 for 9-10, 121.8 for 11-13 — and by week 13 it had drifted 4.64
 * points above the league's actual average of 117.16. We compute it from the
 * data instead, so our numbers sit a few points below the sheet's while the
 * ordering, which is all LS and PS depend on, is unchanged.
 */
function cumulativeLuckSeries(weekly, cumulativeLeagueAvgActual) {
  const out = [];
  const read = readRows(weekly);
  let oppTotal = 0;
  let luckTotal = 0;
  let closeTotal = 0;

  // Only the weeks luck can be formed for: a week with no projection adds no
  // point to the line rather than a false one.
  read.forEach((w, i) => {
    oppTotal += w.oppActual;
    luckTotal += w.luck;
    closeTotal += closeLuckOf(w);

    const n = i + 1;
    const ptw = oppTotal / n - luckTotal / n;
    const sd = closeTotal / n;
    const league = cumulativeLeagueAvgActual.get(w.week) ?? 0;

    // THE SINGLE-WEEK LIMIT, AS IT STOOD THAT WEEK. Each point is the Luck
    // score of weeks 1..w, so each of those weeks is held within the limit as
    // its luck read THEN — against the league average of weeks 1..w, the one
    // this point uses. It is what Summary prints with its week picker on w,
    // and the last point is the Luck score. Written as "what the limit took
    // off" so that with no week over it not a digit of the old line changes.
    let shift = 0;
    for (let k = 0; k <= i; k++) shift += limitShift(weekLuckParts(read[k], league).total);

    out.push({ week: w.week, value: round1(league - ptw + sd + shift / n) });
  });

  return out;
}

function teamMetrics(team, weekly, leagueAvgProjected, leagueAvgActual, cumulativeLeagueAvgActual) {
  const actuals = weekly.map((w) => w.actual);
  const oppActuals = weekly.map((w) => w.oppActual);

  // WHAT NEEDS A PROJECTION IS FORMED FROM THE GAMES THAT HAVE ONE (`readRows`):
  // Proj, Luck/wk, PTW, the Luck score, Skill and S+L. With every week read
  // that is the whole season and nothing differs. `blind` is a team that has
  // played and has no such game at all: those figures are then null — a dash —
  // never an average of nothing. (A team with no game yet keeps the zeros it
  // always had; the page dashes it by its empty `weekly`.)
  const read = readRows(weekly);
  const blind = weekly.length > 0 && !read.length;
  const orNull = (v) => (blind ? null : v);
  const projecteds = read.map((w) => w.projected);
  const oppProjecteds = read.map((w) => w.oppProjected);
  const avgLuck = mean(read.map((w) => w.luck));
  const readOppAvg = mean(read.map((w) => w.oppActual));

  const pointsFor = sum(actuals);
  const pointsAgainst = sum(oppActuals);
  const n = weekly.length || 1;

  // CONFIRMED: PTW = opponent avg actual - own avg luck. Recovered verbatim
  // from the sheet as `=AU3-AR3`. It reads as "the score you would have needed
  // to beat your average opponent, once your own luck is taken back out".
  const pointsToWin = orNull(readOppAvg - avgLuck);

  // CONFIRMED: SD averages the per-game luck figure over the season. A tied
  // game is 0 and still a game (`closeLuckOf`) rather than poisoning the
  // average — the sheet shows #DIV/0! for Miles, who had one. Null only when
  // no game has been decided at all. It needs no projection, so it counts
  // every game; the Luck score below takes its close-game part from the games
  // it is itself formed from, which is the same number whenever all were read.
  const decided = weekly.some((w) => w.gameLuck !== null);
  const scoreDiffLuck = decided ? mean(weekly.map(closeLuckOf)) : null;
  const readClose = read.some((w) => w.gameLuck !== null) ? mean(read.map(closeLuckOf)) : null;

  // CONFIRMED: `=121.8-(AX3-AY3)`, i.e. leagueAvgActual - (PTW - SD). This is
  // the standings LUCK column, and it equals the final cumulative-luck value.
  //
  // …LESS WHAT THE SINGLE-WEEK LIMIT HOLDS BACK (`WEEK_LUCK_LIMIT`). The line
  // above is exactly the mean of the weekly totals (`weekLuckParts`), so the
  // mean of the COUNTED weeks is that plus the mean of (counted − real), and
  // with no week over the limit the second term is an exact 0: nothing moves.
  // Each row keeps both figures so every reader takes the same ones.
  for (const w of weekly) {
    w.weekLuck = weekLuckParts(w, leagueAvgActual).total;
    w.weekLuckCounted = countedWeekLuck(w.weekLuck);
  }
  const limit = read.length ? mean(read.map((w) => w.weekLuckCounted - w.weekLuck)) : 0;
  const luckScore = orNull(leagueAvgActual - (pointsToWin - (readClose ?? 0)) + limit);
  const skill = orNull(mean(projecteds) - leagueAvgProjected);
  const actualStdev = stdev(actuals);
  const r1 = (v) => (v === null ? null : round1(v));

  return {
    id: team.id,
    name: team.name,
    weekly,

    // Averages and totals — CONFIRMED against the sheet's Avg/Total columns.
    avgActual: round1(mean(actuals)),
    avgProjected: r1(orNull(mean(projecteds))),
    avgLuck: r1(orNull(avgLuck)),
    // One decimal, like ESPN's own "PF" (1845.6, not 1846). The whole-number
    // version tied 128.66 with 129.02 and put them in the wrong order.
    totalActual: round1(pointsFor),
    totalProjected: blind ? null : Math.round(sum(projecteds)),

    // Opponent block — CONFIRMED.
    oppAvgActual: round1(mean(oppActuals)),
    oppAvgProjected: r1(orNull(mean(oppProjecteds))),
    oppAvgLuck: r1(orNull(mean(read.map((w) => w.oppLuck)))),

    // CONFIRMED: the sheet's "F-A" is per-week average, not the season total.
    // (Autumn: (1467 - 1530) / 13 = -4.8, shown as -5.)
    // Unrounded: points for is the standings tie-breaker (here and in
    // stats-page.js's record sort), and a rounded one ties teams ESPN separates.
    // Displayed through `totalActual` above, at one decimal.
    pointsFor,
    pointsAgainst: round1(pointsAgainst),
    forMinusAgainst: round1((pointsFor - pointsAgainst) / n),

    // CONFIRMED: skill = own avg projected - league avg projected.
    // Verified on all ten teams in the 2025 sheet.
    skill: r1(skill),

    wins: weekly.filter((w) => w.won).length,
    losses: weekly.filter((w) => !w.won && !w.tied).length,
    ties: weekly.filter((w) => w.tied).length,

    // Spread of weekly scores — CONFIRMED (box chart section of the sheet).
    // All three are null until there are enough weeks to have a spread at all.
    actualBox: boxStats(actuals),
    projectedBox: boxStats(projecteds),
    actualStdev: actualStdev === null ? null : round1(actualStdev),

    // --- Recovered from the sheet's xlsx on 2026-09-08. See PROGRESS.md. ---
    pointsToWin: r1(pointsToWin),                           // "PTW"
    scoreDiffLuck: scoreDiffLuck === null ? null : round1(scoreDiffLuck), // "SD"
    luckScore: r1(luckScore),                               // "LUCK"
    cumulativeLuck: cumulativeLuckSeries(weekly, cumulativeLeagueAvgActual),
    skillPlusLuck: r1(orNull(skill + luckScore)),           // "S+L"

    // Unrounded copies. Everything above is rounded for display, but two teams
    // can sit thousandths apart in S+L — Stevenson and Mitch did in 2025 — and
    // ranking the rounded values would swap them. Standings sort on these.
    exact: { skill, luckScore, skillPlusLuck: orNull(skill + luckScore), pointsToWin, pointsFor },

    // WHAT THE LUCK FIGURES ARE FORMED FROM, unrounded, for the page's preview
    // of a season cell: Luck score = league − opp + luck + close, PTW = opp −
    // luck, Skill = proj − leagueProj. `opp` and `close` are over the games the
    // Luck score counts, so they are the Opp Avg and Close luck columns
    // whenever every week's projections were read. Null for a `blind` team.
    parts: blind ? null : {
      league: leagueAvgActual,
      opp: readOppAvg,
      luck: avgLuck,
      close: readClose ?? 0,
      // What the single-week limit moved the Luck score by (0 when no week is
      // over it): league − opp + luck + close + limit is the Luck score.
      limit,
      proj: mean(projecteds),
      leagueProj: leagueAvgProjected,
    },
  };
}

// Injury losses are deliberately NOT computed. Tim's sheet has two empty tables
// for them; the site leaves the feature out. Keeping his method here in case it
// ever comes back: for a manager holding an injured player, compare their team
// projection after the injury against what it would have been with that player
// available, assuming the player would have projected near their own season
// average. The gap is the loss. Automating it needs per-week injury status plus
// each player's season-average projection — ESPN has both, via mRoster per week
// and kona_player_info — and a decision on suspensions, which Tim counted too.

// ------------------------------------------------------------ league metrics

/**
 * How often the projection picked the actual winner, bucketed by how large the
 * projected margin was.
 *
 * CONFIRMED as a concept against the sheet's "Prediction Accuracy" block, which
 * reported 65 games overall at 0.69, and tighter buckets at larger margins.
 */

// A PERCENTAGE ON EVERY BUCKET THAT HAS A GAME. Tim, 2026-10-06: "show the
// accuracy % for all rows, not just the 'all' section. I don't care if there's
// only been like 1 game there." It was withheld under twenty games; the Games
// and Correct columns beside it say how much it rests on.
const MIN_GAMES_FOR_ACCURACY = 1;

export function predictionAccuracy(games, thresholds = [0, 5, 10, 15, 20, 25, 30]) {
  // A game where both teams carry the same projection makes no prediction at
  // all, so it can be neither right nor wrong. Those are excluded from every
  // bucket and counted separately rather than being quietly dropped.
  //
  // A game whose projections could not be read (0 on a side — see
  // `buildWeeklyRows`) made no prediction either, and is not a "tie" between
  // two projections: it is in no bucket and not in that count.
  const read = games.filter((g) => g.homeProjected > 0 && g.awayProjected > 0);
  const predictive = read.filter((g) => g.homeProjected !== g.awayProjected);
  const ties = read.length - predictive.length;

  const buckets = thresholds.map((t) => {
    const relevant = predictive.filter(
      (g) => Math.abs(g.homeProjected - g.awayProjected) > t
    );
    const correct = relevant.filter((g) => {
      const projHome = g.homeProjected > g.awayProjected;
      const actualHome = g.homeActual > g.awayActual;
      return projHome === actualHome;
    });
    return {
      threshold: t,
      label: t === 0 ? 'All' : `>${t}`,
      games: relevant.length,
      correct: correct.length,
      accuracy: relevant.length >= MIN_GAMES_FOR_ACCURACY
        ? correct.length / relevant.length
        : null,
    };
  });

  buckets.tiedProjections = ties;
  return buckets;
}

// ------------------------------------------- projected against actual (dots)
//
// The two scatter graphs on the Stats page (Tim, 2026-10-04): one dot per team
// per finished week, and one per player per finished week. Both are pure, so
// the page only has to turn an id into a link.

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * One point per team per finished week: x = what the lineup it STARTED was
 * projected to score, y = what it scored.
 *
 * Read off the weekly rows `computeLeagueStats` already built — the same
 * numbers as the Proj and Avg columns, Weekly luck and Projection accuracy, so
 * the graph cannot disagree with them. A week with no projection (ESPN returned
 * none, stored as 0) is skipped rather than plotted on the axis.
 *
 * @param {Object} stats  from `computeLeagueStats`
 * @returns {Array<{teamId, name, week, x, y}>}
 */
export function teamFitPoints(stats) {
  const out = [];
  for (const t of (stats && stats.teams) || []) {
    for (const row of t.weekly || []) {
      if (!finite(row.projected) || !finite(row.actual) || !(row.projected > 0)) continue;
      out.push({ teamId: t.id, name: t.name, week: row.week, x: row.projected, y: row.actual });
    }
  }
  return out;
}

/**
 * One point per rostered player per finished week, starters and bench alike:
 * x = ESPN's projection for him that week, y = what he scored.
 *
 * SKIPPED: a man with no projection or no score (null — not zero), and a man
 * projected 0 who scored 0. That last one is a bye, or a player ruled out: he
 * was not projected to play and did not, which is no test of a projection, and
 * a few hundred of them stacked on the origin would drag the fitted line onto
 * the perfect one for free.
 *
 * @param {Map<number, Array>} weekTeams  week -> that week's teams, each with
 *                                        `players` (season.fetchWeeksRosters)
 * @param {number[]} weeks                the finished weeks to plot
 * @returns {Array<{playerId, name, position, proTeam, teamId, week, x, y}>}
 */
export function playerFitPoints(weekTeams, weeks) {
  const out = [];
  if (!weekTeams || typeof weekTeams.get !== 'function') return out;
  for (const week of weeks || []) {
    for (const team of weekTeams.get(week) || []) {
      const players = Array.isArray(team.players)
        ? team.players
        : [...(team.starters || []), ...(team.bench || [])];
      for (const p of players) {
        if (!p) continue;
        // A man finished in a week still open (`done`, js/season.js) carries his
        // SCORE as `projected`; what ESPN projected is `pregame`. Without one
        // there is no dot — never a score set against itself.
        const x = p.done === true ? p.pregame : p.projected;
        if (!finite(x) || !finite(p.actual)) continue;
        if (x === 0 && p.actual === 0) continue;
        out.push({
          playerId: p.playerId,
          name: p.name || '',
          position: p.position || '',
          proTeam: p.proTeam || '',
          teamId: team.id,
          week,
          x,
          y: p.actual,
        });
      }
    }
  }
  return out;
}

/**
 * Histogram of every score in the league.
 * CONFIRMED: the sheet bins by tens (70s, 80s, ...) and again by twenties.
 */
export function scoreDistribution(allScores, binSize = 10) {
  if (!allScores.length) return { bins: [], counts: [] };

  const lo = Math.floor(Math.min(...allScores) / binSize) * binSize;
  const hi = Math.floor(Math.max(...allScores) / binSize) * binSize;

  const bins = [];
  const counts = [];
  for (let start = lo; start <= hi; start += binSize) {
    bins.push(binSize === 10 ? `${start}s` : `${start}-${start + binSize - 1}`);
    counts.push(allScores.filter((s) => s >= start && s < start + binSize).length);
  }
  return { bins, counts };
}

// ------------------------------------------------------------------ standings

/**
 * Rank the teams by a value — or refuse to.
 *
 * Before a game has been played every value is identical, the comparator
 * returns 0 for every pair, and the stable sort quietly hands out 1 through 10
 * in whatever order ESPN happened to list the teams: a full ordinal standings
 * table derived from nothing. When nothing separates the teams the rank is
 * null, and the page shows a dash.
 *
 * A team with no value (null — no game of its own had a projection) has no
 * rank, and the others are ranked among themselves.
 */
function rankBy(teams, valueFn, descending = true) {
  const ranks = new Map();
  for (const t of teams) ranks.set(t.id, null);
  const known = teams.filter((t) => valueFn(t) !== null);
  const values = known.map(valueFn);
  if (values.every((v) => v === values[0])) return ranks;

  const ordered = [...known].sort((a, b) => {
    const d = valueFn(b) - valueFn(a);
    return descending ? d : -d;
  });
  ordered.forEach((t, i) => ranks.set(t.id, i + 1));
  return ranks;
}

// ------------------------------------------------------------- luck margins

/**
 * How far Close luck, the luck score and S+L could still move: a ± per team.
 *
 * Tim, 2026-09-16: these used to be held back until week 3. He wants them from
 * week 1, "with a wide margin for the first few games" that evens out. So the
 * values are exactly as before — the sheet's formulas, untouched — and each now
 * carries a margin, which is what does the evening out.
 *
 * Each of the three is (a constant plus) an AVERAGE over the team's games of a
 * per-game term:
 *   Close luck  = mean(gameLuck)
 *   Luck score  = leagueAvg − mean(oppActual − luck) + mean(gameLuck),
 *                 each week's total held within `WEEK_LUCK_LIMIT`
 *   S+L        = the luck score + mean(projected) − leagueAvgProjected
 * so the margin is one standard error of that average: the spread of the
 * per-game term ÷ √games. The spread is POOLED across the whole league, since a
 * team's own one or two games cannot have a spread of their own, while the √n
 * is the team's own — which is exactly "wide early, narrower each week".
 *
 * One standard error, not two: about two times in three the figure a season of
 * games settles on is inside it. A tie counts 0 towards gameLuck and is a game
 * in the count, exactly as in the values (`closeLuckOf`). Null when the league
 * has too few games to have a spread (`stdev` needs two).
 *
 * A game whose projections could not be read is in Close luck's terms and
 * count and in neither of the other two, as in the values.
 */
function attachLuckMargins(teams) {
  const closeTerms = [];
  const luckTerms = [];
  const plusTerms = [];
  for (const t of teams) {
    for (const w of t.weekly) {
      const gl = closeLuckOf(w);
      closeTerms.push(gl);
      if (w.luck === null) continue;
      // The week as the Luck score COUNTS it (held within the single-week
      // limit), so the ± is the spread of what is actually averaged.
      const luckTerm = gl - (w.oppActual - w.luck) + (w.weekLuckCounted - w.weekLuck);
      luckTerms.push(luckTerm);
      plusTerms.push(luckTerm + w.projected);
    }
  }
  const sdClose = stdev(closeTerms);
  const sdLuck = stdev(luckTerms);
  const sdPlus = stdev(plusTerms);
  const se = (sd, n) => (sd === null || !n ? null : Math.round((sd / Math.sqrt(n)) * 10) / 10);

  for (const t of teams) {
    const games = t.weekly.length;
    const read = readRows(t.weekly).length;
    t.margins = {
      scoreDiffLuck: se(sdClose, games),
      luckScore: se(sdLuck, read),
      skillPlusLuck: se(sdPlus, read),
      games,
    };
  }
}

// ---------------------------------------------------------------- entrypoint

/**
 * Compute everything from a raw league data object.
 */
export function computeLeagueStats(data) {
  const weeklyRows = buildWeeklyRows(data);

  // League average projected score — needed before per-team skill can be found.
  // Over the team-weeks that have a projection (`readRows`), as Skill is.
  const allProjected = [];
  for (const rows of weeklyRows.values()) {
    for (const r of readRows(rows)) allProjected.push(r.projected);
  }
  const leagueAvgProjected = mean(allProjected);

  const allActuals = [];
  for (const rows of weeklyRows.values()) for (const r of rows) allActuals.push(r.actual);
  const leagueAvgActual = mean(allActuals);

  // League average actual score across weeks 1..w, for every w. The cumulative
  // luck series needs the average as it stood at the time, not the final one.
  const orderedWeeks = [...new Set(data.games.map((g) => g.week))].sort((a, b) => a - b);
  const cumulativeLeagueAvgActual = new Map();
  const seen = [];
  for (const week of orderedWeeks) {
    for (const rows of weeklyRows.values()) {
      const r = rows.find((x) => x.week === week);
      if (r) seen.push(r.actual);
    }
    cumulativeLeagueAvgActual.set(week, mean(seen));
  }

  const teams = data.teams.map((t) =>
    teamMetrics(t, weeklyRows.get(t.id) || [], leagueAvgProjected,
                leagueAvgActual, cumulativeLeagueAvgActual)
  );

  attachLuckMargins(teams);

  // CONFIRMED: all four standings reproduce the sheet's own ranks, 10/10 each.
  // AS breaks a tie on wins by total points; LS and PS are straight sorts.
  // A tied game counts half a win, as ESPN orders it — his league has no
  // tiebreaker, so ties stand. Every team plays every week, so wins + ties/2
  // orders exactly as win percentage does.
  // Points for is the UNROUNDED season total: 128.66 and 129.02 must not tie.
  // A step of half a win is 500 here, far more than two teams' points differ.
  const actualRank = rankBy(teams, (t) => (t.wins + (t.ties || 0) / 2) * 1e6 + t.exact.pointsFor);
  const skillRank = rankBy(teams, (t) => t.exact.skill);
  const luckRank = rankBy(teams, (t) => t.exact.luckScore);
  const projectedRank = rankBy(teams, (t) => t.exact.skillPlusLuck);
  for (const t of teams) {
    t.actualStanding = actualRank.get(t.id);
    t.skillStanding = skillRank.get(t.id);
    t.luckStanding = luckRank.get(t.id);
    t.projectedStanding = projectedRank.get(t.id);
  }

  // Per-week league averages.
  const weekNumbers = orderedWeeks;
  const weeklyLeagueAverages = weekNumbers.map((week) => {
    const scores = [];
    const projs = [];
    const projScores = [];   // the scores of the teams that have a projection
    for (const rows of weeklyRows.values()) {
      const r = rows.find((x) => x.week === week);
      if (!r) continue;
      scores.push(r.actual);
      if (r.luck !== null) { projs.push(r.projected); projScores.push(r.actual); }
    }
    // A week whose projections could not be read has a score and no more.
    return {
      week,
      avgActual: round1(mean(scores)),
      avgProjected: projs.length ? round1(mean(projs)) : null,
      avgLuck: projs.length ? round1(mean(projScores) - mean(projs)) : null,
    };
  });

  // Games were played and not one projection was read: there is no league
  // projection to print (a dash), where before a game it stays the 0 it was.
  const noProjection = allActuals.length > 0 && !allProjected.length;

  return {
    season: data.season,
    name: data.name,
    isDemo: Boolean(data.isDemo),
    weeks: data.weeks,
    teams,
    weekNumbers,
    weeklyLeagueAverages,
    leagueAvgProjected: noProjection ? null : round1(leagueAvgProjected),
    leagueAvgActual: round1(leagueAvgActual),
    predictionAccuracy: predictionAccuracy(data.games),
    distribution10: scoreDistribution(allActuals, 10),
    distribution20: scoreDistribution(allActuals, 20),
    leagueActualBox: boxStats(allActuals),
    leagueProjectedBox: boxStats(allProjected),
  };
}
