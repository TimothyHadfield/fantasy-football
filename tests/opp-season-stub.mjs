// A four-team league whose every projected number is chosen by hand, so the
// schedule-luck panel can be checked against arithmetic done on paper.
//
//   projected(team t, week w) = base[t] + w,  base = 100/110/120/130
//
//   week 1: 1v2, 3v4      week 2: 1v3, 2v4      week 3: 1v4, 2v3
//
//   avgOpp  T1 = (111+122+133)/3 = 122.0
//           T2 = (101+132+123)/3 = 118.666...
//           T3 = (131+102+113)/3 = 115.333...
//           T4 = (121+112+103)/3 = 112.0
//   league  = 468/4 = 117.0
//
// FF_SCEN picks the scenario: zero | mid | reject | slow | gap | floor.
//
// floor — mid-season (weeks 1–2 played) with a positional floor on offer: the
// QB floor is 100 + 5 × week, so it depends on WHICH week's wire a page reads
// (AUDIT §1.4). Read for week 3, the first unplayed, it is 115.0; week 1's
// wire would say 105.0.
//
// part / part1 — A WEEK IN PROGRESS (Tim, 2026-10-04; done-fixture.mjs has the
// contract). `part`: weeks 1–2 played, and in week 3 Team 1 v Team 4 is final
// early (both QBs done) while Team 2 v Team 3 is still going — Team 2's QB is
// mid-game on 5.5 and its bench man has finished on 7. `part1`: the same shape
// in week 1 with nothing played before it (1 v 2 final, 3 v 4 still going), so
// two squads have no game at all yet.

import { markDone, earlyFinal } from './done-fixture.mjs';

const SCEN = process.env.FF_SCEN || 'zero';

export const calls = [];

const BASE = { 1: 100, 2: 110, 3: 120, 4: 130 };
export const TEAMS = [1, 2, 3, 4].map((id) => ({ id, name: `Team ${id}` }));
export const WEEKS = [1, 2, 3];
const PAIRS = { 1: [[1, 2], [3, 4]], 2: [[1, 3], [2, 4]], 3: [[1, 4], [2, 3]] };

export const proj = (id, week) => BASE[id] + week;

/** One started QB per team, so the best legal lineup is exactly that QB. */
function teamsForWeek(week) {
  const plain = plainTeams(week);
  if (week !== PART_WEEK) return plain;
  const over = new Set(PAIRS[week][0]);
  const still = PAIRS[week][1][0];          // the squad with a man mid-game
  const scored = plain.map((t) => ({
    ...t,
    players: t.players.map((p) => ({
      ...p,
      actual: p.started ? (over.has(t.id) ? actual(t.id, week) : null) : (t.id === still ? 7 : null),
    })),
  }));
  return markDone(
    scored,
    (p, t) => (over.has(t.id) && p.started) || (t.id === still && !p.started),
    (p, t) => (t.id === still && p.started ? 5.5 : null),
  );
}

function plainTeams(week) {
  return TEAMS.map((t) => {
    const players = [
      { playerId: t.id * 10, name: `QB ${t.id}`, position: 'QB', lineupSlotId: 0,
        slot: 'QB', started: true, projected: proj(t.id, week), actual: null },
      // A bench player who must never reach the lineup.
      { playerId: t.id * 10 + 1, name: `Bench ${t.id}`, position: 'QB', lineupSlotId: 20,
        slot: 'BE', started: false, projected: 1, actual: null },
    ];
    return {
      id: t.id, name: t.name, abbrev: `T${t.id}`,
      players, starters: players.slice(0, 1), bench: players.slice(1),
      projectedTotal: proj(t.id, week), actualTotal: null,
      benchActualTotal: null, seasonProjectedTotal: proj(t.id, week) * 17,
    };
  });
}

/** Actual scores for the weeks the mid-season scenario has finished. */
const actual = (id, week) => BASE[id] + week * 2;

const playedWeeks = SCEN === 'mid' || SCEN === 'floor' || SCEN === 'part' ? [1, 2] : [];

/** The week in progress, with its first game final early; null outside part/part1. */
export const PART_WEEK = SCEN === 'part' ? 3 : SCEN === 'part1' ? 1 : null;
const isEarly = (w, i) => w === PART_WEEK && i === 0;

/** The QB floor the 'floor' scenario's wire gives for `week`. */
export const qbFloor = (week) => 100 + 5 * week;

// Only the 'floor' scenario has a floor read at all; everywhere else the export
// is absent, as it was, so those scenarios' hand-computed numbers stand.
export const fetchFloors = SCEN === 'floor'
  ? async (week) => {
    calls.push(`fetchFloors:${week}`);
    const w = Number(week);
    return new Map([['QB', {
      value: qbFloor(w), position: 'QB', name: 'Wire QB', playerId: 9001,
      pool: 12, rank: 3, want: 3, week: w,
    }]]);
  }
  : undefined;

export async function fetchSchedule() {
  calls.push('fetchSchedule');
  const byWeek = new Map();
  for (const w of WEEKS) {
    byWeek.set(w, PAIRS[w].map(([h, a], i) => {
      const played = playedWeeks.includes(w);
      if (isEarly(w, i)) {
        return earlyFinal({
          week: w, homeId: h, awayId: a, homeName: `Team ${h}`, awayName: `Team ${a}`,
        }, actual(h, w), actual(a, w));
      }
      return {
        week: w, homeId: h, awayId: a,
        homeName: `Team ${h}`, awayName: `Team ${a}`,
        homeScore: played ? actual(h, w) : null,
        awayScore: played ? actual(a, w) : null,
        played,
        margin: played ? actual(h, w) - actual(a, w) : null,
        winner: played ? (actual(h, w) > actual(a, w) ? 'home' : 'away') : null,
      };
    }));
  }
  return {
    leagueName: 'Stub League', teams: TEAMS, weeks: WEEKS, byWeek,
    games: WEEKS.flatMap((w) => byWeek.get(w)),
  };
}

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  calls.push(`fetchWeeksRosters:${weeks.join('/')}`);
  if (SCEN === 'reject') throw new Error('ESPN refused the roster request (401).');
  const out = new Map();
  let done = 0;
  for (const w of weeks) {
    // 'slow' spaces the weeks out so the pending/progress state can be caught
    // mid-flight, the way a real thirteen-request season looks.
    if (SCEN === 'slow') await new Promise((r) => setTimeout(r, 40));
    // 'gap' is the real fetchWeeksRosters' behaviour for a week ESPN refuses:
    // absent from the map, not an exception.
    if (!(SCEN === 'gap' && w === 2)) out.set(w, teamsForWeek(w));
    done++;
    if (onProgress) onProgress(done, weeks.length, w);
  }
  return out;
}

export async function fetchWeekRosters(week) {
  calls.push(`fetchWeekRosters:${week}`);
  return { week, teams: teamsForWeek(week) };
}

export async function fetchSeasonData() {
  calls.push('fetchSeasonData');
  const games = [];
  const weeks = PART_WEEK ? [...playedWeeks, PART_WEEK] : playedWeeks;
  for (const w of weeks) {
    for (const [i, [h, a]] of PAIRS[w].entries()) {
      // A week in progress hands over only the games that are final.
      if (w === PART_WEEK && !isEarly(w, i)) continue;
      games.push({
        week: w, homeId: h, awayId: a,
        homeActual: actual(h, w), awayActual: actual(a, w),
        homeProjected: proj(h, w), awayProjected: proj(a, w),
      });
    }
  }
  return {
    season: 2026, isDemo: false, name: 'Stub League', weeks: weeks.length,
    teams: TEAMS.map((t) => ({ ...t })), games, injuries: [],
    projectionsAvailable: games.length > 0,
    gamesFound: games.length, gamesWithProjections: games.length,
  };
}
