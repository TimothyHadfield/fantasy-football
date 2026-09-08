// League statistics.
//
// These formulas are reverse-engineered from Tim's 2025 Google Sheet. Each one
// below is marked CONFIRMED (verified to reproduce the sheet's numbers) or
// UNKNOWN (formula not yet supplied — see PROGRESS.md).
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

export function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

/**
 * Five-number summary plus Tukey outlier fences at 1.5 x IQR.
 * CONFIRMED: reproduces the sheet's "Under 49 / Over 183" for actual scores
 * (Q1 99, Q3 133, IQR 34) and "Under 95 / Over 151" for projected.
 */
export function boxStats(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, iqr: 0, lowerFence: 0, upperFence: 0, outliers: [] };
  }
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
        won: side.actual > side.oppActual,
        tied: side.actual === side.oppActual,
      });
    }
  }

  for (const arr of rows.values()) arr.sort((a, b) => a.week - b.week);
  return rows;
}

// --------------------------------------------------------------- team metrics

function teamMetrics(team, weekly, leagueAvgProjected) {
  const actuals = weekly.map((w) => w.actual);
  const projecteds = weekly.map((w) => w.projected);
  const oppActuals = weekly.map((w) => w.oppActual);
  const oppProjecteds = weekly.map((w) => w.oppProjected);

  const pointsFor = sum(actuals);
  const pointsAgainst = sum(oppActuals);
  const n = weekly.length || 1;

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
    skill: round1(mean(projecteds) - leagueAvgProjected),

    wins: weekly.filter((w) => w.won).length,
    losses: weekly.filter((w) => !w.won && !w.tied).length,
    ties: weekly.filter((w) => w.tied).length,

    // Spread of weekly scores — CONFIRMED (box chart section of the sheet).
    actualBox: boxStats(actuals),
    projectedBox: boxStats(projecteds),
    actualStdev: round1(stdev(actuals)),

    // --- UNKNOWN: formulas not yet supplied ---
    pointsToWin: null,      // sheet column "PTW"
    scoreDiffLuck: null,    // sheet column "SD" in the luck block
    cumulativeLuck: null,   // the "Cumulative Luck (adjusted formula)" series
    skillPlusLuck: null,    // = skill + cumulative luck, so blocked on the above
  };
}

// ------------------------------------------------------------ league metrics

/**
 * How often the projection picked the actual winner, bucketed by how large the
 * projected margin was.
 *
 * CONFIRMED as a concept against the sheet's "Prediction Accuracy" block, which
 * reported 65 games overall at 0.69, and tighter buckets at larger margins.
 */
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
      accuracy: relevant.length ? correct.length / relevant.length : null,
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

function rankBy(teams, valueFn, descending = true) {
  const ordered = [...teams].sort((a, b) => {
    const d = valueFn(b) - valueFn(a);
    return descending ? d : -d;
  });
  const ranks = new Map();
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

  const teams = data.teams.map((t) =>
    teamMetrics(t, weeklyRows.get(t.id) || [], leagueAvgProjected)
  );

  // Standings we can compute today.
  const actualRank = rankBy(teams, (t) => t.wins * 1000 + t.pointsFor);
  const skillRank = rankBy(teams, (t) => t.skill);
  for (const t of teams) {
    t.actualStanding = actualRank.get(t.id);
    t.skillStanding = skillRank.get(t.id);
    // UNKNOWN: luck standings and projected standings both depend on the
    // cumulative-luck formula, so they stay null for now.
    t.luckStanding = null;
    t.projectedStanding = null;
  }

  const allActuals = [];
  for (const rows of weeklyRows.values()) for (const r of rows) allActuals.push(r.actual);

  // Per-week league averages.
  const weekNumbers = [...new Set(data.games.map((g) => g.week))].sort((a, b) => a - b);
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
    leagueAvgActual: round1(mean(allActuals)),
    predictionAccuracy: predictionAccuracy(data.games),
    distribution10: scoreDistribution(allActuals, 10),
    distribution20: scoreDistribution(allActuals, 20),
    leagueActualBox: boxStats(allActuals),
    leagueProjectedBox: boxStats(allProjected),
  };
}
