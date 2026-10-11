// The trade offers waiting on ESPN for one team, out of ESPN's own answer.
//
// Pure: no reads, no storage, no clock unless one is handed in. js/season.js
// `fetchPendingTrades` is the one caller that asks ESPN (or the synced copy).
//
// ---------------------------------------------------------------------------
// THE SHAPE IS DOCUMENTED, NOT MEASURED — read this before trusting a field.
// ---------------------------------------------------------------------------
//
// ESPN's league read with `view=mPendingTransactions` answers with a
// `pendingTransactions` list ONLY to a logged-in owner of a team in the league.
// Measured 2026-10-11 on public league 1241838: the view is accepted and the
// key is simply not there. So nothing below could be run against a real
// payload (rule: never Tim's account, never his cookies). It is written from
// what other people's code reads and writes, and is tolerant of all of it
// being slightly different:
//
//   {
//     pendingTransactions: [{
//       id: '<uuid>',               // the proposal's id
//       type: 'TRADE_PROPOSAL',     // waiver claims ride the same list (WAIVER)
//       status: 'PENDING',          // also seen described as `isPending: true`
//       executionType: 'EXECUTE',   // 'CANCEL' on the copy that closes one
//       teamId: 3,                  // the team that PROPOSED it
//       memberId: '{...}',
//       proposedDate: 1760000000000,      // epoch ms on a read
//       expirationDate: 1760172800000,    // epoch ms on a read; an ISO string
//                                         // ('...T..:..:...000Z') when written
//       relatedTransactionId: '<uuid>',   // on the record that answers one
//       teamActions: { ... },
//       items: [
//         { type: 'TRADE', playerId: 111, fromTeamId: 3, toTeamId: 1 },
//         { type: 'TRADE', playerId: 222, fromTeamId: 1, toTeamId: 3 },
//       ],
//     }],
//   }
//
// SOURCES (read 2026-10-11):
//   github.com/dustinJ15/fantasy  src/ff/sources/espn.py  `pending_trades` —
//     the closest thing to a measurement: it reads this very view, says it was
//     probed live on three leagues on 2026-10-08, and takes `type ==
//     'TRADE_PROPOSAL'`, `items[]` of `type == 'TRADE'` with `playerId` /
//     `fromTeamId` / `toTeamId`, `teamId` as the proposer, `proposedDate`,
//     `expirationDate`, `status`, `teamActions`. Its `trade_resolutions` is
//     where "a decline is a `TRADE_DECLINE` naming the proposal by
//     `relatedTransactionId`, plus a copy of the proposal with `executionType:
//     'CANCEL'`, `status: 'CANCELED'`" comes from, and "ESPN cancels a lapsed
//     one about a minute after `expirationDate`".
//   github.com/keetsm1/fantasy-agent  fetching_data/espn.py
//     `fetch_trade_proposals` — the same view; pending is `isPending` OR
//     `status == 'PENDING'`; accept / decline are `TRADE_ACCEPT` /
//     `TRADE_DECLINE` with `relatedTransactionId`.
//   github.com/cwendt94/espn-api  espn_api/football/transaction.py — a
//     transaction's `id`, `teamId`, `type`, `status`, `scoringPeriodId`,
//     `proposedDate`, `relatedTransactionId`, `memberId`, and an item's `type`,
//     `playerId`, `fromTeamId`, `toTeamId` (PR #704 adds the trade legs).
//   github.com/piercetalbert/espn-ai-manager  CAPTURE_ESPN_WRITES.md and
//   github.com/garavitgabriel/espn-fantasy-claude-openclaw
//     docs/writes/wt-c-trades.md — the proposal as it is WRITTEN: one `TRADE`
//     item per man, mirrored `fromTeamId` / `toTeamId`, `expirationDate` as an
//     ISO string.
//   github.com/DanielTomaro13/sportsdata-mcp  documentation/ESPNFantasy.md —
//     "`pendingTransactions[]` when any exist ... Key is absent (not empty) when
//     nothing is pending."
//   (github.com/mkreiser/ESPN-Fantasy-Football-API does not cover this view.)
//
// WHAT IS TOLERATED, because nobody here has seen one:
//   - the payload, or the list itself, may be handed in; anything else is [].
//   - a date as epoch ms, as a numeric string or as an ISO string; else null.
//   - "still pending" is: not a CANCEL copy, `status` either missing or
//     'PENDING', `isPending` not false, not named by another record's
//     `relatedTransactionId` (an accept, a decline, a cancel), and — when the
//     caller hands in the time — not past its `expirationDate`.
//   - an item counts when it moves a man between two different real teams,
//     whatever its own `type` says (js/espn.js `parseTransactions` reads an
//     executed trade the same way). A cut riding along has one team and is not
//     a trade item.
//   - AN OFFER THAT TOUCHES A THIRD TEAM IS SKIPPED WHOLE. ESPN trades are
//     between two teams; one that is not cannot be shown as "you and him".
//   - a D/ST's player id is NEGATIVE on ESPN (-16001 …), so an id is any whole
//     number but 0.

/** How many offers a synced copy carries, and how many men a side may name. */
export const MAX_OFFERS = 20;
const MAX_PLAYERS = 24;
const MAX_ID_LENGTH = 80;

const teamOf = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const playerOf = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n !== 0 ? n : null;
};

/** Epoch ms out of whatever ESPN sent, or null. */
function stamp(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0 ? n : null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > 0 ? t : null;
}

const idOf = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).trim();
  return s && s.length <= MAX_ID_LENGTH ? s : '';
};

/** Has this offer's time run out? Only an offer that names one can. */
export function expired(offer, now) {
  return Number.isFinite(now) && offer && typeof offer.expiresAt === 'number' && offer.expiresAt <= now;
}

/**
 * The trade proposals still waiting that involve `myTeamId`.
 *
 * @param {Object|Array} raw a `view=mPendingTransactions` payload, or its
 *   `pendingTransactions` list
 * @param {number|string} myTeamId
 * @param {Object} [opts]
 * @param {number} [opts.now] epoch ms; when given, an offer past its
 *   `expirationDate` is left out
 * @returns {Array<{id:string, withTeamId:number, get:number[], send:number[],
 *   proposedAt:number|null, expiresAt:number|null, fromMe:boolean|null}>}
 *   `get` = the men coming TO my team, `send` = the men leaving it, `fromMe` =
 *   my team proposed it (null when ESPN did not say who did). ESPN's order.
 *   Never throws.
 */
export function pendingTrades(raw, myTeamId, opts) {
  try {
    const list = Array.isArray(raw) ? raw
      : (raw && typeof raw === 'object' && Array.isArray(raw.pendingTransactions)) ? raw.pendingTransactions
        : null;
    const me = teamOf(myTeamId);
    if (!list || me === null) return [];
    const now = opts && Number.isFinite(opts.now) ? opts.now : null;

    // Every proposal some OTHER record on the list answers or closes.
    const closed = new Set();
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const rel = idOf(t.relatedTransactionId);
      if (rel && rel !== idOf(t.id)) closed.add(rel);
    }

    const out = [];
    const seen = new Set();
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      if (t.type !== 'TRADE_PROPOSAL') continue;
      if (t.executionType === 'CANCEL') continue;
      if (t.status !== undefined && t.status !== null && t.status !== 'PENDING') continue;
      if (t.isPending === false) continue;
      const ownId = idOf(t.id);
      if (ownId && closed.has(ownId)) continue;
      if (!Array.isArray(t.items)) continue;

      const get = [];
      const send = [];
      const others = new Set();
      let broken = false;
      for (const i of t.items) {
        if (!i || typeof i !== 'object') continue;
        const from = teamOf(i.fromTeamId);
        const to = teamOf(i.toTeamId);
        if (from === null || to === null || from === to) continue;   // a cut, or nothing
        const player = playerOf(i.playerId);
        if (player === null) { broken = true; break; }
        if (from !== me) others.add(from);
        if (to !== me) others.add(to);
        if (to === me && !get.includes(player)) get.push(player);
        if (from === me && !send.includes(player)) send.push(player);
      }
      // Not mine, a third team in it, or a man ESPN gave no id for.
      if (broken || others.size !== 1 || (!get.length && !send.length)) continue;
      if (get.length > MAX_PLAYERS || send.length > MAX_PLAYERS) continue;

      const withTeamId = [...others][0];
      const proposer = teamOf(t.teamId);
      const offer = {
        // An offer ESPN gave no id for is still an offer: named by what is in it.
        id: ownId || `${withTeamId}:${[...get].sort((a, b) => a - b).join('.')}>${[...send].sort((a, b) => a - b).join('.')}`,
        withTeamId,
        get,
        send,
        proposedAt: stamp(t.proposedDate),
        expiresAt: stamp(t.expirationDate),
        fromMe: proposer === null ? null : proposer === me,
      };
      if (now !== null && expired(offer, now)) continue;
      if (seen.has(offer.id)) continue;
      seen.add(offer.id);
      out.push(offer);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Offers cut to the contract's own fields and to a bounded size — what goes
 * into the synced copy, and what is believed when it comes back out of it.
 * Anything that is not an offer is dropped; never throws.
 *
 * @param {Array} offers `pendingTrades`' answer, or what a synced copy holds
 * @param {number} [max=MAX_OFFERS]
 */
export function cleanOffers(offers, max = MAX_OFFERS) {
  if (!Array.isArray(offers)) return [];
  const out = [];
  for (const o of offers) {
    if (out.length >= max) break;
    try {
      if (!o || typeof o !== 'object') continue;
      const id = idOf(o.id);
      const withTeamId = teamOf(o.withTeamId);
      if (!id || withTeamId === null || !Array.isArray(o.get) || !Array.isArray(o.send)) continue;
      const get = o.get.map(playerOf);
      const send = o.send.map(playerOf);
      if (get.includes(null) || send.includes(null)) continue;
      if ((!get.length && !send.length) || get.length > MAX_PLAYERS || send.length > MAX_PLAYERS) continue;
      out.push({
        id,
        withTeamId,
        get,
        send,
        proposedAt: stamp(o.proposedAt),
        expiresAt: stamp(o.expiresAt),
        fromMe: typeof o.fromMe === 'boolean' ? o.fromMe : null,
      });
    } catch { /* not an offer */ }
  }
  return out;
}
