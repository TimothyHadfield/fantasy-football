// A lineup, laid out SLOT BY SLOT: QB, RB1, RB2, WR1, WR2, WR3, TE, FLEX, D/ST, K.
//
// `js/forecast.js`'s `optimalLineup` answers "who starts, and in which slot".
// It does NOT answer "which of the two receivers is WR1", because nothing in a
// legal lineup makes that distinction — ESPN's WR1 and WR2 are the same slot id
// twice over. That ranking is a PRESENTATION rule, and this module is the one
// place it lives.
//
// WHY IT IS ITS OWN FILE. The analysis page's rebuilt "Season by week" panel
// invented this rule (Tim, 2026-09-17: "label the positions as QB, WR1, WR2,
// etc. and then put the player with the proj that matches that position"), and
// the Trade page's per-week breakdown has to lay a lineup out the SAME way — a
// manager reading WR2 on one page and WR2 on the other must be reading the same
// claim. Two copies of a ranking rule is exactly how two panels quietly stop
// agreeing about a lineup neither of them is wrong about on its own.
//
// The rule itself, in two halves:
//
//   `slotRows`  the league's shape as rows. The slot ids come from the lineups
//               ESPN has already accepted (`slotsForLeague`), never from a
//               hand-written default — a three-receiver league gets WR1/WR2/WR3
//               and a two-receiver one gets WR1/WR2 without this file being
//               told which it is. A position the league starts exactly one of
//               keeps its bare label, because a number that can only be 1 is
//               noise.
//   `fillSlots` one week's starters handed out to those rows, ranked inside
//               their own slot on that week's projection. So WR1 is the better
//               of the two receivers the lineup actually contains, whoever he
//               is, and a bye simply moves the names down a row.
//
// NOTHING HERE READS PAGE STATE. It is pure, so it is node-testable and so
// neither page can repaint the other's answer.
//
// ONE COPY, TWO PAGES. js/analysis-page.js (the "Season by week" sheet) and
// js/trade-page.js (the per-week before/after breakdown in the deal pop-up)
// both import from here. These functions started life in analysis-page and
// were lifted out the moment a second page needed them, because two squads'
// worth of "what does WR2 mean" is exactly the sort of thing that drifts.

import * as espn from './espn.js';

/**
 * Lineup order: starters as a manager reads them, then the bench, then IR.
 *
 * Sorting on the visible LABEL would put "BE" above "QB" and "D/ST" above
 * "FLEX", which is nonsense — the order is a fact about a lineup, not about the
 * alphabet. Taken verbatim from js/analysis-page.js so the two cannot disagree.
 */
export const SLOT_ORDER = {
  0: 1, 1: 1,               // QB / team QB
  2: 2,                     // RB
  4: 3,                     // WR
  6: 4,                     // TE
  3: 5, 5: 5, 23: 5,        // the flex family
  7: 6,                     // OP — reads next to the flex, but it can hold a QB,
                            // so a FLEX rule must never treat it as one
  16: 7,                    // D/ST
  17: 8,                    // K
  18: 9, 19: 10,            // P, HC
  20: 50,                   // bench
  21: 51,                   // IR
};

const round1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);

/**
 * The league's starting slots as ROWS: one per slot, in lineup order, numbered
 * within a position when the league starts more than one of it.
 *
 * @param {number[]} slots lineupSlotIds the league starts, e.g. [0,2,2,4,4,6,23,16,17]
 * @returns {Array<{key:string, base:string, slotId:number, rank:number, order:number}>}
 */
export function slotRows(slots) {
  if (!slots || !slots.length) return [];
  const counts = new Map();
  for (const id of slots) counts.set(id, (counts.get(id) || 0) + 1);
  const ids = [...counts.keys()]
    .sort((a, b) => (SLOT_ORDER[a] ?? 40) - (SLOT_ORDER[b] ?? 40) || a - b);

  const out = [];
  for (const id of ids) {
    const n = counts.get(id);
    const base = espn.SLOT_LABELS[id] ?? String(id);
    for (let i = 1; i <= n; i++) {
      out.push({ key: n > 1 ? `${base}${i}` : base, base, slotId: id, rank: i, order: out.length });
    }
  }
  return out;
}

/**
 * Hand one week's best lineup out to the slot rows.
 *
 * The solver says which SLOT ID each man fills; the ranking INSIDE a slot is
 * this function's own, and it is done on that week's projection so "WR2" always
 * means the second-best receiver of the ones the lineup actually contains. The
 * playerId tiebreak stops two identical projections trading rows between
 * repaints, which would light up as a change that never happened.
 *
 * A row nobody fills comes back `null` rather than missing, because an empty
 * slot is an answer — it is what a squad with no fit legal man looks like.
 *
 * @param {Array} starters `optimalLineup(...).starters`, each carrying `slotId`
 * @param {Array} rows the output of `slotRows`
 * @returns {Map<string, {p:object, v:number}|null>} slot key -> who is in it
 */
export function fillSlots(starters, rows) {
  const bySlot = new Map();
  for (const s of starters || []) {
    if (!bySlot.has(s.slotId)) bySlot.set(s.slotId, []);
    bySlot.get(s.slotId).push(s);
  }
  for (const list of bySlot.values()) {
    list.sort((a, b) =>
      (b.projected ?? -Infinity) - (a.projected ?? -Infinity) ||
      (a.playerId ?? 0) - (b.playerId ?? 0));
  }

  const out = new Map();
  for (const row of rows || []) {
    const pick = (bySlot.get(row.slotId) || [])[row.rank - 1] || null;
    out.set(row.key, pick ? { p: pick, v: round1(pick.projected) } : null);
  }
  return out;
}
