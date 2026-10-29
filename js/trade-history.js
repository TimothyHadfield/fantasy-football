// EVERY TRADE WITH ONE MANAGER, under the custom box's two lists (Tim,
// 2026-10-28: "Undearneath the player selectoin area in the custom trade show
// all past trades you've made or offered with that user so you don't
// accidentily send the same or too similar of a trade.").
//
// Pure (tests/custom-trade-check.mjs). Three sources, all already read by the
// Trade page, so this costs no ESPN request:
//   moves    the season's trades, as js/season.js `fetchDecisionWorld` reads
//            them for js/past-trades.js: `{ kind:'trade', week, at, teamId,
//            trade:{ withTeamId, gives, gets } }`
//   ended    your sent offers that ended without going through
//            (js/trade-outcome.js `readSent(...).ended`): `{ withTeamId, get,
//            send, reason, at, proposedAt, getNames?, sendNames? }`
//   pending  the offers waiting now (js/pending.js `pendingTrades`):
//            `{ withTeamId, get, send, proposedAt, fromMe, review? }`
// Offers are YOURS only (`me`): with another squad in the box, only its trades.

const id = (v) => String(v);

/** The words for each line's status. */
export const STATUS_WORDS = {
  traded: 'Traded',
  declined: 'Declined',
  expired: 'Expired',
  vetoed: 'Vetoed',
  gone: 'No longer pending',
  review: 'Accepted, in review',
  sent: 'Pending, sent by you',
  received: 'Pending, sent to you',
  pending: 'Pending',
};

const stamp = (v) => (Number.isFinite(v) && v > 0 ? v : null);
const names = (ids, list) => (Array.isArray(list) ? ids.map((_, i) => (typeof list[i] === 'string' ? list[i] : '')) : ids.map(() => ''));

/**
 * @param {Object} o
 * @param {Array} [o.moves]
 * @param {Array} [o.ended]
 * @param {Array} [o.pending]
 * @param {number|string} o.a   the box's left squad ("you")
 * @param {number|string} o.b   the partner
 * @param {number|string|null} [o.me] the reader's own team; offers count only when a = me
 * @returns {Array<{status:string, week:number|null, at:number|null,
 *   give:string[], get:string[], giveNames:string[], getNames:string[]}>}
 *   newest first; `give` = the men leaving `a`. Never throws.
 */
export function tradeHistory({ moves = [], ended = [], pending = [], a, b, me = null } = {}) {
  const out = [];
  try {
    if (a === null || a === undefined || b === null || b === undefined) return out;
    const A = id(a);
    const B = id(b);
    for (const m of Array.isArray(moves) ? moves : []) {
      if (!m || m.kind !== 'trade' || !m.trade) continue;
      const t = id(m.teamId);
      const w = id(m.trade.withTeamId);
      const gives = (m.trade.gives || []).map(id);
      const gets = (m.trade.gets || []).map(id);
      let give;
      let get;
      if (t === A && w === B) { give = gives; get = gets; }
      else if (t === B && w === A) { give = gets; get = gives; }
      else continue;
      if (!give.length && !get.length) continue;
      out.push({
        status: 'traded', week: Number.isFinite(Number(m.week)) && m.week !== null ? Number(m.week) : null,
        at: stamp(m.at), give, get, giveNames: give.map(() => ''), getNames: get.map(() => ''),
      });
    }
    const mine = me !== null && me !== undefined && id(me) === A;
    if (mine) {
      for (const e of Array.isArray(ended) ? ended : []) {
        if (!e || id(e.withTeamId) !== B || !STATUS_WORDS[e.reason]) continue;
        const give = (e.send || []).map(id);
        const get = (e.get || []).map(id);
        if (!give.length && !get.length) continue;
        out.push({
          status: e.reason, week: null, at: stamp(e.proposedAt) ?? stamp(e.at),
          give, get, giveNames: names(give, e.sendNames), getNames: names(get, e.getNames),
        });
      }
      for (const p of Array.isArray(pending) ? pending : []) {
        if (!p || id(p.withTeamId) !== B) continue;
        const give = (p.send || []).map(id);
        const get = (p.get || []).map(id);
        if (!give.length && !get.length) continue;
        const status = p.review === true ? 'review' : p.fromMe === true ? 'sent' : p.fromMe === false ? 'received' : 'pending';
        out.push({ status, week: null, at: stamp(p.proposedAt), give, get, giveNames: give.map(() => ''), getNames: get.map(() => '') });
      }
    }
  } catch { /* what was read so far stands */ }
  // Newest first: waiting offers on top, then by time, then by week.
  const live = (s) => (s === 'review' || s === 'sent' || s === 'received' || s === 'pending' ? 1 : 0);
  return out
    .map((x, i) => ({ x, i }))
    .sort((p, q) => live(q.x.status) - live(p.x.status) ||
      (q.x.at ?? 0) - (p.x.at ?? 0) || (q.x.week ?? 0) - (p.x.week ?? 0) || p.i - q.i)
    .map(({ x }) => x);
}
