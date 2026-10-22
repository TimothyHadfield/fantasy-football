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
  if (!Number.isFinite(now) || !offer) return false;
  // An accepted trade in review is done once ESPN's time to carry it out passes.
  if (offer.review === true) return typeof offer.processAt === 'number' && offer.processAt <= now;
  return typeof offer.expiresAt === 'number' && offer.expiresAt <= now;
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
      // An ACCEPTED trade waiting out the league's review period is the same
      // record turned TRADE_ACCEPT, trade legs and all, with `processDate` the
      // time ESPN will carry it out (dustinJ15/fantasy `pending_trades`, probed
      // 2026-10-13: "An accepted trade stays in this view through the league's
      // review period"). Listed with `review: true` and `processAt`.
      const review = t.type === 'TRADE_ACCEPT';
      if (t.type !== 'TRADE_PROPOSAL' && !review) continue;
      if (t.executionType === 'CANCEL') continue;
      if (t.status !== undefined && t.status !== null && t.status !== 'PENDING' &&
        !(review && t.status === 'ACCEPTED')) continue;
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
      if (review) {
        // Accepted: its offer clock no longer applies; the review's does.
        offer.expiresAt = null;
        offer.review = true;
        offer.processAt = stamp(t.processDate);
      }
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
      const clean = {
        id,
        withTeamId,
        get,
        send,
        proposedAt: stamp(o.proposedAt),
        expiresAt: stamp(o.expiresAt),
        fromMe: typeof o.fromMe === 'boolean' ? o.fromMe : null,
      };
      // Only an accepted trade in review carries these two (see `pendingTrades`).
      if (o.review === true) {
        clean.expiresAt = null;
        clean.review = true;
        clean.processAt = stamp(o.processAt);
      }
      out.push(clean);
    } catch { /* not an offer */ }
  }
  return out;
}

// ===========================================================================
// THE OTHER MOVES WAITING: waiver claims, queued adds and drops, lineup moves
// ===========================================================================
//
// Tim, 2026-10-22: "If I have a player being pulled from the waivers that
// should show up somewhere. All of these types of things should be shown."
//
// THE SAME LIST, THE SAME CAVEAT: documented, not measured. A claim, as other
// people's code reads it off this very view:
//
//   {
//     id: '<uuid>', type: 'WAIVER', status: 'PENDING', executionType: 'EXECUTE',
//     teamId: 1,                    // whose claim it is
//     bidAmount: 7,                 // the FAAB bid; 0 in a priority league
//     proposedDate: 1760000000000,  // when it was made
//     processDate: 1760100000000,   // when ESPN runs it (the waiver run)
//     scoringPeriodId: 7,
//     items: [
//       { type: 'ADD',  playerId: 901, fromTeamId: 0, toTeamId: 1 },
//       { type: 'DROP', playerId: 103, fromTeamId: 1, toTeamId: 0 },
//     ],
//   }
//
// SOURCES (read 2026-10-22):
//   github.com/dustinJ15/fantasy  src/ff/sources/espn.py  `pending_claims` —
//     "the `WAIVER` records whose `teamId` is mine (probed 2026-10-21)": skips a
//     CANCEL copy and any status but PENDING / none, the ADD item's `playerId`
//     is the man claimed, the DROP item's the man cut, `bidAmount` ("0 in a
//     priority league"), `processDate`, `proposedDate`, `scoringPeriodId`.
//     `waiver_run_ts`: "the `processDate` it stamps on every pending claim in
//     the league (probed 2026-10-13: 03:00 ET the next processing day)". No
//     per-claim priority field is read there; the order below is ESPN's list
//     order, NOT a measured priority.
//   github.com/cwendt94/espn-api  espn_api/football/transaction.py — a
//     transaction's `bidAmount`, `processDate` / `proposedDate`, `status`,
//     `type`, and items' `type` / `playerId` / `fromTeamId` / `toTeamId`; types
//     FREEAGENT, WAIVER, WAIVER_ERROR (league.py `transactions`).
//
// WHAT IS LISTED: every record on the list whose `teamId` is mine that is not a
// trade (those are `pendingTrades`'), still pending by the same rule as an
// offer, with at least one ADD, DROP or LINEUP item of mine.
//   kind  'waiver'      a WAIVER claim
//         'free-agent'  a FREEAGENT add waiting (a lock, a game under way)
//         'drop'        any other record that only drops
//         'lineup'      a ROSTER record with lineup moves queued
//         'other'       anything else of mine with items, named by its type

/** How many other moves a synced copy carries. */
export const MAX_CLAIMS = 20;
const MAX_NAME = 60;

const nameOf = (v) => (typeof v === 'string' && v.trim() && v.length <= MAX_NAME ? v.trim() : null);

const KINDS = new Set(['waiver', 'free-agent', 'drop', 'lineup', 'other']);

/**
 * My other moves still waiting on ESPN.
 *
 * @param {Object|Array} raw a `view=mPendingTransactions` payload, or its list
 * @param {number|string} myTeamId
 * @returns {Array<{id:string, kind:string, add:number|null, drop:number|null,
 *   moves:number, bid:number|null, processAt:number|null,
 *   proposedAt:number|null, order:number}>}
 *   `add` / `drop` the first man added / cut, `moves` how many lineup moves,
 *   `bid` the FAAB bid when ESPN sent one (0 is a real bid in a priority
 *   league; shown only when above 0), `order` 1, 2, … in ESPN's order among my
 *   claims. Never throws.
 */
export function pendingClaims(raw, myTeamId) {
  try {
    const list = Array.isArray(raw) ? raw
      : (raw && typeof raw === 'object' && Array.isArray(raw.pendingTransactions)) ? raw.pendingTransactions
        : null;
    const me = teamOf(myTeamId);
    if (!list || me === null) return [];

    const closed = new Set();
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const rel = idOf(t.relatedTransactionId);
      if (rel && rel !== idOf(t.id)) closed.add(rel);
    }

    const out = [];
    const seen = new Set();
    let claims = 0;
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const type = typeof t.type === 'string' ? t.type : '';
      if (!type || type.startsWith('TRADE')) continue;
      if (teamOf(t.teamId) !== me) continue;
      if (t.executionType === 'CANCEL') continue;
      if (t.status !== undefined && t.status !== null && t.status !== 'PENDING') continue;
      if (t.isPending === false) continue;
      const ownId = idOf(t.id);
      if (ownId && closed.has(ownId)) continue;
      if (!Array.isArray(t.items)) continue;

      let add = null;
      let drop = null;
      let moves = 0;
      for (const i of t.items) {
        if (!i || typeof i !== 'object') continue;
        const player = playerOf(i.playerId);
        if (player === null) continue;
        if (i.type === 'ADD' && add === null) add = player;
        else if (i.type === 'DROP' && drop === null) drop = player;
        else if (i.type === 'LINEUP') moves++;
      }
      if (add === null && drop === null && moves === 0) continue;

      const kind = type === 'WAIVER' ? 'waiver'
        : type === 'FREEAGENT' ? 'free-agent'
          : add === null && drop !== null && moves === 0 ? 'drop'
            : type === 'ROSTER' && moves > 0 ? 'lineup'
              : 'other';
      const id = ownId || `${kind}:${add ?? ''}>${drop ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const bid = typeof t.bidAmount === 'number' && Number.isFinite(t.bidAmount) && t.bidAmount >= 0
        ? t.bidAmount : null;
      const claim = kind === 'waiver' || kind === 'free-agent';
      out.push({
        id,
        kind,
        add,
        drop,
        moves,
        bid,
        processAt: stamp(t.processDate),
        proposedAt: stamp(t.proposedDate),
        order: claim ? ++claims : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Moves cut to the contract's fields and a bounded size, for the synced copy
 * and for what is believed coming back out of it. Names the computer looked up
 * (`addName`, `dropName`, `addPos`) ride along when they are short strings.
 */
export function cleanClaims(claims, max = MAX_CLAIMS) {
  if (!Array.isArray(claims)) return [];
  const out = [];
  for (const c of claims) {
    if (out.length >= max) break;
    try {
      if (!c || typeof c !== 'object') continue;
      const id = idOf(c.id);
      const kind = KINDS.has(c.kind) ? c.kind : null;
      const add = c.add === null || c.add === undefined ? null : playerOf(c.add);
      const drop = c.drop === null || c.drop === undefined ? null : playerOf(c.drop);
      const moves = Number.isInteger(c.moves) && c.moves >= 0 && c.moves < 100 ? c.moves : 0;
      if (!id || !kind || (add === null && drop === null && moves === 0)) continue;
      const bid = typeof c.bid === 'number' && Number.isFinite(c.bid) && c.bid >= 0 && c.bid < 100000 ? c.bid : null;
      const clean = {
        id, kind, add, drop, moves, bid,
        processAt: stamp(c.processAt),
        proposedAt: stamp(c.proposedAt),
        order: Number.isInteger(c.order) && c.order >= 0 && c.order < 100 ? c.order : 0,
      };
      for (const k of ['addName', 'dropName', 'addPos']) {
        const n = nameOf(c[k]);
        if (n) clean[k] = n;
      }
      out.push(clean);
    } catch { /* not a move */ }
  }
  return out;
}

/** Has this claim's waiver run been and gone? Only one that names a time can. */
export function claimDone(claim, now) {
  return Number.isFinite(now) && claim && typeof claim.processAt === 'number' && claim.processAt <= now;
}
