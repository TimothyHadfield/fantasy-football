// A league the size of a real one, with every number chosen by rule, for the
// Stats page's "Preseason vs now" panel (js/pre-vs-now.js).
//
//   10 squads x 16 players (2 QB, 5 RB, 5 WR, 2 TE, 1 K, 1 D/ST) = 160 rostered
//   150 free agents on the wire, most-owned first, as ESPN sends them
//   weeks 1-2 played, week 3 the current one, weeks 3-4 still to play
//
// Rows are shaped like js/season.js `fetchWeekRosters` players and
// js/espn.js `parseFreeAgent` results; baseline entries like
// data/baselines/2026-preseason.json (`{ n, p, g, t, s }`). Nobody here is real.
//
// WHO HAS WHICH NUMBER (so "left out" is tested, not assumed):
//   id % 13 === 0   ESPN had no preseason line for him   -> not in the baseline
//   id % 11 === 0   no season average (he has not played) -> seasonAvg null
//   everyone else   pre = 3 + id % 19, avg = pre + (id * 7) % 13 - 6 + 0.04
// Free agent 5001 is ALSO on squad 1's roster (a wire read a moment stale).

export const SEASON = 2026;
export const WEEKS = [1, 2, 3, 4];
export const PLAYED = [1, 2];
export const CURRENT = 3;
export const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Squad ${i + 1}` }));

const SHAPE = ['QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'K', 'D/ST'];
const POS_ID = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, 'D/ST': 16 };
const SLOT = { QB: [0, 'QB'], RB: [2, 'RB'], WR: [4, 'WR'], TE: [6, 'TE'], K: [17, 'K'], 'D/ST': [16, 'D/ST'] };
const WIRE_SHAPE = ['WR', 'RB', 'QB', 'TE', 'WR', 'RB', 'K', 'D/ST', 'WR', 'RB'];

export const hasPre = (id) => id % 13 !== 0;
export const hasAvg = (id) => id % 11 !== 0;
export const preOf = (id) => 3 + (id % 19);
export const avgOf = (id) => preOf(id) + ((id * 7) % 13) - 6 + 0.04;

const rosterId = (teamId, i) => teamId * 100 + i;          // 100..1015
const wireId = (i) => 5000 + i;                            // 5000..5149
export const STALE_ID = 5001;                              // on the wire AND on squad 1

function person(id, position) {
  return {
    playerId: id,
    name: `Player ${id}`,
    position,
    proTeam: 'KC',
    proTeamId: 12,
    injuryStatus: 'ACTIVE',
    percentOwned: 50,
    seasonProjected: 100,
    seasonAvg: hasAvg(id) ? avgOf(id) : null,
    posRank: (id % 40) + 1,
  };
}

/** One week's rosters, as `fetchWeekRosters(week).teams`. */
export function teamsForWeek(week, { averages = true } = {}) {
  const played = PLAYED.includes(week);
  return TEAMS.map((t) => {
    const ids = SHAPE.map((_, i) => rosterId(t.id, i));
    if (t.id === 1) ids[2] = STALE_ID;                     // squad 1's first RB is the stale man
    const players = ids.map((id, i) => {
      const position = SHAPE[i];
      const started = i % 2 === 0;
      const [lineupSlotId, slot] = started ? SLOT[position] : [20, 'BE'];
      const p = person(id, position);
      return {
        ...p,
        seasonAvg: averages ? p.seasonAvg : null,
        lineupSlotId, slot, started,
        projected: preOf(id),
        actual: played ? avgOf(id) : null,
      };
    });
    const starters = players.filter((p) => p.started);
    const sum = (list, k) => list.reduce((a, p) => a + (p[k] ?? 0), 0);
    return {
      id: t.id, name: t.name, abbrev: `S${t.id}`,
      players, starters, bench: players.filter((p) => !p.started),
      projectedTotal: sum(starters, 'projected'),
      actualTotal: played ? sum(starters, 'actual') : null,
      benchActualTotal: null, seasonProjectedTotal: 1700,
    };
  });
}

/** The wire for a week, as `fetchWireWeek(week)`: 150 men, most-owned first. */
export function wireForWeek() {
  return Array.from({ length: 150 }, (_, i) => {
    const id = wireId(i);
    return {
      ...person(id, WIRE_SHAPE[i % WIRE_SHAPE.length]),
      percentOwned: 60 - i * 0.4,
      projected: preOf(id),
      actual: null,
      status: 'FREEAGENT',
      waiverClears: null,
    };
  });
}

/** Flat rules: stat 24 (rushing yards) at 0.1, so a line of `pre * 170` yards
 *  over 17 games is exactly `pre` a game for every position. */
export const SCORING = [{ statId: 24, points: 0.1 }, { statId: 53, points: 1 }];

/** The preseason copy, as data/baselines/2026-preseason.json. */
export function baseline() {
  const players = {};
  const everyone = [
    ...teamsForWeek(CURRENT).flatMap((t) => t.players),
    ...wireForWeek(),
  ];
  for (const p of everyone) {
    if (!hasPre(p.playerId)) continue;
    players[String(p.playerId)] = {
      n: p.name, p: POS_ID[p.position], g: 17, t: preOf(p.playerId) * 17,
      s: { 24: preOf(p.playerId) * 170 },
    };
  }
  return { about: 'test fixture', captured: '2026-09-09', season: SEASON, players };
}

const KEY = { 'D/ST': 'DST' };

/**
 * What the panel should hold, worked out here WITHOUT js/pre-vs-now.js: one
 * entry per man with both numbers, a stale wire man counted once, on his squad.
 */
export function expected({ wire = true } = {}) {
  const out = [];
  const held = new Set();
  for (const t of teamsForWeek(CURRENT)) {
    for (const p of t.players) {
      held.add(p.playerId);
      if (hasPre(p.playerId) && hasAvg(p.playerId)) {
        out.push({ id: p.playerId, position: KEY[p.position] || p.position, teamId: t.id, team: t.name });
      }
    }
  }
  if (wire) {
    for (const p of wireForWeek()) {
      if (held.has(p.playerId) || !hasPre(p.playerId) || !hasAvg(p.playerId)) continue;
      out.push({ id: p.playerId, position: KEY[p.position] || p.position, teamId: null, team: 'Free agent' });
    }
  }
  return out.map((r) => {
    const pre = Math.round(preOf(r.id) * 10) / 10;
    const avg = avgOf(r.id);
    return { ...r, pre, avg, diff: Math.round((Math.round(avg * 10) / 10 - pre) * 10) / 10 };
  });
}
