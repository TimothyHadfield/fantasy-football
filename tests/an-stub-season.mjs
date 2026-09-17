// Stands in for js/season.js for the analysis-page harness.
//
// Deterministic, and deliberately carries the three awkward shapes the season
// grid has to tell apart: a bye (0.00), a week ESPN has no number for (null),
// and a player who simply was not on the roster that week.

export const calls = { schedule: 0, week: [], weeks: [] };

export const WEEKS = 13;
export const NTEAMS = 10;
export const SIZE = 15;          // 9 starters + 6 bench
export const PLAYED_THROUGH = 8; // actuals are recorded through week 8
// The SCHEDULE has a result through week 7 only, so week 8 is the first week
// not yet played and the page opens on it (it opens on the COMING week since
// 2026-09-16). Kept one behind the actuals on purpose: the card's Act row reads
// the data, never the schedule, and this is the fixture that keeps it honest.
export const SCHEDULE_PLAYED_THROUGH = 7;
export const SIGNED_WEEK = 5;    // the last bench player joins here

const FAIL = new Set(
  (process.env.AN_FAIL_WEEKS || '').split(',').filter(Boolean).map(Number)
);
const DELAY = Number(process.env.AN_DELAY || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exported because an-test.mjs rebuilds every week's best legal lineup from
// these raw numbers to check the season panel's slot rows — re-deriving the
// answer rather than reading the page's own arithmetic back to it.
export const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17, 20, 20, 20, 20, 20, 20];
const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE' };
export const POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'DST', 'K', 'RB', 'WR', 'QB', 'TE', 'WR', 'RB'];

/** What the stub says ESPN projects. null = no number; 0 = bye. */
export function projFor(i, week) {
  if (i === 3 && week === 6) return 0;      // on bye
  if (i === 4 && week === 7) return null;   // ESPN carried nothing
  return Math.round(((20 - i) + week * 0.3) * 10) / 10;
}

export const playerName = (teamId, i) => `T${teamId} Player ${String(i).padStart(2, '0')}`;

/** Whether a player is on the roster in a given week. */
export const onRoster = (i, week) => !(i === SIZE - 1 && week < SIGNED_WEEK);

// AN_SOLO_K strips the kicker from every squad but team 4. It exists for ONE
// question: what the season panel's red marks do when a slot has too few values
// across the league to have a standard deviation at all. Combined with
// AN_FAIL_WEEKS leaving a single week readable, the K slot ends up with exactly
// one value in the whole league — which `stdev` refuses to take a deviation of,
// and the panel must therefore refuse to colour.
const SOLO_K = process.env.AN_SOLO_K === '1';
const hasPlayer = (teamId, i) => !(SOLO_K && POS[i] === 'K' && teamId !== 4);

function playersFor(teamId, week) {
  const out = [];
  for (let i = 0; i < SIZE; i++) {
    if (!onRoster(i, week)) continue;
    if (!hasPlayer(teamId, i)) continue;
    const slot = SLOTS[i];
    out.push({
      playerId: teamId * 100 + i,
      name: playerName(teamId, i),
      position: POS[i],
      proTeam: 'BUF',
      proTeamId: 1,
      lineupSlotId: slot,
      slot: LABEL[slot],
      started: slot !== 20,
      projected: projFor(i, week),
      actual: week <= PLAYED_THROUGH ? Math.round((15 - i * 0.7) * 10) / 10 : null,
      seasonProjected: (20 - i) * 17,
      injuryStatus: i === 2 ? 'OUT' : i === 5 ? 'QUESTIONABLE' : 'ACTIVE',
      percentOwned: null,
    });
  }
  return out;
}

function buildTeams(week) {
  const teams = [];
  for (let id = 1; id <= NTEAMS; id++) {
    const players = playersFor(id, week);
    const starters = players.filter((p) => p.started);
    const bench = players.filter((p) => !p.started);
    const total = (arr, key) => {
      const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10 : null;
    };
    teams.push({
      id,
      name: `Team ${id}`,
      abbrev: `T${id}`,
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    });
  }
  return teams;
}

export async function fetchWeekRosters(week) {
  calls.week.push(week);
  if (DELAY) await sleep(DELAY);
  if (FAIL.has(week)) throw new Error(`ESPN refused week ${week}.`);
  return { week, teams: buildTeams(week) };
}

/** Same contract as the real one: a week ESPN refuses is simply absent. */
export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  const out = new Map();
  let done = 0;
  for (const week of weeks) {
    calls.weeks.push(week);
    if (DELAY) await sleep(DELAY);
    if (!FAIL.has(week)) out.set(week, buildTeams(week));
    done++;
    if (onProgress) onProgress(done, weeks.length, week);
  }
  return out;
}

export async function fetchSchedule() {
  calls.schedule++;
  const byWeek = new Map();
  for (let w = 1; w <= WEEKS; w++) {
    const games = [];
    for (let t = 1; t <= NTEAMS; t += 2) {
      const played = w <= SCHEDULE_PLAYED_THROUGH;
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
    teams: Array.from({ length: NTEAMS }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
    weeks: [...byWeek.keys()],
    byWeek,
    games: [...byWeek.values()].flat(),
  };
}

export async function fetchSeasonData() { throw new Error('not used by the analysis page'); }
