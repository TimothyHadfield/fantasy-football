// Stands in for js/season.js for the comparison-row tests.
//
// Unlike wv-stub-season.mjs this one really returns rosters, shaped exactly the
// way season.js's fetchWeekRosters does. Team 4 is "you" in every scenario, and
// its squad is hand-built so the answers are known by construction:
//
//   QB 3   24 / 18 / (13 up to week 6, then 40)  <- the crossover
//   RB 4   15 / 12 / 9 / 8
//   WR 5   16 / 13 / 11 / 9 / (4, but 0 in week 5 -- a bye)
//   TE 2   (12, but no number at all in week 4) / 6
//   K  2   9 / 7
//   DST 0                                        <- a position you do not hold
//
// The numbers are pitched to straddle the stub wire (whose averages run about
// 4 to 24), so the comparison rows land INSIDE the sorted table rather than all
// beneath it -- which is what makes the interleaving worth asserting.
//
// Over weeks 4-6 the worst QB is Quade Carver on 13.0. Over weeks 4-9 he
// averages 26.5 and Quinn Barrow on 18.0 becomes the worst: widening the span
// has to change which man the "Your QB3" row names.
//
// Carver also LEAVES team 4 after week 6 and turns up on team 5, so his weeks
// 7-9 projections are only findable by indexing every team's players rather
// than only your own.

export const calls = { schedule: 0, rosterWeeks: [] };

const WEEKS = 13;
const PLAYED_THROUGH = 3;   // so the "current week" is 4
const MY_TEAM = 4;

const FAIL_ROSTER = new Set(
  (process.env.CMP_FAIL_ROSTER_WEEKS || '').split(',').filter(Boolean).map(Number)
);

/** The squad, with each man's projection as a function of the week. */
export const MINE = [
  { playerId: 7001, name: 'Quill Adair', position: 'QB', proTeam: 'BUF', proj: () => 24 },
  { playerId: 7002, name: 'Quinn Barrow', position: 'QB', proTeam: 'CIN', proj: () => 18 },
  { playerId: 7003, name: 'Quade Carver', position: 'QB', proTeam: 'DAL', proj: (w) => (w <= 6 ? 13 : 40) },

  { playerId: 7011, name: 'Rhett Dunmore', position: 'RB', proTeam: 'DEN', proj: () => 15 },
  { playerId: 7012, name: 'Rex Ellery', position: 'RB', proTeam: 'GB', proj: () => 12 },
  { playerId: 7013, name: 'Roy Falkner', position: 'RB', proTeam: 'KC', proj: () => 9 },
  { playerId: 7014, name: 'Reed Gantry', position: 'RB', proTeam: 'MIA', proj: () => 8 },

  { playerId: 7021, name: 'Wes Harlow', position: 'WR', proTeam: 'NYJ', proj: () => 16 },
  { playerId: 7022, name: 'Ward Inglis', position: 'WR', proTeam: 'PHI', proj: () => 13 },
  { playerId: 7023, name: 'Wilkes Joyner', position: 'WR', proTeam: 'SEA', proj: () => 11 },
  { playerId: 7024, name: 'Wray Kelso', position: 'WR', proTeam: 'TB', proj: () => 9 },
  // 0 is ESPN's own answer for a bye, and the average has to count it as one.
  { playerId: 7025, name: 'Wynn Larch', position: 'WR', proTeam: 'TEN', proj: (w) => (w === 5 ? 0 : 4) },

  // null is "no number at all", which the average has to leave out -- so this
  // man averages 10, not 7.5, and stays the better of the two tight ends.
  { playerId: 7031, name: 'Tam Mercer', position: 'TE', proTeam: 'BUF', proj: (w) => (w === 4 ? null : 12) },
  { playerId: 7032, name: 'Tobin Nash', position: 'TE', proTeam: 'CIN', proj: () => 6 },

  { playerId: 7041, name: 'Kip Ossory', position: 'K', proTeam: 'DAL', proj: () => 9 },
  { playerId: 7042, name: 'Kell Pruitt', position: 'K', proTeam: 'DEN', proj: () => 7 },
];

const BY_ID = new Map(MINE.map((p) => [p.playerId, p]));

/** Carver is yours only through week 6; after that he is team 5's. */
const CARVER = 7003;
const holdsCarver = (teamId, week) =>
  week <= 6 ? teamId === MY_TEAM : teamId === 5;

export function projFor(playerId, week) {
  const p = BY_ID.get(playerId);
  return p ? p.proj(week) : null;
}

/** What the page should compute as one of your men's average over `weeks`. */
export function expectedAvg(playerId, weeks) {
  const real = weeks.map((w) => projFor(playerId, w)).filter((v) => typeof v === 'number');
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

function entry(p, week, teamId) {
  return {
    playerId: p.playerId,
    name: p.name,
    position: p.position,
    proTeam: p.proTeam,
    lineupSlotId: 20,
    slot: 'BE',
    started: false,
    projected: p.proj(week),
    actual: null,
    seasonProjected: 120,
    injuryStatus: 'ACTIVE',
    percentOwned: 50,
    _teamId: teamId,
  };
}

function teamPlayers(teamId, week) {
  if (teamId === MY_TEAM) {
    return MINE.filter((p) => p.playerId !== CARVER || holdsCarver(MY_TEAM, week))
      .map((p) => entry(p, week, teamId));
  }

  // Filler, so the payload looks like a league rather than one squad.
  const filler = [
    { playerId: 8000 + teamId * 10 + 1, name: `Filler ${teamId}A`, position: 'QB', proTeam: 'SF', proj: () => 11 },
    { playerId: 8000 + teamId * 10 + 2, name: `Filler ${teamId}B`, position: 'RB', proTeam: 'LAR', proj: () => 9 },
  ].map((p) => entry(p, week, teamId));

  if (holdsCarver(teamId, week)) filler.push(entry(BY_ID.get(CARVER), week, teamId));
  return filler;
}

export async function fetchSchedule() {
  calls.schedule++;
  if (process.env.CMP_SCHEDULE_FAIL === '1') throw new Error('ESPN returned HTTP 500.');

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

export async function fetchWeekRosters(week) {
  return {
    week,
    teams: Array.from({ length: 10 }, (_, i) => {
      const id = i + 1;
      const players = teamPlayers(id, week);
      return {
        id,
        name: `Team ${id}`,
        abbrev: `T${id}`,
        players,
        starters: [],
        bench: players,
        projectedTotal: null,
        actualTotal: null,
        benchActualTotal: null,
        seasonProjectedTotal: null,
      };
    }),
  };
}

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  const out = new Map();
  let done = 0;
  for (const week of weeks) {
    calls.rosterWeeks.push(Number(week));
    await new Promise((r) => setTimeout(r, Number(process.env.CMP_DELAY || 5)));
    // A refused week is simply absent, exactly as the real one behaves.
    if (!FAIL_ROSTER.has(Number(week))) {
      out.set(Number(week), (await fetchWeekRosters(Number(week))).teams);
    }
    done++;
    if (onProgress) onProgress(done, weeks.length, week);
  }
  return out;
}

export async function fetchSeasonData() { throw new Error('not used by the waivers page'); }
