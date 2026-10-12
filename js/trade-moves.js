// WHAT A TRADE MAKES A MANAGER DO NEXT: who he must drop, and what he must add.
// Pure: no DOM, no network.
//
// Tim, 2026-10-12: "if the trade needs a player to drop someone, put it at the
// top as a list of players that user needs to drop. If it also shows you need
// to add a player, show the position you need to add from the waivers after
// the trade."
//
// THE DROPS ARE THE PRICING'S OWN: `priceTradeAcrossWeeks(...).cut` (js/trade.js
// `afterTrade`), the men the roster limit forces out. Nothing is chosen here.
//
// THE ADDS ARE COUNTED OFF THE ROSTER THE TRADE LEAVES: a position with fewer
// men than the league starts at it, when the trade is what took them. Only
// one-position slots are counted (QB, RB, WR, TE, K, D/ST): a FLEX can be
// filled from more than one position, so an empty one names no position.

/** A defence is 'D/ST' on some rows and 'DST' as a key. */
const key = (pos) => (pos === 'D/ST' ? 'DST' : pos || '');
const label = (pos) => (pos === 'DST' ? 'D/ST' : pos);

function countByPosition(players) {
  const n = new Map();
  for (const p of players || []) {
    const k = key(p && p.position);
    if (k) n.set(k, (n.get(k) || 0) + 1);
  }
  return n;
}

/**
 * The positions a squad is left short at by a trade.
 *
 * @param {Array} before the roster before the trade
 * @param {Array} after  the roster after it, forced drops already out
 * @param {number[]} slots the league's starting lineupSlotIds
 * @param {Object} eligibility slotId -> positions (js/espn.js `SLOT_ELIGIBILITY`)
 * @returns {Array<{position:string, label:string, count:number}>} in slot order
 */
export function positionsToAdd(before, after, slots, eligibility) {
  const want = new Map();
  for (const s of slots || []) {
    const el = eligibility && eligibility[s];
    if (el && el.length === 1) want.set(el[0], (want.get(el[0]) || 0) + 1);
  }
  const had = countByPosition(before);
  const has = countByPosition(after);
  const out = [];
  for (const [position, starts] of want) {
    const now = has.get(position) || 0;
    // Short already, and no shorter for the trade: not this trade's doing.
    if (now >= starts || now >= (had.get(position) || 0)) continue;
    out.push({ position, label: label(position), count: starts - now });
  }
  return out;
}

/**
 * The two lists for one side of a priced trade.
 *
 * @param {Object} o
 * @param {Array} o.before his roster now
 * @param {{cut:Array, roster:Array}} o.priced his side of `priceTradeAcrossWeeks`
 * @returns {{drop:Array<{playerId:*, name:string, position:string}>, add:Array}}
 */
export function movesFor({ before, priced, slots, eligibility }) {
  if (!priced) return { drop: [], add: [] };
  const drop = (priced.cut || []).map((p) => ({
    playerId: p.playerId, name: p.name || '', position: label(key(p.position)),
  }));
  return { drop, add: positionsToAdd(before, priced.roster || [], slots, eligibility) };
}
