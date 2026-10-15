// NO BUYING BACK WHAT YOU TRADED (Tim, 2026-10-15: "could you adjust the trade
// algorithm so that it doesn't suggest trades from players that you've already
// traded with that user? Ex: I give away saquon Barkely, so don't suggest I buy
// him back from the same user, or vice versa.")
//
// Pure functions only (tests/test-past-trades.mjs). The moves are the season's
// as js/season.js `fetchDecisionWorld` reads them — ESPN's own trade records and
// the trades found from the rosters (`inferTrades`) — each a trade move
// `{ kind: 'trade', teamId, trade: { withTeamId, gives, gets } }`.
//
// THE RULE, per manager you have traded with:
//   - a man you SENT him may not come back to you from him;
//   - a man you GOT from him may not go back to him.
// Only that pair: the same man with any other manager is a different deal.

const key = (id) => String(id);

/**
 * @param {Array} moves the season's moves
 * @param {number|string} myTeamId
 * @returns {Map<string, {sent:Set<string>, got:Set<string>}>} partner id ->
 *   the men you sent him and the men you got from him (ids as strings)
 */
export function pastTradeBars(moves, myTeamId) {
  const me = key(myTeamId);
  const bars = new Map();
  const of = (partner) => {
    if (!bars.has(partner)) bars.set(partner, { sent: new Set(), got: new Set() });
    return bars.get(partner);
  };
  for (const m of moves || []) {
    if (!m || m.kind !== 'trade' || !m.trade) continue;
    const a = key(m.teamId);
    const b = key(m.trade.withTeamId);
    const gives = (m.trade.gives || []).map(key);
    const gets = (m.trade.gets || []).map(key);
    if (a === me) {
      const bar = of(b);
      for (const id of gives) bar.sent.add(id);
      for (const id of gets) bar.got.add(id);
    } else if (b === me) {
      const bar = of(a);
      for (const id of gets) bar.sent.add(id);
      for (const id of gives) bar.got.add(id);
    }
  }
  return bars;
}

/**
 * Does this offer undo part of a trade already made with its manager?
 * @param {{partner:{id}, send:Array, receive:Array}} offer
 * @param {Map} bars `pastTradeBars`
 */
export function undoesPastTrade(offer, bars) {
  if (!offer || !offer.partner || !bars || !bars.size) return false;
  const bar = bars.get(key(offer.partner.id));
  if (!bar) return false;
  const idOf = (p) => key(p && typeof p === 'object' ? p.playerId : p);
  return (offer.receive || []).some((p) => bar.sent.has(idOf(p))) ||
    (offer.send || []).some((p) => bar.got.has(idOf(p)));
}
