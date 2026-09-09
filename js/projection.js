// Turning rosters into "what is each team projected to score in each week",
// and the schedule-derived numbers that fall out of that.
//
// Pure: no DOM, no fetching. `js/season.js` does the fetching (fetchWeeksRosters);
// this decides what the numbers mean. It lives in its own module because two
// pages need the same answer — the schedule page's forecast and the stats
// page's schedule-luck column — and a second copy of this logic is how they
// would start quietly disagreeing about how good a team is.

import { SLOT_ELIGIBILITY } from './espn.js';
import { optimalLineup, slotsFromCounts, DEFAULT_SLOTS } from './forecast.js';

/**
 * The league's starting slots, counted off the lineups ESPN sent.
 *
 * ESPN will not accept an illegal lineup, so the set of non-bench slots a team
 * is actually using IS the slot configuration — no extra request needed. Taking
 * the maximum across teams covers a manager sitting on an empty slot. Guessing
 * a two-receiver league when it has three would understate every team by a
 * whole starter, so callers should treat a null here as "say so", not "assume".
 *
 * @param {Array} teams as returned by fetchWeekRosters
 * @returns {Object|null} {slotId: count}, or null when the lineups say nothing
 */
export function slotCountsFromLineups(teams) {
  const counts = {};
  for (const t of teams || []) {
    const mine = {};
    for (const p of t.players || []) {
      if (!p.started) continue;
      if (!SLOT_ELIGIBILITY[p.lineupSlotId]) continue;   // a slot we cannot fill
      mine[p.lineupSlotId] = (mine[p.lineupSlotId] || 0) + 1;
    }
    for (const [id, n] of Object.entries(mine)) counts[id] = Math.max(counts[id] || 0, n);
  }
  return Object.keys(counts).length ? counts : null;
}

/**
 * What every team is projected to score in every week we have rosters for.
 *
 * Each player is taken at ESPN's own projection for that week — the number the
 * ESPN site shows under a lineup paged forward — and the best legal lineup is
 * filled rather than the one currently set. A player on bye comes back from
 * ESPN at 0.00 and simply loses his place to someone better, which is what a
 * manager would do, so byes need no separate handling.
 *
 * @param {Map<number, Array>} weekTeams week -> teams, from fetchWeeksRosters
 * @returns {{proj: Map, slots: number[], countsKnown: boolean, weeks: number[]}|null}
 */
export function projectionsFromWeekTeams(weekTeams) {
  if (!weekTeams || !weekTeams.size) return null;

  const anyWeek = [...weekTeams.values()][0];
  const counts = slotCountsFromLineups(anyWeek);
  const slots = counts ? slotsFromCounts(counts) : DEFAULT_SLOTS.slice();

  const proj = new Map();
  for (const [w, teams] of weekTeams) {
    const forWeek = new Map();
    for (const t of teams) {
      const pool = [];
      for (const p of t.players || []) {
        // Every player on the roster, bench included.
        if (typeof p.projected === 'number') {
          pool.push({ position: p.position, projected: p.projected });
        }
      }
      const total = optimalLineup(pool, slots).total;
      if (total > 0) forWeek.set(t.id, total);
    }
    if (forWeek.size) proj.set(w, forWeek);
  }

  if (!proj.size) return null;
  return {
    proj,
    slots,
    countsKnown: Boolean(counts),
    weeks: [...proj.keys()].sort((a, b) => a - b),
  };
}

/**
 * How hard each team's schedule is, in points.
 *
 * For every game a team plays, take the opponent's projected score that week,
 * and average them. Unlike a record or a points-for, this needs NO games to
 * have been played — it is a fact about the fixture list and everyone's
 * rosters, so it is meaningful before week 1 kicks off. A high number means the
 * schedule keeps handing you strong opponents.
 *
 * `own` is the same average for the team itself, which is what makes the
 * difference between the two readable as "how much harder than me are the
 * teams I have to play".
 *
 * @param {Array}  games  [{week, homeId, awayId}] — played or not, both count
 * @param {Map}    proj   week -> Map(teamId -> projected points)
 * @param {number[]} [teamIds] restricts and orders the result
 * @returns {Map<number, {avgOpp, own, diff, games, weeks}>}
 */
export function opponentProjections(games, proj, teamIds) {
  const acc = new Map();
  const want = teamIds ? new Set(teamIds) : null;

  const add = (id, oppPts, ownPts, week) => {
    if (id == null || (want && !want.has(id))) return;
    if (!Number.isFinite(oppPts)) return;
    const cur = acc.get(id) || { oppTotal: 0, ownTotal: 0, ownN: 0, n: 0, weeks: [] };
    cur.oppTotal += oppPts;
    cur.n++;
    if (Number.isFinite(ownPts)) { cur.ownTotal += ownPts; cur.ownN++; }
    cur.weeks.push({ week, opp: oppPts, own: Number.isFinite(ownPts) ? ownPts : null });
    acc.set(id, cur);
  };

  for (const g of games || []) {
    if (g.homeId == null || g.awayId == null) continue;    // a bye has no opponent
    const forWeek = proj?.get(g.week);
    if (!forWeek) continue;
    const h = forWeek.get(g.homeId);
    const a = forWeek.get(g.awayId);
    add(g.homeId, a, h, g.week);
    add(g.awayId, h, a, g.week);
  }

  const out = new Map();
  for (const [id, c] of acc) {
    if (!c.n) continue;
    const avgOpp = c.oppTotal / c.n;
    const own = c.ownN ? c.ownTotal / c.ownN : null;
    out.set(id, {
      avgOpp,
      own,
      diff: own === null ? null : avgOpp - own,
      games: c.n,
      weeks: c.weeks.sort((x, y) => x.week - y.week),
    });
  }
  return out;
}

/**
 * The league's average opponent projection, so a team's number can be read as
 * harder or easier than the league's typical schedule rather than in a vacuum.
 *
 * Note this is NOT generally the same as the mean of every team's projection:
 * a team plays a given opponent as often as the fixture list says, not once.
 */
export function leagueAverageOpponent(opponents) {
  const vals = [...(opponents?.values() || [])].map((o) => o.avgOpp).filter(Number.isFinite);
  if (!vals.length) return null;
  return vals.reduce((a, v) => a + v, 0) / vals.length;
}
