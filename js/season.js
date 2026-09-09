// Turns a real ESPN league into the same shape demo.js produces, so the stats
// page doesn't care where its numbers came from.
//
// Actual scores are easy — ESPN hands them to us per matchup.
//
// Weekly PROJECTED totals are not. ESPN never stores "what was this team
// projected to score in week 4"; it only stores per-player projections. So we
// refetch each week's rosters and re-add the projections of whoever was in the
// starting lineup that week. That is what the ESPN site itself displays, but it
// costs one request per week.

import * as espn from './espn.js';

const BENCH_SLOT = 20;
const IR_SLOT = 21;

/**
 * Sum the projected points of every starter on a roster for one week.
 */
function projectedTotalForWeek(teamEntry, week) {
  let total = 0;
  for (const e of teamEntry.roster?.entries || []) {
    if (e.lineupSlotId === BENCH_SLOT || e.lineupSlotId === IR_SLOT) continue;

    const stats = e.playerPoolEntry?.player?.stats || [];
    const projected = stats.find(
      (s) => s.scoringPeriodId === week && s.statSourceId === 1
    );
    if (projected && typeof projected.appliedTotal === 'number') {
      total += projected.appliedTotal;
    }
  }
  return total;
}

/**
 * Run promises a few at a time so we don't fire 18 requests at ESPN at once.
 */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

/**
 * One week's rosters for every team, with each player's slot and points.
 *
 * Rosters genuinely change week to week — trades, waivers, injuries — so this
 * has to be fetched per week rather than derived from a season snapshot.
 *
 * @param {number} week scoring period
 * @returns {{week, teams: [{id, name, starters, bench, projectedTotal, actualTotal}]}}
 */
export async function fetchWeekRosters(week) {
  const raw = await espn.fetchRosters(week);
  const season = espn.getConfig().season;

  const teams = (raw.teams || []).map((t) => {
    const players = (t.roster?.entries || []).map((e) => {
      const p = e.playerPoolEntry?.player || {};
      const stats = p.stats || [];

      const find = (sourceId, weekly) =>
        stats.find((s) =>
          weekly
            ? s.scoringPeriodId === week && s.statSourceId === sourceId
            : s.seasonId === season && s.statSourceId === sourceId && s.statSplitTypeId === 0
        );

      const weekProj = find(1, true);
      const weekActual = find(0, true);
      const seasonProj = find(1, false);

      return {
        playerId: e.playerId,
        name: p.fullName || '',
        position: espn.POSITIONS[p.defaultPositionId] || 'UNK',
        proTeam: espn.PRO_TEAMS[p.proTeamId] ?? 'FA',
        // Kept as well as the abbreviation because bye weeks come back keyed by
        // this id, and re-deriving it from the abbreviation would break on the
        // seasons where ESPN changes its own casing.
        proTeamId: p.proTeamId ?? null,
        lineupSlotId: e.lineupSlotId,
        slot: espn.SLOT_LABELS[e.lineupSlotId] ?? String(e.lineupSlotId),
        started: e.lineupSlotId !== BENCH_SLOT && e.lineupSlotId !== IR_SLOT,
        projected: weekProj?.appliedTotal ?? null,
        actual: weekActual?.appliedTotal ?? null,
        seasonProjected: seasonProj?.appliedTotal ?? null,
        injuryStatus: p.injuryStatus || 'ACTIVE',
        percentOwned: p.ownership?.percentOwned ?? null,
      };
    });

    const starters = players.filter((p) => p.started);
    // ESPN returns bench entries in roster order, which looks random on screen.
    // Best projection first matches what the demo data already does.
    const bench = players
      .filter((p) => !p.started)
      .sort((a, b) => (b.projected ?? -Infinity) - (a.projected ?? -Infinity));

    // Before kickoff every actual is null. Summing those as 0 would report a
    // real-looking 0.0 for the team and a Diff of minus the whole projection,
    // so a team row would claim data the player rows correctly show as "—".
    const total = (arr, key) => {
      const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10;
    };

    return {
      id: t.id,
      name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim() || `Team ${t.id}`,
      abbrev: t.abbrev || '',
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    };
  });

  return { week, teams };
}

/**
 * The full season schedule, week by week, with results where they exist.
 */
export async function fetchSchedule() {
  const raw = await espn.fetchMatchups();
  const parsed = espn.parseLeague(raw);
  const nameById = new Map(parsed.teams.map((t) => [t.id, t.name]));

  const byWeek = new Map();
  for (const m of raw.schedule || []) {
    if (!m.home) continue;
    const week = m.matchupPeriodId;
    if (!byWeek.has(week)) byWeek.set(week, []);

    const homePts = m.home.totalPoints ?? null;
    const awayPts = m.away ? m.away.totalPoints ?? null : null;
    const played = homePts !== null && awayPts !== null && (homePts > 0 || awayPts > 0);

    byWeek.get(week).push({
      week,
      homeId: m.home.teamId,
      homeName: nameById.get(m.home.teamId) || `Team ${m.home.teamId}`,
      homeScore: homePts,
      awayId: m.away ? m.away.teamId : null,
      awayName: m.away ? nameById.get(m.away.teamId) || `Team ${m.away.teamId}` : 'BYE',
      awayScore: awayPts,
      played,
      margin: played ? Math.round((homePts - awayPts) * 10) / 10 : null,
      winner: played ? (homePts > awayPts ? 'home' : awayPts > homePts ? 'away' : 'tie') : null,
    });
  }

  return {
    leagueName: parsed.name,
    teams: parsed.teams,
    weeks: [...byWeek.keys()].sort((a, b) => a - b),
    byWeek,
    games: [...byWeek.values()].flat(),
  };
}

/**
 * Build a full season of league data from ESPN.
 *
 * @param {function} onProgress optional (done, total, label) callback
 * @returns the canonical league-data shape, plus `projectionsAvailable`
 */
export async function fetchSeasonData({ onProgress } = {}) {
  const report = (done, total, label) => onProgress && onProgress(done, total, label);

  report(0, 1, 'Loading league…');
  const raw = await espn.fetchMatchups();
  const parsed = espn.parseLeague(raw);

  const teams = parsed.teams.map((t) => ({ id: t.id, name: t.name }));
  const teamIds = new Set(teams.map((t) => t.id));

  // Only completed matchups: both sides must have actually scored.
  const played = (raw.schedule || []).filter(
    (m) =>
      m.home && m.away &&
      teamIds.has(m.home.teamId) && teamIds.has(m.away.teamId) &&
      typeof m.home.totalPoints === 'number' &&
      typeof m.away.totalPoints === 'number' &&
      (m.home.totalPoints > 0 || m.away.totalPoints > 0)
  );

  const weeks = [...new Set(played.map((m) => m.matchupPeriodId))].sort((a, b) => a - b);

  // Re-derive each week's projected totals from that week's starting lineups.
  const projByWeek = new Map(); // week -> Map(teamId -> projected)
  let done = 0;

  await inBatches(weeks, 3, async (week) => {
    try {
      const weekRaw = await espn.fetchRosters(week);
      const map = new Map();
      for (const t of weekRaw.teams || []) {
        map.set(t.id, projectedTotalForWeek(t, week));
      }
      projByWeek.set(week, map);
    } catch {
      projByWeek.set(week, new Map()); // week unavailable; handled below
    }
    done++;
    report(done, weeks.length, `Rebuilding week ${week} projections…`);
  });

  const games = [];
  for (const m of played) {
    const week = m.matchupPeriodId;
    const proj = projByWeek.get(week) || new Map();
    games.push({
      week,
      homeId: m.home.teamId,
      awayId: m.away.teamId,
      homeActual: Math.round(m.home.totalPoints * 10) / 10,
      awayActual: Math.round(m.away.totalPoints * 10) / 10,
      homeProjected: Math.round((proj.get(m.home.teamId) || 0) * 10) / 10,
      awayProjected: Math.round((proj.get(m.away.teamId) || 0) * 10) / 10,
    });
  }

  // If ESPN gave us nothing usable for projections, say so rather than
  // silently rendering a season of zeroes.
  const withProjections = games.filter((g) => g.homeProjected > 0 && g.awayProjected > 0);

  // "More than half the games" was tuned against a 65-game season. In week 1
  // there are five, so 3-of-5 passes the ratio while dropping two games
  // entirely — and the four teams in them survive into `teams` with no rows at
  // all. Those ghosts then compute skill = 0 - leagueAvgProjected (about -122)
  // and luck = leagueAvgActual (about +117), which puts teams that never
  // played at the TOP of the luck standings, with no warning shown. So the
  // filtered set is only safe to use when it still covers every team.
  const coveredTeams = new Set();
  for (const g of withProjections) { coveredTeams.add(g.homeId); coveredTeams.add(g.awayId); }
  const playedTeams = new Set();
  for (const g of games) { playedTeams.add(g.homeId); playedTeams.add(g.awayId); }
  const coversEveryone = [...playedTeams].every((id) => coveredTeams.has(id));

  const projectionsAvailable =
    withProjections.length > games.length * 0.5 && coversEveryone;

  return {
    season: espn.getConfig().season,
    isDemo: false,
    name: parsed.name,
    weeks: weeks.length,
    teams,
    games: projectionsAvailable ? withProjections : games,
    injuries: [], // entered by hand in the sheet; no ESPN equivalent
    projectionsAvailable,
    gamesFound: games.length,
    gamesWithProjections: withProjections.length,
  };
}
