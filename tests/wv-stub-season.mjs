// Stands in for js/season.js. Only fetchSchedule matters to the waivers page.
export const calls = { schedule: 0 };

const WEEKS = 13;
const PLAYED_THROUGH = 3;   // so the "current week" is 4

export async function fetchSchedule() {
  calls.schedule++;
  if (process.env.WV_SCHEDULE_FAIL === '1') throw new Error('ESPN returned HTTP 500.');

  const byWeek = new Map();
  for (let w = 1; w <= WEEKS; w++) {
    const games = [];
    for (let t = 1; t <= 10; t += 2) {
      const played = w <= PLAYED_THROUGH;
      games.push({
        week: w,
        homeId: t, homeName: `Team ${t}`, homeScore: played ? 100 + t : null,
        awayId: t + 1, awayName: `Team ${t + 1}`, awayScore: played ? 95 + t : null,
        played,
      });
    }
    byWeek.set(w, games);
  }

  return {
    leagueName: 'Stub League',
    teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
    weeks: [...byWeek.keys()],
    byWeek,
    games: [...byWeek.values()].flat(),
  };
}

export async function fetchWeekRosters() { return { week: 1, teams: [] }; }
export async function fetchWeeksRosters() { return new Map(); }
export async function fetchSeasonData() { throw new Error('not used by the waivers page'); }
