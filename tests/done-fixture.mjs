// THE WEEK IN PROGRESS, as js/season.js hands it out — one copy of the data
// contract for every stub that needs "some players done, one matchup final
// early, the rest still going" (Tim, 2026-10-04: "any games that are
// completely finished are counted in whatever data across the site").
//
// FINISHED PLAYER. In a week ESPN has not closed, every player carries `done`.
//   done: true   his NFL game is over (or he has none). `pregame` is the
//                projection as it stood (may be null) and `projected` is
//                OVERWRITTEN with his score (`actual`, or 0).
//   done: false  unchanged; `actual` may hold a RUNNING score, not a result.
// The team totals (`projectedTotal`, `actualTotal`) are left as they were:
// `projectedTotal` stays on the pre-game projections. A final week and the
// demo carry neither field.
//
// FINISHED MATCHUP. A schedule game is `played: true, winner, margin,
// early: true` as soon as every starter on both sides is done.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Stamp one week's teams the way season.js does for a week still open.
 *
 * @param {Array} teams  a stub's teams for the week, as it builds them
 * @param {(p, team) => boolean} isDone
 * @param {(p, team) => number|null} [running] a score so far for a man NOT
 *        done; default is whatever `actual` the stub already gave him
 */
export function markDone(teams, isDone, running = (p) => p.actual ?? null) {
  return teams.map((t) => {
    const players = t.players.map((p) => {
      if (isDone(p, t)) {
        return {
          ...p,
          done: true,
          pregame: isNum(p.projected) ? p.projected : null,
          projected: isNum(p.actual) ? p.actual : 0,
          actual: isNum(p.actual) ? p.actual : 0,
        };
      }
      return { ...p, done: false, actual: running(p, t) };
    });
    const starters = players.filter((p) => p.started);
    const sum = (arr) => {
      const vals = arr.map((p) => p.actual).filter(isNum);
      return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10 : null;
    };
    const bench = players.filter((p) => !p.started);
    return {
      ...t,
      players,
      starters,
      bench,
      // projectedTotal is deliberately NOT recomputed: it stays pre-game.
      actualTotal: sum(starters),
      benchActualTotal: sum(bench),
    };
  });
}

/** A schedule game made final early: both lineups finished, ESPN's live totals as scores. */
export function earlyFinal(g, homeScore, awayScore) {
  return {
    ...g,
    homeScore,
    awayScore,
    played: true,
    early: true,
    winner: homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'tie',
    margin: Math.round((homeScore - awayScore) * 10) / 10,
  };
}

/** What a squad's starters have scored, to a tenth — the early game's score. */
export function startedScore(team) {
  const vals = (team.starters || []).map((p) => p.actual).filter(isNum);
  return Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10;
}
