// The trade engine: who has a surplus, who has a hole, and which swaps make
// BOTH squads better.
//
// Pure — no DOM, no fetching — so it is node-testable the same way
// `js/forecast.js` and `js/projection.js` are. `js/trade-page.js` does the
// wiring; this decides what the numbers mean.
//
// ---------------------------------------------------------------------------
// The one idea the whole file is built on
//
// A manager's team is worth exactly what his STARTING LINEUP scores. His bench
// scores nothing. So a player who cannot crack his own lineup is worth zero to
// him and can be worth ten points a week to somebody starting a worse man at
// the same position — which is why a trade that genuinely helps both sides is
// not a paradox but the normal case. Every number below is a step towards
// finding those.
//
// That is also why nothing here has a "trade value" column. The published
// value charts exist because they cannot see your league; we can see all ten
// squads, so a trade is priced by simply re-filling both lineups and looking at
// what changed. There is no chart to disagree with.
//
// ---------------------------------------------------------------------------
// Replacement level, and why it is not a constant
//
// "Startable" needs a bar, and the honest bar is not a number somebody typed
// in. For each position it is **the best player at that position who is not
// starting anywhere in the league** — the man any manager could have instead.
// A player above that line is genuinely startable; one below it is a lineup
// spot going to waste. It falls straight out of the rosters, moves with the
// league, and needs no tuning constant of the kind `js/draft-model.js` has to
// carry.
//
// The Players page's STARTABLE bars are deliberately NOT reused here. Those are
// fixed per-position thresholds answering "is this week worth starting at all",
// which is the right question for a waiver claim and the wrong one for a trade:
// two managers can both be over that bar and still have an obvious trade
// between them.

import { SLOT_ELIGIBILITY } from './espn.js';
import { optimalLineup, slotsFromCounts, DEFAULT_SLOTS } from './forecast.js';

/** Reading order for a depth table: the lineup's own order, not alphabetical. */
export const POSITIONS_IN_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

// ESPN's season projection covers the 17-game regular season. Dividing by it is
// what turns a ~250-point number into the ~15-point one a manager thinks in.
// Same constant, and the same reasoning, as the first grid on the analysis page.
export const SEASON_GAMES = 17;

const round1 = (n) => Math.round(n * 10) / 10;

// --------------------------------------------------------------- the measures

/**
 * A player's typical week: ESPN's season projection spread over the season.
 *
 * THE DEFAULT, and deliberately so. Every guide on trading says the same thing
 * — trade on rest-of-season value, never on last week's points — and a season
 * projection is the closest thing ESPN publishes to that. It also sidesteps
 * byes entirely: a bye is a 0.00 in one WEEK's projection, and pricing a trade
 * off a week where one side happens to be off would be nonsense.
 *
 * Falls back to this week's projection for anyone ESPN has no season line for
 * — a just-signed body, a deep bench flier — because a number on a slightly
 * different footing beats a hole in the table. Same rule as `avgWeek` on the
 * analysis page, so the two pages agree about how good a player is.
 */
export function typicalWeek(p) {
  if (p && typeof p.seasonProjected === 'number' && p.seasonProjected > 0) {
    return round1(p.seasonProjected / SEASON_GAMES);
  }
  return p && typeof p.projected === 'number' ? round1(p.projected) : null;
}

/**
 * The selected week's own projection.
 *
 * Offered because "who can I trade for to survive week 9" is a real question,
 * but it is not the default: a man on bye that week prices at 0.00 and would
 * look like a player worth nothing rather than a player worth nothing ONCE.
 */
export function weekProjection(p) {
  return p && typeof p.projected === 'number' ? round1(p.projected) : null;
}

// ------------------------------------------------------------- lineup filling

/**
 * What a set of players is worth: the best legal lineup they can field.
 *
 * `optimalLineup` is `js/forecast.js`'s, unchanged and unwrapped — it fills the
 * most restrictive slots first, which is provably optimal because the
 * eligibility sets nest, and it is already checked against brute-force
 * enumeration over 350 random rosters in `tests/test-forecast.mjs`. Reusing it
 * means the trade page and the season forecast can never disagree about what a
 * squad is worth.
 *
 * @param {Array} players roster entries as `fetchWeekRosters` returns them
 * @param {number[]} slots lineupSlotIds the league starts
 * @param {function} measure player -> number|null
 * @returns {{starters: Array, total: number}}
 */
export function lineupValue(players, slots, measure = typicalWeek) {
  return optimalLineup(scored(players, measure), slots);
}

/**
 * Re-price a roster under one measure. `projected` is what optimalLineup reads.
 *
 * The finder scores each roster ONCE and then works on the result, rather than
 * re-scoring inside its inner loop. That is not micro-optimisation: the loop
 * runs tens of thousands of times, and copying sixteen player objects on every
 * pass was most of the search's cost.
 */
function scored(players, measure) {
  return (players || []).map((p) => {
    const v = measure(p);
    return { ...p, projected: Number.isFinite(v) ? v : null };
  });
}

/** What each position contributes to a filled lineup. */
function pointsByPosition(lineup) {
  const out = new Map();
  for (const s of lineup.starters) {
    out.set(s.position, (out.get(s.position) || 0) + s.projected);
  }
  return out;
}

/**
 * Where a lineup actually gained points, and how many.
 *
 * NOT "which incoming player ended up in the lineup". Those are different
 * facts and the difference matters: trade your QB1 away for a worse QB and a
 * much better back, and the incoming quarterback does start — so a membership
 * test would report the deal as an upgrade at QB when quarterback is precisely
 * what you gave up to get the running back. Points before against points after,
 * position by position, cannot tell that lie.
 */
function positionDeltas(before, after) {
  const was = pointsByPosition(before);
  const now = pointsByPosition(after);
  const out = [];
  for (const position of new Set([...was.keys(), ...now.keys()])) {
    const delta = round1((now.get(position) || 0) - (was.get(position) || 0));
    if (delta !== 0) out.push({ position, delta });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/**
 * Who walks into the starting lineup, and who walks out of it.
 *
 * This is what the offer actually SAYS, and the per-position deltas above are
 * not a substitute for it. A trade that turns a receiver slot into a running
 * back — which is most of what a flex does — reads as "RB +13.8, WR −12.0" for
 * a net of under two points, and that is a true sentence nobody can act on.
 * Two names and two numbers are the same fact without the arithmetic:
 *
 *     in   Barrett Gallardo  RB 13.8
 *     out  Tyrese Mallory    WR 12.0
 *
 * Both lists include men who were never in the trade — a bench player promoted
 * because the man above him left is part of what the offer does, and hiding him
 * would make the totals not add up.
 */
function lineupChurn(before, after) {
  const was = new Map(before.starters.map((s) => [s.playerId, s]));
  const now = new Map(after.starters.map((s) => [s.playerId, s]));

  const brief = (s) => ({
    playerId: s.playerId,
    name: s.name,
    position: s.position,
    value: round1(s.projected),
  });

  return {
    in: after.starters.filter((s) => !was.has(s.playerId)).map(brief)
      .sort((a, b) => b.value - a.value),
    out: before.starters.filter((s) => !now.has(s.playerId)).map(brief)
      .sort((a, b) => b.value - a.value),
  };
}

/**
 * How many slots the league dedicates to each position outright.
 *
 * FLEX is excluded on purpose — it belongs to no single position, and counting
 * it towards one would say a league needs three receivers when it needs two and
 * something. It is picked up instead by `starting`, which counts who ACTUALLY
 * fills the lineup, flex included.
 */
export function dedicatedSlots(slots) {
  const need = {};
  for (const id of slots || []) {
    const eligible = SLOT_ELIGIBILITY[id];
    if (!eligible || eligible.length !== 1) continue;
    need[eligible[0]] = (need[eligible[0]] || 0) + 1;
  }
  return need;
}

/** The league's slot shape, read off the lineups, with a stated fallback. */
export function slotsForLeague(counts) {
  return counts ? slotsFromCounts(counts) : DEFAULT_SLOTS.slice();
}

// ---------------------------------------------------------- replacement level

/**
 * The bar, per position: the best man at it who is not starting anywhere.
 *
 * Two facts come back with the number, because the UI has to be able to say
 * which case it is in:
 *
 *   - `exhausted` — every player at this position in the league is starting, so
 *     there is no spare man to set a bar with. Happens at D/ST and kicker in a
 *     league where everyone carries exactly one. The worst starter is used
 *     instead, which correctly reports "nobody has a surplus here" rather than
 *     inventing one.
 *   - `startedInLeague` — how many of them are in a lineup, which is what makes
 *     the bar explicable in the panel note rather than magic.
 *
 * @returns {Map<string, {value:number|null, startedInLeague:number, pooled:number, exhausted:boolean}>}
 */
export function replacementLevels(teams, slots, measure = typicalWeek) {
  const pool = new Map();   // position -> every value in the league, any roster
  const starts = new Map(); // position -> how many are in somebody's lineup

  for (const t of teams || []) {
    for (const p of t.players || []) {
      const v = measure(p);
      if (!Number.isFinite(v)) continue;
      if (!pool.has(p.position)) pool.set(p.position, []);
      pool.get(p.position).push(v);
    }
    for (const s of lineupValue(t.players, slots, measure).starters) {
      starts.set(s.position, (starts.get(s.position) || 0) + 1);
    }
  }

  const out = new Map();
  for (const [position, values] of pool) {
    values.sort((a, b) => b - a);
    const n = starts.get(position) || 0;
    const exhausted = n >= values.length;
    out.set(position, {
      // values[n] is the (n+1)-th best — the first man past the last starter.
      value: exhausted ? values[values.length - 1] : values[n],
      startedInLeague: n,
      pooled: values.length,
      exhausted,
    });
  }
  return out;
}

// ------------------------------------------------------------- the depth table
//
// Ten rows, six columns, one number per cell: how many startable players a
// manager has at that position MINUS how many he has to field there.
//
// Positive is a surplus and it is the thing you trade away — those players are
// scoring him nothing. Negative is a hole and it is the thing you trade for.
// Read down a column to find the manager whose sign is the opposite of yours;
// that is the conversation worth having, and it is the step every trading guide
// puts first and no public tool can do, because none of them can see the other
// nine rosters.

/**
 * One team's depth at one position.
 *
 * `needed` is the larger of what he actually starts there and what the league
 * forces him to start. The second half matters: a manager with no kicker at all
 * starts none, and `startable - starting` would read 0 — a clean bill of health
 * for an empty lineup slot. Against the league's dedicated slots it reads −1,
 * which is the truth.
 */
function depthCell(team, position, startingIds, measure, replacement, required) {
  const bar = replacement.get(position);
  const barValue = bar ? bar.value : null;

  const mine = (team.players || [])
    .map((p) => ({ p, v: measure(p) }))
    .filter((e) => e.p.position === position)
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));

  const starting = mine.filter((e) => startingIds.has(e.p.playerId)).length;

  // Strictly above the bar. The bar-setter himself is by definition the best
  // man nobody is starting, so counting him as startable would hand every
  // manager in the league a phantom extra body at every position.
  //
  // EXCEPT when the position is exhausted, and this was a real bug rather than
  // a nicety. If every player at a position is already starting somewhere there
  // is no replacement to be had, so the bar falls back to the worst starter in
  // the league — and a strict test then rules that man out of being startable,
  // reporting a hole at a position his manager has perfectly well filled. In a
  // two-team stub where both squads carry one identical quarterback, BOTH were
  // told they were short at QB. With nobody available to replace him, every man
  // you hold is better than what you could get, so the test goes inclusive.
  const startableAt = (v) =>
    Number.isFinite(v) && Number.isFinite(barValue) && (bar.exhausted ? v >= barValue : v > barValue);
  const above = mine.filter((e) => startableAt(e.v));

  const needed = Math.max(starting, required[position] || 0);
  const net = above.length - needed;

  // The best startable man NOT in the lineup — what this manager can afford to
  // send. Null when he has none, which is most cells.
  const spare = above.find((e) => !startingIds.has(e.p.playerId)) || null;
  // The worst man he IS starting there — what an incoming player would replace.
  // Null when the slot is empty, which is itself the hole.
  const weakest = [...mine].reverse().find((e) => startingIds.has(e.p.playerId)) || null;

  // --------------------------------------------------------------------
  // Counts alone will not carry this table, and it took building it to see
  // why. The bar is set at the last man starting anywhere in the league, so
  // by construction the number of players above it is about the number of
  // lineup places for them — which makes `net` zero for nearly every cell in
  // a league of any balance. True, and useless to read down a column.
  //
  // So the number in the cell is POINTS, not bodies: how far this manager's
  // starters at this position are above the man anybody could have instead.
  // That is continuous, never zero by accident, and reading down a column
  // ranks the league at that position — which is the whole job of the table,
  // because the partner worth talking to is the one whose sign is the
  // opposite of yours.
  //
  // An unfilled slot counts as the whole bar against him: a manager with no
  // kicker is not neutral at kicker, he is scoring nothing there.
  const startersEdge = Number.isFinite(barValue)
    ? round1(
        mine
          .filter((e) => startingIds.has(e.p.playerId) && Number.isFinite(e.v))
          .reduce((a, e) => a + (e.v - barValue), 0) -
          Math.max(0, (required[position] || 0) - starting) * barValue
      )
    : null;

  // What this manager could send without touching his lineup — the surplus,
  // priced. Never negative: a man he is not starting can only be worth
  // something to somebody else or worth nothing at all.
  const surplusEdge = Number.isFinite(barValue)
    ? round1(
        above
          .filter((e) => !startingIds.has(e.p.playerId))
          .reduce((a, e) => a + (e.v - barValue), 0)
      )
    : null;

  return {
    position,
    starting,
    startable: above.length,
    needed,
    net,
    spare,
    weakest,
    startersEdge,
    surplusEdge,
  };
}

/**
 * The whole map: every team, every position.
 *
 * @returns {{positions, replacement, required, rows: Array}}
 */
export function depthTable(teams, slots, measure = typicalWeek) {
  const replacement = replacementLevels(teams, slots, measure);
  const required = dedicatedSlots(slots);

  // Only positions this league actually has. A column of em dashes for a
  // position nobody starts and nobody rosters is not information, and the two
  // reasons to keep one are both covered: a dedicated slot means the league
  // demands the position even if a manager has nobody in it, and a player in
  // the pool means somebody is carrying one even if no slot names it.
  const positions = POSITIONS_IN_ORDER.filter(
    (p) => (required[p] || 0) > 0 || replacement.has(p)
  );

  const rows = (teams || []).map((team) => {
    // Filled once per team, not once per cell: every position asks the same
    // question of the same lineup, and six identical fills per row was most of
    // this table's cost for none of its meaning.
    const lineup = lineupValue(team.players, slots, measure);
    const startingIds = new Set(lineup.starters.map((s) => s.playerId));

    const cells = new Map();
    for (const position of positions) {
      cells.set(
        position,
        depthCell(team, position, startingIds, measure, replacement, required)
      );
    }
    return { team, cells, total: lineup.total, lineup };
  });

  return { positions, replacement, required, rows };
}

// ------------------------------------------------------------- the trade finder
//
// Brute force, and deliberately so. Ten squads of sixteen is a small enough
// space to simply try every swap and keep the ones that work, and an exhaustive
// search cannot miss the trade a heuristic would have pruned. The only pruning
// here is a cap on roster size, which exists to stop a pathological league
// hanging the page rather than to make the answer cleverer.

/** How many players from each side a package may hold. */
const MAX_PACKAGE = 2;

/** Ignore a gain smaller than this: it is float noise dressed as a trade. */
const MIN_GAIN = 0.1;

/**
 * Only the top N of a roster are considered as trade pieces.
 *
 * A 16-man roster gives 120 two-man packages, and both sides multiply. This
 * bounds a league carrying an unusually deep bench without changing the answer
 * in a normal one — the players it drops are the ones no lineup would ever want.
 */
const CANDIDATE_CAP = 18;

/**
 * The players a side might part with, best first, and only ones with a number.
 *
 * Takes an already-scored roster, so `projected` is the measure's value and
 * nothing is re-derived inside the search.
 */
function candidates(scoredPlayers) {
  return scoredPlayers
    .filter((p) => p.playerId !== null && p.playerId !== undefined)
    .filter((p) => Number.isFinite(p.projected))
    .slice()
    .sort((a, b) => b.projected - a.projected || a.playerId - b.playerId)
    .slice(0, CANDIDATE_CAP);
}

/** Every 1- and 2-man package from a candidate list. */
function packages(list, max = MAX_PACKAGE) {
  const out = list.map((p) => [p]);
  if (max < 2) return out;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

/**
 * A roster after a trade, with the forced cut applied.
 *
 * A 2-for-1 does not just move players: the side receiving two and sending one
 * ends a man over the limit and HAS to drop somebody. Every guide flags this as
 * the thing that makes lopsided-looking packages bad deals, so the cut is
 * modelled rather than waved away — the worst man on the new roster goes, which
 * is what a manager would do. Players ESPN has no number for sort to the bottom
 * and are cut first, which is also what a manager would do.
 *
 * The side that ends a man SHORT is simply left short. It could claim someone
 * off the wire, but that player is not in this page's data and inventing him
 * would flatter the trade. Being conservative understates a package's value,
 * which is the safe direction to be wrong in.
 */
function afterTrade(scoredPlayers, outgoing, incoming) {
  const gone = new Set(outgoing.map((p) => p.playerId));
  const kept = scoredPlayers.filter((p) => !gone.has(p.playerId)).concat(incoming);

  const over = kept.length - scoredPlayers.length;
  if (over <= 0) return kept;

  const ranked = kept
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        (Number.isFinite(a.p.projected) ? a.p.projected : -Infinity) -
          (Number.isFinite(b.p.projected) ? b.p.projected : -Infinity) ||
        a.i - b.i
    );
  const cut = new Set(ranked.slice(0, over).map((e) => e.p));
  return kept.filter((p) => !cut.has(p));
}

/**
 * How a package reads from the point of view of the side proposing it.
 *
 * Named rather than left as "2-for-1" because which way round it goes changes
 * what kind of move it is: sending two for one is consolidation — turning
 * bench depth into a starter and accepting the forced cut — while sending one
 * for two is buying depth with a starter. Managers think in those terms, and a
 * bare ratio makes the reader work out which one they are looking at.
 */
function packageKind(send, receive) {
  if (send.length === receive.length) return 'even';
  return send.length > receive.length ? 'consolidate' : 'depth';
}

/**
 * Every trade with this partner that makes BOTH lineups better.
 *
 * Both sides are re-priced from scratch — fill the best legal lineup before,
 * fill it again after, subtract — so nothing here depends on a value chart or
 * on anyone agreeing about what a player is "worth". Two managers looking at
 * the same ESPN projections can both check it, which is the whole reason this
 * is a better argument than a number off a website.
 */
/**
 * Which package shapes to search. All three by default.
 *
 * This is a search option rather than something the page filters afterwards,
 * and that is not a detail. `bestPerTarget` keeps ONE offer per man you would
 * acquire, so a 1-for-1 and a 2-for-1 that bring in the same player compete for
 * the same slot in the list — and the 2-for-1 usually wins, because throwing in
 * a spare body is free to you. Filter after that and the 1-for-1 is already
 * gone. Filtering here means "show me only straight swaps" returns the best
 * straight swaps rather than the leftovers of a search that preferred
 * something else.
 */
export const PACKAGE_KINDS = ['even', 'consolidate', 'depth'];

function tradesWith(myScored, theirScored, theirs, slots, kinds) {
  const myBase = optimalLineup(myScored, slots);
  const theirBase = optimalLineup(theirScored, slots);

  const myPackages = packages(candidates(myScored));
  const theirPackages = packages(candidates(theirScored));

  const found = [];
  for (const send of myPackages) {
    for (const receive of theirPackages) {
      // 2-for-2 is left out: it is rarely what anyone proposes, and it
      // multiplies the search by another two orders of magnitude for offers
      // that are almost always a 1-for-1 with two spare men bolted on.
      if (send.length === 2 && receive.length === 2) continue;

      const kind = packageKind(send, receive);
      if (!kinds.includes(kind)) continue;

      // Mine first, and bail before touching theirs. Most pairs fail here, and
      // the second lineup fill is the expensive half of the loop.
      const myAfter = optimalLineup(afterTrade(myScored, send, receive), slots);
      const myGain = round1(myAfter.total - myBase.total);
      if (myGain < MIN_GAIN) continue;

      const theirAfter = optimalLineup(afterTrade(theirScored, receive, send), slots);
      const theirGain = round1(theirAfter.total - theirBase.total);
      if (theirGain < MIN_GAIN) continue;

      found.push({
        partner: theirs,
        send,
        receive,
        kind,
        shape: `${send.length}-for-${receive.length}`,
        myGain,
        theirGain,
        myBefore: myBase.total,
        myAfter: myAfter.total,
        theirBefore: theirBase.total,
        theirAfter: theirAfter.total,
        yourMoves: positionDeltas(myBase, myAfter),
        theirMoves: positionDeltas(theirBase, theirAfter),
        yourChurn: lineupChurn(myBase, myAfter),
        theirChurn: lineupChurn(theirBase, theirAfter),
      });
    }
  }
  return found;
}

/**
 * The cheapest way to get each man, rather than every way.
 *
 * An exhaustive search returns the same acquisition over and over with a
 * different spare body attached — twenty rows that are one trade. Keyed on who
 * you would RECEIVE, so each row is a distinct answer to "who can I get", and
 * the kept offer is the one that gains you most, then sends fewest players,
 * then gives the partner most. The last term is not politeness: of two offers
 * identical to you, the one worth more to him is the one he accepts.
 */
function bestPerTarget(offers) {
  const best = new Map();
  for (const o of offers) {
    const key =
      `${o.partner.id}:` +
      o.receive.map((p) => p.playerId).sort((a, b) => a - b).join(',');
    const held = best.get(key);
    if (
      !held ||
      o.myGain > held.myGain ||
      (o.myGain === held.myGain && o.send.length < held.send.length) ||
      (o.myGain === held.myGain && o.send.length === held.send.length &&
        o.theirGain > held.theirGain)
    ) {
      best.set(key, o);
    }
  }
  return [...best.values()];
}

/**
 * Throw away an offer that another offer beats on every count.
 *
 * `bestPerTarget` keys on who you RECEIVE, so "get his receiver" and "get his
 * receiver plus a spare back" are different rows — and in a stub built to have
 * exactly one sensible trade in it, six rows came back that were all that trade
 * with different junk attached. An offer is redundant when some other offer
 * with the same partner is at least as good for BOTH sides and moves fewer
 * players; the simplest version of a deal is the one worth proposing, because
 * every extra name in it is another thing for the other manager to object to.
 *
 * Deliberately a SUBSET test and not merely a smaller-and-better one. Two
 * different trades with the same manager that happen to be the same size are
 * genuine alternatives — he may be willing to part with one of those men and
 * not the other — so neither may silently delete the other. Only a deal that
 * literally contains another deal is redundant.
 */
function dropRedundant(offers) {
  const ids = (list) => new Set(list.map((p) => p.playerId));
  const subset = (a, b) => [...a].every((id) => b.has(id));

  return offers.filter((o, i) => {
    const oSend = ids(o.send);
    const oReceive = ids(o.receive);
    return !offers.some((other, j) => {
      if (i === j || other.partner.id !== o.partner.id) return false;
      if (other.send.length + other.receive.length >= o.send.length + o.receive.length) {
        return false;
      }
      return (
        subset(ids(other.send), oSend) &&
        subset(ids(other.receive), oReceive) &&
        other.myGain >= o.myGain &&
        other.theirGain >= o.theirGain
      );
    });
  });
}

/**
 * Search the whole league for trades that make both squads better.
 *
 * @param {Object} opts
 * @param {Array}  opts.teams     every team, as `fetchWeekRosters` returns them
 * @param {number} opts.myTeamId  the squad to trade FROM
 * @param {number[]} opts.slots   the league's starting slots
 * @param {function} [opts.measure]
 * @param {string[]} [opts.kinds] package shapes to search — see PACKAGE_KINDS
 * @param {number} [opts.limit]   how many offers to return
 * @returns {{offers: Array, mine: Object|null, considered: number}}
 */
export function findTrades({
  teams, myTeamId, slots, measure = typicalWeek, kinds = PACKAGE_KINDS, limit = 40,
}) {
  const mine = (teams || []).find((t) => t.id === myTeamId) || null;
  if (!mine) return { offers: [], mine: null, considered: 0 };

  const myScored = scored(mine.players, measure);

  let offers = [];
  for (const theirs of teams) {
    if (theirs.id === mine.id) continue;
    offers = offers.concat(
      tradesWith(myScored, scored(theirs.players, measure), theirs, slots, kinds)
    );
  }

  const considered = offers.length;
  const ranked = dropRedundant(bestPerTarget(offers)).sort(
    (a, b) =>
      b.myGain - a.myGain ||
      b.theirGain - a.theirGain ||
      a.send.length + a.receive.length - (b.send.length + b.receive.length) ||
      a.partner.id - b.partner.id
  );

  return { offers: ranked.slice(0, limit), mine, considered };
}
