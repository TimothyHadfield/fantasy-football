// The Analysis harness's league (an-stub-season.mjs: ten squads of fifteen in a
// real lineup shape, a bye, a week ESPN has no number for, a man who joins
// late) with the ONE thing the Stats page needs on top: a season of results.
//
// It exists so future-check.mjs can boot stats.html and analysis.html on the
// SAME league and hold the two pages' numbers against each other.

import { NTEAMS, SCHEDULE_PLAYED_THROUGH, fetchSchedule } from './an-stub-season.mjs';

export * from './an-stub-season.mjs';

export async function fetchSeasonData() {
  const schedule = await fetchSchedule();
  const games = schedule.games.filter((g) => g.played).map((g) => ({
    week: g.week, homeId: g.homeId, awayId: g.awayId,
    homeActual: g.homeScore, awayActual: g.awayScore,
    homeProjected: g.homeScore - 2, awayProjected: g.awayScore + 2,
  }));
  return {
    season: 2026, isDemo: false, name: 'Stub League', weeks: SCHEDULE_PLAYED_THROUGH,
    teams: Array.from({ length: NTEAMS }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
    games, injuries: [],
    projectionsAvailable: games.length > 0,
    gamesFound: games.length, gamesWithProjections: games.length,
  };
}
