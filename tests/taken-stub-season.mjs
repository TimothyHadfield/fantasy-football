// Stands in for js/season.js for the Taken players table.
//
// Three squads, hand-built so every answer is known by construction. The
// interesting cases are all on Ridgeway Rovers:
//
//   QB  Alden Ross   22 every week                      -> QB1 over 4-6
//       Brix Calder  16 every week                      -> QB2 over 4-6
//       Cade Dunlow  10 in weeks 4-6, 40 from week 7    -> QB3 over 4-6
//
//     which is the "QB3"-shaped case, and also the crossover: over weeks 4-9
//     Dunlow averages 25 and becomes QB1, Ross QB2, Calder QB3. Widening the
//     span has to re-rank them, exactly as the note claims it does.
//
//   TE  Kip Lund     no number in ANY week              -> unrankable
//       Merrick Nolan 8                                 -> TE1, the only rated one
//
//   WR  Ivor Jessop  0 in week 5 -- ESPN's own answer for a bye -- and 6
//       otherwise, so his Avg over 4-6 is 4.0 and not 6.0.
//
// The player ids start at 7100, well clear of the 5000-block wv-stub-espn.mjs
// hands out as free agents, so "no free agent is in this table" is a real check
// rather than a coincidence of naming.

export const calls = { schedule: 0, rosterWeeks: [] };

const WEEKS = 13;
const PLAYED_THROUGH = 3;   // so the "current week" is 4

const flat = (n) => () => n;

export const TEAMS = [
  {
    id: 1,
    name: 'Ridgeway Rovers',
    players: [
      { playerId: 7101, name: 'Alden Ross', position: 'QB', proTeam: 'BUF', proj: flat(22) },
      { playerId: 7102, name: 'Brix Calder', position: 'QB', proTeam: 'CIN', proj: flat(16) },
      { playerId: 7103, name: 'Cade Dunlow', position: 'QB', proTeam: 'DAL', proj: (w) => (w <= 6 ? 10 : 40) },
      { playerId: 7104, name: 'Dax Ellery', position: 'RB', proTeam: 'DEN', proj: flat(15) },
      { playerId: 7105, name: 'Finn Gable', position: 'RB', proTeam: 'GB', proj: flat(9) },
      { playerId: 7106, name: 'Hale Innis', position: 'WR', proTeam: 'KC', proj: flat(14) },
      { playerId: 7107, name: 'Ivor Jessop', position: 'WR', proTeam: 'MIA', proj: (w) => (w === 5 ? 0 : 6) },
      { playerId: 7108, name: 'Kip Lund', position: 'TE', proTeam: 'NYJ', proj: () => null },
      { playerId: 7109, name: 'Merrick Nolan', position: 'TE', proTeam: 'PHI', proj: flat(8) },
      { playerId: 7110, name: 'Otto Pace', position: 'K', proTeam: 'SEA', proj: flat(9) },
      { playerId: 7111, name: 'Quarry Defense', position: 'DST', proTeam: 'TB', proj: flat(7) },
    ],
  },
  {
    id: 2,
    name: 'Cobalt Colts',
    players: [
      { playerId: 7201, name: 'Ronan Sharp', position: 'QB', proTeam: 'TEN', proj: flat(20) },
      { playerId: 7202, name: 'Silas Teague', position: 'QB', proTeam: 'BUF', proj: flat(12) },
      { playerId: 7203, name: 'Tobias Vance', position: 'RB', proTeam: 'CIN', proj: flat(13) },
      { playerId: 7204, name: 'Ulric Wray', position: 'RB', proTeam: 'DAL', proj: flat(11) },
      { playerId: 7205, name: 'Vance Yates', position: 'RB', proTeam: 'DEN', proj: flat(7) },
      { playerId: 7206, name: 'Wilder Zane', position: 'WR', proTeam: 'GB', proj: flat(12) },
      { playerId: 7207, name: 'Xander Abbot', position: 'TE', proTeam: 'KC', proj: flat(7) },
      { playerId: 7208, name: 'Yale Brice', position: 'K', proTeam: 'MIA', proj: flat(8) },
      { playerId: 7209, name: 'Zephyr Defense', position: 'DST', proTeam: 'NYJ', proj: flat(6) },
    ],
  },
  {
    id: 3,
    name: 'Marrow Mavericks',
    players: [
      { playerId: 7301, name: 'Ansel Crowe', position: 'QB', proTeam: 'PHI', proj: flat(19) },
      { playerId: 7302, name: 'Bram Dell', position: 'RB', proTeam: 'SEA', proj: flat(14) },
      { playerId: 7303, name: 'Cyrus Ewan', position: 'WR', proTeam: 'TB', proj: flat(10) },
      { playerId: 7304, name: 'Dorian Frey', position: 'WR', proTeam: 'TEN', proj: flat(9) },
      { playerId: 7305, name: 'Ellis Grove', position: 'TE', proTeam: 'BUF', proj: flat(6) },
      { playerId: 7306, name: 'Fane Hobbs', position: 'K', proTeam: 'CIN', proj: flat(7) },
      { playerId: 7307, name: 'Granite Defense', position: 'DST', proTeam: 'DAL', proj: flat(5) },
    ],
  },
];

export const ALL = TEAMS.flatMap((t) => t.players.map((p) => ({ ...p, owner: t.name, teamId: t.id })));
const BY_ID = new Map(ALL.map((p) => [p.playerId, p]));

/** What the page SHOULD compute as a man's average over `weeks`. */
export function expectedAvg(playerId, weeks) {
  const p = BY_ID.get(playerId);
  if (!p) return null;
  const real = weeks.map((w) => p.proj(w)).filter((v) => typeof v === 'number');
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

const FAIL_ROSTER = new Set(
  (process.env.TAKEN_FAIL_ROSTER_WEEKS || '').split(',').filter(Boolean).map(Number)
);

export async function fetchSchedule() {
  calls.schedule++;

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
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name })),
    weeks: [...byWeek.keys()],
    byWeek,
    games: [...byWeek.values()].flat(),
  };
}

export async function fetchWeekRosters(week) {
  return {
    week,
    teams: TEAMS.map((t) => {
      const players = t.players.map((p) => ({
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
      }));
      return {
        id: t.id,
        name: t.name,
        abbrev: `T${t.id}`,
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
    await new Promise((r) => setTimeout(r, Number(process.env.TAKEN_DELAY || 5)));
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
