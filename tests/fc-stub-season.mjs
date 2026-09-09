// A stubbed live league: 10 teams, 13 weeks, week 1 played and nothing else.
// Games carry NO projections (which is the truth about ESPN's matchup feed).
// Rosters look like fetchWeekRosters output. Each player carries a REAL
// per-week `projected` for whichever week is asked for, and 0 on his bye --
// verified against a live public league: ESPN publishes a projection for every
// player in every future week, right through week 13.
//
// A test fixture: it lives in tests/ and is never served by the site.

export const calls = { schedule: 0, rosters: [], };

const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` }));
const WEEKS = Array.from({ length: 13 }, (_, i) => i + 1);

/** Deterministic 0..1 from two ints. */
function rnd(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Round-robin-ish fixtures: five games a week, everyone plays once. */
function fixturesFor(week) {
  const ids = TEAMS.map((t) => t.id);
  const fixed = ids[0];
  const rot = ids.slice(1);
  const shift = (week - 1) % rot.length;
  const order = rot.slice(shift).concat(rot.slice(0, shift));
  const ring = [fixed, ...order];
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n / 2; i++) {
    const a = ring[i];
    const b = ring[n - 1 - i];
    out.push(week % 2 === 0 ? [a, b] : [b, a]);
  }
  return out;
}

export async function fetchSchedule() {
  calls.schedule++;
  const nameById = new Map(TEAMS.map((t) => [t.id, t.name]));
  const byWeek = new Map();

  for (const w of WEEKS) {
    const games = fixturesFor(w).map(([homeId, awayId]) => {
      const played = w === 1;
      const hs = played ? Math.round((92 + rnd(homeId, w) * 50) * 10) / 10 : null;
      const as = played ? Math.round((92 + rnd(awayId, w + 40) * 50) * 10) / 10 : null;
      return {
        week: w,
        homeId,
        homeName: nameById.get(homeId),
        homeScore: hs,
        awayId,
        awayName: nameById.get(awayId),
        awayScore: as,
        played,
        margin: played ? Math.round((hs - as) * 10) / 10 : null,
        winner: played ? (hs > as ? 'home' : as > hs ? 'away' : 'tie') : null,
        // Deliberately NO homeProjected / awayProjected: live games have none.
      };
    });
    byWeek.set(w, games);
  }

  return {
    leagueName: 'Stub Live League',
    teams: TEAMS.map((t) => ({ ...t })),
    weeks: WEEKS.slice(),
    byWeek,
    games: WEEKS.flatMap((w) => byWeek.get(w)),
  };
}

// Roster shape: 1 QB, 4 RB, 5 WR, 2 TE, 1 K, 1 DST.
// Starters use the real league's slots: QB 0, RB 2x2, WR 4x3, TE 6, FLEX 23,
// D/ST 16, K 17 -- ten starters, three of them receivers.
const SHAPE = [
  ['QB', 0], ['RB', 2], ['RB', 2], ['WR', 4], ['WR', 4], ['WR', 4],
  ['TE', 6], ['RB', 23], ['DST', 16], ['K', 17],
  ['RB', 20], ['WR', 20], ['WR', 20], ['TE', 20],
];

// Bye weeks by pro team id. Team 4 (the owner's team in the live scenarios)
// has five of its best players on pro team 6, whose bye is week 10.
export const BYES = { 2: 5, 3: 6, 4: 7, 5: 8, 6: 10, 7: 11, 8: 12, 9: 13 };
export const BYE_HEAVY_TEAM = 4;
export const BYE_HEAVY_WEEK = 10;

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  const out = new Map();
  let done = 0;
  for (const w of weeks) {
    try {
      const { teams } = await fetchWeekRosters(w);
      if (teams && teams.length) out.set(w, teams);
    } catch { /* that week is unavailable */ }
    done++;
    if (onProgress) onProgress(done, weeks.length, w);
  }
  return out;
}

export async function fetchWeekRosters(week) {
  calls.rosters.push(week);
  if (process.env.FC_ROSTERS_FAIL) throw new Error('ESPN would not return rosters.');

  const teams = TEAMS.map((t) => {
    const players = SHAPE.map(([position, lineupSlotId], i) => {
      const base = { QB: 320, RB: 210, WR: 200, TE: 140, K: 130, DST: 120 }[position];
      const seasonProjected =
        Math.round((base * (0.6 + rnd(t.id * 31 + i, 7) * 0.8) + t.id * 3) * 10) / 10;
      // Spread players across pro teams; concentrate the bye-heavy team's best
      // skill players on one pro team so a bye week is measurable.
      const proTeamId =
        t.id === BYE_HEAVY_TEAM && i >= 1 && i <= 5 ? 6 : 2 + ((t.id * 7 + i) % 8);
      return {
        playerId: t.id * 100 + i,
        name: `${t.name} ${position}${i}`,
        position,
        proTeam: 'XX',
        proTeamId,
        lineupSlotId,
        slot: String(lineupSlotId),
        started: lineupSlotId !== 20 && lineupSlotId !== 21,
        // ESPN's own number for THIS week. Zero on the bye, as ESPN reports it.
        projected: BYES[proTeamId] === week
          ? 0
          : Math.round((seasonProjected / 17) * (0.75 + rnd(t.id * 13 + i, week) * 0.5) * 10) / 10,
        actual: null,
        seasonProjected,
        injuryStatus: i === 12 ? 'OUT' : i === 11 ? 'QUESTIONABLE' : 'ACTIVE',
        percentOwned: null,
      };
    });

    const starters = players.filter((p) => p.started);
    const sum = (arr, k) => {
      const v = arr.map((p) => p[k]).filter((x) => typeof x === 'number');
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10 : null;
    };
    return {
      id: t.id,
      name: t.name,
      abbrev: '',
      players,
      starters,
      bench: players.filter((p) => !p.started),
      projectedTotal: null,
      actualTotal: null,
      benchActualTotal: null,
      seasonProjectedTotal: sum(starters, 'seasonProjected'),
    };
  });

  return { week, teams };
}

export async function fetchSeasonData() {
  return {};
}
