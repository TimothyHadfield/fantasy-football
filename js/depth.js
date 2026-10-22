// DEPTH — the Value a squad keeps off its lineup.
//
// Tim, 2026-10-22: "in the trade section, in the chart that shows all teams,
// proj avg 2026, could you add a column on the left titled "depth" that is the
// combined current value of the players on that team that start less than 20%
// of the remaining games of the season?"
//
// So, per squad: every man on its roster, how many of the regular-season weeks
// still to come he STARTS in — "starts" is the site's own best legal lineup
// for that week (js/who-to-start.js `weeklyFills`, the same fills the grid's
// slot columns average) — and, of the men who start in fewer than 20% of those
// weeks, their Values added up. Value is the one figure on every card
// (`value.playerValue`, read through the page's lookup).
//
// The share is starts ÷ the weeks counted, STRICTLY under 0.2: one start in
// five weeks is 20% and is NOT depth. A man on a bye or hurt simply does not
// start that week, so he is judged by the same rule (ESPN projects an out man
// low or 0, and the lineup leaves him out).
//
// Pure: no DOM, no page state, no fetching.

/** Under this share of the weeks counted, a man is depth. */
export const DEPTH_SHARE = 0.2;

const r1 = (n) => Math.round(n * 10) / 10;
const idOf = (p) => String(p && (p.playerId ?? p.name));

/**
 * How often each man starts for one squad.
 *
 * @param {Map<number, Map<*, Map<string, {p:object}|null>>>} fills week -> team -> slot -> entry
 * @param {number[]} weeks  the weeks to count (still to come, regular season)
 * @param {*} teamId
 * @returns {{weeks:number, starts:Map<string, number>}} `weeks` is how many of
 *   them have a lineup read for this squad; a week not read yet is not counted.
 */
export function startCounts(fills, weeks, teamId) {
  const starts = new Map();
  let n = 0;
  for (const w of weeks) {
    const perTeam = fills && fills.get(w);
    const fill = perTeam ? perTeam.get(teamId) : null;
    if (!fill) continue;
    n += 1;
    const seen = new Set();
    for (const e of fill.values()) {
      if (!e || !e.p) continue;
      const k = idOf(e.p);
      if (seen.has(k)) continue;
      seen.add(k);
      starts.set(k, (starts.get(k) || 0) + 1);
    }
  }
  return { weeks: n, starts };
}

/** True when `starts` of `weeks` is under the 20% line. */
export function isDepth(starts, weeks) {
  return weeks > 0 && starts / weeks < DEPTH_SHARE;
}

/**
 * One squad's Depth.
 *
 * @param {Array<{playerId:*, name:string}>} players  the squad's roster now
 * @param {Map} fills    as `startCounts`
 * @param {number[]} weeks
 * @param {*} teamId
 * @param {((playerId:*) => number|null)|null} valueOf  the page's Value lookup;
 *   null while the lines are not in (the cell is then a dash, never a 0)
 * @returns {{value:number|null, weeks:number, men:Array<{playerId:*, name:string,
 *   starts:number, value:number|null}>}|null}  null when no week is read yet
 */
export function teamDepth(players, fills, weeks, teamId, valueOf) {
  const { weeks: n, starts } = startCounts(fills, weeks, teamId);
  if (n === 0) return null;
  const men = (players || [])
    .map((p) => {
      const s = starts.get(idOf(p)) || 0;
      if (!isDepth(s, n)) return null;
      const v = typeof valueOf === 'function' ? valueOf(p.playerId) : null;
      return { playerId: p.playerId ?? null, name: p.name, starts: s, value: Number.isFinite(v) ? r1(v) : null };
    })
    .filter(Boolean)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));
  // Added from the tenths the card prints, so its rows add up to the cell.
  const value = typeof valueOf === 'function'
    ? r1(men.reduce((t, m) => t + (m.value ?? 0), 0))
    : null;
  return { value, weeks: n, men };
}
