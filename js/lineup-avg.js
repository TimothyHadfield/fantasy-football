// What a squad's best legal lineup is worth in a week, and the averages built
// on it. ONE COPY, TWO PAGES.
//
// These started life inside js/analysis-page.js: `assessed` (what one lineup
// slot counts for), the week total its "Weekly totals" table and "Starting
// lineup" band add up, and the mean it prints as Avg. Tim, 2026-10-08, asked
// for Roster strength on the Stats page to "match our future avg proj like in
// the analysis section", so the arithmetic moved here and both pages import
// it: a squad's week on Stats and the same squad's week on Analysis are the
// same function called on the same rosters, not two spellings that drift.
//
// THE RULES, each one Analysis's own and unchanged by the move:
//   - the lineup is the BEST LEGAL one for that week's roster (`optimalLineup`),
//     so a man on bye (ESPN sends him at 0) simply loses his place;
//   - only men ESPN gave an id for are in the solve (`identified`);
//   - the league's slots are read off every lineup held, pooled across weeks;
//   - a slot counts at no less than the waiver floor for it, and an empty slot
//     counts at the floor (rule 13) — with no floors read, ESPN's own number;
//   - a week is its UNROUNDED slots added up and rounded once, to the tenth;
//   - an average is the mean of those week totals, rounded to the tenth.
//
// Pure: no DOM, no page state, no fetching.

import { optimalLineup, slotsFromCounts } from './forecast.js';
import { slotCountsFromLineups } from './projection.js';
import { slotRows, fillSlots } from './lineup-slots.js';
import { flooredValue, slotFloor } from './floor.js';

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * What a slot is ASSESSED at in one week.
 *
 * `null` and `undefined` are DIFFERENT: `null` is a week that was read in which
 * nobody could fill the slot, which is what a floor is for; `undefined` is a
 * week that has not arrived, and flooring that would be a claim about a week
 * nobody has looked at.
 *
 * `value` is a cell, to the tenth. `exact` is the same assessment on the
 * unrounded projection (`raw` from `fillSlots`), and is what a week total adds.
 *
 * @param {{p:object, v:number, raw?:number}|null|undefined} entry from `fillSlots`
 * @param {{slotId:number}} row from `slotRows`
 * @param {Map|null} floors from `floor.positionFloors`, or null for none
 * @returns {{value:number|null, assumed:boolean, exact:number|null}}
 */
export function assessSlot(entry, row, floors) {
  if (entry === undefined) return { value: null, assumed: false, exact: null };
  if (entry === null) {
    const sf = slotFloor(row.slotId, floors);
    return { value: sf ? sf.value : null, assumed: Boolean(sf), exact: sf ? sf.value : null };
  }
  const raw = typeof entry.raw === 'number' ? entry.raw : entry.v;
  // A FINISHED MAN'S SCORE IS A FACT (js/floor.js: a banked score is never
  // floored) — no streaming decision can reach back into it.
  if (entry.p && entry.p.done === true) return { value: entry.v, assumed: false, exact: raw };
  // The SLOT's floor, not the man's position's (AUDIT §1.8): a zero TE in the
  // FLEX is worth what an empty FLEX is, the best of RB/WR/TE on the wire.
  const a = flooredValue({ position: entry.p.position, projected: entry.v }, floors, row.slotId);
  const x = flooredValue({ position: entry.p.position, projected: raw }, floors, row.slotId);
  return {
    value: a.value === null ? entry.v : a.value,
    assumed: a.assumed,
    exact: x.value === null ? raw : x.value,
  };
}

/**
 * One squad's week: every slot row assessed, added up unrounded, rounded once.
 * Null when no row has a number (no floor read and nobody to start).
 *
 * @param {Map<string, object|null>} fill from `fillSlots` / `bestFill`
 */
export function lineupTotal(fill, rows, floors) {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    // `|| null`: a slot key the fill has no entry for is a slot nobody could
    // fill — the floor's case — not a week nobody read.
    const a = assessSlot(fill.get(row.key) || null, row, floors);
    if (a.exact !== null) { sum += a.exact; any = true; }
  }
  return any ? round1(sum) : null;
}

/** Only men ESPN gave an id for: the lineup is solved over these alone. */
export function identified(players) {
  return (players || []).filter((p) => p.playerId !== null && p.playerId !== undefined);
}

/** A roster's best legal lineup for the week, handed out to the slot rows. */
export function bestFill(players, slots, rows) {
  return fillSlots(optimalLineup(identified(players), slots).starters, rows);
}

/**
 * The league's starting slots, read off every lineup held — pooled across
 * weeks as well as teams, so one manager sitting a slot empty in one week
 * does not shrink the league's shape. Null when the lineups say nothing.
 *
 * @param {Array<Array>} teamLists one list of teams per week (or page of rosters)
 */
export function slotsFromTeamLists(teamLists) {
  const pool = [];
  for (const teams of teamLists || []) pool.push(...(teams || []));
  const counts = slotCountsFromLineups(pool);
  return counts ? slotsFromCounts(counts) : null;
}

/** The mean of the numbers in `values`, to the tenth; null when there are none. */
export function meanTenth(values) {
  const real = (values || []).filter((v) => typeof v === 'number');
  return real.length ? round1(real.reduce((a, b) => a + b, 0) / real.length) : null;
}

/** The same mean left unrounded — a sort key, never printed (two squads a
 *  hundredth apart must not tie and fall back to ESPN's team order). */
const rawMean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Every squad's best-lineup total in each of `weeks`.
 *
 * @param {Map<number, Array>} weekTeams week -> teams, from `fetchWeeksRosters`
 * @param {number[]} weeks the weeks wanted (others are not solved)
 * @param {Map|null} floors
 * @returns {Map<number, Map<number, number|null>>} week -> team -> total
 */
export function lineupWeekTotals(weekTeams, weeks, floors = null) {
  const out = new Map();
  if (!weekTeams || !weekTeams.size) return out;
  const slots = slotsFromTeamLists([...weekTeams.values()]);
  const rows = slots ? slotRows(slots) : [];
  if (!rows.length) return out;
  for (const w of weeks || []) {
    const teams = weekTeams.get(w);
    if (!teams) continue;
    const totals = new Map();
    for (const t of teams) totals.set(t.id, lineupTotal(bestFill(t.players, slots, rows), rows, floors));
    out.set(w, totals);
  }
  return out;
}

/**
 * ROSTER STRENGTH: each squad's week totals over `weeks`, averaged.
 *
 * @returns {Map<number, {avg:number, raw:number, weeks:Array<{week:number, total:number}>}>}
 *   only squads with at least one week to average; `raw` is the unrounded mean
 */
export function futureAverages(totals, weeks, teamIds) {
  const out = new Map();
  for (const id of teamIds || []) {
    const list = [];
    for (const w of weeks || []) {
      const v = totals.get(w) ? totals.get(w).get(id) : null;
      if (typeof v === 'number') list.push({ week: w, total: v });
    }
    if (list.length) {
      const xs = list.map((x) => x.total);
      out.set(id, { avg: meanTenth(xs), raw: rawMean(xs), weeks: list });
    }
  }
  return out;
}

/**
 * FUTURE PROJ DIFF: for each game a squad still has in `weeks`, its own week
 * total minus its opponent's that week; then those gaps averaged.
 *
 * A week the squad has no game in (a league bye) has no gap and is left out,
 * as is a game either side of which has no projection. A squad with no game
 * left is absent from the result.
 *
 * Each game's gap is the two printed tenths subtracted, so a row of the
 * preview (yours, theirs, gap) always adds up; and `avg` is `own − opp`, the
 * two averages as printed, so the foot of the preview adds up too. `raw` is
 * the unrounded mean gap, a sort key.
 *
 * @param {Array<{week:number, homeId:*, awayId:*}>} games
 * @returns {Map<number, {avg:number, own:number, opp:number, raw:number,
 *   games:Array<{week:number, oppId:number, own:number, opp:number, gap:number}>}>}
 */
export function futureDiffs(games, totals, weeks, teamIds) {
  const want = new Set(weeks || []);
  const ids = new Set(teamIds || []);
  const lists = new Map();
  for (const g of games || []) {
    if (!want.has(g.week) || g.homeId == null || g.awayId == null) continue;
    const forWeek = totals.get(g.week);
    if (!forWeek) continue;
    for (const [id, oppId] of [[g.homeId, g.awayId], [g.awayId, g.homeId]]) {
      if (!ids.has(id)) continue;
      const own = forWeek.get(id);
      const opp = forWeek.get(oppId);
      if (typeof own !== 'number' || typeof opp !== 'number') continue;
      if (!lists.has(id)) lists.set(id, []);
      lists.get(id).push({ week: g.week, oppId, own, opp, gap: round1(own - opp) });
    }
  }
  const out = new Map();
  for (const [id, list] of lists) {
    list.sort((a, b) => a.week - b.week);
    // THE PRINTED GAP IS ITS TWO PRINTED ENDS SUBTRACTED: the squad's average
    // and its opponents' average, each to the tenth, then the difference — so
    // the figure can be checked against the two averages beside it. Averaging
    // the rounded weekly gaps instead can land a tenth away.
    const own = meanTenth(list.map((x) => x.own));
    const opp = meanTenth(list.map((x) => x.opp));
    out.set(id, {
      avg: round1(own - opp), own, opp,
      raw: rawMean(list.map((x) => x.own - x.opp)),
      games: list,
    });
  }
  return out;
}
