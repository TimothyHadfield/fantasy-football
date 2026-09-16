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

/**
 * A player id, whether you were handed the player or just his id.
 *
 * The finder passes whole roster entries around; `bestCombo` and
 * `priceTradeAcrossWeeks` are called from a page that may only be holding ids.
 * One coercion in one place beats two call sites that disagree about which.
 */
const idOf = (p) => (p && typeof p === 'object' ? p.playerId : p);

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
  const gone = new Set((outgoing || []).map(idOf));
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
 * @param {number[]} [opts.weeks] remaining weeks — switches to the WEEKLY measure
 * @param {function} [opts.projFor] `(player, week) -> number|null`, with `weeks`
 * @returns {{offers: Array, mine: Object|null, considered: number, basis: string}}
 */
export function findTrades({
  teams, myTeamId, slots, measure = typicalWeek, kinds = PACKAGE_KINDS, limit = 40,
  weeks = null, projFor = null,
}) {
  const mine = (teams || []).find((t) => t.id === myTeamId) || null;
  if (!mine) return { offers: [], mine: null, considered: 0, basis: 'measure' };

  // The weekly measure is opt-in and needs BOTH halves — a week list and a way
  // to read a projection for it. Anything less falls back to the scalar
  // measure, which is what every existing caller gets and must keep getting
  // byte for byte.
  const weekly = Array.isArray(weeks) && weeks.length > 0 && typeof projFor === 'function';

  const myScored = weekly
    ? scoreAcrossWeeks(mine.players, weeks, projFor).season
    : scored(mine.players, measure);

  let offers = [];
  for (const theirs of teams) {
    if (theirs.id === mine.id) continue;
    offers = offers.concat(
      weekly
        ? tradesAcrossWeeks(
            myScored, scoreAcrossWeeks(theirs.players, weeks, projFor).season,
            theirs, slots, kinds, weeks
          )
        : tradesWith(myScored, scored(theirs.players, measure), theirs, slots, kinds)
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

  return {
    offers: ranked.slice(0, limit),
    mine,
    considered,
    basis: weekly ? 'weeks' : 'measure',
  };
}

// ===========================================================================
// The weekly measure: a roster is worth what it can field EVERY week
// ===========================================================================
//
// THE FLAW THIS FIXES, in the owner's words:
//
//   "I have 3 QBs that all avg low counts, however QB proj avg is much higher,
//    because their proj has wide ranges (15-19) and with 3 players I often can
//    always have a QB with a high (18-19) proj. This means getting a 19 proj QB
//    doesn't really change my team, even though my starter only ever has a
//    season proj of around 17."
//
// He is right, and `lineupValue` above is where it goes wrong. That function
// prices a squad ONCE, on one scalar per man — the season projection over 17 —
// and under a scalar only one quarterback can ever count. Three men averaging
// 16 are worth 16 a week, and a fourth averaging 19 looks like a +3 upgrade.
//
// A real season does not work like that. Each of those three has his own weekly
// number, they move independently, and the manager starts whichever of them is
// at the top of his range THAT WEEK. Three men whose weekly projections swing
// 15-19 will, between them, put an 18 or a 19 in the lineup most weeks — so the
// squad is already getting the value the fourth man was supposed to add, and the
// upgrade is worth almost nothing. That is exactly what he is describing.
//
// So: value a roster as the SUM, over every remaining week, of the best legal
// lineup it could field THAT WEEK on THAT WEEK's own projections. Positional
// depth then falls out with nothing to tune and no new constant — it is simply
// what a max-over-the-week does that a max-over-the-average cannot.
//
// Three consequences worth stating before the code:
//
//   - The numbers are SEASON TOTALS, not weekly ones. A +40 here is +40 over
//     the whole remaining season, roughly +4.4 a week over nine weeks. It is
//     not on the same scale as anything `typicalWeek` produces, and a page
//     showing both must say which one it is showing.
//   - Byes stop being a special case and become the point. ESPN returns 0.00
//     for a man on bye, which is a number and not a null, so `optimalLineup`
//     ranks him last and the week re-picks around him — which is what the
//     manager does. `typicalWeek` had to AVOID byes; this measure handles them
//     by construction, and a squad with no cover in week 12 is correctly worth
//     less than one that has some.
//   - `optimalLineup` is still `js/forecast.js`'s, run once per week. Three
//     features share that function so they cannot disagree about who a squad
//     ought to be starting; this is the fourth, and it does not get a copy
//     either.

/**
 * Score one roster ONCE for every remaining week.
 *
 * This is the weekly answer to the comment on `scored()` above, and for the
 * same reason: the finder's inner loop runs tens of thousands of times, and
 * doing nine lineup fills inside each is already nine times the work. Calling
 * `projFor` and rebuilding player objects in there as well would be nine times
 * the allocation on top, for numbers that never change.
 *
 * Each entry that comes back carries both views of the same man:
 *
 *   `projected`  his REST-OF-SEASON total — every week added up. That is what
 *                the existing `candidates()` ranks by and what `afterTrade()`
 *                cuts by, so both of them work here unchanged.
 *   `weekly[i]`  a ready-made player object for `weeks[i]`, whose `projected`
 *                is that week's number. `optimalLineup` reads these directly.
 *   `perWeek`    the season total spread back over the weeks, for a page that
 *                wants a number on the scale a manager thinks in.
 *
 * A week ESPN has no number for is `null`, which `optimalLineup` drops from the
 * pool entirely — a different fact from a 0.00 bye, and that distinction is the
 * one rule 2 in HANDOFF.md exists to protect.
 */
function scoreAcrossWeeks(players, weeks, projFor) {
  const ws = (weeks || []).slice();
  const read = typeof projFor === 'function' ? projFor : () => null;

  const season = (players || []).map((p) => {
    const weekly = new Array(ws.length);
    let sum = 0;
    let counted = 0;
    for (let i = 0; i < ws.length; i++) {
      const raw = read(p, ws[i]);
      const v = Number.isFinite(raw) ? raw : null;
      weekly[i] = { ...p, projected: v, week: ws[i] };
      if (v !== null) { sum += v; counted++; }
    }
    return {
      ...p,
      projected: counted ? round1(sum) : null,
      perWeek: counted && ws.length ? round1(sum / ws.length) : null,
      weeksCounted: counted,
      weekly,
    };
  });

  return { weeks: ws, season };
}

/** The roster as it looks in one week — the objects `optimalLineup` reads. */
const atWeek = (roster, i) => roster.map((p) => p.weekly[i]);

/**
 * Totals only, for the inner loop. The lineups are thrown away, because nothing
 * in the search reads them and ten thousand discarded lineups is ten thousand
 * arrays of nine copied players.
 */
function totalAcrossWeeks(roster, slots, weekCount) {
  const weekTotals = new Array(weekCount);
  let total = 0;
  for (let i = 0; i < weekCount; i++) {
    const t = optimalLineup(atWeek(roster, i), slots).total;
    weekTotals[i] = t;
    total += t;
  }
  return { total: round1(total), weekTotals };
}

/** The same thing with the lineups kept — for the handful of results reported. */
function fillAcrossWeeks(roster, slots, ws) {
  const byWeek = [];
  let total = 0;
  for (let i = 0; i < ws.length; i++) {
    const lineup = optimalLineup(atWeek(roster, i), slots);
    total += lineup.total;
    byWeek.push({ week: ws[i], total: lineup.total, starters: lineup.starters });
  }
  return { total: round1(total), byWeek };
}

/**
 * What a roster is worth across the rest of the season.
 *
 * The sum, over every remaining week, of the best legal lineup that roster
 * could field in that week on that week's own projections.
 *
 * @param {Array}  players roster entries as `fetchWeekRosters` returns them
 * @param {number[]} slots lineupSlotIds the league starts
 * @param {number[]} weeks the remaining weeks, ascending
 * @param {(player:Object, week:number) => number|null} projFor
 * @returns {{total:number, byWeek: Array<{week:number, total:number, starters:Array}>}}
 */
export function seasonLineupValue(players, slots, weeks, projFor) {
  const { weeks: ws, season } = scoreAcrossWeeks(players, weeks, projFor);
  return fillAcrossWeeks(season, slots, ws);
}

// --------------------------------------------------------- pricing one trade

/**
 * ONE forced cut for the whole season, not a fresh one every week.
 *
 * `afterTrade` already models the cut a lopsided package forces: take two, send
 * one, and you are a man over the limit, so your worst man goes. Across weeks
 * there is a choice about WHEN that decision is made, and it matters:
 *
 *   - Cut per week, and the model quietly keeps the best sixteen available in
 *     every single week — a manager who drops his fifth receiver in week 9 and
 *     has him back in week 10. That flatters every package that forces a cut,
 *     which is the wrong direction to be wrong in.
 *   - Cut once, on rest-of-season value, and the same man is gone for all of
 *     them. That is what actually happens, and it is what this does.
 *
 * `afterTrade` needs no change to do it: the entries it ranks carry `projected`
 * = the rest-of-season total, so "his worst man" already means worst over the
 * weeks that are left rather than worst this Sunday.
 */
function rosterAcrossWeeksAfter(season, send, joining) {
  return afterTrade(season, send || [], joining);
}

/**
 * Price one trade across every remaining week.
 *
 * `send` may be players or bare ids; `receive` must be the partner's actual
 * roster entries, because `projFor` is asked for THEIR projections and an id
 * carries none.
 *
 * @param {Object} opts
 * @param {Array}  opts.players  your roster
 * @param {Array}  opts.send     what leaves (players or ids)
 * @param {Array}  opts.receive  what arrives (the partner's roster entries)
 * @param {number[]} opts.slots
 * @param {number[]} opts.weeks
 * @param {function} opts.projFor
 * @returns {{before:Object, after:Object, delta:number,
 *            byWeek:Array<{week:number, before:number, after:number, delta:number}>,
 *            cut:Array, roster:Array}}
 */
export function priceTradeAcrossWeeks({
  players, send = [], receive = [], slots, weeks, projFor,
}) {
  const { weeks: ws, season } = scoreAcrossWeeks(players, weeks, projFor);
  const joining = scoreAcrossWeeks(receive, ws, projFor).season;

  const before = fillAcrossWeeks(season, slots, ws);
  const kept = rosterAcrossWeeksAfter(season, send, joining);
  const after = fillAcrossWeeks(kept, slots, ws);

  // Who the roster limit forced out, as distinct from who was traded away — a
  // page that does not name him is hiding the cost of the deal.
  const survived = new Set(kept);
  const gone = new Set((send || []).map(idOf));
  const cut = season.concat(joining)
    .filter((p) => !survived.has(p) && !gone.has(p.playerId));

  return {
    before,
    after,
    delta: round1(after.total - before.total),
    byWeek: ws.map((week, i) => ({
      week,
      before: before.byWeek[i].total,
      after: after.byWeek[i].total,
      delta: round1(after.byWeek[i].total - before.byWeek[i].total),
    })),
    cut,
    roster: kept,
  };
}

// --------------------------------------- explaining a weekly trade in words
//
// The scalar finder explains an offer with `positionDeltas` and `lineupChurn`,
// both of which compare ONE lineup against ONE lineup. Across nine weeks there
// are nine lineups a side, and a man can start in six of them before and eight
// of them after. So the weekly versions work on what each man and each position
// actually CONTRIBUTED over the whole span, and each entry carries the CHANGE
// in that contribution rather than a projection.
//
// That keeps the property the scalar version has and the tests lean on: what
// walks in minus what walks out IS the gain. A list that does not add up to the
// number beside it is decoration.

/** Season points each man and each position put into the lineups. */
function contributions(fill) {
  const byPlayer = new Map();
  const byPosition = new Map();
  for (const wk of fill.byWeek) {
    for (const s of wk.starters) {
      const held = byPlayer.get(s.playerId);
      if (held) {
        held.points += s.projected;
        held.weeks += 1;
      } else {
        byPlayer.set(s.playerId, {
          playerId: s.playerId,
          name: s.name,
          position: s.position,
          points: s.projected,
          weeks: 1,
        });
      }
      byPosition.set(s.position, (byPosition.get(s.position) || 0) + s.projected);
    }
  }
  return { byPlayer, byPosition };
}

/** Where the season's points moved, position by position. */
function weeklyPositionDeltas(was, now) {
  const out = [];
  for (const position of new Set([...was.byPosition.keys(), ...now.byPosition.keys()])) {
    const delta = round1(
      (now.byPosition.get(position) || 0) - (was.byPosition.get(position) || 0)
    );
    if (delta !== 0) out.push({ position, delta });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/**
 * Who gains lineup time and who loses it.
 *
 * `value` is the CHANGE in a man's season contribution, not his projection, so
 * a starter who merely picks up two extra weeks appears with what those two
 * weeks are worth rather than with his whole season. `weeks` beside it is how
 * many weeks he starts afterwards (in) or beforehand (out), which is what makes
 * the number readable, and `wasStarting`/`nowStarting` separate "he is new to
 * the lineup" from "he is in it more often".
 */
function weeklyChurn(was, now) {
  const ids = new Set([...was.byPlayer.keys(), ...now.byPlayer.keys()]);
  const gained = [];
  const lost = [];
  for (const id of ids) {
    const a = was.byPlayer.get(id);
    const b = now.byPlayer.get(id);
    const delta = round1((b ? b.points : 0) - (a ? a.points : 0));
    if (delta === 0) continue;
    const who = b || a;
    const entry = {
      playerId: who.playerId,
      name: who.name,
      position: who.position,
      value: Math.abs(delta),
      weeks: delta > 0 ? (b ? b.weeks : 0) : (a ? a.weeks : 0),
      wasStarting: !!a,
      nowStarting: !!b,
    };
    (delta > 0 ? gained : lost).push(entry);
  }
  const bySize = (x, y) => y.value - x.value;
  return { in: gained.sort(bySize), out: lost.sort(bySize) };
}

// --------------------------------------------- the finder, on weekly numbers

/**
 * Every trade with this partner that makes BOTH squads better over the rest of
 * the season — the weekly twin of `tradesWith`.
 *
 * Shape for shape it is the same search and the same offer object, so a page
 * can render either. Three things differ, all of them forced by the measure:
 *
 *   - Nine lineup fills replace one, hence `totalAcrossWeeks` in the loop and
 *     the full `fillAcrossWeeks` only for the offers that survive it.
 *   - The gain floor scales with the span. `MIN_GAIN` is 0.1 because a tenth of
 *     a point a week is float noise; across nine weeks the same noise adds up to
 *     nearly a point, so the floor has to add up with it.
 *   - `myBefore`/`myAfter`/`myGain` are SEASON totals. `basis: 'weeks'` says so
 *     on every offer, because a page that mixed the two scales would be wrong by
 *     a factor of nine and look perfectly plausible doing it.
 *
 * THE FREE-GIFT CEILING is what keeps this affordable. A package cannot
 * possibly be worth more to you than being handed those players for nothing —
 * nobody sent back, nobody cut — because the roster a trade actually leaves you
 * is a SUBSET of your roster plus theirs, and a best lineup over a subset can
 * never beat the best lineup over the whole. So the ceiling is computed ONCE per
 * incoming package, and every package whose ceiling is below the floor is thrown
 * out before a single send is tried. Same for the partner, per outgoing package.
 * That is 342 extra fills a partner to skip tens of thousands, and it cannot
 * change the answer — it only ever rules out packages that could not have made
 * the floor anyway.
 */
function tradesAcrossWeeks(myScored, theirScored, theirs, slots, kinds, weeks) {
  const n = weeks.length;
  const floor = MIN_GAIN * Math.max(1, n);

  const myBase = totalAcrossWeeks(myScored, slots, n);
  const theirBase = totalAcrossWeeks(theirScored, slots, n);

  // Hoisted for the same reason `scored()` is: these two never change, and
  // re-filling eighteen lineups inside the loop would be most of the cost.
  const myBaseFill = fillAcrossWeeks(myScored, slots, weeks);
  const theirBaseFill = fillAcrossWeeks(theirScored, slots, weeks);
  const mineWas = contributions(myBaseFill);
  const theirsWas = contributions(theirBaseFill);

  const myPackages = packages(candidates(myScored));
  const theirPackages = packages(candidates(theirScored));

  // What each of my packages is worth to HIM at the very most.
  const ceilingForThem = myPackages.map((send) =>
    round1(totalAcrossWeeks(theirScored.concat(send), slots, n).total - theirBase.total)
  );

  const found = [];
  // Receive is the outer loop now, so a package that cannot help me at all
  // skips every send rather than being re-rejected once per send.
  for (const receive of theirPackages) {
    // The gifted roster — mine plus theirs, nothing sent, nobody cut. Its
    // lineups are the ceiling AND, below, the shortcut.
    const giftedPool = myScored.concat(receive);
    const gifted = fillAcrossWeeks(giftedPool, slots, weeks);
    if (round1(gifted.total - myBase.total) < floor) continue;
    const giftedStarters = gifted.byWeek.map((wk) => new Set(wk.starters.map((s) => s.playerId)));

    for (let k = 0; k < myPackages.length; k++) {
      const send = myPackages[k];
      if (ceilingForThem[k] < floor) continue;
      if (send.length === 2 && receive.length === 2) continue;

      const kind = packageKind(send, receive);
      if (!kinds.includes(kind)) continue;

      // Mine first, and bail before touching theirs — the same reason as the
      // scalar search, and nine times as good a reason.
      const myRoster = afterTrade(myScored, send, receive);

      // Which men the gifted roster has that the real one does not: the ones
      // sent away, plus anyone the roster limit forced out.
      const kept = new Set(myRoster.map((p) => p.playerId));
      const missing = [];
      for (const p of giftedPool) if (!kept.has(p.playerId)) missing.push(p.playerId);

      // A week where none of those men was going to START is a week the trade
      // does not touch: taking a bench player off a roster cannot change the
      // best lineup that roster could field, because the lineup it already
      // fields is still available. So that week's fill is skipped outright and
      // the gifted total stands. Exact, not an approximation — and it is most
      // of the loop, because most packages move men who were not starting.
      let total = 0;
      const weekTotals = new Array(n);
      for (let i = 0; i < n; i++) {
        const t = missing.some((id) => giftedStarters[i].has(id))
          ? optimalLineup(atWeek(myRoster, i), slots).total
          : gifted.byWeek[i].total;
        weekTotals[i] = t;
        total += t;
      }
      const myAfter = { total: round1(total), weekTotals };
      const myGain = round1(myAfter.total - myBase.total);
      if (myGain < floor) continue;

      const theirRoster = afterTrade(theirScored, receive, send);
      const theirAfter = totalAcrossWeeks(theirRoster, slots, n);
      const theirGain = round1(theirAfter.total - theirBase.total);
      if (theirGain < floor) continue;

      // Only now is it worth keeping the lineups, for the two lists the row
      // actually prints.
      const mineNow = contributions(fillAcrossWeeks(myRoster, slots, weeks));
      const theirsNow = contributions(fillAcrossWeeks(theirRoster, slots, weeks));

      found.push({
        partner: theirs,
        send,
        receive,
        kind,
        shape: `${send.length}-for-${receive.length}`,
        basis: 'weeks',
        weeks: weeks.slice(),
        myGain,
        theirGain,
        myBefore: myBase.total,
        myAfter: myAfter.total,
        theirBefore: theirBase.total,
        theirAfter: theirAfter.total,
        // Per week, so a deal that is +5 on average and −12 in the weeks that
        // decide the season is visible rather than averaged away.
        byWeek: weeks.map((week, i) => ({
          week,
          before: myBase.weekTotals[i],
          after: myAfter.weekTotals[i],
          delta: round1(myAfter.weekTotals[i] - myBase.weekTotals[i]),
        })),
        yourMoves: weeklyPositionDeltas(mineWas, mineNow),
        theirMoves: weeklyPositionDeltas(theirsWas, theirsNow),
        yourChurn: weeklyChurn(mineWas, mineNow),
        theirChurn: weeklyChurn(theirsWas, theirsNow),
      });
    }
  }
  return found;
}

// ===========================================================================
// bestCombo — the best set of offers that can all be made at once
// ===========================================================================
//
// THE TRAP THIS EXISTS TO AVOID, and it produces confident wrong numbers in
// silence: a combo's gain is NOT the sum of its trades' gains.
//
// Every offer's `myGain` was measured against your CURRENT roster. Make two of
// them and the second one's gain was measured against a roster that no longer
// exists. Both of them re-fill the same lineup, so their benefits OVERLAP: two
// trades that each upgrade your quarterback do not both upgrade it — they
// compete for the same slot, and the better one wins. Add the two gains up and
// you have promised the manager twice what he is going to get.
//
// So there is exactly one way to price a combo, and it is the one below: apply
// every send and every receive TOGETHER, and price the resulting roster ONCE
// with `priceTradeAcrossWeeks`. The naive sum is still computed — as
// `naiveDelta`, so a page can SHOW the gap rather than the engine hiding it.
//
// ---------------------------------------------------------------------------
// What makes two offers compatible
//
// A player can only be traded once. That is the owner's constraint, and it is a
// disjointness condition over the UNION of `send` and `receive` ids: you cannot
// send the same man to two managers, you cannot receive him from two, and you
// cannot send a man you have just traded away.
//
// TWO OFFERS WITH THE SAME PARTNER are treated as compatible when their player
// sets are disjoint, and that is a DECISION rather than an obvious truth. In
// practice one manager proposes one deal, and two separate trades with the same
// man on the same day is not how a league tends to work — but they are not
// illegal, and two disjoint deals with him are genuinely one bigger deal he
// might take. So the engine allows them, flags any packing that repeats a
// partner as `repeatPartners`, and takes `onePerPartner: true` for a page that
// would rather not offer something socially odd. Worth confirming with the
// owner; it is the one place here where the rule is a judgement call.
//
// ---------------------------------------------------------------------------
// Roster size
//
// A combo moves several players at once, so the forced cut has to be applied to
// the COMBINED result and not offer by offer. Two 1-for-2s leave you two men
// over the limit and cost you two players; pricing them separately would charge
// you one cut twice over, which is a different and smaller number.
// `priceTradeAcrossWeeks` takes the whole package, so it gets this right by
// construction, and the `cut` list it returns names who went.
//
// ---------------------------------------------------------------------------
// And the partner has to still want it
//
// Each offer was a win-win on its own. Two of them with the SAME manager can
// still leave him worse off together, for exactly the reason above running the
// other way. When `teams` is supplied every partner's combined result is priced
// too, and a packing any partner would refuse is dropped. Without `teams` that
// check cannot be made and the packing is reported unchecked.

/**
 * How many offers the exhaustive search will consider.
 *
 * Every subset of the offers is a candidate packing, so the work is 2^n before
 * disjointness prunes it. Twelve is comfortably exhaustive and is already more
 * trades than any league makes in a week — and because the pool is sorted by
 * gain first, the offers dropped are the ones nobody would have proposed.
 */
const COMBO_OFFER_CAP = 12;

/**
 * A hard stop on packings priced, so a pathological offer set cannot hang the
 * page. Reached only when the offers barely overlap, which a real league's do
 * not. When it trips, `exhaustive: false` comes back and the answer is at worst
 * the greedy packing below.
 */
const COMBO_PACKING_CAP = 4000;

/** Take offers best-first, skipping any that clashes — the documented fallback. */
function greedyPacking(pool) {
  const used = new Set();
  const chosen = [];
  for (const o of pool) {
    if ([...o.ids].some((id) => used.has(id))) continue;
    chosen.push(o);
    for (const id of o.ids) used.add(id);
  }
  return chosen;
}

/**
 * The best set of offers that can all be made at once.
 *
 * Returns BOTH answers, because the owner asked for "the most trades possible"
 * and the section is called "best combo", and those two disagree: three trades
 * worth +2 between them is a worse season than two worth +15. Rather than pick
 * one and be quietly wrong for him, both packings come back — `best` maximises
 * the gain and is the headline, `most` maximises the NUMBER of disjoint trades
 * and is tie-broken by gain — with `mostIsBest` saying whether they are the same
 * packing, so the page never has to compare them itself.
 *
 * @param {Array} offers offers as `findTrades` returns them
 * @param {Object} opts
 * @param {Array}    opts.players  your roster
 * @param {number[]} opts.slots
 * @param {number[]} opts.weeks    the remaining weeks
 * @param {function} opts.projFor  `(player, week) -> number|null`
 * @param {Array}   [opts.teams]   every squad — makes the partner side checked too
 * @param {boolean} [opts.requirePartnersGain] drop a packing a partner would refuse
 * @param {boolean} [opts.onePerPartner] never combine two deals with one manager
 * @param {number}  [opts.maxOffers]
 * @param {number}  [opts.maxPackings]
 * @returns {{combo:Array, count:number, delta:number, pricing:Object,
 *            naiveDelta:number, best:Object, most:Object, mostIsBest:boolean,
 *            considered:number, exhaustive:boolean, offers:Array}}
 */
export function bestCombo(offers, {
  players, slots, weeks, projFor,
  teams = null,
  requirePartnersGain = true,
  onePerPartner = false,
  maxOffers = COMBO_OFFER_CAP,
  maxPackings = COMBO_PACKING_CAP,
} = {}) {
  const ws = Array.isArray(weeks) ? weeks.slice() : [];

  // Every offer, reduced to the only two things a packing cares about: which
  // players it moves, and how good it looked on its own.
  const pool = (offers || [])
    .filter((o) => o && Array.isArray(o.send) && Array.isArray(o.receive))
    .map((offer) => ({
      offer,
      ids: new Set([...offer.send, ...offer.receive].map(idOf).filter((id) => id != null)),
      gain: Number.isFinite(offer.myGain) ? offer.myGain : 0,
    }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, Math.max(0, maxOffers));

  const byId = new Map();
  for (const t of teams || []) byId.set(t.id, t);

  /** Price one packing properly: everything applied together, once. */
  const price = (chosen) => {
    const send = chosen.flatMap((c) => c.offer.send);
    const receive = chosen.flatMap((c) => c.offer.receive);
    const pricing = priceTradeAcrossWeeks({
      players, send, receive, slots, weeks: ws, projFor,
    });

    const partners = [];
    if (byId.size) {
      const byPartner = new Map();
      for (const c of chosen) {
        const id = c.offer.partner && c.offer.partner.id;
        if (!byPartner.has(id)) byPartner.set(id, { out: [], in: [] });
        const side = byPartner.get(id);
        side.out.push(...c.offer.receive); // what he sends me
        side.in.push(...c.offer.send);     // what I send him
      }
      for (const [id, side] of byPartner) {
        const team = byId.get(id);
        if (!team) continue;
        const p = priceTradeAcrossWeeks({
          players: team.players, send: side.out, receive: side.in,
          slots, weeks: ws, projFor,
        });
        partners.push({
          partner: team, delta: p.delta,
          before: p.before.total, after: p.after.total,
        });
      }
    }

    return { pricing, partners };
  };

  let considered = 0;
  let exhaustive = true;
  let best = null;
  let most = null;

  const consider = (chosen) => {
    considered++;
    const { pricing, partners } = price(chosen);
    if (requirePartnersGain && partners.some((p) => p.delta < 0)) return;

    const entry = {
      combo: chosen.map((c) => c.offer),
      count: chosen.length,
      delta: pricing.delta,
      pricing,
      partners,
      // The trap, reported rather than buried: what you would have believed if
      // you had added the offers' own gains up.
      naiveDelta: round1(chosen.reduce((a, c) => a + c.gain, 0)),
      repeatPartners:
        new Set(chosen.map((c) => c.offer.partner && c.offer.partner.id)).size < chosen.length,
    };

    // Ties on gain go to the SMALLER packing. Two trades that buy exactly what
    // one trade buys is one more manager to talk round for nothing, and the
    // second deal is the one the page should not be recommending.
    if (!best || entry.delta > best.delta ||
        (entry.delta === best.delta && entry.count < best.count)) {
      best = entry;
    }
    if (!most || entry.count > most.count ||
        (entry.count === most.count && entry.delta > most.delta)) {
      most = entry;
    }
  };

  // Depth-first over disjoint subsets, best-first. EVERY subset is a candidate
  // — a bigger packing is not always a better one, because two upgrades can
  // compete for the same lineup slot — so nothing here prunes on value, only on
  // compatibility. The empty packing is priced too: "make none of them" is a
  // real answer when every offer turns out to be worth less on the weekly
  // numbers than it looked on the season average.
  const chosen = [];
  const used = new Set();
  const partnersUsed = new Set();

  const walk = (from) => {
    if (considered >= maxPackings) { exhaustive = false; return; }
    consider(chosen);
    for (let i = from; i < pool.length; i++) {
      if (considered >= maxPackings) { exhaustive = false; return; }
      const c = pool[i];
      if ([...c.ids].some((id) => used.has(id))) continue;
      const partnerId = c.offer.partner && c.offer.partner.id;
      if (onePerPartner && partnersUsed.has(partnerId)) continue;

      chosen.push(c);
      for (const id of c.ids) used.add(id);
      const hadPartner = partnersUsed.has(partnerId);
      partnersUsed.add(partnerId);

      walk(i + 1);

      chosen.pop();
      for (const id of c.ids) used.delete(id);
      if (!hadPartner) partnersUsed.delete(partnerId);
    }
  };
  walk(0);

  // The cap tripped, so the search was not exhaustive. Make sure the greedy
  // packing has at least been priced, so the answer is never worse than the
  // obvious one a manager would have reached by hand.
  if (!exhaustive) {
    const greedy = greedyPacking(pool);
    if (greedy.length) consider(greedy);
  }

  const same = !!best && !!most &&
    best.count === most.count &&
    best.combo.every((o, i) => o === most.combo[i]);

  return {
    // The headline IS the best-gain packing, so a caller that reads
    // `combo`/`count`/`delta` and nothing else still gets the right answer.
    combo: best ? best.combo : [],
    count: best ? best.count : 0,
    delta: best ? best.delta : 0,
    pricing: best ? best.pricing : null,
    naiveDelta: best ? best.naiveDelta : 0,
    best,
    most,
    mostIsBest: same,
    considered,
    exhaustive,
    offers: pool.map((c) => c.offer),
  };
}
