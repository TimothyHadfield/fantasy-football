// js/season.js for pre-now-check.mjs: the fixture league (pre-now-fixture.mjs)
// with no network. FF_SCEN picks the situation:
//
//   live       this season, rules known, the wire answers
//   past       the same league opened on 2025
//   norules    this season, but the schedule carries no scoring rules
//   zero       nothing played: nobody has a season average
//   synced     the phone's synced copy, which holds NO wire for the week
//   syncedwire the synced copy, holding the week's wire
//   wirefail   the wire read throws
//
// `calls` records every read, so "the wire was never asked for" is checked.

import {
  SEASON, WEEKS, PLAYED, TEAMS, SCORING, teamsForWeek, wireForWeek,
} from './pre-now-fixture.mjs';

const SCEN = process.env.FF_SCEN || 'live';
export const calls = [];

const played = SCEN === 'zero' ? [] : PLAYED;
const season = SCEN === 'past' ? 2025 : SEASON;
// Five pairings a week, rotated so everybody meets somebody new.
const pairs = (w) => [0, 1, 2, 3, 4].map((i) => [TEAMS[i].id, TEAMS[5 + ((i + w) % 5)].id]);
const score = (id, w) => 100 + id * 3 + w;

export async function fetchSchedule() {
  calls.push('fetchSchedule');
  const byWeek = new Map();
  for (const w of WEEKS) {
    byWeek.set(w, pairs(w).map(([h, a]) => {
      const done = played.includes(w);
      return {
        week: w, homeId: h, awayId: a, homeName: `Squad ${h}`, awayName: `Squad ${a}`,
        homeScore: done ? score(h, w) : null, awayScore: done ? score(a, w) : null,
        played: done,
        margin: done ? score(h, w) - score(a, w) : null,
        winner: done ? (score(h, w) > score(a, w) ? 'home' : 'away') : null,
      };
    }));
  }
  return {
    leagueName: 'Fixture League', teams: TEAMS, weeks: WEEKS, byWeek,
    games: WEEKS.flatMap((w) => byWeek.get(w)),
    scoringItems: SCEN === 'norules' ? null : SCORING,
  };
}

const rosters = (w) => teamsForWeek(w, { averages: SCEN !== 'zero' });

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  calls.push(`fetchWeeksRosters:${weeks.join('/')}`);
  const out = new Map();
  weeks.forEach((w, i) => {
    out.set(w, rosters(w));
    if (onProgress) onProgress(i + 1, weeks.length, w);
  });
  return out;
}

export async function fetchWeekRosters(week) {
  calls.push(`fetchWeekRosters:${week}`);
  return { week, teams: rosters(week) };
}

export async function fetchWireWeek(week) {
  calls.push(`fetchWireWeek:${week}`);
  if (SCEN === 'wirefail') throw new Error('ESPN refused the wire (500).');
  return wireForWeek(week);
}

export async function cloudSource() {
  calls.push('cloudSource');
  if (SCEN === 'synced') return { weeks: { rosters: WEEKS, wire: [] }, byes: {} };
  if (SCEN === 'syncedwire') return { weeks: { rosters: WEEKS, wire: [3] }, byes: {} };
  return null;
}

export async function fetchSeasonData() {
  calls.push('fetchSeasonData');
  const games = played.flatMap((w) => pairs(w).map(([h, a]) => ({
    week: w, homeId: h, awayId: a,
    homeActual: score(h, w), awayActual: score(a, w),
    homeProjected: score(h, w) - 4, awayProjected: score(a, w) + 4,
  })));
  return {
    season, isDemo: false, name: 'Fixture League', weeks: played.length,
    teams: TEAMS.map((t) => ({ ...t })), games, injuries: [],
    projectionsAvailable: games.length > 0,
    gamesFound: games.length, gamesWithProjections: games.length,
  };
}
