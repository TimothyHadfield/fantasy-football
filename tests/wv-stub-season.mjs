// Stands in for js/season.js. Only fetchSchedule matters to the waivers page.
export const calls = { schedule: 0 };

const WEEKS = 13;
// 3, so the "current week" is 4 — or, with WV_PLAYED_THROUGH=13, December:
// the regular season is over and only the playoff weeks are left.
const PLAYED_THROUGH = Number(process.env.WV_PLAYED_THROUGH || 3);

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

// ------------------------------------------------------------ the wire
//
// `js/season.js` parses the free-agent payload now, rather than the Players
// page doing it — that move is what let a phone read the synced wire, since
// the page used to be the one thing talking to ESPN directly. The stub has to
// carry the same export or the page cannot import it, and it has to go through
// the STUBBED espn so this suite's own fixture still drives what comes back.
//
// Deliberately the real `parseFreeAgent` (the espn stub re-exports it), not a
// reimplementation: a stub that parsed differently from the site would make
// every projection assertion below a statement about the stub.
import * as espn from './espn.js';

export async function fetchWireWeek(week, limit = 150) {
  const raw = await espn.fetchFreeAgents(week, limit);
  return (raw?.players || [])
    .map((entry) => espn.parseFreeAgent(entry, week))
    .filter((p) => p.playerId !== null && p.playerId !== undefined);
}
