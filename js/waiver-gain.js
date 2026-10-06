// GAIN — what adding one free agent is worth to YOUR lineup.
//
// ESPN shows a free agent's projection. It never solves your lineup with him
// in it, and that is the only number a claim is really about: a 14-point
// receiver is worth nothing to a squad already starting three better ones, and
// a 7-point kicker is worth a week to a squad whose kicker is on bye.
//
// So, for one free agent: add him, drop the roster man whose loss costs the
// lineups least, and take the change in the best legal lineup over the weeks
// still to play —
//
//   per week = (best lineup with him, without the dropped man) − (best lineup today)
//
// THERE IS NO SECOND SOLVER AND NO SECOND CUT RULE IN HERE. An add-and-drop is
// a trade that sends nobody and receives one man, and the Trade engine already
// prices exactly that: `priceTradeAcrossWeeks` fills every week with
// `optimalLineup`, assesses it with the positional floor (js/floor.js — no slot
// below the waiver wire) and applies the forced cut of 2026-09-30 (the man
// whose removal costs the priced weeks fewest points). This file hands it the
// roster and the free agent and reads the answer back, so a number here and
// the same move priced on the Trade page cannot disagree.
//
// WHAT IS ITS OWN is the prune, which only ever SKIPS that call — see
// `cannotStart`. tests/test-waiver-gain.mjs prices every pruned man the long
// way and checks the answer was 0.
//
// Pure, and node-testable: the roster, the weeks and the projections come IN.

import { SLOT_ELIGIBILITY } from './espn.js';
import { priceTradeAcrossWeeks, seasonLineupValue } from './trade.js';

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Everything about YOUR side that is the same for every free agent, worked out
 * once: the best lineup of each week as the roster stands, and from it the bar
 * a free agent has to clear at his position that week.
 *
 * THE BAR is the lowest projection among your starters in the slots his
 * position may fill — or −Infinity when one of those slots stands empty, since
 * anybody at all would start there.
 *
 * @param {Object} o
 * @param {Array} o.players your roster, as `fetchWeekRosters` returns it
 * @param {number[]} o.slots lineupSlotIds the league starts
 * @param {number[]} o.weeks the weeks to price, ascending
 * @param {(player:Object, week:number) => number|null} o.projFor
 * @param {Map} [o.floors] the positional floor; null for none
 */
export function gainBase({ players, slots, weeks, projFor, floors = null }) {
  const ws = (weeks || []).slice();
  const mine = (players || []).slice();
  const sl = (slots || []).slice();
  const fill = seasonLineupValue(mine, sl, ws, projFor, floors);

  const bars = fill.byWeek.map((wk) => {
    const lowest = new Map();   // slotId -> its weakest starter's projection
    const filled = new Map();   // slotId -> how many of that slot are filled
    for (const s of wk.starters) {
      filled.set(s.slotId, (filled.get(s.slotId) || 0) + 1);
      lowest.set(s.slotId, Math.min(lowest.get(s.slotId) ?? Infinity, s.projected));
    }
    const asked = new Map();
    for (const id of sl) asked.set(id, (asked.get(id) || 0) + 1);

    const bar = new Map();      // position -> the number he must beat
    for (const [id, want] of asked) {
      const short = (filled.get(id) || 0) < want;
      const low = short ? -Infinity : lowest.get(id);
      for (const position of SLOT_ELIGIBILITY[id] || []) {
        bar.set(position, Math.min(bar.get(position) ?? Infinity, low));
      }
    }
    return bar;
  });

  return { players: mine, slots: sl, weeks: ws, projFor, floors, fill, bars };
}

/**
 * THE PRUNE: would this man start for you in NO priced week?
 *
 * `optimalLineup` gives a slot to the highest projection eligible for it, and a
 * level projection to the man listed first — the free agent joins at the END
 * of the roster. So he takes a slot only by projecting strictly ABOVE somebody
 * starting in a slot his position may fill, or by finding one empty. If neither
 * is true in any week, every week's lineup is the one you field today, he (or
 * another idle man) is the free cut, and the gain is exactly 0 — which is what
 * the engine would have returned after two more fills of every week.
 *
 * A week with no number for him (null) is a week he cannot start.
 */
export function cannotStart(base, player) {
  for (let i = 0; i < base.weeks.length; i++) {
    const v = base.projFor(player, base.weeks[i]);
    if (!Number.isFinite(v)) continue;
    const bar = base.bars[i].get(player.position);
    // No slot takes his position at all: `bar` is undefined, and he never starts.
    if (bar !== undefined && v > bar) return false;
  }
  return true;
}

/**
 * The gain from adding one free agent.
 *
 * @param {Object} base from `gainBase`
 * @param {Object} player the free agent — needs `playerId` and `position`
 * @param {Object} [opts]
 * @param {boolean} [opts.prune] false prices every man the long way (the tests)
 * @returns {{total:number, perWeek:number, weeks:Array<{week,before,after,delta}>,
 *            drop:Object|null, pruned:boolean}}
 *
 * `total` is points over all the priced weeks and `perWeek` is that spread over
 * them — the Trade page's "/wk" (its `perWeekOf`). `drop` is the roster man the
 * move costs you, or null when the cheapest man to cut is the free agent
 * himself (the claim is not worth making). A pruned man carries no `weeks`:
 * nothing was priced, because nothing could change.
 */
export function gainOf(base, player, { prune = true } = {}) {
  const n = base.weeks.length;
  if (!n || !base.players.length) return { total: 0, perWeek: 0, weeks: [], drop: null, pruned: false };
  if (prune && cannotStart(base, player)) {
    return { total: 0, perWeek: 0, weeks: [], drop: null, pruned: true };
  }

  const priced = priceTradeAcrossWeeks({
    players: base.players, send: [], receive: [player],
    slots: base.slots, weeks: base.weeks, projFor: base.projFor, floors: base.floors,
  });
  const cut = priced.cut[0] || null;
  const total = round1(priced.byWeek.reduce((a, w) => a + w.delta, 0));
  return {
    total,
    perWeek: total / n,
    weeks: priced.byWeek,
    drop: cut && cut.playerId !== player.playerId ? cut : null,
    pruned: false,
  };
}
