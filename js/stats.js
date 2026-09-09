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
 * Returns null for a tied game, where the sheet itself shows #DIV/0!.
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

// ------------------------------------------------------- per-team weekly rows

/**
 * Flatten the game list into one row per team per week, with the opponent's
 * numbers attached so every downstream metric can be computed locally.
 *
 * CONFIRMED: luck = actual - projected
 * CONFIRMED: actualDiff = own actual - opponent actual
 * CONFIRMED: projectedDiff = own projected - opponent projected
 */
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
      rows.get(side.id).push({
        week: g.week,
        actual: side.actual,
        projected: side.projected,
        luck: round1(side.actual - side.projected),
        oppId: side.oppId,
        oppActual: side.oppActual,
        oppProjected: side.oppProjected,
        oppLuck: round1(side.oppActual - side.oppProjected),
        actualDiff: round1(side.actual - side.oppActual),
        projectedDiff: round1(side.projected - side.oppProjected),
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
  let oppTotal = 0;
  let luckTotal = 0;
  const sds = [];

  weekly.forEach((w, i) => {
    oppTotal += w.oppActual;
    luckTotal += w.luck;
    if (w.gameLuck !== null) sds.push(w.gameLuck);

    const n = i + 1;
    const ptw = oppTotal / n - luckTotal / n;
    const sd = sds.length ? mean(sds) : 0;
    const league = cumulativeLeagueAvgActual.get(w.week) ?? 0;

    out.push({ week: w.week, value: round1(league - ptw + sd) });
  });

  return out;
}

function teamMetrics(team, weekly, leagueAvgProjected, leagueAvgActual, cumulativeLeagueAvgActual) {
  const actuals = weekly.map((w) => w.actual);
  const projecteds = weekly.map((w) => w.projected);
  const oppActuals = weekly.map((w) => w.oppActual);
  const oppProjecteds = weekly.map((w) => w.oppProjected);

  const pointsFor = sum(actuals);
  const pointsAgainst = sum(oppActuals);
  const n = weekly.length || 1;

  // CONFIRMED: PTW = opponent avg actual - own avg luck. Recovered verbatim
  // from the sheet as `=AU3-AR3`. It reads as "the score you would have needed
  // to beat your average opponent, once your own luck is taken back out".
  const pointsToWin = mean(oppActuals) - mean(weekly.map((w) => w.luck));

  // CONFIRMED: SD averages the per-game luck figure over the season. Tied
  // games contribute nothing rather than poisoning the average — the sheet
  // shows #DIV/0! for Miles, who had one.
  const gameLucks = weekly.map((w) => w.gameLuck).filter((v) => v !== null);
  const scoreDiffLuck = gameLucks.length ? mean(gameLucks) : null;

  // CONFIRMED: `=121.8-(AX3-AY3)`, i.e. leagueAvgActual - (PTW - SD). This is
  // the standings LUCK column, and it equals the final cumulative-luck value.
  const luckScore = leagueAvgActual - (pointsToWin - (scoreDiffLuck ?? 0));
  const skill = mean(projecteds) - leagueAvgProjected;
  const actualStdev = stdev(actuals);

  return {
    id: team.id,
    name: team.name,
    weekly,

    // Averages and totals — CONFIRMED against the sheet's Avg/Total columns.
    avgActual: round1(mean(actuals)),
    avgProjected: round1(mean(projecteds)),
    avgLuck: round1(mean(weekly.map((w) => w.luck))),
    totalActual: Math.round(pointsFor),
    totalProjected: Math.round(sum(projecteds)),

    // Opponent block — CONFIRMED.
    oppAvgActual: round1(mean(oppActuals)),
    oppAvgProjected: round1(mean(oppProjecteds)),
    oppAvgLuck: round1(mean(weekly.map((w) => w.oppLuck))),

    // CONFIRMED: the sheet's "F-A" is per-week average, not the season total.
    // (Autumn: (1467 - 1530) / 13 = -4.8, shown as -5.)
    pointsFor: Math.round(pointsFor),
    pointsAgainst: Math.round(pointsAgainst),
    forMinusAgainst: round1((pointsFor - pointsAgainst) / n),

    // CONFIRMED: skill = own avg projected - league avg projected.
    // Verified on all ten teams in the 2025 sheet.
    skill: round1(skill),

    wins: weekly.filter((w) => w.won).length,
    losses: weekly.filter((w) => !w.won && !w.tied).length,
    ties: weekly.filter((w) => w.tied).length,

    // Spread of weekly scores — CONFIRMED (box chart section of the sheet).
    // All three are null until there are enough weeks to have a spread at all.
    actualBox: boxStats(actuals),
    projectedBox: boxStats(projecteds),
    actualStdev: actualStdev === null ? null : round1(actualStdev),

    // --- Recovered from the sheet's xlsx on 2026-09-08. See PROGRESS.md. ---
    pointsToWin: round1(pointsToWin),                       // "PTW"
    scoreDiffLuck: scoreDiffLuck === null ? null : round1(scoreDiffLuck), // "SD"
    luckScore: round1(luckScore),                           // "LUCK"
    cumulativeLuck: cumulativeLuckSeries(weekly, cumulativeLeagueAvgActual),
    skillPlusLuck: round1(skill + luckScore),               // "S+L"

    // Unrounded copies. Everything above is rounded for display, but two teams
    // can sit thousandths apart in S+L — Stevenson and Mitch did in 2025 — and
    // ranking the rounded values would swap them. Standings sort on these.
    exact: { skill, luckScore, skillPlusLuck: skill + luckScore, pointsToWin },
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

// Below this many games a bucket has no percentage worth printing: with five
// games the only answers available are 0, 20, 40, 60, 80 and 100%, and a single
// correct call in the >30 bucket reads as a flawless projection model. The
// games and correct counts are still reported — only the ratio is withheld.
const MIN_GAMES_FOR_ACCURACY = 20;

export function predictionAccuracy(games, thresholds = [0, 5, 10, 15, 20, 25, 30]) {
  // A game where both teams carry the same projection makes no prediction at
  // all, so it can be neither right nor wrong. Those are excluded from every
  // bucket and counted separately rather than being quietly dropped.
  const predictive = games.filter((g) => g.homeProjected !== g.awayProjected);
  const ties = games.length - predictive.length;

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
 */
function rankBy(teams, valueFn, descending = true) {
  const ranks = new Map();
  const values = teams.map(valueFn);
  if (values.every((v) => v === values[0])) {
    for (const t of teams) ranks.set(t.id, null);
    return ranks;
  }

  const ordered = [...teams].sort((a, b) => {
    const d = valueFn(b) - valueFn(a);
    return descending ? d : -d;
  });
  ordered.forEach((t, i) => ranks.set(t.id, i + 1));
  return ranks;
}

// ---------------------------------------------------------------- entrypoint

/**
 * Compute everything from a raw league data object.
 */
export function computeLeagueStats(data) {
  const weeklyRows = buildWeeklyRows(data);

  // League average projected score — needed before per-team skill can be found.
  const allProjected = [];
  for (const rows of weeklyRows.values()) {
    for (const r of rows) allProjected.push(r.projected);
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

  // CONFIRMED: all four standings reproduce the sheet's own ranks, 10/10 each.
  // AS breaks a tie on wins by total points; LS and PS are straight sorts.
  const actualRank = rankBy(teams, (t) => t.wins * 1000 + t.pointsFor);
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
    for (const rows of weeklyRows.values()) {
      const r = rows.find((x) => x.week === week);
      if (r) { scores.push(r.actual); projs.push(r.projected); }
    }
    return {
      week,
      avgActual: round1(mean(scores)),
      avgProjected: round1(mean(projs)),
      avgLuck: round1(mean(scores) - mean(projs)),
    };
  });

  return {
    season: data.season,
    name: data.name,
    isDemo: Boolean(data.isDemo),
    weeks: data.weeks,
    teams,
    weekNumbers,
    weeklyLeagueAverages,
    leagueAvgProjected: round1(leagueAvgProjected),
    leagueAvgActual: round1(leagueAvgActual),
    predictionAccuracy: predictionAccuracy(data.games),
    distribution10: scoreDistribution(allActuals, 10),
    distribution20: scoreDistribution(allActuals, 20),
    leagueActualBox: boxStats(allActuals),
    leagueProjectedBox: boxStats(allProjected),
  };
}
