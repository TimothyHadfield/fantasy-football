// WHICH POSITIONS A SQUAD NEEDS, AND WHICH IT HAS.
//
// Tim, 2026-10-15: "Show the position that each user needs in the custom trade
// section so that it's easier to identify what a good trade might be. Don't
// include K or DEF. Positions that the user needs are red in the analysis
// section and positions that the user has are in green."
//
// THE ANALYSIS PAGE'S RED AND GREEN are its All teams grid on "Proj avg": one
// column per lineup slot, each cell that squad's slot averaged over the weeks
// (whoever fills it, week by week, at no less than the waiver floor), coloured
// against the same slot of every other squad (js/heat.js, per column). This
// builds the same thing from the same shared pieces — the best legal lineup
// each week (`bestFill`), the slot assessed at the floor (`assessSlot`), the
// mean to the tenth (`meanTenth`), the scale per column (`heatScale`/`heatOf`)
// — on the rosters and weeks the caller hands in.
//
// A POSITION IS NEEDED when any of its slots is red (RB1 or RB2 below the
// league), and HAD when one is green and none is red. FLEX and other mixed
// slots, K and D/ST name no position and are left out.
//
// Pure: no DOM, no page state.

import { bestFill, assessSlot, meanTenth } from './lineup-avg.js';
import { slotRows } from './lineup-slots.js';
import { heatScale, heatOf } from './heat.js';

/** The positions a need can name, in the order they are printed. */
export const NEED_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/**
 * Every squad's per-slot average over `weeks`.
 *
 * @param {object} o
 * @param {Array<{id, players:Array}>} o.teams the rosters
 * @param {number[]} o.weeks regular-season weeks to average
 * @param {number[]} o.slots the league's starting slot ids
 * @param {(p, week:number)=>number|null} o.projOf a man's projection that week
 * @param {Map|null} [o.floors] js/floor.js positional floors
 * @returns {{rows:Array, byTeam:Map<*, Map<string, number|null>>}}
 */
export function slotAverages({ teams, weeks, slots, projOf, floors = null }) {
  const rows = slotRows(slots || []);
  const byTeam = new Map();
  for (const t of teams || []) {
    const values = new Map(rows.map((r) => [r.key, []]));
    for (const w of weeks || []) {
      let any = false;
      const players = (t.players || []).map((p) => {
        const v = projOf(p, w);
        if (typeof v === 'number') any = true;
        return { ...p, projected: typeof v === 'number' ? v : 0 };
      });
      // A week nobody on the squad has a number for has not been read: it is
      // not a week of zeros.
      if (!any) continue;
      const fill = bestFill(players, slots, rows);
      for (const r of rows) {
        const a = assessSlot(fill.get(r.key) || null, r, floors);
        if (a.value !== null) values.get(r.key).push(a.value);
      }
    }
    byTeam.set(t.id, new Map(rows.map((r) => [r.key, meanTenth(values.get(r.key))])));
  }
  return { rows, byTeam };
}

/**
 * One squad's needed and had positions, from `slotAverages`.
 * @returns {{need:string[], has:string[]}}
 */
export function positionNeeds({ rows, byTeam }, teamId) {
  const mine = byTeam.get(teamId);
  if (!mine) return { need: [], has: [] };
  const red = new Set();
  const green = new Set();
  for (const r of rows || []) {
    if (!NEED_POSITIONS.includes(r.base)) continue;
    const scale = heatScale([...byTeam.values()].map((m) => m.get(r.key)));
    const h = heatOf(mine.get(r.key), scale);
    if (!h) continue;
    if (h.dir < 0) red.add(r.base);
    else if (h.dir > 0) green.add(r.base);
  }
  return {
    need: NEED_POSITIONS.filter((p) => red.has(p)),
    has: NEED_POSITIONS.filter((p) => green.has(p) && !red.has(p)),
  };
}
