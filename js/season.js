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
  const projectionsAvailable = withProjections.length > games.length * 0.5;

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
