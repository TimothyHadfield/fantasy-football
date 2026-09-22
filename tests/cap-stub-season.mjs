// A stubbed live league for the time machine's capture and for the Summary /
// Schedule agreement check. Stands in for js/season.js.
//
// Chosen to exercise exactly the things those two suites are about:
//
//   - 10 teams, 14 regular-season weeks, weeks 1–3 DECIDED. Three weeks is the
//     Summary page's minimum, so both pages simulate.
//   - One decided game is a TIE, so "a tie is half a win" is on trial in the
//     banked table and the standings.
//   - Every roster week carries `projectedTotal` — the started lineup's
//     projection, as js/season.js computes it — so the scoring spread is
//     CALIBRATED (thirty team-weeks) rather than assumed. A stub with no
//     residuals would let two pages agree by both falling back to the default.
//   - The league DECLARES a four-team bracket (CAP_PLAYOFF_TEAMS, default 4),
//     where the fallback is six — the Summary page used to ignore it.
//
// Env switches: CAP_ROSTERS_FAIL (every roster week throws), CAP_CLOUD (the
// data is the synced cloud copy), CAP_PLAYOFF_TEAMS.
//
// DECEMBER (AUDIT §2.1): CAP_DECIDED (how many regular weeks are decided,
// default 3; 14 = the regular season is over), CAP_PLAYOFF_DECIDED (how many
// playoff weeks are decided, default 0). Once the regular season is decided the
// schedule carries `playoffGames` in js/season.js's shape — the winners'
// bracket with its top-seed BYE entries (never `played`, as ESPN sends them)
// and the consolation games. CAP_ROSTERS_REFUSE="16,17" makes just those roster
// weeks throw.
//
// A test fixture: it lives in tests/ and is never served by the site.

export const calls = { schedule: 0, rosters: [], seasonData: 0, cloud: 0 };

const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Manager ${i + 1}`, teamName: `Squad ${i + 1}` }));
export const WEEKS = Array.from({ length: 14 }, (_, i) => i + 1);
export const DECIDED = 3;
const decided = () => Number(process.env.CAP_DECIDED || DECIDED);
const r1 = (n) => Math.round(n * 10) / 10;

function rnd(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function fixturesFor(week) {
  const ids = TEAMS.map((t) => t.id);
  const fixed = ids[0];
  const rot = ids.slice(1);
  const shift = (week - 1) % rot.length;
  const ring = [fixed, ...rot.slice(shift), ...rot.slice(0, shift)];
  const out = [];
  for (let i = 0; i < ring.length / 2; i++) {
    const a = ring[i];
    const b = ring[ring.length - 1 - i];
    out.push(week % 2 === 0 ? [a, b] : [b, a]);
  }
  return out;
}

function scoreOf(teamId, week) {
  return r1(88 + rnd(teamId, week * 3 + 1) * 60);
}

export async function fetchSchedule() {
  calls.schedule++;
  const nameById = new Map(TEAMS.map((t) => [t.id, t.name]));
  const byWeek = new Map();
  for (const w of WEEKS) {
    byWeek.set(w, fixturesFor(w).map(([homeId, awayId], i) => {
      const played = w <= decided();
      let hs = played ? scoreOf(homeId, w) : null;
      let as = played ? scoreOf(awayId, w) : null;
      // THE TIE: week 2's first game finishes level.
      if (played && w === 2 && i === 0) { hs = 111.1; as = 111.1; }
      return {
        week: w,
        homeId, homeName: nameById.get(homeId), homeScore: hs,
        awayId, awayName: nameById.get(awayId), awayScore: as,
        played,
        margin: played ? r1(hs - as) : null,
        winner: played ? (hs > as ? 'home' : as > hs ? 'away' : 'tie') : null,
      };
    }));
  }
  const field = Number(process.env.CAP_PLAYOFF_TEAMS || 4);
  return {
    playoffGames: playoffGamesFor(field, nameById),
    leagueName: 'Capture Stub League',
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, teamName: t.teamName })),
    playoffs: {
      regularSeasonWeeks: WEEKS.length,
      playoffTeams: field,
      weeksPerPlayoffRound: 1,
      reseed: false,
      seedingRule: 'TOTAL_POINTS_SCORED',
      divisions: 1,
    },
    weeks: WEEKS.slice(),
    byWeek,
    games: WEEKS.flatMap((w) => byWeek.get(w)),
  };
}

/**
 * The bracket and consolation games, once the regular season is decided.
 * Seeds are team ids 1..10 in order (the ids are arbitrary here; nothing reads
 * the seeding off these games). Rounds follow the field: 4 -> 2, 6 -> 3.
 */
function playoffGamesFor(field, nameById) {
  if (decided() < WEEKS.length) return [];
  const rounds = field > 4 ? 3 : 2;
  const done = Number(process.env.CAP_PLAYOFF_DECIDED || 0);
  const out = [];
  const game = (week, homeId, awayId, tier) => {
    const played = awayId != null && week - WEEKS.length <= done;
    const hs = played ? scoreOf(homeId, week) : null;
    const as = played ? scoreOf(awayId, week) : null;
    out.push({
      week, homeId, homeName: nameById.get(homeId), homeScore: hs,
      awayId: awayId ?? null, awayName: awayId != null ? nameById.get(awayId) : 'BYE', awayScore: as,
      played,
      margin: played ? r1(hs - as) : null,
      winner: played ? (hs > as ? 'home' : as > hs ? 'away' : 'tie') : null,
      tier,
    });
  };
  for (let r = 0; r < rounds; r++) {
    const week = WEEKS.length + 1 + r;
    if (rounds === 3 && r === 0) {
      game(week, 1, null, 'WINNERS_BRACKET');        // the top two seeds' byes
      game(week, 2, null, 'WINNERS_BRACKET');
      game(week, 3, 6, 'WINNERS_BRACKET');
      game(week, 4, 5, 'WINNERS_BRACKET');
    } else {
      game(week, 1, 4, 'WINNERS_BRACKET');
      game(week, 2, 3, 'WINNERS_BRACKET');
    }
    game(week, 7, 10, 'LOSERS_CONSOLATION_LADDER');
    game(week, 8, 9, 'LOSERS_CONSOLATION_LADDER');
  }
  return out;
}

// 1 QB, 2 RB, 3 WR, 1 TE, FLEX, D/ST, K and four on the bench.
const SHAPE = [
  ['QB', 0], ['RB', 2], ['RB', 2], ['WR', 4], ['WR', 4], ['WR', 4],
  ['TE', 6], ['RB', 23], ['DST', 16], ['K', 17],
  ['RB', 20], ['WR', 20], ['QB', 20], ['TE', 20],
];

export async function fetchWeekRosters(week) {
  calls.rosters.push(week);
  if (process.env.CAP_ROSTERS_FAIL) throw new Error('ESPN would not return rosters.');
  if ((process.env.CAP_ROSTERS_REFUSE || '').split(',').map(Number).includes(Number(week))) {
    throw new Error(`ESPN would not return week ${week}.`);
  }
  const teams = TEAMS.map((t) => {
    const players = SHAPE.map(([position, lineupSlotId], i) => {
      const base = { QB: 19, RB: 12, WR: 12, TE: 9, K: 8, DST: 7 }[position];
      return {
        playerId: t.id * 100 + i,
        name: `${t.name} ${position}${i}`,
        position,
        proTeam: 'XX',
        proTeamId: 2 + ((t.id * 7 + i) % 8),
        lineupSlotId,
        slot: String(lineupSlotId),
        started: lineupSlotId !== 20 && lineupSlotId !== 21,
        projected: r1(base * (0.7 + rnd(t.id * 13 + i, week) * 0.7)),
        actual: null,
        seasonProjected: base * 17,
        injuryStatus: 'ACTIVE',
        percentOwned: null,
      };
    });
    const starters = players.filter((p) => p.started);
    const sum = (arr, k) => {
      const v = arr.map((p) => p[k]).filter((x) => typeof x === 'number');
      return v.length ? r1(v.reduce((a, b) => a + b, 0)) : null;
    };
    return {
      id: t.id,
      name: t.name,
      teamName: t.teamName,
      abbrev: '',
      players,
      starters,
      bench: players.filter((p) => !p.started),
      // What js/season.js computes: the STARTED lineup's projection that week.
      projectedTotal: sum(starters, 'projected'),
      actualTotal: null,
      benchActualTotal: null,
      seasonProjectedTotal: sum(starters, 'seasonProjected'),
    };
  });
  return { week, teams };
}

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  const out = new Map();
  let done = 0;
  for (const w of weeks) {
    try {
      const { teams } = await fetchWeekRosters(w);
      if (teams && teams.length) out.set(w, teams);
    } catch { /* a gap, as in js/season.js */ }
    done++;
    if (onProgress) onProgress(done, weeks.length, w);
  }
  return out;
}

/**
 * The Summary page's played-games view, assembled the way js/season.js does:
 * both sides scored, the actuals and the started lineup's projection rounded
 * to one decimal. Reads its own roster weeks without counting them as the
 * page's roster requests.
 */
export async function fetchSeasonData() {
  calls.seasonData++;
  const sched = await buildScheduleQuietly();
  const played = sched.games.filter((g) => g.played);
  const proj = new Map();
  for (const w of [...new Set(played.map((g) => g.week))]) {
    const { teams } = await fetchWeekRosters(w);
    calls.rosters.pop();
    proj.set(w, new Map(teams.map((t) => [t.id, t.projectedTotal || 0])));
  }
  const games = played.map((g) => ({
    week: g.week,
    homeId: g.homeId,
    awayId: g.awayId,
    homeActual: r1(g.homeScore),
    awayActual: r1(g.awayScore),
    homeProjected: r1(proj.get(g.week).get(g.homeId) || 0),
    awayProjected: r1(proj.get(g.week).get(g.awayId) || 0),
  }));
  return {
    season: 2026,
    isDemo: false,
    name: sched.leagueName,
    weeks: new Set(games.map((g) => g.week)).size,
    teams: sched.teams,
    games,
    injuries: [],
    projectionsAvailable: true,
    gamesFound: games.length,
    gamesWithProjections: games.length,
  };
}

async function buildScheduleQuietly() {
  const s = await fetchSchedule();
  calls.schedule--;
  return s;
}

/** Non-null when the page's data is the synced copy. */
export async function cloudSource() {
  calls.cloud++;
  return process.env.CAP_CLOUD ? { ok: true, found: true, ages: {} } : null;
}

export async function fetchWireWeek() { return []; }

// THE FLOOR READ, only under CAP_WIRE (cross-sim-check.mjs; AUDIT §1.4). The
// real `season.fetchFloors` over a NON-EMPTY wire whose third-best at each
// position moves with the week, so a page that floors on the wrong week hands
// the simulation different projections. `calls.floors` records the week each
// page asked for. Without CAP_WIRE the export is absent, exactly as before, so
// test-capture.mjs's pages see no floor.
calls.floors = [];
const WIRE_BASE = { QB: 14, RB: 8, WR: 8, TE: 6, K: 7, DST: 6 };
export const fetchFloors = process.env.CAP_WIRE
  ? async (week) => {
    calls.floors.push(Number(week));
    const { positionFloors } = await import('../js/floor.js');
    const wire = [];
    for (const [position, base] of Object.entries(WIRE_BASE)) {
      for (let i = 0; i < 6; i++) {
        wire.push({
          playerId: 5000 + wire.length, name: `Wire ${position}${i}`, position,
          injuryStatus: 'ACTIVE',
          // i = 2 is the third-best: base + 0.3 × week.
          projected: r1(base + 0.3 * week + (2 - i) * 0.8),
        });
      }
    }
    return positionFloors(wire, { week });
  }
  : undefined;
export async function buildCloudPayload() { throw new Error('not in this stub'); }
